/*
 * #2829 W7b — what the builder publishes for the travel pilot's parity:
 *  - a picture's extra renditions (4:3 crops, 1600 wide) ride on the site's
 *    media list as `variants`, each with its own key and digest; media
 *    approved before W7b publishes exactly as before (no `variants`);
 *  - "Trips we've run" carries the owner's picked rows (`offering_ids`);
 *  - the contact form carries its name and email hints.
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

import { assertArtifactV2 } from "../contracts/generated/artifactV2.ts";
import { buildPublicationArtifact, publicationDraftDigest } from "./artifactBuilder";
import type { FontPipelineDeps } from "./fontAssets";

const SITE = "00000000-0000-4000-8000-000000000001";
const BRAND = "00000000-0000-4000-8000-000000000002";
const PUBLICATION = "00000000-0000-4000-8000-000000000904";
const ENDED_ID = "11111111-1111-4111-8111-000000000001";

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

async function build(blocks: unknown[], media: unknown[] = []) {
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
    tenant: tenant as never, operationId: "op-w7b", publicationId: PUBLICATION,
    sourceRevisionId: "rev-w4", sourceDigest, generatedAt: "2026-10-26T00:00:00Z", fontPipeline: offlineFonts,
  });
}

const MEDIA_ID = "22222222-2222-4222-8222-000000000001";
const OLD_MEDIA_ID = "22222222-2222-4222-8222-000000000002";
const D = (c: string) => c.repeat(64);
function picture(id: string, variants?: unknown[]) {
  const base = `approved/${SITE}/${id}/${D("a")}`;
  return {
    id, tenant: "t1", state: "READY", kind: "image", width: 2000, height: 1500,
    rendition_manifest: {
      version: 1,
      master: { key: `${base}/master.webp`, digest: D("0"), bytes: 10 },
      renditions: [320, 640, 960, 1440, 1920].map((w) => ({ target_width: w, width: w, key: `${base}/${w}.webp`, digest: D("1"), bytes: 10 })),
      ...(variants ? { variants } : {}),
    },
  };
}
const VARIANTS = [
  { name: "c400", width: 400, height: 300, key: `approved/${SITE}/${MEDIA_ID}/${D("a")}/c400.webp`, digest: D("2"), bytes: 10 },
  { name: "c768", width: 768, height: 576, key: `approved/${SITE}/${MEDIA_ID}/${D("a")}/c768.webp`, digest: D("3"), bytes: 10 },
  { name: "w1600", width: 1600, height: 1200, key: `approved/${SITE}/${MEDIA_ID}/${D("a")}/w1600.webp`, digest: D("4"), bytes: 10 },
];

beforeEach(() => {
  stored.clear();
  projectionCalls.length = 0;
  feed = { generated_at: "2026-10-26T00:00:00.000Z", brand: { slug: "brand", currency: "USD", payment_rails: "stripe" }, offerings: [endedTrip] };
});

describe("#2829 W7b builder", () => {
  it("publishes a picture's renditions as variants, and leaves older media unchanged", async () => {
    const built = await build(
      [{ blockType: "hero", heading: "Hello", media: MEDIA_ID, ctas: [] }],
      [picture(MEDIA_ID, VARIANTS), picture(OLD_MEDIA_ID)],
    );
    const fresh = built.artifact.media.find((item) => item.id === MEDIA_ID);
    expect(fresh?.variants).toEqual(VARIANTS.map((row) => ({ name: row.name, url: `/media/${MEDIA_ID}/${row.name}.webp`, width: row.width, height: row.height, integrity: row.digest, object_key: row.key })));
    expect(built.artifact.media.find((item) => item.id === OLD_MEDIA_ID)).not.toHaveProperty("variants");
    expect(() => assertArtifactV2(JSON.parse(built.serialized))).not.toThrow();
  });

  it("keeps the owner's picked history rows and the form's hints", async () => {
    const built = await build([
      { blockType: "offering_history", heading: "Trips so far", kind: "trip", offering_ids: [{ offering_id: ENDED_ID }] },
      { blockType: "contact_form", submit_label: "Send", name_placeholder: "Your name here", email_placeholder: "you@example.invalid" },
    ]);
    const [history, form] = built.artifact.pages[0]!.blocks;
    expect(history).toMatchObject({ type: "offering_history", offering_ids: [{ id: ENDED_ID }] });
    expect(form).toMatchObject({ type: "contact_form", name_placeholder: "Your name here", email_placeholder: "you@example.invalid" });
    expect(() => assertArtifactV2(JSON.parse(built.serialized))).not.toThrow();
  });
});
