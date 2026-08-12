# TailiQ — Master Roadmap & Reference Document
**Created:** June 2026  
**Author:** Alan Shorten  
**Built with:** Claude (Anthropic) — AI-assisted development  
**Status:** Active internal tool, Layer 1 stable, V1 IT/Security Gate checklist **7 of 7 complete with no fast-follow items remaining** — email ingestion built, tested with real emails, and the warnings-visibility gap is now closed via a Dashboard Review Queue (see Section 12a). Landing Gear redesign (Section 3b) is done. Self-service user invite flow is done (custom domain `app.tailiq.app` live, dual-origin CORS, three bugfixes shipped along the way — see `TECH_DEBT.md` 4.9). Tech spec cover QR code built and disabled for internal use (code retained), APU now has its own tech spec page, and the product naming question is resolved (see below). Layer 2's Lease / Reserve Setup (Section 9) is built — real `leases`/`reserves` Firestore schema, 3-step wizard, AI + deterministic pot validation (`TECH_DEBT.md` 4.25–4.27). Firestore security rules rewritten from a permissive wildcard to role-gated writes, **tested and deployed to production** (`TECH_DEBT.md` 4.28) — `companyId` scoping remains the one genuinely open security item (4.29). **Fly-Forward is now wired to real data** (`TECH_DEBT.md` 4.32) — the fabricated Fly-Forward Demo has been retired; Brains 3/4/5 read real `leases`/`reserves` and project against them, open to Viewer role read-only, reachable from both `AssetView` and the Fleet Portfolio dashboard (`TECH_DEBT.md` 4.33), and both entry points now gate on `asset.currentLeaseId` so Fly Forward never opens for an asset with no lease data. **Lease Data Input is now fully built for both single-asset and bulk upload** (`TECH_DEBT.md` 4.35–4.36) — Quick Extract + Confidential Extract for one asset at a time, plus Bulk Lease Import (multi-file queue, MSN/registration auto-match, tier-once-per-batch, and a two-button Save Details for Later / Activate Lease split that writes real reserve pot docs immediately rather than requiring a follow-up per-asset visit). **Brain 6 (Maintenance Calendar Engine) is now built and wired into Fly-Forward's two-pass assembly** (`TECH_DEBT.md` 4.38–4.40, 4.44) — `scheduledEvents`/`seasonalityProfile`/`shopVisitProjections` Firestore collections are built, with a `MaintenanceCalendarView` UI to consume them; **the Firestore rules covering these three collections are now deployed and tested in production** (Admin/Editor writes confirmed working on `scheduledEvents`/`seasonalityProfile`, Viewer writes correctly rejected, `shopVisitProjections` create confirmed working for Viewer) — this closes the last open item from the Brain 6 handoff. **Fixed reserve pot accrual basis bugs found and fixed** (`TECH_DEBT.md` 4.49) — `validatePotWithAI` was wrongly asserting flight-hour accrual as the norm for every non-engine pot, and the accrual-basis dropdown was missing its `per_APU_hr` option entirely; both fixed. **Avionics LRU List rebuilt from scratch** (`TECH_DEBT.md` 4.50, supersedes 4.14) — the old fixed 8-field Avionics tab is retired in favour of a real spec-sheet-parsed inventory (upload PDF → AI extraction → review/edit → save), grouped by ATA chapter with independent per-row/per-chapter visibility toggles, rendered into the tech spec with a whole-page two-column split above ~25 visible rows. **Fleet Exposure View is now built** (`TECH_DEBT.md` 4.45) — a new pure `calculations/fleetExposure.js` module aggregates the same Fly-Forward atoms across the whole fleet (headline, time axis, asset axis, typed exclusions); the per-asset "asset risk dashboard" line item is scoped out permanently, not deferred. Two questions raised at that build's close remain genuinely open: whether Fleet Exposure should be gated by role (currently open to every Viewer), and a broader nav-IA / layer-based restructure question (Section 19). **July 2026 — TailiQ Engines identified as a future product thread in a commercial/competitive session — needs its own dedicated Opus scoping session before any build. Full detail in `COMMERCIAL_VISION.md` §5.** **July 2026 — tech spec competitive comparison session (`TECH_DEBT.md` 4.51, no code changed):** reviewed against three real third-party specs (GECAS/TAP, Deucalion, Kahala) plus ten real avionics spec sheets; confirmed existing Avionics grouping, engine LLP shape, and most-recent-only shop-visit display all match or exceed market practice. Three items queued for a build session — Check facility field, Annual utilisation/FH:CY ratio stat, and an Avionics Manufacturer field (independently optional, AI best-effort, partially reversing 4.50's original drop). Registration history, airframe certification basis, an Airfleets.net scrape, and a Kahala-style dual-engine summary card were all considered and dropped/parked — see `TECH_DEBT.md` 4.51 and Section 19. **July 2026 — engine cover art set is now complete for all 8 supported engine families** (CFM56-5B, CFM56-7B, V2500-A5, LEAP-1A, LEAP-1B, PW1100G, CF34, CF6), each background color-corrected to the exact locked navy `#102A43` via a uniform pixel-shift fix — see `TECH_DEBT.md` Section 0a for full detail. This was the last open item carried forward from the TailiQ Engines scoping session (`tailiq-engines-scoping-handoff.md` §12) and is no longer outstanding. **July 2026 — Layer 3 (Scenarios) fully scoped in an Opus session — see `layer3-scenarios-build-handoff.md`.** This was the one major Layer 2/3 surface with zero prior design work; it is now ready for a Sonnet build session. Key outcomes: AI narrative summaries confirmed alive for Layer 3 as a scoped exception to the deterministic-outputs-only principle (hypothetical "what if" context only, does not reopen the kill on Layer 1/2 narrative); per-asset scenario exploration (three sliders — utilisation rate, lease extension, FH:FC ratio — plus a one-at-a-time natural-language chat box, side-by-side base case vs. scenario) lives inside a restructured asset view; the Route Suitability Matcher (Section 11) is re-scoped with a concrete input (FH/month, FC/month, start/end date) and dual operational+financial ranked output; "portfolio stress testing" as a standalone feature is killed and replaced by an equivalent fleet-level chat box on Fleet Exposure. This session also settled two app-wide restructures that Layer 3 depends on and that supersede prior sections: a four-layer navigation model (Details · Calendar · Financials · Scenarios, same language at fleet and asset level — see Section 7a) replacing the flat nav, and a four-role permission model (Admin/Editor/Viewer/Data Entry — see Section 7) replacing the three-role structure, resolving both the open Fleet Exposure role-gating item (`TECH_DEBT.md` 4.45) and the nav-IA restructure question raised at that session's close (Section 19). No code, no Firestore schema touched this session. **July 2026 — the app has been migrated from a single-file `index.html` to a Vite-bundled modular project** (single entry point, no feature changes — see `TECH_DEBT.md` 4.56), with five real deploy-time bugs found and fixed along the way (a serverless function reading a calc file directly off disk, a module-type mismatch breaking every `/api` function, three missing npm dependencies, `middleware.js`'s own missing dependency, and a build-target fix for top-level `await`); verified end-to-end in production. **July 2026 — the `APP_SURFACE` multi-entry-point split is done, and all four product domains are live.** `vite.config.mjs`/`package.json` now build a distinct lean bundle per surface (confirmed via real local builds: 528 KB JS for `app`, 142 KB JS — essentially bare React — for each of `specs`/`airframe`/`engine`); three new stub entries exist for TailiQ Specs, the free airframe tool, and the free engine parse (no real UI yet — that's separate future work, just "coming soon" placeholders on their own bundles). Four Vercel projects now deploy from the same repo (`APP_SURFACE=app/specs/airframe/engine`), each wired to its own domain via Cloudflare DNS — `app.tailiq.app`, `specs.tailiq.app`, `airframe.tailiq.app`, `engine.tailiq.app` all confirmed live over HTTPS. See `TECH_DEBT.md` 4.58. **July 2026 — the four-role permission model and four-layer nav restructure, both previously Opus-scoped only, are now actually BUILT** (`TECH_DEBT.md` 4.64–4.65, plus a same-day polish pass at 4.59–4.63) — `dataEntry` is a real, assignable Firebase role with matching Firestore rules and a role-change-forces-logout fix; the fleet-level and asset-level nav are both restructured into Details/Calendar/Financials/Scenarios (Calendar and Scenarios still "Coming soon" placeholders — only the shell is built); a same-day design pass also relocated the Lease Wizard into the Financials tab, unified the fleet- and asset-level nav pills into one shared, visually-identical `NavPill` component, finally shipped the long-agreed "Extract with AI" → "Extract"/"TailiQ" wording fix, and redesigned the Maintenance Calendar with a year-by-year event grid. See Sections 7/7a and `TECH_DEBT.md` for full detail. **July 2026 — documentation sync pass (no code changed):** confirmed by direct read of the live `App.jsx` that Fleet Exposure role-gating is not just built but genuinely closed — Viewer/Editor/Admin see Financials, Data Entry does not — resolving what had still been flagged as "pending live confirmation" pending the Vercel deployment cap (4.63) clearing. See `TECH_DEBT.md` 4.45/4.64/4.65. **July 2026 — pre-IT-review test/build pass:** four items shipped together — thousand-separator formatting on all hour readouts app-wide, engine stock photos generalised from a hardcoded 2-family lookup to all 8 supported families, a new Airframe Stock Photos system (coarse model-matching, 7 buckets, mirrors the engine pattern), and Operator History (new engine-record data type — upload/parse/review extraction, manual entry, edit/delete, gap-flagging, and a new tech spec PDF section) built per the locked `operator-history-scoping-handoff.md` design. See `TECH_DEBT.md` 4.66–4.69. A second color-correction pass on the engine/airframe cover art also landed this session — the original background color-match had been checked against the wrong reference (website header navy `#102A43` instead of the actual tech-spec-hero CSS background `#111827`); corrected on the affected files, plus a pre-existing edge-artifact cleanup across the full 15-file cover art set — see `TECH_DEBT.md` 4.70. **July 2026 — End of Lease Position wired into Fly-Forward, TAC upload pipeline built:** `endOfLeasePosition.js` (built in an earlier scoping session but never called from anywhere) now has a real `📄 End of Lease Position` button/view in `FlyForward.jsx`'s Financials tab, plus the TAC upload pipeline that supplies its one previously-missing input (`D`, the per-part delivery FC baseline) — see new Section 16, `TECH_DEBT.md` 4.88–4.90. Two real bugs found and fixed live: `endOfLeasePosition.js` had never been added to `index.html`'s script tags at all (blank-screen crash), and the TAC upload was replacing its entire saved `engines` array per upload instead of merging by position, silently wiping a sibling engine's already-saved data when TACs arrive as separate per-engine documents (the real-world case). Also this session: the Layer 2/3 Brains table (Section 4) was found stale in several places predating tonight (Brain 6 and Brain 8 had long been built but still read "scoped") and corrected, with Brain 7 also confirmed built by Alan. Carried into next session, not started: a 4th demo asset built specifically to showcase a clean EOL adjustment (Section 19), and a scoped-but-unbuilt portrait/landscape dual layout mode (`landscape-portrait-layout-scoping-handoff.md`). **July 2026 — Demo Asset 4 built and the EOL/TAC pipeline live-tested end-to-end for the first time:** MSN 5533 (A320-232/CFM56-5B4/P) built specifically for this, with a full document set (lease, utilisation reports, Engine/APU LLP sheets, and — the new piece — two TAC documents) using real catalogue part numbers/pricing from `Engine_LLP_Escalation_Model.xlsx`. Live result: EOL Position correctly computed a combined $505,132 lessee-owed adjustment across both engines, confirming the full chain (TAC → D → EOL formula → net adjustment) works, not just each piece in isolation. Five further items flagged live-testing, all logged in `TECH_DEBT.md`: one new (4.92 — TAC upload requires an active lease already on file, a sequencing question needing a short design discussion) and four reproductions of previously-logged items (4.75 EN-PR/EN-LP catalogue-check unit mismatch; 4.79 DOM date-mask; 4.80 2 Year Check ordering; 4.81 lease uploader visual consistency, now with a screenshot plus a new tier-reorder request). No code changed this session — see Section 16 and Section 19 for the model-level sync. **July 30, 2026 — Fleet Snapshot Writer deployed, punch-list closed, cost tracking scoped:** the `fleetSnapshots/` Cloud Run writer is built, deployed, and verified against real production data (`TECH_DEBT.md` 4.93), closing the last open Fleet Exposure infrastructure item; a `firestore-backup` Scheduler auth gap was found (not yet fixed, 4.94). The prior day's punch list is fully closed — backup/restore retested (4.96), the EAG two-engine LLP upload failure root-caused and fixed (4.95), a mobile/tech-spec UI bug batch shipped including the Prospect creator upload button restyle (4.97), stock photos deprioritised (4.99). The seasonality editor bug surfaced a genuine design-vs-code gap rather than a simple fix — scoped, not yet built (4.98). A cost-tracking Opus scoping session locked the Monthly Report (4.100), SV Cost Tracker (4.101), and Rate Recommendation Engine (4.102) as an interlinked three-feature thread — see `monthly-report-cost-tracker-handoff.md`. **July 31, 2026 — SV Cost Tracker built, Calendar made leaseless-safe at asset level, portrait/landscape first pass, Settings restructure, three carried bugs closed:** the SV Cost Tracker (4.103) went from scoped to built and usable — entry form, pending-completion nudge, and (after a real gap surfaced live: no way to review a past entry) an always-visible history plus a manual log-event path. The Maintenance Calendar's 4.86 leaseless-asset fix, which had only ever reached the fleet-level view, was extended to the asset level (4.104), closing the gap between Financials (still correctly lease-required) and Calendar (now works on any asset with real component data on file). Portrait/Landscape layout (`landscape-portrait-layout-scoping-handoff.md`) got its first build pass on the Financials tab (4.105), with a `.js`/`.jsx` build error found and correctly resolved mid-session rather than left as a workaround. The former Admin Panel was renamed "Settings" and re-gated per-tab rather than whole-panel-admin-only (4.106) — Guide/Settings for every role, Knowledge Base for Editor+Admin, Assets+Users merged into one Admin-only tab — surfacing and resolving a real question along the way (Viewer already had full Financials/Scenarios access; only the new Knowledge Base tab is genuinely new admin/editor-only surface). Three carried bugs closed with the record corrected, not just closed: 4.75's actual root cause was the AI-context builder, not the deterministic check's gating; 4.79 turned out to have no real Specs-tab instance at all (only ever the Overview tab); 4.80 confirmed as pure insertion order. See `TECH_DEBT.md` 4.75/4.79/4.80/4.87/4.103–4.106, Section 19. **August 2026 — IT review preparation pass:** IT Security Review v4 produced (completedEvents Firestore rule confirmed closed, product family section added); Talk Track and App Info Sheet created; portrait/landscape Scenarios tab + `PortfolioView.jsx` rollout completed (4.105); Operator History wired into full-aircraft tech spec (4.69); EN-PR derate confirmed working in production (4.24). Three new build items queued: guide restructure (4.107), backup failure alerting (4.108), Lease Wizard UX fixes (4.109). Commercial/pricing/branding content consolidated into `COMMERCIAL_VISION.md`. No code changed this pass. **August 2026 — three queued items built, IT briefing produced:** 4.107 (Guide Restructure) — role gate on last three guide sections, Fly Forward → Financials throughout, Scenarios section added, `GuideView.jsx` + `AdminView.jsx`; 4.108 (Backup Failure Alerting) — Cloud Monitoring log-based metric + alerting policy, GCP Console only, no code, closes open item in Security Review v4 Section 6; 4.109 (Lease Wizard UX) — tier reorder, dashed dropzone, explicit Extract button, `aiFile` reset on back-navigation, `LeaseWizard.jsx` only. IT Briefing Document (`tailiq_it_briefing.html`) produced for Nikifor Hristov (Vectorgroup IT) ahead of Friday meeting — architecture, security controls, open items, anticipated Q&A, styled to match product PDF. **August 2026 — iQ tab launched:** first feature of the new intelligence/analytics layer, SV Interval Analytics, built end-to-end in one session — fleet-level nav (iQ added to the hamburger's Tools group, admin-only), the tab shell, TSI computation with PR/Hardware summary stats, and a full `reasonCategory` taxonomy wired through extraction/review/manual-entry for Shop Visit and APU records (deliberately not Operator History). See `TECH_DEBT.md` 4.118–4.120. **August 2026 — UI Design System rollout completed app-wide:** the Asset Details screen (`AssetTabs.jsx`, `PhotosAndSpecs.jsx` — every tab) swept onto `TAILIQ_UI_DESIGN_SYSTEM.md`, closing out the rollout that began with `styles.css`/`Dashboard.jsx` and continued through Scenarios/Financials/Lease Wizard — see `TECH_DEBT.md` 4.123. Iterated live against real screenshots across several rounds, including a label/value contrast fix (relative vs. absolute letter-spacing at small sizes) and multiple Landing Gear/APU layout rearrangements per Alan's direct feedback. The tech spec PDF is now the one remaining unswept surface — a scoping prompt for the Opus session to reconcile it with the app system (keeping its navy hero as a distinct cover page) is prepared but not yet run — see `TECH_DEBT.md` 4.124, `tech-spec-design-merge-scoping-prompt.md`.

---

## 1. Product Overview

### What TailiQ Is
An AI-powered financial intelligence platform built for Maverick Horizon's internal fleet operations. It connects three data sources that currently live in silos — utilisation reports, LLP disk sheets, and lease financial data — into a single predictive dashboard that surfaces liquidity risk before it becomes a crisis. The architecture provisions for multi-user expansion if needed.

### The Core Problem It Solves
Managing a sub-50 asset portfolio in Excel means the team can tell you what's in the reserve account today but cannot reliably forecast whether that account will have enough cash when the engine actually needs its shop visit — especially if the airline changes utilisation. TailiQ answers that question automatically, from real ingested data.

### Product Name History
Vector Fleet → FleetIQ → TailIQ → VectorIQ → Rhumb → **TailiQ** (final, settled name — see `TECH_DEBT.md` 0.6 for the resolution; every piece of shipped branding has used TailiQ since)

---

## 2. Current State (June 2026)

### What's Built — Layer 1 ✅
- Firebase Firestore backend (europe-west2)
- AI-powered utilisation report parsing (PDF and Excel)
- LLP countdown tracking — CFM56, V2500, APU
- Delta verification between monthly reports
- S/N change detection (engine, APU, landing gear swaps)
- Fleet portfolio dashboard (dark engineering view)
- White fleet portfolio view (client-facing)
- Tech spec PDF generation per asset — configurable logo, Winglets/EFB specs, 2 Year Check support, Wheels &amp; Brakes (ATA-style), Specifications now two-column (June 2026)
- Photo management via Cloudinary
- Vercel hosting, auto-deploys from GitHub
- TailiQ rebrand — app header and tech spec banner/footer (June 2026; see Section 19 naming note)
- Mobile header layout — no horizontal scroll, responsive nav (June 2026)
- Custom domain `app.tailiq.app` live, dual-origin CORS, self-service user invite flow (June 2026)
- Mobile contained-scroll fixes for asset tab bar and history table — no page-level horizontal scroll (June 2026)
- Share button added to Fleet Portfolio cards, alongside Tech Spec — same per-asset token flow as the existing asset-detail share (June 2026)
- Full branding sweep — remaining VectorIQ/Vector Fleet Manager/Vector Group strings corrected across the app, share page, and tech spec builder (June 2026)
- Tech spec disclaimer system rebuilt — per-asset override, fleet-wide Settings default, and public share link now all in sync (June 2026)
- Compound utilisation period fix — "March 2026 - April 2026" style periods normalised before Brain 1 comparison (July 2026)
- LLP blank screen root cause fixed — `matchedAsset?.msn` replaces undefined `asset?.msn` in LLP review panel; covers APU LLP, EAI, AGO sheets (July 2026)
- Editable LLP FC Remaining — engine edit mode allows direct correction of cycle counts, back-calculates `startFCRem` (July 2026)
- Excel sheet selector on upload — multi-sheet Excel files show picker, defaulting to last sheet (July 2026)
- Hide spec fields per-asset — `hiddenSpecFields[]` with 👁/🚫 toggle per field in Specs edit mode (July 2026)
- Quick Import extended — Sonnet model, now extracts engine/APU shop visits and LDG overhaul dates (July 2026)
- LDG Overview pills and enlarged TSN/CSN boxes in GearCard (July 2026)
- Engine thrust defaults to 27K on edit (July 2026)
- APU LLP prompt — European thousands-separator handling (38.093 → 38,093) (July 2026)
- Tech spec full visual rebuild — slate hero band cover, MH logo, aircraft photo, 4 icon-stat tiles, Plus Jakarta Sans font, operator label toggle (Current/Previous Operator) (July 2026)
- Tech spec content pages rebuilt — card-based layout throughout; icon headers (SVG, black circle) per section; Weights/Check/Config/Systems on Page 2; Engine highlight (LLP progress bar, first-impact module) + SV + LLP table on Pages 3-4; LDG on Page 5; APU on its own page (July 2026)
- LLP progress bar — visual remaining life bar (20,000 FC denominator, green/amber/red) on engine highlight and APU cards (July 2026)
- Empty engine pages bug fixed — conditional page breaks, no orphan pages (July 2026)
- UI branding — all user-facing "Claude" → "TailiQ AI" (July 2026)

### Tech Stack
| Layer | Technology |
|-------|-----------|
| Frontend | Single-page HTML/CSS/JS (index.html) |
| Database | Firebase Firestore (europe-west2) |
| Photo Storage | Cloudinary |
| AI Parsing | Claude API (Anthropic) |
| Hosting | Vercel (sole host — GitHub Pages retired June 2026) |

### Key Services
| Service | Details | Status |
|---------|---------|--------|
| GitHub | `github.com/alanshorten/vector-fleet` | ✅ Active |
| Firebase | Project: `vector-fleet`, europe-west2 | ✅ Active |
| Cloudinary | Photo storage | ✅ Active |
| Vercel | Hosting, auto-deploy — `app.tailiq.app` primary, `vector-fleet.vercel.app` kept active during transition | ✅ Active |
| GitHub Pages | `alanshorten.github.io/vector-fleet` | ✅ Unpublished (June 2026) |
| Cloud Storage | `vector-fleet-firestore-backups` bucket, europe-west2 | ✅ Active — nightly Firestore export target |
| Cloud Scheduler | `nightly-firestore-backup`, europe-west2, 02:00 UTC daily | ✅ Active |
| Supabase FM1 | Stockholm — abandoned | ✅ Decommissioned (June 2026) |
| Supabase FM2 | Frankfurt — abandoned | ✅ Decommissioned (June 2026) |

### Build Cost To Date
- Claude subscription: ~€60–100
- All infrastructure: €0 (free tiers)
- **Total: under €100**
- Engineer equivalent: €47,000–75,000

---

## 3. The Three Layers

### Layer 1 — What Is (Mostly Built)
Live utilisation data, LLP countdowns, fleet health at a glance, professional tech spec output.

### Layer 2 — What Will Be (Building Next)
Fly-Forward cash flow projection, reserve balance trajectory, Risk Peak identification, shortfall/surplus alerts, maintenance calendar, asset and fleet level risk dashboards.

### Layer 3 — What If / What's Best — SCOPED July 2026, see `layer3-scenarios-build-handoff.md`
**Per asset:** scenario sliders (utilisation rate, lease extension, FH:FC ratio) + one-at-a-time natural-language chat box, side-by-side base case vs. scenario, AI narrative explaining the delta. **Fleet level:** Route Suitability Matcher (input a route's FH/month, FC/month, start/end date; ranks the fleet by operational fit and financial impact) + an equivalent fleet-wide chat box on Fleet Exposure. "Portfolio stress testing" as a standalone feature is killed — the fleet chat box achieves the same outcome (e.g. a COVID-style grounding scenario) without a dedicated mode. AI narrative is a scoped exception to the deterministic-outputs-only principle — permitted here because Scenarios is explicitly hypothetical, not a statement of fact; the kill on AI narrative in Layer 1/2 financial outputs stands unchanged. No new calculation Brains — Layer 3 reuses Brains 3/4/5/6 exclusively; the AI's job is translating natural language into concrete Brain inputs and narrating the result, never calculating. Fully non-destructive — nothing in Layer 3 writes to Firestore.

---

## 3a. V1 — Internal IT/Security Gate (Pivot, June 2026)

**⚠ This checklist covers Layer 1 only and predates Layer 2 (real lease/reserve financial data) and Layer 3 (Scenarios, Route Matcher, Calendar) entirely — both have since shipped, and the actual IT review this checklist was written for has not yet happened (see Section 17's timeline). A refreshed v2 checklist covering everything built since already exists (`TailiQ_Security_Review_Summary_v2.docx`) — status corrected July 31 2026, having been carried as "planned, not yet started" for two sessions in error. Scope matches the original brief (internal-build framing only, no marketing/ISTAT language; Full platform `app.tailiq.app` only, excludes the three free/lead-gen domains) — see `TECH_DEBT.md` 4.87. A v3 addendum is owed before actual IT review, covering the Cost Tracker's new Firestore write surface and the now-leaseless-safe Calendar tab, neither reflected in v2. Do not treat the "7 of 7 complete" status below as covering anything beyond Layer 1.**

### Strategic Decision
Before building Layer 2, take the current Layer 1 product to internal IT/security for review and sign-off. This is a deliberate pivot, not a delay. It turns the security/backup hardening already planned into a real milestone with a stakeholder and a definition of done, rather than an open-ended intention. Sharing (QR/tokenised links) and email ingestion are pulled forward into this V1 scope as well — see below.

### Why Now, Not After Layer 2
- The blast radius of any security gap is currently limited to utilisation reports and LLP disk sheets — not commercially sensitive lease/financial data
- Once Layer 2 introduces reserve balances and lease rates, the cost of any architectural or security gap increases substantially
- Getting IT's eyes on the foundation now means Layer 2 can be built on an approved base rather than retrofitted later
- External accountability (a real review, a real stakeholder) tends to close out tech debt that otherwise stays perpetually "next on the list"

### What Goes To IT — Two Categories
**Security/operational readiness (the audit focus — lead with this):**
- Authentication and access control
- Firestore security rules
- Secrets/credentials management
- Backup and recovery (export + restore, tested)
- Decommissioning of unused infrastructure
- Data residency / GDPR posture
- New surface area added for V1: share-token exposure (sharing) and inbound email webhook (ingestion) — both need the same security scrutiny as the rest of the app

**Architecture readiness (context, not an audit item):**
- Brain/Body separation — demonstrates the codebase won't need rearchitecting for Layer 2
- companyId multi-tenancy — already designed for scale, not a single-user hack
- Firestore schema design — Layer 2 fields already mapped, not bolted on later

Frame the architecture points as "why Layer 2 won't require rebuilding this," not as something IT needs to evaluate or approve.

### V1 Scope — What's In
- Everything currently built in Layer 1 (utilisation, LLP, tech spec, photos)
- Shareable read-only asset links (tokenised) + QR code generation
- Email ingestion — single company first (Option A or C, see Section 12)
- All Layer 1 Hardening and the IT-Ready Checklist below

Scenario engine, route matcher, and AI narrative (Layer 3) and all financial intelligence (Layer 2) remain explicitly out of V1 — they begin only after IT sign-off.

### Definition of Done — V1 IT-Ready Checklist
- [x] Firebase Auth (email/password) implemented
- [x] Firestore security rules locked to `request.auth != null`
- [x] CORS locked to production domain
- [x] All credentials (Firebase, Cloudinary, Anthropic) moved to Vercel env vars
- [x] Nightly Firestore export to Cloud Storage, scheduled and running — Cloud Scheduler job `nightly-firestore-backup` (europe-west2, 02:00 UTC) calling the Firestore export API directly via a dedicated service account; exports to `gs://vector-fleet-firestore-backups/nightly/`
- [x] Manual export + test restore completed and understood — restored into a temporary `restore-test` database, verified real asset data (incl. asset 1009) came back intact, then deleted the test database
- [x] Restore procedure documented in `TECH_DEBT.md`
- [x] Git tagging convention adopted and current stable state tagged — GitHub Releases, format `vX.Y-description`; first tag `v1.3-techspec-branding-backups`
- [x] Supabase FM1 (Stockholm) and FM2 (Frankfurt) decommissioned — done June 2026
- [x] Hosting consolidated to Vercel only (GitHub Pages retired) — confirmed Vercel as sole live URL, GitHub Pages unpublished
- [x] Share-token system built and access-scoped (no financial data ever exposed via share links, per Section 12)
- [x] Email ingestion webhook built and secured (companyId validation via expected-slug check, attachment-only parse-and-discard, no unauthenticated write path) — `api/email-ingest.js` live, tested with real emails to `maverick@reports.tailiq.app`: a March utilisation report (new asset MSN 1946 created correctly) followed by a May report (correctly merged, gap detected by Brain 1). Reuses `/api/extract` and Brain 1 (`calculations/utilisation.js`, loaded server-side via a `window`-shimmed `vm` sandbox) so the email path and manual Upload path share identical parsing and merge logic.
- [x] **Resolved June 2026 — Email Review Queue:** warnings/deltaCheck output from email-ingested reports now genuinely hold the report back from going live when high-severity (S/N change, delta mismatch, gap detected — classified by Brain 1's existing "⚠" warning prefix, no Brain 1 changes needed). Held-back reports stage into a new `pendingReports` Firestore collection; a new Dashboard "Review Queue" banner lists them with Apply (writes the already-computed merge result, no re-parsing) / Discard actions. Low-severity-only reports (same-month merge, removal notes) continue applying immediately as before. Verified working by Alan against a real months-gap scenario. See Section 12a for the full design history and `TECH_DEBT.md` 0.5.
- [x] Tech spec photo placement bug fixed — was positional (`photos[0]` for cover, `slice(1)` for gallery); a LOPA crop landing at array index 0 before any other photo existed incorrectly became the cover photo, bumping a later Airframe upload into the misc gallery. Fixed to select/exclude by `label` instead of array position (done June 2026)

### Sequencing
This checklist supersedes the standalone "Security Pass" entry in Section 17 as the single gating list for V1. Once it's complete, the IT review happens, and Layer 2 build begins only after sign-off.

---

## 3c. Engine At-Shop / Title Engine Tracking — ✅ DONE (built June 2026)

### Background
A display scaffold for this already existed and was discovered, not built fresh: `eng.atShop`/`g.atShop` flags were already read by the Dashboard's `LLPCell`/`LGCell`, the Engines tab title badge, and the Landing Gear section title (all rendering a 🔧 spanner) — but nothing in the codebase ever set `atShop` to `true`. This session wired up the write path for engines specifically; landing gear at-shop tracking remains display-only for now.

### The Trigger
No new manual workflow or upload step was needed — the existing engine S/N-change detection (Brain 1's `detectSNChanges`, unchanged) already fires whenever a utilisation report shows a different engine S/N than what's on file. That detection is now the decision point. By the time the warning is shown, the new S/N is already merged live (matches today's existing save-before-warn order), so "the asset shows the currently fitted engine" was true with zero extra work.

### The Three-Way Decision
When an engine S/N mismatch warning appears (post-save, in the Upload flow), it now renders as an interactive row instead of plain text, offering:
- **At Shop** — captures the previous engine's removal snapshot into `eng.titleEngine` (S/N auto-filled and locked; TSN/CSN/date pre-filled from the last known report but fully editable, since the real removal happens mid-month and won't exactly match the last monthly report — confirmed with Alan this must stay manually correctable) and sets `eng.atShop=true`.
- **Permanent** — no-op in the normal case; if `atShop` was already true (a second swap before the first was resolved), clears `atShop`/`titleEngine` to finalise the new engine as permanent.
- **Engine Returned** — auto-suggested when the new report's S/N matches the frozen `titleEngine.sn`; clears `atShop`/`titleEngine` (the merge already wrote the correct current TSN/CSN from this report, so nothing else needs touching).

### Persistent Resolution
The Engines tab shows a frozen, read-only "Title Engine — Removed [date]" panel whenever `atShop` is true, with the same Engine Returned / Confirm Permanent actions available at any time afterward — not just at the moment of upload.

### Tech Spec — Deliberately Unaffected
`techSpecBuilder.js` only ever reads the live engine record, never `titleEngine`, so the currently-fitted engine is automatically all that appears on any tech spec, even while at shop. Per Alan: a tech spec ever needing to show an at-shop engine is a rare edge case, deliberately deferred rather than designed for now.

### Brain 1 — Deliberately Unchanged
`calculations/utilisation.js`'s existing `{component, position, previousSN, newSN}` output from `detectSNChanges` already carried everything the Body-layer toggle needed. Keeping Brain 1 untouched was a deliberate choice to avoid any risk to already-tested delta/S/N logic.

---

## 3b. Landing Gear Tracking — Redesign ✅ DONE (built June 2026)

**Status correction:** This section previously read "scoped, build next session." That build has already happened — confirmed done, not pending. Kept below for the full spec/history record.

### Background
A bug surfaced during email-ingestion testing: Landing Gear's "Calculated Current (Since New)" always exactly mirrored the airframe's TSN/CSN, regardless of whether the leg's P/N/S/N had ever been entered. Root cause: `refAirframeFH`/`refAirframeFC` had never been set to anything but `0` anywhere in the codebase, for any asset, so the formula `startFH/FC + (airframe now − refAirframe)` always collapsed to just the airframe's own total. A stopgap fix shipped (capture the airframe's current reading the moment a P/N/S/N is first entered) but discussion since then has landed on a more correct model that supersedes it before the stopgap saw real use.

### The Correct Model
A landing gear leg's accumulated TSN/CSN tracks 1:1 with the airframe for as long as that leg is installed, but doesn't reset to zero at install/overhaul — it carries its own prior life. So:
```
current leg TSN/CSN = (leg's own TSN/CSN at last overhaul) + (airframe TSN/CSN now − airframe TSN/CSN at that same overhaul)
```
Both halves of the "at overhaul" snapshot must be entered together, manually, as one event. If a leg is swapped/overhauled again later, both fields get re-entered fresh and tracking carries on correctly — no separate "start" fields needed (supersedes/removes the `startFH`/`startFC`/`gearStartSet`-on-P/N-entry stopgap).

**Zero must be a real value, not a "not entered" default.** A leg overhauled at 0 hours (new leg, new airframe) is rare but possible. All four entry fields (leg TSN, leg CSN, airframe TSN, airframe CSN at overhaul) must default to genuinely blank/`null`, not `0` — tracking starts once all four are present, regardless of their values.

### Report Override (ground truth beats calculation, when available)
Two aircraft currently receive a monthly Gear Status Report (Excel) alongside their normal utilisation report, with a `TOTAL HOURS & CYCLES` figure per leg — direct ground truth, no calculation, no drift risk. For these:
- Extend the existing `util` extraction prompt to optionally also capture per-leg `TOTAL HOURS & CYCLES`, when present in the document (most reports won't have this — optional fields)
- Extend Brain 1's merge logic: when present, write directly into `landingGear.{nose,left,right}.currentFH/currentFC` (new fields, same shape as engines/APU already have) and **always override** the calculated figure — no tolerance/mismatch check, since there's no overhaul baseline to compare against for these two aircraft anyway
- When absent (the normal case — only 2 of the fleet's aircraft report this), fall back to the calculated-from-overhaul-data method above
- Both paths flow through the one shared Brain 1 function, so manual Upload and email-ingest inherit this identically, no duplicated logic

### Next Overhaul Due — Dual Limiter (calendar + cycles)
Currently a crude "+10 years from last overhaul date" guess. Upgrading to the same lowest-limiter pattern LLPs already use: **whichever comes first** of a calendar interval (default 10 years from last overhaul date) and a cycle interval (default 20,000 cycles since overhaul, i.e. current CSN − CSN at last overhaul). Both intervals editable per leg (not hardcoded) since they may vary by aircraft/gear model — default to 10yr/20,000 cycles since that's what's confirmed for the fleet today. Same red/amber/green status colouring as the LLP cards.

### Fixes Bundled Into This Pass
- "Since Last Overhaul" card currently diffs the airframe's current TSN against the leg's *own* overhaul-TSN figure — a scale mismatch. Corrected to diff against the new airframe-at-overhaul reference field instead.

### Deferred Out of This Pass
None — the overhaul-interval-as-better-due-date idea (originally logged as a separate deferred item) is now folded into the dual-limiter design above rather than being a future nice-to-have.

---

## 4. The Nine Calculation Brains

All calculation logic lives in `/calculations` folder as pure functions — no UI, no Firebase calls. This is non-negotiable architecture (Brain/Body separation).

### Layer 1 Brains
| Brain | File | Purpose | Status |
|-------|------|---------|--------|
| Brain 1 | `utilisation.js` | Parse reports, validate deltas, detect anomalies | ✅ Extracted — pure function in `/calculations/utilisation.js`, no UI/Firebase deps, `confirmSave` and the review-panel delta banner both call `window.processUtilisationReport`; verified by 56 automated checks incl. byte-for-byte parity against original logic |
| Brain 2 | `llpCalculator.js` | Track remaining life, extrapolate from old disk sheets | ✅ Extracted — pure function in `/calculations/llpCalculator.js`, no UI/Firebase deps, all call sites in index.html confirmed using `window.calcLLPRem`/`window.lowestLimiter` |

### Layer 2 Brains
| Brain | File | Purpose | Status |
|-------|------|---------|--------|
| Brain 3 | `flyForward.js` | Core cash flow projection — most critical | ✅ Built & wired to real data — reads real `leases`/`reserves` Firestore data via `asset.currentLeaseId`, projects against it in the real `FlyForward` view (see below); the internal Fly-Forward Demo has been retired |
| Brain 4 | `riskPeak.js` | Identify when liability exceeds balance | ✅ Built & wired to real data — same status as Brain 3 |
| Brain 5 | `shortfall.js` | Quantify the gap, track reserve drift | ✅ Built & wired to real data — same status as Brain 3 |
| Brain 6 | `maintenanceCal.js` | Schedule events, account for downtime in projections | ✅ Built & wired into Fly-Forward's two-pass flow — see `TECH_DEBT.md` 4.39/4.40/4.41. This row was corrected July 2026 after a documentation sync found it still read "scoped, not yet built" despite having shipped several sessions earlier |

### Layer 3 Brains
| Brain | File | Purpose | Status |
|-------|------|---------|--------|
| Brain 7 | `scenarioEngine.js` | Translate slider inputs into modified Brain 3–6 inputs, rerun the pipeline, return base-case + scenario pair | ✅ Built — structured per-asset Scenario controls (sliders, AOG window, Lessee default, base-vs-scenario per-pot table) confirmed live by Alan July 2026. **Flag:** the specific build session that shipped this was not captured in this document at the time — worth a follow-up pass to fill in the real detail/git tag here rather than leave this row under-documented |
| Brain 8 | `routeMatcher.js` | Given a route profile (FH/month, FC/month, start/end date), rerun every eligible asset through Brains 3–6 under both current and proposed profiles, rank by operational fit + financial delta | ✅ Built — see `TECH_DEBT.md` 4.85. This row was also corrected July 2026 after the same documentation sync found it stale |
| Brain 9 | `narrativeGen.js` | AI narrative explaining the delta between base case and scenario. Scoped exception to deterministic-outputs-only — hypothetical context only, framed and styled as AI interpretation, never presented as a calculated figure | 📋 Scoped, not yet built — no AI narrative visible in the current Scenarios view (structured controls only, no chat/narrative) |

### Brain 3 — Fly-Forward Engine (Core Formula) — SCOPED July 2026

**Status:** input schema and formula locked in a dedicated Opus scoping session (July 2026) against a fully-populated, real-shaped test case (A320 / V2500 family — accrual side from a real Maintenance Payment Rate schedule, outflow side from market MRO cost data, plus CFM56 and V2500 LLP cost tables). No live code written — this is the agreed spec the Oct–Dec 2026 build opens from. Prerequisites and remaining data gaps tracked in `TECH_DEBT.md` 4.19–4.22.

**There is no single universal accrual formula.** Each pot accrues on its own *basis* — calendar time for Airframe/Landing Gear, utilisation for APU/Engine — so the old `rate × cycles × months` multiply is only correct for the utilisation pots. Brain 3 runs a **month-by-month summation** across the projection horizon, which is the one shape that handles all four Section 10 behaviours (seasonality, escalation steps, scheduled groundings, opening balances) uniformly:

```javascript
// Per pot, for each month m from today → horizon:
FutureAccruals(pot) = Σ  escalatedRate(pot, m) × basisQuantity(pot, m) × derateFactor(pot)

  basisQuantity(pot, m):
    per_month   → 1                                  // calendar pots — always, even during a grounding
    per_FH      → seasonally-weighted FH  that month  // utilisation pots — 0 during a scheduled SV/check
    per_FC      → seasonally-weighted FC  that month
    per_APU_hr  → seasonally-weighted APU-hr that month

  escalatedRate(pot, m):
    flat_annual → baseRate × (1 + esc%)^(yearsSinceBase)   // steps up on 1 Jan
    catalogue   → current catalogue rate (re-entered on catalogue revision)

// Balance trajectory, cost, shortfall, risk peak:
BalanceAt(t)    = openingBalance + Σ accruals[asOf..t] − Σ outflows[asOf..t]
ProjectedCost   = [low, likely, high] × (1 + outflowEsc)^(yearsToEvent)   // a RANGE, never a point
Shortfall(pot)  = ProjectedCost − BalanceAt(eventDate)                    // therefore a BAND
RiskPeakDate    = earliest t where cumulative Liability(t) > BalanceAt(t) // therefore a WINDOW
```

A grounded month falls out correctly: utilisation pots accrue nothing (`basisQuantity = 0`) while calendar pots keep ticking ($/calendar month "or part thereof" accrues regardless of flying).

**Outputs are ranges, not points.** Outflow cost carries low/likely/high, so shortfall is a band and Risk Peak is a *window*. Deliberate — real outflow depends on MRO chosen, aircraft age, and operating environment; the range is the useful signal, not a false-precision single figure. Downstream `riskProfile` carries the band and window accordingly.

### Brain 3 Input Schema (confirmed July 2026)
Per-pot object. The three flags — `accrualBasis`, `escalationRegime`, `triggerBasis` — are what let one engine cover heterogeneous pots:

```
reservePot {
  code, label, component        // lease's own codes as IDs (AF-6Y, EN-LP-1, …)

  // ACCRUAL (money in)
  accrualBasis                  // per_month | per_FH | per_FC | per_APU_hr
  accrualRate, accrualRateBaseYear
  escalationRegime              // flat_annual | catalogue
  escalationPctPerYr            // flat regime — 2.5, compounds 1 Jan
  catalogueRef {                //   engineFamily, currentUnitRate, lastCatalogueDate }   (catalogue regime)
  derateModifier {              //   baseline:10, actual, pctPerPct:1.5, capDerate:15 } | null
                                //   OPTIONAL override, EN-PR only, null → use stored rate as-is

  // BALANCE (starting point — mid-lease onboarding, Section 9 Step 2)
  openingBalance, openingBalanceAsOf

  // OUTFLOW (money out) — a RANGE
  triggerBasis                  // calendar_months | calendar_or_cycles | apu_hours | llp_cycles(Brain 2)
  triggerInterval               // {months:72} | {months:120,cycles:20000} | {apuHours:[5000,7000]}
  lastEventDate | lastEventCounter
  projectedCostLow, projectedCostLikely?, projectedCostHigh
  outflowCostBaseYear, outflowEscalationPct     // SEPARATE stream from accrual escalation

  // LLP pots only (EN-LP) — stack simulation
  harvestThresholdFC            // default 2,000 — any LLP within this of its limit is pulled at the SV
  stubBufferPct                 // default 10% — accrual uplift funding scrapped stub life

  inputMethod, confirmedBy, confirmedAt         // Section 5 audit rules
}
```

### Reserve Pot Categories — Confirmed Rates (July 2026)
Worked through against an actual lease's Maintenance Payment Rate schedule, using the lease's own category codes as canonical IDs (no translation layer between lease and Firestore). Rates below are the current escalated **"New Rate"** figures straight off the schedule — base-year = now. Confirmed asset is **V2500-powered** → 10.53% catalogue escalation.

| Code | Pot | Rate | Basis | Escalation regime |
|------|-----|------|-------|-------------------|
| AF-6Y | Airframe 6-Year Structural Check | $14,142.60 | per_month | flat 2.5%, 1 Jan |
| AF-12Y | Airframe 12-Year Structural Check | $8,146.14 | per_month | flat 2.5%, 1 Jan |
| AP-OH | APU Overhaul | $54.30 | per_APU_hr | flat 2.5%, 1 Jan |
| LG-OH | Landing Gear Overhaul (single shipset pot) | $4,299.35 | per_month | flat 2.5%, 1 Jan |
| EN-PR ×2 | Engine Full Performance Restoration | CFM56-5B: $1.2M–$1.6M / 10,000 FH · V2500-A5: $1.4M–$1.8M / 6,000 FH (real 2026 mature-run market data) | per_FH, trigger `engine_fh` | catalogue (family-specific) |
| EN-LP ×2 | Engine LLP Replacement | $348.56 | per_FC | catalogue price (re-based, no %) |

**Decisions locked this session (previously open questions, now closed):**

- **Landing Gear = one shipset pot, not three legs.** Arithmetic settled it: $4,299.35/mo × 120 mo, escalated, ≈ $511k — inside the $350–600k *per-shipset* overhaul band; reading it per-leg (×3) over-reserves by >2× for a single event. "Leg Overhaul" is the event name, not a per-leg multiplier. Trigger is a **dual limiter** — `min(10yr, 20,000 FC)`, whichever comes first.
- **EN-PR is a table lookup ("see EPR Tables"), not a scalar, and escalates at the LLP catalogue rate (10.53%).** The EPR Tables *are* the derate/thrust/ratio adjustment — you enter the already-resolved row for the asset, so v1 does **not** model the derate ±1.5%/1% or the FH:C interpolation formulas at all. `derateModifier` stays as an optional override, null by default.

> **🟡 REOPENED (July 2026) — EN-PR derate/ratio mechanism, flagged for a dedicated Opus session, NOT v1 scope.** Reviewing the actual lease clauses (Sections 2.1–2.2) revealed **two independent, real adjustment mechanisms**, not one static resolved rate as originally assumed:
> 1. **FH:C Ratio** — a direct lookup table (e.g. $233/FH at 1.5:1 down to $134/FH at 4:1, linear interpolation between listed ratios), applying **"at any time during the Lease Period"** — i.e. not an annual event, potentially continuous/on-demand.
> 2. **Derate** — a percentage adjustment (±1.5% per 1% actual-vs-10%-baseline deviation, capped at 15% derate), keyed to **average annual** derate — an annual review, not monthly.
>
> These are genuinely independent variables (ratio ≈ route/stage-length profile; derate ≈ takeoff power-management setting), not two descriptions of the same thing, and both can move on the same asset simultaneously. **Working hypothesis on sequencing** (strong textual read, not yet legally/commercially confirmed): both clauses share the identical 10% baseline reference, which suggests the ratio table produces a revised rate *still assuming 10% derate*, and the derate % then applies on top of *that* resulting figure — ratio first, derate second — rather than each computing independently off the original base rate. **This needs confirmation from whoever handles the lease commercially/legally before being built into Brain 3.** Do not build this into v1; scope properly in a dedicated Opus session (per the model-usage guidance — same tier as the original Brain 3 design and the pre-financial-data security review) once picked up. See `TECH_DEBT.md` for the full session note and open questions (partial-year averaging, retroactive vs forward-only application, interaction with the 10.53% catalogue escalation layer).
- **EN-LP re-bases to current catalogue price outright ($348.56/FC), no % applied.** Tracks catalogue by design — no "locked 2021 rate" branch, so no structural under-funding from a stale accrual rate. (2021→2026 reconciliation held: the old $224.30 base escalated at the family rate lands in the right neighbourhood of the current blended figures.)
- **EN-LP outflow is a stack simulation** — not a static per-cycle projection and not per-part. The **lowest limiter** (least remaining life across the LLP stack, from Brain 2) forces the engine off wing. Once opened, the shop-visit fixed cost dominates, so the workscope **harvests**: every LLP within ~2,000 FC (`harvestThresholdFC`) of its own limit is replaced too, even with life left, to buy time-on-wing and avoid dragging the engine back into the shop in a year or two. So an EN-LP event replaces a *batch* (limiter + everything under threshold) at current catalogue price; harvested parts reset to full life; the stack rebuilds; the next limiter recomputes; projection continues. Requires Brain 2 to hand over the **full per-part remaining-life vector**, not a scalar (`TECH_DEBT.md` 4.19).
- **Stub life is funded by a 10% accrual-rate uplift** (`stubBufferPct`). ~2,000 FC ≈ 10% of a ~20,000 FC approved life, so the buffer is calibrated to the harvest fraction — scrapped stub life is compensated by design, not a leak. **Correction from the original scoping:** the lowest limiter itself is not stub waste — it runs to near-zero and is replaced on its own merits — so the buffer only needs to cover the *other* harvested LLPs, and the worst case is whichever of those has the shortest `approvedLife` (a fixed FC threshold eats a bigger fraction of a short-life part). `validateStubBuffer()` (`llpCalculator.js`) implements this — excludes the limiter, finds the shortest-life remaining part, flags if `stubBufferPct` sits more than 2 points below the implied minimum for that part. Now called directly from `projectEnLpPot()` (`flyForward.js`) at each simulated shop visit — confirmed firing correctly against both fabricated and real LLP stacks (`TECH_DEBT.md` 4.21).
- **EN-PR and EN-LP kept as separate pots** with independent triggers. They will often co-time in one physical removal, but are not hard-linked — if they align, the outputs show it. Keeps each pot auditable against the lease's own separate line items.
- **APU trigger is condition-based (5,000–7,000 APU-hr accumulated), not calendar.** Structurally different: the APU event *date* is **derived** by projecting APU-hours forward until they cross the trigger band — a two-axis uncertainty (when × how much). Brain 6 (Maintenance Calendar) will need an accumulating-hours watch here, not a fixed date. APU LLP is **not** a separately-funded pot in v1 (schedule shows only AP-OH) — it stays Layer-1 technical tracking, same treatment as the 2-Year Check exclusion.

**2-Year Check deliberately excluded** — this lease funds only 6yr/12yr; left out of Brain 3 v1 rather than assumed universal.

**Two escalation streams, both confirmed:**
1. **Accrual escalation** — flat 2.5%/yr (compounds 1 Jan) for AF-6Y, AF-12Y, AP-OH, LG; catalogue-price re-basing for EN-LP; 10.53% catalogue for EN-PR.
2. **Outflow escalation** — a *separate* stream: **2.5%/yr for all non-LLP pots** (AF-6Y, AF-12Y, LG, APU-OH, EN-PR restoration cost) and the **10.53% catalogue** rate for EN-LP (harvested parts priced at future catalogue). The flat pots escalate accrual and outflow at the same 2.5%, so their funding gap is driven by interval and opening balance rather than an escalation mismatch — the real escalation risk concentrates in the engine pots.

**Projection horizon = lease end (typically 3–4 yrs), with partial-funding past it.** Events falling beyond lease end (e.g. a 12-year check on a short lease) are flagged **"partial-funded, settles at redelivery"** — accrue pro-rata, hand the balance over at redelivery — *not* red-flagged as a shortfall. Within the horizon, **all** repeat events are modelled (fire event → reset counter → re-accrue → next event), so a longer lease with two 6Y checks or three APU overhauls is handled without a code change.

**Lease data input (Path decision):** first Layer-2 build pass is **Path 2 (manual entry + AI-validation) only** — the lower-risk first financial write path, feeding the onboarding wizard's opening-balance step (Section 9 Step 2). Path 1 (PDF parse-and-discard, Section 8) is a fast-follow, not day-one scope.

**Still open — data gaps, not design gaps (tracked in `TECH_DEBT.md`):**
- ~~**EN-PR restoration shop-visit cost**~~ — **resolved July 2026.** Real 2026 market-rate data (CFM56-5B vs. V2500-A5, standard PR cost and mature-run FH interval) replaced the earlier illustrative placeholder. This also required a **new `triggerBasis: "engine_fh"`** (`flyForward.js`) — EN-PR's interval turned out to be FH-driven (same axis as its accrual basis), not calendar-based like the other fixed pots, with first-run vs. mature-run intervals differing by ~40–60% (first-run not modelled in v1, since most engines reaching this pot are expected to be mature-run — flagged simplification). First-PR timing is either inferred from `openingBalance ÷ accrualRate` or a manually entered last-PR date — no reliable structured "this was a PR" flag exists in shop-visit records to derive it automatically. See `TECH_DEBT.md` 4.32.
- **Redelivery conditions / EOL compensation** — out of scope for v1, but a nullable `redeliveryConditions` schema stub is added now so Brain 3 tolerates its absence and the field exists for future work (4.22).
- **All figures USD** — single-currency v1.

---

### Fly-Forward — Wired to Real Data (July 2026)
`FlyForwardDemo` (which ran Brain 3/4/5 against fabricated `DEMO_LEASE_TERMS`) has been **retired**, replaced with `FlyForward` — reads real `leases`/`reserves` Firestore data via `asset.currentLeaseId` and projects against it directly. No editable assumptions panel; read-only for everyone, including admin — a wrong figure gets corrected in Lease / Reserve Setup, not patched over in this view. Open to Viewer role (read-only); "📄 Lease" stays admin/editor-only (`TECH_DEBT.md` 4.30).

**What changed to make this possible:** the Lease Wizard (Section 9) previously only persisted the *accrual* side of each pot (rate, escalation, opening balance) — Brain 3 cannot project anything without the *outflow* side (trigger basis/interval, cost range, escalation regime), which had never actually been saved. `PotRow`/`saveReservePot` now capture and persist the complete schema per Section 4/5. Structural facts (trigger basis/interval for the four fixed pots, escalation regime) are locked, not user-editable; cost ranges are pre-filled defaults — editable, since actual outflow cost is genuinely lease/MRO-specific — sourced from real 2026 market data.

**Gaps handled honestly, not silently:** if `asset.currentLeaseId` is unset, the entry point stays visible but points to the Lease Wizard rather than erroring or hiding. If some pots are confirmed and others aren't, the projection runs on what's confirmed and lists what's missing (`missingCodes`), rather than treating an unconfirmed pot as zero. A reserve doc saved before this session's schema extension (missing `triggerBasis` entirely) is treated the same as an unconfirmed pot — surfaced as a gap, not passed into the calculation engines with an undefined trigger basis (which they correctly reject).

**Verified against real asset data:** confirmed a multi-year EN-LP shop-visit projection against a genuinely low-utilisation asset checks out arithmetically against its real FC/month rate; confirmed a zero-projected-events result was correct behaviour (short lease horizon, healthy asset with nothing due) rather than a bug, via a separate spot-check. Full detail in `TECH_DEBT.md` 4.32.

**Engine differentiation carries over unchanged:** EN-PR/EN-LP still generate one pot per real engine found on the asset (`EN-PR-1`/`EN-LP-1`, `EN-PR-2`/`EN-LP-2`), each projected against that engine's own real data and correct engine-family rates.

---

## 5. Firestore Data Schema

### Structure
```
companies/
  {companyId}/
    
    [LAYER 1 — EXISTS]
    assets/
      {assetId}/
        utilisationReports/
          {reportId}
        llpStatus/
          {componentId}
        
        [LAYER 2 — BUILDING — schema finalised July 2026, see below for design rationale]
        currentLeaseId    ← field on the asset doc itself, pointer to the active lease below

        leases/           [APPEND-ONLY — one doc per lease over the asset's life, never overwritten]
          {leaseId}
            - lessee, leaseStart, leaseEnd, migrationDate
            - inputMethod (manual/parsed), status (active/expired/terminated)
            - redeliveryConditions   [nullable stub — no v1 UI, see Section 4]
            - confirmedBy, confirmedAt
            - companyId   (duplicated from parent asset — cheap security-rule matching, avoids a get() on every read)

        reserves/         [one doc per pot — rate + balance + audit combined, NOT split across two collections]
          {potCode}          ← doc ID = the lease's own code (AF-6Y, EN-LP-1, …), matches Section 4's reservePot object
            - label, component
            - accrualBasis (per_month/per_FH/per_FC/per_APU_hr)
            - accrualRate, accrualRateBaseYear
            - escalationRegime (flat_annual/catalogue), escalationPctPerYr
            - catalogueRef { engineFamily, currentUnitRate, lastCatalogueDate }
            - derateModifier { baseline, actual, pctPerPct, capDerate } | null   (EN-PR only, optional — see Section 4 reopened note)
            - openingBalance, openingBalanceAsOf
            - triggerBasis (calendar_months/calendar_or_cycles/apu_hours/llp_cycles/engine_fh — engine_fh added July 2026 for EN-PR), triggerInterval, lastEventDate, lastEventCounter
            - anchorMode ("infer"/"manual"), lastPRDate   (EN-PR only, added July 2026 — first-PR timing, see Section 4)
            - projectedCostLow, projectedCostLikely, projectedCostHigh, outflowCostBaseYear, outflowEscalationPct
            - harvestThresholdFC, stubBufferPct                                   (EN-LP only)
            - status (confirmed/outstanding — "outstanding" + populated accrualRate = pending validation acknowledgment; "outstanding" + empty = not yet entered)
            - inputMethod, confirmedBy, confirmedAt
            - companyId   (duplicated from parent asset, same rationale as leases/)

        shopVisitProjections/
          {projectionId}
            - code, component
            - triggerBasis (calendar_months/calendar_or_cycles/apu_hours/llp_cycles)
            - projectedDate          (INPUT for calendar pots; DERIVED for APU/EN-LP condition pots)
            - projectedCostLow, projectedCostLikely, projectedCostHigh   (a range, not a point)
            - outflowEscalationPct
            - llpWorkscope[]         (EN-LP only — limiter + harvested parts for this SV, from Brain 2 vector)
            - confidence, calculatedAt
            (history preserved — never overwrite, always new document)

        scheduledEvents/          [reshaped July 2026 — Brain 6 scoping; see design rationale below]
          {eventId}
            - code, dueCycle          ← identity key (`code + due-cycle`), joins to shopVisitProjections at read time
            - durationWeeks           (override — defaults live in maintenanceCal.js: 2Y=2wk, 6Y=4wk, 12Y=8wk; no default for Engine/LG/APU, negligible downtime)
            - scheduledDate           (override — the app's own derived date unless overridden)
            - source (derived/seasonality/airline-stated)   ← airline-stated is sticky, overrides both other sources outright
            (no estimatedCost — cost lives in shopVisitProjections only, joined at read time, never duplicated here)

        seasonalityProfile/
          {profileId}
            - activeWeeksPerYear
            - monthlyWeightings (Jan–Dec percentages)
            - patternDetected (true/false)
            - confirmedAt

        riskProfile/
          {profileId}
            - calculatedAt
            - riskPeakDateEarly, riskPeakDateLate    (a window — from the outflow cost range)
            - projectedShortfallLow, projectedShortfallHigh   (a band)
            - confidenceLevel, triggeringComponent
            - status (green/amber/red)
            [Recompute-on-read, never persisted — this stays in the doc as a
             shape only, not a live collection. Confirmed again during the
             Fleet Exposure build (July 2026): fully derivable from
             leases/reserves + Brains 3/4/5/6, so persisting it would just
             recreate the staleness problem Brain 6's own design already
             avoids.]

        [LAYER 3 — FUTURE]
        scenarios/
          {scenarioId}

    [FLEET LEVEL]
    fleetSnapshots/          [BUILT July 2026 — Cloud Run function `fleet-snapshot-writer`,
                              Cloud Scheduler monthly (0 2 1 * *, Europe/London). See TECH_DEBT.md
                              4.93. Field shape matches buildFleetExposure()'s actual output, NOT
                              the original §6 stub below — the redesign session
                              (fleet-exposure-redesign-handoff.md) superseded totalReserveBalance/
                              netPosition/riskPeaksByQuarter/liquidityClusters before this was
                              built; those fields were never computed anywhere and are not
                              persisted.]
      {snapshotId}
        - calculatedAt, totalAssets, assetsComputed
        - assetsExcluded[]              — [{ assetId, reason }], reason TYPED:
                                           NO_LEASE | POTS_OUTSTANDING |
                                           STALE_UTILISATION | COMPUTE_ERROR
        - totalHighCaseGap              — sum of every atom's high-case shortfall
                                           (in-lease horizon only; see fleetExposure.js buildHeadline)
        - statusCounts                  — { green, amber, red } — asset counts by worst status
        - timeAxis                      — month-bucketed atoms with cost/coverage/shortfall totals
                                           (fleetExposure.js buildTimeAxis)
        - assetAxis                     — per-asset exposure ranking (fleetExposure.js buildAssetAxis)

    fleetScenarios/
      {scenarioId}
```

### Critical Schema Rules
- **Every document must have `companyId`** — non-negotiable, do not remove
- **`confirmedBy` and `confirmedAt` on all financial inputs** — audit trail
- **`shopVisitProjections` always creates new document** — never overwrites, preserves history
- **`inputMethod` field on all financial data** — tracks manual vs parsed

### Design Rationale — `reserves`/`leases` Schema (locked July 2026)
- **`leases/` is append-only, not a single `current` doc** — a lease's dates/lessee genuinely change at each transition (unlike reserve pots, which carry over — see Section 4), so history is preserved for free rather than overwritten. Cost of building this now is negligible; retrofitting it later would mean a real data migration, so it was built append-only from day one.
- **`reserves/` is one doc per pot, not one combined array field** — considered and rejected collapsing to a single doc for read-cost savings. At current/near-term scale (single-digit clients, 1–20 assets each) the read cost difference (~10 reads vs 1 per Fly-Forward view) is negligible against Firestore's free tier, and separate docs keep per-pot audit trail (`confirmedBy`/`confirmedAt`) clean and allow independent updates. If this ever needs revisiting, the Brain/Body separation means only the input-assembly layer changes — the calculation engines (`flyForward.js` etc.) take assembled data as parameters and don't know or care how many documents it came from.
- **`companyId` duplicated onto every `reserves`/`leases` doc**, not just the parent asset — makes Firestore security rules a cheap direct field match rather than requiring a `get()` on the parent asset doc for every read/write.
- **Read pattern for a Fly-Forward projection:** read asset doc (→ `currentLeaseId`, engine config for `isCFM()`) → read `leases/{currentLeaseId}` (→ `leaseEnd` as projection horizon) → read all `reserves/*` docs → pass into `flyForward.js`/`riskPeak.js`/`shortfall.js`. If `currentLeaseId` is unset, the Fly-Forward entry point stays visible but errors clearly on click, directing the user to the Add Lease flow, rather than being hidden or silently failing.
- **Partial data handling** — Brain 3 runs on whatever pots are `status: confirmed`, and surfaces a `dataCompleteness` gap (e.g. "excludes EN-LP-2, APU — not yet confirmed") rather than blocking the whole projection or silently treating missing pots as zero. **Future link, not yet built:** this gap output is a natural feed for Layer 3 redelivery compliance (a pot unconfirmed at `leaseEnd` is a specific unknown against handback conditions) — worth keeping in mind when redelivery compliance is eventually scoped, so it isn't designed from scratch.

### Design Rationale — `scheduledEvents` / Brain 6 Schema (scoped July 2026, Opus session — see `brain6-build-handoff.md`)
- **`scheduledEvents` ↔ `shopVisitProjections`: a read-time join by identity, not a stored foreign key.** Considered and rejected a scalar `shopVisitProjectionId` field on `scheduledEvents`. Two reasons: (1) `shopVisitProjections` is append-only (creates a new doc on every recompute, per the Critical Schema Rule above), so a stored pointer goes stale immediately — a stable link into it has to be a query, not a pointer; (2) cardinality is 0..n, not 1:1 — the 2Y check joins to zero cost docs (no pot), 6Y/12Y join to one, and an engine off-wing event joins to two (EN-PR and EN-LP are separate, independently-auditable pots that co-time in one physical removal but aren't hard-linked). A scalar FK can't express 0 or 2; a join naturally returns the right set in each case.
- **Identity key = `code + due-cycle`, not a more complex anchor.** A second 6Y check always coincides with a 12Y, so there is never more than one live occurrence of a given check type in a lease horizon to disambiguate — the simple key is sufficient, no need to anchor off last-event date.
- **`scheduledEvents` was reshaped, not replaced.** It existed as an unbuilt stub (hand-entered-calendar shape) before this session; repurposed into a small override/duration-config layer instead — zero migration cost since nothing had been built against the old shape. `estimatedCost` was dropped from it entirely now that cost is joined in from `shopVisitProjections` rather than duplicated.
- **`maintenanceCal.js` (Brain 6) is pure and recompute-on-read — writes nothing derived to Firestore.** A stored projected calendar would sit wrong-until-recomputed, since real utilisation reports self-correct scheduling drift anyway (a check projected for April that actually starts in June just means April/May ingest as flying and June/July as grounded) — persisting the derived output would recreate the same staleness problem the FK rejection above avoids, for no benefit.
- **`seasonalityProfile` is reused unchanged.** Brain 6 reads it to *suggest* check placement (never auto-moves a date — always a user-accepted override into `scheduledEvents`); it may later write back the tier-2 pattern-detected flag, but that's separate future work, not Brain 6 itself.
- **Build session postscript (July 2026, Sonnet — `TECH_DEBT.md` 4.39):** `maintenanceCal.js` is built and tested. Two implementation details resolved during the build, narrowing rather than reopening the above: (1) grounding is expressed as a **fractional per-month availability** (grounded days ÷ days in month), not a binary zeroed month — needed to satisfy the Section 10 golden fixture, and it degrades gracefully to the binary case whenever a check happens to fill whole months; (2) the `scheduledEvents`↔`shopVisitProjections` join is approximated as **nearest-`projectedDate` within ±3 months**, since `shopVisitProjections` has no `dueCycle` field to match on exactly and adding one is out of scope. Both `shopVisitProjections` and `scheduledEvents` remain unbuilt stubs in Firestore — `maintenanceCal.js` takes cost projections and overrides as plain input parameters for now, so no rework is needed once those collections exist.
- **Wiring session postscript (July 2026, Sonnet — `TECH_DEBT.md` 4.40):** `maintenanceCal.js` is now live in the Fly-Forward calculation path. `flyForward.js` runs two passes per projection — an ungrounded pass sources real dates for LG-OH/AP-OH/EN-PR/EN-LP (Brain 6 reads these rather than deriving them, per the design above), Brain 6 builds the full calendar from those plus `asset.checks`, and a second grounded pass applies `groundingAvailability` to the utilisation-basis pots. EN-LP's engine-cycle clock needed a real refactor (closed-form → incremental accumulator) to respect a fraction that varies month-to-month; confirmed identical to the old formula when ungrounded. `scheduledEvents`/`seasonalityProfile`/`shopVisitProjections` are still passed as empty defaults — only the `index.html` input-assembly layer will need to change once those collections exist, not either calculation file.

---

## 6. Architecture Principles

### Brain/Body Separation (Non-Negotiable)
```
/calculations    ← THE BRAIN (pure logic, no UI, no Firebase)
/services        ← THE NERVOUS SYSTEM (Firebase reads/writes, API calls)
/components      ← THE BODY (UI only, never does maths directly)
```

### Code File Structure (Target)
```
/calculations
  utilisation.js, llpCalculator.js, flyForward.js
  riskPeak.js, shortfall.js, maintenanceCal.js
  scenarioEngine.js, routeMatcher.js, narrativeGen.js

/services
  firebase.js, parser.js, fleetAggregator.js

/components
  Dashboard.jsx, AssetView.jsx, FlyForwardChart.jsx
  RiskPanel.jsx, ScenarioPanel.jsx, RouteMatcherUI.jsx
  OnboardingWizard.jsx, ShareView.jsx
```

### Data Flow
```
Utilisation Reports → Brain 1 → Firestore
LLP Disk Sheets     → Brain 2 → Firestore
Lease Rates         → Manual/Parsed → Firestore
                              ↓
                    Brain 3 (Fly-Forward)
                              ↓
                Brain 4 (Risk Peak) + Brain 5 (Shortfall)
                              ↓
                    Brain 6 (Maintenance Calendar)
                              ↓
                    Asset Risk Profile → Firestore
                              ↓
                    Fleet Snapshot (aggregated)
                              ↓
                    Layer 3 Overlay (scenarios, matching, narrative)
```

---

## 7. Security Architecture

### Current State (Internal Pilot)
- No authentication — deliberately deferred during pilot phase
- Firebase config exposed client-side — must fix before financial data added
- Firebase security rules — permissive/development mode

### Required Before Financial Data / External Users
1. Move Firebase config to Vercel environment variables — ✅ done
2. Move Cloudinary credentials to Vercel environment variables — ✅ done
3. Move Anthropic API key to Vercel environment variables — ✅ done
4. Tighten Firestore security rules — ⚠️ **corrected July 2026: this line previously read "✅ done (scope by companyId)," which was not true.** The live rules file was a single wildcard (`match /{document=**} { allow read, write: if request.auth != null; }`) — any signed-in user, full read/write, zero companyId or role scoping, on every collection. Rewritten this session (`TECH_DEBT.md` 4.28) to explicit per-collection rules: `leases`/`reserves`/`assets` now require the `admin`/`editor` custom-claim role for writes, `auditLog` is now append-only. **companyId-based scoping still does not exist anywhere in the rules** — see Section 14, also corrected this session.
5. Decommission abandoned Supabase projects — ✅ done June 2026
6. Firebase Auth — email/password + role-based access — ✅ done. Custom-claim roles (`admin`/`editor`/`viewer`, set via `/api/bootstrap-admin`, read client-side via `getIdTokenResult().claims.role`) are further along than this doc previously implied — the auth layer already supports real role-based access; it was the Firestore rules layer that hadn't caught up until this session.
7. Secure new V1 surface area: share-token access scoping — ✅ done (allowlisted fields only, 7-day expiry, revoke support, public lookup via Firebase Admin SDK so Firestore rules stay untouched); email ingestion webhook validation — ✅ done (companyId validation via expected-slug check, and the Email Review Queue now holds back high-severity reports pending Apply/Discard — see Section 12a)

### Role Structure — REVISED July 2026 (Layer 3 scoping session, four roles — supersedes the three-role model below)
**See `layer3-scenarios-build-handoff.md` §8 for full reasoning.** The three-role model couldn't cleanly serve two real use cases: C-suite needing full financial/scenario visibility without edit rights, and a data-entry person (intern/ops staff) needing Upload and Prospects without seeing financials. This resolves both, and closes the Fleet Exposure role-gating open item (`TECH_DEBT.md` 4.45).

| Role | Identity | Can see | Can edit |
|------|----------|---------|----------|
| Admin | Alan today | Everything | Everything + user management |
| Editor | Portfolio manager, technical lead | Everything | Assets, uploads, leases, prospects — not users |
| Viewer | C-suite | Everything including financials & Scenarios (Layer 3) | Nothing permanent — Scenarios are inherently non-destructive, so full read access carries no write risk |
| Data Entry | Intern, ops staff | Dashboard (Details), Prospects, Upload, asset detail (for verification) | Upload files, prospect data, lease/reserve pot entry (inputs, not the projections/financials those inputs feed) |

**Nav visibility per role** (see Section 7a for the four-layer nav model this maps onto):

| Role | Nav buttons visible |
|------|---------------------|
| Data Entry | Details · Prospects · Upload |
| Viewer | Details · Prospects · Portfolio · Calendar · Financials · Scenarios |
| Editor | Details · Prospects · Upload · Portfolio · Calendar · Financials · Scenarios |
| Admin | Details · Prospects · Upload · Portfolio · Calendar · Financials · Scenarios · Admin |

**Portfolio View is not a role — it's a presentation mode.** The same Viewer (C-suite) who reviews financials at their desk clicks to Portfolio before sharing their screen with a lessee or handing over their phone. No re-login, no role change, no toggle to build — this surface already exists and does the job.

Role naming ("Data Entry") is a working label — final naming deferred to a later pass.

**✅ BUILT July 2026** — Firebase custom claims, Firestore rules, and the Admin UI all updated to support `dataEntry` as a fourth assignable role, alongside a role-change-forces-logout fix (revoked refresh tokens server-side + periodic force-refresh client-side, since a role change previously had no visible effect until the user happened to sign out on their own). See `TECH_DEBT.md` 4.64. Closes the item below.

### Role Structure — original three-role model (superseded above, kept for history)
| Role | Access |
|------|--------|
| Admin | Full access including lease/financial data, user management |
| Editor | Upload reports, edit asset data, view financials |
| Viewer | Read-only. Currently no financial/lease data visible; **confirmed decision (July 2026, `TECH_DEBT.md` 4.30): Viewer will get Fly-Forward projection access once Fly-Forward is wired to real lease/reserve data (not the current fabricated demo)** — reserve pot entry/edit and raw lease terms stay Admin/Editor-only regardless |

### Data Privacy Principles
- EU data residency — Firebase europe-west2 (GDPR compliant)
- Lease PDFs never stored — parse and discard only
- Only confirmed figures written to Firestore
- Full audit trail — confirmedBy/confirmedAt on all financial inputs; `auditLog` collection is now genuinely append-only (writes allowed, updates/deletes denied at the rules level) as of July 2026
- companyId isolation — ⚠️ **corrected July 2026: not yet true.** `companyId` is written onto `leases`/`reserves` docs but has never been populated on any asset anywhere in the codebase, and no Firestore rule currently references it. See Section 14 and `TECH_DEBT.md` 4.29. Not urgent at current single-tenant scale, but this line should not claim isolation exists yet.
- SOC 2 — pursue if required in future

---

## 7a. Navigation — Four-Layer Model (✅ BUILT July 2026 — scoped in the Layer 3 session, see `layer3-scenarios-build-handoff.md` §7; built in a later session, see `TECH_DEBT.md` 4.65)

**Supersedes the flat nav bar (Dashboard, Portfolio, Fleet Exposure, Upload, Prospects, Admin) and resolves the nav-IA restructure question raised at the Fleet Exposure build's close (Section 19).**

### The model — same language at fleet and asset level
A user learns the vocabulary once; it means the same thing whether they're looking at one asset or the whole fleet, just different scope.

| Layer | Fleet level (nav bar) | Asset level (tabs within an asset) |
|-------|------------------------|-------------------------------------|
| **Details** | Dashboard — fleet overview, all assets | Specs, engines, LLPs, avionics, lease data |
| **Calendar** | Event clustering across fleet — ✅ BUILT July 2026, see `TECH_DEBT.md` 4.85 | Maintenance calendar, seasonality |
| **Financials** | Fleet Exposure — reserve gaps, cost exposure | Projection, pot-by-pot gap/surplus |
| **Scenarios** | Route Matcher + pandemic scenario slider (fleet-wide chat box killed, see Section 11) | Sliders + asset chat box, side-by-side |

**Why four layers, not three:** the old Layer 2 was doing two distinct jobs — the money (reserve projections/gaps) and the maintenance calendar (events, scheduling, seasonality). Splitting them gives each its own clear tab instead of overloading one page.

**"Fly-Forward" stops being a page name the user sees.** It becomes the internal engine powering the asset-level Calendar, Financials, and Scenarios tabs — the user navigates by concept, not by engine name.

### Tools stay visible, don't get buried
Upload and Prospects are daily-use workflow tools, not views — they sit alongside the four layers, not moved to a secondary menu. **As built, this is two separate pills** (Details/Calendar/Financials/Scenarios in one, Prospects/Upload/Admin in a second) using a shared `NavPill` component, rather than one pill with an internal divider as originally sketched — a later same-day design pass (`TECH_DEBT.md` 4.59) found the divider read as one continuous list rather than two distinct groups; two pills solved it. Sign Out sits outside both pills.

`[Details · Calendar · Financials · Scenarios]`  `[Prospects · Upload · Admin]`

Portfolio keeps its own nav pill — it's the presentation-safe surface (see Section 7), not a layer.

### Role visibility
See Section 7 for the per-role nav table. No role ever sees an empty group — each functional group only renders if the role includes it.

**✅ BUILT July 2026** — fleet-level and asset-level nav both restructured; see `TECH_DEBT.md` 4.65 for full build detail. **Fleet-level Calendar and Scenarios are now both built** (`TECH_DEBT.md` 4.85, July 2026): Calendar shows event clustering across the fleet (reused `MaintenanceCalendarGrid`, no cost figures); Scenarios holds Route Matcher (with clash detection) plus the pandemic scenario slider — the fleet-wide chat box originally planned alongside Route Matcher was killed, not built (see Section 11). Per-asset Scenarios (sliders + chat box) was already built in an earlier session.

---

## 8. Lease Data Input — Manual Entry + AI-Assisted Upload (Path 1 + Bulk Import built July 2026)

**Three tiers, built into the per-asset Lease Wizard as a first-screen choice ahead of the existing pot checklist:**

### Manual Entry (v1 build target — built)
```
User selects pot from a pre-populated checklist
(4 fixed pots + auto-generated engine pots + custom-pot escape hatch)
      ↓
User confirms/enters rate + opening balance for that pot
      ↓
AI validates via the same server-side proxy pattern as
existing extraction (api/extract.js) — figures only, not a document
      ↓
Warning shown if flagged — explicit acknowledgment required
to save (tied to confirmedBy/confirmedAt), not a hard block
      ↓
Figures written to Firestore with audit trail
```
See Section 9 for the full wizard/pot-entry design.

### Quick Extract — built July 2026
Whole document (PDF or Word) sent for extraction in one pass. PDFs go as a native `document` content block; Word docs have no such content type, so text is pulled client-side via `mammoth.extractRawText()` first and sent as plain text. Most complete of the three tiers — because the whole document is processed at once, it can find the lessee name and lease dates as well as the rate schedule, which live on different pages/sections of most real leases.

### Confidential Extract — built July 2026
```
Upload lease document (PDF or Word)
      ↓
Text extracted CLIENT-SIDE (pdf.js for PDF pages, mammoth.js
for Word section-chunking) — nothing sent anywhere yet
      ↓
Local keyword + rate-figure-density scan identifies candidate
page(s)/section(s) containing the rate schedule
      ↓
User confirms the correct page/section
      ↓
ONLY that confirmed piece's text sent to api/extract.js for
structured parsing — rest of the document never leaves the browser
      ↓
Draft figures shown to user for review, then confirmed
      ↓
Only confirmed figures saved to Firestore; extracted text discarded
```
**Why local-extract-and-narrow-send, not "send the whole document":** instructing Claude to only *report* certain fields back doesn't reduce what's sent — the full document still reaches Anthropic's systems either way. Narrowing what's sent *before* the API call is the only mechanism that actually reduces exposure of commercially sensitive lease terms beyond the rate schedule itself. Because only one confirmed piece is sent, this tier typically won't catch the lessee name or lease dates — the tier's own description says this upfront now, rather than it being a surprise on the review screen.

**ZDR resolved, July 2026 — not pursued, dropped from scope entirely.** Confirmed via current Anthropic documentation that Zero Data Retention is a sales-negotiated, per-organization enterprise arrangement, not something enabled by request at TailiQ's current pay-as-you-go scale (~$27–60/year API spend). The privacy claim to lessors rests entirely on the narrow-send architecture above instead — arguably a stronger pitch than a ZDR arrangement would have been, since it's verifiable by reading the client-side code rather than trusting a third party's retention promise. Standard API behaviour (7-day retention, no training on API data by default) is cited only as a baseline reassurance, never as the headline claim.

**Word document heading-detection — real, non-obvious problems, diagnosed and fixed by direct inspection of a real lease file** (not inferred from screenshots — `python-docx` + a Node `mammoth` test harness were used to confirm each fix before shipping):
- Word documents have no real pages (pagination is a print-layout artifact) — chunked at heading boundaries instead, labelled by the actual heading text.
- Splitting at every heading level fragmented documents into near-sentence-sized pieces (real legal documents apply heading-like bold styling inconsistently); splitting at only the single broadest level then risked excluding a genuine section that happened to sit at a different level.
- **Root cause:** major Part/Schedule headings used a custom Word style ("Leader") invisible to `mammoth`'s default style map — fixed with an explicit `styleMap`. The specific rate-schedule boundary that mattered most used plain "Body Text" style with only a manually bolded run — genuinely indistinguishable by style name, requiring a formatting-based detector (`isBoldPseudoHeading`: a short, near-entirely-bold paragraph) instead. Combined with a short-fragment-merge safety net and dedicated table-chunk extraction, this correctly surfaces the real rate schedule as a properly-sized, correctly-labelled, top-scoring candidate.
- Candidate scoring reweighted around actual rate content (`RATE_CONSTRUCT_RE` — a `$amount` immediately followed by its accrual basis) and a clustered-dollar-figure bonus, since bare keyword mentions (e.g. "LLP," "restoration") scored just as high in lease **definitions** clauses as in the actual rate table.

### Bulk Lease Import — ✅ BUILT (July 2026)
The real value case for AI-assisted upload identified back when this was scoped — multiple lease PDFs/Word docs uploaded at once, auto-matched to existing assets by MSN/registration, run through the same Quick Extract/Confidential Extract pipeline above. Built inside the existing **Upload tab** as a new `uploadType` (not a new top-level nav item — the Upload tab's existing util/LLP/APU-LLP types already share the same "upload a document, extract it, match it to an asset" shape). Manual entry is excluded from bulk (defeats the point of a batch flow); tier choice (Quick vs Confidential) is once-per-batch, not per-document. No-match files drop into a "needs manual assignment" queue row — dropdown to pick an existing asset, or skip — never auto-creating a new asset, consistent with the Section 9 asset-creation/lease-setup split. Scanned/non-text documents are flagged "needs manual entry" without stalling the rest of the batch.

**Save step redesigned mid-build into two explicit paths**, after Alan pointed out that a single "Save Lease" button which only ever wrote the lease record plus a rate prefill always required a follow-up trip to that asset's own Lease Wizard just to get the parsed rates actually persisted:
- **Save Details for Later** — lease record created, parsed rates persisted as a new `aiPotPrefill` field on the lease doc (picked up automatically the first time that asset's Lease Wizard is opened).
- **Activate Lease** — creates the lease *and* writes real reserve pot docs immediately for every parsed/edited rate, correctly fanned out across engine positions. Every candidate pot is validated (same `validatePotWithAI` check used everywhere else) before anything is written; any flagged rate blocks the *entire* commit until explicitly acknowledged — all-or-nothing per row, not a partial write.
- Opening balance is the one thing neither path captures — it's asset-specific current reserve state, never present in a lease document, so it's always completed afterward via the asset's own Lease Wizard.

Full detail in `TECH_DEBT.md` 4.36.

### Why the Parse-and-Discard Principle
Lease rates are commercially sensitive. Lessors are protective of their negotiated positions. By never storing the lease document and only saving confirmed figures, TailiQ can honestly say: "We never store your lease documents. Only what you explicitly confirm ever touches our database." *(Note: once AI validation or Quick/Confidential Extract parsing is in use, figures/text transiently pass through the Anthropic API even though nothing is retained — "never store" holds, "never see" needs care in exact wording, which is why the in-app copy for these tiers uses "store," not "see.")*

---

## 9. Lease / Reserve Setup (formerly "Mid-Lease Asset Onboarding" — restructured July 2026) — ✅ BUILT (July 2026)

### Key Structural Decision: Split From Asset Creation
**Asset creation and lease/reserve setup are two separate flows, not one combined wizard.** Asset creation (MSN, engine/APU details, tech spec import, first utilisation upload, first LLP disk sheet) is the existing, already-proven Add Asset flow — unchanged, and not rebuilt or absorbed into this work. This new flow assumes **an asset already exists in TailiQ** and adds only the lease/reserve layer on top of it.

**Why split, not combined:** keeps error isolation clean (asset data problems and lease data problems are separate concerns), avoids redoing already-solid Layer 1 work, and keeps the new flow short — a genuinely new asset just goes through the existing Add Asset flow first, then this flow, rather than one long combined wizard trying to do both at once.

### The Clean Break Principle
The app does not need historical data to forecast forward. It only needs current state.

### Add Lease / Reserve Setup — Flow (built July 2026)
```
Overview (shown only if a lease already exists on the asset):
  Lessee/dates/migration date summary + pot completion counts (red/amber/green)
  → "Reserve Pots →" / "✏ Edit Lease Details" / "🗑 Delete This Lease"

Step 1: Lease Details
  Lessee (airline), lease start/end date, migration date (auto = today)

Step 2: Reserve Pot Entry (the core new work — see below)

Step 3: Confirm & Activate
```

Utilisation baseline and LLP stack status are **not** rebuilt as wizard steps — they're existing, continuous features every asset already uses. Step 2 includes a lightweight staleness check ("does this asset have a recent-enough utilisation/LLP reading to serve as a reserve baseline?") that points to the existing upload screens if stale or missing, rather than duplicating that upload experience inside this flow.

**Overview screen added during build** (not in the original design): reopening the wizard on an asset that already had a lease was initially built to skip silently straight to Step 2 pot entry — Alan flagged this as unclear, since it hid the lease's existence entirely and buried the Delete action behind a "← Back" click. The Overview screen now always shows first for an existing lease, with Reserve Pots / Edit / Delete as three equally-visible actions.

**Activate is diff-aware:** re-confirming an unchanged lease (the common case — just adding more pots over time) does **not** create a new append-only lease record; it only saves pot updates and leaves the existing lease doc untouched. A new lease record is only written if lessee/dates/migration date actually changed from what was loaded — preventing a pointless duplicate history entry every time the wizard is reopened.

### Step 2 — Reserve Pot Entry (built July 2026)
**Pre-populated checklist, not a blank form or a "pick a type" menu:**
- **4 fixed pots auto-listed:** AF-6Y, AF-12Y, AP-OH, LG-OH — near-universal across leases, presented ready to fill
- **Engine pots auto-generated** from the asset's already-known engine configuration (EN-PR-1/EN-LP-1, EN-PR-2/EN-LP-2, etc. — same pattern as existing Layer 1 engine differentiation), not manually added
- **"Add custom pot"** escape hatch for anything on a real schedule that doesn't fit these categories

**Per-pot entry is one unit, not split rate-then-balance passes:** for each pot — pick/confirm type → confirm rate → enter opening balance — together, then move to the next pot. Matches how the data actually arrives: transcribed directly off the lessee's own Maintenance Payment Rate schedule, which lists these as paired rate+category line items, not two separate documents.

**Partial completion is allowed.** The wizard can be finished with some pots outstanding; incomplete pots are flagged (red/amber/green, matching existing LLP progress visual language) and Brain 3 excludes/caveats them in its output rather than treating them as zero (see Section 5 design rationale). This also covers the "totals-only lease handover" edge case — if only a lump-sum reserve balance is available (not itemised per pot), the individual pots stay marked outstanding rather than auto-splitting a guessed distribution; that would fabricate precision the same way the reverted lease-start-date feature did.

**Validation is a warning, not a hard block.** A real AI check runs via the same server-side `/api/extract` proxy pattern as existing extraction (figures only, no documents), flagging implausible entries — but requires explicit acknowledgment to save rather than blocking outright, covering real edge cases (a genuinely unusual but correct rate, a newly renegotiated lease outside historical ranges) without letting an obvious typo through unnoticed. **A deterministic check runs first for EN-LP pots specifically** — comparing the entered rate directly against the known catalogue blended rate (`llpCatalogue.js`) rather than relying on the AI call alone, since a hard reference number already exists for this one pot type. See `TECH_DEBT.md` 4.26/4.27 for two real bugs found in the AI-validation layer and why the deterministic backstop was added.

### Step 0 — Incoming Tech Spec Import (Optional, part of Add Asset flow, not this flow)
Upload the outgoing lessor's tech spec PDF before beginning manual entry. Claude extracts available static fields and pre-populates the asset record for review.

**What can be extracted:** MSN, registration, model, DOM, operating weights, configuration, seating, avionics toggles, engine/APU S/Ns, check history dates, LLP data if present in the spec.

**What cannot be extracted:** Reserve balances, lease rates, current utilisation — those are never in a tech spec, and belong to the separate Add Lease flow above, not this step.

**Principles:**
- Parse and discard — same principle as lease PDFs, never stored
- User confirms each field before anything is written to Firestore
- Confidence varies — third-party specs differ wildly in format and completeness
- Extraction failures are non-fatal — any field Claude can't read stays blank for manual entry
```


---

## 10. Seasonality & Scheduled Events

### Seasonality — Three Tiers
1. **Manual configuration** — user defines monthly utilisation weightings (day one)
2. **Pattern detection** — system suggests profile after 6 months of data
3. **Confirmed seasonal model** — full annual cycle verified after 12 months

### Scheduled Maintenance Events
C-Checks and shop visits appear in three places:
1. **Maintenance Calendar** — scheduled date, duration, cost estimate
2. **Fly-Forward Cash Flow** — cash outflow at event date reduces reserve bucket
3. **Utilisation Projection** — zero flying during event reduces annual cycle totals

### Impact On Projections
```
Example C-Check impact:
  Normal flying:    46 weeks × 70 FC/week = 3,220 FC
  C-Check:           6 weeks × 0 FC/week  =     0 FC
  Actual projected:                          3,220 FC
  
  vs flat rate assumption:
  52 weeks × 70 FC/week = 3,640 FC ← overstated by 420 FC
```

---

## 11. Route Suitability Matcher (Layer 3) — ✅ BUILT, extended with clash detection + pandemic scenario July 2026, see `layer3-scenarios-build-handoff.md` §4 and `TECH_DEBT.md` 4.85

**Supersedes the five-dimension scoring sketch below with a concrete, buildable design from the Layer 3 Opus scoping session — now built and live, plus two follow-on additions this session.**

### What it answers
"We have this route/wet-lease/seasonal schedule to fill — which asset in the fleet is best placed to fly it?"

### Input — a route is a utilisation profile plus a window
| Field | Description |
|-------|-------------|
| FH/month | Projected flight hours per month for the route |
| FC/month | Projected flight cycles per month for the route |
| Start date | When the route begins (e.g. a wet lease, a summer-only schedule) |
| End date | When the route ends |

FH:FC ratio falls out of the two rates — the user doesn't need to think in ratio terms, just what they know operationally about the route.

### Mechanical process
No new calculation engine. Every eligible asset is run through the existing Brain 3/4/5/6 pipeline twice — once under its **current** utilisation profile, once under the **proposed route** profile for the route window — and the two runs are compared.

### Output — ranked by operational fit, financial impact shown alongside
For each asset:
- **Operational fit** — do any maintenance events fall inside the route window? How do event dates shift vs. the asset's current profile (moved forward/back by N months)?
- **Financial impact** — what does the changed utilisation do to the reserve gap? Cost delta of running this asset on this route vs. leaving it on its current profile.

Ranked **by operational fit** (fewest disruptions, most favourable event shifts) — financial impact is shown per asset, not used as the primary sort, since the best operational fit and the cheapest option may be different assets. The user sees both dimensions and decides.

### Clash detection — ✅ BUILT July 2026 (`TECH_DEBT.md` 4.85)
Previously deferred as blocked ("Route Matcher/Brain 8 itself isn't built yet" — see Section 19 history). Now built: a candidate's ROUTE-profile C-Check windows are checked against every OTHER asset's own BASE-case C-Check windows for genuine date overlap — **overlapping date windows accounting for check duration**, not just same-month clustering (confirmed design choice, deliberately stricter than Fleet Exposure's month-bucket clustering). Surfaced as a clash badge + full detail list (which asset, which codes, which windows) in `RouteMatcherView`'s expanded rows.

### Where it lives
Fleet-level, inside the **Scenarios** nav item (see Section 7a), alongside the pandemic scenario slider (see below). **The fleet-wide chat box originally planned alongside it here is killed** (Alan, July 2026) — no fleet-wide natural-language "what if" remains; Route Matcher + the pandemic slider are the complete fleet-level Scenarios surface now.

### Pandemic scenario slider — ✅ BUILT July 2026, replaces the killed chat box's one surviving use case (`TECH_DEBT.md` 4.85)
The fleet-wide chat box's original example set included "what if there's another COVID — all aircraft grounded for 4 months" (see the chat-box section below, kept for history). With the chat box killed, this single hypothetical was kept as its own dedicated control rather than dropped entirely: a slider (1–12 months, not a fixed-duration button — confirmed design), grounding every asset from today for the selected period, combined with each asset's own real maintenance grounding via `Math.min` per month (no stacking — same "longest/most-grounded wins" rule Brain 6 already applies to overlapping C-Checks). Shows base-case vs. scenario Fleet Exposure headline (High-case gap), side by side. Non-destructive, same as everything else in Scenarios.

---

### Original five-dimension sketch (superseded above, kept for history)
When an airline proposes new flying, TailiQ scores every asset in the fleet across five dimensions:

1. **LLP Headroom** — does any LLP expire during the proposed window?
2. **Reserve Impact** — does additional flying accelerate a risk peak into this window?
3. **Maintenance Conflicts** — is there a C-Check or shop visit during these months?
4. **Current Utilisation Headroom** — is the asset already flying hard?
5. **Reserve Rate Alignment** — is the contractual rate adequate for this intensity?

Output: ranked fleet with score, plain English reasoning, and recommendation per asset.

---

## 12. Sharing, QR Codes & Email Ingestion

### Share Token System — ✅ Built (June 2026)
```
Asset selected for sharing (Share button on asset detail view)
      ↓
Token generated client-side, written to Firestore shareTokens/{token}
      ↓
URL: {app-domain}/share/{token}
      ↓
Public, unauthenticated Vercel function (api/share/[token].js) using the
Firebase Admin SDK looks up the token, checks revoked/expiry, and returns
ONLY an allowlisted set of tech-spec-safe asset fields
      ↓
share.html renders the same buildTechSpecHTML() the authenticated app
uses (extracted to calculations/techSpecBuilder.js so both pages share
one implementation), read-only, with its own Print/Save PDF button
```

**Scope actually built:** a single tier — Tech Spec Share (asset details, LLP status, photos; no financials). The original three-tier concept (Tech Spec / Portfolio / Full Asset incl. Fly-Forward) is deferred — Portfolio and Full Asset tiers don't have a clear use case yet and Full Asset can't exist meaningfully until Layer 2 financial data exists anyway. Revisit tiering if/when a real need for the other two shows up.

**Token details:** stored at `shareTokens/{token}` (token is the doc ID — direct lookup, no query/index needed) with `assetId`, `companyId` (currently `null` pending the companyId backfill, see 2.3), `createdAt`, `expiresAt` (7 days from creation), `revoked`, `createdBy`. Expiry and revocation are both checked server-side on every request — never trust the client. Regenerating creates a new token; old tokens keep working until they expire or are explicitly revoked.

**Why a serverless function instead of relaxing Firestore rules:** the existing `request.auth != null` blanket rule stays completely untouched. The public function uses the Firebase Admin SDK (which bypasses rules entirely, by design, for trusted server-side code) and applies its own allowlist instead of a denylist — meaning Layer 2 financial fields will never leak through this endpoint even if someone forgets to update it, since they'd need to be explicitly added to the allowlist to appear at all.

### QR Code
- Generated via `api.qrserver.com` image endpoint (no client-side library/dependency needed) — `<img>` pointing at `https://api.qrserver.com/v1/create-qr-code/?size=...&data=...`
- Shown directly in the Share modal for in-meeting use — this QR is per-asset, points at that asset's own share link
- **Cover QR (built June 2026, currently disabled):** a gold-outline pill was built linking to `tailiq.app`, confirmed working in actual generated PDF output. Subsequently disabled for internal use — `QR_TAILIQ` constant retained in `techSpecBuilder.js`, `COVER_PILL` set to `''`. Do not conflate with the Share-modal QR (per-asset dynamic share link) — they are separate mechanisms. The cover pill can be restored from git history when needed.

### WhatsApp & Copy Link
- WhatsApp: plain `wa.me/?text={url}` link, no API/integration needed
- Copy Link: `navigator.clipboard.writeText()`
- Both sit alongside the QR code in the same Share modal, all three pointing at the same URL

### Email Ingestion — Option A + C (not yet built — last open V1 gate item)
**Option A:** Each organisation gets unique address — `{company}@reports.vectoriq.app`
**Option C:** Lessor sets forwarding rule from existing inbox — airline changes nothing

Both options process identically:
```
Email arrives at {company}@reports.vectoriq.app
      ↓
SendGrid Inbound Parse fires webhook to Vercel function
      ↓
Function identifies companyId from email address
      ↓
PDF/Excel attachment extracted
      ↓
Claude parses document
      ↓
Data written to Firestore under correct companyId/assetId
      ↓
Notification sent to relevant users by role
```

Build single-company first. Extend to multi-tenant when second organisation onboards.

**Status: built and tested (June 2026).** `api/email-ingest.js` live at `maverick@reports.tailiq.app`, validated end-to-end with two real emails (March report → new asset created; May report → merged, gap correctly detected by Brain 1). Every inbound email is treated as a utilisation report (the recurring, airline-mailed case) — LLP/APU LLP sheets stay on the manual Upload flow since they're infrequent and MRO-issued, not a recurring mailbox pattern. Trust boundary is the recipient local-part validated against `EXPECTED_COMPANY_SLUG` (an unguessable-address model, not cryptographic auth — acceptable for one company, revisit if this scales to multiple lessors with predictable address patterns).

---

## 12a. Surfacing Email-Ingested Warnings — ✅ RESOLVED June 2026 (Email Review Queue)

Brain 1's delta/gap/S/N-change detection runs identically regardless of whether a report arrives via manual Upload or via email — `result.warnings`, `result.deltaCheck.status`, and `result.snChanges` come back the same either way. Previously, the manual Upload flow showed these on a review screen before Confirm & Save, while email-ingested reports had no equivalent — warnings were written to `notifications` but nothing surfaced them in-app.

**Decisions taken:**
- **Severity classification needed no new logic.** Brain 1's warning strings already encode severity via their leading glyph — "⚠" for things that should hold a report back (S/N change, delta mismatch, gap detected), "ℹ"/"🔧" for informational notes (same-month merge, removal log) that are fine to apply immediately. `hasHighSeverityWarning()` in `api/email-ingest.js` just checks for that prefix.
- **Hold-back is real, not just a banner.** High-severity reports now stage the already-computed `mergedAsset`/`utilisationRecord`/`warnings` into a new `pendingReports` Firestore collection instead of writing live — the same way `historyOnly` out-of-order uploads already never touch live state. Low-severity-only reports keep applying immediately.
- **Shape chosen: lightweight Dashboard banner, not a full Inbox app.** A collapsible "⚠ N email reports awaiting review" banner expands to a simple list (MSN, period, warnings, Apply/Discard). Apply writes the already-computed merge result — no re-parsing, no re-running Brain 1, so there's no risk of a different outcome between ingest time and review time. Discard just deletes the pending doc, leaving the asset untouched (equivalent to rejecting the report outright).
- **Known accepted tradeoff:** no auto-apply timeout exists if a held-back report sits unreviewed — the asset's figures stay stale until Alan acts. Fine for a single-user pilot; revisit if this becomes a multi-user concern.

**Verified working:** Alan tested a real months-gap scenario end-to-end — held back correctly, appeared in the Review Queue, applied successfully. See `TECH_DEBT.md` 0.5 for full implementation detail.

---

## 13. Tech Spec Format

### TailiQ Standard (Non-Negotiable)
The tech spec output is the TailiQ standard format. It is not configurable per client.

### Permitted Customisation
- Company logo in header ✅
- Company name and contact details ✅
- "Powered by TailiQ Fleet Intelligence" footer — always present, not removable ✅
- Everything else — fixed ✅

### QR Code on Cover (Built, Currently Disabled)
A QR code on the tech spec cover was built (June 2026, see `TECH_DEBT.md` 0a) but is currently disabled for internal use. `QR_TAILIQ` constant retained in `techSpecBuilder.js` for future reactivation. The cover pill can be restored from git history when needed.

### Queued Additions (July 2026 comparison session, not yet built — see `TECH_DEBT.md` 4.51)
- **Check facility** — free-text field per Check History row.
- **Annual utilisation / FH:CY ratio** — derived airframe-level stat, same pattern as the existing engine FH:FC ratio.
- **Avionics Manufacturer** — independently optional field alongside Description/P/N (never paired), AI best-effort extraction, reviewed on the existing edit screen. Partial reversal of 4.50's original "dropped, too inconsistent" call, based on a 10-sample tally showing Manufacturer present in 7/10 real airline avionics sheets.

### Considered and Rejected/Parked (July 2026 comparison session)
- Registration history table — dropped, not worth the manual-entry effort.
- Airframe-level certification basis (type certificate numbers) — parked pending Alan confirming whether the underlying Type Certificate Data Sheet reference is worth tracking.
- Scraping Airfleets.net for registration/operational history — rejected outright (fragile no-API scrape, unverifiable community data, undercuts the "auditable/defensible/traceable" positioning), not just deprioritised.
- Kahala-style side-by-side dual-engine summary card — rejected as pure duplication of the existing per-engine full-page treatment (pages 3–4 already show more per engine than Kahala's compact row).

---

---

## 14. Multi-Tenancy

### companyId — ⚠️ Corrected July 2026: Not Actually Implemented Yet
This section previously read "Every Firestore document has `companyId`. Every query filters by `companyId`. Security rules make cross-tenant access physically impossible." **None of that is true.** Discovered and corrected during this session's Firestore rules work (`TECH_DEBT.md` 4.29): `companyId` is written as a field on `leases`/`reserves` documents (per the Section 5 schema), but **no asset has ever had `companyId` set**, in the Add Asset flow, the Prospect editor, or anywhere else — so it's `null`/`undefined` everywhere in practice. No query in the codebase filters by it. No Firestore rule references it. This was correctly reflected as not-yet-done in Section 17/19's checklists all along — Sections 7 and 14 were the stale/aspirational ones, now brought in line.

**Decision (Alan, July 2026):** leave `companyId` as `null` for now rather than inventing a placeholder value. TailiQ is genuinely single-tenant today (Maverick Horizon internal only); a placeholder invented now risks being the wrong shape once the real company model below is actually designed.

### Adding A Second Organisation (future — not yet built)
1. Create Firebase Auth account for new organisation
2. Assign `companyId`
3. They log in to empty, isolated portfolio
4. They onboard their own assets
5. No code changes required — *once the above is actually implemented*

### Future Architecture (When Needed)
Current: Shared Firebase project, `companyId` field reserved on schema but not yet populated or enforced anywhere
Future: Populate `companyId` on assets, filter queries by it, scope Firestore rules by it (Section 7) — then, if an enterprise client demands full isolation, schema-per-tenant or database-per-tenant

---

## 15. Knowledge Base (Layer 2 feature) — ✅ BUILT July 2026

Centralised, editable house-view forecasting assumptions — previously scattered as hardcoded constants across `pots.js`, `FIXED_RESERVE_POT_DEFS`, and `maintenanceCal.js`. Built per the locked `knowledge-base-scoping-handoff.md` design (Opus scoping session), full build detail in `TECH_DEBT.md` 4.82/4.83/4.84.

### What it is
Two components under one Admin tab:
- **Forecasting Defaults** — check cost bands (AF-6Y/AF-12Y/LG-OH/AP-OH), EN-PR bands per engine family, LLP escalation %/yr per family, blended LLP $/FC rate per family, check durations (2Y/6Y/12Y grounding weeks), default outflow escalation %.
- **LLP Catalogue** — per-part-number pricing (`partNumber`, `unitPrice`, `engineFamily`, `catalogueYear`), scanned live off the fleet's own LLP sheets per family, editable manually or via Excel/PDF upload with review before save.

### Three-tier hierarchy (per §3 of the scoping doc)
1. **Per-asset/per-pot override** — an already-saved pot or scheduled-event override always wins.
2. **Knowledge Base company default** — this feature.
3. **Code fallback** — hardcoded values, so the app stays fully functional before the Knowledge Base is ever populated.

`src/lib/knowledgeBase.js` is the single place tiers 2/3 are resolved (`getCheckCostBand()`, `getEnPrBand()`, `getOutflowEscalationPct()`, `getCheckDurationDefaults()`), plus `bootstrapKnowledgeBaseGlobals()` which populates two window globals — `window.LLP_CATALOGUE_PRICES` and `window.lookupLLPCataloguePrice()` — that Brain 3 (`flyForward.js`) and `pots.js` were **already written to read defensively**, with nothing populating them until this session. Brain 6 (`maintenanceCal.js`) needed **zero code changes** — it already accepted a `durationDefaults` input parameter that simply had nothing behind it before now.

### Pre-fill only, never retroactive
New reserve pots pre-fill from Knowledge Base defaults at creation; an already-confirmed pot's saved values are never changed by a later Knowledge Base edit (see Section 18).

### LLP Catalogue upload — Excel and PDF, both real-world tested
- **Excel:** scans every sheet in the workbook (real escalation-model spreadsheets commonly split by engine family across sheets), matches on any header containing "part number"/"P/N"/"material" and any header containing "price" (taking the rightmost — most recent year — when several exist), no AI involved.
- **PDF:** a targeted **lookup**, not a full-document extraction — client-side text extraction (`extractPdfPageTexts`) + string search for the fleet's own known ~50-60 part numbers, sending only matched snippets to `/api/extract`. Deliberately redesigned mid-session after a real 100+ page full manufacturer catalogue broke the original whole-document-extraction approach (504 timeout, and even with more time a full catalogue's rows wouldn't fit one model response) — cost and latency now scale with the fleet's own part count, not the source catalogue's length.

### Read-only Assumptions panel
Fly-Forward has a read-only "Assumptions" button (any role including Viewer) showing the Knowledge Base values driving the current projection — per §4 of the scoping doc.

### Deliberately not built this session
Cost pooling/benchmarking across clients ("Glassdoor model" — parked, revisit at 10+ clients), AI-driven cost-trend analysis (years of real actuals away), Shop Visit cost-actuals aggregation view.

---

## 16. End of Lease Position + TAC Pipeline — ✅ BUILT July 2026

`endOfLeasePosition.js` is deliberately not a numbered Brain (per its own file header: "assembly, same as Fleet Exposure — no new data collection, no new Brain"). It reuses Brain 2's LLP data and Brain 3's reserve-tail projections, assembled into two outputs: the money side (per-part `(A/B)×(C−D)` redelivery adjustment) and the physical side (three redelivery life margin checks).

**Status:**
- **The calc module itself** — built and validated in an earlier scoping session (`end-of-lease-position-handoff.md` / `eol-position-addendum.md`).
- **Wired into the app** — a `📄 End of Lease Position` button + view in `FlyForward.jsx`'s Financials tab, gated on `lease.endOfLeaseTerms.applies`. See `TECH_DEBT.md` 4.88.
- **TAC (Technical Acceptance Certificate) upload pipeline** — new upload type in `UploadView.jsx` supplying the one input the calc module cannot derive itself: `D`, the per-part delivery FC baseline. Writes onto the lease document via a merge write (`db.saveTACSnapshot`) — a deliberate departure from the lease record's usual append-only pattern, since a TAC is a fixed historical fact rather than a renegotiated term. See `TECH_DEBT.md` 4.89, 4.90.
- **Real-world constraint confirmed during testing:** TACs commonly arrive as one document *per engine*, not one combined document — the upload flow merges per-engine rather than replacing the whole snapshot on each upload (4.90 was a real data-loss bug found in exactly this scenario, now fixed).
- **Not yet built:** the "Generate Report" PDF export of both cards (deferred, Alan confirmed the in-app view is sufficient for now); APU TAC support (`componentsCovered` currently only ever lists `ENGINE_LLP`).
- **Live-tested end-to-end, July 2026** — Demo Asset 4 (MSN 5533, A320-232/CFM56-5B4/P) was built specifically to exercise the full chain (lease + TAC + Engine LLP sheets, D = 11,200 FC on both engines) for the first time; the earlier live test (MSN 1009) had no TAC on file, so this was the first real confirmation of a computed, non-uncomputable EOL figure. Result: combined $505,132 lessee-owed adjustment across both engines, within ~3% of the hand-estimated figure used when the demo was designed. See `TECH_DEBT.md` 4.91.
- **New open item from this test:** TAC upload requires an active lease already on file — no path exists to attach a TAC before a lease is entered. Consistent with the expected onboarding order for most clients, but worth a short design discussion to confirm, rather than assume, this is the only order anyone would hit — see `TECH_DEBT.md` 4.92.

---

## 17. Build Roadmap

### Immediate Priority — V1 IT/Security Gate
See Section 3a for the full checklist — now a clean 7 of 7, no items remaining. Ready for the internal IT review.

### Layer 1 Hardening (Current Focus)
- [x] Fix Excel upload parsing (SheetJS → text → Claude) — confirmed non-issue on review (June 2026), stale entry
- [x] Add user-friendly error messages (no raw JSON errors) — confirmed non-issue on review (June 2026), stale entry
- [x] Extract Brain 2 (`llpCalculator.js`) to `/calculations` — done, pure function, no UI/Firebase deps
- [x] Extract Brain 1 (`utilisation.js`) to `/calculations` — done; covers delta verification (FC/FH), S/N change detection (engines, APU, landing gear), and merge logic; resolved a pre-existing falsy-zero CSN bug along the way; new behaviour added: out-of-order/duplicate-period uploads now save to history only (never overwrite live asset state), gap-month detection widens delta tolerance and surfaces an informational flag
- [ ] Add companyId to all existing Firestore documents — **deliberately still open.** `companyId` has never been populated on any asset; it is `null` throughout. Left as `null` rather than inventing a single-tenant placeholder, pending the real Section 7 multi-tenancy design. See `TECH_DEBT.md` 4.29
- [ ] Harden delta verification edge cases
- [ ] Verify S/N change detection across all component types
- [ ] LLP extrapolation seasonal refinement
- [x] Tech spec logo made resizable and replaceable — new "Tech Spec Logo" card in Admin → Settings (slider 80–320px with live preview, custom upload via Cloudinary, revert-to-default). Applies to both Full Aircraft and Engine tech spec covers, stored as a Firestore setting same pattern as Engine Stock Photos (done June 2026)
- [x] Specs additions per team feedback (done June 2026): Winglets type field, Electronic Flight Bag installed/not-installed toggle, 2 Year Check support. Check History auto-next-due logic generalised from a hardcoded 6/12 regex match to parse any "N Year Check" name; added an Add Check control (2/6/12yr presets filtered to exclude what's already on the asset, plus free-text) and a per-row delete, so existing assets can be retrofitted with new check types without a data migration
- [x] Wheels & Brakes added to Landing Gear tab — separate card from the three gear legs (Main Wheels / Nose Wheels / Brake Units), each with optional Qty/P-N/Manufacturer. Tech spec renders this as an ATA-chapter-style table matching the AerCap spec format the team referenced, and only shows rows/section where data is actually entered (done June 2026)
- [x] TailiQ rebrand — app header logo and tech spec cover banner/footer replaced with new slate/navy wordmark design; mobile header layout fixed (no horizontal scroll, responsive nav collapse) (done June 2026)
- [x] Tech spec Specifications split into two columns — fixes second-page overflow (done June 2026)
- [x] Dashboard stat boxes removed — redundant against existing colour-coded status system (done June 2026)
- [x] **TailiQ vs VectorIQ naming question — resolved June 2026.** Alan gave explicit sign-off; full docs-only naming pass completed across this document and `TECH_DEBT.md` (Sections 1/13/15/16/18 and equivalents) — see `TECH_DEBT.md` 0.6 for full detail. Codebase itself had already been consistently TailiQ for several sessions.
- [x] Codebase branding sweep — done June 2026; remaining "VectorIQ"/"Vector Fleet Manager"/"Vector Group" strings corrected across `index.html`, `share.html`, `techSpecBuilder.js`, `calculations/utilisation.js`, `api/share/[token].js`. Docs-only pass (this document's Sections 1/13/15/16/18) completed — see line above
- [x] Self-service user invite flow — done June 2026; Admin SDK create user + custom oobCode-based reset link (bypassing Firebase's hosted action page), TailiQ-branded SendGrid email, new `SetPasswordScreen` view. Three bugfixes along the way: Firebase Authorized Domains entry for `app.tailiq.app`, oobCode redirect routing, and an init-order race — see `TECH_DEBT.md` 4.9 for full detail
- [x] Mobile contained-scroll fixes — done June 2026; asset tab bar and Utilisation History table both scroll within their own container now instead of forcing the whole page to scroll horizontally
- [x] Landing Gear Reference Reading fields made edit-only — done June 2026; the four calculation-only inputs (Leg/Airframe TSN/CSN at reference) are hidden outside admin edit mode, no change to the underlying calculation
- [x] Share button added to Fleet Portfolio cards — done June 2026; same per-asset token flow as the existing asset-detail Share button, confirmed per-asset only (no portfolio-wide share)
- [x] Tech spec disclaimer system rebuilt — done June 2026; three-tier precedence (per-asset Specs tab override → fleet-wide Admin → Settings default → hardcoded fallback), combined logo+disclaimer into one Settings card by design so both are changed together, and closed the gap where public share links couldn't see the fleet-wide default (now fetched directly by `api/share/[token].js` and passed through `share.html`)
- [x] Tech spec cover QR code + footer redesign — built June 2026, confirmed in PDF output; cover pill subsequently disabled for internal use (`COVER_PILL=''`), `QR_TAILIQ` constant retained for future reactivation. Footer (nav-light dots + "Powered by TailiQ Fleet Intelligence" on every page) remains in place. See `TECH_DEBT.md` 0a for the wkhtmltopdf `@media print` gotcha
- [x] Nav-light dot order corrected across every brand asset — done June 2026; red-left/green-right (matching real aircraft nav light convention) was wrong way round (green-left/red-right) in five separate embedded assets across the app, tech spec, and landing page — see `TECH_DEBT.md` 0a for the full list and the workflow lesson behind why one of them briefly regressed mid-session
- [ ] Front-page contact email address
- [x] In-app guide rewrite — done July 2026; full rewrite covering backup/restore, share tokens/QR, email ingestion and the rebrand, plus three Layer 2 sections added on top (Lease/Reserve Setup, Fly Forward, Prospects). See `TECH_DEBT.md` 4.8
- [x] APU given its own tech spec page — done June 2026; rather than fighting page-break overflow, APU now gets `${PAGE_FOOTER}<div class="pb"></div>` immediately before its `<h3>`, same pattern already used between engines/Landing Gear. Frees up room on the Landing Gear/Wheels & Brakes page and gives APU's full LLP stack room to breathe (LLP table itself was never actually limited — only ever appeared short because test/real data had few rows). Shop visit display unchanged (most-recent-only on full airframe spec, per 4.2 — Alan confirmed this should stay as-is, not be expanded to full history)
- [x] Avionics LRU List rebuild — done July 2026; retired the old fixed 8-field Avionics tab entirely in favour of a real spec-sheet-parsed inventory (upload PDF → Sonnet extraction → review/edit screen → save), grouped by ATA chapter with independent per-row/per-chapter visibility toggles. Tech spec output reuses the existing table-based `col2()` two-column pattern, splitting whole-page once visible rows exceed ~25 (tunable), repeating the chapter header on a mid-chapter split. See `TECH_DEBT.md` 4.50 (supersedes 4.14)
- [x] Fixed reserve pot accrual basis bugs — done July 2026; `validatePotWithAI` was wrongly telling Claude every non-engine pot is "usually per flight hour" (false-positive warnings on AF-6Y/AF-12Y/LG-OH/AP-OH, which are correctly `per_month`/`per_APU_hr`), and the accrual-basis dropdown was missing its `per_APU_hr` option entirely. See `TECH_DEBT.md` 4.49

### Layer 1 Features (Active — Part of V1 Scope)
- [x] Shareable read-only asset links (tokenised) — done June 2026
- [x] QR code generation — done June 2026
- [x] WhatsApp share integration — done June 2026
- [ ] Email ingestion — single company first
- [ ] Documents tab (Google Drive links per asset)
- [ ] Incoming tech spec parser — onboarding accelerator (Step 0, parse and discard)

### Layer 2 — Financial Intelligence
- [x] Brain 3 input schema + formula scoped — done July 2026 (Opus scoping session); spec locked in Section 4, prerequisites in `TECH_DEBT.md` 4.19–4.22
- [x] Brain 3: Fly-Forward Engine — built & validated against real asset data via the internal Fly-Forward Demo (`TECH_DEBT.md` 4.23); not yet wired to a real Firestore lease schema
- [x] Brain 4: Risk Peak Calculator — built & validated, same status as Brain 3
- [x] Brain 5: Shortfall Engine — built & validated, same status as Brain 3
- [x] Lease data input UI — Path 2 (manual + AI-validation) built July 2026, see Section 9 / `TECH_DEBT.md` 4.25–4.27; Quick Extract + Confidential Extract (single-asset AI-assisted upload) built July 2026, see Section 8 / `TECH_DEBT.md` 4.35; Bulk Lease Import (Upload tab, multi-file + MSN/registration auto-match, two-button Save Details for Later / Activate Lease split) built July 2026, see Section 8 / `TECH_DEBT.md` 4.36
- [x] Reserve rates Firestore schema — built exactly as designed, see Section 5 / `TECH_DEBT.md` 4.25
- [ ] Seasonality profile configuration
- [x] Scheduled events calendar — schema reshaped as part of Brain 6 scoping (see Section 5); not yet implemented in code
- [x] Mid-lease onboarding wizard — this is the same item as "Lease data input UI" above (see Section 9); listed separately in this checklist previously, now built
- [x] Brain 6 input schema + formula scoped — done July 2026 (Opus scoping session); spec locked in `brain6-build-handoff.md`, prerequisites/gap items in `TECH_DEBT.md` 4.38. Not yet built.
- [x] Brain 6: Maintenance Calendar Engine (`maintenanceCal.js`) — **built July 2026** (Sonnet session); pure function, no Firestore, no UI wiring yet; 15/15 Node E2E tests passing including the Section 10 golden fixture. See `TECH_DEBT.md` 4.39
- [x] Wire Brain 6 into Fly-Forward's two-pass assembly (`index.html`) — **done July 2026** (Sonnet session); `flyForward.js`'s accrual made grounding-aware (backward compatible, 5/5 regression tests), EN-LP's engine-cycle clock refactored to an incremental accumulator, two-pass wiring + `dataCompleteness` banner added to `FlyForward`. 27/27 tests passing across all three suites (two engines' own regressions + a new orchestration-level integration test). See `TECH_DEBT.md` 4.40
- [x] Fleet Exposure View — **built July 2026** (Sonnet session); the per-asset "asset risk dashboard" line item is scoped OUT, not deferred — Opus scoping concluded there's no useful per-asset risk page (everything it would show is a re-presentation of Fly-Forward; the genuinely new information lives only at fleet level, e.g. "do we have events clustering in the same month," which is structurally invisible per-asset). New pure module `calculations/fleetExposure.js`; see `fleet-exposure-build-handoff.md`, `TECH_DEBT.md` 4.45.
- [x] Cloud Run snapshot writer + `fleetSnapshots` write + Brain portability (`vm` shim extended to six calculation files) — **built and tested July 2026** (Sonnet session). Deployed as a standalone Cloud Run function (`fleet-snapshot-writer`, europe-west2), separate from the Vercel repo, triggered monthly by Cloud Scheduler. Verified end-to-end against real production data: correctly excluded 13/17 real assets as `NO_LEASE` (Electra/Arkia lease records not yet loaded), correctly refused to write given the >50% exclusion threshold, and correctly sent a SendGrid alert. Will begin writing real snapshots automatically once lease coverage improves — no further code changes required. See `TECH_DEBT.md` 4.93.
- [ ] Monthly Report (fleet headline delta, what-moved, pot health, upcoming events, utilisation exceptions) — **scoped July 2026**, blocked on team logins existing as an audience. See `TECH_DEBT.md` 4.100, `monthly-report-cost-tracker-handoff.md`.
- [x] SV Cost Tracker (completed-event cost recording, calendar-driven pending-completion nudge) — **built July 31 2026** (Sonnet session); entry form, self-populating pending nudge, always-visible Completed Events history (added same session after the first pass shipped write-only with no way to review a past entry), manual "+ Log Completed Event" path, role-gated. Feeds Monthly Report Section 6 and the Rate Recommendation Engine below. See `TECH_DEBT.md` 4.103.
- [ ] Rate Recommendation Engine (derives recommended reserve rates per pot from completed-event actuals) — **scoped July 2026** as a three-phase future feature (internal → anonymous pool → marketing carrot), blocked on Cost Tracker data volume. See `TECH_DEBT.md` 4.102, `COMMERCIAL_VISION.md`.
- [x] Maintenance Calendar leaseless-safe at the ASSET level — **built July 31 2026** (Sonnet session); closes the gap left when 4.86 fixed this at fleet level only. New `buildAssetMaintenanceCalendar()` mirrors `buildCalendarEntry`'s synthetic-pot approach without touching `buildFlyForwardProjection` (Financials still correctly requires a real lease). See `TECH_DEBT.md` 4.104.
- [~] Portrait/Landscape dual layout mode — **first pass built July 31 2026** (Financials tab only); per-user preference via a shared Context Provider, ~900px width floor. Scenarios tab and `PortfolioView.jsx`/Dashboard still queued per the scoping doc's own recommended order. See `TECH_DEBT.md` 4.105, `landscape-portrait-layout-scoping-handoff.md`.
- [x] Lease rate categories — confirmed against a real lease July 2026; 10 pots + two escalation regimes — see Brain 3 Inputs section above
- [x] **Fly-Forward wired to real `leases`/`reserves` data** — done July 2026; `DEMO_LEASE_TERMS` retired, editable assumptions card removed, gated on `asset.currentLeaseId`, Viewer role access extended — see `TECH_DEBT.md` 4.32, Section 4
- [x] Fly Forward entry point on Fleet Portfolio dashboard cards — done July 2026, see `TECH_DEBT.md` 4.33
- [x] Bulk Lease Import (Upload tab, new `uploadType`, multi-file queue + MSN/registration auto-match, two-button Save/Activate split writing real reserve pot docs) — done July 2026, see `TECH_DEBT.md` 4.36, Section 8
- [x] **← Fleet Exposure View built July 2026** (Sonnet session) — headline + time axis + asset axis, typed exclusions, status tested against high-case cost. Three items now open, none blocking: Fleet Exposure role-gating for Viewer role (currently ungated — genuinely open, not resolved, see `TECH_DEBT.md` 4.45), nav IA / layer-based restructure raised by Alan (Section 19), and the still-unbuilt three Firestore collections (`scheduledEvents`, `seasonalityProfile`, `shopVisitProjections`) plus a maintenance-calendar UI view to consume them, which remains natural next Brain-6-adjacent work.

### Layer 3 — Scenario Intelligence — FULLY SCOPED July 2026, see `layer3-scenarios-build-handoff.md`; nav/role restructure, per-asset Scenarios, Route Matcher, pandemic scenario, and fleet Calendar all now BUILT
- [x] Layer 3 scoping session (Opus) — done July 2026; all open questions resolved, ready for Sonnet build, no re-discovery needed
- [x] Nav + role restructure (four-layer nav, four-role model — Sections 7/7a) — **built July 2026**, see `TECH_DEBT.md` 4.64/4.65
- [x] Brain 7: Scenario Engine — sliders (utilisation rate, lease extension, FH:FC ratio) + one-at-a-time natural-language chat box, side-by-side base case vs. scenario — **built**, lives inside the asset-level Scenarios tab (`Scenarios.jsx`)
- [x] Brain 8: Route Suitability Matcher — FH/month + FC/month + start/end date input, ranks fleet by operational fit + financial impact — **built**, lives in fleet-level Scenarios (`routeMatcher.js`/`RouteMatcherView`); **clash detection added July 2026** — see Section 11, `TECH_DEBT.md` 4.85
- [x] ~~Fleet-wide chat box on Fleet Exposure~~ — **killed July 2026** (Alan), not built; replaced for its one kept use case (pandemic grounding) by a dedicated slider instead — see Section 11, `TECH_DEBT.md` 4.85
- [x] Fleet Calendar tab — **built July 2026**; event clustering across the fleet, reuses the asset-level `MaintenanceCalendarGrid`, no cost figures — see Section 7a, `TECH_DEBT.md` 4.85
- [ ] Brain 9: AI Narrative Generator — explains base-case/scenario delta; scoped exception to deterministic-outputs-only (hypothetical context only). Not yet built — no session has picked this up.
- [x] ~~Portfolio stress testing~~ — killed July 2026; fleet-wide chat box was meant to achieve the same outcome, but the chat box itself was subsequently killed too (see above) — no replacement, this capability is simply not covered
- [ ] Liquidity cluster visualisation — carried forward, not part of this scoping pass

### Infrastructure / Product
- [x] `APP_SURFACE` multi-entry-point split + four-domain Vercel/Cloudflare wiring — done July 2026; `app.tailiq.app`/`specs.tailiq.app`/`airframe.tailiq.app`/`engine.tailiq.app` all live over HTTPS, each its own Vercel project/bundle. TailiQ Specs/free airframe/free engine surfaces are stub-only ("Coming soon") — building their real UI is separate, unstarted work. See `TECH_DEBT.md` 4.58
- [ ] Firebase Auth (email/password + roles)
- [ ] Multi-tenant companyId implementation
- [ ] Next.js migration (if required for multi-user scale)
- [ ] SOC 2 (if required in future)
- [ ] Mobile app — React Native (requires human developer)

### Timeline
| Phase | Target | Goal |
|-------|--------|------|
| Now — Jul/Aug 2026 | V1 IT/Security Gate | Landing Gear redesign (Section 3b), Engine At-Shop tracking (Section 3c), user invite flow, custom domain, branding sweep, and the Email Review Queue (Section 12a) all done — checklist is a clean 7 of 7, ready for IT review |
| Aug/Sept 2026 | Internal IT review | Sign-off on V1 before Layer 2 begins |
| Oct — Dec 2026 | Layer 2 build | Financial intelligence live internally |


---

## 18. Deliberate Design Decisions

**These are product decisions — not debt. Do not reverse without explicit sign-off.**

| Decision | Rationale |
|----------|-----------|
| Parse and discard for lease PDFs | Lease rates are commercially sensitive — never persist documents |
| companyId on every Firestore document | Future-proofing for multi-tenant SaaS — do not remove |
| Firebase europe-west2 | GDPR compliance — do not migrate to US regions |
| Firebase over Supabase | Supabase had persistent DNS issues — Firebase is permanent |
| Brain/Body separation | Logic must be testable independently of UI — always maintain |
| TailiQ standard tech spec | Product decision — not per-client customisable |
| Sub-50 asset focus | Stay focused — do not scope enterprise features |
| Option A + C email ingestion | Maximum flexibility — airlines change nothing, lessors choose their approach |
| Shortfall tested against `high`, not `likely` | Fleet Exposure's status rule — hope for the best, assume the worst. The headline £ figure quoted is always the high-case gap. (Fleet Exposure View build, July 2026 — `fleet-exposure-build-handoff.md` §2.) |
| AI narrative summaries permitted in Layer 3 only | Scoped exception to deterministic-outputs-only. Layer 3 is explicitly hypothetical "what if" exploration, not a statement of fact — the underlying numbers are still produced deterministically by Brains 3/4/5/6; the AI narrative explains the delta with visible caveats, never presented as a calculated figure. The kill on AI-generated narrative in Layer 1/2 financial outputs stands unchanged. (Layer 3 scoping session, July 2026 — `layer3-scenarios-build-handoff.md` §1.) |
| One scenario at a time — no stacking | Stacking natural-language scenario modifications compounds translation error (the AI misinterpreting a hypothetical), producing results that look plausible but are wrong in a way that's hard to spot. A single scenario keeps any misinterpretation easy to see. (Layer 3 scoping session, July 2026 — `layer3-scenarios-build-handoff.md` §2.) |
| Escalation rate is never a scenario slider | Escalation rates are reviewed yearly against the real catalogue — a periodic factual update, not a hypothetical. (Layer 3 scoping session, July 2026.) |
| Scenarios are fully non-destructive | Nothing in Layer 3 (sliders, chat box, route matcher) ever writes to Firestore. This is what makes it safe to give the Viewer role (C-suite) full Scenarios access without any edit risk. (Layer 3 scoping session, July 2026 — `layer3-scenarios-build-handoff.md` §2, §8.) |
| Knowledge Base defaults pre-fill new pots only — never retroactive | A saved pot's confirmed values were entered deliberately at setup and are never silently changed by a later edit to the company-wide Knowledge Base default. Avoids a Knowledge Base edit quietly moving real historical projections. (Knowledge Base build, July 2026 — `knowledge-base-scoping-handoff.md` §2, `TECH_DEBT.md` 4.82.) |
| LLP Catalogue is scoped to the fleet's own part numbers only, never the full manufacturer catalogue | ~50-60 parts per engine family the fleet actually has, not the ~10,000-part full manufacturer catalogue. Keeps extraction, review, and storage simple, and is why a full manufacturer catalogue PDF upload works as a targeted lookup against known part numbers rather than a full-document extraction. (Knowledge Base build, July 2026 — `knowledge-base-scoping-handoff.md` §1, `TECH_DEBT.md` 4.84.) |
| EOL Position escalation may need to apply per-year-of-remaining-life rates rather than a single lease-end rate | Raised July 2026, not yet confirmed against the shipped formula — flagged for a trace-and-confirm pass before deciding whether this is a real gap or already handled. (Post-lunch scoping session, July 2026 — `TECH_DEBT.md` 4.88.) |
| Post-lease financial forecast may be skewed by accrual stopping at lease end | Reserve pot accrual stops at lease end, but Fleet Exposure's post-lease events carry a real shortfall figure calculated against a balance that stopped growing — tends to overstate post-lease shortfalls. Needs an Opus scoping session on what post-lease accrual should assume before the number is leaned on beyond visual disclosure (post-lease atoms are already labelled/textured differently in the UI). (Post-lunch scoping session, July 2026 — `TECH_DEBT.md` 4.89.) |
| Actual completed-event costs never auto-update Knowledge Base cost bands | KB stays human-curated. If actuals consistently diverge from KB assumptions, the system surfaces the pattern (via the future Rate Recommendation Engine) — the human decides whether to adjust the number, never the system silently. (Cost tracking scoping session, July 2026 — `monthly-report-cost-tracker-handoff.md` §2.) |
| Monthly Report excludes AI-generated narrative, EOL/data-quality/lease-maturity flags, and product analytics | Staleness/hallucination risk undermines a report where every other number is deterministic and traceable; EOL/maturity/completeness flags become permanent noise on a mature fleet rather than news; product analytics is a different audience. Kept in-app or as a separate admin view instead. (Cost tracking scoping session, July 2026 — `monthly-report-cost-tracker-handoff.md` §1.) |

---

## 19. Outstanding Items

| Item | Owner | Priority |
|------|-------|----------|
| End of Lease Position wired into Fly-Forward + TAC upload pipeline | Build session | ✅ Done July 2026 — see `TECH_DEBT.md` 4.88, 4.89, 4.90, Section 16 |
| 4th demo asset — dedicated EOL adjustment showcase, real catalogue part numbers from `Engine_LLP_Escalation_Model.xlsx`, new MSN, clean computable net-payable figure | Alan + build session | ✅ Done July 2026 — MSN 5533 built, uploaded, live-tested ($505,132 combined). See `TECH_DEBT.md` 4.91, Section 16 |

| Lease Wizard tier-choice order — reorder to Manual → Confidential → Quick (cheapest/most-private first) | Build session | 🟢 Flagged July 2026, not started — see `TECH_DEBT.md` 4.81 |
| Lease uploader (Quick/Confidential Extract screens) missing a visible upload/submit action | Build session | 🟢 Flagged July 2026 with screenshot — see `TECH_DEBT.md` 4.81 |
| EN-PR/EN-LP deterministic catalogue-rate check firing on EN-PR pots regardless of rate entered (unit mismatch) | Build session | ✅ Fixed July 31 2026 — root cause was the AI-context builder, not the deterministic check's gating — see `TECH_DEBT.md` 4.75 |
| 2 Year Check ordering in Check History (should sort by interval, not insertion order) | Build session | ✅ Fixed July 31 2026 — confirmed pure insertion order, fixed in both the Overview tab and Specs tab's own Check History editor — see `TECH_DEBT.md` 4.80 |
| Date-of-Manufacture field — auto-insert "/" while typing, confirmed on both Specs tab and Asset Details screen | Build session | ✅ Fixed July 31 2026 — record corrected, only one real instance existed (Overview tab) — see `TECH_DEBT.md` 4.79 |
| Portrait/landscape dual layout mode (manual toggle, 2/3-up card grids replacing full-width stacking) | Build session | ✅ Done August 2026 — Financials tab (July 31), Scenarios tab + `PortfolioView.jsx` (August 2026) — see `TECH_DEBT.md` 4.105 |
| Thousand-separator on hour readouts (TSN app-wide + tech specs) | Build session | ✅ Done July 2026 — see `TECH_DEBT.md` 4.66 |
| Engine stock photos — dynamic 8-family lookup (was hardcoded CFM/V2500 binary) | Build session | ✅ Done July 2026 — see `TECH_DEBT.md` 4.67 |
| Airframe stock photos (new feature — coarse model-match, 7 buckets) | Build session | ✅ Done July 2026 — see `TECH_DEBT.md` 4.68 |
| Operator History (new engine-record data type, extraction, tech spec section) | Build session | ✅ Done July 2026 — see `TECH_DEBT.md` 4.69, `operator-history-scoping-handoff.md` |
| Operator History — full-aircraft tech spec section | Build session | ✅ Done August 2026 — renders in both standalone engine spec and full-aircraft spec, see `TECH_DEBT.md` 4.69 |
| Guide restructure — role-gated sections (Admin/Editor only: Users & Access, Data Storage, Quick Reference) + nav language update (Fly Forward → Financials etc.) | Build session | ✅ Done August 2026 — see `TECH_DEBT.md` 4.107 |
| Backup failure alerting — Cloud Monitoring alert on nightly `firestore-backup` function | Build session | ✅ Done August 2026 — see `TECH_DEBT.md` 4.108 |
| Lease Wizard UX fixes — tier reorder (Manual → Confidential → Quick) + dashed dropzone + explicit Extract button + aiFile reset | Build session | ✅ Done August 2026 — see `TECH_DEBT.md` 4.109 |
| `public/share.html` — no engine/airframe stock photo fallback on public share links | Build session | 🟢 Known gap, pre-existing — see `TECH_DEBT.md` 4.68 |
| Engine + airframe cover art — background re-corrected to actual hero CSS (`#111827`, not `#102A43`) + edge-artifact cleanup | Build session | ✅ Done July 2026 — see `TECH_DEBT.md` 4.70 |
| Route Matcher fleet-wide clash detection (does moving one asset's event clash with another asset's?) | Build session | ✅ Done July 2026 — see `TECH_DEBT.md` 4.85, Section 11 |
| Fleet Snapshot Writer — Cloud Run function + Cloud Scheduler | Build session | ✅ Done July 2026 — see `TECH_DEBT.md` 4.93 |
| `firestore-backup`'s Cloud Scheduler job has no auth header on its Cloud Run invocation | Build session | 🟡 MEDIUM, found not fixed — see `TECH_DEBT.md` 4.94 |
| EAG two-engine LLP sheet upload failure (model narrating rows in prose before JSON, non-deterministic token consumption) | Build session | ✅ Fixed July 2026 — see `TECH_DEBT.md` 4.95 |
| Backup/restore full test — retested end-to-end against fuller current collection set | Build session | ✅ Done July 2026 — see `TECH_DEBT.md` 4.96 |
| Mobile/tech-spec UI bug batch (LLPExtractor dropzone, Prospects Avionics/Wheels & Brakes sections, mobile stacking fixes, blank-page footer fix, prospect creator upload button styling) | Build session | ✅ Done July 2026 — see `TECH_DEBT.md` 4.97 |
| Seasonality editor not working — design-vs-code gap (Brain 3's `basisQuantity` monthly weighting documented in `brain6-build-handoff.md` §3.4 but not actually implemented) | Alan + build session | 🟢 Scoped July 2026, not yet built — see `TECH_DEBT.md` 4.98 |
| Stock photos not loading for some current assets | Alan | ⚪ Deprioritised — not being pursued, see `TECH_DEBT.md` 4.99 |
| Monthly Report — scoped, blocked on team logins | Alan + build session | 🟢 Scoped July 2026 — see `TECH_DEBT.md` 4.100 |
| SV Cost Tracker — schema + calendar nudge locked, standalone build | Build session | ✅ Built July 31 2026 — entry form, pending nudge, always-visible history, manual log-event path — see `TECH_DEBT.md` 4.103 |
| Rate Recommendation Engine — three-phase design locked; database built | Alan | 🟢 Database built August 2026; blocked on Cost Tracker data volume before recommendations phase — see `TECH_DEBT.md` 4.102 |
| Pandemic-scenario preset on fleet Scenarios (built as a slider, not the originally-sketched chat-box button — chat box itself was killed) | Build session | ✅ Done July 2026 — see `TECH_DEBT.md` 4.85, Section 11 |
| Fleet Calendar tab — event clustering across the fleet | Build session | ✅ Done July 2026 — see `TECH_DEBT.md` 4.85, Section 7a |
| Route Matcher / pandemic scenario / fleet Calendar — real end-to-end validation against live Firestore data (only syntax/build/unit-test validated so far) | Alan | 🟡 Open — flagged for live-testing once deployed, see `TECH_DEBT.md` 4.85 |
| Fleet Calendar — leaseless assets weren't showing real landing-gear/LLP dates, only C-Check dates | Build session | ✅ Done July 2026 (fleet level, `TECH_DEBT.md` 4.86) — ✅ Extended to the asset level July 31 2026, see `TECH_DEBT.md` 4.104 |
| IT Security Review v4 | Build session | ✅ Done August 2026 — completedEvents rule confirmed closed, product family section added, IT review meeting scheduled (Nikifor Hristov, Vectorgroup IT) — see `TECH_DEBT.md` 4.87, `TailiQ_Security_Review_v4.docx` |
| Portrait/mobile nav — asset-level nav pill vanishing + Share/Tech Spec overflow on narrow viewports | Build session | ✅ Fixed August 2026 — `isMobile` branch short-circuited before `view==="asset"` check; split into `isMobile+asset` / `isMobile+fleet` sub-cases; Share/Tech Spec moved to own full-width row — see `TECH_DEBT.md` 4.117 |
| Nav pills — iQ hamburger item (admin-only, all views), Upload restored to asset trailing pill, Share/Tech Spec relocated to Details layer only | Build session | ✅ Done August 2026 — see `TECH_DEBT.md` 4.118 |
| iQ tab shell + SV Interval Analytics — first feature in the new intelligence/analytics tab (distinct from Financials/Calendar); TSI computation, PR/Hardware summary stats (n≥3), sortable/filterable raw table, engine + APU | Build session | ✅ Built August 2026 — see `TECH_DEBT.md` 4.119, `sv-analytics-iq-tab-build-spec.md` |
| Shop Visit `reasonCategory` taxonomy — extraction prompt suggestion, review-screen dropdowns, manual-entry dropdowns, engine + APU (Operator History explicitly excluded per Alan) | Build session | ✅ Done August 2026 — see `TECH_DEBT.md` 4.120 |
| UI Design System rollout (`TAILIQ_UI_DESIGN_SYSTEM.md`, locked 10 Aug 2026) — sweeping every component off the old dark-navy theme onto the new light "technical grey" theme | Build session | ✅ App-wide sweep complete August 2026 — `styles.css`/`Dashboard.jsx`, `Scenarios.jsx`/`FlyForward.jsx`/`LeaseWizard.jsx`, and the full Asset Details screen (`AssetTabs.jsx`, `PhotosAndSpecs.jsx` — every tab: Overview/Specs/Engines/Landing Gear/APU/Avionics/Photos/History/Documents) all done. Only remaining unswept surface is the tech spec PDF (see next row) — see `TECH_DEBT.md` 4.122–4.123 |
| Tech spec PDF / app design system merge — align `techSpecBuilder.js` body pages onto `TAILIQ_UI_DESIGN_SYSTEM.md`, keeping the navy hero as a distinct cover/identity page | Alan + Opus scoping session | 🟢 Scoped prompt prepared August 2026, session not yet run — `tech-spec-design-merge-scoping-prompt.md`; see `TECH_DEBT.md` 4.124 |
| Forward Exposure Summary card — lazy/on-demand implementation | Alan | ⚪ Deprioritised August 2026 — Alan: "we are ignoring the fleet exposure for now, we have an alternative in the asset financials." Dead code (`computeForwardExposure()`/`ForwardExposureCard`) stays in `FlyForward.jsx`, not removed, in case revisited later — not currently planned |
| TAC upload requires an active lease already on file — sequencing gap | Alan + build session | 🟡 Design discussion needed — see `TECH_DEBT.md` 4.92 |
| EOL Position — "Generate Report" PDF export | Build session | 🔵 Next up — Alan flagged August 2026; in-app view live, only export remains |
| APU TAC support — `componentsCovered` currently engine LLPs only | Build session | 🟢 To do — scoped gap |
| TailiQ Specs (`specs.tailiq.app`) — personal tier, €49/month | Build session | 🟢 Later — Alan confirmed August 2026; fully scoped in `tailiq-engines-scoping-handoff.md`, ready for Sonnet build session whenever picked up |
| Push notifications — red-pot transition trigger, 72-hour grace period, SendGrid | Build session | 🔵 Next up — Alan flagged August 2026; see `push-notifications-scoping-handoff.md`; not yet built |
| Monthly delta report | Alan + build session | 🟢 Deferred — blocked on team logins as audience; no snapshot baseline yet |
| Landing page rewrite (`tailiq_landing.html`) — three-way CTA, tier cards, privacy note, hosted wordmark | Build session | 🟢 Later — Alan confirmed August 2026; plan agreed, base64 wordmark swap and privacy note still outstanding. Favicon wiring is NOT part of this — confirmed already working, not an open item (corrects a wrong assumption raised in conversation this session) |
| SV Cost Tracker — first build had no way to review a past entry, only the pending nudge | Alan | ✅ Fixed same session, July 31 2026 — added always-visible Completed Events history + manual log-event path — see `TECH_DEBT.md` 4.103 |
| Settings page — "Admin Panel" renamed, gating moved from whole-panel-admin-only to per-tab (Guide/Settings all roles, Knowledge Base Editor+, Admin Panel admin-only) | Alan + build session | ✅ Done July 31 2026 — see `TECH_DEBT.md` 4.106 |
| Portrait/landscape toggle placement — iterated through tab-local icon → nav-pill icon (both wrong per Alan) → labeled control in Settings; a `.js`/`.jsx` build error surfaced and corrected mid-session | Alan + build session | ✅ Resolved July 31 2026 — see `TECH_DEBT.md` 4.105/4.106 |
| Standalone Settings page as its own top-level surface (rather than folding into the renamed former Admin Panel) | Alan | 🟢 Possible future direction, raised not scoped — see `TECH_DEBT.md` 4.106 |
| Vercel `app` project — stale GitHub webhook, needs Disconnect/Reconnect to prevent recurrence | Alan | 🟡 Open, RECURRED August 2026 — auto-deploy silently didn't fire for one commit again (`TECH_DEBT.md` 4.121); worked around a second time via trivial-commit trigger rather than Redeploy (which rebuilds the same commit, not branch HEAD — wrong turn taken first, corrected); root cause (possible GitHub App repository-access drop) still not checked |
| Backup/restore retest (post-IT-review surface area) | Alan/build session | 🟡 Soon — before/around IT review, see `TECH_DEBT.md` 0.7 |
| Audit trail scoping (write attribution / data history / access logs) | Alan + IT input | 🟡 Scoping discussion, bundle with role-based access — see `TECH_DEBT.md` 0.8 |
| `tailiq.app` landing page | Build session | ✅ Done — live with email capture, see `TECH_DEBT.md` 0.9 |
| Landing Gear tracking redesign (overhaul-based calc + report-override + dual calendar/cycle limiter) | Build session | ✅ Done — confirmed June 2026, this doc previously had it stale as pending |
| Surface email-ingested warnings in-app (Email Review Queue) | Build session | ✅ Done June 2026 — see Section 12a / `TECH_DEBT.md` 0.5 |
| Engine At-Shop / Title Engine tracking | Build session | ✅ Done June 2026 — see Section 3c |
| APU/engine tech spec shop visit display — most-recent-only on full airframe spec | Build session | ✅ Done June 2026 — see `TECH_DEBT.md` 4.2 |
| APU given its own tech spec page | Build session | ✅ Done June 2026 — see `TECH_DEBT.md` 0a / Section 17 |
| Tech spec cover QR code (built + disabled) + footer redesign | Build session | ✅ Built June 2026; QR pill disabled for internal use, code retained — see `TECH_DEBT.md` 0a |
| Nav-light dot order corrected across all brand assets | Build session | ✅ Done June 2026 — see `TECH_DEBT.md` 0a |
| Build + secure email ingestion webhook | Build session | ✅ Done June 2026 — tested with real emails, see Section 12 |
| Confirm lease rate categories from actual leases | Alan | 🟡 Before Brain 3 build (post-IT sign-off) |
| Firestore backup (nightly export + tested restore) | Build session | ✅ Done June 2026 |
| Git tagging convention | Alan/build session | ✅ Done June 2026 |
| Hosting consolidated to Vercel (GitHub Pages retired) | Alan | ✅ Done June 2026 |
| Build + secure share-token system + QR codes | Build session | ✅ Done June 2026 |
| Extract Brain 1 (`utilisation.js`) to `/calculations` | Build session | ✅ Done |
| Decommission Supabase projects | Alan | ✅ Done June 2026 |
| Tech spec photo placement bug (LOPA/airframe field mapping) | Build session | ✅ Done June 2026 |
| TailiQ vs VectorIQ naming decision | Alan | ✅ Done June 2026 — explicit sign-off given, full docs-only naming pass complete — see `TECH_DEBT.md` 0.6 |
| Self-service user invite flow (Admin SDK + password reset email) | Build session | ✅ Done June 2026 — see `TECH_DEBT.md` 4.9 |
| Custom domain `app.tailiq.app` live + dual-origin CORS | Build session | ✅ Done June 2026 |
| Codebase branding sweep (VectorIQ/Vector Fleet Manager/Vector Group → TailiQ) | Build session | ✅ Done June 2026 |
| Mobile contained-scroll fixes (tab bar, history table) | Build session | ✅ Done June 2026 |
| Tech spec disclaimer system (per-asset + fleet-wide + public share link) | Build session | ✅ Done June 2026 |
| Front-page contact email address | Build session | 🟢 Deferred to external launch |
| In-app guide rewrite | Build session | ✅ Done July 2026 |
| LLP upload inside asset (Engine LLP + APU LLP tabs, no matcher needed) | Build session | 🟢 Queued — discussed July 2026, not yet built |
| APU LLP — European number notation fix | Build session | ✅ Done July 2026 — prompt updated |
| Tech spec full visual rebuild (cover + all content pages) | Build session | ✅ Done July 2026 |
| Operator label toggle (Current/Previous Operator) in app + spec | Build session | ✅ Done July 2026 |
| APU P/N parse from APU LLP sheet | Build session | ✅ Done — see `TECH_DEBT.md` 4.10 |
| LDG last overhaul date deletion leaves next due date stale | Build session | ✅ Done — see `TECH_DEBT.md` 4.11 |
| Viewer → Editor promotion in-app (no Admin involvement) | Build session | ✅ Done — see `TECH_DEBT.md` 4.12 |
| Specs tab moved to 2nd position in tab bar | Build session | ✅ Done — see `TECH_DEBT.md` 4.13 |
| Avionics listing — new tab in app + section in tech spec | Build session | ✅ Done July 2026 — rebuilt entirely as a real spec-sheet-parsed LRU inventory (Description + P/N, grouped by ATA chapter); superseded the original fixed 8-field tab. See `TECH_DEBT.md` 4.50 (supersedes 4.14) |
| Ad hoc tech spec (Prospect Asset Flow) — 50/50 editor + live PDF preview | Build session | ✅ Done July 2026 — see `TECH_DEBT.md` 4.15 |
| Standalone engine spec — use asset-specific photo instead of generic stock photo | Build session | ✅ Done — see `TECH_DEBT.md` 4.16 |
| Orphaned `specs.seating` tech spec field (never written to, likely blank on live fleet too) | Build session | ✅ Done — deleted, `seatConfig` is sole source, see `TECH_DEBT.md` 4.17 |
| Fleet Overview header banner — navy → white | Build session | ✅ Done — white banner live on Fleet Portfolio view |
| Prospect editor section/tab naming | Alan + build session | ✅ Done — confirmed actioned by Alan, see `TECH_DEBT.md` 4.18 |
| Lease Data Input UI — Path 2 (Add Lease flow + pot checklist) | Build session | ✅ Done July 2026 — see `TECH_DEBT.md` 4.25–4.27, Section 9 |
| Reserve pot AI validation — fail-open bug + wrong response envelope | Build session | ✅ Done July 2026 — see `TECH_DEBT.md` 4.26 |
| Deterministic EN-LP catalogue-rate check | Build session | ✅ Done July 2026 — see `TECH_DEBT.md` 4.27 |
| Firestore security rules — role-gated writes on leases/reserves/assets, immutable auditLog | Build session | ✅ Done July 2026 — tested and deployed by Alan; `companyId` scoping still open (4.29) — see `TECH_DEBT.md` 4.28, Section 7 |
| companyId never populated on any asset (Sections 7/14 corrected) | Build session | 🟢 Roadmap-accuracy fix, not urgent — see `TECH_DEBT.md` 4.29, Section 14 |
| Fly-Forward Viewer role access | Build session | ✅ Done July 2026 — Fly-Forward wired to real data, Viewer role now has access — see `TECH_DEBT.md` 4.30/4.32 |
| Pot row warning checkbox/message alignment | Build session | ✅ Done July 2026 — see `TECH_DEBT.md` 4.31 |
| Fly-Forward wired to real leases/reserves data (Brains 3/4/5 off DEMO_LEASE_TERMS) | Build session | ✅ Done July 2026 — see `TECH_DEBT.md` 4.32, Section 4/17 |
| Fly Forward button missing from Fleet Portfolio cards | Build session | ✅ Done July 2026 — see `TECH_DEBT.md` 4.33, Section 17 |
| EN-PR derate/ratio dual-mechanism | — | ✅ Confirmed working in production (August 2026, per Alan) — current implementation handles existing lease data correctly. Dedicated Opus session available if a future lease edge case surfaces, see `TECH_DEBT.md` 4.24 |
| ZDR (Zero Data Retention) investigation for Anthropic API usage | Alan | ✅ Resolved July 2026 — confirmed unavailable at current scale (sales-negotiated enterprise arrangement), dropped from scope entirely, see Section 8 |
| Lease Data Input UI — Quick Extract + Confidential Extract (single-asset AI-assisted upload) | Build session | ✅ Done July 2026 — see `TECH_DEBT.md` 4.35, Section 8 |
| Bulk Lease Import (Upload tab, multi-file queue + MSN/registration auto-match) | Build session | ✅ Done July 2026 — see `TECH_DEBT.md` 4.36, Section 8 |
| Two-button lease save split (Save Details for Later vs. Activate Lease — writes real reserve pots immediately) | Build session | ✅ Done July 2026 — see `TECH_DEBT.md` 4.36, Section 8 |
| Tier-choice screen "ⓘ" info-toggle — poor affordance, hard to tell it's clickable | Build session | ✅ Done July 2026 — replaced with "Details ▾" text link + rotating chevron, see `TECH_DEBT.md` 4.37 |
| Fly Forward button shown even with no lease data | Build session | ✅ Done July 2026 — gated on `asset.currentLeaseId` in both `AssetView` and `PortfolioView`, see `TECH_DEBT.md` 4.37 |
| No way to tell which asset has a lease on file from Dashboard/Portfolio views | Alan | ✅ Done July 2026 — 📄 indicator added to Dashboard list, Dashboard card view, and `PortfolioView` cards, see `TECH_DEBT.md` 4.37 |
| Dashboard list view — pointless "View" button (rows already clickable) | Alan | ✅ Done July 2026 — removed, see `TECH_DEBT.md` 4.37 |
| Dashboard NLG/LLG/RLG date columns not centered | Alan | ✅ Done July 2026 — see `TECH_DEBT.md` 4.37 |
| Redelivery conditions — data capture + Brain 3 gap-output integration | Build session | 🟢 Layer 3, schema stub only in v1 — see Section 4/5 |
| Fleet Exposure View (headline + time axis + asset axis, typed exclusions) | Build session | ✅ Done July 2026 — per-asset "asset risk dashboard" scoped OUT permanently — see `TECH_DEBT.md` 4.45 |
| Fleet Exposure role-gating for Viewer role | Alan | ✅ Closed July 2026 — four-role model (Section 7, `TECH_DEBT.md` 4.54/4.64) gates Financials/Scenarios to Viewer+ roles; Data Entry never sees it. Built and confirmed live by direct read of `App.jsx`'s `canSeeAdvanced` gate — no longer an open item. |
| `PortfolioView`'s role reconsidered — purely the client-facing/screen-share-safe view vs. a default landing screen for anyone in particular; Viewer-role auto-landing on Portfolio may conflate "shouldn't see financials" with "about to screen-share with a client" | Alan | 🟢 Raised, not scoped — needs a clearer picture of who actually uses Viewer role day-to-day first |
| Fleet Exposure — orchestration duplication with `buildFlyForwardProjection` (by design, Option B — pending future consolidation) | Build session | 🟢 Known, tracked — see `TECH_DEBT.md` 4.46 |
| Nav IA / layer-based restructure | Alan | ✅ Closed July 2026 — four-layer nav model (Section 7a, `TECH_DEBT.md` 4.53/4.65) built and confirmed live. |
| Layer 3 / Scenarios — unscoped | — | ✅ Resolved July 2026 — fully scoped, see `layer3-scenarios-build-handoff.md`, ready for Sonnet build session |
| LC-expiry-before-event data gap (reads as funded but isn't, on LC-secured leases) | — | 🟢 Parked, not built — see `TECH_DEBT.md` 4.47 |
| Check History — facility field | Build session | 🟢 Queued July 2026 — see `TECH_DEBT.md` 4.51, Section 13 |
| Annual utilisation / FH:CY ratio (airframe level, derived) | Build session | 🟢 Queued July 2026 — see `TECH_DEBT.md` 4.51, Section 13 |
| Avionics Manufacturer field (independently optional, AI best-effort) | Build session | 🟢 Queued July 2026 — partial reversal of 4.50's original drop — see `TECH_DEBT.md` 4.51, Section 13 |
| Registration history table | — | ⛔ Dropped July 2026 — not worth the effort, see `TECH_DEBT.md` 4.51 |
| Airframe-level certification basis (type certificate numbers) | Alan | 🟢 Parked July 2026 — pending Alan confirming whether the TCDS reference is worth tracking, see `TECH_DEBT.md` 4.51 |
| Airfleets.net scrape for registration/operational history | — | ⛔ Rejected July 2026 — fragile scrape, unverifiable data, undercuts auditable/defensible positioning, see `TECH_DEBT.md` 4.51 |
| Kahala-style dual-engine summary card | — | ⛔ Rejected July 2026 — duplicates existing per-engine full-page treatment, see `TECH_DEBT.md` 4.51 |
| `APP_SURFACE` multi-entry-point split (per-surface bundles for app/specs/airframe/engine) | Build session | ✅ Done July 2026 — see `TECH_DEBT.md` 4.58 |
| Four-domain setup (`app`/`specs`/`airframe`/`engine`.tailiq.app) — Vercel projects + Cloudflare DNS | Alan + build session | ✅ Done July 2026 — all four confirmed live over HTTPS, see `TECH_DEBT.md` 4.58 |
| `api/` folder shipped as serverless functions on all four Vercel projects, including the three surfaces that don't need most of it | — | 🟢 Flagged, not solved — worth pruning once TailiQ Specs/free tools are built out for real, see `TECH_DEBT.md` 4.58 |
| Knowledge Base (Forecasting Defaults + LLP Catalogue, three-tier hierarchy) | Build session | ✅ Done July 2026 — see Section 15, `TECH_DEBT.md` 4.82 |
| LLP Catalogue Excel upload — multi-sheet + stale-price-column bugs | Build session | ✅ Fixed July 2026, confirmed against real fleet data — see `TECH_DEBT.md` 4.83 |
| LLP Catalogue PDF upload — whole-document extraction broke on a real 100+ page manufacturer catalogue | Build session | ✅ Redesigned to targeted lookup, confirmed working July 2026 — see `TECH_DEBT.md` 4.84 |
| Check duration Knowledge Base defaults (2Y/6Y/12Y) not yet wired into `maintenanceCal.js` | — | ✅ Resolved July 2026 — `durationDefaults` param already existed in Brain 6, just needed populating; no Brain 6 code changes needed. See Section 15, `TECH_DEBT.md` 4.82 |

---

*This document is the single source of truth for TailiQ product decisions, architecture, and roadmap. Update it when significant decisions are made. Reference it at the start of every build session to maintain continuity.*

*Last updated: July 2026 — This session (Knowledge Base built + real-world testing/bugfix pass, Sonnet build): Built the Knowledge Base end to end per `knowledge-base-scoping-handoff.md` — new Section 15, Firestore layer (`knowledgeBase/{companyId}` doc + `llpCatalogue` subcollection), `firestore.rules`, the three-tier hierarchy helper (`src/lib/knowledgeBase.js`), and Admin UI (Forecasting Defaults form, LLP Catalogue with manual entry + Excel/PDF upload) — full detail `TECH_DEBT.md` 4.82. Wired into `pots.js`/`LeaseWizard.jsx` (cost bands, EN-PR bands, escalation now resolve through the KB tier instead of bare hardcoded literals); Brain 6 (`maintenanceCal.js`) needed **zero code changes**, since it already accepted a `durationDefaults` parameter with nothing populating it before this session — same story for two dormant window globals in `flyForward.js`/`pots.js` (`window.LLP_CATALOGUE_PRICES`, `window.lookupLLPCataloguePrice`). New read-only Assumptions panel on Fly-Forward, visible to every role including Viewer. **Alan's first live test against real fleet data surfaced three genuine bugs, all found and fixed in the same session** (`TECH_DEBT.md` 4.83/4.84): (1) the Excel catalogue upload only read the workbook's first sheet regardless of family tab selected, and separately took the *oldest* price column when a real multi-year escalation-model spreadsheet had one per year — both fixed against Alan's actual `Engine_LLP_Escalation_Model.xlsx`, going from 18 matched parts (stale 2023 pricing) to 43 (correct 2026 pricing); (2) two React state-timing bugs in the upload's match-counting and fleet-rescan logic — one mutating counters inside a `setRows` updater and reading them back before React had run it, the other an unstable `assets` prop reference silently wiping out just-matched prices moments after they appeared ("flashes up then disappears") — both root-caused via direct evidence rather than guessed at; (3) the PDF catalogue upload was built against a whole-document extraction pattern that broke against Alan's real ~100+ page full CFM manufacturer catalogue with a 504 timeout — redesigned from "extract everything" to "look up the fleet's known ~50-60 part numbers" (client-side text extraction + string search + only matched snippets sent to `/api/extract`), making cost and latency scale with the fleet's own part count rather than the source catalogue's length. All three confirmed fixed and working end-to-end against Alan's real files. Sections 14/15 (new)/18/19 and this top status line updated in this sync.*

*Last updated: July 2026 — This session (Four-role model + four-layer nav restructure BUILT, plus a same-day design/polish pass, Sonnet build): Turned two Opus-scoped-only items into real, working code. **Four-role model** (closes Section 7's "not yet built" status, `TECH_DEBT.md` 4.64): `dataEntry` added as a fourth Firebase custom-claim role across `api/set-role.js`/`api/invite-user.js`/`AdminView.jsx`; Firestore rules updated to let `dataEntry` write `leases`/`reserves`/`assets` (not `scheduledEvents`/`seasonalityProfile`, which stay admin/editor since Data Entry never sees the Calendar tab); a real UX gap found and fixed along the way — role changes had no visible effect until the affected user happened to sign out on their own, fixed via server-side `revokeRefreshTokens` plus a client-side 45-second force-refresh-and-compare check that signs the user out on mismatch. **Four-layer nav restructure** (closes Section 7a's "not yet built" status, `TECH_DEBT.md` 4.65): fleet-level nav rebuilt as Details·Calendar·Financials·Scenarios + Prospects·Upload + Admin, role-gated per the Section 7 table; asset-level `AssetView` restructured the same way, folding the old standalone Fly-Forward/Maintenance Calendar pages into Financials/Calendar tabs (their own "← back" headers removed, tab bar handles navigation) with a new `initialLayer` prop so jumping in from Portfolio/Fleet Exposure opens straight onto Financials. Calendar (fleet) and Scenarios (both levels) render "Coming soon" placeholders, per Alan's explicit choice — not yet built, only the nav shell is. **Real repo mishap caught and fixed, not just a note:** the first attempt at delivering these files landed three of them (`AssetView.jsx`/`FlyForward.jsx`/`AdminView.jsx`) as stray duplicates directly under `src/` instead of overwriting the real ones in `src/components/`, since GitHub's file-upload UI was used without navigating into that folder first — confirmed by cloning the actual repo rather than trusting the description of what should be there, deleted, and re-pasted correctly. **Same-day design/polish pass** after Alan tested the rebuilt nav (`TECH_DEBT.md` 4.59–4.60): Lease Wizard relocated from the asset header into the Financials tab itself (Set Up Lease / Edit Lease); asset-level layer pill moved into the header row between the title and Share/Generate Tech Spec, restyled as a filled pill and extracted into a shared `NavPill` component so the fleet-level and asset-level pills are guaranteed identical rather than just similar; fleet-level nav further split from one pill with internal dividers into two separate pills once that read as visually confusing; the "Extract with AI"/"TailiQ AI" wording fix that had been agreed several sessions ago in conversation only (never actually shipped) was finally built across the Upload tab, Specs Quick Import, Avionics uploader, and the in-app Guide; Specs/Avionics uploaders switched to the Upload tab's dashed-dropzone file-select UI for visual consistency, catching and fixing a real bug in the process (`SpecsQuickImport` rendered an empty visible card even when collapsed); Maintenance Calendar redesigned with a year-by-year 12-month event grid (colour-coded dot per event per month, hover for detail) sitting above a recompacted event list (small summary rows with an Edit-to-expand toggle, replacing always-open detail cards); Seasonality Profile editing moved from Financials to Calendar, since the accept/suggest workflow for a seasonality-adjusted date lives entirely on that tab. **Operational note, not a code defect:** individually uploading ~10+ files via GitHub's web UI each auto-triggered its own Vercel deployment, hitting the Hobby plan's 100-deployments-per-rolling-24-hours cap mid-session (`TECH_DEBT.md` 4.63) — confirmed this does not take the live site down (last successful deploy keeps serving), and separately explains one genuine build failure that session where `App.jsx` (importing the new `NavPill` export) landed on GitHub about 40 seconds before `AssetView.jsx` (adding that export), so an auto-triggered deploy in between the two commits built against a mismatched pair and failed — resolved once both files were in, unrelated to the deployment cap itself. Two follow-ups flagged, not yet done: a fine-grained Prospects/Upload permission audit (`ProspectEditor` has no role gating at all today — 4.62), and mobile-width verification of the new three-child asset header row (4.61). Sections 7, 7a, and the top status line updated in this sync.*

*Last updated: July 2026 — This session (Demo Asset 4 build + live EOL/TAC test, NO CODE CHANGED): Built Demo Asset 4 (MSN 5533, EI-GNZ, A320-232/CFM56-5B4/P) end to end specifically to exercise the End of Lease Position + TAC pipeline live for the first time — full document set generated (lease doc, 3 utilisation reports, 2 Engine LLP sheets, 1 APU LLP sheet, 2 TAC documents), using real CFM56-5B part numbers/pricing from `Engine_LLP_Escalation_Model.xlsx` so the app's tier-1 catalogue match applies. Live result: EOL Position showed a combined $505,132 lessee-owed adjustment across both engines, ~3% off the cheat sheet's hand-estimated ~$520,000 — first full confirmation the feature works end-to-end, TAC included (previous live test, MSN 1009, had no TAC on file). Alan flagged five further items live-testing the same session: one new (TAC upload requires an active lease already on file — sequencing question, needs a short design discussion, not yet scoped as a fix) and four reproductions of previously-logged items — 4.79 (DOM date-mask, now also confirmed on the Asset Details screen, not just Specs tab), 4.80 (2 Year Check ordering), 4.81 (lease uploader visual consistency, now with a screenshot, plus a new request to reorder the tier choices to Manual → Confidential → Quick), and 4.75 (EN-PR/EN-LP catalogue-rate check unit mismatch, reproduced with different numbers, confirming it isn't value-specific). New `TECH_DEBT.md` 4.91 (live-test confirmation) and 4.92 (TAC-before-lease sequencing). Section 16 and Section 19 updated in this sync. `DEMO_CHEAT_SHEET.md` updated with Asset 4's manual entry values, TAC baseline, and the confirmed live EOL figures.*

*Last updated: July 2026 — This session (APP_SURFACE multi-entry split + domain setup, Sonnet build): Follow-up to the Vite migration, which had deliberately deferred this. `vite.config.mjs` now selects an entry HTML file (`index.html`/`specs.html`/`airframe.html`/`engine.html`) based on an `APP_SURFACE` env var (defaults to `app`), and a new `scripts/finalize-build.mjs` postbuild step renames the built output to `dist/index.html` regardless of surface, since Vite otherwise preserves the source HTML's filename and Vercel serves `/` from `index.html`. Three new stub entries added — `specs.html`/`airframe.html`/`engine.html` plus matching `src/main-specs.jsx`/`main-airframe.jsx`/`main-engine.jsx` — deliberately bare (no Firebase, no CDN scripts), since TailiQ Specs/the free airframe tool/the free engine parse have no built UI yet (scoping only, in `tailiq-engines-scoping-handoff.md`/`COMMERCIAL_VISION.md`); this session was infrastructure + stub placeholders, not real product UI. Verified with real local `vite build`s (pulled the live repo's public GitHub tarball) for all four `APP_SURFACE` values before Alan pushed anything — confirmed the bundle-size split is already real: `app` 528 KB JS vs. 142 KB JS per stub surface (bare React only). Deployed: existing app project given an explicit `APP_SURFACE=app` env var; three new Vercel projects created from the same repo (`tailiq-specs`/`tailiq-airframe`/`tailiq-engine`), each confirmed showing its correct stub page. Two red "Error" deploys seen mid-session on the existing app project were traced to commits pushed before `finalize-build.mjs` had landed in the repo (Alan pushes file-by-file via GitHub's web UI) — not a regression, superseded by the next green deploy; live app re-verified working end-to-end afterward. All three new subdomains (`specs.tailiq.app`, `airframe.tailiq.app`, `engine.tailiq.app`) wired via Vercel's per-domain CNAME targets + matching Cloudflare DNS-only records, confirmed live over HTTPS. New `TECH_DEBT.md` 4.58. One known follow-up flagged, not solved: all four Vercel projects still deploy the full `api/` folder as serverless functions since they share one repo — worth pruning once the three new surfaces are actually built out. Top status line, Section 17 (Infrastructure/Product), and Section 19 updated in this sync.*

*Last updated: July 2026 — This session (Vite migration, Sonnet build): Migrated the single-file `index.html` to a Vite-bundled modular project — single entry point reproducing the old app 1:1, no feature changes; the `APP_SURFACE` multi-entry split (per-surface bundles for app/specs/airframe/engine) is deferred to a follow-up session. Structure: 7 files under `src/lib/` (non-component helpers grouped by purpose) and 14 files under `src/components/` (one per feature area), plus `App.jsx` as orchestrator; `/calculations`, `techSpecBuilder.js`, and `/api` untouched in content, moved to `public/` where Vite needed them as static assets. Five real bugs found and fixed during the actual deploy, not just inferred from reading the code (full detail `TECH_DEBT.md` 4.56): (1) `api/email-ingest.js` reads `calculations/utilisation.js` directly off disk rather than via URL, so that file needed restoring at the repo root alongside its `public/` copy; (2) `package.json`'s `"type": "module"` broke every `/api/*.js` function's CommonJS `require()` — fixed by removing the flag and renaming `vite.config.js` to `.mjs`; (3) `firebase-admin`, `busboy`, and server-side `xlsx` were never in `package.json` — six of eight API functions had unresolved dependencies that only surfaced once a real install step existed; (4) `middleware.js`'s `@vercel/functions` import, same root cause; (5) Vite's default build target doesn't support the top-level `await` in the Firebase-init module — fixed via `build.target: 'esnext'`. `public/share.html` and `public/tailiq_landing.html` also relocated for the same static-asset reason; `middleware.js`'s landing-page rewrite and `vercel.json`'s share-link rewrite both continue working unchanged. Verified end-to-end in production: sign-in, Dashboard, tech spec generation, share links (QR + direct), Fly-Forward/Maintenance Calendar, Admin invite/set-role, and both email-ingestion paths. New `TECH_DEBT.md` 4.56 (migration) and 4.57 (two small parked items — "Extract with AI" button naming, Upload/Quick-Import visual consistency). Top status line updated in this sync. Next Sonnet session: the `APP_SURFACE` multi-entry split.*

*Last updated: July 2026 — This session (Fleet Exposure View, Sonnet): Built the Fleet Exposure View per `fleet-exposure-build-handoff.md` (Opus scoping session) — new pure module `calculations/fleetExposure.js` (Brain/Body separation, no window/Firebase/UI) aggregates the same Fly-Forward atoms across the whole fleet into a headline (high-case £ gap, red/amber/green counts, clickable completeness gap), a time axis (month-bucketed cost/coverage/gap totals), and an asset axis (ranked worst-first). Status rule tested against `high`, not `likely` — hope for the best, assume the worst (new Section 18 entry). Typed exclusions (`NO_LEASE`/`POTS_OUTSTANDING`/`STALE_UTILISATION`/`COMPUTE_ERROR`), per-asset try/catch, headline never zero-fills or refuses to total. 35/35 Node E2E tests passing against the real `flyForward.js`/`maintenanceCal.js` code (window-shim pattern, no mocks) — caught and fixed one real bug along the way: an invalid `lease.leaseEnd` was silently producing `NaN` throughout the projection instead of throwing, now correctly surfaces as `COMPUTE_ERROR`. Per-asset "asset risk dashboard" confirmed scoped OUT permanently, not deferred — Opus scoping concluded the only genuinely new information is fleet-level clustering, invisible per-asset. Deliberate design decision (Option B, confirmed mid-session): `fleetExposure.js` runs its own pass-1/Brain-6/pass-2 orchestration independent of `index.html`'s `buildFlyForwardProjection`, for future server-side portability — flagged as known duplication (`TECH_DEBT.md` 4.46), not a drift risk in this session. Pot anchoring (`asset.checks`/`landingGear`/EN-PR dates → `firstEventOverrideDate`) extracted into a shared `anchorReservePots()` function used by both orchestration paths, since that piece is thin mechanical mapping rather than real orchestration. `index.html`: new `FleetExposureView` component, new nav-pill entry ("Fleet Exposure", currently ungated by role — flagged open, see below), click-through from time/asset axis routes to Fly-Forward rather than the asset overview (fixed same session after Alan's feedback — the exposure numbers are Fly-Forward's own atoms, so the drill-down should land on what explains the number). Two real product questions raised at session close, deliberately left open rather than guessed at: (1) **Fleet Exposure role-gating** — should every Viewer see fleet-wide financial exposure, currently ungated; (2) **nav IA / layer-based restructure** — Alan's thinking that the three main nav-pill buttons could map to the three product layers (Dashboard≈Layer 1, Fleet Exposure≈Layer 2, a future Scenarios view≈Layer 3), with Upload/Prospects/Admin moved to a secondary location as workflow tools rather than layer views; closely related, `PortfolioView`'s role was reconsidered as purely the client-facing/screen-share-safe view rather than a default landing screen, meaning Viewer-role auto-landing on Portfolio may be conflating two different things. Both added to Section 19, not resolved. New `TECH_DEBT.md` 4.45 (built), 4.46 (orchestration duplication), 4.47 (LC-expiry gap, parked), 4.48 (Brain portability, carried forward). Sections 5, 17, 18, 19, and the top status line updated in this sync. Git tag: `v1.20-fleet-exposure-view` (previous tag `v1.19-brain6-wired`).

*Last updated: July 2026 — This session (Tech spec competitive comparison, Sonnet, NO CODE CHANGED): Alan supplied three real third-party tech specs (GECAS/TAP A330-200, Deucalion A330-223, Kahala 737-800) for a general comparison against TailiQ's own output, followed by ten real avionics spec sheets specifically to settle the open Manufacturer-field question from 4.50. General findings: TailiQ's existing Avionics/LLP/shop-visit-history choices are all in line with or ahead of market practice — nothing structural needed changing. Three items agreed and queued for a build session: Check facility (Check History), Annual utilisation/FH:CY ratio (airframe level, derived), and Avionics Manufacturer (independently optional alongside Description/P/N, AI best-effort extraction, reviewed same as any other field — based on a 10-sample tally showing Manufacturer present in 7/10 real sheets, partially reversing 4.50's original "too inconsistent" call for that one field only; Description stays verbatim, no normalisation). Four items considered and dropped/parked rather than built: registration history (not worth the effort), airframe-level certification basis (parked — Alan to confirm whether the TCDS reference is worth tracking), an Airfleets.net scrape for registration/operational history (rejected outright — fragile third-party scrape, unverifiable community data, undercuts the product's own "auditable/defensible/traceable" positioning), and a Kahala-style side-by-side dual-engine summary card (rejected — pure duplication of the existing per-engine full-page treatment on pages 3–4). Confirmed the existing per-asset/fleet-wide/hardcoded-fallback tech spec disclaimer (Section 13) already covers the interchangeability-style caveat these third-party specs carry as boilerplate — no new footnote needed. New `TECH_DEBT.md` 4.51 captures the full decision set. Sections 13 and 19 and the top status line updated in this sync. No code, no Firestore schema, no `index.html` touched this session.*

*Last updated: July 2026 — This session (Firestore rules deploy verification + pot accrual basis fixes + Avionics LRU List rebuild, Sonnet, git tag `v1.21-avionics-lru-rebuild`): Three pieces of work. (1) **Verified the 4.44 Firestore rules deploy** — Alan published the merged rules file covering `scheduledEvents`/`seasonalityProfile`/`shopVisitProjections`; confirmed end-to-end (Admin/Editor writes succeed, Viewer writes rejected, Viewer `shopVisitProjections` create succeeds) — closes the last open item from the Brain 6 handoff, see `TECH_DEBT.md` 4.44's updated deploy note. (2) **Found and fixed two related bugs in fixed reserve pot accrual basis handling** (`TECH_DEBT.md` 4.49) — `validatePotWithAI`'s prompt was wrongly asserting flight-hour accrual as the default for every non-engine pot (false-flagging correctly-`per_month` AF-6Y/AF-12Y/LG-OH and correctly-`per_APU_hr` AP-OH), and the accrual-basis `<select>` was missing its `per_APU_hr` option outright, silently falling back to displaying Flight Hour for a genuinely-correct APU pot. Both fixed and verified against `MSN TEST-99`. (3) **Avionics LRU List rebuilt from scratch** (`TECH_DEBT.md` 4.50, supersedes 4.14) — reviewed 7 real avionics spec sheets across different airlines/formats during scoping; Description + Part Number were the only two fields consistent across all of them. Old fixed 8-field tab retired entirely (no data migration, per Alan). New: upload PDF → Sonnet extraction → review/edit screen → save, grouped by ATA chapter (explicit header, or derived from a per-row ATA code via a new lookup table, or left flat/ungrouped when neither exists — never inferred from description text), independent per-row/per-chapter visibility toggles, and a tech spec renderer reusing the existing table-based `col2()` two-column pattern with a whole-page split above ~25 visible rows and repeated chapter headers on a mid-chapter split. Verified via a synthetic Node harness before handoff, then confirmed working end-to-end by Alan in both the app and a real generated tech spec. Top status line, Section 17, and Section 19 updated in this sync.

*Last updated: July 2026 — This session (competitive refresh + TailiQ Engines identified, NO CODE CHANGED): Commercial/competitive session, no build work — see `TECH_DEBT.md`'s matching entry and `COMMERCIAL_VISION.md` §4–5 for full detail. Re-verified the full competitive landscape (Fly Forward, Aerlytix, Sysco, LeaseWorks, Leasepoint, cloudcards, flydocs, SPARTA — all unchanged, still enterprise-only); added AirNxt (self-serve pricing-model comparable/watch-item) and KeepFlying FinTwin (closest conceptual Layer 2/3 competitor — enterprise DSaaS, $6M Series A, not a boutique threat; their Knowledge Agent design is the third independent market validation of TailiQ's own Knowledge Base direction). Investigated and **killed** ATA Spec 2500 as a build direction — records-interchange plumbing, one layer below TailiQ's human-facing trade sheet; pursuing it would put TailiQ in flydocs/cloudcards/M&E-system territory. **New roadmap thread identified: TailiQ Engines** — a vertical product for engine traders/USM dealers (not a rename of "Lite," which Alan wants to keep as a separate personal airframe product), built around the existing LLP calculator: upload LLP disc sheet → photo → share, funnelled through a single gated/metered engine parse (LLP parsing has a real per-call AI cost, so — unlike airframe specs — it can't sit in the free stateless tool). A Full-tier "LLP value" feature was scoped directionally (deterministic, derived from the existing LLP engine + Knowledge Base catalogue pricing; explicitly not a full appraised "engine value," which needs outside market data TailiQ doesn't have). **This is unscoped and needs a dedicated Opus scoping session before any build** — candidate agenda: product shape, the funnel/gate mechanism, the LLP-value feature spec, and a combined naming decision across the whole product family (free spec tool / personal airframe tier / TailiQ Engines / Full platform). No Firestore schema, no code, no `index.html` touched this session.*

Previous session: Last updated: July 2026 — This session (Brain 6 scoping, Opus, NO CODE CHANGED — documentation sync only): Locked the Brain 6 (Maintenance Calendar Engine) input schema and design against `brain6-build-handoff.md`, closing the "← START HERE" scoping item from last session. Key outcomes: derivation over manual entry (checks computed forward from Brain 1/2 + Lease/Reserve data); downtime asymmetry (only C-Checks ground, defaults 2/4/8 weeks for 2/6/12Y, editable); longest-event-wins concurrency, with 6Y/12Y modelled as one combined event (never independently concurrent within a lease horizon); `scheduledEvents`/`shopVisitProjections` linked by a read-time join on identity (`code + due-cycle`) rather than a stored FK, since the cost collection is append-only and cardinality is 0..n, not 1:1; `scheduledEvents` reshaped (not replaced) into an override/duration-config layer with a `source` flag (`derived`/`seasonality`/`airline-stated`), `estimatedCost` dropped; `maintenanceCal.js` is pure and recompute-on-read, persists nothing derived; seasonality flags-and-suggests check placement but never auto-moves a date, `airline-stated` is sticky and wins outright; 2Y-check date gap flagged as a `dataCompleteness` build-start item (no reserve pot, so `asset.checks` is its only date source); condition-triggered event visualization (APU/EN-LP windowed view) settled at the concept level, visual form deferred to a later Brain 4/5 display session. New `TECH_DEBT.md` 4.38 captures the full decision set; 4.8 (in-app guide) also corrected to ✅ Done in this sync, closing a docs/reality gap. Sections 5 and 17 updated in this sync. Brain 6 build itself (`maintenanceCal.js`, Sonnet session) is the new "← START HERE" for next session.

This session (July 2026 — Brain 6 wired into Fly-Forward, Sonnet): Wired the already-built `maintenanceCal.js` into the live Fly-Forward path. `flyForward.js`'s `monthlyAccrual()` gained a grounding-availability multiplier applied to the three utilisation-basis pots only (calendar pots keep ticking, per design) — confirmed byte-identical output when ungrounded (5/5 regression tests). EN-LP's engine-cycle clock refactored from a closed-form calculation to an incremental accumulator, since a month-by-month grounding fraction can't be expressed as a flat multiply; the old now-redundant `baseFC`/`resetMonth` variables were removed rather than left in as dead state. `index.html`'s `FlyForward` component now runs two Brain 3 passes (ungrounded → Brain 6 → grounded) plus a `dataCompleteness` gap banner, and the `<script>` tag actually loading `maintenanceCal.js` was added (the file existed since last session but was never loaded). Tested at three levels: both engines' own regression suites plus a new integration test that re-runs the actual `index.html` orchestration logic against a realistic fixture (27 tests total, all passing), confirming grounding measurably lowers accrued balances versus an all-flying comparison run. New `TECH_DEBT.md` 4.40; Section 5/17 updated in this sync.

This session (July 2026 — Brain 6 build, Sonnet, `maintenanceCal.js` shipped): Built the Maintenance Calendar Engine per `brain6-build-handoff.md` — pure function, no Firestore, no UI. Two build-time decisions made with Alan, both narrowing the locked spec: grounding uses fractional per-month availability (day-proportional) rather than whole-month zeroing, required to pass the mandated Section 10 golden fixture and consistent with most clients only having reduced-utilisation signal rather than exact check in/out dates; cost join to `shopVisitProjections` uses ±3 month date-proximity tolerance since that collection has no `dueCycle` field to match on exactly. Confirmed `shopVisitProjections`/`scheduledEvents`/`seasonalityProfile` are all still unbuilt stubs with zero references in `index.html` — Brain 6 takes cost/override data as input parameters rather than reading Firestore itself. 15/15 Node E2E tests passing, including the golden fixture. `index.html` not touched this session — wiring into Fly-Forward's two-pass assembly is next. Section 5 and 17 updated; new `TECH_DEBT.md` 4.39.

This session (July 2026 — documentation sync pass, NO CODE CHANGED): Housekeeping pass ahead of the Brain 6 build session, closing docs-vs-reality drift before opening a build against these files. Corrections: Firestore security rules (`TECH_DEBT.md` 4.28) moved from "drafted, pending deploy" to **deployed and tested in production** — updated in the top status line, Section 17's table, and `TECH_DEBT.md` itself; the `companyId`-scoping gap (4.29) is explicitly not closed by this and remains the one genuinely open security item. In-app guide rewrite ticked in the Layer 1 Hardening checklist (was unchecked here despite `TECH_DEBT.md` 4.8 recording it as complete). `companyId`-on-existing-docs annotated as a deliberate open item with a cross-reference to 4.29 rather than reading as forgotten debt. Two further items closed after confirming status with Alan: **4.14 Avionics Listing** moved from 🟡 OPEN to **✅ DONE** (Avionics tab + structured fields live and working — closed on Alan's confirmation rather than code inspection, so the conditional Avionics section in the *tech spec output* is worth verifying on the next generated PDF); and a new Section 0a entry in `TECH_DEBT.md` logging the **July 2026 live-fleet Specs/LG/APU additions** (Manufacturer fields, Cabin Seats P/N, QAR/RFDD/Enhanced Mode-S toggles, Avionics photo upload type), which had been built but never recorded. Audited and confirmed already in sync, no action needed: `TECH_DEBT.md` 4.16/4.17/4.18 (done), 4.20 (parked), the Fleet Overview navy→white header banner (already recorded done in both files), and `/api/email-ingest` (built and tested with real emails). **Brain 6 (`maintenanceCal.js`) remains the "← START HERE" item** — spec locked in `brain6-build-handoff.md` and `TECH_DEBT.md` 4.38, ready for a Sonnet build session with no re-discovery needed. No code files touched.

Previous session (July 2026 — Bulk Lease Import built + polish pass, git tag pending): Closed the "← START HERE" item from last session — built Bulk Lease Import in full (Section 8, `TECH_DEBT.md` 4.36): multi-file queue inside the Upload tab, local MSN/registration auto-match with manual override, needs-manual-entry/needs-manual-assignment handling, tier chosen once per batch. Redesigned the save step during live testing into two explicit paths — "Save Details for Later" (original prefill-only behaviour) and "Activate Lease" (writes real reserve pot docs immediately, validated and committed atomically, all-or-nothing if any rate is flagged) — after Alan pointed out the original single-button flow always required a follow-up trip to the per-asset Lease Wizard to actually persist parsed rates. Investigated a real "per landing gear" rate-wording ambiguity against a real lease clause using accrual math against the app's own known cost band; resolved in favour of the un-multiplied reading, no code change, left as a reviewer judgment call. Relaxed both Lease Wizards' "Continue" gate to lessee-only. Closed out a short polish pass (`TECH_DEBT.md` 4.37): tech-spec-matched icons on the Upload tab, Fly Forward gated on lease presence in both `AssetView` and `PortfolioView`, a 📄 lease-on-file indicator added to every view an asset appears in, the Dashboard's dead "View" button removed, the previously-queued tier-choice "ⓘ" toggle replaced with a chevron accordion, and the Dashboard's NLG/LLG/RLG columns centered (catching and fixing two small regressions along the way). Fleet Overview header banner (navy→white) also confirmed live by Alan this session. Sections 8, 17, 19, and the top status line updated in this sync. Remaining Layer 2 scope — Brain 6 (Maintenance Calendar Engine), asset risk dashboard, fleet snapshot/aggregation — is the new "← START HERE" for next session.

Previous session (Fly Forward Portfolio entry point, mobile header fix, Lease Data Input Path 1 built, git tag pending): Closed the "← START HERE" item from last session — added a Fly Forward entry point to Fleet Portfolio dashboard cards, gated the same way as `AssetView`'s, with a new `ffOrigin` state so the back button returns to wherever it was actually launched from (`TECH_DEBT.md` 4.33). Fixed mobile header stacking on `AssetView` (4.34), catching and fixing a same-session desktop regression along the way. Built Path 1 in full for single-asset lease upload (4.35, Section 8) — three tiers (Manual / Quick Extract / Confidential Extract, renamed from "AI Quick/Privacy Parse" after Alan flagged trust concerns with the word "AI" for a cautious lessor audience), PDF and Word document support, and ZDR formally resolved as unavailable at TailiQ's current scale — dropped from scope entirely, with the privacy claim resting on the narrow-send architecture instead. Diagnosed and fixed three real, non-obvious Word-document heading-detection bugs by direct inspection of Alan's actual lease file (`python-docx` + a Node `mammoth` test harness, not inference from screenshots) — a custom "Leader" paragraph style invisible to `mammoth`'s default style map, a critical rate-schedule boundary using plain bolded body text with no distinguishing style name, and over-fragmentation from naively splitting on every heading level. Verified end-to-end against the real document: correct figures parsed, correctly labelled candidate, clean pot-table prefill. Bulk Lease Import (Upload tab, multi-file + MSN auto-match, reusing the same extraction pipeline) is the new "← START HERE" item for next session — see Section 8/17, `TECH_DEBT.md` 4.35. Sections 8, 17, and the top status line updated in this sync.

Previous session (Fly-Forward wired to real data, git tag pending): Retired `FlyForwardDemo`; `FlyForward` now reads real `leases`/`reserves` Firestore data via `asset.currentLeaseId` and projects against it with Brains 3/4/5, no editable assumptions panel, Viewer role access extended (locked requirement from last session, now built). Extended the reserve pot schema and Lease Wizard to actually persist the outflow side (trigger basis/interval, cost range, escalation regime, EN-LP harvest/stub) — previously only the accrual side was ever saved, so Fly-Forward had nothing real to project from even once a lease existed. Added a new `triggerBasis: "engine_fh"` for EN-PR (Section 4) after real CFM56-5B/V2500-A5 mature-run market data replaced the old illustrative placeholder, converting a real FH interval to months via the asset's own utilisation rate. Added EN-PR first-PR anchoring (infer from opening balance ÷ accrual rate, or manual last-PR-date entry). Found and fixed a real crash affecting any reserve doc saved before this session's schema extension (missing `triggerBasis` entirely, which the calculation engines correctly reject with no error boundary to catch it) — fixed with proper fallback chains, a stricter `saved` flag requiring the complete schema, and defensive gap-filtering on the read side. Verified the wiring against real asset data: a multi-year EN-LP shop-visit projection checked out arithmetically against a genuinely low-utilisation asset's real FC/month rate, and a zero-projected-events result was confirmed correct (short lease horizon) rather than a bug. Closed `TECH_DEBT.md` 4.30 (Viewer access, now real) and 4.31 (checkbox alignment, found to actually be a global CSS `width:100%` rule stretching radio inputs, not a flex/wrap issue). Opened 4.33 (Fly Forward button missing from Fleet Portfolio cards) for next session. See `TECH_DEBT.md` 4.32 for full detail; Sections 4, 5, 17, 19 updated in this sync.

Previous session (Lease/Reserve Setup built, validation bugs fixed, security rules rewritten, git tag v1.13-lease-reserve-setup): Built the "Add Lease / Reserve Setup" flow (Section 9) end to end — 3-step wizard, real `leases`/`reserves` Firestore schema exactly as designed in Section 5, an Overview/Edit/Delete landing screen added after Alan flagged that silently skipping straight to pot entry hid the lease's existence and buried Delete, and a diff-aware Activate that only writes a new append-only lease record when lessee/dates actually changed. Found and fixed two real bugs in the AI pot-validation layer (`TECH_DEBT.md` 4.26): a fail-open catch that masked failures as "not flagged," and the actual root cause underneath it — `/api/extract`'s real response envelope (`{ok,data}`, same pattern as `extractLLPSheet`) was never being read correctly, so every validation call had been silently failing since the feature was built. Added a deterministic EN-LP catalogue-rate check (4.27) after Alan pointed out an LLM shouldn't be the only thing catching an obviously-wrong figure when a hard reference number (`llpCatalogue.js`) already exists in the codebase for that pot type. Rewrote Firestore security rules (4.28) — replaced a blanket "any signed-in user, full read/write, every collection" wildcard with role-gated writes on `leases`/`reserves`/`assets` and a genuinely immutable `auditLog`; this also surfaced that Sections 7 and 14 had been claiming companyId-scoped, tamper-proof security was already done when it demonstrably was not — both corrected in this sync. Discovered `companyId` has never been populated on any asset anywhere in the codebase (4.29) — decided to leave as `null` pending real Section 7 multi-tenancy rather than invent a placeholder now. Explored, then reverted, opening Fly-Forward to Viewer role (4.30) after realising `FlyForwardDemo` never reads real lease data for anyone, admin included — Viewer access to Fly-Forward is now a locked requirement of the real Layer 2 build (added to the Section 17 checklist), not resolved today. One cosmetic item queued for next session (4.31). Rules file (`firestore.rules`) drafted and handed off — not yet deployed by Alan, pending his own testing pass.

Previous session (July 2026 — Lease Data Input UI scoping/design, NO CODE CHANGED): Full design pass for the next Layer 2 build thread, chosen over Brain 6/dashboards as the more logical next step (Brains 3/4/5 need a real front door; Brain 6 depends on this data existing first). Key decisions: (1) **Structural split** — asset creation and lease/reserve setup are separate flows, not one combined wizard; existing Add Asset flow untouched, new short "Add Lease / Reserve Setup" flow assumes an asset already exists. (2) **Pot entry redesigned** — pre-populated checklist (4 fixed pots + auto-generated engine pots + custom-pot escape hatch) rather than blank form or type-picker; partial completion allowed with red/amber/green flagging; validation is a warning requiring explicit acknowledgment, not a hard block. (3) **Firestore schema finalised** — `leases/` append-only collection (lease terms genuinely change at transitions, unlike reserve pots) with `currentLeaseId` pointer on the asset doc; `reserves/` one doc per pot (not consolidated into an array) with `companyId` duplicated onto every doc for cheap security-rule matching; full design rationale captured in Section 5. (4) **Path 1 vs Path 2 repositioned** — either/or client choice, not sequential fast-follow; Path 2 (manual entry) is the sole v1 build target; Path 1 (PDF parsing) parked pending a local-extract-and-narrow-send design (browser-side page isolation before anything reaches Anthropic, not "send the whole document with extraction instructions" — that doesn't reduce exposure) and a ZDR investigation; real value case for Path 1 identified as bulk multi-asset onboarding with MSN-based auto-matching, not single-asset use. (5) **EN-PR derate/ratio reopened** — reviewing the actual signed lease clauses (Sections 2.1–2.2, uploaded this session) revealed two independent real adjustment mechanisms (FH:C ratio lookup table, applied "at any time"; derate %, applied annually) rather than the single static resolved rate originally assumed at Brain 3 scoping. A strong textual reading (both clauses share the same 10% baseline) suggests ratio-table-first-then-derate-on-top sequencing, but this needs legal/commercial confirmation before being built — flagged for a dedicated future Opus session, not v1 scope. Full detail in `TECH_DEBT.md`.

Previous session (July 2026 — Fly-Forward Demo build, multi-session arc): Built Brain 3/4/5 for real (`flyForward.js`, `riskPeak.js`, `shortfall.js`) and proved them against real asset data via an internal-only Fly-Forward Demo view, ahead of the actual Layer 2 build — sits outside the IT/Security Gate boundary since it uses only fabricated lease terms, no real financial data in Firestore. Real utilisation rate, real engine/APU LLP stacks, real AF-6Y/AF-12Y/LG-OH next-due dates, real per-engine CFM/V2500 detection, and (after uploading `Engine_LLP_Escalation_Model.xlsx`) real per-part LLP catalogue pricing (`calculations/llpCatalogue.js`) all wired in against fabricated lease terms (accrual/escalation/triggers/costs, editable in-view). Found and fixed five real bugs against real data that the earlier synthetic test case hadn't surfaced — see `TECH_DEBT.md` 4.23 for full detail — plus one feature (editable lease-start-date for balance catch-up) built and then correctly reverted once Alan identified that reserve pots carry over across leases, so Opening Balance per pot is the right lever instead. Closed `TECH_DEBT.md` 4.19 and 4.21; parked 4.20 (EN-PR cost/interval accepted as sufficient for now). Deployed by Alan.

*Last updated: July 2026 — This session (4.21 stub-buffer guardrail): Built and tested `validateStubBuffer()` in `llpCalculator.js`, closing `TECH_DEBT.md` 4.21. Corrected the original scoping-session framing during discussion: the lowest limiter is not stub waste (it runs to near-zero and is replaced regardless), so the guardrail checks the shortest-`approvedLife` LLP among the *other* parts that could be harvested early, with a 2-point tolerance band. See Section 4 for the corrected model detail.

Previous session (Brain 3 scoping — Opus, NO CODE CHANGED): Locked the Brain 3 (Fly-Forward) input schema and formula against a fully-populated, real-shaped test case (A320/V2500 family), ahead of the Oct–Dec Layer 2 build. Confirmed: per-pot `accrualBasis` flag + month-by-month summation formulation (replacing the single `rate × cycles × months` multiply — calendar pots accrue on time, utilisation pots on FH/FC/APU-hr); current escalated pot rates straight off the real Maintenance Payment Rate schedule (AF-6Y $14,142.60, AF-12Y $8,146.14, AP-OH $54.30/APU-hr, LG-OH $4,299.35, EN-LP $348.56/FC, EN-PR via EPR Tables); V2500 asset → 10.53% catalogue escalation; two escalation streams (accrual + outflow, 2.5% flat vs 10.53%/catalogue-price); range→band outputs (shortfall band, risk-peak window); APU condition-trigger + LG single-shipset dual-limiter; EN-LP as a Brain-2-fed stack simulation with harvest threshold (2,000 FC) + stub buffer (10%); EN-PR/EN-LP kept separate; horizon = lease end with partial-funding past it; Path 2 (manual) first for lease input. Full spec in Section 4; build prerequisites and data gaps in `TECH_DEBT.md` 4.19–4.22 (incl. 🔴 Brain 2 per-part LLP vector, blocks EN-LP). No live code, no Firestore schema touched. Previous session (v1.12-prospect-asset-flow-complete): Prospect Asset Flow taken from initial build through three feedback rounds to a working, bug-fixed state (4.15) — operator toggle, weights card, full ordered Specifications list matching Alan's reference sheet, LDG current totals, checks auto-populate, inline Engine/APU LLP extraction (reuses live fleet's exact prompts/model choice), and standalone-engine (ESN-keyed) prospects with an explicit Aircraft/Engine creation choice plus a shared Photos card. Root-caused and fixed a bug where standalone-engine prospects rendered as full aircraft specs from the Prospects-list button and public Share/QR link — derivation moved into `generateTechSpec()` itself and `prospectKind` added to the share endpoint's allowlist (`api/share/[token].js` + `share.html`). Confirmed working end-to-end. Three items opened for next session — see `TECH_DEBT.md` 4.16–4.18 (engine photo not used in standalone spec, orphaned `specs.seating` field, Prospect editor tab naming — discussion needed). Git tag: v1.12-prospect-asset-flow-complete.

Previous session (v1.11-prospect-asset-flow): Initial Prospect Asset Flow build — `type:"prospect"` schema flag, shared `makeBlankAsset()` factory, "Prospects" nav item, `ProspectListView` + `ProspectEditor` 50/50 split, reusing `buildTechSpecHTML()` unchanged.

Previous session (v1.10-techspec-cover-operator-toggle + visual rebuild): Tech spec fully rebuilt — new cover (slate hero band, MH logo, photo, 4 icon stat tiles), all content pages redesigned with card-based layout, SVG icon headers, LLP progress bars, APU on own page, engine/APU highlight cards, LDG equal-height cards, empty page bug fixed. Operator label toggle added (Current/Previous Operator per asset). Git tag: v1.10-techspec-rebuild.

Previous session (v1.9-multi-fix): 12 bugs and features addressed across parsing, upload, and UI. Headline fixes: compound period normalisation; LLP blank screen root cause fixed; Excel sheet selector; editable LLP FC Remaining; Quick Import extended; hide spec fields; LDG pills; GearCard enlargements; thrust default 27K; APU LLP European notation.

*Last updated: July 2026 — This session (v1.9-multi-fix): 12 bugs and features addressed across parsing, upload, and UI. Headline fixes: compound period normalisation (EAN "March 2026 - April 2026" → "April 2026" before Brain 1); LLP blank screen root cause identified and fixed (undefined `asset` variable ReferenceError in review panel — affected APU LLP, EAI engine LLP, AGO engine sheets); Excel sheet selector added to upload; editable LLP FC Remaining in engine edit mode; Quick Import extended to Sonnet with engine/APU SV and LDG overhaul extraction; hide spec fields per-asset; LDG pills in Overview; enlarged GearCard TSN/CSN; thrust default 27K; APU LLP European number notation. Two bugfixes needed after initial deploy (JSX structure in SpecsQuickImport review, ternary `?` vs `:` typo in APU LLP prompt). Discussed but not yet built: LLP upload inside asset (queued). Previous session (July 2026): backup retested and confirmed, audit log built, in-app guide rewritten. V1 IT/Security Gate remains 7 of 7 clean.*

---

*Last updated: July 2026 — This session (pre-IT-review test/build pass, Sonnet, git tag pending): Four items built and deployed together ahead of the internal IT/security review meeting — thousand-separator on all hour readouts (`TECH_DEBT.md` 4.66), engine stock photos generalised from a hardcoded 2-family lookup to all 8 supported families (4.67), a new Airframe Stock Photos system with coarse model-matching into 7 buckets (4.68), and Operator History — a new engine-record data type with upload/parse/review extraction, manual entry, edit/delete, and gap-flagging, plus a new tech spec PDF section — built per the locked `operator-history-scoping-handoff.md` design (4.69). 9 files touched, all syntax-validated before handoff. A deploy issue was found and worked around, not a code problem: the `app` Vercel project's automatic GitHub-webhook deploy stopped firing partway through the session (confirmed via GitHub commit history and Vercel's Deployments tab — three earlier commits deployed cleanly, then silently stopped, ruling out `vercel.json`/`ignoreCommand` since there is none); a manually-triggered Vercel Deploy Hook unblocked testing immediately, but the underlying stale webhook still needs a Disconnect/Reconnect on `app`'s Git settings before the next push. A second color-correction pass on the engine/airframe cover art also landed this session: testing surfaced that the original background color-match (previous session) had been checked against the wrong reference — website header navy `#102A43` — instead of the actual tech-spec-hero CSS background, `#111827`; corrected on the affected files (LEAP-1B, CF34, CF6, PW1100G engines + all 7 airframe covers), plus a pre-existing edge-artifact cleanup across the full 15-file set (`TECH_DEBT.md` 4.70). Two items explicitly deferred, not built: Route Matcher fleet-wide clash detection (blocked — Route Matcher/Brain 8 itself isn't built yet) and a pandemic-scenario preset button on Fleet Exposure's fleet-wide chat box (both flagged to fold into the eventual Layer 3 build). `public/share.html`'s lack of engine/airframe stock-photo fallback confirmed as a known, pre-existing gap, untouched this session. Section 19 and the top status line updated in this sync.*

*Last updated: July 2026 — This session (Layer 3 fleet-level build: clash detection, pandemic scenario, fleet Calendar tab, Sonnet build): Closed out three of the four items the previous session had explicitly deferred/flagged — Route Matcher fleet-wide clash detection (previously blocked on Route Matcher itself not existing; it now does) and the pandemic-scenario preset (previously sketched as a chat-box button; built instead as a dedicated 1–12 month slider, since the fleet-wide chat box it would have lived on is killed this session, Alan — no replacement, fleet-wide natural-language "what if" is simply not covered anymore). Also built the fleet Calendar tab, which had been nav-shell-only ("Coming soon") since the four-layer nav restructure. Route Matcher clash detection checks a candidate's route-shifted C-Check windows against every other asset's own base-case C-Check windows for genuine date overlap (duration-aware, not just same-month — confirmed design, stricter than Fleet Exposure's month-bucket clustering); new `windowsOverlap()`/`detectClashes()` in `routeMatcher.js`, surfaced as a clash badge + detail list in `RouteMatcherView`. Pandemic slider grounds the fleet from today for N months, combined with each asset's own real maintenance grounding via `Math.min` (no stacking, same rule Brain 6 already applies to overlapping C-Checks) — new `applyPandemicGrounding()` in `fleetExposure.js`, new `PandemicScenarioView` component, base-vs-scenario Fleet Exposure headline comparison. Fleet Calendar tab reuses the asset-level `MaintenanceCalendarGrid` (Alan's decision, rather than building something new), fed by a new shared `buildFleetMaintenanceEvents()` helper that also powers clash detection's base-case side — no duplicate Brain 6 orchestration between the two features, though it does duplicate roughly half of `buildAssetAtoms`'s pass-1/Brain-6 logic by design (flagged, not fixed, same tradeoff already documented for `buildAssetAtoms` itself). Sections 7a, 11, 17, and 19 updated in this sync; new `TECH_DEBT.md` 4.85 has full technical detail. Validated this session: every touched file syntax-checked (`node --check`), a full production `vite build` (`APP_SURFACE=app`) compiled cleanly across 56 modules, and the two genuinely new pure-logic pieces (pandemic grounding merge, clash window overlap) were unit-tested directly against synthetic fixtures. Not yet done, flagged rather than skipped: a real end-to-end run through Brain 3/6 against live Firestore data — no fixture harness was built this session to avoid guessing at real asset/lease/pot shapes; recommended as the first thing to check once this is deployed, same pattern every other build session here has followed. Files touched: `public/calculations/fleetExposure.js`, `public/calculations/routeMatcher.js`, `src/lib/flyForwardHelpers.js`, `src/components/PortfolioView.jsx`, `src/components/FlyForward.jsx`, `src/components/Scenarios.jsx`, `src/App.jsx`.*

*Last updated: July 2026 — This session (Calendar leaseless-asset fix + IT checklist v2 planning): Follow-up to the same day's Layer 3 build. Fixed two real bugs in `flyForwardHelpers.js` that Alan caught live-testing the Calendar tab — `loadFleetExposureBundle` never queried Firestore for any asset without an active lease regardless of what data actually existed, and pot anchoring was gated on lease presence despite only needing rate/checks/asset. Deeper fix: confirmed reserve pot documents were never the right requirement for Calendar/clash-detection — new `buildCalendarEntry()` synthesizes pot structure from the same generator the Lease Wizard uses (`pots.js`'s `buildPotDefsForActivation`/`buildPotFromDef`) when no confirmed pot exists, then the asset's own real component data (landing gear next-due dates, engine LLP remaining life) drives the actual dates exactly as it does for confirmed pots — kept strictly separate from Fleet Exposure's financial path (synthetic pots always have accrualRate 0). Corrected twice more within the same session after Alan reviewed live: EN-PR and AP-OH are OMITTED for synthetic-pot assets, not estimated (no real anchor data exists for either — an estimate would be a fabricated guess, against the app's deterministic-outputs principle); and the leaseless-asset default horizon was raised from 24 to 180 months after Alan's own Fleet Overview comparison caught real landing-gear dates (~33 months out) silently vanishing — the underlying event generators have no beyond-horizon grace, so 24 months (shorter than LG-OH's own 120-month interval) was structurally guaranteed to drop real dates. Section 19 updated; full detail in `TECH_DEBT.md` 4.86. Also logged, not built: a v2 IT/Security Review checklist (`TECH_DEBT.md` 4.87) to replace the Layer-1-only V1 checklist (Section 3a) once IT review actually happens — explicitly scoped by Alan to internal-build framing only (no marketing/ISTAT language) and the Full platform only, excluding the three free/lead-gen domains. Section 3a annotated with a forward-reference so this isn't lost. Not yet started.*

*Last updated: July 30, 2026 — This session (Fleet Snapshot Writer deployed + punch-list closeout + cost-tracking scoping, mixed Sonnet build / Opus scoping, multiple sub-sessions synced together): Several threads closed out on the same day. **Fleet Snapshot Writer built and deployed** (`TECH_DEBT.md` 4.93) — Cloud Run function (`fleet-snapshot-writer`, europe-west2), monthly Cloud Scheduler trigger, `vm` shim extended from one Brain to six (`llpCatalogue.js` → `llpCalculator.js` → `realAssetContext.js` → `flyForward.js` → `maintenanceCal.js` → `fleetExposure.js`, dependency order matters). Verified end-to-end against real production data — correctly excluded 13/17 assets as `NO_LEASE`, correctly refused to write past the >50% exclusion threshold, correctly alerted via SendGrid. `fleetSnapshots/` schema stub (Section 5) corrected to match what's actually computed (`totalHighCaseGap`/`statusCounts`/`timeAxis`/`assetAxis`), not the pre-redesign stub. A real security gap was found (not fixed) while wiring the new Scheduler job: `firestore-backup`'s own Cloud Scheduler job has no auth header on its Cloud Run invocation (`TECH_DEBT.md` 4.94) — same OIDC + IAM Invoker fix now proven for the new writer applies here too, queued as its own deliberate pass. **Punch list from the previous day fully closed**: backup/restore retested end-to-end against the fuller current collection set (4.96); the EAG two-engine LLP upload failure root-caused and fixed — not the suspected MSN 1009 TAC-merge bug, but the extraction call itself failing on non-deterministic per-row prose narration before JSON, fixed by tightening `ENGINE_LLP_PROMPT` plus client-side per-page PDF splitting plus raising `api/extract.js`'s `maxDuration` 60s→300s (4.95); a batch of mobile/tech-spec UI fixes including the Prospect creator's upload button restyle to match the app-wide dropzone pattern (4.97); stock photos not loading — deprioritised, not pursued (4.99). **Seasonality editor bug scoped, not yet fixed** (4.98) — investigation surfaced a genuine design-vs-code gap, not just a UI bug: Brain 3's `basisQuantity` monthly-weighting shaping is documented as implemented in `brain6-build-handoff.md` §3.4 but doesn't appear to actually be wired in. **Cost-tracking scoping session** (Opus, `monthly-report-cost-tracker-handoff.md`) locked three interlinked features: Monthly Report (5 sections locked — Fleet Headline, What Moved, Pot Health Summary with a rate-negotiation framing, Upcoming Events, Utilisation Exceptions at a 20% deviation threshold — plus a 6th section blocked on Cost Tracker data; PDF via SendGrid; blocked overall on team logins existing as an audience) (4.100); SV Cost Tracker (completed-event entry form, calendar-driven pending-completion nudge at projected-date+30 days, required/optional/derived field schema locked now so data capture starts from day one, standalone build not blocked on anything) (4.101); Rate Recommendation Engine (derives recommended reserve rates from completed-event actuals, three phases — internal-only → anonymous cross-client pool → marketing carrot — blocked on Cost Tracker data volume) (4.102). Sections 5, 17, 18, 19 and this top-of-file status updated in this sync.*

*Last updated: July 31, 2026 — This session (three carried bugs closed + SV Cost Tracker built + Calendar leaseless at asset level + portrait/landscape first pass + Settings restructure, Sonnet build): Six threads closed in one session, several with a real course-correction along the way rather than a straight build-and-ship. **SV Cost Tracker built** (`TECH_DEBT.md` 4.103) against 4.101's locked schema — entry form, self-populating pending-completion nudge, role-gated write paths. A real gap surfaced live: the first version was write-only, no way to review a past entry — Alan asked where the tracker even was — closed same session with an always-visible Completed Events history plus a manual "+ Log Completed Event" path. **Maintenance Calendar made leaseless-safe at the asset level** (4.104), closing the gap 4.86 had left at fleet level only — new `buildAssetMaintenanceCalendar()` mirrors `buildCalendarEntry`'s synthetic-pot approach (EN-PR/AP-OH omitted, not estimated) without ever touching `buildFlyForwardProjection`, so Financials still correctly requires a real lease. **Portrait/Landscape first pass** (4.105) — Financials tab built per the locked scoping doc; toggle placement went through a real saga worth remembering (tab-local icon → app-wide nav-pill icon, both wrong per Alan → labeled control in a proper Settings tab), and a `.js`/`.jsx` build error (real JSX in a file misnamed `.js`) was first "fixed" by renaming to `.jsx` before Alan correctly caught that this broke `lib/`'s universal `.js`-only convention — corrected by converting the JSX to `React.createElement` instead, keeping the file genuinely convention-consistent. **Settings restructure** (4.106) — "Admin Panel" renamed "Settings," gating moved from whole-panel-admin-only to per-tab (Guide/Settings: all roles; Knowledge Base: Editor+Admin; Admin Panel, Assets+Users merged into one tab: Admin only); surfaced and resolved a real question along the way — confirmed by direct code read that Viewer already has full Financials/Scenarios access, so the only genuinely new admin/editor-only surface this session added is the Knowledge Base tab itself. **Three carried bugs closed, record corrected not just closed:** 4.75's root cause was the AI-context builder handing EN-PR pots the EN-LP catalogue rate, not the deterministic check's gating (which was already correct); 4.79 turned out to have no real "Specs tab" instance at all — only ever the Overview tab's `Field` component, now fixed, plus a bonus fix to a second Check-History-sort bug found in `PhotosAndSpecs.jsx`'s own editable Check History block; 4.80 confirmed as pure insertion order, fixed in both locations. **Also corrected:** 4.87 (IT/Security Review Checklist v2) had been carried as "planned, not yet built" for two sessions despite `TailiQ_Security_Review_Summary_v2.docx` already existing and matching the brief — status fixed, with a v3 addendum now owed for the Cost Tracker's new Firestore surface and the leaseless Calendar, neither reflected in v2 yet. Validated throughout: Babel JSX transform + `node --check` clean on every touched file, every diff reviewed and confirmed scoped before shipping. Still owed: live-test the leaseless Calendar against a real asset; Scenarios tab + `PortfolioView.jsx`/Dashboard for the landscape rollout; the IT review v3 addendum itself; a possible future standalone Settings page (raised, not scoped). Sections 3a, 17, 19, and this top-of-file status updated in this sync — see `TECH_DEBT.md` 4.75/4.79/4.80/4.87/4.103–4.106 for full technical detail.*

---

*Last updated: August 2026 — This session (Asset-level UI layout overhaul — Financials, Calendar, Scenarios tabs + Fleet Scenarios, Sonnet build): Pure layout and information-architecture session — no new Brains, no new Firestore collections, no schema changes. All changes are display-only and non-destructive.

**Financials tab now surfaces post-lease exposure per pot.** Brain 3's event generators previously terminated at `horizonMonths`, so `partialFundedNote` was always `null`. Fixed: each generator now produces one event past the horizon boundary (never fired in the projection, only consumed by `partialFundedNote`). `partialFundedNote` enriched with full cost/shortfall data. Per-pot charts now extend past lease end: flat frozen balance line, vertical "Lease end · Accruals stop" divider, grey post-lease zone, event dot at next event date, post-lease table row with cost range and shortfall band. Amber "Post-lease shortfall" pill distinct from red within-lease pill. Post-lease section suppressed when a within-lease event already fired. EN-LP cards show balance at lease end + lowest limiter FC remaining instead (stack sim too expensive to rerun past horizon; `leaseEndLimiter` captured at `m === horizonMonths` in Brain 3). Chart.js bug: `x.getPixelForValue(leaseEndIdx)` was passing a numeric index to a category-axis scale — corrected to `x.getPixelForValue(labels[leaseEndIdx])`.

**Header layout tightened across asset tabs.** "End of Lease Position", "Assumptions", "Edit Lease" (Financials) and "Edit Seasonality Profile" (Calendar) buttons now live in the asset header row inline with the MSN title, conditionally visible per active tab. Button states lifted into `AssetView` and passed as props — no useEffect/callback, plain state. Three top Financials cards (Fly-Forward description, Portfolio Shortfall Summary, Risk Peaks) now in a 3-column equal-height landscape grid.

**Calendar tab:** Completed Events + Calendar description side by side (2-col, stretch). Event rows in 4-column grid; expanded edit rows span all 4 columns via `gridColumn: "1 / -1"`.

**Asset Scenarios tab:** 2-col top section (description + sliders stacked left, per-pot table right, full height). 3-col bottom (Base Case | Scenario | Risk Peaks, equal height). IIFE wrapper removed from the render.

**Fleet Scenarios:** Route Matcher description and form merged into one card; Pandemic card `marginTop: 16` removed. Equal heights now work correctly via existing `alignItems: "stretch"` grid.

See `TECH_DEBT.md` 4.110–4.116 for full technical detail. Files touched: `public/calculations/flyForward.js`, `src/components/FlyForward.jsx`, `src/components/AssetView.jsx`, `src/components/Scenarios.jsx`, `src/components/PortfolioView.jsx`.*

*Last updated: August 2026 — This session (Portrait/mobile nav fix + status sync, Sonnet): Bug fix only — no new Brains, no Firestore schema changes, no new features. `src/App.jsx` only. Portrait/mobile asset-view nav pill was invisible; Share and Generate Tech Spec buttons overflowed off-screen. Root cause and fix recorded in `TECH_DEBT.md` 4.117. Section 19 updated: Forward Exposure Summary card marked deferred (dead code ready, not the immediate next item); TAC sequencing gap row consolidated; Rate Recommendation Engine database confirmed built; new rows added for EOL PDF export, APU TAC support, TailiQ Specs build, push notifications, monthly delta report, and landing page rewrite.*

*Last updated: August 2026 — This session (Nav pills for iQ + SV Interval Analytics build, `reasonCategory` taxonomy, Sonnet build): `sv-analytics-iq-tab-build-spec.md`'s full six-step build sequence completed in one session — nav (4.118), iQ tab shell + SV Analytics Card (4.119), and the `reasonCategory` taxonomy across extraction/review/manual-entry for Shop Visit and APU (4.120). A live scope correction: `reasonCategory` was initially also built for Operator History, then explicitly pulled per Alan — "we dont need the categories on the operator history at all" — reverted cleanly across all three touched files (`assetHelpers.js`, `extraction.js`, `AssetTabs.jsx`), re-validated with Babel + `node --check` + a runtime TDZ check after the revert. **Deployment incident mid-session** (`TECH_DEBT.md` 4.121): a commit auto-deployed fine, the very next one silently didn't — recurrence of the still-open stale-webhook-class item from the July pre-IT-review session (Section 19, this table). Diagnosed by `git clone`ing the repo directly once GitHub's unauthenticated API rate-limited; first fix attempt (Vercel's Redeploy button) was a wrong turn — it rebuilds the deployment's pinned commit, not the branch's current HEAD — corrected via a trivial commit to retrigger the webhook. Root cause (possible GitHub App repository-access drop, distinct from a classic webhook) still not checked. **Priorities set for next session, Alan's own triage:** Push notifications and EOL Position PDF export both next up; TailiQ Specs and the landing page rewrite explicitly deferred to later (not dropped); Forward Exposure Summary card deprioritised in favour of an existing alternative already in the asset Financials tab — "we are ignoring the fleet exposure for now, we have an alternative in the asset financials." Also corrected in conversation, no doc change needed: favicon wiring was mistakenly raised as an open item — it's already done and was already correctly marked so in this document. Section 19 updated throughout. Files touched: `src/App.jsx`, `src/components/AssetView.jsx`, `src/components/IQView.jsx` (new), `src/components/SVAnalyticsCard.jsx` (new), `src/lib/assetHelpers.js`, `src/lib/extraction.js`, `src/components/AssetTabs.jsx`. See `TECH_DEBT.md` 4.118–4.121 for full technical detail.*

*Last updated: August 2026 — This session (UI Design System rollout — Scenarios, Financials, Lease Wizard, Sonnet build): `TAILIQ_UI_DESIGN_SYSTEM.md` (locked 10 August 2026) re-skinned the app from the old dark-navy theme to a light "technical grey" theme, shipped initially as `styles.css` + body + `Dashboard.jsx` — every other component was left carrying its old inline hex, to be swept file-by-file as each screen came up for review. This session did three of those sweeps, iterating live against real screenshots each round rather than a single blind pass: **Scenarios tab** (`Scenarios.jsx`) — section headers and "Beyond horizon"/timing-shift text were still light-on-dark and unreadable on the new light card background, fixed in two rounds (first pass over-applied the design system's "—"-only divider colour rule to real informational text); the Base Case vs. Scenario comparison chart took three rounds to land on a genuinely distinguishable pairing — colour alone (graphite/teal, then graphite/carbon) kept reading as "two dark grey lines," so the final fix dual-encodes on colour, line weight, and dash pattern together. **Financials tab** (`FlyForward.jsx`) — the larger sweep of the session: pot card headers (the specific "feint pot headings" Alan flagged), status pills, End of Lease Position, Forward Exposure, the top-level warning/summary banners, Record Completed Event + Pending Completions, Maintenance Calendar (including its event-source legend, remapped to three distinct hues so it still reads as a categorical legend), and Seasonality Profile. **Lease Wizard** (`LeaseWizard.jsx`) — all four steps swept; also fixed a real "looks like a bug but isn't" case: the "+ Add Custom Pot" ghost button appeared solid-filled only because its transparent background sat on a leftover dark-navy panel — fixing the panel's background fixed the button with no button-level change needed. All edits validated with the standard Babel + `node --check` pass. **Next up, per Alan:** Asset Details screen. See `TECH_DEBT.md` 4.122 for full technical detail.*

*Last updated: August 2026 — This session (UI Design System rollout — Asset Details screen, completing the app-wide rollout; tech spec PDF merge scoping prompt prepared, Sonnet build + discussion): **Asset Details screen fully swept** (`TECH_DEBT.md` 4.123) — `AssetTabs.jsx` (Overview, Engines + Shop Visit/Operator History editors, Landing Gear, APU) and `PhotosAndSpecs.jsx` (Specs, Avionics, Photos, History, Documents, plus the `SpecsQuickImport` upload panel missed in the first Specs pass) all moved off the old dark-navy theme, confirmed by a full-file hex audit with zero unswept occurrences outside the two documented exemptions. This closes the design system rollout that began with `styles.css`/`Dashboard.jsx` and continued through Scenarios/Financials/Lease Wizard — every screen in the app is now on `TAILIQ_UI_DESIGN_SYSTEM.md`. Iterated live against real screenshots across several distinct rounds of feedback rather than one pass: Status Summary's pill-tint indicators replaced with the design system's actual documented dot+value pattern after the green state read as washed-out; Landing Gear (`GearCard`) went through three full rearrangements — 3-column field grids, a prominence swap (Next Overhaul Due enlarged and bordered, Current Totals shrunk), and a final layout merging Last Overhaul Record + Since Last Overhaul into one shared card, stripping Current Totals' background entirely, and hiding Ground Truth Override outside edit mode; APU went through two rearrangements — equal-height 3-card layout, then identity card split into two explicit columns. A genuine two-round bug, not just a style tweak: the first label-contrast fix applied the design system's literal `1.5px` letter-spacing to small inline labels, which at that size made labels *more* prominent, not less — corrected app-wide to a relative `0.06em` value plus bolder/larger values, conditional on the field actually having data (so empty-state placeholders don't read as falsely emphasised). **Tech spec PDF / design system merge discussed, not built:** with the app-wide sweep complete, the tech spec PDF (`techSpecBuilder.js`) is now the one remaining surface on the old visual language, flagged by Alan as looking off-brand. Direction locked in conversation — brand consistency is the driver, the navy hero stays as a distinct cover/identity page, everything else (including the cover-page snapshot stat-cards and every body page) moves onto the app system. Per `TAILIQ_UI_DESIGN_SYSTEM.md`'s own governance, this is a system change requiring an Opus scoping session, not a direct edit — a scoping prompt (`tech-spec-design-merge-scoping-prompt.md`) was written locking in the agreed decisions as inputs and surfacing five genuinely open questions (page background colour, whether ochre appears at all outside the hero, wkhtmltopdf's CSS-custom-property support given the precedent already set by `<canvas>` needing literal hex, whether the existing grid/flexbox CSS rules are print-path-safe, and whether `share.html` is bundled in). Session not yet run. See `TECH_DEBT.md` 4.124.*
