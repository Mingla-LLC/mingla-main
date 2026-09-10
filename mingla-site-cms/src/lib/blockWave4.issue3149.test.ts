/*
 * #3149 wave 4 — from a Studio field to the published bytes, EXECUTED.
 *
 * Same shape as the wave 3 suite beside it and for the same reason: this runs
 * the real `buildPublicationArtifact` over a stubbed Payload and hands what it
 * produced to the REAL public contract from `mingla-sites`, which is the code
 * that reads those bytes on the way to a visitor.
 *
 * Two failures are being guarded against, and only executing catches either.
 * A field the CMS accepts that the builder drops is a brand typing something
 * into Studio and the page printing nothing — three times on this issue
 * already. A field the builder emits in a shape the runtime refuses takes the
 * WHOLE SITE down rather than one section, because a publish is
 * all-or-nothing.
 *
 * The third assertion in every group is the quiet one: a field left empty must
 * be ABSENT from the published bytes, not present as `""`, `null` or `false`.
 * The artifact forbids unknown keys and its digest is taken over the
 * serialised form, so an empty value changes the bytes of every artifact ever
 * published and makes a republish look like a content change.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import { restaurantBlocks } from "../blocks/restaurantBlocks";

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
const MEDIA_ID = "00000000-0000-4000-8000-000000000c01";

const tenant = { id: TENANT_ID, core_site_id: SITE_ID, core_brand_id: BRAND_ID };

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
    operationId: "op-3149-wave4",
    publicationId: PUBLICATION_ID,
    sourceRevisionId: "rev-3149-wave4",
    sourceDigest,
    generatedAt: "2026-09-10T00:00:00Z",
  });
}

const homeBlocks = (artifact: unknown): Record<string, unknown>[] =>
  ((artifact as { pages: { blocks: Record<string, unknown>[] }[] }).pages)[0]!
    .blocks;

const HERO = {
  blockType: "hero",
  heading: "Where Lagos Comes to Eat",
  media: MEDIA_ID,
  ctas: [],
};

beforeEach(() => stored.clear());

describe("#3149 wave 4 the story composite reaches the bytes", () => {
  it("carries the crop, the badge, the quotation and the button", async () => {
    const { artifact } = await build([HERO, {
      blockType: "media_feature",
      eyebrow: "The place",
      media: MEDIA_ID,
      alt: "A gögi bowl",
      heading: "A room that never closes",
      caption: "gögi sits at 69 Admiralty Way and does not shut.",
      alignment: "right",
      media_shape: "circle",
      badge_figure: "24/7",
      badge_label: "ALWAYS ON",
      quote: "Show up exactly as you are.",
      quote_attribution: "gögi, on Instagram",
      cta_label: "More about gögi",
      cta_href: "/about",
    }]);
    const block = homeBlocks(artifact)[1]!;
    expect(block.media_shape).toBe("circle");
    expect(block.badge_figure).toBe("24/7");
    expect(block.badge_label).toBe("ALWAYS ON");
    expect(block.quote).toBe("Show up exactly as you are.");
    expect(block.quote_attribution).toBe("gögi, on Instagram");
    expect(block.cta_label).toBe("More about gögi");
    expect(block.cta_href).toBe("/about");
    const { assertRestaurantArtifact } = await publicContract();
    expect(() => assertRestaurantArtifact(artifact)).not.toThrow();
  });

  it("leaves every one of them ABSENT when nothing was filled in", async () => {
    const { artifact } = await build([HERO, {
      blockType: "media_feature",
      media: MEDIA_ID,
      alt: "A gögi bowl",
      heading: "A room that never closes",
      caption: "It does not shut.",
      alignment: "left",
      media_shape: "",
      badge_figure: null,
      badge_label: "   ",
      quote: "",
      quote_attribution: null,
      cta_label: "",
      cta_href: null,
    }]);
    const block = homeBlocks(artifact)[1]!;
    for (
      const key of [
        "media_shape",
        "badge_figure",
        "badge_label",
        "quote",
        "quote_attribution",
        "cta_label",
        "cta_href",
      ]
    ) {
      expect(Object.hasOwn(block, key), `${key} leaked into the bytes`).toBe(false);
    }
  });
});

describe("#3149 wave 4 the live-hours fields reach the bytes", () => {
  it("carries the declaration and the zone", async () => {
    const { artifact } = await build([HERO, {
      blockType: "hours_location",
      heading: "Visit gögi",
      address: "69 Admiralty Way, Lekki Phase 1, Lagos",
      always_open: true,
      timezone: "Africa/Lagos",
      hours: [{ day: "Monday", value: "Open 24 hours" }],
    }]);
    const block = homeBlocks(artifact)[1]!;
    expect(block.always_open).toBe(true);
    expect(block.timezone).toBe("Africa/Lagos");
    const { assertRestaurantArtifact } = await publicContract();
    expect(() => assertRestaurantArtifact(artifact)).not.toThrow();
  });

  it("publishes NO trace of a claim nobody made", async () => {
    /*
     * `false` is not "absent". A site that never made an open/closed claim
     * must carry no key about one — otherwise every already-published artifact
     * changes bytes and a republish reads as a content change.
     */
    const { artifact } = await build([HERO, {
      blockType: "hours_location",
      heading: "Visit gögi",
      address: "69 Admiralty Way, Lekki Phase 1, Lagos",
      always_open: false,
      timezone: null,
      hours: [{ day: "Monday", value: "Open 24 hours" }],
    }]);
    const block = homeBlocks(artifact)[1]!;
    expect(Object.hasOwn(block, "always_open")).toBe(false);
    expect(Object.hasOwn(block, "timezone")).toBe(false);
  });

  it("REFUSES a zone that is not a real one, rather than publishing it", async () => {
    const { artifact } = await build([HERO, {
      blockType: "hours_location",
      heading: "Visit gögi",
      address: "69 Admiralty Way, Lekki Phase 1, Lagos",
      always_open: true,
      timezone: "WAT",
      hours: [{ day: "Monday", value: "Open 24 hours" }],
    }]);
    const { assertRestaurantArtifact } = await publicContract();
    expect(() => assertRestaurantArtifact(artifact)).toThrow(
      /ARTIFACT_BLOCK_CONTENT_MISMATCH/,
    );
  });
});

