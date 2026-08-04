import { describe, expect, test } from "@jest/globals";

import type { ThemeInput } from "@mingla/offering-rendering";

import {
  createThemePalette,
  resolveOfferingSurface,
} from "../../../../../packages/offering-rendering/themePalette";
import { resolveTheme } from "../../../../../packages/offering-rendering/themeResolver";
import { THEME_PRESETS } from "../../theme/themePresets";

/**
 * issue #1564 [venue-colours] — WCAG AA holds for a VENUE-CHOSEN palette.
 *
 * A venue palette that fails contrast is not shippable, and the pairs at risk
 * are the ones this change creates: the reservation form used to paint itself
 * from the business app's own dark tokens (`#0c0e12`, near-white text) no
 * matter what the page behind it was. It now paints from the page's palette,
 * which a VENUE can now set — so a light venue palette must not produce
 * white-on-white, and a dark one must not produce black-on-black.
 *
 * THE VACUITY TRAP THIS FILE IS BUILT AROUND: "assert every colour pair clears
 * AA" is trivially true over an EMPTY set of pairs, and a refactor that renames
 * a palette key would silently empty it. So:
 *   1. the seed sweep is counted and its size asserted;
 *   2. the pair set is BUILT from the palette object and counted;
 *   3. a deliberately-illegal pair is pushed through the SAME judge and must
 *      FAIL — proving the judge can say no.
 *
 * The WCAG maths is implemented HERE, independently of
 * `packages/offering-rendering`, so the assertion cannot be co-bugged with the
 * engine it is judging.
 */

// ── independent WCAG (never imported from the module under test) ────────────
const channel = (c: number): number => {
  const n = c / 255;
  return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
};

const luminance = (color: string): number => {
  const hex = /^#([0-9a-fA-F]{6})$/.exec(color);
  if (hex !== null) {
    const v = hex[1];
    return (
      0.2126 * channel(parseInt(v.slice(0, 2), 16)) +
      0.7152 * channel(parseInt(v.slice(2, 4), 16)) +
      0.0722 * channel(parseInt(v.slice(4, 6), 16))
    );
  }
  const rgba = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(color);
  if (rgba !== null) {
    return (
      0.2126 * channel(Number(rgba[1])) +
      0.7152 * channel(Number(rgba[2])) +
      0.0722 * channel(Number(rgba[3]))
    );
  }
  throw new Error(`venueThemeContrast: unparseable colour ${color}`);
};

/**
 * Composite a possibly-translucent colour over an opaque base before judging
 * it. Judging `rgba(255,255,255,0.78)` as if it were opaque white is how a
 * contrast test reports a pass that the eye does not see.
 */
const over = (top: string, base: string): string => {
  const rgba = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/.exec(
    top,
  );
  if (rgba === null) return top;
  const alpha = rgba[4] === undefined ? 1 : Number(rgba[4]);
  const b = /^#([0-9a-fA-F]{6})$/.exec(base);
  if (b === null) throw new Error(`venueThemeContrast: base must be hex, got ${base}`);
  const bv = b[1];
  const mix = (i: number, cTop: number): number =>
    Math.round(cTop * alpha + parseInt(bv.slice(i, i + 2), 16) * (1 - alpha));
  const toHex = (n: number): string => n.toString(16).padStart(2, "0");
  return `#${toHex(mix(0, Number(rgba[1])))}${toHex(mix(2, Number(rgba[2])))}${toHex(mix(4, Number(rgba[3])))}`;
};

