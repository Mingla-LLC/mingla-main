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

// The 5 gapped components + the canonical SheetMobile (now refactored onto the
// shared helper). All must use the WIDTH-AWARE shared decision.
const WIDTH_AWARE_SURFACES: readonly string[] = [
  "components/ui/SheetMobile.tsx",
  "components/ui/TopSheet.tsx",
  "components/ui/GlassChrome.tsx",
  "components/ui/Toast.tsx",
  "components/marketing/BlastCustomersCta.tsx",
  "components/ari/AiDisclosureModal.tsx",
];

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

describe.each(WIDTH_AWARE_SURFACES.map((f) => [f]))(
  "ORCH-1100 RC-2 — %s is width-aware",
  (rel) => {
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

    test("keeps the kit opaque fallback fill rgba(20,22,26,0.92) / opaque #hex", () => {
      const hasRgbaFallback = /rgba\(20,\s*22,\s*26,\s*0\.92\)/.test(code);
      // AiDisclosureModal uses an opaque #hex sheet (opaqueSheet) instead of the
      // rgba token — both satisfy the ≥0.92 opaque-fallback contract.
      const hasHexFallback = /backgroundColor:\s*["']#[0-9a-fA-F]{6}["']/.test(code);
      expect(hasRgbaFallback || hasHexFallback).toBe(true);
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
