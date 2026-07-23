import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';

// STUB — APP_SURFACE=engine entry point (engine.tailiq.app).
//
// Real product: the free, single gated engine parse — email-gated, hard
// rate-limited (real per-call AI cost, unlike the free airframe tool), the
// funnel door-opener into TailiQ Specs. Locked spec lives in
// tailiq-engines-scoping-handoff.md (§5, Free Engine Parse Experience).
// Replace this component with the real parse flow in its own build session.
function EngineStub() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#102A43',
      color: '#fff',
      fontFamily: 'Inter, sans-serif',
      textAlign: 'center',
      padding: '2rem',
    }}>
      <div>
        <h1 style={{ fontWeight: 600, fontSize: '1.5rem', marginBottom: '0.5rem' }}>TailiQ Engines</h1>
        <p style={{ opacity: 0.7 }}>Coming soon.</p>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<EngineStub />);
