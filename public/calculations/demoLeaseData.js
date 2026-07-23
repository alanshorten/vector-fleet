// ============================================================
// FLY-FORWARD DEMO — Fabricated Lease Terms
// NOT live data. NOT connected to Firestore or any real lease.
//
// This file holds ONLY the fabricated side of the Fly-Forward Demo:
// reserve-pot accrual rates, escalation regimes, triggers, outflow
// cost ranges, and opening balances — none of this exists in the
// live system yet (Layer 2 hasn't been built), so it's sourced from
// the test case worked through in the July 2026 Brain 3 scoping
// session (brain3-scoping-session-handoff.md): real Maintenance
// Payment Rate figures against a fabricated lease shape.
//
// Everything else the Fly-Forward Demo view needs — utilisation rate,
// engine/APU LLP stack, engine family (CFM vs V2500) — is pulled LIVE
// from a real asset the person selects in the UI (see FlyForwardDemo
// in index.html). Only the numbers in THIS file are fabricated.
//
// One thing in here is explicitly ILLUSTRATIVE even relative to the
// rest, flagged inline: EN-PR's outflow cost range — TECH_DEBT.md
// 4.20 confirms this figure was never supplied and needs a real
// per-asset entry.
// ============================================================

const DEMO_LEASE_TERMS = {
  horizonMonths: 144, // fabricated 12-year lease term, matches the AF-12Y interval so it fires once within horizon

  reservePots: [
    {
      code: "AF-6Y",
      label: "Airframe — 6-Year Structural Check",
      component: "airframe",
      accrualBasis: "per_month",
      accrualRate: 12500,
      accrualRateBaseYear: 2026,
      escalationRegime: "flat_annual",
      escalationPctPerYr: 2.5,
      derateModifier: null,
      openingBalance: 0,
      triggerBasis: "calendar_months",
      triggerInterval: { months: 72 },
      lastEventDate: null,
      projectedCostLow: 600000,
      projectedCostHigh: 900000,
      outflowCostBaseYear: 2026,
      outflowEscalationPct: 2.5
    },
    {
      code: "AF-12Y",
      label: "Airframe — 12-Year Structural Check",
      component: "airframe",
      accrualBasis: "per_month",
      accrualRate: 7200,
      accrualRateBaseYear: 2026,
      escalationRegime: "flat_annual",
      escalationPctPerYr: 2.5,
      derateModifier: null,
      openingBalance: 0,
      triggerBasis: "calendar_months",
      triggerInterval: { months: 144 },
      lastEventDate: null,
      projectedCostLow: 1200000,
      projectedCostHigh: 1800000,
      outflowCostBaseYear: 2026,
      outflowEscalationPct: 2.5
    },
    {
      code: "LG-OH",
      label: "Landing Gear Overhaul (single shipset)",
      component: "landing_gear",
      accrualBasis: "per_month",
      accrualRate: 3800,
      accrualRateBaseYear: 2026,
      escalationRegime: "flat_annual",
      escalationPctPerYr: 2.5,
      derateModifier: null,
      openingBalance: 0,
      triggerBasis: "calendar_or_cycles",
      triggerInterval: { months: 120, cycles: 20000 },
      lastEventDate: null,
      projectedCostLow: 350000,
      projectedCostHigh: 600000,
      outflowCostBaseYear: 2026,
      outflowEscalationPct: 2.5
    },
    {
      code: "AP-OH",
      label: "APU Overhaul",
      component: "apu",
      accrualBasis: "per_APU_hr",
      accrualRate: 48,
      accrualRateBaseYear: 2026,
      escalationRegime: "flat_annual",
      escalationPctPerYr: 2.5,
      derateModifier: null,
      openingBalance: 0,
      triggerBasis: "apu_hours",
      triggerInterval: { apuHours: [5000, 7000] },
      lastEventDate: null,
      projectedCostLow: 150000,
      projectedCostHigh: 350000,
      outflowCostBaseYear: 2026,
      outflowEscalationPct: 2.5
    }
  ],

  // EN-PR and EN-LP are TEMPLATES, not standalone pots — the app has two
  // physical engines (EN-PR ×2, EN-LP ×2 per VECTORIQ_ROADMAP.md Section 4),
  // so the Fly-Forward Demo clones one instance of each template per real
  // engine found on the asset (see FlyForwardDemo in index.html), setting
  // code/label/engine-family escalation dynamically rather than baking in
  // "-1"/"-2" or a specific engine family here. escalationPctPerYr and
  // outflowEscalationPct below are placeholders — the component overrides
  // them per asset using isCFM(asset) (6.07% CFM vs 10.53% V2500), since a
  // single fabricated lease-terms file can't know which family a given
  // real asset actually has.
  enginePotTemplates: {
    EN_PR: {
      label: "Engine Full Performance Restoration (illustrative interval + cost)",
      accrualBasis: "per_FH",
      accrualRate: 165, // at 10% derate baseline
      accrualRateBaseYear: 2026,
      escalationRegime: "catalogue",
      escalationPctPerYr: 10.53, // placeholder — overridden per asset via isCFM()
      derateModifier: { baseline: 10, actual: 10, pctPerPct: 1.5, capDerate: 15 }, // no adjustment for demo
      openingBalance: 0,
      triggerBasis: "calendar_or_cycles",
      // ILLUSTRATIVE — no confirmed EPR interval was supplied (TECH_DEBT.md 4.20 covers the cost gap;
      // the interval itself is also a placeholder here, not schedule-sourced).
      triggerInterval: { months: 96, cycles: 16000 },
      lastEventDate: null,
      // ILLUSTRATIVE — TECH_DEBT.md 4.20: this outflow figure was never supplied by the real test
      // case. Order-of-magnitude placeholder for a full performance restoration shop visit.
      projectedCostLow: 1200000,
      projectedCostLikely: 1500000,
      projectedCostHigh: 1900000,
      outflowCostBaseYear: 2026,
      outflowEscalationPct: 2.5 // outflow stream is flat 2.5% even for EN-PR — only EN-LP outflow uses catalogue
    },
    EN_LP: {
      label: "Engine LLP Replacement (stack simulation)",
      accrualBasis: "per_FC",
      accrualRate: 348.56, // placeholder current escalated "New Rate" — same caveat as escalationPctPerYr above
      accrualRateBaseYear: 2026,
      escalationRegime: "catalogue",
      escalationPctPerYr: 10.53, // placeholder — overridden per asset via isCFM()
      derateModifier: null,
      openingBalance: 0,
      triggerBasis: "llp_cycles", // handled by projectEnLpPot, not the generic dispatcher
      triggerInterval: null,
      lastEventDate: null,
      projectedCostLow: null, // computed dynamically per shop visit from the harvested-parts set
      projectedCostHigh: null,
      outflowCostBaseYear: 2026,
      outflowEscalationPct: 10.53, // placeholder — overridden per asset via isCFM(); harvested parts priced at future catalogue
      harvestThresholdFC: 2000,
      stubBufferPct: 10,
      // Full replacement cost of the ENTIRE tracked LLP stack, in today's
      // dollars — used to derive each harvested part's proportional cost
      // share (see harvestCostEstimate, flyForward.js), rather than an
      // arbitrary flat $/FC rate that could sum past this figure for a
      // partial harvest. EDITABLE — confirm the real figure per engine
      // type/asset; $6M is a placeholder order-of-magnitude default.
      fullStackReplacementCost: 6000000
    }
  }
};

window.DEMO_LEASE_TERMS = DEMO_LEASE_TERMS;
