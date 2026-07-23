import React, { useState, useEffect, useCallback, useRef } from 'react';
import { db } from '../lib/db';
import { extractDocxSectionChunks, extractPdfPageTexts, isDocxFile, isSupportedLeaseFile, matchAssetForText, quickParseLeaseFile, runLeaseExtraction, scoreLeaseChunks } from '../lib/extraction';
import { BULK_POT_FIELDS, buildPotDefsForActivation, buildPotFromDef, validatePotWithAI } from '../lib/pots';

function BulkLeaseImport({assets,saveAsset,notify}){
  const[tier,setTier]=useState(null); // "quick"|"confidential" — chosen once for the whole batch
  const[queue,setQueue]=useState([]);
  const today=new Date().toISOString().slice(0,10);

  const updateRow=(id,patch)=>setQueue(prev=>prev.map(r=>r.id===id?{...r,...patch}:r));

  // Ingestion: read + score + auto-match, entirely local (no network
  // call for matching itself — extraction only happens once the user
  // acts on a matched row). Runs per-file independently so one bad file
  // never blocks the rest of the batch from being read.
  const processIngest=async(row)=>{
    if(!isSupportedLeaseFile(row.file)){
      updateRow(row.id,{status:"unsupported"});return;
    }
    let chunks;
    try{
      chunks=isDocxFile(row.file)?await extractDocxSectionChunks(row.file):await extractPdfPageTexts(row.file);
    }catch(e){
      updateRow(row.id,{status:"needs-manual-entry"});return;
    }
    const totalText=chunks.map(c=>c.text).join(" ").trim();
    if(totalText.length<40){
      updateRow(row.id,{status:"needs-manual-entry"});return;
    }
    const matched=matchAssetForText(totalText,assets);
    updateRow(row.id,{chunks,candidates:scoreLeaseChunks(chunks),matchedAsset:matched,matchMethod:matched?"auto":null,status:matched?"matched":"unmatched"});
  };

  const handleFiles=(fileList)=>{
    const files=Array.from(fileList||[]);
    if(!files.length)return;
    const rows=files.map((f,i)=>({
      id:`${Date.now()}_${i}_${f.name}`,file:f,name:f.name,
      status:"matching",matchedAsset:null,matchMethod:null,
      chunks:null,candidates:null,selectedChunkId:null,
      parsed:null,editForm:null,error:null
    }));
    setQueue(prev=>[...prev,...rows]);
    rows.forEach(processIngest);
  };

  const assignAsset=(rowId,assetId)=>{
    const asset=assets.find(a=>String(a.id)===String(assetId))||null;
    updateRow(rowId,{matchedAsset:asset,matchMethod:asset?"manual":null,status:asset?"matched":"unmatched"});
  };

  const runExtractQuick=async(row)=>{
    updateRow(row.id,{status:"extracting",error:null});
    try{
      const data=await quickParseLeaseFile(row.file);
      updateRow(row.id,{status:"ready",parsed:data,editForm:{lessee:data.lessee||"",leaseStart:data.leaseStart||"",leaseEnd:data.leaseEnd||"",pots:JSON.parse(JSON.stringify(data.pots||{}))}});
    }catch(e){
      updateRow(row.id,{status:"matched",error:e.message||"Extraction failed. You can try again."});
    }
  };

  const runExtractConfidential=async(row,chunkId)=>{
    updateRow(row.id,{status:"extracting",error:null,selectedChunkId:chunkId});
    try{
      const data=await runLeaseExtraction({type:"text",text:row.chunks[chunkId].text});
      updateRow(row.id,{status:"ready",parsed:data,editForm:{lessee:data.lessee||"",leaseStart:data.leaseStart||"",leaseEnd:data.leaseEnd||"",pots:JSON.parse(JSON.stringify(data.pots||{}))}});
    }catch(e){
      updateRow(row.id,{status:"needs-page",error:e.message||"Extraction failed. Try a different section."});
    }
  };

  const runExtractAllMatched=()=>{
    queue.filter(r=>r.status==="matched").forEach(row=>{
      if(tier==="quick") runExtractQuick(row);
      else updateRow(row.id,{status:"needs-page"});
    });
  };

  const setEditField=(rowId,field,val)=>setQueue(prev=>prev.map(r=>r.id===rowId?{...r,editForm:{...r.editForm,[field]:val}}:r));
  const setEditPot=(rowId,code,val)=>setQueue(prev=>prev.map(r=>r.id===rowId?{...r,editForm:{...r.editForm,pots:{...r.editForm.pots,[code]:val===""?null:{accrualRate:+val}}}}:r));

  // "Save Details for Later" — the original bulk-import behavior: lease
  // record created with the parsed rates persisted as aiPotPrefill, no
  // reserve pot docs written yet. Only lessee is a hard requirement,
  // same relaxation as the single-asset Lease Wizard's details step —
  // lease dates are very often still being finalised.
  const saveDetailsForLater=async(row)=>{
    const f=row.editForm;
    if(!f.lessee?.trim()){
      notify("Enter a lessee before saving","error");return;
    }
    updateRow(row.id,{status:"saving",error:null});
    try{
      const lease=await db.createLease(row.matchedAsset.id,row.matchedAsset.companyId,{
        lessee:f.lessee.trim(),leaseStart:f.leaseStart||"",leaseEnd:f.leaseEnd||"",migrationDate:today,
        aiPotPrefill:f.pots||null
      });
      await saveAsset({...row.matchedAsset,currentLeaseId:lease.id},"Lease added via Bulk Import");
      updateRow(row.id,{status:"saved"});
      notify(`Lease details saved for MSN ${row.matchedAsset.msn} — reserve pots still pending`,"success");
    }catch(e){
      updateRow(row.id,{status:"ready",error:"Save failed — please try again."});
    }
  };

  // "Activate Lease" — does everything in one click: creates the lease
  // record AND writes real reserve pot docs for every rate that was
  // parsed (or edited), using the same structural defaults (trigger
  // basis, escalation regime, cost-range defaults) LeaseWizard's own
  // pots-loading effect would apply. Opening balance is the one thing
  // genuinely left for later — it's asset-specific current reserve
  // state, never present in a lease document. Every candidate pot is
  // run through the same validatePotWithAI sanity check used elsewhere
  // before anything is written; if any are flagged, nothing is
  // committed yet — the row moves to a review step requiring explicit
  // acknowledgment first, same warn-not-block pattern as manual entry.
  const beginActivate=async(row)=>{
    const f=row.editForm;
    if(!f.lessee?.trim()){
      notify("Enter a lessee before activating","error");return;
    }
    updateRow(row.id,{status:"activating",error:null});
    try{
      const defs=buildPotDefsForActivation(row.matchedAsset);
      const rateFor=(def)=>{
        if(f.pots[def.code]?.accrualRate!=null) return f.pots[def.code].accrualRate;
        if(def.code.startsWith("EN-PR-")&&f.pots.ENGINE_RESTORATION?.accrualRate!=null) return f.pots.ENGINE_RESTORATION.accrualRate;
        if(def.code.startsWith("EN-LP-")&&f.pots.ENGINE_LLP?.accrualRate!=null) return f.pots.ENGINE_LLP.accrualRate;
        return null;
      };
      const candidates=defs.map(def=>({code:def.code,pot:buildPotFromDef(def,rateFor(def),today)})).filter(c=>c.pot.accrualRate!=null);
      if(!candidates.length){
        // No rates were parsed for anything at all — nothing to validate
        // or write beyond the lease record itself.
        await commitActivation(row,[]);
        return;
      }
      const results=await Promise.all(candidates.map(c=>validatePotWithAI(c.pot,row.matchedAsset)));
      const flags={};
      const clean=[];
      candidates.forEach((c,i)=>{
        if(results[i].flagged) flags[c.code]={message:results[i].message||"This entry looks unusual — please double check.",acknowledged:false,pot:c.pot};
        else clean.push(c.pot);
      });
      if(Object.keys(flags).length){
        updateRow(row.id,{status:"activate-review",flaggedPots:flags,cleanPots:clean});
        return;
      }
      await commitActivation(row,clean);
    }catch(e){
      updateRow(row.id,{status:"ready",error:"Could not validate rates — please try again."});
    }
  };

  const commitActivation=async(row,potsToSave)=>{
    updateRow(row.id,{status:"activating"});
    try{
      const f=row.editForm;
      const lease=await db.createLease(row.matchedAsset.id,row.matchedAsset.companyId,{
        lessee:f.lessee.trim(),leaseStart:f.leaseStart||"",leaseEnd:f.leaseEnd||"",migrationDate:today,
        aiPotPrefill:f.pots||null
      });
      for(const pot of potsToSave){
        await db.saveReservePot(row.matchedAsset.id,row.matchedAsset.companyId,pot);
      }
      await saveAsset({...row.matchedAsset,currentLeaseId:lease.id},"Lease activated via Bulk Import");
      updateRow(row.id,{status:"activated"});
      notify(`Lease activated for MSN ${row.matchedAsset.msn}${potsToSave.length?` — ${potsToSave.length} reserve pot${potsToSave.length===1?"":"s"} saved`:""}`,"success");
    }catch(e){
      updateRow(row.id,{status:"ready",error:"Activation failed partway through — check this asset's Lease Wizard before retrying, some pots may already be saved."});
    }
  };

  const acknowledgeFlag=(rowId,code,val)=>setQueue(prev=>prev.map(r=>r.id===rowId?{...r,flaggedPots:{...r.flaggedPots,[code]:{...r.flaggedPots[code],acknowledged:val}}}:r));

  const finishActivation=(row)=>{
    const allAck=Object.values(row.flaggedPots).every(fp=>fp.acknowledged);
    if(!allAck){notify("Please acknowledge all flagged rates before finishing","error");return;}
    const flaggedAsPots=Object.values(row.flaggedPots).map(fp=>({...fp.pot,validationWarning:fp.message,warningAcknowledged:true}));
    commitActivation(row,[...(row.cleanPots||[]),...flaggedAsPots]);
  };

  const skipRow=rowId=>updateRow(rowId,{status:"skipped"});
  const removeRow=rowId=>setQueue(prev=>prev.filter(r=>r.id!==rowId));
  const resetBatch=()=>{ if(queue.length&&!confirm("Start over? Any unsaved rows in this batch will be cleared.")) return; setTier(null);setQueue([]); };

  const sortedAssets=[...assets].sort((a,b)=>(a.msn||"").localeCompare(b.msn||"",undefined,{numeric:true}));
  const counts={
    matched:queue.filter(r=>["matched","needs-page","extracting"].includes(r.status)).length,
    needsAssignment:queue.filter(r=>r.status==="unmatched").length,
    needsManualEntry:queue.filter(r=>r.status==="needs-manual-entry"||r.status==="unsupported").length,
    ready:queue.filter(r=>["ready","activating","activate-review"].includes(r.status)).length,
    saved:queue.filter(r=>r.status==="saved").length,
    activated:queue.filter(r=>r.status==="activated").length
  };

  const STATUS_META={
    matching:{label:"Reading & matching…",color:"#94a3b8"},
    unsupported:{label:"⚠ Not a PDF or Word file",color:"#f87171"},
    "needs-manual-entry":{label:"⚠ Needs manual entry — no extractable text (likely scanned)",color:"#fbbf24"},
    unmatched:{label:"Needs manual assignment",color:"#fbbf24"},
    matched:{label:"Matched — ready to extract",color:"#34d399"},
    "needs-page":{label:"Confirm the rate schedule section",color:"#94a3b8"},
    extracting:{label:"Extracting…",color:"#94a3b8"},
    ready:{label:"Parsed — review & save",color:"#60a5fa"},
    saving:{label:"Saving…",color:"#94a3b8"},
    saved:{label:"✓ Details saved — pots pending",color:"#fbbf24"},
    activating:{label:"Activating…",color:"#94a3b8"},
    "activate-review":{label:"⚠ Review flagged rates",color:"#fbbf24"},
    activated:{label:"✓ Lease activated",color:"#34d399"},
    skipped:{label:"Skipped",color:"#475569"}
  };

  if(!tier){
    return(
      <div className="card" style={{padding:24}}>
        <div style={{fontSize:12,color:"#94a3b8",lineHeight:1.6,marginBottom:16}}>
          Import lease documents for multiple aircraft at once. Adding a lease for a single asset? Use the 📄 Lease button on that asset's page instead.
        </div>
        <div style={{fontSize:11,color:"#94a3b8",fontWeight:700,marginBottom:10}}>CHOOSE HOW TO PARSE THIS BATCH (applies to every file)</div>
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          <button className="btn btn-ghost" style={{padding:"12px 14px",textAlign:"left"}} onClick={()=>setTier("quick")}>
            <div style={{fontWeight:700,fontSize:13,color:"#e2e8f0"}}>⚡ Quick Extract</div>
            <div style={{fontSize:11,color:"#64748b",marginTop:2}}>Each whole document is processed automatically in one pass — most complete, since lessee/dates and rates can live on different pages.</div>
          </button>
          <button className="btn btn-ghost" style={{padding:"12px 14px",textAlign:"left"}} onClick={()=>setTier("confidential")}>
            <div style={{fontWeight:700,fontSize:13,color:"#e2e8f0"}}>🔒 Confidential Extract</div>
            <div style={{fontSize:11,color:"#64748b",marginTop:2}}>Nothing is sent until you confirm the rate-schedule section for each document — the rest of every lease stays in your browser.</div>
          </button>
        </div>
      </div>
    );
  }

  return(
    <div>
      <div className="card" style={{padding:16,marginBottom:14}}>
        <div className="flj" style={{alignItems:"center"}}>
          <div style={{fontSize:12,color:"#94a3b8"}}>
            Batch mode: <strong style={{color:"#C9A84C"}}>{tier==="quick"?"⚡ Quick Extract":"🔒 Confidential Extract"}</strong> — adding a lease for one asset? Use the 📄 Lease button on that asset's page instead.
          </div>
          <button className="btn btn-ghost" style={{fontSize:11,whiteSpace:"nowrap"}} onClick={resetBatch}>↺ Start Over</button>
        </div>
      </div>

      <div className="card" style={{padding:24,textAlign:"center",marginBottom:16,border:"2px dashed #1e3048"}}>
        <div style={{fontSize:36,marginBottom:10}}>📁</div>
        <input type="file" multiple accept="application/pdf,.pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" id="bulkleasefile"
          onChange={e=>{handleFiles(e.target.files);e.target.value="";}} style={{display:"none"}}/>
        <label htmlFor="bulkleasefile" style={{cursor:"pointer"}}>
          <div style={{fontWeight:600,color:"#64748b"}}>{queue.length?"Click to add more files":"Click to select lease documents"}</div>
          <div style={{fontSize:12,color:"#475569",marginTop:4}}>Multiple PDF or Word (.docx) files</div>
        </label>
      </div>

      {queue.length>0&&(
        <>
          <div className="flab g8" style={{marginBottom:14,fontSize:11}}>
            {counts.matched>0&&<span className="pill" style={{background:"#0d2818",color:"#34d399"}}>{counts.matched} matched</span>}
            {counts.needsAssignment>0&&<span className="pill" style={{background:"#2a220e",color:"#fbbf24"}}>{counts.needsAssignment} needs assignment</span>}
            {counts.needsManualEntry>0&&<span className="pill" style={{background:"#2a0e0e",color:"#f87171"}}>{counts.needsManualEntry} needs manual entry</span>}
            {counts.ready>0&&<span className="pill" style={{background:"#0d1e2e",color:"#60a5fa"}}>{counts.ready} ready to save</span>}
            {counts.saved>0&&<span className="pill" style={{background:"#2a220e",color:"#fbbf24"}}>{counts.saved} saved (pots pending)</span>}
            {counts.activated>0&&<span className="pill" style={{background:"#0d2818",color:"#34d399"}}>{counts.activated} activated</span>}
          </div>

          {counts.matched>1&&(
            <button className="btn btn-gold" style={{marginBottom:14}} onClick={runExtractAllMatched}>
              {tier==="quick"?`⚡ Extract All ${counts.matched} Matched Files`:`🔒 Confirm Sections for All ${counts.matched} Matched Files`}
            </button>
          )}

          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {queue.map(row=>{
              const meta=STATUS_META[row.status]||{label:row.status,color:"#94a3b8"};
              return(
                <div key={row.id} className="card" style={{padding:14,opacity:row.status==="skipped"?0.5:1}}>
                  <div className="flj" style={{alignItems:"center",marginBottom:8}}>
                    <div style={{fontSize:12,fontWeight:700,color:"#e2e8f0",wordBreak:"break-all"}}>{row.name}</div>
                    <span style={{fontSize:11,color:meta.color,whiteSpace:"nowrap",marginLeft:10}}>{meta.label}</span>
                  </div>

                  {row.status==="unsupported"&&(
                    <div className="flj" style={{alignItems:"center"}}>
                      <div style={{fontSize:11,color:"#64748b"}}>Not a PDF or Word (.docx) document.</div>
                      <button className="btn btn-ghost" style={{fontSize:11}} onClick={()=>removeRow(row.id)}>Remove</button>
                    </div>
                  )}

                  {row.status==="needs-manual-entry"&&(
                    <div>
                      <div style={{fontSize:11,color:"#64748b",marginBottom:8}}>No extractable text found — likely scanned or image-only. Open the matching asset's own Lease Wizard to enter this one manually.</div>
                      <div className="flj" style={{alignItems:"center",gap:8}}>
                        <select style={{fontSize:12,flex:1}} defaultValue="" onChange={e=>assignAsset(row.id,e.target.value)}>
                          <option value="" disabled>Which aircraft is this for? (optional)</option>
                          {sortedAssets.map(a=><option key={a.id} value={a.id}>MSN {a.msn} — {a.registration||"—"}</option>)}
                        </select>
                        <button className="btn btn-ghost" style={{fontSize:11,whiteSpace:"nowrap"}} onClick={()=>removeRow(row.id)}>Remove</button>
                      </div>
                    </div>
                  )}

                  {row.status==="unmatched"&&(
                    <div className="flj" style={{alignItems:"center",gap:8}}>
                      <select style={{fontSize:12,flex:1}} defaultValue="" onChange={e=>assignAsset(row.id,e.target.value)}>
                        <option value="" disabled>No automatic match — assign an aircraft</option>
                        {sortedAssets.map(a=><option key={a.id} value={a.id}>MSN {a.msn} — {a.registration||"—"}</option>)}
                      </select>
                      <button className="btn btn-ghost" style={{fontSize:11,whiteSpace:"nowrap"}} onClick={()=>skipRow(row.id)}>Skip</button>
                    </div>
                  )}

                  {row.status==="skipped"&&(
                    <div className="flj" style={{alignItems:"center"}}>
                      <div style={{fontSize:11,color:"#475569"}}>Skipped — not imported.</div>
                      <button className="btn btn-ghost" style={{fontSize:11}} onClick={()=>updateRow(row.id,{status:"unmatched"})}>Undo</button>
                    </div>
                  )}

                  {(row.status==="matched"||row.status==="extracting")&&(
                    <div>
                      <div className="flj" style={{alignItems:"center",gap:8,marginBottom:row.status==="matched"?8:0}}>
                        <div style={{fontSize:12,color:"#94a3b8"}}>
                          Matched: <strong style={{color:"#f1f5f9"}}>MSN {row.matchedAsset.msn} — {row.matchedAsset.registration||"—"}</strong>
                          {row.matchMethod==="auto"&&<span style={{fontSize:10,color:"#475569"}}> (auto)</span>}
                        </div>
                        {row.status==="matched"&&(
                          <select style={{fontSize:11,width:160}} value={row.matchedAsset.id} onChange={e=>assignAsset(row.id,e.target.value)}>
                            {sortedAssets.map(a=><option key={a.id} value={a.id}>MSN {a.msn} — {a.registration||"—"}</option>)}
                          </select>
                        )}
                      </div>
                      {row.status==="matched"&&(
                        <button className="btn btn-gold" style={{fontSize:12}} onClick={()=>tier==="quick"?runExtractQuick(row):updateRow(row.id,{status:"needs-page"})}>
                          {tier==="quick"?"⚡ Extract":"🔒 Choose Rate Schedule Section"}
                        </button>
                      )}
                      {row.status==="extracting"&&<div style={{fontSize:11,color:"#94a3b8",marginTop:6}}>Extracting…</div>}
                      {row.error&&<div style={{fontSize:11,color:"#f87171",marginTop:6}}>{row.error}</div>}
                    </div>
                  )}

                  {row.status==="needs-page"&&(
                    <div>
                      <div style={{fontSize:11,color:"#94a3b8",marginBottom:8}}>Confirm which page/section has the reserve rate schedule for MSN {row.matchedAsset.msn}. Only that part is sent — the rest stays in your browser.</div>
                      {row.candidates.filter(c=>c.score>0).length===0&&(
                        <div style={{fontSize:11,color:"#fbbf24",marginBottom:8}}>Nothing stood out automatically — showing everything below.</div>
                      )}
                      <div style={{display:"flex",flexDirection:"column",gap:6,maxHeight:220,overflow:"auto"}}>
                        {(row.candidates.filter(c=>c.score>0).length?row.candidates.filter(c=>c.score>0):row.candidates).map(c=>(
                          <button key={c.id} className="btn btn-ghost" style={{padding:"8px 10px",textAlign:"left"}} onClick={()=>runExtractConfidential(row,c.id)}>
                            <div style={{fontWeight:700,fontSize:11,color:"#e2e8f0"}}>{c.label}</div>
                            <div style={{fontSize:10,color:"#64748b",marginTop:2}}>{c.snippet||"(no extractable text found here)"}</div>
                          </button>
                        ))}
                      </div>
                      {row.error&&<div style={{fontSize:11,color:"#f87171",marginTop:8}}>{row.error}</div>}
                      <button className="btn btn-ghost" style={{fontSize:11,marginTop:8}} onClick={()=>updateRow(row.id,{status:"matched"})}>← Back</button>
                    </div>
                  )}

                  {row.status==="ready"&&(
                    <div>
                      <div style={{fontSize:11,color:"#94a3b8",marginBottom:6}}>MSN {row.matchedAsset.msn} — {row.matchedAsset.registration||"—"}. Review before saving.</div>
                      <div className="grid2" style={{gap:8,marginBottom:8}}>
                        <div>
                          <label className="form-label" style={{fontSize:10}}>Lessee</label>
                          <input type="text" value={row.editForm.lessee} onChange={e=>setEditField(row.id,"lessee",e.target.value)} style={{fontSize:12}}/>
                        </div>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                          <div><label className="form-label" style={{fontSize:10}}>Lease Start</label><input type="date" value={row.editForm.leaseStart} onChange={e=>setEditField(row.id,"leaseStart",e.target.value)} style={{fontSize:12}}/></div>
                          <div><label className="form-label" style={{fontSize:10}}>Lease End</label><input type="date" value={row.editForm.leaseEnd} onChange={e=>setEditField(row.id,"leaseEnd",e.target.value)} style={{fontSize:12}}/></div>
                        </div>
                      </div>
                      <div style={{fontSize:10,color:"#94a3b8",fontWeight:700,marginBottom:4}}>RESERVE RATES</div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:8}}>
                        {BULK_POT_FIELDS.map(([code,label])=>(
                          <div key={code} className="flj" style={{alignItems:"center",background:"#0d1622",borderRadius:6,padding:"6px 8px"}}>
                            <span style={{fontSize:11,color:"#94a3b8"}}>{label}</span>
                            <input type="number" placeholder="—" value={row.editForm.pots[code]?.accrualRate??""} onChange={e=>setEditPot(row.id,code,e.target.value)} style={{width:80,padding:"3px 6px",fontSize:11}}/>
                          </div>
                        ))}
                      </div>
                      {row.parsed?.notes&&<div style={{fontSize:11,color:"#fbbf24",marginBottom:8}}>ℹ {row.parsed.notes}</div>}
                      {row.error&&<div style={{fontSize:11,color:"#f87171",marginBottom:8}}>{row.error}</div>}
                      <div style={{fontSize:10,color:"#475569",marginBottom:8}}>Opening balances aren't captured here — either path leaves them for this asset's own Lease Wizard.</div>
                      <div style={{display:"flex",gap:8}}>
                        <button className="btn btn-ghost" style={{fontSize:12,flex:1}} onClick={()=>saveDetailsForLater(row)}>💾 Save Details for Later</button>
                        <button className="btn btn-gold" style={{fontSize:12,flex:1}} onClick={()=>beginActivate(row)}>⚡ Activate Lease</button>
                      </div>
                    </div>
                  )}

                  {row.status==="activating"&&<div style={{fontSize:11,color:"#94a3b8"}}>Validating rates and activating…</div>}
                  {row.status==="saving"&&<div style={{fontSize:11,color:"#94a3b8"}}>Saving…</div>}

                  {row.status==="activate-review"&&row.flaggedPots&&(
                    <div>
                      <div style={{fontSize:11,color:"#94a3b8",marginBottom:8}}>These rates were flagged as unusual — review and acknowledge each one before finishing activation. Nothing has been saved yet.</div>
                      <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:10}}>
                        {Object.entries(row.flaggedPots).map(([code,fp])=>(
                          <div key={code} style={{background:"#2a1f0a",border:"1px solid #78350f",borderRadius:6,padding:10}}>
                            <div style={{fontSize:11,fontWeight:700,color:"#fbbf24",marginBottom:4}}>{code} — ${fp.pot.accrualRate}{fp.pot.accrualBasis==="per_FC"?"/FC":fp.pot.accrualBasis==="per_FH"?"/FH":""}</div>
                            <div style={{fontSize:11,color:"#e2e8f0",marginBottom:6}}>{fp.message}</div>
                            <label style={{display:"flex",alignItems:"center",gap:6,fontSize:11,color:"#94a3b8",cursor:"pointer"}}>
                              <input type="checkbox" checked={fp.acknowledged} onChange={e=>acknowledgeFlag(row.id,code,e.target.checked)}/>
                              I've checked this against the lease — save anyway
                            </label>
                          </div>
                        ))}
                      </div>
                      {row.error&&<div style={{fontSize:11,color:"#f87171",marginBottom:8}}>{row.error}</div>}
                      <div style={{display:"flex",gap:8}}>
                        <button className="btn btn-ghost" style={{fontSize:12,flex:1}} onClick={()=>updateRow(row.id,{status:"ready"})}>← Back to Edit</button>
                        <button className="btn btn-gold" style={{fontSize:12,flex:1}} disabled={!Object.values(row.flaggedPots).every(fp=>fp.acknowledged)} onClick={()=>finishActivation(row)}>Finish Activation</button>
                      </div>
                    </div>
                  )}

                  {row.status==="saved"&&(
                    <div style={{fontSize:11,color:"#94a3b8"}}>
                      Lease details saved for MSN {row.matchedAsset.msn} — reserve pots not yet written. Open that asset's page and use the 📄 Lease button to confirm rates, enter opening balances, and complete the reserve pots.
                    </div>
                  )}

                  {row.status==="activated"&&(
                    <div style={{fontSize:11,color:"#94a3b8"}}>
                      Lease activated for MSN {row.matchedAsset.msn} — reserve pots saved with the rates above. Opening balances still need entering via that asset's own Lease Wizard.
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


export { BulkLeaseImport };
