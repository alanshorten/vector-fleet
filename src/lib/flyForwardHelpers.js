import { db } from './db';
import { getCheckDurationDefaults } from './knowledgeBase';
import { buildPotDefsForActivation, buildPotFromDef } from './pots';

const FF_COLORS = { AF6Y: "#60a5fa", AF12Y: "#a78bfa", LGOH: "#34d399", APOH: "#fbbf24", ENPR1: "#f472b6", ENLP1: "#f87171", ENPR2: "#fb923c", ENLP2: "#e879f9" };

function addMonthsFF(date, n) {
  const d = new Date(date.getTime());
  d.setMonth(d.getMonth() + n);
  return d;
};

function reconstructPot(doc) {
  return {
    code: doc.code,
    label: doc.label,
    potCategory: doc.potCategory,
    enginePosition: doc.enginePosition ?? null,
    accrualBasis: doc.accrualBasis,
    accrualRate: doc.accrualRate,
    accrualRateBaseYear: doc.accrualRateBaseYear,
    escalationPctPerYr: doc.escalationPctPerYr,
    openingBalance: doc.openingBalance || 0,
    triggerBasis: doc.triggerBasis,
    triggerInterval: doc.triggerInterval,
    outflowCostBaseYear: doc.outflowCostBaseYear,
    outflowEscalationPct: doc.outflowEscalationPct,
    projectedCostLow: doc.projectedCostLow,
    projectedCostHigh: doc.projectedCostHigh,
    derateModifier: doc.derateModifier || null,
    harvestThresholdFC: doc.harvestThresholdFC,
    stubBufferPct: doc.stubBufferPct,
    fullStackReplacementCost: doc.fullStackReplacementCost,
    engineFamily: doc.engineFamily,
    anchorMode: doc.anchorMode,
    lastPRDate: doc.lastPRDate
  };
};

function anchorReservePots({ asset, confirmedPots, rate, leaseStart }) {
  const check6Y = (asset.checks || []).find(c => c.name === "6 Year Check");
  const check12Y = (asset.checks || []).find(c => c.name === "12 Year Check");
  const lgLegs = ["nose", "left", "right"].map(k => asset.landingGear?.[k]?.nextDue).filter(Boolean);
  const lgDates = lgLegs.map(window.parseDMYDate).filter(Boolean);
  const lgEarliestDue = lgDates.length ? new Date(Math.min(...lgDates)) : null;

  return confirmedPots.map(pot => {
    if (pot.code === "AF-6Y" && check6Y?.nextDate) {
      const d = window.parseDMYDate(check6Y.nextDate);
      if (d) return { ...pot, firstEventOverrideDate: d };
    }
    if (pot.code === "AF-12Y" && check12Y?.nextDate) {
      const d = window.parseDMYDate(check12Y.nextDate);
      if (d) return { ...pot, firstEventOverrideDate: d };
    }
    if (pot.code === "LG-OH" && lgEarliestDue) {
      return { ...pot, firstEventOverrideDate: lgEarliestDue };
    }
    if (pot.triggerBasis === "engine_fh") {
      const fhPerMonth = rate.fhPerMonth || 0;
      if (fhPerMonth <= 0 || !pot.triggerInterval?.fh) return pot;
      const intervalMonths = pot.triggerInterval.fh / fhPerMonth;
      if (pot.anchorMode === "manual" && pot.lastPRDate) {
        return { ...pot, firstEventOverrideDate: addMonthsFF(new Date(pot.lastPRDate), intervalMonths), anchorInferred: false };
      }
      const escalatedMonthlyRate = window.escalateAnnual(pot.accrualRate || 0, pot.accrualRateBaseYear, leaseStart, pot.escalationPctPerYr) * fhPerMonth;
      const impliedElapsedMonths = escalatedMonthlyRate > 0
        ? Math.min(intervalMonths, Math.max(0, (pot.openingBalance || 0) / escalatedMonthlyRate))
        : 0;
      const remainingMonths = Math.max(0, intervalMonths - impliedElapsedMonths);
      return { ...pot, firstEventOverrideDate: addMonthsFF(leaseStart, remainingMonths), anchorInferred: true };
    }
    return pot;
  });
};

// REVISED (July 2026 — Alan, following the fleet-exposure-redesign-
// handoff.md rollout): was 24. A fixed 24-month post-lease window was
// structurally the same bug already found and fixed for the Calendar tab
// (see fleetExposure.js's DEFAULT_CALENDAR_HORIZON_MONTHS = 180 and its
// comment) — a pot whose next occurrence happens to fall further out
// than the window (e.g. a 12-Year Check, or an Engine LLP with a long
// remaining life) would silently never be computed at all, not merely
// filtered out. That's a genuine gap in the atom set, not just in the
// headline sum. "Shortfall to next event, however far out" (the
// redesign's own stated principle) requires the horizon itself to reach
// far enough to find that event — 180 months matches the Calendar tab's
// own fix and comfortably covers a full cycle of every fixed-pot
// interval with margin. Atom generation is truncated to each pot's FIRST
// post-lease occurrence only (see fleetExposure.js's buildAssetAtoms) —
// extending the horizon does NOT mean summing every recurrence of a
// short-interval pot for the next 15 years, only guaranteeing the next
// one is never missed.
const FLEET_EXPOSURE_HORIZON_MONTHS = 180;

