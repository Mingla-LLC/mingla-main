/*
 * #2829 W4 (T-W4, R-13) — Studio's offering grid becomes a LIVE grid when
 * "Which dates" is chosen:
 *  - the builder asks Core for the feed only then, and freezes it into the
 *    artifact as `offerings_snapshot` (the fallback when Core is down);
 *  - a site whose only offerings have ENDED still publishes (R-13);
 *  - picked offerings must be the brand's own (in its feed);
 *  - an original fixed grid still resolves through the commercial projection.
 */
// MINGLA-INVARIANT: I-PROPOSED-2829-11 | issue #2829 | Ended or cancelled Mingla offerings never fail a site publish; they stay in the feed and the snapshot with their state.
import { beforeEach, describe, expect, it, vi } from "vitest";

const stored = new Map<string, Uint8Array>();
const projectionCalls: Array<{ ids: string[]; feed: boolean }> = [];
let feed: unknown = null;
vi.mock("./config", () => ({ cmsConfig: () => ({ artifactBucket: "artifact-bucket" }) }));
vi.mock("./observability", () => ({ emitCmsObservation: async () => {} }));
vi.mock("./gateway", () => ({
  readCoreProjection: async (_path: string, _site: string, _op: string, ids: string[], _menu: boolean, _venue: boolean, includeFeed: boolean) => {
    projectionCalls.push({ ids, feed: includeFeed });
    return {
      offerings: ids.map((id) => ({ id, kind: "offering", title: "Tasting night", summary: "Six courses.", url: "https://host.usemingla.com/e/b/tasting" })),
      feed: includeFeed ? feed : null,
      menu: [],
      menu_venue_id: null,
    };
  },
}));
vi.mock("./objectStore", () => ({
  writeObject: async (bucket: string, key: string, bytes: Uint8Array) => { stored.set(`${bucket}:${key}`, bytes); },
  readObject: async (bucket: string, key: string) => {
    const value = stored.get(`${bucket}:${key}`);
    if (!value) throw new Error("STORAGE_UNAVAILABLE");
    return value;
  },
}));

import { assertArtifactV2 } from "../contracts/generated/artifactV2.ts";
import { buildPublicationArtifact, publicationDraftDigest } from "./artifactBuilder";
import type { FontPipelineDeps } from "./fontAssets";

const SITE = "00000000-0000-4000-8000-000000000001";
const BRAND = "00000000-0000-4000-8000-000000000002";
const PUBLICATION = "00000000-0000-4000-8000-000000000904";
const ENDED_ID = "11111111-1111-4111-8111-000000000001";
const OTHER_ID = "11111111-1111-4111-8111-000000000999";
const FIXED_ID = "11111111-1111-4111-8111-000000000777";

const endedTrip = {
  id: ENDED_ID, kind: "trip", slug: "bali", title: "Bali", summary: null, cover: null, destination_text: "Bali",
  start_at: "2026-03-01T00:00:00+00:00", end_at: "2026-03-08T00:00:00+00:00", timezone: "Asia/Makassar", status: "ended",
  bookings_closed: false, capacity: null, spots_left: null, group_minimum: null, min_price_minor: null, currency: "USD",
  has_free_tier: false, public_url: "https://host.usemingla.com/t/youngandstamped/bali", waitlist_enabled: false,
  installments_available: false,
};

const offlineFonts: FontPipelineDeps = {
  fetch: (async () => { throw new Error("NO_NETWORK_IN_TESTS"); }) as typeof fetch,
  storeFont: async () => {},
  cachedFaces: async (key) => key.split("|")[1]!.split(",").map((weight, index) => ({
    family: key.split("|")[0]!, weight: Number(weight), style: "normal" as const, unicode_range: "U+0000-00FF",
    digest: String(index).padEnd(64, "b"), bytes: 1000,
  })),
  saveFaces: async () => {},
};

async function build(blocks: unknown[]) {
  const tenant = { id: "t1", core_site_id: SITE, core_brand_id: BRAND, primary_hostname: "brand.sites.localhost" };
  const settings = { id: "settings-1", tenant: "t1", display_name: "Brand" };
  const page = { id: "page-home", tenant: "t1", slug: "", title: "Home", enabled: true, blocks };
  const collections: Record<string, unknown[]> = {
    pages: [page], navigation: [{ id: "nav-1", tenant: "t1", items: [] }], footer: [{ id: "footer-1", tenant: "t1" }],
    "site-settings": [settings], media: [],
  };
  const sourceDigest = await publicationDraftDigest({ pages: [page], navigation: collections.navigation![0] ?? null, footer: collections.footer![0] ?? null, settings, media: [] });
  const req = { context: {}, payload: { find: async ({ collection }: { collection: string }) => ({ docs: collections[collection] ?? [] }) } } as never;
  return buildPublicationArtifact(req, {
    tenant: tenant as never, operationId: "op-w4", publicationId: PUBLICATION,
    sourceRevisionId: "rev-w4", sourceDigest, generatedAt: "2026-10-26T00:00:00Z", fontPipeline: offlineFonts,
  });
}

beforeEach(() => {
  stored.clear();
  projectionCalls.length = 0;
  feed = { generated_at: "2026-10-26T00:00:00.000Z", brand: { slug: "youngandstamped", currency: "USD", payment_rails: "stripe" }, offerings: [endedTrip] };
});

describe("#2829 W4 live offering grids", () => {
  it("publishes a site whose only offering has ended, with the feed frozen as its snapshot (R-13)", async () => {
    const built = await build([{ blockType: "offering_grid", heading: "Past trips", mode: "past", kind: "trip", show_filters: false }]);
    expect(projectionCalls).toEqual([{ ids: [], feed: true }]);
    expect(built.artifact.offerings_snapshot.map((offering) => offering.id)).toEqual([ENDED_ID]);
    const grid = built.artifact.pages[0]!.blocks[0]!;
    expect(grid).toMatchObject({ type: "offering_grid", variant: "atelier", heading: "Past trips", mode: "past", kind: "trip" });
    expect(grid).not.toHaveProperty("offerings");
    expect(() => assertArtifactV2(JSON.parse(built.serialized))).not.toThrow();
  });

  it("keeps picked offerings in order, and refuses one that is not the brand's", async () => {
    const built = await build([{ blockType: "offering_grid", mode: "all", kind: "all", offering_ids: [{ offering_id: ENDED_ID }] }]);
    expect(built.artifact.pages[0]!.blocks[0]).toMatchObject({ offering_ids: [{ id: ENDED_ID }] });
    await expect(build([{ blockType: "offering_grid", mode: "all", offering_ids: [{ offering_id: OTHER_ID }] }])).rejects.toThrow("VALIDATION_FAILED");
  });

  it("refuses to publish a live grid without a readable feed", async () => {
    feed = null;
    await expect(build([{ blockType: "offering_grid", mode: "upcoming" }])).rejects.toThrow("VALIDATION_FAILED");
  });

  it("an original fixed grid still resolves through the projection and reads no feed", async () => {
    const built = await build([{ blockType: "offering_grid", heading: "Experiences", offering_ids: [{ offering_id: FIXED_ID }] }]);
    expect(projectionCalls).toEqual([{ ids: [FIXED_ID], feed: false }]);
    expect(built.artifact.offerings_snapshot).toEqual([]);
    expect(built.artifact.pages[0]!.blocks[0]).toMatchObject({ offerings: [{ id: FIXED_ID, label: "Tasting night" }] });
  });
});
