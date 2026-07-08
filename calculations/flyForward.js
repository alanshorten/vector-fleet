// ============================================================
// BRAIN 3 — Fly-Forward Engine
// Core reserve-pot cash flow projection. Pure calculation logic.
// No UI. No Firebase. No side effects.
//
// Implements the schema and formula locked in the July 2026 Brain 3
// scoping session (VECTORIQ_ROADMAP.md Section 4,
// brain3-scoping-session-handoff.md). This file is written to be the
// real Brain 3 used by the live Layer 2 build, not a demo-only
// stand-in — the Fly-Forward Demo view exercises this exact code
// against fabricated numbers (TECH_DEBT.md — Fly-Forward Demo item).
//
// Per VectorIQ architecture (Brain/Body separation):
//   /calculations  <- THE BRAIN (this file)
//   /services      <- THE NERVOUS SYSTEM (Firebase, API calls)
//   /components    <- THE BODY (UI only)
// ============================================================

// ---- Shared helpers -----------------------------------------------

// Escalates a base value forward using annual compounding that steps
// once per calendar-year boundary crossed (roadmap: "compounds 1 Jan"),
// not smooth monthly compounding. Used for both the accrual-escalation
// stream and the (separate) outflow-escalation stream.
function escalateAnnual(baseValue, baseYear, targetDate, pctPerYr) {
  const yearsElapsed = Math.max(0, targetDate.getFullYear() - baseYear);
  return baseValue * Math.pow(1 + (pctPerYr || 0) / 100, yearsElapsed);
}

function addMonths(date, n) {
  const d = new Date(date.getTime());
  d.setMonth(d.getMonth() + n);
  return d;
}

