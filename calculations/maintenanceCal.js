// maintenanceCal.js — Brain 6: Maintenance Calendar Engine
//
// Pure function. No UI, no Firebase, no imports from index.html — Brain/Body
// separation, same pattern as Brains 1/2/3 (utilisation.js, llpCalculator.js,
// flyForward.js). Spec: brain6-build-handoff.md, TECH_DEBT.md 4.38,
// VECTORIQ_ROADMAP.md Sections 4/5/10 (Opus scoping session, July 2026).
//
// It is a FINANCIAL-PROJECTION INPUT, not a maintenance-tracking tool.
// Precision is deliberately loose (decision 7): real utilisation reports
// self-correct drift, so a check projected for April that actually runs
// June just means April/May ingest as flying and June/July as grounded.
//
// Two-pass wiring (agreed in scoping, see F4): APU/EN-LP/EN-PR/LG-OH dates
// are DERIVED BY BRAIN 3, not by Brain 6 (Section 5 build notes — Brain 6
// reads those forward projections rather than recalculating). So the
// caller runs a first Fly-Forward pass (ungrounded) to get those dates,
// passes them in here as `nonGroundingEvents`, and this function adds the
// C-check-driven grounding + the full calendar. A second Fly-Forward pass
// then consumes `groundingAvailability` for accurate accrual. No feedback
// loop — grounding never depends on anything Brain 3 computes.

// ---------------------------------------------------------------------
// Local date helpers — deliberately self-contained (no window.* lookups)
// so this file has no load-order dependency on index.html.
// ---------------------------------------------------------------------

// App-wide date convention is DD/MM/YYYY (see extraction prompt / AddCheckRow).
function parseDMY(str) {
  if (!str || typeof str !== "string") return null;
  const m = str.trim().match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (!m) return null;
  const day = +m[1], mon = +m[2], year = +m[3];
  if (mon < 1 || mon > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, mon - 1, day));
  return isNaN(date.getTime()) ? null : date;
}

function addMonths(date, n) {
  const d = new Date(date.getTime());
  d.setUTCMonth(d.getUTCMonth() + n);
  return d;
}

