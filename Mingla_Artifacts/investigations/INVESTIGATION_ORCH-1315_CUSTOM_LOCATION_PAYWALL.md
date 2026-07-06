# INVESTIGATION — ORCH-1315 [preferences-custom-location-paywall-not-firing]

- **Phase:** INVESTIGATE (runtime-attempted)
- **Surfaces in scope:** iOS-consumer + Android-consumer (`app-mobile/` shared JS)
- **Out of scope:** business apps, buyer-web, admin-web; the SEPARATE curated-toggle bug = ORCH-1314 (twin symptom — see Discoveries, do NOT touch its work).
- **Confidence:** root cause **PROBABLE** (strong 5-layer source proof + genuine on-device build/drive attempt blocked by named, orthogonal environment issues; the exact gated tap was not reached on-device this pass).
- **Worktree:** `~/Desktop/mingla-orchs/orch-1315-[preferences-custom-location-paywall-not-firing]/` on branch `orch-1315-preferences-custom-location-paywall-not-firing`.

---

## Symptom (expected vs actual)

Seth (verbatim): "the using your current location toggle is gated when a user wants to type in a custom location and the paywall does not come when a user taps it."

- **Expected:** a free-tier user taps the "Use my current location" GPS `Switch` to turn it OFF (to type a custom starting location). Because typing a custom starting point is a Mingla+ feature (`custom_starting_point`), the tap should present the `CustomPaywallScreen`.
- **Actual:** no paywall appears. The tap is a no-op from the user's perspective.

---

## Investigation manifest (every file read, in trace order)

| # | File | Why |
|---|------|-----|
| 1 | `app-mobile/src/components/PreferencesSheet/PreferencesSectionsAdvanced.tsx` | The `LocationInputSection` — the GPS `Switch`, lock icon, locked hint, custom input. |
| 2 | `app-mobile/src/components/PreferencesSheet.tsx` | Parent: state, `isEditable`, force-GPS effect, hydration, `onLockedTap` wiring, paywall mount, render paths. |
| 3 | `app-mobile/src/hooks/useFeatureGate.ts` | How `canAccess('custom_starting_point')` resolves. |
| 4 | `app-mobile/src/constants/tierLimits.ts` | Free-tier `customStartingPoint` value. |
| 5 | `app-mobile/src/hooks/useSubscription.ts` | `useEffectiveTier` — the real tier signal (`get_effective_tier()` RPC). |
| 6 | `app-mobile/src/components/CustomPaywallScreen.tsx` | The paywall — an RN `<Modal presentationStyle="pageSheet">`. |
| 7 | `app-mobile/src/components/ui/BaseBottomSheet.tsx` | `wrapInRNModal` → the sheet is itself an RN `<Modal>`. |
| 8 | Call sites: `app/index.tsx`, `MessageInterface.tsx`, `connections/CollabDeckSheet.tsx` | Confirm the sheet always mounts via the bottom-sheet (RN-Modal) path with `visible`. |
| 9 | `SwipeableCards.tsx`, `DiscoverScreen.tsx`, `profile/BillingSheet.tsx`, `ConnectionsPage.tsx` | Blast radius: other paywall mount contexts (tab vs in-sheet). |

---

## Q-scorecard

- **Q1 — Is the `onLockedTap` handler even wired for the GPS switch?**
  Verdict: YES. `PreferencesSheet.tsx:1200-1205` passes `isLocked={!canAccess('custom_starting_point')}` and an `onLockedTap` that runs `setPaywallFeature('custom_starting_point'); setShowPaywall(true)`. The switch (`PreferencesSectionsAdvanced.tsx:177-189`) calls `onLockedTap()` when `isLocked && !val`. (source-proven)

- **Q2 — In Seth's flow, is `isEditable` true (so `onLockedTap` does not early-return)?**
  Verdict: YES for the reported flow. `isEditable = !viewParticipantId` (`:204`). The solo/self path (`app/index.tsx:2661` → `<PreferencesSheet visible={true}>` with no `viewParticipantId`) → `isEditable=true`. **H1 REFUTED.** (source-proven)

