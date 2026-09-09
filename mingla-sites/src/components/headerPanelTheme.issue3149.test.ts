/*
 * #3149 — the header panel is the BRAND'S surface, and an eyebrow stays gold
 * wherever it is now printed.
 *
 * Two stylesheet facts, both of which a source search would get wrong:
 *
 * 1. `.site-header::before` hardcoded `rgba(16,16,19,0.92)`. A brand may
 *    override `--ink`, and on a lighter brand the scrolled header was darker
 *    than every surface underneath it.
 * 2. `.prose p` and `.cta p` are (0,1,1) and `.eyebrow` is (0,1,0), so those
 *    rules OUTRANK it. #2830 already hit this on `.feature p` and `.tile p`
 *    and fixed it there; `rich_text`, `cta`, `venue_reservation` and
 *    `contact_handoff` now carry eyebrows too, so the same exclusion is needed
 *    or gögi's "The place" prints in grey body colour instead of gold.
 *
 * `styles.css` declares several selectors TWICE and the later block wins, so
 * every assertion here is scoped to a specific block rather than searched for
 * anywhere in the file.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const RAW = fs.readFileSync(
  path.resolve(process.cwd(), "src/app/styles.css"),
  "utf8",
);
const styles = RAW.replace(/\/\*[\s\S]*?\*\//g, "");

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/* Every top-level block for a selector, in source order. */
const blocksFor = (selector: string): string[] =>
  [...styles.matchAll(
    new RegExp(`^${escape(selector)}\\s*\\{([^}]*)\\}`, "gm"),
  )].map((found) => found[1]!);

/*
 * Whether a top-level rule targets this selector AT ALL — including as one
 * member of a grouped selector. `.feature p:not(.eyebrow)` is written beside
 * `.tile p:not(.eyebrow)`, so a block-shaped match misses it entirely and a
 * check built on that would silently prove nothing.
 */
const declared = (selector: string): boolean =>
  new RegExp(`^${escape(selector)}\\s*[,{]`, "m").test(styles);

/* What actually applies: the LAST declaration of a property, last block wins. */
const effective = (selector: string, property: string): string | null => {
  const all = blocksFor(selector);
  for (let index = all.length - 1; index >= 0; index -= 1) {
    const declarations = [...all[index]!.matchAll(
      new RegExp(`(?:^|;)\\s*${escape(property)}\\s*:([^;]*)`, "g"),
    )];
    if (declarations.length) return declarations.at(-1)![1]!.trim();
  }
  return null;
};

describe("#3149 the scrolled header panel follows the brand's own ink", () => {
  it("resolves to a mix of --ink, not a hardcoded near-black", () => {
    // Measured, not read: this is the declaration the browser keeps.
    expect(effective(".site-header::before", "background")).toBe(
      "color-mix(in srgb, var(--ink) 92%, transparent)",
    );
  });

  it("keeps the plain rgba immediately before it as the fallback", () => {
    /*
     * Order is load-bearing. An engine without color-mix() drops the second
     * declaration and keeps the first, so it still gets the measured #101013
     * at 0.92 rather than a transparent header panel over a photograph.
     */
    const block = blocksFor(".site-header::before").at(-1) ?? "";
    const backgrounds = [...block.matchAll(/(?:^|;)\s*background\s*:([^;]*)/g)]
      .map((found) => found[1]!.trim());
    expect(backgrounds).toEqual([
      "rgba(16, 16, 19, 0.92)",
      "color-mix(in srgb, var(--ink) 92%, transparent)",
    ]);
  });

  it("keeps the reference's 92%, so nothing about the look changed on gögi", () => {
    // gögi's --ink IS #101013, so the rendered panel is byte-identical for
    // them. This is a fix for the NEXT brand, not a restyle of this one.
    expect(styles).toContain("--ink: #101013");
    expect(effective(".site-header::before", "background")).toContain("92%");
  });

  it("leaves the blur and the hairline exactly where they were", () => {
    const block = blocksFor(".site-header::before").at(-1) ?? "";
    expect(block).toContain("backdrop-filter: blur(14px)");
    expect(block).toContain(
      "border-bottom: 1px solid rgba(240, 238, 233, 0.14)",
    );
  });
});

describe("#3149 an eyebrow is gold in every section that can now print one", () => {
  /*
   * `p` rules that could capture an eyebrow, and the sections whose eyebrow
   * each one would have greyed out.
   */
  const HOSTS: Array<[string, string]> = [
    [".prose p", "rich_text"],
    [".cta p", "cta / venue_reservation / contact_handoff"],
    [".feature p", "media_feature / hours_location"],
    [".tile p", "offering_grid tiles"],
  ];

  for (const [selector, why] of HOSTS) {
    it(`${selector} excludes the eyebrow (${why})`, () => {
      // The unexcluded form must not survive anywhere, or the later block wins
      // and the exclusion is decorative.
      expect(declared(selector)).toBe(false);
      expect(declared(`${selector}:not(.eyebrow)`)).toBe(true);
    });
  }

  it("the eyebrow itself is still gold and still tracked", () => {
    expect(effective(".eyebrow", "color")).toBe("var(--gold)");
    expect(effective(".eyebrow", "letter-spacing")).toBe("0.28em");
    expect(effective(".eyebrow", "text-transform")).toBe("uppercase");
  });
});
