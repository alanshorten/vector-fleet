import React, { useState, useEffect, useCallback, useRef } from 'react';
import { PotNumInput } from './AssetView';
import { LeaseWizard } from './LeaseWizard';
import { db } from '../lib/db';
import { FF_COLORS, buildFlyForwardProjection } from '../lib/flyForwardHelpers';

const MONTH_LABELS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function colorForCode(code) {
  return FF_COLORS[(code || "").replace(/-/g, "")] || "#64748b";
}

function MaintenanceCalendarGrid({ events }) {
  const [hover, setHover] = useState(null); // {year, month, evts, x, y}
  if (!events.length) return null;

  const byYear = {};
  events.forEach(evt => {
    const y = evt.date.getFullYear();
    const m = evt.date.getMonth();
    byYear[y] = byYear[y] || Array.from({ length: 12 }, () => []);
    byYear[y][m].push(evt);
  });
  const years = Object.keys(byYear).map(Number).sort((a, b) => a - b);

  return (
    <div className="card" style={{ padding: 16, marginBottom: 16, position: "relative" }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", marginBottom: 12 }}>Calendar Overview</div>
      {years.map(year => (
        <div key={year} style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", marginBottom: 6 }}>{year}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 4 }}>
            {MONTH_LABELS.map((label, m) => {
              const evts = byYear[year][m];
              return (
                <div key={m}
                  onMouseEnter={e => evts.length && setHover({ year, month: m, evts, x: e.currentTarget.offsetLeft, y: e.currentTarget.offsetTop })}
                  onMouseLeave={() => setHover(null)}
                  style={{ border: "1px solid #1e3048", borderRadius: 6, padding: "8px 4px", textAlign: "center", cursor: evts.length ? "pointer" : "default", background: evts.length ? "#0d1622" : "transparent" }}>
                  <div style={{ fontSize: 9, color: "#475569", marginBottom: 4 }}>{label}</div>
                  {evts.length > 0 && (
                    <div style={{ display: "flex", justifyContent: "center", gap: 2, flexWrap: "wrap" }}>
                      {evts.slice(0, 3).map((e, i) => (
                        <span key={i} style={{ width: 7, height: 7, borderRadius: "50%", background: colorForCode(e.code), display: "inline-block" }}/>
                      ))}
                      {evts.length > 3 && <span style={{ fontSize: 8, color: "#94a3b8" }}>+{evts.length - 3}</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {hover && (
        <div style={{ position: "absolute", top: hover.y + 40, left: Math.min(hover.x, 700), zIndex: 20, background: "#111f30", border: "1px solid #2d3f55", borderRadius: 8, padding: 10, boxShadow: "0 4px 16px rgba(0,0,0,0.4)", minWidth: 200, pointerEvents: "none" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", marginBottom: 6 }}>{MONTH_LABELS[hover.month]} {hover.year}</div>
          {hover.evts.map((e, i) => (
            <div key={i} style={{ marginBottom: i < hover.evts.length - 1 ? 8 : 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#e2e8f0" }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: colorForCode(e.code), display: "inline-block", marginRight: 6 }}/>
                {e.code} — {e.label}
              </div>
              <div style={{ fontSize: 11, color: "#94a3b8" }}>{e.date.toISOString().slice(0, 10)}{e.grounding ? ` · grounds ${e.durationWeeks}wk` : ""}</div>
              {e.cost && <div style={{ fontSize: 11, color: "#64748b" }}>${Math.round(e.cost.projectedCostLow).toLocaleString()}–${Math.round(e.cost.projectedCostHigh).toLocaleString()}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MiniLineChart({ labels, datasets, height }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);
  useEffect(() => {
    if (!window.Chart || !canvasRef.current) return;
    if (chartRef.current) chartRef.current.destroy();
    chartRef.current = new window.Chart(canvasRef.current, {
      type: "line",
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { labels: { color: "#94a3b8", font: { size: 11 }, boxWidth: 12 } },
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
          x: { ticks: { color: "#64748b", font: { size: 10 }, maxTicksLimit: 12 }, grid: { color: "#1e3048" } },
          y: {
            ticks: { color: "#64748b", font: { size: 10 }, callback: v => "$" + (v / 1000).toFixed(0) + "k" },
            grid: { color: "#1e3048" }
          }
        }
      }
    });
    return () => { if (chartRef.current) chartRef.current.destroy(); };
  }, [labels, JSON.stringify(datasets)]);
  return <div style={{ height: height || 220 }}><canvas ref={canvasRef}/></div>;
};

function FFPotCard({ projection, color, anchored }) {
  const labels = projection.monthlySeries.map(m => m.date.toISOString().slice(0, 7));
  const balanceData = projection.monthlySeries.map(m => Math.round(m.balance));
  const eventLikelyByMonth = {};
  projection.events.forEach(e => { eventLikelyByMonth[e.monthIndex] = e.costLikely; });
  const eventPoints = projection.monthlySeries.map(m => eventLikelyByMonth[m.monthIndex] ?? null);

  const datasets = [
    { label: "Projected Balance", data: balanceData, borderColor: color, backgroundColor: color + "22", fill: true, tension: 0.15, pointRadius: 0, borderWidth: 2 },
    { label: "Event Cost (likely)", data: eventPoints, borderColor: "#e2e8f0", backgroundColor: "#e2e8f0", pointRadius: 5, pointStyle: "rectRot", showLine: false }
  ];

  const worstShortfallHigh = projection.events.length
    ? Math.max(...projection.events.map(e => e.shortfallHigh))
    : -Infinity;
  const atRisk = worstShortfallHigh > 0;

  return (
    <div className="card" style={{ padding: 16, marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0" }}>{projection.code} — {projection.label}</div>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{projection.events.length} projected event{projection.events.length===1?"":"s"} within lease horizon</div>
        </div>
        {anchored && <span className="pill" style={{ background: "#0d2818", color: "#34d399" }}>📍 Anchored to real next-due date</span>}
        {atRisk && <span className="pill" style={{ background: "#2a0e0e", color: "#f87171" }}>⚠ Potential shortfall</span>}
      </div>
      <MiniLineChart labels={labels} datasets={datasets}/>
      {projection.events.length > 0 && (
        <div style={{ marginTop: 10, overflow: "auto" }}>
          <table style={{ fontSize: 11 }}>
            <thead><tr>
              <th style={{ color: "#64748b", textAlign: "left" }}>Event Date</th>
              <th style={{ color: "#64748b", textAlign: "right" }}>Cost Range</th>
              <th style={{ color: "#64748b", textAlign: "right" }}>Balance at Event</th>
              <th style={{ color: "#64748b", textAlign: "right" }}>Shortfall Band</th>
            </tr></thead>
            <tbody>
              {projection.events.map((e, i) => (
                <tr key={i}>
                  <td>{e.dateWindow ? `${e.dateWindow.start.toISOString().slice(0,7)} – ${e.dateWindow.end.toISOString().slice(0,7)}` : e.date.toISOString().slice(0, 7)}{e.costIncomplete && <span title="Limiting part has no Approved Life — cost estimate is incomplete" style={{ color: "#fbbf24", marginLeft: 4 }}>⚠</span>}</td>
                  <td style={{ textAlign: "right" }}>${Math.round(e.costLow).toLocaleString()} – ${Math.round(e.costHigh).toLocaleString()}</td>
                  <td style={{ textAlign: "right" }}>${Math.round(e.balanceAtEvent).toLocaleString()}</td>
                  <td style={{ textAlign: "right", color: e.shortfallHigh > 0 ? "#f87171" : "#34d399" }}>
                    ${Math.round(e.shortfallLow).toLocaleString()} – ${Math.round(e.shortfallHigh).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {projection.partialFundedNote && (
        <div style={{ marginTop: 8, fontSize: 11, color: "#94a3b8" }}>
          ℹ Next interval ({projection.partialFundedNote.date.toISOString().slice(0,7)}) falls beyond lease end — partial-funded, settles at redelivery.
        </div>
      )}
      {projection.warnings.map((w, i) => (
        <div key={i} style={{ marginTop: 8, fontSize: 11, color: "#fbbf24", background: "#2a1f0a", padding: "6px 10px", borderRadius: 6 }}>{w}</div>
      ))}
    </div>
  );
};

function FlyForward({ asset, saveAsset, notify, canEnterLeaseData }) {
  const [loading, setLoading] = useState(true);
  const [lease, setLease] = useState(null);
  const [reserveDocs, setReserveDocs] = useState([]);
  const [utilRate, setUtilRate] = useState(null);
  const [scheduledEvents, setScheduledEvents] = useState([]);
  const [seasonalityProfile, setSeasonalityProfile] = useState(null);
  const [costProjections, setCostProjections] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [leaseWizardOpen, setLeaseWizardOpen] = useState(false);

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
    return <div style={{ padding: 40, textAlign: "center", color: "#64748b" }}>Loading Fly-Forward projection for MSN {asset.msn}…</div>;
  }

  if (!asset.currentLeaseId) {
    return (
      <div style={{ animation: "fadeIn 0.2s ease" }}>
        <div className="card" style={{ padding: 24, textAlign: "center" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0", marginBottom: 8 }}>No active lease on this asset</div>
          <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: canEnterLeaseData ? 16 : 0 }}>Fly-Forward needs a lease and reserve pot data to project against.{canEnterLeaseData ? "" : " Ask an Admin, Editor, or Data Entry user to set one up."}</div>
          {canEnterLeaseData && <button className="btn btn-gold" style={{ fontSize: 12, padding: "8px 16px" }} onClick={() => setLeaseWizardOpen(true)}>📄 Set Up Lease</button>}
        </div>
        {leaseWizardOpen && <LeaseWizard asset={asset} saveAsset={saveAsset} notify={notify} onClose={() => setLeaseWizardOpen(false)}/>}
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

  const {
    rate, usingRealRate, horizonMonths, confirmedPots, missingCodes,
    anchoredPots, maintenanceCal, projections, projectionError
  } = buildFlyForwardProjection({ asset, lease, reserveDocs, utilRate, scheduledEvents, seasonalityProfile, costProjections });

  if (projectionError) {
    return (
      <div style={{ animation: "fadeIn 0.2s ease" }}>
        <div className="card" style={{ padding: 24, textAlign: "center", color: "#f87171" }}>
          Couldn't build the projection: {projectionError}
        </div>
      </div>
    );
  }

  const shortfallSummary = window.summarisePortfolioShortfall(projections);
  const riskPeaks = window.findPortfolioRiskPeaks(projections);
  const colorList = [FF_COLORS.AF6Y, FF_COLORS.AF12Y, FF_COLORS.LGOH, FF_COLORS.APOH, FF_COLORS.ENPR1, FF_COLORS.ENLP1, FF_COLORS.ENPR2, FF_COLORS.ENLP2];

  return (
    <div style={{ animation: "fadeIn 0.2s ease" }}>
      {canEnterLeaseData && (
        <div className="flab g12" style={{ marginBottom: 16, justifyContent: "flex-end" }}>
          <button className="btn btn-ghost" onClick={() => setLeaseWizardOpen(true)}>📄 Edit Lease</button>
        </div>
      )}
      {leaseWizardOpen && <LeaseWizard asset={asset} saveAsset={saveAsset} notify={notify} onClose={() => setLeaseWizardOpen(false)}/>}
      <div style={{ background: "#0d1e33", border: "1px solid #1B3A6B", borderRadius: 10, padding: "12px 16px", marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0" }}>Fly-Forward — MSN {asset.msn}</div>
        <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
          Lessee: {lease.lessee} · Lease end: {lease.leaseEnd} ({horizonMonths}-month horizon).{" "}
          {usingRealRate
            ? `Utilisation rate: ${Math.round(rate.fhPerMonth).toLocaleString()} FH/mo, ${Math.round(rate.fcPerMonth).toLocaleString()} FC/mo (from ${rate.monthsSpanned} months of this asset's own report history).`
            : "Insufficient utilisation history for a reliable rate — projection may be less accurate until more reports are on file."}
        </div>
      </div>

      {missingCodes.length > 0 && (
        <div style={{ background: "#2a220e", border: "1px solid #C9A84C", borderRadius: 10, padding: "12px 16px", marginBottom: 16, fontSize: 12, color: "#fbbf24" }}>
          ⚠ Incomplete data — this projection excludes {missingCodes.join(", ")} (not yet confirmed in Lease / Reserve Setup). These pots are omitted from the totals below, not treated as zero.
        </div>
      )}

      {maintenanceCal && maintenanceCal.dataCompleteness && maintenanceCal.dataCompleteness.length > 0 && (
        <div style={{ background: "#2a220e", border: "1px solid #C9A84C", borderRadius: 10, padding: "12px 16px", marginBottom: 16, fontSize: 12, color: "#fbbf24" }}>
          {maintenanceCal.dataCompleteness.map((gap, i) => (
            <div key={i} style={{ marginTop: i > 0 ? 6 : 0 }}>⚠ {gap.message}</div>
          ))}
        </div>
      )}

      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", marginBottom: 8 }}>Portfolio Shortfall Summary</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: shortfallSummary.grandTotalHigh > 0 ? "#f87171" : "#34d399" }}>
          ${Math.round(shortfallSummary.grandTotalLow).toLocaleString()} – ${Math.round(shortfallSummary.grandTotalHigh).toLocaleString()}
        </div>
        <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>
          Total projected shortfall across {projections.length} reserve pot{projections.length===1?"":"s"} over the {horizonMonths}-month projection (positive events only — surplus in one pot doesn't offset a gap in another).
        </div>
      </div>

      {riskPeaks.length > 0 && (
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", marginBottom: 8 }}>Risk Peaks (earliest first)</div>
          {riskPeaks.map((r, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderTop: i > 0 ? "1px solid #1e3048" : "none", fontSize: 12 }}>
              <span style={{ color: "#e2e8f0" }}>{r.code} — {r.dateWindow ? `${r.dateWindow.start.toISOString().slice(0,7)} – ${r.dateWindow.end.toISOString().slice(0,7)}` : r.date.toISOString().slice(0, 7)}</span>
              <span style={{ color: r.severity === "high" ? "#f87171" : "#fbbf24" }}>
                {r.severity === "high" ? "High" : "Medium"} — ${Math.round(r.shortfallLow).toLocaleString()} to ${Math.round(r.shortfallHigh).toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      )}

      {projections.map((p, i) => {
        const anchoredPot = anchoredPots.find(ap => ap.code === p.code);
        return <FFPotCard key={p.code} projection={p} color={colorList[i % colorList.length]} anchored={!!anchoredPot?.firstEventOverrideDate}/>;
      })}
    </div>
  );
};

function MaintenanceCalendarView({ asset }) {
  const [loading, setLoading] = useState(true);
  const [lease, setLease] = useState(null);
  const [reserveDocs, setReserveDocs] = useState([]);
  const [utilRate, setUtilRate] = useState(null);
  const [scheduledEvents, setScheduledEvents] = useState([]);
  const [seasonalityProfile, setSeasonalityProfile] = useState(null);
  const [costProjections, setCostProjections] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [showSeasonality, setShowSeasonality] = useState(false);
  const [expanded, setExpanded] = useState(null); // key of the one event row currently expanded for editing

  const reload = useCallback(async () => {
    const [util, leaseData, reserves, schedEvts, seasonProfile, shopVisits] = await Promise.all([
      db.getUtilisation(asset.id).catch(() => []),
      asset.currentLeaseId ? db.getLease(asset.currentLeaseId).catch(() => null) : Promise.resolve(null),
      db.getReservePots(asset.id).catch(() => []),
      db.getScheduledEvents(asset.id).catch(() => []),
      db.getSeasonalityProfile(asset.id).catch(() => null),
      db.getShopVisitProjections(asset.id).catch(() => [])
    ]);
    setUtilRate(window.computeRealUtilisationRate(util));
    setLease(leaseData);
    setReserveDocs(reserves);
    setScheduledEvents(schedEvts);
    setSeasonalityProfile(seasonProfile);
    setCostProjections(shopVisits);
  }, [asset.id, asset.currentLeaseId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    reload().catch(() => { if (!cancelled) setLoadError(true); }).then(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [reload]);

  if (loading) {
    return <div style={{ padding: 40, textAlign: "center", color: "#64748b" }}>Loading maintenance calendar for MSN {asset.msn}…</div>;
  }

  if (!asset.currentLeaseId || loadError || !lease) {
    return (
      <div style={{ animation: "fadeIn 0.2s ease" }}>
        <div className="card" style={{ padding: 24, textAlign: "center", color: !asset.currentLeaseId ? "#94a3b8" : "#f87171" }}>
          {!asset.currentLeaseId ? "No active lease on this asset." : "Could not load maintenance calendar data."}
        </div>
      </div>
    );
  }

  const { maintenanceCal, projectionError } = buildFlyForwardProjection({ asset, lease, reserveDocs, utilRate, scheduledEvents, seasonalityProfile, costProjections });

  if (projectionError || !maintenanceCal) {
    return (
      <div style={{ animation: "fadeIn 0.2s ease" }}>
        <div className="card" style={{ padding: 24, textAlign: "center", color: "#f87171" }}>Couldn't build the calendar: {projectionError}</div>
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

  const sourceStyle = {
    derived: { background: "#111c2e", color: "#64748b", label: "Derived" },
    seasonality: { background: "#1a2a10", color: "#a3e635", label: "Seasonality" },
    "airline-stated": { background: "#0d2818", color: "#34d399", label: "Airline-stated" }
  };

  return (
    <div style={{ animation: "fadeIn 0.2s ease" }}>
      <div className="flab g12" style={{ marginBottom: 16, justifyContent: "flex-end" }}>
        <button className="btn btn-ghost" onClick={() => setShowSeasonality(s => !s)}>{showSeasonality ? "Hide" : "🌤 Edit"} Seasonality Profile</button>
      </div>

      {showSeasonality && (
        <SeasonalityProfileEditor asset={asset} profile={seasonalityProfile} onSaved={reload}/>
      )}

      <div style={{ background: "#0d1e33", border: "1px solid #1B3A6B", borderRadius: 10, padding: "12px 16px", marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0" }}>Maintenance Calendar — MSN {asset.msn}</div>
        <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
          A financial-projection input, not a maintenance-tracking tool — dates are deliberately loose and self-correct against real utilisation reports over time. Accepting a seasonality suggestion or entering an airline-stated date is a suggestion you confirm here, never an automatic move.
        </div>
      </div>

      {maintenanceCal.dataCompleteness.length > 0 && (
        <div style={{ background: "#2a220e", border: "1px solid #C9A84C", borderRadius: 10, padding: "12px 16px", marginBottom: 16, fontSize: 12, color: "#fbbf24" }}>
          {maintenanceCal.dataCompleteness.map((gap, i) => (
            <div key={i} style={{ marginTop: i > 0 ? 6 : 0 }}>⚠ {gap.message}</div>
          ))}
        </div>
      )}

      {maintenanceCal.events.length > 0 && <MaintenanceCalendarGrid events={maintenanceCal.events}/>}

      {maintenanceCal.events.map((evt) => {
        const key = `${evt.code}_${evt.dueCycle}`;
        const override = scheduledEvents.find(o => o.code === evt.code && o.dueCycle === evt.dueCycle);
        const sStyle = sourceStyle[evt.source] || sourceStyle.derived;
        const isRowBusy = busy === key;
        const isExpanded = expanded === key;
        return (
          <div key={key} className="card" style={{ padding: 10, marginBottom: 6, opacity: isRowBusy ? 0.6 : 1 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: colorForCode(evt.code), flexShrink: 0 }}/>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#e2e8f0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {evt.code} — {evt.label}
                    {evt.grounding && <span className="pill" style={{ marginLeft: 6, background: "#2a0e0e", color: "#f87171", fontSize: 10 }}>Grounds {evt.durationWeeks}wk</span>}
                  </div>
                  <div style={{ fontSize: 11, color: "#94a3b8" }}>
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
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #1e3048" }}>
                {evt.mergedWithCodes.length > 0 && (
                  <div style={{ fontSize: 11, color: "#64748b", marginBottom: 8 }}>Absorbed with {evt.mergedWithCodes.map(c => c.code).join(", ")}</div>
                )}
                {evt.seasonalitySuggestion && !override && (
                  <div style={{ marginBottom: 10, padding: 10, background: "#0d1622", borderRadius: 6, fontSize: 11, color: "#a3e635" }}>
                    💡 Suggested: {evt.seasonalitySuggestion.suggestedDate.toISOString().slice(0, 10)} — {evt.seasonalitySuggestion.reason}
                  </div>
                )}
                <div style={{ display: "flex", gap: 16, alignItems: "flex-end", flexWrap: "wrap" }}>
                  {evt.grounding && (
                    <label style={{ fontSize: 10, color: "#94a3b8" }}>Duration (weeks)
                      <div><PotNumInput value={evt.durationWeeks} onCommit={v => saveDuration(evt, v)} width={70}/></div>
                    </label>
                  )}
                  <label style={{ fontSize: 10, color: "#94a3b8" }}>Airline-stated date
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

      {maintenanceCal.events.length === 0 && (
        <div className="card" style={{ padding: 24, textAlign: "center", color: "#64748b" }}>No maintenance events projected within the current lease horizon.</div>
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
      <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", marginBottom: 4 }}>Seasonality Profile</div>
      <div style={{ fontSize: 11, color: "#64748b", marginBottom: 10 }}>
        Monthly utilisation weightings (% of a typical month — 100 = average). Shapes automatic utilisation input and suggests, but never moves, off-season check placement. All 12 months are required or the profile is ignored entirely.
      </div>
      <label style={{ fontSize: 10, color: "#94a3b8" }}>Active weeks / year
        <div><PotNumInput value={form.activeWeeksPerYear} onCommit={v => setForm(f => ({ ...f, activeWeeksPerYear: v }))} width={70}/></div>
      </label>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 10, marginTop: 12 }}>
        {MONTHS.map(m => (
          <label key={m} style={{ fontSize: 10, color: "#94a3b8" }}>{m}
            <div><PotNumInput value={form.monthlyWeightings[m]} onCommit={v => setMonth(m, v)} width={60}/></div>
          </label>
        ))}
      </div>
      {!complete && <div style={{ fontSize: 11, color: "#fbbf24", marginTop: 10 }}>⚠ Incomplete — all 12 months need a value before this profile takes effect.</div>}
      <button className="btn btn-gold" style={{ marginTop: 12, fontSize: 12, padding: "6px 14px" }} disabled={saving} onClick={save}>{saving ? "Saving…" : "Save Profile"}</button>
    </div>
  );
};


export { FFPotCard, FlyForward, MaintenanceCalendarView, MiniLineChart, SeasonalityProfileEditor };
