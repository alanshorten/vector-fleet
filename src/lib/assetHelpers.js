const daysFromNow=(d)=>{if(!d)return null;let parsed=d;if(/^\d{2}\/\d{2}\/\d{4}$/.test(d)){const m=d.split("/");parsed=m[2]+"-"+m[1]+"-"+m[0];}return Math.ceil((new Date(parsed)-new Date())/86400000);};

const parseHHMM=(s)=>{if(!s)return 0;const p=s.toString().split(":");return parseFloat(p[0])+(parseFloat(p[1]||0)/60);};

const isCFM=(asset)=>asset?.engines?.some(e=>e.type?.toUpperCase().includes("CFM"));

// Engine family detection, matching the 8-family set the cover-art library
// covers (tailiq-engines-scoping-handoff.md Section 9). "CFM56-7B" is checked
// before "CFM56-5B"/generic CFM so 7B engines don't fall into the 5B bucket.
// "Other"/unmatched types return null -> no stock art, same as before.
function engineFamily(type){
  const t=(type||"").toUpperCase().replace(/\s+/g,"");
  if(t.includes("CFM56-7B")||t.includes("CFM567B"))return"CFM56-7B";
  if(t.includes("CFM56-5B")||t.includes("CFM565B")||t.includes("CFM"))return"CFM56-5B";
  if(t.includes("LEAP-1A")||t.includes("LEAP1A"))return"LEAP-1A";
  if(t.includes("LEAP-1B")||t.includes("LEAP1B"))return"LEAP-1B";
  if(t.includes("V2500"))return"V2500";
  if(t.includes("PW11"))return"PW1100G";
  if(t.includes("CF34"))return"CF34";
  if(t.includes("CF6"))return"CF6";
  return null;
}

// Settings keys deliberately keep the two pre-existing keys (engine_photo_cfm56,
// engine_photo_v2500) unchanged so photos already uploaded via Admin keep working;
// only the 6 new families get new keys.
const ENGINE_FAMILY_PHOTO_KEYS={
  "CFM56-5B":"engine_photo_cfm56",
  "CFM56-7B":"engine_photo_cfm567b",
  "V2500":"engine_photo_v2500",
  "LEAP-1A":"engine_photo_leap1a",
  "LEAP-1B":"engine_photo_leap1b",
  "PW1100G":"engine_photo_pw1100g",
  "CF34":"engine_photo_cf34",
  "CF6":"engine_photo_cf6"
};

function engineStockPhotoKey(type){
  const fam=engineFamily(type);
  return fam?ENGINE_FAMILY_PHOTO_KEYS[fam]:null;
}

// Full-aircraft tech specs show one engine photo representing the fleet's
// engine choice for that asset - keyed off engine #1, same as the old
// isCFM(asset) check did (that only ever looked at whether any engine was CFM).
function assetEngineStockPhotoKey(asset){
  return engineStockPhotoKey(asset?.engines?.[0]?.type);
}

// Airframe family detection - coarse match on asset.model, covering the 7
// airframe cover-art buckets (A319, A320, A321, A330, B737, B737MAX, B787).
// MAX must be checked before the plain 737 check so MAX variants don't land
// in the classic/NG bucket. Unmatched models return null -> no stock art.
function airframeFamily(model){
  const t=(model||"").toUpperCase().replace(/\s+/g,"");
  if(t.includes("737")&&t.includes("MAX"))return"B737MAX";
  if(t.includes("737"))return"B737";
  if(t.includes("787"))return"B787";
  if(t.includes("A319"))return"A319";
  if(t.includes("A320"))return"A320";
  if(t.includes("A321"))return"A321";
  if(t.includes("A330"))return"A330";
  return null;
}

const AIRFRAME_FAMILY_PHOTO_KEYS={
  "A319":"airframe_photo_a319",
  "A320":"airframe_photo_a320",
  "A321":"airframe_photo_a321",
  "A330":"airframe_photo_a330",
  "B737":"airframe_photo_b737",
  "B737MAX":"airframe_photo_b737max",
  "B787":"airframe_photo_b787"
};

function airframeStockPhotoKey(model){
  const fam=airframeFamily(model);
  return fam?AIRFRAME_FAMILY_PHOTO_KEYS[fam]:null;
}

const isEmpty=(v)=>!v&&v!==0;

