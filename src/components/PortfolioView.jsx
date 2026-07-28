import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ShareModal } from './AssetView';
import { assetStatus, daysFromNow, assetEngineStockPhotoKey, airframeStockPhotoKey } from '../lib/assetHelpers';
import { db } from '../lib/db';
import { buildFleetCalendarData, buildFleetExposureData, buildRouteMatchData } from '../lib/flyForwardHelpers';
import { getDefaultDisclaimer, getTechSpecLogo, openTechSpec } from '../lib/techSpec';
import { MaintenanceCalendarGrid } from './FlyForward';
import { ScenarioSlider } from './Scenarios';

function PortfolioView({assets, notify, onSelect}){
  const[shareOpenId,setShareOpenId]=useState(null);
  const ageFromDOM=(dom)=>{
    if(!dom)return null;
    let d;
    const mmYYYY=/^(\d{2})\/(\d{4})$/.exec(dom);
    if(mmYYYY){
      // MM/YYYY (the format used by Quick Import extraction and the Overview
      // tab's Date of Manufacture field) isn't parseable by `new Date()` directly.
      d=new Date(+mmYYYY[2],+mmYYYY[1]-1,1);
    }else{
      d=new Date(dom);
    }
    if(isNaN(d))return null;
    const years=(new Date()-d)/(1000*60*60*24*365.25);
    return years.toFixed(1);
  };
  const nextCheck=(asset)=>{
    const dates=(asset.checks||[]).map(c=>c.nextDate).filter(Boolean);
    if(!dates.length)return null;
    return dates.sort()[0];
  };
  const soonestGear=(asset)=>{
    const dates=["nose","left","right"].map(k=>asset.landingGear?.[k]?.nextDue).filter(Boolean);
    if(!dates.length)return null;
    return dates.sort()[0];
  };
  const llpCol=(v)=>v===null?"#94a3b8":v<1000?"#dc2626":v<3000?"#d97706":"#16a34a";
  const llpBg=(v)=>v===null?"#f8fafc":v<1000?"#fef2f2":v<3000?"#fffbeb":"#f0fdf4";
  const llpBorder=(v)=>v===null?"#e2e8f0":v<1000?"#fca5a5":v<3000?"#fcd34d":"#86efac";
  const dateBg=(d)=>d===null?"#f8fafc":d<0?"#fef2f2":d<365?"#fffbeb":"#f8fafc";
  const dateCol=(d)=>d===null?"#94a3b8":d<0?"#dc2626":d<365?"#d97706":"#334155";
  const dateBorder=(d)=>d===null?"#e2e8f0":d<0?"#fca5a5":d<365?"#fcd34d":"#e2e8f0";
  const statusLabel={critical:{text:"Critical",bg:"#fef2f2",color:"#dc2626",border:"#fca5a5"},warn:{text:"Attention",bg:"#fffbeb",color:"#d97706",border:"#fcd34d"},ok:{text:"All Clear",bg:"#f0fdf4",color:"#16a34a",border:"#86efac"}};

  return(
    <div style={{background:"#f1f5f9",minHeight:"100vh",margin:"-20px -22px",padding:"32px 28px",animation:"fadeIn 0.2s ease"}}>
      <div style={{maxWidth:1400,margin:"0 auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",marginBottom:32}}>
          <div>
            <h1 style={{fontSize:28,fontWeight:800,color:"#0f172a",letterSpacing:"-0.02em"}}>Fleet Portfolio</h1>
            <p style={{color:"#64748b",fontSize:14,marginTop:4,fontWeight:500}}>{assets.length} aircraft · {new Date().toLocaleDateString("en-GB",{day:"2-digit",month:"long",year:"numeric"})}</p>
          </div>
  
        </div>

        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(380px,1fr))",gap:20}}>
          {assets.map(a=>{
            const st=assetStatus(a);
            const af=a.airframe||{};
            const eng1=a.engines?.[0];const eng2=a.engines?.[1];
            const ll1=lowestLimiter(eng1);const ll2=lowestLimiter(eng2);
            const apuLL=a.apu?.llps?.length?Math.min(...a.apu.llps.map(l=>calcLLPRem(l,a.apu.currentFC))):null;
            const gearDate=soonestGear(a);
            const checkDate=nextCheck(a);
            const gearDays=daysFromNow(gearDate);
            const checkDays=daysFromNow(checkDate);
            const sl=statusLabel[st];

            return(
              <div key={a.id}
                style={{background:"#ffffff",borderRadius:14,border:"1px solid #e2e8f0",
                  boxShadow:"0 4px 16px rgba(0,0,0,0.06)",cursor:"pointer",
                  transition:"all 0.2s",overflow:"hidden"}}
                onClick={()=>onSelect(a.id)}
                onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-3px)";e.currentTarget.style.boxShadow="0 12px 32px rgba(0,0,0,0.12)";}}
                onMouseLeave={e=>{e.currentTarget.style.transform="translateY(0)";e.currentTarget.style.boxShadow="0 4px 16px rgba(0,0,0,0.06)";}}
              >
                {/* Status bar at top */}
                <div style={{height:4,background:st==="critical"?"#dc2626":st==="warn"?"#d97706":"#16a34a"}}/>

                <div style={{padding:22}}>
                  {/* Header */}
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:18}}>
                    <div>
                      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:3}}>
                        <span style={{fontSize:24,fontWeight:800,color:"#0f172a",fontFamily:"monospace",letterSpacing:"0.02em"}}>{a.msn}</span>
                        <span style={{fontSize:16,fontWeight:700,color:"#334155"}}>{a.registration||"—"}</span>
                        {a.currentLeaseId&&<span title="Lease on file" style={{fontSize:14}}>📄</span>}
                      </div>
                      <div style={{fontSize:12,color:"#64748b",fontWeight:500}}>{a.model||"—"} · {a.operator||"—"}</div>
                    </div>
                    <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:6}}>
                      <span style={{background:sl.bg,color:sl.color,border:`1px solid ${sl.border}`,borderRadius:20,padding:"3px 10px",fontSize:11,fontWeight:700}}>{sl.text}</span>
                      {ageFromDOM(a.dom)!==null&&<span style={{fontSize:11,color:"#94a3b8",fontWeight:600}}>{ageFromDOM(a.dom)} yrs old</span>}
                    </div>
                  </div>

                  {/* Airframe */}
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
                    {[["Airframe TSN",fmtHHMM(af.currentFH)],["Airframe CSN",(af.currentFC||0).toLocaleString()]].map(([l,v])=>(
                      <div key={l} style={{background:"#f8fafc",borderRadius:8,padding:"10px 12px",border:"1px solid #e2e8f0"}}>
                        <div style={{fontSize:9,color:"#94a3b8",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:3}}>{l}</div>
                        <div style={{fontSize:18,fontWeight:800,color:"#0f172a",fontFamily:"monospace"}}>{v}</div>
                      </div>
                    ))}
                  </div>

                  {/* LLP Section */}
                  <div style={{marginBottom:14}}>
                    <div style={{fontSize:9,color:"#94a3b8",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:7}}>Life Limited Parts — FC Remaining</div>
                    <div style={{display:"flex",flexDirection:"column",gap:4}}>
                      {[[`Eng 1${eng1?.sn?` · ${eng1.sn}`:""}`,ll1],[`Eng 2${eng2?.sn?` · ${eng2.sn}`:""}`,ll2],["APU",apuLL]].map(([label,val])=>(
                        <div key={label} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:llpBg(val),borderRadius:6,padding:"7px 11px",border:`1px solid ${llpBorder(val)}`}}>
                          <span style={{fontSize:11,color:"#475569",fontWeight:600}}>{label}</span>
                          <span style={{fontSize:13,fontWeight:800,color:llpCol(val),fontFamily:"monospace"}}>{val!==null?val.toLocaleString()+" FC":"No data"}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Dates */}
                  <div style={{marginBottom:18}}>
                    <div style={{fontSize:9,color:"#94a3b8",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:7}}>Key Events</div>
                    <div style={{display:"flex",flexDirection:"column",gap:4}}>
                      {[["Next Gear Overhaul",gearDate,gearDays],["Next Major Check",checkDate,checkDays]].map(([label,date,days])=>(
                        <div key={label} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:dateBg(days),borderRadius:6,padding:"7px 11px",border:`1px solid ${dateBorder(days)}`}}>
                          <span style={{fontSize:11,color:"#475569",fontWeight:600}}>{label}</span>
                          <div style={{textAlign:"right"}}>
                            <div style={{fontSize:12,fontWeight:700,color:dateCol(days)}}>{date?fmtDate(date):"Not entered"}</div>
                            {days!==null&&<div style={{fontSize:10,color:dateCol(days),opacity:0.8}}>{days<0?`${Math.abs(days)}d overdue`:days===0?"Today":`${days}d`}</div>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Footer */}
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",paddingTop:14,borderTop:"1px solid #f1f5f9"}}>
                    <span style={{fontSize:11,color:"#94a3b8",fontWeight:500}}>{a._lastPeriod||"No report"}</span>
                    <div style={{display:"flex",gap:8}}>
                      <button style={{background:"transparent",color:"#475569",border:"1px solid #e2e8f0",borderRadius:7,padding:"8px 14px",fontSize:12,fontWeight:700,cursor:"pointer",letterSpacing:"0.03em",transition:"all 0.15s"}}
                        onClick={e=>{e.stopPropagation();setShareOpenId(a.id);}}>
                        🔗 Share
                      </button>
                      <button style={{background:"#C9A84C",color:"#0a1520",border:"none",borderRadius:7,padding:"8px 16px",fontSize:12,fontWeight:700,cursor:"pointer",letterSpacing:"0.03em",transition:"all 0.15s"}}
                        onMouseEnter={e=>e.currentTarget.style.background="#d4b060"}
                        onMouseLeave={e=>e.currentTarget.style.background="#C9A84C"}
                        onClick={async e=>{
                          e.stopPropagation();
                          const photoKey=assetEngineStockPhotoKey(a);
                          const airframePhotoKey=airframeStockPhotoKey(a.model);
                          const[engPhoto,stockAirframePhoto,logo,defaultDisclaimer]=await Promise.all([
                            photoKey?db.getSetting(photoKey).catch(()=>null):Promise.resolve(null),
                            airframePhotoKey?db.getSetting(airframePhotoKey).catch(()=>null):Promise.resolve(null),
                            getTechSpecLogo(),
                            getDefaultDisclaimer()
                          ]);
                          openTechSpec(buildTechSpecHTML(a,engPhoto||"",logo,defaultDisclaimer,stockAirframePhoto||""));
                        }}>
                        📋 Tech Spec
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          {assets.length===0&&(
            <div style={{gridColumn:"1/-1",textAlign:"center",padding:80,color:"#94a3b8"}}>
              <div style={{fontSize:48,marginBottom:16}}>✈</div>
              <p style={{fontSize:16,fontWeight:600,color:"#334155"}}>No assets in portfolio</p>
              <p style={{fontSize:13,marginTop:8}}>Go to Admin to add your first aircraft</p>
            </div>
          )}
        </div>
      </div>
      {shareOpenId&&<ShareModal asset={assets.find(x=>x.id===shareOpenId)} notify={notify} onClose={()=>setShareOpenId(null)}/>}
    </div>
  );
};

