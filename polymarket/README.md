# 🤖 Prediction Market Bot v2.0

**7 Strategies | 60-70% Target Win Rate | Telegram Alerts | Kelly Criterion Sizing**

---

## ⚡ Strategies Included

| # | Strategy | Win Rate | Risk | What It Does |
|---|----------|----------|------|--------------|
| 1 | 🏦 **Yield Play** | 90-95% | LOW | Near-certainty (93-99¢) markets resolving in <7 days |
| 2 | 🔥 **Arbitrage** | 85-95% | VERY LOW | Same market, different price on Poly vs Kalshi |
| 3 | 📉 **Overreaction Fade** | 65-75% | MEDIUM | Fades panic-driven >10% price moves with volume spikes |
| 4 | 📊 **Volume Spike** | 60-70% | MEDIUM | Detects smart money via 10x+ volume anomalies |
| 5 | 📉 **Longshot Bias** | 55-65% | MEDIUM | Overpriced underdogs + underpriced favorites |
| 6 | 🐋 **Whale Tracker** | 55-65% | HIGH | Mirrors top leaderboard wallet moves |
| 7 | 🔍 **Resolution Edge** | 50-60% | HIGH | Markets where wording is misunderstood |

---

## 🚀 Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Create `.env` file
```env
# Telegram
TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
TELEGRAM_CHAT_ID=your_chat_id

# Kalshi (optional)
KALSHI_API_KEY=your_key
KALSHI_API_SECRET=your_secret

# Bankroll
BANKROLL=500                    # Your total bankroll in USD

# Strategy Tuning
MIN_ARB_PROFIT=0.03             # Arb profit > 3%
MIN_LONGSHOT_EDGE=0.08          # Longshot edge > 8%
SCAN_INTERVAL_SECONDS=30        # Scan every 30 seconds
MIN_LIQUIDITY=5000              # Skip low-liquidity markets
MAX_POSITION_SIZE=100           # Max per trade suggestion

# Yield Play
YIELD_MIN_PRICE=0.93            # Min 93¢ for yield plays
YIELD_MAX_PRICE=0.99            # Max 99¢
YIELD_MAX_DAYS=7                # Max 7 days to resolution
YIELD_MIN_LIQUIDITY=5000        # Min $5k liquidity

# Overreaction Fade
FADE_MIN_PRICE_MOVE=10          # Min 10% price move in 30 min
FADE_MIN_VOLUME_SPIKE=5         # Min 5x volume vs baseline
FADE_MIN_LIQUIDITY=10000        # Min $10k liquidity

# Volume Spike
VOL_SPIKE_MIN_MULT=10           # Min 10x volume spike
VOL_SPIKE_MIN_ABS=50000         # Min $50k absolute volume
VOL_SPIKE_MIN_LIQ=10000         # Min $10k liquidity

# Whale Tracking
WHALE_MIN_TRADE_SIZE=5000       # Track trades > $5k
```

### 3. Run the bot
```bash
npm run dev    # Development (auto-restart)
npm start      # Production
```

---

## 📁 Project Structure

```
prediction-arb-bot/
├── index.js                    ← Entry point + cron scheduler
├── src/
│   ├── config.js               ← Central config
│   ├── scanner.js              ← Orchestrates all 7 strategies
│   ├── fetchers/
│   │   ├── polymarket.js       ← Polymarket API
│   │   └── kalshi.js           ← Kalshi API
│   ├── strategies/
│   │   ├── yieldPlay.js        ← NEW: Near-certainty yield scanner
│   │   ├── overreactionFade.js ← NEW: Panic fade detector
│   │   ├── volumeSpike.js      ← NEW: Smart money volume tracker
│   │   ├── arbitrage.js        ← Cross-platform arb
│   │   ├── longshot.js         ← Longshot bias
│   │   ├── whaleTracker.js     ← Whale copy trading
│   │   └── resolutionEdge.js   ← Contract wording edge
│   ├── alerts/
│   │   └── telegram.js         ← Telegram alerts (all 7 strategies)
│   └── utils/
│       └── logger.js           ← Winston logger
└── .env
```

---

## 💰 Position Sizing (Quarter Kelly)

Every alert includes a **Quarter Kelly** position size recommendation:

```
Full Kelly = (b × p - q) / b
Quarter Kelly = Full Kelly × 0.25

Where:
  p = your estimated probability
  q = 1 - p
  b = net odds = (1/price) - 1
```

Quarter Kelly is used because:
- Full Kelly is too aggressive (33% chance of halving bankroll)
- Quarter Kelly captures 75% of growth with 95% less drawdown

---

## ⚠️ Disclaimer

This bot is for educational and informational purposes.
Prediction markets carry financial risk. Never invest more than you can afford to lose.
Past performance does not guarantee future results.
