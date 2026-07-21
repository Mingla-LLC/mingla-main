import { readFileSync } from "fs";
import path from "path";

import { describe, expect, jest, test } from "@jest/globals";

/**
 * #1022 A/F-12 (Trip leg) — the Trip review preview must repaint with the
 * chosen theme.
 *
 * The incoherence this closes: the review step shows a Theme row reading
 * "Custom colour" directly beside a preview rendering the fixed platform
 * orange. Every other offering type's review preview themes correctly, so
 * Trip was the lone odd one out.
 *
 * ADDITIVE BY CONTRACT. `theme` is OPTIONAL on LegacyTripPreview: absent ⇒ the
 * byte-stable prior render with `accent.warm`. It also does NOT flip the
 * render mode — the FOUNDATION fork requires `palette` AND `theme` AND the
 * three chrome handlers, and the wizard passes none of those.
 *
 * Fails-on-revert target: drop the `theme=` prop at the review call site, or
 * revert the accent-bearing elements to the hardcoded `accent.warm`.
 */

jest.mock("../../services/supabase", () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));

const src = (rel: string): string =>
  readFileSync(path.join(process.cwd(), rel), "utf8");

const PREVIEW = "src/components/trip/TripPreview.tsx";
const REVIEW = "src/components/trip/TripCreatorStep5Review.tsx";

/** The LegacyTripPreview component body only. */
const legacyBody = (): string => {
  const s = src(PREVIEW);
  const start = s.indexOf("const LegacyTripPreview");
  const end = s.indexOf("const styles = StyleSheet.create(");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return s.slice(start, end);
};

describe("the review step feeds the preview a resolved theme", () => {
  test("TripCreatorStep5Review passes `theme` to TripPreview", () => {
    expect(src(REVIEW)).toMatch(
      /<TripPreview[\s\S]*?theme=\{resolveTheme\(brandTheme, themeOverrides \?\? null\)\}/,
    );
  });

  test("it resolves with the BRAND FIRST — the C-1 argument order", () => {
    // resolveTheme(brandTheme, offeringOverride). Backwards is the bug that
    // shipped: the offering override in the brand slot makes an unthemed
    // offering preview Mingla defaults.
    expect(src(REVIEW)).toContain("resolveTheme(brandTheme, themeOverrides ?? null)");
    expect(src(REVIEW)).not.toMatch(/resolveTheme\(\s*themeOverrides/);
  });

  test("the review row and the preview read the SAME source of truth", () => {
    // Both take `themeOverrides`, so the row can never claim a theme the
    // preview beside it does not render.
    const s = src(REVIEW);
    expect(s).toMatch(/<ThemeControlRow[\s\S]*?value=\{themeOverrides\}/);
    expect(s).toMatch(/<TripPreview[\s\S]*?themeOverrides \?\? null/);
  });
});

describe("the legacy preview repaints its accent-bearing elements", () => {
  test("LegacyTripPreview accepts an OPTIONAL theme", () => {
    expect(legacyBody()).toMatch(/theme\?: ResolvedTheme;/);
  });

  test("it derives the accent from the theme, falling back to the platform accent", () => {
    // The fallback is what keeps every pre-existing caller byte-stable.
    expect(legacyBody()).toMatch(
      /const legacyAccent =\s*theme !== undefined \? createThemePalette\(theme\)\.accent : accent\.warm;/,
    );
  });

  test("no accent-bearing element in the legacy body is hardcoded any more", () => {
    // Icons, the day ordinal and the Reserve CTA all previously used the fixed
    // platform accent, which is exactly what made the preview lie.
    expect(legacyBody()).not.toContain("color={accent.warm}");
  });

  test("the day ordinal and the Reserve CTA repaint from the themed accent", () => {
    const body = legacyBody();
    expect(body).toMatch(/styles\.legacyDayOrdinal, \{ color: legacyAccent \}/);
    expect(body).toMatch(/styles\.legacyReserveCta, \{ backgroundColor: legacyAccent \}/);
  });

  test("the themed accent is used in at least 5 places (the 4 meta icons + the check)", () => {
    const uses = legacyBody().match(/legacyAccent/g) ?? [];
    // 1 declaration + >=7 usages
    expect(uses.length).toBeGreaterThanOrEqual(8);
  });
});

describe("ADDITIVE — no existing consumer changes behaviour", () => {
  test("`theme` is optional, so callers that omit it render exactly as before", () => {
    expect(legacyBody()).toMatch(/theme\?: ResolvedTheme;/);
    expect(legacyBody()).toContain(": accent.warm;");
  });

  test("the wizard still passes NO palette — it stays in LEGACY mode", () => {
    // Passing palette would flip it to the immersive FOUNDATION page, a
    // completely different render. The ORCH-1138 additive-caller test pins
    // this too; asserted here so the intent is explicit.
    const usage = src(REVIEW).match(/<TripPreview[\s\S]*?\/>/)?.[0] ?? "";
    expect(usage).not.toContain("palette");
    expect(usage).toContain("theme=");
  });

  test("the wizard passes none of the three chrome handlers the fork requires", () => {
    const usage = src(REVIEW).match(/<TripPreview[\s\S]*?\/>/)?.[0] ?? "";
    for (const handler of ["onClose=", "onShare=", "onToggleMute="]) {
      expect(usage).not.toContain(handler);
    }
  });

  test("the public trip route is untouched and still themes via FOUNDATION", () => {
    const route = src("app/t/[brandSlug]/[tripSlug].tsx");
    expect(route).toContain("palette={palette}");
    // and it already resolved with the brand first — unchanged by this build
    expect(route).toContain(
      "resolveTheme(payload.brand.theme ?? null, payload.themeOverrides ?? null)",
    );
  });
});
