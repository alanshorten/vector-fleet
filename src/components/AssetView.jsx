import React, { useState, useEffect, useCallback, useRef } from 'react';
import { APUTab, EnginesTab, LandingGearTab, OverviewTab } from './AssetTabs';
import { FlyForward, MaintenanceCalendarView } from './FlyForward';
import { AvionicsTab, DocumentsTab, HistoryTab, SpecsTab } from './PhotosAndSpecs';
import { isCFM } from '../lib/assetHelpers';
import { db } from '../lib/db';
import { extractLLPSheet } from '../lib/extraction';
import { getDefaultDisclaimer, getTechSpecLogo } from '../lib/techSpec';

// Shared fixed width for whatever sits to the right of the Details/Calendar/
// Financials/Scenarios pill — the fleet-level tools pill (Prospects/Upload/
// Admin/Sign Out, which varies by role) and the asset-level actions pill
// (Share/Generate Tech Spec, which doesn't). Keeping both pinned to this same
// width is what guarantees the layer pill itself lands at the same X
// position in both headers, regardless of how many items the trailing pill
// holds for a given role.
const TRAILING_PILL_WIDTH=400;

function NavPill({items,activeValue,onSelect,theme="dark",width}){
  const isLight=theme==="light";
  return(
    <nav className="app-nav-pill" style={{display:"inline-flex",alignItems:"center",justifyContent:"center",gap:4,background:isLight?"#f1f5f9":"rgba(13,25,37,0.8)",border:`1px solid ${isLight?"#e2e8f0":"#1e3348"}`,borderRadius:8,padding:"5px 6px",overflowX:"auto",WebkitOverflowScrolling:"touch",width:width||undefined,flexShrink:0}}>
      {items.map(([v,l])=>(
        <button key={v} className="app-nav-btn" onClick={()=>onSelect(v)}
          style={{padding:"8px 16px",borderRadius:6,border:"none",fontFamily:"inherit",fontSize:13,fontWeight:700,cursor:"pointer",transition:"all 0.15s",background:activeValue===v?"#1a3050":"transparent",color:activeValue===v?"#C9A84C":(isLight?"#475569":"#6a8aaa"),letterSpacing:"0.02em",whiteSpace:"nowrap"}}>
          {l}
        </button>
      ))}
    </nav>
  );
};

function LLPExtractor({kind,label,onApply,notify}){
  const[file,setFile]=useState(null);
  const[extracting,setExtracting]=useState(false);
  const[parsed,setParsed]=useState(null);
  const[error,setError]=useState(null);
  const doExtract=async()=>{
    if(!file)return;
    setExtracting(true);setError(null);setParsed(null);
    try{
      const result=await extractLLPSheet(file,kind);
      setParsed(result);
    }catch(e){setError(e.message);}
    setExtracting(false);
  };
  const rows=kind==="llp"?(parsed?.engines||[]).reduce((n,e)=>n+(e.llps?.length||0),0):(parsed?.apu?.llps?.length||0);
  const apply=()=>{
    onApply(parsed);
    notify(`${rows} LLP row(s) applied`);
    setParsed(null);setFile(null);
  };
  return(
    <div style={{marginTop:10,paddingTop:10,borderTop:"1px solid #1e3048"}}>
      <div style={{fontSize:10,fontWeight:700,color:"#475569",textTransform:"uppercase",marginBottom:6}}>{label}</div>
      {!parsed?(
        <div className="flab g8">
          <input type="file" accept="application/pdf" onChange={e=>setFile(e.target.files?.[0]||null)} style={{fontSize:11,flex:1}}/>
          <button type="button" className="btn btn-primary" style={{fontSize:11,padding:"4px 10px"}} disabled={!file||extracting} onClick={doExtract}>{extracting?"Extracting…":"Extract"}</button>
        </div>
      ):(
        <div>
          <div style={{fontSize:11,color:"#94a3b8",marginBottom:6}}>{rows} LLP line(s) found in "{file?.name}".</div>
          <div className="flab g8">
            <button type="button" className="btn btn-ghost" style={{fontSize:11,padding:"4px 10px"}} onClick={()=>{setParsed(null);setFile(null);}}>Discard</button>
            <button type="button" className="btn btn-gold" style={{fontSize:11,padding:"4px 10px"}} onClick={apply}>Apply {rows} LLP row(s)</button>
          </div>
        </div>
      )}
      {error&&<div style={{color:"#f87171",fontSize:11,marginTop:6}}>{error}</div>}
    </div>
  );
};

