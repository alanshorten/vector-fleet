import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AdminView } from './components/AdminView';
import { AssetView, NavPill, TRAILING_PILL_WIDTH } from './components/AssetView';
import { SetPasswordScreen, SignInScreen } from './components/Auth';
import { Dashboard } from './components/Dashboard';
import { FleetCalendarView, FleetExposureView, FleetScenarioControls, PandemicScenarioView, PortfolioView, RouteMatcherView } from './components/PortfolioView';
import { ProspectEditor, ProspectListView } from './components/Prospects';
import { UploadView } from './components/UploadView';
import { db, logAudit } from './lib/db';
import { bootstrapKnowledgeBaseGlobals } from './lib/knowledgeBase';
import { HEADER_LOGO_NAVY } from './lib/techSpec';
import { LayoutModeProvider, useLayoutMode } from './lib/layoutMode';
import { IQView } from './components/IQView';

// ---------------------------------------------------------------------
// HamburgerMenu — low-frequency items off the main nav bar.
//
// Desktop / landscape (≥ ~900px): holds Prospects · iQ (admin) · Settings · Sign Out
// Mobile / portrait (< ~900px):   holds Fleet Nav group (Details ·
//   Calendar · Financials · Scenarios) + Tools (Prospects, Upload, iQ) +
//   Account (Settings, Sign Out)
//
// Three groups separated by thin dividers. Active page highlighted same
// as NavPill. Role gating carries through unchanged — items only render
// if the caller passes them in.
//
// Scoping: hamburger-menu-build-handoff.md
// ---------------------------------------------------------------------
function HamburgerMenu({ view, onSelect, isMobile, canSeeAdvanced, canUpload, isAdmin, isPortfolio }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [open]);

  const navigate = (v) => {
    setOpen(false);
    if (v === 'signout') { window._auth.signOut(); return; }
    onSelect(v);
  };

  // Colour tokens — TAILIQ_UI_DESIGN_SYSTEM.md palette. Header is always
  // light now (no navy/white banner switching), so the menu itself stays a
  // carbon surface (same treatment a context menu gets against a light
  // page) with an ochre active-state, matching the NavPill underline.
  const menuBg = '#151A1D';
  const menuBorder = 'rgba(255,255,255,0.12)';
  const itemHover = 'rgba(255,255,255,0.08)';
  const textActive = '#B88728';
  const textMuted = 'rgba(252,252,249,0.65)';
  const divider = 'rgba(255,255,255,0.12)';

  const Item = ({ value, label }) => {
    const active = view === value;
    return (
      <button
        onClick={() => navigate(value)}
        style={{
          display: 'block', width: '100%', textAlign: 'left',
          padding: '9px 16px', border: 'none', borderRadius: 6,
          background: 'transparent',
          color: active ? textActive : textMuted,
          fontSize: 13, fontWeight: active ? 700 : 500,
          cursor: 'pointer', fontFamily: "'Barlow',inherit",
          transition: 'background 0.12s, color 0.12s',
        }}
        onMouseEnter={e => { if (!active) e.currentTarget.style.background = itemHover; }}
        onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
      >
        {label}
      </button>
    );
  };

  const GroupLabel = ({ children }) => (
    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(252,252,249,0.4)', padding: '8px 16px 4px', fontFamily: "'Barlow',inherit" }}>
      {children}
    </div>
  );

  const Divider = () => (
    <div style={{ height: 1, background: divider, margin: '6px 0' }}/>
  );

  // Pill/icon colours — header is always light now, so the ☰ trigger is a
  // plain graphite icon rather than a filled dark pill (isPortfolio no
  // longer changes anything here; param kept for signature compatibility).
  const pillBg = 'transparent';
  const pillBorder = '#D9DCD8';
  const iconColor = '#687078';
  const iconColorActive = '#151A1D';

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      {/* Pill wrapper — same visual language as NavPill so ☰ reads as a nav element */}
      <div style={{
        background: pillBg, border: `1px solid ${pillBorder}`,
        borderRadius: 8, padding: '2px',
        display: 'inline-flex', alignItems: 'center',
      }}>
        <button
          onClick={() => setOpen(o => !o)}
          aria-label="Menu"
          aria-expanded={open}
          style={{
            background: open ? (isPortfolio ? '#e2e8f0' : 'rgba(255,255,255,0.10)') : 'transparent',
            border: 'none', borderRadius: 6,
            padding: '5px 11px', cursor: 'pointer',
            color: open ? iconColorActive : iconColor,
            fontSize: 16, lineHeight: 1,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'all 0.15s', fontFamily: 'inherit',
          }}
        >
          ☰
        </button>
      </div>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 200,
          background: menuBg, border: `1px solid ${menuBorder}`,
          borderRadius: 10, padding: '6px 0', minWidth: 180,
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
          animation: 'fadeIn 0.12s ease',
        }}>
          {/* Group 1 — Fleet Nav (portrait only — on desktop the pill stays on screen) */}
          {isMobile && canSeeAdvanced && (
            <>
              <GroupLabel>Fleet</GroupLabel>
              <Item value="dashboard" label="Details"/>
              <Item value="fleetcalendar" label="Calendar"/>
              <Item value="fleetexposure" label="Financials"/>
              <Item value="fleetscenarios" label="Scenarios"/>
              <Divider/>
            </>
          )}

          {/* Group 2 — Tools. Upload is deliberately not listed here — it's
              a permanently anchored control in the header itself on every
              screen size, never buried in the menu (design system,
              non-negotiable). */}
          <GroupLabel>Tools</GroupLabel>
          <Item value="prospects" label="Prospects"/>
          {isAdmin && <Item value="iq" label="iQ"/>}
          <Divider/>

          {/* Account */}
          <GroupLabel>Account</GroupLabel>
          <Item value="settings" label="Settings"/>
          <Item value="signout" label="⎋ Sign Out"/>
        </div>
      )}
    </div>
  );
}

