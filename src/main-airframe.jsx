import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';

// STUB — APP_SURFACE=airframe entry point (airframe.tailiq.app).
//
// Real product: the free, stateless, anonymous airframe tech spec builder —
// no accounts, no AI extraction, permanent TailiQ branding. See
// COMMERCIAL_VISION.md for the locked tagline and tailiq-lite-freetool-concept.md
// for the original concept. Replace this component with the real spec-builder
// form in its own build session.
function AirframeStub() {
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
        <h1 style={{ fontWeight: 600, fontSize: '1.5rem', marginBottom: '0.5rem' }}>TailiQ</h1>
        <p style={{ opacity: 0.7 }}>The standard aircraft tech spec — coming soon.</p>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<AirframeStub />);