// Time Axis bar chart (fleet-exposure-redesign-handoff.md §3) — Chart.js
// via window.Chart, same pattern as MiniLineChart elsewhere in the app
// (FlyForward.jsx) rather than pulling in Recharts, since window.Chart is
// what's actually loaded. Stacked bar per month: red segment = shortfall,
// green segment = covered. Within-lease is solid; post-lease is a lighter/
// translucent shade of the same colour, per the redesign's "texture
// without hiding anything" requirement. Click a bar to drill into that
// month's events below the chart.
function TimeAxisBarChart({ timeAxis, onBarClick, selectedMonthKey }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  const labels = timeAxis.map(b => b.monthKey);
  // Split each bucket into in-lease (solid) vs. post-lease (translucent)
  // covered/shortfall so the chart shows four stacked series per bar.
  const covered = timeAxis.map(b => Math.max(0, b.coverage));
  const inLeaseShortfall = timeAxis.map(b => b.inLeaseShortfallHigh || 0);
  const postLeaseShortfall = timeAxis.map(b => b.postLeaseShortfallHigh || 0);

  const datasets = [
    { label: "Covered", data: covered, backgroundColor: "#34d399", stack: "s" },
    { label: "Shortfall (within lease)", data: inLeaseShortfall, backgroundColor: "#f87171", stack: "s" },
    { label: "Shortfall (post-lease)", data: postLeaseShortfall, backgroundColor: "#f8717166", stack: "s" }
  ];

  useEffect(() => {
    if (!window.Chart || !canvasRef.current) return;
    if (chartRef.current) chartRef.current.destroy();
    chartRef.current = new window.Chart(canvasRef.current, {
      type: "bar",
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        onClick: (evt, elements) => {
          if (!elements.length) return;
          const idx = elements[0].index;
          onBarClick(timeAxis[idx].monthKey);
        },
        plugins: {
          legend: { labels: { color: "#94a3b8", font: { size: 11 }, boxWidth: 12 } },
          tooltip: {
            callbacks: {
              label: ctx => {
                const v = ctx.parsed.y;
                if (!v) return null;
                return `${ctx.dataset.label}: $${Math.round(v).toLocaleString()}`;
              }
            }
          }
        },
        scales: {
          x: { stacked: true, ticks: { color: "#64748b", font: { size: 10 }, maxTicksLimit: 12 }, grid: { color: "#1e3048" } },
          y: { stacked: true, ticks: { color: "#64748b", font: { size: 10 }, callback: v => "$" + (v / 1000).toFixed(0) + "k" }, grid: { color: "#1e3048" } }
        }
      }
    });
    return () => { if (chartRef.current) chartRef.current.destroy(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(labels), JSON.stringify(datasets)]);

  return <div style={{ height: 260, cursor: "pointer" }}><canvas ref={canvasRef}/></div>;
}

function FleetExposureView({ assets, onSelectAsset }) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [showExcluded, setShowExcluded] = useState(false);
  const [sortMode, setSortMode] = useState("exposure"); // "exposure" | "date"
  const [selectedMonthKey, setSelectedMonthKey] = useState(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const result = await buildFleetExposureData(assets);
      setData(result);
      setLoadError(null);
    } catch (e) {
      setLoadError(e.message || String(e));
    }
    setLoading(false);
  }, [assets]);

  useEffect(() => {
    let cancelled = false;
    reload().then(() => {}).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload]);

  if (loading) {
    return <div style={{ padding: 40, textAlign: "center", color: "#64748b" }}>Loading fleet exposure…</div>;
  }

  if (loadError || !data) {
    return (
      <div className="card" style={{ padding: 24, textAlign: "center", color: "#f87171" }}>
        Couldn't build fleet exposure{loadError ? `: ${loadError}` : "."}
      </div>
    );
  }

  const { headline, timeAxis, assetAxis, excludedAssets } = data;
  const statusColor = { green: "#34d399", amber: "#fbbf24", red: "#f87171" };

  // Sort mode is applied here, client-side, against the same assetAxis
  // data — no re-fetch needed to switch views (fleet-exposure-redesign-
  // handoff.md §2). "By date" pushes assets with no dated event (shouldn't
  // happen for included assets, but defensive) to the end.
  const sortedAssetAxis = [...assetAxis].sort((a, b) => {
    if (sortMode === "date") {
      if (!a.nearestEventDate && !b.nearestEventDate) return 0;
      if (!a.nearestEventDate) return 1;
      if (!b.nearestEventDate) return -1;
      return a.nearestEventDate - b.nearestEventDate;
    }
    return b.totalShortfallHigh - a.totalShortfallHigh;
  });

  const selectedBucket = selectedMonthKey ? timeAxis.find(b => b.monthKey === selectedMonthKey) : null;

  return (
    <div style={{ animation: "fadeIn 0.2s ease" }}>
      {/* HEADLINE — never zero-fill, never refuse to total; the
          completeness gap travels WITH the number, inline. REDESIGN: this
          figure now includes post-lease shortfalls — asset exposure, not
          lease exposure (fleet-exposure-redesign-handoff.md §1). */}
      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", marginBottom: 6 }}>Fleet Exposure</div>
        <div style={{ fontSize: 30, fontWeight: 700, color: headline.totalHighCaseGap > 0 ? "#f87171" : "#34d399" }}>
          ${Math.round(headline.totalHighCaseGap).toLocaleString()}
        </div>
        <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 6 }}>
          High-case gap across {headline.assetsComputed} of {headline.totalAssets} asset{headline.totalAssets === 1 ? "" : "s"} — includes shortfalls landing after redelivery
          {headline.excludedCount > 0 && (
            <>
              {" — "}
              <button onClick={() => setShowExcluded(s => !s)} style={{ background: "none", border: "none", color: "#fbbf24", cursor: "pointer", textDecoration: "underline", font: "inherit", padding: 0 }}>
                {headline.excludedCount} excluded
              </button>
            </>
          )}
        </div>
        <div className="flab g8" style={{ marginTop: 12 }}>
          <span className="pill" style={{ background: "#0d2818", color: "#34d399" }}>{headline.statusCounts.green} green</span>
          <span className="pill" style={{ background: "#2a220e", color: "#fbbf24" }}>{headline.statusCounts.amber} amber</span>
          <span className="pill" style={{ background: "#2a0e0e", color: "#f87171" }}>{headline.statusCounts.red} red</span>
        </div>
        {showExcluded && (
          <div style={{ marginTop: 14, borderTop: "1px solid #1e3048", paddingTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
            {excludedAssets.map((e, i) => (
              <div key={i} className="flj" style={{ fontSize: 12, color: "#94a3b8", cursor: onSelectAsset ? "pointer" : "default" }} onClick={() => onSelectAsset && onSelectAsset(e.assetId)}>
                <span>MSN {e.msn}</span>
                <span style={{ color: e.reason === "COMPUTE_ERROR" ? "#f87171" : "#fbbf24" }}>{e.reason.replace(/_/g, " ")} — {e.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* TIME AXIS — bar chart replacing the flat text list (redesign §3).
          One bar per month with events; empty months compressed out.
          Click a bar to drill into that month's events below. */}
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", marginBottom: 10 }}>
          Time Axis — to lease end, plus each pot's next event beyond it (however far out)
        </div>
        {timeAxis.length === 0 ? (
          <div style={{ color: "#64748b", fontSize: 12 }}>No projected events across the fleet.</div>
        ) : (
          <>
            <TimeAxisBarChart timeAxis={timeAxis} selectedMonthKey={selectedMonthKey} onBarClick={mk => setSelectedMonthKey(mk === selectedMonthKey ? null : mk)}/>
            {selectedBucket ? (
              <div style={{ marginTop: 16, borderTop: "1px solid #1e3048", paddingTop: 12 }}>
                <div className="flj" style={{ marginBottom: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#e2e8f0" }}>{selectedBucket.monthKey}</span>
                  <button onClick={() => setSelectedMonthKey(null)} style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: 11 }}>Close ✕</button>
                </div>
                {selectedBucket.atoms.map((a, i) => (
                  <div key={i} className="flj" style={{ fontSize: 11, padding: "4px 0", color: a.postLeaseEnd ? (statusColor[a.status] || "#e2e8f0") + "aa" : statusColor[a.status] || "#e2e8f0" }}>
                    <span style={{ cursor: onSelectAsset ? "pointer" : "default" }} onClick={() => onSelectAsset && onSelectAsset(a.assetId)}>
                      MSN {a.msn} — {a.code}{a.postLeaseEnd ? " (post-lease)" : ""}
                    </span>
                    <span>${Math.round(a.costHigh).toLocaleString()}{a.shortfallHigh > 0 ? ` · gap $${Math.round(a.shortfallHigh).toLocaleString()}` : ""}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ marginTop: 10, fontSize: 11, color: "#64748b" }}>Click a bar to see that month's events.</div>
            )}
          </>
        )}
      </div>

      {/* ASSET AXIS — sortable (redesign §2): by total exposure (default)
          or by nearest event date. Nearest-event-date always shown
          alongside the total regardless of sort mode. */}
      <div className="card" style={{ padding: 16 }}>
        <div className="flj" style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0" }}>Assets</div>
          <div className="flab g8">
            <button
              onClick={() => setSortMode("exposure")}
              className="btn"
              style={{ fontSize: 11, padding: "4px 10px", background: sortMode === "exposure" ? "#C9A84C" : "transparent", color: sortMode === "exposure" ? "#0a1520" : "#94a3b8", border: "1px solid " + (sortMode === "exposure" ? "#C9A84C" : "#334155") }}>
              By exposure
            </button>
            <button
              onClick={() => setSortMode("date")}
              className="btn"
              style={{ fontSize: 11, padding: "4px 10px", background: sortMode === "date" ? "#C9A84C" : "transparent", color: sortMode === "date" ? "#0a1520" : "#94a3b8", border: "1px solid " + (sortMode === "date" ? "#C9A84C" : "#334155") }}>
              By nearest date
            </button>
          </div>
        </div>
        {sortedAssetAxis.length === 0 && <div style={{ color: "#64748b", fontSize: 12 }}>No assets computed.</div>}
        {sortedAssetAxis.map(a => (
          <div key={a.assetId} className="flj" style={{ padding: "8px 0", borderTop: "1px solid #1e3048", cursor: onSelectAsset ? "pointer" : "default" }} onClick={() => onSelectAsset && onSelectAsset(a.assetId)}>
            <div>
              <span style={{ fontSize: 12, color: "#e2e8f0" }}>MSN {a.msn}</span>
              {a.hasPostLeaseEvent && <span className="pill" style={{ marginLeft: 8, fontSize: 9, background: "#1e293b", color: "#94a3b8" }}>includes post-lease</span>}
              {a.nearestEventDate && (
                <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>
                  Nearest event: {a.nearestEventDate.toISOString().slice(0, 7)}{a.nearestEventPostLease ? " (post-lease)" : ""}
                </div>
              )}
            </div>
            <span style={{ fontSize: 12, fontWeight: 700, color: statusColor[a.worstStatus] || "#e2e8f0" }}>
              ${Math.round(a.totalShortfallHigh).toLocaleString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------
// Route Suitability Matcher (Brain 8) — fleet-level Scenarios.
//
// "We have this route to fill — which asset is best placed?" Input a
// route's FH/month, FC/month, and window; every eligible asset gets run
// through Brains 3-6 twice (current profile vs. route profile swapped in)
// via buildRouteMatchData, then ranked by operational fit with financial
// impact shown alongside — never collapsed into one score (handoff §4).
//
// V1 note: the route profile is swapped in for the asset's whole
// projection horizon, not reverted at the route's end date — see
// routeMatcher.js's file header for the full reasoning. Start/end dates
// here are for eligibility framing and the label shown per result, not a
// literal reversion point in the math yet.
// ---------------------------------------------------------------------

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function defaultRouteEnd() {
  const d = new Date();
  d.setMonth(d.getMonth() + 6);
  return d.toISOString().slice(0, 10);
}

function fmtMonthYear(date) {
  return date ? date.toISOString().slice(0, 7) : "—";
}

function formatShiftLabel(p) {
  if (p.shiftMonths != null) {
    return p.shiftMonths === 0 ? "No change" : (p.shiftMonths < 0 ? `${Math.abs(p.shiftMonths)} mo earlier` : `${p.shiftMonths} mo later`);
  }
  // Every pot in this table is a tracked/confirmed pot (routeMatcher.js
  // only produces a row for eligible pots) — a null date here means "no
  // event within the projection horizon under that profile," not "no
  // data." Distinguishing the two matters: a lower-utilisation route
  // routinely pushes a pot's next event past lease end, which looks
  // identical to a real gap unless labelled — this was flagged as
  // confusing in a real test pass before the label existed.
  if (p.routeDate && !p.baseDate) return "Now within horizon";
  if (p.baseDate && !p.routeDate) return "Beyond horizon on this route";
  return "Beyond horizon in both";
}

function RouteMatcherView({ assets, onSelectAsset }) {
  const [fhPerMonth, setFhPerMonth] = useState(70);
  const [fcPerMonth, setFcPerMonth] = useState(45);
  const [startDate, setStartDate] = useState(todayISO());
  const [endDate, setEndDate] = useState(defaultRouteEnd());

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [showExcluded, setShowExcluded] = useState(false);

  const runMatch = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const route = { fhPerMonth: Number(fhPerMonth) || 0, fcPerMonth: Number(fcPerMonth) || 0, startDate, endDate };
      const result = await buildRouteMatchData(assets, route);
      setData(result);
    } catch (e) {
      setLoadError(e.message || String(e));
    }
    setLoading(false);
  }, [assets, fhPerMonth, fcPerMonth, startDate, endDate]);

  const financialColor = (v) => (v == null ? "#475569" : v > 0 ? "#f87171" : v < 0 ? "#34d399" : "#94a3b8");
  const disruptionColor = (v) => (v > 0 ? "#f87171" : "#34d399");

  return (
    <div style={{ animation: "fadeIn 0.2s ease" }}>
      <div style={{ background: "#0d1e33", border: "1px solid #1B3A6B", borderRadius: 10, padding: "12px 16px", marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0" }}>Route Suitability Matcher</div>
        <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
          Describe the route — a wet lease, a seasonal schedule, a reassignment — and every eligible asset is compared against it. Exploratory only; nothing here is saved.
        </div>
      </div>

      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", marginBottom: 12 }}>The route</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 12 }}>
          <label style={{ fontSize: 11, color: "#94a3b8" }}>
            FH / month
            <input type="number" min="0" step="1" value={fhPerMonth} onChange={e => setFhPerMonth(e.target.value)}
              style={{ display: "block", width: "100%", marginTop: 4, fontSize: 13, padding: "7px 9px" }}/>
          </label>
          <label style={{ fontSize: 11, color: "#94a3b8" }}>
            FC / month
            <input type="number" min="0" step="1" value={fcPerMonth} onChange={e => setFcPerMonth(e.target.value)}
              style={{ display: "block", width: "100%", marginTop: 4, fontSize: 13, padding: "7px 9px" }}/>
          </label>
          <label style={{ fontSize: 11, color: "#94a3b8" }}>
            Start date
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
              style={{ display: "block", width: "100%", marginTop: 4, fontSize: 13, padding: "7px 9px" }}/>
          </label>
          <label style={{ fontSize: 11, color: "#94a3b8" }}>
            End date
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
              style={{ display: "block", width: "100%", marginTop: 4, fontSize: 13, padding: "7px 9px" }}/>
          </label>
        </div>
        {fhPerMonth > 0 && fcPerMonth > 0 && (
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 12 }}>
            ≈ {(Number(fhPerMonth) / Number(fcPerMonth)).toFixed(1)} FH:FC average sector
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button className="btn btn-gold" style={{ fontSize: 12, padding: "8px 18px" }}
            disabled={loading || !fhPerMonth || !fcPerMonth || !startDate || !endDate}
            onClick={runMatch}>
            {loading ? "Matching…" : "Find best match"}
          </button>
        </div>
        {loadError && <div style={{ marginTop: 10, fontSize: 12, color: "#f87171" }}>Couldn't run the match: {loadError}</div>}
      </div>

      {data && (
        <>
          {data.excludedAssets.length > 0 && (
            <div className="card" style={{ padding: 16, marginBottom: 16 }}>
              <div className="flj">
                <span style={{ fontSize: 12, color: "#94a3b8" }}>{data.excludedAssets.length} asset{data.excludedAssets.length === 1 ? "" : "s"} not compared</span>
                <button onClick={() => setShowExcluded(s => !s)} style={{ background: "none", border: "none", color: "#fbbf24", cursor: "pointer", textDecoration: "underline", font: "inherit", padding: 0, fontSize: 12 }}>
                  {showExcluded ? "Hide" : "Show"}
                </button>
              </div>
              {showExcluded && (
                <div style={{ marginTop: 10, borderTop: "1px solid #1e3048", paddingTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                  {data.excludedAssets.map((e, i) => (
                    <div key={i} className="flj" style={{ fontSize: 12, color: "#94a3b8", cursor: onSelectAsset ? "pointer" : "default" }} onClick={() => onSelectAsset && onSelectAsset(e.assetId)}>
                      <span>MSN {e.msn}</span>
                      <span style={{ color: e.reason === "COMPUTE_ERROR" ? "#f87171" : "#fbbf24" }}>{e.reason.replace(/_/g, " ")} — {e.message}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="card" style={{ padding: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", marginBottom: 4 }}>Ranked — best operational fit first</div>
            <div style={{ fontSize: 11, color: "#64748b", marginBottom: 12 }}>
              Financial impact is shown alongside, not folded into the ranking — the best fit and the cheapest option aren't always the same asset.
            </div>
            {data.ranked.length === 0 && <div style={{ fontSize: 12, color: "#64748b" }}>No eligible assets to compare.</div>}
            {data.ranked.map((r, i) => {
              const expanded = expandedId === r.assetId;
              return (
                <div key={r.assetId} style={{ borderTop: i > 0 ? "1px solid #1e3048" : "none", padding: "10px 0" }}>
                  <div className="flj" style={{ cursor: "pointer" }} onClick={() => setExpandedId(expanded ? null : r.assetId)}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: 11, color: "#475569", width: 18 }}>#{i + 1}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0" }}>MSN {r.msn}</span>
                    </div>
                    <div style={{ display: "flex", gap: 18, alignItems: "center" }}>
                      {r.clashes.length > 0 && (
                        <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 6, background: "#2a0e0e", color: "#f87171", fontWeight: 700 }}>
                          ⚠ {r.clashes.length} clash{r.clashes.length === 1 ? "" : "es"}
                        </span>
                      )}
                      <span style={{ fontSize: 11, color: "#64748b" }}>
                        Disruption <span style={{ color: disruptionColor(r.disruptionMonths), fontWeight: 700 }}>{r.disruptionMonths} mo</span>
                      </span>
                      <span style={{ fontSize: 11, color: "#64748b" }}>
                        Cost delta <span style={{ color: financialColor(r.financialDeltaHigh), fontWeight: 700 }}>
                          {r.financialDeltaHigh > 0 ? "+" : ""}${Math.round(r.financialDeltaHigh).toLocaleString()}
                        </span>
                      </span>
                      <span style={{ fontSize: 11, color: "#475569" }}>{expanded ? "▲" : "▼"}</span>
                    </div>
                  </div>
                  {expanded && (
                    <>
                      <table style={{ fontSize: 12, width: "100%", marginTop: 10 }}>
                        <thead><tr>
                          <th style={{ color: "#64748b", textAlign: "left" }}>Pot</th>
                          <th style={{ color: "#64748b", textAlign: "right" }}>Current profile</th>
                          <th style={{ color: "#64748b", textAlign: "right" }}>On this route</th>
                          <th style={{ color: "#64748b", textAlign: "right" }}>Shift</th>
                        </tr></thead>
                        <tbody>
                          {r.potDeltas.map(p => (
                            <tr key={p.code}>
                              <td style={{ padding: "5px 0", color: "#e2e8f0" }}>{p.code} — {p.label}</td>
                              <td style={{ textAlign: "right", color: "#94a3b8" }}>
                                {p.baseDate ? fmtMonthYear(p.baseDate) : "Beyond horizon"}
                                {p.baseShortfallHigh != null && <div style={{ fontSize: 10, color: financialColor(p.baseShortfallHigh > 0 ? 1 : 0) }}>${Math.round(p.baseShortfallHigh).toLocaleString()}</div>}
                              </td>
                              <td style={{ textAlign: "right", color: "#94a3b8" }}>
                                {p.routeDate ? fmtMonthYear(p.routeDate) : "Beyond horizon"}
                                {p.routeShortfallHigh != null && <div style={{ fontSize: 10, color: financialColor(p.routeShortfallHigh > 0 ? 1 : 0) }}>${Math.round(p.routeShortfallHigh).toLocaleString()}</div>}
                              </td>
                              <td style={{ textAlign: "right", fontSize: 11, color: p.shiftMonths == null ? "#94a3b8" : (p.shiftMonths < 0 ? "#f87171" : p.shiftMonths > 0 ? "#34d399" : "#64748b") }}>
                                {formatShiftLabel(p)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {r.clashes.length > 0 && (
                        <div style={{ marginTop: 10, padding: 10, background: "#2a0e0e", borderRadius: 6 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: "#f87171", marginBottom: 6 }}>Scheduling clashes on this route</div>
                          {r.clashes.map((c, i) => (
                            <div key={i} style={{ fontSize: 11, color: "#fca5a5", padding: "3px 0" }}>
                              {c.code} ({fmtMonthYear(c.groundingStart)}–{fmtMonthYear(c.groundingEnd)}) overlaps MSN {c.withMsn}'s {c.withCode} ({fmtMonthYear(c.withGroundingStart)}–{fmtMonthYear(c.withGroundingEnd)})
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                  {onSelectAsset && (
                    <div style={{ marginTop: 6 }}>
                      <button onClick={() => onSelectAsset(r.assetId)} style={{ background: "none", border: "none", color: "#60a5fa", cursor: "pointer", fontSize: 11, padding: 0 }}>Open MSN {r.msn} →</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};


// ---------------------------------------------------------------------
// Fleet Calendar — fleet-level "Calendar" nav tab (layer3-scenarios-
// build-handoff.md §7 four-layer nav; content itself was unscoped until
// this session — Alan's decision: reuse the asset-level calendar view
// rather than build something new). Every asset's own scheduled events,
// at its own real utilisation rate, flattened into one list and fed to
// the SAME MaintenanceCalendarGrid the asset-level Calendar tab already
// uses — MSN now shown per event since one grid cell can hold events from
// several assets. Read-only: no editing here, that stays on the asset's
// own Calendar tab. No cost figures surfaced deliberately — that's what
// Financials (Fleet Exposure) is for; this tab answers "what's happening
// when," not "what will it cost."
// ---------------------------------------------------------------------

function FleetCalendarView({ assets, onSelectAsset }) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [showExcluded, setShowExcluded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    buildFleetCalendarData(assets)
      .then(result => { if (!cancelled) { setData(result); setLoadError(null); } })
      .catch(e => { if (!cancelled) setLoadError(e.message || String(e)); })
      .then(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assets]);

  if (loading) {
    return <div style={{ padding: 40, textAlign: "center", color: "#64748b" }}>Loading fleet calendar…</div>;
  }
  if (loadError || !data) {
    return (
      <div className="card" style={{ padding: 24, textAlign: "center", color: "#f87171" }}>
        Couldn't build the fleet calendar{loadError ? `: ${loadError}` : "."}
      </div>
    );
  }

  // Only genuine compute errors are excluded now (Alan, July 2026 —
  // TECH_DEBT.md 4.85/4.86 follow-up: no asset is dropped from this view
  // for lacking a lease, confirmed pots, or utilisation history — the
  // checks still happen whether or not that data exists on file). Two
  // distinct data-quality flags, not one: `partial` (no utilisation rate
  // at all — only C-Check dates can show, nothing else can project) is a
  // harder gap than `usedSyntheticPots` (no lease/reserve setup on file,
  // but real component data still drives what IS shown — landing gear
  // next-due and engine LLP remaining life are both real; EN-PR/APU
  // simply don't appear for these assets rather than showing a guess).
  const included = data.filter(a => !a.excluded);
  const excluded = data.filter(a => a.excluded);
  const partial = included.filter(a => a.partial);
  const noReserveSetup = included.filter(a => !a.partial && a.usedSyntheticPots);
  const events = included.flatMap(a => (a.events || []).map(e => ({ ...e, msn: a.msn, assetId: a.assetId })));

  return (
    <div style={{ animation: "fadeIn 0.2s ease" }}>
      <div style={{ background: "#0d1e33", border: "1px solid #1B3A6B", borderRadius: 10, padding: "12px 16px", marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0" }}>Calendar</div>
        <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
          Event clustering across the fleet's maintenance calendar — scheduling only, no cost figures. See Financials for the money view. Every asset appears here regardless of lease status — a scheduled check happens whether or not there's a lease on file.
        </div>
        {noReserveSetup.length > 0 && (
          <div style={{ marginTop: 8, fontSize: 12, color: "#94a3b8" }}>
            ℹ {noReserveSetup.length} asset{noReserveSetup.length === 1 ? "" : "s"} with no lease/reserve setup on file — landing gear and engine LLP dates shown are real (from tracked component data). Engine PR and APU dates aren't shown for these assets — no real data to derive them from, so they're omitted rather than guessed at ({noReserveSetup.map(a => `MSN ${a.msn}`).join(", ")})
          </div>
        )}
        {partial.length > 0 && (
          <div style={{ marginTop: 8, fontSize: 12, color: "#fbbf24" }}>
            ⚠ {partial.length} asset{partial.length === 1 ? "" : "s"} showing C-Check dates only — no utilisation history to project any engine/APU/landing-gear events ({partial.map(a => `MSN ${a.msn}`).join(", ")})
          </div>
        )}
        {excluded.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <button onClick={() => setShowExcluded(s => !s)} style={{ background: "none", border: "none", color: "#fbbf24", cursor: "pointer", textDecoration: "underline", font: "inherit", padding: 0, fontSize: 12 }}>
              {excluded.length} asset{excluded.length === 1 ? "" : "s"} not shown
            </button>
            {showExcluded && (
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                {excluded.map((e, i) => (
                  <div key={i} className="flj" style={{ fontSize: 12, color: "#94a3b8", cursor: onSelectAsset ? "pointer" : "default" }} onClick={() => onSelectAsset && onSelectAsset(e.assetId)}>
                    <span>MSN {e.msn}</span>
                    <span style={{ color: "#f87171" }}>{e.excluded.code.replace(/_/g, " ")} — {e.excluded.message}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {events.length === 0
        ? <div className="card" style={{ padding: 24, textAlign: "center", color: "#64748b" }}>No scheduled events across the fleet.</div>
        : <MaintenanceCalendarGrid events={events}/>}
    </div>
  );
}

// ---------------------------------------------------------------------
// Pandemic scenario — fleet-level Scenarios, alongside Route Matcher
// (layer3-scenarios-build-handoff.md §4a; replaces the killed fleet-wide
// chat box for this one hypothetical, per Alan's decision to keep the
// slider version). Grounds every asset from today for N months, combined
// with each asset's own real maintenance grounding via Math.min — no
// stacking (fleetExposure.js's applyPandemicGrounding). Non-destructive,
// same as everything else in Scenarios: nothing writes to Firestore.
// ---------------------------------------------------------------------

function PandemicScenarioView({ assets }) {
  const [months, setMonths] = useState(4);
  const [loading, setLoading] = useState(false);
  const [base, setBase] = useState(null);
  const [scenario, setScenario] = useState(null);
  const [error, setError] = useState(null);
  const [active, setActive] = useState(false);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [baseResult, scenarioResult] = await Promise.all([
        buildFleetExposureData(assets, 0),
        buildFleetExposureData(assets, months)
      ]);
      setBase(baseResult);
      setScenario(scenarioResult);
      setActive(true);
    } catch (e) {
      setError(e.message || String(e));
    }
    setLoading(false);
  }, [assets, months]);

  const reset = () => { setActive(false); setBase(null); setScenario(null); };

  const deltaColor = (b, s) => (s > b ? "#f87171" : s < b ? "#34d399" : "#94a3b8");

  return (
    <div className="card" style={{ padding: 16, marginTop: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", marginBottom: 4 }}>Pandemic Scenario</div>
      <div style={{ fontSize: 12, color: "#64748b", marginBottom: 12 }}>
        Grounds the entire fleet from today for the selected period, combined with each asset's own real maintenance grounding — whichever grounds harder wins, downtime never stacks. Exploratory only; nothing here is saved.
      </div>
      <ScenarioSlider label="Grounding duration" value={months} onChange={setMonths} min={1} max={12} step={1} format={v => `${v} mo`}/>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: active ? 16 : 0 }}>
        {active && <button className="btn btn-ghost" style={{ fontSize: 12, padding: "6px 14px" }} onClick={reset}>Reset</button>}
        <button className="btn btn-gold" style={{ fontSize: 12, padding: "8px 18px" }} disabled={loading} onClick={run}>
          {loading ? "Running…" : "Run pandemic scenario"}
        </button>
      </div>
      {error && <div style={{ fontSize: 12, color: "#f87171" }}>Couldn't run the scenario: {error}</div>}
      {active && base && scenario && (
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <div className="card" style={{ padding: 16, flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>Base Case — High-case gap</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#e2e8f0" }}>${Math.round(base.headline.totalHighCaseGap).toLocaleString()}</div>
          </div>
          <div className="card" style={{ padding: 16, flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>{months}-Month Grounding — High-case gap</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: deltaColor(base.headline.totalHighCaseGap, scenario.headline.totalHighCaseGap) }}>
              ${Math.round(scenario.headline.totalHighCaseGap).toLocaleString()}
            </div>
            <div style={{ fontSize: 11, marginTop: 4, color: deltaColor(base.headline.totalHighCaseGap, scenario.headline.totalHighCaseGap) }}>
              {scenario.headline.totalHighCaseGap > base.headline.totalHighCaseGap ? "▲" : scenario.headline.totalHighCaseGap < base.headline.totalHighCaseGap ? "▼" : "—"}{" "}
              ${Math.round(Math.abs(scenario.headline.totalHighCaseGap - base.headline.totalHighCaseGap)).toLocaleString()} vs. base case
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Fleet-level structured controls (scenarios-structured-controls-
// handoff.md §2) — four new controls alongside Route Matcher and the
// existing pandemic slider: Lessee Default, Fleet-Wide Utilisation
// Change, Engine-Type Cost Shock, Extended Maintenance Duration. Each is
// its own independent base-vs-scenario run, same pattern as
// PandemicScenarioView above (not combined into one scenario — mirrors
// the one control already built here). Non-destructive throughout:
// nothing writes to Firestore.
// ---------------------------------------------------------------------

// Small shared comparison-card pair, since all four controls render the
// same base-vs-scenario headline shape.
function FleetScenarioComparison({ base, scenario, scenarioLabel }) {
  const deltaColor = (b, s) => (s > b ? "#f87171" : s < b ? "#34d399" : "#94a3b8");
  return (
    <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
      <div className="card" style={{ padding: 16, flex: 1, minWidth: 220 }}>
        <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>Base Case — High-case gap</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: "#e2e8f0" }}>${Math.round(base.headline.totalHighCaseGap).toLocaleString()}</div>
      </div>
      <div className="card" style={{ padding: 16, flex: 1, minWidth: 220 }}>
        <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>{scenarioLabel} — High-case gap</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: deltaColor(base.headline.totalHighCaseGap, scenario.headline.totalHighCaseGap) }}>
          ${Math.round(scenario.headline.totalHighCaseGap).toLocaleString()}
        </div>
        <div style={{ fontSize: 11, marginTop: 4, color: deltaColor(base.headline.totalHighCaseGap, scenario.headline.totalHighCaseGap) }}>
          {scenario.headline.totalHighCaseGap > base.headline.totalHighCaseGap ? "▲" : scenario.headline.totalHighCaseGap < base.headline.totalHighCaseGap ? "▼" : "—"}{" "}
          ${Math.round(Math.abs(scenario.headline.totalHighCaseGap - base.headline.totalHighCaseGap)).toLocaleString()} vs. base case
        </div>
      </div>
    </div>
  );
}

// Lessee Default — dropdown populated from the fleet's actual current
// lessees (fetched once on mount, since `assets` here only carries
// currentLeaseId, not the expanded lease doc). Answers "what if our
// biggest lessee stops paying."
function LesseeDefaultScenarioView({ assets }) {
  const [lessees, setLessees] = useState([]);
  const [loadingLessees, setLoadingLessees] = useState(true);
  const [lesseeId, setLesseeId] = useState("");
  const [months, setMonths] = useState(6);
  const [loading, setLoading] = useState(false);
  const [base, setBase] = useState(null);
  const [scenario, setScenario] = useState(null);
  const [error, setError] = useState(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const withLease = assets.filter(a => a.currentLeaseId);
      const leaseDocs = await Promise.all(withLease.map(a => db.getLease(a.currentLeaseId).catch(() => null)));
      if (cancelled) return;
      const distinct = Array.from(new Set(leaseDocs.filter(Boolean).map(l => l.lessee).filter(Boolean)));
      setLessees(distinct);
      if (distinct.length) setLesseeId(distinct[0]);
      setLoadingLessees(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assets]);

  const run = useCallback(async () => {
    if (!lesseeId) return;
    setLoading(true);
    setError(null);
    try {
      const [baseResult, scenarioResult] = await Promise.all([
        buildFleetExposureData(assets, 0),
        buildFleetExposureData(assets, 0, { lesseeId, lesseeDefaultMonths: months })
      ]);
      setBase(baseResult);
      setScenario(scenarioResult);
      setActive(true);
    } catch (e) {
      setError(e.message || String(e));
    }
    setLoading(false);
  }, [assets, lesseeId, months]);

  const reset = () => { setActive(false); setBase(null); setScenario(null); };

  if (loadingLessees) {
    return <div className="card" style={{ padding: 16, marginTop: 16, color: "#64748b", fontSize: 12 }}>Loading lessees…</div>;
  }

  if (!lessees.length) {
    return (
      <div className="card" style={{ padding: 16, marginTop: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", marginBottom: 4 }}>Lessee Default</div>
        <div style={{ fontSize: 12, color: "#64748b" }}>No leases on file across the fleet yet — nothing to model a default against.</div>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 16, marginTop: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", marginBottom: 4 }}>Lessee Default</div>
      <div style={{ fontSize: 12, color: "#64748b", marginBottom: 12 }}>
        Suspends reserve accrual on every asset leased to the selected lessee, from today for the selected period — usage continues, only the payments stop. Exploratory only; nothing here is saved.
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <label style={{ fontSize: 11, color: "#94a3b8", flex: 1, minWidth: 180 }}>
          Lessee
          <select value={lesseeId} onChange={e => setLesseeId(e.target.value)} style={{ display: "block", width: "100%", marginTop: 4, fontSize: 13, padding: "7px 9px" }}>
            {lessees.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 11, color: "#94a3b8", flex: 1, minWidth: 140 }}>
          Duration (months)
          <input type="number" min="1" step="1" value={months} onChange={e => setMonths(Math.max(1, Number(e.target.value) || 1))}
            style={{ display: "block", width: "100%", marginTop: 4, fontSize: 13, padding: "7px 9px" }}/>
        </label>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: active ? 16 : 0 }}>
        {active && <button className="btn btn-ghost" style={{ fontSize: 12, padding: "6px 14px" }} onClick={reset}>Reset</button>}
        <button className="btn btn-gold" style={{ fontSize: 12, padding: "8px 18px" }} disabled={loading} onClick={run}>
          {loading ? "Running…" : "Run lessee default scenario"}
        </button>
      </div>
      {error && <div style={{ fontSize: 12, color: "#f87171" }}>Couldn't run the scenario: {error}</div>}
      {active && base && scenario && <FleetScenarioComparison base={base} scenario={scenario} scenarioLabel={`${lesseeId} defaults ${months} mo`}/>}
    </div>
  );
}

// Fleet-Wide Utilisation Change — same % shape as the asset-level
// utilisation slider, applied to every asset simultaneously. Answers
// "what if the market softens/firms 20%."
function FleetUtilisationScenarioView({ assets }) {
  const [pct, setPct] = useState(-20);
  const [loading, setLoading] = useState(false);
  const [base, setBase] = useState(null);
  const [scenario, setScenario] = useState(null);
  const [error, setError] = useState(null);
  const [active, setActive] = useState(false);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [baseResult, scenarioResult] = await Promise.all([
        buildFleetExposureData(assets, 0),
        buildFleetExposureData(assets, 0, { fleetUtilPct: pct })
      ]);
      setBase(baseResult);
      setScenario(scenarioResult);
      setActive(true);
    } catch (e) {
      setError(e.message || String(e));
    }
    setLoading(false);
  }, [assets, pct]);

  const reset = () => { setActive(false); setBase(null); setScenario(null); };

  return (
    <div className="card" style={{ padding: 16, marginTop: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", marginBottom: 4 }}>Fleet-Wide Utilisation Change</div>
      <div style={{ fontSize: 12, color: "#64748b", marginBottom: 12 }}>
        Applies the same utilisation % change to every asset in the fleet simultaneously. Exploratory only; nothing here is saved.
      </div>
      <ScenarioSlider label="Utilisation change" value={pct} onChange={setPct} min={-50} max={50} step={1} format={v => (v > 0 ? "+" : "") + v + "%"}/>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: active ? 16 : 0 }}>
        {active && <button className="btn btn-ghost" style={{ fontSize: 12, padding: "6px 14px" }} onClick={reset}>Reset</button>}
        <button className="btn btn-gold" style={{ fontSize: 12, padding: "8px 18px" }} disabled={loading} onClick={run}>
          {loading ? "Running…" : "Run utilisation scenario"}
        </button>
      </div>
      {error && <div style={{ fontSize: 12, color: "#f87171" }}>Couldn't run the scenario: {error}</div>}
      {active && base && scenario && <FleetScenarioComparison base={base} scenario={scenario} scenarioLabel={`${pct > 0 ? "+" : ""}${pct}% utilisation`}/>}
    </div>
  );
}

// Engine-Type Cost Shock — CFM/V2500 only, matching the two-family system
// already used elsewhere in the app (FlyForward.jsx's isCFM/AssumptionsPanel).
// Models AD impact, parts scarcity, MRO capacity squeeze on that family.
function EngineCostShockScenarioView({ assets }) {
  const [engineFamily, setEngineFamily] = useState("CFM");
  const [pct, setPct] = useState(20);
  const [loading, setLoading] = useState(false);
  const [base, setBase] = useState(null);
  const [scenario, setScenario] = useState(null);
  const [error, setError] = useState(null);
  const [active, setActive] = useState(false);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [baseResult, scenarioResult] = await Promise.all([
        buildFleetExposureData(assets, 0),
        buildFleetExposureData(assets, 0, { engineCostShock: { engineFamily, pct } })
      ]);
      setBase(baseResult);
      setScenario(scenarioResult);
      setActive(true);
    } catch (e) {
      setError(e.message || String(e));
    }
    setLoading(false);
  }, [assets, engineFamily, pct]);

  const reset = () => { setActive(false); setBase(null); setScenario(null); };

  return (
    <div className="card" style={{ padding: 16, marginTop: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", marginBottom: 4 }}>Engine-Type Cost Shock</div>
      <div style={{ fontSize: 12, color: "#64748b", marginBottom: 12 }}>
        Applies a cost multiplier to every projected shop visit for the selected engine family across the fleet. Exploratory only; nothing here is saved.
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <label style={{ fontSize: 11, color: "#94a3b8", flex: 1, minWidth: 140 }}>
          Engine family
          <select value={engineFamily} onChange={e => setEngineFamily(e.target.value)} style={{ display: "block", width: "100%", marginTop: 4, fontSize: 13, padding: "7px 9px" }}>
            <option value="CFM">CFM56</option>
            <option value="V2500">V2500</option>
          </select>
        </label>
        <label style={{ fontSize: 11, color: "#94a3b8", flex: 1, minWidth: 140 }}>
          Cost change (%)
          <input type="number" step="1" value={pct} onChange={e => setPct(Number(e.target.value) || 0)}
            style={{ display: "block", width: "100%", marginTop: 4, fontSize: 13, padding: "7px 9px" }}/>
        </label>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: active ? 16 : 0 }}>
        {active && <button className="btn btn-ghost" style={{ fontSize: 12, padding: "6px 14px" }} onClick={reset}>Reset</button>}
        <button className="btn btn-gold" style={{ fontSize: 12, padding: "8px 18px" }} disabled={loading} onClick={run}>
          {loading ? "Running…" : "Run cost shock scenario"}
        </button>
      </div>
      {error && <div style={{ fontSize: 12, color: "#f87171" }}>Couldn't run the scenario: {error}</div>}
      {active && base && scenario && <FleetScenarioComparison base={base} scenario={scenario} scenarioLabel={`${engineFamily} ${pct > 0 ? "+" : ""}${pct}%`}/>}
    </div>
  );
}

// Extended Maintenance Duration — models MRO backlog / parts delays by
// adding months to the selected check type's duration default, fleet-wide.
function ExtendedMaintenanceScenarioView({ assets }) {
  const [checkType, setCheckType] = useState("6Y");
  const [extraMonths, setExtraMonths] = useState(1);
  const [loading, setLoading] = useState(false);
  const [base, setBase] = useState(null);
  const [scenario, setScenario] = useState(null);
  const [error, setError] = useState(null);
  const [active, setActive] = useState(false);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [baseResult, scenarioResult] = await Promise.all([
        buildFleetExposureData(assets, 0),
        buildFleetExposureData(assets, 0, { extendedMaintenanceDuration: { checkType, extraMonths } })
      ]);
      setBase(baseResult);
      setScenario(scenarioResult);
      setActive(true);
    } catch (e) {
      setError(e.message || String(e));
    }
    setLoading(false);
  }, [assets, checkType, extraMonths]);

  const reset = () => { setActive(false); setBase(null); setScenario(null); };

  return (
    <div className="card" style={{ padding: 16, marginTop: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", marginBottom: 4 }}>Extended Maintenance Duration</div>
      <div style={{ fontSize: 12, color: "#64748b", marginBottom: 12 }}>
        Adds extra downtime to every projected check of the selected type across the fleet, pushing availability and downstream events. Models MRO backlog or parts delays. Exploratory only; nothing here is saved.
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <label style={{ fontSize: 11, color: "#94a3b8", flex: 1, minWidth: 140 }}>
          Check type
          <select value={checkType} onChange={e => setCheckType(e.target.value)} style={{ display: "block", width: "100%", marginTop: 4, fontSize: 13, padding: "7px 9px" }}>
            <option value="2Y">2-Year Check</option>
            <option value="6Y">6-Year Check</option>
            <option value="12Y">12-Year Check</option>
          </select>
        </label>
        <label style={{ fontSize: 11, color: "#94a3b8", flex: 1, minWidth: 140 }}>
          Extra duration (months)
          <input type="number" min="0" step="1" value={extraMonths} onChange={e => setExtraMonths(Math.max(0, Number(e.target.value) || 0))}
            style={{ display: "block", width: "100%", marginTop: 4, fontSize: 13, padding: "7px 9px" }}/>
        </label>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: active ? 16 : 0 }}>
        {active && <button className="btn btn-ghost" style={{ fontSize: 12, padding: "6px 14px" }} onClick={reset}>Reset</button>}
        <button className="btn btn-gold" style={{ fontSize: 12, padding: "8px 18px" }} disabled={loading} onClick={run}>
          {loading ? "Running…" : "Run duration scenario"}
        </button>
      </div>
      {error && <div style={{ fontSize: 12, color: "#f87171" }}>Couldn't run the scenario: {error}</div>}
      {active && base && scenario && <FleetScenarioComparison base={base} scenario={scenario} scenarioLabel={`${checkType} +${extraMonths} mo`}/>}
    </div>
  );
}

// Wrapper — groups all four new controls under one heading, sits
// alongside PandemicScenarioView on the fleet Scenarios page.
function FleetScenarioControls({ assets }) {
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", marginBottom: 4 }}>Fleet Scenario Controls</div>
      <div style={{ fontSize: 12, color: "#64748b" }}>Four independent structured controls — each runs its own base-vs-scenario comparison. Not combined with each other or with the pandemic slider above.</div>
      <LesseeDefaultScenarioView assets={assets}/>
      <FleetUtilisationScenarioView assets={assets}/>
      <EngineCostShockScenarioView assets={assets}/>
      <ExtendedMaintenanceScenarioView assets={assets}/>
    </div>
  );
}

export { FleetCalendarView, FleetExposureView, FleetScenarioControls, PandemicScenarioView, PortfolioView, RouteMatcherView };
