#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const GOGI_BRAND_ID = "733bc470-45e1-4684-8896-acd7e26074ff";
export const GOGI_CONFIGURED_BY = "1f3d2ddf-b741-4e2f-8884-d7222a660c7e";
export const GOGI_SOURCE = "gogi-ingest-brief-2026-08-27";
export const CMS_ORIGIN = "https://studio.sites.usemingla.com";

const STUDIO_COOKIE = "__Host-mingla_studio";
const STUDIO_CSRF_COOKIE = "__Host-mingla_studio_csrf";
const CANONICAL_URL = "https://gogi.sites.usemingla.com";
const MAX_BYTES = 20 * 1024 * 1024;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;

// Content authority: Engineering Blueprint/somethingelse/content/gogi-lagos/
// INGEST_BRIEF.md, captured 2026-08-27. Keep this object factual and free of
// the demo's payment, WhatsApp, reservation, endorsement, and provider copy.
/*
 * #2830 — gögi's own words, and only their own words.
 *
 * Every line below is quoted from something gögi published: their Instagram
 * bio, their captions, their storefront signage, or their own website. The
 * sourcing lives in `INGEST_BRIEF.md`, the fact ledger built for this pilot,
 * and the rule that produced it is the one that matters here: gögi is a
 * prospect, so NOTHING on this site may be invented. Not a tagline, not an
 * "about us" paragraph, not a review quote.
 *
 * Two consequences visible in the copy:
 *   - Contact is phone and Instagram only, because they publish no email.
 *   - Nothing claims they take bookings, because nothing says they do.
 *
 * The address is 69, not 66: their own post `DcgdnbaM_YB` and the
 * Eat.Drink.Lagos review both say 69, and one of those two is the business
 * itself. A web summary said 66 and is not used.
 */
export const GOGI_SEED_COPY = Object.freeze({
  displayName: "gögi",
  heading: "Where Lagos Comes to Eat",
  description:
    "A 24/7 food house at 69 Admiralty Way, Lekki Phase 1, Lagos. Day or night, open for a bite.",
  address: "69 Admiralty Way, Lekki Phase 1, Lagos",
  phoneDisplay: "0912 711 7528",
  phoneHref: "tel:+2349127117528",
  instagram: "https://www.instagram.com/gogilagos/",
  hoursSummary: "Open 24 hours, 7 days",
  /*
   * #3149 wave 4 — the ONE fact that makes a live "open now" line honest.
   *
   * `hours` above is a list of display strings and nothing can read a
   * schedule out of them. These two say, explicitly, that gögi never closes
   * and which clock to read — and the renderer prints no open/closed claim
   * without both. Lagos keeps a single offset all year, so the zone is the
   * whole of it.
   */
  timezone: "Africa/Lagos",
  colors: Object.freeze({
    background: "#1c1c1e",
    foreground: "#f0eee9",
    accent: "#cda052",
  }),
  // Verbatim, each from a caption of theirs. Quoted, never paraphrased.
  voice: Object.freeze({
    comeAsYouAre:
      "A place where you can show up exactly as you are. No pretending, no pressure. Just good food, good energy and good people.",
    findGogi:
      "In your 20s, (or 30s) there will be a space you become a regular. It's very important you find gögi.",
    cravings:
      "At gögi, we understand. Some cravings simply don't respect boundaries.",
    coconutRice:
      "Coconut rice, but make it gögi. Rich, fragrant, and loaded with flavour — the kind of bowl that needs no introduction.",
    team: "Not to be dramatic, but we won a lottery with our team.",
    friday:
      "Your Friday needs better decisions. Start with gögi. Finish wherever the night takes you.",
  }),
  /*
   * #3149 wave 3 — transcribed from gögi's OWN PUBLISHED WEBSITE, read
   * 2026-09-09. `voice` above is their Instagram; this is the site, and it is
   * quoted the same way: nothing here is written for them.
   *
   * What is deliberately NOT here:
   *   - Their fourth "why people come back" card, "Simple payment / Transfer
   *     to Moniepoint or Zenith and send proof of payment." Orders placed
   *     through this site are paid through Mingla, so repeating their bank
   *     flow would be an instruction that does not apply. Three of their four
   *     survive, which is also why their lead line for that section — "Four
   *     things that make gögi gögi." — is left out rather than edited to say
   *     three.
   *   - Any eyebrow for the map section. Theirs reads "Getting here", and the
   *     hours block on the same page already carries exactly that line; the
   *     map therefore carries none rather than printing it twice.
   */
  site: Object.freeze({
    // The scrolling strip under their hero, in their order.
    marquee: Object.freeze([
      "24/7 food house",
      "Come as you are",
      "Day or night, open for a bite",
      "69 Admiralty Way",
      "Find gögi",
    ]),
    whyEyebrow: "Why people keep coming back",
    whyHeading: "No closing time",
    /*
     * #3149 wave 4 — more of their own site, transcribed 2026-09-09.
     *
     * `whyLead` is the line under that heading. It says FOUR and only three of
     * their four cards are carried here, so it is deliberately NOT used: the
     * fourth explains their bank-transfer flow, which is not how an order
     * placed through this site is paid. Editing their sentence to say three
     * would be writing copy for them; carrying it unedited would be a count
     * the page contradicts. It is recorded so the decision is visible, and
     * left unread.
     */
    whyLead: "Four things that make gögi gögi.",
    /*
     * Their home page's story section — the prose, and the button under it.
     * The quotation beside it is `voice.comeAsYouAre`, which their own page
     * pulls out in exactly this spot.
     */
    storyEyebrow: "The place",
    storyHeading: "A room that never closes",
    storyBody:
      "gögi sits at 69 Admiralty Way in Lekki Phase 1 and does not shut. Breakfast at 6am, rice bowls at midday, wings at 2am — the kitchen is on whenever you turn up.",
    storyCta: "More about gögi",
    /*
     * The badge printed on the circular crop beside it. Two lines, theirs.
     */
    badgeFigure: "24/7",
    badgeLabel: "ALWAYS ON",
    // Their own alt text for that photograph.
    storyAlt: "A gögi bowl of coconut rice topped with wings and fish",
    // Their menu section's heading, lead line and button.
    menuEyebrow: "The menu",
    menuHeading: "What people order",
    menuLead:
      "The full list runs from shawarma at ₦5,000 to a Medallion burger at ₦15,000.",
    menuCta: "Full menu & ordering",
    // The button under their run of reels.
    reelsCta: "Follow @gogilagos",
    // The button under the five people their home page shows.
    teamCta: "All ten of them",
    /*
     * #3149 wave 4 — the sentence moved from `label` to `body`, and each card
     * gained a drawing.
     *
     * On their site each of these is a CARD: an icon, a title, a sentence.
     * `label` is the small line under a bare figure and was the only place the
     * sentence could go before there was a body; it now sits where it belongs,
     * and `label` is left unset because their cards have no such line.
     *
     * The icon names are OURS, not theirs — they are the closed-list keys this
     * runtime draws, chosen to mean what their icon font's glyph meant
     * (a clock, a bowl, a record). `highlight` is on the first card because
     * "no closing time" is the claim the whole section is built around, and it
     * is the one their design rings.
     */
    pillars: Object.freeze([
      Object.freeze({
        figure: "Open 24 hours",
        body:
          "Seven days a week, all year. There is no “sorry, we’re closed” at gögi.",
        icon: "clock",
        highlight: true,
      }),
      Object.freeze({
        figure: "Bowls that travel",
        body:
          "Jollof, fried, coconut and village rice — with plantain and salad, in a gögi bowl.",
        icon: "bowl",
      }),
      Object.freeze({
        figure: "Pregame Fridays",
        body:
          "DJ on deck, drinks flowing, food landing. Start the night here, finish it anywhere.",
        icon: "music",
      }),
    ]),
    // The <cite> under every blockquote on their site.
    quoteSource: "gögi, on Instagram",
    gettingHereHeading: "Admiralty Way",
    gettingHereBody:
      "gögi is on the main Admiralty Way strip in Lekki Phase 1. It is a small frontage — look for the 24/7 food house sign.",
    /*
     * COORDINATES, NOT AN ADDRESS TO RESOLVE. A map handed a place by name
     * resolves silently and can resolve to a street of the same name in
     * another country.
     *
     * gögi publish none: their own site's Restaurant structured data carries a
     * postal address and no `geo`, and OpenStreetMap has no house number on
     * Admiralty Way. This pair is what their own live Visit page points at
     * today — Google's resolution of their own published address — and a
     * reverse lookup against OpenStreetMap puts it on Admiralty Way, Lekki
     * Phase 1. Two providers agreeing on the street is what is claimed, so
     * `mapLabel` says the STREET and not a door number nobody has surveyed.
     */
    mapLatitude: 6.4471033,
    mapLongitude: 3.4680182,
    mapLabel: "Admiralty Way, Lekki Phase 1, Lagos",
    mapDirectionsUrl:
      "https://www.google.com/maps/dir/?api=1&destination=6.4471033,3.4680182",
  }),
  /*
   * #3149 wave 4 — RESERVATIONS GO THROUGH MINGLA.
   *
   * Their own site takes a table request through a WhatsApp form. That is not
   * built here and will not be: Mingla already owns reservations for this
   * venue — the bookings, the 24-hour cancellation policy, the attribution —
   * and a form that messaged a phone would route every booking around all of
   * it.
   *
   * The one sentence carried is theirs, from their own "Get a table" section,
   * and it is true whichever way a booking is taken. The rest of their
   * paragraph describes the WhatsApp reply and is deliberately left out rather
   * than reworded, because rewording it would be writing copy for them.
   *
   * The heading and the nav label are plainly factual rather than transcribed:
   * "Get a table" is their name for a different mechanism.
   */
  reservations: Object.freeze({
    navLabel: "Reservations",
    title: "Reservations",
    heading: "Book a table at gögi",
    body: "gögi is walk-in and always open — you never need a booking.",
  }),
  // Their own captions for their own people. Real names are published nowhere,
  // so nicknames are all this site claims.
  /*
   * #3149 wave 4 — the role beside each nickname, transcribed from gögi's own
   * About page (read 2026-09-09), where all ten are listed with one of three
   * words above each name. Nothing here is assigned by us: a person whose role
   * they never published would simply carry none.
   */
  teamRoles: Object.freeze({
    "Mr slice it all": "Kitchen",
    "Bad boy fresh": "Kitchen",
    "Mr cook half eat half": "Kitchen",
    "Madam Chief chef": "Kitchen",
    "Meat police": "Prep",
    "Stir fry bobo": "Kitchen",
    "Mix engineer": "Bar",
    "Fling stone": "Prep",
    "Scoopy doo": "Kitchen",
    "Fake chef": "Kitchen",
  }),
  /*
   * The five their HOME page shows, in their order, before the "all ten of
   * them" button. The About page shows all ten in the order of `team` below;
   * both orders are theirs, and this is why the home block lists these first.
   */
  homeTeamOrder: Object.freeze([
    "Madam Chief chef",
    "Mr slice it all",
    "Stir fry bobo",
    "Mix engineer",
    "Scoopy doo",
  ]),
  team: Object.freeze([
    "Mr slice it all",
    "Bad boy fresh",
    "Mr cook half eat half",
    "Madam Chief chef",
    "Meat police",
    "Stir fry bobo",
    "Mix engineer",
    "Fling stone",
    "Scoopy doo",
    "Fake chef",
  ]),
});

