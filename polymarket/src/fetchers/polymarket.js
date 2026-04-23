const axios  = require('axios');
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
          const prices    = JSON.parse(market.outcomePrices || '[]');
          const outcomes  = JSON.parse(market.outcomes      || '[]');
          const yesIdx    = outcomes.findIndex(o => o.toLowerCase() === 'yes');
          const noIdx     = outcomes.findIndex(o => o.toLowerCase() === 'no');

          const yesPrice  = yesIdx !== -1 ? parseFloat(prices[yesIdx]) : null;
          const noPrice   = noIdx  !== -1 ? parseFloat(prices[noIdx])  : null;

          if (!yesPrice || !noPrice) continue;

          markets.push({
            platform:    'polymarket',
            id:          market.id,
            eventId:     event.id,
            slug:        market.slug || event.slug,
            question:    market.question || event.title,
            yesPrice,
            noPrice,
            volume:      parseFloat(market.volume  || 0),
            liquidity:   parseFloat(market.liquidity || 0),
            endDate:     market.endDate || event.endDate,
            active:      market.active,
            url:         `https://polymarket.com/event/${event.slug}`,
            clobTokenIds: market.clobTokenIds || [],
            conditionId:  market.conditionId,
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
 * @returns {Promise<Array>}
 */
async function fetchRecentTrades({ minSize = 5000, limit = 50 } = {}) {
  try {
    const res = await data.get('/activity', {
      params: { limit, type: 'TRADE' },
    });

    const trades = (res.data?.data || [])
      .filter(t => parseFloat(t.amount || 0) >= minSize)
      .map(t => ({
        platform:   'polymarket',
        type:       'trade',
        user:       t.proxyWallet || t.user,
        marketId:   t.market,
        question:   t.title,
        side:       t.side,         // YES / NO
        amount:     parseFloat(t.amount),
        price:      parseFloat(t.price),
        timestamp:  t.timestamp,
      }));

    logger.info(`[Polymarket] Fetched ${trades.length} whale trades (>$${minSize})`);
    return trades;
  } catch (err) {
    logger.error(`[Polymarket] Whale fetch error: ${err.message}`);
    return [];
  }
}

/**
 * Fetch top trader profiles (leaderboard)
 * @returns {Promise<Array>}
 */
async function fetchLeaderboard({ limit = 20 } = {}) {
  try {
    const res = await data.get('/leaderboard', { params: { limit } });
    return (res.data?.data || []).map(u => ({
      platform: 'polymarket',
      address:  u.proxyWallet || u.name,
      pnl:      parseFloat(u.pnl || 0),
      volume:   parseFloat(u.volume || 0),
    }));
  } catch (err) {
    logger.error(`[Polymarket] Leaderboard fetch error: ${err.message}`);
    return [];
  }
}

module.exports = { fetchMarkets, fetchRecentTrades, fetchLeaderboard };
