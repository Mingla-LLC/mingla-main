# IMPLEMENTATION REPORT — ORCH-0859 [Tr2 Minimum Viable Trip] REWORK 4

**Status:** completed · **Verification:** passed at jest + adversarial + strict-grep; iOS smoke owed (§7)
**Skill:** Claude `mingla-implementor`
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Predecessor QA:** `Mingla_Artifacts/reports/QA_ORCH-0859_TR2_MINIMUM_VIABLE_TRIP_REPORT_RETEST_4.md` (FAIL, verdict reversal of RETEST 3 PASS)
**Tested HEAD:** `899b6c70` + REWORK 1 + 2 + 3 + 4 uncommitted edits

---

## 1. Layman summary

Two small product fixes + one new tester gate. Operator dashboard now has an "Edit" button that works for both draft and published trips (routes to the wizard, which loads the existing trip and lets you re-publish). The Events tab leak gets a 3-line diagnostic that prints filter state to the console — if the bug was stale-bundle (most likely), the rebuild itself fixes it; if it's a real source bug, the next smoke will tell us exactly which filter step misbehaved. Plus a new Maestro flow that cycles all 5 Events filters and asserts no trip card appears — the canonical RETEST gate going forward.

---

## 2. Items shipped

### Item A — Events-tab-leak diagnostic instrumentation

**File:** `mingla-business/src/services/businessEvents.ts:495-505` (NEW block after the existing trip filter)

