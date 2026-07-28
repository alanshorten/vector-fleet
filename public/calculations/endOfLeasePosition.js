// endOfLeasePosition.js — End of Lease Position: the money + the physical position.
//
// Spec: end-of-lease-position-handoff.md (Opus scoping session, July 2026)
// + eol-position-addendum.md (amendments: in-app view, KB integration,
// simplified trigger). Read both before touching this file.
//
// Pure. No UI, no Firebase, no window references, no KB lookups — this
// module receives already-resolved inputs (KB defaults + per-lease
// overrides already merged by the Body layer, same division of labour as
// fleetExposure.js and flyForward.js). Nothing here writes anywhere;
// nothing here is a saved figure — every number is a projection to a
// future date (the Expiry Date) and must be labelled as such by the caller.
//
// CRITICAL — do not weaken this rule (handoff §7, "the single most
// dangerous failure mode in this design"): if a part's delivery/
// installation FC baseline (`D`) is missing, the adjustment for that part
// is UNCOMPUTABLE. Never default a missing D to 0 — that would silently
// assert "brand new at delivery" and charge the lessee for cycles burned
// by a previous operator. Absent D must surface as a gap, not a guess.
//
// ---------------------------------------------------------------------
// SECTION 1 — The Money: End of Lease Maintenance Payment Adjustment
// ---------------------------------------------------------------------
//
// Per-part formula (handoff §2): (A / B) × (C − D)
//   A = 100% of manufacturer's catalogue price for that LLP, AT THE
//       EXPIRY DATE (a future date — escalated forward, not today's price)
//   B = bDenominatorPct (this lease: 95%) of approved life, in FC
//   C = engine FC since new, for that LLP, AT THE EXPIRY DATE (projected)
//   D = engine FC since new, for that LLP, AT DELIVERY (or at installation,
//       if fitted mid-lease via an LLP Replacement) — from the TAC, or
//       derived (D = current CSN − cycles flown since Delivery) for
//       leases that started after TailiQ went live
//
// Positive -> Lessee pays Lessor. Negative -> no payment by Lessor
// (asymmetric, in the lessor's favour — this is a ONE-WAY-MIRROR
// structure by default; `direction` flags if a specific lease differs,
// see §3 below).
//
// The notional pot balance at Expiry is applied against the total
// adjustment; the lessee pays the difference (handoff's own framing:
// "EOL LLP Adjustment ≈ (cycles flown this lease) × (catalogue-blended
// $/FC at Expiry ÷ 0.95) − notional account balance at Expiry").

// escalateToDate: forward-escalates a today-dated catalogue price to a
// future date at a given annual %. Caller-supplied so this module makes
// no assumption about which escalation function the app already has
// (flyForward.js's escalateAnnual does exactly this — reuse that one at
// the call site rather than duplicating it here).
function projectCataloguePriceAtExpiry(priceToday, escalationPctPerYr, todayDate, expiryDate, escalateAnnualFn) {
  // baseYear framing matches escalateAnnual's own signature (baseValue,
  // baseYear, targetDate, pctPerYr) — todayDate stands in as the "base
  // year" moment since priceToday is, by definition, today's catalogue.
  return escalateAnnualFn(priceToday, todayDate, expiryDate, escalationPctPerYr);
}

