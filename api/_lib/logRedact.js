// Shared log-redaction helper (TECH_DEBT.md 4.135).
//
// Context: a Section 4 dashboard-checklist pass (18 Aug 2026) scanned every
// console.log/warn/error call across all api/*.js files. No extracted report
// content, financial/technical data, or secrets are ever logged — the only
// plaintext-sensitive material found was email addresses in a handful of
// call sites in email-ingest.js and remove-user.js. Flagged low priority
// (this is TailiQ's own operational logging, not a third-party leak), but
// cheap enough to close out rather than leave open.
//
// maskEmail() keeps the domain (useful for debugging — "which company sent
// this" is often the actually-useful triage signal) while masking the local
// part, so the full address never lands in Vercel's function logs verbatim.
// Not a security boundary — anyone with log access could already see
// everything else in the request — just reduces plaintext PII at rest in
// third-party log storage.
function maskEmail(email) {
  if (!email || typeof email !== 'string') return email;
  const at = email.indexOf('@');
  if (at <= 0) return '***'; // no '@', or '@' is the first character — nothing sane to keep
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const keep = local.slice(0, 1);
  return `${keep}${'*'.repeat(Math.max(local.length - 1, 1))}@${domain}`;
}

module.exports = { maskEmail };