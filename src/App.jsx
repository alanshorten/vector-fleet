import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AdminView } from './components/AdminView';
import { AssetView, NavPill } from './components/AssetView';
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

  // Colour tokens — TAILIQ_UI_DESIGN_SYSTEM.md palette. The dropdown itself
  // is now a light paper panel (was a dark carbon surface) so it doesn't
  // read as a leftover from the old dark theme against the light header.
  const menuBg = 'var(--color-soft-white)';
  const menuBorder = 'var(--color-divider)';
  const itemHover = 'var(--color-carbon-tint-05)';
  const textActive = 'var(--color-ochre)';
  const textMuted = 'var(--color-graphite)';
  const divider = 'var(--color-divider-inner)';

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
    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(21,26,29,0.4)', padding: '8px 16px 4px', fontFamily: "'Barlow',inherit" }}>
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
  const pillBorder = 'var(--color-divider)';
  const iconColor = 'var(--color-graphite)';
  const iconColorActive = 'var(--color-carbon)';

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
            background: open ? 'rgba(21,26,29,0.06)' : 'transparent',
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
          boxShadow: '0 8px 24px rgba(21,26,29,0.14)',
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

          {/* Group 2 — Tools. Upload lives here on mobile/portrait (both
              fleet and asset views, confirmed by Alan) — it's only anchored
              as its own header row on desktop. */}
          <GroupLabel>Tools</GroupLabel>
          <Item value="prospects" label="Prospects"/>
          {isMobile && canUpload && <Item value="upload" label="Upload"/>}
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

  // P1 — scroll reset on route navigation. Previously scroll position
  // carried over from whatever the previous view/tab left it at (e.g.
  // landing mid-page inside an asset after scrolling down the fleet
  // table). Reset to top on any top-level view change, asset selection,
  // or asset-level tab (Details/Calendar/Financials/Scenarios) change.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [view, selectedId, assetLayer]);

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
        let tenantId=tokenResult.claims.tenantId;
        // Build Group A (19 Aug 2026): every account now has role+tenantId
        // stamped at creation time — invite-user.js for an existing tenant's
        // users, create-tenant.js for a new tenant's first admin — so
        // there's no longer a legitimate "missing claims" case that needs
        // self-healing via a bootstrap endpoint. api/bootstrap-admin.js
        // (which used to be called here) is deleted; its old job — closing
        // the "first user wins" self-registration race — is superseded by
        // create-tenant.js plus disabling Firebase self-registration
        // entirely. If either claim is still missing here, force one token
        // refresh in case this is just a stale cached token from right
        // before claims were set (e.g. immediately after being invited),
        // rather than attempting to provision anything client-side.
        if(!role||!tenantId){
          tokenResult=await window._auth.getIdTokenResult(true);
          role=tokenResult?.claims?.role;
          tenantId=tokenResult?.claims?.tenantId;
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
      <header style={{background:"var(--color-soft-white)",borderBottom:"1.5px solid var(--color-carbon)",position:"sticky",top:0,zIndex:100,boxShadow:"none",fontFamily:"var(--font-interface)"}}>
        <div className="app-header-row" style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"nowrap",maxWidth:1480,margin:"0 auto",padding:"8px 22px",boxSizing:"border-box"}}>
          {/* Logo is now the home/fleet-portfolio control — replaces the old
              separate "✈ Fleet Portfolio" button (design system §home nav).
              Always the navy mark now the header background is always light. */}
          <img src={HEADER_LOGO_NAVY} alt="TailiQ"
            onClick={()=>{if(canSeeAdvanced){setView("portfolio");setSelectedId(null);}else{setView("dashboard");setSelectedId(null);}}}
            style={{height:44,maxWidth:"55vw",objectFit:"contain",objectPosition:"left center",borderRadius:0,cursor:"pointer"}}
            className="header-logo"/>

          {/* Right side — single row (desktop): tabs + Upload + ☰ inline.
              Portrait stays two-row (☰ row, then tabs below) since there
              isn't width for everything on one line at that size.
              Both fleet and asset pills render here — same DOM context =
              guaranteed pixel-perfect alignment. Asset pills replace fleet
              pills when in asset view. */}
          <div className="app-header-right" style={{display:"flex",flexDirection:"column",gap:5,alignItems:"stretch",flexShrink:0}}>

            {isMobile && view==="asset" && selectedAsset ? (
              /* Portrait + asset view — ☰ row, then asset layer pill below.
                 Upload stays inside the hamburger's Tools group on mobile —
                 not anchored as its own row here (matches the mobile/fleet
                 branch below; confirmed by Alan). */
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
              </>
            ) : isMobile ? (
              /* Portrait + fleet view — ☰ only (logo is now Home/Portfolio).
                 Upload stays inside the hamburger's Tools group on mobile —
                 confirmed by Alan, not anchored as its own row here. */
              <div style={{display:"flex",alignItems:"center",justifyContent:"flex-end",gap:6}}>
                <HamburgerMenu view={view} onSelect={navigate} isMobile={isMobile} canSeeAdvanced={canSeeAdvanced} canUpload={canUpload} isAdmin={userRole==='admin'} isPortfolio={isPortfolio}/>
              </div>
            ) : view==="asset" && selectedAsset ? (
              /* Asset view (desktop) — single row: asset layer tabs +
                 Upload + ☰, all inline, matching the mockup. */
              <div style={{display:"flex",alignItems:"center",justifyContent:"flex-end",gap:20,flexWrap:"nowrap"}}>
                {(()=>{
                  const canSeeAdv=!!userRole&&userRole!=='dataEntry';
                  const LAYERS=[["details","Details"],...(canSeeAdv?[["calendar","Calendar"],["financials","Financials"],["scenarios","Scenarios"]]:[])];
                  return <NavPill items={LAYERS} activeValue={assetLayer} onSelect={setAssetLayer} theme="light"/>;
                })()}
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  {canUpload&&<button onClick={()=>{setView("upload");setSelectedId(null);}}
                    style={{padding:"8px 16px",borderRadius:"var(--radius-button)",border:view==="upload"?"1px solid var(--color-teal)":"1px solid var(--color-divider)",background:view==="upload"?"var(--color-teal)":"transparent",color:view==="upload"?"var(--color-soft-white)":"var(--color-carbon)",fontFamily:"var(--font-interface)",fontSize:13,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap",transition:"all 0.15s"}}>
                    Upload
                  </button>}
                  <HamburgerMenu view={view} onSelect={navigate} isMobile={isMobile} canSeeAdvanced={canSeeAdvanced} canUpload={canUpload} isAdmin={userRole==='admin'} isPortfolio={false}/>
                </div>
              </div>
            ) : (
              /* Fleet view (desktop) — single row: fleet tabs + Upload + ☰,
                 all inline, matching the mockup. */
              <div style={{display:"flex",alignItems:"center",justifyContent:"flex-end",gap:20,flexWrap:"nowrap"}}>
                <NavPill
                  items={[["dashboard","Details"],...(canSeeAdvanced?[["fleetcalendar","Calendar"],["fleetexposure","Financials"],["fleetscenarios","Scenarios"]]:[])]}
                  activeValue={view}
                  onSelect={v=>{setView(v);setSelectedId(null);}}
                  theme="light"/>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  {canUpload&&<button onClick={()=>{setView("upload");setSelectedId(null);}}
                    style={{padding:"8px 16px",borderRadius:"var(--radius-button)",border:view==="upload"?"1px solid var(--color-teal)":"1px solid var(--color-divider)",background:view==="upload"?"var(--color-teal)":"transparent",color:view==="upload"?"var(--color-soft-white)":"var(--color-carbon)",fontFamily:"var(--font-interface)",fontSize:13,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap",transition:"all 0.15s"}}>
                    Upload
                  </button>}
                  <HamburgerMenu view={view} onSelect={navigate} isMobile={isMobile} canSeeAdvanced={canSeeAdvanced} canUpload={canUpload} isAdmin={userRole==='admin'} isPortfolio={isPortfolio}/>
                </div>
              </div>
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
            <RouteMatcherView assets={liveAssets} onSelectAsset={(id)=>{setSelectedId(id);setAssetLayer("financials");setView("asset");}}/>
            <div className="section-title" style={{marginTop:16}}>Operational Disruption</div>
            <PandemicScenarioView assets={liveAssets}/>
            <div className="section-title" style={{marginTop:16}}>Counterparty & Utilisation</div>
            <FleetScenarioControls assets={liveAssets} group="counterparty"/>
            <div className="section-title" style={{marginTop:16}}>Maintenance & Cost</div>
            <FleetScenarioControls assets={liveAssets} group="maintenance"/>
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