// Per-part EOL adjustment row. Returns `uncomputable: true` (never a
// silent 0) if D is missing — see the CRITICAL note above.
//
// part: {
//   pn, sn, desc,
//   approvedLife: number | null,        // Brain 2's approved-life field
//   catalogPriceToday: number | null,    // today's manufacturer catalogue price
//   deliveryBaselineFC: number | null,   // D — from TAC, or derived; NULL if unknown
// }
// ctx: {
//   currentFCAtExpiry: number,           // C — this part's engine FC-since-new, PROJECTED to Expiry
//   escalationPctPerYr: number,          // engine-family catalogue escalation rate
//   todayDate: Date, expiryDate: Date,
//   bDenominatorPct: number,             // e.g. 95 (this lease) — NOT hardcoded, per-lease/KB value
//   escalateAnnualFn: (base, baseDate, targetDate, pct) => number   // reuse flyForward.js's escalateAnnual
// }
function computePartEOLAdjustment(part, ctx) {
  const { currentFCAtExpiry, escalationPctPerYr, todayDate, expiryDate, bDenominatorPct, escalateAnnualFn } = ctx;

  if (part.deliveryBaselineFC === null || part.deliveryBaselineFC === undefined) {
    return {
      pn: part.pn, sn: part.sn, desc: part.desc,
      uncomputable: true,
      reason: "No delivery/installation FC baseline (D) on file for this part — needs a Technical Acceptance Certificate (or equivalent) before this adjustment can be computed. Do not assume D = 0."
    };
  }
  if (part.approvedLife === null || part.approvedLife === undefined) {
    return {
      pn: part.pn, sn: part.sn, desc: part.desc,
      uncomputable: true,
      reason: "No Approved Life on file for this part — the B denominator (approved life × " + bDenominatorPct + "%) can't be computed without it."
    };
  }
  if (part.catalogPriceToday === null || part.catalogPriceToday === undefined) {
    return {
      pn: part.pn, sn: part.sn, desc: part.desc,
      uncomputable: true,
      reason: "No catalogue price on file for this part — A can't be projected to the Expiry Date without a today's-price starting point."
    };
  }

  const A = projectCataloguePriceAtExpiry(part.catalogPriceToday, escalationPctPerYr, todayDate, expiryDate, escalateAnnualFn);
  const B = part.approvedLife * (bDenominatorPct / 100);
  const C = currentFCAtExpiry;
  const D = part.deliveryBaselineFC;
  const cyclesFlownThisLease = C - D;
  const ratePerFC = B > 0 ? A / B : 0;
  const adjustment = ratePerFC * cyclesFlownThisLease;

  return {
    pn: part.pn, sn: part.sn, desc: part.desc,
    uncomputable: false,
    A, B, C, D,
    cyclesFlownThisLease,
    ratePerFC,
    adjustment // positive = lessee owes; negative = no payment (asymmetric, never a refund — handoff §1.1)
  };
}

// Whole-engine (or whole-EN-LP-pot) rollup. One pot per engine, no schema
// change (handoff §2 — "the sub-accounts are an allocation, not a
// modelling requirement"): compute per-part, then sum.
//
// engineParts: [part, ...] — every LLP currently on this engine
// ctx: same shape as computePartEOLAdjustment's ctx, PLUS:
//   potBalanceAtExpiry: number — Brain 3's projected EN-LP pot balance
//     at the Expiry Date (read off the existing monthlySeries — this is
//     "Fly-Forward's own reserve projection tail," per the addendum,
//     not a new calculation)
//   direction: "one-way" | "two-way" | "zero-time"   — from
//     endOfLeaseTerms (handoff §8's market caveat — do NOT assume
//     one-way holds; this lease's structure must be read off the lease
//     doc, not hardcoded)
function computeEngineEOLAdjustment(engineParts, ctx) {
  const rows = engineParts.map(part => computePartEOLAdjustment(part, ctx));
  const uncomputableRows = rows.filter(r => r.uncomputable);
  if (uncomputableRows.length) {
    return {
      uncomputable: true,
      rows,
      message: `EOL position unavailable for ${uncomputableRows.length} of ${rows.length} part(s) — see individual reasons. No number is safer than a confident wrong one (handoff §7).`
    };
  }

  const grossAdjustment = rows.reduce((sum, r) => sum + r.adjustment, 0);

  // Direction flag (handoff §8) — this lease's structure decides whether
  // a negative gross adjustment ever becomes payable BY the lessor.
  // one-way (this lease's own structure, MSN 2717): negative -> lessee
  // owes nothing, lessor never pays. two-way: a negative figure would be
  // owed lessor-to-lessee. zero-time/full-life: different basis entirely,
  // out of scope for this formula — the caller should not reach this
  // function for a zero-time/full-life lease without its own review.
  const direction = ctx.direction || "one-way";
  let netPayableByLessee;
  if (direction === "one-way") {
    netPayableByLessee = Math.max(0, grossAdjustment - (ctx.potBalanceAtExpiry || 0));
  } else if (direction === "two-way") {
    netPayableByLessee = grossAdjustment - (ctx.potBalanceAtExpiry || 0); // can go negative -> owed the other way
  } else {
    return { uncomputable: true, rows, message: `Direction "${direction}" is not a one-way/two-way mirror — this formula doesn't apply as-is. Confirm the lease's actual EOL structure before proceeding (handoff §8).` };
  }

  return {
    uncomputable: false,
    rows,
    grossAdjustment,       // Σ(A/B)×(C−D) across every part — before the pot balance is applied
    potBalanceAtExpiry: ctx.potBalanceAtExpiry || 0,
    direction,
    netPayableByLessee,    // what's actually owed after the notional account is applied
    isProjection: true     // A is escalated to a FUTURE date — this is always a projection, never a settled figure (handoff §9)
  };
}

