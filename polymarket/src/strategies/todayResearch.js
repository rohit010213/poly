const config = require('../config');
const logger = require('../utils/logger');

/**
 * Today's Research Trade Strategy — "Information Edge"
 * ──────────────────────────────────────────────────────────────────
 * This is what TOP TRADERS do:
 *   1. Find markets closing TODAY or within 24-48 hours
 *   2. Where the price is NOT near 0¢ or 100¢ (uncertainty = opportunity)
 *   3. Generate research links (Google News, Twitter, resolution source)
 *   4. User researches → finds info market hasn't priced in → PROFIT
 *
 * Win Rate: 60-75% (depends on research quality)
 * Risk: MEDIUM (but you're making informed decisions)
 * Edge: INFORMATION — you know something the market doesn't
 *
 * HOW TOP TRADERS WORK:
 *   - Domer, Theo, GCR: they specialize in 1-2 domains (politics, crypto)
 *   - They read PRIMARY sources (govt databases, official feeds)
 *   - They trade the PRICE, not the outcome — buy underpriced, sell when corrected
 *   - They DON'T hold to resolution — they exit when edge disappears
 *   - They size positions small and repeat 100s of times
 */

function hoursUntilResolve(endDate) {
  if (!endDate) return Infinity;
  const end = new Date(endDate);
  const now = new Date();
  return Math.max(0, (end.getTime() - now.getTime()) / (1000 * 60 * 60));
}

// Categorize market by topic for specialized research links
function categorizeMarket(question) {
  const q = (question || '').toLowerCase();

  if (/bitcoin|btc|ethereum|eth|crypto|solana|sol|defi|token/i.test(q))
    return { category: 'CRYPTO', emoji: '₿' };
  if (/trump|biden|election|senate|congress|governor|vote|poll|democrat|republican|president/i.test(q))
    return { category: 'POLITICS', emoji: '🏛️' };
  if (/fed|rate|gdp|inflation|cpi|jobs|unemployment|nonfarm|fomc|treasury/i.test(q))
    return { category: 'ECONOMICS', emoji: '📊' };
  if (/nba|nfl|mlb|soccer|football|match|game|championship|league|team|score/i.test(q))
    return { category: 'SPORTS', emoji: '⚽' };
  if (/ai|openai|google|apple|microsoft|amazon|tesla|stock|earnings|ipo/i.test(q))
    return { category: 'TECH', emoji: '💻' };
  if (/weather|temperature|hurricane|earthquake|climate/i.test(q))
    return { category: 'WEATHER', emoji: '🌤️' };

  return { category: 'GENERAL', emoji: '📋' };
}

// Generate research links based on market question and category
function generateResearchLinks(question, category, url) {
  const q = encodeURIComponent(question?.slice(0, 80) || '');
  const shortQ = encodeURIComponent(question?.slice(0, 40) || '');

  const links = {
    market: url,
    googleNews: `https://news.google.com/search?q=${q}`,
    google: `https://www.google.com/search?q=${q}`,
    twitter: `https://x.com/search?q=${shortQ}&f=live`,
    reddit: `https://www.reddit.com/search/?q=${shortQ}&sort=new`,
  };

  // Category-specific sources
  switch (category) {
    case 'CRYPTO':
      links.coingecko = `https://www.coingecko.com`;
      links.cryptoNews = `https://www.coindesk.com/search?s=${shortQ}`;
      links.tradingview = `https://www.tradingview.com`;
      break;
    case 'POLITICS':
      links.fiveThirtyEight = `https://projects.fivethirtyeight.com/polls/`;
      links.realClearPolitics = `https://www.realclearpolitics.com`;
      links.polymarketSearch = `https://polymarket.com/search?q=${shortQ}`;
      break;
    case 'ECONOMICS':
      links.fredData = `https://fred.stlouisfed.org`;
      links.bls = `https://www.bls.gov`;
      links.fedWatch = `https://www.cmegroup.com/markets/interest-rates/cme-fedwatch-tool.html`;
      break;
    case 'SPORTS':
      links.espn = `https://www.espn.com`;
      links.oddsChecker = `https://www.oddschecker.com`;
      break;
    case 'TECH':
      links.techCrunch = `https://techcrunch.com/search/${shortQ}`;
      links.yahooFinance = `https://finance.yahoo.com`;
      break;
  }

  return links;
}

