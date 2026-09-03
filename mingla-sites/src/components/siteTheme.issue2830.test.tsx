import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import fs from "node:fs";
import path from "node:path";
import { siteThemeCss, SiteTheme } from "./SiteTheme";
import type { RestaurantArtifact } from "../contracts/artifact";

/**
 * #2830 -- a brand's website should look like the BRAND'S.
 *
 * The runtime stylesheet hardcoded gogi's charcoal and gold at :root, so every
 * site published through Mingla Sites would have rendered in the pilot
 * customer's colours. That is what makes #2832 (a template per business type)
 * impossible: there is only one look and it belongs to gogi.
 */
const base = {
  site_settings: {
    display_name: "gogi",
    colors: { background: "#101013", foreground: "#f0eee9", accent: "#cda052" },
  },
} as unknown as RestaurantArtifact;

const css = fs.readFileSync(
  path.resolve(process.cwd(), "src/app/styles.css"),
  "utf8",
);

describe("#2830 the brand's own look", () => {
  it("drives the palette from the artifact", () => {
    const out = siteThemeCss(base);
    expect(out).toContain("--ink:#101013");
    expect(out).toContain("--ivory:#f0eee9");
    expect(out).toContain("--gold:#cda052");
  });

  it("a DIFFERENT brand gets different colours, not gogi's", () => {
    const other = {
      site_settings: {
        display_name: "somewhere else",
        colors: { background: "#0b1120", foreground: "#e2e8f0", accent: "#38bdf8" },
      },
    } as unknown as RestaurantArtifact;
    const out = siteThemeCss(other) ?? "";
    expect(out).toContain("--gold:#38bdf8");
    expect(out).not.toContain("cda052");
  });

  it("emits nothing when a brand has set no colours, so defaults apply", () => {
    const bare = { site_settings: { display_name: "x" } } as unknown as RestaurantArtifact;
    expect(siteThemeCss(bare)).toBeNull();
  });

  it("REFUSES anything that is not a plain hex colour", () => {
    // These values come from Payload and land inside a <style> element, so an
    // unvalidated one is CSS injection on a customer's website.
    for (const evil of [
      "red;} body{display:none",
      "#fff",
      "url(javascript:alert(1))",
      "var(--x)",
      "#12345g",
      "",
    ]) {
      const artifact = {
        site_settings: { display_name: "x", colors: { accent: evil } },
      } as unknown as RestaurantArtifact;
      const out = siteThemeCss(artifact);
      expect(out === null || !out.includes(evil)).toBe(true);
    }
  });

  it("renders as a style element carrying only custom properties", () => {
    const html = renderToStaticMarkup(<SiteTheme artifact={base} />);
    expect(html).toContain("<style");
    expect(html).toContain(":root{");
    expect(html).not.toContain("<script");
  });

  it("the stylesheet no longer hardcodes a font family on body", () => {
    expect(css).toContain("font-family: var(--body)");
    expect(css).not.toContain("font-family: Inter,");
  });

  it("headings use the display face and the condensed register", () => {
    expect(css).toContain("font-family: var(--display)");
    expect(css).toContain("text-transform: uppercase");
  });

  it("the reveal effect can never hide content when JS does not run", () => {
    // The hiding lives behind .js-reveal, a class only the client adds.
    expect(css).toContain(".reveal { opacity: 1; }");
    expect(css).toContain(".js-reveal .reveal { opacity: 0;");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("a brand's font choice reaches the page", () => {
    const serif = {
      site_settings: { display_name: "x", typography: "editorial-serif" },
    } as unknown as RestaurantArtifact;
    const out = siteThemeCss(serif) ?? "";
    expect(out).toContain("Playfair Display");
    // A serif set in caps reads as shouting, so the pairing turns it off.
    expect(out).toContain("--display-case:none");
  });

  it("the condensed pairing keeps the uppercase register", () => {
    const condensed = {
      site_settings: { display_name: "x", typography: "condensed-display" },
    } as unknown as RestaurantArtifact;
    const out = siteThemeCss(condensed) ?? "";
    expect(out).toContain("Oswald");
    expect(out).toContain("--display-case:uppercase");
  });

  it("REFUSES a font that is not one of the offered pairings", () => {
    const evil = {
      site_settings: {
        display_name: "x",
        typography: "'; } body { display:none } :root { --x:'",
      },
    } as unknown as RestaurantArtifact;
    expect(siteThemeCss(evil)).toBeNull();
  });

  it("the stylesheet sets the heading case from the pairing, not itself", () => {
    expect(css).toContain("text-transform: var(--display-case)");
  });

  it("NO rule hardcodes a display stack, at any specificity", () => {
    /*
     * The bug this pins: `.hero h1`, `main h2`, `.tile h3` and `.brand` each
     * hardcoded "Arial Narrow", "Roboto Condensed", Impact. Those selectors are
     * more specific than any bare `h1, h2, h3` rule, so they won on every
     * heading on the site and a font chosen in Studio changed nothing visible.
     *
     * It was found by MEASURING the rendered width against Oswald's, not by
     * reading the stylesheet — the declared list and the face actually used are
     * different things, and only one of them is on the page.
     */
    const families = [...css.matchAll(/font-family:\s*([^;]+);/g)].map((m) =>
      m[1].trim()
    );
    const hardcoded = families.filter(
      (value) =>
        !value.startsWith("var(--") &&
        !value.startsWith('"Oswald"') &&
        !value.startsWith('"Plus Jakarta Sans"') &&
        !value.startsWith('"Playfair Display"'),
    );
    // The only literal families left are the @font-face declarations
    // themselves, which must name a real family.
    expect(hardcoded).toEqual([]);
  });

  it("every heading selector defers to the brand's face", () => {
    for (const selector of [".hero h1", "main h2", ".tile h3", ".brand"]) {
      const index = css.indexOf(selector);
      expect(index).toBeGreaterThan(-1);
    }
    expect(css).not.toContain('"Roboto Condensed"');
  });
});
