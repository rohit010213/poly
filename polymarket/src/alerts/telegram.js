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

// ── Helpers ───────────────────────────────────────────────────────

function riskBadge(level) {
  if (level === 'VERY_LOW') return '🟢 SAFE';
  if (level === 'LOW') return '🟡 LOW RISK';
  if (level === 'MEDIUM') return '🟠 MEDIUM RISK';
  return '🔴 HIGH RISK';
}

function formatMoney(n) {
  return typeof n === 'number' ? `$${n.toFixed(2)}` : `$${n}`;
}

function timeLabel(days) {
  if (days < 1) return 'Aaj resolve hoga ✅';
  if (days < 2) return 'Kal resolve hoga ✅';
  if (days <= 3) return `${Math.ceil(days)} din mein resolve ✅`;
  return `${Math.ceil(days)} din mein resolve`;
}

// ══════════════════════════════════════════════════════════════════
//  YIELD PLAY — Low Risk, Quick Resolve (MAIN STRATEGY)
// ══════════════════════════════════════════════════════════════════

async function alertYieldPlay(opp) {
  const maxLossDollars = opp.suggestedSize || (config.strategy.bankroll * 0.05);

  const msg = `
🏦 *SAFE TRADE ALERT* ${riskBadge(opp.riskLevel)}
━━━━━━━━━━━━━━━━━━━━━━━━━

📂 *SECTION:* 🏦 **YIELD PLAY** (Near-Certainty)
📋 *Market:* ${opp.question?.slice(0, 100)}

━━━ *KYA KARNA HAI:* ━━━
👉 *${opp.side} pe click karo* @ ${(opp.marketPrice * 100).toFixed(1)}¢
💰 *Kitna lagao:* ${formatMoney(Math.min(maxLossDollars, opp.suggestedSize || 25))}
📦 *Kitne shares:* ${opp.maxShares || Math.floor(25 / opp.marketPrice)}

━━━ *KYU KARNA HAI:* ━━━
${opp.side === 'YES'
    ? `✅ Is market mein YES hone ki probability *${(opp.marketPrice * 100).toFixed(0)}%* hai\n📊 Market already ${(opp.marketPrice * 100).toFixed(0)}% confident hai ki YES hoga\n💡 Jab YES resolve hoga toh har share pe *${(opp.returnPerShare * 100).toFixed(1)}¢ profit* milega`
    : `❌ Is market mein cheez NAHI hogi — probability sirf *${((1 - opp.marketPrice) * 100).toFixed(0)}%* hai ki hoga\n📊 ${(opp.marketPrice * 100).toFixed(0)}% crowd kehta hai NAHI hoga\n💡 Jab NO resolve hoga toh har share pe *${(opp.returnPerShare * 100).toFixed(1)}¢ profit* milega`}

━━━ *NUMBERS:* ━━━
📈 *Return:* +${opp.returnPct}% per trade
📈 *APY:* ${opp.annualizedYield}%
⏰ *${timeLabel(opp.daysToResolve)}*
🛡️ *Max Loss:* ${formatMoney(Math.min(maxLossDollars, opp.suggestedSize || 25))} (agar galat hua)

━━━ *RISK:* ━━━
${opp.riskLevel === 'VERY_LOW'
    ? '🟢 *95%+ chances jeetne ke* — bahut safe'
    : '🟡 *90%+ chances jeetne ke* — safe hai par 100% nahi'}
⚠️ Agar BLACK SWAN event ho toh full amount loss ho sakta hai
💡 *Isliye* chhota amount lagao aur 3-4 markets mein divide karo

[👉 MARKET LINK — CLICK KARO](${opp.url})
⏰ ${new Date().toLocaleTimeString()}
`;
  await send(msg);
}

// ══════════════════════════════════════════════════════════════════
//  ARBITRAGE — Risk-Free (needs 2 platforms)
// ══════════════════════════════════════════════════════════════════

