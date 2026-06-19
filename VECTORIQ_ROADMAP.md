# VectorIQ — Master Roadmap & Reference Document
**Created:** June 2026  
**Author:** Alan Shorten  
**Built with:** Claude (Anthropic) — AI-assisted development  
**Status:** Active internal tool, Layer 1 stable, Layer 2 in planning  

---

## 1. Product Overview

### What VectorIQ Is
An AI-powered financial intelligence platform for boutique aircraft lessors. It connects three data sources that currently live in silos — utilisation reports, LLP disk sheets, and lease financial data — into a single predictive dashboard that surfaces liquidity risk before it becomes a crisis.

### The Core Problem It Solves
Lessors with under 50 assets are drowning in Excel. They can tell you what's in their reserve account today. They cannot tell you whether that account will have enough cash when the engine actually needs its shop visit — especially if the airline starts flying harder next quarter. VectorIQ answers that question automatically.

### Product Name History
Vector Fleet → FleetIQ → TailIQ → **VectorIQ** (final)

### Target Market
Boutique aircraft lessors with under 50 assets — the sweet spot where spreadsheets are breaking but enterprise ERPs (Fly Forward, LeaseWorks, Sysco) are too expensive and too complex.

### Competitive Position
```
Excel / Spreadsheets     VectorIQ          Fly Forward / LeaseWorks
      €0              €199–699/month        €130k–350k year one
  (the pain)         (the sweet spot)         (enterprise)
```

**Key differentiator:** VectorIQ is the only tool in this market that starts from automated utilisation data ingestion and builds financial intelligence on top. Every competitor requires manual data entry or expensive implementation. VectorIQ processes a monthly report in seconds and updates the entire fleet picture automatically.

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
- Tech spec PDF generation per asset
- Photo management via Cloudinary
- Vercel hosting, auto-deploys from GitHub

### Tech Stack
| Layer | Technology |
|-------|-----------|
| Frontend | Single-page HTML/CSS/JS (index.html) |
| Database | Firebase Firestore (europe-west2) |
| Photo Storage | Cloudinary |
| AI Parsing | Claude API (Anthropic) |
| Hosting | Vercel + GitHub Pages (consolidate to Vercel) |

### Key Services
| Service | Details | Status |
|---------|---------|--------|
| GitHub | `github.com/alanshorten/vector-fleet` | ✅ Active |
| Firebase | Project: `vector-fleet`, europe-west2 | ✅ Active |
| Cloudinary | Photo storage | ✅ Active |
| Vercel | Hosting, auto-deploy | ✅ Active |
| GitHub Pages | `alanshorten.github.io/vector-fleet` | ⚠️ Consolidate to Vercel |
| Supabase FM1 | Stockholm — decommissioned | ✅ Done (June 2026) |
| Supabase FM2 | Frankfurt — decommissioned | ✅ Done (June 2026) |

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

### Layer 3 — What If / What's Best (After Layer 2 Proven)
Scenario sliders, route suitability matcher, AI narrative summaries, portfolio stress testing.

---

## 4. The Nine Calculation Brains

All calculation logic lives in `/calculations` folder as pure functions — no UI, no Firebase calls. This is non-negotiable architecture (Brain/Body separation).

### Layer 1 Brains
| Brain | File | Purpose | Status |
|-------|------|---------|--------|
| Brain 1 | `utilisation.js` | Parse reports, validate deltas, detect anomalies | ✅ Extracted — pure logic moved to `/calculations/utilisation.js` |
| Brain 2 | `llpCalculator.js` | Track remaining life, extrapolate from old disk sheets | ✅ Extracted — pure function in `/calculations/llpCalculator.js`, no UI/Firebase deps, all call sites in index.html confirmed using `window.calcLLPRem`/`window.lowestLimiter` |

### Layer 2 Brains
| Brain | File | Purpose | Status |
|-------|------|---------|--------|
| Brain 3 | `flyForward.js` | Core cash flow projection — most critical | 🔨 Build first |
| Brain 4 | `riskPeak.js` | Identify when liability exceeds balance | 🔨 Build second |
| Brain 5 | `shortfall.js` | Quantify the gap, track reserve drift | 🔨 Build third |
| Brain 6 | `maintenanceCal.js` | Schedule events, account for downtime in projections | 🔨 Build fourth |

