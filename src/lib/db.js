const CLOUD_NAME = () => window._cloudinaryConfig?.cloudName;

const UPLOAD_PRESET = () => window._cloudinaryConfig?.uploadPreset;

const getFS = () => {
  if (window._firestore) return window._firestore;
  throw new Error("Firebase not ready");
};

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
    const snap = await getDocs(collection(fs, "assets"));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },
  async saveAsset(asset) {
    const { db: fs, doc, setDoc } = getFS();
    const { _dbId, _updatedAt, ...data } = asset;
    await setDoc(doc(fs, "assets", String(asset.id)), { ...data, updatedAt: new Date().toISOString() });
  },
  async deleteAsset(id) {
    const { db: fs, doc, deleteDoc } = getFS();
    await deleteDoc(doc(fs, "assets", String(id)));
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
  // Token doc ID is the token itself, so the public /api/share/[token]
  // function can do a direct doc lookup with no query/index needed.
  async createShareToken(assetId, companyId = null) {
    const { db: fs, doc, setDoc } = getFS();
    const token = (window.crypto?.randomUUID ? window.crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2)).replace(/-/g, "");
    const now = new Date();
    const expires = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7-day default
    const data = {
      assetId: String(assetId),
      companyId,
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
  // leases/ is append-only — a lease's dates/lessee genuinely change at
  // each transition (unlike reserve pots, which carry over), so history
  // is preserved rather than overwritten. Which lease is "current" is
  // tracked via asset.currentLeaseId (set on the asset doc via saveAsset,
  // not here) — createLease only writes the lease record itself.
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
      derateModifier: null,        // reserved slot — TECH_DEBT 4.24, dedicated Opus session, not v1
      redeliveryConditions: null,  // reserved slot — Layer 3, not v1
      // Set by Bulk Lease Import (Section 8) when a batch parse found
      // reserve rates but the asset's own Lease Wizard hasn't been
      // opened yet to confirm opening balances. Same shape as
      // LeaseWizard's in-session aiPotPrefill state ({CODE:{accrualRate}}),
      // just persisted so it survives to the next time this asset's
      // wizard is opened — see the pots-loading effect's aiRateFor().
      aiPotPrefill: leaseData.aiPotPrefill || null,
      inputMethod: "manual",       // Path 2 — manual entry (Path 1 PDF parsing parked)
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
  // Deliberate exception to the append-only principle above — this is
  // for correcting a mistaken/test lease entry, not for real lease
  // history. Reserve pots are NOT touched (they carry over independent
  // of any single lease record) — only the lease doc itself is removed,
  // and the caller is responsible for clearing asset.currentLeaseId.
  async deleteLease(leaseId) {
    const { db: fs, doc, deleteDoc } = getFS();
    await deleteDoc(doc(fs, "leases", leaseId));
  },
  // reserves/ is one doc per pot (not a consolidated array), doc id
  // deterministic as `${assetId}_${code}` — this is what makes reserve
  // pots naturally carry over across lease transitions (per Alan's
  // domain knowledge: a new lease does NOT reset pot balances, so
  // re-opening this wizard for a lease transition upserts the same pot
  // docs rather than creating duplicates). companyId is duplicated onto
  // the doc for cheap security-rule matching, per Section 5.
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
      // Outflow side (VECTORIQ_ROADMAP.md Section 4 schema) — added when
      // Fly-Forward was wired to real leases/reserves data (previously
      // only the accrual side was persisted here).
      triggerBasis: pot.triggerBasis,
      triggerInterval: pot.triggerInterval || null,
      escalationRegime: pot.escalationRegime || "flat_annual",
      catalogueRef: pot.catalogueRef || null,
      outflowCostBaseYear: pot.outflowCostBaseYear,
      outflowEscalationPct: pot.outflowEscalationPct,
      projectedCostLow: pot.projectedCostLow,
      projectedCostHigh: pot.projectedCostHigh,
      derateModifier: null, // reserved — TECH_DEBT 4.24, not v1
      // EN-LP only
      harvestThresholdFC: pot.harvestThresholdFC ?? null,
      stubBufferPct: pot.stubBufferPct ?? null,
      fullStackReplacementCost: pot.fullStackReplacementCost ?? null,
      engineFamily: pot.engineFamily ?? null,
      // EN-PR only — first-PR anchoring
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
  // --- Maintenance Calendar (Brain 6-adjacent, TECH_DEBT.md 4.38-4.40 follow-up) ---
  // scheduledEvents: override/duration-config layer, NOT the calendar itself
  // (VECTORIQ_ROADMAP.md Section 5 — reshaped from the old unbuilt stub).
  // Deterministic doc id (assetId_code_dueCycle) so accepting a seasonality
  // suggestion or entering an airline-stated date upserts the same
  // occurrence rather than growing a log — maintenanceCal.js's identity
  // key (code + due-cycle) is load-bearing here, not just internal to it.
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
      source: override.source, // derived | seasonality | airline-stated — airline-stated is sticky, see maintenanceCal.js resolveDate()
      confirmedBy: window._authUser?.email || window._authUser?.uid || null,
      confirmedAt: now,
      updatedAt: now
    };
    await setDoc(doc(fs, "scheduledEvents", id), data);
    return { id, ...data };
  },
  // Reverts an occurrence back to Brain 6's own derived date by deleting
  // the override doc entirely (rather than writing source:"derived") —
  // maintenanceCal.js's findOverride() then naturally returns null for
  // it again, no special-case handling needed on the read side.
  async deleteScheduledEventOverride(assetId, code, dueCycle) {
    const { db: fs, doc, deleteDoc } = getFS();
    const id = `${assetId}_${code}_${dueCycle}`.replace(/\s+/g, "_");
    await deleteDoc(doc(fs, "scheduledEvents", id));
  },
  // seasonalityProfile: one reviewed/editable profile per asset — NOT
  // append-only (unlike shopVisitProjections below). Doc id = assetId
  // directly, same "single active config doc" pattern as reserves/leases.
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
      monthlyWeightings: profile.monthlyWeightings, // { Jan..Dec: number }
      patternDetected: !!profile.patternDetected, // tier-2 auto-detection — separate future work, manual-entry only for now
      confirmedBy: window._authUser?.email || window._authUser?.uid || null,
      confirmedAt: now,
      createdAt: (existing && existing.exists() ? existing.data().createdAt : null) || now
    };
    await setDoc(ref, data);
    return { id: String(assetId), ...data };
  },
  // shopVisitProjections: APPEND-ONLY history log (Section 5 critical
  // rule) — a new doc per snapshot, never overwritten. Written on a
  // monthly cadence per asset+code by FlyForward's snapshot effect, not
  // on every view load. Deliberately a passive historical record only —
  // never read back into the live projection numbers (Alan, July 2026:
  // that's what the Layer 2 sliders are for, not this).
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
      llpWorkscope: projection.llpWorkscope || null, // EN-LP only — not populated this session, see FlyForward snapshot effect note
      confidence: projection.confidence || "monthly-snapshot",
      calculatedAt: now
    };
    await addDoc(collection(fs, "shopVisitProjections"), data);
    return data;
  },
  // --- Email review queue (Section 12a) ---
  // Staged reports held back by api/email-ingest.js when a high-severity
  // warning (S/N change, delta mismatch, gap) is detected — see
  // hasHighSeverityWarning() there. Apply/Discard act on these.
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
