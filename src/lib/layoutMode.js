import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { db } from './db';

// Portrait/Landscape dual layout (landscape-portrait-layout-scoping-
// handoff.md) — manual toggle only, never guessed from physical device
// orientation (confirmed decision, §2 of the handoff). The ONE automatic
// behaviour here is a hard width floor: below LANDSCAPE_MIN_WIDTH a
// 2/3-up grid genuinely can't render usefully no matter what the person
// has chosen, so the EFFECTIVE mode always resolves to "portrait" below
// that width regardless of the saved preference. This is a rendering
// constraint, not orientation-guessing — it's what stops a landscape
// preference saved on a desktop session from showing up squeezed onto a
// phone, where the existing portrait/mobile-stacking already works well.
export const LANDSCAPE_MIN_WIDTH = 900;

function settingsKeyFor(uid) {
  return `layoutMode_${uid || 'anon'}`;
}

// Returns { mode, rawMode, setMode, isWide, loaded }.
// - mode: the EFFECTIVE mode to actually render — always 'portrait' below
//   the width floor, otherwise the person's saved preference. Everything
//   that renders should key off `mode`, never `rawMode`.
// - rawMode: the raw saved preference, exposed only for the toggle button
//   itself (so it can show what will apply once the viewport is wide
//   enough, rather than always reading "portrait" on a narrow window).
// - isWide: whether the current viewport clears the floor at all — used
//   to hide the toggle entirely rather than offer a choice that can't
//   currently do anything.
// Internal — called exactly ONCE, by LayoutModeProvider below. Every other
// component in the app reads the shared value via useLayoutMode() (the
// context consumer further down), not this. Calling this hook directly
// from more than one place would mean multiple independent Firestore
// reads and resize listeners for the same value, and a flash of the old
// mode on every tab navigation while each one re-fetches — exactly what
// prompted pulling this out of FlyForward.jsx in the first place.
function useLayoutModeSource() {
  const [rawMode, setRawMode] = useState('landscape');
  const [width, setWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1200);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const [authed, setAuthed] = useState(!!window._authUser);

  useEffect(() => {
    const onAuth = () => setAuthed(!!window._authUser);
    window.addEventListener('auth-state-changed', onAuth);
    return () => window.removeEventListener('auth-state-changed', onAuth);
  }, []);

  useEffect(() => {
    if (!authed) return; // wait until auth is resolved before reading
    let cancelled = false;
    const uid = window._authUser?.uid || window._authUser?.email;
    db.getSetting(settingsKeyFor(uid)).then(val => {
      if (cancelled) return;
      if (val === 'landscape' || val === 'portrait') setRawMode(val);
      else setRawMode('landscape');
      setLoaded(true);
    }).catch(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [authed]);

  const isWide = width >= LANDSCAPE_MIN_WIDTH;
  const mode = isWide ? rawMode : 'portrait';

  const setMode = useCallback((next) => {
    setRawMode(next);
    const uid = window._authUser?.uid || window._authUser?.email;
    db.setSetting(settingsKeyFor(uid), next).catch(() => {});
  }, []);

  return { mode, rawMode, setMode, isWide, width, loaded };
}

const LayoutModeContext = createContext({ mode: 'landscape', rawMode: 'landscape', setMode: () => {}, isWide: true, width: 1200, loaded: false });

// Wrap the whole app once (App.jsx, outside the tab/view switch) — this
// is what makes the preference and the toggle button genuinely
// app-wide rather than something each page has to remember to add.
export function LayoutModeProvider({ children }) {
  const value = useLayoutModeSource();
  return React.createElement(LayoutModeContext.Provider, { value }, children);
}

// What every component (FlyForward, Scenarios, PortfolioView, etc.)
// actually calls. Same shape as the old standalone hook, just backed by
// the single shared Provider value instead of its own fetch.
export function useLayoutMode() {
  return useContext(LayoutModeContext);
}

// Standalone alternative to the inline icon App.jsx builds directly into
// its trailing NavPill — not currently used anywhere, kept in case a
// future page wants a full toggle button outside a NavPill context.
// Hidden entirely below the width floor — there's nothing useful to
// toggle into on a narrow screen, so showing a control that can't
// currently do anything would just be confusing.
export function LayoutModeToggle({ rawMode, setMode, isWide }) {
  if (!isWide) return null;
  const next = rawMode === 'landscape' ? 'portrait' : 'landscape';
  return React.createElement(
    'button',
    { className: 'btn btn-ghost', onClick: () => setMode(next) },
    rawMode === 'landscape' ? '▤ Portrait View' : '▥ Landscape View'
  );
}