function monthsBetween(a, b) {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

// EN-PR only: optional derate override. For every 1% the actual average
// annual derate differs from the baseline (typically 10%), the rate
// adjusts +/-1.5%, capped at +/-15% derate. derateModifier is null for
// every other pot (or when no override is entered) -> rate used as-is.
function applyDerateModifier(rate, derateModifier) {
  if (!derateModifier) return rate;
  const { baseline, actual, pctPerPct, capDerate } = derateModifier;
  if (actual === null || actual === undefined) return rate;
  const cappedActual = Math.max(-capDerate, Math.min(capDerate, actual));
  const deltaPct = cappedActual - baseline;
  return rate * (1 + (deltaPct * pctPerPct) / 100);
}

// Monthly accrual contribution for a pot, escalated to the given month's
// date. accrualBasis selects which utilisation figure (if any) applies.
function monthlyAccrual(pot, monthDate, utilisation) {
  const escalatedRate = escalateAnnual(
    pot.accrualRate,
    pot.accrualRateBaseYear,
    monthDate,
    pot.escalationPctPerYr
  );
  const rate =
    pot.derateModifier ? applyDerateModifier(escalatedRate, pot.derateModifier) : escalatedRate;

  switch (pot.accrualBasis) {
    case "per_month":
      return rate;
    case "per_FH":
      return rate * (utilisation.fhPerMonth || 0);
    case "per_FC":
      return rate * (utilisation.fcPerMonth || 0);
    case "per_APU_hr":
      return rate * (utilisation.apuHrPerMonth || 0);
    default:
      return 0;
  }
}

// Escalates the outflow cost range to a specific event date, using the
// SEPARATE outflow-escalation stream (roadmap: accrual and outflow
// escalate independently, even though both are 2.5%/yr for the flat
// pots — the real divergence risk concentrates in the engine pots).
function escalatedCostRange(pot, eventDate) {
  const low = escalateAnnual(pot.projectedCostLow, pot.outflowCostBaseYear, eventDate, pot.outflowEscalationPct);
  const high = escalateAnnual(pot.projectedCostHigh, pot.outflowCostBaseYear, eventDate, pot.outflowEscalationPct);
  const likely =
    pot.projectedCostLikely != null
      ? escalateAnnual(pot.projectedCostLikely, pot.outflowCostBaseYear, eventDate, pot.outflowEscalationPct)
      : (low + high) / 2;
  return { low, likely, high };
}

// ---- Event-date generators, one per triggerBasis -------------------

// calendar_months: pure time-based, repeating every N months from
// lease start (or from lastEventDate if mid-lease onboarding supplies
// one). If firstEventOverrideDate is set (a real, already-known next-due
// date — e.g. from asset.checks), it takes priority over both: trust
// the real date directly for the FIRST occurrence rather than
// re-deriving it, then repeat at the configured interval after that.
// Returns event month-indices (relative to leaseStart) within the
// projection horizon.
function calendarMonthEvents(pot, horizonMonths, leaseStart) {
  const interval = pot.triggerInterval.months;
  let startOffset;
  if (pot.firstEventOverrideDate) {
    startOffset = Math.max(0, monthsBetween(leaseStart, pot.firstEventOverrideDate));
  } else if (pot.lastEventDate) {
    startOffset = monthsBetween(leaseStart, pot.lastEventDate) + interval;
  } else {
    startOffset = interval;
  }
  const events = [];
  for (let m = startOffset; m <= horizonMonths; m += interval) events.push(m);
  return events;
}

// calendar_or_cycles: dual limiter (e.g. Landing Gear — 10yr/20,000FC).
// Whichever comes first governs; resets both counters at each event so
// a longer horizon correctly re-derives the next interval each time.
// If firstEventOverrideDate is set (e.g. the asset's own already-computed
// landing-gear nextDue, which already accounts for both the calendar and
// cycle limiter on the real asset), it anchors the FIRST occurrence
// directly — later occurrences fall back to the fabricated cadence since
// there's no real data to anchor those against.
function calendarOrCyclesEvents(pot, horizonMonths, leaseStart, fcPerMonth) {
  const { months: calMonths, cycles } = pot.triggerInterval;
  const cycleMonths = fcPerMonth > 0 ? cycles / fcPerMonth : Infinity;
  const interval = Math.min(calMonths, cycleMonths);
  const events = [];
  let m = pot.firstEventOverrideDate
    ? Math.max(0, monthsBetween(leaseStart, pot.firstEventOverrideDate))
    : interval;
  while (m <= horizonMonths) {
    events.push(Math.round(m));
    m += interval;
  }
  return events;
}

// apu_hours: condition-based, not calendar. The event DATE itself is a
// two-axis uncertainty (when x how much) — returns a WINDOW
// [monthMin, monthMax] per occurrence rather than a single month,
// derived by projecting APU hours forward until they cross the
// trigger band. For continuing the simulation past one event, resets
// at the window midpoint (a modelling simplification — real accumulated
// hours reset to 0 at overhaul, this assumes steady apuHrPerMonth).
//
// startOffsetMonths anchors the clock to "now" rather than month 0
// (lease start) — if leaseStart is set to a real historical date (to
// let $ balances catch up to a realistic today), there's still no real
// data on how many APU hours were already accumulated toward the next
// overhaul back then, so the condition clock only starts counting from
// today, same as EN-LP's engine-cycle clock.
function apuHourEvents(pot, horizonMonths, apuHrPerMonth, startOffsetMonths) {
  const [minHr, maxHr] = pot.triggerInterval.apuHours;
  const events = [];
  if (apuHrPerMonth <= 0) return events;
  let offsetMonths = startOffsetMonths || 0;
  while (true) {
    const monthMin = offsetMonths + minHr / apuHrPerMonth;
    const monthMax = offsetMonths + maxHr / apuHrPerMonth;
    if (monthMin > horizonMonths) break;
    events.push({ monthMin, monthMax, monthMid: (monthMin + monthMax) / 2 });
    offsetMonths = (monthMin + monthMax) / 2; // reset at window midpoint
  }
  return events;
}

// ---- Per-pot projection --------------------------------------------

// Projects a single non-LLP reserve pot (calendar_months, calendar_or_cycles,
// or apu_hours trigger bases) month-by-month across the horizon.
//
// pot: reservePot object per the locked schema (VECTORIQ_ROADMAP.md Section 4)
// ctx: { leaseStart:Date, horizonMonths:int, utilisation:{fhPerMonth,fcPerMonth,apuHrPerMonth} }
//
// Returns: {
//   code, label,
//   monthlySeries: [{ monthIndex, date, balance }],
//   events: [{ monthIndex, date, dateWindow?, costLow, costLikely, costHigh, shortfallLow, shortfallHigh, balanceAtEvent, beyondHorizon }],
//   warnings: []
// }
function projectReservePot(pot, ctx) {
  const { leaseStart, horizonMonths, utilisation } = ctx;

  let eventMonths;
  if (pot.triggerBasis === "calendar_months") {
    eventMonths = calendarMonthEvents(pot, horizonMonths, leaseStart).map(m => ({ monthMid: m }));
  } else if (pot.triggerBasis === "calendar_or_cycles") {
    eventMonths = calendarOrCyclesEvents(pot, horizonMonths, leaseStart, utilisation.fcPerMonth).map(m => ({
      monthMid: m
    }));
  } else if (pot.triggerBasis === "apu_hours") {
    eventMonths = apuHourEvents(pot, horizonMonths, utilisation.apuHrPerMonth, ctx.nowOffsetMonths);
  } else {
    throw new Error(`projectReservePot: unsupported triggerBasis "${pot.triggerBasis}" — use projectEnLpPot for llp_cycles`);
  }

  const monthlySeries = [];
  const events = [];
  let balance = pot.openingBalance || 0;
  let nextEventIdx = 0;

  for (let m = 0; m <= horizonMonths; m++) {
    const date = addMonths(leaseStart, m);
    if (m > 0) balance += monthlyAccrual(pot, date, utilisation);
    monthlySeries.push({ monthIndex: m, date, balance });

    // Fire any event whose window midpoint falls on this month
    while (
      nextEventIdx < eventMonths.length &&
      Math.round(eventMonths[nextEventIdx].monthMid) === m
    ) {
      const evt = eventMonths[nextEventIdx];
      const eventDate = addMonths(leaseStart, m);
      const cost = escalatedCostRange(pot, eventDate);
      const shortfallLow = cost.low - balance;
      const shortfallHigh = cost.high - balance;

      events.push({
        monthIndex: m,
        date: eventDate,
        dateWindow:
          evt.monthMin !== undefined
            ? { start: addMonths(leaseStart, Math.floor(evt.monthMin)), end: addMonths(leaseStart, Math.ceil(evt.monthMax)) }
            : null,
        costLow: cost.low,
        costLikely: cost.likely,
        costHigh: cost.high,
        shortfallLow,
        shortfallHigh,
        balanceAtEvent: balance,
        beyondHorizon: false
      });

      balance -= cost.likely; // assumed-actual cost carried forward (can go negative — underfunded)
      nextEventIdx++;
    }
  }

  // Horizon rule: an event that would fall beyond the lease end is not
  // fired or flagged as a shortfall — it's partial-funded at redelivery.
  // Surface it as informational, not as a shortfall event.
  let partialFundedNote = null;
  if (nextEventIdx < eventMonths.length) {
    const nextM = eventMonths[nextEventIdx].monthMid;
    partialFundedNote = {
      monthIndex: Math.round(nextM),
      date: addMonths(leaseStart, Math.round(nextM)),
      note: "Falls beyond lease end — partial-funded, settles at redelivery (not a shortfall)."
    };
  }

  return { code: pot.code, label: pot.label, monthlySeries, events, partialFundedNote, warnings: [] };
}

// ---- EN-LP: stack-simulation projection ----------------------------

// Projects the EN-LP pot using the Brain-2-fed LLP stack simulation:
// the lowest limiter forces the shop visit; every other LLP within
// harvestThresholdFC of ITS OWN limit is harvested (replaced at full
// catalogue price) at the same visit, even with life left; harvested
// parts (incl. the limiter) reset to full life and the stack rebuilds.
//
// pot: reservePot for EN-LP (accrualBasis:'per_FC', harvestThresholdFC,
//      stubBufferPct, plus the standard accrual/outflow fields)
// ctx: as above, PLUS llpEngineStart: { llps:[...], currentFC } — the
//      Brain-2-shaped LLP stack at lease start (fabricated for demo).
//
// Returns the same shape as projectReservePot, plus warnings populated
// from validateStubBuffer (llpCalculator.js, Brain 2) at each shop visit.
function projectEnLpPot(pot, ctx) {
  const { leaseStart, horizonMonths, utilisation, llpEngineStart } = ctx;
  const fcPerMonth = utilisation.fcPerMonth || 0;
  // llpEngineStart.currentFC is a REAL snapshot taken today, not at
  // lease inception. If leaseStart is set to a real historical date (so
  // $ balances can catch up to a realistic today), the engine-cycle
  // clock must still start from "now" — there's no way to know the
  // engine's real cycle count back at a fabricated lease start, and
  // assuming today's reading applied back then would simulate years of
  // cycles that never happened.
  const nowOffsetMonths = Math.max(0, ctx.nowOffsetMonths || 0);

  // Working copy of the LLP stack — each part's life resets on harvest.
  let llps = llpEngineStart.llps.map(l => ({ ...l }));
  let baseFC = llpEngineStart.currentFC;
  let resetMonth = nowOffsetMonths; // the month index at which baseFC was last established (= "now", not lease start)

  const monthlySeries = [];
  const events = [];
  const warnings = [];
  let balance = pot.openingBalance || 0;
  let missingApprovedLifeWarned = false;

  for (let m = 0; m <= horizonMonths; m++) {
    const date = addMonths(leaseStart, m);
    if (m > 0) balance += monthlyAccrual(pot, date, utilisation);
    monthlySeries.push({ monthIndex: m, date, balance });

    // Before "now", there's no real engine-cycle data to check shop
    // visits against — only $ accrual applies to this stretch of the
    // chart (the historical catch-up period).
    if (m < nowOffsetMonths) continue;

    const currentFC = baseFC + fcPerMonth * (m - resetMonth);

    if (!llps.length) continue;

    // TRUE lowest limiter from the FULL raw stack — mirrors Brain 2's
    // lowestLimiter() and is independent of whether approvedLife is
    // populated. approvedLife is often left blank on real LLP records
    // (it isn't needed for day-to-day FC-remaining tracking), and
    // llpVector() silently drops any part missing it — using llpVector
    // alone to find the limiter would miss real shop visits entirely
    // whenever the limiting part itself lacks approvedLife.
    const withRemaining = llps.map(l => ({ ...l, remainingFC: window.calcLLPRem(l, currentFC) }));
    const trueLimiter = withRemaining.reduce((min, p) => (p.remainingFC < min.remainingFC ? p : min));

    if (trueLimiter.remainingFC <= 0) {
      const limiterHasApprovedLife = trueLimiter.approvedLife !== null && trueLimiter.approvedLife !== undefined;
      if (!limiterHasApprovedLife && !missingApprovedLifeWarned) {
        warnings.push(
          `⚠ ${trueLimiter.desc || trueLimiter.pn || "the limiting LLP"} has no Approved Life recorded. ` +
          `Fly-Forward can still detect it's driving a shop visit, but can't estimate its replacement cost ` +
          `or reset its future life without that value — enter Approved Life on this LLP record for a complete simulation.`
        );
        missingApprovedLifeWarned = true;
      }

      // Harvest candidates (parts riding along, other than the limiter
      // itself) come from the approvedLife-filtered vector, since the
      // harvest-threshold comparison and stub-buffer guardrail both
      // need approvedLife to mean anything.
      const eng = { llps, currentFC };
      const vector = window.llpVector(eng);
      const candidates = vector.filter(p => !(p.pn === trueLimiter.pn && p.sn === trueLimiter.sn));
      const harvestSet = candidates.filter(p => p.remainingFC <= pot.harvestThresholdFC);
      const harvestSetPriced = harvestSet.map(p => {
        const match = llps.find(l => l.pn === p.pn && l.sn === p.sn);
        return { ...p, catalogPrice: match ? match.catalogPrice : undefined };
      });

      // Only run the stub-buffer guardrail when the true limiter is
      // itself part of the approvedLife-having vector too — otherwise
      // validateStubBuffer would misidentify a different part as "the
      // limiter" internally and mis-exclude it from its own check.
      if (limiterHasApprovedLife) {
        const warning = window.validateStubBuffer(eng, pot);
        if (warning && !warnings.includes(warning)) warnings.push(warning);
      }

      const limiterPriced = limiterHasApprovedLife
        ? { ...trueLimiter, catalogPrice: (llps.find(l => l.pn === trueLimiter.pn && l.sn === trueLimiter.sn) || {}).catalogPrice }
        : null; // cost genuinely unknown — omitted from the estimate, not zeroed silently (see warning above)

      const allHarvested = limiterPriced ? [limiterPriced, ...harvestSetPriced] : harvestSetPriced;

      const cost = escalatedCostRange(
        { ...pot, projectedCostLow: harvestCostEstimate(allHarvested, llps, pot.fullStackReplacementCost, pot.engineFamily, "low"),
          projectedCostHigh: harvestCostEstimate(allHarvested, llps, pot.fullStackReplacementCost, pot.engineFamily, "high") },
        date
      );
      const shortfallLow = cost.low - balance;
      const shortfallHigh = cost.high - balance;

      events.push({
        monthIndex: m,
        date,
        dateWindow: null,
        costLow: cost.low,
        costLikely: cost.likely,
        costHigh: cost.high,
        shortfallLow,
        shortfallHigh,
        balanceAtEvent: balance,
        beyondHorizon: false,
        harvestedParts: [trueLimiter.desc || trueLimiter.pn, ...harvestSet.map(p => p.desc)],
        costIncomplete: !limiterHasApprovedLife
      });

      balance -= cost.likely;

      // Reset harvested parts to full life at this point in time. A part
      // with unknown approvedLife can't be reset to "full life" (we don't
      // know what that is) — parked far out instead so it doesn't
      // immediately re-trigger every subsequent month; the warning above
      // already explains why its future replacement isn't being projected.
      const harvestedIds = new Set([
        trueLimiter.pn + "|" + trueLimiter.sn,
        ...harvestSet.map(p => p.pn + "|" + p.sn)
      ]);
      llps = llps.map(l => {
        if (!harvestedIds.has(l.pn + "|" + l.sn)) return l;
        if (l.approvedLife !== null && l.approvedLife !== undefined) {
          return { ...l, startFCRem: l.approvedLife, refFC: currentFC };
        }
        return { ...l, startFCRem: 999999, refFC: currentFC };
      });
      baseFC = currentFC;
      resetMonth = m;
    }
  }

  return { code: pot.code, label: pot.label, monthlySeries, events, partialFundedNote: null, warnings };
}

// Per-part cost estimate for a harvested set. Three tiers, in order of
// preference:
//   1. Real catalogue price, matched by exact P/N (llpCatalogue.js) —
//      sourced from Engine_LLP_Escalation_Model.xlsx. Tightest cost band
//      (+/-3%, install/labour variance only) since the part price itself
//      is known, not estimated.
//   2. p.catalogPrice if the caller supplied one directly (fabricated
//      demo LLP stacks can).
//   3. Proportional share of a known "full stack replacement cost"
//      (pot.fullStackReplacementCost), sized by the part's approvedLife
//      relative to the whole stack's total approvedLife (allLlps) — this
//      guarantees a partial harvest can never sum to more than the full
//      stack figure, which a flat per-FC rate could (and did). Wider
//      band (+/-8%) since this tier is a genuine estimate, not a real price.
// A part with NO approvedLife and no catalogue/supplied price contributes
// $0 and should already be flagged elsewhere (costIncomplete on the event).
function harvestCostEstimate(harvestSet, allLlps, fullStackReplacementCost, engineFamily, bound) {
  const totalApprovedLife = (allLlps || []).reduce((s, p) => s + (p.approvedLife || 0), 0);
  return harvestSet.reduce((sum, p) => {
    const cataloguePrice = window.lookupLLPCataloguePrice ? window.lookupLLPCataloguePrice(p.pn, engineFamily) : null;
    if (cataloguePrice != null) {
      const m = bound === "low" ? 0.97 : 1.03;
      return sum + cataloguePrice * m;
    }
    const m = bound === "low" ? 0.92 : 1.08;
    let price;
    if (p.catalogPrice != null) price = p.catalogPrice;
    else if (totalApprovedLife > 0 && fullStackReplacementCost) price = (p.approvedLife / totalApprovedLife) * fullStackReplacementCost;
    else price = 0;
    return sum + price * m;
  }, 0);
}

window.projectReservePot = projectReservePot;
window.projectEnLpPot = projectEnLpPot;
window.escalateAnnual = escalateAnnual;
window.applyDerateModifier = applyDerateModifier;
window.monthsBetween = monthsBetween;
