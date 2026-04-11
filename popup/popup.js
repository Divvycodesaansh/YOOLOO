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

// v3.1: semantic grouping for the spread heatmap — drives group badges
// and the CLUSTERED/ISOLATED section pill.
const SPREAD_GROUPS = {
  india_us_10y_spread:      'CREDIT·RATES',
  ois_repo_spread:          'CREDIT·RATES',
  usdinr_basis:             'CREDIT·RATES',
  infy_adr_spread:          'CROSS·LISTING',
  icici_adr_spread:         'CROSS·LISTING',
  nifty_it_nasdaq_ratio:    'CROSS·LISTING',
  mcx_gold_comex:           'CROSS·LISTING',
  mcx_silver_comex:         'CROSS·LISTING',
  mcx_crude_brent:          'CROSS·LISTING',
  banknifty_nifty_ratio:    'SECTORAL',
  nifty_psu_pvt_bank_ratio: 'SECTORAL',
  nifty_pharma_nifty_ratio: 'SECTORAL',
  nifty500_nifty50_ratio:   'SECTORAL',
  gold_silver_ratio:        'SECTORAL',
  nifty_basis:              'SECTORAL',
  banknifty_basis:          'SECTORAL',
  india_vix:                'SENTIMENT·FLOW',
  nifty_pcr:                'SENTIMENT·FLOW',
  fii_net_flow:             'SENTIMENT·FLOW'
};

// v3.1: transmission chains — how a macro shock propagates. Keyed by
// rippleCheck.type. Kept as a popup-side static map because the ripple
// analyzer in background doesn't currently produce this.
const TRANSMISSION_CHAINS = {
  TRADE_WAR:       'tariff → supply chain → input costs → margins → equities',
  GEOPOLITICAL:    'event → risk-off flows → USD/oil spike → FII outflow → Nifty',
  OIL_SHOCK:       'oil → inflation → RBI hawkish → rate hike → banks & midcap drag',
  CENTRAL_BANK:    'Fed/RBI surprise → USD → FX → EM outflow → Nifty',
  EMERGING_MARKET: 'EM contagion → FX → FII outflow → Nifty',
  CRISIS:          'stress → funding → vol spike → risk unwinds → equities',
  DEFAULT:         'event → FX → equities → vol'
};

// v3.1: impact lag — how soon the shock typically shows in NSE prints.
const IMPACT_LAG = {
  TRADE_WAR:       '2–5 sessions',
  GEOPOLITICAL:    '1–3 sessions',
  OIL_SHOCK:       '1–2 sessions',
  CENTRAL_BANK:    'same session',
  EMERGING_MARKET: '1–3 sessions',
  CRISIS:          'same session',
  DEFAULT:         '1–3 sessions'
};

