const config = require('../config');
const logger = require('../utils/logger');

/**
 * Longshot Bias Strategy
 * ──────────────────────────────────────────────────────────────────
 * Psychology: Traders OVERPAY for unlikely events (big payout dream)
 * and UNDERPAY for near-certain events (boring small return).
 *
 * Edge:
 *   → Sell YES on longshots (overpriced, true prob lower)
 *   → Buy YES on near-certain favorites (underpriced)
 *
 * This scanner finds BOTH types of opportunities.
 */

/**
 * Fair value estimator using power law correction
 * Markets tend to overprice tails by ~15-20%
 */
function estimateFairValue(marketPrice) {
  if (marketPrice <= 0 || marketPrice >= 1) return marketPrice;

  // Power correction (calibrated from historical Polymarket data)
  // Underdogs inflated by ~1.15x, favorites deflated by ~0.95x
  if (marketPrice < 0.20) {
    return marketPrice / 1.18;  // True prob ~15-20% lower
  } else if (marketPrice > 0.80) {
    return Math.min(0.99, marketPrice / 0.96);  // True prob ~4% higher
  }
  return marketPrice;  // Mid-range roughly efficient
}

/**
 * Detect longshot (overpriced underdog) opportunities
 * → Action: Buy NO (or sell YES) on these markets
 */
function detectLongshots(markets) {
  const opportunities = [];

  for (const market of markets) {
    if (!market.active) continue;
    if (market.liquidity < config.strategy.minLiquidity) continue;

    const { yesPrice, noPrice } = market;

    // ── Longshot (YES overpriced) ─────────────────────────────────
    if (yesPrice < config.strategy.longshotThreshold) {
      const fairYes  = estimateFairValue(yesPrice);
      const edge     = yesPrice - fairYes;  // How much YES is overpriced
      const noEdge   = edge;                // Selling YES = buying NO edge

      if (noEdge >= config.strategy.minLongshotEdge) {
        // Expected value of buying NO
        const ev = noPrice - (1 - fairYes);

        opportunities.push({
          type:        'LONGSHOT_SELL',
          subType:     'Overpriced Underdog',
          question:    market.question,
          platform:    market.platform,
          url:         market.url,
          action:      'BUY NO (or sell YES)',
          reasoning:   `YES at ${(yesPrice * 100).toFixed(1)}¢ — crowd overestimates this underdog. Fair value ~${(fairYes * 100).toFixed(1)}¢`,
          marketPrice: yesPrice,
          fairValue:   parseFloat(fairYes.toFixed(4)),
          edge:        parseFloat((edge * 100).toFixed(2)),
          noPrice:     noPrice,
          ev:          parseFloat((ev * 100).toFixed(2)),
          liquidity:   market.liquidity,
          volume:      market.volume,
          endDate:     market.endDate,
          detectedAt:  new Date().toISOString(),
        });
      }
    }

    // ── Favorite (YES underpriced) ────────────────────────────────
    if (yesPrice > config.strategy.favoriteThreshold) {
      const fairYes  = estimateFairValue(yesPrice);
      const edge     = fairYes - yesPrice;  // How much YES is underpriced

      if (edge >= config.strategy.minLongshotEdge * 0.5) {  // Lower threshold for favorites
        const positionSize   = Math.min(config.strategy.maxPositionSize, 50);
        const expectedReturn = positionSize * (1 - yesPrice);  // Near certain $return

        opportunities.push({
          type:        'FAVORITE_BUY',
          subType:     'Underpriced Favorite',
          question:    market.question,
          platform:    market.platform,
          url:         market.url,
          action:      'BUY YES',
          reasoning:   `YES at ${(yesPrice * 100).toFixed(1)}¢ — near-certain outcome, crowd undervalues. Fair ~${(fairYes * 100).toFixed(1)}¢`,
          marketPrice: yesPrice,
          fairValue:   parseFloat(fairYes.toFixed(4)),
          edge:        parseFloat((edge * 100).toFixed(2)),
          positionSize,
          expectedReturn: parseFloat(expectedReturn.toFixed(2)),
          returnPct:   parseFloat(((1 / yesPrice - 1) * 100).toFixed(2)),
          liquidity:   market.liquidity,
          volume:      market.volume,
          endDate:     market.endDate,
          detectedAt:  new Date().toISOString(),
        });
      }
    }
  }

  opportunities.sort((a, b) => b.edge - a.edge);

  logger.info(`[Longshot] Found ${opportunities.filter(o => o.type === 'LONGSHOT_SELL').length} overpriced underdogs, ${opportunities.filter(o => o.type === 'FAVORITE_BUY').length} underpriced favorites`);

  return opportunities;
}

module.exports = { detectLongshots };
