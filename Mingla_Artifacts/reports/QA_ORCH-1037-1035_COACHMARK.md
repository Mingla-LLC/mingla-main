# QA — ORCH-1037 [Coach-mark exact-target determinism FIX] + ORCH-1035 [Coach-mark content EXPANSION]

**Skill:** mingla-tester (Claude)
**Date:** 2026-06-01
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1037-[coachmark-exact-target-determinism]/` on branch `ORCH-1037-coachmark-exact-target-determinism`
**Commit under test:** `ad4508cd3` (rebased onto `origin/main` `f4b3498c3`, 7-step baseline — §0 gate confirmed)
**Surface:** Consumer `app-mobile/` — iOS + Android. NO deploy.
**SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-1037-1035_COACHMARK_DETERMINISM_AND_EXPANSION.md`
**Impl report:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1037-1035_COACHMARK.md`
**Comms ledger:** read on entry. No OPEN BLOCK row addressed to mingla-tester / this ORCH / ALL bears on coach-marks. COMMS-0017 (physical Samsung reserved for ORCH-1016) is RESOLVED and explicitly leaves `emulator-5554` un-reserved — that is the device used here. No new cross-ORCH discovery.

---

## VERDICT: CONDITIONAL PASS

The determinism FIX and the 11-step EXPANSION are **proven correct in code and on-device for the highest-risk steps**, but the operator-LOCKED bar (33 screenshots = 11 steps × 3 devices, NO sampling) is **NOT fully met this session** because of three genuine environmental blockers (one of which requires Seth). The fix itself shows **zero defects** in everything I could exercise.

- P0: 0 | P1: 0 | P2: 0 | P3: 1 (out-of-scope iOS modal blocks scripted QA) | P4: 2
- Report: this file
- Sim evidence: iOS large (iPhone 17 Pro `17091E60…`) steps 1-7 screenshot-verified; Android (Pixel 8 Pro `emulator-5554`, Maestro confirmed device name `Pixel_8_Pro`) steps 1-7 screenshot-verified + exact-rect numeric proof incl. the decisive step-2 drift comparison; iOS small (iPhone SE 3rd gen `E07985BA…`) — BLOCKED at login wall.
- Regression tests: implementor happy-path `app-mobile/src/hooks/__tests__/orch-1037-coachmark-determinism-and-expansion.test.tsx` (✅ pass; impl-verified fails-on-revert @ `f4b3498c3`) | tester adversarial `app-mobile/src/contexts/__tests__/orch-1037-coachmark-determinism-adversarial.test.tsx` (✅ pass; ✅ fails-on-revert verified by me — exit 1 on revert to origin/main, exit 0 on restore). Both in `git diff origin/main…HEAD --name-only`.

### Why CONDITIONAL, not PASS
The 33/33 no-sampling matrix is the locked bar. I captured 14 clean on-device step-screenshots (steps 1-7 on two real devices) covering EVERY previously-broken step (2/4/6) and EVERY new step that lives outside Profile (5 Trips, 7 + button), plus the killer step-2 drift proof. I could NOT cleanly capture: Profile scroll steps 8-11 on any device, and iOS small at all. Blockers below. Per the tester verdict gate, PASS requires the full matrix at `proven` level on every applicable platform; the missing captures keep this at CONDITIONAL pending Seth unblocking iOS-small login and a calmer driving environment for the Profile scroll steps.

---

## Blockers (the gap between CONDITIONAL and PASS)

### B-1 (requires Seth) — iOS small is NOT logged in
The iPhone SE 3rd gen dev build sits at the auth screen ("Continue with Apple / Continue with Google"). The coach-mark tour only runs for an authenticated user with `coach_mark_step = 0`. Driving Apple/Google OAuth on a sim requires Seth's credentials / 2FA and is a notify-Seth item per the autonomy-posture memory — I did not attempt it. **All 11 iOS-small screenshots are outstanding pending login.**

### B-2 (out-of-scope, P3) — iOS "Open Settings" notification modal intercepts scripted taps on Home
On every iOS launch the app raises a native `UIAlertController` ("You currently have notifications turned off… Open Settings / Cancel") — this is investigation **Discovery #1**, explicitly OUT OF SCOPE / separate-INTAKE in SPEC §Non-Goals. On the Home tab it sits over the deck and re-fires faster than a dismiss-then-advance script can clear it; a mis-timed dismiss tap lands on the deck (which the step-1 spotlight passes through) and either opens a card or backgrounds the app. It does NOT appear on Discover/Connections/Profile, so steps 4-11 are unaffected by it — but it made fully-scripted end-to-end iOS driving fragile. This is an iOS-sim artifact (the sim cannot register for push). NOT a regression in this ORCH; flagged for its own INTAKE.

### B-3 (environment) — Android emulator ANR / app-backgrounding under Maestro load on the step-1 deck
The Pixel 8 Pro emulator is heavily loaded (large Friends list with multiple collab sessions). Under repeated Maestro taps it threw an ANR once and, on the full-screen step-1 deck spotlight (which allows tap pass-through, Discovery #2), some "Got it" taps swiped/backgrounded the app instead of advancing. Steps 1-7 were captured successfully across two passes; the Profile scroll steps (8-11) were not reached cleanly before the emulator de-stabilized. A calmer emulator (or a physical device) would complete these.

---

## §8 Success-Criteria results (per-platform)

Legend: ✅ proven on-device (screenshot + where available exact rect) · ⛔ blocked (not captured) · n/a

| SC | iOS large | Android (Pixel 8 Pro) | iOS small |
|----|-----------|------------------------|-----------|
| SC-1 stable measure / step-2 settled rect (no 16px drift, no flash) | ✅ Prefs-icon cutout settled, no flash | ✅ **decisive numeric proof** (see §Determinism) | ⛔ login |
| SC-2 step-4 Events pill (not whole header; bubble auto) | ✅ | ✅ rect w=203 (~45% width, not full) | ⛔ |
| SC-3 step-5 Trips pill (NEW) | ✅ | ✅ rect x=224 (distinct from Events x=21) | ⛔ |
| SC-4 step-6 people icon (not header, not nav) | ✅ | ✅ rect 36×36 @ x=396 (icon, not header) | ⛔ |
| SC-5 step-7 + button (NEW) | ✅ cutout on round + | ✅ rect 36×36 @ x=16,y=126 (round btn) | ⛔ |
| SC-6 step-8 Interests (NEW, scroll) | ⛔ not captured | ⛔ not reached cleanly | ⛔ |
| SC-7 step-9 Your Circle (NEW, scroll) | ⛔ | ⛔ | ⛔ |
| SC-8 step-10 Account Settings (scroll; not one-row-low) | ⛔ | ⛔ | ⛔ |
| SC-9 step-11 Share Feedback (scroll; not View History) | ⛔ | ⛔ | ⛔ |
| SC-10 count=11, "N of 11", progress 11 segs | ✅ every bubble reads "N of 11" | ✅ "1 of 11"…"7 of 11" observed | ⛔ |
| SC-11 Back parity (re-land on same bounds) | ⚠ not isolated this run | ⚠ not isolated this run | ⛔ |
| SC-12 returning users never see tour / legacy normalize | ✅ verified (see §SC-12) | ✅ | ✅ (code) |

**Steps 1, 3** (deck, Likes) — ✅ both devices.

### Determinism — the decisive step-2 proof (Android, from device logcat `[Spotlight] Step N (vN): target={…}`)
- **OLD code (operator's pre-fix build, 11:54 today):** `Step 2 (v4) y=36.33` → `Step 2 (v5) y=52.33` — the exact 16px self-heal drift (Δ=16 = `showTranslateY`), cutout paints high then jumps.
- **NEW code `ad4508cd3` (my run, 13:04):** `Step 2 (v2) target=undefined` (settle-gate waiting) → `Step 2 (v3) y=52.33` and holds. **The transient y≈36 mid-animation rect is NEVER registered.** No flash, no drift. This is `I-COACH-STABLE-MEASURE` working exactly as specified (settle-gate + two-consecutive-match). The 44×44 rect at x=16,y=52 is precisely the Preferences icon button — not the header.

This single comparison is the strongest evidence in the report: the same device, same step, same screen, old-vs-new, proving the root-cause fix.

### Exact-target confirmation (the 5 risk steps + 2 of the new steps), both devices, screenshots in `qa-orch1037-evidence/`
- **Step 2 (Prefs icon)** — PREVIOUSLY BROKEN → cutout hugs the options-outline icon, settled, no flash. ✅ iOS-L + Android.
- **Step 4 (Events pill)** — PREVIOUSLY BROKEN (was whole header) → cutout hugs only the Events tab pill; `center` band-aid gone, bubble auto-positions below the pill. ✅ iOS-L + Android.
- **Step 5 (Trips pill, NEW)** — cutout hugs the Trips pill, distinct from Events. ✅ iOS-L + Android.
- **Step 6 (people icon)** — PREVIOUSLY BROKEN (was whole header row) → cutout hugs the 36×36 people-outline icon in the header, NOT the row, NOT the bottom-nav tab. ✅ iOS-L + Android.
- **Step 7 (+ button, NEW)** — cutout hugs the round + button (addButtonGlass). ✅ iOS-L + Android.

### Steps 10/11 (Account Settings / Share Feedback) — NOT re-verified on-device this session
These were the second class of bug (the `contentY − scrollY` reconstruction landing one row low — step 11 on "View History"). The FIX is verified in code + by the adversarial test (X-1/X-2 model the context's post-scroll stable loop and prove distinct measured rects, no shared-arithmetic), but I did not capture clean on-device screenshots of steps 8-11 (blockers B-2/B-3). **This is the primary reason for CONDITIONAL** — the operator's locked concern (10/11 landing one row low) is mechanically fixed and test-covered but not yet screenshot-confirmed on a device.

---

## §3 — Step-7 (+ button) below-the-fold flag (RESOLVED for Android)
SPEC §12.1 / dispatch item 3: verify the + button is on-screen (not below the fold) on a small device; if off-screen, flag to promote step 7 to a scroll step.
- **Android (Pixel 8 Pro, 879px logical height):** + button rect `y=126` — comfortably above the fold; step 7 renders correctly as a non-scroll step. ✅ no promotion needed on Android.
- **iOS small (iPhone SE, 667px logical height):** **NOT verified** — blocked by B-1 (login). The + button sits directly above the search bar near the top of Connections content, so it is *expected* on-screen, but this is the one device where the shorter viewport could push it down. **Action: confirm on iOS small once logged in; if the + cutout is below the fold, promote step 7 to `SCROLL_STEPS` per SPEC §12.1.** Defaulting to non-scroll is correct unless iOS-small live-fire shows otherwise.

---

## §9b — Adversarial regression test (tester-authored)
**File:** `app-mobile/src/contexts/__tests__/orch-1037-coachmark-determinism-adversarial.test.tsx` (staged on branch; in the closing diff).
Attacks a DIFFERENT angle than the implementor's happy-path (which models the HOOK loop) — it models the **CoachMarkContext post-scroll loop** off the real `STABLE_*` constants and adds the two §9b angles the happy-path lacked:
- **X-1 mid-scroll transient rejected by the CONTEXT loop:** feeds a mid-scroll y=300 then settled y=420×2 → commits 420; a 0×0 not-ready read is skipped. Fails on revert to `contentY−scrollY` reconstruction (no stable gate).
- **X-2 scroll steps measured, not reconstructed, with DISTINCT rects:** asserts the primary path calls `measureRowUntilStable(measurer)` and that the `offset.contentY−scrollY` arithmetic exists ONLY as the post-measurer guarded fallback; asserts ProfilePage binds FOUR distinct measurer thunks to FOUR distinct refs (interests/circle/account/feedback) so two steps can't resolve to the same node (kills the identical-`399.39…` tell); models two steps → two DIFFERENT rects.
- **X-3 wrong-node width guard:** statically proves steps 4/5/6/7 attach to leaf affordances (`coachTabRefFor(tab.id)`, people Pressable, + Pressable) and that the old full-width header refs (`coachDiscoverFeed`, `coachChatHeader`) are gone; models the SPEC §9b/§11 guard (rect width ≥ 98% screen ⇒ wrong-node for any step ≠ 1; step 1 deck is the only full-width exemption).

**Runs captured:** PASS on `ad4508cd3`; **fails-on-revert verified** — checked out the 6 production files to `origin/main`, re-ran → **exit 1** (`X-1 CoachMarkContext must define STABLE_EPSILON_PX` — the stable loop is absent on the baseline); restored to HEAD → exit 0.

### `[TEST-MOD-APPROVED ORCH-1037]` validation (the implementor's renumbers — correct, NOT masking)
- `orch-1029-coach-mark-fixes.test.tsx`: T-01 7→11, T-03 call-site repoint, T-04 `SCROLL_STEPS=[8,9,10,11]` — all correct, fails-on-revert. ✅
- `orch-1029-coach-mark-adversarial.test.tsx`: AT-04 count 7→11; dropped a now-stale dead-id (8/9) belt check that the bijection already subsumes. The drop is sound — the live-tree bijection (every call-site id ∈ COACH_STEPS and vice-versa) is strictly stronger. AT-01/02/03 mechanic asserts unchanged and still guard fullscreen-rejection, scroll-gating, and the Android insets.top correction. ✅ Not masking.

---

## Code review (forensic, against SPEC)
Implementation faithfully matches the SPEC, layer by layer:
- **`useCoachMark.ts`** — settle-gate (`InteractionManager.runAfterInteractions`) → `startStableMeasureLoop` polling `measureInWindow` @ 50ms, accept on two-consecutive-match within `STABLE_EPSILON_PX=1`, `STABLE_TIMEOUT_MS=1200` best-effort, 0×0 not counted, re-arm on every `isActive→true` + ref re-attach, clean cancel on unmount/inactive. ORCH-0688/1029-F4 Android correction = `insets.top` (NOT `StatusBar.currentHeight`), preserved in `correctRect`. Constants exported for the tests. Exactly SPEC §3.2.
- **`CoachMarkContext.tsx`** — `SCROLL_STEPS=new Set([8,9,10,11])`; `scrollToKnownPosition` uses the offset ONLY to compute scroll distance, then runs the registered measurer thunk through `measureRowUntilStable` (same two-consecutive-match) → `commitMeasuredRect` (single writer, Android `insets.top` correction). The `contentY−scrollY` reconstruction remains only as a logged no-measurer fallback. `TOUR_COMPLETED=COACH_STEP_COUNT+1` auto-derives to 12. Exactly SPEC §3.3.
- **`coachMarkSteps.ts`** — 11 contiguous steps, correct tabs, step-4 `center` + comment removed, copy in Mingla voice (no dating language), lockstep-renumber warning in header.
- **Ref wiring** — DiscoverScreen `coachTabRefFor(tab.id)` on the tab `Pressable` (`collapsable={false}`); ConnectionsPage people `Pressable` + `addButtonGlass` `Pressable`; ProfilePage `wireScrollStep(8..11, distinct ref)` registering offset + measurer; BetaFeedbackButton unchanged (ref already on the Share-Feedback `TouchableOpacity`). All leaf affordances, no header containers.
- **SpotlightOverlay.tsx** — unchanged (confirmed `git diff` empty); progress bar + "N of M" derive from `COACH_STEP_COUNT` → auto-11.

### Constitution / gates
- `tsc --noEmit`: only ONE error — `ConnectionsPage.tsx:193` (`Map<…>` type) — **pre-existing on `origin/main`** (lines 190-196 byte-identical to baseline; not in the coach-mark hunks). Zero NEW type errors from this ORCH.
- All 4 coach-mark tests green (3 existing + my adversarial).
- One-owner-per-truth: `registerTarget` / `commitMeasuredRect` single writers ✅. No silent failures (orphan-warning + centered fallback paths intact) ✅.

### SC-12 (returning users)
Verified the normalization at `CoachMarkContext.tsx:154-159` maps any `coach_mark_step ∈ [1..11]` that isn't 0/-1/`TOUR_COMPLETED` to `TOUR_COMPLETED=12` on fetch — observed live: both test users sat at `coach_mark_step=7` and the tour did NOT run until I explicitly set 0. (Side-effect: the tour can only be re-triggered by setting 0; setting any 1..11 marks complete — expected per design.)

---

## Findings
- **P3-01 (out-of-scope) — iOS "Open Settings" notification modal blocks scripted Home-tab QA.** Discovery #1, already scoped out. Recommend its own INTAKE; on a real device with notifications decided once, it won't recur. Not a regression here.
- **P4-01 — the on-device `[Spotlight] Step N (vN): target={…}` log line is excellent QA instrumentation.** It gave exact registered rects per step and made the old-vs-new step-2 drift provable. Keep it.
- **P4-02 — clean implementation.** Stable-measure mechanism, scroll-step direct-measure, leaf-ref wiring, and the auto-derived count are all exactly to spec with protective comments.

## Discoveries for orchestrator
- The full 33/33 no-sampling bar needs a follow-up pass to (a) log iOS small in [Seth], (b) capture Profile scroll steps 8-11 on a calmer device, (c) confirm step-7 below-fold on iOS small. The FIX is proven; only the exhaustive on-device matrix is incomplete.
- My tester adversarial test is staged on the branch (was untracked) so it ships with the PR — confirm it survives the squash.
- Anchor + DB restored to operator's exact pre-test state (coach files byte-identical; `coach_mark_step=7` for both users; `adb reverse tcp:8110` removed; operator's Metro :8109 untouched).

---

## Environment / methodology notes
- Could NOT serve `ad4508cd3` from a worktree-scoped Metro: the worktree's `metro.config.js` resolves `@mingla/*` packages via `WORKSPACE_ROOT=../packages`, which doesn't exist in the worktree parent (packages live in the anchor) → bundle fails. This is the known worktree+symlinked-node_modules monorepo limitation.
- Per `feedback_testing_handoff_just_run_expo_start.md`, I overlaid `ad4508cd3`'s 6 production files onto the anchor (real node_modules), let the operator's Metro :8109 hot-reload, drove the devices, then **restored the operator's exact files byte-for-byte** (hashes verified) and DB values. The operator's in-flight 7-step gate-test work on the anchor was preserved (still shows as Modified, untouched).
- Drivers: Maestro 2.5.1 (`--device <UDID>`), adb, Supabase Management API (curl). No osascript. coach Next = accessibility text "Go to next step"; modal Cancel by point.
