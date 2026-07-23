import { isCFM } from './assetHelpers';

const FIXED_RESERVE_POT_DEFS = [
  { code: "AF-6Y", label: "Airframe 6-Year Check", potCategory: "fixed", accrualBasis: "per_month",
    triggerBasis: "calendar_months", triggerInterval: { months: 72 },
    escalationRegime: "flat_annual", outflowEscalationPct: 2.5,
    defaultCostLow: 600000, defaultCostHigh: 900000 },
  { code: "AF-12Y", label: "Airframe 12-Year Check", potCategory: "fixed", accrualBasis: "per_month",
    triggerBasis: "calendar_months", triggerInterval: { months: 144 },
    escalationRegime: "flat_annual", outflowEscalationPct: 2.5,
    defaultCostLow: 1200000, defaultCostHigh: 1800000 },
  { code: "AP-OH", label: "APU Overhaul", potCategory: "fixed", accrualBasis: "per_APU_hr",
    triggerBasis: "apu_hours", triggerInterval: { apuHours: [5000, 7000] },
    escalationRegime: "flat_annual", outflowEscalationPct: 2.5,
    defaultCostLow: 150000, defaultCostHigh: 350000 },
  { code: "LG-OH", label: "Landing Gear Overhaul", potCategory: "fixed", accrualBasis: "per_month",
    triggerBasis: "calendar_or_cycles", triggerInterval: { months: 120, cycles: 20000 },
    escalationRegime: "flat_annual", outflowEscalationPct: 2.5,
    defaultCostLow: 350000, defaultCostHigh: 600000 }
];

const EN_PR_FAMILY_DEFAULTS = {
  CFM: { intervalFH: 10000, costLow: 1200000, costHigh: 1600000 },
  V2500: { intervalFH: 6000, costLow: 1400000, costHigh: 1800000 }
};

function buildRealEnginePotDefs(asset) {
  const cfm = isCFM(asset);
  const engineFamily = cfm ? "CFM" : "V2500";
  const familyCatalogue = window.LLP_CATALOGUE_PRICES?.[engineFamily];
  const prDefaults = EN_PR_FAMILY_DEFAULTS[engineFamily];
  const catalogueEsc = familyCatalogue?.escalationPctPerYr ?? 2.5;
  const engines = (asset.engines || []).filter(e => e.sn && String(e.sn).trim());
  const defs = [];
  engines.forEach(e => {
    const pos = e.position;
    defs.push({
      code: `EN-PR-${pos}`, label: `Engine #${pos} Performance Restoration (ESN ${e.sn})`,
      potCategory: "engine", enginePosition: pos, accrualBasis: "per_FH",
      triggerBasis: "engine_fh", triggerInterval: { fh: prDefaults.intervalFH },
      escalationRegime: "catalogue", outflowEscalationPct: catalogueEsc,
      defaultCostLow: prDefaults.costLow, defaultCostHigh: prDefaults.costHigh,
      catalogueRef: { engineFamily, currentUnitRate: null, lastCatalogueDate: familyCatalogue?.baseYear ?? null },
      anchorMode: "infer" // "infer" (from openingBalance/accrualRate) or "manual" (lastPRDate) — see PotRow
    });
    if (e.llps && e.llps.length) {
      defs.push({
        code: `EN-LP-${pos}`, label: `Engine #${pos} Life-Limited Parts (ESN ${e.sn})`,
        potCategory: "engine", enginePosition: pos, accrualBasis: "per_FC",
        triggerBasis: "llp_cycles",
        escalationRegime: "catalogue", outflowEscalationPct: catalogueEsc,
        catalogueRef: { engineFamily, currentUnitRate: familyCatalogue?.blendedRatePerFC2026 ?? null, lastCatalogueDate: familyCatalogue?.baseYear ?? null },
        defaultHarvestThresholdFC: 2000, defaultStubBufferPct: 10,
        fullStackReplacementCost: familyCatalogue?.fullStackTotal2026 ?? null,
        engineFamily
      });
    }
  });
  return defs;
};

