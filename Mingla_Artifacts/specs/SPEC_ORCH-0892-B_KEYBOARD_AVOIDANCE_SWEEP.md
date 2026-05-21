# SPEC — ORCH-0892-B [App-wide keyboard avoidance sweep — migrate remaining mingla-business surfaces to the wrapper KAV]

> **SUPERSEDED 2026-05-20** by [SPEC_ORCH-0892-B_v2_SMART_SCROLLVIEW_AND_SHEET_REWRITE.md](SPEC_ORCH-0892-B_v2_SMART_SCROLLVIEW_AND_SHEET_REWRITE.md). Operator rejected the per-screen template approach below ("this will not work… so many places you are missing out") and chose Option V2-A: SmartScrollView wrapper + Sheet primitive rewrite. See [INVESTIGATION_ORCH-0892-B_v2_GLOBAL_SHIFTER.md](../reports/INVESTIGATION_ORCH-0892-B_v2_GLOBAL_SHIFTER.md) for the architectural rationale. Read the v2 SPEC for the binding contract. This file is kept for historical traceability only.

**Author:** Claude `mingla-forensics` (SPEC mode).
**Date written:** 2026-05-20.
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
**Dispatch:** `Mingla_Artifacts/prompts/SPEC_ORCH-0892-B_KEYBOARD_AVOIDANCE_SWEEP.md`.
**Pipeline next:** Claude `mingla-implementor`.

---

## §0 Phase 0 ingestion (cited evidence)

**Memory + constitution (read):**
- `feedback_keyboard_never_blocks_input.md` — the rule this sweep operationalizes app-wide: "every TextInput across mingla-business + app-mobile must remain visible above the keyboard when focused."
- `feedback_strict_grep_registry_pattern.md` — the gate registry pattern (gate already shipped via ORCH-0892-A; this sweep does NOT modify it).
- `Mingla_Artifacts/INVARIANT_REGISTRY.md` `I-PROPOSED-KEYBOARD-LIBRARY-ONLY` (DRAFT) — the invariant this sub-ORCH brings closer to ACTIVE state. Promotion happens in ORCH-0892-C, NOT here.

**Prior ORCH-0892 artifacts (read):**
- [INVESTIGATION_ORCH-0892_KEYBOARD_AVOIDANCE_LIBRARY_PILOT.md](../reports/INVESTIGATION_ORCH-0892_KEYBOARD_AVOIDANCE_LIBRARY_PILOT.md) — confirmed library compatibility on Expo 54 + RN 0.81.5 + Reanimated 4.1.1 + Fabric ON; carve-out list (Sheet, ComposerV2Editor, richEditor) is canonical.
- [SPEC_ORCH-0892-A_KEYBOARD_CONTROLLER_INSTALL_AND_3_SCREEN_PILOT.md](../specs/SPEC_ORCH-0892-A_KEYBOARD_CONTROLLER_INSTALL_AND_3_SCREEN_PILOT.md) §7.4/§7.5/§7.6 — canonical migration recipe (post-v2 wrapper indirection); this SPEC mirrors that pattern byte-for-byte.
- [IMPLEMENTATION_ORCH-0892-A_*.md](../reports/IMPLEMENTATION_ORCH-0892-A_KEYBOARD_CONTROLLER_INSTALL_AND_3_SCREEN_PILOT.md) §17 v2 rework addendum — the wrapper indirection pattern (`mingla-business/src/wrappers/KeyboardAvoidingView.{tsx,native.tsx}`) is the SINGLE entry point; no file imports KAV from the library directly.
- QA cycle-2 retest report — operator's empirical observation that EventCreatorWizard Step 1 + TripCreatorWizard Step 1 still exhibit the cursor-above-but-field-below bug class (the urgency driver for this sweep).

**Source code reads (verbatim recipe references):**
- `mingla-business/src/wrappers/KeyboardAvoidingView.tsx` → web re-export `from "react-native"` (passthrough — works on react-native-web, pre-ORCH-0892 production behavior preserved).
- `mingla-business/src/wrappers/KeyboardAvoidingView.native.tsx` → native re-export `from "react-native-keyboard-controller"`.
- `mingla-business/src/components/brand/BrandEditView.tsx` lines 27-39 — clean-KAV-swap reference (Template A authority).
- `mingla-business/src/components/brand/TripBrandWizard.tsx` lines 25-38 — KAV-swap-with-`Keyboard.dismiss()`-retained reference (allowlist for non-listener Keyboard API).
- `mingla-business/src/components/ui/CoverPicker.tsx` lines 27-50 + 498-588 — JSX-wrap reference (Template B JSX shape authority).
- `mingla-business/src/components/ui/Sheet.tsx` lines 167-262 — Sheet primitive's OWN `Keyboard.addListener` + `translateY = -keyboardHeight` math (the reason 11 sheet-embedded files are NOT migrated — they would double-translate).

**CI gate output (run by spec writer at 2026-05-20):**
- `node .github/scripts/strict-grep/orch-0892-no-bespoke-keyboard-plumbing.mjs` → **8 WARN sites**: 5× KAV-from-RN (`compose.tsx`, `templates/[id].tsx`, `venue/create.tsx`, `TripCreatorWizard.tsx`, `VenueCreatorWizard.tsx`); 3× Keyboard.addListener (`account/delete.tsx`, `account/edit-profile.tsx`, `BusinessWelcomeScreen.tsx`). Gate exits 0 (INFORMATIONAL).

**Repo-wide grep (run by spec writer):**
- `Keyboard.addListener` on layout events → 3 standalone (gate-flagged) + 4 hidden (gate stopped at KAV match): TripCreatorWizard, EventCreatorWizard, EditPublishedScreen, EditPublishedTripScreen.
- `automaticallyAdjustKeyboardInsets` → 17 files; 11 are inside `<Sheet>` (DO NOT MIGRATE — SAFELIST adjacency); 6 are standalone screens (already in Template B because they also have Keyboard.addListener); the gate matches bare `={true}` only — every standalone screen uses BARE prop form, which the gate misses.

