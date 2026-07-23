const daysFromNow=(d)=>{if(!d)return null;let parsed=d;if(/^\d{2}\/\d{2}\/\d{4}$/.test(d)){const m=d.split("/");parsed=m[2]+"-"+m[1]+"-"+m[0];}return Math.ceil((new Date(parsed)-new Date())/86400000);};

const parseHHMM=(s)=>{if(!s)return 0;const p=s.toString().split(":");return parseFloat(p[0])+(parseFloat(p[1]||0)/60);};

const isCFM=(asset)=>asset?.engines?.some(e=>e.type?.toUpperCase().includes("CFM"));

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


export { APU_LLP_PROMPT, ENGINE_LLP_PROMPT, SC, assetStatus, daysFromNow, isCFM, isEmpty, makeBlankAsset, makeBlankEngineProspect, parseHHMM };
