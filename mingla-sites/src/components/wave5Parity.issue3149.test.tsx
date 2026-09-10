// @vitest-environment jsdom
/*
 * #3149 wave 5 — five parity defects, MEASURED against the real stylesheet.
 *
 * Every one of these shipped green. The suites that covered this code read the
 * artifacts as TEXT: one pinned `grid-column: 1 / -1` as the correct reel-grid
 * mechanism, which is the very declaration that caused the empty column, and
 * two pinned a booking URL that lands on a cancellation notice. A string that
 * matches the source proves the source says what it says. It proves nothing
 * about what a browser does with it.
 *
 * So nothing here greps. Each test renders the REAL component, injects the REAL
 * `styles.css`, and reads `getComputedStyle` — the cascade resolved, duplicate
 * declarations and all, which matters in a stylesheet that declares `.hero`,
 * `.button`, `.gallery` and (until this wave) `.cart-count` more than once.
 *
 * WHAT JSDOM CANNOT DO, AND HOW THAT IS HANDLED. jsdom has no layout engine:
 * every `getBoundingClientRect()` is zero and `auto-fit` never resolves to a
 * track count. Two consequences, both dealt with head-on rather than asserted
 * around:
 *
 *   - the reel grid is proven by its PRECONDITION — that no child of the grid
 *     spans every track — which is the exact mechanism `auto-fit` needs and the
 *     exact thing that was false.
 *   - the cart badge is proven ARITHMETICALLY from resolved values. The badge
 *     is anchored so its bottom edge lands on the glyph's top edge, which makes
 *     the separation independent of how wide the badge grows, so one comparison
 *     covers a one-, two- and three-character count.
 *
 * Both were re-measured in a real browser against the live page; the figures
 * are recorded per test.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import fs from "node:fs";
import path from "node:path";
import { RestaurantV1 } from "./RestaurantV1";
import type { RestaurantArtifact, RestaurantBlock } from "../contracts/artifact";

const CSS = fs.readFileSync(
  path.resolve(process.cwd(), "src/app/styles.css"),
  "utf8",
);

const U = (n: number) => `aaaaaaaa-bbbb-4ccc-8ddd-${String(n).padStart(12, "0")}`;
const SITE = U(90);
const MEDIA = [80, 81, 82, 83].map((n) => ({
  id: U(n),
  url: `/media/${U(n)}/960.webp`,
  alt: "A dish",
  width: 960,
  height: 960,
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

const render = (blocks: unknown[]): string => {
  const artifact = artifactOf(blocks);
  return renderToStaticMarkup(
    <RestaurantV1 artifact={artifact} page={artifact.pages[0]!} />,
  );
};

/* Mounts markup under the real stylesheet and hands back the document. */
function mount(html: string): Document {
  document.head.innerHTML = "";
  document.body.innerHTML = html;
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);
  return document;
}

const px = (value: string): number => Number.parseFloat(value);

const reel = (index: number, extra: Record<string, unknown> = {}) => ({
  type: "video_feature",
  ...extra,
  heading: `Film ${index}`,
  caption: null,
  video_url: `/media/v${index}/video.mp4`,
  poster_url: `/media/p${index}/960`,
}) as unknown as RestaurantBlock;

const MENU_PREVIEW = {
  type: "menu_preview",
  heading: "What people order",
  note: null,
  sections: [{
    name: "Rice Bowls",
    description: null,
    items: [{ id: U(4), name: "Jollof Rice", description: null, price_minor: 1_000_000, currency: "NGN" }],
  }],
  images: MEDIA.map((item) => ({ url: item.url, alt: item.alt })),
};

const TEAM = {
  type: "team",
  heading: "The team",
  caption: null,
  members: MEDIA.slice(0, 3).map((item, index) => ({
    name: `Person ${index}`,
    role: "Chef",
    media_url: item.url,
    alt: item.alt,
  })),
};

