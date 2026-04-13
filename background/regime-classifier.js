// Dislocation Radar India — Regime Classifier
// Classifies market into PANIC-REVERT, STRUCTURAL-SHIFT, or NOISE

// ─── Regime Classification ──────────────────────────────────────────────────

export async function classifyRegime(currentSpreads, fiiStats) {
  const history = await getRecentHistory();

  const vix = currentSpreads?.india_vix?.value || 14;
  const vix5dChange = calcPctChange(history.vix, vix);
  const nifty5dReturn = calcPctChange(history.nifty, currentSpreads?.nifty_basis?.spot || 0);
  const crude5dChange = calcPctChange(history.crude, currentSpreads?.mcx_crude_brent?.mcx || 0);
  const usdinr5dChange = calcPctChange(history.usdinr, currentSpreads?.usdinr_basis?.spot || 83.5);
  const fii3dFlow = fiiStats?.cumulative_3d || 0;
  const fiiZScore = fiiStats?.zscore || 0;
  const fiiConsecutiveSellDays = fiiStats?.consecutive_sell_days || 0;

  const conditions = {
    vixAbove20: vix > 20,
    vixAbove25: vix > 25,
    vixSpike30pct: vix5dChange > 30,
    niftyDown2pct: nifty5dReturn < -2,
    fiiNetSellers: fii3dFlow < 0,
    crudeRising8pct: crude5dChange > 8,
    usdinrRising1_5pct: usdinr5dChange > 1.5,
    fiiSelling2sigma5days: fiiZScore < -2 && fiiConsecutiveSellDays >= 5
  };

  // PANIC-REVERT: VIX>20, spiked 30%+, Nifty down 2%+, FII sellers
  const panicRevertMet = [
    conditions.vixAbove20,
    conditions.vixSpike30pct,
    conditions.niftyDown2pct,
    conditions.fiiNetSellers
  ];
  const panicRevertCount = panicRevertMet.filter(Boolean).length;

  // STRUCTURAL-SHIFT: VIX>25, crude +8%, USDINR +1.5%, FII selling >2σ for 5+ days
  const structuralMet = [
    conditions.vixAbove25,
    conditions.crudeRising8pct,
    conditions.usdinrRising1_5pct,
    conditions.fiiSelling2sigma5days
  ];
  const structuralCount = structuralMet.filter(Boolean).length;

  let regime, label, color, action;
  let flipCondition;

  if (structuralCount === 4) {
    regime = 'STRUCTURAL-SHIFT';
    label = 'DO NOT FADE';
    color = '#da3633';
    action = 'red';
    flipCondition = 'VIX drops below 25 OR crude reverses OR FII buying resumes';
  } else if (panicRevertCount === 4) {
    regime = 'PANIC-REVERT';
    label = 'FADE SETUP';
    color = '#3fb950';
    action = 'green';
    // What would flip it to structural
    if (!conditions.crudeRising8pct) {
      flipCondition = 'Crude rising 8%+ in 5 days would shift to STRUCTURAL';
    } else if (!conditions.fiiSelling2sigma5days) {
      flipCondition = 'FII selling >2σ for 5+ consecutive days would shift to STRUCTURAL';
    } else {
      flipCondition = 'VIX above 25 with sustained crude/FII pressure would shift to STRUCTURAL';
    }
  } else {
    regime = 'NOISE';
    label = null;
    color = null;
    action = 'none';

    // What single condition would trigger panic-revert
    const missing = [];
    if (!conditions.vixAbove20) missing.push('VIX crossing 20');
    if (!conditions.vixSpike30pct) missing.push('VIX spiking 30%+ in 5 days');
    if (!conditions.niftyDown2pct) missing.push('Nifty falling 2%+ in 5 days');
    if (!conditions.fiiNetSellers) missing.push('FII turning net sellers (3d)');
    flipCondition = missing.length > 0 ? `${missing[0]} would trigger PANIC-REVERT` : 'No active triggers';
  }

  return {
    regime,
    label,
    color,
    action,
    flipCondition,
    conditions,
    metrics: {
      vix,
      vix5dChange: parseFloat(vix5dChange.toFixed(1)),
      nifty5dReturn: parseFloat(nifty5dReturn.toFixed(2)),
      crude5dChange: parseFloat(crude5dChange.toFixed(1)),
      usdinr5dChange: parseFloat(usdinr5dChange.toFixed(2)),
      fii3dFlow: Math.round(fii3dFlow),
      fiiConsecutiveSellDays
    },
    panicRevertScore: `${panicRevertCount}/4`,
    structuralScore: `${structuralCount}/4`,
    timestamp: Date.now()
  };
}

// ─── Cross-Market Confirmation (Upgrade 7) ──────────────────────────────────

// v3.1: each check now carries threshold context so the popup can render
// weighted scoring, near-miss indicators, and trigger-rule tooltips.
const CONFIRMATION_WEIGHTS = {
  'VIX Spike': 1.5,
  'Gold Premium': 1.2,
  'Crude Premium': 1.0,
  'USDINR Wide': 1.2,
  'FII Selling': 1.2,
  'ADR Discount': 1.0
};

