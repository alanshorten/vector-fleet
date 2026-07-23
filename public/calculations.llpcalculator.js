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

// Stub-Buffer vs Harvest-Threshold validation guardrail (TECH_DEBT.md 4.21).
//
// stubBufferPct funds the "stub life" scrapped when a harvest sweeps up
// LLPs that are within harvestThresholdFC of THEIR OWN limit, riding
// along with the lowest limiter's shop visit. The lowest limiter itself
// is NOT stub waste — it runs down to near-zero before replacement on
// its own merits, so it is excluded from this check entirely.
//
// The part most at risk of exposing an under-funded buffer is whichever
// non-limiting LLP has the SHORTEST approvedLife: a fixed FC threshold
// eats a bigger fraction of a short-life part's value than a long-life
// part's, so that part sets the worst case.
//
//   impliedMinBufferPct = (harvestThresholdFC / minApprovedLife) * 100
//
// Flags if stubBufferPct is more than `tolerancePts` percentage points
// below that implied minimum — a small tolerance absorbs rounding in
// catalogue config numbers rather than firing on noise.
//
// eng:         { llps: [...], currentFC: number }
// reserveRate: { harvestThresholdFC: number, stubBufferPct: number }
//              stubBufferPct is assumed stored as a plain percentage
//              number (e.g. 10 for 10%), matching harvestThresholdFC's
//              FC units — confirm this against the live reserveRates
//              schema before wiring in.
// tolerancePts: percentage-point tolerance band (default 2).
//
// Returns null if there's no second LLP to assess (nothing to harvest
// alongside the limiter) or if the buffer is adequate. Otherwise returns
// a Brain-1-style warning string (⚠ prefix, ready to drop into an
// existing warnings array).
function validateStubBuffer(eng, reserveRate, tolerancePts = 2) {
  const vector = llpVector(eng);
  if (vector.length < 2) return null; // no other LLP could ride along

  const limiter = vector.reduce((min, p) =>
    p.remainingFC < min.remainingFC ? p : min
  );

  const candidates = vector.filter(
    p => !(p.pn === limiter.pn && p.sn === limiter.sn)
  );
  if (!candidates.length) return null;

  const shortestLifePart = candidates.reduce((min, p) =>
    p.approvedLife < min.approvedLife ? p : min
  );

  const { harvestThresholdFC, stubBufferPct } = reserveRate;
  const impliedMinBufferPct =
    (harvestThresholdFC / shortestLifePart.approvedLife) * 100;

  if (stubBufferPct >= impliedMinBufferPct - tolerancePts) return null;

  return (
    `⚠ EN-LP stub buffer (${stubBufferPct}%) is below the ` +
    `~${impliedMinBufferPct.toFixed(1)}% implied minimum for this ` +
    `asset's harvest threshold (${harvestThresholdFC} FC) and shortest ` +
    `at-risk LLP life (${shortestLifePart.desc}, ${shortestLifePart.approvedLife} FC).`
  );
}

// Expose as globals for use in the main app's Babel script block
// (no module bundler in this project — see TECH_DEBT.md).
window.calcLLPRem = calcLLPRem;
window.lowestLimiter = lowestLimiter;
window.llpVector = llpVector;
window.validateStubBuffer = validateStubBuffer;