### Layer 3 Brains
| Brain | File | Purpose | Status |
|-------|------|---------|--------|
| Brain 7 | `scenarioEngine.js` | Apply user variables to Brains 3–6 | ⏳ Layer 3 |
| Brain 8 | `routeMatcher.js` | Score fleet suitability for proposed flying | ⏳ Layer 3 |
| Brain 9 | `narrativeGen.js` | Plain English AI summaries of risk outputs | ⏳ Layer 3 |

### Brain 3 — Fly-Forward Engine (Core Formula)
```javascript
Shortfall = Projected Cost - (Current Balance + Future Accruals)

Where:
  Future Accruals = ratePerCycle × projectedCycles × remainingMonths
  Projected Cost  = estimatedShopVisitCost × (1 + escalationIndex)
  Risk Peak Date  = date where Liability > Cash Balance
```

### Brain 3 Inputs (confirmed)
- Current reserve balance per component
- Rate per cycle / rate per flight hour (from lease data)
- Monthly average cycles (from utilisation history)
- Remaining LLP life (from Brain 2)
- Projected shop visit cost (user defined)
- Escalation index and base year
- Seasonality profile (monthly weightings)
- Scheduled maintenance events (C-Checks, shop visits)

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
        
        [LAYER 2 — BUILDING]
        leaseData/
          {leaseId}
            - leaseStart, leaseEnd, airline
            - inputMethod (manual/parsed)
            - confirmedBy, confirmedAt

        reserveRates/
          {rateId}
            - component (engine1/engine2/airframe/lg/apu)
            - ratePerCycle, ratePerHour
            - escalationIndex, escalationBaseYear
            - effectiveFrom
            - confirmedBy, confirmedAt

        reserveBalances/
          {balanceId}
            - component, currentBalance
            - asOfDate, inputMethod
            - confirmedBy

        shopVisitProjections/
          {projectionId}
            - component, projectedDate
            - projectedCost, confidence
            - calculatedAt
            (history preserved — never overwrite, always new document)

        scheduledEvents/
          {eventId}
            - type (C-Check/LG/Engine/APU)
            - scheduledDate, durationWeeks
            - estimatedCost, affectsUtilisation

        seasonalityProfile/
          {profileId}
            - activeWeeksPerYear
            - monthlyWeightings (Jan–Dec percentages)
            - patternDetected (true/false)
            - confirmedAt

        riskProfile/
          {profileId}
            - calculatedAt, riskPeakDate
            - projectedShortfall, confidenceLevel
            - triggeringComponent
            - status (green/amber/red)

        [LAYER 3 — FUTURE]
        scenarios/
          {scenarioId}

    [FLEET LEVEL]
    fleetSnapshots/
      {snapshotId}
        - calculatedAt, totalAssets
        - totalReserveBalance, totalProjectedLiability
        - netPosition, riskPeaksByQuarter
        - liquidityClusters, assetsInRedZone[]
        - assetsInAmberZone[], portfolioHealthScore

    fleetScenarios/
      {scenarioId}
```

### Critical Schema Rules
- **Every document must have `companyId`** — non-negotiable, do not remove
- **`confirmedBy` and `confirmedAt` on all financial inputs** — audit trail
- **`shopVisitProjections` always creates new document** — never overwrites, preserves history
- **`inputMethod` field on all financial data** — tracks manual vs parsed

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
- ✅ Firebase Auth (email/password) live — single user (Alan), gates the whole app via sign-in screen
- ✅ Firestore security rules tightened — `allow read, write: if request.auth != null;` (no expiry, replaces old 30-day test-mode rule)
- ✅ Anthropic API key confirmed server-side only (`process.env.ANTHROPIC_API_KEY` in `api/extract.js`) — never touches client
- ✅ `api/extract.js` CORS locked to `https://vector-fleet.vercel.app` (was wildcard `*`)
- ⚠️ Firestore rules are auth-gated but **not yet scoped by companyId/role** — fine for single-user internal pilot, real gap once a second user or external client exists
- Firebase config (`firebaseConfig` object) and Cloudinary `CLOUD_NAME`/`UPLOAD_PRESET` still hardcoded client-side in `index.html` — **lower priority than originally framed**: these are designed by Firebase/Cloudinary to be public-facing client values, not true secrets like the Anthropic key. Moving to env vars is a hygiene improvement (cleaner GitHub history, easier rotation), not a security fix.

