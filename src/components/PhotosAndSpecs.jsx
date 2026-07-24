import React, { useState, useEffect, useCallback, useRef } from 'react';
import { daysFromNow, isEmpty, parseHHMM } from '../lib/assetHelpers';
import { db } from '../lib/db';
import { ataChapterSortNum, extractAvionicsLRU } from '../lib/extraction';
import { uploadToCloudinary } from '../lib/uploadHelpers';

function LopaCropTool({asset,saveAsset,notify,onClose}){
  const[stage,setStage]=useState("upload"); // upload | pages | crop | saving
  const[file,setFile]=useState(null);
  const[pdfDoc,setPdfDoc]=useState(null);
  const[pageThumbs,setPageThumbs]=useState([]);
  const[selectedPage,setSelectedPage]=useState(1);
  const[pageImageUrl,setPageImageUrl]=useState(null);
  const[imgNatural,setImgNatural]=useState({w:0,h:0});
  const[crop,setCrop]=useState({x:40,y:40,w:300,h:200});
  const[dragMode,setDragMode]=useState(null); // null | "move" | "br" | "tl" etc
  const[dragStart,setDragStart]=useState(null);
  const[error,setError]=useState(null);
  const imgRef=useRef(null);
  const containerRef=useRef(null);

  const handleFile=async(e)=>{
    const f=e.target.files?.[0];
    if(!f)return;
    setFile(f);setError(null);
    const isPDF=f.type==="application/pdf";
    if(isPDF){
      if(!window.pdfjsLib){setError("PDF rendering library failed to load. Please refresh and try again.");return;}
      try{
        const buf=await f.arrayBuffer();
        const doc=await pdfjsLib.getDocument({data:buf}).promise;
        setPdfDoc(doc);
        if(doc.numPages===1){
          await renderPage(doc,1);
          setStage("crop");
        } else {
          const thumbs=[];
          for(let i=1;i<=doc.numPages;i++){
            const page=await doc.getPage(i);
            const viewport=page.getViewport({scale:0.3});
            const canvas=document.createElement("canvas");
            canvas.width=viewport.width;canvas.height=viewport.height;
            await page.render({canvasContext:canvas.getContext("2d"),viewport}).promise;
            thumbs.push({page:i,url:canvas.toDataURL()});
          }
          setPageThumbs(thumbs);
          setStage("pages");
        }
      }catch(err){setError("Could not read PDF: "+err.message);}
    } else if(f.type.startsWith("image/")){
      const url=URL.createObjectURL(f);
      setPageImageUrl(url);
      setStage("crop");
    } else {
      setError("Please upload a PDF or image file.");
    }
  };

  const renderPage=async(doc,pageNum)=>{
    const page=await doc.getPage(pageNum);
    const viewport=page.getViewport({scale:2});
    const canvas=document.createElement("canvas");
    canvas.width=viewport.width;canvas.height=viewport.height;
    await page.render({canvasContext:canvas.getContext("2d"),viewport}).promise;
    setPageImageUrl(canvas.toDataURL());
  };

  const choosePage=async(pageNum)=>{
    setSelectedPage(pageNum);
    await renderPage(pdfDoc,pageNum);
    setStage("crop");
  };

  const onImgLoad=()=>{
    const el=imgRef.current;
    if(!el)return;
    setImgNatural({w:el.naturalWidth,h:el.naturalHeight});
    // default crop box to 80% centered
    const dispW=el.clientWidth,dispH=el.clientHeight;
    setCrop({x:dispW*0.1,y:dispH*0.1,w:dispW*0.8,h:dispH*0.8});
  };

  const getRelPos=(e)=>{
    const rect=containerRef.current.getBoundingClientRect();
    const clientX=e.touches?e.touches[0].clientX:e.clientX;
    const clientY=e.touches?e.touches[0].clientY:e.clientY;
    return{x:clientX-rect.left,y:clientY-rect.top};
  };

  const startDrag=(mode)=>(e)=>{
    e.preventDefault();e.stopPropagation();
    setDragMode(mode);
    setDragStart({...getRelPos(e),crop:{...crop}});
  };

  const onDrag=(e)=>{
    if(!dragMode||!dragStart)return;
    const pos=getRelPos(e);
    const dx=pos.x-dragStart.x,dy=pos.y-dragStart.y;
    const el=imgRef.current;
    const maxW=el.clientWidth,maxH=el.clientHeight;
    let{x,y,w,h}=dragStart.crop;
    if(dragMode==="move"){
      x=Math.max(0,Math.min(maxW-w,x+dx));
      y=Math.max(0,Math.min(maxH-h,y+dy));
    } else if(dragMode==="br"){
      w=Math.max(40,Math.min(maxW-x,w+dx));
      h=Math.max(40,Math.min(maxH-y,h+dy));
    } else if(dragMode==="tl"){
      const newX=Math.max(0,Math.min(x+w-40,x+dx));
      const newY=Math.max(0,Math.min(y+h-40,y+dy));
      w=w+(x-newX);h=h+(y-newY);x=newX;y=newY;
    }
    setCrop({x,y,w,h});
  };

  const endDrag=()=>{setDragMode(null);setDragStart(null);};

  const confirmCrop=async()=>{
    setStage("saving");
    try{
      const el=imgRef.current;
      const scaleX=el.naturalWidth/el.clientWidth;
      const scaleY=el.naturalHeight/el.clientHeight;
      const canvas=document.createElement("canvas");
      canvas.width=crop.w*scaleX;
      canvas.height=crop.h*scaleY;
      const ctx=canvas.getContext("2d");
      ctx.fillStyle="#fff";ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.drawImage(el,crop.x*scaleX,crop.y*scaleY,crop.w*scaleX,crop.h*scaleY,0,0,canvas.width,canvas.height);
      const blob=await new Promise(res=>canvas.toBlob(res,"image/png"));
      const croppedFile=new File([blob],"lopa-crop.png",{type:"image/png"});
      const url=await uploadToCloudinary(croppedFile);
      const photos=(asset.photos||[]).filter(p=>p.label!=="LOPA");
      const updated=[...photos,{label:"LOPA",url,date:new Date().toISOString().split("T")[0]}];
      await saveAsset({...asset,photos:updated});
      notify("LOPA photo saved");
      onClose();
    }catch(err){
      setError("Failed to save crop: "+err.message);
      setStage("crop");
    }
  };

  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div className="card" style={{padding:20,maxWidth:900,width:"100%",maxHeight:"90vh",overflow:"auto",background:"#0b1520"}}>
        <div className="flj" style={{marginBottom:14}}>
          <div className="section-title" style={{margin:0}}>LOPA Crop Tool</div>
          <button className="btn btn-ghost" onClick={onClose}>✕ Close</button>
        </div>
        {error&&<div style={{color:"#f87171",fontSize:12,marginBottom:10}}>{error}</div>}

        {stage==="upload"&&(
          <div>
            <div style={{fontSize:12,color:"#64748b",marginBottom:10}}>Upload the full LOPA file (PDF or image). You'll be able to pick a page and crop to just the cabin diagram.</div>
            <input type="file" accept=".pdf,image/*" onChange={handleFile}/>
          </div>
        )}

        {stage==="pages"&&(
          <div>
            <div style={{fontSize:12,color:"#64748b",marginBottom:10}}>This PDF has multiple pages. Select the page with the cabin diagram.</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:10}}>
              {pageThumbs.map(t=>(
                <div key={t.page} onClick={()=>choosePage(t.page)} style={{cursor:"pointer",border:"2px solid #1e3348",borderRadius:6,overflow:"hidden",width:140}}>
                  <img src={t.url} style={{width:"100%",display:"block"}}/>
                  <div style={{textAlign:"center",fontSize:11,color:"#94a3b8",padding:"4px 0",background:"#0d1925"}}>Page {t.page}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {stage==="crop"&&pageImageUrl&&(
          <div>
            <div style={{fontSize:12,color:"#64748b",marginBottom:10}}>Drag the box to select just the cabin diagram. Drag corners to resize.</div>
            <div ref={containerRef} style={{position:"relative",display:"inline-block",maxWidth:"100%"}}
              onMouseMove={onDrag} onMouseUp={endDrag} onMouseLeave={endDrag}
              onTouchMove={onDrag} onTouchEnd={endDrag}>
              <img ref={imgRef} src={pageImageUrl} onLoad={onImgLoad} style={{maxWidth:"100%",display:"block",userSelect:"none"}} draggable={false}/>
              <div onMouseDown={startDrag("move")} onTouchStart={startDrag("move")}
                style={{position:"absolute",left:crop.x,top:crop.y,width:crop.w,height:crop.h,border:"2px solid #C9A84C",background:"rgba(201,168,76,0.15)",cursor:"move"}}>
                <div onMouseDown={startDrag("tl")} onTouchStart={startDrag("tl")} style={{position:"absolute",left:-6,top:-6,width:14,height:14,background:"#C9A84C",borderRadius:"50%",cursor:"nwse-resize"}}/>
                <div onMouseDown={startDrag("br")} onTouchStart={startDrag("br")} style={{position:"absolute",right:-6,bottom:-6,width:14,height:14,background:"#C9A84C",borderRadius:"50%",cursor:"nwse-resize"}}/>
              </div>
            </div>
            <div className="flab g8" style={{marginTop:14}}>
              <button className="btn btn-ghost" onClick={()=>{setStage("upload");setFile(null);setPageImageUrl(null);}}>Start Over</button>
              <button className="btn btn-gold" onClick={confirmCrop}>Save Crop as LOPA</button>
            </div>
          </div>
        )}

        {stage==="saving"&&<div style={{textAlign:"center",padding:30,color:"#64748b"}}>Saving crop...</div>}
      </div>
    </div>
  );
};

function PhotoManager({asset, saveAsset, notify, label="photos", field="photos"}) {
  const [uploading, setUploading] = useState(false);
  const [photoLabel, setPhotoLabel] = useState('Airframe');
  const [lopaToolOpen, setLopaToolOpen] = useState(false);
  const photos = asset[field] || [];

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadToCloudinary(file);
      const updated = [...photos, {label: photoLabel, url, date: new Date().toISOString().split('T')[0]}];
      await saveAsset({...asset, [field]: updated});
      notify(`${photoLabel} photo uploaded`);
    } catch(err) {
      notify('Upload failed: ' + err.message, 'error');
    }
    setUploading(false);
  };

  const deletePhoto = async (i) => {
    if (!confirm('Delete photo?')) return;
    const updated = photos.filter((_,idx) => idx !== i);
    await saveAsset({...asset, [field]: updated});
    notify('Photo deleted');
  };

  return (
    <div>
      <div className="flab g8" style={{marginBottom:12,flexWrap:'wrap'}}>
        <select value={photoLabel} onChange={e=>setPhotoLabel(e.target.value)} style={{width:160}}>
          {['Airframe','LOPA','Avionics','Cabin','Flight Deck','Passenger Seat','Galley G1','Galley G2','Galley G3','Engine','Landing Gear','Documents','Other'].map(l=>(
            <option key={l}>{l}</option>
          ))}
        </select>
        <label style={{cursor:'pointer'}}>
          <input type="file" accept="image/*" onChange={handleUpload} style={{display:'none'}}/>
          <span className="btn btn-primary" style={{padding:'7px 14px',fontSize:12}}>
            {uploading ? '⏳ Uploading…' : '+ Upload Photo'}
          </span>
        </label>
        <button className="btn btn-ghost" style={{padding:'7px 14px',fontSize:12}} onClick={()=>setLopaToolOpen(true)}>
          ✂️ Crop LOPA from File
        </button>
      </div>
      {lopaToolOpen&&<LopaCropTool asset={asset} saveAsset={saveAsset} notify={notify} onClose={()=>setLopaToolOpen(false)}/>}
      {photos.length === 0 && <div style={{color:'#475569',fontSize:12,fontStyle:'italic',padding:'8px 0'}}>No photos uploaded yet.</div>}
      <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
        {photos.map((p,i) => (
          <div key={i} style={{background:'#0d1925',borderRadius:6,overflow:'hidden',border:'1px solid #1e3348',width:120}}>
            <img src={p.url} alt={p.label} style={{width:'100%',height:70,objectFit:'cover',display:'block'}}/>
            <div style={{padding:'5px 7px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div style={{fontSize:10,color:'#94a3b8',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:70}}>{p.label}</div>
              <button className="btn-danger btn" style={{fontSize:9,padding:'1px 5px'}} onClick={()=>deletePhoto(i)}>✕</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

function CheckDateInput({val,onCommit,yrs}){
  const toDisplay=(s)=>{if(!s)return"";if(/^\d{2}\/\d{2}\/\d{4}$/.test(s))return s;try{const dt=new Date(s);if(isNaN(dt))return"";return String(dt.getDate()).padStart(2,"0")+"/"+String(dt.getMonth()+1).padStart(2,"0")+"/"+dt.getFullYear();}catch{return"";}};
  const toISO=(s)=>{const m=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);if(m)return m[3]+"-"+m[2]+"-"+m[1];return null;};
  const plus=(s,y)=>{const m=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);if(!m)return null;return m[1]+"/"+m[2]+"/"+(+m[3]+y);};
  const isoPlus=(isoStr,y)=>{if(!isoStr)return null;const dt=new Date(isoStr);if(isNaN(dt))return null;dt.setFullYear(dt.getFullYear()+y);return dt.toISOString().split("T")[0];};
  const[local,setLocal]=useState(toDisplay(val)||"");
  useEffect(()=>{setLocal(toDisplay(val)||"");},[val]);
  const fmt=(raw)=>{const n=raw.replace(/\D/g,"").slice(0,8);if(n.length<=2)return n;if(n.length<=4)return n.slice(0,2)+"/"+n.slice(2);return n.slice(0,2)+"/"+n.slice(2,4)+"/"+n.slice(4);};
  const handleChange=(raw)=>setLocal(fmt(raw));
  const handleBlur=()=>{
    const iso=toISO(local);
    if(iso){const nextISO=yrs?isoPlus(iso,yrs):null;onCommit(iso,nextISO);}
    else if(!local){onCommit("",null);}
  };
  return<input type="text" placeholder="DDMMYYYY" value={local} onChange={e=>handleChange(e.target.value)} onBlur={handleBlur} style={{width:130}}/>;
};

function SpecsQuickImport({asset,saveAsset,notify,open}){
  const[file,setFile]=useState(null);
  const[extracting,setExtracting]=useState(false);
  const[error,setError]=useState(null);
  const[extracted,setExtracted]=useState(null);

  const handleFile=e=>{const f=e.target.files?.[0];if(f){setFile(f);setExtracted(null);setError(null);}};

  const extract=async()=>{
    if(!file)return;
    const isPDF=file.type==="application/pdf";
    const isExcel=file.type==="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"||file.type==="application/vnd.ms-excel"||file.name.endsWith(".xlsx")||file.name.endsWith(".xls");
    const isImage=file.type.startsWith("image/");
    if(!isPDF&&!isExcel&&!isImage){setError("Unsupported file type. Please upload a PDF, Excel file, or image/screenshot.");return;}
    if(file.size>10*1024*1024){setError("File is too large (maximum 10 MB).");return;}
    setExtracting(true);setError(null);
    try{
      const prompt="Extract aircraft specification and maintenance data from this document or image. Only extract fields that are clearly present — do not guess or invent values. For shop visits, extract all visits shown (most recent preferred if only one fits). For dates, use DD/MM/YYYY format. For TSN use HH:MM format. Return ONLY valid JSON, no markdown:\n{\"dom\":\"MM/YYYY or null\",\"operator\":\"string or null\",\"weights\":{\"mtow\":number_or_null,\"mtow_lb\":number_or_null,\"mtw\":number_or_null,\"mtw_lb\":number_or_null,\"mzfw\":number_or_null,\"mzfw_lb\":number_or_null,\"mlw\":number_or_null,\"mlw_lb\":number_or_null},\"checks\":[{\"name\":\"e.g. 2 Year Check\",\"lastDate\":\"DD/MM/YYYY or null\",\"lastFH\":number_or_null,\"lastFC\":number_or_null,\"nextDate\":\"DD/MM/YYYY or null\"}],\"specs\":{\"config\":\"string or null\",\"seatConfig\":\"string or null\",\"seatMfr\":\"string or null\",\"seatPN\":\"string or null\",\"attendantSeats\":\"string or null\",\"galleys\":\"string or null\",\"lavs\":\"string or null\",\"cargoType\":\"string or null\",\"winglets\":\"string or null\",\"adsb\":true_false_or_null,\"cpdlc\":true_false_or_null,\"tcas\":true_false_or_null,\"cdss\":true_false_or_null,\"rfdd\":true_false_or_null,\"qar\":true_false_or_null,\"modeS\":true_false_or_null,\"efb\":true_false_or_null},\"engines\":[{\"position\":1_or_2,\"sn\":\"string or null\",\"type\":\"string or null\",\"thrust\":\"string or null\",\"shopVisits\":[{\"details\":\"string\",\"date\":\"DD/MM/YYYY or null\",\"fh\":\"HH:MM or null\",\"fc\":number_or_null,\"mro\":\"string or null\"}]}],\"landingGear\":{\"nose\":{\"lastOverhaulDate\":\"DD/MM/YYYY or null\",\"lastOverhaulFH\":number_or_null,\"lastOverhaulFC\":number_or_null,\"nextDue\":\"DD/MM/YYYY or null\"},\"left\":{\"lastOverhaulDate\":\"DD/MM/YYYY or null\",\"lastOverhaulFH\":number_or_null,\"lastOverhaulFC\":number_or_null,\"nextDue\":\"DD/MM/YYYY or null\"},\"right\":{\"lastOverhaulDate\":\"DD/MM/YYYY or null\",\"lastOverhaulFH\":number_or_null,\"lastOverhaulFC\":number_or_null,\"nextDue\":\"DD/MM/YYYY or null\"}},\"apu\":{\"sn\":\"string or null\",\"shopVisits\":[{\"details\":\"string\",\"date\":\"DD/MM/YYYY or null\",\"fh\":\"HH:MM or null\",\"fc\":number_or_null,\"mro\":\"string or null\"}]}}";
      let resp;
      if(isPDF){
        const base64=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result.split(",")[1]);r.onerror=()=>rej(new Error("Could not read the file."));r.readAsDataURL(file);});
        resp=await fetch("/api/extract",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-6",max_tokens:3000,messages:[{role:"user",content:[{type:"document",source:{type:"base64",media_type:"application/pdf",data:base64}},{type:"text",text:prompt}]}]})});
      } else if(isImage){
        const base64=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result.split(",")[1]);r.onerror=()=>rej(new Error("Could not read the file."));r.readAsDataURL(file);});
        resp=await fetch("/api/extract",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-6",max_tokens:3000,messages:[{role:"user",content:[{type:"image",source:{type:"base64",media_type:file.type,data:base64}},{type:"text",text:prompt}]}]})});
      } else {
        const arrayBuffer=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=()=>rej(new Error("Could not read the file."));r.readAsArrayBuffer(file);});
        let csvText;
        try{
          const wb=XLSX.read(new Uint8Array(arrayBuffer),{type:"array"});
          csvText=wb.SheetNames.map(name=>"Sheet: "+name+"\n"+XLSX.utils.sheet_to_csv(wb.Sheets[name],{skipHidden:true})).join("\n\n");
        }catch(xlsxErr){throw new Error("Could not parse the Excel file.");}
        resp=await fetch("/api/extract",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-6",max_tokens:3000,messages:[{role:"user",content:[{type:"text",text:"The following is the contents of an Excel spreadsheet exported as CSV.\n\n"+csvText+"\n\n"+prompt}]}]})});
      }
      if(!resp.ok)throw new Error("Extraction request failed (error "+resp.status+"). Please try again.");
      const result=await resp.json();
      if(result.error)throw new Error("Extraction failed. Please check the file and try again.");
      let parsed;
      try{
        const rawParsed=result.ok?result.data:JSON.parse((result.raw||"").replace(/```json|```/g,"").trim());
        parsed=Array.isArray(rawParsed)?rawParsed[rawParsed.length-1]:rawParsed;
      }catch(parseErr){throw new Error("Could not extract structured data from this file. Try a clearer image or a different file.");}
      setExtracted(parsed);
    }catch(err){
      setError(err.message||"Extraction failed.");
    }
    setExtracting(false);
  };

  const fieldList=()=>{
    if(!extracted)return[];
    const list=[];
    if(extracted.dom)list.push(["Date of Manufacture (Overview)","dom",extracted.dom]);
    if(extracted.operator)list.push(["Current Operator (Overview)","operator",extracted.operator]);
    const w=extracted.weights||{};
    [["mtow","MTOW (kg)"],["mtow_lb","MTOW (lb)"],["mtw","Max Taxi (kg)"],["mtw_lb","Max Taxi (lb)"],["mzfw","MZFW (kg)"],["mzfw_lb","MZFW (lb)"],["mlw","MLW (kg)"],["mlw_lb","MLW (lb)"]].forEach(([k,l])=>{
      if(w[k]!=null)list.push([l,"weights."+k,w[k]]);
    });
    (extracted.checks||[]).forEach((c,i)=>{
      if(c.lastDate)list.push([c.name+" — Last Date","checks."+i+".lastDate",c.lastDate]);
      if(c.lastFH!=null)list.push([c.name+" — Last TSN","checks."+i+".lastFH",c.lastFH]);
      if(c.lastFC!=null)list.push([c.name+" — Last CSN","checks."+i+".lastFC",c.lastFC]);
      if(c.nextDate)list.push([c.name+" — Next Due","checks."+i+".nextDate",c.nextDate]);
    });
    const s=extracted.specs||{};
    [["config","Configuration"],["seatConfig","Passenger Seating Config"],["seatMfr","Passenger Seating Manufacturer"],["seatPN","Passenger Seats P/N"],["attendantSeats","Attendant Seats"],["galleys","Galleys"],["lavs","Lavatories"],["cargoType","Cargo Type"],["winglets","Winglets"]].forEach(([k,l])=>{
      if(s[k])list.push([l,"specs."+k,s[k]]);
    });
    [["adsb","ADS-B"],["cpdlc","CPDLC"],["tcas","TCAS 7.1"],["cdss","Cockpit Door Surveillance System"],["rfdd","Reinforced Flight Deck Door"],["qar","QAR"],["modeS","Enhanced Mode-S"],["efb","Electronic Flight Bag"]].forEach(([k,l])=>{
      if(s[k]!=null)list.push([l,"specs."+k,s[k]?"Installed":"Not Installed"]);
    });
    return list;
  };

  const normalizeDate=(s)=>{
    if(!s)return s;
    // Already ISO
    if(/^\d{4}-\d{2}-\d{2}$/.test(s))return s;
    // DD/MM/YYYY -> ISO
    const m=/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
    if(m)return m[3]+"-"+m[2].padStart(2,"0")+"-"+m[1].padStart(2,"0");
    // Try generic Date parse as last resort, only if it produces a valid date
    const dt=new Date(s);
    if(!isNaN(dt))return dt.toISOString().split("T")[0];
    return null; // unparseable - don't write garbage
  };

  const applyAll=async()=>{
    const f=JSON.parse(JSON.stringify(asset));
    if(extracted.dom)f.dom=extracted.dom;
    if(extracted.operator)f.operator=extracted.operator;
    const w=extracted.weights||{};
    if(!f.weights)f.weights={};
    Object.keys(w).forEach(k=>{if(w[k]!=null)f.weights[k]=w[k];});
    if(extracted.checks?.length){
      if(!f.checks||!f.checks.length)f.checks=extracted.checks.map(c=>({name:c.name,lastDate:"",lastFH:0,lastFC:0,nextDate:""}));
      extracted.checks.forEach((ec,i)=>{
        let target=f.checks.find(fc=>fc.name===ec.name)||f.checks[i];
        if(!target)return;
        if(ec.lastDate){const norm=normalizeDate(ec.lastDate);if(norm)target.lastDate=norm;}
        if(ec.lastFH!=null)target.lastFH=ec.lastFH;
        if(ec.lastFC!=null)target.lastFC=ec.lastFC;
        if(ec.nextDate){const norm=normalizeDate(ec.nextDate);if(norm)target.nextDate=norm;}
      });
    }
    const s=extracted.specs||{};
    if(!f.specs)f.specs={};
    Object.keys(s).forEach(k=>{if(s[k]!=null)f.specs[k]=s[k];});
    // Engine shop visits + basic details
    if(extracted.engines?.length){
      if(!f.engines)f.engines=[];
      extracted.engines.forEach(ee=>{
        const pos=(ee.position||1)-1;
        if(!f.engines[pos])f.engines[pos]={position:ee.position||pos+1,sn:"",type:"",thrust:"",llps:[],shopVisits:[]};
        if(ee.sn)f.engines[pos].sn=ee.sn;
        if(ee.type)f.engines[pos].type=ee.type;
        if(ee.thrust)f.engines[pos].thrust=ee.thrust;
        if(ee.shopVisits?.length){
          const svs=ee.shopVisits.filter(sv=>sv.date||sv.fh||sv.fc).map(sv=>({
            details:sv.details||"",
            date:normalizeDate(sv.date)||"",
            fh:sv.fh?parseHHMM(sv.fh):null,
            fc:sv.fc!=null?+sv.fc:null,
            mro:sv.mro||""
          }));
          if(svs.length)f.engines[pos].shopVisits=[...(f.engines[pos].shopVisits||[]),...svs];
        }
      });
    }
    // Landing gear overhaul dates
    if(extracted.landingGear){
      if(!f.landingGear)f.landingGear={};
      ["nose","left","right"].forEach(leg=>{
        const lg=extracted.landingGear[leg];
        if(!lg)return;
        if(!f.landingGear[leg])f.landingGear[leg]={};
        if(lg.lastOverhaulDate){
          const norm=normalizeDate(lg.lastOverhaulDate);
          if(norm){
            f.landingGear[leg].lastOverhaulDate=norm;
            // Auto-calculate nextDue when the PDF doesn't state it and no value already exists.
            // Uses the leg's configured interval (default 10 years) — same logic as GearCard plusYears().
            // If the PDF does supply nextDue it will overwrite this on the next line below.
            if(!lg.nextDue&&!f.landingGear[leg].nextDue){
              const isoM=/^(\d{4})-(\d{2})-(\d{2})$/.exec(norm);
              if(isoM){const yrs=f.landingGear[leg].overhaulIntervalYears||10;f.landingGear[leg].nextDue=(+isoM[1]+yrs)+"-"+isoM[2]+"-"+isoM[3];}
            }
          }
        }
        if(lg.lastOverhaulFH!=null)f.landingGear[leg].lastOverhaulFH=+lg.lastOverhaulFH;
        if(lg.lastOverhaulFC!=null)f.landingGear[leg].lastOverhaulFC=+lg.lastOverhaulFC;
        if(lg.nextDue){const norm=normalizeDate(lg.nextDue);if(norm)f.landingGear[leg].nextDue=norm;}
      });
    }
    // APU shop visits
    if(extracted.apu?.shopVisits?.length){
      if(!f.apu)f.apu={};
      const svs=extracted.apu.shopVisits.filter(sv=>sv.date||sv.fh||sv.fc).map(sv=>({
        details:sv.details||"",
        date:normalizeDate(sv.date)||"",
        fh:sv.fh?parseHHMM(sv.fh):null,
        fc:sv.fc!=null?+sv.fc:null,
        mro:sv.mro||""
      }));
      if(svs.length)f.apu.shopVisits=[...(f.apu.shopVisits||[]),...svs];
      if(extracted.apu.sn&&!f.apu.sn)f.apu.sn=extracted.apu.sn;
    }
    await saveAsset(f);
    notify("Specs data imported");
    setExtracted(null);setFile(null);
  };

  if(!open)return null;

  return(
    <div className="card" style={{padding:16,marginBottom:16,gridColumn:"1/-1"}}>
      <div>
        <div style={{fontSize:11,color:"#64748b",marginBottom:10}}>Upload a tech spec PDF, Excel sheet, or screenshot. TailiQ will extract Date of Manufacture, Operator, Weights, Check History, Specifications, Engine/APU Shop Visits, and Landing Gear Overhaul dates for review before saving.</div>
        <div className="card" style={{padding:20,textAlign:"center",marginBottom:10,border:"2px dashed #1e3048"}}>
          <div style={{fontSize:28,marginBottom:8}}>📁</div>
          <input type="file" accept=".pdf,.xlsx,.xls,image/*" id="specsQuickImportFile" onChange={handleFile} style={{display:"none"}}/>
          <label htmlFor="specsQuickImportFile" style={{cursor:"pointer"}}>
            <div style={{fontWeight:600,color:file?"#C9A84C":"#64748b",marginBottom:4,fontSize:13}}>{file?file.name:"Click to select file"}</div>
            <div style={{fontSize:11,color:"#475569"}}>PDF, Excel, or screenshot</div>
          </label>
          {file&&(
            <div style={{marginTop:12}}>
              <button className="btn btn-primary" disabled={extracting} onClick={extract}>{extracting?"Extracting…":"Extract"}</button>
            </div>
          )}
        </div>
        {error&&<div style={{color:"#f87171",fontSize:12,marginBottom:10}}>{error}</div>}
        {extracted&&(()=>{
          const w=extracted.weights||{};
          const hasWeights=["mtow","mtw","mzfw","mlw"].some(k=>w[k]!=null||w[k+"_lb"]!=null);
          const checks=extracted.checks||[];
          const s=extracted.specs||{};
          const overviewRows=[];
          if(extracted.dom)overviewRows.push(["Date of Manufacture",extracted.dom]);
          if(extracted.operator)overviewRows.push(["Current Operator",extracted.operator]);
          const specRows=[];
          [["config","Configuration"],["seatConfig","Passenger Seating Config"],["seatMfr","Passenger Seating Manufacturer"],["seatPN","Passenger Seats P/N"],["attendantSeats","Attendant Seats"],["galleys","Galleys"],["lavs","Lavatories"],["cargoType","Cargo Type"],["winglets","Winglets"]].forEach(([k,l])=>{
            if(s[k])specRows.push([l,s[k]]);
          });
          [["adsb","ADS-B"],["cpdlc","CPDLC"],["tcas","TCAS 7.1"],["cdss","Cockpit Door Surveillance System"],["rfdd","Reinforced Flight Deck Door"],["qar","QAR"],["modeS","Enhanced Mode-S"],["efb","Electronic Flight Bag"]].forEach(([k,l])=>{
            if(s[k]!=null)specRows.push([l,s[k]?"Installed":"Not Installed"]);
          });
          const hasEngSV=(extracted.engines||[]).some(e=>e.shopVisits?.length);
          const hasLDG=(()=>{const lg=extracted.landingGear||{};return["nose","left","right"].some(k=>lg[k]&&(lg[k].lastOverhaulDate||lg[k].lastOverhaulFC!=null));})();
          const hasAPUSV=extracted.apu?.shopVisits?.length>0;
          const nothingFound=!overviewRows.length&&!hasWeights&&!checks.length&&!specRows.length&&!hasEngSV&&!hasLDG&&!hasAPUSV;
          return(
            <div style={{background:"#0d1925",borderRadius:6,padding:12}}>
              <div style={{fontSize:11,fontWeight:700,color:"#C9A84C",textTransform:"uppercase",marginBottom:10}}>Detected Fields — Review Before Saving</div>
              {nothingFound?<div style={{color:"#475569",fontStyle:"italic",fontSize:12}}>No recognisable fields found in this file.</div>:(
              <div className="grid2" style={{gap:12}}>
                {overviewRows.length>0&&<div className="card" style={{padding:12,gridColumn:"1/-1"}}>
                  <div className="section-title">Overview</div>
                  <table><tbody>{overviewRows.map(([l,v],i)=>(<tr key={i}><td style={{color:"#64748b"}}>{l}</td><td style={{fontWeight:600}}>{v}</td></tr>))}</tbody></table>
                </div>}
                {hasWeights&&<div className="card" style={{padding:12}}>
                  <div className="section-title">Operating Weights</div>
                  <table><thead><tr><th>Parameter</th><th>kg</th><th>lb</th></tr></thead><tbody>
                    {[["MTOW","mtow","mtow_lb"],["Max Taxi","mtw","mtw_lb"],["MZFW","mzfw","mzfw_lb"],["MLW","mlw","mlw_lb"]].map(([l,k,klb])=>(
                      (w[k]!=null||w[klb]!=null)?<tr key={k}><td style={{color:"#64748b"}}>{l}</td><td>{w[k]!=null?w[k].toLocaleString():"—"}</td><td style={{color:"#475569"}}>{w[klb]!=null?w[klb].toLocaleString():"—"}</td></tr>:null
                    ))}
                  </tbody></table>
                </div>}
                {specRows.length>0&&<div className="card" style={{padding:12}}>
                  <div className="section-title">Specifications</div>
                  <table><tbody>{specRows.map(([l,v],i)=>(<tr key={i}><td style={{color:"#64748b"}}>{l}</td><td style={{fontWeight:600}}>{v}</td></tr>))}</tbody></table>
                </div>}
                {checks.length>0&&<div className="card" style={{padding:12,gridColumn:"1/-1"}}>
                  <div className="section-title">Check History</div>
                  <table><thead><tr><th>Check</th><th>Last Date</th><th>Last TSN</th><th>Last CSN</th><th>Next Due</th></tr></thead><tbody>
                    {checks.map((c,i)=>(<tr key={i}><td style={{fontWeight:600,color:"#94a3b8"}}>{c.name}</td><td>{c.lastDate||"—"}</td><td style={{fontFamily:"monospace"}}>{c.lastFH!=null?c.lastFH.toLocaleString():"—"}</td><td style={{fontFamily:"monospace"}}>{c.lastFC!=null?c.lastFC.toLocaleString():"—"}</td><td style={{fontWeight:700,color:"#34d399"}}>{c.nextDate||"—"}</td></tr>))}
                  </tbody></table>
                </div>}
                {(extracted.engines||[]).filter(e=>e.shopVisits?.length).length>0&&<div className="card" style={{padding:12,gridColumn:"1/-1"}}>
                  <div className="section-title">Engine Shop Visits</div>
                  {(extracted.engines||[]).filter(e=>e.shopVisits?.length).map((e,i)=>(
                    <div key={i} style={{marginBottom:8}}>
                      <div style={{fontSize:11,fontWeight:700,color:"#C9A84C",marginBottom:4}}>Engine {e.position||i+1}{e.sn?` — ESN ${e.sn}`:""}</div>
                      <table style={{fontSize:11}}><thead><tr><th>Details</th><th>Date</th><th>TSN</th><th>CSN</th><th>MRO</th></tr></thead>
                      <tbody>{e.shopVisits.map((sv,si)=><tr key={si}><td>{sv.details||"—"}</td><td>{sv.date||"—"}</td><td style={{fontFamily:"monospace"}}>{sv.fh||"—"}</td><td style={{fontFamily:"monospace"}}>{sv.fc!=null?sv.fc:"—"}</td><td style={{color:"#94a3b8"}}>{sv.mro||"—"}</td></tr>)}</tbody>
                      </table>
                    </div>
                  ))}
                </div>}
                {(()=>{const lg=extracted.landingGear||{};const legs=[["Nose",lg.nose],["LH Main",lg.left],["RH Main",lg.right]].filter(([,g])=>g&&(g.lastOverhaulDate||g.lastOverhaulFC!=null||g.nextDue));if(!legs.length)return null;return<div className="card" style={{padding:12,gridColumn:"1/-1"}}><div className="section-title">Landing Gear Overhauls</div><table><thead><tr><th>Leg</th><th>Last Overhaul</th><th>Leg TSN</th><th>Leg CSN</th><th>Next Due</th></tr></thead><tbody>{legs.map(([label,g])=><tr key={label}><td style={{fontWeight:600,color:"#94a3b8"}}>{label}</td><td>{g.lastOverhaulDate||"—"}</td><td style={{fontFamily:"monospace"}}>{g.lastOverhaulFH!=null?g.lastOverhaulFH:"—"}</td><td style={{fontFamily:"monospace"}}>{g.lastOverhaulFC!=null?g.lastOverhaulFC:"—"}</td><td style={{fontWeight:700,color:"#34d399"}}>{g.nextDue||"—"}</td></tr>)}</tbody></table></div>;})()}
                {extracted.apu?.shopVisits?.length>0&&<div className="card" style={{padding:12,gridColumn:"1/-1"}}>
                  <div className="section-title">APU Shop Visits{extracted.apu.sn?` — S/N ${extracted.apu.sn}`:""}</div>
                  <table style={{fontSize:11}}><thead><tr><th>Details</th><th>Date</th><th>TSN</th><th>CSN</th><th>MRO</th></tr></thead>
                  <tbody>{extracted.apu.shopVisits.map((sv,si)=><tr key={si}><td>{sv.details||"—"}</td><td>{sv.date||"—"}</td><td style={{fontFamily:"monospace"}}>{sv.fh||"—"}</td><td style={{fontFamily:"monospace"}}>{sv.fc!=null?sv.fc:"—"}</td><td style={{color:"#94a3b8"}}>{sv.mro||"—"}</td></tr>)}</tbody>
                  </table>
                </div>}
              </div>
              )}
              {!nothingFound&&<div className="flab g8" style={{marginTop:12}}>
                <button className="btn btn-ghost" onClick={()=>{setExtracted(null);setFile(null);}}>Discard</button>
                <button className="btn btn-gold" onClick={applyAll}>Confirm &amp; Save All</button>
              </div>}
            </div>
          );
        })()}
      </div>
    </div>
  );
};

