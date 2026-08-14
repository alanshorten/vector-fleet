// TailiQ — One-time migration: flat utilisation/shareTokens/pendingReports
// -> tenants/{tenantId}/{collection}
// POST /api/migrate-util-sharetokens-pending-to-tenant  (Bearer token required, admin only)
//
// security-remediation-roadmap.md Phase 3 (tenant isolation), Session 4.
// Same pattern as migrate-leases-reserves-to-tenant.js (Session 2) and
// migrate-scheduled-seasonality-to-tenant.js (Session 3) — copies every
// document from the old flat `utilisation`, `shareTokens`, and
// `pendingReports` collections into their tenant-rooted paths. Idempotent —
// safe to re-run. Does NOT delete the flat originals.
//
// Deploy order matches prior sessions: deploy this file, publish the
// updated firestore.rules, THEN deploy api/share/[token].js and
// api/email-ingest.js (already updated to read/write the tenant-rooted
// paths for shareTokens/utilisation/pendingReports), THEN call this
// endpoint, THEN deploy the updated db.js. See the Session 4 delivery
// notes in the project for the full sequence.

const admin = require('firebase-admin');

const ALLOWED_ORIGINS = [
  'https://vector-fleet.vercel.app',
  'https://app.tailiq.app',
];

// Matches the TENANT_ID hardcoded in bootstrap-admin.js/set-role.js/
// invite-user.js/the other migrate-*-to-tenant.js files/email-ingest.js/
// share/[token].js.
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
    console.error('migrate-util-sharetokens-pending-to-tenant: Firebase Admin init failed', err);
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
    const utilisation = await migrateCollection(fs, 'utilisation');
    const shareTokens = await migrateCollection(fs, 'shareTokens');
    const pendingReports = await migrateCollection(fs, 'pendingReports');

    const ok = utilisation.destCount === utilisation.sourceCount
      && shareTokens.destCount === shareTokens.sourceCount
      && pendingReports.destCount === pendingReports.sourceCount;

    return res.status(200).json({ ok, utilisation, shareTokens, pendingReports });
  } catch (e) {
    console.error('migrate-util-sharetokens-pending-to-tenant: failed', e);
    return res.status(500).json({ error: 'Migration failed: ' + e.message });
  }
};