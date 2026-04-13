# Dislocation Radar India

A Chrome Extension that monitors 19 Indian market spreads in real-time, detects statistical dislocations using VIX-regime-aware z-scores, matches them against 20 historical analogs, and synthesizes a single "Fear Temperature" to help discretionary equity traders identify mean-reversion (fade) opportunities.

## Why This Exists

Most retail traders in India rely on gut feel or lagging indicators when markets gap down on geopolitical shocks or macro surprises. Meanwhile, the statistical structure of these moves is remarkably consistent: a VIX spike above 25 paired with FII selling and gold premium widening has reverted within 5-10 trading days in 70-90% of historical cases.

Dislocation Radar automates that pattern recognition. It pulls live spread data from Yahoo Finance and NSE, normalizes each spread into a z-score against the correct VIX-regime baseline, checks for cross-market confirmation, finds the closest historical analog, and tells you how long similar setups took to revert -- all rendered in a popup that fits in 420 pixels.

## Architecture

```
Chrome Extension (Manifest V3)
|
|-- background/service-worker.js    # Main orchestrator (ES module)
|   |-- analog-matcher.js           # Cosine-similarity historical matching
|   |-- fii-radar.js                # FII/DII flow tracking + z-scores
|   |-- news-detector.js            # Google News RSS scanning + velocity
|   |-- regime-classifier.js        # PANIC-REVERT / STRUCTURAL-SHIFT / confirmation
|   |-- ripple-analyzer.js          # Global event impact analysis
|
|-- popup/                          # Main dashboard (420px popup)
|   |-- popup.html
|   |-- popup.css                   # Light-first design, CSS-variable dark mode
|   |-- popup.js                    # All render functions, client-side only
|
|-- content/                        # Injected floating widget
|   |-- widget.js                   # Shadow DOM widget on Kite/TradingView/MoneyControl
|   |-- widget.css
|
|-- options/                        # Settings page
|   |-- options.html
|   |-- options.js
|
|-- data/                           # Bundled reference datasets
|   |-- baselines.json              # 504-day rolling stats, 3 VIX regimes
|   |-- historical-events.json      # 20 events (1998-2025) with per-spread peaks
|   |-- contagion-paths.json        # 12 transmission chain maps
|
|-- icons/                          # Extension icons (16/48/128px)
|-- manifest.json
```

## Data Flow

```
 Yahoo Finance   NSE API   Google News RSS   Exchange Rate API
      |              |           |                  |
      v              v           v                  v
 [service-worker.js] ---- fetches every 30-120s (configurable) ----
      |
      |-- Calculates 19 spread values + VIX-regime z-scores
      |-- calculateFearTemperature()  -->  composite 0-100 score
      |-- classifyRegime()            -->  PANIC-REVERT / STRUCTURAL / NOISE
      |-- calculateConfirmation()     -->  6 cross-market checks (weighted)
      |-- findBestAnalog()            -->  cosine similarity vs 20 events
      |-- updateReversionCountdown()  -->  per-spread days-to-revert tracker
      |-- detectNews()                -->  headline classification + velocity
      |-- analyzeGlobalRipple()       -->  global event -> India impact mapping
      |-- getFIIStats()               -->  90-day FII flow z-score
      |
      v
 chrome.storage.local   ------------>   popup.js (reads on open)
      |                                 widget.js (listens for SPREAD_UPDATE)
      v
 chrome.notifications (optional alerts)
```

## The 19 Spreads