async function validatePotWithAI(pot, asset) {
  const cfm = isCFM(asset);
  const engineFamily = cfm ? "CFM" : "V2500";
  const catalogue = window.LLP_CATALOGUE_PRICES?.[engineFamily];

  // Deterministic check FIRST, for pots where we already have a real
  // reference number — an LLM round-trip is the wrong tool for a check
  // that's really just arithmetic, and shouldn't be the only thing
  // standing between a wildly wrong figure and Brain 3. Only EN-LP has
  // a directly comparable known rate (the blended $/FC catalogue rate);
  // EN-PR's known figures are lump-sum restoration costs (Section 4),
  // which don't translate to an expected $/FH accrual rate without
  // knowing the shop-visit interval — so EN-PR still relies on the AI
  // check below only.
  if (pot.code && pot.code.startsWith("EN-LP") && catalogue?.blendedRatePerFC2026 && pot.accrualRate > 0) {
    const known = catalogue.blendedRatePerFC2026;
    const ratio = pot.accrualRate / known;
    if (ratio < 0.3 || ratio > 3) {
      return {
        flagged: true,
        message: `Entered rate ($${pot.accrualRate}/FC) is far from the known ${engineFamily} catalogue blended LLP rate ($${known.toFixed(2)}/FC) — more than 3x off. Please double-check against the real lease schedule.`,
        checkFailed: false
      };
    }
  }

  // Ground truth for the four fixed non-engine pots, sourced from
  // FIXED_RESERVE_POT_DEFS itself (TECH_DEBT.md 4.43 already corrected
  // these) rather than asking the AI to infer accrual basis from general
  // aviation knowledge — that inference was the actual bug (4.45): the
  // old prompt told Claude "usually accrued per flight hour" for EVERY
  // non-engine pot, which is wrong for AF-6Y/AF-12Y/LG-OH (calendar
  // months, checks are due regardless of utilisation) and wrong again
  // for AP-OH (APU hours, not flight hours) — only ever right by
  // coincidence, never by design.
  const EXPECTED_BASIS_BY_CODE = Object.fromEntries(
    FIXED_RESERVE_POT_DEFS.map(d => [d.code, d.accrualBasis])
  );

  try {
    let context;
    if (pot.potCategory === "engine") {
      context = `Engine family: ${engineFamily}. Known catalogue blended LLP rate (2026): $${catalogue?.blendedRatePerFC2026 ?? "unknown"}/FC. Known catalogue escalation: ${catalogue?.escalationPctPerYr ?? "unknown"}%/yr.`;
    } else {
      const expectedBasis = EXPECTED_BASIS_BY_CODE[pot.code];
      context = expectedBasis
        ? `This is a fixed reserve pot (${pot.code}). The CORRECT accrual basis for this pot type is "${expectedBasis}" — do NOT flag this basis as wrong if it matches. Airframe checks (AF-6Y, AF-12Y) and Landing Gear Overhaul accrue per calendar month regardless of utilisation (the check falls due on a fixed schedule, not based on flying). APU Overhaul accrues per APU hour, not per flight hour. Only flag the basis if it does NOT match "${expectedBasis}".`
        : `This is a non-engine reserve pot. Accrual basis varies by pot type — do not assume flight-hour accrual is the default.`;
    }
    const prompt = `You are sanity-checking a single reserve pot entry, manually transcribed from a real aircraft lease's Maintenance Payment Rate schedule. Only flag entries that look genuinely implausible (wrong order of magnitude, wrong basis, or a negative/zero value where a positive rate is expected). Do NOT flag a rate just because it's unusual — real negotiated lease rates vary.

Pot: ${pot.code} (${pot.label})
Accrual basis: ${pot.accrualBasis}
Accrual rate: $${pot.accrualRate}
Escalation: ${pot.escalationPctPerYr}%/yr
Opening balance: $${pot.openingBalance}
${context}

Respond with ONLY a single JSON object and absolutely nothing else — no markdown code fences, no preamble, no explanation before or after it: {"flagged": true or false, "message": "one short sentence explaining why, or empty string if not flagged"}`;
    const resp = await fetch("/api/extract", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 400, messages: [{ role: "user", content: [{ type: "text", text: prompt }] }] }) });
    if (!resp.ok) throw new Error(`/api/extract returned ${resp.status}`);
    // /api/extract already calls Claude and parses its JSON output
    // server-side — it does NOT return the raw Anthropic Messages API
    // shape. Same envelope as every other caller of this endpoint
    // (see extractLLPSheet above): {ok:true, data:{...}} on success,
    // {ok:false, raw:"..."} if server-side parsing failed but there's
    // still text to fall back on, or {error:"..."} on an actual API
    // failure. Assuming a {content:[...]} shape here (the earlier bug)
    // meant every single call fell through to the catch block below,
    // regardless of what Claude actually answered.
    const result = await resp.json();
    if (result.error) throw new Error(result.error);
    const parsed = result.ok ? result.data : JSON.parse((result.raw || "").replace(/```json|```/g, "").trim());
    if (!parsed || typeof parsed.flagged !== "boolean") throw new Error("Malformed validation response (missing flagged boolean)");
    return { flagged: !!parsed.flagged, message: parsed.message || "", checkFailed: false };
  } catch (e) {
    // Fail-SAFE, not fail-open: a broken validation check must never be
    // silently treated as "this entry is fine" — that defeats the point
    // of having a check at all. Instead it surfaces as a flag requiring
    // the same explicit acknowledgment as a genuine content concern, but
    // with wording that makes clear it's a technical failure, not
    // Claude's judgement on the actual figures.
    console.warn("Pot validation check failed — flagging for manual review rather than passing silently:", e);
    return { flagged: true, message: "Validation check couldn't complete due to a technical error — please review this entry manually before saving.", checkFailed: true };
  }
};