**Authoritative migration target count:** **11 files** (4 Template A + 7 Template B). **11 sheet-embedded files NOT MIGRATED** (rationale §7.D).

---

## §1 Goal

Sweep every mingla-business screen with bespoke keyboard plumbing onto the wrapper KAV established by ORCH-0892-A, EXCEPT files rendered inside `<Sheet>` (Sheet primitive owns keyboard handling per CO-1 carve-out adjacency). Drive the strict-grep gate WARN list from 8 → 0 AND drive the auto-insets-on-Cycle-3-screens count from 4 → 0. Preserve dock-hide UX (uses `keyboardVisible` boolean) via a NEW `useKeyboardIsVisible` wrapper hook that mirrors the KeyboardAvoidingView wrapper-indirection pattern (web variant returns `false`; native variant delegates to library). No version bumps, no gate-script changes, no `app-mobile/` touches.

---

## §2 Cross-Surface Impact (MANDATORY)

| Surface | Touched? | User-visible behavior change | Files touched | Parity |
|---|---|---|---|---|
| Consumer iOS (`app-mobile/`) | **NO** | None — not in scope (ORCH-0892-E port deferred). | 0 | N/A |
| Consumer Android (`app-mobile/`) | **NO** | None — not in scope. | 0 | N/A |
| Buyer/anonymous Web (`mingla-business/`) | **YES (passthrough)** | None — wrapper `.tsx` variant re-exports `react-native`'s built-in KAV which has been the production behavior on web pre-ORCH-0892. ZERO behavior delta on web. | All 11 (via shared component code paths) | Automatic (wrapper resolves to RN KAV on web). |
| Business iOS (`mingla-business/`) | **YES (primary)** | Every migrated screen gets frame-perfect KAV: focused TextInput always visible above iOS keyboard with no overlap, no manual padding math, no listener jank. Dock hide on keyboard show preserved via wrapper hook. | 11 + 1 new wrapper hook pair | Automatic via wrapper resolution. |
| Business Android (`mingla-business/`) | **YES (primary)** | Same as iOS — library KAV resolves to Android native keyboard frame events. | 11 | Automatic. |
| Admin Web (`mingla-admin/`) | **NO** | None — no React Native; admin uses HTML/Tailwind. | 0 | N/A |
| Business Web preview (`mingla-business/` dev/web) | **YES (passthrough)** | None — same as buyer-web; wrapper resolves to RN KAV on web. | 11 | Automatic. |

**Parity classification:** Automatic. The wrapper pair handles per-platform resolution at Metro `.tsx` vs `.native.tsx` resolution time. Implementor writes ONE import statement per file; resolution is transparent.

**Per-screen success criteria** are written per-surface in §9 below (SC-{screen}-iOS / SC-{screen}-Android / SC-{screen}-web triplets per the orchestrator INTAKE Cross-Surface Impact rule).

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

**ONE new wrapper hook pair** — required to preserve `keyboardVisible`-driven dock-hide UX in 6 of 7 Template B files while keeping the keyboard-controller library out of the web bundle.

### §6.1 New: `mingla-business/src/wrappers/useKeyboardIsVisible.ts` (web variant)

```ts
// ORCH-0892-B: useKeyboardIsVisible — web variant. Returns false always.
//
// Web has no soft keyboard show/hide event that requires UI to translate
// or hide. Hardware keyboards on web are always present; dock-hide UX
// on Cycle 3 wizard root pattern was iOS/Android-only. Returning a
// constant false here keeps the bundle small (zero library imports)
// and matches pre-ORCH-0892 web behavior (no dock-hide on web).
//
// Per SPEC_ORCH-0892-B §6.1. Invariant: I-PROPOSED-KEYBOARD-LIBRARY-ONLY.

export function useKeyboardIsVisible(): boolean {
  return false;
}
```

### §6.2 New: `mingla-business/src/wrappers/useKeyboardIsVisible.native.ts` (native variant)

```ts
// ORCH-0892-B: useKeyboardIsVisible — native variant. Delegates to the
// library's useKeyboardState hook, returning the isVisible boolean.
//
// Mirrors the KeyboardAvoidingView wrapper indirection: consumers
// import from THIS wrapper, not the library directly, so Metro keeps
// the library out of the web bundle.
//
// Per SPEC_ORCH-0892-B §6.2. Invariant: I-PROPOSED-KEYBOARD-LIBRARY-ONLY.

import { useKeyboardState } from "react-native-keyboard-controller";

export function useKeyboardIsVisible(): boolean {
  return useKeyboardState().isVisible;
}
```

**Why this is the cleanest replacement for the dock-hide pattern:**

- Existing pattern: `const [keyboardVisible, setKeyboardVisible] = useState(false); useEffect(() => { Keyboard.addListener('keyboardWillShow', () => setKeyboardVisible(true)); ... });` — 8-12 lines per file × 6 files = ~50-70 LOC deleted.
- New pattern: `const keyboardVisible = useKeyboardIsVisible();` — 1 line per file.
- Web bundle: zero library leak (web variant has no library import).
- Native bundle: `useKeyboardState` is part of the library that's already shipped via ORCH-0892-A — no new native dependency.
- EAS OTA eligible — pure JS wrapper change.

**SAFELIST addition required** in `.github/scripts/strict-grep/orch-0892-no-bespoke-keyboard-plumbing.mjs`:

```js
// ORCH-0892-B: additional native-variant wrapper. The .ts (web) variant
// has no library import. The .native.ts variant legitimately imports
// useKeyboardState from the library.
"mingla-business/src/wrappers/useKeyboardIsVisible.native.ts",
```