function AddCheckRow({onAdd,existing=[]}){
  const[custom,setCustom]=useState("");
  const presets=["2 Year Check","6 Year Check","12 Year Check"].filter(p=>!existing.includes(p));
  return(
    <div className="flab g8" style={{marginTop:10,flexWrap:"wrap"}}>
      {presets.map(p=>(
        <button key={p} className="btn btn-ghost" style={{fontSize:11,padding:"5px 10px"}} onClick={()=>onAdd(p)}>+ {p}</button>
      ))}
      <input placeholder="Custom check name" value={custom} onChange={e=>setCustom(e.target.value)} style={{width:160,fontSize:12}}/>
      <button className="btn btn-ghost" style={{fontSize:11,padding:"5px 10px"}} onClick={()=>{if(!custom.trim())return;onAdd(custom.trim());setCustom("");}}>+ Add Check</button>
    </div>
  );
};

function AvionicsLRUReviewRow({row,onChange,onDelete}){
  return(
    <tr>
      <td><input defaultValue={row.description} onBlur={e=>onChange({...row,description:e.target.value})} style={{width:220}}/></td>
      <td><input defaultValue={row.partNumber} onBlur={e=>onChange({...row,partNumber:e.target.value})} style={{width:160,fontFamily:"monospace"}}/></td>
      <td><input defaultValue={row.ataChapter||""} placeholder="e.g. ATA 34 — Navigation" onBlur={e=>onChange({...row,ataChapter:e.target.value.trim()||null})} style={{width:180}}/></td>
      <td><button className="btn-danger btn" style={{fontSize:9,padding:"3px 7px"}} onClick={onDelete}>✕</button></td>
    </tr>
  );
};