const BULK_POT_FIELDS=[["AF-6Y","Airframe 6-Year Check"],["AF-12Y","Airframe 12-Year Check"],["AP-OH","APU Overhaul"],["LG-OH","Landing Gear Overhaul"],["ENGINE_RESTORATION","Engine Restoration"],["ENGINE_LLP","Engine LLP"]];

function buildPotDefsForActivation(asset){
  const cfm=isCFM(asset);
  const engineFamily=cfm?"CFM":"V2500";
  const catalogueEsc=window.LLP_CATALOGUE_PRICES?.[engineFamily]?.escalationPctPerYr;
  return [...FIXED_RESERVE_POT_DEFS,...buildRealEnginePotDefs(asset)].map(def=>({
    ...def,
    escalationPctPerYr: def.potCategory==="engine"?(catalogueEsc??2.5):2.5
  }));
};

function buildPotFromDef(def,accrualRate,today){
  return {
    code:def.code,label:def.label,potCategory:def.potCategory,enginePosition:def.enginePosition??null,
    accrualBasis:def.accrualBasis,accrualRate,accrualRateBaseYear:new Date().getFullYear(),
    escalationPctPerYr:def.escalationPctPerYr,
    openingBalance:"",openingBalanceAsOf:today,
    triggerBasis:def.triggerBasis||"calendar_months",
    triggerInterval:def.triggerInterval||{months:72},
    outflowEscalationPct:def.outflowEscalationPct??2.5,
    outflowCostBaseYear:new Date().getFullYear(),
    projectedCostLow:def.defaultCostLow??"",
    projectedCostHigh:def.defaultCostHigh??"",
    escalationRegime:def.escalationRegime||"flat_annual",
    catalogueRef:def.catalogueRef||null,
    harvestThresholdFC:def.defaultHarvestThresholdFC??2000,
    stubBufferPct:def.defaultStubBufferPct??10,
    fullStackReplacementCost:def.fullStackReplacementCost??null,
    engineFamily:def.engineFamily||null,
    anchorMode:def.anchorMode||"infer",
    lastPRDate:"",
    validationWarning:null,warningAcknowledged:false
  };
};


export { BULK_POT_FIELDS, EN_PR_FAMILY_DEFAULTS, FIXED_RESERVE_POT_DEFS, buildPotDefsForActivation, buildPotFromDef, buildRealEnginePotDefs, validatePotWithAI };
