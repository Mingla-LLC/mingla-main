import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * #2830 -- the renderer must render ONE page.
 *
 * It concatenated every enabled page into a single document and linked between
 * them with anchors, so Home and Visit were literally the same page. That is
 * why the live Gogi site showed the hours block three times, and why "five
 * pages" was never true of anything a customer could visit.
 *
 * FAILS ON REVERT: restore the enabledPages.map() around the body, or the
 * `/#${page.role}` anchor hrefs, and these fail.
 */
const read = (relative: string) =>
  fs.readFileSync(path.resolve(process.cwd(), relative), "utf8");

const renderer = read("src/components/RestaurantV1.tsx");
const sitemap = read("src/app/sitemap.ts");

describe("#2830 one page per route", () => {
  it("renders the CURRENT page, not every page at once", () => {
    expect(renderer).toContain("page?: ArtifactPage");
    expect(renderer).toContain("current.blocks.map");
    expect(renderer).not.toContain("enabledPages.map((page) =>");
  });

  it("navigation uses real paths, never anchors", () => {
    expect(renderer).not.toContain("`/#${page.role}`");
    expect(renderer).not.toContain('href={page.role === "home" ? "/" : `/#');
    expect(renderer).toContain("hrefForPage(navPage)");
  });

  it("marks the current page for assistive technology", () => {
    expect(renderer).toContain('aria-current={navPage.role === current.role ? "page" : undefined}');
  });

  it("the fact rail belongs to the homepage only", () => {
    expect(renderer).toContain("isHome && index === primaryHeroIndex");
  });

  it("the sitemap lists real pages instead of one hardcoded URL", () => {
    expect(sitemap).toContain("navigablePages(artifact)");
    expect(sitemap).not.toContain('url: "https://gogi.sites.usemingla.com"');
  });

  it("an unresolvable host yields an EMPTY sitemap, never a guessed one", () => {
    expect(sitemap).toContain("return [];");
  });
});
