// ============================================================
// FLY-FORWARD DEMO — Fabricated Sample Dataset
// NOT live data. NOT connected to Firestore or any real asset.
//
// Sourced from the fully-populated test case worked through in the
// July 2026 Brain 3 scoping session (brain3-scoping-session-handoff.md):
// a fabricated lease shape (Onyx Leasing / Royal Air Maroc, for
// commercial-terms shape only) carrying REAL accrual rates from a
// Maintenance Payment Rate schedule and REAL market MRO outflow cost
// ranges, on a V2500-powered A320-family airframe (10.53% catalogue
// escalation).
//
// Two things in here are explicitly ILLUSTRATIVE, not schedule-sourced,
// and are flagged inline: (1) EN-PR's outflow cost range — TECH_DEBT.md
// 4.20 confirms this figure was never supplied and needs a real
// per-asset entry; (2) the EN-LP starting LLP stack (part names, P/Ns,
// S/Ns, individual remaining/approved life) — no real disk sheet was
// available for this demo, so a representative V2500 stack was
// constructed by hand to exercise the harvest simulation and the
// stub-buffer guardrail (TECH_DEBT.md 4.21).
// ============================================================

const DEMO_LEASE = {
  assetLabel: "DEMO — A320-family / V2500 (illustrative lease, not a real asset)",
  leaseStart: new Date(2024, 0, 1), // Jan 2024
  horizonMonths: 144, // 12-year lease, matches the AF-12Y interval so it fires once within horizon

  // Fabricated utilisation assumptions (no real Brain 1 data feeds this
  // demo). Ratio kept >= 2:1 FH:C per the rate schedule's own assumptions.
  utilisation: {
    fhPerMonth: 300,
    fcPerMonth: 145,
    apuHrPerMonth: 120
  },

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
    },
    {
      code: "EN-PR-1",
      label: "Engine Full Performance Restoration (illustrative interval + cost)",
      component: "engine_1",
      accrualBasis: "per_FH",
      accrualRate: 165, // at 10% derate baseline
      accrualRateBaseYear: 2026,
      escalationRegime: "catalogue",
      escalationPctPerYr: 10.53, // V2500 catalogue
      derateModifier: { baseline: 10, actual: 10, pctPerPct: 1.5, capDerate: 15 }, // no adjustment for demo
      openingBalance: 0,
      triggerBasis: "calendar_or_cycles",
      // ILLUSTRATIVE — no confirmed EPR interval was supplied (TECH_DEBT.md 4.20 covers the cost gap;
      // the interval itself is also a placeholder here, not schedule-sourced).
      triggerInterval: { months: 96, cycles: 16000 },
      lastEventDate: null,
      // ILLUSTRATIVE — TECH_DEBT.md 4.20: this outflow figure was never supplied by the real test
      // case. Order-of-magnitude placeholder for a V2500 full performance restoration shop visit.
      projectedCostLow: 1200000,
      projectedCostLikely: 1500000,
      projectedCostHigh: 1900000,
      outflowCostBaseYear: 2026,
      outflowEscalationPct: 2.5 // outflow stream is flat 2.5% even for EN-PR — only EN-LP outflow uses catalogue
    },
    {
      code: "EN-LP-1",
      label: "Engine LLP Replacement (stack simulation)",
      component: "engine_1",
      accrualBasis: "per_FC",
      accrualRate: 348.56, // current escalated "New Rate", V2500
      accrualRateBaseYear: 2026,
      escalationRegime: "catalogue",
      escalationPctPerYr: 10.53,
      catalogueRef: { engineFamily: "V2500", currentUnitRate: 345.48, lastCatalogueDate: "2026" },
      derateModifier: null,
      openingBalance: 0,
      triggerBasis: "llp_cycles", // handled by projectEnLpPot, not the generic dispatcher
      triggerInterval: null,
      lastEventDate: null,
      projectedCostLow: null, // computed dynamically per shop visit from the harvested-parts set
      projectedCostHigh: null,
      outflowCostBaseYear: 2026,
      outflowEscalationPct: 10.53, // harvested parts priced at future catalogue
      harvestThresholdFC: 2000,
      stubBufferPct: 10
    }
  ],

  // ILLUSTRATIVE V2500 LLP stack at lease start (no real disk sheet
  // available for this demo). refFC=0 for every part — currentFC below
  // is measured from the same zero point, so startFCRem IS the
  // remaining life at lease start. Built to exercise both a multi-cycle
  // harvest simulation AND the stub-buffer guardrail (see llpCalculator.js
  // validateStubBuffer, TECH_DEBT.md 4.21) — "HPC Disk Stage 3-8" is
  // deliberately given a shorter approvedLife than the others so the
  // 10% stubBufferPct above reads as under-funded against it.
  //
  // catalogPrice is a SEPARATE fabricated figure from EN-LP-1's
  // accrualRate ($348.56/FC) above — that rate is a BLENDED per-cycle
  // figure amortising the whole stack's replacement cost across cycles,
  // not a per-part price, and must not be multiplied by one part's
  // approvedLife (see harvestCostEstimate in flyForward.js). Each
  // part's catalogPrice here is an independent, illustrative dollar
  // figure only — order-of-magnitude for demo purposes.
  llpEngineStart: {
    currentFC: 0,
    llps: [
      { desc: "HPT Disk Stage 1", pn: "DEMO-P1", sn: "DEMO-S1", startFCRem: 3000, refFC: 0, approvedLife: 20000, catalogPrice: 450000 },
      { desc: "HPT Disk Stage 2", pn: "DEMO-P2", sn: "DEMO-S2", startFCRem: 5500, refFC: 0, approvedLife: 22000, catalogPrice: 420000 },
      { desc: "HPC Disk Stage 1-2", pn: "DEMO-P3", sn: "DEMO-S3", startFCRem: 15000, refFC: 0, approvedLife: 20000, catalogPrice: 380000 },
      { desc: "HPC Disk Stage 3-8", pn: "DEMO-P4", sn: "DEMO-S4", startFCRem: 12000, refFC: 0, approvedLife: 15000, catalogPrice: 340000 },
      { desc: "Fan Disk", pn: "DEMO-P5", sn: "DEMO-S5", startFCRem: 20000, refFC: 0, approvedLife: 32000, catalogPrice: 520000 },
      { desc: "LPT Disk Stage 1", pn: "DEMO-P6", sn: "DEMO-S6", startFCRem: 17000, refFC: 0, approvedLife: 25000, catalogPrice: 310000 },
      { desc: "LPT Disk Stage 2", pn: "DEMO-P7", sn: "DEMO-S7", startFCRem: 17500, refFC: 0, approvedLife: 25000, catalogPrice: 300000 }
    ]
  }
};

window.DEMO_LEASE = DEMO_LEASE;
