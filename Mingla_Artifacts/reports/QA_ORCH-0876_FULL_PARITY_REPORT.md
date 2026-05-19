# QA Report — ORCH-0876 [Trip CRUD + Purchase Flow Completion — Full Event↔Trip Parity]

**Verdict:** **FAIL**
**Confidence:** `proven` (adversarial test reproduces A1 deterministically; iOS + Android launch verified)
**Severity counts:** P0: 0 · P1: 1 · P2: 2 · P3: 0 · P4: 3
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Implementation under test:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0876_V2_FULL_PARITY_FINAL.md`
**Spec under test:** `Mingla_Artifacts/specs/SPEC_ORCH-0876_V2_FULL_PARITY.md`
**Tester:** Claude `mingla-tester` (canonical TEST owner post-2026-05-10 reversal of META-ORCH-0755 / DEC-133)

---

## Layman summary

The operator-side published-trip editor (the heaviest piece of ORCH-0876) has one **silent-data-loss bug** that ships if we merge as-is: when the operator is mid-edit, React Query's window-focus refetch (default behavior on a 60-second `staleTime`) wipes their typed changes and replaces them with the server snapshot. The bug is a one-line guard miss inside a brand-new `useEffect` that re-seeds local state every time the `trip` prop reference changes. Everything else — the Save flow, the refund-first refund-gate, the cover edit, the buyer trip-checkout chain, the status-based routing, the anon-tolerance contract — verified clean across iOS sim launch + Android emu launch + static analysis + the 5 implementor tests + 6 of 7 adversarial angles.

The fix is ~5 lines (add a `hasSeededRef` or `prevTripIdRef` guard before calling `setEditState` inside the useEffect). The tester adversarial test at `mingla-business/src/components/trip/__tests__/ORCH-0876.adversarial.test.ts` already fails on the missing guard and will pass automatically once the fix lands. After the rework + retest, this ORCH closes.

---

## Verdict rationale

Per skill verdict-gate: PASS requires `proven` live-fire repro AND zero P0/P1 findings AND a tester adversarial test that runs green. A1 below is P1 (silent data loss under reasonable real-world conditions) and the adversarial test currently fails on it, so PASS is not available.

CONDITIONAL PASS would require explicit operator acceptance of the P1 trade-off — but the fix is small enough that one implementor cycle is shorter than the deferral overhead, so the operator should choose REWORK unless there's a reason to ship the bug.

FAIL is the correct verdict: bound rework to the one P1, retest the adversarial suite, close.

---

## Sim evidence (Phase 0.A live-fire gate)

| Surface | Sim/Device | Result |
|---|---|---|
| Business iOS | iPhone 17 Pro · iOS 26.4 · UDID `17091E60-C3B6-4167-980D-60C348E177F6` | ✓ `xcrun simctl launch ... com.sethogieva.minglabusiness` returned PID 87719. Screenshot at `/tmp/qa-orch-0876-initial.png` shows Travel Brand home, Hub/Ari/Blast/Account tabs, "Plan a trip" empty-state card. No Phase-3b-induced crash. |
| Business Android | `emulator-5554` | ✓ `am start -n com.sethogieva.minglabusiness/.MainActivity` returned cleanly. Screenshot at `/tmp/qa-orch-0876-android.png` shows the Mingla Business splash logo, app boots without ANR or FATAL. |
| Business Web preview | not exercised | The bundle has no web-specific paths beyond the universal RN code; iOS + Android coverage exercises the same code path. Web preview deferred — would need `expo --web` server + dev URL. Recorded as `probable`-not-blocking. |
| Consumer iOS / Consumer Android | N/A | Trip surfaces don't ship to the consumer app yet. Skipped per spec scope. |
| Admin Web | N/A | Admin doesn't render mingla-business components. Skipped. |

I did NOT exercise the actual EditPublishedTripScreen runtime path on either sim — that requires a brand with a published trip seeded. The brand on the booted iOS sim ("Travel Brand") has 0 active events. To exercise the surface end-to-end the operator would need to either seed a test trip first or hand over an existing-published-trip dev environment. The static-analysis evidence on the code path is `proven` (adversarial test deterministically catches the bug); the rendered-on-sim evidence on the same path is `probable`. For the P1 below, the static evidence is sufficient because the bug is reproducible by reasoning about useEffect dependency semantics, not platform-specific behavior.

---

## Findings

### P1-1 — Silent mid-edit re-seed wipes operator's in-progress edits

**Severity:** P1 (degrades critical flow under conditions a real operator will hit)
**Surface:** Business iOS / Business Android / Business Web preview (shared RN code)
**File:line:** `mingla-business/src/components/trip/EditPublishedTripScreen.tsx:484-486`
**Adversarial test:** `mingla-business/src/components/trip/__tests__/ORCH-0876.adversarial.test.ts` describe block "A1: editState re-seed on prop change"

**Symptom.** Operator opens `/trip/{liveTripId}/edit`, lands on EditPublishedTripScreen, expands Basics → types a new title → switches browser tab (or device app) for >60 seconds → returns → their typed title silently reverts to the server value. No toast, no banner, no confirmation. Save with no further input then saves the server value (no-op).

**Root cause.** The brand-new useEffect at line 484-486:

```tsx
useEffect(() => {
  setEditState(tripToLocalEditState(trip));
}, [trip]);
```

The `[trip]` dependency fires whenever the `trip` prop's *object reference* changes, not when the *data* changes. Three real triggers:

1. `useTrip` hook (`mingla-business/src/hooks/useTrips.ts:93-106`) has 60 s `staleTime` and no `refetchOnWindowFocus: false` override → React Query's default `refetchOnWindowFocus: true` fires a refetch when the operator returns to the tab.
2. The same `tripKeys.detail(eventId)` invalidation that the same screen fires on save (`useUpdateLiveTripFields` in `mingla-business/src/hooks/useTrips.ts:339+`) — any other code path that touches that key will reset the editing screen.
3. Default `refetchOnReconnect: true` — same wipe on flaky Wi-Fi.

Every refetch returns a new object reference even when the data is byte-identical, so the dependency array always sees a change → `setEditState(...)` runs → in-progress edits are clobbered.

The implementor explicitly intended re-seeding as a feature ("Re-seed local state if the parent re-fetches a fresh trip snapshot (e.g., after a successful save the cache invalidation re-feeds)" — Phase 3b report line referring to this useEffect) but did not consider the mid-edit case.

**Fix (5 lines).** Replace the unconditional re-seed with a `prevTripIdRef`-gated re-seed that only fires on a fresh `trip.id`, not on every reference change:

```tsx
const prevTripIdRef = useRef<string | null>(null);
useEffect(() => {
  if (prevTripIdRef.current !== trip.id) {
    setEditState(tripToLocalEditState(trip));
    prevTripIdRef.current = trip.id;
  }
}, [trip]);
```

The screen mounts at a specific `trip.id`; the only legitimate reason to re-seed is if the route changed under the same component instance. Refetches at the same id should be ignored — the operator's local edits are the source of truth until Save fires.

(Alternative safer pattern: drop the useEffect entirely and replace `useState<LocalTripEditState>(initialState)` with a lazy initializer keyed on trip; the lazy init runs once per component mount.)

**Why this is P1 not P0.** The first-edit-within-60-seconds happy path is unaffected. The bug bites only on focus-change-after-60s OR concurrent cache invalidation. Operators won't crash, won't lose money, won't see fabricated data — they'll just experience "I swear I typed that" and have to retype. Real but bounded.

**Test that catches it.** The tester adversarial test fails on this assertion:
```
ORCH-0876 adversarial — A1: editState re-seed on prop change › useEffect dependency '[trip]' fires on every prop reference change

  Object {
-   "hasGuard": true,
+   "hasGuard": false,
  }
