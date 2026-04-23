const config = require('../config');
const logger = require('../utils/logger');

// In-memory price/volume history: marketId → { snapshots: [] }
const marketHistory = new Map();
const HISTORY_WINDOW_MS = 6 * 60 * 60 * 1000;
const FADE_WINDOW_MS = 30 * 60 * 1000;

function recordSnapshot(market) {
  const id = market.id || market.slug;
  if (!id) return;
  if (!marketHistory.has(id)) {
    marketHistory.set(id, { question: market.question, platform: market.platform, url: market.url, snapshots: [] });
  }
  const entry = marketHistory.get(id);
  const now = Date.now();
  entry.snapshots.push({ yesPrice: market.yesPrice, noPrice: market.noPrice, volume: parseFloat(market.volume || 0), liquidity: parseFloat(market.liquidity || 0), timestamp: now });
  entry.snapshots = entry.snapshots.filter(s => now - s.timestamp < HISTORY_WINDOW_MS);
}

function recordMarketSnapshots(markets) {
  for (const m of markets) { if (m.active) recordSnapshot(m); }
  logger.info(`[OverreactionFade] Tracking ${marketHistory.size} markets`);
}

function calcVolumeZScore(snapshots, currentVolume) {
  if (snapshots.length < 10) return 0;
  const vols = snapshots.map(s => s.volume);
  const mean = vols.reduce((a, b) => a + b, 0) / vols.length;
  const stdDev = Math.sqrt(vols.reduce((a, v) => a + Math.pow(v - mean, 2), 0) / vols.length);
  return stdDev === 0 ? 0 : (currentVolume - mean) / stdDev;
}

function detectOverreactionFades(markets) {
  const signals = [];
  for (const market of markets) {
    if (!market.active) continue;
    const id = market.id || market.slug;
    const history = marketHistory.get(id);
    if (!history || history.snapshots.length < 10) continue;

    const now = Date.now();
    const snaps = history.snapshots;
    const recentSnaps = snaps.filter(s => now - s.timestamp < FADE_WINDOW_MS);
    const baselineSnaps = snaps.filter(s => now - s.timestamp >= FADE_WINDOW_MS && now - s.timestamp < HISTORY_WINDOW_MS);
    if (recentSnaps.length < 2 || baselineSnaps.length < 5) continue;

    const oldest = recentSnaps[0];
    const curVol = parseFloat(market.volume || 0);
    const priceChange = market.yesPrice - oldest.yesPrice;
    const priceChangePct = Math.abs(priceChange / oldest.yesPrice) * 100;
    if (priceChangePct < config.strategy.fadeMinPriceMove) continue;

    const baseAvgVol = baselineSnaps.reduce((s, snap) => s + snap.volume, 0) / baselineSnaps.length;
    const volMult = baseAvgVol > 0 ? curVol / baseAvgVol : 0;
    const volZ = calcVolumeZScore(baselineSnaps, curVol);
    if (volMult < config.strategy.fadeMinVolumeSpike && volZ < 3) continue;

    const baseAvgPrice = baselineSnaps.reduce((s, snap) => s + snap.yesPrice, 0) / baselineSnaps.length;
    const trendDir = market.yesPrice > baseAvgPrice ? 'UP' : 'DOWN';
    const moveDir = priceChange > 0 ? 'UP' : 'DOWN';
    const isCounterTrend = moveDir !== trendDir;
    const isExtreme = priceChangePct > 20;
    if (!isCounterTrend && !isExtreme) continue;

    const liq = parseFloat(market.liquidity || 0);
    if (liq < config.strategy.fadeMinLiquidity) continue;

    const fadeSide = priceChange > 0 ? 'NO' : 'YES';
    const fadePrice = fadeSide === 'YES' ? market.yesPrice : market.noPrice;
    const retrace = fadePrice + Math.abs(priceChange) * 0.5;
    const stopLoss = Math.max(0.01, fadePrice - Math.abs(priceChange) * 0.15);
    const expProfit = Math.abs(retrace - fadePrice);
    const maxRisk = Math.abs(fadePrice - stopLoss);

    let conf = 0;
    if (isCounterTrend) conf += 3;
    if (isExtreme) conf += 2;
    if (volZ > 5) conf += 2;
    if (volMult > 10) conf += 1;
    if (liq > 50000) conf += 1;
    if (priceChangePct > 15) conf += 1;
    const confLevel = conf >= 7 ? 'HIGH' : conf >= 4 ? 'MEDIUM' : 'LOW';
    if (confLevel === 'LOW') continue;

    signals.push({
      type: 'OVERREACTION_FADE', confidence: confLevel, confidenceScore: conf,
      question: market.question, platform: market.platform, url: market.url,
      panicDirection: moveDir, priceMovePct: parseFloat(priceChangePct.toFixed(2)),
      volumeMultiplier: parseFloat(volMult.toFixed(1)), volumeZScore: parseFloat(volZ.toFixed(2)),
      action: `FADE: BUY ${fadeSide} @ ${(fadePrice * 100).toFixed(1)}¢`,
      fadeSide, entryPrice: parseFloat(fadePrice.toFixed(4)),
      targetPrice: parseFloat(retrace.toFixed(4)), stopLoss: parseFloat(stopLoss.toFixed(4)),
      expectedProfitPct: parseFloat((expProfit * 100).toFixed(2)),
      riskRewardRatio: maxRisk > 0 ? parseFloat((expProfit / maxRisk).toFixed(2)) : 99,
      holdDuration: '2-6 hours', urgency: priceChangePct > 20 ? 'ACT NOW' : 'Monitor 5 min',
      baselinePrice: parseFloat(baseAvgPrice.toFixed(4)),
      liquidity: liq,
      reasoning: `${priceChangePct.toFixed(1)}% move in 30min, ${volMult.toFixed(0)}x volume. ${isCounterTrend ? 'Counter-trend → overreaction likely.' : 'Extreme move → mean reversion likely.'}`,
      detectedAt: new Date().toISOString(),
    });
  }

  signals.sort((a, b) => b.confidenceScore - a.confidenceScore);
  if (signals.length > 0) logger.warn(`[OverreactionFade] 🔥 ${signals.length} fade signals!`);
  else logger.info(`[OverreactionFade] No overreaction signals`);
  return signals;
}

module.exports = { recordMarketSnapshots, detectOverreactionFades, marketHistory };
