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

  // --- T-03: BrandEditView imports KeyboardAvoidingView from the wrapper (v2 contract post-QA rework Path A) ---
  // Contract updated under ORCH-0840 [Regression-test enforcement + append-only CI] override
  // token [TEST-MOD-APPROVED ORCH-0892-A] — see commit body. Original v1 contract asserted
  // direct library import; v2 routes through src/wrappers/KeyboardAvoidingView so Metro
  // keeps the library out of the web bundle (QA TA-1).
  it("T-03: BrandEditView.tsx imports KeyboardAvoidingView from the wrapper (v2)", () => {
    const source = read("src/components/brand/BrandEditView.tsx");
    expect(source).toMatch(
      /import\s+\{\s*KeyboardAvoidingView\s*\}\s+from\s+["']\.\.\/\.\.\/wrappers\/KeyboardAvoidingView["']/,
    );
    // Library is NEVER imported directly from pilot files (v2 contract).
    expect(source).not.toMatch(
      /from\s+["']react-native-keyboard-controller["']/,
    );
    // The react-native import block must NOT include KeyboardAvoidingView
    // (the wrapper is the single owner).
    const reactNativeImportBlockMatch = source.match(
      /import\s+\{[^}]+\}\s+from\s+["']react-native["']/,
    );
    expect(reactNativeImportBlockMatch).not.toBeNull();
    expect(reactNativeImportBlockMatch?.[0] ?? "").not.toMatch(
      /\bKeyboardAvoidingView\b/,
    );
  });

  // --- T-03b (sibling): TripBrandWizard same v2 contract ---
  it("T-03b: TripBrandWizard.tsx imports KeyboardAvoidingView from the wrapper (v2), retains Keyboard from react-native for Keyboard.dismiss()", () => {
    const source = read("src/components/brand/TripBrandWizard.tsx");
    expect(source).toMatch(
      /import\s+\{\s*KeyboardAvoidingView\s*\}\s+from\s+["']\.\.\/\.\.\/wrappers\/KeyboardAvoidingView["']/,
    );
    expect(source).not.toMatch(
      /from\s+["']react-native-keyboard-controller["']/,
    );
    // Keyboard (without "AvoidingView") import retained for Keyboard.dismiss().
    expect(source).toMatch(/Keyboard\.dismiss\(\)/);
    const reactNativeImportBlockMatch = source.match(
      /import\s+\{[^}]+\}\s+from\s+["']react-native["']/,
    );
    expect(reactNativeImportBlockMatch).not.toBeNull();
    expect(reactNativeImportBlockMatch?.[0] ?? "").not.toMatch(
      /\bKeyboardAvoidingView\b/,
    );
    expect(reactNativeImportBlockMatch?.[0] ?? "").toMatch(/\bKeyboard,/);
  });

  // --- T-04: CoverPicker no longer declares parentScrollRef / keyboardScrollExtraOffset props (v2 contract) ---
  it("T-04: CoverPicker.tsx no longer declares parentScrollRef or keyboardScrollExtraOffset in CoverPickerProps, imports KAV from wrapper (v2)", () => {
    const source = read("src/components/ui/CoverPicker.tsx");
    // Locate the CoverPickerProps interface block.
    const interfaceMatch = source.match(
      /export\s+interface\s+CoverPickerProps\s*\{[\s\S]*?\n\}/,
    );
    expect(interfaceMatch).not.toBeNull();
    const interfaceBody = interfaceMatch?.[0] ?? "";
    // Neither prop name appears in the interface block.
    expect(interfaceBody).not.toMatch(/parentScrollRef/);
    expect(interfaceBody).not.toMatch(/keyboardScrollExtraOffset/);
    // CoverPicker imports KeyboardAvoidingView from the wrapper (v2),
    // NOT directly from the library.
    expect(source).toMatch(
      /import\s+\{\s*KeyboardAvoidingView\s*\}\s+from\s+["']\.\.\/\.\.\/wrappers\/KeyboardAvoidingView["']/,
    );
    expect(source).not.toMatch(
      /import\s+\{[^}]*KeyboardAvoidingView[^}]*\}\s+from\s+["']react-native-keyboard-controller["']/,
    );
    // The deleted ORCH-0884 #8 + #9 paths are gone — no findNodeHandle,
    // no scrollResponderScrollNativeHandleToKeyboard, no Keyboard.addListener.
    expect(source).not.toMatch(/findNodeHandle/);
    expect(source).not.toMatch(/scrollResponderScrollNativeHandleToKeyboard/);
    expect(source).not.toMatch(/Keyboard\.addListener/);
  });

  // --- T-05: CoverPicker search section is wrapped in library's <KeyboardAvoidingView> ---
  // (This test is the "lift" assertion that the library's KAV is actually
  //  used, not just imported. It's the key fails-on-revert anchor: revert
  //  the JSX wrap and this test fails because the library KAV is no longer
  //  in the JSX tree wrapping the supportsSearch block.)
  it("T-05: CoverPicker.tsx search section is wrapped in <KeyboardAvoidingView behavior=\"padding\">", () => {
    const source = read("src/components/ui/CoverPicker.tsx");
    // The JSX wrap pattern: supportsSearch ternary wraps KeyboardAvoidingView with behavior="padding".
    // Permissive regex: match the supportsSearch ternary + the KAV opener.
    expect(source).toMatch(
      /\{supportsSearch\s*\?\s*\(\s*<KeyboardAvoidingView\s+behavior=["']padding["']/,
    );
  });
});

describe("ORCH-0892-A v2 KeyboardAvoidingView wrapper (post-QA rework Path A)", () => {
  // --- T-07: wrapper web variant re-exports react-native's KAV (no library import) ---
  it("T-07: KeyboardAvoidingView.tsx (web variant) re-exports from 'react-native' and does NOT import the library", () => {
    const source = read("src/wrappers/KeyboardAvoidingView.tsx");
    expect(source).toMatch(
      /export\s+\{\s*KeyboardAvoidingView\s*\}\s+from\s+["']react-native["']/,
    );
    expect(source).not.toMatch(
      /from\s+["']react-native-keyboard-controller["']/,
    );
  });

  // --- T-08: wrapper native variant re-exports library's KAV ---
  it("T-08: KeyboardAvoidingView.native.tsx (native variant) re-exports from 'react-native-keyboard-controller'", () => {
    const source = read("src/wrappers/KeyboardAvoidingView.native.tsx");
    expect(source).toMatch(
      /export\s+\{\s*KeyboardAvoidingView\s*\}\s+from\s+["']react-native-keyboard-controller["']/,
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
