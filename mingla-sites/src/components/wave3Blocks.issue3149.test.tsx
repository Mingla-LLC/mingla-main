/*
 * #3149 wave 3 — the four new blocks, RENDERED.
 *
 * Six defects on #2830 shipped green off tests that read code as text, and the
 * one this issue has produced three times is a contract field with no reader:
 * the CMS accepts it, the builder carries it, and the page prints nothing. So
 * every assertion here comes off real markup produced by the real renderer
 * over an artifact the real contract has accepted.
 *
 * The negative half matters as much. A page that carries none of these must
 * emit none of them — no empty strip, no stray dialog, no map panel waiting
 * for a click that has nothing behind it.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RestaurantV1 } from "./RestaurantV1";
import type { RestaurantArtifact } from "../contracts/artifact";
import { assertRestaurantArtifact } from "../contracts/artifact";

const U = (n: number) => `aaaaaaaa-bbbb-4ccc-8ddd-${String(n).padStart(12, "0")}`;
const SITE = U(90);
const MEDIA = [80, 81].map((n, index) => ({
  id: U(n),
  url: `/media/${U(n)}/960.webp`,
  alt: "",
  width: 960,
  height: index === 0 ? 720 : 960,
  integrity: String(n).repeat(32),
  object_key: `approved/${SITE}/${U(n)}/960.webp`,
}));

function artifactOf(blocks: unknown[]): RestaurantArtifact {
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
    media: MEDIA,
    commercial_references: [],
  } as unknown as RestaurantArtifact;
}

/* Renders only what the PUBLIC CONTRACT would have let through, so a fixture
   that could never be published cannot pass a rendering test. */
function render(blocks: unknown[]): string {
  const artifact = artifactOf(blocks);
  assertRestaurantArtifact(artifact);
  return renderToStaticMarkup(
    <RestaurantV1 artifact={artifact} page={artifact.pages[0]!} />,
  );
}

const textOf = (html: string) =>
  html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const PHRASES = [
  "24/7 food house",
  "Come as you are",
  "Day or night, open for a bite",
  "69 Admiralty Way",
  "Find gögi",
];
const MARQUEE = { type: "marquee", phrases: PHRASES.map((text) => ({ text })) };
const STATS = {
  type: "stats",
  eyebrow: "Why people keep coming back",
  heading: "No closing time",
  items: [
    { figure: "Open 24 hours", label: "Seven days a week, all year." },
    { figure: "Pregame Fridays", label: "DJ on deck, drinks flowing." },
  ],
};
const PULL_QUOTE = {
  type: "pull_quote",
  quote: "It's very important you find gögi.",
  attribution: "gögi, on Instagram",
};
const MAP = {
  type: "map_embed",
  heading: "Admiralty Way",
  body: "It is a small frontage — look for the 24/7 food house sign.",
  latitude: 6.4471033,
  longitude: 3.4680182,
  place_label: "Admiralty Way, Lekki Phase 1, Lagos",
  directions_url:
    "https://www.google.com/maps/dir/?api=1&destination=6.4471033,3.4680182",
};
const HOURS = {
  type: "hours_location",
  heading: "Visit gögi",
  address: "69 Admiralty Way, Lekki Phase 1, Lagos",
  hours: [{ day: "Monday", value: "Open 24 hours" }],
};

describe("#3149 the marquee reaches the page", () => {
  const html = render([MARQUEE]);

  it("prints every phrase the brand wrote", () => {
    for (const phrase of PHRASES) expect(html).toContain(phrase);
  });

  it("repeats the run so the loop has no seam", () => {
    // Two copies of the track, and the SECOND is the duplicate.
    expect(html.split('class="marquee-run"').length - 1).toBe(2);
    expect(html.split('class="marquee-run" aria-hidden="true"').length - 1)
      .toBe(1);
    expect(html.split("24/7 food house").length - 1).toBe(2);
  });

  it("says each phrase to a screen reader exactly once", () => {
    /*
     * The duplicate exists for the animation, not for the reader. Counting the
     * ARIA-VISIBLE copies is the only honest measure: the words appear twice
     * in the markup either way.
     */
    const runs = [...html.matchAll(/<span class="marquee-run"( aria-hidden="true")?>/g)];
    expect(runs.length).toBe(2);
    expect(runs.filter((run) => run[1] === undefined).length).toBe(1);
  });

  it("writes no separator into the copy — the dot is the stylesheet's", () => {
    expect(html).not.toContain("·</span>");
    expect(html).toContain('class="marquee-phrase"');
  });

  it("renders nothing at all for a strip it cannot loop", () => {
    // Below the contract's minimum, so this can only arrive from a hand-built
    // artifact — it must still not print half a ticker.
    const html = renderToStaticMarkup(
      <RestaurantV1
        artifact={artifactOf([{ type: "marquee", phrases: [{ text: "gögi" }] }])}
        page={artifactOf([])!.pages[0]!}
      />,
    );
    expect(html).not.toContain("marquee");
  });
});

describe("#3149 the stats row reaches the page", () => {
  const html = render([STATS]);

  it("prints the brand's eyebrow, heading and every figure", () => {
    expect(html).toContain('<p class="eyebrow">Why people keep coming back</p>');
    expect(textOf(html)).toContain("No closing time");
    expect(html).toContain("<dt>Open 24 hours</dt>");
    expect(html).toContain("<dd>Seven days a week, all year.</dd>");
    expect(html).toContain("<dt>Pregame Fridays</dt>");
  });

  it("prints a figure with no label as a figure, not as an empty line", () => {
    const html = render([{ type: "stats", items: [{ figure: "24/7" }] }]);
    expect(html).toContain("<dt>24/7</dt>");
    expect(html).not.toContain("<dd></dd>");
  });

  it("prints no heading element when the brand wrote no heading", () => {
    const html = render([{ type: "stats", items: [{ figure: "24/7" }] }]);
    expect(html).not.toContain("<h2></h2>");
  });
});

