// Dislocation Radar India — Options/Settings Script

const SPREAD_NAMES = {
  nifty_basis: 'Nifty Futures Basis',
  banknifty_basis: 'BankNifty Futures Basis',
  mcx_gold_comex: 'MCX Gold - COMEX',
  mcx_silver_comex: 'MCX Silver - COMEX',
  mcx_crude_brent: 'MCX Crude - Brent',
  usdinr_basis: 'USDINR Fut - Spot',
  banknifty_nifty_ratio: 'BankNifty/Nifty Ratio',
  india_vix: 'India VIX',
  infy_adr_spread: 'INFY NSE vs ADR',
  icici_adr_spread: 'ICICI NSE vs ADR'
};

const WIDGET_SITES = [
  { id: 'kite.zerodha.com', name: 'Kite (Zerodha)' },
  { id: 'tradingview.com', name: 'TradingView' },
  { id: 'moneycontrol.com', name: 'MoneyControl' }
];

const DEFAULT_SETTINGS = {
  enabledSpreads: Object.keys(SPREAD_NAMES),
  zThresholds: { elevated: 1.5, warning: 2.0, alert: 2.5, extreme: 3.0 },
  newsEnabled: true,
  soundEnabled: true,
  widgetEnabled: true,
  widgetSites: WIDGET_SITES.map(s => s.id),
  darkMode: true,
  refreshInterval: 60,
  rippleEnabled: true
};

document.addEventListener('DOMContentLoaded', async () => {
  const settings = await loadSettings();
  renderSpreadToggles(settings);
  renderSiteToggles(settings);
  populateFields(settings);
  applyTheme(settings.darkMode);
  attachListeners();
});

async function loadSettings() {
  const { settings } = await chrome.storage.sync.get('settings');
  return settings || DEFAULT_SETTINGS;
}

function renderSpreadToggles(settings) {
  const container = document.getElementById('spreadToggles');
  container.innerHTML = '';

  for (const [key, name] of Object.entries(SPREAD_NAMES)) {
    const checked = settings.enabledSpreads?.includes(key) ? 'checked' : '';
    const label = document.createElement('label');
    label.className = 'spread-check';
    label.innerHTML = `
      <input type="checkbox" data-spread="${key}" ${checked}>
      <span>${name}</span>
    `;
    container.appendChild(label);
  }
}

function renderSiteToggles(settings) {
  const container = document.getElementById('siteToggles');
  container.innerHTML = '';

  for (const site of WIDGET_SITES) {
    const checked = settings.widgetSites?.includes(site.id) ? 'checked' : '';
    const label = document.createElement('label');
    label.className = 'spread-check';
    label.innerHTML = `
      <input type="checkbox" data-site="${site.id}" ${checked}>
      <span>${site.name}</span>
    `;
    container.appendChild(label);
  }
}

function populateFields(settings) {
  document.getElementById('thresh-elevated').value = settings.zThresholds?.elevated ?? 1.5;
  document.getElementById('thresh-warning').value = settings.zThresholds?.warning ?? 2.0;
  document.getElementById('thresh-alert').value = settings.zThresholds?.alert ?? 2.5;
  document.getElementById('thresh-extreme').value = settings.zThresholds?.extreme ?? 3.0;

  document.getElementById('newsEnabled').checked = settings.newsEnabled !== false;
  document.getElementById('rippleEnabled').checked = settings.rippleEnabled !== false;
  document.getElementById('soundEnabled').checked = settings.soundEnabled !== false;
  document.getElementById('widgetEnabled').checked = settings.widgetEnabled !== false;
  document.getElementById('darkMode').checked = settings.darkMode !== false;
  document.getElementById('refreshInterval').value = String(settings.refreshInterval || 60);
}

function attachListeners() {
  // Auto-save on any change
  const inputs = document.querySelectorAll('input, select');
  inputs.forEach(input => {
    input.addEventListener('change', saveSettings);
  });

  // Dark mode live toggle
  document.getElementById('darkMode').addEventListener('change', (e) => {
    applyTheme(e.target.checked);
  });
}

async function saveSettings() {
  const enabledSpreads = [];
  document.querySelectorAll('[data-spread]').forEach(cb => {
    if (cb.checked) enabledSpreads.push(cb.dataset.spread);
  });

  const widgetSites = [];
  document.querySelectorAll('[data-site]').forEach(cb => {
    if (cb.checked) widgetSites.push(cb.dataset.site);
  });

  const settings = {
    enabledSpreads,
    zThresholds: {
      elevated: parseFloat(document.getElementById('thresh-elevated').value) || 1.5,
      warning: parseFloat(document.getElementById('thresh-warning').value) || 2.0,
      alert: parseFloat(document.getElementById('thresh-alert').value) || 2.5,
      extreme: parseFloat(document.getElementById('thresh-extreme').value) || 3.0
    },
    newsEnabled: document.getElementById('newsEnabled').checked,
    rippleEnabled: document.getElementById('rippleEnabled').checked,
    soundEnabled: document.getElementById('soundEnabled').checked,
    widgetEnabled: document.getElementById('widgetEnabled').checked,
    darkMode: document.getElementById('darkMode').checked,
    refreshInterval: parseInt(document.getElementById('refreshInterval').value) || 60,
    widgetSites
  };

  // Send to background to update alarms
  try {
    await chrome.runtime.sendMessage({ type: 'UPDATE_SETTINGS', settings });
  } catch {
    // Fallback: save directly
    await chrome.storage.sync.set({ settings });
  }

  showSaveStatus();
}

function showSaveStatus() {
  const el = document.getElementById('saveStatus');
  el.classList.add('visible');
  setTimeout(() => el.classList.remove('visible'), 2000);
}

function applyTheme(isDark) {
  document.body.classList.toggle('light', !isDark);
}
