# IMPLEMENTATION — ORCH-1037 [Coach-mark exact-target determinism FIX] + ORCH-1035 [Coach-mark content EXPANSION]

**Date:** 2026-06-01
**Skill:** mingla-implementor (Claude)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1037-[coachmark-exact-target-determinism]/` on branch `ORCH-1037-coachmark-exact-target-determinism`
**Surface:** Consumer `app-mobile/` only — iOS + Android. NO deploy.
**Baseline:** rebased onto `origin/main` HEAD `f4b3498c3` (7-step state) — verified by the orchestrator (§0 gate already done; not re-run).
**SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-1037-1035_COACHMARK_DETERMINISM_AND_EXPANSION.md`
**Status:** implemented; verified by tsc (no new errors), lint (no new errors), 3 node tests green + fails-on-revert. Per-step on-device screenshot verification is the tester's no-sampling live-fire (iOS small/large + Android) — labeled `UNVERIFIED-ON-DEVICE` below, the one criterion this environment cannot exercise.

**Comms ledger:** read on entry. No OPEN BLOCK/WARN row addressed to `mingla-implementor`, this ORCH-ID, or `ALL` bears on coach-marks. COMMS-0003 (external-API docs) is N/A — no external API touched. No new cross-ORCH discovery to write.

---

## 1. The stable-measure mechanism as built (Part A core — SPEC §3.2)

`app-mobile/src/hooks/useCoachMark.ts` — the two-shot measure (rAF on ref-attach + a 100ms `setTimeout` after activation) is **replaced** by a settle-gated, measure-until-stable loop that runs on EVERY non-scroll step:

1. **Settle gate** — when a step becomes active (or its callback ref attaches while active), `armMeasure()` calls `InteractionManager.runAfterInteractions(() => startStableMeasureLoop())`. This waits out running `Animated` interactions, including the GlassTopBar `translateY 16→0` 260ms native-driver entrance that caused step 2 to register `y≈36` then self-heal to `y≈52`.
2. **Measure-until-stable loop** — `startStableMeasureLoop` polls `node.measureInWindow` every `STABLE_POLL_MS = 50`. A read is accepted only when two consecutive non-zero reads agree within `STABLE_EPSILON_PX = 1` on every axis (`rectsStableEqual`). A `0×0` read is "not laid out yet" and does NOT count toward the pair (the loop keeps polling).
3. **Bounded best-effort timeout** — `STABLE_TIMEOUT_MS = 1200`. On timeout without a stable pair, the last non-zero rect is registered (so the step still shows a cutout); if no non-zero rect was ever obtained, nothing registers (orphan-warning + SpotlightOverlay centered fallback handle it).
4. **Re-arm on re-entry** — the `useEffect` re-runs `armMeasure()` on every `isActive → true` transition (forward AND Back) and on callback-ref re-attach. First-show and post-Back are identical.
5. **Clean cancel** — `cancelLoop()` clears the poll timer, deadline, and the InteractionManager handle on unmount and on `isActive → false`. No orphaned timers.

The ORCH-0688 / ORCH-1029-F4 Android window-frame Y-correction (`Platform.OS === 'android' ? y + insets.top : y`, sourced from `useSafeAreaInsets`, NOT `StatusBar.currentHeight`) is preserved verbatim inside `correctRect`, applied to every accepted rect.

`STABLE_EPSILON_PX`, `STABLE_POLL_MS`, `STABLE_TIMEOUT_MS`, and `rectsStableEqual` are **exported** so the regression test models the loop against the real constants.

### Scroll steps (Part A — SPEC §3.3), `CoachMarkContext.tsx` + `ProfilePage.tsx`
`scrollToKnownPosition` no longer reconstructs `contentY − scrollY` (the fragile arithmetic that landed steps one row low with the identical `399.39…` `contentY` tell). Now:
- The `onLayout → measureLayout → registerTargetScrollOffset` path is kept ONLY to compute **how far** to scroll (`scrollTo({ y })` to ~35% from top).
- After `SCROLL_SETTLE_MS` (500ms), the context calls a per-step **measurer thunk** (`registerTargetMeasurer`) that ProfilePage registers; the thunk runs the actual row leaf node's `measureInWindow`. That window rect is fed through the SAME two-consecutive-match stable loop (`measureRowUntilStable`, epsilon/poll/timeout identical to the hook) before `registerTarget`.
- The ORCH-0688 Android correction is applied to the measured window Y in `commitMeasuredRect`. A legacy offset-reconstruction path remains ONLY as a guarded fallback if a measurer was somehow not registered (logged).

---

## 2. Re-pointed + new refs (exact leaf targets)

