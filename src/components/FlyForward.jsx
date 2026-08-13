import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { PotNumInput } from './AssetView';
import { LeaseWizard } from './LeaseWizard';
import { isCFM } from '../lib/assetHelpers';
import { db } from '../lib/db';
import { FF_COLORS, buildAssetMaintenanceCalendar, buildFlyForwardProjection } from '../lib/flyForwardHelpers';
import { useLayoutMode } from '../lib/layoutMode';
import { getEndOfLeaseTermsDefaults } from '../lib/knowledgeBase';

const MONTH_LABELS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function colorForCode(code) {
  return FF_COLORS[(code || "").replace(/-/g, "")] || "var(--color-graphite)";
}

// --- SV Cost Tracker (monthly-report-cost-tracker-handoff.md §2, TECH_DEBT.md 4.101) ---
const MRO_REGIONS = ["Eastern Europe", "Western Europe", "Asia-Pacific", "Americas", "Middle East/Africa"];

// SV number only means anything for engine/APU pots (EN-PR/EN-LP/AP-OH) —
// airframe/LG checks aren't "shop visits" in the same sense and have no
// meaningful 1st/2nd/3rd sequence for benchmarking.
function isEngineOrAPUCode(code) {
  return /^(EN-PR|EN-LP|AP-OH)/.test(code || "");
}

// Asset age at event, derived from the same MM/YYYY dom field the
// Overview tab already reads (asset.dom) — no new field needed. Returns
// null (not 0) when dom is missing/unparseable, so a genuinely unknown
// age never gets silently recorded as a real number.
function assetAgeYearsAt(asset, eventDate) {
  const dom = asset?.dom;
  if (!dom) return null;
  let domDate;
  if (/^\d{2}\/\d{4}$/.test(dom)) {
    const [mm, yyyy] = dom.split("/");
    domDate = new Date(Number(yyyy), Number(mm) - 1, 1);
  } else {
    domDate = new Date(dom);
  }
  if (isNaN(domDate.getTime())) return null;
  const years = (eventDate.getTime() - domDate.getTime()) / (365.25 * 86400000);
  return Math.round(years * 10) / 10;
}

