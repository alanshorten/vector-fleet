import React, { useState, useEffect } from 'react';
import { db } from '../lib/db';
import { FF_COLORS, addMonthsFF, buildFlyForwardProjection } from '../lib/flyForwardHelpers';
import { MiniLineChart } from './FlyForward';
import { useLayoutMode } from '../lib/layoutMode';

function colorForCode(code) {
  return FF_COLORS[(code || "").replace(/-/g, "")] || "var(--color-graphite)";
}

function worstShortfallHigh(projection) {
  return projection && projection.events.length ? Math.max(...projection.events.map(e => e.shortfallHigh)) : null;
}

// Display-only sign flip, matching the convention locked for FlyForward's
// Reserve Position column: shows balance - cost instead of cost - balance,
// so positive reads as surplus and negative reads as shortfall. The
// underlying shortfallHigh values (and the color/delta comparisons that
// use them) are untouched — only this text rendering changes.
function formatPosition(v) {
  if (v == null) return null;
  const position = -v;
  return (position >= 0 ? "+" : "-") + "$" + Math.round(Math.abs(position)).toLocaleString();
}

// The first (earliest) projected event for a pot, used to show WHEN a
// scenario moves an event, not just what it costs — flagged as missing
// from the base-vs-scenario comparison table (Alan, live test, MSN 4821:
// "it doesn't show how far forward the SVs come compared to base case").
function earliestEvent(projection) {
  return projection && projection.events.length ? projection.events[0] : null;
}

