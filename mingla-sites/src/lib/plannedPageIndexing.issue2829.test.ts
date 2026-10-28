/*
 * #2829 W9a (SC-29) — an empty planned offering page is noindex and absent
 * from the sitemap, and is listed again on its own once Mingla's feed has an
 * offering for it (no republish). Drives the real sitemap route and page
 * metadata with the feed and the host resolution faked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const feed = vi.hoisted(() => ({ offerings: [] as unknown[] }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "brand.sites.localhost:3100" }) }));
vi.mock("./offeringsFeed", () => ({
  siteOfferings: async () => ({ source: "live", offerings: feed.offerings }),
}));
const tripsGrid = { type: "offering_grid", variant: "neutral", kind: "trip", mode: "upcoming", empty_text: "No trips on sale yet. Tell us where you want to go" };
const artifact = {
  artifact_schema_version: 2,
  renderer_key: "sites-v2",
  site_id: "11111111-1111-4111-8111-111111111111",
  language: "en",
  brand: { display_name: "Brand" },
  seo: { canonical_url: "http://brand.sites.localhost:3100/" },
  pages: [
    { path: "", title: "Home", enabled: true, kind: "standard", blocks: [{ type: "cta", variant: "neutral", heading: "Hi", label: "Go", href: "/trips" }] },
    { path: "trips", title: "Trips", enabled: true, kind: "collection_index", collection: "trips", blocks: [tripsGrid] },
    { path: "about", title: "About", enabled: true, kind: "standard", blocks: [] },
  ],
  navigation: { items: [] },
  routes: {},
  redirects: [],
  collections: { destinations: [], stories: [], categories: [], testimonials: [] },
  offerings_snapshot: [],
};
const resolution = {
  site_id: artifact.site_id, hostname: "brand.sites.localhost", primary_hostname: "brand.sites.localhost",
  is_primary: true, publication_id: "p", artifact_digest: "d",
};
vi.mock("./publication", async (original) => ({
  ...(await original<typeof import("./publication")>()),
  loadPublication: async () => ({ artifact, resolution }),
  canonicalOrigin: () => "http://brand.sites.localhost:3100",
  requestHost: () => "brand.sites.localhost",
  onPrimaryOrigin: (url: string) => url,
}));
vi.mock("../lib/publication", async (original) => ({
  ...(await original<typeof import("./publication")>()),
  loadPublication: async () => ({ artifact, resolution }),
  canonicalOrigin: () => "http://brand.sites.localhost:3100",
  requestHost: () => "brand.sites.localhost",
  onPrimaryOrigin: (url: string) => url,
}));

const upcomingTrip = {
  id: "22222222-2222-4222-8222-222222222222", kind: "trip", slug: "coast", title: "Coast week", summary: null, cover: null,
  destination_text: null, start_at: "2099-06-20T10:00:00.000Z", end_at: "2099-06-27T10:00:00.000Z", timezone: "UTC",
  status: "scheduled", bookings_closed: false, capacity: 10, spots_left: 5, group_minimum: null, min_price_minor: 1000,
  currency: "USD", has_free_tier: false, public_url: "https://host.usemingla.com/t/b/coast", waitlist_enabled: false,
  installments_available: false,
};

describe("#2829 W9a SC-29 planned page indexing", () => {
  beforeEach(() => { feed.offerings = []; });

  it("the sitemap leaves an empty Trips page out, and lists it once a trip is on sale", async () => {
    const { default: sitemap } = await import("../app/sitemap");
    expect((await sitemap()).map((row) => row.url)).toEqual([
      "http://brand.sites.localhost:3100/", "http://brand.sites.localhost:3100/about",
    ]);
    feed.offerings = [upcomingTrip];
    expect((await sitemap()).map((row) => row.url)).toContain("http://brand.sites.localhost:3100/trips");
  });

  it("the empty Trips page says noindex; filled, it does not; About never does", async () => {
    const { generateMetadata } = await import("../app/[[...path]]/page");
    const meta = (path: string[]) => generateMetadata({ params: Promise.resolve({ path }) });
    expect((await meta(["trips"])).robots).toEqual({ index: false, follow: true });
    expect((await meta(["about"])).robots).toEqual({ index: true, follow: true });
    feed.offerings = [upcomingTrip];
    expect((await meta(["trips"])).robots).toEqual({ index: true, follow: true });
  });
});
