/*
 * #2830 — Ari Website setup, second live certification (8/8, local Sites
 * stack, 2026-11-01): a TRIPS brand's published Home showed the venue strip
 * ("Visit · See restaurant details / Hours · See current opening hours /
 * Contact · Contact the restaurant"), and a trip card's link read
 * "Book : Fixture Coast Walk on Mingla".
 *
 *  - the Visit / Hours / Contact strip renders only for a site that sells a
 *    place (venue facts on its pages, or a composed Menu / Visit / Rooms page);
 *  - a live offering card's link reads "Book <title> on Mingla", no colon.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/config", () => ({ runtimeConfig: () => ({ runtimeHmac: Buffer.alloc(32, 9).toString("base64") }) }));

import type { SiteOffering } from "../../contracts/generated/offerings.ts";
import { upgradeV1ToV2 } from "../../contracts/generated/upgradeV1ToV2.ts";
import { gogiV1Fixture } from "../../contracts/gogiV1.fixture";
import { LiveOfferingGrid } from "../../components/v2/LiveOfferingGrid";
import { offeringCard, offeringFilters } from "../../lib/offeringCards";
import { homePage } from "../../lib/pageRouting";
import { siteHasVenueFacts } from "../../lib/venueFacts";
import { AtelierPage } from "./AtelierPage";

const VENUE_BLOCKS = new Set(["hours_location", "venue_reservation", "menu_link", "menu_board", "menu_preview"]);

/** The gögi fixture as a trips brand: no venue facts, no venue pages. */
function tripsSite() {
  const site = upgradeV1ToV2(gogiV1Fixture());
  const pages = site.pages as unknown as Array<Record<string, unknown> & { blocks: Array<{ type: string }> }>;
  for (const page of pages) {
    page.blocks = page.blocks.filter((block) => !VENUE_BLOCKS.has(block.type));
    if (["menu", "reservations"].includes(String(page.path ?? page.slug ?? ""))) page.enabled = false;
  }
  return site;
}

describe("#2830 the venue strip belongs to venues only", () => {
  it("a restaurant keeps its Visit / Hours / Contact strip on Home", () => {
    const site = upgradeV1ToV2(gogiV1Fixture());
    expect(siteHasVenueFacts(site)).toBe(true);
    const html = renderToStaticMarkup(<AtelierPage artifact={site} page={homePage(site)!} />);
    expect(html).toContain('class="fact-rail"');
  });

  it("a trips brand gets no restaurant strip and none of its placeholder words", () => {
    const site = tripsSite();
    expect(siteHasVenueFacts(site)).toBe(false);
    const html = renderToStaticMarkup(<AtelierPage artifact={site} page={homePage(site)!} />);
    expect(html).not.toContain("fact-rail");
    expect(html).not.toContain("See restaurant details");
    expect(html).not.toContain("See current opening hours");
    expect(html).not.toContain("Contact the restaurant");
  });

  it("a composed Visit page (a venue offering on the plan) still counts as a venue", () => {
    const site = tripsSite();
    const pages = site.pages as unknown as Array<Record<string, unknown>>;
    pages.push({ ...pages[pages.length - 1], id: "visit-page", path: "visit", slug: "visit", title: "Visit", enabled: true, blocks: [] });
    expect(siteHasVenueFacts(site)).toBe(true);
  });
});

describe("#2830 an offering card's link has no stray colon", () => {
  it("reads 'Book <title> on Mingla'", async () => {
    const SITE = "aaaaaaaa-1111-4111-8111-111111111111";
    const NOW = new Date("2026-06-10T12:00:00Z");
    const offering: SiteOffering = {
      id: "11111111-1111-4111-8111-000000000001",
      kind: "trip", slug: "fixture-coast-walk", title: "Fixture coast walk", summary: null, cover: null, destination_text: null,
      start_at: "2026-07-01T00:00:00Z", end_at: "2026-07-05T00:00:00Z", timezone: "Europe/London", status: "scheduled",
      bookings_closed: false, capacity: 20, spots_left: 4, group_minimum: null, min_price_minor: null, currency: "GBP",
      has_free_tier: false, public_url: "https://host.usemingla.com/t/local-test-trips/fixture-coast-walk", waitlist_enabled: false,
      installments_available: false,
    };
    const cards = new Map([[offering.id, await offeringCard(SITE, offering, NOW, "en")]]);
    const html = renderToStaticMarkup(
      <LiveOfferingGrid
        block={{ type: "offering_grid", kind: "trip", mode: "upcoming" }}
        live={{ source: "live", offerings: [offering], cards, now: NOW, filters: offeringFilters(undefined) }}
        context={{ siteId: SITE, brandId: "bbbbbbbb-1111-4111-8111-111111111111", publicationId: "cccccccc-1111-4111-8111-111111111111" }}
        clearHref="/trips"
      />,
    );
    expect(html).toContain('Book<span class="sr-only"> Fixture coast walk on Mingla</span>');
    expect(html).not.toMatch(/sr-only">:/);
  });
});
