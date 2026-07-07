# SPEC — ORCH-1320 [biz-account-tab-apple-crash]

Mode: SPEC (build contract; NO code written here). Follows the sealed investigation
`Mingla_Artifacts/investigations/INVESTIGATION_ORCH-1320_ACCOUNT_TAB_APPLE_CRASH.md`.
Surface: `mingla-business/` NATIVE iOS (business-only). S0 LAUNCH BLOCKER — Apple's 3rd rejection.
Worktree: `~/Desktop/mingla-orchs/1320-[biz-account-apple-crash]/` on branch `1320-biz-account-apple-crash`.

> Comms ledger read on entry: no OPEN BLOCK/WARN row is addressed to forensics / ORCH-1320 / ALL that
> requires action. COMMS-0052 (business-OTA freeze, severity BLOCK) is status **RESOLVED** and
> superseded by **COMMS-0063** (OTA re-blocked empirically — NATIVE BUILD ONLY). The freeze is
> honored: this fix ships in a fresh native build, never an OTA (see §Shipping note).

---

## 1. Executive summary

Build 28 of the business app **crashes ("closes unexpectedly")** every time the reviewer taps the
**Account** tab after Sign-in-with-Apple. The investigation proved (crash log
`evidence/ORCH-1320/MinglaBusiness-2026-07-02-004349.ips`, symbolicated) that this is a NATIVE
`EXC_BAD_ACCESS (SIGSEGV)` **use-after-free inside the Fabric mount-commit** under the New
Architecture — not a JS error (the root ErrorBoundary would catch that). At crash time two runtimes
touch shared state at once: the **Reanimated worklets runtime on the main thread** (`SerializableWorklet::toJSValue` under `worklets::AroundLock`) races the **Fabric commit on the JS thread**
(`Scheduler::uiManagerDidFinishTransaction`). The concrete worklet on the crash path is the
**BottomNav tab-bar spotlight** (`withSpring` shared-value animation that fires on every tab tap),
running while the tab screen mount-commit executes.

We ship a **belt-and-suspenders fix in ONE PR**:
- **Fix A (unconditional, deterministic):** de-worklet the crash-path animation — replace BottomNav's
  Reanimated spring spotlight with a non-worklet equivalent (RN core `Animated`, or a static
  highlight), so **no worklet runs on the tap-Account → mount-commit path**. This removes the exact
  reproduced trigger and does not depend on any dependency change.
- **Fix B (conditional, durable root fix):** coordinated bump `react-native-reanimated 4.1.7 → 4.3.1`
  + `react-native-worklets 0.5.1 → 0.8.3`, which carries the upstream **"fix registries race
  conditions"** patch (reanimated 4.3.1, 7 May) that fixes the worklets-registry UAF class. Fix B
  ships **only if** it build- and boot-verifies on Expo SDK 54; otherwise it is reverted and Fix A
  ships alone.

The New Architecture stays **ON** (`newArchEnabled: true`) — Reanimated 4 requires it.

---

## 2. Scope & non-goals

**In scope:** `mingla-business/` native iOS (and, by shared source, native Android — re-smoke). The
BottomNav spotlight animation; the coordinated reanimated/worklets dependency bump; two structural
regression guards; two DRAFT invariants.

**Non-goals / explicitly NOT covered:**
- **Consumer app (`app-mobile/`).** The same-class exposure (Reanimated 4 + worklets on New Arch) is
  a SEPARATE ORCH-**1321**. This SPEC does NOT touch `app-mobile/`.
- **expo-blur / `GlassChrome` / `GlassCard` / `glassBlur`.** RULED OUT by the live blur-ON cold-mount
  + tab-switch probe (investigation §Reproduction). Do NOT re-open or "force opaque blur."
- **`account.tsx` render, `AuthContext`, the root ErrorBoundary.** The crash is below the JS layer;
  every reachable render read is null-safe (F-1) and the boundary is intact (F-2, `I-36`). Not touched.
- **Disabling the New Architecture.** Prohibited — Reanimated 4 requires New Arch.
- **The data-integrity discovery D-1** (`ensureCreatorAccount` not persisting a `creator_accounts`
  row for some Apple signups) — real, but its own ORCH; not this fix.

