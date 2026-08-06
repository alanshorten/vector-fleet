import React, { useState, useMemo } from 'react';
import { engineFamily } from '../lib/assetHelpers';

// sv-analytics-iq-tab-build-spec.md §3 — 8-category taxonomy. Only PR and
// Hardware are trended (interval calcs); the rest still appear in the raw
// table. reasonCategory doesn't exist on any records yet — that's steps
// 4-6 of the build sequence (extraction prompt + review-screen dropdowns).
// Until then every row shows as Uncategorised, which is expected.
const REASON_CATEGORIES=["PR","Hardware","FOD","Lease Event","Swap","TIMEX","Scheduled LLP","Other"];
const TRENDED_CATEGORIES=["PR","Hardware"];
const SUMMARY_LABELS={PR:"Performance Restoration",Hardware:"Hardware"};

// One row per component (engine or APU) carrying its own shop visit array.
// APU shopVisits already exist in the schema via the manual Add Visit form
// (AssetTabs.jsx) even though the document-upload path — the APU SV history
// uploader — is a separate, not-yet-built item (spec §10). Any APU visits
// already on file are included here now; APU components are grouped under
// a single "APU" family rather than split by P/N.
function buildComponents(assets){
  const comps=[];
  (assets||[]).forEach(asset=>{
    (asset.engines||[]).forEach(e=>{
      if(!(e.shopVisits||[]).length)return;
      const family=engineFamily(e.type)||(e.type?e.type.trim():"Unspecified Type");
      comps.push({
        key:asset.id+"-eng-"+(e.position||e.sn||Math.random()),
        family,
        idLabel:e.sn||"—",
        assetMsn:asset.msn||"—",
        shopVisits:e.shopVisits,
      });
    });
    if(asset.apu&&(asset.apu.shopVisits||[]).length){
      comps.push({
        key:asset.id+"-apu",
        family:"APU",
        idLabel:asset.apu.sn||"—",
        assetMsn:asset.msn||"—",
        shopVisits:asset.apu.shopVisits,
      });
    }
  });
  return comps;
}

// TSI logic per spec §4. First SV: TSI = raw fh/fc (run from new/zero) —
// flagged (not excluded) if it looks like it's swallowed an earlier
// unrecorded visit (more than double the very next interval). Subsequent
// SVs: delta from the prior visit. Zero/negative TSI is a data-quality
// issue — flagged and excluded from summary stats, still shown in the table.
function computeRows(component){
  const svs=[...(component.shopVisits||[])].filter(sv=>sv&&sv.date).sort((a,b)=>new Date(a.date)-new Date(b.date));
  return svs.map((sv,i)=>{
    const prev=i>0?svs[i-1]:null;
    const tsiFH=sv.fh!=null?(prev&&prev.fh!=null?sv.fh-prev.fh:sv.fh):null;
    const tsiFC=sv.fc!=null?(prev&&prev.fc!=null?sv.fc-prev.fc:sv.fc):null;
    const dataIssue=(tsiFH!=null&&tsiFH<=0)||(tsiFC!=null&&tsiFC<=0);
    let firstRunFlag=false;
    if(!prev&&svs.length>1&&svs[1].fh!=null&&sv.fh!=null){
      const nextDelta=svs[1].fh-sv.fh;
      if(nextDelta>0&&sv.fh>nextDelta*2)firstRunFlag=true;
    }
    return{component,sv,svNumber:i+1,tsiFH,tsiFC,dataIssue,firstRunFlag,reasonCategory:sv.reasonCategory||null};
  });
}

const mean=arr=>arr.length?arr.reduce((a,b)=>a+b,0)/arr.length:null;
const median=arr=>{if(!arr.length)return null;const s=[...arr].sort((a,b)=>a-b);const m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2;};
const fmtFC=(v)=>v==null?"—":Math.round(v).toLocaleString();

// Summary shown only when n >= 3 for the segment (spec §4).
function summaryFor(rows,category){
  const seg=rows.filter(r=>r.reasonCategory===category&&!r.dataIssue);
  if(seg.length<3)return null;
  const fh=seg.map(r=>r.tsiFH).filter(v=>v!=null);
  const fc=seg.map(r=>r.tsiFC).filter(v=>v!=null);
  return{
    n:seg.length,
    meanFH:mean(fh),medianFH:median(fh),minFH:fh.length?Math.min(...fh):null,maxFH:fh.length?Math.max(...fh):null,
    meanFC:mean(fc),medianFC:median(fc),minFC:fc.length?Math.min(...fc):null,maxFC:fc.length?Math.max(...fc):null,
  };
}

