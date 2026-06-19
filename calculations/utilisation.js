
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

  function parseMonthYear(s) {
    if (!s || typeof s !== "string") return null;
    var parts = s.trim().toLowerCase().split(/\s+/);
    if (parts.length !== 2) return null;
    var monthIdx = MONTH_NAMES.indexOf(parts[0]);
    var year = parseInt(parts[1], 10);
    if (monthIdx === -1 || isNaN(year)) return null;
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
            startFH: 0, startFC: 0, refAirframeFH: 0, refAirframeFC: 0, nextDue: "", shopVisits: []
          },
          left: {
            pn: (newReport.landing_gear && newReport.landing_gear.left && newReport.landing_gear.left.pn) || "",
            sn: (newReport.landing_gear && newReport.landing_gear.left && newReport.landing_gear.left.sn) || "",
            startFH: 0, startFC: 0, refAirframeFH: 0, refAirframeFC: 0, nextDue: "", shopVisits: []
          },
          right: {
            pn: (newReport.landing_gear && newReport.landing_gear.right && newReport.landing_gear.right.pn) || "",
            sn: (newReport.landing_gear && newReport.landing_gear.right && newReport.landing_gear.right.sn) || "",
            startFH: 0, startFC: 0, refAirframeFH: 0, refAirframeFC: 0, nextDue: "", shopVisits: []
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
        disclaimer: "This outline specification has been prepared based on the information available to Vector Group at the relevant time.",
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

    // Out-of-order: new report's period is at or before the asset's last
    // stored period. Per product decision: save into history, never
    // overwrite live state.
    var isOutOfOrder = (monthsGap !== null && monthsGap <= 0);

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
    var fcCheck = checkDelta(
      newReport.airframe && newReport.airframe.csn,
      previousAsset.airframe && previousAsset.airframe.currentFC,
      newReport.airframe && newReport.airframe.fc_period,
      monthsGap
    );
    var fhCheck = checkDeltaFH(
      newReport.airframe && newReport.airframe.tsn,
      previousAsset.airframe && previousAsset.airframe.currentFH,
      newReport.airframe && newReport.airframe.fh_period,
      monthsGap
    );

    var deltaStatus = "ok";
    if (gapDetected) {
      deltaStatus = "gap_detected";
    }
    if (fcCheck.match === false || fhCheck.match === false) {
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
        lg[k] = { pn: "", sn: "", startFH: 0, startFC: 0, refAirframeFH: 0, refAirframeFC: 0, nextDue: "", shopVisits: [] };
      }
      if (src.pn) lg[k].pn = src.pn;
      if (src.sn) lg[k].sn = src.sn;
    });

    var mergedAsset = Object.assign({}, previousAsset, {
      _lastPeriod: newReport.month_year,
      airframe: Object.assign({}, previousAsset.airframe || {}, {
        currentFH: parseHHMM(newReport.airframe && newReport.airframe.tsn),
        currentFC: newReport.airframe && newReport.airframe.csn
      }),
      engines: engines,
      landingGear: lg,
      apu: Object.assign({}, previousAsset.apu || {}, {
        sn: (newReport.apu && newReport.apu.sn) || (previousAsset.apu && previousAsset.apu.sn),
        currentFH: parseHHMM(newReport.apu && newReport.apu.tsn),
        currentFC: (newReport.apu && newReport.apu.csn != null)
          ? newReport.apu.csn
          : (previousAsset.apu && previousAsset.apu.currentFC)
      })
    });

    var allWarnings = snWarnings.concat(removalWarnings);
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
    monthsBetween: monthsBetween,
    checkDelta: checkDelta,
    checkDeltaFH: checkDeltaFH,
    detectSNChanges: detectSNChanges,
    formatSNWarnings: formatSNWarnings,
    formatRemovalWarnings: formatRemovalWarnings
  };
})();