export class SeedError extends Error {
  constructor(code) {
    super(code);
    this.name = "SeedError";
    this.code = code;
  }
}

function fail(code) {
  throw new SeedError(code);
}

function requiredString(value, code) {
  if (typeof value !== "string" || value.length === 0) fail(code);
  return value;
}

function relationId(value) {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return typeof value.id === "string" || typeof value.id === "number"
      ? String(value.id)
      : "";
  }
  return "";
}

function compact(value, key = "") {
  if (value == null) return undefined;
  if (key === "media" || key === "social_image" || key === "logo") {
    return relationId(value) || undefined;
  }
  if (Array.isArray(value)) {
    return value.map((item) => compact(item)).filter((item) => item !== undefined);
  }
  if (typeof value !== "object") return value;
  const result = {};
  for (const childKey of Object.keys(value).sort()) {
    const childValue = value[childKey];
    if (
      [
        "id",
        "blockName",
        "createdAt",
        "updatedAt",
        "_status",
        "tenant",
      ].includes(childKey)
    ) {
      continue;
    }
    const normalized = compact(childValue, childKey);
    if (
      normalized === undefined ||
      (Array.isArray(normalized) && normalized.length === 0) ||
      (normalized &&
        typeof normalized === "object" &&
        !Array.isArray(normalized) &&
        Object.keys(normalized).length === 0)
    ) {
      continue;
    }
    result[childKey] = normalized;
  }
  return result;
}

function equal(left, right) {
  return JSON.stringify(compact(left)) === JSON.stringify(compact(right));
}

function tenantOf(document) {
  return relationId(document?.tenant);
}

function projectPage(page) {
  return compact({
    role: page.role,
    title: page.title,
    enabled: page.enabled,
    nav_label: page.nav_label,
    nav_order: page.nav_order,
    blocks: page.blocks,
    seo: page.seo,
  });
}

function projectSettings(settings) {
  return compact({
    display_name: settings.display_name,
    short_description: settings.short_description,
    logo: settings.logo,
    background_color: settings.background_color,
    foreground_color: settings.foreground_color,
    accent_color: settings.accent_color,
    typography: settings.typography,
    canonical_url: settings.canonical_url,
    seo_title: settings.seo_title,
    seo_description: settings.seo_description,
    social_image: settings.social_image,
    analytics_consent_mode: settings.analytics_consent_mode,
  });
}

function projectNavigation(navigation) {
  return {
    pages: Array.isArray(navigation.pages)
      ? navigation.pages.map(relationId).filter(Boolean)
      : [],
  };
}

function projectFooter(footer) {
  return compact({
    address: footer.address,
    hours_summary: footer.hours_summary,
    legal_text: footer.legal_text,
    links: footer.links,
  });
}

/*
 * #3149 wave 4 — the two fields the live "open now" line needs, alongside the
 * same seven display strings. Both are required before anything about being
 * open is printed, and neither is inferred from the strings.
 */
function hoursLocation(extra = {}) {
  return {
    blockType: "hours_location",
    ...extra,
    address: GOGI_SEED_COPY.address,
    always_open: true,
    timezone: GOGI_SEED_COPY.timezone,
    hours: hours(),
  };
}

function hours() {
  return [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
  ].map((day) => ({ day, value: "Open 24 hours" }));
}

/*
 * #2830 — gögi's site, as gögi's site.
 *
 * This seeded TWO pages with three blocks and one photograph, which is why the
 * live pilot looked nothing like the real thing. The renderer was never the
 * limit; the content was. It now seeds the five pages their own site has —
 * home, about, menu, gallery, visit — from the fact ledger above.
 *
 * MEDIA DEGRADES, IT DOES NOT FABRICATE. `media` maps a slot name to an
 * uploaded id. A block whose image or video has not been uploaded yet is
 * OMITTED, and a page left with no blocks is disabled, so the navigation never
 * offers a page that turns out to be empty. The seed can therefore run today
 * with one hero photograph and grow as the rest of their library is uploaded,
 * without ever publishing a placeholder.
 */
/*
 * #2830 — the CMS rich_text block stores its words in `content`, a Lexical
 * document, NOT in a `paragraphs` array.
 *
 * The seed wrote `paragraphs`. Payload silently drops unknown fields, and
 * `draft: true` skips the `required` check on `content`, so the block saved
 * with NO text and nothing anywhere said so. The artifact then published
 * `paragraphs: []`, which the artifact contract rejects, and the publish failed
 * closed with ARTIFACT_BLOCK_CONTENT_MISMATCH.
 *
 * Two silent steps in a row: an ignored field, then a skipped validation.
 */
function lexical(texts) {
  return {
    root: {
      type: "root",
      format: "",
      indent: 0,
      version: 1,
      direction: "ltr",
      children: texts.map((text) => ({
        type: "paragraph",
        format: "",
        indent: 0,
        version: 1,
        direction: "ltr",
        textFormat: 0,
        children: [{
          type: "text",
          text,
          format: 0,
          style: "",
          mode: "normal",
          detail: 0,
          version: 1,
        }],
      })),
    },
  };
}

