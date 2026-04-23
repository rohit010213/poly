require('dotenv').config();

const config = {
  // ── Polymarket API Endpoints ──────────────────────────────
  polymarket: {
    gammaApi: 'https://gamma-api.polymarket.com',
    clobApi:  'https://clob.polymarket.com',
    dataApi:  'https://data-api.polymarket.com',
  },

  // ── Kalshi API Endpoints ──────────────────────────────────
  kalshi: {
    baseApi: 'https://api.elections.kalshi.com/trade-api/v2',
    apiKey:    process.env.KALSHI_API_KEY    || null,
    apiSecret: process.env.KALSHI_API_SECRET || null,
  },

  // ── Telegram ──────────────────────────────────────────────
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || null,
    chatId:   process.env.TELEGRAM_CHAT_ID   || null,
    enabled:  !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
  },

  // ── Strategy Thresholds ───────────────────────────────────
  strategy: {
    minArbProfit:      parseFloat(process.env.MIN_ARB_PROFIT)      || 0.03,  // 3%
    minLongshotEdge:   parseFloat(process.env.MIN_LONGSHOT_EDGE)   || 0.08,  // 8%
    minLiquidity:      parseFloat(process.env.MIN_LIQUIDITY)       || 5000,  // $5k
    maxPositionSize:   parseFloat(process.env.MAX_POSITION_SIZE)   || 100,
    whaleminTradeSize: parseFloat(process.env.WHALE_MIN_TRADE_SIZE) || 5000,
    // Longshot: if YES price < this, market is considered a longshot
    longshotThreshold: 0.15,
    // Favorite: if YES price > this, market is near-certain favorite
    favoriteThreshold: 0.85,
  },

  // ── Scanner ───────────────────────────────────────────────
  scanner: {
    intervalSeconds: parseInt(process.env.SCAN_INTERVAL_SECONDS) || 30,
    marketsPerFetch: 100,
    // Fuzzy match score threshold for market pairing (0-1, lower = stricter)
    fuzzyMatchScore: 0.35,
  },
};

module.exports = config;
