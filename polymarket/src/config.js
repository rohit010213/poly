require('dotenv').config();

const config = {
  polymarket: {
    gammaApi: 'https://gamma-api.polymarket.com',
    clobApi: 'https://clob.polymarket.com',
    dataApi: 'https://data-api.polymarket.com',
    // CLOB Auth (Required for Phase 3 Market Making)
    accessKey: process.env.POLY_ACCESS_KEY || null,
    secret: process.env.POLY_SECRET || null,
    passphrase: process.env.POLY_PASSPHRASE || null,
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
    // ── Existing ──────────────────────────────────────────────
    minArbProfit: parseFloat(process.env.MIN_ARB_PROFIT) || 0.02,
    minLongshotEdge: parseFloat(process.env.MIN_LONGSHOT_EDGE) || 0.05,
    minLiquidity: parseFloat(process.env.MIN_LIQUIDITY) || 500,
    minVolume: parseFloat(process.env.MIN_VOLUME) || 1000,
    maxPositionSize: parseFloat(process.env.MAX_POSITION_SIZE) || 100,
    whaleminTradeSize: parseFloat(process.env.WHALE_MIN_TRADE_SIZE) || 5000,
    longshotThreshold: 0.15,
    favoriteThreshold: 0.85,

    // ── Yield Play (SAFE MODE) ────────────────────────────────
    yieldMinPrice: parseFloat(process.env.YIELD_MIN_PRICE) || 0.95,   // 95¢+ only (safe)
    yieldMaxPrice: parseFloat(process.env.YIELD_MAX_PRICE) || 0.99,
    yieldMaxDays: parseFloat(process.env.YIELD_MAX_DAYS) || 7,        // Max 7 days
    yieldMinLiquidity: parseFloat(process.env.YIELD_MIN_LIQUIDITY) || 5000,
    bankroll: parseFloat(process.env.BANKROLL) || 500,

    // ── Overreaction Fade ────────────────────────────────────
    fadeMinPriceMove: parseFloat(process.env.FADE_MIN_PRICE_MOVE) || 10,
    fadeMinVolumeSpike: parseFloat(process.env.FADE_MIN_VOLUME_SPIKE) || 5,
    fadeMinLiquidity: parseFloat(process.env.FADE_MIN_LIQUIDITY) || 10000,

    // ── Volume Spike ─────────────────────────────────────────
    volumeSpikeMinMultiplier: parseFloat(process.env.VOL_SPIKE_MIN_MULT) || 10,
    volumeSpikeMinAbsolute: parseFloat(process.env.VOL_SPIKE_MIN_ABS) || 50000,
    volumeSpikeMinLiquidity: parseFloat(process.env.VOL_SPIKE_MIN_LIQ) || 10000,

    // ── SAFE MODE — Risk Caps ─────────────────────────────────
    // Max loss per trade = 5% of bankroll (strict cap)
    maxLossPerTrade: parseFloat(process.env.MAX_LOSS_PER_TRADE) || 0.05,
    // Max total open exposure = 30% of bankroll at any time
    maxTotalExposure: parseFloat(process.env.MAX_TOTAL_EXPOSURE) || 0.30,
    // Only show LOW or VERY_LOW risk trades in alerts
    safeMode: process.env.SAFE_MODE !== 'false',  // ON by default

    // ── Research Trade (Top Trader Strategy) ──────────────────
    researchMaxHours: parseFloat(process.env.RESEARCH_MAX_HOURS) || 336, // 14 days
    researchMinScore: parseFloat(process.env.RESEARCH_MIN_SCORE) || 1,   // Min research potential
  },
  scanner: {
    intervalSeconds: parseInt(process.env.SCAN_INTERVAL_SECONDS) || 30,
    marketsPerFetch: 2000,
    fuzzyMatchScore: 0.4,
  },
  alerts: {
    resEdgeDedupTTL: 60 * 60 * 1000,
    mainDedupTTL: 10 * 60 * 1000,
    summaryOnlyWhenOpportunity: true,
    maxResEdgeAlertsPerScan: 1,
    minResEdgeScore: 4,
    yieldDedupTTL: 30 * 60 * 1000,
    fadeDedupTTL: 5 * 60 * 1000,
    volumeSpikeDedupTTL: 15 * 60 * 1000,
    researchDedupTTL: 60 * 60 * 1000,      // 1 hour (user needs time to research)
  },
};

module.exports = config;