# VectorIQ — Tech Debt Register
**Started:** June 2026  
**Project:** VectorIQ (formerly FleetIQ / TailIQ / Vector Fleet)  
**Repo:** github.com/alanshorten/vector-fleet  
**Live URL:** alanshorten.github.io/vector-fleet (GitHub Pages) + Vercel  
**Built by:** AI-assisted development (Claude) — noob builder, no traditional engineer

---

## Priority Guide

| Symbol | Level | Meaning |
|--------|-------|---------|
| 🔴 | HIGH | Fix before external clients or financial/lease data is added |
| 🟡 | MEDIUM | Fix before Layer 3 build or before scaling to multiple users |
| 🟢 | LOW | Fix when time allows — cosmetic, minor, or future-state only |
| 📌 | DECISION | Not debt — documented so engineers don't accidentally "fix" it |

---

## 0. Critical Infrastructure Fixes Applied

### 0.1 Babel Standalone Version — Pinned to 7.23.10 ✅ FIXED June 2026
- **Problem:** `@babel/standalone` was loaded unpinned (`/babel.min.js` with no version). A breaking update to Babel standalone caused it to attempt to transform `<script type="module">` blocks — including the Firebase ES module init script — which threw `Cannot use import statement outside a module` and crashed the entire app. The app was completely non-functional for an extended period.
- **Fix applied:** Pinned Babel to `7.23.10` (`@babel/standalone@7.23.10/babel.min.js`). Firebase init script moved to load *before* Babel so it is never in scope for Babel's script scanner.
- **Why this matters:** Unpinned CDN dependencies are a silent risk. Any CDN update can break the app with no code change on our side.
- **Action required:** When upgrading Babel in future, test thoroughly in a branch before merging. Never use unpinned CDN URLs for critical dependencies.
- **Priority:** 📌 DECISION — fix is applied, do not revert to unpinned

---

### 0.2 Engine LLP Upload — Sonnet Hard Parse Failure ✅ FIXED June 2026
- **Problem:** Switching the Engine LLP Sheet extraction model from `claude-haiku-4-5-20251001` to `claude-sonnet-4-6` (made to fix Haiku scrambling rows on the dense 4-section FAN/HPC/HPT/LPT table) caused a hard parse failure on every LLP upload — red banner "The AI could not extract structured data from this file." Not wrong data, total failure.
- **Root cause:** Sonnet returned a worked narrative ("I'll carefully analyze the document...") before the JSON, rather than JSON-only as Haiku had. The existing `api/extract.js` used a fragile regex (`/"type":"text","text":"([\s\S]*?)"\s*\}/`) against the raw Anthropic response text, which is not robust to reasoning-before-answer output and failed to isolate the JSON. Confirmed via temporary debug logging added to `extract.js` (`stop_reason: end_turn`, single content block, valid 200 response — the API call itself was fine; the failure was purely in how the response text was parsed/extracted).
- **Fix applied:** Two changes, both required together:
  1. `extract.js` rewritten to properly `JSON.parse` the Anthropic envelope and read the `.content` array (handles multi-block responses), then look for a fenced ` ```json ... ``` ` block and extract only what's inside it, with a brace-matching fallback if no fence is present (keeps Haiku's existing terse-JSON behaviour working unchanged for utilisation/APU LLP uploads).
  2. The LLP extraction prompt in `index.html` updated to explicitly permit Sonnet to reason through the table first, then mandates the final answer be wrapped in a ` ```json ``` ` fence with nothing else inside it.
- **Why this matters:** Different models can satisfy the same "return only JSON" instruction differently — terser models may comply literally while more capable models may reason first even when told not to. Response-parsing code should not assume a single content block or a JSON-only response; it should be robust to reasoning preludes, since this is likely to recur whenever models are swapped or upgraded for other extraction prompts (APU LLP, utilisation reports) in future.
- **Action required:** If Haiku is ever swapped to Sonnet (or any other model) for the remaining two extraction prompts (APU LLP, utilisation report), consider applying the same "reason then fence" prompt pattern proactively rather than waiting for a hard failure to surface it.
- **Priority:** 📌 DECISION — fix is applied; do not revert `extract.js` to regex-only parsing

---


## 1. Critical Security & Risk — ✅ RESOLVED June 2026

