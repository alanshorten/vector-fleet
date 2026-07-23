import React, { useState, useEffect, useCallback, useRef } from 'react';
import { PotRow } from './AssetView';
import { isCFM } from '../lib/assetHelpers';
import { db } from '../lib/db';
import { extractDocxSectionChunks, extractPdfPageTexts, isDocxFile, isSupportedLeaseFile, quickParseLeaseFile, runLeaseExtraction, scoreLeaseChunks } from '../lib/extraction';
import { FIXED_RESERVE_POT_DEFS, buildRealEnginePotDefs, validatePotWithAI } from '../lib/pots';

function LeaseWizard({asset,saveAsset,notify,onClose}){
  const[step,setStep]=useState(asset.currentLeaseId?"loading":"tier");
  const today=new Date().toISOString().slice(0,10);
  const[form,setForm]=useState({lessee:"",leaseStart:"",leaseEnd:"",migrationDate:today});
  const[originalLease,setOriginalLease]=useState(null); // the lease doc as loaded, for diffing on Activate
  const set=(k,v)=>setForm({...form,[k]:v});
  // Only lessee is a hard requirement to proceed to Reserve Pots — lease
  // start/end are very often still being finalised (or genuinely unknown
  // at migration time) and shouldn't block getting reserve rates entered.
  // migrationDate always has a today default so it's never actually the
  // blocker in practice; kept in the check for clarity/documentation.
  const canContinue=form.lessee.trim()&&form.migrationDate;

  const[pots,setPots]=useState(null); // null = not yet loaded
  const[customCode,setCustomCode]=useState("");
  const[customLabel,setCustomLabel]=useState("");
  const[activating,setActivating]=useState(false);
  const[deleting,setDeleting]=useState(false);

  // Path 1 — AI-assisted parse state. aiPotPrefill holds parsed pot
  // rates awaiting confirmation; applied once into the pots-loading
  // effect below (details step), never overwriting an existing saved
  // pot value. See lease-upload-path1-design-handoff.md.
  const[aiFile,setAiFile]=useState(null);
  const[aiBusy,setAiBusy]=useState(false);
  const[aiError,setAiError]=useState(null);
  const[aiCandidates,setAiCandidates]=useState(null); // scored pages, Privacy tier only
  const[aiAllPages,setAiAllPages]=useState(null); // full page text list, Privacy tier only
  const[aiResult,setAiResult]=useState(null); // parsed {lessee,leaseStart,leaseEnd,pots,notes} awaiting review
  const[aiPotPrefill,setAiPotPrefill]=useState(null); // confirmed result's .pots, applied once in the pots effect
  const[tierInfoOpen,setTierInfoOpen]=useState(null); // "manual"|"quick"|"privacy"|null — which tier's expanded detail is showing

  // If this asset already has a current lease, land on an overview
  // screen first — never silently skip into pot entry, so the lease's
  // existence, its details, and the Delete action are always visible
  // and obvious before diving into anything else.
  useEffect(()=>{
    if(!asset.currentLeaseId){ if(step==="loading") setStep("tier"); return; }
    (async()=>{
      const lease=await db.getLease(asset.currentLeaseId).catch(()=>null);
      if(lease){
        setForm({lessee:lease.lessee||"",leaseStart:lease.leaseStart||"",leaseEnd:lease.leaseEnd||"",migrationDate:lease.migrationDate||today});
        setOriginalLease(lease);
        setStep("overview");
      }else{
        setStep("details");
      }
    })();
  },[]);

  useEffect(()=>{
    if((step!=="pots"&&step!=="overview")||pots) return;
    (async()=>{
      const existingPots=await db.getReservePots(asset.id).catch(()=>[]);
      const existingByCode={};
      existingPots.forEach(p=>{existingByCode[p.code]=p;});
      const cfm=isCFM(asset);
      const engineFamily=cfm?"CFM":"V2500";
      const catalogueEsc=window.LLP_CATALOGUE_PRICES?.[engineFamily]?.escalationPctPerYr;
      const baseDefs=[...FIXED_RESERVE_POT_DEFS,...buildRealEnginePotDefs(asset)];
      const customDefs=existingPots.filter(p=>p.potCategory==="custom"&&!baseDefs.some(d=>d.code===p.code))
        .map(p=>({code:p.code,label:p.label,potCategory:"custom",enginePosition:null,accrualBasis:p.accrualBasis}));
      // AI-prefilled accrual rate for a given pot code, or "" if none —
      // only ever used when there's no existing saved value (ex is
      // falsy or ex.accrualRate is empty), so a confirmed manual entry
      // is never silently overwritten by a Quick/Privacy Parse result.
      // Falls back to the lease record's own persisted aiPotPrefill
      // (set by Bulk Lease Import, Section 8) when this session hasn't
      // run its own parse — same shape, same precedence rules either way.
      const effectivePrefill=aiPotPrefill||originalLease?.aiPotPrefill||null;
      const aiRateFor=code=>{
        if(!effectivePrefill) return "";
        if(effectivePrefill[code]?.accrualRate!=null) return effectivePrefill[code].accrualRate;
        if(code.startsWith("EN-PR-")&&effectivePrefill.ENGINE_RESTORATION?.accrualRate!=null) return effectivePrefill.ENGINE_RESTORATION.accrualRate;
        if(code.startsWith("EN-LP-")&&effectivePrefill.ENGINE_LLP?.accrualRate!=null) return effectivePrefill.ENGINE_LLP.accrualRate;
        return "";
      };
      const merged={};
      [...baseDefs,...customDefs].forEach(def=>{
        const ex=existingByCode[def.code];
        merged[def.code]={
          ...def,
          // Existing saved pots must keep whatever accrualBasis is
          // actually live in Firestore — NOT silently reset to this
          // session's corrected default the next time the wizard is
          // reopened. Bug found and fixed alongside the default
          // correction itself (TECH_DEBT.md — accrualBasis fix, July
          // 2026): before this, accrualBasis came unconditionally from
          // `def`, so any already-confirmed real pot's actual saved
          // value would be silently overwritten the next time ANY field
          // on that pot was re-saved, with no review step. A pot with
          // the old wrong default already saved to Firestore needs a
          // deliberate, reviewed correction — not an accidental one from
          // touching an unrelated field.
          accrualBasis: ex?.accrualBasis ?? def.accrualBasis,
          accrualRate: ex?ex.accrualRate:aiRateFor(def.code),
          accrualRateBaseYear: ex?(ex.accrualRateBaseYear||new Date().getFullYear()):new Date().getFullYear(),
          escalationPctPerYr: ex?ex.escalationPctPerYr:(def.potCategory==="engine"?(catalogueEsc??2.5):2.5),
          openingBalance: ex?ex.openingBalance:"",
          openingBalanceAsOf: ex?(ex.openingBalanceAsOf||today):today,

          // Outflow side. triggerBasis/triggerInterval/escalationRegime
          // are STRUCTURAL for fixed/engine pots (drawn from def, not
          // user-editable — see FIXED_RESERVE_POT_DEFS/buildRealEnginePotDefs
          // comments). Custom pots have no structural definition, so they
          // get an editable generic calendar default instead of being
          // invisible to Fly-Forward entirely.
          //
          // Uses ?? (not the ex? ternary used above for accrual fields)
          // because pots saved BEFORE this session's schema extension
          // have a doc (ex is truthy) but genuinely lack these fields —
          // ex.triggerBasis on such a doc is undefined, not a real
          // "user chose nothing" value, so it must still fall through to
          // the structural/default value rather than staying undefined.
          triggerBasis: ex?.triggerBasis ?? def.triggerBasis ?? "calendar_months",
          triggerInterval: ex?.triggerInterval ?? def.triggerInterval ?? { months: 72 },
          outflowEscalationPct: ex?.outflowEscalationPct ?? def.outflowEscalationPct ?? 2.5,
          outflowCostBaseYear: ex?.outflowCostBaseYear ?? new Date().getFullYear(),
          projectedCostLow: ex?.projectedCostLow ?? def.defaultCostLow ?? "",
          projectedCostHigh: ex?.projectedCostHigh ?? def.defaultCostHigh ?? "",
          escalationRegime: def.escalationRegime || "flat_annual",
          catalogueRef: def.catalogueRef || null,

          // EN-LP only — stack-simulation parameters
          harvestThresholdFC: ex?.harvestThresholdFC ?? def.defaultHarvestThresholdFC ?? 2000,
          stubBufferPct: ex?.stubBufferPct ?? def.defaultStubBufferPct ?? 10,
          fullStackReplacementCost: def.fullStackReplacementCost ?? null,
          engineFamily: def.engineFamily || null,

          // EN-PR only — first-PR anchoring. "infer" derives timing from
          // openingBalance/accrualRate (no extra entry needed); "manual"
          // uses an explicitly entered last-PR date instead.
          anchorMode: ex?.anchorMode ?? def.anchorMode ?? "infer",
          lastPRDate: ex?.lastPRDate ?? "",

          // A doc saved before this session's schema extension exists
          // (ex is truthy) but lacks triggerBasis entirely — it is NOT
          // treated as complete here, even though its accrual fields are
          // fine, because Fly-Forward can't project it without the
          // outflow side. The fields above are now correctly backfilled
          // with structural/default values for review, but `saved` stays
          // false until the user actually re-saves this pot — that's
          // what persists the backfilled fields to Firestore and is what
          // fixes the pot for Fly-Forward (see reconstructPot / FlyForward,
          // which otherwise treat a triggerBasis-less doc as unconfirmed).
          saved: !!ex && !!ex.triggerBasis,
          savedId: ex?ex.id:null,
          validationWarning: ex?(ex.validationWarning||null):null,
          warningAcknowledged: ex?!!ex.warningAcknowledged:false,
          validationChecked: !!ex,
          checking:false
        };
      });
      setPots(merged);
    })();
  },[step]);

  const setPotField=(code,field,val)=>setPots(prev=>({...prev,[code]:{...prev[code],[field]:val,saved:false,validationChecked:false,validationWarning:null,warningAcknowledged:false}}));
  const acknowledgePot=(code,val)=>setPots(prev=>({...prev,[code]:{...prev[code],warningAcknowledged:val}}));

  const addCustomPot=()=>{
    const code=customCode.trim().toUpperCase();
    const label=customLabel.trim();
    if(!code||!label){notify("Enter both a code and a label for the custom pot","error");return;}
    if(pots[code]){notify("A pot with that code already exists","error");return;}
    setPots(prev=>({...prev,[code]:{code,label,potCategory:"custom",enginePosition:null,accrualBasis:"per_FH",accrualRate:"",accrualRateBaseYear:new Date().getFullYear(),escalationPctPerYr:2.5,openingBalance:"",openingBalanceAsOf:today,
      triggerBasis:"calendar_months",triggerInterval:{months:72},outflowEscalationPct:2.5,outflowCostBaseYear:new Date().getFullYear(),projectedCostLow:"",projectedCostHigh:"",escalationRegime:"flat_annual",catalogueRef:null,
      saved:false,savedId:null,validationWarning:null,warningAcknowledged:false,validationChecked:false,checking:false}}));
    setCustomCode("");setCustomLabel("");
  };

  const savePot=async(code)=>{
    const p=pots[code];
    if(p.accrualRate===""){notify("Enter an accrual rate first","error");return;}
    // Opening balance is optional — many pots genuinely start from an
    // unknown or not-yet-confirmed reserve balance, and blocking save on
    // it forced an arbitrary placeholder just to get the rate/trigger
    // data saved. Defaults to 0 (a real, valid starting balance) rather
    // than staying an empty string, which Fly-Forward would otherwise
    // need to coerce anyway. Accrual rate stays required — a $0-rate pot
    // is not a meaningful financial input the way a $0 balance is.
    if(p.triggerBasis!=="llp_cycles"&&(p.projectedCostLow===""||p.projectedCostHigh==="")){notify("Enter an outflow cost range first","error");return;}
    if(p.triggerBasis==="engine_fh"&&(!p.triggerInterval?.fh)){notify("Enter a PR interval (FH) first","error");return;}
    if(p.validationWarning&&!p.warningAcknowledged){notify("Please review and acknowledge the flagged warning before saving","error");return;}
    setPots(prev=>({...prev,[code]:{...prev[code],checking:true}}));
    let warning=p.validationWarning;
    if(!p.validationChecked){
      const result=await validatePotWithAI(p,asset);
      warning=result.flagged?(result.message||"This entry looks unusual — please double check."):null;
      if(result.flagged){
        setPots(prev=>({...prev,[code]:{...prev[code],checking:false,validationChecked:true,validationWarning:warning,warningAcknowledged:false}}));
        notify("This entry was flagged — review and acknowledge to save","error");
        return;
      }
    }
    try{
      const openingBalanceToSave=p.openingBalance===""?0:p.openingBalance;
      const saved=await db.saveReservePot(asset.id,asset.companyId,{...p,code,openingBalance:openingBalanceToSave,validationWarning:warning||null,warningAcknowledged:!!p.warningAcknowledged});
      setPots(prev=>({...prev,[code]:{...prev[code],checking:false,saved:true,savedId:saved.id,openingBalance:openingBalanceToSave,validationChecked:true,validationWarning:warning||null}}));
      notify(`${code} saved`,"success");
    }catch(e){
      setPots(prev=>({...prev,[code]:{...prev[code],checking:false}}));
      notify(`Failed to save ${code}`,"error");
    }
  };

  // Only writes a NEW append-only lease record if the details actually
  // changed from what was loaded — otherwise this is purely a pot-entry
  // pass and the existing lease record (and currentLeaseId) is left
  // alone, avoiding a pointless duplicate history entry every time the
  // wizard is reopened just to fill in more pots.
  const leaseUnchanged = originalLease
    && originalLease.lessee===form.lessee
    && originalLease.leaseStart===form.leaseStart
    && originalLease.leaseEnd===form.leaseEnd
    && originalLease.migrationDate===form.migrationDate;

  const activate=async()=>{
    setActivating(true);
    try{
      if(leaseUnchanged){
        notify("Reserve pots updated — lease details unchanged","success");
      }else{
        const lease=await db.createLease(asset.id,asset.companyId,form);
        await saveAsset({...asset,currentLeaseId:lease.id});
        notify(originalLease?"Lease updated (new record created)":"Lease activated","success");
      }
      onClose();
    }catch(e){
      notify("Failed to activate lease","error");
    }
    setActivating(false);
  };

  const deleteLease=async()=>{
    if(!originalLease) return;
    if(!confirm(`Delete this lease record for ${originalLease.lessee}? Reserve pot balances are NOT affected — only the lease record itself is removed.`)) return;
    setDeleting(true);
    try{
      await db.deleteLease(originalLease.id);
      await saveAsset({...asset,currentLeaseId:null});
      notify("Lease deleted","success");
      onClose();
    }catch(e){
      notify("Failed to delete lease","error");
    }
    setDeleting(false);
  };

  // ===== Path 1 handlers — see lease-upload-path1-design-handoff.md =====

  // Quick Extract: whole document sent for extraction in one pass.
  // PDFs go as a native document block; Word docs have no such content
  // type, so their text is pulled out client-side via mammoth.js first
  // and sent as plain text instead — same "whole document, one pass"
  // behavior either way.
  const runQuickParse=async(file)=>{
    if(!isSupportedLeaseFile(file)){
      setAiError("That doesn't look like a PDF or Word (.docx) file. Please choose the lease document, or switch to manual entry.");return;
    }
    setAiFile(file);setAiBusy(true);setAiError(null);
    try{
      const data=await quickParseLeaseFile(file);
      setAiResult(data);setStep("ai-review");
    }catch(e){
      setAiError(e.message||"Could not parse this document. You can try again or switch to manual entry.");
    }
    setAiBusy(false);
  };

  // Confidential Extract step 1: extract text entirely client-side (no
  // network call yet) — page by page for PDFs, section by section
  // (Word's own heading styles) for Word docs — and score the chunks
  // for the likely rate-schedule location before anything is sent.
  const handlePrivacyFile=async(file)=>{
    if(!isSupportedLeaseFile(file)){
      setAiError("That doesn't look like a PDF or Word (.docx) file. Please choose the lease document, or switch to manual entry.");return;
    }
    setAiFile(file);setAiBusy(true);setAiError(null);
    try{
      const chunks=isDocxFile(file)?await extractDocxSectionChunks(file):await extractPdfPageTexts(file);
      setAiAllPages(chunks);
      setAiCandidates(scoreLeaseChunks(chunks));
      setStep("privacy-pages");
    }catch(e){
      setAiError(e.message||"Could not read this document. You can try again or switch to manual entry.");
    }
    setAiBusy(false);
  };

  // Confidential Extract step 2: ONLY the confirmed page/section's
  // text — not the rest of the document — is sent for extraction as
  // plain text. This is the entire privacy guarantee in one line: the
  // file itself, and every other page/section, never leave the browser.
  const runPrivacyParse=async(chunkId)=>{
    setAiBusy(true);setAiError(null);
    try{
      const chunkText=aiAllPages[chunkId].text;
      const data=await runLeaseExtraction({type:"text",text:chunkText});
      setAiResult(data);setStep("ai-review");
    }catch(e){
      setAiError(e.message||"Could not parse this section. You can try a different one or switch to manual entry.");
    }
    setAiBusy(false);
  };

  // User has reviewed the ai-review screen and confirmed the parsed
  // figures are correct enough to use as a starting point. Lessee/dates
  // prefill the details form (still fully editable there); pot rates
  // are handed to the pots-loading effect via aiPotPrefill, which only
  // ever fills genuinely blank fields — never overwrites a saved pot.
  const acceptAiResult=()=>{
    setForm(f=>({...f,
      lessee: aiResult.lessee||f.lessee,
      leaseStart: aiResult.leaseStart||f.leaseStart,
      leaseEnd: aiResult.leaseEnd||f.leaseEnd
    }));
    setAiPotPrefill(aiResult.pots||{});
    setStep("details");
  };

  const potList=pots?Object.values(pots):[];
  const counts={
    green: potList.filter(p=>p.saved&&!(p.validationWarning&&!p.warningAcknowledged)).length,
    amber: potList.filter(p=>(!p.saved&&(p.accrualRate!==""||p.openingBalance!==""))||(p.saved&&p.validationWarning&&!p.warningAcknowledged)).length,
    red: potList.filter(p=>!p.saved&&p.accrualRate===""&&p.openingBalance==="").length
  };

  const stepMeta={
    tier:{label:"How would you like to add this lease?",num:null},
    "quick-upload":{label:"Quick Extract — Upload Lease PDF",num:null},
    "privacy-upload":{label:"Confidential Extract — Upload Lease PDF",num:null},
    "privacy-pages":{label:"Confidential Extract — Confirm Page",num:null},
    "ai-review":{label:"Review Parsed Figures",num:null},
    overview:{label:"Current Lease",num:null},
    details:{label:"Lease Details",num:1},
    pots:{label:"Reserve Pot Entry",num:2},
    confirm:{label:"Confirm & Activate",num:3}
  };

  return(
    <div style={{position:"fixed",inset:0,background:"rgba(5,10,16,0.7)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:20}} onClick={onClose}>
      <div className="card" style={{width:step==="pots"?680:480,maxWidth:"94vw",maxHeight:"90vh",overflow:"auto",padding:24}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
          <h2 style={{fontSize:15,color:"#C9A84C",fontWeight:700}}>Lease / Reserve Setup — MSN {asset.msn}</h2>
          <button className="btn btn-ghost" style={{padding:"4px 10px"}} onClick={onClose}>✕</button>
        </div>
        <div style={{fontSize:11,color:"#475569",marginBottom:18}}>
          {step==="loading"?"Loading current lease…":(stepMeta[step].num?`Step ${stepMeta[step].num} of 3 — ${stepMeta[step].label}`:stepMeta[step].label)}
        </div>

        {step==="loading"&&<div style={{color:"#475569",fontSize:12}}>Loading…</div>}

        {step==="tier"&&(
          <>
            <div style={{fontSize:12,color:"#94a3b8",lineHeight:1.6,marginBottom:16}}>
              Choose how you'd like to add this lease's details and reserve rates.
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              <button className="btn btn-ghost" style={{padding:"12px 14px",textAlign:"left"}} onClick={()=>setStep("details")}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div style={{fontWeight:700,fontSize:13,color:"#e2e8f0"}}>✏ Manual Entry</div>
                  <span role="button" tabIndex={0} onClick={e=>{e.stopPropagation();setTierInfoOpen(tierInfoOpen==="manual"?null:"manual");}}
                    style={{display:"flex",alignItems:"center",gap:3,color:"#60a5fa",fontSize:11,fontWeight:600,cursor:"pointer"}}>
                    Details<span style={{display:"inline-block",transition:"transform 0.15s",transform:tierInfoOpen==="manual"?"rotate(180deg)":"rotate(0deg)",fontSize:9}}>▾</span>
                  </span>
                </div>
                <div style={{fontSize:11,color:"#64748b",marginTop:2}}>Type in lease details and reserve rates yourself.</div>
                {tierInfoOpen==="manual"&&<div style={{fontSize:11,color:"#64748b",marginTop:6,paddingTop:6,borderTop:"1px solid #1e293b"}}>No automated extraction, no document upload — everything is entered by hand on the next screen.</div>}
              </button>
              <button className="btn btn-ghost" style={{padding:"12px 14px",textAlign:"left"}} onClick={()=>{setAiError(null);setStep("quick-upload");}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div style={{fontWeight:700,fontSize:13,color:"#e2e8f0"}}>⚡ Quick Extract</div>
                  <span role="button" tabIndex={0} onClick={e=>{e.stopPropagation();setTierInfoOpen(tierInfoOpen==="quick"?null:"quick");}}
                    style={{display:"flex",alignItems:"center",gap:3,color:"#60a5fa",fontSize:11,fontWeight:600,cursor:"pointer"}}>
                    Details<span style={{display:"inline-block",transition:"transform 0.15s",transform:tierInfoOpen==="quick"?"rotate(180deg)":"rotate(0deg)",fontSize:9}}>▾</span>
                  </span>
                </div>
                <div style={{fontSize:11,color:"#64748b",marginTop:2}}>Upload the lease document — details and rates are extracted automatically in one pass.</div>
                {tierInfoOpen==="quick"&&<div style={{fontSize:11,color:"#64748b",marginTop:6,paddingTop:6,borderTop:"1px solid #1e293b"}}>The fastest and most complete option: because the whole document is processed at once, it can find the lessee and lease dates as well as the rate schedule, which live on different pages of most leases.</div>}
              </button>
              <button className="btn btn-ghost" style={{padding:"12px 14px",textAlign:"left"}} onClick={()=>{setAiError(null);setStep("privacy-upload");}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div style={{fontWeight:700,fontSize:13,color:"#e2e8f0"}}>🔒 Confidential Extract</div>
                  <span role="button" tabIndex={0} onClick={e=>{e.stopPropagation();setTierInfoOpen(tierInfoOpen==="privacy"?null:"privacy");}}
                    style={{display:"flex",alignItems:"center",gap:3,color:"#60a5fa",fontSize:11,fontWeight:600,cursor:"pointer"}}>
                    Details<span style={{display:"inline-block",transition:"transform 0.15s",transform:tierInfoOpen==="privacy"?"rotate(180deg)":"rotate(0deg)",fontSize:9}}>▾</span>
                  </span>
                </div>
                <div style={{fontSize:11,color:"#64748b",marginTop:2}}>Only the page or section you confirm is ever sent — the rest of your lease stays in your browser.</div>
                {tierInfoOpen==="privacy"&&<div style={{fontSize:11,color:"#64748b",marginTop:6,paddingTop:6,borderTop:"1px solid #1e293b"}}>We never store your lease document. Because only that one confirmed piece is sent, it typically won't pick up the lessee name or lease dates — you'll fill those in on the next screen.</div>}
              </button>
            </div>
            <div style={{display:"flex",marginTop:14}}>
              <button className="btn btn-ghost" style={{flex:1}} onClick={onClose}>Cancel</button>
            </div>
          </>
        )}

        {step==="quick-upload"&&(
          <>
            <div style={{fontSize:12,color:"#94a3b8",lineHeight:1.6,marginBottom:14}}>
              Upload the lease document (PDF or Word). The whole document is processed to pull out lease details and reserve rates automatically — nothing is stored beyond standard short-term retention, and it's never used for training, but the full document (not just the rate schedule) does leave your browser to be processed.
            </div>
            <input type="file" accept="application/pdf,.pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" disabled={aiBusy}
              onChange={e=>e.target.files?.[0]&&runQuickParse(e.target.files[0])}/>
            {aiBusy&&<div style={{fontSize:12,color:"#94a3b8",marginTop:10}}>Extracting… this can take a few seconds.</div>}
            {aiError&&<div style={{fontSize:12,color:"#f87171",marginTop:10}}>{aiError}</div>}
            <div style={{display:"flex",gap:10,marginTop:16}}>
              <button className="btn btn-ghost" style={{flex:1}} disabled={aiBusy} onClick={()=>setStep("tier")}>← Back</button>
              <button className="btn btn-ghost" style={{flex:1}} disabled={aiBusy} onClick={()=>setStep("details")}>Skip — Enter Manually</button>
            </div>
          </>
        )}

        {step==="privacy-upload"&&(
          <>
            <div style={{fontSize:12,color:"#94a3b8",lineHeight:1.6,marginBottom:14}}>
              Upload the lease document (PDF or Word). It's read entirely in your browser first — nothing is sent anywhere yet. You'll then confirm which page or section has the reserve rate schedule, and only that part is sent for extraction.
            </div>
            <input type="file" accept="application/pdf,.pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" disabled={aiBusy}
              onChange={e=>e.target.files?.[0]&&handlePrivacyFile(e.target.files[0])}/>
            {aiBusy&&<div style={{fontSize:12,color:"#94a3b8",marginTop:10}}>Reading document…</div>}
            {aiError&&<div style={{fontSize:12,color:"#f87171",marginTop:10}}>{aiError}</div>}
            <div style={{display:"flex",gap:10,marginTop:16}}>
              <button className="btn btn-ghost" style={{flex:1}} disabled={aiBusy} onClick={()=>setStep("tier")}>← Back</button>
              <button className="btn btn-ghost" style={{flex:1}} disabled={aiBusy} onClick={()=>setStep("details")}>Skip — Enter Manually</button>
            </div>
          </>
        )}

        {step==="privacy-pages"&&aiCandidates&&(
          <>
            <div style={{fontSize:12,color:"#94a3b8",lineHeight:1.6,marginBottom:14}}>
              Confirm which page or section has the reserve rate schedule. Only that part's text will be sent — the rest of the document stays in your browser and is discarded once you're done.
            </div>
            {aiCandidates.filter(c=>c.score>0).length===0&&(
              <div style={{fontSize:11,color:"#fbbf24",marginBottom:10}}>Nothing stood out automatically — showing everything below, please pick the right one.</div>
            )}
            <div style={{display:"flex",flexDirection:"column",gap:8,maxHeight:340,overflow:"auto"}}>
              {(aiCandidates.filter(c=>c.score>0).length?aiCandidates.filter(c=>c.score>0):aiCandidates).map(c=>(
                <button key={c.id} className="btn btn-ghost" style={{padding:"10px 12px",textAlign:"left"}} disabled={aiBusy} onClick={()=>runPrivacyParse(c.id)}>
                  <div style={{fontWeight:700,fontSize:12,color:"#e2e8f0"}}>{c.label}</div>
                  <div style={{fontSize:11,color:"#64748b",marginTop:2}}>{c.snippet||"(no extractable text found here — likely scanned/image-only)"}</div>
                </button>
              ))}
            </div>
            {aiBusy&&<div style={{fontSize:12,color:"#94a3b8",marginTop:10}}>Extracting selected section…</div>}
            {aiError&&<div style={{fontSize:12,color:"#f87171",marginTop:10}}>{aiError}</div>}
            <div style={{display:"flex",gap:10,marginTop:16}}>
              <button className="btn btn-ghost" style={{flex:1}} disabled={aiBusy} onClick={()=>setStep("privacy-upload")}>← Back</button>
              <button className="btn btn-ghost" style={{flex:1}} disabled={aiBusy} onClick={()=>setStep("details")}>Skip — Enter Manually</button>
            </div>
          </>
        )}

        {step==="ai-review"&&aiResult&&(
          <>
            <div style={{fontSize:12,color:"#94a3b8",lineHeight:1.6,marginBottom:14}}>
              Review what was parsed before it's used. Nothing is saved yet — you'll still confirm each reserve pot individually on the next screens, same as manual entry.
            </div>
            <div className="card" style={{padding:12,background:"#0d1622",fontSize:12,color:"#e2e8f0",marginBottom:12}}>
              <label className="form-label" style={{fontSize:10}}>Lessee (editable — check this before continuing)</label>
              <input type="text" value={aiResult.lessee||""} placeholder="Not found — enter manually"
                onChange={e=>setAiResult(prev=>({...prev,lessee:e.target.value}))} style={{marginBottom:8}}/>
              <div><strong style={{color:"#94a3b8"}}>Lease term:</strong> {aiResult.leaseStart||"?"} → {aiResult.leaseEnd||"?"}</div>
            </div>
            <div style={{fontSize:11,color:"#94a3b8",fontWeight:700,marginBottom:6}}>RESERVE RATES FOUND</div>
            <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:12}}>
              {[["AF-6Y","Airframe 6-Year Check"],["AF-12Y","Airframe 12-Year Check"],["AP-OH","APU Overhaul"],["LG-OH","Landing Gear Overhaul"],["ENGINE_RESTORATION","Engine Restoration"],["ENGINE_LLP","Engine LLP"]].map(([code,label])=>(
                <div key={code} style={{display:"flex",justifyContent:"space-between",fontSize:12,padding:"6px 8px",background:"#0d1622",borderRadius:6}}>
                  <span style={{color:"#94a3b8"}}>{label}</span>
                  <span style={{color:aiResult.pots?.[code]?.accrualRate!=null?"#34d399":"#475569"}}>{aiResult.pots?.[code]?.accrualRate!=null?`$${aiResult.pots[code].accrualRate}`:"not found"}</span>
                </div>
              ))}
            </div>
            {aiResult.notes&&<div style={{fontSize:11,color:"#fbbf24",marginBottom:12}}>ℹ {aiResult.notes}</div>}
            <div style={{fontSize:10,color:"#475569",marginBottom:14}}>
              These are a starting point, not final figures — you'll review and confirm every pot on the next screen exactly as you would with manual entry.
            </div>
            <div style={{display:"flex",gap:10}}>
              <button className="btn btn-ghost" style={{flex:1}} onClick={()=>setStep("tier")}>← Start Over</button>
              <button className="btn btn-gold" style={{flex:1}} onClick={acceptAiResult}>Use These Details →</button>
            </div>
          </>
        )}

        {step==="overview"&&(
          <>
            <div style={{fontSize:12,color:"#94a3b8",lineHeight:1.6,marginBottom:16}}>
              <div><strong style={{color:"#e2e8f0"}}>Lessee:</strong> {form.lessee}</div>
              <div><strong style={{color:"#e2e8f0"}}>Lease term:</strong> {form.leaseStart} → {form.leaseEnd}</div>
              <div><strong style={{color:"#e2e8f0"}}>Migration date:</strong> {form.migrationDate}</div>
            </div>
            <div style={{display:"flex",gap:10,marginBottom:20,fontSize:11}}>
              {pots?(
                <>
                  <span className="pill" style={{background:"#0d2818",color:"#34d399"}}>{counts.green} Complete</span>
                  <span className="pill" style={{background:"#2a220e",color:"#fbbf24"}}>{counts.amber} In progress / needs review</span>
                  <span className="pill" style={{background:"#2a0e0e",color:"#f87171"}}>{counts.red} Outstanding</span>
                </>
              ):(
                <span style={{color:"#475569"}}>Loading pot status…</span>
              )}
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              <button className="btn btn-gold" onClick={()=>setStep("pots")}>Reserve Pots →</button>
              <button className="btn btn-ghost" onClick={()=>setStep("details")}>✏ Edit Lease Details</button>
              <button className="btn btn-danger" disabled={deleting} onClick={deleteLease}>
                {deleting?"Deleting…":"🗑 Delete This Lease"}
              </button>
            </div>
          </>
        )}

        {step==="details"&&(
          <>
            <div style={{display:"grid",gridTemplateColumns:"1fr",gap:14}}>
              <div>
                <label className="form-label">Lessee (Airline)</label>
                <input type="text" placeholder="e.g. Example Airways" value={form.lessee} onChange={e=>set("lessee",e.target.value)}/>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
                <div>
                  <label className="form-label">Lease Start</label>
                  <input type="date" value={form.leaseStart} onChange={e=>set("leaseStart",e.target.value)}/>
                </div>
                <div>
                  <label className="form-label">Lease End</label>
                  <input type="date" value={form.leaseEnd} onChange={e=>set("leaseEnd",e.target.value)}/>
                </div>
                <div style={{gridColumn:"1/-1",fontSize:10,color:"#475569"}}>Optional for now — can be added later, before Confirm & Activate.</div>
              </div>
              <div>
                <label className="form-label">Migration Date</label>
                <input type="date" value={form.migrationDate} onChange={e=>set("migrationDate",e.target.value)}/>
                <div style={{fontSize:10,color:"#475569",marginTop:4}}>Defaults to today — the date TailiQ becomes this lease's system of record.</div>
              </div>
            </div>

            <div style={{display:"flex",gap:10,marginTop:14}}>
              <button className="btn btn-ghost" style={{flex:1}} onClick={()=>originalLease?setStep("overview"):(aiResult?setStep("tier"):onClose())}>
                {originalLease?"← Back":(aiResult?"← Back":"Cancel")}
              </button>
              <button className="btn btn-gold" style={{flex:1}} disabled={!canContinue} onClick={()=>setStep("pots")}>
                Continue →
              </button>
            </div>
          </>
        )}

        {step==="pots"&&(
          <>
            {!pots&&<div style={{color:"#475569",fontSize:12}}>Loading pot checklist…</div>}
            {pots&&(
              <>
                <div style={{display:"flex",gap:10,marginBottom:14,fontSize:11}}>
                  <span className="pill" style={{background:"#0d2818",color:"#34d399"}}>{counts.green} Complete</span>
                  <span className="pill" style={{background:"#2a220e",color:"#fbbf24"}}>{counts.amber} In progress / needs review</span>
                  <span className="pill" style={{background:"#2a0e0e",color:"#f87171"}}>{counts.red} Outstanding</span>
                </div>
                {potList.map(p=>(
                  <PotRow key={p.code} pot={p}
                    onField={(field,val)=>setPotField(p.code,field,val)}
                    onSave={()=>savePot(p.code)}
                    onAcknowledge={val=>acknowledgePot(p.code,val)}/>
                ))}
                <div className="card" style={{padding:14,marginBottom:10,background:"#0d1622"}}>
                  <div style={{fontSize:12,fontWeight:700,color:"#e2e8f0",marginBottom:8}}>+ Add Custom Pot</div>
                  <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                    <input type="text" placeholder="Code (e.g. AVIONICS-OH)" value={customCode} onChange={e=>setCustomCode(e.target.value)} style={{fontSize:12,padding:"6px 8px",width:180}}/>
                    <input type="text" placeholder="Label" value={customLabel} onChange={e=>setCustomLabel(e.target.value)} style={{fontSize:12,padding:"6px 8px",flex:1,minWidth:160}}/>
                    <button className="btn btn-ghost" style={{fontSize:12}} onClick={addCustomPot}>+ Add</button>
                  </div>
                </div>
                <div style={{fontSize:10,color:"#475569",marginBottom:14}}>
                  Partial completion is fine — outstanding pots can be finished later, and Brain 3 will caveat any missing pots rather than treating them as zero.
                </div>
              </>
            )}
            <div style={{display:"flex",gap:10,marginTop:8}}>
              <button className="btn btn-ghost" style={{flex:1}} onClick={()=>setStep(originalLease?"overview":"details")}>← Back</button>
              <button className="btn btn-gold" style={{flex:1}} onClick={()=>setStep("confirm")}>Continue →</button>
            </div>
          </>
        )}

        {step==="confirm"&&(
          <>
            <div style={{fontSize:12,color:"#94a3b8",lineHeight:1.6,marginBottom:14}}>
              <div><strong style={{color:"#e2e8f0"}}>Lessee:</strong> {form.lessee}</div>
              <div><strong style={{color:"#e2e8f0"}}>Lease term:</strong> {form.leaseStart} → {form.leaseEnd}</div>
              <div><strong style={{color:"#e2e8f0"}}>Migration date:</strong> {form.migrationDate}</div>
              {leaseUnchanged&&<div style={{marginTop:6,fontSize:11,color:"#64748b"}}>No changes to lease details — activating will only save pot updates.</div>}
            </div>
            <div style={{display:"flex",gap:10,marginBottom:18,fontSize:11}}>
              <span className="pill" style={{background:"#0d2818",color:"#34d399"}}>{counts.green} Complete</span>
              <span className="pill" style={{background:"#2a220e",color:"#fbbf24"}}>{counts.amber} In progress / needs review</span>
              <span className="pill" style={{background:"#2a0e0e",color:"#f87171"}}>{counts.red} Outstanding</span>
            </div>
            {(counts.amber>0||counts.red>0)&&(
              <div style={{fontSize:11,color:"#94a3b8",marginBottom:14,padding:10,background:"#0d1622",borderRadius:6}}>
                Some pots aren't complete yet — that's fine, this lease can still be activated. Outstanding pots will be flagged in Fly-Forward projections rather than treated as zero.
              </div>
            )}
            <div style={{display:"flex",gap:10}}>
              <button className="btn btn-ghost" style={{flex:1}} onClick={()=>setStep("pots")}>← Back</button>
              <button className="btn btn-gold" style={{flex:1}} disabled={activating} onClick={activate}>
                {activating?"Saving…":(leaseUnchanged?"Save Pot Updates":"Activate Lease")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};


export { LeaseWizard };
