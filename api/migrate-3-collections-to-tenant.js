// migrate-3-collections-to-tenant.js
//
// One-time migration: copies existing flat-path documents for
// shopVisitProjections, knowledgeBase (+ its llpCatalogue subcollection),
// and completedEvents into their new tenant-rooted paths under
// tenants/{TENANT_ID}/... — see second-reassessment-followup-scoping-
// handoff.md item 3 and firestore.rules for the rules side of this change.
//
// completedEvents is included defensively even though it's expected to
// find zero documents — the flat path never had a working Firestore rule
// (see db.js's comments on deleteCompletedEvent / the firestore.rules
// comment on the flat completedEvents match), so nothing should have been
// writable there. If this script finds any anyway (e.g. written via the
// Admin SDK at some point, bypassing rules entirely), they get migrated
// too rather than silently left behind.
//
// Idempotent: safe to re-run. Each destination write checks whether the
// doc already exists at the tenant-rooted path first and skips it if so,
// so a partial run (or crash midway) can just be re-run from the top.
//
// USAGE:
//   1. Make sure the same Firebase Admin env vars extract.js/email-ingest.js
//      use are available in this shell: FIREBASE_PROJECT_ID,
//      FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY. Easiest way if you use
//      Vercel: `vercel env pull .env.local` in the repo root, then load
//      that file's values into your shell (or run this with a loader like
//      `node -r dotenv/config migrate-3-collections-to-tenant.js` after
//      `npm install dotenv --save-dev` and renaming .env.local to .env, or
//      just `export` the three values directly — whichever's easiest for
//      you).
//   2. node migrate-3-collections-to-tenant.js
//   3. Read the summary it prints at the end. It reports counts found,
//      copied, and skipped (already existed) for each collection.
//   4. Nothing is deleted from the flat paths by this script — the flat
//      shopVisitProjections/knowledgeBase docs stay in place as a rollback
//      copy until a later cleanup session, same DEPRECATED/TRANSITIONAL
//      pattern as every other Phase 3 migration. (completedEvents has no
//      flat rule to roll back to, so this point is moot for it.)

const admin = require('firebase-admin');

const TENANT_ID = 'maverick'; // matches the hardcoded value in email-ingest.js, bootstrap-admin.js, set-role.js, invite-user.js

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

async function migrateFlatCollection(fsdb, collectionName) {
  const flatSnap = await fsdb.collection(collectionName).get();
  let copied = 0, skipped = 0;
  for (const docSnap of flatSnap.docs) {
    const destRef = fsdb.collection('tenants').doc(TENANT_ID).collection(collectionName).doc(docSnap.id);
    const destSnap = await destRef.get();
    if (destSnap.exists) { skipped++; continue; }
    await destRef.set(docSnap.data());
    copied++;
  }
  return { found: flatSnap.size, copied, skipped };
}

async function migrateKnowledgeBase(fsdb) {
  const flatSnap = await fsdb.collection('knowledgeBase').get();
  let copied = 0, skipped = 0, llpCopied = 0, llpSkipped = 0;
  for (const docSnap of flatSnap.docs) {
    const destRef = fsdb.collection('tenants').doc(TENANT_ID).collection('knowledgeBase').doc(docSnap.id);
    const destSnap = await destRef.get();
    if (!destSnap.exists) {
      await destRef.set(docSnap.data());
      copied++;
    } else {
      skipped++;
    }

    // llpCatalogue subcollection under this knowledgeBase doc
    const llpFlatSnap = await fsdb.collection('knowledgeBase').doc(docSnap.id).collection('llpCatalogue').get();
    for (const llpDoc of llpFlatSnap.docs) {
      const llpDestRef = fsdb.collection('tenants').doc(TENANT_ID)
        .collection('knowledgeBase').doc(docSnap.id)
        .collection('llpCatalogue').doc(llpDoc.id);
      const llpDestSnap = await llpDestRef.get();
      if (!llpDestSnap.exists) {
        await llpDestRef.set(llpDoc.data());
        llpCopied++;
      } else {
        llpSkipped++;
      }
    }
  }
  return { found: flatSnap.size, copied, skipped, llpFound: llpCopied + llpSkipped, llpCopied, llpSkipped };
}

async function main() {
  const app = getApp();
  const fsdb = admin.firestore(app);

  console.log(`Migrating flat collections to tenants/${TENANT_ID}/... (idempotent — safe to re-run)\n`);

  const shopVisit = await migrateFlatCollection(fsdb, 'shopVisitProjections');
  console.log(`shopVisitProjections: found ${shopVisit.found}, copied ${shopVisit.copied}, skipped (already existed) ${shopVisit.skipped}`);

  const kb = await migrateKnowledgeBase(fsdb);
  console.log(`knowledgeBase: found ${kb.found}, copied ${kb.copied}, skipped ${kb.skipped}`);
  console.log(`  llpCatalogue (across all knowledgeBase docs): found ${kb.llpFound}, copied ${kb.llpCopied}, skipped ${kb.llpSkipped}`);

  const completed = await migrateFlatCollection(fsdb, 'completedEvents');
  console.log(`completedEvents: found ${completed.found}, copied ${completed.copied}, skipped ${completed.skipped}`);
  if (completed.found > 0) {
    console.log(`  NOTE: completedEvents had no working Firestore rule before today's fix, so finding ${completed.found} document(s) here is unexpected — these were likely written via the Admin SDK directly (bypassing rules) at some point. Worth a quick look at what they are before assuming this is fine.`);
  } else {
    console.log(`  (Expected zero — this collection had no working rule before today's fix, so nothing should have been writable at the flat path. Confirms the bug matches what was found.)`);
  }

  console.log('\nDone. Flat documents were left in place (not deleted) — same rollback-copy pattern as every other Phase 3 migration.');
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});