function addDays(date, n) {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

function daysInMonth(year, monthIndex0) {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}

// Whole-calendar-month overlap (in days) between [aStart,aEnd) and the
// calendar month containing `monthDate` (which is always the 1st, since
// callers derive it via addMonths(leaseStart, m) on a UTC leaseStart).
function daysOverlapWithMonth(windowStart, windowEnd, monthDate) {
  const y = monthDate.getUTCFullYear();
  const mo = monthDate.getUTCMonth();
  const monthStart = new Date(Date.UTC(y, mo, 1));
  const monthEnd = new Date(Date.UTC(y, mo + 1, 1));
  const start = windowStart > monthStart ? windowStart : monthStart;
  const end = windowEnd < monthEnd ? windowEnd : monthEnd;
  const overlapMs = end.getTime() - start.getTime();
  return overlapMs > 0 ? overlapMs / 86400000 : 0;
}

function monthsBetween(a, b) {
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
}

// ---------------------------------------------------------------------
// C-check config. Interval defines what "2/6/12 Year Check" IS — not
// user-tunable. Duration is the only editable assumption (decision 4),
// seeded here as the default (TECH_DEBT.md 4.38 §3.3).
// ---------------------------------------------------------------------

const CHECK_TYPES = [
  { name: "2 Year Check", code: "AF-2Y", intervalMonths: 24, defaultDurationWeeks: 2, hasPot: false },
  { name: "6 Year Check", code: "AF-6Y", intervalMonths: 72, defaultDurationWeeks: 4, hasPot: true },
  { name: "12 Year Check", code: "AF-12Y", intervalMonths: 144, defaultDurationWeeks: 8, hasPot: true }
];

// ---------------------------------------------------------------------
// Step 1 — resolve each check type's anchor (first occurrence) date from
// asset.checks, or flag the dataCompleteness gap (build-start item #2).
// ---------------------------------------------------------------------

function resolveAnchor(checkType, checksArray) {
  const entry = (checksArray || []).find(c => c && c.name === checkType.name);
  if (!entry) {
    return {
      anchorDate: null,
      gap: {
        code: checkType.code,
        severity: checkType.hasPot ? "medium" : "high",
        message: `"${checkType.name}" is not present on this asset's checks list — Brain 6 has no date source for it and will surface no grounding for this check until it's added.`
      }
    };
  }
  const next = parseDMY(entry.nextDate);
  if (next) return { anchorDate: next, gap: null };

  const last = parseDMY(entry.lastDate);
  if (last) return { anchorDate: addMonths(last, checkType.intervalMonths), gap: null };

  return {
    anchorDate: null,
    gap: {
      code: checkType.code,
      severity: checkType.hasPot ? "medium" : "high",
      message: `"${checkType.name}" is on file but has no usable nextDate or lastDate — Brain 6 has no date to ground from, so utilisation for this asset is overstated until a real date is entered.${!checkType.hasPot ? " This check has no reserve pot, so asset.checks is its only possible source." : ""}`
    }
  };
}

// ---------------------------------------------------------------------
// Step 2 — generate occurrences forward from the anchor, through the
// horizon PLUS one extra occurrence (decision 8: lookahead surfaces the
// first occurrence into the next lease, a step beyond Brain 3's
// lease-end-with-partial-funding horizon).
// ---------------------------------------------------------------------

function generateOccurrences(checkType, anchorDate, leaseStart, horizonMonths) {
  if (!anchorDate) return [];
  const occurrences = [];
  let date = anchorDate;
  let dueCycle = 1;
  const horizonEndOffset = horizonMonths;
  while (true) {
    const offset = monthsBetween(leaseStart, date) + (date.getUTCDate() - leaseStart.getUTCDate()) / 30.44;
    occurrences.push({ code: checkType.code, dueCycle, date, beyondHorizon: offset > horizonEndOffset });
    if (offset > horizonEndOffset) break; // include the first one past the horizon, then stop
    date = addMonths(date, checkType.intervalMonths);
    dueCycle++;
    if (dueCycle > 200) break; // sanity guard against a malformed interval
  }
  return occurrences;
}

// ---------------------------------------------------------------------
// Step 3 — apply overrides (identity key = code + dueCycle). airline-stated
// is sticky and wins outright over both derived and seasonality (3.4).
// durationWeeks is an independent editable field — applies regardless of
// the date's source flag.
// ---------------------------------------------------------------------

function findOverride(overrides, code, dueCycle) {
  return (overrides || []).find(o => o.code === code && o.dueCycle === dueCycle) || null;
}

// NOTE on override.scheduledDate format: unlike asset.checks (legacy
// free-form DD/MM/YYYY text), scheduledEvents is a new schema with no
// existing text-format convention to inherit. It's expected as an ISO
// string or Date — same as every other date this module receives
// (leaseStart, nonGroundingEvents[].date) — converted upstream by the
// input-assembly layer from whatever Firestore Timestamp shape it's
// stored as, exactly like ctx.leaseStart is already a Date by the time
// flyForward.js sees it.

function resolveDate(defaultDate, override) {
  if (override && override.source === "airline-stated" && override.scheduledDate) {
    return { date: new Date(override.scheduledDate), source: "airline-stated" };
  }
  if (override && override.scheduledDate) {
    return { date: new Date(override.scheduledDate), source: override.source || "seasonality" };
  }
  return { date: defaultDate, source: "derived" };
}

// ---------------------------------------------------------------------
// Step 4 — seasonality suggestion (flag-and-accept, never auto-move, 3.4).
// Only ever suggests a date EARLIER than the hard due-limiter, never later.
// Only computed for C-checks (check-*placement* per 3.4's literal scope);
// only offered when nothing has already been accepted (no override yet).
// ---------------------------------------------------------------------

function suggestSeasonalPlacement(dueDate, seasonalityProfile) {
  if (!seasonalityProfile || !seasonalityProfile.monthlyWeightings) return null;
  const weightings = seasonalityProfile.monthlyWeightings;
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const values = monthNames.map(n => weightings[n]).filter(v => typeof v === "number");
  if (values.length < 12) return null; // incomplete profile — don't guess
  const avg = values.reduce((a, b) => a + b, 0) / values.length;

  // Look back up to 2 months from the due date (never forward — can only
  // pull earlier than the hard due-limiter).
  let best = null;
  for (let back = 1; back <= 2; back++) {
    const candidate = addMonths(dueDate, -back);
    const w = weightings[monthNames[candidate.getUTCMonth()]];
    if (typeof w === "number" && w < avg && (!best || w < best.weighting)) {
      best = { date: candidate, weighting: w };
    }
  }
  const dueWeighting = weightings[monthNames[dueDate.getUTCMonth()]];
  if (!best || typeof dueWeighting !== "number" || best.weighting >= dueWeighting) return null;

  return {
    suggestedDate: best.date,
    reason: `${monthNames[best.date.getUTCMonth()]} runs lower utilisation (${best.weighting}%) than the due month (${dueWeighting}%) per this asset's seasonality profile.`
  };
}

// ---------------------------------------------------------------------
// Step 5 — concurrency: longest-event-wins, not additive (decision 3 /
// 3.5). A 6Y/12Y coincidence collapses into one combined grounding
// window; generalised to any overlap so it isn't a special case wired
// only for that one pair. Deliberately conservative: takes the EARLIEST
// start in an overlapping cluster and the LONGEST duration in it, which
// never understates the grounding window.
// ---------------------------------------------------------------------

function mergeGroundingWindows(rawEvents) {
  const sorted = [...rawEvents].sort((a, b) => a.groundingStart - b.groundingStart);
  const clusters = [];
  for (const evt of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && evt.groundingStart <= last.mergedEnd) {
      last.codes.push({ code: evt.code, dueCycle: evt.dueCycle });
      last.durationWeeks = Math.max(last.durationWeeks, evt.durationWeeks);
      last.mergedEnd = addDays(last.mergedStart, last.durationWeeks * 7);
    } else {
      clusters.push({
        mergedStart: evt.groundingStart,
        durationWeeks: evt.durationWeeks,
        mergedEnd: addDays(evt.groundingStart, evt.durationWeeks * 7),
        codes: [{ code: evt.code, dueCycle: evt.dueCycle }]
      });
    }
  }
  return clusters;
}

