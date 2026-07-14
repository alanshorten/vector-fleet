// fleetExposure.js — Fleet Exposure View: assembly + aggregation
//
// NOT a new Brain. Every atom here comes from Brain 3 (flyForward.js) via
// its own funded/unfunded event objects; Brain 6 (maintenanceCal.js) supplies
// grounding-aware dates the same way it already does for Fly-Forward. This
// file's job is orchestration (re-run, independent of index.html's
// buildFlyForwardProjection — see build-session design note, Option B) and
// fleet-level aggregation: headline, time-axis (month buckets across
// assets), and asset-axis (ranked by exposure).
//
// Pure. No UI, no Firebase, no window references. The Brain functions this
// file calls (projectReservePot, projectEnLpPot, buildMaintenanceCalendar)
// are passed in as `brains`, not read off `window` — this is what lets the
// exact same module run in a browser (index.html wires window.* functions
// in) or in Node (tests / a future server-side caller require() them
// directly) with zero rework, per fleet-exposure-build-handoff.md.
//
// Spec: fleet-exposure-build-handoff.md (Opus scoping session, July 2026).
// Consumes Brain 6's output exactly as Fly-Forward does — see
// VECTORIQ_ROADMAP.md Section 5, TECH_DEBT.md 4.38-4.44.
//
// KNOWN DUPLICATION (flag for TECH_DEBT.md, not fixed here): the pass-1/
// Brain-6/pass-2 orchestration below is a second copy of index.html's
// buildFlyForwardProjection(), by design (Option B — this module must be
// independently callable, e.g. by a future server-side snapshot writer).
// The two copies read the same Brain functions and should never diverge
// in intent; a future portability session (fleet-exposure-build-handoff.md
// §6) is the right place to consolidate them once buildFlyForwardProjection
// itself is moved out of index.html.
//
// Assembly note: pot ANCHORING (asset.checks / landingGear / EN-PR dates ->
// pot.firstEventOverrideDate) is NOT this module's job — it's thin,
// mechanical date-field mapping, done by the caller before pots reach here
// (same division of labour as utilRate already being pre-computed by the
// caller today). This module receives already-anchored pots.

// ---------------------------------------------------------------------
// Local date helpers — self-contained, no window.* lookups.
// ---------------------------------------------------------------------

function addMonths(date, n) {
  const d = new Date(date.getTime());
  d.setMonth(d.getMonth() + n);
  return d;
}

