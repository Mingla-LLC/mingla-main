/*
 * #3149 wave 3 — what the four new blocks may and may not carry.
 *
 * These run the REAL validator over whole artifacts rather than checking that
 * a key exists somewhere. The failures worth catching are all shaped the same
 * way: a block that validates but carries something the renderer will not use,
 * or one that is refused for a reason nobody can see from the source.
 *
 * The map is the sharp one. A map addressed by NAME resolves silently and can
 * resolve to a street of the same name in another country — that has already
 * happened here once, on a deep link. Both coordinates are required and there
 * is no free-text field to fall back to, and that is asserted from both sides.
 */
import { describe, expect, it } from "vitest";
import { assertRestaurantArtifact } from "./artifact";

const U = (n: number) => `aaaaaaaa-bbbb-4ccc-8ddd-${String(n).padStart(12, "0")}`;
const SITE = U(90);

function artifactOf(blocks: unknown[]): Record<string, unknown> {
  return {
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
    footer: { address: "69 Admiralty Way, Lekki Phase 1, Lagos", links: [] },
    site_settings: {
      display_name: "gögi",
      seo: { canonical_url: "https://gogi.sites.usemingla.com" },
    },
    media: [],
    commercial_references: [],
  };
}

const accepts = (block: unknown) => {
  assertRestaurantArtifact(artifactOf([block]));
  return true;
};
const refuses = (block: unknown) =>
  expect(() => assertRestaurantArtifact(artifactOf([block]))).toThrow();

/* A copy of the block with one key gone — what an editor who never filled a
   field in leaves behind, which is not the same as leaving it empty. */
const without = <T extends object>(block: T, key: keyof T): Partial<T> => {
  const copy: Partial<T> = { ...block };
  delete copy[key];
  return copy;
};

const MARQUEE = {
  type: "marquee",
  phrases: [{ text: "24/7 food house" }, { text: "Come as you are" }],
};
const STATS = {
  type: "stats",
  eyebrow: "Why people keep coming back",
  heading: "No closing time",
  items: [{ figure: "Open 24 hours", label: "Seven days a week, all year." }],
};
const PULL_QUOTE = {
  type: "pull_quote",
  quote: "It's very important you find gögi.",
  attribution: "gögi, on Instagram",
};
const MAP = {
  type: "map_embed",
  heading: "Admiralty Way",
  body: "It is a small frontage.",
  latitude: 6.4471033,
  longitude: 3.4680182,
  place_label: "Admiralty Way, Lekki Phase 1, Lagos",
  directions_url: "https://www.google.com/maps/dir/?api=1&destination=6.4471033,3.4680182",
};

describe("#3149 the marquee carries phrases and nothing else", () => {
  it("accepts a run of short phrases", () => {
    expect(accepts(MARQUEE)).toBe(true);
  });

  it("refuses a single phrase — a ticker needs something to separate", () => {
    refuses({ type: "marquee", phrases: [{ text: "24/7 food house" }] });
  });

  it("refuses more than a dozen, and an empty phrase", () => {
    refuses({
      type: "marquee",
      phrases: Array.from({ length: 13 }, () => ({ text: "gögi" })),
    });
    refuses({ type: "marquee", phrases: [{ text: "" }, { text: "gögi" }] });
  });

  it("carries NO eyebrow — there is no heading for one to sit above", () => {
    refuses({ ...MARQUEE, eyebrow: "The strip" });
  });

  it("refuses markup smuggled into a phrase", () => {
    refuses({
      type: "marquee",
      phrases: [{ text: "<script>x()</script>" }, { text: "gögi" }],
    });
  });
});

describe("#3149 the stats row is figures with labels", () => {
  it("accepts the brand's eyebrow, heading and figures", () => {
    expect(accepts(STATS)).toBe(true);
  });

  it("accepts a figure with no label at all", () => {
    expect(accepts({ type: "stats", items: [{ figure: "24/7" }] })).toBe(true);
  });

  it("refuses a labelled row with no figure", () => {
    refuses({ type: "stats", items: [{ label: "Seven days a week." }] });
  });

  it("refuses an empty row set and more than six", () => {
    refuses({ type: "stats", items: [] });
    refuses({
      type: "stats",
      items: Array.from({ length: 7 }, () => ({ figure: "24/7" })),
    });
  });

  it("refuses a key the renderer does not read", () => {
    refuses({ ...STATS, icon: "clock" });
    refuses({ type: "stats", items: [{ figure: "24/7", icon: "clock" }] });
  });
});

