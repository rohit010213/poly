const config = require('../config');
const logger = require('../utils/logger');

/**
 * Yield Play Strategy — Near-Certainty Scanner (SAFE MODE)
 * ──────────────────────────────────────────────────────────────────
 * Concept: Find markets trading at 95-99¢ that resolve within 7 days.
 * These are "almost guaranteed" outcomes — small return but very safe.
 *
 * Win Rate: 90-95%
 * Risk: LOW (max loss capped at 5% of bankroll per trade)
 * Time: Resolves within 1 day to 1 week
 * Mitigation: Diversify across 3-5 independent markets
 */

// ── Kelly Criterion Calculator ────────────────────────────────────
function calcQuarterKelly({ estimatedProb, marketPrice, bankroll }) {
  if (estimatedProb <= marketPrice) return 0; // No edge
  const b = (1 / marketPrice) - 1; // Net odds
  const p = estimatedProb;
  const q = 1 - p;
  const fullKelly = (b * p - q) / b;
  const quarterKelly = Math.max(0, fullKelly * 0.25);
  return {
    fraction: parseFloat(quarterKelly.toFixed(4)),
    dollarAmount: parseFloat((quarterKelly * bankroll).toFixed(2)),
    fullKellyFraction: parseFloat(fullKelly.toFixed(4)),
  };
}

// ── Annualized Yield Calculator ───────────────────────────────────
function calcAnnualizedYield(price, daysToResolve) {
  if (price >= 1 || price <= 0 || daysToResolve <= 0) return 0;
  const returnPerTrade = (1 / price) - 1;
  const annualized = Math.pow(1 + returnPerTrade, 365 / daysToResolve) - 1;
  return parseFloat((annualized * 100).toFixed(2));
}

