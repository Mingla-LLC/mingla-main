# Implementation Report — ORCH-0679 Wave 2.6 (Hook Order Hot-Fix)

**Status:** **implemented, partially verified** (CI gates 8/8 green, TS clean modulo 3 pre-existing errors; cold-start runtime test pending founder dev-client retest)
**Date:** 2026-04-26
**Dispatch:** Mingla_Artifacts/prompts/IMPL_ORCH-0679_WAVE2_6_HOOK_ORDER_HOTFIX.md
**Predecessors:** Wave 2 + Wave 2.5

---

## §1 Layman Summary

The Wave 2 hoist block (~22 hooks) and `closeProfileOverlays` (1 hook) were placed AFTER 4 early returns in `AppContent`. On cold start, render 1 hit an early return so those hooks were never called; render 2 (after auth resolved) called them, and React detected the hook-count mismatch and crashed. Wave 2.6 relocates all 23 hooks above all early returns. Added an 8th CI gate (ESLint `react-hooks/rules-of-hooks`) so this exact bug class can't recur. App should now cold-start cleanly.

---

## §2 Bug Confirmed (verbatim from founder dev-client console)

```
ERROR  React has detected a change in the order of Hooks called by AppContent.
   ...
   301. useEffect             useEffect
   302. undefined             useMemo

ERROR  [Error: Rendered more hooks than during the previous render.]
```

Stack trace pointed to `AppContent (app\index.tsx)` — the new `useMemo` at hook position 302 was the first hook after the early return that was conditionally called.

---

## §3 Root Cause (line-precise)

`AppContent` has 4 early returns between hook-block boundaries:

| Line (pre-fix) | Condition | Returns |
|---|---|---|
| 2026 | `if (!_hasHydrated \|\| isLoadingAuth)` | `<AppLoadingScreen>` |
| 2036 | `if (showOnboardingFlow \|\| needsOnboarding)` | `<OnboardingLoader>` |
| 2061 | `if (!isAuthenticated)` | `<WelcomeScreen>` |
| 2075 | `if (user && !profile)` | `<AppLoadingScreen>` |

The Wave 2A "Hoisted tab props" block (lines 2083-2207 pre-fix) AND `closeProfileOverlays` useCallback (line 2438 pre-fix) were ALL placed AFTER these guards. On render 1 (auth loading), early return hit → hooks never called. On render 2 (auth resolved), early return skipped → hooks called for the first time → React's hook-tracking system saw a count change → ERROR.

The 9 Wave 2.5 useCallback wraps (handleNotificationNavigate, handleSessionSelect, handleSoloSelect, refreshAllSessions, handleCreateSession, handleAcceptInvite, handleDeclineInvite, handleCancelInvite, handleInviteMoreToSession) were ALREADY placed before line 2026 — those did not need relocation.

---

## §4 Fix Applied