describe("#3149 the pull quote is a line and, optionally, who said it", () => {
  it("accepts an attributed quote", () => {
    expect(accepts(PULL_QUOTE)).toBe(true);
  });

  it("accepts a quote with no attribution — a source is never invented", () => {
    expect(accepts({ type: "pull_quote", quote: "Find gögi." })).toBe(true);
  });

  it("refuses an empty quote and a missing one", () => {
    refuses({ type: "pull_quote", quote: "" });
    refuses({ type: "pull_quote", attribution: "gögi, on Instagram" });
  });

  it("carries NO eyebrow and NO heading", () => {
    refuses({ ...PULL_QUOTE, eyebrow: "In their words" });
    refuses({ ...PULL_QUOTE, heading: "In their words" });
  });
});

describe("#3149 a map is two numbers, never a name", () => {
  it("accepts coordinates, a label and a directions link", () => {
    expect(accepts(MAP)).toBe(true);
  });

  it("accepts a map with no directions link", () => {
    expect(accepts(without(MAP, "directions_url"))).toBe(true);
  });

  it("REFUSES a map with no coordinates", () => {
    refuses(without(MAP, "latitude"));
    refuses(without(MAP, "longitude"));
  });

  it("refuses coordinates that are not numbers", () => {
    // The string "6.4471033" is what a text input hands back, and `Number()`
    // would quietly rescue it. Nothing here rescues it.
    refuses({ ...MAP, latitude: "6.4471033" });
    refuses({ ...MAP, longitude: null });
    refuses({ ...MAP, latitude: Number.NaN });
  });

  it("refuses coordinates off the globe", () => {
    refuses({ ...MAP, latitude: 91 });
    refuses({ ...MAP, latitude: -90.5 });
    refuses({ ...MAP, longitude: 181 });
    refuses({ ...MAP, longitude: -180.5 });
  });

  it("accepts the poles and the antimeridian exactly", () => {
    expect(accepts({ ...MAP, latitude: 90, longitude: 180 })).toBe(true);
    expect(accepts({ ...MAP, latitude: -90, longitude: -180 })).toBe(true);
  });

  it("REFUSES a free-text query — there is nowhere to put one", () => {
    refuses({ ...MAP, query: "69 Admiralty Way, Lekki Phase 1, Lagos" });
    refuses({ ...MAP, address: "69 Admiralty Way" });
    refuses({ ...MAP, embed_url: "https://www.openstreetmap.org/export/embed.html" });
  });

  it("requires a label, so the map always says what it is pointing at", () => {
    refuses(without(MAP, "place_label"));
    refuses({ ...MAP, place_label: "" });
  });

  it("refuses a directions link that is not a safe URL", () => {
    refuses({ ...MAP, directions_url: "javascript:alert(1)" });
    refuses({ ...MAP, directions_url: "http://maps.example/gogi" });
  });
});

describe("#3149 the new types live alongside the old ones", () => {
  it("publishes a page carrying all four", () => {
    expect(accepts.length).toBeGreaterThan(0);
    assertRestaurantArtifact(artifactOf([MARQUEE, STATS, PULL_QUOTE, MAP]));
  });

  it("still refuses a type nobody defined", () => {
    refuses({ type: "open_now_pill", timezone: "Africa/Lagos" });
  });

  it("keeps the per-page cap at forty blocks", () => {
    const forty = Array.from({ length: 40 }, () => ({ ...MARQUEE }));
    assertRestaurantArtifact(artifactOf(forty));
    expect(() => assertRestaurantArtifact(artifactOf([...forty, { ...MARQUEE }])))
      .toThrow("ARTIFACT_BLOCKS_MISMATCH");
  });
});