export function seedDocuments(
  {
    heroMediaId,
    homeId,
    contactId,
    tenantId,
    aboutId,
    menuId,
    galleryId,
    reservationsId,
    media = {},
  },
) {
  const asset = (slot) => media[slot] ?? null;
  const drop = (blocks) => blocks.filter(Boolean);

  /*
   * The four square dish crops gögi publish for their own "what people order"
   * strip. Only the ones that actually uploaded are used.
   */
  const foodStrip = [
    "foodSqCoconutRiceBowl",
    "foodSqWingsBoard",
    "foodSqStirFryPlate",
    "foodSqSmoothie",
  ].map((slot) => asset(slot)).filter(Boolean).map((id) => ({ media: id, alt: "" }));

  /*
   * #3149 -- `extra` carries the eyebrow, and on the FIRST reel of a run the
   * heading for the grid that run renders as. The same three films head the
   * home run and the gallery run and the two runs are titled differently, so
   * this cannot live on the film itself.
   */
  /*
   * #3149 wave 4 — a person, with the role gögi published for them.
   *
   * `role` has been in the block since #2830 and the seed never set it, so ten
   * people appeared as ten nicknames with no idea who did what. A nickname
   * with no published role would carry none rather than one we chose.
   */
  const member = (name) => {
    const portrait = asset(`team:${name}`);
    const role = GOGI_SEED_COPY.teamRoles[name];
    return {
      name,
      ...(role ? { role } : {}),
      ...(portrait ? { media: portrait, alt: name } : {}),
    };
  };

  const reel = (videoSlot, posterSlot, heading, caption, extra = {}) =>
    asset(videoSlot) && asset(posterSlot)
      ? {
        blockType: "video_feature",
        ...extra,
        heading,
        caption,
        video: asset(videoSlot),
        poster: asset(posterSlot),
      }
      : null;

  const homeBlocks = drop([
    {
      blockType: "hero",
      heading: GOGI_SEED_COPY.heading,
      subheading: GOGI_SEED_COPY.description,
      media: heroMediaId,
      ...(asset("heroVideo") ? { video: asset("heroVideo") } : {}),
      ctas: [
        { label: "See the menu", href: "/menu" },
        { label: "Find us", href: "/contact" },
      ],
    },
    /*
     * #3149 -- the ticker, DIRECTLY under the hero, exactly where theirs sits
     * and in their order. Decorative on their site; here the first pass of it
     * is readable to a screen reader and the repeat that makes the loop
     * seamless is hidden from one.
     */
    {
      blockType: "marquee",
      phrases: GOGI_SEED_COPY.site.marquee.map((text) => ({ text })),
    },
    /*
     * #3149 wave 4 -- their STORY section, as ONE thing.
     *
     * This was prose alone: a heading, two paragraphs, no picture, and the
     * quotation nowhere. Theirs pairs the writing with a circular crop
     * carrying a 24/7 badge, pulls the line out beside it, and puts a button
     * under it. Every word is transcribed from their published home page.
     *
     * `voice.cravings` is NOT lost -- it is the caption of the film further
     * down this page, which is where their own site uses it.
     *
     * If the hero photograph has not been uploaded there is no picture to
     * crop, so the block is dropped rather than published as a headless
     * caption.
     */
    heroMediaId
      ? {
        blockType: "media_feature",
        eyebrow: GOGI_SEED_COPY.site.storyEyebrow,
        heading: GOGI_SEED_COPY.site.storyHeading,
        caption: GOGI_SEED_COPY.site.storyBody,
        media: heroMediaId,
        alt: GOGI_SEED_COPY.site.storyAlt,
        alignment: "right",
        media_shape: "circle",
        badge_figure: GOGI_SEED_COPY.site.badgeFigure,
        badge_label: GOGI_SEED_COPY.site.badgeLabel,
        quote: GOGI_SEED_COPY.voice.comeAsYouAre,
        quote_attribution: GOGI_SEED_COPY.site.quoteSource,
        cta_label: GOGI_SEED_COPY.site.storyCta,
        cta_href: "/about",
      }
      : null,
    /*
     * #3149 -- "Why people keep coming back / No closing time", the section
     * their home page runs after the story. Three of their four cards: the
     * fourth explains their bank-transfer flow, which does not apply to an
     * order placed through Mingla.
     */
    {
      blockType: "stats",
      eyebrow: GOGI_SEED_COPY.site.whyEyebrow,
      heading: GOGI_SEED_COPY.site.whyHeading,
      items: GOGI_SEED_COPY.site.pillars.map((pillar) => ({ ...pillar })),
    },
    asset("reelFoodHouse") && asset("reelFoodHousePoster")
      ? {
        blockType: "video_feature",
        eyebrow: "Admiralty Way",
        heading: "Day or night, open for a bite",
        caption: GOGI_SEED_COPY.voice.friday,
        video: asset("reelFoodHouse"),
        poster: asset("reelFoodHousePoster"),
      }
      : null,
    hoursLocation({ heading: "Open day and night" }),
    /*
     * What people order. gögi's own home page carries a strip of dishes
     * between the story and the films, and they publish square crops of
     * exactly these four for it. If any one of them is missing from the
     * upload, the block is dropped rather than shown short.
     */
    /*
     * #3149 wave 4 -- "What people order" is now A TASTE OF THE REAL MENU.
     *
     * It was four photographs and no prices, under a heading that promised
     * what people order. Theirs shows real sections with real prices beside
     * the photographs and a button to the rest, and so does this -- from
     * MINGLA'S OWN MENU, projected at publish time. Nothing about what gögi
     * sells or what it costs is typed here or stored here.
     *
     * The block is dropped when Mingla has no menu, and the photographs are
     * whichever of their four squares have uploaded.
     */
    {
      blockType: "menu_preview",
      eyebrow: GOGI_SEED_COPY.site.menuEyebrow,
      heading: GOGI_SEED_COPY.site.menuHeading,
      note: GOGI_SEED_COPY.site.menuLead,
      section_limit: 2,
      item_limit: 4,
      ...(foodStrip.length ? { images: foodStrip } : {}),
      cta_label: GOGI_SEED_COPY.site.menuCta,
      cta_href: "/menu",
    },
    /*
     * The films. Three consecutive reels render as ONE grid, which is how
     * their site shows them -- the same films that carry the gallery page,
     * as on theirs. A single reel would render as a full-width feature
     * instead, so this is deliberately a run.
     */
    reel(
      "reelPregameFriday",
      "reelPregameFridayPoster",
      "Your Friday needs better decisions",
      GOGI_SEED_COPY.voice.friday,
      // First of the run, so it titles the grid the three films render as.
      {
        eyebrow: "Straight from @gogilagos",
        group_heading: "The room, on any given night",
        // #3149 wave 4 -- the button under their grid, read off the first film
        // because it belongs to the run and not to any one reel.
        group_cta_label: GOGI_SEED_COPY.site.reelsCta,
        group_cta_href: GOGI_SEED_COPY.instagram,
      },
    ),
    reel(
      "reelLateNightCravings",
      "reelLateNightCravingsPoster",
      "Some cravings don't respect boundaries",
      GOGI_SEED_COPY.voice.cravings,
    ),
    reel(
      "reelOutsideGogi",
      "reelOutsideGogiPoster",
      "Find gögi",
      GOGI_SEED_COPY.voice.findGogi,
    ),
    /*
     * The people, as on their home page. The about page carries the same
     * block; a portrait that did not upload degrades to an initial rather
     * than a gap.
     */
    /*
     * #3149 wave 4 -- five of them here, all ten a click away.
     *
     * The block still carries EVERY person, so nothing is lost; the page shows
     * the first five and prints a button to the page that has the rest, which
     * is what their own home page does. The five are theirs and in their
     * order -- their About page lists all ten in a different order, and that
     * is the order the About block below keeps.
     */
    {
      blockType: "team",
      eyebrow: "The kitchen",
      heading: "Meet the team",
      caption: GOGI_SEED_COPY.voice.team,
      preview_count: GOGI_SEED_COPY.homeTeamOrder.length,
      cta_label: GOGI_SEED_COPY.site.teamCta,
      cta_href: "/about",
      members: [
        ...GOGI_SEED_COPY.homeTeamOrder,
        ...GOGI_SEED_COPY.team.filter(
          (name) => !GOGI_SEED_COPY.homeTeamOrder.includes(name),
        ),
      ].map(member),
    },
    {
      blockType: "contact_handoff",
      eyebrow: "Come through",
      heading: "Call gögi",
      body: GOGI_SEED_COPY.hoursSummary,
      label: `Call ${GOGI_SEED_COPY.phoneDisplay}`,
      href: GOGI_SEED_COPY.phoneHref,
    },
  ]);

  const aboutBlocks = drop([
    /*
     * #3149 -- "Find gögi" is now PULLED OUT as a quotation, immediately
     * under this prose, which is the shape their own About page uses: writing,
     * then the line itself in large type against a gold bar, cited.
     *
     * It is MOVED, not copied. It was the first paragraph here; printing it
     * twice, three lines apart, would read as a mistake by whoever wrote the
     * page. The other line theirs quotes -- "show up exactly as you are" -- is
     * on the home page as prose and stays there.
     */
    {
      blockType: "rich_text",
      eyebrow: "The idea",
      heading: "Find gögi",
      content: lexical([GOGI_SEED_COPY.voice.comeAsYouAre]),
    },
    {
      blockType: "pull_quote",
      quote: GOGI_SEED_COPY.voice.findGogi,
      attribution: GOGI_SEED_COPY.site.quoteSource,
    },
    {
      blockType: "team",
      eyebrow: "The kitchen",
      heading: "The team",
      caption: GOGI_SEED_COPY.voice.team,
      /*
       * Their own nicknames for their own people, now with their own
       * portraits. This block previously carried names only, on the reasoning
       * that the faces existed solely as moments in a reel and cropping a
       * stranger out of footage was not something to do automatically. gögi
       * publish a proper portrait for all ten, so that reasoning no longer
       * applies. A missing portrait still degrades to an initial rather than
       * a gap.
       */
      members: GOGI_SEED_COPY.team.map(member),
    },
    reel(
      "reelMeetTheTeam",
      "reelMeetTheTeamPoster",
      "Meet the team",
      GOGI_SEED_COPY.voice.team,
    ),
  ]);

  // The menu page carries no items of its own — Mingla owns them, and the
  // block is dropped at build time when Mingla has none, which disables this
  // page and removes it from the navigation.
  const menuBlocks = drop([
    {
      blockType: "menu_board",
      eyebrow: "Everything, with prices",
      heading: "The menu",
      note: `${GOGI_SEED_COPY.hoursSummary}.`,
    },
    reel(
      "reelCoconutRice",
      "reelCoconutRicePoster",
      "Coconut rice, but make it gögi",
      GOGI_SEED_COPY.voice.coconutRice,
    ),
  ]);

  // The artifact contract accepts at most 12 gallery images, so this asks for
  // exactly 12. A 13th would not be trimmed, it would fail validation at
  // publish time.
  const galleryImages = Array.from({ length: 12 }, (unused, index) => `gallery${index + 1}`)
    .map((slot) => asset(slot))
    .filter(Boolean)
    .map((id) => ({ media: id, alt: "" }));
  const galleryBlocks = drop([
    galleryImages.length
      ? {
        blockType: "gallery",
        eyebrow: "Photos",
        heading: "In the room",
        images: galleryImages,
      }
      : null,
    reel(
      "reelPregameFriday",
      "reelPregameFridayPoster",
      "Your Friday needs better decisions",
      GOGI_SEED_COPY.voice.friday,
      // The same three films, a second time and under their own title.
      { eyebrow: "Films", group_heading: "Six minutes of gögi" },
    ),
    reel(
      "reelLateNightCravings",
      "reelLateNightCravingsPoster",
      "Some cravings don't respect boundaries",
      GOGI_SEED_COPY.voice.cravings,
    ),
    reel(
      "reelOutsideGogi",
      "reelOutsideGogiPoster",
      "Find gögi",
      GOGI_SEED_COPY.voice.findGogi,
    ),
  ]);

  /*
   * #3149 wave 4 — THE VISIT PAGE IS RETIRED, and nothing it carried is lost.
   *
   * Its three blocks each had a home already or have one now:
   *   - the MAP moves to the Reservations page below. Someone who has just
   *     booked a table is exactly the person who needs to find the door.
   *   - the HOURS block is dropped. It carried the address, the seven
   *     identical "Open 24 hours" rows and the live-clock fields, and every
   *     one of those is on the page it moved beside: the home page keeps its
   *     own hours block, the Reservations page gains one, and the footer's
   *     Find us column prints the address and the hours summary on every page
   *     of the site. Nothing unique to this block existed.
   *   - the "Call gögi" HANDOFF is dropped. The home page carries an identical
   *     one — same heading, same body, same label, same tel: link — and the
   *     footer now shows the number in its own column and as a round button.
   *
   * The page itself is kept in this map with NO BLOCKS, so it publishes
   * disabled and leaves the navigation. It is not deleted from the seed's
   * vocabulary: `SEED_PAGE_ROLES` still names it, because a live site HAS one
   * and a role this seed did not recognise would be refused outright as
   * somebody else's content.
   */
  const contactBlocks = [];
  const retiredContactBlocks = drop([
    hoursLocation({ eyebrow: "Getting here", heading: "Visit gögi" }),
    /*
     * #3149 -- the map their Visit page has and this one did not.
     *
     * NO EYEBROW: theirs reads "Getting here" over this section, and the hours
     * block directly above already carries that exact line. Printing it twice
     * on one page is worse than printing it once, and inventing a second one
     * is not on the table.
     *
     * Nothing is requested from a map provider until a visitor asks for the
     * map -- see `MapEmbed` in the public runtime.
     */
    {
      blockType: "map_embed",
      heading: GOGI_SEED_COPY.site.gettingHereHeading,
      body: GOGI_SEED_COPY.site.gettingHereBody,
      latitude: GOGI_SEED_COPY.site.mapLatitude,
      longitude: GOGI_SEED_COPY.site.mapLongitude,
      place_label: GOGI_SEED_COPY.site.mapLabel,
      directions_url: GOGI_SEED_COPY.site.mapDirectionsUrl,
    },
    {
      blockType: "contact_handoff",
      // No email anywhere in their published material, so contact is the phone
      // and Instagram. The gap in the ledger becomes the shape of the page.
      heading: "Call gögi",
      body: GOGI_SEED_COPY.hoursSummary,
      label: GOGI_SEED_COPY.phoneDisplay,
      href: GOGI_SEED_COPY.phoneHref,
    },
  ]);
  // Kept, unread, as the record of what the retired page held. Deleting it
  // would make the note above unverifiable.
  void retiredContactBlocks;

  /*
   * #3149 wave 4 — THE BOOKING PAGE, AND IT IS MINGLA'S BOOKING FLOW.
   *
   * The block carries no destination of its own: the publisher derives it from
   * the brand, so this page can only ever point at Mingla's own reservation
   * page for gögi. That is where the venue's real availability, its 24-hour
   * cancellation policy and its attribution already live.
   */
  const reservationsBlocks = drop([
    {
      blockType: "venue_reservation",
      eyebrow: "Come through",
      heading: GOGI_SEED_COPY.reservations.heading,
      body: GOGI_SEED_COPY.reservations.body,
    },
    hoursLocation({ heading: "When you can come" }),
    /*
     * #3149 wave 4 — the map, moved here from the retired Visit page.
     *
     * Book, then know when, then know where: someone who has just asked for a
     * table is exactly the person who needs to find the door. It keeps the
     * eyebrow it did not have — the hours block above still carries "Getting
     * here" nowhere, so there is no line to print twice.
     *
     * Nothing is requested from a map provider by the visitor at all: the map
     * that paints is served from this site's own origin.
     */
    {
      blockType: "map_embed",
      /*
       * AND IT GETS THEIR EYEBROW BACK. Their own site prints "Getting here"
       * over this section. On the retired Visit page the hours block directly
       * above it already carried that exact line, so the map went without
       * rather than printing it twice — a deliberate omission recorded in
       * wave 3. Here the hours block carries no eyebrow, so there is nothing
       * to collide with and their line can be shown where they show it.
       */
      eyebrow: "Getting here",
      heading: GOGI_SEED_COPY.site.gettingHereHeading,
      body: GOGI_SEED_COPY.site.gettingHereBody,
      latitude: GOGI_SEED_COPY.site.mapLatitude,
      longitude: GOGI_SEED_COPY.site.mapLongitude,
      place_label: GOGI_SEED_COPY.site.mapLabel,
      directions_url: GOGI_SEED_COPY.site.mapDirectionsUrl,
    },
  ]);

  const page = (id, role, title, navLabel, navOrder, blocks, seo) => ({
    tenant: tenantId,
    role,
    title,
    // A page with nothing on it is not published, and so never appears in the
    // navigation or the sitemap.
    enabled: blocks.length > 0,
    nav_label: navLabel,
    nav_order: navOrder,
    blocks,
    seo,
  });

  const homePage = page(homeId, "home", "Home", "Home", 0, homeBlocks, {
    title: "gögi — Where Lagos Comes to Eat",
    description: GOGI_SEED_COPY.description,
  });
  /*
   * #3149 wave 4 — Home · Menu · About · Gallery · Reservations.
   *
   * Menu and About swap: the reference orders its navigation that way, and the
   * thing most visitors came for should not sit third. Visit is gone, and
   * Reservations takes the last slot rather than Visit's — a booking is the
   * step after browsing, not a page to open first.
   */
  const aboutPage = page(aboutId, "about", "About gögi", "About", 2, aboutBlocks, {
    title: "About gögi — a 24/7 food house in Lekki",
    description: GOGI_SEED_COPY.voice.comeAsYouAre,
  });
  const menuPage = page(menuId, "menu", "Menu", "Menu", 1, menuBlocks, {
    title: "The gögi menu",
    description: `The full gögi menu. ${GOGI_SEED_COPY.hoursSummary}.`,
  });
  const galleryPage = page(galleryId, "gallery", "Gallery", "Gallery", 3, galleryBlocks, {
    title: "Inside gögi",
    description: `Inside gögi at ${GOGI_SEED_COPY.address}.`,
  });
  /*
   * RETIRED. No blocks, so `enabled` is false, so it is neither created on a
   * fresh site nor listed in the navigation of an existing one. It keeps the
   * last nav position so that retiring it moves no page that is still live.
   *
   * `/contact` does not 404 for the people who bookmarked it: the runtime
   * redirects a retired role's slug to the page that replaced it — see
   * `replacementForRetiredSlug`.
   */
  const contactPage = page(contactId, "contact", "Visit gögi", "Visit", 5, contactBlocks, {
    title: "Visit gögi in Lekki Phase 1",
    description: `${GOGI_SEED_COPY.address}. ${GOGI_SEED_COPY.hoursSummary}.`,
  });
  /*
   * LAST in the navigation, at position 5.
   *
   * Two reasons, and the second is the stronger one. Booking is the step AFTER
   * deciding to come, so it belongs next to Visit rather than among the pages
   * someone is still browsing. And putting it last moves NO existing page:
   * every other nav_order is exactly what it already was, so a live site's
   * navigation does not silently reshuffle for a page that was merely added.
   */
  const reservationsPage = page(
    reservationsId,
    "reservations",
    GOGI_SEED_COPY.reservations.title,
    GOGI_SEED_COPY.reservations.navLabel,
    4,
    reservationsBlocks,
    {
      title: "Book a table at gögi",
      description: `${GOGI_SEED_COPY.reservations.body} ${GOGI_SEED_COPY.address}.`,
    },
  );

  // Navigation lists a page only once it has an id AND something on it. An
  // unpublished page is not routable, so listing it would render a nav link
  // that 404s.
  // Listed in NAV ORDER, which is the order the navigation renders in.
  const navigationPages = [
    [homeId, homePage],
    [menuId, menuPage],
    [aboutId, aboutPage],
    [galleryId, galleryPage],
    [reservationsId, reservationsPage],
    [contactId, contactPage],
  ]
    .filter(([id, document]) => Boolean(id) && document.enabled)
    .map(([id]) => id);

  return {
    home: homePage,
    about: aboutPage,
    menu: menuPage,
    gallery: galleryPage,
    contact: contactPage,
    reservations: reservationsPage,
    settings: {
      tenant: tenantId,
      display_name: GOGI_SEED_COPY.displayName,
      short_description: GOGI_SEED_COPY.description,
      background_color: GOGI_SEED_COPY.colors.background,
      foreground_color: GOGI_SEED_COPY.colors.foreground,
      accent_color: GOGI_SEED_COPY.colors.accent,
      // Their own register: condensed uppercase display, as their site uses.
      typography: "condensed-display",
      canonical_url: CANONICAL_URL,
      seo_title: "gögi — Where Lagos Comes to Eat",
      seo_description: GOGI_SEED_COPY.description,
      social_image: heroMediaId,
      analytics_consent_mode: "optional",
    },
    navigation: { tenant: tenantId, pages: navigationPages },
    footer: {
      tenant: tenantId,
      address: GOGI_SEED_COPY.address,
      hours_summary: GOGI_SEED_COPY.hoursSummary,
      legal_text: "Gogi Lagos Ltd",
      links: [
        { label: `Call ${GOGI_SEED_COPY.phoneDisplay}`, href: GOGI_SEED_COPY.phoneHref },
        { label: "Instagram", href: GOGI_SEED_COPY.instagram },
      ],
    },
  };
}

