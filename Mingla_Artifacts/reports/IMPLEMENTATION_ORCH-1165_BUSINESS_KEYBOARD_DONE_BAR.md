# IMPLEMENTATION — ORCH-1165 [Business app keyboard "Done" accessory bar] (BUSINESS LEG)

**Phase:** IMPLEMENT (mingla-implementor, business side).
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1165-[business-keyboard-done-bar]/` on branch `ORCH-1165-business-keyboard-done-bar` (rebased on origin/main, 0 behind).
**Binding contract:** `Mingla_Artifacts/investigations/SPEC_ORCH-1165_BUSINESS_KEYBOARD_DONE_BAR.md`.
**Seth's OQ decisions implemented:** OQ-1 = SHOW EVERYWHERE (default +42 offset path; NO `enabled={false}` suppression). OQ-2 = BRAND ORANGE Done (`#eb7825` via theme).

---

## 1. Summary

Added a slim 42pt Done-only accessory bar pinned to the top of the on-screen keyboard for every focused text field in the **business app** (iOS + Android), built entirely on the already-installed `react-native-keyboard-controller@1.18.5` `KeyboardToolbar` with `showArrows={false}`. The Done button text renders in brand orange `#eb7825`. Because the bar adds 42pt of height, the app-wide auto-scroll clearance (`SmartScrollView` `DEFAULT_BOTTOM_OFFSET`) was raised 12 → 54 (12 visible clearance + 42 toolbar), and the 6 surfaces that compute their own keyboard offset were each patched +42 so no input is ever occluded. The toolbar mounts once at the app root (for all normal screens) and once inside each native-`Modal` overlay primitive (`SheetMobile`, `Modal`) so sheet/modal inputs get the bar too. Web is unaffected — the wrapper resolves to a `null` web variant.

This is a pure native-UI change: NO DB / edge / service / hook / migration. 15 files (the exact SPEC allowlist), nothing outside scope.

---

## 2. SPEC success-criteria coverage

