const config = require('../config');
const logger = require('../utils/logger');

/**
 * Resolution Edge Strategy
 * ──────────────────────────────────────────────────────────────────
 * Concept: Markets where the contract WORDING creates an edge.
 * Crowd reads the headline; smart trader reads the fine print.
 *
 * Detectable patterns:
 *   1. "End of day" vs "Intraday" price targets
 *   2. "At least X" vs "Exactly X" conditions
 *   3. Ambiguous deadline (EOD, end of month, close of trading)
 *   4. Price threshold markets where crowd ignores exact resolution rules
 *   5. "Or more" / "or higher" markets that crowd undervalues
 */

// Patterns that indicate potential resolution edge opportunities
const RESOLUTION_PATTERNS = [
  {
    id:          'PRICE_THRESHOLD',
    keywords:    ['reach', 'exceed', 'above', 'hit', 'cross', '$', 'k by'],
    description: 'Price threshold markets — check if resolution uses close price vs intraday',
    edgeType:    'READ_THE_RESOLUTION_RULES',
    color:       '🟡',
  },
  {
    id:          'AMBIGUOUS_DEADLINE',
    keywords:    ['by end of', 'before', 'by close', 'end of month', 'eod'],
    description: 'Deadline ambiguity — timezone differences can cause mispricing',
    edgeType:    'DEADLINE_ARBITRAGE',
    color:       '🟠',
  },
  {
    id:          'OR_MORE_UNDERVALUED',
    keywords:    ['or more', 'at least', 'minimum', 'or higher', '+'],
    description: '"Or more" markets are often undervalued vs exact-value markets',
    edgeType:    'BUNDLE_OPPORTUNITY',
    color:       '🟢',
  },
  {
    id:          'CONDITIONAL_EVENT',
    keywords:    ['if', 'given that', 'assuming', 'conditional', 'provided'],
    description: 'Conditional markets — crowd often ignores dependency chain',
    edgeType:    'CONDITIONAL_MISPRICING',
    color:       '🔵',
  },
  {
    id:          'SPORTS_DETAIL',
    keywords:    ['quarter', 'half', 'innings', 'period', 'overtime', 'regulation'],
    description: 'Sports markets with specific time-window conditions crowd ignores',
    edgeType:    'SPORTS_WORDING',
    color:       '⚽',
  },
];

/**
 * Scan markets for resolution edge opportunities
 * @param {Array} markets - from any fetcher
 * @returns {Array} markets with detected patterns
 */
function detectResolutionEdge(markets) {
  const opportunities = [];

  for (const market of markets) {
    if (!market.active) continue;
    if (market.liquidity < config.strategy.minLiquidity * 0.5) continue;  // Lower threshold

    const questionLower = (market.question || '').toLowerCase();
    const detected = [];

    for (const pattern of RESOLUTION_PATTERNS) {
      const matches = pattern.keywords.filter(kw => questionLower.includes(kw));
      if (matches.length > 0) {
        detected.push({ ...pattern, matchedKeywords: matches });
      }
    }

    if (detected.length === 0) continue;

    // Compute "edge score" — more patterns = more likely mispriced
    const edgeScore = detected.reduce((sum, p) => sum + p.matchedKeywords.length, 0);

    // Identify which side might be advantaged
    const hasOrMore = questionLower.includes('or more') || questionLower.includes('at least');
    const suggestedSide = hasOrMore
      ? { side: 'YES', price: market.yesPrice, reason: '"Or more" markets historically YES-underpriced' }
      : { side: null, price: null, reason: 'Manual research required — read exact resolution criteria' };

    opportunities.push({
      type:         'RESOLUTION_EDGE',
      question:     market.question,
      platform:     market.platform,
      url:          market.url,
      patterns:     detected,
      edgeScore,
      patternCount: detected.length,

      yesPrice: market.yesPrice,
      noPrice:  market.noPrice,
      liquidity: market.liquidity,
      endDate:   market.endDate,

      suggestedSide,
      actionRequired: '⚠️ READ FULL CONTRACT TERMS before trading',
      researchLinks: [
        market.url,
        `https://polymarket.com/search?q=${encodeURIComponent(market.question?.slice(0, 30) || '')}`,
      ],

      detectedAt: new Date().toISOString(),
    });
  }

  // Sort by edge score (highest first)
  opportunities.sort((a, b) => b.edgeScore - a.edgeScore);

  logger.info(`[ResolutionEdge] Found ${opportunities.length} markets with resolution edge patterns`);

  return opportunities;
}

module.exports = { detectResolutionEdge };
