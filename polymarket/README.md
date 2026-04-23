# 🤖 Prediction Market Arb Bot

**Polymarket + Kalshi Arbitrage Scanner** — 4 strategies, Telegram alerts, production-ready.

---

## ⚡ Strategies Included

| Strategy | What It Does | Win Type |
|---|---|---|
| 🔥 **Arbitrage** | Same market, different price on Poly vs Kalshi | Near-guaranteed profit |
| 📉 **Longshot Bias** | Detects overpriced underdogs + underpriced favorites | Statistical edge |
| 🐋 **Whale Tracker** | Mirrors top leaderboard wallet moves | Information edge |
| 🔍 **Resolution Edge** | Finds markets where wording is misunderstood | Contract edge |

---

## 🚀 Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Create `.env` file
```bash
cp .env.example .env
```

Edit `.env`:
```env
# Telegram (create bot via @BotFather on Telegram)
TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
TELEGRAM_CHAT_ID=your_chat_id       # Get via @userinfobot

# Optional: Kalshi trading keys (not needed for scanning only)
KALSHI_API_KEY=your_key
KALSHI_API_SECRET=your_secret

# Strategy config
MIN_ARB_PROFIT=0.03          # Alert if arb profit > 3%
MIN_LONGSHOT_EDGE=0.08       # Alert if edge > 8%
SCAN_INTERVAL_SECONDS=30     # Scan every 30 seconds
MIN_LIQUIDITY=5000           # Skip markets with < $5k liquidity
MAX_POSITION_SIZE=100        # Max $100 per trade suggestion
WHALE_MIN_TRADE_SIZE=5000    # Track trades > $5k
```

### 3. Get Telegram Chat ID
1. Message `@BotFather` → create bot → get `TELEGRAM_BOT_TOKEN`
2. Message `@userinfobot` → get your `TELEGRAM_CHAT_ID`
3. Start your bot: message it once to activate

### 4. Run the bot
```bash
# Start with auto-restart
npm run dev

# Production
npm start
```

---

## 📁 Project Structure

```
prediction-arb-bot/
├── index.js                    ← Entry point + cron scheduler
├── src/
│   ├── config.js               ← Central config (reads .env)
│   ├── scanner.js              ← Orchestrates all strategies
│   ├── fetchers/
│   │   ├── polymarket.js       ← Polymarket API (public, no auth)
│   │   └── kalshi.js           ← Kalshi API (public market data)
│   ├── strategies/
│   │   ├── arbitrage.js        ← Cross-platform arb detection
│   │   ├── longshot.js         ← Longshot bias scanner
│   │   ├── whaleTracker.js     ← Whale copy trading tracker
│   │   └── resolutionEdge.js   ← Contract wording edge detector
│   ├── alerts/
│   │   └── telegram.js         ← Telegram alert sender
│   └── utils/
│       └── logger.js           ← Winston logger (file + console)
├── logs/
│   ├── bot.log                 ← All logs
│   └── opportunities.log       ← Opportunities only
└── .env.example
```

---

## 📊 How Arbitrage Math Works

```
Example:
  Polymarket: "Will BTC reach $100k?" YES = 52¢
  Kalshi:     "Will BTC reach $100k?" NO  = 44¢
  
  Cost = 52¢ + 44¢ = 96¢
  Payout = $1.00 (one of them MUST be right)
  
  Gross Profit = 4¢ per dollar
  Fees ≈ 2.7¢
  Net Profit = 1.3¢ = 1.3% RISK-FREE
  
  On $1000 → +$13 guaranteed
```

---

## ⚙️ Adding Whale Wallets Manually

Find top wallets on [Polymarket Leaderboard](https://polymarket.com/leaderboard) or [Dune Analytics](https://dune.com).

```js
const { addKnownWhale } = require('./src/strategies/whaleTracker');
addKnownWhale('0xABC123...');
```

---

## 🔧 Tuning for More Alerts

If you're getting too few alerts, lower thresholds in `.env`:
```env
MIN_ARB_PROFIT=0.01        # 1% instead of 3%
MIN_LONGSHOT_EDGE=0.04     # 4% instead of 8%
MIN_LIQUIDITY=1000         # $1k instead of $5k
```

---

## ⚠️ Disclaimer

This bot is for educational and informational purposes.  
Prediction markets carry financial risk. Never invest more than you can afford to lose.  
Arbitrage opportunities may close before you can execute them.

---

## 🗺️ Roadmap (What You Can Add Next)

- [ ] Auto-execute trades via Polymarket CLOB API (requires wallet setup)
- [ ] Kalshi auto-trade via authenticated REST API
- [ ] Web dashboard (Next.js) showing live opportunities
- [ ] Backtesting module on historical Polymarket data
- [ ] Dune Analytics integration for live whale wallet scoring
