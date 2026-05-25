# PHASE_2_DESIGN_META-ORCH-0972_SCREEN_INVENTORY

**ORCH:** META-ORCH-0972 — Phase 2 design deliverable
**Date:** 2026-05-25
**Companion to:** [PHASE_2_DESIGN_META-ORCH-0972_USER_JOURNEYS.md](./PHASE_2_DESIGN_META-ORCH-0972_USER_JOURNEYS.md)

Flat list of every screen / sheet / modal / route touched by META-ORCH-0972. Each row: current state (1 sentence) | new state (1 sentence) | files affected (cross-ref Phase 1 audit Dimension) | per-platform parity. Use this as the input scope for Phase 3 spec.

---

## Business app — Brand creation + edit

| Screen | Current state | New state | Files (D-N) | iOS-business | Android-business | business-web-preview |
|---|---|---|---|---|---|---|
| `BrandSwitcherSheet` (persona-fork mode) | 3-card persona picker (place/event/trip) routes to one of 3 different create paths | DELETED; replaced by unified `BrandCreationFlow` triggered from "Create brand" CTA | D1: BrandSwitcherSheet.tsx (rewrite), PersonaPickerCards.tsx (delete), PersonaForkSheet.tsx (delete) | YES | YES | YES |
| `TripBrandWizard` (4-step trip-planner setup) | Trip-planner-only brand creation (name → bio → cover → Stripe routing) | DELETED; behavior folded into `BrandCreationFlow` Step 1+3 + deferred Stripe per Q1 | D1: TripBrandWizard.tsx (delete), TripBrandWizard.test.ts (delete) | YES | YES | YES |
| `BrandCreationFlow` (NEW) | Doesn't exist | 4-step unified brand creation: Identity → Address (optional) → Cover (optional) → Welcome-with-chooser | D1 NEW component | YES | YES | YES |
| `BrandEditView` SECTION B-2 kind picker (lines 568–664) | Pop-up / Physical toggle pills, address conditional on kind=physical | DELETED entire section; address becomes always-visible always-optional input | D2: BrandEditView.tsx lines 541–664 + styles block | YES | YES | YES |
| `BrandEditView` address input | Visible only when `draft.kind === "physical"` | Always visible, always optional | D2/D4: BrandEditView.tsx line 628 | YES | YES | YES |
| `BrandEditView` "Claim a venue" affordance (NEW) | Doesn't exist | New section at top of BrandEditView: title + body + CTA → opens venue search flow | Design Area 7 NEW | YES | YES | YES |
| `VenueClaimStatusBanner` | Hidden for non-physical brands (kind gate at line 28) | Shown for any brand with `claim_status !== 'none'`; 3 copy variants (pending/verified/rejected) | D10: VenueClaimStatusBanner.tsx line 28, venueClaimBannerLogic.ts line 25 | YES | YES | YES |
| Venue search flow (Google Places match) | Entered only via "A place" persona at creation | Entered via Brand Edit "Claim a venue" affordance any time; no kind side-effect | Design Area 7 | YES | YES | YES |

---

## Business app — Home dashboard

| Screen | Current state | New state | Files (D-N) | iOS-business | Android-business | business-web-preview |
|---|---|---|---|---|---|---|
| Home empty state (rung 2) | Single CTA "Plan a trip" or "Create event" branched on kind | `<OfferingChooser>` 3-button chooser (Event / Trip / Experience) | D5: (tabs)/home.tsx empty-state block, homeNextAction.ts lines 60–90 | YES | YES | YES |
| Home rung 1 (Stripe inactive) | Always fires when Stripe not active (unconditional blocker) | Demoted to upsell; only fires when brand has drafted paid offering AND Stripe not active | D5/Q1: homeNextAction.ts lines 33–60 | YES | YES | YES |
| Home rung 4 (physical-no-address) | Fires when `kind === 'physical' && address empty` | DELETED entirely | D5: homeNextAction.ts lines 112–123 | YES | YES | YES |
| Home rung 3 (finish draft) | Fires when drafts > 0, live = 0 | UNCHANGED | D5: homeNextAction.ts lines 91–110 | YES | YES | YES |
| Home live KPI hero + scan-QR (ORCH-0965) | UNCHANGED; tri-kind upcoming list already universal | UNCHANGED | n/a | YES | YES | YES |