// ── Days Until Market Resolves ────────────────────────────────────
function daysUntilResolve(endDate) {
  if (!endDate) return Infinity;
  const end = new Date(endDate);
  const now = new Date();
  const diffMs = end.getTime() - now.getTime();
  return Math.max(0, diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Detect yield play opportunities
 * @param {Array} markets - from any fetcher
 * @param {Object} options - { bankroll }
 * @returns {Array} yield opportunities sorted by annualized yield
 */
function detectYieldPlays(markets, options = {}) {
  const bankroll = options.bankroll || config.strategy.maxPositionSize * 5 || 500;
  const opportunities = [];

  for (const market of markets) {
    if (!market.active) continue;

    const { yesPrice, noPrice } = market;
    if (!yesPrice || !noPrice) continue;

    const liq = parseFloat(market.liquidity || 0);
    const vol = parseFloat(market.volume || 0);
    const days = daysUntilResolve(market.endDate);

    // ── Check YES side (near-certainty YES) ───────────────────
    if (yesPrice >= config.strategy.yieldMinPrice && yesPrice <= config.strategy.yieldMaxPrice) {
      if (liq < config.strategy.yieldMinLiquidity && vol < config.strategy.yieldMinLiquidity) continue;
      if (days > config.strategy.yieldMaxDays || days <= 0) continue;

      const returnPct = ((1 / yesPrice) - 1) * 100;
      const annualizedYield = calcAnnualizedYield(yesPrice, days);

      // Estimate true probability slightly higher than market
      // (conservative: assume market is 1-2% underpriced)
      const estimatedProb = Math.min(0.995, yesPrice + 0.015);
      const kelly = calcQuarterKelly({ estimatedProb, marketPrice: yesPrice, bankroll });

      if (kelly.fraction <= 0) continue;

      opportunities.push({
        type: 'YIELD_PLAY',
        subType: 'Near-Certainty YES',
        side: 'YES',
        question: market.question,
        platform: market.platform,
        url: market.url,
        action: `BUY YES @ ${(yesPrice * 100).toFixed(1)}¢`,

        // Pricing
        marketPrice: yesPrice,
        costPerShare: yesPrice,
        returnPerShare: parseFloat((1 - yesPrice).toFixed(4)),
        returnPct: parseFloat(returnPct.toFixed(2)),
        annualizedYield,

        // Timing
        daysToResolve: parseFloat(days.toFixed(1)),
        endDate: market.endDate,

        // Position Sizing — SAFE: capped at maxLossPerTrade (5% bankroll)
        kellyFraction: kelly.fraction,
        suggestedSize: Math.min(kelly.dollarAmount, bankroll * config.strategy.maxLossPerTrade),
        maxShares: Math.floor(Math.min(kelly.dollarAmount, bankroll * config.strategy.maxLossPerTrade) / yesPrice),

        // Risk
        riskLevel: yesPrice >= 0.97 ? 'VERY_LOW' : yesPrice >= 0.95 ? 'LOW' : 'MEDIUM',
        maxLoss: `$${Math.min(kelly.dollarAmount, bankroll * config.strategy.maxLossPerTrade).toFixed(2)} (agar galat hua)`,
        tailRiskNote: `⚠️ Max loss capped at $${(bankroll * config.strategy.maxLossPerTrade).toFixed(0)} — isse zyada nahi jayega`,

        // Market stats
        liquidity: liq,
        volume: vol,
        detectedAt: new Date().toISOString(),
      });
    }

    // ── Check NO side (near-certainty NO — thing WON'T happen) ─
    if (noPrice >= config.strategy.yieldMinPrice && noPrice <= config.strategy.yieldMaxPrice) {
      if (liq < config.strategy.yieldMinLiquidity && vol < config.strategy.yieldMinLiquidity) continue;
      if (days > config.strategy.yieldMaxDays || days <= 0) continue;

      const returnPct = ((1 / noPrice) - 1) * 100;
      const annualizedYield = calcAnnualizedYield(noPrice, days);
      const estimatedProb = Math.min(0.995, noPrice + 0.015);
      const kelly = calcQuarterKelly({ estimatedProb, marketPrice: noPrice, bankroll });

      if (kelly.fraction <= 0) continue;

      opportunities.push({
        type: 'YIELD_PLAY',
        subType: 'Near-Certainty NO',
        side: 'NO',
        question: market.question,
        platform: market.platform,
        url: market.url,
        action: `BUY NO @ ${(noPrice * 100).toFixed(1)}¢`,

        marketPrice: noPrice,
        costPerShare: noPrice,
        returnPerShare: parseFloat((1 - noPrice).toFixed(4)),
        returnPct: parseFloat(returnPct.toFixed(2)),
        annualizedYield,

        daysToResolve: parseFloat(days.toFixed(1)),
        endDate: market.endDate,

        kellyFraction: kelly.fraction,
        suggestedSize: Math.min(kelly.dollarAmount, bankroll * config.strategy.maxLossPerTrade),
        maxShares: Math.floor(Math.min(kelly.dollarAmount, bankroll * config.strategy.maxLossPerTrade) / noPrice),

        riskLevel: noPrice >= 0.97 ? 'VERY_LOW' : noPrice >= 0.95 ? 'LOW' : 'MEDIUM',
        maxLoss: `$${Math.min(kelly.dollarAmount, bankroll * config.strategy.maxLossPerTrade).toFixed(2)} (agar galat hua)`,
        tailRiskNote: `⚠️ Max loss capped at $${(bankroll * config.strategy.maxLossPerTrade).toFixed(0)} — isse zyada nahi jayega`,

        liquidity: liq,
        volume: vol,
        detectedAt: new Date().toISOString(),
      });
    }
  }

  // Sort by annualized yield (best bang for buck first)
  opportunities.sort((a, b) => b.annualizedYield - a.annualizedYield);

  const veryLow = opportunities.filter(o => o.riskLevel === 'VERY_LOW').length;
  const low = opportunities.filter(o => o.riskLevel === 'LOW').length;
  const medium = opportunities.filter(o => o.riskLevel === 'MEDIUM').length;

  logger.info(`[YieldPlay] Found ${opportunities.length} yield opportunities (VeryLow:${veryLow} Low:${low} Med:${medium})`);

  return opportunities;
}

module.exports = { detectYieldPlays, calcQuarterKelly, calcAnnualizedYield };
