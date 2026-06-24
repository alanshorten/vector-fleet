// VectorIQ — public share-link lookup
// GET /api/share/{token}  ->  { asset: {...allowlisted fields...} }
//
// Unauthenticated by design (this is what makes a share link work for
// someone with no VectorIQ login), so it must fail closed on anything
// that isn't a valid, unexpired, unrevoked token, and it must never
// return a field that isn't explicitly allowlisted below. Financial
// fields (Layer 2 — leaseData, reserveRates, reserveBalances, etc.)
// are never queried here, let alone allowlisted.

const admin = require('firebase-admin');

function getApp() {
  if (admin.apps.length) return admin.app();
  return admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // Vercel env vars store literal "\n" — convert back to real newlines.
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    }),
  });
}

// Only these top-level asset fields ever leave Firestore via this endpoint.
// This is the tech-spec-safe set — same data already visible on the
// printable tech spec PDF. Nothing else, even if present on the asset
// document, is returned.
const ALLOWED_FIELDS = [
  'id', 'msn', 'registration', 'model', 'manufacturer', 'operator', 'dom',
  'airframe', 'engines', 'apu', 'landingGear', 'wheelsBrakes', 'weights',
  'specs', 'checks', 'photos', 'disclaimer', '_lastPeriod'
];

function pickAllowed(asset) {
  const out = {};
  for (const key of ALLOWED_FIELDS) {
    if (asset[key] !== undefined) out[key] = asset[key];
  }
  return out;
}

module.exports = async (req, res) => {
  // Public endpoint, but still locked to our own domain — a share link is
  // opened directly by the recipient's browser, not called cross-origin
  // from a third-party site.
  res.setHeader('Access-Control-Allow-Origin', 'https://vector-fleet.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { token } = req.query;
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'Missing token' });
  }

  try {
    const app = getApp();
    const fs = admin.firestore(app);

    const tokenSnap = await fs.collection('shareTokens').doc(token).get();
    if (!tokenSnap.exists) {
      return res.status(404).json({ error: 'Link not found' });
    }
    const tokenData = tokenSnap.data();

    if (tokenData.revoked) {
      return res.status(410).json({ error: 'This link has been revoked' });
    }
    const expiresAt = tokenData.expiresAt ? new Date(tokenData.expiresAt) : null;
    if (!expiresAt || expiresAt.getTime() < Date.now()) {
      return res.status(410).json({ error: 'This link has expired' });
    }
    if (!tokenData.assetId) {
      return res.status(404).json({ error: 'Link not found' });
    }

    const assetSnap = await fs.collection('assets').doc(String(tokenData.assetId)).get();
    if (!assetSnap.exists) {
      return res.status(404).json({ error: 'Asset not found' });
    }
    const asset = { id: assetSnap.id, ...assetSnap.data() };

    return res.status(200).json({ asset: pickAllowed(asset) });
  } catch (err) {
    console.error('share token lookup failed', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};
