import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ShareModal } from './AssetView';
import { assetStatus, daysFromNow, assetEngineStockPhotoKey, airframeStockPhotoKey } from '../lib/assetHelpers';
import { db } from '../lib/db';
import { FLEET_EXPOSURE_HORIZON_MONTHS, buildFleetCalendarData, buildFleetExposureData, buildRouteMatchData } from '../lib/flyForwardHelpers';
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

function FleetExposureView({ assets, onSelectAsset }) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [showExcluded, setShowExcluded] = useState(false);

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

  return (
    <div style={{ animation: "fadeIn 0.2s ease" }}>
      {/* HEADLINE — handoff §5: never zero-fill, never refuse to total;
          the completeness gap travels WITH the number, inline. */}
      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", marginBottom: 6 }}>Fleet Exposure</div>
        <div style={{ fontSize: 30, fontWeight: 700, color: headline.totalHighCaseGap > 0 ? "#f87171" : "#34d399" }}>
          ${Math.round(headline.totalHighCaseGap).toLocaleString()}
        </div>
        <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 6 }}>
          High-case gap across {headline.assetsComputed} of {headline.totalAssets} asset{headline.totalAssets === 1 ? "" : "s"}
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

      {/* TIME AXIS — primary panel (handoff §4: "why time leads"). Months
          across, atoms stacked per month, cost + coverage totals underneath. */}
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", marginBottom: 10 }}>
          Time Axis — to lease end, plus {FLEET_EXPOSURE_HORIZON_MONTHS} months' post-lease disclosure
        </div>
        {timeAxis.length === 0 && (
          <div style={{ color: "#64748b", fontSize: 12 }}>No projected events across the fleet.</div>
        )}
        {timeAxis.map(bucket => (
          <div key={bucket.monthKey} style={{ borderTop: "1px solid #1e3048", padding: "10px 0" }}>
            <div className="flj" style={{ marginBottom: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#e2e8f0" }}>{bucket.monthKey}</span>
              <span style={{ fontSize: 11, color: "#94a3b8" }}>
                Cost ${Math.round(bucket.costHigh).toLocaleString()} · Coverage ${Math.round(bucket.coverage).toLocaleString()}
                {bucket.shortfallHigh > 0 && <span style={{ color: "#f87171" }}> · Gap ${Math.round(bucket.shortfallHigh).toLocaleString()}</span>}
              </span>
            </div>
            {bucket.atoms.map((a, i) => (
              <div key={i} className="flj" style={{ fontSize: 11, padding: "4px 0", color: a.postLeaseEnd ? "#64748b" : statusColor[a.status] || "#e2e8f0" }}>
                <span style={{ cursor: onSelectAsset ? "pointer" : "default" }} onClick={() => onSelectAsset && onSelectAsset(a.assetId)}>
                  MSN {a.msn} — {a.code}{a.postLeaseEnd ? " (post-lease, disclosure only)" : ""}
                </span>
                <span>${Math.round(a.costHigh).toLocaleString()}</span>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* ASSET AXIS — secondary panel, ranked worst-first (handoff §4). */}
      <div className="card" style={{ padding: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", marginBottom: 10 }}>Assets — ranked by exposure</div>
        {assetAxis.length === 0 && <div style={{ color: "#64748b", fontSize: 12 }}>No assets computed.</div>}
        {assetAxis.map(a => (
          <div key={a.assetId} className="flj" style={{ padding: "8px 0", borderTop: "1px solid #1e3048", cursor: onSelectAsset ? "pointer" : "default" }} onClick={() => onSelectAsset && onSelectAsset(a.assetId)}>
            <span style={{ fontSize: 12, color: "#e2e8f0" }}>MSN {a.msn}</span>
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

  const included = data.filter(a => !a.excluded);
  const excluded = data.filter(a => a.excluded);
  const events = included.flatMap(a => (a.events || []).map(e => ({ ...e, msn: a.msn, assetId: a.assetId })));

  return (
    <div style={{ animation: "fadeIn 0.2s ease" }}>
      <div style={{ background: "#0d1e33", border: "1px solid #1B3A6B", borderRadius: 10, padding: "12px 16px", marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0" }}>Calendar</div>
        <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
          Event clustering across the fleet's maintenance calendar — scheduling only, no cost figures. See Financials for the money view.
        </div>
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
                    <span style={{ color: e.excluded.code === "COMPUTE_ERROR" ? "#f87171" : "#fbbf24" }}>{e.excluded.code.replace(/_/g, " ")} — {e.excluded.message}</span>
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

export { FleetCalendarView, FleetExposureView, PandemicScenarioView, PortfolioView, RouteMatcherView };
