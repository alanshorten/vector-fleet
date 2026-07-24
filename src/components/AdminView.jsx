import React, { useState, useEffect, useCallback, useRef } from 'react';
import { GuideView } from './GuideView';
import { makeBlankAsset } from '../lib/assetHelpers';
import { db, logAudit } from '../lib/db';
import { uploadToCloudinary } from '../lib/uploadHelpers';

function LogoSettings({notify}) {
  const [logoUrl, setLogoUrl] = useState(null);
  const [width, setWidth] = useState(200);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    db.getSetting('tech_spec_logo_url').then(v => { if(v) setLogoUrl(v); });
    db.getSetting('tech_spec_logo_width').then(v => { if(v) setWidth(v); });
  }, []);

  const handleUpload = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadToCloudinary(file);
      await db.setSetting('tech_spec_logo_url', url);
      setLogoUrl(url);
      notify('Logo updated');
    } catch(err) {
      notify('Upload failed: ' + err.message, 'error');
    }
    setUploading(false);
  };

  const commitWidth = async (w) => {
    setWidth(w);
    setSaving(true);
    try {
      await db.setSetting('tech_spec_logo_width', w);
    } catch(err) {
      notify('Failed to save size: ' + err.message, 'error');
    }
    setSaving(false);
  };

  const resetToDefault = async () => {
    setUploading(true);
    try {
      await db.setSetting('tech_spec_logo_url', null);
      setLogoUrl(null);
      notify('Reverted to default Maverick Horizon logo');
    } catch(err) {
      notify('Failed: ' + err.message, 'error');
    }
    setUploading(false);
  };

  return (
    <div>
      <div style={{background:'#0d1925',borderRadius:8,border:'1px solid #1e3348',padding:'24px 16px',display:'flex',justifyContent:'center',marginBottom:14}}>
        <img src={logoUrl||TECH_SPEC_LOGO} alt="Tech spec logo preview" style={{width:width,maxWidth:'100%',borderRadius:0}}/>
      </div>
      <div style={{marginBottom:14}}>
        <label className="form-label" style={{display:'flex',justifyContent:'space-between'}}>
          <span>Logo size</span>
          <span style={{color:'#C9A84C',fontFamily:'monospace'}}>{width}px{saving?' · saving…':''}</span>
        </label>
        <input type="range" min={80} max={320} step={10} value={width} onChange={e=>setWidth(+e.target.value)} onMouseUp={e=>commitWidth(+e.target.value)} onTouchEnd={e=>commitWidth(+e.target.value)} style={{width:'100%'}}/>
        <div style={{display:'flex',justifyContent:'space-between',fontSize:10,color:'#475569'}}><span>80px</span><span>320px</span></div>
      </div>
      <div className="flab g8">
        <label style={{cursor:'pointer'}}>
          <input type="file" accept="image/*" onChange={e=>handleUpload(e.target.files?.[0])} style={{display:'none'}}/>
          <span className="btn btn-primary" style={{fontSize:11,padding:'7px 14px'}}>
            {uploading ? '⏳ Uploading…' : logoUrl ? 'Replace Logo' : 'Upload Custom Logo'}
          </span>
        </label>
        {logoUrl&&<button className="btn btn-ghost" style={{fontSize:11,padding:'7px 14px'}} onClick={resetToDefault}>Revert to Default</button>}
      </div>
      <p style={{fontSize:11,color:'#475569',marginTop:10}}>Applies to both the Full Aircraft and Engine tech spec cover pages.</p>
    </div>
  );
};

