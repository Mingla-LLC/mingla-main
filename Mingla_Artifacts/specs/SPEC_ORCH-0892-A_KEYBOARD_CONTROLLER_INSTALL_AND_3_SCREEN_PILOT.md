# SPEC — ORCH-0892-A [`react-native-keyboard-controller` install + root `.web.tsx` passthrough + 3-screen pilot on mingla-business]

**Mode:** SPEC (forensics). **Severity:** S2-medium. **Classification:** `architecture-flaw` + `design-debt` + `ux` cleanup.
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
**Date:** 2026-05-20.
**Inputs:** Investigation `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0892_KEYBOARD_AVOIDANCE_LIBRARY_PILOT.md` + dispatch `Mingla_Artifacts/prompts/SPEC_ORCH-0892-A_KEYBOARD_CONTROLLER_INSTALL_AND_3_SCREEN_PILOT.md`.

---

## §0 — Phase 0 ingestion confirmation

**Investigation read in full** (the primary input — assumed in-context; cited per finding).

**Source files read in full this SPEC turn:**
- `mingla-business/src/payments/StripeProviderWrapper.tsx` (14 lines — web passthrough Fragment; the contract is literally `<>{children}</>`)
- `mingla-business/src/payments/StripeProviderWrapper.native.tsx` (27 lines — native wraps `<StripeNativeProvider merchantIdentifier="..." urlScheme="...">{children}</StripeNativeProvider>`)
- `mingla-business/src/components/marketing/ComposerV2/richEditor.tsx` lines 1-50 (web side — Tiptap-backed editor mounted on web post-ORCH-0891 [Marketing Hub Premium Composer]; SSR-safe; no module-load `window` references)
- `mingla-business/src/components/marketing/ComposerV2/richEditor.native.ts` lines 1-43 (native side — re-exports `react-native-pell-rich-editor`; the file exists specifically to avoid pell's module-load `${window.__DEV__}` crash on Expo's SSR pass)
- `mingla-business/src/components/brand/BrandEditView.tsx` lines 20-37 (import block — `KeyboardAvoidingView` imported from `'react-native'` line 27) + lines 415-430 (the KAV wrap at line 419 with `behavior={Platform.OS === "ios" ? "padding" : "height"}`)
- `mingla-business/src/components/brand/TripBrandWizard.tsx` lines 20-34 (import block — both `Keyboard` and `KeyboardAvoidingView` imported from `'react-native'`; only KAV is used here per grep) + lines 225-235 (the KAV wrap at line 230 with `behavior={Platform.OS === "ios" ? "padding" : undefined}`)
- `.github/scripts/strict-grep/orch-0861-sibling-scrollview-flexgrow-zero.mjs` lines 1-80 (template for the new gate — INFORMATIONAL mode, allowlist via top-level `// ORCH-NNNN-OK:` comment, exit 0 always)
- `Mingla_Artifacts/INVARIANT_REGISTRY.md` tail (latest entry I-PROPOSED-BV REALTIME-TABLE-IN-PUBLICATION-OR-NO-SUBSCRIPTION post-ORCH-0854 — establishes the I-PROPOSED-XX naming convention this SPEC's new invariant follows)
- `mingla-business/app/_layout.tsx` lines 1-252 (already in investigation context — re-confirmed mount-position decision below)
- `mingla-business/package.json` lines 19-41 (the `test:orch-XXXX` script naming convention — `test:orch-0892` follows the same shape as `test:orch-0885-a`)

**Library docs already in context** from investigation: `react-native-keyboard-controller` v1.21.7, MIT, peer-deps `react: *` / `react-native: *` / `react-native-reanimated: >=3.0.0`, no web entry point, FabricExample folder confirms Fabric supported, runtime dep `react-native-is-edge-to-edge: ^1.2.1`.

**Phase 0 verification of DISC-0892-1:** `find Mingla_Artifacts -iname "*0888*"` re-run this turn — still returns ZERO files. ORCH-0888 [Fabric breaks legacy ScrollResponder; InputAccessoryView for CoverPicker search] SPEC and INVESTIGATION artifacts are still NOT on disk under their WORLD_MAP-cited paths. This SPEC does NOT block on the gap; documented at §16.

---

## §1 — Goal, scope, decisions inherited from operator

### Goal
Install `react-native-keyboard-controller` v1.21.7 in `mingla-business/`, wrap the app at the root via Metro `.web.tsx` passthrough (mirroring StripeProviderWrapper precedent), migrate three pilot screens off bespoke keyboard plumbing, ship an informational strict-grep CI gate for future sweep enforcement, and produce evidence that supports a yes/no decision on whether ORCH-0888 [Fabric breaks legacy ScrollResponder] is superseded or must ship separately.

### Operator decisions locked at INTAKE (2026-05-19)
- **Q1 = A** — Pause ORCH-0888 implementor dispatch. ORCH-0892-A's CoverPicker pilot tries to supersede it.
- **Q2 = default** — Keep CoverPicker (`mingla-business/src/components/ui/CoverPicker.tsx`) as the 3rd pilot screen. It's the highest-value test ("does the library handle the hardest case we have").
- **Q3 = default** — Use Metro `.web.tsx` passthrough. Mirror `StripeProviderWrapper.{tsx,native.tsx}`.
- **Q4 = default** — Defer `ComposerV2Editor` (Carve-out CO-2 from investigation) migration to ORCH-0892-D [composer migration cleanup].
- **Q5 = default** — Defer `app-mobile/` port to ORCH-0892-E [consumer port] after 1+ week of clean signal post-ORCH-0892-B [sweep].

### Scope (this SPEC, ORCH-0892-A ONLY)
1. Install library (`npx expo install react-native-keyboard-controller`).
2. Create wrapper files `mingla-business/src/wrappers/KeyboardRoot.tsx` + `KeyboardRoot.native.tsx`.
3. Modify `mingla-business/app/_layout.tsx` mount position.
4. Migrate BrandEditView (clean KAV swap).
5. Migrate TripBrandWizard (clean KAV swap).
6. Migrate CoverPicker (KAV wrap + delete dead ORCH-0884 follow-up #8 + #9 patches).
7. Update 5 CoverPicker caller files to remove `parentScrollRef` + `keyboardScrollExtraOffset` props.
8. Ship informational strict-grep gate `.github/scripts/strict-grep/orch-0892-no-bespoke-keyboard-plumbing.mjs` + workflow job + `test:orch-0892` npm script.
9. Add I-PROPOSED-KEYBOARD-LIBRARY-ONLY entry to INVARIANT_REGISTRY (DRAFT status).
10. Implementor happy-path jest test at `mingla-business/src/wrappers/__tests__/KeyboardRoot.test.tsx`.

### Non-goals (out of scope)
- Sweeping remaining ~24 surfaces (that's ORCH-0892-B [sweep]).
- Promoting CI gate WARN → BLOCK (that's ORCH-0892-C [gate promotion]).
- Migrating Sheet primitive translateY (CO-1 carve-out; would double-translate).
- Migrating ComposerV2Editor (CO-2 carve-out; fixed-height body for pell).
- Migrating richEditor / pell WebView (CO-3 carve-out; WebView sandbox).
- Any `app-mobile/` change (ORCH-0892-E).
- Version bumps for Expo / RN / Reanimated.
- Resolving DISC-0892-1 ORCH-0888 artifact gap (orchestrator backfill decision).
- Any change to the 16 desktop-web contracts post-ORCH-0885-A [Desktop Tier 1 — Container + Side Rail].

### Assumptions (verified in §0 reads where possible; flagged for implementor verification otherwise)
- **A1** — Library v1.21.7 imports cleanly with Reanimated 4.1.1. **Verification gate at implementor Step 1:** if `npx expo install` errors or the first `<KeyboardProvider>` mount throws a worklets-module resolution error, STOP and escalate to operator before proceeding.
- **A2** — Library's `<KeyboardAvoidingView>` is a drop-in replacement for `react-native`'s `KeyboardAvoidingView` (same props: `behavior`, `keyboardVerticalOffset`, `enabled`, `style`). **Verification gate at implementor Step 5/6:** post-migration smoke must show BrandEditView + TripBrandWizard keyboard behavior identical to pre-migration.
- **A3** — CoverPicker's GIPHY/Pexels search input visibility above keyboard works via `<KeyboardAvoidingView behavior="padding">` wrapping the search-row + results ScrollView. **Verification gate at tester:** if pilot smoke shows search cursor still covered by keyboard or autocomplete bar on iOS, ORCH-0888 is NOT superseded — implementation report MUST state this in §15 documentation, and ORCH-0888 ships separately as a follow-up.

---

## §2 — Cross-Surface Impact (MANDATORY §2.5)

| Surface | In scope? | User-visible behavior | File paths | Parity (auto/manual) |
|---|---|---|---|---|
| **business-iOS** | YES (primary) | KeyboardRoot.native wraps app; library handles BrandEditView + TripBrandWizard + CoverPicker via native module; CoverPicker GIPHY/Pexels search input visible above keyboard (the ORCH-0888 case) | `app/_layout.tsx`, `src/wrappers/KeyboardRoot.native.tsx`, 3 pilot files + 5 CoverPicker callers | Automatic — same code as Android |
| **business-Android** | YES (parity) | Same as iOS; library claims identical iOS+Android behavior via its native module managing softInputMode | Same files | Automatic — verify in tester smoke; if Android differs, treat as P0 (library promise broken) |
| **business-web-preview** | YES (passthrough) | `KeyboardRoot.tsx` web variant is `<>{children}</>`; library not loaded; browser handles keyboard via viewport behavior; BrandEditView + TripBrandWizard + CoverPicker render normally on Chrome with no console errors | `src/wrappers/KeyboardRoot.tsx` | Manual — separate code path; tester verifies no crash on cold-load + zero `react-native-keyboard-controller` strings in web bundle |
| **buyer-anon-web** (`/checkout/{eventId}`, `/e/{brandSlug}/{eventSlug}`, `/b/{brandSlug}`, `/o/{orderId}`, `/t/{token}`) | YES (passthrough INHERITED) | Same root layout → same KeyboardRoot wrap → same web passthrough; no behavior change | Same `app/_layout.tsx` mount, same `KeyboardRoot.tsx` | Manual — tester verifies one buyer-anon route cold-load (e.g., `/checkout/test-event-id`) does not crash; web bundle inspection same as business-web-preview |
| **consumer-iOS** (`app-mobile/`) | NO | n/a | n/a | Reason: different codebase; deferred to ORCH-0892-E IF this ORCH lands cleanly |
| **consumer-Android** | NO | n/a | n/a | Reason: same |
| **admin-web** (`mingla-admin/`) | NO | n/a | n/a | Reason: React+Vite, no React Native, library doesn't apply |

**Per-surface success criteria are listed in §9** with surface-suffixed numbering (SC-1-iOS / SC-1-Android / SC-1-web etc.).

---

## §3 — Database layer

**N/A.** Zero DB changes. No migrations. No schema. No RLS. No edge functions. No `supabase db push`. No edge function deploys.

---

## §4 — Edge function layer

**N/A.**

---

## §5 — Service layer

**N/A.**

---

## §6 — Hook layer

**N/A.**

---

## §7 — Component layer

### 7.1 — New file: `mingla-business/src/wrappers/KeyboardRoot.tsx` (web variant — passthrough)

**File contents (verbatim — implementor copies):**

```tsx
// ORCH-0892-A: KeyboardRoot — web passthrough. Mirrors the
// StripeProviderWrapper.tsx precedent at src/payments/. The library
// react-native-keyboard-controller has NO web entry point in its
// package.json — mounting <KeyboardProvider> on web would at minimum
// log "module not found" under Metro and at worst throw on native
// module resolution. Metro picks this file on web; native picks
// KeyboardRoot.native.tsx. Browsers handle keyboard avoidance via
// viewport behavior — no library needed.
//
// Per SPEC_ORCH-0892-A §7.1. Invariant: I-PROPOSED-KEYBOARD-LIBRARY-ONLY
// (DRAFT — flips ACTIVE on ORCH-0892-C close).

import React from "react";

export const KeyboardRoot: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => <>{children}</>;
```

### 7.2 — New file: `mingla-business/src/wrappers/KeyboardRoot.native.tsx` (native variant — real provider)

**File contents (verbatim — implementor copies):**

```tsx
// ORCH-0892-A: KeyboardRoot — native variant. Wraps app in
// <KeyboardProvider> from react-native-keyboard-controller so every
// downstream <KeyboardAvoidingView> / <KeyboardAwareScrollView> /
// <KeyboardStickyView> primitive can subscribe to the native keyboard
// frame events at 60fps. Mirrors StripeProviderWrapper.native.tsx
// precedent. Metro picks this file on iOS + Android.
//
// Per SPEC_ORCH-0892-A §7.2. Invariant: I-PROPOSED-KEYBOARD-LIBRARY-ONLY.

import React from "react";
import { KeyboardProvider } from "react-native-keyboard-controller";

export const KeyboardRoot: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => <KeyboardProvider>{children}</KeyboardProvider>;
```

**Notes:**
- No props on `<KeyboardProvider>` for v1 — library defaults are correct (`statusBarTranslucent`, `navigationBarTranslucent` are Android-specific knobs that conflict with `edgeToEdgeEnabled: true` in `app.json:40` if set wrong; leaving them library-default is safe per docs review).
- File-extension naming MUST match StripeProviderWrapper exactly: `.tsx` (web/default) + `.native.tsx` (iOS/Android). Metro resolves `.native.tsx` on `Platform.OS !== "web"`.

### 7.3 — Modify `mingla-business/app/_layout.tsx`

**Current state (lines 227-251):**

```tsx
export default function RootLayout(): React.ReactElement {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <StripeProviderWrapper>
              <RootLayoutInner />
            </StripeProviderWrapper>
          </AuthProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
```

**New state (mount KeyboardRoot INSIDE StripeProviderWrapper, OUTSIDE RootLayoutInner):**

```tsx
import { KeyboardRoot } from "../src/wrappers/KeyboardRoot";  // ADD this import

// ...

export default function RootLayout(): React.ReactElement {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <StripeProviderWrapper>
              {/* ORCH-0892-A: KeyboardRoot wraps every downstream
                  surface so react-native-keyboard-controller primitives
                  can subscribe to native keyboard events. Web variant
                  is a passthrough Fragment (library has no web entry
                  point). Mounted INSIDE StripeProviderWrapper because
                  Stripe's PaymentSheet has its own iOS keyboard
                  handling that should NOT be wrapped by the library;
                  PaymentSheet renders via UIViewController bypassing
                  the React tree. Mounted OUTSIDE RootLayoutInner
                  (i.e., OUTSIDE the ErrorBoundary defined at line 207)
                  because (a) the library is native-module-backed and a
                  failure to resolve the module is a developer build
                  problem that should crash early, not be caught by the
                  user-facing ErrorBoundary, and (b) on web the wrapper
                  is a Fragment so this position is moot.
                  Per SPEC_ORCH-0892-A §7.3. */}
              <KeyboardRoot>
                <RootLayoutInner />
              </KeyboardRoot>
            </StripeProviderWrapper>
          </AuthProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
```

**Mount-position rationale (locked decision):**
- INSIDE `<StripeProviderWrapper>` because Stripe's native PaymentSheet renders via UIViewController outside React tree; the library doesn't need to wrap it.
- OUTSIDE `<RootLayoutInner>` (which contains the `<ErrorBoundary>`) so that a library-resolution failure (developer build broken; missing native module) crashes at the provider boundary instead of being swallowed by the user-facing error UI. On web this is moot — KeyboardRoot is a Fragment.

### 7.4 — Migrate `mingla-business/src/components/brand/BrandEditView.tsx`

**Change 1 (line 27):** swap import source.

Current:
```tsx
import {
  Image as RNImage,
  KeyboardAvoidingView,         // ← line 27
  Platform,
  // ...
} from "react-native";
```

New:
```tsx
import {
  Image as RNImage,
  Platform,
  // ...
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";  // ADD new import line
```

**Change 2 (line 419 — KAV usage):** no JSX change required. The library's `<KeyboardAvoidingView>` accepts the same `behavior={Platform.OS === "ios" ? "padding" : "height"}` prop. ScrollView wrapping inside remains untouched.

**Total diff:** ~3 lines (move `KeyboardAvoidingView` out of the `react-native` import block, add new import line from library).

### 7.5 — Migrate `mingla-business/src/components/brand/TripBrandWizard.tsx`

**Change 1 (line 26):** swap import source. Same shape as §7.4.

Current:
```tsx
import {
  Keyboard,
  KeyboardAvoidingView,         // ← line 26
  Platform,
  // ...
} from "react-native";
```

New:
```tsx
import {
  Keyboard,                     // KEEP — used elsewhere in this file? Verify and remove if unused.
  Platform,
  // ...
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
```

**Change 2 (line 230 — KAV usage):** no JSX change required. Library KAV accepts the same `behavior={Platform.OS === "ios" ? "padding" : undefined}` prop.

**Implementor verification step:** confirm whether the `Keyboard` import on line 25 is still used after migration. If unused, remove. If used (for any non-listener purpose — e.g., `Keyboard.dismiss()`), keep.

**Total diff:** ~3 lines.

### 7.6 — Migrate `mingla-business/src/components/ui/CoverPicker.tsx` (the hardest case — ORCH-0888 supersession test)

This is the most complex pilot migration. The current file has TWO layered keyboard patches that both must be DELETED:

**Delete block 1: ORCH-0884 follow-up #9 dead scroll-on-focus** (lines 209-243):
- Remove the comment block "ORCH-0884 follow-up #9 — explicit scroll-on-focus..." (lines 209-216)
- Remove `const searchInputRef = useRef<TextInput | null>(null);` (line 217)
- Remove the entire `handleSearchFocus` callback (lines 218-243)
- This block calls `scrollResponderScrollNativeHandleToKeyboard` which is a Fabric-broken Paper-era API per ORCH-0888 investigation — it silently no-ops under `newArchEnabled: true`.

**Delete block 2: ORCH-0884 follow-up #8 spacer** (lines 245-271):
- Remove the comment block "ORCH-0884 follow-up #8 — operator-reported..." (lines 245-254)
- Remove `const [keyboardHeight, setKeyboardHeight] = useState<number>(0);` (line 255)
- Remove the entire `useEffect` with `Keyboard.addListener` (lines 256-271)

**Delete block 3: 400pt spacer JSX** (lines 649-653):
- Remove the JSX block:
  ```tsx
  {keyboardHeight > 0 && supportsSearch ? (
    <View style={{ height: keyboardHeight + 400 }} pointerEvents="none" />
  ) : null}
  ```

**Prop deletions from `CoverPickerProps` interface** (lines 116-127):
- Remove the comment block "ORCH-0884 follow-up #9 — optional parent ScrollView ref..." (lines 116-122)
- Remove `parentScrollRef?: React.RefObject<ScrollView | null>;` (line 123)
- Remove the comment block "Extra pixels to scroll above the input bottom..." (lines 124-126)
- Remove `keyboardScrollExtraOffset?: number;` (line 127)

**Destructure deletions** (lines 146-147):
- Remove `parentScrollRef,` and `keyboardScrollExtraOffset = 80,` from the destructured props in the function signature.

**Import deletions** (lines 30-43):
- Remove `findNodeHandle,` from the `react-native` import block (line 32)
- Remove `Keyboard,` from the `react-native` import block (line 34) — if not used elsewhere; verify by grep before deletion.
- Remove `type KeyboardEvent,` from the `react-native` import block (line 35) — same.
- Keep `ScrollView`, `TextInput`, `Pressable`, etc. — all still used.

**JSX wrap addition** (around lines 561-647 — the search section):
- Wrap the `{supportsSearch ? (...) : null}` block in `<KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={0}>` from the library.

New JSX structure:
```tsx
import { KeyboardAvoidingView } from "react-native-keyboard-controller";  // NEW import

// ... rest of component ...

{supportsSearch ? (
  <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={0}>
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>Find a cover</Text>
      {/* ... existing search row + results ScrollView ... */}
    </View>
  </KeyboardAvoidingView>
) : null}
```

**TextInput ref deletion** (line 583):
- Remove `ref={searchInputRef}` from the TextInput.
- Remove `onFocus={handleSearchFocus}` from the TextInput (line 596).

**NET LINE COUNT:** approximately 30 fewer lines than current Seth HEAD.

### 7.7 — Update 5 CoverPicker callers (remove `parentScrollRef` + `keyboardScrollExtraOffset` props)

For each of the following caller files, search for `<CoverPicker ` and remove any of these props passed to it: `parentScrollRef={...}`, `keyboardScrollExtraOffset={...}`. Also remove the corresponding `scrollViewRef` declarations + `useRef` calls if they exist solely to feed CoverPicker (keep them if they have other consumers).

**Files to update:**
1. `mingla-business/src/components/event/EventCreatorWizard.tsx` — remove prop passing to CoverPicker via the wizard's scrollViewRef chain. Verify whether `scrollViewRef` has other consumers (likely yes for the Cycle 3 wizard root pattern — keep the ref, just remove the prop passing to CoverPicker).
2. `mingla-business/src/components/event/CreatorStep4Cover.tsx` — the direct CoverPicker consumer; remove props.
3. `mingla-business/src/components/trip/TripCreatorWizard.tsx` — same wizard-side pattern; remove prop chain to CoverPicker.
4. `mingla-business/src/components/trip/TripCreatorStep1Basics.tsx` — direct consumer; remove props.
5. `mingla-business/src/components/event/EditPublishedScreen.tsx` — verify whether it uses CoverPicker; if yes, remove props.
6. `mingla-business/src/components/trip/EditPublishedTripScreen.tsx` — same.
7. `mingla-business/src/components/event/types.ts` — remove any shared type field for `parentScrollRef` / `keyboardScrollExtraOffset` if defined here.

**Implementor verification:** post-deletion, `grep -rn "parentScrollRef\|keyboardScrollExtraOffset" mingla-business/src/ mingla-business/app/` MUST return ZERO matches. Tester adversarial check TA-3 enforces this.

### 7.8 — Add `test:orch-0892` npm script to `mingla-business/package.json`

Insert AFTER the existing `test:orch-0885-a` entry (the last entry in the `scripts` block):

```json
    "test:orch-0892": "node ../.github/scripts/strict-grep/orch-0892-no-bespoke-keyboard-plumbing.mjs && npx jest src/wrappers/__tests__/KeyboardRoot.test.tsx"
```

### 7.9 — New CI gate file: `.github/scripts/strict-grep/orch-0892-no-bespoke-keyboard-plumbing.mjs`

INFORMATIONAL mode (exit 0 always). Mirrors the `orch-0861-sibling-scrollview-flexgrow-zero.mjs` structure verbatim. See §13 for the gate-grammar contract.

### 7.10 — Wire new job into `.github/workflows/strict-grep-mingla-business.yml`

Append a new job mirroring the `orch-0861-sibling-scrollview-flexgrow-zero` job shape. One job, one script, per `feedback_strict_grep_registry_pattern.md`.

### 7.11 — Add invariant entry to `Mingla_Artifacts/INVARIANT_REGISTRY.md`

Append a new section per the I-PROPOSED-XX naming convention. See §10.

### 7.12 — Update `.github/scripts/strict-grep/README.md` "Active gates registered" table

Add row: `I-PROPOSED-KEYBOARD-LIBRARY-ONLY (DRAFT) — orch-0892-no-bespoke-keyboard-plumbing.mjs — Forbid Keyboard.addListener / react-native KeyboardAvoidingView / automaticallyAdjustKeyboardInsets outside allowlist (INFORMATIONAL until ORCH-0892-C promotion)`.

---

## §8 — Realtime layer

**N/A.**

---

## §9 — Success criteria (per-surface where parity is manual)

| ID | Surface | Criterion | How verified |
|---|---|---|---|
| **SC-1-iOS** | business-iOS | BrandEditView form usable on iPhone sim; tap any TextInput → keyboard rises → input visible above keyboard with no overlap | Tester live-fire on iPhone 17 Pro sim UDID `17091E60-C3B6-4167-980D-60C348E177F6` |
| **SC-1-Android** | business-Android | Same on Android emulator (Pixel 6 API 34 or operator-preferred AVD) | Tester live-fire on Android emu |
| **SC-1-web** | business-web-preview | BrandEditView renders on Chrome at `localhost:8081/brand/<brandId>/edit` without console errors | Tester Chrome DevTools console capture + screenshot |
| **SC-2-iOS** | business-iOS | TripBrandWizard form usable; keyboard rise/dismiss does not cause layout jump | Tester live-fire iOS sim |
| **SC-2-Android** | business-Android | Same on Android emu | Tester live-fire Android emu |
| **SC-2-web** | business-web-preview | TripBrandWizard renders on Chrome without console errors | Tester Chrome capture |
| **SC-3-iOS** | business-iOS | CoverPicker GIPHY/Pexels search input + cursor visible above keyboard AND autocomplete bar (the ORCH-0888 case) — NO scrollResponder call, NO 400pt spacer, library handles it | Tester live-fire iOS sim with reproducer: open event-create wizard → Step 4 Cover → tap GIPHY search → confirm cursor visible above iOS keyboard suggestions bar |
| **SC-3-Android** | business-Android | Same on Android emu | Tester live-fire Android emu |
| **SC-3-web** | business-web-preview | CoverPicker renders on Chrome; search works via browser default focus behavior | Tester Chrome capture |
| **SC-4** | buyer-anon-web | Cold-load of `localhost:8081/checkout/<test-event-id>` does NOT crash; web bundle inspection shows ZERO `react-native-keyboard-controller` strings | Tester runs `cd mingla-business && npx expo export --platform web` then `grep -c "react-native-keyboard-controller" dist/_expo/static/js/web/*.js` — expect ZERO |
| **SC-5** | All | All 4 existing desktop-web contract jest gates remain GREEN post-migration | `npm run test:orch-0885-a && npx jest src/components/__tests__/wizardDesktopLayout.test.ts && npx jest src/utils/__tests__/homeKpiPresentation.test.ts && npx jest src/hooks/__tests__/useResponsiveLayout.test.ts` |
| **SC-6** | CI | New `test:orch-0892` strict-grep gate exits 0 (INFORMATIONAL mode); WARN lines printed for the ~24 non-migrated surfaces are EXPECTED (they ship in ORCH-0892-B sweep) | `npm run test:orch-0892` |
| **SC-7** | jest | New `KeyboardRoot.test.tsx` passes — both web and native variants verified | `npx jest src/wrappers/__tests__/KeyboardRoot.test.tsx` |
| **SC-8** | Step 0.5 | Implementor happy-path regression test PASS with `fails-on-revert verified at <commit hash>` line in implementation report | Implementor stashes the migration in CoverPicker, re-runs test, confirms RED, restores, re-runs, confirms GREEN |
| **SC-9** | tsc | Zero new tsc errors in touched files vs Seth HEAD baseline | `cd mingla-business && npx tsc --noEmit` — count new errors in 3 pilot files + 5 caller files + 2 wrapper files + _layout.tsx; expect 0 |
| **SC-10** | docs | Implementation report at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0892-A_*.md` documents the iOS dev-build rebuild step per `IOS_DEV_BUILD_REBUILD_RUNBOOK.md` with the recipe applied | Implementor pastes the rebuild output (xcodebuild + embed-frameworks + codesign sequence) into the report |
| **SC-11** | ORCH-0888 verdict | Implementation report §15 explicitly states whether ORCH-0888 is SUPERSEDED (library handles CoverPicker case) or REMAINS OPEN (library doesn't sufficiently handle, must ship separately) | Implementor writes one of two specific paragraphs in report §15; tester verifies the claim via SC-3-iOS evidence |

---

## §10 — Invariants

### NEW invariant (DRAFT — flips ACTIVE on ORCH-0892-C [gate promotion] close)

**I-PROPOSED-KEYBOARD-LIBRARY-ONLY** — All keyboard-avoidance code in `mingla-business/` MUST flow through `react-native-keyboard-controller` primitives. The following patterns are FORBIDDEN outside the explicit allowlist:

- `Keyboard.addListener('keyboard(Will|Did)(Show|Hide)', ...)` for layout-affecting purposes (i.e., to drive `paddingBottom`, `translateY`, or similar layout effects). `Keyboard.dismiss()` and other non-listener Keyboard API calls remain permitted.
- Import of `KeyboardAvoidingView` from `'react-native'` — must import from `'react-native-keyboard-controller'` instead.
- `automaticallyAdjustKeyboardInsets={true}` prop on any ScrollView or its forks.

**Allowlist (hardcoded SAFELIST inside the gate script):**
- `mingla-business/src/components/ui/Sheet.tsx` — Sheet primitive owns sheet-hosted keyboard via translateY (Carve-out CO-1; would double-translate if library wrapped sheet-hosted inputs).
- `mingla-business/src/components/marketing/ComposerV2/ComposerV2Editor.tsx` — Carve-out CO-2; fixed-height body shrink for pell rich-editor tap reliability.
- `mingla-business/src/components/marketing/ComposerV2/richEditor.native.ts` — Carve-out CO-3; WebView sandbox.
- `mingla-business/src/components/marketing/ComposerV2/richEditor.tsx` — Carve-out CO-3; Tiptap web variant.
- `mingla-business/src/wrappers/KeyboardRoot.native.tsx` — the library mount itself (legitimate library import).

**Per-file inline comment exemption** (Layer 2 allowlist): `// orch-strict-grep-allow orch-0892 — <reason>` placed within 3 lines of the offending pattern suppresses the WARN. Mirrors `// ORCH-0861-OK:` and `// REALTIME-INERT-OK:` conventions.

**EXIT condition:** Permanent. The gate stays in place; allowlist evolves per future ORCHs that add legitimate exceptions (each requires a new SPEC + operator approval per `feedback_strict_grep_registry_pattern.md`).

### Existing invariants this SPEC must preserve

| Invariant | Source | Preservation check |
|---|---|---|
| I-13 native Modal portal contract | Sheet.tsx header | Sheet.tsx is NOT modified by this SPEC; CO-1 carve-out keeps Sheet's own keyboard logic intact |
| I-SUB-SHEET-INSIDE-PARENT | `feedback_rn_sub_sheet_must_render_inside_parent.md` | KeyboardRoot wrapping does NOT change sub-sheet rendering — wrapping happens at root level, sub-sheet JSX placement contract is per-file |
| I-PROPOSED-STRIPE-PAYMENTSHEET-PARITY (ORCH-0849) | `app/_layout.tsx:34-40` comments | KeyboardRoot mounts INSIDE StripeProviderWrapper; Stripe's PaymentSheet renders via UIViewController bypassing React tree and thus the library — no interaction |
| I-DESKTOP-GATE-VIA-HOOK + I-NO-BOTTOMNAV-OUTSIDE-LAYOUT (ORCH-0885-A) | `feedback_mingla_business_desktop_web_contracts.md` | Library is web-disabled; desktop-web layout untouched; the 4 jest gates must pass per SC-5 |
| I-36 ROOT-ERROR-BOUNDARY | `app/_layout.tsx:5-8` header | KeyboardRoot mounts OUTSIDE the ErrorBoundary deliberately — library-resolution failures are dev-build problems, not user-facing errors |
| I-RN-COLOR-FORMATS | `feedback_rn_color_formats.md` | N/A — library renders no colors |
| I-PROPOSED-J Zustand-no-server-snapshots | `feedback_zustand_persist_no_server_snapshots.md` | N/A — library uses no Zustand |
| I-REGRESSION-TEST-BACKFILL-WARN | ORCH-0840 [Regression-test enforcement + append-only CI] | ORCH-0892-A SHIPS regression tests per Step 0.5; not BACKFILL-EXEMPT |
| I-CHIP-BACKSPACE-VIA-DOM-HANDLER + I-TIPTAP-WEB-ONLY (ORCH-0891) | richEditor headers | richEditor untouched by this SPEC — CO-3 carve-out |
| I-PROPOSED-BV REALTIME-TABLE-IN-PUBLICATION-OR-NO-SUBSCRIPTION (ORCH-0854) | INVARIANT_REGISTRY tail | N/A — no realtime subscriptions touched |

---

## §11 — Test cases

### T-01 through T-05 — Implementor happy-path tests (`KeyboardRoot.test.tsx` + integration smoke)

Path: `mingla-business/src/wrappers/__tests__/KeyboardRoot.test.tsx`.

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| **T-01** | Web variant renders children unchanged | Mount `KeyboardRoot` (via web alias) wrapping `<Text testID="child">child</Text>` | `getByTestId("child")` resolves; React tree does NOT contain `KeyboardProvider` element | Wrappers |
| **T-02** | Native variant wraps children in `KeyboardProvider` | Mount `KeyboardRoot.native` via direct `.native.tsx` import + `Platform.OS = "ios"` mock | `getByTestId("child")` resolves; React tree contains a `KeyboardProvider` element wrapping the child | Wrappers |
| **T-03** | BrandEditView migration uses library KAV | Render `<BrandEditView>` with mock brand; inspect tree | The `KeyboardAvoidingView` element in the tree comes from `react-native-keyboard-controller`, NOT from `react-native` | Component-level integration |
| **T-04** | CoverPicker no longer exposes `parentScrollRef` / `keyboardScrollExtraOffset` props | Type-check `<CoverPicker parentScrollRef={ref} keyboardScrollExtraOffset={80} ...other valid props.../>` | tsc reports "Property 'parentScrollRef' does not exist on type 'CoverPickerProps'" (and same for `keyboardScrollExtraOffset`) | tsc / interface |
| **T-05** | Fails-on-revert verification | Stash the BrandEditView import-swap (revert to `from 'react-native'`); re-run T-03 | T-03 FAILS (assertion finds library KAV but tree has react-native KAV instead) | Implementor must capture this in implementation report with commit hash |

### T-06 through T-08 — Tester adversarial tests (`KeyboardRoot.adversarial.test.tsx`)

Path: `mingla-business/src/wrappers/__tests__/KeyboardRoot.adversarial.test.tsx`. Tester authors AFTER implementor returns — different angle than T-01..T-05.

| Test | Scenario | Input | Expected | Angle attacked |
|---|---|---|---|---|
| **TA-1** | Web bundle does NOT include library strings | After `cd mingla-business && npx expo export --platform web`, read every `dist/_expo/static/js/web/*.js` and search for `react-native-keyboard-controller` | Zero matches | Proves `.web.tsx` passthrough actually prevents native module bundling — DIFFERENT angle than T-01 (which checks React tree, not bundle output) |
| **TA-2** | Provider mount-order preservation | Inspect `app/_layout.tsx` AST; verify `<KeyboardRoot>` is rendered INSIDE `<StripeProviderWrapper>` and OUTSIDE `<RootLayoutInner>` | AST assertion: `KeyboardRoot` is a direct child of `StripeProviderWrapper`'s children; `KeyboardRoot`'s child is `<RootLayoutInner />` | Proves I-36 + I-PROPOSED-STRIPE-PAYMENTSHEET-PARITY both preserved per §10 — DIFFERENT angle than T-02 (which only verifies presence of `KeyboardProvider`, not mount position) |
| **TA-3** | CoverPicker prop-deletion completeness | grep `mingla-business/src/ mingla-business/app/` for `parentScrollRef` AND `keyboardScrollExtraOffset` | Zero matches anywhere in the repo | Proves the 5-caller cleanup is COMPLETE (not just one or two files migrated) — DIFFERENT angle than T-04 (which only checks the interface, not callers) |

**Both tests immutable** per ORCH-0840 [Regression-test enforcement + append-only CI] append-only enforcement.

---

## §12 — Implementation order (17 sequential steps)

1. `cd /Users/sethogieva/Desktop/mingla-main/mingla-business && npx expo install react-native-keyboard-controller`. Verify one entry added to `package.json` `dependencies` block + lockfile updated. Verify transitive dep `react-native-is-edge-to-edge` is auto-added. **Verification gate A1:** if install errors, STOP and escalate.
2. Create `mingla-business/src/wrappers/` directory (if not exists).
3. Create `mingla-business/src/wrappers/KeyboardRoot.tsx` per §7.1 (verbatim content).
4. Create `mingla-business/src/wrappers/KeyboardRoot.native.tsx` per §7.2 (verbatim content).
5. Modify `mingla-business/app/_layout.tsx` per §7.3 — add `KeyboardRoot` import + wrap `<RootLayoutInner />`.
6. Migrate `mingla-business/src/components/brand/BrandEditView.tsx` per §7.4 — swap KAV import line 27.
7. Migrate `mingla-business/src/components/brand/TripBrandWizard.tsx` per §7.5 — swap KAV import line 26, verify Keyboard import retention.
8. Migrate `mingla-business/src/components/ui/CoverPicker.tsx` per §7.6 — delete 3 blocks + remove 2 props from interface + add JSX wrap + add library import.
9. Update 5 CoverPicker callers per §7.7. Verify post-edit `grep -rn "parentScrollRef\|keyboardScrollExtraOffset" mingla-business/src/ mingla-business/app/` returns ZERO matches.
10. Write `mingla-business/src/wrappers/__tests__/KeyboardRoot.test.tsx` per §11 (T-01 through T-05).
11. Write `.github/scripts/strict-grep/orch-0892-no-bespoke-keyboard-plumbing.mjs` per §13 — INFORMATIONAL mode (exit 0 always); mirror `orch-0861-sibling-scrollview-flexgrow-zero.mjs` structure.
12. Wire new job into `.github/workflows/strict-grep-mingla-business.yml` mirroring `orch-0861` job shape.
13. Add `test:orch-0892` npm script to `mingla-business/package.json` per §7.8.
14. Append I-PROPOSED-KEYBOARD-LIBRARY-ONLY entry to `Mingla_Artifacts/INVARIANT_REGISTRY.md` per §10 (DRAFT status; flips ACTIVE on ORCH-0892-C close).
15. Update `.github/scripts/strict-grep/README.md` "Active gates registered" table per §7.12.
16. Run all gates locally:
    ```bash
    cd mingla-business
    npm run test:orch-0892       # new gate — expect exit 0 with WARN lines for non-migrated sites
    npm run test:orch-0885-a     # desktop contract gate — expect exit 0
    npx jest src/wrappers/__tests__/KeyboardRoot.test.tsx
    npx jest src/components/__tests__/wizardDesktopLayout.test.ts
    npx jest src/utils/__tests__/homeKpiPresentation.test.ts
    npx jest src/hooks/__tests__/useResponsiveLayout.test.ts
    npx tsc --noEmit             # expect 0 new errors in touched files
    ```
    All MUST pass. Capture output to implementation report.
17. Operator runs iOS dev-build rebuild per `Mingla_Artifacts/IOS_DEV_BUILD_REBUILD_RUNBOOK.md` (native module → no EAS OTA possible for ORCH-0892-A). Implementor pastes the rebuild output into the implementation report per SC-10.
18. (Implementor writes the report at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0892-A_KEYBOARD_CONTROLLER_INSTALL_AND_3_SCREEN_PILOT.md` with old→new diffs + test results + fails-on-revert verification + iOS dev-build rebuild log + §15 ORCH-0888 verdict.)

---

## §13 — Regression prevention (CI gate grammar contract)

### File: `.github/scripts/strict-grep/orch-0892-no-bespoke-keyboard-plumbing.mjs`

**Mode:** INFORMATIONAL (exit 0 always — prints WARN lines).
**Promotion path:** ORCH-0892-C [gate promotion] flips exit 1 on violation after sweep completes.
**Template:** Mirror `orch-0861-sibling-scrollview-flexgrow-zero.mjs` verbatim for scaffolding (header doc, walkTsxFiles helper, REPO_ROOT resolution, SKIP_DIRS set, allowlist comment scan).

**Forbidden patterns (3 categories):**

1. **`Keyboard.addListener` with layout-affecting events**
   Regex: `Keyboard\s*\.\s*addListener\s*\(\s*['"]?(keyboard(Will|Did)(Show|Hide))['"]?`
   Scope: `.ts` + `.tsx` files in `mingla-business/src/` + `mingla-business/app/`
   Suggested fix in WARN: `"Use useReanimatedKeyboardAnimation or useKeyboardHandler from react-native-keyboard-controller for layout-affecting keyboard reads, or wrap parent in <KeyboardAvoidingView from 'react-native-keyboard-controller'>."`

2. **`KeyboardAvoidingView` imported from `'react-native'`**
   Regex: heuristic — match line containing both `KeyboardAvoidingView` AND `from 'react-native'` (or `"react-native"`); be permissive on multi-line imports (look ahead/behind for the `from` clause within 10 lines).
   Suggested fix: `"Import KeyboardAvoidingView from 'react-native-keyboard-controller' — drop-in replacement with frame-perfect native animation."`

3. **`automaticallyAdjustKeyboardInsets` prop**
   Regex: `automaticallyAdjustKeyboardInsets\s*=\s*\{?\s*true`
   Suggested fix: `"Wrap parent in <KeyboardAwareScrollView from 'react-native-keyboard-controller'> — automaticallyAdjustKeyboardInsets is iOS-only and fragile in nested layouts."`

**Allowlist (Layer 1 — hardcoded SAFELIST const inside the script):**

```js
const SAFELIST = new Set([
  "mingla-business/src/components/ui/Sheet.tsx",
  "mingla-business/src/components/marketing/ComposerV2/ComposerV2Editor.tsx",
  "mingla-business/src/components/marketing/ComposerV2/richEditor.native.ts",
  "mingla-business/src/components/marketing/ComposerV2/richEditor.tsx",
  "mingla-business/src/wrappers/KeyboardRoot.native.tsx",
]);
```

**Allowlist (Layer 2 — per-file inline comment):** within 3 lines of the offending match, accept `// orch-strict-grep-allow orch-0892 — <reason>` to suppress. Mirror the regex used by `orch-0861`.

**Output shape:** WARN lines in format `[ORCH-0892 WARN] <relative-path>:<line> — <pattern category>: <line content> → <suggested fix>`. Print summary at end with total WARN count.

**Self-test (operator-runnable):**

```bash
node .github/scripts/strict-grep/orch-0892-no-bespoke-keyboard-plumbing.mjs --self-test
```

Self-test mode runs the gate against an inline fixture (clean / violation / allowlisted) and asserts the gate identifies the violation, ignores the allowlisted file, and reports zero on the clean fixture. Exit 0 on self-test pass.

---

## §14 — Hard guards (carry into implementation)

1. **No `app-mobile/` touches.** Zero diffs under `app-mobile/`. If implementor finds themselves editing app-mobile, STOP and escalate.
2. **No Supabase migrations.** No DB changes; no `supabase db push`; no edge function deploys.
3. **No carve-out migrations.** Do NOT modify Sheet.tsx (CO-1), ComposerV2Editor.tsx (CO-2), richEditor.{native.ts,tsx} (CO-3). These are explicit SAFELIST entries.
4. **No version bumps.** Library install adds ONE new dependency. Do NOT bump Expo / RN / Reanimated.
5. **No desktop-web contract regression.** All 4 desktop contract jest gates per SC-5 MUST stay GREEN. If any fail post-migration, implementation is REJECTED.
6. **No silent failures.** If `npx expo install` errors at Step 1, STOP and surface to operator. Do not work around with manual `npm install`.
7. **No deletion outside scope.** CoverPicker prop-chain cleanup is the only deletion. Do NOT delete unrelated code, even if it looks dead.
8. **`/ui-ux-pro-max` pre-flight only if visible UI design changes.** BrandEditView + TripBrandWizard are pure import swaps (no visible change). CoverPicker JSX wrap MAY cause a small visual shift around the search row — implementor SHOULD invoke `/ui-ux-pro-max` if the JSX wrap changes layout perceptibly, per `feedback_implementor_uses_ui_ux_pro_max.md`. If the wrap is layout-neutral, exempt.
9. **No Maestro / osascript live-fire from implementor.** Implementor runs only `npm run` / `npx jest` / `npx tsc` / `npx expo install` / `npx expo export`. Sim live-fire belongs to tester per `feedback_tester_canonical_and_platform_parity.md`.
10. **Implementation report MUST include the ORCH-0888 verdict (§15 of report)**, per SC-11.

---

## §15 — ORCH-0888 verdict documentation requirement

The implementation report's §15 section "ORCH-0888 supersession verdict" MUST be one of two exact paragraph templates:

**Template SUPERSEDED:**
> ORCH-0888 [Fabric breaks legacy ScrollResponder; InputAccessoryView for CoverPicker search] is SUPERSEDED by this implementation. CoverPicker GIPHY/Pexels search input + cursor visibility above the iOS keyboard + autocomplete bar is achieved via `<KeyboardAvoidingView from 'react-native-keyboard-controller' behavior="padding">` wrapping the search row at `mingla-business/src/components/ui/CoverPicker.tsx:<line>`. Live-fire repro on iPhone 17 Pro sim UDID `17091E60-C3B6-4167-980D-60C348E177F6` per SC-3-iOS confirmed: search input visible above keyboard, cursor visible above autocomplete bar, no overlap. Recommend orchestrator close ORCH-0888 via supersession in CLOSE protocol Step 5 (Deprecation extension) — write the supersession memo + remove ORCH-0888 from PRIORITY_BOARD active queue. No further work needed for the original bug class.

**Template REMAINS OPEN:**
> ORCH-0888 [Fabric breaks legacy ScrollResponder; InputAccessoryView for CoverPicker search] is NOT superseded by this implementation. Live-fire repro on iPhone 17 Pro sim UDID `17091E60-C3B6-4167-980D-60C348E177F6` per SC-3-iOS revealed: <specific failure mode — e.g., "search input top visible but cursor still under autocomplete bar", or "input lifts on initial focus but drops back on subsequent character input">. Library's `<KeyboardAvoidingView behavior="padding">` is insufficient for the CoverPicker search-with-autocomplete-bar case. Recommend orchestrator UNPAUSE ORCH-0888 implementor dispatch per the original SPEC (InputAccessoryView with `inputAccessoryViewID` on the search TextInput). ORCH-0892-A still ships independently — CoverPicker prop chain cleanup + library wrap remain valuable; ORCH-0888 fix is additive on top.

Tester verifies the chosen template against SC-3-iOS evidence (screenshot + Metro logs from the sim live-fire). If template SUPERSEDED is claimed but tester cannot reproduce input + cursor visibility, the QA verdict is FAIL with P0 finding "false supersession claim".

---

## §16 — Open follow-up registrations (for orchestrator queue)

These are NOT in ORCH-0892-A scope but the SPEC documents them so the orchestrator can queue / track:

- **ORCH-0892-B [sweep]** — migrate remaining ~24 surfaces (every `Keyboard.addListener` / `KeyboardAvoidingView` / `automaticallyAdjustKeyboardInsets` site EXCEPT the 5 SAFELIST entries). EAS-OTA-eligible. ~25 files. Queue immediately after ORCH-0892-A close.
- **ORCH-0892-C [gate promotion]** — flip `orch-0892-no-bespoke-keyboard-plumbing.mjs` from exit 0 to exit 1; lock allowlist; flip I-PROPOSED-KEYBOARD-LIBRARY-ONLY from DRAFT → ACTIVE. BACKFILL-EXEMPT. Queue after ORCH-0892-B close.
- **ORCH-0892-D [composer migration]** — optional cosmetic upgrade migrating ComposerV2Editor's `Keyboard.addListener` + body-height-shrink to library's `useReanimatedKeyboardAnimation` hook. Operator-discretionary; not required.
- **ORCH-0892-E [`app-mobile/` port]** — port the library + sweep pattern to `app-mobile/`. Queue after ORCH-0892-B is live 1+ week with clean operator signal.
- **DISC-0892-1** (operator decision) — ORCH-0888 [Fabric breaks legacy ScrollResponder] SPEC artifact is NOT findable on disk under WORLD_MAP-cited path. Either backfill the artifact retroactively or ratify the missing-artifact pattern as acceptable for sub-ORCH follow-ups.
- **DISC-0892-2** (operator decision) — ORCH-0884 follow-up #3–#9 reports are not on disk. Same backfill-or-ratify decision.

---

## §17 — Layman summary for operator

This SPEC says: install one new library called `react-native-keyboard-controller` in mingla-business, wrap the app at the root in a thin shell that's a no-op on web (using the same `.web.tsx` pattern we already use for Stripe), then migrate three pilot screens (BrandEditView, TripBrandWizard, CoverPicker) off their current keyboard plumbing. The first two migrations are one-line import changes — swap `KeyboardAvoidingView` from `react-native` to `react-native-keyboard-controller`. The third (CoverPicker) is the harder case: we DELETE ~30 lines of dead/broken patches from ORCH-0884 [keyboard handling regression] follow-ups #8 and #9 (the scrollResponder call that doesn't work under Fabric, the 400pt spacer hack, the prop-chain across 5 caller files) and replace them with a library `<KeyboardAvoidingView behavior="padding">` wrap around the search section. If that single wrap fixes the GIPHY/Pexels search-input-covered-by-keyboard bug, ORCH-0888 [Fabric breaks legacy ScrollResponder] is dead — we close it via supersession and skip the separate InputAccessoryView fix. If it doesn't, we ship ORCH-0892-A as-is and let ORCH-0888 ship as a follow-up.

This is NOT EAS OTA — the library is a native module, so you'll need to do the iOS dev-build rebuild dance from `IOS_DEV_BUILD_REBUILD_RUNBOOK.md` once before testing on the sim. Web preview + buyer-anon-web routes are protected by the `.web.tsx` passthrough — they'll behave identically to today (browser keyboard, no library).

We also ship a new strict-grep CI gate in WARN-only mode that catches future bespoke keyboard plumbing — it prints warnings without failing the build. ORCH-0892-B sweep migrates the remaining ~24 screens; ORCH-0892-C then flips this gate to BLOCK mode. After all three sub-ORCHs land, mingla-business has exactly one keyboard-avoidance mechanism, the per-screen plumbing is gone, and adding a new input field is one line of JSX (wrap in the library's KAV) instead of the current ceremony.

Confidence: HIGH on the install + the BrandEditView/TripBrandWizard migrations (they're literally import line swaps). MEDIUM on whether the CoverPicker library wrap fixes the GIPHY search case — that's the empirical test this pilot exists to run.