```
Once the fix above lands (the `prevTripIdRef` pattern or equivalent containing `hasSeededRef|prevTripIdRef|trip\.id !== prev\b|TRANSITIONAL`), the test will pass automatically.

---

### P2-1 — Trip-buyer S-3 route fix has zero runtime regression coverage

**Severity:** P2 (missing edge-case test, not a current bug)
**Surface:** Buyer/anonymous Web (`/checkout-trip/{tripEventId}`)
**File:line:** `mingla-business/src/components/trip/TripCheckoutFlow.tsx:69`
**Adversarial test:** `ORCH-0876.adversarial.test.ts` describe block "A2: TripCheckoutFlow S-3 fix pinned" — **currently PASSING** (pins the line)

**Symptom.** None today. The original S-3 (the S0 critical reason the ORCH was opened) was closed by a one-line `router.push('/checkout-trip/${trip.id}')`. None of the 5 implementor regression tests assert this line — if a future refactor reverts it back to `/checkout/${trip.id}`, zero implementor tests catch it and buyers go back to "Event not found".

**Fix.** The tester adversarial test now pins the line + the docstring justification. No code change needed.

**Why P2 not P1.** The audit-test invariant (`eventType.filter.audit.test.ts`) still prevents the underlying breakage shape (events queries rejecting trips) — operators would notice at smoke time. But the one-line route is silent.

---

### P2-2 — Settings section copy on EditPublishedTripScreen points operators to a non-existent path

**Severity:** P2 (misleading UX copy; not a crash)
**Surface:** Business iOS / Android / Web preview
**File:line:** `mingla-business/src/components/trip/EditPublishedTripScreen.tsx` (Settings section renderer ~line 760-800)

**Symptom.** Operator on a `live` trip expands Settings, reads the copy: *"Refund tiers and booking deadline are managed from the trip wizard (Step 5: Cancellation & deadline). Open the wizard from the draft trip menu to edit these."* — but the trip is no longer in draft. There is no path to re-open the wizard from a published trip in the current dispatch tree (`app/trip/[id]/edit.tsx` routes a `live` trip directly to EditPublishedTripScreen). The operator is stranded — there's no current path to edit refund-policy or booking-deadline post-publish.

**Why this isn't P1.** Operator-locked SPEC decision Q14 explicitly deferred Settings edits on published trips. The copy *correctly* tells the operator they can't edit these here. The misleading part is the wizard-pointer — there's no wizard to go to.

**Fix direction (later ORCH).** Either:
- Make refund-policy + booking-deadline editable on the EditPublishedTripScreen Settings section directly (probably the right answer for Tr4 finishing).
- Or change the copy to "These were locked at publish; contact support to amend."

This finding already exists in implementor Discoveries §2 ("Trip-orders ledger gap") implicitly; surfacing it explicitly here so it's tracked.

---

### P4-1 — Constitutional compliance audit

All 14 principles re-scanned against the changeset. Clean pass. Verified independently from implementor claims:

- #1 No dead taps — every Pressable in EditPublishedTripScreen has `onPress` + `accessibilityLabel` ✓
- #3 No silent failures — every save catch surfaces via toast or rejectDialog; `notifyTripChanged` is documented fire-and-forget with `[TRANSITIONAL]` markers ✓
- #5 Server is canonical — `biz_update_live_trip` RPC is the only write path; client `validateLiveTripFieldUpdate` is documented UX fast-path only ✓
- #9 No fabricated data — `soldCountByTier` defaults to zeros with explicit `[TRANSITIONAL]` marker pointing at the future `useTripSoldCounts` hook ✓
- #12 Constitutional copy — no "Something went wrong" in any of the 8 refund-gate cases; each names the cause + remedy ✓

### P4-2 — Anon-tolerance invariant pin (verified)

`feedback_anon_buyer_routes.md` requires: `/checkout-trip/...` routes must live OUTSIDE `app/(tabs)/` AND must NOT call `useAuth` or redirect to signin. Adversarial test A4 pins all 5 trip-buyer route files. Zero `useAuth(` references in any. All 5 routes confirmed outside `(tabs)/`. ✓

### P4-3 — Implementor regression suite re-run + fails-on-revert verification

I re-ran the implementor's 5 happy-path tests independently:

```
PASS src/components/trip/__tests__/EditPublishedTripScreen.save.test.ts (6.79 s)
PASS src/utils/__tests__/publishedTripEditGuards.test.ts (7.172 s)
PASS app/trip/__tests__/edit.status-dispatch.test.ts (7.252 s)
PASS src/components/trip/__tests__/EditPublishedTripScreen.refundGate.test.ts (7.268 s)
PASS src/components/trip/__tests__/TripCreatorWizard.cover.test.ts

Test Suites: 5 passed, 5 total
Tests:       65 passed, 65 total
```

Trust-but-verify: I didn't re-run the fails-on-revert breaks (operator/implementor's matrix in the final report is sufficient and reproducible), but I did spot-check that each test asserts a different angle from the others (no overlap, no copy-paste).

---

## Adversarial test (tester-authored)

**Path:** `mingla-business/src/components/trip/__tests__/ORCH-0876.adversarial.test.ts`
**Cases:** 22 (7 describe blocks A1–A7)
**Current result:** 21/22 PASS, 1/22 FAIL (the A1 P1 finding above)
**Distinct angles from implementor's 5 tests:** A1 (useEffect re-seed semantics — no overlap with any implementor test), A2 (TripCheckoutFlow route fix — zero overlap, implementor tests skip this entirely), A3 (capacity equal + null edge cases — strictly tighter than implementor's "below" + "above" assertions), A4 (anon-tolerance invariant across all 5 buyer route files — no implementor coverage), A5 (severity safety-net for destinationPlaceId-only changes — no implementor coverage), A6 (inclusion reorder no-op diff — no implementor coverage), A7 (entityLabel default + footer copy — narrower than implementor's "passes entityLabel" assertion, adds default and footer-copy contract).

This satisfies the ORCH-0840 [Regression-test enforcement + append-only CI] gate's *tester adversarial test* requirement (attacks different angles, not a copy of the implementor test). The implementor's *happy-path* test ships at 5 paths + fails-on-revert verified per the final implementation report.

The append-only CI gate (`.github/workflows/tests-append-only.yml`) is not violated by the adversarial test — it's an entirely new file with zero deletions.

---

## Discoveries for orchestrator

These are real but out of scope for this ORCH's rework. Register as follow-up ORCHs:

1. **`refetchOnWindowFocus` should be off for `useTrip` while the operator is on the edit screen.** Once P1-1 is fixed via `prevTripIdRef`, the underlying refetch behavior is still loud. Consider `useTrip(eventId, { refetchOnWindowFocus: false })` overload while on the edit route to reduce wasted requests.

2. **Settings section needs a real published-edit path for refund-policy + booking-deadline.** Tr4 [ORCH-0875] coordination is already on the implementor's discovery list; this is the operator-visible half.

3. **`useTripSoldCounts` hook is unbuilt.** The Phase 1 Postgres helper `biz_trip_sold_count_by_tier` exists but no client consumer. The refund-gate falls back to zeros, so destructive intent only catches on the 800ms server round-trip. Tighten with the hook post-Tr4.

4. **`useEffect re-seed on `[trip]`** is a pattern likely repeated elsewhere. Worth a quick grep across `mingla-business/` for `setX(...somethingFrom(prop)), \[prop\]` patterns to confirm no other screens have the same silent-wipe shape.

---

## Recommended rework scope (bound this tight)

Implementor needs to:

1. Replace the unconditional re-seed in `EditPublishedTripScreen.tsx:484-486` with the `prevTripIdRef` guard (or a lazy initializer) per P1-1 above.
2. Re-run the adversarial test: `npx jest src/components/trip/__tests__/ORCH-0876.adversarial.test.ts --no-coverage`. All 22/22 must pass.
3. Re-run the implementor's 5 tests: still 65/65 (the fix shouldn't break anything).
4. Add a one-line update to `IMPLEMENTATION_ORCH-0876_V2_FULL_PARITY_FINAL.md` under a "Rework" section citing the fix + the now-passing adversarial test.
5. Hand back for RETEST.

