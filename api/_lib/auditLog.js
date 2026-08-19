// TailiQ — Server-side audit log helper
// Mirrors the client-side logAudit() in src/lib/db.js (lines 46–75).
//
// Admin SDK bypasses firestore.rules entirely — no identity-binding
// validation needed; the server IS the trusted authority. Writes the
// same six-field shape to tenants/{tenantId}/auditLog so a single
// Firestore read path / UI table works for both client- and server-
// originated entries.
//
// Audit log scope expansion, Session A (19 Aug 2026).

const admin = require('firebase-admin');

/**
 * Write an audit log entry via Admin SDK.
 *
 * @param {FirebaseFirestore.Firestore} fsdb  — admin.firestore(app)
 * @param {string} tenantId
 * @param {object} entry
 * @param {string|null} entry.userId    — UID of the acting user
 * @param {string|null} entry.userEmail — email of the acting user
 * @param {string|null} [entry.assetId]
 * @param {string|null} [entry.assetMSN]
 * @param {string} entry.action         — free-text, ≤300 chars (rules-enforced on client path only)
 */
async function writeAuditLog(fsdb, tenantId, { userId, userEmail, assetId, assetMSN, action }) {
  await fsdb.collection('tenants').doc(tenantId).collection('auditLog').add({
    userId:    userId || null,
    userEmail: userEmail || null,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    assetId:   assetId != null ? String(assetId) : null,
    assetMSN:  assetMSN != null ? String(assetMSN) : null,
    action,
  });
}

module.exports = { writeAuditLog };