# QA REPORT — ORCH-0862 [Destructive-action UI-truth divergence]

**Phase:** TEST complete (Claude `mingla-tester`, in-session via "take over" delegation).
**Spec:** [Mingla_Artifacts/specs/SPEC_ORCH-0862_DESTRUCTIVE_ACTION_UI_TRUTH_DIVERGENCE.md](Mingla_Artifacts/specs/SPEC_ORCH-0862_DESTRUCTIVE_ACTION_UI_TRUTH_DIVERGENCE.md)
**Implementation:** [Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0862_DESTRUCTIVE_ACTION_UI_TRUTH_DIVERGENCE.md](Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0862_DESTRUCTIVE_ACTION_UI_TRUTH_DIVERGENCE.md)
**Investigation:** [Mingla_Artifacts/reports/INVESTIGATION_ORCH-0862_DESTRUCTIVE_ACTION_UI_TRUTH_DIVERGENCE.md](Mingla_Artifacts/reports/INVESTIGATION_ORCH-0862_DESTRUCTIVE_ACTION_UI_TRUTH_DIVERGENCE.md)
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
**Parent commit (fails-on-revert reference):** `899b6c703c56dfe517f72eca657c462434b98def`
**Sub-mode:** TARGETED (10-step protocol per `references/targeted-protocol.md`)

---

## Verdict

**CONDITIONAL PASS** — P0:0 P1:0 P2:1 P3:2 P4:3

Deferral reason: F-1's post-fix live-fire on iPhone 17 Pro sim attempted; Maestro tap on the "Cancel event" Pressable row inside the EventManageMenu Sheet consistently missed the hit target across 3 retry permutations (text-tap, coord-tap at 40%/92%, coord-tap at 50%/92%). This is a **Maestro tooling blocker**, not a code defect — the screen IS responsive (verified by successful taps on Manage event icon, Orders tile, Hub tab, Cancel button in scrim, brand switcher rows), but the specific "Cancel event" trash-row at the very bottom of the manage menu Sheet doesn't fire on Maestro coordinate or text taps. Promoting `probable` → `proven` requires the operator to perform 4 manual taps on the sim (already booted, dev build current, Metro bundle includes F-1).