let state = {
  data: null,
  expandedSpreads: new Set(),
  analogViewRunnerUp: false,
  newsExpanded: false,
  sessionSnapshot: null
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
  // v3.1 — capture snapshot of the first render as the session baseline for the changelog
  if (!state.sessionSnapshot && d.lastFearTemp) {
    state.sessionSnapshot = snapshotForChangelog(d);
  }
  renderHeader(d);
  renderFearHero(d);
  renderChangelog(d);
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

// ─── 2a. Session Changelog (v3.1) ────────────────────────────────────────────

function snapshotForChangelog(d) {
  const snap = {
    fearScore: d.lastFearTemp?.score ?? null,
    confirmed: new Set(),
    spreads: {}
  };
  const checks = d.lastConfirmation?.checks || [];
  for (const c of checks) {
    if (c.confirmed) snap.confirmed.add(c.name);
  }
  for (const [key, s] of Object.entries(d.lastSpreads || {})) {
    if (SPREAD_CONFIG[key] && s && typeof s.absZscore === 'number') {
      snap.spreads[key] = s.absZscore;
    }
  }
  return snap;
}

function renderChangelog(d) {
  const card = document.getElementById('changelogCard');
  if (!card) return;
  const snap = state.sessionSnapshot;
  if (!snap || !d.lastFearTemp) {
    card.innerHTML = `<div class="changelog-empty">Establishing session baseline…</div>`;
    return;
  }

  const rows = [];

  // Fear temp delta
  const curScore = d.lastFearTemp?.score;
  if (typeof curScore === 'number' && typeof snap.fearScore === 'number') {
    const delta = curScore - snap.fearScore;
    if (Math.abs(delta) >= 3) {
      const arrow = delta > 0 ? '↑' : '↓';
      const cls = delta > 0 ? 'up' : 'down';
      rows.push(`<div class="changelog-row ${cls}">${arrow} Fear Temp: ${snap.fearScore} → ${curScore} (${delta > 0 ? '+' : ''}${delta})</div>`);
    }
  }

  // Confirmation additions / removals
  const curConfirmed = new Set();
  for (const c of (d.lastConfirmation?.checks || [])) {
    if (c.confirmed) curConfirmed.add(c.name);
  }
  for (const name of curConfirmed) {
    if (!snap.confirmed.has(name)) {
      rows.push(`<div class="changelog-row up">✓ Confirmation added: ${escapeHtml(name)}</div>`);
    }
  }
  for (const name of snap.confirmed) {
    if (!curConfirmed.has(name)) {
      rows.push(`<div class="changelog-row down">✗ Confirmation cleared: ${escapeHtml(name)}</div>`);
    }
  }

  // Spread sigma moves — only report meaningful moves (|Δ| ≥ 0.8σ)
  const spreadDiffs = [];
  for (const [key, s] of Object.entries(d.lastSpreads || {})) {
    if (!SPREAD_CONFIG[key] || typeof s?.absZscore !== 'number') continue;
    const prev = snap.spreads[key];
    if (typeof prev !== 'number') continue;
    const delta = s.absZscore - prev;
    if (Math.abs(delta) >= 0.8) {
      spreadDiffs.push({ key, prev, cur: s.absZscore, delta });
    }
  }
  spreadDiffs.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  for (const diff of spreadDiffs.slice(0, 5)) {
    const cfg = SPREAD_CONFIG[diff.key];
    const arrow = diff.delta > 0 ? '↑' : '↓';
    const cls = diff.delta > 0 ? 'up' : 'down';
    rows.push(`<div class="changelog-row ${cls}">${arrow} ${escapeHtml(cfg.short)}: ${diff.prev.toFixed(1)}σ → ${diff.cur.toFixed(1)}σ (${diff.delta > 0 ? '+' : ''}${diff.delta.toFixed(1)}σ)</div>`);
  }

  if (rows.length === 0) {
    card.innerHTML = `<div class="changelog-empty">No material changes since session start.</div>`;
  } else {
    card.innerHTML = rows.join('');
  }
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
  const momentumEl = document.getElementById('fearMomentum');
  const driverEl = document.getElementById('fearDriver');

  const score = fearTemp?.score;
  const regime = deriveRegime(score);

  numberEl.textContent = score == null ? '--' : score;
  const pct = Math.max(0, Math.min(100, score || 0));
  barFill.style.width = `${pct}%`;
  barFill.className = `fear-bar-fill ${regime.key || ''}`;

  badge.textContent = regime.label;
  badge.className = `regime-badge ${regime.key || ''}`;

  card.classList.toggle('extreme', regime.key === 'extreme');

  // v3.1 — directional momentum arrow from fearTemp.previous
  if (momentumEl) {
    const prev = fearTemp?.previous?.score;
    if (score != null && typeof prev === 'number') {
      const delta = score - prev;
      if (Math.abs(delta) < 1) {
        momentumEl.textContent = '→ 0';
        momentumEl.className = 'momentum-arrow flat';
      } else if (delta > 0) {
        momentumEl.textContent = `▲ +${delta}`;
        momentumEl.className = 'momentum-arrow rising';
      } else {
        momentumEl.textContent = `▼ ${delta}`;
        momentumEl.className = 'momentum-arrow falling';
      }
    } else {
      momentumEl.textContent = '';
      momentumEl.className = 'momentum-arrow';
    }
  }

  if (confirmation) {
    const weighted = confirmation.weightedScore != null && confirmation.maxWeighted != null
      ? ` · weighted ${confirmation.weightedScore}/${confirmation.maxWeighted}`
      : '';
    confirmLine.textContent = `Confirmations: ${confirmation.score} / ${confirmation.total} active${weighted}`;
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

  // v3.1 — Fear Temp weight breakdown (top driver)
  if (driverEl) {
    const top = fearTemp?.topDriver;
    const contrib = top ? fearTemp?.contributions?.[top] : null;
    if (top && contrib && contrib.contribution > 0) {
      const label = SPREAD_CONFIG[top]?.short || top.replace(/_/g, ' ');
      driverEl.textContent = `Top driver: ${label} (${contrib.weight} × ${contrib.z}σ = +${contrib.contribution.toFixed(0)})`;
      driverEl.style.display = '';
    } else {
      driverEl.textContent = '';
      driverEl.style.display = 'none';
    }
  }

  contextEl.textContent = fearTemp?.historicalContext || '';
  contextEl.style.display = fearTemp?.historicalContext ? '' : 'none';
}

// ─── 3. Market Positioning ───────────────────────────────────────────────────

// v3.1: context-aware positioning — combines regime, weighted confirmation
// strength, and the count of active reversion countdowns.
function buildPositioningText(d) {
  const score = d.lastFearTemp?.score;
  const regime = deriveRegime(score);
  const conf = d.lastConfirmation;
  const reversions = d.lastReversionCountdowns || {};
  const activeReversionCount = Object.keys(reversions).length;
  const weightedScore = conf?.weightedScore ?? 0;
  const maxWeighted = conf?.maxWeighted ?? 8.1;
  const weightedRatio = maxWeighted > 0 ? weightedScore / maxWeighted : 0;

  // Confirmation strength bucket
  let confBucket;
  if (weightedRatio >= 0.6) confBucket = 'strong';
  else if (weightedRatio >= 0.35) confBucket = 'building';
  else confBucket = 'thin';

  if (score == null) return 'Analyzing market conditions...';

  const reversionTail = activeReversionCount > 0
    ? ` · ${activeReversionCount} spread${activeReversionCount > 1 ? 's' : ''} in reversion window`
    : '';

  if (regime.key === 'calm') {
    return `Market calm (${score}/100) — no fade opportunity. Wait for a shock.`;
  }
  if (regime.key === 'caution') {
    if (confBucket === 'strong') {
      return `Caution (${score}/100) but confirmations strong — early fade entry viable${reversionTail}.`;
    }
    if (confBucket === 'building') {
      return `Elevated (${score}/100), confirmations building — monitor top drivers${reversionTail}.`;
    }
    return `Elevated (${score}/100) on sentiment alone — wait for confirmations${reversionTail}.`;
  }
  if (regime.key === 'fear') {
    if (confBucket === 'strong') {
      return `Fear rising (${score}/100) with strong confirmations — high-conviction fade${reversionTail}.`;
    }
    if (confBucket === 'building') {
      return `Fear rising (${score}/100) — confirmations building, stage fade entries${reversionTail}.`;
    }
    return `Fear rising (${score}/100) but confirmations thin — isolated vol, not a fade yet${reversionTail}.`;
  }
  if (regime.key === 'extreme') {
    if (confBucket === 'strong') {
      return `EXTREME (${score}/100) with strong confirmations — max-conviction fade${reversionTail}.`;
    }
    if (confBucket === 'building') {
      return `EXTREME (${score}/100) — confirmations building, prepare fade tranches${reversionTail}.`;
    }
    return `EXTREME (${score}/100) but confirmations thin — possible isolated move, wait${reversionTail}.`;
  }
  return 'Analyzing market conditions...';
}

function renderPositioning(d) {
  const card = document.getElementById('positionSection');
  const badge = document.getElementById('positionBadge');
  const text = document.getElementById('positionText');

  const score = d.lastFearTemp?.score;
  const regime = deriveRegime(score);

  badge.textContent = regime.label;
  badge.className = `regime-badge ${regime.key || ''}`;
  text.textContent = buildPositioningText(d);
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
  const clusterPill = document.getElementById('clusterPill');

  t1.innerHTML = tier1.map(e => spreadCardHtml(e, 'critical', history[e.key])).join('');
  t2.innerHTML = tier2.map(e => spreadCardHtml(e, 'elevated', history[e.key])).join('');
  t3.innerHTML = tier3.map(e => spreadRowHtml(e)).join('');

  // v3.1 — CLUSTERED/ISOLATED pill: count tier1+tier2 spreads per semantic group;
  // if any group has ≥3, the dislocation is clustered (structural), else isolated.
  if (clusterPill) {
    const topTier = [...tier1, ...tier2];
    const groupCounts = {};
    for (const { key } of topTier) {
      const g = SPREAD_GROUPS[key];
      if (!g) continue;
      groupCounts[g] = (groupCounts[g] || 0) + 1;
    }
    const maxGroup = Object.entries(groupCounts).sort((a, b) => b[1] - a[1])[0];
    if (topTier.length === 0) {
      clusterPill.textContent = '';
      clusterPill.className = 'cluster-pill';
    } else if (maxGroup && maxGroup[1] >= 3) {
      clusterPill.textContent = `${maxGroup[1]} clustered · ${maxGroup[0]}`;
      clusterPill.className = 'cluster-pill clustered';
    } else {
      clusterPill.textContent = 'isolated';
      clusterPill.className = 'cluster-pill isolated';
    }
  }

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

  const group = SPREAD_GROUPS[key];
  const groupBadge = group
    ? `<span class="group-badge">${escapeHtml(group)}</span>`
    : '';

  return `
    <div class="spread-card ${tierClass}" data-key="${escapeHtml(key)}" title="${escapeHtml(title)}">
      <div class="spread-card-head">
        <span class="spread-card-name">${escapeHtml(cfg.short)}</span>
        <span class="quality-badge ${quality}">${escapeHtml(qLabel)}</span>
      </div>
      <div class="spread-card-value">${value}</div>
      <div class="spread-card-foot">
        <span class="spread-card-sigma">${z.toFixed(1)}σ</span>
        ${groupBadge}
      </div>
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
    .map(c => {
      // v3.1 — near-miss: inactive pills whose progress toward threshold ≥ 0.85
      const isNearMiss = !c.confirmed && typeof c.progressPct === 'number' && c.progressPct >= 0.85;
      const classes = [
        'confirm-pill',
        c.confirmed ? 'active' : '',
        isNearMiss ? 'near-miss' : ''
      ].filter(Boolean).join(' ');
      const tip = c.triggerRule || c.name;
      const subLabel = (typeof c.currentValue === 'number' && typeof c.threshold === 'number')
        ? `<span class="confirm-pill-sub">${c.currentValue.toFixed(1)} / ${c.threshold.toFixed(1)}σ</span>`
        : '';
      return `<span class="${classes}" title="${escapeHtml(tip)}">
        <span class="confirm-pill-name">${escapeHtml(c.name)}</span>
        ${subLabel}
      </span>`;
    })
    .join('');

  const met = confirmation.score >= 3;
  const weighted = confirmation.weightedScore != null && confirmation.maxWeighted != null
    ? ` · weighted ${confirmation.weightedScore}/${confirmation.maxWeighted}`
    : '';
  summaryEl.textContent = `${confirmation.score} of ${confirmation.total} active${weighted} — ${met ? 'confirmation threshold met' : 'insufficient for high-confidence fade'}`;
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

  // v3.1 — transmission chain + impact lag, keyed by ripple type
  const typeKey = (r.type || '').toUpperCase();
  const chain = TRANSMISSION_CHAINS[typeKey] || TRANSMISSION_CHAINS.DEFAULT;
  const lag = IMPACT_LAG[typeKey] || IMPACT_LAG.DEFAULT;

  card.className = 'card ripple-card';
  card.innerHTML = `
    <div class="ripple-head">
      <span class="regime-badge ${sevKey}">${escapeHtml(r.severity || '')}</span>
      <span class="ripple-category">${escapeHtml(category)}</span>
      <span class="lag-chip">Lag: ${escapeHtml(lag)}</span>
    </div>
    <div class="ripple-headline">${escapeHtml(truncate(r.event || '', 120))}</div>
    <div class="transmission-line">Transmission: ${escapeHtml(chain)}</div>
    ${sectorsHtml ? `<div class="ripple-sectors">${sectorsHtml}</div>` : ''}
    ${r.watch ? `<div class="ripple-watch">WATCH: ${escapeHtml(r.watch)}</div>` : ''}
    ${r.daily_life_impact ? `<div class="ripple-context">${escapeHtml(r.daily_life_impact)}</div>` : ''}
  `;
}

// ─── 7. Reversion Countdown ──────────────────────────────────────────────────

// v3.1 — reversion velocity: compare current z-score against the sample roughly
// 3h ago in spreadHistory. Positive velocity = widening (bad), negative = reverting.
function computeReversionVelocity(history, currentZ) {
  if (!Array.isArray(history) || history.length < 2 || typeof currentZ !== 'number') {
    return null;
  }
  const now = Date.now();
  const targetAgo = now - 3 * 60 * 60 * 1000;
  // Walk backwards and find the first sample at or before target time.
  let ref = null;
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    if ((h?.ts || 0) <= targetAgo) { ref = h; break; }
  }
  if (!ref || typeof ref.zscore !== 'number') {
    // Fall back to oldest available sample so we still show a direction.
    ref = history[0];
  }
  if (!ref || typeof ref.zscore !== 'number') return null;
  const delta = Math.abs(currentZ) - Math.abs(ref.zscore);
  return parseFloat(delta.toFixed(2));
}

function renderReversion(d) {
  const card = document.getElementById('reversionCard');
  const countdowns = d.lastReversionCountdowns || {};
  const spreads = d.lastSpreads || {};
  const history = d.spreadHistory || {};
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

    // v3.1 velocity arrow
    const currentZ = spreads[key]?.absZscore || 0;
    const velocity = computeReversionVelocity(history[key], currentZ);
    let velocityHtml = '';
    if (velocity != null) {
      if (velocity < -0.1) {
        velocityHtml = `<span class="velocity-arrow reverting" title="z-score reverting (${velocity.toFixed(2)}σ over ~3h)">▼ ${Math.abs(velocity).toFixed(1)}σ</span>`;
      } else if (velocity > 0.1) {
        velocityHtml = `<span class="velocity-arrow widening" title="z-score widening (+${velocity.toFixed(2)}σ over ~3h)">▲ ${velocity.toFixed(1)}σ</span>`;
      } else {
        velocityHtml = `<span class="velocity-arrow flat" title="z-score flat over ~3h">→</span>`;
      }
    }

    return `
      <div class="reversion-row">
        <div class="reversion-row-top">
          <span class="reversion-name">${escapeHtml(name)}</span>
          ${velocityHtml}
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

  // v3.1 — weak-match threshold: similarity stored as 0-100 in the analog
  // object. Values below 35 are flagged as directional-only.
  const simNum = typeof display.similarity === 'number'
    ? display.similarity
    : parseFloat(display.similarity) || 0;
  const isWeakMatch = simNum < 35;
  card.classList.toggle('weak-match', isWeakMatch);
  const weakBanner = isWeakMatch
    ? `<div class="weak-match-banner">Weak match (${simNum}%) — treat as directional only, not a statistical fade setup.</div>`
    : '';

  card.innerHTML = `
    ${weakBanner}
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

  // v3.1 — frequency annotation: count events of matching severity type vs decade span
  const score = d.lastFearTemp?.score;
  const regime = deriveRegime(score);
  const regimeTypes = regime.key === 'extreme' ? ['CRISIS', 'GEO']
                    : regime.key === 'fear'    ? ['CRISIS', 'GEO', 'MAC']
                    : regime.key === 'caution' ? ['MAC', 'POLICY']
                    : [];
  let frequencyLine = '';
  if (regimeTypes.length > 0) {
    const matching = events.filter(e => regimeTypes.includes((e.type || '').toUpperCase())).length;
    const decades = Math.max(1, Math.round(range / 10));
    const perDecade = matching / decades;
    if (matching > 0) {
      const display = perDecade >= 1
        ? `~${Math.round(perDecade)}× per decade`
        : `~1× every ${Math.round(1 / perDecade)} decades`;
      frequencyLine = `<div class="timeline-freq">${regime.label} regime historically occurs ${display}</div>`;
    }
  }

  card.innerHTML = `
    <div class="timeline-bar">
      ${dotsHtml}
      <div class="tl-now" style="left:${nowPct}%"></div>
    </div>
    <div class="tl-labels"><span>1991</span><span>2000</span><span>2010</span><span>2020</span><span>NOW</span></div>
    ${frequencyLine}
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
