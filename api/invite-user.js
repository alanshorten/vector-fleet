// TailiQ — Admin-only user invite
// POST /api/invite-user  { email }  ->  { ok: true }
//
// Flow: Admin SDK creates the Firebase Auth user (no password set by us —
// the user chooses their own), generates a password-reset action link
// scoped to app.tailiq.app, and emails it via SendGrid using our own
// domain/branding rather than Firebase's generic hosted reset page.
//
// Trust model: caller must be a signed-in user with role=admin custom claim,
// verified server-side via their Firebase ID token. Only admins can invite users.
// Role (editor, viewer, or dataEntry) is set as a custom claim at invite time —
// the new user has their role from the moment they first sign in.

const admin = require('firebase-admin');

const ALLOWED_ORIGINS = [
  'https://vector-fleet.vercel.app',
  'https://app.tailiq.app',
];

// Canonical domain for the link itself — independent of which origin the
// request came from, since the email is read wherever the recipient opens
// their inbox, not necessarily from the same browser tab that sent the invite.
const CONTINUE_URL = 'https://app.tailiq.app/?view=set-password';

const SENDER = 'TailiQ <invites@tailiq.app>';

// Build Group A (tenant onboarding, 19 Aug 2026): the tenantId stamped
// alongside role (setCustomUserClaims replaces the whole claims object) is
// resolved per-request from the inviting admin's own tenantId claim
// (decoded.tenantId below), not a shared hardcoded constant. An admin can
// only ever invite into their own tenant this way.

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

