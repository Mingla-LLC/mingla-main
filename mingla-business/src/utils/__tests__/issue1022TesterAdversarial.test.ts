import { readFileSync } from "fs";
import path from "path";

import { describe, expect, test } from "@jest/globals";

import {
  normalizeThemeOverrides,
  themeAxisIsInherited,
  themeOverridesFromColumns,
  themeOverridesToColumns,
} from "../../services/offeringTheme";

/**
 * #1022 — TESTER adversarial suite.
 *
 * Deliberately a DIFFERENT ANGLE from the implementor's happy-path suites.
 * The implementor asserted that each contract is present; this suite attacks
 * the geometry and the render-time data sources that the source gates never
 * looked at, and it encodes three defects proven at runtime on a physical
 * Samsung SM-A725F (Android 14) and an iPhone 17 Pro simulator.
 *
 * THREE BLOCKS BELOW ARE EXPECTED TO BE RED ON `1022-theme-control` AS
 * SHIPPED. That is the point — they are the executable form of tester
 * findings F-2, F-3 and F-4 and they turn green when those are fixed.
 * Do NOT weaken them to make CI green; the code is what is wrong.
 *
 * Source-gate style (readFileSync) follows the repo precedent already used by
 * `issue1022ThemeSheetLayout.test.ts`: every host is a JSX module that
 * transitively imports react-native, and the default jest project is node/
 * ts-jest with no RN transform.
 */

const src = (rel: string): string =>
  readFileSync(path.join(process.cwd(), rel), "utf8");

const SHEET = "src/components/theme/ThemeSheet.tsx";
const SHEET_MOBILE = "src/components/ui/SheetMobile.tsx";

/* ------------------------------------------------------------------ *
 * F-2 — the dismiss band is an OVERLAY that swallows consumer taps.
 * ------------------------------------------------------------------ */
describe("F-2 — the 52pt dismiss band must not cover interactive sheet content", () => {
  test("the band is not taller than the handle region it is supposed to cover", () => {
    const s = src(SHEET_MOBILE);

    const band = /SHEET_DRAG_BAND_HEIGHT\s*=\s*(\d+)/.exec(s);
    expect(band).not.toBeNull();
    const bandHeight = Number(band?.[1]);

    // `handleWrap` is the ONLY chrome the band is meant to sit over:
    //   paddingVertical: spacing.sm + 2  (= 10)  x2   + handle height (4)
    const pad = /handleWrap:\s*\{[^}]*paddingVertical:\s*spacing\.sm\s*\+\s*(\d+)/.exec(s);
    const handleH = /handle:\s*\{[^}]*height:\s*(\d+)/.exec(s);
    expect(pad).not.toBeNull();
    expect(handleH).not.toBeNull();

    const SPACING_SM = 8;
    const handleRegion =
      2 * (SPACING_SM + Number(pad?.[1])) + Number(handleH?.[1]);

    // `nativeDragCatch` is position:absolute, top:0, rendered AFTER the panel
    // inner, with no `pointerEvents` escape hatch — so every pixel by which it
    // exceeds the handle region is a strip of CONSUMER CONTENT that can no
    // longer be tapped on iOS/Android. Proven on device: the sweep found close
    // buttons inside that strip on ShareModal, CoverPickerSheet,
    // GlobalSearchSheet, TripDayMediaSheet and ExperienceStopPhotoSheet.
    expect(bandHeight).toBeLessThanOrEqual(handleRegion);
  });

  test("if the band DOES overlay content it must let non-drag taps through", () => {
    const s = src(SHEET_MOBILE);
    const idx = s.indexOf("nativeDragCatch: {");
    expect(idx).toBeGreaterThan(-1);
    const block = s.slice(idx, idx + 400);

    // Either the band is sized to the handle (asserted above) or it must
    // declare pass-through pointer semantics. It currently does neither.
    expect(block).toMatch(/pointerEvents/);
  });
});

/* ------------------------------------------------------------------ *
 * F-3 — thumb positions are read from refs during render.
 * ------------------------------------------------------------------ */
describe("F-3 — plane and rail thumbs must be positioned from STATE, not a ref", () => {
  test("thumb offsets are not computed from a `.current` ref read", () => {
    const s = src(SHEET);

    // `onLayout` assigns to a useRef and a ref assignment does NOT schedule a
    // re-render, so the FIRST painted frame positions both thumbs with a width
    // of 1: left = s * 1 - 14 => a negative offset clamped to the left edge.
    // Proven on the iPhone 17 Pro simulator: on open, the plane thumb and the
    // hue thumb both render clipped at the far-left edge while the committed
    // colour is a fully saturated orange. The control opens telling the user
    // the wrong colour.
    const planeThumb = /planeThumb,\s*\{[\s\S]{0,240}?\}/.exec(s);
    expect(planeThumb).not.toBeNull();
    expect(planeThumb?.[0]).not.toMatch(/planeWidthRef\.current/);

    const railThumb = /railThumb,\s*\{[\s\S]{0,240}?\}/.exec(s);
    expect(railThumb).not.toBeNull();
    expect(railThumb?.[0]).not.toMatch(/railWidthRef\.current/);
  });

  test("the measured plane width is held in state so layout triggers a repaint", () => {
    const s = src(SHEET);
    // A useState (or a reanimated shared value driving an animated style) is
    // the only shape that repaints after onLayout.
    expect(s).toMatch(/setPlaneWidth|planeWidth,\s*setPlaneWidth|useSharedValue/);
  });
});

