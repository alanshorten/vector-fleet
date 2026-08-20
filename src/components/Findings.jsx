import React, { useEffect, useState, useCallback } from 'react';
import { db } from '../lib/db';

// Fleet Findings Workflow — Session B UI (claude_ui-p2-build-handoff.md
// Item 1). Session A (findingsEngine.js / Brain 10, firestore.rules,
// db.js CRUD) built the collection and the trigger engine; this file is
// the first thing that actually reads and displays what it produces.

const STATUS_META = {
  new:              { label: "New",              dot: "var(--color-teal)" },
  action_required:  { label: "Action Required",  dot: "var(--color-critical)" },
  monitoring:       { label: "Monitoring",       dot: "var(--color-attention)" },
  resolved:         { label: "Resolved",         dot: "var(--color-positive)" }
};
const CARD_STATUSES = ["new", "action_required", "monitoring", "resolved"];

function fmtDateShort(ms) {
  if (!ms) return "—";
  return new Date(ms).toISOString().slice(0, 10);
}

function findingLabel(f) {
  return f.source?.description || f.source?.eventType || f.source?.pot || f.type;
}

// One row inside an expanded card. Deep link per the handoff: "navigates
// to asset's financials tab, scrolled/focused on the relevant pot" — the
// pot code (when the finding has one) is passed up so App.jsx can hand it
// to FlyForward as focusPotCode.
function FindingRow({ finding, asset, onOpen, onDelete }) {
  return (
    <div
      onClick={() => onOpen(finding)}
      style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", borderTop: "1px solid var(--color-divider-inner)", cursor: "pointer" }}
      onMouseEnter={e => e.currentTarget.style.background = "var(--color-carbon-tint-04)"}
      onMouseLeave={e => e.currentTarget.style.background = "transparent"}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--color-carbon)" }}>
          {asset ? `MSN ${asset.msn} — ${asset.registration || "—"}` : `Asset ${finding.assetId}`}
        </div>
        <div style={{ fontSize: 11, color: "var(--color-graphite)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {finding.source?.pot || finding.source?.eventType || "—"} · {findingLabel(finding)}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0, marginLeft: 12 }}>
        <div style={{ fontSize: 11, color: "var(--color-graphite)", textAlign: "right" }}>
          {fmtDateShort(finding.createdAt)}
        </div>
        {onDelete && (
          // Admin-only hard delete — 20 Aug 2026, added so test/duplicate
          // findings created during live testing can be cleaned up from
          // inside the app rather than needing the Firebase Console.
          <button
            title="Delete this finding (admin only)"
            onClick={e => { e.stopPropagation(); onDelete(finding); }}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "var(--color-graphite)", padding: 2, lineHeight: 1 }}
          >
            🗑
          </button>
        )}
      </div>
    </div>
  );
}

