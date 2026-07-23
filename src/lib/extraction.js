import { APU_LLP_PROMPT, ENGINE_LLP_PROMPT } from './assetHelpers';

async function extractLLPSheet(file,kind){
  if(file.type!=="application/pdf")throw new Error("Please upload a PDF file.");
  if(file.size>10*1024*1024)throw new Error("File is too large (maximum 10 MB).");
  const prompt=kind==="llp"?ENGINE_LLP_PROMPT:APU_LLP_PROMPT;
  const extractModel=kind==="llp"?"claude-sonnet-4-6":"claude-haiku-4-5-20251001";
  const base64=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result.split(",")[1]);r.onerror=()=>rej(new Error("Could not read the file. Please try again."));r.readAsDataURL(file);});
  const resp=await fetch("/api/extract",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:extractModel,max_tokens:4000,messages:[{role:"user",content:[{type:"document",source:{type:"base64",media_type:"application/pdf",data:base64}},{type:"text",text:prompt}]}]})});
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
    throw new Error("The AI could not extract structured data from this file. Check it is the correct report type.");
  }
  if(!parsed||typeof parsed!=="object"||Array.isArray(parsed)){
    throw new Error("The AI returned an unexpected format. Check the file is a valid report and try again.");
  }
  return parsed;
};

const fileToBase64=file=>new Promise((res,rej)=>{
  const r=new FileReader();
  r.onload=()=>res(r.result.split(",")[1]);
  r.onerror=()=>rej(new Error("Could not read the file. Please try again."));
  r.readAsDataURL(file);
});

async function extractPdfPageTexts(file){
  if(!window.pdfjsLib) throw new Error("PDF library not loaded — please refresh and try again.");
  const buf=await file.arrayBuffer();
  const doc=await pdfjsLib.getDocument({data:buf}).promise;
  const chunks=[];
  for(let i=1;i<=doc.numPages;i++){
    const page=await doc.getPage(i);
    const content=await page.getTextContent();
    chunks.push({label:`Page ${i}`,text:content.items.map(it=>it.str).join(" ")});
  }
  return chunks;
};

function isBoldPseudoHeading(node){
  const tag=node.tagName.toLowerCase();
  if(tag!=="p"&&tag!=="li") return false;
  const text=node.textContent.trim();
  if(!text||text.length>150) return false;
  const children=Array.from(node.childNodes).filter(n=>n.nodeType===1);
  if(!children.length) return false;
  const boldChars=children.filter(n=>/^(strong|b)$/i.test(n.tagName)).reduce((s,n)=>s+n.textContent.length,0);
  return boldChars>=text.length*0.9;
};

async function extractDocxSectionChunks(file){
  if(!window.mammoth) throw new Error("Document library not loaded — please refresh and try again.");
  const buf=await file.arrayBuffer();
  const result=await mammoth.convertToHtml({arrayBuffer:buf},{styleMap:["p[style-name='Leader'] => h2:fresh"]});
  const parsed=new DOMParser().parseFromString(result.value,"text/html");
  const nodes=Array.from(parsed.body.children);
  const rawChunks=[];
  let current=null;
  let tableCount=0;
  nodes.forEach(node=>{
    const tag=node.tagName.toLowerCase();
    if(/^h[1-4]$/i.test(tag)||isBoldPseudoHeading(node)){
      if(current&&current.text.trim()) rawChunks.push(current);
      current={label:node.textContent.trim()||`Section ${rawChunks.length+1}`,text:""};
    }else if(tag==="table"){
      // Real rate schedules are very often literal Word tables
      // (Component | Rate | Basis columns) — pulled out as their OWN
      // chunk, separate from the surrounding heading-chunk, since a
      // table is a genuinely self-contained structural block. Cells
      // joined with " | " (not just concatenated) to keep column
      // boundaries visible for both scoring and the preview snippet.
      tableCount++;
      const rows=Array.from(node.querySelectorAll("tr")).map(tr=>
        Array.from(tr.querySelectorAll("td,th")).map(cell=>cell.textContent.trim()).join(" | ")
      ).join("\n");
      rawChunks.push({label:current?.label?`Table — ${current.label}`:`Table ${tableCount}`,text:rows,isTable:true});
    }else{
      if(!current) current={label:"Whole Document",text:""};
      current.text+=" "+node.textContent;
    }
  });
  if(current&&current.text.trim()) rawChunks.push(current);

  // Fold any heading-triggered fragment under ~200 characters forward
  // into the next chunk, so a short incidental bold lead-in that isn't
  // a real section boundary doesn't stand alone as noise (genuine
  // sections are never this short).
  const MIN_CHUNK_LEN=200;
  const chunks=[];
  let carry=null;
  rawChunks.forEach(c=>{
    if(c.isTable){ if(carry){chunks.push(carry);carry=null;} chunks.push(c); return; }
    carry=carry?{label:carry.label,text:carry.text+" "+c.label+" "+c.text}:c;
    if(carry.text.trim().length>=MIN_CHUNK_LEN){chunks.push(carry);carry=null;}
  });
  if(carry) chunks.push(carry);
  return chunks.length?chunks:[{label:"Whole Document",text:parsed.body.textContent}];
};