export function calculateConfirmation(currentSpreads, fiiStats) {
  const vixZ = currentSpreads?.india_vix?.absZscore || 0;
  const goldZ = currentSpreads?.mcx_gold_comex?.absZscore || 0;
  const crudeZ = currentSpreads?.mcx_crude_brent?.absZscore || 0;
  const usdinrZ = currentSpreads?.usdinr_basis?.absZscore || 0;
  const fiiZ = fiiStats?.zscore || 0;
  const infyZ = currentSpreads?.infy_adr_spread?.absZscore || 0;
  const iciciZ = currentSpreads?.icici_adr_spread?.absZscore || 0;
  const adrMaxZ = Math.max(infyZ, iciciZ);

  const mk = (name, currentValue, threshold, confirmed, triggerRule, unit = 'σ') => {
    // progress is abs(value)/threshold, capped at 1 for the display (pills above 1.0 = confirmed)
    const progressPct = threshold !== 0
      ? Math.min(Math.abs(currentValue) / Math.abs(threshold), 1.5)
      : 0;
    return {
      name,
      confirmed,
      currentValue: parseFloat(currentValue.toFixed(2)),
      threshold,
      progressPct: parseFloat(progressPct.toFixed(2)),
      triggerRule,
      unit
    };
  };

  const checks = [
    mk('VIX Spike', vixZ, 1.5, vixZ >= 1.5, 'India VIX |z| ≥ 1.5σ'),
    mk('Gold Premium', goldZ, 1.5, goldZ >= 1.5, 'MCX gold vs COMEX |z| ≥ 1.5σ'),
    mk('Crude Premium', crudeZ, 1.5, crudeZ >= 1.5, 'MCX crude vs Brent |z| ≥ 1.5σ'),
    mk('USDINR Wide', usdinrZ, 1.5, usdinrZ >= 1.5, 'USDINR basis |z| ≥ 1.5σ'),
    mk('FII Selling', fiiZ, -1.5, fiiZ < -1.5, 'FII net flow z-score ≤ -1.5σ'),
    mk('ADR Discount', adrMaxZ, 1.5, adrMaxZ >= 1.5, 'max(INFY, ICICI) ADR spread |z| ≥ 1.5σ')
  ];

  const confirmedCount = checks.filter(c => c.confirmed).length;
  const total = checks.length;

  // Weighted score: sum of weights of confirmed checks
  let weightedScore = 0;
  let maxWeighted = 0;
  for (const c of checks) {
    const w = CONFIRMATION_WEIGHTS[c.name] || 1.0;
    maxWeighted += w;
    if (c.confirmed) weightedScore += w;
  }
  weightedScore = parseFloat(weightedScore.toFixed(1));
  maxWeighted = parseFloat(maxWeighted.toFixed(1));

  return {
    score: confirmedCount,
    total,
    weightedScore,
    maxWeighted,
    checks,
    signal: confirmedCount >= 4 ? 'FADE' : confirmedCount >= 2 ? 'WATCH' : 'NONE',
    label: confirmedCount >= 4 ? 'FADE SETUP' : confirmedCount >= 2 ? 'WATCH' : null,
    color: confirmedCount >= 4 ? '#3fb950' : confirmedCount >= 2 ? '#d29922' : null
  };
}

// ─── Reversion Countdown (Upgrade 8) ────────────────────────────────────────

export async function updateReversionCountdown(currentSpreads, analog) {
  const { reversionCountdowns = {} } = await chrome.storage.local.get('reversionCountdowns');
  const now = Date.now();

  // Check each spread for fade signal
  for (const [key, spread] of Object.entries(currentSpreads || {})) {
    const z = spread.absZscore || 0;

    if (z >= 2.5 && !reversionCountdowns[key]) {
      // New fade signal triggered
      const analogSpread = analog?.spreads?.[key];
      reversionCountdowns[key] = {
        triggerTime: now,
        triggerZscore: z,
        avgReversionDays: analogSpread?.reversion_days || 5,
        spreadLabel: spread.label || key
      };
    } else if (z < 1.5 && reversionCountdowns[key]) {
      // Signal cleared — spread reverted
      delete reversionCountdowns[key];
    }
  }

  // Calculate current status for each active countdown
  const active = {};
  for (const [key, cd] of Object.entries(reversionCountdowns)) {
    const daysPassed = (now - cd.triggerTime) / (24 * 60 * 60 * 1000);
    const progress = Math.min(daysPassed / cd.avgReversionDays, 2.0); // cap at 200%
    const overdue = daysPassed > cd.avgReversionDays;

    active[key] = {
      ...cd,
      daysPassed: parseFloat(daysPassed.toFixed(1)),
      progress: parseFloat(progress.toFixed(2)),
      overdue,
      status: overdue ? 'OVERDUE' : 'ACTIVE',
      display: overdue
        ? `OVERDUE — Day ${daysPassed.toFixed(1)} of avg ${cd.avgReversionDays}-day window. Consider if this is structural.`
        : `Day ${daysPassed.toFixed(1)} of avg ${cd.avgReversionDays}-day reversion window`
    };
  }

  await chrome.storage.local.set({ reversionCountdowns });
  return active;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function getRecentHistory() {
  const { spreadHistory = {} } = await chrome.storage.local.get('spreadHistory');
  const fiveDaysAgo = Date.now() - 5 * 24 * 60 * 60 * 1000;

  function getOldestInWindow(key) {
    const points = (spreadHistory[key] || []).filter(p => p.ts > fiveDaysAgo);
    return points.length > 0 ? points[0].value : null;
  }

  return {
    vix: getValueFromHistory(spreadHistory, 'india_vix', fiveDaysAgo),
    nifty: getValueFromHistory(spreadHistory, 'nifty_basis', fiveDaysAgo, 'spot'),
    crude: getValueFromHistory(spreadHistory, 'mcx_crude_brent', fiveDaysAgo, 'mcx'),
    usdinr: getValueFromHistory(spreadHistory, 'usdinr_basis', fiveDaysAgo, 'spot')
  };
}

function getValueFromHistory(history, key, since, subField) {
  const points = (history[key] || []).filter(p => p.ts > since);
  if (points.length === 0) return null;
  return points[0].value;
}

function calcPctChange(oldVal, newVal) {
  if (!oldVal || oldVal === 0) return 0;
  return ((newVal - oldVal) / Math.abs(oldVal)) * 100;
}