---

## Business app — Hub tabs

| Screen | Current state | New state | Files (D-N) | iOS-business | Android-business | business-web-preview |
|---|---|---|---|---|---|---|
| `hub/_layout.tsx` tab bar | Static 3-tab shell (Events / Trips / Experiences) always rendered | Data-driven; renders only tabs with `count > 0`; placeholder "Get started" tab when all empty | D6: (tabs)/hub/_layout.tsx (rewrite tab bar) | YES | YES | YES |
| `hub/events.tsx` | Standard events list; no kind gate today | UNCHANGED body; visibility now data-driven | D6: events.tsx unchanged | YES | YES | YES |
| `hub/trips.tsx` empty state | Renders "Trips are for trip-planner brands" if `currentBrand.kind !== "trip_planner"` | DELETE hard gate; tab visible only if `trips.count > 0`; body unchanged otherwise | D6: trips.tsx line 161 | YES | YES | YES |
| `hub/experiences.tsx` 5 kind gates (lines 292, 307, 319, 331, 345) | Heavy kind-branched logic gates snap inputs + dead-ends non-physical | All 5 gates DELETED or REGATED to `venueCategory`/feature flags; tab visible only if `experiences.count > 0`; universal "Create experience" + snap-input shortcuts always available | D6/D8: experiences.tsx lines 292/307/319/331/345 | YES | YES | YES |
| Hub "Get started" tab body (NEW) | Doesn't exist | Single tab when all 3 buckets empty; renders `<OfferingChooser>` with headline "Get started — pick what to create" | Design Area 4 NEW | YES | YES | YES |
| Hub tab loading state | No specific loading state for tab visibility (tabs render synchronously) | Shimmer placeholder pills while `useBrandOfferingCounts` resolves; prevents flash-of-wrong-tabs | Design Area 4 NEW | YES | YES | YES |

---

## Business app — Offering creation flows

| Screen | Current state | New state | Files (D-N) | iOS-business | Android-business | business-web-preview |
|---|---|---|---|---|---|---|
| `trip/create.tsx` entry | `if (currentBrand.kind !== "trip_planner") setErrorMessage; return;` (line 52) | DELETE the gate; any brand can author trips | D7: trip/create.tsx line 52 + line 9 doc comment | YES | YES | YES |
| `trip/[id]/edit.tsx` migration effect | `if (currentBrand.kind !== "trip_planner") return;` early-return inside client-only-trip-ID migration useEffect (line 67) | DELETE early-return; migration runs for any brand | D7 (Codex G1): trip/[id]/edit.tsx line 67 | YES | YES | YES |
| `event/create*.tsx` | No kind gate; already universal | UNCHANGED | D7 | YES | YES | YES |
| Experience creation flow (NEW) | Today: only entered via Hub > Experiences snap inputs (gated on kind+venueCategory+claim); no dedicated wizard | NEW `<ExperienceCreatorWizard>` mirrors TripCreatorWizard pattern: Identity → Venue → When → Pricing → Cover. Always asks venue (pre-fills from brand address per Q7) | D7/Q7 NEW component | YES | YES | YES |
| `UniversalCreatorSheet.tsx:79-80` stale comment | Comment references `/trip/create gates on currentBrand.kind === "trip_planner"` | UPDATE-COPY: rewrite comment to reflect universal authoring (or delete comment) | D7 (Codex G4): UniversalCreatorSheet.tsx lines 79–80 | YES | YES | YES |

---

## Business app — Marketing hub (audit-adjacent; verify kind references)

