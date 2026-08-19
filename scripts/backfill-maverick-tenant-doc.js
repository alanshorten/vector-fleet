// backfill-maverick-tenant-doc.js
//
// One-time migration: creates the tenants/maverick PARENT document itself.
//
// Why this is needed: Maverick Horizon predates api/create-tenant.js by
// weeks — Phase 3 (tenant isolation) tenant-rooted every collection under
// tenants/maverick/{collection}/..., but a Firestore subcollection can exist
// without its parent document ever being explicitly created, and nothing in
// Phase 3 ever wrote a tenants/maverick doc itself. Build Group A (tenant
// onboarding, 19 Aug 2026) changes api/email-ingest.js's tenant-resolution
// check to require a live tenants/{tenantId} document with status:'active'
// (replacing the old single-tenant EXPECTED_COMPANY_SLUG env-var check) —
// without this script, that check fails for 'maverick' specifically and
// breaks live email ingestion for the one tenant that's actually in
// production use today.
//
// Run this BEFORE or immediately after deploying the Build Group A changes.
//
// Idempotent: safe to re-run — checks whether the doc already exists first
// and skips the write if so.
//
// USAGE:
//   1. Same Firebase Admin env vars as every other scripts/*.js migration
//      (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY) —
//      see migrate-3-collections-to-tenant.js's header for how to load them.
//   2. node scripts/backfill-maverick-tenant-doc.js

const admin = require('firebase-admin');

const TENANT_ID = 'maverick';
const TENANT_NAME = 'Maverick Horizon';

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
  const ref = fs.collection('tenants').doc(TENANT_ID);
  const snap = await ref.get();

  if (snap.exists) {
    console.log(`tenants/${TENANT_ID} already exists — nothing to do.`);
    console.log('Current data:', snap.data());
    return;
  }

  const now = new Date().toISOString();
  await ref.set({
    name: TENANT_NAME,
    slug: TENANT_ID,
    status: 'active',
    createdAt: now,
    // No createdBy — this tenant predates the super-admin/create-tenant
    // flow, so there's no single admin action that "created" it.
    createdBy: null,
    backfilled: true,
    backfilledAt: now,
  });

  console.log(`Created tenants/${TENANT_ID} (status: active).`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('backfill-maverick-tenant-doc: failed', err);
  process.exit(1);
});