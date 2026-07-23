import { db } from './db';

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
  if (!asset.currentLeaseId) {
    return { asset, lease: null, reserveDocs: [], utilRate: null, apuHrPerMonth: 0, scheduledEvents: [], seasonalityProfile: null, costProjections: [] };
  }
  const [util, leaseData, reserves, schedEvts, seasonProfile, shopVisits] = await Promise.all([
    db.getUtilisation(asset.id).catch(() => []),
    db.getLease(asset.currentLeaseId).catch(() => null),
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
  const pots = lease ? anchorReservePots({ asset, confirmedPots, rate, leaseStart: new Date() }) : confirmedPots;

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

async function buildFleetExposureData(assets) {
  const bundles = await Promise.all(assets.map(loadFleetExposureBundle));
  const entries = bundles.map(buildFleetExposureEntry);
  return window.buildFleetExposure({
    assets: entries,
    horizonPastLeaseEndMonths: FLEET_EXPOSURE_HORIZON_MONTHS,
    brains: {
      projectReservePot: window.projectReservePot,
      projectEnLpPot: window.projectEnLpPot,
      buildMaintenanceCalendar: window.buildMaintenanceCalendar
    }
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
    // were always passed as empty defaults before. No change needed in
    // maintenanceCal.js or flyForward.js themselves, per the original
    // design note — only this input-assembly layer changes.
    maintenanceCal = window.buildMaintenanceCalendar({
      leaseStart,
      horizonMonths,
      checks: asset.checks || [],
      nonGroundingEvents,
      overrides: scheduledEvents,
      seasonalityProfile,
      costProjections
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


export { FF_COLORS, FLEET_EXPOSURE_HORIZON_MONTHS, addMonthsFF, anchorReservePots, buildFleetExposureData, buildFleetExposureEntry, buildFlyForwardProjection, loadFleetExposureBundle, reconstructPot, reconstructPotWithStatus };
