// Dislocation Radar India — Background Service Worker
// Core orchestrator: data fetching, spread calculation, alerts, alarm management

import { detectNews, getActiveEvents } from './news-detector.js';
import { findBestAnalog } from './analog-matcher.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const YAHOO_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const EXCHANGE_RATE_URL = 'https://open.er-api.com/v6/latest/USD';

const YAHOO_TICKERS = {
  nifty_spot: '%5ENSEI',
  nifty_fut: 'NIFTY_F.NS',
  banknifty_spot: '%5ENSEBANK',
  banknifty_fut: 'BANKNIFTY_F.NS',
  comex_gold: 'GC%3DF',
  comex_silver: 'SI%3DF',
  brent_crude: 'BZ%3DF',
  mcx_gold: 'GOLDM.NS',
  mcx_silver: 'SILVERM.NS',
  mcx_crude: 'CRUDEOIL.NS',
  usdinr_spot: 'USDINR%3DX',
  usdinr_fut: 'USDINR.NS',
  india_vix: '%5EINDIAVIX',
  infy_nse: 'INFY.NS',
  infy_adr: 'INFY',
  icici_nse: 'ICICIBANK.NS',
  icici_adr: 'IBN',
  hdb_nse: 'HDFCBANK.NS',
  hdb_adr: 'HDB',
  wit_nse: 'WIPRO.NS',
  wit_adr: 'WIT'
};

const DEFAULT_SETTINGS = {
  enabledSpreads: [
    'nifty_basis', 'banknifty_basis', 'mcx_gold_comex', 'mcx_silver_comex',
    'mcx_crude_brent', 'usdinr_basis', 'banknifty_nifty_ratio',
    'india_vix', 'infy_adr_spread', 'icici_adr_spread'
  ],
  zThresholds: { elevated: 1.5, warning: 2.0, alert: 2.5, extreme: 3.0 },
  newsEnabled: true,
  soundEnabled: true,
  widgetEnabled: true,
  widgetSites: ['kite.zerodha.com', 'tradingview.com', 'moneycontrol.com'],
  darkMode: true,
  refreshInterval: 60
};

// ─── Alarm Setup ──────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async () => {
  await setupAlarms();
  await initializeSettings();
  await loadBaselines();
  console.log('[DR] Extension installed. Alarms set.');
  // Run initial fetch
  fetchAndCalculate();
});

chrome.runtime.onStartup.addListener(async () => {
  await setupAlarms();
  await loadBaselines();
  console.log('[DR] Browser started. Alarms verified.');
});

async function setupAlarms() {
  const settings = await getSettings();
  const interval = (settings.refreshInterval || 60) / 60; // convert seconds to minutes

  const existing = await chrome.alarms.getAll();
  const hasData = existing.some(a => a.name === 'fetchData');
  const hasNews = existing.some(a => a.name === 'fetchNews');

  if (!hasData) {
    chrome.alarms.create('fetchData', { periodInMinutes: Math.max(0.5, interval) });
  }
  if (!hasNews) {
    chrome.alarms.create('fetchNews', { periodInMinutes: 5 });
  }
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'fetchData') {
    await fetchAndCalculate();
  } else if (alarm.name === 'fetchNews') {
    const settings = await getSettings();
    if (settings.newsEnabled) {
      await detectNews();
      await checkHighPriorityAlerts();
    }
  }
});

// ─── Settings ─────────────────────────────────────────────────────────────────

async function initializeSettings() {
  const { settings } = await chrome.storage.sync.get('settings');
  if (!settings) {
    await chrome.storage.sync.set({ settings: DEFAULT_SETTINGS });
  }
}

async function getSettings() {
  const { settings } = await chrome.storage.sync.get('settings');
  return settings || DEFAULT_SETTINGS;
}

// ─── Baselines ────────────────────────────────────────────────────────────────

let baselines = null;

async function loadBaselines() {
  try {
    const url = chrome.runtime.getURL('data/baselines.json');
    const response = await fetch(url);
    const data = await response.json();
    baselines = data.baselines;
    console.log('[DR] Baselines loaded:', Object.keys(baselines).length, 'spreads');
  } catch (err) {
    console.error('[DR] Failed to load baselines:', err);
  }
}

// ─── Yahoo Finance Fetcher ────────────────────────────────────────────────────

