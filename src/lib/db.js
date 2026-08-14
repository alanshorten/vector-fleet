const CLOUD_NAME = () => window._cloudinaryConfig?.cloudName;

const UPLOAD_PRESET = () => window._cloudinaryConfig?.uploadPreset;

const getFS = () => {
  if (window._firestore) return window._firestore;
  throw new Error("Firebase not ready");
};

// security-remediation-roadmap.md Phase 3 (tenant isolation), Session 1.
// Resolves the signed-in user's tenantId from their own ID token claims —
// never from client input, matching the roadmap's server-side rule applied
// here too. getIdTokenResult() (no force-refresh) reads the SDK's already-
// cached token, so this is cheap to call per-operation; it only goes stale
// if a user's tenantId claim changed since their last token refresh, which
// App.jsx's existing 45s poll (and the bootstrap-admin call on every sign-in
// / reload) already handles for the tenantId-backfill case.
// Session 1 scope: only assets/{id} moves to /tenants/{tenantId}/assets/{id}
// below. Every other collection (utilisation, leases, reserves, shareTokens,
// scheduledEvents, seasonalityProfile, pendingReports, settings, etc.) stays
// on its old flat path until a follow-up session migrates it — see the
// roadmap's Phase 3 sequencing. Do NOT tenant-root a collection here without
// also migrating its Firestore rule and any existing documents first.
async function getTenantId() {
  // window._auth is this app's own auth wrapper, not the raw Firebase Auth
  // SDK object — it exposes getIdTokenResult()/getIdToken() directly on
  // itself (no .currentUser), same as App.jsx already calls it elsewhere.
  // Caught live during Phase 3 rollout: an earlier version of this function
  // used window._auth.currentUser.getIdTokenResult(), which would have
  // thrown "Cannot read properties of undefined" on every asset load.
  if (!window._auth) throw new Error("Not signed in");
  const tokenResult = await window._auth.getIdTokenResult();
  if (!tokenResult) throw new Error("Not signed in");
  const tenantId = tokenResult.claims.tenantId;
  if (!tenantId) throw new Error("Your account is missing tenant access — try signing out and back in. If that doesn't fix it, contact an admin.");
  return tenantId;
}

async function logAudit(assetId, assetMSN, action) {
  try {
    const user = window._authUser;
    if (!user) return;
    const { db: fs, collection, addDoc } = getFS();
    await addDoc(collection(fs, "auditLog"), {
      userId: user.uid,
      userEmail: user.email,
      timestamp: new Date().toISOString(),
      assetId: assetId != null ? String(assetId) : null,
      assetMSN: assetMSN != null ? String(assetMSN) : null,
      action
    });
  } catch (e) {
    // Non-fatal — never block the main operation
    console.warn("Audit log write failed:", e);
  }
};

