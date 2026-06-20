# SPEC — ORCH-1165 [Business app keyboard "Done" accessory bar] (BUSINESS LEG)

**Phase:** SPEC (mingla-forensics, IA mode — follows the INVESTIGATE in this folder).
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1165-[business-keyboard-done-bar]/` on branch `ORCH-1165-business-keyboard-done-bar`.
**Companion:** `INVESTIGATE_ORCH-1165_BUSINESS_KEYBOARD_DONE_BAR.md` (same folder). Every finding F-1..F-7 is honored below.
**Scope (HARD):** `mingla-business/` ONLY, iOS + Android. NO `app-mobile/`, NO buyer-web, NO admin-web.

---

## 1. Executive summary

Add a slim 42pt bar pinned on the top edge of the on-screen keyboard, on every focused text field in the **business app**, with a single right-aligned brand-orange **Done** button that dismisses the keyboard. Built entirely on the already-installed `react-native-keyboard-controller@1.18.5` `KeyboardToolbar` with `showArrows={false}` (Done-only — no Prev/Next). Because the bar adds 42pt of height, the app's scroll-avoidance clearance is raised by 42pt (one constant in `SmartScrollView`) and the 6 surfaces that compute their own keyboard offset are individually patched, so **no input field is ever hidden behind the taller keyboard**. The toolbar mounts once at the app root for all normal screens, and once inside each native-`Modal` overlay primitive (`Sheet`, `Modal`) so sheet/modal inputs get the bar too.

---

## 2. Scope & non-goals

**IN SCOPE**
1. One native-only app-root `KeyboardToolbar` (Done-only, brand-themed).
2. One `KeyboardToolbar` inside the `Sheet` primitive panel and one inside the `Modal` primitive panel (native-Modal hosts — F-2).
3. Raise `SmartScrollView` `DEFAULT_BOTTOM_OFFSET` 12 → 54 (F-3).
4. Per-surface +42pt offset (or explicit toolbar-suppress, per OQ-1) for the 6 at-risk surfaces (F-5).
5. Brand-orange Done `theme`.
6. DRAFT clearance invariant + fails-on-revert regression test.
7. Full iOS-sim + Samsung-Android TEST drive across every at-risk surface (handed to mingla-tester).

**NON-GOALS (explicit)**
- NO Prev/Next chevrons (Seth-locked Done-only).
- NO migration of the allowlisted bespoke keyboard sites (`BusinessWelcomeScreen`, `JoinWaitlistSheet`, `ExperienceCreatorWizard`, `BrandCreationFlow`, `ComposerV2Editor`) off their carve-outs — only the +42 offset patch. The deeper `useKeyboardHeightJs` migration is a separate ORCH (DISC-1165-A).
- NO `app-mobile/` (consumer) work — separate later leg.
- NO web / admin / buyer-web changes. Web gets a `null` toolbar (no on-screen keyboard accessory in browsers).
- NO new DB / edge / service / hook / realtime layers (pure native-UI change).
- NO change to the 4 forbidden strict-grep patterns; do not add any bespoke `Keyboard.addListener`-for-layout.

**Assumptions:** `KeyboardProvider` is mounted at root (verified, `app/_layout.tsx` L693). Library version 1.18.5 (verified). Business app is dark-themed.

---

## 3. Cross-Surface Impact Declaration

| # | Surface | Covered? | User-visible behavior | Files touched here | Parity |
|---|---------|----------|------------------------|--------------------|--------|
| 1 | Consumer iOS (`app-mobile/`) | **NO** | unchanged | none | separate later leg |
| 2 | Consumer Android (`app-mobile/`) | **NO** | unchanged | none | separate later leg |
| 3 | Buyer/anon Web | **NO** | unchanged | none | out of scope |
| 4 | **Business iOS** | **YES** | Done bar on keyboard top, every field; iOS-26 floating-keyboard → rounded floating bar; no field occluded | mount + SmartScrollView + 6 at-risk + Sheet/Modal | automatic via shared root + primitives (manual for the 6 at-risk) |
| 5 | **Business Android** | **YES** | Done bar on keyboard top, every field (full-width, square); no field occluded | same as iOS | same |
| 6 | Admin Web (adjacent) | **NO** | unchanged | none | out of scope |
| 7 | Business Web preview (adjacent) | **NO** | toolbar wrapper resolves to a `null` web variant; SmartScrollView.web unchanged (no `bottomOffset` use on web) | `KeyboardToolbarRoot.tsx` (web no-op) only | automatic — web bundle clean |

**Not-covered reasons (one phrase each):** consumer = separate leg; buyer/admin web = different app; business web preview = browsers have no keyboard accessory bar.

---

## 4. Layered specification

Only the **Component** layer is affected (plus a wrapper file). No DB/edge/service/hook/realtime.

### 4.1 New wrapper — `KeyboardToolbarRoot` (platform-split, mirrors `KeyboardRoot`)

**Create `mingla-business/src/wrappers/KeyboardToolbarRoot.native.tsx`:**
- Default-exports a component that renders exactly:
  ```tsx
  <KeyboardToolbar showArrows={false} theme={MINGLA_KEYBOARD_TOOLBAR_THEME} />
  ```
  imported `KeyboardToolbar` from `"react-native-keyboard-controller"`.
- `MINGLA_KEYBOARD_TOOLBAR_THEME` (define in this file or import the accent token from `@/constants/designSystem`): start from the library default `colors`, override **`dark.primary` to `"#eb7825"`** (brand accent.warm — the Done text color) and keep `dark.background` (`#2C2C2E`) or align it to the app's elevated-surface token. Provide a `light` block too (the library reads `useKeyboardState().appearance`); business app is dark, but supply both for safety.
- Renders nothing else. No props.

