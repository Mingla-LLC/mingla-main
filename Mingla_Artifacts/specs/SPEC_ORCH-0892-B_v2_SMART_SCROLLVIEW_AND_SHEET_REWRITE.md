# SPEC — ORCH-0892-B v2 [App-wide keyboard avoidance via SmartScrollView wrapper + Sheet primitive rewrite]

**Author:** Claude `mingla-forensics` (SPEC mode, v2 — supersedes v1 per operator rejection of per-screen template approach).
**Date:** 2026-05-20.
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
**Supersedes:** [SPEC_ORCH-0892-B_KEYBOARD_AVOIDANCE_SWEEP.md](SPEC_ORCH-0892-B_KEYBOARD_AVOIDANCE_SWEEP.md) (v1 — operator rejected with quote "this will not work… so many places you are missing out").
**Investigation:** [INVESTIGATION_ORCH-0892-B_v2_GLOBAL_SHIFTER.md](../reports/INVESTIGATION_ORCH-0892-B_v2_GLOBAL_SHIFTER.md) — confirms library v1.18.5 has no `scrollViewByTag` imperative API; recommends Option V2-A (SmartScrollView wrapper + Sheet rewrite).
**Pipeline next:** Claude `mingla-implementor`.

---

## §0 Phase 0 ingestion (cited evidence)

**Operator directives ingested:**
- Rejection of v1 SPEC with explicit requirements: universal coverage, just-enough-shift, chrome stays put, sheet expands height + shifts content within.
- Clarification: "shift up the screen itself, almost like an imaginary scroll that does not exist. So just the entire screen without touching the top bar footer, etc."
- Decision: rip out ORCH-0892-A wrappers (KAV pair) — global mechanism is the single owner.
- Decision: SmartScrollView wrapper + Sheet rewrite (Option V2-A from investigation §8).

**Memory + constitution (re-read):**
- `feedback_keyboard_never_blocks_input.md` — global rule this SPEC operationalizes.
- `feedback_implementor_uses_ui_ux_pro_max.md` — pre-flight design step required if any layout perceptibly changes.
- `feedback_tester_canonical_and_platform_parity.md` — per-platform smoke required at TEST.
- `INVARIANT_REGISTRY.md` `I-PROPOSED-KEYBOARD-LIBRARY-ONLY` (DRAFT) — text updated by this SPEC to reflect KAS-based architecture; promotion DRAFT → ACTIVE still happens in ORCH-0892-C.

**Library source (re-read):**
- `node_modules/react-native-keyboard-controller/lib/typescript/hooks/index.d.ts` — `useReanimatedFocusedInput`, `useReanimatedKeyboardAnimation`, `useKeyboardState` confirmed.
- `node_modules/react-native-keyboard-controller/src/components/KeyboardAwareScrollView/index.tsx:101-300` — production-tested scroll-to-focused implementation; uses `useAnimatedRef` + worklet `scrollTo` + per-ScrollView scoping at line 166 (`layout.value?.parentScrollViewTarget !== scrollViewTarget.value` → no-op).
- `node_modules/react-native-keyboard-controller/lib/typescript/types/module.d.ts` — confirms NO `scrollViewByTag` imperative API.

**ORCH-0892-A artifacts (re-read):**
- [SPEC_ORCH-0892-A_KEYBOARD_CONTROLLER_INSTALL_AND_3_SCREEN_PILOT.md](SPEC_ORCH-0892-A_KEYBOARD_CONTROLLER_INSTALL_AND_3_SCREEN_PILOT.md) — install + wrapper indirection pattern; 3-screen pilot reference.
- [IMPLEMENTATION_ORCH-0892-A_*.md](../reports/IMPLEMENTATION_ORCH-0892-A_KEYBOARD_CONTROLLER_INSTALL_AND_3_SCREEN_PILOT.md) §17 v2 rework addendum — wrapper indirection pattern.
- QA cycle-2 retest report — empirical evidence that per-screen KAV approach left bugs.

**Repo state (verified 2026-05-20):**
- 11 v1 SPEC migration targets confirmed (4 Template A + 7 Template B from v1 §7.A) — these become trivial under v2 (just import-swap to SmartScrollView).
- 11 sheet-embedded files (v1 SPEC §7.D) confirmed — these are handled automatically by the Sheet rewrite; ZERO direct edits to these 11 files.
- 3 ORCH-0892-A pilots confirmed — they're cleaned up under v2 (KAV wraps removed; ScrollView → SmartScrollView).
- `app/_layout.tsx` `<KeyboardRoot>` mount unchanged — KeyboardProvider stays mounted at root (KAS needs it).

**Screen anatomy verified:** all 11 v1 migration targets + 3 ORCH-0892-A pilots follow the pattern `<Chrome> + <ScrollView> + <Dock>` — chrome rendered as siblings, not children, of the ScrollView. KAS scrolling within the ScrollView naturally leaves chrome stationary.

---

## §1 Goal

