// Dislocation Radar v3 — popup renderer
// Light-first, σ-tiered spreads, market-relevance news, one-regime-truth

document.addEventListener('DOMContentLoaded', init);

const SPREAD_CONFIG = {
  nifty_basis:             { name: 'Nifty Basis',        short: 'Nifty Basis',   format: 'pts' },
  banknifty_basis:         { name: 'BankNifty Basis',    short: 'BNF Basis',     format: 'pts' },
  mcx_gold_comex:          { name: 'MCX Gold-COMEX',     short: 'Gold MCX-CMX',  format: 'inr' },
  mcx_silver_comex:        { name: 'MCX Silver-COMEX',   short: 'Silver MCX-CMX',format: 'inr' },
  mcx_crude_brent:         { name: 'MCX Crude-Brent',    short: 'Crude MCX-ICE', format: 'inr' },
  usdinr_basis:            { name: 'USDINR Fut-Spot',    short: 'USDINR Basis',  format: 'inr3' },
  banknifty_nifty_ratio:   { name: 'BankNifty / Nifty',  short: 'BNF/NF Ratio',  format: 'ratio' },
  india_vix:               { name: 'India VIX',          short: 'India VIX',     format: 'level' },
  infy_adr_spread:         { name: 'INFY NSE-ADR',       short: 'INFY ADR',      format: 'pct' },
  icici_adr_spread:        { name: 'ICICI NSE-ADR',      short: 'ICICI ADR',     format: 'pct' },
  nifty_it_nasdaq_ratio:   { name: 'Nifty IT / NASDAQ',  short: 'IT/NASDAQ',     format: 'ratio' },
  nifty_psu_pvt_bank_ratio:{ name: 'PSU / Pvt Bank',     short: 'PSU/PVT Bank',  format: 'ratio' },
  nifty_pharma_nifty_ratio:{ name: 'Pharma / Nifty',     short: 'Pharma/NF',     format: 'ratio' },
  nifty500_nifty50_ratio:  { name: 'Nifty500 / Nifty50', short: 'Breadth',       format: 'ratio' },
  gold_silver_ratio:       { name: 'Gold / Silver',      short: 'Au/Ag',         format: 'ratio' },
  india_us_10y_spread:     { name: 'IN-US 10Y Spread',   short: 'Bond Spread',   format: 'bps' },
  nifty_pcr:               { name: 'Nifty PCR',          short: 'PCR',           format: 'ratio' },
  fii_net_flow:            { name: 'FII Net Flow',       short: 'FII Flow',      format: 'zscore' },
  ois_repo_spread:         { name: 'OIS-Repo',           short: 'OIS-Repo',      format: 'bps' }
};

const HIGH_RELEVANCE_REGEX = /\b(rbi|sebi|tariff|sanction|sanctions|earnings|fii|monetary\s*policy|rate\s*hike|rate\s*cut|repo\s*rate|fed|fomc|cpi|inflation|gdp)\b/i;

let state = {
  data: null,
  expandedSpreads: new Set(),
  analogViewRunnerUp: false,
  newsExpanded: false
};

async function init() {
  await applyThemeFromSettings();
  listenForThemeChanges();
  await loadData();

  document.getElementById('refreshBtn').addEventListener('click', handleRefresh);
  document.getElementById('settingsBtn').addEventListener('click', openSettings);
  document.getElementById('settingsLink').addEventListener('click', (e) => {
    e.preventDefault();
    openSettings();
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'SPREAD_UPDATE') {
      state.data = msg.data;
      renderAll();
    }
  });
}

function openSettings() {
  chrome.runtime.openOptionsPage();
}

// ─── Theme ───────────────────────────────────────────────────────────────────

async function applyThemeFromSettings() {
  try {
    const { settings } = await chrome.storage.sync.get('settings');
    const dark = settings?.darkMode === true;
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  } catch {
    document.documentElement.dataset.theme = 'light';
  }
}

function listenForThemeChanges() {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.settings) {
      const dark = changes.settings.newValue?.darkMode === true;
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    }
  });
}

