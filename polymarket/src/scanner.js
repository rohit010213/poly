const config         = require('./config');
const logger         = require('./utils/logger');
const polyFetcher    = require('./fetchers/polymarket');
const kalshiFetcher  = require('./fetchers/kalshi');
const { matchMarkets, detectArbitrage } = require('./strategies/arbitrage');
const { detectLongshots }               = require('./strategies/longshot');
const { detectWhaleSignals }            = require('./strategies/whaleTracker');
const { detectResolutionEdge }          = require('./strategies/resolutionEdge');
const telegram       = require('./alerts/telegram');
const { table }      = require('table');
const chalk          = require('chalk');

// ── Track already-alerted opportunities to avoid spam ────────────
const alertedArb      = new Set();
const alertedLongshot = new Set();
const alertedWhale    = new Set();
const DEDUP_TTL_MS    = 10 * 60 * 1000;  // 10 minutes

function makeArbKey(opp) {
  return `${opp.poly.id}::${opp.kalshi.ticker}::${opp.poly.side}`;
}

function makeLongshotKey(opp) {
  return `${opp.platform}::${opp.question?.slice(0, 40)}::${opp.type}`;
}

function makeWhaleKey(s) {
  return `${s.whaleAddress}::${s.marketId}::${s.side}`;
}

// ── Console Table Rendering ───────────────────────────────────────

function printArbTable(opps) {
  if (opps.length === 0) return;
  console.log(chalk.yellow('\n🔥 ARBITRAGE OPPORTUNITIES'));
  const rows = [
    ['Market', 'Poly Side', 'Poly ¢', 'Kalshi Side', 'Kalshi ¢', 'Profit%', 'Exp $'],
    ...opps.slice(0, 5).map(o => [
      o.question?.slice(0, 35) + '...',
      chalk.green(o.poly.side),
      (o.poly.price * 100).toFixed(1),
      chalk.green(o.kalshi.side),
      (o.kalshi.price * 100).toFixed(1),
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
    ['Type', 'Market', 'Price', 'Fair Val', 'Edge%', 'Action'],
    ...opps.slice(0, 5).map(o => [
      o.type === 'LONGSHOT_SELL' ? chalk.red('OVERPRICED') : chalk.green('UNDERPRICED'),
      o.question?.slice(0, 30) + '...',
      `${(o.marketPrice * 100).toFixed(1)}¢`,
      `${(o.fairValue * 100).toFixed(1)}¢`,
      chalk.yellow(`+${o.edge}%`),
      chalk.cyan(o.action),
    ]),
  ];
  console.log(table(rows));
}

// ── Main Scan Function ────────────────────────────────────────────

async function runScan() {
  const startTime = Date.now();
  logger.info(chalk.bgBlue.white('\n━━━ SCAN STARTING ━━━'));

  try {
    // 1. Fetch markets in parallel
    const [polyMarkets, kalshiMarkets, whaleTrades, leaderboard] = await Promise.all([
      polyFetcher.fetchMarkets(),
      kalshiFetcher.fetchMarkets(),
      polyFetcher.fetchRecentTrades({ minSize: config.strategy.whaleminTradeSize }),
      polyFetcher.fetchLeaderboard({ limit: 25 }),
    ]);

    // 2. Match markets across platforms
    const pairs = matchMarkets(polyMarkets, kalshiMarkets);

    // 3. Run all strategies
    const [arbOpps, longshotOpps, whaleSignals, resEdgeOpps] = await Promise.all([
      Promise.resolve(detectArbitrage(pairs)),
      Promise.resolve(detectLongshots([...polyMarkets, ...kalshiMarkets])),
      Promise.resolve(detectWhaleSignals(whaleTrades, leaderboard)),
      Promise.resolve(detectResolutionEdge([...polyMarkets, ...kalshiMarkets])),
    ]);

    // 4. Print to console
    printArbTable(arbOpps);
    printLongshotTable(longshotOpps);

    if (whaleSignals.length > 0) {
      console.log(chalk.magenta(`\n🐋 WHALE SIGNALS: ${whaleSignals.length} detected`));
      whaleSignals.slice(0, 3).forEach(s => {
        console.log(`  → ${s.whaleAddress?.slice(0, 10)}... bought ${s.side} $${s.amount} on "${s.question?.slice(0, 40)}"`);
      });
    }

    if (resEdgeOpps.length > 0) {
      console.log(chalk.blue(`\n🔍 RESOLUTION EDGE: ${resEdgeOpps.length} markets`));
    }

    // 5. Send Telegram alerts (deduplicated)
    for (const opp of arbOpps) {
      const key = makeArbKey(opp);
      if (!alertedArb.has(key)) {
        alertedArb.add(key);
        setTimeout(() => alertedArb.delete(key), DEDUP_TTL_MS);
        await telegram.alertArbitrage(opp);
      }
    }

    // Top 3 longshot opps only
    for (const opp of longshotOpps.slice(0, 3)) {
      const key = makeLongshotKey(opp);
      if (!alertedLongshot.has(key)) {
        alertedLongshot.add(key);
        setTimeout(() => alertedLongshot.delete(key), DEDUP_TTL_MS);
        await telegram.alertLongshot(opp);
      }
    }

    // High-confidence whale signals only
    for (const signal of whaleSignals.filter(s => s.confidence === 'HIGH')) {
      const key = makeWhaleKey(signal);
      if (!alertedWhale.has(key)) {
        alertedWhale.add(key);
        setTimeout(() => alertedWhale.delete(key), DEDUP_TTL_MS);
        await telegram.alertWhale(signal);
      }
    }

    // Top resolution edge opp
    if (resEdgeOpps.length > 0) {
      await telegram.alertResolutionEdge(resEdgeOpps[0]);
    }

    const scanDurationMs = Date.now() - startTime;

    // 6. Summary
    logger.info(chalk.green(`\n✅ Scan complete in ${scanDurationMs}ms`));
    logger.info(`   ARB: ${arbOpps.length} | Longshot: ${longshotOpps.length} | Whale: ${whaleSignals.length} | ResEdge: ${resEdgeOpps.length}`);

    // Telegram summary every scan
    await telegram.alertScanSummary({
      arbCount:      arbOpps.length,
      longshotCount: longshotOpps.length,
      whaleCount:    whaleSignals.length,
      resEdgeCount:  resEdgeOpps.length,
      scanDurationMs,
    });

    return { arbOpps, longshotOpps, whaleSignals, resEdgeOpps };
  } catch (err) {
    logger.error(`[Scanner] Fatal error: ${err.message}`);
    logger.error(err.stack);
    return { arbOpps: [], longshotOpps: [], whaleSignals: [], resEdgeOpps: [] };
  }
}

module.exports = { runScan };