function AvionicsLRUUploader({onSaved,notify}){
  const[file,setFile]=useState(null);
  const[extracting,setExtracting]=useState(false);
  const[reviewRows,setReviewRows]=useState(null);
  const[error,setError]=useState(null);
  const doExtract=async()=>{
    if(!file)return;
    setExtracting(true);setError(null);
    try{
      const rows=await extractAvionicsLRU(file);
      if(!rows.length){setError("No rows with both a description and part number were found in this document.");setExtracting(false);return;}
      setReviewRows(rows);
    }catch(e){setError(e.message);}
    setExtracting(false);
  };
  const updateRow=(id,next)=>setReviewRows(rs=>rs.map(r=>r.id===id?next:r));
  const deleteRow=(id)=>setReviewRows(rs=>rs.filter(r=>r.id!==id));
  const confirmSave=async()=>{
    // A full re-parse REPLACES the existing avionicsLRU rows entirely,
    // rather than merging — this is the "here is the current spec sheet
    // for this asset" flow, not an incremental add. Known trade-off: any
    // previously-hidden row's hidden state is not preserved across a
    // re-upload, since the new rows have no stable identity to match
    // against the old ones. Acceptable for now — flag if this becomes a
    // real pain point once assets get re-uploaded in practice.
    await onSaved({rows:reviewRows,hiddenChapters:[]});
    notify(`${reviewRows.length} row(s) saved`);
    setReviewRows(null);setFile(null);
  };
  if(reviewRows){
    return(
      <div className="card" style={{padding:14,marginTop:10}}>
        <div style={{fontSize:11,color:"#94a3b8",marginBottom:8}}>Review before saving — edit or remove any row, then confirm. This replaces the current Avionics LRU list for this asset.</div>
        <table><thead><tr><th>Description</th><th>P/N</th><th>ATA Chapter</th><th></th></tr></thead>
        <tbody>{reviewRows.map(r=>(
          <AvionicsLRUReviewRow key={r.id} row={r} onChange={next=>updateRow(r.id,next)} onDelete={()=>deleteRow(r.id)}/>
        ))}</tbody></table>
        <div className="flab g8" style={{marginTop:10}}>
          <button className="btn btn-ghost" onClick={()=>{setReviewRows(null);setFile(null);}}>Discard</button>
          <button className="btn btn-gold" onClick={confirmSave}>Confirm &amp; Save {reviewRows.length} row(s)</button>
        </div>
      </div>
    );
  }
  return(
    <div className="card" style={{padding:14,marginTop:10}}>
      <div style={{fontSize:10,fontWeight:700,color:"#475569",textTransform:"uppercase",marginBottom:6}}>Upload Avionics Listing (PDF)</div>
      <div style={{fontSize:11,color:"#64748b",marginBottom:10}}>Upload an avionics listing (PDF). TailiQ will extract LRU descriptions and part numbers, grouped by ATA chapter, for review before saving.</div>
      <div className="card" style={{padding:20,textAlign:"center",border:"2px dashed #1e3048"}}>
        <div style={{fontSize:28,marginBottom:8}}>📁</div>
        <input type="file" accept="application/pdf" id="avionicsListingFile" onChange={e=>setFile(e.target.files?.[0]||null)} style={{display:"none"}}/>
        <label htmlFor="avionicsListingFile" style={{cursor:"pointer"}}>
          <div style={{fontWeight:600,color:file?"#C9A84C":"#64748b",marginBottom:4,fontSize:13}}>{file?file.name:"Click to select file"}</div>
          <div style={{fontSize:11,color:"#475569"}}>PDF</div>
        </label>
        {file&&(
          <div style={{marginTop:12}}>
            <button type="button" className="btn btn-primary" disabled={extracting} onClick={doExtract}>{extracting?"Extracting…":"Extract"}</button>
          </div>
        )}
      </div>
      {error&&<div style={{color:"#f87171",fontSize:11,marginTop:6}}>{error}</div>}
    </div>
  );
};