// ─── Data flow ───────────────────────────────────────────────────────────────

async function loadData() {
  try {
    const data = await chrome.runtime.sendMessage({ type: 'GET_DATA' });
    state.data = data || null;
    renderAll();
  } catch {
    state.data = null;
    renderAll();
  }
}

async function handleRefresh() {
  const btn = document.getElementById('refreshBtn');
  btn.classList.add('spinning');
  btn.disabled = true;
  try {
    await chrome.runtime.sendMessage({ type: 'FORCE_REFRESH' });
    await new Promise(r => setTimeout(r, 1200));
    await loadData();
  } finally {
    btn.classList.remove('spinning');
    btn.disabled = false;
  }
}

function renderAll() {
  const d = state.data || {};
  renderHeader(d);
  renderFearHero(d);
  renderPositioning(d);
  renderSpreadTiers(d);
  renderConfirmations(d);
  renderRipple(d);
  renderReversion(d);
  renderAnalog(d);
  renderTimeline(d);
  renderFadeStats(d);
  renderNews(d);
}

// ─── 1. Header ───────────────────────────────────────────────────────────────

function renderHeader(d) {
  const pill = document.getElementById('marketStatus');
  const ms = d.marketStatus;
  if (!ms) {
    pill.textContent = '--';
    pill.className = 'market-pill';
    return;
  }
  if (ms.nseOpen) {
    pill.textContent = `LIVE ${ms.istTime || ''}`.trim();
    pill.className = 'market-pill live';
  } else {
    pill.textContent = `NSE CLOSED ${ms.istTime || ''}`.trim();
    pill.className = 'market-pill';
  }
}

// ─── 2. Fear Hero ────────────────────────────────────────────────────────────

function deriveRegime(score) {
  if (score == null) return { key: null, label: '--' };
  if (score <= 25) return { key: 'calm', label: 'CALM' };
  if (score <= 50) return { key: 'caution', label: 'CAUTION' };
  if (score <= 75) return { key: 'fear', label: 'FEAR' };
  return { key: 'extreme', label: 'EXTREME' };
}

function renderFearHero(d) {
  const fearTemp = d.lastFearTemp;
  const confirmation = d.lastConfirmation;
  const spreads = d.lastSpreads || {};

  const numberEl = document.getElementById('fearNumber');
  const barFill = document.getElementById('fearBarFill');
  const badge = document.getElementById('fearRegimeBadge');
  const confirmLine = document.getElementById('fearConfirmLine');
  const topSpreadsEl = document.getElementById('fearTopSpreads');
  const contextEl = document.getElementById('fearContext');
  const card = document.getElementById('fearSection');

  const score = fearTemp?.score;
  const regime = deriveRegime(score);

  numberEl.textContent = score == null ? '--' : score;
  const pct = Math.max(0, Math.min(100, score || 0));
  barFill.style.width = `${pct}%`;
  barFill.className = `fear-bar-fill ${regime.key || ''}`;

  badge.textContent = regime.label;
  badge.className = `regime-badge ${regime.key || ''}`;

  card.classList.toggle('extreme', regime.key === 'extreme');

  if (confirmation) {
    confirmLine.textContent = `Confirmations: ${confirmation.score} / ${confirmation.total} active`;
  } else {
    confirmLine.textContent = 'Confirmations: -- / -- active';
  }

  // Top 2 highest |z| spreads
  const topTwo = Object.entries(spreads)
    .filter(([k, s]) => SPREAD_CONFIG[k] && s && typeof s.absZscore === 'number')
    .sort((a, b) => b[1].absZscore - a[1].absZscore)
    .slice(0, 2);
  if (topTwo.length > 0) {
    topSpreadsEl.textContent = topTwo
      .map(([k, s]) => `${SPREAD_CONFIG[k].short} ${s.absZscore.toFixed(1)}σ`)
      .join(' · ');
  } else {
    topSpreadsEl.textContent = '';
  }

  contextEl.textContent = fearTemp?.historicalContext || '';
  contextEl.style.display = fearTemp?.historicalContext ? '' : 'none';
}

