// Dislocation Radar India v2.0 — Popup Script
// Full visual overhaul with heatmap, fear temp, regime, FII, timeline

document.addEventListener('DOMContentLoaded', init);

const SPREAD_CONFIG = {
  nifty_basis: { name: 'Nifty Basis', short: 'NIFTY Basis', format: 'pts', weight: 0 },
  banknifty_basis: { name: 'BankNifty Basis', short: 'BNIFTY Basis', format: 'pts', weight: 0 },
  mcx_gold_comex: { name: 'MCX Gold-COMEX', short: 'Gold MCX-CMX', format: 'inr', weight: 0.15 },
  mcx_silver_comex: { name: 'MCX Silver-COMEX', short: 'Silver MCX-CMX', format: 'inr', weight: 0 },
  mcx_crude_brent: { name: 'MCX Crude-Brent', short: 'Crude MCX-ICE', format: 'inr', weight: 0.10 },
  usdinr_basis: { name: 'USDINR Fut-Spot', short: 'USDINR Basis', format: 'inr3', weight: 0.10 },
  banknifty_nifty_ratio: { name: 'BNF/Nifty Ratio', short: 'BNF/NF Ratio', format: 'ratio', weight: 0.15 },
  india_vix: { name: 'India VIX', short: 'India VIX', format: 'level', weight: 0.25 },
  infy_adr_spread: { name: 'INFY NSE-ADR', short: 'INFY ADR', format: 'pct', weight: 0 },
  icici_adr_spread: { name: 'ICICI NSE-ADR', short: 'ICICI ADR', format: 'pct', weight: 0 },
  nifty_it_nasdaq_ratio: { name: 'Nifty IT/NASDAQ', short: 'IT/NASDAQ', format: 'ratio', weight: 0 },
  nifty_psu_pvt_bank_ratio: { name: 'PSU/Pvt Bank', short: 'PSU/PVT Bank', format: 'ratio', weight: 0 },
  nifty_pharma_nifty_ratio: { name: 'Pharma/Nifty', short: 'Pharma/NF', format: 'ratio', weight: 0 },
  nifty500_nifty50_ratio: { name: 'Nifty500/50', short: 'Breadth', format: 'ratio', weight: 0 },
  gold_silver_ratio: { name: 'Gold/Silver', short: 'Au/Ag Ratio', format: 'ratio', weight: 0 },
  india_us_10y_spread: { name: 'IN-US 10Y Spread', short: 'Bond Spread', format: 'bps', weight: 0 },
  nifty_pcr: { name: 'Nifty PCR', short: 'PCR', format: 'ratio', weight: 0.10 },
  fii_net_flow: { name: 'FII Net Flow', short: 'FII Flow', format: 'zscore', weight: 0.15 },
  ois_repo_spread: { name: 'OIS-Repo', short: 'OIS-Repo', format: 'bps', weight: 0 }
};

let contagionPaths = null;

async function init() {
  await loadContagionPaths();
  await loadData();
  document.getElementById('refreshBtn').addEventListener('click', handleRefresh);
  document.getElementById('settingsLink').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'SPREAD_UPDATE') renderAll(msg.data);
  });
}

async function loadContagionPaths() {
  try {
    const url = chrome.runtime.getURL('data/contagion-paths.json');
    const resp = await fetch(url);
    contagionPaths = await resp.json();
  } catch { contagionPaths = null; }
}

