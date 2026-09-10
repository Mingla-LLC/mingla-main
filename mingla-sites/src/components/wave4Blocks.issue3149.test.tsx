/*
 * #3149 wave 4 — everything this wave adds, RENDERED, plus the promise that
 * nothing else moved.
 *
 * Two halves, and the second is the one that would otherwise go unchecked.
 *
 * The positive half executes the real renderer over an artifact the real
 * contract has accepted, because the failure this issue has produced three
 * times is a field with no reader: the CMS accepts it, the builder carries it,
 * and the page prints nothing.
 *
 * The negative half pins what a page that supplies NONE of it renders. Every
 * field in this wave is optional, so a site published yesterday must render
 * today exactly as it did — and "exactly" is asserted against pinned markup
 * rather than described. Those literals were taken by rendering the same
 * fixtures through `origin/main`'s renderer and diffing at character level:
 * across eleven blocks plus the header, footer and consent panel, the ONLY
 * difference the whole wave produces is the `video_feature` reorder pinned at
 * the bottom of this file, which is a deliberate restyle rather than a
 * regression.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RestaurantV1 } from "./RestaurantV1";
import type { RestaurantArtifact } from "../contracts/artifact";
import { assertRestaurantArtifact } from "../contracts/artifact";

const U = (n: number) => `aaaaaaaa-bbbb-4ccc-8ddd-${String(n).padStart(12, "0")}`;
const SITE = U(90);
const MEDIA = [80, 81, 82].map((n) => ({
  id: U(n),
  url: `/media/${U(n)}/960.webp`,
  alt: "",
  width: 960,
  height: 720,
  integrity: String(n).repeat(32),
  object_key: `approved/${SITE}/${U(n)}/960.webp`,
}));

function artifactOf(
  blocks: unknown[],
  pages?: unknown[],
): RestaurantArtifact {
  return {
    schema_version: 1,
    site_id: SITE,
    brand_id: U(91),
    publication_id: U(92),
    renderer_key: "restaurant-website-v1",
    renderer_version: 1,
    source_revision_id: U(93),
    source_digest: "a".repeat(64),
    generated_at: "2026-09-10T00:00:00Z",
    pages: pages ?? [{
      role: "home",
      slug: "home",
      title: "Home",
      enabled: true,
      nav_label: "Home",
      nav_order: 0,
      blocks,
    }],
    navigation: { page_roles: ["home"] },
    footer: { address: "69 Admiralty Way", links: [] },
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

const section = (html: string, className: string) => {
  const at = html.indexOf(`<section class="${className}"`);
  expect(at).toBeGreaterThan(-1);
  return html.slice(at, html.indexOf("</section>", at) + "</section>".length);
};

/* ── 1. The live pill ──────────────────────────────────────────────────── */

const HOURS_LIVE = {
  type: "hours_location",
  eyebrow: "Getting here",
  heading: "Visit gögi",
  address: "69 Admiralty Way, Lekki Phase 1, Lagos",
  always_open: true,
  timezone: "Africa/Lagos",
  hours: [{ day: "Monday", value: "Open 24 hours" }],
};

const HERO = {
  type: "hero",
  heading: "Where Lagos Comes to Eat",
  media_url: MEDIA[0]!.url,
  ctas: [],
};

describe("#3149 wave 4 the open-now pill is printed only where it is earned", () => {
  it("prints the claim, the city and a clock over the hero", () => {
    const html = render([HERO, HOURS_LIVE]);
    expect(html).toContain('class="open-pill"');
    expect(html).toContain('class="open-pill-dot"');
    // The city is READ OFF THE ZONE, never typed beside it, so the words and
    // the clock cannot disagree.
    expect(textOf(html)).toContain("Open now · — in Lagos");
  });

  it("ships an em dash, not the server's own minute", () => {
    /*
     * A server-rendered clock is the server's moment, cached, and would be
     * stale by however long the page sat in front of the reader. The real
     * minute arrives on mount — see `LocalClock`.
     */
    const html = render([HERO, HOURS_LIVE]);
    expect(html).toContain('<span class="local-clock">—</span>');
    expect(html).not.toMatch(/<time class="local-clock"/);
  });

  it("prints it in the hours card too, as the reference does", () => {
    const html = render([HERO, HOURS_LIVE]);
    expect(html).toContain('class="hours-live"');
    expect(textOf(html)).toContain("Now — in Lagos");
  });

  it("REFUSES to claim anything for a venue that only LOOKS always open", () => {
    /*
     * The hours below say "Open 24 hours" in words. That is a sentence, not a
     * schedule, and this is the whole reason the pill was refused twice: an
     * open/closed claim inferred from display strings is a claim nobody
     * checked.
     */
    const html = render([HERO, {
      ...HOURS_LIVE,
      always_open: undefined,
      timezone: undefined,
      hours: [{ day: "Every day", value: "Open 24 hours" }],
    }]);
    expect(html).not.toContain("open-pill");
    expect(html).not.toContain("hours-live");
    expect(html).not.toContain("local-clock");
    expect(textOf(html)).not.toContain("Open now");
  });

  it("refuses a declared always-open venue with no clock to read", () => {
    const html = render([HERO, { ...HOURS_LIVE, timezone: undefined }]);
    expect(html).not.toContain("open-pill");
    expect(html).not.toContain("hours-live");
  });

  it("refuses a timezone with no declaration that the place never closes", () => {
    const html = render([HERO, { ...HOURS_LIVE, always_open: undefined }]);
    expect(html).not.toContain("open-pill");
  });
});