// Assess the "research edge" potential — how likely is user research to find an edge
function assessResearchPotential(market, hoursLeft) {
  let score = 0;
  const { yesPrice } = market;

  // Markets with uncertainty (30-70¢) have MORE research potential
  if (yesPrice >= 0.30 && yesPrice <= 0.70) score += 3;
  else if (yesPrice >= 0.20 && yesPrice <= 0.80) score += 2;
  else score += 1;

  // Closing SOONER = more actionable
  if (hoursLeft <= 6) score += 4;        // Today!
  else if (hoursLeft <= 24) score += 3;  // Tomorrow
  else if (hoursLeft <= 72) score += 2;  // 3 days
  else if (hoursLeft <= 168) score += 1; // 1 week
  else score += 0.5;                     // 1 week+

  // Higher volume = more reliable pricing (but also more efficient)
  const vol = parseFloat(market.volume || 0);
  if (vol >= 100000) score += 1;
  else if (vol >= 10000) score += 2;  // Sweet spot: active but not hyper-efficient
  else score += 0;

  // High liquidity = can actually trade
  const liq = parseFloat(market.liquidity || 0);
  if (liq >= 5000) score += 1;

  return score;
}

/**
 * Find today's research trade opportunities
 * @param {Array} markets - from fetcher
 * @returns {Array} research opportunities sorted by potential
 */
function detectTodayResearchTrades(markets) {
  const opportunities = [];

  for (const market of markets) {
    if (!market.active) continue;

    const { yesPrice, noPrice } = market;
    if (!yesPrice || !noPrice) continue;

    const hours = hoursUntilResolve(market.endDate);
    // Relaxed timing: 14 days window, and allow markets that just finished (-24h) but still active
    if (hours > (config.strategy.researchMaxHours || 336) || hours < -24) continue;

    // Skip only extreme certainty (92%+)
    if (yesPrice > 0.92 || yesPrice < 0.08) continue;

    // NO LIQUIDITY FILTER for research trades — let user decide
    const liq = parseFloat(market.liquidity || 0);
    const vol = parseFloat(market.volume || 0);

    const { category, emoji } = categorizeMarket(market.question);
    const researchLinks = generateResearchLinks(market.question, category, market.url);
    const researchScore = assessResearchPotential(market, hours);

    // Show almost everything (score >= 1)
    if (researchScore < (config.strategy.researchMinScore || 1)) continue;

    // Determine which side might have edge based on price position
    let suggestedResearch;
    if (yesPrice < 0.40) {
      suggestedResearch = {
        bias: 'Check if YES is UNDERPRICED',
        lookFor: 'Evidence that this WILL happen (news, data, insider signals)',
        ifTrue: `BUY YES @ ${(yesPrice * 100).toFixed(1)}¢ → potential ${((1/yesPrice - 1) * 100).toFixed(0)}% return`,
      };
    } else if (yesPrice > 0.60) {
      suggestedResearch = {
        bias: 'Check if YES is OVERPRICED',
        lookFor: 'Evidence that this WON\'T happen (counter-evidence, fine print)',
        ifTrue: `BUY NO @ ${(noPrice * 100).toFixed(1)}¢ → potential ${((1/noPrice - 1) * 100).toFixed(0)}% return`,
      };
    } else {
      suggestedResearch = {
        bias: '50-50 market — research both sides',
        lookFor: 'Any edge — news, data, expert opinions, primary sources',
        ifTrue: `Buy whichever side your research supports`,
      };
    }

    // Calculate potential profit
    const maxProfit = Math.max(
      ((1 / yesPrice) - 1) * 100,
      ((1 / noPrice) - 1) * 100
    );

    opportunities.push({
      type: 'RESEARCH_TRADE',
      question: market.question,
      platform: market.platform,
      url: market.url,
      category,
      categoryEmoji: emoji,

      // Pricing
      yesPrice, noPrice,
      spread: parseFloat(Math.abs(yesPrice - 0.5).toFixed(4)),
      maxProfitPct: parseFloat(maxProfit.toFixed(1)),

      // Timing
      hoursToResolve: parseFloat(hours.toFixed(1)),
      resolveLabel: hours <= 6 ? '🔴 AAJ CLOSE' : hours <= 24 ? '🟡 KAL CLOSE' : '🟢 2 DIN',
      endDate: market.endDate,

      // Research
      researchScore,
      suggestedResearch,
      researchLinks,

      // Risk
      maxBet: Math.min(config.strategy.bankroll * config.strategy.maxLossPerTrade, 25),
      liquidity: liq,
      volume: vol,

      detectedAt: new Date().toISOString(),
    });
  }

  // Sort by research score (best opportunities first)
  opportunities.sort((a, b) => b.researchScore - a.researchScore);

  logger.info(`[ResearchTrade] Found ${opportunities.length} research opportunities (Today: ${opportunities.filter(o => o.hoursToResolve <= 24).length})`);

  return opportunities;
}

module.exports = { detectTodayResearchTrades, categorizeMarket, generateResearchLinks };
