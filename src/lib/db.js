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