async function alertArbitrage(opp) {
  const msg = `
🔥 *GUARANTEED PROFIT ALERT* 🟢 RISK-FREE
━━━━━━━━━━━━━━━━━━━━━━━━━

📂 *SECTION:* 🔥 **ARBITRAGE** (Cross-Platform)
📋 *Market:* ${opp.question?.slice(0, 80)}

━━━ *KYA KARNA HAI (2 Steps):* ━━━

*STEP 1 — POLYMARKET:*
👉 *${opp.poly.side} kharido* @ ${(opp.poly.price * 100).toFixed(1)}¢
🔗 [POLYMARKET LINK — CLICK KARO](${opp.poly.url})

*STEP 2 — KALSHI:*
👉 *${opp.kalshi.side} kharido* @ ${(opp.kalshi.price * 100).toFixed(1)}¢
🔗 [KALSHI LINK — CLICK KARO](${opp.kalshi.url})

━━━ *VERIFY KARO (trade se pehle):* ━━━
✅ Poly pe ${opp.poly.side} price check: *${(opp.poly.price * 100).toFixed(1)}¢ ya kaam?*
✅ Kalshi pe ${opp.kalshi.side} price check: *${(opp.kalshi.price * 100).toFixed(1)}¢ ya kaam?*
✅ Dono milake *$1 se kaam* hona chahiye
❌ Agar prices change ho gaye → SKIP

━━━ *KYU KARNA HAI:* ━━━
💡 Dono platforms pe ek hi cheez ka price alag hai
🧮 Total cost: *${(opp.totalCost * 100).toFixed(1)}¢* (dono milake)
💰 Payout: *$1.00* chahe kuch bhi ho!
📈 *Profit: +${opp.profitPct}%* (fees ${opp.feesConsidered}% ke baad)

━━━ *KITNA LAGAO:* ━━━
💵 *${formatMoney(opp.positionSize)}* dono pe equally
📈 Expected profit: *+${formatMoney(opp.expectedProfit)}*
🛡️ *Risk: ZERO* — ek side toh ZAROOR jeetega!
🎯 Match: ${opp.matchQuality}

⚠️ *DONO PLATFORM PE SAME TIME PE TRADE KARO!*
⏰ ${new Date().toLocaleTimeString()}
`;
  await send(msg);
}

// ══════════════════════════════════════════════════════════════════
//  LONGSHOT — Overpriced/Underpriced Detection
// ══════════════════════════════════════════════════════════════════

async function alertLongshot(opp) {
  const emoji = opp.type === 'LONGSHOT_SELL' ? '📉' : '📈';
  const isSell = opp.type === 'LONGSHOT_SELL';

  const msg = `
${emoji} *${isSell ? 'OVERPRICED MARKET' : 'UNDERPRICED FAVORITE'}*
━━━━━━━━━━━━━━━━━━━━━━━━━

📂 *SECTION:* 📈 **LONGSHOT / FAVORITE**
📋 *Market:* ${opp.question?.slice(0, 80)}

━━━ *KYA KARNA HAI:* ━━━
👉 *${isSell ? 'NO kharido' : 'YES kharido'}* @ ${(opp.marketPrice * 100).toFixed(1)}¢

━━━ *KYU KARNA HAI:* ━━━
${isSell
    ? `📊 YES abhi ${(opp.marketPrice * 100).toFixed(1)}¢ pe hai — lekin real value sirf ~${(opp.fairValue * 100).toFixed(1)}¢ hai\n💡 Log overestimate kar rahe hain ki yeh hoga\n📈 NO lene se tujhe *+${opp.edge}% edge* milegi`
    : `📊 YES abhi ${(opp.marketPrice * 100).toFixed(1)}¢ pe hai — lekin asliyat mein ~${(opp.fairValue * 100).toFixed(1)}¢ ke qareeb hai\n💡 Yeh almost pakka hai — crowd undervalue kar raha hai\n📈 YES lene se tujhe *+${opp.edge}% edge* milegi`}

${opp.type === 'FAVORITE_BUY'
    ? `💰 Expected: +$${opp.expectedReturn} (+${opp.returnPct}%)`
    : `💰 EV: ${opp.ev}%`}
⚠️ Max *$${Math.min(config.strategy.bankroll * 0.05, 25).toFixed(0)}* lagana — zyada nahi

[👉 MARKET LINK](${opp.url})
⏰ ${new Date().toLocaleTimeString()}
`;
  await send(msg);
}

// ══════════════════════════════════════════════════════════════════
//  WHALE — Smart Money Following
// ══════════════════════════════════════════════════════════════════

async function alertWhale(signal) {
  const msg = `
🐋 *WHALE ALERT* [${signal.confidence}]
━━━━━━━━━━━━━━━━━━━━━━━━━

📂 *SECTION:* 🐋 **WHALE TRACKER**
📋 *Market:* ${signal.question?.slice(0, 80)}

━━━ *KYA HUA:* ━━━
💸 Ek bada trader ne *$${signal.amount.toLocaleString()}* laga diye ${signal.side} pe
📍 Price: ${(signal.price * 100).toFixed(1)}¢

━━━ *KYA KARNA HAI:* ━━━
👉 *${signal.side} kharido* (whale ke saath jao)
💰 Max *$${Math.min(config.strategy.bankroll * 0.03, 15).toFixed(0)}* lagana (chhota amount!)

━━━ *KYU KARNA HAI:* ━━━
💡 ${signal.reasoning}
🎯 Bade traders ke paas zyada information hoti hai
⚠️ *Par dhyan rakh:* whale galat bhi ho sakta hai — chhota bet rakh

⏰ ${new Date().toLocaleTimeString()}
`;
  await send(msg);
}

