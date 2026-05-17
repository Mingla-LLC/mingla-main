# QA REPORT — ORCH-0859 [Tr2 Minimum Viable Trip]

**Verdict:** FAIL · **Mode:** TARGETED
**Skill:** Claude `mingla-tester` (canonical TEST owner)
**Tested HEAD:** `899b6c703c56dfe517f72eca657c462434b98def` (branch `Seth`, single shared checkout)
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-0859_TR2_MINIMUM_VIABLE_TRIP.md`
**Implementation report:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0859_TR2_MINIMUM_VIABLE_TRIP.md`
**Date:** 2026-05-17

---

## 1. Severity counts

| Severity | Count |
|---|---|
| P0 — Critical | 0 |
| P1 — High | 1 |
| P2 — Medium | 1 |
| P3 — Low | 2 |
| P4 — Note | 2 |

**Blocking total:** 1 (P1). FAIL until resolved.

---

## 2. P1 — High (BLOCKING)

### P1-1 — Publish-error mapper switches on Postgres SQLSTATE, never matches user-defined RAISE names

**Files:**
- `mingla-business/src/components/trip/TripCreatorStep5Review.tsx:91` — `switch (code) {` — wrong discriminator
- `mingla-business/src/services/tripsService.ts:642` — `throw new TripPublishValidationError(error.code ?? "publish_failed", error.message)` — service contract
- `mingla-business/src/components/trip/TripCreatorWizard.tsx:323` — `mapPublishErrorToState(err.code ?? "publish_failed", err.message)` — wizard catch
- `supabase/migrations/20260608000100_orch_0859_publish_rpc_trip.sql` — RPC uses unqualified `RAISE EXCEPTION 'trip_*'` (no `USING ERRCODE` clause)

**What's wrong:**

Supabase Postgrest's error shape for an unqualified `RAISE EXCEPTION 'foo'` plpgsql statement is `{ code: "P0001", message: "foo", details: null, hint: ... }`. `code` is the Postgres SQLSTATE (always `P0001` for unqualified plpgsql RAISE), and `message` carries the literal RAISE argument.

`tripsService.publishTrip` correctly extracts both: `new TripPublishValidationError(error.code ?? "publish_failed", error.message)` — so the wizard receives `err.code = "P0001"` and `err.message = "trip_destination_required"` (or whichever name the RPC raised).

The wizard then calls `mapPublishErrorToState(err.code, err.message)`. The mapper signature is `(code: string, rawMessage: string)`. Its switch is `switch (code)`. In production, `code` is always `"P0001"` and the switch falls through to `default` for EVERY error. The friendly translation (`"Add a destination before publishing."` etc.) and the step-pointer auto-jump (jump to Step 1 / Step 2 / Step 4 based on which validation failed) NEVER fire.

**User-visible impact:**

A trip-planner operator who hits any publish-validation failure sees the raw technical sentinel ("trip_destination_required") or the generic fallback ("Couldn't publish. Tap Publish to try again.") instead of the friendly translation, and the wizard does not auto-navigate to the failing step. The entire UX promise of the inline-error + step-pointer system in SPEC §4.8 is non-functional on every error path.

**Why the implementor jest test missed it:**

`mingla-business/src/services/__tests__/tripsService.test.ts:111-120` mocks the Postgrest error as `{ code: "trip_days_required", message: "Trips must have days." }` — i.e. the test pretends `error.code` carries the user-defined RAISE literal, which is the inverse of production reality. The test asserts only `rejects.toBeInstanceOf(TripPublishValidationError)` (true regardless), not that the mapper produces friendly copy. The mock and the bug have the same false assumption, so the test passes.

**Tester adversarial regression test:**

`mingla-business/src/components/trip/__tests__/publishErrorMapper.adversarial.test.ts` (6 checks). At `HEAD 899b6c70`:

```
Tests: 1 failed, 5 passed, 6 total
  ✗ mapPublishErrorToState switch discriminator must be the RAISE message, not SQLSTATE
  ✓ mapper still includes a case for every trip-specific RPC exception
  ✓ mapper's default branch never echoes a raw 'trip_*_required' literal as user copy
  ✓ wizard catch passes (code, message) to mapper in that exact order
  ✓ publishTrip constructs TripPublishValidationError(code, message) — Postgrest contract
  ✓ trip RPC raises every error name without USING ERRCODE — proves SQLSTATE is P0001
```

