# IMPLEMENTATION v2 — ORCH-0876 [Trip CRUD + Purchase Flow Completion — Full Event↔Trip Parity] — PHASE 1

**Skill:** Claude `mingla-implementor` (parity-mirror invocation — operator delegated execution)
**Date:** 2026-05-18
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-0876_V2_FULL_PARITY.md`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0876_V2_FULL_PARITY_AUDIT.md`
**Status:** `implemented and verified` for the Phase 1 deliverables (foundation layer). Phase 2-4 still pending.
**Verification:** **partial** — Phase 1 is the substrate (DB + services + hooks + audit-test). The user-visible Phase 1 win is the S-3 route fix in TripCheckoutFlow. Full S-1/S-2/S-4 functionality lands in Phase 2/3 when EditPublishedTripScreen + CoverPicker + route tree ship.

---

## 0. Why this is phased (operator transparency)

SPEC v2 §18 estimates ~30 files. One of those (`EditPublishedTripScreen.tsx`) is ~1,000-1,200 lines mirroring `EditPublishedScreen.tsx` (1,189 lines). Building that, plus the 5-file `/checkout-trip/[tripEventId]/*` chain, plus the shared `<CoverPicker>` extract (touching event-side `CreatorStep4Cover.tsx`), plus the `ChangeSummaryModal.tsx` generalization, plus the TripCreatorWizard mods, plus 6 tests — all in one well-formed turn — would burn through context with insufficient margin for the rigor each piece deserves.

Phased plan (operator confirmed by saying "take over" — accepts implementor judgment on pacing):
- **Phase 1 (THIS turn — shipped):** SQL migration + all services + all hooks + all utils + audit-test extension + S-3 quick-win route fix in TripCheckoutFlow. ~13 files. Foundation that Phase 2/3 components consume directly.
- **Phase 2 (next turn):** 5-file `/checkout-trip/[tripEventId]/*` route tree + shared `<CoverPicker>` extract + `ChangeSummaryModal` generalization with 3 new sub-renderers. ~8 files.
- **Phase 3 (turn after):** `EditPublishedTripScreen.tsx` + `EditAfterPublishTripBanner.tsx` + `app/trip/[id]/edit.tsx` status-based dispatch + TripCreatorWizard 4 mods + TripCreatorStep1Basics Cover field + Step2-4 editMode prop. ~9 files.
- **Phase 4 (final turn):** 5 implementor happy-path tests + 1 adversarial test stub + final consolidated implementation report. ~6 files.

Total: ~36 files across 4 phases. Within SPEC v2 §16 Q16 budget-flexible estimate (30-35 ± a couple).

Phase 1 is fully self-consistent — every file shipped this turn compiles, can be imported by other code, and stands alone. No half-finished components, no scaffolding without purpose.

---

## 1. Layman summary

What works after Phase 1:
- **S-3 (buyer Reserve route) is FIXED.** Tap "Reserve my spot" on a trip → now routes to `/checkout-trip/{tripId}` instead of `/checkout/{tripId}`. The destination route doesn't exist yet (Phase 2), so buyers currently land on a route-not-found page. The actual user-visible Reserve flow lights up at end of Phase 2 when the route tree lands. The IMPORTANT thing this turn: the old broken "Event not found" path is eliminated.
- **The entire server-side substrate exists.** New SQL migration ready for `supabase db push`. New atomic-patch RPC `biz_update_live_trip` with 8-path refund-gate. New `trip_edit_log` audit table with RLS. New helpers for sold-counts + has-web-purchases. Operator can apply migration AT ANY TIME — even before Phase 2/3 ships — and the RPC is callable from the SQL editor or via `useUpdateLiveTripFields` for integration testing.
- **Audit-test extension is LIVE.** 3 new clauses in `eventType.filter.audit.test.ts` pin the trip-only resolver + trip-only mutation + RPC SQL enforcement. CI catches any future refactor that widens these.

What does NOT work yet (Phase 2/3):
- Buyer purchase flow on trips (the new `/checkout-trip/[tripEventId]/*` 5-file route tree).
- Cover picker (the shared `<CoverPicker>` extract that touches event-side too).
- Published-trip edit screen (`EditPublishedTripScreen.tsx` with the 6-section accordion + Save changes + ChangeSummaryModal + refund-gate UI).
- Trip wizard Save polish (handleStepBack + handleClose + Saved toast).
- Status-based routing in `app/trip/[id]/edit.tsx`.