const isSupportedLeaseFile=file=>{
  const name=file.name.toLowerCase();
  return file.type==="application/pdf"||name.endsWith(".pdf")
    ||file.type==="application/vnd.openxmlformats-officedocument.wordprocessingml.document"||name.endsWith(".docx");
};

const isDocxFile=file=>file.type==="application/vnd.openxmlformats-officedocument.wordprocessingml.document"||file.name.toLowerCase().endsWith(".docx");

async function quickParseLeaseFile(file){
  if(isDocxFile(file)){
    const result=await mammoth.extractRawText({arrayBuffer:await file.arrayBuffer()});
    return await runLeaseExtraction({type:"text",text:result.value});
  }
  const base64=await fileToBase64(file);
  return await runLeaseExtraction({type:"document",source:{type:"base64",media_type:"application/pdf",data:base64}});
};

const escapeRegex=s=>s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");

function matchAssetForText(text,assets){
  const norm=s=>s?.toString().replace(/^0+/,"")||"";
  const matches=new Set();
  assets.forEach(a=>{
    const msn=norm(a.msn);
    if(msn){
      const re=new RegExp(`(?<!\\d)0*${msn}(?!\\d)`);
      if(re.test(text)) matches.add(a.id);
    }
    const reg=a.registration?.trim();
    if(reg){
      const re2=new RegExp(`\\b${escapeRegex(reg)}\\b`,"i");
      if(re2.test(text)) matches.add(a.id);
    }
  });
  const ids=[...matches];
  return ids.length===1?assets.find(a=>String(a.id)===String(ids[0])):null;
};

const RATE_CONSTRUCT_RE=/\$\s?[\d,]+(?:\.\d+)?\s*(?:per|\/)\s*(?:calendar\s+month|month|apu\s*(?:operating\s+)?hour|(?:engine\s+)?flight\s+hour|(?:engine\s+)?flight\s+cycle|cycle|hour)/gi;

const LEASE_PAGE_KEYWORDS=[
  {re:RATE_CONSTRUCT_RE,w:6},
  {re:/maintenance (reserve|payment)/gi,w:2},
  {re:/reserve (rate|schedule)/gi,w:2},
  {re:/(6|12)[- ]year check/gi,w:1},
  {re:/landing gear overhaul/gi,w:1},
  {re:/per (engine )?flight hour/gi,w:0.5},
  {re:/per (engine )?flight cycle/gi,w:0.5},
  {re:/per apu (hour|operating hour)/gi,w:0.5},
  {re:/life[- ]limited part/gi,w:0.3},
  {re:/\bllp\b/gi,w:0.3},
  {re:/restoration/gi,w:0.3},
  {re:/escalation/gi,w:0.3},
  {re:/\$\s?\d/g,w:0.15}
];

const DOLLAR_FIGURE_RE=/\$\s?[\d,]{3,}(?:\.\d+)?/g;

