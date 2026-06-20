/**
 * RT-6 — ORCH-1138 Leg-1 NATIVE-render-parity gate (the two native-only bugs
 * that survived the R2 pass; Seth re-confirmed on the business iOS dev build).
 *
 * BUG-1 — meta-chips + "Leaving from → Destination" block MISSING on native.
 *   ROOT CAUSE: `usePublicTripBySlug` mapped `destinationLocationText` + `capacity`
 *   ONLY from the `events.theme.business_trip` JSON mirror, which is NULL for
 *   trips authored via the canonical columns (e.g. "The DC Adventure":
 *   theme mirror null, but `events.destination_text` + `ticket_types.quantity_total`
 *   populated). The authenticated `readBusinessTrip` already reads canonical-first;
 *   the public hook did not (except departure). With null destination/capacity the
 *   rule-9 null-guard hid the seats chip, the destination chip, and the destination
 *   half of the route block. (Shared hook → the SAME render path on web; web
 *   evidence was captured against a populated mirror state.) FIX: canonical-first.
 *
 * BUG-2 — bold font weights not applying on native.
 *   ROOT CAUSE: `FONT_FAMILY_MAP` loads ONE non-bold variant per theme font
 *   (e.g. "Inter_500Medium"); a Text styled `{ fontFamily: medium, fontWeight: 900 }`
 *   renders at MEDIUM on native (a loaded custom font ignores fontWeight; rn-web
 *   synthesizes bold — native-only). FIX: `boldFontFamily(theme)` →
 *   the weight-specific loaded family ("Inter_700Bold"); load it via useThemeFont.
 *
 * BUG-2 assertions are RUNTIME (the resolver is a pure function). BUG-1
 * assertions are source-string (the hook can't mount under ts-jest — mirrors
 * RT-5). fails-on-revert: deleting any asserted fix line flips a case red.
 * Owner: mingla-implementor (the tester adds a second adversarial angle).
 */

import { readFileSync } from "fs";
import path from "path";

import { describe, expect, test } from "@jest/globals";

import {
  FONT_FAMILY_BOLD_MAP,
  boldFontFamily,
} from "../../../../../packages/offering-rendering/themePalette";
import {
  FONT_FAMILY_MAP,
  THEME_FONT_SLUGS,
} from "../../../../../packages/offering-rendering/designTokens";
import type {
  ResolvedTheme,
  ThemeFontSlug,
} from "../../../../../packages/offering-rendering/designTokens";

const read = (rel: string): string =>
  readFileSync(path.join(process.cwd(), rel), "utf8");

const hookSrc = read("src/hooks/usePublicTripBySlug.ts");
const previewSrc = read("src/components/trip/TripPreview.tsx");
const routeSrc = read("app/t/[brandSlug]/[tripSlug].tsx");
const themeFontsSrc = read("src/theme/themeFonts.ts");

const mkTheme = (font: ThemeFontSlug): ResolvedTheme => ({
  color: "#eb7825",
  foregroundColor: "#ffffff",
  font,
  fontFamilyValue: FONT_FAMILY_MAP[font],
  animation: "none",
});

// The 3 single-weight display faces have NO published 700Bold variant; bold
// falls back to the base family (no synthetic bold, no missing-font fallback).
const SINGLE_WEIGHT_DISPLAY: ReadonlyArray<ThemeFontSlug> = [
  "dm_serif_display",
  "bebas_neue",
  "anton",
];

