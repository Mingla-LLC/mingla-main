/*
 * #2829 W7c (amendment A13.1) — offering cover renditions made once at
 * publish: the builder reads each cover in the publish-time feed, makes the
 * 4:3 crops (400×300, 768×576) and the 1600-wide picture with sharp, stores
 * them content-addressed in Sites storage and records them in the artifact
 * by cover path; a cover processed before is read back, not made again; a
 * cover that cannot be read leaves the publish working without renditions.
 */
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

import { createHash } from "node:crypto";
import sharp from "sharp";
import { assertArtifactV2, offeringMediaKey } from "../contracts/generated/artifactV2.ts";
import { buildPublicationArtifact, publicationDraftDigest } from "./artifactBuilder";
import type { FontPipelineDeps } from "./fontAssets";
import type { CoverRenditionDeps } from "./offeringCoverRenditions";

const SITE = "00000000-0000-4000-8000-000000000001";
const BRAND = "00000000-0000-4000-8000-000000000002";
const PUBLICATION = "00000000-0000-4000-8000-000000000904";
const ENDED_ID = "11111111-1111-4111-8111-000000000001";

const endedTrip = {
  id: ENDED_ID, kind: "trip", slug: "coast-week", title: "Coast Week", summary: null, cover: null, destination_text: "Harbour Coast",
  start_at: "2026-03-01T00:00:00+00:00", end_at: "2026-03-08T00:00:00+00:00", timezone: "Asia/Makassar", status: "ended",
  bookings_closed: false, capacity: null, spots_left: null, group_minimum: null, min_price_minor: null, currency: "USD",
  has_free_tier: false, public_url: "https://host.usemingla.com/t/fixture-brand/coast-week", waitlist_enabled: false,
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

async function build(blocks: unknown[], media: unknown[] = [], coverRenditions?: CoverRenditionDeps) {
  const tenant = { id: "t1", core_site_id: SITE, core_brand_id: BRAND, primary_hostname: "brand.sites.localhost" };
  const settings = { id: "settings-1", tenant: "t1", display_name: "Brand" };
  const page = { id: "page-home", tenant: "t1", slug: "", title: "Home", enabled: true, blocks };
  const collections: Record<string, unknown[]> = {
    pages: [page], navigation: [{ id: "nav-1", tenant: "t1", items: [] }], footer: [{ id: "footer-1", tenant: "t1" }],
    "site-settings": [settings], media,
  };
  const sourceDigest = await publicationDraftDigest({ pages: [page], navigation: collections.navigation![0] ?? null, footer: collections.footer![0] ?? null, settings, media });
  const req = { context: {}, payload: { find: async ({ collection }: { collection: string }) => ({ docs: collections[collection] ?? [] }) } } as never;
  return buildPublicationArtifact(req, {
    tenant: tenant as never, operationId: "op-w7c", publicationId: PUBLICATION,
    sourceRevisionId: "rev-w4", sourceDigest, generatedAt: "2026-10-26T00:00:00Z", fontPipeline: offlineFonts, coverRenditions,
  });
}


const COVER_PATH = "event_covers/brand/coast/cover.jpg";
let coverBytes: Uint8Array;
const sitesStore = new Map<string, Uint8Array>();
let writes: string[] = [];
let coverFetches = 0;
const deps: CoverRenditionDeps = {
  fetchCover: async (path) => { coverFetches += 1; return path === COVER_PATH ? { bytes: coverBytes, contentType: "image/jpeg" } : null; },
  readStored: async (key) => sitesStore.get(key) ?? null,
  writeStored: async (key, bytes) => { writes.push(key); sitesStore.set(key, bytes); },
};

beforeEach(async () => {
  stored.clear();
  sitesStore.clear();
  writes = [];
  coverFetches = 0;
  projectionCalls.length = 0;
  coverBytes ??= new Uint8Array(await sharp({ create: { width: 2000, height: 1500, channels: 3, background: { r: 30, g: 120, b: 200 } } })
    .composite([{ input: { create: { width: 600, height: 400, channels: 3, background: { r: 240, g: 200, b: 40 } } }, left: 700, top: 550 }])
    .jpeg({ quality: 90 }).toBuffer());
  feed = {
    generated_at: "2026-10-26T00:00:00.000Z", brand: { slug: "brand", currency: "USD", payment_rails: "stripe" },
    offerings: [
      { ...endedTrip, cover: { path: COVER_PATH, type: "image" } },
      { ...endedTrip, id: "11111111-1111-4111-8111-000000000002", slug: "coast-week-again", cover: { path: COVER_PATH, type: "image" } },
    ],
  };
});

const grid = [{ blockType: "offering_grid", heading: "Trips", mode: "past", kind: "trip" }];

describe("#2829 W7c offering cover renditions", () => {
  it("makes the 400 and 768 crops and the 1600 picture once per cover, stores them content-addressed and records them", async () => {
    const built = await build(grid, [], deps);
    const media = built.artifact.offering_media;
    expect(media).toHaveLength(1);
    const entry = media![0]!;
    expect(entry).toMatchObject({ path: COVER_PATH, source_width: 2000, source_height: 1500 });
    const sourceDigest = createHash("sha256").update(coverBytes).digest("hex");
    expect(entry.variants.map((row) => [row.name, row.width, row.height])).toEqual([["c400", 400, 300], ["c768", 768, 576], ["w1600", 1600, 1200]]);
    for (const variant of entry.variants) {
      expect(variant.object_key).toBe(offeringMediaKey(SITE, sourceDigest, variant.name));
      const bytes = sitesStore.get(variant.object_key)!;
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(variant.integrity);
      expect((await sharp(bytes).metadata()).format).toBe("webp");
    }
    expect(writes).toHaveLength(3);
    expect(coverFetches).toBe(1);
    expect(() => assertArtifactV2(JSON.parse(built.serialized))).not.toThrow();
  });

  it("reuses a cover's stored renditions on the next publish (nothing made again)", async () => {
    const first = await build(grid, [], deps);
    writes = [];
    const second = await build(grid, [], deps);
    expect(writes).toEqual([]);
    expect(second.artifact.offering_media).toEqual(first.artifact.offering_media);
  });

  it("publishes without renditions when a cover cannot be read", async () => {
    feed = { ...(feed as Record<string, unknown>), offerings: [{ ...endedTrip, cover: { path: "event_covers/brand/missing.jpg", type: "image" } }] };
    const built = await build(grid, [], deps);
    expect(built.artifact).not.toHaveProperty("offering_media");
    expect(writes).toEqual([]);
    expect(() => assertArtifactV2(JSON.parse(built.serialized))).not.toThrow();
  });

  it("the contract refuses a rendition keyed to another site, a wrong name, or a mixed source", async () => {
    const built = await build(grid, [], deps);
    const good = JSON.parse(built.serialized);
    const OTHER = "00000000-0000-4000-8000-000000000099";
    const cases: Array<(a: { offering_media: Array<{ path: string; variants: Array<Record<string, unknown>> }> }) => void> = [
      (a) => { a.offering_media[0]!.variants[0]!.object_key = String(a.offering_media[0]!.variants[0]!.object_key).replace(SITE, OTHER); },
      (a) => { a.offering_media[0]!.variants[0]!.name = "c768"; },
      (a) => { a.offering_media[0]!.variants[1]!.object_key = offeringMediaKey(SITE, "f".repeat(64), "c768"); },
      (a) => { a.offering_media[0]!.path = "https://example.invalid/x.jpg"; },
      (a) => { a.offering_media.push({ ...a.offering_media[0]! }); },
    ];
    for (const mutate of cases) {
      const copy = structuredClone(good);
      mutate(copy);
      expect(() => assertArtifactV2(copy)).toThrow("ARTIFACT_MEDIA_MISMATCH");
    }
  });

  it("skips a rendition larger than the cover (the card offers the stored cover instead), and records nothing for a tiny cover", async () => {
    const small = new Uint8Array(await sharp({ create: { width: 736, height: 1104, channels: 3, background: { r: 10, g: 160, b: 150 } } }).jpeg().toBuffer());
    const tiny = new Uint8Array(await sharp({ create: { width: 300, height: 200, channels: 3, background: { r: 200, g: 10, b: 10 } } }).jpeg().toBuffer());
    const files: Record<string, Uint8Array> = { "event_covers/brand/small.jpg": small, "event_covers/brand/tiny.jpg": tiny };
    const local: CoverRenditionDeps = { ...deps, fetchCover: async (path) => (files[path] ? { bytes: files[path]!, contentType: "image/jpeg" } : null) };
    feed = { ...(feed as Record<string, unknown>), offerings: [
      { ...endedTrip, cover: { path: "event_covers/brand/small.jpg", type: "image" } },
      { ...endedTrip, id: "11111111-1111-4111-8111-000000000003", slug: "tiny", cover: { path: "event_covers/brand/tiny.jpg", type: "image" } },
    ] };
    const built = await build(grid, [], local);
    expect(built.artifact.offering_media).toHaveLength(1);
    const entry = built.artifact.offering_media![0]!;
    expect(entry).toMatchObject({ path: "event_covers/brand/small.jpg", source_width: 736, source_height: 1104 });
    expect(entry.variants.map((row) => [row.name, row.width, row.height])).toEqual([["c400", 400, 300]]);
    expect(() => assertArtifactV2(JSON.parse(built.serialized))).not.toThrow();
  });
});
