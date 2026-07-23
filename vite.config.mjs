import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// APP_SURFACE selects which of the four product surfaces this build produces:
//   app      — Full platform            (app.tailiq.app)      — real, unchanged
//   specs    — TailiQ Specs              (specs.tailiq.app)    — STUB, not yet built
//   airframe — Free airframe spec tool   (airframe.tailiq.app) — STUB, not yet built
//   engine   — Free engine parse         (engine.tailiq.app)   — STUB, not yet built
//
// Each surface gets its own Vercel project pointed at this same repo, with its
// own APP_SURFACE env var set in the Vercel dashboard. That's what keeps each
// surface's deployed bundle down to only its own entry code, instead of every
// domain shipping the whole app. Defaults to 'app' so local dev and any project
// that hasn't set the env var yet behave exactly as before this change.
const SURFACE = process.env.APP_SURFACE || 'app';

const ENTRY_HTML = {
  app: 'index.html',
  specs: 'specs.html',
  airframe: 'airframe.html',
  engine: 'engine.html',
};

if (!ENTRY_HTML[SURFACE]) {
  throw new Error(
    `Unknown APP_SURFACE "${SURFACE}" — expected one of: ${Object.keys(ENTRY_HTML).join(', ')}`
  );
}

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    // esnext: the inline Firebase-init module script (kept verbatim from the
    // single-file app) uses top-level await, which esbuild's default target
    // list predates. Every browser that runs this app natively supports it —
    // this just stops esbuild transpiling it into something more constrained.
    target: 'esnext',
    rollupOptions: {
      input: ENTRY_HTML[SURFACE],
    },
  },
});