function MaintenanceCalendarGrid({ events }) {
  const [hover, setHover] = useState(null); // {year, month, evts, x, y}
  const { mode: layoutMode } = useLayoutMode();
  if (!events.length) return null;

  const byYear = {};
  events.forEach(evt => {
    const y = evt.date.getFullYear();
    const m = evt.date.getMonth();
    byYear[y] = byYear[y] || Array.from({ length: 12 }, () => []);
    byYear[y][m].push(evt);
  });
  const years = Object.keys(byYear).map(Number).sort((a, b) => a - b);
  // Landscape gets slightly larger cells/labels/dots — same 12-column grid,
  // just using the extra horizontal room a wide screen already has rather
  // than leaving it as dead space (Alan, live review of the fleet Calendar
  // tab). Portrait sizing is untouched.
  const wide = layoutMode === "landscape";
  const cellPad = wide ? "12px 6px" : "8px 4px";
  const labelSize = wide ? 10 : 9;
  const dotSize = wide ? 9 : 7;

  return (
    <div className="card" style={{ padding: 16, marginBottom: 16, position: "relative" }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-carbon)", marginBottom: 12 }}>Calendar Overview</div>
      {years.map(year => (
        <div key={year} style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-graphite)", marginBottom: 6 }}>{year}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 4 }}>
            {MONTH_LABELS.map((label, m) => {
              const evts = byYear[year][m];
              return (
                <div key={m}
                  onMouseEnter={e => evts.length && setHover({ year, month: m, evts, x: e.currentTarget.offsetLeft, y: e.currentTarget.offsetTop })}
                  onMouseLeave={() => setHover(null)}
                  style={{ border: "1px solid var(--color-divider)", borderRadius: 6, padding: cellPad, textAlign: "center", cursor: evts.length ? "pointer" : "default", background: evts.length ? "var(--color-technical-grey)" : "transparent" }}>
                  <div style={{ fontSize: labelSize, color: "var(--color-graphite)", marginBottom: 4 }}>{label}</div>
                  {evts.length > 0 && (
                    <div style={{ display: "flex", justifyContent: "center", gap: 2, flexWrap: "wrap" }}>
                      {evts.slice(0, 3).map((e, i) => (
                        <span key={i} style={{ width: dotSize, height: dotSize, borderRadius: "50%", background: colorForCode(e.code), display: "inline-block" }}/>
                      ))}
                      {evts.length > 3 && <span style={{ fontSize: 8, color: "var(--color-graphite)" }}>+{evts.length - 3}</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {hover && (
        <div style={{ position: "absolute", top: hover.y + 40, left: Math.min(hover.x, 700), zIndex: 20, background: "var(--color-soft-white)", border: "1px solid var(--color-divider)", borderRadius: 8, padding: 10, boxShadow: "0 4px 16px rgba(21,26,29,0.16)", minWidth: 200, pointerEvents: "none" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--color-graphite)", marginBottom: 6 }}>{MONTH_LABELS[hover.month]} {hover.year}</div>
          {hover.evts.map((e, i) => (
            <div key={i} style={{ marginBottom: i < hover.evts.length - 1 ? 8 : 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--color-carbon)" }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: colorForCode(e.code), display: "inline-block", marginRight: 6 }}/>
                {e.msn ? `MSN ${e.msn} — ` : ""}{e.code} — {e.label}
              </div>
              <div style={{ fontSize: 11, color: "var(--color-graphite)" }}>{e.date.toISOString().slice(0, 10)}{e.grounding ? ` · grounds ${e.durationWeeks}wk` : ""}</div>
              {e.cost && <div style={{ fontSize: 11, color: "var(--color-graphite)" }}>${Math.round(e.cost.projectedCostLow).toLocaleString()}–${Math.round(e.cost.projectedCostHigh).toLocaleString()}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// leaseEndIdx: index in labels[] where the lease ends. When supplied,
// draws a vertical divider line + "Lease end · Accruals stop" label,
// and the post-lease region gets a muted grey background fill.
function MiniLineChart({ labels, datasets, height, leaseEndIdx }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);
  useEffect(() => {
    if (!window.Chart || !canvasRef.current) return;
    if (chartRef.current) chartRef.current.destroy();

    // Inline Chart.js plugin — draws the lease-end divider + shaded
    // post-lease region directly on the canvas after each render.
    // No external annotation plugin needed.
    const leaseEndPlugin = (typeof leaseEndIdx === "number" && leaseEndIdx >= 0) ? {
      id: "leaseEndDivider",
      afterDraw(chart) {
        const { ctx, chartArea: { top, bottom }, scales: { x } } = chart;
        if (!x || leaseEndIdx >= labels.length) return;

        // x-pixel position for the lease-end tick — category scale needs
        // the label string, not the numeric index
        const xPx = x.getPixelForValue(labels[leaseEndIdx]);

        // Muted shading over the post-lease region — carbon-tint-05,
        // matched to the light "technical grey" theme (TAILIQ_UI_DESIGN_SYSTEM.md).
        // Canvas fillStyle/strokeStyle can't resolve CSS custom properties,
        // so these stay literal hex/rgba rather than var(--color-*).
        ctx.save();
        ctx.fillStyle = "rgba(21,26,29,0.05)";
        ctx.fillRect(xPx, top, chart.chartArea.right - xPx, bottom - top);

        // Vertical divider line
        ctx.beginPath();
        ctx.strokeStyle = "#687078";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.moveTo(xPx, top);
        ctx.lineTo(xPx, bottom);
        ctx.stroke();
        ctx.setLineDash([]);

        // Label — two lines: "Lease end" + "Accruals stop"
        ctx.font = "bold 9px sans-serif";
        ctx.fillStyle = "#687078";
        ctx.textAlign = "left";
        const labelX = xPx + 4;
        ctx.fillText("Lease end", labelX, top + 12);
        ctx.font = "9px sans-serif";
        ctx.fillStyle = "#687078";
        ctx.fillText("Accruals stop", labelX, top + 23);
        ctx.restore();
      }
    } : null;

    chartRef.current = new window.Chart(canvasRef.current, {
      type: "line",
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { labels: { color: "#687078", font: { size: 11 }, boxWidth: 12 } },
          tooltip: {
            callbacks: {
              label: ctx => {
                const v = ctx.parsed.y;
                if (v === null || v === undefined) return null;
                return `${ctx.dataset.label}: $${Math.round(v).toLocaleString()}`;
              }
            }
          }
        },
        scales: {
          x: { ticks: { color: "#687078", font: { size: 10 }, maxTicksLimit: 12 }, grid: { color: "#E8E7E2" } },
          y: {
            ticks: { color: "#687078", font: { size: 10 }, callback: v => "$" + (v / 1000).toFixed(0) + "k" },
            grid: { color: "#E8E7E2" }
          }
        }
      },
      plugins: leaseEndPlugin ? [leaseEndPlugin] : []
    });
    return () => { if (chartRef.current) chartRef.current.destroy(); };
  }, [labels, JSON.stringify(datasets), leaseEndIdx]);
  return <div style={{ height: height || 220 }}><canvas ref={canvasRef}/></div>;
};

// addMonthsToDate: pure JS date helper used only in FFPotCard for chart
// extension — no Brain dependency needed, just month arithmetic.
function addMonthsToDate(date, n) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + n);
  return d;
}

function FFPotCard({ projection, color, anchored }) {
  const note = projection.partialFundedNote;

  // --- Base series (within lease) ---
  const baseLabels = projection.monthlySeries.map(m => m.date.toISOString().slice(0, 7));
  const baseBalance = projection.monthlySeries.map(m => Math.round(m.balance));
  const leaseEndIdx = baseLabels.length - 1; // last point of the within-lease series

  // --- Post-lease extension ---
  // When partialFundedNote exists (non-LLP pots), extend the chart from
  // lease end to the next event with a flat frozen balance line.
  // Cap the extension at 6 months past lease end to avoid compressing the
  // within-lease chart: if the event is further than 6 months out, we show
  // 5 flat months then jump to an event stub at month 6 labelled with the
  // real date. The broken-axis effect is visual only — the label at the
  // event dot carries the real date so there's no ambiguity.
  const POST_LEASE_MAX_MONTHS = 6;

  let labels = baseLabels;
  let balanceData = baseBalance;
  let eventPoints = projection.monthlySeries.map(() => null);
  let hasPostLease = false;

  if (note && note.costLikely != null && projection.events.length === 0) {
    hasPostLease = true;
    const leaseEndDate = projection.monthlySeries[projection.monthlySeries.length - 1].date;
    const frozenBalance = baseBalance[baseBalance.length - 1];

    // How many months from lease end to the next event?
    const monthsToEvent = Math.round(
      (note.date.getFullYear() - leaseEndDate.getFullYear()) * 12 +
      (note.date.getMonth() - leaseEndDate.getMonth())
    );
    const stubMonths = Math.min(monthsToEvent, POST_LEASE_MAX_MONTHS);
    const compressed = monthsToEvent > POST_LEASE_MAX_MONTHS;

    // Build the flat post-lease stub labels + balance
    const stubLabels = [];
    const stubBalance = [];
    for (let i = 1; i <= stubMonths; i++) {
      const d = addMonthsToDate(leaseEndDate, i);
      // If compressed, label the final stub month with the real event date
      // so the user sees the actual year-month, not a fake compressed one
      if (compressed && i === stubMonths) {
        stubLabels.push(note.date.toISOString().slice(0, 7));
      } else {
        stubLabels.push(d.toISOString().slice(0, 7));
      }
      stubBalance.push(frozenBalance);
    }

    labels = [...baseLabels, ...stubLabels];
    balanceData = [...baseBalance, ...stubBalance];

    // Event dots — within-lease events on their original indices,
    // post-lease event dot at the final stub position
    const withinLeaseEventPoints = projection.monthlySeries.map(m => {
      const e = projection.events.find(ev => ev.monthIndex === m.monthIndex);
      return e ? e.costLikely : null;
    });
    const stubEventPoints = stubLabels.map((_, i) =>
      i === stubLabels.length - 1 ? note.costLikely : null
    );
    eventPoints = [...withinLeaseEventPoints, ...stubEventPoints];
  } else {
    // No post-lease extension — map within-lease event dots normally
    const eventLikelyByMonth = {};
    projection.events.forEach(e => { eventLikelyByMonth[e.monthIndex] = e.costLikely; });
    eventPoints = projection.monthlySeries.map(m => eventLikelyByMonth[m.monthIndex] ?? null);
  }

  // Post-lease balance line: muted colour, dashed. Canvas-bound Chart.js
  // colors — literal hex, matched to the design system (graphite for the
  // frozen line, carbon for the event-cost marker so it stands out against
  // the light card background instead of disappearing into it).
  const datasets = hasPostLease ? [
    {
      label: "Projected Balance",
      data: balanceData.slice(0, leaseEndIdx + 1),
      borderColor: color,
      backgroundColor: color + "22",
      fill: true,
      tension: 0.15,
      pointRadius: 0,
      borderWidth: 2
    },
    {
      label: "Frozen balance (post-lease)",
      data: [...Array(leaseEndIdx + 1).fill(null), ...balanceData.slice(leaseEndIdx + 1)],
      borderColor: "#687078",
      backgroundColor: "transparent",
      fill: false,
      tension: 0,
      pointRadius: 0,
      borderWidth: 1.5,
      borderDash: [4, 3]
    },
    {
      label: "Event Cost (likely)",
      data: eventPoints,
      borderColor: "#151A1D",
      backgroundColor: "#151A1D",
      pointRadius: 5,
      pointStyle: "rectRot",
      showLine: false
    }
  ] : [
    { label: "Projected Balance", data: balanceData, borderColor: color, backgroundColor: color + "22", fill: true, tension: 0.15, pointRadius: 0, borderWidth: 2 },
    { label: "Event Cost (likely)", data: eventPoints, borderColor: "#151A1D", backgroundColor: "#151A1D", pointRadius: 5, pointStyle: "rectRot", showLine: false }
  ];

  const worstShortfallHigh = projection.events.length
    ? Math.max(...projection.events.map(e => e.shortfallHigh))
    : -Infinity;
  const postLeaseShortfall = note && note.shortfallHigh != null && note.shortfallHigh > 0;
  const atRisk = worstShortfallHigh > 0 || postLeaseShortfall;

  return (
    <div className="card" style={{ padding: 16, marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-carbon)" }}>{projection.code} — {projection.label}</div>
          <div style={{ fontSize: 11, color: "var(--color-graphite)", marginTop: 2 }}>
            {projection.events.length} projected event{projection.events.length===1?"":"s"} within lease
            {note ? ` · next event post-lease ${note.date.toISOString().slice(0,7)}` : ""}
          </div>
        </div>
        {anchored && <span className="pill" style={{ background: "var(--color-positive-tint)", color: "var(--color-positive)" }}>📍 Anchored to real next-due date</span>}
        {atRisk && !postLeaseShortfall && <span className="pill" style={{ background: "var(--color-critical-tint)", color: "var(--color-critical)" }}>⚠ Potential shortfall</span>}
        {postLeaseShortfall && <span className="pill" style={{ background: "var(--color-attention-tint)", color: "var(--color-attention)" }}>⚠ Post-lease shortfall</span>}
      </div>
      <MiniLineChart labels={labels} datasets={datasets} leaseEndIdx={hasPostLease ? leaseEndIdx : undefined}/>

      {/* Within-lease events table */}
      {projection.events.length > 0 && (
        <div style={{ marginTop: 10, overflow: "auto" }}>
          <table style={{ fontSize: 11 }}>
            <thead><tr>
              <th style={{ color: "var(--color-graphite)", textAlign: "left" }}>Event Date</th>
              <th style={{ color: "var(--color-graphite)", textAlign: "right" }}>Cost Range</th>
              <th style={{ color: "var(--color-graphite)", textAlign: "right" }}>Balance at Event</th>
              <th style={{ color: "var(--color-graphite)", textAlign: "right" }}>Shortfall Band</th>
            </tr></thead>
            <tbody>
              {projection.events.map((e, i) => (
                <tr key={i}>
                  <td>{e.dateWindow ? `${e.dateWindow.start.toISOString().slice(0,7)} – ${e.dateWindow.end.toISOString().slice(0,7)}` : e.date.toISOString().slice(0, 7)}{e.costIncomplete && <span title="Limiting part has no Approved Life — cost estimate is incomplete" style={{ color: "var(--color-attention)", marginLeft: 4 }}>⚠</span>}</td>
                  <td style={{ textAlign: "right" }}>${Math.round(e.costLow).toLocaleString()} – ${Math.round(e.costHigh).toLocaleString()}</td>
                  <td style={{ textAlign: "right" }}>${Math.round(e.balanceAtEvent).toLocaleString()}</td>
                  <td style={{ textAlign: "right", color: e.shortfallHigh > 0 ? "var(--color-critical)" : "var(--color-positive)" }}>
                    ${Math.round(e.shortfallLow).toLocaleString()} – ${Math.round(e.shortfallHigh).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Post-lease section — suppressed when a within-lease event already fired.
          For LLP pots (leaseEndLimiter present): just balance + limiter FC remaining.
          For all other pots: full event row with cost and shortfall. */}
      {note && projection.events.length === 0 && (
        projection.leaseEndLimiter ? (
          <div style={{ marginTop: 10, padding: "8px 10px", background: "var(--color-technical-grey)", borderRadius: 6, fontSize: 11, color: "var(--color-graphite)" }}>
            <div style={{ marginBottom: 4 }}>
              <span style={{ color: "var(--color-graphite)", fontWeight: 700 }}>Balance at lease end: </span>
              ${Math.round(note.balanceAtLeaseEnd).toLocaleString()}
            </div>
            <div>
              <span style={{ color: "var(--color-graphite)", fontWeight: 700 }}>Lowest limiter: </span>
              {projection.leaseEndLimiter.desc} — {projection.leaseEndLimiter.remainingFC.toLocaleString()} FC remaining
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 10, overflow: "auto" }}>
            <table style={{ fontSize: 11 }}>
              <thead><tr>
                <th style={{ color: "var(--color-graphite)", textAlign: "left" }}>Event Date</th>
                <th style={{ color: "var(--color-graphite)", textAlign: "right" }}>Cost Range</th>
                <th style={{ color: "var(--color-graphite)", textAlign: "right" }}>Balance at Lease End</th>
                <th style={{ color: "var(--color-graphite)", textAlign: "right" }}>Shortfall Band</th>
              </tr></thead>
              <tbody>
                <tr style={{ opacity: 0.75 }}>
                  <td>
                    <span style={{ color: "var(--color-graphite)", marginRight: 6, fontSize: 10 }}>POST-LEASE</span>
                    {note.date.toISOString().slice(0, 7)}
                  </td>
                  <td style={{ textAlign: "right" }}>${Math.round(note.costLow).toLocaleString()} – ${Math.round(note.costHigh).toLocaleString()}</td>
                  <td style={{ textAlign: "right" }}>${Math.round(note.balanceAtLeaseEnd).toLocaleString()}</td>
                  <td style={{ textAlign: "right", color: note.shortfallHigh > 0 ? "var(--color-critical)" : "var(--color-positive)" }}>
                    ${Math.round(note.shortfallLow).toLocaleString()} – ${Math.round(note.shortfallHigh).toLocaleString()}
                  </td>
                </tr>
              </tbody>
            </table>
            <div style={{ fontSize: 10, color: "var(--color-graphite)", marginTop: 4 }}>
              Pot balance frozen at lease end — accruals stop when this lessee's lease expires. Shortfall is the gap between the frozen balance and the next event cost.
            </div>
          </div>
        )
      )}

      {projection.warnings.map((w, i) => (
        <div key={i} style={{ marginTop: 8, fontSize: 11, color: "var(--color-attention)", background: "var(--color-attention-tint)", padding: "6px 10px", borderRadius: 6 }}>{w}</div>
      ))}
    </div>
  );
};

// Read-only Knowledge Base summary for the projection currently on
// screen — knowledge-base-scoping-handoff.md §4: "a button on the
// Fly-Forward page... shows the Knowledge Base values driving the
// current projection. Read-only. Accessible to all roles including
// Viewer." Fetches fresh on open rather than relying on the cached
// window globals (which may not have resolved yet if this panel opens
// very early in the session) — same pattern as SeasonalityProfileEditor.
function AssumptionsPanel({ engineFamily }) {
  const [kb, setKb] = useState(undefined); // undefined = loading, null = none saved yet
  const [catalogue, setCatalogue] = useState(null);

  useEffect(() => {
    let cancelled = false;
    db.getKnowledgeBase().then(v => { if (!cancelled) setKb(v); }).catch(() => { if (!cancelled) setKb(null); });
    db.getLLPCatalogue().then(v => { if (!cancelled) setCatalogue(v); }).catch(() => { if (!cancelled) setCatalogue([]); });
    return () => { cancelled = true; };
  }, []);

  if (kb === undefined || catalogue === null) {
    return <div className="card" style={{ padding: 14, marginBottom: 16, color: "var(--color-graphite)", fontSize: 12 }}>Loading assumptions…</div>;
  }

  const bands = kb?.checkCostBands || {};
  const enPr = kb?.enPrBandsByFamily?.[engineFamily];
  const partsInFamily = catalogue.filter(p => p.engineFamily === engineFamily);

  return (
    <div className="card" style={{ padding: 14, marginBottom: 16, fontSize: 12 }}>
      <div style={{ fontWeight: 700, color: "var(--color-carbon)", marginBottom: 8 }}>Assumptions driving this projection</div>
      <div style={{ color: "var(--color-graphite)", lineHeight: 1.8 }}>
        {["AF-6Y", "AF-12Y", "LG-OH", "AP-OH"].map(code => bands[code] && (
          <div key={code}>{code}: ${bands[code].low?.toLocaleString()}–${bands[code].high?.toLocaleString()}</div>
        ))}
        {enPr && <div>EN-PR ({engineFamily}): ${enPr.costLow?.toLocaleString()}–${enPr.costHigh?.toLocaleString()} every {enPr.intervalFH?.toLocaleString()} FH</div>}
        <div>LLP catalogue: {partsInFamily.length} priced part{partsInFamily.length===1?"":"s"} on file for {engineFamily}, escalation {kb?.llpEscalationPctByFamily?.[engineFamily] ?? "—"}%/yr</div>
        {kb?.checkDurationWeeks && <div>Check durations: 2Y {kb.checkDurationWeeks["2Y"]}wk · 6Y {kb.checkDurationWeeks["6Y"]}wk · 12Y {kb.checkDurationWeeks["12Y"]}wk</div>}
        {!kb && <div style={{ marginTop: 4, color: "var(--color-attention)" }}>⚠ No Knowledge Base defaults saved yet — figures above are code fallbacks. Set real values in Admin → Knowledge Base.</div>}
        <div style={{ marginTop: 6, color: "var(--color-graphite)" }}>Read-only here — edit in Admin → Knowledge Base.</div>
      </div>
    </div>
  );
}

// ============================================================
// End of Lease Position — end-of-lease-position-handoff.md +
// eol-position-addendum.md. Assembly only, same as Fleet Exposure: the
// real calc logic lives in public/calculations/endOfLeasePosition.js
// (window.computeEngineEOLAdjustment / window.buildPhysicalPositionChecks),
// this is just the Body-layer glue that resolves real asset/lease/
// projection data into the shape those functions expect.
// ============================================================

// D (deliveryBaselineFC) is read from the lease's TAC snapshot (4b —
// db.saveTACSnapshot / UploadView.jsx's "tac" upload type), matched per
// part by serial number (the part's actual identity — pn alone isn't
// unique). If no TAC has been uploaded for this lease yet, or this
// specific part isn't on it, D stays null and the part correctly comes
// back uncomputable with "no TAC on file" — eol-position-session-
// handoff.md §4a: "that's expected, not a bug" for any lease predating 4b.
function buildEOLMoneyInputs(eng, { rate, expiryDate, engineFamily, projections, bDenominatorPct, escalationPctPerYr, direction, tacSnapshot }) {
  const monthsToExpiry = Math.max(0, window.monthsBetween(new Date(), expiryDate));
  const cyclesToExpiry = (rate?.fcPerMonth || 0) * monthsToExpiry;

  const tacEngine = tacSnapshot?.engines?.find(e => e.position === eng.position);

  const engineParts = (eng.llps || [])
    .filter(l => l.approvedLife !== null && l.approvedLife !== undefined)
    .map(l => {
      const tacPart = tacEngine?.llps?.find(p => p.sn === l.sn);
      return {
        pn: l.pn,
        sn: l.sn,
        desc: l.desc,
        approvedLife: l.approvedLife,
        catalogPriceToday: window.lookupLLPCataloguePrice ? window.lookupLLPCataloguePrice(l.pn, engineFamily) : null,
        // See file-header comment — null until this part is found on a
        // saved TAC snapshot for this lease.
        deliveryBaselineFC: (tacPart && tacPart.deliveryBaselineFC !== undefined) ? tacPart.deliveryBaselineFC : null
      };
    });

  const currentFCAtExpiry = (eng.currentFC || 0) + cyclesToExpiry;

  const enLpProjection = (projections || []).find(p => p.code === `EN-LP-${eng.position}`);
  const potBalanceAtExpiry = enLpProjection?.monthlySeries?.length
    ? enLpProjection.monthlySeries[enLpProjection.monthlySeries.length - 1].balance
    : 0;

  return {
    engineParts,
    moneyCtx: {
      currentFCAtExpiry,
      escalationPctPerYr,
      // endOfLeasePosition.js's escalateAnnualFn is called positionally
      // as (price, todayDate, expiryDate, pct) — but window.escalateAnnual's
      // real signature (see flyForwardHelpers.js's anchorReservePots, which
      // calls it as (base, baseYear, targetDate, pct)) takes a base YEAR
      // NUMBER in that slot, not a Date object. Matching that convention
      // here rather than the ctx field's own name.
      todayDate: new Date().getFullYear(),
      expiryDate,
      bDenominatorPct,
      escalateAnnualFn: window.escalateAnnual,
      potBalanceAtExpiry,
      direction
    }
  };
}

// Physical position projections — asset-level (worst case across every
// engine; redelivery conditions apply to the whole aircraft, not per
// position). Engine on-wing FH (6.3) has no real "expected removal" field
// anywhere in the schema today — using the relevant EN-PR pot's next
// projected event as a proxy (Alan sign-off, July 2026). This stacks a
// projection on top of a clause that's already a Lessor judgment call
// (6.4) — flagged extra-prominently in the UI, never presented as
// anything close to a measurement.
function buildEOLPhysicalInputs(asset, engines, projections, { rate, expiryDate }) {
  const monthsToExpiry = Math.max(0, window.monthsBetween(new Date(), expiryDate));
  const cyclesToExpiry = (rate?.fcPerMonth || 0) * monthsToExpiry;

  let engineLLPRemainingFCAtExpiry = null;
  engines.forEach(eng => {
    const todayLimiter = window.lowestLimiter(eng);
    if (todayLimiter === null || todayLimiter === undefined) return;
    const atExpiry = todayLimiter - cyclesToExpiry;
    if (engineLLPRemainingFCAtExpiry === null || atExpiry < engineLLPRemainingFCAtExpiry) {
      engineLLPRemainingFCAtExpiry = atExpiry;
    }
  });

  const lgLegs = ["nose", "left", "right"].map(k => asset.landingGear?.[k]?.nextDue).filter(Boolean);
  const lgDates = lgLegs.map(window.parseDMYDate).filter(Boolean);
  const lgEarliestDue = lgDates.length ? new Date(Math.min(...lgDates)) : null;
  const landingGearMonthsAtExpiry = lgEarliestDue ? window.monthsBetween(expiryDate, lgEarliestDue) : null;

  const onWingValues = engines.map(eng => {
    const enPrProjection = (projections || []).find(p => p.code === `EN-PR-${eng.position}`);
    const nextEvent = enPrProjection?.events?.find(e => !e.beyondHorizon) || enPrProjection?.events?.[0];
    if (!nextEvent) return null;
    const eventDate = nextEvent.dateWindow ? nextEvent.dateWindow.start : nextEvent.date;
    const monthsGap = window.monthsBetween(expiryDate, eventDate);
    return monthsGap * (rate?.fhPerMonth || 0);
  }).filter(v => v !== null && v !== undefined);
  const engineOnWingFHAtExpiry = onWingValues.length ? Math.min(...onWingValues) : null;

  return { engineLLPRemainingFCAtExpiry, landingGearMonthsAtExpiry, engineOnWingFHAtExpiry };
}

function EOLMoneyCard({ engineResults }) {
  return (
    <div className="card" style={{ padding: 16, marginBottom: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-carbon)", marginBottom: 4 }}>End of Lease Maintenance Payment Adjustment — Engine LLPs</div>
      <div style={{ fontSize: 11, color: "var(--color-graphite)", marginBottom: 12 }}>
        The accumulated receivable owed at Expiry — this lease's own reserve-tail projection, reframed as "what's owed at handback." Always a projection to the Expiry Date, never a settled figure until redelivery.
      </div>
      {engineResults.length === 0 && (
        <div style={{ fontSize: 12, color: "var(--color-graphite)" }}>No engine LLP data on file for this asset yet.</div>
      )}
      {engineResults.map(r => (
        <div key={r.position} style={{ marginBottom: 14, paddingBottom: 14, borderBottom: "1px solid var(--color-divider-inner)" }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--color-carbon)", marginBottom: 6 }}>Engine {r.position} — EN-LP</div>
          {r.uncomputable ? (
            <div style={{ fontSize: 12, color: "var(--color-attention)" }}>
              ⚠ {r.message}
              {r.rows && r.rows.some(row => row.uncomputable) && (
                <ul style={{ marginTop: 6, paddingLeft: 18 }}>
                  {r.rows.filter(row => row.uncomputable).map((row, i) => (
                    <li key={i} style={{ marginTop: 4, color: "var(--color-graphite)" }}>{row.desc || row.pn}: {row.reason}</li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div>
              <div style={{ fontSize: 20, fontWeight: 700, color: r.netPayableByLessee > 0 ? "var(--color-critical)" : "var(--color-positive)" }}>
                ${Math.round(r.netPayableByLessee).toLocaleString()}
              </div>
              <div style={{ fontSize: 11, color: "var(--color-graphite)", marginTop: 4 }}>
                Gross adjustment ${Math.round(r.grossAdjustment).toLocaleString()} − pot balance at Expiry ${Math.round(r.potBalanceAtExpiry).toLocaleString()} ({r.direction === "one-way" ? "one-way — lessee pays lessor only, never reversed" : "two-way — can go negative, owed the other way"}).
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function EOLPhysicalCard({ physical }) {
  return (
    <div className="card" style={{ padding: 16, marginBottom: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-carbon)", marginBottom: 12 }}>Physical Position — Redelivery Life Margins</div>
      {physical.checks.length === 0 && (
        <div style={{ fontSize: 12, color: "var(--color-graphite)", marginBottom: 8 }}>No physical margin data available yet for this asset.</div>
      )}
      {physical.checks.map((c, i) => (
        <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "8px 0", borderTop: i > 0 ? "1px solid var(--color-divider-inner)" : "none", gap: 12, flexWrap: "wrap" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--color-carbon)" }}>{c.clause} — {c.component}</div>
            <div style={{ fontSize: 11, color: "var(--color-graphite)" }}>{c.requirement}</div>
            {!c.solid && <div style={{ fontSize: 11, color: "var(--color-attention)", marginTop: 4, maxWidth: 420 }}>⚠ {c.caveat} This figure is additionally derived from a Performance Restoration projection used as a stand-in for "expected removal" — treat it as a rough indicator only, never as the answer to clause 6.3/6.4.</div>}
          </div>
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <div style={{ fontSize: 12, color: "var(--color-carbon)" }}>{c.projectedValue}</div>
            <div style={{ fontSize: 11, color: c.status === "ok" ? "var(--color-positive)" : "var(--color-critical)" }}>{c.gap || "Meets requirement"}</div>
          </div>
        </div>
      ))}
      <div style={{ marginTop: 12, fontSize: 11, color: "var(--color-graphite)" }}>{physical.outOfScopeNote}</div>
      <div style={{ marginTop: 6 }}>
        {physical.outOfScopeItems.map((o, i) => (
          <div key={i} style={{ fontSize: 11, color: "var(--color-graphite)" }}>{o.clause} — {o.component}: {o.reason}</div>
        ))}
      </div>
    </div>
  );
}

function EndOfLeasePositionView({ asset, lease, projections, rate, engineFamily, onClose }) {
  const terms = lease.endOfLeaseTerms || getEndOfLeaseTermsDefaults();
  const expiryDate = new Date(lease.leaseEnd);
  const escalationPctPerYr = window.LLP_CATALOGUE_PRICES?.[engineFamily]?.escalationPctPerYr ?? null;
  const engines = (asset.engines || []).filter(e => e.sn && e.llps && e.llps.length);
  const moneyApplies = !!terms.applies && (terms.componentsCovered || []).includes("ENGINE_LLP");

  const engineResults = engines.map(eng => {
    const { engineParts, moneyCtx } = buildEOLMoneyInputs(eng, {
      rate, expiryDate, engineFamily, projections,
      bDenominatorPct: terms.bDenominatorPct,
      escalationPctPerYr,
      direction: terms.direction,
      tacSnapshot: lease.tacSnapshot
    });
    const result = moneyApplies
      ? window.computeEngineEOLAdjustment(engineParts, moneyCtx)
      : { uncomputable: true, message: "This lease's endOfLeaseTerms marks no EOL adjustment as applicable for Engine LLPs — confirm against the lease schedule before assuming this is correct." };
    return { position: eng.position, ...result };
  });

  const physicalInputs = buildEOLPhysicalInputs(asset, engines, projections, { rate, expiryDate });
  const physical = window.buildPhysicalPositionChecks(terms.margins, physicalInputs);

  return (
    <div className="card" style={{ padding: 16, marginBottom: 16, border: "1px solid var(--color-teal)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4, flexWrap: "wrap", gap: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--color-carbon)" }}>End of Lease Position — MSN {asset.msn}</div>
        <button className="btn btn-ghost" onClick={onClose}>Close ✕</button>
      </div>
      <div style={{ fontSize: 12, color: "var(--color-graphite)", marginBottom: 16 }}>
        Everything below is projected to the Expiry Date ({expiryDate.toISOString().slice(0, 10)}) — not a measurement, and not a settled figure until redelivery.
      </div>
      <EOLMoneyCard engineResults={engineResults}/>
      <EOLPhysicalCard physical={physical}/>
    </div>
  );
}

// Computes forward exposure split (in-lease vs post-lease) for a single
// asset synchronously — called directly in FlyForward's render path after
// buildFlyForwardProjection, so it runs exactly once per data load with
// no useState/useEffect re-render risk.
function computeForwardExposure({ asset, lease, reserveDocs, utilRate, scheduledEvents, seasonalityProfile, costProjections, inLeaseShortfallLow, inLeaseShortfallHigh }) {
  if (!window.buildFleetExposure || !window.projectReservePot || !window.projectEnLpPot || !window.buildMaintenanceCalendar) return null;
  try {
    const anchoredPots = (reserveDocs || []).map(p => {
      const override = {};
      if (p.anchorMode === "manual" && p.lastPRDate) override.firstEventOverrideDate = new Date(p.lastPRDate);
      return { ...p, ...override };
    });
    const result = window.buildFleetExposure({
      assets: [{
        assetId: asset.id,
        msn: asset.msn,
        lease,
        pots: anchoredPots,
        engines: asset.engines || [],
        checks: asset.checks || [],
        utilisation: utilRate,
        scheduledEvents: scheduledEvents || [],
        seasonalityProfile: seasonalityProfile || null,
        costProjections: costProjections || []
      }],
      horizonPastLeaseEndMonths: 180,
      brains: {
        projectReservePot: window.projectReservePot,
        projectEnLpPot: window.projectEnLpPot,
        buildMaintenanceCalendar: window.buildMaintenanceCalendar
      }
    });
    const assetResult = result.perAsset?.[0];
    if (!assetResult || assetResult.excluded) return null;
    const atoms = assetResult.atoms || [];
    const postLeaseAtoms = atoms.filter(a => a.postLeaseEnd);
    if (!postLeaseAtoms.length) return null;
    const postLeaseHigh = postLeaseAtoms.reduce((s, a) => s + Math.max(0, a.shortfallHigh || 0), 0);
    const postLeaseLow  = postLeaseAtoms.reduce((s, a) => s + Math.max(0, a.shortfallLow  || 0), 0);
    const totalHigh = Math.max(0, inLeaseShortfallHigh) + postLeaseHigh;
    const totalLow  = Math.max(0, inLeaseShortfallLow)  + postLeaseLow;
    return { postLeaseLow, postLeaseHigh, totalLow, totalHigh };
  } catch (e) {
    return null;
  }
}

function ForwardExposureCard({ exposure, lease, inLeaseShortfallLow, inLeaseShortfallHigh }) {
  if (!exposure) return null;
  const fmt = n => `$${Math.round(n).toLocaleString()}`;
  const leaseEndYear = lease?.leaseEnd?.slice(0, 7) || "lease end";
  return (
    <div className="card" style={{ padding: 16, marginBottom: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-carbon)", marginBottom: 12 }}>Forward Exposure Summary</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 14 }}>
        <div style={{ background: "var(--color-technical-grey)", borderRadius: 8, padding: "12px 14px" }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--color-graphite)", marginBottom: 6 }}>Within This Lease</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: inLeaseShortfallHigh > 0 ? "var(--color-critical)" : "var(--color-positive)" }}>
            {fmt(Math.max(0, inLeaseShortfallLow))} – {fmt(Math.max(0, inLeaseShortfallHigh))}
          </div>
          <div style={{ fontSize: 11, color: "var(--color-graphite)", marginTop: 4 }}>Reserve pots projected short before {leaseEndYear}</div>
        </div>
        <div style={{ background: "var(--color-technical-grey)", borderRadius: 8, padding: "12px 14px" }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--color-graphite)", marginBottom: 6 }}>Post-Lease Exposure</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: exposure.postLeaseHigh > 0 ? "var(--color-critical)" : "var(--color-positive)" }}>
            {fmt(exposure.postLeaseLow)} – {fmt(exposure.postLeaseHigh)}
          </div>
          <div style={{ fontSize: 11, color: "var(--color-graphite)", marginTop: 4 }}>Next events after {leaseEndYear}, assuming no new lease</div>
        </div>
        <div style={{ background: "var(--color-technical-grey)", borderRadius: 8, padding: "12px 14px" }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--color-graphite)", marginBottom: 6 }}>Total Asset Exposure</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: exposure.totalHigh > 0 ? "var(--color-critical)" : "var(--color-positive)" }}>
            {fmt(exposure.totalLow)} – {fmt(exposure.totalHigh)}
          </div>
          <div style={{ fontSize: 11, color: "var(--color-graphite)", marginTop: 4 }}>Combined — see Fleet Exposure for full breakdown</div>
        </div>
      </div>
      <div style={{ fontSize: 11, color: "var(--color-graphite)", lineHeight: 1.6, borderTop: "1px solid var(--color-divider-inner)", paddingTop: 10 }}>
        <strong style={{ color: "var(--color-carbon)" }}>Post-lease exposure</strong> assumes no new lease is in place after {leaseEndYear}. Reserve pots stop accruing at lease end — no further lessee contributions are received. The figure shown is the shortfall between each pot's projected balance at lease end and the cost of its next maintenance event, whenever that falls due.
      </div>
    </div>
  );
}

function FlyForward({ asset, saveAsset, notify, canEnterLeaseData, userRole, showEOLPosition, setShowEOLPosition, showAssumptions, leaseWizardOpen, setLeaseWizardOpen }) {
  const [loading, setLoading] = useState(true);
  const [lease, setLease] = useState(null);
  const [reserveDocs, setReserveDocs] = useState([]);
  const [utilRate, setUtilRate] = useState(null);
  const [scheduledEvents, setScheduledEvents] = useState([]);
  const [seasonalityProfile, setSeasonalityProfile] = useState(null);
  const [costProjections, setCostProjections] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const { mode: layoutMode, width: layoutWidth } = useLayoutMode();
  const engineFamily = isCFM(asset) ? "CFM" : "V2500";

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

  // Monthly shopVisitProjections snapshot — a passive historical record
  // only (Alan, July 2026: "not used to mess with the numbers... that's
  // what the sliders in the next layer will do"). Keyed to data-load
  // identity, not every render, so viewing this page repeatedly in one
  // sitting doesn't refire it. Skips EN-LP (llp_cycles) — its cost
  // snapshot needs llpWorkscope from Brain 2's stack-sim vector, left
  // as a follow-up rather than approximated here.
  useEffect(() => {
    if (loading || loadError || !lease) return;
    let cancelled = false;
    (async () => {
      const { projections: passProjections } = buildFlyForwardProjection({ asset, lease, reserveDocs, utilRate, scheduledEvents, seasonalityProfile, costProjections });
      if (cancelled || !passProjections.length) return;
      const ONE_MONTH_MS = 30 * 24 * 60 * 60 * 1000;
      const now = Date.now();
      for (const p of passProjections) {
        const sourcePot = reserveDocs.find(d => d.code === p.code);
        if (sourcePot && sourcePot.triggerBasis === "llp_cycles") continue;
        const nextEvent = p.events && (p.events.find(e => !e.beyondHorizon) || p.events[0]);
        if (!nextEvent) continue;
        const latest = costProjections
          .filter(c => c.code === p.code)
          .sort((a, b) => new Date(b.calculatedAt) - new Date(a.calculatedAt))[0];
        if (latest && now - new Date(latest.calculatedAt).getTime() < ONE_MONTH_MS) continue;
        const eventDate = nextEvent.dateWindow ? nextEvent.dateWindow.start : nextEvent.date;
        await db.saveShopVisitProjection(asset.id, asset.companyId, {
          code: p.code,
          component: p.label,
          triggerBasis: sourcePot ? sourcePot.triggerBasis : null,
          projectedDate: eventDate.toISOString().slice(0, 10),
          projectedCostLow: nextEvent.costLow,
          projectedCostLikely: nextEvent.costLikely ?? null,
          projectedCostHigh: nextEvent.costHigh,
          confidence: "monthly-snapshot"
        }).catch(() => {});
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, asset.id, lease?.id]);

  if (loading) {
    return <div style={{ padding: 40, textAlign: "center", color: "var(--color-graphite)" }}>Loading Fly-Forward projection for MSN {asset.msn}…</div>;
  }

  if (!asset.currentLeaseId) {
    return (
      <div style={{ animation: "fadeIn 0.2s ease" }}>
        <div className="card" style={{ padding: 24, textAlign: "center" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--color-carbon)", marginBottom: 8 }}>No active lease on this asset</div>
          <div style={{ fontSize: 12, color: "var(--color-graphite)", marginBottom: canEnterLeaseData ? 16 : 0 }}>Fly-Forward needs a lease and reserve pot data to project against.{canEnterLeaseData ? "" : " Ask an Admin, Editor, or Data Entry user to set one up."}</div>
          {canEnterLeaseData && <button className="btn btn-gold" style={{ fontSize: 12, padding: "8px 16px" }} onClick={() => setLeaseWizardOpen(true)}>📄 Set Up Lease</button>}
        </div>
        {leaseWizardOpen && <LeaseWizard asset={asset} saveAsset={saveAsset} notify={notify} onClose={() => setLeaseWizardOpen(false)}/>}
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

  const {
    rate, usingRealRate, horizonMonths, confirmedPots, missingCodes,
    anchoredPots, maintenanceCal, projections, projectionError
  } = buildFlyForwardProjection({ asset, lease, reserveDocs, utilRate, scheduledEvents, seasonalityProfile, costProjections });

  if (projectionError) {
    return (
      <div style={{ animation: "fadeIn 0.2s ease" }}>
        <div className="card" style={{ padding: 24, textAlign: "center", color: "var(--color-critical)" }}>
          Couldn't build the projection: {projectionError}
        </div>
      </div>
    );
  }

  const shortfallSummary = window.summarisePortfolioShortfall(projections);
  const postLeaseShortfallSummary = window.summarisePortfolioPostLeaseShortfall(projections);
  const riskPeaks = window.findPortfolioRiskPeaks(projections);
  const colorList = [FF_COLORS.AF6Y, FF_COLORS.AF12Y, FF_COLORS.LGOH, FF_COLORS.APOH, FF_COLORS.ENPR1, FF_COLORS.ENLP1, FF_COLORS.ENPR2, FF_COLORS.ENLP2];
  const eolTerms = lease.endOfLeaseTerms || getEndOfLeaseTermsDefaults();

  const showMissing = missingCodes.length > 0;
  const showMaintCal = maintenanceCal && maintenanceCal.dataCompleteness && maintenanceCal.dataCompleteness.length > 0;
  const showRiskPeaks = riskPeaks.length > 0;
  const headerInGrid = layoutMode === "landscape";
  // 4-column grid: desc | summary | summary2 | riskpeaks (if present), else
  // 3-column. Warning banners span full width below. Portrait stays plain
  // block flow (summary cards simply stack).
  const colCount = headerInGrid ? (showRiskPeaks ? 4 : 3) : 1;
  const headerAreaRow = headerInGrid ? (showRiskPeaks ? '"desc summary summary2 riskpeaks"' : '"desc summary summary2"') : null;
  const warnSpan = headerInGrid ? (showRiskPeaks ? '"warn1 warn1 warn1 warn1"' : '"warn1 warn1 warn1"') : null;
  const warn2Span = headerInGrid ? (showRiskPeaks ? '"warn2 warn2 warn2 warn2"' : '"warn2 warn2 warn2"') : null;
  const headerAreaRows = [headerAreaRow, showMissing && warnSpan, showMaintCal && warn2Span].filter(Boolean);
  const headerGridStyle = headerInGrid
    ? { display: "grid", gridTemplateColumns: `repeat(${colCount}, 1fr)`, gridTemplateAreas: headerAreaRows.join(" "), columnGap: 16, rowGap: 16, marginBottom: 16, alignItems: "stretch" }
    : undefined;
  const mb = headerInGrid ? 0 : 16;

  return (
    <div style={{ animation: "fadeIn 0.2s ease" }}>
      {leaseWizardOpen && <LeaseWizard asset={asset} saveAsset={saveAsset} notify={notify} onClose={() => setLeaseWizardOpen(false)}/>}
      {showAssumptions && <AssumptionsPanel engineFamily={engineFamily}/>}
      {showEOLPosition && eolTerms.applies && (
        <EndOfLeasePositionView asset={asset} lease={lease} projections={projections} rate={rate} engineFamily={engineFamily} onClose={() => setShowEOLPosition(false)}/>
      )}
      <div style={headerGridStyle}>
        <div style={{ background: "var(--color-teal-tint)", border: "1px solid var(--color-teal)", borderRadius: 10, padding: "12px 16px", marginBottom: mb, gridArea: headerInGrid ? "desc" : undefined }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-carbon)" }}>Fly-Forward — MSN {asset.msn}</div>
          <div style={{ fontSize: 12, color: "var(--color-graphite)", marginTop: 2 }}>
            Lessee: {lease.lessee} · Lease end: {lease.leaseEnd} ({horizonMonths}-month horizon).{" "}
            {usingRealRate
              ? `Utilisation rate: ${Math.round(rate.fhPerMonth).toLocaleString()} FH/mo, ${Math.round(rate.fcPerMonth).toLocaleString()} FC/mo (from ${rate.monthsSpanned} months of this asset's own report history).`
              : "Insufficient utilisation history for a reliable rate — projection may be less accurate until more reports are on file."}
          </div>
        </div>

        <div className="card" style={{ padding: 16, marginBottom: mb, gridArea: headerInGrid ? "summary" : undefined }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-carbon)", marginBottom: 8 }}>Lease Shortfall Summary</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: shortfallSummary.grandTotalHigh > 0 ? "var(--color-critical)" : "var(--color-positive)" }}>
            ${Math.round(shortfallSummary.grandTotalLow).toLocaleString()} – ${Math.round(shortfallSummary.grandTotalHigh).toLocaleString()}
          </div>
          <div style={{ fontSize: 11, color: "var(--color-graphite)", marginTop: 4 }}>
            Total projected shortfall across {projections.length} reserve pot{projections.length===1?"":"s"} within this lease, to {lease.leaseEnd} (positive events only — surplus in one pot doesn't offset a gap in another).
          </div>
        </div>

        <div className="card" style={{ padding: 16, marginBottom: mb, gridArea: headerInGrid ? "summary2" : undefined }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-carbon)", marginBottom: 8 }}>Post-Lease Shortfall Summary</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: postLeaseShortfallSummary.grandTotalHigh > 0 ? "var(--color-critical)" : "var(--color-positive)" }}>
            ${Math.round(postLeaseShortfallSummary.grandTotalLow).toLocaleString()} – ${Math.round(postLeaseShortfallSummary.grandTotalHigh).toLocaleString()}
          </div>
          <div style={{ fontSize: 11, color: "var(--color-graphite)", marginTop: 4 }}>
            Next event after lease end across {postLeaseShortfallSummary.pots.length} pot{postLeaseShortfallSummary.pots.length===1?"":"s"}, assuming no new lease and no further accruals after {lease.leaseEnd}.
          </div>
        </div>

        {showMissing && (
          <div style={{ background: "var(--color-attention-tint)", border: "1px solid var(--color-attention)", borderRadius: 10, padding: "12px 16px", marginBottom: mb, fontSize: 12, color: "var(--color-attention)", gridArea: headerInGrid ? "warn1" : undefined }}>
            ⚠ Incomplete data — this projection excludes {missingCodes.join(", ")} (not yet confirmed in Lease / Reserve Setup). These pots are omitted from the totals below, not treated as zero.
          </div>
        )}

        {showMaintCal && (
          <div style={{ background: "var(--color-attention-tint)", border: "1px solid var(--color-attention)", borderRadius: 10, padding: "12px 16px", marginBottom: mb, fontSize: 12, color: "var(--color-attention)", gridArea: headerInGrid ? "warn2" : undefined }}>
            {maintenanceCal.dataCompleteness.map((gap, i) => (
              <div key={i} style={{ marginTop: i > 0 ? 6 : 0 }}>⚠ {gap.message}</div>
            ))}
          </div>
        )}

        {showRiskPeaks && (
          <div className="card" style={{ padding: 16, marginBottom: mb, gridArea: headerInGrid ? "riskpeaks" : undefined }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-carbon)", marginBottom: 8 }}>Risk Peaks (earliest first)</div>
            {riskPeaks.map((r, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderTop: i > 0 ? "1px solid var(--color-divider-inner)" : "none", fontSize: 12 }}>
                <span style={{ color: "var(--color-carbon)" }}>{r.code} — {r.dateWindow ? `${r.dateWindow.start.toISOString().slice(0,7)} – ${r.dateWindow.end.toISOString().slice(0,7)}` : r.date.toISOString().slice(0, 7)}</span>
                <span style={{ color: r.severity === "high" ? "var(--color-critical)" : "var(--color-attention)" }}>
                  {r.severity === "high" ? "High" : "Medium"} — ${Math.round(r.shortfallLow).toLocaleString()} to ${Math.round(r.shortfallHigh).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={layoutMode === "landscape" ? { display: "grid", gridTemplateColumns: `repeat(${layoutWidth >= 1700 ? 4 : layoutWidth >= 1300 ? 3 : 2}, 1fr)`, columnGap: 16 } : undefined}>
        {projections.map((p, i) => {
          const anchoredPot = anchoredPots.find(ap => ap.code === p.code);
          return <FFPotCard key={p.code} projection={p} color={colorList[i % colorList.length]} anchored={!!anchoredPot?.firstEventOverrideDate}/>;
        })}
      </div>
    </div>
  );
};

// Entry form for recording a completed maintenance event's actual costs.
// Pre-populated from the projection (evt) that triggered the pending-
// completion nudge. Required fields per the locked schema: MRO region,
// total cost (asset + event type are already fixed by context). Everything
// else sits behind "More details" so a bare-minimum record — which is
// still a real, useful data point for the future intelligence layer — takes
// seconds to enter.
function CostTrackerEntryForm({ asset, evt, onClose, onSaved, notify }) {
  const [mroRegion, setMroRegion] = useState("");
  const [totalCost, setTotalCost] = useState("");
  const [showMore, setShowMore] = useState(false);
  const [mroName, setMroName] = useState("");
  const [turnaroundWeeks, setTurnaroundWeeks] = useState("");
  const [dateIn, setDateIn] = useState("");
  const [dateOut, setDateOut] = useState("");
  const [svNumber, setSvNumber] = useState("");
  const [routineCost, setRoutineCost] = useState("");
  const [nonRoutineCost, setNonRoutineCost] = useState("");
  const [scopeNotes, setScopeNotes] = useState("");
  const [workscopeLines, setWorkscopeLines] = useState([]);
  const [newLine, setNewLine] = useState({ type: "", cost: "", plannedOrFinding: "planned" });
  const [saving, setSaving] = useState(false);

  const showsSvNumber = isEngineOrAPUCode(evt.code);
  const projectedLikely = evt.cost ? (evt.cost.projectedCostLow + evt.cost.projectedCostHigh) / 2 : null;

  const addLine = () => {
    if (!newLine.type || newLine.cost === "") return;
    setWorkscopeLines([...workscopeLines, { ...newLine, cost: +newLine.cost }]);
    setNewLine({ type: "", cost: "", plannedOrFinding: "planned" });
  };
  const removeLine = (i) => setWorkscopeLines(workscopeLines.filter((_, li) => li !== i));

  const save = async () => {
    if (!mroRegion || totalCost === "") { notify("MRO region and total cost are required", "error"); return; }
    setSaving(true);
    const cost = +totalCost;
    const age = assetAgeYearsAt(asset, evt.date);
    const engineFamily = showsSvNumber && !/^AP-OH/.test(evt.code) ? (isCFM(asset) ? "CFM" : "V2500") : null;
    try {
      await db.saveCompletedEvent(asset.id, asset.companyId, {
        code: evt.code, label: evt.label, dueCycle: evt.dueCycle,
        eventDateProjected: evt.date.toISOString().slice(0, 10),
        mroRegion, totalCost: cost,
        mroName: mroName || null,
        turnaroundWeeks: turnaroundWeeks === "" ? null : +turnaroundWeeks,
        dateIn: dateIn || null, dateOut: dateOut || null,
        svNumber: svNumber === "" ? null : +svNumber,
        routineCost: routineCost === "" ? null : +routineCost,
        nonRoutineCost: nonRoutineCost === "" ? null : +nonRoutineCost,
        workscopeLines, scopeNotes,
        projectedCostLow: evt.cost?.projectedCostLow ?? null,
        projectedCostHigh: evt.cost?.projectedCostHigh ?? null,
        projectedCostLikely: projectedLikely,
        costDelta: projectedLikely != null ? cost - projectedLikely : null,
        assetAgeAtEventYears: age,
        assetType: asset.model || null,
        engineFamily,
        noCostData: false
      });
      notify("Completed event recorded");
      onSaved();
    } catch (e) {
      notify("Couldn't save — " + e.message, "error");
    }
    setSaving(false);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={onClose}>
      <div className="card" style={{ padding: 20, maxWidth: 520, width: "100%", maxHeight: "90vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
        <div className="flj" style={{ marginBottom: 4 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--color-carbon)" }}>Record Completed Event</div>
          <button className="btn btn-ghost" onClick={onClose}>✕</button>
        </div>
        <div style={{ fontSize: 12, color: "var(--color-graphite)", marginBottom: 14 }}>
          {evt.code} — {evt.label} · Projected {evt.date.toISOString().slice(0, 10)}
          {evt.cost && ` · $${Math.round(evt.cost.projectedCostLow).toLocaleString()}–$${Math.round(evt.cost.projectedCostHigh).toLocaleString()}`}
        </div>

        <div className="grid2" style={{ gap: 10, marginBottom: 10 }}>
          <div className="form-group">
            <label className="form-label">MRO Region *</label>
            <select value={mroRegion} onChange={e => setMroRegion(e.target.value)}>
              <option value="">Select…</option>
              {MRO_REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Total Cost ($) *</label>
            <input type="number" value={totalCost} onChange={e => setTotalCost(e.target.value)} placeholder="e.g. 1450000"/>
          </div>
        </div>

        <button className="btn btn-ghost" style={{ fontSize: 12, marginBottom: 10 }} onClick={() => setShowMore(s => !s)}>{showMore ? "Hide" : "+ Add"} more details (optional)</button>

        {showMore && (
          <div style={{ background: "var(--color-technical-grey)", borderRadius: 8, padding: 12, marginBottom: 12, border: "1px solid var(--color-divider)" }}>
            <div className="grid2" style={{ gap: 10, marginBottom: 10 }}>
              <div className="form-group"><label className="form-label">MRO Name</label><input value={mroName} onChange={e => setMroName(e.target.value)}/></div>
              <div className="form-group"><label className="form-label">Turnaround (weeks)</label><input type="number" value={turnaroundWeeks} onChange={e => setTurnaroundWeeks(e.target.value)}/></div>
              <div className="form-group"><label className="form-label">Date In</label><input type="date" value={dateIn} onChange={e => setDateIn(e.target.value)}/></div>
              <div className="form-group"><label className="form-label">Date Out</label><input type="date" value={dateOut} onChange={e => setDateOut(e.target.value)}/></div>
              {showsSvNumber && (
                <div className="form-group"><label className="form-label">SV Number on this engine</label><input type="number" min="1" value={svNumber} onChange={e => setSvNumber(e.target.value)} placeholder="1st, 2nd, 3rd…"/></div>
              )}
              <div className="form-group"><label className="form-label">Routine/Base Scope Cost ($)</label><input type="number" value={routineCost} onChange={e => setRoutineCost(e.target.value)}/></div>
              <div className="form-group"><label className="form-label">Non-Routine/Findings Cost ($)</label><input type="number" value={nonRoutineCost} onChange={e => setNonRoutineCost(e.target.value)}/></div>
            </div>

            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--color-graphite)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Workscope Lines</div>
            {workscopeLines.length > 0 && (
              <table style={{ marginBottom: 8 }}><thead><tr><th>Type</th><th>Cost</th><th>Planned/Finding</th><th></th></tr></thead>
                <tbody>{workscopeLines.map((l, i) => (
                  <tr key={i}><td>{l.type}</td><td>${l.cost.toLocaleString()}</td><td>{l.plannedOrFinding}</td>
                    <td><button className="btn-danger btn" style={{ fontSize: 10, padding: "2px 6px" }} onClick={() => removeLine(i)}>✕</button></td></tr>
                ))}</tbody></table>
            )}
            <div style={{ display: "flex", gap: 6, alignItems: "flex-end", flexWrap: "wrap" }}>
              <div><label className="form-label">Type</label><input value={newLine.type} onChange={e => setNewLine({ ...newLine, type: e.target.value })} style={{ width: 120 }} placeholder="e.g. PR, LLP"/></div>
              <div><label className="form-label">Cost</label><input type="number" value={newLine.cost} onChange={e => setNewLine({ ...newLine, cost: e.target.value })} style={{ width: 100 }}/></div>
              <div><label className="form-label">Basis</label>
                <select value={newLine.plannedOrFinding} onChange={e => setNewLine({ ...newLine, plannedOrFinding: e.target.value })}>
                  <option value="planned">Planned</option><option value="finding">Finding</option>
                </select>
              </div>
              <button className="btn btn-ghost" style={{ fontSize: 11, padding: "4px 10px" }} onClick={addLine}>+ Add Line</button>
            </div>

            <div className="form-group" style={{ marginTop: 10 }}>
              <label className="form-label">Scope Notes</label>
              <textarea value={scopeNotes} onChange={e => setScopeNotes(e.target.value)} rows={2} style={{ width: "100%" }}/>
            </div>
          </div>
        )}

        <div className="flab g8" style={{ justifyContent: "flex-end" }}>
          <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-gold" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save Completed Event"}</button>
        </div>
      </div>
    </div>
  );
}

// The self-populating "pending completion" list — no manual trigger, the
// calendar already knows projected dates. An item appears once a projected
// event's date is 30+ days in the past and clears the moment either path
// (Enter Costs or Dismiss) writes a matching completedEvents record.
function PendingCompletionsPanel({ asset, pending, onCompleted, notify, canEnterCosts }) {
  const [openEvt, setOpenEvt] = useState(null);
  const [dismissing, setDismissing] = useState(null);

  const dismiss = async (evt) => {
    setDismissing(`${evt.code}_${evt.dueCycle}`);
    try {
      await db.saveCompletedEvent(asset.id, asset.companyId, {
        code: evt.code, label: evt.label, dueCycle: evt.dueCycle,
        eventDateProjected: evt.date.toISOString().slice(0, 10),
        projectedCostLow: evt.cost?.projectedCostLow ?? null,
        projectedCostHigh: evt.cost?.projectedCostHigh ?? null,
        assetAgeAtEventYears: assetAgeYearsAt(asset, evt.date),
        assetType: asset.model || null,
        noCostData: true
      });
      notify("Marked as completed, no cost data");
      onCompleted();
    } catch (e) {
      notify("Couldn't save — " + e.message, "error");
    }
    setDismissing(null);
  };

  if (!pending.length) return null;

  return (
    <div style={{ background: "var(--color-attention-tint)", border: "1px solid var(--color-attention)", borderRadius: 10, padding: "12px 16px", marginBottom: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--color-attention)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.04em" }}>
        Pending Completion — {pending.length} event{pending.length > 1 ? "s" : ""} past projected date
      </div>
      {pending.map(evt => {
        const key = `${evt.code}_${evt.dueCycle}`;
        const daysPast = Math.floor((Date.now() - evt.date.getTime()) / 86400000);
        return (
          <div key={key} className="flj" style={{ padding: "6px 0", borderTop: "1px solid var(--color-attention-tint)", flexWrap: "wrap", gap: 8 }}>
            <div style={{ fontSize: 12, color: "var(--color-carbon)" }}>
              <span style={{ fontWeight: 700 }}>{evt.code}</span> — {evt.label} · projected {evt.date.toISOString().slice(0, 10)} ({daysPast}d ago)
            </div>
            {canEnterCosts && (
              <div className="flab g8">
                <button className="btn btn-gold" style={{ fontSize: 11, padding: "4px 10px" }} onClick={() => setOpenEvt(evt)}>Enter Costs</button>
                <button className="btn btn-ghost" style={{ fontSize: 11, padding: "4px 10px" }} disabled={dismissing === key} onClick={() => dismiss(evt)}>{dismissing === key ? "…" : "Dismiss"}</button>
              </div>
            )}
          </div>
        );
      })}
      {openEvt && (
        <CostTrackerEntryForm asset={asset} evt={openEvt} notify={notify}
          onClose={() => setOpenEvt(null)}
          onSaved={() => { setOpenEvt(null); onCompleted(); }}/>
      )}
    </div>
  );
}

// Always-visible record of every completed event logged for this asset —
// separate from PendingCompletionsPanel above, which only ever shows
// currently-overdue items and disappears once they're all actioned. This
// is what makes those entries visible/reviewable afterward, and lets a
// completed event be logged manually even when it's not (or no longer)
// sitting in the pending list — e.g. entering historical data, or an
// event that was already Dismissed and needs its real costs added later.
function CompletedEventsHistory({ asset, completedEvents, reserveDocs, canEnterCosts, notify, onSaved }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickCode, setPickCode] = useState("");
  const [pickDate, setPickDate] = useState("");
  const [manualEvt, setManualEvt] = useState(null);

  const startManual = () => {
    if (!pickCode || !pickDate) { notify("Select an event type and date", "error"); return; }
    const pot = reserveDocs.find(p => p.code === pickCode);
    setManualEvt({
      code: pickCode, label: pot?.label || pickCode,
      date: new Date(pickDate), dueCycle: `manual-${Date.now()}`,
      cost: null, beyondHorizon: false
    });
    setPickerOpen(false); setPickCode(""); setPickDate("");
  };

  const sorted = [...completedEvents].sort((a, b) => new Date(b.eventDateProjected || b.confirmedAt) - new Date(a.eventDateProjected || a.confirmedAt));

  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="flj" style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-carbon)" }}>Completed Events — Cost History</div>
        {canEnterCosts && <button className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 8px" }} onClick={() => setPickerOpen(o => !o)}>{pickerOpen ? "Cancel" : "+ Log Completed Event"}</button>}
      </div>

      {pickerOpen && (
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", marginBottom: 14, flexWrap: "wrap", background: "var(--color-technical-grey)", border: "1px solid var(--color-divider)", borderRadius: 8, padding: 10 }}>
          <div>
            <label className="form-label">Event Type</label>
            <select value={pickCode} onChange={e => setPickCode(e.target.value)}>
              <option value="">Select…</option>
              {reserveDocs.map(p => <option key={p.code} value={p.code}>{p.code} — {p.label}</option>)}
            </select>
          </div>
          <div><label className="form-label">Event Date</label><input type="date" value={pickDate} onChange={e => setPickDate(e.target.value)}/></div>
          <button className="btn btn-gold" style={{ fontSize: 11, padding: "4px 10px" }} onClick={startManual}>Continue</button>
        </div>
      )}

      {sorted.length === 0 && <div style={{ color: "var(--color-graphite)", fontSize: 12, fontStyle: "italic" }}>No completed events recorded yet.</div>}
      {sorted.map(ev => (
        <div key={ev.id} className="flj" style={{ padding: "7px 0", borderTop: "1px solid var(--color-divider-inner)", flexWrap: "wrap", gap: 6 }}>
          <div style={{ fontSize: 12, color: "var(--color-carbon)" }}>
            <span style={{ fontWeight: 700 }}>{ev.code}</span> — {ev.label || ev.code} · {ev.eventDateProjected || "—"}
            {ev.noCostData && <span className="pill" style={{ marginLeft: 6, background: "var(--color-attention-tint)", color: "var(--color-attention)", fontSize: 10 }}>No cost data</span>}
            {ev.mroRegion && <span style={{ marginLeft: 6, color: "var(--color-graphite)" }}>· {ev.mroRegion}</span>}
          </div>
          <div style={{ fontSize: 12, color: "var(--color-graphite)" }}>
            {ev.totalCost != null ? `$${Math.round(ev.totalCost).toLocaleString()}` : "—"}
            {ev.costDelta != null && (
              <span style={{ marginLeft: 8, color: ev.costDelta > 0 ? "var(--color-critical)" : "var(--color-positive)" }}>
                {ev.costDelta > 0 ? "+" : ""}${Math.round(ev.costDelta).toLocaleString()} vs projected
              </span>
            )}
          </div>
        </div>
      ))}

      {manualEvt && (
        <CostTrackerEntryForm asset={asset} evt={manualEvt} notify={notify}
          onClose={() => setManualEvt(null)}
          onSaved={() => { setManualEvt(null); onSaved(); }}/>
      )}
    </div>
  );
}

function MaintenanceCalendarView({ asset, notify = () => {}, canEnterCosts = false, showSeasonality: showSeasonalityProp = false, setShowSeasonality: setShowSeasonalityProp = null }) {
  const [loading, setLoading] = useState(true);
  const [lease, setLease] = useState(null);
  const [reserveDocs, setReserveDocs] = useState([]);
  const [utilRate, setUtilRate] = useState(null);
  const [scheduledEvents, setScheduledEvents] = useState([]);
  const [seasonalityProfile, setSeasonalityProfile] = useState(null);
  const [costProjections, setCostProjections] = useState([]);
  const [completedEvents, setCompletedEvents] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [_showSeasonalityLocal, _setShowSeasonalityLocal] = useState(false);
  // Use lifted state from AssetView when available, otherwise local fallback
  const showSeasonality = setShowSeasonalityProp ? showSeasonalityProp : _showSeasonalityLocal;
  const setShowSeasonality = setShowSeasonalityProp || _setShowSeasonalityLocal;
  const [expanded, setExpanded] = useState(null); // key of the one event row currently expanded for editing

  const reload = useCallback(async () => {
    const [util, leaseData, reserves, schedEvts, seasonProfile, shopVisits, completed] = await Promise.all([
      db.getUtilisation(asset.id).catch(() => []),
      asset.currentLeaseId ? db.getLease(asset.currentLeaseId).catch(() => null) : Promise.resolve(null),
      db.getReservePots(asset.id).catch(() => []),
      db.getScheduledEvents(asset.id).catch(() => []),
      db.getSeasonalityProfile(asset.id).catch(() => null),
      db.getShopVisitProjections(asset.id).catch(() => []),
      db.getCompletedEvents(asset.id).catch(() => [])
    ]);
    setUtilRate(window.computeRealUtilisationRate(util));
    setLease(leaseData);
    setReserveDocs(reserves);
    setScheduledEvents(schedEvts);
    setSeasonalityProfile(seasonProfile);
    setCostProjections(shopVisits);
    setCompletedEvents(completed);
  }, [asset.id, asset.currentLeaseId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    reload().catch(() => { if (!cancelled) setLoadError(true); }).then(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [reload]);

  if (loading) {
    return <div style={{ padding: 40, textAlign: "center", color: "var(--color-graphite)" }}>Loading maintenance calendar for MSN {asset.msn}…</div>;
  }

  if (loadError) {
    return (
      <div style={{ animation: "fadeIn 0.2s ease" }}>
        <div className="card" style={{ padding: 24, textAlign: "center", color: "var(--color-critical)" }}>Could not load maintenance calendar data.</div>
      </div>
    );
  }

  // TECH_DEBT.md 4.86 follow-up — that fix reached the FLEET-level
  // Calendar tab only. This is the same leaseless-safe path applied at
  // asset level: buildAssetMaintenanceCalendar tolerates a missing lease
  // and synthesizes pot structure (never a $ figure) from the asset's own
  // real component data when no confirmed reserve pot exists yet. The
  // Financials tab (FlyForward component, above) is completely untouched
  // and still correctly requires a real lease — this function is
  // deliberately never used there.
  const { maintenanceCal, projectionError, usedSyntheticPots } = buildAssetMaintenanceCalendar({ asset, lease, reserveDocs, utilRate, scheduledEvents, seasonalityProfile, costProjections });

  if (projectionError || !maintenanceCal) {
    return (
      <div style={{ animation: "fadeIn 0.2s ease" }}>
        <div className="card" style={{ padding: 24, textAlign: "center", color: "var(--color-critical)" }}>Couldn't build the calendar: {projectionError}</div>
      </div>
    );
  }

  const acceptSeasonality = async (evt) => {
    const key = `${evt.code}_${evt.dueCycle}`;
    setBusy(key);
    await db.saveScheduledEventOverride(asset.id, asset.companyId, {
      code: evt.code, dueCycle: evt.dueCycle,
      scheduledDate: evt.seasonalitySuggestion.suggestedDate.toISOString().slice(0, 10),
      source: "seasonality"
    }).catch(() => {});
    await reload();
    setBusy(null);
  };

  const saveAirlineStated = async (evt, dateStr) => {
    if (!dateStr) return;
    const key = `${evt.code}_${evt.dueCycle}`;
    setBusy(key);
    await db.saveScheduledEventOverride(asset.id, asset.companyId, {
      code: evt.code, dueCycle: evt.dueCycle, scheduledDate: dateStr, source: "airline-stated"
    }).catch(() => {});
    await reload();
    setBusy(null);
  };

  const saveDuration = async (evt, weeks) => {
    if (typeof weeks !== "number" || isNaN(weeks)) return;
    const key = `${evt.code}_${evt.dueCycle}`;
    setBusy(key);
    const existing = scheduledEvents.find(o => o.code === evt.code && o.dueCycle === evt.dueCycle);
    await db.saveScheduledEventOverride(asset.id, asset.companyId, {
      code: evt.code, dueCycle: evt.dueCycle,
      durationWeeks: weeks,
      scheduledDate: existing?.scheduledDate || null,
      source: existing?.source || "derived"
    }).catch(() => {});
    await reload();
    setBusy(null);
  };

  const revertToDerived = async (evt) => {
    const key = `${evt.code}_${evt.dueCycle}`;
    setBusy(key);
    await db.deleteScheduledEventOverride(asset.id, evt.code, evt.dueCycle).catch(() => {});
    await reload();
    setBusy(null);
  };

  // Legend swatches for event-date provenance — light tints from the
  // design system palette. Teal for "categorical, non-severity" (seasonality
  // is a data source, not a status), positive for a confirmed/airline-stated
  // date, graphite as the neutral default (derived = no special provenance).
  const sourceStyle = {
    derived: { background: "var(--color-carbon-tint-06)", color: "var(--color-graphite)", label: "Derived" },
    seasonality: { background: "var(--color-teal-tint)", color: "var(--color-teal)", label: "Seasonality" },
    "airline-stated": { background: "var(--color-positive-tint)", color: "var(--color-positive)", label: "Airline-stated" }
  };

  // Self-populating pending-completion list (TECH_DEBT.md 4.101) — an
  // event qualifies once it's 30+ days past its own projected date and no
  // completedEvents record exists yet for that exact code+dueCycle. Events
  // still beyond the projection horizon can't be "overdue" by definition,
  // so they're excluded regardless of date math.
  const completedKeys = new Set(completedEvents.map(c => `${c.code}_${c.dueCycle}`));
  const pendingCompletions = maintenanceCal.events.filter(evt => {
    if (evt.beyondHorizon) return false;
    if (completedKeys.has(`${evt.code}_${evt.dueCycle}`)) return false;
    const daysPast = Math.floor((Date.now() - evt.date.getTime()) / 86400000);
    return daysPast >= 30;
  });

  const { mode: layoutMode } = useLayoutMode();
  const inLandscape = layoutMode === "landscape";

  return (
    <div style={{ animation: "fadeIn 0.2s ease" }}>
      <PendingCompletionsPanel asset={asset} pending={pendingCompletions} onCompleted={reload} notify={notify} canEnterCosts={canEnterCosts}/>

      {/* Completed Events + Calendar description — side by side on landscape */}
      <div style={inLandscape ? { display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 16, marginBottom: 16, alignItems: "stretch" } : undefined}>
        <CompletedEventsHistory asset={asset} completedEvents={completedEvents} reserveDocs={reserveDocs} canEnterCosts={canEnterCosts} notify={notify} onSaved={reload}/>
        <div style={{ background: "var(--color-teal-tint)", border: "1px solid var(--color-teal)", borderRadius: 10, padding: "12px 16px", marginBottom: inLandscape ? 0 : 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-carbon)" }}>Maintenance Calendar — MSN {asset.msn}</div>
          <div style={{ fontSize: 12, color: "var(--color-graphite)", marginTop: 2 }}>
            A financial-projection input, not a maintenance-tracking tool — dates are deliberately loose and self-correct against real utilisation reports over time. Accepting a seasonality suggestion or entering an airline-stated date is a suggestion you confirm here, never an automatic move.
          </div>
        </div>
      </div>

      {showSeasonality && (
        <SeasonalityProfileEditor asset={asset} profile={seasonalityProfile} onSaved={reload}/>
      )}

      {usedSyntheticPots && (
        <div style={{ background: "var(--color-teal-tint)", border: "1px solid var(--color-teal)", borderRadius: 10, padding: "10px 16px", marginBottom: 16, fontSize: 12, color: "var(--color-teal)" }}>
          ℹ No lease/reserve setup on file for this asset — dates below are sourced directly from real component data (landing gear next-due, engine LLP remaining life). Engine Performance Restoration and APU Overhaul aren't shown, since there's no real anchor date to derive either from; nothing here is an estimate.
        </div>
      )}

      {maintenanceCal.dataCompleteness.length > 0 && (
        <div style={{ background: "var(--color-attention-tint)", border: "1px solid var(--color-attention)", borderRadius: 10, padding: "12px 16px", marginBottom: 16, fontSize: 12, color: "var(--color-attention)" }}>
          {maintenanceCal.dataCompleteness.map((gap, i) => (
            <div key={i} style={{ marginTop: i > 0 ? 6 : 0 }}>⚠ {gap.message}</div>
          ))}
        </div>
      )}

      {maintenanceCal.events.length > 0 && <MaintenanceCalendarGrid events={maintenanceCal.events}/>}

      {/* Event rows — 4-column grid on landscape. Expanded rows span all 4 columns. */}
      <div style={inLandscape ? { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", columnGap: 10 } : undefined}>
        {maintenanceCal.events.map((evt) => {
          const key = `${evt.code}_${evt.dueCycle}`;
          const override = scheduledEvents.find(o => o.code === evt.code && o.dueCycle === evt.dueCycle);
          const sStyle = sourceStyle[evt.source] || sourceStyle.derived;
          const isRowBusy = busy === key;
          const isExpanded = expanded === key;
          return (
            <div key={key} className="card" style={{ padding: 10, marginBottom: 6, opacity: isRowBusy ? 0.6 : 1, ...(inLandscape && isExpanded ? { gridColumn: "1 / -1" } : {}) }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: colorForCode(evt.code), flexShrink: 0 }}/>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--color-carbon)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {evt.code} — {evt.label}
                      {evt.grounding && <span className="pill" style={{ marginLeft: 6, background: "var(--color-critical-tint)", color: "var(--color-critical)", fontSize: 10 }}>Grounds {evt.durationWeeks}wk</span>}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--color-graphite)" }}>
                      {evt.date.toISOString().slice(0, 10)}{evt.beyondHorizon ? " (beyond horizon)" : ""}
                      {evt.cost && ` · $${Math.round(evt.cost.projectedCostLow).toLocaleString()}–$${Math.round(evt.cost.projectedCostHigh).toLocaleString()}`}
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  <span className="pill" style={{ background: sStyle.background, color: sStyle.color, fontSize: 10 }}>{sStyle.label}</span>
                  {evt.seasonalitySuggestion && !override && (
                    <button className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 8px" }} disabled={isRowBusy} onClick={() => acceptSeasonality(evt)}>💡 Accept</button>
                  )}
                  <button className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 8px" }} onClick={() => setExpanded(isExpanded ? null : key)}>{isExpanded ? "Hide ▴" : "Edit ▾"}</button>
                </div>
              </div>

              {isExpanded && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--color-divider-inner)" }}>
                  {evt.mergedWithCodes.length > 0 && (
                    <div style={{ fontSize: 11, color: "var(--color-graphite)", marginBottom: 8 }}>Absorbed with {evt.mergedWithCodes.map(c => c.code).join(", ")}</div>
                  )}
                  {evt.seasonalitySuggestion && !override && (
                    <div style={{ marginBottom: 10, padding: 10, background: "var(--color-teal-tint)", borderRadius: 6, fontSize: 11, color: "var(--color-teal)" }}>
                      💡 Suggested: {evt.seasonalitySuggestion.suggestedDate.toISOString().slice(0, 10)} — {evt.seasonalitySuggestion.reason}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 16, alignItems: "flex-end", flexWrap: "wrap" }}>
                    {evt.grounding && (
                      <label style={{ fontSize: 10, color: "var(--color-graphite)" }}>Duration (weeks)
                        <div><PotNumInput value={evt.durationWeeks} onCommit={v => saveDuration(evt, v)} width={70}/></div>
                      </label>
                    )}
                    <label style={{ fontSize: 10, color: "var(--color-graphite)" }}>Airline-stated date
                      <div>
                        <input type="date" defaultValue={override?.source === "airline-stated" ? override.scheduledDate : ""}
                          onBlur={e => saveAirlineStated(evt, e.target.value)}
                          style={{ fontSize: 12, padding: "4px 6px" }} disabled={isRowBusy}/>
                      </div>
                    </label>
                    {override && (
                      <button className="btn btn-ghost" style={{ fontSize: 11, padding: "4px 10px" }} disabled={isRowBusy} onClick={() => revertToDerived(evt)}>Revert to derived</button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {maintenanceCal.events.length === 0 && (
        <div className="card" style={{ padding: 24, textAlign: "center", color: "var(--color-graphite)" }}>No maintenance events projected within the current calendar horizon.</div>
      )}
    </div>
  );
};

function SeasonalityProfileEditor({ asset, profile, onSaved }) {
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const blankWeightings = () => MONTHS.reduce((acc, m) => { acc[m] = ""; return acc; }, {});

  const [form, setForm] = useState(() => ({
    activeWeeksPerYear: profile?.activeWeeksPerYear ?? "",
    monthlyWeightings: profile?.monthlyWeightings
      ? MONTHS.reduce((acc, m) => { acc[m] = profile.monthlyWeightings[m] ?? ""; return acc; }, {})
      : blankWeightings()
  }));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm({
      activeWeeksPerYear: profile?.activeWeeksPerYear ?? "",
      monthlyWeightings: profile?.monthlyWeightings
        ? MONTHS.reduce((acc, m) => { acc[m] = profile.monthlyWeightings[m] ?? ""; return acc; }, {})
        : blankWeightings()
    });
  }, [profile]);

  const setMonth = (m, v) => setForm(f => ({ ...f, monthlyWeightings: { ...f.monthlyWeightings, [m]: v } }));
  const complete = MONTHS.every(m => form.monthlyWeightings[m] !== "" && !isNaN(parseFloat(form.monthlyWeightings[m])));

  const save = async () => {
    setSaving(true);
    const weightings = {};
    for (const m of MONTHS) {
      const n = parseFloat(form.monthlyWeightings[m]);
      if (!isNaN(n)) weightings[m] = n;
    }
    await db.saveSeasonalityProfile(asset.id, asset.companyId, {
      activeWeeksPerYear: form.activeWeeksPerYear === "" ? null : parseFloat(form.activeWeeksPerYear),
      monthlyWeightings: weightings,
      patternDetected: false
    }).catch(() => {});
    setSaving(false);
    onSaved && onSaved();
  };

  return (
    <div className="card" style={{ padding: 14, marginBottom: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-carbon)", marginBottom: 4 }}>Seasonality Profile</div>
      <div style={{ fontSize: 11, color: "var(--color-graphite)", marginBottom: 10 }}>
        Monthly utilisation weightings (% of a typical month — 100 = average). Shapes automatic utilisation input and suggests, but never moves, off-season check placement. All 12 months are required or the profile is ignored entirely.
      </div>
      <label style={{ fontSize: 10, color: "var(--color-graphite)" }}>Active weeks / year
        <div><PotNumInput value={form.activeWeeksPerYear} onCommit={v => setForm(f => ({ ...f, activeWeeksPerYear: v }))} width={70}/></div>
      </label>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 10, marginTop: 12 }}>
        {MONTHS.map(m => (
          <label key={m} style={{ fontSize: 10, color: "var(--color-graphite)" }}>{m}
            <div><PotNumInput value={form.monthlyWeightings[m]} onCommit={v => setMonth(m, v)} width={60}/></div>
          </label>
        ))}
      </div>
      {!complete && <div style={{ fontSize: 11, color: "var(--color-attention)", marginTop: 10 }}>⚠ Incomplete — all 12 months need a value before this profile takes effect.</div>}
      <button className="btn btn-gold" style={{ marginTop: 12, fontSize: 12, padding: "6px 14px" }} disabled={saving} onClick={save}>{saving ? "Saving…" : "Save Profile"}</button>
    </div>
  );
};


export { CompletedEventsHistory, CostTrackerEntryForm, FFPotCard, FlyForward, MaintenanceCalendarGrid, MaintenanceCalendarView, MiniLineChart, PendingCompletionsPanel, SeasonalityProfileEditor, EndOfLeasePositionView };