function eventDate(evt) {
  if (!evt) return null;
  return evt.dateWindow ? evt.dateWindow.start : evt.date;
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

// Deterministic explanation — restored per-row "Explain" toggle
// (originally built in the Layer 3 chat-box session, lost when the chat
// box was replaced with structured controls; Alan flagged it missing —
// it was never part of the chat box's AI translation, it's a separate,
// always-available, zero-AI, zero-cost readout of numbers Brain 3
// already computed). Builds a plain-English sentence from a pot's
// earliest event: cost band, projected balance at that date, the
// resulting gap — and the scenario's own delta, if one's active.
function buildPotExplanation(row, scenarioActive) {
  const { code, label, bEvt, sEvt, shiftMonths } = row;
  if (!bEvt && !sEvt) {
    return `No projected event for ${code} within the current horizon — nothing to explain yet.`;
  }

  const describe = (evt, prefix) => {
    if (!evt) return `${prefix}: no event within horizon.`;
    const date = (evt.dateWindow ? evt.dateWindow.start : evt.date).toISOString().slice(0, 7);
    const cost = Math.round(evt.costHigh).toLocaleString();
    const balance = Math.round(evt.balanceAtEvent).toLocaleString();
    const gap = evt.shortfallHigh;
    const gapText = gap > 0
      ? `a shortfall of $${Math.round(gap).toLocaleString()} (the pot doesn't cover the high-case cost)`
      : `a surplus of $${Math.round(Math.abs(gap)).toLocaleString()} (the pot covers the high-case cost with room to spare)`;
    return `${prefix}: due ${date}, projected high-case cost $${cost} against a projected pot balance of $${balance} — ${gapText}.`;
  };

  const lines = [describe(bEvt, "Base case")];
  if (scenarioActive) {
    lines.push(describe(sEvt, "Scenario"));
    if (shiftMonths != null && shiftMonths !== 0) {
      lines.push(`This scenario moves the event ${formatShift(shiftMonths)} compared to base case.`);
    }
  }
  return lines.join(" ");
}

function ScenarioSlider({ label, value, onChange, min, max, step, format }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 11, color: "var(--color-graphite)" }}>{label}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: value === 0 ? "var(--color-graphite)" : "var(--color-teal)" }}>{format ? format(value) : value}</span>
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

  // The three original levers. Escalation rate is deliberately never a
  // slider here — it's a periodic factual update reviewed against the
  // real catalogue, not a hypothetical (VECTORIQ_ROADMAP.md Deliberate
  // Design Decisions).
  const [utilPct, setUtilPct] = useState(0);
  const [leaseExtMonths, setLeaseExtMonths] = useState(0);
  const [sectorPct, setSectorPct] = useState(0);

  // Structured controls (scenarios-structured-controls-handoff.md §1) —
  // replace the never-built chat box. AOG and lessee default share the
  // same start/duration shape but modify different axes (see
  // flyForward.js's monthlyAccrual and flyForwardHelpers.js's
  // buildWindowAvailabilityVector for why they're kept separate).
  const [aogStartMonth, setAogStartMonth] = useState(0);
  const [aogDurationMonths, setAogDurationMonths] = useState(0);
  const [defaultStartMonth, setDefaultStartMonth] = useState(0);
  const [defaultDurationMonths, setDefaultDurationMonths] = useState(0);
  // Per-pot cost overrun %, keyed by pot code. Default state: no entry
  // for a code = 0% (no overrun) — only rows with a projected event
  // appear in the table, so this never invents an event that doesn't
  // exist in the base projection.
  const [costOverrunByCode, setCostOverrunByCode] = useState({});

  // Per-pot toggle for the restored Explain feature — which row (if any)
  // has its deterministic explanation expanded. Independent of any
  // scenario state; works identically whether a scenario is active or not.
  const [explainedCode, setExplainedCode] = useState(null);
  const { mode: layoutMode, width: layoutWidth } = useLayoutMode();

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
    setAogStartMonth(0);
    setAogDurationMonths(0);
    setDefaultStartMonth(0);
    setDefaultDurationMonths(0);
    setCostOverrunByCode({});
  };

  if (loading) {
    return <div style={{ padding: 40, textAlign: "center", color: "var(--color-graphite)" }}>Loading scenario data for MSN {asset.msn}…</div>;
  }

  if (!asset.currentLeaseId) {
    return (
      <div style={{ animation: "fadeIn 0.2s ease" }}>
        <div className="card" style={{ padding: 24, textAlign: "center", color: "var(--color-graphite)" }}>No active lease on this asset — Scenarios needs a lease and reserve pot data to project against.</div>
      </div>
    );
  }

  if (loadError || !lease) {
    return (
      <div style={{ animation: "fadeIn 0.2s ease" }}>
        <div className="card" style={{ padding: 24, textAlign: "center", color: "var(--color-critical)" }}>Could not load lease data for this asset.</div>
      </div>
    );
  }

  const hasCostOverrun = Object.values(costOverrunByCode).some(v => v);
  const scenarioActive = utilPct !== 0 || leaseExtMonths !== 0 || sectorPct !== 0 || aogDurationMonths > 0 || defaultDurationMonths > 0 || hasCostOverrun;
  const scenarioUtilRate = buildScenarioUtilRate(utilRate, utilPct, sectorPct);
  const scenarioLease = buildScenarioLease(lease, leaseExtMonths);
  const scenarioModifiers = {
    aogWindow: aogDurationMonths > 0 ? { startMonth: aogStartMonth, durationMonths: aogDurationMonths } : null,
    lesseeDefaultWindow: defaultDurationMonths > 0 ? { startMonth: defaultStartMonth, durationMonths: defaultDurationMonths } : null,
    costOverrides: hasCostOverrun ? costOverrunByCode : null
  };

  // Fully non-destructive — this never writes to Firestore, base case and
  // scenario are both computed fresh in memory every render. Base case
  // never receives scenarioModifiers — only the scenario side does.
  const basePF = buildFlyForwardProjection({ asset, lease, reserveDocs, utilRate, scheduledEvents, seasonalityProfile, costProjections });
  const scenarioPF = scenarioActive
    ? buildFlyForwardProjection({ asset, lease: scenarioLease, reserveDocs, utilRate: scenarioUtilRate, scheduledEvents, seasonalityProfile, costProjections, scenarioModifiers })
    : basePF;

  if (basePF.projectionError || (scenarioActive && scenarioPF.projectionError)) {
    return (
      <div style={{ animation: "fadeIn 0.2s ease" }}>
        <div className="card" style={{ padding: 24, textAlign: "center", color: "var(--color-critical)" }}>
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
    const bEvt = earliestEvent(b);
    const sEvt = earliestEvent(s);
    const bDate = eventDate(bEvt);
    const sDate = eventDate(sEvt);
    return {
      code,
      label: (s || b)?.label,
      baseHigh: worstShortfallHigh(b),
      scenarioHigh: worstShortfallHigh(s),
      baseTracked: !!b,
      scenarioTracked: !!s,
      baseDate: bDate,
      scenarioDate: sDate,
      shiftMonths: (bDate && sDate) ? monthDelta(bDate, sDate) : null,
      // Raw earliest-event objects (costLow/costLikely/costHigh,
      // balanceAtEvent, shortfallLow/shortfallHigh) — carried through so
      // the Explain toggle can build its sentence from numbers Brain 3
      // already computed, not a second lookup or a re-derivation.
      bEvt, sEvt
    };
  });

  const baseAgg = aggregateBalanceSeries(basePF.projections);
  const scenarioAgg = aggregateBalanceSeries(scenarioPF.projections);
  const chartLength = Math.max(baseAgg.length, scenarioAgg.length);
  const labelSource = Array.from({ length: chartLength }, (_, i) => scenarioAgg[i] || baseAgg[i]);
  const labels = labelSource.map(m => m ? m.date.toISOString().slice(0, 7) : "");
  const chartDatasets = [
    // Chart.js draws straight to canvas — it can't resolve CSS custom
    // properties, so these stay literal hex matched to the design system.
    // Plain lines, no fill — Base Case in graphite, Scenario in a clearly
    // distinct hue (amber) so the two series are easy to tell apart at a
    // glance without relying on a dashed stroke.
    { label: "Base Case", data: Array.from({ length: chartLength }, (_, i) => baseAgg[i] ? Math.round(baseAgg[i].balance) : null), borderColor: "#687078", backgroundColor: "#687078", fill: false, tension: 0.15, pointRadius: 0, borderWidth: 2 },
    { label: "Scenario", data: Array.from({ length: chartLength }, (_, i) => scenarioAgg[i] ? Math.round(scenarioAgg[i].balance) : null), borderColor: "#C77E1E", backgroundColor: "#C77E1E", fill: false, tension: 0.15, pointRadius: 0, borderWidth: 2 }
  ];

  const fmtPct = v => (v > 0 ? "+" : "") + v + "%";
  const fmtMonths = v => v === 0 ? "No change" : `+${v} mo`;
  const shortfallColor = v => v == null ? "var(--color-divider)" : (v > 0 ? "var(--color-critical)" : "var(--color-positive)");
  const deltaColor = (b, s) => {
    if (b == null && s == null) return "var(--color-divider)";
    const bv = b || 0, sv = s || 0;
    if (sv > bv) return "var(--color-critical)";
    if (sv < bv) return "var(--color-positive)";
    return "var(--color-graphite)";
  };

  return (
    <div style={{ animation: "fadeIn 0.2s ease" }}>

      {/* Top section — 2-column grid on landscape.
          Left col: description card (top) + sliders card (bottom), stacked.
          Right col: per-pot table card, full height matching both left cards. */}
      <div style={layoutMode === "landscape"
        ? { display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 16, marginBottom: 16, alignItems: "stretch" }
        : undefined}>

        {/* Left column — description + sliders stacked */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Description */}
          <div style={{ background: "var(--color-teal-tint)", border: "1px solid var(--color-teal)", borderRadius: 10, padding: "12px 16px" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-carbon)" }}>Scenarios — MSN {asset.msn}</div>
            <div style={{ fontSize: 12, color: "var(--color-graphite)", marginTop: 2 }}>
              Exploratory only — nothing here is saved. Escalation rates aren't adjustable here — they're reviewed yearly against the real catalogue, not a hypothetical.
            </div>
          </div>

          {/* Sliders */}
          <div className="card" style={{ padding: 16, flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-carbon)", marginBottom: 12 }}>Adjust the scenario</div>
            <ScenarioSlider label="Utilisation change" value={utilPct} onChange={setUtilPct} min={-50} max={50} step={1} format={fmtPct}/>
            <ScenarioSlider label="Lease extension" value={leaseExtMonths} onChange={setLeaseExtMonths} min={0} max={36} step={1} format={fmtMonths}/>
            <ScenarioSlider label="Average sector length change" value={sectorPct} onChange={setSectorPct} min={-50} max={50} step={1} format={fmtPct}/>

            <div style={{ borderTop: "1px solid var(--color-divider-inner)", marginTop: 4, paddingTop: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--color-carbon)", marginBottom: 8 }}>AOG window</div>
              <div style={{ fontSize: 11, color: "var(--color-graphite)", marginBottom: 10 }}>Grounds the aircraft for a period — usage-basis pots freeze, calendar-basis pots keep accruing (same as a C-Check grounding).</div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <label style={{ fontSize: 11, color: "var(--color-graphite)", flex: 1, minWidth: 140 }}>
                  Starts (months from now)
                  <input type="number" min="0" step="1" value={aogStartMonth} onChange={e => setAogStartMonth(Math.max(0, Number(e.target.value) || 0))}
                    style={{ display: "block", width: "100%", marginTop: 4, fontSize: 13, padding: "7px 9px" }}/>
                </label>
                <label style={{ fontSize: 11, color: "var(--color-graphite)", flex: 1, minWidth: 140 }}>
                  Duration (months)
                  <input type="number" min="0" step="1" value={aogDurationMonths} onChange={e => setAogDurationMonths(Math.max(0, Number(e.target.value) || 0))}
                    style={{ display: "block", width: "100%", marginTop: 4, fontSize: 13, padding: "7px 9px" }}/>
                </label>
              </div>
            </div>

            <div style={{ borderTop: "1px solid var(--color-divider-inner)", marginTop: 14, paddingTop: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--color-carbon)", marginBottom: 8 }}>Lessee default</div>
              <div style={{ fontSize: 11, color: "var(--color-graphite)", marginBottom: 10 }}>Suspends reserve accrual across every pot for a period — usage continues (the aircraft keeps flying), the lessee just isn't paying into any account.</div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <label style={{ fontSize: 11, color: "var(--color-graphite)", flex: 1, minWidth: 140 }}>
                  Starts (months from now)
                  <input type="number" min="0" step="1" value={defaultStartMonth} onChange={e => setDefaultStartMonth(Math.max(0, Number(e.target.value) || 0))}
                    style={{ display: "block", width: "100%", marginTop: 4, fontSize: 13, padding: "7px 9px" }}/>
                </label>
                <label style={{ fontSize: 11, color: "var(--color-graphite)", flex: 1, minWidth: 140 }}>
                  Duration (months)
                  <input type="number" min="0" step="1" value={defaultDurationMonths} onChange={e => setDefaultDurationMonths(Math.max(0, Number(e.target.value) || 0))}
                    style={{ display: "block", width: "100%", marginTop: 4, fontSize: 13, padding: "7px 9px" }}/>
                </label>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
              <button className="btn btn-ghost" style={{ fontSize: 12, padding: "6px 14px" }} disabled={!scenarioActive} onClick={resetScenario}>Reset to base case</button>
            </div>
          </div>
        </div>

        {/* Right column — per-pot table, full height */}
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-carbon)", marginBottom: 4 }}>Per-Pot Reserve Position (Worst Case) — Base vs. Scenario</div>
          <div style={{ fontSize: 11, color: "var(--color-graphite)", marginBottom: 12 }}>Timing shift shows how many months the same projected event moves under this scenario — a pot showing "Beyond horizon" in base case had no event within the lease term until the scenario pulled it forward. Cost Overrun nudges that specific event's estimated cost up or down — default 0% on every row, only rows with a projected event get one.</div>
          <table style={{ fontSize: 12, width: "100%" }}>
            <thead><tr>
              <th style={{ color: "var(--color-graphite)", textAlign: "left" }}>Pot</th>
              <th style={{ color: "var(--color-graphite)", textAlign: "right" }}>Base Case</th>
              <th style={{ color: "var(--color-graphite)", textAlign: "right" }}>Scenario</th>
              <th style={{ color: "var(--color-graphite)", textAlign: "right" }}>Timing Shift</th>
              <th style={{ color: "var(--color-graphite)", textAlign: "right" }}>Cost Overrun</th>
            </tr></thead>
            <tbody>
              {potRows.map(row => (
                <React.Fragment key={row.code}>
                <tr>
                  <td style={{ padding: "6px 0" }}>
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: colorForCode(row.code), display: "inline-block", marginRight: 6 }}/>
                    {row.code} — {row.label}
                    {(row.bEvt || row.sEvt) && (
                      <button className="btn btn-ghost" style={{ fontSize: 10, padding: "1px 6px", marginLeft: 8 }}
                        onClick={() => setExplainedCode(explainedCode === row.code ? null : row.code)}>
                        {explainedCode === row.code ? "Explain ▴" : "Explain ▾"}
                      </button>
                    )}
                  </td>
                  <td style={{ textAlign: "right", color: row.baseHigh == null ? (row.baseTracked ? "var(--color-graphite)" : "var(--color-divider)") : shortfallColor(row.baseHigh) }}>
                    {row.baseHigh == null ? (row.baseTracked ? "Beyond horizon" : "—") : formatPosition(row.baseHigh)}
                    {row.baseDate && <div style={{ fontSize: 10, color: "var(--color-graphite)" }}>{row.baseDate.toISOString().slice(0, 7)}</div>}
                  </td>
                  <td style={{ textAlign: "right", color: row.scenarioHigh == null ? (row.scenarioTracked ? "var(--color-graphite)" : "var(--color-divider)") : (scenarioActive ? deltaColor(row.baseHigh, row.scenarioHigh) : shortfallColor(row.scenarioHigh)) }}>
                    {row.scenarioHigh == null ? (row.scenarioTracked ? "Beyond horizon" : "—") : formatPosition(row.scenarioHigh)}
                    {row.scenarioDate && <div style={{ fontSize: 10, color: "var(--color-graphite)" }}>{row.scenarioDate.toISOString().slice(0, 7)}</div>}
                  </td>
                  <td style={{ textAlign: "right", fontSize: 11, color: row.shiftMonths == null ? ((row.scenarioDate || row.baseDate) ? "var(--color-graphite)" : "var(--color-divider)") : (row.shiftMonths < 0 ? "var(--color-critical)" : row.shiftMonths > 0 ? "var(--color-positive)" : "var(--color-graphite)") }}>
                    {row.shiftMonths != null
                      ? formatShift(row.shiftMonths)
                      : (row.scenarioDate && !row.baseDate ? "Now within horizon" : (row.baseDate && !row.scenarioDate ? "No longer within horizon" : "—"))}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {row.baseTracked ? (
                      (row.baseHigh == null && row.scenarioHigh == null) ? (
                        <input type="number" step="1" placeholder="0%" value={costOverrunByCode[row.code] || ""}
                          title="No projected event in the current horizon yet — this won't have a visible effect until something (e.g. Utilisation change) pulls an event within the lease term."
                          onChange={e => {
                            const v = e.target.value === "" ? undefined : Number(e.target.value);
                            setCostOverrunByCode(prev => {
                              const next = { ...prev };
                              if (!v) delete next[row.code]; else next[row.code] = v;
                              return next;
                            });
                          }}
                          style={{ width: 60, fontSize: 12, padding: "4px 6px", textAlign: "right", opacity: 0.45 }}/>
                      ) : (
                        <input type="number" step="1" placeholder="0%" value={costOverrunByCode[row.code] || ""}
                          onChange={e => {
                            const v = e.target.value === "" ? undefined : Number(e.target.value);
                            setCostOverrunByCode(prev => {
                              const next = { ...prev };
                              if (!v) delete next[row.code]; else next[row.code] = v;
                              return next;
                            });
                          }}
                          style={{ width: 60, fontSize: 12, padding: "4px 6px", textAlign: "right" }}/>
                      )
                    ) : <span style={{ color: "var(--color-divider)" }}>—</span>}
                  </td>
                </tr>
                {explainedCode === row.code && (
                  <tr>
                    <td colSpan={5} style={{ padding: "0 0 10px 0" }}>
                      <div style={{ background: "var(--color-teal-tint)", border: "1px solid var(--color-teal)", borderRadius: 8, padding: "10px 12px", fontSize: 11, color: "var(--color-graphite)", lineHeight: 1.6 }}>
                        {buildPotExplanation(row, scenarioActive)}
                      </div>
                    </td>
                  </tr>
                )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Total Reserve Balance chart — full width */}
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-carbon)", marginBottom: 12 }}>Total Reserve Balance — Base Case vs. Scenario</div>
        <MiniLineChart labels={labels} datasets={chartDatasets} height={240}/>
      </div>

      {/* Bottom — 3-column grid: base case | scenario | risk peaks */}
      <div style={layoutMode === "landscape"
        ? { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", columnGap: 16, alignItems: "stretch" }
        : undefined}>
        <div className="card" style={{ padding: 16, marginBottom: layoutMode === "landscape" ? 0 : 16 }}>
          <div style={{ fontSize: 11, color: "var(--color-graphite)", marginBottom: 6 }}>Base Case — Portfolio Shortfall</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: shortfallColor(baseSummary.grandTotalHigh) }}>
            ${Math.round(baseSummary.grandTotalLow).toLocaleString()} – ${Math.round(baseSummary.grandTotalHigh).toLocaleString()}
          </div>
        </div>
        <div className="card" style={{ padding: 16, marginBottom: layoutMode === "landscape" ? 0 : 16 }}>
          <div style={{ fontSize: 11, color: "var(--color-graphite)", marginBottom: 6 }}>Scenario — Portfolio Shortfall</div>
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
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-carbon)", marginBottom: 8 }}>Risk Peaks (earliest first)</div>
          {baseRiskPeaks.length === 0 && scenarioRiskPeaks.length === 0 && (
            <div style={{ fontSize: 12, color: "var(--color-graphite)" }}>No risk peaks projected in either case.</div>
          )}
          {(scenarioActive ? scenarioRiskPeaks : baseRiskPeaks).map((r, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderTop: i > 0 ? "1px solid var(--color-divider-inner)" : "none", fontSize: 12 }}>
              <span style={{ color: "var(--color-carbon)" }}>{r.code} — {r.dateWindow ? `${r.dateWindow.start.toISOString().slice(0,7)} – ${r.dateWindow.end.toISOString().slice(0,7)}` : r.date.toISOString().slice(0, 7)}</span>
              <span style={{ color: r.severity === "high" ? "var(--color-critical)" : "var(--color-attention)" }}>
                {r.severity === "high" ? "High" : "Medium"} — ${Math.round(r.shortfallLow).toLocaleString()} to ${Math.round(r.shortfallHigh).toLocaleString()}
              </span>
            </div>
          ))}
          {scenarioActive && <div style={{ fontSize: 10, color: "var(--color-graphite)", marginTop: 8 }}>Showing scenario risk peaks. Base case had {baseRiskPeaks.length} risk peak{baseRiskPeaks.length===1?"":"s"}.</div>}
        </div>
      </div>
    </div>
  );
}

export { Scenarios, ScenarioSlider };