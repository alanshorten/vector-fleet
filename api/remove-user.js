// TailiQ — Admin-only user removal
// DELETE /api/remove-user  { uid }  ->  { ok: true }
//
// Deletes a Firebase Auth user by UID. Admin-only — verified server-side
// via Firebase ID token custom claim. The admin account itself is protected
// and cannot be removed via this endpoint.

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
  res.setHeader('Access-Control-Allow-Methods', 'DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!idToken) return res.status(401).json({ error: 'Missing authentication token.' });

  let app;
  try {
    app = getApp();
  } catch (err) {
    console.error('remove-user: Firebase Admin init failed', err);
    return res.status(500).json({ error: 'Server configuration error.' });
  }

  let decoded;
  try {
    decoded = await admin.auth(app).verifyIdToken(idToken);
  } catch (err) {
    return res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
  }

  if (decoded.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const { uid } = req.body || {};
  if (!uid || typeof uid !== 'string') {
    return res.status(400).json({ error: 'A valid user UID is required.' });
  }

  // Prevent removing the currently signed-in admin
  if (uid === decoded.uid) {
    return res.status(400).json({ error: 'You cannot remove your own account.' });
  }

  try {
    const auth = admin.auth(app);
    const userRecord = await auth.getUser(uid);

    // Protect admin accounts from removal via this endpoint
    if (userRecord.customClaims && userRecord.customClaims.role === 'admin') {
      return res.status(403).json({ error: 'Admin accounts cannot be removed via this endpoint.' });
    }

    await auth.deleteUser(uid);
    console.log(`remove-user: deleted ${userRecord.email} (${uid}) by admin ${decoded.email}`);
    return res.status(200).json({ ok: true });
  } catch (err) {
    if (err.code === 'auth/user-not-found') {
      return res.status(404).json({ error: 'User not found.' });
    }
    console.error('remove-user: failed', err);
    return res.status(500).json({ error: 'Something went wrong removing the user. Please try again.' });
  }
};
