// Dislocation Radar India — Floating Widget (Content Script)
// Injected on Kite, TradingView, MoneyControl
// Uses Shadow DOM to prevent CSS conflicts

(function() {
  'use strict';

  let isExpanded = false;
  let isDragging = false;
  let dragOffset = { x: 0, y: 0 };
  let widgetEl = null;
  let shadowRoot = null;

  // ─── Check settings before creating widget ─────────────────────────────────

  async function shouldShowWidget() {
    try {
      const settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
      if (!settings?.widgetEnabled) return false;
      const hostname = window.location.hostname;
      const sites = settings.widgetSites || [];
      return sites.some(site => hostname.includes(site));
    } catch {
      return true; // default to showing
    }
  }

  // ─── Create Widget ─────────────────────────────────────────────────────────

  async function createWidget() {
    const show = await shouldShowWidget();
    if (!show) return;

    // Host element
    widgetEl = document.createElement('div');
    widgetEl.id = 'dr-radar-widget-host';
    widgetEl.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 999999;
      font-family: 'SF Mono', 'Cascadia Code', 'Consolas', monospace;
    `;

    // Shadow DOM
    shadowRoot = widgetEl.attachShadow({ mode: 'closed' });

    // Styles
    const style = document.createElement('style');
    style.textContent = getWidgetStyles();
    shadowRoot.appendChild(style);

    // Pill container
    const pill = document.createElement('div');
    pill.id = 'dr-pill';
    pill.className = 'dr-pill';
    pill.innerHTML = `
      <span class="dr-pill-label">DR:</span>
      <span class="dr-pill-alerts" id="dr-alerts">--</span>
      <button class="dr-close-btn" id="dr-close" title="Hide widget">×</button>
    `;

    // Expanded panel
    const panel = document.createElement('div');
    panel.id = 'dr-panel';
    panel.className = 'dr-panel hidden';
    panel.innerHTML = `
      <div class="dr-panel-header">
        <span>Dislocation Radar</span>
        <button class="dr-collapse-btn" id="dr-collapse">−</button>
      </div>
      <div class="dr-panel-body" id="dr-body">
        <div class="dr-loading">Loading...</div>
      </div>
      <div class="dr-panel-footer">
        <span class="dr-footer-text" id="dr-footer">--</span>
      </div>
    `;

    shadowRoot.appendChild(pill);
    shadowRoot.appendChild(panel);
    document.body.appendChild(widgetEl);

    // ─── Event listeners ─────────────────────────────────────────────────────

    // Click pill to expand
    pill.addEventListener('click', (e) => {
      if (isDragging) return;
      if (e.target.id === 'dr-close') return;
      togglePanel();
    });

    // Close button
    shadowRoot.getElementById('dr-close').addEventListener('click', (e) => {
      e.stopPropagation();
      widgetEl.style.display = 'none';
    });

    // Collapse button
    shadowRoot.getElementById('dr-collapse').addEventListener('click', () => {
      togglePanel();
    });

    // ─── Dragging ────────────────────────────────────────────────────────────

    pill.addEventListener('mousedown', startDrag);
    document.addEventListener('mousemove', onDrag);
    document.addEventListener('mouseup', endDrag);

    // ─── Load data ───────────────────────────────────────────────────────────

    updateWidget();

    // Listen for updates
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'SPREAD_UPDATE') {
        updateWidgetFromData(msg.data);
      }
    });

    // Poll every 30s as backup
    setInterval(updateWidget, 30000);
  }

  // ─── Toggle Panel ──────────────────────────────────────────────────────────

  function togglePanel() {
    const panel = shadowRoot.getElementById('dr-panel');
    isExpanded = !isExpanded;
    panel.classList.toggle('hidden', !isExpanded);
  }

  // ─── Dragging ──────────────────────────────────────────────────────────────

  function startDrag(e) {
    if (e.target.tagName === 'BUTTON') return;
    isDragging = false;
    dragOffset = {
      x: e.clientX - widgetEl.getBoundingClientRect().left,
      y: e.clientY - widgetEl.getBoundingClientRect().top
    };
    widgetEl.style.transition = 'none';

    // We'll set isDragging=true on first move
    const onFirstMove = () => {
      isDragging = true;
      document.removeEventListener('mousemove', onFirstMove);
    };
    document.addEventListener('mousemove', onFirstMove);
  }

  function onDrag(e) {
    if (!isDragging) return;
    e.preventDefault();

    const x = e.clientX - dragOffset.x;
    const y = e.clientY - dragOffset.y;

    widgetEl.style.left = `${x}px`;
    widgetEl.style.top = `${y}px`;
    widgetEl.style.right = 'auto';
    widgetEl.style.bottom = 'auto';
  }

  function endDrag() {
    widgetEl.style.transition = '';
    // Reset isDragging after a tick to prevent click
    setTimeout(() => { isDragging = false; }, 50);
  }

  // ─── Update Widget Data ────────────────────────────────────────────────────

  async function updateWidget() {
    try {
      const data = await chrome.runtime.sendMessage({ type: 'GET_DATA' });
      updateWidgetFromData(data);
    } catch {
      // Extension context invalidated, clean up
    }
  }

  function updateWidgetFromData(data) {
    if (!data || !shadowRoot) return;

    // Update pill with Fear Temperature
    const alertsEl = shadowRoot.getElementById('dr-alerts');
    const fearTemp = data.lastFearTemp;

    if (fearTemp && fearTemp.score !== undefined) {
      alertsEl.innerHTML = `<span style="color:${fearTemp.color};font-weight:800">${fearTemp.score}°</span>`;
      alertsEl.className = 'dr-pill-alerts';
    } else {
      const counts = data.alertCounts || {};
      if (counts.extreme + counts.alert + counts.warning + counts.elevated === 0) {
        alertsEl.textContent = 'OK';
        alertsEl.className = 'dr-pill-alerts normal';
      } else {
        alertsEl.innerHTML = formatPillAlerts(counts);
        alertsEl.className = `dr-pill-alerts ${data.overallStatus || 'normal'}`;
      }
    }

    // Update pill class
    const pill = shadowRoot.getElementById('dr-pill');
    pill.className = `dr-pill ${data.overallStatus || 'normal'}`;

    // Update panel body
    if (isExpanded) {
      updatePanel(data);
    }

    // Update footer
    const footer = shadowRoot.getElementById('dr-footer');
    if (data.lastFetchTime) {
      const ago = Math.floor((Date.now() - data.lastFetchTime) / 1000);
      footer.textContent = ago < 60 ? `${ago}s ago` : `${Math.floor(ago / 60)}m ago`;
    }
  }

  function formatPillAlerts(counts) {
    let html = '';
    if (counts.extreme > 0) html += `<span class="alert-count extreme">${counts.extreme}</span>`;
    if (counts.alert > 0) html += `<span class="alert-count alert">${counts.alert}</span>`;
    if (counts.warning > 0) html += `<span class="alert-count warning">${counts.warning}</span>`;
    if (counts.elevated > 0) html += `<span class="alert-count elevated">${counts.elevated}</span>`;
    return html;
  }

  function updatePanel(data) {
    const body = shadowRoot.getElementById('dr-body');
    if (!data.lastSpreads) {
      body.innerHTML = '<div class="dr-loading">No data yet...</div>';
      return;
    }

    // Get top 5 dislocated spreads
    const sorted = Object.entries(data.lastSpreads)
      .filter(([, s]) => s.absZscore !== undefined)
      .sort((a, b) => (b[1].absZscore || 0) - (a[1].absZscore || 0))
      .slice(0, 5);

    const NAMES = {
      nifty_basis: 'Nifty Basis', banknifty_basis: 'BNF Basis',
      mcx_gold_comex: 'Gold MCX-CMX', mcx_silver_comex: 'Silver MCX-CMX',
      mcx_crude_brent: 'Crude MCX-ICE', usdinr_basis: 'USDINR Basis',
      banknifty_nifty_ratio: 'BNF/NF Ratio', india_vix: 'India VIX',
      infy_adr_spread: 'INFY ADR', icici_adr_spread: 'ICICI ADR',
      nifty_it_nasdaq_ratio: 'IT/NASDAQ', nifty_psu_pvt_bank_ratio: 'PSU/PVT',
      nifty_pharma_nifty_ratio: 'Pharma/NF', nifty500_nifty50_ratio: 'Breadth',
      gold_silver_ratio: 'Au/Ag', india_us_10y_spread: 'Bond Sprd',
      nifty_pcr: 'PCR', fii_net_flow: 'FII Flow', ois_repo_spread: 'OIS-Repo'
    };

    let html = '';

    // Active event
    if (data.activeEvents?.length > 0) {
      const evt = data.activeEvents[0];
      html += `<div class="dr-event-mini">
        <span class="dr-event-badge ${evt.type}">${evt.type}</span>
        <span class="dr-event-text">${truncate(evt.headline, 60)}</span>
      </div>`;
    }

    // Regime label
    if (data.lastRegime?.label) {
      const r = data.lastRegime;
      html += `<div class="dr-regime-mini" style="background:${r.color};color:${r.action === 'red' ? '#fff' : '#000'};padding:3px 8px;border-radius:4px;margin-bottom:6px;font-size:9px;font-weight:800">${r.label}</div>`;
    }

    // Global Ripple Check
    if (data.lastRippleCheck?.active) {
      const r = data.lastRippleCheck;
      const sevColors = { LOW: '#6e7681', MODERATE: '#d29922', HIGH: '#f85149', CRITICAL: '#da3633' };
      const sevColor = sevColors[r.severity] || '#6e7681';
      const typeLabel = (r.type || '').replace(/_/g, ' ');
      const sectors = (r.connections || []).slice(0, 2).map(c => c.sector).join(', ');
      html += `<div class="dr-ripple-mini" style="border-left:2px solid ${sevColor}">
        <span style="font-size:8px;font-weight:800;color:${sevColor}">${r.severity}</span>
        <span class="dr-event-text">${typeLabel}${sectors ? ' | ' + sectors : ''}</span>
      </div>`;
    }

    // Spread rows
    for (const [key, spread] of sorted) {
      const statusClass = spread.status || 'normal';
      const name = NAMES[key] || key;

      html += `
        <div class="dr-spread-row ${statusClass}">
          <span class="dr-spread-name">${name}</span>
          <span class="dr-spread-zscore">${(spread.absZscore || 0).toFixed(1)}σ</span>
        </div>`;
    }

    if (sorted.length === 0) {
      html = '<div class="dr-loading">All spreads normal</div>';
    }

    body.innerHTML = html;
  }

  function truncate(str, len) {
    if (!str) return '';
    return str.length > len ? str.substring(0, len) + '...' : str;
  }

  // ─── Widget Styles ─────────────────────────────────────────────────────────

  function getWidgetStyles() {
    return `
      * { margin: 0; padding: 0; box-sizing: border-box; }

      .dr-pill {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 12px;
        background: rgba(15,20,35,0.55);
        backdrop-filter: blur(14px) saturate(150%);
        -webkit-backdrop-filter: blur(14px) saturate(150%);
        border: 1px solid rgba(120,160,255,0.25);
        border-radius: 24px;
        cursor: pointer;
        user-select: none;
        font-size: 11px;
        color: #e6f1ff;
        transition: all 0.25s;
        box-shadow: 0 4px 24px rgba(0,0,0,0.5), 0 0 12px rgba(34,211,238,0.15);
      }

      .dr-pill:hover {
        background: rgba(20,26,48,0.65);
        box-shadow: 0 6px 28px rgba(0,0,0,0.6), 0 0 16px rgba(34,211,238,0.25);
        border-color: rgba(34,211,238,0.4);
      }

      .dr-pill.warning { border-color: rgba(255,140,66,0.5); box-shadow: 0 4px 24px rgba(0,0,0,0.5), 0 0 10px rgba(255,140,66,0.2); }
      .dr-pill.alert { border-color: rgba(255,85,119,0.5); box-shadow: 0 4px 24px rgba(0,0,0,0.5), 0 0 10px rgba(255,85,119,0.2); }
      .dr-pill.extreme {
        border-color: rgba(255,34,85,0.6);
        animation: pill-pulse 2s ease-in-out infinite;
      }

      @keyframes pill-pulse {
        0%, 100% { box-shadow: 0 4px 24px rgba(0,0,0,0.5), 0 0 10px rgba(255,34,85,0.25); }
        50% { box-shadow: 0 4px 28px rgba(0,0,0,0.6), 0 0 20px rgba(255,34,85,0.45); }
      }

      .dr-pill-label {
        font-weight: 700;
        font-size: 10px;
        color: #22d3ee;
        text-shadow: 0 0 6px rgba(34,211,238,0.3);
        letter-spacing: 0.5px;
      }

      .dr-pill-alerts {
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 3px;
      }

      .dr-pill-alerts.normal { color: #39ffa1; text-shadow: 0 0 6px rgba(57,255,161,0.3); }

      .alert-count {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        font-size: 9px;
        font-weight: 700;
      }

      .alert-count.extreme { background: rgba(255,34,85,0.8); color: white; box-shadow: 0 0 6px rgba(255,34,85,0.4); }
      .alert-count.alert { background: rgba(255,85,119,0.8); color: white; }
      .alert-count.warning { background: rgba(255,140,66,0.8); color: white; }
      .alert-count.elevated { background: rgba(255,181,71,0.8); color: #000; }

      .dr-close-btn {
        background: none;
        border: none;
        color: #5a6a8a;
        cursor: pointer;
        font-size: 14px;
        padding: 0 2px;
        line-height: 1;
        transition: color 0.15s;
      }
      .dr-close-btn:hover { color: #ff5577; }

      /* Panel */
      .dr-panel {
        position: absolute;
        bottom: calc(100% + 10px);
        right: 0;
        width: 270px;
        background: rgba(10,14,28,0.7);
        backdrop-filter: blur(20px) saturate(160%);
        -webkit-backdrop-filter: blur(20px) saturate(160%);
        border: 1px solid rgba(120,160,255,0.2);
        border-radius: 14px;
        box-shadow: 0 12px 40px rgba(0,0,0,0.6), 0 0 20px rgba(34,211,238,0.08);
        overflow: hidden;
      }

      .dr-panel.hidden { display: none; }

      .dr-panel-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 12px;
        background: rgba(18,22,40,0.6);
        backdrop-filter: blur(12px);
        border-bottom: 1px solid rgba(120,160,255,0.15);
        font-size: 11px;
        font-weight: 800;
        color: #22d3ee;
        text-shadow: 0 0 8px rgba(34,211,238,0.2);
        letter-spacing: 0.5px;
        text-transform: uppercase;
      }

      .dr-collapse-btn {
        background: rgba(30,38,66,0.4);
        border: 1px solid rgba(120,160,255,0.2);
        color: #94a3c0;
        cursor: pointer;
        padding: 0 6px;
        border-radius: 6px;
        font-size: 12px;
        line-height: 1.4;
        transition: all 0.15s;
      }
      .dr-collapse-btn:hover { background: rgba(34,211,238,0.1); border-color: rgba(34,211,238,0.3); color: #22d3ee; }

      .dr-panel-body {
        padding: 8px;
        max-height: 300px;
        overflow-y: auto;
      }

      .dr-panel-body::-webkit-scrollbar { width: 4px; }
      .dr-panel-body::-webkit-scrollbar-track { background: transparent; }
      .dr-panel-body::-webkit-scrollbar-thumb { background: rgba(34,211,238,0.2); border-radius: 2px; }

      .dr-panel-footer {
        padding: 4px 12px;
        background: rgba(18,22,40,0.6);
        border-top: 1px solid rgba(120,160,255,0.15);
        font-size: 9px;
        color: #5a6a8a;
      }

      .dr-loading {
        text-align: center;
        padding: 12px;
        color: #5a6a8a;
        font-size: 10px;
      }

      /* Event mini */
      .dr-event-mini {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 8px;
        background: rgba(18,22,40,0.5);
        backdrop-filter: blur(8px);
        border-radius: 8px;
        margin-bottom: 6px;
        border-left: 2px solid #ff5577;
      }

      .dr-event-badge {
        font-size: 8px;
        font-weight: 700;
        padding: 1px 4px;
        border-radius: 4px;
        white-space: nowrap;
      }

      .dr-event-badge.GEO { background: rgba(255,85,119,0.15); color: #ff5577; }
      .dr-event-badge.MAC { background: rgba(34,211,238,0.15); color: #22d3ee; }
      .dr-event-badge.SUPPLY { background: rgba(255,140,66,0.15); color: #ff8c42; }
      .dr-event-badge.CRISIS { background: rgba(192,132,252,0.15); color: #c084fc; }

      .dr-event-text {
        font-size: 10px;
        color: #e6f1ff;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      /* Ripple mini */
      .dr-ripple-mini {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 4px 8px;
        background: rgba(18,22,40,0.5);
        backdrop-filter: blur(8px);
        border-radius: 8px;
        margin-bottom: 6px;
      }

      /* Regime mini */
      .dr-regime-mini {
        text-shadow: 0 0 8px currentColor;
        backdrop-filter: blur(8px);
      }

      /* Spread rows */
      .dr-spread-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 4px 8px;
        border-radius: 6px;
        margin-bottom: 2px;
        font-size: 10px;
        transition: all 0.2s;
      }

      .dr-spread-row:hover { background: rgba(34,211,238,0.06); }

      .dr-spread-row.warning { background: rgba(255,140,66,0.06); }
      .dr-spread-row.alert { background: rgba(255,85,119,0.08); }
      .dr-spread-row.extreme { background: rgba(255,34,85,0.1); }

      .dr-spread-name {
        color: #94a3c0;
        font-weight: 500;
      }

      .dr-spread-zscore {
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        font-family: 'SF Mono','Cascadia Code','Fira Code','Consolas',monospace;
      }

      .dr-spread-row.normal .dr-spread-zscore { color: #5a6a8a; }
      .dr-spread-row.elevated .dr-spread-zscore { color: #ffb547; }
      .dr-spread-row.warning .dr-spread-zscore { color: #ff8c42; }
      .dr-spread-row.alert .dr-spread-zscore { color: #ff5577; }
      .dr-spread-row.extreme .dr-spread-zscore {
        color: #ff2255;
        text-shadow: 0 0 8px rgba(255,34,85,0.4);
        animation: zscore-pulse 1.5s ease-in-out infinite;
      }

      @keyframes zscore-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
      }
    `;
  }

  // ─── Initialize ────────────────────────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createWidget);
  } else {
    createWidget();
  }
})();
