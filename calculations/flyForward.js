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
// one). Returns event month-indices (relative to leaseStart) within
// the projection horizon.
function calendarMonthEvents(pot, horizonMonths, leaseStart) {
  const interval = pot.triggerInterval.months;
  const startOffset = pot.lastEventDate
    ? monthsBetween(leaseStart, pot.lastEventDate) + interval
    : interval;
  const events = [];
  for (let m = startOffset; m <= horizonMonths; m += interval) events.push(m);
  return events;
}

// calendar_or_cycles: dual limiter (e.g. Landing Gear — 10yr/20,000FC).
// Whichever comes first governs; resets both counters at each event so
// a longer horizon correctly re-derives the next interval each time.
function calendarOrCyclesEvents(pot, horizonMonths, leaseStart, fcPerMonth) {
  const { months: calMonths, cycles } = pot.triggerInterval;
  const cycleMonths = fcPerMonth > 0 ? cycles / fcPerMonth : Infinity;
  const interval = Math.min(calMonths, cycleMonths);
  const events = [];
  let m = interval;
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
function apuHourEvents(pot, horizonMonths, apuHrPerMonth) {
  const [minHr, maxHr] = pot.triggerInterval.apuHours;
  const events = [];
  if (apuHrPerMonth <= 0) return events;
  let offsetMonths = 0;
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
    eventMonths = apuHourEvents(pot, horizonMonths, utilisation.apuHrPerMonth);
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

  // Working copy of the LLP stack — each part's life resets on harvest.
  let llps = llpEngineStart.llps.map(l => ({ ...l }));
  let baseFC = llpEngineStart.currentFC;
  let resetMonth = 0; // the month index at which baseFC was last established

  const monthlySeries = [];
  const events = [];
  const warnings = [];
  let balance = pot.openingBalance || 0;

  for (let m = 0; m <= horizonMonths; m++) {
    const date = addMonths(leaseStart, m);
    if (m > 0) balance += monthlyAccrual(pot, date, utilisation);

    const currentFC = baseFC + fcPerMonth * (m - resetMonth);
    const eng = { llps, currentFC };
    const vector = window.llpVector(eng);

    monthlySeries.push({ monthIndex: m, date, balance });

    if (!vector.length) continue;
    const limiter = vector.reduce((min, p) => (p.remainingFC < min.remainingFC ? p : min));

    if (limiter.remainingFC <= 0) {
      // Shop visit triggered. Harvest limiter + anything within
      // harvestThresholdFC of its own limit.
      const harvestSet = vector.filter(p => p.remainingFC <= pot.harvestThresholdFC);
      const harvestPNs = new Set(harvestSet.map(p => p.pn + "|" + p.sn));
      // llpVector() (Brain 2) only returns {desc,pn,sn,remainingFC,approvedLife} —
      // catalogPrice lives on the original llps records, so look it back up here.
      const harvestSetPriced = harvestSet.map(p => {
        const match = llps.find(l => l.pn === p.pn && l.sn === p.sn);
        return { ...p, catalogPrice: match ? match.catalogPrice : undefined };
      });

      // Guardrail check BEFORE resetting the stack (needs the pre-harvest vector).
      const warning = window.validateStubBuffer(eng, pot);
      if (warning && !warnings.includes(warning)) warnings.push(warning);

      const cost = escalatedCostRange(
        { ...pot, projectedCostLow: harvestCostEstimate(harvestSetPriced, "low"),
          projectedCostHigh: harvestCostEstimate(harvestSetPriced, "high") },
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
        harvestedParts: harvestSet.map(p => p.desc)
      });

      balance -= cost.likely;

      // Reset harvested parts to full life at this point in time.
      llps = llps.map(l => {
        if (harvestPNs.has(l.pn + "|" + l.sn)) {
          return { ...l, startFCRem: l.approvedLife, refFC: currentFC };
        }
        return l;
      });
      baseFC = currentFC;
      resetMonth = m;
    }
  }

  return { code: pot.code, label: pot.label, monthlySeries, events, partialFundedNote: null, warnings };
}

// Illustrative per-part catalogue cost estimate for a harvested set.
// Prefers p.catalogPrice if the caller supplied one (fabricated demo
// LLP stacks do). Real live-asset LLP records have NO cost field at
// all (TECH_DEBT.md — no per-part catalogue price table exists
// anywhere in the app), so for real parts this falls back to an
// ILLUSTRATIVE estimate sized off the part's real approvedLife — the
// dollar figure is fabricated, the life value it's scaled from is not.
const ILLUSTRATIVE_PRICE_PER_APPROVED_FC = 22; // $/approved-FC — fabricated constant, not sourced
function harvestCostEstimate(harvestSet, bound) {
  const multiplier = bound === "low" ? 0.92 : 1.08; // illustrative spread only
  return harvestSet.reduce((sum, p) => {
    const price = p.catalogPrice != null ? p.catalogPrice : p.approvedLife * ILLUSTRATIVE_PRICE_PER_APPROVED_FC;
    return sum + price * multiplier;
  }, 0);
}

window.projectReservePot = projectReservePot;
window.projectEnLpPot = projectEnLpPot;
window.escalateAnnual = escalateAnnual;
window.applyDerateModifier = applyDerateModifier;
