// Dislocation Radar India — Historical Analog Matcher
// Compares current spread state to historical event database using cosine similarity

let historicalEvents = null;

async function loadHistoricalEvents() {
  if (historicalEvents) return historicalEvents;

  try {
    const url = chrome.runtime.getURL('data/historical-events.json');
    const response = await fetch(url);
    const data = await response.json();
    historicalEvents = data.events;
    console.log('[DR] Historical events loaded:', historicalEvents.length);
    return historicalEvents;
  } catch (err) {
    console.error('[DR] Failed to load historical events:', err);
    return [];
  }
}

// All spread keys we track
const SPREAD_KEYS = [
  'nifty_basis', 'banknifty_basis', 'mcx_gold_comex', 'mcx_silver_comex',
  'mcx_crude_brent', 'usdinr_basis', 'banknifty_nifty_ratio',
  'india_vix', 'infy_adr_spread', 'icici_adr_spread',
  'nifty_it_nasdaq_ratio', 'nifty_psu_pvt_bank_ratio', 'nifty_pharma_nifty_ratio',
  'nifty500_nifty50_ratio', 'gold_silver_ratio', 'india_us_10y_spread',
  'nifty_pcr', 'fii_net_flow', 'ois_repo_spread'
];

// Build a z-score vector from current spreads
function buildZScoreVector(spreads) {
  return SPREAD_KEYS.map(key => {
    const s = spreads[key];
    return s?.absZscore || 0;
  });
}

// Build a z-score vector from a historical event
function buildHistoricalVector(event) {
  return SPREAD_KEYS.map(key => {
    const s = event.spreads?.[key];
    return s?.peak_zscore || 0;
  });
}

// Cosine similarity between two vectors
function cosineSimilarity(a, b) {
  let dotProduct = 0, magA = 0, magB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }

  magA = Math.sqrt(magA);
  magB = Math.sqrt(magB);

  if (magA === 0 || magB === 0) return 0;
  return dotProduct / (magA * magB);
}

// Weighted similarity — weight by which spreads are currently dislocated
function weightedSimilarity(currentVector, historicalVector) {
  // Give more weight to spreads that are actually dislocated right now
  const weights = currentVector.map(z => Math.max(0.1, z)); // min weight 0.1

  let dotProduct = 0, magA = 0, magB = 0;

  for (let i = 0; i < currentVector.length; i++) {
    const w = weights[i];
    dotProduct += w * currentVector[i] * historicalVector[i];
    magA += w * currentVector[i] * currentVector[i];
    magB += w * historicalVector[i] * historicalVector[i];
  }

  magA = Math.sqrt(magA);
  magB = Math.sqrt(magB);

  if (magA === 0 || magB === 0) return 0;
  return dotProduct / (magA * magB);
}

// Event type matching bonus
function typeBonus(eventType, activeEventTypes) {
  if (!activeEventTypes || activeEventTypes.length === 0) return 0;
  return activeEventTypes.includes(eventType) ? 0.15 : 0;
}

// Find the best historical analog for current market state
export async function findBestAnalog(currentSpreads, activeEvents = []) {
  const events = await loadHistoricalEvents();
  if (!events || events.length === 0) return null;

  const currentVector = buildZScoreVector(currentSpreads);
  const currentMagnitude = Math.sqrt(currentVector.reduce((s, v) => s + v * v, 0));

  // If no significant dislocation, don't match
  if (currentMagnitude < 1.5) return null;

  const activeTypes = activeEvents.map(e => e.type);

  const scored = events.map(event => {
    const historicalVector = buildHistoricalVector(event);
    const cosine = cosineSimilarity(currentVector, historicalVector);
    const weighted = weightedSimilarity(currentVector, historicalVector);
    const bonus = typeBonus(event.type, activeTypes);

    // Combined score: 60% weighted similarity + 30% cosine + 10% type bonus
    const score = 0.6 * weighted + 0.3 * cosine + bonus;

    return {
      ...event,
      similarity: parseFloat((score * 100).toFixed(1)),
      cosine_similarity: parseFloat(cosine.toFixed(3)),
      weighted_similarity: parseFloat(weighted.toFixed(3)),
      type_matched: activeTypes.includes(event.type)
    };
  });

  // Sort by score descending
  scored.sort((a, b) => b.similarity - a.similarity);

  const best = scored[0];
  if (!best || best.similarity < 10) return null;

  // Build reversion estimates from best match
  const reversionEstimates = {};
  for (const [key, spreadData] of Object.entries(best.spreads || {})) {
    const current = currentSpreads[key];
    if (!current) continue;

    reversionEstimates[key] = {
      historical_peak: spreadData.peak,
      historical_peak_zscore: spreadData.peak_zscore,
      reversion_days: spreadData.reversion_days,
      direction: spreadData.direction,
      current_value: current.value,
      current_zscore: current.absZscore
    };
  }

  // Aggregate fade stats from top matches
  const fadeStats = computeFadeStats(scored.slice(0, 5), currentSpreads);

  return {
    event: best.event,
    event_id: best.id,
    type: best.type,
    date: best.date,
    similarity: best.similarity,
    nifty_drawdown: best.nifty_drawdown,
    nifty_recovery_days: best.nifty_recovery_days,
    fade_win_rate: best.fade_win_rate,
    data_limited: best.data_limited || false,
    notes: best.notes,
    spreads: best.spreads,
    reversion_estimates: reversionEstimates,
    fade_stats: fadeStats,
    runner_up: scored[1] ? {
      event: scored[1].event,
      similarity: scored[1].similarity,
      type: scored[1].type
    } : null
  };
}

// Compute aggregate fade statistics from top matching events
function computeFadeStats(topEvents, currentSpreads) {
  const stats = {};

  for (const key of SPREAD_KEYS) {
    const current = currentSpreads[key];
    if (!current || (current.absZscore || 0) < 2.0) continue;

    const eventData = [];
    for (const event of topEvents) {
      const spread = event.spreads?.[key];
      if (!spread) continue;
      eventData.push({
        peak: spread.peak,
        reversion_days: spread.reversion_days,
        direction: spread.direction,
        fade_win_rate: event.fade_win_rate
      });
    }

    if (eventData.length === 0) continue;

    const avgReversionDays = eventData.reduce((s, d) => s + d.reversion_days, 0) / eventData.length;
    const avgWinRate = eventData.reduce((s, d) => s + d.fade_win_rate, 0) / eventData.length;

    stats[key] = {
      sample_size: eventData.length,
      avg_reversion_days: parseFloat(avgReversionDays.toFixed(1)),
      avg_fade_win_rate: parseFloat(avgWinRate.toFixed(1)),
      dominant_direction: eventData[0].direction
    };
  }

  return stats;
}

// Get a summary string for a historical match
export function getAnalogSummary(analog) {
  if (!analog) return 'No significant dislocation pattern detected.';

  let summary = `Closest match: ${analog.event} (${analog.date}) — ${analog.similarity}% similarity`;

  if (analog.nifty_drawdown) {
    summary += `\nNifty fell ${Math.abs(analog.nifty_drawdown)}%, recovered in ${analog.nifty_recovery_days} days`;
  }

  if (analog.fade_win_rate) {
    summary += `\nHistorical fade win rate: ${analog.fade_win_rate}%`;
  }

  return summary;
}
