/*
 * #3149 — the brand's eyebrow, from the Studio field to the published bytes.
 *
 * This EXECUTES `buildPublicationArtifact` against a stubbed Payload rather
 * than reading the source. Six defects on #2830 shipped green off tests that
 * read code as text and failed on the first real call, and the failure this
 * guards against is exactly that shape: a field the CMS accepts, that the
 * builder drops, so a brand types an eyebrow into Studio and the published
 * page prints nothing.
 *
 * The other half is just as load-bearing: an UNSET eyebrow must not surface as
 * `""` or `null`. The public contract forbids unknown keys and the publication
 * digest is taken over the serialised artifact, so an empty value would change
 * the bytes of every artifact ever published and make a republish look like a
 * content change.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Field } from "payload";
import { restaurantBlocks } from "../blocks/restaurantBlocks";
import { sha256 } from "./crypto";

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

const TENANT_ID = "00000000-0000-4000-8000-000000000901";
const SITE_ID = "00000000-0000-4000-8000-000000000902";
const BRAND_ID = "00000000-0000-4000-8000-000000000903";

const tenant = {
  id: TENANT_ID,
  core_site_id: SITE_ID,
  core_brand_id: BRAND_ID,
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

/*
 * Drives the real builder over the given home-page blocks and returns the
 * artifact it actually produced.
 */
async function build(
  blocks: Record<string, unknown>[],
  media: Record<string, unknown>[] = [],
) {
  const page = {
    id: "page-home",
    tenant: TENANT_ID,
    role: "home",
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
    media,
  };
  const sourceDigest = await publicationDraftDigest({
    pages: collections.pages!,
    navigation: collections.navigation![0] ?? null,
    footer: collections.footer![0] ?? null,
    settings,
    media,
  });
  const req = {
    context: {},
    payload: {
      find: async ({ collection }: { collection: string }) => ({
        docs: collections[collection] ?? [],
      }),
    },
    // The builder takes a PayloadRequest; this stub carries only what it reads.
  } as never;
  const result = await buildPublicationArtifact(req, {
    tenant,
    operationId: "op-3149",
    publicationId: "00000000-0000-4000-8000-000000000904",
    sourceRevisionId: "rev-3149",
    sourceDigest,
    generatedAt: "2026-09-09T00:00:00Z",
  });
  return result;
}

const homeBlocks = (artifact: unknown): Record<string, unknown>[] =>
  ((artifact as Record<string, never>).pages as unknown as Record<
    string,
    Record<string, unknown>[]
  >[])[0]!.blocks as unknown as Record<string, unknown>[];

/* Deep copy that keeps functions, so a mutating sanitizer cannot poison the
   real `restaurantBlocks` for the assertions that follow. */
const clone = <T,>(value: T): T => {
  if (Array.isArray(value)) return value.map(clone) as unknown as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map((
        [key, child],
      ) => [key, clone(child)]),
    ) as T;
  }
  return value;
};

beforeEach(() => stored.clear());

/* Block types the Studio offers an eyebrow on, in a shape the builder accepts. */
const SOURCE_BLOCKS: Record<string, Record<string, unknown>> = {
  rich_text: {
    heading: "Come as you are",
    content: {
      root: {
        type: "root",
        children: [{
          type: "paragraph",
          children: [{ type: "text", text: "Show up exactly as you are." }],
        }],
      },
    },
  },
  cta: { heading: "Order in", body: "Any hour.", label: "Order", href: "/menu" },
  menu_link: { heading: "The menu", label: "View menu", href: "/menu.pdf" },
  hours_location: {
    heading: "Open day and night",
    address: "69 Admiralty Way",
    hours: [{ day: "Monday", value: "Open 24 hours" }],
  },
  team: {
    heading: "Meet the team",
    caption: "We won a lottery with our team.",
    members: [{ name: "Meat police" }],
  },
  testimonials: {
    heading: "What guests say",
    items: [{ name: "A regular", quote: "Coconut rice at 3am." }],
  },
  faq: {
    heading: "Questions",
    items: [{ question: "Are you open?", answer: "Always." }],
  },
  contact_handoff: {
    heading: "Call gögi",
    body: "Open 24 hours.",
    label: "Call",
    href: "tel:+2349127117528",
  },
};