function baselineSettings() {
  return {
    display_name: "Gogi Restaurant",
    typography: "editorial-serif",
    canonical_url: CANONICAL_URL,
    analytics_consent_mode: "optional",
  };
}

function baselineHome() {
  return {
    role: "home",
    title: "Home",
    enabled: true,
    nav_label: "Home",
    nav_order: 0,
  };
}

export const SEED_PAGE_ROLES = [
  "home",
  "about",
  "menu",
  "gallery",
  "contact",
  // #3149 wave 4 — the sixth. Everything that reconciles the live site against
  // this seed iterates THIS list, so a role missing from it is a page the
  // caller never creates.
  "reservations",
];

// The exact documents the FIRST version of this seed wrote, frozen. It is read
// to recognise our own earlier output as ours, and is never written. Without
// it the live pilot -- which that version seeded -- matches neither the
// untouched baseline nor the current target, so the seed reads it as somebody
// else's content and refuses to touch anything.
//
// Do not "fix" this to track the current copy. It is a historical record.
export function priorSeedDocuments({ heroMediaId, homeId, contactId, tenantId }) {
  return {
    home: {
      tenant: tenantId,
      role: "home",
      title: "Home",
      enabled: true,
      nav_label: "Home",
      nav_order: 0,
      blocks: [
        {
          blockType: "hero",
          heading: GOGI_SEED_COPY.heading,
          subheading: GOGI_SEED_COPY.description,
          media: heroMediaId,
          ctas: [
            { label: "Visit us", href: "/contact" },
            { label: `Call ${GOGI_SEED_COPY.phoneDisplay}`, href: GOGI_SEED_COPY.phoneHref },
          ],
        },
        {
          blockType: "hours_location",
          heading: "Open day and night",
          address: GOGI_SEED_COPY.address,
          hours: hours(),
        },
        {
          blockType: "contact_handoff",
          heading: "Come as you are",
          body: GOGI_SEED_COPY.hoursSummary,
          label: `Call ${GOGI_SEED_COPY.phoneDisplay}`,
          href: GOGI_SEED_COPY.phoneHref,
        },
      ],
      seo: {
        title: "gögi — Where Lagos Comes to Eat",
        description: GOGI_SEED_COPY.description,
      },
    },
    contact: {
      tenant: tenantId,
      role: "contact",
      title: "Visit gögi",
      enabled: true,
      nav_label: "Visit",
      nav_order: 1,
      blocks: [
        {
          blockType: "hours_location",
          heading: "Visit gögi",
          address: GOGI_SEED_COPY.address,
          hours: hours(),
        },
        {
          blockType: "contact_handoff",
          heading: "Call gögi",
          body: GOGI_SEED_COPY.hoursSummary,
          label: GOGI_SEED_COPY.phoneDisplay,
          href: GOGI_SEED_COPY.phoneHref,
        },
      ],
      seo: {
        title: "Visit gögi in Lekki Phase 1",
        description: `${GOGI_SEED_COPY.address}. ${GOGI_SEED_COPY.hoursSummary}.`,
      },
    },
    settings: {
      tenant: tenantId,
      display_name: GOGI_SEED_COPY.displayName,
      short_description: GOGI_SEED_COPY.description,
      background_color: GOGI_SEED_COPY.colors.background,
      foreground_color: GOGI_SEED_COPY.colors.foreground,
      accent_color: GOGI_SEED_COPY.colors.accent,
      typography: "modern-sans",
      canonical_url: CANONICAL_URL,
      seo_title: "gögi — Where Lagos Comes to Eat",
      seo_description: GOGI_SEED_COPY.description,
      social_image: heroMediaId,
      analytics_consent_mode: "optional",
    },
    navigation: { tenant: tenantId, pages: [homeId, contactId] },
    footer: {
      tenant: tenantId,
      address: GOGI_SEED_COPY.address,
      hours_summary: GOGI_SEED_COPY.hoursSummary,
      legal_text: "Gogi Lagos Ltd",
      links: [
        { label: "Home", href: "/" },
        { label: "Visit", href: "/contact" },
        { label: `Call ${GOGI_SEED_COPY.phoneDisplay}`, href: GOGI_SEED_COPY.phoneHref },
      ],
    },
  };
}