/* ── 2. Team roles, subset and button ──────────────────────────────────── */

const TEAM = {
  type: "team",
  eyebrow: "The kitchen",
  heading: "Meet the team",
  members: [
    { name: "Madam Chief chef", role: "Kitchen" },
    { name: "Mix engineer", role: "Bar" },
    { name: "Fake chef", role: "Kitchen" },
  ],
};

describe("#3149 wave 4 the team carries roles and points at the rest", () => {
  it("prints the role ABOVE the name, in its own class", () => {
    const html = render([TEAM]);
    expect(html).toContain(
      '<span class="team-role">Kitchen</span><strong>Madam Chief chef</strong>',
    );
    expect(html).toContain(
      '<span class="team-role">Bar</span><strong>Mix engineer</strong>',
    );
  });

  it("shows the subset asked for and NOT the rest", () => {
    const html = render([{ ...TEAM, preview_count: 2 }]);
    expect(html).toContain("Madam Chief chef");
    expect(html).toContain("Mix engineer");
    expect(html).not.toContain("Fake chef");
  });

  it("prints the button under the grid when both halves are set", () => {
    const html = render([{
      ...TEAM,
      preview_count: 2,
      cta_label: "All ten of them",
      cta_href: "/about",
    }]);
    expect(html).toContain(
      '<a href="/about" class="button ghost team-cta">All ten of them</a>',
    );
  });

  it("prints NO button for half a button", () => {
    // A label with no destination does nothing; a destination with no label
    // has no accessible name.
    expect(render([{ ...TEAM, cta_label: "All ten of them" }]))
      .not.toContain("team-cta");
    expect(render([{ ...TEAM, cta_href: "/about" }])).not.toContain("team-cta");
  });

  it("shows everybody when no subset is asked for", () => {
    const html = render([TEAM]);
    expect(html).toContain("Fake chef");
    expect(html).not.toContain("team-cta");
  });
});

/* ── 3. The reel grid's button ─────────────────────────────────────────── */

const reel = (heading: string, extra: Record<string, unknown> = {}) => ({
  type: "video_feature",
  heading,
  video_url: "/media/x/video.mp4",
  poster_url: MEDIA[0]!.url,
  ...extra,
});

describe("#3149 wave 4 a run of films gets ONE button", () => {
  const html = render([
    reel("Coconut rice", {
      eyebrow: "Straight from @gogilagos",
      group_heading: "The room, on any given night",
      group_cta_label: "Follow @gogilagos",
      group_cta_href: "https://www.instagram.com/gogilagos/",
    }),
    reel("Pregame Friday"),
    reel("Outside gögi"),
  ]);

  it("prints it once, under the grid, spanning every column", () => {
    expect(html.split('class="reel-grid-cta"').length - 1).toBe(1);
    expect(html).toContain(
      '<a href="https://www.instagram.com/gogilagos/" class="button ghost" target="_blank" rel="noopener noreferrer">Follow @gogilagos',
    );
  });

  it("reads it off the FIRST film, so three films do not print three buttons", () => {
    expect(html.split("Follow @gogilagos").length - 1).toBe(1);
  });

  it("prints no button for a run whose first film named none", () => {
    const plain = render([reel("A"), reel("B")]);
    expect(plain).not.toContain("reel-grid-cta");
  });
});