| Spread | What it measures | Unit |
|--------|-----------------|------|
| Nifty Basis | Futures premium/discount to spot | pts |
| BankNifty Basis | Futures premium/discount to spot | pts |
| MCX Gold - COMEX | Domestic gold premium over international | INR/10g |
| MCX Silver - COMEX | Domestic silver premium | INR/kg |
| MCX Crude - Brent | Domestic crude premium over ICE Brent | INR/bbl |
| USDINR Fut - Spot | Currency futures basis | INR |
| BankNifty / Nifty | Relative performance ratio | ratio |
| India VIX | Implied volatility index (fear gauge) | level |
| INFY NSE - ADR | Infosys domestic vs US listing premium | % |
| ICICI NSE - ADR | ICICI Bank domestic vs US listing premium | % |
| Nifty IT / NASDAQ | Tech sector relative performance | ratio |
| PSU Bank / Pvt Bank | Sector rotation signal | ratio |
| Pharma / Nifty | Defensive sector relative strength | ratio |
| Nifty 500 / Nifty 50 | Market breadth (mid/small vs large) | ratio |
| Gold / Silver | Safe-haven fear gauge | ratio |
| IN-US 10Y Spread | Sovereign yield differential | bps |
| Nifty PCR | Put-call ratio (options sentiment) | ratio |
| FII Net Flow | Foreign institutional investor net activity | z-score |
| OIS - Repo | Rate hike/cut pricing in the swap curve | bps |

Each spread is normalized against **three VIX-regime baselines** stored in `data/baselines.json`:
- **Normal** (VIX < 18): Tight means, small standard deviations
- **Elevated** (VIX 18-25): Wider bands reflecting choppy markets
- **Panic** (VIX > 25): Extreme ranges from historical crisis windows

Z-scores above 2.5 trigger reversion countdowns. Z-scores above 5 are classified as Tier 1 (critical) in the popup.

## Key Analytical Concepts

### Fear Temperature (0-100)

A weighted composite of the 7 most market-moving spreads:

| Input | Weight |
|-------|--------|
| India VIX | 25% |
| BankNifty/Nifty Ratio | 15% |
| MCX Gold-COMEX | 15% |
| FII Net Flow | 15% |
| USDINR Basis | 10% |
| Nifty PCR | 10% |
| MCX Crude-Brent | 10% |

Each input's contribution = `weight * min(|z| / 3, 1) * 100`. The score maps to four regimes:
- **0-25 CALM**: No fade opportunity
- **26-50 CAUTION**: Elevated dislocations, monitor
- **51-75 FEAR**: Fade setups forming
- **76-100 EXTREME**: High-probability fade if confirmed

The popup shows per-input weight breakdown, top driver, and a momentum arrow comparing against the previous session's score.

### Cross-Market Confirmation (6 checks, weighted)

Before acting on a high Fear Temp, the system checks whether multiple independent markets agree:

| Check | Threshold | Weight |
|-------|-----------|--------|
| VIX Spike | \|z\| >= 1.5 | 1.5 |
| Gold Premium | \|z\| >= 1.5 | 1.2 |
| Crude Premium | \|z\| >= 1.5 | 1.0 |
| USDINR Wide | \|z\| >= 1.5 | 1.2 |
| FII Selling | z <= -1.5 | 1.2 |
| ADR Discount | max(INFY,ICICI) \|z\| >= 1.5 | 1.0 |

Signals: **FADE** (4+ confirmed), **WATCH** (2-3), **NONE** (<2). Each pill in the popup shows the current value vs threshold, with near-miss highlighting when progress >= 85%.

### Regime Classification

Two structural regimes beyond noise:
- **PANIC-REVERT** ("Fade Setup"): VIX > 20, VIX spiked 30%+ in 5 days, Nifty down 2%+, FII selling. Action: fade.
- **STRUCTURAL-SHIFT** ("Do Not Fade"): VIX > 25, crude up 8%+, USDINR up 1.5%+, FII selling > 2 sigma for 5+ days. Action: do NOT fade -- this is a regime change, not a mean-reversion setup.

### Historical Analog Matching

The analog matcher computes cosine similarity between the current 19-dimensional z-score vector and each of the 20 historical events in `data/historical-events.json`. It returns:
- **Best match** with similarity percentage
- **Runner-up** (click to swap in popup)
- **Per-spread reversion days** from the matched event
- **Fade statistics** (win rate, avg reversion days, sample size)

Events span 1998-2025: Pokhran nuclear tests, Kargil War, 9/11, 26/11 Mumbai attacks, Taper Tantrum, Demonetisation, COVID crash, Russia-Ukraine, Adani-Hindenburg, and more.

### Reversion Countdown