// ─── 3. Market Positioning ───────────────────────────────────────────────────

const POSITIONING_TEXT = {
  calm:    'Market calm — no fade opportunity',
  caution: 'Elevated dislocations — monitor for confirmation',
  fear:    'Fear rising — fade setups forming, check confirmations',
  extreme: 'Extreme dislocation — high-probability fade if confirmed'
};

function renderPositioning(d) {
  const card = document.getElementById('positionSection');
  const badge = document.getElementById('positionBadge');
  const text = document.getElementById('positionText');

  const score = d.lastFearTemp?.score;
  const regime = deriveRegime(score);

  badge.textContent = regime.label;
  badge.className = `regime-badge ${regime.key || ''}`;
  text.textContent = POSITIONING_TEXT[regime.key] || 'Analyzing market conditions...';
  card.classList.toggle('extreme', regime.key === 'extreme');
}

// ─── 4. Spread Heatmap (tiered) ──────────────────────────────────────────────

function bucketize(spreads) {
  const tier1 = [], tier2 = [], tier3 = [];
  for (const [key, spread] of Object.entries(spreads || {})) {
    if (!SPREAD_CONFIG[key] || !spread) continue;
    const z = spread.absZscore || 0;
    const entry = { key, spread };
    if (z >= 5) tier1.push(entry);
    else if (z >= 3) tier2.push(entry);
    else tier3.push(entry);
  }
  const bySigmaDesc = (a, b) => (b.spread.absZscore || 0) - (a.spread.absZscore || 0);
  tier1.sort(bySigmaDesc);
  tier2.sort(bySigmaDesc);
  tier3.sort(bySigmaDesc);
  return { tier1, tier2, tier3 };
}

function computeTrendPct(history) {
  if (!Array.isArray(history) || history.length < 2) return null;
  const last = history[history.length - 1]?.value;
  const first = history[0]?.value;
  if (first == null || last == null || first === 0) return null;
  return ((last - first) / Math.abs(first)) * 100;
}

function renderSpreadTiers(d) {
  const spreads = d.lastSpreads || {};
  const history = d.spreadHistory || {};
  const { tier1, tier2, tier3 } = bucketize(spreads);

  const t1 = document.getElementById('tier1Grid');
  const t2 = document.getElementById('tier2Grid');
  const t3 = document.getElementById('tier3Card');

  t1.innerHTML = tier1.map(e => spreadCardHtml(e, 'critical', history[e.key])).join('');
  t2.innerHTML = tier2.map(e => spreadCardHtml(e, 'elevated', history[e.key])).join('');
  t3.innerHTML = tier3.map(e => spreadRowHtml(e)).join('');

  // Click-to-expand for tier 1 / tier 2 cards
  [t1, t2].forEach(container => {
    container.querySelectorAll('.spread-card').forEach(el => {
      el.addEventListener('click', () => {
        const key = el.dataset.key;
        if (state.expandedSpreads.has(key)) state.expandedSpreads.delete(key);
        else state.expandedSpreads.add(key);
        renderSpreadTiers(state.data || {});
      });
    });
  });
}

function spreadCardHtml({ key, spread }, tierClass, hist) {
  const cfg = SPREAD_CONFIG[key];
  const value = formatValue(spread.value, cfg.format);
  const z = spread.absZscore || 0;
  const quality = (spread.data_quality || 'LIVE').toLowerCase();
  const qLabel = (spread.data_quality || 'LIVE').toUpperCase();
  const expanded = state.expandedSpreads.has(key);

  const trend5 = computeTrendPct((hist || []).slice(-5));
  const trend20 = computeTrendPct((hist || []).slice(-20));
  const title = [
    cfg.name,
    trend5 != null ? `5d: ${trend5 >= 0 ? '+' : ''}${trend5.toFixed(1)}%` : null,
    trend20 != null ? `20d: ${trend20 >= 0 ? '+' : ''}${trend20.toFixed(1)}%` : null
  ].filter(Boolean).join('\n');

  let expandHtml = '';
  if (expanded) {
    expandHtml = `<div class="spread-expand">${renderSparkline(hist || [], tierClass)}</div>`;
  }

  return `
    <div class="spread-card ${tierClass}" data-key="${escapeHtml(key)}" title="${escapeHtml(title)}">
      <div class="spread-card-head">
        <span class="spread-card-name">${escapeHtml(cfg.short)}</span>
        <span class="quality-badge ${quality}">${escapeHtml(qLabel)}</span>
      </div>
      <div class="spread-card-value">${value}</div>
      <div class="spread-card-sigma">${z.toFixed(1)}σ</div>
      ${expandHtml}
    </div>`;
}