**Assumptions:**
1. Build 28's binary carries the defect unchanged (F-4); a fresh native build is required regardless.
2. The worktree `node_modules` is a symlink to the anchor — installing Fix B must use an isolated real
   install (or EAS cloud build), never mutate the shared anchor `node_modules` (see §4 Fix B gate).

---

## 3. Cross-Surface Impact Declaration (per-surface)

| # | Surface | Covered? | User-visible behavior demanded | Files touched here | Parity |
|---|---------|----------|-------------------------------|--------------------|--------|
| 1 | Consumer iOS (`app-mobile/`) | **NO** | — | none | Separate ORCH-1321 (same class) |
| 2 | Consumer Android (`app-mobile/`) | **NO** | — | none | Separate ORCH-1321 |
| 3 | Buyer/anon Web (`mingla-business` `/checkout`, `/e/…`, `/b/…`, `/t/…`) | **NO** | — | none | No Account tab / no native Apple sign-in |
| 4 | **Business iOS** | **YES (primary)** | Tap Account after SIWA → Account screen renders; app does NOT terminate; spotlight still highlights the active tab | `BottomNav.tsx`, `useReducedMotionNative.ts` (new), `(tabs)/_layout.tsx`, `package.json` | Manual (native path) |
| 5 | **Business Android** | **YES (re-smoke)** | Same tab behavior; no regression to the spotlight or worklet-animated screens | same shared files | Automatic (shared RN source) — re-smoke required |
| 6 | Admin Web (`mingla-admin/`) | **NO** | — | none | No equivalent surface |
| 7 | Business Web preview | **Covered-by-smoke** | Business web still bundles + tab UI works | none (metro reanimated web-stub is version-agnostic) | Web stubs reanimated → bump is inert on web; smoke the bundle only |

