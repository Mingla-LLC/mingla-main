import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { FONT_PAIRINGS, FONT_PAIRING_KEYS } from "./fontPairings";

/**
 * #2830 -- the editor's font list and the published site's font list are the
 * same list.
 *
 * They live in two files because the two apps deploy as separate Vercel
 * projects with their own root directories, so the CMS cannot import from
 * mingla-sites without breaking its build. This test is what makes the copy
 * safe: if they drift, a brand can pick a font in Studio that the website does
 * not serve, and the page silently falls back -- the exact failure self-hosting
 * was meant to end.
 */
const here = fs.readFileSync(
  path.resolve(process.cwd(), "src/lib/fontPairings.ts"), "utf8");
const there = fs.readFileSync(
  path.resolve(process.cwd(), "../mingla-sites/src/contracts/fontPairings.ts"), "utf8");

const code = (source: string) =>
  source.replace(/\/\*\*[\s\S]*?\*\//, "").trim();

describe("#2830 one font list", () => {
  it("the CMS copy and the runtime original are identical in code", () => {
    expect(code(here)).toBe(code(there));
  });

  it("every pairing names only SELF-HOSTED families", () => {
    const served = fs
      .readdirSync(path.resolve(process.cwd(), "../mingla-sites/public/fonts"))
      .filter((name) => name.endsWith(".woff2"));
    const slug = (family: string) => family.toLowerCase().replace(/\s+/g, "-");
    for (const key of FONT_PAIRING_KEYS) {
      const pairing = FONT_PAIRINGS[key];
      for (const stack of [pairing.display, pairing.body]) {
        const first = stack.match(/^"([^"]+)"/);
        if (!first) continue;
        expect(
          served.some((file) => file.startsWith(`${slug(first[1])}-`)),
        ).toBe(true);
      }
    }
  });

  it("every served family is declared as a face in the stylesheet", () => {
    const css = fs.readFileSync(
      path.resolve(process.cwd(), "../mingla-sites/src/app/styles.css"), "utf8");
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
    const css = fs.readFileSync(
      path.resolve(process.cwd(), "../mingla-sites/src/app/styles.css"), "utf8");
    expect(css).not.toContain("fonts.googleapis.com");
    expect(css).not.toContain("fonts.gstatic.com");
  });
});
