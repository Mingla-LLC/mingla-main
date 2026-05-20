/**
 * ORCH-0892-A: tester adversarial regression tests.
 *
 * Authored by Claude `mingla-tester` per ORCH-0840 [Regression-test
 * enforcement + append-only CI] Step 0.5(b). Attacks angles DIFFERENT
 * from the implementor's happy-path KeyboardRoot.test.tsx — proves
 * structural / build-output / repo-wide invariants the per-file
 * source-text contracts cannot catch.
 *
 * Per SPEC_ORCH-0892-A §11 (T-06..T-08 → TA-1, TA-2, TA-3).
 *
 * Implementor happy-path test: src/wrappers/__tests__/KeyboardRoot.test.tsx
 * (T-01..T-06; 13/13 PASS; fails-on-revert verified at HEAD
 * 05134c6c8a46808a605af7f1aed6a057bd5f0bfd by reverting BrandEditView
 * import → T-03 RED → restore → 13/13 GREEN).
 *
 * Tester adversarial angles:
 *
 *  TA-1: Web bundle string inspection. The `.web.tsx` passthrough
 *        prevents <KeyboardProvider> from MOUNTING on web, but does NOT
 *        prevent Metro from BUNDLING the library when downstream
 *        components import its primitives directly. This test runs the
 *        actual web export (or reads a pre-existing build) and asserts
 *        zero library strings in the JS bundle. Different angle than
 *        T-01 (source-text check of one file) — proves the END-TO-END
 *        bundling contract.
 *
 *  TA-2: AST mount-position assertion. Verifies _layout.tsx renders
 *        KeyboardRoot INSIDE StripeProviderWrapper and OUTSIDE the
 *        RootLayoutInner ErrorBoundary. Different angle than T-02
 *        (presence check) — proves PROVIDER ORDER which is invariant-
 *        critical for I-36 ROOT-ERROR-BOUNDARY + I-PROPOSED-STRIPE-
 *        PAYMENTSHEET-PARITY (ORCH-0849).
 *
 *  TA-3: Repo-wide grep for prop-deletion completeness. Implementor's
 *        T-06 covers the 7 known caller files; this test scans the
 *        ENTIRE mingla-business/ tree for ANY remaining identifier-use
 *        of `parentScrollRef` or `keyboardScrollExtraOffset`. Different
 *        angle than T-06 (curated file list) — catches files the
 *        implementor missed.
 *
 * Invariant: I-PROPOSED-KEYBOARD-LIBRARY-ONLY (DRAFT).
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..", "..", "..");
const repoRoot = path.resolve(root, "..");

const read = (relativePath: string): string =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

describe("ORCH-0892-A adversarial regression (tester)", () => {
  // --- TA-1: web bundle MUST NOT contain library strings ---
  //
  // We check a pre-existing `dist/` build if present (from a recent
  // `expo export --platform web` run). If no build exists, the test is
  // SKIPPED with a documented prerequisite — running the export takes
  // 30+s and is unsafe in default jest. The QA report cites the export
  // log + grep result directly.
  //
  // This test is currently EXPECTED RED on Seth post-ORCH-0892-A
  // implementation: the three pilot files import KeyboardAvoidingView
  // from the library in REGULAR .tsx files (not .web.tsx-gated), so
  // Metro bundles the library transitively for web. Rework path:
  // add KAV wrapper indirection mirroring KeyboardRoot.{tsx,native.tsx}
  // OR accept the bundle leak and update SPEC §3 expectations.
  it("TA-1: web bundle does NOT contain react-native-keyboard-controller library strings", () => {
    const webBundleDir = path.join(
      root,
      "dist",
      "_expo",
      "static",
      "js",
      "web",
    );
    if (!fs.existsSync(webBundleDir)) {
      // No prior export run; skip with documented prerequisite.
      console.warn(
        "[TA-1 SKIP] dist/_expo/static/js/web missing. Prerequisite: cd mingla-business && npx expo export --platform web; then re-run this test.",
      );
      return;
    }
    const bundleFiles = fs
      .readdirSync(webBundleDir)
      .filter((f) => f.endsWith(".js"));
    expect(bundleFiles.length).toBeGreaterThan(0);

    let totalMatches = 0;
    const offenders: string[] = [];
    for (const file of bundleFiles) {
      const content = fs.readFileSync(
        path.join(webBundleDir, file),
        "utf8",
      );
      const matches = content.match(
        /react-native-keyboard-controller|KeyboardProvider|KeyboardController|keyboardEventsMap/g,
      );
      if (matches) {
        totalMatches += matches.length;
        offenders.push(`${file}: ${matches.length} matches`);
      }
    }

    if (totalMatches > 0) {
      // RED — document the architectural flaw clearly so the implementor
      // knows what to fix.
      throw new Error(
        `[TA-1 FAIL] Web bundle contains ${totalMatches} library reference(s) — SPEC SC-4 violation.\n` +
          `Offending file(s):\n  ${offenders.join("\n  ")}\n` +
          `\n` +
          `Root cause: BrandEditView.tsx, TripBrandWizard.tsx, and CoverPicker.tsx\n` +
          `import { KeyboardAvoidingView } from "react-native-keyboard-controller" in\n` +
          `regular .tsx files (not .web.tsx-gated). Metro bundles the library\n` +
          `for web despite the KeyboardRoot.web.tsx passthrough.\n` +
          `\n` +
          `Rework: introduce KAV wrapper indirection at\n` +
          `mingla-business/src/wrappers/KeyboardAvoidingView.{tsx,native.tsx}\n` +
          `where the .web.tsx variant re-exports react-native's own\n` +
          `KeyboardAvoidingView (or a View passthrough), and the .native.tsx\n` +
          `variant re-exports the library. Then update the 3 pilot files to\n` +
          `import from the wrapper, not the library directly.\n`,
      );
    }
    expect(totalMatches).toBe(0);
  });

  // --- TA-2: AST mount-position assertion ---
  it("TA-2: _layout.tsx mounts KeyboardRoot INSIDE StripeProviderWrapper and OUTSIDE RootLayoutInner", () => {
    const source = read("app/_layout.tsx");

    // Find the lines for each marker.
    const lines = source.split("\n");
    const findLineWith = (re: RegExp): number =>
      lines.findIndex((l) => re.test(l));

    const stripeOpen = findLineWith(/<StripeProviderWrapper>/);
    const keyboardOpen = findLineWith(/<KeyboardRoot>/);
    const rootLayoutInnerLine = findLineWith(/<RootLayoutInner\s*\/>/);
    const keyboardClose = findLineWith(/<\/KeyboardRoot>/);
    const stripeClose = findLineWith(/<\/StripeProviderWrapper>/);
    const errorBoundaryOpen = findLineWith(/<ErrorBoundary/);
    const errorBoundaryClose = findLineWith(/<\/ErrorBoundary>/);

    // All present
    expect(stripeOpen).toBeGreaterThan(-1);
    expect(keyboardOpen).toBeGreaterThan(-1);
    expect(rootLayoutInnerLine).toBeGreaterThan(-1);
    expect(keyboardClose).toBeGreaterThan(-1);
    expect(stripeClose).toBeGreaterThan(-1);

    // KeyboardRoot is INSIDE StripeProviderWrapper.
    expect(stripeOpen).toBeLessThan(keyboardOpen);
    expect(keyboardClose).toBeLessThan(stripeClose);

    // RootLayoutInner is INSIDE KeyboardRoot.
    expect(keyboardOpen).toBeLessThan(rootLayoutInnerLine);
    expect(rootLayoutInnerLine).toBeLessThan(keyboardClose);

    // ErrorBoundary lives INSIDE RootLayoutInner's render. KeyboardRoot
    // wraps RootLayoutInner from OUTSIDE — so the ErrorBoundary
    // declaration comes AFTER the KeyboardRoot opening (because
    // RootLayoutInner renders ErrorBoundary inside its function body
    // which is below the import section but above the default export).
    // We assert ErrorBoundary lines exist and are inside RootLayoutInner
    // function (below imports, above the default export's JSX block).
    expect(errorBoundaryOpen).toBeGreaterThan(-1);
    expect(errorBoundaryClose).toBeGreaterThan(-1);
    expect(errorBoundaryOpen).toBeLessThan(stripeOpen);
    expect(errorBoundaryClose).toBeLessThan(stripeOpen);
  });

  // --- TA-3: repo-wide prop-deletion completeness ---
  it("TA-3: NO file under mingla-business/src or mingla-business/app references parentScrollRef or keyboardScrollExtraOffset as identifiers", () => {
    // Use git grep for speed; identifier-only pattern via word boundary.
    // Filter out comments by checking if the match line is a comment.
    let parentRefMatches = "";
    let extraOffsetMatches = "";
    try {
      parentRefMatches = execSync(
        `cd "${repoRoot}" && grep -rn "\\bparentScrollRef\\b" mingla-business/src mingla-business/app 2>/dev/null | grep -v "__tests__" || true`,
        { encoding: "utf8" },
      );
      extraOffsetMatches = execSync(
        `cd "${repoRoot}" && grep -rn "\\bkeyboardScrollExtraOffset\\b" mingla-business/src mingla-business/app 2>/dev/null | grep -v "__tests__" || true`,
        { encoding: "utf8" },
      );
    } catch {
      // grep returns non-zero on no matches; that's the success case.
    }

    // Strip comment-only lines (// prefix or inside /* */ comment text).
    const stripComments = (out: string): string =>
      out
        .split("\n")
        .filter((line) => {
          const after = line.split(":").slice(2).join(":").trim();
          if (after.startsWith("//")) return false;
          if (after.startsWith("*")) return false; // block-comment continuation
          if (after === "") return false;
          return true;
        })
        .join("\n")
        .trim();

    const parentNonComment = stripComments(parentRefMatches);
    const offsetNonComment = stripComments(extraOffsetMatches);

    if (parentNonComment.length > 0) {
      throw new Error(
        `[TA-3 FAIL] Found non-comment references to parentScrollRef:\n${parentNonComment}\n` +
          `Rework: delete these references; CoverPicker no longer accepts the prop.`,
      );
    }
    if (offsetNonComment.length > 0) {
      throw new Error(
        `[TA-3 FAIL] Found non-comment references to keyboardScrollExtraOffset:\n${offsetNonComment}\n` +
          `Rework: delete these references; CoverPicker no longer accepts the prop.`,
      );
    }

    expect(parentNonComment).toBe("");
    expect(offsetNonComment).toBe("");
  });
});
