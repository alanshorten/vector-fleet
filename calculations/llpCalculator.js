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

// Expose as globals for use in the main app's Babel script block
// (no module bundler in this project — see TECH_DEBT.md).
window.calcLLPRem = calcLLPRem;
window.lowestLimiter = lowestLimiter;
