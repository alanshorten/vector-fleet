import React, { useState, useEffect, useRef } from 'react';
import { db } from '../lib/db';
import { FF_COLORS, addMonthsFF, buildFlyForwardProjection } from '../lib/flyForwardHelpers';
import { translateScenarioChat } from '../lib/extraction';
import { MiniLineChart } from './FlyForward';

// Guards against rapid-fire chat submission. Not cost-driven — a single
// call is a fraction of a cent — this is about Anthropic's own rate limits
// and a UX where sliders don't jump faster than a person can read them.
// Both are client-side only (no Firestore, no server tracking), matching
// Scenarios' fully non-destructive design — the sliders always keep
// working at zero AI cost even once the cap is hit.
const MAX_SCENARIO_CHATS_PER_SESSION = 20;
const MIN_SCENARIO_CHAT_INTERVAL_MS = 2000;

function colorForCode(code) {
  return FF_COLORS[(code || "").replace(/-/g, "")] || "#64748b";
}

// The single event actually driving the displayed shortfall figure — NOT
// necessarily the earliest one. Returns the whole event object so its
// date, cost band, and balanceAtEvent are always shown consistently with
// the shortfall number itself, rather than pairing a shortfall from one
// event with a date from another.
function worstEvent(projection) {
  if (!projection || !projection.events.length) return null;
  return projection.events.reduce((worst, e) => (!worst || e.shortfallHigh > worst.shortfallHigh) ? e : worst, null);
}

function eventDate(evt) {
  if (!evt) return null;
  return evt.dateWindow ? evt.dateWindow.start : evt.date;
}

// anchorReservePots (flyForwardHelpers.js) computes firstEventOverrideDate
// for engine_fh and calendar-check pots UNCONDITIONALLY — even when that
// date falls beyond the lease horizon and therefore never produces a
// visible event. This reads that always-available date, so "Beyond
// horizon" pots still show a real projected month instead of just a
// beyond/within label (Alan, live test, MSN 4821: "still doesn't say how
// much this advanced"). Falls back to null for pot types anchorReservePots
// doesn't override (e.g. AP-OH's apu_hours condition-based trigger).
function anchoredDateForCode(anchoredPots, code) {
  const p = (anchoredPots || []).find(a => a.code === code);
  return p && p.firstEventOverrideDate ? p.firstEventOverrideDate : null;
}

// Signed whole-month delta, from -> to. Negative = scenario event lands
// EARLIER than base case (brought forward); positive = later (pushed back).
function monthDelta(fromDate, toDate) {
  return (toDate.getFullYear() - fromDate.getFullYear()) * 12 + (toDate.getMonth() - fromDate.getMonth());
}

function formatShift(months) {
  if (months === 0) return "No change";
  return months < 0 ? `${Math.abs(months)} mo earlier` : `${months} mo later`;
}

// Whole-asset scope, not per-pot (layer3-scenarios-build-handoff.md §2) —
// utilisation and sector-length sliders reshape the same fhPerMonth/
// fcPerMonth pair that buildFlyForwardProjection already takes as ctx
// input, so every pot moves together exactly as it would with a real
// change in how the aircraft is flown. No Brain code touched.
function buildScenarioUtilRate(baseRate, utilPct, sectorPct) {
  if (!baseRate) return baseRate;
  const baseFh = baseRate.fhPerMonth || 0;
  const baseFc = baseRate.fcPerMonth || 0;
  const scenarioFh = Math.max(0, baseFh * (1 + utilPct / 100));
  const avgSectorHours = baseFc > 0 ? baseFh / baseFc : null;
  let scenarioFc;
  if (avgSectorHours && avgSectorHours > 0) {
    // Longer average sectors = fewer cycles for the same flying.
    const scenarioSectorHours = Math.max(0.01, avgSectorHours * (1 + sectorPct / 100));
    scenarioFc = scenarioFh / scenarioSectorHours;
  } else {
    scenarioFc = Math.max(0, baseFc * (1 + utilPct / 100));
  }
  return { ...baseRate, fhPerMonth: scenarioFh, fcPerMonth: scenarioFc };
}

