require('dotenv').config();
const cron   = require('node-cron');
const chalk  = require('chalk');
const config = require('./src/config');
const logger = require('./src/utils/logger');
const { runScan } = require('./src/scanner');

// ── Banner ────────────────────────────────────────────────────────
function printBanner() {
  console.log(chalk.cyan(`
╔═══════════════════════════════════════════════╗
║   🤖  PREDICTION MARKET ARB BOT v1.0          ║
║   Polymarket + Kalshi Arbitrage Scanner       ║
╠═══════════════════════════════════════════════╣
║  Strategies:                                  ║
║    🔥 Cross-Platform Arbitrage                ║
║    📉 Longshot Bias Exploit                   ║
║    🐋 Whale Copy Tracker                      ║
║    🔍 Resolution Edge Detector                ║
╠═══════════════════════════════════════════════╣
║  Config:                                      ║
║    Scan Interval : ${String(config.scanner.intervalSeconds + 's every cycle').padEnd(26)}║
║    Min Arb Profit: ${String((config.strategy.minArbProfit * 100) + '%').padEnd(26)}║
║    Min Liquidity : $${String(config.strategy.minLiquidity).padEnd(25)}║
║    Telegram      : ${config.telegram.enabled ? chalk.green('ENABLED ✅') : chalk.red('DISABLED ❌')}${' '.repeat(config.telegram.enabled ? 17 : 16)}║
╚═══════════════════════════════════════════════╝
`));
}

// ── Graceful Shutdown ─────────────────────────────────────────────
process.on('SIGINT', () => {
  logger.info('Bot shutting down gracefully...');
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  logger.error(`Uncaught Exception: ${err.message}`);
  logger.error(err.stack);
});

process.on('unhandledRejection', (reason) => {
  logger.error(`Unhandled Rejection: ${reason}`);
});

// ── Main ──────────────────────────────────────────────────────────
async function main() {
  printBanner();

  // Run immediately on start
  logger.info('🚀 Running initial scan...');
  await runScan();

  // Schedule recurring scans
  // Convert seconds to cron expression: every N seconds = `*/N * * * * *`
  const interval = config.scanner.intervalSeconds;
  const cronExpr = `*/${interval} * * * * *`;

  logger.info(`📅 Scheduling scan every ${interval} seconds...`);

  cron.schedule(cronExpr, async () => {
    await runScan();
  });

  logger.info(chalk.green('Bot is running! Press Ctrl+C to stop.'));
}

main().catch(err => {
  logger.error(`Fatal startup error: ${err.message}`);
  process.exit(1);
});
