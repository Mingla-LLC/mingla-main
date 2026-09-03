import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RestaurantV1 } from "./RestaurantV1";
import type { RestaurantArtifact } from "../contracts/artifact";
import { pageForSlug, homePage } from "../lib/pageRouting";

/**
 * #2830 -- RUNTIME proof, not a source grep.
 *
 * "Exactly one h1 per page" is an accessibility invariant, and the previous
 * contract asserted it by matching a string in the source. That stopped being
 * true the moment the renderer changed shape. This renders the component and
 * counts the headings, which is the thing anyone actually cares about.
 */
const mkPage = (
  role: RestaurantArtifact["pages"][number]["role"],
  slug: string,
  nav_order: number,
  blocks: unknown[],
) => ({ role, slug, title: `${role} title`, enabled: true, nav_label: role, nav_order, blocks });

const artifact = {
  schema_version: 1,
  site_id: "s",
  brand_id: "b",
  renderer_key: "restaurant-website-v1",
  renderer_version: 1,
  publication_id: "p",
  source_revision_id: "r",
  source_digest: "d",
  generated_at: "2026-09-03T00:00:00Z",
  pages: [
    mkPage("home", "home", 0, [
      { type: "hero", heading: "Where Lagos comes to eat", subheading: "sub", ctas: [] },
      { type: "hours_location", heading: "Visit", address: "69 Admiralty Way", hours: [{ day: "Monday", value: "Open 24 hours" }] },
    ]),
    mkPage("menu", "menu", 1, [
      { type: "rich_text", heading: "Our menu", paragraphs: [{ text: "Small chops" }] },
    ]),
  ],
  navigation: { page_roles: ["home", "menu"] },
  footer: { address: "69 Admiralty Way", legal_text: "c 2026", links: [] },
  site_settings: { display_name: "gogi", seo: { canonical_url: "https://gogi.sites.usemingla.com" } },
  media: [],
  commercial_references: [],
} as unknown as RestaurantArtifact;

const countTag = (html: string, tag: string) =>
  (html.match(new RegExp(`<${tag}[\\s>]`, "g")) || []).length;

describe("#2830 rendered page structure", () => {
  it("the homepage has exactly one h1, and it is the hero", () => {
    const html = renderToStaticMarkup(
      <RestaurantV1 artifact={artifact} page={homePage(artifact)!} />,
    );
    expect(countTag(html, "h1")).toBe(1);
    expect(html).toContain("Where Lagos comes to eat");
  });

  it("a page with NO hero still has exactly one h1 -- its own title", () => {
    const menu = pageForSlug(artifact, "menu")!;
    const html = renderToStaticMarkup(
      <RestaurantV1 artifact={artifact} page={menu} />,
    );
    expect(countTag(html, "h1")).toBe(1);
    expect(html).toContain("menu title");
  });

  it("a page renders ONLY its own blocks -- the repeated-hours bug", () => {
    const menu = pageForSlug(artifact, "menu")!;
    const html = renderToStaticMarkup(
      <RestaurantV1 artifact={artifact} page={menu} />,
    );
    expect(html).toContain("Small chops");
    // The live site showed home's hours on every "page" because every page was
    // the same document. The Menu page must not carry them.
    expect(html).not.toContain("Open 24 hours");
    expect(html).not.toContain("Where Lagos comes to eat");
  });

  it("navigation links to real paths and marks the current page", () => {
    const menu = pageForSlug(artifact, "menu")!;
    const html = renderToStaticMarkup(
      <RestaurantV1 artifact={artifact} page={menu} />,
    );
    expect(html).toContain('href="/menu"');
    expect(html).toContain('aria-current="page"');
    expect(html).not.toContain('href="/#menu"');
  });

  it("the fact rail appears on home only", () => {
    const home = renderToStaticMarkup(
      <RestaurantV1 artifact={artifact} page={homePage(artifact)!} />,
    );
    const menu = renderToStaticMarkup(
      <RestaurantV1 artifact={artifact} page={pageForSlug(artifact, "menu")!} />,
    );
    expect(home).toContain("fact-rail");
    expect(menu).not.toContain("fact-rail");
  });

  it("no page prints Mingla's internal template name", () => {
    for (const page of artifact.pages) {
      const html = renderToStaticMarkup(
        <RestaurantV1 artifact={artifact} page={page} />,
      );
      expect(html).not.toContain("Restaurant Website v1");
    }
  });
});
