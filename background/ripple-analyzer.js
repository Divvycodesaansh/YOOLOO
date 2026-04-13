// Dislocation Radar India — Global Ripple Analyzer
// Scans for global events and maps their India transmission path
// Produces a structured "Global Ripple Check" assessment

const NEWS_RSS_BASE = 'https://news.google.com/rss/search';

// ─── Global Keyword Groups ───────────────────────────────────────────────────

const GLOBAL_KEYWORDS = {
  WAR_CONFLICT: [
    'Russia Ukraine war', 'Israel Hamas war', 'Iran Israel conflict',
    'Taiwan strait crisis', 'NATO escalation', 'South China Sea conflict',
    'Middle East war', 'airstrike', 'missile strike', 'military escalation',
    'nuclear threat', 'ceasefire collapse'
  ],
  SANCTIONS: [
    'US sanctions', 'EU sanctions', 'China sanctions', 'Russia sanctions',
    'trade embargo', 'export ban', 'import restrictions', 'SWIFT ban',
    'sanctions India', 'secondary sanctions'
  ],
  OIL_ENERGY: [
    'oil price surge', 'oil price crash', 'OPEC production cut',
    'energy crisis Europe', 'natural gas shortage', 'pipeline shutdown',
    'refinery explosion', 'oil tanker attack', 'Strait of Hormuz',
    'Saudi Aramco', 'oil supply disruption'
  ],
  PANDEMIC: [
    'pandemic declared', 'WHO emergency', 'new virus outbreak',
    'global lockdown', 'quarantine international', 'bird flu pandemic',
    'COVID new variant', 'disease X'
  ],
  TRADE_WAR: [
    'US China tariffs', 'trade war escalation', 'retaliatory tariffs',
    'import duties hike', 'trade sanctions', 'export controls chips',
    'rare earth restrictions', 'trade deal collapse'
  ],
  CURRENCY: [
    'dollar index surge', 'yen crash', 'euro crisis', 'currency collapse',
    'emerging market selloff', 'capital flight', 'forex reserves crisis',
    'dollar liquidity crunch', 'DXY 110'
  ],
  CLIMATE: [
    'climate disaster', 'earthquake devastation', 'tsunami warning',
    'hurricane category 5', 'flood devastation', 'drought crisis',
    'wildfire emergency', 'El Nino severe', 'monsoon failure India'
  ],
  POLITICAL: [
    'coup attempt', 'government collapse', 'election crisis',
    'political instability', 'regime change', 'mass protests',
    'debt ceiling crisis', 'sovereign default', 'credit downgrade'
  ]
};

// ─── India Transmission Map ──────────────────────────────────────────────────