### Required Before Financial Data / External Users
1. Scope Firestore rules by `companyId` and role once multi-tenancy/roles are built (see Role Structure below) — current rule is a single-user gate, not multi-tenant isolation
2. Firebase Auth — extend from single user to role-based access (Admin/Editor/Viewer)

### Role Structure
| Role | Access |
|------|--------|
| Admin | Full access including lease/financial data, user management |
| Editor | Upload reports, edit asset data, view financials |
| Viewer | Read-only, no financial data visible |

### Data Privacy Principles
- EU data residency — Firebase europe-west2 (GDPR compliant)
- Lease PDFs never stored — parse and discard only
- Only confirmed figures written to Firestore
- Full audit trail — confirmedBy/confirmedAt on all financial inputs
- companyId isolation — cross-tenant data access physically impossible via security rules
- SOC 2 — pursue when first enterprise client requires it

---

## 8. Lease Data Input — Two Path Approach

### Path 1 — PDF Upload (Parse and Discard)
```
Upload Lease PDF
      ↓
Claude parses in browser memory
      ↓
Draft figures shown to user for review
      ↓
User confirms each figure
      ↓
Only confirmed figures saved to Firestore
PDF immediately discarded — never persists
```

### Path 2 — Manual Entry
```
User types figures directly
      ↓
AI validates as typed (anomaly detection,
benchmark comparison, sanity checks)
      ↓
User confirms and saves
      ↓
Figures written to Firestore with audit trail
```

### Why This Approach
Lease rates are commercially sensitive. Lessors are protective of their negotiated positions. By never storing the lease document and only saving confirmed figures, VectorIQ can honestly say: "We never store your lease documents. We never see your rates. Only what you explicitly confirm ever touches our database."

---

## 9. Mid-Lease Asset Onboarding

### The Clean Break Principle
The app does not need historical data to forecast forward. It only needs current state.

### Step 0 — Incoming Tech Spec Import (Optional)
Upload the outgoing lessor's tech spec PDF before beginning manual entry. Claude extracts available static fields and pre-populates the onboarding form for review.

**What can be extracted:** MSN, registration, model, DOM, operating weights, configuration, seating, avionics toggles, engine/APU S/Ns, check history dates, LLP data if present in the spec.

**What cannot be extracted:** Reserve balances, lease rates, current utilisation — those are never in a tech spec. Utilisation report and LLP disk sheet still required for live technical data. This is a setup accelerator, not a data replacement.

**Principles:**
- Parse and discard — same principle as lease PDFs, never stored
- User confirms each field before anything is written to Firestore
- Confidence varies — third-party specs differ wildly in format and completeness
- Extraction failures are non-fatal — any field Claude can't read stays blank for manual entry

### Onboarding Wizard Steps
```
Step 1: Basic Details
  Lease start/end date, airline, migration date (auto = today)

Step 2: Opening Balances (as of migration date)
  Reserve balance per component — manually entered, confirmed

Step 3: Current Utilisation State
  Upload most recent utilisation report → sets baseline TSN/CSN

Step 4: LLP Stack Status
  Upload most recent disk sheet (even if months old)
  App auto-adjusts forward using utilisation delta from Step 3
  Flags: "Extrapolated forward X FC based on utilisation data"

Step 5: Optional Bulk Import
  Excel/CSV template for static data
  Or skip and enter manually

Step 6: Confirm & Activate
  "TailIQ active from [migration date]"
  "Pre-migration data managed externally"
```

### UI Marker
```
─── Pre-VectorIQ data (managed externally) ───
         [Upload Legacy PDF for reference — optional]
═══ VectorIQ active from 15 June 2026 ══════════
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

## 11. Route Suitability Matcher (Layer 3)

When an airline proposes new flying, VectorIQ scores every asset in the fleet across five dimensions:

1. **LLP Headroom** — does any LLP expire during the proposed window?
2. **Reserve Impact** — does additional flying accelerate a risk peak into this window?
3. **Maintenance Conflicts** — is there a C-Check or shop visit during these months?
4. **Current Utilisation Headroom** — is the asset already flying hard?
5. **Reserve Rate Alignment** — is the contractual rate adequate for this intensity?

Output: ranked fleet with score, plain English reasoning, and recommendation per asset.

---

## 12. Sharing, QR Codes & Email Ingestion

### Share Token System
```
Asset selected for sharing
      ↓
Unique token generated and stored in Firestore
      ↓
URL: vectoriq.app/share/{token}
      ↓
