// TailiQ — One-time backfill: tenantMembers docs for existing users
// POST /api/backfill-tenant-members  (Bearer token required, admin only)
//
// security-remediation-roadmap.md Phase 3, Session 6 (3C / M-01, Decision 2).
//
// Why this exists: bootstrap-admin.js only runs client-side when a user is
// MISSING role or tenantId (see App.jsx's resolveRole — `if(!role||!tenantId)`).
// Every existing TailiQ user already has both (Phase 3 Session 1 backfilled
// tenantId for everyone), so none of them would ever trigger bootstrap-admin
// again and pick up a tenantMembers doc automatically. Since the new
// firestore.rules WRITE rules now require an active tenantMembers doc
// (memberHasRole()/isActiveMember()), publishing those rules without running
// this first would lock every existing user out of writing anything — not a
// hypothetical, an immediate outage the moment the rules go live.
//
// Run this ONCE, after deploying this file but BEFORE publishing the updated
// firestore.rules. Idempotent — safe to re-run (each user's doc is a plain
// merge keyed by their own uid). Reads every Firebase Auth user's existing
// customClaims (role) and creates/updates their tenantMembers doc to match —
// no new information invented, just catching up what set-role.js/invite-
// user.js/bootstrap-admin.js already do for any NEW claim change from here on.

const admin = require('firebase-admin');

const ALLOWED_ORIGINS = [
  'https://vector-fleet.vercel.app',
  'https://app.tailiq.app',
];

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
    console.error('backfill-tenant-members: Firebase Admin init failed', err);
    return res.status(500).json({ error: 'Server configuration error.' });
  }

  let decoded;
  try {
    decoded = await admin.auth(app).verifyIdToken(idToken, true);
  } catch (err) {
    return res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
  }

  if (decoded.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  try {
    const auth = admin.auth(app);
    const fs = admin.firestore(app);
    const listResult = await auth.listUsers(1000);

    let backfilled = 0;
    let skipped = 0;
    const now = new Date().toISOString();

    for (const u of listResult.users) {
      const role = u.customClaims?.role;
      if (!role) {
        // No role claim at all — an unprovisioned signup, nothing to
        // represent yet. They'll get a tenantMembers doc the normal way
        // (bootstrap-admin/invite-user) once they're actually provisioned.
        skipped++;
        continue;
      }
      const ref = fs.collection('tenants').doc(TENANT_ID).collection('tenantMembers').doc(u.uid);
      const snap = await ref.get();
      await ref.set({
        role,
        email: u.email || null,
        status: u.disabled ? 'disabled' : 'active',
        createdAt: snap.exists ? snap.data().createdAt : now,
        updatedAt: now,
      }, { merge: true });
      backfilled++;
    }

    return res.status(200).json({ ok: true, backfilled, skipped, totalUsers: listResult.users.length });
  } catch (e) {
    console.error('backfill-tenant-members: failed', e);
    return res.status(500).json({ error: 'Backfill failed: ' + e.message });
  }
};