// Scenarios structured controls (scenarios-structured-controls-handoff.md,
// July 2026 — supersedes the chat-box design in layer3-scenarios-build-
// handoff.md §2/§5). Two independent axes, matching flyForward.js's own
// monthlyAccrual split:
//   - AOG window -> groundingAvailability (usage freezes, calendar pots
//     keep ticking — "aircraft not flying")
//   - Lessee default window -> accrualAvailability (ALL pots suspend
//     accrual, usage keeps ticking — "lessee not paying")
// Both are [{monthIndex, availability}] vectors, 0..horizonMonths inclusive,
// same shape Brain 6 already produces for groundingAvailability.
function buildWindowAvailabilityVector(horizonMonths, windowSpec) {
  const vector = [];
  for (let m = 0; m <= horizonMonths; m++) vector.push({ monthIndex: m, availability: 1 });
  if (!windowSpec || !windowSpec.durationMonths) return vector;
  const start = Math.max(0, windowSpec.startMonth || 0);
  const end = start + windowSpec.durationMonths;
  for (let m = start; m < end && m <= horizonMonths; m++) vector[m].availability = 0;
  return vector;
}

// Combines two availability vectors via Math.min per month — same
// "longest/most-grounded wins, no stacking" rule Brain 6 already applies
// to overlapping C-Checks (maintenanceCal.js's mergeGroundingWindows) and
// fleetExposure.js's applyPandemicGrounding already applies at fleet
// scale. A month grounded by either cause is grounded; the two never
// compound into extra downtime.
function combineAvailability(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a.map((entry, i) => ({ monthIndex: entry.monthIndex, availability: Math.min(entry.availability, b[i] ? b[i].availability : 1) }));
}

function reconstructPotWithStatus(doc) {
  return { ...reconstructPot(doc), status: doc.status };
};

async function loadFleetExposureBundle(asset) {
  // Confirmed bug (Alan, July 2026 — TECH_DEBT.md 4.85 follow-up): this
  // used to short-circuit entirely for any asset without an active lease,
  // returning empty utilisation/reserves/etc. without ever querying
  // Firestore — even when real utilisation reports and confirmed pots
  // existed for that asset. That was fine for Fleet Exposure (genuinely
  // can't compute a financial gap without a lease) but wrong for the
  // Calendar tab and clash detection, which need this data regardless of
  // lease status. Only the lease document itself is conditionally
  // fetched now, since there's no ID to fetch it by without one — every
  // other query always runs.
  const [util, leaseData, reserves, schedEvts, seasonProfile, shopVisits] = await Promise.all([
    db.getUtilisation(asset.id).catch(() => []),
    asset.currentLeaseId ? db.getLease(asset.currentLeaseId).catch(() => null) : Promise.resolve(null),
    db.getReservePots(asset.id).catch(() => []),
    db.getScheduledEvents(asset.id).catch(() => []),
    db.getSeasonalityProfile(asset.id).catch(() => null),
    db.getShopVisitProjections(asset.id).catch(() => [])
  ]);
  const utilRate = window.computeRealUtilisationRate(util);
  const apuHrPerMonth = window.estimateApuHrPerMonth(utilRate?.fhPerMonth, asset.apu?.currentFH, asset.airframe?.currentFH) || 0;
  return { asset, lease: leaseData, reserveDocs: reserves, utilRate, apuHrPerMonth, scheduledEvents: schedEvts, seasonalityProfile: seasonProfile, costProjections: shopVisits };
};

function buildFleetExposureEntry({ asset, lease, reserveDocs, utilRate, apuHrPerMonth, scheduledEvents, seasonalityProfile, costProjections }) {
  const confirmedPots = (reserveDocs || []).map(reconstructPotWithStatus).filter(p => !!p.triggerBasis);
  const rate = utilRate || { fhPerMonth: 0, fcPerMonth: 0 };
  // Anchoring only needs rate/checks/asset/leaseStart(=today) — never the
  // lease object itself (see anchorReservePots) — so this no longer gates
  // on `lease` being truthy. Fleet Exposure's own NO_LEASE exclusion
  // (buildAssetAtoms) still runs downstream and is unaffected: an
  // excluded asset's anchored pots are simply never read.
  const pots = anchorReservePots({ asset, confirmedPots, rate, leaseStart: new Date() });

  return {
    assetId: asset.id,
    msn: asset.msn,
    lease,
    pots,
    engines: asset.engines || [],
    checks: asset.checks || [],
    utilisation: utilRate ? { fhPerMonth: utilRate.fhPerMonth, fcPerMonth: utilRate.fcPerMonth, apuHrPerMonth } : null,
    scheduledEvents: scheduledEvents || [],
    seasonalityProfile: seasonalityProfile || null,
    costProjections: costProjections || []
  };
};

