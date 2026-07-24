import React, { useState, useEffect, useCallback, useRef } from 'react';
import { daysFromNow, isEmpty, parseHHMM } from '../lib/assetHelpers';
import { db } from '../lib/db';
import { getDefaultDisclaimer, getTechSpecLogo } from '../lib/techSpec';

function OverviewTab({asset,isAdmin,saveAsset,notify}){
  const[editing,setEditing]=useState(false);
  const[form,setForm]=useState(null);
  const startEdit=()=>{setForm(JSON.parse(JSON.stringify(asset)));setEditing(true);};
  const cancel=()=>{setForm(null);setEditing(false);};
  const save=async()=>{await saveAsset(form);setEditing(false);setForm(null);notify("Saved");};
  const d=editing?form:asset;
  const af=asset.airframe||{};
  const set=(path,val)=>{const f=JSON.parse(JSON.stringify(form));const parts=path.split(".");let obj=f;for(let i=0;i<parts.length-1;i++){if(!obj[parts[i]])obj[parts[i]]={};obj=obj[parts[i]];}obj[parts[parts.length-1]]=val;setForm(f);};
  const fmtMMYYYY=(s)=>{if(!s)return"—";if(/^\d{2}\/\d{4}$/.test(s))return s;try{const d=new Date(s);if(isNaN(d))return s;return String(d.getMonth()+1).padStart(2,"0")+"/"+d.getFullYear();}catch{return s;}};
  const Field=({label,path,type="text"})=>{
    const parts=path.split(".");const val=parts.reduce((o,k)=>o?.[k],d);
    return<div className="form-group"><label className="form-label">{label}</label>
      {editing&&isAdmin?<input type="text" placeholder={type==="mmyyyy"?"MM/YYYY":""} defaultValue={type==="mmyyyy"?fmtMMYYYY(val):val||""} onBlur={e=>set(path,e.target.value)} className={isEmpty(val)?"amber":""}/>
      :<div style={{fontSize:13,fontWeight:500,color:isEmpty(val)?"#475569":"#e2e8f0",fontStyle:isEmpty(val)?"italic":"normal"}}>{type==="mmyyyy"?fmtMMYYYY(val):val||"Not entered"}</div>}
    </div>;
  };
  // Status calcs — grouped per-component (Engine #N / APU), each carrying its own limiter + TSN + CSN
  const engineBlocks=(asset.engines||[]).map(e=>({
    label:`Engine #${e.position||1}`,
    idLabel:`ESN ${e.sn||"TBD"}`,
    val:lowestLimiter(e),
    tsn:e.currentFH,
    csn:e.currentFC,
  }));
  const apuBlock=asset.apu?{
    label:"APU",
    idLabel:`S/N ${asset.apu.sn||"TBD"}`,
    val:asset.apu.llps?.length?Math.min(...asset.apu.llps.map(l=>calcLLPRem(l,asset.apu.currentFC))):null,
    tsn:asset.apu.currentFH,
    csn:asset.apu.currentFC,
  }:null;
  const componentBlocks=apuBlock?[...engineBlocks,apuBlock]:engineBlocks;
  const lgItems=[["NLG",asset.landingGear?.nose],["LH",asset.landingGear?.left],["RH",asset.landingGear?.right]];
  return(
    <div className="grid2">
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        <div className="card" style={{padding:18}}>
          <div className="flj" style={{marginBottom:12}}>
            <div className="section-title" style={{margin:0}}>Asset Details</div>
            {!isAdmin?null:!editing?<button className="btn btn-ghost" onClick={startEdit}>Edit</button>:<div className="flab g8"><button className="btn btn-ghost" onClick={cancel}>Cancel</button><button className="btn btn-gold" onClick={save}>Save</button></div>}
          </div>
          <div className="grid2" style={{gap:"0 16px"}}>
            <Field label="MSN" path="msn"/><Field label="Registration" path="registration"/>
            <div className="form-group">
              <label className="form-label" style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                <span>{d.operatorLabel||"Current Operator"}</span>
                {editing&&isAdmin&&<button type="button" onClick={()=>set("operatorLabel",d.operatorLabel==="Previous Operator"?"Current Operator":"Previous Operator")} style={{fontSize:9,fontWeight:700,padding:"1px 7px",borderRadius:3,border:"1px solid #C9A84C",background:"none",color:"#C9A84C",cursor:"pointer",textTransform:"uppercase",letterSpacing:"0.05em",flexShrink:0}}>{"→ "+(d.operatorLabel==="Previous Operator"?"Current":"Previous")}</button>}
              </label>
              {editing&&isAdmin?<input type="text" defaultValue={d.operator||""} onBlur={e=>set("operator",e.target.value)} className={isEmpty(d.operator)?"amber":""}/>:<div style={{fontSize:13,fontWeight:500,color:isEmpty(d.operator)?"#475569":"#e2e8f0",fontStyle:isEmpty(d.operator)?"italic":"normal"}}>{d.operator||"Not entered"}</div>}
            </div>
            <Field label="Model" path="model"/>
            <Field label="Manufacturer" path="manufacturer"/><Field label="Date of Manufacture (MM/YYYY)" path="dom" type="mmyyyy"/>
          </div>
          <div style={{marginTop:14,paddingTop:14,borderTop:"1px solid #1e3048"}}>
            <div style={{fontSize:10,fontWeight:700,color:"#475569",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:8}}>Current Airframe</div>
            <div className="grid2" style={{gap:8}}>
              {[["AIRFRAME TSN",fmtHHMM(af.currentFH)],["AIRFRAME CSN",af.currentFC?.toLocaleString()||"—"]].map(([l,v])=>(
                <div key={l} style={{background:"#070f18",border:"1px solid #1B3A6B",borderRadius:8,padding:"12px 14px"}}>
                  <div style={{fontSize:9,color:"#475569",fontWeight:700,letterSpacing:"0.08em"}}>{l}</div>
                  <div style={{fontSize:20,fontWeight:700,color:"#C9A84C",fontFamily:"monospace",marginTop:4}}>{v}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="card" style={{padding:18}}>
          <div className="section-title">Check History</div>
          {(asset.checks||[]).map((c,i)=>(
            <div key={i} style={{marginTop:i>0?14:0,paddingTop:i>0?14:0,borderTop:i>0?"1px solid #1e3048":"none"}}>
              <div style={{fontSize:11,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:"0.04em",marginBottom:6}}>{c.name}</div>
              <div className="flj" style={{padding:"3px 0"}}>
                <span style={{fontSize:12,color:"#64748b"}}>TSN</span>
                <span style={{fontSize:12,fontFamily:"monospace",color:isEmpty(c.lastFH)?"#475569":"#e2e8f0"}}>{c.lastFH?.toLocaleString()||"—"}</span>
              </div>
              <div className="flj" style={{padding:"3px 0"}}>
                <span style={{fontSize:12,color:"#64748b"}}>CSN</span>
                <span style={{fontSize:12,fontFamily:"monospace",color:isEmpty(c.lastFC)?"#475569":"#e2e8f0"}}>{c.lastFC?.toLocaleString()||"—"}</span>
              </div>
              <div className="flj" style={{padding:"3px 0"}}>
                <span style={{fontSize:12,color:"#64748b"}}>Last</span>
                <span style={{fontSize:12,color:isEmpty(c.lastDate)?"#475569":"#e2e8f0"}}>{fmtDate(c.lastDate)||"—"}</span>
              </div>
              <div className="flj" style={{padding:"3px 0"}}>
                <span style={{fontSize:12,color:"#64748b"}}>Next Due</span>
                <span style={{fontSize:12,fontWeight:700,color:daysFromNow(c.nextDate)<365?"#fbbf24":"#34d399"}}>{fmtDate(c.nextDate)||"—"}</span>
              </div>
            </div>
          ))}
          {(asset.checks||[]).length===0&&<div style={{fontSize:12,color:"#475569",fontStyle:"italic"}}>No check history recorded</div>}
        </div>
      </div>
      <div className="card" style={{padding:18}}>
        <div className="section-title">Status Summary</div>
        {componentBlocks.map(({label,idLabel,val,tsn,csn})=>{
          const col=val===null?"#475569":val<1000?"#f87171":val<3000?"#fbbf24":"#34d399";
          const bg=val===null?"transparent":val<1000?"#2a0e0e":val<3000?"#2a1f0a":"#0d2818";
          return(
            <div key={label} style={{marginBottom:14,paddingBottom:14,borderBottom:"1px solid #1e3048"}}>
              <div style={{fontSize:11,fontWeight:700,color:"#94a3b8",marginBottom:6}}>{label} · {idLabel}</div>
              <div className="flj" style={{padding:"3px 0"}}>
                <span style={{fontSize:12,color:"#64748b"}}>Limiter</span>
                <span className="pill" style={{background:bg,color:col,fontSize:11}}>{val!==null?`${val.toLocaleString()} FC`:"No data"}</span>
              </div>
              <div className="flj" style={{padding:"3px 0"}}>
                <span style={{fontSize:12,color:"#64748b"}}>TSN</span>
                <span style={{fontSize:12,fontFamily:"monospace",color:"#e2e8f0"}}>{fmtHHMM(tsn)}</span>
              </div>
              <div className="flj" style={{padding:"3px 0"}}>
                <span style={{fontSize:12,color:"#64748b"}}>CSN</span>
                <span style={{fontSize:12,fontFamily:"monospace",color:"#e2e8f0"}}>{csn!=null?csn.toLocaleString():"—"}</span>
              </div>
            </div>
          );
        })}
        {componentBlocks.length===0&&<div style={{fontSize:12,color:"#475569",fontStyle:"italic",marginBottom:14}}>No engine/APU data</div>}
        <div>
          <div style={{fontSize:10,fontWeight:700,color:"#475569",textTransform:"uppercase",marginBottom:6}}>Landing Gear Overhauls</div>
          {lgItems.map(([label,g])=>{
            const days=daysFromNow(g?.nextDue);
            const col=days===null?"#475569":days<0?"#f87171":days<365?"#fbbf24":"#34d399";
            const bg=days===null?"transparent":days<0?"#2a0e0e":days<365?"#2a1f0a":"#0a1a0a";
            return<div key={label} className="flj" style={{padding:"5px 0",borderBottom:"1px solid #0f2030"}}>
              <span style={{fontSize:12,color:"#94a3b8"}}>{label}</span>
              <span className="pill" style={{background:bg,color:col,fontSize:11}}>{g?.nextDue?`${fmtDate(g.nextDue)}${days!==null?` (${days<0?Math.abs(days)+"d overdue":days+"d"})`:""}`:"Not entered"}</span>
            </div>;
          })}
        </div>
        <div style={{marginTop:10,paddingTop:8,borderTop:"1px solid #1e3048"}}>
          <div className="flj"><span style={{fontSize:11,color:"#475569"}}>Last Report</span><span style={{fontSize:11,fontWeight:600,color:asset._lastPeriod?"#e2e8f0":"#f87171"}}>{asset._lastPeriod||"None"}</span></div>
        </div>
      </div>
    </div>
  );
};

function ShopVisitEditor({eng,engIdx,asset,isAdmin,saveAsset,notify}){
  const[adding,setAdding]=useState(false);
  const[newSV,setNewSV]=useState({details:"",date:"",fh:"",fc:"",mro:""});
  const saveSV=async()=>{
    const engines=JSON.parse(JSON.stringify(asset.engines||[]));
    engines[engIdx].shopVisits=[...(engines[engIdx].shopVisits||[]),{...newSV,fh:parseHHMM(newSV.fh),fc:+newSV.fc}];
    await saveAsset({...asset,engines});
    setAdding(false);setNewSV({details:"",date:"",fh:"",fc:"",mro:""});notify("Shop visit added");
  };
  const delSV=async(si)=>{
    if(!confirm("Delete shop visit?"))return;
    const engines=JSON.parse(JSON.stringify(asset.engines||[]));
    engines[engIdx].shopVisits.splice(si,1);
    await saveAsset({...asset,engines});notify("Deleted");
  };
  return(
    <div>
      <div className="flj" style={{marginBottom:8}}>
        <div style={{fontSize:10,fontWeight:700,color:"#475569",textTransform:"uppercase",letterSpacing:"0.05em"}}>Shop Visit History</div>
        <button className="btn btn-primary" style={{fontSize:11,padding:"4px 10px"}} onClick={()=>setAdding(true)}>+ Add Visit</button>
      </div>
      {(()=>{const svs=eng.shopVisits||[];if(!svs.length)return null;const last=svs[svs.length-1];const sinceFH=eng.currentFH&&last.fh?eng.currentFH-last.fh:null;const sinceFC=eng.currentFC&&last.fc?eng.currentFC-last.fc:null;const sinceDays=last.date?Math.floor((new Date()-new Date(last.date))/86400000):null;return(<div style={{background:"#0a1a2a",border:"1px solid #1B3A6B",borderRadius:6,padding:"10px 12px",marginBottom:10}}><div style={{fontSize:9,color:"#C9A84C",fontWeight:700,textTransform:"uppercase",marginBottom:6}}>Since Last Shop Visit</div><div className="grid3" style={{gap:8}}><div><div style={{fontSize:9,color:"#475569"}}>Days</div><div style={{fontSize:14,fontWeight:700,color:"#C9A84C",fontFamily:"monospace"}}>{sinceDays!==null?sinceDays.toLocaleString():"—"}</div></div><div><div style={{fontSize:9,color:"#475569"}}>FH</div><div style={{fontSize:14,fontWeight:700,color:"#C9A84C",fontFamily:"monospace"}}>{sinceFH!==null?fmtHHMM(sinceFH):"—"}</div></div><div><div style={{fontSize:9,color:"#475569"}}>FC</div><div style={{fontSize:14,fontWeight:700,color:"#C9A84C",fontFamily:"monospace"}}>{sinceFC!==null?sinceFC.toLocaleString():"—"}</div></div></div></div>);})()}
      <table><thead><tr><th>Details</th><th>Date</th><th>TSN</th><th>CSN</th><th>MRO</th><th></th></tr></thead>
      <tbody>{eng.shopVisits?.length?eng.shopVisits.map((sv,si)=>(
        <tr key={si}>
          <td style={{fontWeight:500}}>{sv.details}</td><td>{fmtDate(sv.date)}</td>
          <td style={{fontFamily:"monospace"}}>{fmtHHMM(sv.fh)}</td><td style={{fontFamily:"monospace"}}>{sv.fc?.toLocaleString()}</td>
          <td style={{color:"#94a3b8"}}>{sv.mro}</td>
          <td><button className="btn-danger btn" style={{fontSize:10,padding:"2px 6px"}} onClick={()=>delSV(si)}>✕</button></td>
        </tr>
      )):<tr><td colSpan={isAdmin?6:5} style={{color:"#475569",fontStyle:"italic"}}>No shop visits recorded</td></tr>}</tbody></table>
      {adding&&(
        <div style={{background:"#0d1925",borderRadius:6,padding:12,marginTop:8,border:"1px solid #1e3048"}}>
          <div className="grid3" style={{gap:6,marginBottom:8}}>
            <div style={{gridColumn:"1/-1"}}><label className="form-label">Details / Description</label><input value={newSV.details} onChange={e=>setNewSV({...newSV,details:e.target.value})}/></div>
            {[["Date","date","date"],["TSN (HH:MM)","fh","text"],["CSN","fc","number"],["MRO Facility","mro","text"]].map(([l,k,t])=>(
              <div key={k}><label className="form-label">{l}</label><input type={t} value={newSV[k]} onChange={e=>setNewSV({...newSV,[k]:e.target.value})}/></div>
            ))}
          </div>
          <div className="flab g8"><button className="btn btn-ghost" onClick={()=>setAdding(false)}>Cancel</button><button className="btn btn-gold" onClick={saveSV}>Add Visit</button></div>
        </div>
      )}
    </div>
  );
};

function EnginesTab({asset,isAdmin,saveAsset,notify}){
  const[editIdx,setEditIdx]=useState(null);
  const[form,setForm]=useState(null);
  const[addLLPIdx,setAddLLPIdx]=useState(null);
  const[newLLP,setNewLLP]=useState({desc:"",pn:"",sn:"",startFCRem:0,refFC:0,approvedLife:""});
  const patchEngines=async(engines)=>{await saveAsset({...asset,engines});};
  const saveEngineEdit=async()=>{const engines=[...asset.engines];engines[editIdx]=form;await patchEngines(engines);setEditIdx(null);setForm(null);notify("Engine saved");};
  const doAddLLP=async(ei)=>{const engines=JSON.parse(JSON.stringify(asset.engines));engines[ei].llps=[...(engines[ei].llps||[]),{...newLLP,startFCRem:+newLLP.startFCRem,refFC:+newLLP.refFC,approvedLife:newLLP.approvedLife===""?null:+newLLP.approvedLife}];await patchEngines(engines);setAddLLPIdx(null);setNewLLP({desc:"",pn:"",sn:"",startFCRem:0,refFC:0,approvedLife:""});notify("LLP added");};
  const delLLP=async(ei,li)=>{if(!confirm("Delete?"))return;const engines=JSON.parse(JSON.stringify(asset.engines));engines[ei].llps.splice(li,1);await patchEngines(engines);notify("LLP deleted");};
  return(
    <div style={{display:"flex",flexDirection:"column",gap:20}}>
      {(asset.engines||[]).map((eng,ei)=>{
        const ll=lowestLimiter(eng);const isEditing=editIdx===ei;const ed=isEditing?form:eng;
        return(
          <div key={ei} className="card" style={{padding:20}}>
            <div className="flj" style={{marginBottom:14}}>
              <div className="flab" style={{gap:10}}>
                <div className="section-title" style={{margin:0}}>Engine #{eng.position||ei+1} — ESN {eng.sn||"TBD"}</div>
                {eng.atShop&&<span style={{fontSize:11,color:"#f87171"}}>🔧 At shop</span>}
              </div>
              <div className="flab g8">
                <button className="btn btn-gold" style={{fontSize:12,padding:"8px 16px"}} onClick={async()=>{
                  const isCFMEng=(eng.type||"").toUpperCase().includes("CFM");
                  const photoKey=isCFMEng?"engine_photo_cfm56":"engine_photo_v2500";
                  const engPhoto=await db.getSetting(photoKey).catch(()=>null)||"";
                  const logo=await getTechSpecLogo();
                  const defaultDisclaimer=await getDefaultDisclaimer();
                  const base=buildTechSpecHTML({...asset,engines:[eng],_engineOnly:true,_enginePos:eng.position||ei+1},engPhoto,logo,defaultDisclaimer);
                  const withBar=base.replace('<body>',`<body><div style="position:fixed;top:0;left:0;right:0;background:#1B3A6B;padding:10px 20px;display:flex;gap:10px;align-items:center;z-index:999;box-shadow:0 2px 8px rgba(0,0,0,0.3)"><span style="color:#C9A84C;font-weight:700;font-size:14px;flex:1">TailiQ — Engine Spec ESN ${eng.sn||"—"}</span><button onclick="window.print()" style="background:#C9A84C;color:#0a1520;border:none;border-radius:6px;padding:8px 20px;font-size:13px;font-weight:700;cursor:pointer">🖨 Print / Save PDF</button><button onclick="window.close()" style="background:transparent;color:#94a3b8;border:1px solid #2d3f55;border-radius:6px;padding:8px 16px;font-size:13px;cursor:pointer">✕ Close</button></div><div style="height:52px"></div>`);
                  const withPrint=withBar.replace('</style>','@media print{body>div:first-child{display:none!important}div[style*="height:52px"]{display:none!important}}</style>');
                  const win=window.open();win.document.write(withPrint);win.document.close();
                }}>📋 Generate Tech Spec</button>
                {isAdmin&&!isEditing&&<button className="btn btn-ghost" onClick={()=>{const f=JSON.parse(JSON.stringify(eng));if(!f.thrust)f.thrust="27K";setForm(f);setEditIdx(ei);}}>Edit</button>}
                {isAdmin&&isEditing&&<><button className="btn btn-ghost" onClick={()=>{setEditIdx(null);setForm(null);}}>Cancel</button><button className="btn btn-gold" onClick={saveEngineEdit}>Save</button></>}
              </div>
            </div>
            <div className="grid4" style={{marginBottom:14}}>
              {[["S/N","sn"],["Type","type"],["Thrust","thrust"],["Status","status"]].map(([l,k])=>(
                <div key={k} style={{background:"#0d1925",borderRadius:6,padding:"8px 10px"}}>
                  <div style={{fontSize:9,color:"#475569"}}>{l}</div>
                  {isEditing&&isAdmin?<input value={ed[k]||""} onChange={e=>setForm({...form,[k]:e.target.value})} style={{marginTop:3}}/>
                  :<div style={{fontSize:12,fontWeight:600,color:isEmpty(eng[k])?"#475569":"#e2e8f0",marginTop:3}}>{eng[k]||"—"}</div>}
                </div>
              ))}

            </div>
            <div className="grid4" style={{marginBottom:14}}>
              {[["TSN",fmtHHMM(eng.currentFH)],["CSN",(eng.currentFC||0).toLocaleString()],["FH/FC",eng.currentFH&&eng.currentFC?(eng.currentFH/eng.currentFC).toFixed(2):"—"],["Lowest LLP",ll!==null?`${ll.toLocaleString()} FC`:"No data"]].map(([l,v])=>(
                <div key={l} style={{background:"#0d1925",borderRadius:6,padding:"8px 10px"}}>
                  <div style={{fontSize:9,color:"#475569"}}>{l}</div>
                  <div style={{fontSize:14,fontWeight:700,fontFamily:"monospace",color:l==="Lowest LLP"?(ll===null?"#475569":ll<1000?"#f87171":ll<3000?"#fbbf24":"#34d399"):"#C9A84C"}}>{v}</div>
                </div>
              ))}
            </div>
            {eng.atShop&&eng.titleEngine&&(
              <div style={{background:"#1a1306",border:"1px solid #92660a",borderRadius:6,padding:"10px 12px",marginBottom:16}}>
                <div style={{fontSize:10,fontWeight:700,color:"#fbbf24",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:8}}>🔧 Title Engine — Removed {fmtDate(eng.titleEngine.removedDate)}</div>
                <div className="grid4" style={{gap:8}}>
                  {[["S/N",eng.titleEngine.sn],["Type",eng.titleEngine.type||"—"],["TSN at Removal",fmtHHMM(eng.titleEngine.currentFH)],["CSN at Removal",(eng.titleEngine.currentFC||0).toLocaleString()]].map(([l,v])=>(
                    <div key={l} style={{background:"#0d1925",borderRadius:6,padding:"6px 8px"}}>
                      <div style={{fontSize:9,color:"#475569"}}>{l}</div>
                      <div style={{fontSize:12,fontWeight:600,color:"#e2e8f0"}}>{v}</div>
                    </div>
                  ))}
                </div>
                {eng.titleEngine.reason&&<div style={{fontSize:11,color:"#94a3b8",marginTop:8}}>Reason: {eng.titleEngine.reason}</div>}
                {isAdmin&&<div className="flab g8" style={{marginTop:10}}>
                  <button className="btn btn-gold" style={{fontSize:11,padding:"4px 10px"}} onClick={async()=>{
                    const engines=JSON.parse(JSON.stringify(asset.engines));
                    engines[ei]={...engines[ei],atShop:false,titleEngine:null};
                    await patchEngines(engines);notify("Engine returned to service");
                  }}>✓ Engine Returned</button>
                  <button className="btn btn-ghost" style={{fontSize:11,padding:"4px 10px"}} onClick={async()=>{
                    if(!confirm("Confirm this engine is permanently replaced? The title engine record will be cleared."))return;
                    const engines=JSON.parse(JSON.stringify(asset.engines));
                    engines[ei]={...engines[ei],atShop:false,titleEngine:null};
                    await patchEngines(engines);notify("Confirmed permanent replacement");
                  }}>Confirm Permanent</button>
                </div>}
              </div>
            )}
            <div style={{marginBottom:16}}>
              <div className="flj" style={{marginBottom:8}}>
                <div style={{fontSize:10,fontWeight:700,color:"#475569",textTransform:"uppercase",letterSpacing:"0.05em"}}>Life Limited Parts</div>
                {isAdmin&&<div className="flab g8">
  {eng.llps?.length>0&&<button className="btn btn-danger" style={{fontSize:11,padding:"4px 10px"}} onClick={async()=>{if(!confirm("Delete all LLPs for this engine?"))return;const engines=JSON.parse(JSON.stringify(asset.engines||[]));engines[ei].llps=[];await patchEngines(engines);notify("All LLPs deleted");}}>Clear All LLPs</button>}
  <button className="btn btn-primary" style={{fontSize:11,padding:"4px 10px"}} onClick={()=>setAddLLPIdx(ei)}>+ Add LLP</button>
</div>}
              </div>
              {ed.llps?.length?(
                <table><thead><tr><th>Descriptor</th><th>P/N</th><th>S/N</th><th>FC Remaining{isEditing&&<span style={{fontSize:9,color:"#64748b",fontWeight:400,marginLeft:4}}>(editable)</span>}</th><th></th></tr></thead>
                <tbody>{ed.llps.map((llp,li)=>{const rem=calcLLPRem(llp,ed.currentFC);return(
                  <tr key={li} style={{background:rem<1000?"#1a0a0a":rem<3000?"#1a150a":"transparent"}}>
                    <td style={{fontWeight:500}}>{llp.desc}</td><td style={{fontFamily:"monospace",fontSize:11}}>{llp.pn}</td><td style={{fontFamily:"monospace",fontSize:11}}>{llp.sn}</td>
                    <td>{isEditing&&isAdmin
                      ?<input type="number" defaultValue={rem} style={{width:90,padding:"3px 6px",fontSize:12}} onBlur={e=>{const newRem=+e.target.value;const curFC=ed.currentFC||0;const newStart=newRem+(curFC-llp.refFC);const updLLPs=JSON.parse(JSON.stringify(form.llps));updLLPs[li].startFCRem=newStart;setForm({...form,llps:updLLPs});}}/>
                      :<span style={{fontWeight:700,color:rem<1000?"#f87171":rem<3000?"#fbbf24":"#34d399"}}>{rem.toLocaleString()}</span>
                    }</td>
                    {isAdmin&&<td><button className="btn-danger btn" style={{fontSize:10,padding:"2px 6px"}} onClick={()=>delLLP(ei,li)}>✕</button></td>}
                  </tr>
                );})}</tbody></table>
              ):<div style={{color:"#475569",fontSize:12,fontStyle:"italic",padding:"6px 0"}}>No LLP data entered yet.</div>}
              {addLLPIdx===ei&&(
                <div style={{background:"#0d1925",borderRadius:6,padding:12,marginTop:8,border:"1px solid #1e3048"}}>
                  <div className="grid3" style={{gap:6,marginBottom:8}}>
                    {[["Descriptor","desc","text"],["P/N","pn","text"],["S/N","sn","text"],["Starting FC Rem","startFCRem","number"],["Reference FC","refFC","number"],["Approved Life","approvedLife","number"]].map(([l,k,t])=>(
                      <div key={k}><label className="form-label">{l}</label><input type={t} value={newLLP[k]} onChange={e=>setNewLLP({...newLLP,[k]:e.target.value})}/></div>
                    ))}
                  </div>
                  <div className="flab g8"><button className="btn btn-ghost" onClick={()=>setAddLLPIdx(null)}>Cancel</button><button className="btn btn-gold" onClick={()=>doAddLLP(ei)}>Add LLP</button></div>
                </div>
              )}
            </div>
            <ShopVisitEditor eng={eng} engIdx={ei} asset={asset} isAdmin={isAdmin} saveAsset={saveAsset} notify={notify}/>
          </div>
        );
      })}
    </div>
  );
};

function GearCard({title,gkey,asset,form,editing,isAdmin,set,setForm,af}){
  const g=(editing?form:asset).landingGear?.[gkey]||{};
  const fromDDMMYYYY=(s)=>{if(!s)return"";const m=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);if(m)return m[3]+"-"+m[2]+"-"+m[1];return s;};
  const toDDMMYYYY=(s)=>{if(!s)return"";if(/^\d{2}\/\d{2}\/\d{4}$/.test(s))return s;try{const dt=new Date(s);if(isNaN(dt))return s||"";return String(dt.getDate()).padStart(2,"0")+"/"+String(dt.getMonth()+1).padStart(2,"0")+"/"+dt.getFullYear();}catch{return s||"";}};
  const fmtDigits=(raw)=>{const n=raw.replace(/\D/g,"").slice(0,8);if(n.length<=2)return n;if(n.length<=4)return n.slice(0,2)+"/"+n.slice(2);return n.slice(0,2)+"/"+n.slice(2,4)+"/"+n.slice(4);};
  const plusYears=(s,yrs)=>{const m=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);if(!m)return"";return m[1]+"/"+m[2]+"/"+(+m[3]+(+yrs||10));};
  const intervalYears=g.overhaulIntervalYears!=null?g.overhaulIntervalYears:10;
  const intervalCycles=g.overhaulIntervalCycles!=null?g.overhaulIntervalCycles:20000;
  const[lastDateVal,setLastDateVal]=useState(toDDMMYYYY(g.lastOverhaulDate)||"");
  const[nextDueVal,setNextDueVal]=useState(toDDMMYYYY(g.nextDue)||"");
  useEffect(()=>{if(!editing){setLastDateVal(toDDMMYYYY(g.lastOverhaulDate)||"");setNextDueVal(toDDMMYYYY(g.nextDue)||"");}},[editing]);
  const handleLastDateChange=(raw)=>{const fmt=fmtDigits(raw);setLastDateVal(fmt);if(/^\d{2}\/\d{2}\/\d{4}$/.test(fmt))setNextDueVal(plusYears(fmt,intervalYears));else if(fmt==="")setNextDueVal("");};
  const handleLastDateBlur=(val)=>{
    if(/^\d{2}\/\d{2}\/\d{4}$/.test(val)){
      const n=plusYears(val,intervalYears);
      setNextDueVal(n);
      // Write both fields in one operation to avoid stale form snapshot
      const f=JSON.parse(JSON.stringify(form));
      if(!f.landingGear)f.landingGear={};
      if(!f.landingGear[gkey])f.landingGear[gkey]={};
      f.landingGear[gkey].lastOverhaulDate=val;
      f.landingGear[gkey].nextDue=n;
      setForm(f);
    } else if(val===""){
      // Deleting the last overhaul date must also clear the derived Next Due —
      // otherwise a stale auto-calculated date persists in data and tech spec.
      setNextDueVal("");
      const f=JSON.parse(JSON.stringify(form));
      if(!f.landingGear)f.landingGear={};
      if(!f.landingGear[gkey])f.landingGear[gkey]={};
      f.landingGear[gkey].lastOverhaulDate="";
      f.landingGear[gkey].nextDue="";
      setForm(f);
    } else {
      set("landingGear."+gkey+".lastOverhaulDate",val);
    }
  };
  const handleNextDueChange=(raw)=>setNextDueVal(fmtDigits(raw));
  const handleNextDueBlur=(val)=>{if(/^\d{2}\/\d{2}\/\d{4}$/.test(val))set("landingGear."+gkey+".nextDue",val);};
  const handleIntervalYearsBlur=(raw)=>{
    const yrs=raw===""?10:+raw;
    const f=JSON.parse(JSON.stringify(form));
    if(!f.landingGear)f.landingGear={};
    if(!f.landingGear[gkey])f.landingGear[gkey]={};
    f.landingGear[gkey].overhaulIntervalYears=yrs;
    if(/^\d{2}\/\d{2}\/\d{4}$/.test(lastDateVal)){
      const n=plusYears(lastDateVal,yrs);
      f.landingGear[gkey].nextDue=n;
      setNextDueVal(n);
    }
    setForm(f);
  };

  // Current totals: ground truth override (Gear Status Report) always wins;
  // otherwise calculate from the Reference Reading — any matched leg+airframe
  // pair taken at the same moment. This is deliberately independent of the
  // Last Overhaul Record below: a reference reading does NOT need to be from
  // an overhaul, and using it for the overhaul-cycles countdown would give a
  // wrong baseline (it wouldn't be counting from a genuine 0-since-overhaul
  // point). The two are separate inputs that may or may not share a date.
  const hasRefPair=g.refLegFC!=null&&g.refAirframeFC!=null;
  let current=null;
  if(g.currentFC!=null){
    current={fh:g.currentFH,fc:g.currentFC,source:"Ground Truth"};
  } else if(hasRefPair){
    const fh=(g.refLegFH||0)+((af.currentFH||0)-(g.refAirframeFH||0));
    const fc=g.refLegFC+((af.currentFC||0)-g.refAirframeFC);
    current={fh,fc,source:"Calculated"};
  }

  const activeDateStr=editing?lastDateVal:(toDDMMYYYY(g.lastOverhaulDate)||"");
  const activeNextDue=editing?nextDueVal:(toDDMMYYYY(g.nextDue)||"");
  // "Since Last Overhaul" diffs the leg's CURRENT total (however that was
  // derived above) against the leg's own CSN at the last overhaul — both on
  // the same leg-CSN scale, so no airframe figure is needed here at all.
  const daysSince=activeDateStr&&/^\d{2}\/\d{2}\/\d{4}$/.test(activeDateStr)?Math.floor((new Date()-new Date(fromDDMMYYYY(activeDateStr)))/86400000):null;
  const sinceFH=(current&&current.fh!=null&&g.lastOverhaulFH!=null)?current.fh-g.lastOverhaulFH:null;
  const sinceFC=(current&&current.fc!=null&&g.lastOverhaulFC!=null)?current.fc-g.lastOverhaulFC:null;

  // Next Overhaul Due — dual limiter, lowest-wins, same pattern as LLPs:
  // a calendar limit (default 10yr from last overhaul) AND a cycle limit
  // (default 20,000 from the leg's CSN at last overhaul), whichever is more
  // restrictive. Cycles remaining is anchored to the Last Overhaul Record,
  // never to the Reference Reading.
  const calDays=daysFromNow(fromDDMMYYYY(activeNextDue));
  const cyclesRemaining=(g.lastOverhaulFC!=null&&current&&current.fc!=null)?(g.lastOverhaulFC+intervalCycles)-current.fc:null;
  const calStatus=calDays===null?null:calDays<0?"critical":calDays<365?"warn":"ok";
  const cycStatus=cyclesRemaining===null?null:cyclesRemaining<1000?"critical":cyclesRemaining<3000?"warn":"ok";
  const sevRank={critical:0,warn:1,ok:2};
  const bothStatus=[calStatus,cycStatus].filter(Boolean);
  const overallStatus=bothStatus.length?bothStatus.sort((a,b)=>sevRank[a]-sevRank[b])[0]:null;
  const statusColor={critical:"#f87171",warn:"#fbbf24",ok:"#34d399"};
  const statusBg={critical:"#2a0e0e",warn:"#2a1f0a",ok:"#0a1520"};

  return(
    <div className="card" style={{padding:18}}>
      <div className="section-title">{title}{g.atShop&&" 🔧"}</div>
      {[["mfr","Manufacturer"],["pn","Part Number"],["sn","Serial Number"]].map(([k,l])=>(
        <div key={k} className="form-group">
          <label className="form-label">{l}</label>
          {editing&&isAdmin?<input value={g[k]||""} onChange={e=>set("landingGear."+gkey+"."+k,e.target.value)}/>
          :<div style={{fontSize:13,fontWeight:500,color:isEmpty(g[k])?"#475569":"#e2e8f0"}}>{g[k]||"Not entered"}</div>}
        </div>
      ))}

      {editing&&isAdmin&&(
      <>
      <div style={{fontSize:10,fontWeight:700,color:"#475569",textTransform:"uppercase",marginBottom:6,marginTop:4}}>Reference Reading</div>
      <div style={{fontSize:10,color:"#64748b",marginBottom:6,fontStyle:"italic"}}>Any matched leg + airframe reading taken at the same moment — doesn't need to be from an overhaul. Used only to calculate current totals below.</div>
      <div className="grid2" style={{gap:6,marginBottom:10}}>
        <div><label className="form-label">Leg TSN at Reference</label>
          <input type="number" value={g.refLegFH??""} onChange={e=>set("landingGear."+gkey+".refLegFH",e.target.value===""?null:+e.target.value)}/>
        </div>
        <div><label className="form-label">Leg CSN at Reference</label>
          <input type="number" value={g.refLegFC??""} onChange={e=>set("landingGear."+gkey+".refLegFC",e.target.value===""?null:+e.target.value)}/>
        </div>
        <div><label className="form-label">Airframe TSN at Reference</label>
          <input type="number" value={g.refAirframeFH??""} onChange={e=>set("landingGear."+gkey+".refAirframeFH",e.target.value===""?null:+e.target.value)}/>
        </div>
        <div><label className="form-label">Airframe CSN at Reference</label>
          <input type="number" value={g.refAirframeFC??""} onChange={e=>set("landingGear."+gkey+".refAirframeFC",e.target.value===""?null:+e.target.value)}/>
        </div>
      </div>
      </>
      )}

      <div style={{fontSize:10,fontWeight:700,color:"#475569",textTransform:"uppercase",marginBottom:6}}>Last Overhaul Record</div>
      {editing&&isAdmin&&<div style={{fontSize:10,color:"#64748b",marginBottom:6,fontStyle:"italic"}}>The actual overhaul — drives Next Overhaul Due below. Must be the genuine overhaul event, not just any reading.</div>}
      <div className="grid2" style={{gap:6,marginBottom:6}}>
        <div><label className="form-label">Date (DDMMYYYY)</label>
          {editing&&isAdmin
            ?<input type="text" placeholder="DDMMYYYY" value={lastDateVal} onChange={e=>handleLastDateChange(e.target.value)} onBlur={e=>handleLastDateBlur(e.target.value)}/>
            :<div style={{fontSize:13,fontWeight:500,color:isEmpty(activeDateStr)?"#475569":"#e2e8f0"}}>{activeDateStr||"Not entered"}</div>}
        </div>
        <div/>
        <div><label className="form-label">Leg TSN at Overhaul</label>
          {editing&&isAdmin?<input type="number" value={g.lastOverhaulFH??""} onChange={e=>set("landingGear."+gkey+".lastOverhaulFH",e.target.value===""?null:+e.target.value)}/>
          :<div style={{fontSize:13,fontWeight:500,color:isEmpty(g.lastOverhaulFH)?"#475569":"#e2e8f0"}}>{g.lastOverhaulFH!=null?fmtHHMM(g.lastOverhaulFH):"Not entered"}</div>}
        </div>
        <div><label className="form-label">Leg CSN at Overhaul</label>
          {editing&&isAdmin?<input type="number" value={g.lastOverhaulFC??""} onChange={e=>set("landingGear."+gkey+".lastOverhaulFC",e.target.value===""?null:+e.target.value)}/>
          :<div style={{fontSize:13,fontWeight:500,color:isEmpty(g.lastOverhaulFC)?"#475569":"#e2e8f0"}}>{g.lastOverhaulFC!=null?g.lastOverhaulFC.toLocaleString():"Not entered"}</div>}
        </div>
      </div>

      <div style={{background:overallStatus?statusBg[overallStatus]:"#0a1520",borderRadius:6,padding:"8px 10px",marginBottom:10}}>
        <div style={{fontSize:9,color:"#475569",textTransform:"uppercase",marginBottom:4,textAlign:"center"}}>Next Overhaul Due — Lowest Wins</div>
        <div className="grid2" style={{gap:6}}>
          <div style={{textAlign:"center"}}>
            <div style={{fontSize:9,color:"#475569"}}>Calendar ({editing&&isAdmin?<input type="number" value={intervalYears} onChange={e=>handleIntervalYearsBlur(e.target.value)} style={{width:32,fontSize:9,padding:"1px 2px"}}/>:intervalYears}yr)</div>
            {editing&&isAdmin
              ?<input type="text" placeholder="DDMMYYYY" value={nextDueVal} onChange={e=>handleNextDueChange(e.target.value)} onBlur={e=>handleNextDueBlur(e.target.value)} style={{textAlign:"center",fontWeight:700,fontSize:13,width:"100%"}}/>
              :<div style={{fontSize:13,fontWeight:700,color:calStatus?statusColor[calStatus]:"#475569"}}>{activeNextDue||"Not entered"}</div>}
            {calDays!==null&&<div style={{fontSize:9,color:"#64748b"}}>{calDays<0?Math.abs(calDays)+"d overdue":calDays+"d remaining"}</div>}
          </div>
          <div style={{textAlign:"center"}}>
            <div style={{fontSize:9,color:"#475569"}}>Cycles ({editing&&isAdmin?<input type="number" value={intervalCycles} onChange={e=>set("landingGear."+gkey+".overhaulIntervalCycles",e.target.value===""?20000:+e.target.value)} style={{width:48,fontSize:9,padding:"1px 2px"}}/>:intervalCycles.toLocaleString()})</div>
            <div style={{fontSize:13,fontWeight:700,color:cycStatus?statusColor[cycStatus]:"#475569"}}>{cyclesRemaining!==null?Math.round(cyclesRemaining).toLocaleString():"No data"}</div>
            {cyclesRemaining!==null&&<div style={{fontSize:9,color:"#64748b"}}>cycles remaining</div>}
          </div>
        </div>
      </div>

      {(sinceFH!=null||sinceFC!=null||activeDateStr)&&<div style={{background:"#0d1925",borderRadius:6,padding:"8px 10px",marginBottom:10}}>
        <div style={{fontSize:9,color:"#475569",textTransform:"uppercase",marginBottom:4}}>Since Last Overhaul</div>
        <div className="grid3" style={{gap:4}}>
          <div><div style={{fontSize:9,color:"#475569"}}>Days</div><div style={{fontSize:12,fontWeight:700,color:"#C9A84C",fontFamily:"monospace"}}>{daysSince!==null?daysSince.toLocaleString():"—"}</div></div>
          <div><div style={{fontSize:9,color:"#475569"}}>FH</div><div style={{fontSize:12,fontWeight:700,color:"#C9A84C",fontFamily:"monospace"}}>{sinceFH!=null?fmtHHMM(sinceFH):"—"}</div></div>
          <div><div style={{fontSize:9,color:"#475569"}}>FC</div><div style={{fontSize:12,fontWeight:700,color:"#C9A84C",fontFamily:"monospace"}}>{sinceFC!=null?Math.round(sinceFC).toLocaleString():"—"}</div></div>
        </div>
      </div>}

      <div style={{fontSize:10,fontWeight:700,color:"#475569",textTransform:"uppercase",marginBottom:6}}>Current Totals (Since New){current&&<span style={{marginLeft:6,fontSize:9,fontWeight:600,color:current.source==="Ground Truth"?"#34d399":"#60a5fa",textTransform:"none"}}>{current.source}</span>}</div>
      {current?(
        <div className="grid2" style={{gap:8}}>
          {[["TSN",current.fh!=null?fmtHHMM(current.fh):"—"],["CSN",current.fc!=null?Math.round(current.fc).toLocaleString():"—"]].map(([l,v])=>(
            <div key={l} style={{background:"#070f18",border:"1px solid #1B3A6B",borderRadius:8,padding:"12px 14px"}}>
              <div style={{fontSize:9,color:"#475569",fontWeight:700,letterSpacing:"0.08em"}}>{l}</div>
              <div style={{fontSize:20,fontWeight:700,color:"#C9A84C",fontFamily:"monospace",marginTop:4}}>{v}</div>
            </div>
          ))}
        </div>
      ):(
        <div style={{fontSize:11,color:"#475569",fontStyle:"italic"}}>Not entered — enter a Reference Reading (leg + airframe TSN/CSN at the same moment) above to start tracking.</div>
      )}

      <div style={{fontSize:10,fontWeight:700,color:"#475569",textTransform:"uppercase",marginBottom:6,marginTop:12}}>Ground Truth Override <span style={{fontWeight:400,fontSize:9,textTransform:"none"}}>(optional — from Gear Status Report)</span></div>
      <div className="grid2" style={{gap:6}}>
        <div><label className="form-label">Current TSN</label>
          {editing&&isAdmin?<input type="number" value={g.currentFH??""} onChange={e=>set("landingGear."+gkey+".currentFH",e.target.value===""?null:+e.target.value)}/>
          :<div style={{fontSize:13,fontWeight:500,color:isEmpty(g.currentFH)?"#475569":"#e2e8f0"}}>{g.currentFH!=null?fmtHHMM(g.currentFH):"Not entered"}</div>}
        </div>
        <div><label className="form-label">Current CSN</label>
          {editing&&isAdmin?<input type="number" value={g.currentFC??""} onChange={e=>set("landingGear."+gkey+".currentFC",e.target.value===""?null:+e.target.value)}/>
          :<div style={{fontSize:13,fontWeight:500,color:isEmpty(g.currentFC)?"#475569":"#e2e8f0"}}>{g.currentFC!=null?g.currentFC.toLocaleString():"Not entered"}</div>}
        </div>
      </div>
      {editing&&isAdmin&&<div style={{fontSize:9,color:"#475569",marginTop:3}}>When set, this always overrides the calculated figure above — no tolerance check.</div>}
    </div>
  );
};

function WheelsBrakesCard({asset,form,editing,isAdmin,set}){
  const wb=(editing?form:asset).wheelsBrakes||{};
  const items=[["mainWheels","Main Wheels"],["noseWheels","Nose Wheels"],["brakes","Brake Units"]];
  return(
    <div className="card" style={{padding:18,marginTop:16}}>
      <div className="section-title">Wheels &amp; Brakes</div>
      <table><thead><tr><th>Component</th><th>Qty</th><th>P/N</th><th>Manufacturer</th></tr></thead>
      <tbody>
        {items.map(([key,label])=>{
          const item=wb[key]||{};
          return(
            <tr key={key}>
              <td style={{fontWeight:600,color:"#94a3b8"}}>{label}</td>
              <td style={{fontFamily:"monospace"}}>{editing&&isAdmin?<input type="number" defaultValue={item.qty||""} onBlur={e=>set("wheelsBrakes."+key+".qty",e.target.value?+e.target.value:null)} style={{width:60}}/>:item.qty??"—"}</td>
              <td>{editing&&isAdmin?<input type="text" defaultValue={item.pn||""} onBlur={e=>set("wheelsBrakes."+key+".pn",e.target.value)} style={{width:140}}/>:item.pn||"—"}</td>
              <td>{editing&&isAdmin?<input type="text" defaultValue={item.mfr||""} onBlur={e=>set("wheelsBrakes."+key+".mfr",e.target.value)} style={{width:140}}/>:item.mfr||"—"}</td>
            </tr>
          );
        })}
      </tbody></table>
      <p style={{fontSize:10,color:"#475569",marginTop:8}}>P/N and Manufacturer are optional — the tech spec only shows rows where at least one is entered.</p>
    </div>
  );
};

function LandingGearTab({asset,isAdmin,saveAsset,notify}){
  const[editing,setEditing]=useState(false);
  const[form,setForm]=useState(null);
  const af=asset.airframe||{};
  const startEdit=()=>{setForm(JSON.parse(JSON.stringify(asset)));setEditing(true);};
  const cancel=()=>{setForm(null);setEditing(false);};
  const save=async()=>{
    await saveAsset(form);setEditing(false);setForm(null);notify("Saved");
  };
  const set=(path,val)=>{const f=JSON.parse(JSON.stringify(form));const parts=path.split(".");let obj=f;for(let i=0;i<parts.length-1;i++){if(!obj[parts[i]])obj[parts[i]]={};obj=obj[parts[i]];}obj[parts[parts.length-1]]=val;setForm(f);};
  return(
    <div>
      <div className="flj" style={{marginBottom:14}}>
        <div/>
        {isAdmin&&!editing&&<button className="btn btn-ghost" onClick={startEdit}>Edit</button>}
        {isAdmin&&editing&&<div className="flab g8"><button className="btn btn-ghost" onClick={cancel}>Cancel</button><button className="btn btn-gold" onClick={save}>Save</button></div>}
      </div>
      <div className="grid3">
        {[["Nose Landing Gear","nose"],["LH Main Landing Gear","left"],["RH Main Landing Gear","right"]].map(([title,gkey])=>(
          <GearCard key={gkey} title={title} gkey={gkey} asset={asset} form={form} editing={editing} isAdmin={isAdmin} set={set} setForm={setForm} af={af}/>
        ))}
      </div>
      <WheelsBrakesCard asset={asset} form={form} editing={editing} isAdmin={isAdmin} set={set}/>
    </div>
  );
};

function APUTab({asset,isAdmin,saveAsset,notify}){
  const[editing,setEditing]=useState(false);
  const[form,setForm]=useState(null);
  const[addLLP,setAddLLP]=useState(false);
  const[newLLP,setNewLLP]=useState({desc:"",pn:"",sn:"",startFCRem:0,refFC:0,approvedLife:""});
  const[addSV,setAddSV]=useState(false);
  const[editSVIdx,setEditSVIdx]=useState(null);
  const[newSV,setNewSV]=useState({details:"",date:"",fh:"",fc:"",mro:""});
  const[editSVForm,setEditSVForm]=useState(null);
  const apu=asset.apu||{};
  const startEdit=()=>{setForm(JSON.parse(JSON.stringify(asset)));setEditing(true);};
  const cancel=()=>{setForm(null);setEditing(false);};
  const save=async()=>{await saveAsset(form);setEditing(false);setForm(null);notify("Saved");};
  const set=(path,val)=>{const f=JSON.parse(JSON.stringify(form));const parts=path.split(".");let obj=f;for(let i=0;i<parts.length-1;i++){if(!obj[parts[i]])obj[parts[i]]={};obj=obj[parts[i]];}obj[parts[parts.length-1]]=val;setForm(f);};
  const doAddLLP=async()=>{const updated={...asset,apu:{...apu,llps:[...(apu.llps||[]),{...newLLP,startFCRem:+newLLP.startFCRem,refFC:+newLLP.refFC,approvedLife:newLLP.approvedLife===""?null:+newLLP.approvedLife}]}};await saveAsset(updated);setAddLLP(false);setNewLLP({desc:"",pn:"",sn:"",startFCRem:0,refFC:0,approvedLife:""});notify("LLP added");};
  const delLLP=async(li)=>{if(!confirm("Delete?"))return;const llps=[...(apu.llps||[])];llps.splice(li,1);await saveAsset({...asset,apu:{...apu,llps}});notify("LLP deleted");};
  const doAddSV=async()=>{const svs=[...(apu.shopVisits||[]),{...newSV,fh:parseHHMM(newSV.fh),fc:+newSV.fc}];await saveAsset({...asset,apu:{...apu,shopVisits:svs}});setAddSV(false);setNewSV({details:"",date:"",fh:"",fc:"",mro:""});notify("Shop visit added");};
  const delSV=async(si)=>{if(!confirm("Delete shop visit?"))return;const svs=[...(apu.shopVisits||[])];svs.splice(si,1);await saveAsset({...asset,apu:{...apu,shopVisits:svs}});notify("Deleted");};
  const saveEditSV=async(si)=>{const svs=JSON.parse(JSON.stringify(apu.shopVisits||[]));svs[si]={...editSVForm,fh:parseHHMM(editSVForm.fh),fc:+editSVForm.fc};await saveAsset({...asset,apu:{...apu,shopVisits:svs}});setEditSVIdx(null);setEditSVForm(null);notify("Updated");};
  const ll=apu.llps?.length?Math.min(...apu.llps.map(l=>calcLLPRem(l,apu.currentFC))):null;
  const ed=editing?form.apu||{}:apu;
  return(
    <div>
      <div className="flj" style={{marginBottom:14}}>
        <div/>
        {isAdmin&&!editing&&<button className="btn btn-ghost" onClick={startEdit}>Edit</button>}
        {isAdmin&&editing&&<div className="flab g8"><button className="btn btn-ghost" onClick={cancel}>Cancel</button><button className="btn btn-gold" onClick={save}>Save</button></div>}
      </div>
      <div className="card" style={{padding:14,marginBottom:14}}>
        <div className="section-title" style={{fontSize:12,margin:0,marginBottom:10}}>APU — S/N {apu.sn||"TBD"}</div>
        <div className="grid4" style={{marginBottom:14}}>
        {[["Manufacturer","mfr"],["P/N","pn"],["S/N","sn"]].map(([l,k])=>(
          <div key={k} style={{background:"#0d1925",borderRadius:6,padding:"8px 10px"}}>
            <div style={{fontSize:9,color:"#475569"}}>{l}</div>
            {editing&&isAdmin?<input value={ed[k]||""} onChange={e=>set("apu."+k,e.target.value)} style={{marginTop:3}}/>
            :<div style={{fontSize:12,fontWeight:600,color:isEmpty(apu[k])?"#475569":"#e2e8f0",marginTop:3}}>{apu[k]||"—"}</div>}
          </div>
        ))}
        <div style={{background:"#0d1925",borderRadius:6,padding:"8px 10px"}}>
          <div style={{fontSize:9,color:"#475569"}}>TSN</div>
          <div style={{fontSize:14,fontWeight:700,fontFamily:"monospace",color:"#C9A84C"}}>{fmtHHMM(apu.currentFH)}</div>
        </div>
        <div style={{background:"#0d1925",borderRadius:6,padding:"8px 10px"}}>
          <div style={{fontSize:9,color:"#475569"}}>CSN</div>
          <div style={{fontSize:14,fontWeight:700,fontFamily:"monospace",color:"#C9A84C"}}>{(apu.currentFC||0).toLocaleString()}</div>
        </div>
        </div>
        <div style={{background:"#0d1925",borderRadius:6,padding:"8px 10px",display:"inline-block"}}>
          <div style={{fontSize:9,color:"#475569"}}>Lowest LLP Limiter</div>
          <div style={{fontSize:14,fontWeight:700,color:ll===null?"#475569":ll<1000?"#f87171":ll<3000?"#fbbf24":"#34d399",fontFamily:"monospace"}}>{ll!==null?ll.toLocaleString()+" FC":"No data"}</div>
        </div>
      </div>
      <div style={{marginBottom:16}}>
        <div className="flj" style={{marginBottom:8}}>
          <div style={{fontSize:10,fontWeight:700,color:"#475569",textTransform:"uppercase",letterSpacing:"0.05em"}}>Life Limited Parts</div>
          {isAdmin&&<div className="flab g8">{apu.llps?.length>0&&<button className="btn btn-danger" style={{fontSize:11,padding:"4px 10px"}} onClick={async()=>{if(!confirm("Delete all APU LLPs?"))return;await saveAsset({...asset,apu:{...apu,llps:[]}});notify("All APU LLPs deleted");}}>Clear All LLPs</button>}<button className="btn btn-primary" style={{fontSize:11,padding:"4px 10px"}} onClick={()=>setAddLLP(true)}>+ Add LLP</button></div>}
        </div>
        {apu.llps?.length?(
          <table><thead><tr><th>Descriptor</th><th>P/N</th><th>S/N</th><th>FC Remaining</th><th></th></tr></thead>
          <tbody>{apu.llps.map((llp,li)=>{const rem=calcLLPRem(llp,apu.currentFC);return(
            <tr key={li} style={{background:rem<1000?"#1a0a0a":rem<3000?"#1a150a":"transparent"}}>
              <td style={{fontWeight:500}}>{llp.desc}</td><td style={{fontFamily:"monospace",fontSize:11}}>{llp.pn}</td><td style={{fontFamily:"monospace",fontSize:11}}>{llp.sn}</td>
              <td style={{fontWeight:700,color:rem<1000?"#f87171":rem<3000?"#fbbf24":"#34d399"}}>{rem.toLocaleString()}</td>
              {isAdmin&&<td><button className="btn-danger btn" onClick={()=>delLLP(li)}>✕</button></td>}
            </tr>
          );})}</tbody></table>
        ):<div style={{color:"#475569",fontSize:12,fontStyle:"italic",padding:"6px 0"}}>No LLP data entered.</div>}
        {addLLP&&(
          <div style={{background:"#0d1925",borderRadius:6,padding:12,marginTop:8,border:"1px solid #1e3048"}}>
            <div className="grid3" style={{gap:6,marginBottom:8}}>
              {[["Descriptor","desc","text"],["P/N","pn","text"],["S/N","sn","text"],["Starting FC Rem","startFCRem","number"],["Reference FC","refFC","number"],["Approved Life","approvedLife","number"]].map(([l,k,t])=>(
                <div key={k}><label className="form-label">{l}</label><input type={t} value={newLLP[k]} onChange={e=>setNewLLP({...newLLP,[k]:e.target.value})}/></div>
              ))}
            </div>
            <div className="flab g8"><button className="btn btn-ghost" onClick={()=>setAddLLP(false)}>Cancel</button><button className="btn btn-gold" onClick={doAddLLP}>Add LLP</button></div>
          </div>
        )}
      </div>
      <div>
        <div className="flj" style={{fontSize:10,fontWeight:700,color:"#475569",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:8}}>
          <div>Most Recent Shop Visit{apu.shopVisits?.length>1?` (${apu.shopVisits.length} on file)`:""}</div>
          {isAdmin&&<button className="btn btn-primary" style={{fontSize:11,padding:"4px 10px"}} onClick={()=>setAddSV(true)}>+ Add Visit</button>}
        </div>
        {(()=>{const svs=apu.shopVisits||[];if(!svs.length)return null;const last=svs[svs.length-1];const sinceFH=apu.currentFH&&last.fh?apu.currentFH-last.fh:null;const sinceFC=apu.currentFC&&last.fc?apu.currentFC-last.fc:null;const sinceDays=last.date?Math.floor((new Date()-new Date(last.date))/86400000):null;return(<div style={{background:"#0a1a2a",border:"1px solid #1B3A6B",borderRadius:6,padding:"10px 12px",marginBottom:10}}><div style={{fontSize:9,color:"#C9A84C",fontWeight:700,textTransform:"uppercase",marginBottom:6}}>Since Last Shop Visit</div><div className="grid3" style={{gap:8}}><div><div style={{fontSize:9,color:"#475569"}}>Days</div><div style={{fontSize:14,fontWeight:700,color:"#C9A84C",fontFamily:"monospace"}}>{sinceDays!==null?sinceDays.toLocaleString():"—"}</div></div><div><div style={{fontSize:9,color:"#475569"}}>FH</div><div style={{fontSize:14,fontWeight:700,color:"#C9A84C",fontFamily:"monospace"}}>{sinceFH!==null?fmtHHMM(sinceFH):"—"}</div></div><div><div style={{fontSize:9,color:"#475569"}}>FC</div><div style={{fontSize:14,fontWeight:700,color:"#C9A84C",fontFamily:"monospace"}}>{sinceFC!==null?sinceFC.toLocaleString():"—"}</div></div></div></div>);})()}
        <table><thead><tr><th>Details</th><th>Date</th><th>TSN</th><th>CSN</th><th>MRO</th>{isAdmin&&<th></th>}</tr></thead>
        <tbody>{(()=>{const svs=apu.shopVisits||[];if(!svs.length)return<tr><td colSpan={isAdmin?6:5} style={{color:"#475569",fontStyle:"italic"}}>No shop visits recorded</td></tr>;const si=svs.length-1;const sv=svs[si];return editSVIdx===si?(
            <tr style={{background:"#0d1925"}}>
              <td><input defaultValue={editSVForm.details} onBlur={e=>setEditSVForm({...editSVForm,details:e.target.value})} style={{width:"100%"}}/></td>
              <td><input type="date" defaultValue={editSVForm.date} onBlur={e=>setEditSVForm({...editSVForm,date:e.target.value})} style={{width:130}}/></td>
              <td><input defaultValue={editSVForm.fh||""} onBlur={e=>setEditSVForm({...editSVForm,fh:e.target.value})} style={{width:80}}/></td>
              <td><input type="number" defaultValue={editSVForm.fc||""} onBlur={e=>setEditSVForm({...editSVForm,fc:e.target.value})} style={{width:80}}/></td>
              <td><input defaultValue={editSVForm.mro||""} onBlur={e=>setEditSVForm({...editSVForm,mro:e.target.value})} style={{width:100}}/></td>
              <td><div className="flab g8"><button className="btn btn-gold" style={{fontSize:10,padding:"2px 8px"}} onClick={()=>saveEditSV(si)}>Save</button><button className="btn btn-ghost" style={{fontSize:10,padding:"2px 6px"}} onClick={()=>{setEditSVIdx(null);setEditSVForm(null);}}>✕</button></div></td>
            </tr>
          ):(
            <tr>
              <td style={{fontWeight:500}}>{sv.details}</td><td>{fmtDate(sv.date)}</td>
              <td style={{fontFamily:"monospace"}}>{fmtHHMM(sv.fh)}</td><td style={{fontFamily:"monospace"}}>{sv.fc?.toLocaleString()}</td>
              <td style={{color:"#94a3b8"}}>{sv.mro}</td>
              {isAdmin&&<td><div className="flab g8">
                <button className="btn btn-primary" style={{fontSize:10,padding:"2px 6px"}} onClick={()=>{setEditSVIdx(si);setEditSVForm({...sv,fh:fmtHHMM(sv.fh)});}}>Edit</button>
                <button className="btn-danger btn" style={{fontSize:10,padding:"2px 6px"}} onClick={()=>delSV(si)}>✕</button>
              </div></td>}
            </tr>
          );})()}</tbody></table>
        {addSV&&(
          <div style={{background:"#0d1925",borderRadius:6,padding:12,marginTop:8,border:"1px solid #1e3048"}}>
            <div className="grid3" style={{gap:6,marginBottom:8}}>
              <div style={{gridColumn:"1/-1"}}><label className="form-label">Details / Description</label><input value={newSV.details} onChange={e=>setNewSV({...newSV,details:e.target.value})}/></div>
              {[["Date","date","date"],["TSN (HH:MM)","fh","text"],["CSN","fc","number"],["MRO Facility","mro","text"]].map(([l,k,t])=>(
                <div key={k}><label className="form-label">{l}</label><input type={t} value={newSV[k]} onChange={e=>setNewSV({...newSV,[k]:e.target.value})}/></div>
              ))}
            </div>
            <div className="flab g8"><button className="btn btn-ghost" onClick={()=>setAddSV(false)}>Cancel</button><button className="btn btn-gold" onClick={doAddSV}>Add Visit</button></div>
          </div>
        )}
      </div>
    </div>
  );
};


export { APUTab, EnginesTab, GearCard, LandingGearTab, OverviewTab, ShopVisitEditor, WheelsBrakesCard };
