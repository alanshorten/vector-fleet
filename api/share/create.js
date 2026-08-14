// TailiQ — Server-side share token creation
// POST /api/share/create  { assetId, companyId, enginePos } -> { token, ...tokenData }
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

const admin = require('firebase-admin');
const crypto = require('crypto');

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
    console.error('share/create: Firebase Admin init failed', e);
    return res.status(500).json({ error: 'Server configuration error.' });
  }

  let decoded;
  try {
    decoded = await admin.auth(app).verifyIdToken(idToken);
  } catch (e) {
    return res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
  }

  if (!decoded.tenantId) {
    return res.status(403).json({ error: 'Your account is missing tenant access — try signing out and back in.' });
  }
  if (!['admin', 'editor'].includes(decoded.role)) {
    return res.status(403).json({ error: 'Admin or editor access required to create a share link.' });
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
      assetId: String(assetId),
      companyId: companyId || null,
      enginePos: enginePosClean,
      createdAt: now.toISOString(),
      expiresAt: expires.toISOString(),
      revoked: false,
      createdBy: decoded.email || decoded.uid || null,
    };

    await fs.collection('tenants').doc(decoded.tenantId).collection('shareTokens').doc(token).set(data);
    return res.status(200).json({ token, ...data });
  } catch (e) {
    console.error('share/create: failed', e);
    return res.status(500).json({ error: 'Failed to create share link: ' + e.message });
  }
};