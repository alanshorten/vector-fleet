import React, { useState, useEffect } from 'react';
import { db, logAudit } from '../lib/db';

// Platform admin screen — claude_security-review-20260818-handoff.md
// "Build Group A — Tenant Onboarding". Provisions a brand-new tenant
// (company) and its first admin account via api/create-tenant.js.
//
// Gated on the platform-level superAdmin:true custom claim — separate
// from, and above, the existing four-role tenant-scoped model. App.jsx
// only ever mounts this component when isSuperAdmin is true (both the
// nav entry and the route render are conditioned on it), so this file
// doesn't re-check the claim itself; the Firestore rule on tenants/{id}
// and the create-tenant.js endpoint's own server-side check are the real
// enforcement boundary either way.
//
// Deliberately minimal, per spec: Create Tenant form + a read-only tenant
// list. No suspend/usage/ongoing-sender-management here — those are
// explicitly deferred to a later session.

const SLUG_RE = /^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function slugify(name) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

function CreateTenantCard({ notify, onCreated }) {
  const [tenantName, setTenantName] = useState('');
  const [tenantSlug, setTenantSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [adminEmail, setAdminEmail] = useState('');
  const [senders, setSenders] = useState([{ type: 'domain', value: '' }]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);

  const updateName = (v) => {
    setTenantName(v);
    if (!slugTouched) setTenantSlug(slugify(v));
  };

  const updateSender = (i, field, val) => {
    setSenders(prev => prev.map((s, idx) => idx === i ? { ...s, [field]: val } : s));
  };
  const addSender = () => setSenders(prev => [...prev, { type: 'domain', value: '' }]);
  const removeSender = (i) => setSenders(prev => prev.filter((_, idx) => idx !== i));

  const reset = () => {
    setTenantName(''); setTenantSlug(''); setSlugTouched(false);
    setAdminEmail(''); setSenders([{ type: 'domain', value: '' }]);
  };

  const create = async () => {
    if (!tenantName.trim()) { notify('Enter a tenant name', 'error'); return; }
    const slug = tenantSlug.trim().toLowerCase();
    if (!SLUG_RE.test(slug)) { notify('Tenant slug must be lowercase letters, digits, and hyphens only (1-40 chars, no leading/trailing hyphen)', 'error'); return; }
    if (!adminEmail || !EMAIL_RE.test(adminEmail)) { notify('Enter a valid admin email address', 'error'); return; }

    const cleanSenders = senders.filter(s => s.value && s.value.trim()).map(s => ({ type: s.type, value: s.value.trim().toLowerCase() }));

    setBusy(true); setResult(null); setCopied(false);
    try {
      const idToken = await window._auth.getIdToken();
      const resp = await fetch('/api/create-tenant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({ tenantName: tenantName.trim(), tenantSlug: slug, adminEmail, approvedSenders: cleanSenders }),
      });
      const data = await resp.json();
      if (!resp.ok || data.error) throw new Error(data.error || 'Failed to create tenant.');
      await logAudit(null, null, `Created tenant "${tenantName.trim()}" (${slug}) with admin ${data.adminEmail}`);
      notify(`Tenant "${tenantName.trim()}" created`);
      setResult(data);
      reset();
      if (onCreated) onCreated();
    } catch (e) {
      notify(e.message || 'Could not create tenant.', 'error');
    }
    setBusy(false);
  };

  const copyLink = () => {
    if (!result?.inviteLink) return;
    navigator.clipboard.writeText(result.inviteLink).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2500); });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div>
          <label className="form-label">Company Name</label>
          <input type="text" placeholder="Acme Leasing Ltd" value={tenantName} onChange={e => updateName(e.target.value)} />
        </div>
        <div>
          <label className="form-label">Tenant Slug</label>
          <input type="text" placeholder="acme-leasing" value={tenantSlug} onChange={e => { setSlugTouched(true); setTenantSlug(e.target.value); }} />
        </div>
      </div>
      <div>
        <label className="form-label">Admin Email</label>
        <input type="email" placeholder="admin@acme-leasing.com" value={adminEmail} onChange={e => setAdminEmail(e.target.value)} />
      </div>

      <div>
        <label className="form-label">Approved Senders (optional — for email-ingested utilisation reports)</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {senders.map((s, i) => (
            <div key={i} style={{ display: 'flex', gap: 8 }}>
              <select value={s.type} onChange={e => updateSender(i, 'type', e.target.value)}
                style={{ background: 'var(--color-technical-grey)', color: 'var(--color-carbon)', border: '1px solid var(--color-divider)', borderRadius: 6, padding: '8px 12px', fontFamily: 'inherit', fontSize: 13, cursor: 'pointer', width: 110, flexShrink: 0 }}>
                <option value="domain">Domain</option>
                <option value="email">Email</option>
              </select>
              <input type="text" placeholder={s.type === 'domain' ? 'lessee-airline.com' : 'ops@partner.com'} value={s.value} onChange={e => updateSender(i, 'value', e.target.value)} style={{ flex: 1 }} />
              {senders.length > 1 && (
                <button onClick={() => removeSender(i)} style={{ background: 'none', border: '1px solid var(--color-divider)', color: 'var(--color-graphite)', borderRadius: 4, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}>Remove</button>
              )}
            </div>
          ))}
          <button onClick={addSender} className="btn btn-ghost" style={{ alignSelf: 'flex-start', fontSize: 11, padding: '5px 10px' }}>+ Add Sender</button>
        </div>
      </div>

      <div className="flab g8">
        <button className="btn btn-gold" onClick={create} disabled={busy}>{busy ? 'Creating…' : 'Create Tenant'}</button>
      </div>

      {result && (
        <div style={{ background: 'var(--color-technical-grey)', border: '1px solid var(--color-divider)', borderRadius: 6, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 12, color: 'var(--color-carbon)' }}>
            Tenant <strong>{result.tenantId}</strong> created — admin account for <strong>{result.adminEmail}</strong>
            {result.emailSent ? ' — invite email sent.' : ' — email not confirmed sent, use the link below.'}
          </div>
          {result.inviteLink && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, color: 'var(--color-graphite)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{result.inviteLink}</span>
              <button onClick={copyLink} style={{ background: 'none', border: '1px solid var(--color-divider)', color: copied ? 'var(--color-positive)' : 'var(--color-graphite)', borderRadius: 4, padding: '4px 10px', fontSize: 11, cursor: 'pointer', flexShrink: 0 }}>{copied ? 'Copied ✓' : 'Copy link'}</button>
            </div>
          )}
        </div>
      )}
      <p style={{ fontSize: 11, color: 'var(--color-graphite)', margin: 0 }}>
        Creates the tenant, its first admin account, and (if provided) an initial approved-senders allowlist for email ingestion. The admin gets an email to set their own password — or share the link above if email delivery isn't confirmed.
      </p>
    </div>
  );
}