function buildScenarioLease(lease, leaseExtMonths) {
  if (!lease || !leaseExtMonths) return lease;
  const extended = addMonthsFF(new Date(lease.leaseEnd), leaseExtMonths);
  return { ...lease, leaseEnd: extended.toISOString().slice(0, 10) };
}

// Sums balance across every pot for a given month index, for the
// portfolio-level "total reserve balance" chart. Scenario horizon can run
// longer than base case (lease-extension slider), so this pads with null
// rather than assuming equal lengths — Chart.js just stops that line early.
function aggregateBalanceSeries(projections) {
  if (!projections || !projections.length) return [];
  const length = Math.max(...projections.map(p => p.monthlySeries.length));
  const series = [];
  for (let i = 0; i < length; i++) {
    let total = 0;
    let date = null;
    let any = false;
    projections.forEach(p => {
      const m = p.monthlySeries[i];
      if (m) { total += m.balance; date = date || m.date; any = true; }
    });
    series.push(any ? { date, balance: total } : null);
  }
  return series;
}

function ScenarioSlider({ label, value, onChange, min, max, step, format }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 11, color: "#94a3b8" }}>{label}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: value === 0 ? "#64748b" : "#C9A84C" }}>{format ? format(value) : value}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width: "100%" }}/>
    </div>
  );
}

