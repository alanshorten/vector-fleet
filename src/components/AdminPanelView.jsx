import React, { useState, useEffect } from 'react';
import { makeBlankAsset } from '../lib/assetHelpers';
import { db, logAudit } from '../lib/db';
import { PlatformView } from './PlatformView';

// Admin — its own top-level nav entry (Alan, 21 Aug 2026), pulled out of
// Settings rather than living as tabs there. Originally "Admin Panel" and
// "Platform" were both tabs inside AdminView.jsx (Settings) — Alan wanted
// them combined into one dedicated Admin button instead, separate from
// the everyone-sees-it Settings screen. Two tabs here, same tab-bar
// convention as Settings: Admin Panel (assets + users, tenant-scoped,
// admin role) and Platform (tenant onboarding, cross-tenant, superAdmin
// claim only — folded in exactly as it briefly was inside Settings,
// just relocated).
function AdminPanelView({assets,saveAsset,notify,loadAssets,isAdmin,isSuperAdmin}){
  const TABS=[
    {key:"adminpanel",label:"Admin Panel",show:isAdmin},
    {key:"platform",label:"Platform",show:!!isSuperAdmin}
  ].filter(t=>t.show);
  const[tab,setTab]=useState(isAdmin?"adminpanel":"platform");
  const[showNew,setShowNew]=useState(false);
  const[newA,setNewA]=useState({msn:"",registration:"",model:"A320-214",operator:"",manufacturer:"Airbus S.A.S.",dom:""});
  const createAsset=async()=>{
    if(!newA.msn){notify("MSN required","error");return;}
    const blank=makeBlankAsset(newA,"aircraft");
    await saveAsset(blank);setShowNew(false);setNewA({msn:"",registration:"",model:"A320-214",operator:"",manufacturer:"Airbus S.A.S.",dom:""});notify(`Asset MSN ${blank.msn} created`);
  };
  const deleteAsset=async(id)=>{
    if(!confirm(`Delete asset MSN ${id}?`))return;
    const msn=assets.find(a=>String(a.id)===String(id))?.msn||id;
    try{
      await db.deleteAsset(id);
      await logAudit(id,msn,"Deleted asset");
      await loadAssets();
      notify("Asset deleted");
    }catch(e){
      // Previously this had no try/catch at all — a Firestore rules
      // rejection (e.g. from the cascade delete hitting a collection with a
      // deny-delete rule) failed silently: the batch commit throws, nothing
      // after it runs, and the button just looked like it did nothing.
      console.error("deleteAsset failed:",e);
      notify(`Delete failed: ${e?.message||e}`,"error");
    }
  };
  return(
    <div>
      <h1 style={{fontSize:20,color:"var(--color-carbon)",fontWeight:700,marginBottom:18}}>Admin</h1>
      {TABS.length>1&&(
        <div style={{display:"flex",borderBottom:"2px solid var(--color-divider)",marginBottom:20,gap:2,flexWrap:"wrap"}}>
          {TABS.map(t=><button key={t.key} className={`tab-btn${tab===t.key?" active":""}`} onClick={()=>setTab(t.key)}>{t.label}</button>)}
        </div>
      )}

      {tab==="adminpanel"&&isAdmin&&(
        <div style={{display:"flex",flexDirection:"column",gap:28}}>
          <div>
            <div className="section-title" style={{marginBottom:12}}>Assets</div>
            <div className="flj" style={{marginBottom:14}}>
              <span style={{color:"var(--color-graphite)",fontSize:13}}>{assets.length} aircraft in system</span>
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
                {assets.length===0&&<tr><td colSpan={6} style={{textAlign:"center",padding:40,color:"var(--color-graphite)"}}>No assets yet.</td></tr>}
                {assets.map(a=>(
                  <tr key={a.id}>
                    <td style={{fontWeight:600}}>{a.msn}</td>
                    <td style={{fontWeight:600}}>{a.registration||"—"}</td>
                    <td style={{color:"var(--color-graphite)"}}>{a.model||"—"}</td>
                    <td style={{color:"var(--color-graphite)"}}>{a.operator||"—"}</td>
                    <td style={{fontFamily:"monospace",fontSize:11,color:"var(--color-graphite)"}}>{a.engines?.map(e=>e.sn||"TBD").join(" / ")||"—"}</td>
                    <td><button className="btn-danger btn" style={{fontSize:10,padding:"3px 8px"}} onClick={()=>deleteAsset(a.id)}>Delete</button></td>
                  </tr>
                ))}
              </tbody></table>
            </div>
          </div>

          <div style={{maxWidth:700}}>
            <div className="section-title" style={{marginBottom:12}}>Users</div>
            <div style={{display:"flex",flexDirection:"column",gap:16}}>
              <div className="card" style={{padding:20}}>
                <div className="section-title">Invite User</div>
                <p style={{fontSize:12,color:"var(--color-graphite)",marginBottom:14}}>Create a new TailiQ account. They'll receive an email to set their own password.</p>
                <InviteUserCard notify={notify}/>
              </div>
              <div className="card" style={{padding:20}}>
                <div className="section-title">Manage Users</div>
                <p style={{fontSize:12,color:"var(--color-graphite)",marginBottom:14}}>View all users and change their roles. Admin role can only be set via server configuration.</p>
                <UsersCard notify={notify}/>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab==="platform"&&isSuperAdmin&&<PlatformView notify={notify}/>}
    </div>
  );
};

function InviteUserCard({notify}){
  const[email,setEmail]=useState("");
  const[role,setRole]=useState("editor");
  const[busy,setBusy]=useState(false);
  const[inviteLink,setInviteLink]=useState(null);
  const[copied,setCopied]=useState(false);
  const invite=async()=>{
    if(!email||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){notify("Enter a valid email address","error");return;}
    setBusy(true);setInviteLink(null);setCopied(false);
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
      if(result.inviteLink) setInviteLink(result.inviteLink);
      setEmail("");setRole("editor");
    }catch(e){
      notify(e.message||"Could not send invite.","error");
    }
    setBusy(false);
  };
  const copyLink=()=>{
    if(!inviteLink) return;
    navigator.clipboard.writeText(inviteLink).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),2500);});
  };
  return(
    <div style={{display:"flex",flexDirection:"column",gap:10}}>
      <div style={{display:"flex",gap:8}}>
        <input type="email" placeholder="name@company.com" value={email} onChange={e=>setEmail(e.target.value)} style={{flex:1}}/>
        <select value={role} onChange={e=>setRole(e.target.value)} style={{background:"var(--color-technical-grey)",color:"var(--color-carbon)",border:"1px solid var(--color-divider)",borderRadius:6,padding:"8px 12px",fontFamily:"inherit",fontSize:13,cursor:"pointer",width:120,flexShrink:0}}>
          <option value="editor">Editor</option>
          <option value="viewer">Viewer</option>
          <option value="dataEntry">Data Entry</option>
        </select>
        <button className="btn btn-gold" onClick={invite} disabled={busy}>{busy?"Sending…":"Send Invite"}</button>
      </div>
      {inviteLink&&(
        <div style={{display:"flex",alignItems:"center",gap:8,background:"var(--color-technical-grey)",border:"1px solid var(--color-divider)",borderRadius:6,padding:"8px 12px"}}>
          <span style={{fontSize:11,color:"var(--color-graphite)",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{inviteLink}</span>
          <button onClick={copyLink} style={{background:"none",border:"1px solid var(--color-divider)",color:copied?"var(--color-positive)":"var(--color-graphite)",borderRadius:4,padding:"4px 10px",fontSize:11,cursor:"pointer",flexShrink:0,transition:"color 0.2s"}}>{copied?"Copied ✓":"Copy link"}</button>
        </div>
      )}
      <p style={{fontSize:11,color:"var(--color-graphite)",margin:0}}>Editor — full access except user management. Viewer — sees everything including financials, edits nothing. Data Entry — uploads and lease/reserve entry only, no financial views.</p>
    </div>
  );
};

function UsersCard({notify}){
  const[users,setUsers]=useState([]);
  const[loading,setLoading]=useState(true);
  const[busy,setBusy]=useState(null);
  const[confirmRemove,setConfirmRemove]=useState(null);
  const[resendLink,setResendLink]=useState({});
  const[resendCopied,setResendCopied]=useState({});
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
  const resendInvite=async(u)=>{
    setBusy(u.uid);
    setResendLink(prev=>({...prev,[u.email]:null}));
    try{
      const idToken=await window._auth.getIdToken();
      const resp=await fetch("/api/invite-user",{
        method:"POST",
        headers:{"Content-Type":"application/json","Authorization":`Bearer ${idToken}`},
        body:JSON.stringify({email:u.email,role:u.role})
      });
      const result=await resp.json();
      if(!resp.ok||result.error)throw new Error(result.error||"Resend failed.");
      notify(`Invite resent to ${u.email}`);
      await load();
      if(result.inviteLink) setResendLink(prev=>({...prev,[u.email]:result.inviteLink}));
    }catch(e){notify(e.message||"Could not resend invite.","error");}
    setBusy(null);
  };
  const copyResendLink=async(email)=>{
    const link=resendLink[email];
    if(!link) return;
    await navigator.clipboard.writeText(link);
    setResendCopied(prev=>({...prev,[email]:true}));
    setTimeout(()=>setResendCopied(prev=>({...prev,[email]:false})),2500);
  };
  const removeUser=async(u)=>{
    setBusy(u.uid);setConfirmRemove(null);
    try{
      const idToken=await window._auth.getIdToken();
      const resp=await fetch("/api/remove-user",{
        method:"DELETE",
        headers:{"Content-Type":"application/json","Authorization":`Bearer ${idToken}`},
        body:JSON.stringify({uid:u.uid})
      });
      const data=await resp.json();
      if(!resp.ok)throw new Error(data.error||"Failed to remove user");
      notify(`${u.email} removed`);
      await load();
    }catch(e){notify(e.message||"Could not remove user.","error");}
    setBusy(null);
  };
  const roleColour={admin:"var(--color-ochre)",editor:"var(--color-positive)",viewer:"var(--color-graphite)",dataEntry:"var(--color-teal)"};
  if(loading)return<p style={{color:"var(--color-graphite)",fontSize:13}}>Loading users…</p>;
  if(!users.length)return<p style={{color:"var(--color-graphite)",fontSize:13}}>No users found.</p>;
  return(
    <div style={{display:"flex",flexDirection:"column",gap:0}}>
      <table style={{width:"100%"}}>
        <thead><tr><th style={{textAlign:"left"}}>Email</th><th style={{textAlign:"left"}}>Role</th><th></th></tr></thead>
        <tbody>
          {users.map(u=>(
            <React.Fragment key={u.uid}>
              <tr>
                <td style={{fontSize:13,color:"var(--color-carbon)",padding:"8px 0"}}>{u.email}</td>
                <td><span style={{fontSize:11,fontWeight:700,color:roleColour[u.role]||"var(--color-graphite)",textTransform:"uppercase",letterSpacing:"0.05em"}}>{u.role||"—"}</span></td>
                <td style={{textAlign:"right"}}>
                  {u.role!=="admin"&&(
                    <div style={{display:"flex",gap:6,justifyContent:"flex-end",alignItems:"center"}}>
                      <select value={u.role||""} onChange={e=>changeRole(u.uid,e.target.value)} disabled={!!busy}
                        style={{background:"var(--color-technical-grey)",color:"var(--color-carbon)",border:"1px solid var(--color-divider)",borderRadius:6,padding:"5px 10px",fontFamily:"inherit",fontSize:12,cursor:"pointer"}}>
                        <option value="editor">Editor</option>
                        <option value="viewer">Viewer</option>
                        <option value="dataEntry">Data Entry</option>
                      </select>
                      <button onClick={()=>resendInvite(u)} disabled={!!busy}
                        style={{background:"none",border:"1px solid var(--color-divider)",color:"var(--color-graphite)",borderRadius:4,padding:"5px 10px",fontSize:11,cursor:"pointer",whiteSpace:"nowrap"}}>
                        {busy===u.uid?"…":"Resend invite"}
                      </button>
                      {confirmRemove===u.uid?(
                        <div style={{display:"flex",gap:4,alignItems:"center"}}>
                          <span style={{fontSize:11,color:"var(--color-critical)",whiteSpace:"nowrap"}}>Remove?</span>
                          <button onClick={()=>removeUser(u)} disabled={!!busy}
                            style={{background:"var(--color-critical-tint)",border:"1px solid var(--color-critical)",color:"var(--color-critical)",borderRadius:4,padding:"5px 10px",fontSize:11,cursor:"pointer"}}>Yes</button>
                          <button onClick={()=>setConfirmRemove(null)}
                            style={{background:"none",border:"1px solid var(--color-divider)",color:"var(--color-graphite)",borderRadius:4,padding:"5px 10px",fontSize:11,cursor:"pointer"}}>No</button>
                        </div>
                      ):(
                        <button onClick={()=>setConfirmRemove(u.uid)} disabled={!!busy}
                          style={{background:"none",border:"1px solid var(--color-divider)",color:"var(--color-graphite)",borderRadius:4,padding:"5px 10px",fontSize:11,cursor:"pointer"}}>
                          Remove
                        </button>
                      )}
                    </div>
                  )}
                  {u.role==="admin"&&<span style={{fontSize:11,color:"var(--color-graphite)"}}>Protected</span>}
                </td>
              </tr>
              {resendLink[u.email]&&(
                <tr>
                  <td colSpan={3} style={{paddingBottom:8}}>
                    <div style={{display:"flex",alignItems:"center",gap:8,background:"var(--color-technical-grey)",border:"1px solid var(--color-divider)",borderRadius:6,padding:"7px 12px"}}>
                      <span style={{fontSize:11,color:"var(--color-graphite)",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{resendLink[u.email]}</span>
                      <button onClick={()=>copyResendLink(u.email)} style={{background:"none",border:"1px solid var(--color-divider)",color:resendCopied[u.email]?"var(--color-positive)":"var(--color-graphite)",borderRadius:4,padding:"4px 10px",fontSize:11,cursor:"pointer",flexShrink:0,transition:"color 0.2s"}}>
                        {resendCopied[u.email]?"Copied ✓":"Copy link"}
                      </button>
                    </div>
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export { AdminPanelView };