| Screen | Current state | New state | Files (D-N) | iOS-business | Android-business | business-web-preview |
|---|---|---|---|---|---|---|
| `marketing/audiences/index.tsx` | Audit found kind references; likely audience-kind not brand-kind (FALSE POSITIVE expected) | Verify in Phase 3 spec read; no change anticipated | D11 verify | YES | YES | YES |
| `marketing/campaigns/compose.tsx` | Same | Same | D11 verify | YES | YES | YES |
| `marketing/TemplateEditor.tsx` | Same | Same | D11 verify | YES | YES | YES |

(All 3 expected to be NO-CHANGE false positives per audit; Phase 3 spec writer confirms during ingest.)

---

## Buyer-web — Public brand page (`/b/{brandSlug}`)

| Screen | Current state | New state | Files (D-N) | buyer-web | iOS-business preview | Android-business preview |
|---|---|---|---|---|---|---|
| `PublicBrandPage.tsx` tab structure | Post-ORCH-0963: `isTripBrand`-branched 3-tab model (Upcoming/Past/About for events; Trips/Past Trips/About for trip-planner) | Data-driven: Upcoming (always when any offering exists) + Events (if any) + Trips (if any) + Experiences (if any) + About | D9: PublicBrandPage.tsx full rewrite of tab block (lines 108, 124, 144, 196–223, 434–467) | YES | YES (web preview) | YES (web preview) |
| `PublicBrandPage.tsx` address card (line 228) | `showLocation = brand.kind === "physical" && brand.address !== null && trim > 0` | Show when `brand.address` non-empty (no kind gate) | D4/D9: PublicBrandPage.tsx lines 227–232 | YES | YES | YES |
| `PublicBrandPage.tsx` Stats card (lines 415–431) | Renders when publicEventCount > 0 (events-only) | DELETED (per ORCH-0963 intent already; META-ORCH-0972 re-confirms) | D9 | YES | YES | YES |
| Public-page Upcoming tab (NEW body) | Today's "Upcoming" tab shows events only | Chronologically interleaved events + trips + experiences with type-pill on each card | Design Area 5 NEW | YES | YES | YES |
| Public-page `<ExperienceMiniCard>` (NEW) | Doesn't exist | Cover + title + venue/next-occurrence subline + price + type-pill; tap → `/exp/{brandSlug}/{experienceSlug}` | Design Area 5 NEW | YES | YES | YES |
| `<NextEventTeaser>` (ORCH-0963 primitive) | Renders only when `!isTripBrand && upcomingEvents.length > 0` | Preserved; now renders inside Events tab (per-type tab) when bucket non-empty | D9 PRESERVE | YES | YES | YES |
| `<TripMiniCard>` (ORCH-0963 primitive) | Renders inside trip-branched tab body | Preserved; now renders inside Trips tab (per-type) AND inside Upcoming tab interleave | D9 PRESERVE | YES | YES | YES |
| Verified location badge (Q10/Design Area 7) | Doesn't exist on public page today | NEW: shown next to brand name in identity card when `brand.claim_status === 'verified'` | Design Area 5/7 NEW | YES | YES | YES |
| `publicEventsService.ts` kind dispatch | `getPublicBrandBySlug` branches on `brand.kind === "trip_planner"` for fetch path | Parallel-fetch events + trips + experiences regardless of brand | D9: publicEventsService.ts lines 850–905 | (service layer) | (service layer) | (service layer) |
| `BusinessPublicBrandViewRow.kind` TS union | Admits `'physical' \| 'popup' \| 'trip_planner'` | DELETE union (column going away) | D9: publicEventsService.ts line 111–114 | (TS only) | (TS only) | (TS only) |
| `BusinessPublicEventViewRow.brand_kind` field (ORCH-0962 add) | Public-events view exposes brand kind | DELETE the SELECT column from view + the TS field | D9: publicEventsService.ts line 36 + view rewrite | YES | YES | YES |

---

## Admin web — Venue Claims dashboard