function DisclaimerSettings({notify}) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const DEFAULT_TEXT = "This outline specification has been prepared based on the information available to Maverick Horizon at the relevant time. The recipient must verify the information provided independently.";

  useEffect(() => {
    db.getSetting('default_disclaimer').then(v => { if(v) setText(v); });
  }, []);

  const commit = async (val) => {
    setSaving(true);
    try {
      await db.setSetting('default_disclaimer', val||null);
      notify('Disclaimer updated');
    } catch(err) {
      notify('Failed to save disclaimer: ' + err.message, 'error');
    }
    setSaving(false);
  };

  const resetToDefault = async () => {
    setText("");
    await commit(null);
    notify('Reverted to standard disclaimer wording');
  };

  return (
    <div>
      <textarea value={text} placeholder={DEFAULT_TEXT} onChange={e=>setText(e.target.value)} onBlur={e=>commit(e.target.value)} rows={3} style={{width:'100%',fontFamily:'inherit',fontSize:13,resize:'vertical'}}/>
      <div className="flab g8" style={{marginTop:10}}>
        {saving&&<span style={{fontSize:11,color:'#475569'}}>Saving…</span>}
        {text&&<button className="btn btn-ghost" style={{fontSize:11,padding:'7px 14px'}} onClick={resetToDefault}>Revert to Default</button>}
      </div>
      <p style={{fontSize:11,color:'#475569',marginTop:10}}>Applies to every tech spec by default, unless an individual asset has its own disclaimer set on its Specs tab.</p>
    </div>
  );
};

const ENGINE_PHOTO_TYPES = [
  ['cfm56', 'CFM56-5B'],
  ['cfm567b', 'CFM56-7B'],
  ['v2500', 'V2500-A5 / IAE'],
  ['leap1a', 'LEAP-1A'],
  ['leap1b', 'LEAP-1B'],
  ['pw1100g', 'PW1100G'],
  ['cf34', 'CF34'],
  ['cf6', 'CF6'],
];

