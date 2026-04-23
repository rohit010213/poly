require('dotenv').config();

const config = {
  polymarket: {
    gammaApi: 'https://gamma-api.polymarket.com',
    clobApi: 'https://clob.polymarket.com',
    dataApi: 'https://data-api.polymarket.com',
  },
  kalshi: {
    baseApi: 'https://api.elections.kalshi.com/trade-api/v2',
    apiKey: process.env.KALSHI_API_KEY || null,
    apiSecret: process.env.KALSHI_API_SECRET || null,
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || null,
    chatId: process.env.TELEGRAM_CHAT_ID || null,
    enabled: !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
  },
  strategy: {
    minArbProfit: parseFloat(process.env.MIN_ARB_PROFIT) || 0.02,
    minLongshotEdge: parseFloat(process.env.MIN_LONGSHOT_EDGE) || 0.05,
    minLiquidity: parseFloat(process.env.MIN_LIQUIDITY) || 500,
    minVolume: parseFloat(process.env.MIN_VOLUME) || 1000,
    maxPositionSize: parseFloat(process.env.MAX_POSITION_SIZE) || 100,
    whaleminTradeSize: parseFloat(process.env.WHALE_MIN_TRADE_SIZE) || 5000,
    longshotThreshold: 0.15,
    favoriteThreshold: 0.85,
  },
  scanner: {
    intervalSeconds: parseInt(process.env.SCAN_INTERVAL_SECONDS) || 30,
    marketsPerFetch: 500,
    fuzzyMatchScore: 0.6,
  },
  alerts: {
    resEdgeDedupTTL: 60 * 60 * 1000,
    mainDedupTTL: 10 * 60 * 1000,
    summaryOnlyWhenOpportunity: true,
    maxResEdgeAlertsPerScan: 1,
    minResEdgeScore: 4,
  },
};

module.exports = config;