function monthsBetween(a, b) {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

function monthKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

// ---------------------------------------------------------------------
// Status rule — "hope for the best, assume the worst" (handoff §2).
// Tested against HIGH, not likely. Never computed for post-lease-end
// events (handoff §3) — those are cost-disclosure only.
// ---------------------------------------------------------------------

function classify(shortfallLow, shortfallHigh) {
  if (shortfallHigh <= 0) return "green";   // covers HIGH — the only safe state
  if (shortfallLow <= 0) return "amber";    // covers LOW but not HIGH
  return "red";                              // doesn't cover even LOW
}

// ---------------------------------------------------------------------
// Per-asset orchestration — mirrors index.html's buildFlyForwardProjection
// (pass1 ungrounded -> Brain 6 -> pass2 grounded), extended past lease end
// by `horizonPastLeaseEndMonths` so post-lease events can be disclosed
// (date + cost band only, no verdict — handoff §3). In-lease-horizon
// events are entirely unaffected by the extension: per-month accrual math
// only depends on elapsed months, not on the total horizon passed in, so
// stretching the loop out doesn't change anything before lease end.
// ---------------------------------------------------------------------

function buildAssetAtoms(entry, horizonPastLeaseEndMonths, brains) {
  const {
    assetId, msn,
    lease,
    pots = [],
    engines = [],
    checks = [],
    utilisation,
    scheduledEvents = [],
    seasonalityProfile = null,
    costProjections = []
  } = entry;

  if (!lease || !lease.leaseEnd) {
    return { assetId, msn, excluded: { code: "NO_LEASE", message: "No active lease on this asset." } };
  }

  const confirmedPots = pots.filter(p => p && p.triggerBasis && p.status !== "outstanding");
  if (!confirmedPots.length) {
    return { assetId, msn, excluded: { code: "POTS_OUTSTANDING", message: "No confirmed reserve pots — pots are still outstanding from setup." } };
  }

  if (!utilisation || (!utilisation.fhPerMonth && !utilisation.fcPerMonth && !utilisation.apuHrPerMonth)) {
    return { assetId, msn, excluded: { code: "STALE_UTILISATION", message: "Insufficient or stale utilisation history for a reliable projection." } };
  }

  try {
    const leaseStart = new Date();
    const leaseEnd = new Date(lease.leaseEnd);
    if (isNaN(leaseEnd.getTime())) {
      throw new Error(`Invalid lease.leaseEnd value: "${lease.leaseEnd}"`);
    }
    const leaseHorizonMonths = Math.max(1, monthsBetween(leaseStart, leaseEnd));
    const extendedHorizonMonths = leaseHorizonMonths + Math.max(0, horizonPastLeaseEndMonths);

    const baseCtx = { leaseStart, horizonMonths: extendedHorizonMonths, utilisation };

    const eligiblePots = confirmedPots.filter(pot => {
      if (pot.triggerBasis !== "llp_cycles") return true;
      const eng = engines.find(e => e.position === pot.enginePosition);
      return eng && eng.llps && eng.llps.length;
    });

    // PASS 1 — ungrounded. Sources real derived dates for LG-OH/AP-OH/
    // EN-PR/EN-LP; Brain 6 reads these rather than recalculating (same
    // division as index.html — Brain 6 owns AF-6Y/AF-12Y itself from
    // asset.checks).
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
      horizonMonths: extendedHorizonMonths,
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

    // Build atoms: one per fired event, across every pot. Events whose
    // monthIndex falls beyond the ORIGINAL lease horizon are post-lease —
    // date + cost band only, status null (handoff §3: never red/green
    // against a flatlined-in-spirit balance).
    const atoms = [];
    for (const proj of pass2) {
      (proj.events || []).forEach((evt, idx) => {
        const postLeaseEnd = evt.monthIndex > leaseHorizonMonths;
        atoms.push({
          assetId,
          msn,
          code: proj.code,
          label: proj.label,
          dueCycle: idx + 1,
          date: evt.date,
          costLow: evt.costLow,
          costLikely: evt.costLikely,
          costHigh: evt.costHigh,
          projectedBalanceAtDate: postLeaseEnd ? null : evt.balanceAtEvent,
          shortfallLow: postLeaseEnd ? null : evt.shortfallLow,
          shortfallHigh: postLeaseEnd ? null : evt.shortfallHigh,
          status: postLeaseEnd ? null : classify(evt.shortfallLow, evt.shortfallHigh),
          postLeaseEnd
        });
      });
    }

    return { assetId, msn, excluded: null, atoms, leaseHorizonMonths, leaseEnd };
  } catch (e) {
    return { assetId, msn, excluded: { code: "COMPUTE_ERROR", message: e.message || String(e) } };
  }
}

// ---------------------------------------------------------------------
// Headline — never zero-fill missing data, never refuse to total
// (handoff §5). Figure quoted is the HIGH-case gap, summed across every
// in-lease-horizon atom (post-lease atoms don't have a shortfall figure
// by design and are excluded from this sum, not zero-filled into it).
// ---------------------------------------------------------------------

function buildHeadline(perAssetResults, atoms) {
  const totalAssets = perAssetResults.length;
  const excluded = perAssetResults.filter(a => a.excluded);
  const included = perAssetResults.filter(a => !a.excluded);

  const totalHighCaseGap = atoms
    .filter(a => !a.postLeaseEnd)
    .reduce((sum, a) => sum + Math.max(0, a.shortfallHigh), 0);

  const statusCounts = { green: 0, amber: 0, red: 0 };
  const worstStatusByAsset = {};
  for (const a of atoms) {
    if (a.postLeaseEnd || !a.status) continue;
    const rank = { green: 0, amber: 1, red: 2 };
    const current = worstStatusByAsset[a.assetId];
    if (!current || rank[a.status] > rank[current]) worstStatusByAsset[a.assetId] = a.status;
  }
  Object.values(worstStatusByAsset).forEach(s => { statusCounts[s]++; });
  // Assets with confirmed atoms but no at-risk events at all are green by
  // default (every event covers HIGH) — count them explicitly rather than
  // letting them fall through uncounted.
  for (const a of included) {
    if (!worstStatusByAsset[a.assetId] && a.atoms.some(x => !x.postLeaseEnd)) {
      statusCounts.green++;
    }
  }

  return {
    totalHighCaseGap,
    totalAssets,
    assetsComputed: included.length,
    excludedCount: excluded.length,
    statusCounts,
    excludedAssets: excluded.map(a => ({ assetId: a.assetId, msn: a.msn, reason: a.excluded.code, message: a.excluded.message }))
  };
}

// ---------------------------------------------------------------------
// Time axis — months across, atoms stacked per month, cost + coverage
// totals underneath (handoff §4). Post-lease atoms still appear (cost
// disclosure) but contribute nothing to the coverage total, since they
// have no projectedBalanceAtDate by design.
// ---------------------------------------------------------------------

function buildTimeAxis(atoms) {
  const buckets = new Map();
  for (const a of atoms) {
    const key = monthKey(a.date);
    if (!buckets.has(key)) {
      buckets.set(key, { monthKey: key, costHigh: 0, costLow: 0, coverage: 0, shortfallHigh: 0, atoms: [] });
    }
    const b = buckets.get(key);
    b.atoms.push(a);
    b.costHigh += a.costHigh || 0;
    b.costLow += a.costLow || 0;
    if (!a.postLeaseEnd) {
      b.coverage += a.projectedBalanceAtDate || 0;
      b.shortfallHigh += Math.max(0, a.shortfallHigh || 0);
    }
  }
  return Array.from(buckets.values()).sort((x, y) => (x.monthKey < y.monthKey ? -1 : 1));
}

// ---------------------------------------------------------------------
// Asset axis — ranked by exposure, worst first (handoff §4). Ranks by
// total high-case gap (in-lease atoms only), tie-broken by worst status.
// ---------------------------------------------------------------------

function buildAssetAxis(perAssetResults) {
  const rank = { red: 2, amber: 1, green: 0 };
  return perAssetResults
    .filter(a => !a.excluded)
    .map(a => {
      const inLease = a.atoms.filter(x => !x.postLeaseEnd);
      const totalShortfallHigh = inLease.reduce((s, x) => s + Math.max(0, x.shortfallHigh || 0), 0);
      const worstStatus = inLease.reduce((worst, x) => (rank[x.status] > rank[worst] ? x.status : worst), "green");
      return { assetId: a.assetId, msn: a.msn, totalShortfallHigh, worstStatus, atomCount: a.atoms.length };
    })
    .sort((x, y) => y.totalShortfallHigh - x.totalShortfallHigh);
}

// ---------------------------------------------------------------------
// Main entry point.
// ---------------------------------------------------------------------
//
// input: {
//   assets: [{
//     assetId, msn,
//     lease: { leaseEnd, ... } | null,
//     pots: [ reservePot, ... ]           — already anchored (firstEventOverrideDate set where applicable)
//     engines: asset.engines[]            — for EN-LP ctx.llpEngineStart lookups
//     checks: asset.checks[]              — Brain 6 input
//     utilisation: { fhPerMonth, fcPerMonth, apuHrPerMonth } | null
//     scheduledEvents, seasonalityProfile, costProjections   — Brain 6 inputs, optional
//   }, ...],
//   horizonPastLeaseEndMonths: number, default 24 (handoff §3 — app-level constant)
//   brains: { projectReservePot, projectEnLpPot, buildMaintenanceCalendar }
// }
//
// output: { headline, timeAxis, assetAxis, atoms, excludedAssets, perAsset }

function buildFleetExposure(input) {
  const { assets = [], horizonPastLeaseEndMonths = 24, brains } = input;
  if (!brains || !brains.projectReservePot || !brains.projectEnLpPot || !brains.buildMaintenanceCalendar) {
    throw new Error("buildFleetExposure: brains.{projectReservePot,projectEnLpPot,buildMaintenanceCalendar} are required");
  }

  const perAsset = assets.map(entry => {
    // Per-asset try/catch is already inside buildAssetAtoms (COMPUTE_ERROR
    // case) — wrapped again here defensively so a truly unexpected throw
    // (e.g. malformed entry itself) still can't take the whole fleet down.
    try {
      return buildAssetAtoms(entry, horizonPastLeaseEndMonths, brains);
    } catch (e) {
      return { assetId: entry && entry.assetId, msn: entry && entry.msn, excluded: { code: "COMPUTE_ERROR", message: e.message || String(e) } };
    }
  });

  const atoms = perAsset.filter(a => !a.excluded).flatMap(a => a.atoms);

  return {
    headline: buildHeadline(perAsset, atoms),
    timeAxis: buildTimeAxis(atoms),
    assetAxis: buildAssetAxis(perAsset),
    atoms,
    excludedAssets: perAsset.filter(a => a.excluded).map(a => ({ assetId: a.assetId, msn: a.msn, reason: a.excluded.code, message: a.excluded.message })),
    perAsset
  };
}

if (typeof window !== "undefined") {
  window.buildFleetExposure = buildFleetExposure;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { buildFleetExposure, classify, monthKey, monthsBetween, addMonths };
}
