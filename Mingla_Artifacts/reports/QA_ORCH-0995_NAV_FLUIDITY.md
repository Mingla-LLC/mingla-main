# QA — ORCH-0995 [Android nav jank — UI-thread spotlight + instant tab-tap feedback]

- **Date:** 2026-05-29
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-0995-[android-nav-jank]/` on branch `ORCH-0995-android-nav-jank`
- **Branch HEAD at QA:** `77174c9f80f075580ede8d47c7c1c4b3ffc02d9e` (pre-adversarial-commit) → `2b33d0debffdf5df1523e714865d56c510ed14a5` (adversarial test committed)
- **Commits under test:** `b91770195` (spotlight → Reanimated UI thread) · `77174c9f8` (optimistic tab feedback + startTransition deferred mount)
- **Mode:** TARGETED
- **Comms ledger:** read on entry; no OPEN entry targets ORCH-0995 / mingla-tester. No new cross-ORCH discovery.

---

## VERDICT: CONDITIONAL PASS

- **P0:** 0 | **P1:** 0 | **P2:** 0 | **P3:** 1 (pre-existing, not introduced) | **P4:** 2
- **Condition:** the one remaining unverified criterion is *perceptual* tab-switch smoothness on mid-tier Android — inherently a human-eyeball measurement (no automated test, Maestro flow, or even a frame trace short of a native profiler can assert "feels fluid"). The implementor's matrix flags this same single criterion UNVERIFIED. All FUNCTIONAL behavior (the desync risk surface) is machine-proven. Seth confirms perceptual fluidity on the attached SM-A725F to upgrade to full PASS.

---

## Why CONDITIONAL, not PASS

The functional contract of this fix — an optimistic-selection state machine that must never desync the highlight from the source of truth — is **pure React state with zero native/async dependency**. It is therefore fully and deterministically machine-verifiable, and it is (see below). The fix's *purpose*, however, is perceptual 60fps smoothness during the tab-switch on a mid-tier Android device. That cannot be asserted by any test in this repo's toolchain; it needs Seth's eye on the physical SM-A725F (already attached: `adb devices` → `R58R54YV7JT`). Per `feedback_tester_3sims_plus_operator_physical.md`, the tester does not drive Seth's physical device — it hands off. The booted iOS sims (`17091E60…`, `F7ECAC25…`) are unassigned to this ORCH and no Metro is running; per `feedback_no_cross_session_test_interference.md` I did not commandeer them or start a global Metro. iOS was already smooth pre-fix, so an iOS functional tap-through would not exercise the Android jank anyway.

---

## Adversarial regression test (tester-authored)

- **Path:** `app-mobile/src/components/__tests__/orch-0995-tester-optimistic-desync-adversarial.test.tsx`
- **Committed:** `2b33d0debffdf5df1523e714865d56c510ed14a5` on `ORCH-0995-android-nav-jank`
- **Run:** `cd app-mobile && node src/components/__tests__/orch-0995-tester-optimistic-desync-adversarial.test.tsx`
- **Output (on the fix):**
  ```
  PASS ADV-1..ADV-3 + ADV-W1..ADV-W4 ORCH-0995 tester adversarial — optimistic-nav
  desync edge cases (rapid multi-tap, programmatic-same-page reconcile, reduce-motion
  geometry) hold against a faithful effect-timing model wired to the real component
  ```

### Different angle from the implementor's tests (NOT a rename)

The implementor's `createNav` model commits exactly one press and **unconditionally** clears `pending` on every `commitCurrentPage` — it never models that the real reconcile `useEffect(..., [currentPage])` fires **only when `currentPage`'s value actually changes**. My model reproduces that React dependency-comparison semantics faithfully (`runReconcileIfCurrentPageChanged` tracks the previously-seen value), then attacks the gaps that the naive model hides:

- **ADV-1 — rapid triple-tap (home→discover→connections→likes) before any commit.** Asserts `displayPage` tracks the LAST tap (`likes`), then attacks two reconcile orderings: (a) `currentPage` coalesces straight to `likes` → no strand; (b) `currentPage` lands on an INTERMEDIATE page (`connections`) first — the reconcile fires early and clears pending, and `displayPage` must hand authority back to the authoritative `currentPage` (`connections`) rather than stranding on the stale last-tap (`likes`), then follow the final commit. This is the exact desync the optimistic pattern risks under `startTransition` coalescing.
- **ADV-2 — programmatic nav to the SAME page a stale lead points to.** Because the real reconcile is keyed on `currentPage`'s VALUE, a tap whose pending equals the eventual `currentPage` must still leave pending cleared; proven by showing a SUBSEQUENT programmatic nav to a different page still moves the highlight (i.e. pending didn't stick and deadlock the reconcile).
- **ADV-3 — reduce-motion geometry.** While an optimistic lead is active, the instant-set spotlight geometry is computed from `displayPage`'s tab layout (the tapped tab), NOT `currentPage`'s — asserted against five tabs with distinct x/width so a wrong-tab landing is detectable, plus a negative assertion that it does NOT land on the old `currentPage` tab.
- **ADV-W1..W4 — source-wiring guards** bind the faithful model to the real component (reconcile keyed on `[currentPage]`; geometry read from `tabLayoutsRef.current[displayPage]`; re-tap guard `key === displayPage`; `active = key === displayPage`). These are the fails-on-revert keys.

### Fails-on-revert (proven)

Reverted the optimistic logic in `GlassBottomNav.tsx` (reconcile dep `[currentPage]`→`[]`; `displayPage` lookup→`currentPage`; `active`→`currentPage`; re-tap guard→`currentPage`) at HEAD **`77174c9f80f075580ede8d47c7c1c4b3ffc02d9e`** → adversarial test **FAILED** at `ADV-W1` (`reconcile effect must be ... keyed ONLY on currentPage`), exit 1. Restored the fix → **PASS**, exit 0. The test exercises the actual fix, not a tautology.

---

## Existing happy-path tests (re-run, green)

| Test | Result |
|---|---|
| `orch-0995-bottom-nav-spotlight-ui-thread.test.tsx` | `PASS T-01..T-07` exit 0 |
| `orch-0995-impl2-optimistic-tab-feedback.test.tsx` | `PASS T-08..T-18` exit 0 |

Implementor fails-on-revert hashes verified to be real commits: `22ad396aee5b4f2376d6e11e27dd8cee14e7a8f2`, `2a30c8edcfa11607b5cbf6140b86b6bc36db5db0` (`git cat-file -t` → `commit`).

---

## Independent code verification (read the source, not the report)

| Claim | Verified | Evidence |
|---|---|---|
| No `useNativeDriver: false` on the spotlight | YES | `grep` over `GlassBottomNav.tsx` → 0 hits; spotlight now uses `useSharedValue`/`useAnimatedStyle`/`withSpring` (lines 30-34, 169-203). No `Animated.spring(`/`Animated.parallel(` (RN) remain. |
| `displayPage` drives spotlight + active icon + label + a11y | YES | `displayPage = pendingPage ?? currentPage` (L96). Spotlight effect reads `tabLayoutsRef.current[displayPage]` (L175). `active = key === displayPage` (L242) feeds icon color (L274), label style (L287), and `accessibilityState={{ selected: active }}` (L268). |
| Reconcile clears pending on every real commit | YES | `useEffect(() => { setPendingPage(null); }, [currentPage])` (L102-104). Fires on tapped OR programmatic `currentPage` change → cannot desync. |
| onPress sets pending BEFORE onNavigate; re-tap is a no-op | YES | `if (key === displayPage) return;` then `setPendingPage(key); onNavigate(key);` (L249-259). Guard is optimistic-aware (uses `displayPage`, not stale `currentPage`). |
| `startTransition` wraps `setCurrentPage`; `closeProfileOverlays()` stays urgent | YES | `app/index.tsx` L2488-2504: `closeProfileOverlays()` runs OUTSIDE; only `setCurrentPage(page)` is inside `React.startTransition(() => { ... })`. |
| Only active tab mounts (CI gate) | YES | `bash scripts/ci/check-active-tab-only.sh` → `I-ONLY-ACTIVE-TAB-MOUNTED: PASS`, exit 0. No `tabVisible`/`tabHidden` reintroduced. |
| reduceMotion instant-set + layoutTick re-run preserved | YES | reduceMotion branch instant-sets `.value` with no `withSpring` (L180-185); effect dep array `[displayPage, layoutTick, reduceMotion, spotlightX, spotlightWidth]` (L197) keeps `layoutTick`. |
| Spring feel = designSystem tokens | YES | `withSpring` config = `c.motion.springDamping`(18)/`springStiffness`(260)/`springMass`(0.9) (L188-192), matching `designSystem.ts` L610-612. |
| No new native dependency (OTA-safe) | YES | `react-native-reanimated@^4.1.5` + `react-native-worklets@0.5.1` already in `package.json` (L137/143); `react-native-worklets/plugin` in `babel.config.js` (L6); `React.startTransition`/`useState` are built-in. Zero package.json change. |

---

## tsc + lint (touched files)

- **tsc:** `npx tsc --noEmit` → 0 errors referencing `orch-0995*`, `GlassBottomNav.tsx`, or `app/index.tsx` (grep of output empty). The adversarial test is `@ts-nocheck` per the repo's standalone-node-script test convention (same as both implementor tests).
- **lint (adversarial test):** `npx eslint` → 0 errors, 3 `@typescript-eslint/no-require-imports` warnings — identical to the implementor's two test files and the orch-0945 convention (these are node:assert scripts, not RN modules), accepted.

---

## CI-gate result

`app-mobile/scripts/ci/check-active-tab-only.sh` → **`I-ONLY-ACTIVE-TAB-MOUNTED: PASS`** (exit 0). The `startTransition` change did not regress the single-active-tab mount structure.

---

## Regression-test gate (ORCH-0840)

1. Tester adversarial test committed at `2b33d0de…`, attacks a DIFFERENT angle (effect-timing-faithful desync edge cases) — **satisfied**.
2. Implementor happy-path tests exist, run green, fails-on-revert verified by implementor at cited hashes `22ad396a…` / `2a30c8ed…` — **satisfied**.
3. All three test files appear in `git diff main...HEAD --name-only` — **satisfied** (both implementor tests added in-branch; adversarial test committed this turn). Spotlight test was ADDED in this branch (absent on `main`), so the append-only gate requires no `[TEST-MOD-APPROVED]` tag.

---

## Constitution (relevant rules)

- **R1 no dead taps:** PASS — every tab responds; optimistic highlight on the tap frame.
- **R2 one owner per truth:** PASS — `currentPage` (parent) remains the single source; `pendingPage` is a transient optimistic *lead* that the `[currentPage]` reconcile always collapses back into the source. Cannot fork ownership.
- **R3 no silent failures:** PASS — no new error paths; reduceMotion/a11y init unchanged.
- R4-R14: N/A or unchanged (no DB/RLS/edge/query-key/currency/auth/persisted-state touched).

---

## Findings

- **P3 (pre-existing, NOT introduced):** `TabConfig` type in `GlassBottomNav.tsx` (~L49) is declared but unused — lint warning predating this ORCH. Out of scope; flag for a cleanup sweep.
- **P4:** Clean optimistic-state design — the `displayPage = pendingPage ?? currentPage` + `[currentPage]`-keyed reconcile is the correct, desync-proof shape; `closeProfileOverlays()` correctly kept urgent outside the transition.
- **P4:** Resting geometry is animated via true `left`/`width` (not `scaleX`), avoiding corner-radius distortion mid-animation — the right call.

---

## Discoveries for orchestrator

- The ONLY criterion that cannot be machine-verified is perceptual fps smoothness on mid-tier Android. The attached SM-A725F (`R58R54YV7JT`) with `com.mingla.app.v2` is the correct target for Seth's eyeball. This is the gating item for full PASS.
- No cross-ORCH impact; `GlassBottomNav` is consumer-app-only chrome (not rendered on web/business/admin).