| Step | Target | File | Wiring |
|---|---|---|---|
| 4 Events tab | Events pill `Pressable` | `DiscoverScreen.tsx` | `coachEventsTab = useCoachMark(4,10)`; attached per `tab.id==='events'` via `coachTabRefFor`. Header-panel ref removed. |
| 5 Trips tab (NEW) | Trips pill `Pressable` | `DiscoverScreen.tsx` | `coachTripsTab = useCoachMark(5,10)`; attached per `tab.id==='trips'`. |
| 6 People icon | people-icon `Pressable` (`people-outline`) | `ConnectionsPage.tsx` | `coachPeopleIcon = useCoachMark(6,14)` on the in-page Pressable. Header-row ref removed (operator-LOCKED leaf target, NOT bottom-nav). |
| 7 + button (NEW) | `addButtonGlass` `Pressable` (opens FriendsActionChooser) | `ConnectionsPage.tsx` | `coachPlusButton = useCoachMark(7,8)`. |
| 8 Interests (NEW) | Interests `GlassCard` wrapper View | `ProfilePage.tsx` | `interestsRef` + `onLayout=handleInterestsLayout` → offset(8) + measurer(8). Scroll step. |
| 9 Your Circle (NEW) | Your-Circle `GlassCard` wrapper View | `ProfilePage.tsx` | `circleRef` + `handleCircleLayout` → offset(9) + measurer(9). Scroll step. |
| 10 Account Settings | Account Settings row View | `ProfilePage.tsx` | renumbered 6→10; offset(10) + measurer(10). |
| 11 Share Feedback | Share-Feedback `TouchableOpacity` | `BetaFeedbackButton.tsx` (via `feedbackButtonRef`) | renumbered 7→11; offset(11) + measurer(11). BetaFeedbackButton unchanged (ref + onLayout already wired). |

Steps 1 (deck), 2 (Prefs icon), 3 (Likes tab) unchanged.

---

## 3. The 4 new steps + copy (SPEC §5)

- **5 Trips** — "Trips, ready when you are" / "Weekend escapes, big adventures — plan the whole thing here."
- **7 + button** — "Pair up, plan together" / "Tap + to pair with a friend and start a shared group chat." (names both chooser outcomes; no fictional feature.)
- **8 Interests** — "Your interests" / "Tell us what you're into — your deck gets sharper every time."
- **9 Your circle** — "Your circle" / "The people you plan with, all in one place."

Step 4 (`Events, near you`) kept its copy; its `bubblePosition:'center'` band-aid + comment were **removed** (now auto-positions to hug the pill). No step uses `'center'`.

---

## 4. Call-site renumber bijection (SPEC §5, lockstep)

`COACH_STEPS` ids = `{1..11}`. Target registrations:

| id | registration | site |
|---|---|---|
| 1,2 | `useCoachMark(1,36)`, `useCoachMark(2,20)` | HomePage.tsx |
| 3 | `useCoachMark(3,12)` | app/index.tsx |
| 4,5 | `useCoachMark(4,10)`, `useCoachMark(5,10)` | DiscoverScreen.tsx |
| 6,7 | `useCoachMark(6,14)`, `useCoachMark(7,8)` | ConnectionsPage.tsx |
| 8,9,10,11 | `registerTargetScrollOffset(8/9/10/11,…)` | ProfilePage.tsx |

`SCROLL_STEPS = new Set([8, 9, 10, 11])`. **Bijection confirmed** (test T-07/T-08 + the live-tree AT-04): every step id has exactly one target registration, no orphans, no dangling. `COACH_STEP_COUNT === 11` ⇒ `TOUR_COMPLETED = 12`, progress bar 11 segments, "N of 11" counter — all auto-derived (SpotlightOverlay unchanged).

---

## 5. Old → New receipts

- **useCoachMark.ts** — was: two-shot rAF + 100ms measure (pre-settle, single-read, no stability check) → now: settle-gated measure-until-stable loop (InteractionManager + two-consecutive-match within 1px + 1200ms best-effort + re-arm + clean cancel). ~120 lines changed. SPEC §3.2.
- **coachMarkSteps.ts** — was: 7 steps, step-4 `bubblePosition:'center'` → now: 11 steps (4 new), step-4 `center` removed, header doc rewritten with lockstep-renumber warning. ~55 lines.
- **CoachMarkContext.tsx** — was: `SCROLL_STEPS={6,7}`, `contentY − scrollY` reconstruction → now: `{8,9,10,11}`, `registerTargetMeasurer` API + measurer-ref map + `measureRowUntilStable` post-scroll stable loop + `commitMeasuredRect`. ~90 lines.
- **DiscoverScreen.tsx** — was: one `useCoachMark(4,24)` on the header panel + stale "step 6" comment → now: `useCoachMark(4,10)`+`useCoachMark(5,10)`, `coachTabRefFor` per-tab helper, ref on the tab Pressable, header-panel ref + stale comment removed. ~25 lines.
- **ConnectionsPage.tsx** — was: `useCoachMark(5,0)` on the header row → now: `useCoachMark(6,14)` on people Pressable + `useCoachMark(7,8)` on + Pressable; header-row ref removed. ~15 lines.
- **ProfilePage.tsx** — was: 2 scroll handlers (offsets 6,7) → now: 4 (`wireScrollStep` registering offset+measurer for 8,9,10,11), Interests+Circle ref-wrapper Views, `isScrollStep` widened. ~60 lines.
- **BetaFeedbackButton.tsx** — unchanged (ref + onLayout already on the Share-Feedback button; measurer thunk uses the existing `feedbackButtonRef`).

