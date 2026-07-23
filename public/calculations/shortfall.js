// ============================================================
// BRAIN 5 — Shortfall
// Quantifies the funding gap per event and aggregates it across a
// pot's full projection and across a portfolio. Pure calculation
// logic. No UI. No Firebase.
// ============================================================

// Shortfall = Projected Cost - (Current Balance + Future Accruals)
// Already computed per-event inside flyForward.js (shortfallLow/High
// on each event), since the balance-at-event already IS "current
// balance + future accruals" up to that date. This file's job is
// aggregation and summarisation, not recomputation.

// Summarises one pot's shortfall exposure across its full projection.
//
// potProjection: from flyForward.js
// Returns: { code, label, totalShortfallLow, totalShortfallHigh, worstEvent, eventCount }
//   totals sum only POSITIVE shortfalls (a well-funded event contributes
//   0, not a negative offset, since surplus in one event doesn't cancel
//   a genuine gap in another for reserve-adequacy purposes).
function summarisePotShortfall(potProjection) {
  let totalLow = 0;
  let totalHigh = 0;
  let worstEvent = null;

  for (const e of potProjection.events) {
    const low = Math.max(0, e.shortfallLow);
    const high = Math.max(0, e.shortfallHigh);
    totalLow += low;
    totalHigh += high;
    if (!worstEvent || high > worstEvent.shortfallHigh) worstEvent = e;
  }

  return {
    code: potProjection.code,
    label: potProjection.label,
    totalShortfallLow: totalLow,
    totalShortfallHigh: totalHigh,
    worstEvent,
    eventCount: potProjection.events.length
  };
}

// Aggregates shortfall exposure across every pot for one asset.
//
// potProjections: array of projections, one per pot
// Returns: { pots: [summarisePotShortfall(...), ...], grandTotalLow, grandTotalHigh }
function summarisePortfolioShortfall(potProjections) {
  const pots = potProjections.map(summarisePotShortfall);
  const grandTotalLow = pots.reduce((s, p) => s + p.totalShortfallLow, 0);
  const grandTotalHigh = pots.reduce((s, p) => s + p.totalShortfallHigh, 0);
  return { pots, grandTotalLow, grandTotalHigh };
}

window.summarisePotShortfall = summarisePotShortfall;
window.summarisePortfolioShortfall = summarisePortfolioShortfall;