function makeBlankAsset({msn,registration="",model="A320-214",operator="",manufacturer="Airbus S.A.S.",dom=""},type="aircraft"){
  return{id:msn,type,msn,registration,model,operator,manufacturer,dom,weights:{},specs:{adsb:false,cpdlc:false,tcas:false,cdss:false,rfdd:false,qar:false,modeS:false,efb:false,winglets:""},checks:[{name:"2 Year Check",lastDate:"",lastFH:0,lastFC:0,nextDate:""},{name:"6 Year Check",lastDate:"",lastFH:0,lastFC:0,nextDate:""},{name:"12 Year Check",lastDate:"",lastFH:0,lastFC:0,nextDate:""}],engines:[{position:1,sn:"",type:"",thrust:"",status:"Title",currentFH:0,currentFC:0,llps:[],shopVisits:[]},{position:2,sn:"",type:"",thrust:"",status:"Title",currentFH:0,currentFC:0,llps:[],shopVisits:[]}],landingGear:{nose:{mfr:"",pn:"",sn:"",refLegFH:null,refLegFC:null,refAirframeFH:null,refAirframeFC:null,lastOverhaulDate:"",lastOverhaulFH:null,lastOverhaulFC:null,currentFH:null,currentFC:null,overhaulIntervalYears:10,overhaulIntervalCycles:20000,nextDue:"",shopVisits:[]},left:{mfr:"",pn:"",sn:"",refLegFH:null,refLegFC:null,refAirframeFH:null,refAirframeFC:null,lastOverhaulDate:"",lastOverhaulFH:null,lastOverhaulFC:null,currentFH:null,currentFC:null,overhaulIntervalYears:10,overhaulIntervalCycles:20000,nextDue:"",shopVisits:[]},right:{mfr:"",pn:"",sn:"",refLegFH:null,refLegFC:null,refAirframeFH:null,refAirframeFC:null,lastOverhaulDate:"",lastOverhaulFH:null,lastOverhaulFC:null,currentFH:null,currentFC:null,overhaulIntervalYears:10,overhaulIntervalCycles:20000,nextDue:"",shopVisits:[]}},wheelsBrakes:{mainWheels:{qty:4,pn:"",mfr:""},noseWheels:{qty:2,pn:"",mfr:""},brakes:{qty:4,pn:"",mfr:""}},apu:{mfr:"",pn:"",sn:"",currentFH:0,currentFC:0,llps:[],shopVisits:[]},airframe:{currentFH:0,currentFC:0},photos:[],documents:[],avionics:[],disclaimer:"This outline specification has been prepared based on the information available to Maverick Horizon at the relevant time."};
};

function makeBlankEngineProspect({esn,engineType="",thrust=""}){
  const base=makeBlankAsset({msn:""},"prospect");
  return{...base,id:esn,prospectKind:"engine",msn:"",model:"",manufacturer:"",registration:"",operator:"",engines:[{position:1,sn:esn,type:engineType,thrust,status:"Title",currentFH:0,currentFC:0,llps:[],shopVisits:[]}]};
};

const ENGINE_LLP_PROMPT="Extract engine LLP data from this document. Process each section (FAN, HPC, HPT, LPT) separately. For each LLP row, read left to right: first the LLP DESCRIPTION (e.g. FAN DISK, BOOSTER SPOOL, FAN SHAFT — each row has a unique description, do not repeat), then PART NUMBER, then SERIAL NUMBER. The remaining cycles value is in the RIGHTMOST column group labelled REMAINING CYCLES — identify the engine variant sub-column from the engine type at the top of the document (e.g. CFM56-5B4/P = use 5B4/P sub-column). Each data row corresponds to exactly one description row — match them by row position. Exclude rows where remaining cycles is N/L, N/A, or non-numeric — this includes cells that mix a number with extra wording (e.g. \"2290 to insp. (non LLP)\" is non-numeric and must be excluded, not read as 2290). Also extract the cycle_limit (the approved life limit) for each included row from the CYCLE LIMIT column group (sometimes labelled CYCLE LIMIT/THRESHOLD), using the same engine-variant sub-column as remaining cycles. cycle_limit must be a number, or null if that specific sub-column cell reads N/L, N/A, or is non-numeric — this is independent of whether the row itself was included based on remaining cycles, since a part can have a valid remaining-cycles figure but no approved life limit (e.g. LPT Case, Turbine Rear Frame). Never substitute 0 for null. All TSN and FH values must be formatted as HH:MM strings. You may reason through the table section by section before answering. Once you have finished reasoning, output the final result as a single fenced code block starting with ```json and ending with ``` — this fenced block must contain ONLY the JSON object below and nothing else inside the fences:\n{\"msn\":\"string\",\"registration\":\"string\",\"engines\":[{\"position\":\"LH or RH\",\"esn\":\"string\",\"engine_type\":\"string\",\"variant\":\"string\",\"csn\":number,\"tsn\":number,\"llps\":[{\"desc\":\"string\",\"pn\":\"string\",\"sn\":\"string\",\"fc_remaining\":number,\"cycle_limit\":number}]}]}";

