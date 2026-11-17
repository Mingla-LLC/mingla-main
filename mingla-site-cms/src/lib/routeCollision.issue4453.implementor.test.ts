/*
 * #4453 milestone 9 (spec v2.1 §1.2, SC-DP3) — publish refuses a page whose
 * address is a live offering's detail address (ROUTE_COLLISION), before
 * anything is written; an ended or cancelled offering claims no address.
 * Runs the real `buildPublicationArtifact` over a stubbed Payload and Core
 * projection (the same harness as the #3149 wave 4 suite).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const stored = new Map<string, Uint8Array>();
const feed = vi.hoisted(() => ({ status: "scheduled", endAt: "2027-02-10T00:00:00Z" }));

vi.mock("./config", () => ({ cmsConfig: () => ({ artifactBucket: "artifact-bucket" }) }));
vi.mock("./observability", () => ({ emitCmsObservation: async () => {} }));
vi.mock("./gateway", () => ({
  readCoreProjection: async () => ({
    offerings: [],
    menu: [],
    menu_venue_id: null,
    venue_slug: null,
    brand_slug: null,
    feed: {
      generated_at: "2026-11-16T00:00:00.000Z",
      brand: { slug: "far-field", currency: "GBP", payment_rails: "stripe" },
      offerings: [{
        id: "00000000-0000-4000-8000-000000000e01", kind: "trip", slug: "lofoten", title: "Lofoten Peaks", summary: null,
        cover: null, destination_text: null, start_at: "2027-02-03T00:00:00Z", end_at: feed.endAt, timezone: "Europe/Oslo",
        status: feed.status, bookings_closed: false, capacity: 12, spots_left: 4, group_minimum: null,
        min_price_minor: 149000, currency: "GBP", has_free_tier: false,
        public_url: "https://host.usemingla.com/t/far-field/lofoten", waitlist_enabled: false, installments_available: false,
      }],
    },
  }),
}));
vi.mock("./objectStore", () => ({
  writeObject: async (bucket: string, key: string, bytes: Uint8Array) => {
    stored.set(`${bucket}:${key}`, bytes);
  },
  readObject: async (bucket: string, key: string) => {
    const value = stored.get(`${bucket}:${key}`);
    if (!value) throw new Error("STORAGE_UNAVAILABLE");
    return value;
  },
}));

import { buildPublicationArtifact, publicationDraftDigest } from "./artifactBuilder";

const TENANT_ID = "00000000-0000-4000-8000-000000000901";
const SITE_ID = "00000000-0000-4000-8000-000000000902";
const tenant = { id: TENANT_ID, core_site_id: SITE_ID, core_brand_id: "00000000-0000-4000-8000-000000000903", primary_hostname: "far-field.sites.usemingla.com" };
const settings = {
  id: "settings-1", tenant: TENANT_ID, display_name: "Far Field", short_description: "Small-group trips.",
  background_color: "#f4f6f8", foreground_color: "#101820", accent_color: "#4a7fb0", typography: "condensed-display",
  canonical_url: "https://far-field.sites.usemingla.com", seo_title: "Far Field", seo_description: "Small-group trips.",
};
const grid = { blockType: "offering_grid", heading: "Trips", kind: "trip", mode: "upcoming" };

async function build(childSlug: string) {
  const pages = [
    { id: "page-home", tenant: TENANT_ID, slug: "", title: "Home", enabled: true, blocks: [grid] },
    { id: "page-trips", tenant: TENANT_ID, slug: "trips", title: "Trips", enabled: true, blocks: [grid] },
    { id: "page-child", tenant: TENANT_ID, slug: childSlug, parent: "page-trips", title: "A page", enabled: true, blocks: [grid] },
  ];
  const collections: Record<string, unknown[]> = {
    pages,
    navigation: [{ id: "nav-1", tenant: TENANT_ID, pages: ["page-home"] }],
    footer: [{ id: "footer-1", tenant: TENANT_ID, address: "1 Harbour Road" }],
    "site-settings": [settings],
    media: [],
  };
  const sourceDigest = await publicationDraftDigest({
    pages, navigation: collections.navigation![0] ?? null, footer: collections.footer![0] ?? null, settings, media: [],
  });
  const req = { context: {}, payload: { find: async ({ collection }: { collection: string }) => ({ docs: collections[collection] ?? [] }) } } as never;
  return buildPublicationArtifact(req, {
    tenant, operationId: "op-4453-m9", publicationId: "00000000-0000-4000-8000-000000000904",
    sourceRevisionId: "rev-4453-m9", sourceDigest, generatedAt: "2026-11-16T00:00:00Z",
  });
}

beforeEach(() => {
  stored.clear();
  feed.status = "scheduled";
  feed.endAt = "2027-02-10T00:00:00Z";
});

describe("#4453 M9 ROUTE_COLLISION at publish", () => {
  it("refuses a live page at /trips/<a live trip's slug> before anything is written", async () => {
    await expect(build("lofoten")).rejects.toThrow("ROUTE_COLLISION");
    expect(stored.size).toBe(0);
  });

  it("publishes a page at another address, and at an ended or cancelled trip's address", async () => {
    await expect(build("about-trips")).resolves.toBeTruthy();
    feed.status = "cancelled";
    await expect(build("lofoten")).resolves.toBeTruthy();
    feed.status = "ended";
    feed.endAt = "2026-01-10T00:00:00Z";
    await expect(build("lofoten")).resolves.toBeTruthy();
  });
});