// ---------------------------------------------------------------------
// Step 6 — monthly availability vector, keyed identically to Brain 3's
// month loop (m = 0..horizonMonths, monthDate = addMonths(leaseStart,m)).
// Fractional (per Q1 resolution): counts actual grounded days in each
// calendar month rather than zeroing the whole month, since the mandated
// golden fixture (46wk flying / 6wk grounded = 3,220 FC) only holds when
// a grounding window that spans a month boundary is split proportionally.
// Falls back to the same math against DERIVED (not just real/
// airline-stated) dates when exact in/out dates aren't available —
// company-specific real dates, when supplied, just feed the same
// calculation with tighter inputs.
// ---------------------------------------------------------------------

function computeGroundingAvailability(mergedWindows, leaseStart, horizonMonths) {
  const availability = [];
  for (let m = 0; m <= horizonMonths; m++) {
    const monthDate = addMonths(leaseStart, m);
    const totalDaysInMonth = daysInMonth(monthDate.getUTCFullYear(), monthDate.getUTCMonth());
    let groundedDays = 0;
    for (const win of mergedWindows) {
      groundedDays += daysOverlapWithMonth(win.mergedStart, win.mergedEnd, monthDate);
    }
    const fraction = Math.min(1, groundedDays / totalDaysInMonth);
    availability.push({ monthIndex: m, availability: Math.max(0, 1 - fraction) });
  }
  return availability;
}