async function fetchYahooQuote(ticker) {
  try {
    const url = `${YAHOO_BASE}${ticker}?interval=1d&range=1d`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Yahoo ${ticker}: HTTP ${response.status}`);
    }

    const data = await response.json();
    const result = data.chart?.result?.[0];
    if (!result) throw new Error(`No data for ${ticker}`);

    const meta = result.meta;
    const price = meta.regularMarketPrice;
    const prevClose = meta.chartPreviousClose || meta.previousClose;
    const marketState = meta.marketState; // PRE, REGULAR, POST, CLOSED

    return {
      price,
      prevClose,
      change: price - prevClose,
      changePct: ((price - prevClose) / prevClose) * 100,
      marketState,
      currency: meta.currency,
      timestamp: meta.regularMarketTime * 1000
    };
  } catch (err) {
    console.warn(`[DR] Yahoo fetch failed for ${ticker}:`, err.message);
    return null;
  }
}

async function fetchExchangeRate() {
  try {
    const response = await fetch(EXCHANGE_RATE_URL);
    if (!response.ok) throw new Error(`ExchangeRate API: HTTP ${response.status}`);
    const data = await response.json();
    return data.rates?.INR || null;
  } catch (err) {
    console.warn('[DR] Exchange rate fetch failed:', err.message);
    return null;
  }
}

// ─── Batch Fetcher ────────────────────────────────────────────────────────────

async function fetchAllData() {
  const tickerKeys = Object.keys(YAHOO_TICKERS);

  // Fetch Yahoo quotes in parallel (batched)
  const yahooPromises = tickerKeys.map(key =>
    fetchYahooQuote(YAHOO_TICKERS[key]).then(data => [key, data])
  );

  const exchangePromise = fetchExchangeRate();

  const results = await Promise.allSettled([...yahooPromises, exchangePromise]);

  const quotes = {};
  for (let i = 0; i < tickerKeys.length; i++) {
    const result = results[i];
    if (result.status === 'fulfilled' && result.value) {
      const [key, data] = result.value;
      quotes[key] = data;
    }
  }

  const exchangeResult = results[tickerKeys.length];
  const usdInr = exchangeResult.status === 'fulfilled' ? exchangeResult.value : null;

  // Fallback: use Yahoo USDINR if exchange API fails
  if (!usdInr && quotes.usdinr_spot) {
    quotes._usdInrRate = quotes.usdinr_spot.price;
  } else {
    quotes._usdInrRate = usdInr;
  }

  return quotes;
}

// ─── Spread Calculations ─────────────────────────────────────────────────────

function calculateSpreads(quotes) {
  const spreads = {};
  const usdInr = quotes._usdInrRate || 83.5; // fallback

  // 1. Nifty Basis
  if (quotes.nifty_spot?.price && quotes.nifty_fut?.price) {
    const basis = quotes.nifty_fut.price - quotes.nifty_spot.price;
    spreads.nifty_basis = {
      value: basis,
      pct: (basis / quotes.nifty_spot.price) * 100,
      spot: quotes.nifty_spot.price,
      fut: quotes.nifty_fut.price,
      unit: 'pts'
    };
  }

  // 2. BankNifty Basis
  if (quotes.banknifty_spot?.price && quotes.banknifty_fut?.price) {
    const basis = quotes.banknifty_fut.price - quotes.banknifty_spot.price;
    spreads.banknifty_basis = {
      value: basis,
      pct: (basis / quotes.banknifty_spot.price) * 100,
      spot: quotes.banknifty_spot.price,
      fut: quotes.banknifty_fut.price,
      unit: 'pts'
    };
  }

  // 3. MCX Gold - COMEX Gold
  // COMEX Gold is USD/troy oz. MCX Gold is INR/10g. 1 troy oz = 31.1035g
  if (quotes.mcx_gold?.price && quotes.comex_gold?.price) {
    const comexInInr = (quotes.comex_gold.price * usdInr * 10) / 31.1035;
    const gap = quotes.mcx_gold.price - comexInInr;
    spreads.mcx_gold_comex = {
      value: gap,
      comex_converted: comexInInr,
      mcx: quotes.mcx_gold.price,
      unit: 'INR/10g'
    };
  }

  // 4. MCX Silver - COMEX Silver
  // COMEX Silver is USD/troy oz. MCX Silver is INR/kg. 1 troy oz = 31.1035g
  if (quotes.mcx_silver?.price && quotes.comex_silver?.price) {
    const comexInInr = (quotes.comex_silver.price * usdInr * 1000) / 31.1035;
    const gap = quotes.mcx_silver.price - comexInInr;
    spreads.mcx_silver_comex = {
      value: gap,
      comex_converted: comexInInr,
      mcx: quotes.mcx_silver.price,
      unit: 'INR/kg'
    };
  }

  // 5. MCX Crude - ICE Brent
  if (quotes.mcx_crude?.price && quotes.brent_crude?.price) {
    const brentInInr = quotes.brent_crude.price * usdInr;
    const gap = quotes.mcx_crude.price - brentInInr;
    spreads.mcx_crude_brent = {
      value: gap,
      brent_converted: brentInInr,
      mcx: quotes.mcx_crude.price,
      unit: 'INR/bbl'
    };
  }

  // 6. USDINR Futures - Spot
  if (quotes.usdinr_fut?.price && quotes.usdinr_spot?.price) {
    const basis = quotes.usdinr_fut.price - quotes.usdinr_spot.price;
    spreads.usdinr_basis = {
      value: basis,
      spot: quotes.usdinr_spot.price,
      fut: quotes.usdinr_fut.price,
      unit: 'INR'
    };
  }

  // 7. BankNifty/Nifty Ratio
  if (quotes.banknifty_spot?.price && quotes.nifty_spot?.price) {
    const ratio = quotes.banknifty_spot.price / quotes.nifty_spot.price;
    spreads.banknifty_nifty_ratio = {
      value: ratio,
      unit: 'ratio'
    };
  }

  // 8. INFY NSE vs ADR
  // ADR ratio for INFY is 1:1
  if (quotes.infy_nse?.price && quotes.infy_adr?.price) {
    const adrInInr = quotes.infy_adr.price * usdInr * 1; // ADR ratio = 1
    const spreadPct = ((quotes.infy_nse.price - adrInInr) / adrInInr) * 100;
    spreads.infy_adr_spread = {
      value: spreadPct,
      nse: quotes.infy_nse.price,
      adr: quotes.infy_adr.price,
      adr_inr: adrInInr,
      unit: '%'
    };
  }

  // 9. ICICI Bank NSE vs IBN ADR
  // IBN ADR ratio is 2:1 (1 ADR = 2 shares)
  if (quotes.icici_nse?.price && quotes.icici_adr?.price) {
    const adrInInr = (quotes.icici_adr.price * usdInr) / 2; // ADR ratio = 2
    const spreadPct = ((quotes.icici_nse.price - adrInInr) / adrInInr) * 100;
    spreads.icici_adr_spread = {
      value: spreadPct,
      nse: quotes.icici_nse.price,
      adr: quotes.icici_adr.price,
      adr_inr: adrInInr,
      unit: '%'
    };
  }

  // 10. India VIX
  if (quotes.india_vix?.price) {
    const vixChange = quotes.india_vix.changePct || 0;
    spreads.india_vix = {
      value: quotes.india_vix.price,
      change_pct: vixChange,
      unit: 'level'
    };
  }

  return spreads;
}

// ─── Z-Score Calculation ──────────────────────────────────────────────────────

function calculateZScores(spreads) {
  if (!baselines) return spreads;

  for (const [key, spread] of Object.entries(spreads)) {
    const baseline = baselines[key];
    if (!baseline) continue;

    const zscore = (Math.abs(spread.value) - baseline.mean) / baseline.std;
    const percentile = zScoreToPercentile(Math.abs(zscore));

    spread.zscore = parseFloat(zscore.toFixed(2));
    spread.absZscore = parseFloat(Math.abs(zscore).toFixed(2));
    spread.percentile = parseFloat(percentile.toFixed(1));
    spread.baseline_mean = baseline.mean;
    spread.baseline_std = baseline.std;
    spread.label = baseline.label;

    // Status classification
    if (Math.abs(zscore) >= 3.0) spread.status = 'extreme';
    else if (Math.abs(zscore) >= 2.5) spread.status = 'alert';
    else if (Math.abs(zscore) >= 2.0) spread.status = 'warning';
    else if (Math.abs(zscore) >= 1.5) spread.status = 'elevated';
    else spread.status = 'normal';
  }

  return spreads;
}

function zScoreToPercentile(z) {
  // Approximation of normal CDF
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.sqrt(2);
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return ((1.0 + sign * y) / 2.0) * 100;
}

// ─── Market Hours ─────────────────────────────────────────────────────────────

function getMarketStatus() {
  const now = new Date();
  // Convert to IST (UTC+5:30)
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const ist = new Date(utcMs + 5.5 * 3600000);

  const day = ist.getDay(); // 0=Sun, 6=Sat
  const hour = ist.getHours();
  const minute = ist.getMinutes();
  const timeMinutes = hour * 60 + minute;

  const nseOpen = 9 * 60 + 15;  // 9:15 AM
  const nseClose = 15 * 60 + 30; // 3:30 PM
  const mcxOpen = 9 * 60;        // 9:00 AM
  const mcxClose = 23 * 60 + 30; // 11:30 PM

  return {
    isWeekday: day >= 1 && day <= 5,
    nseOpen: day >= 1 && day <= 5 && timeMinutes >= nseOpen && timeMinutes <= nseClose,
    mcxOpen: day >= 1 && day <= 5 && timeMinutes >= mcxOpen && timeMinutes <= mcxClose,
    // NYSE overlap with IST: roughly 19:00-01:30 IST (7 PM to 1:30 AM next day)
    nyseOverlap: (timeMinutes >= 19 * 60) || (timeMinutes <= 1 * 60 + 30),
    istTime: ist.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
    istDate: ist.toLocaleDateString('en-IN')
  };
}

// ─── History Storage ──────────────────────────────────────────────────────────

async function storeSpreadHistory(spreads) {
  const { spreadHistory = {} } = await chrome.storage.local.get('spreadHistory');
  const now = Date.now();
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

  for (const [key, spread] of Object.entries(spreads)) {
    if (!spreadHistory[key]) spreadHistory[key] = [];
    spreadHistory[key].push({ ts: now, value: spread.value, zscore: spread.zscore || 0 });
    // Prune older than 30 days
    spreadHistory[key] = spreadHistory[key].filter(p => p.ts > thirtyDaysAgo);
  }

  await chrome.storage.local.set({ spreadHistory });
}

// ─── Main Fetch & Calculate ───────────────────────────────────────────────────

async function fetchAndCalculate() {
  console.log('[DR] Fetching data...');
  const marketStatus = getMarketStatus();

  try {
    const quotes = await fetchAllData();
    const spreads = calculateSpreads(quotes);
    const spreadsWithZ = calculateZScores(spreads);

    // Get alert counts
    const alertCounts = { normal: 0, elevated: 0, warning: 0, alert: 0, extreme: 0 };
    for (const spread of Object.values(spreadsWithZ)) {
      alertCounts[spread.status || 'normal']++;
    }

    // Overall status
    let overallStatus = 'normal';
    if (alertCounts.extreme > 0) overallStatus = 'extreme';
    else if (alertCounts.alert > 0) overallStatus = 'alert';
    else if (alertCounts.warning > 0) overallStatus = 'warning';
    else if (alertCounts.elevated > 0) overallStatus = 'elevated';

    // Find historical analog
    const activeEvents = await getActiveEvents();
    const analog = await findBestAnalog(spreadsWithZ, activeEvents);

    // Store everything
    const storeData = {
      lastSpreads: spreadsWithZ,
      lastFetchTime: Date.now(),
      marketStatus,
      alertCounts,
      overallStatus,
      lastAnalog: analog
    };

    await chrome.storage.local.set(storeData);
    await storeSpreadHistory(spreadsWithZ);

    // Update badge
    updateBadge(alertCounts, overallStatus);

    // Check for notifications
    await checkNotifications(spreadsWithZ, analog);

    // Notify content scripts
    broadcastUpdate(storeData);

    console.log('[DR] Update complete. Status:', overallStatus,
      'Alerts:', alertCounts.warning + alertCounts.alert + alertCounts.extreme);

  } catch (err) {
    console.error('[DR] Fetch cycle failed:', err);
    await chrome.storage.local.set({
      lastFetchTime: Date.now(),
      lastError: err.message,
      marketStatus
    });
  }
}

// ─── Badge ────────────────────────────────────────────────────────────────────

function updateBadge(alertCounts, overallStatus) {
  const total = alertCounts.warning + alertCounts.alert + alertCounts.extreme;

  const colors = {
    normal: '#4caf50',
    elevated: '#ffeb3b',
    warning: '#ff9800',
    alert: '#f44336',
    extreme: '#b71c1c'
  };

  chrome.action.setBadgeText({ text: total > 0 ? String(total) : '' });
  chrome.action.setBadgeBackgroundColor({ color: colors[overallStatus] || '#4caf50' });
}

// ─── Notifications ────────────────────────────────────────────────────────────

const notifiedSpreads = new Map(); // key -> last notification time

async function checkNotifications(spreads, analog) {
  const settings = await getSettings();
  const alertThreshold = settings.zThresholds?.alert || 2.5;
  const now = Date.now();
  const cooldown = 15 * 60 * 1000; // 15 min cooldown per spread

  for (const [key, spread] of Object.entries(spreads)) {
    if (!spread.absZscore || spread.absZscore < alertThreshold) continue;

    const lastNotified = notifiedSpreads.get(key) || 0;
    if (now - lastNotified < cooldown) continue;

    notifiedSpreads.set(key, now);

    let message = `${spread.label || key}: ${formatSpreadValue(spread)} vs normal ${spread.baseline_mean?.toFixed(1) || '?'}±${spread.baseline_std?.toFixed(1) || '?'}`;
    message += `\nZ-Score: ${spread.absZscore}σ (${spread.percentile?.toFixed(1) || '?'}th percentile)`;

    if (analog?.event) {
      const analogSpread = analog.spreads?.[key];
      if (analogSpread) {
        message += `\nLast similar event (${analog.event}): reverted in ${analogSpread.reversion_days}d, fade win rate ${analog.fade_win_rate}%`;
      }
    }

    chrome.notifications.create(`dr-${key}-${now}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: `Dislocation Alert: ${spread.status?.toUpperCase()}`,
      message,
      priority: spread.absZscore >= 3.0 ? 2 : 1
    });
  }
}

