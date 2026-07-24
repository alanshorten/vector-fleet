import React, { useState, useEffect, useCallback, useRef } from 'react';
import { LLPExtractor, ShareModal } from './AssetView';
import { CheckDateInput, PhotoManager } from './PhotosAndSpecs';
import { assetEngineStockPhotoKey, airframeStockPhotoKey, makeBlankAsset, makeBlankEngineProspect, parseHHMM } from '../lib/assetHelpers';
import { db, logAudit } from '../lib/db';
import { generateTechSpec, getDefaultDisclaimer, getTechSpecLogo } from '../lib/techSpec';

function ProspectListView({assets,saveAsset,notify,userRole,onSelect,loadAssets}){
  const canDelete=userRole==='admin'||userRole==='editor';
  const[showNew,setShowNew]=useState(false);
  const[kind,setKind]=useState("aircraft"); // "aircraft" | "engine"
  const[shareOpenId,setShareOpenId]=useState(null);
  const[newA,setNewA]=useState({msn:"",registration:"",model:"A320-214",operator:"",manufacturer:"Airbus S.A.S.",dom:""});
  const[newE,setNewE]=useState({esn:"",engineType:"",thrust:""});
  const createProspect=async()=>{
    if(kind==="aircraft"){
      if(!newA.msn){notify("MSN required","error");return;}
      const blank=makeBlankAsset(newA,"prospect");
      blank.prospectKind="aircraft";
      await saveAsset(blank);
      setShowNew(false);
      setNewA({msn:"",registration:"",model:"A320-214",operator:"",manufacturer:"Airbus S.A.S.",dom:""});
      notify(`Prospect MSN ${blank.msn} created`);
      onSelect(blank.id);
    } else {
      if(!newE.esn){notify("ESN required","error");return;}
      const blank=makeBlankEngineProspect(newE);
      await saveAsset(blank);
      setShowNew(false);
      setNewE({esn:"",engineType:"",thrust:""});
      notify(`Prospect ESN ${blank.engines[0].sn} created`);
      onSelect(blank.id);
    }
  };
  const deleteProspect=async(id)=>{
    if(!confirm(`Delete prospect ${id}? This cannot be undone.`))return;
    await db.deleteAsset(id);
    await logAudit(id,id,"Deleted prospect asset");
    await loadAssets();
    notify("Prospect deleted");
  };
  return(
    <div>
      <div className="flj" style={{marginBottom:14}}>
        <div>
          <h1 style={{fontSize:20,color:"#C9A84C",fontWeight:700}}>Prospect Assets</h1>
          <p style={{color:"#475569",fontSize:12}}>Ad hoc / deal-evaluation aircraft and engines — kept separate from the live fleet. Anyone can create and edit prospects.</p>
        </div>
        <button className="btn btn-gold" onClick={()=>setShowNew(true)}>+ New Prospect</button>
      </div>
      {showNew&&(
        <div className="card" style={{padding:20,marginBottom:16}}>
          <div className="flab g8" style={{marginBottom:14}}>
            <button type="button" onClick={()=>setKind("aircraft")} className="btn" style={{fontSize:12,padding:"6px 14px",background:kind==="aircraft"?"#C9A84C":"transparent",color:kind==="aircraft"?"#0a1520":"#94a3b8",border:"1px solid #C9A84C",fontWeight:700}}>✈ Whole Aircraft</button>
            <button type="button" onClick={()=>setKind("engine")} className="btn" style={{fontSize:12,padding:"6px 14px",background:kind==="engine"?"#C9A84C":"transparent",color:kind==="engine"?"#0a1520":"#94a3b8",border:"1px solid #C9A84C",fontWeight:700}}>⚙ Standalone Engine</button>
          </div>
          {kind==="aircraft"?(
            <>
              <div className="section-title">New Prospect Aircraft</div>
              <div className="grid3" style={{gap:10,marginBottom:12}}>
                {[["MSN *","msn"],["Registration","registration"],["Model","model"],["Operator","operator"],["Manufacturer","manufacturer"]].map(([l,k])=>(
                  <div key={k}><label className="form-label">{l}</label><input value={newA[k]||""} onChange={e=>setNewA({...newA,[k]:e.target.value})} className={!newA[k]&&k==="msn"?"amber":""}/></div>
                ))}
                <div><label className="form-label">Date of Manufacture</label><input type="date" value={newA.dom} onChange={e=>setNewA({...newA,dom:e.target.value})}/></div>
              </div>
            </>
          ):(
            <>
              <div className="section-title">New Prospect Engine</div>
              <p style={{fontSize:11,color:"#94a3b8",marginBottom:10}}>For evaluating a bare spare engine deal — no airframe attached. Produces a standalone engine tech spec.</p>
              <div className="grid3" style={{gap:10,marginBottom:12}}>
                <div><label className="form-label">ESN *</label><input value={newE.esn} onChange={e=>setNewE({...newE,esn:e.target.value})} className={!newE.esn?"amber":""}/></div>
                <div><label className="form-label">Engine Type</label><input value={newE.engineType} onChange={e=>setNewE({...newE,engineType:e.target.value})}/></div>
                <div><label className="form-label">Thrust</label><input value={newE.thrust} onChange={e=>setNewE({...newE,thrust:e.target.value})}/></div>
              </div>
            </>
          )}
          <div className="flab g8"><button className="btn btn-ghost" onClick={()=>setShowNew(false)}>Cancel</button><button className="btn btn-gold" onClick={createProspect}>Create & Open Editor</button></div>
        </div>
      )}
      <div className="grid3" style={{gap:14}}>
        {assets.length===0&&!showNew&&(
          <div style={{gridColumn:"1/-1",textAlign:"center",padding:60,color:"#475569"}}>
            <div style={{fontSize:40,marginBottom:12}}>📋</div>
            <p style={{fontSize:14,fontWeight:600}}>No prospect assets yet</p>
            <p style={{fontSize:12,marginTop:6}}>Create one to evaluate a deal — generate an indicative tech spec without touching the live fleet.</p>
          </div>
        )}
        {assets.map(a=>{
          const isEngine=a.prospectKind==="engine";
          return(
            <div key={a.id} className="card" style={{padding:16,cursor:"pointer"}} onClick={()=>onSelect(a.id)}>
              <div className="flj" style={{marginBottom:8}}>
                <span style={{fontWeight:700,color:"#C9A84C",fontFamily:"monospace",fontSize:14}}>{isEngine?`⚙ ESN ${a.engines?.[0]?.sn||"—"}`:a.msn}</span>
                {canDelete&&<button className="btn-danger btn" style={{fontSize:10,padding:"3px 8px"}} onClick={e=>{e.stopPropagation();deleteProspect(a.id);}}>Delete</button>}
              </div>
              {isEngine?(
                <>
                  <div style={{fontSize:13,fontWeight:600,color:"#e2e8f0"}}>{a.engines?.[0]?.type||"Engine type not entered"}</div>
                  <div style={{fontSize:12,color:"#94a3b8"}}>{a.engines?.[0]?.thrust||"—"} thrust</div>
                </>
              ):(
                <>
                  <div style={{fontSize:13,fontWeight:600,color:"#e2e8f0"}}>{a.registration||"No registration yet"}</div>
                  <div style={{fontSize:12,color:"#94a3b8"}}>{a.model} · {a.operator||"—"}</div>
                </>
              )}
              <div className="flab g8" style={{marginTop:12}}>
                <button className="btn btn-ghost" style={{flex:1,fontSize:11,padding:"7px 0"}} onClick={e=>{e.stopPropagation();setShareOpenId(a.id);}}>🔗 Share</button>
                <button className="btn btn-ghost" style={{flex:1,fontSize:11,padding:"7px 0"}} onClick={e=>{e.stopPropagation();generateTechSpec(a);}}>📋 Tech Spec</button>
              </div>
              <button className="btn btn-gold" style={{width:"100%",marginTop:8,fontSize:12,padding:"7px 0"}} onClick={e=>{e.stopPropagation();onSelect(a.id);}}>Open Editor →</button>
            </div>
          );
        })}
      </div>
      {shareOpenId&&<ShareModal asset={assets.find(x=>x.id===shareOpenId)} notify={notify} onClose={()=>setShareOpenId(null)}/>}
    </div>
  );
};

