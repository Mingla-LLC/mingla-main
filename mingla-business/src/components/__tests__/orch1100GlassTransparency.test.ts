import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "@jest/globals";

/**
 * ORCH-1100 RC-2 — width-aware glass opaque-fallback regression gate.
 *
 * Device-proven bug: on phone web (< 768px) the injected blur-kill media rule
 * (`scripts/inject-mobile-blur-css.mjs`, `@media (max-width:767px)`) strips
 * `backdrop-filter` even though `CSS.supports("backdrop-filter")` still returns
 * true. The "Switch brand" TopSheet (and 4 sibling glass surfaces) rendered a
 * BlurView whose blur was stripped → `background-color: rgba(0,0,0,0)` (fully
 * transparent panel; page content showed straight through).
 *
 * The ONE correct implementation lived in SheetMobile (`!(Platform.OS==="web"
 * && windowWidth<768)`). RC-2 extracted that awareness into the shared
 * `utils/glassBlur.shouldUseRealBlur(windowWidth)` helper and applied it to the
 * 5 gapped components + refactored SheetMobile to use it too (single source of
 * truth).
 *
 * This gate pins: each glass surface (a) imports the shared helper and (b) drives
 * its blur/opaque decision through `shouldUseRealBlur(windowWidth)` with a live
 * window width, and (c) keeps the kit opaque fallback fill `rgba(20,22,26,0.92)`.
 * If anyone reverts a component back to a width-blind `shouldUseRealBlur()` (no
 * arg) or a bare `Platform.OS` check, transparency can return on phone web —
 * this test FAILS, which is the fails-on-revert anchor.
 *
 * jest.config.cjs uses `testEnvironment: node` (no jsdom) — source/structural
 * assertions are the established business CI pattern. The helper's runtime
 * behavior is independently exercised in `utils/__tests__/glassBlur.test.ts`.
 */

const BIZ_SRC = path.resolve(__dirname, "..", "..");
const read = (rel: string): string =>
  fs.readFileSync(path.join(BIZ_SRC, rel), "utf8");

const stripComments = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

// [TEST-MOD-APPROVED #4420] Wave 2 moved SheetMobile, TopSheet, GlassChrome and
// Toast onto `<Material>`, the one glass owner, which routes the SAME
// width-aware decision through `shouldUseRealBlur(width)` and paints the solid
// material fill below the threshold. Those four are now pinned by the
// MATERIAL_SURFACES block below (they render <Material>, never their own
// BlurView); Material itself is pinned here and in issue_4420_material.test.tsx.
// The intent (no see-through glass on phone web / Android) is unchanged.
// [TEST-MOD-APPROVED #4420] Wave 5 moved BlastCustomersCta and
// AiDisclosureModal onto <Material> too, so no feature surface owns a BlurView
// any more: they are pinned by MATERIAL_SURFACES (render <Material>, no
// expo-blur import). The width-aware intent is unchanged; Material carries it.
const WIDTH_AWARE_SURFACES: readonly string[] = [];

const MATERIAL_SURFACES: readonly string[] = [
  "components/ui/SheetMobile.tsx",
  "components/ui/TopSheet.tsx",
  "components/ui/GlassChrome.tsx",
  "components/ui/Toast.tsx",
  "components/marketing/BlastCustomersCta.tsx",
  "components/ari/AiDisclosureModal.tsx",
];

describe("#4420 — Material is the width-aware glass owner", () => {
  const material = stripComments(read("components/ui/Material.tsx"));
  test("Material routes web through shouldUseRealBlur(width) with a live window width", () => {
    expect(material).toMatch(/import\s*\{[^}]*shouldUseRealBlur[^}]*\}\s*from\s*["'][^"']*glassBlur["']/);
    expect(material).toMatch(/shouldUseRealBlur\(width\)/);
    expect(material).toMatch(/useWindowDimensions\(\)/);
  });
  test.each(MATERIAL_SURFACES.map((f) => [f]))("%s draws its glass through <Material>, not a BlurView", (rel) => {
    const code = stripComments(read(rel));
    expect(code).toMatch(/<Material\b/);
    expect(code).not.toMatch(/from\s*["']expo-blur["']/);
    expect(code).not.toMatch(/const\s+supportsBackdropFilter\b/);
  });
});