| Screen | Current state | New state | Files (D-N) | admin-web |
|---|---|---|---|---|
| Admin Claims page filter | `adminClaimsService.js:37` `.eq("kind", "physical")` | DELETE kind filter; replace with `claim_status` filters per tab | D12 (Codex P1): adminClaimsService.js line 37 | YES |
| Admin Claims page tabs (NEW structure) | Single list of physical+pending brands | 3 tabs: Pending review (default) / Verified / Rejected | Design Area 8 NEW | YES |
| Admin Claims row action: approve / reject | Existing actions | UNCHANGED (already kind-agnostic at action layer) | n/a | YES |

---

## Backend — Database (Phase 3 spec defines exact migration sequence)

| Object | Current state | New state | Files | Stage |
|---|---|---|---|---|
| `brands_kind_check` CHECK constraint | `kind IN ('physical','popup','trip_planner')` | Removable once all code stops reading kind | Phase 3 spec; supabase/migrations/ new | Stage 4 |
| `brands.kind` column | NOT NULL DEFAULT 'popup' | Removable after constraint dropped + one safe-deploy cycle | Phase 3 spec | Stage 4 |
| `business_public_brands_view` | SELECTs kind + WHERE `kind IN ('popup','trip_planner') OR (physical+verified)` | DROP kind from SELECT; rewrite WHERE to universal public-read (`deleted_at IS NULL`) | Phase 3 spec; latest view in 20260727000003 | Stage 2 |
| `claimed_venues_public_view` | SELECTs kind + WHERE `kind='physical' AND verified` | DROP kind from SELECT; WHERE becomes `claim_status='verified'` alone | Phase 3 spec | Stage 2 |
| `business_public_events_view` | SELECTs `b.kind AS brand_kind` | DROP brand_kind from SELECT | Phase 3 spec | Stage 2 |
| RLS "Public can read verified physical venues" | `kind='physical' AND claim_status='verified'` | DROP kind predicate; verify Phase 3 spec covers any parallel public-read policy | Phase 3 spec | Stage 2 |
| RLS "Public can read hours for verified physical venues" | EXISTS subquery with kind='physical' | DROP kind predicate from EXISTS | Phase 3 spec | Stage 2 |
| RLS "Public can read place_pool for verified physical venues" | EXISTS subquery with kind='physical' | DROP kind predicate from EXISTS | Phase 3 spec | Stage 2 |
| `pg_public_trips_by_brand` RPC | `WHERE b.kind = 'trip_planner'` brand-kind guard (line 46) | DROP single-line guard; preserve canonical sold formula | Phase 3 spec | Stage 2 |
| `pg_public_experiences_by_brand` RPC (NEW) | Does not exist | NEW SECURITY DEFINER anon RPC returning experiences per brand-slug; reads `theme.experience_meta` JSON fields | Phase 3 spec | Stage 2 |
| `biz_create_venue_brand_pending_review()` RPC | INSERTs `kind = 'physical'` | DROP kind from INSERT (column going) | Phase 3 spec | Stage 3 |
| `biz_review_venue_claim()` RPC | `AND b.kind = 'physical'` guard | DROP kind predicate | Phase 3 spec | Stage 3 |
| Experience row schema (theme JSON) | `theme.experience_meta` exists with various fields | ADD `theme.experience_meta.venue_text` + `theme.experience_meta.next_occurrence_at` per Q9 | Phase 3 spec | Stage 0 (data-shape additive, can ship before everything else) |

---

## Backend — Edge functions

| Function | Current state | New state | Files |
|---|---|---|---|
| `parse-restaurant-menu/index.ts` | Server gate `kind !== "physical"` (line 155) + `claim_status !== "verified"` (line 161) → 403 | DELETE both gates; drop kind/claim from SELECT at line 144; any brand can invoke | D8/Q1 |
| `parse-play-activities/index.ts` | Same shape gates at lines 162 + 176 | DELETE both gates; drop kind/claim from SELECT at line 151 | D8 |
| `_shared/agentTools.ts` | `if (brand.kind !== "physical") throw ToolError("INVALID_ARGS", ...)` (line 412) | DELETE gate (lines 412 + 421) | D8 |
| `agent-chat/index.ts` | `error.kind` references — Gemini error types (FALSE POSITIVE) | NO-CHANGE | D11 false-positive |
| `_shared/email/tripConfirmationEmail.ts` | `i.kind === "included"/"excluded"` — trip inclusion enum (FALSE POSITIVE) | NO-CHANGE | D11 false-positive |
| `ticket-confirmation-dispatch/index.ts` + `installment_kinds.test.ts` | `body.kind` — installment notification enum (FALSE POSITIVE) | NO-CHANGE | D11 false-positive |

