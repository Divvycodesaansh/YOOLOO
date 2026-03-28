// Dislocation Radar India — Popup Script
// Renders the dashboard UI with spread data, historical analogs, and sparklines

document.addEventListener('DOMContentLoaded', init);

// ─── Spread display config ────────────────────────────────────────────────────

const SPREAD_CONFIG = {
  nifty_basis: { name: 'Nifty Basis', short: 'NIFTY Basis', format: 'pts' },
  banknifty_basis: { name: 'BankNifty Basis', short: 'BNIFTY Basis', format: 'pts' },
  mcx_gold_comex: { name: 'MCX Gold-COMEX', short: 'Gold MCX-CMX', format: 'inr' },
  mcx_silver_comex: { name: 'MCX Silver-COMEX', short: 'Silver MCX-CMX', format: 'inr' },
  mcx_crude_brent: { name: 'MCX Crude-Brent', short: 'Crude MCX-ICE', format: 'inr' },
  usdinr_basis: { name: 'USDINR Fut-Spot', short: 'USDINR Basis', format: 'inr3' },
  banknifty_nifty_ratio: { name: 'BNF/Nifty Ratio', short: 'BNF/NF Ratio', format: 'ratio' },
  india_vix: { name: 'India VIX', short: 'India VIX', format: 'level' },
  infy_adr_spread: { name: 'INFY NSE-ADR', short: 'INFY ADR', format: 'pct' },
  icici_adr_spread: { name: 'ICICI NSE-ADR', short: 'ICICI ADR', format: 'pct' }
};

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  // Load data
  await loadData();

  // Set up refresh button
  document.getElementById('refreshBtn').addEventListener('click', handleRefresh);

  // Settings link
  document.getElementById('settingsLink').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  // Listen for live updates
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'SPREAD_UPDATE') {
      renderAll(msg.data);
    }
  });
}

async function loadData() {
  try {
    const data = await chrome.runtime.sendMessage({ type: 'GET_DATA' });
    renderAll(data);
  } catch (err) {
    console.error('[DR Popup] Failed to load data:', err);
    document.getElementById('noData').classList.remove('hidden');
  }
}

async function handleRefresh() {
  const btn = document.getElementById('refreshBtn');
  btn.classList.add('spinning');
  btn.disabled = true;

  try {
    await chrome.runtime.sendMessage({ type: 'FORCE_REFRESH' });
    await new Promise(r => setTimeout(r, 1500));
    await loadData();
  } finally {
    btn.classList.remove('spinning');
    btn.disabled = false;
  }
}

// ─── Render All ───────────────────────────────────────────────────────────────

function renderAll(data) {
  if (!data) return;

  renderTopBar(data);
  renderEvents(data.activeEvents);
  renderRippleCheck(data.lastRippleCheck);
  renderSpreadTable(data.lastSpreads, data.spreadHistory);
  renderAnalog(data.lastAnalog);
  renderFadeStats(data.lastAnalog);
}

// ─── Top Bar ──────────────────────────────────────────────────────────────────

function renderTopBar(data) {
  const dot = document.getElementById('statusDot');
  const label = document.getElementById('statusLabel');
  const updated = document.getElementById('lastUpdated');
  const marketBadge = document.getElementById('marketStatus');

  // Status
  const status = data.overallStatus || 'normal';
  dot.className = `status-dot ${status}`;
  label.textContent = status.toUpperCase();

  // Last updated
  if (data.lastFetchTime) {
    const ago = timeAgo(data.lastFetchTime);
    updated.textContent = `Updated ${ago}`;
  }

  // Market status
  const ms = data.marketStatus;
  if (ms) {
    if (ms.nseOpen) {
      marketBadge.textContent = `NSE OPEN ${ms.istTime}`;
      marketBadge.className = 'market-badge open';
    } else {
      marketBadge.textContent = `NSE CLOSED ${ms.istTime}`;
      marketBadge.className = 'market-badge closed';
    }
  }
}

// ─── Events Section ───────────────────────────────────────────────────────────

function renderEvents(events) {
  const section = document.getElementById('eventSection');
  const content = document.getElementById('eventContent');

  if (!events || events.length === 0) {
    section.classList.add('hidden');
    return;
  }

  section.classList.remove('hidden');
  content.innerHTML = '';

  // Show top 3 events
  events.slice(0, 3).forEach(event => {
    const div = document.createElement('div');
    div.className = `event-item ${event.type}`;

    div.innerHTML = `
      <span class="event-type-badge ${event.type}">${event.type}</span>
      <span class="event-headline">${escapeHtml(event.headline)}</span>
      <span class="event-time">${timeAgo(event.timestamp)}</span>
    `;

    content.appendChild(div);
  });
}

// ─── Global Ripple Check ──────────────────────────────────────────────────────