The crash itself is native-iOS-confirmed. Android shares the RN source and MUST be re-smoked (the
native Fabric crash may not port to Android's renderer, but Fix A/B change shared code).

---

## 4. Layered specification

Only the **Component** and **dependency/build** layers are affected — there is NO DB / edge / service /
hook / RLS / realtime change. Those layers are correctly skipped.

### Fix A.1 — De-worklet the BottomNav spotlight (ALWAYS ships; deterministic)

**File:** `mingla-business/src/components/ui/BottomNav.tsx`

Replace the Reanimated-driven spring spotlight with a **non-worklet** equivalent so no worklet runs on
the tap-Account → commit path. Exact symbol-level change list:

| Current (Reanimated, worklet) | Replace with (non-worklet) |
|---|---|
| `import Animated, { Easing, cancelAnimation, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from "react-native-reanimated";` (L24–32) | `import { Animated, Easing } from "react-native";` — RN **core** `Animated` (add to the existing `react-native` import). Remove the `react-native-reanimated` import entirely. |
| `const left = useSharedValue(0);` (L83) | `const left = useRef(new Animated.Value(0)).current;` |
| `const width = useSharedValue(0);` (L84) | `const width = useRef(new Animated.Value(0)).current;` |
| `const reduceMotion = useReducedMotion();` (L85) | `const reduceMotion = useReducedMotionNative();` (new helper, Fix A.1 helper below) |
| `left.value = withSpring(x, SPRING_CONFIG); width.value = withSpring(w, SPRING_CONFIG);` (L95–96) | `Animated.spring(left, { toValue: x, stiffness: 260, damping: 18, mass: 0.9, useNativeDriver: false }).start(); Animated.spring(width, { toValue: w, stiffness: 260, damping: 18, mass: 0.9, useNativeDriver: false }).start();` — RN core `Animated.spring` accepts the same physics params (`stiffness`/`damping`/`mass`) → visual parity. |
| `left.value = withTiming(x, REDUCE_TIMING); width.value = withTiming(w, REDUCE_TIMING);` (L92–93) | `Animated.timing(left, { toValue: x, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();` (+ `width`). |
| `cancelAnimation(left); cancelAnimation(width);` (L102–104) | `left.stopAnimation(); width.stopAnimation();` |
| `const spotlightStyle = useAnimatedStyle(() => ({ left: left.value, width: width.value }));` (L133–136) | delete; inline the style: `<Animated.View … style={[styles.spotlight, shadows.glassChromeActive, { left, width }]} />` — RN `Animated.View` consumes `Animated.Value` directly for the layout props `left`/`width`. |

**Why `useNativeDriver: false`:** `left`/`width` are layout props (native driver only supports
`transform`/`opacity`). RN core `Animated` with the JS driver runs the animation loop **on the JS
thread through the Animated module — NOT the worklets runtime.** There is no second runtime, no
`AroundLock`, no `SerializableWorklet::toJSValue` → the cross-runtime UAF race is structurally
impossible on this path. This is the load-bearing property of Fix A.

**UX delta (note in PR):** the spotlight spring is now JS-driven instead of Reanimated UI-thread
driven; the physics are reproduced (`stiffness/damping/mass` preserved) so it looks the same, but may
be marginally less smooth under heavy JS-thread load. Acceptable for a 3–5-tab capsule.

**A.1 documented fallback (implementor may choose if JS-driven Animated is janky, or for maximum
determinism):** drop the animation entirely — an **instant highlight**: track `activeLayout` in state
and set `spotlight` `left`/`width` directly in the style (no `Animated` at all). UX delta: the
spotlight jumps to the tapped tab instead of sliding. This is fully acceptable for the launch blocker
and is the lowest-risk variant. Either variant satisfies the invariant (no reanimated import).

### Fix A.1 helper — RN-core reduce-motion (NEW small file)

**File:** `mingla-business/src/hooks/useReducedMotionNative.ts` (NEW)

- Exports `useReducedMotionNative(): boolean`.
- Implementation: RN core `AccessibilityInfo.isReduceMotionEnabled()` on mount +
  `AccessibilityInfo.addEventListener("reduceMotionChanged", …)` subscription (clean up on unmount);
  returns the boolean. NO reanimated import.
- Rationale: `useReducedMotion` is a Reanimated hook; removing reanimated from BottomNav requires a
  non-reanimated reduce-motion source. Only BottomNav consumes this helper — `ProvenanceChip.tsx`
  keeps its own `useReducedMotion` (out of scope; not on the tap-Account path).

### Fix A.2 — The "disable tab screen-transition" lever (accurate finding + defense-in-depth)

**File (finding):** `mingla-business/app/(tabs)/_layout.tsx`

**FINDING (forensic — the orchestrator's premise needs correcting, do not silently guess):** the
`(tabs)` group renders **`<Slot />`** (L135), which expo-router resolves to `SlotNavigator` (backed by
`StackRouter`) that renders **ONLY the focused route** —
`descriptors[state.routes[state.index].key].render()` — with **NO native-stack animation and NO
`react-native-screens` `<ScreenStack>` transition** (verified in
`expo-router/build/views/Navigator.js`, `SlotNavigator`). Tab switches happen via
`router.push("/(tabs)/${id}")` (L127–130) which changes the focused route **inside** the Slot; there
is **no `animation` prop on the tab-switch path to set to `"none"`.** The concurrent Fabric commit the
crash log shows (`uiManagerDidFinishTransaction`) is the plain React reconciliation of the Slot route
swap (unmount Home subtree → mount Account subtree) — intrinsic to switching tabs, not disable-able
without breaking navigation.

**Consequence:** the deterministic mitigation is Fix A.1 (remove the concurrent **worklet**), NOT
disabling a non-existent tab animation. With no worklet running during the mount-commit, the race is
eliminated. This is the accurate realization of "no screens transition races the commit."

**A.2 defense-in-depth (recommended, cheap, low-risk) — in `BottomNav.tsx`:** start the spotlight
animation on the **next frame** after the tab `active` change, by wrapping the `.start()` calls (Fix
A.1) in `requestAnimationFrame(…)` inside the existing `useEffect`. This guarantees the spotlight
animation begins **after** the route mount-commit has settled, so even the JS-thread Animated update
never interleaves with the tab-swap commit. Store the raf id and cancel it in the cleanup effect. (If
the instant-highlight fallback is chosen, A.2 is moot.)

**DO NOT (documented in the layout comment):** the ROOT `<Stack screenOptions={{ headerShown: false }} />`
at `app/_layout.tsx:748` is a native-stack, but its animation is **off** the tap-Account path (tab
switches are intra-Slot, not root pushes). Setting `animation: "none"` there would kill ALL root push
animations (auth→tabs slide, checkout, partner routes) — a broad UX regression not on the crash path.
**Do not do this.** See Open Question OQ-1.

### Fix B — Coordinated Reanimated + worklets bump (CONDITIONAL; durable root fix)

**File:** `mingla-business/package.json`

| Line | Current | Change to |
|---|---|---|
| L153 | `"react-native-reanimated": "~4.1.1"` | `"react-native-reanimated": "4.3.1"` |
| L160 | `"react-native-worklets": "0.5.1"` | `"react-native-worklets": "0.8.3"` |

**Version verification (against official sources — cited in §Sources):**
- **reanimated 4.3.1** changelog (GitHub release, tag `4.3.1`, 7 May) contains **`cherry-pick(4.3-stable): fix registries race conditions`** (the registry-race UAF fix the crash log points at) and
  **`Fix animation cancellation race condition missing code`**. It is the **lowest 4.3.x** carrying
  the fix → minimal diff from our installed 4.1.7, avoids 4.4/4.5 churn.
- reanimated 4.3.1 `peerDependencies`: `"react-native": "0.81 - 0.85"` (we run **0.81.5** ✓) and
  `"react-native-worklets": "0.8.x"`. Confirmed by 4.3.1's own `compatibility.json` (`4.3.x` → RN
  `0.81..0.85`, worklets `0.8.x`).
- **worklets 0.8.3** is the highest published `0.8.x`; `peerDependencies.react-native: "0.81 - 0.85"`
  (0.81.5 ✓) → satisfies reanimated 4.3.1's `0.8.x` peer.
- Expo SDK 54 pins reanimated `~4.1.1` + worklets `0.5.1` → this bump is **OFF Expo SDK 54's pins**;
  `npx expo install --check` / `expo-doctor` WILL warn (expected, not a blocker). New Arch already ON
  and MUST stay ON.

**Fix B build gate (REQUIRED at IMPLEMENT, in this order):**
1. **Isolated clean install** — do NOT mutate the shared anchor `node_modules` (the worktree symlinks
   it). Either build via **EAS cloud** (installs fresh in the cloud) or replace the worktree symlink
   with a real `npm install` scoped to the worktree (per memory `reference_ota_from_worktree_needs_real_npm_ci`).
2. **Native build that BOOTS** — a New-Arch **EAS cloud dev/preview build** (local worktree builds
   red-screen — `react-native-keyboard-controller` won't link locally; investigation blocker +
   `reference_consumer_device_test_use_eas_cloud_dev_build`).
3. **Boot + Account smoke** — app cold-boots to Home, navigate to Account without terminating.
4. **Dependency-walk regression smoke** (see §Dependency walk) on the same build.

**FALLBACK RULE (explicit, spell it out):**
> Fix A is **unconditional** and always ships. Fix B ships **only if** all four gate steps PASS. On
> ANY Fix-B build/boot/smoke failure, **revert `package.json` L153/L160 to `~4.1.1` / `0.5.1`** and
> ship **Fix A alone** (documented in the implementation report). Fix A already removes the reproduced
> trigger, so a reverted Fix B does not block resubmission. The PR/report MUST state which dep set
> shipped (A-only, or A+B).

### Dependency walk (Fix B breakage assessment — enumerate + assess the 0.5.1→0.8.3 worklets jump)

- **`@gorhom/bottom-sheet`: ABSENT** in `mingla-business` — it uses custom `SheetMobile`/`TopSheet`.
  No gorhom breakage surface.
- **No DIRECT `react-native-worklets` imports** anywhere in `mingla-business` source (grep clean).
  The 0.5.1→0.8.3 worklets API jump therefore has **zero direct-import surface** — it is fully
  transitive under reanimated 4.3.1 (which is authored/tested against worklets 0.8.x). This
  substantially lowers Fix-B risk.
- **Reanimated worklet-API consumers (`runOnJS`/`runOnUI`/`"worklet"`):** 5 app files —
  `ConfirmDialog.tsx`, `SheetMobile.tsx`, `Toast.tsx`, `TopSheet.tsx`,
  `BusinessNotificationsScreen.tsx` (+ the web stub, web-only, unaffected). These are the highest-risk
  regression-smoke targets for the worklets jump.
- **`react-native-gesture-handler ~2.28.0`:** no hard reanimated peer; used with reanimated in the
  sheets/gestures → smoke gesture-driven sheet open/close.
- **`expo-router ~6.0.23`:** peers reanimated `*` (no version constraint) → unaffected by the bump.
- **`react-native-screens ~4.16.0`:** independent of the reanimated version.
- **`metro.config.js:209`** aliases `react-native-reanimated` → a web stub **only when
  `platform === "web"`** (version-agnostic module-name match) → the bump is **inert on web**; smoke
  that the business web bundle still builds.
- **27 files** import from `react-native-reanimated`. Screens to regression-smoke (prioritized):
  1. BottomNav tab switching (post-A.1: no worklet — confirm visual);
  2. `Toast` (app-wide enter/exit);
  3. `SheetMobile` + `TopSheet` (bottom sheets, gesture + worklet, used across authoring/settings);
  4. `ConfirmDialog` (modal spring);
  5. `BusinessNotificationsScreen` (list animations);
  6. `Modal`, `Button`, `Pill`, `Stepper`, `Skeleton`, `Spinner`, `IconChrome`, `ActionTile`,
     `ProvenanceChip`, Ari (`AriOrb`/`StreamingText`/`InputBar`/`ResponseCard`), offering
     `DraftSelect*`, `VenueCreatorWizard`, `BrandProfileView`, `ClaimAdoptionBanner`,
     `ComposerSentConfirmation`;
  7. Business WEB build bundles (metro reanimated web-stub intact).

---

## 5. Success criteria (numbered, observable, testable)

- **SC-1 (soak, best-effort) — business iOS:** On a **signed-in** New-Arch business build (whichever
  dep set ships), perform **≥ 50 rapid Home↔Account tab taps** and cycle through Ari/Hub/Blast, with
  a live session so React Query resolves `usePartnerStripeStatus`/`useBrands`/`useSupportStaff` (extra
  concurrent Fabric commits). **ZERO new `.ips` crash reports** in `~/Library/Logs/DiagnosticReports`
  (sim) / device crash logs. **Caveat:** the race is intermittent + auth-gated, so SC-1 is a
  confidence signal, **not** proof of absence — the structural/version guards (SC-3) carry the
  fails-on-revert weight; SC-1 is best-effort and needs a real signed-in test account OR the
  `appreview@` bypass.
- **SC-2 (build + boot):** The business app **builds and cold-boots** to the signed-in Home, then
  navigates to **Account without terminating**, on a New-Arch build with the shipped dep set (A-only,
  or A+B). `newArchEnabled` stays `true`.
- **SC-3 (structural, fails-on-revert):**
  - **SC-3a:** `BottomNav.tsx` imports **NO** symbol from `react-native-reanimated` (no
    `useSharedValue`/`withSpring`/`withTiming`/`useAnimatedStyle`/`useReducedMotion`). Static-verifiable.
  - **SC-3b (only if Fix B shipped):** `package.json` pins `react-native-reanimated` **≥ 4.3.1** AND
    `react-native-worklets` **≥ 0.8.0** (the registry-race-fixed line). Static-verifiable.
- **SC-4 (visual parity) — iOS + Android:** the active-tab spotlight still visibly highlights the
  selected tab on every tap (spring-slide via RN `Animated`, OR instant highlight if the fallback
  shipped) — never blank/missing.
- **SC-5 (no regression) — iOS + Android + Web:** the 5 worklet-API surfaces (`Toast`, `SheetMobile`,
  `TopSheet`, `ConfirmDialog`, `BusinessNotificationsScreen`) animate without crash/visual break on
  the shipped build; the business **web bundle still builds** (metro reanimated stub intact).

---

## 6. Invariants

**Preserve (existing):**
- **`I-36 ROOT-ERROR-BOUNDARY`** — Fix A/B must not remove/relocate the root/inner ErrorBoundaries
  (neither fix touches `app/_layout.tsx`'s boundaries). Verified untouched by the allowlist.

**New — pre-staged DRAFT (orchestrator flips ACTIVE at CLOSE; forensics does NOT flip):**

- **`I-PROPOSED-1320-NO-WORKLET-ON-TAB-COMMIT-PATH` (DRAFT):**
  - **Rule:** the always-mounted bottom tab navigation (`mingla-business/src/components/ui/BottomNav.tsx`)
    MUST NOT run a Reanimated worklet on the tab-switch / mount-commit path — its spotlight/selection
    animation uses RN core `Animated` (or a static highlight), never `useSharedValue` / `withSpring` /
    `withTiming` / `useAnimatedStyle` / `useReducedMotion` from `react-native-reanimated`.
  - **Why:** a worklet on this path races the Fabric mount-commit → the proven ORCH-1320
    `EXC_BAD_ACCESS` UAF.
  - **Enforcement / regression test:** append-only strict-grep test asserting `BottomNav.tsx` source
    contains no `from "react-native-reanimated"` import. FAILS on revert of Fix A.1.

- **`I-PROPOSED-1320-REANIMATED-WORKLETS-VERSION-FLOOR` (DRAFT, CONDITIONAL — asserted only if Fix B
  shipped):**
  - **Rule:** while on the New Architecture, `mingla-business` pins `react-native-reanimated` **≥ 4.3.1**
    AND `react-native-worklets` **≥ 0.8.0** (the 7-May registry-race-condition-fixed line).
  - **Enforcement / regression test:** a test parsing `mingla-business/package.json` asserting both
    floors. FAILS on downgrade below the fixed line.
  - **NOTE (per `feedback_docs_only_close_skips_paths_gated_suite`):** if this DRAFT flips ACTIVE at
    CLOSE, the pinning test MUST land in the SAME PR to avoid latent main-red. Because Fix B is
    conditional, the orchestrator flips this ACTIVE **only if Fix B actually shipped**; if Fix B was
    reverted, this invariant stays DRAFT / N-A and its test is omitted.

---

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-1 (happy, structural) | BottomNav is reanimated-free | `BottomNav.tsx` source | No `react-native-reanimated` import present | static / unit |
| T-2 (happy, visual) | Tap a tab | Tap "Account" | Spotlight highlights Account; app does not terminate | runtime (build) |
| T-3 (error/soak, adversarial) | Rapid signed-in tab spam | ≥50 randomized Home↔Account↔Ari taps, live session | Zero new `.ips`; process stays alive | runtime (device/sim) |
| T-4 (edge) | Reduce-motion ON | iOS Accessibility → Reduce Motion ON, tap tabs | Spotlight uses the 200ms timing (or instant) path; no crash | runtime |
| T-5 (regression, worklet-API) | Open/close sheets + toast spam | Open `SheetMobile`/`TopSheet`, fire `Toast` ×N, confirm dialog | Animate normally; no crash/visual break | runtime |
| T-6 (fails-on-revert) | Revert Fix A.1 | Re-add reanimated import to BottomNav | T-1 FAILS | static |
| T-7 (Fix B floor, conditional) | Version floor | `package.json` | reanimated ≥4.3.1 AND worklets ≥0.8.0 (only if B shipped) | static |
| T-8 (Fix B, web) | Business web bundle | `expo export --platform web` (or the biz web build) | Bundles successfully (reanimated web stub intact) | build |

---

## 8. Implementation order

1. **Fix A.1 helper:** add `src/hooks/useReducedMotionNative.ts` (RN `AccessibilityInfo`).
2. **Fix A.1:** de-worklet `BottomNav.tsx` — swap reanimated → RN core `Animated` + the helper (or the
   instant-highlight fallback). Add the protective comment (§9).
3. **Fix A.2:** wrap the spotlight `.start()` in `requestAnimationFrame` in the `useEffect`; add the
   Slot finding-comment + root-Stack DO-NOT-TOUCH note in `app/(tabs)/_layout.tsx`.
4. **Guard T-1:** add append-only `src/components/ui/__tests__/BottomNav.reanimated-free.test.ts`.
5. **Fix B (attempt, gated):** bump `package.json` L153/L160; run the §4 Fix-B build gate (isolated
   install → EAS cloud New-Arch build → boot + Account smoke → dependency-walk regression smoke).
   - **PASS →** keep B; add guard **T-7** (version floor); both DRAFT invariants eligible to flip.
   - **FAIL →** revert L153/L160 to `~4.1.1`/`0.5.1`; ship A alone; omit T-7; version-floor invariant
     stays DRAFT/N-A. Document in the report.
6. **Fresh native EAS build** (business iOS + Android) for resubmit — see §Shipping note. NO OTA.

---

## 9. Regression prevention (fails-on-revert contract)

- **Structural safeguard 1 (always):** `BottomNav.reanimated-free.test.ts` (append-only) — asserts
  `BottomNav.tsx` has no `react-native-reanimated` import. **FAILS when Fix A.1 is reverted, PASSES
  when restored** (T-6 proves this).
- **Structural safeguard 2 (conditional on Fix B):** a `package.json` version-floor test — asserts
  reanimated ≥4.3.1 AND worklets ≥0.8.0. **FAILS when either dep is downgraded below the fixed line.**
- **Protective comment (in `BottomNav.tsx`, above the spotlight animation):** e.g. *"ORCH-1320: this
  animation MUST NOT use a Reanimated worklet. A worklet here races the Fabric mount-commit on New Arch
  → EXC_BAD_ACCESS UAF (Apple rejection 3). Keep it RN-core `Animated`/static. See
  I-PROPOSED-1320-NO-WORKLET-ON-TAB-COMMIT-PATH."*
- **Verification weighting (state plainly to the tester):** because the runtime race is **intermittent
  + auth-gated**, the STRUCTURAL/VERSION guards carry the fails-on-revert weight; the device soak
  (SC-1/T-3) is **best-effort** corroboration and requires a real signed-in test account OR the
  `appreview@` bypass.
- **Implementor happy-path test = T-1/T-7 (structural).** **Tester adversarial angle (distinct):** on
  a signed-in New-Arch build, drive **randomized rapid tab spam** (Home↔Account plus Ari/Hub) while
  React Query is actively resolving the account hooks (max concurrent commits), capturing
  `DiagnosticReports`; additionally spam worklet-animated surfaces (`Toast`, sheet open/close) to
  probe residual races; and confirm T-6 (revert Fix A → guard fails). Use a fresh-Apple-shape account
  (relay email / no avatar / zero brands) or the appreview bypass.

---

## 10. Open questions

- **OQ-1 (must-flag, do not silently guess):** the dispatch asked to "disable the tab screen-transition
  animation (react-native-screens/expo-router tab navigator config) and name the exact prop." Forensic
  reading shows `(tabs)/_layout.tsx` uses **`<Slot />`** (SlotNavigator → StackRouter, renders only the
  focused route, **no animation prop, no `<ScreenStack>` transition**) — so **there is no such prop on
  the tap-Account path.** The accurate realization is **Fix A.1 (de-worklet) + Fix A.2 (defer to next
  frame)**; setting the ROOT `<Stack>` to `animation:"none"` is explicitly NOT done (broad off-path UX
  regression). Confirm this is acceptable, or state the intended alternative.
- **OQ-2 (observability, D-3):** did build 28's EAS build carry `EXPO_PUBLIC_SENTRY_DSN`? If crash
  reporting was OFF, future recurrences won't be captured — worth verifying before resubmit, though it
  does not block this fix.
- **OQ-3 (Android):** Android has not been shown to crash; confirm the tester re-smokes Fix A/B on a
  New-Arch Android build (shared source changed).

---

## 11. Downstream routing

- **NEXT = `mingla-implementor`** (this worktree): execute §8 in order; run the Fix-B gate; apply the
  fallback rule; write the implementation report noting which dep set shipped (A-only or A+B).
- **THEN = `mingla-tester`:** run T-1..T-8 + the adversarial soak (§9); needs a signed-in
  account/appreview bypass; verify fails-on-revert (T-6).
- **THEN = `mingla-orchestrator` CLOSE:** flip `I-PROPOSED-1320-NO-WORKLET-ON-TAB-COMMIT-PATH` ACTIVE
  (always) and `I-PROPOSED-1320-REANIMATED-WORKLETS-VERSION-FLOOR` ACTIVE (only if Fix B shipped);
  land the pinning test(s) in the same PR.
- **Working tree:** `~/Desktop/mingla-orchs/1320-[biz-account-apple-crash]/` on branch
  `1320-biz-account-apple-crash`.

---

## Scoped allowlist + DO-NOT-TOUCH

**Allowlist (implementor may modify ONLY these):**
- `mingla-business/src/components/ui/BottomNav.tsx` (Fix A.1 + A.2)
- `mingla-business/src/hooks/useReducedMotionNative.ts` (NEW — small reduce-motion helper)
- `mingla-business/app/(tabs)/_layout.tsx` (Fix A.2 finding-comment; optional defer if placed here)
- `mingla-business/package.json` (Fix B — conditional; reverted on gate failure)
- `mingla-business/src/components/ui/__tests__/BottomNav.reanimated-free.test.ts` (NEW, append-only)
- (conditional) a `package.json` version-floor test file (NEW, append-only) — only if Fix B ships

**DO-NOT-TOUCH (stop-and-amend before any change):**
- expo-blur / `GlassChrome` / `GlassCard` / `glassBlur` stack (RULED OUT).
- `mingla-business/app/(tabs)/account.tsx` render, `src/context/AuthContext.tsx`.
- `mingla-business/app/_layout.tsx` (ErrorBoundaries + root `<Stack>` — do NOT set `animation:"none"`).
- `mingla-business/metro.config.js` reanimated web-stub resolver.
- `ProvenanceChip.tsx` + the other 26 reanimated-consuming files (Fix B may affect them transitively;
  NO source edits — regression-smoke only).
- `mingla-business/app.json` `newArchEnabled` (MUST stay `true`).
- `app-mobile/` (consumer — ORCH-1321, separate scope).

---

## Shipping note (fresh native build — NO OTA)

Build 28's binary carries the defect (F-4); both Fix A and Fix B are **native** changes (Reanimated is
a native module; the de-worklet changes compiled JS but the crash lives in the native binary). **No OTA
can deliver this** — business OTA is frozen (COMMS-0052 RESOLVED/superseded → **COMMS-0063: native
build only**), and native dep changes are un-OTA-able regardless. The fix ships in a **fresh native EAS
build (business iOS + Android)**, resubmitted to App Store Connect. `runtimeVersion.policy` is
`appVersion`; bump the build number (and `version` if desired) and cut the binary.

---

## Sources (external, verified against official docs)

- **react-native-reanimated 4.3.1** — GitHub release `tag/4.3.1` (7 May): changelog entries
  *"cherry-pick(4.3-stable): fix registries race conditions"* and *"Fix animation cancellation race
  condition missing code"*. `peerDependencies`: `react-native: "0.81 - 0.85"`,
  `react-native-worklets: "0.8.x"` (from `unpkg.com/react-native-reanimated@4.3.1/package.json` +
  `compatibility.json` `4.3.x`).
- **react-native-worklets 0.8.3** — `unpkg.com/react-native-worklets@0.8/package.json`:
  `version 0.8.3`, `peerDependencies.react-native: "0.81 - 0.85"`.
- **react-native 0.81.5** — `mingla-business/package.json:143` (our pin).
- **Expo SDK 54 pins** — reanimated `~4.1.1`, worklets `0.5.1` (orchestrator-verified; this bump is
  off-pin → `expo-doctor` warns, expected).
- **Upstream signature corroboration** — software-mansion/react-native-reanimated issues **#9402**
  and **#9293** (New-Arch Fabric mount-time `EXC_BAD_ACCESS` during a screen transition), cited in the
  investigation.