function emailHTML(resetLink, role) {
  const roleLabel = role === 'editor' ? 'Editor' : role === 'dataEntry' ? 'Data Entry' : 'Viewer';
  const roleDesc = role === 'editor'
    ? 'You have been set up with <strong>Editor</strong> access — you can upload reports and edit asset data.'
    : role === 'dataEntry'
    ? 'You have been set up with <strong>Data Entry</strong> access — you can upload reports and enter lease/reserve data for the fleet.'
    : 'You have been set up with <strong>Viewer</strong> access — you can view fleet data and tech specs.';
  return `
  <div style="font-family:'Segoe UI',Arial,sans-serif;background:#0b1520;padding:32px;">
    <div style="max-width:480px;margin:0 auto;background:#111f30;border:1px solid #1e3048;border-radius:10px;overflow:hidden;">
      <div style="background:#0d1c2c;padding:24px 28px;">
        <span style="font-family:Arial,sans-serif;font-size:24px;font-weight:700;color:#ffffff;">TailiQ</span>
        <span style="font-family:Arial,sans-serif;font-size:13px;color:#7a9ab5;margin-left:10px;">Fleet Intelligence</span>
      </div>
      <div style="padding:28px;">
        <h1 style="color:#e2e8f0;font-size:18px;margin:0 0 14px;">You've been invited to TailiQ</h1>
        <p style="color:#94a3b8;font-size:14px;line-height:1.6;margin:0 0 12px;">
          An administrator has set up an account for you on TailiQ, the fleet intelligence platform.
          Click below to choose your password and get started.
        </p>
        <p style="color:#94a3b8;font-size:13px;line-height:1.6;margin:0 0 22px;">${roleDesc}</p>
        <a href="${resetLink}" style="display:inline-block;background:#C9A84C;color:#0a1520;text-decoration:none;
          font-weight:700;font-size:14px;padding:12px 22px;border-radius:6px;">Set your password</a>
        <p style="color:#5a7a9a;font-size:12px;margin-top:20px;line-height:1.5;">
          If the button doesn't work, copy and paste this link into your browser:<br>
          <a href="${resetLink}" style="color:#7a9ab5;word-break:break-all;">${resetLink}</a>
        </p>
        <p style="color:#5a7a9a;font-size:12px;margin-top:16px;">
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

  let decoded;
  try {
    // Confirms the caller is a signed-in TailiQ admin.
    // security-remediation-roadmap.md Phase 3 Session 6 (3C / M-01, Layer 1):
    // checkRevoked=true rejects a token invalidated by a prior
    // revokeRefreshTokens() call, closing the up-to-an-hour stale-token gap.
    decoded = await admin.auth(app).verifyIdToken(idToken, true);
  } catch (err) {
    return res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
  }

  if (decoded.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  try {
    const callerRecord = await admin.auth(app).getUser(decoded.uid);
    if (callerRecord.disabled) {
      return res.status(403).json({ error: 'Your account has been disabled. Contact an admin.' });
    }
  } catch (err) {
    return res.status(401).json({ error: 'Your account could not be verified. Please sign in again.' });
  }

  const { email, role } = req.body || {};
  if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'A valid email address is required.' });
  }
  if (!['editor', 'viewer', 'dataEntry'].includes(role)) {
    return res.status(400).json({ error: 'Role must be editor, viewer, or dataEntry.' });
  }
  const normalizedEmail = email.trim().toLowerCase();

  if (!process.env.SENDGRID_API_KEY) {
    console.error('invite-user: SENDGRID_API_KEY is not set');
    return res.status(500).json({ error: 'Email sending is not configured. Contact the developer.' });
  }

  try {
    const auth = admin.auth(app);

    // SECURITY (remediated 2026-08, Phase 1C — see security-remediation-roadmap.md
    // H-04): this used to delete-and-recreate any existing account on resend
    // (losing its UID/history and letting an admin silently reset another
    // admin's account), then returned the raw password-reset link straight
    // to the calling browser (whoever clicked "resend" could set the
    // victim's password themselves). Neither happens anymore: an existing
    // account is never deleted, an existing admin account is never touched
    // at all, and the reset link is only ever emailed to the account owner
    // — never included in the API response — once we're on the resend path.
    let newUser;
    let isResend = false;

    // Create the user with no password — they choose their own via the
    // reset link. A random throwaway password is required by the Admin SDK
    // API itself but is never shared with anyone or stored by us.
    try {
      newUser = await auth.createUser({ email: normalizedEmail, emailVerified: false });
    } catch (err) {
      if (err.code === 'auth/email-already-exists') {
        isResend = true;
        const existing = await auth.getUserByEmail(normalizedEmail);
        if (existing.customClaims?.role === 'admin') {
          // Refuse outright rather than silently no-op, so the caller knows
          // this isn't the right flow for an admin account.
          return res.status(403).json({ error: 'This email belongs to an admin account. Admin accounts cannot be resent an invite from here.' });
        }
        // Build Group A (19 Aug 2026): Firebase Auth emails are unique
        // across the whole project, not per-tenant — so "email already
        // exists" can mean a DIFFERENT tenant's user, not necessarily one of
        // this admin's own. Without this check, the setCustomUserClaims call
        // below would silently reassign that account's tenantId to the
        // inviting admin's tenant, along with a new role — a cross-tenant
        // account takeover. Only allow the resend path when the existing
        // account already belongs to the caller's own tenant (or has no
        // tenantId yet at all — a pre-Phase-3 leftover, handled the same way
        // set-role.js's own bootstrapping cases are).
        if (existing.customClaims?.tenantId && existing.customClaims.tenantId !== decoded.tenantId) {
          return res.status(409).json({ error: 'This email belongs to an account in a different organisation and cannot be invited here.' });
        }
        newUser = existing;
      } else {
        throw err;
      }
    }

    // Set role claim. For a brand-new user this gives them the right access
    // from first sign-in; for a resend, this is the one legitimate way this
    // endpoint changes an existing (non-admin) user's role, as an explicit
    // and visible part of the same admin action — not a hidden side effect.
    await auth.setCustomUserClaims(newUser.uid, { role, tenantId: decoded.tenantId });

    // Phase 3 Session 6 (3C / M-01, Layer 2, Decision 2): keep the
    // tenantMembers membership doc in sync — what Firestore WRITE rules
    // actually consult (see memberRole()/isActiveMember() in
    // firestore.rules). Non-fatal on failure, same reasoning as set-role.js:
    // the custom claim above is still the primary access-control mechanism.
    try {
      const fs = admin.firestore(app);
      const ref = fs.collection('tenants').doc(decoded.tenantId).collection('tenantMembers').doc(newUser.uid);
      const snap = await ref.get();
      const now = new Date().toISOString();
      await ref.set({
        role,
        email: normalizedEmail,
        status: 'active',
        createdAt: snap.exists ? snap.data().createdAt : now,
        updatedAt: now,
      }, { merge: true });
    } catch (memberErr) {
      console.error('invite-user: tenantMembers sync failed', memberErr);
    }

    const firebaseHostedLink = await auth.generatePasswordResetLink(normalizedEmail, {
      url: CONTINUE_URL,
    });

    // generatePasswordResetLink() returns a link to Firebase's own hosted
    // action handler (e.g. vector-fleet.firebaseapp.com/__/auth/action),
    // with `continueUrl` only used *after* that page completes — and it
    // does that redirect without re-attaching oobCode, so our own
    // SetPasswordScreen never sees the code. We don't need Firebase's
    // hosted page at all (SetPasswordScreen already calls
    // verifyPasswordResetCode/confirmPasswordReset directly), so pull the
    // oobCode out and send people straight to our own page instead.
    const oobCode = new URL(firebaseHostedLink).searchParams.get('oobCode');
    if (!oobCode) {
      throw new Error('Could not extract reset code from generated link.');
    }
    const resetLink = `${CONTINUE_URL}&oobCode=${encodeURIComponent(oobCode)}`;

    const sgResp = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.SENDGRID_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: normalizedEmail }] }],
        from: { email: 'invites@tailiq.app', name: 'TailiQ' },
        subject: "You've been invited to TailiQ",
        content: [{ type: 'text/html', value: emailHTML(resetLink, role) }],
      }),
    });

    if (!sgResp.ok) {
      const errText = await sgResp.text();
      console.error('invite-user: SendGrid send failed', sgResp.status, errText);
      if (isResend) {
        // Never surface the reset link for a resend, even when SendGrid
        // fails — that's exactly the exposure this fix closes. The caller
        // (an admin) can try resending again once SendGrid is fixed.
        return res.status(502).json({
          error: 'The account role was updated but the invite email could not be sent. Check SendGrid configuration and try resending the invite again.',
        });
      }
      // Brand-new account, no prior owner — falling back to sharing the
      // link manually is safe here since the inviting admin is the only
      // person who has taken any action so far.
      return res.status(502).json({
        error: 'The account was created but the invite email could not be sent. Check SendGrid configuration, or share this link with them directly: ' + resetLink,
      });
    }

    return res.status(200).json(isResend ? { ok: true, resent: true } : { ok: true, inviteLink: resetLink });
  } catch (err) {
    console.error('invite-user: failed', err);
    return res.status(500).json({ error: 'Something went wrong creating the invite. Please try again.' });
  }
};