import React, { useState, useEffect, useCallback, useRef } from 'react';
import { BulkLeaseImport } from './BulkLeaseImport';
import { APU_LLP_PROMPT, ENGINE_LLP_PROMPT, parseHHMM } from '../lib/assetHelpers';
import { db } from '../lib/db';

function EngineSNAction({change,prevEngines,mergedAsset,saveAsset,notify}){
  const[mode,setMode]=useState(null); // null | "atshop" | "resolved"
  const[form,setForm]=useState(null);
  const idx=change.position-1;
  const prevEng=prevEngines[idx]||{};
  const isReturn=!!(prevEng.atShop&&prevEng.titleEngine&&prevEng.titleEngine.sn===change.newSN);
  if(mode==="resolved")return<div style={{fontSize:12,color:"#34d399",marginBottom:6}}>✓ Engine {change.position} S/N change resolved</div>;
  const startAtShop=()=>{setForm({tsn:fmtHHMM(prevEng.currentFH),csn:prevEng.currentFC||"",date:"",reason:""});setMode("atshop");};
  const doAtShop=async()=>{
    const newEngines=JSON.parse(JSON.stringify(mergedAsset.engines||[]));
    newEngines[idx]={...newEngines[idx],atShop:true,titleEngine:{sn:change.previousSN,type:prevEng.type||"",thrust:prevEng.thrust||"",currentFH:parseHHMM(form.tsn),currentFC:+form.csn||0,removedDate:form.date,reason:form.reason}};
    await saveAsset({...mergedAsset,engines:newEngines});
    notify(`Engine ${change.position} marked at shop visit`);
    setMode("resolved");
  };
  const doPermanent=async()=>{
    if(prevEng.atShop){
      const newEngines=JSON.parse(JSON.stringify(mergedAsset.engines||[]));
      newEngines[idx]={...newEngines[idx],atShop:false,titleEngine:null};
      await saveAsset({...mergedAsset,engines:newEngines});
    }
    notify(`Engine ${change.position} S/N change confirmed permanent`);
    setMode("resolved");
  };
  const doReturned=async()=>{
    const newEngines=JSON.parse(JSON.stringify(mergedAsset.engines||[]));
    newEngines[idx]={...newEngines[idx],atShop:false,titleEngine:null};
    await saveAsset({...mergedAsset,engines:newEngines});
    notify(`Engine ${change.position} confirmed returned to service`);
    setMode("resolved");
  };
  return(
    <div style={{background:"#1a1306",border:"1px solid #92660a",borderRadius:6,padding:"8px 10px",marginBottom:8}}>
      <div style={{fontSize:12,color:"#fcd34d",marginBottom:6}}>⚠ Engine {change.position} S/N change: was {change.previousSN}, now {change.newSN}</div>
      {mode==="atshop"?(
        <div style={{marginTop:6}}>
          <div className="grid3" style={{gap:6,marginBottom:8}}>
            <div><label className="form-label">TSN at Removal (HH:MM)</label><input value={form.tsn} onChange={e=>setForm({...form,tsn:e.target.value})}/></div>
            <div><label className="form-label">CSN at Removal</label><input type="number" value={form.csn} onChange={e=>setForm({...form,csn:e.target.value})}/></div>
            <div><label className="form-label">Removal Date</label><input type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})}/></div>
            <div style={{gridColumn:"1/-1"}}><label className="form-label">Reason (optional)</label><input value={form.reason} onChange={e=>setForm({...form,reason:e.target.value})}/></div>
          </div>
          <div className="flab g8">
            <button className="btn btn-ghost" onClick={()=>setMode(null)}>Cancel</button>
            <button className="btn btn-gold" onClick={doAtShop}>Confirm At Shop</button>
          </div>
        </div>
      ):(
        <div className="flab g8">
          {isReturn&&<button className="btn btn-gold" style={{fontSize:11,padding:"4px 10px"}} onClick={doReturned}>✓ Engine Returned</button>}
          <button className="btn btn-primary" style={{fontSize:11,padding:"4px 10px"}} onClick={startAtShop}>🔧 At Shop</button>
          <button className="btn btn-ghost" style={{fontSize:11,padding:"4px 10px"}} onClick={doPermanent}>Permanent</button>
        </div>
      )}
    </div>
  );
};

function TabIcon({type,color}){
  const paths={
    engine:<path d="M3 8c3-2 13-2 15 0l4 4-4 4c-2 2-12 2-15 0l1-4-1-4zM7 8v8M18 9v6M14 8a12 12 0 010 8"/>,
    apu:<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
  };
  if(!paths[type]) return null;
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{verticalAlign:-2,marginRight:5}}>{paths[type]}</svg>;
};