const db = {
  async getAssets() {
    const { db: fs, collection, getDocs } = getFS();
    const tenantId = await getTenantId();
    const snap = await getDocs(collection(fs, "tenants", tenantId, "assets"));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },
  async saveAsset(asset) {
    const { db: fs, doc, setDoc } = getFS();
    const tenantId = await getTenantId();
    const { _dbId, _updatedAt, ...data } = asset;
    await setDoc(doc(fs, "tenants", tenantId, "assets", String(asset.id)), { ...data, updatedAt: new Date().toISOString() });
  },
  // Cascade delete (follow-up from security-remediation-roadmap.md Phase 1
  // session, 2026-08-14): this used to only remove the assets/{id} document,
  // leaving every related record — utilisation history, pending review
  // reports, lease/reserve financial data, calendar overrides, share links —
  // orphaned in Firestore. Assets (and prospects) are always keyed by their
  // own natural ID (MSN for aircraft, ESN for engine prospects — see
  // makeBlankAsset / makeBlankEngineProspect in assetHelpers.js and the
  // newMSN-as-id logic in calculations/utilisation.js), never a random
  // Firestore ID, so deleting an asset and later creating a new one with the
  // same MSN landed at the exact same document path — and all that orphaned
  // data silently reattached.
  //
  // Scope confirmed with Alan (2026-08-14, revised same day after an initial
  // "everything bar auditLog" pass): this only removes this customer's own
  // operational tracking record for the asset. It deliberately does NOT
  // touch real-world outcome data that compiles into the fleet-wide IQ
  // database, since that has ongoing analytical value independent of
  // whether any one customer is still actively tracking the asset:
  //   - auditLog — immutable everywhere else in this file and in
  //     firestore.rules (rules literally forbid delete on it); deleting an
  //     asset is itself an audited action, so the record of what happened
  //     to it should survive the asset itself.
  //   - shopVisitProjections — same append-only design as auditLog
  //     (firestore.rules also forbids delete on it outright).
  //   - completedEvents — actual logged maintenance completions with real
  //     costs entered; kept for the same "real-world outcome data" reason
  //     as shopVisitProjections, even though firestore.rules doesn't
  //     currently have an explicit rule for this collection either way
  //     (flagged separately — see TECH_DEBT.md).
  // Utilisation history and seasonalityProfile, by contrast, ARE deleted —
  // they're this customer's own tracking/forecasting state, not compiled
  // fleet intelligence, so a re-created asset at the same MSN starts clean.
  async deleteAsset(id) {
    const { db: fs, doc, collection, query, where, getDocs, writeBatch } = getFS();
    const assetId = String(id);
    // Only the assets doc itself is tenant-rooted this session (Phase 3
    // Session 1 scope — see getTenantId() above). Every other collection
    // referenced below (utilisation, shareTokens, leases, reserves,
    // scheduledEvents, pendingReports, seasonalityProfile) is still on its
    // old flat path and stays that way until its own migration session —
    // do not tenant-root those doc() calls without migrating them first.
    const tenantId = await getTenantId();

    // Collections that reference the asset via an assetId/asset_id field —
    // queried and every matching doc queued for deletion. shopVisitProjections
    // and completedEvents are deliberately NOT in this list — see comment above.
    const byAssetId = [
      { name: "utilisation", field: "asset_id" },
      { name: "shareTokens", field: "assetId" },
      { name: "leases", field: "assetId" },
      { name: "reserves", field: "assetId" },
      { name: "scheduledEvents", field: "assetId" },
    ];

    const refsToDelete = [];
    for (const { name, field } of byAssetId) {
      const q = query(collection(fs, name), where(field, "==", assetId));
      const snap = await getDocs(q);
      snap.docs.forEach(d => refsToDelete.push(doc(fs, name, d.id)));
    }

    // pendingReports has no assetId field — a pending report can exist for
    // an MSN that doesn't have a live asset yet (isNewAsset case), so it's
    // correlated by msn instead. Since asset IDs are always the MSN itself,
    // assetId here IS the msn to match against.
    const pendingQ = query(collection(fs, "pendingReports"), where("msn", "==", assetId));
    const pendingSnap = await getDocs(pendingQ);
    pendingSnap.docs.forEach(d => refsToDelete.push(doc(fs, "pendingReports", d.id)));

    // seasonalityProfile is a single doc keyed directly by assetId (not a
    // query) — deleting a non-existent doc ref is a harmless no-op in
    // Firestore, so no existence check needed for assets that never had one.
    refsToDelete.push(doc(fs, "seasonalityProfile", assetId));

    // The asset document itself, deleted last. Tenant-rooted (Phase 3
    // Session 1) — the flat assets/{id} doc this migrated from is left
    // alone; it's orphaned, not deleted, so there's a rollback copy until a
    // later cleanup session removes it.
    refsToDelete.push(doc(fs, "tenants", tenantId, "assets", assetId));

    // Firestore batches cap at 500 writes — chunk defensively even though a
    // single asset is very unlikely to approach that at this scale.
    const CHUNK = 450;
    for (let i = 0; i < refsToDelete.length; i += CHUNK) {
      const batch = writeBatch(fs);
      refsToDelete.slice(i, i + CHUNK).forEach(ref => batch.delete(ref));
      await batch.commit();
    }
  },
  async getSetting(key) {
    try {
      const { db: fs, doc, getDoc } = getFS();
      const snap = await getDoc(doc(fs, "settings", key));
      return snap.exists() ? snap.data().value : null;
    } catch { return null; }
  },
  async setSetting(key, value) {
    const { db: fs, doc, setDoc } = getFS();
    await setDoc(doc(fs, "settings", key), { value });
  },
  async getUtilisation(asset_id) {
    const { db: fs, collection, query, where, getDocs } = getFS();
    const q = query(collection(fs, "utilisation"), where("asset_id", "==", String(asset_id)));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
  },
  async saveUtilisation(data) {
    const { db: fs, collection, addDoc } = getFS();
    await addDoc(collection(fs, "utilisation"), { ...data, asset_id: String(data.asset_id), created_at: new Date().toISOString() });
  },
  async deleteUtilisation(id) {
    const { db: fs, doc, deleteDoc } = getFS();
    await deleteDoc(doc(fs, "utilisation", id));
  },
  // --- Share tokens (V1 gate item, Section 12 of roadmap) ---
  // enginePos: when set, this token shares just one engine (position 1 or 2)
  // out of a two-engine aircraft, rather than the whole asset — used by the
  // per-engine "Standalone Engine Spec" share on aircraft Prospects. null
  // for a normal whole-asset share (including standalone engine prospects,
  // which are already single-engine by nature and don't need this).
  async createShareToken(assetId, companyId = null, enginePos = null) {
    const { db: fs, doc, setDoc } = getFS();
    const token = (window.crypto?.randomUUID ? window.crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2)).replace(/-/g, "");
    const now = new Date();
    const expires = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7-day default
    const data = {
      assetId: String(assetId),
      companyId,
      enginePos: enginePos || null,
      createdAt: now.toISOString(),
      expiresAt: expires.toISOString(),
      revoked: false,
      createdBy: window._authUser?.email || window._authUser?.uid || null
    };
    await setDoc(doc(fs, "shareTokens", token), data);
    return { token, ...data };
  },
  async getShareTokensForAsset(assetId) {
    const { db: fs, collection, query, where, getDocs } = getFS();
    const q = query(collection(fs, "shareTokens"), where("assetId", "==", String(assetId)));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ token: d.id, ...d.data() }));
  },
  async revokeShareToken(token) {
    const { db: fs, doc, setDoc, getDoc } = getFS();
    const ref = doc(fs, "shareTokens", token);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    await setDoc(ref, { ...snap.data(), revoked: true });
  },
  // --- Lease / Reserve Setup (Section 8/9 of roadmap, TECH_DEBT 4.25) ---
  async createLease(assetId, companyId, leaseData) {
    const { db: fs, collection, addDoc } = getFS();
    const now = new Date().toISOString();
    const data = {
      assetId: String(assetId),
      companyId: companyId || null,
      lessee: leaseData.lessee,
      leaseStart: leaseData.leaseStart,
      leaseEnd: leaseData.leaseEnd,
      migrationDate: leaseData.migrationDate,
      derateModifier: null,
      redeliveryConditions: null,
      // End of Lease Terms (end-of-lease-position-handoff.md §3) — manual
      // entry, KB-defaulted with per-lease override, same append-only
      // lease-record pattern as lessee/leaseStart/leaseEnd above: editing
      // this alone (via LeaseWizard's "eol" step) creates a new lease
      // record, same as editing any other lease detail.
      endOfLeaseTerms: leaseData.endOfLeaseTerms || null,
      aiPotPrefill: leaseData.aiPotPrefill || null,
      inputMethod: "manual",
      confirmedBy: window._authUser?.email || window._authUser?.uid || null,
      confirmedAt: now,
      createdAt: now
    };
    const ref = await addDoc(collection(fs, "leases"), data);
    return { id: ref.id, ...data };
  },
  async getLeasesForAsset(assetId) {
    const { db: fs, collection, query, where, getDocs } = getFS();
    const q = query(collection(fs, "leases"), where("assetId", "==", String(assetId)));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
  },
  async getLease(leaseId) {
    if (!leaseId) return null;
    const { db: fs, doc, getDoc } = getFS();
    const snap = await getDoc(doc(fs, "leases", leaseId));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  },
  async deleteLease(leaseId) {
    const { db: fs, doc, deleteDoc } = getFS();
    await deleteDoc(doc(fs, "leases", leaseId));
  },
  // TAC (Technical Acceptance Certificate) snapshot — end-of-lease-position-
  // handoff.md §4b / eol-position-session-handoff.md §4b. Deliberately a
  // MERGE WRITE onto the existing lease doc, NOT a new append-only lease
  // record (unlike createLease above) — a TAC captures a fixed historical
  // fact about delivery that never gets renegotiated the way lessee/dates/
  // endOfLeaseTerms do, so versioning it the same way would just be noise.
  // Re-uploading (e.g. to fix a bad OCR read) simply overwrites this field
  // cleanly; the lease's own append-only fields are untouched either way.
  async saveTACSnapshot(leaseId, tacData) {
    const { db: fs, doc, setDoc } = getFS();
    const now = new Date().toISOString();
    const payload = {
      tacSnapshot: {
        ...tacData,
        confirmedBy: window._authUser?.email || window._authUser?.uid || null,
        confirmedAt: now
      }
    };
    await setDoc(doc(fs, "leases", leaseId), payload, { merge: true });
    return payload.tacSnapshot;
  },
  async saveReservePot(assetId, companyId, pot) {
    const { db: fs, doc, setDoc, getDoc } = getFS();
    const id = `${assetId}_${pot.code}`.replace(/\s+/g, "_");
    const ref = doc(fs, "reserves", id);
    const existing = await getDoc(ref).catch(() => null);
    const now = new Date().toISOString();
    const data = {
      assetId: String(assetId),
      companyId: companyId || null,
      code: pot.code,
      label: pot.label,
      potCategory: pot.potCategory,
      enginePosition: pot.enginePosition ?? null,
      accrualBasis: pot.accrualBasis,
      accrualRate: pot.accrualRate,
      accrualRateBaseYear: pot.accrualRateBaseYear || new Date(now).getFullYear(),
      escalationPctPerYr: pot.escalationPctPerYr,
      openingBalance: pot.openingBalance,
      openingBalanceAsOf: pot.openingBalanceAsOf || now.slice(0, 10),
      triggerBasis: pot.triggerBasis,
      triggerInterval: pot.triggerInterval || null,
      escalationRegime: pot.escalationRegime || "flat_annual",
      catalogueRef: pot.catalogueRef || null,
      outflowCostBaseYear: pot.outflowCostBaseYear,
      outflowEscalationPct: pot.outflowEscalationPct,
      projectedCostLow: pot.projectedCostLow,
      projectedCostHigh: pot.projectedCostHigh,
      derateModifier: null,
      harvestThresholdFC: pot.harvestThresholdFC ?? null,
      stubBufferPct: pot.stubBufferPct ?? null,
      fullStackReplacementCost: pot.fullStackReplacementCost ?? null,
      engineFamily: pot.engineFamily ?? null,
      anchorMode: pot.anchorMode || null,
      lastPRDate: pot.lastPRDate || null,
      validationWarning: pot.validationWarning || null,
      warningAcknowledged: !!pot.warningAcknowledged,
      inputMethod: "manual",
      confirmedBy: window._authUser?.email || window._authUser?.uid || null,
      confirmedAt: now,
      updatedAt: now,
      createdAt: (existing && existing.exists() ? existing.data().createdAt : null) || now
    };
    await setDoc(ref, data);
    return { id, ...data };
  },
  async getReservePots(assetId) {
    const { db: fs, collection, query, where, getDocs } = getFS();
    const q = query(collection(fs, "reserves"), where("assetId", "==", String(assetId)));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },
  async getScheduledEvents(assetId) {
    const { db: fs, collection, query, where, getDocs } = getFS();
    const q = query(collection(fs, "scheduledEvents"), where("assetId", "==", String(assetId)));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },
  async saveScheduledEventOverride(assetId, companyId, override) {
    const { db: fs, doc, setDoc } = getFS();
    const id = `${assetId}_${override.code}_${override.dueCycle}`.replace(/\s+/g, "_");
    const now = new Date().toISOString();
    const data = {
      assetId: String(assetId),
      companyId: companyId || null,
      code: override.code,
      dueCycle: override.dueCycle,
      durationWeeks: typeof override.durationWeeks === "number" ? override.durationWeeks : null,
      scheduledDate: override.scheduledDate || null,
      source: override.source,
      confirmedBy: window._authUser?.email || window._authUser?.uid || null,
      confirmedAt: now,
      updatedAt: now
    };
    await setDoc(doc(fs, "scheduledEvents", id), data);
    return { id, ...data };
  },
  async deleteScheduledEventOverride(assetId, code, dueCycle) {
    const { db: fs, doc, deleteDoc } = getFS();
    const id = `${assetId}_${code}_${dueCycle}`.replace(/\s+/g, "_");
    await deleteDoc(doc(fs, "scheduledEvents", id));
  },
  async getSeasonalityProfile(assetId) {
    const { db: fs, doc, getDoc } = getFS();
    const snap = await getDoc(doc(fs, "seasonalityProfile", String(assetId)));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  },
  async saveSeasonalityProfile(assetId, companyId, profile) {
    const { db: fs, doc, setDoc, getDoc } = getFS();
    const ref = doc(fs, "seasonalityProfile", String(assetId));
    const existing = await getDoc(ref).catch(() => null);
    const now = new Date().toISOString();
    const data = {
      assetId: String(assetId),
      companyId: companyId || null,
      activeWeeksPerYear: profile.activeWeeksPerYear,
      monthlyWeightings: profile.monthlyWeightings,
      patternDetected: !!profile.patternDetected,
      confirmedBy: window._authUser?.email || window._authUser?.uid || null,
      confirmedAt: now,
      createdAt: (existing && existing.exists() ? existing.data().createdAt : null) || now
    };
    await setDoc(ref, data);
    return { id: String(assetId), ...data };
  },
  async getShopVisitProjections(assetId) {
    const { db: fs, collection, query, where, getDocs } = getFS();
    const q = query(collection(fs, "shopVisitProjections"), where("assetId", "==", String(assetId)));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => new Date(b.calculatedAt) - new Date(a.calculatedAt));
  },
  async saveShopVisitProjection(assetId, companyId, projection) {
    const { db: fs, collection, addDoc } = getFS();
    const now = new Date().toISOString();
    const data = {
      assetId: String(assetId),
      companyId: companyId || null,
      code: projection.code,
      component: projection.component || null,
      triggerBasis: projection.triggerBasis || null,
      projectedDate: projection.projectedDate,
      projectedCostLow: projection.projectedCostLow,
      projectedCostLikely: projection.projectedCostLikely ?? null,
      projectedCostHigh: projection.projectedCostHigh,
      outflowEscalationPct: projection.outflowEscalationPct ?? null,
      llpWorkscope: projection.llpWorkscope || null,
      confidence: projection.confidence || "monthly-snapshot",
      calculatedAt: now
    };
    await addDoc(collection(fs, "shopVisitProjections"), data);
    return data;
  },
  // --- Knowledge Base (knowledge-base-scoping-handoff.md, July 2026) ---
  async getKnowledgeBase(companyId = null) {
    const { db: fs, doc, getDoc } = getFS();
    const id = companyId || "default";
    const snap = await getDoc(doc(fs, "knowledgeBase", id));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  },
  async saveKnowledgeBase(companyId, data) {
    const { db: fs, doc, setDoc, getDoc } = getFS();
    const id = companyId || "default";
    const ref = doc(fs, "knowledgeBase", id);
    const existing = await getDoc(ref).catch(() => null);
    const now = new Date().toISOString();
    const payload = {
      ...data,
      companyId: companyId || null,
      updatedBy: window._authUser?.email || window._authUser?.uid || null,
      updatedAt: now,
      createdAt: (existing && existing.exists() ? existing.data().createdAt : null) || now
    };
    await setDoc(ref, payload);
    return { id, ...payload };
  },
  async getLLPCatalogue(companyId = null) {
    const { db: fs, collection, getDocs } = getFS();
    const id = companyId || "default";
    const snap = await getDocs(collection(fs, "knowledgeBase", id, "llpCatalogue"));
    return snap.docs.map(d => ({ partNumber: d.id, ...d.data() }));
  },
  // entries: [{ partNumber, unitPrice, engineFamily, catalogueYear }, ...]
  // Uses writeBatch if getFS() exposes it (atomic, single round trip);
  // falls back to sequential setDoc via Promise.all otherwise — either
  // way is fine at this scale (~50-60 entries), the batch path is just
  // preferred when available.
  async saveLLPCataloguePrices(companyId, entries) {
    const { db: fs, doc, setDoc, writeBatch } = getFS();
    const id = companyId || "default";
    const now = new Date().toISOString();
    const payloadFor = e => ({
      unitPrice: e.unitPrice,
      engineFamily: e.engineFamily,
      catalogueYear: e.catalogueYear,
      updatedBy: window._authUser?.email || window._authUser?.uid || null,
      updatedAt: now
    });
    if (typeof writeBatch === "function") {
      const batch = writeBatch(fs);
      entries.forEach(e => batch.set(doc(fs, "knowledgeBase", id, "llpCatalogue", e.partNumber), payloadFor(e)));
      await batch.commit();
      return;
    }
    await Promise.all(entries.map(e =>
      setDoc(doc(fs, "knowledgeBase", id, "llpCatalogue", e.partNumber), payloadFor(e))
    ));
  },
  // --- SV Cost Tracker (monthly-report-cost-tracker-handoff.md §2, TECH_DEBT.md 4.101) ---
  // Append-only, same pattern as saveShopVisitProjection/saveUtilisation —
  // one addDoc per completed event, never overwritten. "Cleared" from the
  // pending-completion nudge is determined by a matching code+dueCycle
  // record existing here, not by deleting anything from scheduledEvents.
  async getCompletedEvents(assetId) {
    const { db: fs, collection, query, where, getDocs } = getFS();
    const q = query(collection(fs, "completedEvents"), where("assetId", "==", String(assetId)));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => new Date(b.confirmedAt) - new Date(a.confirmedAt));
  },
  // Fleet-wide read — no assetId filter. Used by FleetCompletedEventsView
  // on the fleet Calendar tab to show all logged events across all assets.
  // Same single-tenant pattern as getAssets() — no companyId filter needed
  // at current scale (all data in one Firestore instance).
  async getAllCompletedEvents() {
    const { db: fs, collection, getDocs } = getFS();
    const snap = await getDocs(collection(fs, "completedEvents"));
    return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => new Date(b.confirmedAt) - new Date(a.confirmedAt));
  },
  async saveCompletedEvent(assetId, companyId, data) {
    const { db: fs, collection, addDoc } = getFS();
    const now = new Date().toISOString();
    const payload = {
      assetId: String(assetId),
      companyId: companyId || null,
      // Identity — links this record back to the scheduledEvents/
      // shopVisitProjections entry it completes, same code+dueCycle key
      // used everywhere else in this file (saveScheduledEventOverride etc).
      code: data.code,
      label: data.label || null,
      dueCycle: data.dueCycle ?? null,
      eventDateProjected: data.eventDateProjected || null,
      // Required trio (per locked schema) — genuinely null on a Dismiss,
      // which is deliberate: "completed, no cost data" is an honest gap,
      // not a hidden one, so this must NOT be validated as required here.
      mroRegion: data.mroRegion || null,
      totalCost: data.totalCost ?? null,
      // Optional
      mroName: data.mroName || null,
      turnaroundWeeks: data.turnaroundWeeks ?? null,
      dateIn: data.dateIn || null,
      dateOut: data.dateOut || null,
      svNumber: data.svNumber ?? null, // engine/APU only — 1st/2nd/3rd SV on this engine
      routineCost: data.routineCost ?? null,
      nonRoutineCost: data.nonRoutineCost ?? null,
      workscopeLines: data.workscopeLines || [], // [{type, cost, plannedOrFinding, notes}]
      scopeNotes: data.scopeNotes || "",
      // Derived (computed by the caller from asset/event data, not user-entered)
      projectedCostLow: data.projectedCostLow ?? null,
      projectedCostHigh: data.projectedCostHigh ?? null,
      projectedCostLikely: data.projectedCostLikely ?? null,
      costDelta: data.costDelta ?? null,
      assetAgeAtEventYears: data.assetAgeAtEventYears ?? null,
      assetType: data.assetType || null,
      engineFamily: data.engineFamily || null,
      noCostData: !!data.noCostData,
      status: data.noCostData ? "completed_no_cost_data" : "completed",
      inputMethod: "manual",
      confirmedBy: window._authUser?.email || window._authUser?.uid || null,
      confirmedAt: now,
      createdAt: now
    };
    const ref = await addDoc(collection(fs, "completedEvents"), payload);
    return { id: ref.id, ...payload };
  },
  // Correction path (2026-08-14 follow-up): completedEvents is otherwise
  // append-only by design — see the header comment above — because it's
  // real-world outcome data intended to eventually compile into the
  // cross-fleet IQ database, so asset deletion deliberately never cascades
  // into it (see deleteAsset above). But "append-only" was never meant to
  // mean "a mis-entered or test record can never be removed" — Alan hit
  // this directly logging a $999,999 test entry against a real asset while
  // testing the picker fix. Bad/test data has no business staying in a
  // dataset meant to feed real cost benchmarking, so this is a narrow,
  // audited escape hatch: admin/editor only (firestore.rules already gates
  // completedEvents writes — which include deletes — to admin/editor, same
  // as scheduledEvents/seasonalityProfile), and every deletion is logged
  // to auditLog by the caller (see CompletedEventsHistory in FlyForward.jsx)
  // so there's a permanent record that a completion entry was removed, even
  // though the entry itself is gone.
  async deleteCompletedEvent(id) {
    const { db: fs, doc, deleteDoc } = getFS();
    await deleteDoc(doc(fs, "completedEvents", id));
  },
  // --- Email review queue (Section 12a) ---
  async getPendingReports() {
    const { db: fs, collection, getDocs } = getFS();
    const snap = await getDocs(collection(fs, "pendingReports"));
    return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => new Date(a.createdAt) - new Date(b.createdAt));
  },
  async deletePendingReport(id) {
    const { db: fs, doc, deleteDoc } = getFS();
    await deleteDoc(doc(fs, "pendingReports", id));
  }
};


export { CLOUD_NAME, UPLOAD_PRESET, db, getFS, logAudit };