**Create `mingla-business/src/wrappers/KeyboardToolbarRoot.tsx` (web passthrough):**
- Returns `null` (web has no on-screen keyboard accessory; the library has no web entry — same rationale as `KeyboardRoot.tsx`). Add the matching header comment citing I-PROPOSED-KEYBOARD-LIBRARY-ONLY.

> Rationale: a platform-split wrapper keeps the library import out of the web bundle (mirrors the proven `KeyboardRoot`/`SmartScrollView` pattern) and gives the strict-grep safelist a single new native file to whitelist.

### 4.2 Root mount — `mingla-business/app/_layout.tsx`

Inside `<KeyboardRoot>` (L693–695), render the toolbar as a **sibling** of `<RootLayoutInner/>` so it overlays at the root native window under `KeyboardProvider`:
```tsx
<KeyboardRoot>
  <RootLayoutInner />
  <KeyboardToolbarRoot />   {/* ORCH-1165: Done-only accessory bar, native-only */}
</KeyboardRoot>
```
Add the import: `import { KeyboardToolbarRoot } from "../src/wrappers/KeyboardToolbarRoot";`
(`KeyboardStickyView` is absolutely positioned, so sibling order is fine; placing it last keeps it visually on top within the root window.)

### 4.3 Sheet host mount — `mingla-business/src/components/ui/SheetMobile.tsx`