// Fleet-level structured controls (scenarios-structured-controls-
// handoff.md §2) — four new controls alongside the existing pandemic
// slider and Route Matcher. All optional, all default to no-op, fully
// backward compatible with the existing pandemicGroundingMonths-only
// callers (PandemicScenarioView, FleetExposureView's plain reload).
//
// fleetScenarioModifiers: {
//   lesseeId?: string, lesseeDefaultMonths?: number
//     — suspends accrual (not usage) on every asset currently leased to
//       lesseeId, for lesseeDefaultMonths from today. Matches on
//       entry.lease.lessee, the same field Scenarios.jsx already reads.
//   fleetUtilPct?: number
//     — applies the same utilisation % change to every asset (positive
//       or negative), same shape as the asset-level utilisation slider.
//   engineCostShock?: { engineFamily: string, pct: number }
//     — multiplies projectedCostLow/High on every EN-PR/EN-LP pot whose
//       engineFamily matches, across the whole fleet (AD impact, parts
//       scarcity, MRO capacity squeeze).
//   extendedMaintenanceDuration?: { checkType: string, extraMonths: number }
//     — adds extraMonths (converted to weeks) to durationDefaults for the
//       selected check type, for this call only (MRO backlog / parts
//       delays scenario). checkType keys match durationDefaults' own
//       ("2Y"/"6Y"/"12Y") — see maintenanceCal.js's buildMaintenanceCalendar.
// }
async function buildFleetExposureData(assets, pandemicGroundingMonths = 0, fleetScenarioModifiers = {}) {
  const { lesseeId, lesseeDefaultMonths, fleetUtilPct, engineCostShock, extendedMaintenanceDuration } = fleetScenarioModifiers || {};

  const bundles = await Promise.all(assets.map(loadFleetExposureBundle));
  let entries = bundles.map(buildFleetExposureEntry);

  // Lessee default — tag only the matching entries; buildAssetAtoms reads
  // entry.lesseeDefaultMonths per-asset (see fleetExposure.js).
  if (lesseeId && lesseeDefaultMonths > 0) {
    entries = entries.map(e => (e.lease && e.lease.lessee === lesseeId) ? { ...e, lesseeDefaultMonths } : e);
  }

  // Fleet-wide utilisation change — every asset, same % change.
  if (fleetUtilPct) {
    const mult = 1 + fleetUtilPct / 100;
    entries = entries.map(e => e.utilisation ? {
      ...e,
      utilisation: {
        fhPerMonth: Math.max(0, (e.utilisation.fhPerMonth || 0) * mult),
        fcPerMonth: Math.max(0, (e.utilisation.fcPerMonth || 0) * mult),
        apuHrPerMonth: Math.max(0, (e.utilisation.apuHrPerMonth || 0) * mult)
      }
    } : e);
  }

  // Engine-type cost shock — multiplies matching EN-PR/EN-LP pots' cost
  // fields across the fleet, wherever that engine family appears.
  //
  // Bugs found July 2026:
  // (1) EN-PR pots' top-level engineFamily was never set by pots.js
  //     (only nested in catalogueRef) — buildPotFromDef wrote
  //     engineFamily:null onto every EN-PR pot, so this filter could
  //     never match one. Fixed in pots.js going forward; the fallback to
  //     catalogueRef.engineFamily below covers every pot already saved
  //     before that fix, with no data migration needed.
  // (2) EN-LP pots' cost calc (flyForward.js's projectEnLpPot /
  //     harvestCostEstimate) never reads projectedCostLow/High at all —
  //     multiplying those fields here was a silent no-op. costMultiplier
  //     is stashed directly on the pot object so fleetExposure.js's
  //     buildAssetAtoms can thread it into projectEnLpPot's ctx instead.
  if (engineCostShock && engineCostShock.engineFamily && engineCostShock.pct) {
    const mult = 1 + engineCostShock.pct / 100;
    entries = entries.map(e => ({
      ...e,
      pots: (e.pots || []).map(p => {
        const family = p.engineFamily || p.catalogueRef?.engineFamily;
        if (!/^EN-(PR|LP)/.test(p.code) || family !== engineCostShock.engineFamily) return p;
        return {
          ...p,
          projectedCostLow: (p.projectedCostLow || 0) * mult,
          projectedCostHigh: (p.projectedCostHigh || 0) * mult,
          costMultiplier: p.triggerBasis === "llp_cycles" ? mult : undefined
        };
      })
    }));
  }

  // Knowledge Base check-duration defaults ({"2Y","6Y","12Y"} weeks) —
  // resolved once per call and closed over in the buildMaintenanceCalendar
  // wrapper below, since fleetExposure.js's buildAssetAtoms calls
  // brains.buildMaintenanceCalendar(...) without a durationDefaults field
  // of its own (it's a pure Brain module, deliberately no window/KB
  // lookups — see its file header). This wrapper is the Body-layer spot
  // where the KB tier actually gets injected, without touching
  // fleetExposure.js itself.
  let durationDefaults = getCheckDurationDefaults();
  if (extendedMaintenanceDuration && extendedMaintenanceDuration.checkType && extendedMaintenanceDuration.extraMonths) {
    const { checkType, extraMonths } = extendedMaintenanceDuration;
    const extraWeeks = extraMonths * (52 / 12);
    durationDefaults = { ...durationDefaults, [checkType]: (durationDefaults[checkType] || 0) + extraWeeks };
  }

  return window.buildFleetExposure({
    assets: entries,
    horizonPastLeaseEndMonths: FLEET_EXPOSURE_HORIZON_MONTHS,
    pandemicGroundingMonths,
    brains: {
      projectReservePot: window.projectReservePot,
      projectEnLpPot: window.projectEnLpPot,
      buildMaintenanceCalendar: (input) => window.buildMaintenanceCalendar({ ...input, durationDefaults })
    }
  });
};

