/*
 * #3149 — the eyebrow is the BRAND'S line, or there is no line.
 *
 * The renderer used to hand every section a fixed label above its heading —
 * "Gallery", "Film", "Team", "Story", "Visit" — because a block had nowhere to
 * carry the brand's own. gogi's site writes all of theirs ("The place", "The
 * menu", "Straight from @gogilagos"), so a generic word in that slot is Mingla
 * writing copy on a restaurant's own website.
 *
 * These RENDER the component rather than grepping it. The thing that has to be
 * true is what reaches the page, and the failure mode this guards against —
 * a section quietly printing a word the brand never wrote — is invisible to a
 * source search that only knows the label was removed from ONE branch.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import fs from "node:fs";
import path from "node:path";
import { RestaurantV1 } from "./RestaurantV1";
import type { RestaurantArtifact, RestaurantBlock } from "../contracts/artifact";
import { assertRestaurantArtifact } from "../contracts/artifact";

const U = (n: number) => `aaaaaaaa-bbbb-4ccc-8ddd-${String(n).padStart(12, "0")}`;

/*
 * Real media references, because the contract checks that every image a block
 * names is declared in `media` and is tenant-scoped. Fixtures that skipped
 * this would render fine and could never be published.
 */
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

function render(blocks: unknown[]): string {
  const artifact = artifactOf(blocks);
  return renderToStaticMarkup(
    <RestaurantV1 artifact={artifact} page={artifact.pages[0]!} />,
  );
}

/*
 * The fact rail legitimately prints the word "Visit" as a <dt>, and the footer
 * carries the brand's name. Counting eyebrow ELEMENTS is therefore the only
 * honest measure of "did this section print a line above its heading".
 */
const eyebrows = (html: string): string[] =>
  [...html.matchAll(/<p class="eyebrow">([^<]*)<\/p>/g)].map((match) =>
    match[1]!
  );

const hours = [{ day: "Monday", value: "Open 24 hours" }];

/*
 * Every block type the contract lets carry an eyebrow, in its minimum valid
 * shape. Driven off ONE list so a type that gains the field in the contract but
 * never gains a reader in the renderer fails here — a field with no reader is
 * the bug class that has already cost this repo three separate issues.
 */