Inside the `<Modal …>` panel (the bottom dock around L313–333, **inside** the Modal so it lives in the sheet's native window), render `<KeyboardToolbarRoot />` as a sibling of the panel content so sheet inputs get the bar (F-2). Place it as the **last child inside the Modal's root `<View style={StyleSheet.absoluteFill}>`** (so it overlays the sheet). Verify at TEST it floats on the keyboard, not clipped by the panel.
> Note: SheetMobile is on the strict-grep SAFELIST already; adding a library import here is fine. Do NOT add any `Keyboard.addListener`.

### 4.4 Modal host mount — `mingla-business/src/components/ui/Modal.tsx`

In `ModalNative` (L78+), inside the `RNModal`, render `<KeyboardToolbarRoot />` as the last overlay child so the `CancelOrderDialog` (and any future Modal input) gets the bar.

### 4.5 Avoidance clearance — `mingla-business/src/wrappers/SmartScrollView.native.tsx`

Change the constant:
```tsx
// ORCH-1165: +KEYBOARD_TOOLBAR_HEIGHT (42) so the 42pt Done bar never covers
// the focused field. 12pt visible clearance ABOVE the toolbar preserved.
const DEFAULT_BOTTOM_OFFSET = 54; // was 12
```
Optionally import `KEYBOARD_TOOLBAR_HEIGHT` is NOT publicly exported by the lib's index; use the literal `54` with the comment `12 (clearance) + 42 (KEYBOARD_TOOLBAR_HEIGHT)`. This one change fixes every Category-A/B SmartScrollView consumer (the 4 wizards, all sheet bodies, etc.) automatically (F-3, F-4).

### 4.6 The 6 at-risk surfaces (F-5) — per-site patch

For each, the implementor adds **42pt** to the existing keyboard-derived offset (NOT to insets/static padding), OR suppresses the toolbar on that surface if OQ-1 resolves "suppress". Default per this SPEC = **offset by 42** (keeps the toolbar everywhere, honoring Seth's "every focused field"):

| Site | File | Exact change |
|------|------|--------------|
| (a) | `src/components/waitlist/JoinWaitlistSheet.tsx` L147 | `paddingBottom: keyboardPadding + spacing.lg` → add `+ 42` **only when `keyboardPadding > 0`** (i.e. keyboard open): `paddingBottom: keyboardPadding + spacing.lg + (keyboardPadding > 0 ? 42 : 0)`. (This sheet is inside a Modal host → also gets the §4.3 toolbar.) |
| (b) | `src/components/auth/BusinessWelcomeScreen.tsx` L576 | `+ keyboardPad` → `+ (keyboardPad > 0 ? keyboardPad + 42 : 0)` so the 42pt is added only with keyboard open. |
| (c) | `src/components/experience/ExperienceCreatorWizard.tsx` | bare ScrollView has no KAS auto-scroll. Add `contentContainerStyle` bottom padding of `+42` keyed on keyboard-visible (use the existing `useKeyboardIsVisible` wrapper — already library-backed, gate-clean) so the last field clears the toolbar; do NOT convert to SmartScrollView in this ORCH. |
| (d) | `src/components/brand/BrandCreationFlow.tsx` | same approach as (c): bottom padding `+42` keyed on `useKeyboardIsVisible`. (Lower risk per author note, but apply for safety.) |
| (e) | `src/components/groupChat/GroupChatPanel.tsx` L229 + `src/components/support/SupportThread.native.tsx` L25 | `KeyboardAvoidingView … keyboardVerticalOffset={0}` → `keyboardVerticalOffset={42}` so the composer lifts 42pt clear of the toolbar. (`SupportThread.native.tsx` is the shared wrapper used by `SupportThreadCore`.) |
| (f) | `src/components/marketing/ComposerV2/ComposerV2Editor.tsx` (safelisted) | the fixed-height body shrink is computed from the raw keyboard frame; add `42` to its shrink so the pell editor's bottom is not under the toolbar. Implementor reads the exact shrink expression and adds 42 to the keyboard-height term only. |

> If OQ-1 resolves "suppress on single-line composers", then (e) instead conditionally renders the root toolbar with `enabled={false}` on chat/support routes — but the default contract is offset-by-42, toolbar everywhere.

**States:** the toolbar has exactly two states — hidden (no field focused / keyboard closed: `KeyboardStickyView` translates it off-screen) and visible (field focused: bar on keyboard top). Done button: default + pressed (library ripple). No loading/empty/error states (stateless dismiss). A11y: the library sets `accessibilityLabel="Done"` + `accessibilityHint="Closes the keyboard"` (index.tsx L242–243) — inherited free.

---

## 5. Success criteria (per-surface where parity is manual)

- **SC-1-iOS / SC-1-Android:** Focusing ANY non-modal business `TextInput` shows a 42pt bar flush on the keyboard top with a single right-aligned **Done** (no Prev/Next arrows). iOS-26 sim shows the rounded floating variant; Android shows the full-width square variant.
- **SC-2-iOS / SC-2-Android:** Tapping **Done** dismisses the keyboard and the bar.
- **SC-3 (THE regression gate, iOS + Android, per at-risk surface):** With the keyboard open on each surface below, the focused field/composer is **fully visible above the toolbar** (≥ ~12pt gap between field bottom and toolbar top); no part of any input is occluded. Surfaces to prove: Event/Trip/Rsvp/Venue Creator wizard fields; one sheet input (e.g. TicketTierEditSheet); CancelOrderDialog (Modal); JoinWaitlistSheet; BusinessWelcomeScreen sign-in; ExperienceCreatorWizard last field; BrandCreationFlow; Ari composer; GroupChat composer; Support composer; ComposerV2 editor.
- **SC-4-iOS / SC-4-Android:** The toolbar appears over **sheet** inputs and **Modal** (CancelOrderDialog) inputs — confirming the per-Modal mounts work (F-2).
- **SC-5:** Web (business preview) renders NO toolbar and is unaffected; `expo export` web bundle builds clean (no `react-native-keyboard-controller` web import error).
- **SC-6:** The Done button text renders in brand orange `#eb7825`.
- **SC-7:** Strict-grep gate `orch-0892-no-bespoke-keyboard-plumbing.mjs` stays **PASS** (the new native wrapper is safelisted; no new forbidden pattern).

---

## 6. Invariants

**Preserved:**
- `I-PROPOSED-KEYBOARD-LIBRARY-ONLY` (ACTIVE) — every new piece is `react-native-keyboard-controller`; no bespoke `Keyboard.addListener` for layout added. Verified by SC-7 + the gate.
- `I-PROPOSED-SMART-SCROLLVIEW-WRAPPER-ONLY` (ACTIVE) — only the `bottomOffset` default changes; no new bare ScrollView. Verified by SC-7.

**New (pre-staged DRAFT — orchestrator flips ACTIVE on CLOSE):**
- **`I-PROPOSED-KEYBOARD-TOOLBAR-CLEARANCE` (DRAFT):** *The `SmartScrollView` default `bottomOffset` MUST be ≥ `KEYBOARD_TOOLBAR_HEIGHT` (42) so the app-wide Done bar can never occlude the focused field.* Enforced by the §9 regression test (asserts `DEFAULT_BOTTOM_OFFSET >= 42`). Update the strict-grep gate's SAFELIST to add `mingla-business/src/wrappers/KeyboardToolbarRoot.native.tsx` (it imports the library) so the gate stays green.

---

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T1 (happy) | Focus event-name field | tap field | 42pt Done-only bar on keyboard top; field fully visible above it | component / runtime (iOS+Android) |
| T2 (happy) | Tap Done | press Done | keyboard + bar dismiss | runtime |
| T3 (regression) | Each at-risk surface, keyboard open | focus bottom field | field/composer ≥12pt above toolbar, never occluded | runtime (iOS+Android) |
| T4 (edge) | Sheet input (TicketTierEditSheet) | open sheet, focus | toolbar appears over the sheet (Modal host) | runtime |
| T5 (edge) | Modal input (CancelOrderDialog) | open dialog, focus reason | toolbar appears over the Modal | runtime |
| T6 (edge) | iOS 26 floating keyboard | focus on iOS-26 sim | rounded floating bar variant renders correctly, Done works | runtime (iOS) |
| T7 (error/parity) | Web business preview | load a form route on web | no toolbar; bundle builds; no crash | build / runtime (web) |
| T8 (gate) | run strict-grep | `node …/orch-0892-no-bespoke-keyboard-plumbing.mjs` | PASS, 0 violations | CI |
| T9 (fails-on-revert) | unit test on `DEFAULT_BOTTOM_OFFSET` | import constant | `>= 42`; FAILS if reverted to 12 | unit (jest) |

---

## 8. Implementation order

1. Create `KeyboardToolbarRoot.native.tsx` + `KeyboardToolbarRoot.tsx` (§4.1) with brand theme.
2. Mount at root in `app/_layout.tsx` (§4.2).
3. Raise `SmartScrollView.native.tsx` `DEFAULT_BOTTOM_OFFSET` to 54 (§4.5).
4. Add per-Modal mounts in `SheetMobile.tsx` + `Modal.tsx` (§4.3/4.4).
5. Patch the 6 at-risk surfaces +42 (§4.6).
6. Add the strict-grep SAFELIST entry for `KeyboardToolbarRoot.native.tsx`; re-run the gate (T8).
7. Write the fails-on-revert jest test (§9 / T9).
8. Self-verify on Android device + iOS sim (hand the full drive to mingla-tester).

---

## 9. Regression prevention — fails-on-revert contract

**Structural safeguard:** the toolbar's 42pt height must always be matched by ≥42pt of avoidance clearance.

**Test (create `mingla-business/src/wrappers/__tests__/orch_1165_keyboard_toolbar_clearance.test.ts`):**
- Import `DEFAULT_BOTTOM_OFFSET` (export it from `SmartScrollView.native.tsx`, or assert via the module) and assert `DEFAULT_BOTTOM_OFFSET >= 42` with a protective comment:
  ```ts
  // ORCH-1165: the Done bar is 42pt tall (KEYBOARD_TOOLBAR_HEIGHT). If this
  // clearance drops below 42, the bar occludes the focused field — the exact
  // regression Seth flagged. Do NOT lower below 42. (I-PROPOSED-KEYBOARD-TOOLBAR-CLEARANCE)
  expect(DEFAULT_BOTTOM_OFFSET).toBeGreaterThanOrEqual(42);
  ```
- **Fails-on-revert proof required:** reverting `DEFAULT_BOTTOM_OFFSET` to 12 makes this test FAIL; restoring 54 makes it PASS. Implementor must capture both runs in the implementation report.
- Optionally a second assertion that `KeyboardToolbarRoot.native.tsx` passes `showArrows={false}` (regex on source) so a future edit can't silently re-enable chevrons.

---

## 10. Open questions

- **OQ-1 (for Seth):** On the single-line bottom-pinned composers (Ari / group chat / support) — which already have a visible Send button and dismiss-on-scroll — should the Done bar still appear (default per this SPEC = YES, offset the composer by 42), or be SUPPRESSED on those surfaces to avoid double chrome? Default = show everywhere (honors "every focused field"). If Seth wants suppression, the implementor sets `enabled={false}` on the toolbar for chat/support routes instead of the +42 composer offset.
- **OQ-2 (resolved in-spec):** Done button color = brand orange `#eb7825` (accent.warm). If Seth prefers the neutral library default, drop the theme override.
- **OQ-3 (TEST-time):** iOS-26 floating keyboard (`KEYBOARD_HAS_ROUNDED_CORNERS`) renders a rounded *floating* bar with side margins — confirm it looks right and Done is reachable on the iPhone 17 Pro Max sim. (No code decision; a TEST acceptance note.)

---

## 11. Downstream routing

**Next = mingla-implementor (business side).** After implementation: **mingla-tester** drives the full iOS-sim + Samsung-Android matrix (every SC, especially SC-3/SC-4 per at-risk surface, capturing AFTER screenshots paired with the `Mingla_Artifacts/evidence/ORCH-1165/*_BEFORE.png` baselines). Then **mingla-orchestrator** CLOSE (flips `I-PROPOSED-KEYBOARD-TOOLBAR-CLEARANCE` ACTIVE, syncs World Map / Invariant Registry, OTA business dev channel per the OTA runbook — this is pure-JS, no native rebuild needed).

---

## Scoped allowlist (implementor may edit ONLY these)

1. `mingla-business/src/wrappers/KeyboardToolbarRoot.native.tsx` (NEW)
2. `mingla-business/src/wrappers/KeyboardToolbarRoot.tsx` (NEW)
3. `mingla-business/app/_layout.tsx` (root mount + import)
4. `mingla-business/src/wrappers/SmartScrollView.native.tsx` (bottomOffset 12→54 + export the constant)
5. `mingla-business/src/components/ui/SheetMobile.tsx` (sheet-host mount)
6. `mingla-business/src/components/ui/Modal.tsx` (modal-host mount)
7. `mingla-business/src/components/waitlist/JoinWaitlistSheet.tsx` (+42 offset)
8. `mingla-business/src/components/auth/BusinessWelcomeScreen.tsx` (+42 offset)
9. `mingla-business/src/components/experience/ExperienceCreatorWizard.tsx` (+42 bottom padding)
10. `mingla-business/src/components/brand/BrandCreationFlow.tsx` (+42 bottom padding)
11. `mingla-business/src/components/groupChat/GroupChatPanel.tsx` (keyboardVerticalOffset 0→42)
12. `mingla-business/src/components/support/SupportThread.native.tsx` (keyboardVerticalOffset 0→42)
13. `mingla-business/src/components/marketing/ComposerV2/ComposerV2Editor.tsx` (+42 shrink)
14. `.github/scripts/strict-grep/orch-0892-no-bespoke-keyboard-plumbing.mjs` (SAFELIST += KeyboardToolbarRoot.native.tsx)
15. `mingla-business/src/wrappers/__tests__/orch_1165_keyboard_toolbar_clearance.test.ts` (NEW test)

## DO-NOT-TOUCH

- `app-mobile/` (entire consumer app — separate leg).
- `mingla-business/src/wrappers/KeyboardRoot.native.tsx` / `.tsx` (the provider mount; unchanged).
- Any `*.web.tsx` SmartScrollView/useKeyboardIsVisible variant (web bundle).
- The public offering pages under COMMS-0040/0041 (`RsvpPublicBody.tsx`, public experience pages) — no overlap; do not edit.
- Any DB / edge / service / hook / migration.
- The 4 forbidden strict-grep patterns — do NOT introduce a bespoke `Keyboard.addListener` for layout anywhere new.

**Stop-and-amend:** touching anything outside the allowlist requires a `SPEC_AMENDMENT_ORCH-1165_*.md` before proceeding — never silently widen.
