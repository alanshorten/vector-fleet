// TailiQ — Server-side share token revocation
// POST /api/share/revoke  { token } -> { ok: true }
//
// security-remediation-roadmap.md Phase 3, Session 5 (3B / H-02).
// Companion to api/share/create.js — see that file's header for the full
// rationale. Revocation is gated the same way: role check plus an
// ownership check that the token actually belongs to the caller's own
// tenant, resolved from the caller's verified token claim, never from
// client input.

const admin = require('firebase-admin');
const { writeAuditLog } = require('../_lib/auditLog');

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
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!idToken) return res.status(401).json({ error: 'Missing authentication token.' });

  let app;
  try { app = getApp(); } catch (e) {
    console.error('share/revoke: Firebase Admin init failed', e);
    return res.status(500).json({ error: 'Server configuration error.' });
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

  if (!decoded.tenantId) {
    return res.status(403).json({ error: 'Your account is missing tenant access — try signing out and back in.' });
  }
  if (!['admin', 'editor'].includes(decoded.role)) {
    return res.status(403).json({ error: 'Admin or editor access required to revoke a share link.' });
  }
  try {
    const callerRecord = await admin.auth(app).getUser(decoded.uid);
    if (callerRecord.disabled) {
      return res.status(403).json({ error: 'Your account has been disabled. Contact an admin.' });
    }
  } catch (e) {
    return res.status(401).json({ error: 'Your account could not be verified. Please sign in again.' });
  }

  const { token } = req.body || {};
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'token is required.' });
  }

  try {
    const fs = admin.firestore(app);
    const ref = fs.collection('tenants').doc(decoded.tenantId).collection('shareTokens').doc(token);
    const snap = await ref.get();
    if (!snap.exists) {
      // Token belonging to this tenant not found — either already gone or
      // never existed here. Treat as success either way (idempotent revoke,
      // same as the client-side version this replaces), rather than leaking
      // whether a token exists under a different tenant.
      return res.status(200).json({ ok: true });
    }
    const tokenData = snap.data();
    await ref.set({ ...tokenData, revoked: true });

    // Audit log — server-side privilege action (Session A, 19 Aug 2026).
    // Non-fatal: a failed audit write should never block the revocation.
    try {
      await writeAuditLog(fs, decoded.tenantId, {
        userId:    decoded.uid,
        userEmail: decoded.email,
        assetId:   tokenData.assetId || null,
        action:    `Revoked share link for asset ${tokenData.assetId || 'unknown'}`,
      });
    } catch (auditErr) {
      console.error('share/revoke: audit log write failed', auditErr);
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    // SR-04 (TailiQ_Security_Release_Assessment_20260824.docx): don't leak
    // e.message to the client — see api/share/create.js's matching catch
    // block for the full rationale. Full detail stays server-side, tagged
    // with a correlation ID the client can quote back for support.
    const correlationId = require('crypto').randomUUID();
    console.error(`share/revoke: failed [${correlationId}]`, e);
    return res.status(500).json({ error: 'Could not revoke share link.', correlationId });
  }
};