/*
 * #3149 wave 4 — THE WAVE 3 OUTPUT, FROZEN. A SECOND entry in the prior
 * ledger; the first-version one above is untouched.
 *
 * WHY THIS EXISTS. Waves 2 and 3 were not applied by running this seed. Their
 * content was computed with `seedDocuments` and then written into the live
 * drafts through the Studio REST API — wave 2 merged eyebrow values in, wave 3
 * spliced in the marquee, stats, pull-quote and map blocks. The bytes are what
 * this seed would have written; the transport was not this seed, so nothing
 * recorded that it shipped.
 *
 * The live pages therefore hold the WAVE 3 TARGET. Wave 4 moves the target, so
 * without this entry `classifySnapshot` matches them against neither the new
 * target nor the first version, calls them somebody else's content, and
 * refuses to touch anything — measured before this was added: home, about,
 * menu, contact and the navigation all classified `invalid` and the republish
 * could not happen at all.
 *
 * The header on `priorSeedDocuments` says not to "fix" it to track the current
 * copy. That warning is about never chasing the TARGET — a ledger that moved
 * with the seed would accept anything and this guard would stop guarding.
 * Recording a state that actually shipped is the opposite of that: it is what
 * the ledger is FOR, and every entry is frozen the moment it is written.
 *
 * HOW IT WAS DERIVED — not hand-written from a diff. This is
 * `git show origin/main:scripts/sites/gogi-pilot/seed-gogi-pilot.mjs`'s own
 * `seedDocuments`, copied verbatim, with exactly two changes:
 *
 *   1. renamed from `seedDocuments`;
 *   2. its one `GOGI_SEED_COPY.site.pillars` reads `WAVE_3_PILLARS` below.
 *
 * The second is the one thing that could have made this silently wrong.
 * `site.pillars` is the ONLY value in the copy ledger whose SHAPE wave 4
 * changed — the card sentence moved from `label` to `body` and gained an icon
 * — so a frozen record reading the LIVE pillars would have described wave 4's
 * cards, and the home page would still have been refused. Every other
 * `GOGI_SEED_COPY` field this function reads is unchanged between the two
 * waves (wave 4's additions are additive), so those are read live and cannot
 * drift. The values below are extracted verbatim from that same file rather
 * than retyped, and `priorLedgerWave3.issue3149` re-derives them from
 * `origin/main` at test time and fails if they ever differ.
 *
 * `hours()` and `lexical()` are shared with the current seed and were verified
 * byte-identical between the two waves before this was written.
 */
const WAVE_3_PILLARS = Object.freeze([
  Object.freeze({
    figure: "Open 24 hours",
    label:
      "Seven days a week, all year. There is no “sorry, we’re closed” at gögi.",
  }),
  Object.freeze({
    figure: "Bowls that travel",
    label:
      "Jollof, fried, coconut and village rice — with plantain and salad, in a gögi bowl.",
  }),
  Object.freeze({
    figure: "Pregame Fridays",
    label:
      "DJ on deck, drinks flowing, food landing. Start the night here, finish it anywhere.",
  }),
]);