function renderRippleCheck(rippleData) {
  const section = document.getElementById('rippleSection');
  const content = document.getElementById('rippleContent');

  if (!rippleData || !rippleData.active) {
    section.classList.remove('hidden');
    content.innerHTML = `
      <div class="ripple-none">No active global ripple detected.</div>
    `;
    return;
  }

  section.classList.remove('hidden');

  const r = rippleData;
  const severity = r.severity || 'LOW';
  const typeLabel = (r.type || '').replace(/_/g, ' ');

  // Build connections HTML
  let connectionsHtml = '';
  if (r.connections && r.connections.length > 0) {
    connectionsHtml = r.connections.map(c =>
      `<span class="ripple-conn degree-${c.degree}">${c.degree} ${c.sector}</span>`
    ).join('');
  }

  // Truncate event headline
  const eventText = r.event ? truncateText(r.event, 80) : 'Global event detected';

  content.innerHTML = `
    <div class="ripple-card severity-${severity}">
      <div class="ripple-header">
        <span class="ripple-severity ${severity}">${severity}</span>
        <span class="ripple-type">${typeLabel}</span>
      </div>
      <div class="ripple-event">${escapeHtml(eventText)}</div>
      ${connectionsHtml ? `<div class="ripple-connections">${connectionsHtml}</div>` : ''}
      <div class="ripple-impact">${escapeHtml(r.daily_life_impact || '')}</div>
      <div class="ripple-watch">
        <span class="ripple-watch-label">WATCH:</span> ${escapeHtml(r.watch || '')}
      </div>
    </div>
  `;
}

function truncateText(str, maxLen) {
  if (!str || str.length <= maxLen) return str || '';
  return str.substring(0, maxLen) + '...';
}

// ─── Spread Table ─────────────────────────────────────────────────────────────

function renderSpreadTable(spreads, history) {
  const tbody = document.getElementById('spreadBody');
  const noData = document.getElementById('noData');

  if (!spreads || Object.keys(spreads).length === 0) {
    tbody.innerHTML = '';
    noData.classList.remove('hidden');
    return;
  }

  noData.classList.add('hidden');
  tbody.innerHTML = '';

  // Sort by z-score descending
  const entries = Object.entries(spreads)
    .filter(([key]) => SPREAD_CONFIG[key])
    .sort((a, b) => (b[1].absZscore || 0) - (a[1].absZscore || 0));

  for (const [key, spread] of entries) {
    const config = SPREAD_CONFIG[key];
    const tr = document.createElement('tr');

    // Row class based on status
    if (spread.status === 'warning') tr.className = 'row-warning';
    else if (spread.status === 'alert') tr.className = 'row-alert';
    else if (spread.status === 'extreme') tr.className = 'row-extreme';

    const zClass = `z-${spread.status || 'normal'}`;
    const currentVal = formatValue(spread.value, config.format);
    const normalVal = spread.baseline_mean !== undefined
      ? `${formatValue(spread.baseline_mean, config.format)}±${formatValue(spread.baseline_std, config.format)}`
      : '--';

    const zDisplay = spread.absZscore !== undefined
      ? `${spread.absZscore.toFixed(1)}σ`
      : '--';

    const percentileDisplay = spread.percentile
      ? `${spread.percentile.toFixed(0)}%ile`
      : '';

    // Sparkline
    const sparklineHtml = renderSparkline(history?.[key] || [], spread.status);

    tr.innerHTML = `
      <td class="spread-name" title="${config.name}">${config.short}</td>
      <td class="spread-value ${zClass}">${currentVal}</td>
      <td class="spread-normal">${normalVal}</td>
      <td class="zscore-cell ${zClass}" title="${percentileDisplay}">${zDisplay}</td>
      <td class="sparkline-cell">${sparklineHtml}</td>
    `;

    tbody.appendChild(tr);
  }
}

function formatValue(value, format) {
  if (value === null || value === undefined) return '--';
  switch (format) {
    case 'pts': return `${value >= 0 ? '+' : ''}${Math.round(value)}`;
    case 'inr': return `₹${Math.abs(value).toFixed(0)}`;
    case 'inr3': return `₹${value.toFixed(3)}`;
    case 'ratio': return value.toFixed(3);
    case 'level': return value.toFixed(1);
    case 'pct': return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
    default: return String(value);
  }
}

// ─── Sparklines ───────────────────────────────────────────────────────────────