---

## Strict-grep CI gates

| Gate | Current state | New state | Files |
|---|---|---|---|
| `scripts/ci/orch-0855-adversarial-check.mjs` A-07 + A-13 | Locks PersonaDef.id union + KIND-IMMUTABLE | DELETE both assertions (or delete file if only assertions) | D11 |
| `.github/scripts/strict-grep/orch-0963-public-brand-kind-branched.mjs` C1 + C3 | C1: PublicBrandPage contains `brand.kind === "trip_planner"`; C3: TS union admits trip_planner | DELETE C1 + C3 assertions | D9 |
| Same gate C2 + C4 | C2: publicEventsService calls `pg_public_trips_by_brand`; C4: route segregation `event_type === 'trip'` allowlist | PRESERVE C2 (RPC still called universally) + PRESERVE C4 (enforces I-PROPOSED-TR2-ROUTE-BY-EVENT-TYPE, orthogonal) | D9 |
| NEW: `orch-0972-data-driven-tabs.mjs` | Doesn't exist | NEW gate enforcing `I-PUBLIC-PAGE-DATA-DRIVEN-TABS` + `I-HUB-TABS-DATA-DRIVEN` | Phase 3 spec defines exact assertions |
| NEW: `orch-0972-no-brand-kind-reads.mjs` | Doesn't exist | NEW gate forbidding any `brand.kind` / `brands.kind` / `currentBrand.kind` read in active product code (allowlist: migration files only) | Phase 3 spec defines |
| `.github/workflows/strict-grep-mingla-business.yml` | Job for orch-0855 + orch-0963 | UPDATE jobs accordingly | Phase 3 spec |
| `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` `ORCH_0972_BACKEND_ALLOWLIST` | Doesn't include META-ORCH-0972 backend touches | ADD allowlist entry for every supabase/functions + supabase/migrations file Phase 4 Sub-A/C/D touches (per COMMS-0002) | Phase 4 implementor in same commit |

---

## Cross-platform parity summary

| Surface | In scope? | Highest-risk areas |
|---|---|---|
| Consumer iOS (`app-mobile/` iOS) | NO | Brand-kind-agnostic per Dim 12; verify zero impact in Phase 5 tester |
| Consumer Android (`app-mobile/` Android) | NO | Same |
| Buyer/anonymous Web (`mingla-business/` /b/{slug}, /e/, /checkout/) | YES | Public brand page redesign (Design Area 5) |
| Business iOS (`mingla-business/` iOS) | YES | Brand creation flow, home, hub, brand edit |
| Business Android (`mingla-business/` Android) | YES | Same as iOS; verify hardware-back parity |
| Admin Web (`mingla-admin/`) | YES | Venue Claims dashboard (Design Area 8) |
| Business Web preview (`mingla-business/` dev/web) | YES | Same as business iOS but on web |

---

## Files NOT touched by Phase 2 design

For completeness — areas the audit catalogued as needing changes but Phase 2 design doesn't redesign (Phase 3 spec / Phase 4 implementor handle directly):

- All test files (deletion + rewriting per existing patterns)
- TS type files (`brand.ts`, `brandMapping.ts` TS unions) — schema-level edits per Phase 3 spec
- The 6 false-positive edge functions verified in D11 (agent-chat, tripConfirmationEmail, ticket-confirmation-dispatch + 3 others)
- `app-mobile/` consumer-app files (all `kind` references are NO-CHANGE per Dim 12)
- Shared `packages/` (NO-BRAND-KIND-DEPENDENCY per Dim 12)

End of screen inventory.
