const config = require('../config');
const logger = require('../utils/logger');

function estimateFairValue(marketPrice) {
  if (marketPrice <= 0 || marketPrice >= 1) return marketPrice;
  if (marketPrice < 0.20) return marketPrice / 1.18;
  if (marketPrice > 0.80) return Math.min(0.99, marketPrice / 0.96);
  return marketPrice;
}

// Market qualify karne ke liye: liquidity OR volume enough hona chahiye
function hasEnoughActivity(market) {
  const liq = parseFloat(market.liquidity || 0);
  const vol = parseFloat(market.volume || 0);
  return liq >= config.strategy.minLiquidity || vol >= config.strategy.minVolume;
}

function detectLongshots(markets) {
  const opportunities = [];

  for (const market of markets) {
    if (!market.active) continue;
    if (!hasEnoughActivity(market)) continue;

    const { yesPrice, noPrice } = market;
    if (!yesPrice || !noPrice) continue;

    // ── Longshot: YES overpriced ──────────────────────────────
    if (yesPrice < config.strategy.longshotThreshold) {
      const fairYes = estimateFairValue(yesPrice);
      const edge = yesPrice - fairYes;
      const noEdge = edge;

      if (noEdge >= config.strategy.minLongshotEdge) {
        const ev = noPrice - (1 - fairYes);
        opportunities.push({
          type: 'LONGSHOT_SELL',
          subType: 'Overpriced Underdog',
          question: market.question,
          platform: market.platform,
          url: market.url,
          action: 'BUY NO (underdog is overpriced)',
          reasoning: `YES at ${(yesPrice * 100).toFixed(1)}¢ — crowd overestimates. Fair ~${(fairYes * 100).toFixed(1)}¢`,
          marketPrice: yesPrice,
          fairValue: parseFloat(fairYes.toFixed(4)),
          edge: parseFloat((edge * 100).toFixed(2)),
          noPrice,
          ev: parseFloat((ev * 100).toFixed(2)),
          liquidity: market.liquidity,
          volume: market.volume,
          endDate: market.endDate,
          detectedAt: new Date().toISOString(),
        });
      }
    }

    // ── Favorite: YES underpriced ─────────────────────────────
    if (yesPrice > config.strategy.favoriteThreshold) {
      const fairYes = estimateFairValue(yesPrice);
      const edge = fairYes - yesPrice;

      if (edge >= config.strategy.minLongshotEdge * 0.5) {
        const positionSize = Math.min(config.strategy.maxPositionSize, 50);
        const expectedReturn = positionSize * (1 - yesPrice);
        opportunities.push({
          type: 'FAVORITE_BUY',
          subType: 'Underpriced Favorite',
          question: market.question,
          platform: market.platform,
          url: market.url,
          action: 'BUY YES (near-certain outcome)',
          reasoning: `YES at ${(yesPrice * 100).toFixed(1)}¢ — nearly certain, crowd undervalues. Fair ~${(fairYes * 100).toFixed(1)}¢`,
          marketPrice: yesPrice,
          fairValue: parseFloat(fairYes.toFixed(4)),
          edge: parseFloat((edge * 100).toFixed(2)),
          positionSize,
          expectedReturn: parseFloat(expectedReturn.toFixed(2)),
          returnPct: parseFloat(((1 / yesPrice - 1) * 100).toFixed(2)),
          liquidity: market.liquidity,
          volume: market.volume,
          endDate: market.endDate,
          detectedAt: new Date().toISOString(),
        });
      }
    }
  }

  opportunities.sort((a, b) => b.edge - a.edge);
  logger.info(`[Longshot] Found ${opportunities.filter(o => o.type === 'LONGSHOT_SELL').length} overpriced underdogs, ${opportunities.filter(o => o.type === 'FAVORITE_BUY').length} underpriced favorites`);
  return opportunities;
}

module.exports = { detectLongshots };