describe("#3149 the Studio offers an eyebrow where a section has a heading", () => {
  const bySlug = new Map(restaurantBlocks.map((block) => [block.slug, block]));
  const named = (slug: string, name: string): Field | undefined =>
    bySlug.get(slug)?.fields.find((field) =>
      (field as { name?: string }).name === name
    );

  const CARRIES = [
    "rich_text", "media_feature", "cta", "offering_grid", "venue_reservation",
    "menu_link", "menu_board", "gallery", "video_feature", "team",
    "hours_location", "testimonials", "faq", "contact_handoff",
  ];

  for (const slug of CARRIES) {
    it(`${slug} has an optional eyebrow, explained in the brand's language`, () => {
      const field = named(slug, "eyebrow") as
        | (Field & { maxLength?: number; required?: boolean; admin?: { description?: string } })
        | undefined;
      expect(field, `${slug} is missing the eyebrow field`).toBeDefined();
      expect(field!.type).toBe("text");
      expect(field!.required).toBe(false);
      expect(field!.maxLength).toBe(60);
      // A field a restaurant cannot understand is a field they will not use.
      expect(field!.admin?.description ?? "").toContain("above");
      expect(field!.admin?.description ?? "").not.toMatch(/block|artifact|slug/i);
    });
  }

  for (const slug of ["hero", "divider", "spacer"]) {
    it(`${slug} is NOT offered one`, () => {
      // The hero already owns the page's one h1; the other two render no
      // heading for a line to sit above.
      expect(named(slug, "eyebrow")).toBeUndefined();
    });
  }

  it("group_heading is offered on video_feature and nowhere else", () => {
    const field = named("video_feature", "group_heading") as
      | (Field & { maxLength?: number; required?: boolean; admin?: { description?: string } })
      | undefined;
    expect(field).toBeDefined();
    expect(field!.required).toBe(false);
    expect(field!.maxLength).toBe(120);
    expect(field!.admin?.description ?? "").toContain("grid");
    for (const block of restaurantBlocks) {
      if (block.slug === "video_feature") continue;
      expect(
        block.fields.some((f) => (f as { name?: string }).name === "group_heading"),
        `${block.slug} should not offer group_heading`,
      ).toBe(false);
    }
  });

  it("survives Payload's OWN field sanitizer, description intact", async () => {
    /*
     * `short()` sets `admin: undefined` when no description is given, which is
     * how the whole file keeps type-checking (a spread widens the Field union).
     * Payload replaces a falsy `admin` with `{}` before anything reads through
     * it — but that is a claim about someone else's code, so it is EXECUTED
     * here rather than trusted. A wrong answer would break every block in
     * Studio at boot, not just this field.
     */
    const { sanitizeFields } = await import("payload") as unknown as {
      sanitizeFields: (args: Record<string, unknown>) => Promise<Field[]>;
    };
    for (const block of restaurantBlocks) {
      const sanitized = await sanitizeFields({
        config: { collections: [], globals: [] },
        // structuredClone cannot clone the validators, and sanitizeFields
        // MUTATES what it is handed — so copy by hand, functions by reference.
        fields: clone(
          block.fields.filter((field) =>
            (field as { type?: string }).type !== "richText"
          ),
        ),
        parentIsLocalized: false,
        validRelationships: ["media"],
      });
      for (const field of sanitized) {
        expect((field as { admin?: unknown }).admin).toBeTypeOf("object");
      }
      const found = sanitized.find((field) =>
        (field as { name?: string }).name === "eyebrow"
      ) as (Field & { admin?: { description?: string } }) | undefined;
      /*
       * #3149 wave 3 — the blocks that render NO heading, so there is no line
       * for an eyebrow to sit above. `marquee` and `pull_quote` join `hero`,
       * `divider` and `spacer` for that reason, not as an exemption.
       *
       * Deliberately hand-maintained rather than derived from the block
       * definitions: deriving it would make this test agree with whatever the
       * code does. Failing here when a new block type lands is the point — it
       * forces a decision about whether that block speaks in the brand's voice.
       */
      const NO_HEADING = ["hero", "divider", "spacer", "marquee", "pull_quote"];
      if (!NO_HEADING.includes(block.slug)) {
        expect(found, `${block.slug}`).toBeDefined();
        expect(found!.admin?.description ?? "").toContain("above");
      }
    }
  });

  it("the eyebrow's validator RUNS, and refuses markup", () => {
    // Executed, not read: `short()` builds the validator, and a field wired to
    // the wrong one would look identical in source.
    const field = named("gallery", "eyebrow") as Field & {
      validate: (value: unknown) => true | string;
    };
    expect(field.validate("The place")).toBe(true);
    expect(field.validate(null)).toBe(true);
    expect(field.validate("<script>alert(1)</script>")).not.toBe(true);
    expect(field.validate("x".repeat(61))).not.toBe(true);
  });
});

