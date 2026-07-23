// ============================================================
// BRAIN 4 — Risk Peak
// Identifies when projected liability exceeds projected balance.
// Pure calculation logic. No UI. No Firebase.
// ============================================================

// Given one pot's projection (from flyForward.js), returns the
// earliest event where the pot is at risk of being underfunded even
// in the best case (shortfallHigh > 0 — i.e. balance is insufficient
// against the LOW end of the cost range too, or at least the high end).
// A pot can have multiple at-risk events across the horizon; this
// returns all of them, in chronological order.
//
// Returns: [{ code, label, date, dateWindow, shortfallLow, shortfallHigh, severity }]
//   severity: 'high'   — shortfallLow > 0 (underfunded even at best case)
//             'medium' — shortfallHigh > 0 but shortfallLow <= 0 (underfunded only if cost runs high)
function findRiskPeaks(potProjection) {
  return potProjection.events
    .filter(e => e.shortfallHigh > 0)
    .map(e => ({
      code: potProjection.code,
      label: potProjection.label,
      date: e.date,
      dateWindow: e.dateWindow,
      shortfallLow: e.shortfallLow,
      shortfallHigh: e.shortfallHigh,
      severity: e.shortfallLow > 0 ? "high" : "medium"
    }));
}

// Aggregates risk peaks across every pot in a portfolio (single asset,
// multiple pots) and returns them sorted by date — the earliest is the
// portfolio's next Risk Peak.
//
// potProjections: array of projections, one per pot (from flyForward.js)
function findPortfolioRiskPeaks(potProjections) {
  const all = potProjections.flatMap(findRiskPeaks);
  return all.sort((a, b) => a.date - b.date);
}

window.findRiskPeaks = findRiskPeaks;
window.findPortfolioRiskPeaks = findPortfolioRiskPeaks;