// Fleet Calendar tab (layer3-scenarios-build-handoff.md §7, Alan's "reuse
// the asset calendar view" decision) — every asset's own scheduled events
// at its real utilisation rate, flattened for MaintenanceCalendarGrid.
// Same Body-layer shape as buildFleetExposureData, just calling
// fleetExposure.js's lighter buildFleetMaintenanceEvents instead (no pot
// financial pass — nothing here needs cost, only scheduling).
// Calendar-only entry builder (Alan, July 2026 — TECH_DEBT.md 4.85 follow-
// up): confirmed reserve pot documents only exist once the Lease/Reserve
// Setup wizard has actually been run, which requires a lease. But the
// component data those pots' DATES are derived from — landing gear
// next-due dates (asset.landingGear), engine LLP remaining life
// (asset.engines[].llps/currentFC) — is real Layer-1 tracking data that
// exists independently of any lease or reserve pot. When no confirmed pot
// exists, this synthesizes pot STRUCTURE (triggerBasis/triggerInterval/
// harvestThresholdFC/engineFamily) from the exact same generator the Lease
// Wizard itself uses to pre-populate its checklist (pots.js's
// buildPotDefsForActivation/buildPotFromDef, KB-backed with fixed-
// engineering-constant fallback) — then anchorReservePots (below) attaches
// the REAL due date from the asset's own tracked component data, exactly
// as it already does for confirmed pots.
//
// CRITICAL: this is Calendar/clash-detection ONLY. buildFleetExposureData
// (Financial) must never see synthetic pots — accrualRate is always 0
// here (deliberately never a real $ figure), so a financial projection
// built off these would show a fabricated balance. That's why this is a
// separate function from buildFleetExposureEntry, not a shared one with a
// flag — the separation itself is the safeguard.
//
// What's real vs. omitted once this runs — there is no "estimated" tier
// anymore (Alan, July 2026 — corrected an earlier version of this fix
// that estimated both EN-PR and AP-OH; both are now omitted instead, see
// below):
//   - AF-6Y/AF-12Y: always real (asset.checks) — unaffected either way.
//   - LG-OH: real — anchored from asset.landingGear's actual next-due date.
//   - EN-LP: real — anchored from the engine's actual LLP stack/currentFC.
//   - EN-PR: OMITTED when synthesized. No real "last PR date" is tracked
//     anywhere, so a synthetic pot's opening balance can only ever be 0 —
//     anchoring from that would just assume "a full interval from today,"
//     a fabricated guess. If there's no real data, ignore it, don't show
//     an estimate dressed up as a date.
//   - AP-OH: OMITTED when synthesized, same reasoning — `nowOffsetMonths`
//     (how far into the APU-hour trigger band the asset already sits) is
//     never populated by any caller anywhere in the app, synthetic or
//     confirmed pot alike, so any AP-OH date is always an assume-fresh
//     guess. Note this is narrower than fixing the underlying app-wide gap
//     (AP-OH is still an unflagged approximation in Fly-Forward/Fleet
//     Exposure for assets WITH confirmed pots) — this only stops the
//     Calendar tab from manufacturing an AP-OH date out of nothing when
//     there was never any pot at all to begin with.
// `usedSyntheticPots` still distinguishes these assets from ones with a
// real Lease/Reserve Setup on file, but no longer implies "some shown
// dates are estimates" — every date actually shown for a synthetic-pot
// asset is real.
function buildCalendarEntry({ asset, lease, reserveDocs, utilRate, apuHrPerMonth, scheduledEvents, seasonalityProfile, costProjections }) {
  const confirmedPots = (reserveDocs || []).map(reconstructPotWithStatus).filter(p => !!p.triggerBasis && p.status !== "outstanding");
  const rate = utilRate || { fhPerMonth: 0, fcPerMonth: 0 };
  const leaseStart = new Date();

  let pots;
  let usedSyntheticPots = false;
  if (confirmedPots.length > 0) {
    pots = anchorReservePots({ asset, confirmedPots, rate, leaseStart });
  } else {
    // EN-PR and AP-OH both excluded from the synthetic fallback (Alan,
    // July 2026): neither has any real per-asset anchor data anywhere in
    // the app. EN-PR has no tracked "last PR date"; AP-OH's
    // `nowOffsetMonths` (how far into the APU-hour trigger band the asset
    // already sits) is never populated by any caller anywhere, synthetic
    // or confirmed pot alike. A synthetic pot for either can only ever
    // assume "starting fresh from today" — a fabricated guess dressed up
    // as a date. Per Alan, that goes against the app's deterministic-
    // outputs principle: no real data means omit it, not estimate it.
    // LG-OH and EN-LP are unaffected — both have genuine real anchor data
    // (asset.landingGear's next-due date; the engine's actual LLP stack)
    // and are unchanged.
    const defs = buildPotDefsForActivation(asset).filter(def => !def.code.startsWith("EN-PR") && def.code !== "AP-OH");
    const synthesizedPots = defs.map(def => buildPotFromDef(def, 0, leaseStart.toISOString().slice(0, 10)));
    pots = anchorReservePots({ asset, confirmedPots: synthesizedPots, rate, leaseStart });
    usedSyntheticPots = true;
  }

  return {
    assetId: asset.id,
    msn: asset.msn,
    lease,
    pots,
    engines: asset.engines || [],
    checks: asset.checks || [],
    utilisation: utilRate ? { fhPerMonth: utilRate.fhPerMonth, fcPerMonth: utilRate.fcPerMonth, apuHrPerMonth } : null,
    scheduledEvents: scheduledEvents || [],
    seasonalityProfile: seasonalityProfile || null,
    costProjections: costProjections || [],
    usedSyntheticPots
  };
};

