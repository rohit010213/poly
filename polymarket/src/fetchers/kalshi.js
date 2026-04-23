const axios  = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

const api = axios.create({
  baseURL: config.kalshi.baseApi,
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
});

/**
 * Fetch active Kalshi markets (public endpoint - no auth needed)
 * @returns {Promise<Array>} normalized market list
 */
async function fetchMarkets() {
  try {
    const allMarkets = [];
    let cursor = null;

    // Paginate through results
    do {
      const params = { status: 'open', limit: 200 };
      if (cursor) params.cursor = cursor;

      const res = await api.get('/markets', { params });
      const body = res.data;

      const markets = (body.markets || []).map(m => {
        // Kalshi prices are in cents (0-100), normalize to 0-1
        const yesPrice = (m.yes_bid + m.yes_ask) / 2 / 100;
        const noPrice  = 1 - yesPrice;

        return {
          platform:   'kalshi',
          id:         m.ticker,
          eventId:    m.event_ticker,
          slug:       m.ticker,
          question:   m.title,
          yesPrice:   parseFloat(yesPrice.toFixed(4)),
          noPrice:    parseFloat(noPrice.toFixed(4)),
          yesBid:     m.yes_bid  / 100,
          yesAsk:     m.yes_ask  / 100,
          noBid:      m.no_bid   / 100,
          noAsk:      m.no_ask   / 100,
          volume:     parseFloat(m.volume        || 0),
          liquidity:  parseFloat(m.open_interest || 0),
          endDate:    m.close_time,
          active:     m.status === 'open',
          url:        `https://kalshi.com/markets/${m.event_ticker}`,
          ticker:     m.ticker,
        };
      });

      allMarkets.push(...markets);
      cursor = body.cursor || null;

      // Safety: max 5 pages
      if (allMarkets.length > 1000) break;
    } while (cursor);

    logger.info(`[Kalshi] Fetched ${allMarkets.length} active markets`);
    return allMarkets;
  } catch (err) {
    logger.error(`[Kalshi] Fetch error: ${err.message}`);
    return [];
  }
}

/**
 * Fetch orderbook for a specific market
 * @param {string} ticker - e.g. "INXD-23DEC29-T4600"
 */
async function fetchOrderbook(ticker) {
  try {
    const res = await api.get(`/markets/${ticker}/orderbook`);
    return res.data?.orderbook_fp || null;
  } catch (err) {
    logger.error(`[Kalshi] Orderbook fetch error (${ticker}): ${err.message}`);
    return null;
  }
}

module.exports = { fetchMarkets, fetchOrderbook };