function AvionicsTab({asset,isAdmin,saveAsset,notify}){
  const[editing,setEditing]=useState(false);
  const[form,setForm]=useState(null);
  const[uploaderOpen,setUploaderOpen]=useState(false);
  const lru=asset.avionicsLRU||{rows:[],hiddenChapters:[]};
  const d=editing?form:lru;
  const startEdit=()=>{setForm(JSON.parse(JSON.stringify(lru)));setEditing(true);};
  const cancel=()=>{setForm(null);setEditing(false);};
  const save=async()=>{
    await saveAsset({...asset,avionicsLRU:form},"Updated avionics LRU list");
    setEditing(false);setForm(null);notify("Saved");
  };
  const setRowField=(id,field,val)=>setForm(f=>({...f,rows:f.rows.map(r=>r.id===id?{...r,[field]:val}:r)}));
  const toggleRowHidden=(id)=>setForm(f=>({...f,rows:f.rows.map(r=>r.id===id?{...r,hidden:!r.hidden}:r)}));
  const deleteRow=(id)=>setForm(f=>({...f,rows:f.rows.filter(r=>r.id!==id)}));
  const toggleChapterHidden=(chapterKey)=>setForm(f=>{
    const hidden=f.hiddenChapters||[];
    const idx=hidden.indexOf(chapterKey);
    const next=idx>=0?hidden.filter(c=>c!==chapterKey):[...hidden,chapterKey];
    return{...f,hiddenChapters:next};
  });
  const onUploaderSaved=async(next)=>{
    await saveAsset({...asset,avionicsLRU:next},"Replaced avionics LRU list from spec sheet upload");
    setUploaderOpen(false);
  };
  // Group by chapter (case 1/2), UNGROUPED bucket last (case 3) — never
  // inferred, only ever what the parser/edit actually set on the row.
  const groups={};
  const ungrouped=[];
  (d.rows||[]).forEach(r=>{
    if(r.ataChapter){(groups[r.ataChapter]=groups[r.ataChapter]||[]).push(r);}
    else ungrouped.push(r);
  });
  const sortedChapters=Object.keys(groups).sort((a,b)=>ataChapterSortNum(a)-ataChapterSortNum(b));
  const hiddenChapters=d.hiddenChapters||[];
  const RowsTable=({chapterKey,rows})=>{
    const chapterHidden=chapterKey&&hiddenChapters.includes(chapterKey);
    const visibleRows=editing?rows:rows.filter(r=>!r.hidden&&!chapterHidden);
    if(!editing&&!visibleRows.length)return null;
    return(
      <div className="card" style={{padding:14,opacity:editing&&chapterHidden?0.5:1}}>
        <div className="flj" style={{marginBottom:6}}>
          <div className="section-title" style={{fontSize:12,margin:0}}>{chapterKey||"Ungrouped"}</div>
          {editing&&isAdmin&&chapterKey&&
            <button onClick={()=>toggleChapterHidden(chapterKey)} title={chapterHidden?"Show chapter in tech spec":"Hide entire chapter from tech spec"} style={{background:"none",border:"none",cursor:"pointer",fontSize:12,color:chapterHidden?"#475569":"#C9A84C"}}>{chapterHidden?"🚫 Chapter":"👁 Chapter"}</button>}
        </div>
        <table><thead><tr><th>Description</th><th>P/N</th>{editing&&isAdmin&&<th style={{width:60}}></th>}</tr></thead>
        <tbody>{visibleRows.map(r=>(
          <tr key={r.id} style={{opacity:editing&&r.hidden?0.4:1}}>
            <td style={{fontWeight:600,color:"#94a3b8"}}>
              {editing&&isAdmin?<input defaultValue={r.description} onBlur={e=>setRowField(r.id,"description",e.target.value)} style={{width:180}}/>:r.description}
            </td>
            <td style={{fontFamily:"monospace"}}>
              {editing&&isAdmin?<input defaultValue={r.partNumber} onBlur={e=>setRowField(r.id,"partNumber",e.target.value)} style={{width:140}}/>:r.partNumber}
            </td>
            {editing&&isAdmin&&<td style={{whiteSpace:"nowrap"}}>
              <button onClick={()=>toggleRowHidden(r.id)} title={r.hidden?"Show in tech spec":"Hide from tech spec"} style={{background:"none",border:"none",cursor:"pointer",fontSize:12,color:r.hidden?"#475569":"#C9A84C",padding:"0 3px"}}>{r.hidden?"🚫":"👁"}</button>
              <button className="btn-danger btn" style={{fontSize:9,padding:"3px 7px",marginLeft:2}} onClick={()=>deleteRow(r.id)}>✕</button>
            </td>}
          </tr>
        ))}</tbody></table>
      </div>
    );
  };
  const totalRows=(d.rows||[]).length;
  return(
    <div>
      <div className="flj" style={{marginBottom:14}}>
        {isAdmin&&(!editing?<button className="btn btn-ghost" onClick={()=>setUploaderOpen(!uploaderOpen)}>Upload {uploaderOpen?"▾":"▸"}</button>:<span/>)}
        {isAdmin&&(!editing?<button className="btn btn-ghost" onClick={startEdit}>Edit</button>
          :<div className="flab g8"><button className="btn btn-ghost" onClick={cancel}>Cancel</button><button className="btn btn-gold" onClick={save}>Save</button></div>)}
      </div>
      {isAdmin&&uploaderOpen&&!editing&&<AvionicsLRUUploader onSaved={onUploaderSaved} notify={notify}/>}
      <div className="section-title" style={{marginBottom:14}}>Avionics LRU List</div>
      {!totalRows&&!editing?(
        <div style={{fontSize:12,color:"#475569",padding:"20px 0",textAlign:"center"}}>No avionics LRU data yet — upload a spec sheet above to get started.</div>
      ):(
        <div className="grid2" style={{marginTop:14}}>
          {sortedChapters.map(key=><RowsTable key={key} chapterKey={key} rows={groups[key]}/>)}
          {ungrouped.length>0&&<RowsTable chapterKey={null} rows={ungrouped}/>}
        </div>
      )}
    </div>
  );
};