const TRANSMISSION_MAP = {
  WAR_CONFLICT: {
    affected_spreads: ['india_vix', 'mcx_gold_comex', 'mcx_crude_brent', 'usdinr_basis'],
    sectors: [
      { name: 'Defense', degree: '1st', reason: 'Direct military spending & preparedness' },
      { name: 'Oil & Gas', degree: '1st', reason: 'Crude supply disruption & price spike' },
      { name: 'Banks', degree: '2nd', reason: 'FII outflows & risk-off sentiment' },
      { name: 'IT', degree: '3rd', reason: 'Global demand slowdown if war broadens' }
    ],
    daily_life: 'Petrol/diesel prices may rise; gold gets expensive; EMI pressure if rupee weakens',
    watch: 'Crude oil price above $90/barrel and USDINR crossing 85'
  },
  OIL_ENERGY: {
    affected_spreads: ['mcx_crude_brent', 'mcx_gold_comex', 'usdinr_basis', 'india_vix'],
    sectors: [
      { name: 'Oil & Gas', degree: '1st', reason: 'Direct crude import cost impact' },
      { name: 'Airlines', degree: '1st', reason: 'Aviation fuel cost surge' },
      { name: 'Auto', degree: '2nd', reason: 'Fuel cost hits consumer demand' },
      { name: 'FMCG', degree: '3rd', reason: 'Transport cost inflation in supply chain' }
    ],
    daily_life: 'Fuel prices at pump rise within weeks; transport costs push up vegetable and grocery prices',
    watch: 'Whether OPEC extends cuts and India crude import bill crosses $15B/month'
  },
  SANCTIONS: {
    affected_spreads: ['usdinr_basis', 'india_vix', 'infy_adr_spread', 'icici_adr_spread'],
    sectors: [
      { name: 'IT Services', degree: '1st', reason: 'Client spending freezes & visa risks' },
      { name: 'Pharma', degree: '2nd', reason: 'Export market access disruption' },
      { name: 'Banks', degree: '2nd', reason: 'Cross-border payment complications' },
      { name: 'Metals', degree: '3rd', reason: 'Supply chain rerouting costs' }
    ],
    daily_life: 'IT hiring freezes; pharma exports disrupted; imported electronics get costlier',
    watch: 'Whether sanctions target India directly or key trade partners like Russia'
  },
  TRADE_WAR: {
    affected_spreads: ['usdinr_basis', 'infy_adr_spread', 'icici_adr_spread', 'nifty_basis'],
    sectors: [
      { name: 'IT Services', degree: '1st', reason: 'US client budget cuts & H1B risks' },
      { name: 'Auto', degree: '2nd', reason: 'Export tariff exposure & parts costs' },
      { name: 'Pharma', degree: '2nd', reason: 'Generics export market uncertainty' },
      { name: 'Textiles', degree: '3rd', reason: 'Shift in sourcing patterns' }
    ],
    daily_life: 'IT job market tightens; imported goods from iPhones to cars get costlier',
    watch: 'Whether India gets direct tariff hits or benefits as alternate supplier'
  },
  CURRENCY: {
    affected_spreads: ['usdinr_basis', 'mcx_gold_comex', 'india_vix', 'infy_adr_spread'],
    sectors: [
      { name: 'Banks', degree: '1st', reason: 'Forex hedging costs & NPA risk from importers' },
      { name: 'IT Services', degree: '1st', reason: 'Revenue boost from weak rupee (positive)' },
      { name: 'Importers', degree: '2nd', reason: 'Raw material cost surge' },
      { name: 'FMCG', degree: '3rd', reason: 'Imported input cost inflation' }
    ],
    daily_life: 'Rupee weakens — imported goods costlier, foreign education/travel more expensive',
    watch: 'RBI forex reserves drawdown pace and DXY (Dollar Index) direction'
  },
  PANDEMIC: {
    affected_spreads: ['india_vix', 'nifty_basis', 'banknifty_basis', 'banknifty_nifty_ratio'],
    sectors: [
      { name: 'Pharma', degree: '1st', reason: 'Vaccine/drug demand surge (positive)' },
      { name: 'Hospitals', degree: '1st', reason: 'Healthcare capacity strain' },
      { name: 'Travel & Hospitality', degree: '1st', reason: 'Lockdown decimates revenue' },
      { name: 'Banks', degree: '2nd', reason: 'Loan moratorium & NPA fears' }
    ],
    daily_life: 'Lockdown fears — jobs at risk, markets crash, pharma stocks rally',
    watch: 'WHO classification level and whether India reports community transmission'
  },
  CLIMATE: {
    affected_spreads: ['mcx_crude_brent', 'usdinr_basis', 'nifty_basis'],
    sectors: [
      { name: 'Insurance', degree: '1st', reason: 'Claims surge from disaster damage' },
      { name: 'Agriculture', degree: '1st', reason: 'Crop damage & food inflation' },
      { name: 'Infrastructure', degree: '2nd', reason: 'Reconstruction demand & delays' },
      { name: 'Banks', degree: '3rd', reason: 'Agricultural loan defaults' }
    ],
    daily_life: 'Food prices spike if crops damaged; insurance premiums rise',
    watch: 'Monsoon forecast deviation and agricultural commodity futures prices'
  },
  POLITICAL: {
    affected_spreads: ['india_vix', 'nifty_basis', 'usdinr_basis'],
    sectors: [
      { name: 'Banks', degree: '2nd', reason: 'Policy uncertainty dampens credit growth' },
      { name: 'Infrastructure', degree: '2nd', reason: 'Government spending freeze risk' },
      { name: 'Defense', degree: '2nd', reason: 'Budget allocation uncertainty' }
    ],
    daily_life: 'Policy uncertainty — FII outflows — rupee pressure — import inflation cycle',
    watch: 'FII flow data turning negative and government stability indicators'
  }
};

