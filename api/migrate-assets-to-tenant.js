// TailiQ — One-time migration: flat assets/{id} -> tenants/{tenantId}/assets/{id}
// POST /api/migrate-assets-to-tenant  (Bearer token required, admin only)
//
// security-remediation-roadmap.md Phase 3 (tenant isolation), Session 1.
// Copies every document from the old flat `assets` collection into the new
// tenant-rooted path. Idempotent — safe to re-run (each doc is a plain
// overwrite keyed by its own id, so re-running just re-copies the same
// data). Does NOT delete the flat originals — they're left in place as a
// rollback copy until a later cleanup session removes them, once the
// tenant-rooted path has been live and confirmed working for a while.
//
// Run this ONCE, after deploying bootstrap-admin.js/set-role.js/
// invite-user.js/App.jsx (so your own account has picked up its tenantId
// claim — reload the app once first) and the updated firestore.rules (so
// writes to /tenants/{tenantId}/assets are actually allowed), and BEFORE
// deploying the updated db.js (so the app doesn't start reading from an
// empty tenant collection before this has run). See the delivery notes for
// the full deploy order.
//
// This file has no reason to exist after the migration is confirmed and
// db.js is deployed — delete it in a follow-up cleanup once you're
// confident (or leave it; it's admin-gated and harmless to re-run).

const admin = require('firebase-admin');

const ALLOWED_ORIGINS = [
  'https://vector-fleet.vercel.app',
  'https://app.tailiq.app',
];

// Matches the TENANT_ID hardcoded in bootstrap-admin.js/set-role.js/
// invite-user.js — see those files for why it's hardcoded (single-tenant
// today).
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
    console.error('migrate-assets-to-tenant: Firebase Admin init failed', err);
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
    const sourceSnap = await fs.collection('assets').get();
    const sourceCount = sourceSnap.size;

    if (sourceCount === 0) {
      return res.status(200).json({ ok: true, migrated: 0, sourceCount: 0, destCount: 0, note: 'Nothing to migrate — flat assets collection is empty.' });
    }

    // Firestore batches cap at 500 writes — chunk defensively.
    const docs = sourceSnap.docs;
    const CHUNK = 450;
    let migrated = 0;
    for (let i = 0; i < docs.length; i += CHUNK) {
      const batch = fs.batch();
      docs.slice(i, i + CHUNK).forEach(d => {
        const destRef = fs.collection('tenants').doc(TENANT_ID).collection('assets').doc(d.id);
        batch.set(destRef, d.data());
        migrated++;
      });
      await batch.commit();
    }

    // Verify — read back the destination collection and confirm the count
    // matches. Doesn't compare document-by-document content (a batch.set
    // succeeding is already a strong guarantee), but a count mismatch here
    // would flag a real problem worth investigating before trusting the
    // migration.
    const destSnap = await fs.collection('tenants').doc(TENANT_ID).collection('assets').get();
    const destCount = destSnap.size;

    return res.status(200).json({
      ok: destCount === sourceCount,
      migrated,
      sourceCount,
      destCount,
      note: destCount === sourceCount
        ? 'Migration complete — counts match.'
        : `WARNING: destination count (${destCount}) does not match source count (${sourceCount}). Do not proceed to deploying the new db.js until this is investigated.`,
    });
  } catch (e) {
    console.error('migrate-assets-to-tenant: failed', e);
    return res.status(500).json({ error: 'Migration failed: ' + e.message });
  }
};