Replace per-screen keyboard plumbing across mingla-business with ONE rule: **screens with TextInputs use `SmartScrollView` for their main ScrollView; Sheets use `KeyboardAwareScrollView` internally.** Library handles all keyboard math (scroll the focused input above the keyboard, computed precisely from the focused input's `absoluteY + height` vs `screenHeight - keyboardHeight - bottomOffset`). Web bundle stays library-free via wrapper indirection. ORCH-0892-A's per-screen KAV pattern is torn down. The 11 sheet-embedded files inherit fixed behavior from the Sheet primitive rewrite without per-file edits. EAS-OTA eligible.

---

## §2 Cross-Surface Impact (MANDATORY)

| Surface | Touched? | User-visible change | Files touched | Parity |
|---|---|---|---|---|
| Consumer iOS (`app-mobile/`) | **NO** | None — not in scope (ORCH-0892-E deferred). | 0 | N/A |
| Consumer Android (`app-mobile/`) | **NO** | None — not in scope. | 0 | N/A |
| Buyer/anonymous Web | **YES (passthrough)** | None — `SmartScrollView.tsx` web variant re-exports `ScrollView` from `react-native` (current production behavior preserved exactly). Zero behavior delta. | All migrated files via shared component code paths | Automatic. |
| Business iOS (`mingla-business/`) | **YES (primary)** | Every form-screen + every sheet: when a TextInput is focused, the ScrollView automatically scrolls so the field's bottom edge sits exactly `bottomOffset` (12pt) above the keyboard top. Chrome (TopBar, dock, sheet header/handle) stays put. Frame-perfect (Reanimated worklet, 60fps native). | ~19 files | Automatic. |
| Business Android (`mingla-business/`) | **YES (primary)** | Same as iOS. Library KAS resolves to Android-native keyboard frame events. `windowSoftInputMode=adjustResize` (Expo default) still applies; KAS layers on top. | ~19 files | Automatic. |
| Admin Web (`mingla-admin/`) | **NO** | None — no React Native. | 0 | N/A |
| Business Web preview | **YES (passthrough)** | None — same as buyer-web. | Same as buyer-web | Automatic. |

**Parity classification:** Automatic via wrapper indirection at Metro `.tsx` vs `.native.tsx` resolution. One import statement per file; resolution is transparent.

---

## §3 Database layer

**N/A.** Zero DB / migration / RLS changes.

---

## §4 Edge functions layer

**N/A.** Zero edge function changes.

---

## §5 Services layer

**N/A.** Zero service changes.

---

## §6 Hooks layer

No new hooks beyond what the library already provides. Screens that need a `keyboardVisible` boolean for dock-hide UX import `useKeyboardState` directly from the library THROUGH A NEW WRAPPER (web safety):

### §6.1 NEW: `mingla-business/src/wrappers/useKeyboardIsVisible.ts` (web)
```ts
// ORCH-0892-B v2: useKeyboardIsVisible — web variant returns false (no soft keyboard on web).
export function useKeyboardIsVisible(): boolean {
  return false;
}
```

### §6.2 NEW: `mingla-business/src/wrappers/useKeyboardIsVisible.native.ts` (native)
```ts
// ORCH-0892-B v2: useKeyboardIsVisible — native delegates to library's useKeyboardState.
import { useKeyboardState } from "react-native-keyboard-controller";
export function useKeyboardIsVisible(): boolean {
  return useKeyboardState().isVisible;
}
```

Same pattern as ORCH-0892-A wrapper indirection — keeps `react-native-keyboard-controller` out of the web bundle.

---

## §7 Component layer

### §7.A NEW wrapper — `SmartScrollView` (the core of v2)

**`mingla-business/src/wrappers/SmartScrollView.tsx` (web variant):**
```tsx
// ORCH-0892-B v2: SmartScrollView — web variant. Passthrough re-export of
// react-native's ScrollView. Web has no soft keyboard that overlaps content;
// the library's KeyboardAwareScrollView is a no-op there. Re-exporting RN's
// ScrollView keeps the web bundle library-free (preserves ORCH-0892-A TA-1
// anchor: zero react-native-keyboard-controller strings in web bundle).
//
// Per SPEC_ORCH-0892-B_v2 §7.A. Invariant: I-PROPOSED-KEYBOARD-LIBRARY-ONLY.

export { ScrollView } from "react-native";
export type { ScrollViewProps } from "react-native";
```

**`mingla-business/src/wrappers/SmartScrollView.native.tsx` (native variant):**
```tsx
// ORCH-0892-B v2: SmartScrollView — native variant. Re-exports the library's
// KeyboardAwareScrollView as 'ScrollView' so consumers can use a single
// import name across platforms. The library implementation tracks the
// focused TextInput via useReanimatedFocusedInput and worklet-scrolls this
// ScrollView so the focused field sits exactly bottomOffset (12pt default
// here; consumers may override) above the keyboard. Chrome rendered as
// siblings of this ScrollView is unaffected (KAS only scrolls its own
// children).
//
// Per SPEC_ORCH-0892-B_v2 §7.A + library source
// node_modules/react-native-keyboard-controller/src/components/KeyboardAwareScrollView/index.tsx:101-300.
// Invariant: I-PROPOSED-KEYBOARD-LIBRARY-ONLY.

import React, { forwardRef } from "react";
import {
  KeyboardAwareScrollView,
  type KeyboardAwareScrollViewProps,
} from "react-native-keyboard-controller";
import type { ScrollView as RNScrollView } from "react-native";

export type ScrollViewProps = KeyboardAwareScrollViewProps;

// Re-export with a default bottomOffset so callers don't need to know about it.
// 12pt clearance keeps the field comfortably above the keyboard without
// scrolling further than necessary.
const DEFAULT_BOTTOM_OFFSET = 12;

export const ScrollView = forwardRef<RNScrollView, ScrollViewProps>(
  ({ bottomOffset = DEFAULT_BOTTOM_OFFSET, ...rest }, ref) => (
    <KeyboardAwareScrollView ref={ref} bottomOffset={bottomOffset} {...rest} />
  ),
);
ScrollView.displayName = "SmartScrollView";
```

**SAFELIST addition required** in `.github/scripts/strict-grep/orch-0892-no-bespoke-keyboard-plumbing.mjs`:
```js
"mingla-business/src/wrappers/SmartScrollView.native.tsx",
"mingla-business/src/wrappers/useKeyboardIsVisible.native.ts",
```

### §7.B DELETE — `KeyboardAvoidingView` wrapper pair (ORCH-0892-A obsolescence)

```
DELETE: mingla-business/src/wrappers/KeyboardAvoidingView.tsx
DELETE: mingla-business/src/wrappers/KeyboardAvoidingView.native.tsx
```

Also remove `KeyboardAvoidingView.native.tsx` from the gate SAFELIST. KAS replaces KAV functionally.

### §7.C KEEP — `KeyboardRoot` wrapper pair

`KeyboardRoot.{tsx,native.tsx}` STAY UNCHANGED. The native variant's `<KeyboardProvider>` mount is required for KAS hooks to receive keyboard events. Web variant remains a passthrough Fragment.

### §7.D ORCH-0892-A pilot teardown (3 files)

**B1. `mingla-business/src/components/brand/BrandEditView.tsx`:**
- Remove `import { KeyboardAvoidingView } from "../../wrappers/KeyboardAvoidingView"`.
- Remove `<KeyboardAvoidingView>` JSX wrap around the form ScrollView.
- Swap the inner `<ScrollView>` import from `react-native` to `import { ScrollView } from "../../wrappers/SmartScrollView"`.
- No other changes.

**B2. `mingla-business/src/components/brand/TripBrandWizard.tsx`:**
- Same as B1 — remove KAV wrap, swap ScrollView to SmartScrollView.
- KEEP `Keyboard` import for `Keyboard.dismiss()` calls (line 144).

**B3. `mingla-business/src/components/ui/CoverPicker.tsx`:**
- Same as B1 — remove KAV wrap (lines 27-50 from the v1 SPEC reference), swap ScrollView (if any) to SmartScrollView.
- The deletion of ORCH-0884 #8/#9 plumbing performed in ORCH-0892-A remains DELETED (no re-introduction).

### §7.E Sheet primitive rewrite — `mingla-business/src/components/ui/Sheet.tsx`

The high-leverage change. Current pattern (verified by reading lines 160-265):
- `Keyboard.addListener` for show/hide → sets `keyboardHeight` state.
- Clamps `sheetHeight = min(requestedSheetHeight, screenHeight - keyboardHeight - 40)`.
- `openY = -keyboardHeight` → translates whole panel up.

**Rewrite recipe:**

1. **DELETE** lines 174-194 (the `useEffect` with `Keyboard.addListener` setup + `keyboardHeight` state). Delete the `[keyboardHeight, setKeyboardHeight]` useState declaration.
2. **DELETE** the height clamp at lines 200-205: `availableHeight = keyboardHeight > 0 ? screenHeight - keyboardHeight - KEYBOARD_TOP_MARGIN : screenHeight * MAX_SNAP_RATIO`. Replace with the un-clamped form: `availableHeight = screenHeight * MAX_SNAP_RATIO`.
3. **CHANGE** `openY = -keyboardHeight` (line 210) to `openY = 0` (panel rests at its docked bottom position regardless of keyboard).
4. **WRAP** the sheet's body content in `<KeyboardAwareScrollView bottomOffset={12}>` so the focused input scrolls above the keyboard within the panel. The wrap site: wherever Sheet renders its `children` prop, wrap the children in KAS. (Read Sheet.tsx's render method around line 280-340 to identify the exact JSX site; the implementor will identify the precise insertion point.)
5. **PRESERVE** all other Sheet behavior: scrim, pan-to-dismiss, snap points, lazy-mount, unmount delay, reduce-motion handling. The only change is keyboard handling.
6. **IMPORT** `KeyboardAwareScrollView` from `react-native-keyboard-controller` directly inside Sheet.tsx (this is one of the few legitimate direct-library imports — Sheet is a SAFELIST member because it owns its own keyboard handling). Add Sheet.tsx to the strict-grep SAFELIST (it already is per ORCH-0892-A — verify it remains).

