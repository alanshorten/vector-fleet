// routeMatcher.js — Brain 8: Route Suitability Matcher
//
// NOT a new calculation engine — orchestration only, reusing Brains 3/4/5/6
// (projectReservePot, projectEnLpPot, buildMaintenanceCalendar) exactly as
// fleetExposure.js and buildFlyForwardProjection already do.
// Spec: layer3-scenarios-build-handoff.md §4.
//
// "We have this route to fill — which asset is best placed?"
//
// V1 SIMPLIFICATION (deliberate, confirmed with Alan — not a limitation
// baked in stone, just the buildable v1): the route's utilisation profile
// is swapped in for the asset's ENTIRE projection horizon, same flat-swap
// mechanism already proven by the per-asset Scenarios utilisation slider
// (Scenarios.jsx buildScenarioUtilRate). route.startDate/endDate are used
// for eligibility/display context only — NOT to revert the projection back
// to the asset's normal rate partway through. A true window-bounded swap
// (reverting at route.endDate) would need Brain 3/6 to accept a genuinely
// time-varying utilisation profile mid-projection, which they don't today.
// Flagged as a v2 candidate if the flat-swap approximation proves too
// crude in practice — e.g. short wet-leases where reversion matters most.
// Do not build v2 without a fresh design pass; this comment is the record
// of why v1 is shaped the way it is, not an invitation to quietly extend it.
//
// Pure. No UI, no Firebase, no window references except the module-export
// footer — matching fleetExposure.js's contract exactly, so this can run
// in-browser (window.* brains wired by the Body layer) or in Node (tests)
// with zero rework.