describe("ORCH-1100 RC-2 — shared helper exists + breakpoint", () => {
  const helper = read("utils/glassBlur.ts");

  test("glassBlur exports shouldUseRealBlur taking a windowWidth arg", () => {
    expect(helper).toMatch(
      /export\s+const\s+shouldUseRealBlur\s*=\s*\(windowWidth:\s*number\)/,
    );
  });

  test("helper paints opaque below the 768px blur-kill breakpoint", () => {
    expect(helper).toMatch(/MOBILE_WEB_BLUR_KILL_MAX_WIDTH\s*=\s*768/);
    expect(helper).toMatch(
      /windowWidth\s*<\s*MOBILE_WEB_BLUR_KILL_MAX_WIDTH[\s\S]{0,40}return\s+false/,
    );
  });

  test("iOS=blur, Android=opaque branches preserved", () => {
    expect(helper).toMatch(/Platform\.OS\s*===\s*["']ios["'][\s\S]{0,40}return\s+true/);
    expect(helper).toMatch(/Platform\.OS\s*===\s*["']android["'][\s\S]{0,40}return\s+false/);
  });
});

(WIDTH_AWARE_SURFACES.length > 0 ? describe.each(WIDTH_AWARE_SURFACES.map((f) => [f])) : describe.skip.each([["(none)"]]))(
  "ORCH-1100 RC-2 — %s is width-aware",
  (rel) => {
    // [TEST-MOD-APPROVED #4420] no feature surface owns its own blur any more.
    if (rel === "(none)") return;
    const code = stripComments(read(rel));

    test("imports shouldUseRealBlur from the shared glassBlur helper", () => {
      expect(code).toMatch(
        /import\s*\{[^}]*shouldUseRealBlur[^}]*\}\s*from\s*["'][^"']*glassBlur["']/,
      );
    });

    test("calls shouldUseRealBlur(windowWidth) — width-aware, not width-blind", () => {
      expect(code).toMatch(/shouldUseRealBlur\(windowWidth\)/);
      // Guard against a regression to the old no-arg signature.
      expect(code).not.toMatch(/shouldUseRealBlur\(\s*\)/);
    });

    test("reads a live window width via useWindowDimensions", () => {
      expect(code).toMatch(/useWindowDimensions/);
      expect(code).toMatch(/width:\s*windowWidth\s*\}\s*=\s*useWindowDimensions\(\)/);
    });

    test("keeps the kit opaque fallback fill (solid rgb / rgba ≥0.92 / opaque #hex)", () => {
      const hasRgbaFallback = /rgba\(20,\s*22,\s*26,\s*0\.92\)/.test(code);
      // [ORCH-1062 drift-update] TopSheet's kit opaque fallback was HARDENED from
      // rgba(20,22,26,0.92) to the FULLY-opaque rgb(20, 22, 26) because at 0.92
      // the home screen bled through under a blur-capable ancestor (see the
      // FALLBACK_BACKGROUND source comment). A solid rgb (alpha 1.0) is MORE
      // opaque than the ≥0.92 contract, not less — the guarantee strengthened.
      const hasSolidRgbFallback = /rgb\(20,\s*22,\s*26\)/.test(code);
      // AiDisclosureModal uses an opaque #hex sheet (opaqueSheet) instead of the
      // rgba token — all three satisfy the ≥0.92 opaque-fallback contract.
      const hasHexFallback = /backgroundColor:\s*["']#[0-9a-fA-F]{6}["']/.test(code);
      expect(hasRgbaFallback || hasSolidRgbFallback || hasHexFallback).toBe(true);
    });

    test("does NOT define its own local supportsBackdropFilter (single source of truth)", () => {
      // The per-component copies were removed in RC-2; the only definition lives
      // in utils/glassBlur.ts. A re-introduced local copy means the awareness
      // drifted back out of the shared helper.
      expect(code).not.toMatch(/const\s+supportsBackdropFilter\b/);
      expect(code).not.toMatch(/const\s+shouldUseRealBlur\b/);
    });
  },
);
