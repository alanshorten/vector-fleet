import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ShareModal } from './AssetView';
import { assetStatus, daysFromNow, assetEngineStockPhotoKey, airframeStockPhotoKey } from '../lib/assetHelpers';
import { db } from '../lib/db';
import { FLEET_EXPOSURE_HORIZON_MONTHS, buildFleetExposureData } from '../lib/flyForwardHelpers';
import { getDefaultDisclaimer, getTechSpecLogo, openTechSpec } from '../lib/techSpec';

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


export { FleetExposureView, PortfolioView };