function AssetView({asset,saveAsset,isAdmin,userRole,notify,onBack,loadAssets,initialLayer}){
  const[layer,setLayer]=useState(initialLayer||"details");
  const[tab,setTab]=useState("overview");
  const[shareOpen,setShareOpen]=useState(false);
  // Data Entry sees Details only (raw inputs, no financial outputs) — matches
  // the four-role model's Nav visibility table (VECTORIQ_ROADMAP.md §7a).
  const canSeeAdvanced=!!userRole&&userRole!=='dataEntry';
  // Viewer edits nothing permanent — Lease Wizard writes real pot docs, so
  // it's Admin/Editor/Data Entry only (Data Entry handles this as a raw input).
  const canEnterLeaseData=!!userRole&&userRole!=='viewer';
  const LAYERS=[["details","Details"],...(canSeeAdvanced?[["calendar","Calendar"],["financials","Financials"],["scenarios","Scenarios"]]:[])];
  const genSpec=async()=>{
    const isCFMAsset=isCFM(asset);
    const photoKey=isCFMAsset?"engine_photo_cfm56":"engine_photo_v2500";
    const engPhoto=await db.getSetting(photoKey).catch(()=>null);
    const logo=await getTechSpecLogo();
    const defaultDisclaimer=await getDefaultDisclaimer();
    const base=buildTechSpecHTML(asset,engPhoto,logo,defaultDisclaimer);
    const withBar=base.replace('<body>',`<body><div style="position:fixed;top:0;left:0;right:0;background:#1B3A6B;padding:10px 20px;display:flex;gap:10px;align-items:center;z-index:999;box-shadow:0 2px 8px rgba(0,0,0,0.3);print-color-adjust:exact;-webkit-print-color-adjust:exact"><span style="color:#C9A84C;font-weight:700;font-size:14px;flex:1">TailiQ — Tech Spec MSN ${asset.msn}</span><button onclick="window.print()" style="background:#C9A84C;color:#0a1520;border:none;border-radius:6px;padding:8px 20px;font-size:13px;font-weight:700;cursor:pointer">🖨 Print / Save PDF</button><button onclick="window.close()" style="background:transparent;color:#94a3b8;border:1px solid #2d3f55;border-radius:6px;padding:8px 16px;font-size:13px;cursor:pointer">✕ Close</button></div><div style="height:52px"></div>`);
    const withPrint=withBar.replace('</style>','@media print{body>div:first-child{display:none!important}div[style*="height:52px"]{display:none!important}}</style>');
    const win=window.open();
    win.document.write(withPrint);
    win.document.close();
  };
  return(
    <div style={{animation:"fadeIn 0.2s ease"}}>
      <div className="flab g12 asset-header-row" style={{marginBottom:24,justifyContent:"space-between",flexWrap:"wrap"}}>
        <div className="flab g12 asset-header-top">
          <button className="btn btn-ghost" onClick={onBack}>← Fleet</button>
          <div>
            <h1 style={{fontSize:18,color:"#C9A84C",fontWeight:700}}>MSN {asset.msn} — {asset.registration||"—"}</h1>
            <p style={{color:"#475569",fontSize:12}}>{asset.model} · {asset.operator||"—"}</p>
          </div>
        </div>
        <div className="flab g12 asset-header-actions">
          <NavPill items={LAYERS} activeValue={layer} onSelect={setLayer}/>
          <div className="app-nav-pill" style={{display:"inline-flex",alignItems:"center",justifyContent:"space-evenly",gap:8,background:"rgba(13,25,37,0.8)",border:"1px solid #1e3348",borderRadius:8,padding:"5px 6px",width:TRAILING_PILL_WIDTH,flexShrink:0}}>
            <button className="btn btn-ghost" style={{fontSize:12,padding:"8px 16px"}} onClick={()=>setShareOpen(true)}>🔗 Share</button>
            <button className="btn btn-gold" style={{fontSize:12,padding:"8px 16px"}} onClick={genSpec}>📋 Generate Tech Spec</button>
          </div>
        </div>
      </div>

      {layer==="details"&&(
        <>
          <div className="subtab-scroll" style={{display:"flex",borderBottom:"1px solid #1e3048",marginBottom:20,gap:2,overflowX:"auto",whiteSpace:"nowrap",WebkitOverflowScrolling:"touch"}}>
            {["overview","specs","engines","landing gear","apu","avionics","history","documents"].map(t=>(
              <button key={t} className={`tab-btn${tab===t?" active":""}`} style={{flexShrink:0,fontSize:10}} onClick={()=>setTab(t)}>{t}</button>
            ))}
          </div>
          {tab==="overview"&&<OverviewTab asset={asset} isAdmin={isAdmin} saveAsset={saveAsset} notify={notify}/>}
          {tab==="engines"&&<EnginesTab asset={asset} isAdmin={isAdmin} saveAsset={saveAsset} notify={notify}/>}
          {tab==="landing gear"&&<LandingGearTab asset={asset} isAdmin={isAdmin} saveAsset={saveAsset} notify={notify}/>}
          {tab==="apu"&&<APUTab asset={asset} isAdmin={isAdmin} saveAsset={saveAsset} notify={notify}/>}
          {tab==="avionics"&&<AvionicsTab asset={asset} isAdmin={isAdmin} saveAsset={saveAsset} notify={notify}/>}
          {tab==="specs"&&<SpecsTab asset={asset} isAdmin={isAdmin} saveAsset={saveAsset} notify={notify}/>}
          {tab==="history"&&<HistoryTab asset={asset} isAdmin={isAdmin} notify={notify} loadAssets={loadAssets}/>}
          {tab==="documents"&&<DocumentsTab asset={asset}/>}
        </>
      )}
      {layer==="calendar"&&canSeeAdvanced&&<MaintenanceCalendarView asset={asset}/>}
      {layer==="financials"&&canSeeAdvanced&&<FlyForward asset={asset} saveAsset={saveAsset} notify={notify} canEnterLeaseData={canEnterLeaseData}/>}
      {layer==="scenarios"&&canSeeAdvanced&&(
        <div className="card" style={{padding:24,textAlign:"center"}}>
          <div style={{fontSize:14,fontWeight:700,color:"#e2e8f0",marginBottom:8}}>Scenarios</div>
          <div style={{fontSize:12,color:"#94a3b8"}}>Coming soon — sliders and a chat box for exploring "what if" projections against this asset's numbers.</div>
        </div>
      )}
      {shareOpen&&<ShareModal asset={asset} notify={notify} onClose={()=>setShareOpen(false)}/>}
    </div>
  );
};