describe("#3149 the builder carries the eyebrow into the published artifact", () => {
  for (const [type, fields] of Object.entries(SOURCE_BLOCKS)) {
    it(`${type} publishes the brand's eyebrow verbatim`, async () => {
      const { artifact } = await build([
        { blockType: type, eyebrow: "The place", ...fields },
      ]);
      expect(homeBlocks(artifact)[0]!.eyebrow).toBe("The place");
    });

    it(`${type} publishes NO eyebrow key when the brand left it empty`, async () => {
      for (const empty of [undefined, null, "", "   "]) {
        const source: Record<string, unknown> = { blockType: type, ...fields };
        if (empty !== undefined) source.eyebrow = empty;
        const { artifact } = await build([source]);
        const block = homeBlocks(artifact)[0]!;
        // Not `null`, not `""` — ABSENT. The contract forbids unknown keys and
        // the digest is taken over these bytes.
        expect(Object.keys(block)).not.toContain("eyebrow");
      }
    });
  }

  it("trims what the brand typed, so trailing space never reaches the page", async () => {
    const { artifact } = await build([
      { blockType: "gallery", eyebrow: "  Photos  ", heading: "In the room", images: [] },
    ]);
    expect(homeBlocks(artifact)[0]!.eyebrow).toBe("Photos");
  });

  it("never puts an eyebrow on the hero, even with one stored", async () => {
    /*
     * The public contract forbids unknown keys, so a hero carrying an eyebrow
     * would fail the whole publication closed. Studio does not offer the field
     * there — this proves the BUILDER would not copy a stray stored value
     * either, which is the only thing standing between a leftover row and a
     * site that cannot publish.
     */
    const poster = {
      id: "hero-1",
      tenant: TENANT_ID,
      state: "READY",
      detected_mime: "image/jpeg",
      width: 1600,
      height: 900,
      rendition_manifest: {
        renditions: [{
          width: 1600,
          target_width: 1600,
          digest: "c".repeat(64),
          key: `approved/${SITE_ID}/hero-1/1600.webp`,
        }],
      },
    };
    const { artifact } = await build([
      {
        blockType: "hero",
        eyebrow: "The place",
        group_heading: "Also ignored",
        heading: "Where Lagos comes to eat",
        subheading: "A 24/7 food house.",
        media: "hero-1",
        ctas: [],
      },
    ], [poster]);
    const hero = homeBlocks(artifact)[0]!;
    expect(hero.type).toBe("hero");
    expect(Object.keys(hero)).not.toContain("eyebrow");
    expect(Object.keys(hero)).not.toContain("group_heading");
  });
});