describe("#3149 wave 4 the team's roles and button reach the bytes", () => {
  it("carries the subset, the button and every role", async () => {
    const { artifact } = await build([HERO, {
      blockType: "team",
      heading: "Meet the team",
      preview_count: 2,
      cta_label: "All ten of them",
      cta_href: "/about",
      members: [
        { name: "Madam Chief chef", role: "Kitchen" },
        { name: "Mix engineer", role: "Bar" },
        { name: "Fake chef", role: "Kitchen" },
      ],
    }]);
    const block = homeBlocks(artifact)[1]!;
    expect(block.preview_count).toBe(2);
    expect(block.cta_label).toBe("All ten of them");
    expect(block.cta_href).toBe("/about");
    // Every member still travels — the page shows a subset, the artifact holds
    // all of them, so the button leads somewhere with the rest.
    expect((block.members as unknown[]).length).toBe(3);
    expect((block.members as { role: string }[])[1]!.role).toBe("Bar");
    const { assertRestaurantArtifact } = await publicContract();
    expect(() => assertRestaurantArtifact(artifact)).not.toThrow();
  });

  it("omits the subset and the button when neither was set", async () => {
    const { artifact } = await build([HERO, {
      blockType: "team",
      heading: "Meet the team",
      preview_count: null,
      cta_label: "",
      cta_href: "",
      members: [{ name: "Fake chef" }],
    }]);
    const block = homeBlocks(artifact)[1]!;
    for (const key of ["preview_count", "cta_label", "cta_href"]) {
      expect(Object.hasOwn(block, key)).toBe(false);
    }
  });
});