function scoreLeaseChunks(chunks){
  return chunks.map((c,i)=>{
    let score=0;
    LEASE_PAGE_KEYWORDS.forEach(k=>{
      const matches=c.text.match(k.re);
      if(matches) score+=matches.length*k.w;
    });
    const dollarFigures=c.text.match(DOLLAR_FIGURE_RE)||[];
    if(dollarFigures.length>=3) score+=dollarFigures.length*2.5;
    return{id:i,label:c.label,score,snippet:c.text.slice(0,240).replace(/\s+/g," ").trim()};
  }).sort((a,b)=>b.score-a.score);
};

const LEASE_EXTRACT_PROMPT=`Extract lease/reserve financial terms from this document. This may be a full aircraft lease agreement or a maintenance reserve rate schedule extract. Extract ONLY what is explicitly stated — do not infer, estimate, or invent values that aren't present; use null for anything not found. Return ONLY valid JSON, no markdown:
{"lessee":"string or null — the lessee/operator airline name","leaseStart":"YYYY-MM-DD or null","leaseEnd":"YYYY-MM-DD or null","pots":{"AF-6Y":{"accrualRate":number}|null,"AF-12Y":{"accrualRate":number}|null,"AP-OH":{"accrualRate":number}|null,"LG-OH":{"accrualRate":number}|null,"ENGINE_RESTORATION":{"accrualRate":number}|null,"ENGINE_LLP":{"accrualRate":number}|null},"notes":"string — ONLY something genuinely NOT captured by the fields above, e.g. lease start/end tied to a delivery event rather than a fixed date, an unusual escalation timing, or a non-USD currency. Do NOT restate accrual rates, escalation percentages, derate mechanics, or definitions already represented by the fields above — if there is nothing beyond that, use an empty string."}
Field meaning: AF-6Y = Airframe 6-Year/heavy structural check reserve (monthly rate). AF-12Y = Airframe 12-Year/deeper structural check reserve (monthly rate). AP-OH = APU overhaul reserve (rate per APU operating hour). LG-OH = Landing gear overhaul reserve (monthly rate). ENGINE_RESTORATION = engine performance restoration reserve (rate per engine flight hour) — applies generically, do not split by engine position unless the document explicitly gives different rates per position. ENGINE_LLP = engine life-limited parts reserve (rate per engine flight cycle) — same rule.`;

