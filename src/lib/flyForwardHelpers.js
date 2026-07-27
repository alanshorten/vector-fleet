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

const FLEET_EXPOSURE_HORIZON_MONTHS = 24;

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

async function buildFleetExposureData(assets, pandemicGroundingMonths = 0) {
  const bundles = await Promise.all(assets.map(loadFleetExposureBundle));
  const entries = bundles.map(buildFleetExposureEntry);
  // Knowledge Base check-duration defaults ({"2Y","6Y","12Y"} weeks) —
  // resolved once per call and closed over in the buildMaintenanceCalendar
  // wrapper below, since fleetExposure.js's buildAssetAtoms calls
  // brains.buildMaintenanceCalendar(...) without a durationDefaults field
  // of its own (it's a pure Brain module, deliberately no window/KB
  // lookups — see its file header). This wrapper is the Body-layer spot
  // where the KB tier actually gets injected, without touching
  // fleetExposure.js itself.
  const durationDefaults = getCheckDurationDefaults();
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
// What's real vs. estimated once this runs:
//   - AF-6Y/AF-12Y: always real (asset.checks) — unaffected either way.
//   - LG-OH: real — anchored from asset.landingGear's actual next-due date.
//   - EN-LP: real — anchored from the engine's actual LLP stack/currentFC.
//   - EN-PR: an ESTIMATE when synthesized — no real "last PR date" is
//     tracked on the asset, so with a synthetic pot's opening balance at
//     0, anchoring assumes a full interval from today (same "starting
//     fresh" assumption the KB-family-interval fallback always makes).
//   - AP-OH: already an app-wide approximation regardless of synthetic vs.
//     real pots — `nowOffsetMonths` (how far into the APU-hour trigger
//     band the asset already sits) is never actually populated by any
//     caller anywhere in the app today, so AP-OH always assumes "starting
//     fresh." Not a new gap introduced here.
// `usedSyntheticPots` is returned so the caller can flag EN-PR/AP-OH as
// estimated where it matters, without withholding the genuinely real
// LG-OH/EN-LP dates.
function buildCalendarEntry({ asset, lease, reserveDocs, utilRate, apuHrPerMonth, scheduledEvents, seasonalityProfile, costProjections }) {
  const confirmedPots = (reserveDocs || []).map(reconstructPotWithStatus).filter(p => !!p.triggerBasis && p.status !== "outstanding");
  const rate = utilRate || { fhPerMonth: 0, fcPerMonth: 0 };
  const leaseStart = new Date();

  let pots;
  let usedSyntheticPots = false;
  if (confirmedPots.length > 0) {
    pots = anchorReservePots({ asset, confirmedPots, rate, leaseStart });
  } else {
    const defs = buildPotDefsForActivation(asset);
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

function buildFlyForwardProjection({ asset, lease, reserveDocs, utilRate, scheduledEvents = [], seasonalityProfile = null, costProjections = [] }) {
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

  // Confirmed pots only (Section 5: "Brain 3 runs on whatever pots are
  // confirmed... surfaces a dataCompleteness gap rather than blocking
  // the whole projection or silently treating missing pots as zero").
  const confirmedPots = reserveDocs.map(reconstructPot).filter(p => !!p.triggerBasis);

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
    // vector Brain 6 just derived. This is the projection actually shown.
    const groundedCtx = { ...ctx, groundingAvailability: maintenanceCal.groundingAvailability };
    projections = eligiblePots.map(pot => {
      if (pot.triggerBasis === "llp_cycles") {
        const eng = (asset.engines || []).find(e => e.position === pot.enginePosition);
        return window.projectEnLpPot(pot, { ...groundedCtx, llpEngineStart: { llps: eng.llps, currentFC: eng.currentFC } });
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


export { FF_COLORS, FLEET_EXPOSURE_HORIZON_MONTHS, addMonthsFF, anchorReservePots, buildFleetCalendarData, buildFleetExposureData, buildFleetExposureEntry, buildFlyForwardProjection, buildRouteMatchData, buildRouteMatchEntry, loadFleetExposureBundle, reconstructPot, reconstructPotWithStatus };