function PField({label,val,onCommit,type="text",placeholder}){
  return(
    <div className="form-group">
      <label className="form-label">{label}</label>
      <input type={type} defaultValue={val??""} placeholder={placeholder||""} onBlur={e=>onCommit(type==="number"?(e.target.value===""?null:+e.target.value):e.target.value)}/>
    </div>
  );
};

function ProspectEditor({asset,saveAsset,notify,onBack}){
  const[form,setForm]=useState(()=>JSON.parse(JSON.stringify(asset)));
  const[previewHtml,setPreviewHtml]=useState("");
  const[saving,setSaving]=useState(false);
  const[shareOpen,setShareOpen]=useState(false);
  const assetsRef=useRef(form);
  assetsRef.current=form;

  const regeneratePreview=useCallback(async(current)=>{
    const specAsset=current.prospectKind==="engine"?{...current,_engineOnly:true,_enginePos:1}:current;
    const photoKey=assetEngineStockPhotoKey(specAsset);
    const airframePhotoKey=airframeStockPhotoKey(specAsset.model);
    const[engPhoto,stockAirframePhoto,logo,defaultDisclaimer]=await Promise.all([
      photoKey?db.getSetting(photoKey).catch(()=>null):Promise.resolve(null),
      airframePhotoKey?db.getSetting(airframePhotoKey).catch(()=>null):Promise.resolve(null),
      getTechSpecLogo(),
      getDefaultDisclaimer()
    ]);
    setPreviewHtml(buildTechSpecHTML(specAsset,engPhoto,logo,defaultDisclaimer,stockAirframePhoto||""));
  },[]);

  useEffect(()=>{regeneratePreview(form);},[]); // eslint-disable-line

  // commit() persists the whole form on blur — save + refresh preview in one
  // step, so Viewer-tier users never need to find a separate Save button.
  const assetLabel=(f)=>f.prospectKind==="engine"?`ESN ${f.engines?.[0]?.sn||"—"}`:`MSN ${f.msn}`;
  const commit=async(path,val)=>{
    const f=JSON.parse(JSON.stringify(assetsRef.current));
    const parts=path.split(".");let obj=f;
    for(let i=0;i<parts.length-1;i++){if(!obj[parts[i]])obj[parts[i]]={};obj=obj[parts[i]];}
    obj[parts[parts.length-1]]=val;
    setForm(f);
    setSaving(true);
    try{
      await saveAsset(f,`Updated prospect ${assetLabel(f)}`);
      await regeneratePreview(f);
    }catch(e){notify("Save failed: "+e.message,"error");}
    setSaving(false);
  };
  // Same idea but for callers that already have the fully-mutated object in
  // hand (e.g. auto-calculated Next Due, kg/lb weight conversion, hidden-field
  // toggles) — avoids clone-then-reclone.
  const commitObject=async(f)=>{
    setForm(f);
    setSaving(true);
    try{
      await saveAsset(f,`Updated prospect ${assetLabel(f)}`);
      await regeneratePreview(f);
    }catch(e){notify("Save failed: "+e.message,"error");}
    setSaving(false);
  };
  // PhotoManager/LopaCropTool are self-contained — they call saveAsset(mergedAsset)
  // themselves rather than going through commit()/commitObject(). This wrapper
  // gives them the real saveAsset behaviour while still syncing local form state
  // and refreshing the live preview afterwards, exactly like every other field.
  const photoSaveAsset=async(updatedAsset,action)=>{
    setForm(updatedAsset);
    setSaving(true);
    try{
      await saveAsset(updatedAsset,action||`Updated prospect ${assetLabel(updatedAsset)} photos`);
      await regeneratePreview(updatedAsset);
    }catch(e){notify("Save failed: "+e.message,"error");}
    setSaving(false);
  };
  const toggle=(path)=>{
    const parts=path.split(".");let cur=assetsRef.current;for(const p of parts)cur=cur?.[p];
    commit(path,!cur);
  };
  const hiddenFields=form.hiddenSpecFields||[];
  const toggleHide=(path)=>{
    const f=JSON.parse(JSON.stringify(assetsRef.current));
    const hidden=f.hiddenSpecFields||[];
    const idx=hidden.indexOf(path);
    if(idx>=0)hidden.splice(idx,1);else hidden.push(path);
    f.hiddenSpecFields=hidden;
    commitObject(f);
  };

  const d=form;
  const af=d.airframe||{};
  const specs=d.specs||{};

  // Specs are rendered as one ordered list (matching Alan's reference sheet
  // exactly, including label wording and sequence) rather than grouped
  // sub-sections. tabIndex={-1} on the 👁/🚫 toggle keeps it out of the way
  // so Tab moves straight from one field's input to the next field's input.
  const SPEC_FIELDS=[
    {label:"Aircraft Configuration",path:"specs.config",kind:"text"},
    {label:"Passenger Seating Config",path:"specs.seatConfig",kind:"text"},
    {label:"Passenger Seating Manufacturer",path:"specs.seatMfr",kind:"text"},
    {label:"Passenger Seats P/N",path:"specs.seatPN",kind:"text"},
    {label:"Attendant Seats",path:"specs.attendantSeats",kind:"text"},
    {label:"Galleys Installed",path:"specs.galleys",kind:"text"},
    {label:"Lavatories",path:"specs.lavs",kind:"text"},
    {label:"Winglets",path:"specs.winglets",kind:"text"},
    {label:"Cockpit Door Surveillance System",path:"specs.cdss",kind:"toggle"},
    {label:"Reinforced Flight Deck Door",path:"specs.rfdd",kind:"toggle"},
    {label:"QAR",path:"specs.qar",kind:"toggle"},
    {label:"Electronic Flight Bag",path:"specs.efb",kind:"toggle"},
    {label:"Enhanced Mode-S",path:"specs.modeS",kind:"toggle"},
    {label:"ADS-B",path:"specs.adsb",kind:"toggle"},
    {label:"CPDLC",path:"specs.cpdlc",kind:"toggle"},
    {label:"TCAS 7.1",path:"specs.tcas",kind:"toggle"},
    {label:"Cargo",path:"specs.cargoType",kind:"text"},
  ];
  const SpecRow=({label,path,kind})=>{
    const parts=path.split(".");const val=parts.reduce((o,k)=>o?.[k],d);
    const isHidden=hiddenFields.includes(path);
    return(
      <div className="flj" style={{padding:"6px 0",borderBottom:"1px solid #0f2030",opacity:isHidden?0.4:1,gap:10}}>
        <span style={{fontSize:12,color:"#94a3b8",flexShrink:0,width:230}}>{label}</span>
        {kind==="text"
          ?<input type="text" defaultValue={val||""} onBlur={e=>commit(path,e.target.value)} style={{flex:1,fontSize:12}}/>
          :<button type="button" onClick={()=>toggle(path)} className="pill" style={{background:val?"#0d2818":"#2a0e0e",color:val?"#34d399":"#f87171",border:"none",cursor:"pointer",fontSize:11,flex:1,textAlign:"center"}}>{val?"Installed":"Not Installed"}</button>}
        <button type="button" tabIndex={-1} onClick={()=>toggleHide(path)} title={isHidden?"Show in tech spec":"Hide from tech spec"} style={{background:"none",border:"none",cursor:"pointer",fontSize:13,color:isHidden?"#475569":"#C9A84C",padding:"0 4px",flexShrink:0}}>{isHidden?"🚫":"👁"}</button>
      </div>
    );
  };
  const weightRow=(label,kKg,kLb)=>(
    <tr key={kKg}>
      <td style={{color:"#64748b"}}>{label}</td>
      <td><input type="number" defaultValue={d.weights?.[kKg]||""} onBlur={e=>{
        const kg=e.target.value===""?"":+e.target.value;
        const f=JSON.parse(JSON.stringify(assetsRef.current));
        if(!f.weights)f.weights={};
        f.weights[kKg]=kg;
        f.weights[kLb]=kg?Math.round(kg*2.20462):"";
        commitObject(f);
      }} style={{width:100}}/></td>
      <td style={{color:"#475569"}}><input type="number" defaultValue={d.weights?.[kLb]||""} onBlur={e=>{
        const lb=e.target.value===""?"":+e.target.value;
        const f=JSON.parse(JSON.stringify(assetsRef.current));
        if(!f.weights)f.weights={};
        f.weights[kLb]=lb;
        f.weights[kKg]=lb?Math.round(lb/2.20462):"";
        commitObject(f);
      }} style={{width:100}}/></td>
    </tr>
  );

  const isEngineProspect=d.prospectKind==="engine";
  const specAsset=isEngineProspect?{...d,_engineOnly:true,_enginePos:1}:d;

  return(
    <div style={{animation:"fadeIn 0.2s ease"}}>
      <div className="flab g12" style={{marginBottom:16}}>
        <button className="btn btn-ghost" onClick={onBack}>← Prospects</button>
        <div style={{flex:1}}>
          {isEngineProspect?(
            <>
              <h1 style={{fontSize:18,color:"#C9A84C",fontWeight:700}}>Prospect Engine — ESN {d.engines?.[0]?.sn||"—"}</h1>
              <p style={{color:"#475569",fontSize:12}}>{d.engines?.[0]?.type||"Engine type not entered"} {saving&&<span style={{color:"#94a3b8"}}> · saving…</span>}</p>
            </>
          ):(
            <>
              <h1 style={{fontSize:18,color:"#C9A84C",fontWeight:700}}>Prospect MSN {d.msn} — {d.registration||"—"}</h1>
              <p style={{color:"#475569",fontSize:12}}>{d.model} · {d.operator||"—"} {saving&&<span style={{color:"#94a3b8"}}> · saving…</span>}</p>
            </>
          )}
        </div>
        <button className="btn btn-ghost" style={{fontSize:12,padding:"8px 16px"}} onClick={()=>setShareOpen(true)}>🔗 Share</button>
        <button className="btn btn-gold" style={{fontSize:12,padding:"8px 16px"}} onClick={()=>generateTechSpec(specAsset)}>📋 Generate Tech Spec</button>
      </div>
      <div className="prospect-split" style={{display:"flex",gap:18,alignItems:"flex-start"}}>
        <div style={{flex:"1 1 50%",minWidth:0,display:"flex",flexDirection:"column",gap:14,maxHeight:"calc(100vh - 160px)",overflowY:"auto",paddingRight:6}}>

          {!isEngineProspect&&(<>
          <div className="card" style={{padding:18}}>
            <div className="section-title">Overview</div>
            <div className="grid2" style={{gap:"0 16px"}}>
              <PField label="MSN" val={d.msn} onCommit={v=>commit("msn",v)}/>
              <PField label="Registration" val={d.registration} onCommit={v=>commit("registration",v)}/>
              <div className="form-group">
                <label className="form-label" style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                  <span>{d.operatorLabel||"Current Operator"}</span>
                  <button type="button" tabIndex={-1} onClick={()=>commit("operatorLabel",d.operatorLabel==="Previous Operator"?"Current Operator":"Previous Operator")} style={{fontSize:9,fontWeight:700,padding:"1px 7px",borderRadius:3,border:"1px solid #C9A84C",background:"none",color:"#C9A84C",cursor:"pointer",textTransform:"uppercase",letterSpacing:"0.05em",flexShrink:0}}>{"→ "+(d.operatorLabel==="Previous Operator"?"Current":"Previous")}</button>
                </label>
                <input type="text" defaultValue={d.operator||""} onBlur={e=>commit("operator",e.target.value)}/>
              </div>
              <PField label="Model" val={d.model} onCommit={v=>commit("model",v)}/>
              <PField label="Manufacturer" val={d.manufacturer} onCommit={v=>commit("manufacturer",v)}/>
              <PField label="Date of Manufacture" val={d.dom} type="date" onCommit={v=>commit("dom",v)}/>
            </div>
            <div style={{marginTop:12,paddingTop:12,borderTop:"1px solid #1e3048"}}>
              <div style={{fontSize:10,fontWeight:700,color:"#475569",textTransform:"uppercase",marginBottom:8}}>Current Airframe</div>
              <div className="grid2" style={{gap:"0 16px"}}>
                <PField label="Airframe TSN (HH:MM)" val={af.currentFH} onCommit={v=>commit("airframe.currentFH",parseHHMM(v))} placeholder="0:00"/>
                <PField label="Airframe CSN" val={af.currentFC} type="number" onCommit={v=>commit("airframe.currentFC",v)}/>
              </div>
            </div>
          </div>

          <div className="card" style={{padding:18}}>
            <div className="section-title">Operating Weights</div>
            <table><thead><tr><th>Parameter</th><th>kg</th><th>lb</th></tr></thead><tbody>
              {weightRow("MTOW","mtow","mtow_lb")}
              {weightRow("Max Taxi","mtw","mtw_lb")}
              {weightRow("MZFW","mzfw","mzfw_lb")}
              {weightRow("MLW","mlw","mlw_lb")}
            </tbody></table>
          </div>

          <div className="card" style={{padding:18}}>
            <div className="section-title">Specifications</div>
            <div style={{fontSize:10,color:"#475569",marginBottom:10}}>👁 fields appear in the generated tech spec; 🚫 fields are entered here but hidden from the output.</div>
            {SPEC_FIELDS.map(f=><SpecRow key={f.path} {...f}/>)}
            <div style={{marginTop:14}}>
              <div style={{fontSize:10,fontWeight:700,color:"#475569",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:8}}>Custom Fields</div>
              {[0,1,2,3,4].map(idx=>{
                const cf=(d.specs?.custom||[])[idx]||{label:"",value:""};
                return(
                  <div key={idx} className="flab g8" style={{marginBottom:6}}>
                    <input placeholder="Field name" defaultValue={cf.label||""} onBlur={e=>{
                      const f=JSON.parse(JSON.stringify(assetsRef.current));
                      if(!f.specs)f.specs={};if(!f.specs.custom)f.specs.custom=[{},{},{},{},{}];
                      while(f.specs.custom.length<5)f.specs.custom.push({});
                      f.specs.custom[idx]={...f.specs.custom[idx],label:e.target.value};
                      commitObject(f);
                    }} style={{width:160,fontStyle:"italic",color:"#64748b"}}/>
                    <input placeholder="Value" defaultValue={cf.value||""} onBlur={e=>{
                      const f=JSON.parse(JSON.stringify(assetsRef.current));
                      if(!f.specs)f.specs={};if(!f.specs.custom)f.specs.custom=[{},{},{},{},{}];
                      while(f.specs.custom.length<5)f.specs.custom.push({});
                      f.specs.custom[idx]={...f.specs.custom[idx],value:e.target.value};
                      commitObject(f);
                    }} style={{flex:1}}/>
                  </div>
                );
              })}
            </div>
          </div>
          </>)}

          {(isEngineProspect?[0]:[0,1]).map(ei=>{
            const eng=d.engines?.[ei]||{};
            return(
              <div className="card" key={ei} style={{padding:18}}>
                <div className="flj">
                  <div className="section-title" style={{margin:0}}>{isEngineProspect?"Engine":`Engine #${ei+1}`}</div>
                  {!isEngineProspect&&<button className="btn btn-ghost" style={{fontSize:11,padding:"4px 10px"}} onClick={()=>generateTechSpec({...d,engines:[eng],_engineOnly:true,_enginePos:eng.position||ei+1})}>📋 Standalone Engine Spec</button>}
                </div>
                <div className="grid2" style={{gap:"0 16px"}}>
                  <PField label="Serial Number" val={eng.sn} onCommit={v=>commit(`engines.${ei}.sn`,v)}/>
                  <PField label="Engine Type" val={eng.type} onCommit={v=>commit(`engines.${ei}.type`,v)}/>
                  <PField label="Thrust" val={eng.thrust} onCommit={v=>commit(`engines.${ei}.thrust`,v)}/>
                  <PField label="Status" val={eng.status} onCommit={v=>commit(`engines.${ei}.status`,v)}/>
                  <PField label="TSN (HH:MM)" val={eng.currentFH} onCommit={v=>commit(`engines.${ei}.currentFH`,parseHHMM(v))} placeholder="0:00"/>
                  <PField label="CSN" val={eng.currentFC} type="number" onCommit={v=>commit(`engines.${ei}.currentFC`,v)}/>
                </div>
                <div style={{marginTop:10,fontSize:11,color:"#475569",fontStyle:"italic"}}>{eng.llps?.length?`${eng.llps.length} LLP line(s) recorded.`:"No LLP data yet."}</div>
              </div>
            );
          })}

          <div className="card" style={{padding:18}}>
            <div className="section-title">Engine LLP Extraction</div>
            <p style={{fontSize:11,color:"#94a3b8"}}>{isEngineProspect?"Upload the Engine LLP Status Sheet (PDF) for this engine.":"Upload the Engine LLP Status Sheet (PDF) — it covers both engines. Extracted rows are matched to the engine slot by serial number where possible, otherwise applied in sheet order."}</p>
            <LLPExtractor kind="llp" label="Engine LLP Sheet (PDF)" notify={notify} onApply={parsed=>{
              const f=JSON.parse(JSON.stringify(assetsRef.current));
              const engines=f.engines||[];
              (parsed.engines||[]).forEach((eng,i)=>{
                if(!eng.esn&&!eng.llps?.length)return;
                let idx=engines.findIndex(e=>e.sn&&eng.esn&&e.sn===eng.esn);
                if(idx===-1)idx=i; // no S/N match yet (fresh prospect) — fall back to sheet order
                if(!engines[idx])return;
                const refCSN=eng.csn||0;
                engines[idx]={
                  ...engines[idx],
                  sn:engines[idx].sn||eng.esn||engines[idx].sn,
                  type:engines[idx].type||eng.engine_type||engines[idx].type,
                  llps:(eng.llps||[]).map(l=>({desc:l.desc,pn:l.pn,sn:l.sn,startFCRem:l.fc_remaining,refFC:refCSN,approvedLife:(l.cycle_limit===undefined?null:l.cycle_limit)}))
                };
              });
              f.engines=engines;
              commitObject(f);
            }}/>
          </div>

          {!isEngineProspect&&(<>
          {[["nose","Nose Landing Gear"],["left","LH Main Landing Gear"],["right","RH Main Landing Gear"]].map(([k,label])=>{
            const g=d.landingGear?.[k]||{};
            return(
              <div className="card" key={k} style={{padding:18}}>
                <div className="section-title">{label}</div>
                <div className="grid2" style={{gap:"0 16px"}}>
                  <PField label="Manufacturer" val={g.mfr} onCommit={v=>commit(`landingGear.${k}.mfr`,v)}/>
                  <PField label="Part Number" val={g.pn} onCommit={v=>commit(`landingGear.${k}.pn`,v)}/>
                  <PField label="Serial Number" val={g.sn} onCommit={v=>commit(`landingGear.${k}.sn`,v)}/>
                  <PField key={"nextdue-"+(g.nextDue||"")} label="Next Overhaul Due" val={g.nextDue} type="date" onCommit={v=>commit(`landingGear.${k}.nextDue`,v)}/>
                  <PField label="Last Overhaul Date" val={g.lastOverhaulDate} type="date" onCommit={v=>{
                    // Mirror the live-fleet auto-calc: if Next Due is still blank,
                    // derive it from Last Overhaul Date + overhaulIntervalYears (default 10yr).
                    const f=JSON.parse(JSON.stringify(assetsRef.current));
                    const leg=f.landingGear[k];
                    leg.lastOverhaulDate=v;
                    if(v&&!leg.nextDue){
                      const yrs=leg.overhaulIntervalYears||10;
                      const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
                      if(m)leg.nextDue=(+m[1]+yrs)+"-"+m[2]+"-"+m[3];
                    }
                    commitObject(f);
                  }}/>
                  <PField label="Last OH FC" val={g.lastOverhaulFC} type="number" onCommit={v=>commit(`landingGear.${k}.lastOverhaulFC`,v)}/>
                </div>
                <div style={{marginTop:10,paddingTop:10,borderTop:"1px solid #1e3048"}}>
                  <div style={{fontSize:10,fontWeight:700,color:"#475569",textTransform:"uppercase",marginBottom:8}}>Current Totals (Ground Truth)</div>
                  <div className="grid2" style={{gap:"0 16px"}}>
                    <PField label="Leg TSN (HH:MM)" val={g.currentFH} onCommit={v=>commit(`landingGear.${k}.currentFH`,parseHHMM(v))} placeholder="0:00"/>
                    <PField label="Leg CSN" val={g.currentFC} type="number" onCommit={v=>commit(`landingGear.${k}.currentFC`,v)}/>
                  </div>
                </div>
              </div>
            );
          })}

          <div className="card" style={{padding:18}}>
            <div className="section-title">APU</div>
            <div className="grid2" style={{gap:"0 16px"}}>
              <PField label="Manufacturer" val={d.apu?.mfr} onCommit={v=>commit("apu.mfr",v)}/>
              <PField label="Part Number" val={d.apu?.pn} onCommit={v=>commit("apu.pn",v)}/>
              <PField label="Serial Number" val={d.apu?.sn} onCommit={v=>commit("apu.sn",v)}/>
              <PField label="TSN (HH:MM)" val={d.apu?.currentFH} onCommit={v=>commit("apu.currentFH",parseHHMM(v))} placeholder="0:00"/>
              <PField label="CSN" val={d.apu?.currentFC} type="number" onCommit={v=>commit("apu.currentFC",v)}/>
            </div>
            <div style={{marginTop:10,fontSize:11,color:"#475569",fontStyle:"italic"}}>{d.apu?.llps?.length?`${d.apu.llps.length} LLP line(s) recorded.`:"No LLP data yet."}</div>
            <LLPExtractor kind="apu_llp" label="APU LLP Sheet (PDF)" notify={notify} onApply={parsed=>{
              const f=JSON.parse(JSON.stringify(assetsRef.current));
              let apu=f.apu||{};
              if(parsed.apu?.llps?.length){
                const refCSN=parsed.apu.csn||0;
                if(parsed.apu.sn)apu.sn=apu.sn||parsed.apu.sn;
                if(parsed.apu.pn)apu.pn=apu.pn||parsed.apu.pn;
                if(!apu.currentFC&&parsed.apu.csn)apu.currentFC=parsed.apu.csn;
                apu.llps=(parsed.apu.llps||[]).map(l=>({desc:l.desc,pn:l.pn,sn:l.sn,startFCRem:l.fc_remaining,refFC:refCSN,approvedLife:(l.cycle_limit===undefined?null:l.cycle_limit)}));
              }
              f.apu=apu;
              commitObject(f);
            }}/>
          </div>

          <div className="card" style={{padding:18}}>
            <div className="section-title">Checks</div>
            {(d.checks||[]).map((c,ci)=>{
              const yrs=(()=>{const m=/(\d+)\s*Year/i.exec(c.name);return m?+m[1]:null;})();
              return(
                <div key={ci} style={{marginBottom:12,paddingBottom:12,borderBottom:ci<d.checks.length-1?"1px solid #1e3048":"none"}}>
                  <div style={{fontSize:12,fontWeight:600,color:"#94a3b8",marginBottom:6}}>{c.name}</div>
                  <div className="grid2" style={{gap:"0 16px"}}>
                    <div className="form-group">
                      <label className="form-label">Last Date (auto-fills Next Due)</label>
                      <CheckDateInput val={c.lastDate} yrs={yrs} onCommit={(iso,nextISO)=>{
                        const f=JSON.parse(JSON.stringify(assetsRef.current));
                        f.checks[ci].lastDate=iso;
                        if(nextISO)f.checks[ci].nextDate=nextISO;
                        commitObject(f);
                      }}/>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Next Due</label>
                      <CheckDateInput key={"nextdate-"+(c.nextDate||"")} val={c.nextDate} yrs={null} onCommit={(iso)=>commit(`checks.${ci}.nextDate`,iso)}/>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          </>)}

          <div className="card" style={{padding:18}}>
            <div className="section-title">Photos</div>
            <p style={{fontSize:11,color:"#94a3b8",marginBottom:10}}>Airframe (cover photo), LOPA (with crop tool), Avionics, and any other reference photos — same categories as the live fleet.</p>
            <PhotoManager asset={d} saveAsset={photoSaveAsset} notify={notify} label="photos" field="photos"/>
          </div>

          <div className="card" style={{padding:20,background:"#0d1c2c",border:"1px solid #C9A84C"}}>
            <div className="section-title" style={{color:"#C9A84C"}}>That's the full template</div>
            <p style={{fontSize:12,color:"#94a3b8",marginBottom:14}}>Every field above feeds the preview on the right and autosaves as you go. When you're happy with it:</p>
            <div className="flab g8" style={{flexWrap:"wrap"}}>
              <button className="btn btn-gold" style={{fontSize:12,padding:"8px 16px"}} onClick={()=>generateTechSpec(specAsset)}>📋 Generate Full Tech Spec</button>
              <button className="btn btn-ghost" style={{fontSize:12,padding:"8px 16px"}} onClick={onBack}>← Back to Prospects List</button>
            </div>
          </div>

        </div>

        <div style={{flex:"1 1 50%",minWidth:0,position:"sticky",top:88}}>
          <div className="card" style={{padding:0,overflow:"hidden",height:"calc(100vh - 160px)"}}>
            <div className="flj" style={{padding:"10px 14px",borderBottom:"1px solid #1e3048",background:"#0d1c2c"}}>
              <span style={{fontSize:12,fontWeight:700,color:"#C9A84C",letterSpacing:"0.04em",textTransform:"uppercase"}}>Live Tech Spec Preview</span>
              <span style={{fontSize:11,color:"#475569"}}>Updates when you leave a field</span>
            </div>
            <iframe title="Tech spec preview" srcDoc={previewHtml} style={{width:"100%",height:"calc(100% - 38px)",border:"none",background:"#fff"}}/>
          </div>
        </div>
      </div>
      {shareOpen&&<ShareModal asset={d} notify={notify} onClose={()=>setShareOpen(false)}/>}
    </div>
  );
};


export { PField, ProspectEditor, ProspectListView };
