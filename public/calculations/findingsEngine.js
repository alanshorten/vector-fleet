// ============================================================
// BRAIN 10 — Fleet Findings Trigger Engine
// Pure calculation logic. No UI. No Firebase. No side effects.
// (Brain 9 stays reserved for the parked AI-narrative concept —
// see reporting-notifications-handoff.md / TECH_DEBT.md — this is
// Brain 10 so the two are never confused in future docs.)
//
// Scoped in claude_ui-p2-build-handoff.md Item 1 ("Fleet Findings
// Workflow"). This file is Session A's core deliverable: given the
// asset's already-computed financial position (shortfall bands per
// pot from Brain 5, near-term events from Brain 6, EOL position from
// Brain 7) plus its baseline state and its currently-open findings,
// it returns the list of actions the caller should perform against
// the `findings` Firestore collection. This module never touches a
// database itself — src/lib/db.js's syncAssetFindings() is the caller
// that executes these actions, matching the Brain/Body separation
// used by every other file in this folder.
//
// ---- Band definition (NOT invented here — reused from the already-
// locked fleet-exposure-build-handoff.md §2 "hope for the best, assume
// the worst" rule, applied per-pot instead of per-event):
//   Green  — projected balance covers the HIGH cost estimate
//   Amber  — covers LOW but not HIGH
//   Red    — doesn't cover even LOW
// This is exactly the rule already driving FFPotCard's "⚠ Potential
// shortfall" badge in FlyForward.jsx, just expressed as three bands
// instead of a single boolean, so a finding's band always agrees with
// what the Financials tab already shows for that pot.
//
// ---- Baseline suppression (claude_ui-p2-build-handoff.md, "Critical
// design constraint"): the first time this engine runs for an asset,
// nothing is created — the current bands become the baseline every
// later run is compared against. The spec's baseline example only
// covers per-pot bands (Category 1); this file extends the same
// suppression to the lease-end-proximity check (Category 3) for the
// same reason — a newly onboarded asset that's already within 12
// months of lease end with a redelivery shortfall shouldn't fire a
// finding on day one either. That extension is an interpretation
// call, not something the spec stated explicitly — flagged in the
// delivery note for Alan to confirm.
// ============================================================

const FINDING_TYPES = {
  SHORTFALL_TRANSITION: "shortfall_transition",
  UNFUNDED_EVENT: "unfunded_event",
  LEASE_END_PROXIMITY: "lease_end_proximity"
};

const BAND_ORDER = { green: 0, amber: 1, red: 2 };

// Same window/global shim pattern as endOfLeasePosition.js, so this file
// can be required and unit-tested directly under plain Node (no browser,
// no Firebase) without every Brain file needing its own bespoke shim.
const _global = typeof window !== "undefined" ? window : (typeof global !== "undefined" ? global : {});

// rawLow/rawHigh: shortfallLow/shortfallHigh as already computed by
// flyForward.js (Brain 3) on a projection event — cost minus balance,
// positive = funding gap. Not yet sign-flipped for display (that only
// happens in the UI, per TECH_DEBT.md 4.127) — this function works on
// the raw calculation-layer figures.
function computeShortfallBand(rawLow, rawHigh) {
  const low = Math.max(0, rawLow || 0);
  const high = Math.max(0, rawHigh || 0);
  if (high <= 0) return "green";
  if (low <= 0) return "amber";
  return "red";
}

// pots: summarisePortfolioShortfall(potProjections).pots from shortfall.js
// (Brain 5) — each already carries `worstEvent` (the event with the
// highest shortfallHigh across that pot's in-lease projection, or null
// if the pot has no projected events at all).
function computePotBands(pots) {
  return (pots || []).map(p => {
    const low = p.worstEvent ? p.worstEvent.shortfallLow : 0;
    const high = p.worstEvent ? p.worstEvent.shortfallHigh : 0;
    return {
      code: p.code,
      label: p.label,
      band: computeShortfallBand(low, high),
      shortfallLow: Math.max(0, low),
      shortfallHigh: Math.max(0, high)
    };
  });
}