---

## 6. Regression test (mandatory gate)

- **New happy-path test:** `app-mobile/src/hooks/__tests__/orch-1037-coachmark-determinism-and-expansion.test.tsx` — Part A structure (11 steps, per-step tab map, Events/Trips/people/+ leaf wiring, scroll-step 8-11 offset+measurer, `center` + stale-comment removal, bijection, auto-derived progress) + Part B executable stable-loop model (B-01 already-stable, **B-02 mid-animation transient `y=36` rejected → settled `y=52` accepted**, B-03 best-effort timeout, B-04 `0×0` skipped, B-05 sub-pixel jitter).
  - **Passing run:** `PASS ORCH-1037/1035: 11-step tour … stable-measure loop rejects the mid-animation transient and accepts the settled rect`.
  - **fails-on-revert verified at `f4b3498c3`** (baseline) — stashed the 6 production files, the test exited `1` (`T-01 … got [1,2,3,4,5,6,7]` + the behavioral model's `rectsStableEqual`/`InteractionManager` asserts), restored, re-passed.
- **Updated locked tests** (require `[TEST-MOD-APPROVED ORCH-1037]` in commit body — append-only CI):
  - `src/components/__tests__/orch-1029-coach-mark-fixes.test.tsx` — T-01 7→11, T-03 call-site repoint, T-04 `SCROLL_STEPS=[8,9,10,11]`. Passes; fails-on-revert at `f4b3498c3` (exit 1).
  - `src/contexts/__tests__/orch-1029-coach-mark-adversarial.test.tsx` — AT-04 step count 7→11, dropped dead-id 8/9 belt check (now live). Passes. (Its F-1/F-4/F-3 mechanic assertions are unchanged and still guard the stable-measure Android-inset + scroll-gating invariants.)

---

## 7. Spec success-criteria traceability

| SC | Status | How |
|---|---|---|
| SC-1 stable measure / step-2 settled rect | implemented; UNVERIFIED-ON-DEVICE | loop accepts only two-consecutive-match (test B-02 proves the model rejects `y=36` for `y=52`). On-device screenshot = tester. |
| SC-2 step-4 Events pill | implemented | ref on Events `Pressable`, `center` removed. |
| SC-3 step-5 Trips pill | implemented | ref on Trips `Pressable`. |
| SC-4 step-6 people icon | implemented | ref on people `Pressable`, not header row/nav. |
| SC-5 step-7 + button | implemented | ref on `addButtonGlass` `Pressable`. |
| SC-6/7/8/9 scroll steps 8-11 | implemented | post-scroll `measureInWindow` + stable loop, not reconstruction. |
| SC-10 count + progress | implemented | `COACH_STEP_COUNT===11`; `TOUR_COMPLETED=12` auto. |
| SC-11 Back parity | implemented | loop re-arms on every `isActive→true`. |
| SC-12 no regression / returning users | preserved | normalization + `TOUR_COMPLETED` untouched. |

**Invariants:** `I-COACH-STABLE-MEASURE`, `I-COACH-LEAF-TARGET`, `I-COACH-SCROLL-DIRECT-MEASURE` (DRAFT→ACTIVE on CLOSE) all implemented + tested. `I-COACH-DECK-HOLD`, ORCH-0688 correction, one-owner-`registerTarget` preserved.

---

## 8. Product flags for operator

1. **Step-7 "+ button" tour position** — built as a NORMAL (non-scroll) step per SPEC §12.1 default. The + sits directly above the search bar near the top of Connections content and is typically on-screen on mount. **If the tester's iOS-small live-fire shows it below the fold, promote to a scroll step** (add `7` to `SCROLL_STEPS`, register an offset+measurer). No code change needed unless live-fire shows it off-screen.
2. Copy (Trips / + / Interests / Circle) per SPEC defaults — tweakable in voice within the locked length/voice limits.

## 9. Discoveries for orchestrator
- None new. (Pre-existing baseline tsc errors in `ConnectionsPage.tsx:193`, `TripCard.tsx:182`, `BoardDiscussion.tsx` are unrelated and present on `f4b3498c3` — confirmed via stash.)

---

## 10. Verification commands captured
- `npx tsc --noEmit` — zero NEW errors in touched files (only pre-existing `ConnectionsPage.tsx:193` baseline).
- `npx eslint <6 touched files>` — 0 errors (warnings all pre-existing baseline).
- `node src/hooks/__tests__/orch-1037-…test.tsx` → PASS; reverted → exit 1; restored → PASS.
- `node src/components/__tests__/orch-1029-coach-mark-fixes.test.tsx` → PASS.
- `node src/contexts/__tests__/orch-1029-coach-mark-adversarial.test.tsx` → PASS.