function SpecsTab({asset,isAdmin,saveAsset,notify}){
  const[editing,setEditing]=useState(false);
  const[form,setForm]=useState(null);
  const[quickImportOpen,setQuickImportOpen]=useState(false);
  const startEdit=()=>{setForm(JSON.parse(JSON.stringify(asset)));setEditing(true);};
  const cancel=()=>{setForm(null);setEditing(false);};
  const save=async()=>{await saveAsset(form);setEditing(false);setForm(null);notify("Saved");};
  const d=editing?form:asset;
  const set=(path,val)=>{const f=JSON.parse(JSON.stringify(form));const parts=path.split(".");let obj=f;for(let i=0;i<parts.length-1;i++){if(!obj[parts[i]])obj[parts[i]]={};obj=obj[parts[i]];}obj[parts[parts.length-1]]=val;setForm(f);};
  const hiddenFields=editing?(form.hiddenSpecFields||[]):(asset.hiddenSpecFields||[]);
  const toggleHide=(path)=>{
    const f=JSON.parse(JSON.stringify(form));
    const hidden=f.hiddenSpecFields||[];
    const idx=hidden.indexOf(path);
    if(idx>=0)hidden.splice(idx,1);else hidden.push(path);
    f.hiddenSpecFields=hidden;
    setForm(f);
  };
  const Field=({label,path,type="text"})=>{
    const parts=path.split(".");const val=parts.reduce((o,k)=>o?.[k],d);
    const isHidden=hiddenFields.includes(path);
    if(!editing&&isHidden)return null;
    return<div className="form-group" style={{display:"flex",alignItems:"flex-start",gap:4}}>
      <div style={{flex:1}}>
        <label className="form-label">{label}</label>
        {editing&&isAdmin?<input type={type} defaultValue={val||""} onBlur={e=>set(path,e.target.value)} tabIndex={0} style={{opacity:isHidden?0.4:1}}/>
        :<div style={{fontSize:13,fontWeight:500,color:isEmpty(val)?"#475569":"#e2e8f0"}}>{type==="date"?fmtDate(val):val||"Not entered"}</div>}
      </div>
      {editing&&isAdmin&&<button onClick={()=>toggleHide(path)} title={isHidden?"Show in tech spec":"Hide from tech spec"} style={{marginTop:18,background:"none",border:"none",cursor:"pointer",fontSize:13,color:isHidden?"#475569":"#C9A84C",padding:"2px 4px",flexShrink:0}}>{isHidden?"🚫":"👁"}</button>}
    </div>;
  };
  return(
    <div>
      <div className="flj" style={{marginBottom:14}}>
        <button className="btn btn-ghost" onClick={()=>setQuickImportOpen(!quickImportOpen)}>Upload {quickImportOpen?"▾":"▸"}</button>
        {!editing?<button className="btn btn-ghost" onClick={startEdit}>Edit</button>:<div className="flab g8"><button className="btn btn-ghost" onClick={cancel}>Cancel</button><button className="btn btn-gold" onClick={save}>Save</button></div>}
      </div>
    <SpecsQuickImport asset={asset} saveAsset={saveAsset} notify={notify} open={quickImportOpen}/>
    <div className="grid2">
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
      <div className="card" style={{padding:18}}>
        <div className="section-title">Operating Weights</div>
        <table><thead><tr><th>Parameter</th><th>kg</th><th>lb</th></tr></thead><tbody>
          {[["MTOW","mtow","mtow_lb"],["Max Taxi","mtw","mtw_lb"],["MZFW","mzfw","mzfw_lb"],["MLW","mlw","mlw_lb"]].map(([l,k,klb])=>(
            <tr key={k}><td style={{color:"#64748b"}}>{l}</td>
            <td>{editing&&isAdmin?<input type="number" value={d.weights?.[k]||""} onChange={e=>{const kg=+e.target.value;const f=JSON.parse(JSON.stringify(form));if(!f.weights)f.weights={};f.weights[k]=kg;if(kg)f.weights[klb]=Math.round(kg*2.20462);else f.weights[klb]="";setForm(f);}} style={{width:100}}/>:d.weights?.[k]?.toLocaleString()||"—"}</td>
            <td style={{color:"#475569"}}>{editing&&isAdmin?<input type="number" value={d.weights?.[klb]||""} onChange={e=>{const lb=+e.target.value;const f=JSON.parse(JSON.stringify(form));if(!f.weights)f.weights={};f.weights[klb]=lb;if(lb)f.weights[k]=Math.round(lb/2.20462);else f.weights[k]="";setForm(f);}} style={{width:100}}/>:d.weights?.[klb]?.toLocaleString()||"—"}</td></tr>
          ))}
        </tbody></table>
      </div>
      <div className="card" style={{padding:18}}>
        <div className="flj" style={{marginBottom:2}}>
          <div className="section-title" style={{margin:0}}>Check History</div>
        </div>
        {(editing?form:asset).checks?.length?(editing?form:asset).checks.map((c,i)=>(
          <div key={i} style={{marginTop:i>0?14:0,paddingTop:i>0?14:0,borderTop:i>0?"1px solid #1e3048":"none"}}>
            <div className="flj" style={{marginBottom:6}}>
              <span style={{fontSize:11,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:"0.04em"}}>{c.name}</span>
              {editing&&isAdmin&&<button className="btn-danger btn" style={{fontSize:9,padding:"3px 7px"}} onClick={()=>{const f=JSON.parse(JSON.stringify(form));f.checks.splice(i,1);setForm(f);}}>✕</button>}
            </div>
            <div className="flj" style={{padding:"3px 0"}}>
              <span style={{fontSize:12,color:"#64748b"}}>TSN</span>
              {editing&&isAdmin?<input type="text" defaultValue={c.lastFH||""} onBlur={e=>{const f=JSON.parse(JSON.stringify(form));f.checks[i].lastFH=e.target.value?+e.target.value:null;setForm(f);}} style={{width:90,textAlign:"right"}}/>:<span style={{fontSize:12,fontFamily:"monospace",color:isEmpty(c.lastFH)?"#475569":"#e2e8f0"}}>{c.lastFH?.toLocaleString()||"—"}</span>}
            </div>
            <div className="flj" style={{padding:"3px 0"}}>
              <span style={{fontSize:12,color:"#64748b"}}>CSN</span>
              {editing&&isAdmin?<input type="number" defaultValue={c.lastFC||""} onBlur={e=>{const f=JSON.parse(JSON.stringify(form));f.checks[i].lastFC=e.target.value?+e.target.value:null;setForm(f);}} style={{width:90,textAlign:"right"}}/>:<span style={{fontSize:12,fontFamily:"monospace",color:isEmpty(c.lastFC)?"#475569":"#e2e8f0"}}>{c.lastFC?.toLocaleString()||"—"}</span>}
            </div>
            <div className="flj" style={{padding:"3px 0"}}>
              <span style={{fontSize:12,color:"#64748b"}}>Last</span>
              {editing&&isAdmin?<CheckDateInput val={c.lastDate} onCommit={(iso,next)=>{const f=JSON.parse(JSON.stringify(form));f.checks[i].lastDate=iso;if(next)f.checks[i].nextDate=next;setForm(f);}} yrs={(()=>{const m=/(\d+)\s*Year/i.exec(c.name);return m?+m[1]:null;})()}/>:<span style={{fontSize:12,color:isEmpty(c.lastDate)?"#475569":"#e2e8f0"}}>{fmtDate(c.lastDate)||"—"}</span>}
            </div>
            <div className="flj" style={{padding:"3px 0"}}>
              <span style={{fontSize:12,color:"#64748b"}}>Next Due</span>
              {editing&&isAdmin?<CheckDateInput val={c.nextDate} onCommit={(iso)=>{const f=JSON.parse(JSON.stringify(form));f.checks[i].nextDate=iso;setForm(f);}} yrs={null}/>:<span style={{fontSize:12,fontWeight:700,color:daysFromNow(c.nextDate)<365?"#fbbf24":"#34d399"}}>{fmtDate(c.nextDate)||"—"}</span>}
            </div>
          </div>
        )):<div style={{color:"#475569",fontStyle:"italic",fontSize:12}}>No check history recorded</div>}
        {editing&&isAdmin&&<div style={{marginTop:12}}><AddCheckRow existing={(form.checks||[]).map(c=>c.name)} onAdd={name=>{const f=JSON.parse(JSON.stringify(form));if(!f.checks)f.checks=[];f.checks.push({name,lastDate:"",lastFH:0,lastFC:0,nextDate:""});setForm(f);}}/></div>}
      </div>
      </div>
      <div className="card" style={{padding:18}}>
        <div className="section-title">Specifications</div>
        {[["Configuration","specs.config"],["Passenger Seating Config","specs.seatConfig"],["Passenger Seating Manufacturer","specs.seatMfr"],["Passenger Seats P/N","specs.seatPN"],["Attendant Seats","specs.attendantSeats"],["Galleys","specs.galleys"],["Lavatories","specs.lavs"],["Cargo Type","specs.cargoType"],["Winglets","specs.winglets"]].map(([l,p])=><Field key={p} label={l} path={p}/>)}
        <div style={{marginTop:10}}>
          {[["Cockpit Door Surveillance System","specs.cdss"],["Reinforced Flight Deck Door","specs.rfdd"],["QAR","specs.qar"],["Enhanced Mode-S","specs.modeS"],["ADS-B","specs.adsb"],["CPDLC","specs.cpdlc"],["TCAS 7.1","specs.tcas"],["Electronic Flight Bag","specs.efb"]].map(([l,p])=>{
            const parts=p.split(".");const val=parts.reduce((o,k)=>o?.[k],d);
            const isHidden=hiddenFields.includes(p);
            if(!editing&&isHidden)return null;
            return<div key={p} className="flj" style={{padding:"5px 0",borderBottom:"1px solid #0f2030",opacity:editing&&isHidden?0.4:1}}>
              <span style={{fontSize:12,color:"#64748b"}}>{l}</span>
              <div className="flab g8">
                {editing&&isAdmin
                  ?<button onClick={()=>set(p,!val)} className="pill" style={{background:val?"#0d2818":"#2a0e0e",color:val?"#34d399":"#f87171",border:"none",cursor:"pointer",fontSize:11}}>{val?"Installed":"Not Installed"}</button>
                  :<span className="pill" style={{background:val?"#0d2818":"#2a0e0e",color:val?"#34d399":"#f87171",fontSize:10}}>{val?"Installed":"Not Installed"}</span>}
                {editing&&isAdmin&&<button onClick={()=>toggleHide(p)} title={isHidden?"Show":"Hide"} style={{background:"none",border:"none",cursor:"pointer",fontSize:12,color:isHidden?"#475569":"#C9A84C",padding:"0 2px"}}>{isHidden?"🚫":"👁"}</button>}
              </div>
            </div>;
          })}
        </div>
        <div style={{marginTop:14}}>
          <div style={{fontSize:10,fontWeight:700,color:"#475569",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:8}}>Custom Fields</div>
          {[0,1,2,3,4].map(idx=>{
            const cf=(d.specs?.custom||[])[idx]||{label:"",value:""};
            return<div key={idx} className="flab g8" style={{marginBottom:6}}>
              {editing&&isAdmin
                ?<><input placeholder="Field name" defaultValue={cf.label||""} onBlur={e=>{const f=JSON.parse(JSON.stringify(form));if(!f.specs)f.specs={};if(!f.specs.custom)f.specs.custom=[{},{},{},{},{}];while(f.specs.custom.length<5)f.specs.custom.push({});f.specs.custom[idx]={...f.specs.custom[idx],label:e.target.value};setForm(f);}} style={{width:160,fontStyle:"italic",color:"#64748b"}}/><input placeholder="Value" defaultValue={cf.value||""} onBlur={e=>{const f=JSON.parse(JSON.stringify(form));if(!f.specs)f.specs={};if(!f.specs.custom)f.specs.custom=[{},{},{},{},{}];while(f.specs.custom.length<5)f.specs.custom.push({});f.specs.custom[idx]={...f.specs.custom[idx],value:e.target.value};setForm(f);}} style={{flex:1}}/></>
                :(cf.label&&cf.value)?<div className="flj" style={{width:"100%",padding:"3px 0",borderBottom:"1px solid #0f2030"}}><span style={{fontSize:12,color:"#64748b"}}>{cf.label}</span><span style={{fontSize:12,fontWeight:500,color:"#e2e8f0"}}>{cf.value}</span></div>:null}
            </div>;
          })}
        </div>
      </div>
      <div className="card" style={{padding:18,marginTop:16}}>
        <div className="section-title">Tech Spec Disclaimer</div>
        <div style={{fontSize:11,color:"#64748b",marginBottom:10}}>Shown at the bottom of the generated tech spec document for this asset only. Leave blank to use the company-wide default set in Admin → Settings.</div>
        {editing&&isAdmin
          ?<textarea defaultValue={d.disclaimer||""} onBlur={e=>set("disclaimer",e.target.value)} rows={3} style={{width:"100%",fontFamily:"inherit",fontSize:13,resize:"vertical"}}/>
          :<div style={{fontSize:13,fontWeight:500,color:isEmpty(d.disclaimer)?"#475569":"#e2e8f0"}}>{d.disclaimer||"Not entered — company-wide default will be used"}</div>}
      </div>
      <div className="card" style={{padding:18,marginTop:16}}>
        <div className="section-title">Asset Photos</div>
        <PhotoManager asset={asset} saveAsset={saveAsset} notify={notify} field="photos"/>
      </div>
    </div>
    </div>
  );
};

