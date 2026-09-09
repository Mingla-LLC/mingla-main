/*
 * #3149 — `eyebrow` and `group_heading` in the published contract.
 *
 * The contract is the boundary: it forbids unknown keys, so a field the CMS
 * can store but the contract does not name fails publication closed rather
 * than reaching the page. Both halves therefore have to be asserted — the
 * types that MAY carry these, and the types that may NOT.
 */
import { describe, expect, it } from "vitest";
import { assertRestaurantArtifact } from "./artifact";

const U = (n: number) => `aaaaaaaa-bbbb-4ccc-8ddd-${String(n).padStart(12, "0")}`;
const SITE = U(90);

const artifactOf = (blocks: unknown[]): unknown => ({
  schema_version: 1,
  site_id: SITE,
  brand_id: U(91),
  publication_id: U(92),
  renderer_key: "restaurant-website-v1",
  renderer_version: 1,
  source_revision_id: U(93),
  source_digest: "a".repeat(64),
  generated_at: "2026-09-09T00:00:00Z",
  pages: [{
    role: "home",
    slug: "home",
    title: "Home",
    enabled: true,
    nav_label: "Home",
    nav_order: 0,
    blocks,
  }],
  navigation: { page_roles: ["home"] },
  footer: { links: [] },
  site_settings: {
    display_name: "gögi",
    seo: { canonical_url: "https://gogi.sites.usemingla.com" },
  },
  media: [],
  commercial_references: [],
});

const check = (block: Record<string, unknown>) => () =>
  assertRestaurantArtifact(artifactOf([block]));

/*
 * Media-free shapes only. What is under test is a key on the block, and a
 * gallery fixture would drag the whole media-reference contract in with it —
 * that is covered where it belongs, in the render suite.
 */
const CARRIES_EYEBROW: Record<string, Record<string, unknown>> = {
  rich_text: { heading: "Come as you are", paragraphs: [{ text: "Show up." }] },
  cta: { heading: "Order in", body: "", label: "Order", href: "/menu" },
  offering_grid: {
    heading: "Experiences",
    offerings: [{
      id: U(3),
      label: "Supper club",
      summary: "",
      url: "https://usemingla.com/e/gogi/supper",
    }],
  },
  venue_reservation: {
    heading: "Book a table",
    body: "",
    url: "https://usemingla.com/t/gogi",
  },
  menu_link: { heading: "The menu", label: "View menu", href: "/menu.pdf" },
  menu_board: {
    heading: "The menu",
    note: null,
    venue_id: null,
    sections: [{
      name: "Rice",
      description: null,
      items: [{
        id: U(4),
        name: "Coconut rice",
        description: null,
        price_minor: null,
        currency: null,
      }],
    }],
  },
  video_feature: {
    heading: "Day or night",
    caption: null,
    video_url: "/media/v1/video.mp4",
    poster_url: "/media/p1/960",
  },
  team: {
    heading: "Meet the team",
    caption: null,
    members: [{ name: "Meat police", role: null, media_url: null, alt: null }],
  },
  hours_location: {
    heading: "Visit gögi",
    address: "69 Admiralty Way",
    map_url: null,
    hours: [{ day: "Monday", value: "Open 24 hours" }],
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
    body: "",
    label: "Call",
    href: "tel:+2349127117528",
  },
};

const CANNOT_CARRY_EYEBROW: Record<string, Record<string, unknown>> = {
  divider: {},
  spacer: { size: "medium" },
};

describe("#3149 the contract carries the brand's eyebrow", () => {
  for (const [type, fields] of Object.entries(CARRIES_EYEBROW)) {
    it(`${type} accepts one, and is still valid without one`, () => {
      expect(check({ type, ...fields })).not.toThrow();
      expect(check({ type, eyebrow: "The place", ...fields })).not.toThrow();
    });
  }

  it("media_feature and gallery accept one too", () => {
    // Both need real media, so they carry their own fixture rather than
    // weakening the shared one.
    const image = {
      id: U(80),
      url: `/media/${U(80)}/960.webp`,
      alt: "",
      width: 960,
      height: 720,
      integrity: "b".repeat(64),
      object_key: `approved/${SITE}/${U(80)}/960.webp`,
    };
    const withMedia = (blocks: unknown[]) => () =>
      assertRestaurantArtifact({
        ...(artifactOf(blocks) as Record<string, unknown>),
        media: [image],
      });
    expect(withMedia([{
      type: "media_feature",
      eyebrow: "The room",
      media_url: image.url,
      alt: "The room",
      heading: "At night",
      caption: null,
      alignment: "left",
    }])).not.toThrow();
    expect(withMedia([{
      type: "gallery",
      eyebrow: "Photos",
      heading: "In the room",
      images: [image],
    }])).not.toThrow();
  });
});

