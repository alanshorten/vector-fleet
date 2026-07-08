// ============================================================
// LLP Catalogue Prices — REAL data (not fabricated)
// Sourced from Engine_LLP_Escalation_Model.xlsx (uploaded July 2026),
// which tracks per-part list prices and year-over-year escalation for
// both engine families across 2023-2026.
//
// This REPLACES the fabricated fullStackReplacementCost guess used
// previously in the Fly-Forward Demo (which was a flat $6M placeholder)
// with real per-part pricing, matched by part number (P/N) against
// whatever LLPs are actually on a given real asset's engine record.
//
// escalationPctPerYr below is each family's own most recent (2025->2026)
// year-over-year escalation from the real schedule — matches the
// engine-family escalation already used elsewhere (CFM ~6.07%, V2500
// ~10.53%), now to more decimal places from the real source.
//
// fullStackTotal2026 is the sum of every tracked part's 2026 price —
// a REAL full-stack replacement cost, not an estimate. V2500's total
// ($6,974,550) matches closely with the ~$6M figure used as a
// placeholder before this data was available; CFM's real total
// ($6,752,200) turns out to be similar.
//
// Coverage caveat: these are the parts each source sheet tracked, not
// necessarily every LLP on every real asset's engine. Parts on a real
// asset with no P/N match here fall back to the proportional-share
// estimate against fullStackTotal2026 (see harvestCostEstimate,
// flyForward.js) rather than being silently priced at zero.
// ============================================================

const LLP_CATALOGUE_PRICES = {
  CFM: {
    baseYear: 2026,
    escalationPctPerYr: 6.0674,
    blendedRatePerFC2026: 295.80217829457365, // EN-LP's real accrual rate ($/FC) for this family
    parts: {
      "338-001-504-0": { desc: "FAN DISK", price: 462100 },
      "338-001-906-0": { desc: "BOOSTER SPOOL", price: 673600 },
      "338-010-601-0": { desc: "FAN SHAFT", price: 334800 },
      "1386M56P03": { desc: "FRONT SHAFT", price: 250400 },
      "1558M31G04": { desc: "STAGE 1-2 SPOOL", price: 357000 },
      "1590M59P01": { desc: "STAGE 3 DISK", price: 110700 },
      "1588M89G03": { desc: "STAGE 4-9 SPOOL", price: 788700 },
      "1523M35P01": { desc: "CDP REAR AIR SEAL", price: 151300 },
      "1873M73P01": { desc: "HPT FRONT SHAFT", price: 287600 },
      "2116M20P02": { desc: "HPT FRONT AIR SEAL", price: 601400 },
      "1498M43P07": { desc: "HPT DISC", price: 664800 },
      "1864M90P04": { desc: "HPT REAR SHAFT", price: 216700 },
      "336-001-804-0": { desc: "LPT STAGE 1 DISC", price: 240200 },
      "336-001-909-0": { desc: "LPT STAGE 2 DISC", price: 278600 },
      "336-002-006-0": { desc: "LPT STAGE 3 DISC", price: 273600 },
      "336-002-105-0": { desc: "LPT STAGE 4 DISC", price: 243100 },
      "340-301-702-0": { desc: "LPT ROTOR SUPPORT", price: 323800 },
      "338-010-005-0": { desc: "LPT SHAFT", price: 493800 }
    },
    fullStackTotal2026: 6752200
  },
  V2500: {
    baseYear: 2026,
    escalationPctPerYr: 10.5257,
    blendedRatePerFC2026: 345.476, // EN-LP's real accrual rate ($/FC) for this family
    parts: {
      "2A3423": { desc: "SEAL-AIR,HPT,1STG", price: 251720 },
      "2A3437": { desc: "PLATE-RTNG,BLADE,HPT,2STG", price: 177010 },
      "2A3923": { desc: "SEAL-AIR,HIGH PRESSURE TURBINE,1STAGE", price: 102980 },
      "2A4157": { desc: "SEAL-AIR,TURBINE,2STAGE", price: 333680 },
      "2A4802": { desc: "HUB-TURB,2STG", price: 425800 },
      "2A5001": { desc: "HUB-TURB,1STG", price: 551830 },
      "3A0963": { desc: "SEAL,AIR T3", price: 144200 },
      "3A1984": { desc: "DISK T4", price: 224940 },
      "3A1988": { desc: "Air Seal T6", price: 129340 },
      "3A2422": { desc: "Air Seal T4", price: 253550 },
      "3A2423": { desc: "Air Seal T5", price: 247770 },
      "3A2430": { desc: "DISK T5", price: 205570 },
      "3A2513": { desc: "DISK T3", price: 187380 },
      "3A2514": { desc: "DISK T7", price: 220790 },
      "3A2522": { desc: "Air Seal T7", price: 113610 },
      "3A2996": { desc: "DISK,TURBINE STG6", price: 300660 },
      "3A3047": { desc: "SEAL-AIR,TURBINE,INNER,STG6", price: 65030 },
      "5A0895": { desc: "SHAFT, ASSY STUB", price: 88780 },
      "5A1762": { desc: "SHAFT - LP", price: 227170 },
      "5A1948": { desc: "DISC ASSY OF-FAN,1STAGE", price: 366810 },
      "5R0159": { desc: "DISC ST 1.5-2.5 LPC", price: 612120 },
      "6A5869": { desc: "SEAL", price: 79270 },
      "6A7546": { desc: "DISC ASSY OF, STAGE 9 TO 12 - HP COMPRES", price: 850030 },
      "6B1404": { desc: "DRUM, ASSY OF, STAGE 3 TO 8", price: 521510 },
      "6B1419": { desc: "SHAFT, ASSY", price: 293000 }
    },
    fullStackTotal2026: 6974550
  }
};

// Looks up a part's REAL 2026 base-year catalogue price by exact P/N
// match within the given engine family. Returns null if not found —
// callers should fall back to the proportional-share estimate, not
// assume $0. Deliberately does NOT escalate to a future event date
// here — the caller assigns this as pot.projectedCostLow/High (base
// year 2026), and escalatedCostRange() in flyForward.js already
// escalates that to the actual event date using the pot's own
// outflowEscalationPct/outflowCostBaseYear. Escalating here too would
// double-count the escalation.
function lookupLLPCataloguePrice(pn, engineFamily) {
  const family = LLP_CATALOGUE_PRICES[engineFamily];
  if (!family) return null;
  const part = family.parts[pn];
  return part ? part.price : null;
}

window.LLP_CATALOGUE_PRICES = LLP_CATALOGUE_PRICES;
window.lookupLLPCataloguePrice = lookupLLPCataloguePrice;
