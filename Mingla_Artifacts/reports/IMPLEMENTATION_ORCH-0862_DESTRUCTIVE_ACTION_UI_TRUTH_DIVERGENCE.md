# IMPLEMENTATION — ORCH-0862 [Destructive-action UI-truth divergence]

**Phase:** IMPLEMENT complete. **Owner:** Claude `mingla-implementor` (executed by Claude `mingla-orchestrator` under operator "ship it" delegation, in-session per operator side-choice).
**Spec:** [Mingla_Artifacts/specs/SPEC_ORCH-0862_DESTRUCTIVE_ACTION_UI_TRUTH_DIVERGENCE.md](Mingla_Artifacts/specs/SPEC_ORCH-0862_DESTRUCTIVE_ACTION_UI_TRUTH_DIVERGENCE.md)
**Investigation:** [Mingla_Artifacts/reports/INVESTIGATION_ORCH-0862_DESTRUCTIVE_ACTION_UI_TRUTH_DIVERGENCE.md](Mingla_Artifacts/reports/INVESTIGATION_ORCH-0862_DESTRUCTIVE_ACTION_UI_TRUTH_DIVERGENCE.md)
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
**Parent commit (fails-on-revert reference):** `899b6c703c56dfe517f72eca657c462434b98def`

---

## 1. Pre-flight verifications

- **§12 out-of-scope discovery (orphan events check):** MCP-probed live DB at 2026-05-17 18:30Z:
  - `SELECT COUNT(*) FROM events e WHERE e.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM event_dates ed WHERE ed.event_id = e.id);` → **6 orphan events**.
  - `SELECT status, COUNT(*) FROM events ... GROUP BY status` over the orphan set → **1 cancelled + 5 draft, zero `scheduled` or `live`**.
  - **Conclusion:** the `event_dates!inner` join in F-2 is safe; scheduled/live events always have at least one event_dates row per the publish-flow validation. No need to switch to LEFT-JOIN semantics or RPC. Recorded as a Discovery for any future audit.

- **No DB migration** required.
- **No edge function deploy** required.
- **No native module change** — pure JS/TS edits. EAS OTA-eligible.

## 2. Files changed (final manifest)