const APU_LLP_PROMPT="Extract APU LLP data ONLY from this document. The APU serial number is labelled SERIAL NUMBER. The fc_remaining value for each LLP must come from the RESIDUAL LIFE - CYS column (also labelled REMAINING COMPON. LIFE or similar), not the TOTAL LIFE or FIXED LIFE column. Also extract cycle_limit (the approved life limit) for each LLP from the TOTAL LIFE or FIXED LIFE column (whichever is present on this document) — this is the figure fc_remaining is explicitly NOT taken from. cycle_limit must be a number, or null if that cell reads N/L, N/A, or is non-numeric. Never substitute 0 for null. IMPORTANT: this document may use European number formatting where a period is a thousands separator, not a decimal point (e.g. 38.093 means 38,093 and 47.075 means 47,075). Convert all numeric values to standard integers. Return ONLY valid JSON, no markdown:\n{\"msn\":\"string or null if not present\",\"registration\":\"string or null if not present\",\"apu\":{\"sn\":\"string\",\"pn\":\"string or null if not present\",\"csn\":number,\"llps\":[{\"desc\":\"string\",\"pn\":\"string\",\"sn\":\"string\",\"fc_remaining\":number,\"cycle_limit\":number}]}}";

const OPERATOR_HISTORY_PROMPT=`Extract the engine operator/movement history (chain of custody) from this document. Real documents vary hugely in format: some use a combined row (install date and removal date on the same row), some use paired rows (a separate IN row and OUT row for the same stint). Normalise every stint (one continuous installation on one aircraft) into a single output row.

For each stint extract:
- operator: the airline/operator name for that stint. Use a per-row value if the table has one; otherwise use the document's letterhead/header operator name for every stint in that document.
- aircraft: the registration or fleet/tail number for that stint (e.g. VT-SCA, B-2332, G-EUPK, 2930).
- installDate: ISO date (YYYY-MM-DD) the engine went on wing for this stint, or null if not stated.
- removalDate: ISO date the engine came off wing for this stint, or null if the engine is STILL ON WING for this stint. Detect still-on-wing from explicit text (STILL ON WING, STILL ATTACHED, Phase out SLX) or a blank/dash removal date/column.
- tsnAtRemoval: engine TSN (hours, plain number not HH:MM) at removal, or the current TSN if still on wing.
- csnAtRemoval: engine CSN (cycles) at removal, or the current CSN if still on wing.
- reason: the stated reason for removal (e.g. LLP, HPC Distress, TIMEX, Redelivery), or null if not stated.

Column name variations meaning the same thing: engine hours may be labelled TSN, ETSN, ETT, ENG FH, ENG_FH. Engine cycles may be labelled CSN, ECSN, ETC, ENG FC, ENG_FC. Install/removal may be labelled IN/OUT, INST/REM, Installation/Removal, Phase In/Phase Out.

Position labels (1/2, LH/RH, Port/Stbd, POS:1/POS:2) may appear ONLY to help pair two rows into one stint - use them for that purpose only, never include position in the output.

Date formats vary (DD-MMM-YY, DD-MMM-YYYY, YYYY/MM/DD, D-Mon-YY, DD-Mon-YYYY) - normalise all dates to ISO YYYY-MM-DD.

You may reason through the document section by section before answering. Once finished, output the final result as a single fenced code block starting with \`\`\`json and ending with \`\`\` - this fenced block must contain ONLY the JSON object below and nothing else inside the fences:
{"rows":[{"operator":"string or null","aircraft":"string or null","installDate":"YYYY-MM-DD or null","removalDate":"YYYY-MM-DD or null","tsnAtRemoval":number_or_null,"csnAtRemoval":number_or_null,"reason":"string or null"}]}`;

function assetStatus(asset){
  const llpVals=(asset.engines||[]).flatMap(e=>(e.llps||[]).map(l=>calcLLPRem(l,e.currentFC)));
  if(asset.apu?.llps)llpVals.push(...asset.apu.llps.map(l=>calcLLPRem(l,asset.apu.currentFC)));
  const minLLP=llpVals.length?Math.min(...llpVals):null;
  const lgDays=["nose","left","right"].map(k=>daysFromNow(asset.landingGear?.[k]?.nextDue)).filter(x=>x!=null);
  const minLG=lgDays.length?Math.min(...lgDays):null;
  if((minLLP!==null&&minLLP<1000)||(minLG!==null&&minLG<0))return"critical";
  if((minLLP!==null&&minLLP<3000)||(minLG!==null&&minLG<365))return"warn";
  return"ok";
};

const SC={critical:{dot:"#f87171",border:"#dc2626"},warn:{dot:"#fbbf24",border:"#d97706"},ok:{dot:"#34d399",border:"#1e3348"}};


export { APU_LLP_PROMPT, ENGINE_LLP_PROMPT, OPERATOR_HISTORY_PROMPT, SC, assetStatus, daysFromNow, isCFM, isEmpty, makeBlankAsset, makeBlankEngineProspect, parseHHMM, engineFamily, engineStockPhotoKey, assetEngineStockPhotoKey, airframeFamily, airframeStockPhotoKey };
