// ============================================================================
// Brain 1 — Utilisation Report Processing
// /calculations/utilisation.js
//
// Pure function. No UI. No Firebase. No window state mutation beyond
// exposing itself as window.processUtilisationReport, matching the
// llpCalculator.js (Brain 2) pattern.
//
// Responsibilities:
//   - Delta verification (period FC/FH reported vs. calculated from CSN/TSN)
//   - S/N change detection (engine x2, APU, landing gear x3)
//   - Producing a merged asset record ready for saveAsset(), OR signalling
//     that this report should be stored as history only (out-of-order upload)
//
// Explicitly NOT this function's job:
//   - Calling Firebase
//   - Deciding UI behaviour (confirmation modals, banners)
//   - Cross-suppressing warnings between S/N changes and delta mismatches
//     (kept independent per product decision — both surface, neither hides
//     the other)
// ============================================================================

(function () {
  "use strict";

  // ---- local time helpers -------------------------------------------------
  // Mirrors index.html's global parseHHMM/fmtHHMM exactly. Duplicated here
  // (rather than depending on window.parseHHMM) so this module has zero
  // runtime dependency on load order — it can be tested fully standalone.
  function parseHHMM(s) {
    if (!s) return 0;
    var p = s.toString().split(":");
    return parseFloat(p[0]) + (parseFloat(p[1] || 0) / 60);
  }

  // ---- month_year parsing for gap / ordering detection --------------------
  // Reports carry a human string like "May 2026". We parse to a comparable
  // number (YYYYMM) rather than a Date to avoid timezone edge cases, since
  // we only ever care about whole-month granularity here.
  var MONTH_NAMES = ["january","february","march","april","may","june",
    "july","august","september","october","november","december"];
  var MONTH_ABBR = ["jan","feb","mar","apr","may","jun",
    "jul","aug","sep","oct","nov","dec"];

  function monthIndexFromToken(tok) {
    if (!tok) return -1;
    var t = tok.replace(/\.$/, ""); // strip trailing "." e.g. "Jan."
    var full = MONTH_NAMES.indexOf(t);
    if (full !== -1) return full;
    if (t.length >= 3) {
      var abbr = MONTH_ABBR.indexOf(t.slice(0, 3));
      if (abbr !== -1) return abbr;
    }
    return -1;
  }

  function normaliseYear(y) {
    // Accept 2-digit years (e.g. "May '26", "May 26") — assume 2000s,
    // since this app has no plausible use of pre-2000 dates.
    if (y < 100) return 2000 + y;
    return y;
  }

  // Accepts realistic variants an AI extraction step might produce, since
  // the extraction prompt only gives "e.g. May 2026" as a hint, not an
  // enforced format. Handles:
  //   "May 2026", "may 2026"        (canonical)
  //   "Jan 2026", "Jan. 2026"       (abbreviated month)
  //   "May, 2026"                   (comma separator)
  //   "May'26", "May '26", "May 26" (2-digit year, apostrophe optional)
  //   "05/2026", "05-2026"          (numeric month/year, slash or dash)
  //   "2026-05", "2026/05"          (ISO-ish year-first)
  // Anything genuinely ambiguous still returns null rather than guessing —
  // callers must treat null as "unparseable", not as "no gap".
  function parseMonthYear(s) {
    if (!s || typeof s !== "string") return null;
    var raw = s.trim().toLowerCase();
    if (!raw) return null;

    // ISO-ish year-first numeric: "2026-05" / "2026/05"
    var isoMatch = raw.match(/^(\d{4})[\/\-](\d{1,2})$/);
    if (isoMatch) {
      var isoYear = parseInt(isoMatch[1], 10);
      var isoMonth = parseInt(isoMatch[2], 10) - 1;
      if (isoMonth >= 0 && isoMonth <= 11) {
        return { year: isoYear, month: isoMonth, key: isoYear * 12 + isoMonth };
      }
      return null;
    }

    // Numeric month-first: "05/2026" / "05-2026"
    var numMatch = raw.match(/^(\d{1,2})[\/\-](\d{2,4})$/);
    if (numMatch) {
      var numMonth = parseInt(numMatch[1], 10) - 1;
      var numYear = normaliseYear(parseInt(numMatch[2], 10));
      if (numMonth >= 0 && numMonth <= 11) {
        return { year: numYear, month: numMonth, key: numYear * 12 + numMonth };
      }
      return null;
    }

    // Word-based: strip commas/apostrophes, collapse whitespace, then split.
    // Covers "May 2026", "Jan. 2026", "May, 2026", "May '26", "May26".
    var cleaned = raw.replace(/[,']/g, " ").replace(/\s+/g, " ").trim();
    // Handle no-space run-together case like "may26" before splitting.
    var runTogether = cleaned.match(/^([a-z]+)\.?\s?(\d{2,4})$/);
    var parts = runTogether
      ? [runTogether[1], runTogether[2]]
      : cleaned.split(" ");
    if (parts.length !== 2) return null;
    var monthIdx = monthIndexFromToken(parts[0]);
    var yearNum = parseInt(parts[1], 10);
    if (monthIdx === -1 || isNaN(yearNum)) return null;
    var year = normaliseYear(yearNum);
    return { year: year, month: monthIdx, key: year * 12 + monthIdx };
  }

  function monthsBetween(aKey, bKey) {
    // bKey - aKey, in whole months. Positive if b is after a.
    if (aKey === null || bKey === null) return null;
    return bKey - aKey;
  }

  // ---- delta verification ---------------------------------------------
  // Compares the period FC/FH the report itself claims against what we'd
  // calculate by diffing new CSN/TSN against the previously stored value.
  // Tolerance widens proportionally when more than one month has passed
  // (gap month handling), since "period FC" in that case should already
  // reflect the lessor's own multi-month figure if reported correctly —
  // but if the report only ever reports a single trailing period, we widen
  // our own acceptance band rather than falsely flagging a mismatch.
  function checkDelta(newCSN, prevCSN, periodFC, monthsGap) {
    if (newCSN == null || prevCSN == null) {
      return { calc: null, reported: periodFC != null ? periodFC : null, match: null };
    }
    var calc = newCSN - prevCSN;
    if (periodFC == null) {
      return { calc: calc, reported: null, match: null };
    }
    // Base tolerance of 1 cycle for rounding; widen if multiple months
    // have elapsed and the report's "period" figure might be a single-month
    // snapshot rather than a true multi-month figure.
    var tolerance = 1;
    if (monthsGap && monthsGap > 1) {
      tolerance = 1 + Math.ceil(Math.abs(calc) * 0.05); // 5% slack per extra month, rough guard
    }
    var match = Math.abs(periodFC - calc) <= tolerance;
    return { calc: calc, reported: periodFC, match: match };
  }

  function checkDeltaFH(newTSNStr, prevFH, periodFHStr, monthsGap) {
    var newFH = newTSNStr ? parseHHMM(newTSNStr) : null;
    if (newFH == null || prevFH == null) {
      var reportedFH = periodFHStr ? parseHHMM(periodFHStr) : null;
      return { calc: null, reported: reportedFH, match: null };
    }
    var calc = newFH - prevFH;
    if (!periodFHStr) {
      return { calc: calc, reported: null, match: null };
    }
    var reported = parseHHMM(periodFHStr);
    var tolerance = 0.1;
    if (monthsGap && monthsGap > 1) {
      tolerance = 0.1 + Math.abs(calc) * 0.05;
    }
    var match = Math.abs(reported - calc) <= tolerance;
    return { calc: calc, reported: reported, match: match };
  }

  // ---- S/N change detection ------------------------------------------
  // Returns a flat list of { component, position, previousSN, newSN }.
  // Engines and APU and landing gear are all handled uniformly here so
  // the Body doesn't need three different shapes.
  function detectSNChanges(newReport, previousAsset) {
    var changes = [];
    if (!previousAsset) return changes; // nothing to compare against

    // Engines (position 1 and 2, matched by array index — same assumption
    // the original inline code made: engines[0] <-> engine1, engines[1] <-> engine2)
    var prevEngines = previousAsset.engines || [];
    [["engine1", 0], ["engine2", 1]].forEach(function (pair) {
      var srcKey = pair[0], idx = pair[1];
      var src = newReport[srcKey];
      var prevEng = prevEngines[idx];
      if (src && src.sn && prevEng && prevEng.sn && src.sn !== prevEng.sn) {
        changes.push({
          component: "engine",
          position: idx + 1,
          previousSN: prevEng.sn,
          newSN: src.sn
        });
      }
    });

    // APU
    if (newReport.apu && newReport.apu.sn && previousAsset.apu && previousAsset.apu.sn &&
        newReport.apu.sn !== previousAsset.apu.sn) {
      changes.push({
        component: "apu",
        position: null,
        previousSN: previousAsset.apu.sn,
        newSN: newReport.apu.sn
      });
    }

    // Landing gear (nose / left / right)
    ["nose", "left", "right"].forEach(function (k) {
      var src = newReport.landing_gear && newReport.landing_gear[k];
      var prevLG = previousAsset.landingGear && previousAsset.landingGear[k];
      if (src && src.sn && prevLG && prevLG.sn && src.sn !== prevLG.sn) {
        changes.push({
          component: "landingGear",
          position: k,
          previousSN: prevLG.sn,
          newSN: src.sn
        });
      }
    });

    return changes;
  }

  function formatSNWarnings(snChanges) {
    return snChanges.map(function (c) {
      if (c.component === "engine") {
        return "\u26A0 Engine " + c.position + " S/N change: was " + c.previousSN +
          ", now " + c.newSN + " \u2014 possible engine swap or shop visit return";
      }
      if (c.component === "apu") {
        return "\u26A0 APU S/N change: was " + c.previousSN + ", now " + c.newSN;
      }
      // landingGear
      return "\u26A0 " + c.position.toUpperCase() + " Landing Gear S/N change: was " +
        c.previousSN + ", now " + c.newSN;
    });
  }

  function formatRemovalWarnings(removals) {
    if (!removals || !removals.length) return [];
    return removals
      .filter(function (r) { return r.sn; })
      .map(function (r) {
        return "\uD83D\uDD27 " + (r.component ? r.component.toUpperCase() : "Component") +
          " removal: S/N " + r.sn + " Pos " + (r.position || "?") + " on " +
          (r.date || "?") + " \u2014 " + (r.reason || "reason not stated") +
          (r.mro ? " @ " + r.mro : "");
      });
  }

  // ---- main entry point -------------------------------------------------
  function processUtilisationReport(input) {
    var newReport = input.newReport;
    var previousAsset = input.previousAsset || null;

    if (!newReport) {
      throw new Error("processUtilisationReport: newReport is required");
    }

    // -------------------- Case 1: brand new asset --------------------
    if (!previousAsset) {
      var newMSN = newReport.msn ? newReport.msn.toString().replace(/^0+/, "") : "";
      var newAssetRecord = {
        id: newMSN,
        type: "aircraft",
        msn: newMSN,
        registration: newReport.registration || "",
        model: (newReport.engine1 && newReport.engine1.model &&
          newReport.engine1.model.toUpperCase().indexOf("CFM") !== -1) ? "A320-214" : "A320-214",
        operator: newReport.operator || "",
        manufacturer: "Airbus S.A.S.",
        dom: "",
        weights: {},
        specs: { adsb: false, cpdlc: false, tcas: false },
        checks: [
          { name: "6 Year Check", lastDate: "", lastFH: 0, lastFC: 0, nextDate: "" },
          { name: "12 Year Check", lastDate: "", lastFH: 0, lastFC: 0, nextDate: "" }
        ],
        engines: [
          {
            position: 1,
            sn: (newReport.engine1 && newReport.engine1.sn) || "",
            type: (newReport.engine1 && newReport.engine1.model) || "",
            thrust: "",
            status: "Title",
            currentFH: parseHHMM(newReport.engine1 && newReport.engine1.tsn),
            currentFC: (newReport.engine1 && newReport.engine1.csn) || 0,
            llps: [],
            shopVisits: []
          },
          {
            position: 2,
            sn: (newReport.engine2 && newReport.engine2.sn) || "",
            type: (newReport.engine2 && newReport.engine2.model) || "",
            thrust: "",
            status: "Title",
            currentFH: parseHHMM(newReport.engine2 && newReport.engine2.tsn),
            currentFC: (newReport.engine2 && newReport.engine2.csn) || 0,
            llps: [],
            shopVisits: []
          }
        ],
        landingGear: {
          nose: {
            pn: (newReport.landing_gear && newReport.landing_gear.nose && newReport.landing_gear.nose.pn) || "",
            sn: (newReport.landing_gear && newReport.landing_gear.nose && newReport.landing_gear.nose.sn) || "",
            refLegFH: null, refLegFC: null, refAirframeFH: null, refAirframeFC: null,
            lastOverhaulDate: "", lastOverhaulFH: null, lastOverhaulFC: null,
            currentFH: (newReport.landing_gear && newReport.landing_gear.nose && newReport.landing_gear.nose.total_fh != null) ? parseHHMM(newReport.landing_gear.nose.total_fh) : null,
            currentFC: (newReport.landing_gear && newReport.landing_gear.nose && newReport.landing_gear.nose.total_fc != null) ? newReport.landing_gear.nose.total_fc : null,
            overhaulIntervalYears: 10, overhaulIntervalCycles: 20000, nextDue: "", shopVisits: []
          },
          left: {
            pn: (newReport.landing_gear && newReport.landing_gear.left && newReport.landing_gear.left.pn) || "",
            sn: (newReport.landing_gear && newReport.landing_gear.left && newReport.landing_gear.left.sn) || "",
            refLegFH: null, refLegFC: null, refAirframeFH: null, refAirframeFC: null,
            lastOverhaulDate: "", lastOverhaulFH: null, lastOverhaulFC: null,
            currentFH: (newReport.landing_gear && newReport.landing_gear.left && newReport.landing_gear.left.total_fh != null) ? parseHHMM(newReport.landing_gear.left.total_fh) : null,
            currentFC: (newReport.landing_gear && newReport.landing_gear.left && newReport.landing_gear.left.total_fc != null) ? newReport.landing_gear.left.total_fc : null,
            overhaulIntervalYears: 10, overhaulIntervalCycles: 20000, nextDue: "", shopVisits: []
          },
          right: {
            pn: (newReport.landing_gear && newReport.landing_gear.right && newReport.landing_gear.right.pn) || "",
            sn: (newReport.landing_gear && newReport.landing_gear.right && newReport.landing_gear.right.sn) || "",
            refLegFH: null, refLegFC: null, refAirframeFH: null, refAirframeFC: null,
            lastOverhaulDate: "", lastOverhaulFH: null, lastOverhaulFC: null,
            currentFH: (newReport.landing_gear && newReport.landing_gear.right && newReport.landing_gear.right.total_fh != null) ? parseHHMM(newReport.landing_gear.right.total_fh) : null,
            currentFC: (newReport.landing_gear && newReport.landing_gear.right && newReport.landing_gear.right.total_fc != null) ? newReport.landing_gear.right.total_fc : null,
            overhaulIntervalYears: 10, overhaulIntervalCycles: 20000, nextDue: "", shopVisits: []
          }
        },
        apu: {
          pn: "",
          sn: (newReport.apu && newReport.apu.sn) || "",
          currentFH: parseHHMM(newReport.apu && newReport.apu.tsn),
          currentFC: (newReport.apu && newReport.apu.csn) || 0,
          llps: [],
          shopVisits: []
        },
        airframe: {
          currentFH: parseHHMM(newReport.airframe && newReport.airframe.tsn),
          currentFC: (newReport.airframe && newReport.airframe.csn) || 0
        },
        photos: [],
        documents: [],
        disclaimer: "This outline specification has been prepared based on the information available to Maverick Horizon at the relevant time.",
        _lastPeriod: newReport.month_year
      };

      var utilisationRecordNew = {
        asset_id: newMSN,
        period: newReport.month_year,
        data: {
          afFH: newReport.airframe && newReport.airframe.tsn,
          afFC: newReport.airframe && newReport.airframe.csn,
          eng1FC: newReport.engine1 && newReport.engine1.csn,
          eng2FC: newReport.engine2 && newReport.engine2.csn,
          apuFC: newReport.apu && newReport.apu.csn
        }
      };

      return {
        isNewAsset: true,
        historyOnly: false,
        deltaCheck: {
          status: "first_report",
          fc: { calc: null, reported: (newReport.airframe && newReport.airframe.fc_period) || null, match: null },
          fh: { calc: null, reported: (newReport.airframe && newReport.airframe.fh_period) || null, match: null },
          monthsGap: null
        },
        snChanges: [],
        mergedAsset: newAssetRecord,
        utilisationRecord: utilisationRecordNew,
        warnings: []
      };
    }

    // -------------------- Case 2: existing asset --------------------
    var newPeriod = parseMonthYear(newReport.month_year);
    var prevPeriod = parseMonthYear(previousAsset._lastPeriod);
    var monthsGap = monthsBetween(prevPeriod ? prevPeriod.key : null, newPeriod ? newPeriod.key : null);

    // Period unparseable: either the new report's month_year or the asset's
    // stored _lastPeriod didn't match any recognised format. This must be
    // surfaced explicitly and loudly — silently falling through with
    // monthsGap=null previously caused gap detection to go quiet (a real
    // multi-month gap was treated as an ordinary consecutive update with
    // the tightest delta tolerance, since gapDetected and isOutOfOrder both
    // require monthsGap to be a non-null number). Per product decision:
    // an unparseable period must never be treated as "no gap" / "ok".
    if (newPeriod === null || prevPeriod === null) {
      var unparseableField = newPeriod === null ? "this report's period" : "the asset's stored last period";
      var unparseableValue = newPeriod === null ? newReport.month_year : previousAsset._lastPeriod;
      var snChangesUP = detectSNChanges(newReport, previousAsset);
      var snWarningsUP = formatSNWarnings(snChangesUP);
      var removalWarningsUP = formatRemovalWarnings(newReport.removals);
      var utilisationRecordUP = {
        asset_id: previousAsset.id,
        period: newReport.month_year,
        data: {
          afFH: newReport.airframe && newReport.airframe.tsn,
          afFC: newReport.airframe && newReport.airframe.csn,
          eng1FC: newReport.engine1 && newReport.engine1.csn,
          eng2FC: newReport.engine2 && newReport.engine2.csn,
          apuFC: newReport.apu && newReport.apu.csn,
          warnings: snWarningsUP.concat(removalWarningsUP)
        }
      };
      return {
        isNewAsset: false,
        historyOnly: true,
        deltaCheck: {
          status: "period_unparseable",
          fc: { calc: null, reported: null, match: null },
          fh: { calc: null, reported: null, match: null },
          monthsGap: null
        },
        snChanges: snChangesUP,
        mergedAsset: null, // explicit: Body must NOT call saveAsset with this
        utilisationRecord: utilisationRecordUP,
        warnings: snWarningsUP.concat(removalWarningsUP).concat([
          "\u26A0 Could not determine reporting gap: " + unparseableField +
          " (\"" + (unparseableValue || "blank") + "\") is not in a recognised month/year " +
          "format. Saved to history only \u2014 live asset state unchanged. Review and " +
          "correct the period manually if this report should be applied."
        ])
      };
    }

    // Out-of-order: new report's period is strictly BEFORE the asset's last
    // stored period. Per product decision: save into history, never
    // overwrite live state — a stale report should never clobber newer data.
    var isOutOfOrder = (monthsGap !== null && monthsGap < 0);

    // Same-month: new report's period equals the asset's current period.
    // This is NOT out-of-order — it's a partial/split report for the SAME
    // month (e.g. Engine 1 + APU report arrives separately from an Engine 2
    // report, or a donor-engine component is reported by a different lessor
    // some months and not others). These must MERGE into live state, filling
    // in only what this report actually contains, never blanking fields this
    // report is silent on.
    var isSameMonth = (monthsGap === 0);

    var snChanges = detectSNChanges(newReport, previousAsset);
    var snWarnings = formatSNWarnings(snChanges);
    var removalWarnings = formatRemovalWarnings(newReport.removals);

    if (isOutOfOrder) {
      var utilisationRecordOOO = {
        asset_id: previousAsset.id,
        period: newReport.month_year,
        data: {
          afFH: newReport.airframe && newReport.airframe.tsn,
          afFC: newReport.airframe && newReport.airframe.csn,
          eng1FC: newReport.engine1 && newReport.engine1.csn,
          eng2FC: newReport.engine2 && newReport.engine2.csn,
          apuFC: newReport.apu && newReport.apu.csn,
          warnings: snWarnings.concat(removalWarnings)
        }
      };
      return {
        isNewAsset: false,
        historyOnly: true,
        deltaCheck: {
          status: "out_of_order",
          fc: { calc: null, reported: null, match: null },
          fh: { calc: null, reported: null, match: null },
          monthsGap: monthsGap
        },
        snChanges: snChanges,
        mergedAsset: null, // explicit: Body must NOT call saveAsset with this
        utilisationRecord: utilisationRecordOOO,
        warnings: snWarnings.concat(removalWarnings).concat([
          "\u26A0 Out-of-order upload: report period (" + (newReport.month_year || "unknown") +
          ") is not after the asset's current period (" + (previousAsset._lastPeriod || "unknown") +
          "). Saved to history only \u2014 live asset state unchanged."
        ])
      };
    }

    // Gap detection (more than one month elapsed since last report)
    var gapDetected = (monthsGap !== null && monthsGap > 1);

    // Delta verification — engines's individual FC deltas aren't separately
    // surfaced today (only airframe-level), so we preserve that scope.
    // Same-month merges skip delta verification entirely: a partial report
    // for a month already on file isn't reporting a NEW period of flying,
    // so there's nothing meaningful to diff period-FC against.
    var fcCheck, fhCheck;
    if (isSameMonth) {
      fcCheck = { calc: null, reported: (newReport.airframe && newReport.airframe.fc_period) || null, match: null };
      fhCheck = { calc: null, reported: (newReport.airframe && newReport.airframe.fh_period) || null, match: null };
    } else {
      fcCheck = checkDelta(
        newReport.airframe && newReport.airframe.csn,
        previousAsset.airframe && previousAsset.airframe.currentFC,
        newReport.airframe && newReport.airframe.fc_period,
        monthsGap
      );
      fhCheck = checkDeltaFH(
        newReport.airframe && newReport.airframe.tsn,
        previousAsset.airframe && previousAsset.airframe.currentFH,
        newReport.airframe && newReport.airframe.fh_period,
        monthsGap
      );
    }

    var deltaStatus = "ok";
    if (isSameMonth) {
      deltaStatus = "same_month_merge";
    } else if (gapDetected) {
      deltaStatus = "gap_detected";
    }
    if (!isSameMonth && (fcCheck.match === false || fhCheck.match === false)) {
      deltaStatus = "mismatch";
    }

    // Build merged engines array (index-based, same assumption as original)
    var engines = (previousAsset.engines || []).map(function (e, i) {
      var src = i === 0 ? newReport.engine1 : i === 1 ? newReport.engine2 : null;
      if (!src) return e;
      return Object.assign({}, e, {
        sn: src.sn || e.sn,
        type: src.model || e.type,
        currentFH: parseHHMM(src.tsn),
        currentFC: (src.csn != null ? src.csn : e.currentFC)
      });
    });

    // Build merged landing gear (deep-clone style, mirrors original)
    var lg = JSON.parse(JSON.stringify(previousAsset.landingGear || {}));
    ["nose", "left", "right"].forEach(function (k) {
      var src = newReport.landing_gear && newReport.landing_gear[k];
      if (!src) return;
      if (!lg[k]) {
        lg[k] = { pn: "", sn: "", refLegFH: null, refLegFC: null, refAirframeFH: null, refAirframeFC: null,
          lastOverhaulDate: "", lastOverhaulFH: null, lastOverhaulFC: null, currentFH: null, currentFC: null,
          overhaulIntervalYears: 10, overhaulIntervalCycles: 20000, nextDue: "", shopVisits: [] };
      }
      if (src.pn) lg[k].pn = src.pn;
      if (src.sn) lg[k].sn = src.sn;
      // Ground truth ("TOTAL HOURS & CYCLES") from the dedicated Gear Status
      // Report some lessors send monthly — when present, this always
      // overrides the calculated figure outright (no tolerance check, per
      // product decision — there's no overhaul baseline to compare against
      // for the two aircraft that receive this report).
      if (src.total_fh != null) lg[k].currentFH = parseHHMM(src.total_fh);
      if (src.total_fc != null) lg[k].currentFC = src.total_fc;
    });

    var mergedAsset = Object.assign({}, previousAsset, {
      _lastPeriod: newReport.month_year,
      airframe: Object.assign({}, previousAsset.airframe || {}, {
        currentFH: (newReport.airframe && newReport.airframe.tsn)
          ? parseHHMM(newReport.airframe.tsn)
          : (previousAsset.airframe && previousAsset.airframe.currentFH),
        currentFC: (newReport.airframe && newReport.airframe.csn != null)
          ? newReport.airframe.csn
          : (previousAsset.airframe && previousAsset.airframe.currentFC)
      }),
      engines: engines,
      landingGear: lg,
      apu: Object.assign({}, previousAsset.apu || {}, {
        sn: (newReport.apu && newReport.apu.sn) || (previousAsset.apu && previousAsset.apu.sn),
        currentFH: (newReport.apu && newReport.apu.tsn)
          ? parseHHMM(newReport.apu.tsn)
          : (previousAsset.apu && previousAsset.apu.currentFH),
        currentFC: (newReport.apu && newReport.apu.csn != null)
          ? newReport.apu.csn
          : (previousAsset.apu && previousAsset.apu.currentFC)
      })
    });

    var allWarnings = snWarnings.concat(removalWarnings);
    if (isSameMonth) {
      allWarnings = allWarnings.concat(["\u2139 Same-month merge: this report updates " +
        (newReport.month_year || "the current period") +
        " with additional data (e.g. a separate engine or APU report). Existing figures for " +
        "components not present in this report were preserved, not overwritten."]);
    }
    if (deltaStatus === "mismatch") {
      allWarnings = allWarnings.concat(["\u26A0 Delta mismatch \u2014 reported period figures do not match calculated CSN/TSN difference. Check report figures."]);
    }
    if (gapDetected) {
      allWarnings = allWarnings.concat(["\u26A0 Gap detected: " + monthsGap + " months since last report (" +
        (previousAsset._lastPeriod || "unknown") + " \u2192 " + (newReport.month_year || "unknown") +
        "). Delta tolerance widened accordingly."]);
    }

    var utilisationRecord = {
      asset_id: previousAsset.id,
      period: newReport.month_year,
      data: {
        afFH: newReport.airframe && newReport.airframe.tsn,
        afFC: newReport.airframe && newReport.airframe.csn,
        eng1FC: newReport.engine1 && newReport.engine1.csn,
        eng2FC: newReport.engine2 && newReport.engine2.csn,
        apuFC: newReport.apu && newReport.apu.csn,
        warnings: allWarnings
      }
    };

    return {
      isNewAsset: false,
      historyOnly: false,
      deltaCheck: {
        status: deltaStatus,
        fc: fcCheck,
        fh: fhCheck,
        monthsGap: monthsGap
      },
      snChanges: snChanges,
      mergedAsset: mergedAsset,
      utilisationRecord: utilisationRecord,
      warnings: allWarnings
    };
  }

  // Expose globally, matching llpCalculator.js's window-global pattern
  // (no module bundler in this single-file architecture).
  window.processUtilisationReport = processUtilisationReport;
  // Exported for direct unit testing of sub-pieces without re-deriving logic.
  window.__brain1Internals = {
    parseHHMM: parseHHMM,
    parseMonthYear: parseMonthYear,
    monthIndexFromToken: monthIndexFromToken,
    normaliseYear: normaliseYear,
    monthsBetween: monthsBetween,
    checkDelta: checkDelta,
    checkDeltaFH: checkDeltaFH,
    detectSNChanges: detectSNChanges,
    formatSNWarnings: formatSNWarnings,
    formatRemovalWarnings: formatRemovalWarnings
  };
})();
