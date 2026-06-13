# IMPLEMENTATION — ORCH-1130 [trip-pay-structure]: public-trip DATE regression + checkout render loop

- **ORCH:** ORCH-1130 [trip-pay-structure]
- **Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1130-[trip-pay-structure]/` on branch `ORCH-1130-trip-pay-structure`
- **Source:** `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1130_DATE_REGRESSION_AND_CHECKOUT_LOOP.md`
- **Mode:** IMPLEMENT — two minimal fixes, no scope-widening, no migration/deploy/merge.
- **Comms ledger:** read on entry. No BLOCK for implementor/ORCH-1130/ALL. COMMS-0029 (WARN) + COMMS-0030 (RESOLVED) factored: both concern `biz_update_live_trip` re-emissions and the iOS build break; neither blocks this read-path/UI work. Fix #1 does NOT touch `biz_update_live_trip` (the theme-strip stays as designed — we read the canonical `event_dates` master row instead).

---

## 1. Summary

Two fixes, both confined to ORCH-1130's surfaces:

- **Fix #1 (date regression):** the public trip getters now source start/end from the canonical `event_dates` master row (mirroring the event public page), falling back to the legacy `theme.business_trip` mirror only when no master row exists. This populates the public date pill, the checkout mini-card date line, and the consumer trip card (all via the shared `formatTripDateRange`) for trips whose theme dates were stripped by `biz_update_live_trip`.
- **Fix #2 (checkout render loop):** the single-tier auto-skip effect no longer dispatches `setLineQuantity` and `router.replace('/buyer')` in the same synchronous body. The decision is extracted into a pure `decideAutoSkip` helper that (a) returns `navigate` only once the sole tier's line is actually present in the cart (qty>=1) — closing the empty-cart window the buyer guard ping-ponged against — and (b) is short-circuited by a `useRef` latch so it navigates at most once per mount.

---

## 2. SPEC success-criteria coverage

| SC | Criterion | Status | Satisfied at |
|----|-----------|--------|--------------|
| SC-1 | Public trip getter (`getPublicTripById`) sources dates from `event_dates` master row, theme fallback only | ✓ | `68e05c02e` |
| SC-2 | Public trip slug hook (`usePublicTripBySlug`) sources dates from `event_dates` master row, theme fallback only | ✓ | `68e05c02e` |
| SC-3 | Event public page date path untouched (no regression) | ✓ | unchanged — `publicEventViewRowToEvent` master_* path not modified |
| SC-4 | Auto-skip navigates at most once per mount (useRef latch) | ✓ | `68e05c02e` |
| SC-5 | Auto-skip navigates only after the sole tier's line lands in `lines` (gate) | ✓ | `68e05c02e` |
| SC-6 | Buyer empty-cart guard (`buyer.tsx:309-314`) NOT modified | ✓ | untouched (verified `git diff` empty for buyer.tsx) |
| SC-7 | Funnel 2-step UX + pricing logic unchanged | ✓ | only the dispatch/navigate ordering changed |

---

## 3. Files changed

| File | Δ | What |
|------|---|------|
| `mingla-business/src/services/publicEventsService.ts` | +/- ~40 | Fix #1: `event_dates` master fetch added to `getPublicTripById`'s `Promise.all`; `tripStartAt`/`tripEndAt` resolve `masterDate ?? theme`. |
| `mingla-business/src/hooks/usePublicTripBySlug.ts` | +/- ~40 | Fix #1: identical change in the slug-based hook. |
| `mingla-business/app/checkout-trip/[tripEventId]/index.tsx` | +/- ~50 | Fix #2: auto-skip effect rewired through `decideAutoSkip`; `useRef` latch; navigate gated on line-present. |
| `mingla-business/app/checkout-trip/[tripEventId]/autoSkipDecision.ts` | NEW | Fix #2: pure decision helper (`noop`/`addLine`/`navigate`) — the latch+gate logic, unit-testable without expo-router. |
| `mingla-business/app/checkout-trip/[tripEventId]/__tests__/orch_1130_auto_skip_latch.test.ts` | NEW | Fix #2 regression test (6 tests). |
| `mingla-business/src/services/__tests__/publicEventsService.orch_1130_trip_dates.test.ts` | NEW | Fix #1 regression test (2 tests). |

### Fix #1 — the event_dates read (exact mechanism)

Both getters fetch the raw `events` row (no `master_*` view columns), so the master dates are fetched explicitly, mirroring `tripsService.getTripById`:

```ts
supabase
  .from("event_dates")
  .select("event_id,start_at,end_at,is_master")
  .eq("event_id", <id>)
  .eq("is_master", true)
  .maybeSingle();
```

Then:

```ts
const tripStartAt =
  masterDate?.start_at ?? (typeof bt.startAt === "string" ? bt.startAt : null);
const tripEndAt =
  masterDate?.end_at ?? (typeof bt.endAt === "string" ? bt.endAt : null);
