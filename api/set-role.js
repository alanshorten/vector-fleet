// TailiQ — Role management (Admin only)
// GET  /api/set-role  -> { users: [{uid, email, role}] }
// POST /api/set-role  { uid, role } -> { ok: true }
//
// Caller must be a signed-in user with role=admin custom claim.
// Role may only be set to 'editor', 'viewer', or 'dataEntry' via this
// endpoint — admin role is bootstrap-only (see /api/bootstrap-admin).

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
    decoded = await admin.auth(app).verifyIdToken(idToken);
  } catch (e) {
    return res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
  }

  // Enforce admin-only access
  if (decoded.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const auth = admin.auth(app);

  // GET — list all users with their role claims
  if (req.method === 'GET') {
    try {
      const listResult = await auth.listUsers(1000);
      const users = listResult.users.map(u => ({
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
    await auth.setCustomUserClaims(uid, { role });
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('set-role POST: setCustomUserClaims failed', e);
    return res.status(500).json({ error: 'Could not update role' });
  }
};