When a spread's |z-score| exceeds 2.5, the system starts a countdown using that spread's historical average reversion days from the best analog match. Each row shows:
- Days elapsed vs average reversion window
- Progress bar (turns red when overdue)
- Velocity arrow: whether the z-score is reverting (green down-arrow) or widening (red up-arrow) over the past ~3 hours

### Global Ripple Check

Scans Google News for 8 categories of global events (war, sanctions, oil shock, pandemic, trade war, currency crisis, climate, political instability) and maps their transmission into Indian markets using `data/contagion-paths.json`. Shows:
- Severity (LOW / MODERATE / HIGH / CRITICAL) based on how many Indian spreads are already dislocated along the transmission path
- Sector impact (1st / 2nd / 3rd degree connections)
- Transmission chain (e.g., "tariff -> supply chain -> input costs -> margins -> equities")
- Impact lag estimate (e.g., "1-3 sessions")

### News Velocity

Tracks hourly headline counts per event type (GEO, MAC, SUPPLY, CRISIS). When the current rate exceeds 5x the historical average, it surfaces a velocity alert -- research shows peak market fear typically arrives 4-6 hours after peak news velocity.

### FII Radar

Fetches daily FII/DII net flow data from NSE. Computes 90-day z-scores, 3-day cumulative flows, and consecutive buy/sell streaks. Falls back to estimation from ADR spreads + VIX when the NSE API is unavailable.

## Popup Dashboard

The popup renders 12 sections in a single scrollable 420px-wide panel:

1. **Header**: Market status pill (LIVE / NSE CLOSED), settings + refresh buttons
2. **Fear Temperature** (hero card): Score, regime badge, momentum arrow, top-2 sigma spreads, weight breakdown (top driver), historical context
3. **Session Changelog**: Diffs the current state against the first snapshot when the popup was opened -- surfaces fear-temp moves >= 3pts, confirmation adds/clears, spread sigma moves >= 0.8
4. **Market Positioning**: Context-aware sentence combining regime + confirmation strength (strong/building/thin) + active reversion count
5. **Spread Heatmap**: Three tiers based on |z-score|:
   - **Tier 1** (|z| >= 5): 2-column card grid, red left accent, click to expand sparkline
   - **Tier 2** (|z| >= 3): Same layout, amber accent
   - **Tier 3** (|z| < 3): Compact table rows
   - Each card shows semantic group badge (CREDIT-RATES, CROSS-LISTING, SECTORAL, SENTIMENT-FLOW)
   - Section header shows CLUSTERED (3+ dislocations in one group) or ISOLATED
6. **Confirmations**: 6 pills (active = filled, inactive = outlined, near-miss = amber tint). Trigger rule on hover. Summary shows integer count and weighted score.
7. **Global Ripple Check**: Severity badge, transmission chain, impact lag chip, sector connections, watch trigger
8. **Reversion Countdown**: Per-spread rows with progress bar, velocity arrow, overdue warning
9. **Historical Match**: Best analog with similarity %, drawdown, recovery days, fade win rate. Click to swap to runner-up. Dimmed with banner when similarity < 35%.
10. **Event Timeline**: Visual dot-timeline spanning 1991-NOW, color-coded by event type, analog match highlighted with pulse animation, regime frequency footer
11. **Fade Statistics**: Top spread's historical reversion stats with low-sample-size warning
12. **Live News**: Headlines sorted by market relevance (MAC/CRISIS first), 3px color accent by relevance tier, expandable from 5 to 15 items

### Theme

Light-first design system with CSS custom properties. Dark mode toggles via Settings page (`chrome.storage.sync.settings.darkMode`). The popup reads the setting before first paint and listens for live changes.

No gradients, no glow, no glass, no emoji. Color only encodes meaning: red for critical, amber for elevated, green for positive/confirmed, blue for active/informational.

## Floating Widget

Injected as a Shadow DOM element on:
- **kite.zerodha.com** (Zerodha trading terminal)
- **tradingview.com** (TradingView charts)
- **moneycontrol.com** (MoneyControl)

Collapsed state: small pill showing "DR: [fear temp]" with color coding. Expanded state: top-5 dislocated spreads, active event badge, regime banner, ripple summary. Draggable.