// ---------------------------------------------------------------------
// Step 7 — cost join: read-time join by identity to shopVisitProjections
// (3.1). No stored FK — shopVisitProjections is append-only and 0..n per
// event, so this matches by code + nearest projectedDate within tolerance,
// preferring the most recently calculated doc when several are equally
// near (append-only log, never overwritten). AF-2Y always joins to the
// empty set (no pot) — correct shape for a downtime-only event, not a gap.
// ---------------------------------------------------------------------

function joinCostProjection(code, dueDate, costProjections, toleranceMonths) {
  const candidates = (costProjections || [])
    .filter(p => p.code === code)
    .map(p => ({ ...p, deltaMonths: Math.abs(monthsBetween(dueDate, new Date(p.projectedDate))) }))
    .filter(p => p.deltaMonths <= toleranceMonths);
  if (!candidates.length) return null;
  candidates.sort((a, b) => {
    if (a.deltaMonths !== b.deltaMonths) return a.deltaMonths - b.deltaMonths;
    return new Date(b.calculatedAt || 0) - new Date(a.calculatedAt || 0);
  });
  const best = candidates[0];
  return {
    matched: true,
    projectedCostLow: best.projectedCostLow,
    projectedCostLikely: best.projectedCostLikely,
    projectedCostHigh: best.projectedCostHigh,
    deltaMonths: best.deltaMonths
  };
}

// ---------------------------------------------------------------------
// Main entry point.
// ---------------------------------------------------------------------
//
// input: {
//   leaseStart: Date,
//   horizonMonths: number,
//   checks: asset.checks[]  (raw — {name,lastDate,nextDate,lastFH,lastFC})
//   nonGroundingEvents: [{ code, label, dueCycle, date, enginePosition? }]
//     — pre-derived by the caller's first (ungrounded) Fly-Forward pass for
//       LG-OH / AP-OH / EN-PR-n / EN-LP-n. Optional, defaults to [].
//   overrides: [{ code, dueCycle, durationWeeks?, scheduledDate?, source }]
//     — scheduledEvents docs. Optional, defaults to [].
//   seasonalityProfile: { monthlyWeightings, activeWeeksPerYear, patternDetected } | null
//   costProjections: [{ code, projectedDate, projectedCostLow, projectedCostLikely,
//                        projectedCostHigh, calculatedAt }]
//     — shopVisitProjections-shaped. Optional, defaults to [].
//   costJoinToleranceMonths: number, default 3 (agreed with Alan)
//   durationDefaults: { "2Y": weeks, "6Y": weeks, "12Y": weeks } override of
//     the built-in 2/4/8 defaults, optional.
// }
//
// output: {
//   events: [{ code, label, dueCycle, date, source, grounding, durationWeeks,
//              groundingStart, groundingEnd, mergedWithCodes, seasonalitySuggestion,
//              cost, beyondHorizon }],
//   groundingAvailability: [{ monthIndex, availability }],   // m = 0..horizonMonths
//   mergedGroundingWindows: [{ start, end, durationWeeks, codes }],
//   dataCompleteness: [{ code, severity, message }]
// }