async function buildFleetCalendarData(assets) {
  const bundles = await Promise.all(assets.map(loadFleetExposureBundle));
  const entries = bundles.map(buildCalendarEntry);
  const durationDefaults = getCheckDurationDefaults();
  const results = await Promise.resolve(window.buildFleetMaintenanceEvents({
    assets: entries,
    brains: {
      projectReservePot: window.projectReservePot,
      projectEnLpPot: window.projectEnLpPot,
      buildMaintenanceCalendar: (input) => window.buildMaintenanceCalendar({ ...input, durationDefaults })
    }
  }));
  // fleetExposure.js's buildAssetMaintenanceEvents doesn't know or care
  // whether pots came from real Firestore docs or were synthesized here —
  // that distinction is Body-layer-only (Brain/Body separation), so it's
  // merged back onto each result by assetId after the fact rather than
  // threaded through the pure calc module.
  const syntheticByAssetId = new Map(entries.map(e => [e.assetId, e.usedSyntheticPots]));
  return results.map(r => ({ ...r, usedSyntheticPots: !!syntheticByAssetId.get(r.assetId) }));
};

// Route Suitability Matcher (Brain 8, routeMatcher.js) — Body-layer wiring.
//
// NOT the same shape as buildFleetExposureEntry above, for one important
// reason: engine_fh-triggered pots (EN-PR) get their due-date DERIVED from
// the utilisation rate inside anchorReservePots, and APU's apuHrPerMonth is
// likewise derived from fhPerMonth. Fleet Exposure only ever has one rate,
// so anchoring once upstream is correct there. Route Matcher compares TWO
// rates (the asset's real one vs. the route's), so anchoring must run
// TWICE — once per profile — or EN-PR/AP-OH silently never move under a
// route swap regardless of how different the route's rate is (bug found
// in first real test pass, see TECH_DEBT.md when this gets synced).
//
// buildRouteMatchEntry therefore returns basePots/routePots (each anchored
// against its own rate) and baseUtilisation/routeUtilisation (each with
// its own correctly-derived apuHrPerMonth), rather than a single pots/
// utilisation pair. routeMatcher.js runs its base pass against
// basePots+baseUtilisation and its route pass against
// routePots+routeUtilisation — never mixing the two.
function buildRouteMatchEntry(bundle, route) {
  const { asset, lease, reserveDocs, utilRate, apuHrPerMonth, scheduledEvents, seasonalityProfile, costProjections } = bundle;
  const confirmedPots = (reserveDocs || []).map(reconstructPotWithStatus).filter(p => !!p.triggerBasis);
  const leaseStart = new Date();

  const baseRate = utilRate || { fhPerMonth: 0, fcPerMonth: 0 };
  const basePots = lease ? anchorReservePots({ asset, confirmedPots, rate: baseRate, leaseStart }) : confirmedPots;

  const routeRate = { fhPerMonth: route.fhPerMonth, fcPerMonth: route.fcPerMonth };
  const routePots = lease ? anchorReservePots({ asset, confirmedPots, rate: routeRate, leaseStart }) : confirmedPots;
  const routeApuHrPerMonth = window.estimateApuHrPerMonth(routeRate.fhPerMonth, asset.apu?.currentFH, asset.airframe?.currentFH) || 0;

  return {
    assetId: asset.id,
    msn: asset.msn,
    lease,
    basePots,
    routePots,
    engines: asset.engines || [],
    checks: asset.checks || [],
    baseUtilisation: utilRate ? { fhPerMonth: utilRate.fhPerMonth, fcPerMonth: utilRate.fcPerMonth, apuHrPerMonth } : null,
    routeUtilisation: { fhPerMonth: routeRate.fhPerMonth, fcPerMonth: routeRate.fcPerMonth, apuHrPerMonth: routeApuHrPerMonth },
    scheduledEvents: scheduledEvents || [],
    seasonalityProfile: seasonalityProfile || null,
    costProjections: costProjections || []
  };
};

