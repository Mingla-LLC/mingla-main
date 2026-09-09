/*
 * #3149 wave 3 — from a Studio field to the published bytes, EXECUTED.
 *
 * This runs the real `buildPublicationArtifact` over a stubbed Payload and
 * then hands what it produced to the REAL public contract from
 * `mingla-sites`, which is the code that will read those bytes on the way to a
 * visitor. Reading the builder as text cannot catch the failure this issue has
 * produced three times: a field the CMS accepts, that the builder carries, and
 * that the page never prints — or, worse here, a block the builder emits in a
 * shape the runtime refuses, which takes the whole SITE down rather than one
 * section, because a publish is all-or-nothing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import type { Field } from "payload";
import { restaurantBlocks } from "../blocks/restaurantBlocks";

const stored = new Map<string, Uint8Array>();

vi.mock("./config", () => ({
  cmsConfig: () => ({ artifactBucket: "artifact-bucket" }),
}));
vi.mock("./observability", () => ({ emitCmsObservation: async () => {} }));
vi.mock("./gateway", () => ({
  readCoreProjection: async () => ({
    offerings: [],
    menu: [],
    menu_venue_id: null,
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

/*
 * The public runtime's own validator, loaded from the package that serves the
 * site. Imported by path rather than restated here: a copy of the rules would
 * agree with itself forever while the real one moved.
 */
const publicContract = async () =>
  (await import(
    /* @vite-ignore */ path.resolve(
      process.cwd(),
      "../mingla-sites/src/contracts/artifact.ts",
    )
  )) as { assertRestaurantArtifact: (value: unknown) => void };

const TENANT_ID = "00000000-0000-4000-8000-000000000901";
const SITE_ID = "00000000-0000-4000-8000-000000000902";
const BRAND_ID = "00000000-0000-4000-8000-000000000903";
const PUBLICATION_ID = "00000000-0000-4000-8000-000000000904";

const tenant = { id: TENANT_ID, core_site_id: SITE_ID, core_brand_id: BRAND_ID };

