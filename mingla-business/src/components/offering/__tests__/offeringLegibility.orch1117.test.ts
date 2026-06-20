/**
 * ORCH-1117 happy-path regression — white-theme legibility (#1), title-shadow
 * removal (#4), and the collapsed-by-default About (#2) STRUCTURAL contracts on
 * the shared package.
 *
 * These are source-structure + first-principles WCAG assertions (the package's
 * full RN render is not unit-mountable here — no react-test-renderer). The
 * adversarial render-level proof is the tester's job; this locks the contracts.
 *
 * fails-on-revert:
 *   - #1: re-adding `color: "#ffffff"` on the date line / pill makes the
 *     "no raw white in the render body" assertion FAIL (mirrors the strict-grep
 *     guard).
 *   - #4: re-adding `textShadowColor` to `titleLine` makes the shadow assertion
 *     FAIL.
 *   - #2: flipping the About default to `useState(false)` makes the
 *     collapsed-by-default assertion FAIL.
 */

import { readFileSync } from "fs";
import path from "path";

const PKG = path.resolve(
  __dirname,
  "../../../../../packages/offering-rendering/PublicEventPage.tsx",
);
const SRC = readFileSync(PKG, "utf8");

// The render body is everything BEFORE the StyleSheet block (where the
// intentional white-on-accent literals live).
const styleCut = SRC.indexOf("const styles = StyleSheet.create(");
const RENDER_BODY = styleCut === -1 ? SRC : SRC.slice(0, styleCut);
const STYLE_BLOCK = styleCut === -1 ? "" : SRC.slice(styleCut);

// ── WCAG contrast helpers (mirror the package's own, computed independently) ──
function linearize(channel: number): number {
  const n = channel / 255;
  return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
}
function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (m === null) throw new Error(`bad hex ${hex}`);
  const v = m[1];
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}
function contrast(a: string, b: string): number {
  const hi = Math.max(luminance(a), luminance(b));
  const lo = Math.min(luminance(a), luminance(b));
  return (hi + 0.05) / (lo + 0.05);
}

describe("ORCH-1117 #1 — white-theme legibility (luminance-safe palette)", () => {
  // T-LUM-HAPPY: on a near-white page the palette's primaryText is the dark
  // base (#000000), which is AA-safe (≥4.5:1) as text on that page. This proves
  // the recurrence-pill label (now palette.primaryText) is legible where raw
  // white was invisible.
  it("a near-white page resolves a primaryText (dark) that is ≥4.5:1 on the page", () => {
    const nearWhitePage = "#f8fafc"; // the package's lightBase
    // readableTextFor picks #000000 vs #ffffff by max contrast.
    const fg =
      contrast("#000000", nearWhitePage) >= contrast("#ffffff", nearWhitePage)
        ? "#000000"
        : "#ffffff";
    expect(fg).toBe("#000000");
    expect(contrast(fg, nearWhitePage)).toBeGreaterThanOrEqual(4.5);
  });

  it("raw white on a near-white page is BELOW AA (the bug being fixed)", () => {
    expect(contrast("#ffffff", "#f8fafc")).toBeLessThan(4.5);
  });

  it("the render body contains NO raw white on a text element (date/pill use palette)", () => {
    expect(/color:\s*["'](#ffffff|#fff)["']/i.test(RENDER_BODY)).toBe(false);
  });

  it("the date line + recurrence pill read from the palette", () => {
    expect(RENDER_BODY).toContain("color: palette.accent");
    expect(RENDER_BODY).toContain("color: palette.primaryText");
  });
});

describe("ORCH-1117 #4 — title shadow removed", () => {
  it("the titleLine style carries no textShadow* keys", () => {
    const m = /titleLine:\s*\{([\s\S]*?)\}/.exec(STYLE_BLOCK);
    expect(m).not.toBeNull();
    const titleLineStyle = m === null ? "" : m[1];
    expect(titleLineStyle).not.toMatch(/textShadow(Color|Offset|Radius)/);
  });
});

describe("ORCH-1117 #2 — collapsible About (collapsed by default)", () => {
  it("the About starts collapsed (useState(true)) in the package", () => {
    expect(RENDER_BODY).toMatch(/aboutCollapsed.*useState<boolean>\(true\)/);
  });

  it("the About body clamps to 3 lines when collapsed", () => {
    expect(RENDER_BODY).toMatch(/numberOfLines=\{collapsed \? 3 : undefined\}/);
  });

  it("uses the 160-char short-copy exception threshold", () => {
    expect(RENDER_BODY).toContain("ABOUT_COLLAPSE_THRESHOLD");
    expect(SRC).toMatch(/ABOUT_COLLAPSE_THRESHOLD\s*=\s*160/);
  });
});
