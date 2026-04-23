require('dotenv').config();
const cron   = require('node-cron');
const chalk  = require('chalk');
const config = require('./src/config');
const logger = require('./src/utils/logger');
const { runScan } = require('./src/scanner');

// ── Banner ────────────────────────────────────────────────────────
function printBanner() {
  const safeLabel = config.strategy.safeMode ? chalk.green('ON 🛡️') : chalk.red('OFF ⚡');
  console.log(chalk.cyan(`
╔═══════════════════════════════════════════════╗
║   🤖  PREDICTION MARKET BOT v2.0              ║
║   SAFE MODE — Low Risk, Quick Resolve         ║
╠═══════════════════════════════════════════════╣
║  Active Strategies:                           ║
║    🏦 Yield Play (95-99¢, <7 days) (90-95%)  ║
║    🔥 Arbitrage (risk-free)        (85-95%)  ║
║    📈 Safe Favorites (85%+ prob)   (55-65%)  ║
║    📉 Overreaction Fade (HIGH only)(65-75%)  ║
║    📊 Volume Spike (HIGH only)     (60-70%)  ║
║    🐋 Whale Copy (HIGH only)       (55-65%)  ║
╠═══════════════════════════════════════════════╣
║  Risk Controls:                               ║
║    Safe Mode    : ${safeLabel}${' '.repeat(24)}║
║    Bankroll     : $${String(config.strategy.bankroll).padEnd(25)}║
║    Max Loss/Trade: $${String(config.strategy.bankroll * config.strategy.maxLossPerTrade).padEnd(24)}║
║    Max Exposure : ${String((config.strategy.maxTotalExposure * 100) + '%').padEnd(26)}║
║    Scan Interval: ${String(config.scanner.intervalSeconds + 's').padEnd(26)}║
║    Telegram     : ${config.telegram.enabled ? chalk.green('ENABLED ✅') : chalk.red('DISABLED ❌')}${' '.repeat(config.telegram.enabled ? 18 : 17)}║
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
