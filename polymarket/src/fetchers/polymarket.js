const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

const gamma = axios.create({
  baseURL: config.polymarket.gammaApi,
  timeout: 15_000,
});

const data = axios.create({
  baseURL: config.polymarket.dataApi,
  timeout: 15_000,
});

/**
 * Fetch all active Polymarket events with prices
 * @returns {Promise<Array>} normalized market list
 */
async function fetchMarkets() {
  try {
    const res = await gamma.get('/events', {
      params: {
        active: true,
        closed: false,
        limit: config.scanner.marketsPerFetch,
      },
    });

    const events = res.data || [];
    const markets = [];

    for (const event of events) {
      if (!event.markets) continue;

      for (const market of event.markets) {
        try {
          const prices = JSON.parse(market.outcomePrices || '[]');
          const outcomes = JSON.parse(market.outcomes || '[]');
          const yesIdx = outcomes.findIndex(o => o.toLowerCase() === 'yes');
          const noIdx = outcomes.findIndex(o => o.toLowerCase() === 'no');

          const yesPrice = yesIdx !== -1 ? parseFloat(prices[yesIdx]) : null;
          const noPrice = noIdx !== -1 ? parseFloat(prices[noIdx]) : null;

          if (!yesPrice || !noPrice) continue;

          markets.push({
            platform: 'polymarket',
            id: market.id,
            eventId: event.id,
            slug: market.slug || event.slug,
            question: market.question || event.title,
            yesPrice,
            noPrice,
            volume: parseFloat(market.volume || 0),
            liquidity: parseFloat(market.liquidity || 0),
            endDate: market.endDate || event.endDate,
            active: market.active,
            url: `https://polymarket.com/event/${event.slug}`,
            clobTokenIds: market.clobTokenIds || [],
            conditionId: market.conditionId,
          });
        } catch (parseErr) {
          // skip malformed market
        }
      }
    }

    logger.info(`[Polymarket] Fetched ${markets.length} active markets`);
    return markets;
  } catch (err) {
    logger.error(`[Polymarket] Fetch error: ${err.message}`);
    return [];
  }
}

/**
 * Fetch recent large trades (for whale tracking)
 * Uses correct Polymarket Data API endpoint
 * @returns {Promise<Array>}
 */
async function fetchRecentTrades({ minSize = 5000, limit = 100 } = {}) {
  try {
    // Correct endpoint: /trades with taker_amount filter
    const res = await data.get('/trades', {
      params: {
        limit,
        taker_amount_min: minSize,
      },
    });

    const rawTrades = Array.isArray(res.data) ? res.data : (res.data?.data || []);

    const trades = rawTrades
      .filter(t => {
        const amt = parseFloat(t.size || t.amount || t.usdcSize || 0);
        return amt >= minSize;
      })
      .map(t => ({
        platform: 'polymarket',
        type: 'trade',
        user: t.maker || t.taker || t.trader,
        marketId: t.market || t.conditionId,
        question: t.title || t.question,
        side: t.outcome || t.side,
        amount: parseFloat(t.size || t.usdcSize || t.amount || 0),
        price: parseFloat(t.price || 0),
        timestamp: t.timestamp || t.createdAt,
      }));

    logger.info(`[Polymarket] Fetched ${trades.length} whale trades (>$${minSize})`);
    return trades;
  } catch (err) {
    // Non-critical — whale tracking optional
    logger.warn(`[Polymarket] Whale fetch skipped: ${err.message}`);
    return [];
  }
}

/**
 * Fetch top trader profiles from Polymarket leaderboard
 * @returns {Promise<Array>}
 */
async function fetchLeaderboard({ limit = 20 } = {}) {
  try {
    // Correct endpoint
    const res = await data.get('/leaderboard', {
      params: { limit, window: 'all' },
    });

    const raw = Array.isArray(res.data) ? res.data : (res.data?.data || res.data?.leaderboard || []);

    return raw.slice(0, limit).map(u => ({
      platform: 'polymarket',
      address: u.proxyWallet || u.address || u.name,
      pnl: parseFloat(u.pnl || u.profit || 0),
      volume: parseFloat(u.volume || 0),
    }));
  } catch (err) {
    // Non-critical — leaderboard optional
    logger.warn(`[Polymarket] Leaderboard skipped: ${err.message}`);
    return [];
  }
}

module.exports = { fetchMarkets, fetchRecentTrades, fetchLeaderboard };