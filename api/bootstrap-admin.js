// TailiQ — Admin bootstrap
// POST /api/bootstrap-admin  (Bearer token required)
//
// Called once automatically after sign-in when the user has no role claim yet.
// Checks whether the signed-in user's email matches the ADMIN_EMAIL env var.
// If it matches, sets role=admin custom claim. Safe to call on every sign-in —
// it is a no-op if the user already has a role claim, or if their email doesn't
// match ADMIN_EMAIL.
//
// Admin role can ONLY be granted this way (env var match). It cannot be set
// via the /api/set-role endpoint — that endpoint handles editor/viewer only.

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

  // Already has a role — nothing to do
  if (decoded.role) return res.status(200).json({ ok: true, role: decoded.role });

  // Email doesn't match — not the bootstrap admin
  if ((decoded.email || '').toLowerCase() !== adminEmail) {
    return res.status(200).json({ ok: true, role: null });
  }

  // Email matches — promote to admin
  try {
    await admin.auth(app).setCustomUserClaims(decoded.uid, { role: 'admin' });
    return res.status(200).json({ ok: true, role: 'admin' });
  } catch (e) {
    console.error('bootstrap-admin: setCustomUserClaims failed', e);
    return res.status(500).json({ error: 'Could not set admin claim' });
  }
};
