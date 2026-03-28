// Dislocation Radar India — News Detection Layer
// Polls Google News RSS for geopolitical/macro keywords, classifies events

const NEWS_RSS_BASE = 'https://news.google.com/rss/search';

const KEYWORD_GROUPS = {
  GEO: [
    'India Pakistan', 'India attack', 'surgical strike', 'airstrike India',
    'border tension India', 'Operation Sindoor', 'nuclear India Pakistan',
    'ceasefire India', 'missile India', 'India military', 'LoC firing',
    'Indian Air Force strike', 'Pakistan retaliation', 'India war',
    'India China border', 'Ladakh standoff', 'Galwan'
  ],
  MAC: [
    'RBI rate decision', 'RBI repo rate', 'Fed rate decision', 'FOMC decision',
    'CPI India', 'India inflation', 'India GDP', 'fiscal deficit India',
    'current account deficit India', 'RBI surprise', 'Fed surprise',
    'quantitative tightening', 'taper', 'RBI intervention'
  ],
  SUPPLY: [
    'OPEC cut', 'OPEC production', 'crude oil attack', 'oil supply disruption',
    'Middle East oil', 'Strait of Hormuz', 'pipeline attack', 'refinery attack',
    'oil tanker attack', 'OPEC+ meeting', 'Saudi oil'
  ],
  CRISIS: [
    'war', 'US sanctions India', 'market crash India', 'bank crisis India',
    'default India', 'NBFC crisis', 'liquidity crisis India', 'panic selling India',
    'circuit breaker NSE', 'geopolitical crisis', 'nuclear threat',
    'Iran Israel war', 'Middle East war', 'Russia Ukraine escalation'
  ]
};

// Flatten for quick RSS query
const ALL_KEYWORDS = Object.values(KEYWORD_GROUPS).flat();

// Build RSS query groups (Google News RSS has URL length limits)
function buildRSSQueries() {
  const queries = [];

  for (const [type, keywords] of Object.entries(KEYWORD_GROUPS)) {
    // Group keywords into manageable chunks
    const chunks = [];
    for (let i = 0; i < keywords.length; i += 5) {
      chunks.push(keywords.slice(i, i + 5));
    }

    for (const chunk of chunks) {
      const q = chunk.map(k => `"${k}"`).join(' OR ');
      queries.push({ type, query: q });
    }
  }

  return queries;
}

// Parse RSS XML
function parseRSSXML(xmlText) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = itemRegex.exec(xmlText)) !== null) {
    const itemXml = match[1];

    const title = extractTag(itemXml, 'title');
    const pubDate = extractTag(itemXml, 'pubDate');
    const link = extractTag(itemXml, 'link');
    const source = extractTag(itemXml, 'source');

    if (title) {
      items.push({
        title: decodeHTMLEntities(title),
        pubDate: pubDate ? new Date(pubDate).getTime() : Date.now(),
        link: link || '',
        source: source ? decodeHTMLEntities(source) : ''
      });
    }
  }

  return items;
}

function extractTag(xml, tag) {
  const regex = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`);
  const match = regex.exec(xml);
  if (!match) return null;
  return match[1] || match[2] || null;
}

function decodeHTMLEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}

// Classify a headline
function classifyHeadline(headline) {
  const lower = headline.toLowerCase();
  const matches = [];

  for (const [type, keywords] of Object.entries(KEYWORD_GROUPS)) {
    for (const keyword of keywords) {
      if (lower.includes(keyword.toLowerCase())) {
        matches.push({ type, keyword, score: keyword.length });
      }
    }
  }

  if (matches.length === 0) return null;

  // Return the best match (longest keyword match = most specific)
  matches.sort((a, b) => b.score - a.score);
  return matches[0].type;
}

// Compute relevance score
function computeRelevance(headline) {
  const lower = headline.toLowerCase();
  let score = 0;

  // High-impact keywords
  const highImpact = ['war', 'attack', 'strike', 'missile', 'nuclear', 'crash', 'crisis', 'panic'];
  const medImpact = ['tension', 'border', 'sanctions', 'rate decision', 'surprise', 'cut'];

  for (const kw of highImpact) {
    if (lower.includes(kw)) score += 3;
  }
  for (const kw of medImpact) {
    if (lower.includes(kw)) score += 2;
  }

  // India-specific boost
  if (lower.includes('india') || lower.includes('nifty') || lower.includes('nse') || lower.includes('rbi')) {
    score += 2;
  }

  // Recency boost handled by caller
  return score;
}

// Main news detection function
export async function detectNews() {
  console.log('[DR] Running news detection...');

  const queries = buildRSSQueries();
  const allItems = [];
  const oneHourAgo = Date.now() - 60 * 60 * 1000;

  // Fetch RSS feeds in parallel (limit concurrency)
  const fetchPromises = queries.map(async ({ type, query }) => {
    try {
      const url = `${NEWS_RSS_BASE}?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`;
      const response = await fetch(url);
      if (!response.ok) return [];

      const text = await response.text();
      const items = parseRSSXML(text);

      return items
        .filter(item => item.pubDate > oneHourAgo)
        .map(item => ({
          ...item,
          detectedType: type,
          classifiedType: classifyHeadline(item.title) || type,
          relevance: computeRelevance(item.title)
        }));
    } catch (err) {
      console.warn(`[DR] News fetch failed for ${type}:`, err.message);
      return [];
    }
  });

  const results = await Promise.allSettled(fetchPromises);

  for (const result of results) {
    if (result.status === 'fulfilled') {
      allItems.push(...result.value);
    }
  }

  // Deduplicate by title similarity
  const deduplicated = deduplicateNews(allItems);

  // Sort by relevance * recency
  deduplicated.sort((a, b) => {
    const aScore = a.relevance * (1 + (a.pubDate - oneHourAgo) / (60 * 60 * 1000));
    const bScore = b.relevance * (1 + (b.pubDate - oneHourAgo) / (60 * 60 * 1000));
    return bScore - aScore;
  });

  // Keep top 10 most relevant
  const topEvents = deduplicated.slice(0, 10).map(item => ({
    headline: item.title,
    type: item.classifiedType,
    timestamp: item.pubDate,
    source: item.source,
    link: item.link,
    relevance: item.relevance
  }));

  // Store
  await chrome.storage.local.set({ activeEvents: topEvents });

  console.log(`[DR] News detection complete. ${topEvents.length} events found.`);
  return topEvents;
}

function deduplicateNews(items) {
  const seen = new Set();
  return items.filter(item => {
    // Simple dedup by normalized title prefix (first 50 chars)
    const key = item.title.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 50);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Get currently active events from storage
export async function getActiveEvents() {
  const { activeEvents = [] } = await chrome.storage.local.get('activeEvents');
  return activeEvents;
}
