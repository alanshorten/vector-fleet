// TailiQ — public share-link lookup
// GET /api/share/{token}  ->  { asset: {...allowlisted fields...} }
//
// Unauthenticated by design (this is what makes a share link work for
// someone with no TailiQ login), so it must fail closed on anything
// that isn't a valid, unexpired, unrevoked token, and it must never
// return a field that isn't explicitly allowlisted below. Financial
// fields (Layer 2 — leaseData, reserveRates, reserveBalances, etc.)
// are never queried here, let alone allowlisted.

const admin = require('firebase-admin');

// Allow both the legacy Vercel URL and the new tailiq.app domain while
// we're mid-transition. Drop the .vercel.app entry in a future cleanup
// session once app.tailiq.app is confirmed solid for everything.
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
  'specs', 'checks', 'photos', 'disclaimer', '_lastPeriod', 'prospectKind'
];

function pickAllowed(asset) {
  const out = {};
  for (const key of ALLOWED_FIELDS) {
    if (asset[key] !== undefined) out[key] = asset[key];
  }
  return out;
}

module.exports = async (req, res) => {
  // Public endpoint, but still locked to our own domain(s) — a share link
  // is opened directly by the recipient's browser, not called cross-origin
  // from a third-party site.
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
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

    // The fleet-wide default disclaimer (Admin → Settings) is not asset
    // data, so it doesn't go through ALLOWED_FIELDS/pickAllowed — it's a
    // single non-sensitive string fetched and returned alongside the asset.
    let defaultDisclaimer = null;
    try {
      const settingSnap = await fs.collection('settings').doc('default_disclaimer').get();
      if (settingSnap.exists) defaultDisclaimer = settingSnap.data().value || null;
    } catch (e) {
      // Non-fatal — the tech spec builder falls back to its own hardcoded
      // wording if this comes back null, so a settings-fetch failure
      // should never break the share link itself.
    }

    return res.status(200).json({ asset: pickAllowed(asset), defaultDisclaimer });
  } catch (err) {
    console.error('share token lookup failed', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};