/* ── 4. Stat cards ─────────────────────────────────────────────────────── */

describe("#3149 wave 4 a figure becomes a card", () => {
  const html = render([{
    type: "stats",
    eyebrow: "Why people keep coming back",
    heading: "No closing time",
    items: [
      {
        figure: "Open 24 hours",
        body: "Seven days a week, all year.",
        icon: "clock",
        highlight: true,
      },
      { figure: "Bowls that travel", body: "Jollof, fried, coconut.", icon: "bowl" },
      { figure: "Pregame Fridays", icon: "music" },
    ],
  }]);

  it("draws the icon ITSELF — no font, no file, no third party", () => {
    expect(html).toContain('<svg class="stat-icon"');
    expect(html.split('class="stat-icon"').length - 1).toBe(3);
    // Nothing is fetched to draw these.
    expect(html).not.toMatch(/<i class="fa/);
    expect(html).not.toMatch(/<svg[^>]*>\s*<image/);
  });

  it("hides the drawing from a screen reader, which already heard the figure", () => {
    expect(html).toContain('aria-hidden="true"');
    expect(html).toMatch(/<svg class="stat-icon"[^>]*aria-hidden="true"/);
  });

  it("prints the sentence under the figure", () => {
    expect(html).toContain('<dd class="stat-body">Seven days a week, all year.</dd>');
  });

  it("rings exactly the card that asked to be rung", () => {
    expect(html.split('class="stat-highlight"').length - 1).toBe(1);
  });

  it("prints a bare figure as a bare figure — no empty body, no stray icon", () => {
    const bare = render([{ type: "stats", items: [{ figure: "24/7" }] }]);
    expect(bare).toContain("<div><dt>24/7</dt></div>");
    expect(bare).not.toContain("stat-icon");
    expect(bare).not.toContain("stat-body");
    expect(bare).not.toContain("stat-highlight");
  });
});

/* ── 5. The menu taster ────────────────────────────────────────────────── */

const menuSection = (name: string, count: number) => ({
  name,
  items: Array.from({ length: count }, (unused, index) => ({
    id: U(100 + index),
    name: `${name} item ${index + 1}`,
    price_minor: 1_000_000 + index,
    currency: "NGN",
  })),
});

const MENU_PREVIEW = {
  type: "menu_preview",
  eyebrow: "The menu",
  heading: "What people order",
  note: "The full list runs from shawarma at ₦5,000.",
  section_limit: 2,
  item_limit: 2,
  images: MEDIA.slice(0, 2),
  cta_label: "Full menu & ordering",
  cta_href: "/menu",
  sections: [
    menuSection("Rice Bowls", 4),
    menuSection("Sides", 4),
    menuSection("Cocktails", 4),
  ],
};

describe("#3149 wave 4 the menu taster is the real menu, shown short", () => {
  const html = render([MENU_PREVIEW]);

  it("prints real dishes with real prices", () => {
    expect(html).toContain("Rice Bowls item 1");
    expect(html).toContain("₦10,000");
  });

  it("honours BOTH caps — sections and items", () => {
    expect(html).toContain("Rice Bowls");
    expect(html).toContain("Sides");
    expect(html).not.toContain("Cocktails");
    expect(html).toContain("Rice Bowls item 2");
    expect(html).not.toContain("Rice Bowls item 3");
  });

  it("CANNOT take an order — that belongs on the menu page", () => {
    expect(html).not.toContain("menu-toolbar");
    expect(html).not.toContain("cart-btn");
    expect(html).not.toContain("menu-qty");
  });

  it("prints the photographs beside the dishes, and the button under them", () => {
    expect(html).toContain('class="menu-preview-photos"');
    expect(html.split('class="menu-preview-photos"').length - 1).toBe(1);
    expect(html).toContain("Full menu &amp; ordering");
  });

  it("leaves the menu page's own board untouched — cart and all", () => {
    const board = render([{
      type: "menu_board",
      heading: "The menu",
      venue_id: U(70),
      sections: [menuSection("Rice Bowls", 2)],
    }]);
    expect(board).toContain("menu-board");
    expect(board).not.toContain("menu-preview");
  });

  it("does not claim the header's bag or its Order now", () => {
    /*
     * Pages are searched in nav order, so a taster on the HOME page would win
     * the "which page can be ordered from" search if it looked orderable —
     * and the bag's "view menu" link would send a shopper back to the page
     * they were already on.
     */
    const pages = [
      {
        role: "home",
        slug: "home",
        title: "Home",
        enabled: true,
        nav_label: "Home",
        nav_order: 0,
        blocks: [HERO, MENU_PREVIEW],
      },
      {
        role: "menu",
        slug: "menu",
        title: "Menu",
        enabled: true,
        nav_label: "Menu",
        nav_order: 1,
        blocks: [{
          type: "menu_board",
          heading: "The menu",
          venue_id: U(70),
          sections: [menuSection("Rice Bowls", 2)],
        }],
      },
    ];
    const artifact = artifactOf([], pages);
    (artifact as unknown as { navigation: { page_roles: string[] } })
      .navigation = { page_roles: ["home", "menu"] };
    assertRestaurantArtifact(artifact);
    const html = renderToStaticMarkup(
      <RestaurantV1 artifact={artifact} page={artifact.pages[0]!} />,
    );
    expect(html).toContain('href="/menu" class="header-action accent"');
    expect(html).not.toContain('href="/" class="header-action accent"');
  });
});

/* ── 6. The story composite ────────────────────────────────────────────── */

const STORY = {
  type: "media_feature",
  eyebrow: "The place",
  media_url: MEDIA[1]!.url,
  alt: "A gögi bowl of coconut rice",
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
};

describe("#3149 wave 4 the story is one composite", () => {
  const html = render([STORY]);

  it("crops the photograph round and prints the badge on it", () => {
    expect(html).toContain('class="editorial-media editorial-media-circle"');
    expect(html).toContain(
      '<span class="media-badge"><strong>24/7</strong><span>ALWAYS ON</span></span>',
    );
  });

  it("keeps the quotation INSIDE the section, with its bar and its source", () => {
    const composite = section(html, "feature editorial-feature");
    expect(composite).toContain('class="pull-quote feature-quote"');
    expect(composite).toContain("<blockquote><p>Show up exactly as you are.</p></blockquote>");
    expect(composite).toContain("<figcaption>gögi, on Instagram</figcaption>");
  });

  it("prints the button at its foot", () => {
    expect(html).toContain(
      '<a href="/about" class="button ghost feature-cta">More about gögi</a>',
    );
  });

  it("prints a badge label ONLY under a badge figure", () => {
    const html = render([{ ...STORY, badge_figure: undefined }]);
    expect(html).not.toContain("media-badge");
    expect(html).not.toContain("ALWAYS ON");
  });
});

/* ── 7. The map paints, from this origin ───────────────────────────────── */

const MAP = {
  type: "map_embed",
  heading: "Admiralty Way",
  latitude: 6.4471033,
  longitude: 3.4680182,
  place_label: "Admiralty Way, Lekki Phase 1, Lagos",
};

describe("#3149 wave 4 the map is drawn on first paint and contacts nobody", () => {
  const html = render([MAP]);

  it("paints a map WITHOUT anyone pressing anything", () => {
    expect(html).toContain('class="map-static"');
    expect(html).toContain('class="map-static-pin"');
    expect(html).toMatch(/<img [^>]*src="\/map\/16\/\d+\/\d+"/);
  });

  it("serves every square from THIS ORIGIN — zero third-party requests", () => {
    /*
     * The whole point. Every tile is a relative path answered by this app's
     * own route; nothing in the markup names a host the browser would go out
     * to. The wave 3 promise is unchanged and asserted the same way.
     */
    const sources = [...html.matchAll(/src="([^"]+)"/g)].map((match) => match[1]!);
    expect(sources.length).toBeGreaterThan(4);
    for (const source of sources) expect(source.startsWith("/")).toBe(true);
    expect(html).not.toContain("<iframe");
    expect(html).not.toMatch(/(?:src|href)="[^"]*openstreetmap\.org/);
    expect(html).not.toContain("tile.openstreetmap.org");
  });

  it("names the whole grid ONCE, rather than fifteen unlabelled images", () => {
    expect(html).toContain(
      '<div class="map-static" role="img" aria-label="Map of Admiralty Way, Lekki Phase 1, Lagos">',
    );
    for (const alt of [...html.matchAll(/<img [^>]*src="\/map\/[^"]+"[^>]*alt="([^"]*)"/g)]) {
      expect(alt[1]).toBe("");
    }
  });

  it("still offers the interactive map behind a control that names the host", () => {
    expect(textOf(html)).toContain("Show the map");
    expect(textOf(html)).toContain("loaded from openstreetmap.org");
  });

  it("draws NOTHING for a coordinate that is not a number", () => {
    const artifact = artifactOf([{ ...MAP, latitude: null }]);
    const html = renderToStaticMarkup(
      <RestaurantV1 artifact={artifact} page={artifact.pages[0]!} />,
    );
    expect(html).not.toContain("map-static");
    expect(html).not.toContain("/map/16/");
  });
});

/* ── 8. Nothing else moved ─────────────────────────────────────────────── */

describe("#3149 wave 4 a page supplying NONE of it renders as it always did", () => {
  it("renders the stats row exactly as origin/main did", () => {
    const html = render([{
      type: "stats",
      eyebrow: "Why people keep coming back",
      heading: "No closing time",
      body: "Three things.",
      items: [
        { figure: "Open 24 hours", label: "Seven days a week." },
        { figure: "Bowls that travel" },
      ],
    }]);
    expect(section(html, "stats")).toBe(
      '<section class="stats"><p class="eyebrow">Why people keep coming back</p>' +
        "<h2>No closing time</h2><p class=\"stats-lead\">Three things.</p>" +
        '<dl class="stats-row"><div><dt>Open 24 hours</dt><dd>Seven days a week.</dd></div>' +
        "<div><dt>Bowls that travel</dt></div></dl></section>",
    );
  });

  it("renders a role-less team exactly as origin/main did", () => {
    const html = render([{
      type: "team",
      eyebrow: "The kitchen",
      heading: "Meet the team",
      caption: "We won a lottery.",
      members: [{ name: "Fake chef" }],
    }]);
    expect(section(html, "team")).toBe(
      '<section class="team"><p class="eyebrow">The kitchen</p><h2>Meet the team</h2>' +
        '<p>We won a lottery.</p><ul class="team-grid"><li>' +
        '<span class="team-initial" aria-hidden="true">F</span>' +
        "<strong>Fake chef</strong></li></ul></section>",
    );
  });

  it("renders a plain image feature exactly as origin/main did", () => {
    const html = render([{
      type: "media_feature",
      eyebrow: "The place",
      media_url: MEDIA[1]!.url,
      alt: "The room",
      heading: "Come as you are",
      caption: "Show up exactly as you are.",
      alignment: "left",
    }]);
    expect(section(html, "feature editorial-feature")).toBe(
      '<section class="feature editorial-feature"><div class="editorial-media">' +
        `<img src="${MEDIA[1]!.url}" alt="The room" width="960" height="720"/></div>` +
        '<div><p class="eyebrow">The place</p><h2>Come as you are</h2>' +
        "<p>Show up exactly as you are.</p></div></section>",
    );
  });

  it("renders an hours block with no live fields exactly as origin/main did", () => {
    const html = render([{
      type: "hours_location",
      eyebrow: "Getting here",
      heading: "Visit gögi",
      address: "69 Admiralty Way, Lekki Phase 1, Lagos",
      hours: [{ day: "Monday", value: "Open 24 hours" }],
    }]);
    expect(section(html, "feature")).toBe(
      '<section class="feature"><div><p class="eyebrow">Getting here</p>' +
        "<h2>Visit gögi</h2><p>69 Admiralty Way, Lekki Phase 1, Lagos</p></div>" +
        '<div class="hours"><p><strong>Monday</strong>' +
        "<span>Open 24 hours</span></p></div></section>",
    );
  });

  it("emits none of this wave's class names for a page that asked for none", () => {
    const html = render([
      HERO,
      { type: "pull_quote", quote: "Find gögi." },
      { type: "gallery", heading: "In the room", images: MEDIA },
    ]);
    for (
      const token of [
        "open-pill",
        "local-clock",
        "hours-live",
        "team-role",
        "team-cta",
        "reel-grid-cta",
        "stat-icon",
        "stat-body",
        "stat-highlight",
        "menu-preview",
        "media-badge",
        "editorial-media-circle",
        "feature-quote",
        "feature-cta",
        "map-static",
      ]
    ) {
      expect(html).not.toContain(token);
    }
  });

  /*
   * THE ONE DELIBERATE EXCEPTION, pinned so it cannot grow quietly.
   *
   * A single film is now full width with its words over it, which is item 5 of
   * this wave and applies to every site rather than only to one that opted in.
   * The copy moved from before the poster into a wrapper after it — that is
   * the entire difference, and this is what it looks like.
   */
  it("moves the single film's copy over the film, and changes nothing else about it", () => {
    const html = render([{
      type: "video_feature",
      eyebrow: "Admiralty Way",
      heading: "Day or night",
      caption: "Their line.",
      video_url: "/media/x/video.mp4",
      poster_url: MEDIA[0]!.url,
    }]);
    expect(section(html, "video-feature")).toBe(
      '<section class="video-feature"><button type="button" class="reel-poster" ' +
        `style="background-image:url(${MEDIA[0]!.url})">` +
        '<span class="reel-play" aria-hidden="true">▶</span>' +
        '<span class="sr-only">Play: Day or night</span></button>' +
        '<div class="video-feature-copy"><p class="eyebrow">Admiralty Way</p>' +
        '<h2>Day or night</h2><p class="video-caption">Their line.</p></div></section>',
    );
  });
});

/* ── 9. The sixth page role ────────────────────────────────────────────── */

const pageOf = (
  role: string,
  navOrder: number,
  blocks: unknown[] = [{ type: "pull_quote", quote: "Find gögi." }],
) => ({
  role,
  slug: role === "home" ? "home" : role,
  title: role,
  enabled: true,
  nav_label: role,
  nav_order: navOrder,
  blocks,
});

describe("#3149 wave 4 the sixth page role", () => {
  const sixPages = [
    pageOf("home", 0, [HERO]),
    pageOf("about", 1),
    pageOf("menu", 2),
    pageOf("gallery", 3),
    pageOf("contact", 4),
    pageOf("reservations", 5, [{
      type: "venue_reservation",
      eyebrow: "Come through",
      heading: "Book a table at gögi",
      body: "gögi is walk-in and always open.",
      // #3149 wave 5 — the venue's PUBLIC page, which is where a booking
      // actually starts. `/reserve/{brand_id}` is a payment-RETURN surface.
      url: "https://host.usemingla.com/b/gogilagos/v/gogi",
    }]),
  ];

  const withPages = (pages: unknown[]) => {
    const artifact = artifactOf([], pages);
    (artifact as unknown as { navigation: { page_roles: string[] } }).navigation =
      { page_roles: (pages as { role: string }[]).map((page) => page.role) };
    return artifact;
  };

  it("A FIVE-PAGE SITE STILL VALIDATES — the cap moved, nothing else did", () => {
    const five = withPages(sixPages.slice(0, 5));
    expect(() => assertRestaurantArtifact(five)).not.toThrow();
  });

  it("a five-page site renders a five-item navigation, unchanged", () => {
    const five = withPages(sixPages.slice(0, 5));
    assertRestaurantArtifact(five);
    const html = renderToStaticMarkup(
      <RestaurantV1 artifact={five} page={five.pages[0]!} />,
    );
    expect(html.split('aria-label="Main navigation"').length - 1).toBe(1);
    expect(html).not.toContain("reservations");
    expect(
      [...html.matchAll(/<nav aria-label="Main navigation">(.*?)<\/nav>/g)][0]![1]!
        .split("</a>").length - 1,
    ).toBe(5);
  });

  it("accepts six pages and routes the sixth", () => {
    const six = withPages(sixPages);
    expect(() => assertRestaurantArtifact(six)).not.toThrow();
    const html = renderToStaticMarkup(
      <RestaurantV1 artifact={six} page={six.pages[5]!} />,
    );
    expect(html).toContain('href="/reservations"');
    expect(html).toContain(
      'href="https://host.usemingla.com/b/gogilagos/v/gogi"',
    );
    expect(html).not.toContain("/reserve/");
    expect(textOf(html)).toContain("Book a table at gögi");
  });

  it("still refuses a SEVENTH page and an unknown role", () => {
    expect(() =>
      assertRestaurantArtifact(withPages([...sixPages, pageOf("bookings", 5)]))
    ).toThrow();
    expect(() =>
      assertRestaurantArtifact(withPages([pageOf("home", 0), pageOf("bookings", 1)]))
    ).toThrow(/ARTIFACT_PAGE_ROLE_MISMATCH/);
  });

  it("still refuses a nav_order past the last position", () => {
    expect(() =>
      assertRestaurantArtifact(withPages([pageOf("home", 0), pageOf("about", 6)]))
    ).toThrow(/ARTIFACT_PAGE_ROLE_MISMATCH/);
  });
});