Three tiers of share view:
  Tech Spec Share — asset details, LLP status, photos (no financials)
  Portfolio Share — fleet overview, health scores (no financials)
  Full Asset Share — everything including Fly-Forward (trusted parties only)
```

### QR Code
- Generated from share URL — one line of JavaScript
- Printed on tech spec footer → recipient scans → live asset view
- Displayed in app for instant sharing at meetings
- Passive marketing — every scanned QR is a VectorIQ product experience

### Email Ingestion — Option A + C
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

---

## 13. Tech Spec Format

### VectorIQ Standard (Non-Negotiable)
The tech spec output is the VectorIQ standard format. It is not configurable per client. The goal is for VectorIQ format to become the de facto standard for boutique lessors.

### Permitted Customisation
- Company logo in header ✅
- Company name and contact details ✅
- "Generated by VectorIQ" footer — always present, not removable ✅
- Everything else — fixed ✅

### The Flywheel Effect
Every tech spec sent = VectorIQ brand impression on recipient (buyer, bank, broker, MRO, incoming lessor). In a relationship-driven market, passive brand exposure at every transaction is the go-to-market strategy.

---

## 14. Multi-Tenancy

### companyId Everywhere
Every Firestore document has `companyId`. Every query filters by `companyId`. Security rules make cross-tenant access physically impossible.

### Adding A Second Organisation
1. Create Firebase Auth account for new organisation
2. Assign `companyId`
3. They log in to empty, isolated portfolio
4. They onboard their own assets
5. No code changes required

### Future Architecture (When Needed)
Current: Shared Firebase project, data separated by companyId (simple, sufficient for early clients)
Future: Schema-per-tenant or database-per-tenant (when enterprise client demands full isolation)

---

## 15. Pricing Model

### Tier Structure
| Tier | Assets | Price/Month |
|------|--------|-------------|
| Starter | Up to 10 | €199 |
| Growth | Up to 25 | €399 |
| Portfolio | Up to 50 | €699 |
| Enterprise | 50+ | Custom |

### Pricing Principles
- Per-asset not per-seat — scales with fleet size, not headcount
- Public and transparent — differentiator vs Fly Forward (no public pricing)
- Self-serve onboarding — no implementation fee, no consultants
- Value case: not time saved, but risk intelligence that didn't exist before

### The Value Reframe
"VectorIQ doesn't save you time — it gives you information your Excel was never capable of producing. What is it worth to know about a €500,000 reserve shortfall 6 months before it becomes a crisis?"

### ISTAT Dublin 2027 — Founding Member Programme
```
First 10 external clients only:
  ✅ Full VectorIQ access
  ✅ All layers as built
  ✅ Direct roadmap input
  ✅ Founding rate locked forever: €299/month (any portfolio size)
  ✅ Logo on VectorIQ website
```

---

## 16. Competitive Landscape

### Key Competitors
| Product | Target | Price | Differentiator |
|---------|--------|-------|---------------|
| Fly Forward (Lease Logic/Zeevo) | All lessors | €130k–350k yr 1 | Full platform — CRM, deals, invoicing, finance |
| LeaseWorks Aeris Asset | Large lessors | Enterprise | Comprehensive, Salesforce-based |
| Sysco Lease Manager | Large lessors | Enterprise | Microsoft Dynamics-based |
| flydocs | All lessors | Enterprise | Records management focus |
| Excel | Everyone | €0 | The incumbent — fragile, manual, no intelligence |

### VectorIQ Advantage
- Automated ingestion — unique in market at this price point
- Utilisation-first — builds financial intelligence from technical data up
- Self-serve — no implementation, no consultants
- Focused — does 3 things brilliantly vs Fly Forward doing 20 things adequately
- Affordable — obvious choice for sub-50 asset lessors priced out of enterprise

### Fly Forward Specifically
Launched ISTAT Americas 2025. First client (Aviator Capital) live Oct 2025. AI assistant "Ask Roger" launched ISTAT Americas 2026. SOC 2 audited. Distributed by Zeevo consulting — every sale is a consultative engagement. No public pricing. Not self-serve. Targets all lessor sizes including enterprise.

---

## 17. Build Roadmap

### Immediate Priority — Security Pass (1 Session) — ✅ COMPLETE (June 2026)
- [x] Firebase Auth (email/password) added — single user, gates whole app via sign-in screen
- [x] Tighten Firestore security rules — `if request.auth != null;`, no expiry — published and confirmed working
- [x] Confirmed Anthropic API key already server-side only — no change needed
- [x] Locked `api/extract.js` CORS to `https://vector-fleet.vercel.app` (was wildcard)
- [x] Moved Firebase config to Vercel environment variables (via `api/config.js` fetch — see Section 7 note on why this was hygiene, not a real fix)
- [x] Moved Cloudinary credentials to Vercel environment variables (same mechanism)
- [x] Decommission Supabase FM1 and FM2 — done
- [ ] Consolidate hosting to Vercel only (GitHub Pages still listed as ⚠️ in Section 2 — separate from Supabase)

