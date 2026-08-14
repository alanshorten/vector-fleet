// TailiQ — Admin bootstrap
// POST /api/bootstrap-admin  (Bearer token required)
//
// Called automatically after sign-in whenever the user is missing a role
// claim OR a tenantId claim. Checks whether the signed-in user's email
// matches the ADMIN_EMAIL env var (for role); backfills tenantId
// unconditionally for anyone missing it, regardless of role. Safe to call
// on every sign-in — it is a no-op if the user already has both claims.
//
// Admin role can ONLY be granted this way (env var match). It cannot be set
// via the /api/set-role endpoint — that endpoint handles editor/viewer only.
//
// security-remediation-roadmap.md Phase 3 (tenant isolation), Session 1:
// TENANT_ID is hardcoded because TailiQ is single-tenant today (Maverick
// Horizon only) — every user gets the same tenantId claim. This is what
// lets pre-Phase-3 accounts (already signed in, already have a role claim)
// pick up tenantId without an admin having to manually touch every user via
// /api/set-role. Once a second tenant is onboarded, this endpoint's job
// changes from "stamp the one tenant" to "resolve which tenant this invite/
// signup belongs to" — tracked as a follow-up, not solved here.
const TENANT_ID = 'maverick';

const admin = require('firebase-admin');

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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!idToken) return res.status(401).json({ error: 'Missing token' });

  const adminEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  if (!adminEmail) return res.status(500).json({ error: 'ADMIN_EMAIL not configured' });

  let app;
  try { app = getApp(); } catch (e) {
    return res.status(500).json({ error: 'Server configuration error' });
  }

  let decoded;
  try {
    decoded = await admin.auth(app).verifyIdToken(idToken);
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  // Already fully provisioned (role + tenantId) — nothing to do.
  if (decoded.role && decoded.tenantId) {
    return res.status(200).json({ ok: true, role: decoded.role, tenantId: decoded.tenantId });
  }

  // Has a role already but is missing tenantId — a pre-Phase-3 account.
  // Backfill tenantId without touching their existing role. This is the
  // path that lets already-provisioned users (including existing admins)
  // pick up tenantId just by reloading the app once after this deploys.
  if (decoded.role && !decoded.tenantId) {
    try {
      await admin.auth(app).setCustomUserClaims(decoded.uid, { role: decoded.role, tenantId: TENANT_ID });
      return res.status(200).json({ ok: true, role: decoded.role, tenantId: TENANT_ID });
    } catch (e) {
      console.error('bootstrap-admin: tenantId backfill failed', e);
      return res.status(500).json({ error: 'Could not backfill tenant access' });
    }
  }

  // No role yet. Email doesn't match — not the bootstrap admin, and not
  // provisioned by an invite either (invite-user.js stamps both role and
  // tenantId at invite time — see that file). Nothing to do here.
  if ((decoded.email || '').toLowerCase() !== adminEmail) {
    return res.status(200).json({ ok: true, role: null, tenantId: null });
  }

  // Email matches — promote to admin and stamp tenantId in the same call.
  try {
    await admin.auth(app).setCustomUserClaims(decoded.uid, { role: 'admin', tenantId: TENANT_ID });
    return res.status(200).json({ ok: true, role: 'admin', tenantId: TENANT_ID });
  } catch (e) {
    console.error('bootstrap-admin: setCustomUserClaims failed', e);
    return res.status(500).json({ error: 'Could not set admin claim' });
  }
};