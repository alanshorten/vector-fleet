// Fleet Findings Workflow — shared sync helper (claude_ui-p2-build-handoff.md
// Item 1). Originally this assemble-then-sync orchestration lived only
// inside FlyForward.jsx's own load effect, since Brain 3/6/7's inputs were
// only ever fully assembled there — Session B deliberately didn't wire it
// into the other save flows (Upload, Lease Wizard, Completed Event) to
// avoid a second parallel assembly quietly drifting from what the
// Financials tab itself computes.
//
// 20 Aug 2026 (live-test follow-up): Alan confirmed that in real usage,
// pot bands only actually move on a monthly utilisation upload — lease
// edits and completed events are rare, one-off actions by comparison. So
// rather than wiring into every save flow (the original drift concern),
// this wires into just the utilisation-save flows. This file is the ONE
// shared place that assembly now lives, so FlyForward.jsx and the
// utilisation-save call sites (UploadView.jsx x2, Dashboard.jsx's
// ReviewQueueBanner) all run the identical calculation instead of
// copy-pasting it.

import { db } from './db';
import { buildFlyForwardProjection, computeEngineEOLResults, summariseAssetEOLPosition } from './flyForwardHelpers';
import { getEndOfLeaseTermsDefaults } from './knowledgeBase';
import { isCFM } from './assetHelpers';

// Given already-assembled Brain 3 inputs (what FlyForward's own load
// effect already has in React state), runs the findings engine and
// executes whatever actions come back. Never throws — a findings sync
// failure should never block whatever action triggered it (same
// non-fatal posture as db.syncAssetFindings itself).
export async function syncFindingsFromAssembled({ asset, lease, reserveDocs, utilRate, scheduledEvents, seasonalityProfile, costProjections }) {
  try {
    if (!lease || !window.evaluateAssetFindings) return; // no active lease, or findingsEngine.js not loaded
    const engineFamily = isCFM(asset) ? "CFM" : "V2500";
    const { rate: findingsRate, projections: findingsProjections, maintenanceCal: findingsMaintCal, projectionError: findingsError } =
      buildFlyForwardProjection({ asset, lease, reserveDocs, utilRate, scheduledEvents, seasonalityProfile, costProjections });
    if (findingsError) return;
    const terms = lease.endOfLeaseTerms || getEndOfLeaseTermsDefaults();
    const eolPositionSummary = terms.applies
      ? summariseAssetEOLPosition(computeEngineEOLResults(asset, lease, findingsProjections, findingsRate, engineFamily))
      : { uncomputable: true };
    await db.syncAssetFindings(asset, {
      potProjections: findingsProjections,
      maintenanceEvents: findingsMaintCal?.events || [],
      leaseEndDate: lease.leaseEnd ? new Date(lease.leaseEnd) : null,
      eolPosition: eolPositionSummary
    });
  } catch (e) {
    console.warn("Findings sync failed:", e);
  }
}

// Convenience wrapper for call sites that only have `asset` in scope —
// the 3 utilisation-save flows. Fetches everything buildFlyForwardProjection
// needs itself, using the exact same db.js getters FlyForward's own load
// effect uses (getLease/getReservePots/getUtilisation/getScheduledEvents/
// getSeasonalityProfile/getShopVisitProjections), then delegates to
// syncFindingsFromAssembled above. Never throws, same reason as above —
// call this fire-and-forget right after a utilisation save; it should
// never be able to block or fail that save.
export async function computeAndSyncFindingsForAsset(asset) {
  try {
    if (!asset?.id || !asset.currentLeaseId) return; // no active lease yet — nothing to check
    const [lease, reserveDocs, util, scheduledEvents, seasonalityProfile, costProjections] = await Promise.all([
      db.getLease(asset.currentLeaseId).catch(() => null),
      db.getReservePots(asset.id).catch(() => []),
      db.getUtilisation(asset.id).catch(() => []),
      db.getScheduledEvents(asset.id).catch(() => []),
      db.getSeasonalityProfile(asset.id).catch(() => null),
      db.getShopVisitProjections(asset.id).catch(() => [])
    ]);
    if (!lease) return;
    const utilRate = window.computeRealUtilisationRate(util);
    await syncFindingsFromAssembled({ asset, lease, reserveDocs, utilRate, scheduledEvents, seasonalityProfile, costProjections });
  } catch (e) {
    console.warn("Findings sync (post-utilisation) failed:", e);
  }
}