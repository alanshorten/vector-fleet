// TailiQ — Server-side share token listing
// GET /api/share/list?assetId={id}  ->  { tokens: [...] }
//
// M-03 fix. Companion to api/share/create.js and api/share/revoke.js — see
// create.js's header for the shared rationale on why these moved
// server-side. Previously the ShareModal UI (AssetView.jsx) read
// tenants/{tenantId}/shareTokens directly via the client Firestore SDK,
// and firestore.rules allowed that read to any signed-in admin/editor/
// viewer in the tenant. shareTokens documents ARE the plaintext bearer
// credential (the doc holds the same token used in the public share URL),
// so that rule let any Viewer copy every other user's active share links
// for an asset, not just their own — expanding public-share access beyond
// the creator's intent, and letting a Viewer retain a working external
// credential after their own account was later disabled or downgraded
// (a stale cached ID token can keep passing a rules-based check for up to
// its ~1h lifetime; this endpoint instead re-verifies with
// checkRevoked=true AND checks the LIVE tenantMembers status on every
// call, closing that gap for the read path the same way M-02 closed it
// for writes).
//
// firestore.rules now denies ALL direct client reads on shareTokens (see
// that file) — this endpoint, using the Admin SDK, is the only read path
// left. Any active tenant member (admin/editor/viewer — matches who the
// ShareModal UI is shown to today, see AssetView.jsx's canSeeAdvanced
// gate) can still list/copy tokens for an asset in their own tenant,
// including ones created by someone else — that's the existing product
// behaviour (a Viewer can use, not just create, share links) and this fix
// doesn't change who's allowed to see them, only how the read happens and
// that it's actually enforced server-side against live state instead of a
// Firestore rule matching on a possibly-stale token claim.

const admin = require('firebase-admin');

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
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!idToken) return res.status(401).json({ error: 'Missing authentication token.' });

  let app;
  try { app = getApp(); } catch (e) {
    console.error('share/list: Firebase Admin init failed', e);
    return res.status(500).json({ error: 'Server configuration error.' });
  }

  let decoded;
  try {
    decoded = await admin.auth(app).verifyIdToken(idToken, true);
  } catch (e) {
    return res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
  }

  if (!decoded.tenantId) {
    return res.status(403).json({ error: 'Your account is missing tenant access — try signing out and back in.' });
  }
  if (!['admin', 'editor', 'viewer'].includes(decoded.role)) {
    return res.status(403).json({ error: 'Access required to view share links.' });
  }

  const { assetId } = req.query || {};
  if (!assetId || Array.isArray(assetId)) {
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
      .where('assetId', '==', String(assetId)).get();
    const tokens = snap.docs.map((d) => ({ token: d.id, ...d.data() }));
    return res.status(200).json({ tokens });
  } catch (e) {
    console.error('share/list: query failed', e);
    return res.status(500).json({ error: 'Could not load share links.' });
  }
};