| File | Change |
|---|---|
| [`mingla-business/app/event/[id]/index.tsx`](mingla-business/app/event/%5Bid%5D/index.tsx) | F-1: dropped 2× `router.replace("/(tabs)/hub/events" as never);` from `handleCancelConfirm` (server-backed success path lines ~294 + legacy client-side path lines ~314); removed `router` from `useCallback` dependency array; added ORCH-0862 protective comments at both deleted sites. |
| [`mingla-business/src/services/brandsService.ts`](mingla-business/src/services/brandsService.ts) | F-2: Step 1 count query upgraded to `.select("id, event_dates!inner(end_at)", ...)` + `.gt("event_dates.end_at", nowIso)`. Comment explains DISCOVERY-7 rationale + cites ORCH-0850 [End-not-start parity systemic] alignment. Step 2 nowIso declaration removed (reuses Step 1's). |
| [`mingla-business/src/hooks/useBrands.ts`](mingla-business/src/hooks/useBrands.ts) | F-2: `useBrandCascadePreview`'s `upcomingResult` + `liveResult` queries upgraded with `event_dates!inner(end_at)` + `.gt("event_dates.end_at", nowIso)`. `pastResult` unchanged (status-only authoritative for ended/cancelled). |
| [`mingla-business/src/store/liveEventStore.ts`](mingla-business/src/store/liveEventStore.ts) | F-3: `partialize` returns `{ events: [] }` (no server-snapshot persistence); `version` bumped 4 → 5; v4→v5 migrator branch added that returns `{ events: [] }`. Storage key name preserved (`mingla-business.liveEvent.v1`) so existing users hit the migrator. Comment cites I-PROPOSED-J (ACTIVE post-ORCH-0742 [Zustand persist no server snapshots]). |
| [`mingla-business/app/event/[id]/__tests__/cancel-no-navigation.test.tsx`](mingla-business/app/event/%5Bid%5D/__tests__/cancel-no-navigation.test.tsx) | IM-1: structural jest test, 5 assertions — handler body contains zero `router.replace` calls, retains `setCancelDialogVisible(false)` + "Event cancelled." toast, deps array excludes `router`, protective comment marker present. |
| [`mingla-business/src/services/__tests__/softDeleteBrand-past-ghost.test.ts`](mingla-business/src/services/__tests__/softDeleteBrand-past-ghost.test.ts) | IM-2: behavioural jest test, 5 assertions — mocked supabase chain verifies `event_dates!inner` in select arg, `.gt("event_dates.end_at", <ISO>)` chained, `.in("status", ["scheduled","live"])` preserved, return value is `{rejected: false}` when count=0, AND `{rejected: true, upcomingEventCount: N}` when count>0 (regression guard for non-ghost blockers). |
| [`mingla-business/src/store/__tests__/liveEventStore-v4-v5-migrator.test.ts`](mingla-business/src/store/__tests__/liveEventStore-v4-v5-migrator.test.ts) | IM-3: structural jest test, 7 assertions — version bumped to 5, partialize returns `events: []` (not `state.events`), v4 migrator branch present + returns empty, ORCH-0862 marker comment present, storage key name preserved, legacy v1/v2/v3 migrator branches preserved for audit. |
| `.github/scripts/strict-grep/i-brand-delete-blocking-date-aware.mjs` | CI gate per spec §10. Asserts both `softDeleteBrand` Step 1 AND `useBrandCascadePreview` queries have `event_dates!inner` + `.gt("event_dates.end_at", ...)` filters. |
| `.github/scripts/strict-grep/i-event-detail-cancel-no-navigation.mjs` | CI gate per spec §10. Asserts `handleCancelConfirm` body contains zero `router.replace` / `router.push` / `router.back` calls (comments stripped before grep so the protective comment doesn't trigger). |
| `.github/workflows/strict-grep-mingla-business.yml` | Registered both new gates (registry-pattern per `feedback_strict_grep_registry_pattern.md`); added entries to the comment header + 2 new jobs at the end. |

**Total: 10 files** (4 product code + 3 tests + 2 CI gates + 1 workflow). Spec §11 estimate was ~13 files; under-budget because the 2 CI gate files include workflow as one update, not separate.

## 3. Behavioral contract verification

### F-1 (Symptom A — drop navigation)

| Aspect | Before fix | After fix |
|---|---|---|
| Server-backed cancel success | `await cancelEvent → setCancelDialogVisible(false) → showToast → router.replace("/(tabs)/hub/events")` | `await cancelEvent → setCancelDialogVisible(false) → showToast` (in place) |
| Legacy client-side cancel | `cancelSleep → updateLifecycle → setCancelDialogVisible(false) → showToast → router.replace(...)` | `cancelSleep → updateLifecycle → setCancelDialogVisible(false) → showToast` (in place) |
| Error path | `showToast("Could not cancel event. Try again.")` | UNCHANGED |
| Re-render mechanism | Cache invalidate by `writePublishedEventCaches` → `useBusinessEventById` refetch → screen renders new status | UNCHANGED — the cache-write path was already the source-of-truth flip; navigation was redundant + harmful |

Behavioral guarantee (verified via IM-1 + CI gate): no `router.replace`/`router.push`/`router.back` calls inside `handleCancelConfirm`. Screen re-renders in place; status pill flips from Live/Upcoming → Ended; user taps back to leave.

### F-2 (DISCOVERY-7 — date-aware blocking)

| Aspect | Before fix | After fix |
|---|---|---|
| `softDeleteBrand` Step 1 query | `from("events").select("id").eq("brand_id", X).in("status", ["scheduled","live"]).is("deleted_at", null)` | `from("events").select("id, event_dates!inner(end_at)").eq("brand_id", X).in("status", ["scheduled","live"]).is("deleted_at", null).gt("event_dates.end_at", nowIso)` |
| `useBrandCascadePreview` upcoming | `.eq("status","scheduled")` only | + `event_dates!inner` + `.gt("event_dates.end_at", nowIso)` |
| `useBrandCascadePreview` live | `.eq("status","live")` only | + `event_dates!inner` + `.gt("event_dates.end_at", nowIso)` |
| `BRAND_DELETE_BLOCKING_EVENT_STATUSES` | `['scheduled','live']` | UNCHANGED (date filter is additional) |
| Past-dated ghost event behaviour | counted as blocker → "Cannot delete this brand — 1 upcoming event" terminal rejection | excluded → delete proceeds normally |
| Future-dated real event behaviour | counted as blocker → rejection | UNCHANGED — still blocks (correct) |
| Multi-date event behaviour | single count | implementor verification needed (deferred to AD-2 tester test); MCP probe of current data shows zero scheduled events have 2+ future event_dates rows, so behaviour drift on live data is zero |

### F-3 (DISCOVERY-1 — liveEventStore I-PROPOSED-J compliance)

| Aspect | Before fix | After fix |
|---|---|---|
| `partialize` return | `{ events: state.events }` (full LiveEvent[] with serverEventId, status, cancelledAt, content) | `{ events: [] }` (zero server-snapshot persistence) |
| `version` | 4 | 5 |
| v4 → v5 migrator | not present | discards persisted events, returns `{events: []}` |
| Cold-start UI render | reads stale snapshot from AsyncStorage → React Query refetch overrides | in-memory state `[]` → React Query hydrates from server → UI renders fresh |
| Cross-device staleness risk | HIGH — device A's cancelled-event snapshot survives on device B | ELIMINATED |
| Mid-session behaviour | unchanged | UNCHANGED — events accumulate in memory via existing converter paths |
| Storage key | `mingla-business.liveEvent.v1` | UNCHANGED (so existing users hit the v4→v5 migrator) |
| Legacy v1/v2/v3 migrators | present | PRESERVED for audit trail |

## 4. Tests run + fails-on-revert verification (ORCH-0840 Step 0.5)

**Parent commit for fails-on-revert reference:** `899b6c703c56dfe517f72eca657c462434b98def`

| Test ID | Path | On fix HEAD | Fails-on-revert at parent? | Verification |
|---|---|---|---|---|
| **IM-1** | `mingla-business/app/event/[id]/__tests__/cancel-no-navigation.test.tsx` | **5/5 PASS** | **YES — 3/5 FAIL** | `git checkout HEAD -- mingla-business/app/event/[id]/index.tsx` (reverts F-1) → rerun jest → `Tests: 3 failed, 2 passed, 5 total`. Restored from `/tmp/orch0862-eventdetail-fixed.bak`. |
| **IM-2** | `mingla-business/src/services/__tests__/softDeleteBrand-past-ghost.test.ts` | **5/5 PASS** | **YES — 3/5 FAIL** | `git checkout HEAD -- mingla-business/src/services/brandsService.ts` (reverts F-2) → rerun jest → `Tests: 3 failed, 2 passed, 5 total`. Restored. |
| **IM-3** | `mingla-business/src/store/__tests__/liveEventStore-v4-v5-migrator.test.ts` | **7/7 PASS** | **YES — 4/7 FAIL** | `git checkout HEAD -- mingla-business/src/store/liveEventStore.ts` (reverts F-3) → rerun jest → `Tests: 4 failed, 3 passed, 7 total`. Restored. |

**CI gates fails-on-revert** (additional layer of regression protection):

| Gate | On fix HEAD | At parent commit |
|---|---|---|
| `i-brand-delete-blocking-date-aware.mjs` | **PASS** | **FAIL with 2 violations** ("missing `event_dates!inner` join" + "missing `.gt('event_dates.end_at', <nowIso>)` filter") |
| `i-event-detail-cancel-no-navigation.mjs` | **PASS** | (assumed FAIL — gate logic asserts zero `router.replace` calls and the parent commit has 2; not separately re-verified but the regex pattern is symmetric to the test pattern that already verified-on-revert) |

**No-regression verification on existing test suites:**

- `mingla-business/src/services/__tests__/brandsService.test.ts` — **5/5 PASS** (unchanged)
- `mingla-business/src/services/__tests__/brandsService.tripPlannerKind.test.ts` — **6/6 PASS** (unchanged)
- `mingla-business/src/hooks/__tests__/brandListState.test.ts` — **5/5 PASS** (unchanged)

Total: 16 pre-existing tests + 17 new implementor tests = **33 tests passing**. Zero existing tests regressed.

## 5. Spec-criterion mapping

| SC | Mapping |
|---|---|
| **SC-1** (cancel completes without freezing) | F-1 + IM-1 cover the structural side; live-fire repro on Leggo This is tester's TLF-1 responsibility (deferred). |
| **SC-2** (back navigation works post-cancel) | No code touched — pre-existing handleBack flow continues to work. Tester verifies via TLF-1 once at the sim. |
| **SC-3** (past-ghost brand deletable) | F-2 + IM-2 (mocked count=0 → rejected=false). Tester TLF-2 verifies live on Test Stripe. |
| **SC-4** (future-event brand still rejected) | F-2 + IM-2 (count>0 → rejected=true). Tester TLF-2 verifies live on Leggo This. |
| **SC-5** (multi-date event counts as 1) | Deferred to tester AD-2 adversarial — implementor IM-2 covers the single-date case. MCP probe shows zero current scheduled events have 2+ future dates, so live blast radius is zero. |
| **SC-6** (cold-start populates via React Query post-F-3) | F-3 + IM-3 covers the structural side. Tester verifies via TLF cold-start. |
| **SC-7** (cross-device staleness eliminated) | F-3 — semantic guarantee, no test on the implementor side; tester two-device or AsyncStorage-simulation. |
| **SC-8** (auto-recovery preserved per operator directive) | No code touched — the auto-recovery is the existing `resolveCurrentBrandId` "newest-brand" branch + `resolveCurrentBrandId → reason="none"` empty-state path. Tester verifies SC-8's two branches in QA. |

## 6. Implementation discoveries (none ORCH-0862-blocking)

- **DISCOVERY-impl-1 (P3):** `Step 2` of `softDeleteBrand` previously declared its own `nowIso` constant for the `deleted_at` timestamp. The F-2 change introduced `nowIso` in Step 1, creating a TS2451 redeclare error. Resolved by removing the Step 2 redeclaration and reusing Step 1's value (drift between count time and UPDATE time is sub-second, acceptable for an audit timestamp). Could be cleaner if both timestamps were derived from a single explicit `transactionTime` constant at function entry — not required for this ORCH.
- **DISCOVERY-impl-2 (P4 / positive):** the existing `mingla-business/jest.config.*` setup happily picks up `.test.tsx` files inside `app/event/[id]/__tests__/` directories despite the `[id]` Expo Router bracket convention. Useful pattern for future implementor tests on dynamic-route screens.
- **DISCOVERY-impl-3 (P3):** original spec §10 comment text "(router.replace was racing the 200ms Modal exit + iOS UIViewController dismissal)" included the literal string `router.replace` which triggered the IM-1 structural test's grep. Rephrased to "(the prior post-cancel route swap raced ...)". The CI gate strips comments before grepping but the jest test (intentionally) does not — preferred more aggressive coverage. Implementor learning: structural tests with comment grep semantics need either comment-strip preprocessing or comment-phrasing that avoids the literal banned string.

## 7. Next phase

Hand-off to Claude `mingla-forensics` TEST mode (canonical TEST owner per `feedback_tester_canonical_and_platform_parity.md`). Tester writes the 3 adversarial regression tests (AD-1, AD-2, AD-3) per spec §8, runs the sim live-fire flows (TLF-1 + TLF-2), produces verdict + QA report at `Mingla_Artifacts/reports/QA_ORCH-0862_DESTRUCTIVE_ACTION_UI_TRUTH_DIVERGENCE_REPORT.md`.
