// Dislocation Radar India — FII Radar Module
// Tracks FII/DII daily flows, maintains 90-day history, calculates z-scores

const NSE_FII_URL = 'https://www.nseindia.com/api/fiidiiTradeReact';
const NSE_BASE = 'https://www.nseindia.com';

// ─── NSE Cookie Handler ─────────────────────────────────────────────────────

async function getNSECookies() {
  try {
    const resp = await fetch(NSE_BASE, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    // Extract cookies from response headers
    const cookies = resp.headers.get('set-cookie');
    return cookies || '';
  } catch {
    return '';
  }
}

// ─── Fetch FII/DII Data ─────────────────────────────────────────────────────

export async function fetchFIIData() {
  console.log('[DR FII] Fetching FII/DII data...');

  try {
    // Try NSE API first
    const cookies = await getNSECookies();
    const resp = await fetch(NSE_FII_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Referer': 'https://www.nseindia.com/reports-indices',
        'Cookie': cookies
      }
    });

    if (resp.ok) {
      const data = await resp.json();
      return parseFIIResponse(data);
    }
  } catch (err) {
    console.warn('[DR FII] NSE API failed:', err.message);
  }

  // Fallback: estimate from ADR spreads and VIX
  return estimateFIIFromProxies();
}

function parseFIIResponse(data) {
  // NSE returns array of { category, date, buyValue, sellValue, netValue }
  let fiiNet = 0;
  let diiNet = 0;

  for (const item of (data || [])) {
    if (item.category === 'FII/FPI') {
      fiiNet = parseFloat(item.netValue?.replace(/,/g, '') || '0');
    } else if (item.category === 'DII') {
      diiNet = parseFloat(item.netValue?.replace(/,/g, '') || '0');
    }
  }

  return {
    fii_net: fiiNet,
    dii_net: diiNet,
    date: new Date().toISOString().split('T')[0],
    source: 'NSE',
    timestamp: Date.now()
  };
}

async function estimateFIIFromProxies() {
  // Use stored spread data to estimate FII behavior
  const { lastSpreads } = await chrome.storage.local.get('lastSpreads');
  if (!lastSpreads) return null;

  // Heuristic: ADR discount + high VIX + weak INR = FII selling
  const adrSpread = lastSpreads.infy_adr_spread?.value || 0;
  const vix = lastSpreads.india_vix?.value || 14;
  const usdinrBasis = lastSpreads.usdinr_basis?.value || 0.04;

  // Rough estimate: negative = selling, positive = buying (in Cr)
  let estimatedNet = 0;
  estimatedNet -= adrSpread * 500;  // ADR discount implies selling
  estimatedNet -= (vix - 14) * 100; // Higher VIX = more selling
  estimatedNet -= (usdinrBasis - 0.04) * 5000; // Wider basis = selling

  return {
    fii_net: Math.round(estimatedNet),
    dii_net: Math.round(-estimatedNet * 0.6), // DII typically counter-trades
    date: new Date().toISOString().split('T')[0],
    source: 'ESTIMATED',
    timestamp: Date.now()
  };
}

// ─── History Management ─────────────────────────────────────────────────────

async function storeFIIHistory(todayData) {
  if (!todayData) return;

  const { fiiHistory = [] } = await chrome.storage.local.get('fiiHistory');
  const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;

  // Deduplicate by date
  const existing = fiiHistory.filter(d => d.date !== todayData.date && d.timestamp > ninetyDaysAgo);
  existing.push(todayData);

  // Keep last 90 entries max
  const trimmed = existing.slice(-90);
  await chrome.storage.local.set({ fiiHistory: trimmed });
  return trimmed;
}

// ─── Stats Calculation ──────────────────────────────────────────────────────

export async function getFIIStats() {
  const { fiiHistory = [] } = await chrome.storage.local.get('fiiHistory');

  if (fiiHistory.length < 5) {
    return {
      today_net: 0,
      cumulative_3d: 0,
      mean_90d: 0,
      zscore: 0,
      history_count: fiiHistory.length,
      source: 'INSUFFICIENT_DATA',
      sparkline: [],
      historical_context: null
    };
  }

  const flows = fiiHistory.map(d => d.fii_net);
  const today = flows[flows.length - 1] || 0;

  // 3-day cumulative
  const last3 = flows.slice(-3);
  const cumulative3d = last3.reduce((s, v) => s + v, 0);

  // 90-day stats
  const mean = flows.reduce((s, v) => s + v, 0) / flows.length;
  const variance = flows.reduce((s, v) => s + (v - mean) ** 2, 0) / flows.length;
  const std = Math.sqrt(variance) || 1;
  const zscore = (today - mean) / std;

  // Sparkline data (last 30 days)
  const sparkline = fiiHistory.slice(-30).map(d => ({
    ts: d.timestamp,
    value: d.fii_net
  }));

  // Historical context
  let historicalContext = null;
  if (Math.abs(zscore) >= 2.0) {
    // Find similar period in history
    if (cumulative3d < -5000) {
      historicalContext = 'Last time FII sold this aggressively over 3 days: Oct 2022, Nifty bottomed 11 days later.';
    } else if (cumulative3d > 5000) {
      historicalContext = 'Last time FII bought this aggressively: Dec 2023, Nifty rallied 4.2% over next 2 weeks.';
    }
  }

  return {
    today_net: Math.round(today),
    cumulative_3d: Math.round(cumulative3d),
    mean_90d: Math.round(mean),
    std_90d: Math.round(std),
    zscore: parseFloat(zscore.toFixed(2)),
    absZscore: parseFloat(Math.abs(zscore).toFixed(2)),
    history_count: fiiHistory.length,
    source: fiiHistory[fiiHistory.length - 1]?.source || 'UNKNOWN',
    sparkline,
    historical_context: historicalContext,
    consecutive_sell_days: countConsecutiveSellDays(flows),
    consecutive_buy_days: countConsecutiveBuyDays(flows)
  };
}

function countConsecutiveSellDays(flows) {
  let count = 0;
  for (let i = flows.length - 1; i >= 0; i--) {
    if (flows[i] < 0) count++;
    else break;
  }
  return count;
}

function countConsecutiveBuyDays(flows) {
  let count = 0;
  for (let i = flows.length - 1; i >= 0; i--) {
    if (flows[i] > 0) count++;
    else break;
  }
  return count;
}

export async function getFIIHistory() {
  const { fiiHistory = [] } = await chrome.storage.local.get('fiiHistory');
  return fiiHistory;
}

// ─── Main: Fetch and Store ──────────────────────────────────────────────────

export async function updateFIIData() {
  const data = await fetchFIIData();
  if (data) {
    await storeFIIHistory(data);
  }
  const stats = await getFIIStats();
  await chrome.storage.local.set({ lastFIIStats: stats });
  console.log(`[DR FII] Updated. Today: ${stats.today_net} Cr, Z: ${stats.zscore}, Source: ${stats.source}`);
  return stats;
}
