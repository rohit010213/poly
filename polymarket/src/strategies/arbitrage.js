const Fuse = require('fuse.js');
const config = require('../config');
const logger = require('../utils/logger');

// Polymarket fee (~2%), Kalshi fee (~7 cents per contract)
const POLY_FEE = 0.02;
const KALSHI_FEE = 0.007;
const TOTAL_FEES = POLY_FEE + KALSHI_FEE;

// ── Fast keyword extractor ────────────────────────────────────────
// Pull key tokens from question for pre-filtering
function extractKeywords(text = '') {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3)                              // skip short words
    .filter(w => !STOP_WORDS.has(w));
}

const STOP_WORDS = new Set([
  'will', 'the', 'this', 'that', 'with', 'from', 'have',
  'been', 'what', 'when', 'where', 'which', 'does', 'than',
  'more', 'than', 'into', 'over', 'before', 'after', 'during',
  'market', 'event', 'happen', 'occur', 'become', 'reach',
]);

/**
 * FAST market matcher — keyword pre-filter + targeted fuzzy match
 * Old approach: 704 × 1200 = 844,800 comparisons  → SLOW
 * New approach: keyword filter reduces to ~10-30 candidates → FAST
 */
function matchMarkets(polyMarkets, kalshiMarkets) {
  logger.info(`[Arbitrage] Matching ${polyMarkets.length} Poly × ${kalshiMarkets.length} Kalshi markets...`);
  const startTime = Date.now();

  // Pre-index Kalshi markets by keyword
  // { keyword → [kalshiMarket, ...] }
  const kalshiIndex = new Map();
  for (const km of kalshiMarkets) {
    const keywords = extractKeywords(km.question);
    for (const kw of keywords) {
      if (!kalshiIndex.has(kw)) kalshiIndex.set(kw, []);
      kalshiIndex.get(kw).push(km);
    }
  }

  const pairs = [];
  const seenPairs = new Set(); // avoid duplicates

  for (const poly of polyMarkets) {
    const polyKeywords = extractKeywords(poly.question);
    if (polyKeywords.length === 0) continue;

    // Find candidate Kalshi markets that share at least 1 keyword
    const candidateMap = new Map(); // kalshi.id → { market, sharedKeywords }
    for (const kw of polyKeywords) {
      const candidates = kalshiIndex.get(kw) || [];
      for (const km of candidates) {
        if (!candidateMap.has(km.id)) {
          candidateMap.set(km.id, { market: km, sharedKeywords: 0 });
        }
        candidateMap.get(km.id).sharedKeywords++;
      }
    }

    // Sort candidates by shared keyword count (best matches first)
    const candidates = [...candidateMap.values()]
      .sort((a, b) => b.sharedKeywords - a.sharedKeywords)
      .slice(0, 15) // max 15 candidates per poly market
      .map(c => c.market);

    if (candidates.length === 0) continue;

    // Run Fuse only on candidates (tiny subset)
    const fuse = new Fuse(candidates, {
      keys: ['question', 'slug'],
      threshold: config.scanner.fuzzyMatchScore,
      includeScore: true,
      ignoreLocation: true,
      minMatchCharLength: 5,
    });

    const results = fuse.search(poly.question);
    if (results.length === 0) continue;

    const best = results[0];
    const pairKey = `${poly.id}::${best.item.id}`;
    if (seenPairs.has(pairKey)) continue;
    seenPairs.add(pairKey);

    const matchQuality = best.score < 0.15 ? 'HIGH' : best.score < 0.30 ? 'MEDIUM' : 'LOW';

    pairs.push({
      polyMarket: poly,
      kalshiMarket: best.item,
      matchScore: best.score,
      matchQuality,
    });
  }

  const elapsed = Date.now() - startTime;
  logger.info(`[Arbitrage] Matched ${pairs.length} pairs in ${elapsed}ms (HIGH: ${pairs.filter(p => p.matchQuality === 'HIGH').length}, MEDIUM: ${pairs.filter(p => p.matchQuality === 'MEDIUM').length})`);
  return pairs;
}

/**
 * For each matched pair, compute arbitrage opportunities
 *
 * Arb Logic:
 *   Buy YES on platform A + Buy NO on platform B
 *   If YES_A + NO_B < 1 - fees → PROFIT
 *
 * @param {Array} pairs - from matchMarkets()
 * @returns {Array} opportunities sorted by profitability
 */
function detectArbitrage(pairs) {
  const opportunities = [];

  for (const { polyMarket, kalshiMarket, matchScore, matchQuality } of pairs) {
    // Skip low quality matches or low liquidity
    if (matchQuality === 'LOW') continue;
    if (polyMarket.liquidity < config.strategy.minLiquidity) continue;
    if (kalshiMarket.liquidity < config.strategy.minLiquidity) continue;

    const p = polyMarket;
    const k = kalshiMarket;

    // ── Scenario A: Buy YES on Poly + NO on Kalshi ────────────────
    const costA = p.yesPrice + k.noPrice;
    const profitA = 1 - costA - TOTAL_FEES;

    // ── Scenario B: Buy NO on Poly + YES on Kalshi ────────────────
    const costB = p.noPrice + k.yesPrice;
    const profitB = 1 - costB - TOTAL_FEES;

    const bestProfit = Math.max(profitA, profitB);
    if (bestProfit < config.strategy.minArbProfit) continue;

    const isScenarioA = profitA >= profitB;
    const profit = isScenarioA ? profitA : profitB;
    const cost = isScenarioA ? costA : costB;

    // Compute position size & expected $profit
    const positionSize = Math.min(config.strategy.maxPositionSize,
      Math.floor(Math.min(p.liquidity, k.liquidity) * 0.05)); // max 5% of liquidity
    const expectedProfit$ = positionSize * profit;

    opportunities.push({
      type: 'ARBITRAGE',
      matchQuality,
      matchScore,
      question: p.question,

      // Poly side
      poly: {
        id: p.id,
        url: p.url,
        side: isScenarioA ? 'YES' : 'NO',
        price: isScenarioA ? p.yesPrice : p.noPrice,
        liquidity: p.liquidity,
      },

      // Kalshi side
      kalshi: {
        ticker: k.ticker,
        url: k.url,
        side: isScenarioA ? 'NO' : 'YES',
        price: isScenarioA ? k.noPrice : k.yesPrice,
        liquidity: k.liquidity,
      },

      // Profit metrics
      totalCost: parseFloat(cost.toFixed(4)),
      profitPct: parseFloat((profit * 100).toFixed(2)),
      positionSize,
      expectedProfit: parseFloat(expectedProfit$.toFixed(2)),
      feesConsidered: parseFloat((TOTAL_FEES * 100).toFixed(2)),

      detectedAt: new Date().toISOString(),
    });
  }

  // Sort by profit %
  opportunities.sort((a, b) => b.profitPct - a.profitPct);

  if (opportunities.length > 0) {
    logger.warn(`[Arbitrage] 🔥 Found ${opportunities.length} opportunities!`);
  } else {
    logger.info(`[Arbitrage] No opportunities above ${config.strategy.minArbProfit * 100}% threshold`);
  }

  return opportunities;
}

module.exports = { matchMarkets, detectArbitrage };