function SVAnalyticsCard({assets}){
  const components=useMemo(()=>buildComponents(assets),[assets]);
  const families=useMemo(()=>Array.from(new Set(components.map(c=>c.family))).sort(),[components]);
  const[family,setFamily]=useState("all");
  const[categoryFilter,setCategoryFilter]=useState([]);
  const[sortKey,setSortKey]=useState("date");
  const[sortDir,setSortDir]=useState("desc");

  const scoped=family==="all"?components:components.filter(c=>c.family===family);
  const allRows=useMemo(()=>scoped.flatMap(c=>computeRows(c)),[scoped]);
  const summaries=TRENDED_CATEGORIES.map(cat=>({cat,stats:summaryFor(allRows,cat)})).filter(s=>s.stats);

  const filteredRows=categoryFilter.length
    ?allRows.filter(r=>categoryFilter.includes(r.reasonCategory||"Uncategorised"))
    :allRows;

  const sorted=useMemo(()=>{
    const dir=sortDir==="asc"?1:-1;
    const arr=[...filteredRows];
    const val=(r,key)=>{
      switch(key){
        case"esn":return r.component.idLabel;
        case"family":return r.component.family;
        case"svNumber":return r.svNumber;
        case"tsn":return r.sv.fh??-Infinity;
        case"csn":return r.sv.fc??-Infinity;
        case"tsiFH":return r.tsiFH??-Infinity;
        case"tsiFC":return r.tsiFC??-Infinity;
        case"category":return r.reasonCategory||"Uncategorised";
        case"mro":return r.sv.mro||"";
        default:return r.sv.date||"";
      }
    };
    arr.sort((a,b)=>{
      const av=val(a,sortKey),bv=val(b,sortKey);
      if(av<bv)return -1*dir;
      if(av>bv)return 1*dir;
      return 0;
    });
    return arr;
  },[filteredRows,sortKey,sortDir]);

  const toggleSort=(key)=>{
    if(sortKey===key)setSortDir(d=>d==="asc"?"desc":"asc");
    else{setSortKey(key);setSortDir("asc");}
  };
  const toggleCategory=(cat)=>setCategoryFilter(f=>f.includes(cat)?f.filter(x=>x!==cat):[...f,cat]);

  const Th=({label,sortField})=>(
    <th style={{cursor:"pointer",userSelect:"none",whiteSpace:"nowrap"}} onClick={()=>toggleSort(sortField)}>
      {label}{sortKey===sortField?(sortDir==="asc"?" ▲":" ▼"):""}
    </th>
  );

  if(!components.length){
    return(
      <div className="card" style={{padding:18}}>
        <div className="section-title">SV Interval Analytics</div>
        <p style={{color:"#475569",fontSize:12,fontStyle:"italic",marginTop:8}}>No shop visit records found across the fleet yet.</p>
      </div>
    );
  }

  return(
    <div className="card" style={{padding:18}}>
      <div className="flj" style={{marginBottom:14,flexWrap:"wrap",gap:10}}>
        <div className="section-title" style={{margin:0}}>SV Interval Analytics</div>
        <select value={family} onChange={e=>setFamily(e.target.value)} style={{fontSize:12,padding:"6px 10px",borderRadius:6,background:"#0d1e2e",border:"1px solid #1e3a5f",color:"#e2e8f0",fontFamily:"inherit"}}>
          <option value="all">All Families</option>
          {families.map(f=><option key={f} value={f}>{f}</option>)}
        </select>
      </div>

      {summaries.length>0&&(
        <div className="grid2" style={{gap:12,marginBottom:16}}>
          {summaries.map(({cat,stats})=>(
            <div key={cat} style={{background:"#0a1a2a",border:"1px solid #1B3A6B",borderRadius:8,padding:"12px 14px"}}>
              <div style={{fontSize:10,color:"#C9A84C",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:8}}>
                {SUMMARY_LABELS[cat]||cat} <span style={{color:"#475569",fontWeight:500,textTransform:"none",letterSpacing:0}}>(n={stats.n})</span>
              </div>
              <div className="grid2" style={{gap:8}}>
                <div>
                  <div style={{fontSize:9,color:"#475569"}}>Mean / Median FH</div>
                  <div style={{fontSize:13,fontWeight:700,color:"#e2e8f0",fontFamily:"monospace"}}>{fmtHHMM(stats.meanFH)} / {fmtHHMM(stats.medianFH)}</div>
                </div>
                <div>
                  <div style={{fontSize:9,color:"#475569"}}>Mean / Median FC</div>
                  <div style={{fontSize:13,fontWeight:700,color:"#e2e8f0",fontFamily:"monospace"}}>{fmtFC(stats.meanFC)} / {fmtFC(stats.medianFC)}</div>
                </div>
                <div>
                  <div style={{fontSize:9,color:"#475569"}}>Range FH</div>
                  <div style={{fontSize:12,color:"#94a3b8",fontFamily:"monospace"}}>{fmtHHMM(stats.minFH)}–{fmtHHMM(stats.maxFH)}</div>
                </div>
                <div>
                  <div style={{fontSize:9,color:"#475569"}}>Range FC</div>
                  <div style={{fontSize:12,color:"#94a3b8",fontFamily:"monospace"}}>{fmtFC(stats.minFC)}–{fmtFC(stats.maxFC)}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flab g8" style={{flexWrap:"wrap",marginBottom:10}}>
        {[...REASON_CATEGORIES,"Uncategorised"].map(cat=>(
          <button key={cat} onClick={()=>toggleCategory(cat)}
            style={{fontSize:10,padding:"3px 9px",borderRadius:12,border:`1px solid ${categoryFilter.includes(cat)?"#C9A84C":"#1e3a5f"}`,background:categoryFilter.includes(cat)?"rgba(201,168,76,0.15)":"transparent",color:categoryFilter.includes(cat)?"#C9A84C":"#6a8aaa",cursor:"pointer",fontWeight:600,fontFamily:"inherit"}}>
            {cat}
          </button>
        ))}
        {categoryFilter.length>0&&<button onClick={()=>setCategoryFilter([])} style={{fontSize:10,padding:"3px 9px",background:"none",border:"none",color:"#475569",cursor:"pointer",textDecoration:"underline",fontFamily:"inherit"}}>Clear filter</button>}
      </div>

      <div style={{overflowX:"auto"}}>
        <table>
          <thead>
            <tr>
              <Th label="ESN / S/N" sortField="esn"/>
              <Th label="Family" sortField="family"/>
              <Th label="SV #" sortField="svNumber"/>
              <Th label="Date" sortField="date"/>
              <Th label="TSN" sortField="tsn"/>
              <Th label="CSN" sortField="csn"/>
              <Th label="TSI (FH)" sortField="tsiFH"/>
              <Th label="TSI (FC)" sortField="tsiFC"/>
              <Th label="Category" sortField="category"/>
              <Th label="MRO" sortField="mro"/>
            </tr>
          </thead>
          <tbody>
            {sorted.length?sorted.map((r,i)=>(
              <tr key={r.component.key+"-"+i} style={r.dataIssue?{background:"rgba(248,113,113,0.08)"}:undefined}>
                <td style={{fontWeight:500}}>{r.component.idLabel}<div style={{fontSize:9,color:"#475569"}}>MSN {r.component.assetMsn}</div></td>
                <td>{r.component.family}</td>
                <td>{r.svNumber}{r.firstRunFlag&&<span title="First recorded SV — interval may include an earlier unrecorded visit" style={{color:"#fbbf24",marginLeft:4}}>⚠</span>}</td>
                <td>{fmtDate(r.sv.date)}</td>
                <td style={{fontFamily:"monospace"}}>{r.sv.fh!=null?fmtHHMM(r.sv.fh):"—"}</td>
                <td style={{fontFamily:"monospace"}}>{r.sv.fc!=null?r.sv.fc.toLocaleString():"—"}</td>
                <td style={{fontFamily:"monospace",color:r.dataIssue&&r.tsiFH!=null&&r.tsiFH<=0?"#f87171":"#e2e8f0"}}>{r.tsiFH!=null?fmtHHMM(r.tsiFH):"—"}{r.dataIssue&&r.tsiFH!=null&&r.tsiFH<=0?" ⚠":""}</td>
                <td style={{fontFamily:"monospace",color:r.dataIssue&&r.tsiFC!=null&&r.tsiFC<=0?"#f87171":"#e2e8f0"}}>{r.tsiFC!=null?r.tsiFC.toLocaleString():"—"}{r.dataIssue&&r.tsiFC!=null&&r.tsiFC<=0?" ⚠":""}</td>
                <td>{r.reasonCategory?r.reasonCategory:<span style={{color:"#475569",fontStyle:"italic"}}>Uncategorised</span>}</td>
                <td style={{color:"#94a3b8"}}>{r.sv.mro||"—"}</td>
              </tr>
            )):(
              <tr><td colSpan={10} style={{color:"#475569",fontStyle:"italic"}}>No shop visits match the current filter</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p style={{fontSize:10,color:"#475569",marginTop:10}}>
        Only Performance Restoration and Hardware events are trended (n ≥ 3 required per segment). Rows highlighted in red have a zero or negative interval — a data quality issue — and are excluded from the summary above but still shown here. reasonCategory isn't collected yet, so every row shows as Uncategorised until the extraction prompt and review-screen updates land.
      </p>
    </div>
  );
}

export { SVAnalyticsCard, REASON_CATEGORIES, TRENDED_CATEGORIES };