describe("#3149 the contract refuses an eyebrow where none belongs", () => {
  it("rejects one on the hero, which already owns the page's headline", () => {
    const hero = {
      type: "hero",
      heading: "Where Lagos comes to eat",
      subheading: null,
      media_url: "/media/hero/1600",
      video_url: null,
      ctas: [],
    };
    // The unadorned hero is only invalid on media, so assert the ERROR CODE
    // changes: an eyebrow makes it a key violation, which is the point.
    expect(check({ ...hero, eyebrow: "The place" })).toThrow(
      "ARTIFACT_BLOCK_TYPE_MISMATCH",
    );
  });

  for (const [type, fields] of Object.entries(CANNOT_CARRY_EYEBROW)) {
    it(`rejects one on ${type}, which renders no heading to sit above`, () => {
      expect(check({ type, ...fields })).not.toThrow();
      expect(check({ type, eyebrow: "The place", ...fields })).toThrow(
        "ARTIFACT_BLOCK_TYPE_MISMATCH",
      );
    });
  }
});

describe("#3149 group_heading titles a run of films, and nothing else", () => {
  const film = CARRIES_EYEBROW.video_feature!;

  it("video_feature accepts it", () => {
    expect(
      check({
        type: "video_feature",
        eyebrow: "Straight from @gogilagos",
        group_heading: "The room, on any given night",
        ...film,
      }),
    ).not.toThrow();
  });

  it("no other type accepts it — only films group", () => {
    for (const [type, fields] of Object.entries(CARRIES_EYEBROW)) {
      if (type === "video_feature") continue;
      expect(check({ type, group_heading: "A run", ...fields })).toThrow(
        "ARTIFACT_BLOCK_TYPE_MISMATCH",
      );
    }
  });
});

describe("#3149 both get exactly the treatment `heading` gets", () => {
  const film = CARRIES_EYEBROW.video_feature!;

  it("refuses markup and event handlers, as every other text field does", () => {
    for (
      const attack of [
        "<script>alert(1)</script>",
        '<img src=x onerror="steal()">',
        "javascript:alert(1)",
        "<iframe src=evil>",
      ]
    ) {
      expect(check({ type: "video_feature", eyebrow: attack, ...film }))
        .toThrow("ARTIFACT_BLOCK_CONTENT_MISMATCH");
      expect(check({ type: "video_feature", group_heading: attack, ...film }))
        .toThrow("ARTIFACT_BLOCK_CONTENT_MISMATCH");
    }
  });

  it("refuses a non-string, which is what a bad projection would emit", () => {
    for (const bad of [42, true, {}, ["The place"]]) {
      expect(check({ type: "video_feature", eyebrow: bad, ...film }))
        .toThrow("ARTIFACT_BLOCK_CONTENT_MISMATCH");
    }
  });

  it("is bounded at the same 120 characters `heading` is", () => {
    expect(check({ type: "video_feature", eyebrow: "x".repeat(120), ...film }))
      .not.toThrow();
    expect(check({ type: "video_feature", eyebrow: "x".repeat(121), ...film }))
      .toThrow("ARTIFACT_BLOCK_CONTENT_MISMATCH");
    expect(
      check({ type: "video_feature", group_heading: "x".repeat(120), ...film }),
    ).not.toThrow();
    expect(
      check({ type: "video_feature", group_heading: "x".repeat(121), ...film }),
    ).toThrow("ARTIFACT_BLOCK_CONTENT_MISMATCH");
  });

  it("accepts the punctuation a brand actually writes", () => {
    // gögi's own eyebrows carry an @handle and a diacritic. A tightened
    // character class here would refuse the brand's real copy.
    for (const real of ["Straight from @gogilagos", "Six minutes of gögi"]) {
      expect(check({ type: "video_feature", eyebrow: real, ...film }))
        .not.toThrow();
    }
  });
});