const settings = {
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

async function build(blocks: Record<string, unknown>[]) {
  const page = {
    id: "page-home",
    tenant: TENANT_ID,
    role: "home",
    // The public contract requires one; the builder copies it through, so a
    // stub without it validates as a broken page rather than a broken block.
    slug: "home",
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
    media: [],
  };
  const sourceDigest = await publicationDraftDigest({
    pages: collections.pages!,
    navigation: collections.navigation![0] ?? null,
    footer: collections.footer![0] ?? null,
    settings,
    media: [],
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
    operationId: "op-3149-wave3",
    publicationId: PUBLICATION_ID,
    sourceRevisionId: "rev-3149-wave3",
    sourceDigest,
    generatedAt: "2026-09-09T00:00:00Z",
  });
}

const homeBlocks = (artifact: unknown): Record<string, unknown>[] =>
  ((artifact as { pages: { blocks: Record<string, unknown>[] }[] }).pages)[0]!
    .blocks;

const MARQUEE = {
  blockType: "marquee",
  phrases: [
    { text: "24/7 food house" },
    { text: "Come as you are" },
    { text: "Find gögi" },
  ],
};
const STATS = {
  blockType: "stats",
  eyebrow: "Why people keep coming back",
  heading: "No closing time",
  body: "",
  items: [
    { figure: "Open 24 hours", label: "Seven days a week, all year." },
    { figure: "Pregame Fridays", label: "   " },
  ],
};
const PULL_QUOTE = {
  blockType: "pull_quote",
  quote: "It's very important you find gögi.",
  attribution: "gögi, on Instagram",
};
const MAP = {
  blockType: "map_embed",
  eyebrow: null,
  heading: "Admiralty Way",
  body: "It is a small frontage.",
  latitude: 6.4471033,
  longitude: 3.4680182,
  place_label: "Admiralty Way, Lekki Phase 1, Lagos",
  directions_url:
    "https://www.google.com/maps/dir/?api=1&destination=6.4471033,3.4680182",
};

beforeEach(() => stored.clear());

describe("#3149 the four new choices exist in Studio", () => {
  const bySlug = new Map(restaurantBlocks.map((block) => [block.slug, block]));
  const field = (slug: string, name: string) =>
    bySlug.get(slug)?.fields.find((entry) =>
      (entry as { name?: string }).name === name
    ) as (Field & { required?: boolean; min?: number; max?: number }) | undefined;

  for (const slug of ["marquee", "stats", "pull_quote", "map_embed"]) {
    it(`offers ${slug}`, () => {
      expect(bySlug.get(slug), `${slug} is missing from Studio`).toBeDefined();
    });
  }

  it("requires both coordinates, and bounds them to the globe", () => {
    expect(field("map_embed", "latitude")?.required).toBe(true);
    expect(field("map_embed", "longitude")?.required).toBe(true);
    expect(field("map_embed", "latitude")?.min).toBe(-90);
    expect(field("map_embed", "latitude")?.max).toBe(90);
    expect(field("map_embed", "longitude")?.min).toBe(-180);
    expect(field("map_embed", "longitude")?.max).toBe(180);
  });

  it("OFFERS NO PLACE NAME on the map — a name resolves silently and wrongly", () => {
    for (const name of ["query", "address", "search", "embed_url"]) {
      expect(field("map_embed", name)).toBeUndefined();
    }
  });

  it("requires a quote, and leaves the attribution optional", () => {
    expect(field("pull_quote", "quote")?.required).toBe(true);
    expect(field("pull_quote", "attribution")?.required).toBe(false);
  });

  it("explains each new field in a restaurant's language", () => {
    for (
      const [slug, name] of [
        ["marquee", "phrases"],
        ["stats", "items"],
        ["pull_quote", "quote"],
        ["map_embed", "latitude"],
        ["map_embed", "place_label"],
      ] as const
    ) {
      const described = field(slug, name) as
        | { admin?: { description?: string } }
        | undefined;
      const description = described?.admin?.description ?? "";
      expect(description.length, `${slug}.${name}`).toBeGreaterThan(0);
      expect(description, `${slug}.${name}`).not.toMatch(/block|artifact|slug/i);
    }
  });
});

describe("#3149 the builder carries them into the published bytes", () => {
  it("publishes all four, in the order the page put them", async () => {
    const { artifact } = await build([MARQUEE, STATS, PULL_QUOTE, MAP]);
    expect(homeBlocks(artifact).map((block) => block.type)).toEqual([
      "marquee",
      "stats",
      "pull_quote",
      "map_embed",
    ]);
  });

  it("carries every phrase, in order", async () => {
    const { artifact } = await build([MARQUEE]);
    expect(homeBlocks(artifact)[0]!.phrases).toEqual([
      { text: "24/7 food house" },
      { text: "Come as you are" },
      { text: "Find gögi" },
    ]);
  });

  it("carries the eyebrow, the heading and every figure", async () => {
    const { artifact } = await build([STATS]);
    const block = homeBlocks(artifact)[0]!;
    expect(block.eyebrow).toBe("Why people keep coming back");
    expect(block.heading).toBe("No closing time");
    expect(block.items).toEqual([
      { figure: "Open 24 hours", label: "Seven days a week, all year." },
      { figure: "Pregame Fridays" },
    ]);
  });

  it("OMITS an emptied key rather than publishing it as an empty string", async () => {
    /*
     * `body: ""` and a label of three spaces were typed and then cleared. Both
     * must be ABSENT: the contract forbids unknown keys, the digest is taken
     * over the serialised artifact, and an empty value would change the bytes
     * of every artifact ever published — making a republish look like a
     * content change to everything downstream that watches the digest.
     */
    const { artifact, serialized } = await build([STATS]);
    const block = homeBlocks(artifact)[0]!;
    expect("body" in block).toBe(false);
    expect(Object.keys(block).sort()).toEqual([
      "eyebrow",
      "heading",
      "items",
      "type",
    ]);
    expect(serialized).not.toContain('"body":""');
    expect(serialized).not.toContain('"label":""');
  });

  it("carries the quotation and its source, and omits an absent source", async () => {
    const { artifact } = await build([
      PULL_QUOTE,
      { blockType: "pull_quote", quote: "Find gögi." },
    ]);
    const [attributed, bare] = homeBlocks(artifact);
    expect(attributed!.quote).toBe("It's very important you find gögi.");
    expect(attributed!.attribution).toBe("gögi, on Instagram");
    expect("attribution" in bare!).toBe(false);
  });

  it("carries both coordinates as NUMBERS, and the label with them", async () => {
    const { artifact } = await build([MAP]);
    const block = homeBlocks(artifact)[0]!;
    expect(block.latitude).toBe(6.4471033);
    expect(block.longitude).toBe(3.4680182);
    expect(typeof block.latitude).toBe("number");
    expect(block.place_label).toBe("Admiralty Way, Lekki Phase 1, Lagos");
    // No eyebrow was typed, so none is published.
    expect("eyebrow" in block).toBe(false);
  });

  it("NEVER RESCUES A MISSING COORDINATE INTO A ZERO", async () => {
    /*
     * `Number(null)` is 0, and 0,0 is a real point in the Gulf of Guinea. A
     * coerced coordinate would publish a map of open water that looks
     * plausible enough to survive a glance; an absent one is refused by the
     * contract below, which is the outcome worth having.
     */
    const { artifact } = await build([{ ...MAP, latitude: null }]);
    const block = homeBlocks(artifact)[0]!;
    expect(block.latitude).not.toBe(0);
    expect(block.latitude == null).toBe(true);
  });
});

describe("#3149 the public runtime accepts what the builder produced", () => {
  it("validates a page carrying all four", async () => {
    const { assertRestaurantArtifact } = await publicContract();
    const { artifact } = await build([MARQUEE, STATS, PULL_QUOTE, MAP]);
    expect(() => assertRestaurantArtifact(artifact)).not.toThrow();
  });

  it("validates the SERIALISED bytes, which is what the site reads", async () => {
    const { assertRestaurantArtifact } = await publicContract();
    const { serialized } = await build([MARQUEE, STATS, PULL_QUOTE, MAP]);
    expect(() => assertRestaurantArtifact(JSON.parse(serialized))).not.toThrow();
  });

  it("REFUSES a map the builder could not give coordinates to", async () => {
    const { assertRestaurantArtifact } = await publicContract();
    const { artifact } = await build([{ ...MAP, latitude: null }]);
    expect(() => assertRestaurantArtifact(artifact)).toThrow(
      "ARTIFACT_BLOCK_CONTENT_MISMATCH",
    );
  });

  it("refuses a marquee with a single phrase", async () => {
    const { assertRestaurantArtifact } = await publicContract();
    const { artifact } = await build([
      { blockType: "marquee", phrases: [{ text: "gögi" }] },
    ]);
    expect(() => assertRestaurantArtifact(artifact)).toThrow();
  });
});