- **Q3 — Is the switch value `true` at tap time (so the tap sends `val=false` and takes the locked branch)?**
  Verdict: YES at steady state. `useGpsLocation` defaults `true` (`:279`); the force-GPS effect (`:293-299`) sets it back to `true` whenever `!canAccess('custom_starting_point') && !useGpsLocation`. So a locked free user sees the switch ON; tapping sends `val=false` → `isLocked && !false` → `onLockedTap()`. **H4 REFUTED as primary** (a narrow hydration-timing window exists but self-corrects; see F-4). (source-proven)

- **Q4 — Is the natural tap target actually interactive?**
  Verdict: PARTIALLY. The switch thumb fires. The row/label/lock-icon (`:165-176`) are NOT wrapped in a touchable → tapping them is a dead tap. There is ALSO a fully-tappable "pro_feature" locked hint (`:237-246`, `<TouchableOpacity onPress={onLockedTap}>`) that the dispatch's source-read missed. **H2 = real secondary UX gap, not the root cause of "tapping the toggle does nothing."** (source-proven)

- **Q5 — When `setShowPaywall(true)` runs, does `CustomPaywallScreen` actually present?**
  Verdict: PROBABLY NOT (this is the break). The sheet renders through `BaseBottomSheet` with `wrapInRNModal` — an RN `<Modal>` that is already presented while the sheet is open. `CustomPaywallScreen` is a SECOND RN `<Modal presentationStyle="pageSheet">` rendered as a sibling (`PreferencesSheet.tsx:1526`). On iOS, presenting a second RN Modal over an already-presented one is unreliable and commonly no-ops. **H3 = PROBABLE ROOT CAUSE.** (source-strong; on-device confirmation blocked — see Repro)

- **Q6 — Does `canAccess('custom_starting_point')` actually return `false` for Seth's test account?**
  Verdict: UNCONFIRMED at runtime. `useFeatureGate` reads `useEffectiveTier(user.id)` → server `get_effective_tier()` RPC (authoritative, incl. admin overrides), falling back to client tier. Free tier ⇒ `customStartingPoint:false` ⇒ `isLocked=true` (`tierLimits.ts:17-24`). If Seth's account is actually Mingla+, `isLocked=false` and tapping the switch CORRECTLY reveals the custom input with no paywall — which would look like "no paywall" but is expected. **Must be confirmed by the tester's free-tier live-fire.** (see Open question)

---

## Findings (six-field evidence)

### F-1 — CONFIRMED (mechanism) / PROBABLE (as the user-facing root cause): paywall is a second RN Modal presented over the sheet's own `wrapInRNModal` RN Modal

1. **Symptom:** tapping the GPS switch OFF presents no paywall.
2. **Layer:** code (React render tree / iOS UIKit modal presentation).
3. **Probe:** read `PreferencesSheet.tsx` render paths + `BaseBottomSheet.tsx` `wrapInRNModal` + `CustomPaywallScreen.tsx` Modal; grepped all four mount sites for the `visible` prop.
4. **Evidence (verbatim):**
   - `PreferencesSheet.tsx:1487` `if (typeof visible !== "undefined") {` → the ACTIVE path for every mount site (all pass `visible`).
   - `PreferencesSheet.tsx:1490-1496` `<BaseBottomSheet visible={!!visible} ... wrapInRNModal ...>`.
   - `BaseBottomSheet.tsx:14-15` (doc) "wrapping the sheet in an RN `<Modal transparent animationType="none" statusBarTranslucent>`"; `:787 if (wrapInRNModal) { ... :817 <RNModal ...> }` (`Modal as RNModal` from `react-native`, `:37`).
   - `PreferencesSheet.tsx:1526` `{paywall}` rendered as a sibling of `<BaseBottomSheet>`; `paywall` = `CustomPaywallScreen` (`:1429-1436`).
   - `CustomPaywallScreen.tsx:272-275` `<Modal visible={isVisible} animationType="slide" presentationStyle="pageSheet" ...>`.