function spreadRowHtml({ key, spread }) {
  const cfg = SPREAD_CONFIG[key];
  const value = formatValue(spread.value, cfg.format);
  const z = spread.absZscore || 0;
  return `
    <div class="spread-row">
      <span class="spread-row-name">${escapeHtml(cfg.short)}</span>
      <span class="spread-row-right">
        <span class="spread-row-value">${value}</span>
        <span class="spread-row-sigma">${z.toFixed(1)}σ</span>
      </span>
    </div>`;
}

// ─── 5. Confirmations ────────────────────────────────────────────────────────

function renderConfirmations(d) {
  const pillsEl = document.getElementById('confirmPills');
  const summaryEl = document.getElementById('confirmSummary');
  const confirmation = d.lastConfirmation;
  if (!confirmation || !confirmation.checks) {
    pillsEl.innerHTML = '';
    summaryEl.textContent = 'Awaiting data';
    return;
  }
  pillsEl.innerHTML = confirmation.checks
    .map(c => `<span class="confirm-pill ${c.confirmed ? 'active' : ''}">${escapeHtml(c.name)}</span>`)
    .join('');
  const met = confirmation.score >= 3;
  summaryEl.textContent = `${confirmation.score} of ${confirmation.total} active — ${met ? 'confirmation threshold met' : 'insufficient for high-confidence fade'}`;
}

// ─── 6. Global Ripple Check ──────────────────────────────────────────────────

function renderRipple(d) {
  const card = document.getElementById('rippleCard');
  const r = d.lastRippleCheck;
  if (!r || !r.active) {
    card.className = 'card ripple-card';
    card.innerHTML = `<div class="ripple-empty">No active global ripple detected.</div>`;
    return;
  }

  const severityMap = {
    LOW: 'low',
    MODERATE: 'moderate',
    HIGH: 'high',
    CRITICAL: 'high'
  };
  const sevKey = severityMap[r.severity] || 'low';
  const category = (r.type || '').replace(/_/g, ' ').toUpperCase();

  const degreeToRank = { '1st': 1, '2nd': 2, '3rd': 3 };
  const sectorsHtml = (r.connections || [])
    .map(c => `<span class="sector-chip rank-${degreeToRank[c.degree] || 3}">${escapeHtml(c.sector)}</span>`)
    .join('');

  card.className = 'card ripple-card';
  card.innerHTML = `
    <div class="ripple-head">
      <span class="regime-badge ${sevKey}">${escapeHtml(r.severity || '')}</span>
      <span class="ripple-category">${escapeHtml(category)}</span>
    </div>
    <div class="ripple-headline">${escapeHtml(truncate(r.event || '', 120))}</div>
    ${sectorsHtml ? `<div class="ripple-sectors">${sectorsHtml}</div>` : ''}
    ${r.watch ? `<div class="ripple-watch">WATCH: ${escapeHtml(r.watch)}</div>` : ''}
    ${r.daily_life_impact ? `<div class="ripple-context">${escapeHtml(r.daily_life_impact)}</div>` : ''}
  `;
}

// ─── 7. Reversion Countdown ──────────────────────────────────────────────────