export function priorSeedDocumentsWave3(
  { heroMediaId, homeId, contactId, tenantId, aboutId, menuId, galleryId, media = {} },
) {
  const asset = (slot) => media[slot] ?? null;
  const drop = (blocks) => blocks.filter(Boolean);

  /*
   * The four square dish crops gögi publish for their own "what people order"
   * strip. Only the ones that actually uploaded are used.
   */
  const foodStrip = [
    "foodSqCoconutRiceBowl",
    "foodSqWingsBoard",
    "foodSqStirFryPlate",
    "foodSqSmoothie",
  ].map((slot) => asset(slot)).filter(Boolean).map((id) => ({ media: id, alt: "" }));

  /*
   * #3149 -- `extra` carries the eyebrow, and on the FIRST reel of a run the
   * heading for the grid that run renders as. The same three films head the
   * home run and the gallery run and the two runs are titled differently, so
   * this cannot live on the film itself.
   */
  const reel = (videoSlot, posterSlot, heading, caption, extra = {}) =>
    asset(videoSlot) && asset(posterSlot)
      ? {
        blockType: "video_feature",
        ...extra,
        heading,
        caption,
        video: asset(videoSlot),
        poster: asset(posterSlot),
      }
      : null;

  const homeBlocks = drop([
    {
      blockType: "hero",
      heading: GOGI_SEED_COPY.heading,
      subheading: GOGI_SEED_COPY.description,
      media: heroMediaId,
      ...(asset("heroVideo") ? { video: asset("heroVideo") } : {}),
      ctas: [
        { label: "See the menu", href: "/menu" },
        { label: "Find us", href: "/contact" },
      ],
    },
    /*
     * #3149 -- the ticker, DIRECTLY under the hero, exactly where theirs sits
     * and in their order. Decorative on their site; here the first pass of it
     * is readable to a screen reader and the repeat that makes the loop
     * seamless is hidden from one.
     */
    {
      blockType: "marquee",
      phrases: GOGI_SEED_COPY.site.marquee.map((text) => ({ text })),
    },
    {
      blockType: "rich_text",
      eyebrow: "The place",
      heading: "Come as you are",
      content: lexical([
        GOGI_SEED_COPY.voice.comeAsYouAre,
        GOGI_SEED_COPY.voice.cravings,
      ]),
    },
    /*
     * #3149 -- "Why people keep coming back / No closing time", the section
     * their home page runs after the story. Three of their four cards: the
     * fourth explains their bank-transfer flow, which does not apply to an
     * order placed through Mingla.
     */
    {
      blockType: "stats",
      eyebrow: GOGI_SEED_COPY.site.whyEyebrow,
      heading: GOGI_SEED_COPY.site.whyHeading,
      items: WAVE_3_PILLARS.map((pillar) => ({ ...pillar })),
    },
    asset("reelFoodHouse") && asset("reelFoodHousePoster")
      ? {
        blockType: "video_feature",
        eyebrow: "Admiralty Way",
        heading: "Day or night, open for a bite",
        caption: GOGI_SEED_COPY.voice.friday,
        video: asset("reelFoodHouse"),
        poster: asset("reelFoodHousePoster"),
      }
      : null,
    {
      blockType: "hours_location",
      heading: "Open day and night",
      address: GOGI_SEED_COPY.address,
      hours: hours(),
    },
    /*
     * What people order. gögi's own home page carries a strip of dishes
     * between the story and the films, and they publish square crops of
     * exactly these four for it. If any one of them is missing from the
     * upload, the block is dropped rather than shown short.
     */
    foodStrip.length
      ? {
        blockType: "gallery",
        eyebrow: "The menu",
        heading: "What people order",
        images: foodStrip,
      }
      : null,
    /*
     * The films. Three consecutive reels render as ONE grid, which is how
     * their site shows them -- the same films that carry the gallery page,
     * as on theirs. A single reel would render as a full-width feature
     * instead, so this is deliberately a run.
     */
    reel(
      "reelPregameFriday",
      "reelPregameFridayPoster",
      "Your Friday needs better decisions",
      GOGI_SEED_COPY.voice.friday,
      // First of the run, so it titles the grid the three films render as.
      {
        eyebrow: "Straight from @gogilagos",
        group_heading: "The room, on any given night",
      },
    ),
    reel(
      "reelLateNightCravings",
      "reelLateNightCravingsPoster",
      "Some cravings don't respect boundaries",
      GOGI_SEED_COPY.voice.cravings,
    ),
    reel(
      "reelOutsideGogi",
      "reelOutsideGogiPoster",
      "Find gögi",
      GOGI_SEED_COPY.voice.findGogi,
    ),
    /*
     * The people, as on their home page. The about page carries the same
     * block; a portrait that did not upload degrades to an initial rather
     * than a gap.
     */
    {
      blockType: "team",
      eyebrow: "The kitchen",
      heading: "Meet the team",
      caption: GOGI_SEED_COPY.voice.team,
      members: GOGI_SEED_COPY.team.map((name) => {
        const portrait = asset(`team:${name}`);
        return portrait ? { name, media: portrait, alt: name } : { name };
      }),
    },
    {
      blockType: "contact_handoff",
      eyebrow: "Come through",
      heading: "Call gögi",
      body: GOGI_SEED_COPY.hoursSummary,
      label: `Call ${GOGI_SEED_COPY.phoneDisplay}`,
      href: GOGI_SEED_COPY.phoneHref,
    },
  ]);

  const aboutBlocks = drop([
    /*
     * #3149 -- "Find gögi" is now PULLED OUT as a quotation, immediately
     * under this prose, which is the shape their own About page uses: writing,
     * then the line itself in large type against a gold bar, cited.
     *
     * It is MOVED, not copied. It was the first paragraph here; printing it
     * twice, three lines apart, would read as a mistake by whoever wrote the
     * page. The other line theirs quotes -- "show up exactly as you are" -- is
     * on the home page as prose and stays there.
     */
    {
      blockType: "rich_text",
      eyebrow: "The idea",
      heading: "Find gögi",
      content: lexical([GOGI_SEED_COPY.voice.comeAsYouAre]),
    },
    {
      blockType: "pull_quote",
      quote: GOGI_SEED_COPY.voice.findGogi,
      attribution: GOGI_SEED_COPY.site.quoteSource,
    },
    {
      blockType: "team",
      eyebrow: "The kitchen",
      heading: "The team",
      caption: GOGI_SEED_COPY.voice.team,
      /*
       * Their own nicknames for their own people, now with their own
       * portraits. This block previously carried names only, on the reasoning
       * that the faces existed solely as moments in a reel and cropping a
       * stranger out of footage was not something to do automatically. gögi
       * publish a proper portrait for all ten, so that reasoning no longer
       * applies. A missing portrait still degrades to an initial rather than
       * a gap.
       */
      members: GOGI_SEED_COPY.team.map((name) => {
        const portrait = asset(`team:${name}`);
        return portrait ? { name, media: portrait, alt: name } : { name };
      }),
    },
    reel(
      "reelMeetTheTeam",
      "reelMeetTheTeamPoster",
      "Meet the team",
      GOGI_SEED_COPY.voice.team,
    ),
  ]);

  // The menu page carries no items of its own — Mingla owns them, and the
  // block is dropped at build time when Mingla has none, which disables this
  // page and removes it from the navigation.
  const menuBlocks = drop([
    {
      blockType: "menu_board",
      eyebrow: "Everything, with prices",
      heading: "The menu",
      note: `${GOGI_SEED_COPY.hoursSummary}.`,
    },
    reel(
      "reelCoconutRice",
      "reelCoconutRicePoster",
      "Coconut rice, but make it gögi",
      GOGI_SEED_COPY.voice.coconutRice,
    ),
  ]);

  // The artifact contract accepts at most 12 gallery images, so this asks for
  // exactly 12. A 13th would not be trimmed, it would fail validation at
  // publish time.
  const galleryImages = Array.from({ length: 12 }, (unused, index) => `gallery${index + 1}`)
    .map((slot) => asset(slot))
    .filter(Boolean)
    .map((id) => ({ media: id, alt: "" }));
  const galleryBlocks = drop([
    galleryImages.length
      ? {
        blockType: "gallery",
        eyebrow: "Photos",
        heading: "In the room",
        images: galleryImages,
      }
      : null,
    reel(
      "reelPregameFriday",
      "reelPregameFridayPoster",
      "Your Friday needs better decisions",
      GOGI_SEED_COPY.voice.friday,
      // The same three films, a second time and under their own title.
      { eyebrow: "Films", group_heading: "Six minutes of gögi" },
    ),
    reel(
      "reelLateNightCravings",
      "reelLateNightCravingsPoster",
      "Some cravings don't respect boundaries",
      GOGI_SEED_COPY.voice.cravings,
    ),
    reel(
      "reelOutsideGogi",
      "reelOutsideGogiPoster",
      "Find gögi",
      GOGI_SEED_COPY.voice.findGogi,
    ),
  ]);

  const contactBlocks = drop([
    {
      blockType: "hours_location",
      eyebrow: "Getting here",
      heading: "Visit gögi",
      address: GOGI_SEED_COPY.address,
      hours: hours(),
    },
    /*
     * #3149 -- the map their Visit page has and this one did not.
     *
     * NO EYEBROW: theirs reads "Getting here" over this section, and the hours
     * block directly above already carries that exact line. Printing it twice
     * on one page is worse than printing it once, and inventing a second one
     * is not on the table.
     *
     * Nothing is requested from a map provider until a visitor asks for the
     * map -- see `MapEmbed` in the public runtime.
     */
    {
      blockType: "map_embed",
      heading: GOGI_SEED_COPY.site.gettingHereHeading,
      body: GOGI_SEED_COPY.site.gettingHereBody,
      latitude: GOGI_SEED_COPY.site.mapLatitude,
      longitude: GOGI_SEED_COPY.site.mapLongitude,
      place_label: GOGI_SEED_COPY.site.mapLabel,
      directions_url: GOGI_SEED_COPY.site.mapDirectionsUrl,
    },
    {
      blockType: "contact_handoff",
      // No email anywhere in their published material, so contact is the phone
      // and Instagram. The gap in the ledger becomes the shape of the page.
      heading: "Call gögi",
      body: GOGI_SEED_COPY.hoursSummary,
      label: GOGI_SEED_COPY.phoneDisplay,
      href: GOGI_SEED_COPY.phoneHref,
    },
  ]);

  const page = (id, role, title, navLabel, navOrder, blocks, seo) => ({
    tenant: tenantId,
    role,
    title,
    // A page with nothing on it is not published, and so never appears in the
    // navigation or the sitemap.
    enabled: blocks.length > 0,
    nav_label: navLabel,
    nav_order: navOrder,
    blocks,
    seo,
  });

  const homePage = page(homeId, "home", "Home", "Home", 0, homeBlocks, {
    title: "gögi — Where Lagos Comes to Eat",
    description: GOGI_SEED_COPY.description,
  });
  const aboutPage = page(aboutId, "about", "About gögi", "About", 1, aboutBlocks, {
    title: "About gögi — a 24/7 food house in Lekki",
    description: GOGI_SEED_COPY.voice.comeAsYouAre,
  });
  const menuPage = page(menuId, "menu", "Menu", "Menu", 2, menuBlocks, {
    title: "The gögi menu",
    description: `The full gögi menu. ${GOGI_SEED_COPY.hoursSummary}.`,
  });
  const galleryPage = page(galleryId, "gallery", "Gallery", "Gallery", 3, galleryBlocks, {
    title: "Inside gögi",
    description: `Inside gögi at ${GOGI_SEED_COPY.address}.`,
  });
  const contactPage = page(contactId, "contact", "Visit gögi", "Visit", 4, contactBlocks, {
    title: "Visit gögi in Lekki Phase 1",
    description: `${GOGI_SEED_COPY.address}. ${GOGI_SEED_COPY.hoursSummary}.`,
  });

  // Navigation lists a page only once it has an id AND something on it. An
  // unpublished page is not routable, so listing it would render a nav link
  // that 404s.
  const navigationPages = [
    [homeId, homePage],
    [aboutId, aboutPage],
    [menuId, menuPage],
    [galleryId, galleryPage],
    [contactId, contactPage],
  ]
    .filter(([id, document]) => Boolean(id) && document.enabled)
    .map(([id]) => id);

  return {
    home: homePage,
    about: aboutPage,
    menu: menuPage,
    gallery: galleryPage,
    contact: contactPage,
    settings: {
      tenant: tenantId,
      display_name: GOGI_SEED_COPY.displayName,
      short_description: GOGI_SEED_COPY.description,
      background_color: GOGI_SEED_COPY.colors.background,
      foreground_color: GOGI_SEED_COPY.colors.foreground,
      accent_color: GOGI_SEED_COPY.colors.accent,
      // Their own register: condensed uppercase display, as their site uses.
      typography: "condensed-display",
      canonical_url: CANONICAL_URL,
      seo_title: "gögi — Where Lagos Comes to Eat",
      seo_description: GOGI_SEED_COPY.description,
      social_image: heroMediaId,
      analytics_consent_mode: "optional",
    },
    navigation: { tenant: tenantId, pages: navigationPages },
    footer: {
      tenant: tenantId,
      address: GOGI_SEED_COPY.address,
      hours_summary: GOGI_SEED_COPY.hoursSummary,
      legal_text: "Gogi Lagos Ltd",
      links: [
        { label: `Call ${GOGI_SEED_COPY.phoneDisplay}`, href: GOGI_SEED_COPY.phoneHref },
        { label: "Instagram", href: GOGI_SEED_COPY.instagram },
      ],
    },
  };
}

/*
 * #3149 wave 4 — EVERY STATE THIS SEED HAS SHIPPED, oldest first.
 *
 * `classifySnapshot` walks this list: a live document matching ANY entry is
 * ours to supersede, and one matching none is somebody else's content and is
 * refused. A list rather than a single record because there is now more than
 * one shipped state, and recording the newer one must not displace the older —
 * a site still sitting on the first version has to stay reconcilable.
 *
 * APPEND ONLY, and each entry frozen when written. This list may never be made
 * to include the CURRENT target: an entry that moved with the seed would match
 * everything, and the refusal that stops this overwriting a brand's own edits
 * would quietly stop happening.
 */
export const PRIOR_SEED_LEDGER = Object.freeze([
  priorSeedDocuments,
  priorSeedDocumentsWave3,
]);

export function deterministicHeroFilename(expectedSha256, mime) {
  const extension = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  }[mime];
  if (!extension || !SHA256.test(expectedSha256)) fail("INVALID_HERO_INPUT");
  return `gogi-pilot-hero-${expectedSha256}.${extension}`;
}