> Note: adding ONE filename to the SAFELIST is permitted under ORCH-0892-B even though §9 Hard Guards forbids "gate-script changes." The forbidden gate-script changes are mode-flip (INFORMATIONAL → BLOCK) and SAFELIST mechanism rewrite — those are ORCH-0892-C scope. Adding a single new wrapper to the existing SAFELIST array is mechanically equivalent to the ORCH-0892-A precedent that added `KeyboardAvoidingView.native.tsx` (lines 69-72 of the current gate). Implementor includes this 1-line addition in the same diff as the new wrapper file.

---

## §7 Component layer

### §7.A Migration target list (CANONICAL)

**Template A — pure KAV-from-RN → wrapper-KAV swap** (4 files; ~1-line import change each):

| # | File | Current KAV import line | Cycle-3 listener? |
|---|------|------------------------|-------------------|
| A1 | `mingla-business/app/(tabs)/marketing/campaigns/compose.tsx` | line 41 (destructured from RN) | NO |
| A2 | `mingla-business/app/(tabs)/marketing/templates/[id].tsx` | line 17 (destructured from RN) | NO |
| A3 | `mingla-business/app/venue/create.tsx` | line 7 (destructured from RN) | NO |
| A4 | `mingla-business/src/components/venue/VenueCreatorWizard.tsx` | line 7 (destructured from RN) | NO |

**Template B — Cycle 3 wizard root collapse** (7 files; delete listener + state + manual padding math + auto-inset prop; if file uses `keyboardVisible` for dock-hide, replace with `useKeyboardIsVisible()` hook; wrap form ScrollView in wrapper-KAV):

| # | File | Listener lines | KAV present? | Uses `keyboardVisible`? | Uses `keyboardHeight`? | Has auto-insets? |
|---|------|---------------|--------------|------------------------|------------------------|------------------|
| B1 | `mingla-business/src/components/trip/TripCreatorWizard.tsx` | 402, 406 | YES (line 1083, from RN) | YES (2 refs) | YES (3 refs) | NO |
| B2 | `mingla-business/app/account/delete.tsx` | 105 (+ second) | NO | YES (2 refs) | NO | YES line 232 |
| B3 | `mingla-business/app/account/edit-profile.tsx` | 115 (+ second) | NO | YES (2 refs) | NO | YES line 315 |
| B4 | `mingla-business/src/components/auth/BusinessWelcomeScreen.tsx` | 268, 271 | NO | NO (uses `keyboardPad` state for paddingBottom only) | NO (uses `keyboardPad`) | NO |
| B5 | `mingla-business/src/components/event/EventCreatorWizard.tsx` | per grep (2 calls) | NO direct | YES (2 refs) | YES (9 refs) | YES line 896 (bare) |
| B6 | `mingla-business/src/components/event/EditPublishedScreen.tsx` | per grep (2 calls) | NO | YES (2 refs) | YES (8 refs) | YES line 1091 (bare) |
| B7 | `mingla-business/src/components/trip/EditPublishedTripScreen.tsx` | per grep (2 calls) | NO | YES (2 refs) | YES (3 refs) | YES line 1241 (bare) |

### §7.B Template A recipe (BrandEditView pattern — verbatim authority)