function monthsBetween(a, b) {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

// Signed whole-month delta, base -> route. Positive = route pushes the
// event LATER (favourable — less near-term disruption). Negative = event
// comes EARLIER under the route (a real disruption to flag).
function monthDelta(fromDate, toDate) {
  return (toDate.getFullYear() - fromDate.getFullYear()) * 12 + (toDate.getMonth() - fromDate.getMonth());
}

// ---------------------------------------------------------------------
// Per-asset, per-profile projection run. Mirrors fleetExposure.js's
// buildAssetAtoms pass1/Brain6/pass2 sequence exactly, minus the
// post-lease-end extension (not needed here — Route Matcher only compares
// events inside the current lease term, the same horizon both runs share).
// ---------------------------------------------------------------------

function runProjection(entry, utilisation, brains) {
  const {
    lease,
    pots = [],
    engines = [],
    checks = [],
    scheduledEvents = [],
    seasonalityProfile = null,
    costProjections = []
  } = entry;

  const leaseStart = new Date();
  const leaseEnd = new Date(lease.leaseEnd);
  const horizonMonths = Math.max(1, monthsBetween(leaseStart, leaseEnd));
  const baseCtx = { leaseStart, horizonMonths, utilisation };

  const confirmedPots = pots.filter(p => p && p.triggerBasis && p.status !== "outstanding");
  const eligiblePots = confirmedPots.filter(pot => {
    if (pot.triggerBasis !== "llp_cycles") return true;
    const eng = engines.find(e => e.position === pot.enginePosition);
    return eng && eng.llps && eng.llps.length;
  });

  // PASS 1 — ungrounded. Sources real derived dates for LG-OH/AP-OH/EN-PR/
  // EN-LP; Brain 6 reads these rather than recalculating (same division as
  // fleetExposure.js/buildFlyForwardProjection — Brain 6 owns AF-6Y/AF-12Y
  // grounding itself from asset.checks).
  const pass1 = eligiblePots.map(pot => {
    if (pot.triggerBasis === "llp_cycles") {
      const eng = engines.find(e => e.position === pot.enginePosition);
      return brains.projectEnLpPot(pot, { ...baseCtx, llpEngineStart: { llps: eng.llps, currentFC: eng.currentFC } });
    }
    return brains.projectReservePot(pot, baseCtx);
  });

  const nonGroundingEvents = pass1
    .filter(p => p.code !== "AF-6Y" && p.code !== "AF-12Y")
    .flatMap(p => {
      const sourcePot = eligiblePots.find(pp => pp.code === p.code);
      return (p.events || []).map((evt, idx) => ({
        code: p.code,
        label: p.label,
        dueCycle: idx + 1,
        date: evt.date,
        enginePosition: sourcePot ? sourcePot.enginePosition : null
      }));
    });

  const maintenanceCal = brains.buildMaintenanceCalendar({
    leaseStart,
    horizonMonths,
    checks,
    nonGroundingEvents,
    overrides: scheduledEvents,
    seasonalityProfile,
    costProjections
  });

  // PASS 2 — grounded. Same pots, plus Brain 6's availability vector.
  const groundedCtx = { ...baseCtx, groundingAvailability: maintenanceCal.groundingAvailability };
  const pass2 = eligiblePots.map(pot => {
    if (pot.triggerBasis === "llp_cycles") {
      const eng = engines.find(e => e.position === pot.enginePosition);
      return brains.projectEnLpPot(pot, { ...groundedCtx, llpEngineStart: { llps: eng.llps, currentFC: eng.currentFC } });
    }
    return brains.projectReservePot(pot, groundedCtx);
  });

  // Per-pot summary: earliest in-horizon event date + worst (HIGH-case)
  // shortfall. Route Matcher compares timing and cost at the pot level,
  // not the full monthly series — that's what Scenarios (per-asset) is for.
  const potSummaries = pass2.map(proj => {
    const events = (proj.events || []).filter(e => e.monthIndex <= horizonMonths);
    if (!events.length) {
      return { code: proj.code, label: proj.label, earliestDate: null, worstShortfallHigh: null };
    }
    return {
      code: proj.code,
      label: proj.label,
      earliestDate: events[0].date,
      worstShortfallHigh: Math.max(...events.map(e => e.shortfallHigh))
    };
  });

  const totalShortfallHigh = potSummaries.reduce((s, p) => s + Math.max(0, p.worstShortfallHigh || 0), 0);

  return { potSummaries, totalShortfallHigh, horizonMonths };
}

// ---------------------------------------------------------------------
// Per-asset comparison — current profile vs. route profile. Exclusion
// codes deliberately match fleetExposure.js's (NO_LEASE, POTS_OUTSTANDING,
// STALE_UTILISATION, COMPUTE_ERROR) — same data-completeness philosophy:
// surface the gap, never silently skip or zero-fill it.
// ---------------------------------------------------------------------

function compareAsset(entry, route, brains) {
  const { assetId, msn, lease, pots = [], utilisation } = entry;

  if (!lease || !lease.leaseEnd) {
    return { assetId, msn, excluded: { code: "NO_LEASE", message: "No active lease on this asset." } };
  }
  const confirmedPots = (pots || []).filter(p => p && p.triggerBasis && p.status !== "outstanding");
  if (!confirmedPots.length) {
    return { assetId, msn, excluded: { code: "POTS_OUTSTANDING", message: "No confirmed reserve pots — pots are still outstanding from setup." } };
  }
  if (!utilisation || (!utilisation.fhPerMonth && !utilisation.fcPerMonth && !utilisation.apuHrPerMonth)) {
    return { assetId, msn, excluded: { code: "STALE_UTILISATION", message: "Insufficient or stale utilisation history for a reliable projection." } };
  }

  try {
    const baseRun = runProjection(entry, utilisation, brains);
    const routeUtilisation = {
      fhPerMonth: route.fhPerMonth,
      fcPerMonth: route.fcPerMonth,
      apuHrPerMonth: utilisation.apuHrPerMonth || 0
    };
    const routeRun = runProjection(entry, routeUtilisation, brains);

    const potDeltas = baseRun.potSummaries.map(baseP => {
      const routeP = routeRun.potSummaries.find(p => p.code === baseP.code) || { earliestDate: null, worstShortfallHigh: null };
      const shiftMonths = (baseP.earliestDate && routeP.earliestDate) ? monthDelta(baseP.earliestDate, routeP.earliestDate) : null;
      return {
        code: baseP.code,
        label: baseP.label,
        baseDate: baseP.earliestDate,
        routeDate: routeP.earliestDate,
        shiftMonths,
        baseShortfallHigh: baseP.worstShortfallHigh,
        routeShortfallHigh: routeP.worstShortfallHigh
      };
    });

    // Disruption = total months an event is pulled EARLIER under the
    // route, summed across pots. 0 = no pot moves earlier = best fit.
    // Events pushed later contribute 0, not a negative offset — a check
    // moving later on one pot doesn't "cancel out" another moving earlier.
    const disruptionMonths = potDeltas.reduce((s, p) => s + (p.shiftMonths != null ? Math.max(0, -p.shiftMonths) : 0), 0);
    const financialDeltaHigh = routeRun.totalShortfallHigh - baseRun.totalShortfallHigh;

    return {
      assetId,
      msn,
      excluded: null,
      baseTotalShortfallHigh: baseRun.totalShortfallHigh,
      routeTotalShortfallHigh: routeRun.totalShortfallHigh,
      financialDeltaHigh,
      disruptionMonths,
      potDeltas
    };
  } catch (e) {
    return { assetId, msn, excluded: { code: "COMPUTE_ERROR", message: e.message || String(e) } };
  }
}

// ---------------------------------------------------------------------
// Main entry point.
// ---------------------------------------------------------------------
//
// input: {
//   assets: [ same entry shape fleetExposure.js consumes — asset already
//             carrying anchored pots, utilisation, checks, engines, etc.,
//             as assembled by flyForwardHelpers.js's
//             buildFleetExposureEntry/loadFleetExposureBundle ],
//   route: { fhPerMonth, fcPerMonth, startDate, endDate },
//   brains: { projectReservePot, projectEnLpPot, buildMaintenanceCalendar }
// }
//
// output: { ranked: [...best fit first...], excludedAssets: [...], route }

function matchRouteToFleet(input) {
  const { assets = [], route, brains } = input;
  if (!brains || !brains.projectReservePot || !brains.projectEnLpPot || !brains.buildMaintenanceCalendar) {
    throw new Error("matchRouteToFleet: brains.{projectReservePot,projectEnLpPot,buildMaintenanceCalendar} are required");
  }
  if (!route || !route.fhPerMonth || !route.fcPerMonth || !route.startDate || !route.endDate) {
    throw new Error("matchRouteToFleet: route.{fhPerMonth,fcPerMonth,startDate,endDate} are required");
  }

  const results = assets.map(entry => {
    try {
      return compareAsset(entry, route, brains);
    } catch (e) {
      return { assetId: entry && entry.assetId, msn: entry && entry.msn, excluded: { code: "COMPUTE_ERROR", message: e.message || String(e) } };
    }
  });

  // Ranked by operational fit first (fewest/smallest earlier-pulled
  // events), financial delta as tie-break — the best operational fit and
  // the cheapest option may not be the same asset (handoff §4); both
  // figures travel with every row so the user sees both, not one
  // collapsed score.
  const ranked = results
    .filter(r => !r.excluded)
    .sort((a, b) => a.disruptionMonths - b.disruptionMonths || a.financialDeltaHigh - b.financialDeltaHigh);

  const excludedAssets = results
    .filter(r => r.excluded)
    .map(r => ({ assetId: r.assetId, msn: r.msn, reason: r.excluded.code, message: r.excluded.message }));

  return { ranked, excludedAssets, route };
}

if (typeof window !== "undefined") {
  window.matchRouteToFleet = matchRouteToFleet;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { matchRouteToFleet, compareAsset, runProjection, monthDelta, monthsBetween };
}
