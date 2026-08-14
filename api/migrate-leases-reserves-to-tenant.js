// TailiQ — One-time migration: flat leases/reserves -> tenants/{tenantId}/{collection}
// POST /api/migrate-leases-reserves-to-tenant  (Bearer token required, admin only)
//
// security-remediation-roadmap.md Phase 3 (tenant isolation), Session 2.
// Same pattern as migrate-assets-to-tenant.js (Session 1) — copies every
// document from the old flat `leases` and `reserves` collections into their
// tenant-rooted paths. Idempotent — safe to re-run. Does NOT delete the
// flat originals.
//
// Deploy order matches Session 1: deploy this file, publish the updated
// firestore.rules, THEN call this endpoint, THEN deploy the updated db.js.
// See the Session 2 delivery notes in the project for the full sequence.

const admin = require('firebase-admin');

const ALLOWED_ORIGINS = [
  'https://vector-fleet.vercel.app',
  'https://app.tailiq.app',
];

// Matches the TENANT_ID hardcoded in bootstrap-admin.js/set-role.js/
// invite-user.js/migrate-assets-to-tenant.js.
const TENANT_ID = 'maverick';

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

async function migrateCollection(fs, name) {
  const sourceSnap = await fs.collection(name).get();
  const sourceCount = sourceSnap.size;

  if (sourceCount === 0) {
    return { migrated: 0, sourceCount: 0, destCount: 0, note: `Nothing to migrate — flat ${name} collection is empty.` };
  }

  const docs = sourceSnap.docs;
  const CHUNK = 450;
  let migrated = 0;
  for (let i = 0; i < docs.length; i += CHUNK) {
    const batch = fs.batch();
    docs.slice(i, i + CHUNK).forEach(d => {
      const destRef = fs.collection('tenants').doc(TENANT_ID).collection(name).doc(d.id);
      batch.set(destRef, d.data());
      migrated++;
    });
    await batch.commit();
  }

  const destSnap = await fs.collection('tenants').doc(TENANT_ID).collection(name).get();
  const destCount = destSnap.size;

  return {
    migrated,
    sourceCount,
    destCount,
    note: destCount === sourceCount
      ? 'Migration complete — counts match.'
      : `WARNING: destination count (${destCount}) does not match source count (${sourceCount}).`,
  };
}

module.exports = async (req, res) => {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!idToken) return res.status(401).json({ error: 'Missing authentication token.' });

  let app;
  try {
    app = getApp();
  } catch (err) {
    console.error('migrate-leases-reserves-to-tenant: Firebase Admin init failed', err);
    return res.status(500).json({ error: 'Server configuration error.' });
  }

  let decoded;
  try {
    decoded = await admin.auth(app).verifyIdToken(idToken);
  } catch (err) {
    return res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
  }

  if (decoded.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  try {
    const fs = admin.firestore(app);
    const leases = await migrateCollection(fs, 'leases');
    const reserves = await migrateCollection(fs, 'reserves');

    const ok = leases.destCount === leases.sourceCount && reserves.destCount === reserves.sourceCount;

    return res.status(200).json({ ok, leases, reserves });
  } catch (e) {
    console.error('migrate-leases-reserves-to-tenant: failed', e);
    return res.status(500).json({ error: 'Migration failed: ' + e.message });
  }
};