export function classifySnapshot(snapshot, input) {
  const { tenantId, heroFilename, media: mediaSlots = {} } = input;
  const pages = Array.isArray(snapshot.pages) ? snapshot.pages : [];
  const settings = Array.isArray(snapshot.settings) ? snapshot.settings : [];
  const navigation = Array.isArray(snapshot.navigation) ? snapshot.navigation : [];
  const footer = Array.isArray(snapshot.footer) ? snapshot.footer : [];
  const media = Array.isArray(snapshot.media) ? snapshot.media : [];
  const allDocuments = [...pages, ...settings, ...navigation, ...footer];
  if (
    allDocuments.some((document) => tenantOf(document) !== tenantId)
  ) {
    fail("CROSS_TENANT_RESPONSE");
  }
  if (settings.length !== 1 || navigation.length !== 1 || footer.length !== 1) {
    fail("PROVISIONING_BASELINE_MISSING");
  }
  const unexpectedPage = pages.find((page) => !SEED_PAGE_ROLES.includes(page.role));
  const byRole = new Map();
  for (const page of pages) {
    // Two pages claiming one role is not a state this seed can reconcile: it
    // cannot tell which one it wrote.
    if (byRole.has(page.role)) fail("EXISTING_NON_SEED_CONTENT");
    byRole.set(page.role, page);
  }
  const home = byRole.get("home");
  const contact = byRole.get("contact") ?? null;
  if (!home || unexpectedPage) fail("EXISTING_NON_SEED_CONTENT");
  const matchingMedia = media.filter((item) => item.filename === heroFilename);
  if (matchingMedia.length > 1) fail("DUPLICATE_SEED_MEDIA");
  if (matchingMedia.length === 1 && matchingMedia[0].state !== "READY") {
    fail("EXISTING_SEED_MEDIA_NOT_READY");
  }
  const heroMediaId = matchingMedia.length === 1
    ? requiredString(String(matchingMedia[0].id || ""), "INVALID_MEDIA_RESPONSE")
    : null;
  const documentIds = {
    heroMediaId,
    tenantId,
    homeId: String(home.id),
    // A role with no document yet gets a placeholder that cannot collide with
    // a real Payload id, so a navigation built from it can never accidentally
    // compare equal to one built from real ids.
    aboutId: byRole.has("about") ? String(byRole.get("about").id) : "pending-about",
    menuId: byRole.has("menu") ? String(byRole.get("menu").id) : "pending-menu",
    galleryId: byRole.has("gallery") ? String(byRole.get("gallery").id) : "pending-gallery",
    contactId: contact ? String(contact.id) : "pending-contact",
    reservationsId: byRole.has("reservations")
      ? String(byRole.get("reservations").id)
      : "pending-reservations",
  };
  // Which pages belong on the site does not depend on whether the hero has been
  // uploaded yet, so the shape is always computable. Only the equality
  // comparison needs a real media id.
  const shape = seedDocuments({
    ...documentIds,
    media: mediaSlots,
    heroMediaId: heroMediaId ?? "pending-hero-media",
  });
  const expected = heroMediaId ? shape : null;
  /*
   * #3149 wave 4 — EVERY recorded state, not just the first one. The live
   * pilot holds wave 3's output, which shipped through the Studio API rather
   * than through this seed; without the second entry every page on it reads as
   * somebody else's content and the republish is refused outright.
   */
  const priors = heroMediaId
    ? PRIOR_SEED_LEDGER.map((record) =>
      record({ ...documentIds, media: mediaSlots })
    )
    : [];

  // Four states, and only "invalid" refuses. "absent" is a page we have not
  // written yet; "prior_seed" is a page an earlier version of this seed wrote
  // and this version supersedes.
  const pageState = (role) => {
    const document = byRole.get(role);
    if (!document) return "absent";
    const projected = projectPage(document);
    if (expected && equal(projected, projectPage(expected[role]))) return "target";
    if (
      priors.some((prior) =>
        prior?.[role] && equal(projected, projectPage(prior[role]))
      )
    ) return "prior_seed";
    if (role === "home" && equal(projected, baselineHome())) return "baseline";
    return "invalid";
  };
  const documentState = (key, document, project, baselineValue) => {
    const projected = project(document);
    if (expected && equal(projected, project(expected[key]))) return "target";
    if (
      priors.some((prior) => prior?.[key] && equal(projected, project(prior[key])))
    ) return "prior_seed";
    if (equal(projected, baselineValue)) return "baseline";
    return "invalid";
  };

  const states = { media: heroMediaId ? "target" : "baseline" };
  for (const role of SEED_PAGE_ROLES) states[role] = pageState(role);
  states.navigation = documentState(
    "navigation",
    navigation[0],
    projectNavigation,
    { pages: [] },
  );
  states.footer = documentState("footer", footer[0], projectFooter, {});
  states.settings = documentState(
    "settings",
    settings[0],
    projectSettings,
    baselineSettings(),
  );
  if (Object.values(states).includes("invalid")) fail("EXISTING_NON_SEED_CONTENT");

  const actions = [];
  if (states.media === "baseline") actions.push("upload_hero_through_private_pipeline");
  for (const role of SEED_PAGE_ROLES) {
    // A page with nothing on it is never created. An empty draft the brand did
    // not ask for is clutter in their Studio, and it is indistinguishable from
    // one they emptied themselves.
    const wanted = shape[role].enabled;
    if (states[role] === "absent") {
      if (wanted) actions.push(`create_${role}_draft`);
    } else if (states[role] === "baseline" || states[role] === "prior_seed") {
      actions.push(`update_${role}_draft`);
    }
  }
  for (const key of ["navigation", "footer"]) {
    if (states[key] === "baseline" || states[key] === "prior_seed") {
      actions.push(`update_${key}_draft`);
    }
  }
  if (states.settings === "baseline" || states.settings === "prior_seed") {
    actions.push("update_site_settings_draft");
  }

  return {
    state: actions.length === 0 ? "seeded" : "reconcilable",
    actions,
    states,
    heroMediaId,
    pages: Object.fromEntries(
      SEED_PAGE_ROLES.map((role) => [role, byRole.get(role) ?? null]),
    ),
    home,
    contact,
    settings: settings[0],
    navigation: navigation[0],
    footer: footer[0],
  };
}

function parseArgs(argv) {
  const values = {};
  const allowed = new Set([
    "--site-id",
    "--brand-id",
    "--tenant-id",
    "--configured-by",
    "--hero-image",
    "--hero-sha256",
    "--source",
    "--media-manifest",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") {
      if (values.apply === true) fail("DUPLICATE_ARGUMENT");
      values.apply = true;
      continue;
    }
    if (!allowed.has(argument)) fail("UNKNOWN_ARGUMENT");
    if (Object.prototype.hasOwnProperty.call(values, argument)) {
      fail("DUPLICATE_ARGUMENT");
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail("MISSING_ARGUMENT_VALUE");
    values[argument] = value;
    index += 1;
  }
  return {
    siteId: values["--site-id"],
    brandId: values["--brand-id"],
    tenantId: values["--tenant-id"],
    configuredBy: values["--configured-by"],
    heroImage: values["--hero-image"],
    heroSha256: values["--hero-sha256"],
    source: values["--source"],
    mediaManifest: values["--media-manifest"],
    apply: values.apply === true,
  };
}

export function validateOptions(raw) {
  const options = {
    siteId: requiredString(raw.siteId, "MISSING_SITE_ID").toLowerCase(),
    brandId: requiredString(raw.brandId, "MISSING_BRAND_ID").toLowerCase(),
    tenantId: requiredString(raw.tenantId, "MISSING_TENANT_ID").toLowerCase(),
    configuredBy: requiredString(
      raw.configuredBy,
      "MISSING_CONFIGURED_BY",
    ).toLowerCase(),
    heroImage: resolve(requiredString(raw.heroImage, "MISSING_HERO_IMAGE")),
    heroSha256: requiredString(
      raw.heroSha256,
      "MISSING_HERO_SHA256",
    ).toLowerCase(),
    source: requiredString(raw.source, "MISSING_SOURCE"),
    // Optional: without it the seed still runs and simply omits every block
    // that needs media, which is how the pilot shipped before the upload
    // existed.
    mediaManifest: raw.mediaManifest ? resolve(raw.mediaManifest) : null,
    apply: raw.apply === true,
  };
  if (![options.siteId, options.brandId, options.tenantId, options.configuredBy].every((id) => UUID.test(id))) {
    fail("INVALID_ID");
  }
  if (options.brandId !== GOGI_BRAND_ID) fail("WRONG_GOGI_BRAND");
  if (options.configuredBy !== GOGI_CONFIGURED_BY) fail("WRONG_CONFIGURED_BY");
  if (options.source !== GOGI_SOURCE) fail("UNSUPPORTED_SOURCE");
  if (!SHA256.test(options.heroSha256)) fail("INVALID_HERO_SHA256");
  return options;
}

async function sha256File(path) {
  const digest = createHash("sha256");
  await new Promise((resolvePromise, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => digest.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolvePromise);
  });
  return digest.digest("hex");
}

function detectImage(bytes) {
  if (
    bytes.length >= 4 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff &&
    bytes.at(-2) === 0xff &&
    bytes.at(-1) === 0xd9
  ) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 20 &&
    Buffer.from(bytes.subarray(0, 8)).toString("hex") === "89504e470d0a1a0a" &&
    Buffer.from(bytes.subarray(bytes.length - 12)).toString("hex") ===
      "0000000049454e44ae426082"
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF" &&
    Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP" &&
    bytes.readUInt32LE(4) + 8 === bytes.length
  ) {
    return "image/webp";
  }
  fail("UNSUPPORTED_HERO_IMAGE");
}

/*
 * The manifest is written by upload-gogi-media.mjs: slot -> media id. Every
 * value must be a real id, because a block that references a non-existent
 * media row publishes an artifact whose images 404.
 */
export async function loadMediaManifest(path) {
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    fail("MEDIA_MANIFEST_MISSING");
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail("MEDIA_MANIFEST_INVALID");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    fail("MEDIA_MANIFEST_INVALID");
  }
  for (const value of Object.values(parsed)) {
    if (typeof value !== "string" || !UUID.test(value)) fail("MEDIA_MANIFEST_INVALID");
  }
  return parsed;
}

export async function inspectHero(path, expectedSha256) {
  let metadata;
  try {
    metadata = await lstat(path);
  } catch {
    fail("HERO_IMAGE_MISSING");
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) fail("HERO_IMAGE_NOT_REGULAR");
  if (metadata.size < 1 || metadata.size > MAX_BYTES) fail("HERO_IMAGE_SIZE_INVALID");
  const actualSha256 = await sha256File(path);
  if (actualSha256 !== expectedSha256) fail("HERO_SHA256_MISMATCH");
  const bytes = await readFile(path);
  const mime = detectImage(bytes);
  return {
    bytes,
    byteLength: metadata.size,
    mime,
    sha256: actualSha256,
    filename: deterministicHeroFilename(expectedSha256, mime),
  };
}

export function validateStudioSession(sessionValue, csrfValue, options, nowSeconds = Math.floor(Date.now() / 1000)) {
  const decodedValue = decodeURIComponent(requiredString(sessionValue, "MISSING_STUDIO_SESSION"));
  const [encoded, signature, extra] = decodedValue.split(".");
  if (
    !encoded ||
    !signature ||
    extra ||
    !/^[A-Za-z0-9_-]+$/.test(encoded) ||
    !/^[A-Za-z0-9_-]{43}$/.test(signature)
  ) {
    fail("INVALID_STUDIO_SESSION");
  }
  let claims;
  try {
    claims = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    fail("INVALID_STUDIO_SESSION");
  }
  if (
    !claims ||
    claims.version !== 1 ||
    claims.site_id !== options.siteId ||
    claims.brand_id !== options.brandId ||
    claims.tenant_id !== options.tenantId ||
    claims.user_id !== options.configuredBy ||
    !Number.isInteger(claims.rank) ||
    claims.rank < 50 ||
    !Number.isInteger(claims.issued_at) ||
    claims.issued_at > nowSeconds + 5 ||
    !Number.isInteger(claims.absolute_expires_at) ||
    !Number.isInteger(claims.idle_expires_at) ||
    claims.absolute_expires_at <= nowSeconds ||
    claims.idle_expires_at <= nowSeconds ||
    claims.return_surface !== "web"
  ) {
    fail("STUDIO_SESSION_SCOPE_MISMATCH");
  }
  const csrf = requiredString(csrfValue, "MISSING_STUDIO_CSRF");
  if (!/^[A-Za-z0-9_-]{43}$/.test(csrf)) fail("INVALID_STUDIO_CSRF");
  return { session: decodedValue, csrf };
}