/* ──────────────────────────────────────────────────────────────────────────
 * FIX 1 — an <img> that declares an aspect ratio must also declare a height.
 *
 * fails-on-revert verified at db7e04a38 (all five fixes reverted, these tests
 * kept): all 3 tests in this group fail, each with the computed height reading
 * "" instead of "auto".
 *
 * The renderer emits `<img width="640" height="640">` and `<img width="480"
 * height="480">`. Those attributes are presentational hints the UA maps to real
 * width/height declarations, and a used height of 640px beats `aspect-ratio`.
 * Measured live on gogi.sites.usemingla.com at a 1440px viewport BEFORE the
 * fix: a menu photo rendered 251x640 in a 251px column and the photo half of
 * the menu split stood 1296px tall beside a 458px list — 838px of overflow. A
 * team portrait rendered 164x480 in a 164px column, stacking a 1089px grid.
 * ────────────────────────────────────────────────────────────────────────── */
describe("#3149 wave 5 an aspect ratio only works if a height is given back", () => {
  it("EVERY rendered image that sets an aspect ratio also resolves a height", () => {
    /*
     * The general invariant, not a list of two selectors — a sixth image rule
     * added later is covered by this without anyone remembering to come back.
     *
     * It is asserted on COMPUTED style over a fully rendered page, so a rule
     * that supplies the height from somewhere else in the cascade passes
     * honestly: `.editorial-media-circle img` sets `aspect-ratio` and no
     * height, and is correct, because `.feature img` around it sets
     * `height: auto`. A per-rule text check would have failed that one and
     * taught the next person to delete the assertion.
     */
    mount(render([
      MENU_PREVIEW,
      TEAM,
      {
        type: "media_feature",
        media_url: MEDIA[0]!.url,
        alt: "The room",
        heading: "The room",
        caption: "At night.",
        alignment: "left",
      },
    ]));
    const images = [...document.querySelectorAll("img")];
    expect(images.length).toBeGreaterThan(4);
    const offenders = images
      .filter((img) => {
        const computed = getComputedStyle(img);
        return computed.aspectRatio !== "" && computed.aspectRatio !== "auto" &&
          computed.height === "";
      })
      .map((img) => img.parentElement?.className ?? "?");
    expect(offenders).toEqual([]);
  });

  it("a menu preview photo is square, not the 640px its attribute asked for", () => {
    mount(render([MENU_PREVIEW]));
    const img = document.querySelector(".menu-preview-photos img")!;
    // The attribute that caused it is still there — it is what reserves the box
    // before the file arrives, and removing it was never the fix.
    expect(img.getAttribute("height")).toBe("640");
    const computed = getComputedStyle(img);
    expect(computed.height).toBe("auto");
    expect(computed.aspectRatio).toBe("1");
  });

  it("a team portrait is square, not the 480px its attribute asked for", () => {
    mount(render([TEAM]));
    const img = document.querySelector(".team-grid img")!;
    expect(img.getAttribute("height")).toBe("480");
    const computed = getComputedStyle(img);
    expect(computed.height).toBe("auto");
    expect(computed.aspectRatio).toBe("1");
  });
});

/* ──────────────────────────────────────────────────────────────────────────
 * FIX 2 — the films own the grid, and nothing in it spans every track.
 *
 * fails-on-revert verified at db7e04a38 (all five fixes reverted, these tests
 * kept): 5 of the 7 tests in this group fail — the spanning-child test naming
 * `reel-grid-head` and `reel-grid-cta`, the rest with the films container
 * absent. Two still pass, both correctly: a lone reel never went through the
 * grid at all, and `.reel-grid .reel-card` matches with or without a wrapper
 * between them — which is exactly why that one is worth keeping.
 *
 * Measured live BEFORE the fix at a 1440px viewport: 3 films laid out in FOUR
 * 253.203px columns, with the heading and the button each 1085px wide because
 * each spanned all four. `auto-fit` collapses empty tracks and there was never
 * an empty one to collapse.
 * ────────────────────────────────────────────────────────────────────────── */
