const config = require('./config');
const logger = require('./utils/logger');
const polyFetcher = require('./fetchers/polymarket');
const kalshiFetcher = require('./fetchers/kalshi');
const { matchMarkets, detectArbitrage } = require('./strategies/arbitrage');
const { detectLongshots } = require('./strategies/longshot');
const { detectWhaleSignals } = require('./strategies/whaleTracker');
const { detectResolutionEdge } = require('./strategies/resolutionEdge');
const { detectYieldPlays } = require('./strategies/yieldPlay');
const { recordMarketSnapshots, detectOverreactionFades } = require('./strategies/overreactionFade');
const { updateAllBaselines, detectVolumeSpikes } = require('./strategies/volumeSpike');
const { detectTodayResearchTrades } = require('./strategies/todayResearch');
const telegram = require('./alerts/telegram');
const { table } = require('table');
const chalk = require('chalk');

// ── Dedup sets ────────────────────────────────────────────────────
const alertedArb = new Map();
const alertedLongshot = new Map();
const alertedWhale = new Map();
const alertedResEdge = new Map();
const alertedYield = new Map();
const alertedFade = new Map();
const alertedVolSpike = new Map();
const alertedResearch = new Map();

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
function makeYieldKey(opp) { return `${opp.platform}::${opp.side}::${opp.question?.slice(0, 50)}`; }
function makeFadeKey(opp) { return `${opp.platform}::${opp.fadeSide}::${opp.question?.slice(0, 50)}`; }
function makeVolSpikeKey(opp) { return `${opp.platform}::${opp.side}::${opp.question?.slice(0, 50)}`; }
function makeResearchKey(opp) { return `${opp.platform}::${opp.question?.slice(0, 60)}`; }

// ══════════════════════════════════════════════════════════════════
//  SAFE MODE FILTERS
//  Sirf woh trades jo LOW risk hain aur jaldi resolve hoti hain
// ══════════════════════════════════════════════════════════════════

function filterSafeYield(opps) {
  if (!config.strategy.safeMode) return opps;
  // Safe mode: sirf VERY_LOW aur LOW risk, max 7 days
  return opps.filter(o =>
    (o.riskLevel === 'VERY_LOW' || o.riskLevel === 'LOW') &&
    o.daysToResolve <= config.strategy.yieldMaxDays
  );
}

function filterSafeLongshots(opps) {
  if (!config.strategy.safeMode) return opps;
  // Safe mode: sirf FAVORITE_BUY (85%+ probability = low risk)
  // Longshot sells are risky, skip them
  return opps.filter(o => o.type === 'FAVORITE_BUY' && o.edge >= 2);
}

function filterSafeFades(opps) {
  if (!config.strategy.safeMode) return opps;
  // Safe mode: sirf HIGH confidence fades with good R:R
  return opps.filter(o => o.confidence === 'HIGH' && o.riskRewardRatio >= 2);
}

function filterSafeVolumeSpikes(opps) {
  if (!config.strategy.safeMode) return opps;
  // Safe mode: sirf HIGH confidence volume spikes
  return opps.filter(o => o.confidence === 'HIGH');
}

function filterSafeWhales(signals) {
  if (!config.strategy.safeMode) return signals;
  // Safe mode: sirf HIGH confidence whale signals
  return signals.filter(s => s.confidence === 'HIGH');
}

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

function printYieldTable(opps) {
  if (opps.length === 0) return;
  console.log(chalk.green('\n🏦 SAFE YIELD TRADES'));
  const rows = [
    ['Market', 'Side', 'Price', 'Return', 'Days', 'Risk'],
    ...opps.slice(0, 5).map(o => [
      o.question?.slice(0, 30),
      chalk.green(o.side),
      `${(o.marketPrice * 100).toFixed(1)}¢`,
      chalk.green(`+${o.returnPct}%`),
      `${o.daysToResolve}d`,
      o.riskLevel === 'VERY_LOW' ? chalk.green(o.riskLevel) : chalk.yellow(o.riskLevel),
    ]),
  ];
  console.log(table(rows));
}

