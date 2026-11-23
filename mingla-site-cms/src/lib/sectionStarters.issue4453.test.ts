/**
 * #4453 website workspace — a section the owner adds must never break Publish.
 *
 * `add_section` writes a starter section (starter words in every field the
 * section must have). This runs the REAL publish builder over a page holding
 * one starter of every type an owner may add, in every design, and hands the
 * result to the public contract the runtime reads: a starter the builder or
 * the runtime refused would take the whole site's publish down.
 */
import { describe, expect, it, vi } from "vitest";

const stored = new Map<string, Uint8Array>();
vi.mock("./config", () => ({ cmsConfig: () => ({ artifactBucket: "artifact-bucket" }) }));
vi.mock("./observability", () => ({ emitCmsObservation: async () => {}, observeCmsEndpoint: (_r: string, _d: string, handler: unknown) => handler }));
vi.mock("./gateway", () => ({
  readCoreProjection: async () => ({ offerings: [], feed: { generated_at: "2026-11-19T00:00:00.000Z", brand: { slug: "brand", currency: "NGN", payment_rails: "paystack" }, offerings: [] }, menu: [], menu_venue_id: null, venue_slug: null, brand_slug: null }),
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
import { BLOCK_TYPES } from "../contracts/generated/blocks.ts";
import { DESIGN_KEYS, DESIGNS, type DesignKey } from "../contracts/generated/designs.ts";
import { buildPublicationArtifact, publicationDraftDigest } from "./artifactBuilder";
import type { FontPipelineDeps } from "./fontAssets";
import { ADDABLE_SECTION_TYPES, SECTION_TYPES_NEEDING_PHOTO, sectionCatalog, starterSection } from "./sectionActions";

const TENANT = "00000000-0000-4000-8000-000000000901";
const SITE = "00000000-0000-4000-8000-000000000902";
const BRAND = "00000000-0000-4000-8000-000000000903";
const MEDIA = "00000000-0000-4000-8000-000000000c01";

const offlineFonts: FontPipelineDeps = {
  fetch: (async () => { throw new Error("NO_NETWORK_IN_TESTS"); }) as typeof fetch,
  storeFont: async () => {},
  cachedFaces: async (key) => key.split("|")[1]!.split(",").map((weight, index) => ({
    family: key.split("|")[0]!, weight: Number(weight), style: "normal" as const, unicode_range: "U+0000-00FF",
    digest: String(index).padEnd(64, "b"), bytes: 1000,
  })),
  saveFaces: async () => {},
};

async function publish(design: DesignKey, blocks: Record<string, unknown>[]) {
  const tenant = { id: TENANT, core_site_id: SITE, core_brand_id: BRAND, primary_hostname: "brand.sites.localhost" };
  const settings = { id: "settings-1", tenant: TENANT, display_name: "Brand", design };
  const media = [{
    id: MEDIA, tenant: TENANT, state: "READY", width: 1440, height: 1440,
    rendition_manifest: { renditions: [{ width: 1440, target_width: 1440, digest: "c".repeat(64), key: `approved/${SITE}/${MEDIA}/1440.webp` }] },
  }];
  const page = { id: "page-home", tenant: TENANT, slug: "", title: "Home", enabled: true, blocks };
  const collections: Record<string, unknown[]> = {
    pages: [page], navigation: [{ id: "nav-1", tenant: TENANT, items: [] }], footer: [{ id: "footer-1", tenant: TENANT }],
    "site-settings": [settings], media,
  };
  const sourceDigest = await publicationDraftDigest({ pages: [page], navigation: collections.navigation![0] ?? null, footer: collections.footer![0] ?? null, settings, media });
  const req = { context: {}, payload: { find: async ({ collection }: { collection: string }) => ({ docs: collections[collection] ?? [] }) } } as never;
  return buildPublicationArtifact(req, {
    tenant: tenant as never, operationId: "op-starters", publicationId: "00000000-0000-4000-8000-000000000904",
    sourceRevisionId: "rev-1", sourceDigest, generatedAt: "2026-11-19T00:00:00Z", fontPipeline: offlineFonts,
  });
}

/** These fill themselves from the site's own lists or menu, so with none yet the builder leaves them out (never an error). */
const FILLS_ITSELF = new Set(["testimonials", "destination_grid", "story_grid", "page_links"]);

describe("#4453 a starter section always publishes", () => {
  it("the catalogue only offers types that exist, and never a page title or a live booking section (the Big picture is the one top section an owner adds, #4575)", () => {
    for (const type of ADDABLE_SECTION_TYPES) expect(BLOCK_TYPES).toContain(type);
    for (const type of ["page_header", "availability", "ticket_tiers", "process_steps", "menu_board", "venue_reservation"]) {
      expect(ADDABLE_SECTION_TYPES).not.toContain(type);
    }
    // A design that does not draw a type does not offer it.
    for (const design of DESIGN_KEYS) {
      for (const entry of sectionCatalog(design, "user")) expect(DESIGNS[design].variants[entry.type as keyof typeof DESIGNS.atelier.variants].length).toBeGreaterThan(0);
    }
  });

  for (const design of DESIGN_KEYS) {
    it(`${design}: every starter the owner can add builds and passes the public contract`, async () => {
      const hero = { id: "hero", blockType: "hero", variant: DESIGNS[design].variants.hero[0], heading: "Welcome", subheading: "A line.", media: MEDIA, ctas: [{ label: "Look around", href: "/" }] };
      const offered = sectionCatalog(design, "user").map((entry) => entry.type);
      expect(offered.length).toBeGreaterThan(10);
      const starters = offered.map((type) => {
        const { block } = starterSection(type as never, design, SECTION_TYPES_NEEDING_PHOTO.has(type) ? MEDIA : null);
        expect(DESIGNS[design].variants[type as keyof typeof DESIGNS.atelier.variants], `${design}.${type} starts in a layout this design draws`).toContain(block.variant);
        return block;
      });
      const built = await publish(design, [hero, ...starters]);
      const artifact = built.artifact as unknown as { pages: Array<{ blocks: Array<{ type: string }> }> };
      expect(() => assertArtifactV2(JSON.parse(built.serialized))).not.toThrow();
      const published = artifact.pages[0]!.blocks.map((block) => block.type);
      for (const type of offered) {
        if (FILLS_ITSELF.has(type)) continue;
        expect(published, `${design}: the ${type} starter is on the published page`).toContain(type);
      }
    });
  }
});
