import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';

// STUB — APP_SURFACE=specs entry point (specs.tailiq.app).
//
// Real product: TailiQ Specs, the €49/month personal tier — tech spec
// generation + sharing only, no financial intelligence. Locked spec lives in
// COMMERCIAL_VISION.md and tailiq-engines-scoping-handoff.md. Deliberately no
// Firebase/CDN scripts wired in here yet — this file exists purely so the
// specs.tailiq.app Vercel project has a real page to deploy today. Replace
// this component with the actual Specs UI in its own build session.
function SpecsStub() {
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
        <h1 style={{ fontWeight: 600, fontSize: '1.5rem', marginBottom: '0.5rem' }}>TailiQ Specs</h1>
        <p style={{ opacity: 0.7 }}>Coming soon.</p>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<SpecsStub />);
