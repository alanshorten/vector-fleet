// api/landing-interest.js
//
// Captures email signups from the tailiq.app landing page.
// 1. Validates the submitted email.
// 2. Writes it to a Firestore collection (`landing_interest`).
// 3. Sends a notification email to Alan via SendGrid so he knows in real time.
//
// Uses the same Firebase Admin SDK / SendGrid setup already configured
// for invite-user.js and email-ingest.js — no new services or cost.

const admin = require('firebase-admin');
const sgMail = require('@sendgrid/mail');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY
        ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
        : undefined,
    }),
  });
}

const db = admin.firestore();

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NOTIFY_TO = 'alan.shorten@maverick-horizon.com';
const NOTIFY_FROM = 'invites@tailiq.app';

module.exports = async (req, res) => {
  // Basic CORS — the form is served from the same domain, but allow both
  // the bare domain and any Vercel preview/staging origin during transition.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email } = req.body || {};

    if (!email || typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
      return res.status(400).json({ error: 'Please provide a valid email address.' });
    }

    const cleanEmail = email.trim().toLowerCase();

    // Write to Firestore — non-fatal if it somehow fails twice in a row,
    // but we still want to know, so we don't swallow the error silently.
    const docRef = await db.collection('landing_interest').add({
      email: cleanEmail,
      source: 'tailiq.app',
      userAgent: req.headers['user-agent'] || null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Fire the notification email. If SendGrid fails, we still return
    // success to the visitor — the signup itself is already saved.
    try {
      await sgMail.send({
        to: NOTIFY_TO,
        from: NOTIFY_FROM,
        subject: 'New TailiQ landing page signup',
        text: `New signup: ${cleanEmail}\n\nFirestore doc: landing_interest/${docRef.id}`,
        html: `<p>New TailiQ landing page signup:</p><p><strong>${cleanEmail}</strong></p><p style="color:#888;font-size:12px">Firestore doc: landing_interest/${docRef.id}</p>`,
      });
    } catch (notifyErr) {
      console.error('SendGrid notification failed:', notifyErr?.response?.body || notifyErr);
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('landing-interest error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};