describe("RT-6 ORCH-1138 — native-only render parity", () => {
  // ---------------- BUG-2: weight-aware bold font (runtime) ----------------

  test("BUG-2: boldFontFamily returns the 700Bold family (NOT the medium) for weighted fonts", () => {
    // The load-bearing assertion: on native, setting fontWeight on the medium
    // family does nothing — bold MUST point fontFamily at a different, heavier
    // loaded family. So bold !== medium for every font that ships a bold variant.
    expect(boldFontFamily(mkTheme("inter"))).toBe("Inter_700Bold");
    expect(boldFontFamily(mkTheme("inter"))).not.toBe(
      FONT_FAMILY_MAP.inter,
    );
    expect(boldFontFamily(mkTheme("playfair_display"))).toBe(
      "PlayfairDisplay_700Bold",
    );
    expect(boldFontFamily(mkTheme("poppins"))).toBe("Poppins_700Bold");
  });

  test("BUG-2: every theme slug resolves to a non-empty bold family", () => {
    for (const slug of THEME_FONT_SLUGS) {
      const bold = boldFontFamily(mkTheme(slug));
      expect(typeof bold).toBe("string");
      expect(bold.length).toBeGreaterThan(0);
    }
  });

  test("BUG-2: the 3 single-weight display faces fall back to their base family", () => {
    for (const slug of SINGLE_WEIGHT_DISPLAY) {
      expect(boldFontFamily(mkTheme(slug))).toBe(FONT_FAMILY_MAP[slug]);
    }
  });

  test("BUG-2: every bold family that is NOT a base-fallback is registered as a loadable thunk", () => {
    // A bold family referenced but not registered in themeFonts.ts would never
    // load on native → useThemeFont(boldFamily) is a no-op → system fallback.
    for (const slug of THEME_FONT_SLUGS) {
      const bold = FONT_FAMILY_BOLD_MAP[slug];
      if (bold === FONT_FAMILY_MAP[slug]) continue; // base-fallback, already registered
      expect(themeFontsSrc).toContain(`${bold}: () =>`);
    }
  });

  test("BUG-2: the trip page renders bold text with the bold family, not fontWeight alone", () => {
    // [TEST-MOD-APPROVED META-ORCH-1174] retarget: the bold-text render moved into
    // the shared TripOfferingBody — it derives boldFamily = boldFontFamily(theme)
    // and applies { fontFamily: boldFamily } to the title, section titles, and the
    // §3 full-width route pills (the weight-aware fix, byte-preserved).
    const bodySrc = read("../packages/offering-rendering/TripOfferingBody.tsx");
    expect(bodySrc).toContain("const boldFamily = boldFontFamily(theme);");
    expect(bodySrc).toContain(
      "styles.title, surface.primaryText, { fontFamily: boldFamily }",
    );
    expect(bodySrc).toContain(
      "surface.primaryText, { fontFamily: boldFamily }",
    );
    // the §3 route pills carry the bold family on their value text.
    expect(bodySrc).toMatch(
      /styles\.fullPillText,\s*\n?\s*\{ color: palette\.primaryText, fontFamily: boldFamily \}/,
    );
    // the §4 meta pills + brand name apply the bold font family too.
    expect(bodySrc).toContain("fontFamily: boldFamily");
  });

  test("BUG-2: the route LOADS the bold family via useThemeFont (else it never registers)", () => {
    expect(routeSrc).toContain("const boldFamily = boldFontFamily(theme);");
    expect(routeSrc).toContain("useThemeFont(boldFamily);");
    // the medium load is preserved (additive, not replaced).
    expect(routeSrc).toContain("useThemeFont(theme.fontFamilyValue);");
  });

  // ---------------- BUG-1: canonical-first meta-chip/route data ----------------

  test("BUG-1: the public hook reads destination from the CANONICAL column first", () => {
    // canonical events.destination_text wins; theme mirror is fallback only.
    expect(hookSrc).toContain("typeof event.destination_text === \"string\"");
    expect(hookSrc).toMatch(
      /destinationLocationText:[\s\S]*?event\.destination_text[\s\S]*?:[\s\S]*?bt\.destinationLocationText/,
    );
  });

  test("BUG-1: the public hook reads capacity from the CANONICAL ticket quantity first", () => {
    // capacity from ticket_types[0].quantity_total (mirrors readBusinessTrip),
    // theme mirror only as fallback.
    expect(hookSrc).toContain("typeof tickets[0]?.quantity_total === \"number\"");
    expect(hookSrc).toMatch(
      /capacity:[\s\S]*?tickets\[0\]\.quantity_total[\s\S]*?:[\s\S]*?bt\.capacity/,
    );
  });
});