// Four compact summary cards (New / Action Required / Monitoring /
// Resolved), each expanding independently downward — multiple can be open
// at once, per the handoff's interaction spec. Sits above the fleet table
// on Dashboard.jsx.
function FleetFindingsCards({ assets, onOpenFinding, userRole }) {
  const [findings, setFindings] = useState(null); // null = loading
  const [expanded, setExpanded] = useState({});

  const load = useCallback(() => {
    db.getAllFindings().then(setFindings).catch(() => setFindings([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  // Admin-only delete — 20 Aug 2026, cleanup escape hatch for test/duplicate
  // findings (mirrors the firestore.rules admin-only delete gate).
  const handleDelete = (finding) => {
    if (!window.confirm(`Delete this finding (${finding.source?.pot || finding.type})? This can't be undone.`)) return;
    db.deleteFinding(finding.id).then(load).catch(() => {});
  };

  if (findings === null) return null; // no layout flash while loading

  const assetById = Object.fromEntries((assets || []).map(a => [String(a.id), a]));
  // Resolved findings drop off the Resolved card 30 days after resolving
  // (Alan, 20 Aug 2026) — display-only: the Firestore doc itself is never
  // touched here, so the audit trail (and the admin delete escape hatch)
  // is unaffected, it just stops cluttering this card indefinitely.
  // Falls back to statusChangedAt for any older resolved doc that predates
  // resolvedAt being reliably set.
  const RESOLVED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
  const resolvedCutoff = Date.now() - RESOLVED_RETENTION_MS;
  const byStatus = Object.fromEntries(CARD_STATUSES.map(s => {
    let rows = findings.filter(f => f.status === s);
    if (s === "resolved") rows = rows.filter(f => (f.resolvedAt || f.statusChangedAt || 0) >= resolvedCutoff);
    return [s, rows];
  }));

  // Checked AFTER the 30-day filter, not on the raw fetch — an asset whose
  // only findings are resolved-and-aged-out shouldn't still render four
  // empty cards.
  if (!Object.values(byStatus).some(rows => rows.length)) return null;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, marginBottom: 14 }}>
      {CARD_STATUSES.map(status => {
        const meta = STATUS_META[status];
        const rows = byStatus[status];
        const isOpen = !!expanded[status];
        return (
          <div key={status} className="card" style={{ overflow: "hidden" }}>
            <button
              onClick={() => setExpanded(e => ({ ...e, [status]: !e[status] }))}
              style={{ width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer", padding: "12px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: meta.dot }}/>
                <span style={{ fontSize: 20, fontWeight: 700, color: "var(--color-carbon)", fontFamily: "var(--font-data)" }}>{rows.length}</span>
                <span style={{ fontSize: 12, color: "var(--color-graphite)" }}>{meta.label}</span>
              </div>
              {rows.length > 0 && <span style={{ fontSize: 11, color: "var(--color-graphite)" }}>{isOpen ? "▲" : "▼"}</span>}
            </button>
            {isOpen && rows.length > 0 && (
              <div>
                {rows.map(f => (
                  <FindingRow key={f.id} finding={f} asset={assetById[f.assetId]} onOpen={onOpenFinding} onDelete={userRole === "admin" ? handleDelete : null}/>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// "Accepted Positions" — claude_ui-p2-build-handoff.md: accepted findings
// disappear from the fleet cards above and live here instead, on the
// asset's own Financials tab. Visible to every role including Viewer
// (transparency, not a call to action) — deliberately muted, no red/amber
// urgency colours.
// Takes findings as a prop rather than fetching independently — it and
// FindingTriageControl below both need to reflect the SAME accept action
// immediately, so FlyForward owns one shared `assetFindings` list (via
// refreshFindings()) and passes the accepted slice down here. An earlier
// version fetched its own copy and never learned about an accept that
// just happened elsewhere on the same page (20 Aug 2026 live-test fix —
// "accepted the position but... not showing on the financials tab as
// accepted").
function AcceptedPositionsSection({ findings, userRole, onDeleted }) {
  if (!findings || !findings.length) return null;

  // Admin-only delete — 20 Aug 2026, cleanup escape hatch for test/duplicate
  // accepted findings, alongside the same affordance on the fleet cards.
  const handleDelete = (f) => {
    if (!window.confirm(`Delete this accepted finding (${f.source?.pot || f.type})? This can't be undone.`)) return;
    db.deleteFinding(f.id).then(() => onDeleted && onDeleted()).catch(() => {});
  };

  return (
    <div className="card" style={{ padding: 16, marginBottom: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-carbon)", marginBottom: 4 }}>Accepted Positions</div>
      <div style={{ fontSize: 11, color: "var(--color-graphite)", marginBottom: 10 }}>
        Findings an Admin or Editor has reviewed and accepted as a known position — shown here for visibility, not as an open action item. A further deterioration beyond the band it was accepted at will resurface it on the fleet dashboard.
      </div>
      {findings.map(f => (
        <div key={f.id} style={{ padding: "8px 0", borderTop: "1px solid var(--color-divider-inner)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <div style={{ fontSize: 12, color: "var(--color-carbon)" }}>{f.source?.pot || f.source?.eventType || "—"} — {findingLabel(f)}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
              <div style={{ fontSize: 11, color: "var(--color-graphite)", whiteSpace: "nowrap" }}>Accepted {fmtDateShort(f.acceptedAt)}</div>
              {userRole === "admin" && (
                <button
                  title="Delete this finding (admin only)"
                  onClick={() => handleDelete(f)}
                  style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "var(--color-graphite)", padding: 2, lineHeight: 1 }}
                >
                  🗑
                </button>
              )}
            </div>
          </div>
          {(f.notes || []).filter(n => n.by !== "system").slice(-1).map((n, i) => (
            <div key={i} style={{ fontSize: 11, color: "var(--color-graphite)", marginTop: 4, fontStyle: "italic" }}>“{n.text}”</div>
          ))}
        </div>
      ))}
    </div>
  );
}

// Human triage panel — shown on the fleet dashboard's expanded finding row
// isn't part of this build (deep-link takes you to the asset instead, per
// the handoff's row spec), but Editor/Admin need SOME way to accept a
// finding. Kept minimal: a small inline control FlyForward can render next
// to a pot card when that pot has an open (non-accepted) finding.
function FindingTriageControl({ finding, userRole, onChanged, notify }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const canTriage = userRole === "admin" || userRole === "editor";
  if (!canTriage || !finding || finding.status === "resolved" || finding.status === "accepted") return null;

  const accept = async () => {
    setBusy(true);
    try {
      await db.acceptFinding(finding.id, finding.bandAtCreation, note || null);
      onChanged && onChanged();
    } catch (e) {
      // 20 Aug 2026 live-test fix — a failed accept (e.g. a permission
      // issue) used to fail silently: the control just stayed put with no
      // explanation, looking like the click did nothing.
      if (notify) notify("Failed to accept: " + (e.message || "please try again"), "error");
      else console.warn("Failed to accept finding:", e);
    } finally {
      setBusy(false);
    }
  };

  // Manual triage (20 Aug 2026) — the original P2 scoping session called
  // for authorized roles to "triage, assign, monitor, resolve," but only
  // Accept made it into the actual build. These let Editor/Admin move an
  // open finding to Action Required or Monitoring by hand, independent of
  // the automatic engine transitions.
  const setStatus = async (status) => {
    setBusy(true);
    try {
      await db.setFindingStatus(finding.id, status, note || null);
      onChanged && onChanged();
    } catch (e) {
      if (notify) notify("Failed to update: " + (e.message || "please try again"), "error");
      else console.warn("Failed to set finding status:", e);
    } finally {
      setBusy(false);
    }
  };

  // Admin-only hard delete — 20 Aug 2026, cleanup escape hatch for
  // test/duplicate findings still open (not yet accepted).
  const del = async () => {
    if (!window.confirm(`Delete this finding (${finding.source?.pot || finding.type})? This can't be undone.`)) return;
    setBusy(true);
    try {
      await db.deleteFinding(finding.id);
      onChanged && onChanged();
    } catch (e) {
      if (notify) notify("Failed to delete: " + (e.message || "please try again"), "error");
      else console.warn("Failed to delete finding:", e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
      <input placeholder="Optional note" value={note} onChange={e => setNote(e.target.value)} style={{ fontSize: 11, padding: "5px 8px" }}/>
      {finding.status !== "action_required" && (
        <button className="btn btn-ghost" style={{ fontSize: 11, padding: "5px 10px", whiteSpace: "nowrap" }} disabled={busy} onClick={() => setStatus("action_required")}>
          Mark Action Required
        </button>
      )}
      {finding.status !== "monitoring" && (
        <button className="btn btn-ghost" style={{ fontSize: 11, padding: "5px 10px", whiteSpace: "nowrap" }} disabled={busy} onClick={() => setStatus("monitoring")}>
          Mark Monitoring
        </button>
      )}
      <button className="btn btn-ghost" style={{ fontSize: 11, padding: "5px 10px", whiteSpace: "nowrap" }} disabled={busy} onClick={accept}>
        {busy ? "Accepting…" : "Accept position"}
      </button>
      {userRole === "admin" && (
        <button
          title="Delete this finding (admin only)"
          disabled={busy}
          onClick={del}
          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "var(--color-graphite)", padding: 2, lineHeight: 1 }}
        >
          🗑
        </button>
      )}
    </div>
  );
}

export { FleetFindingsCards, AcceptedPositionsSection, FindingTriageControl, STATUS_META };