function UploadView({assets,saveAsset,notify}){
  const[uploadType,setUploadType]=useState("util");
  const[file,setFile]=useState(null);
  const[extracting,setExtracting]=useState(false);
  const[extracted,setExtracted]=useState(null);
  const[error,setError]=useState(null);
  const[done,setDone]=useState(false);
  const[saving,setSaving]=useState(false);
  const[matchedAsset,setMatchedAsset]=useState(null);
  const[instructions,setInstructions]=useState("");
  const[showInstructions,setShowInstructions]=useState(false);
  const[sheetNames,setSheetNames]=useState([]);
  const[selectedSheet,setSelectedSheet]=useState(null);
  const[xlsxWorkbook,setXlsxWorkbook]=useState(null);

  const handleFile=e=>{
    const f=e.target.files?.[0];
    if(!f)return;
    setFile(f);setExtracted(null);setError(null);setDone(false);
    setSheetNames([]);setSelectedSheet(null);setXlsxWorkbook(null);
    const isExcel=f.type==="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"||f.type==="application/vnd.ms-excel"||f.name.endsWith(".xlsx")||f.name.endsWith(".xls");
    if(isExcel){
      const reader=new FileReader();
      reader.onload=(ev)=>{
        try{
          const wb=XLSX.read(new Uint8Array(ev.target.result),{type:"array"});
          setXlsxWorkbook(wb);
          setSheetNames(wb.SheetNames);
          // default to last sheet (most recent), user can change
          setSelectedSheet(wb.SheetNames[wb.SheetNames.length-1]);
        }catch(e){/* will surface when extract() is called */}
      };
      reader.readAsArrayBuffer(f);
    }
  };

const extract=async()=>{
    if(!file)return;
    const isPDF=file.type==="application/pdf";
    const isExcel=file.type==="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"||file.type==="application/vnd.ms-excel"||file.name.endsWith(".xlsx")||file.name.endsWith(".xls");
    if(!isPDF&&!isExcel){setError("Unsupported file type. Please upload a PDF or Excel (.xlsx / .xls) file.");return;}
    if(file.size>10*1024*1024){setError("File is too large (maximum 10 MB). Please check you have selected the correct file.");return;}
    setExtracting(true);setError(null);
    try{
      const basePrompt=uploadType==="llp"
        ?ENGINE_LLP_PROMPT
        :uploadType==="apu_llp"
        ?APU_LLP_PROMPT
       :"Extract ALL data from this aircraft utilisation report. This report has separate columns for ENGINE Position 1, ENGINE Position 2, and APU — they are three distinct components, each with their own S/N, TSN, CSN, and FH/FC figures. Do not confuse the APU column with an engine position. If this report includes a dedicated Landing Gear section with a TOTAL HOURS or TOTAL HOURS & CYCLES figure per leg (separate from the routine CSN column), populate total_fh/total_fc for that leg from those ground-truth totals — most reports do not have this section, in which case leave total_fh/total_fc null. Some aircraft only have data for ONE engine position in this report — the single engine may be reported under EITHER Position 1 OR Position 2, so check both columns rather than assuming Position 1 is always populated. Whichever position column is blank or absent, set that entire engine value to null (either \"engine1\" or \"engine2\", whichever is blank) — do not copy APU figures or any other column into a blank engine position, and do not invent placeholder values. All TSN and FH values must be formatted as HH:MM strings. Return ONLY valid JSON, no markdown:\n{\"month_year\":\"e.g. May 2026\",\"operator\":\"string\",\"msn\":\"string\",\"registration\":\"string\",\"airframe\":{\"fh_period\":\"HH:MM\",\"fc_period\":number,\"tsn\":\"HH:MM\",\"csn\":number},\"engine1\":{\"model\":\"string\",\"sn\":\"string\",\"tsn\":\"HH:MM\",\"csn\":number,\"fh_period\":\"HH:MM\",\"fc_period\":number} or null if Position 1 is blank in the report,\"engine2\":{\"model\":\"string\",\"sn\":\"string\",\"tsn\":\"HH:MM\",\"csn\":number,\"fh_period\":\"HH:MM\",\"fc_period\":number} or null if Position 2 is blank in the report,\"apu\":{\"sn\":\"string\",\"tsn\":\"HH:MM\",\"csn\":number},\"landing_gear\":{\"nose\":{\"pn\":\"string\",\"sn\":\"string\",\"csn\":number,\"total_fh\":\"HH:MM or null\",\"total_fc\":\"number or null\"},\"left\":{\"pn\":\"string\",\"sn\":\"string\",\"csn\":number,\"total_fh\":\"HH:MM or null\",\"total_fc\":\"number or null\"},\"right\":{\"pn\":\"string\",\"sn\":\"string\",\"csn\":number,\"total_fh\":\"HH:MM or null\",\"total_fc\":\"number or null\"}},\"removals\":[{\"component\":\"engine or landing_gear or apu\",\"sn\":\"string\",\"position\":\"string\",\"date\":\"string\",\"reason\":\"string\",\"tsn_at_removal\":\"HH:MM\",\"csn_at_removal\":number,\"mro\":\"string\"}]}"
      const prompt=instructions?basePrompt+" Additional instructions: "+instructions:basePrompt;
      // LLP sheets are dense, repetitive tables — use Sonnet for stronger table-tracking accuracy.
      // Everything else (utilisation reports, APU LLP, specs import) stays on Haiku.
      const extractModel=uploadType==="llp"?"claude-sonnet-4-6":"claude-haiku-4-5-20251001";
      let resp;
      if(isPDF){
        const base64=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result.split(",")[1]);r.onerror=()=>rej(new Error("Could not read the file. Please try again."));r.readAsDataURL(file);});
        resp=await fetch("/api/extract",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:extractModel,max_tokens:4000,messages:[{role:"user",content:[{type:"document",source:{type:"base64",media_type:"application/pdf",data:base64}},{type:"text",text:prompt}]}]})});
      } else {
        let csvText;
        try{
          const wb=xlsxWorkbook;
          if(!wb)throw new Error("Excel file not ready — please re-select the file.");
          const sheetToParse=selectedSheet||wb.SheetNames[wb.SheetNames.length-1];
          csvText="Sheet: "+sheetToParse+"\n"+XLSX.utils.sheet_to_csv(wb.Sheets[sheetToParse],{skipHidden:true});
        }catch(xlsxErr){
          throw new Error(xlsxErr.message||"Could not parse the Excel file. Please check the file is not corrupted and try again.");
        }
        resp=await fetch("/api/extract",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:extractModel,max_tokens:4000,messages:[{role:"user",content:[{type:"text",text:"The following is the contents of an Excel spreadsheet (sheet: "+(selectedSheet||"selected")+") exported as CSV.\n\n"+csvText+"\n\n"+prompt}]}]})});
      }
      if(!resp.ok){
        const status=resp.status;
        if(status===401||status===403)throw new Error("Authentication error with the AI service. Please contact your administrator.");
        if(status===429)throw new Error("Too many requests — please wait a moment and try again.");
        if(status>=500)throw new Error("The extraction service is temporarily unavailable. Please try again in a few minutes.");
        throw new Error("Extraction request failed (error "+status+"). Please try again.");
      }
      let result;
      try{result=await resp.json();}catch(jsonErr){throw new Error("Received an unexpected response from the server. Please try again.");}
      if(result.error){
        const msg=result.error;
        if(msg.includes("credit")||msg.includes("billing"))throw new Error("AI service billing issue — please contact your administrator.");
        if(msg.includes("overloaded")||msg.includes("capacity"))throw new Error("The AI service is busy right now. Please wait a moment and try again.");
        throw new Error("Extraction failed. Please check the file is a valid report and try again.");
      }
      let parsed;
      try{
        const rawParsed=result.ok?result.data:JSON.parse((result.raw||"").replace(/```json|```/g,"").trim());
        parsed=Array.isArray(rawParsed)?rawParsed[rawParsed.length-1]:rawParsed;
      }catch(parseErr){
        throw new Error("The AI could not extract structured data from this file. Check it is the correct report type, or try adding specific instructions above.");
      }
      if(!parsed||typeof parsed!=="object"||Array.isArray(parsed)){
        throw new Error("The AI returned an unexpected format. Check the file is a valid report and try again.");
      }

      setExtracted({parsed,fileName:file.name});
      // For LLP uploads, run asset matching immediately so the review panel
      // shows the correct aircraft before the user clicks Confirm & Save.
      // APU S/N matching normalises zero-padding on both sides ("3014" === "03014").
      if(uploadType==="llp"||uploadType==="apu_llp"){
        const normSN=s=>s?.toString().replace(/^0+/,"")||"";
        const msnStr=normSN(parsed.msn);
        let matched=msnStr?assets.find(a=>normSN(a.msn)===msnStr):null;
        if(!matched){const esnList=(parsed.engines||[]).map(e=>e.esn).filter(Boolean);if(esnList.length){matched=assets.find(a=>(a.engines||[]).some(e=>esnList.includes(e.sn)));}}
        if(!matched&&parsed.apu?.sn){matched=assets.find(a=>a.apu?.sn&&normSN(a.apu.sn)===normSN(parsed.apu.sn));}
        setMatchedAsset(matched||null);
      }
    }catch(err){
      const msg=err.message||"";
      if(msg.startsWith("{")||msg.includes('"error"')){
        setError("Extraction failed. Please check the file is a valid report and try again.");
      } else {
        setError(msg);
      }
    }
    setExtracting(false);
  };

  // Normalise compound period strings like "March-April 2026" → "April 2026"
  // so Brain 1's period parser can sequence them against single-month periods.
  const normPeriod=(p)=>{
    if(!p)return p;
    const s=p.trim();
    // "March - April 2026" or "March-April 2026" (shared year at end)
    let m=/^([A-Za-z]+)\s*-\s*([A-Za-z]+)\s+(\d{4})$/i.exec(s);
    if(m)return m[2]+" "+m[3];
    // "March 2026 - April 2026" (each month has own year)
    m=/^[A-Za-z]+\s+\d{4}\s*-\s*([A-Za-z]+)\s+(\d{4})$/i.exec(s);
    if(m)return m[1]+" "+m[2];
    // "01 Mar 2026 - 30 Apr 2026" or "01.Mar.2026 - 30.Apr.2026" (DD Mon YYYY - DD Mon YYYY, day numbers + optional dot separators)
    m=/^\d{1,2}[\s.]+[A-Za-z]+[\s.]+\d{4}\s*-\s*\d{1,2}[\s.]+([A-Za-z]+)[\s.]+(\d{4})$/i.exec(s);
    if(m)return m[1]+" "+m[2];
    return p;
  };
  const withNormPeriod=(a)=>a?{...a,_lastPeriod:normPeriod(a._lastPeriod)}:a;

  const confirmSave=async()=>{
    setSaving(true);
    try{
      const d=extracted.parsed;
      const msn=d.msn?.toString().replace(/^0+/,"");
      const previousAsset=assets.find(a=>a.msn?.toString().replace(/^0+/,"")===msn)||null;

      const result=window.processUtilisationReport({newReport:d,previousAsset:withNormPeriod(previousAsset)});

      if(result.historyOnly){
        // Out-of-order / duplicate-period upload: per product decision, this is
        // saved into history only and must never overwrite live asset state.
        await db.saveUtilisation(result.utilisationRecord);
        setExtracted(prev=>({...prev,warnings:result.warnings}));
        setDone(true);
        return;
      }

      await saveAsset(result.mergedAsset,"Confirmed utilisation report");
      await db.saveUtilisation(result.utilisationRecord);

      if(result.isNewAsset){
        setDone(true);notify(`MSN ${msn} created from ${d.month_year} report`);return;
      }

      if(result.warnings.length){
        setExtracted(prev=>({...prev,warnings:result.warnings,snChanges:result.snChanges,prevEngines:previousAsset.engines||[],mergedAsset:result.mergedAsset}));
        setDone(true);
      } else {
        setDone(true);
        notify(`MSN ${msn} updated for ${d.month_year}`);
      }
    }catch(err){
      setError("Save failed: "+(err.message||"please try again.")+" Your data has not been lost — Discard and re-upload if needed.");
    }finally{
      setSaving(false);
    }
  };

  const confirmLLP=async()=>{
    setSaving(true);
    try{
      const d=extracted.parsed;
      // matchedAsset is resolved at extract time (with zero-pad-normalised APU S/N matching)
      // so we use state here rather than re-running the search — eliminates the false
      // "Could not match" error that fired when the review panel already showed the correct aircraft.
      const asset=matchedAsset;
      if(!asset){setError("Could not match this LLP sheet to any aircraft. Check the file contains a recognisable MSN, engine S/N, or APU S/N.");return;}
      const msn=asset.msn?.toString().replace(/^0+/,"");
      // Handle engine LLPs
      const engines=JSON.parse(JSON.stringify(asset.engines||[]));
      (d.engines||[]).forEach(eng=>{
        if(!eng.esn)return;
        const matchIdx=(asset.engines||[]).findIndex(e=>e.sn===eng.esn);
        if(matchIdx===-1)return;
        const idx=matchIdx;
        if(engines[idx]){
          engines[idx].sn=eng.esn||engines[idx].sn;
          engines[idx].type=eng.engine_type||engines[idx].type;
          const refCSN=eng.csn||0;
          engines[idx].llps=(eng.llps||[]).map(l=>({desc:l.desc,pn:l.pn,sn:l.sn,startFCRem:l.fc_remaining,refFC:refCSN,approvedLife:(l.cycle_limit===undefined?null:l.cycle_limit)}));
        }
      });

      // Handle APU LLPs
      let apu=JSON.parse(JSON.stringify(asset.apu||{}));
      if(d.apu?.llps?.length){
        const refCSN=d.apu.csn||0;
        if(d.apu.sn)apu.sn=d.apu.sn;
        if(d.apu.pn)apu.pn=d.apu.pn;
        // If no currentFC yet, initialise from LLP sheet CSN
        if(!apu.currentFC&&d.apu.csn)apu.currentFC=d.apu.csn;
        apu.llps=(d.apu.llps||[]).map(l=>({desc:l.desc,pn:l.pn,sn:l.sn,startFCRem:l.fc_remaining,refFC:refCSN,approvedLife:(l.cycle_limit===undefined?null:l.cycle_limit)}));
      }

      const hasEngines=(d.engines||[]).length>0;
      const hasAPU=d.apu?.llps?.length>0;

      await saveAsset({...asset,engines,apu},"Uploaded LLP data");
      setDone(true);
      notify(`LLP data saved for MSN ${msn}${hasEngines&&hasAPU?" (engines + APU)":hasAPU?" (APU)":""}`);
    }catch(err){
      setError("Save failed: "+(err.message||"please try again.")+" Your data has not been lost — Discard and re-upload if needed.");
    }finally{
      setSaving(false);
    }
  };

  return(
    <div style={{maxWidth:860,margin:"0 auto"}}>
      <h1 style={{fontSize:20,color:"#C9A84C",fontWeight:700,marginBottom:6}}>Upload</h1>
      <p style={{color:"#64748b",marginBottom:16,fontSize:13}}>Select report type, upload PDF or Excel, and TailiQ AI extracts the data for your review.</p>
      <div className="flab g8" style={{marginBottom:16}}>
        {[["util","📄 Utilisation Report",null],["llp","Engine LLP Sheet","engine"],["apu_llp","APU LLP Sheet","apu"],["lease","📑 Bulk Lease Import",null]].map(([v,l,icon])=>(
          <button key={v} onClick={()=>{setUploadType(v);setFile(null);setExtracted(null);setError(null);setDone(false);setInstructions("");setShowInstructions(false);setSheetNames([]);setSelectedSheet(null);setXlsxWorkbook(null);}}
            style={{padding:"8px 16px",background:uploadType===v?"#1e3a5f":"#0d1e2e",color:uploadType===v?"#C9A84C":"#64748b",border:`1px solid ${uploadType===v?"#1B3A6B":"#1e3348"}`,borderRadius:6,fontSize:13,fontWeight:600,cursor:"pointer"}}>
            {icon&&<TabIcon type={icon} color={uploadType===v?"#C9A84C":"#64748b"}/>}{l}
          </button>
        ))}
      </div>
      {uploadType==="lease"?(
        <BulkLeaseImport assets={assets} saveAsset={saveAsset} notify={notify}/>
      ):(<>
      <div className="card" style={{padding:32,textAlign:"center",marginBottom:16,border:"2px dashed #1e3048"}}>
        <div style={{fontSize:36,marginBottom:10}}>📁</div>
        <input type="file" accept=".pdf,.xlsx" id="upfile" onChange={handleFile} style={{display:"none"}}/>
        <label htmlFor="upfile" style={{cursor:"pointer"}}>
          <div style={{fontWeight:600,color:file?"#C9A84C":"#64748b",marginBottom:4}}>{file?file.name:"Click to select file"}</div>
          <div style={{fontSize:12,color:"#475569"}}>{uploadType==="util"?"PDF or Excel (.xlsx)":uploadType==="llp"?"Engine LLP Status Sheet (PDF)":"APU LLP Status Sheet (PDF)"}</div>
        </label>
        {file&&!done&&(
          <div style={{marginTop:14,display:"flex",flexDirection:"column",gap:8,alignItems:"center",width:"100%"}}>
            {sheetNames.length>1&&(
              <div style={{width:"100%",maxWidth:500}}>
                <label style={{fontSize:11,color:"#94a3b8",display:"block",marginBottom:4}}>Select sheet to parse</label>
                <select value={selectedSheet||""} onChange={e=>setSelectedSheet(e.target.value)} style={{width:"100%",fontSize:12}}>
                  {sheetNames.map(n=><option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            )}
            {!showInstructions
              ?<button className="btn btn-ghost" style={{fontSize:11}} onClick={()=>setShowInstructions(true)}>+ Add specific extraction instructions</button>
              :<div style={{width:"100%",maxWidth:500}}>
                <textarea value={instructions} onChange={e=>setInstructions(e.target.value)}
                  placeholder={uploadType==="llp"?"e.g. Use the 5B4/P column, or use the green highlighted column":uploadType==="apu_llp"?"e.g. APU model is GTCP131-9A, use the corresponding limit column":"e.g. Use position 1 engine data only"}
                  style={{width:"100%",minHeight:70,fontSize:12,resize:"vertical",marginBottom:6}}/>
                <button className="btn btn-ghost" style={{fontSize:11}} onClick={()=>{setShowInstructions(false);setInstructions("");}}>✕ Clear instructions</button>
              </div>
            }
            <button className="btn btn-gold" onClick={extract} disabled={extracting}>{extracting?"Extracting…":"Extract with AI"}</button>
          </div>
        )}
      </div>
      {extracting&&<div className="card" style={{padding:32,textAlign:"center"}}><div style={{width:32,height:32,border:"3px solid #C9A84C",borderTop:"3px solid transparent",borderRadius:"50%",animation:"spin 1s linear infinite",margin:"0 auto 14px"}}/><p style={{color:"#94a3b8"}}>Reading document…</p></div>}
      {error&&<div style={{background:"#2a0e0e",border:"1px solid #7f1d1d",borderRadius:8,padding:14,color:"#f87171",marginBottom:14,fontSize:13}}>⚠ {error}</div>}
      {extracted&&!done&&(
        <div className="card" style={{padding:20}}>
          <div className="section-title">Extracted Data — Review Before Saving</div>
          {(uploadType==="llp"||uploadType==="apu_llp")?(
            <div style={{marginTop:14}}>
              <div className="grid2" style={{gap:8,marginBottom:12}}>
                {[["MSN",extracted.parsed.msn||matchedAsset?.msn||"Matched by ESN/APU S/N"],["Registration",extracted.parsed.registration||matchedAsset?.registration||"—"]].map(([l,v])=>(
                  <div key={l} style={{background:"#0d1925",borderRadius:6,padding:"8px 10px"}}>
                    <div style={{fontSize:9,color:"#475569"}}>{l}</div>
                    <div style={{fontSize:13,fontWeight:600,color:"#f1f5f9"}}>{v?.toString()||"—"}</div>
                  </div>
                ))}
              </div>
              {(extracted.parsed.engines||[]).map((eng,i)=>(
               <div key={i} style={{background:"#0d1925",borderRadius:8,padding:12,marginBottom:10}}>
<div style={{fontSize:10,fontWeight:700,color:"#C9A84C",textTransform:"uppercase",marginBottom:8}}>{eng.position} Engine — ESN {eng.esn} · {eng.llps?.length||0} LLPs</div>
<div className="flab g8" style={{marginBottom:8,alignItems:"center"}}><label className="form-label" style={{margin:0,whiteSpace:"nowrap"}}>Ref CSN (edit if OCR wrong):</label><input type="number" defaultValue={eng.csn} style={{width:120,padding:"4px 8px",fontSize:12}} onChange={e=>{const val=+e.target.value;setExtracted(prev=>{const d=JSON.parse(JSON.stringify(prev));d.parsed.engines[i].csn=val;return d;});}}/></div>
<table style={{fontSize:11}}><thead><tr><th>Description</th><th>P/N</th><th>S/N</th><th>FC Remaining</th><th>Cycle Limit (edit if OCR wrong)</th></tr></thead><tbody>{(eng.llps||[]).map((l,j)=>{const col=l.fc_remaining<1000?"#f87171":l.fc_remaining<3000?"#fbbf24":"#34d399";return <tr key={j}><td>{l.desc}</td><td style={{fontFamily:"monospace",fontSize:10}}>{l.pn}</td><td style={{fontFamily:"monospace",fontSize:10}}>{l.sn}</td><td style={{fontWeight:700,color:col}}>{l.fc_remaining?.toLocaleString()}</td><td><input type="number" defaultValue={l.cycle_limit??""} placeholder="N/L" style={{width:80,padding:"3px 6px",fontSize:11}} onChange={e=>{const val=e.target.value===""?null:+e.target.value;setExtracted(prev=>{const d=JSON.parse(JSON.stringify(prev));d.parsed.engines[i].llps[j].cycle_limit=val;return d;});}}/></td></tr>;})}</tbody></table>
</div>
                  
              ))}
              {extracted.parsed.apu?.llps?.length>0&&(
                <div style={{background:"#0d1925",borderRadius:8,padding:12,marginBottom:10}}>
<div style={{fontSize:10,fontWeight:700,color:"#C9A84C",textTransform:"uppercase",marginBottom:8}}>APU — S/N {extracted.parsed.apu.sn||"—"} · {extracted.parsed.apu.llps.length} LLPs</div>
<div className="flab g8" style={{marginBottom:8,alignItems:"center",flexWrap:"wrap"}}>
  <label className="form-label" style={{margin:0,whiteSpace:"nowrap"}}>Ref CSN (edit if OCR wrong):</label><input type="number" defaultValue={extracted.parsed.apu.csn} style={{width:120,padding:"4px 8px",fontSize:12}} onChange={e=>{const val=+e.target.value;setExtracted(prev=>{const d=JSON.parse(JSON.stringify(prev));d.parsed.apu.csn=val;return d;});}}/>
  <label className="form-label" style={{margin:0,whiteSpace:"nowrap"}}>APU P/N (enter if not extracted):</label><input type="text" defaultValue={extracted.parsed.apu.pn||""} placeholder="e.g. 3800000-3" style={{width:150,padding:"4px 8px",fontSize:12}} onChange={e=>{const val=e.target.value;setExtracted(prev=>{const d=JSON.parse(JSON.stringify(prev));d.parsed.apu.pn=val;return d;});}}/>
</div>
<table style={{fontSize:11}}><thead><tr><th>Description</th><th>P/N</th><th>S/N</th><th>FC Remaining</th><th>Cycle Limit (edit if OCR wrong)</th></tr></thead><tbody>{extracted.parsed.apu.llps.map((l,j)=>{const col=l.fc_remaining<1000?"#f87171":l.fc_remaining<3000?"#fbbf24":"#34d399";return <tr key={j}><td>{l.desc}</td><td style={{fontFamily:"monospace",fontSize:10}}>{l.pn}</td><td style={{fontFamily:"monospace",fontSize:10}}>{l.sn}</td><td style={{fontWeight:700,color:col}}>{l.fc_remaining?.toLocaleString()}</td><td><input type="number" defaultValue={l.cycle_limit??""} placeholder="N/L" style={{width:80,padding:"3px 6px",fontSize:11}} onChange={e=>{const val=e.target.value===""?null:+e.target.value;setExtracted(prev=>{const d=JSON.parse(JSON.stringify(prev));d.parsed.apu.llps[j].cycle_limit=val;return d;});}}/></td></tr>;})} </tbody></table>
</div>
              )}
            </div>
          ):(
            <div className="grid2" style={{marginTop:14,gap:12}}>
              <div style={{background:"#0d1925",borderRadius:8,padding:12}}>
                <div style={{fontSize:10,fontWeight:700,color:"#C9A84C",textTransform:"uppercase",marginBottom:8}}>Airframe</div>
                {[["MSN",extracted.parsed.msn||matchedAsset?.msn||"—"],["Registration",extracted.parsed.registration||matchedAsset?.registration||"—"],["Matched Aircraft",matchedAsset?`MSN ${matchedAsset.msn} — ${matchedAsset.registration||"—"}`:"Not yet matched"]].map(([l,v])=>(
                  <div key={l} className="flj" style={{padding:"4px 0",borderBottom:"1px solid #1e3048"}}><span style={{fontSize:11,color:"#475569"}}>{l}</span><span style={{fontSize:12,fontWeight:700,color:"#f1f5f9"}}>{v?.toString()||"—"}</span></div>
                ))}
              </div>
              <div style={{background:"#0d1925",borderRadius:8,padding:12}}>
                <div style={{fontSize:10,fontWeight:700,color:"#C9A84C",textTransform:"uppercase",marginBottom:8}}>Engines & APU</div>
                {(()=>{
                  const msn=(extracted.parsed.msn||"").toString().replace(/^0+/,"");
                  const prev=assets.find(a=>a.msn?.toString().replace(/^0+/,"")===msn);
                  const rows=[
                    ["Eng 1 S/N",extracted.parsed.engine1?.sn,prev?.engines?.[0]?.sn,false,true],
                    ["Eng 1 TSN",extracted.parsed.engine1?.tsn,prev?.engines?.[0]?.currentFH?fmtHHMM(prev.engines[0].currentFH):null,false,false],
                    ["Eng 1 CSN",extracted.parsed.engine1?.csn,prev?.engines?.[0]?.currentFC,true,false],
                    ["Eng 2 S/N",extracted.parsed.engine2?.sn,prev?.engines?.[1]?.sn,false,true],
                    ["Eng 2 TSN",extracted.parsed.engine2?.tsn,prev?.engines?.[1]?.currentFH?fmtHHMM(prev.engines[1].currentFH):null,false,false],
                    ["Eng 2 CSN",extracted.parsed.engine2?.csn,prev?.engines?.[1]?.currentFC,true,false],
                    ["APU S/N",extracted.parsed.apu?.sn,prev?.apu?.sn,false,true],
                    ["APU TSN",extracted.parsed.apu?.tsn,prev?.apu?.currentFH?fmtHHMM(prev.apu.currentFH):null,false,false],
                    ["APU CSN",extracted.parsed.apu?.csn,prev?.apu?.currentFC,true,false]
                  ];
                  return rows.map(([l,v,prevV,isNum,isSN])=>{
                    const changed=isSN&&prevV&&v&&String(v)!==String(prevV);
                    const delta=isNum&&v&&prevV?v-prevV:null;
                    const deltaCol=delta===null?"#475569":delta<0?"#f87171":delta>500?"#fbbf24":"#34d399";
                    return<div key={l} className="flj" style={{padding:"5px 6px",borderBottom:"1px solid #1e3048",background:changed?"#2a1400":"transparent",borderRadius:3}}>
                      <span style={{fontSize:11,color:"#5a7a9a"}}>{l}</span>
                      <div style={{textAlign:"right"}}>
                        <span style={{fontSize:12,fontWeight:700,color:changed?"#fbbf24":"#f1f5f9"}}>{v?.toString()||"—"}</span>
                        {changed&&<span style={{fontSize:10,color:"#f87171",marginLeft:6}}>⚠ changed</span>}
                        {delta!==null&&<span style={{fontSize:10,color:deltaCol,marginLeft:6}}>{delta>0?"+":""}{delta}</span>}
                      </div>
                    </div>;
                  });
                })()}
              </div>
              {!saving&&(()=>{
                const msn=(extracted.parsed.msn||"").toString().replace(/^0+/,"");
                const prev=assets.find(a=>a.msn?.toString().replace(/^0+/,"")===msn)||null;
                if(!prev)return null;
                // Use Brain 1's actual verdict so this banner can never disagree
                // with what Confirm & Save is about to do. Gated on !saving above:
                // once a save is in flight, `assets` can update mid-save (saveAsset
                // triggers loadAssets internally), which would otherwise make this
                // preview compare the just-saved asset against itself and falsely
                // read as out-of-order/mismatch for one render. Freezing here avoids
                // that flash; the done-view replaces this panel moments later anyway.
                const preview=window.processUtilisationReport({newReport:extracted.parsed,previousAsset:withNormPeriod(prev)});
                const dc=preview.deltaCheck;
                if(dc.status==="first_report")return null;
                const isProblem=dc.status==="mismatch"||dc.status==="out_of_order"||dc.status==="period_unparseable";
                const isInfo=dc.status==="gap_detected"||dc.status==="same_month_merge";
                const bg=isProblem?"#2a0e0e":isInfo?"#2a1f0a":"#0d2818";
                const border=isProblem?"#7f1d1d":isInfo?"#92660a":"#166534";
                const fg=isProblem?"#f87171":isInfo?"#fbbf24":"#34d399";
                const headline=dc.status==="out_of_order"
                  ?"⚠ Out-of-order upload — this period predates the asset's current data. Will be saved to history only; live state will not change."
                  :dc.status==="mismatch"
                  ?"⚠ Delta mismatch — check report figures"
                  :dc.status==="period_unparseable"
                  ?`⚠ Could not read reporting period (${extracted.parsed.month_year||"blank"} vs ${prev._lastPeriod||"blank"}) — gap could not be determined. Will be saved to history only; live state will not change. Correct the period and re-upload to apply this report.`
                  :dc.status==="same_month_merge"
                  ?"ℹ Same-month merge — this report updates additional fields for a period already on file. Existing data not covered by this report (e.g. a different engine or APU) will be kept, not overwritten."
                  :dc.status==="gap_detected"
                  ?`⚠ Gap detected — ${dc.monthsGap} months since last report. Tolerance widened accordingly.`
                  :"✓ Delta verified — period figures match report";
                // Gap info must show whenever monthsGap>1, regardless of which
                // status "won" above. Previously this was status==="gap_detected"
                // only, which silently hid the gap whenever a mismatch (or any
                // other status) took priority in deltaStatus — even though the
                // gap was real and the widened tolerance was actually applied.
                const showGapLine=dc.monthsGap!==null&&dc.monthsGap>1&&dc.status!=="gap_detected";
                return<div style={{gridColumn:"1/-1",background:bg,border:`1px solid ${border}`,borderRadius:6,padding:"8px 12px"}}>
                  <div style={{fontSize:11,fontWeight:700,color:fg}}>{headline}</div>
                  {showGapLine&&<div style={{fontSize:11,fontWeight:700,color:"#fbbf24",marginTop:4}}>
                    ⚠ Also: gap detected — {dc.monthsGap} months since last report. Delta tolerance was widened accordingly before checking the figures above.
                  </div>}
                  {dc.fc.calc!==null&&<div style={{fontSize:10,color:"#64748b",marginTop:2}}>
                    FC delta: {dc.fc.calc} · Period FC: {dc.fc.reported??"—"} {dc.fc.match===false?"⚠":dc.fc.match===true?"✓":""}
                  </div>}
                  {dc.fh.calc!==null&&<div style={{fontSize:10,color:"#64748b"}}>
                    FH delta: {fmtHHMM(dc.fh.calc)} · Period FH: {extracted.parsed.airframe?.fh_period||"—"} {dc.fh.match===false?"⚠":dc.fh.match===true?"✓":""}
                  </div>}
                </div>;
              })()}
            </div>
          )}
          <div className="flj" style={{marginTop:16,paddingTop:14,borderTop:"1px solid #1e3048"}}>
            <button className="btn btn-ghost" disabled={saving} onClick={()=>{setExtracted(null);setFile(null);}}>Discard</button>
            <button className="btn btn-gold" disabled={saving} onClick={uploadType==="util"?confirmSave:confirmLLP}>{saving?"Saving…":"✓ Confirm & Save"}</button>
          </div>
        </div>
      )}
      {done&&(
        <div style={{background:"#0d2818",border:"1px solid #166534",borderRadius:8,padding:24,textAlign:"center"}}>
          <div style={{fontSize:36,marginBottom:8}}>✅</div>
          <div style={{fontWeight:700,color:"#34d399",fontSize:16,marginBottom:10}}>Saved successfully</div>
          {extracted?.warnings?.length>0&&(
            <div style={{background:"#2a1f0a",border:"1px solid #78350f",borderRadius:6,padding:12,marginBottom:14,textAlign:"left"}}>
              <div style={{fontSize:11,fontWeight:700,color:"#fbbf24",marginBottom:6}}>⚠ Flags to review:</div>
              {(extracted.snChanges||[]).filter(c=>c.component==="engine").map((c,i)=>(
                <EngineSNAction key={"eng"+i} change={c} prevEngines={extracted.prevEngines||[]} mergedAsset={extracted.mergedAsset} saveAsset={saveAsset} notify={notify}/>
              ))}
              {extracted.warnings.filter(w=>!/^⚠ Engine \d+ S\/N change:/.test(w)).map((w,i)=>(
                <div key={i} style={{fontSize:12,color:"#fcd34d",marginBottom:4,lineHeight:1.5}}>{w}</div>
              ))}
            </div>
          )}
          <button className="btn btn-ghost" onClick={()=>{setFile(null);setExtracted(null);setDone(false);}}>Upload Another</button>
        </div>
      )}
      </>)}
    </div>
  );
};


export { EngineSNAction, TabIcon, UploadView };
