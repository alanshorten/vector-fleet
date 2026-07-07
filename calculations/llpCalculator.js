// ============================================================
// BRAIN 2 — LLP Calculator
// Pure calculation logic for Life Limited Part (LLP) countdowns.
// No UI. No Firebase. No side effects.
//
// Per VectorIQ architecture (Brain/Body separation):
//   /calculations  <- THE BRAIN (this file)
//   /services      <- THE NERVOUS SYSTEM (Firebase, API calls)
//   /components    <- THE BODY (UI only)
// ============================================================

// Remaining cycles for a single LLP, projected forward from the
// reference point (refFC) recorded at the time the disk sheet /
// LLP status sheet was last uploaded.
//
//   fc_remaining = startFCRem - (currentEngineCSN - refFC)
//
// llp: { startFCRem: number, refFC: number, ... }
// fc:  current engine (or APU) CSN
function calcLLPRem(llp, fc) {
  return llp.startFCRem - (fc - llp.refFC);
}

// The single most limiting (lowest remaining cycles) LLP for an
// engine. Returns null if the engine has no LLP data entered yet.
//
// eng: { llps: [...], currentFC: number }
function lowestLimiter(eng) {
  if (!eng?.llps?.length) return null;
  return Math.min(...eng.llps.map(l => calcLLPRem(l, eng.currentFC)));
}

// Full per-part remaining-life vector for an engine (or APU), for
// Brain 3's EN-LP stack simulation (TECH_DEBT.md 4.19).
//
// Parts with no approved life limit (N/L on the LLP sheet — e.g.
// LPT Case, Turbine Rear Frame) are excluded here, not at parse
// time: the raw data is stored with approvedLife:null so nothing
// is lost, this is just where the "not limited" parts get filtered
// out of the harvest-simulation input. Change this filter alone if
// N/L parts ever need to enter the simulation in future.
//
// eng: { llps: [...], currentFC: number }
// Returns: [{ desc, pn, sn, remainingFC, approvedLife }, ...]
function llpVector(eng) {
  if (!eng?.llps?.length) return [];
  return eng.llps
    .filter(l => l.approvedLife !== null && l.approvedLife !== undefined)
    .map(l => ({
      desc: l.desc,
      pn: l.pn,
      sn: l.sn,
      remainingFC: calcLLPRem(l, eng.currentFC),
      approvedLife: l.approvedLife
    }));
}

// Expose as globals for use in the main app's Babel script block
// (no module bundler in this project — see TECH_DEBT.md).
window.calcLLPRem = calcLLPRem;
window.lowestLimiter = lowestLimiter;
window.llpVector = llpVector;