async function loadData() {
  try {
    const data = await chrome.runtime.sendMessage({ type: 'GET_DATA' });
    renderAll(data);
  } catch {
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

function renderAll(data) {
  if (!data) return;
  renderTopBar(data);
  renderFearThermometer(data.lastFearTemp);
  renderRegimeBanner(data.lastRegime);
  renderEvents(data.activeEvents, data.lastVelocity);
  renderRippleCheck(data.lastRippleCheck);
  renderContagionChain(data.activeEvents, data.lastSpreads);
  renderHeatmapGrid(data.lastSpreads, data.spreadHistory);
  renderConfirmationDots(data.lastConfirmation);
  renderReversionCountdowns(data.lastReversionCountdowns);
  renderFIISection(data.lastFIIStats);
  renderAnalog(data.lastAnalog);
  renderTimeline(data.lastAnalog);
  renderFadeStats(data.lastAnalog);
}

// ─── Top Bar ─────────────────────────────────────────────────────────────────

function renderTopBar(data) {
  const dot = document.getElementById('statusDot');
  const label = document.getElementById('statusLabel');
  const updated = document.getElementById('lastUpdated');
  const marketBadge = document.getElementById('marketStatus');
  const status = data.overallStatus || 'normal';
  dot.className = `status-dot ${status}`;
  label.textContent = status.toUpperCase();
  if (data.lastFetchTime) updated.textContent = `Updated ${timeAgo(data.lastFetchTime)}`;
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

// ─── Fear Temperature ────────────────────────────────────────────────────────

function renderFearThermometer(fearTemp) {
  if (!fearTemp) return;
  const fill = document.getElementById('fearTempFill');
  const score = document.getElementById('fearTempScore');
  const label = document.getElementById('fearTempLabel');
  const ctx = document.getElementById('fearTempContext');

  fill.style.width = `${Math.min(fearTemp.score, 100)}%`;
  fill.style.background = fearTemp.color;
  score.textContent = `${fearTemp.score}`;
  label.textContent = fearTemp.label;
  label.style.color = fearTemp.color;
  ctx.textContent = fearTemp.historicalContext || '';
  ctx.classList.toggle('hidden', !fearTemp.historicalContext);
}

// ─── Regime Banner ───────────────────────────────────────────────────────────

function renderRegimeBanner(regime) {
  const banner = document.getElementById('regimeBanner');
  if (!regime || !regime.label) {
    banner.classList.add('hidden');
    return;
  }
  banner.classList.remove('hidden');
  banner.style.background = regime.color;
  banner.style.color = regime.action === 'red' ? '#fff' : '#000';
  banner.innerHTML = `
    <span class="regime-label">${regime.label}</span>
    <span class="regime-detail">${regime.regime} (${regime.panicRevertScore} panic, ${regime.structuralScore} structural)</span>
    <span class="regime-flip">${regime.flipCondition}</span>
  `;
}

// ─── Events + Velocity ───────────────────────────────────────────────────────

function renderEvents(events, velocity) {
  const section = document.getElementById('eventSection');
  const content = document.getElementById('eventContent');
  const meter = document.getElementById('velocityMeter');

  if ((!events || events.length === 0) && (!velocity || !velocity.alert)) {
    section.classList.add('hidden');
    return;
  }
  section.classList.remove('hidden');

  let html = '';

  // Velocity meter
  if (velocity && velocity.ratio > 1) {
    meter.classList.remove('hidden');
    const barWidth = Math.min(velocity.ratio / 10 * 100, 100);
    meter.innerHTML = `<div class="vel-bar" style="width:${barWidth}%"></div><span class="vel-label">${velocity.ratio.toFixed(1)}x</span>`;
    if (velocity.alert) {
      html += `<div class="velocity-alert">${escapeHtml(velocity.message)}</div>`;
    }
  } else {
    meter.classList.add('hidden');
  }

  if (events && events.length > 0) {
    html += events.slice(0, 5).map(event => {
      const headline = escapeHtml(event.headline);
      const headlineEl = event.link
        ? `<a class="event-headline event-link" href="${escapeHtml(event.link)}" target="_blank" rel="noopener">${headline}</a>`
        : `<span class="event-headline">${headline}</span>`;
      return `<div class="event-item ${event.type}">
        <span class="event-type-badge ${event.type}">${event.type}</span>
        ${headlineEl}
        <span class="event-time">${timeAgo(event.timestamp)}</span>
      </div>`;
    }).join('');
  }

  content.innerHTML = html;
}

// ─── Ripple Check ────────────────────────────────────────────────────────────

function renderRippleCheck(rippleData) {
  const section = document.getElementById('rippleSection');
  const content = document.getElementById('rippleContent');
  if (!rippleData || !rippleData.active) {
    section.classList.remove('hidden');
    content.innerHTML = `<div class="ripple-none">No active global ripple detected.</div>`;
    return;
  }
  section.classList.remove('hidden');
  const r = rippleData;
  const severity = r.severity || 'LOW';
  const typeLabel = (r.type || '').replace(/_/g, ' ');
  let connectionsHtml = '';
  if (r.connections?.length > 0) {
    connectionsHtml = r.connections.map(c =>
      `<span class="ripple-conn degree-${c.degree}">${c.degree} ${c.sector}</span>`
    ).join('');
  }
  content.innerHTML = `
    <div class="ripple-card severity-${severity}">
      <div class="ripple-header">
        <span class="ripple-severity ${severity}">${severity}</span>
        <span class="ripple-type">${typeLabel}</span>
      </div>
      <div class="ripple-event">${escapeHtml(truncate(r.event, 80))}</div>
      ${connectionsHtml ? `<div class="ripple-connections">${connectionsHtml}</div>` : ''}
      <div class="ripple-impact">${escapeHtml(r.daily_life_impact || '')}</div>
      <div class="ripple-watch"><span class="ripple-watch-label">WATCH:</span> ${escapeHtml(r.watch || '')}</div>
    </div>`;
}

// ─── Contagion Chain ─────────────────────────────────────────────────────────

function renderContagionChain(events, spreads) {
  const section = document.getElementById('contagionSection');
  const content = document.getElementById('contagionContent');
  if (!contagionPaths || !events || events.length === 0 || !spreads) {
    section.classList.add('hidden');
    return;
  }
  // Find matching contagion path from active event keywords
  const topEvent = events[0];
  const headline = (topEvent.headline || '').toLowerCase();
  let matchedPath = null;
  for (const [keyword, pathId] of Object.entries(contagionPaths.keyword_to_path || {})) {
    if (headline.includes(keyword.toLowerCase())) {
      matchedPath = contagionPaths.paths[pathId];
      break;
    }
  }
  if (!matchedPath) {
    section.classList.add('hidden');
    return;
  }
  section.classList.remove('hidden');
  const chainHtml = matchedPath.chain.map((step, i) => {
    const spread = spreads[step.spread_key];
    const z = spread?.absZscore || 0;
    const active = z >= 1.5;
    const cls = active ? 'chain-step active' : 'chain-step';
    const zLabel = active ? `${z.toFixed(1)}σ` : '';
    return `<div class="${cls}">
      <span class="chain-label">${step.step}</span>
      ${zLabel ? `<span class="chain-z">${zLabel}</span>` : ''}
    </div>${i < matchedPath.chain.length - 1 ? '<span class="chain-arrow">→</span>' : ''}`;
  }).join('');
  content.innerHTML = `<div class="chain-row">${chainHtml}</div>`;
}

// ─── Heatmap Grid ────────────────────────────────────────────────────────────

function renderHeatmapGrid(spreads, history) {
  const grid = document.getElementById('heatmapGrid');
  const noData = document.getElementById('noData');
  if (!spreads || Object.keys(spreads).length === 0) {
    grid.innerHTML = '';
    noData.classList.remove('hidden');
    return;
  }
  noData.classList.add('hidden');
  const entries = Object.entries(spreads)
    .filter(([key]) => SPREAD_CONFIG[key])
    .sort((a, b) => (b[1].absZscore || 0) - (a[1].absZscore || 0));

  grid.innerHTML = entries.map(([key, spread]) => {
    const config = SPREAD_CONFIG[key];
    const z = spread.absZscore || 0;
    const status = spread.status || 'normal';
    const hasWeight = (config.weight || 0) > 0;
    const tileClass = `heatmap-tile ${status}${hasWeight ? ' weighted' : ''}`;
    const currentVal = formatValue(spread.value, config.format);
    const quality = spread.data_quality || 'LIVE';
    const qualityClass = quality === 'ESTIMATED' ? 'quality-est' : 'quality-live';

    // Mini sparkline
    const sparkHtml = renderSparkline(history?.[key] || [], status);

    return `<div class="${tileClass}" title="${config.name}">
      <div class="tile-header">
        <span class="tile-name">${config.short}</span>
        <span class="tile-quality ${qualityClass}">${quality}</span>
      </div>
      <div class="tile-value ${status}">${currentVal}</div>
      <div class="tile-z">${z.toFixed(1)}σ</div>
      <div class="tile-spark">${sparkHtml}</div>
      ${spread.regime ? `<div class="tile-regime">${spread.regime}</div>` : ''}
    </div>`;
  }).join('');
}

// ─── Confirmation Dots ───────────────────────────────────────────────────────

function renderConfirmationDots(confirmation) {
  const container = document.getElementById('confirmationDots');
  if (!confirmation) { container.innerHTML = ''; return; }
  const dots = confirmation.checks.map(c =>
    `<span class="conf-dot ${c.confirmed ? 'filled' : 'empty'}" title="${c.name}">${c.confirmed ? '●' : '○'}</span>`
  ).join('');
  const labelClass = confirmation.signal === 'FADE' ? 'conf-fade' : confirmation.signal === 'WATCH' ? 'conf-watch' : '';
  container.innerHTML = `${dots}${confirmation.label ? `<span class="conf-label ${labelClass}">${confirmation.label}</span>` : ''}`;
}

// ─── Reversion Countdowns ────────────────────────────────────────────────────

function renderReversionCountdowns(countdowns) {
  const section = document.getElementById('reversionSection');
  const content = document.getElementById('reversionContent');
  if (!countdowns || Object.keys(countdowns).length === 0) {
    section.classList.add('hidden');
    return;
  }
  section.classList.remove('hidden');
  content.innerHTML = Object.entries(countdowns).map(([key, cd]) => {
    const config = SPREAD_CONFIG[key];
    const pct = Math.min(cd.progress * 100, 100);
    const barColor = cd.overdue ? '#da3633' : '#3fb950';
    return `<div class="reversion-item">
      <div class="reversion-header">
        <span class="reversion-name">${config?.short || key}</span>
        <span class="reversion-status ${cd.overdue ? 'overdue' : ''}">${cd.status}</span>
      </div>
      <div class="reversion-bar"><div class="reversion-fill" style="width:${pct}%;background:${barColor}"></div></div>
      <div class="reversion-text">${cd.display}</div>
    </div>`;
  }).join('');
}

// ─── FII Section ─────────────────────────────────────────────────────────────

function renderFIISection(fiiStats) {
  const section = document.getElementById('fiiSection');
  const content = document.getElementById('fiiContent');
  if (!fiiStats || fiiStats.source === 'INSUFFICIENT_DATA') {
    section.classList.add('hidden');
    return;
  }
  section.classList.remove('hidden');
  const zClass = Math.abs(fiiStats.zscore) >= 2 ? 'z-alert' : Math.abs(fiiStats.zscore) >= 1.5 ? 'z-warning' : 'z-normal';
  const sparkHtml = renderSparkline(fiiStats.sparkline || [], Math.abs(fiiStats.zscore) >= 2 ? 'alert' : 'normal');
  content.innerHTML = `
    <div class="fii-grid">
      <div class="fii-stat"><span class="fii-label">Today</span><span class="fii-value">${fiiStats.today_net > 0 ? '+' : ''}${fiiStats.today_net} Cr</span></div>
      <div class="fii-stat"><span class="fii-label">3-Day</span><span class="fii-value">${fiiStats.cumulative_3d > 0 ? '+' : ''}${fiiStats.cumulative_3d} Cr</span></div>
      <div class="fii-stat"><span class="fii-label">90d Mean</span><span class="fii-value">${fiiStats.mean_90d} Cr</span></div>
      <div class="fii-stat"><span class="fii-label">Z-Score</span><span class="fii-value ${zClass}">${fiiStats.zscore > 0 ? '+' : ''}${fiiStats.zscore}σ</span></div>
    </div>
    <div class="fii-spark">${sparkHtml}</div>
    ${fiiStats.historical_context ? `<div class="fii-context">${fiiStats.historical_context}</div>` : ''}
    <div class="fii-source">Source: ${fiiStats.source} | Sell streak: ${fiiStats.consecutive_sell_days}d</div>
  `;
}

// ─── Historical Analog ───────────────────────────────────────────────────────

function renderAnalog(analog) {
  const section = document.getElementById('analogSection');
  const content = document.getElementById('analogContent');
  if (!analog?.event) { section.classList.add('hidden'); return; }
  section.classList.remove('hidden');
  const drawdownClass = analog.nifty_drawdown < 0 ? 'negative' : 'positive';
  const winRateClass = analog.fade_win_rate >= 75 ? 'good' : 'caution';
  content.innerHTML = `
    <div class="analog-match">
      <div class="analog-header">
        <span class="analog-event-name">${escapeHtml(analog.event)}</span>
        <span class="analog-similarity">${analog.similarity}% match</span>
      </div>
      <div class="analog-details">
        <div class="analog-detail-row"><span class="analog-label">Date</span><span class="analog-value">${analog.date}</span></div>
        <div class="analog-detail-row"><span class="analog-label">Type</span><span class="analog-value">${analog.type}</span></div>
        <div class="analog-detail-row"><span class="analog-label">Nifty Drawdown</span><span class="analog-value ${drawdownClass}">${analog.nifty_drawdown}%</span></div>
        <div class="analog-detail-row"><span class="analog-label">Recovery</span><span class="analog-value">${analog.nifty_recovery_days} days</span></div>
        <div class="analog-detail-row"><span class="analog-label">Fade Win Rate</span><span class="analog-value ${winRateClass}">${analog.fade_win_rate}%</span></div>
      </div>
      ${analog.data_limited ? '<div class="analog-notes">Limited historical data for this event.</div>' : ''}
      ${analog.notes ? `<div class="analog-notes">${escapeHtml(analog.notes)}</div>` : ''}
    </div>
    ${analog.runner_up ? `<div class="runner-up">Runner-up: ${escapeHtml(analog.runner_up.event)} (${analog.runner_up.similarity}%)</div>` : ''}`;
}

// ─── Timeline ────────────────────────────────────────────────────────────────

function renderTimeline(analog) {
  const section = document.getElementById('timelineSection');
  const content = document.getElementById('timelineContent');
  // Load historical events for timeline
  fetch(chrome.runtime.getURL('data/historical-events.json'))
    .then(r => r.json())
    .then(data => {
      const events = data.events || [];
      if (events.length === 0) { section.classList.add('hidden'); return; }
      section.classList.remove('hidden');
      const now = new Date();
      const minYear = 1991;
      const maxYear = now.getFullYear() + 1;
      const range = maxYear - minYear;
      const analogIds = analog ? [analog.event_id, analog.runner_up?.event_id].filter(Boolean) : [];

      let dotsHtml = events.map(evt => {
        const year = parseInt(evt.date?.substring(0, 4) || '2000');
        const pct = ((year - minYear) / range * 100).toFixed(1);
        const isAnalog = analogIds.includes(evt.id);
        const cls = `tl-dot ${evt.type}${isAnalog ? ' analog-match' : ''}`;
        return `<div class="${cls}" style="left:${pct}%" title="${evt.event} (${evt.date})\nDrawdown: ${evt.nifty_drawdown}%\nFade: ${evt.fade_win_rate}%"></div>`;
      }).join('');

      // YOU ARE HERE marker
      const nowPct = ((now.getFullYear() - minYear) / range * 100).toFixed(1);
      dotsHtml += `<div class="tl-now" style="left:${nowPct}%" title="YOU ARE HERE"></div>`;

      content.innerHTML = `
        <div class="timeline-bar">
          <div class="tl-track">${dotsHtml}</div>
          <div class="tl-labels">
            <span>1991</span><span>2000</span><span>2010</span><span>2020</span><span>NOW</span>
          </div>
        </div>`;
    })
    .catch(() => section.classList.add('hidden'));
}

// ─── Fade Stats ──────────────────────────────────────────────────────────────

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
    content.innerHTML += `
      <div class="stat-card">
        <div class="stat-spread-name">${config.name}</div>
        <div class="stat-row"><span class="stat-label">Avg Reversion</span><span class="stat-value">${stats.avg_reversion_days} days</span></div>
        <div class="stat-row"><span class="stat-label">Fade Win Rate</span><span class="stat-value ${winClass}">${stats.avg_fade_win_rate}%</span></div>
        <div class="stat-row"><span class="stat-label">Sample Size</span><span class="stat-value">${stats.sample_size} events</span></div>
      </div>`;
  }
}

// ─── Sparklines ──────────────────────────────────────────────────────────────

function renderSparkline(dataPoints, status) {
  if (!dataPoints || dataPoints.length < 2) return '<span class="spark-empty">--</span>';
  const points = dataPoints.slice(-30);
  const values = points.map(p => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const w = 44, h = 16, pad = 1;
  const pathPoints = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (w - 2 * pad);
    const y = h - pad - ((v - min) / range) * (h - 2 * pad);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const colors = { normal: '#6e7681', elevated: '#d29922', warning: '#db6d28', alert: '#f85149', extreme: '#da3633' };
  const color = colors[status] || colors.normal;
  return `<svg class="sparkline-svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <polyline fill="none" stroke="${color}" stroke-width="1.2" stroke-linecap="round" points="${pathPoints.join(' ')}" />
    <circle cx="${pathPoints[pathPoints.length - 1].split(',')[0]}" cy="${pathPoints[pathPoints.length - 1].split(',')[1]}" r="1.5" fill="${color}" />
  </svg>`;
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function formatValue(value, format) {
  if (value === null || value === undefined) return '--';
  switch (format) {
    case 'pts': return `${value >= 0 ? '+' : ''}${Math.round(value)}`;
    case 'inr': return `₹${Math.abs(value).toFixed(0)}`;
    case 'inr3': return `₹${value.toFixed(3)}`;
    case 'ratio': return value.toFixed(3);
    case 'level': return value.toFixed(1);
    case 'pct': return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
    case 'bps': return `${Math.round(value)} bps`;
    case 'zscore': return `${value >= 0 ? '+' : ''}${value.toFixed(2)}σ`;
    default: return String(value);
  }
}

function timeAgo(ts) {
  if (!ts) return '--';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function truncate(str, len) {
  if (!str || str.length <= len) return str || '';
  return str.substring(0, len) + '...';
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