describe("#3149 wave 5 the reel grid holds films and nothing else", () => {
  it("the films container is the grid, and the section is not", () => {
    mount(render([
      reel(1, { group_heading: "The room, on any given night", group_cta_label: "Follow", group_cta_href: "https://instagram.com/gogilagos" }),
      reel(2),
      reel(3),
    ]));
    const section = document.querySelector(".reel-grid")!;
    const films = document.querySelector(".reel-grid-films")!;
    expect(films).not.toBeNull();
    expect(films.parentElement).toBe(section);
    expect(getComputedStyle(films).display).toBe("grid");
    expect(getComputedStyle(films).gridTemplateColumns).toContain("auto-fit");
    // The section is a column of head / films / button — NOT a track grid.
    expect(getComputedStyle(section).display).not.toBe("grid");
  });

  it("NO child of the grid spans every column — the auto-fit precondition", () => {
    /*
     * THE ASSERTION THAT MATTERS. `auto-fit` collapses tracks nothing occupies;
     * a child carrying `grid-column: 1 / -1` occupies all of them, so no track
     * is ever empty and the count never falls to the number of films. Both the
     * heading and the button used to be such children.
     */
    mount(render([
      reel(1, { group_heading: "The room, on any given night", group_cta_label: "Follow", group_cta_href: "https://instagram.com/gogilagos" }),
      reel(2),
      reel(3),
    ]));
    const films = document.querySelector(".reel-grid-films")!;
    const spanners = [...films.children]
      .filter((child) => {
        const column = getComputedStyle(child).gridColumn;
        return column !== "" && column !== "auto" && column !== "auto / auto";
      })
      .map((child) => child.className);
    expect(spanners).toEqual([]);
  });

  it("the grid contains exactly the films — the head and button are outside it", () => {
    mount(render([
      reel(1, { group_heading: "The room", group_cta_label: "Follow", group_cta_href: "https://instagram.com/gogilagos" }),
      reel(2),
      reel(3),
    ]));
    const films = document.querySelector(".reel-grid-films")!;
    expect([...films.children].map((child) => child.className)).toEqual([
      "reel-card", "reel-card", "reel-card",
    ]);
    // Both are still rendered, and still inside the section — just not in the grid.
    const section = document.querySelector(".reel-grid")!;
    expect(section.querySelector(".reel-grid-head")!.parentElement).toBe(section);
    expect(section.querySelector(".reel-grid-cta")!.parentElement).toBe(section);
  });

  it("the track count follows the film count, at 3 and at 2", () => {
    for (const count of [3, 2]) {
      mount(render(
        Array.from({ length: count }, (_, index) => reel(index + 1, index === 0 ? { group_heading: "The room" } : {})),
      ));
      const films = document.querySelector(".reel-grid-films")!;
      expect(films.children).toHaveLength(count);
      expect([...films.children].every((child) => child.className === "reel-card")).toBe(true);
    }
  });

  it("a LONE reel is still a feature, never a one-card grid", () => {
    const html = render([reel(1, { group_heading: "Unused" })]);
    expect(html).not.toContain('class="reel-grid"');
    expect(html).not.toContain("reel-grid-films");
  });

  it("the head no longer carries the span that caused it", () => {
    mount(render([reel(1, { group_heading: "The room" }), reel(2), reel(3)]));
    const head = document.querySelector(".reel-grid-head")!;
    expect(getComputedStyle(head).gridColumn).not.toBe("1 / -1");
    // And it is not a grid item at all any more.
    expect(getComputedStyle(head.parentElement!).display).not.toBe("grid");
  });

  it("the card, poster, caption and play rules still reach through the wrapper", () => {
    /*
     * `.reel-grid .reel-card` and friends are DESCENDANT selectors, so inserting
     * a container between them must not break them. Cheap to assert, and the
     * whole restructure would be a silent visual regression if it did.
     */
    mount(render([reel(1, { group_heading: "The room" }), reel(2), reel(3)]));
    const card = document.querySelector(".reel-grid .reel-card")!;
    expect(getComputedStyle(card).display).toBe("grid");
    expect(getComputedStyle(card).margin).toBe("0px");
    const caption = document.querySelector(".reel-grid figcaption")!;
    expect(getComputedStyle(caption).textTransform).toBe("uppercase");
  });
});