async function parseJsonResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    fail("CMS_RESPONSE_INVALID");
  }
  try {
    return await response.json();
  } catch {
    fail("CMS_RESPONSE_INVALID");
  }
}

export class CmsSeedClient {
  constructor({ session, csrf, fetchImpl = fetch }) {
    this.session = session;
    this.csrf = csrf;
    this.fetchImpl = fetchImpl;
  }

  headers(mutating = false) {
    return {
      accept: "application/json",
      cookie: `${STUDIO_COOKIE}=${encodeURIComponent(this.session)}; ${STUDIO_CSRF_COOKIE}=${this.csrf}`,
      ...(mutating
        ? {
            "content-type": "application/json",
            origin: CMS_ORIGIN,
            "x-mingla-csrf": this.csrf,
          }
        : {}),
    };
  }

  async request(path, init = {}) {
    let response;
    try {
      response = await this.fetchImpl(`${CMS_ORIGIN}${path}`, {
        redirect: "error",
        cache: "no-store",
        ...init,
      });
    } catch {
      fail("CMS_UNAVAILABLE");
    }
    const body = await parseJsonResponse(response);
    if (!response.ok || body?.ok === false) fail("CMS_REQUEST_REJECTED");
    return body;
  }

  async collection(slug, limit) {
    const params = new URLSearchParams({
      depth: "0",
      limit: String(limit),
      draft: "true",
    });
    const body = await this.request(`/api/${slug}?${params}`, {
      method: "GET",
      headers: this.headers(false),
    });
    if (!Array.isArray(body.docs)) fail("CMS_RESPONSE_INVALID");
    return body.docs;
  }

  async readState() {
    const [pages, settings, navigation, footer, library] = await Promise.all([
      this.collection("pages", 5),
      this.collection("site-settings", 1),
      this.collection("navigation", 1),
      this.collection("footer", 1),
      this.request("/api/mingla/media-library", {
        method: "GET",
        headers: this.headers(false),
      }),
    ]);
    if (!Array.isArray(library?.data?.media)) fail("CMS_RESPONSE_INVALID");
    return { pages, settings, navigation, footer, media: library.data.media };
  }

  async mutateCollection(method, slug, id, data) {
    const suffix = id ? `/${encodeURIComponent(id)}` : "";
    const body = await this.request(`/api/${slug}${suffix}?draft=true&depth=0`, {
      method,
      headers: this.headers(true),
      body: JSON.stringify(data),
    });
    const document = body?.doc ?? body;
    if (!document || typeof document !== "object" || !document.id) {
      fail("CMS_RESPONSE_INVALID");
    }
    return document;
  }

  updatePage(document, data) {
    return this.mutateCollection("PATCH", "pages", String(document.id), {
      ...data,
      revision: document.revision,
    });
  }

  createPage(data) {
    return this.mutateCollection("POST", "pages", null, data);
  }

  updateNavigation(document, data) {
    return this.mutateCollection("PATCH", "navigation", String(document.id), data);
  }

  updateFooter(document, data) {
    return this.mutateCollection("PATCH", "footer", String(document.id), data);
  }

  updateSettings(document, data) {
    return this.mutateCollection("PATCH", "site-settings", String(document.id), data);
  }

  uploadHero(hero) {
    return this.uploadAsset(hero);
  }

  async uploadAsset(hero) {
    const grantEnvelope = await this.request("/api/mingla/media/upload-grants", {
      method: "POST",
      headers: this.headers(true),
      body: JSON.stringify({
        filename: hero.filename,
        content_type: hero.mime,
        bytes: hero.byteLength,
      }),
    });
    const grant = grantEnvelope?.data;
    const mediaId = String(grant?.media_id || "");
    if (!UUID.test(mediaId) || typeof grant?.upload_url !== "string") {
      fail("MEDIA_GRANT_INVALID");
    }
    const uploadUrl = new URL(grant.upload_url);
    if (
      uploadUrl.protocol !== "https:" ||
      !uploadUrl.hostname.endsWith(".storage.supabase.co") ||
      !uploadUrl.pathname.startsWith(
        "/storage/v1/s3/sites-media-quarantine/quarantine/",
      )
    ) {
      fail("MEDIA_GRANT_INVALID");
    }
    const requiredHeaders = grant.required_headers;
    if (
      !requiredHeaders ||
      typeof requiredHeaders !== "object" ||
      Array.isArray(requiredHeaders) ||
      requiredHeaders["content-type"] !== hero.mime ||
      requiredHeaders["if-none-match"] !== "*" ||
      requiredHeaders["x-amz-content-sha256"] !== "UNSIGNED-PAYLOAD" ||
      Object.keys(requiredHeaders).some(
        (key) =>
          !["content-type", "if-none-match", "x-amz-content-sha256"].includes(
            key.toLowerCase(),
          ),
      )
    ) {
      fail("MEDIA_GRANT_INVALID");
    }
    let upload;
    try {
      upload = await this.fetchImpl(uploadUrl, {
        method: "PUT",
        headers: requiredHeaders,
        body: hero.bytes,
        redirect: "error",
      });
    } catch {
      fail("MEDIA_UPLOAD_FAILED");
    }
    if (!upload.ok) fail("MEDIA_UPLOAD_FAILED");
    const completed = await this.request(
      `/api/mingla/media/${encodeURIComponent(mediaId)}/complete`,
      {
        method: "POST",
        headers: this.headers(true),
        body: JSON.stringify({ checksum: hero.sha256, bytes: hero.byteLength }),
      },
    );
    if (completed?.data?.state !== "READY" || completed?.data?.media_id !== mediaId) {
      fail("MEDIA_PROCESSING_FAILED");
    }
    return mediaId;
  }
}

export async function reconcileSeed(client, options, hero, media = {}) {
  let snapshot = await client.readState();
  let plan = classifySnapshot(snapshot, {
    tenantId: options.tenantId,
    heroFilename: hero.filename,
    media,
  });
  if (!options.apply || plan.state === "seeded") {
    return {
      mode: options.apply ? "apply" : "dry-run",
      state: plan.state,
      actions: plan.actions,
      changed: false,
    };
  }
  let heroMediaId = plan.heroMediaId;
  if (!heroMediaId) {
    heroMediaId = await client.uploadHero(hero);
    snapshot = await client.readState();
    plan = classifySnapshot(snapshot, {
      tenantId: options.tenantId,
      heroFilename: hero.filename,
      media,
    });
    if (plan.heroMediaId !== heroMediaId) fail("MEDIA_READBACK_MISMATCH");
  }
  const documents = { ...plan.pages };
  const idsOf = () => ({
    heroMediaId,
    media,
    tenantId: options.tenantId,
    homeId: String(documents.home.id),
    aboutId: documents.about ? String(documents.about.id) : "pending-about",
    menuId: documents.menu ? String(documents.menu.id) : "pending-menu",
    galleryId: documents.gallery ? String(documents.gallery.id) : "pending-gallery",
    contactId: documents.contact ? String(documents.contact.id) : "pending-contact",
    /*
     * #3149 wave 4 — the sixth page needs an id here for the same reason the
     * other four do.
     *
     * Missing from this map, the reservations page is still CREATED (the loop
     * below walks SEED_PAGE_ROLES) but the navigation re-derived from these
     * ids never names it: a real page, reachable by URL, absent from every
     * menu on the site. That is precisely the #2830 defect this function was
     * written to end — "About and Menu were described but never created" —
     * reappearing one role along, and the caller suite caught it.
     */
    reservationsId: documents.reservations
      ? String(documents.reservations.id)
      : "pending-reservations",
  });
  let target = seedDocuments(idsOf());

  for (const role of SEED_PAGE_ROLES) {
    const state = plan.states[role];
    const desired = target[role];
    if (state === "absent") {
      if (!desired.enabled) continue;
      documents[role] = await client.createPage(desired);
    } else if (state === "baseline" || state === "prior_seed") {
      documents[role] = await client.updatePage(documents[role], desired);
    }
  }
  // Every page this seed says belongs on the site has to exist and carry a real
  // id before the navigation is written, or the navigation names pages that
  // were never created -- which is exactly how this shipped with two pages.
  for (const role of SEED_PAGE_ROLES) {
    if (target[role].enabled && !documents[role]?.id) fail("PAGE_READBACK_MISSING");
  }

  // Re-derive once the ids are real: the navigation is built from them.
  target = seedDocuments(idsOf());
  const needsWrite = (state) => state === "baseline" || state === "prior_seed";
  if (needsWrite(plan.states.navigation)) {
    await client.updateNavigation(plan.navigation, target.navigation);
  }
  if (needsWrite(plan.states.footer)) {
    await client.updateFooter(plan.footer, target.footer);
  }
  if (needsWrite(plan.states.settings)) {
    await client.updateSettings(plan.settings, target.settings);
  }
  const finalSnapshot = await client.readState();
  const finalPlan = classifySnapshot(finalSnapshot, {
    tenantId: options.tenantId,
    heroFilename: hero.filename,
    media,
  });
  if (finalPlan.state !== "seeded") fail("SEED_READBACK_MISMATCH");
  return { mode: "apply", state: "seeded", actions: [], changed: true };
}

export async function run(argv, environment = process.env, dependencies = {}) {
  const options = validateOptions(parseArgs(argv));
  const hero = await inspectHero(options.heroImage, options.heroSha256);
  const credentials = validateStudioSession(
    environment.MINGLA_SITES_SEED_STUDIO_COOKIE,
    environment.MINGLA_SITES_SEED_STUDIO_CSRF,
    options,
  );
  const client = dependencies.client ?? new CmsSeedClient({
    ...credentials,
    fetchImpl: dependencies.fetchImpl ?? fetch,
  });
  const media = options.mediaManifest
    ? await loadMediaManifest(options.mediaManifest)
    : {};
  const result = await reconcileSeed(client, options, hero, media);
  return {
    ok: true,
    ...result,
    site_id: options.siteId,
    brand_id: options.brandId,
    tenant_id: options.tenantId,
    source: options.source,
    hero_sha256: options.heroSha256,
  };
}

async function main() {
  try {
    const result = await run(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    const code = error instanceof SeedError ? error.code : "SEED_OPERATOR_FAILED";
    process.stderr.write(`${JSON.stringify({ ok: false, error: code })}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
