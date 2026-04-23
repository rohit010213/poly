const config = require('../config');
const logger = require('../utils/logger');

// In-memory store: whaleAddress → trade history
const whaleHistory = new Map();

// Known profitable whale wallets (update these from Polymarket leaderboard)
// These are example addresses - replace with real ones from dune.com
const KNOWN_WHALES = new Set([
  // Add top leaderboard addresses here after running fetchLeaderboard()
]);

/**
 * Score a wallet's reliability based on history
 * @param {Array} history - past trades for this wallet
 */
function computeWhaleScore(history) {
  if (!history || history.length < 3) return 0;

  const wins    = history.filter(t => t.resolved && t.won).length;
  const total   = history.filter(t => t.resolved).length;
  const winRate = total > 0 ? wins / total : 0;

  const avgSize = history.reduce((s, t) => s + t.amount, 0) / history.length;

  // Score = winRate * log(avgSize) normalized
  return parseFloat((winRate * Math.log10(avgSize + 1)).toFixed(3));
}

/**
 * Process new trades and detect whale signals
 * @param {Array} trades - from polymarket.fetchRecentTrades()
 * @param {Array} leaderboard - from polymarket.fetchLeaderboard()
 * @returns {Array} whale signals
 */
function detectWhaleSignals(trades, leaderboard = []) {
  const signals = [];

  // Build set of known profitable addresses from leaderboard
  const topAddresses = new Set(leaderboard.slice(0, 20).map(u => u.address));

  for (const trade of trades) {
    const { user, amount, side, question, price, marketId, timestamp } = trade;
    if (!user || amount < config.strategy.whaleminTradeSize) continue;

    // Update history
    if (!whaleHistory.has(user)) whaleHistory.set(user, []);
    whaleHistory.get(user).push(trade);

    const isKnownWhale = KNOWN_WHALES.has(user) || topAddresses.has(user);
    const history      = whaleHistory.get(user);
    const whaleScore   = computeWhaleScore(history);
    const confidence   = isKnownWhale ? 'HIGH' : whaleScore > 1.5 ? 'MEDIUM' : 'LOW';

    if (confidence === 'LOW' && !isKnownWhale) continue;

    signals.push({
      type:       'WHALE_SIGNAL',
      confidence,
      whaleAddress: user,
      isKnownWhale,
      whaleScore,

      // Trade info
      question,
      marketId,
      action:   `BUY ${side}`,
      side,
      price:    parseFloat(price),
      amount:   parseFloat(amount),
      platform: 'polymarket',

      reasoning: isKnownWhale
        ? `Known top-${leaderboard.findIndex(u => u.address === user) + 1} leaderboard whale bought ${side} $${amount}`
        : `High-score wallet (${whaleScore}) placed $${amount} on ${side}`,

      // Suggested action
      suggestedAction: `Mirror: Buy ${side} at ~${(price * 100).toFixed(1)}¢`,
      urgency: 'ACT FAST — prices move within minutes of whale moves',

      tradeCount:  history.length,
      timestamp:   timestamp || new Date().toISOString(),
      detectedAt:  new Date().toISOString(),
    });
  }

  if (signals.length > 0) {
    logger.warn(`[WhaleTracker] 🐋 Detected ${signals.length} whale signals!`);
  } else {
    logger.info(`[WhaleTracker] No whale signals above $${config.strategy.whaleminTradeSize}`);
  }

  return signals;
}

/**
 * Add a wallet to known whales manually
 */
function addKnownWhale(address) {
  KNOWN_WHALES.add(address);
  logger.info(`[WhaleTracker] Added whale: ${address}`);
}

module.exports = { detectWhaleSignals, addKnownWhale, whaleHistory };
