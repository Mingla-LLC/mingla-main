import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { V1_PAIRING_FONTS } from "../contracts/generated/upgradeV1ToV2.ts";

/**
 * #2830 -- the editor's font list and the published site's font list are the
 * same list.
 *
 * #2829 W3 — Studio no longer offers the three fixed pairings: owners choose
 * any Google font, fetched at publish and served by the site itself. The v1
 * pairing list now lives ONLY where v1 still matters: the runtime's rollback
 * renderer (mingla-sites/src/contracts/fontPairings.ts, TEMPORARY) and the
 * v1 → v2 upgrade's slot mapping (site-contracts `V1_PAIRING_FONTS`). This
 * suite keeps the original promise for those: the two agree, every family
 * they name is self-hosted for v1 rollbacks, the licence travels, and nothing
 * is fetched from a font CDN.
 */
const runtimePairings = fs.readFileSync(
  path.resolve(process.cwd(), "../mingla-sites/src/contracts/fontPairings.ts"), "utf8");
const legacyCss = () => fs.readFileSync(
  path.resolve(process.cwd(), "../mingla-sites/public/designs/legacy-v1.css"), "utf8");

describe("#2830 one font list", () => {
  it("the upgrade's slot mapping names exactly the runtime's v1 pairings", () => {
    for (const [key, pairing] of Object.entries(V1_PAIRING_FONTS)) {
      const block = runtimePairings.slice(runtimePairings.indexOf(`"${key}": {`));
      expect(block).toMatch(new RegExp(`display: '"${pairing.display}"`));
      expect(block).toMatch(new RegExp(`body: '"${pairing.body}"`));
      expect(block).toMatch(new RegExp(`uppercaseHeadings: ${pairing.uppercase}`));
    }
    expect(Object.keys(V1_PAIRING_FONTS).sort()).toEqual(["condensed-display", "editorial-serif", "modern-sans"]);
  });

  it("every pairing names only SELF-HOSTED families", () => {
    const served = fs
      .readdirSync(path.resolve(process.cwd(), "../mingla-sites/public/fonts"))
      .filter((name) => name.endsWith(".woff2"));
    const slug = (family: string) => family.toLowerCase().replace(/\s+/g, "-");
    for (const pairing of Object.values(V1_PAIRING_FONTS)) {
      for (const family of [pairing.display, pairing.body]) {
        expect(served.some((file) => file.startsWith(`${slug(family)}-`))).toBe(true);
      }
    }
  });

  it("every served family is declared as a face in the v1 stylesheet", () => {
    const css = legacyCss();
    for (const family of ["Oswald", "Plus Jakarta Sans", "Playfair Display"]) {
      expect(css).toContain(`font-family: "${family}"`);
    }
    expect(css).toContain("font-display: swap");
  });

  it("the licence travels with the files", () => {
    const ofl = path.resolve(process.cwd(), "../mingla-sites/public/fonts/OFL.txt");
    expect(fs.existsSync(ofl)).toBe(true);
    expect(fs.readFileSync(ofl, "utf8")).toContain("SIL Open Font License");
  });

  it("nothing is fetched from a font CDN", () => {
    const css = legacyCss();
    expect(css).not.toContain("fonts.googleapis.com");
    expect(css).not.toContain("fonts.gstatic.com");
  });

  it("Studio no longer carries its own copy of the v1 list", () => {
    expect(fs.existsSync(path.resolve(process.cwd(), "src/lib/fontPairings.ts"))).toBe(false);
  });
});
