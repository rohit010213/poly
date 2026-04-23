const config = require('./config');
const logger = require('./utils/logger');
const polyFetcher = require('./fetchers/polymarket');
const kalshiFetcher = require('./fetchers/kalshi');
const { matchMarkets, detectArbitrage } = require('./strategies/arbitrage');
const { detectLongshots } = require('./strategies/longshot');
const { detectWhaleSignals } = require('./strategies/whaleTracker');
const { detectResolutionEdge } = require('./strategies/resolutionEdge');
const telegram = require('./alerts/telegram');
const { table } = require('table');
const chalk = require('chalk');

// ── Dedup sets — persistent (cleared per TTL) ─────────────────────
const alertedArb = new Map();  // key → expiry timestamp
const alertedLongshot = new Map();
const alertedWhale = new Map();
const alertedResEdge = new Map();  // 1 hour TTL

function isDuped(map, key, ttl) {
  const expiry = map.get(key);
  if (expiry && Date.now() < expiry) return true;
  map.set(key, Date.now() + ttl);
  return false;
}

function makeArbKey(opp) { return `${opp.poly.id}::${opp.kalshi.ticker}::${opp.poly.side}`; }
function makeLongshotKey(opp) { return `${opp.platform}::${opp.type}::${opp.question?.slice(0, 40)}`; }
function makeWhaleKey(s) { return `${s.whaleAddress}::${s.marketId}::${s.side}`; }
function makeResEdgeKey(opp) { return `${opp.platform}::${opp.question?.slice(0, 50)}`; }

// ── Console Tables ────────────────────────────────────────────────
function printArbTable(opps) {
  if (opps.length === 0) return;
  console.log(chalk.yellow('\n🔥 ARBITRAGE OPPORTUNITIES'));
  const rows = [
    ['Market', 'Poly', 'Kalshi', 'Profit%', 'Exp $'],
    ...opps.slice(0, 5).map(o => [
      o.question?.slice(0, 38),
      `${o.poly.side} @${(o.poly.price * 100).toFixed(0)}¢`,
      `${o.kalshi.side} @${(o.kalshi.price * 100).toFixed(0)}¢`,
      chalk.yellow(`+${o.profitPct}%`),
      chalk.green(`$${o.expectedProfit}`),
    ]),
  ];
  console.log(table(rows));
}

function printLongshotTable(opps) {
  if (opps.length === 0) return;
  console.log(chalk.cyan('\n📉 LONGSHOT / FAVORITE OPPORTUNITIES'));
  const rows = [
    ['Type', 'Market', 'Price', 'Edge%', 'Action'],
    ...opps.slice(0, 5).map(o => [
      o.type === 'LONGSHOT_SELL' ? chalk.red('OVERPRICED') : chalk.green('FAVORITE'),
      o.question?.slice(0, 35),
      `${(o.marketPrice * 100).toFixed(1)}¢`,
      chalk.yellow(`+${o.edge}%`),
      chalk.cyan(o.action),
    ]),
  ];
  console.log(table(rows));
}

// ── Main Scan ─────────────────────────────────────────────────────
async function runScan() {
  const startTime = Date.now();
  logger.info('━━━ SCAN STARTING ━━━');

  try {
    // Step 1: Fetch data
    const [polyMarkets, kalshiMarkets, whaleTrades, leaderboard] = await Promise.all([
      polyFetcher.fetchMarkets(),
      kalshiFetcher.fetchMarkets(),
      polyFetcher.fetchRecentTrades({ minSize: config.strategy.whaleminTradeSize }),
      polyFetcher.fetchLeaderboard({ limit: 25 }),
    ]);
    logger.info(`[Scanner] Fetched — Poly: ${polyMarkets.length}, Kalshi: ${kalshiMarkets.length}, Whales: ${whaleTrades.length}`);

    // Step 2: Match
    logger.info('[Scanner] Matching markets...');
    const pairs = matchMarkets(polyMarkets, kalshiMarkets);

    // Step 3: Strategies (sequential)
    const arbOpps = detectArbitrage(pairs);
    const longshotOpps = detectLongshots([...polyMarkets, ...kalshiMarkets]);
    const whaleSignals = detectWhaleSignals(whaleTrades, leaderboard);

    // Resolution edge: sirf high-score wale
    const allResEdge = detectResolutionEdge([...polyMarkets, ...kalshiMarkets]);
    const resEdgeOpps = allResEdge.filter(o => o.edgeScore >= config.alerts.minResEdgeScore);

    // Step 4: Console output
    printArbTable(arbOpps);
    printLongshotTable(longshotOpps);
    if (whaleSignals.length > 0) {
      console.log(chalk.magenta(`\n🐋 WHALE SIGNALS: ${whaleSignals.length}`));
      whaleSignals.slice(0, 3).forEach(s =>
        console.log(`  → ${s.whaleAddress?.slice(0, 10)}... ${s.side} $${s.amount} on "${s.question?.slice(0, 40)}"`)
      );
    }
    console.log(chalk.blue(`🔍 Resolution Edge (score>=${config.alerts.minResEdgeScore}): ${resEdgeOpps.length} of ${allResEdge.length} total`));

    const scanDurationMs = Date.now() - startTime;
    const totalOpps = arbOpps.length + longshotOpps.length + whaleSignals.length + resEdgeOpps.length;
    logger.info(`✅ Scan done in ${scanDurationMs}ms | ARB:${arbOpps.length} LONG:${longshotOpps.length} WHALE:${whaleSignals.length} RES:${resEdgeOpps.length}`);

    // Step 5: Telegram alerts (DEDUPLICATED)

    // Arb alerts — 10 min dedup
    for (const opp of arbOpps) {
      if (!isDuped(alertedArb, makeArbKey(opp), config.alerts.mainDedupTTL)) {
        await telegram.alertArbitrage(opp);
      }
    }

    // Longshot — top 3, 10 min dedup
    for (const opp of longshotOpps.slice(0, 3)) {
      if (!isDuped(alertedLongshot, makeLongshotKey(opp), config.alerts.mainDedupTTL)) {
        await telegram.alertLongshot(opp);
      }
    }

    // Whale — HIGH confidence only, 10 min dedup
    for (const signal of whaleSignals.filter(s => s.confidence === 'HIGH')) {
      if (!isDuped(alertedWhale, makeWhaleKey(signal), config.alerts.mainDedupTTL)) {
        await telegram.alertWhale(signal);
      }
    }

    // Resolution edge — max 1 per scan, 1 HOUR dedup (no spam!)
    let resAlertsSent = 0;
    for (const opp of resEdgeOpps) {
      if (resAlertsSent >= config.alerts.maxResEdgeAlertsPerScan) break;
      if (!isDuped(alertedResEdge, makeResEdgeKey(opp), config.alerts.resEdgeDedupTTL)) {
        await telegram.alertResolutionEdge(opp);
        resAlertsSent++;
      }
    }

    // Scan summary — SIRF jab koi opportunity mili ho
    if (!config.alerts.summaryOnlyWhenOpportunity || totalOpps > 0) {
      await telegram.alertScanSummary({
        arbCount: arbOpps.length,
        longshotCount: longshotOpps.length,
        whaleCount: whaleSignals.length,
        resEdgeCount: resEdgeOpps.length,
        scanDurationMs,
      });
    }

    return { arbOpps, longshotOpps, whaleSignals, resEdgeOpps };
  } catch (err) {
    logger.error(`[Scanner] Fatal: ${err.message}`);
    logger.error(err.stack);
    return { arbOpps: [], longshotOpps: [], whaleSignals: [], resEdgeOpps: [] };
  }
}

module.exports = { runScan };