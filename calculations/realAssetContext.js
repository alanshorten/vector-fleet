// ============================================================
// Real-Asset Utilisation Rate — pure calculation logic.
// No UI. No Firebase calls (the caller fetches history via db.getUtilisation
// and passes the resulting array in here).
//
// Used by the Fly-Forward Demo view to derive a genuine monthly FH/FC
// rate from a real asset's own utilisation history, instead of a
// fabricated assumption. Only the LEASE TERMS in demoLeaseData.js are
// fabricated — this file's job is to make sure the utilisation side of
// the projection is real wherever real data exists.
// ============================================================

// "May 2026" -> Date(2026, 4, 1). Returns null if unparseable.
const FF_MONTH_NAMES = ["january","february","march","april","may","june","july","august","september","october","november","december"];
function parsePeriodToDate(period) {
  if (!period || typeof period !== "string") return null;
  const m = /^([A-Za-z]+)\s+(\d{4})$/.exec(period.trim());
  if (!m) return null;
  const idx = FF_MONTH_NAMES.indexOf(m[1].toLowerCase());
  if (idx === -1) return null;
  return new Date(parseInt(m[2], 10), idx, 1);
}

// "1234:56" -> 1234.93 (decimal hours). Passes through plain numbers.
function hhmmToDecimalHours(v) {
  if (typeof v === "number") return v;
  if (!v || typeof v !== "string") return null;
  const m = /^(\d+):(\d{2})$/.exec(v.trim());
  if (m) return parseInt(m[1], 10) + parseInt(m[2], 10) / 60;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

// Derives a real average monthly FH/FC rate from an asset's own report
// history (as returned by db.getUtilisation(asset.id) — array of
// { period, data: { afFH, afFC, ... }, created_at, ... }).
//
// Takes the OLDEST and NEWEST usable report (by parsed period, not
// upload order) and divides the cumulative TSN/CSN delta by the
// elapsed months. Returns null if fewer than 2 usable reports exist —
// the caller should fall back to a manual rate in that case, not guess.
//
// Returns: { fhPerMonth, fcPerMonth, monthsSpanned, oldestPeriod, newestPeriod } | null
function computeRealUtilisationRate(history) {
  const parsed = (history || [])
    .map(r => ({
      date: parsePeriodToDate(r.period),
      afFH: hhmmToDecimalHours(r.data && r.data.afFH),
      afFC: r.data && r.data.afFC
    }))
    .filter(r => r.date && r.afFH != null && typeof r.afFC === "number")
    .sort((a, b) => a.date - b.date);

  if (parsed.length < 2) return null;

  const oldest = parsed[0];
  const newest = parsed[parsed.length - 1];
  const monthsSpanned = Math.max(
    1,
    (newest.date.getFullYear() - oldest.date.getFullYear()) * 12 + (newest.date.getMonth() - oldest.date.getMonth())
  );

  return {
    fhPerMonth: (newest.afFH - oldest.afFH) / monthsSpanned,
    fcPerMonth: (newest.afFC - oldest.afFC) / monthsSpanned,
    monthsSpanned,
    oldestPeriod: oldest.date,
    newestPeriod: newest.date
  };
}

// APU hours have no history field to derive a rate from directly. This
// estimates apuHrPerMonth by scaling the real flight-hour rate by the
// asset's own CURRENT apu-hours-to-airframe-hours ratio — a real-data-
// derived proxy (uses two genuine current snapshot fields), not an
// invented flat number. Returns null if airframe hours are 0/missing.
function estimateApuHrPerMonth(fhPerMonth, apuCurrentFH, airframeCurrentFH) {
  if (!airframeCurrentFH || !apuCurrentFH) return null;
  return fhPerMonth * (apuCurrentFH / airframeCurrentFH);
}

// "27/10/2028" -> Date(2028, 9, 27). Matches the DD/MM/YYYY convention
// used elsewhere in the app (e.g. Dashboard's own parseDMY) for check
// and landing-gear due dates. Falls back to native Date parsing, then
// null if genuinely unparseable — callers should treat null as "no
// real anchor available" and fall back to fabricated-only behaviour,
// not guess.
function parseDMYDate(s) {
  if (!s) return null;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s.trim());
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

window.parsePeriodToDate = parsePeriodToDate;
window.hhmmToDecimalHours = hhmmToDecimalHours;
window.computeRealUtilisationRate = computeRealUtilisationRate;
window.estimateApuHrPerMonth = estimateApuHrPerMonth;
window.parseDMYDate = parseDMYDate;
