import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Single entry point for now — this migration pass reproduces the existing
// single-file app 1:1 inside a Vite/modular structure. The follow-up session
// adds an APP_SURFACE env var and per-surface entry points (app/specs/airframe/engine)
// so each free tool's bundle doesn't ship the whole app's code — see
// tailiq-engines-scoping-handoff.md / repo-structure decisions for that plan.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    // esnext: the inline Firebase-init module script (kept verbatim from the
    // single-file app) uses top-level await, which esbuild's default target
    // list predates. Every browser that runs this app natively supports it —
    // this just stops esbuild transpiling it into something more constrained.
    target: 'esnext',
  },
});
