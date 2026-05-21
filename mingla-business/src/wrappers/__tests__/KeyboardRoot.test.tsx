/**
 * ORCH-0892-A: KeyboardRoot wrapper + pilot screen migration tests.
 *
 * Source-text contract tests per the repo's jest convention (testEnvironment
 * "node"; tests read file contents and grep). These tests document the
 * library-only keyboard contract: the web variant is a passthrough Fragment,
 * the native variant wraps in <KeyboardProvider>, and the three pilot
 * screens (BrandEditView, TripBrandWizard, CoverPicker) import their
 * <KeyboardAvoidingView> from the library NOT from 'react-native'.
 *
 * Per SPEC_ORCH-0892-A §11 (T-01..T-05). Implementor happy-path tests;
 * tester adversarial tests live in KeyboardRoot.adversarial.test.tsx.
 *
 * Invariant: I-PROPOSED-KEYBOARD-LIBRARY-ONLY (DRAFT — flips ACTIVE on
 * ORCH-0892-C close).
 */

import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..", "..", "..");

const read = (relativePath: string): string =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

describe("ORCH-0892-A KeyboardRoot + pilot migration", () => {
  // --- T-01: Web variant is a passthrough Fragment ---
  it("T-01: KeyboardRoot.tsx (web variant) returns <>{children}</> and does NOT import KeyboardProvider", () => {
    const source = read("src/wrappers/KeyboardRoot.tsx");
    // Returns Fragment wrapping children — passthrough contract.
    expect(source).toMatch(/<>\{children\}<\/>/);
    // No library import — proves the library is not pulled into web bundle.
    expect(source).not.toMatch(/from\s+["']react-native-keyboard-controller["']/);
    // No <KeyboardProvider> JSX element use. (Comments mentioning the
    // symbol are fine — the contract is that it's not actually wrapped.)
    expect(source).not.toMatch(/<KeyboardProvider[\s>]/);
  });

  // --- T-02: Native variant wraps children in <KeyboardProvider> ---
  it("T-02: KeyboardRoot.native.tsx (native variant) imports KeyboardProvider from the library and wraps children", () => {
    const source = read("src/wrappers/KeyboardRoot.native.tsx");
    expect(source).toMatch(
      /import\s+\{\s*KeyboardProvider\s*\}\s+from\s+["']react-native-keyboard-controller["']/,
    );
    // KeyboardProvider wraps the children JSX.
    expect(source).toMatch(/<KeyboardProvider>\{children\}<\/KeyboardProvider>/);
  });

  // --- T-03: BrandEditView v3 contract (ORCH-0892-B) — uses SmartScrollView, KAV wrapper deleted ---
  // [TEST-MOD-APPROVED ORCH-0892-B] — supersedes ORCH-0892-A v2 KAV-wrapper
  // contract. ORCH-0892-B deleted the KeyboardAvoidingView.{tsx,native.tsx}
  // wrapper pair; SmartScrollView (KAS on native, plain ScrollView on web)
  // is the new owner. Per SPEC_ORCH-0892-B_v2 §7.D + §11.A.
  it("T-03: BrandEditView.tsx imports ScrollView from SmartScrollView wrapper; no KAV anywhere (v3 / ORCH-0892-B)", () => {
    const source = read("src/components/brand/BrandEditView.tsx");
    const stripped = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .map((line) => line.replace(/\/\/.*$/, ""))
      .join("\n");
    expect(source).toMatch(
      /import\s+\{\s*ScrollView\s*\}\s+from\s+["']\.\.\/\.\.\/wrappers\/SmartScrollView["']/,
    );
    // No KAV import (wrapper or library) — KAS replaces KAV functionally.
    expect(stripped).not.toMatch(/\bKeyboardAvoidingView\b/);
    expect(stripped).not.toMatch(
      /from\s+["']react-native-keyboard-controller["']/,
    );
    // The react-native import block must NOT include ScrollView (the
    // wrapper is the single owner) and must NOT include KAV.
    const reactNativeImportBlockMatch = source.match(
      /import\s+\{[^}]+\}\s+from\s+["']react-native["']/,
    );
    expect(reactNativeImportBlockMatch).not.toBeNull();
    expect(reactNativeImportBlockMatch?.[0] ?? "").not.toMatch(
      /\bScrollView\b/,
    );
    expect(reactNativeImportBlockMatch?.[0] ?? "").not.toMatch(
      /\bKeyboardAvoidingView\b/,
    );
  });

  // --- T-03b: TripBrandWizard v3 contract ---
  it("T-03b: TripBrandWizard.tsx uses SmartScrollView, retains Keyboard for Keyboard.dismiss() (v3 / ORCH-0892-B)", () => {
    const source = read("src/components/brand/TripBrandWizard.tsx");
    const stripped = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .map((line) => line.replace(/\/\/.*$/, ""))
      .join("\n");
    expect(source).toMatch(
      /import\s+\{\s*ScrollView\s*\}\s+from\s+["']\.\.\/\.\.\/wrappers\/SmartScrollView["']/,
    );
    expect(stripped).not.toMatch(/\bKeyboardAvoidingView\b/);
    expect(stripped).not.toMatch(
      /from\s+["']react-native-keyboard-controller["']/,
    );
    // Keyboard import retained for Keyboard.dismiss().
    expect(source).toMatch(/Keyboard\.dismiss\(\)/);
    const reactNativeImportBlockMatch = source.match(
      /import\s+\{[^}]+\}\s+from\s+["']react-native["']/,
    );
    expect(reactNativeImportBlockMatch).not.toBeNull();
    expect(reactNativeImportBlockMatch?.[0] ?? "").not.toMatch(
      /\bScrollView\b/,
    );
    expect(reactNativeImportBlockMatch?.[0] ?? "").toMatch(/\bKeyboard,?/);
  });

  // --- T-04: CoverPicker v3 contract — SmartScrollView, KAV deleted ---
  it("T-04: CoverPicker.tsx uses SmartScrollView, no parentScrollRef/keyboardScrollExtraOffset props, KAV deleted (v3 / ORCH-0892-B)", () => {
    const source = read("src/components/ui/CoverPicker.tsx");
    const stripped = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .map((line) => line.replace(/\/\/.*$/, ""))
      .join("\n");
    const interfaceMatch = source.match(
      /export\s+interface\s+CoverPickerProps\s*\{[\s\S]*?\n\}/,
    );
    expect(interfaceMatch).not.toBeNull();
    const interfaceBody = interfaceMatch?.[0] ?? "";
    expect(interfaceBody).not.toMatch(/parentScrollRef/);
    expect(interfaceBody).not.toMatch(/keyboardScrollExtraOffset/);
    expect(source).toMatch(
      /import\s+\{\s*ScrollView\s*\}\s+from\s+["']\.\.\/\.\.\/wrappers\/SmartScrollView["']/,
    );
    // No KAV (wrapper or library import or JSX element) in the actual code.
    expect(stripped).not.toMatch(/<KeyboardAvoidingView/);
    expect(stripped).not.toMatch(/\bKeyboardAvoidingView\b/);
    // Deleted ORCH-0884 #8 + #9 paths remain DELETED.
    expect(stripped).not.toMatch(/findNodeHandle/);
    expect(stripped).not.toMatch(/scrollResponderScrollNativeHandleToKeyboard/);
    expect(stripped).not.toMatch(/Keyboard\.addListener/);
  });

  // --- T-05: CoverPicker no longer wraps search section in KAV (v3) ---
  // [TEST-MOD-APPROVED ORCH-0892-B] — v2 asserted PRESENCE of the KAV wrap.
  // v3 asserts ABSENCE — keyboard avoidance now flows through parent screen's
  // SmartScrollView via KAS focused-input scroll, not a local KAV wrap.
  it("T-05: CoverPicker.tsx no longer wraps search section in KeyboardAvoidingView (v3 / ORCH-0892-B)", () => {
    const source = read("src/components/ui/CoverPicker.tsx");
    const stripped = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .map((line) => line.replace(/\/\/.*$/, ""))
      .join("\n");
    expect(stripped).not.toMatch(/<KeyboardAvoidingView/);
  });
});

describe("ORCH-0892-B v2 SmartScrollView + useKeyboardIsVisible wrappers (post ORCH-0892-A KAV teardown)", () => {
  // --- T-07: SmartScrollView web variant re-exports react-native's ScrollView ---
  it("T-07: SmartScrollView.tsx (web variant) re-exports from 'react-native' and does NOT import the library", () => {
    const source = read("src/wrappers/SmartScrollView.tsx");
    expect(source).toMatch(
      /export\s+\{\s*ScrollView\s*\}\s+from\s+["']react-native["']/,
    );
    expect(source).not.toMatch(
      /from\s+["']react-native-keyboard-controller["']/,
    );
  });

  // --- T-08: SmartScrollView native variant wraps KeyboardAwareScrollView ---
  it("T-08: SmartScrollView.native.tsx (native variant) imports KeyboardAwareScrollView from the library and exports as ScrollView", () => {
    const source = read("src/wrappers/SmartScrollView.native.tsx");
    expect(source).toMatch(
      /import\s+\{[^}]*\bKeyboardAwareScrollView\b[^}]*\}\s+from\s+["']react-native-keyboard-controller["']/,
    );
    expect(source).toMatch(/export\s+const\s+ScrollView\s*=/);
  });

  // --- T-09: useKeyboardIsVisible web variant returns false ---
  it("T-09: useKeyboardIsVisible.ts (web variant) returns false; zero library imports", () => {
    const source = read("src/wrappers/useKeyboardIsVisible.ts");
    expect(source).toMatch(/return\s+false\s*;/);
    expect(source).not.toMatch(
      /from\s+["']react-native-keyboard-controller["']/,
    );
  });

  // --- T-10: useKeyboardIsVisible native variant delegates to useKeyboardState ---
  it("T-10: useKeyboardIsVisible.native.ts (native variant) delegates to useKeyboardState from the library", () => {
    const source = read("src/wrappers/useKeyboardIsVisible.native.ts");
    expect(source).toMatch(
      /import\s+\{\s*useKeyboardState\s*\}\s+from\s+["']react-native-keyboard-controller["']/,
    );
    expect(source).toMatch(/return\s+useKeyboardState\(\)\.isVisible\s*;/);
  });

  // --- T-11: KeyboardAvoidingView wrapper files are DELETED ---
  it("T-11: KeyboardAvoidingView wrapper pair (ORCH-0892-A) no longer exists", () => {
    expect(() => read("src/wrappers/KeyboardAvoidingView.tsx")).toThrow();
    expect(() => read("src/wrappers/KeyboardAvoidingView.native.tsx")).toThrow();
  });
});

describe("ORCH-0892-B v2 Sheet primitive rewrite (no keyboard logic)", () => {
  // --- T-12: Sheet.tsx no longer registers layout-event Keyboard listener ---
  it("T-12: Sheet.tsx no longer registers Keyboard.addListener for layout events", () => {
    const source = read("src/components/ui/Sheet.tsx");
    expect(source).not.toMatch(
      /Keyboard\.addListener\s*\(\s*["']?keyboard(Will|Did)(Show|Hide)/,
    );
  });

  // --- T-13: Sheet.tsx no longer translates panel by keyboardHeight ---
  it("T-13: Sheet.tsx no longer computes openY = -keyboardHeight", () => {
    const source = read("src/components/ui/Sheet.tsx");
    expect(source).not.toMatch(/openY\s*=\s*-\s*keyboardHeight/);
    // openY = 0 is the new contract.
    expect(source).toMatch(/openY\s*=\s*0/);
  });

  // --- T-14: Sheet.tsx no longer destructures Keyboard / KeyboardEvent from react-native ---
  it("T-14: Sheet.tsx no longer imports Keyboard or KeyboardEvent from 'react-native'", () => {
    const source = read("src/components/ui/Sheet.tsx");
    const reactNativeImportBlockMatch = source.match(
      /import\s+\{[^}]+\}\s+from\s+["']react-native["']/,
    );
    expect(reactNativeImportBlockMatch).not.toBeNull();
    expect(reactNativeImportBlockMatch?.[0] ?? "").not.toMatch(
      /\bKeyboard\b/,
    );
  });
});

describe("ORCH-0892-B v2 form-screen migrations — SmartScrollView contract", () => {
  // T-V2-FORM: every migrated form-screen imports ScrollView from SmartScrollView
  // wrapper and no longer imports ScrollView from react-native or KAV from any source.
  // 14 form-screens (11 ORCH-0892-B targets + 3 ORCH-0892-A pilot teardowns +
  // additional discoveries from 4th gate pattern).
  const FORM_SCREENS = [
    "app/(tabs)/marketing/campaigns/compose.tsx",
    "app/(tabs)/marketing/templates/[id].tsx",
    "app/venue/create.tsx",
    "app/account/delete.tsx",
    "app/account/edit-profile.tsx",
    "app/booking/[orderId]/cancel.tsx",
    "app/event/[id]/guests/[guestId].tsx",
    "src/components/venue/VenueCreatorWizard.tsx",
    "src/components/trip/TripCreatorWizard.tsx",
    "src/components/event/EventCreatorWizard.tsx",
    "src/components/event/EditPublishedScreen.tsx",
    "src/components/trip/EditPublishedTripScreen.tsx",
    "src/components/brand/BrandEditView.tsx",
    "src/components/brand/TripBrandWizard.tsx",
    "src/components/ui/CoverPicker.tsx",
    "src/components/brand/BrandStripeCountryPicker.tsx",
    "src/components/event/CreatorStep2When.tsx",
    "src/components/trip/TripCreatorStep3Inclusions.tsx",
    "src/screens/ari/AriSettingsScreen.tsx",
  ];

  it.each(FORM_SCREENS)("T-V2-FORM: %s imports ScrollView from SmartScrollView wrapper", (path) => {
    const source = read(path);
    expect(source).toMatch(
      /import\s+\{\s*ScrollView\s*\}\s+from\s+["'][^"']*wrappers\/SmartScrollView["']/,
    );
    const rnImportBlock = source.match(
      /import\s+\{[^}]+\}\s+from\s+["']react-native["']/,
    );
    if (rnImportBlock !== null) {
      expect(rnImportBlock[0]).not.toMatch(/\bScrollView\b/);
    }
  });

  it.each(FORM_SCREENS)("T-V2-FORM: %s no longer imports KeyboardAvoidingView from any source", (path) => {
    const source = read(path);
    // Strip comments + block comments before assertion — the deletion-rationale
    // comments mention KeyboardAvoidingView by name (correctly), but the actual
    // import/JSX use must be gone.
    const stripped = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .map((line) => line.replace(/\/\/.*$/, ""))
      .join("\n");
    expect(stripped).not.toMatch(/\bKeyboardAvoidingView\b/);
  });

  // T-V2-FORM-LISTENERS: Template B files no longer register layout-event
  // Keyboard listeners (sweep deleted the Cycle 3 wizard root pattern).
  const TEMPLATE_B = [
    "src/components/trip/TripCreatorWizard.tsx",
    "src/components/event/EventCreatorWizard.tsx",
    "src/components/event/EditPublishedScreen.tsx",
    "src/components/trip/EditPublishedTripScreen.tsx",
    "app/account/delete.tsx",
    "app/account/edit-profile.tsx",
  ];

  it.each(TEMPLATE_B)("T-V2-LISTENER: %s no longer registers layout-event Keyboard listener", (path) => {
    const source = read(path);
    expect(source).not.toMatch(
      /Keyboard\.addListener\s*\(\s*["']?keyboard(Will|Did)(Show|Hide)/,
    );
  });
});

describe("ORCH-0892-B v2 sheet-consumer migrations — SmartScrollView contract", () => {
  // T-V2-SHEET-CONSUMER: every sheet consumer with an inner ScrollView
  // migrated to SmartScrollView wrapper. Sheet primitive itself dropped
  // keyboard logic, so each consumer owns its own KAS-driven scroll.
  const SHEET_CONSUMERS = [
    "src/components/brand/BrandCoverPickerSheet.tsx",
    "src/components/brand/BrandDeleteSheet.tsx",
    "src/components/brand/BrandStripeDetachConfirmSheet.tsx",
    "src/components/door/DoorRefundSheet.tsx",
    "src/components/door/DoorSaleNewSheet.tsx",
    "src/components/event/ChangeSummaryModal.tsx",
    "src/components/event/MultiDateOverrideSheet.tsx",
    "src/components/event/TicketTierEditSheet.tsx",
    "src/components/guests/AddCompGuestSheet.tsx",
    "src/components/orders/RefundSheet.tsx",
    "src/components/scanners/InviteScannerSheet.tsx",
    "src/components/team/InviteBrandMemberSheet.tsx",
    "src/components/trip/IntakeQuestionEditor.tsx",
    "src/components/trip/RefundPreviewSheet.tsx",
  ];

  it.each(SHEET_CONSUMERS)("T-V2-SHEET-CONSUMER: %s imports ScrollView from SmartScrollView wrapper", (path) => {
    const source = read(path);
    expect(source).toMatch(
      /import\s+\{\s*ScrollView\s*\}\s+from\s+["'][^"']*wrappers\/SmartScrollView["']/,
    );
  });
});

describe("ORCH-0892-A caller cleanup (the 5 CoverPicker callers)", () => {
  // Sweep test: NO caller file still passes parentScrollRef or
  // keyboardScrollExtraOffset to CoverPicker. This is the implementor
  // counterpart to tester adversarial TA-3 (which greps the whole repo).
  const CALLER_FILES = [
    "src/components/trip/TripCreatorStep1Basics.tsx",
    "src/components/trip/TripCreatorWizard.tsx",
    "src/components/trip/EditPublishedTripScreen.tsx",
    "src/components/event/EventCreatorWizard.tsx",
    "src/components/event/EditPublishedScreen.tsx",
    "src/components/event/CreatorStep4Cover.tsx",
    "src/components/event/types.ts",
  ];

  it.each(CALLER_FILES)(
    "T-06: %s no longer references parentScrollRef or keyboardScrollExtraOffset as identifiers",
    (file) => {
      const source = read(file);
      // Identifier-as-prop or identifier-as-destructure pattern. The
      // explanatory comments in our edits use words like "wizard-scroll-ref"
      // instead of the deleted symbol names, so they don't match.
      expect(source).not.toMatch(/\bparentScrollRef\b/);
      expect(source).not.toMatch(/\bkeyboardScrollExtraOffset\b/);
    },
  );
});