// Shared transition rule used by both Category 1 (per-pot band) and
// Category 3 (binary lease-end-proximity state, modelled as green/red).
// activeFinding is the most recent non-resolved finding for this
// pot/asset (status one of new/action_required/monitoring/accepted), or
// null if none is open. An accepted finding is compared against the
// band it was accepted AT (bandAtAcceptance), per the resurface rule —
// everything else compares against the band it was CREATED at.
function transitionAction({ currentBand, activeFinding, baselineBand, type, pot, description, shortfall }) {
  const referenceBand = activeFinding
    ? (activeFinding.status === "accepted" ? (activeFinding.bandAtAcceptance || activeFinding.bandAtCreation) : activeFinding.bandAtCreation)
    : (baselineBand || "green");

  // 20 Aug 2026 live-test fix — an accepted finding needs a bit more than a
  // flat current-vs-accepted-band comparison. Without tracking whether it
  // ever genuinely improved since acceptance, "accepted at red -> improved
  // to green -> back to red" was indistinguishable from "sat at red the
  // whole time" — both just see currentBand === referenceBand and do
  // nothing. That silently swallowed a real recovery-then-relapse cycle
  // (reported live: "I accepted this position, moved the pot to green,
  // then back to red — surely this is a new finding?" — yes, it should be).
  // `improvedSinceAcceptance` on the finding doc is the memory that makes
  // the two cases distinguishable; `markImproved` is a silent bookkeeping
  // action (no visible status change) that sets it the first time an
  // accepted finding's band gets better than what was accepted.
  if (activeFinding && activeFinding.status === "accepted") {
    if (BAND_ORDER[currentBand] < BAND_ORDER[referenceBand]) {
      if (!activeFinding.improvedSinceAcceptance) {
        return { action: "markImproved", findingId: activeFinding.id };
      }
      return null; // already recorded as improved, nothing new to track
    }
    if (currentBand === referenceBand) {
      if (activeFinding.improvedSinceAcceptance) {
        // Recovered, then relapsed back to exactly the accepted band —
        // a real event worth surfacing again, not silence.
        return {
          action: "resurface",
          findingId: activeFinding.id,
          note: `${description} (returned to the accepted ${referenceBand} position after improving)`
        };
      }
      return null; // never left the accepted band — genuinely unchanged
    }
    // Deteriorated beyond the accepted band.
    return {
      action: "resurface",
      findingId: activeFinding.id,
      note: `${description} (was accepted at ${referenceBand})`
    };
  }

  if (currentBand === referenceBand) return null;

  if (BAND_ORDER[currentBand] > BAND_ORDER[referenceBand]) {
    // Deteriorated — a fresh New finding, even if one is already open for
    // this pot/asset (spec: "even if an amber finding already exists —
    // this is a further transition").
    return {
      action: "create",
      type,
      pot: pot || null,
      description,
      bandAtCreation: currentBand,
      shortfallLow: shortfall ? shortfall.low : null,
      shortfallHigh: shortfall ? shortfall.high : null
    };
  }

  // Improved.
  if (activeFinding) {
    return { action: "resolve", findingId: activeFinding.id, reason: description };
  }
  return null; // improved while accepted — stays accepted, no action
}

// Category 1 — reserve shortfall transition, one check per pot.
function evaluateShortfallTransitions({ potBands, baselineBands, activeFindingByPot }) {
  const actions = [];
  for (const pot of potBands) {
    const action = transitionAction({
      currentBand: pot.band,
      activeFinding: activeFindingByPot[pot.code] || null,
      baselineBand: baselineBands ? baselineBands[pot.code] : "green",
      type: FINDING_TYPES.SHORTFALL_TRANSITION,
      pot: pot.code,
      description: `${pot.label} moved to ${pot.band}`,
      shortfall: { low: pot.shortfallLow, high: pot.shortfallHigh }
    });
    if (action) actions.push(action);
  }
  return actions;
}