PASS gate per Phase 0.A live-fire sim gate:
- **F-1 Symptom A:** `probable` (sim attempt made, Maestro Cancel-row blocker named, Seth-action required). Source-level proof + AD-1 + IM-1 + CI gate cover the structural side; the iOS UIKit/RN-bridge race is the missing leg.
- **F-2 Symptom B + DISCOVERY-7:** `proven` pre-fix (live-fire on Test Stripe at 2026-05-17 12:09Z showed the rejection terminal step verbatim — screenshots in `/tmp/orch0862-b*.png`); `probable` post-fix (testing the delete-success path would destructively soft-delete operator's Test Stripe brand — withheld pending operator authorization).
- **F-3 DISCOVERY-1:** `probable` (cross-device staleness elimination requires 2-device setup or AsyncStorage scrub; structural pattern mirrors proven ORCH-0742 [Zustand persist no server snapshots] precedent).

---

## Sub-mode triage (Phase 0.B)

Skipped popup — orchestrator-dispatched with full context. Multi-layer (components + service + hook + store). Mode = TARGETED. Deployment target = both platforms (iOS + Android via single RN code). No web preview required (mingla-business `app/event/[id]/` and the brand-delete flow do not ship to buyer-web routes).

---

## Step 1 — Blast radius mapping

Changed files (per implementation report §2):

| File | Direct dependents (mobile) | Cross-domain reach |
|---|---|---|
| `mingla-business/app/event/[id]/index.tsx` | Self-contained route component | Hub list reads from same React Query keys; no impact (the cache write was already in place pre-fix, only navigation removed) |
| `mingla-business/src/services/brandsService.ts` (Step 1) | `useSoftDeleteBrand` → BrandDeleteSheet | `softDeleteBrand` is the sole DB writer for `brands.deleted_at`; admin doesn't call it; buyer-web doesn't expose it |
| `mingla-business/src/hooks/useBrands.ts` (cascade preview) | BrandDeleteSheet step 2 | Same scope as above |
| `mingla-business/src/store/liveEventStore.ts` (persist) | Every consumer reading `useLiveEventStore.*` selectors | In-memory state populates via existing converter paths; persist change is invisible mid-session |

Zero impact on: `app-mobile/` (consumer), `mingla-admin/`, `supabase/functions/`, edge functions.

---

## Step 2 — Implementation report audit

Verified each implementor claim:

| Implementor claim | Verification |
|---|---|
| F-1: dropped both `router.replace` lines | ✅ source diff confirms (2 deletions in handleCancelConfirm) |
| F-1: removed `router` from useCallback deps | ✅ source confirmed |
| F-1: added ORCH-0862 comment markers | ✅ both deletion sites carry the protective comment |
| F-2: service Step 1 has `event_dates!inner` + `.gt("event_dates.end_at", nowIso)` | ✅ structural test IM-2 confirms via mocked supabase chain; CI gate `i-brand-delete-blocking-date-aware.mjs` passes |
| F-2: hook cascade preview upcoming + live queries date-aware | ✅ both queries verified, CI gate covers |
| F-3: partialize returns `{ events: [] }` | ✅ confirmed (line 360); AD-3 assertion #9 verifies argument is `_state` not `state` |
| F-3: version bumped to 5 | ✅ confirmed (line 361) |
| F-3: v4 → v5 migrator returns `{ events: [] }` | ✅ confirmed (lines 381-387); AD-3 chain-integrity test passes |
| F-3: storage key name preserved | ✅ `mingla-business.liveEvent.v1` retained |
| Implementor tests IM-1 + IM-2 + IM-3 ship + pass + fails-on-revert at `899b6c70` | ✅ re-run independently: 17/17 PASS on fix HEAD; 3+3+4 FAIL on revert (matches implementor report §4) |
| MCP orphan-event probe (6 orphans, 0 scheduled/live) | ✅ re-probed: still 6 orphans, all draft/cancelled — inner-join safety holds |

Zero implementor claims found false.

---

## Step 3 — Forensic code reading

Re-read all 4 product code files with the layer-specific checklists from `references/targeted-protocol.md`:

| Layer | Hunt result |
|---|---|
| Service (`brandsService.ts`) | Step 1's nowIso reused by Step 2 (drift sub-second, acceptable for audit timestamp). The `.is("deleted_at", null)` filter still present. The `.in("status", BRAND_DELETE_BLOCKING_EVENT_STATUSES)` constraint preserved. No silent failure path introduced. `if (countError) throw countError;` still surfaces network errors. |
| Hook (`useBrands.ts`) | Cascade preview queries handle errors via `if (pastResult.error) throw pastResult.error;` chain. The `nowIso` constant is captured ONCE before Promise.all — both upcoming/live see the same instant (no race). |
| Component (`event/[id]/index.tsx`) | `handleCancelConfirm` retains the pessimistic `try/catch/finally` shape. Error path's toast "Could not cancel event. Try again." preserved. Both server-backed and legacy paths land in the same shape. `setCancelDialogVisible(false)` runs before the toast in both paths — Modal exit animation starts immediately. |
| Store (`liveEventStore.ts`) | Migrate function's fall-through `return persistedState as PersistedState` is reachable for any version > 5 (future-proof). v1→v5 chain composes correctly per AD-3 ordering assertion. |

No new null-access paths, no new unhandled rejections, no new `.single()` against potentially-empty rows.

---

## Step 4 — Constitutional compliance (14 rules)

| Rule | Verdict | Evidence |
|---|---|---|
| 1. No dead taps | PASS | All affected interactive elements still respond; F-1 removes navigation but preserves dialog dismiss + toast |
| 2. One owner per truth | PASS | Cache write (`writePublishedEventCaches`) remains the source-of-truth flip; navigation was redundant pre-fix |
| 3. No silent failures | PASS | Cancel error path still toasts; soft-delete rejection still surfaces; F-3 partialize change has zero runtime error surface |
| 4. One query key per entity | PASS | No key changes; cascade preview retains `brandKeys.cascadePreview(brandId)` |
| 5. Server state stays server-side | PASS+improvement | F-3 brings `liveEventStore` into compliance with I-PROPOSED-J (was violating pre-fix) |
| 6. Logout clears everything | N/A | No auth or storage-clear paths touched |
| 7. Label temporary | PASS | New TRANSITIONAL-class behaviour cited explicitly in comments; F-3 migrator is permanent (not a TRANSITIONAL) |
| 8. Subtract before adding | PASS | F-1 SUBTRACTS code (2 deletions); F-2 adds a date filter to existing query (not a parallel query); F-3 simplifies partialize |
| 9. No fabricated data | PASS | All counts derived from live DB queries; no synthetic numbers |
| 10. Currency-aware | N/A | No currency UI changes |
| 11. One auth instance | N/A | No auth paths touched |
| 12. Validate at right time | PASS | `nowIso = new Date().toISOString()` captured at query-execution time, not at component render — correct |
| 13. Exclusion consistency | PASS+improvement | F-2 ALIGNS the delete-blocking filter with the home/lifecycle filter; was inconsistent pre-fix (DISCOVERY-7), now consistent |
| 14. Persisted-state startup | PASS+architecture | F-3 changes persisted state to empty events array; React Query rehydrates on mount — `_hasHydrated` gate behaviour unchanged |

**Zero P0 constitutional violations.** F-3 in particular UPGRADES compliance with Rule 5 + I-PROPOSED-J.

---

## Step 5 — Behavioral contract verification

| Contract | Pre-fix | Post-fix | Verified by |
|---|---|---|---|
| `useCancelBusinessEvent.cancelEvent({eventId, brandId}) → PublishedBusinessEvent` | unchanged | unchanged | spec §5 F-1 explicit |
| `softDeleteBrand(brandId) → SoftDeleteResult` shape | `{rejected, reason, upcomingEventCount}` or `{rejected: false, brandId}` | UNCHANGED | IM-2 + AD-2 verify the shape on both branches |
| `useBrandCascadePreview(brandId).data` BrandCascadePreviewCounts | `{pastEventCount, upcomingEventCount, liveEventCount, teamMemberCount, hasStripeConnect}` | UNCHANGED (semantics change: upcoming/live now date-aware) | source review |
| `useLiveEventStore.*` selectors (getLiveEvent, getLiveEventsForBrand, etc.) | reads in-memory `events` | UNCHANGED — F-3 only changes the persist boundary, not the in-memory shape | AD-3 #11 verifies type shape unchanged |

Zero behavioral-contract regressions.

---

## Step 6 — Independent tests (tester-written adversarial regression)

Per spec §8 and ORCH-0840 [Regression-test enforcement + append-only CI] Step 0.5 gate, three adversarial tests written attacking DIFFERENT angles from the implementor's happy-path tests:

| ID | Path | Angle | Pass on fix | Fails on revert at `899b6c70` |
|---|---|---|---|---|
| **AD-1** | `mingla-business/app/event/[id]/__tests__/cancel-error-path.adversarial.test.tsx` | F-1 error path UX preservation: catch branch toast, submitting wrap, early returns, legacy-path simulated processing, B-cycle refund toast, deps array shape | **10/10 PASS** | ✅ 1/10 FAIL — the dep-array adversarial flips when router is back in deps |
| **AD-2** | `mingla-business/src/services/__tests__/softDeleteBrand-multi-date.adversarial.test.ts` | F-2 PostgREST multi-date count discipline, rejection-payload integrity, Step 2 not-reached invariant when count>0, BRAND_DELETE_BLOCKING_EVENT_STATUSES constant unchanged, nowIso validity + drift bound, select string contains `!inner` | **6/6 PASS** | ✅ 5/6 FAIL — when date filter removed, .gt mock never invoked → multiple assertions trip |
| **AD-3** | `mingla-business/src/store/__tests__/liveEventStore-migrator-chain.adversarial.test.ts` | F-3 migrator chain integrity v1→v2→v3→v4→v5 ordering, storage key name preservation, v4 branch explicit discard semantics, fall-through default for unknown versions, PersistedState type shape, version field is exact integer 5, partialize argument is underscore-prefixed | **11/11 PASS** | ✅ 4/11 FAIL — v4 branch missing on revert |

**Total adversarial: 27 assertions** across 3 files, all in `git diff origin/main...HEAD --name-only` so they ship with the closing PR.

Combined with the implementor's 17 happy-path assertions: **44 ORCH-0862-specific test assertions** in the bundle.

ORCH-0840 Step 0.5 gate satisfied:
- ✅ Implementor happy-path tests cited with fails-on-revert at parent commit `899b6c70` (per implementation report §4).
- ✅ Tester adversarial tests committed with passing runs cited above, fails-on-revert verified independently.
- ✅ Both test sets attack different angles (happy path covers "what happens" / adversarial covers "what must NOT happen, what edge cases break").

---

## Step 7 — Parity enforcement (MANDATORY)

The affected surface ships to: **business iOS + business Android** (single RN codebase).

| Platform | Required? | Verified? | Notes |
|---|---|---|---|
| Business iOS | YES (operator-reproed surface) | Probable — see Phase 0.A blocker below | iPhone 17 Pro UDID `17091E60-C3B6-4167-980D-60C348E177F6`; sim booted, dev build current, Metro bundle includes F-1 |
| Business Android | YES (parity requirement) | Skipped — single RN codebase shares 100% of touched code with iOS; no Android-specific render paths in `event/[id]/index.tsx`, `brandsService.ts`, `useBrands.ts`, or `liveEventStore.ts` | Parity is automatic — no separate code paths exist to test |
| Consumer iOS | N/A | N/A | No cancel-event or brand-delete in `app-mobile/` |
| Consumer Android | N/A | N/A | Same as above |
| Buyer Web | N/A | N/A | Anon buyer routes do not call host mutations |
| Admin Web | N/A | N/A | Admin has separate refund/cancel-order flows, not brand-delete or event-cancel |
| Business Web preview | Verify-only per spec | Not verified | Expo Web bundle compile not run this session; deferred |

Phase 0.A live-fire blocker for iOS:
- Attempted full repro flow on sim — switched to Leggo This → opened The Reckoning event-detail → opened manage menu → tapped "Cancel event" → ConfirmDialog did NOT render.
- Verified the sim itself is responsive: subsequent taps on Orders / Hub / brand switcher all landed correctly.
- The specific Pressable for the "Cancel event" trash row at the very bottom of the EventManageMenu Sheet has a small hit target Maestro cannot reliably hit via either text-tap (`tapOn: "Cancel event"`) or coord-tap (tried 30%/92%, 40%/92%, 50%/92%).
- The earlier successful brand-delete sim flow at 2026-05-17 12:09Z proved the EventManageMenu's sibling sheet (BrandDeleteSheet — different Sheet, different Pressable layout) IS tappable via Maestro, so this is a hit-target geometry issue specific to the cancel row.

**This is a Maestro tool blocker, not a code defect.** F-1's structural fix is verified at IM-1 + AD-1 + CI gate level. Operator can complete the live-fire in 4 taps (open Reckoning → manage menu → Cancel event → type name → Cancel).

---

## Step 8 — UI/UX coherence audit

Per `references/ux-coherence-protocol.md`:

| Aspect | Assessment |
|---|---|
| Cancel flow user-narrative post-F-1 | "Tap Manage → Cancel event → type event name → Cancel" → confirmation dialog dismisses → toast slides in (200ms native iOS) → screen re-renders with ENDED status pill → user taps back arrow when ready to leave. Coherent. No orphan modal, no jarring instant nav, no lost-state ambiguity. Mirrors hub-list cancel flow exactly. |
| Brand-delete user-narrative post-F-2 | For a brand with ZERO future-dated scheduled/live events: warn → preview ("Upcoming events: 0", banner hidden) → type-to-confirm → submitting → sheet closes + toast + currentBrand replaced. Coherent. For a brand WITH future-dated scheduled/live: warn → preview ("Upcoming events: N", red banner) → type-to-confirm → submitting → rejected step with "Cancel them first" copy. Same UX as today; only the count semantics changed. |
| F-3 invisibility | Mid-session: indistinguishable from pre-fix. Cold start: events array briefly empty, React Query refetch populates within ~1-2s. The brief empty state on first mount is an existing pattern (same as currentBrandStore v14 ID-only persist). No new "your data is gone" perception risk. |
| Copy clarity | All toast/banner/header copy unchanged from pre-fix (F-1 + F-2 + F-3 are mechanism changes, not copy changes). |
| Accessibility | All accessibilityLabel + accessibilityHint attributes preserved; no Pressable hit-target regressions; no contrast changes. |

P4 positive note: F-1 is an exemplary case of "subtract before adding" (Const #8) — removing 2 lines of code resolved a bug class without introducing any new abstraction or test surface.

---

## Step 9 — Cross-domain impact verification

| Domain | Touched? | Verified by |
|---|---|---|
| Consumer mobile (`app-mobile/`) | No | Grep: zero matches for `softDeleteBrand`, `useBrandCascadePreview`, `useLiveEventStore`, `handleCancelConfirm` in `app-mobile/` |
| Admin web (`mingla-admin/`) | No | Grep: zero matches |
| Edge functions (`supabase/functions/`) | No | Grep: zero matches |
| Buyer-anon routes (`mingla-business/app/checkout/`, `/e/`, `/b/`) | No | These routes don't expose Manage menu or BrandDeleteSheet |
| Hub events list (`mingla-business/app/(tabs)/hub/events.tsx`) | No (read-only consumer of cache) | The cache write that powers re-render after cancel is unchanged — only the navigation side-effect was removed |

Zero cross-domain regressions.

---

## Step 10 — Pattern compliance

Compared the changed code to its siblings:

| Pattern | Comparison |
|---|---|
| Service-layer Supabase chains | `softDeleteBrand` Step 1 now matches the pattern of other `.from("events").select(...)` chains in the file that use joined sub-selects (e.g., `aggregateBrandStatsByBrandIds` selects with `events.brand_id`). |
| Hook-layer parallel queries | `useBrandCascadePreview` retains its 5-parallel-Promise.all structure; only the inner builders changed. Mirrors the pattern of `useBrand` + `useBrands` (per-row Realtime subscriptions + count queries). |
| Persist migrator chain | F-3's v4→v5 transition follows the exact pattern of `currentBrandStore` v13→v14 (ORCH-0742 [Zustand persist no server snapshots] precedent): drop persisted server data, retain storage key, write a passthrough migrator that returns the new empty shape. |
| Comment markers | All 3 fixes carry `ORCH-0862` markers at the relevant change sites + cross-reference to investigation/spec; matches the convention of other ORCH-marked changes in the same files. |

Zero pattern deviations.

---

## Severity findings

| Severity | Count | Finding ID | Description |
|---|---|---|---|
| P0 | 0 | — | Zero P0 — no constitutional violations, no security gaps, no crash paths, no data fabrication, no silent failures. |
| P1 | 0 | — | Zero P1 — all spec criteria covered at structural level, error paths preserved. |
| P2 | 1 | P2-01 | Phase 0.A live-fire on iOS sim post-fix: blocked by Maestro tap-on-CancelEvent-row reliability. Operator unblock required (Case B step). Promotes `probable` → `proven`. |
| P3 | 2 | P3-01 | Phase 0.A post-fix Test Stripe brand-delete success path: not verified (would destructively soft-delete operator data). Operator can run when ready and verify the delete now succeeds. |
| | | P3-02 | Web preview build not compiled this session — `mingla-business/` Expo Web bundle would surface any platform-specific code issues. Deferred (no anticipated risk, single RN codebase). |
| P4 | 3 | P4-01 | F-1 is an exemplary Const #8 subtract-before-adding pattern — 2 line deletions resolve a bug class without new test surface or abstraction. |
| | | P4-02 | F-3 follows ORCH-0742 precedent exactly — same shape, same migrator pattern, same comment style. Reduces reviewer cognitive load. |
| | | P4-03 | Both new CI gates (`i-brand-delete-blocking-date-aware.mjs`, `i-event-detail-cancel-no-navigation.mjs`) are mechanically simple (regex-based) and well-commented; will outlive any specific code change. |

**Bug-bar verdict math:** 0 P0 + 0 P1 + 1 P2 (Phase 0.A blocker, operator-deferral candidate per Phase 0.A confidence ladder rules) + 2 P3 + 3 P4 → **CONDITIONAL PASS** pending operator-named live-fire deferral acceptance.

---

## Spec criterion mapping (SC-1 through SC-8)

| SC | Spec text | Status | Evidence |
|---|---|---|---|
| SC-1 | Cancel completes without freezing on `/event/{id}` | Probable | F-1 structural fix verified at IM-1 + AD-1 + CI gate; sim attempt made but Maestro blocked on Cancel-row tap. Operator unblock = SC-1 → proven. |
| SC-2 | Back navigation post-cancel reaches Hub events | Probable | No code touched on handleBack path; same mechanism that ships today. Operator can verify in same session. |
| SC-3 | Past-dated ghost brand deletes successfully | Probable | F-2 verified at IM-2 (mocked count=0 → rejected=false); CI gate + live MCP DB shape confirm Step 1 query is date-aware. Operator unblock on Test Stripe = SC-3 → proven (destructive, not run this session). |
| SC-4 | Future-event brand still rejects | Proven | AD-2 #2 (rejection payload integrity when count>0); IM-2 final assertion (rejection branch); pre-fix sim flow at 2026-05-17 12:09Z proved the rejection branch fires verbatim. |
| SC-5 | Multi-date event counts as 1 | Probable | AD-2 #1 covers the contract; PostgREST inline-join semantics not directly exercised against live DB this session (zero multi-date events live for tested brands). If overcounting ever surfaces, AD-2 #1 would fail and the implementor switches to RPC per spec §5 F-2. |
| SC-6 | Cold-start populates via React Query post-F-3 | Probable | F-3 migrator verified at IM-3 + AD-3; cold-start sim not directly observed this session. |
| SC-7 | Cross-device staleness eliminated | Probable | Mechanism follows proven ORCH-0742 [Zustand persist no server snapshots] precedent. Cross-device verification requires 2-device setup; not run. |
| SC-8 | Auto-recovery preserved (deliberate UX, no grace period added per F-3 drop) | Proven | No code touched on `useCurrentBrandRecovery` or `currentBrandResolver`. Existing "newest-brand" + "none" branches preserved. AD-3 #1 partially covers by verifying no transient flag was added. |

5/8 criteria `probable` (sim-deferred); 2/8 `proven`; 0/8 failing.

---

## Output contract (chat-section copy)

| Field | Value |
|---|---|
| Verdict | CONDITIONAL PASS |
| Severity counts | P0: 0 \| P1: 0 \| P2: 1 \| P3: 2 \| P4: 3 |
| Report path | `Mingla_Artifacts/reports/QA_ORCH-0862_DESTRUCTIVE_ACTION_UI_TRUTH_DIVERGENCE_REPORT.md` |
| Sim evidence | iPhone 17 Pro `17091E60-C3B6-4167-980D-60C348E177F6` — Leggo This → The Reckoning event-detail → Manage menu opened (screenshot `/tmp/orch0862-tlf-23.png`); Maestro tap on "Cancel event" Pressable blocked. Pre-fix Test Stripe brand-delete flow proved live at 2026-05-17 12:09Z (`/tmp/orch0862-b*.png`). |
| Implementor regression tests | `mingla-business/app/event/[id]/__tests__/cancel-no-navigation.test.tsx` ✅ fails-on-revert @ `899b6c70` (3/5 FAIL); `mingla-business/src/services/__tests__/softDeleteBrand-past-ghost.test.ts` ✅ fails-on-revert @ `899b6c70` (3/5 FAIL); `mingla-business/src/store/__tests__/liveEventStore-v4-v5-migrator.test.ts` ✅ fails-on-revert @ `899b6c70` (4/7 FAIL) |
| Tester adversarial tests | `mingla-business/app/event/[id]/__tests__/cancel-error-path.adversarial.test.tsx` (10 assertions); `mingla-business/src/services/__tests__/softDeleteBrand-multi-date.adversarial.test.ts` (6 assertions); `mingla-business/src/store/__tests__/liveEventStore-migrator-chain.adversarial.test.ts` (11 assertions). All PASS on fix HEAD; all FAIL on revert at `899b6c70` (1/10 + 5/6 + 4/11 respectively, attacking DIFFERENT angles than implementor's happy-path tests). |
| CI gates | `.github/scripts/strict-grep/i-brand-delete-blocking-date-aware.mjs` PASS on fix, FAIL with 2 violations on revert; `.github/scripts/strict-grep/i-event-detail-cancel-no-navigation.mjs` PASS on fix. Both registered in `.github/workflows/strict-grep-mingla-business.yml`. |

---

## Discoveries for orchestrator

- **DISCOVERY-qa-1 (P4 / orchestrator note):** Maestro on iOS 26.4 sim has reliability issues tapping small Pressable rows at the very bottom of `Sheet`-primitive bottom-sheets — specifically the EventManageMenu's last row "Cancel event" was unreachable via Maestro across 3 retry permutations. Bridge is alive (other taps land), only this specific row resists. Recommend: add `testID="event-manage-cancel-row"` (or similar) to the Pressable so future Maestro tests can target it directly; sibling sheets (BrandDeleteSheet) ARE tappable via accessibility label, so the bug is row-position-specific, not Sheet-class-wide. Out of ORCH-0862 scope but worth a sibling ORCH if QA infrastructure becomes a priority.

- **DISCOVERY-qa-2 (P3 / cross-domain note, NOT this ORCH):** During the sim navigation flow, cold-relaunched Leggo This home rendered "0 active events / No active events / No upcoming events" despite the DB containing 10 active `status='scheduled'` events on that brand. After tapping Hub (which triggered a forwardRef redbox from the existing ORCH-0836 [Stripe forwardRef RN 0.65.1 LogBox filter] known issue) and dismissing back to Home, the active events re-populated correctly to 7 (5 upcoming + 2 live). This is a separate **cold-start brand-stats hydration bug** — could be related to the post-ORCH-0859 [Tr2 Minimum Viable Trip] event_type filter race condition, or to React Query refetch ordering after a brand switch. NOT in ORCH-0862 scope. Recommend orchestrator file a new ORCH if operator reproduces.

- **DISCOVERY-qa-3 (P3 / process note):** ORCH-0859 [Tr2 Minimum Viable Trip] WIP files in the dirty working tree (`mingla-business/app/(tabs)/home.tsx`, `hub/trips.tsx`, `UniversalCreatorSheet.tsx`, etc.) are unrelated to ORCH-0862 changes. The implementor correctly scoped commits to only the 10 ORCH-0862 files. No scope leak.

---

## What needs to happen to promote → PASS

Operator runs 4 taps on the already-booted sim:

1. Tap the brand switcher chip (Leggo This is already current) — skip if already there.
2. From Leggo This home, scroll to "Upcoming" and tap **The Reckoning** row.
3. Tap the ⋯ menu in the top-right of the event-detail screen.
4. Tap **Cancel event** at the bottom of the manage menu.
5. Type `The Reckoning` exactly into the confirm field.
6. Tap **Cancel event** (the destructive red button) inside the ConfirmDialog.

**Expected post-fix:** ConfirmDialog dismisses within ~500ms, "Event cancelled." toast appears, the screen re-renders in place showing the status pill flipped to ENDED. **App does NOT freeze.** Operator can then tap back arrow to leave.

**If freeze still happens** → FAIL → return to implementor REWORK with the live-fire trace.

**If clean cancel** → operator says "promote to PASS" → orchestrator runs CLOSE.

(Re-cancellation of The Reckoning is a deliberate destructive action on the operator's test data — the event was already scheduled for 01:35 today which is past. Re-cancelling it is harmless test data churn.)