function TenantsListCard({ notify, refreshKey }) {
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const rows = await db.getAllTenants();
      setTenants(rows);
    } catch (e) {
      notify(e.message || 'Could not load tenants.', 'error');
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [refreshKey]);

  if (loading) return <p style={{ color: 'var(--color-graphite)', fontSize: 13 }}>Loading tenants…</p>;
  if (!tenants.length) return <p style={{ color: 'var(--color-graphite)', fontSize: 13 }}>No tenants found.</p>;

  return (
    <table style={{ width: '100%' }}>
      <thead><tr><th style={{ textAlign: 'left' }}>Name</th><th style={{ textAlign: 'left' }}>Slug</th><th style={{ textAlign: 'left' }}>Status</th><th style={{ textAlign: 'left' }}>Created</th></tr></thead>
      <tbody>
        {tenants.map(t => (
          <tr key={t.id}>
            <td style={{ fontSize: 13, color: 'var(--color-carbon)', padding: '8px 0', fontWeight: 600 }}>{t.name || '—'}</td>
            <td style={{ fontSize: 12, color: 'var(--color-graphite)', fontFamily: 'monospace' }}>{t.id}</td>
            <td><span style={{ fontSize: 11, fontWeight: 700, color: t.status === 'active' ? 'var(--color-positive)' : 'var(--color-graphite)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t.status || '—'}</span></td>
            <td style={{ fontSize: 12, color: 'var(--color-graphite)' }}>{t.createdAt ? new Date(t.createdAt).toLocaleDateString() : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PlatformView({ notify }) {
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div style={{ maxWidth: 760, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <div className="section-title" style={{ fontSize: 18 }}>Platform Admin</div>
        <p style={{ fontSize: 12, color: 'var(--color-graphite)', marginTop: 4 }}>
          Provision new companies onto TailiQ. This screen is separate from — and above — the per-tenant Settings/Users screen; only super-admin accounts can see it.
        </p>
      </div>

      <div className="card" style={{ padding: 20 }}>
        <div className="section-title">Create Tenant</div>
        <p style={{ fontSize: 12, color: 'var(--color-graphite)', margin: '4px 0 14px' }}>Sets up a new company with its own isolated data and first admin account.</p>
        <CreateTenantCard notify={notify} onCreated={() => setRefreshKey(k => k + 1)} />
      </div>

      <div className="card" style={{ padding: 20 }}>
        <div className="section-title">Tenants</div>
        <p style={{ fontSize: 12, color: 'var(--color-graphite)', margin: '4px 0 14px' }}>Read-only. Suspend/usage management is not built yet.</p>
        <TenantsListCard notify={notify} refreshKey={refreshKey} />
      </div>
    </div>
  );
}

export { PlatformView };