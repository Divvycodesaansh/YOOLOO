// Dislocation Radar India — Background Service Worker
// Core orchestrator: data fetching, spread calculation, alerts, alarm management

import { detectNews, getActiveEvents, trackNewsVelocity, getNewsVelocity } from './news-detector.js';
import { findBestAnalog } from './analog-matcher.js';
import { analyzeGlobalRipple } from './ripple-analyzer.js';
import { updateFIIData, getFIIStats } from './fii-radar.js';
import { classifyRegime, calculateConfirmation, updateReversionCountdown } from './regime-classifier.js';

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
  wit_adr: 'WIT',
  // New tickers for Upgrade 2
  nifty_it: '%5ECNXIT',
  nasdaq: '%5EIXIC',
  nifty_psu_bank: 'NIFTYPSUBNK.NS',
  nifty_pvt_bank: 'NIFTYPVTBNK.NS',
  nifty_pharma: '%5ECNXPHARMA',
  nifty500: '%5ECRSLDX',
  us_10y: '%5ETNX',
  india_10y: '0883.HK'  // India 10Y govt bond proxy via iShares
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
  refreshInterval: 60,
  rippleEnabled: true
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
  const hasFII = existing.some(a => a.name === 'fetchFII');
  if (!hasFII) {
    chrome.alarms.create('fetchFII', { periodInMinutes: 60 }); // hourly FII update
  }
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'fetchData') {
    await fetchAndCalculate();
  } else if (alarm.name === 'fetchNews') {
    const settings = await getSettings();
    if (settings.newsEnabled) {
      const items = await detectNews();
      const velocity = await trackNewsVelocity(items);
      await chrome.storage.local.set({ lastVelocity: velocity });
      await checkHighPriorityAlerts();
    }
  } else if (alarm.name === 'fetchFII') {
    await updateFIIData();
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

let baselinesData = null;

async function loadBaselines() {
  try {
    const url = chrome.runtime.getURL('data/baselines.json');
    const response = await fetch(url);
    baselinesData = await response.json();
    console.log('[DR] Baselines loaded:', Object.keys(baselinesData.baselines).length, 'spreads, 3 VIX regimes');
  } catch (err) {
    console.error('[DR] Failed to load baselines:', err);
  }
}

function getRegimeBaselines(vixLevel) {
  if (!baselinesData) return null;
  // Select regime-appropriate baselines
  let regimeSet;
  let regimeName;
  if (vixLevel > 25) {
    regimeSet = baselinesData.baselines_panic;
    regimeName = 'panic';
  } else if (vixLevel >= 18) {
    regimeSet = baselinesData.baselines_elevated;
    regimeName = 'elevated';
  } else {
    regimeSet = baselinesData.baselines_normal;
    regimeName = 'normal';
  }
  return { regimeSet, regimeName, combined: baselinesData.baselines };
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

  // 11. Nifty IT vs NASDAQ ratio (normalized)
  if (quotes.nifty_it?.price && quotes.nasdaq?.price) {
    const ratio = quotes.nifty_it.price / quotes.nasdaq.price;
    spreads.nifty_it_nasdaq_ratio = {
      value: ratio,
      nifty_it: quotes.nifty_it.price,
      nasdaq: quotes.nasdaq.price,
      unit: 'ratio'
    };
  }

  // 12. Nifty PSU Bank vs Nifty Private Bank ratio
  if (quotes.nifty_psu_bank?.price && quotes.nifty_pvt_bank?.price) {
    const ratio = quotes.nifty_psu_bank.price / quotes.nifty_pvt_bank.price;
    spreads.nifty_psu_pvt_bank_ratio = {
      value: ratio,
      psu: quotes.nifty_psu_bank.price,
      pvt: quotes.nifty_pvt_bank.price,
      unit: 'ratio'
    };
  }

  // 13. Nifty Pharma vs Nifty ratio (defensive rotation)
  if (quotes.nifty_pharma?.price && quotes.nifty_spot?.price) {
    const ratio = quotes.nifty_pharma.price / quotes.nifty_spot.price;
    spreads.nifty_pharma_nifty_ratio = {
      value: ratio,
      pharma: quotes.nifty_pharma.price,
      nifty: quotes.nifty_spot.price,
      unit: 'ratio'
    };
  }

  // 14. Nifty500 vs Nifty50 ratio (market breadth)
  if (quotes.nifty500?.price && quotes.nifty_spot?.price) {
    const ratio = quotes.nifty500.price / quotes.nifty_spot.price;
    spreads.nifty500_nifty50_ratio = {
      value: ratio,
      nifty500: quotes.nifty500.price,
      nifty50: quotes.nifty_spot.price,
      unit: 'ratio'
    };
  }

  // 15. MCX Gold / MCX Silver ratio (fear gauge)
  if (quotes.mcx_gold?.price && quotes.mcx_silver?.price) {
    // Gold in INR/10g, Silver in INR/kg. Convert to comparable: gold per gram vs silver per gram
    const goldPerGram = quotes.mcx_gold.price / 10;
    const silverPerGram = quotes.mcx_silver.price / 1000;
    const ratio = goldPerGram / silverPerGram;
    spreads.gold_silver_ratio = {
      value: ratio,
      gold: quotes.mcx_gold.price,
      silver: quotes.mcx_silver.price,
      unit: 'ratio'
    };
  }

  // 16. India 10Y - US 10Y yield spread (in bps)
  if (quotes.us_10y?.price) {
    // US 10Y from Yahoo is in percentage points. India 10Y proxy ~7.1% estimated
    const india10y = quotes.india_10y?.price || 7.10; // fallback to estimated
    const us10y = quotes.us_10y.price;
    const spreadBps = (india10y - us10y) * 100;
    spreads.india_us_10y_spread = {
      value: spreadBps,
      india_10y: india10y,
      us_10y: us10y,
      unit: 'bps',
      data_quality: quotes.india_10y ? 'LIVE' : 'ESTIMATED'
    };
  }

  // 17. Nifty PCR (estimated from VIX level — NSE API returns 403)
  if (quotes.india_vix?.price) {
    // PCR estimation: higher VIX correlates with higher PCR
    // Normalized against 90-day mean (1.0 = average)
    const vix = quotes.india_vix.price;
    const estimatedPcr = 0.7 + (vix / 30) * 0.6; // rough linear estimation
    spreads.nifty_pcr = {
      value: estimatedPcr,
      unit: 'ratio',
      data_quality: 'ESTIMATED'
    };
  }

  // 18. FII net flow — handled by fii-radar.js, placeholder here
  // Will be injected from fii-radar module results

  // 19. OIS-Repo spread (estimated from bond yield dynamics)
  if (quotes.us_10y?.price && quotes.india_vix?.price) {
    // OIS-Repo is hard to get free. Estimate from yield curve steepness + VIX
    const vix = quotes.india_vix.price;
    const estimatedOis = 10 + (vix - 13) * 2; // rough: higher VIX = market pricing more rate action
    spreads.ois_repo_spread = {
      value: estimatedOis,
      unit: 'bps',
      data_quality: 'ESTIMATED'
    };
  }

  return spreads;
}

// ─── Z-Score Calculation ──────────────────────────────────────────────────────

function calculateZScores(spreads) {
  if (!baselinesData) return spreads;

  // Determine VIX regime for regime-aware baselines
  const vixLevel = spreads.india_vix?.value || 14;
  const regime = getRegimeBaselines(vixLevel);
  if (!regime) return spreads;

  for (const [key, spread] of Object.entries(spreads)) {
    const combinedBaseline = regime.combined[key];
    if (!combinedBaseline) continue;

    // Use regime-specific mean/std if available, fallback to combined
    const regimeData = regime.regimeSet[key];
    const mean = regimeData?.mean ?? combinedBaseline.mean;
    const std = regimeData?.std ?? combinedBaseline.std;

    const zscore = (Math.abs(spread.value) - mean) / std;
    const percentile = zScoreToPercentile(Math.abs(zscore));

    spread.zscore = parseFloat(zscore.toFixed(2));
    spread.absZscore = parseFloat(Math.abs(zscore).toFixed(2));
    spread.percentile = parseFloat(percentile.toFixed(1));
    spread.baseline_mean = mean;
    spread.baseline_std = std;
    spread.label = combinedBaseline.label;
    spread.regime = regime.regimeName;
    spread.data_quality = spread.data_quality || (spread.value !== null ? 'LIVE' : 'CLOSED');

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

// ─── Fear Temperature Gauge (Upgrade 3) ─────────────────────────────────────

function calculateFearTemperature(spreadsWithZ, fiiStats) {
  const weights = {
    india_vix: 0.25,
    banknifty_nifty_ratio: 0.15,
    mcx_gold_comex: 0.15,
    fii_net_flow: 0.15,
    usdinr_basis: 0.10,
    nifty_pcr: 0.10,
    mcx_crude_brent: 0.10
  };

  let score = 0;
  for (const [key, weight] of Object.entries(weights)) {
    let z = 0;
    if (key === 'fii_net_flow') {
      z = Math.abs(fiiStats?.zscore || 0);
    } else {
      z = spreadsWithZ[key]?.absZscore || 0;
    }
    score += weight * Math.min(z / 3, 1);
  }
  score = Math.round(score * 100);

  let label, color;
  if (score <= 25) { label = 'CALM'; color = '#3fb950'; }
  else if (score <= 50) { label = 'ELEVATED'; color = '#d29922'; }
  else if (score <= 75) { label = 'STRESSED'; color = '#db6d28'; }
  else { label = 'EXTREME PANIC'; color = '#da3633'; }

  return { score, label, color, weights };
}

async function findFearTempContext(score) {
  try {
    const url = chrome.runtime.getURL('data/historical-events.json');
    const resp = await fetch(url);
    const data = await resp.json();
    const events = data.events || [];

    // Estimate historical fear temps from events
    let closest = null;
    let closestDiff = Infinity;

    for (const event of events) {
      // Estimate fear temp from event's peak z-scores
      const spreads = event.spreads || {};
      const vixZ = spreads.india_vix?.peak_zscore || 0;
      const goldZ = spreads.mcx_gold_comex?.peak_zscore || 0;
      const crudeZ = spreads.mcx_crude_brent?.peak_zscore || 0;
      const estTemp = Math.round((vixZ * 0.25 + goldZ * 0.15 + crudeZ * 0.10) / 0.5 * 33);

      const diff = Math.abs(estTemp - score);
      if (diff < closestDiff) {
        closestDiff = diff;
        closest = { event: event.event, temp: estTemp, recovery: event.nifty_recovery_days };
      }
    }

    if (closest) {
      return `Last time Fear Temp was this high: ${closest.event}, peaked at ${closest.temp}, cooled in ${closest.recovery} days.`;
    }
  } catch { /* ignore */ }
  return null;
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

    // Global Ripple Check
    const settings = await getSettings();
    let rippleCheck = null;
    if (settings.rippleEnabled !== false) {
      rippleCheck = await analyzeGlobalRipple(spreadsWithZ);
    }

    // FII Stats
    const fiiStats = await getFIIStats();

    // Fear Temperature (Upgrade 3)
    const fearTemp = calculateFearTemperature(spreadsWithZ, fiiStats);
    fearTemp.historicalContext = await findFearTempContext(fearTemp.score);

    // Regime Classification (Upgrade 4)
    const regime = await classifyRegime(spreadsWithZ, fiiStats);

    // Cross-Market Confirmation (Upgrade 7)
    const confirmation = calculateConfirmation(spreadsWithZ, fiiStats);

    // Override regime label with confirmation check
    if (regime.regime === 'PANIC-REVERT' && confirmation.score < 4) {
      regime.label = 'WATCH';
      regime.color = '#d29922';
      regime.action = 'yellow';
    }

    // Reversion Countdown (Upgrade 8)
    const reversionCountdowns = await updateReversionCountdown(spreadsWithZ, analog);

    // News Velocity
    const velocity = await getNewsVelocity();

    // Store everything
    const storeData = {
      lastSpreads: spreadsWithZ,
      lastFetchTime: Date.now(),
      marketStatus,
      alertCounts,
      overallStatus,
      lastAnalog: analog,
      lastRippleCheck: rippleCheck,
      lastFIIStats: fiiStats,
      lastFearTemp: fearTemp,
      lastRegime: regime,
      lastConfirmation: confirmation,
      lastReversionCountdowns: reversionCountdowns,
      lastVelocity: velocity
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
      'spreadHistory', 'activeEvents', 'lastRippleCheck',
      'lastFIIStats', 'lastFearTemp', 'lastRegime',
      'lastConfirmation', 'lastReversionCountdowns', 'lastVelocity'
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
