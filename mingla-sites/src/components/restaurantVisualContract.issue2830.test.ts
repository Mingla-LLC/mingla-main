import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (relative: string) =>
  fs.readFileSync(path.resolve(process.cwd(), relative), "utf8");

describe("#2830 Restaurant Website v1 visual and accessibility contract", () => {
  const renderer = read("src/components/RestaurantV1.tsx");
  const styles = read("src/app/styles.css");

  it("pins the sole pilot composition to the approved near-black and warm-gold tokens", () => {
    expect(styles).toContain("--ink: #101013");
    expect(styles).toContain("--gold: #cda052");
    expect(styles).toContain("--gold-hover: #dfb262");
    expect(styles).toContain("--ivory: #f0eee9");
    expect(styles).toContain("--muted: #a7a39a");
    expect(renderer).toContain('className="fact-rail"');
    expect(renderer).toContain("editorial-feature");
    expect(renderer).not.toMatch(/template picker|template catalogue|provider/i);
  });

  it("locks the responsive header, hero and editorial widths across 320–1440", () => {
    expect(styles).toContain("min-width: 320px");
    expect(styles).toContain("height: 72px");
    expect(styles).toContain("height: 64px");
    expect(styles).toContain("88svh");
    expect(styles).toContain("76svh");
    expect(styles).toContain("max-width: 1200px");
    expect(styles).toContain("@media (min-width: 768px) and (max-width: 1024px)");
    expect(styles).toContain("@media (min-width: 1440px)");
  });

  it("preserves keyboard, zoom, reduced-motion, alt and semantic heading paths", () => {
    expect(styles).toContain(":focus-visible");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(styles).toContain("font-size: 100%");
    expect(styles).not.toContain("user-scalable=no");
    expect(renderer).toContain('alt={text(block.alt)}');
    expect(renderer).toContain('primaryHeading={page.role === "home"');
    expect(renderer).toContain('className="skip"');
  });

  it("gives every rendered interactive element a physical 44 by 44 CSS-pixel floor", () => {
    expect(styles).toContain(
      ":where(a, button, summary) {\n  min-width: 44px;\n  min-height: 44px;\n}",
    );
    expect(styles).toMatch(
      /a \{[\s\S]*?display: inline-flex;[\s\S]*?align-items: center;/,
    );
    for (const surface of [
      'className="brand"',
      'className="fact-rail"',
      "View on Mingla",
      "Open map",
      'className="footer"',
    ]) {
      expect(renderer).toContain(surface);
    }
  });

  it("keeps intrinsic 640px gallery media inside zero-minimum responsive tracks", () => {
    expect(styles).toContain(
      ".gallery {\n  display: grid;\n  grid-template-columns: minmax(0, 1.5fr) repeat(2, minmax(0, 1fr));",
    );
    expect(styles).toContain(
      "  .gallery {\n    grid-template-columns: repeat(2, minmax(0, 1fr));",
    );
    expect(styles).toContain(".gallery > * {\n  min-width: 0;\n}");
    expect(styles).toMatch(/\.gallery img \{[\s\S]*?width: 100%;/);
  });

  it("retains canonical commerce, consent, canonical metadata and crawler owners", () => {
    expect(renderer).toContain("isCanonicalMinglaHref");
    expect(renderer).toContain("TrackedLink");
    expect(renderer).toContain("ConsentControl");
    expect(read("src/app/page.tsx")).toContain("alternates: { canonical:");
    expect(read("src/app/page.tsx")).toContain("openGraph:");
    expect(read("src/app/sitemap.ts")).toContain("sitemap");
    expect(read("src/app/robots.ts")).toContain("robots");
  });
});