describe("#3149 an empty eyebrow publishes exactly what no eyebrow publishes", () => {
  const base = { blockType: "faq", ...SOURCE_BLOCKS.faq };
  const publishedBlocks = (result: { serialized: string }) =>
    JSON.stringify(
      (JSON.parse(result.serialized) as {
        pages: { blocks: unknown[] }[];
      }).pages[0]!.blocks,
    );

  it("emits byte-identical blocks whether the key is blank or absent", async () => {
    const without = await build([{ ...base }]);
    stored.clear();
    const blank = await build([{ ...base, eyebrow: "" }]);
    stored.clear();
    const spaces = await build([{ ...base, eyebrow: "   " }]);
    expect(publishedBlocks(blank)).toBe(publishedBlocks(without));
    expect(publishedBlocks(spaces)).toBe(publishedBlocks(without));
  });

  /*
   * NOT the whole artifact, and the difference is worth naming.
   *
   * `source_digest` is taken over the Payload DRAFT, and a draft that stores
   * `eyebrow: ""` genuinely differs from one that stores nothing — that is the
   * revision-conflict guard doing its job, and it is a fact about the draft,
   * not about the published page. What must not drift is the PUBLISHED block,
   * asserted above, because that is what the renderer reads and what the
   * artifact digest of the content is taken over.
   */
  it("still moves the digest when a brand actually writes one", async () => {
    const without = await build([{ ...base }]);
    stored.clear();
    const withOne = await build([{ ...base, eyebrow: "The questions" }]);
    expect(withOne.artifactDigest).not.toBe(without.artifactDigest);
    expect(publishedBlocks(withOne)).not.toBe(publishedBlocks(without));
  });

  it("the stored artifact bytes really do hash to the reported digest", async () => {
    // The builder writes then reads back; this is the readback contract.
    const result = await build([{ ...base, eyebrow: "The questions" }]);
    expect(await sha256(result.serialized)).toBe(result.artifactDigest);
  });
});

describe("#3149 group_heading rides the same rail", () => {
  const film = {
    blockType: "video_feature",
    heading: "Your Friday needs better decisions",
    caption: "Start with gögi.",
    video: "video-1",
    poster: "poster-1",
  };

  /*
   * A video block needs READY media of both kinds, so this run stubs the media
   * collection rather than leaving it empty.
   */
  async function buildFilm(extra: Record<string, unknown>) {
    const media = [
      {
        id: "video-1",
        tenant: TENANT_ID,
        state: "READY",
        detected_mime: "video/mp4",
        rendition_manifest: {
          master: { digest: "a".repeat(64), key: `approved/${SITE_ID}/video-1/video.mp4` },
        },
      },
      {
        id: "poster-1",
        tenant: TENANT_ID,
        state: "READY",
        detected_mime: "image/jpeg",
        width: 1440,
        height: 1080,
        rendition_manifest: {
          renditions: [{
            width: 1440,
            target_width: 1440,
            digest: "b".repeat(64),
            key: `approved/${SITE_ID}/poster-1/1440.webp`,
          }],
        },
      },
    ];
    const page = {
      id: "page-home",
      tenant: TENANT_ID,
      role: "home",
      title: "Home",
      enabled: true,
      nav_label: "Home",
      nav_order: 0,
      blocks: [{ ...film, ...extra }],
      seo: {},
    };
    const collections: Record<string, unknown[]> = {
      pages: [page],
      navigation: [{ id: "nav-1", tenant: TENANT_ID, pages: ["page-home"] }],
      footer: [{ id: "footer-1", tenant: TENANT_ID }],
      "site-settings": [settings],
      media,
    };
    const sourceDigest = await publicationDraftDigest({
      pages: collections.pages!,
      navigation: collections.navigation![0] ?? null,
      footer: collections.footer![0] ?? null,
      settings,
      media,
    });
    const req = {
      context: {},
      payload: {
        find: async ({ collection }: { collection: string }) => ({
          docs: collections[collection] ?? [],
        }),
      },
    } as never;
    return buildPublicationArtifact(req, {
      tenant,
      operationId: "op-3149",
      publicationId: "00000000-0000-4000-8000-000000000905",
      sourceRevisionId: "rev-3149",
      sourceDigest,
      generatedAt: "2026-09-09T00:00:00Z",
    });
  }

  it("publishes the run's title when the first film carries one", async () => {
    const { artifact } = await buildFilm({
      eyebrow: "Straight from @gogilagos",
      group_heading: "The room, on any given night",
    });
    const block = homeBlocks(artifact)[0]!;
    expect(block.group_heading).toBe("The room, on any given night");
    expect(block.eyebrow).toBe("Straight from @gogilagos");
  });

  it("omits the key entirely on a film that titles no run", async () => {
    const { artifact } = await buildFilm({});
    expect(Object.keys(homeBlocks(artifact)[0]!)).not.toContain("group_heading");
    expect(Object.keys(homeBlocks(artifact)[0]!)).not.toContain("eyebrow");
  });
});
