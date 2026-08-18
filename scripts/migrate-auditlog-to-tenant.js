// migrate-auditlog-to-tenant.js
//
// One-time migration: copies existing flat-path auditLog documents into
// the new tenant-rooted path tenants/{TENANT_ID}/auditLog/... — see
// claude_security-review-20260818-handoff.md item 8 and firestore.rules
// for the rules side of this change.
//
// Idempotent: safe to re-run. Each destination write checks whether the
// doc already exists at the tenant-rooted path first and skips it if so,
// so a partial run (or crash midway) can just be re-run from the top.
//
// Lives in scripts/, NOT api/, deliberately — this is a plain Node script
// with no HTTP handler, run once from a shell with Admin SDK credentials.
// Vercel treats every .js file under api/ as a route regardless of whether
// it exports a handler (see TECH_DEBT.md 4.131 — the Hobby plan's
// 12-function cap was hit exactly this way with a migration script that
// briefly sat in api/), and the deployment is already sitting at that cap
// with zero headroom, so this must never go in api/.
//
// USAGE:
//   1. Make sure the same Firebase Admin env vars extract.js/email-ingest.js
//      use are available in this shell: FIREBASE_PROJECT_ID,
//      FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY. Easiest way if you use
//      Vercel: `vercel env pull .env.local` in the repo root, then load
//      that file's values into your shell (or run this with a loader like
//      `node -r dotenv/config migrate-auditlog-to-tenant.js` after
//      `npm install dotenv --save-dev` and renaming .env.local to .env, or
//      just `export` the three values directly — whichever's easiest).
//   2. node scripts/migrate-auditlog-to-tenant.js
//   3. Read the summary it prints at the end: found/copied/skipped
//      (already existed at the destination) counts.
//   4. Nothing is deleted from the flat auditLog path by this script — the
//      flat documents stay in place as a rollback copy, same
//      DEPRECATED/TRANSITIONAL pattern as every other Phase 3 migration.
//      Access to the flat path is denied by firestore.rules regardless of
//      whether this script has been run.
//   5. Live-test afterwards: trigger any action that calls logAudit() (e.g.
//      edit an asset field) and confirm the new entry lands under
//      tenants/{TENANT_ID}/auditLog rather than the flat path.

const admin = require('firebase-admin');

const TENANT_ID = 'maverick'; // matches the hardcoded value in email-ingest.js, bootstrap-admin.js, set-role.js, invite-user.js

function getApp() {
  if (admin.apps.length) return admin.app();
  return admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    }),
  });
}

async function migrateAuditLog(fsdb) {
  const flatSnap = await fsdb.collection('auditLog').get();
  let copied = 0, skipped = 0;
  for (const docSnap of flatSnap.docs) {
    const destRef = fsdb.collection('tenants').doc(TENANT_ID).collection('auditLog').doc(docSnap.id);
    const destSnap = await destRef.get();
    if (destSnap.exists) { skipped++; continue; }
    await destRef.set(docSnap.data());
    copied++;
  }
  return { found: flatSnap.size, copied, skipped };
}

async function main() {
  const app = getApp();
  const fsdb = admin.firestore(app);

  console.log(`Migrating flat auditLog to tenants/${TENANT_ID}/auditLog/... (idempotent — safe to re-run)\n`);

  const result = await migrateAuditLog(fsdb);
  console.log(`auditLog: found ${result.found}, copied ${result.copied}, skipped (already existed) ${result.skipped}`);

  console.log('\nDone. Flat auditLog documents were NOT deleted (rollback copy) — access is denied by firestore.rules regardless.');
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});