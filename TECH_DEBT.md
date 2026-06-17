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


- **Current state:** Firebase config object (apiKey, projectId, etc.) lives inside the HTML/JSX file and is visible to anyone who views page source or opens browser DevTools
- **Intended fix:** Move all Firebase config to Vercel environment variables. App reads config server-side via Vercel serverless functions — never exposed in browser
- **Risk if left:** Anyone who finds the config can read/write Firestore data directly, bypassing the app entirely
- **Priority:** 🔴 HIGH — must fix before any lease or financial data is added to Firestore
- **Effort:** ~2–3 hours, one session

---

### 1.2 Firebase Security Rules — Development / Permissive Mode
- **Current state:** Firestore security rules are likely in open/test mode from development — reads and writes are broadly permitted
- **Intended fix:** Tighten rules so that:
  - All reads/writes require authentication (when auth is added)
  - Data is scoped strictly by `companyId` — no cross-tenant access possible
  - Financial/lease collections have stricter rules than utilisation data
- **Risk if left:** Any authenticated user (or unauthenticated user if rules are fully open) could read any company's data
- **Priority:** 🔴 HIGH — before external clients
- **Effort:** 1 session with Firebase Rules documentation

---

### 1.3 No Authentication
- **Current state:** App has no login — anyone with the URL can access all fleet data and make changes
- **Intended fix:** Firebase Auth — email/password minimum. Eventually role-based (Admin / Editor / Viewer)
- **Risk if left:** No access control, no audit trail of who did what, unsuitable for external clients or sensitive financial data
- **Priority:** 🔴 HIGH — before external clients
- **Note:** 📌 Deliberately deferred during internal pilot phase (June–Sept 2026) to avoid friction during development and testing. This is a known, accepted risk for the pilot period only.
- **Effort:** 1–2 sessions

---

### 1.4 Cloudinary API Credentials
- **Current state:** Cloudinary cloud name and any API keys may be exposed client-side alongside Firebase config
- **Intended fix:** Move to server-side environment variables on Vercel. Signed upload URLs generated server-side so credentials never reach the browser
- **Risk if left:** Cloudinary account could be abused for unauthorised storage uploads
- **Priority:** 🔴 HIGH — alongside Firebase config move
- **Effort:** Included in same session as 1.1

---

### 1.5 Anthropic API Key Handling
- **Current state:** Claude API calls for document parsing likely made client-side or via an exposed key
- **Intended fix:** All Anthropic API calls should go through a Vercel serverless function. Key stored as Vercel environment variable, never reaches browser
- **Risk if left:** API key visible in network requests — could be used to run API calls at your cost
- **Priority:** 🔴 HIGH — before any external users
- **Effort:** 1 session

---

### 1.6 Abandoned Supabase Projects
- **Current state:** Two Supabase projects remain live (Stockholm and Frankfurt) with Edge Functions deployed and JWT verify set to OFF. Both were abandoned in favour of Firebase but have not been formally decommissioned
- **Intended fix:** Log into Supabase console and pause or delete both projects. Remove any Supabase references remaining in codebase
- **Risk if left:** Open endpoints with JWT verify off pose a minor but unnecessary security exposure. Also costs mental overhead if someone joins the project and wonders what they're for
- **Priority:** 🔴 HIGH — clean up, low effort
- **Effort:** 30 minutes

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

### 2.2 Calculation Logic Not Separated From UI (Brain/Body)
- **Current state (updated June 2026):** Brain 2 (LLP countdown) is **extracted and confirmed** — `llpCalculator.js` in `/calculations` contains pure functions (`calcLLPRem`, `lowestLimiter`), no UI or Firebase dependencies, exposed via `window.*` for the no-bundler setup. Verified all call sites in `index.html` (dashboard, asset detail, tech spec HTML generation, forms — 12+ usages) call the extracted functions; no inline duplicate of the maths remains anywhere in the UI file.
  Brain 1 (utilisation report parsing — delta verification, S/N change detection, merge-into-existing-asset logic) is **still embedded in the UI** and is a larger, riskier extraction: it's tangled with Firebase writes and component state in the core upload flow, not a standalone calculation.
- **Intended fix (remaining):** Extract Brain 1 into `utilisation.js` in `/calculations`, following the same pure-function pattern used for Brain 2. Treat as its own dedicated session with proper testing afterward — do not bundle into other build work given the risk of breaking the core upload flow.
  Brains 3–6 (Fly-Forward, Risk Peak, Shortfall, Maintenance Calendar) should be built directly into `/calculations` from day one — no embedded-then-extract step needed.
- **Risk if left (Brain 1 only):** Cannot change utilisation parsing/merge logic without risk of breaking UI. Cannot test in isolation. Less urgent than originally scoped now that Brain 2 is done and Brains 3–6 will be built clean from the start — but should still happen before Layer 2 work depends heavily on utilisation data feeding Brain 3.
- **Priority:** 🟡 MEDIUM — Brain 1 extraction only; do before Layer 2 build depends heavily on it, but not blocking immediately
- **Effort:** Brain 2 — done. Brain 1 — 1 dedicated session with testing.

---

### 2.3 No `companyId` on Existing Firestore Documents
- **Current state:** Current Firestore documents do not have a `companyId` (tenant identifier) field — built as single-tenant from the start
- **Intended fix:** Add `companyId` field to all existing and future documents before any multi-tenant features are built. All queries must filter by `companyId`
- **Risk if left:** Multi-tenant expansion requires a full data migration and query rewrite if not addressed early. The longer this is left, the more documents exist without the field
- **Priority:** 🟡 MEDIUM — do this before any second organisation is onboarded, even internally
- **Effort:** 1 session — migration script + update all write/read functions

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

### 4.1 Admin PIN Protection Removed
- **Current state:** Admin PIN protection was removed during development to avoid friction during testing and redeployment. App is currently unprotected
- **Intended fix:** Reinstate PIN as minimum protection for admin functions, or replace entirely with Firebase Auth (recommended — see 1.3)
- **Risk if left:** No protection on admin functions (rate changes, data deletion, settings)
- **Priority:** 🟢 LOW for now — will be superseded by proper Firebase Auth (1.3)
- **Effort:** 30 minutes for PIN; 1–2 sessions for Firebase Auth

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
- [ ] Firebase Auth — email/password + role-based access (Admin/Editor/Viewer)
- [ ] Multi-tenant companyId implementation
- [ ] Vercel environment variables for all credentials
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
| Cloudinary | Connected for photo storage | ✅ Active |
| Vercel | Connected to GitHub, auto-deploys on push | ✅ Active |
| GitHub Pages | `alanshorten.github.io/vector-fleet` | ⚠️ Consolidate to Vercel |
| Supabase FM1 | `agyjnlecslwcbakahyax.supabase.co` Stockholm | 🔴 Decommission |
| Supabase FM2 | `jxmzcdthrcsolddldhgqh.supabase.co` Frankfurt | 🔴 Decommission |

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

*Last reviewed: June 2026 — added Section 0.2 (Sonnet LLP parsing fix), updated 2.2 (Brain 2 extraction confirmed complete, Brain 1 scope clarified), removed stale Excel upload / error message entries (confirmed non-issues on review)*