/* ──────────────────────────────────────────────────────────────────────────
 * FIX 4 — the count badge must not cover the bag it counts.
 *
 * fails-on-revert verified at db7e04a38 (all five fixes reverted, these tests
 * kept): 5 of the 6 tests in this group fail — each occlusion case with a badge
 * bottom of 28px against a glyph top of 12px, and both collision tests with the
 * pill reading `position: absolute`. The 44px tap-target test still passes,
 * correctly: the button itself was never the defect.
 *
 * Measured live BEFORE the fix at a 1440px viewport: button 44x44 at (1107,21),
 * glyph 20x20 at (1119,33), badge 24x24 at (1125,25) — a 14x16 intersection,
 * 224px² over a 400px² glyph, 56% of the bag covered across its middle.
 *
 * ROOT CAUSE, and why the markup here is a fixture. `.cart-count` was declared
 * twice for two different components — this corner badge and the inline pill in
 * the menu page's `.cart-btn` — and neither was scoped, so both components
 * rendered the union of both rules and BOTH were wrong. `HeaderCart` only emits
 * the badge once a client-side cart has items, so the exact live markup is
 * pinned here instead.
 * ────────────────────────────────────────────────────────────────────────── */
const CART_BUTTON = (count: string) =>
  `<button type="button" class="header-cart" aria-label="Your order, ${count} items" aria-expanded="false">` +
  `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">` +
  `<path d="M6 8h12l-1 12H7L6 8Zm3 0V6a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" stroke-width="1.6"></path>` +
  `</svg><span class="cart-count" aria-hidden="true">${count}</span></button>`;

describe("#3149 wave 5 the cart badge sits on the corner, not on the glyph", () => {
  it.each([["4"], ["12"], ["99+"]])(
    "does not overlap the glyph at a count of %s",
    (count) => {
      mount(CART_BUTTON(count));
      const button = document.querySelector(".header-cart")!;
      const badge = document.querySelector(".cart-count")!;
      const svg = document.querySelector(".header-cart svg")!;

      const buttonBox = px(getComputedStyle(button).height);
      const glyph = Number(svg.getAttribute("height"));
      expect(buttonBox).toBe(44);
      expect(glyph).toBe(20);

      // The glyph is centred by the button's own flex centring.
      const glyphTop = (buttonBox - glyph) / 2;

      const badgeStyle = getComputedStyle(badge);
      expect(badgeStyle.position).toBe("absolute");
      const badgeTop = px(badgeStyle.top);
      const badgeHeight = px(badgeStyle.height);

      /*
       * WIDTH-INDEPENDENT ON PURPOSE. The badge grows leftwards from `right` as
       * the count gains characters, so any assertion resting on its width would
       * hold at "4" and quietly stop holding at "99+". A box whose bottom edge
       * never descends past the glyph's top edge cannot intersect it at ANY
       * width — so this one comparison covers every count.
       */
      expect(badgeTop + badgeHeight).toBeLessThanOrEqual(glyphTop);

      // And it is still legible: a real disc, not a hairline.
      expect(badgeHeight).toBeGreaterThanOrEqual(16);
      expect(px(badgeStyle.fontSize)).toBeGreaterThanOrEqual(10);
    },
  );

  it("the 44px tap target is untouched by the re-anchor", () => {
    mount(CART_BUTTON("4"));
    const style = getComputedStyle(document.querySelector(".header-cart")!);
    expect(style.width).toBe("44px");
    expect(style.height).toBe("44px");
    expect(style.position).toBe("relative");
  });

  it("the menu cart's pill is an inline pill again, not an absolute badge", () => {
    /*
     * The other half of the collision. This span sits after the words "Your
     * order" inside `.cart-btn`; the header rule's `position: absolute` tore it
     * out of flow and pinned it to that button's corner. Measured live BEFORE
     * the fix: a 24x24 badge at (278,838) inside a 126x50 button at (178,834) —
     * out of flow, so the button's width never accounted for it.
     */
    mount(
      `<button type="button" class="cart-btn">Your order<span class="cart-count">4</span></button>`,
    );
    const pill = getComputedStyle(document.querySelector(".cart-btn .cart-count")!);
    /*
     * Not `toBe("static")`: jsdom reports "" for a property no rule declares,
     * which is precisely the state wanted here — nothing positions this span,
     * so the initial value applies and it stays in flow. What must never be
     * true is that something absolutely positions it.
     */
    expect(pill.position).not.toBe("absolute");
    expect(pill.display).toBe("inline-grid");
  });

  it("neither cart rule can reach the other component", () => {
    // Both fixtures in ONE document: whichever rule is unscoped shows up here.
    mount(
      CART_BUTTON("4") +
      `<button type="button" class="cart-btn">Your order<span class="cart-count">4</span></button>`,
    );
    const header = getComputedStyle(document.querySelector(".header-cart .cart-count")!);
    const pill = getComputedStyle(document.querySelector(".cart-btn .cart-count")!);
    expect(header.position).toBe("absolute");
    expect(pill.position).not.toBe("absolute");
    expect(header.height).not.toBe(pill.height);
  });
});