For each file in §7.A Template A: change the KAV import source from `'react-native'` to `'../../wrappers/KeyboardAvoidingView'` (or the relative-path equivalent for the file's directory depth). Remove `KeyboardAvoidingView` from the `react-native` destructured import block. All other code stays unchanged.

**Example (campaigns/compose.tsx — file is 4 levels deep at `app/(tabs)/marketing/campaigns/`):**

```diff
-import {
-  KeyboardAvoidingView,
-  ScrollView,
-  ...
-} from "react-native";
+import { ScrollView, ... } from "react-native";
+import { KeyboardAvoidingView } from "../../../../src/wrappers/KeyboardAvoidingView";
```

**Relative path table:**

| File | Wrapper import path |
|------|---------------------|
| `app/(tabs)/marketing/campaigns/compose.tsx` | `"../../../../src/wrappers/KeyboardAvoidingView"` |
| `app/(tabs)/marketing/templates/[id].tsx` | `"../../../../src/wrappers/KeyboardAvoidingView"` |
| `app/venue/create.tsx` | `"../../src/wrappers/KeyboardAvoidingView"` |
| `src/components/venue/VenueCreatorWizard.tsx` | `"../../wrappers/KeyboardAvoidingView"` |
| `src/components/trip/TripCreatorWizard.tsx` | `"../../wrappers/KeyboardAvoidingView"` |
| `app/account/delete.tsx` | `"../../src/wrappers/KeyboardAvoidingView"` |
| `app/account/edit-profile.tsx` | `"../../src/wrappers/KeyboardAvoidingView"` |
| `src/components/auth/BusinessWelcomeScreen.tsx` | `"../../wrappers/KeyboardAvoidingView"` |
| `src/components/event/EventCreatorWizard.tsx` | `"../../wrappers/KeyboardAvoidingView"` |
| `src/components/event/EditPublishedScreen.tsx` | `"../../wrappers/KeyboardAvoidingView"` |
| `src/components/trip/EditPublishedTripScreen.tsx` | `"../../wrappers/KeyboardAvoidingView"` |

### §7.C Template B recipe (TripCreatorWizard / Cycle 3 pattern collapse — verbatim authority)

For each file in §7.A Template B, in this exact order:

**Step 1 — Imports.** Swap KAV source per §7.B table. KEEP `Keyboard` named import from `react-native` for `Keyboard.dismiss()` calls (per `feedback_keyboard_never_blocks_input.md` allowlist + ORCH-0892-A I-PROPOSED-KEYBOARD-LIBRARY-ONLY allowlist). ADD `import { useKeyboardIsVisible } from "../../wrappers/useKeyboardIsVisible";` (or relative-path equivalent) ONLY if the file currently reads `keyboardVisible`/`keyboardPad` for dock-hide UX (B1, B2, B3, B5, B6, B7 — all except B4 which uses `keyboardPad` for paddingBottom only, not dock-hide).

**Step 2 — Delete listener block.** Find the `useEffect(() => { const showSub = Keyboard.addListener(...); const hideSub = Keyboard.addListener(...); ... }, [])` block. Delete it entirely (including the `useState<boolean>` and `useState<number>` declarations for `keyboardVisible` + `keyboardHeight` / `keyboardPad`). Approximate line counts:
- TripCreatorWizard: lines 386-414 (~28 lines).
- delete.tsx: lines ~100-120 (~20 lines).
- edit-profile.tsx: lines ~110-130 (~20 lines).
- BusinessWelcomeScreen: lines 266-278 (~13 lines).
- EventCreatorWizard / EditPublishedScreen / EditPublishedTripScreen: per file grep; typically 20-30 lines each.

**Step 3 — Replace state read.** Replace every read of `keyboardVisible` with `const keyboardVisible = useKeyboardIsVisible();` (declared near the top of the component, after other hook calls). Delete every read of `keyboardHeight` / `keyboardPad` (the wrapper KAV handles padding automatically; manual math is redundant).

**Step 4 — JSX wrap.** Find the form's ScrollView. Wrap it in:

```tsx
<KeyboardAvoidingView
  style={styles.kbAvoid}  // existing style, or add `flex: 1` to the wrap style
  behavior={Platform.OS === "ios" ? "padding" : undefined}
  keyboardVerticalOffset={0}
>
  <ScrollView ...>
    {/* existing children */}
  </ScrollView>
</KeyboardAvoidingView>
```

**Step 5 — Delete auto-insets prop.** If the ScrollView had `automaticallyAdjustKeyboardInsets` (bare prop or `={true}`), delete that prop. The wrapper KAV makes it redundant.

**Step 6 — Delete `paddingBottom: keyboardHeight` math.** If `contentContainerStyle` or inline style had `paddingBottom: keyboardHeight` or `paddingBottom: keyboardPad`, delete that line (or replace with the file's existing static bottom padding).

**Step 7 — Preserve `Keyboard.dismiss()` calls.** These are not listeners; they remain valid (allowlisted under I-PROPOSED-KEYBOARD-LIBRARY-ONLY).

**Step 8 — TripCreatorWizard B1 nuance.** Lines 1083-1185 already wrap the body in `<KeyboardAvoidingView>` (imported from RN). After Step 1's import swap, the wrap stays put (it's now resolved through the wrapper). The deletions in Steps 2/3/5/6 still apply.

### §7.D Sheet-embedded files — DO NOT MIGRATE

The following 11 files use `automaticallyAdjustKeyboardInsets` (bare prop or `={true}`) but render INSIDE `<Sheet>` (the SAFELIST CO-1 primitive). Sheet itself owns keyboard handling via `Keyboard.addListener` + `translateY = -keyboardHeight` (see `mingla-business/src/components/ui/Sheet.tsx:167-265`). Wrapping these sheet-children in additional KAV would DOUBLE-TRANSLATE the panel UP by `keyboardHeight` twice → broken layout. The bare `automaticallyAdjustKeyboardInsets` prop on a sheet-embedded ScrollView is moot (Sheet's translate handles it) but harmless. **LEAVE AS-IS.**

| # | File | Sheet parent | Auto-insets line |
|---|------|--------------|------------------|
| S1 | `src/components/brand/BrandDeleteSheet.tsx` | direct | ~21 (comment) |
| S2 | `src/components/brand/BrandStripeDetachConfirmSheet.tsx` | direct | 110 |
| S3 | `src/components/door/DoorRefundSheet.tsx` | direct | 215 |
| S4 | `src/components/door/DoorSaleNewSheet.tsx` | direct | 31 (comment) + JSX site |
| S5 | `src/components/event/ChangeSummaryModal.tsx` | direct | 144 |
| S6 | `src/components/event/TicketTierEditSheet.tsx` | direct | 373 (comment) + JSX site |
| S7 | `src/components/guests/AddCompGuestSheet.tsx` | direct | 201 |
| S8 | `src/components/orders/RefundSheet.tsx` | direct | 263 |
| S9 | `src/components/scanners/InviteScannerSheet.tsx` | direct | 157 |
| S10 | `src/components/team/InviteBrandMemberSheet.tsx` | direct | 159 |
| S11 | `src/components/trip/IntakeQuestionEditor.tsx` | line 280 `<Sheet>` | 300 |

**Adversarial test TA-SWEEP-1 (§11) must EXCLUDE these 11 files** from its repo-wide "auto-insets must be zero outside SAFELIST" assertion — they constitute a documented sheet-adjacency carve-out. Implementor adds these 11 paths to a SHEET_ADJACENCY array in the adversarial test file.

---

## §8 Realtime layer

**N/A.** Zero realtime changes.

---

## §9 Success criteria

### §9.A Per-screen criteria (11 SC triplets — 33 total criteria)

For EACH of the 11 migration targets, the following 3 SCs hold:

| SC | Surface | Criterion |
|----|---------|-----------|
| SC-{NN}-iOS | business-iOS | Tap any TextInput on the screen → whole field (including bottom border) visible above iOS keyboard; cursor visible; no overlap; no visible jump. (Where {NN} ∈ {A1, A2, A3, A4, B1..B7}.) |
| SC-{NN}-Android | business-Android | Same as iOS — wrapper KAV resolves to library on Android too. |
| SC-{NN}-web | business-web-preview | Cold-load the screen on Chrome at `localhost:8081/<route>`; no runtime errors; KAV behavior unchanged from pre-sweep (RN's built-in KAV is a passthrough on web). |

### §9.B Global criteria

| SC | Criterion | Verification |
|----|-----------|--------------|
| SC-A | Post-sweep `node .github/scripts/strict-grep/orch-0892-no-bespoke-keyboard-plumbing.mjs` exits 0 with ZERO WARN sites. | Run the gate; assert stdout contains `PASS — zero bespoke keyboard-plumbing violations outside the safelist.` |
| SC-B | Post-sweep repo-wide grep for `KeyboardAvoidingView` imported from `'react-native'` returns ZERO matches outside the SAFELIST. | `grep -rn "import\s*{[^}]*KeyboardAvoidingView[^}]*}\s*from\s*['\"]react-native['\"]" mingla-business/src mingla-business/app \| grep -v __tests__` → empty. |
| SC-C | Post-sweep repo-wide grep for `Keyboard.addListener` on layout-affecting events returns ZERO matches outside SAFELIST. | `grep -rn "Keyboard\.addListener.*keyboard\(Will\|Did\)\(Show\|Hide\)" mingla-business/src mingla-business/app \| grep -v __tests__` → empty (or only SAFELIST `Sheet.tsx`). |
| SC-D | Post-sweep repo-wide grep for `automaticallyAdjustKeyboardInsets` returns ZERO matches in NON-sheet-embedded files outside SAFELIST. The 11 sheet-embedded files (§7.D) may retain the bare prop (carve-out). | `grep -rln "automaticallyAdjustKeyboardInsets" ...` minus SHEET_ADJACENCY list → empty. |
| SC-E | `npx jest src/wrappers/__tests__/KeyboardRoot.test.tsx src/wrappers/__tests__/KeyboardRoot.adversarial.test.tsx` STILL PASS — no regression in ORCH-0892-A pilot contracts (currently 18 tests). | jest run output. |
| SC-F | `npx tsc --noEmit` zero new errors on touched files. | tsc output. |
| SC-G | Web bundle inspection: `cd mingla-business && npx expo export --platform web && grep -c "react-native-keyboard-controller" dist/_expo/static/js/web/entry-*.js` returns 0. (Mirrors ORCH-0892-A TA-1 anchor — no regression in web bundle cleanliness.) | Operator-runnable; cite count in QA report. |
| SC-H | Four ORCH-0885-A [Desktop Tier 1 — Container + Side Rail] desktop-web contract jest gates remain GREEN (no layout regression from new wraps). | `npx jest src/components/__tests__/desktopWebLayoutContracts.test.ts src/components/__tests__/wizardDesktopLayout.test.ts` etc. |

---

## §10 Invariants

**Preserved (no NEW invariants this sub-ORCH):**

- `I-PROPOSED-KEYBOARD-LIBRARY-ONLY` (DRAFT) — brought CLOSER to ACTIVE state: the in-WARN-list violation count drops from 8 → 0. Promotion DRAFT → ACTIVE happens in ORCH-0892-C, NOT here. The invariant text already permits non-listener Keyboard API (`Keyboard.dismiss()`) and the 4 SAFELIST carve-outs.
- I-PROPOSED-KEYBOARD-LIBRARY-ONLY allowlist additions required by this sub-ORCH: the 11 sheet-embedded files in §7.D are documented as a sheet-adjacency carve-out; the implementor must add a one-paragraph note to the invariant entry in `Mingla_Artifacts/INVARIANT_REGISTRY.md` explaining "auto-insets bare prop on a ScrollView inside `<Sheet>` is allowlisted by SAFELIST adjacency — Sheet itself owns keyboard via translateY; KAV wrap would double-translate." Add the 11 files as the canonical carve-out list.
- `I-36 ROOT-ERROR-BOUNDARY` — sweep does NOT touch `app/_layout.tsx`; KeyboardRoot mount position unchanged.
- `I-PROPOSED-STRIPE-PAYMENTSHEET-PARITY` — sweep does NOT touch Stripe provider mount.
- All 16 desktop-web contracts from ORCH-0885-A baseline — sweep wraps form ScrollViews; outer page layout unchanged.
- `feedback_keyboard_never_blocks_input.md` — this sweep IS the app-wide operationalization of this rule.

---

## §11 Test cases

### §11.A Implementor happy-path test (extend existing file)

Extend `mingla-business/src/wrappers/__tests__/KeyboardRoot.test.tsx`. Append a NEW `describe()` block:

```ts
describe("ORCH-0892-B sweep — per-screen migration contracts", () => {
  // Template A — pure KAV-from-wrapper imports
  const TEMPLATE_A = [
    { path: "app/(tabs)/marketing/campaigns/compose.tsx", relImport: "../../../../src/wrappers/KeyboardAvoidingView" },
    { path: "app/(tabs)/marketing/templates/[id].tsx", relImport: "../../../../src/wrappers/KeyboardAvoidingView" },
    { path: "app/venue/create.tsx", relImport: "../../src/wrappers/KeyboardAvoidingView" },
    { path: "src/components/venue/VenueCreatorWizard.tsx", relImport: "../../wrappers/KeyboardAvoidingView" },
  ];
  it.each(TEMPLATE_A)("T-B-A: $path imports KAV from wrapper, NOT from react-native", ({ path, relImport }) => {
    const source = read(path);
    expect(source).toMatch(
      new RegExp(`import\\s+\\{\\s*KeyboardAvoidingView\\s*\\}\\s+from\\s+["']${relImport.replace(/[.[\]]/g, "\\$&")}["']`),
    );
    const rnImportBlock = source.match(/import\s+\{[^}]+\}\s+from\s+["']react-native["']/);
    expect(rnImportBlock?.[0] ?? "").not.toMatch(/\bKeyboardAvoidingView\b/);
  });

  // Template B — Cycle 3 collapse: no Keyboard.addListener on layout events,
  // KAV from wrapper, uses useKeyboardIsVisible() when dock-hide is preserved.
  const TEMPLATE_B = [
    { path: "src/components/trip/TripCreatorWizard.tsx", usesDockHide: true },
    { path: "app/account/delete.tsx", usesDockHide: true },
    { path: "app/account/edit-profile.tsx", usesDockHide: true },
    { path: "src/components/auth/BusinessWelcomeScreen.tsx", usesDockHide: false },
    { path: "src/components/event/EventCreatorWizard.tsx", usesDockHide: true },
    { path: "src/components/event/EditPublishedScreen.tsx", usesDockHide: true },
    { path: "src/components/trip/EditPublishedTripScreen.tsx", usesDockHide: true },
  ];
  it.each(TEMPLATE_B)("T-B-B: $path no longer registers layout-event Keyboard listener", ({ path }) => {
    const source = read(path);
    expect(source).not.toMatch(/Keyboard\.addListener\s*\(\s*["']?(keyboard(Will|Did)(Show|Hide))/);
  });
  it.each(TEMPLATE_B)("T-B-B: $path no longer uses automaticallyAdjustKeyboardInsets", ({ path }) => {
    const source = read(path);
    // Allow comments mentioning the prop (historical); reject only JSX-site bare prop or ={true}.
    const stripped = source.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter(l => !l.trim().startsWith("//")).join("\n");
    expect(stripped).not.toMatch(/automaticallyAdjustKeyboardInsets\s*(?:=\s*\{?\s*true|$|\s)/m);
  });
  it.each(TEMPLATE_B.filter(t => t.usesDockHide))("T-B-B: $path imports useKeyboardIsVisible from wrapper", ({ path }) => {
    const source = read(path);
    expect(source).toMatch(/import\s+\{\s*useKeyboardIsVisible\s*\}\s+from\s+["'][^"']*wrappers\/useKeyboardIsVisible["']/);
  });

  // Wrapper hook pair exists and matches contract
  it("T-B-WEB-HOOK: useKeyboardIsVisible.ts returns constant false; zero library imports", () => {
    const source = read("src/wrappers/useKeyboardIsVisible.ts");
    expect(source).toMatch(/return\s+false\s*;/);
    expect(source).not.toMatch(/from\s+["']react-native-keyboard-controller["']/);
  });
  it("T-B-NATIVE-HOOK: useKeyboardIsVisible.native.ts delegates to useKeyboardState from library", () => {
    const source = read("src/wrappers/useKeyboardIsVisible.native.ts");
    expect(source).toMatch(/import\s+\{\s*useKeyboardState\s*\}\s+from\s+["']react-native-keyboard-controller["']/);
    expect(source).toMatch(/return\s+useKeyboardState\(\)\.isVisible\s*;/);
  });
});
```

**Modification of existing file requires `[TEST-MOD-APPROVED ORCH-0892-B]` token in the commit body** (per ORCH-0840 append-only override).

### §11.B Tester adversarial test (NEW file)

Write `mingla-business/src/wrappers/__tests__/KeyboardRoot.sweep.adversarial.test.tsx`. Three attack angles DIFFERENT from §11.A:

**TA-SWEEP-1 — Repo-wide enumeration of forbidden patterns.** Walk every `.ts`/`.tsx` file under `mingla-business/src` and `mingla-business/app`. EXCLUDE `__tests__`, the SAFELIST (5 files from gate + the 2 new wrapper hooks), and the 11 sheet-adjacency files (§7.D). Assert ZERO files match ANY of the three forbidden patterns. Proves the sweep is COMPLETE — no missed file. Different angle than the implementor's curated per-file contract (which can drift if the file list is wrong).

```ts
const SAFELIST = new Set([
  "src/components/ui/Sheet.tsx",
  "src/components/marketing/ComposerV2/ComposerV2Editor.tsx",
  "src/components/marketing/ComposerV2/richEditor.native.ts",
  "src/components/marketing/ComposerV2/richEditor.tsx",
  "src/wrappers/KeyboardRoot.native.tsx",
  "src/wrappers/KeyboardAvoidingView.native.tsx",
  "src/wrappers/useKeyboardIsVisible.native.ts",
]);
const SHEET_ADJACENCY = new Set([
  // 11 files from §7.D, full relative paths
]);
// Walk, intersect, assert empty match list per pattern.
```

**TA-SWEEP-2 — Web bundle library-leak assertion (mirrors ORCH-0892-A TA-1 anchor).** If `dist/_expo/static/js/web/` exists, grep all `.js` files for `react-native-keyboard-controller|KeyboardProvider|KeyboardController|keyboardEventsMap|useKeyboardState`. Assert ZERO matches. If `dist/` missing, SKIP with documented prerequisite (`cd mingla-business && npx expo export --platform web`). Proves the sweep didn't accidentally leak the library to web via the new `useKeyboardIsVisible` hook.

**TA-SWEEP-3 — Allowlist hygiene.** Assert ZERO new `// orch-strict-grep-allow orch-0892` inline allowlist comments appear in the diff `git diff origin/main...HEAD`. The sweep should DELETE bespoke plumbing, not allowlist-around it. The only legitimate SAFELIST addition is the 1-line addition of `useKeyboardIsVisible.native.ts` to the gate script's SAFELIST array. Implementor implements; tester verifies the diff matches.

### §11.C Fails-on-revert verification (mandatory per ORCH-0840)

For each Template B target, implementor must:
1. Stash the migration patch for ONE file (e.g., TripCreatorWizard.tsx).
2. Re-run `npx jest src/wrappers/__tests__/KeyboardRoot.test.tsx`.
3. Confirm the corresponding T-B-B `it.each` row RED on revert.
4. Pop the stash; re-run; confirm GREEN.
5. Cite the commit hash + the specific test that RED.

Same protocol for at least one Template A target.

---

## §12 Implementation order

1. **Phase 0 sanity** — verify `mingla-business/src/wrappers/KeyboardAvoidingView.{tsx,native.tsx}` exists with current re-export contract. Verify gate script SAFELIST contains the 5 ORCH-0892-A entries.
2. **Write new wrapper hook pair** — create `src/wrappers/useKeyboardIsVisible.ts` (web) + `src/wrappers/useKeyboardIsVisible.native.ts` (native) per §6.1/§6.2 verbatim.
3. **Update gate SAFELIST** — add `"mingla-business/src/wrappers/useKeyboardIsVisible.native.ts"` to the SAFELIST array in `.github/scripts/strict-grep/orch-0892-no-bespoke-keyboard-plumbing.mjs`. Run the gate; expect 8 WARN sites (unchanged — sweep hasn't started). Confirm exit 0.
4. **Template A migrations (4 files)** — apply §7.B recipe. After each file, re-run the gate: expect WARN count to drop by 1.
5. **Template B migrations (7 files, in this order to minimize cross-file conflict)** — apply §7.C recipe:
   - B4 BusinessWelcomeScreen (simplest — no `keyboardVisible`).
   - B2 + B3 (account/delete + account/edit-profile — pair, similar pattern).
   - B1 TripCreatorWizard.
   - B5 + B6 + B7 (EventCreatorWizard + EditPublishedScreen + EditPublishedTripScreen — pair-by-pair).
   - After each file, re-run the gate.
6. **Final gate run** — `node .github/scripts/strict-grep/orch-0892-no-bespoke-keyboard-plumbing.mjs` → expect `PASS — zero bespoke keyboard-plumbing violations outside the safelist.` (SC-A).
7. **Repo-wide grep verifications** — SC-B, SC-C, SC-D from §9.B.
8. **Append implementor happy-path test block** — extend `src/wrappers/__tests__/KeyboardRoot.test.tsx` per §11.A. Source comment MUST cite `[TEST-MOD-APPROVED ORCH-0892-B]`.
9. **Run jest** — `npx jest src/wrappers/__tests__/KeyboardRoot.test.tsx src/wrappers/__tests__/KeyboardRoot.adversarial.test.tsx` → all GREEN (SC-E + new tests).
10. **Run tsc** — `cd mingla-business && npx tsc --noEmit` → zero new errors on touched files (SC-F).
11. **Run desktop-web contract gates** — `npx jest src/components/__tests__/desktopWebLayoutContracts.test.ts src/components/__tests__/wizardDesktopLayout.test.ts` etc. (SC-H).
12. **Fails-on-revert** — perform the §11.C protocol on at least 2 files (1× Template A, 1× Template B). Cite commit hashes in implementation report.
13. **Implementor report** — `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0892-B_KEYBOARD_AVOIDANCE_SWEEP.md` with per-file old→new receipts, per-template change counts, tsc + jest output, fails-on-revert commit hashes. Note "EAS OTA eligible" + provide command `eas update --branch production --platform ios,android --message "ORCH-0892-B sweep"`.
14. **HANDOFF to tester** — Claude `mingla-tester` for TA-SWEEP-1/2/3 + per-screen operator-driven sim smoke (per `feedback_tester_canonical_and_platform_parity.md`). Tester will also write the §11.B adversarial test file.

---

## §13 Regression prevention

**The sweep IS the regression prevention.** Mechanism:

1. After sweep close, EVERY production-code file in `mingla-business/` (outside SAFELIST + sheet-adjacency carve-out) imports KAV via the wrapper. NO file has a layout-event `Keyboard.addListener`. NO file has bare `automaticallyAdjustKeyboardInsets`.
2. The strict-grep gate REMAINS in INFORMATIONAL mode in this sub-ORCH; ORCH-0892-C flips it to BLOCK. Any future PR introducing a forbidden pattern would WARN now and FAIL after 0892-C.
3. The 18 ORCH-0892-A pilot tests + the ~15 new ORCH-0892-B contract tests run on every jest invocation in CI; any regression of an individual file's import contract trips a RED.
4. The tester's TA-SWEEP-1 adversarial test catches ANY new file added to the repo that introduces a forbidden pattern (not just modifications to existing files — additions too).
5. The tester's TA-SWEEP-2 web bundle assertion catches accidental library leaks (e.g., a future developer importing `useKeyboardState` directly bypasses the wrapper hook).
6. Documentation: `feedback_keyboard_never_blocks_input.md` in operator memory + I-PROPOSED-KEYBOARD-LIBRARY-ONLY in INVARIANT_REGISTRY both describe the architectural pattern.

---

## §14 Hard guards (carry into implementation)

1. **NO carve-out modifications.** SAFELIST = Sheet.tsx + ComposerV2Editor.tsx + richEditor.{tsx,native.ts} + KeyboardRoot.native.tsx + KeyboardAvoidingView.native.tsx — STAY UNCHANGED. Only addition allowed: `useKeyboardIsVisible.native.ts` (per §6.2 + §12.3).
2. **NO sheet-embedded file migrations.** The 11 files in §7.D are explicit DO-NOT-MIGRATE — they would double-translate via Sheet's translateY.
3. **NO `app-mobile/` touches.** Zero diffs under `app-mobile/`. (Port is ORCH-0892-E.)
4. **NO Supabase / DB / edge-function / migration changes.**
5. **NO version bumps.** Library v1.18.5 + Reanimated 4.1.1 + RN 0.81.5 + Expo 54 stay locked.
6. **NO gate mode flip.** INFORMATIONAL → BLOCK is ORCH-0892-C. Only the 1-line SAFELIST addition is allowed.
7. **NO invariant promotion.** I-PROPOSED-KEYBOARD-LIBRARY-ONLY stays DRAFT — ORCH-0892-C promotes it. This SPEC's required edit to the invariant entry is documentation-only (add sheet-adjacency carve-out paragraph), not a status flip.
8. **NO desktop-web contract regression.** All 4 ORCH-0885-A jest gates STAY GREEN.
9. **Preserve `Keyboard.dismiss()` calls.** Non-listener Keyboard API is allowlisted under I-PROPOSED-KEYBOARD-LIBRARY-ONLY. Implementor must NOT remove `Keyboard.dismiss()` calls during Cycle-3 listener deletion.
10. **EAS-OTA eligible.** Sweep is pure JS swap — no new native dep (library already in main via PR #150). Implementor report must explicitly note "EAS OTA eligible" + provide the eas update command for orchestrator CLOSE Step 3.
11. **`[TEST-MOD-APPROVED ORCH-0892-B]` token** must appear in the closing commit body — sweep extends `KeyboardRoot.test.tsx` with new contract assertions (append-only is fine; the existing-test modification rule requires the token per ORCH-0840).
12. **Operator-driven per-screen visual smoke acceptable for PASS.** Tester writes adversarial completeness test; operator does per-screen sim smoke at acceptance time (mirror ORCH-0892-A Path B acceptance pattern). Each of the 11 migrated screens needs at minimum a sim screenshot or Maestro flow per `feedback_sim_test_drivers_maestro_default.md`.
13. **Implementor invokes `/ui-ux-pro-max` pre-flight** if any screen's layout perceptibly changes post-wrap (per `feedback_implementor_uses_ui_ux_pro_max.md`). Most wraps are layout-neutral when keyboard is closed; the wrap is invisible until keyboard appears.

---

## §15 ORCH-0888 [Fabric breaks legacy ScrollResponder] supersession verdict requirement

The implementor report MUST include a section titled "**§16 ORCH-0888 supersession verdict**" that names — based on operator-driven smoke during acceptance — whether CoverPicker GIPHY search input behaves correctly post-sweep:

- If GIPHY search field is fully visible above keyboard when focused, with no ORCH-0884 #8/#9 path re-introduced → ORCH-0888 is SUPERSEDED by ORCH-0892 arc. Implementor report cites the smoke evidence, recommends ORCH-0888 close.
- If GIPHY search field still has any keyboard-blocking, scroll-jank, or layout issue → ORCH-0888 REMAINS OPEN. Implementor report cites the specific failure mode for orchestrator triage.

The verdict goes into the implementor report and is forwarded to orchestrator CLOSE; no code action in this sub-ORCH (the GIPHY behavior is exercised by CoverPicker already migrated in ORCH-0892-A; this sweep doesn't touch it again).

---

## §16 Open follow-up registrations

The orchestrator INTAKE-banner this SPEC fulfills already references the following downstream ORCHs. None are dispatched by this sweep; orchestrator queues them post-CLOSE:

1. **ORCH-0892-C** [gate promotion + invariant promote] — flip the strict-grep gate INFORMATIONAL → BLOCK; promote I-PROPOSED-KEYBOARD-LIBRARY-ONLY from DRAFT → ACTIVE. Immediate next after this ORCH closes.
2. **ORCH-0892-Bx** [runbook docs update] — add `export SENTRY_DISABLE_AUTO_UPLOAD=true` step to `Mingla_Artifacts/IOS_DEV_BUILD_REBUILD_RUNBOOK.md` per DISC-QA-0892-A-RETEST-2-1.
3. **ORCH-0892-D** [composer migration cleanup] — optional; out of scope.
4. **ORCH-0892-E** [`app-mobile/` port] — deferred until 1+ week clean signal post-B.
5. **ORCH-0888** [Fabric breaks legacy ScrollResponder] — verdict per §15.
6. **ORCH-0896** (not yet registered) — Stripe `forwardRef` RedBox per DISC-QA-0892-A-RETEST-2-2.

---

## §17 Layman summary

The keyboard fix from ORCH-0892-A worked on 3 pilot screens but the operator's smoke test caught that 4 important screens — the Event Creator wizard, the Trip Creator wizard, the Edit Event screen, and the Edit Trip screen — still show the bug where the keyboard pops up and hides the bottom half of the input field you're typing in. This SPEC tells the implementor exactly how to fix those 4 screens plus 7 more like them (account profile editor, account delete, business welcome screen, marketing composer, template editor, two venue screens, the trip wizard), for 11 total screens.

**What the sweep does, in plain English:**

1. Every screen with a text input gets wrapped in the new "smart keyboard wrapper" we built in ORCH-0892-A. The wrapper lifts the form just enough so whatever field you're typing in stays visible above the keyboard.
2. Every screen that had the OLD "guess how tall the keyboard is and add that much padding" code gets that code DELETED (it was unreliable — that's why the bug existed).
3. A small new wrapper hook lets screens keep their "hide the bottom toolbar when the keyboard is up" behavior without leaking the keyboard library into the web bundle (web users don't have soft keyboards, so they don't need the library).
4. Eleven OTHER screens that put text inputs inside popup sheets (BrandDeleteSheet, RefundSheet, etc.) are LEFT ALONE — those use a different keyboard pattern at the sheet level, and wrapping them again would push the panel up TWICE.
5. The CI gate that warns about "bad keyboard code" should drop from 8 warnings to 0 after the sweep — proving the sweep is complete.

**What stays the same:**
- Web users see no change (the wrapper falls back to React Native's built-in KAV on web, which is what was there before ORCH-0892).
- Consumer iOS/Android app (`app-mobile/`) is untouched (that's a future ORCH).
- Admin web dashboard is untouched (no React Native).
- Sheet popups keep their existing keyboard behavior (Sheet primitive handles them; don't double-wrap).

**Next step after this SPEC is approved:** Claude `mingla-implementor` reads it, executes the 11 file migrations + adds the wrapper hook pair + extends the test file, hands off to Claude `mingla-tester` for the 3 adversarial tests + operator-driven sim smoke on each of the 11 screens. Then orchestrator CLOSE + PR `Seth → main` + EAS OTA push so all current users get the fix without waiting for an App Store update. Then ORCH-0892-C flips the strict-grep gate from WARN-only to BLOCK so this bug class can never come back.