**Behavior:** logs `{ brandId, rowsCount, tripIdsCount, filteredCount }` after the filter runs, tagged with `[ORCH-0859-REWORK-4-DIAG]`. On operator's next smoke the console will show ground truth:
- `filteredCount === rowsCount - tripIdsCount` AND no trip in UI → filter working, prior leak was bundle/cache (rebuild fixed it).
- `filteredCount === rowsCount` (filter didn't run) → source bug, dispatch follow-up.
- `tripIdsCount === 0` despite known trip in view → RLS gap on the events probe, dispatch follow-up.

**Why not a real fix:** tester's RETEST 4 runtime jest (`businessEvents.fetchExcludesTrips.runtime.test.ts`, 3 tests PASS) proves the filter logic IS correct against controlled mocks. The leak must be at the bundle/cache layer OR a code path the audit hasn't found. Diagnostic answers both possibilities in one operator smoke.

**CLOSE protocol Step 1.5 DIAG-reap:** this log line MUST be deleted at the next CLOSE per META-ORCH-0744-PROCESS. Marker `[ORCH-0859-REWORK-4-DIAG]` is unique to this work so the grep finds it.

### Item B (P1 from RETEST 4) — Operator dashboard Edit button

**File:** `mingla-business/app/trip/[id]/index.tsx`

**Before:** dashboard header rendered back-arrow + title + invisible-spacer-for-balance. No edit affordance anywhere on the operator dashboard for either draft or published trips. Operators who landed on `/trip/{id}` (via deep link, hub/trips → published, post-publish router.replace) had no path back into the wizard.

**Now:** header right-slot replaced with an "Edit" Pressable. On tap: `router.push("/trip/${trip.id}/edit" as never)`. Wizard host at `app/trip/[id]/edit.tsx` already loads via `useTrip(eventId)` and populates all 5 steps for both draft AND published trips. For published trips, re-tapping Publish re-runs `business_publish_trip_draft` RPC which updates everything except slug (slug-immutability already enforced by `biz_prevent_event_slug_change` trigger from ORCH-0763 [event-system regression repair] + dual-flag fix from ORCH-0859 REWORK 3).

**Status-aware accessibilityLabel:** "Continue editing trip" (draft) vs "Edit published trip" (other statuses) — operator-facing UX for screen readers.

**No new wizard surface required** — wizard already handles published trips per operator product decision at REWORK 4 dispatch time (re-publish via wizard, not separate edit sub-screen).

### Item C (NEW) — Canonical Maestro flow for events-tab no-trip-leak

**File:** `mingla-business/maestro/tr2-events-tab-no-trip-leak.yaml` (NEW, 80 lines)

Launches the app, navigates to Hub → Events, cycles all 5 filters (All / Live / Upcoming / Drafts / Past), `assertNotVisible` on "The DC Adventure" trip title in each. Plus a positive cross-check on the Trips sub-tab confirming the trip DOES appear there (proves data exists; absence = test setup issue, not leak-fix issue).

This becomes the canonical RETEST gate for any future Tr2 event-tab change per the RETEST 4 verdict-methodology improvement.

**Operator runs with:**
```
~/.maestro/bin/maestro --device 17091E60-C3B6-4167-980D-60C348E177F6 test mingla-business/maestro/tr2-events-tab-no-trip-leak.yaml
```

---

## 3. Old → New receipts

### `mingla-business/src/services/businessEvents.ts`
- **Before:** `fetchBusinessEventsForBrand` ran view→probe→filter then returned mapped rows with no observability.
- **Now:** same logic + a 10-line diagnostic console.log block printing `{ brandId, rowsCount, tripIdsCount, filteredCount }`, tagged with `[ORCH-0859-REWORK-4-DIAG]` for CLOSE reap.
- **Why:** Item A operator-smoke diagnostic.
- **Lines changed:** +13.

### `mingla-business/app/trip/[id]/index.tsx`
- **Before:** dashboard header had back-arrow + title + invisible spacer. No edit affordance.
- **Now:** invisible spacer replaced by Edit Pressable with status-aware accessibilityLabel + testID `trip-dashboard-edit`. Plus 12 lines of new styles (`editBtn`, `editBtnText`).
- **Why:** Item B — close operator's RETEST 4 P1 finding.
- **Lines changed:** +22 (incl. comment block + styles).

### `mingla-business/maestro/tr2-events-tab-no-trip-leak.yaml` (NEW)
- 80-line Maestro flow per Item C.

### `mingla-business/app/trip/__tests__/trip-dashboard-edit.test.ts` (NEW)
- 7 source-grep regression tests across all 3 items + Maestro flow assertion.

### `mingla-business/scripts/ci/orch-0859-adversarial-check.mjs`
- **Before:** A-14 allowlist had 7 entries.
- **Now:** added `tr2_rework3.tester_adversarial.test.ts` (RETEST 3 file; legitimately references `business_publish_trip_draft` in migration-assertion section). 8 entries.
- **Why:** A-14 scope-leak guardrail false-positive on the tester's adversarial test that asserts migration structure. Pattern identical to REWORK 3's `eventType.filter.audit.test.ts` allowlist addition.
- **Lines changed:** +1.

---

## 4. Verification

### Jest (full Tr2 suite + new REWORK 4 test, fresh shell)

```
Test Suites: 13 passed, 13 total
Tests:       90 passed, 90 total  (was 83 after RETEST 3 follow-up; +7 from new dashboard-edit test)
```

### Adversarial structural CI

```
Result: 14 PASS, 0 FAIL
```

### Strict-grep gate

```
I-PROPOSED-TR2-EVENTS-TYPE-FILTER: scanned 100 files, 0 violations
```

### Regression-test gate (Step 0.5)

- **Implementor happy-path NEW for Item B:** `mingla-business/app/trip/__tests__/trip-dashboard-edit.test.ts` (7 tests across items A + B + C). Fails-on-revert verified for Item B by removing the Edit Pressable + replacing with the invisible spacer → 4 of 7 tests FAILed (the Edit-affordance section) → restored → 7/7 PASS again.
- **Item A NOT fails-on-revert tested** — it's instrumentation, not behavior. The DIAG marker assertion does fail if marker is removed (verified by test design — the regex `\[ORCH-0859-REWORK-4-DIAG\]` matches the source line).
- **Item C NOT fails-on-revert tested** — Maestro flow exists; flow-level assertion is "5 assertNotVisible + 1 assertVisible present" which trivially fails if the YAML is deleted.
- **Tester adversarial:** prior tester adversarial files (`publishErrorMapper.adversarial.test.ts`, `tr2_rework3.tester_adversarial.test.ts`) untouched. Tester will write a Maestro-driven adversarial flow at RETEST 5 — that's a sim-runtime attack on Item A's filter behavior in the actual bundle.

---

## 5. Cross-surface impact

| Surface | Touched | Behavior |
|---|---|---|
| Business iOS | YES | New Edit button on operator dashboard; new console.log on Events tab; Maestro flow targets this surface |
| Business Android | YES (shared RN code) | Same as iOS — Edit button + diagnostic log apply identically |
| Business Web preview | YES (shared) | Same — Edit button renders, console.log appears in browser console |
| Consumer iOS / Android | NO | `app-mobile/` untouched |
| Buyer/anonymous Web | NO | No buyer-anon route touch |
| Admin Web | NO | `mingla-admin/` untouched |

Parity automatic — all touched surfaces share the source.

---

## 6. Invariants preserved

- I-1.2-UNIFIED-EVENT-TYPE: preserved (Item A doesn't change filter logic).
- Constitution #2 (one owner per truth): preserved.
- Constitution #3 (no silent failures): improved (Item A makes filter state observable).
- Constitution #7 (label temporary): respected — DIAG marker explicitly tagged for reap.
- Append-only CI: respected. New test file additive; no existing test modified this rework.

---

## 7. Live-fire status + operator next steps

NOT performed in this Claude session. Pure TS changes — Cmd+R reload on the booted iPhone 17 Pro sim picks them up; no native rebuild required.

NEXT STEPS — for you, Seth:

1. **Hard-restart Mingla Business on the sim** (swipe up to kill from app switcher → relaunch). This is the key cache-eviction step that was missing in RETEST 4.
2. **Reload Metro** (Cmd+R) inside the app to ensure latest JS bundle is loaded.
3. Sign in as `travelbrand`.
4. **Navigate Hub → Events** → cycle filters (All / Live / Upcoming / Drafts / Past). Open the developer console (Metro logs in terminal) and watch for `[ORCH-0859-REWORK-4-DIAG]` lines:
   - If the log shows `rowsCount: 1, tripIdsCount: 1, filteredCount: 0` AND "The DC Adventure" does NOT appear in any filter → Item A confirms filter is working, bug was bundle/cache, no further fix needed.
   - If the log shows `rowsCount: 1, tripIdsCount: 0, filteredCount: 1` AND trip leaks → real source bug (event_type probe returning nothing); report back, REWORK 5 dispatched.
   - If no log appears at all → bundle didn't reload, force a deeper rebuild.
5. **Tap the published "The DC Adventure" trip from Hub → Trips** → land on operator dashboard → **tap Edit (top right)** → wizard should open at Step 1 with all fields populated → change a field (e.g. title) → walk through to Step 5 → tap Publish → should re-publish successfully with the field change applied. Item B verified.
6. **(Optional) Run the Maestro flow:**
   ```
   export PATH="/opt/homebrew/opt/openjdk/bin:$PATH"
   ~/.maestro/bin/maestro --device 17091E60-C3B6-4167-980D-60C348E177F6 test mingla-business/maestro/tr2-events-tab-no-trip-leak.yaml
   ```
   Expected: all 6 assertions PASS (5 not-visible across filters + 1 visible on Trips sub-tab).
7. **Report back with the console log output** from step 4 so the tester knows whether Item A was bundle/cache (fixed) or a real source bug (REWORK 5).

---

## 8. Discoveries for orchestrator

- **All carryover from REWORKs 1/2/3** remains open: brandsService trip-vs-event accounting (operator decision pending), edge-function event_type filter sweep ORCH, slug-trigger architectural cleanup ORCH, META-ORCH for forensics+SPEC body-read discipline, day-vs-night labeling decision.
- **NEW from REWORK 4:** tester verdict-methodology improvement (proposed in RETEST 4 P4 self-criticism) should be formalized as a process invariant at CLOSE: tester PASS on UI surfaces MUST be backed by either live Maestro flow OR operator-confirmed smoke step-by-step, NEVER just "operator published successfully therefore PASS".
- **NEW from REWORK 4:** `mingla-business/maestro/` is a new directory. CLOSE protocol may want to register a `maestro/` discovery rule for future ORCHs (Maestro flows are now a first-class regression artifact alongside jest + strict-grep).

---

## 9. Files changed (5)

```
M  mingla-business/src/services/businessEvents.ts                       (Item A diagnostic + DIAG marker)
M  mingla-business/app/trip/[id]/index.tsx                              (Item B Edit button)
A  mingla-business/maestro/tr2-events-tab-no-trip-leak.yaml             (Item C Maestro flow — NEW)
A  mingla-business/app/trip/__tests__/trip-dashboard-edit.test.ts       (regression test — NEW)
M  mingla-business/scripts/ci/orch-0859-adversarial-check.mjs           (A-14 allowlist for RETEST 3 tester file)
```

No new migrations. No edge function source changes. Edge function deploys (`ticket-confirmation-dispatch` v52 + `discover-merged-events` v19) STILL pending CLOSE.

---

## 10. CLOSE checklist additions (orchestrator owns)

- **Step 1.5 DIAG-reap MUST find and remove** the `[ORCH-0859-REWORK-4-DIAG]` console.log block at `businessEvents.ts:495-505` before commit. The marker is unique to this work.
- Other carryover CLOSE items unchanged from REWORK 3 §10: artifact sync, invariant promotion, deploy 2 edge fns, SC-18 Stripe probe, brandsService operator decision, META-ORCH registrations.
