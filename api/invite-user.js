// TailIQ — Admin-only user invite
// POST /api/invite-user  { email }  ->  { ok: true }
//
// Flow: Admin SDK creates the Firebase Auth user (no password set by us —
// the user chooses their own), generates a password-reset action link
// scoped to app.tailiq.app, and emails it via SendGrid using our own
// domain/branding rather than Firebase's generic hosted reset page.
//
// Trust model: this app has no real per-user role system yet (the "Admin"
// gate in index.html is a client-side PIN, not a Firebase custom claim —
// see TECH_DEBT). Matching the trust model already used everywhere else
// (Firestore rules: request.auth != null), this endpoint only requires the
// caller to be *any* signed-in user, verified server-side via their Firebase
// ID token. It does not yet enforce "admin" specifically — same limitation
// as the rest of the app today. Tightening this would need real custom
// claims, which is a separate piece of work, not bundled into this session.

const admin = require('firebase-admin');

const ALLOWED_ORIGINS = [
  'https://vector-fleet.vercel.app',
  'https://app.tailiq.app',
];

// Canonical domain for the link itself — independent of which origin the
// request came from, since the email is read wherever the recipient opens
// their inbox, not necessarily from the same browser tab that sent the invite.
const CONTINUE_URL = 'https://app.tailiq.app/?view=set-password';

const SENDER = 'TailIQ <invites@tailiq.app>';

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

function emailHTML(resetLink) {
  return `
  <div style="font-family:'Segoe UI',Arial,sans-serif;background:#0b1520;padding:32px;">
    <div style="max-width:480px;margin:0 auto;background:#111f30;border:1px solid #1e3048;border-radius:10px;overflow:hidden;">
      <div style="background:#0d1c2c;padding:24px 28px;">
        <span style="font-family:Arial,sans-serif;font-size:24px;font-weight:700;color:#ffffff;">TailIQ</span>
        <span style="font-family:Arial,sans-serif;font-size:13px;color:#7a9ab5;margin-left:10px;">Fleet Intelligence</span>
      </div>
      <div style="padding:28px;">
        <h1 style="color:#e2e8f0;font-size:18px;margin:0 0 14px;">You've been invited to TailIQ</h1>
        <p style="color:#94a3b8;font-size:14px;line-height:1.6;margin:0 0 22px;">
          An administrator has set up an account for you on TailIQ, the fleet intelligence platform.
          Click below to choose your password and get started.
        </p>
        <a href="${resetLink}" style="display:inline-block;background:#C9A84C;color:#0a1520;text-decoration:none;
          font-weight:700;font-size:14px;padding:12px 22px;border-radius:6px;">Set your password</a>
        <p style="color:#5a7a9a;font-size:12px;margin-top:24px;">
          If you weren't expecting this invitation, you can safely ignore this email.
        </p>
      </div>
    </div>
  </div>`;
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
  if (!idToken) {
    return res.status(401).json({ error: 'Missing authentication token.' });
  }

  let app;
  try {
    app = getApp();
  } catch (err) {
    console.error('invite-user: Firebase Admin init failed', err);
    return res.status(500).json({ error: 'Server configuration error.' });
  }

  try {
    // Confirms the caller is a genuinely signed-in TailIQ user. See trust
    // model note in the file header re: no per-role enforcement yet.
    await admin.auth(app).verifyIdToken(idToken);
  } catch (err) {
    return res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
  }

  const { email } = req.body || {};
  if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'A valid email address is required.' });
  }
  const normalizedEmail = email.trim().toLowerCase();

  if (!process.env.SENDGRID_API_KEY) {
    console.error('invite-user: SENDGRID_API_KEY is not set');
    return res.status(500).json({ error: 'Email sending is not configured. Contact the developer.' });
  }

  try {
    const auth = admin.auth(app);

    // Create the user with no password — they choose their own via the
    // reset link. A random throwaway password is required by the Admin SDK
    // API itself but is never shared with anyone or stored by us.
    try {
      await auth.createUser({ email: normalizedEmail, emailVerified: false });
    } catch (err) {
      if (err.code === 'auth/email-already-exists') {
        return res.status(409).json({ error: 'A user with this email already exists.' });
      }
      throw err;
    }

    const resetLink = await auth.generatePasswordResetLink(normalizedEmail, {
      url: CONTINUE_URL,
    });

    const sgResp = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.SENDGRID_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: normalizedEmail }] }],
        from: { email: 'invites@tailiq.app', name: 'TailIQ' },
        subject: "You've been invited to TailIQ",
        content: [{ type: 'text/html', value: emailHTML(resetLink) }],
      }),
    });

    if (!sgResp.ok) {
      const errText = await sgResp.text();
      console.error('invite-user: SendGrid send failed', sgResp.status, errText);
      // User account now exists in Firebase Auth even though the email
      // failed — surface this clearly rather than pretending it worked.
      return res.status(502).json({
        error: 'The account was created but the invite email could not be sent. Check SendGrid configuration, or share this link with them directly: ' + resetLink,
      });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('invite-user: failed', err);
    return res.status(500).json({ error: 'Something went wrong creating the invite. Please try again.' });
  }
};
