/**
 * #3431 (RSVP tutorial recording, 2026-09-17) — the public offering page's
 * floating close / share / mute row gets a solid header bar once the body
 * scrolls under it.
 *
 * SYMPTOM: on the public RSVP, ticketed, trip and experience pages (Business
 * and Explorer), the translucent chrome circles had nothing behind them. Once
 * the guest scrolled, page content ran under the buttons and under the status
 * bar.
 *
 * WHY THIS LIVES HERE: the code is in packages/offering-rendering, but only the
 * mingla-business default jest config runs on every PR, and its roots stop at
 * mingla-business/src. The helper is imported by DEEP specifier (the barrel is
 * mapped to a manual mock), so these assertions run the real module.
 *
 * Two layers:
 *   1. chromeBackdrop.ts — the pure geometry (bar height, the scroll range it
 *      fades across, when it is solid and takes touches) and the status-bar
 *      text colour derived from the page colour.
 *   2. ParallaxCoverShell — both phone branches (web phone and native) paint
 *      that bar between the content and the chrome, measure the cover spacer,
 *      and route the Scroll through the wrapping handler that still forwards
 *      the caller's onScroll. Source-checked like the shell's native / web-phone
 *      stacking suites, because this default config cannot mount the shell.
 *
 * FAILS ON REVERT: drop the bar from either phone branch, stop measuring the
 * spacer, lose the caller's onScroll, put the bar above the chrome, or change
 * the geometry, and this suite goes red.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  CHROME_BACKDROP_FADE,
  CHROME_BUTTON_SIZE,
  CHROME_TOP_GAP,
  chromeBackdropHeight,
  chromeBackdropRange,
  chromeStatusBarStyle,
  isChromeBackdropSolid,
} from "@mingla/offering-rendering/chromeBackdrop";
import { type ResolvedTheme } from "@mingla/offering-rendering/designTokens";
import { createThemePalette } from "@mingla/offering-rendering/themePalette";

describe("chromeBackdrop geometry", () => {
  it("the bar covers the status bar plus the chrome row with its gap above and below", () => {
    expect(CHROME_BUTTON_SIZE).toBe(40);
    expect(CHROME_TOP_GAP).toBe(12);
    // iPhone 17 Pro safe-area top.
    expect(chromeBackdropHeight(62)).toBe(62 + 12 + 40 + 12);
    expect(chromeBackdropHeight(0)).toBe(64);
    expect(chromeBackdropHeight(-5)).toBe(64);
  });

  it("is solid exactly when the body's top edge reaches the bar, after a short fade", () => {
    // 402pt-wide phone, 4:5 cover → spacer 502.5, body top = 502.5 - 28 seam.
    const bodyTop = 502.5 - 28;
    const range = chromeBackdropRange(bodyTop, 62);
    expect(range).not.toBeNull();
    expect(range!.end).toBeCloseTo(bodyTop - chromeBackdropHeight(62));
    expect(range!.start).toBeCloseTo(range!.end - CHROME_BACKDROP_FADE);
    expect(isChromeBackdropSolid(0, range)).toBe(false);
    expect(isChromeBackdropSolid(range!.start, range)).toBe(false);
    expect(isChromeBackdropSolid(range!.end - 0.5, range)).toBe(false);
    expect(isChromeBackdropSolid(range!.end, range)).toBe(true);
    expect(isChromeBackdropSolid(range!.end + 400, range)).toBe(true);
  });

  it("never produces an empty fade range, even for a short cover", () => {
    for (const bodyTop of [1, 20, 64, 70, 100, 130]) {
      const range = chromeBackdropRange(bodyTop, 0);
      expect(range).not.toBeNull();
      expect(range!.start).toBeGreaterThanOrEqual(0);
      expect(range!.end).toBeGreaterThan(range!.start);
    }
  });

  it("shows no bar until the cover spacer has been measured", () => {
    expect(chromeBackdropRange(null, 62)).toBeNull();
    expect(chromeBackdropRange(0, 62)).toBeNull();
    expect(chromeBackdropRange(Number.NaN, 62)).toBeNull();
    expect(isChromeBackdropSolid(10_000, null)).toBe(false);
  });
});

describe("chromeStatusBarStyle — status-bar text over the solid bar", () => {
  it("uses dark text on a light page and light text on a dark page", () => {
    expect(chromeStatusBarStyle("#f8fafc")).toBe("dark-content");
    expect(chromeStatusBarStyle("#ffffff")).toBe("dark-content");
    expect(chromeStatusBarStyle("#fff")).toBe("dark-content");
    expect(chromeStatusBarStyle("rgb(255, 255, 255)")).toBe("dark-content");
    expect(chromeStatusBarStyle("#07070a")).toBe("light-content");
    expect(chromeStatusBarStyle("#000")).toBe("light-content");
    expect(chromeStatusBarStyle("rgba(12, 14, 20, 1)")).toBe("light-content");
  });

  it("agrees with the palette's own primary text on real light and dark themes", () => {
    const themes: ResolvedTheme[] = [
      // dark pages
      ["#eb7825", "#ffffff"],
      ["#fde047", "#000000"],
      ["#10b981", "#ffffff"],
      // light pages
      ["#1e3a8a", "#ffffff"],
      ["#111111", "#ffffff"],
    ].map(([color, foregroundColor]) => ({
      color,
      foregroundColor: foregroundColor as ResolvedTheme["foregroundColor"],
      font: "inter",
      fontFamilyValue: "Inter",
      animation: "none",
    }));
    const tones = new Set<string>();
    for (const theme of themes) {
      const palette = createThemePalette(theme);
      tones.add(palette.primaryText);
      expect(chromeStatusBarStyle(palette.page)).toBe(
        palette.primaryText === "#ffffff" ? "light-content" : "dark-content",
      );
    }
    // Both a dark and a light page were exercised, or this proves nothing.
    expect(tones.size).toBe(2);
  });

  it("leaves the status bar alone for a colour it cannot read", () => {
    expect(chromeStatusBarStyle("transparent")).toBeNull();
    expect(chromeStatusBarStyle("")).toBeNull();
    expect(chromeStatusBarStyle("hsl(0, 0%, 100%)")).toBeNull();
  });
});

const RAW_SHELL = readFileSync(
  join(__dirname, "..", "..", "..", "..", "..", "packages", "offering-rendering", "ParallaxCoverShell.tsx"),
  "utf8",
);

/** Drop block, JSX and whole-line `//` comments so prose can never satisfy a pin. */
const stripComments = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");

