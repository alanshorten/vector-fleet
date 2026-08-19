// TailiQ — Admin-only user removal
// DELETE /api/remove-user  { uid }  ->  { ok: true }
//
// Deletes a Firebase Auth user by UID. Admin-only — verified server-side
// via Firebase ID token custom claim. The admin account itself is protected
// and cannot be removed via this endpoint.

// security-remediation-roadmap.md Phase 3, Session 6 (3C / M-01, Decision 2):
// matches the TENANT_ID hardcoded in bootstrap-admin.js/set-role.js/
// invite-user.js — needed here now to clean up the removed user's
// tenantMembers doc alongside their Auth account.
const TENANT_ID = 'maverick';

const admin = require('firebase-admin');
const { maskEmail } = require('./_lib/logRedact');
const { writeAuditLog } = require('./_lib/auditLog');

const ALLOWED_ORIGINS = [
  'https://vector-fleet.vercel.app',
  'https://app.tailiq.app',
];

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
  res.setHeader('Access-Control-Allow-Methods', 'DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!idToken) return res.status(401).json({ error: 'Missing authentication token.' });

  let app;
  try {
    app = getApp();
  } catch (err) {
    console.error('remove-user: Firebase Admin init failed', err);
    return res.status(500).json({ error: 'Server configuration error.' });
  }

  let decoded;
  try {
    // security-remediation-roadmap.md Phase 3 Session 6 (3C / M-01, Layer 1):
    // checkRevoked=true rejects a token invalidated by a prior
    // revokeRefreshTokens() call, closing the up-to-an-hour stale-token gap.
    decoded = await admin.auth(app).verifyIdToken(idToken, true);
  } catch (err) {
    return res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
  }

  if (decoded.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  try {
    const callerRecord = await admin.auth(app).getUser(decoded.uid);
    if (callerRecord.disabled) {
      return res.status(403).json({ error: 'Your account has been disabled. Contact an admin.' });
    }
  } catch (err) {
    return res.status(401).json({ error: 'Your account could not be verified. Please sign in again.' });
  }

  const { uid } = req.body || {};
  if (!uid || typeof uid !== 'string') {
    return res.status(400).json({ error: 'A valid user UID is required.' });
  }

  // Prevent removing the currently signed-in admin
  if (uid === decoded.uid) {
    return res.status(400).json({ error: 'You cannot remove your own account.' });
  }

  try {
    const auth = admin.auth(app);
    const userRecord = await auth.getUser(uid);

    // Protect admin accounts from removal via this endpoint
    if (userRecord.customClaims && userRecord.customClaims.role === 'admin') {
      return res.status(403).json({ error: 'Admin accounts cannot be removed via this endpoint.' });
    }

    await auth.deleteUser(uid);
    console.log(`remove-user: deleted ${maskEmail(userRecord.email)} (${uid}) by admin ${maskEmail(decoded.email)}`);

    // Audit log — server-side privilege action (Session A, 19 Aug 2026).
    // Non-fatal: a failed audit write should never block the removal itself.
    try {
      await writeAuditLog(admin.firestore(app), TENANT_ID, {
        userId:    decoded.uid,
        userEmail: decoded.email,
        action:    `Removed user ${userRecord.email || uid}`,
      });
    } catch (auditErr) {
      console.error('remove-user: audit log write failed', auditErr);
    }

    // Phase 3 Session 6 (3C / M-01, Layer 2, Decision 2): remove the
    // corresponding tenantMembers doc too — the account is gone entirely,
    // so there's no "disabled" middle state to represent, unlike a role
    // change. Non-fatal on failure: the Auth account is already deleted
    // (the actual access-control action), a stray membership doc left
    // behind just means future write rules would see status/role for a uid
    // that can no longer authenticate anyway, since verifyIdToken would
    // fail for it.
    try {
      await admin.firestore(app).collection('tenants').doc(TENANT_ID).collection('tenantMembers').doc(uid).delete();
    } catch (memberErr) {
      console.error('remove-user: tenantMembers cleanup failed', memberErr);
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    if (err.code === 'auth/user-not-found') {
      return res.status(404).json({ error: 'User not found.' });
    }
    console.error('remove-user: failed', err);
    return res.status(500).json({ error: 'Something went wrong removing the user. Please try again.' });
  }
};