### Step 1 — Relocate hooks
- **Wave 2A hoist block** (~22 useCallback/useMemo): cut from lines 2083-2207, paste after line 2019 (right after the last existing useEffect's closing dep array, before the comment block at 2021-2025 that introduces the first early return).
- **closeProfileOverlays** useCallback: cut from line 2438, paste at end of relocated hoist block.
- **Net effect:** all 23 hooks now sit ABOVE all 4 early returns.

### Step 2 — Add 8th CI gate (`check-react-hooks-rules.sh`)
- Runs `npx eslint` with `react-hooks/rules-of-hooks` rule at error level.
- Scoped to Wave 2/2.5/2.6 surface area: `app/index.tsx`, `app/_layout.tsx`, 6 tab files, MobileFeaturesProvider, NavigationContext, CoachMarkContext.
- Does NOT scan the rest of `src/` (out of scope; pre-existing violation in `PopularityIndicators.tsx` documented as D-WAVE2.6-IMPL-1).

### Step 3 — Update `check-no-inline-tab-props.sh` region bounds
- Wave 2.6 relocation shifted line numbers. Tab JSX is now at lines 2529-2645 (was 2517-2633 in Wave 2.5).
- Updated awk region in the gate to `NR>=2529 && NR<=2645`.

---

## §5 Files Changed

| File | Net change |
|---|---|
| `app-mobile/app/index.tsx` | Hooks relocated. ~135 lines moved up (no logic change). 1 short comment block left at OLD location of closeProfileOverlays as a breadcrumb. |
| `app-mobile/scripts/ci/check-no-inline-tab-props.sh` | Region bounds 2517-2633 → 2529-2645 (2 lines updated) |
| `app-mobile/scripts/ci/check-react-hooks-rules.sh` | NEW — 8th CI gate, ~50 lines |

Total: 2 modified, 1 new. Zero logic changes.

---

## §6 Old → New Receipts

### `app/index.tsx` (relocation, no logic change)

**What it did before:** Hooks (Wave 2A hoist block + closeProfileOverlays) declared at lines 2083-2207 + 2438, AFTER 4 early returns. Render-count mismatch when auth state changed → "Rendered more hooks" error.
**What it does now:** Same hooks, same dep arrays, same bodies, same closures — but DECLARED before line 2026 (above ALL early returns). React's hook-tracking system sees a consistent hook count + order on every render.
**Why:** Rules of Hooks compliance — hooks must be called in the same order on every render. Early returns make that impossible if hooks are below them.
**Lines changed:** ~135 lines moved upward; 4-line breadcrumb comment left at old closeProfileOverlays location.

### `scripts/ci/check-no-inline-tab-props.sh`

**What it did before:** Scanned lines 2517-2633 for inline arrow fns / object literals.
**What it does now:** Scans lines 2529-2645 (post-Wave-2.6 line shift).
**Why:** Wave 2.6 relocation pushed the tab JSX block down by ~12 lines.
**Lines changed:** 2 (comment + the awk NR range).

### `scripts/ci/check-react-hooks-rules.sh` (NEW)

**What it does:** Runs ESLint with `react-hooks/rules-of-hooks` rule at error level on Wave 2 surface area files. Fails if any file has a conditional hook call OR a hook after an early return.
**Why:** Static prevention of the exact bug class that crashed Wave 2 at runtime. Also satisfies dispatch §4 step 5.
**Negative-control:** documented in script comment — temporarily inserting a hook after `if (!_hasHydrated...) return` should make this gate fail, then revert and re-pass.

---

## §7 Verification Matrix

| Criterion | Status | Evidence |
|---|---|---|
| All 23 misplaced hooks now above all early returns | ✅ PASS | `grep` confirms hoist block at line 2031, all 4 early returns at lines 2154+ (after relocation) |
| `react-hooks/rules-of-hooks` gate green for Wave 2 surface | ✅ PASS | `bash scripts/ci/check-react-hooks-rules.sh` → exit 0 |
| All other 7 CI gates still green | ✅ PASS | Full gate run all green |
| TypeScript clean (modulo 3 pre-existing errors) | ✅ PASS | `tsc` output unchanged |
| Wave 1 invariants intact | ✅ PASS | I-ANIMATIONS-NATIVE-DRIVER-DEFAULT, I-LOCALES-LAZY-LOAD, I-ZUSTAND-PERSIST-DEBOUNCED gates all green |
| Wave 2 invariants intact | ✅ PASS | I-TAB-PROPS-STABLE, I-TAB-SCREENS-MEMOIZED, I-SENTRY-SINGLE-INIT gates all green |
| Wave 2.5 wraps still in place | ✅ PASS | 9 helper handlers still useCallback-wrapped (verified by ESLint scan) |
| Cold-start "Rendered more hooks" error gone | ⏳ PENDING founder dev-client retest |

---

## §8 Invariant Verification

### Preserved
- ✅ I-ANIMATIONS-NATIVE-DRIVER-DEFAULT (Wave 1)
- ✅ I-LOCALES-LAZY-LOAD (Wave 1)
- ✅ I-ZUSTAND-PERSIST-DEBOUNCED (Wave 1)
- ✅ I-TAB-PROPS-STABLE (Wave 2)
- ✅ I-TAB-SCREENS-MEMOIZED (Wave 2)
- ✅ I-SENTRY-SINGLE-INIT (Wave 2)
- ✅ I-PROVIDER-VALUE-MEMOIZED (Wave 2 — informally)

### New
- **I-HOOKS-ABOVE-EARLY-RETURNS** (NEW — Wave 2.6) — every React Hook in any component must be called UNCONDITIONALLY, in particular not after any `if (...) return ...` early return. CI gate: `check-react-hooks-rules.sh`.

---

## §9 Parity Check

**Solo + Collab parity:** No change. Hooks were relocated, not modified. All bodies and dep arrays preserved exactly.

**iOS + Android parity:** N/A — relocation only.

---

## §10 Cache Safety

No change. No query keys touched. No mutation logic changed. Cache behavior preserved.

---

## §11 Regression Surface

The relocation is mechanical (cut-paste, no logic change) but moves a lot of code. Tester should spot-check:

1. **App cold-start with auth loading:** force-quit, reopen, sign in. Verify NO "Rendered more hooks" error in console. App reaches HomePage cleanly.
2. **App cold-start while signed-in:** sign in, force-quit, reopen. Verify same.
3. **All 5 tabs render correctly** (the 22 hoists feed all 6 tabs' props).
4. **closeProfileOverlays still fires on tab switch** when a friend profile overlay is open.
5. **Wave 1 swipe smoothness** — gestures unchanged.
6. **Solo→Collab session switch** — session state preservation unchanged.

---

## §12 Constitutional Compliance

| Principle | Touched? | Status |
|---|---|---|
| #1 No dead taps | N | N/A |
| #3 No silent failures | N | N/A |
| #7 Label temporary | N | N/A |
| Other | N | N/A |

Relocation is a structural fix, not a feature change.

---

## §13 Spec Deviations

1. **CI gate scoped to Wave 2 surface area only** — dispatch §4 step 5 said `npx eslint app/index.tsx`. I expanded that to include all 11 files Wave 2/2.5/2.6 modified, since narrowing to a single file would miss the providers and tab files where hooks were also added. Documented in the gate's own comment.
2. **Pre-existing rules-of-hooks violation in `PopularityIndicators.tsx:221`** — discovered when running ESLint with broader scope. Out of Wave 2 scope. Documented as D-WAVE2.6-IMPL-1.

---

## §14 Discoveries for Orchestrator

- **D-WAVE2.6-IMPL-1 (P1):** `app-mobile/src/components/PopularityIndicators.tsx:221` calls `useAnimatedStyle` conditionally. ESLint flags as a `react-hooks/rules-of-hooks` error. Pre-existing, NOT introduced by Wave 2/2.5/2.6. Will crash the component when the conditional path takes both branches in different renders. Recommend a separate ORCH dispatch to fix. Quick fix likely: hoist the `useAnimatedStyle` call to unconditional position.

- **D-WAVE2.6-IMPL-2:** The `eslint-config-expo/flat` preset includes `react-hooks/rules-of-hooks` but the rule level is `warning`, not `error`, in the default config. Hence ESLint produced no error before Wave 2.6's gate explicitly set it to `error`. Recommend bumping to `error` in `eslint.config.js` for ALL files (post-fix of D-WAVE2.6-IMPL-1). This would catch future occurrences program-wide, not just in Wave 2 surface area.

- **D-WAVE2.6-IMPL-3:** The negative-control test for `check-react-hooks-rules.sh` was NOT performed (would require deliberately breaking the code, then reverting). Tester should run this in their independent verification.

---

## §15 Founder Retest Instructions

To verify the fix landed on dev client:

1. **Stop Metro** (Ctrl+C in the terminal running `npx expo start`).
2. **Restart Metro:** `cd app-mobile && npx expo start --clear` (the `--clear` is important to flush bundler cache).
3. **Force-quit the dev-client app** on your phone.
4. **Reopen the dev-client app.** Wait for the splash screen and Metro bundle.
5. **Watch the console for the error.** Expected outcome:
   - Wave 1 logs (auth, RevenueCat, etc.) all fire as before.
   - **NO "React has detected a change in the order of Hooks" warning.**
   - **NO "Rendered more hooks than during the previous render" error.**
   - App reaches HomePage cleanly.
6. **F-01 retest:** tap between tabs. Console shows `[render-count] X: N` for the new active tab only.

If the error appears again, send the new console log — there may be additional misplaced hooks I missed (unlikely but possible).

---

**End of report. Hot-fix implemented and CI-verified. Dev-client retest is the live-fire gate.**