**Result:** sheet outer panel + header + handle stay at their designed snap point; only the body content scrolls internally to keep focused inputs visible above the keyboard.

**Sheet consumers (11 files from v1 SPEC §7.D) — ZERO direct edits.** They continue to pass children to Sheet; Sheet wraps them in KAS. Their existing `automaticallyAdjustKeyboardInsets` bare props on inner ScrollViews become functionally moot (KAS does the work) but harmless. Optional follow-up: a janitorial pass to delete those bare props for cleanliness — NOT required by this SPEC.

### §7.F Form-screen migrations (11 files from v1 SPEC §7.A)

For EACH of the 11 v1 migration targets, the v2 recipe is:

**Imports:**
- Replace `import { ... ScrollView ... } from "react-native"` with: keep `react-native` import but remove `ScrollView` from it; add `import { ScrollView } from "../../wrappers/SmartScrollView"` (or correct relative path per the file's depth — see §7.G table).
- If the file imports `KeyboardAvoidingView` from `react-native` or from the now-deleted wrapper: REMOVE the import.
- If the file uses `keyboardVisible` for dock-hide: ADD `import { useKeyboardIsVisible } from "../../wrappers/useKeyboardIsVisible"`.
- KEEP `Keyboard` from `react-native` if `Keyboard.dismiss()` is used (allowlisted).

**Code body:**
- DELETE every `useEffect(() => { Keyboard.addListener('keyboardWillShow', ...) ... })` block.
- DELETE the `useState<number>` for `keyboardHeight` / `keyboardPad`.
- DELETE the `useState<boolean>` for `keyboardVisible` and replace its read with `const keyboardVisible = useKeyboardIsVisible();`.
- DELETE every `paddingBottom: keyboardHeight` / `paddingBottom: keyboardPad` line in contentContainerStyle.
- DELETE every `automaticallyAdjustKeyboardInsets` prop (bare or `={true}`) on ScrollView — KAS handles this.
- DELETE any `<KeyboardAvoidingView>` JSX wrap around the form ScrollView (KAS supersedes it).

**JSX:**
- Where the old code rendered `<ScrollView ...>`, just keep it — but now it's imported from `SmartScrollView` so it's actually `KeyboardAwareScrollView` on native.
- KAS is a strict drop-in for ScrollView's prop API (plus optional `bottomOffset`, `extraKeyboardSpace`, `enabled`); existing props pass through.

### §7.G Wrapper import-path table (one row per migrating file)

| File | SmartScrollView relative import |
|------|--------------------------------|
| `app/(tabs)/marketing/campaigns/compose.tsx` | `"../../../../src/wrappers/SmartScrollView"` |
| `app/(tabs)/marketing/templates/[id].tsx` | `"../../../../src/wrappers/SmartScrollView"` |
| `app/venue/create.tsx` | `"../../src/wrappers/SmartScrollView"` |
| `app/account/delete.tsx` | `"../../src/wrappers/SmartScrollView"` |
| `app/account/edit-profile.tsx` | `"../../src/wrappers/SmartScrollView"` |
| `src/components/venue/VenueCreatorWizard.tsx` | `"../../wrappers/SmartScrollView"` |
| `src/components/trip/TripCreatorWizard.tsx` | `"../../wrappers/SmartScrollView"` |
| `src/components/auth/BusinessWelcomeScreen.tsx` | `"../../wrappers/SmartScrollView"` |
| `src/components/event/EventCreatorWizard.tsx` | `"../../wrappers/SmartScrollView"` |
| `src/components/event/EditPublishedScreen.tsx` | `"../../wrappers/SmartScrollView"` |
| `src/components/trip/EditPublishedTripScreen.tsx` | `"../../wrappers/SmartScrollView"` |
| `src/components/brand/BrandEditView.tsx` | `"../../wrappers/SmartScrollView"` (ORCH-0892-A pilot teardown) |
| `src/components/brand/TripBrandWizard.tsx` | `"../../wrappers/SmartScrollView"` (ORCH-0892-A pilot teardown) |
| `src/components/ui/CoverPicker.tsx` | `"../../wrappers/SmartScrollView"` (ORCH-0892-A pilot teardown) |

Total form-screen migrations: **14 files** (11 from v1 + 3 ORCH-0892-A pilots).

### §7.H Strict-grep gate update

`.github/scripts/strict-grep/orch-0892-no-bespoke-keyboard-plumbing.mjs` changes:

1. ADD to SAFELIST: `SmartScrollView.native.tsx`, `useKeyboardIsVisible.native.ts`.
2. REMOVE from SAFELIST: `KeyboardAvoidingView.native.tsx` (file deleted).
3. NEW pattern (4th forbidden pattern): `import\s+\{[^}]*\bScrollView\b[^}]*\}\s+from\s+["']react-native["']` — flag any `ScrollView` imported from `react-native` outside the SAFELIST. This is the universal-coverage enforcer for future screens.
4. Gate stays INFORMATIONAL in this sub-ORCH (exit 0). ORCH-0892-C promotes to BLOCK.

---

## §8 Realtime layer

**N/A.**

---

## §9 Success criteria

### §9.A Universal — visual contract (the operator's actual ask)

| SC | Surface | Criterion |
|----|---------|-----------|
| SC-CORE-iOS | business-iOS | On EVERY form-screen and EVERY Sheet with a TextInput: focus any input → the field's bottom edge sits exactly 12pt above the keyboard top within 250ms (one animation frame). Chrome (top bar, dock, sheet handle/header) does NOT visibly move. |
| SC-CORE-Android | business-Android | Same as iOS. |
| SC-CORE-web | business-web-preview | No runtime errors on cold load of any migrated screen; behavior matches pre-sweep (web wrapper is a passthrough). |

### §9.B Per-screen criteria (14 migrated screens + 11 sheet consumers via Sheet rewrite)

For EACH of the 14 form-screens AND each of the 11 Sheet consumers, the SC-CORE-iOS / Android / web triplet applies. 25 visual smoke targets total at TEST.

### §9.C Global / structural criteria

| SC | Criterion | Verification |
|----|-----------|--------------|
| SC-A | Post-sweep `node .github/scripts/strict-grep/orch-0892-no-bespoke-keyboard-plumbing.mjs` exits 0 with ZERO WARN sites (including the new "bare ScrollView from react-native" pattern). | Run the gate. |
| SC-B | Repo-wide grep: ZERO `KeyboardAvoidingView` imports outside SAFELIST. | `grep -rn "KeyboardAvoidingView" mingla-business/src mingla-business/app \| grep -v __tests__` shows only Sheet.tsx (uses KAS internally, not KAV). |
| SC-C | Repo-wide grep: ZERO `Keyboard.addListener` on layout events outside SAFELIST. | `grep -rn "Keyboard\.addListener.*keyboard\(Will\|Did\)\(Show\|Hide\)" mingla-business/src mingla-business/app \| grep -v __tests__` returns empty (Sheet.tsx no longer needs it post-rewrite). |
| SC-D | Repo-wide grep: ZERO `automaticallyAdjustKeyboardInsets` on form ScrollViews (sheet-embedded ones may retain bare prop; harmless post-Sheet-rewrite). | Manual review confirms no auto-insets in the 14 form-screens. |
| SC-E | Wrapper files `KeyboardAvoidingView.{tsx,native.tsx}` DELETED; replaced by `SmartScrollView.{tsx,native.tsx}` + `useKeyboardIsVisible.{ts,native.ts}`. | `ls mingla-business/src/wrappers/` shows correct file set. |
| SC-F | `npx tsc --noEmit` zero new errors. | tsc output. |
| SC-G | Web bundle: `grep -c "react-native-keyboard-controller" dist/_expo/static/js/web/entry-*.js` returns 0. | Operator-runnable. |
| SC-H | All 4 ORCH-0885-A desktop-web contract jest gates remain GREEN. | jest output. |
| SC-I | `KeyboardRoot` wrapper pair UNCHANGED; `KeyboardProvider` still mounted at root for KAS to receive events. | `git diff` on `_layout.tsx` + `KeyboardRoot.*.tsx` shows zero changes. |
| SC-J | All ORCH-0892-A `KeyboardRoot.test.tsx` tests still PASS (KeyboardRoot contract preserved). Tests asserting the v1 KAV-wrapper-import contract are RESPECTFULLY DEPRECATED via `[TEST-MOD-APPROVED ORCH-0892-B]` token; new SmartScrollView contract tests added in their place. | jest output + commit body. |

---

## §10 Invariants

**Preserved + updated:**
- `I-PROPOSED-KEYBOARD-LIBRARY-ONLY` (DRAFT) — text REWRITTEN by this SPEC to reflect KAS-based architecture:
  - Old text forbade `Keyboard.addListener` on layout events + `KeyboardAvoidingView` from RN + `automaticallyAdjustKeyboardInsets`.
  - NEW text additionally forbids `ScrollView` imported from `'react-native'` in any file with a `TextInput` child (enforced by the new 4th gate pattern).
  - Promotion DRAFT → ACTIVE remains ORCH-0892-C scope.
  - SAFELIST list updated to: Sheet.tsx + ComposerV2Editor.tsx + richEditor.{tsx,native.ts} + KeyboardRoot.native.tsx + SmartScrollView.native.tsx + useKeyboardIsVisible.native.ts. (KeyboardAvoidingView.native.tsx REMOVED — file deleted.)
- `I-36 ROOT-ERROR-BOUNDARY` — `_layout.tsx` untouched; KeyboardRoot mount position preserved.
- `I-PROPOSED-STRIPE-PAYMENTSHEET-PARITY` — Stripe provider mount untouched.
- ORCH-0885-A desktop-web contracts — sweep only wraps form ScrollViews; outer page layout unchanged.

**New invariant (DRAFT until ORCH-0892-C promotion):**
- `I-PROPOSED-SMART-SCROLLVIEW-WRAPPER-ONLY` — every `ScrollView` import in `mingla-business/src` and `mingla-business/app` that contains a `TextInput` child must come from `@/wrappers/SmartScrollView`, NOT from `react-native`. Enforced by the new 4th gate pattern. Carve-outs: SAFELIST files only.

---

## §11 Test cases

### §11.A Implementor happy-path test (extend `KeyboardRoot.test.tsx`)

Append a NEW `describe("ORCH-0892-B v2 — SmartScrollView wrapper + Sheet rewrite")` block. **Modification of existing tests requires `[TEST-MOD-APPROVED ORCH-0892-B]` token in commit body** (per ORCH-0840 append-only override).

```ts
describe("ORCH-0892-B v2 — SmartScrollView wrapper + Sheet rewrite", () => {
  // T-V2-WRAP-WEB: web variant re-exports ScrollView from react-native (no library import)
  it("T-V2-WRAP-WEB: SmartScrollView.tsx re-exports ScrollView from 'react-native'", () => {
    const source = read("src/wrappers/SmartScrollView.tsx");
    expect(source).toMatch(/export\s+\{\s*ScrollView\s*\}\s+from\s+["']react-native["']/);
    expect(source).not.toMatch(/from\s+["']react-native-keyboard-controller["']/);
  });

  // T-V2-WRAP-NATIVE: native variant re-exports KeyboardAwareScrollView under the name ScrollView
  it("T-V2-WRAP-NATIVE: SmartScrollView.native.tsx wraps KeyboardAwareScrollView from the library", () => {
    const source = read("src/wrappers/SmartScrollView.native.tsx");
    expect(source).toMatch(/import\s+\{[^}]*KeyboardAwareScrollView[^}]*\}\s+from\s+["']react-native-keyboard-controller["']/);
    expect(source).toMatch(/export\s+const\s+ScrollView\s*=/);
  });

  // T-V2-KAV-DELETED: ORCH-0892-A KeyboardAvoidingView wrapper pair no longer exists
  it("T-V2-KAV-DELETED: KeyboardAvoidingView wrapper files no longer exist", () => {
    expect(() => read("src/wrappers/KeyboardAvoidingView.tsx")).toThrow();
    expect(() => read("src/wrappers/KeyboardAvoidingView.native.tsx")).toThrow();
  });

  // T-V2-KROOT-PRESERVED: KeyboardRoot wrapper pair unchanged
  it("T-V2-KROOT-PRESERVED: KeyboardRoot.native.tsx still wraps KeyboardProvider", () => {
    const source = read("src/wrappers/KeyboardRoot.native.tsx");
    expect(source).toMatch(/<KeyboardProvider>\{children\}<\/KeyboardProvider>/);
  });

  // T-V2-SHEET-NO-LISTENER: Sheet primitive rewrite eliminated its layout-event Keyboard.addListener
  it("T-V2-SHEET-NO-LISTENER: Sheet.tsx no longer registers layout-event Keyboard listener", () => {
    const source = read("src/components/ui/Sheet.tsx");
    expect(source).not.toMatch(/Keyboard\.addListener\s*\(\s*["']?keyboard(Will|Did)(Show|Hide)/);
  });

  // T-V2-SHEET-USES-KAS: Sheet primitive wraps body in KeyboardAwareScrollView
  it("T-V2-SHEET-USES-KAS: Sheet.tsx imports KeyboardAwareScrollView from the library", () => {
    const source = read("src/components/ui/Sheet.tsx");
    expect(source).toMatch(/import\s+\{[^}]*KeyboardAwareScrollView[^}]*\}\s+from\s+["']react-native-keyboard-controller["']/);
    expect(source).toMatch(/<KeyboardAwareScrollView[\s\S]*>[\s\S]*\{children\}[\s\S]*<\/KeyboardAwareScrollView>/);
  });

  // T-V2-FORM-SCREENS: each of the 14 form-screen migrations imports ScrollView from SmartScrollView wrapper
  const FORM_SCREENS = [
    "app/(tabs)/marketing/campaigns/compose.tsx",
    "app/(tabs)/marketing/templates/[id].tsx",
    "app/venue/create.tsx",
    "app/account/delete.tsx",
    "app/account/edit-profile.tsx",
    "src/components/venue/VenueCreatorWizard.tsx",
    "src/components/trip/TripCreatorWizard.tsx",
    "src/components/auth/BusinessWelcomeScreen.tsx",
    "src/components/event/EventCreatorWizard.tsx",
    "src/components/event/EditPublishedScreen.tsx",
    "src/components/trip/EditPublishedTripScreen.tsx",
    "src/components/brand/BrandEditView.tsx",
    "src/components/brand/TripBrandWizard.tsx",
    "src/components/ui/CoverPicker.tsx",
  ];
  it.each(FORM_SCREENS)("T-V2-FORM: %s imports ScrollView from SmartScrollView wrapper", (path) => {
    const source = read(path);
    // Some form imports a relative path with varying depth — assert the suffix.
    expect(source).toMatch(/import\s+\{\s*ScrollView\s*\}\s+from\s+["'][^"']*wrappers\/SmartScrollView["']/);
    // No file imports ScrollView from react-native (universal rule).
    const rnImportBlock = source.match(/import\s+\{[^}]+\}\s+from\s+["']react-native["']/);
    if (rnImportBlock !== null) {
      expect(rnImportBlock[0]).not.toMatch(/\bScrollView\b/);
    }
  });

  it.each(FORM_SCREENS)("T-V2-FORM: %s no longer registers layout-event Keyboard listener", (path) => {
    const source = read(path);
    expect(source).not.toMatch(/Keyboard\.addListener\s*\(\s*["']?keyboard(Will|Did)(Show|Hide)/);
  });

  it.each(FORM_SCREENS)("T-V2-FORM: %s no longer uses automaticallyAdjustKeyboardInsets", (path) => {
    const source = read(path);
    const stripped = source.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter(l => !l.trim().startsWith("//")).join("\n");
    expect(stripped).not.toMatch(/automaticallyAdjustKeyboardInsets\s*(?:=\s*\{?\s*true|$|\s)/m);
  });

  it.each(FORM_SCREENS)("T-V2-FORM: %s no longer imports KeyboardAvoidingView from any source", (path) => {
    const source = read(path);
    expect(source).not.toMatch(/\bKeyboardAvoidingView\b/);
  });
});
```

Mark the v1 contract tests (T-03/T-03b/T-04/T-07/T-08 from ORCH-0892-A) as DEPRECATED by this SPEC; their assertions still pass on the SmartScrollView-migrated codebase, but the meaningful contract has moved to the v2 tests above. Implementor MAY delete the v1 tests (cite `[TEST-MOD-APPROVED ORCH-0892-B]`) or leave them as no-ops.

### §11.B Tester adversarial test (NEW file)

`mingla-business/src/wrappers/__tests__/KeyboardRoot.sweep.v2.adversarial.test.tsx`. Three angles different from §11.A:

- **TA-V2-1 — Repo-wide enumeration.** Walk every `.ts`/`.tsx` in `mingla-business/src` + `mingla-business/app` (excluding `__tests__` + SAFELIST). For each file containing the substring `TextInput` AND a `ScrollView`, assert the `ScrollView` import is NOT from `react-native`. Proves the sweep is COMPLETE — no future form-screen can sneak in a bare ScrollView import.
- **TA-V2-2 — Web bundle library-leak assertion.** Mirror ORCH-0892-A TA-1 — grep `dist/_expo/static/js/web/` for `react-native-keyboard-controller|KeyboardProvider|KeyboardAwareScrollView|useKeyboardState`. Assert ZERO matches. Proves SmartScrollView's wrapper indirection works (web bundle stays library-free).
- **TA-V2-3 — Sheet behavior contract.** Render `<Sheet visible onClose={()=>{}}><TextInput /></Sheet>` in a test harness; assert (a) Sheet's panel transform is NOT a function of keyboardHeight (i.e., panel doesn't translate), (b) the children are wrapped in a `KeyboardAwareScrollView` JSX element. (Source-text-grep variant if rendering is impractical in jest's node env: assert Sheet.tsx no longer contains `openY = -keyboardHeight` or equivalent.)

### §11.C Fails-on-revert (mandatory per ORCH-0840)

Implementor must:
1. Stash the SmartScrollView wrapper change for ONE form-screen (e.g., TripCreatorWizard.tsx).
2. Re-run `npx jest src/wrappers/__tests__/KeyboardRoot.test.tsx`.
3. Confirm the corresponding `T-V2-FORM` row RED.
4. Restore; confirm GREEN.
5. Cite commit hash.

Same for Sheet.tsx rewrite: stash the rewrite, confirm `T-V2-SHEET-*` rows RED, restore, confirm GREEN.

---

## §12 Implementation order

1. **Phase 0 sanity** — verify `react-native-keyboard-controller@1.18.5` still installed; verify `KeyboardRoot` wrapper pair unchanged; verify gate script structure unchanged.
2. **Write `SmartScrollView.{tsx,native.tsx}`** per §7.A verbatim.
3. **Write `useKeyboardIsVisible.{ts,native.ts}`** per §6.1/§6.2 verbatim.
4. **Update gate SAFELIST** per §7.H. Run gate; should show same WARN list as pre-sweep (sweep hasn't started touching screens yet).
5. **DELETE `KeyboardAvoidingView.{tsx,native.tsx}`** wrappers. tsc will surface any importers — those are the 3 ORCH-0892-A pilots; address in step 6.
6. **ORCH-0892-A pilot teardown** — apply §7.D recipe to BrandEditView, TripBrandWizard, CoverPicker.
7. **Form-screen migrations** — apply §7.F recipe to the 11 v1 SPEC targets, in this order:
   - BusinessWelcomeScreen (simplest — pure listener delete).
   - account/delete + account/edit-profile (pair).
   - VenueCreatorWizard + venue/create + compose + templates/[id] (Template A originals — minimal change).
   - TripCreatorWizard (Cycle 3 collapse).
   - EventCreatorWizard + EditPublishedScreen + EditPublishedTripScreen (Cycle 3 collapse).
8. **Sheet primitive rewrite** — apply §7.E recipe. Run all sheet consumer screens through visual smoke (operator-driven; tester documents).
9. **Run gate** — expect PASS (zero WARN sites including new 4th pattern).
10. **Repo-wide grep verifications** — SC-B, SC-C, SC-D.
11. **Extend `KeyboardRoot.test.tsx`** per §11.A. Cite `[TEST-MOD-APPROVED ORCH-0892-B]` in commit body.
12. **Run jest** — `npx jest src/wrappers/__tests__/KeyboardRoot.test.tsx src/wrappers/__tests__/KeyboardRoot.adversarial.test.tsx` — all GREEN.
13. **Run tsc** — zero new errors on touched files.
14. **Run 4 ORCH-0885-A desktop-web contract gates** — STAY GREEN.
15. **Fails-on-revert** — perform §11.C protocol on 2 files (1 form-screen + Sheet rewrite). Cite commit hashes.
16. **Implementor report** — `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0892-B_v2_*.md` with per-file old→new receipts, per-template change counts, tsc + jest output, fails-on-revert commit hashes, EAS OTA command.
17. **HANDOFF to tester** — Claude `mingla-tester` for TA-V2-1/2/3 + per-screen + per-Sheet operator-driven sim smoke.

---

## §13 Regression prevention

The sweep IS the regression prevention. Mechanism:

1. AFTER sweep close, every form-screen + every Sheet uses the library's production-tested KAS. The library handles all keyboard math; we no longer maintain per-screen plumbing.
2. The strict-grep gate gains a 4th pattern ("bare ScrollView from react-native in form files") that catches ANY new form-screen introducing the old pattern. Currently INFORMATIONAL; ORCH-0892-C flips to BLOCK.
3. The adversarial TA-V2-1 test walks the entire repo and fails CI on any new file violating the rule.
4. The Sheet primitive is the single owner of sheet keyboard handling; new Sheet consumers inherit fixed behavior automatically.
5. `feedback_keyboard_never_blocks_input.md` + I-PROPOSED-KEYBOARD-LIBRARY-ONLY + I-PROPOSED-SMART-SCROLLVIEW-WRAPPER-ONLY codify the architecture.

---

## §14 Hard guards

1. **NO `app-mobile/` touches.** Zero diffs under `app-mobile/`. (ORCH-0892-E port deferred.)
2. **NO Supabase / DB / edge-function / migration changes.**
3. **NO library version bump.** v1.18.5 stays. Reanimated 4.1.1, RN 0.81.5, Expo 54 locked.
4. **NO gate mode flip** (INFORMATIONAL → BLOCK is ORCH-0892-C).
5. **NO invariant promotion** (DRAFT → ACTIVE is ORCH-0892-C). This SPEC's invariant text edits are documentation-only.
6. **NO desktop-web contract regression.** All 4 ORCH-0885-A jest gates STAY GREEN.
7. **NO `_layout.tsx` change.** KeyboardRoot mount position preserved.
8. **PRESERVE `Keyboard.dismiss()` calls.** Allowlisted under invariant.
9. **PRESERVE all non-keyboard Sheet behavior** (scrim, pan-gesture, snap points, lazy-mount, reduce-motion).
10. **EAS-OTA eligible.** Pure JS swap + Sheet body rewrite. No native dep change. Implementor report must include `eas update --branch production --platform ios,android --message "ORCH-0892-B v2 global keyboard avoidance"`.
11. **`[TEST-MOD-APPROVED ORCH-0892-B]` token** in commit body — sweep extends `KeyboardRoot.test.tsx` and may deprecate some v1 contract tests.
12. **Operator-driven per-screen visual smoke acceptable for PASS.** Tester writes adversarial completeness tests; operator does per-screen + per-Sheet sim smoke. 14 form screens + 11 Sheet consumers = 25 smoke targets at TEST.
13. **Implementor invokes `/ui-ux-pro-max` pre-flight** for the Sheet rewrite (visible behavior change for ALL sheets) and for any screen where the layout perceptibly changes post-wrap.
14. **NO Sheet-consumer direct edits.** The 11 sheet-embedded files from v1 SPEC §7.D are NOT touched in this sub-ORCH. Sheet rewrite fixes them automatically. Janitorial cleanup of their bare `automaticallyAdjustKeyboardInsets` props is a follow-up (optional ORCH-0892-Bx).

---

## §15 ORCH-0888 [Fabric breaks legacy ScrollResponder] supersession verdict

Implementor report MUST include §16 "ORCH-0888 supersession verdict" naming whether CoverPicker GIPHY search behaves correctly post-sweep (KAS replaces the old ORCH-0884 #8/#9 path). If GIPHY search field is fully visible above keyboard when focused → ORCH-0888 SUPERSEDED. If still issues → ORCH-0888 REMAINS OPEN with specific failure mode.

---

## §16 Open follow-ups (orchestrator queue, NOT this SPEC)

1. **ORCH-0892-C** [gate promotion + invariant promote] — flip gate INFORMATIONAL → BLOCK; promote BOTH invariants DRAFT → ACTIVE. Next immediate.
2. **ORCH-0892-Bx (optional)** — janitorial pass to delete bare `automaticallyAdjustKeyboardInsets` props from the 11 sheet-embedded files (functionally moot post-Sheet-rewrite; cleanup-only).
3. **ORCH-0892-By (optional)** — runbook docs update for IOS_DEV_BUILD_REBUILD_RUNBOOK.md (Sentry env var) per DISC-QA-0892-A-RETEST-2-1.
4. **ORCH-0892-D** [composer migration cleanup] — deferred.
5. **ORCH-0892-E** [`app-mobile/` port] — deferred until 1+ week clean signal post-B.
6. **ORCH-0888** — verdict per §15.
7. **ORCH-0896** — Stripe `forwardRef` RedBox per DISC-QA-0892-A-RETEST-2-2.

---

## §17 Layman summary

ORCH-0892-A fixed the keyboard-covers-the-field bug on 3 pilot screens by wrapping each one in a "keyboard-avoiding view." That worked but missed many screens. v1 of this SPEC proposed migrating 11 more screens the same way — operator rightly rejected because "you'll keep missing screens."

The v2 fix changes the strategy: instead of wrapping each screen individually, we replace the standard `<ScrollView>` component (the building block every form screen already uses) with a "smart" version that automatically scrolls so the focused field stays above the keyboard. ONE rule, one wrapper file, applied via a mechanical find-replace across 14 files. New screens that import the wrapper inherit the behavior for free. The CI gate (already shipped in ORCH-0892-A) gets a new check that fails CI if any future screen imports the plain `<ScrollView>` from React Native in a form file — so missed screens become structurally impossible.

For Sheets (popup panels with text inputs): we rewrite the Sheet primitive itself. Instead of sliding the WHOLE sheet panel up when the keyboard appears (current behavior — moves the title bar too), the Sheet body becomes a smart scrollable area that scrolls just the content. Sheet header + handle bar stay put; only the body inside shifts. This matches your "expand the sheet height + shift the content within" intuition exactly. ALL 11 sheet consumer screens get this fix for free with ZERO direct edits — they inherit from the Sheet primitive.

The result: every text input across mingla-business — in main screens AND in sheets — automatically shifts above the keyboard with frame-perfect 60fps animation. Chrome (top bar, dock, sheet header) stays still. Web behavior is unchanged. Total scope: ~19 files touched, but ALL mechanical (find-replace) plus 1 Sheet rewrite. EAS OTA eligible — no app store wait. After this ships, ORCH-0892-C flips the CI gate from "warn" to "fail" so this bug class can never sneak back in.
