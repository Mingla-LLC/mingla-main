// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, beforeEach } from "vitest";

import { RestaurantV1 } from "./RestaurantV1";
import { readStored } from "./CartScope";
import { homePage } from "../lib/pageRouting";
import type { RestaurantArtifact } from "../contracts/artifact";

/**
 * #2830 -- the cart survives navigation, and the bag only exists when the site
 * can actually take an order.
 *
 * The cart used to live inside the menu block, so walking to another page and
 * back emptied it. What it must never become is a browser that remembers its
 * own prices.
 */
const U = (n: number) => `aaaaaaaa-bbbb-4ccc-8ddd-${String(n).padStart(12, "0")}`;

function artifactWith(menuBlock: Record<string, unknown> | null): RestaurantArtifact {
  return {
    schema_version: 1,
    site_id: U(1), brand_id: U(2), publication_id: U(3),
    renderer_key: "restaurant-website-v1", renderer_version: 1,
    source_revision_id: U(4), source_digest: "a".repeat(64),
    generated_at: "2026-09-08T00:00:00Z",
    pages: [
      { role: "home", slug: "home", title: "Home", enabled: true,
        nav_label: "Home", nav_order: 0,
        blocks: [{ type: "hero", heading: "Where Lagos comes to eat", ctas: [] }] },
      ...(menuBlock
        ? [{ role: "menu", slug: "menu", title: "Menu", enabled: true,
            nav_label: "Menu", nav_order: 1, blocks: [menuBlock] }]
        : []),
    ],
    navigation: { page_roles: menuBlock ? ["home", "menu"] : ["home"] },
    footer: { address: "69 Admiralty Way", legal_text: "c 2026", links: [] },
    site_settings: { display_name: "gogi", seo: { canonical_url: "https://gogi.sites.usemingla.com" } },
    media: [],
    commercial_references: [],
  } as unknown as RestaurantArtifact;
}

const render = (artifact: RestaurantArtifact) =>
  renderToStaticMarkup(<RestaurantV1 artifact={artifact} page={homePage(artifact)!} />);

const ORDERABLE = { type: "menu_board", heading: "Menu", venue_id: U(7), sections: [] };
const NOT_ORDERABLE = { type: "menu_board", heading: "Menu", sections: [] };

describe("#2830 the site cart", () => {
  it("shows a bag when the site names a venue it can order from", () => {
    expect(render(artifactWith(ORDERABLE))).toContain("header-cart");
  });

  it("shows NO bag when the menu names no venue", () => {
    // A menu you cannot order from is a disappointment; a bag that cannot
    // check out is a broken promise.
    expect(render(artifactWith(NOT_ORDERABLE))).not.toContain("header-cart");
  });

  it("shows NO bag when the site has no menu at all", () => {
    expect(render(artifactWith(null))).not.toContain("header-cart");
  });

  it("renders no count until something is in the cart", () => {
    // The server cannot know what a returning visitor has in their cart, so
    // the first paint must not claim a number.
    expect(render(artifactWith(ORDERABLE))).not.toContain("cart-count");
  });
});

describe("#2830 the stored cart is item ids and quantities, nothing else", () => {
  beforeEach(() => window.localStorage.clear());

  const put = (value: unknown) =>
    window.localStorage.setItem(`mingla_site_cart_v1:${U(1)}`, JSON.stringify(value));

  it("restores what was asked for", () => {
    put({ [U(5)]: 2, [U(6)]: 1 });
    expect(readStored(U(1))).toEqual({ [U(5)]: 2, [U(6)]: 1 });
  });

  it("drops quantities that are not small positive integers", () => {
    // Every one of these is an edit, not our data.
    put({ a: 0, b: -3, c: 2.5, d: 1e9, e: "4", f: null, g: 3 });
    expect(readStored(U(1))).toEqual({ g: 3 });
  });

  it("survives corrupt storage rather than throwing", () => {
    window.localStorage.setItem(`mingla_site_cart_v1:${U(1)}`, "{not json");
    expect(readStored(U(1))).toEqual({});
    put([1, 2, 3]);
    expect(readStored(U(1))).toEqual({});
  });

  it("is scoped per site", () => {
    put({ [U(5)]: 2 });
    expect(readStored(U(2))).toEqual({});
  });
});

describe("#2830 the cart never stores a price", () => {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "src/components/CartScope.tsx"), "utf8",
  ).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

  it("persists no money, currency or name", () => {
    // A stored price is a price a browser can be edited to change, and one that
    // may be older than the kitchen. The server prices every cart.
    for (const forbidden of ["price_minor", "currency", "amount_minor", "total"]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