async function buildRouteMatchData(assets, route) {
  const bundles = await Promise.all(assets.map(loadFleetExposureBundle));
  const entries = bundles.map(b => buildRouteMatchEntry(b, route));
  const durationDefaults = getCheckDurationDefaults();
  const brains = {
    projectReservePot: window.projectReservePot,
    projectEnLpPot: window.projectEnLpPot,
    buildMaintenanceCalendar: (input) => window.buildMaintenanceCalendar({ ...input, durationDefaults })
  };
  // Clash detection (Alan, July 2026 — unblocked now Route Matcher itself
  // exists): every OTHER asset's own base-case scheduled events, computed
  // once per run from the SAME bundles already loaded above (no second
  // Firestore round-trip). Uses buildCalendarEntry (not
  // buildFleetExposureEntry) so a leaseless asset's real landing-gear/LLP
  // dates are still visible to clash detection, same reasoning as the
  // Calendar tab — see buildCalendarEntry's own comment for why this is
  // safe (Calendar/clash-detection only, never financial).
  const fleetMaintenanceEvents = window.buildFleetMaintenanceEvents({
    assets: bundles.map(buildCalendarEntry),
    brains
  });
  return window.matchRouteToFleet({
    assets: entries,
    route,
    brains,
    fleetMaintenanceEvents
  });
};

// scenarioModifiers (all optional, all default to no-op — fully backward
// compatible with every existing caller that doesn't pass this field):
//   aogWindow: { startMonth, durationMonths } | null
//   lesseeDefaultWindow: { startMonth, durationMonths } | null
//   costOverrides: { [code]: overrunPct } | undefined — e.g. { "EN-PR-1": 30 }
//     multiplies that pot's projectedCostLow/projectedCostHigh by
//     (1 + overrunPct/100) before the projection runs. Input modification
//     only — no Brain internals touched (scenarios-structured-controls-
//     handoff.md §1).
// Asset-level Maintenance Calendar, leaseless-safe (TECH_DEBT.md 4.86
// follow-up — that fix only ever reached the FLEET-level Calendar tab via
// buildCalendarEntry/buildFleetCalendarData above; the per-asset Calendar
// tab still shared buildFlyForwardProjection with Financials and inherited
// its hard lease requirement). Same architectural split as buildCalendarEntry
// vs. buildFleetExposureEntry: this path may synthesize pot STRUCTURE
// (never a $ figure — accrualRate is always 0) and tolerate a missing
// lease; buildFlyForwardProjection (Financials) is completely untouched
// and still requires a real lease, exactly as before. Stops after Brain 6
// (maintenanceCal only, no pass-2/dollar projections) — same scope as
// buildFleetCalendarData. Deliberately a parallel function rather than a
// shared refactor of buildFlyForwardProjection's pass-1/Brain-6 block:
// same "known duplication, don't consolidate without a fresh look at both
// call sites" tradeoff already accepted for buildCalendarEntry itself.
function buildAssetMaintenanceCalendar({ asset, lease, reserveDocs, utilRate, scheduledEvents = [], seasonalityProfile = null, costProjections = [] }) {
  const rate = utilRate || { fhPerMonth: 0, fcPerMonth: 0 };
  const apuHrPerMonth = window.estimateApuHrPerMonth(rate.fhPerMonth, asset.apu?.currentFH, asset.airframe?.currentFH) || 0;
  const leaseStart = new Date();
  // No lease (or a lease with no leaseEnd on file yet) — same 180-month
  // default already established for the leaseless Fleet Calendar path
  // (FLEET_EXPOSURE_HORIZON_MONTHS), for the same reason: wide enough
  // that no real anchored date (LG-OH's 120-month interval included)
  // can land beyond it and silently vanish.
  const horizonMonths = lease?.leaseEnd
    ? Math.max(1, window.monthsBetween(leaseStart, new Date(lease.leaseEnd)))
    : FLEET_EXPOSURE_HORIZON_MONTHS;

  const confirmedPots = (reserveDocs || []).map(reconstructPot).filter(p => !!p.triggerBasis);

  let pots;
  let usedSyntheticPots = false;
  if (confirmedPots.length > 0) {
    pots = anchorReservePots({ asset, confirmedPots, rate, leaseStart });
  } else {
    // Identical fallback to buildCalendarEntry above — EN-PR/AP-OH
    // omitted (no real anchor data for either anywhere in the app, so a
    // synthetic date for them would be a fabricated guess); LG-OH/EN-LP
    // synthesized from the asset's own real component data (landing gear
    // next-due, engine LLP stack) via the exact same generator the Lease
    // Wizard itself uses. Reused rather than re-derived so the fleet and
    // asset Calendar paths can never quietly disagree on what "no lease"
    // should show.
    const defs = buildPotDefsForActivation(asset).filter(def => !def.code.startsWith("EN-PR") && def.code !== "AP-OH");
    const synthesizedPots = defs.map(def => buildPotFromDef(def, 0, leaseStart.toISOString().slice(0, 10)));
    pots = anchorReservePots({ asset, confirmedPots: synthesizedPots, rate, leaseStart });
    usedSyntheticPots = true;
  }

  let maintenanceCal = null;
  let projectionError = null;
  try {
    const ctx = { leaseStart, horizonMonths, utilisation: { fhPerMonth: rate.fhPerMonth, fcPerMonth: rate.fcPerMonth, apuHrPerMonth } };
    const eligiblePots = pots.filter(pot => {
      if (pot.triggerBasis !== "llp_cycles") return true;
      const eng = (asset.engines || []).find(e => e.position === pot.enginePosition);
      return eng && eng.llps && eng.llps.length;
    });
    const pass1Projections = eligiblePots.map(pot => {
      if (pot.triggerBasis === "llp_cycles") {
        const eng = (asset.engines || []).find(e => e.position === pot.enginePosition);
        return window.projectEnLpPot(pot, { ...ctx, llpEngineStart: { llps: eng.llps, currentFC: eng.currentFC } });
      }
      return window.projectReservePot(pot, ctx);
    });
    const nonGroundingEvents = pass1Projections
      .filter(p => p.code !== "AF-6Y" && p.code !== "AF-12Y")
      .flatMap(p => {
        const sourcePot = eligiblePots.find(pp => pp.code === p.code);
        return (p.events || []).map((evt, idx) => ({
          code: p.code, label: p.label, dueCycle: idx + 1, date: evt.date,
          enginePosition: sourcePot ? sourcePot.enginePosition : null
        }));
      });
    maintenanceCal = window.buildMaintenanceCalendar({
      leaseStart, horizonMonths,
      checks: asset.checks || [],
      nonGroundingEvents,
      overrides: scheduledEvents,
      seasonalityProfile,
      costProjections,
      durationDefaults: getCheckDurationDefaults()
    });
  } catch (e) {
    projectionError = e.message || String(e);
  }

  return { maintenanceCal, projectionError, usedSyntheticPots, horizonMonths };
};