function Scenarios({ asset }) {
  const [loading, setLoading] = useState(true);
  const [lease, setLease] = useState(null);
  const [reserveDocs, setReserveDocs] = useState([]);
  const [utilRate, setUtilRate] = useState(null);
  const [scheduledEvents, setScheduledEvents] = useState([]);
  const [seasonalityProfile, setSeasonalityProfile] = useState(null);
  const [costProjections, setCostProjections] = useState([]);
  const [loadError, setLoadError] = useState(null);

  // The three levers. Escalation rate is deliberately never a slider here —
  // it's a periodic factual update reviewed against the real catalogue, not
  // a hypothetical (VECTORIQ_ROADMAP.md Deliberate Design Decisions).
  const [utilPct, setUtilPct] = useState(0);
  const [leaseExtMonths, setLeaseExtMonths] = useState(0);
  const [sectorPct, setSectorPct] = useState(0);

  const [chatText, setChatText] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState(null);
  const [chatNote, setChatNote] = useState(null);
  const [chatCount, setChatCount] = useState(0);
  const [chatInterpretation, setChatInterpretation] = useState(null);
  const lastChatAt = useRef(0);
  const chatCapped = chatCount >= MAX_SCENARIO_CHATS_PER_SESSION;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const [util, leaseData, reserves, schedEvts, seasonProfile, shopVisits] = await Promise.all([
          db.getUtilisation(asset.id).catch(() => []),
          asset.currentLeaseId ? db.getLease(asset.currentLeaseId).catch(() => null) : Promise.resolve(null),
          db.getReservePots(asset.id).catch(() => []),
          db.getScheduledEvents(asset.id).catch(() => []),
          db.getSeasonalityProfile(asset.id).catch(() => null),
          db.getShopVisitProjections(asset.id).catch(() => [])
        ]);
        if (cancelled) return;
        setUtilRate(window.computeRealUtilisationRate(util));
        setLease(leaseData);
        setReserveDocs(reserves);
        setScheduledEvents(schedEvts);
        setSeasonalityProfile(seasonProfile);
        setCostProjections(shopVisits);
      } catch (e) {
        if (!cancelled) setLoadError(true);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [asset.id, asset.currentLeaseId]);

  const resetScenario = () => {
    setUtilPct(0);
    setLeaseExtMonths(0);
    setSectorPct(0);
    setChatError(null);
    setChatNote(null);
    setChatInterpretation(null);
  };

  // Builds the "here's what I heard" caption shown right under the sliders
  // — always visible the instant a chat request applies, no separate
  // confirm step. Lets a misread be caught at a glance instead of only
  // showing up as an unexplained change in the numbers below.
  const describeInterpretation = (result) => {
    const parts = [];
    parts.push(result.utilisationPctChange === 0 ? "no change to utilisation" : `utilisation ${result.utilisationPctChange > 0 ? "+" : ""}${result.utilisationPctChange}%`);
    parts.push(result.leaseExtensionMonths === 0 ? "no change to lease length" : `lease +${result.leaseExtensionMonths} mo`);
    parts.push(result.sectorLengthPctChange === 0 ? "no change to sector length" : `sector length ${result.sectorLengthPctChange > 0 ? "+" : ""}${result.sectorLengthPctChange}%`);
    return `Applied from your last request: ${parts.join(", ")}.`;
  };

  // One scenario at a time (VECTORIQ_ROADMAP.md Deliberate Design
  // Decisions) — a new chat request always REPLACES the current lever
  // values, never adds to whatever was set before. This is what keeps a
  // misinterpretation easy to spot rather than compounding silently.
  const applyChat = async () => {
    if (!chatText.trim() || chatBusy) return;
    if (chatCapped) {
      setChatError("That's a lot of scenarios explored already — try the sliders above directly for more.");
      return;
    }
    const sinceLast = Date.now() - lastChatAt.current;
    if (sinceLast < MIN_SCENARIO_CHAT_INTERVAL_MS) {
      setChatError("One moment — please wait a couple of seconds between scenario requests.");
      return;
    }
    setChatBusy(true);
    setChatError(null);
    setChatNote(null);
    try {
      const result = await translateScenarioChat(chatText.trim());
      lastChatAt.current = Date.now();
      setChatCount(c => c + 1);
      setUtilPct(result.utilisationPctChange);
      setLeaseExtMonths(result.leaseExtensionMonths);
      setSectorPct(result.sectorLengthPctChange);
      setChatInterpretation(describeInterpretation(result));
      if (result.unmapped) setChatNote(result.unmapped);
    } catch (e) {
      setChatError(e.message || "Couldn't interpret that scenario.");
    }
    setChatBusy(false);
  };

  if (loading) {
    return <div style={{ padding: 40, textAlign: "center", color: "#64748b" }}>Loading scenario data for MSN {asset.msn}…</div>;
  }

  if (!asset.currentLeaseId) {
    return (
      <div style={{ animation: "fadeIn 0.2s ease" }}>
        <div className="card" style={{ padding: 24, textAlign: "center", color: "#94a3b8" }}>No active lease on this asset — Scenarios needs a lease and reserve pot data to project against.</div>
      </div>
    );
  }

  if (loadError || !lease) {
    return (
      <div style={{ animation: "fadeIn 0.2s ease" }}>
        <div className="card" style={{ padding: 24, textAlign: "center", color: "#f87171" }}>Could not load lease data for this asset.</div>
      </div>
    );
  }

  const scenarioActive = utilPct !== 0 || leaseExtMonths !== 0 || sectorPct !== 0;
  const scenarioUtilRate = buildScenarioUtilRate(utilRate, utilPct, sectorPct);
  const scenarioLease = buildScenarioLease(lease, leaseExtMonths);

  // Fully non-destructive — this never writes to Firestore, base case and
  // scenario are both computed fresh in memory every render.
  const basePF = buildFlyForwardProjection({ asset, lease, reserveDocs, utilRate, scheduledEvents, seasonalityProfile, costProjections });
  const scenarioPF = scenarioActive
    ? buildFlyForwardProjection({ asset, lease: scenarioLease, reserveDocs, utilRate: scenarioUtilRate, scheduledEvents, seasonalityProfile, costProjections })
    : basePF;

  if (basePF.projectionError || (scenarioActive && scenarioPF.projectionError)) {
    return (
      <div style={{ animation: "fadeIn 0.2s ease" }}>
        <div className="card" style={{ padding: 24, textAlign: "center", color: "#f87171" }}>
          Couldn't build the scenario projection: {basePF.projectionError || scenarioPF.projectionError}
        </div>
      </div>
    );
  }

  const baseSummary = window.summarisePortfolioShortfall(basePF.projections);
  const baseRiskPeaks = window.findPortfolioRiskPeaks(basePF.projections);
  const scenarioSummary = window.summarisePortfolioShortfall(scenarioPF.projections);
  const scenarioRiskPeaks = window.findPortfolioRiskPeaks(scenarioPF.projections);

  const allCodes = Array.from(new Set([...basePF.projections.map(p => p.code), ...scenarioPF.projections.map(p => p.code)]));
  const potRows = allCodes.map(code => {
    const b = basePF.projections.find(p => p.code === code);
    const s = scenarioPF.projections.find(p => p.code === code);
    const bWorst = worstEvent(b);
    const sWorst = worstEvent(s);
    // Real in-horizon event date if one exists, else the underlying
    // anchored date even when it falls beyond the horizon (Alan: "still
    // doesn't say how much this advanced" — this is the fix).
    const bDate = eventDate(bWorst) || anchoredDateForCode(basePF.anchoredPots, code);
    const sDate = eventDate(sWorst) || anchoredDateForCode(scenarioPF.anchoredPots, code);
    return {
      code,
      label: (s || b)?.label,
      baseTracked: !!b,
      scenarioTracked: !!s,
      baseInHorizon: !!bWorst,
      scenarioInHorizon: !!sWorst,
      baseHigh: bWorst ? bWorst.shortfallHigh : null,
      scenarioHigh: sWorst ? sWorst.shortfallHigh : null,
      baseCostLow: bWorst ? bWorst.costLow : null,
      baseCostHigh: bWorst ? bWorst.costHigh : null,
      baseBalance: bWorst ? bWorst.balanceAtEvent : null,
      scenarioCostLow: sWorst ? sWorst.costLow : null,
      scenarioCostHigh: sWorst ? sWorst.costHigh : null,
      scenarioBalance: sWorst ? sWorst.balanceAtEvent : null,
      baseDate: bDate,
      scenarioDate: sDate,
      shiftMonths: (bDate && sDate) ? monthDelta(bDate, sDate) : null
    };
  });

  const baseAgg = aggregateBalanceSeries(basePF.projections);
  const scenarioAgg = aggregateBalanceSeries(scenarioPF.projections);
  const chartLength = Math.max(baseAgg.length, scenarioAgg.length);
  const labelSource = Array.from({ length: chartLength }, (_, i) => scenarioAgg[i] || baseAgg[i]);
  const labels = labelSource.map(m => m ? m.date.toISOString().slice(0, 7) : "");
  const chartDatasets = [
    { label: "Base Case", data: Array.from({ length: chartLength }, (_, i) => baseAgg[i] ? Math.round(baseAgg[i].balance) : null), borderColor: "#64748b", backgroundColor: "#64748b22", fill: true, tension: 0.15, pointRadius: 0, borderWidth: 2 },
    { label: "Scenario", data: Array.from({ length: chartLength }, (_, i) => scenarioAgg[i] ? Math.round(scenarioAgg[i].balance) : null), borderColor: "#C9A84C", backgroundColor: "#C9A84C22", fill: true, tension: 0.15, pointRadius: 0, borderWidth: 2 }
  ];

  const fmtPct = v => (v > 0 ? "+" : "") + v + "%";
  const fmtMonths = v => v === 0 ? "No change" : `+${v} mo`;
  const shortfallColor = v => v == null ? "#475569" : (v > 0 ? "#f87171" : "#34d399");
  const deltaColor = (b, s) => {
    if (b == null && s == null) return "#475569";
    const bv = b || 0, sv = s || 0;
    if (sv > bv) return "#f87171";
    if (sv < bv) return "#34d399";
    return "#94a3b8";
  };

  return (
    <div style={{ animation: "fadeIn 0.2s ease" }}>
      <div style={{ background: "#0d1e33", border: "1px solid #1B3A6B", borderRadius: 10, padding: "12px 16px", marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0" }}>Scenarios — MSN {asset.msn}</div>
        <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
          Exploratory only — nothing here is saved. One scenario at a time; a new chat request replaces the current sliders rather than stacking on top of them. Escalation rates aren't adjustable here — they're reviewed yearly against the real catalogue, not a hypothetical.
        </div>
      </div>

      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", marginBottom: 12 }}>Adjust the scenario</div>
        <ScenarioSlider label="Utilisation change" value={utilPct} onChange={setUtilPct} min={-50} max={50} step={1} format={fmtPct}/>
        <ScenarioSlider label="Lease extension" value={leaseExtMonths} onChange={setLeaseExtMonths} min={0} max={36} step={1} format={fmtMonths}/>
        <ScenarioSlider label="Average sector length change" value={sectorPct} onChange={setSectorPct} min={-50} max={50} step={1} format={fmtPct}/>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button className="btn btn-ghost" style={{ fontSize: 12, padding: "6px 14px" }} disabled={!scenarioActive} onClick={resetScenario}>Reset to base case</button>
        </div>
      </div>

      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", marginBottom: 2 }}>💬 Ask TailiQ</div>
        <div style={{ fontSize: 11, color: "#64748b", marginBottom: 8 }}>Describe a scenario in plain English and it'll set the sliders above for you.</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input type="text" value={chatText} onChange={e => setChatText(e.target.value)}
            placeholder={'e.g. "lease extends 12 months" or "utilisation drops 20%"'}
            disabled={chatCapped}
            style={{ flex: 1, minWidth: 220, fontSize: 12, padding: "8px 10px" }}
            onKeyDown={e => { if (e.key === "Enter") applyChat(); }}/>
          <button className="btn btn-gold" style={{ fontSize: 12, padding: "8px 16px" }} disabled={chatBusy || chatCapped || !chatText.trim()} onClick={applyChat}>
            {chatBusy ? "Thinking…" : "Ask TailiQ"}
          </button>
        </div>
        {chatInterpretation && !chatError && <div style={{ marginTop: 8, fontSize: 11, color: "#94a3b8" }}>{chatInterpretation}</div>}
        {chatError && <div style={{ marginTop: 8, fontSize: 11, color: "#f87171" }}>{chatError}</div>}
        {chatNote && <div style={{ marginTop: 8, fontSize: 11, color: "#fbbf24" }}>ℹ {chatNote}</div>}
      </div>

      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", marginBottom: 12 }}>Total Reserve Balance — Base Case vs. Scenario</div>
        <MiniLineChart labels={labels} datasets={chartDatasets} height={240}/>
      </div>

      <div style={{ display: "flex", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
        <div className="card" style={{ padding: 16, flex: 1, minWidth: 240 }}>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>Base Case — Portfolio Shortfall</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: shortfallColor(baseSummary.grandTotalHigh) }}>
            ${Math.round(baseSummary.grandTotalLow).toLocaleString()} – ${Math.round(baseSummary.grandTotalHigh).toLocaleString()}
          </div>
        </div>
        <div className="card" style={{ padding: 16, flex: 1, minWidth: 240 }}>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>Scenario — Portfolio Shortfall</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: shortfallColor(scenarioSummary.grandTotalHigh) }}>
            ${Math.round(scenarioSummary.grandTotalLow).toLocaleString()} – ${Math.round(scenarioSummary.grandTotalHigh).toLocaleString()}
          </div>
          {scenarioActive && (
            <div style={{ fontSize: 11, marginTop: 4, color: deltaColor(baseSummary.grandTotalHigh, scenarioSummary.grandTotalHigh) }}>
              {scenarioSummary.grandTotalHigh > baseSummary.grandTotalHigh ? "▲" : scenarioSummary.grandTotalHigh < baseSummary.grandTotalHigh ? "▼" : "—"}{" "}
              ${Math.round(Math.abs(scenarioSummary.grandTotalHigh - baseSummary.grandTotalHigh)).toLocaleString()} vs. base case
            </div>
          )}
        </div>
      </div>

      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", marginBottom: 8 }}>Risk Peaks (earliest first)</div>
        {baseRiskPeaks.length === 0 && scenarioRiskPeaks.length === 0 && (
          <div style={{ fontSize: 12, color: "#64748b" }}>No risk peaks projected in either case.</div>
        )}
        {(scenarioActive ? scenarioRiskPeaks : baseRiskPeaks).map((r, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderTop: i > 0 ? "1px solid #1e3048" : "none", fontSize: 12 }}>
            <span style={{ color: "#e2e8f0" }}>{r.code} — {r.dateWindow ? `${r.dateWindow.start.toISOString().slice(0,7)} – ${r.dateWindow.end.toISOString().slice(0,7)}` : r.date.toISOString().slice(0, 7)}</span>
            <span style={{ color: r.severity === "high" ? "#f87171" : "#fbbf24" }}>
              {r.severity === "high" ? "High" : "Medium"} — ${Math.round(r.shortfallLow).toLocaleString()} to ${Math.round(r.shortfallHigh).toLocaleString()}
            </span>
          </div>
        ))}
        {scenarioActive && <div style={{ fontSize: 10, color: "#475569", marginTop: 8 }}>Showing scenario risk peaks. Base case had {baseRiskPeaks.length} risk peak{baseRiskPeaks.length===1?"":"s"}.</div>}
      </div>

      <div className="card" style={{ padding: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", marginBottom: 4 }}>Per-Pot Worst-Case Shortfall — Base vs. Scenario</div>
        <div style={{ fontSize: 11, color: "#64748b", marginBottom: 12 }}>Cost and balance shown underneath each figure are the exact inputs to that shortfall (cost − balance at event = shortfall) — check them directly rather than taking the total on faith. "Beyond horizon" pots still show the projected month the underlying date lands on, even though no event or cost applies yet at today's lease term.</div>
        <table style={{ fontSize: 12, width: "100%" }}>
          <thead><tr>
            <th style={{ color: "#64748b", textAlign: "left" }}>Pot</th>
            <th style={{ color: "#64748b", textAlign: "right" }}>Base Case</th>
            <th style={{ color: "#64748b", textAlign: "right" }}>Scenario</th>
            <th style={{ color: "#64748b", textAlign: "right" }}>Timing Shift</th>
          </tr></thead>
          <tbody>
            {potRows.map(row => (
              <tr key={row.code}>
                <td style={{ padding: "6px 0" }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: colorForCode(row.code), display: "inline-block", marginRight: 6 }}/>
                  {row.code} — {row.label}
                </td>
                <td style={{ textAlign: "right", verticalAlign: "top", padding: "6px 0" }}>
                  <div style={{ color: shortfallColor(row.baseHigh) }}>{row.baseHigh == null ? (row.baseTracked ? "Beyond horizon" : "—") : `$${Math.round(row.baseHigh).toLocaleString()}`}</div>
                  {row.baseDate && <div style={{ fontSize: 10, color: "#475569" }}>{row.baseInHorizon ? "" : "proj. "}{row.baseDate.toISOString().slice(0, 7)}</div>}
                  {row.baseInHorizon && <div style={{ fontSize: 10, color: "#64748b" }}>Cost ${Math.round(row.baseCostLow).toLocaleString()}–${Math.round(row.baseCostHigh).toLocaleString()} · Bal ${Math.round(row.baseBalance).toLocaleString()}</div>}
                </td>
                <td style={{ textAlign: "right", verticalAlign: "top", padding: "6px 0" }}>
                  <div style={{ color: scenarioActive ? deltaColor(row.baseHigh, row.scenarioHigh) : shortfallColor(row.scenarioHigh) }}>{row.scenarioHigh == null ? (row.scenarioTracked ? "Beyond horizon" : "—") : `$${Math.round(row.scenarioHigh).toLocaleString()}`}</div>
                  {row.scenarioDate && <div style={{ fontSize: 10, color: "#475569" }}>{row.scenarioInHorizon ? "" : "proj. "}{row.scenarioDate.toISOString().slice(0, 7)}</div>}
                  {row.scenarioInHorizon && <div style={{ fontSize: 10, color: "#64748b" }}>Cost ${Math.round(row.scenarioCostLow).toLocaleString()}–${Math.round(row.scenarioCostHigh).toLocaleString()} · Bal ${Math.round(row.scenarioBalance).toLocaleString()}</div>}
                </td>
                <td style={{ textAlign: "right", verticalAlign: "top", fontSize: 11, color: row.shiftMonths == null ? "#475569" : (row.shiftMonths < 0 ? "#f87171" : row.shiftMonths > 0 ? "#34d399" : "#64748b") }}>
                  {row.shiftMonths != null
                    ? formatShift(row.shiftMonths)
                    : (row.scenarioDate && !row.baseDate ? "Now within horizon" : (row.baseDate && !row.scenarioDate ? "No longer within horizon" : "—"))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export { Scenarios };