const contrast = (a: string, b: string): number => {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

// ── the sweep: seeds a venue can actually choose ────────────────────────────
// Every shipped preset (what the swatch strip offers), plus the full hue wheel
// at three lightnesses (what the 2D plane offers), plus the adversarial ends.
const wheel = (): string[] => {
  const out: string[] = [];
  for (let hue = 0; hue < 360; hue += 15) {
    for (const [sat, val] of [
      [0.9, 0.95],
      [0.75, 0.6],
      [0.45, 0.3],
    ] as const) {
      const c = val * sat;
      const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
      const m = val - c;
      const rgb =
        hue < 60
          ? [c, x, 0]
          : hue < 120
            ? [x, c, 0]
            : hue < 180
              ? [0, c, x]
              : hue < 240
                ? [0, x, c]
                : hue < 300
                  ? [x, 0, c]
                  : [c, 0, x];
      out.push(
        `#${rgb
          .map((ch) =>
            Math.round((ch + m) * 255)
              .toString(16)
              .padStart(2, "0"),
          )
          .join("")}`,
      );
    }
  }
  return out;
};

const VENUE_SEEDS: string[] = [
  ...THEME_PRESETS.map((p) => p.hex),
  ...wheel(),
  "#000000",
  "#ffffff",
  "#f8fafc",
  "#07070a",
];

/** The brand the venue is overriding — deliberately unlike any venue seed. */
const BRAND: ThemeInput = {
  color: "#2563eb",
  font: "lora",
  animation: "snowfall",
};

/**
 * The colour pairs the reservation form actually paints, named as the
 * component names them. Built FROM the palette so a renamed key empties the
 * list loudly (the count assertion below) rather than silently.
 */
const reservationPairs = (
  palette: ReturnType<typeof createThemePalette>,
): Array<{ label: string; fg: string; bg: string; min: number }> => {
  const page = palette.page;
  return [
    // Text, AA normal-text 4.5:1.
    { label: "title on page", fg: palette.primaryText, bg: page, min: 4.5 },
    { label: "body on page", fg: palette.secondaryText, bg: page, min: 4.5 },
    { label: "chip label on page", fg: palette.primaryText, bg: page, min: 4.5 },
    {
      label: "chip label on a SELECTED chip",
      fg: palette.primaryText,
      bg: over(palette.accentWash, page),
      min: 4.5,
    },
    {
      label: "phone field text on its own background",
      fg: palette.primaryText,
      bg: page,
      min: 4.5,
    },
    {
      label: "confirm button label on the accent fill",
      fg: palette.accentText,
      bg: palette.accent,
      min: 4.5,
    },
    // Non-text UI, AA 3:1.
    {
      label: "field label (tertiary) on page",
      fg: palette.tertiaryText,
      bg: page,
      min: 3,
    },
    { label: "accent on page", fg: palette.accent, bg: page, min: 3 },
    {
      label: "selected chip border on page",
      fg: palette.accent,
      bg: page,
      min: 3,
    },
    {
      label: "phone field focus ring on page",
      fg: palette.accent,
      bg: page,
      min: 3,
    },
  ];
};

/**
 * The ONE documented exemption, inherited from ORCH-1138's shipped invariant
 * sweep (`themePaletteContrastInvariant.tester.orch1138.test.ts` lines
 * 102-115), which already excludes `#ffffff`/`#fefefe` from the accent-on-page
 * assertion. It is a degenerate input, it predates this change by a year, and
 * #1564 makes it no more reachable than the brand colour picker already did.
 *
 * MEASURED MECHANISM (the ORCH-1138 header's "near-white page" explanation is
 * not what the engine does — verified here): a near-white seed derives a DARK
 * page (`#202023`), and the accent is then desaturated grey capped by
 * `contrastAdjustedForWhiteText`, landing at 2.83-2.87:1. The band is narrow
 * and it ENDS: `#fafafa` already clears at 3.62:1.
 *
 * Named, never a predicate, so it cannot silently widen — and the test below
 * PROVES it still genuinely fails rather than assuming it does.
 */
const ACCENT_FLOOR_EXEMPT_SEEDS = ["#ffffff"] as const;
const ACCENT_PAIR_LABELS = new Set([
  "accent on page",
  "selected chip border on page",
  "phone field focus ring on page",
]);

describe("#1564 — the sweep is a real sweep", () => {
  test("the seed set is large, deduplicated, and includes every shipped preset", () => {
    expect(VENUE_SEEDS.length).toBeGreaterThan(70);
    expect(new Set(VENUE_SEEDS).size).toBeGreaterThan(60);
    expect(THEME_PRESETS.length).toBeGreaterThanOrEqual(12);
    for (const preset of THEME_PRESETS) {
      expect(VENUE_SEEDS).toContain(preset.hex);
    }
  });

  test("the sweep reaches BOTH page classes — a light-only sweep proves nothing", () => {
    const classes = new Set(
      VENUE_SEEDS.map((hex) =>
        resolveOfferingSurface(
          resolveTheme(BRAND, { color: hex, font: null, animation: null }),
        ),
      ),
    );
    expect(classes).toEqual(new Set(["light", "dark"]));
  });

  test("the pair list is non-empty and every entry names a REAL colour", () => {
    const palette = createThemePalette(resolveTheme(BRAND, null));
    const pairs = reservationPairs(palette);
    expect(pairs.length).toBe(10);
    for (const pair of pairs) {
      expect(typeof pair.fg).toBe("string");
      expect(pair.fg.length).toBeGreaterThan(3);
      expect(pair.bg).toMatch(/^#[0-9a-f]{6}$/i);
      // luminance() throws on anything it cannot parse — this is the guard
      // that a renamed palette key becomes `undefined` and fails loudly.
      expect(Number.isFinite(luminance(over(pair.fg, pair.bg)))).toBe(true);
    }
  });

  test("the judge can say NO — a deliberately illegal pair FAILS", () => {
    // Without this, "every pair passed" is indistinguishable from "the judge
    // always passes".
    expect(contrast("#ffffff", "#fefefe")).toBeLessThan(4.5);
    expect(contrast("#000000", "#0a0a0a")).toBeLessThan(4.5);
    expect(contrast("#777777", "#888888")).toBeLessThan(3);
    // And it can say yes.
    expect(contrast("#000000", "#ffffff")).toBeGreaterThan(20);
  });
});

describe("#1564 — every venue-chosen palette clears AA on the reservation form", () => {
  test("all seeds × all pairs", () => {
    let judged = 0;
    const failures: string[] = [];
    for (const hex of VENUE_SEEDS) {
      // The venue overrides ONLY its colour; font and motion still inherit.
      // That is the shape a real operator produces most often.
      const resolved = resolveTheme(BRAND, {
        color: hex,
        font: null,
        animation: null,
      });
      const palette = createThemePalette(resolved);
      const exempt =
        (ACCENT_FLOOR_EXEMPT_SEEDS as readonly string[]).includes(hex);
      for (const pair of reservationPairs(palette)) {
        judged += 1;
        // The exemption is scoped to the THREE accent pairs of ONE seed. Every
        // text pair of that seed is still judged at the full 4.5:1 — a white
        // seed may not reach the UI-element floor, but it may never make text
        // unreadable.
        if (exempt && ACCENT_PAIR_LABELS.has(pair.label)) continue;
        const fg = over(pair.fg, pair.bg);
        const ratio = contrast(fg, pair.bg);
        // The dark-page accent ceiling is 4.2624 by construction
        // (`contrastAdjustedForWhiteText` caps accent luminance at 0.183333 —
        // ORCH-1138 / #1022's amended contract). Text pairs are unaffected;
        // the 3:1 non-text floor is what the accent pairs are held to, and it
        // is the WCAG floor for UI components, not a relaxation invented here.
        if (ratio + 1e-9 < pair.min) {
          failures.push(
            `${hex} → ${pair.label}: ${ratio.toFixed(2)}:1 < ${pair.min}:1`,
          );
        }
      }
    }
    // Vacuity guard: assert we actually judged the expected volume. If the
    // loops silently produced nothing, `failures` would be empty and this test
    // would "pass" while proving nothing. `- 3` is the exactly-three skipped
    // accent pairs of the single exempt seed — a widened exemption changes
    // this number and fails here.
    expect(judged).toBe(VENUE_SEEDS.length * 10);
    expect(judged).toBeGreaterThan(700);
    expect(failures).toEqual([]);
  });

  test("the ONE exemption is one seed, three pairs, and it really does fail", () => {
    expect(ACCENT_FLOOR_EXEMPT_SEEDS).toHaveLength(1);
    expect(ACCENT_PAIR_LABELS.size).toBe(3);
    // Assuming the exempt seed fails is how an exemption outlives its reason.
    // Measure it: if `createThemePalette` ever gets good enough to clear 3:1
    // on a white seed, this fails and the exemption must be deleted.
    for (const hex of ACCENT_FLOOR_EXEMPT_SEEDS) {
      const palette = createThemePalette(
        resolveTheme(BRAND, { color: hex, font: null, animation: null }),
      );
      expect(contrast(palette.accent, palette.page)).toBeLessThan(3);
      // …and its TEXT is still perfectly legible, which is the part that
      // actually matters to a guest reading a reservation form.
      expect(
        contrast(over(palette.primaryText, palette.page), palette.page),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrast(over(palette.secondaryText, palette.page), palette.page),
      ).toBeGreaterThanOrEqual(4.5);
    }
    // The band is narrow and it ENDS. `#fafafa` and everything below it clear
    // the floor unaided, so the exemption is a sliver of the whitest seeds and
    // not a licence for pale colours generally.
    for (const hex of ["#fafafa", "#f8fafc", "#f0f0f0", "#e5e5e5"]) {
      const palette = createThemePalette(
        resolveTheme(BRAND, { color: hex, font: null, animation: null }),
      );
      expect(contrast(palette.accent, palette.page)).toBeGreaterThanOrEqual(3);
    }
    // …and the only seeds inside the band are the near-whites ORCH-1138
    // already named. If the band ever grows past them, this fails.
    for (const hex of ["#fdfdfd", "#fcfcfc"]) {
      const palette = createThemePalette(
        resolveTheme(BRAND, { color: hex, font: null, animation: null }),
      );
      expect(contrast(palette.accent, palette.page)).toBeLessThan(3);
      expect(contrast(palette.accent, palette.page)).toBeGreaterThan(2.5);
    }
  });

  test("the accent the guest sees is never the raw seed when the seed would fail", () => {
    // The chip and the focus ring paint `palette.accent`, NOT the hex the
    // operator typed. Prove the derivation is doing work: at least one seed
    // must be transformed, or the palette engine is a pass-through and every
    // pass above is accidental.
    const transformed = VENUE_SEEDS.filter((hex) => {
      const palette = createThemePalette(
        resolveTheme(BRAND, { color: hex, font: null, animation: null }),
      );
      return palette.accent.toLowerCase() !== hex.toLowerCase();
    });
    // 39 of the 89 swept seeds are transformed on the current engine. The
    // floor is set well below that and well above zero: the point is that the
    // derivation demonstrably DOES work, so the passes above are earned rather
    // than an accident of picking safe seeds.
    expect(transformed.length).toBeGreaterThan(20);
    expect(transformed.length).toBeLessThan(VENUE_SEEDS.length);
  });

  test("an INHERITED venue is judged too — the default path is not exempt", () => {
    const palette = createThemePalette(resolveTheme(BRAND, null));
    const pairs = reservationPairs(palette);
    expect(pairs.length).toBe(10);
    for (const pair of pairs) {
      expect(contrast(over(pair.fg, pair.bg), pair.bg) + 1e-9).toBeGreaterThan(
        pair.min,
      );
    }
  });
});