// Category 2 — near-term unfunded event: a Brain 6 event due within 12
// months whose pot is currently amber/red. Modelled per discrete event
// (keyed on pot code + event date) rather than as a continuous band,
// since the thing that changes is which events are in the window, not
// a single ongoing state — so "a new near-term event enters the
// window" naturally produces its own fresh `create` the first time it's
// seen, without needing separate resurface handling.
function evaluateUnfundedEvents({ potBands, maintenanceEvents, today, openFindingsByEventKey }) {
  const actions = [];
  const potByCode = Object.fromEntries(potBands.map(p => [p.code, p]));
  const horizon = new Date(today);
  horizon.setMonth(horizon.getMonth() + 12);

  const stillNearTermKeys = new Set();
  for (const evt of maintenanceEvents || []) {
    const pot = potByCode[evt.code];
    if (!pot || pot.band === "green") continue;
    if (!evt.date || evt.date > horizon) continue;
    // 20 Aug 2026 live-test fix: this eventDate value is the dedup key
    // below AND (bug) used to be the only thing missing from the actual
    // created finding — db.js's createFinding never had an eventDate field
    // to persist, so this same event was never recognised as "already
    // flagged" on any later run. Every reopen of the Financials tab
    // re-created it from scratch, regardless of whether the existing one
    // was open or already accepted — reported live as "every time I reopen
    // the asset financials it still creates as new... even though I
    // accepted this." Now carried through into the action object so
    // db.js/createFinding can store it on source.eventDate, which is what
    // openFindingsByEventKey (built from f.source.eventDate) actually keys on.
    const eventDate = evt.date.toISOString().slice(0, 10);
    const key = `${evt.code}:${eventDate}`;
    stillNearTermKeys.add(key);
    if (openFindingsByEventKey[key]) continue; // already flagged, nothing new
    actions.push({
      action: "create",
      type: FINDING_TYPES.UNFUNDED_EVENT,
      pot: evt.code,
      eventType: evt.label || evt.code,
      eventDate,
      description: `${evt.label || evt.code} due ${eventDate} — ${pot.label} pot in ${pot.band}`,
      bandAtCreation: pot.band,
      shortfallLow: pot.shortfallLow,
      shortfallHigh: pot.shortfallHigh
    });
  }

  // Resolve any open unfunded_event finding whose triggering event has
  // either left the 12-month window or whose pot has since gone green.
  for (const key in openFindingsByEventKey) {
    if (stillNearTermKeys.has(key)) continue;
    const f = openFindingsByEventKey[key];
    if (f.status === "accepted") continue; // accepted stays put, per Category 1's same rule
    actions.push({ action: "resolve", findingId: f.id, reason: "Event no longer near-term, or pot no longer in shortfall" });
  }
  return actions;
}

// Category 3 — lease-end proximity: within 12 months of lease end AND a
// material net shortfall projected at redelivery (Brain 7). Modelled as
// a binary green/red state through the same transitionAction() helper
// used for Category 1, so accepted findings get the identical
// worse-than-acceptance resurface behaviour.
//
// "Material" is currently any netPayableByLessee > 0 — no dollar
// threshold was specified in the P2 handoff. Flagged as an assumption
// worth Alan's confirmation, not invented silently: see delivery note.
function evaluateLeaseEndProximity({ leaseEndDate, eolPosition, today, activeFinding }) {
  if (!leaseEndDate || !eolPosition || eolPosition.uncomputable) return [];
  const horizon = new Date(today);
  horizon.setMonth(horizon.getMonth() + 12);
  const withinWindow = leaseEndDate <= horizon;
  const material = (eolPosition.netPayableByLessee || 0) > 0;
  const currentBand = (withinWindow && material) ? "red" : "green";

  const action = transitionAction({
    currentBand,
    activeFinding,
    baselineBand: "green",
    type: FINDING_TYPES.LEASE_END_PROXIMITY,
    pot: null,
    description: `Lease ends ${leaseEndDate.toISOString().slice(0, 10)} — projected net shortfall of $${Math.round(eolPosition.netPayableByLessee || 0).toLocaleString()} at redelivery`,
    shortfall: { low: eolPosition.netPayableByLessee, high: eolPosition.netPayableByLessee }
  });
  return action ? [action] : [];
}