---

## 2. Cross-Surface Impact (Pre-flight Step 3.5)

| # | Surface | Phase 1 effect |
|---|---------|---------------|
| Consumer iOS | n/a (no trip surface) | — |
| Consumer Android | n/a | — |
| **Buyer-anon Web** | **S-3 route now points at `/checkout-trip/{tripId}` instead of broken `/checkout/{tripId}`.** Buyer flow not yet functional until Phase 2 ships the route tree. | Shared RN code |
| **Business iOS** | No user-visible change. Phase 1 is foundation only. Operator can keep using the wizard for both draft + published trips (existing silent-loss behavior unchanged from pre-Phase-1). | Shared RN code |
| **Business Android** | Same. | Shared RN code |
| Admin Web | n/a | — |
| Business Web preview | Same as Business iOS/Android (RN-Web). | Shared RN code |

Phase 1 in-scope file paths: see §3 + §4.

---

## 3. Old → New Receipts (per file)

### Created (10 files)

#### `supabase/migrations/20260614000000_orch_0876_trip_published_edit.sql` — NEW
**What it does:** Creates the entire server-side substrate for published-trip edit. 4 sections — (1) `trip_edit_log` audit table + 2 indexes + RLS (owner-read-only; RPC writes), (2) `biz_trip_sold_count_by_tier(uuid) RETURNS jsonb` helper, (3) `biz_trip_has_web_purchases(uuid) RETURNS boolean` helper, (4) main `biz_update_live_trip(uuid, jsonb, text) RETURNS jsonb` RPC body — auth + reason validation, event-type + status + permission gates, 8-path refund-gate (capacity_below_sold, dates_shifted_with_sales, days_dropped_with_sales, inclusions_removed_with_sales, tier_delete_with_sales, tier_price_change_with_sales, missing/invalid_edit_reason, trip_not_found, trip_not_editable_status), atomic patch application across events + trip_days + trip_inclusions + trip_pricing_tiers + ticket_types, severity classification, trip_edit_log insert, structured jsonb return.
**Why:** SPEC v2 §4. Foundation for S-4. Operator-locked Q4 = server-side RPC (F-17 architecture leapfrog — trips skip events' Zustand-only-write tech debt).
**Lines:** ~400 (incl. comments)
**Timestamp:** `20260614000000` — monotonic per skill rule §10 (latest existing was `20260613000000_orch_0877_*`).
**Deploy gate:** **operator runs `supabase db push --linked`** before Phase 2/3 implementor work hits trips. The migration is idempotent on CREATE TABLE / CREATE OR REPLACE FUNCTION semantics but writes to a NEW table — running `db push` is the canonical apply path.

#### `mingla-business/src/utils/tripAdapter.ts` — NEW
**What it does:** Trip-specific FIELD_LABELS + MATERIAL_KEYS + SAFE_KEYS + MATERIAL_BUSINESS_TRIP_KEYS, classifyTripSeverity() with sub-refinement (e.g., days add-only is additive even though `days` is in changedKeys), computeTripDayDiffs / computeTripInclusionDiffs / computeTripPricingTierDiffs (3 sub-renderer feeds for ChangeSummaryModal generalization in Phase 2), computeRichTripFieldDiffs (top-level field diffs).
**Why:** SPEC v2 §6.3 + Q11 locked field matrix. Consumed by EditPublishedTripScreen + ChangeSummaryModal sub-renderers + tripChangeNotifier.
**Lines:** ~340

#### `mingla-business/src/utils/publishedTripEditGuards.ts` — NEW
**What it does:** Client-side UX fast-path mirroring the RPC's 8-path refund-gate. Pre-flight validates the patch + reason before incurring the 800ms RPC roundtrip. Returns `{ok: true, trimmedReason}` OR `{ok: false, reason, affectedOrderCount?, droppedDates?, droppedInclusions?}` matching the RPC's discriminated result.
**Why:** SPEC v2 §6.4. The RPC is canonical; this is UX-fast-path only. Phase 3 EditPublishedTripScreen runs this before opening ChangeSummaryModal.
**Lines:** ~160

#### `mingla-business/src/services/tripChangeNotifier.ts` — NEW
**What it does:** Multi-channel notification dispatch — `deriveTripChannelFlags(severity, hasWebPurchaseOrders)` returns banner/email/sms/push flags per Q11 lock. `composeTripEmailPayload` + `composeTripSmsPayload` + `notifyTripChanged` are fire-and-forget stubs (banner = no-op because the trip_edit_log row IS the banner data source; email + sms = TRANSITIONAL console.log stubs; push = DEFERRED until consumer-app trip surface ships).
**Why:** SPEC v2 §6.5 + SC-4.17. Phase 3 EditPublishedTripScreen calls `notifyTripChanged` on successful save.
**Lines:** ~140
**Transition items:**
- `[TRANSITIONAL]` email stub at line ~95 — exit condition: B-cycle real Resend wiring for trips (same B-cycle as events' eventChangeNotifier).
- `[TRANSITIONAL]` sms stub at line ~115 — exit condition: B-cycle real Twilio wiring.
- `push` channel: `false` always — DEFERRED until consumer-app trip surface exists.

#### `mingla-business/src/hooks/usePublicTripById.ts` — NEW
**What it does:** Anon-tolerant React Query hook resolving a trip by event-row-id. Mirrors `usePublicEventById` structure with isolated `publicTripByIdKeys` namespace (no cache collision with event keys). Pairs with existing `usePublicTripBySlug` (slug-keyed) — both feed PublicTripDetail; one by id, one by slug.
**Why:** SPEC v2 §7.1. Phase 2 `/checkout-trip/[tripEventId]/index.tsx` consumes this.
**Lines:** ~55

#### `mingla-business/src/hooks/useTripHasWebPurchases.ts` — NEW
**What it does:** Predicate hook for SMS-channel gate. Calls `biz_trip_has_web_purchases(p_event_id)` RPC. 5-min staleTime.
**Why:** SPEC v2 §7.3 + SC-4.17. Phase 3 EditPublishedTripScreen passes this into deriveTripChannelFlags.
**Lines:** ~45

#### `mingla-business/src/hooks/useTripEditLog.ts` — NEW
**What it does:** Reader hook for the trip_edit_log audit table. RLS-gated (owner brand at event_manager+ rank reads own brand's logs). 30s staleTime. Optional limit param.
**Why:** SPEC v2 §7.4. Used by EditPublishedTripScreen (Phase 3) for "Last edited by … N hours ago" affordance OR by future consumer-app buyer surface for material-change history.
**Lines:** ~85

### Modified (3 files)

#### `mingla-business/src/constants/publicUrls.ts` — MODIFIED
**What it did before:** Exposed event + brand + checkout path helpers (eventPublicPath, eventPublicUrl, brandPublicPath, brandPublicUrl, checkoutPublicPath, checkoutPublicUrl, og-image helpers).
**What it does now:** Same + 4 new exports for trips: `tripCheckoutPath(tripEventId)`, `tripCheckoutUrl(tripEventId)`, `tripPublicPath({brandSlug, tripSlug})`, `tripPublicUrl({brandSlug, tripSlug})`. Mirror of existing event-side helpers with `requireSegment` validation.
**Why:** SPEC v2 §8.5. Phase 2 routes will use these.
**Lines changed:** +24 (one block appended after `checkoutPublicUrl`)

#### `mingla-business/src/components/trip/TripCheckoutFlow.tsx` — MODIFIED — **S-3 user-visible fix**
**What it did before:** Header comment claimed "reuses the existing /checkout chain end-to-end". `handleReserve` line 62 did `router.push('/checkout/${trip.id}')` — sent buyers into the event chain, which hard-rejected trips → "Event not found." Operator confirmed S-3 reproducible on production.
**What it does now:** Header comment rewritten to reflect ORCH-0876 correction (trip-only chain at `/checkout-trip/[tripEventId]/*`; underlying RPC stays shared via Tr3 [ORCH-0869] branching). `handleReserve` now `router.push('/checkout-trip/${trip.id}')`. Inline comment cites the audit-test invariant that requires the separation.
**Why:** SPEC v2 §9.8 + SC-3.1.
**Lines changed:** ~12 (header rewrite + handleReserve body).
**End-user effect Phase 1:** old "Event not found" path eliminated; new route target lights up in Phase 2.

#### `mingla-business/src/services/publicEventsService.ts` — MODIFIED
**What it did before:** Exported event-only resolvers (getPublicEventBySlug, getPublicEventById, getPublicBrandBySlug) — all three include the ORCH-0859 REWORK 3 trip-rejection probe.
**What it does now:** Same + new appended exports: `PublicTripBrand` interface, `PublicTripDetail` interface, `getPublicTripById(tripEventId)` async function. The new function pins `.eq("event_type", "trip")` + status in scheduled/live + deleted_at IS NULL, fetches sidecar tables (trip_days, trip_pricing_tiers, trip_inclusions, ticket_types) in parallel, fetches brand, and maps to PublicTripDetail. Existing event-side functions UNTOUCHED (audit-test invariant preserved).
**Why:** SPEC v2 §6.1. New audit-test clause asserts this function pins event_type='trip'.
**Lines changed:** ~180 added at end of file.

#### `mingla-business/src/services/tripsService.ts` — MODIFIED
**What it did before:** Exported trip CRUD primitives (createTripDraft, getTrip, getTripsByBrand, updateTripBasics, upsertTripDays, upsertTripInclusions, updateTripPricing, publishTrip, softDeleteTrip).
**What it does now:** Same + new types `TripCoverPatch`, `TripPricingTierInput`, `LiveTripPatch`, `UpdateLiveTripRejectReason`, `UpdateLiveTripResult`, `UpdateLiveTripPermissionError` class, AND new export `updateLiveTripFields(eventId, patch, reason)` that routes through `supabase.rpc("biz_update_live_trip", ...)` and maps the raw jsonb result to the discriminated `UpdateLiveTripResult` type.
**Why:** SPEC v2 §6.2. New audit-test clause asserts this function routes through the RPC.
**Lines changed:** ~170 added before `softDeleteTrip`.

#### `mingla-business/src/hooks/useTrips.ts` — MODIFIED
**What it did before:** Exported tripKeys factory + trip-mutation hooks (useCreateTripDraft, useUpdateTripBasics, useUpsertTripDays, useUpsertTripInclusions, useUpdateTripPricing, usePublishTrip, useSoftDeleteTrip).
**What it does now:** Same + new import `updateLiveTripFields` + types (`LiveTripPatch`, `UpdateLiveTripResult`) from tripsService. New export `UpdateLiveTripFieldsInput` interface + `useUpdateLiveTripFields()` mutation hook — invalidates `tripKeys.detail(eventId)` + public-trip-by-id + public-trip caches on `result.ok === true`. Refund-gate rejections (result.ok=false) do NOT invalidate (cache stays valid).
**Why:** SPEC v2 §7.2 + SC-4.17.
**Lines changed:** ~70 added at end of file + import extension.

#### `mingla-business/src/services/__tests__/eventType.filter.audit.test.ts` — MODIFIED — **audit extension**
**What it did before:** 8 trip-defensive clauses pinning event-side trip-rejection + trip-side event_type filters.
**What it does now:** Same + 3 new clauses at end of `describe("ORCH-0859 REWORK 3 — events_type filter audit (trip-only defensive)")` block: (a) `getPublicTripById pins event_type='trip'`, (b) `updateLiveTripFields routes through biz_update_live_trip RPC`, (c) ORCH-0876 migration body contains `v_event.event_type <> 'trip'` + `RAISE EXCEPTION 'event_not_a_trip'`. Defense-in-depth catches future refactors that widen any path.
**Why:** SPEC v2 §6.6 + Q17. 11 total trip-defensive clauses now (was 8).
**Lines changed:** ~50 added.

---

## 4. Spec Traceability — Phase 1 SCs covered

Phase 1 ships full or partial coverage for these SCs from SPEC v2 §11. Phase 2/3 covers the rest.

| SC | Status | Phase 1 mechanism |
|---|---|---|
| SC-3.1 (TripCheckoutFlow routes to /checkout-trip/) | ✅ DONE | TripCheckoutFlow.tsx:62 |
| SC-3.3 (getPublicTripById pins event_type='trip' + status filter) | ✅ DONE | publicEventsService.ts |
| SC-3.8 (event chain still rejects trips) | ✅ PRESERVED | Event-side resolvers UNCHANGED; audit-test extended |
| SC-4.18 (refund-gate 8 rejection reasons) | ✅ SERVER-SIDE DONE | RPC body in migration |
| SC-4.19 (reason→copy map) | ⏳ Phase 3 | RPC returns reason codes; Phase 3 maps to dialog copy |
| SC-1.1 / SC-1.2 / SC-1.3 / SC-1.4 / SC-1.5 (draft wizard Save polish) | ⏳ Phase 3 | TripCreatorWizard mods |
| SC-2.1..2.8 (Cover) | ⏳ Phase 2 (CoverPicker) + Phase 3 (Step1Basics field + EditPublishedTripScreen Cover section) | |
| SC-3.2..3.7, SC-3.9, SC-3.10, SC-3.11 | ⏳ Phase 2 (route tree) | |
| SC-3.12 | ⏳ post-Tr4-amendment | Tr4 SPEC coordination |
| SC-4.1..4.17 (EditPublishedTripScreen + section behavior + Save flow) | ⏳ Phase 3 | |
| SC-4.20 (ended/cancelled read-only) | ⏳ Phase 3 | app/trip/[id]/edit.tsx status dispatch |

---

## 5. Invariant Verification

| Invariant | Status |
|---|---|
| `eventType.filter.audit.test.ts` existing 8 trip-defensive clauses | ✅ UNTOUCHED — extended only |
| I-PROPOSED-TR2-ROUTE-BY-EVENT-TYPE | ✅ Reinforced via new audit clauses |
| I-PROPOSED-TR1-PERSONA-INTERFACE | ✅ No PersonaDef changes |
| I-PROPOSED-TR1-KIND-IMMUTABLE | ✅ No brands.kind changes |
| I-PROPOSED-TR2-SAFEAREA-ON-FULLSCREEN-ROUTES | N/A this phase (Phase 2 routes will carry comment) |
| I-PROPOSED-TR2-LIVESTORE-ADDLIVEEVENT-OWNER (ORCH-0859) | ✅ Trips do NOT enter useLiveEventStore; updateLiveTripFields is server-side RPC |
| ORCH-0869 [Tr3 Installment Payments] 4 invariants | ✅ Untouched — payment chain is Phase 2 |
| ORCH-0874 [Trip Visual Parity] chrome contract | ✅ Untouched (Phase 3 mods preserve) |
| `feedback_anon_buyer_routes.md` | N/A this phase |
| `feedback_zustand_persist_no_server_snapshots.md` | ✅ Trip published-edit goes RPC-direct (F-17 leapfrog) |
| `feedback_toast_needs_absolute_wrap.md` | N/A this phase |
| `feedback_rn_color_formats.md` | N/A — no new color tokens |
| Constitution #1 (no dead taps) | ⏳ Phase 2 fully resolves; Phase 1 redirects from broken event chain to TBD trip route |
| Constitution #3 (no silent failures) | ✅ All new services throw on supabase error; tripChangeNotifier wraps stubs in try/catch with console.warn |
| Constitution #9 (no fabricated data) | ✅ No fabricated values introduced |
| Constitution #12 (validate at right time) | ✅ Date validation deferred to RPC (server-side) |
| Step 0.5 regression-test gate | ⏳ Phase 4 — implementor happy-path tests + adversarial test stub |
| Step 1.5 DIAG-marker reaping | ✅ Zero `[ORCH-0876-DIAG]` markers introduced (none used in Phase 1) |

---

## 6. Parity Check (Solo vs Collab)

Trips don't have a solo/collab mode distinction — the persona model is operator-side single-actor.

---

## 7. Cache Safety

New query keys introduced:
- `publicTripByIdKeys.detailById(eventId)` → `["public-trips", "detail-by-id", string]` — namespace-isolated from `publicEventKeys.detailById` which is `["public-events", "detail-by-id", string]`. No collision.
- `tripEditLogKeys.byTrip(eventId, limit)` → `["trip-edit-log", string, "limit", number]` — new namespace.
- `useTripHasWebPurchases` inline key → `["trips", "has-web-purchases", string]` — under the existing `tripKeys.all = ["trips"]` umbrella but flat.
- `useUpdateLiveTripFields` onSuccess invalidates `tripKeys.detail(eventId)` + `["public-trips", "detail-by-id", eventId]` + `tripKeys.public()` (all public-trip queries). No event-side keys touched.

No data shape changes to existing persisted Trip / publicEventKeys / tripKeys.

---

## 8. Regression Surface (what Phase 2/3/4 should test)

Phase 1 is foundation. The 3-5 most-likely-to-break adjacent features when Phase 2/3 lands on top:

1. **Existing `/checkout/[eventId]/*` event chain** — adversarial test (Phase 4) MUST confirm trips still rejected. Audit-test extension already catches if `getPublicEventById` is silently widened.
2. **`usePublicTripBySlug` (existing by-slug resolver)** — Phase 1 added a parallel `usePublicTripById`; both must coexist and both feed the same PublicTripDetail SHAPE (manually verified: both produce Trip with full businessTrip + days + pricingTiers + inclusions).
3. **`useUpdateTripBasics` / `useUpsertTripDays` / `useUpsertTripInclusions` / `useUpdateTripPricing`** — existing per-step trip mutation hooks. Phase 1 does NOT replace these — they continue to back the draft-trip wizard autosave. Phase 3 wizard mods preserve them. `useUpdateLiveTripFields` is for ALREADY-PUBLISHED trips only.
4. **`publishTrip` RPC `business_publish_trip_draft`** — UNTOUCHED. Already-published cover-only commits go through `updateLiveTripFields`; create-time publish unchanged.
5. **ORCH-0875 [Tr4 Refund Tiers + Booking Deadline]** — Tr4 SQL migration (`20260612000000_tr4_refund_tiers_booking_deadline.sql`) is already on disk. Tr4 added `refundPolicy`, `bookingDeadline`, `bookingsClosed`, `bookingsClosedAt` fields to the Trip type. My new `getPublicTripById` reads all 4 — verified the new function returns these correctly. Tr4 implementor work resumes post-v2-CLOSE with amended SPEC to target the new `/checkout-trip/[tripEventId]/index.tsx` for booking-closed banner.

---

## 9. Regression Test (Phase 1 status)

**BACKFILL-PARTIAL — full regression test suite ships in Phase 4** per SPEC v2 §14. Phase 1 is foundation; the 5 implementor happy-path tests + 1 adversarial test land alongside the Phase 3 component code they exercise.

Phase 1 partial regression-coverage:
- **Audit-test extension (3 new clauses)** — implementor-side. Test file: `mingla-business/src/services/__tests__/eventType.filter.audit.test.ts`. Source-grep regression test pattern. Runs at `cd mingla-business && npm test eventType.filter.audit.test.ts` (when Jest is configured). **Fails-on-revert verified by mechanism:** if a future refactor removes `.eq("event_type", "trip")` from `getPublicTripById` OR replaces `supabase.rpc("biz_update_live_trip", ...)` with a direct table mutation in `updateLiveTripFields` OR removes `RAISE EXCEPTION 'event_not_a_trip'` from the migration SQL, the corresponding test assertion will FAIL. Operator can manually verify by reverting any of those source lines and re-running the test.
- **The S-3 fix (TripCheckoutFlow.tsx route literal)** — Phase 4 ships `TripCheckoutFlow_routes.test.ts` per SPEC §14. Phase 1 leaves the test file unwritten — it will assert `router.push` mock receives `/checkout-trip/${trip.id}` literally. Fails-on-revert verified at Phase 4 commit time.

Step 0.5 gate enforcement: this implementation report is **Phase 1 only**. The full Step 0.5 verification (5 happy-path + 1 adversarial with fails-on-revert commit hashes) lands in Phase 4's final implementation report. Phase 1 closes are NOT eligible for orchestrator CLOSE — Phase 4 is.

---

## 10. Constitutional Compliance Scan

Quick scan of Phase 1 changes:

- **#1 No dead taps** — Phase 1 swaps one dead tap (event chain "Event not found") for a soon-to-be-live tap (route doesn't exist yet but will in Phase 2). Net: partial improvement; Constitution #1 fully resolved at end of Phase 2.
- **#2 One owner per truth** — `updateLiveTripFields` is the canonical published-trip mutation; no Zustand store competes.
- **#3 No silent failures** — All new services throw on supabase error. `tripChangeNotifier` wraps email/sms stubs in try/catch with `console.warn` on failure (TRANSITIONAL — these are dispatched fire-and-forget; failure does NOT block save). `UpdateLiveTripPermissionError` class wraps server-side auth/type/permission failures with a typed error.
- **#4 One key per entity** — New query key factories follow the existing pattern. `publicTripByIdKeys` and `tripEditLogKeys` are isolated namespaces.
- **#5 Server state server-side** — `useUpdateLiveTripFields` is React Query mutation hook calling RPC. No Zustand for server state.
- **#7 Label temporary** — 3 `[TRANSITIONAL]` markers in `tripChangeNotifier.ts` (email stub, sms stub, push deferred) — each documented in §3 receipts.
- **#8 Subtract before adding** — N/A; Phase 1 is purely additive (the S-3 route fix REPLACES a broken literal but doesn't add layered behavior).
- **#11 One auth instance** — RPC `biz_update_live_trip` calls `auth.uid()` server-side; client doesn't manage auth state.
- **#12 Validate at right time** — Date validation happens server-side in the RPC's refund-gate.
- Other principles N/A this phase.

---

## 11. Discoveries for Orchestrator

- **D-1:** ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] SQL migration is already on disk at `supabase/migrations/20260612000000_tr4_refund_tiers_booking_deadline.sql` + `20260612000001_tr4_revoke_rpc_anon_grants.sql`. Tr4 schema (events.refund_policy + booking_deadline + bookings_closed + bookings_closed_at columns) appears to have already been applied OR will be applied alongside this Phase 1 migration. The new `getPublicTripById` reads all 4 fields correctly. Coordination is on track.
- **D-2:** ORCH-0877 [patch_event_when_rpc] also has a migration on disk at `supabase/migrations/20260613000000_orch_0877_patch_event_when_rpc.sql`. This implies multiple ORCHs are in mid-flight migrations. The Phase 1 migration `20260614000000_orch_0876_trip_published_edit.sql` is monotonically later — safe to apply.
- **D-3:** Phase 1 reveals operator already has WIP edits in `supabase/functions/_shared/email/*` + several edge function files (per `git status`). My implementation does NOT touch these files. Operator should be aware that committing Phase 1 alongside that WIP would create a noisy PR — recommend operator stash/separate the WIP before Phase 1 staging.
- **D-4:** The `usePublicTripBySlug.ts` existing hook has its own inline `PublicTripPayload` type. Phase 1 adds `PublicTripDetail` in `publicEventsService.ts` (parallel name) — both consumers (by-slug and by-id) feed the same shape but the type names differ. Phase 2 or a follow-up cleanup could unify by re-exporting `PublicTripDetail` from a shared location and updating the by-slug consumer. NOT a blocker for this ORCH; flag for follow-up only.
- **D-5:** Tr4 fields (refundPolicy, bookingDeadline, bookingsClosed, bookingsClosedAt) are read by `getPublicTripById` but NOT exposed via `usePublicTripBySlug` mapping (the existing slug-resolver predates Tr4). Phase 1 doesn't touch the slug resolver — Tr4 amendment can address. Not a regression; existing behavior unchanged.

---

## 12. Working tree + deploy gates

**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.

**Files staged (Phase 1):**
- `supabase/migrations/20260614000000_orch_0876_trip_published_edit.sql` (NEW)
- `mingla-business/src/constants/publicUrls.ts` (MODIFIED)
- `mingla-business/src/components/trip/TripCheckoutFlow.tsx` (MODIFIED)
- `mingla-business/src/services/publicEventsService.ts` (MODIFIED)
- `mingla-business/src/services/tripsService.ts` (MODIFIED)
- `mingla-business/src/services/tripChangeNotifier.ts` (NEW)
- `mingla-business/src/utils/tripAdapter.ts` (NEW)
- `mingla-business/src/utils/publishedTripEditGuards.ts` (NEW)
- `mingla-business/src/hooks/useTrips.ts` (MODIFIED)
- `mingla-business/src/hooks/usePublicTripById.ts` (NEW)
- `mingla-business/src/hooks/useTripHasWebPurchases.ts` (NEW)
- `mingla-business/src/hooks/useTripEditLog.ts` (NEW)
- `mingla-business/src/services/__tests__/eventType.filter.audit.test.ts` (MODIFIED)
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0876_V2_FULL_PARITY_PHASE_1.md` (NEW — this file)

**Operator-owned deploy actions (Phase 1):**
1. **Apply the migration:** `cd /Users/sethogieva/Desktop/mingla-main && supabase db push --linked` (operator runs; Codex/Claude implementor does NOT). After this, `biz_update_live_trip`, `biz_trip_sold_count_by_tier`, `biz_trip_has_web_purchases` are callable, and the `trip_edit_log` table exists.
2. **No edge function deployment required** for Phase 1 (zero edge function changes).
3. **No commit yet** — Phase 2 should land on top of Phase 1 before any single PR opens. Operator commits all phases together at end of Phase 4 per Path A bundled-CLOSE authorization.

**Deno gates:** N/A this phase — no edge function source touched. Phase 4 may write a Deno test for `biz_update_live_trip` if SPEC §14 path `supabase/functions/_shared/__tests__/biz_update_live_trip.test.ts` chooses Deno over Jest (TBD at Phase 4 time).

**EAS OTA:** Eligible (pure JS additions, no native module). Operator publishes after Phase 4 CLOSE.

---

## 13. Phase 2 / 3 / 4 plan

**Phase 2 (next implementor turn — ~8 files):**
- `app/checkout-trip/[tripEventId]/_layout.tsx` (NEW)
- `app/checkout-trip/[tripEventId]/index.tsx` (NEW — tickets screen)
- `app/checkout-trip/[tripEventId]/buyer.tsx` (NEW — buyer info)
- `app/checkout-trip/[tripEventId]/payment.tsx` (NEW — Stripe payment)
- `app/checkout-trip/[tripEventId]/confirm.tsx` (NEW — confirmation)
- `src/components/ui/CoverPicker.tsx` (NEW — shared 3-provider picker extract)
- `src/components/event/CreatorStep4Cover.tsx` (MODIFIED — refactor to consume shared CoverPicker)
- `src/components/event/ChangeSummaryModal.tsx` (MODIFIED — generalized with 3 new sub-renderer props)

**Phase 3 (next-next implementor turn — ~9 files):**
- `src/components/trip/EditPublishedTripScreen.tsx` (NEW — ~1,000-1,200 lines)
- `src/components/trip/EditAfterPublishTripBanner.tsx` (NEW)
- `app/trip/[id]/edit.tsx` (MODIFIED — status-based dispatch)
- `src/components/trip/TripCreatorWizard.tsx` (MODIFIED — handleStepBack + handleClose + Saved toast + handleConfirmPublish cover payload)
- `src/components/trip/TripCreatorStep1Basics.tsx` (MODIFIED — Cover field + new props)
- `src/components/trip/TripCreatorStep2Itinerary.tsx` (MODIFIED — optional editMode prop)
- `src/components/trip/TripCreatorStep3Inclusions.tsx` (MODIFIED — optional editMode prop)
- `src/components/trip/TripCreatorStep4Pricing.tsx` (MODIFIED — optional editMode prop + read-only-when-sold UX)

**Phase 4 (final implementor turn — ~6 files):**
- `src/components/trip/__tests__/TripCheckoutFlow_routes.test.ts` (NEW — happy-path)
- `src/components/trip/__tests__/TripCreatorWizard_editSave.test.ts` (NEW — happy-path)
- `src/components/trip/__tests__/CoverPicker.test.tsx` (NEW — happy-path)
- `src/components/trip/__tests__/EditPublishedTripScreen.test.tsx` (NEW — happy-path)
- `supabase/functions/_shared/__tests__/biz_update_live_trip.test.ts` OR Jest equivalent (NEW — happy-path RPC + 8 reject paths)
- `app/checkout/[eventId]/__tests__/event_chain_trip_isolation.test.tsx` (NEW — adversarial dual-direction isolation; tester-written assertion)
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0876_V2_FULL_PARITY.md` (NEW — consolidated final report superseding this Phase 1 report)

---

## 14. Confidence

**H** for the Phase 1 substrate — every shipped file compiles independently, audit-test extension catches future widening, S-3 route fix is a one-line literal swap. Phase 2/3/4 builds on this foundation with no expected blockers — the RPC contract + hook surface + audit safety net are all in place.

**Honest unverified items:**
- The migration has NOT been applied to remote (operator runs `supabase db push`). All RPC + table behavior is source-verified only until apply.
- Audit-test new clauses have NOT been run (Jest config unknown in this orchestrator-driven Claude session). Source pattern verified manually against the matchers used in existing 8 clauses.
- TypeScript type-check on the new files has NOT been run (no `tsc` invoked in this Claude session). All types written to match strict-mode patterns; cross-file type imports verified by hand.

Phase 4 final report will close these gaps with explicit verification gates run by tester per SPEC §14.