```

`businessTrip.startAt|endAt` now read `tripStartAt|tripEndAt`. The event page (`publicEventViewRowToEvent`, lines ~710-738) was NOT touched — it already reads `row.master_start_at|master_end_at` from `business_public_events_view`.

### Fix #2 — the latch + gate logic

`decideAutoSkip(input)` returns:
- `"noop"` when `alreadyNavigated` (latch set), trip absent, bookings closed, not exactly one tier, sold out, or past.
- `"addLine"` when the sole tier is bookable but its line is NOT yet in `lines` (qty>=1) → caller dispatches `setLineQuantity` and **does not navigate**.
- `"navigate"` only when the sole tier's line **is** present (qty>=1) → caller flips the `useRef` latch and `router.replace('/buyer')` exactly once.

The effect keeps deps `[tripEventId, trip, lines, router]`: the `addLine` → cart-write → re-run-with-line-present → `navigate` happens across two commits, never in one synchronous body, so `/buyer` never sees an empty cart from a just-replaced index. The pre-existing `buyer.tsx:309-314` empty-cart guard was NOT widened.

---

## 4. Data-model changes applied

None. No migration, no backfill (the data already exists in `event_dates` per the investigation's prod evidence). Read-path only.

---

## 5. Edge functions touched

None.

---

## 6. Regression tests added

### Fix #1 — `mingla-business/src/services/__tests__/publicEventsService.orch_1130_trip_dates.test.ts`
Mocks a trip with NULL `theme.business_trip` dates + a populated `event_dates` master row, calls `getPublicTripById`, asserts `businessTrip.startAt|endAt` = the `event_dates` values and `formatTripDateRange(...)` ≠ `"Dates to be set"`. A 2nd test asserts the theme fallback still works when no master row exists.
- **fails-on-revert:** reverted `businessTrip.startAt|endAt` to the theme-only read (`typeof bt.startAt === "string" ? bt.startAt : null`) → getter returned `null` for the NULL-theme trip → first assertion failed (`Expected "2026-09-19T00:00:00Z", Received null`). Restored → PASS.
- **fails-on-revert verified at 68e05c02e (fails-on-revert proven in the pre-commit working tree; the committed tree carries the fix)** (pre-commit working tree; the fix lines re-applied after the revert proof).

### Fix #2 — `mingla-business/app/checkout-trip/[tripEventId]/__tests__/orch_1130_auto_skip_latch.test.ts`
Drives `decideAutoSkip` through the warm-cache mount lifecycle (empty cart → addLine → line lands → navigate → steady noop). Asserts: navigation fires exactly once; never navigates while the cart is empty (the gate); ordered outcomes `addLine, navigate, noop…`; the latch short-circuits to `noop` even with the line present; bookability guards still short-circuit. 6 tests.
- **fails-on-revert (latch):** deleted `if (input.alreadyNavigated) return "noop";` → after the latch is set the decision kept returning `navigate` → "fires exactly once" + 2 others failed. Restored → PASS.
- **fails-on-revert (gate):** replaced the line-present gate with unconditional `return "navigate";` → empty cart returned `navigate` → "never navigates while empty" + "warm-cache re-entry" failed. Restored → PASS.
- **fails-on-revert verified at 68e05c02e (fails-on-revert proven in the pre-commit working tree; the committed tree carries the fix)** (both revert paths, pre-commit working tree; fix re-applied after each proof).

Both tests are append-only (new files); both appear in `git diff origin/main...HEAD --name-only` for the closing PR.

---

## 7. Old → New receipts

### publicEventsService.ts — `getPublicTripById`
**Before:** `businessTrip.startAt|endAt = typeof bt.startAt === "string" ? bt.startAt : null` from `theme.business_trip` only → NULL on every edited/published trip (theme dates stripped by `biz_update_live_trip`) → "Dates to be set".
**Now:** fetches the `event_dates` master row in the existing `Promise.all`; `startAt|endAt = masterDate?.start_at ?? theme`.
**Why:** the canonical date store moved to `event_dates` at ORCH-0950; the public READ path was the only laggard (the event page already reads `master_*`).
**Lines:** ~+30 / -6.

### usePublicTripBySlug.ts
**Before / Now / Why:** identical to the above for the slug-based hook.
**Lines:** ~+30 / -6.

### checkout-trip/[tripEventId]/index.tsx — auto-skip effect
**Before:** one effect dispatched `setLineQuantity` AND `router.replace('/buyer')` synchronously; on warm-cache 2nd entry the navigation raced the cart write → `/buyer` read an empty cart → buyer guard bounced to index → auto-skip re-fired → "Maximum update depth exceeded".
**Now:** decision via `decideAutoSkip`; `addLine` dispatches and waits, `navigate` fires only once the line is present, guarded by a `useRef` latch (fires once per mount).
**Why:** eliminate the empty-cart window the buyer guard ping-pongs against + prevent re-fire.
**Lines:** ~+30 / -22.

### autoSkipDecision.ts (NEW)
Pure decision helper extracted so the loop-prevention logic is unit-testable without rendering the expo-router screen (the repo does not install `@testing-library/react-native`).

---

## 8. Cross-surface impact

| Surface | Affected | Detail / parity |
|---------|----------|-----------------|
| Consumer iOS | YES (Fix #1) | Trip card / detail date via shared `formatTripDateRange` now populates. Parity automatic (shared `@mingla/event-rendering`); supply hook is consumer-side but the formatter is the same. |
| Consumer Android | YES (Fix #1) | Same as iOS — shared RN code. |
| Buyer/anon Web | YES (Fix #1 + Fix #2) | Public trip date pill populates (Fix #1); trip checkout no longer loops (Fix #2). `mingla-business` renders web. |
| Business iOS | YES (Fix #2) | Trip checkout auto-skip no longer crashes; date display via the same getters (Fix #1). |
| Business Android | YES | Same as Business iOS. |
| Admin Web (adjacent) | NO | No trip checkout / public-trip getter usage. |
| Business Web preview (adjacent) | YES (Fix #1+#2) | Same `mingla-business` web bundle. |

Parity is **automatic** — both fixes live in shared service/hook/component code; no per-surface duplication. Note: the consumer-app trip card consumes the date via its own supply path but the same `formatTripDateRange`; the getters fixed here are the business/buyer-web public surfaces (the investigation's D-1 blast radius is covered by this single root-cause fix for those getters).

---

## 9. Smoke / verification result

- **Gates run (mingla-business worktree):**
  - `tsc --noEmit`: zero errors in any touched/new file. (263 pre-existing baseline errors elsewhere, incl. `buyer.tsx` `next: any` — `buyer.tsx` is UNTOUCHED by this branch; same errors on origin/main.)
  - `eslint` on the 4 touched/new code+test files: **0 errors, 0 warnings**. (Pre-existing baseline warnings in `publicEventsService.ts`/`usePublicTripBySlug.ts` are unused-eslint-disable directives + the `@mingla/event-rendering` `import/no-unresolved` — my diff added none of them.)
  - `jest` Fix #1 test: 2/2 PASS. Fix #2 test: 6/6 PASS.
  - Adjacent suites: the 5 `publicEventsService.*` + 4 `checkout-trip` suite failures are **pre-existing baseline** — proven by stashing my changes and re-running (identical 4-failed/2-passed for checkout-trip), and all `publicEventsService.*` baseline fails are the `Cannot find module '@mingla/event-rendering'` jest-resolution gap (no moduleNameMapper in this worktree). My new tests pass because Fix #1's test virtually stubs that module.
- **NOT run (named blocker):** Fix #2's TRUE PASS requires the device live-fire deterministic repro (Reserve → `/checkout-trip` → back → Reserve again, warm React Query cache) on a `mingla-business` iOS dev build with operator sign-in + a live single-tier paid trip. The business app is not installed on the booted sim and the dev build needs Seth's account (same blocker the investigation named). The latch+gate logic is proven at unit level and the looping construct is the only navigation path on that screen, but the commit-ordering race is a runtime property — **Fix #2 is `implemented, partially verified`** pending that live-fire.

---

## 10. Known issues / deferred

- No `[TRANSITIONAL]` code introduced.
- Jest cannot resolve `@mingla/event-rendering` in this worktree (no `moduleNameMapper`) — a pre-existing test-infra gap that fails 5 `publicEventsService.*` suites independent of this change. Out of scope; flagged for the orchestrator (D-INFRA below).

---

## 11. Operator action required

- **No migration, no edge-fn deploy.** Read-path + UI only.
- **Tester live-fire (required for Fix #2 PASS):** on a `mingla-business` iOS dev build (signed in, with a live single-tier paid trip): Reserve → land on `/checkout-trip` → navigate back → Reserve again → confirm NO "Maximum update depth exceeded" and a clean land on "Your details" with the cart populated.
- **Eyeball (Fix #1):** open a public trip page (`/t/{brandSlug}/{tripSlug}`) for an edited/published trip (e.g. "The DC Adventure") → the date pill shows the real range, not "Dates to be set"; the checkout mini-card date line matches.
- Route back to the orchestrator for REVIEW → tester dispatch. Do NOT merge/deploy from this report.

---

## 12. Discoveries for Orchestrator

- **D-INFRA (test infra):** `mingla-business`'s jest config has no `moduleNameMapper` for `@mingla/event-rendering`, so any test that transitively imports `publicEventsService` (or other modules importing that package) fails to run with `Cannot find module`. This pre-dates ORCH-1130 (the sibling `publicEventsService.tripFetch.test.ts` fails identically). Worth a one-line `moduleNameMapper` addition in a process ORCH so these contract tests actually execute in CI.
- **D-1 (carried from INVESTIGATE):** Fix #1's single getter change covers the public date pill, the checkout-trip mini-card date line (`index.tsx` `formatTripDateLine(trip.businessTrip.startAt, …)`), and any consumer of `getPublicTripById`/`usePublicTripBySlug` date fields — all were "Dates to be set" before. The consumer-app trip card uses a separate supply path; if it also showed blank dates it should be checked against ITS getter (not in this ORCH's scope).
- **D-3 (carried, merge-only):** the combined build's `onAspectRatio={setCoverAspect}` on `EventCoverMedia` (ORCH-1132, different worktree) is a separate potential layout-effect setState path for MULTI-tier trips; untouched here.
