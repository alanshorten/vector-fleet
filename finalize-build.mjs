// Vite names the emitted HTML file after its source entry (e.g. specs.html
// stays specs.html in dist/). Vercel serves whatever's at dist/index.html for
// requests to "/", so for any surface other than "app" we copy the real entry
// file to dist/index.html after the build. The original named file is left in
// place too (harmless, just unused) rather than deleted, to keep this script
// simple and side-effect-free if run twice.
import fs from 'node:fs';
import path from 'node:path';

const SURFACE = process.env.APP_SURFACE || 'app';

const ENTRY_HTML = {
  app: 'index.html',
  specs: 'specs.html',
  airframe: 'airframe.html',
  engine: 'engine.html',
};

const entryHtmlName = ENTRY_HTML[SURFACE];

if (!entryHtmlName) {
  console.error(`[finalize-build] Unknown APP_SURFACE "${SURFACE}" — did vite.config.mjs change without this script being updated too?`);
  process.exit(1);
}

if (entryHtmlName === 'index.html') {
  console.log(`[finalize-build] APP_SURFACE=${SURFACE}: index.html is already the entry, nothing to do.`);
  process.exit(0);
}

const distDir = path.resolve('dist');
const src = path.join(distDir, entryHtmlName);
const dest = path.join(distDir, 'index.html');

if (!fs.existsSync(src)) {
  console.error(`[finalize-build] APP_SURFACE=${SURFACE}: expected dist/${entryHtmlName} but it doesn't exist — check vite.config.mjs's ENTRY_HTML mapping and that ${entryHtmlName} exists at the repo root.`);
  process.exit(1);
}

fs.copyFileSync(src, dest);
console.log(`[finalize-build] APP_SURFACE=${SURFACE}: copied ${entryHtmlName} -> index.html`);