### Layer 1 Hardening (Current Focus)
- [x] Fix Excel upload parsing (SheetJS → text → Claude) — confirmed non-issue on review (June 2026), stale entry
- [x] Add user-friendly error messages (no raw JSON errors) — confirmed non-issue on review (June 2026), stale entry
- [x] Extract Brain 2 (`llpCalculator.js`) to `/calculations` — done, pure function, no UI/Firebase deps
- [x] Extract Brain 1 (`utilisation.js`) to `/calculations` — done
- [ ] Add companyId to all existing Firestore documents
- [ ] Harden delta verification edge cases
- [ ] Verify S/N change detection across all component types
- [ ] LLP extrapolation seasonal refinement

### Layer 1 Features (Near Term)
- [ ] Shareable read-only asset links (tokenised)
- [ ] QR code generation
- [ ] WhatsApp share integration
- [ ] Documents tab (Google Drive links per asset)
- [ ] Email ingestion — single company first
- [ ] Incoming tech spec parser — onboarding accelerator (Step 0, parse and discard)

### Layer 2 — Financial Intelligence
- [ ] Lease data input UI (manual + parse and discard)
- [ ] Reserve rates Firestore schema
- [ ] Seasonality profile configuration
- [ ] Scheduled events calendar
- [ ] Mid-lease onboarding wizard
- [ ] Brain 3: Fly-Forward Engine ← START HERE
- [ ] Brain 4: Risk Peak Calculator
- [ ] Brain 5: Shortfall Engine
- [ ] Brain 6: Maintenance Calendar Engine
- [ ] Asset risk dashboard
- [ ] Fleet snapshot and aggregation
- [ ] Lease rate categories — confirm from actual leases ⏳

### Layer 3 — Scenario Intelligence
- [ ] Brain 7: Scenario Engine + slider UI
- [ ] Brain 8: Route Suitability Matcher
- [ ] Brain 9: AI Narrative Generator
- [ ] Portfolio stress testing
- [ ] Liquidity cluster visualisation

### Infrastructure / Product
- [ ] Firebase Auth (email/password + roles)
- [ ] Multi-tenant companyId implementation
- [ ] Next.js migration (when scaling to SaaS)
- [ ] SOC 2 (when enterprise client requires it)
- [ ] Mobile app — React Native (requires human developer)

### Timeline
| Phase | Target | Goal |
|-------|--------|------|
| Now — Sept 2026 | Internal pilot | Prove value, document ROI, harden Layer 1 |
| Oct — Dec 2026 | Layer 2 build | Financial intelligence live internally |
| Jan 2027 | ISTAT Dublin | Founding member programme launch |
| Q1–Q2 2027 | First 10 external clients | Onboard founding members |
| Q3 2027 | Public launch | Self-serve, transparent pricing |

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
| VectorIQ standard tech spec | Product decision — not per-client customisable |
| Sub-50 asset focus | Stay focused — do not scope enterprise features |
| Per-asset pricing not per-seat | Scales with fleet value not headcount |
| Public pricing | Differentiator vs enterprise competitors — stay transparent |
| Option A + C email ingestion | Maximum flexibility — airlines change nothing, lessors choose their approach |

---

## 19. Outstanding Items

| Item | Owner | Priority |
|------|-------|----------|
| Confirm lease rate categories from actual leases | Alan | 🔴 Before Brain 3 build |
| Scope Firestore rules by companyId + roles | Build session | 🟡 Before multi-tenant/external users |

---

*This document is the single source of truth for VectorIQ product decisions, architecture, and roadmap. Update it when significant decisions are made. Reference it at the start of every build session to maintain continuity.*

*Last updated: June 2026 — added incoming tech spec parser (Section 9 + Section 17)*