function AppInner(){
  // Invite-link landing — must be checked before any sign-in gate, since
  // the person clicking this link has no TailiQ account/session yet.
  if(new URLSearchParams(window.location.search).get("view")==="set-password"){
    return <SetPasswordScreen/>;
  }
  const[authUser,setAuthUser]=useState(window._authUser===undefined?undefined:window._authUser);
  const[configError,setConfigError]=useState(window._configError||false);
  const[assets,setAssets]=useState([]);
  const[loading,setLoading]=useState(true);
  const[error,setError]=useState(null);
  const[view,setView]=useState("dashboard");
  const[selectedId,setSelectedId]=useState(null);
  const[assetInitialLayer,setAssetInitialLayer]=useState("details");
  const[assetLayer,setAssetLayer]=useState("details");
  const[assetShareOpen,setAssetShareOpen]=useState(false);
  const genSpecRef=useRef(null);
  const[userRole,setUserRole]=useState(null);
  const[notification,setNotification]=useState(null);
  const { mode: layoutMode } = useLayoutMode();

  // Reuse the existing ~900px breakpoint from layoutMode.js — "portrait" maps to
  // mobile/narrow, "landscape" to desktop/wide. Hamburger content differs by this.
  const isMobile = layoutMode === "portrait";

  const loadAssets=useCallback(async()=>{
    try{
      const assets=await db.getAssets();
      setAssets(assets);
      setError(null);
    }catch(e){setError(e.message);}
    setLoading(false);
  },[]);

  useEffect(()=>{
    const onConfigError=()=>setConfigError(true);
    window.addEventListener('firebase-config-error', onConfigError);
    return ()=>window.removeEventListener('firebase-config-error', onConfigError);
  },[]);

  useEffect(()=>{
    const syncAuth=()=>setAuthUser(window._authUser);
    if(window._authUser!==undefined){
      syncAuth();
    }
    window.addEventListener('auth-state-changed', syncAuth);
    return ()=>window.removeEventListener('auth-state-changed', syncAuth);
  },[]);

  useEffect(()=>{
    if(!authUser)return;
    const resolveRole=async()=>{
      try{
        let tokenResult=await window._auth.getIdTokenResult();
        if(!tokenResult)return; // not signed in yet
        let role=tokenResult.claims.role;
        if(!role){
          const idToken=await window._auth.getIdToken();
          const resp=await fetch('/api/bootstrap-admin',{method:'POST',headers:{'Authorization':`Bearer ${idToken}`}});
          if(resp.ok){
            tokenResult=await window._auth.getIdTokenResult(true); // force refresh
            role=tokenResult?.claims?.role;
          }
        }
        setUserRole(role||'viewer');
        if((role||'viewer')==='viewer') setView('portfolio');
      }catch(e){
        console.error('Role resolution failed',e);
        setUserRole('viewer');
      }
    };
    resolveRole();
  },[authUser]);

  useEffect(()=>{
    if(!authUser||!userRole)return; // only once signed in and role has resolved
    // A role change made via /api/set-role revokes the user's refresh
    // tokens server-side, but their already-issued ID token stays valid
    // client-side for up to an hour unless something forces a refresh.
    // Periodically force one so a role change (or a revoked session) takes
    // effect promptly rather than silently continuing under stale permissions.
    const checkRole=async()=>{
      try{
        const tokenResult=await window._auth.getIdTokenResult(true);
        if(!tokenResult)return; // already signed out
        const freshRole=tokenResult.claims.role||'viewer';
        if(freshRole!==userRole){
          notify("Your account access has changed — please sign in again.","error");
          await window._auth.signOut();
        }
      }catch(e){
        notify("Your session is no longer valid — please sign in again.","error");
        await window._auth.signOut().catch(()=>{});
      }
    };
    const interval=setInterval(checkRole,45000);
    const onFocus=()=>checkRole();
    window.addEventListener('focus',onFocus);
    return ()=>{clearInterval(interval);window.removeEventListener('focus',onFocus);};
  },[authUser,userRole]);

  useEffect(()=>{
    if(!authUser)return; // wait until signed in before touching Firestore
    const doLoad=()=>{
      loadAssets();
      bootstrapKnowledgeBaseGlobals().catch(e=>console.warn('Knowledge Base bootstrap failed — falling back to code defaults:', e));
    };
    if(window._firebaseReady){
      doLoad();
    } else {
      window.addEventListener('firebase-ready', doLoad, {once:true});
    }
  },[loadAssets,authUser]);

  const saveAsset=useCallback(async(asset, action="Updated asset data")=>{
    await db.saveAsset(asset);
    await logAudit(asset.id, asset.msn, action);
    await loadAssets();
  },[loadAssets]);

  const navigate = useCallback((v) => {
    setView(v);
    setSelectedId(null);
  }, []);

  const notify=(msg,type="success")=>{setNotification({msg,type});setTimeout(()=>setNotification(null),3500);};

  // Four-role nav visibility (VECTORIQ_ROADMAP.md §7a)
  const canSeeAdvanced=!!userRole&&userRole!=='dataEntry';
  const canUpload=!!userRole&&userRole!=='viewer';
  const selectedAsset=assets.find(a=>a.id===selectedId);
  const liveAssets=assets.filter(a=>a.type!=="prospect");
  const prospectAssets=assets.filter(a=>a.type==="prospect");
  const isPortfolio = view === "portfolio";

  if(configError)return(
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh"}}>
      <div style={{textAlign:"center",maxWidth:400,padding:32}}>
        <div style={{color:"#f87171",fontSize:14,fontWeight:700,marginBottom:8}}>Configuration Error</div>
        <p style={{color:"#64748b",fontSize:13}}>Couldn't load app configuration from /api/config. Check that Firebase and Cloudinary environment variables are set in Vercel, then reload.</p>
      </div>
    </div>
  );

  if(authUser===undefined)return(
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh"}}>
      <div style={{width:32,height:32,border:"3px solid #C9A84C",borderTop:"3px solid transparent",borderRadius:"50%",animation:"spin 1s linear infinite"}}/>
    </div>
  );

  if(authUser===null)return <SignInScreen/>;

  if(loading)return(
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh"}}>
      <div style={{textAlign:"center"}}>
        <div style={{width:32,height:32,border:"3px solid #C9A84C",borderTop:"3px solid transparent",borderRadius:"50%",animation:"spin 1s linear infinite",margin:"0 auto 12px"}}/>
        <p style={{color:"#64748b",fontSize:13}}>Loading fleet data…</p>
      </div>
    </div>
  );

  if(error)return(
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh"}}>
      <div style={{textAlign:"center",maxWidth:400,padding:32}}>
        <div style={{color:"#f87171",fontSize:14,fontWeight:700,marginBottom:8}}>Connection Error</div>
        <p style={{color:"#64748b",fontSize:12,marginBottom:16}}>{error}</p>
        <button onClick={loadAssets} style={{padding:"8px 20px",background:"#1e3a5f",border:"none",borderRadius:6,color:"#60a5fa",cursor:"pointer",fontFamily:"inherit",fontWeight:600}}>Retry</button>
      </div>
    </div>
  );

  return(
    <div>
      <header style={{background:"#FCFCF9",borderBottom:"1.5px solid #151A1D",position:"sticky",top:0,zIndex:100,boxShadow:"none",fontFamily:"'Barlow',system-ui,-apple-system,sans-serif"}}>
        <div className="app-header-row" style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"nowrap",maxWidth:1480,margin:"0 auto",padding:"8px 22px",boxSizing:"border-box"}}>
          {/* Logo is now the home/fleet-portfolio control — replaces the old
              separate "✈ Fleet Portfolio" button (design system §home nav).
              Always the navy mark now the header background is always light. */}
          <img src={HEADER_LOGO_NAVY} alt="TailiQ"
            onClick={()=>{if(canSeeAdvanced){setView("portfolio");setSelectedId(null);}else{setView("dashboard");setSelectedId(null);}}}
            style={{height:44,maxWidth:"55vw",objectFit:"contain",objectPosition:"left center",borderRadius:0,cursor:"pointer"}}
            className="header-logo"/>

          {/* Right side — two-row column (desktop) / single row (portrait).
              Both fleet and asset pills render here — same DOM context = guaranteed
              pixel-perfect alignment. Asset pills replace fleet pills when in asset view. */}
          <div className="app-header-right" style={{display:"flex",flexDirection:"column",gap:5,alignItems:"stretch",flexShrink:0}}>

            {isMobile && view==="asset" && selectedAsset ? (
              /* Portrait + asset view — Portfolio+☰ row, then asset layer pill below */
              <>
                <div style={{display:"flex",alignItems:"center",justifyContent:"flex-end",gap:6}}>
                  <HamburgerMenu view={view} onSelect={navigate} isMobile={isMobile} canSeeAdvanced={canSeeAdvanced} canUpload={canUpload} isAdmin={userRole==='admin'} isPortfolio={false}/>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  {(()=>{
                    const canSeeAdv=!!userRole&&userRole!=='dataEntry';
                    const LAYERS=[["details","Details"],...(canSeeAdv?[["calendar","Calendar"],["financials","Financials"],["scenarios","Scenarios"]]:[])];
                    return <NavPill items={LAYERS} activeValue={assetLayer} onSelect={setAssetLayer} theme="light"/>;
                  })()}
                </div>
                {canUpload&&(
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <NavPill items={[["upload","Upload"]]} activeValue={view} onSelect={v=>{setView(v);setSelectedId(null);}} theme="light" width="100%"/>
                  </div>
                )}
              </>
            ) : isMobile ? (
              /* Portrait + fleet view — ☰ only (logo is now Home/Portfolio),
                 fleet nav lives in hamburger. Upload gets its own anchored
                 row below — non-negotiable per design system, it used to be
                 buried inside the hamburger's Tools group here and that was
                 a miss against the locked spec. */
              <>
                <div style={{display:"flex",alignItems:"center",justifyContent:"flex-end",gap:6}}>
                  <HamburgerMenu view={view} onSelect={navigate} isMobile={isMobile} canSeeAdvanced={canSeeAdvanced} canUpload={canUpload} isAdmin={userRole==='admin'} isPortfolio={isPortfolio}/>
                </div>
                {canUpload&&(
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <NavPill items={[["upload","Upload"]]} activeValue={view} onSelect={v=>{setView(v);setSelectedId(null);}} theme="light" width="100%"/>
                  </div>
                )}
              </>
            ) : view==="asset" && selectedAsset ? (
              /* Asset view — row 1: Fleet Portfolio + ☰ (same as fleet view)
                 row 2: asset layer pill + Share/TechSpec trailing block */
              <>
                <div style={{display:"flex",alignItems:"center",justifyContent:"flex-end",gap:6}}>
                  <HamburgerMenu view={view} onSelect={navigate} isMobile={isMobile} canSeeAdvanced={canSeeAdvanced} canUpload={canUpload} isAdmin={userRole==='admin'} isPortfolio={false}/>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"nowrap"}}>
                  {(()=>{
                    const canSeeAdv=!!userRole&&userRole!=='dataEntry';
                    const LAYERS=[["details","Details"],...(canSeeAdv?[["calendar","Calendar"],["financials","Financials"],["scenarios","Scenarios"]]:[])];
                    return <NavPill items={LAYERS} activeValue={assetLayer} onSelect={setAssetLayer} theme="light"/>;
                  })()}
                  {canUpload&&<NavPill
                    items={[["upload","Upload"]]}
                    activeValue={view}
                    onSelect={v=>{setView(v);setSelectedId(null);}}
                    theme="light"
                    width={TRAILING_PILL_WIDTH}/>}
                </div>
              </>
            ) : (
              /* Fleet view — row 1: Portfolio+☰, row 2: fleet NavPill + Upload */
              <>
                <div style={{display:"flex",alignItems:"center",justifyContent:"flex-end",gap:6}}>
                  <HamburgerMenu view={view} onSelect={navigate} isMobile={isMobile} canSeeAdvanced={canSeeAdvanced} canUpload={canUpload} isAdmin={userRole==='admin'} isPortfolio={isPortfolio}/>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"nowrap"}}>
                  <NavPill
                    items={[["dashboard","Details"],...(canSeeAdvanced?[["fleetcalendar","Calendar"],["fleetexposure","Financials"],["fleetscenarios","Scenarios"]]:[])]}
                    activeValue={view}
                    onSelect={v=>{setView(v);setSelectedId(null);}}
                    theme="light"/>
                  {canUpload&&<NavPill
                    items={[["upload","Upload"]]}
                    activeValue={view}
                    onSelect={v=>{setView(v);setSelectedId(null);}}
                    theme="light"
                    width={TRAILING_PILL_WIDTH}/>}
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {notification&&(
        <div style={{position:"fixed",bottom:24,right:18,zIndex:300,padding:"10px 16px",borderRadius:8,
          background:notification.type==="error"?"#2a0e0e":"#0d2818",
          border:`1px solid ${notification.type==="error"?"#7f1d1d":"#166534"}`,
          color:notification.type==="error"?"#f87171":"#34d399",
          fontWeight:600,fontSize:13,animation:"fadeIn 0.2s ease",boxShadow:"0 4px 16px rgba(0,0,0,0.4)"}}>
          {notification.msg}
        </div>
      )}

      <main style={{padding:"20px 22px",maxWidth: layoutMode==="landscape" ? 1900 : 1480,margin:"0 auto"}}>
        {view==="dashboard"&&!selectedId&&<Dashboard assets={liveAssets} onSelect={id=>{setSelectedId(id);setAssetLayer("details");setView("asset");}} saveAsset={saveAsset} notify={notify}/>}
        {view==="asset"&&selectedId&&selectedAsset&&<AssetView asset={selectedAsset} saveAsset={saveAsset} isAdmin={userRole==='admin'||userRole==='editor'} userRole={userRole} notify={notify} onBack={()=>{setView("dashboard");setSelectedId(null);}} loadAssets={loadAssets} initialLayer={assetInitialLayer} layer={assetLayer} setLayer={setAssetLayer} shareOpen={assetShareOpen} setShareOpen={setAssetShareOpen} genSpecRef={genSpecRef}/>}
        {view==="upload"&&canUpload&&<UploadView assets={liveAssets} saveAsset={saveAsset} notify={notify}/>}
        {view==="guide"&&<GuideView/>}
        {view==="iq"&&userRole==='admin'&&<IQView assets={liveAssets}/>}
        {view==="portfolio"&&canSeeAdvanced&&<PortfolioView assets={liveAssets} notify={notify} onSelect={(id)=>{setSelectedId(id);setAssetLayer("details");setView("asset");}} onFlyForward={(id)=>{setSelectedId(id);setAssetLayer("financials");setView("asset");}}/>}
        {view==="fleetexposure"&&canSeeAdvanced&&<FleetExposureView assets={liveAssets} onSelectAsset={(id)=>{setSelectedId(id);setAssetLayer("financials");setView("asset");}}/>}
        {view==="fleetcalendar"&&canSeeAdvanced&&<FleetCalendarView assets={liveAssets} onSelectAsset={(id)=>{setSelectedId(id);setAssetLayer("financials");setView("asset");}}/>}
        {view==="fleetscenarios"&&canSeeAdvanced&&(
          <>
            <div style={layoutMode==="landscape" ? {display:"grid",gridTemplateColumns:"1fr 1fr",columnGap:16,alignItems:"stretch"} : undefined}>
              <RouteMatcherView assets={liveAssets} onSelectAsset={(id)=>{setSelectedId(id);setAssetLayer("financials");setView("asset");}}/>
              <PandemicScenarioView assets={liveAssets}/>
            </div>
            <FleetScenarioControls assets={liveAssets}/>
          </>
        )}
        {view==="prospects"&&<ProspectListView assets={prospectAssets} saveAsset={saveAsset} notify={notify} userRole={userRole} onSelect={id=>{setSelectedId(id);setView("prospect-editor");}} loadAssets={loadAssets}/>}
        {view==="prospect-editor"&&selectedId&&assets.find(a=>a.id===selectedId)&&<ProspectEditor asset={assets.find(a=>a.id===selectedId)} saveAsset={saveAsset} notify={notify} onBack={()=>{setView("prospects");setSelectedId(null);}}/>}
        {view==="settings"&&<AdminView assets={liveAssets} saveAsset={saveAsset} notify={notify} loadAssets={loadAssets} userRole={userRole}/>}
      </main>
    </div>
  );
};


function App(){
  return <LayoutModeProvider><AppInner/></LayoutModeProvider>;
};

export { App };
