// TailiQ — User removal API (Admin only)
// DELETE /api/remove-user  { uid } -> { ok: true }
//
// Caller must be a signed-in user with role=admin custom claim, scoped to
// their own tenant. Admin accounts cannot be removed via this endpoint
// (mirrors the "Protected" state AdminPanelView.jsx already shows in the
// UI for role==='admin' rows), and a caller cannot remove themselves.
//
// Security review 20260820, F-03: this file was previously a byte-for-byte
// copy of set-role.js — GET/POST only, role-management logic, no deleteUser
// call — so every DELETE request from AdminPanelView.jsx's removeUser()
// 405'd and offboarding silently did nothing. This is a dedicated DELETE
// handler that actually removes the target account.
//
// Ordering follows the same fail-safe direction as set-role.js's M-02 fix:
// the tenantMembers doc (what firestore.rules actually consults for write
// access) is removed FIRST and must succeed before anything in Auth is
// touched. If that fails, the request aborts and the user keeps their
// current access everywhere — a safe, consistent failure rather than a
// partial removal that revokes Auth but leaves Firestore write access
// live under a stale membership doc. Refresh-token revocation and the
// Auth record deletion happen after, in that order, since killing the
// live session matters more than the account record disappearing a beat
// later.
//
// Idempotent: removing a uid that's already gone (membership doc absent
// and/or Auth record absent) returns ok:true rather than erroring, so a
// retried or double-clicked removal is a controlled no-op, per the
// review's acceptance test.

const admin = require('firebase-admin');
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
  if (!idToken) return res.status(401).json({ error: 'Missing authentication token' });

  let app;
  try { app = getApp(); } catch (e) {
    return res.status(500).json({ error: 'Server configuration error' });
  }

  let decoded;
  try {
    // Same checkRevoked=true as set-role.js (3C / M-01, Layer 1) — rejects a
    // token invalidated by a prior revokeRefreshTokens() call.
    decoded = await admin.auth(app).verifyIdToken(idToken, true);
  } catch (e) {
    return res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
  }

  if (decoded.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const auth = admin.auth(app);

  try {
    const callerRecord = await auth.getUser(decoded.uid);
    if (callerRecord.disabled) {
      return res.status(403).json({ error: 'Your account has been disabled. Contact an admin.' });
    }
  } catch (e) {
    return res.status(401).json({ error: 'Your account could not be verified. Please sign in again.' });
  }

  const { uid } = req.body || {};
  if (!uid || typeof uid !== 'string') {
    return res.status(400).json({ error: 'uid is required' });
  }
  if (uid === decoded.uid) {
    return res.status(400).json({ error: 'You cannot remove your own account.' });
  }

  const fs = admin.firestore(app);
  const memberRef = fs.collection('tenants').doc(decoded.tenantId).collection('tenantMembers').doc(uid);

  // Look up the target via Auth first, purely to scope/validate the request
  // and capture details for the audit log — the actual access-revoking
  // writes below don't depend on this succeeding.
  let targetUser = null;
  try {
    targetUser = await auth.getUser(uid);
  } catch (e) {
    if (e.code !== 'auth/user-not-found') {
      console.error('remove-user: getUser failed', { uid, err: e });
      return res.status(500).json({ error: 'Could not look up user' });
    }
    // Auth record already gone. Fall through — still attempt to clean up
    // the tenantMembers doc below so a half-removed user (e.g. from a
    // previous failed attempt) can be retried and converges to fully gone.
  }

  if (targetUser && targetUser.customClaims?.tenantId !== decoded.tenantId) {
    // Mirrors set-role.js: don't reveal that a uid exists in another
    // tenant, and never let an admin act outside their own tenant.
    return res.status(404).json({ error: 'User not found.' });
  }
  if (targetUser?.customClaims?.role === 'admin') {
    return res.status(403).json({ error: 'Admin accounts cannot be removed via this endpoint.' });
  }

  // Step 1 — tenantMembers doc. This is the control Firestore write rules
  // actually consult; removing it is what actually cuts off write access.
  // Must succeed before anything below runs.
  try {
    await memberRef.delete();
  } catch (e) {
    console.error('remove-user: tenantMembers delete failed — aborting, target retains current access', { uid, tenantId: decoded.tenantId, err: e });
    return res.status(500).json({ error: 'Could not remove user. Please try again.' });
  }

  // Step 2 — revoke refresh tokens so any live session dies immediately
  // instead of riding out its cached ID token (up to ~1hr). Non-fatal if
  // the Auth record is already gone.
  let tokenRevokeFailed = false;
  if (targetUser) {
    try {
      await auth.revokeRefreshTokens(uid);
    } catch (e) {
      tokenRevokeFailed = true;
      console.error('remove-user: revokeRefreshTokens failed — membership already removed, operator should verify session is dead', { uid, err: e });
    }
  }

  // Step 3 — delete the Auth record itself. Non-fatal if it's already
  // gone (idempotent retry) or if this specific step fails: the user has
  // no tenantMembers doc and no valid refresh token either way, so they
  // have no path back into tenant data even if the Auth record lingers.
  let authDeleteFailed = false;
  if (targetUser) {
    try {
      await auth.deleteUser(uid);
    } catch (e) {
      if (e.code !== 'auth/user-not-found') {
        authDeleteFailed = true;
        console.error('remove-user: deleteUser failed — access is already revoked (membership + tokens), operator should retry to clean up the Auth record', { uid, err: e });
      }
    }
  }

  try {
    await writeAuditLog(fs, decoded.tenantId, {
      userId: decoded.uid,
      userEmail: decoded.email,
      action: `Removed user ${targetUser?.email || uid}${tokenRevokeFailed || authDeleteFailed ? ' (partial: see server logs)' : ''}`,
    });
  } catch (auditErr) {
    console.error('remove-user: audit log write failed', auditErr);
  }

  if (tokenRevokeFailed || authDeleteFailed) {
    // Access is already cut off (tenantMembers gone); surface the partial
    // failure so an operator knows to check logs and retry rather than
    // assuming full cleanup happened.
    return res.status(200).json({ ok: true, warning: 'User access was revoked, but cleanup did not fully complete. Check server logs.' });
  }

  return res.status(200).json({ ok: true });
};