const SHELL = stripComments(RAW_SHELL);

const constValue = (name: string): number => {
  const m = SHELL.match(new RegExp(`export const ${name} = (\\d+);`));
  if (m == null) throw new Error(`constant ${name} not exported`);
  return Number(m[1]);
};

/** Source between two markers (exclusive), so each branch is checked on its own. */
const between = (from: string, to: string): string => {
  const start = RAW_SHELL.indexOf(from);
  const end = RAW_SHELL.indexOf(to, start + from.length);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return stripComments(RAW_SHELL.slice(start, end));
};

describe("ParallaxCoverShell paints the header bar on both phone layouts", () => {
  it("the comment stripper removes prose but keeps code", () => {
    const sample = [
      "// {chromeBackdrop} in a line comment",
      "/* {chromeBackdrop} in a block */",
      "{/* {chromeBackdrop} in JSX */}",
      "const kept = 1;",
    ].join("\n");
    const stripped = stripComments(sample);
    expect(stripped).not.toContain("chromeBackdrop");
    expect(stripped).toContain("const kept = 1;");
  });

  it("layers the bar above the scrolling content and below the chrome buttons", () => {
    expect(constValue("CHROME_BACKDROP_Z")).toBeGreaterThan(constValue("CONTENT_Z"));
    expect(constValue("CHROME_BACKDROP_Z")).toBeLessThan(constValue("CHROME_Z"));
    const style = SHELL.match(/\bchromeBackdrop:\s*\{([\s\S]*?)\n  \},/);
    expect(style).not.toBeNull();
    expect(style![1]).toMatch(/position:\s*"absolute"/);
    expect(style![1]).toMatch(/top:\s*0/);
    expect(style![1]).toMatch(/zIndex:\s*CHROME_BACKDROP_Z/);
  });

  it("builds one bar: page-coloured, bar-height, opacity from the scroll, touch-blocking only when solid", () => {
    const bar = SHELL.match(/const chromeBackdrop = \(([\s\S]*?)\n  \);/);
    expect(bar).not.toBeNull();
    expect(bar![1]).toMatch(/<Animated\.View\s+pointerEvents=\{backdropSolid \? "auto" : "none"\}/);
    expect(bar![1]).toMatch(/styles\.chromeBackdrop/);
    expect(bar![1]).toMatch(/isWeb \? webStyle\(\{ position: "fixed" \}\) : null/);
    expect(bar![1]).toMatch(/height: chromeBackdropHeight\(safeAreaTop\)/);
    expect(bar![1]).toMatch(/backgroundColor: palette\.page/);
    expect(bar![1]).toMatch(/opacity: backdropOpacity/);
    expect(SHELL).toMatch(
      /inputRange: \[backdropStart, backdropEnd\],\s*outputRange: \[0, 1\],\s*extrapolate: "clamp"/,
    );
    expect(SHELL).toMatch(/chromeBackdropRange\(bodyTop, safeAreaTop\)/);
  });

  it("drives the bar from the real scroll offset and still forwards the caller's onScroll", () => {
    // The prop is renamed on the way in so both Scrolls keep `onScroll={onScroll}`.
    expect(SHELL).toMatch(/onScroll: onScrollProp,/);
    const handler = SHELL.match(/const onScroll = React\.useCallback\(([\s\S]*?)\n  \);/);
    expect(handler).not.toBeNull();
    expect(handler![1]).toMatch(/const y = event\.nativeEvent\.contentOffset\.y;/);
    expect(handler![1]).toMatch(/scrollY\.setValue\(y\);/);
    expect(handler![1]).toMatch(/isChromeBackdropSolid\(y, backdropRangeRef\.current\)/);
    expect(handler![1]).toMatch(/onScrollProp\?\.\(event\);/);
    expect(handler![1]).toMatch(/\[onScrollProp, scrollY\]/);
    expect(SHELL).toMatch(/setBodyTop\(event\.nativeEvent\.layout\.height - SEAM\);/);
  });

  const phoneBranches: readonly [string, string, string][] = [
    ["web phone", "// ===================== WEB PHONE", "// ===================== NATIVE"],
    ["native", "// ===================== NATIVE", "const S6 = S6_PHONE;"],
  ];

  for (const [label, from, to] of phoneBranches) {
    it(`${label}: renders the bar under the chrome and wires scroll + spacer measurement`, () => {
      const branch = between(from, to);
      expect(branch).toMatch(/\{chromeBackdrop\}/);
      expect(branch).toMatch(/\{chrome\}/);
      // The bar is painted before (under) the chrome row, after the cover.
      expect(branch.indexOf("{chromeBackdrop}")).toBeLessThan(branch.indexOf("{chrome}"));
      expect(branch.indexOf("{coverRender}")).toBeLessThan(branch.indexOf("{chromeBackdrop}"));
      expect(branch.match(/onScroll=\{onScroll\}/g) ?? []).toHaveLength(1);
      expect(branch).toMatch(/onLayout=\{onCoverSpacerLayout\}/);
    });
  }

  it("native: the status-bar text follows the bar only while it is solid; web phone leaves it alone", () => {
    const native = between("// ===================== NATIVE", "const S6 = S6_PHONE;");
    expect(native).toMatch(
      /\{backdropSolid && backdropStatusBarStyle !== null \? \(\s*<StatusBar barStyle=\{backdropStatusBarStyle\} animated=\{true\} \/>\s*\) : null\}/,
    );
    expect(SHELL).toMatch(/const backdropStatusBarStyle = chromeStatusBarStyle\(palette\.page\);/);
    const webPhone = between("// ===================== WEB PHONE", "// ===================== NATIVE");
    expect(webPhone).not.toMatch(/<StatusBar/);
  });

  it("desktop web is unchanged: its chrome rides the contained cover, so no bar", () => {
    const desktop = between("// ===================== DESKTOP", "// ===================== WEB PHONE");
    expect(desktop).not.toMatch(/chromeBackdrop/);
    expect(desktop).not.toMatch(/onScroll=/);
  });
});