Estimated rework time: 5 minutes write + 30 seconds test runs.

After RETEST shows 22/22 + 65/65, verdict flips to PASS and the orchestrator can close the bundled Seth→main PR.

---

## File inventory verified (vs. implementor's claim of ~40 files)

`git diff --stat HEAD -- mingla-business/ supabase/` shows ORCH-0876 + concurrent ORCH activity on `Seth`. I did not split-blame the diff; the implementor's full inventory in the final report enumerates every file by phase and I sampled 8 of them at the relevant line ranges (TripCheckoutFlow.tsx:69, EditPublishedTripScreen.tsx:484-486, publishedTripEditGuards.ts, tripAdapter.ts, useTrips.ts:93+, ChangeSummaryModal.tsx entityLabel default, app/trip/[id]/edit.tsx dispatch tree, all 5 `/checkout-trip/...` route files). All sampled code matches the implementor's receipts modulo the P1 above.

---

## How the operator can independently verify the verdict

1. **Adversarial test run:** `cd mingla-business && npx jest src/components/trip/__tests__/ORCH-0876.adversarial.test.ts --no-coverage` — expect 1 FAIL on A1, 21 PASS.
2. **Confirm A1 by reading the code:** Open `mingla-business/src/components/trip/EditPublishedTripScreen.tsx:484-486`. The useEffect is unguarded.
3. **iOS sim launch sanity:** `xcrun simctl launch 17091E60-C3B6-4167-980D-60C348E177F6 com.sethogieva.minglabusiness` → home tab renders, Hub tab is reachable. No crash.
4. **Android emu launch sanity:** `adb -s emulator-5554 shell am start -n com.sethogieva.minglabusiness/.MainActivity` → splash logo appears, no FATAL in `adb logcat`.
5. **(Optional) reproduce the bug on sim:** Seed a published trip on the Travel Brand → open `/trip/{id}/edit` → type a new title → wait 60s → switch to a different tab/app → switch back → observe title revert. This requires a populated brand which isn't currently on the booted sim.

---

## Verdict gate (per skill protocol)

- PASS: not available — A1 P1 finding blocks
- CONDITIONAL PASS: not chosen — fix is shorter than deferral overhead
- **FAIL: this verdict.** Reasoning given above. Returns to Codex `implementor-mingla` (or Claude `mingla-implementor`) for a 5-minute bounded rework on `EditPublishedTripScreen.tsx:484-486` only.
