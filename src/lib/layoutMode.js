import { useState, useEffect, useCallback } from 'react';
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
export function useLayoutMode() {
  const [rawMode, setRawMode] = useState('portrait');
  const [width, setWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1200);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const uid = window._authUser?.uid || window._authUser?.email;
    db.getSetting(settingsKeyFor(uid)).then(val => {
      if (cancelled) return;
      if (val === 'landscape' || val === 'portrait') setRawMode(val);
      setLoaded(true);
    }).catch(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  const isWide = width >= LANDSCAPE_MIN_WIDTH;
  const mode = isWide ? rawMode : 'portrait';

  const setMode = useCallback((next) => {
    setRawMode(next);
    const uid = window._authUser?.uid || window._authUser?.email;
    db.setSetting(settingsKeyFor(uid), next).catch(() => {});
  }, []);

  return { mode, rawMode, setMode, isWide, width, loaded };
}

// Hidden entirely below the width floor — there's nothing useful to
// toggle into on a narrow screen, so showing a control that can't
// currently do anything would just be confusing.
export function LayoutModeToggle({ rawMode, setMode, isWide }) {
  if (!isWide) return null;
  const next = rawMode === 'landscape' ? 'portrait' : 'landscape';
  return (
    <button className="btn btn-ghost" onClick={() => setMode(next)}>
      {rawMode === 'landscape' ? '▤ Portrait View' : '▥ Landscape View'}
    </button>
  );
}
