# INVESTIGATE — ORCH-1165 [Business app keyboard "Done" accessory bar] (BUSINESS LEG)

**Phase:** INVESTIGATE (mingla-forensics)
**Date:** 2026-06-20
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1165-[business-keyboard-done-bar]/` on branch `ORCH-1165-business-keyboard-done-bar` (rebased clean on `origin/main`).
**Scope (HARD):** `mingla-business/` ONLY (iOS + Android). Consumer app (`app-mobile/`), buyer-web, admin-web all OUT OF SCOPE.
**Confidence:** **probable** (mechanism runtime-proven on Android device + library source; iOS sim drive blocked by a stale-bundle code-signing reject — named below; one architectural conclusion (Modal hosts) is source-reasoned and capped at *suspected* pending TEST runtime confirmation).

---

## 0. Comms ledger acks

No `BLOCK` entries addressed to forensics / ORCH-1165 / ALL. Relevant `WARN`s factored in:
- **COMMS-0030** (`mingla-business iOS build BROKEN team-wide since ~2026-05-30`, Google-pod CocoaPods modular-headers, tracked ORCH-1129): explains why a fresh iOS dev build is not a cheap baseline path. Factored into the iOS-baseline blocker below.
- **COMMS-0027** (`concurrent OTA from symlinked worktrees poisons Metro/Haste cache`): noted — no OTA performed this turn; baseline uses the already-installed device build + an existing sim bundle, no Metro publish.
- **COMMS-0040 / COMMS-0041** (RSVP / experience public-page standardization into `packages/`): the files those initiatives touch (`RsvpPublicBody.tsx`, `ConsumerEventDetailScreen.tsx`, public experience pages) are PUBLIC offering pages, NOT business-app authoring input surfaces. ORCH-1165 touches keyboard infra + authoring/composer surfaces only; **no overlap with the standardization file set**. `RsvpPublicBody.tsx` does contain intake `TextInput`s (Category D, parent-scrolled) but ORCH-1165 does not edit it. No coordination conflict.

---

## 1. Symptom / goal (this is a feature, not a bug)

Seth wants a slim bar pinned directly on top of the on-screen keyboard, on **every focused text field** in the business app, with a single **Done** button (right side) that dismisses the keyboard. Locked decisions: both platforms; **Done-only (no Prev/Next chevrons)**; **zero regressions**; and CRITICALLY — because the bar adds ~42pt of height, **no input field may end up hidden behind the now-taller keyboard.**

Expected end state: focus any business-app `TextInput` → a 42pt dark bar with a single right-aligned brand-orange **Done** appears flush on the keyboard top → tapping Done dismisses the keyboard → no field is ever occluded by the bar.

---

## 2. Investigation manifest (every file read, in trace order)

| # | File | Layer | Why |
|---|------|-------|-----|
| 1 | `COMMS_LEDGER.md` | docs | mandatory entry read |
| 2 | `mingla-business/src/wrappers/KeyboardRoot.native.tsx` | code | the library mount point |
| 3 | `mingla-business/app/_layout.tsx` (660–702) | code | where `<KeyboardRoot>` wraps the shell |
| 4 | `.github/scripts/strict-grep/orch-0892-no-bespoke-keyboard-plumbing.mjs` | CI | the gate the SPEC must keep green |
| 5 | `mingla-business/src/wrappers/SmartScrollView.native.tsx` | code | the avoidance primitive; `bottomOffset` math |
| 6 | `mingla-business/src/wrappers/useKeyboardIsVisible.native.ts` | code | keyboard-visible hook |
| 7 | `node_modules/react-native-keyboard-controller/src/components/KeyboardToolbar/index.tsx` | lib | exact Done-only config + how it mounts |
| 8 | `…/KeyboardToolbar/constants.ts` | lib | toolbar height (42) + iOS-26 floating-keyboard flag |
| 9 | `…/KeyboardToolbar/colors.ts` | lib | light/dark theme defaults |
| 10 | `…/KeyboardAwareScrollView/index.tsx` (1–240) | lib | the scroll-avoidance math — does it auto-account toolbar? |
| 11 | `…/KeyboardStickyView/index.tsx` | lib | how the toolbar positions on keyboard top |
| 12 | `mingla-business/src/components/ui/Sheet.tsx` → `SheetMobile.tsx` | code | sheets use native `Modal` (separate host) |
| 13 | `mingla-business/src/components/ui/Modal.tsx` | code | Modal primitive also native `Modal` |
| 14 | 52 TextInput-bearing files (Explore fan-out + spot re-verification) | code | the full input-surface inventory + risk map |
| 15 | `mingla-business/src/components/event|trip|rsvp/*CreatorWizard.tsx` | code | verify wizard scroll container (SmartScrollView) |
| 16 | `mingla-business/src/components/groupChat/GroupChatPanel.tsx`, `support/SupportThread.native.tsx`, `ari/InputBar.tsx` | code | pinned-composer keyboard pattern |
| 17 | `mingla-business/src/components/waitlist/JoinWaitlistSheet.tsx`, `auth/BusinessWelcomeScreen.tsx` | code | manual `Keyboard.addListener` + paddingBottom sites |
| 18 | `Mingla_Artifacts/INVARIANT_REGISTRY.md` (4270–4310) | docs | invariant IDs + safelist |
| 19 | `src/constants/designSystem.ts` | code | brand accent `#eb7825` for Done theming |

---

## 3. Q-scorecard

### Q1. What is the exact Done-only configuration of `KeyboardToolbar`?
**Verdict (proven, lib source):** `<KeyboardToolbar showArrows={false} />`. The `showArrows` prop (default `true`) gates the Prev/Next `<View style={styles.arrows}>` block (index.tsx L98, L204–235). With `showArrows={false}` the left arrows render nothing and only the right-aligned **Done** button remains (L240–254, gated solely on `doneText` which defaults to `"Done"`). The doc-comment for the prop literally says: *"Can be useful to set it to `false` if you have only one input and want to show only `Done` button."* (L48–52). Done press calls `KeyboardController.dismiss()` (L185–194). **No fork, no custom render needed.**

### Q2. Where must a single app-wide toolbar mount to cover all input surfaces — and which surfaces will NOT inherit it?
**Verdict (probable; the Modal-host exclusion is *suspected* pending TEST):** `KeyboardToolbar` renders its bar through `KeyboardStickyView` — an `Animated.View` translated by the live keyboard height so its bottom edge sits on the keyboard's top edge (KeyboardStickyView/index.tsx L54–74). It paints in the React tree **where it is mounted**, within that native window. Therefore:
- A **single mount at the app root** (inside `KeyboardRoot` / `RootLayoutInner`, under `KeyboardProvider`) covers **every non-modal surface**: all 5 authoring wizards, full-screen forms, settings screens, and the bottom-pinned composers (Ari / chat / support) — they all live in the root native window.
- It will **NOT** appear over any surface rendered inside a React Native **native `Modal`**. Both Mingla overlay primitives — `Sheet` (`SheetMobile.tsx` L291 `<Modal …>`) and `Modal` (`Modal.tsx` L28 `Modal as RNModal`) — render at the OS-level root **window**, a *separate* native host z-ordered above the app root view. A root-mounted `KeyboardStickyView` cannot paint over that window. So **every Sheet-hosted and Modal-hosted input is a SECOND host** that needs its own toolbar mount.
- **Surfaces needing a separate mount (the native-Modal hosts):** the `Sheet` primitive panel (covers ~13 Category-B sheet inputs) and the `Modal` primitive panel (covers `CancelOrderDialog` + any future Modal input). Mounting one `KeyboardToolbar` inside each primitive's panel JSX covers all their consumers at once.

### Q3. Does the library auto-account for the 42pt toolbar height in its avoidance math, or must offsets be adjusted?
**Verdict (proven, lib source + Android runtime):** It does **NOT** auto-account. `KeyboardAwareScrollView.maybeScroll` (index.tsx L157–211) computes visibility from the **raw OS keyboard frame only**: `visibleRect = height - keyboardHeight.value` (L170), and scrolls so the focused field clears exactly `bottomOffset` above the keyboard top (L175–177). The toolbar is a *sibling* `KeyboardStickyView` overlay (Q2) occupying the 42pt directly above the keyboard — it is invisible to this math. With the current `SmartScrollView` `DEFAULT_BOTTOM_OFFSET = 12` (SmartScrollView.native.tsx L25), the field is parked only 12pt above the keyboard, so a 42pt toolbar would **cover the bottom ~30pt of the focused field.** Fix = **raise the clearance by the toolbar height (42pt) → `bottomOffset ≈ 54`.** One change in `SmartScrollView.native.tsx` propagates to every Category-A/wizard consumer automatically. The same +42 logic must be applied to every hand-tuned `paddingBottom`/`keyboardVerticalOffset` site (Q4 risk list).

### Q4. What is the full inventory of business input surfaces, and which are at risk of a hidden field once the keyboard is 42pt taller?
**Verdict (proven, exhaustive read of 52 files + spot re-verification):** 52 files render a text input. Categorized by keyboard-avoidance mechanism — see §5 (F-4). The auto-covered majority flow through `SmartScrollView` (the `bottomOffset` bump fixes them). The genuinely **at-risk** set (NOT fixed by the SmartScrollView bump) is **6 surfaces/patterns**: 2 manual-`Keyboard.addListener`+`paddingBottom` sites, 2 inline-allowlisted bare-`ScrollView` wizards, the chat/support `KeyboardAvoidingView` composers, and the safelisted `ComposerV2Editor` fixed-height shrink. (The Explore fan-out's initial "HIGH-risk step components" were FALSE — those steps are children of SmartScrollView wizards and don't own scrolling; see F-4 correction.)

### Q5. Does adding `KeyboardToolbar` violate `I-PROPOSED-KEYBOARD-LIBRARY-ONLY` / the strict-grep gate?
**Verdict (proven, gate run):** No. The gate forbids only 4 patterns: `Keyboard.addListener('keyboard(Will|Did)…')` for layout, `KeyboardAvoidingView` imported from `react-native`, `automaticallyAdjustKeyboardInsets={true}`, and bare `ScrollView` from `react-native` in a TextInput file. `KeyboardToolbar` is a *new component import* from the same library — not a forbidden pattern. The gate currently **PASSES** (`838 files scanned, 7 safelisted, 0 violations`) on the rebased branch. Raising `DEFAULT_BOTTOM_OFFSET` is a numeric change to a safelisted file — no new violation.

### Q6. What baseline runtime evidence proves the regression mechanism today?
**Verdict (proven on Android; iOS blocked):** Captured below (§6). The Android event-wizard baseline shows the focused field parked ~12pt above the keyboard — exactly the gap a 42pt toolbar would consume. iOS sim drive was blocked by a stale-bundle code-signing reject (named blocker, §6).

---

## 4. Architecture map — business-app keyboard handling today

```
app/_layout.tsx
  GestureHandlerRootView > SafeAreaProvider > ErrorBoundary
    > QueryClientProvider > AuthProvider
      > <KeyboardRoot>                         ← KeyboardProvider mounts here (L693)
          > <RootLayoutInner/>                 ← all routes/screens render under here (root native window)
```

Primitives in use (all from `react-native-keyboard-controller`, per I-PROPOSED-KEYBOARD-LIBRARY-ONLY):
- **`SmartScrollView`** (`wrappers/SmartScrollView.native.tsx`) = re-export of `KeyboardAwareScrollView`, `bottomOffset` default **12**. The canonical form scroll container. Used by EventCreatorWizard, TripCreatorWizard, RsvpCreatorWizard, VenueCreatorWizard, CreatorStep2When, BrandEditView, CoverPicker, AriSettings, EditPublishedTripScreen, and all Category-B sheet bodies.
- **`useKeyboardIsVisible`** (`wrappers/useKeyboardIsVisible.native.ts`) = `useKeyboardState().isVisible`.
- **`KeyboardAvoidingView` (from the library)** = the chat/support composers (`GroupChatPanel`, `SupportThread.native`), `behavior="padding"` `keyboardVerticalOffset={0}`.
- **`Sheet` / `SheetMobile`** = native `Modal`; dropped its own keyboard logic in ORCH-0892-B (consumers use SmartScrollView inside).
- **Safelisted bespoke sites** (gate carve-outs): `Sheet.tsx`, `ComposerV2Editor.tsx`, `richEditor.*`, `KeyboardRoot.native.tsx`.
- **Inline-allowlisted bespoke sites**: `ExperienceCreatorWizard.tsx` (bare ScrollView), `BrandCreationFlow.tsx` (bare ScrollView), `JoinWaitlistSheet.tsx` (`Keyboard.addListener` + paddingBottom), `BusinessWelcomeScreen.tsx` (`Keyboard.addListener` + keyboardPad), `Input.tsx` (picker dropdown ScrollView).

**How `KeyboardToolbar` composes:** it is itself a `KeyboardStickyView` + `View(height:42, position:absolute, bottom:0)`. Mounted as a sibling inside `KeyboardProvider`, it floats on the keyboard top independent of any ScrollView. It does **not** interfere with `KeyboardAwareScrollView` scrolling — but its 42pt occlusion is invisible to that scroll math (Q3), which is the entire regression surface.

---

## 5. Findings (F-1 … F-7, six-field evidence)

### F-1 — Done-only config is a one-prop flag; no fork needed. `CONFIRMED ROOT CAUSE` (of the build approach)
1. **Symptom:** Stock `KeyboardToolbar` renders Prev/Next-left + Done-right; Seth wants Done-only.
2. **Layer:** code (library).
3. **Probe:** read `node_modules/react-native-keyboard-controller/src/components/KeyboardToolbar/index.tsx`.
4. **Evidence:** L52 `showArrows?: boolean` default `true` (L98); L204 `{showArrows && (<View style={styles.arrows}>…Prev…Next…</View>)}`; L240 `{doneText && (<ButtonContainer …Done… onPress={onPressDone}>)}`; L185–194 `onPressDone` → `KeyboardController.dismiss()`. Constant `KEYBOARD_TOOLBAR_HEIGHT = 42` (constants.ts L11).
5. **Mechanism:** `showArrows={false}` short-circuits the arrows block → only the Done button paints; tapping it dismisses the keyboard.
6. **Severity:** `CONFIRMED ROOT CAUSE` (build approach).

### F-2 — Native `Modal` sheets are a SEPARATE host; a root-only toolbar will not cover sheet/modal inputs. `CONFIRMED ROOT CAUSE` (of the multi-mount requirement) — *runtime-confirmation deferred to TEST → confidence suspected on the exclusion, proven on the native-Modal fact*
1. **Symptom:** A single root toolbar would silently fail to appear over inputs inside Sheets/Modals.
2. **Layer:** code.
3. **Probe:** `grep -nE "Modal" SheetMobile.tsx Modal.tsx`.
4. **Evidence:** `SheetMobile.tsx` L40 `Modal,` (from `react-native`), L291 `<Modal visible … transparent statusBarTranslucent>`; `Modal.tsx` L28 `Modal as RNModal`, L14–23 comment: *"Wrapped in React Native's native `Modal` … so the overlay … renders at the OS-level root window regardless of where in the React tree the consumer mounts this Modal."*
5. **Mechanism:** RN native `Modal` presents content in a separate native window z-ordered above the app root. The root-mounted `KeyboardStickyView` overlay lives in the root window → cannot paint over the Modal window → no toolbar on sheet/modal inputs unless a toolbar is also mounted inside the Modal panel.
6. **Severity:** `CONFIRMED ROOT CAUSE` (multi-mount requirement).

### F-3 — The library's avoidance math uses the RAW keyboard frame; the 42pt toolbar is invisible to it → field occlusion regression. `CONFIRMED ROOT CAUSE` (the core regression)
1. **Symptom:** With a 42pt toolbar and unchanged `bottomOffset=12`, the focused field's bottom sits 12pt above the keyboard, i.e. ~30pt *behind* the toolbar.
2. **Layer:** code (library) + runtime.
3. **Probe:** read `KeyboardAwareScrollView/index.tsx` L157–211; Android device drive (F-6).
4. **Evidence:** L170 `const visibleRect = height - keyboardHeight.value;` L173 `const point = absoluteY + inputHeight;` L175 `if (visibleRect - point <= bottomOffset) { … scroll so field clears bottomOffset above keyboard top }`. No term adds `KEYBOARD_TOOLBAR_HEIGHT`. `SmartScrollView.native.tsx` L25 `const DEFAULT_BOTTOM_OFFSET = 12;`.
5. **Mechanism:** KAS scrolls the field to `bottomOffset` (12) above the *keyboard*; the toolbar occupies the 42pt directly above the keyboard → toolbar overlaps the field. Raising `bottomOffset` to `12 + 42 = 54` restores the visible 12pt gap above the toolbar.
6. **Severity:** `CONFIRMED ROOT CAUSE` (the regression Seth explicitly flagged).

### F-4 — Input-surface inventory (52 files) + corrected risk map. `CONFIRMED` (informational, full coverage)
1. **Symptom:** Need to know which of 52 surfaces are NOT auto-fixed by the `bottomOffset` bump.
2. **Layer:** code.
3. **Probe:** Explore fan-out over `mingla-business/src` for `<TextInput|BottomSheetTextInput`; then direct re-verification of every category-C/manual file (`grep -nE "SmartScrollView|from \"react-native\"|orch-strict-grep-allow"`).
4. **Evidence (counts after correction):**
   - **Category A — SmartScrollView (auto-fixed by the bump):** the 4 big wizards (Event/Trip/Rsvp/Venue Creator) + CreatorStep2When + BrandEditView + CoverPicker + AriSettings + EditPublishedTripScreen + all ~13 Category-B sheet bodies that use SmartScrollView inside. **Auto-covered.**
   - **Category B — Sheet/Modal-hosted (need the SECOND mount per F-2, then auto-fixed by their own SmartScrollView bump):** ~13 sheet inputs (TicketTierEditSheet, DoorSaleNewSheet, RefundSheet, AddCompGuestSheet, IntakeQuestionEditor, InviteBrandMemberSheet, BrandDeleteSheet, BrandStripeCountryPicker, BrandStripeDetachConfirmSheet, InviteScannerSheet, TripDayMediaSheet, ExperienceStopPhotoSheet, MultiDateOverrideSheet) + CancelOrderDialog (Modal).
   - **Category C/D-AT-RISK (NOT auto-fixed — the 6-item risk list):** see F-5.
   - **Step components mis-flagged HIGH by Explore but actually SAFE** (children of SmartScrollView wizards, no own scroll): `CreatorStep1Basics.tsx`, `CreatorStep2When.tsx` (uses SmartScrollView itself), `TripCreatorStep1Basics.tsx`, `TripCreatorStep3Inclusions.tsx`, `VenueStep6Description.tsx` (`VenueCreatorWizard` uses SmartScrollView). **CORRECTION: these are auto-covered.**
5. **Mechanism:** Coverage is governed by the *owning scroll container*, not the leaf input file. Most inputs live under a SmartScrollView ancestor.
6. **Severity:** `CONFIRMED` (informational).

### F-5 — The 6 at-risk surfaces the `bottomOffset` bump does NOT fix. `CONFIRMED ROOT CAUSE` (per-surface regression)
1. **Symptom:** These surfaces compute their own keyboard clearance from the RAW keyboard frame and would let the toolbar cover the bottom field/composer.
2. **Layer:** code.
3. **Probe:** direct reads + `grep -nE "Keyboard.addListener|paddingBottom|keyboardVerticalOffset|orch-strict-grep-allow"`.
4. **Evidence:**
   - **(a) `JoinWaitlistSheet.tsx`** L89 `// orch-strict-grep-allow … Keyboard.addListener + dynamic paddingBottom`, L147 `style={[styles.body, { paddingBottom: keyboardPadding + spacing.lg }]}` — `keyboardPadding` = raw keyboard height; no toolbar account.
   - **(b) `BusinessWelcomeScreen.tsx`** L106 `const [keyboardPad, setKeyboardPad] = useState(0)`, L274/278 `Keyboard.addListener`, L576 `paddingBottom: Math.max(insets.bottom, vs(24)) + keyboardPad` — sign-in email/OTP inputs at viewport bottom; raw keyboard height.
   - **(c) `ExperienceCreatorWizard.tsx`** L1 inline-allow bare `ScrollView` + `keyboardShouldPersistTaps`; NO KAS auto-scroll → bottom field can already be tight, toolbar worsens it.
   - **(d) `BrandCreationFlow.tsx`** L2 inline-allow bare `ScrollView`; author asserts inputs sit top-of-viewport (lower risk) but unverified at runtime.
   - **(e) `GroupChatPanel.tsx`** L229 `<KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={0}>` with composer at L248–278; **`SupportThread.native.tsx`** L25 same pattern — composer bottom sits flush on keyboard top → toolbar covers the TextInput + Send.
   - **(f) `ComposerV2Editor.tsx`** (safelisted) fixed-height body shrink for pell rich editor; raw keyboard frame.
5. **Mechanism:** each holds a hand-tuned offset equal to the raw keyboard height; the +42pt toolbar lands inside that offset and occludes content.
6. **Severity:** `CONFIRMED ROOT CAUSE` (per-surface).

### F-6 — BASELINE runtime evidence (Android device, proven; iOS sim blocked). `CONFIRMED`
1. **Symptom:** Need BEFORE-state proof of the 12pt gap the toolbar would consume.
2. **Layer:** runtime.
3. **Probe (Android, Samsung SM-A722/A72, `R58R54YV7JT`, Android 14, app `com.sethogieva.minglabusiness` already installed = a pre-toolbar build):**
   ```
   adb shell monkey -p com.sethogieva.minglabusiness 1     # launch
   adb shell input tap …                                   # Ari composer / event wizard
   adb exec-out screencap -p > <evidence>.png
   ```
4. **Evidence (saved under `Mingla_Artifacts/evidence/ORCH-1165/` on the anchor):**
   - `android_03_ari_composer_keyboard_BEFORE.png` — Ari composer ("Ask Ari…") pushed flush to the keyboard top (KeyboardAvoidingView `keyboardVerticalOffset={0}`); composer barely visible above the keyboard suggestion row → confirms F-5(e): a 42pt toolbar lands exactly here.
   - `android_09_event_name_keyboard_BEFORE.png` — Event Creator Wizard Step 1 (SmartScrollView), "Event name" field focused: KAS scrolled it to **~12pt** above the keyboard top, with no clearance to spare → confirms F-3: a 42pt toolbar would cover the bottom ~30pt of this field. (Note: the blue "Done" key visible bottom-right is the **Samsung OS keyboard's** own key, not an app toolbar.)
   - Supporting: `android_01_launch.png`, `android_02_ari_screen.png`, `android_04_create_menu.png`, `android_06..08` navigation, `ios_sim_alive_no_app.png`.
5. **Mechanism:** Android device confirms the exact 12pt clearance that the regression would consume.
6. **Severity:** `CONFIRMED`.

**iOS sim blocker (named, reported):** five prebuilt `minglabusiness.app` bundles exist on local sims; the newest (Jun-9, iPhone 17 Pro Max `2C3312D9`, iOS 26) was selected. `simctl install` rejects it: `Unexpectedly failed to validate code signing (status 1)` — a stale embedded-signature reject from installd's staging cache. Re-codesigning (`codesign --force --deep --sign -`) produced a bundle that is `valid on disk` + `satisfies its Designated Requirement`, yet installd still rejects the staged copy (a known iOS-26-sim quirk with year-old Expo bundles). A fresh `eas build`/local build is the only clean path and would hit the **COMMS-0030 team-wide CocoaPods break** (a large detour outside this INVESTIGATE's value). **iOS baseline therefore deferred to the post-implementation TEST drive** (which the SPEC mandates). This caps overall confidence at **probable**, not proven.

### F-7 — Gate + invariant compatibility. `CONFIRMED` (no violation)
1. **Symptom:** Risk that the toolbar/offset change trips the keyboard strict-grep gate.
2. **Layer:** CI.
3. **Probe:** `node .github/scripts/strict-grep/orch-0892-no-bespoke-keyboard-plumbing.mjs`.
4. **Evidence:** `Scanned 838 files … 7 safelisted … PASS — zero bespoke keyboard-plumbing violations`. The 4 forbidden patterns do not include `KeyboardToolbar`. `INVARIANT_REGISTRY.md` L4270/4298 — both invariants are about *avoidance via the library*; `KeyboardToolbar` IS the library.
5. **Mechanism:** new code stays inside the library; offset bump edits an already-safelisted file.
6. **Severity:** `CONFIRMED` (no violation; SPEC must not introduce any forbidden pattern, and must mount the per-Modal toolbar via the library, not a bespoke listener).

---

## 6. Five-truth-layer reconciliation

| Layer | Finding | Contradiction? |
|-------|---------|----------------|
| **Docs** | I-PROPOSED-KEYBOARD-LIBRARY-ONLY + SMART-SCROLLVIEW-WRAPPER-ONLY mandate library-only avoidance; ORCH-0892 saga says Sheet dropped its own keyboard logic. | none — `KeyboardToolbar` is the library; aligns. |
| **Schema** | n/a (no DB). | n/a |
| **Code** | `bottomOffset=12`; avoidance math uses raw keyboard frame; Sheet/Modal are native `Modal` (separate host); 6 hand-tuned at-risk sites. | The hand-tuned at-risk sites (F-5) **contradict** the "library-only" ideal — they exist as gate-allowlisted carve-outs and are the regression hotspots. Flagged, not resolved. |
| **Runtime** | Android: field parked ~12pt above keyboard; composer flush on keyboard top. | none — confirms code. |
| **Data** | n/a | n/a |

**Key contradiction flagged:** the codebase's "library-only" story has 5 allowlisted exceptions (manual `Keyboard.addListener` + bare ScrollView + KAV composers). Those exceptions are precisely where the toolbar regresses. The SPEC owns deciding per-site whether to (i) bump their offset by 42, or (ii) suppress the toolbar on that surface.

---

## 7. Blast radius / cross-surface map

| Surface | In scope? | Effect |
|---------|-----------|--------|
| Business iOS | **YES** | toolbar + offset bump; iOS-26 floating-keyboard path (`KEYBOARD_HAS_ROUNDED_CORNERS=true`) renders the toolbar as a *floating rounded* bar (constants.ts L13–15) — must TEST on iOS. |
| Business Android | **YES** | toolbar + offset bump; runtime-proven baseline. |
| Business Web preview (adjacent) | NO | `.web` variants of SmartScrollView/useKeyboardIsVisible import from `react-native` only; web has no on-screen keyboard accessory. `KeyboardToolbar` mount must be native-only (`.native` file or `Platform.OS !== 'web'` guard) to avoid web-bundle pollution. |
| Consumer iOS/Android (`app-mobile/`) | **NO** | separate later leg (per dispatch). Do not touch. |
| Buyer/anon Web | NO | out of scope. |
| Admin Web | NO | out of scope. |

**Pattern recurrence:** the 6 at-risk sites are the same set ORCH-0892 left as allowlisted carve-outs — a recurring "bespoke keyboard offset" smell. ORCH-1165 should NOT try to migrate them all (scope creep); it should only neutralize the toolbar-occlusion on each.

---

## 8. Invariant impact (flagged, not pre-decided)

- **I-PROPOSED-KEYBOARD-LIBRARY-ONLY (ACTIVE):** preserved — `KeyboardToolbar` is a library component; no forbidden pattern added. The per-Modal mounts must use the library, not a bespoke listener.
- **I-PROPOSED-SMART-SCROLLVIEW-WRAPPER-ONLY (ACTIVE):** preserved — only the `bottomOffset` default constant changes; no new bare ScrollView.
- **New invariant candidate (the SPEC should pre-stage as DRAFT):** an invariant that the SmartScrollView default `bottomOffset` accounts for the toolbar height (i.e. `bottomOffset ≥ KEYBOARD_TOOLBAR_HEIGHT`) so a future edit can't silently drop the clearance and re-introduce field occlusion. Proposed `I-PROPOSED-KEYBOARD-TOOLBAR-CLEARANCE` (DRAFT) — SPEC owns wording; orchestrator flips ACTIVE on CLOSE.

---

## 9. Discoveries for orchestrator (side issues, NOT in scope)

- **DISC-1165-A:** `BusinessWelcomeScreen` + `JoinWaitlistSheet` still carry bespoke `Keyboard.addListener` keyboard plumbing (allowlisted, awaiting a `useKeyboardHeightJs` wrapper hook per the registry's "ORCH-0892-Bz" note). ORCH-1165 will hand-patch their +42 offset but the deeper migration is a separate keyboard-hygiene ORCH.
- **DISC-1165-B:** `mingla-business` iOS sim bundles cannot be reinstalled (installd code-signing staging reject on iOS-26 sims) AND fresh iOS builds are broken team-wide (COMMS-0030/ORCH-1129). The business app has **no working iOS runtime path on this machine right now** — a launch-readiness risk beyond ORCH-1165.
- **DISC-1165-C:** the Done-only toolbar may be redundant/awkward on the single-line bottom-pinned composers (Ari/chat/support) which already have a Send button and a dismiss affordance. Whether to *suppress* the toolbar there vs. *offset* the composer is an Open Question for the SPEC/Seth.

---

## 10. Confidence & recommended next phase

**Confidence: probable.** Mechanism (F-3) and Done-only config (F-1) are proven from library source AND an Android device baseline. The multi-mount requirement (F-2) is proven at the "native Modal = separate host" level but its visual exclusion is *suspected* until a runtime TEST confirms a root-only toolbar is absent over a sheet. iOS baseline is a named, reported blocker (stale-bundle signing + team-wide build break), deferred to TEST.

**Recommended next phase:** SPEC (this same skill, IA mode — SPEC follows below). Recommended scope: (1) one native-only `KeyboardToolbar showArrows={false}` mount at the app root; (2) one inside the `Sheet` primitive panel and one inside the `Modal` primitive panel; (3) raise `SmartScrollView` `DEFAULT_BOTTOM_OFFSET` 12→54; (4) per-site +42 offset (or toolbar-suppress) for the 6 at-risk surfaces in F-5; (5) brand-orange `theme` on the Done button; (6) DRAFT clearance invariant + fails-on-revert test; (7) full iOS+Android TEST drive over every at-risk surface. NO migration of the allowlisted bespoke sites beyond the offset patch. NO app-mobile, web, or admin changes.