5. **Mechanism:** while the preferences sheet is open, its `wrapInRNModal` RN `<Modal>` is presented over the react root VC. `onLockedTap` sets `showPaywall=true`, so `CustomPaywallScreen`'s `<Modal>` is asked to present — but on iOS a second RN Modal cannot reliably present while the first is still presented (UIKit "presentation in progress"), so it silently fails to appear → no paywall.
6. **Severity:** CONFIRMED ROOT CAUSE (mechanism, source-level) / PROBABLE (as the on-device user symptom — runtime confirmation blocked).

### F-2 — SUPPORTING: the codebase encodes the FALSE assumption that made this latent (the trap)

1. **Symptom:** reviewers (incl. the ORCH-1315 dispatch's prior source-read) conclude the wiring is correct and clear the toggle.
2. **Layer:** code (comments encoding an incorrect invariant).
3. **Probe:** grep `CustomPaywallScreen` render sites + surrounding comments.
4. **Evidence (verbatim):** `BillingSheet.tsx:89-90` "The nested CustomPaywallScreen is its own RN `<Modal>` (excluded surface) and floats independently"; `:259` "its own RN `<Modal>`, floats independently"; `PreferencesSheet.tsx:1522-1525` "Paywall is its own RN Modal — render it OUTSIDE the sheet's scroll body ... It floats independently."
5. **Mechanism:** the belief "an RN Modal floats independently regardless of JSX site" is false on iOS when the parent surface is itself a `wrapInRNModal` RN Modal. This assumption is why the bug is latent and why source-only review clears it.
6. **Severity:** SECONDARY ROOT CAUSE (design assumption).

### F-3 — SECONDARY (UX): dead-tap on the row / label / lock icon (partial H2)

1. **Symptom:** tapping "Use my current location" text or the lock glyph does nothing.
2. **Layer:** code (component).
3. **Probe:** read `LocationInputSection` JSX.
4. **Evidence (verbatim):** `PreferencesSectionsAdvanced.tsx:165` `<View style={[styles.gpsSwitchRow, ...]}>` (plain View); `:171` label `<Text>`; `:174-176` `<Icon name="lock-closed" ...>` — none wrapped in a touchable. Only the `<Switch>` (`:177`) and the separate locked hint (`:237-246`, `<TouchableOpacity onPress={onLockedTap}>`) are interactive.
5. **Mechanism:** the visually-natural targets (label, lock) are non-interactive; only the small switch thumb and the below-row hint fire the paywall — a Constitution-#1 dead-tap that compounds the perceived failure even where the switch path would otherwise work.
6. **Severity:** SECONDARY ROOT CAUSE (UX affordance).

### F-4 — SUSPECTED (minor): hydration-timing window on `useGpsLocation`

1. **Symptom:** a brief render where `useGpsLocation=false` for a locked user.
2. **Layer:** code (effect ordering).
3. **Probe:** read hydration (`:438-453`, `:516-517`) + force-GPS effect (`:293-299`).
4. **Evidence:** solo hydration `const gpsFlag = use_gps_location ?? true; setUseGpsLocation(gpsFlag)` (`:516-517`) can set `false` if a saved pref carries `use_gps_location:false` (e.g., set while previously pro); the force-GPS effect then flips it back to `true`.
5. **Mechanism:** transient only; the input stays hidden (`{!useGpsLocation && !isLocked}`) because `isLocked` is true, and the effect corrects `useGpsLocation` to true. Not the primary cause; noted so the fix does not regress it.
6. **Severity:** SUSPECTED CONTRIBUTOR (edge).

### F-5 — RULED OUT: `isEditable` early-return (H1)

`onLockedTap` (`:1201-1205`) early-returns only when `!isEditable`. `isEditable=true` for self-prefs (no `viewParticipantId`). Seth's "type a custom location" flow is always self-prefs. Ruled out as the cause of the reported symptom.

---

## Five-Truth-Layer reconciliation

| Layer | Finding |
|-------|---------|
| **Docs** | `custom_starting_point` is Mingla+-only (`FEATURE_TIER_MAP`, `tierLimits`). A tap on the gated affordance is documented to open the paywall. |
| **Schema** | `get_effective_tier()` RPC drives the tier; free ⇒ `customStartingPoint:false`. No schema defect. |
| **Code** | Handler chain is correct up to `setShowPaywall(true)`. The break is at the RN-Modal-over-RN-Modal presentation layer (F-1), invisible in a source skim. Comments assert a false "floats independently" invariant (F-2). Row/label/lock are dead taps (F-3). |
| **Runtime** | **Contradiction with Code layer expectation:** code "should" present the paywall; on iOS it does not. This gap IS the bug. Full on-device confirmation blocked this pass (see Repro). |
| **Data** | Tier for Seth's test account unconfirmed at runtime (Q6) — the one data point that decides free-vs-pro interpretation. |

The Code↔Runtime gap (paywall state flips true but no modal appears) is the bug, exactly the kind that source-only review cannot see — hence the dispatch's "capped at suspected" rule.

---

## Repro evidence (on-device attempt — honest status)

**Attempted a full native runtime repro; blocked by named, orthogonal environment issues. The exact gated tap was NOT reached on-device this pass.**

What was actually done (real, not theorized):
1. Instrumented `[ORCH-1315-DIAG]`: on-screen banner (live `isEditable / canAccess / forceLocked / useGpsLocation / showPaywall / switchFired / lockedTap / setPaywallTrue`), `onValueChange`/`onLockedTap`/`setShowPaywall` console logs, a `DIAG_FORCE_LOCKED` override, and a magenta "PAYWALL MODAL PRESENTED" banner inside the paywall Modal.
2. Resolved the worktree symlink-`node_modules` Metro-resolution blocker via a real `npm ci`.
3. Full native dev build from the worktree per the iOS rebuild runbook: `expo prebuild` → `pod install` (keyboard-controller 1.18.5 present in Podfile.lock) → `xcodebuild` (BUILD SUCCEEDED) → manual embed-frameworks → codesign → install → launch on booted **iPhone 17 Pro Max, iOS 26.4**; connected to worktree Metro on :8091 (verified in the dev menu: SDK 54, Hermes RN 0.81.5, origin 127.0.0.1:8091).
4. Drove with Maestro.

**Blocker (named, characterized):** the freshly-prebuilt worktree dev build does not link/register the New-Architecture TurboModule `react-native-keyboard-controller` — `nm Mingla | grep -i keyboardcontroller` = **0 symbols** in the app binary although the pod compiled (its modulemap is in `OTHER_CFLAGS`; New Arch flags `-DRCT_NEW_ARCH_ENABLED -DRN_FABRIC_ENABLED` are set). This is a CLI-`xcodebuild` New-Arch codegen/link gap. The module is imported app-wide (`CountryPickerModal.tsx → PhoneInput → VenueReserveSheet → ExpandedCardModal`, plus the app-root `KeyboardRoot`/`KeyboardToolbarRoot`), so its import-time link-check throws a redbox at app root; stubbing is whack-a-mole. Compounding: the bracketed worktree path breaks watchman re-transform; the dev-client connect deep-link lands on expo-router's "Unmatched Route"; the sim's authed Mingla session / free-tier login could not be established; a persistent simulator iCloud "Apple Account Verification" dialog. Reaching the authed Home → preferences sheet → gated tap was therefore not possible this pass.

**What the attempt DID establish:** the worktree bundle builds and runs on a real iOS 26.4 device; expo-router and the app tree render (redbox is a non-fatal dev overlay); the DIAG-instrumented bundle was the one served (the redbox source panel rendered the injected `[ORCH-1315-DIAG]` comment lines). It did NOT reach a state where `CustomPaywallScreen` mounts, so the on-device paywall-presentation observation was not captured.

All temporary instrumentation and the two app-root keyboard test-scaffold stubs were REVERTED; the committed worktree diff is the two artifact files only (`DIAG_FORCE_LOCKED` and stubs do not land).

**Hypothesis verdicts:** H1 REFUTED · H2 PARTIAL (real secondary dead-tap, not the root cause) · H3 PROBABLE ROOT CAUSE · H4 REFUTED as primary (minor timing edge in F-4).

---

## Blast radius / cross-surface map

- **In scope (this ORCH):** consumer iOS + Android, `custom_starting_point` paywall from `PreferencesSheet`.
- **Twin (ORCH-1314, do NOT touch):** the `curated_cards` paywall is triggered from the SAME sheet via the identical mechanism (`PreferencesSheet.tsx:1280-1283` → `setShowPaywall(true)`); it will fail for the same reason. A correct F-1 fix very likely resolves 1314 too — coordinate at REVIEW, do not merge scopes.
- **Systemic (Discoveries):** every paywall triggered from inside a `wrapInRNModal` sheet is at risk: `BillingSheet.tsx:261` (upgrade/downgrade paywall inside the billing sheet), `ConnectionsPage.tsx` (friends sheet), `DiscoverScreen.tsx:2345` (paywall sibling of the discover `wrapInRNModal` sheet). The app-root paywall (`app/index.tsx:2406`) works because it is NOT under a sheet Modal — the reference "working" mount.
- **Android:** RN Modals are Dialog-window-based on Android; the modal-over-modal failure mode differs and may not reproduce identically — the tester must live-fire Android separately.

---

## Invariant impact

- No existing invariant is violated by the current code per se. Propose a NEW invariant (DRAFT, for the SPEC): a paywall/secondary RN-Modal surface must not be presented from within a `wrapInRNModal` sheet without an explicit present-after-dismiss or same-window-overlay strategy. See SPEC §6 `I-PROPOSED-1315-*`.

## Discoveries for Orchestrator

1. **ORCH-1314 shares this exact root cause** (curated toggle, same sheet). Flag for coordinated fix at REVIEW.
2. **Systemic modal-over-modal risk** across `BillingSheet`, `ConnectionsPage`, `DiscoverScreen` — candidate follow-up ORCH (do not widen 1315).
3. **Dev-tooling gap:** CLI `xcodebuild` New-Arch dev builds from a worktree do not link `react-native-keyboard-controller` (0 symbols); plus bracketed worktree paths break watchman. Both impede on-device forensics — candidate dev-tooling ORCH / runbook update.
4. **The dispatch's source-facts (line numbers ~1462/1526 "two paywall mounts", lock icon at 174-176) were partly stale** — the live tree has ONE `CustomPaywallScreen` mount and an additional tappable locked hint at `PreferencesSectionsAdvanced.tsx:237-246` the prior read missed.

## Confidence

**PROBABLE.** Multi-layer source proof is strong and the causal chain is complete up to the modal-presentation layer; the final link (iOS refusing the second RN Modal) is source-strong + corroborated (working root mount vs failing in-sheet mounts; the codebase's own false "floats independently" comments; the ORCH-1314 twin) but the exact on-device observation was blocked by named, orthogonal build/auth issues. Not raised to "confirmed" because the gated tap was not exercised on-device this pass.

## Recommended next phase + scope

SPEC (in this same skill) → then IMPLEMENT. Scope: make the `custom_starting_point` paywall reachable/presentable from the preferences sheet (do NOT change the gate policy). Keep `custom_starting_point` Mingla+-only. Address F-1 (presentation) and F-3 (dead-tap affordance); flag the row-pressable UX as a DESIGN decision. The tester must run a real free-tier live-fire to confirm F-1 and settle Q6 (account tier).