function HistoryTab({asset,isAdmin,notify}){
  const[history,setHistory]=useState([]);
  const[loading,setLoading]=useState(true);
  useEffect(()=>{db.getUtilisation(asset.id).then(rows=>{setHistory(rows);setLoading(false);}).catch(()=>setLoading(false));},[asset.id]);
  const del=async(id)=>{if(!confirm("Delete?"))return;await db.deleteUtilisation(id);setHistory(h=>h.filter(r=>r.id!==id));notify("Deleted");};
  if(loading)return<div style={{padding:20,color:"#475569"}}>Loading…</div>;
  return(
    <div className="card" style={{padding:18}}>
      <div className="section-title">Utilisation History</div>
      {history.length===0?<div style={{textAlign:"center",padding:48,color:"#475569"}}>No history yet.</div>:(
        <div style={{overflowX:"auto",WebkitOverflowScrolling:"touch"}}>
        <table><thead><tr><th>Period</th><th>AF TSN</th><th>AF CSN</th><th>Eng 1 CSN</th><th>Eng 2 CSN</th><th>APU CSN</th><th>Uploaded</th><th></th></tr></thead>
        <tbody>{history.map(r=>(
          <tr key={r.id}>
            <td style={{fontWeight:600,color:"#C9A84C"}}>{r.period}</td>
            <td style={{fontFamily:"monospace"}}>{r.data?.afFH||"—"}</td><td style={{fontFamily:"monospace"}}>{r.data?.afFC?.toLocaleString()||"—"}</td>
            <td style={{fontFamily:"monospace"}}>{r.data?.eng1FC?.toLocaleString()||"—"}</td><td style={{fontFamily:"monospace"}}>{r.data?.eng2FC?.toLocaleString()||"—"}</td>
            <td style={{fontFamily:"monospace"}}>{r.data?.apuFC?.toLocaleString()||"—"}</td>
            <td style={{fontSize:11,color:"#475569"}}>{fmtDate(r.created_at)}</td>
            <td><button className="btn-danger btn" style={{fontSize:10,padding:"2px 7px"}} onClick={()=>del(r.id)}>Delete</button></td>
          </tr>
        ))}</tbody></table>
        </div>
      )}
    </div>
  );
};

