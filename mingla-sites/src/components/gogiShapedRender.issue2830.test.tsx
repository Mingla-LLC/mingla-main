import { describe, it, expect } from "vitest";
/*
 * #2830 — the hero headline is rendered in two tones (its second half carries
 * the brand accent), so the words are split across an inner <span>. Assert on
 * the TEXT, not the raw markup: the heading a person reads is unchanged, and
 * asserting on markup would forbid any future styling of it.
 */
const textOf = (html: string) =>
  html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

import { renderToStaticMarkup } from "react-dom/server";
import fs from "node:fs";
import path from "node:path";
import { RestaurantV1 } from "./RestaurantV1";
import { homePage, pageForSlug } from "../lib/pageRouting";
import type { RestaurantArtifact } from "../contracts/artifact";

const U = (n: number) => `aaaaaaaa-bbbb-4ccc-8ddd-${String(n).padStart(12, "0")}`;

export const gogiShaped = {
  schema_version: 1,
  site_id: U(90), brand_id: U(91), publication_id: U(92),
  renderer_key: "restaurant-website-v1", renderer_version: 1,
  source_revision_id: U(93), source_digest: "a".repeat(64),
  generated_at: "2026-09-03T00:00:00Z",
  pages: [
    { role: "home", slug: "home", title: "Home", enabled: true, nav_label: "Home", nav_order: 0, blocks: [
      { type: "hero", heading: "Where Lagos comes to eat",
        subheading: "A 24/7 food house on Admiralty Way. Rice bowls, burgers, shawarma, smoothies and cocktails.",
        media_url: "/media/hero/1600",
        ctas: [{ label: "See the menu", href: "/menu" }, { label: "Find us", href: "/visit" }] },
      { type: "hours_location", heading: "Visit", address: "69 Admiralty Way, Lekki Phase 1, Lagos",
        map_url: "https://maps.example/gogi",
        hours: [{ day: "Monday", value: "Open 24 hours" }, { day: "Tuesday", value: "Open 24 hours" }] },
      { type: "rich_text", heading: "Open day and night",
        paragraphs: [{ text: "Come as you are. Rice bowls at noon, shawarma at three in the morning." }] },
      { type: "gallery", heading: "In the room",
        images: [{ url: "/media/g1/800", alt: "Coconut rice" }, { url: "/media/g2/800", alt: "The room" },
                 { url: "/media/g3/800", alt: "Late night" }] },
    ] },
    { role: "menu", slug: "menu", title: "Menu", enabled: true, nav_label: "Menu", nav_order: 1, blocks: [
      { type: "menu_board", heading: "The menu", note: "Served all day, every day.", venue_id: null, sections: [
        { name: "Rice", description: null, items: [
          { id: U(1), name: "Coconut rice", description: "with grilled chicken", price_minor: 850000, currency: "NGN" },
          { id: U(2), name: "Fish of the day", description: null, price_minor: null, currency: null }] }] },
    ] },
  ],
  navigation: { page_roles: ["home", "menu"] },
  footer: { address: "69 Admiralty Way, Lekki Phase 1, Lagos", legal_text: "© 2026 gögi", links: [] },
  site_settings: { display_name: "gögi", short_description: "A 24/7 food house in Lekki.",
    colors: { background: "#101013", foreground: "#f0eee9", accent: "#cda052" },
    seo: { canonical_url: "https://gogi.sites.usemingla.com" } },
  media: [], commercial_references: [],
} as unknown as RestaurantArtifact;

const OUT = process.env.SITE_PREVIEW_DIR ?? "";

function page(html: string): string {
  const css = fs.readFileSync(path.resolve(process.cwd(), "src/app/styles.css"), "utf8");
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}
.hero{background-image:linear-gradient(90deg,rgba(8,6,4,.86),rgba(8,6,4,.25)),url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16'%3E%3Crect width='16' height='16' fill='%234a2c11'/%3E%3C/svg%3E");background-size:cover}
.gallery img{background:#2a1c0e;min-height:200px;width:100%;object-fit:cover}
</style>${html}`;
}

describe("#2830 gogi-shaped render", () => {
  it("renders home and menu, and writes them when asked", () => {
    const home = renderToStaticMarkup(
      <RestaurantV1 artifact={gogiShaped} page={homePage(gogiShaped)!} />,
    );
    const menu = renderToStaticMarkup(
      <RestaurantV1 artifact={gogiShaped} page={pageForSlug(gogiShaped, "menu")!} />,
    );
    expect(textOf(home)).toContain("Where Lagos comes to eat");
    expect(menu).toContain("Coconut rice");
    if (OUT) {
      fs.writeFileSync(path.join(OUT, "gogi-home.html"), page(home));
      fs.writeFileSync(path.join(OUT, "gogi-menu.html"), page(menu));
    }
  });
});

/*
 * #2830 — the facts belong INSIDE the hero, at its foot. They used to render
 * as a sibling band below it, which on a full-height hero pushed them off the
 * first screen entirely and read as an unrelated section.
 *
 * This RENDERS rather than reading the component as text. Every defect on this
 * issue passed a source-reading test and failed on its first real execution.
 */
describe("#2830 the hero carries the facts", () => {
  const html = renderToStaticMarkup(
    RestaurantV1({ artifact: gogiShaped as unknown as RestaurantArtifact, page: homePage(gogiShaped as unknown as RestaurantArtifact)! }) as never,
  );

  it("puts the fact rail inside the hero section, not after it", () => {
    const hero = html.match(/<section class="hero"[\s\S]*?<\/section>/);
    expect(hero).not.toBeNull();
    expect(hero![0]).toContain('class="fact-rail"');
  });

  it("still renders exactly one fact rail", () => {
    expect(html.split('class="fact-rail"').length - 1).toBe(1);
  });

  it("keeps the facts' meaning in the markup, not in the styling", () => {
    // A <dl> is what makes "Visit"/"Hours"/"Contact" label their values for a
    // screen reader. Moving the rail must not have flattened it into divs.
    const hero = html.match(/<section class="hero"[\s\S]*?<\/section>/)![0];
    expect(hero).toContain("<dl>");
    expect(hero).toContain("<dt>");
    expect(hero).toContain("<dd>");
  });

  it("does not put the arrow in the button's accessible name", () => {
    // The arrow is a ::after content rule. If it ever moves into the markup, a
    // screen reader starts announcing "See the menu right arrow".
    expect(textOf(html)).not.toContain("→");
  });
});

/*
 * #2830 — the h1 invariant, asserted by RENDERING rather than by matching the
 * component's source text. A page with no hero gets exactly one h1 and it is
 * the page's title; the home page's h1 is the hero's headline.
 */
describe("#2830 exactly one h1 per page", () => {
  const render = (slug?: string) => renderToStaticMarkup(
    RestaurantV1({
      artifact: gogiShaped as unknown as RestaurantArtifact,
      page: slug
        ? pageForSlug(gogiShaped as unknown as RestaurantArtifact, slug)!
        : homePage(gogiShaped as unknown as RestaurantArtifact)!,
    }) as never,
  );

  it("gives the home page one h1, and it is the hero's headline", () => {
    const html = render();
    expect(html.match(/<h1[\s>]/g)?.length).toBe(1);
    expect(textOf(html.match(/<h1[\s\S]*?<\/h1>/)![0])).toContain("Where Lagos");
  });

  it("gives an inner page one h1, and it is the page title", () => {
    const html = render("menu");
    expect(html.match(/<h1[\s>]/g)?.length).toBe(1);
    expect(html).toContain('class="page-header"');
    expect(html).toContain('aria-label="Breadcrumb"');
  });
});