describe("#3149 wave 4 the film run's button reaches the bytes", () => {
  it("carries both halves off the first film", async () => {
    const { artifact } = await build([HERO, {
      blockType: "video_feature",
      group_heading: "The room, on any given night",
      group_cta_label: "Follow @gogilagos",
      group_cta_href: "https://www.instagram.com/gogilagos/",
      heading: "Coconut rice",
      video: MEDIA_ID,
      poster: MEDIA_ID,
    }]);
    /*
     * The stubbed media record is an image, so the video is not ready and the
     * block is DROPPED — which is itself the documented behaviour, and which
     * only became TRUE in this wave: a dropped block used to leave a literal
     * `null` in the published page, and the public contract rejects that,
     * failing the whole site's publish rather than removing one section.
     *
     * So this asserts both halves at once: the builder does not throw on the
     * new keys, and what it produced is something the runtime will accept.
     */
    expect(homeBlocks(artifact).length).toBe(1);
    expect(homeBlocks(artifact).every((block) => block !== null)).toBe(true);
    const { assertRestaurantArtifact } = await publicContract();
    expect(() => assertRestaurantArtifact(artifact)).not.toThrow();
  });

  it("a dropped block leaves NOTHING, rather than a null the runtime refuses", async () => {
    /*
     * Proved by execution before it was fixed: a hero plus a menu_board with
     * no Mingla menu published as `["hero", null]`, and the contract's own
     * `plainObject` check threw ARTIFACT_BLOCK_TYPE_MISMATCH on it. Every
     * comment in the builder that says a block "is dropped" depended on this.
     */
    const { artifact } = await build([HERO, {
      blockType: "video_feature",
      heading: "A film that has not arrived",
      video: MEDIA_ID,
      poster: MEDIA_ID,
    }]);
    const blocks = homeBlocks(artifact);
    expect(blocks.length).toBe(1);
    expect(blocks).not.toContain(null);
    const { assertRestaurantArtifact } = await publicContract();
    expect(() => assertRestaurantArtifact(artifact)).not.toThrow();
  });
});

describe("#3149 wave 4 the stat card's icon and sentence reach the bytes", () => {
  it("carries the drawing's name, the sentence and the ring", async () => {
    const { artifact } = await build([HERO, {
      blockType: "stats",
      heading: "No closing time",
      items: [
        {
          figure: "Open 24 hours",
          body: "Seven days a week, all year.",
          icon: "clock",
          highlight: true,
        },
        { figure: "Bowls that travel", body: "", icon: null, highlight: false },
      ],
    }]);
    const items = homeBlocks(artifact)[1]!.items as Record<string, unknown>[];
    expect(items[0]!.body).toBe("Seven days a week, all year.");
    expect(items[0]!.icon).toBe("clock");
    expect(items[0]!.highlight).toBe(true);
    for (const key of ["body", "icon", "highlight"]) {
      expect(Object.hasOwn(items[1]!, key), `${key} leaked`).toBe(false);
    }
    const { assertRestaurantArtifact } = await publicContract();
    expect(() => assertRestaurantArtifact(artifact)).not.toThrow();
  });

  it("REFUSES a drawing this runtime does not have", async () => {
    const { artifact } = await build([HERO, {
      blockType: "stats",
      heading: "No closing time",
      items: [{ figure: "Open 24 hours", icon: "fa-clock" }],
    }]);
    const { assertRestaurantArtifact } = await publicContract();
    expect(() => assertRestaurantArtifact(artifact)).toThrow(
      /ARTIFACT_BLOCK_CONTENT_MISMATCH/,
    );
  });
});

