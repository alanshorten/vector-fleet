// TailiQ — Role management (Admin only)
// GET  /api/set-role  -> { users: [{uid, email, role}] }
// POST /api/set-role  { uid, role } -> { ok: true }
//
// Caller must be a signed-in user with role=admin custom claim.
// Role may only be set to 'editor', 'viewer', or 'dataEntry' via this
// endpoint — admin role is bootstrap-only (see /api/bootstrap-admin).
//
// security-remediation-roadmap.md Phase 3, Session 1: setCustomUserClaims
// REPLACES the whole claims object, it doesn't merge — so this must always
// re-stamp tenantId alongside role, or a role change would silently wipe a
// user's tenant access.
//
// Build Group A (tenant onboarding, 19 Aug 2026): the tenantId to re-stamp
// is no longer a hardcoded constant — it's resolved per-request from the
// calling admin's own tenantId claim (decoded.tenantId, set below after the
// token is verified). An admin can only ever change roles within their own
// tenant this way; there's no client input path to name a different tenant.

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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!idToken) return res.status(401).json({ error: 'Missing authentication token' });

  let app;
  try { app = getApp(); } catch (e) {
    return res.status(500).json({ error: 'Server configuration error' });
  }

  let decoded;
  try {
    // security-remediation-roadmap.md Phase 3 Session 6 (3C / M-01, Layer 1):
    // checkRevoked=true rejects a token invalidated by a prior
    // revokeRefreshTokens() call, closing the up-to-an-hour stale-token gap.
    decoded = await admin.auth(app).verifyIdToken(idToken, true);
  } catch (e) {
    return res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
  }

  // Enforce admin-only access
  if (decoded.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  try {
    const callerRecord = await admin.auth(app).getUser(decoded.uid);
    if (callerRecord.disabled) {
      return res.status(403).json({ error: 'Your account has been disabled. Contact an admin.' });
    }
  } catch (e) {
    return res.status(401).json({ error: 'Your account could not be verified. Please sign in again.' });
  }

  const auth = admin.auth(app);

  // GET — list users with their role claims, scoped to the caller's own tenant
  if (req.method === 'GET') {
    try {
      // Build Group A (19 Aug 2026): listUsers(1000) previously returned
      // every account platform-wide with no tenant filter — harmless when
      // 'maverick' was the only tenant, but a real cross-tenant user-list
      // disclosure once a second tenant exists. Filtered to accounts whose
      // tenantId claim matches the caller's own; a super-admin account (no
      // tenantId, platform-level only) never appears in any tenant's list.
      const listResult = await auth.listUsers(1000);
      const users = listResult.users
        .filter(u => u.customClaims?.tenantId === decoded.tenantId)
        .map(u => ({
          uid: u.uid,
          email: u.email || '',
          role: u.customClaims?.role || null,
        }));
      // Sort: admin first, then editor, then viewer, then dataEntry, then unset; alphabetical within group
      const order = { admin: 0, editor: 1, viewer: 2, dataEntry: 3 };
      users.sort((a, b) => {
        const oa = order[a.role] ?? 3;
        const ob = order[b.role] ?? 3;
        if (oa !== ob) return oa - ob;
        return (a.email || '').localeCompare(b.email || '');
      });
      return res.status(200).json({ users });
    } catch (e) {
      console.error('set-role GET: listUsers failed', e);
      return res.status(500).json({ error: 'Could not retrieve users' });
    }
  }

  // POST — change a user's role
  const { uid, role } = req.body || {};
  if (!uid || typeof uid !== 'string') {
    return res.status(400).json({ error: 'uid is required' });
  }
  if (!['editor', 'viewer', 'dataEntry'].includes(role)) {
    return res.status(400).json({ error: 'Role must be editor, viewer, or dataEntry. Admin role cannot be set via this endpoint.' });
  }

  try {
    // Fetch the target user BEFORE overwriting claims, so we can capture the
    // previous role for audit logging. This getUser call used to live after
    // setCustomUserClaims (for the tenantMembers sync) — moved up so the old
    // claims are still readable. The same targetUser object is reused below.
    const targetUser = await auth.getUser(uid);
    const oldRole = targetUser.customClaims?.role || 'none';

    // Build Group A (19 Aug 2026): the tenantId re-stamped below is now
    // resolved from the caller's own claim rather than a shared hardcoded
    // constant — which means an admin from tenant A calling this with a
    // tenant B user's uid would otherwise silently REASSIGN that user into
    // tenant A. Reject outright unless the target already belongs to the
    // caller's own tenant. This mirrors the same ownership check
    // api/share/create.js already does for assets.
    if (targetUser.customClaims?.tenantId !== decoded.tenantId) {
      return res.status(404).json({ error: 'User not found.' });
    }

    await auth.setCustomUserClaims(uid, { role, tenantId: decoded.tenantId });
    // Revoke existing refresh tokens so the change takes effect promptly —
    // without this, a signed-in user's cached ID token (and the role claim
    // baked into it) stays valid for up to an hour regardless of what an
    // admin just changed. The client periodically force-refreshes its token
    // and detects/reacts to this revocation (see App.jsx).
    await auth.revokeRefreshTokens(uid);

    // Phase 3 Session 6 (3C / M-01, Layer 2, Decision 2): keep the
    // tenantMembers membership doc in sync with the role change. This is
    // what Firestore WRITE rules actually consult (see the memberRole()/
    // isActiveMember() helpers in firestore.rules) — an instant,
    // rules-visible source of truth that doesn't wait on token refresh or
    // expiry the way the custom claim above does.
    try {
      const fs = admin.firestore(app);
      const ref = fs.collection('tenants').doc(decoded.tenantId).collection('tenantMembers').doc(uid);
      const snap = await ref.get();
      const now = new Date().toISOString();
      await ref.set({
        role,
        email: targetUser.email || null,
        status: targetUser.disabled ? 'disabled' : 'active',
        createdAt: snap.exists ? snap.data().createdAt : now,
        updatedAt: now,
      }, { merge: true });
    } catch (memberErr) {
      // Non-fatal — the custom claim (which just succeeded above) is still
      // the primary access-control mechanism for reads and for every
      // server endpoint. A membership-doc sync failure here means Firestore
      // WRITE rules could lag behind this role change until it's retried,
      // which is logged for visibility rather than failing the whole request.
      console.error('set-role POST: tenantMembers sync failed', memberErr);
    }

    // Audit log — server-side privilege action (Session A, 19 Aug 2026).
    // Non-fatal: a failed audit write should never block the role change itself.
    try {
      const fs = admin.firestore(app);
      await writeAuditLog(fs, decoded.tenantId, {
        userId:    decoded.uid,
        userEmail: decoded.email,
        action:    `Changed role for ${targetUser.email || uid} from ${oldRole} to ${role}`,
      });
    } catch (auditErr) {
      console.error('set-role POST: audit log write failed', auditErr);
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('set-role POST: setCustomUserClaims failed', e);
    return res.status(500).json({ error: 'Could not update role' });
  }
};