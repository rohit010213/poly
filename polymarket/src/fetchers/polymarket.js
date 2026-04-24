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
    const res = await gamma.get('/markets', {
      params: {
        active: true,
        closed: false,
        limit: config.scanner.marketsPerFetch,
      },
    });

    const rawMarkets = res.data || [];
    const markets = [];

    for (const m of rawMarkets) {
      try {
        const outcomes = JSON.parse(m.outcomes || '[]');
        const prices = JSON.parse(m.outcomePrices || '[]');

        const yesIdx = outcomes.findIndex(o => o.toLowerCase() === 'yes');
        const noIdx = outcomes.findIndex(o => o.toLowerCase() === 'no');

        const yesPrice = yesIdx !== -1 ? parseFloat(prices[yesIdx]) : null;
        const noPrice = noIdx !== -1 ? parseFloat(prices[noIdx]) : null;

        if (!yesPrice || !noPrice) continue;

        // Robust Category Detection
        const q = m.question?.toLowerCase() || '';
        let category = (m.category || 'General').toUpperCase();
        
        if (category === 'GENERAL') {
          if (/bitcoin|btc|eth|crypto|solana|sol|price/i.test(q)) category = 'CRYPTO';
          else if (/fed|rate|cpi|inflation|gdp|jobs|unemployment|fomc|treasury/i.test(q)) category = 'ECONOMICS';
          else if (/trump|biden|election|president|vote|senate|congress|poll/i.test(q)) category = 'POLITICS';
        }

        markets.push({
          platform: 'polymarket',
          id: m.id,
          eventId: m.groupItemTitle || m.conditionId,
          slug: m.slug,
          question: m.question,
          yesPrice,
          noPrice,
          volume: parseFloat(m.volume || 0),
          volume24h: parseFloat(m.volume24hr || 0),
          liquidity: parseFloat(m.liquidity || 0),
          endDate: m.endDate,
          active: m.active && !m.closed,
          url: `https://polymarket.com/market/${m.slug}`,
          clobTokenIds: JSON.parse(m.clobTokenIds || '[]'),
          category,
          lastPrice: m.lastTradePrice ? parseFloat(m.lastTradePrice) : null,
        });
      } catch (e) {
        // skip malformed
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