import React, { useState, useEffect, useCallback, useRef } from 'react';

function SetPasswordScreen(){
  const[oobCode]=useState(()=>new URLSearchParams(window.location.search).get("oobCode")||"");
  const[email,setEmail]=useState(null);
  const[checking,setChecking]=useState(true);
  const[password,setPassword]=useState("");
  const[confirm,setConfirm]=useState("");
  const[err,setErr]=useState("");
  const[busy,setBusy]=useState(false);
  const[done,setDone]=useState(false);

  useEffect(()=>{
    if(!oobCode){setErr("This link is missing its code — please use the link from your invite email.");setChecking(false);return;}
    const run=()=>{
      if(window._configError){setErr("Could not connect to TailiQ. Please try again shortly.");setChecking(false);return;}
      window._auth.verifyResetCode(oobCode)
        .then(addr=>{setEmail(addr);setChecking(false);})
        .catch(()=>{setErr("This link is invalid or has expired. Ask your administrator to send a new invite.");setChecking(false);});
    };
    if(window._firebaseReady){
      run();
    } else {
      window.addEventListener('firebase-ready', run, {once:true});
      window.addEventListener('firebase-config-error', ()=>{setErr("Could not connect to TailiQ. Please try again shortly.");setChecking(false);}, {once:true});
    }
  },[oobCode]);

  const submit=async(e)=>{
    e.preventDefault();
    setErr("");
    if(password.length<8){setErr("Password must be at least 8 characters.");return;}
    if(password!==confirm){setErr("Passwords do not match.");return;}
    setBusy(true);
    try{
      await window._auth.confirmReset(oobCode,password);
      setDone(true);
    }catch(e){
      setErr("Could not set your password — the link may have expired. Ask your administrator to send a new invite.");
    }
    setBusy(false);
  };

  return(
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh"}}>
      <div style={{width:340,padding:24,background:"#111f30",border:"1px solid #1e3048",borderRadius:10}}>
        <div style={{fontSize:13,fontWeight:700,color:"#C9A84C",marginBottom:16,textTransform:"uppercase",letterSpacing:"0.06em"}}>TailiQ — Set Your Password</div>
        {checking&&<div style={{color:"#64748b",fontSize:13}}>Checking your invite link…</div>}
        {!checking&&done&&(
          <div>
            <div style={{color:"#34d399",fontSize:13,marginBottom:14}}>Password set! You can now sign in.</div>
            <button className="btn btn-gold" style={{width:"100%"}} onClick={()=>{window.location.href="/";}}>Go to Sign In</button>
          </div>
        )}
        {!checking&&!done&&email&&(
          <form onSubmit={submit}>
            <div style={{color:"#7a9ab5",fontSize:12,marginBottom:14}}>Setting a password for <strong style={{color:"#e2e8f0"}}>{email}</strong></div>
            <div className="form-group">
              <label className="form-label">New Password</label>
              <input type="password" value={password} onChange={e=>setPassword(e.target.value)} autoFocus/>
            </div>
            <div className="form-group">
              <label className="form-label">Confirm Password</label>
              <input type="password" value={confirm} onChange={e=>setConfirm(e.target.value)}/>
            </div>
            {err&&<div style={{color:"#f87171",fontSize:12,marginBottom:12}}>{err}</div>}
            <button className="btn btn-gold" type="submit" disabled={busy} style={{width:"100%"}}>{busy?"Setting…":"Set Password"}</button>
          </form>
        )}
        {!checking&&!done&&!email&&err&&<div style={{color:"#f87171",fontSize:13}}>{err}</div>}
      </div>
    </div>
  );
};

function SignInScreen(){
  const[email,setEmail]=useState("");
  const[password,setPassword]=useState("");
  const[err,setErr]=useState("");
  const[busy,setBusy]=useState(false);
  const submit=async(e)=>{
    e.preventDefault();
    setErr("");setBusy(true);
    try{
      await window._auth.signIn(email,password);
    }catch(e){
      setErr("Sign-in failed — check email and password.");
    }
    setBusy(false);
  };
  return(
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh"}}>
      <form onSubmit={submit} style={{width:300,padding:24,background:"#111f30",border:"1px solid #1e3048",borderRadius:10}}>
        <div style={{fontSize:13,fontWeight:700,color:"#C9A84C",marginBottom:16,textTransform:"uppercase",letterSpacing:"0.06em"}}>TailiQ — Sign In</div>
        <div className="form-group">
          <label className="form-label">Email</label>
          <input type="email" value={email} onChange={e=>setEmail(e.target.value)} autoFocus/>
        </div>
        <div className="form-group">
          <label className="form-label">Password</label>
          <input type="password" value={password} onChange={e=>setPassword(e.target.value)}/>
        </div>
        {err&&<div style={{color:"#f87171",fontSize:12,marginBottom:12}}>{err}</div>}
        <button className="btn btn-gold" type="submit" disabled={busy} style={{width:"100%"}}>{busy?"Signing in…":"Sign In"}</button>
      </form>
    </div>
  );
};


export { SetPasswordScreen, SignInScreen };
