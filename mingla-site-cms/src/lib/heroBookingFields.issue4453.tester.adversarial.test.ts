/*
 * #4453 milestone 5, tester (retest of P2-1): from a stored hero to the
 * published artifact, EXECUTED through buildPublicationArtifact (same offline
 * harness as blockWave4.issue3149). A hero layout that cannot draw the booking
 * bar or the Mingla rating never publishes them.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const stored = new Map<string, Uint8Array>();

const MENU_ROWS = [
  {
    menu_id: "m1",
    menu_name: "Rice Bowls",
    menu_description: "Beef, Chicken, Goat or Gizzard",
    item_id: "00000000-0000-4000-8000-000000000a01",
    item_name: "Jollof Rice",
    item_description: null,
    price_cents: 1_000_000,
    currency: "NGN",
  },
  {
    menu_id: "m1",
    menu_name: "Rice Bowls",
    menu_description: "Beef, Chicken, Goat or Gizzard",
    item_id: "00000000-0000-4000-8000-000000000a02",
    item_name: "Coconut Rice",
    item_description: null,
    price_cents: 1_200_000,
    currency: "NGN",
  },
  {
    menu_id: "m2",
    menu_name: "Sides",
    menu_description: null,
    item_id: "00000000-0000-4000-8000-000000000a03",
    item_name: "Wings",
    item_description: "Spicy, Honey Barbecue, or Suya",
    price_cents: 800_000,
    currency: "NGN",
  },
];

vi.mock("./config", () => ({
  cmsConfig: () => ({ artifactBucket: "artifact-bucket" }),
}));
vi.mock("./observability", () => ({ emitCmsObservation: async () => {} }));
/*
 * #3149 wave 5 — the projection also carries the venue's public slugs now, and
 * only when the builder asks for them, exactly as the menu does. The stub
 * honours `includeVenue` rather than answering unconditionally, so a builder
 * that stopped asking would fail these tests instead of quietly passing them.
 */
vi.mock("./gateway", () => ({
  readCoreProjection: async (
    _path: string,
    _siteId: string,
    _operationId: string,
    _offeringIds: string[],
    includeMenu: boolean,
    includeVenue: boolean,
  ) => ({
    offerings: [],
    menu: includeMenu ? MENU_ROWS : [],
    menu_venue_id: includeMenu || includeVenue
      ? "00000000-0000-4000-8000-000000000b01"
      : null,
    venue_slug: includeVenue ? "gogi" : null,
    brand_slug: includeVenue ? "gogilagos" : null,
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
import { HERO_LAYOUTS_WITH_BOOKING } from "../contracts/generated/designs.ts";

const TENANT_ID = "00000000-0000-4000-8000-000000000901";
const SITE_ID = "00000000-0000-4000-8000-000000000902";
const BRAND_ID = "00000000-0000-4000-8000-000000000903";
const PUBLICATION_ID = "00000000-0000-4000-8000-000000000904";
const MEDIA_ID = "00000000-0000-4000-8000-000000000c01";

// #2829 — the canonical is the tenant's primary address (named by Core).
const tenant = {
  id: TENANT_ID,
  core_site_id: SITE_ID,
  core_brand_id: BRAND_ID,
  primary_hostname: "gogi.sites.usemingla.com",
};

const mediaRecord = {
  id: MEDIA_ID,
  tenant: TENANT_ID,
  state: "READY",
  width: 1440,
  height: 1440,
  rendition_manifest: {
    renditions: [{
      width: 1440,
      target_width: 1440,
      digest: "c".repeat(64),
      key: `approved/${SITE_ID}/${MEDIA_ID}/1440.webp`,
    }],
  },
};

const settings: Record<string, unknown> = {
  id: "settings-1",
  tenant: TENANT_ID,
  display_name: "gögi",
  short_description: "A 24/7 food house.",
  background_color: "#1c1c1e",
  foreground_color: "#f0eee9",
  accent_color: "#cda052",
  typography: "condensed-display",
  canonical_url: "https://gogi.sites.usemingla.com",
  seo_title: "gögi",
  seo_description: "Where Lagos comes to eat.",
};

async function build(blocks: Record<string, unknown>[], designKey: string) {
  settings.design = designKey;
  const page = {
    id: "page-home",
    tenant: TENANT_ID,
    role: "home",
    slug: "" /* #2829 W2: home has no slug */,
    title: "Home",
    enabled: true,
    nav_label: "Home",
    nav_order: 0,
    blocks,
    seo: { title: "gögi", description: "Where Lagos comes to eat." },
  };
  const collections: Record<string, unknown[]> = {
    pages: [page],
    navigation: [{ id: "nav-1", tenant: TENANT_ID, pages: ["page-home"] }],
    footer: [{ id: "footer-1", tenant: TENANT_ID, address: "69 Admiralty Way" }],
    "site-settings": [settings],
    media: [mediaRecord],
  };
  const sourceDigest = await publicationDraftDigest({
    pages: collections.pages!,
    navigation: collections.navigation![0] ?? null,
    footer: collections.footer![0] ?? null,
    settings,
    media: collections.media!,
  });
  const req = {
    context: {},
    payload: {
      find: async ({ collection }: { collection: string }) => ({
        docs: collections[collection] ?? [],
      }),
    },
  } as never;
  return await buildPublicationArtifact(req, {
    tenant,
    operationId: "op-4453-hero-booking",
    publicationId: PUBLICATION_ID,
    sourceRevisionId: "rev-4453-hero-booking",
    sourceDigest,
    generatedAt: "2026-09-10T00:00:00Z",
  });
}

const homeHero = (artifact: unknown): Record<string, unknown> =>
  ((artifact as { pages: { blocks: Record<string, unknown>[] }[] }).pages)[0]!.blocks.find((block) => block.type === "hero")!;

const VENUE = "00000000-0000-4000-8000-000000000d01";
const HERO = {
  blockType: "hero",
  heading: "Where Lagos Comes to Eat",
  media: MEDIA_ID,
  ctas: [],
  booking_bar: "venue_table",
  booking_target_id: VENUE,
  show_rating: true,
};

beforeEach(() => stored.clear());

/*
 * #4453 milestone 5, tester (retest of P2-1). A hero layout that cannot draw
 * the booking bar or the Mingla rating never publishes them, so an owner's
 * setting never silently does nothing; a layout that draws them keeps them.
 */
describe("#4453 M5 retest: hero booking fields publish only on layouts that draw them", () => {
  it.each(["pop", "sunset", "pulse", "journal", "grid", "terra", "maison"])("%s: the booking bar, its target and the rating are left out", async (design) => {
    const hero = homeHero((await build([{ ...HERO }], design)).artifact);
    expect(HERO_LAYOUTS_WITH_BOOKING).not.toContain(hero.variant);
    expect(hero).not.toHaveProperty("booking_bar");
    expect(hero).not.toHaveProperty("booking_target_id");
    expect(hero).not.toHaveProperty("show_rating");
  });

  it.each(["nocturne", "haven", "voyage"])("%s: a layout that draws them keeps them", async (design) => {
    const hero = homeHero((await build([{ ...HERO }], design)).artifact);
    expect(HERO_LAYOUTS_WITH_BOOKING).toContain(hero.variant);
    expect(hero.booking_bar).toBe("venue_table");
    expect(hero.booking_target_id).toBe(VENUE);
    expect(hero.show_rating).toBe(true);
  });
});
