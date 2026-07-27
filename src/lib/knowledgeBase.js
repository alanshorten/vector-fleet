import { db } from './db';

// ============================================================
// Knowledge Base — Forecasting Defaults + LLP Catalogue
// Body-layer hierarchy logic (per knowledge-base-scoping-handoff.md §3):
//   tier 1: per-asset/per-pot/per-event override (already handled
//           upstream — LeaseWizard's `ex` merge, pots.js's `def`/saved
//           pot data, scheduledEvents' durationWeeks override)
//   tier 2: Knowledge Base company default (this file)
//   tier 3: code fallback (CODE_FALLBACK_DEFAULTS below)
// This file is the ONLY place tier 2 and tier 3 are decided — callers
// (pots.js, LeaseWizard.jsx, flyForwardHelpers.js, FlyForward.jsx) just
// ask "what's the band/duration for this code/family" and get a single
// already-resolved answer.
// ============================================================

// Hardcoded fallback — the same values that were previously implicit,
// unlabelled literals scattered across pots.js/FIXED_RESERVE_POT_DEFS
// and maintenanceCal.js's CHECK_TYPES. Used only when the company
// hasn't populated Knowledge Base defaults yet, so the app stays fully
// functional pre-population.
const CODE_FALLBACK_DEFAULTS = {
  outflowEscalationPct: 2.5,
  checkCostBands: {
    "AF-6Y": { low: 600000, high: 900000 },
    "AF-12Y": { low: 1200000, high: 1800000 },
    "LG-OH": { low: 350000, high: 600000 },
    "AP-OH": { low: 150000, high: 350000 }
  },
  enPrBandsByFamily: {
    CFM: { intervalFH: 10000, costLow: 1200000, costHigh: 1600000 },
    V2500: { intervalFH: 6000, costLow: 1400000, costHigh: 1800000 }
  },
  llpEscalationPctByFamily: { CFM: 6.07, V2500: 10.53 },
  // Matches maintenanceCal.js's CHECK_TYPES[].defaultDurationWeeks
  // (2/6/12 Year Check) exactly — these are the values Brain 6 used
  // before durationDefaults was ever populated by anything.
  checkDurationWeeks: { "2Y": 2, "6Y": 4, "12Y": 8 }
};

let cachedKB = null;
let cachedCatalogue = null;

// Populates window.LLP_CATALOGUE_PRICES and window.lookupLLPCataloguePrice
// from the Knowledge Base — call once on app load (App.jsx), alongside
// loadAssets. Brain 3 (flyForward.js) and pots.js already read these two
// globals defensively (both fall back to estimation tiers / hardcoded
// defaults if never populated), so this is additive, not a breaking
// dependency — the app works identically to before if this never runs.
//
// Note: checkDurationWeeks is deliberately NOT put on a window global —
// unlike the LLP catalogue globals, Brain 6 (maintenanceCal.js) takes
// durationDefaults as an explicit input parameter, not a window lookup
// (it's written to have zero window.* dependencies). getCheckDurationDefaults()
// below is called directly by the Body-layer caller (flyForwardHelpers.js)
// and passed in as that parameter instead.
async function bootstrapKnowledgeBaseGlobals(companyId = null) {
  const [kb, catalogue] = await Promise.all([
    db.getKnowledgeBase(companyId).catch(() => null),
    db.getLLPCatalogue(companyId).catch(() => [])
  ]);
  cachedKB = kb;
  cachedCatalogue = catalogue;

  const prices = {};
  ["CFM", "V2500"].forEach(fam => {
    const partsInFamily = catalogue.filter(p => p.engineFamily === fam);
    const fullStackTotal = partsInFamily.length
      ? partsInFamily.reduce((s, p) => s + (p.unitPrice || 0), 0)
      : null;
    const catalogueYear = partsInFamily[0]?.catalogueYear ?? null;
    prices[fam] = {
      escalationPctPerYr: kb?.llpEscalationPctByFamily?.[fam]
        ?? CODE_FALLBACK_DEFAULTS.llpEscalationPctByFamily[fam],
      blendedRatePerFC2026: kb?.llpBlendedRatePerFCByFamily?.[fam] ?? null,
      fullStackTotal2026: fullStackTotal,
      baseYear: catalogueYear
    };
  });
  window.LLP_CATALOGUE_PRICES = prices;

  window.lookupLLPCataloguePrice = (partNumber, engineFamily) => {
    if (!cachedCatalogue) return null;
    const match = cachedCatalogue.find(p => p.partNumber === partNumber && p.engineFamily === engineFamily);
    return match ? match.unitPrice : null;
  };
}

// Three-tier lookups for Forecasting Defaults consumers (LeaseWizard
// pre-fill, pots.js, flyForwardHelpers.js). Never throw, never return
// undefined — always a usable value even before the Knowledge Base has
// ever been populated (falls straight to CODE_FALLBACK_DEFAULTS) or
// before bootstrapKnowledgeBaseGlobals has resolved for this session.
function getCheckCostBand(code) {
  return cachedKB?.checkCostBands?.[code] ?? CODE_FALLBACK_DEFAULTS.checkCostBands[code] ?? null;
}
function getEnPrBand(engineFamily) {
  return cachedKB?.enPrBandsByFamily?.[engineFamily] ?? CODE_FALLBACK_DEFAULTS.enPrBandsByFamily[engineFamily] ?? null;
}
function getOutflowEscalationPct() {
  return cachedKB?.outflowEscalationPct ?? CODE_FALLBACK_DEFAULTS.outflowEscalationPct;
}
// Returns { "2Y": weeks, "6Y": weeks, "12Y": weeks } — shaped exactly as
// maintenanceCal.js's durationDefaults input expects, per-key fallback
// so a KB doc that only overrides e.g. "6Y" still gets sane values for
// "2Y"/"12Y" rather than losing them.
function getCheckDurationDefaults() {
  return {
    "2Y": cachedKB?.checkDurationWeeks?.["2Y"] ?? CODE_FALLBACK_DEFAULTS.checkDurationWeeks["2Y"],
    "6Y": cachedKB?.checkDurationWeeks?.["6Y"] ?? CODE_FALLBACK_DEFAULTS.checkDurationWeeks["6Y"],
    "12Y": cachedKB?.checkDurationWeeks?.["12Y"] ?? CODE_FALLBACK_DEFAULTS.checkDurationWeeks["12Y"]
  };
}
function getKnowledgeBaseSnapshot() {
  return cachedKB;
}

export {
  bootstrapKnowledgeBaseGlobals,
  getCheckCostBand,
  getEnPrBand,
  getOutflowEscalationPct,
  getCheckDurationDefaults,
  getKnowledgeBaseSnapshot,
  CODE_FALLBACK_DEFAULTS
};
