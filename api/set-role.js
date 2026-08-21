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

    // M-02 fix: this used to write the Auth custom claim FIRST and treat
    // the tenantMembers sync as non-fatal afterwards. Firestore WRITE
    // rules consult the tenantMembers doc's role, not the token claim
    // (see memberHasRole() in firestore.rules) — so a failed sync left the
    // user's PREVIOUS, higher role live in the one place that actually
    // gates writes, for as long as the sync stayed broken, with the claim
    // change and even the revoked refresh token doing nothing to close
    // that gap. Order is now flipped: write tenantMembers to the NEW
    // (lower/target) role first and require it to succeed — that's the
    // change that actually reduces write access — before touching Auth at
    // all. If this fails, the request aborts here: the user keeps their
    // old role everywhere (claim untouched, membership doc untouched), a
    // safe, consistent failure rather than a partial downgrade with a
    // stale-but-more-privileged membership doc.
    const fs = admin.firestore(app);
    const memberRef = fs.collection('tenants').doc(decoded.tenantId).collection('tenantMembers').doc(uid);
    const memberSnap = await memberRef.get();
    const nowIso = new Date().toISOString();
    await memberRef.set({
      role,
      email: targetUser.email || null,
      status: targetUser.disabled ? 'disabled' : 'active',
      createdAt: memberSnap.exists ? memberSnap.data().createdAt : nowIso,
      updatedAt: nowIso,
    }, { merge: true });

    // Membership state (the actual write-access gate) is now downgraded
    // and committed. Auth claim + token revocation follow — if either of
    // these fails partway, the worst case is a stale but MORE restrictive
    // claim/token than the membership doc, which is the safe direction to
    // fail in (never the reverse).
    // security review 20260820, F-05: setCustomUserClaims and
    // revokeRefreshTokens used to live in the SAME try block, so a claims
    // failure meant revocation was never even attempted — the old,
    // still-valid (not-revoked) token then kept working against every
    // endpoint that authorizes off decoded.role directly (share/create.js,
    // share/revoke.js, invite-user.js, this file's own admin-only gate)
    // for up to ~1hr, since nothing forced re-authentication. Each step
    // now gets its own independent attempt: revocation is always tried,
    // even when the claim write failed, so a live session is cut as soon
    // as possible regardless of which half of this succeeded. This does
    // NOT fix a failed claim write on its own — the Auth record still
    // carries the OLD role until an operator retries this endpoint for
    // this uid — but it removes the window where an un-revoked token with
    // the old role keeps authorizing API calls in the meantime.
    let claimErr = null;
    try {
      await auth.setCustomUserClaims(uid, { role, tenantId: decoded.tenantId });
    } catch (e) {
      claimErr = e;
      console.error('set-role POST: Auth claim update failed after tenantMembers was already downgraded — operator should retry for this uid', { uid, tenantId: decoded.tenantId, targetRole: role, err: e });
    }

    let revokeErr = null;
    try {
      // Revoke existing refresh tokens so the change takes effect promptly
      // — without this, a signed-in user's cached ID token (and the role
      // claim baked into it) stays valid for up to an hour regardless of
      // what an admin just changed. The client periodically force-refreshes
      // its token and detects/reacts to this revocation (see App.jsx).
      // Attempted even if the claim update above failed (see comment above).
      await auth.revokeRefreshTokens(uid);
    } catch (e) {
      revokeErr = e;
      console.error('set-role POST: revokeRefreshTokens failed — old token may remain valid until natural expiry, operator should retry for this uid', { uid, err: e });
    }

    // Audit log — server-side privilege action (Session A, 19 Aug 2026).
    // Non-fatal: a failed audit write should never block the role change itself.
    try {
      const fs = admin.firestore(app);
      await writeAuditLog(fs, decoded.tenantId, {
        userId:    decoded.uid,
        userEmail: decoded.email,
        action:    `Changed role for ${targetUser.email || uid} from ${oldRole} to ${role}${(claimErr || revokeErr) ? ' (partial: see server logs)' : ''}`,
      });
    } catch (auditErr) {
      console.error('set-role POST: audit log write failed', auditErr);
    }

    if (claimErr || revokeErr) {
      // Firestore write access is already correctly downgraded (the step
      // above this block, unconditional). Surface the partial failure so
      // an operator knows to check logs and retry, rather than assuming
      // full cleanup happened.
      return res.status(200).json({ ok: true, warning: 'Role was updated for data access, but the account session/claim update did not fully complete. Check server logs.' });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('set-role POST: setCustomUserClaims failed', e);
    return res.status(500).json({ error: 'Could not update role' });
  }
};