function renderReversion(d) {
  const card = document.getElementById('reversionCard');
  const countdowns = d.lastReversionCountdowns || {};
  const entries = Object.entries(countdowns);

  if (entries.length === 0) {
    card.innerHTML = `<div class="reversion-empty">No active fade signals.</div>`;
    return;
  }

  card.innerHTML = entries.map(([key, cd]) => {
    const cfg = SPREAD_CONFIG[key];
    const name = cfg?.short || cd.spreadLabel || key;
    const overdue = cd.overdue;
    const pct = Math.max(0, Math.min(100, (cd.progress || 0) * 100));
    const avg = cd.avgReversionDays;
    const avgLabel = avg == null ? 'N/A' : `${avg}`;
    const daysPassed = Math.round(cd.daysPassed || 0);
    const subText = avg == null
      ? `Day ${daysPassed} of avg window: N/A`
      : `Day ${daysPassed} of avg ${avgLabel}-day window`;

    return `
      <div class="reversion-row">
        <div class="reversion-row-top">
          <span class="reversion-name">${escapeHtml(name)}</span>
          <span class="reversion-active-badge ${overdue ? 'overdue' : ''}">${overdue ? 'OVERDUE' : 'ACTIVE'}</span>
        </div>
        <div class="reversion-bar-track"><div class="reversion-bar-fill ${overdue ? 'overdue' : ''}" style="width:${pct}%"></div></div>
        <div class="reversion-sub">${subText}</div>
      </div>`;
  }).join('');
}

// ─── 8. Historical Match ─────────────────────────────────────────────────────

function renderAnalog(d) {
  const card = document.getElementById('analogCard');
  const analog = d.lastAnalog;
  if (!analog || !analog.event) {
    card.innerHTML = `<div class="stats-empty">No historical match yet.</div>`;
    card.onclick = null;
    return;
  }

  const runner = analog.runner_up;
  const showRunnerUp = state.analogViewRunnerUp && runner;
  const display = showRunnerUp
    ? {
        event: runner.event,
        similarity: runner.similarity,
        type: runner.type,
        date: analog.date,
        nifty_drawdown: analog.nifty_drawdown,
        nifty_recovery_days: analog.nifty_recovery_days,
        fade_win_rate: analog.fade_win_rate,
        notes: 'Runner-up match details.',
        isRunnerUp: true
      }
    : analog;

  const dd = display.nifty_drawdown;
  const ddClass = typeof dd === 'number' && dd < 0 ? 'negative' : '';
  const runnerLine = runner
    ? (showRunnerUp
        ? `<div class="analog-runner">Click to return to primary: ${escapeHtml(analog.event)}</div>`
        : `<div class="analog-runner">Runner-up: ${escapeHtml(runner.event)} (${runner.similarity}% match)</div>`)
    : '';

  card.innerHTML = `
    <div class="analog-top">
      <span class="analog-name">${escapeHtml(display.event || '')}</span>
      <span class="analog-match-pill">${display.similarity || 0}% match</span>
    </div>
    <div class="analog-grid">
      <div>
        <div class="analog-cell-label">Date</div>
        <div class="analog-cell-value">${escapeHtml(display.date || '--')}</div>
      </div>
      <div>
        <div class="analog-cell-label">Drawdown</div>
        <div class="analog-cell-value ${ddClass}">${dd != null ? dd + '%' : '--'}</div>
      </div>
      <div>
        <div class="analog-cell-label">Recovery</div>
        <div class="analog-cell-value">${display.nifty_recovery_days != null ? display.nifty_recovery_days + ' days' : '--'}</div>
      </div>
    </div>
    <div class="analog-winrate">
      <span class="analog-winrate-label">Fade win rate</span>
      <span class="analog-winrate-value">${display.fade_win_rate != null ? display.fade_win_rate + '%' : '--'}</span>
    </div>
    ${display.notes ? `<div class="analog-context">${escapeHtml(display.notes)}</div>` : ''}
    ${runnerLine}
  `;

  card.onclick = runner ? () => {
    state.analogViewRunnerUp = !state.analogViewRunnerUp;
    renderAnalog(state.data || {});
  } : null;
}

// ─── 9. Event Timeline ───────────────────────────────────────────────────────

