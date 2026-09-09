/*
 * #2830 — the hero, measured against the design it is meant to match.
 *
 * Every number here was READ OFF the reference at a 1043x847 viewport, not
 * chosen. Ours now renders identically: headline 73.01px on 76.66 line-height,
 * hero exactly the viewport height, buttons 16.8/33.6 at 13.12px/700, accent
 * rgb(205,160,82).
 *
 * The stylesheet defines `.hero` and `.button` TWICE, and the later block wins.
 * Three separate edits looked applied and were not, because the duplicate
 * further down overrode them. These assertions read the EFFECTIVE (last)
 * declaration, which is the one the browser uses.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const styles = fs.readFileSync(
  path.resolve(process.cwd(), "src/app/styles.css"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

/*
 * Deliberately NOT a CSS parser. Two attempts at one here asserted nothing:
 * the first missed `.hero h1, .hero h2` because it only accepted a lone
 * selector, the second matched too much. These read the stylesheet text for
 * the exact declarations that must be present, and for the reverted forms that
 * must not — which is all these assertions need to do.
 */
const has = (pattern: RegExp) => pattern.test(styles);

describe("#2830 hero parity, by measurement", () => {
  it("the hero fills the viewport", () => {
    expect(has(/\.hero\s*\{[^}]*min-height:\s*100svh/)).toBe(true);
    // Both `.hero` blocks must agree; the later one wins.
    expect(has(/min-height:\s*clamp\(30rem, 82svh, 52rem\)/)).toBe(false);
  });

  it("the headline is 7vw, which is 73px at the reference width", () => {
    expect(has(/font-size:\s*clamp\(2\.75rem, 7vw, 5\.6rem\)/)).toBe(true);
    // 10vw ran ~40% larger than the design and crowded everything under it.
    expect(has(/font-size:\s*clamp\(3\.6rem, 10vw, 8\.5rem\)/)).toBe(false);
  });

  it("buttons are the reference's pill, not a form control", () => {
    expect(has(/padding:\s*1\.05rem 2\.1rem;\s*border-radius:\s*999px/)).toBe(true);
    expect(has(/padding:\s*0\.75rem 1\.5rem;\s*border-radius:\s*999px/)).toBe(false);
  });

  it("the headline's second half carries the BRAND's accent, not a fixed colour", () => {
    expect(has(/\.accent-line[\s\S]{0,140}color:\s*var\(--gold\)/)).toBe(true);
  });

  it("the scrim is applied once, and darkest where the words are", () => {
    // It was set inline AND in ::after with the same 0.82 gradient, compounding
    // to ~0.97 and burying the brand's own photography.
    const renderer = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/RestaurantV1.tsx"),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(renderer).not.toContain("linear-gradient");
    expect(has(/\.hero::after[\s\S]{0,220}linear-gradient\(to top/)).toBe(true);
  });

  it("does not upper-case the brand's name in the footer either", () => {
    // The header stopped shouting it; the footer went on doing so on every page.
    const footer = (styles.match(/\.footer strong\s*\{[^}]*\}/g) ?? []).join("\n");
    expect(footer).not.toBe("");
    expect(footer).not.toContain("text-transform: uppercase");
  });

  it("a brand's name is never upper-cased for it", () => {
    // "gogi" is deliberately lowercase; the heading rule was shouting it.
    expect(has(/h1,\s*h2,\s*h3,\s*\.brand\s*\{/)).toBe(false);
    expect(has(/\.brand\s*\{[^}]*text-transform/)).toBe(false);
  });

  it("the header has a column for every child it renders", () => {
    // brand | nav | cart | action. It was three, so the CTA wrapped.
    expect(has(/grid-template-columns:\s*auto minmax\(0, 1fr\) auto auto/)).toBe(true);
  });
});

/*
 * #2830 — the parity work below the hero. Same approach: assert the measured
 * value that must be present, and for a rule that was REPLACED, assert the
 * reverted form is gone. Several of these guard defects that shipped and were
 * only visible on screen.
 */
describe("#2830 whole-site parity, by measurement", () => {
  it("section headings are subordinate to the page's h1", () => {
    // 45.89px at a 1043px viewport = 4.4vw. It was 7vw — the hero's own scale
    // — so every section heading matched the h1 and nothing read as beneath it.
    expect(has(/font-size:\s*clamp\(1\.9rem, 4\.4vw, 3\.25rem\)/)).toBe(true);
    expect(has(/font-size:\s*clamp\(2\.6rem, 7vw, 5\.8rem\)/)).toBe(false);
  });

  it("the eyebrow keeps the reference's tracking", () => {
    expect(has(/letter-spacing:\s*0\.28em/)).toBe(true);
  });

  it("an eyebrow inside a feature is still gold", () => {
    // `.feature p` (0,1,1) outranked `.eyebrow` (0,1,0) and greyed it out.
    expect(has(/\.feature p:not\(\.eyebrow\)/)).toBe(true);
  });

  it("the selected menu filter is legible", () => {
    // It was `background: currentColor` with `color: var(--accent)` and a `> *`
    // rule that matched nothing, so the label was gold ON gold — invisible.
    // Scoped to the rule itself: `background: currentColor` is used legitimately
    // elsewhere, and a bare search also matches the comment explaining this.
    const pressed = (styles.match(/\.filter\[aria-pressed="true"\]\s*\{[^}]*\}/g) ?? []).join("\n");
    expect(pressed).not.toBe("");
    expect(pressed).toContain("#101013");
    expect(pressed).not.toContain("currentColor");
  });

  it("an inner page's title is inside a container", () => {
    // It was a bare .page-title child of <main> with no padding, so "MENU" ran
    // off the left edge of the screen at every width.
    expect(has(/\.page-header\s*\{/)).toBe(true);
    expect(has(/\.page-title\s*\{\s*margin-block/)).toBe(false);
  });

  it("vertical reels are never cropped to landscape", () => {
    expect(has(/@media \(min-width: 720px\)[\s\S]{0,200}aspect-ratio:\s*16 \/ 9/)).toBe(false);
  });
});

/*
 * #2830 — an eyebrow labels the section; it never speaks for the brand.
 */
describe("#2830 the renderer does not write copy for the brand", () => {
  const renderer = fs.readFileSync(
    path.resolve(process.cwd(), "src/components/RestaurantV1.tsx"),
    "utf8",
  ).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

  it("labels sections by what they are", () => {
    // Comments stripped above: these strings appear in the note explaining
    // exactly this, and a bare search would match my own explanation.
    expect(renderer).not.toContain('label="In the room"');
    expect(renderer).not.toContain('label="In motion"');
    expect(renderer).toContain('label="Gallery"');
  });
});