/* ──────────────────────────────────────────────────────────────────────────
 * FIX 5 — the breadcrumbs sit on one line.
 *
 * fails-on-revert verified at db7e04a38 (all five fixes reverted, these tests
 * kept): the alignment test fails with the computed value reading "normal".
 * The align-self test still passes, correctly: no child ever opted out — the
 * container was the whole defect.
 *
 * Measured live BEFORE the fix at a 1440px viewport: `.crumbs` was
 * `display: flex` with `align-items: normal`, so all three children were
 * stretched to the row's 44px. The `<a>` is itself a centred flex box carrying
 * the 44px tap target, so its text centred; the "/" and the current page are
 * plain blocks, so theirs sat at the top. Text tops were 295.9, 283.0 and
 * 283.0 — "Home" rendered 12.9px below the other two on one line.
 * ────────────────────────────────────────────────────────────────────────── */
describe("#3149 wave 5 the breadcrumb reads as one line", () => {
  const CRUMBS =
    `<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a>` +
    `<span aria-hidden="true">/</span><span aria-current="page">Menu</span></nav>`;

  it("centres its children on the cross axis", () => {
    mount(CRUMBS);
    const style = getComputedStyle(document.querySelector(".crumbs")!);
    expect(style.display).toBe("flex");
    expect(style.alignItems).toBe("center");
  });

  it("no child opts out of that alignment", () => {
    /*
     * `align-items` on the row is only the mechanism while no child overrides
     * it with `align-self`. A future rule that did would silently restore the
     * misalignment, and the container assertion above would still pass.
     */
    mount(CRUMBS);
    const crumbs = document.querySelector(".crumbs")!;
    const optedOut = [...crumbs.children]
      .map((child) => getComputedStyle(child).alignSelf)
      .filter((value) => value !== "" && value !== "auto");
    expect(optedOut).toEqual([]);
  });
});

/* ──────────────────────────────────────────────────────────────────────────
 * FIX 6 — the section reaches the page edges; its CONTENT is what is capped.
 *
 * fails-on-revert verified at 43a2f0c73 (all seven fixes reverted, these tests
 * kept): all 4 tests in this group fail — three on the section geometry, one on
 * `.cta` still carrying the `!important` overrides.
 *
 * `.page-content > section` set `width: min(100%, 1200px)`, capping the SECTION
 * BOX, so each section's own background — the hero photograph, the dark bands,
 * the video — stopped at 1200px and left bare page down both sides. Measured
 * live BEFORE the fix: every section x=120 w=1200 at a 1440 viewport (120px bare
 * each side) and x=360 w=1200 at 1920 (360px bare each side). The `@media
 * (min-width: 1440px) { max-width: 1200px }` on the same selector was redundant
 * — the base rule was already capping the box at every width, including 1280,
 * where the section sat at x=40.
 *
 * Measured live AFTER, against the reference at the same widths:
 *
 *   viewport  ours (section x/width, content)   reference (section, wrap)
 *   1920      0 / 1920, 1200                    0 / 1920, 1200
 *   1440      0 / 1440, 1200                    0 / 1440, 1200
 *   1280      0 / 1280, 1178                    0 / 1280, 1200
 *   768       0 /  768,  707  (unchanged)       0 /  768,  728
 *
 * `document.scrollWidth` equals the viewport at all four, so nothing overflows.
 * The 1280 and 768 content widths keep OUR 4vw gutter rather than adopting the
 * reference's flat 20px — the defect being fixed is the section box, and
 * re-cutting every gutter is a separate decision.
 *
 * jsdom has no layout, so what is asserted here is the CASCADE that produces
 * that geometry — which declaration wins on the real box — and the numbers above
 * are the real-browser proof of what the cascade then does.
 * ────────────────────────────────────────────────────────────────────────── */