function DocumentsTab({asset}){
  const view=doc=>{const win=window.open();win.document.write(`<iframe src="${doc.data}" style="width:100%;height:100vh;border:none"/>`)};
  return(
    <div className="card" style={{padding:18}}>
      <div className="section-title">Documents</div>
      {(asset.documents||[]).length===0?<div style={{textAlign:"center",padding:48,color:"#475569"}}>No documents uploaded yet.</div>:(
        <table><thead><tr><th>Label</th><th>Category</th><th>Date</th><th></th></tr></thead>
        <tbody>{(asset.documents||[]).map((d,i)=>(
          <tr key={i}><td style={{fontWeight:500}}>{d.label}</td><td><span className="tag" style={{background:"#1e3348",color:"#94a3b8"}}>{d.category}</span></td><td>{fmtDate(d.date)}</td>
          <td><button className="btn btn-ghost" style={{fontSize:11,padding:"3px 8px"}} onClick={()=>view(d)}>View</button></td></tr>
        ))}</tbody></table>
      )}
    </div>
  );
};


export { AddCheckRow, AvionicsLRUReviewRow, AvionicsLRUUploader, AvionicsTab, CheckDateInput, DocumentsTab, HistoryTab, LopaCropTool, PhotoManager, SpecsQuickImport, SpecsTab };