function ShareModal({asset,notify,onClose}){
  const[tokens,setTokens]=useState(null);
  const[busy,setBusy]=useState(false);

  const load=async()=>{
    const list=await db.getShareTokensForAsset(asset.id).catch(()=>[]);
    const active=list.filter(t=>!t.revoked&&new Date(t.expiresAt).getTime()>Date.now());
    setTokens(active);
  };
  useEffect(()=>{load();},[]);

  const shareUrl=(token)=>`https://app.tailiq.app/share/${token}`;

  const generate=async()=>{
    setBusy(true);
    try{
      await db.createShareToken(asset.id, asset.companyId||null);
      await load();
      notify("Share link created — expires in 7 days","success");
    }catch(e){
      notify("Failed to create share link","error");
    }
    setBusy(false);
  };

  const revoke=async(token)=>{
    setBusy(true);
    try{
      await db.revokeShareToken(token);
      await load();
      notify("Share link revoked","success");
    }catch(e){
      notify("Failed to revoke link","error");
    }
    setBusy(false);
  };

  const copy=(token)=>{
    navigator.clipboard?.writeText(shareUrl(token));
    notify("Link copied to clipboard","success");
  };

  return(
    <div style={{position:"fixed",inset:0,background:"rgba(5,10,16,0.7)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}} onClick={onClose}>
      <div className="card" style={{width:420,maxWidth:"92vw",padding:24}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <h2 style={{fontSize:15,color:"#C9A84C",fontWeight:700}}>Share {asset.prospectKind==="engine"?`ESN ${asset.engines?.[0]?.sn||"—"}`:`MSN ${asset.msn}`}</h2>
          <button className="btn btn-ghost" style={{padding:"4px 10px"}} onClick={onClose}>✕</button>
        </div>
        <p style={{fontSize:12,color:"#7a9ab5",marginBottom:16,lineHeight:1.5}}>
          Read-only tech spec view — no financial data. Links expire after 7 days.
        </p>
        {tokens===null&&<div style={{color:"#475569",fontSize:12}}>Loading…</div>}
        {tokens&&tokens.length===0&&(
          <button className="btn btn-gold" style={{width:"100%",padding:10}} disabled={busy} onClick={generate}>
            {busy?"Generating…":"Generate Share Link"}
          </button>
        )}
        {tokens&&tokens.map(t=>(
          <div key={t.token} style={{marginBottom:16,paddingBottom:16,borderBottom:"1px solid #1e3048"}}>
            <div style={{display:"flex",justifyContent:"center",marginBottom:12}}>
              <img
                alt="QR code"
                style={{background:"#fff",borderRadius:6,padding:6}}
                src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(shareUrl(t.token))}`}
              />
            </div>
            <div style={{fontSize:11,color:"#475569",wordBreak:"break-all",marginBottom:10,textAlign:"center"}}>{shareUrl(t.token)}</div>
            <div style={{fontSize:10,color:"#475569",textAlign:"center",marginBottom:12}}>Expires {fmtDate(t.expiresAt)}</div>
            <div style={{display:"flex",gap:8}}>
              <a className="btn btn-primary" style={{flex:1,textAlign:"center",textDecoration:"none",fontSize:12,padding:"8px 0"}}
                 href={`https://wa.me/?text=${encodeURIComponent(shareUrl(t.token))}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>
              <button className="btn btn-ghost" style={{flex:1,fontSize:12}} onClick={()=>copy(t.token)}>Copy Link</button>
            </div>
            <button className="btn btn-danger" style={{width:"100%",marginTop:8}} disabled={busy} onClick={()=>revoke(t.token)}>Revoke Link</button>
          </div>
        ))}
        {tokens&&tokens.length>0&&(
          <button className="btn btn-ghost" style={{width:"100%"}} disabled={busy} onClick={generate}>
            {busy?"Generating…":"+ Generate New Link"}
          </button>
        )}
      </div>
    </div>
  );
};

function PotNumInput({ value, onCommit, width, step }) {
  const [local, setLocal] = useState(String(value ?? ""));
  useEffect(() => { setLocal(String(value ?? "")); }, [value]);
  return (
    <input type="number" step={step || "any"} value={local} style={{ width: width || 90, fontSize: 12, padding: "4px 6px" }}
      onChange={e => setLocal(e.target.value)}
      onBlur={() => { const n = parseFloat(local); onCommit(isNaN(n) ? "" : n); }}/>
  );
};

function PotRow({ pot, onField, onSave, onAcknowledge }) {
  const status = !pot.saved
    ? ((pot.accrualRate !== "" || pot.openingBalance !== "") ? "amber" : "red")
    : (pot.validationWarning && !pot.warningAcknowledged ? "amber" : "green");
  const statusStyle = {
    red: { background: "#2a0e0e", color: "#f87171", label: "Outstanding" },
    amber: { background: "#2a220e", color: "#fbbf24", label: pot.saved ? "Needs review" : "In progress" },
    green: { background: "#0d2818", color: "#34d399", label: "Complete" }
  }[status];

  const setInterval = (key, val) => onField("triggerInterval", { ...pot.triggerInterval, [key]: val });
  const isEnLp = pot.triggerBasis === "llp_cycles";
  const isEnPr = pot.triggerBasis === "engine_fh";
  const isCustomCalendar = pot.potCategory === "custom" && pot.triggerBasis === "calendar_months";

  // Completed pots auto-collapse to a compact summary row so the list
  // shrinks as you go — no need to scroll past a full open card for
  // every pot already done. Explicit user toggle (manualExpand)
  // overrides the auto behavior either way, and clicking a collapsed
  // row re-opens it for editing.
  const [manualExpand, setManualExpand] = useState(null);
  const autoExpanded = status !== "green";
  const expanded = manualExpand === null ? autoExpanded : manualExpand;
  const toggle = () => setManualExpand(!expanded);

  if (!expanded) {
    return (
      <div className="card" style={{ padding: "10px 14px", marginBottom: 8, cursor: "pointer" }} onClick={toggle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0" }}>{pot.code}</div>
            <div style={{ fontSize: 11, color: "#64748b" }}>
              ${Number(pot.accrualRate || 0).toLocaleString()}/{pot.accrualBasis === "per_FH" ? "FH" : pot.accrualBasis === "per_FC" ? "FC" : "mo"}
              {!isEnLp && pot.projectedCostLow !== "" && ` · $${Number(pot.projectedCostLow).toLocaleString()}–$${Number(pot.projectedCostHigh).toLocaleString()}`}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="pill" style={{ background: statusStyle.background, color: statusStyle.color }}>{statusStyle.label}</span>
            <span style={{ fontSize: 11, color: "#475569" }}>Edit ▾</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 14, marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10, gap: 8, flexWrap: "wrap", cursor: status === "green" ? "pointer" : "default" }} onClick={status === "green" ? toggle : undefined}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0" }}>{pot.code}</div>
          <div style={{ fontSize: 11, color: "#64748b" }}>{pot.label}</div>
        </div>
        <span className="pill" style={{ background: statusStyle.background, color: statusStyle.color }}>{statusStyle.label}</span>
      </div>

      <div style={{ fontSize: 10, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Accrual (money in)</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end", marginBottom: 12 }}>
        <label style={{ fontSize: 10, color: "#94a3b8" }}>Accrual basis
          <div><select value={pot.accrualBasis} onChange={e => onField("accrualBasis", e.target.value)} style={{ fontSize: 12, padding: "4px 6px" }}>
            <option value="per_FH">$ / Flight Hour</option>
            <option value="per_FC">$ / Flight Cycle</option>
            <option value="per_month">$ / Month</option>
            <option value="per_APU_hr">$ / APU Hour</option>
          </select></div>
        </label>
        <label style={{ fontSize: 10, color: "#94a3b8" }}>Accrual rate ($)
          <div><PotNumInput value={pot.accrualRate} onCommit={v => onField("accrualRate", v)}/></div>
        </label>
        <label style={{ fontSize: 10, color: "#94a3b8" }}>Escalation (%/yr)
          <div><PotNumInput value={pot.escalationPctPerYr} onCommit={v => onField("escalationPctPerYr", v)} width={70}/></div>
        </label>
        <label style={{ fontSize: 10, color: "#94a3b8" }}>Opening balance ($)
          <div><PotNumInput value={pot.openingBalance} onCommit={v => onField("openingBalance", v)} width={110}/></div>
        </label>
      </div>

      {!isEnLp && (
        <>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Outflow (money out — event trigger &amp; cost)</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end", marginBottom: 12 }}>
            {pot.triggerBasis === "calendar_months" && (
              <label style={{ fontSize: 10, color: "#94a3b8" }}>Interval (months){!isCustomCalendar && <span title="Structural — fixed per pot type, not lease-specific" style={{ color: "#475569" }}> 🔒</span>}
                <div>{isCustomCalendar
                  ? <PotNumInput value={pot.triggerInterval?.months} onCommit={v => setInterval("months", v)} width={70}/>
                  : <div style={{ fontSize: 12, color: "#e2e8f0", padding: "4px 0" }}>{pot.triggerInterval?.months}</div>}
                </div>
              </label>
            )}
            {pot.triggerBasis === "calendar_or_cycles" && (
              <label style={{ fontSize: 10, color: "#94a3b8" }}>Interval <span title="Structural — dual limiter, whichever comes first" style={{ color: "#475569" }}>🔒</span>
                <div style={{ fontSize: 12, color: "#e2e8f0", padding: "4px 0" }}>{pot.triggerInterval?.months} months / {pot.triggerInterval?.cycles?.toLocaleString()} FC</div>
              </label>
            )}
            {pot.triggerBasis === "apu_hours" && (
              <label style={{ fontSize: 10, color: "#94a3b8" }}>Trigger band <span title="Structural — condition-based, not calendar" style={{ color: "#475569" }}>🔒</span>
                <div style={{ fontSize: 12, color: "#e2e8f0", padding: "4px 0" }}>{pot.triggerInterval?.apuHours?.[0]?.toLocaleString()}–{pot.triggerInterval?.apuHours?.[1]?.toLocaleString()} APU hr</div>
              </label>
            )}
            {isEnPr && (
              <label style={{ fontSize: 10, color: "#94a3b8" }}>PR interval (FH) <span title="Illustrative default — confirm against actual lease terms" style={{ color: "#fbbf24" }}>⚠</span>
                <div><PotNumInput value={pot.triggerInterval?.fh} onCommit={v => setInterval("fh", v)} width={90}/></div>
              </label>
            )}
            <label style={{ fontSize: 10, color: "#94a3b8" }}>Outflow cost low ($) {(pot.potCategory==="fixed"||isEnPr) && <span title="Illustrative default — confirm against actual lease/MRO quote" style={{ color: "#fbbf24" }}>⚠</span>}
              <div><PotNumInput value={pot.projectedCostLow} onCommit={v => onField("projectedCostLow", v)} width={110}/></div>
            </label>
            <label style={{ fontSize: 10, color: "#94a3b8" }}>Outflow cost high ($)
              <div><PotNumInput value={pot.projectedCostHigh} onCommit={v => onField("projectedCostHigh", v)} width={110}/></div>
            </label>
          </div>
        </>
      )}

      {isEnPr && (
        <div style={{ marginBottom: 12, padding: 10, background: "#0d1622", borderRadius: 6 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", marginBottom: 8 }}>First PR timing</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 7, fontSize: 11, color: "#94a3b8", cursor: "pointer" }}>
              <input type="radio" checked={pot.anchorMode !== "manual"} onChange={() => onField("anchorMode", "infer")} style={{ width: 14, height: 14, marginTop: 2, flexShrink: 0 }}/>
              <span>Estimate from opening balance ÷ accrual rate</span>
            </label>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 7, fontSize: 11, color: "#94a3b8", cursor: "pointer" }}>
              <input type="radio" checked={pot.anchorMode === "manual"} onChange={() => onField("anchorMode", "manual")} style={{ width: 14, height: 14, marginTop: 2, flexShrink: 0 }}/>
              <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                Enter last PR date
                {pot.anchorMode === "manual" && (
                  <input type="date" value={pot.lastPRDate || ""} onChange={e => onField("lastPRDate", e.target.value)} style={{ width: 150, fontSize: 12, padding: "4px 6px" }} onClick={e => e.stopPropagation()}/>
                )}
              </span>
            </label>
          </div>
          <div style={{ fontSize: 10, color: "#475569", marginTop: 8 }}>
            {pot.anchorMode === "manual"
              ? "Next PR projected forward from this date at the interval above."
              : "First PR timing estimated from opening balance ÷ accrual rate — not a tracked shop-visit date. If the balance doesn't genuinely reflect clean accrual since the last PR, this estimate will be off."}
          </div>
        </div>
      )}

      {isEnLp && (
        <>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>LLP stack simulation (outflow computed per shop visit — not a fixed cost)</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end", marginBottom: 12 }}>
            <label style={{ fontSize: 10, color: "#94a3b8" }}>Harvest threshold (FC)
              <div><PotNumInput value={pot.harvestThresholdFC} onCommit={v => onField("harvestThresholdFC", v)} width={90}/></div>
            </label>
            <label style={{ fontSize: 10, color: "#94a3b8" }}>Stub buffer (%)
              <div><PotNumInput value={pot.stubBufferPct} onCommit={v => onField("stubBufferPct", v)} width={70}/></div>
            </label>
          </div>
        </>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button className="btn btn-gold" style={{ fontSize: 12, padding: "6px 14px" }} disabled={pot.checking} onClick={onSave}>
          {pot.checking ? "Checking…" : (pot.saved ? "Update Pot" : "Save Pot")}
        </button>
      </div>

      {pot.validationWarning && (
        <div style={{ marginTop: 10, padding: 10, background: "#2a220e", borderRadius: 6, fontSize: 11, color: "#fbbf24" }}>
          <div>⚠ {pot.validationWarning}</div>
          {/* 4.31 fix: checkbox baseline didn't match the wrapped label
              text's first line. Fixed by giving the checkbox a fixed,
              non-shrinking box with its own top margin nudge instead of
              relying on flex align-items:center (which centers against
              the label's full, possibly multi-line, height). */}
          <div style={{ display: "flex", gap: 7, alignItems: "flex-start", marginTop: 8, fontSize: 11, color: "#94a3b8", cursor: "pointer" }} onClick={() => onAcknowledge(!pot.warningAcknowledged)}>
            <input type="checkbox" checked={pot.warningAcknowledged} onChange={e => onAcknowledge(e.target.checked)} style={{ flexShrink: 0, width: 13, height: 13, marginTop: 1 }} onClick={e => e.stopPropagation()}/>
            <span style={{ lineHeight: 1.4 }}>I've checked this figure and it's correct as entered</span>
          </div>
        </div>
      )}
    </div>
  );
};


export { AssetView, LLPExtractor, NavPill, PotNumInput, PotRow, ShareModal, TRAILING_PILL_WIDTH };
