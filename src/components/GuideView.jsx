import React, { useState, useEffect, useCallback, useRef } from 'react';

function GuideView(){
  const sections=[
    {title:"Overview",icon:"🏠",content:[
      ["Dashboard — List View","Shows all aircraft in a sortable table with MSN, registration, model, operator, airframe TSN/CSN, engine LLP limiters, APU, landing gear due dates, and last report period. Click any row or the View button to open the asset."],
      ["Dashboard — Card View","Toggle to card view using the ☰/⊞ buttons. Each card shows status dot, key identifiers, airframe hours, engine LLP limiters, APU LLP limiter, and landing gear next overhaul dates. N/A shown when data not yet entered."],
      ["Status Indicators","Each asset has a colour-coded dot — green (all clear), amber (attention needed: LLP <3,000 FC or gear due within 12 months), red (critical: LLP <1,000 FC or gear overdue). The worst indicator across all components determines overall status."],
      ["Search & Filter","Use the search bar to filter by MSN, registration, or operator in real time."],
      ["Email Report Queue","If a utilisation report arrives by email with a high-severity warning (S/N change, delta mismatch, or gap detected), it is held back from live data and a banner appears at the top of the Dashboard. Expand the banner to review — each held report shows the MSN, period, and warning text with Apply or Discard options. Apply writes the data to the live asset; Discard removes the pending report without changing anything."],
    ]},
    {title:"Asset Tabs",icon:"📋",content:[
      ["Overview","Shows asset details (MSN, reg, operator, model, manufacturer, DOM), current airframe TSN/CSN prominently displayed, a status summary panel (LLP limiters per engine and APU, landing gear next overhaul dates with days remaining, last report period), and check history (last date and next due)."],
      ["Engines","Shows each engine with S/N, type, thrust, TSN, CSN, FH/FC ratio, lowest LLP limiter, full LLP table (descriptor, P/N, S/N, FC remaining — colour coded), shop visit history (most recent shown; full history on engine-only tech spec), and a Generate Tech Spec button per engine. If an engine is at shop, a frozen Title Engine panel shows the removed engine's details with Engine Returned / Confirm Permanent actions."],
      ["Landing Gear","Shows NLG, LLG, RLG each with P/N, S/N, next overhaul date, last overhaul record (date/TSN/CSN), reference reading (leg TSN/CSN + airframe TSN/CSN at the same moment — used to calculate current totals), and a current TSN/CSN override field from Gear Status Reports. Next Overhaul Due is the lower of a calendar limit (default 10 years) and a cycle limit (default 20,000 cycles) — both editable. Also includes a separate Wheels & Brakes section (Main Wheels, Nose Wheels, Brake Units) with Qty/P/N/Manufacturer. Editable via Edit button; Reference Reading fields are edit-mode only (hidden in read view)."],
      ["APU","Matches engine format — P/N, S/N, TSN, CSN, lowest LLP limiter, full LLP table, and most recent shop visit. Full APU shop visit history is retained in the data but only the most recent visit is shown on both the tab and the tech spec."],
      ["Avionics","Structured equipment list grouped by ATA chapter (e.g. ATA 22 Auto Flight, ATA 34 Navigation), each entry a component name and part number (e.g. FMGC, ADIRU). Admin can add or remove components freely — no fixed field list, since avionics fit varies by aircraft type. Appears as its own page in the full aircraft tech spec, alongside any uploaded Avionics photos, and only renders if data or photos are present."],
      ["Specs","Operating weights (MTOW, MTW, MZFW, MLW in kg and lb), cabin specifications (config, seating, galleys, lavatories, winglets type), avionics toggles (ADS-B, CPDLC, TCAS 7.1, Electronic Flight Bag), full check history (2/6/12 Year checks plus Add Check for custom intervals) with date/TSN/CSN, asset photos (label-based — Airframe, Cabin, Flight Deck, LOPA, Other), and a tech spec disclaimer override field. All fields editable via Edit All button."],
      ["History","Full utilisation upload history — period, AF TSN/CSN, engine CSNs, APU CSN, upload date. Delete individual records."],
      ["Documents","Store document links (Google Drive URLs) with label and category for certificates, reports, and lease documents."],
    ]},
    {title:"Adding & Managing Assets",icon:"✈",content:[
      ["Create from Upload","Go to Upload → Utilisation Report → select PDF or Excel → Extract → review extracted data → Confirm & Save. If the MSN doesn't exist in the system, the asset is created automatically with all available data from the report."],
      ["Create via Email","Send a utilisation report PDF to maverick@reports.tailiq.app. The system extracts and processes it automatically. Low-severity reports apply immediately; high-severity reports (S/N change, delta mismatch, gap) are held in the Dashboard review queue."],
      ["Create Manually","Go to Admin → Assets → New Asset. Enter MSN (required) and other details. Asset is created with blank data ready to populate."],
      ["Edit Asset Details","Open asset → Overview, Engines, Landing Gear, or APU tab → Edit button. For specs, weights, photos, and check history use the Specs tab → Edit All."],
      ["Delete Asset","Admin → Assets → Delete button beside the asset."],
    ]},
    {title:"Uploading Reports",icon:"📤",content:[
      ["Utilisation Report — Manual","Go to Upload → Utilisation Report. Select PDF or Excel. TailiQ extracts: airframe TSN/CSN/period FH/FC, engine model/S/N/TSN/CSN per position, APU S/N/TSN/CSN, landing gear P/N/S/N per position, and any titled component removals."],
      ["Utilisation Report — Email","Send the PDF to maverick@reports.tailiq.app. Processing is automatic — the same AI extraction runs server-side and the result appears in the app within seconds. High-severity warnings route to the Dashboard review queue instead of applying immediately."],
      ["Review Panel","Before saving a manual upload, review extracted data. Engine and APU S/Ns highlight amber with ⚠ if changed from the previous month. Engine CSN deltas show in green/amber/red. A delta verification banner confirms whether the period FC matches the calculated airframe CSN difference."],
      ["Delta Verification","Green banner = period FC matches calculated delta. Red banner = mismatch — review the source document before saving."],
      ["S/N Change — Engine Action","After saving, if an engine S/N has changed, an interactive prompt appears: At Shop (captures the removed engine's snapshot — S/N, TSN/CSN, date — and marks it as title engine), Permanent (confirms the new engine as the permanent fitment), or Engine Returned (clears the at-shop state when the original engine comes back). This decision can also be made later from the Engines tab."],
      ["LLP Status Sheet","Go to Upload → Engine LLP Sheet. Select the PDF. TailiQ extracts all LLP descriptors, P/Ns, S/Ns, and FC remaining for both engines across the four module sections (FAN, HPC, HPT, LPT). Uploading replaces existing LLP data. The engine CSN at time of upload is saved as the reference point for the countdown."],
      ["LOPA","Go to Upload → LOPA. Select a PDF, use the crop tool to isolate the LOPA diagram, then save. The cropped image is stored in Cloudinary under the LOPA label and appears on its own page in the full aircraft tech spec."],
    ]},
    {title:"Lease & Reserve Setup",icon:"📜",content:[
      ["Adding a Lease — Single Asset","Open any asset → 📄 Lease button. Choose how to add it: ✏ Manual Entry (type everything in yourself), ⚡ Quick Extract (upload the lease PDF/Word document — the whole document is processed in one pass, so it can usually find the lessee and lease dates as well as the reserve rate schedule), or 🔒 Confidential Extract (the document is read in your browser first; you then confirm which page holds the rate schedule, and only that page is sent for extraction — it typically won't find the lessee or dates, so you fill those in yourself)."],
      ["Bulk Lease Import","Upload tab → Bulk Lease Import. Upload multiple lease documents at once for different aircraft. Choose Quick Extract or Confidential Extract once — it applies to the whole batch. Files are automatically matched to assets by MSN or registration found in the text; unmatched files can be assigned manually from a dropdown, and scanned/image-only files that have no extractable text are flagged for manual entry via that asset's own Lease Wizard instead."],
      ["Reserve Pot Checklist","After lease details, you'll see a checklist of reserve pots — the four fixed pots (Airframe 6-Year, Airframe 12-Year, APU Overhaul, Landing Gear Overhaul) plus engine pots generated automatically from the asset's own engine configuration, plus a + Add Custom Pot option for anything else. Each pot is entered as rate + opening balance together. Pots are colour-coded: green (complete), amber (in progress or flagged for review), red (outstanding)."],
      ["Save Details for Later vs. Activate Lease","On the final step, Save Details for Later stores lease details and any parsed figures as a starting point without writing reserve pot data yet — useful if you want to come back and finish the pots another time. Activate Lease writes the reserve pot records for real, validated and saved together. Partial completion is fine either way — Brain 3 (Fly-Forward) flags any outstanding pots rather than treating them as zero."],
      ["📄 Lease Indicator","A 📄 icon appears next to any asset that has lease data on file — visible on the Dashboard, Fleet Portfolio cards, and the asset page itself, so you can tell at a glance which assets are ready for Fly Forward."],
    ]},
    {title:"Fly Forward",icon:"🚀",content:[
      ["What It Is","A cash-flow projection for an asset's reserve pots, run against its real lease and reserve data. Reached via the 🚀 Fly Forward button on an asset page or a Fleet Portfolio card — only appears once that asset has an active lease on file."],
      ["Reading the Projection","Each reserve pot gets its own chart showing the projected balance over time, with any upcoming shop visit or check events marked as cost points. A 📍 Anchored badge means the projection is tied to a real next-due date already known from the asset's data (e.g. LLP tracking or landing gear overhaul dates) rather than a generic estimate. A ⚠ Potential Shortfall badge means the projected cost of an event could exceed the projected balance at that point — worth a closer look, not a certainty."],
      ["Viewer Access","Viewer-role users can open Fly Forward and see the same projections as Editors/Admins, but cannot edit lease or reserve pot data — that stays restricted to the Lease Wizard."],
      ["Data Completeness","If some reserve pots aren't confirmed yet, Fly Forward still runs on whatever is available and notes which pots are excluded from the projection, rather than silently treating missing data as zero."],
    ]},
    {title:"Prospects",icon:"🔍",content:[
      ["What It Is","A separate space for aircraft or engines you're evaluating but don't yet own or operate — visible to every role including Viewer, via the Prospects nav item. Prospect assets are kept fully separate from the live fleet: they don't appear on the Dashboard, Fleet Portfolio, Admin → Assets, or the Upload matching pool."],
      ["Creating a Prospect","Prospects → New Prospect. Choose Aircraft (enter MSN and basic details) or Engine (enter ESN, engine type, and thrust) for a standalone single-engine prospect."],
      ["Editing & Tech Specs","Each prospect opens in a split editor — fields on one side, a live tech spec preview on the other, refreshing as you make changes. The same Generate Tech Spec and Share/QR tools used for live fleet assets work identically for prospects."],
    ]},
    {title:"LLP Tracking",icon:"⚙",content:[
      ["How the Countdown Works","FC Remaining = Start FC Rem − (Current Engine CSN − Ref CSN). Ref CSN is the engine CSN when the LLP sheet was uploaded. Start FC Rem is the remaining cycles at that point. Every new utilisation upload refreshes the engine CSN and the countdown adjusts automatically."],
      ["Upload Order","Order doesn't matter. Upload utilisation first then LLP, or LLP first — the calculation always uses the latest engine CSN against the LLP reference point."],
      ["Manual Entry","Engines tab → + Add LLP. Enter descriptor, P/N, S/N, starting FC remaining, and reference CSN (engine CSN at time of entry)."],
      ["Status Colours","Green = >3,000 FC remaining. Amber = 1,000–3,000 FC. Red = <1,000 FC."],
      ["Engine At Shop","When a utilisation report shows a different engine S/N, the app prompts you to mark the previous engine At Shop. The 🔧 icon appears on the dashboard and the asset page. The removed engine's details are frozen in a Title Engine panel on the Engines tab until it returns or is confirmed permanent."],
    ]},
    {title:"Tech Specs",icon:"📄",content:[
      ["Full Aircraft Tech Spec","Open any asset → Generate Tech Spec button (top right). Produces a printable A4 PDF with: TailiQ cover page (with airframe photo if uploaded), asset details, operating weights, specifications (two-column layout), check history, engine data with LLP tables and most-recent shop visit, landing gear and wheels & brakes, APU with LLP table, and LOPA page (if a LOPA has been uploaded)."],
      ["Engine Tech Spec","Engines tab → Generate Tech Spec on each engine. Standalone engine spec with stock photo cover (CFM56 or V2500/IAE, set in Admin → Settings), engine details, full LLP table, and full shop visit history (all visits, not just most recent)."],
      ["Print to PDF","In the tech spec window, click 🖨 Print / Save PDF. In the print dialog select Save as PDF. The toolbar hides automatically when printing."],
      ["Airframe Photo","Upload in Specs tab → Asset Photos with label set to Airframe. The Airframe-labelled photo is used on the tech spec cover. Upload order does not matter — selection is label-based."],
      ["Tech Spec Disclaimer","Default disclaimer text is set fleet-wide in Admin → Settings → Tech Spec Disclaimer. Individual assets can override it in Specs tab → Edit All → Disclaimer field. Public share links also pick up the fleet-wide default automatically."],
      ["Sharing a Tech Spec","Open any asset → Share button. Generates a tokenised read-only link. Copy the link, share via WhatsApp, or show the QR code. Tokens can be revoked at any time from the same Share modal. Public links show the tech spec without requiring a sign-in."],
      ["Engine Stock Photos","Admin → Settings → Engine Stock Photos. Upload one photo per engine type. Used automatically on engine tech specs based on the engine type field."],
    ]},
    {title:"Photos & Documents",icon:"🖼",content:[
      ["Asset Photos","Specs tab → Asset Photos section. Click Upload Photo, choose a label (Airframe, Cabin, Flight Deck, Other), select an image. Photos upload to Cloudinary; the URL is stored in the asset. The Airframe-labelled photo appears on the tech spec cover — label-based, not position-based."],
      ["LOPA","Upload tab → LOPA. Crop tool lets you isolate the LOPA from a full-page PDF. Saved under the LOPA label in Cloudinary and renders on its own dedicated page in the full aircraft tech spec."],
      ["Engine Stock Photos","Admin → Settings. Upload once per engine type (CFM56, V2500/IAE). Applied automatically to engine tech spec covers."],
      ["Documents","Documents tab. Add Google Drive links with a label and category. Use for certificates, lease documents, authority approvals, and maintenance reports."],
    ]},
    {title:"Users & Access",icon:"👤",content:[
      ["Inviting a User","Admin → Settings → Invite User. Enter the new user's email address. They receive a branded TailiQ invite email with a link to set their own password. The link lands on app.tailiq.app and is valid for one use."],
      ["Sign-In","Firebase Auth (email/password) gates the entire app. The sign-in screen is shown to anyone not authenticated — no part of the app is accessible without signing in."],
      ["Managing Users","Users are managed in Firebase Console → Authentication. To remove a user's access, delete them there."],
    ]},
    {title:"Data Storage & Architecture",icon:"💾",content:[
      ["Firebase Firestore","All fleet data (assets, utilisation history, LLP data, settings, share tokens, pending reports) is stored in Firestore (Google Cloud, europe-west2 region — EU data residency). Each asset is one Firestore document. Do not edit documents directly in the Firebase Console unless recovering from an error."],
      ["Cloudinary","Aircraft and engine photos stored on Cloudinary (free tier — 25GB storage). Photos referenced by URL in the asset data."],
      ["Nightly Backup","Firestore is exported nightly at 02:00 UTC via a Cloud Function (firestore-backup, europe-west2). Exports land in gs://vector-fleet-firestore-backups/daily/YYYYMMDD/ — 7 rolling days of snapshots. To restore: create a new Firestore database (never import over the live default), import from the dated backup path, verify, then decide next steps. Last tested 1 July 2026 — all collections confirmed intact."],
      ["Vercel & GitHub","App hosted on Vercel (app.tailiq.app). Code in GitHub (github.com/alanshorten/vector-fleet). To update: replace index.html in GitHub, Vercel redeploys automatically within 60 seconds. Serverless API functions live in the /api folder."],
      ["Environment Variables","All secrets (Firebase config, Anthropic API key, Cloudinary credentials, SendGrid API key, Firebase Admin SDK) are stored as Vercel environment variables — never in GitHub. Manage at vercel.com → Project → Settings → Environment Variables."],
      ["AI Extraction","Utilisation reports and APU LLPs use claude-haiku-4-5-20251001 (fast, cost-effective). Engine LLP sheets use claude-sonnet-4-6 (more capable — required for dense four-section LLP tables). Approximately €0.01–0.02 per report at current volumes."],
    ]},
    {title:"Quick Reference",icon:"⚡",content:[
      ["Key URLs","App: app.tailiq.app · Landing page: tailiq.app · GitHub: github.com/alanshorten/vector-fleet · Vercel: vercel.com · Firebase Console: console.firebase.google.com · GCP Console: console.cloud.google.com (project: vector-fleet)"],
      ["Email Ingestion","Send utilisation reports to: maverick@reports.tailiq.app"],
      ["Cloudinary","Cloud name: dgo3buxcy · Upload preset: fs7bezpu · Dashboard: cloudinary.com"],
      ["If the App Breaks","Check Vercel → Logs for function errors. Confirm the latest index.html is in GitHub. Hard refresh with Ctrl+Shift+R. If AI extraction fails, check Vercel → Environment Variables that ANTHROPIC_API_KEY is set. If sign-in fails, check Firebase Console → Authentication."],
      ["If a Backup Restore Is Needed","Go to GCP Console → Cloud Storage → vector-fleet-firestore-backups → daily/ and identify the most recent YYYYMMDD folder. Create a new Firestore database (do not import over the live default). Run: gcloud firestore import gs://vector-fleet-firestore-backups/daily/YYYYMMDD/ --database=RECOVERY_NAME --project=vector-fleet. Verify before deciding next steps."],
    ]},
  ];

  return(
    <div style={{maxWidth:920,margin:"0 auto",animation:"fadeIn 0.2s ease"}}>
      <div style={{marginBottom:24}}>
        <h1 style={{fontSize:22,color:"#C9A84C",fontWeight:700}}>User Guide</h1>
        <p style={{color:"#5a7a9a",fontSize:13,marginTop:4}}>TailiQ Fleet Intelligence — Complete Reference</p>
      </div>
      {sections.map((s,si)=>(
        <div key={si} className="card" style={{padding:24,marginBottom:14}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16,paddingBottom:12,borderBottom:"1px solid #1e3348"}}>
            <span style={{fontSize:22}}>{s.icon}</span>
            <h2 style={{fontSize:13,fontWeight:700,color:"#e2e8f0",textTransform:"uppercase",letterSpacing:"0.07em"}}>{s.title}</h2>
          </div>
          {s.content.map(([label,text],i)=>(
            <div key={i} style={{marginBottom:14,paddingBottom:14,borderBottom:i<s.content.length-1?"1px solid #152030":"none"}}>
              <div style={{fontSize:12,fontWeight:700,color:"#C9A84C",marginBottom:4}}>{label}</div>
              <div style={{fontSize:13,color:"#7a9ab5",lineHeight:1.65}}>{text}</div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
};


export { GuideView };