let timelineEventsCache = null;

async function renderTimeline(d) {
  const card = document.getElementById('timelineCard');
  if (!timelineEventsCache) {
    try {
      const resp = await fetch(chrome.runtime.getURL('data/historical-events.json'));
      const json = await resp.json();
      timelineEventsCache = json.events || [];
    } catch {
      timelineEventsCache = [];
    }
  }
  const events = timelineEventsCache;
  if (events.length === 0) {
    card.innerHTML = `<div class="stats-empty">Timeline unavailable.</div>`;
    return;
  }

  const analog = d.lastAnalog;
  const analogIds = analog ? [analog.event_id, analog.runner_up?.event_id].filter(Boolean) : [];
  const now = new Date();
  const minYear = 1991;
  const maxYear = now.getFullYear() + 1;
  const range = maxYear - minYear;

  const dotsHtml = events.map(evt => {
    const year = parseInt((evt.date || '').substring(0, 4), 10);
    if (!year) return '';
    const pct = ((year - minYear) / range * 100).toFixed(1);
    const isAnalog = analogIds.includes(evt.id);
    const cls = `tl-dot ${evt.type || ''}${isAnalog ? ' analog-match' : ''}`;
    const title = `${evt.event || ''} (${evt.date || ''})${evt.nifty_drawdown != null ? '\nDrawdown: ' + evt.nifty_drawdown + '%' : ''}${evt.fade_win_rate != null ? '\nFade win rate: ' + evt.fade_win_rate + '%' : ''}`;
    return `<div class="${cls}" style="left:${pct}%" title="${escapeHtml(title)}"></div>`;
  }).join('');

  const nowPct = ((now.getFullYear() + (now.getMonth() / 12) - minYear) / range * 100).toFixed(1);

  card.innerHTML = `
    <div class="timeline-bar">
      ${dotsHtml}
      <div class="tl-now" style="left:${nowPct}%"></div>
    </div>
    <div class="tl-labels"><span>1991</span><span>2000</span><span>2010</span><span>2020</span><span>NOW</span></div>
  `;
}

// ─── 10. Fade Statistics ─────────────────────────────────────────────────────

function renderFadeStats(d) {
  const card = document.getElementById('statsCard');
  const analog = d.lastAnalog;
  const fadeStats = analog?.fade_stats || {};
  const entries = Object.entries(fadeStats);

  if (entries.length === 0) {
    card.innerHTML = `<div class="stats-empty">No fade statistics available.</div>`;
    return;
  }

  // Pick highest-sample / highest-win-rate spread
  entries.sort((a, b) => (b[1].avg_fade_win_rate || 0) - (a[1].avg_fade_win_rate || 0));
  const [key, stats] = entries[0];
  const cfg = SPREAD_CONFIG[key];
  const name = cfg?.name || key;
  const lowSample = (stats.sample_size || 0) < 10;

  card.innerHTML = `
    <div class="stats-title">${escapeHtml(name)}</div>
    <div class="stats-grid">
      <div>
        <div class="stats-cell-label">Avg reversion</div>
        <div class="stats-cell-value">${stats.avg_reversion_days != null ? stats.avg_reversion_days + ' days' : '--'}</div>
      </div>
      <div>
        <div class="stats-cell-label">Fade win rate</div>
        <div class="stats-cell-value positive">${stats.avg_fade_win_rate != null ? stats.avg_fade_win_rate + '%' : '--'}</div>
      </div>
      <div>
        <div class="stats-cell-label">Sample size</div>
        <div class="stats-cell-value">${stats.sample_size != null ? stats.sample_size : '--'}</div>
      </div>
    </div>
    ${lowSample ? `<div class="stats-warn">Low sample size — treat with caution</div>` : ''}
  `;
}

// ─── 11. Live News ───────────────────────────────────────────────────────────

function classifyNewsRelevance(event) {
  const type = (event.type || '').toUpperCase();
  const headline = event.headline || '';
  if (type === 'MAC' || type === 'CRISIS') return 'high';
  if (HIGH_RELEVANCE_REGEX.test(headline)) return 'high';
  if (type === 'GEO' || type === 'SUPPLY') return 'medium';
  return 'low';
}

