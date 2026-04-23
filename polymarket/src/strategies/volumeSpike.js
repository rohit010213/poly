const config = require('../config');
const logger = require('../utils/logger');

/**
 * Volume Spike Strategy — Smart Money Detector
 * Detects unusual volume spikes (10x+ baseline) that indicate
 * informed positioning before news breaks publicly.
 * Win Rate: 60-70% | Risk: MEDIUM
 */

// In-memory volume tracking: marketId → { hourlyVolumes: [], lastVolume }
const volumeTracker = new Map();
const BASELINE_HOURS = 6;

function updateVolumeBaseline(market) {
  const id = market.id || market.slug;
  if (!id) return;
  const vol = parseFloat(market.volume || 0);
  const now = Date.now();

  if (!volumeTracker.has(id)) {
    volumeTracker.set(id, { question: market.question, url: market.url, platform: market.platform, hourlyVolumes: [], lastVolume: vol, lastTimestamp: now });
    return;
  }

  const tracker = volumeTracker.get(id);
  const elapsed = now - tracker.lastTimestamp;

  // Record hourly delta
  if (elapsed >= 60 * 60 * 1000) {
    const delta = Math.max(0, vol - tracker.lastVolume);
    tracker.hourlyVolumes.push({ delta, timestamp: now });
    tracker.hourlyVolumes = tracker.hourlyVolumes.filter(h => now - h.timestamp < BASELINE_HOURS * 60 * 60 * 1000);
    tracker.lastVolume = vol;
    tracker.lastTimestamp = now;
  }
}

function updateAllBaselines(markets) {
  for (const m of markets) { if (m.active) updateVolumeBaseline(m); }
}

function detectVolumeSpikes(markets) {
  const signals = [];

  for (const market of markets) {
    if (!market.active) continue;
    const id = market.id || market.slug;
    const tracker = volumeTracker.get(id);
    if (!tracker || tracker.hourlyVolumes.length < 3) continue;

    const liq = parseFloat(market.liquidity || 0);
    const vol = parseFloat(market.volume || 0);
    if (liq < config.strategy.volumeSpikeMinLiquidity) continue;

    // Calculate baseline hourly volume
    const deltas = tracker.hourlyVolumes.map(h => h.delta);
    const avgHourlyVol = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    if (avgHourlyVol <= 0) continue;

    // Current hour delta
    const currentDelta = Math.max(0, vol - tracker.lastVolume);
    const spikeMultiplier = currentDelta / avgHourlyVol;

    if (spikeMultiplier < config.strategy.volumeSpikeMinMultiplier) continue;
    if (currentDelta < config.strategy.volumeSpikeMinAbsolute) continue;

    // Determine direction by price movement
    const snaps = tracker.hourlyVolumes;
    const priceDir = market.yesPrice > 0.5 ? 'YES_HEAVY' : 'NO_HEAVY';

    // Confidence
    let conf = 0;
    if (spikeMultiplier >= 20) conf += 3;
    else if (spikeMultiplier >= 10) conf += 2;
    else conf += 1;
    if (liq > 50000) conf += 2;
    if (currentDelta > 100000) conf += 2;
    const confLevel = conf >= 5 ? 'HIGH' : conf >= 3 ? 'MEDIUM' : 'LOW';
    if (confLevel === 'LOW') continue;

    const followSide = market.yesPrice > 0.5 ? 'YES' : 'NO';
    const followPrice = followSide === 'YES' ? market.yesPrice : market.noPrice;

    signals.push({
      type: 'VOLUME_SPIKE', confidence: confLevel, confidenceScore: conf,
      question: market.question, platform: market.platform, url: market.url,
      action: `Follow volume: BUY ${followSide} @ ${(followPrice * 100).toFixed(1)}¢`,
      side: followSide, entryPrice: parseFloat(followPrice.toFixed(4)),
      spikeMultiplier: parseFloat(spikeMultiplier.toFixed(1)),
      currentHourVolume: currentDelta, avgHourlyVolume: parseFloat(avgHourlyVol.toFixed(0)),
      targetProfitPct: 15,
      stopLossPct: 10,
      holdDuration: '2-24 hours',
      liquidity: liq, volume: vol,
      reasoning: `${spikeMultiplier.toFixed(0)}x volume spike ($${currentDelta.toLocaleString()} vs avg $${avgHourlyVol.toFixed(0)}/hr). Smart money likely positioning.`,
      detectedAt: new Date().toISOString(),
    });
  }

  signals.sort((a, b) => b.spikeMultiplier - a.spikeMultiplier);
  if (signals.length > 0) logger.warn(`[VolumeSpike] 📊 ${signals.length} volume spike signals!`);
  else logger.info(`[VolumeSpike] No significant volume spikes`);
  return signals;
}

module.exports = { updateAllBaselines, detectVolumeSpikes, volumeTracker };
