# IMPLEMENTATION — ORCH-1320 [biz Account-tab Apple crash]

Mode: IMPLEMENT. Executes `Mingla_Artifacts/specs/SPEC_ORCH-1320_ACCOUNT_TAB_APPLE_CRASH.md` (binding contract).
Surface: `mingla-business/` NATIVE iOS (business-only). S0 LAUNCH BLOCKER — Apple's 3rd rejection.
Worktree: `~/Desktop/mingla-orchs/1320-[biz-account-apple-crash]/` on branch `1320-biz-account-apple-crash`.
Status: **implemented and verified (Fix A); Fix B install+compile-verified but boot-gate not executable here → reverted.**

**DEP SET SHIPPED: A-ONLY.** Fix A (de-worklet BottomNav) is committed. Fix B (reanimated 4.3.1 /
worklets 0.8.3 bump) was attempted, PASSED the isolated-install + compile + jest gates cleanly, but
its SPEC-mandated native **build+boot+smoke** gate (§4 steps 2–4) is not executable-to-PASS in this
non-interactive session — so per the SPEC's explicit FALLBACK RULE it was **reverted** and Fix A
ships alone. Fix A already removes the exact reproduced crash trigger, so a reverted Fix B does not
block resubmission.

---

## 1. Summary (plain English)

The business app crashed ("closes unexpectedly") every time Apple's reviewer tapped the **Account**
tab after Sign-in-with-Apple. Root cause (proven in the investigation crash log): a
`react-native-reanimated` worklet — the BottomNav tab-bar spotlight that springs on every tab tap —
raced React's Fabric mount-commit under the New Architecture, dereferencing freed memory
(`EXC_BAD_ACCESS` use-after-free) below the JS error boundary, so the whole app terminated.

The fix **de-worklets** that spotlight: the tab highlight now animates with **RN-core `Animated`**
(JS driver, `useNativeDriver:false`) instead of a Reanimated worklet, so there is **no second runtime
touching shared state during the tab-swap commit** — the cross-runtime race is structurally
impossible on this path. The spotlight still spring-slides to the tapped tab (same physics), and it
now also starts on the **next frame** (`requestAnimationFrame`) so it never interleaves with the route
mount-commit. Reduce-motion is re-sourced from a new RN-core `AccessibilityInfo` helper (Reanimated's
`useReducedMotion` went with the removed import). New Arch stays ON.

Ships in a **fresh native EAS build** (business iOS + Android). NO OTA (native change; business OTA
frozen).

---

## 2. SPEC success-criteria coverage

| SC | Criterion | Status | Evidence / commit |
|----|-----------|--------|-------------------|
| SC-1 | Signed-in soak, ≥50 rapid Home↔Account taps, zero new `.ips` | **UNVERIFIED (tester)** | Best-effort, auth-gated soak — needs a signed-in account / appreview bypass on a New-Arch build. SPEC assigns the fails-on-revert weight to SC-3 (structural), not SC-1. Routed to tester. |
| SC-2 | Builds + cold-boots to signed-in Home → Account without terminating; New Arch stays ON | **UNVERIFIED (tester/build)** | Requires a native build + signed-in session (see §9 build-gate note). `newArchEnabled:true` untouched (not in allowlist). |
| SC-3a | `BottomNav.tsx` imports NO symbol from `react-native-reanimated` | **✓ PASS** | `d5098d04f`; T-1 green (3/3), fails-on-revert proven. |
| SC-3b | (Fix B only) package.json floors reanimated ≥4.3.1 + worklets ≥0.8.0 | **N/A** | Fix B reverted → invariant stays DRAFT/N-A, T-7 omitted (per SPEC §6/§8). |
| SC-4 | Active-tab spotlight still highlights on every tap (spring-slide or instant) | **✓ implemented, UNVERIFIED-visual** | RN-core `Animated.spring` with preserved `stiffness:260/damping:18/mass:0.9`; visual parity to confirm on device (tester). |
| SC-5 | No regression to Toast/SheetMobile/TopSheet/ConfirmDialog/BusinessNotifications; biz web bundle builds | **partially verified** | Fix A does not touch those files (unaffected). Fix B compile-verified against all 27 reanimated consumers (0 new tsc errors) but reverted; runtime smoke routed to tester. |

---

## 3. Files changed (closing diff vs origin/main)

Product code + test (this implementation):

