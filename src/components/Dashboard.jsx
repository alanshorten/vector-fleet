import React, { useState, useEffect, useCallback, useRef } from 'react';
import { SC, assetStatus, daysFromNow, isCFM } from '../lib/assetHelpers';
import { db } from '../lib/db';
import { FleetFindingsCards } from './Findings';

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
    <div className="card" style={{padding:0,marginBottom:14,border:"1px solid var(--color-attention)",overflow:"hidden"}}>
      <button onClick={()=>setExpanded(e=>!e)} style={{width:"100%",textAlign:"left",background:"var(--color-attention-tint)",border:"none",padding:"10px 16px",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span style={{fontSize:13,fontWeight:700,color:"var(--color-attention)"}}>⚠ {pending.length} email report{pending.length>1?"s":""} awaiting review</span>
        <span style={{fontSize:12,color:"var(--color-attention)"}}>{expanded?"▲":"▼"}</span>
      </button>
      {expanded&&(
        <div style={{padding:"10px 16px",display:"flex",flexDirection:"column",gap:10}}>
          {pending.map(p=>(
            <div key={p.id} style={{background:"var(--color-technical-grey)",border:"1px solid var(--color-divider)",borderRadius:6,padding:"10px 12px"}}>
              <div className="flj" style={{marginBottom:6}}>
                <div style={{fontSize:12,fontWeight:700,color:"var(--color-carbon)"}}>MSN {p.msn||"—"} · {p.period||"unknown period"}</div>
                <div style={{fontSize:10,color:"var(--color-graphite)"}}>{p.fileName||""}</div>
              </div>
              {(p.warnings||[]).map((w,i)=>(
                <div key={i} style={{fontSize:11,color:"var(--color-attention)",marginBottom:2,lineHeight:1.5}}>{w}</div>
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

function Dashboard({assets,onSelect,saveAsset,notify,onOpenFinding,userRole}){
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
  const LLPCell=({eng})=>{if(!eng)return<td style={{color:"var(--color-graphite)"}}>—</td>;if(eng.atShop)return<td><span style={{fontSize:11,color:"var(--color-graphite)"}}>🔧</span></td>;const ll=lowestLimiter(eng);if(ll===null)return<td style={{color:"var(--color-graphite)",fontSize:11}}>—</td>;const col=ll<1000?"var(--color-critical)":ll<3000?"var(--color-attention)":"var(--color-positive)";return<td><span className="pill" style={{background:ll<1000?"var(--color-critical-tint)":ll<3000?"var(--color-attention-tint)":"var(--color-positive-tint)",color:col}}>{ll.toLocaleString()}</span></td>;};
  const LGCell=({g})=>{if(!g||!g.nextDue)return<td style={{color:"var(--color-graphite)",textAlign:"center"}}>—</td>;if(g.atShop)return<td style={{textAlign:"center"}}><span style={{fontSize:11,color:"var(--color-graphite)"}}>🔧</span></td>;const d=daysFromNow(g.nextDue);const col=d<0?"var(--color-critical)":d<365?"var(--color-attention)":"var(--color-graphite)";return<td style={{textAlign:"center"}}><span className="pill" style={{background:d<0?"var(--color-critical-tint)":d<365?"var(--color-attention-tint)":"transparent",color:col,display:"inline-block"}}>{fmtDate(g.nextDue)}</span></td>;};
  const APUCell=({apu})=>{if(!apu?.llps?.length)return<td style={{color:"var(--color-graphite)"}}>—</td>;const ll=Math.min(...apu.llps.map(l=>calcLLPRem(l,apu.currentFC)));const col=ll<1000?"var(--color-critical)":ll<3000?"var(--color-attention)":"var(--color-positive)";return<td><span className="pill" style={{background:ll<1000?"var(--color-critical-tint)":ll<3000?"var(--color-attention-tint)":"var(--color-positive-tint)",color:col}}>{ll.toLocaleString()}</span></td>;};
  return(
    <div style={{animation:"fadeIn 0.2s ease"}}>
      <ReviewQueueBanner saveAsset={saveAsset} notify={notify}/>
      {onOpenFinding&&<FleetFindingsCards assets={assets} onOpenFinding={onOpenFinding} userRole={userRole}/>}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,gap:8,flexWrap:"wrap"}}>
        <div style={{display:"flex",alignItems:"center",gap:8,flex:1,minWidth:0}}>
          <input placeholder="Search MSN, reg, operator…" value={filter} onChange={e=>setFilter(e.target.value)} style={{minWidth:0,flex:1}}/>
          <span style={{fontSize:12,color:"var(--color-graphite)",whiteSpace:"nowrap"}}>{sorted.length}</span>
        </div>
        <div style={{display:"flex",gap:4,background:"var(--color-technical-grey)",border:"1px solid var(--color-divider)",padding:3,borderRadius:6,flexShrink:0}}>
          {[["list","☰"],["card","⊞"]].map(([m,l])=>(
            <button key={m} className="btn" onClick={()=>setViewMode(m)} style={{padding:"5px 10px",fontSize:14,background:viewMode===m?"var(--color-teal)":"transparent",color:viewMode===m?"var(--color-soft-white)":"var(--color-graphite)"}}>{l}</button>
          ))}
        </div>
      </div>
      {viewMode==="list"&&(
        <div className="card" style={{overflow:"auto"}}>
          <table>
            <thead><tr>
              <th style={{width:24}}></th>
              {[["MSN","msn"],["Reg","registration"],["Model","model"],["Operator","operator"]].map(([l,k])=>(
                <th key={k}><button onClick={()=>toggleSort(k)} style={{background:"none",border:"none",color:sortCol===k?"var(--color-carbon)":"var(--color-graphite)",fontFamily:"inherit",fontSize:10,fontWeight:700,cursor:"pointer",textTransform:"uppercase",letterSpacing:"0.05em",whiteSpace:"nowrap"}}>{l}{sortCol===k?(sortDir==="asc"?" ↑":" ↓"):""}</button></th>
              ))}
              {[["AF TSN","afTSN"],["AF CSN","afCSN"],["Eng 1","eng1"],["Eng 2","eng2"],["APU","apu"],["NLG","nlg"],["LH MLG","llg"],["RH MLG","rlg"],["Last Report","lastReport"]].map(([l,k])=>(
                <th key={k} style={["nlg","llg","rlg"].includes(k)?{textAlign:"center"}:null}><button onClick={()=>toggleSort(k)} style={{background:"none",border:"none",color:sortCol===k?"var(--color-carbon)":"var(--color-graphite)",fontFamily:"inherit",fontSize:10,fontWeight:700,cursor:"pointer",textTransform:"uppercase",letterSpacing:"0.05em",whiteSpace:"nowrap"}}>{l}{sortCol===k?(sortDir==="asc"?" ↑":" ↓"):""}</button></th>
              ))}
              <th style={{width:24}} title="Lease on file"></th>
            </tr></thead>
            <tbody>
              {sorted.map((a,i)=>{const st=assetStatus(a);const af=a.airframe||{};return(
                <tr key={a.id} className="row-hover" onClick={()=>onSelect(a.id)} style={{background:i%2===0?"var(--color-soft-white)":"var(--color-technical-grey)",cursor:"pointer"}}>
                  <td style={{textAlign:"center"}}><div style={{width:8,height:8,borderRadius:"50%",background:SC[st].dot,margin:"0 auto"}}/></td>
                  <td style={{fontWeight:600}}>{a.msn}</td>
                  <td style={{fontWeight:600}}>{a.registration||"—"}</td>
                  <td><span style={{color:"var(--color-graphite)"}}>{a.model||"—"}</span>{isCFM(a)?<span className="tag" style={{background:"var(--color-teal-tint)",color:"var(--color-teal)",marginLeft:5}}>CFM</span>:<span className="tag" style={{background:"var(--color-divider-inner)",color:"var(--color-graphite)",marginLeft:5}}>V2500</span>}</td>
                  <td style={{color:"var(--color-graphite)"}}>{a.operator||"—"}</td>
                  <td style={{fontFamily:"var(--font-data)"}}>{af.currentFH?fmtHHMM(af.currentFH):"—"}</td>
                  <td style={{fontFamily:"var(--font-data)"}}>{af.currentFC?af.currentFC.toLocaleString():"—"}</td>
                  <LLPCell eng={a.engines?.[0]}/><LLPCell eng={a.engines?.[1]}/><APUCell apu={a.apu}/>
                  <LGCell g={a.landingGear?.nose}/><LGCell g={a.landingGear?.left}/><LGCell g={a.landingGear?.right}/>
                  <td style={{fontSize:11,color:a._lastPeriod?"var(--color-graphite)":"var(--color-critical)"}}>{a._lastPeriod||"No report"}</td>
                  <td style={{textAlign:"center"}} title={a.currentLeaseId?"Lease on file":"No lease yet"}>{a.currentLeaseId?<span style={{fontSize:12}}>📄</span>:<span style={{color:"var(--color-divider)"}}>·</span>}</td>
                </tr>
              );})}
              {sorted.length===0&&<tr><td colSpan={15} style={{textAlign:"center",padding:48,color:"var(--color-graphite)"}}>{assets.length===0?"No assets yet — go to Admin to add your first aircraft.":"No results."}</td></tr>}
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
                    <span style={{fontWeight:600,fontSize:15,color:"var(--color-carbon)"}}>MSN {a.msn}</span>
                    {isCFM(a)?<span className="tag" style={{background:"var(--color-teal-tint)",color:"var(--color-teal)"}}>CFM</span>:<span className="tag" style={{background:"var(--color-divider-inner)",color:"var(--color-graphite)"}}>V2500</span>}
                    {a.currentLeaseId&&<span title="Lease on file" style={{fontSize:12}}>📄</span>}
                  </div>
                  <div style={{fontSize:14,fontWeight:600,color:"var(--color-carbon)",marginTop:2}}>{a.registration||"—"}</div>
                  <div style={{fontSize:11,color:"var(--color-graphite)"}}>{a.model} · {a.operator||"—"}</div>
                </div>
                <div style={{width:10,height:10,borderRadius:"50%",background:SC[st].dot}}/>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,background:"var(--color-technical-grey)",borderRadius:6,padding:"8px 10px",marginBottom:10}}>
                {[["AF TSN",af.currentFH?fmtHHMM(af.currentFH):"—"],["AF CSN",af.currentFC?af.currentFC.toLocaleString():"—"]].map(([l,v])=>(
                  <div key={l}><div style={{fontSize:9,color:"var(--color-graphite)",fontWeight:700,textTransform:"uppercase"}}>{l}</div><div style={{fontSize:13,fontWeight:700,color:"var(--color-carbon)",fontFamily:"var(--font-data)"}}>{v}</div></div>
                ))}
              </div>
              <div style={{marginBottom:10}}>
                {(a.engines||[]).map((eng,ei)=>{const ll=lowestLimiter(eng);const col=ll===null?"var(--color-graphite)":ll<1000?"var(--color-critical)":ll<3000?"var(--color-attention)":"var(--color-positive)";return<div key={ei} className="flj" style={{padding:"3px 0",borderBottom:"1px solid var(--color-divider-inner)"}}><span style={{fontSize:11,color:"var(--color-graphite)"}}>Eng {ei+1} LLP</span><span style={{fontSize:11,fontWeight:700,color:col}}>{ll!==null?`${ll.toLocaleString()} FC`:"—"}</span></div>;})}
                {(()=>{const ll=a.apu?.llps?.length?Math.min(...a.apu.llps.map(l=>calcLLPRem(l,a.apu.currentFC))):null;const col=ll===null?"var(--color-graphite)":ll<1000?"var(--color-critical)":ll<3000?"var(--color-attention)":"var(--color-positive)";return<div className="flj" style={{padding:"3px 0",borderBottom:"1px solid var(--color-divider-inner)"}}><span style={{fontSize:11,color:"var(--color-graphite)"}}>APU LLP</span><span style={{fontSize:11,fontWeight:700,color:col}}>{ll!==null?`${ll.toLocaleString()} FC`:"—"}</span></div>;})()}
                {["nose","left","right"].map(k=>{const g=a.landingGear?.[k];const days=g?.nextDue?daysFromNow(g.nextDue):null;const col=days===null?"var(--color-graphite)":days<0?"var(--color-critical)":days<365?"var(--color-attention)":"var(--color-graphite)";const label=k==="nose"?"NLG":k==="left"?"LH MLG":"RH MLG";return<div key={k} className="flj" style={{padding:"3px 0",borderBottom:"1px solid var(--color-divider-inner)"}}><span style={{fontSize:11,color:"var(--color-graphite)"}}>{label}</span><span style={{fontSize:11,fontWeight:600,color:col}}>{g?.nextDue?fmtDate(g.nextDue):"—"}</span></div>;})}
              </div>
              <button className="btn btn-gold" style={{width:"100%",padding:"7px 0",fontSize:12}} onClick={e=>{e.stopPropagation();onSelect(a.id);}}>View Details</button>
            </div>
          );})}
        </div>
      )}
      <div className="flab" style={{gap:16,marginTop:14,fontSize:11,color:"var(--color-graphite)",flexWrap:"wrap"}}>
        {[["var(--color-critical)","Critical"],["var(--color-attention)","Attention"],["var(--color-positive)","All clear"]].map(([c,l])=>(
          <div key={l} className="flab" style={{gap:5}}><div style={{width:8,height:8,borderRadius:"50%",background:c}}/>{l}</div>
        ))}
      </div>
    </div>
  );
};


export { Dashboard, ReviewQueueBanner };