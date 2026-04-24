const config = require('./config');
const logger = require('./utils/logger');
const polyFetcher = require('./fetchers/polymarket');
const kalshiFetcher = require('./fetchers/kalshi');

// Phase 1, 2, 3 Strategies
const { matchMarkets, detectArbitrage } = require('./strategies/arbitrage');
const { detectDivergence } = require('./strategies/correlation');
const marketMaker = require('./strategies/marketMaker');

const telegram = require('./alerts/telegram');
const chalk = require('chalk');

// ── Dedup sets ────────────────────────────────────────────────────
const alertedArb = new Map();
const alertedCorrelation = new Map();
const alertedMM = new Map();

function isDuped(map, key, ttl) {
  const expiry = map.get(key);
  if (expiry && Date.now() < expiry) return true;
  map.set(key, Date.now() + ttl);
  return false;
}

function makeArbKey(opp) { return `${opp.poly.id}::${opp.kalshi.ticker}::${opp.poly.side}`; }
function makeCorrKey(opp) { return `${opp.groupName}::${opp.reason}::${opp.description.slice(0, 30)}`; }
function makeMMKey(opp) { return `${opp.ticker}::${opp.spread}`; }

// ── Main Scan ─────────────────────────────────────────────────────
async function runScan() {
  const startTime = Date.now();
  logger.info(`━━━ 🛡️ BOT SCAN STARTING [3 PHASES] ━━━`);

  try {
    // Step 1: Fetch data
    const [polyMarkets, kalshiMarkets] = await Promise.all([
      polyFetcher.fetchMarkets(),
      kalshiFetcher.fetchMarkets(),
    ]);
    logger.info(`[Scanner] Data — Poly: ${polyMarkets.length}, Kalshi: ${kalshiMarkets.length}`);

    const allMarkets = [...polyMarkets, ...kalshiMarkets];

    // ══════════════════════════════════════════════════════════════════
    //  PHASE 1: ARBITRAGE (Risk-Free)
    // ══════════════════════════════════════════════════════════════════
    const pairs = matchMarkets(polyMarkets, kalshiMarkets);
    const arbOpps = detectArbitrage(pairs);

    // ══════════════════════════════════════════════════════════════════
    //  PHASE 2: CORRELATED DIVERGENCE (High Return)
    // ══════════════════════════════════════════════════════════════════
    const correlationOpps = detectDivergence(allMarkets);

    // ══════════════════════════════════════════════════════════════════
    //  PHASE 3: MARKET MAKING (Consistent Income)
    // ══════════════════════════════════════════════════════════════════
    const mmOpps = marketMaker.findOpportunities(polyMarkets);

    const scanDurationMs = Date.now() - startTime;
    logger.info(`✅ Scan done in ${scanDurationMs}ms | ARB:${arbOpps.length} CORR:${correlationOpps.length} MM:${mmOpps.length}`);

    // Step 3: Alerts
    let alertsSent = 0;

    // Phase 1 Alerts
    for (const opp of arbOpps) {
      if (!isDuped(alertedArb, makeArbKey(opp), config.alerts.mainDedupTTL)) {
        await telegram.alertArbitrage(opp);
        alertsSent++;
      }
    }

    // Phase 2 Alerts
    for (const opp of correlationOpps) {
      if (!isDuped(alertedCorrelation, makeCorrKey(opp), 30 * 60 * 1000)) {
        await telegram.send(`
🧠 *CORRELATED DIVERGENCE ALERT*
━━━━━━━━━━━━━━━━━━━━━━━━━
📂 *Group:* ${opp.groupName}
⚠️ *Reason:* ${opp.reason}
💡 ${opp.description}

*Action:* ${opp.suggestedAction || 'Check market gap'}
[👉 Trade Link](${opp.url})
        `);
        alertsSent++;
      }
    }

    // Phase 3 Alerts (Top 2 opportunities to avoid spam)
    for (const opp of mmOpps.slice(0, 2)) {
      if (!isDuped(alertedMM, makeMMKey(opp), 60 * 60 * 1000)) { // 1 hour dedup
        await telegram.send(`
🏦 *MARKET MAKING OPPORTUNITY*
━━━━━━━━━━━━━━━━━━━━━━━━━
📋 *Market:* ${opp.question.slice(0, 100)}

💰 *Spread:* ${(opp.spread * 100).toFixed(1)}¢ (Profit per round)
📊 *24h Volume:* $${opp.dailyVolume.toLocaleString()}
📈 *Target:* Capture the spread by placing Bid/Ask orders

[👉 Market Link](${opp.url})
        `);
        alertsSent++;
      }
    }

    // Phase 3 Console Logging
    if (mmOpps.length > 0) {
      console.log(chalk.cyan(`\n🏦 MARKET MAKING OPS: ${mmOpps.length}`));
      mmOpps.slice(0, 3).forEach(o => 
        console.log(`  → ${o.question.slice(0, 40)} | Spread: ${(o.spread*100).toFixed(1)}¢ | Vol: $${o.dailyVolume.toLocaleString()}`)
      );
    }

    // ── Scan Summary & Heartbeat ─────────────────────────────────────────
    const SUMMARY_HEARTBEAT_TTL = 60 * 60 * 1000;
    const shouldSendSummary = alertsSent > 0 ||
      !isDuped(alertedArb, '__HEARTBEAT__', SUMMARY_HEARTBEAT_TTL);

    if (shouldSendSummary) {
      await telegram.alertScanSummary({
        arbCount: arbOpps.length,
        newAlerts: alertsSent,
        scanDurationMs,
      });
    }

    return { arbOpps, correlationOpps, mmOpps };
  } catch (err) {
    logger.error(`[Scanner] Fatal: ${err.message}`);
    return { arbOpps: [], correlationOpps: [], mmOpps: [] };
  }
}

module.exports = { runScan };