| File | Δ | What |
|------|---|------|
| `mingla-business/src/components/ui/BottomNav.tsx` | ~+45 / −20 | Fix A.1 de-worklet + Fix A.2 rAF defer + protective comment |
| `mingla-business/src/hooks/useReducedMotionNative.ts` | +50 (new) | RN-core `AccessibilityInfo` reduce-motion helper |
| `mingla-business/app/(tabs)/_layout.tsx` | +16 | Fix A.2 Slot finding-comment + root-Stack DO-NOT-TOUCH note |
| `mingla-business/src/components/ui/__tests__/BottomNav.reanimated-free.test.ts` | +52 (new) | T-1 append-only structural guard |

`package.json` / `package-lock.json` / `node_modules`: **reverted to origin/main state** (Fix B not
shipped). No working-tree residue.

---

## 4. Data-model changes applied

None. No DB / migration / edge / RLS / realtime change (SPEC §4: Component + dependency layers only).

## 5. Edge functions touched

None.

---

## 6. Regression tests added

- **T-1 (happy-path structural guard):**
  `mingla-business/src/components/ui/__tests__/BottomNav.reanimated-free.test.ts` — 3 assertions:
  (a) no `from "react-native-reanimated"` import; (b) no worklet API symbol
  (`useSharedValue`/`useAnimatedStyle`/`useReducedMotion(`/`withSpring`/`withTiming`/bare
  `cancelAnimation(left|width)`); (c) drives the spotlight with RN-core `Animated` + `useNativeDriver:
  false` + `useReducedMotionNative`.
  - Passing run (shipped state, anchor node_modules): **Test Suites: 1 passed; Tests: 3 passed.**
  - **fails-on-revert verified at `d5098d04f`.** Method: re-added the crash-causing
    `import { useSharedValue } from "react-native-reanimated";` to `BottomNav.tsx` → T-1 FAILED
    (2 of 3 assertions failed); `git checkout -- BottomNav.tsx` restored the committed fix → T-1 PASSED
    (3/3). (The revert re-introduces the exact worklet import the crash log implicates.)