// ── Main Scan ─────────────────────────────────────────────────────
async function runScan() {
  const startTime = Date.now();
  const safeLabel = config.strategy.safeMode ? '🛡️ SAFE MODE' : '⚡ FULL MODE';
  logger.info(`━━━ SCAN STARTING [${safeLabel}] ━━━`);

  try {
    // Step 1: Fetch data
    const [polyMarkets, kalshiMarkets, whaleTrades, leaderboard] = await Promise.all([
      polyFetcher.fetchMarkets(),
      kalshiFetcher.fetchMarkets(),
      polyFetcher.fetchRecentTrades({ minSize: config.strategy.whaleminTradeSize }),
      polyFetcher.fetchLeaderboard({ limit: 25 }),
    ]);
    logger.info(`[Scanner] Fetched — Poly: ${polyMarkets.length}, Kalshi: ${kalshiMarkets.length}`);

    const allMarkets = [...polyMarkets, ...kalshiMarkets];

    // Step 2: Record snapshots for time-series strategies
    recordMarketSnapshots(allMarkets);
    updateAllBaselines(allMarkets);

    // Step 3: Match for arbitrage
    const pairs = matchMarkets(polyMarkets, kalshiMarkets);

    // Step 4: Run ALL strategies
    const arbOppsRaw = detectArbitrage(pairs);
    const longshotOppsRaw = detectLongshots(allMarkets);
    const whaleSignalsRaw = detectWhaleSignals(whaleTrades, leaderboard);
    const allResEdge = detectResolutionEdge(allMarkets);
    const resEdgeOpps = allResEdge.filter(o => o.edgeScore >= config.alerts.minResEdgeScore);
    const yieldOppsRaw = detectYieldPlays(allMarkets, { bankroll: config.strategy.bankroll });
    const fadeSignalsRaw = detectOverreactionFades(allMarkets);
    const volSpikeSignalsRaw = detectVolumeSpikes(allMarkets);
    const researchOpps = detectTodayResearchTrades(allMarkets);

    // Step 5: SAFE MODE FILTER — sirf low-risk trades aur JALDI resolve hone wale
    const isQuickResolve = (o, maxDays = 7) => {
      if (!o.endDate) return false; 
      
      const resolveDate = new Date(o.endDate);
      const now = new Date();
      const days = (resolveDate - now) / (1000 * 60 * 60 * 24);
      
      if (days > maxDays || days < -1) return false;

      const q = (o.question || '').toLowerCase();
      const currentYear = now.getFullYear();
      const farYears = [currentYear + 2, '2027', '2028', '2029', '2030'];
      
      for (const year of farYears) {
        if (q.includes(year.toString())) return false;
      }
      return true;
    };

    const arbOpps = arbOppsRaw.filter(o => isQuickResolve(o, 7));
    const yieldOpps = filterSafeYield(yieldOppsRaw).filter(o => isQuickResolve(o, 7));
    const longshotOpps = filterSafeLongshots(longshotOppsRaw).filter(o => isQuickResolve(o, 7));
    const fadeSignals = filterSafeFades(fadeSignalsRaw).filter(o => isQuickResolve(o, 7));
    const volSpikeSignals = filterSafeVolumeSpikes(volSpikeSignalsRaw).filter(o => isQuickResolve(o, 7));
    const whaleSignals = filterSafeWhales(whaleSignalsRaw).filter(o => isQuickResolve(o, 7));
    
    // Research trades ko 14 din tak allow karna hai
    const filteredResearch = researchOpps.filter(o => isQuickResolve(o, 14));

    const safeTradeCount = arbOpps.length + yieldOpps.length;

    if (config.strategy.safeMode) {
      logger.info(`[SafeMode] Filtered → Yield: ${yieldOpps.length}, Long: ${longshotOpps.length}, Research: ${filteredResearch.length}`);
    }

    // Step 6: Console output
    printArbTable(arbOpps);
    printYieldTable(yieldOpps);

    if (longshotOpps.length > 0) {
      console.log(chalk.cyan(`\n📈 SAFE FAVORITES: ${longshotOpps.length}`));
      longshotOpps.slice(0, 3).forEach(o =>
        console.log(`  → ${o.question?.slice(0, 40)} | YES @ ${(o.marketPrice * 100).toFixed(0)}¢ | Edge: +${o.edge}%`)
      );
    }
    if (fadeSignals.length > 0) {
      console.log(chalk.red(`\n📉 HIGH-CONF FADES: ${fadeSignals.length}`));
    }
    if (volSpikeSignals.length > 0) {
      console.log(chalk.yellow(`\n📊 HIGH-CONF VOLUME: ${volSpikeSignals.length}`));
    }
    if (filteredResearch.length > 0) {
      console.log(chalk.magenta(`\n🔬 RESEARCH TRADES: ${filteredResearch.length}`));
      filteredResearch.slice(0, 5).forEach(o =>
        console.log(`  → ${o.categoryEmoji} ${o.resolveLabel} | ${o.question?.slice(0, 40)} | YES:${(o.yesPrice*100).toFixed(0)}¢ NO:${(o.noPrice*100).toFixed(0)}¢ | Score:${o.researchScore}`)
      );
    }

    const scanDurationMs = Date.now() - startTime;
    logger.info(`✅ Scan done in ${scanDurationMs}ms | SAFE:${safeTradeCount} ARB:${arbOpps.length} YIELD:${yieldOpps.length} RESEARCH:${filteredResearch.length} LONG:${longshotOpps.length}`);

    // Step 7: Telegram alerts (DEDUPLICATED)
    let newAlertsSentThisScan = 0;

    // 🏦 Yield plays — TOP PRIORITY (safe, quick resolve)
    for (const opp of yieldOpps.slice(0, 3)) {
      if (!isDuped(alertedYield, makeYieldKey(opp), config.alerts.yieldDedupTTL)) {
        await telegram.alertYieldPlay(opp);
        newAlertsSentThisScan++;
      }
    }

    // 🔥 Arb alerts (risk-free)
    for (const opp of arbOpps) {
      if (!isDuped(alertedArb, makeArbKey(opp), config.alerts.mainDedupTTL)) {
        await telegram.alertArbitrage(opp);
        newAlertsSentThisScan++;
      }
    }

    // 📈 Safe favorites only (high probability)
    for (const opp of longshotOpps.slice(0, 2)) {
      if (!isDuped(alertedLongshot, makeLongshotKey(opp), config.alerts.mainDedupTTL)) {
        await telegram.alertLongshot(opp);
        newAlertsSentThisScan++;
      }
    }

    // 🐋 Whale signals (HIGH only in safe mode)
    for (const signal of whaleSignals.slice(0, 1)) {
      if (!isDuped(alertedWhale, makeWhaleKey(signal), config.alerts.mainDedupTTL)) {
        await telegram.alertWhale(signal);
        newAlertsSentThisScan++;
      }
    }

    // 📉 Fade (HIGH confidence only in safe mode)
    for (const signal of fadeSignals.slice(0, 1)) {
      if (!isDuped(alertedFade, makeFadeKey(signal), config.alerts.fadeDedupTTL)) {
        await telegram.alertFade(signal);
        newAlertsSentThisScan++;
      }
    }

    // 📊 Volume spike (HIGH confidence only in safe mode)
    for (const signal of volSpikeSignals.slice(0, 1)) {
      if (!isDuped(alertedVolSpike, makeVolSpikeKey(signal), config.alerts.volumeSpikeDedupTTL)) {
        await telegram.alertVolumeSpike(signal);
        newAlertsSentThisScan++;
      }
    }

    // 🔬 Research trades — top 3, 1 hour dedup
    for (const opp of filteredResearch.slice(0, 3)) {
      if (!isDuped(alertedResearch, makeResearchKey(opp), config.alerts.researchDedupTTL)) {
        await telegram.alertResearchTrade(opp);
        newAlertsSentThisScan++;
      }
    }

    // Resolution edge — max 1 per scan
    let resAlertsSent = 0;
    for (const opp of resEdgeOpps) {
      if (resAlertsSent >= config.alerts.maxResEdgeAlertsPerScan) break;
      if (!isDuped(alertedResEdge, makeResEdgeKey(opp), config.alerts.resEdgeDedupTTL)) {
        await telegram.alertResolutionEdge(opp);
        resAlertsSent++;
        newAlertsSentThisScan++;
      }
    }

    // ── Scan Summary ─────────────────────────────────────────
    const SUMMARY_HEARTBEAT_TTL = 60 * 60 * 1000;
    const shouldSendSummary = newAlertsSentThisScan > 0 ||
      !isDuped(alertedResEdge, '__HEARTBEAT__', SUMMARY_HEARTBEAT_TTL);

    if (shouldSendSummary) {
      await telegram.alertScanSummary({
        arbCount: arbOpps.length,
        longshotCount: longshotOpps.length,
        whaleCount: whaleSignals.length,
        resEdgeCount: resEdgeOpps.length,
        yieldCount: yieldOpps.length,
        fadeCount: fadeSignals.length,
        volSpikeCount: volSpikeSignals.length,
        researchCount: researchOpps.length,
        safeTradeCount,
        newAlerts: newAlertsSentThisScan,
        scanDurationMs,
      });
    }

    return { arbOpps, longshotOpps, whaleSignals, resEdgeOpps, yieldOpps, fadeSignals, volSpikeSignals, researchOpps };
  } catch (err) {
    logger.error(`[Scanner] Fatal: ${err.message}`);
    logger.error(err.stack);
    return { arbOpps: [], longshotOpps: [], whaleSignals: [], resEdgeOpps: [], yieldOpps: [], fadeSignals: [], volSpikeSignals: [], researchOpps: [] };
  }
}

module.exports = { runScan };