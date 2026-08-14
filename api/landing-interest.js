// api/landing-interest.js
//
// Captures email signups from the tailiq.app landing page.
// 1. Validates the submitted email.
// 2. Writes it to a Firestore collection (`landing_interest`).
// 3. Sends a notification email to Alan via SendGrid's HTTP API so he knows
//    in real time (uses plain fetch — no @sendgrid/mail dependency needed).
//
// Uses the same Firebase Admin SDK setup already configured for
// invite-user.js and email-ingest.js — no new services or cost.
//
// SECURITY (remediated 2026-08, Phase 1D — see security-remediation-roadmap.md
// M-04): this endpoint was open to unbounded abuse — no rate limit, no
// dedup, so a script could flood it with requests, each one a Firestore
// write and (until it failed loudly) a SendGrid send to Alan's personal
// inbox. Two independent mitigations now apply before any write happens:
// a per-IP rate limit (Firestore-backed, survives cold starts) and an
// email-dedup check that silently no-ops a repeat signup rather than
// writing a duplicate record and re-notifying. CAPTCHA/Turnstile on the
// landing form itself is still deferred to the landing-page rebuild per
// the roadmap — these are the server-side mitigations that don't require
// touching the landing page HTML.

const admin = require('firebase-admin');
const crypto = require('crypto');

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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254; // RFC 5321 practical limit — rejects absurdly long strings before they ever hit Firestore/SendGrid
const NOTIFY_TO = 'alan.shorten@gmail.com';
const NOTIFY_FROM = 'invites@tailiq.app';

// ---- per-IP rate limit -------------------------------------------------
// Fixed window, keyed by a hash of the client IP so the collection stays
// bounded by distinct-IP count rather than growing per-request. No TTL
// policy needed for correctness (an expired window is simply overwritten
// on the next request from that IP) — though adding a Firestore TTL policy
// on `windowStart` for this collection is a reasonable console-side
// cleanup if the row count ever becomes a concern.
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const RATE_LIMIT_MAX_PER_WINDOW = 5;

function getClientIP(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return xff.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

async function checkRateLimit(ip) {
  const key = crypto.createHash('sha256').update(ip).digest('hex').slice(0, 40);
  const ref = db.collection('landingRateLimit').doc(key);
  const now = Date.now();
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : null;
    if (data && (now - data.windowStart) < RATE_LIMIT_WINDOW_MS) {
      if (data.count >= RATE_LIMIT_MAX_PER_WINDOW) return false;
      tx.update(ref, { count: admin.firestore.FieldValue.increment(1), lastRequestAt: new Date().toISOString() });
      return true;
    }
    tx.set(ref, { windowStart: now, count: 1, lastRequestAt: new Date().toISOString() });
    return true;
  });
}

async function sendNotification(cleanEmail, docId) {
  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: NOTIFY_TO }] }],
      from: { email: NOTIFY_FROM },
      subject: 'New TailiQ landing page signup',
      content: [
        { type: 'text/plain', value: `New signup: ${cleanEmail}\n\nFirestore doc: landing_interest/${docId}` },
        { type: 'text/html', value: `<p>New TailiQ landing page signup:</p><p><strong>${cleanEmail}</strong></p><p style="color:#888;font-size:12px">Firestore doc: landing_interest/${docId}</p>` },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`SendGrid responded ${response.status}: ${body}`);
  }
}

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
    const ip = getClientIP(req);
    const allowed = await checkRateLimit(ip);
    if (!allowed) {
      return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }

    const { email } = req.body || {};

    if (!email || typeof email !== 'string' || email.trim().length > MAX_EMAIL_LENGTH || !EMAIL_RE.test(email.trim())) {
      return res.status(400).json({ error: 'Please provide a valid email address.' });
    }

    const cleanEmail = email.trim().toLowerCase();

    // Dedup: a repeat signup from the same email is a silent no-op — no
    // duplicate Firestore record, no repeat notification to Alan's inbox.
    // Still returns ok:true to the visitor (nothing to gain by revealing
    // sign-up state to a caller who doesn't already have the account).
    const existing = await db.collection('landing_interest').where('email', '==', cleanEmail).limit(1).get();
    if (!existing.empty) {
      return res.status(200).json({ ok: true });
    }

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
      await sendNotification(cleanEmail, docRef.id);
    } catch (notifyErr) {
      console.error('SendGrid notification failed:', notifyErr.message || notifyErr);
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('landing-interest error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};