All items in this section were addressed in a dedicated security session (June 2026), prompted by Brain 1 + Brain 2 extraction completing and Layer 2 (financial data) approaching. Kept here with full history rather than deleted, since the "why" and "what we learned" still matter for future sessions.

### 1.1 Firebase Config Exposed Client-Side — ✅ RESOLVED
- **Original concern:** Firebase config object (apiKey, projectId, etc.) lived hardcoded inside `index.html`, visible via page source/DevTools.
- **What we actually learned before fixing it:** This was **not a real secret**. Firebase's web SDK is designed to ship this config to the browser — `apiKey` here just identifies which Firebase project to talk to; it grants no access by itself. The real access-control boundary is Firestore security rules (see 1.2) and Firebase Auth (see 1.3), not hiding this object. Reframing this correctly mattered — it changed the fix from "urgent before any financial data" to "hygiene, do when convenient."
- **Fix applied anyway, for hygiene:** Added `api/config.js` (Vercel serverless function) that reads `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, `FIREBASE_STORAGE_BUCKET`, `FIREBASE_MESSAGING_SENDER_ID`, `FIREBASE_APP_ID` from Vercel env vars and returns them as JSON. `index.html`'s `firebase-init` module script now `fetch('/api/config')` and calls `initializeApp(cfg.firebase)` once that resolves, instead of using a hardcoded object. This keeps the values out of GitHub going forward (existing git history still has them — not rotated, since they aren't real secrets).
- **Note for future sessions:** Because `index.html` is a static file with no build step, this required adding a tiny serverless endpoint rather than a true build-time env var substitution. `initializeApp` now waits on a `fetch`, so Firebase init is asynchronous where it previously wasn't — see new `_configError` / `firebase-config-error` event handling in `App` for the failure-mode UI (shows a "Configuration Error" screen instead of hanging silently if `/api/config` fails).
- **Priority:** 📌 DECISION — fix applied; do not revert to hardcoded config

---

### 1.2 Firebase Security Rules — Development / Permissive Mode — ✅ RESOLVED
- **Original concern:** Firestore rules were in test mode (`allow read, write: if true`) with an auto-expiry of July 12, 2026, after which the app would have locked out everyone, including Alan.
- **Fix applied:** Rules tightened to `allow read, write: if request.auth != null;` — no expiry. Published in Firebase Console and confirmed working (signed in successfully, fleet data loads, before locking the rule in — correct order to avoid self-lockout).
- **What's still open:** This is a real auth gate, but **not yet scoped by `companyId` or role** — it's "any signed-in user can do anything," which is fine for a single-user internal pilot but is not multi-tenant isolation. See 2.3 (companyId on documents) — that and role-based rules are the same piece of remaining work, now correctly understood as one item rather than separate.
- **Priority:** 🟡 MEDIUM (downgraded from 🔴) — scoping by companyId/role needed before a second user or external client, not urgent for current single-user pilot
- **Effort remaining:** 1 session, bundled with Brain 1's `companyId` backfill work (2.3) and role-based Firebase Auth (1.3 follow-up)

---

### 1.3 No Authentication — ✅ RESOLVED (minimal version)
- **Original concern:** No login at all — anyone with the URL had full read/write access.
- **Fix applied:** Firebase Auth (email/password) added. Single user created (Alan). `index.html` now shows a `SignInScreen` component blocking the whole app until `onAuthStateChanged` resolves to a signed-in user; a Sign Out button added to the header. Confirmed working end-to-end.
- **What's still open:** This is a single-user gate, not role-based access. Admin/Editor/Viewer roles (originally scoped here) are still backlog — see Section 5, Infrastructure/Product.
- **Priority:** 🟡 MEDIUM (downgraded from 🔴) — role-based access is the remaining piece, needed before a second user joins, not urgent today
- **Effort remaining:** 1–2 sessions for role-based access on top of the existing single-user auth

---

### 1.4 Cloudinary API Credentials — ✅ RESOLVED
- **Original concern:** Cloudinary `CLOUD_NAME` and `UPLOAD_PRESET` exposed client-side alongside Firebase config.
- **What we learned before fixing it:** Same nuance as 1.1 — these are **not secrets**. An unsigned upload preset is specifically designed to be used client-side without a secret; that's what "unsigned" means. There is no actual Cloudinary API secret anywhere in this codebase.
- **Fix applied anyway, for hygiene:** Folded into the same `api/config.js` endpoint as 1.1 — `CLOUDINARY_CLOUD_NAME` and `CLOUDINARY_UPLOAD_PRESET` now live in Vercel env vars, fetched at load and stashed on `window._cloudinaryConfig`. `uploadToCloudinary()` reads them via `CLOUD_NAME()`/`UPLOAD_PRESET()` (now functions, not constants) with a guard that throws a clear error if called before config has loaded.
- **Priority:** 📌 DECISION — fix applied; do not revert to hardcoded constants
- **Note:** If Cloudinary signed uploads are ever introduced (e.g. to restrict upload abuse), that would involve a real secret (the Cloudinary API secret) and would need a proper signed-URL serverless endpoint — different from what exists today.

---

### 1.5 Anthropic API Key Handling — ✅ CONFIRMED ALREADY SAFE
- **Original concern:** Assumed the Claude API key might be exposed client-side or called directly from the browser.
- **What we found on review:** It already wasn't. `api/extract.js` reads `process.env.ANTHROPIC_API_KEY` server-side and proxies the request — the key has never been in client-side code. No fix was needed here; this item existed on the original list as an assumption that turned out to be wrong.
- **Real issue found instead:** `api/extract.js` had `Access-Control-Allow-Origin: '*'` — meaning *any* website could call this endpoint and burn through the Anthropic API budget, even though the key itself was safe. **Fixed:** locked to `Access-Control-Allow-Origin: 'https://vector-fleet.vercel.app'`.
- **Note for future sessions:** This CORS lock will silently block calls from Vercel preview deployments or any custom domain added later. Revisit the allowed origin if either of those come into play.
- **Priority:** 📌 DECISION — CORS fix applied; do not revert to wildcard origin

---

### 1.6 Abandoned Supabase Projects — ✅ RESOLVED
- **Original concern:** Two Supabase projects (Stockholm `agyjnlecslwcbakahyax`, Frankfurt `jxmzcdthrcsolddldhgqh`) remained live with Edge Functions deployed and JWT verify off.
- **Fix applied:** Both projects decommissioned (June 2026).
- **Priority:** ✅ Done — no longer tracked here, removed from Infrastructure Reference table (Section 7)

---

## 2. Architecture 🟡

### 2.1 Single HTML File Structure
- **Current state:** Entire application lives in one large `index.html` / JSX file. All UI, logic, Firebase calls, and parsing prompts are combined
- **Intended fix:** Migrate to proper component and module structure — either:
  - Clean up within current stack (split into separate JS/JSX files)
  - Full migration to Next.js (recommended when moving to multi-tenant SaaS)
- **Risk if left:** Increasingly painful to maintain as features grow. Hard for any engineer to navigate. Calculation logic cannot be tested independently of UI. Claude sessions become less efficient as the file gets longer
- **Priority:** 🟡 MEDIUM — before Layer 3 build or before any engineer joins
- **Effort:** 2–3 sessions for reorganisation; 3–5 sessions for full Next.js migration

---

### 2.2 Calculation Logic Not Separated From UI (Brain/Body) — ✅ Brains 1 & 2 both done
- **Current state (updated June 2026):** Both Layer 1 brains are now extracted and confirmed. Brain 2 (LLP countdown) — `llpCalculator.js` in `/calculations`, pure functions (`calcLLPRem`, `lowestLimiter`), no UI/Firebase deps, all call sites in `index.html` verified (dashboard, asset detail, tech spec generation, forms). Brain 1 (utilisation report parsing — delta verification, S/N change detection, merge-into-existing-asset logic) — confirmed extracted to `/calculations/utilisation.js` as pure logic, following the same pattern as Brain 2.
  Brains 3–6 (Fly-Forward, Risk Peak, Shortfall, Maintenance Calendar) should be built directly into `/calculations` from day one — no embedded-then-extract step needed.
- **Risk if left:** None remaining for Layer 1 — both brains clean. Future risk is only in not maintaining this discipline for Brains 3–6 during Layer 2 build.
- **Priority:** ✅ Done for Layer 1 — discipline must continue for Layer 2 brains
- **Effort:** Brain 1 — done. Brain 2 — done.

---

### 2.3 No `companyId` on Existing Firestore Documents
- **Current state:** Current Firestore documents do not have a `companyId` (tenant identifier) field — built as single-tenant from the start
- **Intended fix:** Add `companyId` field to all existing and future documents before any multi-tenant features are built. All queries must filter by `companyId`
- **Risk if left:** Multi-tenant expansion requires a full data migration and query rewrite if not addressed early. The longer this is left, the more documents exist without the field
- **Now bundled with:** Firestore rules are auth-gated (1.2, resolved June 2026) but not yet scoped by `companyId`/role — this backfill and the rules-scoping work are effectively one session, not two
- **Priority:** 🟡 MEDIUM — do this before any second organisation is onboarded, even internally
- **Effort:** 1 session — migration script + update all write/read functions + scope Firestore rules by companyId/role together

---

### 2.4 Google Sheets / Google Apps Script Legacy
- **Current state:** App originally used Google Sheets as database via Apps Script. Migration to Firebase completed. Old Google Sheets may still exist with some production data
- **Intended fix:** Confirm all data migrated to Firebase. Archive or delete old Google Sheets. Remove any remaining Apps Script references from codebase
- **Risk if left:** Confusion about source of truth. Potential for someone to update old Sheet thinking it still matters
- **Priority:** 🟡 MEDIUM
- **Effort:** 30 minutes to confirm and archive

---

### 2.5 Dual Hosting (GitHub Pages + Vercel)
- **Current state:** App appears to be deployed on both GitHub Pages (`alanshorten.github.io/vector-fleet`) and Vercel. Unclear if both are live and serving the same version
- **Intended fix:** Pick one as canonical. Vercel is preferred — it supports environment variables, serverless functions, and auto-deploys from GitHub. GitHub Pages does not support any of these. Redirect GitHub Pages URL to Vercel or deprecate it
- **Risk if left:** Confusion about which URL is live. If Firebase config moves to Vercel env vars (1.1), GitHub Pages version will break anyway
- **Priority:** 🟡 MEDIUM — consolidate on Vercel
- **Effort:** 30 minutes

---

## 3. Data & Calculation Logic 🟡

### 3.1 LLP Extrapolation — Linear Only
- **Current state:** When a disk sheet is older than the most recent utilisation report, LLP remaining life is extrapolated forward using a simple cycle delta (disk sheet CSN subtracted from current CSN)
- **Intended fix:** Account for seasonal variation — a disk sheet from February on a summer-seasonal operator should extrapolate using the seasonal profile, not a flat monthly average
- **Risk if left:** Minor inaccuracy for seasonal operators. Acceptable for now but should be refined during Layer 2 build
- **Priority:** 🟡 MEDIUM — refine during Layer 2 build alongside seasonality profile feature
- **Effort:** 1 session once seasonality profiles are built

---

### 3.2 Delta Verification — Edge Cases
- **Current state:** Delta verification checks period FH/FC against the calculated difference between reports. Some edge cases (first report ever uploaded, reports uploaded out of order, gap months) may not be handled gracefully
- **Intended fix:** Harden the delta logic to handle:
  - First report (no previous to compare against)
  - Out-of-order uploads
  - Gap months (missing reports)
  - Component changes mid-period
- **Risk if left:** False positive or false negative validation flags confuse the user
- **Priority:** 🟡 MEDIUM
- **Effort:** 1 session

---

### 3.3 S/N Change Detection — Partial Implementation
- **Current state:** Serial number change detection (engine, APU, landing gear swaps) flags when a component S/N changes between reports. Unclear if all component types are covered and whether the flag persists correctly in Firestore
- **Intended fix:** Verify all component types covered. Ensure change is logged with date and previous/new S/N in Firestore audit trail — not just a UI flag
- **Risk if left:** Component swap not properly recorded could affect LLP tracking accuracy and lease return calculations
- **Priority:** 🟡 MEDIUM
- **Effort:** 1 session to audit and harden

---

## 4. UI / UX 🟢

### 4.1 Admin PIN Protection — Superseded by Firebase Auth ✅
- **Original state:** Admin PIN protection had been removed during development; app was unprotected at the admin level even before the broader no-auth issue (1.3) was resolved.
- **Resolution:** Firebase Auth (1.3) now gates the entire app, including admin functions — superseding the need for a separate PIN layer. The PIN mechanism (`admin_pin` setting, `isAdmin` state) still exists in the code as a secondary UI gate but is no longer the primary protection.
- **Still open:** The PIN code path could be removed entirely now that real auth exists, to avoid two overlapping "admin access" concepts confusing future sessions. Not urgent — harmless to leave as a soft secondary gate for now.
- **Priority:** 🟢 LOW — cleanup/clarity only, not a risk
- **Effort:** 30 minutes to remove if desired

---

### 4.2 Tech Spec Page Break Refinements
- **Current state:** PDF tech spec page breaks are not perfectly optimised — some tables or sections may split awkwardly across pages
- **Intended fix:** Refine CSS page-break rules for print/PDF output
- **Risk if left:** Minor cosmetic issue — tech spec is still functional and professional
- **Priority:** 🟢 LOW
- **Effort:** 1 session

---

### 4.3 Mobile Responsive — Partial
- **Current state:** App has basic mobile responsiveness but was primarily designed for desktop use
- **Intended fix:** Full mobile-first redesign when migrating to Next.js. For now, ensure key views (fleet dashboard, asset detail, tech spec preview) work acceptably on tablet
- **Risk if left:** Poor experience at client meetings on tablet/phone. QR code share links will be opened on mobile — that view must work well
- **Priority:** 🟢 LOW for desktop use; 🟡 MEDIUM once share links and QR codes are built
- **Effort:** 1–2 sessions for targeted mobile improvements

---

### 4.4 Tab Navigation Between Spec Fields — Partial
- **Current state:** `tabIndex={0}` added to spec field inputs but tabbing between fields may still not work reliably due to `defaultValue`/`onBlur` pattern causing re-renders that reset focus
- **Intended fix:** Refactor SpecsTab fields to use controlled local draft state (same pattern as GearCard) so inputs are stable across re-renders and tab focus works naturally
- **Risk if left:** Minor UX friction — fields must be clicked individually rather than tabbed through
- **Priority:** 🟢 LOW
- **Effort:** 30 minutes

---

### 4.5 Tech Spec Specifications Field Order
- **Current state:** Field order in the tech spec Specifications table does not exactly match the order in the app Specs tab
- **Intended fix:** Align tech spec output order to match app UI order (Configuration → Seating Config → Manufacturer → Attendant Seats → Galleys → Lavatories → Cargo Type → toggles → custom fields)
- **Priority:** 🟢 LOW
- **Effort:** 10 minutes

---

## 5. Features Planned But Not Started

These are not debt — they are the backlog. Documented here so an engineer has a complete picture of where the product is going.

### Layer 1 — Enhancements to What Is Built
- [ ] Shareable read-only asset links (tokenised URLs)
- [ ] QR code generation from share links
- [ ] WhatsApp share integration
- [ ] Documents tab — structured links to Google Drive docs per asset
- [ ] Email ingestion — dedicated inbox, airline sends report, auto-processes
- [ ] LLP extrapolation seasonal refinement (see 3.1)

### Layer 2 — Financial Intelligence (Next Major Build)
- [ ] Lease data input UI (manual + parse-and-discard PDF)
- [ ] Reserve rates schema in Firestore per component
- [ ] Seasonality profile configuration per asset
- [ ] Scheduled maintenance events calendar (C-Checks, shop visits)
- [ ] Brain 3: Fly-Forward Engine — core cash flow projection
- [ ] Brain 4: Risk Peak Calculator
- [ ] Brain 5: Shortfall / Surplus Engine
- [ ] Brain 6: Maintenance Calendar Engine
- [ ] Asset-level risk dashboard
- [ ] Fleet-level portfolio snapshot and aggregation
- [ ] Mid-lease asset onboarding wizard

### Layer 3 — Scenario Intelligence (After Layer 2 Proven)
- [ ] Brain 7: Scenario Engine with utilisation/cost/rate sliders
- [ ] Brain 8: Route Suitability Matcher
- [ ] Brain 9: AI Narrative Generator (plain English risk summaries)
- [ ] Portfolio-level stress testing
- [ ] Liquidity cluster visualisation

### Infrastructure / Product
- [x] Firebase Auth — email/password (single user) ✅ done June 2026; role-based access (Admin/Editor/Viewer) still open
- [ ] Multi-tenant companyId implementation (bundled with Firestore rules scoping — see 2.3)
- [x] Vercel environment variables for Firebase/Cloudinary/Anthropic credentials ✅ done June 2026
- [ ] Next.js migration (when scaling to multi-tenant SaaS)
- [ ] SOC 2 compliance (when first enterprise client requires it)
- [ ] Mobile app — React Native (requires human developer)

---

## 6. Deliberate Design Decisions

📌 **These are NOT debt. Document so engineers don't accidentally reverse them.**

### Parse and Discard for Lease PDFs
Lease documents are commercially sensitive — they contain negotiated reserve rates that are proprietary to the lessor. Deliberate decision: PDF is parsed in browser memory only. Extracted figures are shown for user confirmation. PDF is never written to Firebase Storage or any persistent location. Only confirmed figures are saved to Firestore. Do not change this without explicit sign-off.

### companyId on All Firestore Documents
Even though VectorIQ currently operates as single-tenant (one company), every Firestore document must have a `companyId` field. This is intentional future-proofing for multi-tenant SaaS. Do not remove these fields or write queries without `WHERE companyId = x` filters.

### Firebase europe-west2 Region
Deliberate choice for GDPR compliance — data stored in EU. Do not migrate to US regions without reviewing GDPR implications and getting sign-off.

### Firebase Over Supabase
Supabase was used initially but abandoned due to persistent DNS resolution issues with Edge Functions. Firebase is the permanent backend. This was not a temporary decision. Do not attempt to reintroduce Supabase.

### Brain/Body Separation (Calculations vs UI)
All mathematical logic must live in `/calculations` folder as pure functions — input numbers in, output numbers out, no Firebase calls, no UI dependencies. UI components call service layer which calls calculation layer. This is non-negotiable architecture. Do not embed calculations in components.

### VectorIQ Standard Tech Spec Format
The tech spec output format is the VectorIQ standard — it is not configurable per client. This is a deliberate product decision. The goal is for VectorIQ format to become the industry standard for boutique lessors. Do not build per-client format customisation. Company logo and branding are the only permitted customisation. "Generated by VectorIQ" footer must always appear.

### Sub-50 Asset Lessor Focus
VectorIQ is deliberately built for lessors with under 50 assets. Features, UI, and pricing are optimised for this segment. Do not scope features that only make sense for large enterprise lessors (100+ assets, multi-desk teams, CRM pipeline management). Stay focused.

---

## 7. Infrastructure Reference

| Service | Details | Status |
|---------|---------|--------|
| GitHub | `github.com/alanshorten/vector-fleet` | ✅ Active |
| Firebase | Project: `vector-fleet`, Region: europe-west2 | ✅ Active — primary backend |
| Firebase Auth | Email/password, single user (Alan) | ✅ Active — see 1.3 |
| Cloudinary | Connected for photo storage | ✅ Active |
| Vercel | Connected to GitHub, auto-deploys on push | ✅ Active |
| Vercel Env Vars | Firebase config, Cloudinary config, Anthropic key | ✅ Set — see 1.1/1.4/1.5 |
| GitHub Pages | `alanshorten.github.io/vector-fleet` | ⚠️ Consolidate to Vercel (see 2.5) |

---

## 8. Build History Summary

| Phase | Sessions | Cost | Engineer Equivalent |
|-------|----------|------|---------------------|
| Architecture + stack decisions | 2 | ~€10 | €3,000–5,000 |
| Google Sheets → Firebase migration | 3 | ~€15 | €7,000–14,000 |
| AI extraction pipeline | 4 | ~€20 | €14,000–21,000 |
| LLP tracking logic | 2 | ~€10 | €7,000–9,000 |
| Tech spec generator | 2 | ~€10 | €7,000–9,000 |
| UI/UX — dark + white themes | 3 | ~€15 | €7,000–14,000 |
| Photo / Cloudinary integration | 1 | ~€5 | €2,000–3,000 |
| Layer 1 hardening + spec improvements | 3 | ~€15 | €8,000–12,000 |
| Bug fixes + refinements | Ongoing | ~€20 | Ongoing |
| **Total to date** | **~20–23** | **~€120** | **€55,000–87,000** |

---

*This file should be updated at the end of every build session. It is the single most valuable document for any engineer joining the project. Keep it honest.*

*Last reviewed: June 2026 — Section 1 (Critical Security & Risk) fully resolved: Firebase Auth (single user) + tightened Firestore rules (auth-gated, confirmed working) + Anthropic key confirmed already server-side-only + extract.js CORS locked to app domain + Firebase/Cloudinary config moved to Vercel env vars via new api/config.js endpoint + Supabase FM1/FM2 decommissioned. Remaining real work downgraded to 🟡: scope Firestore rules by companyId/role (2.3) before second user or external client. Restored a missing section heading found during this edit (Section 1 title had been dropped in an earlier pass).*