## Settings

Accessible via the gear icon in the popup or the Chrome extension options page.

| Setting | Default | Description |
|---------|---------|-------------|
| Refresh interval | 60s | 30s / 60s / 2min |
| Z-score thresholds | 1.5 / 2.0 / 2.5 / 3.0 | Elevated / Warning / Alert / Extreme |
| Spread toggles | All on | Enable/disable individual spreads |
| News Detection | On | Google News RSS scanning |
| Global Ripple Check | On | Global event impact analysis |
| Fear Temperature | On | Composite fear gauge |
| Regime Classifier | On | FADE SETUP / DO NOT FADE banners |
| FII Radar | On | FII/DII flow tracking |
| Sound Alerts | On | Audio on extreme dislocations |
| Floating Widget | On | Shadow DOM widget on trading sites |
| Dark Mode | On | Dark theme for popup and settings |

## Data Sources

| Source | What | Frequency |
|--------|------|-----------|
| Yahoo Finance API | 19 ticker prices (Nifty, BankNifty, Gold, Silver, Crude, VIX, ADRs, sector indices) | Every 30-120s |
| Open Exchange Rate API | USD/INR spot rate | Every 30-120s |
| NSE API | FII/DII daily net flows | Every 60 min |
| Google News RSS | Domestic news (4 keyword groups) | Every 5 min |
| Google News RSS | Global news (8 event types) | Every 30-120s |
| Bundled baselines.json | 504-day rolling statistics across 3 VIX regimes | Static (update manually) |
| Bundled historical-events.json | 20 events with per-spread peak z-scores and reversion timelines | Static |
| Bundled contagion-paths.json | 12 transmission chain maps with 50+ keyword mappings | Static |

No paid API keys required. All sources are free-tier or public RSS.

## Installation

1. Clone or download this repository
2. Open `chrome://extensions` in Chrome
3. Enable "Developer mode" (top-right toggle)
4. Click "Load unpacked" and select the project root directory
5. The extension icon appears in the toolbar -- click to open the popup

The service worker begins fetching data immediately on install. First meaningful render takes ~5 seconds as spreads and news populate.

## Project History

| Version | What changed |
|---------|-------------|
| v1 | Initial prototype: 19 spreads, z-scores, basic popup |
| v2 | Added Fear Temperature, regime classification, analog matching, news velocity, ripple analysis, FII radar, reversion countdowns, floating widget |
| v3 | Full UI redesign: light-first flat design, sigma-tiered spread heatmap, single regime truth from Fear Temp, market-relevance news sort, per-spread reversion windows, dark mode via CSS variables |
| v3.1 | Analytical depth: Fear Temp weight breakdown + momentum arrow, context-aware positioning engine, semantic spread grouping with CLUSTERED/ISOLATED detection, weighted confirmation scoring with near-miss indicators + trigger rule tooltips, transmission chain + impact lag on ripple, reversion velocity arrows, weak-match dimming on historical analog, session changelog, timeline frequency annotation |

## Limitations

- **Baselines are static**: The 504-day rolling statistics in `baselines.json` need periodic manual updates. Z-scores may drift as market structure changes.
- **30-day spread history**: Only 30 days of per-spread time series are stored in `chrome.storage.local`. Percentile rank against 252 trading days (1 year) is not possible without historical seeding.
- **No position tracking**: The extension tells you when to fade, not how much. Position sizing, portfolio heat, and exit signals require a separate workflow.
- **News is keyword-based**: The news detector uses regex classification, not NLP. It can miss nuanced headlines or over-trigger on routine mentions.
- **NSE API fragility**: The FII flow endpoint requires cookie handling and occasionally fails, falling back to estimation from ADR/VIX/USDINR spreads.
- **No WebSocket feeds**: All data is REST-polled. Intraday latency is bounded by the refresh interval (minimum 30s).
- **Single-instrument focus**: Designed for Indian equity index trading (Nifty/BankNifty). Cross-asset or multi-geography trading is out of scope.

## License

Private repository. All rights reserved.