function buildFlyForwardProjection({ asset, lease, reserveDocs, utilRate, scheduledEvents = [], seasonalityProfile = null, costProjections = [], scenarioModifiers = {} }) {
  const rate = utilRate || { fhPerMonth: 0, fcPerMonth: 0 };
  const usingRealRate = !!utilRate;
  const apuHrPerMonth = window.estimateApuHrPerMonth(rate.fhPerMonth, asset.apu?.currentFH, asset.airframe?.currentFH) || 0;

  const leaseStart = new Date();
  const leaseEnd = new Date(lease.leaseEnd);
  const horizonMonths = Math.max(1, window.monthsBetween(leaseStart, leaseEnd));

  const ctx = {
    leaseStart,
    horizonMonths,
    utilisation: { fhPerMonth: rate.fhPerMonth, fcPerMonth: rate.fcPerMonth, apuHrPerMonth }
  };

  // Cost overrun (§1) — applied to reserveDocs BEFORE reconstructPot, so
  // it flows through exactly like any other pot field. Only the codes
  // present in costOverrides are touched; every other pot is unaffected.
  const { aogWindow = null, lesseeDefaultWindow = null, costOverrides = null } = scenarioModifiers || {};
  const effectiveReserveDocs = costOverrides
    ? reserveDocs.map(doc => {
        const overrunPct = costOverrides[doc.code];
        if (!overrunPct) return doc;
        const mult = 1 + overrunPct / 100;
        return { ...doc, projectedCostLow: (doc.projectedCostLow || 0) * mult, projectedCostHigh: (doc.projectedCostHigh || 0) * mult };
      })
    : reserveDocs;

  // Confirmed pots only (Section 5: "Brain 3 runs on whatever pots are
  // confirmed... surfaces a dataCompleteness gap rather than blocking
  // the whole projection or silently treating missing pots as zero").
  const confirmedPots = effectiveReserveDocs.map(reconstructPot).filter(p => !!p.triggerBasis);

  const expectedCodes = [
    "AF-6Y", "AF-12Y", "AP-OH", "LG-OH",
    ...(asset.engines || []).filter(e => e.sn).flatMap(e => {
      const codes = [`EN-PR-${e.position}`];
      if (e.llps && e.llps.length) codes.push(`EN-LP-${e.position}`);
      return codes;
    })
  ];
  const missingCodes = expectedCodes.filter(c => !confirmedPots.some(p => p.code === c));

  const anchoredPots = anchorReservePots({ asset, confirmedPots, rate, leaseStart });

  let projections = [];
  let maintenanceCal = null;
  let projectionError = null;
  try {
    const eligiblePots = anchoredPots.filter(pot => {
      if (pot.triggerBasis !== "llp_cycles") return true;
      const eng = (asset.engines || []).find(e => e.position === pot.enginePosition);
      return eng && eng.llps && eng.llps.length;
    });

    // PASS 1 — ungrounded. Only used to source real derived dates for
    // LG-OH/AP-OH/EN-PR/EN-LP — Brain 6 reads these rather than
    // recalculating them. AF-6Y/AF-12Y grounding comes from asset.checks
    // directly, not from this pass — Brain 6 owns C-check derivation
    // itself. No feedback loop: grounding never depends on Brain 3.
    const pass1Projections = eligiblePots.map(pot => {
      if (pot.triggerBasis === "llp_cycles") {
        const eng = (asset.engines || []).find(e => e.position === pot.enginePosition);
        return window.projectEnLpPot(pot, { ...ctx, llpEngineStart: { llps: eng.llps, currentFC: eng.currentFC } });
      }
      return window.projectReservePot(pot, ctx);
    });

    const nonGroundingEvents = pass1Projections
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

    // BRAIN 6 — full maintenance calendar + grounding vector. Real
    // scheduledEvents/seasonalityProfile/shopVisitProjections now wired
    // through here (TECH_DEBT.md 4.38-4.40 follow-up session) — these
    // were always passed as empty defaults before. durationDefaults
    // (Knowledge Base tier 2, falling back to Brain 6's own built-in
    // 2/4/8-week defaults if the Knowledge Base hasn't been populated)
    // added in the Knowledge Base build session — no change needed in
    // maintenanceCal.js itself, it already accepted this parameter.
    maintenanceCal = window.buildMaintenanceCalendar({
      leaseStart,
      horizonMonths,
      checks: asset.checks || [],
      nonGroundingEvents,
      overrides: scheduledEvents,
      seasonalityProfile,
      costProjections,
      durationDefaults: getCheckDurationDefaults()
    });

    // PASS 2 — grounded. Same pots, same ctx, plus the availability
    // vector Brain 6 just derived, combined with any AOG scenario window
    // (§1 — "same concept as Brain 6's C-Check grounding windows... inject
    // a user-defined grounding window into the projection context").
    // accrualAvailability is a SEPARATE axis (lessee default, §1) — see
    // flyForward.js's monthlyAccrual for why the two must not be conflated.
    const aogVector = aogWindow ? buildWindowAvailabilityVector(horizonMonths, aogWindow) : null;
    const combinedGrounding = aogVector ? combineAvailability(maintenanceCal.groundingAvailability, aogVector) : maintenanceCal.groundingAvailability;
    const accrualAvailability = lesseeDefaultWindow ? buildWindowAvailabilityVector(horizonMonths, lesseeDefaultWindow) : undefined;
    const groundedCtx = { ...ctx, groundingAvailability: combinedGrounding, accrualAvailability };
    projections = eligiblePots.map(pot => {
      if (pot.triggerBasis === "llp_cycles") {
        const eng = (asset.engines || []).find(e => e.position === pot.enginePosition);
        // EN-LP cost override — see flyForward.js's projectEnLpPot for
        // why this can't go through the projectedCostLow/High
        // multiplication above (bug found July 2026: harvestCostEstimate
        // never reads those fields, so that path is a no-op for EN-LP).
        // costOverrides is still keyed by pot.code exactly as before —
        // same UI, same per-pot percentage, just delivered via an
        // explicit ctx multiplier instead of a pre-multiplied field.
        const costMultiplier = (costOverrides && costOverrides[pot.code]) ? 1 + costOverrides[pot.code] / 100 : 1;
        return window.projectEnLpPot(pot, { ...groundedCtx, llpEngineStart: { llps: eng.llps, currentFC: eng.currentFC }, costMultiplier });
      }
      return window.projectReservePot(pot, groundedCtx);
    });

    // Display order matches the tech spec's own section sequence, not
    // Firestore's arbitrary doc order.
    const POT_DISPLAY_ORDER = ["AF-6Y", "AF-12Y", "EN-PR-1", "EN-LP-1", "EN-PR-2", "EN-LP-2", "LG-OH", "AP-OH"];
    projections.sort((a, b) => {
      const ai = POT_DISPLAY_ORDER.indexOf(a.code);
      const bi = POT_DISPLAY_ORDER.indexOf(b.code);
      if (ai === -1 && bi === -1) return 0;
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  } catch (e) {
    projectionError = e.message || String(e);
  }

  return { leaseStart, horizonMonths, rate, usingRealRate, confirmedPots, missingCodes, anchoredPots, maintenanceCal, projections, projectionError };
};


export { FF_COLORS, FLEET_EXPOSURE_HORIZON_MONTHS, addMonthsFF, anchorReservePots, buildAssetMaintenanceCalendar, buildFleetCalendarData, buildFleetExposureData, buildFleetExposureEntry, buildFlyForwardProjection, buildRouteMatchData, buildRouteMatchEntry, loadFleetExposureBundle, reconstructPot, reconstructPotWithStatus };