const EYEBROW_BLOCKS: Record<string, Record<string, unknown>> = {
  rich_text: { heading: "Come as you are", paragraphs: [{ text: "Show up." }] },
  media_feature: {
    media_url: MEDIA[0]!.url,
    alt: "The room",
    heading: "The room",
    caption: "At night.",
    alignment: "left",
  },
  cta: { heading: "Order in", body: "Any hour.", label: "Order", href: "/menu" },
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
    note: "Served all day.",
    venue_id: null,
    sections: [{
      name: "Rice",
      description: null,
      items: [{
        id: U(4),
        name: "Coconut rice",
        description: null,
        price_minor: 850000,
        currency: "NGN",
      }],
    }],
  },
  gallery: {
    heading: "In the room",
    images: [MEDIA[1]],
  },
  video_feature: {
    heading: "Day or night",
    caption: "Open.",
    video_url: "/media/v1/video.mp4",
    poster_url: "/media/p1/960",
  },
  team: {
    heading: "Meet the team",
    caption: "",
    members: [{ name: "Meat police", role: null, media_url: null, alt: null }],
  },
  hours_location: {
    heading: "Open day and night",
    address: "69 Admiralty Way",
    map_url: null,
    hours,
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

describe("#3149 a section prints an eyebrow only when the brand wrote one", () => {
  for (const [type, fields] of Object.entries(EYEBROW_BLOCKS)) {
    it(`${type} prints the brand's eyebrow, and prints none without one`, () => {
      const withOne = render([{ type, eyebrow: "The place", ...fields }]);
      expect(eyebrows(withOne)).toContain("The place");

      /*
       * THE HALF THAT MATTERS. Before #3149 this render printed a fixed word,
       * so a brand that wrote nothing still got copy on its own website.
       */
      const without = render([{ type, ...fields }]);
      expect(eyebrows(without)).toEqual([]);
      expect(without).not.toContain('class="eyebrow"');
    });
  }

  it("renders no eyebrow for hero, divider or spacer, which cannot carry one", () => {
    const html = render([
      {
        type: "hero",
        heading: "Where Lagos comes to eat",
        subheading: "A 24/7 food house on Admiralty Way.",
        media_url: "/media/hero/1600",
        ctas: [],
      },
      { type: "divider" },
      { type: "spacer", size: "medium" },
    ]);
    expect(eyebrows(html)).toEqual([]);
  });

  it("still hides an eyebrow that only echoes the heading beneath it", () => {
    // #2830's finding, kept: the live page read "VISIT / VISIT". A brand can
    // still type the same words twice, and they are printed once.
    const html = render([
      { type: "gallery", eyebrow: "In the room", heading: "In the room",
        images: [{ url: "/media/g1/800", alt: "" }] },
    ]);
    expect(eyebrows(html)).toEqual([]);
    expect(html).toContain("<h2>In the room</h2>");
  });

  it("ignores case and surrounding space when comparing the two", () => {
    const html = render([
      { type: "gallery", eyebrow: "  IN THE ROOM  ", heading: "In the room",
        images: [{ url: "/media/g1/800", alt: "" }] },
    ]);
    expect(eyebrows(html)).toEqual([]);
  });

  it("prints the eyebrow trimmed, never the raw stored value", () => {
    const html = render([
      { type: "gallery", eyebrow: "  Photos  ", heading: "In the room",
        images: [{ url: "/media/g1/800", alt: "" }] },
    ]);
    expect(eyebrows(html)).toEqual(["Photos"]);
  });

  it("every one of these blocks is a block the CONTRACT accepts", () => {
    // Otherwise the fixtures above could drift into shapes that would never
    // survive publication, and the whole suite would prove nothing.
    for (const [type, fields] of Object.entries(EYEBROW_BLOCKS)) {
      expect(() =>
        assertRestaurantArtifact(
          artifactOf([{ type, eyebrow: "The place", ...fields }]),
        )
      ).not.toThrow();
    }
  });
});

/*
 * #3149 — a RUN of reels is one grid, and a grid gets one heading.
 */
const reel = (index: number, extra: Record<string, unknown> = {}) => ({
  type: "video_feature",
  ...extra,
  heading: `Film ${index}`,
  caption: null,
  video_url: `/media/v${index}/video.mp4`,
  poster_url: `/media/p${index}/960`,
}) as unknown as RestaurantBlock;

const gridSection = (html: string): string => {
  const found = html.match(/<section class="reel-grid">([\s\S]*?)<\/section>/);
  return found ? found[1]! : "";
};

describe("#3149 a run of reels is titled by its first film", () => {
  it("prints the group heading and its eyebrow inside the grid", () => {
    const html = render([
      reel(1, {
        eyebrow: "Straight from @gogilagos",
        group_heading: "The room, on any given night",
      }),
      reel(2),
      reel(3),
    ]);
    const grid = gridSection(html);
    expect(grid).not.toBe("");
    expect(grid).toContain("<h2>The room, on any given night</h2>");
    expect(grid).toContain('<p class="eyebrow">Straight from @gogilagos</p>');
    // All three films are still in the grid, and each keeps its own caption.
    expect(grid.match(/<figcaption>/g)).toHaveLength(3);
    expect(grid).toContain("<figcaption>Film 1</figcaption>");
  });

  it("renders the grid with NO heading when the first film supplies none", () => {
    // The behaviour every already-published site keeps.
    const html = render([reel(1), reel(2), reel(3)]);
    const grid = gridSection(html);
    expect(grid).not.toBe("");
    expect(grid).not.toContain("<h2>");
    expect(grid).not.toContain('class="eyebrow"');
    expect(grid.match(/<figcaption>/g)).toHaveLength(3);
  });

  it("reads the run's title off the FIRST film, never a later one", () => {
    const html = render([
      reel(1),
      reel(2, { group_heading: "Not this one" }),
      reel(3),
    ]);
    expect(gridSection(html)).not.toContain("Not this one");
  });

  it("a LONE reel is a feature, so its own eyebrow is what shows", () => {
    const html = render([
      reel(1, { eyebrow: "Admiralty Way", group_heading: "Unused here" }),
    ]);
    expect(html).not.toContain('class="reel-grid"');
    expect(eyebrows(html)).toEqual(["Admiralty Way"]);
    // A group heading on a film that never joined a group prints nothing.
    expect(html).not.toContain("Unused here");
  });

  it("the grid's heading is rendered OUTSIDE the films grid", () => {
    /*
     * #3149 wave 5 — REPLACED, because what this pinned was the defect.
     *
     * It read `styles.css` as text and required `.reel-grid-head` to declare
     * `grid-column: 1 / -1`. That declaration was added to stop the heading
     * taking the first film's column — a real bug — but it caused a second one:
     * `.reel-grid` laid its tracks with `auto-fit`, which collapses tracks
     * nothing occupies, and a child spanning every track means no track is ever
     * empty. Three films rendered in four columns with a hole on the right, and
     * this test called that correct.
     *
     * Both bugs come from the heading being a grid item AT ALL. It is not one
     * now: the films moved into `.reel-grid-films` and the heading is a sibling
     * of that container rather than an item inside it. Asserted here on the
     * rendered STRUCTURE, which is what this suite can see; the computed-CSS
     * half — that the films container is the grid and the heading occupies no
     * track — is measured in `wave5Parity.issue3149.test.tsx`.
     */
    const html = render([
      reel(1, { group_heading: "The room, on any given night" }),
      reel(2),
      reel(3),
    ]);
    const grid = gridSection(html);
    const films = grid.match(/<div class="reel-grid-films">([\s\S]*?)<\/div><\/section>|<div class="reel-grid-films">([\s\S]*)$/);
    expect(grid).toContain('<div class="reel-grid-films">');
    // The heading is before the films container, not inside it.
    expect(grid.indexOf('class="reel-grid-head"'))
      .toBeLessThan(grid.indexOf('class="reel-grid-films"'));
    expect(films).not.toBeNull();
    const inner = (films![1] ?? films![2])!;
    expect(inner).not.toContain("reel-grid-head");
    // All three films are inside it, and nothing else is.
    expect(inner.match(/<figure class="reel-card">/g)).toHaveLength(3);
  });
});

describe("#3149 the renderer writes no section copy of its own", () => {
  /*
   * Comments stripped: the notes in this file and in the renderer name the
   * exact labels that were removed, and a bare search would match the
   * explanation rather than the code. This trap has fired repeatedly on #2830.
   */
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "src/components/RestaurantV1.tsx"),
    "utf8",
  ).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

  it("hands the Eyebrow no literal label anywhere", () => {
    expect(source).not.toMatch(/<Eyebrow\s+label="/);
    for (
      const gone of ["Gallery", "Film", "Team", "Story", "Visit", "Book with Mingla"]
    ) {
      expect(source).not.toContain(`label="${gone}"`);
    }
  });

  it("every eyebrow it renders comes off the block", () => {
    const uses = [...source.matchAll(/<Eyebrow\s+label=\{([^}]*)\}/g)]
      .map((match) => match[1]!.trim());
    expect(uses.length).toBeGreaterThan(0);
    for (const use of uses) expect(use).toMatch(/\.eyebrow$/);
  });
});