/* ------------------------------------------------------------------ *
 * F-4 — the motion grid cannot be two-up on the phones we ship to.
 * ------------------------------------------------------------------ */
describe("F-4 — motion tiles must fit two-up at the narrowest shipped width", () => {
  test("two tiles plus the gap fit inside the sheet body on a 375pt phone", () => {
    const s = src(SHEET);

    const tile = /motionTile:\s*\{[^}]*width:\s*(\d+)/.exec(s);
    expect(tile).not.toBeNull();
    const tileWidth = Number(tile?.[1]);

    // Sheet body inset is `paddingHorizontal: spacing.md` (16) per side
    // (SheetMobile styles.body), so content width = screen - 32.
    //   iPhone SE / iPhone 8      375 -> 343
    //   Samsung SM-A725F (tested) 384 -> 352
    // The design specifies a 2-column grid (§3.7). `gap: spacing.sm` = 8.
    const NARROWEST_CONTENT_WIDTH = 343;
    const GAP = 8;

    expect(tileWidth * 2 + GAP).toBeLessThanOrEqual(NARROWEST_CONTENT_WIDTH);
  });
});

/* ------------------------------------------------------------------ *
 * Contract guards — these PASS and must keep passing.
 * Different angle from the implementor's suite: mutation safety, alias
 * shapes, and per-axis independence read from the RAW override.
 * ------------------------------------------------------------------ */
describe("offeringTheme — adversarial contract edges", () => {
  test("normalizeThemeOverrides never mutates its input", () => {
    const input = { color: "#16a34a", font: null, animation: null };
    const frozen = Object.freeze({ ...input });
    const out = normalizeThemeOverrides(frozen);
    expect(out).not.toBe(frozen);
    expect(frozen).toEqual(input);
  });

  test("every all-empty permutation collapses to null, not to an empty object", () => {
    // A `{null,null,null}` object is NOT the same as `null` downstream: it is
    // what makes the phantom-diff (C-3) and the false-dirty checks possible.
    expect(normalizeThemeOverrides(undefined)).toBeNull();
    expect(normalizeThemeOverrides(null)).toBeNull();
    expect(
      normalizeThemeOverrides({ color: null, font: null, animation: null }),
    ).toBeNull();
    expect(themeOverridesFromColumns({})).toBeNull();
    expect(
      themeOverridesFromColumns({
        theme_color_override: null,
        theme_font_override: null,
        theme_animation_override: null,
      }),
    ).toBeNull();
  });

  test("a partial override still writes ALL THREE columns so a cleared axis is cleared", () => {
    // If the writer omitted the untouched keys, clearing an axis would leave a
    // stale value in the column forever.
    const cols = themeOverridesToColumns({
      color: "#16a34a",
      font: null,
      animation: null,
    });
    expect(Object.keys(cols).sort()).toEqual([
      "theme_animation_override",
      "theme_color_override",
      "theme_font_override",
    ]);
    expect(cols.theme_color_override).toBe("#16a34a");
    expect(cols.theme_font_override).toBeNull();
    expect(cols.theme_animation_override).toBeNull();
  });

  test("inheritance is per-axis and is read from the RAW override (the C-1 class)", () => {
    const colourOnly = { color: "#16a34a", font: null, animation: null };
    expect(themeAxisIsInherited(colourOnly, "color")).toBe(false);
    expect(themeAxisIsInherited(colourOnly, "font")).toBe(true);
    expect(themeAxisIsInherited(colourOnly, "animation")).toBe(true);

    // undefined and null must behave identically at every read site.
    expect(themeAxisIsInherited(undefined, "color")).toBe(true);
    expect(themeAxisIsInherited(null, "color")).toBe(true);
  });

  test("a column round-trip is lossless for a colour-only override", () => {
    const original = { color: "#291d15", font: null, animation: null };
    expect(
      themeOverridesFromColumns(themeOverridesToColumns(original)),
    ).toEqual(original);
  });
});

/* ------------------------------------------------------------------ *
 * Gesture-coordination ban — re-asserted from the tester side.
 * ------------------------------------------------------------------ */
describe("no gesture coordination anywhere in the theme sheet", () => {
  test("none of the four forbidden coordination APIs appear", () => {
    // Strip comments first: the file's docblock NAMES these APIs in order to
    // forbid them, and a naive substring scan would trip on the prose.
    const s = src(SHEET)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    for (const api of [
      "Gesture.Simultaneous",
      "Gesture.Native",
      "simultaneousWithExternalGesture",
      "blocksExternalGesture",
    ]) {
      expect(s).not.toContain(api);
    }
  });
});