function renderNews(d) {
  const card = document.getElementById('newsCard');
  const velocityEl = document.getElementById('velocityIndicator');

  // Velocity indicator in section header
  const velocity = d.lastVelocity;
  if (velocity?.alert && velocity.ratio > 1) {
    velocityEl.textContent = `${velocity.ratio.toFixed(1)}× velocity`;
  } else {
    velocityEl.textContent = '';
  }

  const events = d.activeEvents || [];
  if (events.length === 0) {
    card.innerHTML = `<div class="news-empty">No market-moving headlines in the last hour.</div>`;
    return;
  }

  const tagged = events.map(e => ({ ...e, _relevance: classifyNewsRelevance(e) }));
  const priority = { high: 0, medium: 1, low: 2 };
  tagged.sort((a, b) => {
    const pd = priority[a._relevance] - priority[b._relevance];
    if (pd !== 0) return pd;
    return (b.timestamp || 0) - (a.timestamp || 0);
  });

  const limit = state.newsExpanded ? 15 : 5;
  const visible = tagged.slice(0, limit);
  const hasMore = tagged.length > limit;

  const rowsHtml = visible.map(ev => {
    const headlineEl = ev.link
      ? `<a class="news-headline" href="${escapeHtml(ev.link)}" target="_blank" rel="noopener">${escapeHtml(ev.headline || '')}</a>`
      : `<span class="news-headline">${escapeHtml(ev.headline || '')}</span>`;
    return `
      <div class="news-row">
        <div class="news-accent ${ev._relevance}"></div>
        <div class="news-body">
          ${headlineEl}
          <div class="news-meta">
            <span class="news-source">${escapeHtml(ev.source || '')}</span>
            <span class="news-category ${ev._relevance}">${escapeHtml(ev.type || '')}</span>
            <span class="news-time">${timeAgo(ev.timestamp)}</span>
          </div>
        </div>
      </div>`;
  }).join('');

  const moreBtn = hasMore && !state.newsExpanded
    ? `<button class="news-more" id="newsMoreBtn">Show more (${tagged.length - limit})</button>`
    : '';

  card.innerHTML = rowsHtml + moreBtn;

  const moreEl = document.getElementById('newsMoreBtn');
  if (moreEl) {
    moreEl.addEventListener('click', () => {
      state.newsExpanded = true;
      renderNews(state.data || {});
    });
  }
}

// ─── Sparklines ──────────────────────────────────────────────────────────────

function renderSparkline(dataPoints, tierClass) {
  if (!dataPoints || dataPoints.length < 2) return '<span class="hint-label">No history yet</span>';
  const points = dataPoints.slice(-20);
  const values = points.map(p => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const w = 360, h = 60, pad = 4;
  const path = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (w - 2 * pad);
    const y = h - pad - ((v - min) / range) * (h - 2 * pad);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const strokeClass = tierClass || '';
  const color = strokeClass === 'critical'
    ? 'var(--critical)'
    : strokeClass === 'elevated'
    ? 'var(--elevated)'
    : 'var(--text-secondary)';

  return `
    <svg class="sparkline-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
      <polyline fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" points="${path.join(' ')}" />
    </svg>`;
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function formatValue(value, format) {
  if (value === null || value === undefined) return '--';
  switch (format) {
    case 'pts':    return `${value >= 0 ? '+' : ''}${Math.round(value)}`;
    case 'inr':    return `₹${Math.abs(value).toFixed(0)}`;
    case 'inr3':   return `₹${value.toFixed(3)}`;
    case 'ratio':  return value.toFixed(3);
    case 'level':  return value.toFixed(1);
    case 'pct':    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
    case 'bps':    return `${Math.round(value)} bps`;
    case 'zscore': return `${value >= 0 ? '+' : ''}${value.toFixed(2)}σ`;
    default:       return String(value);
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
  if (text == null) return '';
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}
