// TailiQ — Platform: Create Tenant
// POST /api/create-tenant  { tenantName, tenantSlug, adminEmail, approvedSenders } -> { ok: true, ... }
//
// Replaces api/bootstrap-admin.js's "first user wins" self-registration race
// as the way a new tenant's first admin account gets created. Gated on a
// platform-level superAdmin custom claim — separate from, and above, the
// existing four-role tenant-scoped model (admin/editor/viewer/dataEntry).
// The first super-admin is set manually via the Firebase console; see
// claude_security-review-20260818-handoff.md (Build Group A) for the full
// design.
//
// tenantSlug doubles as the tenantId used everywhere else in the app
// (custom claims, tenant-rooted Firestore paths, and — going forward —
// api/email-ingest.js's recipient-to-tenant resolution).

const admin = require('firebase-admin');

const ALLOWED_ORIGINS = [
  'https://vector-fleet.vercel.app',
  'https://app.tailiq.app',
];

const CONTINUE_URL = 'https://app.tailiq.app/?view=set-password';

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

// Lowercase letters, digits, hyphens; 1-40 chars, no leading/trailing hyphen.
// This becomes both the Firestore doc ID (tenants/{slug}) and the tenantId
// custom claim, so it needs to be URL/path-safe and stable.
const SLUG_RE = /^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function emailHTML(resetLink, tenantName) {
  return `
  <div style="font-family:'Segoe UI',Arial,sans-serif;background:#0b1520;padding:32px;">
    <div style="max-width:480px;margin:0 auto;background:#111f30;border:1px solid #1e3048;border-radius:10px;overflow:hidden;">
      <div style="background:#0d1c2c;padding:24px 28px;">
        <span style="font-family:Arial,sans-serif;font-size:24px;font-weight:700;color:#ffffff;">TailiQ</span>
        <span style="font-family:Arial,sans-serif;font-size:13px;color:#7a9ab5;margin-left:10px;">Fleet Intelligence</span>
      </div>
      <div style="padding:28px;">
        <h1 style="color:#e2e8f0;font-size:18px;margin:0 0 14px;">Welcome to TailiQ</h1>
        <p style="color:#94a3b8;font-size:14px;line-height:1.6;margin:0 0 12px;">
          An account has been set up for you as the administrator for <strong>${tenantName}</strong> on TailiQ, the fleet intelligence platform.
          Click below to choose your password and get started.
        </p>
        <a href="${resetLink}" style="display:inline-block;background:#C9A84C;color:#0a1520;text-decoration:none;
          font-weight:700;font-size:14px;padding:12px 22px;border-radius:6px;">Set your password</a>
        <p style="color:#5a7a9a;font-size:12px;margin-top:20px;line-height:1.5;">
          If the button doesn't work, copy and paste this link into your browser:<br>
          <a href="${resetLink}" style="color:#7a9ab5;word-break:break-all;">${resetLink}</a>
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
  if (!idToken) return res.status(401).json({ error: 'Missing authentication token.' });

  let app;
  try { app = getApp(); } catch (e) {
    console.error('create-tenant: Firebase Admin init failed', e);
    return res.status(500).json({ error: 'Server configuration error.' });
  }

  let decoded;
  try {
    // Same posture as every other privileged endpoint (Phase 3 Session 6,
    // 3C / M-01, Layer 1): checkRevoked=true rejects a token invalidated by
    // a prior revokeRefreshTokens() call.
    decoded = await admin.auth(app).verifyIdToken(idToken, true);
  } catch (e) {
    return res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
  }

  // Platform-level gate — separate from and above the tenant-scoped role
  // model. Only an account with superAdmin:true (set manually via the
  // Firebase console) can provision a new tenant. A tenant admin — even one
  // with role:'admin' for their own tenant — cannot call this.
  if (decoded.superAdmin !== true) {
    return res.status(403).json({ error: 'Super-admin access required.' });
  }

  try {
    const callerRecord = await admin.auth(app).getUser(decoded.uid);
    if (callerRecord.disabled) {
      return res.status(403).json({ error: 'Your account has been disabled.' });
    }
  } catch (e) {
    return res.status(401).json({ error: 'Your account could not be verified. Please sign in again.' });
  }

  const { tenantName, tenantSlug, adminEmail, approvedSenders } = req.body || {};

  if (!tenantName || typeof tenantName !== 'string' || !tenantName.trim()) {
    return res.status(400).json({ error: 'tenantName is required.' });
  }
  const slug = (tenantSlug || '').trim().toLowerCase();
  if (!SLUG_RE.test(slug)) {
    return res.status(400).json({ error: 'tenantSlug must be lowercase letters, digits, and hyphens only (1-40 characters, no leading/trailing hyphen).' });
  }
  if (!adminEmail || typeof adminEmail !== 'string' || !EMAIL_RE.test(adminEmail)) {
    return res.status(400).json({ error: 'A valid adminEmail is required.' });
  }
  const normalizedEmail = adminEmail.trim().toLowerCase();

  const senders = [];
  if (approvedSenders != null) {
    if (!Array.isArray(approvedSenders)) {
      return res.status(400).json({ error: 'approvedSenders must be an array.' });
    }
    for (const s of approvedSenders) {
      if (!s || (s.type !== 'domain' && s.type !== 'email') || !s.value || typeof s.value !== 'string' || !s.value.trim()) {
        return res.status(400).json({ error: 'Each approvedSenders entry needs a type ("domain" or "email") and a non-empty value.' });
      }
      senders.push({ type: s.type, value: s.value.trim().toLowerCase() });
    }
  }

  const fs = admin.firestore(app);
  const auth = admin.auth(app);
  const tenantRef = fs.collection('tenants').doc(slug);

  try {
    const existing = await tenantRef.get();
    if (existing.exists) {
      return res.status(409).json({ error: `A tenant with slug "${slug}" already exists.` });
    }
  } catch (e) {
    console.error('create-tenant: tenant existence check failed', e);
    return res.status(500).json({ error: 'Could not verify tenant slug availability.' });
  }

  let newUser;
  let createdAuthAccount = false;
  try {
    try {
      newUser = await auth.createUser({ email: normalizedEmail, emailVerified: false });
      createdAuthAccount = true;
    } catch (err) {
      if (err.code === 'auth/email-already-exists') {
        return res.status(409).json({ error: 'An account already exists for this email address. Choose a different admin email.' });
      }
      throw err;
    }

    // Tenant doc, admin claims, tenantMembers doc, and approvedSenders seed
    // — spans Auth + Firestore, so this can't be one atomic transaction.
    // A mid-way failure is handled by the cleanup in the catch block below
    // rather than true atomicity.
    const now = new Date().toISOString();
    await tenantRef.set({
      name: tenantName.trim(),
      slug,
      status: 'active',
      createdAt: now,
      createdBy: decoded.uid,
    });

    await auth.setCustomUserClaims(newUser.uid, { role: 'admin', tenantId: slug });

    // Phase 3 Session 6 (3C / M-01, Layer 2, Decision 2) pattern — keep the
    // tenantMembers membership doc in sync, same shape every other
    // privileged endpoint writes.
    await fs.collection('tenants').doc(slug).collection('tenantMembers').doc(newUser.uid).set({
      role: 'admin',
      email: normalizedEmail,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });

    if (senders.length) {
      const batch = fs.batch();
      senders.forEach((s) => {
        const ref = fs.collection('tenants').doc(slug).collection('approvedSenders').doc();
        batch.set(ref, { type: s.type, value: s.value, addedBy: decoded.uid, addedAt: now });
      });
      await batch.commit();
    }

    // Password-reset link, same generation pattern as invite-user.js. Unlike
    // that endpoint, the link is included in this response as a fallback —
    // the caller here is a trusted super-admin doing first-time setup, not
    // the account owner, so there's no account-takeover exposure the way
    // there was in the H-04 finding. Email remains the primary delivery path.
    let resetLink = null;
    try {
      const firebaseHostedLink = await auth.generatePasswordResetLink(normalizedEmail, { url: CONTINUE_URL });
      const oobCode = new URL(firebaseHostedLink).searchParams.get('oobCode');
      if (oobCode) resetLink = `${CONTINUE_URL}&oobCode=${encodeURIComponent(oobCode)}`;
    } catch (linkErr) {
      console.error('create-tenant: could not generate password reset link', linkErr);
    }

    let emailSent = false;
    if (resetLink && process.env.SENDGRID_API_KEY) {
      try {
        const sgResp = await fetch('https://api.sendgrid.com/v3/mail/send', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.SENDGRID_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            personalizations: [{ to: [{ email: normalizedEmail }] }],
            from: { email: 'invites@tailiq.app', name: 'TailiQ' },
            subject: `You've been invited to TailiQ — ${tenantName.trim()}`,
            content: [{ type: 'text/html', value: emailHTML(resetLink, tenantName.trim()) }],
          }),
        });
        emailSent = sgResp.ok;
        if (!sgResp.ok) {
          console.error('create-tenant: SendGrid send failed', sgResp.status, await sgResp.text());
        }
      } catch (sgErr) {
        console.error('create-tenant: SendGrid send threw', sgErr);
      }
    }

    return res.status(200).json({
      ok: true,
      tenantId: slug,
      tenantName: tenantName.trim(),
      adminUid: newUser.uid,
      adminEmail: normalizedEmail,
      approvedSendersSeeded: senders.length,
      emailSent,
      // Present only as a fallback when SendGrid didn't confirm delivery —
      // mirrors invite-user.js's brand-new-account fallback behaviour.
      inviteLink: emailSent ? undefined : resetLink,
    });
  } catch (err) {
    console.error('create-tenant: failed', err);
    // Best-effort cleanup so a failed attempt doesn't leave an orphaned Auth
    // account with no tenant behind it. Only rolls back what THIS request
    // created — never touches a pre-existing account or tenant.
    if (createdAuthAccount && newUser) {
      try { await auth.deleteUser(newUser.uid); } catch (cleanupErr) {
        console.error('create-tenant: cleanup deleteUser failed', cleanupErr);
      }
    }
    try { await tenantRef.delete(); } catch (cleanupErr) {
      console.error('create-tenant: cleanup tenant doc delete failed', cleanupErr);
    }
    return res.status(500).json({ error: 'Something went wrong creating the tenant. Please try again.' });
  }
};