The failing check is the smoking gun: regex `/switch\s*\(\s*code\s*\)/` is present in the mapper source. Fix is `switch (rawMessage)`.

**Fix options (implementor's call):**

- **Option 1 (recommended, smallest diff):** change `TripCreatorStep5Review.tsx:91` from `switch (code) {` to `switch (rawMessage) {`. The 9 case labels remain. The default branch already uses `rawMessage` as the user-facing fallback so its semantics improve, not degrade.
- **Option 2:** swap the argument order in `tripsService.publishTrip:642` so the discriminator becomes `error.message`. Brittle — couples the service to a UI implementation detail.
- **Option 3 (most robust, biggest diff):** change every `RAISE EXCEPTION 'trip_*'` in `20260608000100_orch_0859_publish_rpc_trip.sql` to use `USING ERRCODE = 'PNNNN'` per error, AND build a SQLSTATE→friendly-copy table in the mapper. Not worth the diff for Tr2.

Recommend Option 1 + add an adversarial test to the mapper assertion suite that covers an additional case (e.g. `trip_end_before_start` → `pointsToStep === 1`). The current adversarial test will pass after Option 1 lands.

---

## 3. P2 — Medium

### P2-1 — Implementor jest mock for Postgrest error shape is wrong

**File:** `mingla-business/src/services/__tests__/tripsService.test.ts:114`

`{ code: "trip_days_required", message: "Trips must have days." }` does not match Postgrest's actual response shape (which is `{ code: "P0001", message: "trip_days_required" }`). The test passes regardless because it only asserts `rejects.toBeInstanceOf(TripPublishValidationError)`. Update to use the real shape after P1-1 lands, and add an additional assertion that `(err as TripPublishValidationError).message === "trip_days_required"` so the test would have caught the discriminator bug at write-time.

This is P2 because the test file is append-only-CI-protected (existing test modification requires `[TEST-MOD-APPROVED ORCH-NNNN]` commit citation). Implementor should fold the test mock fix into the P1 rework commit with appropriate marker.

---

## 4. P3 — Low

### P3-1 — `softDeleteTrip` excludes only `(failed, cancelled)` orders; refunded orders still block

**File:** `mingla-business/src/services/tripsService.ts:670`

`.not("payment_status", "in", "(failed,cancelled)")` — fully refunded orders (`payment_status = 'refunded'`) still count as "confirmed" and block soft-delete. Debatable: a refunded order is a closed-out transaction, the operator may legitimately want to soft-delete the trip after refunding all travelers. Mirror what `softDeleteBrand` does (Tr1) — if Tr1 also excludes refunded, leave it. If Tr1 includes refunded in the exclusion set, harmonize here.

### P3-2 — `getTrip:380` joins `events.brands(slug)` then casts to `any` for brand-slug extraction

**File:** `mingla-business/src/services/tripsService.ts:389`

The `eventRow as any` cast loses type safety on the joined brand. The mapper accepts `EventRow` (no brands field) plus a `brandSlug: string | null` argument extracted out-of-band, so the join-then-cast pattern works but is fragile. Future ORCH that adds new brand-side fetched fields will silently drop type errors. Define a `EventRowWithBrand` interface for the join shape. Not blocking.

---

## 5. P4 — Note

### P4-1 — Clean separation between event-publish and trip-publish RPCs is a wise call

The Option B fork at IMPLEMENT-time was the right call. The event RPC body is tightly coupled to event-only taxonomy validation (`party_types_not_canonical`, `vibe_tags_not_canonical`, `music_genres_not_canonical`) and extending it would have required gating every existing validation block in `IF v_event.event_type = 'event'` wrappers. The fork keeps `business_publish_event_draft` byte-unchanged (verified via adversarial A-06) and isolates trip-specific validation in a narrow new RPC. Constitution #2 narrowing (one RPC = one event_type owner) is acceptable.

### P4-2 — Anon-tolerant `/t/[brandSlug]/[tripSlug]` route is correctly outside `app/(tabs)/` and free of `useAuth`

`mingla-business/app/t/[brandSlug]/[tripSlug].tsx` follows `feedback_anon_buyer_routes` correctly. `usePublicTripBySlug` reads anon-only via the published-or-member RLS gate. Implementor adversarial A-PUBLIC-1 / A-PUBLIC-7 in `app/t/__tests__/public-trip-page.test.ts` enforces this at test-time.

---

## 6. Coverage matrix (25 SPEC SCs)

| # | Implementor verdict | Tester verdict | Notes |
|---|---|---|---|
| SC-01 (UniversalCreator routes to /trip/create) | ✅ structural | ✅ confirmed via A-11 | |
| SC-02 (/trip/create creates draft → /trip/{id}/edit) | ✅ structural | ✅ confirmed via source read of `app/trip/create.tsx:50-54` | |
| SC-03 (Wizard 5-step + autosave) | ✅ structural | ✅ confirmed via implementor jest pass | live-fire deferred |
| SC-04 (Step 1 captures basics) | ✅ structural | ✅ confirmed via source read | live-fire deferred |
| SC-05 (Step 2 itinerary CRUD) | ✅ structural | ✅ confirmed via DELETE-then-INSERT in `tripsService.upsertTripDays:510-539` | live-fire deferred |
| SC-06 (Step 3 inclusions two-list) | ✅ structural | ✅ confirmed via source read | live-fire deferred |
| SC-07 (Step 4 single pricing tier) | ✅ structural | ✅ confirmed via `tripsService.updateTripPricing:572-626` | |
| SC-08 (Step 5 preview) | ✅ structural | ✅ confirmed | |
| SC-09 (Publish RPC validates) | ✅ live-verified | ✅ confirmed: function exists + raises 8 exceptions per source read | live-fire deferred + **P1-1 affects this surface** |
| SC-10 (Sidecar migrations applied) | ✅ live-verified | ✅ confirmed: 3 tables / 6 policies / 4 indexes via MCP probe | |
| SC-11 (Public anon route) | ✅ structural | ✅ confirmed via P4-2 above | live-fire deferred |
| SC-12 (Sidecar RLS published-or-member) | ✅ RLS-verified | ✅ confirmed via `pg_policy` USING-clause read | |
| SC-13 (Brand-member SELECT predicate) | ✅ RLS-verified | ✅ confirmed via same probe | |
| SC-14 (Reserve CTA routes to /checkout/{id}) | ✅ structural | ✅ confirmed | |
| SC-15 (Buyer info delegated to existing /checkout/) | ✅ delegated | ✅ confirmed: checkout edge fn unchanged (A-08) | |
| SC-16 (Tier card copy) | ✅ structural | ✅ confirmed | |
| SC-17 (orders.event_id = tripEventId, agnostic) | ✅ delegated | ✅ confirmed | |
| SC-18 (Stripe Connect routes trip $ to brand) | ⚠️ deferred | ⚠️ deferred — operator live-Dashboard probe required at CLOSE | |
| SC-19 (Trip-shaped confirmation email) | ✅ structural | ⚠️ confirmed at source-level; **deployed edge fn version 52 is PRE-Tr2** (sha 4f2e1ae) — needs deploy before live-fire | |
| SC-20 (Event-confirmation byte-equivalent) | ✅ regression | ✅ confirmed: trip branch fully gated on `isTrip` | |
| SC-21 (Event publish RPC byte-unchanged) | ✅ regression | ✅ confirmed via A-06 | |
| SC-22 (Operator dashboard Overview + Travelers) | ✅ structural | ✅ confirmed via source read of `app/trip/[id]/index.tsx` | live-fire deferred |
| SC-23 (hub/trips.tsx live query) | ✅ structural | ✅ confirmed | live-fire deferred |
| SC-24 (discover excludes trips) | ✅ structural | ✅ confirmed at source (A-10); **deployed edge fn v19 is PRE-Tr2** (sha b7cd2ef) — needs deploy before live-fire | |
| SC-25 (Trip RPC scope-leak guardrail) | ✅ structural | ✅ confirmed via A-14 | |

**Tester delta:** SC-09 is structurally complete but the publish-error UX layer is broken per P1-1, so the user-visible promise of SC-09 ("operator publishes; if validation fails, friendly inline error + jump to failing step") is half-broken in production.

---

## 7. Phase 0.A live-fire sim gate — status

| Surface | Status | Confidence | Notes |
|---|---|---|---|
| iOS Simulator | ATTEMPTED, deferred | `probable` | iPhone 17 Pro booted (UDID `17091E60-C3B6-4167-980D-60C348E177F6`). Existing dev build is Tr1-era; Tr2 routes (`/trip/create`, `/trip/{id}/edit`, `/t/{brandSlug}/{tripSlug}`) are not in the installed binary. Rebuild requires the full `Mingla_Artifacts/IOS_DEV_BUILD_REBUILD_RUNBOOK.md` 3-step xcodebuild + manual Pods-frameworks-script + codesign sequence (~30 min). Deferred to RETEST after P1-1 fix — implementor will rebuild for their own verification anyway. |
| Android Emulator | DEFERRED | `suspected` | Same rebuild blocker. Deferred to RETEST. |
| Web Preview | DEFERRED | `suspected` | Public anon route `/t/{brandSlug}/{tripSlug}` ships on web. Deferred to RETEST once any published trip exists to render against. |
| Backend (RPC + RLS + DB) | EXEMPT — verified via MCP probes | n/a | Migrations live + RLS policies verified via `pg_policy` introspection. No production trip data exists yet (`SELECT * FROM events WHERE event_type='trip'` returned 0 rows). |

**FAIL verdict basis (not live-fire-blocked):** the P1 is code-level proven via (a) source line at TripCreatorStep5Review.tsx:91 (`switch (code)` matches the wrong field), (b) Postgres semantics (`RAISE EXCEPTION 'foo'` without `USING ERRCODE` returns SQLSTATE `P0001`), and (c) a failing tester adversarial test at `mingla-business/src/components/trip/__tests__/publishErrorMapper.adversarial.test.ts`. Per Phase 0.A: "FAIL requires either a reproduced failure on sim OR a backend-only exempt finding with file/line proof." The bug is a UI-code defect provable at the file/line + failing-test layer, exhaustively documented above. Live-fire is unnecessary for FAIL classification but recommended at RETEST to confirm the fix renders the friendly translation in the wizard banner and triggers the step-pointer auto-jump.

---

## 8. Step 0.5 regression-test gate — status

| Gate item | Status |
|---|---|
| (a) Implementor jest tests at real path, fails-on-revert verified | ✅ verified: 30/30 PASS at `899b6c70`; implementor's report cites fails-on-revert verified at same commit. **BUT** see P2-1 — the publishTrip RPC-error test's mock is incorrect (mock matches the bug). The fails-on-revert technique still works (flipping `event_type:"trip"` → `event_type:"event"` fails the test) but the test does not exercise the publish-error UX promise. |
| (b) Tester adversarial regression test at real path, attacks different angle | ✅ committed at `mingla-business/src/components/trip/__tests__/publishErrorMapper.adversarial.test.ts` (6 checks, 5 pass + 1 fails exposing P1-1). After P1-1 fix lands, all 6 will pass. Fails-on-revert is inherently satisfied because the test is currently failing on the buggy code; reverting the future fix re-introduces the same failure. |
| (c) Both tests in `git diff origin/main...HEAD --name-only` | ⏸ pending CLOSE PR. Will land in the same PR as the implementor's Tr2 commit. |

**Gate verdict at this turn:** the implementor side (a) needs a follow-up assertion strengthening at RETEST (P2-1); the tester side (b) is already present at a real path and exposing the bug. Both will be re-verified at RETEST.

---

## 9. Constitution 14-rule check

| # | Rule | Status | Notes |
|---|---|---|---|
| 1 | No dead taps | ✅ PASS | Every wizard CTA routes; Reserve CTA routes; coming-soon redirects |
| 2 | One owner per truth | ✅ PASS | Two publish RPCs, each owns one event_type (narrowed but acceptable) |
| 3 | No silent failures | ⚠️ DEGRADED | The error IS thrown + surfaced (banner appears), but the **translation layer is broken (P1-1)** — operator sees raw technical text. The error doesn't silently swallow; it loudly mis-renders. P1 not P0 because user gets SOME feedback, just unfriendly. |
| 4 | One key per entity | ✅ PASS | `tripKeys` factory in useTrips.ts |
| 5 | Server state server-side | ✅ PASS | React Query throughout; Zustand only for currentBrandId |
| 6 | Logout clears everything | ✅ N/A | No new persisted state |
| 7 | Label temporary | ✅ N/A | No transitional code |
| 8 | Subtract before adding | ✅ PASS | Reuses existing checkout chain + existing AddressAutocompleteInput |
| 9 | No fabricated data | ✅ PASS | RLS gates drafts from anon; price/capacity from real ticket_types |
| 10 | Currency-aware | ✅ PASS | Operator dashboard aggregates by `order.currency`, displays per-currency total |
| 11 | One auth instance | ✅ PASS | Public trip route uses no useAuth (A-PUBLIC-1) |
| 12 | Validate at right time | ✅ PASS | Days-until-departure uses local Date |
| 13 | Exclusion consistency | ✅ PASS | discover filter excludes at producer; sidecar RLS excludes drafts at consumer |
| 14 | Persisted-state startup | ✅ N/A | No new persisted store |

---

## 10. Edge function deploy status (orchestrator-owned at CLOSE)

- `ticket-confirmation-dispatch` — local source has Tr2 trip-branch edit + tripConfirmationEmail import (verified via grep). **Deployed version 52 (sha 4f2e1ae) is PRE-Tr2.** Trip orders that go through `ticket-checkout-confirm` → dispatch will currently render with the event template (cosmetic regression — trip data not present in template means generic copy), no PDF will be wrong because `ticket_types` still exists, but no trip-shaped sections appear. Must deploy at CLOSE.
- `discover-merged-events` — local source has `.eq("event_type", "event")` filter. **Deployed version 19 (sha b7cd2ef) is PRE-Tr2.** Until deployed, ANY published trip will leak into the consumer Discover feed as if it were a regular event — visible to anonymous + authenticated consumer-app users. **Caution:** if any operator publishes a trip on production BEFORE the discover deploy, it surfaces in the consumer feed. Either deploy before any operator publishes, or accept the risk window.

Deploy commands for orchestrator at CLOSE (per `feedback_orchestrator_deploys_edge_functions`):

```bash
supabase functions deploy ticket-confirmation-dispatch --project-ref gqnoajqerqhnvulmnyvv
supabase functions deploy discover-merged-events --project-ref gqnoajqerqhnvulmnyvv
```

---

## 11. Discoveries for orchestrator

- **DISCOVERY-1 (this report's P1-1)** — the publish-error mapper discriminator bug. Already FAIL-blocking.
- **DISCOVERY-2** — implementor jest mock pattern was inverted from production reality (P2-1). Suggests a process-improvement follow-up: tester or implementor should add a "Postgrest error shape primer" to the references library so future implementors don't mock `code` as the user-defined RAISE name. The existing META-ORCH-NNNN registered at IMPLEMENT-time (forensics+SPEC body-read discipline for extend-vs-fork decisions) is adjacent but distinct; consider a separate META-ORCH for Postgrest contract verification at SPEC-time.
- **DISCOVERY-3** — `discover-merged-events` window: until the edge deploy lands, any published trip will appear in the consumer Discover feed. Either gate publish capability behind a feature flag or rush the deploy at CLOSE. The risk is mitigated because no trip-planner brand has published a trip yet (verified: 0 rows in `events WHERE event_type='trip'`).
- **DISCOVERY-4** — SC-18 Stripe Connect Dashboard probe is still deferred. Implementor's report flagged this; at RETEST after P1-1 fix, the orchestrator or operator should run a $1 test-mode Stripe Connect probe on a real published trip to confirm trip revenue routes to the brand's connected account.

---

## 12. Verdict

**FAIL** — 1 P1 blocking issue. Friendly publish-error translation + step-pointer auto-jump is non-functional on every error path. Code-level proven via failing tester adversarial test at `publishErrorMapper.adversarial.test.ts` + source line at `TripCreatorStep5Review.tsx:91` + Postgres `RAISE EXCEPTION` SQLSTATE semantics.

Migrations live + 30/30 implementor jest PASS + 14/14 implementor adversarial PASS + RLS policy SQL verified + Constitution check passes 12/14 with 2 N/A and 1 degraded (rule #3). FAIL is narrow and localized — implementor rework is one-line in the mapper file.

RETEST after fix: re-run all 30 implementor jest + 14 implementor adversarial + 6 tester adversarial (expect 6/6 PASS), then proceed to iOS sim + Android emu + web preview live-fire. Edge function deploys + Stripe Connect probe also block CLOSE.