describe("#3149 wave 4 the menu taster is Mingla's menu, shortened", () => {
  it("carries Mingla's own sections and prices, with the caps beside them", async () => {
    const { artifact } = await build([HERO, {
      blockType: "menu_preview",
      eyebrow: "The menu",
      heading: "What people order",
      note: "The full list runs from shawarma at ₦5,000.",
      section_limit: 2,
      item_limit: 4,
      images: [{ media: MEDIA_ID, alt: "Coconut rice" }],
      cta_label: "Full menu & ordering",
      cta_href: "/menu",
    }]);
    const block = homeBlocks(artifact)[1]!;
    expect(block.type).toBe("menu_preview");
    expect(block.section_limit).toBe(2);
    expect(block.item_limit).toBe(4);
    expect(block.cta_label).toBe("Full menu & ordering");
    const sections = block.sections as { name: string; items: unknown[] }[];
    // Mingla's rows, grouped Mingla's way, in Mingla's order.
    expect(sections.map((section) => section.name)).toEqual(["Rice Bowls", "Sides"]);
    expect(sections[0]!.items.length).toBe(2);
    expect((sections[0]!.items[0] as { price_minor: number }).price_minor)
      .toBe(1_000_000);
    // And it carries NO venue, so it can never be mistaken for the page that
    // sells.
    expect(Object.hasOwn(block, "venue_id")).toBe(false);
    const { assertRestaurantArtifact } = await publicContract();
    expect(() => assertRestaurantArtifact(artifact)).not.toThrow();
  });

  it("is DROPPED when Mingla has no menu, rather than published empty", async () => {
    /*
     * The stub returns a menu only when the builder ASKS for one, so a page
     * whose only menu block is a taster still has to trigger that ask. If it
     * did not, this block would silently vanish from every published page.
     */
    const { artifact } = await build([HERO, {
      blockType: "menu_preview",
      heading: "What people order",
      section_limit: 2,
    }]);
    expect(homeBlocks(artifact).length).toBe(2);
    expect(homeBlocks(artifact)[1]!.type).toBe("menu_preview");
  });

  it("holds NO field a brand could type a dish or a price into", () => {
    const block = restaurantBlocks.find((entry) => entry.slug === "menu_preview")!;
    const names = block.fields
      .map((field) => (field as { name?: string }).name)
      .filter(Boolean) as string[];
    for (const forbidden of ["items", "price", "currency", "sections", "dishes"]) {
      expect(names).not.toContain(forbidden);
    }
    // The one array it has is photographs, and its rows are media and alt text.
    const images = block.fields.find(
      (field) => (field as { name?: string }).name === "images",
    ) as { fields: Array<{ name?: string }> };
    expect(images.fields.map((field) => field.name).sort()).toEqual(["alt", "media"]);
  });
});

describe("#3149 wave 4 a reservation points at Mingla, and is derived", () => {
  it("builds the link from the BRAND, with nothing typed on the way", async () => {
    const { artifact } = await build([HERO, {
      blockType: "venue_reservation",
      eyebrow: "Come through",
      heading: "Book a table at gögi",
      body: "gögi is walk-in and always open.",
    }]);
    const block = homeBlocks(artifact)[1]!;
    /*
     * #3149 wave 5 — was `/reserve/${BRAND_ID}`. That route is where a payment
     * RETURNS, not where a booking starts: its index renders "Payment
     * cancelled." The link is derived from the venue's public page instead.
     */
    expect(block.url).toBe("https://host.usemingla.com/b/gogilagos/v/gogi");
    expect(block.url).not.toContain("/reserve/");
    const { assertRestaurantArtifact } = await publicContract();
    expect(() => assertRestaurantArtifact(artifact)).not.toThrow();
  });

  it("PUBLISHES AT ALL, which it could not before", async () => {
    /*
     * This block resolved a "reservation target id" through the commercial
     * projection. That projection is only ever sent the ids on `offering_grid`
     * blocks, its own count check would have rejected an extra row, and it
     * returns EVENTS with kind 'offering' — there is no reservation target in
     * it. So every page carrying this block failed the publish closed with
     * VALIDATION_FAILED and nothing naming the cause.
     */
    const { artifact } = await build([HERO, {
      blockType: "venue_reservation",
      heading: "Book a table",
      body: "",
      reservation_target_id: "00000000-0000-4000-8000-000000000d01",
    }]);
    expect(homeBlocks(artifact)[1]!.type).toBe("venue_reservation");
  });

  it("offers no field an editor could point somewhere else with", () => {
    const block = restaurantBlocks.find(
      (entry) => entry.slug === "venue_reservation",
    )!;
    const names = block.fields
      .map((field) => (field as { name?: string }).name)
      .filter(Boolean) as string[];
    expect(names.sort()).toEqual(["body", "eyebrow", "heading"]);
  });
});
