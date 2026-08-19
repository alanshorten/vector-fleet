// TailiQ — Server-side share token creation + listing
// POST /api/share/create  { assetId, companyId, enginePos } -> { token, ...tokenData }
// GET  /api/share/create?assetId={id}                       -> { tokens: [...] }
//
// security-remediation-roadmap.md Phase 3, Session 5 (3B / H-02).
//
// Problem this closes: browsers previously wrote directly to the
// `shareTokens` collection via the client Firestore SDK — any authenticated
// user (including Viewer/DataEntry, who have no business creating a
// customer-facing share link) could create a share for any asset,
// including one belonging to another tenant. This endpoint moves creation
// server-side, gated on role and on the asset actually existing in the
// caller's own tenant, and the tenantId itself is resolved from the
// caller's verified token — never from client input.
//
// Firestore rules (deployed alongside this file) now deny all direct
// client writes to tenants/{tenantId}/shareTokens — this endpoint (Admin
// SDK, bypasses rules) is the only write path left.
//
// M-03 fix (19 Aug 2026 security review) folded the listing endpoint into
// THIS file rather than a separate api/share/list.js — Vercel's Hobby plan
// caps a deployment at 12 serverless functions, and this repo was already
// sitting at exactly 12 before that endpoint was added (see git history /
// the deploy failure this fix responds to). GET and POST share the same
// auth boilerplate (verify token, check tenantId/role) anyway, so folding
// list into create costs nothing but a req.method branch.
//
// GET (list): previously the ShareModal UI (AssetView.jsx) read
// tenants/{tenantId}/shareTokens directly via the client Firestore SDK,
// and firestore.rules allowed that to any signed-in admin/editor/viewer in
// the tenant. shareTokens documents ARE the plaintext bearer credential
// (the doc holds the same token used in the public share URL), so that
// rule let any Viewer copy every other user's active share links for an
// asset, not just their own. firestore.rules now denies ALL direct client
// reads on shareTokens — this endpoint (Admin SDK) is the only read path
// left, and it re-verifies with checkRevoked=true AND checks LIVE
// tenantMembers status on every call (not just the token claim), closing
// the stale-token window for reads the same way M-02 closed it for
// writes. Who's allowed to see tokens is unchanged (admin/editor/viewer,
// matching AssetView.jsx's canSeeAdvanced gate) — a Viewer can still
// list/copy tokens created by someone else, which is existing product
// behaviour (Viewers use share links, not just admins/editors), not a new
// hole this introduces.

const admin = require('firebase-admin');
const crypto = require('crypto');
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!idToken) return res.status(401).json({ error: 'Missing authentication token.' });

  let app;
  try { app = getApp(); } catch (e) {
    console.error('share/create: Firebase Admin init failed', e);
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

  // ---- GET: list tokens for an asset (M-03 fix) ----------------------------
  if (req.method === 'GET') {
    if (!['admin', 'editor', 'viewer'].includes(decoded.role)) {
      return res.status(403).json({ error: 'Access required to view share links.' });
    }
    const { assetId: listAssetId } = req.query || {};
    if (!listAssetId || Array.isArray(listAssetId)) {
      return res.status(400).json({ error: 'assetId is required.' });
    }
    const fs = admin.firestore(app);
    // Live membership check (not just the token claim) — a role/status
    // change made moments ago via set-role.js/remove-user.js is immediately
    // visible here, same as it is to Firestore write rules via
    // memberHasRole(), rather than waiting on this caller's token to expire
    // or be force-refreshed.
    try {
      const memberSnap = await fs.collection('tenants').doc(decoded.tenantId).collection('tenantMembers').doc(decoded.uid).get();
      if (!memberSnap.exists || memberSnap.data()?.status !== 'active') {
        return res.status(403).json({ error: 'Your account no longer has active access to this tenant.' });
      }
    } catch (e) {
      console.error('share/list: membership check failed', e);
      return res.status(500).json({ error: 'Could not verify access.' });
    }
    try {
      const snap = await fs.collection('tenants').doc(decoded.tenantId).collection('shareTokens')
        .where('assetId', '==', String(listAssetId)).get();
      const tokens = snap.docs.map((d) => ({ token: d.id, ...d.data() }));
      return res.status(200).json({ tokens });
    } catch (e) {
      console.error('share/list: query failed', e);
      return res.status(500).json({ error: 'Could not load share links.' });
    }
  }

  // ---- POST: create a token (unchanged from before) -------------------------
  if (!['admin', 'editor'].includes(decoded.role)) {
    return res.status(403).json({ error: 'Admin or editor access required to create a share link.' });
  }
  try {
    const callerRecord = await admin.auth(app).getUser(decoded.uid);
    if (callerRecord.disabled) {
      return res.status(403).json({ error: 'Your account has been disabled. Contact an admin.' });
    }
  } catch (e) {
    return res.status(401).json({ error: 'Your account could not be verified. Please sign in again.' });
  }

  const { assetId, companyId, enginePos } = req.body || {};
  if (!assetId || (typeof assetId !== 'string' && typeof assetId !== 'number')) {
    return res.status(400).json({ error: 'assetId is required.' });
  }
  const enginePosClean = enginePos === 1 || enginePos === 2 ? enginePos : null;

  try {
    const fs = admin.firestore(app);

    // Ownership check — the asset must actually exist under the caller's
    // own tenant. This is what stops a signed-in user in one tenant from
    // creating a share link for another tenant's asset by guessing an ID.
    const assetSnap = await fs.collection('tenants').doc(decoded.tenantId).collection('assets').doc(String(assetId)).get();
    if (!assetSnap.exists) {
      return res.status(404).json({ error: 'Asset not found.' });
    }

    const token = crypto.randomUUID().replace(/-/g, '');
    const now = new Date();
    const expires = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7-day default, same as before
    const data = {
      // Build Group A (19 Aug 2026): the token is also stored as a field,
      // not just the document ID — api/share/[token].js (the public,
      // unauthenticated resolver) no longer knows which tenant to look in
      // ahead of time now that tenant IDs aren't a single hardcoded
      // constant, so it finds the token via a collectionGroup('shareTokens')
      // query, which can only filter on field values, not document ID.
      token,
      assetId: String(assetId),
      companyId: companyId || null,
      enginePos: enginePosClean,
      createdAt: now.toISOString(),
      expiresAt: expires.toISOString(),
      revoked: false,
      createdBy: decoded.email || decoded.uid || null,
    };

    await fs.collection('tenants').doc(decoded.tenantId).collection('shareTokens').doc(token).set(data);

    // Audit log — server-side privilege action (Session A, 19 Aug 2026).
    // Non-fatal: a failed audit write should never block the share creation.
    try {
      const actionParts = [`Created share link for asset ${assetId}`];
      if (enginePosClean) actionParts[0] += ` engine ${enginePosClean}`;
      await writeAuditLog(fs, decoded.tenantId, {
        userId:    decoded.uid,
        userEmail: decoded.email,
        assetId:   String(assetId),
        action:    actionParts[0],
      });
    } catch (auditErr) {
      console.error('share/create: audit log write failed', auditErr);
    }

    return res.status(200).json({ token, ...data });
  } catch (e) {
    console.error('share/create: failed', e);
    return res.status(500).json({ error: 'Failed to create share link: ' + e.message });
  }
};