describe("#3149 wave 5 a section is full-bleed and holds its content to a column", () => {
  const SECTION = `<div class="page-content"><section class="feature"></section></div>`;

  it("does not cap the section box", () => {
    mount(SECTION);
    const style = getComputedStyle(document.querySelector("section")!);
    // Was `min(100%, 1200px)` — the cap that stopped every background.
    expect(style.width).toBe("100%");
    expect(style.maxWidth).not.toBe("1200px");
  });

  it("centres the content with padding instead", () => {
    /*
     * The third term is the mechanism: once the box is the full width,
     * `(100% - 1200px) / 2` IS the gutter that leaves a 1200px column in the
     * middle. It only wins past ~1440, which is why narrower viewports keep the
     * gutter they have today.
     */
    mount(SECTION);
    const style = getComputedStyle(document.querySelector("section")!);
    expect(style.paddingInline).toContain("(100% - 1200px) / 2");
    expect(style.paddingInline).toContain("20px");
  });

  it("the 1440 media query no longer re-caps the box", () => {
    /*
     * Read off the CSSOM rather than the file text: what matters is the rule
     * list a browser ends up with, and this stylesheet declares several
     * selectors more than once.
     */
    mount(SECTION);
    const sheet = document.styleSheets[0] as CSSStyleSheet;
    const wide = [...sheet.cssRules]
      .filter((rule): rule is CSSMediaRule => rule.constructor.name === "CSSMediaRule")
      .filter((rule) => (rule.conditionText || "").includes("1440"));
    expect(wide.length).toBeGreaterThan(0);
    for (const rule of wide) {
      for (const inner of [...rule.cssRules] as CSSStyleRule[]) {
        expect(inner.selectorText).not.toContain(".page-content > section");
      }
    }
  });

  it("`.cta` no longer needs !important to reach the edges", () => {
    /*
     * That the ONE section anybody explicitly wanted full-bleed had to override
     * `width`, `max-width` and both paddings with `!important` is the clearest
     * evidence the cap was on the wrong box. It now inherits what it was forcing.
     */
    mount(`<div class="page-content"><section class="cta"></section></div>`);
    const style = getComputedStyle(document.querySelector(".cta")!);
    expect(style.width).toBe("100%");
    expect(style.maxWidth).not.toBe("1200px");
    const sheet = document.styleSheets[0] as CSSStyleSheet;
    const ctaRules = [...sheet.cssRules]
      .filter((rule): rule is CSSStyleRule => rule.constructor.name === "CSSStyleRule")
      .filter((rule) => rule.selectorText === ".cta");
    expect(ctaRules.length).toBeGreaterThan(0);
    for (const rule of ctaRules) {
      expect(rule.style.getPropertyPriority("width")).toBe("");
      expect(rule.style.getPropertyPriority("max-width")).toBe("");
      expect(rule.style.getPropertyPriority("padding-left")).toBe("");
      expect(rule.style.getPropertyPriority("padding-right")).toBe("");
    }
  });
});