// ---------------------------------------------------------------------
// SECTION 2 — The Physical Position: life margins at redelivery
// ---------------------------------------------------------------------
//
// Only the three metrics TailiQ actually tracks (handoff §4). Facts, not
// verdicts, not prices — what the lease requires, what the asset will
// have, and the gap, in the condition's own units. Every figure here
// projects to the EXPIRY DATE (not the Redelivery Check's CRS — that's
// deliberately out of scope, handoff §4, "the pessimistic bound").
//
// margins: {
//   engineLLPMinFC,       // e.g. 1000 — clause 6.8
//   landingGearMinMonths, // e.g. 12   — clause 9.2 (equivalent-cycles check is a separate,
//                         //   already-existing dual-limiter calc — this module only carries
//                         //   the calendar-months margin; fold in the cycles side at the call site)
//   engineOnWingMinFH     // e.g. 3000 — clause 6.3, CAVEATED: real removal is a Lessor judgment
//                         //   call (borescope/trend monitoring), not pure arithmetic — label
//                         //   this a projection, never present it as the answer (handoff §4)
// }
// projected: {
//   engineLLPRemainingFCAtExpiry,   // lowest-limiter remaining FC, projected to Expiry
//   landingGearMonthsAtExpiry,      // months from Expiry to next scheduled LG removal
//   engineOnWingFHAtExpiry          // FH remaining to next EXPECTED removal, projected — a projection, not a measurement
// }
function buildPhysicalPositionChecks(margins, projected) {
  const checks = [];

  if (margins.engineLLPMinFC != null && projected.engineLLPRemainingFCAtExpiry != null) {
    const gap = projected.engineLLPRemainingFCAtExpiry - margins.engineLLPMinFC;
    checks.push({
      clause: "6.8",
      component: "Engine LLPs",
      requirement: `≥ ${margins.engineLLPMinFC.toLocaleString()} FC remaining to certified limit`,
      projectedValue: `${Math.round(projected.engineLLPRemainingFCAtExpiry).toLocaleString()} FC`,
      gap: gap >= 0 ? null : `Short by ${Math.round(Math.abs(gap)).toLocaleString()} FC`,
      status: gap >= 0 ? "ok" : "short",
      solid: true // arithmetic, no judgment call — handoff §4
    });
  }

  if (margins.landingGearMinMonths != null && projected.landingGearMonthsAtExpiry != null) {
    const gap = projected.landingGearMonthsAtExpiry - margins.landingGearMinMonths;
    checks.push({
      clause: "9.2",
      component: "Landing Gear",
      requirement: `≥ ${margins.landingGearMinMonths} months (+ equivalent cycles) to next scheduled removal`,
      projectedValue: `${projected.landingGearMonthsAtExpiry.toFixed(1)} months`,
      gap: gap >= 0 ? null : `Short by ${Math.abs(gap).toFixed(1)} months`,
      status: gap >= 0 ? "ok" : "short",
      solid: true
    });
  }

  if (margins.engineOnWingMinFH != null && projected.engineOnWingFHAtExpiry != null) {
    const gap = projected.engineOnWingFHAtExpiry - margins.engineOnWingMinFH;
    checks.push({
      clause: "6.3 / 6.4",
      component: "Engines (on-wing)",
      requirement: `≥ ${margins.engineOnWingMinFH.toLocaleString()} FH on-wing to next expected removal`,
      projectedValue: `${Math.round(projected.engineOnWingFHAtExpiry).toLocaleString()} FH`,
      gap: gap >= 0 ? null : `Short by ${Math.round(Math.abs(gap)).toLocaleString()} FH`,
      status: gap >= 0 ? "ok" : "short",
      // NOT solid — clause 6.4 makes the real removal a Lessor judgment
      // call (borescope, power assurance, trend monitoring), not pure
      // arithmetic. Caller must render this caveat visibly, never as a
      // plain fact (handoff §4's explicit instruction).
      solid: false,
      caveat: "Expected removal is a Lessor judgment call under clause 6.4 (borescope, power assurance, trend monitoring) — this is TailiQ's projection, not the answer."
    });
  }

  return {
    checks,
    outOfScopeNote: "This covers the life-limit conditions TailiQ tracks. Cabin condition, repairs, ADs, and MPD task status are not assessed and require physical inspection.",
    outOfScopeItems: [
      { clause: "4.1", component: "Airframe", reason: "MPD task list not held by TailiQ." },
      { clause: "8.1", component: "Hard-time parts", reason: "MPD hard-time parts list not held by TailiQ." },
      { clause: "10.2–10.3", component: "APU", reason: "Serviceable + borescope only — no life margin required in this lease; nothing to compute." }
    ]
  };
}