describe("#3149 the pull quote reaches the page", () => {
  const html = render([PULL_QUOTE]);

  it("prints the quotation inside a blockquote, with its bar class", () => {
    expect(html).toContain('class="pull-quote"');
    expect(html).toContain("<blockquote>");
    // React escapes the apostrophe on the way out, so the served bytes are
    // what is asserted rather than a string this test un-escaped for itself.
    expect(html).toContain(
      "<blockquote><p>It&#x27;s very important you find gögi.</p></blockquote>",
    );
  });

  it("prints the attribution as a caption when there is one", () => {
    expect(html).toContain("<figcaption>gögi, on Instagram</figcaption>");
  });

  it("prints NO caption when the brand named no source", () => {
    const html = render([{ type: "pull_quote", quote: "Find gögi." }]);
    expect(html).toContain("<blockquote>");
    expect(html).not.toContain("<figcaption>");
  });
});

describe("#3149 the map reaches the page and contacts nobody", () => {
  const html = render([MAP]);

  it("prints the brand's heading and words", () => {
    expect(textOf(html)).toContain("Admiralty Way");
    expect(textOf(html)).toContain("look for the 24/7 food house sign");
  });

  it("SERVES NO IFRAME AND NO MAP HOST — the first paint requests nothing", () => {
    expect(html).not.toContain("<iframe");
    /*
     * The note in the panel NAMES openstreetmap.org, deliberately — a visitor
     * is told who will be contacted before they press. What must not exist is
     * anything the BROWSER would fetch, so this asserts on the attributes that
     * cause a request rather than on the word.
     */
    expect(html).not.toMatch(/(?:src|href)="[^"]*openstreetmap\.org/);
    expect(html).not.toContain("//www.openstreetmap.org");
    expect(html).not.toContain("google.com/maps?");
    expect(html).not.toContain("maps.googleapis.com");
  });

  it("names who will be contacted BEFORE anyone presses the control", () => {
    expect(textOf(html)).toContain("Show the map");
    expect(textOf(html)).toContain("loaded from openstreetmap.org");
    expect(textOf(html)).toContain("Admiralty Way, Lekki Phase 1, Lagos");
  });

  it("offers directions as an ordinary link the visitor chooses", () => {
    expect(html).toContain(
      'href="https://www.google.com/maps/dir/?api=1&amp;destination=6.4471033,3.4680182"',
    );
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("prints no panel when the artifact carries no usable coordinates", () => {
    /*
     * Below the contract, so only a hand-built artifact reaches this — but a
     * `Number(null)` rescue would have drawn a map of 0,0, which is open water
     * in the Gulf of Guinea and looks plausible enough at a glance.
     */
    const artifact = artifactOf([{ ...MAP, latitude: null }]);
    const html = renderToStaticMarkup(
      <RestaurantV1 artifact={artifact} page={artifact.pages[0]!} />,
    );
    expect(html).not.toContain("map-panel");
    expect(html).not.toContain("Show the map");
  });
});

describe("#3149 a page carrying none of them emits none of them", () => {
  const html = render([HOURS]);

  it("prints the page it does have", () => {
    expect(textOf(html)).toContain("Visit gögi");
  });

  for (
    const token of [
      "marquee",
      "marquee-track",
      "marquee-run",
      "stats-row",
      "pull-quote",
      "map-embed",
      "map-panel",
      "Show the map",
      "openstreetmap",
      "lightbox",
    ]
  ) {
    it(`emits no "${token}"`, () => {
      expect(html).not.toContain(token);
    });
  }

  it("emits no dialog at all until a photograph is opened", () => {
    const gallery = render([{
      type: "gallery",
      heading: "In the room",
      images: MEDIA,
    }]);
    expect(gallery).toContain('class="gallery gallery-strip"');
    expect(gallery).not.toContain('role="dialog"');
    expect(gallery).not.toContain("lightbox");
  });
});

describe("#3149 the gallery photographs are links before they are anything", () => {
  const html = render([{
    type: "gallery",
    heading: "In the room",
    images: MEDIA,
  }]);

  it("wraps each photograph in an anchor to the full image", () => {
    expect(html.split("<a").length - 1).toBeGreaterThanOrEqual(2);
    for (const media of MEDIA) {
      expect(html).toContain(`href="${media.url}"`);
    }
  });

  it("works with no JavaScript at all — the anchor is the fallback", () => {
    // Not a button: a button here is a dead tap until hydration, and this
    // markup is what a visitor with scripting off is served.
    expect(html).toContain('class="gallery-item"');
    expect(html).not.toContain('<button type="button" class="gallery-item"');
  });

  it("gives each anchor a name a screen reader can tell apart", () => {
    expect(html).toContain('aria-label="View photograph 1 larger"');
    expect(html).toContain('aria-label="View photograph 2 larger"');
  });

  it("prefers the brand's own alternative text when there is any", () => {
    const withAlt = render([{
      type: "gallery",
      heading: "In the room",
      images: [{ ...MEDIA[0]!, alt: "Coconut rice" }],
    }]);
    expect(withAlt).toContain('aria-label="View larger: Coconut rice"');
  });
});
