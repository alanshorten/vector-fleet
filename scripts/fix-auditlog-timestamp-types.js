// fix-auditlog-timestamp-types.js
//
// One-time backfill: converts auditLog documents whose `timestamp` field is
// still a plain ISO string (the pre-Phase-3-Session-7 format, before the
// M-03 fix switched writes to serverTimestamp()) into a real Firestore
// Timestamp value, at their existing tenant-rooted path
// (tenants/maverick/auditLog/...).
//
// WHY THIS IS NEEDED (found live, 18 Aug 2026, debugging with Alan): the
// migration script (migrate-auditlog-to-tenant.js) correctly copied every
// flat-path document's data as-is — including whichever documents predated
// the M-03 fix and still had `timestamp` as a string rather than a real
// Timestamp. Firestore sorts a field by TYPE before it sorts by value when a
// collection has mixed types in the same field, and strings sort AFTER
// timestamps in Firestore's type ordering. In a descending orderBy(timestamp)
// query — which is how both the app and the Firebase console's own sorted
// list view read this collection — every string-typed (old) entry clusters
// ahead of every real-Timestamp-typed (new) entry, regardless of the actual
// date encoded in the string. That's why newly-created audit entries never
// appeared at the top of the sorted view no matter how recent they were, even
// though the underlying writes were always landing correctly (confirmed via
// direct document-ID lookups and an unordered full-collection fetch during
// the same debugging session).
//
// This script fixes the ROOT CAUSE rather than working around the symptom:
// it walks every document in tenants/maverick/auditLog, and for any doc
// whose `timestamp` field is a string, parses it as a Date and rewrites the
// field as a real Firestore Timestamp (via admin.firestore.Timestamp), using
// an Admin SDK write (bypasses firestore.rules — this is a data-shape
// correction, not a new audit event, so it's deliberately NOT going through
// logAudit()/the client rules path).
//
// Idempotent: safe to re-run — a document whose timestamp is already a real
// Timestamp is left untouched and reported as skipped.
//
// Lives in scripts/, NOT api/, for the same reason as every other one-time
// migration script in this repo (see migrate-auditlog-to-tenant.js's header)
// — the Vercel Hobby plan's 12-function cap has zero headroom, and this is a
// plain Node script with no HTTP handler.
//
// USAGE: same as migrate-auditlog-to-tenant.js —
//   1. FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY
//      must be set in the shell (see that script's header for how).
//   2. node scripts/fix-auditlog-timestamp-types.js
//   3. Read the summary: found/converted/skipped (already a real Timestamp).
//   4. Re-check the Firebase console's auditLog sorted list a minute or two
//      afterward — it should now show the most recent entry at the top.

const admin = require('firebase-admin');

const TENANT_ID = 'maverick';

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

async function fixTimestamps(fsdb) {
  const snap = await fsdb.collection('tenants').doc(TENANT_ID).collection('auditLog').get();
  let converted = 0, skipped = 0, unparseable = 0;
  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    const ts = data.timestamp;
    if (typeof ts !== 'string') { skipped++; continue; }
    const parsed = new Date(ts);
    if (isNaN(parsed.getTime())) {
      console.warn(`  Could not parse timestamp on ${docSnap.id}: ${JSON.stringify(ts)} — left as-is.`);
      unparseable++;
      continue;
    }
    await docSnap.ref.update({ timestamp: admin.firestore.Timestamp.fromDate(parsed) });
    converted++;
  }
  return { found: snap.size, converted, skipped, unparseable };
}

async function main() {
  const app = getApp();
  const fsdb = admin.firestore(app);

  console.log(`Converting string timestamps to real Timestamps in tenants/${TENANT_ID}/auditLog/... (idempotent — safe to re-run)\n`);

  const result = await fixTimestamps(fsdb);
  console.log(`auditLog: found ${result.found}, converted ${result.converted}, skipped (already a real Timestamp) ${result.skipped}, unparseable ${result.unparseable}`);

  console.log('\nDone. Re-check the Firebase console\'s auditLog sorted-by-timestamp view in a minute or two — the newest entry should now be at the top.');
}

main().catch(err => {
  console.error('Backfill failed:', err);
  process.exit(1);
});