// ══════════════════════════════════════════════════════════════════
//  RESOLUTION EDGE — Contract Wording Opportunity
// ══════════════════════════════════════════════════════════════════

async function alertResolutionEdge(opp) {
  const patterns = opp.patterns.map(p => `${p.color} ${p.description}`).join('\n');
  const msg = `
🔍 *RESOLUTION EDGE* (Score: ${opp.edgeScore})
━━━━━━━━━━━━━━━━━━━━━━━━━

📋 *Market:* ${opp.question?.slice(0, 80)}

*YES:* ${(opp.yesPrice * 100).toFixed(1)}¢  |  *NO:* ${(opp.noPrice * 100).toFixed(1)}¢

*Patterns:*
${patterns}

⚠️ *PEHLE resolution rules padho* — trade se pehle samjho ki market kaise resolve hoga
[👉 MARKET LINK](${opp.url})
⏰ ${new Date().toLocaleTimeString()}
`;
  await send(msg);
}

// ══════════════════════════════════════════════════════════════════
//  OVERREACTION FADE (safe mode: sirf HIGH confidence)
// ══════════════════════════════════════════════════════════════════

async function alertFade(signal) {
  const msg = `
📉 *PANIC SALE DETECTED* [${signal.confidence}]
━━━━━━━━━━━━━━━━━━━━━━━━━

📂 *SECTION:* 📉 **OVERREACTION FADE**
📋 *Market:* ${signal.question?.slice(0, 80)}

━━━ *KYA HUA:* ━━━
⚡ Price *${signal.priceMovePct}%* gir/badh gaya sirf 30 min mein!
📊 Volume *${signal.volumeMultiplier}x* zyada hai normal se

━━━ *KYA KARNA HAI:* ━━━
👉 *${signal.fadeSide} kharido* @ ${(signal.entryPrice * 100).toFixed(1)}¢
🎯 Target: ${(signal.targetPrice * 100).toFixed(1)}¢ (jab wapas aaye)
🛑 *STOP LOSS:* ${(signal.stopLoss * 100).toFixed(1)}¢ (agar nahi aaye toh nikal jao)

━━━ *KYU KARNA HAI:* ━━━
💡 Jab market panic mein hota hai, log zyada react karte hain
📊 Historically 70% baar price wapas aata hai (mean reversion)
🧮 Risk:Reward = 1:${signal.riskRewardRatio}

⚠️ *Max $${Math.min(config.strategy.bankroll * 0.03, 15).toFixed(0)} lagana*
⚠️ *Stop loss zaroor lagana* — agar price wapas nahi aaye toh nikal jao

⏰ ${new Date().toLocaleTimeString()}
`;
  await send(msg);
}

// ══════════════════════════════════════════════════════════════════
//  VOLUME SPIKE (safe mode: sirf HIGH confidence)
// ══════════════════════════════════════════════════════════════════

async function alertVolumeSpike(signal) {
  const msg = `
📊 *SMART MONEY ALERT* [${signal.confidence}]
━━━━━━━━━━━━━━━━━━━━━━━━━

📂 *SECTION:* 📊 **VOLUME SPIKE**
📋 *Market:* ${signal.question?.slice(0, 80)}

━━━ *KYA HUA:* ━━━
⚡ Volume *${signal.spikeMultiplier}x* badh gaya!
💰 Abhi: $${signal.currentHourVolume?.toLocaleString()} vs Normal: $${signal.avgHourlyVolume?.toLocaleString()}/hr

━━━ *KYA KARNA HAI:* ━━━
👉 *${signal.side} kharido* @ ${(signal.entryPrice * 100).toFixed(1)}¢
🎯 Target: +${signal.targetProfitPct}% profit
🛑 Stop Loss: -${signal.stopLossPct}%

━━━ *KYU KARNA HAI:* ━━━
💡 Smart money (bade log) ne achanak position li
📊 Jab volume itna spike karta hai, usually koi information hai
🧮 Unke saath bet lagane se historically 60-70% chance jeetne ka

⚠️ *Max $${Math.min(config.strategy.bankroll * 0.03, 15).toFixed(0)} lagana*
⏰ Hold: ${signal.holdDuration}

[👉 MARKET LINK](${signal.url})
⏰ ${new Date().toLocaleTimeString()}
`;
  await send(msg);
}

// ══════════════════════════════════════════════════════════════════
//  SCAN SUMMARY
// ══════════════════════════════════════════════════════════════════