// ---------------------------------------------------------------------
// Main entry point — assembles both cards. Still assembly, same as the
// fleet exposure view (handoff §2: "No new data collection. No new
// Brain. This is assembly.").
// ---------------------------------------------------------------------
//
// input: {
//   engineParts: [part, ...],
//   moneyCtx: { currentFCAtExpiry, escalationPctPerYr, todayDate, expiryDate,
//               bDenominatorPct, escalateAnnualFn, potBalanceAtExpiry, direction },
//   margins: { engineLLPMinFC, landingGearMinMonths, engineOnWingMinFH },
//   projected: { engineLLPRemainingFCAtExpiry, landingGearMonthsAtExpiry, engineOnWingFHAtExpiry },
//   endOfLeaseApplies: boolean   // from endOfLeaseTerms.applies — some leases carry NO
//                                 // EOL adjustment at all; caller checks this before calling
// }
// output: { money: {...} | { uncomputable, message }, physical: {...} }
function buildEndOfLeasePosition(input) {
  const { engineParts, moneyCtx, margins, projected, endOfLeaseApplies = true } = input;

  const money = endOfLeaseApplies
    ? computeEngineEOLAdjustment(engineParts, moneyCtx)
    : { uncomputable: true, message: "This lease's endOfLeaseTerms marks no EOL adjustment as applicable — confirm against the lease schedule before assuming this is correct." };

  const physical = buildPhysicalPositionChecks(margins, projected);

  return { money, physical };
}

if (typeof window !== "undefined") {
  window.buildEndOfLeasePosition = buildEndOfLeasePosition;
  window.computeEngineEOLAdjustment = computeEngineEOLAdjustment;
  window.buildPhysicalPositionChecks = buildPhysicalPositionChecks;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { buildEndOfLeasePosition, computeEngineEOLAdjustment, computePartEOLAdjustment, buildPhysicalPositionChecks };
}
