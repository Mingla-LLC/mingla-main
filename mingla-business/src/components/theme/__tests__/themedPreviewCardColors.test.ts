/**
 * Step-6 RSVP "Preview" card (and the ticketed Step-7 card) — every text on
 * the themed mini card must read against the themed surface.
 *
 * Found filming the RSVP tutorial on the iOS simulator (brand "Lantern Room",
 * brand-default theme): the card painted `palette.page` — a near-white panel —
 * but the venue line and the "Not going" label kept the dark app-chrome token
 * `text.secondary` (rgba(255,255,255,0.72)), so both were invisible. Only the
 * date and the title had been routed through the palette.
 *
 * This pins the colour model the two cards now draw from: across a sweep of
 * 216 theme colours that resolve to BOTH light and dark surfaces, every text
 * colour clears WCAG AA (4.5:1) against the opaque fill it sits on.
 */
import { describe, expect, test } from "@jest/globals";

import {
  createThemePalette,
  resolveOfferingSurface,
} from "../../../../../packages/offering-rendering/themePalette";
import { resolveTheme } from "../../../../../packages/offering-rendering/themeResolver";
import { text as chromeText } from "../../../constants/designSystem";
import {
  AA_TEXT_CONTRAST,
  compositeOverOpaque,
  readableAccentOn,
  textContrastOn,
  themedPreviewCardColors,
} from "../themedPreviewCardColors";

const STEPS = ["00", "33", "66", "99", "cc", "ff"];
const SWEEP: string[] = STEPS.flatMap((r) =>
  STEPS.flatMap((g) => STEPS.map((b) => `#${r}${g}${b}`)),
);
// Named cases: Mingla default orange, a deep brand navy, a light pastel.
const NAMED = ["#eb7825", "#1e3a8a", "#7f1d1d", "#fde68a", "#10b981"];

const resolved = (color: string) => resolveTheme({ color }, null);

describe("themedPreviewCardColors — AA on the themed surface", () => {
  test("the sweep covers both light and dark themed surfaces", () => {
    const surfaces = new Set(
      [...SWEEP, ...NAMED].map((c) => resolveOfferingSurface(resolved(c))),
    );
    expect(surfaces).toEqual(new Set(["light", "dark"]));
  });

  test.each([...NAMED, ...SWEEP])(
    "theme %s: every text on the card clears 4.5:1 against its fill",
    (color) => {
      const card = themedPreviewCardColors(createThemePalette(resolved(color)));
      const pairs: [string, string, string][] = [
        ["date", card.dateText, card.surface],
        ["title", card.titleText, card.surface],
        ["venue", card.venueText, card.surface],
        ["recurrence pill", card.pillText, card.pillFill],
        ["Going", card.goingText, card.goingFill],
        ["Not going", card.notGoingText, card.notGoingFill],
      ];
      for (const [label, fg, bg] of pairs) {
        const ratio = textContrastOn(fg, bg);
        if (ratio < AA_TEXT_CONTRAST) {
          throw new Error(`${label} ${fg} on ${bg} = ${ratio.toFixed(2)}:1`);
        }
      }
      // Fills are opaque hex — nothing bleeds through on web or Android.
      for (const fill of [card.surface, card.pillFill, card.goingFill, card.notGoingFill]) {
        expect(fill).toMatch(/^#[0-9a-f]{6}$/i);
      }
    },
  );

  test("the shipped chrome token is exactly what failed on a light theme", () => {
    // A light-surface theme (the Lantern Room case): the old venue colour
    // composites to near-white on the page. This is the regression the model
    // exists to prevent — keep it visible so nobody routes chrome text back in.
    const palette = createThemePalette(resolved("#1e3a8a"));
    expect(resolveOfferingSurface(resolved("#1e3a8a"))).toBe("light");
    expect(textContrastOn(chromeText.secondary, palette.page)).toBeLessThan(1.5);
    const card = themedPreviewCardColors(palette);
    expect(textContrastOn(card.venueText, card.surface)).toBeGreaterThanOrEqual(
      AA_TEXT_CONTRAST,
    );
    expect(textContrastOn(card.notGoingText, card.notGoingFill)).toBeGreaterThanOrEqual(
      AA_TEXT_CONTRAST,
    );
  });

  test("readableAccentOn keeps a passing accent and nudges a failing one", () => {
    expect(readableAccentOn("#000000", "#ffffff")).toBe("#000000");
    const nudged = readableAccentOn("#eb7825", "#ffffff");
    expect(nudged).not.toBe("#eb7825");
    expect(textContrastOn(nudged, "#ffffff")).toBeGreaterThanOrEqual(AA_TEXT_CONTRAST);
  });

  test("compositeOverOpaque flattens rgba text onto the fill", () => {
    expect(compositeOverOpaque("rgba(255,255,255,0.5)", "#000000")).toBe("#808080");
    expect(compositeOverOpaque("#123456", "#ffffff")).toBe("#123456");
  });
});
