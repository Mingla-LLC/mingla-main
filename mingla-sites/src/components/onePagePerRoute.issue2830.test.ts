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
// Comments discuss these attributes by name, so assertions that look for an
// attribute must not match the prose explaining it.
const siteNav = read("src/components/SiteNav.tsx").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

describe("#2830 one page per route", () => {
  it("renders the CURRENT page, not every page at once", () => {
    expect(renderer).toContain("page?: ArtifactPage");
    /*
     * #2830 -- the blocks are grouped first (a run of reels becomes one grid),
     * so this reads `groupReels(current.blocks)`. What matters is unchanged and
     * is what this asserts: the source of blocks is the CURRENT page, and no
     * other page's blocks are reachable from here.
     */
    expect(renderer).toContain("groupReels(current.blocks)");
    expect(renderer).not.toContain("artifact.pages.map");
    expect(renderer).not.toContain("enabledPages.map((page) =>");
  });

  it("navigation uses real paths, never anchors", () => {
    expect(renderer).not.toContain("`/#${page.role}`");
    expect(renderer).not.toContain('href={page.role === "home" ? "/" : `/#');
    expect(renderer).toContain("hrefForPage(navPage)");
  });

  it("marks the current page for assistive technology", () => {
    // The header nav became a disclosure component so phones have a way to
    // reach any page at all. The marking survives the move: the renderer still
    // computes which page is current, and SiteNav is what stamps aria-current.
    expect(renderer).toContain("current: navPage.role === current.role");
    expect(siteNav).toContain('aria-current={link.current ? "page" : undefined}');
  });

  it("the header navigation can be opened on a phone", () => {
    // It used to be display:none with no control anywhere to reveal it.
    const styles = read("src/app/styles.css");
    expect(siteNav).toContain("aria-expanded={open}");
    expect(siteNav).toContain("aria-controls={panelId}");
    expect(styles).toContain(".nav-burger");
    expect(styles).not.toMatch(/\.site-header nav \{[^}]*display: none/);
  });

  it("every navigation link is in the server-rendered HTML", () => {
    // Crawlers and find-in-page must see the whole navigation whether the
    // panel is open or shut, so the links are never conditionally rendered.
    expect(siteNav).toContain("links.map((link)");
    expect(siteNav).not.toMatch(/open\s*&&\s*links\.map/);
  });

  it("the fact rail belongs to the homepage only", () => {
    // #2830 -- same condition, now carried on the group.
    expect(renderer).toContain("isHome && group.index === primaryHeroIndex");
  });

  it("the sitemap lists real pages instead of one hardcoded URL", () => {
    expect(sitemap).toContain("navigablePages(artifact)");
    expect(sitemap).not.toContain('url: "https://gogi.sites.usemingla.com"');
  });

  it("an unresolvable host yields an EMPTY sitemap, never a guessed one", () => {
    expect(sitemap).toContain("return [];");
  });
});