function renderSparkline(dataPoints, status) {
  if (!dataPoints || dataPoints.length < 2) {
    return '<span style="color:var(--text-muted);font-size:8px">--</span>';
  }

  // Take last 30 points max
  const points = dataPoints.slice(-30);
  const values = points.map(p => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const w = 44;
  const h = 16;
  const padding = 1;

  const pathPoints = values.map((v, i) => {
    const x = padding + (i / (values.length - 1)) * (w - 2 * padding);
    const y = h - padding - ((v - min) / range) * (h - 2 * padding);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const colors = {
    normal: '#6e7681',
    elevated: '#d29922',
    warning: '#db6d28',
    alert: '#f85149',
    extreme: '#da3633'
  };

  const color = colors[status] || colors.normal;

  return `<svg class="sparkline-svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <polyline fill="none" stroke="${color}" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"
      points="${pathPoints.join(' ')}" />
    <circle cx="${pathPoints[pathPoints.length - 1].split(',')[0]}" cy="${pathPoints[pathPoints.length - 1].split(',')[1]}" r="1.5" fill="${color}" />
  </svg>`;
}

// ─── Historical Analog ────────────────────────────────────────────────────────

function renderAnalog(analog) {
  const section = document.getElementById('analogSection');
  const content = document.getElementById('analogContent');

  if (!analog || !analog.event) {
    section.classList.add('hidden');
    return;
  }

  section.classList.remove('hidden');

  const drawdownClass = analog.nifty_drawdown < 0 ? 'negative' : 'positive';
  const winRateClass = analog.fade_win_rate >= 75 ? 'good' : 'caution';

  let reversionHtml = '';
  if (analog.reversion_estimates) {
    const entries = Object.entries(analog.reversion_estimates).slice(0, 4);
    reversionHtml = entries.map(([key, est]) => {
      const config = SPREAD_CONFIG[key];
      if (!config) return '';
      return `
        <div class="analog-detail-row">
          <span class="analog-label">${config.short}</span>
          <span class="analog-value">peaked ${est.historical_peak_zscore}σ, reverted ${est.reversion_days}d</span>
        </div>`;
    }).join('');
  }

  content.innerHTML = `
    <div class="analog-match">
      <div class="analog-header">
        <span class="analog-event-name">${escapeHtml(analog.event)}</span>
        <span class="analog-similarity">${analog.similarity}% match</span>
      </div>
      <div class="analog-details">
        <div class="analog-detail-row">
          <span class="analog-label">Date</span>
          <span class="analog-value">${analog.date}</span>
        </div>
        <div class="analog-detail-row">
          <span class="analog-label">Type</span>
          <span class="analog-value">${analog.type}</span>
        </div>
        <div class="analog-detail-row">
          <span class="analog-label">Nifty Drawdown</span>
          <span class="analog-value ${drawdownClass}">${analog.nifty_drawdown}%</span>
        </div>
        <div class="analog-detail-row">
          <span class="analog-label">Recovery</span>
          <span class="analog-value">${analog.nifty_recovery_days} days</span>
        </div>
        <div class="analog-detail-row">
          <span class="analog-label">Fade Win Rate</span>
          <span class="analog-value ${winRateClass}">${analog.fade_win_rate}%</span>
        </div>
        ${reversionHtml}
      </div>
      ${analog.data_limited ? '<div class="analog-notes">Limited historical data for this event.</div>' : ''}
      ${analog.notes ? `<div class="analog-notes">${escapeHtml(analog.notes)}</div>` : ''}
    </div>
    ${analog.runner_up ? `
      <div style="font-size:9px;color:var(--text-muted);padding:4px 0;">
        Runner-up: ${escapeHtml(analog.runner_up.event)} (${analog.runner_up.similarity}% match)
      </div>
    ` : ''}
  `;
}

// ─── Fade Stats ───────────────────────────────────────────────────────────────

function renderFadeStats(analog) {
  const section = document.getElementById('statsSection');
  const content = document.getElementById('statsContent');

  if (!analog?.fade_stats || Object.keys(analog.fade_stats).length === 0) {
    section.classList.add('hidden');
    return;
  }

  section.classList.remove('hidden');
  content.innerHTML = '';

  for (const [key, stats] of Object.entries(analog.fade_stats)) {
    const config = SPREAD_CONFIG[key];
    if (!config) continue;

    const winClass = stats.avg_fade_win_rate >= 75 ? 'good' : 'caution';

    const card = document.createElement('div');
    card.className = 'stat-card';
    card.innerHTML = `
      <div class="stat-spread-name">${config.name}</div>
      <div class="stat-row">
        <span class="stat-label">Avg Reversion</span>
        <span class="stat-value">${stats.avg_reversion_days} days</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Fade Win Rate</span>
        <span class="stat-value ${winClass}">${stats.avg_fade_win_rate}%</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Sample Size</span>
        <span class="stat-value">${stats.sample_size} events</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Direction</span>
        <span class="stat-value">${formatDirection(stats.dominant_direction)}</span>
      </div>
    `;
    content.appendChild(card);
  }
}

function formatDirection(dir) {
  if (!dir) return '--';
  return dir.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function timeAgo(timestamp) {
  if (!timestamp) return '--';
  const seconds = Math.floor((Date.now() - timestamp) / 1000);

  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
