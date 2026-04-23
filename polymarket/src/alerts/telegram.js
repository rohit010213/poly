const TelegramBot = require('node-telegram-bot-api');
const config = require('../config');
const logger = require('../utils/logger');

let bot = null;

function getBot() {
  if (!config.telegram.enabled) return null;
  if (!bot) {
    bot = new TelegramBot(config.telegram.botToken, { polling: false });
  }
  return bot;
}

/**
 * Send message to Telegram
 */
async function send(message, options = {}) {
  const b = getBot();
  if (!b) {
    logger.info(`[Telegram DISABLED] ${message.slice(0, 100)}`);
    return;
  }
  try {
    await b.sendMessage(config.telegram.chatId, message, {
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
      ...options,
    });
  } catch (err) {
    logger.error(`[Telegram] Send error: ${err.message}`);
  }
}

// ── Alert Formatters ──────────────────────────────────────────────

async function alertArbitrage(opp) {
  const msg = `
🔥 *ARBITRAGE DETECTED*
━━━━━━━━━━━━━━━━━━━━
📋 *Market:* ${opp.question?.slice(0, 80)}

*Polymarket:* Buy ${opp.poly.side} @ ${(opp.poly.price * 100).toFixed(1)}¢
[Open Market](${opp.poly.url})

*Kalshi:* Buy ${opp.kalshi.side} @ ${(opp.kalshi.price * 100).toFixed(1)}¢
[Open Market](${opp.kalshi.url})

💰 *Total Cost:* ${(opp.totalCost * 100).toFixed(1)}¢ (pays $1.00)
📈 *Profit:* +${opp.profitPct}% (after ${opp.feesConsidered}% fees)
💵 *Expected $:* +$${opp.expectedProfit} on $${opp.positionSize} bet
🎯 *Match Quality:* ${opp.matchQuality}

⏰ ${new Date().toLocaleTimeString()}
`;
  await send(msg);
}

async function alertLongshot(opp) {
  const emoji = opp.type === 'LONGSHOT_SELL' ? '📉' : '📈';
  const msg = `
${emoji} *${opp.type === 'LONGSHOT_SELL' ? 'OVERPRICED UNDERDOG' : 'UNDERPRICED FAVORITE'}*
━━━━━━━━━━━━━━━━━━━━
📋 *Market:* ${opp.question?.slice(0, 80)}
🏪 *Platform:* ${opp.platform}

*Action:* \`${opp.action}\`
*Current Price:* ${(opp.marketPrice * 100).toFixed(1)}¢
*Fair Value Est.:* ${(opp.fairValue * 100).toFixed(1)}¢
*Edge:* +${opp.edge}%

💡 *Why:* ${opp.reasoning}

${opp.type === 'FAVORITE_BUY'
      ? `💰 Expected Return: +$${opp.expectedReturn} (+${opp.returnPct}%)`
      : `💰 EV: ${opp.ev}%`}

[Open Market](${opp.url})
⏰ ${new Date().toLocaleTimeString()}
`;
  await send(msg);
}

async function alertWhale(signal) {
  const confidenceEmoji = signal.confidence === 'HIGH' ? '🐳' : '🐬';
  const msg = `
${confidenceEmoji} *WHALE SIGNAL* [${signal.confidence}]
━━━━━━━━━━━━━━━━━━━━
📋 *Market:* ${signal.question?.slice(0, 80)}

💸 *Trade:* ${signal.side} — $${signal.amount.toLocaleString()}
📍 *Price:* ${(signal.price * 100).toFixed(1)}¢
🦈 *Wallet:* \`${signal.whaleAddress?.slice(0, 12)}...\`

🎯 *Suggested:* ${signal.suggestedAction}
⚡ *${signal.urgency}*

💡 ${signal.reasoning}

⏰ ${new Date().toLocaleTimeString()}
`;
  await send(msg);
}

async function alertResolutionEdge(opp) {
  const patterns = opp.patterns.map(p => `${p.color} ${p.description}`).join('\n');
  const msg = `
🔍 *RESOLUTION EDGE* (Score: ${opp.edgeScore})
━━━━━━━━━━━━━━━━━━━━
📋 *Market:* ${opp.question?.slice(0, 80)}
🏪 *Platform:* ${opp.platform}

*YES:* ${(opp.yesPrice * 100).toFixed(1)}¢  |  *NO:* ${(opp.noPrice * 100).toFixed(1)}¢

*Patterns Detected:*
${patterns}

⚠️ ${opp.actionRequired}
[Open Market](${opp.url})
⏰ ${new Date().toLocaleTimeString()}
`;
  await send(msg);
}

async function alertScanSummary({ arbCount, longshotCount, whaleCount, resEdgeCount, newAlerts = 0, scanDurationMs }) {
  const hasOpps = arbCount + longshotCount + whaleCount + resEdgeCount > 0;
  const msg = `
📊 *${newAlerts > 0 ? `NEW ALERTS (${newAlerts})` : 'BOT ALIVE — Hourly Update'}*
━━━━━━━━━━━━━━━━━━━━
🔥 Arbitrage:     *${arbCount}*
📉 Longshot:      *${longshotCount}*
🐋 Whale:         *${whaleCount}*
🔍 Res. Edge:     *${resEdgeCount}*
━━━━━━━━━━━━━━━━━━━━
⏱ ${scanDurationMs}ms | ${new Date().toLocaleTimeString()}
`;
  await send(msg);
}

module.exports = {
  send,
  alertArbitrage,
  alertLongshot,
  alertWhale,
  alertResolutionEdge,
  alertScanSummary,
};