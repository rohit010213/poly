const Fuse   = require('fuse.js');
const config = require('../config');
const logger = require('../utils/logger');

// Polymarket fee (~2%), Kalshi fee (~7 cents per contract)
const POLY_FEE   = 0.02;
const KALSHI_FEE = 0.007;
const TOTAL_FEES = POLY_FEE + KALSHI_FEE;

/**
 * Fuzzy-match Kalshi markets to Polymarket markets by question text
 * Returns array of { polyMarket, kalshiMarket, score }
 */
function matchMarkets(polyMarkets, kalshiMarkets) {
  const fuse = new Fuse(kalshiMarkets, {
    keys:               ['question', 'slug'],
    threshold:          config.scanner.fuzzyMatchScore,
    includeScore:       true,
    ignoreLocation:     true,
    minMatchCharLength: 8,
  });

  const pairs = [];

  for (const poly of polyMarkets) {
    const results = fuse.search(poly.question);
    if (results.length > 0) {
      const best = results[0];
      pairs.push({
        polyMarket:   poly,
        kalshiMarket: best.item,
        matchScore:   best.score,    // lower = better match
        matchQuality: best.score < 0.15 ? 'HIGH' : best.score < 0.30 ? 'MEDIUM' : 'LOW',
      });
    }
  }

  logger.info(`[Arbitrage] Matched ${pairs.length} market pairs`);
  return pairs;
}

/**
 * For each matched pair, compute arbitrage opportunities
 *
 * Arb Logic:
 *   Buy YES on platform A + Buy NO on platform B
 *   If YES_A + NO_B < 1 - fees → PROFIT
 *
 * @param {Array} pairs - from matchMarkets()
 * @returns {Array} opportunities sorted by profitability
 */
function detectArbitrage(pairs) {
  const opportunities = [];

  for (const { polyMarket, kalshiMarket, matchScore, matchQuality } of pairs) {
    // Skip low quality matches or low liquidity
    if (matchQuality === 'LOW') continue;
    if (polyMarket.liquidity   < config.strategy.minLiquidity) continue;
    if (kalshiMarket.liquidity < config.strategy.minLiquidity) continue;

    const p = polyMarket;
    const k = kalshiMarket;

    // ── Scenario A: Buy YES on Poly + NO on Kalshi ────────────────
    const costA = p.yesPrice + k.noPrice;
    const profitA = 1 - costA - TOTAL_FEES;

    // ── Scenario B: Buy NO on Poly + YES on Kalshi ────────────────
    const costB = p.noPrice + k.yesPrice;
    const profitB = 1 - costB - TOTAL_FEES;

    const bestProfit = Math.max(profitA, profitB);
    if (bestProfit < config.strategy.minArbProfit) continue;

    const isScenarioA = profitA >= profitB;
    const profit       = isScenarioA ? profitA : profitB;
    const cost         = isScenarioA ? costA   : costB;

    // Compute position size & expected $profit
    const positionSize = Math.min(config.strategy.maxPositionSize, 
      Math.floor(Math.min(p.liquidity, k.liquidity) * 0.05)); // max 5% of liquidity
    const expectedProfit$ = positionSize * profit;

    opportunities.push({
      type:         'ARBITRAGE',
      matchQuality,
      matchScore,
      question:     p.question,

      // Poly side
      poly: {
        id:        p.id,
        url:       p.url,
        side:      isScenarioA ? 'YES' : 'NO',
        price:     isScenarioA ? p.yesPrice : p.noPrice,
        liquidity: p.liquidity,
      },

      // Kalshi side
      kalshi: {
        ticker:    k.ticker,
        url:       k.url,
        side:      isScenarioA ? 'NO' : 'YES',
        price:     isScenarioA ? k.noPrice : k.yesPrice,
        liquidity: k.liquidity,
      },

      // Profit metrics
      totalCost:      parseFloat(cost.toFixed(4)),
      profitPct:      parseFloat((profit * 100).toFixed(2)),
      positionSize,
      expectedProfit: parseFloat(expectedProfit$.toFixed(2)),
      feesConsidered: parseFloat((TOTAL_FEES * 100).toFixed(2)),

      detectedAt: new Date().toISOString(),
    });
  }

  // Sort by profit %
  opportunities.sort((a, b) => b.profitPct - a.profitPct);

  if (opportunities.length > 0) {
    logger.warn(`[Arbitrage] 🔥 Found ${opportunities.length} opportunities!`);
  } else {
    logger.info(`[Arbitrage] No opportunities above ${config.strategy.minArbProfit * 100}% threshold`);
  }

  return opportunities;
}

module.exports = { matchMarkets, detectArbitrage };
