// seed-approved-sender-maverick.js
//
// One-time seed: adds Alan's own address as the first approvedSenders entry
// for tenants/maverick, so api/email-ingest.js's new sender-verification
// step (Build Group A, 19 Aug 2026) has something to match against instead
// of rejecting every inbound email outright. Additional senders (lessee/
// partner domains, ops team addresses, etc.) can be added the same way
// later, or eventually through the /platform UI once that's built.
//
// Idempotent: safe to re-run — checks for an existing doc with the same
// type+value under this tenant before writing, skips if already present.
//
// USAGE:
//   Same Firebase Admin env vars as every other scripts/*.js migration
//   (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY).
//   node -r dotenv/config scripts/seed-approved-sender-maverick.js dotenv_config_path=.env.local

const admin = require('firebase-admin');

const TENANT_ID = 'maverick';
const SENDER = { type: 'email', value: 'alan.shorten@maverick-horizon.com' };

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
  const col = fs.collection('tenants').doc(TENANT_ID).collection('approvedSenders');

  const existing = await col
    .where('type', '==', SENDER.type)
    .where('value', '==', SENDER.value)
    .limit(1)
    .get();

  if (!existing.empty) {
    console.log(`approvedSenders entry for ${SENDER.value} already exists — nothing to do.`);
    return;
  }

  const now = new Date().toISOString();
  await col.add({
    type: SENDER.type,
    value: SENDER.value,
    addedBy: 'manual-seed-script',
    addedAt: now,
  });

  console.log(`Added approvedSenders entry: ${SENDER.type}=${SENDER.value} for tenants/${TENANT_ID}.`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('seed-approved-sender-maverick: failed', err);
  process.exit(1);
});
