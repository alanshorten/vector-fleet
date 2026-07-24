import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AdminView } from './components/AdminView';
import { AssetView, NavPill } from './components/AssetView';
import { SetPasswordScreen, SignInScreen } from './components/Auth';
import { Dashboard } from './components/Dashboard';
import { GuideView } from './components/GuideView';
import { FleetExposureView, PortfolioView } from './components/PortfolioView';
import { ProspectEditor, ProspectListView } from './components/Prospects';
import { UploadView } from './components/UploadView';
import { db, logAudit } from './lib/db';
import { HEADER_LOGO_NAVY, HEADER_LOGO_WHITE } from './lib/techSpec';

function App(){
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
  const[userRole,setUserRole]=useState(null);
  const[notification,setNotification]=useState(null);

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
    // effect promptly rather than silently continuing under stale
    // permissions until the token naturally expires.
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
        // Refresh failing here almost always means the refresh token was
        // revoked (role changed, or an admin forced this) — treat it the
        // same way: sign out rather than continuing on a stale token.
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
    const doLoad=()=>loadAssets();
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

  const notify=(msg,type="success")=>{setNotification({msg,type});setTimeout(()=>setNotification(null),3500);};
  // Four-role nav visibility (VECTORIQ_ROADMAP.md §7a): Data Entry doesn't see
  // Calendar/Financials/Scenarios/Portfolio (raw inputs only, no financial
  // outputs); Viewer doesn't see Upload (read-only, no data entry).
  const canSeeAdvanced=!!userRole&&userRole!=='dataEntry';
  const canUpload=!!userRole&&userRole!=='viewer';
  const selectedAsset=assets.find(a=>a.id===selectedId);
  // Prospect assets (type:"prospect") are ad hoc/deal-evaluation aircraft — kept
  // completely separate from the live fleet in Dashboard/Fleet Portfolio/Admin.
  const liveAssets=assets.filter(a=>a.type!=="prospect");
  const prospectAssets=assets.filter(a=>a.type==="prospect");

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
      <header style={{background:view==="portfolio"?"#ffffff":"#0d1c2c",borderBottom:view==="portfolio"?"1px solid #e2e8f0":"1px solid #1e3348",position:"sticky",top:0,zIndex:100,boxShadow:view==="portfolio"?"0 2px 8px rgba(15,23,42,0.08)":"0 2px 8px rgba(0,0,0,0.3)"}}>
        <div className="app-header-row" style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"nowrap",maxWidth:1480,margin:"0 auto",padding:"8px 22px",boxSizing:"border-box"}}>
          <img src={view==="portfolio"?HEADER_LOGO_WHITE:HEADER_LOGO_NAVY} alt="TailiQ" style={{height:44,maxWidth:"55vw",objectFit:"contain",objectPosition:"left center",borderRadius:0}} className="header-logo"/>
          {/* Right side: Fleet button above nav pill */}
          <div className="app-header-right" style={{display:"flex",flexDirection:"column",gap:5,alignItems:"stretch"}}>
            {/* Fleet button - full width, colour coded to white theme. Not shown to Data Entry — presentation surface, not a raw-input tool. */}
            {canSeeAdvanced&&<button onClick={()=>{setView("portfolio");setSelectedId(null);}}
              className="app-fleet-btn"
              style={{padding:"7px 20px",background:view==="portfolio"?"#f1f5f9":"transparent",border:`1px solid ${view==="portfolio"?"#e2e8f0":"#2a4060"}`,borderRadius:7,fontFamily:"inherit",fontSize:12,fontWeight:700,cursor:"pointer",color:view==="portfolio"?"#0f172a":"#6a8aaa",letterSpacing:"0.06em",textTransform:"uppercase",transition:"all 0.15s",textAlign:"center"}}>
              ✈ Fleet Portfolio
            </button>}
            {/* Two pills: the four-layer group (Details always; Calendar/Financials/
                Scenarios gated on canSeeAdvanced), and workflow tools (Prospects
                always; Upload gated on canUpload; Admin for admins; Sign Out last).
                Matches VECTORIQ_ROADMAP.md §7a. Sign Out folded into this pill
                rather than standalone — a separate button was getting squeezed
                off-screen on mobile. Uses the same NavPill component as the
                asset-level layer pill, so the two are visually identical. */}
            <div className="flab g8 app-nav-tools-row" style={{flexWrap:"nowrap",whiteSpace:"nowrap",justifyContent:"flex-end"}}>
              <NavPill
                items={[["dashboard","Details"],...(canSeeAdvanced?[["fleetcalendar","Calendar"],["fleetexposure","Financials"],["fleetscenarios","Scenarios"]]:[])]}
                activeValue={view}
                onSelect={v=>{setView(v);setSelectedId(null);}}
                theme={view==="portfolio"?"light":"dark"}/>
              <NavPill
                items={[["prospects","Prospects"],...(canUpload?[["upload","Upload"]]:[]),...(userRole==='admin'?[["admin","Admin"]]:[]),["signout","⎋ Sign Out"]]}
                activeValue={view}
                onSelect={v=>v==='signout'?window._auth.signOut():(setView(v),setSelectedId(null))}
                theme={view==="portfolio"?"light":"dark"}/>
            </div>
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

      <main style={{padding:"20px 22px",maxWidth:1480,margin:"0 auto"}}>
        {view==="dashboard"&&!selectedId&&<Dashboard assets={liveAssets} onSelect={id=>{setSelectedId(id);setAssetInitialLayer("details");setView("asset");}} saveAsset={saveAsset} notify={notify}/>}
        {view==="asset"&&selectedId&&selectedAsset&&<AssetView asset={selectedAsset} saveAsset={saveAsset} isAdmin={userRole==='admin'||userRole==='editor'} userRole={userRole} notify={notify} onBack={()=>{setView("dashboard");setSelectedId(null);}} loadAssets={loadAssets} initialLayer={assetInitialLayer}/>}
        {view==="upload"&&canUpload&&<UploadView assets={liveAssets} saveAsset={saveAsset} notify={notify}/>}
        {view==="guide"&&<GuideView/>}
        {view==="portfolio"&&canSeeAdvanced&&<PortfolioView assets={liveAssets} notify={notify} onSelect={(id)=>{setSelectedId(id);setAssetInitialLayer("details");setView("asset");}} onFlyForward={(id)=>{setSelectedId(id);setAssetInitialLayer("financials");setView("asset");}}/>}
        {view==="fleetexposure"&&canSeeAdvanced&&<FleetExposureView assets={liveAssets} onSelectAsset={(id)=>{setSelectedId(id);setAssetInitialLayer("financials");setView("asset");}}/>}
        {view==="fleetcalendar"&&canSeeAdvanced&&(
          <div className="card" style={{padding:24,textAlign:"center",maxWidth:600,margin:"40px auto"}}>
            <div style={{fontSize:14,fontWeight:700,color:"#e2e8f0",marginBottom:8}}>Calendar</div>
            <div style={{fontSize:12,color:"#94a3b8"}}>Coming soon — event clustering across the fleet's maintenance calendar.</div>
          </div>
        )}
        {view==="fleetscenarios"&&canSeeAdvanced&&(
          <div className="card" style={{padding:24,textAlign:"center",maxWidth:600,margin:"40px auto"}}>
            <div style={{fontSize:14,fontWeight:700,color:"#e2e8f0",marginBottom:8}}>Scenarios</div>
            <div style={{fontSize:12,color:"#94a3b8"}}>Coming soon — Route Suitability Matcher and fleet-wide "what if" exploration.</div>
          </div>
        )}
        {view==="prospects"&&<ProspectListView assets={prospectAssets} saveAsset={saveAsset} notify={notify} userRole={userRole} onSelect={id=>{setSelectedId(id);setView("prospect-editor");}} loadAssets={loadAssets}/>}
        {view==="prospect-editor"&&selectedId&&assets.find(a=>a.id===selectedId)&&<ProspectEditor asset={assets.find(a=>a.id===selectedId)} saveAsset={saveAsset} notify={notify} onBack={()=>{setView("prospects");setSelectedId(null);}}/>}
        {view==="admin"&&userRole==='admin'&&<AdminView assets={liveAssets} saveAsset={saveAsset} notify={notify} loadAssets={loadAssets}/>}
        {view==="admin"&&userRole!=='admin'&&<div style={{padding:60,textAlign:"center",color:"#475569"}}>Admin access required.</div>}
      </main>
    </div>
  );
};


export { App };
