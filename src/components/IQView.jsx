import React from 'react';
import { SVAnalyticsCard } from './SVAnalyticsCard';

// iQ tab — the intelligence/analytics layer of TailiQ, distinct from the
// position views (Fleet Exposure / Financials) and the scheduling view
// (Calendar). Admin-only, gated by the caller (App.jsx).
// Scoping: sv-analytics-iq-tab-build-spec.md
function IQView({assets}){
  return(
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      <SVAnalyticsCard assets={assets}/>

      {/* Reserved — fleet-level Cost Tracker completed-events view migrates
          here in a future session. Existing "View completed events" button
          on Calendar stays live until then (spec §5e, §10). */}
      <div className="card" style={{padding:18,opacity:0.5}}>
        <div className="section-title">Completed Events</div>
        <p style={{color:"#475569",fontSize:12,fontStyle:"italic",marginTop:6}}>Reserved for a future session — Cost Tracker completed events, migrated from the Calendar tab.</p>
      </div>

      {/* Reserved — Rate Recommendation Engine, TECH_DEBT 4.102, blocked on
          Cost Tracker data volume. */}
      <div className="card" style={{padding:18,opacity:0.5}}>
        <div className="section-title">Rate Recommendations</div>
        <p style={{color:"#475569",fontSize:12,fontStyle:"italic",marginTop:6}}>Reserved for a future session — Rate Recommendation Engine, blocked on Cost Tracker data volume.</p>
      </div>
    </div>
  );
}

export { IQView };