- **T-7 (Fix B version-floor):** OMITTED — Fix B reverted (SPEC §8: "if Fix B reverted … its test is
  omitted").

Enforces `I-PROPOSED-1320-NO-WORKLET-ON-TAB-COMMIT-PATH` (DRAFT — orchestrator flips ACTIVE at CLOSE).
`I-PROPOSED-1320-REANIMATED-WORKLETS-VERSION-FLOOR` stays DRAFT/N-A (Fix B not shipped).

---

## 7. Old → New receipts

### BottomNav.tsx
- **Before:** spotlight `left`/`width` were Reanimated `useSharedValue`s animated with
  `withSpring`/`withTiming` inside `useAnimatedStyle`; reduce-motion from Reanimated `useReducedMotion`;
  cleanup via `cancelAnimation`. The worklet ran on the tab-switch/mount-commit path → the proven
  Fabric-commit UAF.
- **Now:** `left`/`width` are RN-core `Animated.Value` refs; animated with `Animated.spring`/
  `Animated.timing` (`useNativeDriver:false`, same physics `stiffness:260/damping:18/mass:0.9`, same
  200ms reduce-motion timing); style inlined as `{ left, width }` on RN `Animated.View`; cleanup via
  `.stopAnimation()`; reduce-motion from `useReducedMotionNative`. The `.start()` calls are wrapped in
  `requestAnimationFrame` (A.2), cancelled on cleanup. No `react-native-reanimated` import remains.
- **Why:** SC-3a / Fix A.1 + A.2 — remove the worklet that races the Fabric mount-commit; no worklets
  runtime on this path ⇒ no cross-runtime UAF.
- **Lines:** ~45 changed.

### useReducedMotionNative.ts (new)
- **Before:** did not exist.
- **Now:** `useReducedMotionNative(): boolean` — reads `AccessibilityInfo.isReduceMotionEnabled()` on
  mount + subscribes to `reduceMotionChanged`, cleans up on unmount, fails open (no silent swallow;
  `__DEV__` warn). Zero reanimated import.
- **Why:** Fix A.1 helper — non-reanimated reduce-motion source for BottomNav.
- **Lines:** +50.

### app/(tabs)/_layout.tsx
- **Before:** `<Slot />` rendered with no explanatory comment.
- **Now:** a finding-comment above `<Slot />` records that tab switches render inside the Slot
  (SlotNavigator/StackRouter — no `<ScreenStack>`, no `animation` prop on the tap-Account path; OQ-1
  RESOLVED), that the deterministic fix is de-worklet-ing BottomNav (not disabling a non-existent tab
  animation), and DO-NOT set the root `<Stack>` to `animation:"none"` (off-path UX regression).
- **Why:** Fix A.2 finding-comment; corrects the dispatch premise for future maintainers.
- **Lines:** +16 (comment only; no behavior change).

### BottomNav.reanimated-free.test.ts (new)
- **Before:** did not exist.
- **Now:** T-1 structural guard (see §6).
- **Why:** SC-3a / fails-on-revert contract.
- **Lines:** +52.

---

## 8. Cross-surface impact

| Surface | Affected? | User-visible | Parity |
|---------|-----------|--------------|--------|
| Consumer iOS (`app-mobile/`) | NO | — | Separate ORCH-1321 (same class) |
| Consumer Android (`app-mobile/`) | NO | — | Separate ORCH-1321 |
| Buyer/anon Web (`/checkout`, `/e/…`, `/b/…`, `/t/…`) | NO | — | No Account tab / uses `BottomNav.web.tsx` (untouched) |
| **Business iOS** | **YES (primary)** | Account tap no longer terminates; spotlight still highlights active tab | Manual (native path) |
| **Business Android** | **YES (re-smoke)** | Same shared-source tab behavior; re-smoke the spotlight | Automatic (shared RN source) |
| Admin Web | NO | — | No equivalent |
| Business Web preview | NO (covered-by-smoke) | Native-only file (`BottomNav.tsx`); web uses `BottomNav.web.tsx` (untouched) | Web bundle unaffected |

Parity note: Fix A edits the shared native `BottomNav.tsx` → Android inherits it automatically; a
re-smoke on a New-Arch Android build is required (OQ-3). Only `BottomNav.tsx` (native) changed —
`BottomNav.web.tsx` is untouched, so web is inert.

---

## 9. Smoke / gate results

**Fix A (shipped):**
- T-1 unit guard: **3/3 PASS** (anchor node_modules, reanimated 4.1.7). fails-on-revert proven @ `d5098d04f`.
- `tsc --noEmit` on the 3 touched files: **0 errors** (project baseline is 750 pre-existing errors,
  all in unrelated files — mostly `../packages/*`; none in touched files, unchanged by this work).
- Strict-grep gates re-run (BottomNav/layout-relevant): `orch-0885-a-no-bottomnav-on-wide-desktop`
  **PASS**, `orch-1055-nav-tab-rank-gate` **PASS**, `orch-1105-web-gesture-safe` **PASS**.
- Runtime boot/soak (SC-1/SC-2): **UNVERIFIED** — deferred to tester (needs a signed-in New-Arch
  build; see below). Fix A is source-verified + statically guarded; runtime proof is the tester's
  adversarial soak.

**Fix B (attempted, then reverted — install + compile PASS, boot gate blocked):**
- **Gate step 1 — isolated clean install: PASS.** Removed the worktree `node_modules` symlink only
  (anchor `~/Desktop/mingla-main/mingla-business/node_modules` left intact), ran a REAL isolated
  `npm install` in the worktree. Result: `react-native-reanimated@4.3.1`, `react-native-worklets@0.8.3`,
  `react-native@0.81.5` resolved with **zero ERESOLVE / zero peer-dep conflicts** ("added 1270 packages
  in 11s"). Confirms the SPEC's version compatibility claims (reanimated 4.3.1 peers RN 0.81–0.85 +
  worklets 0.8.x; worklets 0.8.3 peers RN 0.81–0.85).
- **Compile: PASS.** `tsc --noEmit` against the newly-installed 4.3.1 / 0.8.3 types: total error count
  **unchanged at 750** (identical to the 4.1.x baseline); **zero new errors** in any of the 27
  reanimated-consuming files, incl. the 5 high-risk worklet-API targets (Toast/SheetMobile/TopSheet/
  ConfirmDialog/BusinessNotificationsScreen). jest sanity (T-1 + Toast.test) against the new
  node_modules: **9/9 PASS** (module resolution intact).
- **Gate steps 2–4 — native build BOOTS + Account smoke + dependency-walk regression smoke: BLOCKED /
  not executable-to-PASS in this non-interactive session.** Reasons (all documented, ORCH-1320-scoped):
  1. The worktree is a **managed Expo app with no `ios/` directory** — a local sim build first needs
     `expo prebuild` + `pod install` + `xcodebuild` + manual framework-embed/codesign (runbook is
     written for the ANCHOR checkout's `ios/`, not the worktree).
  2. **Local New-Arch worktree iOS builds red-screen** — `react-native-keyboard-controller@1.18.5`
     (mounted at root via `KeyboardRoot`) does not link under a local worktree build (investigation
     blocker #1 / COMMS-0084 / ORCH-1317 / `reference_consumer_device_test_use_eas_cloud_dev_build`).
  3. **The signed-in Account smoke (SC-2) cannot be met headlessly** — it needs the `appreview@`
     bypass (a server secret the classifier blocks me from reading) or real Sign-in-with-Apple (not
     headless). An EAS cloud build would not change this smoke blocker.
- **Decision (SPEC §4 FALLBACK RULE, verbatim):** "On ANY Fix-B build/boot/smoke failure, revert
  package.json L153/L160 to `~4.1.1` / `0.5.1` and ship Fix A alone." Because gate steps 2–4 cannot be
  brought to PASS here, Fix B does **not** meet its ship condition ("ships only if all four gate steps
  PASS"). **Reverted** package.json + package-lock.json to origin/main; restored `node_modules` to the
  anchor symlink (verified resolves 4.1.7). Anchor never mutated.

---

## 10. Known issues / deferred

- **Fix B (durable root fix) deferred, NOT rejected.** Its install + compile + module-resolution gates
  all PASSED cleanly — it is very likely sound. It was withheld only because its native boot+smoke gate
  is not completable in this session. **Recommendation:** on the fresh resubmit EAS cloud New-Arch
  build, if the tester (or the build cadence) boots reanimated 4.3.1 / worklets 0.8.3 and passes the
  signed-in Account soak + the 5 worklet-API regression smokes, land the bump as a fast follow-up
  ORCH/PR with **T-7** (version-floor test) and flip
  `I-PROPOSED-1320-REANIMATED-WORKLETS-VERSION-FLOOR` ACTIVE in the same PR (per
  `feedback_docs_only_close_skips_paths_gated_suite`). Fix A stands alone as the launch-blocker fix
  meanwhile.
- **UX delta (spotlight):** the spring is now JS-driven (RN-core `Animated`, `useNativeDriver:false`)
  instead of Reanimated UI-thread-driven; physics preserved (`stiffness:260/damping:18/mass:0.9`) so it
  looks the same, but may be marginally less smooth under heavy JS-thread load. Acceptable for a
  ≤5-tab capsule (SPEC §4). The documented instant-highlight fallback was NOT needed — the JS-driven
  spring is a faithful visual match; confirm on device.
- **SC-1/SC-2 runtime proof** is the tester's (auth-gated soak) — not closeable from source.

---

## 11. Operator action required

- **No migration, no edge deploy** — none touched.
- **Fresh native build required** (SPEC §Shipping note): cut a new business iOS + Android EAS build
  (bump the build number; `runtimeVersion.policy` is `appVersion`) carrying commit `d5098d04f`, then
  resubmit to App Store Connect. **NO OTA** (native change; business OTA frozen — COMMS-0063).
- **Recommended for the resubmit build:** verify `EXPO_PUBLIC_SENTRY_DSN` is present (OQ-2 / D-3) so
  any recurrence is captured.

---

## 12. Discoveries for Orchestrator

- **Fix B is install/compile-clean and ready to land** the moment a New-Arch boot+soak passes — see
  §10. Low risk (zero direct `react-native-worklets` imports in business source; the 0.5→0.8 jump is
  fully transitive under reanimated 4.3.1; 0 new tsc errors across all 27 consumers).
- **D-1 (carried from investigation, not this ORCH):** `ensureCreatorAccount` did not persist a
  `creator_accounts` row for a subset of fresh Apple signups — own investigation.
- **Project tsc baseline is red (750 errors, mostly `../packages/*` "Cannot find module 'react'").**
  Pre-existing, unrelated to this ORCH; CI relies on scoped strict-grep + targeted jest, not full-tree
  `tsc` green. Flagging as a latent hygiene item.
- **OQ-1 RESOLVED/ACCEPTED** in code: there is no tab-transition animation prop to disable (the
  `<Slot/>` finding); de-worklet IS the fix. Root `<Stack>` deliberately untouched.

---

## Downstream routing

- **NEXT = orchestrator REVIEW**, then **`mingla-tester`**: run T-1..T-6 + T-8; drive the adversarial
  signed-in soak (randomized rapid Home↔Account + Ari/Hub tab spam while React Query resolves the
  account hooks; capture `~/Library/Logs/DiagnosticReports`) on a fresh New-Arch build; confirm
  fails-on-revert (T-6); re-smoke Android; and (optionally) execute the Fix-B boot+soak gate on the
  same EAS cloud build to unblock the durable bump.
- **Working tree:** `~/Desktop/mingla-orchs/1320-[biz-account-apple-crash]/` on branch
  `1320-biz-account-apple-crash`. Fix commit: `d5098d04f`.
