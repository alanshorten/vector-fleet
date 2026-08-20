import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ShareModal } from './AssetView';
import { assetStatus, daysFromNow, assetEngineStockPhotoKey, airframeStockPhotoKey } from '../lib/assetHelpers';
import { db } from '../lib/db';
import { buildFleetCalendarData, buildFleetExposureData, buildRouteMatchData } from '../lib/flyForwardHelpers';
import { getDefaultDisclaimer, getTechSpecLogo, openTechSpec } from '../lib/techSpec';
import { MaintenanceCalendarGrid } from './FlyForward';
import { ScenarioSlider } from './Scenarios';
import { useLayoutMode } from '../lib/layoutMode';

function PortfolioView({assets, notify, onSelect}){
  const[shareOpenId,setShareOpenId]=useState(null);
  const { mode: layoutMode } = useLayoutMode();
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
  const llpCol=(v)=>v===null?"var(--color-graphite)":v<1000?"var(--color-critical)":v<3000?"var(--color-attention)":"var(--color-positive)";
  const llpBg=(v)=>v===null?"var(--color-technical-grey)":v<1000?"var(--color-critical-tint)":v<3000?"var(--color-attention-tint)":"var(--color-positive-tint)";
  const llpBorder=(v)=>v===null?"var(--color-divider)":v<1000?"var(--color-critical)":v<3000?"var(--color-attention)":"var(--color-positive)";
  const dateBg=(d)=>d===null?"var(--color-technical-grey)":d<0?"var(--color-critical-tint)":d<365?"var(--color-attention-tint)":"var(--color-technical-grey)";
  const dateCol=(d)=>d===null?"var(--color-graphite)":d<0?"var(--color-critical)":d<365?"var(--color-attention)":"var(--color-graphite)";
  const dateBorder=(d)=>d===null?"var(--color-divider)":d<0?"var(--color-critical)":d<365?"var(--color-attention)":"var(--color-divider)";
  const statusLabel={critical:{text:"Critical",bg:"var(--color-critical-tint)",color:"var(--color-critical)",border:"var(--color-critical)"},warn:{text:"Attention",bg:"var(--color-attention-tint)",color:"var(--color-attention)",border:"var(--color-attention)"},ok:{text:"All Clear",bg:"var(--color-positive-tint)",color:"var(--color-positive)",border:"var(--color-positive)"}};

  return(
    <div style={{background:"var(--color-technical-grey)",minHeight:"100vh",margin:"-20px -22px",padding:"32px 28px",animation:"fadeIn 0.2s ease"}}>
      <div style={{maxWidth: layoutMode === "landscape" ? 1800 : 1400, margin:"0 auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",marginBottom:32}}>
          <div>
            <h1 style={{fontSize:28,fontWeight:800,color:"var(--color-carbon)",letterSpacing:"-0.02em"}}>Fleet Portfolio</h1>
            <p style={{color:"var(--color-graphite)",fontSize:14,marginTop:4,fontWeight:500}}>{assets.length} aircraft · {new Date().toLocaleDateString("en-GB",{day:"2-digit",month:"long",year:"numeric"})}</p>
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
                style={{background:"var(--color-soft-white)",borderRadius:14,border:"1px solid var(--color-divider)",
                  boxShadow:"0 4px 16px rgba(0,0,0,0.06)",cursor:"pointer",
                  transition:"all 0.2s",overflow:"hidden"}}
                onClick={()=>onSelect(a.id)}
                onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-3px)";e.currentTarget.style.boxShadow="0 12px 32px rgba(0,0,0,0.12)";}}
                onMouseLeave={e=>{e.currentTarget.style.transform="translateY(0)";e.currentTarget.style.boxShadow="0 4px 16px rgba(0,0,0,0.06)";}}
              >
                {/* Status bar at top */}
                <div style={{height:4,background:st==="critical"?"var(--color-critical)":st==="warn"?"var(--color-attention)":"var(--color-positive)"}}/>

                <div style={{padding:22}}>
                  {/* Header */}
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:18}}>
                    <div>
                      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:3}}>
                        <span style={{fontSize:24,fontWeight:800,color:"var(--color-carbon)",fontFamily:"monospace",letterSpacing:"0.02em"}}>{a.msn}</span>
                        <span style={{fontSize:16,fontWeight:700,color:"var(--color-carbon)"}}>{a.registration||"—"}</span>
                        {a.currentLeaseId&&<span title="Lease on file" style={{fontSize:14}}>📄</span>}
                      </div>
                      <div style={{fontSize:12,color:"var(--color-graphite)",fontWeight:500}}>{a.model||"—"} · {a.operator||"—"}</div>
                    </div>
                    <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:6}}>
                      <span style={{background:sl.bg,color:sl.color,border:`1px solid ${sl.border}`,borderRadius:20,padding:"3px 10px",fontSize:11,fontWeight:700}}>{sl.text}</span>
                      {ageFromDOM(a.dom)!==null&&<span style={{fontSize:11,color:"var(--color-graphite)",fontWeight:600}}>{ageFromDOM(a.dom)} yrs old</span>}
                    </div>
                  </div>

                  {/* Airframe */}
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
                    {[["Airframe TSN",fmtHHMM(af.currentFH)],["Airframe CSN",(af.currentFC||0).toLocaleString()]].map(([l,v])=>(
                      <div key={l} style={{background:"var(--color-technical-grey)",borderRadius:8,padding:"10px 12px",border:"1px solid var(--color-divider)"}}>
                        <div style={{fontSize:9,color:"var(--color-graphite)",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:3}}>{l}</div>
                        <div style={{fontSize:18,fontWeight:800,color:"var(--color-carbon)",fontFamily:"monospace"}}>{v}</div>
                      </div>
                    ))}
                  </div>

                  {/* LLP Section */}
                  <div style={{marginBottom:14}}>
                    <div style={{fontSize:9,color:"var(--color-graphite)",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:7}}>Life Limited Parts — FC Remaining</div>
                    <div style={{display:"flex",flexDirection:"column",gap:4}}>
                      {[[`Eng 1${eng1?.sn?` · ${eng1.sn}`:""}`,ll1],[`Eng 2${eng2?.sn?` · ${eng2.sn}`:""}`,ll2],["APU",apuLL]].map(([label,val])=>(
                        <div key={label} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:llpBg(val),borderRadius:6,padding:"7px 11px",border:`1px solid ${llpBorder(val)}`}}>
                          <span style={{fontSize:11,color:"var(--color-graphite)",fontWeight:600}}>{label}</span>
                          <span style={{fontSize:13,fontWeight:800,color:llpCol(val),fontFamily:"monospace"}}>{val!==null?val.toLocaleString()+" FC":"—"}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Dates */}
                  <div style={{marginBottom:18}}>
                    <div style={{fontSize:9,color:"var(--color-graphite)",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:7}}>Key Events</div>
                    <div style={{display:"flex",flexDirection:"column",gap:4}}>
                      {[["Next Gear Overhaul",gearDate,gearDays],["Next Major Check",checkDate,checkDays]].map(([label,date,days])=>(
                        <div key={label} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:dateBg(days),borderRadius:6,padding:"7px 11px",border:`1px solid ${dateBorder(days)}`}}>
                          <span style={{fontSize:11,color:"var(--color-graphite)",fontWeight:600}}>{label}</span>
                          <div style={{textAlign:"right"}}>
                            <div style={{fontSize:12,fontWeight:700,color:dateCol(days)}}>{date?fmtDate(date):"Not entered"}</div>
                            {days!==null&&<div style={{fontSize:10,color:dateCol(days),opacity:0.8}}>{days<0?`${Math.abs(days)}d overdue`:days===0?"Today":`${days}d`}</div>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Footer */}
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",paddingTop:14,borderTop:"1px solid var(--color-divider)"}}>
                    <span style={{fontSize:11,color:"var(--color-graphite)",fontWeight:500}}>{a._lastPeriod||"No report"}</span>
                    <div style={{display:"flex",gap:8}}>
                      <button style={{background:"transparent",color:"var(--color-graphite)",border:"1px solid var(--color-divider)",borderRadius:7,padding:"8px 14px",fontSize:12,fontWeight:700,cursor:"pointer",letterSpacing:"0.03em",transition:"all 0.15s"}}
                        onClick={e=>{e.stopPropagation();setShareOpenId(a.id);}}>
                        🔗 Share
                      </button>
                      <button style={{background:"var(--color-ochre)",color:"var(--color-carbon)",border:"none",borderRadius:7,padding:"8px 16px",fontSize:12,fontWeight:700,cursor:"pointer",letterSpacing:"0.03em",transition:"all 0.15s"}}
                        onMouseEnter={e=>e.currentTarget.style.background="var(--color-ochre-hover)"}
                        onMouseLeave={e=>e.currentTarget.style.background="var(--color-ochre)"}
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
            <div style={{gridColumn:"1/-1",textAlign:"center",padding:80,color:"var(--color-graphite)"}}>
              <div style={{fontSize:48,marginBottom:16}}>✈</div>
              <p style={{fontSize:16,fontWeight:600,color:"var(--color-carbon)"}}>No assets in portfolio</p>
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

  // Chart.js draws to a <canvas>, which can't resolve CSS custom
  // properties — passing "var(--color-x)" as a fillStyle silently fails
  // and Chart.js falls back to its own default (black). Use resolved
  // hex values here, kept in sync with styles.css :root by hand.
  const datasets = [
    { label: "Covered", data: covered, backgroundColor: "#25745A", stack: "s" },
    { label: "Shortfall (within lease)", data: inLeaseShortfall, backgroundColor: "#B54848", stack: "s" },
    { label: "Shortfall (post-lease)", data: postLeaseShortfall, backgroundColor: "#B5484866", stack: "s" }
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
          legend: { labels: { color: "#687078", font: { size: 11 }, boxWidth: 12 } },
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
          x: { stacked: true, ticks: { color: "#687078", font: { size: 10 }, maxTicksLimit: 12 }, grid: { color: "#D9DCD8" } },
          y: { stacked: true, ticks: { color: "#687078", font: { size: 10 }, callback: v => "$" + (v / 1000).toFixed(0) + "k" }, grid: { color: "#D9DCD8" } }
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
  const { mode: layoutMode } = useLayoutMode();

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
    return <div style={{ padding: 40, textAlign: "center", color: "var(--color-graphite)" }}>Loading fleet exposure…</div>;
  }

  if (loadError || !data) {
    return (
      <div className="card" style={{ padding: 24, textAlign: "center", color: "var(--color-critical)" }}>
        Couldn't build fleet exposure{loadError ? `: ${loadError}` : "."}
      </div>
    );
  }

  const { headline, timeAxis, assetAxis, excludedAssets } = data;
  const statusColor = { green: "var(--color-positive)", amber: "var(--color-attention)", red: "var(--color-critical)" };

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
  // Landscape header grid (Alan, live review: both the headline card and
  // the Assets ranking card read as narrow/mostly-empty on a wide screen —
  // pair them side by side. Time Axis is a bar chart that already uses
  // full width well, so it stays a full-width row, just moved below the
  // paired row rather than between them). Same named-grid-template-areas
  // technique as FlyForward.jsx's header pairing — DOM order stays
  // headline/timeaxis/assets exactly as before, only visual placement
  // changes, so portrait (no grid style applied) is untouched.
  const pairInGrid = layoutMode === "landscape";
  const gridStyle = pairInGrid
    ? { animation: "fadeIn 0.2s ease", display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateAreas: '"headline assets" "timeaxis timeaxis"', columnGap: 16, rowGap: 16 }
    : { animation: "fadeIn 0.2s ease" };
  const mb = pairInGrid ? 0 : 16;

  return (
    <div style={gridStyle}>
      {/* HEADLINE — never zero-fill, never refuse to total; the
          completeness gap travels WITH the number, inline. REDESIGN: this
          figure now includes post-lease shortfalls — asset exposure, not
          lease exposure (fleet-exposure-redesign-handoff.md §1). */}
      <div className="card" style={{ padding: 20, marginBottom: mb, gridArea: pairInGrid ? "headline" : undefined }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-carbon)", marginBottom: 6 }}>Fleet Exposure</div>
        <div style={{ fontSize: 30, fontWeight: 700, color: headline.totalHighCaseGap > 0 ? "var(--color-critical)" : "var(--color-positive)" }}>
          ${Math.round(headline.totalHighCaseGap).toLocaleString()}
        </div>
        <div style={{ fontSize: 12, color: "var(--color-graphite)", marginTop: 6 }}>
          High-case gap across {headline.assetsComputed} of {headline.totalAssets} asset{headline.totalAssets === 1 ? "" : "s"} — includes shortfalls landing after redelivery
          {headline.excludedCount > 0 && (
            <>
              {" — "}
              <button onClick={() => setShowExcluded(s => !s)} style={{ background: "none", border: "none", color: "var(--color-attention)", cursor: "pointer", textDecoration: "underline", font: "inherit", padding: 0 }}>
                {headline.excludedCount} excluded
              </button>
            </>
          )}
        </div>
        <div className="flab g8" style={{ marginTop: 12 }}>
          <span className="pill" style={{ background: "var(--color-positive-tint)", color: "var(--color-positive)" }}>{headline.statusCounts.green} green</span>
          <span className="pill" style={{ background: "var(--color-attention-tint)", color: "var(--color-attention)" }}>{headline.statusCounts.amber} amber</span>
          <span className="pill" style={{ background: "var(--color-critical-tint)", color: "var(--color-critical)" }}>{headline.statusCounts.red} red</span>
        </div>
        {showExcluded && (
          <div style={{ marginTop: 14, borderTop: "1px solid var(--color-divider)", paddingTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
            {excludedAssets.map((e, i) => (
              <div key={i} className="flj" style={{ fontSize: 12, color: "var(--color-graphite)", cursor: onSelectAsset ? "pointer" : "default" }} onClick={() => onSelectAsset && onSelectAsset(e.assetId)}>
                <span>MSN {e.msn}</span>
                <span style={{ color: e.reason === "COMPUTE_ERROR" ? "var(--color-critical)" : "var(--color-attention)" }}>{e.reason.replace(/_/g, " ")} — {e.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* TIME AXIS — bar chart replacing the flat text list (redesign §3).
          One bar per month with events; empty months compressed out.
          Click a bar to drill into that month's events below. */}
      <div className="card" style={{ padding: 16, marginBottom: mb, gridArea: pairInGrid ? "timeaxis" : undefined }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-carbon)", marginBottom: 10 }}>
          Time Axis — to lease end, plus each pot's next event beyond it (however far out)
        </div>
        {timeAxis.length === 0 ? (
          <div style={{ color: "var(--color-graphite)", fontSize: 12 }}>No projected events across the fleet.</div>
        ) : (
          <>
            <TimeAxisBarChart timeAxis={timeAxis} selectedMonthKey={selectedMonthKey} onBarClick={mk => setSelectedMonthKey(mk === selectedMonthKey ? null : mk)}/>
            {selectedBucket ? (
              <div style={{ marginTop: 16, borderTop: "1px solid var(--color-divider)", paddingTop: 12 }}>
                <div className="flj" style={{ marginBottom: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--color-carbon)" }}>{selectedBucket.monthKey}</span>
                  <button onClick={() => setSelectedMonthKey(null)} style={{ background: "none", border: "none", color: "var(--color-graphite)", cursor: "pointer", fontSize: 11 }}>Close ✕</button>
                </div>
                {selectedBucket.atoms.map((a, i) => (
                  <div key={i} className="flj" style={{ fontSize: 11, padding: "4px 0", color: a.postLeaseEnd ? (statusColor[a.status] || "var(--color-carbon)") + "aa" : statusColor[a.status] || "var(--color-carbon)" }}>
                    <span style={{ cursor: onSelectAsset ? "pointer" : "default" }} onClick={() => onSelectAsset && onSelectAsset(a.assetId)}>
                      MSN {a.msn} — {a.code}{a.postLeaseEnd ? " (post-lease)" : ""}
                    </span>
                    <span>${Math.round(a.costHigh).toLocaleString()}{a.shortfallHigh > 0 ? ` · gap $${Math.round(a.shortfallHigh).toLocaleString()}` : ""}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ marginTop: 10, fontSize: 11, color: "var(--color-graphite)" }}>Click a bar to see that month's events.</div>
            )}
          </>
        )}
      </div>

      {/* ASSET AXIS — sortable (redesign §2): by total exposure (default)
          or by nearest event date. Nearest-event-date always shown
          alongside the total regardless of sort mode. */}
      <div className="card" style={{ padding: 16, gridArea: pairInGrid ? "assets" : undefined }}>
        <div className="flj" style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-carbon)" }}>Assets</div>
          <div className="flab g8">
            <button
              onClick={() => setSortMode("exposure")}
              className="btn"
              style={{ fontSize: 11, padding: "4px 10px", background: sortMode === "exposure" ? "var(--color-teal)" : "transparent", color: sortMode === "exposure" ? "var(--color-soft-white)" : "var(--color-graphite)", border: "1px solid " + (sortMode === "exposure" ? "var(--color-teal)" : "var(--color-divider)") }}>
              By exposure
            </button>
            <button
              onClick={() => setSortMode("date")}
              className="btn"
              style={{ fontSize: 11, padding: "4px 10px", background: sortMode === "date" ? "var(--color-teal)" : "transparent", color: sortMode === "date" ? "var(--color-soft-white)" : "var(--color-graphite)", border: "1px solid " + (sortMode === "date" ? "var(--color-teal)" : "var(--color-divider)") }}>
              By nearest date
            </button>
          </div>
        </div>
        {sortedAssetAxis.length === 0 && <div style={{ color: "var(--color-graphite)", fontSize: 12 }}>No assets computed.</div>}
        {sortedAssetAxis.map(a => (
          <div key={a.assetId} className="flj" style={{ padding: "8px 0", borderTop: "1px solid var(--color-divider)", cursor: onSelectAsset ? "pointer" : "default" }} onClick={() => onSelectAsset && onSelectAsset(a.assetId)}>
            <div>
              <span style={{ fontSize: 12, color: "var(--color-carbon)" }}>MSN {a.msn}</span>
              {a.hasPostLeaseEvent && <span className="pill" style={{ marginLeft: 8, fontSize: 9, background: "var(--color-divider-inner)", color: "var(--color-graphite)" }}>includes post-lease</span>}
              {a.nearestEventDate && (
                <div style={{ fontSize: 10, color: "var(--color-graphite)", marginTop: 2 }}>
                  Nearest event: {a.nearestEventDate.toISOString().slice(0, 7)}{a.nearestEventPostLease ? " (post-lease)" : ""}
                </div>
              )}
            </div>
            <span style={{ fontSize: 12, fontWeight: 700, color: statusColor[a.worstStatus] || "var(--color-carbon)" }}>
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

  const financialColor = (v) => (v == null ? "var(--color-graphite)" : v > 0 ? "var(--color-critical)" : v < 0 ? "var(--color-positive)" : "var(--color-graphite)");
  // Display-only sign flip, matching the "Reserve Position" convention
  // locked for FlyForward/Scenarios: shows balance - cost instead of
  // cost - balance, so positive reads as surplus (green) and negative
  // reads as shortfall (red). Pass the flipped value straight into
  // financialColor above rather than the old boolean-cast trick, which
  // was silently showing every surplus pot as graphite, not green.
  const formatPosition = v => {
    if (v == null) return null;
    const position = -v;
    return (position >= 0 ? "+" : "-") + "$" + Math.round(Math.abs(position)).toLocaleString();
  };
  const disruptionColor = (v) => (v > 0 ? "var(--color-critical)" : "var(--color-positive)");

  return (
    <div style={{ animation: "fadeIn 0.2s ease" }}>
      <div className="card" style={{ padding: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-carbon)" }}>Route Suitability Matcher</div>
        <div style={{ fontSize: 12, color: "var(--color-graphite)", marginTop: 2, marginBottom: 16 }}>
          Describe the route — a wet lease, a seasonal schedule, a reassignment — and every eligible asset is compared against it. Exploratory only; nothing here is saved.
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-carbon)", marginBottom: 12 }}>The route</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 12 }}>
          <label style={{ fontSize: 11, color: "var(--color-graphite)" }}>
            FH / month
            <input type="number" min="0" step="1" value={fhPerMonth} onChange={e => setFhPerMonth(e.target.value)}
              style={{ display: "block", width: "100%", marginTop: 4, fontSize: 13, padding: "7px 9px" }}/>
          </label>
          <label style={{ fontSize: 11, color: "var(--color-graphite)" }}>
            FC / month
            <input type="number" min="0" step="1" value={fcPerMonth} onChange={e => setFcPerMonth(e.target.value)}
              style={{ display: "block", width: "100%", marginTop: 4, fontSize: 13, padding: "7px 9px" }}/>
          </label>
          <label style={{ fontSize: 11, color: "var(--color-graphite)" }}>
            Start date
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
              style={{ display: "block", width: "100%", marginTop: 4, fontSize: 13, padding: "7px 9px" }}/>
          </label>
          <label style={{ fontSize: 11, color: "var(--color-graphite)" }}>
            End date
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
              style={{ display: "block", width: "100%", marginTop: 4, fontSize: 13, padding: "7px 9px" }}/>
          </label>
        </div>
        {fhPerMonth > 0 && fcPerMonth > 0 && (
          <div style={{ fontSize: 11, color: "var(--color-graphite)", marginBottom: 12 }}>
            ≈ {(Number(fhPerMonth) / Number(fcPerMonth)).toFixed(1)} FH:FC average sector
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button className="btn btn-teal" style={{ fontSize: 12, padding: "8px 18px" }}
            disabled={loading || !fhPerMonth || !fcPerMonth || !startDate || !endDate}
            onClick={runMatch}>
            {loading ? "Matching…" : "Find best match"}
          </button>
        </div>
        {loadError && <div style={{ marginTop: 10, fontSize: 12, color: "var(--color-critical)" }}>Couldn't run the match: {loadError}</div>}
      </div>

      {data && (
        <>
          {data.excludedAssets.length > 0 && (
            <div className="card" style={{ padding: 16, marginBottom: 16 }}>
              <div className="flj">
                <span style={{ fontSize: 12, color: "var(--color-graphite)" }}>{data.excludedAssets.length} asset{data.excludedAssets.length === 1 ? "" : "s"} not compared</span>
                <button onClick={() => setShowExcluded(s => !s)} style={{ background: "none", border: "none", color: "var(--color-attention)", cursor: "pointer", textDecoration: "underline", font: "inherit", padding: 0, fontSize: 12 }}>
                  {showExcluded ? "Hide" : "Show"}
                </button>
              </div>
              {showExcluded && (
                <div style={{ marginTop: 10, borderTop: "1px solid var(--color-divider)", paddingTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                  {data.excludedAssets.map((e, i) => (
                    <div key={i} className="flj" style={{ fontSize: 12, color: "var(--color-graphite)", cursor: onSelectAsset ? "pointer" : "default" }} onClick={() => onSelectAsset && onSelectAsset(e.assetId)}>
                      <span>MSN {e.msn}</span>
                      <span style={{ color: e.reason === "COMPUTE_ERROR" ? "var(--color-critical)" : "var(--color-attention)" }}>{e.reason.replace(/_/g, " ")} — {e.message}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="card" style={{ padding: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-carbon)", marginBottom: 4 }}>Ranked — best operational fit first</div>
            <div style={{ fontSize: 11, color: "var(--color-graphite)", marginBottom: 12 }}>
              Financial impact is shown alongside, not folded into the ranking — the best fit and the cheapest option aren't always the same asset.
            </div>
            {data.ranked.length === 0 && <div style={{ fontSize: 12, color: "var(--color-graphite)" }}>No eligible assets to compare.</div>}
            {data.ranked.map((r, i) => {
              const expanded = expandedId === r.assetId;
              return (
                <div key={r.assetId} style={{ borderTop: i > 0 ? "1px solid var(--color-divider)" : "none", padding: "10px 0" }}>
                  <div className="flj" style={{ cursor: "pointer" }} onClick={() => setExpandedId(expanded ? null : r.assetId)}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: 11, color: "var(--color-graphite)", width: 18 }}>#{i + 1}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "var(--color-carbon)" }}>MSN {r.msn}</span>
                    </div>
                    <div style={{ display: "flex", gap: 18, alignItems: "center" }}>
                      {r.clashes.length > 0 && (
                        <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 6, background: "var(--color-critical-tint)", color: "var(--color-critical)", fontWeight: 700 }}>
                          ⚠ {r.clashes.length} clash{r.clashes.length === 1 ? "" : "es"}
                        </span>
                      )}
                      <span style={{ fontSize: 11, color: "var(--color-graphite)" }}>
                        Disruption <span style={{ color: disruptionColor(r.disruptionMonths), fontWeight: 700 }}>{r.disruptionMonths} mo</span>
                      </span>
                      <span style={{ fontSize: 11, color: "var(--color-graphite)" }}>
                        Cost delta <span style={{ color: financialColor(r.financialDeltaHigh), fontWeight: 700 }}>
                          {r.financialDeltaHigh > 0 ? "+" : ""}${Math.round(r.financialDeltaHigh).toLocaleString()}
                        </span>
                      </span>
                      <span style={{ fontSize: 11, color: "var(--color-graphite)" }}>{expanded ? "▲" : "▼"}</span>
                    </div>
                  </div>
                  {expanded && (
                    <>
                      <table style={{ fontSize: 12, width: "100%", marginTop: 10 }}>
                        <thead><tr>
                          <th style={{ color: "var(--color-graphite)", textAlign: "left" }}>Pot</th>
                          <th style={{ color: "var(--color-graphite)", textAlign: "right" }}>Current profile</th>
                          <th style={{ color: "var(--color-graphite)", textAlign: "right" }}>On this route</th>
                          <th style={{ color: "var(--color-graphite)", textAlign: "right" }}>Shift</th>
                        </tr></thead>
                        <tbody>
                          {r.potDeltas.map(p => (
                            <tr key={p.code}>
                              <td style={{ padding: "5px 0", color: "var(--color-carbon)" }}>{p.code} — {p.label}</td>
                              <td style={{ textAlign: "right", color: "var(--color-graphite)" }}>
                                {p.baseDate ? fmtMonthYear(p.baseDate) : "Beyond horizon"}
                                {p.baseShortfallHigh != null && <div style={{ fontSize: 10, color: financialColor(-p.baseShortfallHigh) }}>{formatPosition(p.baseShortfallHigh)}</div>}
                              </td>
                              <td style={{ textAlign: "right", color: "var(--color-graphite)" }}>
                                {p.routeDate ? fmtMonthYear(p.routeDate) : "Beyond horizon"}
                                {p.routeShortfallHigh != null && <div style={{ fontSize: 10, color: financialColor(-p.routeShortfallHigh) }}>{formatPosition(p.routeShortfallHigh)}</div>}
                              </td>
                              <td style={{ textAlign: "right", fontSize: 11, color: p.shiftMonths == null ? "var(--color-graphite)" : (p.shiftMonths < 0 ? "var(--color-critical)" : p.shiftMonths > 0 ? "var(--color-positive)" : "var(--color-graphite)") }}>
                                {formatShiftLabel(p)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {r.clashes.length > 0 && (
                        <div style={{ marginTop: 10, padding: 10, background: "var(--color-critical-tint)", borderRadius: 6 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-critical)", marginBottom: 6 }}>Scheduling clashes on this route</div>
                          {r.clashes.map((c, i) => (
                            <div key={i} style={{ fontSize: 11, color: "var(--color-critical)", padding: "3px 0" }}>
                              {c.code} ({fmtMonthYear(c.groundingStart)}–{fmtMonthYear(c.groundingEnd)}) overlaps MSN {c.withMsn}'s {c.withCode} ({fmtMonthYear(c.withGroundingStart)}–{fmtMonthYear(c.withGroundingEnd)})
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                  {onSelectAsset && (
                    <div style={{ marginTop: 6 }}>
                      <button onClick={() => onSelectAsset(r.assetId)} style={{ background: "none", border: "none", color: "var(--color-teal)", cursor: "pointer", fontSize: 11, padding: 0 }}>Open MSN {r.msn} →</button>
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
// Fleet Completed Events — read-only view of every cost-tracker entry
// across all assets, surfaced from the fleet Calendar tab via a toggle
// button. Reads db.getCompletedEvents() (same collection the per-asset
// SV Cost Tracker writes to). Sorted newest first. No write paths here —
// logging stays on the per-asset Calendar tab.
// ---------------------------------------------------------------------

// assets prop used to resolve MSN from assetId — MSN is not stored on
// the completedEvent record itself, only assetId is (db.js schema).
function FleetCompletedEventsView({ assets, onSelectAsset }) {
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState([]);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    db.getAllCompletedEvents()
      .then(data => {
        if (!cancelled) { setEvents(data || []); setLoadError(null); }
      })
      .catch(e => { if (!cancelled) setLoadError(e.message || String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Build assetId → msn lookup from the fleet assets array
  const msnById = {};
  (assets || []).forEach(a => { if (a.id) msnById[a.id] = a.msn; });

  const fmtCost = (v) => v != null ? '$' + Math.round(v).toLocaleString() : '—';
  const fmtDate = (v) => {
    if (!v) return '—';
    try {
      const d = new Date(v);
      return isNaN(d) ? String(v) : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch { return String(v); }
  };
  // Use projectedCostHigh as the comparison figure — that's what the Cost
  // Tracker stores (projectedCostLow/Likely/High), and High is what Fleet
  // Exposure uses throughout, so this is the most meaningful comparison.
  const deltaColor = (actual, projected) => {
    if (actual == null || projected == null) return 'var(--color-graphite)';
    return actual > projected ? 'var(--color-critical)' : actual < projected ? 'var(--color-positive)' : 'var(--color-graphite)';
  };
  const deltaLabel = (actual, projected) => {
    if (actual == null || projected == null) return null;
    const diff = actual - projected;
    if (diff === 0) return 'On projection';
    return (diff > 0 ? '▲ $' : '▼ $') + Math.round(Math.abs(diff)).toLocaleString() + ' vs projected';
  };

  if (loading) {
    return <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--color-graphite)', fontSize: 13 }}>Loading completed events…</div>;
  }
  if (loadError) {
    return <div style={{ padding: 16, color: 'var(--color-critical)', fontSize: 13 }}>Couldn't load completed events: {loadError}</div>;
  }
  if (!events.length) {
    return (
      <div style={{ padding: '28px 0', textAlign: 'center', color: 'var(--color-graphite)', fontSize: 13 }}>
        No completed events logged yet — use the Cost Tracker on each asset's Calendar tab to log an event.
      </div>
    );
  }

  return (
    <div style={{ marginTop: 4 }}>
      {/* Column headers */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px 120px 110px 120px 150px', gap: 8, padding: '0 12px 8px', borderBottom: '1px solid var(--color-divider)' }}>
        {['Asset', 'Event', 'Date logged', 'Actual cost', 'Projected (high)', 'Delta'].map(h => (
          <div key={h} style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--color-graphite)' }}>{h}</div>
        ))}
      </div>
      {events.map((ev, i) => {
        const msn = msnById[ev.assetId] || null;
        const actual = ev.totalCost ?? null;
        const projected = ev.projectedCostHigh ?? null;
        const dc = deltaColor(actual, projected);
        const noCostData = !!ev.noCostData;
        return (
          <div
            key={ev.id || i}
            style={{ display: 'grid', gridTemplateColumns: '1fr 100px 120px 110px 120px 150px', gap: 8, padding: '10px 12px', borderBottom: '1px solid var(--color-divider)', alignItems: 'center', transition: 'background 0.1s' }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--color-technical-grey)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            {/* Asset — clickable, opens asset at Financials tab */}
            <div>
              <span
                style={{ fontSize: 13, fontWeight: 700, color: onSelectAsset ? 'var(--color-teal)' : 'var(--color-carbon)', cursor: onSelectAsset ? 'pointer' : 'default' }}
                onClick={() => onSelectAsset && ev.assetId && onSelectAsset(ev.assetId)}
              >
                {msn ? `MSN ${msn}` : ev.assetId || '—'}
              </span>
              {ev.mroRegion && <div style={{ fontSize: 11, color: 'var(--color-graphite)', marginTop: 2 }}>{ev.mroRegion}</div>}
            </div>
            {/* Event code + label */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-carbon)', fontFamily: 'monospace' }}>{ev.code || '—'}</div>
              {ev.label && <div style={{ fontSize: 10, color: 'var(--color-graphite)', marginTop: 1 }}>{ev.label}</div>}
            </div>
            {/* Date logged (confirmedAt) */}
            <div style={{ fontSize: 12, color: 'var(--color-graphite)' }}>{fmtDate(ev.confirmedAt)}</div>
            {/* Actual cost — muted if no cost data was entered (Dismiss path) */}
            <div style={{ fontSize: 13, fontWeight: 700, color: noCostData ? 'var(--color-graphite)' : 'var(--color-carbon)', fontFamily: 'monospace', fontStyle: noCostData ? 'italic' : 'normal' }}>
              {noCostData ? '—' : fmtCost(actual)}
            </div>
            {/* Projected cost high */}
            <div style={{ fontSize: 12, color: 'var(--color-graphite)', fontFamily: 'monospace' }}>{fmtCost(projected)}</div>
            {/* Delta */}
            <div>
              {noCostData
                ? <span style={{ fontSize: 11, color: 'var(--color-graphite)', fontStyle: 'italic' }}>Dismissed</span>
                : deltaLabel(actual, projected)
                  ? <span style={{ fontSize: 12, color: dc, fontWeight: 600 }}>{deltaLabel(actual, projected)}</span>
                  : <span style={{ fontSize: 12, color: 'var(--color-graphite)' }}>No projection</span>}
            </div>
          </div>
        );
      })}
      <div style={{ padding: '10px 12px', borderTop: '1px solid var(--color-divider)', fontSize: 11, color: 'var(--color-graphite)' }}>
        {events.length} event{events.length === 1 ? '' : 's'} logged
      </div>
    </div>
  );
}

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
  const [showCompleted, setShowCompleted] = useState(false);
  // P2 Item 2 — default horizon toggle. Presentation-only: filters which
  // events render, never mutates underlying data. Resets to the 5y
  // default on every page load (not persisted per user, per spec).
  const [horizonYears, setHorizonYears] = useState(5);

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
    return <div style={{ padding: 40, textAlign: "center", color: "var(--color-graphite)" }}>Loading fleet calendar…</div>;
  }
  if (loadError || !data) {
    return (
      <div className="card" style={{ padding: 24, textAlign: "center", color: "var(--color-critical)" }}>
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
  // Plain computed value, not a hook — this function already has early
  // returns above (loading/error states) before this point in the
  // component, so a useMemo/useState call here would violate the Rules
  // of Hooks (conditional hook call -> React error #310, blank page).
  let horizonCutoff = null;
  if (horizonYears !== "all") {
    horizonCutoff = new Date();
    horizonCutoff.setFullYear(horizonCutoff.getFullYear() + horizonYears);
  }
  const visibleEvents = horizonCutoff ? events.filter(e => e.date <= horizonCutoff) : events;

  return (
    <div style={{ animation: "fadeIn 0.2s ease" }}>
      <div style={{ background: "var(--color-technical-grey)", border: "1px solid var(--color-carbon)", borderRadius: 10, padding: "12px 16px", marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-carbon)" }}>Calendar</div>
          <button
            onClick={() => setShowCompleted(s => !s)}
            style={{ flexShrink: 0, background: showCompleted ? "var(--color-carbon)" : "transparent", border: "1px solid var(--color-divider)", borderRadius: 7, padding: "5px 12px", fontSize: 12, fontWeight: 700, color: showCompleted ? "var(--color-soft-white)" : "var(--color-graphite)", cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s", whiteSpace: "nowrap" }}
          >
            {showCompleted ? "Hide completed events" : "View completed events"}
          </button>
        </div>
        <div style={{ fontSize: 12, color: "var(--color-graphite)", marginTop: 2 }}>
          Event clustering across the fleet's maintenance calendar — scheduling only, no cost figures. See Financials for the money view. Every asset appears here regardless of lease status — a scheduled check happens whether or not there's a lease on file.
        </div>
        {noReserveSetup.length > 0 && (
          <div style={{ marginTop: 8, fontSize: 12, color: "var(--color-graphite)" }}>
            ℹ {noReserveSetup.length} asset{noReserveSetup.length === 1 ? "" : "s"} with no lease/reserve setup on file — landing gear and engine LLP dates shown are real (from tracked component data). Engine PR and APU dates aren't shown for these assets — no real data to derive them from, so they're omitted rather than guessed at ({noReserveSetup.map(a => `MSN ${a.msn}`).join(", ")})
          </div>
        )}
        {partial.length > 0 && (
          <div style={{ marginTop: 8, fontSize: 12, color: "var(--color-attention)" }}>
            ⚠ {partial.length} asset{partial.length === 1 ? "" : "s"} showing C-Check dates only — no utilisation history to project any engine/APU/landing-gear events ({partial.map(a => `MSN ${a.msn}`).join(", ")})
          </div>
        )}
        {excluded.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <button onClick={() => setShowExcluded(s => !s)} style={{ background: "none", border: "none", color: "var(--color-attention)", cursor: "pointer", textDecoration: "underline", font: "inherit", padding: 0, fontSize: 12 }}>
              {excluded.length} asset{excluded.length === 1 ? "" : "s"} not shown
            </button>
            {showExcluded && (
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                {excluded.map((e, i) => (
                  <div key={i} className="flj" style={{ fontSize: 12, color: "var(--color-graphite)", cursor: onSelectAsset ? "pointer" : "default" }} onClick={() => onSelectAsset && onSelectAsset(e.assetId)}>
                    <span>MSN {e.msn}</span>
                    <span style={{ color: "var(--color-critical)" }}>{e.excluded.code.replace(/_/g, " ")} — {e.excluded.message}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
        <div style={{ display: "flex", gap: 4, background: "var(--color-technical-grey)", border: "1px solid var(--color-divider)", padding: 3, borderRadius: 6 }}>
          {[[5, "5y"], [10, "10y"], [15, "15y"], ["all", "All"]].map(([v, l]) => (
            <button key={l} onClick={() => setHorizonYears(v)}
              style={{ padding: "5px 12px", fontSize: 11, fontWeight: 700, borderRadius: 4, border: "none", cursor: "pointer", fontFamily: "inherit", background: horizonYears === v ? "var(--color-carbon)" : "transparent", color: horizonYears === v ? "var(--color-soft-white)" : "var(--color-graphite)", transition: "all 0.15s" }}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {events.length === 0
        ? <div className="card" style={{ padding: 24, textAlign: "center", color: "var(--color-graphite)" }}>No scheduled events across the fleet.</div>
        : visibleEvents.length === 0
        ? <div className="card" style={{ padding: 24, textAlign: "center", color: "var(--color-graphite)" }}>No scheduled events within the selected horizon.</div>
        : <MaintenanceCalendarGrid events={visibleEvents}/>}

      {/* Completed events panel — toggled via header button */}
      {showCompleted && (
        <div className="card" style={{ padding: 16, marginTop: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-carbon)", marginBottom: 12 }}>Completed Events — fleet log</div>
          <FleetCompletedEventsView assets={assets} onSelectAsset={onSelectAsset}/>
        </div>
      )}
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

  const deltaColor = (b, s) => (s > b ? "var(--color-critical)" : s < b ? "var(--color-positive)" : "var(--color-graphite)");

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-carbon)", marginBottom: 4 }}>Fleet Grounding</div>
      <div style={{ fontSize: 12, color: "var(--color-graphite)", marginBottom: 12 }}>
        Grounds the entire fleet from today for the selected period, combined with each asset's own real maintenance grounding — whichever grounds harder wins, downtime never stacks. Exploratory only; nothing here is saved.
      </div>
      <ScenarioSlider label="Grounding duration" value={months} onChange={setMonths} min={1} max={12} step={1} format={v => `${v} mo`}/>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: active ? 16 : 0 }}>
        {active && <button className="btn btn-ghost" style={{ fontSize: 12, padding: "6px 14px" }} onClick={reset}>Reset</button>}
        <button className="btn btn-teal" style={{ fontSize: 12, padding: "8px 18px" }} disabled={loading} onClick={run}>
          {loading ? "Running…" : "Run pandemic scenario"}
        </button>
      </div>
      {error && <div style={{ fontSize: 12, color: "var(--color-critical)" }}>Couldn't run the scenario: {error}</div>}
      {active && base && scenario && (
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <div className="card" style={{ padding: 16, flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 11, color: "var(--color-graphite)", marginBottom: 6 }}>Base Case — High-case gap</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "var(--color-carbon)" }}>${Math.round(base.headline.totalHighCaseGap).toLocaleString()}</div>
          </div>
          <div className="card" style={{ padding: 16, flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 11, color: "var(--color-graphite)", marginBottom: 6 }}>{months}-Month Grounding — High-case gap</div>
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
  const deltaColor = (b, s) => (s > b ? "var(--color-critical)" : s < b ? "var(--color-positive)" : "var(--color-graphite)");
  return (
    <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
      <div className="card" style={{ padding: 16, flex: 1, minWidth: 220 }}>
        <div style={{ fontSize: 11, color: "var(--color-graphite)", marginBottom: 6 }}>Base Case — High-case gap</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: "var(--color-carbon)" }}>${Math.round(base.headline.totalHighCaseGap).toLocaleString()}</div>
      </div>
      <div className="card" style={{ padding: 16, flex: 1, minWidth: 220 }}>
        <div style={{ fontSize: 11, color: "var(--color-graphite)", marginBottom: 6 }}>{scenarioLabel} — High-case gap</div>
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
    return <div className="card" style={{ padding: 16, marginTop: 16, color: "var(--color-graphite)", fontSize: 12 }}>Loading lessees…</div>;
  }

  if (!lessees.length) {
    return (
      <div className="card" style={{ padding: 16, marginTop: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-carbon)", marginBottom: 4 }}>Lessee Default</div>
        <div style={{ fontSize: 12, color: "var(--color-graphite)" }}>No leases on file across the fleet yet — nothing to model a default against.</div>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 16, marginTop: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-carbon)", marginBottom: 4 }}>Lessee Default</div>
      <div style={{ fontSize: 12, color: "var(--color-graphite)", marginBottom: 12 }}>
        Suspends reserve accrual on every asset leased to the selected lessee, from today for the selected period — usage continues, only the payments stop. Exploratory only; nothing here is saved.
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <label style={{ fontSize: 11, color: "var(--color-graphite)", flex: 1, minWidth: 180 }}>
          Lessee
          <select value={lesseeId} onChange={e => setLesseeId(e.target.value)} style={{ display: "block", width: "100%", marginTop: 4, fontSize: 13, padding: "7px 9px" }}>
            {lessees.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 11, color: "var(--color-graphite)", flex: 1, minWidth: 140 }}>
          Duration (months)
          <input type="number" min="1" step="1" value={months} onChange={e => setMonths(Math.max(1, Number(e.target.value) || 1))}
            style={{ display: "block", width: "100%", marginTop: 4, fontSize: 13, padding: "7px 9px" }}/>
        </label>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: active ? 16 : 0 }}>
        {active && <button className="btn btn-ghost" style={{ fontSize: 12, padding: "6px 14px" }} onClick={reset}>Reset</button>}
        <button className="btn btn-teal" style={{ fontSize: 12, padding: "8px 18px" }} disabled={loading} onClick={run}>
          {loading ? "Running…" : "Run lessee default scenario"}
        </button>
      </div>
      {error && <div style={{ fontSize: 12, color: "var(--color-critical)" }}>Couldn't run the scenario: {error}</div>}
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
      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-carbon)", marginBottom: 4 }}>Fleet-Wide Utilisation Change</div>
      <div style={{ fontSize: 12, color: "var(--color-graphite)", marginBottom: 12 }}>
        Applies the same utilisation % change to every asset in the fleet simultaneously. Exploratory only; nothing here is saved.
      </div>
      <ScenarioSlider label="Utilisation change" value={pct} onChange={setPct} min={-50} max={50} step={1} format={v => (v > 0 ? "+" : "") + v + "%"}/>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: active ? 16 : 0 }}>
        {active && <button className="btn btn-ghost" style={{ fontSize: 12, padding: "6px 14px" }} onClick={reset}>Reset</button>}
        <button className="btn btn-teal" style={{ fontSize: 12, padding: "8px 18px" }} disabled={loading} onClick={run}>
          {loading ? "Running…" : "Run utilisation scenario"}
        </button>
      </div>
      {error && <div style={{ fontSize: 12, color: "var(--color-critical)" }}>Couldn't run the scenario: {error}</div>}
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
      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-carbon)", marginBottom: 4 }}>Engine-Type Cost Shock</div>
      <div style={{ fontSize: 12, color: "var(--color-graphite)", marginBottom: 12 }}>
        Applies a cost multiplier to every projected shop visit for the selected engine family across the fleet. Exploratory only; nothing here is saved.
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <label style={{ fontSize: 11, color: "var(--color-graphite)", flex: 1, minWidth: 140 }}>
          Engine family
          <select value={engineFamily} onChange={e => setEngineFamily(e.target.value)} style={{ display: "block", width: "100%", marginTop: 4, fontSize: 13, padding: "7px 9px" }}>
            <option value="CFM">CFM56</option>
            <option value="V2500">V2500</option>
          </select>
        </label>
        <label style={{ fontSize: 11, color: "var(--color-graphite)", flex: 1, minWidth: 140 }}>
          Cost change (%)
          <input type="number" step="1" value={pct} onChange={e => setPct(Number(e.target.value) || 0)}
            style={{ display: "block", width: "100%", marginTop: 4, fontSize: 13, padding: "7px 9px" }}/>
        </label>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: active ? 16 : 0 }}>
        {active && <button className="btn btn-ghost" style={{ fontSize: 12, padding: "6px 14px" }} onClick={reset}>Reset</button>}
        <button className="btn btn-teal" style={{ fontSize: 12, padding: "8px 18px" }} disabled={loading} onClick={run}>
          {loading ? "Running…" : "Run cost shock scenario"}
        </button>
      </div>
      {error && <div style={{ fontSize: 12, color: "var(--color-critical)" }}>Couldn't run the scenario: {error}</div>}
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
      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-carbon)", marginBottom: 4 }}>Extended Maintenance Duration</div>
      <div style={{ fontSize: 12, color: "var(--color-graphite)", marginBottom: 12 }}>
        Adds extra downtime to every projected check of the selected type across the fleet, pushing availability and downstream events. Models MRO backlog or parts delays. Exploratory only; nothing here is saved.
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <label style={{ fontSize: 11, color: "var(--color-graphite)", flex: 1, minWidth: 140 }}>
          Check type
          <select value={checkType} onChange={e => setCheckType(e.target.value)} style={{ display: "block", width: "100%", marginTop: 4, fontSize: 13, padding: "7px 9px" }}>
            <option value="2Y">2-Year Check</option>
            <option value="6Y">6-Year Check</option>
            <option value="12Y">12-Year Check</option>
          </select>
        </label>
        <label style={{ fontSize: 11, color: "var(--color-graphite)", flex: 1, minWidth: 140 }}>
          Extra duration (months)
          <input type="number" min="0" step="1" value={extraMonths} onChange={e => setExtraMonths(Math.max(0, Number(e.target.value) || 0))}
            style={{ display: "block", width: "100%", marginTop: 4, fontSize: 13, padding: "7px 9px" }}/>
        </label>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: active ? 16 : 0 }}>
        {active && <button className="btn btn-ghost" style={{ fontSize: 12, padding: "6px 14px" }} onClick={reset}>Reset</button>}
        <button className="btn btn-teal" style={{ fontSize: 12, padding: "8px 18px" }} disabled={loading} onClick={run}>
          {loading ? "Running…" : "Run duration scenario"}
        </button>
      </div>
      {error && <div style={{ fontSize: 12, color: "var(--color-critical)" }}>Couldn't run the scenario: {error}</div>}
      {active && base && scenario && <FleetScenarioComparison base={base} scenario={scenario} scenarioLabel={`${checkType} +${extraMonths} mo`}/>}
    </div>
  );
}

// Wrapper — groups all four new controls under one heading, sits
// alongside PandemicScenarioView on the fleet Scenarios page.
// `group` selects which pair of structured controls to render, so the
// caller (App.jsx) can place each pair under its own section-title
// header — "Counterparty & Utilisation" (Lessee Default, Fleet-Wide
// Utilisation) vs. "Maintenance & Cost" (Engine Cost Shock, Extended
// Maintenance). Per P2 Item 4's grouping reframe. Omit `group` to render
// all four as before (no header wrapping).
function FleetScenarioControls({ assets, group }) {
  const { mode: layoutMode } = useLayoutMode();
  const paired = layoutMode === "landscape";
  const pairStyle = paired ? { display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 16, alignItems: "stretch" } : undefined;
  const showCounterparty = !group || group === "counterparty";
  const showMaintenance = !group || group === "maintenance";
  return (
    <div style={{ marginTop: group ? 0 : 16 }}>
      {!group && (
        <>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-carbon)", marginBottom: 4 }}>Fleet Scenario Controls</div>
          <div style={{ fontSize: 12, color: "var(--color-graphite)" }}>Four independent structured controls — each runs its own base-vs-scenario comparison. Not combined with each other or with the pandemic slider above.</div>
        </>
      )}
      {showCounterparty && (
        <div style={pairStyle}>
          <LesseeDefaultScenarioView assets={assets}/>
          <FleetUtilisationScenarioView assets={assets}/>
        </div>
      )}
      {showMaintenance && (
        <div style={pairStyle}>
          <EngineCostShockScenarioView assets={assets}/>
          <ExtendedMaintenanceScenarioView assets={assets}/>
        </div>
      )}
    </div>
  );
}

export { FleetCalendarView, FleetExposureView, FleetScenarioControls, PandemicScenarioView, PortfolioView, RouteMatcherView };