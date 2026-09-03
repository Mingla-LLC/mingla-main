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
});
