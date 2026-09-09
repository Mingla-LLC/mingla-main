/*
 * #3149 — with the header FIXED, nothing may start underneath it.
 *
 * Three page shapes reach this renderer and each needs a different answer, so
 * these RENDER each shape and read the markup rather than trusting that the
 * one shape on the live site is the only one that exists.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RestaurantV1 } from "./RestaurantV1";
import { homePage, pageForSlug } from "../lib/pageRouting";
import type { RestaurantArtifact } from "../contracts/artifact";

const U = (n: number) => `aaaaaaaa-bbbb-4ccc-8ddd-${String(n).padStart(12, "0")}`;

const HERO = { type: "hero", heading: "Where Lagos comes to eat", ctas: [] };
const PROSE = {
  type: "rich_text",
  heading: "Our story",
  paragraphs: [{ text: "A 24/7 food house." }],
};

const artifact = {
  schema_version: 1,
  site_id: U(1), brand_id: U(2), publication_id: U(3),
  renderer_key: "restaurant-website-v1", renderer_version: 1,
  source_revision_id: U(4), source_digest: "a".repeat(64),
  generated_at: "2026-09-08T00:00:00Z",
  pages: [
    { role: "home", slug: "home", title: "Home", enabled: true,
      nav_label: "Home", nav_order: 0, blocks: [HERO] },
    // No hero at all — the inner-page band renders first.
    { role: "menu", slug: "menu", title: "Menu", enabled: true,
      nav_label: "Menu", nav_order: 1, blocks: [PROSE] },
    // A hero, but not first: the prose above it would start behind the header.
    { role: "about", slug: "about", title: "About", enabled: true,
      nav_label: "About", nav_order: 2, blocks: [PROSE, HERO] },
  ],
  navigation: { page_roles: ["home", "menu", "about"] },
  footer: { address: "69 Admiralty Way", legal_text: "c 2026", links: [] },
  site_settings: { display_name: "gogi", seo: { canonical_url: "https://gogi.sites.usemingla.com" } },
  media: [],
  commercial_references: [],
} as unknown as RestaurantArtifact;

const render = (slug: string | null) =>
  renderToStaticMarkup(
    <RestaurantV1
      artifact={artifact}
      page={slug ? pageForSlug(artifact, slug)! : homePage(artifact)!}
    />,
  );

const mainTag = (html: string) => html.match(/<main[^>]*>/)![0];

describe("#3149 clearing the fixed header", () => {
  it("a hero-led page is NOT offset — the hero runs under the header", () => {
    // The hero is a full viewport and the header is transparent over it. An
    // offset here would leave a bare strip above the brand's photograph and
    // push the hero back off the bottom of the screen.
    expect(mainTag(render(null))).not.toContain("header-offset");
  });

  it("a page with no hero is NOT offset — its band carries the clearance", () => {
    // The band's own backdrop must still reach the top of the screen and show
    // through the transparent header; only its title moves down.
    const html = render("menu");
    expect(html).toContain('<header class="page-header"');
    expect(mainTag(html)).not.toContain("header-offset");
  });

  it("a page whose hero is NOT first IS offset", () => {
    const html = render("about");
    // No band on this page — it has a hero, just not at the top.
    expect(html).not.toContain('<header class="page-header"');
    expect(mainTag(html)).toContain("header-offset");
  });

  it("every page still renders the header itself", () => {
    for (const slug of [null, "menu", "about"]) {
      expect(render(slug)).toContain('<header class="site-header">');
    }
  });
});
