const axios  = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

const api = axios.create({
  baseURL: config.kalshi.baseApi,
  timeout: 15_000,
  headers: { 
    'Content-Type': 'application/json',
    ...(config.kalshi.apiKey ? { 'X-API-Key': config.kalshi.apiKey } : {}),
  },
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

      // Rate limit safety
      await new Promise(r => setTimeout(r, 500));

      const markets = (body.markets || []).map(m => {
        // Kalshi prices are in cents (0-100), normalize to 0-1
        // Prefer last_price if available, fallback to mid-price
        const lastPrice = m.last_price ? m.last_price / 100 : null;
        const midPrice  = (m.yes_bid + m.yes_ask) / 2 / 100;
        const yesPrice  = lastPrice || midPrice;
        const noPrice   = 1 - yesPrice;

        // 🧠 Master Category Detection (Kalshi)
        const q = (m.title || '').toLowerCase();
        const ticker = (m.event_ticker || m.ticker || '').toLowerCase();
        let category = (m.category || 'General').toUpperCase();

        // High-overlap economic tickers
        const isEcon = /fed|cpi|gdp|jobs|unempl|fomc|rate|interest|inflation|recession|gas|funds|economic|debt|deficit|treasury|yield|cpx|indx/i.test(`${q} ${ticker}`);
        // High-overlap political tickers
        const isPoly = /trump|biden|election|president|vote|senate|congress|poll|confirm|shutdown|nominee|strait|war|conflict|israel|ukraine|china|iran|taiwan|pres-|sen-|hou-/i.test(`${q} ${ticker}`);
        // Crypto
        const isCrypto = /bitcoin|btc|eth|crypto|solana|sol|price|ledger|kraken|coinbase/i.test(`${q} ${ticker}`);

        if (isEcon || category === 'ECONOMICS' || category === 'FINANCIALS' || category === 'ECONOMY') category = 'ECONOMICS';
        else if (isPoly || category === 'POLITICS' || category === 'ELECTION' || category === 'POLITICAL') category = 'POLITICS';
        else if (isCrypto || category === 'CRYPTO') category = 'CRYPTO';
        else if (category === 'BUSINESS') category = 'ECONOMICS';

        return {
          platform:   'kalshi',
          id:         m.ticker,
          eventId:    m.event_ticker,
          slug:       m.ticker,
          question:   m.title,
          yesPrice:   parseFloat(yesPrice.toFixed(4)),
          noPrice:    parseFloat(noPrice.toFixed(4)),
          lastPrice:  lastPrice ? parseFloat(lastPrice.toFixed(4)) : null,
          yesBid:     m.yes_bid  / 100,
          yesAsk:     m.yes_ask  / 100,
          noBid:      m.no_bid   / 100,
          noAsk:      m.no_ask   / 100,
          spread:     parseFloat(((m.yes_ask - m.yes_bid) / 100).toFixed(4)),
          volume:     parseFloat(m.volume        || 0),
          volume24h:  parseFloat(m.volume_24h    || 0),
          liquidity:  parseFloat(m.open_interest || 0),
          endDate:    m.close_time,
          active:     m.status === 'open',
          url:        `https://kalshi.com/markets/${m.event_ticker}/${m.ticker}`,
          ticker:     m.ticker,
          category,
        };
      });

      allMarkets.push(...markets);
      cursor = body.cursor || null;

      // Safety: max 3000 markets
      if (allMarkets.length >= 3000) break;
    } while (cursor);

    logger.info(`[Kalshi] Fetched ${allMarkets.length} active markets`);
    return allMarkets;
  } catch (err) {
    logger.error(`[Kalshi] Fetch error: ${err.message}`);
    return [];
  }
}

async function fetchOrderbook(ticker) {
  try {
    const res = await api.get(`/markets/${ticker}/orderbook`);
    return res.data?.orderbook_fp || null;
  } catch (err) {
    logger.error(`[Kalshi] Orderbook fetch error (${ticker}): ${err.message}`);
    return null;
  }
}

/**
 * Fetch recent large trades (for whale tracking)
 * @returns {Promise<Array>}
 */
async function fetchRecentTrades({ minSize = 5000, limit = 100 } = {}) {
  try {
    // Kalshi trades endpoint
    const res = await api.get('/trades', {
      params: { limit, ticker: '' } // Global trades if ticker empty
    });

    const rawTrades = res.data?.trades || [];

    const trades = rawTrades
      .map(t => {
        const amount = (t.count * t.yes_price) / 100; // rough USD value
        return {
          platform: 'kalshi',
          type: 'trade',
          user: t.user_id || 'anonymous',
          marketId: t.ticker,
          question: t.ticker, // Kalshi doesn't give title in trade list
          side: t.side,
          amount: parseFloat(amount.toFixed(2)),
          price: t.yes_price / 100,
          timestamp: t.created_time,
        };
      })
      .filter(t => t.amount >= minSize);

    if (trades.length > 0) {
      logger.info(`[Kalshi] Fetched ${trades.length} whale trades (>$${minSize})`);
    }
    return trades;
  } catch (err) {
    logger.warn(`[Kalshi] Recent trades fetch error: ${err.message}`);
    return [];
  }
}

module.exports = { fetchMarkets, fetchOrderbook, fetchRecentTrades };
