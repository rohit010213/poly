const Fuse = require('fuse.js');
const config = require('../config');
const logger = require('../utils/logger');

const POLY_FEE = 0.02;
const KALSHI_FEE = 0.007;
const TOTAL_FEES = POLY_FEE + KALSHI_FEE;

const STOP_WORDS = new Set([
  'will', 'the', 'this', 'that', 'with', 'from', 'have', 'been', 'what',
  'when', 'where', 'which', 'does', 'than', 'more', 'into', 'over',
  'before', 'after', 'during', 'market', 'event', 'happen', 'occur',
  'become', 'reach', 'close', 'above', 'below', 'least', 'most', 'ever',
]);

// Normalize text: "100k" → "100000", "$1m" → "1000000", "2025" stays
function normalizeText(text = '') {
  return text
    .toLowerCase()
    .replace(/\$([0-9]+)k/g, (_, n) => (parseInt(n) * 1000).toString())
    .replace(/\$([0-9]+)m/g, (_, n) => (parseInt(n) * 1000000).toString())
    .replace(/([0-9]+)k\b/g, (_, n) => (parseInt(n) * 1000).toString())
    .replace(/([0-9]+)m\b/g, (_, n) => (parseInt(n) * 1000000).toString())
    .replace(/,/g, '')         // remove commas in numbers
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractKeywords(text = '') {
  return normalizeText(text)
    .split(' ')
    .filter(w => w.length > 2)
    .filter(w => !STOP_WORDS.has(w));
}

/**
 * UNIVERSAL: Category-based candidate selection + fuzzy match
 */
function matchMarkets(polyMarkets, kalshiMarkets) {
  const RELEVANT_CATEGORIES = new Set(['ECONOMICS', 'POLITICS', 'CRYPTO', 'FINANCIALS', 'FINANCE', 'BUSINESS']);
  
  const filteredPoly = polyMarkets.filter(m => RELEVANT_CATEGORIES.has(m.category));
  const filteredKalshi = kalshiMarkets.filter(m => RELEVANT_CATEGORIES.has(m.category));

  logger.info(`[Arbitrage] Focus Scan: ${filteredPoly.length} Poly × ${filteredKalshi.length} Kalshi`);
  const t0 = Date.now();

  const processedKalshi = filteredKalshi.map(km => ({
    ...km,
    _normalizedQ: normalizeText(km.question)
      .replace(/\bbtc\b/g, 'bitcoin')
      .replace(/\beth\b/g, 'ethereum')
  }));

  const pairs = [];
  const seenPairs = new Set();

  for (const poly of filteredPoly) {
    const polyNorm = normalizeText(poly.question)
      .replace(/\bbtc\b/g, 'bitcoin')
      .replace(/\beth\b/g, 'ethereum');

    // Compare against ALL Kalshi markets in the SAME category
    const candidates = processedKalshi.filter(k => k.category === poly.category || (poly.category === 'ECONOMICS' && k.category === 'FINANCIALS'));
    
    if (candidates.length === 0) continue;

    const fuse = new Fuse(candidates, {
      keys: ['_normalizedQ'],
      threshold: config.scanner.fuzzyMatchScore,
      includeScore: true,
    });

    const results = fuse.search(polyNorm);
    if (results.length === 0) continue;

    const best = results[0];
    const pairKey = `${poly.id}::${best.item.id}`;
    if (seenPairs.has(pairKey)) continue;
    seenPairs.add(pairKey);

    pairs.push({ 
      polyMarket: poly, 
      kalshiMarket: best.item, 
      matchScore: best.score || 0, 
      matchQuality: (best.score || 0) < 0.2 ? 'HIGH' : (best.score || 0) < 0.4 ? 'MEDIUM' : 'LOW' 
    });
  }

  const high = pairs.filter(p => p.matchQuality === 'HIGH').length;
  const med = pairs.filter(p => p.matchQuality === 'MEDIUM').length;
  logger.info(`[Arbitrage] Scan complete (Matched:${pairs.length} HIGH:${high} MED:${med})`);

  // Log the best possible match found (for debugging)
  if (processedKalshi.length > 0 && filteredPoly.length > 0) {
     // This is just to see what's failing to match
     logger.info(`  → Best Raw Match Score: ${pairs.length > 0 ? pairs.sort((a,b)=>a.matchScore-b.matchScore)[0].matchScore.toFixed(3) : 'No decent match found'}`);
  }

  return pairs;
}

/**
 * Detect arbitrage from matched pairs
 */
function detectArbitrage(pairs) {
  const opportunities = [];

  for (const { polyMarket: p, kalshiMarket: k, matchScore, matchQuality } of pairs) {
    // Skip LOW quality
    if (matchQuality === 'LOW') continue;

    // Liquidity check — either field
    const pLiq = (p.liquidity || 0) + (p.volume || 0);
    const kLiq = (k.liquidity || 0) + (k.volume || 0);
    if (pLiq < config.strategy.minLiquidity && pLiq > 0) continue;
    if (kLiq < config.strategy.minLiquidity && kLiq > 0) continue;

    // Scenario A: YES on Poly + NO on Kalshi
    const costA = p.yesPrice + k.noPrice;
    const profitA = 1 - costA - TOTAL_FEES;

    // Scenario B: NO on Poly + YES on Kalshi
    const costB = p.noPrice + k.yesPrice;
    const profitB = 1 - costB - TOTAL_FEES;

    const bestProfit = Math.max(profitA, profitB);
    if (bestProfit < config.strategy.minArbProfit) continue;

    const isA = profitA >= profitB;
    const profit = isA ? profitA : profitB;
    const cost = isA ? costA : costB;

    const posSize = Math.min(
      config.strategy.maxPositionSize,
      Math.floor(Math.min(pLiq, kLiq) * 0.05)
    );

    opportunities.push({
      type: 'ARBITRAGE',
      matchQuality,
      matchScore,
      question: p.question,
      poly: {
        id: p.id,
        url: p.url,
        side: isA ? 'YES' : 'NO',
        price: isA ? p.yesPrice : p.noPrice,
        liquidity: p.liquidity,
      },
      kalshi: {
        ticker: k.ticker,
        url: k.url,
        side: isA ? 'NO' : 'YES',
        price: isA ? k.noPrice : k.yesPrice,
        liquidity: k.liquidity,
      },
      totalCost: parseFloat(cost.toFixed(4)),
      profitPct: parseFloat((profit * 100).toFixed(2)),
      positionSize: posSize,
      expectedProfit: parseFloat((posSize * profit).toFixed(2)),
      feesConsidered: parseFloat((TOTAL_FEES * 100).toFixed(2)),
      detectedAt: new Date().toISOString(),
    });
  }

  opportunities.sort((a, b) => b.profitPct - a.profitPct);

  if (opportunities.length > 0) {
    logger.warn(`[Arbitrage] 🔥 ${opportunities.length} opportunities found!`);
  } else {
    logger.info(`[Arbitrage] No arb above ${config.strategy.minArbProfit * 100}% threshold`);
  }

  return opportunities;
}

module.exports = { matchMarkets, detectArbitrage };