/* ──────────────────────────────────────────────────────────────────────────
 * FIX 7 — the brand's wordmark, which was built and never called.
 *
 * fails-on-revert verified at 43a2f0c73 (all seven fixes reverted, these tests
 * kept): 3 of the 5 tests in this group fail. The two that still pass are the
 * fallback cases, correctly — a site with no logo rendered its name as text
 * before this change and must go on doing exactly that.
 *
 * The whole pipeline already existed: a `logo` upload field in Studio since
 * #2830, `renderMedia` projecting it into the artifact, and the public contract
 * validating it against the media manifest. The FOOTER read it. The header did
 * not — it typeset `display_name` no matter what — so a brand that uploaded its
 * wordmark saw its name set in Oswald in its own header.
 *
 * Measured: ours rendered `<a class="brand">gögi</a>`, 44x44, Oswald 19.2px.
 * The reference renders `<a class="brand" href="/" aria-label="gögi home"><img
 * src="…/gogi-wordmark-white.png" alt="gögi"></a>`, 58x34.
 *
 * This is the "built but never called" shape that has cost this repo several
 * issues, and the only thing that catches it is asserting the rendered OUTPUT.
 * ────────────────────────────────────────────────────────────────────────── */
describe("#3149 wave 5 the header prints the wordmark when there is one", () => {
  const LOGO = {
    id: MEDIA[0]!.id,
    url: MEDIA[0]!.url,
    alt: "",
    width: 580,
    height: 340,
    integrity: MEDIA[0]!.integrity,
    object_key: MEDIA[0]!.object_key,
  };

  const withLogo = (logo: unknown) => {
    const artifact = artifactOf([]) as unknown as {
      site_settings: Record<string, unknown>;
    };
    if (logo !== undefined) artifact.site_settings.logo = logo;
    return renderToStaticMarkup(
      <RestaurantV1
        artifact={artifact as unknown as RestaurantArtifact}
        page={(artifact as unknown as RestaurantArtifact).pages[0]!}
      />,
    );
  };

  const header = (html: string): string =>
    html.match(/<header class="site-header">([\s\S]*?)<\/header>/)![1]!;

  it("renders an img inside .brand, not the typeset name", () => {
    const head = header(withLogo(LOGO));
    expect(head).toContain('class="brand-wordmark"');
    expect(head).toContain(`src="${LOGO.url}"`);
    // The mark is INSIDE the link, and the link is still the link home.
    expect(head).toMatch(
      /<a class="brand"[^>]*href="\/"[^>]*>|<a[^>]*href="\/"[^>]*class="brand"[^>]*>/,
    );
    const brand = head.match(/<a[^>]*class="brand"[\s\S]*?<\/a>/)![0]!;
    expect(brand).toContain("<img");
    expect(brand).not.toContain(">gögi<");
  });

  it("names the link for a screen reader, and the image for its alt", () => {
    const brand = header(withLogo(LOGO)).match(/<a[^>]*class="brand"[\s\S]*?<\/a>/)![0]!;
    expect(brand).toContain('aria-label="gögi home"');
    expect(brand).toContain('alt="gögi"');
  });

  it("carries the manifest's own dimensions, so the box is reserved", () => {
    /*
     * And the stylesheet declares BOTH width and height for it — the attributes
     * below are exactly the presentational hints that squashed the menu photos
     * earlier in this wave, and a rule that set only a height would let the
     * width attribute win.
     */
    const brand = header(withLogo(LOGO)).match(/<a[^>]*class="brand"[\s\S]*?<\/a>/)![0]!;
    expect(brand).toContain('width="580"');
    expect(brand).toContain('height="340"');
    mount(`<a class="brand"><img class="brand-wordmark" width="580" height="340"></a>`);
    const style = getComputedStyle(document.querySelector(".brand-wordmark")!);
    expect(style.width).toBe("auto");
    expect(style.height).not.toBe("");
  });

  it("falls back to the typeset name when there is NO logo", () => {
    // Every already-published site without one renders exactly what it did.
    const head = header(withLogo(undefined));
    expect(head).not.toContain("brand-wordmark");
    expect(head).not.toContain("<img");
    expect(head).toContain(">gögi</a>");
  });

  it("falls back rather than breaking when the logo url is unusable", () => {
    /*
     * A logo whose URL does not pass the same gate the footer applies degrades
     * to the name. It must never publish an empty box where a brand's name was.
     */
    const head = header(withLogo({ ...LOGO, url: "javascript:alert(1)" }));
    expect(head).not.toContain("brand-wordmark");
    expect(head).toContain(">gögi</a>");
  });
});