| SC | Criterion | Status | Evidence (commit `<hash>`) |
|----|-----------|--------|------|
| SC-1-iOS / SC-1-Android | 42pt Done-only bar (no arrows) on keyboard top, every non-modal field | ✓ implemented, runtime-UNVERIFIED | Root mount `app/_layout.tsx`; `KeyboardToolbarRoot.native.tsx` `showArrows={false}`. Needs sim/device drive (tester). |
| SC-2-iOS / SC-2-Android | Tapping Done dismisses keyboard + bar | ✓ implemented, runtime-UNVERIFIED | Library default Done behavior; inherited. Tester drive. |
| SC-3 (regression, per at-risk surface) | Focused field ≥~12pt above the toolbar, never occluded | ✓ implemented, runtime-UNVERIFIED | `DEFAULT_BOTTOM_OFFSET` 54 (all SmartScrollView consumers) + 6 per-surface +42 patches. Asserted structurally by the §9 test; per-surface device proof = tester. |
| SC-4-iOS / SC-4-Android | Toolbar over **sheet** + **Modal** (CancelOrderDialog) inputs | ✓ implemented, runtime-UNVERIFIED | In-Modal mounts in `SheetMobile.tsx` + `Modal.tsx`. Tester drive. |
| SC-5 | Web renders NO toolbar; web bundle builds clean | ✓ implemented | `KeyboardToolbarRoot.tsx` returns `null`; library import only in `.native.tsx`. Full `expo export` web build = tester/CI. |
| SC-6 | Done text in brand orange `#eb7825` | ✓ implemented | `MINGLA_KEYBOARD_TOOLBAR_THEME.dark.primary = accent.warm` (#eb7825) + light block too. |
| SC-7 | `orch-0892` strict-grep stays PASS | ✓ VERIFIED | Gate run below — PASS, exit 0, 0 violations, `KeyboardToolbarRoot.native.tsx` safelisted. |

Runtime-UNVERIFIED items are the SPEC's TEST-phase responsibility (full iOS-sim + Samsung-Android matrix, handed to mingla-tester per §11). The implementor verified: the strict-grep gate (PASS), the fails-on-revert clearance test (both runs), TypeScript (zero new errors in touched files), and scope (exactly the 15 allowlist files).

---

## 3. Files changed (15 — exact SPEC allowlist)

NEW (3):
- `mingla-business/src/wrappers/KeyboardToolbarRoot.native.tsx` (+50) — `<KeyboardToolbar showArrows={false} theme={MINGLA_KEYBOARD_TOOLBAR_THEME}/>`, brand-orange Done, both light+dark theme blocks.
- `mingla-business/src/wrappers/KeyboardToolbarRoot.tsx` (+12) — web passthrough returning `null` (mirrors `KeyboardRoot.tsx`).
- `mingla-business/src/wrappers/__tests__/orch_1165_keyboard_toolbar_clearance.test.ts` (+58) — §9 regression test.

MODIFIED (12):
- `mingla-business/app/_layout.tsx` (+~9) — import + root mount sibling of `<RootLayoutInner/>` inside `<KeyboardRoot>`.
- `mingla-business/src/wrappers/SmartScrollView.native.tsx` (~+8/-3) — `DEFAULT_BOTTOM_OFFSET` 12 → 54 + EXPORT the constant.
- `mingla-business/src/components/ui/SheetMobile.tsx` (+~6) — import + in-Modal toolbar mount (last child of the native Modal's root absoluteFill).
- `mingla-business/src/components/ui/Modal.tsx` (+~7) — import + in-RNModal toolbar mount in `ModalNative` (last overlay child).
- `mingla-business/src/components/waitlist/JoinWaitlistSheet.tsx` (+~9) — `+42` paddingBottom only when `keyboardPadding > 0`.
- `mingla-business/src/components/auth/BusinessWelcomeScreen.tsx` (+~4) — `+42` only when `keyboardPad > 0`.
- `mingla-business/src/components/experience/ExperienceCreatorWizard.tsx` (+~9) — `useKeyboardIsVisible` + `+42` contentContainer paddingBottom when keyboard up.
- `mingla-business/src/components/brand/BrandCreationFlow.tsx` (+~10) — same pattern as the wizard.
- `mingla-business/src/components/groupChat/GroupChatPanel.tsx` (+~1) — `keyboardVerticalOffset` 0 → 42.
- `mingla-business/src/components/support/SupportThread.native.tsx` (+~1) — `keyboardVerticalOffset` 0 → 42.
- `mingla-business/src/components/marketing/ComposerV2/ComposerV2Editor.tsx` (+~4) — added 42 to the keyboard-height shrink term only (when keyboard up).
- `.github/scripts/strict-grep/orch-0892-no-bespoke-keyboard-plumbing.mjs` (+~5) — SAFELIST += `KeyboardToolbarRoot.native.tsx`.

---

## 4. Data-model changes applied

None. Pure native-UI change.

## 5. Edge functions touched

None.

---

## 6. Regression tests added

- Path: `mingla-business/src/wrappers/__tests__/orch_1165_keyboard_toolbar_clearance.test.ts` (2 tests).
  - Test 1: `DEFAULT_BOTTOM_OFFSET` is exported and `>= 42` (source-text parse, mirrors `KeyboardRoot.test.tsx`'s `fs.readFileSync` pattern — no RN native runtime needed).
  - Test 2: `KeyboardToolbarRoot.native.tsx` passes `showArrows={false}` (guards against silent chevron re-enable).
- **fails-on-revert verified.** Method = TRUE value edit of the fix (not comment-out): `DEFAULT_BOTTOM_OFFSET` 54 → 12 → test FAILS → restore 54 → test PASSES. Both runs captured in §8 below.
- `fails-on-revert verified at commit edd850f93` (both the passing run at 54 and the failing run at 12 captured in §8 below).

Both new test file AND all 15 changed files are visible in `git diff origin/main...HEAD --name-only` (same branch/PR as the fix).

---

## 7. Old → New receipts

### `KeyboardToolbarRoot.native.tsx` (NEW)
**Before:** did not exist.
**Now:** default-exports `KeyboardToolbarRoot` rendering `<KeyboardToolbar showArrows={false} theme={MINGLA_KEYBOARD_TOOLBAR_THEME}/>`; theme overrides `primary` (Done text) to `accent.warm` #eb7825 in both light + dark blocks. Theme type derived via `NonNullable<KeyboardToolbarProps["theme"]>` because the library does not re-export `KeyboardToolbarTheme` from its index.
**Why:** SC-1/SC-6 — the Done-only brand-orange bar. ~50 lines.

### `KeyboardToolbarRoot.tsx` (NEW, web)
**Before:** did not exist.
**Now:** returns `null` (web has no keyboard accessory; keeps the library out of the web bundle).
**Why:** SC-5 — web parity / clean bundle. ~12 lines.

### `app/_layout.tsx`
**Before:** `<KeyboardRoot>` wrapped only `<RootLayoutInner/>`.
**Now:** `<KeyboardToolbarRoot/>` rendered as the last sibling inside `<KeyboardRoot>`, so the bar overlays the root window for all normal screens.
**Why:** SC-1 (app-wide mount). ~9 lines.

### `SmartScrollView.native.tsx`
**Before:** `const DEFAULT_BOTTOM_OFFSET = 12;` (file-local).
**Now:** `export const DEFAULT_BOTTOM_OFFSET = 54;` (12 clearance + 42 KEYBOARD_TOOLBAR_HEIGHT).
**Why:** SC-3 — every SmartScrollView consumer auto-scrolls 42pt higher so the focused field clears the bar. Exported for the §9 test. ~8 lines.

### `SheetMobile.tsx`
**Before:** native Modal panel rendered scrim + bottomDock only.
**Now:** `<KeyboardToolbarRoot/>` added as the last child inside the native Modal's root `absoluteFill` View so sheet inputs get the bar (they live in the sheet's own native window, unreachable by the root toolbar).
**Why:** SC-4. ~6 lines.

### `Modal.tsx` (ModalNative)
**Before:** RNModal rendered scrim + centered panel only.
**Now:** `<KeyboardToolbarRoot/>` added as the last overlay child inside the native RNModal (ModalNative only; the web `ModalWeb` variant is untouched).
**Why:** SC-4 (CancelOrderDialog + future Modal forms). ~7 lines.

### The 6 at-risk surfaces (SC-3)
- `JoinWaitlistSheet.tsx`: `paddingBottom: keyboardPadding + spacing.lg + (keyboardPadding > 0 ? 42 : 0)`.
- `BusinessWelcomeScreen.tsx`: `Math.max(insets.bottom, vs(24)) + (keyboardPad > 0 ? keyboardPad + 42 : 0)`.
- `ExperienceCreatorWizard.tsx`: added `useKeyboardIsVisible` (gate-clean library wrapper); ScrollView `contentContainerStyle` gets `{ paddingBottom: spacing.lg + 42 }` when keyboard visible. Did NOT convert to SmartScrollView (deferred per NON-GOALS / DISC-1165-A).
- `BrandCreationFlow.tsx`: same pattern as the wizard.
- `GroupChatPanel.tsx` + `SupportThread.native.tsx`: `keyboardVerticalOffset` 0 → 42 (composer lifts 42pt clear of the bar — OQ-1 "show everywhere", default offset path).
- `ComposerV2Editor.tsx`: the fixed-height body shrink subtracts `keyboardShrink = keyboardHeight > 0 ? keyboardHeight + 42 : 0` (42 added to the keyboard-height term ONLY, per SPEC §4.6(f)). Existing `Keyboard.addListener` left untouched (this file is on the orch-0892 SAFELIST).

### `orch-0892-no-bespoke-keyboard-plumbing.mjs`
**Before:** SAFELIST of 8 files.
**Now:** + `mingla-business/src/wrappers/KeyboardToolbarRoot.native.tsx` (legitimate library mount, same class as `KeyboardRoot.native.tsx`).
**Why:** SC-7 — keep the gate green.

---

## 8. Gate runs + fails-on-revert (real output)

### orch-0892 strict-grep gate — PASS
```
$ node .github/scripts/strict-grep/orch-0892-no-bespoke-keyboard-plumbing.mjs
ORCH-0892 no-bespoke-keyboard-plumbing informational gate
Scanned 840 .ts/.tsx files under mingla-business/.
  8 file(s) explicitly safelisted (Sheet / ComposerV2 / richEditor / KeyboardRoot)
PASS — zero bespoke keyboard-plumbing violations outside the safelist.
EXIT: 0
```

### New jest clearance test — PASS (value = 54)
```
$ npx jest orch_1165_keyboard_toolbar_clearance --runInBand
PASS src/wrappers/__tests__/orch_1165_keyboard_toolbar_clearance.test.ts
  ORCH-1165 keyboard Done-bar clearance
    ✓ SmartScrollView.native exports DEFAULT_BOTTOM_OFFSET >= 42 (KEYBOARD_TOOLBAR_HEIGHT)
    ✓ KeyboardToolbarRoot.native renders the toolbar Done-only (showArrows={false})
Test Suites: 1 passed, 1 total
Tests:       2 passed, 2 total
```

### Fails-on-revert — DEFAULT_BOTTOM_OFFSET reverted 54 → 12 → test FAILS
```
$ npx jest orch_1165_keyboard_toolbar_clearance --runInBand   # with value = 12
    expect(received).toBeGreaterThanOrEqual(expected)
    Expected: >= 42
    Received:    12
    > 45 |     expect(value).toBeGreaterThanOrEqual(42);
Test Suites: 1 failed, 1 total
Tests:       1 failed, 1 passed, 2 total
```

### Restored 12 → 54 → test PASSES again
```
$ npx jest orch_1165_keyboard_toolbar_clearance --runInBand   # restored to 54
    ✓ SmartScrollView.native exports DEFAULT_BOTTOM_OFFSET >= 42 (KEYBOARD_TOOLBAR_HEIGHT)
    ✓ KeyboardToolbarRoot.native renders the toolbar Done-only (showArrows={false})
Test Suites: 1 passed, 1 total
Tests:       2 passed, 2 total
```
**fails-on-revert: YES — captured both runs.**

### TypeScript
`npx tsc --noEmit` over `mingla-business`: ZERO errors in any of the 13 touched product files (grep over the full error set returns none for KeyboardToolbarRoot / SmartScrollView / JoinWaitlistSheet / BusinessWelcomeScreen / ExperienceCreatorWizard / BrandCreationFlow / GroupChatPanel / SupportThread / ComposerV2Editor / Modal.tsx / SheetMobile / _layout / orch_1165). The 52 remaining `src/`/`app/` errors are PRE-EXISTING and unrelated (native-only module resolution + existing test files + `richEditor.tsx`/`SelectionFormattingTooltip.tsx` which were NOT touched) — an artifact of the worktree's symlinked node_modules / tsconfig pathing, present on the base.

---

## 9. Cross-surface impact table

| # | Surface | Affected | Parity |
|---|---------|----------|--------|
| 1 | Consumer iOS (`app-mobile/`) | NO | separate later leg |
| 2 | Consumer Android (`app-mobile/`) | NO | separate later leg |
| 3 | Buyer/anon Web | NO | out of scope |
| 4 | **Business iOS** | **YES** | automatic via shared root + primitives; manual for the 6 at-risk surfaces (patched) |
| 5 | **Business Android** | **YES** | same as iOS |
| 6 | Admin Web (adjacent) | NO | different app |
| 7 | Business Web preview (adjacent) | NO | toolbar wrapper resolves to `null` web variant; no library import on web |

---

## 10. Smoke result

No sim/device drive performed by the implementor (pure-JS native-UI; the SPEC §11 assigns the full iOS-sim + Samsung-Android matrix to mingla-tester). Implementor static verification: strict-grep PASS, clearance test PASS + fails-on-revert proven, zero new TS errors, scope == 15 allowlist files.

## 11. Known issues / deferred

- DISC-1165-A (from SPEC NON-GOALS): the bespoke-offset carve-outs (`BusinessWelcomeScreen`, `JoinWaitlistSheet`, `ExperienceCreatorWizard`, `BrandCreationFlow`, `ComposerV2Editor`) still use per-screen keyboard offsets rather than a full `useKeyboardHeightJs` / SmartScrollView migration. Intentional per spec — a separate ORCH. No `[TRANSITIONAL]` markers added (the +42 patches are permanent).
- Runtime appearance: theme supplies both light + dark blocks; business app is dark so `dark.primary` (#eb7825) drives the Done color. If the app ever runs light, the light block also uses #eb7825.

## 12. Operator action required (for orchestrator/orchestration → tester → CLOSE)

- NO migration (no DB change) — no `db push`.
- NO edge-function deploy.
- This is pure-JS — at CLOSE, OTA the business **dev** channel per the EAS OTA runbook (no native rebuild needed); flip `I-PROPOSED-KEYBOARD-TOOLBAR-CLEARANCE` DRAFT → ACTIVE.
- Route to **mingla-tester** for the full iOS-sim + Samsung-Android SC matrix (esp. SC-3/SC-4 per at-risk surface + SC-6 brand-orange + OQ-3 iOS-26 floating-keyboard rounded variant).

## 13. Discoveries for Orchestrator

- COMMS-0040 / COMMS-0041 (WARN, public RSVP/experience page standardization) are acknowledged and have ZERO overlap with this ORCH — none of the public-offering files (RsvpPublicBody, public experience pages) were touched; ORCH-1165 is keyboard-UI only.
- Minor doc nuance: the orch-0892 SAFELIST lists `mingla-business/src/components/ui/Sheet.tsx`, while the keyboard-host primitive I edited is `SheetMobile.tsx`. `SheetMobile.tsx` is NOT on the SAFELIST but did not need to be — it does not trip any forbidden pattern (it imports `KeyboardToolbarRoot`, not the library directly, and adds no `Keyboard.addListener`). Gate confirms PASS. No action needed.