function formatSpreadValue(spread) {
  if (spread.unit === '%') return `${spread.value?.toFixed(2)}%`;
  if (spread.unit === 'ratio') return spread.value?.toFixed(3);
  if (spread.unit === 'level') return spread.value?.toFixed(1);
  if (spread.unit === 'INR') return `₹${spread.value?.toFixed(3)}`;
  return `₹${Math.abs(spread.value)?.toFixed(0)}`;
}

// ─── High Priority (News + Dislocation) ───────────────────────────────────────

async function checkHighPriorityAlerts() {
  const [{ lastSpreads }, events] = await Promise.all([
    chrome.storage.local.get('lastSpreads'),
    getActiveEvents()
  ]);

  if (!lastSpreads || !events || events.length === 0) return;

  const hasHighZScore = Object.values(lastSpreads).some(s => (s.absZscore || 0) >= 2.0);

  if (hasHighZScore) {
    const topEvent = events[0];
    const topSpread = Object.entries(lastSpreads)
      .sort((a, b) => (b[1].absZscore || 0) - (a[1].absZscore || 0))[0];

    if (topSpread) {
      chrome.notifications.create(`dr-highpri-${Date.now()}`, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: `HIGH PRIORITY: ${topEvent.type} Event + Market Dislocation`,
        message: `${topEvent.headline}\n\n${topSpread[1].label}: ${topSpread[1].absZscore}σ dislocation detected`,
        priority: 2
      });
    }
  }
}

// ─── Message Passing ──────────────────────────────────────────────────────────

function broadcastUpdate(data) {
  chrome.runtime.sendMessage({ type: 'SPREAD_UPDATE', data }).catch(() => {
    // popup not open, ignore
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'GET_DATA') {
    chrome.storage.local.get([
      'lastSpreads', 'lastFetchTime', 'marketStatus',
      'alertCounts', 'overallStatus', 'lastAnalog',
      'spreadHistory', 'activeEvents'
    ]).then(data => {
      sendResponse(data);
    });
    return true; // async response
  }

  if (msg.type === 'FORCE_REFRESH') {
    fetchAndCalculate().then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg.type === 'GET_SETTINGS') {
    getSettings().then(s => sendResponse(s));
    return true;
  }

  if (msg.type === 'UPDATE_SETTINGS') {
    chrome.storage.sync.set({ settings: msg.settings }).then(async () => {
      // Re-create alarms with new interval
      await chrome.alarms.clearAll();
      await setupAlarms();
      sendResponse({ ok: true });
    });
    return true;
  }
});

// ─── Initial Load ─────────────────────────────────────────────────────────────

loadBaselines();
console.log('[DR] Service worker loaded.');