async function alertScanSummary({ arbCount, longshotCount, whaleCount, resEdgeCount, yieldCount = 0, fadeCount = 0, volSpikeCount = 0, researchCount = 0, safeTradeCount = 0, newAlerts = 0, scanDurationMs }) {
  const total = arbCount + longshotCount + whaleCount + resEdgeCount + yieldCount + fadeCount + volSpikeCount + researchCount;
  const msg = `
📊 *${newAlerts > 0 ? `NAYE ALERTS (${newAlerts})` : 'BOT ALIVE — Hourly Update'}*
━━━━━━━━━━━━━━━━━━━━
🟢 Safe Trades:    *${safeTradeCount}*
🔥 Arbitrage:      *${arbCount}*
🏦 Yield Play:     *${yieldCount}*
🔬 Research:       *${researchCount}*
📉 Longshot:       *${longshotCount}*
🐋 Whale:          *${whaleCount}*
📉 Fade:           *${fadeCount}*
📊 Vol Spike:      *${volSpikeCount}*
🔍 Res. Edge:      *${resEdgeCount}*
━━━━━━━━━━━━━━━━━━━━
📌 Total: *${total}* | Safe Mode: *${config.strategy.safeMode ? 'ON 🛡️' : 'OFF'}*
⏱ ${scanDurationMs}ms | ${new Date().toLocaleTimeString()}
`;
  await send(msg);
}

// ══════════════════════════════════════════════════════════════════
//  RESEARCH TRADE — Top Trader Strategy (Information Edge)
// ══════════════════════════════════════════════════════════════════

async function alertResearchTrade(opp) {
  const links = opp.researchLinks || {};

  // Build research links section
  let researchSection = '';
  researchSection += `🔗 [Market Link](${links.market || opp.url})\n`;
  researchSection += `📰 [Google News](${links.googleNews})\n`;
  researchSection += `🐦 [Twitter/X Live](${links.twitter})\n`;
  researchSection += `💬 [Reddit](${links.reddit})\n`;
  researchSection += `🔍 [Google Search](${links.google})\n`;

  // Category-specific links
  if (links.coingecko) researchSection += `📊 [CoinGecko](${links.coingecko})\n`;
  if (links.cryptoNews) researchSection += `₿ [CoinDesk](${links.cryptoNews})\n`;
  if (links.tradingview) researchSection += `📈 [TradingView](${links.tradingview})\n`;
  if (links.fiveThirtyEight) researchSection += `🗳️ [538 Polls](${links.fiveThirtyEight})\n`;
  if (links.realClearPolitics) researchSection += `🏛️ [RCP](${links.realClearPolitics})\n`;
  if (links.fredData) researchSection += `📊 [FRED Data](${links.fredData})\n`;
  if (links.fedWatch) researchSection += `🏦 [FedWatch](${links.fedWatch})\n`;
  if (links.espn) researchSection += `⚽ [ESPN](${links.espn})\n`;
  if (links.yahooFinance) researchSection += `💹 [Yahoo Finance](${links.yahooFinance})\n`;

  const sr = opp.suggestedResearch || {};

  const msg = `
🔬 *SAFE RESEARCH TRADE* ${opp.categoryEmoji} ${opp.category}
━━━━━━━━━━━━━━━━━━━━━━━━━

📂 *SECTION:* 🔬 **SAFE RESEARCH TRADE** (14-Day Info Edge)
📋 *Market:* ${opp.question?.slice(0, 100)}

━━━ *ABHI KYA HAI:* ━━━
📊 YES: *${(opp.yesPrice * 100).toFixed(1)}¢* | NO: *${(opp.noPrice * 100).toFixed(1)}¢*
⏰ *${opp.resolveLabel}* (${opp.hoursToResolve.toFixed(0)} hours baaki)
💰 Max profit: *+${opp.maxProfitPct}%*

━━━ *KYA RESEARCH KARNA HAI:* ━━━
🎯 ${sr.bias || 'Research both sides'}
🔍 *Dhundho:* ${sr.lookFor || 'Evidence for either side'}
✅ *Agar mila:* ${sr.ifTrue || 'Buy the side your research supports'}

━━━ *TOP TRADER TIP:* ━━━
💡 *Bade traders yeh karte hain:*
1️⃣ Pehle RESOLUTION RULES padho (market page pe)
2️⃣ Google News pe latest khabar dhundho
3️⃣ Twitter pe live reactions dekho
4️⃣ Agar tumhe koi aisi info mile jo market ne price nahi ki → TRADE LO
5️⃣ Agar kuch confirm nahi → SKIP KARO

━━━ *RESEARCH LINKS:* ━━━
${researchSection}
━━━ *RISK:* ━━━
💰 Max lagao: *${formatMoney(opp.maxBet)}*
⚠️ Sirf trade lo agar research se CONFIDENT ho
📊 Research Score: ${opp.researchScore}/10

⏰ ${new Date().toLocaleTimeString()}
`;
  await send(msg);
}

module.exports = {
  send,
  alertArbitrage,
  alertLongshot,
  alertWhale,
  alertResolutionEdge,
  alertYieldPlay,
  alertFade,
  alertVolumeSpike,
  alertResearchTrade,
  alertScanSummary,
};