async function runLeaseExtraction(contentBlock){
  const resp=await fetch("/api/extract",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-6",max_tokens:1200,messages:[{role:"user",content:[contentBlock,{type:"text",text:LEASE_EXTRACT_PROMPT}]}]})});
  if(!resp.ok) throw new Error(`/api/extract returned ${resp.status}`);
  const result=await resp.json();
  if(result.error) throw new Error(result.error);
  if(result.ok) return result.data;
  try{
    return JSON.parse((result.raw||"").replace(/```json|```/g,"").trim());
  }catch(e){
    throw new Error("Couldn't read this document — it may not be a valid PDF, or the API had trouble with it. Please check the file and try again.");
  }
};

const ATA_CHAPTER_MAP={
  21:"Air Conditioning",22:"Auto Flight",23:"Communications",24:"Electrical Power",
  25:"Equipment/Furnishings",26:"Fire Protection",27:"Flight Controls",28:"Fuel",
  29:"Hydraulic Power",30:"Ice and Rain Protection",31:"Indicating/Recording Systems",
  32:"Landing Gear",33:"Lights",34:"Navigation",35:"Oxygen",36:"Pneumatic",
  37:"Vacuum",38:"Water/Waste",44:"Cabin Systems",45:"Central Maintenance System",
  46:"Information Systems",49:"Airborne Auxiliary Power",52:"Doors",56:"Windows",
  71:"Power Plant",73:"Engine Fuel and Control",74:"Ignition",75:"Air",
  76:"Engine Controls",77:"Engine Indicating",78:"Exhaust",79:"Oil",80:"Starting"
};

const ataChapterLabel=(num)=>{const n=+num;return ATA_CHAPTER_MAP[n]?`ATA ${n} — ${ATA_CHAPTER_MAP[n]}`:`ATA ${n}`;};

const ataChapterSortNum=(label)=>{const m=/ATA\s+(\d+)/.exec(label||"");return m?+m[1]:9999;};

const AVIONICS_LRU_PROMPT=`You are extracting an avionics LRU (Line Replaceable Unit) equipment list from a real aircraft document. Documents vary hugely in layout — some are tables with an ATA Chapter header per section, some have a per-row ATA number column with no section headers, and some (free-text spec sheets) have neither. Extract every distinct LRU/equipment row you can find across all pages.

For each row, extract ONLY:
- "description": the equipment/unit name (e.g. "Radio Altimeter", "Flight Management Guidance Computer"). Required — skip a row entirely if you cannot determine a description.
- "partNumber": the part number as printed (e.g. "9599-607-14942"). Required — skip a row entirely if there is no part number.
- "ataChapter": a plain integer ATA chapter number (e.g. 34, 22, 23) if the row has one printed on it OR sits under a section clearly labelled with an ATA chapter — otherwise null. Do NOT guess a chapter number from the description alone (e.g. do not infer "23" just because a row says "VHF Transceiver" if the source document itself gives no chapter information for that row).

Ignore Manufacturer, Quantity, Serial Number, Install Date, Position/FIN codes, and any other columns present — they are not needed.

Output the final result as a single fenced code block starting with \`\`\`json and ending with \`\`\` — this fenced block must contain ONLY the JSON object below and nothing else inside the fences:
{"rows":[{"description":"string","partNumber":"string","ataChapter":number_or_null}]}`;

async function extractAvionicsLRU(file){
  if(file.type!=="application/pdf")throw new Error("Please upload a PDF file.");
  if(file.size>15*1024*1024)throw new Error("File is too large (maximum 15 MB).");
  const base64=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result.split(",")[1]);r.onerror=()=>rej(new Error("Could not read the file. Please try again."));r.readAsDataURL(file);});
  // Sonnet, not Haiku — same reasoning as ENGINE_LLP_PROMPT (learnings.md):
  // dense multi-page tabular extraction is at/above Haiku's reliable
  // ceiling. max_tokens raised to 8000 — these lists commonly run 50+ rows
  // across several pages (see real samples: SmartLynx 9H-SLG ran 4 pages).
  const resp=await fetch("/api/extract",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-6",max_tokens:8000,messages:[{role:"user",content:[{type:"document",source:{type:"base64",media_type:"application/pdf",data:base64}},{type:"text",text:AVIONICS_LRU_PROMPT}]}]})});
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
    throw new Error("Extraction failed. Please check the file is a valid avionics document and try again.");
  }
  let parsed;
  try{
    const rawParsed=result.ok?result.data:JSON.parse((result.raw||"").replace(/```json|```/g,"").trim());
    parsed=Array.isArray(rawParsed)?rawParsed[rawParsed.length-1]:rawParsed;
  }catch(parseErr){
    throw new Error("The AI could not extract structured data from this file. Check it is a valid avionics equipment list.");
  }
  if(!parsed||typeof parsed!=="object"||!Array.isArray(parsed.rows)){
    throw new Error("The AI returned an unexpected format. Check the file is a valid avionics equipment list.");
  }
  // Normalise: derive the display chapter label here (not in the prompt)
  // so ATA_CHAPTER_MAP stays a single source of truth the model doesn't
  // need to know about — the model only ever returns a bare integer.
  return parsed.rows
    .filter(r=>r&&r.description&&r.partNumber)
    .map((r,i)=>({
      id:"row_"+Date.now()+"_"+i,
      ataChapter:(r.ataChapter!=null&&r.ataChapter!=="")?ataChapterLabel(r.ataChapter):null,
      description:String(r.description).trim(),
      partNumber:String(r.partNumber).trim(),
      hidden:false
    }));
};


export { ATA_CHAPTER_MAP, AVIONICS_LRU_PROMPT, DOLLAR_FIGURE_RE, LEASE_EXTRACT_PROMPT, LEASE_PAGE_KEYWORDS, RATE_CONSTRUCT_RE, ataChapterLabel, ataChapterSortNum, escapeRegex, extractAvionicsLRU, extractDocxSectionChunks, extractLLPSheet, extractPdfPageTexts, fileToBase64, isBoldPseudoHeading, isDocxFile, isSupportedLeaseFile, matchAssetForText, quickParseLeaseFile, runLeaseExtraction, scoreLeaseChunks };
