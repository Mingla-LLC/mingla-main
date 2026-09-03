import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RestaurantV1 } from "./RestaurantV1";
import { assertRestaurantArtifact } from "../contracts/artifact";
import type { RestaurantArtifact } from "../contracts/artifact";

/**
 * #2830 -- the real menu, and the rule that a price is never invented.
 *
 * The site only ever had `menu_link`: a button pointing at a PDF. gogi's actual
 * menu is 48 items. Mingla already owns them in `menus` / `menu_items`, where
 * price is in MINOR units and NULL means "price on request".
 *
 * The trap this pins: rendering a missing price as 0, or picking a currency
 * when none is recorded. On a restaurant's own menu that is not a cosmetic
 * default, it is a live commercial lie.
 */
const menuBlock = {
  type: "menu_board",
  heading: "The menu",
  note: "Served all day, every day.",
  sections: [
    {
      name: "Rice",
      description: "From the pot",
      items: [
        { name: "Coconut rice", description: "with grilled chicken", price_minor: 850000, currency: "NGN" },
        { name: "Market price fish", description: null, price_minor: null, currency: null },
        { name: "Jollof", description: null, price_minor: 700000, currency: "NGN" },
      ],
    },
  ],
};

const artifact = {
  schema_version: 1,
  site_id: "11111111-2222-4333-8444-555555555555",
  brand_id: "22222222-3333-4444-8555-666666666666",
  renderer_key: "restaurant-website-v1",
  renderer_version: 1,
  publication_id: "33333333-4444-4555-8666-777777777777",
  source_revision_id: "44444444-5555-4666-8777-888888888888",
  source_digest: "a".repeat(64),
  generated_at: "2026-09-03T00:00:00Z",
  pages: [
    {
      role: "menu",
      slug: "menu",
      title: "Menu",
      enabled: true,
      nav_label: "Menu",
      nav_order: 1,
      blocks: [menuBlock],
    },
    {
      role: "home",
      slug: "home",
      title: "Home",
      enabled: true,
      nav_label: "Home",
      nav_order: 0,
      blocks: [],
    },
  ],
  navigation: { page_roles: ["home", "menu"] },
  footer: { address: "69 Admiralty Way", legal_text: "c 2026", links: [] },
  site_settings: { display_name: "gogi", seo: { canonical_url: "https://gogi.sites.usemingla.com" } },
  media: [],
  commercial_references: [],
} as unknown as RestaurantArtifact;

const menuPage = artifact.pages[0];
const html = () =>
  renderToStaticMarkup(<RestaurantV1 artifact={artifact} page={menuPage} />);

describe("#2830 the real menu", () => {
  it("renders every item and its section", () => {
    const out = html();
    expect(out).toContain("Coconut rice");
    expect(out).toContain("Jollof");
    expect(out).toContain("Market price fish");
    expect(out).toContain("Rice");
  });

  it("formats a recorded price from MINOR units", () => {
    const out = html();
    // 850000 minor = 8,500 major. The exact glyph is locale-dependent; the
    // NUMBER must be right and must not be 850000 or 8.5.
    expect(out).toMatch(/8[.,]500/);
    expect(out).not.toContain("850000");
  });

  it("shows NO price for an item that has none -- never 0, never a guess", () => {
    const out = html();
    const row = out.slice(out.indexOf("Market price fish"));
    const nextRow = row.slice(0, row.indexOf("Jollof"));
    expect(nextRow).not.toContain("menu-price");
    expect(nextRow).not.toMatch(/[0-9]/);
  });

  it("drops the price when currency is missing, rather than assuming one", () => {
    const noCurrency = {
      ...artifact,
      pages: [
        {
          ...menuPage,
          blocks: [
            {
              ...menuBlock,
              sections: [
                {
                  name: "Rice",
                  description: null,
                  items: [
                    { name: "Jollof", description: null, price_minor: 700000, currency: null },
                  ],
                },
              ],
            },
          ],
        },
      ],
    } as unknown as RestaurantArtifact;
    const out = renderToStaticMarkup(
      <RestaurantV1 artifact={noCurrency} page={noCurrency.pages[0]} />,
    );
    expect(out).toContain("Jollof");
    expect(out).not.toContain("menu-price");
    expect(out).not.toContain("7000");
  });

  it("the dotted leader is decorative, so a reader hears the item and price only", () => {
    expect(html()).toContain('class="menu-leader" aria-hidden="true"');
  });

  it("the artifact validator accepts the block and rejects a bad price", () => {
    expect(() => assertRestaurantArtifact(artifact)).not.toThrow();
    const bad = JSON.parse(JSON.stringify(artifact));
    bad.pages[0].blocks[0].sections[0].items[0].price_minor = 12.5;
    expect(() => assertRestaurantArtifact(bad)).toThrow();
    const badCurrency = JSON.parse(JSON.stringify(artifact));
    badCurrency.pages[0].blocks[0].sections[0].items[0].currency = "naira";
    expect(() => assertRestaurantArtifact(badCurrency)).toThrow();
  });
});