function EnginePhotoSettings({notify}) {
  const [photos, setPhotos] = useState({});
  const [uploading, setUploading] = useState(null);

  useEffect(() => {
    ENGINE_PHOTO_TYPES.forEach(([type]) => {
      db.getSetting(`engine_photo_${type}`).then(v => { if(v) setPhotos(p => ({...p, [type]: v})); });
    });
  }, []);

  const handleUpload = async (type, file) => {
    if (!file) return;
    setUploading(type);
    try {
      const url = await uploadToCloudinary(file);
      await db.setSetting(`engine_photo_${type}`, url);
      setPhotos(p => ({...p, [type]: url}));
      notify(`${type.toUpperCase()} photo updated`);
    } catch(err) {
      notify('Upload failed: ' + err.message, 'error');
    }
    setUploading(null);
  };

  return (
    <div className="grid2" style={{gap:16}}>
      {ENGINE_PHOTO_TYPES.map(([type, label]) => (
        <div key={type} style={{background:'#0d1925',borderRadius:8,overflow:'hidden',border:'1px solid #1e3348'}}>
          {photos[type]
            ? <img src={photos[type]} alt={label} style={{width:'100%',height:140,objectFit:'cover',display:'block'}}/>
            : <div style={{width:'100%',height:140,background:'#0a1620',display:'flex',alignItems:'center',justifyContent:'center',color:'#475569',fontSize:12}}>No photo</div>
          }
          <div style={{padding:'10px 12px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <span style={{fontSize:12,fontWeight:600,color:'#e2e8f0'}}>{label}</span>
            <label style={{cursor:'pointer'}}>
              <input type="file" accept="image/*" onChange={e=>handleUpload(type,e.target.files?.[0])} style={{display:'none'}}/>
              <span className="btn btn-primary" style={{fontSize:11,padding:'5px 10px'}}>
                {uploading===type ? '⏳ Uploading…' : photos[type] ? 'Replace' : 'Upload'}
              </span>
            </label>
          </div>
        </div>
      ))}
    </div>
  );
};

const AIRFRAME_PHOTO_TYPES = [
  ['a319', 'A319'],
  ['a320', 'A320'],
  ['a321', 'A321'],
  ['a330', 'A330'],
  ['b737', 'B737 (Classic/NG)'],
  ['b737max', 'B737 MAX'],
  ['b787', 'B787'],
];

function AirframePhotoSettings({notify}) {
  const [photos, setPhotos] = useState({});
  const [uploading, setUploading] = useState(null);

  useEffect(() => {
    AIRFRAME_PHOTO_TYPES.forEach(([type]) => {
      db.getSetting(`airframe_photo_${type}`).then(v => { if(v) setPhotos(p => ({...p, [type]: v})); });
    });
  }, []);

  const handleUpload = async (type, file) => {
    if (!file) return;
    setUploading(type);
    try {
      const url = await uploadToCloudinary(file);
      await db.setSetting(`airframe_photo_${type}`, url);
      setPhotos(p => ({...p, [type]: url}));
      notify(`${type.toUpperCase()} photo updated`);
    } catch(err) {
      notify('Upload failed: ' + err.message, 'error');
    }
    setUploading(null);
  };

  return (
    <div className="grid2" style={{gap:16}}>
      {AIRFRAME_PHOTO_TYPES.map(([type, label]) => (
        <div key={type} style={{background:'#0d1925',borderRadius:8,overflow:'hidden',border:'1px solid #1e3348'}}>
          {photos[type]
            ? <img src={photos[type]} alt={label} style={{width:'100%',height:140,objectFit:'cover',display:'block'}}/>
            : <div style={{width:'100%',height:140,background:'#0a1620',display:'flex',alignItems:'center',justifyContent:'center',color:'#475569',fontSize:12}}>No photo</div>
          }
          <div style={{padding:'10px 12px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <span style={{fontSize:12,fontWeight:600,color:'#e2e8f0'}}>{label}</span>
            <label style={{cursor:'pointer'}}>
              <input type="file" accept="image/*" onChange={e=>handleUpload(type,e.target.files?.[0])} style={{display:'none'}}/>
              <span className="btn btn-primary" style={{fontSize:11,padding:'5px 10px'}}>
                {uploading===type ? '⏳ Uploading…' : photos[type] ? 'Replace' : 'Upload'}
              </span>
            </label>
          </div>
        </div>
      ))}
    </div>
  );
};

function AdminView({assets,saveAsset,notify,loadAssets}){
  const[tab,setTab]=useState("assets");
  const[showNew,setShowNew]=useState(false);
  const[newA,setNewA]=useState({msn:"",registration:"",model:"A320-214",operator:"",manufacturer:"Airbus S.A.S.",dom:""});
  const createAsset=async()=>{
    if(!newA.msn){notify("MSN required","error");return;}
    const blank=makeBlankAsset(newA,"aircraft");
    await saveAsset(blank);setShowNew(false);setNewA({msn:"",registration:"",model:"A320-214",operator:"",manufacturer:"Airbus S.A.S.",dom:""});notify(`Asset MSN ${blank.msn} created`);
  };
  const deleteAsset=async(id)=>{if(!confirm(`Delete asset MSN ${id}?`))return;const msn=assets.find(a=>String(a.id)===String(id))?.msn||id;await db.deleteAsset(id);await logAudit(id,msn,"Deleted asset");await loadAssets();notify("Asset deleted");};
  return(
    <div>
      <h1 style={{fontSize:20,color:"#C9A84C",fontWeight:700,marginBottom:18}}>Admin Panel</h1>
      <div style={{display:"flex",borderBottom:"2px solid #1e3048",marginBottom:20,gap:2}}>
        {["assets","users","settings","guide"].map(t=><button key={t} className={`tab-btn${tab===t?" active":""}`} onClick={()=>setTab(t)}>{t}</button>)}
      </div>
      {tab==="assets"&&(
        <div>
          <div className="flj" style={{marginBottom:14}}>
            <span style={{color:"#475569",fontSize:13}}>{assets.length} aircraft in system</span>
            <button className="btn btn-gold" onClick={()=>setShowNew(true)}>+ New Asset</button>
          </div>
          {showNew&&(
            <div className="card" style={{padding:20,marginBottom:16}}>
              <div className="section-title">New Aircraft</div>
              <div className="grid3" style={{gap:10,marginBottom:12}}>
                {[["MSN *","msn"],["Registration","registration"],["Model","model"],["Operator","operator"],["Manufacturer","manufacturer"]].map(([l,k])=>(
                  <div key={k}><label className="form-label">{l}</label><input value={newA[k]||""} onChange={e=>setNewA({...newA,[k]:e.target.value})} className={!newA[k]&&k==="msn"?"amber":""}/></div>
                ))}
                <div><label className="form-label">Date of Manufacture</label><input type="date" value={newA.dom} onChange={e=>setNewA({...newA,dom:e.target.value})}/></div>
              </div>
              <div className="flab g8"><button className="btn btn-ghost" onClick={()=>setShowNew(false)}>Cancel</button><button className="btn btn-gold" onClick={createAsset}>Create Asset</button></div>
            </div>
          )}
          <div className="card" style={{overflow:"hidden"}}>
            <table><thead><tr><th>MSN</th><th>Registration</th><th>Model</th><th>Operator</th><th>Engine S/Ns</th><th></th></tr></thead>
            <tbody>
              {assets.length===0&&<tr><td colSpan={6} style={{textAlign:"center",padding:40,color:"#475569"}}>No assets yet.</td></tr>}
              {assets.map(a=>(
                <tr key={a.id}>
                  <td style={{fontWeight:700,color:"#C9A84C",fontFamily:"monospace"}}>{a.msn}</td>
                  <td style={{fontWeight:600}}>{a.registration||"—"}</td>
                  <td style={{color:"#94a3b8"}}>{a.model||"—"}</td>
                  <td style={{color:"#94a3b8"}}>{a.operator||"—"}</td>
                  <td style={{fontFamily:"monospace",fontSize:11,color:"#64748b"}}>{a.engines?.map(e=>e.sn||"TBD").join(" / ")||"—"}</td>
                  <td><button className="btn-danger btn" style={{fontSize:10,padding:"3px 8px"}} onClick={()=>deleteAsset(a.id)}>Delete</button></td>
                </tr>
              ))}
            </tbody></table>
          </div>
        </div>
      )}
      {tab==="users"&&(
        <div style={{display:"flex",flexDirection:"column",gap:16,maxWidth:700}}>
          <div className="card" style={{padding:20}}>
            <div className="section-title">Invite User</div>
            <p style={{fontSize:12,color:"#64748b",marginBottom:14}}>Create a new TailiQ account. They'll receive an email to set their own password.</p>
            <InviteUserCard notify={notify}/>
          </div>
          <div className="card" style={{padding:20}}>
            <div className="section-title">Manage Users</div>
            <p style={{fontSize:12,color:"#64748b",marginBottom:14}}>View all users and change their roles. Admin role can only be set via server configuration.</p>
            <UsersCard notify={notify}/>
          </div>
        </div>
      )}
      {tab==="guide"&&<div style={{maxWidth:920}}><GuideView/></div>}
      {tab==="settings"&&(
        <div style={{display:"flex",flexDirection:"column",gap:16,maxWidth:700}}>
          <div className="card" style={{padding:20}}>
            <div className="section-title">Tech Spec Logo & Disclaimer</div>
            <p style={{fontSize:12,color:"#64748b",marginBottom:14}}>Resize or replace the logo shown on the tech spec cover pages.</p>
            <LogoSettings notify={notify}/>
            <div style={{height:1,background:"#1e3348",margin:"20px 0"}}/>
            <p style={{fontSize:12,color:"#64748b",marginBottom:14}}>Set the default disclaimer text shown at the bottom of every generated tech spec.</p>
            <DisclaimerSettings notify={notify}/>
          </div>
          <div className="card" style={{padding:20}}>
            <div className="section-title">Engine Stock Photos</div>
            <p style={{fontSize:12,color:"#64748b",marginBottom:14}}>Upload default photos for each engine type. These appear on engine tech specs.</p>
            <EnginePhotoSettings notify={notify}/>
          </div>
          <div className="card" style={{padding:20}}>
            <div className="section-title">Airframe Stock Photos</div>
            <p style={{fontSize:12,color:"#64748b",marginBottom:14}}>Upload default photos for each airframe type. Used on the tech spec cover whenever an asset has no per-asset "Airframe" photo uploaded (coarse match on model, e.g. any "737 MAX..." model uses the B737 MAX photo).</p>
            <AirframePhotoSettings notify={notify}/>
          </div>
        </div>
      )}
    </div>
  );
};

function InviteUserCard({notify}){
  const[email,setEmail]=useState("");
  const[role,setRole]=useState("editor");
  const[busy,setBusy]=useState(false);
  const invite=async()=>{
    if(!email||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){notify("Enter a valid email address","error");return;}
    setBusy(true);
    try{
      const idToken=await window._auth.getIdToken();
      const resp=await fetch("/api/invite-user",{
        method:"POST",
        headers:{"Content-Type":"application/json","Authorization":`Bearer ${idToken}`},
        body:JSON.stringify({email,role})
      });
      const result=await resp.json();
      if(!resp.ok||result.error){throw new Error(result.error||"Invite failed.");}
      await logAudit(null,null,`Invited user ${email} as ${role}`);
      notify(`Invite sent to ${email} as ${role}`);
      setEmail("");setRole("editor");
    }catch(e){
      notify(e.message||"Could not send invite.","error");
    }
    setBusy(false);
  };
  return(
    <div style={{display:"flex",flexDirection:"column",gap:10}}>
      <div style={{display:"flex",gap:8}}>
        <input type="email" placeholder="name@company.com" value={email} onChange={e=>setEmail(e.target.value)} style={{flex:1}}/>
        <select value={role} onChange={e=>setRole(e.target.value)} style={{background:"#0d1c2c",color:"#e2e8f0",border:"1px solid #2d3f55",borderRadius:6,padding:"8px 12px",fontFamily:"inherit",fontSize:13,cursor:"pointer",width:120,flexShrink:0}}>
          <option value="editor">Editor</option>
          <option value="viewer">Viewer</option>
          <option value="dataEntry">Data Entry</option>
        </select>
        <button className="btn btn-gold" onClick={invite} disabled={busy}>{busy?"Sending…":"Send Invite"}</button>
      </div>
      <p style={{fontSize:11,color:"#475569",margin:0}}>Editor — full access except user management. Viewer — sees everything including financials, edits nothing. Data Entry — uploads and lease/reserve entry only, no financial views.</p>
    </div>
  );
};

function UsersCard({notify}){
  const[users,setUsers]=useState([]);
  const[loading,setLoading]=useState(true);
  const[busy,setBusy]=useState(null);
  const load=async()=>{
    setLoading(true);
    try{
      const idToken=await window._auth.getIdToken();
      const resp=await fetch("/api/set-role",{headers:{"Authorization":`Bearer ${idToken}`}});
      const data=await resp.json();
      if(!resp.ok)throw new Error(data.error||"Failed to load users");
      setUsers(data.users||[]);
    }catch(e){notify(e.message||"Could not load users","error");}
    setLoading(false);
  };
  useEffect(()=>{load();},[]);
  const changeRole=async(uid,newRole)=>{
    setBusy(uid);
    try{
      const idToken=await window._auth.getIdToken();
      const resp=await fetch("/api/set-role",{
        method:"POST",
        headers:{"Content-Type":"application/json","Authorization":`Bearer ${idToken}`},
        body:JSON.stringify({uid,role:newRole})
      });
      const data=await resp.json();
      if(!resp.ok)throw new Error(data.error||"Failed to update role");
      notify("Role updated");
      await load();
    }catch(e){notify(e.message||"Could not update role","error");}
    setBusy(null);
  };
  const roleColour={admin:"#C9A84C",editor:"#34d399",viewer:"#94a3b8",dataEntry:"#60a5fa"};
  if(loading)return<p style={{color:"#475569",fontSize:13}}>Loading users…</p>;
  if(!users.length)return<p style={{color:"#475569",fontSize:13}}>No users found.</p>;
  return(
    <table style={{width:"100%"}}>
      <thead><tr><th style={{textAlign:"left"}}>Email</th><th style={{textAlign:"left"}}>Role</th><th></th></tr></thead>
      <tbody>
        {users.map(u=>(
          <tr key={u.uid}>
            <td style={{fontSize:13,color:"#e2e8f0",padding:"8px 0"}}>{u.email}</td>
            <td><span style={{fontSize:11,fontWeight:700,color:roleColour[u.role]||"#94a3b8",textTransform:"uppercase",letterSpacing:"0.05em"}}>{u.role||"—"}</span></td>
            <td style={{textAlign:"right"}}>
              {u.role!=="admin"&&(
                <select value={u.role||""} onChange={e=>changeRole(u.uid,e.target.value)} disabled={busy===u.uid}
                  style={{background:"#0d1c2c",color:"#e2e8f0",border:"1px solid #2d3f55",borderRadius:6,padding:"5px 10px",fontFamily:"inherit",fontSize:12,cursor:"pointer"}}>
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                  <option value="dataEntry">Data Entry</option>
                </select>
              )}
              {u.role==="admin"&&<span style={{fontSize:11,color:"#475569"}}>Protected</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};


export { AdminView, AirframePhotoSettings, DisclaimerSettings, EnginePhotoSettings, InviteUserCard, LogoSettings, UsersCard };