// ---- Top-level entry point ------------------------------------------
//
// input:
//   baselineSet: boolean — asset.findingsBaselineSet
//   baselineBands: { [potCode]: "green"|"amber"|"red" } | null — asset.findingsBaseline.bands
//   baselineLeaseEndBand: "green"|"red" | null — asset.findingsBaseline.leaseEndBand
//   potProjections: raw per-pot projections (flyForward.js output), the
//     same array FFPotCard/summarisePortfolioShortfall already consume
//   maintenanceEvents: buildMaintenanceCalendar(...).events (Brain 6)
//   leaseEndDate: Date | null
//   eolPosition: buildEndOfLeasePosition(...).money (Brain 7), or null
//   today: Date
//   openFindings: this asset's findings where status != "resolved"
//     (i.e. new/action_required/monitoring/accepted), read from Firestore
//
// Returns: { setBaseline: {...} | null, findingActions: [...] }
//   setBaseline is non-null only on an asset's very first run; the
//   caller should write it to the asset doc and perform NO finding
//   actions that same run (findingActions is always [] alongside it).
function evaluateAssetFindings(input) {
  const {
    baselineSet,
    baselineBands,
    baselineLeaseEndBand,
    potProjections,
    maintenanceEvents,
    leaseEndDate,
    eolPosition,
    today,
    openFindings
  } = input;

  if (!_global.summarisePortfolioShortfall) throw new Error("shortfall.js (Brain 5) not loaded");
  const pots = _global.summarisePortfolioShortfall(potProjections || []).pots;
  const potBands = computePotBands(pots);

  if (!baselineSet) {
    const bands = {};
    for (const p of potBands) bands[p.code] = p.band;
    const withinWindow = leaseEndDate ? leaseEndDate <= (() => { const h = new Date(today); h.setMonth(h.getMonth() + 12); return h; })() : false;
    const material = eolPosition && !eolPosition.uncomputable && (eolPosition.netPayableByLessee || 0) > 0;
    return {
      setBaseline: { bands, leaseEndBand: (withinWindow && material) ? "red" : "green" },
      findingActions: []
    };
  }

  const activeFindingByPot = {};
  const openFindingsByEventKey = {};
  let leaseEndActiveFinding = null;
  for (const f of openFindings || []) {
    if (f.type === FINDING_TYPES.SHORTFALL_TRANSITION && f.source?.pot) {
      const existing = activeFindingByPot[f.source.pot];
      if (!existing || (f.createdAt || 0) > (existing.createdAt || 0)) activeFindingByPot[f.source.pot] = f;
    } else if (f.type === FINDING_TYPES.UNFUNDED_EVENT && f.source?.pot && f.source?.eventDate) {
      openFindingsByEventKey[`${f.source.pot}:${f.source.eventDate}`] = f;
    } else if (f.type === FINDING_TYPES.LEASE_END_PROXIMITY) {
      if (!leaseEndActiveFinding || (f.createdAt || 0) > (leaseEndActiveFinding.createdAt || 0)) leaseEndActiveFinding = f;
    }
  }

  const findingActions = [
    ...evaluateShortfallTransitions({ potBands, baselineBands, activeFindingByPot }),
    ...evaluateUnfundedEvents({ potBands, maintenanceEvents, today, openFindingsByEventKey }),
    ...evaluateLeaseEndProximity({ leaseEndDate, eolPosition, today, activeFinding: leaseEndActiveFinding })
  ];

  return { setBaseline: null, findingActions };
}

if (typeof window !== "undefined") {
  window.computeShortfallBand = computeShortfallBand;
  window.computePotBands = computePotBands;
  window.evaluateAssetFindings = evaluateAssetFindings;
  window.FINDING_TYPES = FINDING_TYPES;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { FINDING_TYPES, computeShortfallBand, computePotBands, evaluateAssetFindings, transitionAction };
}