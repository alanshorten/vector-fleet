import React, { useState, useEffect, useCallback, useRef } from 'react';
import { SC, assetStatus, daysFromNow, isCFM } from '../lib/assetHelpers';
import { db } from '../lib/db';

function ReviewQueueBanner({saveAsset,notify}){
  const[pending,setPending]=useState([]);
  const[expanded,setExpanded]=useState(false);
  const[busyId,setBusyId]=useState(null);
  const refresh=async()=>{try{setPending(await db.getPendingReports());}catch{/* non-fatal — banner just stays empty */}};
  useEffect(()=>{refresh();},[]);
  if(!pending.length)return null;
  const apply=async(p)=>{
    setBusyId(p.id);
    try{
      await saveAsset(p.mergedAsset,"Applied email report");
      await db.saveUtilisation(p.utilisationRecord);
      await db.deletePendingReport(p.id);
      notify(`MSN ${p.msn} applied from ${p.period||"report"}`);
      await refresh();
    }catch(err){
      notify("Failed to apply report: "+(err.message||"please try again"),"error");
    }
    setBusyId(null);
  };
  const discard=async(p)=>{
    if(!confirm(`Discard this ${p.period||"report"} for MSN ${p.msn}? The asset will not be updated.`))return;
    setBusyId(p.id);
    try{
      await db.deletePendingReport(p.id);
      notify("Report discarded");
      await refresh();
    }catch(err){
      notify("Failed to discard report: "+(err.message||"please try again"),"error");
    }
    setBusyId(null);
  };
  return(
    <div className="card" style={{padding:0,marginBottom:14,border:"1px solid #92660a",overflow:"hidden"}}>
      <button onClick={()=>setExpanded(e=>!e)} style={{width:"100%",textAlign:"left",background:"#2a1f0a",border:"none",padding:"10px 16px",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span style={{fontSize:13,fontWeight:700,color:"#fbbf24"}}>⚠ {pending.length} email report{pending.length>1?"s":""} awaiting review</span>
        <span style={{fontSize:12,color:"#fbbf24"}}>{expanded?"▲":"▼"}</span>
      </button>
      {expanded&&(
        <div style={{padding:"10px 16px",display:"flex",flexDirection:"column",gap:10}}>
          {pending.map(p=>(
            <div key={p.id} style={{background:"#0d1925",border:"1px solid #1e3048",borderRadius:6,padding:"10px 12px"}}>
              <div className="flj" style={{marginBottom:6}}>
                <div style={{fontSize:12,fontWeight:700,color:"#e2e8f0"}}>MSN {p.msn||"—"} · {p.period||"unknown period"}</div>
                <div style={{fontSize:10,color:"#475569"}}>{p.fileName||""}</div>
              </div>
              {(p.warnings||[]).map((w,i)=>(
                <div key={i} style={{fontSize:11,color:"#fcd34d",marginBottom:2,lineHeight:1.5}}>{w}</div>
              ))}
              <div className="flab g8" style={{marginTop:8}}>
                <button className="btn btn-ghost" style={{fontSize:11,padding:"4px 10px"}} disabled={busyId===p.id} onClick={()=>discard(p)}>Discard</button>
                <button className="btn btn-gold" style={{fontSize:11,padding:"4px 10px"}} disabled={busyId===p.id} onClick={()=>apply(p)}>{busyId===p.id?"Applying…":"✓ Apply"}</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

function Dashboard({assets,onSelect,saveAsset,notify}){
  const[viewMode,setViewMode]=useState("list");
  const[filter,setFilter]=useState("");
  const[sortCol,setSortCol]=useState("msn");
  const[sortDir,setSortDir]=useState("asc");
  const parseDMY=(s)=>{if(!s)return null;const m=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);if(m)return new Date(+m[3],+m[2]-1,+m[1]);const d=new Date(s);return isNaN(d)?null:d;};
  const llOf=(eng)=>{if(!eng||eng.atShop)return null;const ll=lowestLimiter(eng);return ll===null||ll===undefined?null:ll;};
  const COLUMN_ACCESSORS={
    msn:a=>a.msn,
    registration:a=>a.registration,
    model:a=>a.model,
    operator:a=>a.operator,
    afTSN:a=>a.airframe?.currentFH??null,
    afCSN:a=>a.airframe?.currentFC??null,
    eng1:a=>llOf(a.engines?.[0]),
    eng2:a=>llOf(a.engines?.[1]),
    apu:a=>a.apu?.llps?.length?Math.min(...a.apu.llps.map(l=>calcLLPRem(l,a.apu.currentFC))):null,
    nlg:a=>parseDMY(a.landingGear?.nose?.nextDue),
    llg:a=>parseDMY(a.landingGear?.left?.nextDue),
    rlg:a=>parseDMY(a.landingGear?.right?.nextDue),
    lastReport:a=>{if(!a._lastPeriod)return null;const d=new Date(a._lastPeriod);return isNaN(d)?null:d;},
  };
  const filtered=assets.filter(a=>[a.msn,a.registration,a.operator,a.model].some(v=>v?.toLowerCase().includes(filter.toLowerCase())));
  const sorted=[...filtered].sort((a,b)=>{
    const accessor=COLUMN_ACCESSORS[sortCol]||(x=>x[sortCol]);
    const av=accessor(a),bv=accessor(b);
    const aEmpty=av===null||av===undefined||av==="";
    const bEmpty=bv===null||bv===undefined||bv==="";
    // Empty/no-data values always sort to the end, regardless of direction
    if(aEmpty&&bEmpty)return 0;
    if(aEmpty)return 1;
    if(bEmpty)return -1;
    if(av instanceof Date&&bv instanceof Date)return sortDir==="asc"?av-bv:bv-av;
    if(typeof av==="number"&&typeof bv==="number")return sortDir==="asc"?av-bv:bv-av;
    return sortDir==="asc"?String(av).localeCompare(String(bv)):String(bv).localeCompare(String(av));
  });
  const toggleSort=col=>{if(sortCol===col)setSortDir(d=>d==="asc"?"desc":"asc");else{setSortCol(col);setSortDir("asc");}};
  const LLPCell=({eng})=>{if(!eng)return<td style={{color:"#475569"}}>—</td>;if(eng.atShop)return<td><span style={{fontSize:11,color:"#94a3b8"}}>🔧</span></td>;const ll=lowestLimiter(eng);if(ll===null)return<td style={{color:"#475569",fontSize:11}}>No data</td>;const col=ll<1000?"#f87171":ll<3000?"#fbbf24":"#34d399";return<td><span className="pill" style={{background:ll<1000?"#2a0e0e":ll<3000?"#2a1f0a":"#0d2818",color:col}}>{ll.toLocaleString()}</span></td>;};
  const LGCell=({g})=>{if(!g||!g.nextDue)return<td style={{color:"#475569",textAlign:"center"}}>—</td>;if(g.atShop)return<td style={{textAlign:"center"}}><span style={{fontSize:11,color:"#94a3b8"}}>🔧</span></td>;const d=daysFromNow(g.nextDue);const col=d<0?"#f87171":d<365?"#fbbf24":"#64748b";return<td style={{textAlign:"center"}}><span className="pill" style={{background:d<0?"#2a0e0e":d<365?"#2a1f0a":"transparent",color:col,display:"inline-block"}}>{fmtDate(g.nextDue)}</span></td>;};
  const APUCell=({apu})=>{if(!apu?.llps?.length)return<td style={{color:"#475569"}}>—</td>;const ll=Math.min(...apu.llps.map(l=>calcLLPRem(l,apu.currentFC)));const col=ll<1000?"#f87171":ll<3000?"#fbbf24":"#34d399";return<td><span className="pill" style={{background:ll<1000?"#2a0e0e":ll<3000?"#2a1f0a":"#0d2818",color:col}}>{ll.toLocaleString()}</span></td>;};
  return(
    <div style={{animation:"fadeIn 0.2s ease"}}>
      <ReviewQueueBanner saveAsset={saveAsset} notify={notify}/>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,gap:8,flexWrap:"wrap"}}>
        <div style={{display:"flex",alignItems:"center",gap:8,flex:1,minWidth:0}}>
          <input placeholder="Search MSN, reg, operator…" value={filter} onChange={e=>setFilter(e.target.value)} style={{minWidth:0,flex:1}}/>
          <span style={{fontSize:12,color:"#475569",whiteSpace:"nowrap"}}>{sorted.length}</span>
        </div>
        <div style={{display:"flex",gap:4,background:"#152030",padding:3,borderRadius:6,flexShrink:0}}>
          {[["list","☰"],["card","⊞"]].map(([m,l])=>(
            <button key={m} className="btn" onClick={()=>setViewMode(m)} style={{padding:"5px 10px",fontSize:14,background:viewMode===m?"#1e3348":"transparent",color:viewMode===m?"#C9A84C":"#64748b"}}>{l}</button>
          ))}
        </div>
      </div>
      {viewMode==="list"&&(
        <div className="card" style={{overflow:"auto"}}>
          <table>
            <thead><tr>
              <th style={{width:24}}></th>
              {[["MSN","msn"],["Reg","registration"],["Model","model"],["Operator","operator"]].map(([l,k])=>(
                <th key={k}><button onClick={()=>toggleSort(k)} style={{background:"none",border:"none",color:sortCol===k?"#C9A84C":"#475569",fontFamily:"inherit",fontSize:10,fontWeight:700,cursor:"pointer",textTransform:"uppercase",letterSpacing:"0.05em",whiteSpace:"nowrap"}}>{l}{sortCol===k?(sortDir==="asc"?" ↑":" ↓"):""}</button></th>
              ))}
              {[["AF TSN","afTSN"],["AF CSN","afCSN"],["Eng 1","eng1"],["Eng 2","eng2"],["APU","apu"],["NLG","nlg"],["LLG","llg"],["RLG","rlg"],["Last Report","lastReport"]].map(([l,k])=>(
                <th key={k} style={["nlg","llg","rlg"].includes(k)?{textAlign:"center"}:null}><button onClick={()=>toggleSort(k)} style={{background:"none",border:"none",color:sortCol===k?"#C9A84C":"#475569",fontFamily:"inherit",fontSize:10,fontWeight:700,cursor:"pointer",textTransform:"uppercase",letterSpacing:"0.05em",whiteSpace:"nowrap"}}>{l}{sortCol===k?(sortDir==="asc"?" ↑":" ↓"):""}</button></th>
              ))}
              <th style={{width:24}} title="Lease on file"></th>
            </tr></thead>
            <tbody>
              {sorted.map((a,i)=>{const st=assetStatus(a);const af=a.airframe||{};return(
                <tr key={a.id} className="row-hover" onClick={()=>onSelect(a.id)} style={{background:i%2===0?"#0d1e2e":"#152535",cursor:"pointer"}}>
                  <td style={{textAlign:"center"}}><div style={{width:8,height:8,borderRadius:"50%",background:SC[st].dot,margin:"0 auto",boxShadow:st!=="ok"?`0 0 7px ${SC[st].dot},0 0 14px ${SC[st].dot}44`:"none"}}/></td>
                  <td style={{fontWeight:700,color:"#C9A84C",fontFamily:"monospace"}}>{a.msn}</td>
                  <td style={{fontWeight:600}}>{a.registration||"—"}</td>
                  <td><span style={{color:"#94a3b8"}}>{a.model||"—"}</span>{isCFM(a)?<span className="tag" style={{background:"#1e3a5f",color:"#60a5fa",marginLeft:5}}>CFM</span>:<span className="tag" style={{background:"#1e2a4a",color:"#a78bfa",marginLeft:5}}>V2500</span>}</td>
                  <td style={{color:"#94a3b8"}}>{a.operator||"—"}</td>
                  <td style={{fontFamily:"monospace"}}>{fmtHHMM(af.currentFH)}</td>
                  <td style={{fontFamily:"monospace"}}>{af.currentFC?.toLocaleString()||"—"}</td>
                  <LLPCell eng={a.engines?.[0]}/><LLPCell eng={a.engines?.[1]}/><APUCell apu={a.apu}/>
                  <LGCell g={a.landingGear?.nose}/><LGCell g={a.landingGear?.left}/><LGCell g={a.landingGear?.right}/>
                  <td style={{fontSize:11,color:a._lastPeriod?"#64748b":"#f87171"}}>{a._lastPeriod||"No report"}</td>
                  <td style={{textAlign:"center"}} title={a.currentLeaseId?"Lease on file":"No lease yet"}>{a.currentLeaseId?<span style={{fontSize:12}}>📄</span>:<span style={{color:"#1e3048"}}>·</span>}</td>
                </tr>
              );})}
              {sorted.length===0&&<tr><td colSpan={15} style={{textAlign:"center",padding:48,color:"#475569"}}>{assets.length===0?"No assets yet — go to Admin to add your first aircraft.":"No results."}</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {viewMode==="card"&&(
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:12}}>
          {sorted.map(a=>{const st=assetStatus(a);const af=a.airframe||{};return(
            <div key={a.id} className="card card-hover" onClick={()=>onSelect(a.id)} style={{borderLeft:`3px solid ${SC[st].border}`,padding:16}}>
              <div className="flj" style={{marginBottom:10}}>
                <div>
                  <div className="flab g8">
                    <span style={{fontWeight:700,fontSize:15,color:"#C9A84C",fontFamily:"monospace"}}>MSN {a.msn}</span>
                    {isCFM(a)?<span className="tag" style={{background:"#1e3a5f",color:"#60a5fa"}}>CFM</span>:<span className="tag" style={{background:"#1e2a4a",color:"#a78bfa"}}>V2500</span>}
                    {a.currentLeaseId&&<span title="Lease on file" style={{fontSize:12}}>📄</span>}
                  </div>
                  <div style={{fontSize:14,fontWeight:600,color:"#f1f5f9",marginTop:2}}>{a.registration||"—"}</div>
                  <div style={{fontSize:11,color:"#475569"}}>{a.model} · {a.operator||"—"}</div>
                </div>
                <div style={{width:10,height:10,borderRadius:"50%",background:SC[st].dot,boxShadow:st!=="ok"?`0 0 8px ${SC[st].dot}`:"none"}}/>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,background:"#0d1925",borderRadius:6,padding:"8px 10px",marginBottom:10}}>
                {[["AF TSN",fmtHHMM(af.currentFH)],["AF CSN",af.currentFC?.toLocaleString()||"—"]].map(([l,v])=>(
                  <div key={l}><div style={{fontSize:9,color:"#475569",fontWeight:700,textTransform:"uppercase"}}>{l}</div><div style={{fontSize:13,fontWeight:700,color:"#f1f5f9",fontFamily:"monospace"}}>{v}</div></div>
                ))}
              </div>
              <div style={{marginBottom:10}}>
                {(a.engines||[]).map((eng,ei)=>{const ll=lowestLimiter(eng);const col=ll===null?"#475569":ll<1000?"#f87171":ll<3000?"#fbbf24":"#34d399";return<div key={ei} className="flj" style={{padding:"3px 0",borderBottom:"1px solid #0f2030"}}><span style={{fontSize:11,color:"#64748b"}}>Eng {ei+1} LLP</span><span style={{fontSize:11,fontWeight:700,color:col}}>{ll!==null?`${ll.toLocaleString()} FC`:"No data"}</span></div>;})}
                {(()=>{const ll=a.apu?.llps?.length?Math.min(...a.apu.llps.map(l=>calcLLPRem(l,a.apu.currentFC))):null;const col=ll===null?"#475569":ll<1000?"#f87171":ll<3000?"#fbbf24":"#34d399";return<div className="flj" style={{padding:"3px 0",borderBottom:"1px solid #0f2030"}}><span style={{fontSize:11,color:"#64748b"}}>APU LLP</span><span style={{fontSize:11,fontWeight:700,color:col}}>{ll!==null?`${ll.toLocaleString()} FC`:"N/A"}</span></div>;})()}
                {["nose","left","right"].map(k=>{const g=a.landingGear?.[k];const days=g?.nextDue?daysFromNow(g.nextDue):null;const col=days===null?"#475569":days<0?"#f87171":days<365?"#fbbf24":"#64748b";const label=k==="nose"?"NLG":k==="left"?"LH":"RH";return<div key={k} className="flj" style={{padding:"3px 0",borderBottom:"1px solid #0f2030"}}><span style={{fontSize:11,color:"#64748b"}}>{label}</span><span style={{fontSize:11,fontWeight:600,color:col}}>{g?.nextDue?fmtDate(g.nextDue):"N/A"}</span></div>;})}
              </div>
              <button className="btn btn-gold" style={{width:"100%",padding:"7px 0",fontSize:12}} onClick={e=>{e.stopPropagation();onSelect(a.id);}}>View Details</button>
            </div>
          );})}
        </div>
      )}
      <div className="flab" style={{gap:16,marginTop:14,fontSize:11,color:"#334155",flexWrap:"wrap"}}>
        {[["#f87171","Critical"],["#fbbf24","Attention"],["#34d399","All clear"]].map(([c,l])=>(
          <div key={l} className="flab" style={{gap:5}}><div style={{width:8,height:8,borderRadius:"50%",background:c}}/>{l}</div>
        ))}
      </div>
    </div>
  );
};


export { Dashboard, ReviewQueueBanner };