function buildMaintenanceCalendar(input) {
  const {
    leaseStart,
    horizonMonths,
    checks = [],
    nonGroundingEvents = [],
    overrides = [],
    seasonalityProfile = null,
    costProjections = [],
    costJoinToleranceMonths = 3,
    durationDefaults = {}
  } = input;

  const dataCompleteness = [];
  const rawGroundingEvents = []; // for merge step
  const cCheckEvents = [];

  for (const checkType of CHECK_TYPES) {
    const { anchorDate, gap } = resolveAnchor(checkType, checks);
    if (gap) dataCompleteness.push(gap);
    if (!anchorDate) continue;

    const occurrences = generateOccurrences(checkType, anchorDate, leaseStart, horizonMonths);
    for (const occ of occurrences) {
      const override = findOverride(overrides, occ.code, occ.dueCycle);
      const { date: resolvedDate, source } = resolveDate(occ.date, override);

      const durationKey = checkType.code === "AF-2Y" ? "2Y" : checkType.code === "AF-6Y" ? "6Y" : "12Y";
      const durationWeeks = (override && typeof override.durationWeeks === "number")
        ? override.durationWeeks
        : (typeof durationDefaults[durationKey] === "number" ? durationDefaults[durationKey] : checkType.defaultDurationWeeks);

      const groundingStart = resolvedDate;
      const groundingEnd = addDays(resolvedDate, durationWeeks * 7);

      const seasonalitySuggestion = (!override || override.source !== "airline-stated")
        ? suggestSeasonalPlacement(resolvedDate, seasonalityProfile)
        : null;

      const cost = checkType.hasPot
        ? joinCostProjection(occ.code, resolvedDate, costProjections, costJoinToleranceMonths)
        : null;

      const eventRecord = {
        code: occ.code,
        label: checkType.name,
        dueCycle: occ.dueCycle,
        date: resolvedDate,
        source,
        grounding: true,
        durationWeeks,
        groundingStart,
        groundingEnd,
        mergedWithCodes: [], // filled in after merge step
        seasonalitySuggestion,
        cost,
        beyondHorizon: occ.beyondHorizon
      };
      cCheckEvents.push(eventRecord);
      rawGroundingEvents.push({ code: occ.code, dueCycle: occ.dueCycle, groundingStart, durationWeeks });
    }
  }

  const mergedGroundingWindows = mergeGroundingWindows(rawGroundingEvents);

  // Annotate each C-check event with the other codes it was merged with,
  // for display ("this 6Y is absorbed into the 12Y's downtime").
  for (const evt of cCheckEvents) {
    const cluster = mergedGroundingWindows.find(c => c.codes.some(x => x.code === evt.code && x.dueCycle === evt.dueCycle));
    if (cluster) {
      evt.mergedWithCodes = cluster.codes.filter(x => !(x.code === evt.code && x.dueCycle === evt.dueCycle));
    }
  }

  const groundingAvailability = computeGroundingAvailability(mergedGroundingWindows, leaseStart, horizonMonths);

  // Pass through non-grounding events (LG-OH/AP-OH/EN-PR/EN-LP), joining
  // cost the same way. Overrides apply generically by code+dueCycle here
  // too (e.g. an airline-stated engine removal date), but seasonality
  // suggestion is deliberately NOT computed for these — 3.4 scopes
  // check-*placement* suggestions to C-checks only.
  const nonGroundingResolved = nonGroundingEvents.map(evt => {
    const override = findOverride(overrides, evt.code, evt.dueCycle);
    const { date: resolvedDate, source } = resolveDate(evt.date, override);
    const durationWeeks = (override && typeof override.durationWeeks === "number") ? override.durationWeeks : null;
    return {
      code: evt.code,
      label: evt.label,
      dueCycle: evt.dueCycle,
      date: resolvedDate,
      source: override ? source : "derived",
      grounding: false,
      durationWeeks, // negligible/none by default (decision 2) — no default seeded
      groundingStart: null,
      groundingEnd: null,
      mergedWithCodes: [],
      seasonalitySuggestion: null,
      cost: joinCostProjection(evt.code, resolvedDate, costProjections, costJoinToleranceMonths),
      beyondHorizon: monthsBetween(leaseStart, resolvedDate) > horizonMonths,
      enginePosition: evt.enginePosition
    };
  });

  const events = [...cCheckEvents, ...nonGroundingResolved].sort((a, b) => a.date - b.date);

  return {
    events,
    groundingAvailability,
    mergedGroundingWindows: mergedGroundingWindows.map(c => ({
      start: c.mergedStart,
      end: c.mergedEnd,
      durationWeeks: c.durationWeeks,
      codes: c.codes
    })),
    dataCompleteness
  };
}

window.buildMaintenanceCalendar = buildMaintenanceCalendar;
// Exposed individually for the Node test harness / future UI reuse —
// same pattern as flyForward.js exposing escalateAnnual, monthsBetween, etc.
window.mergeGroundingWindows = mergeGroundingWindows;
window.computeGroundingAvailability = computeGroundingAvailability;
window.joinCostProjection = joinCostProjection;
window.suggestSeasonalPlacement = suggestSeasonalPlacement;