// ─── RSS Fetching for Global Events ──────────────────────────────────────────

function buildGlobalQueries() {
  const queries = [];
  for (const [type, keywords] of Object.entries(GLOBAL_KEYWORDS)) {
    // Batch keywords into chunks of 4 for URL length limits
    for (let i = 0; i < keywords.length; i += 4) {
      const chunk = keywords.slice(i, i + 4);
      const q = chunk.map(k => `"${k}"`).join(' OR ');
      queries.push({ type, query: q });
    }
  }
  return queries;
}

function parseRSSXML(xmlText) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xmlText)) !== null) {
    const itemXml = match[1];
    const title = extractTag(itemXml, 'title');
    const pubDate = extractTag(itemXml, 'pubDate');
    const source = extractTag(itemXml, 'source');
    if (title) {
      items.push({
        title: decodeEntities(title),
        pubDate: pubDate ? new Date(pubDate).getTime() : Date.now(),
        source: source ? decodeEntities(source) : ''
      });
    }
  }
  return items;
}

function extractTag(xml, tag) {
  const regex = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`);
  const m = regex.exec(xml);
  return m ? (m[1] || m[2] || null) : null;
}

function decodeEntities(text) {
  return text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'");
}

async function fetchGlobalNews() {
  const queries = buildGlobalQueries();
  const sixHoursAgo = Date.now() - 6 * 60 * 60 * 1000;
  const allItems = [];

  const promises = queries.map(async ({ type, query }) => {
    try {
      const url = `${NEWS_RSS_BASE}?q=${encodeURIComponent(query)}&hl=en&gl=US&ceid=US:en`;
      const resp = await fetch(url);
      if (!resp.ok) return [];
      const text = await resp.text();
      return parseRSSXML(text)
        .filter(item => item.pubDate > sixHoursAgo)
        .map(item => ({ ...item, type }));
    } catch {
      return [];
    }
  });

  const results = await Promise.allSettled(promises);
  for (const r of results) {
    if (r.status === 'fulfilled') allItems.push(...r.value);
  }

  // Deduplicate
  const seen = new Set();
  return allItems.filter(item => {
    const key = item.title.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 50);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── Classify Global Events ──────────────────────────────────────────────────

function classifyGlobalHeadline(headline) {
  const lower = headline.toLowerCase();
  const matches = [];

  for (const [type, keywords] of Object.entries(GLOBAL_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw.toLowerCase())) {
        matches.push({ type, keyword: kw, score: kw.length });
      }
    }
  }

  if (matches.length === 0) return null;
  matches.sort((a, b) => b.score - a.score);
  return matches[0].type;
}

function scoreGlobalRelevance(headline) {
  const lower = headline.toLowerCase();
  let score = 0;
  const critical = ['war', 'attack', 'crash', 'crisis', 'collapse', 'pandemic', 'nuclear', 'default'];
  const high = ['sanctions', 'tariffs', 'surge', 'plunge', 'emergency', 'escalation'];
  const medium = ['tension', 'risk', 'threat', 'cut', 'warning'];

  for (const kw of critical) { if (lower.includes(kw)) score += 4; }
  for (const kw of high) { if (lower.includes(kw)) score += 3; }
  for (const kw of medium) { if (lower.includes(kw)) score += 2; }
  return score;
}

// ─── Severity Calculation ────────────────────────────────────────────────────

function calculateSeverity(eventType, currentSpreads) {
  const transmission = TRANSMISSION_MAP[eventType];
  if (!transmission) return 'LOW';

  const affectedSpreads = transmission.affected_spreads;
  let dislocatedCount = 0;
  let hasExtreme = false;

  for (const spreadKey of affectedSpreads) {
    const spread = currentSpreads[spreadKey];
    if (!spread) continue;
    const z = spread.absZscore || 0;
    if (z >= 1.5) dislocatedCount++;
    if (z >= 3.0) hasExtreme = true;
  }

  let severity;
  if (dislocatedCount >= 4) severity = 'CRITICAL';
  else if (dislocatedCount >= 2) severity = 'HIGH';
  else if (dislocatedCount >= 1) severity = 'MODERATE';
  else severity = 'LOW';

  // Boost if any affected spread is extreme
  if (hasExtreme && severity !== 'CRITICAL') {
    const levels = ['LOW', 'MODERATE', 'HIGH', 'CRITICAL'];
    const idx = levels.indexOf(severity);
    severity = levels[Math.min(idx + 1, 3)];
  }

  return severity;
}

// ─── Generate Ripple Check Output ────────────────────────────────────────────

function generateRippleCheck(topEvent, eventType, severity, currentSpreads) {
  const transmission = TRANSMISSION_MAP[eventType];
  if (!transmission) return null;

  // Build connections with degree info
  const connections = transmission.sectors.map(s => ({
    sector: s.name,
    degree: s.degree,
    reason: s.reason
  }));

  // Identify which affected spreads are currently dislocated
  const activeAffected = transmission.affected_spreads.filter(key => {
    const s = currentSpreads[key];
    return s && (s.absZscore || 0) >= 1.0;
  });

  return {
    active: true,
    event: topEvent.title,
    type: eventType,
    severity,
    connections,
    daily_life_impact: transmission.daily_life,
    watch: transmission.watch,
    affected_spreads: activeAffected,
    source_headlines: [topEvent.title],
    source: topEvent.source || '',
    timestamp: Date.now()
  };
}

// ─── Main Export: Analyze Global Ripple ───────────────────────────────────────

export async function analyzeGlobalRipple(currentSpreads) {
  console.log('[DR Ripple] Scanning global events...');

  try {
    const globalItems = await fetchGlobalNews();

    if (globalItems.length === 0) {
      const result = { active: false, message: 'No active global ripple detected.', timestamp: Date.now() };
      await chrome.storage.local.set({ lastRippleCheck: result });
      console.log('[DR Ripple] No global events found.');
      return result;
    }

    // Score and rank
    const scored = globalItems.map(item => {
      const classified = classifyGlobalHeadline(item.title) || item.type;
      return {
        ...item,
        classifiedType: classified,
        relevance: scoreGlobalRelevance(item.title)
      };
    });

    // Sort by relevance * recency
    const sixHoursAgo = Date.now() - 6 * 60 * 60 * 1000;
    scored.sort((a, b) => {
      const aScore = a.relevance * (1 + (a.pubDate - sixHoursAgo) / (6 * 60 * 60 * 1000));
      const bScore = b.relevance * (1 + (b.pubDate - sixHoursAgo) / (6 * 60 * 60 * 1000));
      return bScore - aScore;
    });

    // Take top event
    const topEvent = scored[0];
    if (!topEvent || topEvent.relevance < 2) {
      const result = { active: false, message: 'No active global ripple detected.', timestamp: Date.now() };
      await chrome.storage.local.set({ lastRippleCheck: result });
      return result;
    }

    const eventType = topEvent.classifiedType;
    const severity = calculateSeverity(eventType, currentSpreads || {});
    const ripple = generateRippleCheck(topEvent, eventType, severity, currentSpreads || {});

    if (!ripple) {
      const result = { active: false, message: 'No active global ripple detected.', timestamp: Date.now() };
      await chrome.storage.local.set({ lastRippleCheck: result });
      return result;
    }

    // Add additional headlines from same type
    const sameType = scored.filter(s => s.classifiedType === eventType).slice(0, 3);
    ripple.source_headlines = sameType.map(s => s.title);

    await chrome.storage.local.set({ lastRippleCheck: ripple });
    console.log(`[DR Ripple] Global event detected: ${eventType} — Severity: ${severity}`);
    return ripple;

  } catch (err) {
    console.error('[DR Ripple] Analysis failed:', err);
    const result = { active: false, message: 'Ripple check failed.', timestamp: Date.now() };
    await chrome.storage.local.set({ lastRippleCheck: result });
    return result;
  }
}

export async function getLastRippleCheck() {
  const { lastRippleCheck } = await chrome.storage.local.get('lastRippleCheck');
  return lastRippleCheck || { active: false, message: 'No active global ripple detected.' };
}
