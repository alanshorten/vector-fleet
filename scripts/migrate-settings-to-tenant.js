// migrate-settings-to-tenant.js
//
// M-01 fix: one-time migration of the old flat /settings/{key} docs into
// the new tenant-rooted /tenants/{tenantId}/settings/{key} path (see
// firestore.rules, src/lib/db.js, api/share/[token].js — all switched to
// the new path in the same change). Every pre-existing settings doc
// (tech_spec_logo_url, tech_spec_logo_width, tech_spec_hide_branding,
// default_disclaimer, engine_photo_*, airframe_photo_*) was written back
// when there was only ever one tenant ('maverick', formerly hardcoded as
// TENANT_ID — see Build Group A), so this copies every doc under the old
// /settings collection straight into /tenants/maverick/settings with the
// same doc ID and { value } shape, unchanged. A newly onboarded tenant
// (via create-tenant.js) starts with no settings docs at all, which is
// fine — techSpecBuilder.js's three-tier precedence (per-asset override ->
// fleet-wide Settings value -> hardcoded fallback) already handles a
// missing settings doc by falling back to the hardcoded default.
//
// Idempotent: overwrites tenants/maverick/settings/{key} with the current
// value from settings/{key} every run (last-write-wins from the OLD
// collection) — safe to re-run if some settings changed via the app's old
// path before this deploys. Does NOT delete the old /settings/{key} docs
// (firestore.rules already denies all read/write on that path as of this
// fix, so they're inert, not a live security exposure — left in place
// purely so this migration can be re-run / diffed against if needed
// before a separate cleanup pass deletes them).
//
// USAGE (same Firebase Admin env vars as every other scripts/*.js
// migration — FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY):
//   node -r dotenv/config scripts/migrate-settings-to-tenant.js dotenv_config_path=.env.local

const admin = require('firebase-admin');

const TARGET_TENANT_ID = 'maverick';

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

async function main() {
  const app = getApp();
  const fs = admin.firestore(app);

  const oldSnap = await fs.collection('settings').get();
  if (oldSnap.empty) {
    console.log('No docs found under /settings — nothing to migrate.');
    return;
  }

  let migrated = 0;
  const batch = fs.batch();
  oldSnap.docs.forEach((docSnap) => {
    const newRef = fs.collection('tenants').doc(TARGET_TENANT_ID).collection('settings').doc(docSnap.id);
    batch.set(newRef, docSnap.data());
    migrated++;
    console.log(`  ${docSnap.id} -> tenants/${TARGET_TENANT_ID}/settings/${docSnap.id}`);
  });
  await batch.commit();
  console.log(`Migrated ${migrated} settings doc(s) to tenants/${TARGET_TENANT_ID}/settings.`);
  console.log('Old /settings/{key} docs left in place but are now unreadable/unwritable per firestore.rules (M-01 fix) — safe to delete manually later once the migration is confirmed.');
}

main().catch((err) => {
  console.error('migrate-settings-to-tenant.js failed:', err);
  process.exit(1);
});