import { isFontPairing, type FontPairing } from "./fontPairings";

export const RENDERER_KEY = "restaurant-website-v1" as const;
export const ARTIFACT_SCHEMA_VERSION = 1 as const;

type JsonObject = Record<string, unknown>;

export type MediaReference = {
  id: string;
  url: string;
  alt: string;
  width: number;
  height: number;
  integrity: string;
  object_key: string;
};

export type RestaurantBlock = {
  type: "hero" | "rich_text" | "media_feature" | "cta" | "offering_grid" |
    "venue_reservation" | "menu_link" | "menu_board" | "menu_preview" |
    "gallery" | "hours_location" |
    "video_feature" | "team" |
    "testimonials" | "faq" | "contact_handoff" | "divider" | "spacer" |
    // #3149 wave 3 — the four shapes the reference has and this had no way to
    // carry: a scrolling strip of phrases, a row of figures, a pulled
    // quotation, and a map of one place.
    "marquee" | "stats" | "pull_quote" | "map_embed";
  [key: string]: unknown;
};

export type RestaurantArtifact = {
  schema_version: 1;
  site_id: string;
  brand_id: string;
  renderer_key: typeof RENDERER_KEY;
  renderer_version: number;
  publication_id: string;
  source_revision_id: string;
  source_digest: string;
  generated_at: string;
  pages: Array<{
    /*
     * #3149 wave 4 — `reservations` is the sixth and last role.
     *
     * A CLOSED union on purpose: a page role is a thing this renderer knows
     * how to be, not a free label, and every cap below counts against it.
     */
    role: "home" | "about" | "menu" | "gallery" | "contact" | "reservations";
    slug: string;
    title: string;
    enabled: boolean;
    nav_label: string;
    nav_order: number;
    blocks: RestaurantBlock[];
    seo?: { title?: string; description?: string };
  }>;
  navigation: { page_roles: string[] };
  footer: { address?: string; hours_summary?: string; legal_text?: string; links?: Array<{ label: string; href: string }> };
  site_settings: {
    display_name: string;
    short_description?: string;
    logo?: MediaReference;
    colors?: { background?: string; foreground?: string; accent?: string };
    typography?: FontPairing;
    seo?: { title?: string; description?: string; canonical_url: string; social_image?: MediaReference };
  };
  media: MediaReference[];
  commercial_references: Array<{ kind: "offering" | "reservation" | "checkout"; id: string; url: string }>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
const SAFE_KEYS = new Set([
  "schema_version", "site_id", "brand_id", "renderer_key", "renderer_version",
  "publication_id", "source_revision_id", "source_digest", "generated_at",
  "pages", "navigation", "footer", "site_settings", "media", "commercial_references",
]);
const FORBIDDEN_TEXT =
  /<(?:script|style|iframe|svg)|\son[a-z]+\s*=|javascript:|data:|blob:|file:/i;

function hasOnlyKeys(value: JsonObject, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function boundedText(
  value: unknown,
  max: number,
  required = false,
): boolean {
  return (
    (!required && value == null) ||
    (typeof value === "string" &&
      value.length <= max &&
      (!required || value.length > 0) &&
      !FORBIDDEN_TEXT.test(value))
  );
}

function exactRows(
  value: unknown,
  min: number,
  max: number,
  keys: readonly string[],
  validate: (row: JsonObject) => boolean,
): boolean {
  return Array.isArray(value) &&
    value.length >= min &&
    value.length <= max &&
    value.every((row) =>
      plainObject(row) && hasOnlyKeys(row, keys) && validate(row)
    );
}

/*
 * #3149 wave 4 — THE ICON IS A NAME FROM THIS LIST OR THERE IS NO ICON.
 *
 * The reference site draws its four cards with an icon font, pulling glyph
 * names out of a third-party stylesheet. A published site here may not: an
 * icon that arrives as markup is a script tag waiting to happen, and one that
 * arrives as a URL is a third-party request on a page that makes none.
 *
 * So a figure names one of six drawings this runtime already ships, and any
 * other value fails the publish rather than rendering a blank square. Widening
 * this list means shipping the drawing first.
 */
export const STATS_ICONS = [
  "clock",
  "bowl",
  "music",
  "card",
  "pin",
  "phone",
] as const;

export type StatsIcon = (typeof STATS_ICONS)[number];

export function isStatsIcon(value: unknown): value is StatsIcon {
  return typeof value === "string" &&
    (STATS_ICONS as readonly string[]).includes(value);
}

/*
 * #3149 wave 4 — A CLOCK NEEDS A ZONE, AND THE ZONE IS AN IANA NAME.
 *
 * The live "open now, 22:03 in Lagos" line is a claim about a real moment in a
 * real city. An offset would drift across a daylight-saving boundary and a
 * display string ("WAT", "GMT+1") is not something a clock can be built from.
 *
 * Two checks, both needed. The shape test refuses anything that is not
 * `Region/City` (so a bare "UTC" or a stray path never reaches the formatter),
 * and then the platform is ASKED whether it knows the zone — `Intl` throws a
 * RangeError on one it cannot resolve, and a zone the renderer cannot format
 * would print the server's own time under a city's name, which is worse than
 * printing nothing.
 */
export function isIanaTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 60) return false;
  if (!/^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+){1,2}$/.test(value)) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function isSafeHref(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048 || /[\u0000-\u001F\u007F]/.test(value)) return false;
  if (value.startsWith("/")) return !value.startsWith("//") && !value.includes("\\");
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    return url.protocol === "https:" || url.protocol === "mailto:" || url.protocol === "tel:";
  } catch { return false; }
}

export function isCanonicalMinglaHref(value: unknown): value is string {
  if (!isSafeHref(value) || value.startsWith("/")) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      (url.hostname === "usemingla.com" || url.hostname.endsWith(".usemingla.com"));
  } catch {
    return false;
  }
}

function plainObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertMediaReference(value: unknown, siteId: string): void {
  if (
    !plainObject(value) ||
    !hasOnlyKeys(value, [
      "id",
      "url",
      "alt",
      "width",
      "height",
      "integrity",
      "object_key",
    ]) ||
    typeof value.id !== "string" ||
    !UUID.test(value.id) ||
    typeof value.url !== "string" ||
    (!value.url.startsWith(`/media/${value.id}/`) &&
      !value.url.startsWith(
        `https://gogi.sites.usemingla.com/media/${value.id}/`,
      )) ||
    !boundedText(value.alt, 240) ||
    !Number.isInteger(value.width) ||
    !Number.isInteger(value.height) ||
    typeof value.integrity !== "string" ||
    !DIGEST.test(value.integrity) ||
    typeof value.object_key !== "string" ||
    !value.object_key.startsWith(`approved/${siteId}/${value.id}/`)
  ) throw new Error("ARTIFACT_MEDIA_MISMATCH");
  /*
   * #2830 — an image and a video are different objects with different rules,
   * and the difference is load-bearing rather than cosmetic.
   *
   * An IMAGE is a webp rendition and must declare real pixel dimensions: the
   * layout reserves that box, and a zero there is a page that reflows under
   * the reader.
   *
   * A VIDEO is stored as uploaded — there is no ffmpeg in this pipeline, so no
   * renditions and no probed dimensions. Its box comes from the poster it sits
   * behind, so it declares 0x0 deliberately rather than carrying an invented
   * 1920x1080. What is NOT relaxed is the digest or the tenant-scoped key: a
   * video is integrity-checked on serve exactly like every image.
   */
  const isVideo = value.object_key.endsWith(".mp4");
  if (isVideo) {
    if (
      !value.url.endsWith("/video.mp4") ||
      Number(value.width) !== 0 || Number(value.height) !== 0
    ) throw new Error("ARTIFACT_MEDIA_MISMATCH");
    return;
  }
  if (
    !value.object_key.endsWith(".webp") ||
    Number(value.width) < 1 || Number(value.height) < 1
  ) throw new Error("ARTIFACT_MEDIA_MISMATCH");
}

function assertRestaurantBlock(block: JsonObject, siteId: string): void {
  const type = String(block.type);
  /*
   * #3149 — `eyebrow` is the small line ABOVE a section heading, and it is the
   * BRAND'S OWN WORDS.
   *
   * The renderer used to supply one per block type ("Gallery", "Film",
   * "Team"), because a block had nowhere to carry the brand's. gogi's own site
   * writes every one of them — "The place", "The menu", "Straight from
   * @gogilagos" — and a generic label in that slot is the single loudest way
   * our render reads as a template rather than as their site.
   *
   * OPTIONAL EVERYWHERE, and absent means NO EYEBROW: nothing invents copy on
   * a brand's behalf any more. It is NOT offered on `hero` (the headline is
   * already two-tone and carries the page's one h1), nor on `divider` or
   * `spacer`, which render no heading to sit above.
   *
   * `group_heading` is `video_feature` only: a RUN of reels renders as one
   * grid, and this titles that grid. It cannot live on any other type because
   * no other type groups.
   */
  const definitions: Record<string, readonly string[]> = {
    hero: ["type", "heading", "subheading", "media_url", "video_url", "ctas"],
    rich_text: ["type", "eyebrow", "heading", "paragraphs"],
    /*
     * #3149 wave 4 — this is the STORY section, and on the reference it is one
     * composite: prose, the line worth quoting, a button onward, and a
     * circular crop of a photograph with a badge on it. Ours rendered the
     * prose and the quotation as two unrelated bands with no image between
     * them.
     *
     * Every added key is OPTIONAL and every one of them absent is the block
     * that shipped: an image feature with a heading and a caption.
     */
    media_feature: [
      "type",
      "eyebrow",
      "media_url",
      "alt",
      "heading",
      "caption",
      "alignment",
      "media_shape",
      "badge_figure",
      "badge_label",
      "quote",
      "quote_attribution",
      "cta_label",
      "cta_href",
    ],
    cta: ["type", "eyebrow", "heading", "body", "label", "href"],
    offering_grid: ["type", "eyebrow", "heading", "offerings"],
    venue_reservation: ["type", "eyebrow", "heading", "body", "url"],
    menu_link: ["type", "eyebrow", "heading", "label", "href"],
    menu_board: ["type", "eyebrow", "heading", "note", "venue_id", "sections"],
    /*
     * #3149 wave 4 — A TASTE OF THE MENU, AND A SEPARATE BLOCK BECAUSE IT IS A
     * SEPARATE THING.
     *
     * `menu_board` is the menu: every section, and a cart. This is the few
     * dishes a home page shows with a button to that page, beside a handful of
     * photographs. It could have been three more settings on `menu_board`, and
     * it deliberately is not: that block is pinned to presentation-only by the
     * menu-authority suite, and "the menu" and "a taste of the menu" are two
     * different pieces of a restaurant's page rather than one with a mode.
     *
     * IT HOLDS NO ITEMS OF ITS OWN — `sections` here is the SAME projection
     * from Mingla that `menu_board` receives, shortened. There is no field a
     * brand can type a dish or a price into, so the website still cannot
     * disagree with the app about what is sold or what it costs.
     */
    menu_preview: [
      "type",
      "eyebrow",
      "heading",
      "note",
      "sections",
      "section_limit",
      "item_limit",
      "images",
      "cta_label",
      "cta_href",
    ],
    gallery: ["type", "eyebrow", "heading", "images"],
    video_feature: [
      "type",
      "eyebrow",
      "group_heading",
      "group_cta_label",
      "group_cta_href",
      "heading",
      "caption",
      "video_url",
      "poster_url",
    ],
    team: [
      "type",
      "eyebrow",
      "heading",
      "caption",
      "members",
      "preview_count",
      "cta_label",
      "cta_href",
    ],
    hours_location: [
      "type",
      "eyebrow",
      "heading",
      "address",
      "map_url",
      "hours",
      "timezone",
      "always_open",
    ],
    testimonials: ["type", "eyebrow", "heading", "items"],
    faq: ["type", "eyebrow", "heading", "items"],
    contact_handoff: ["type", "eyebrow", "heading", "body", "label", "href"],
    divider: ["type"],
    spacer: ["type", "size"],
    /*
     * #3149 wave 3 — NO EYEBROW ON THESE TWO, on purpose.
     *
     * The eyebrow is the line printed ABOVE A HEADING. A marquee is a ticker
     * and a pull-quote is a quotation; neither renders a heading, so an
     * eyebrow on either would have nothing to sit above. `divider` and
     * `spacer` are excluded for the same reason.
     */
    marquee: ["type", "phrases"],
    pull_quote: ["type", "quote", "attribution"],
    stats: ["type", "eyebrow", "heading", "body", "items"],
    map_embed: [
      "type",
      "eyebrow",
      "heading",
      "body",
      "latitude",
      "longitude",
      "place_label",
      "directions_url",
    ],
  };
  if (!definitions[type] || !hasOnlyKeys(block, definitions[type])) {
    throw new Error("ARTIFACT_BLOCK_TYPE_MISMATCH");
  }
  /*
   * Both get exactly the treatment `heading` gets — optional, bounded, and run
   * through the same forbidden-markup screen. Checked once rather than in
   * fifteen branches: the map above is what decides WHICH types may carry
   * them, and a type that may not never reaches here with one set.
   */
  if (
    !boundedText(block.eyebrow, 120) || !boundedText(block.group_heading, 120)
  ) {
    throw new Error("ARTIFACT_BLOCK_CONTENT_MISMATCH");
  }
  const safeLink = (value: unknown) => value == null || isSafeHref(value);
  let valid = false;
  switch (type) {
    case "hero":
      valid = boundedText(block.heading, 120, true) &&
        boundedText(block.subheading, 300) &&
        // The still is REQUIRED and the video is not: the video is an
        // enhancement over the poster, never a replacement for it.
        isSafeHref(block.media_url) &&
        (block.video_url == null || isSafeHref(block.video_url)) &&
        exactRows(block.ctas, 0, 2, ["label", "href"], (row) =>
          boundedText(row.label, 80, true) && isSafeHref(row.href));
      break;
    case "rich_text":
      valid = boundedText(block.heading, 120) &&
        exactRows(block.paragraphs, 1, 30, ["text"], (row) =>
          boundedText(row.text, 2_000, true));
      break;
    case "media_feature":
      valid = isSafeHref(block.media_url) &&
        boundedText(block.alt, 240, true) &&
        boundedText(block.heading, 120) &&
        boundedText(block.caption, 500) &&
        ["left", "right"].includes(String(block.alignment)) &&
        /*
         * #3149 wave 4 — a CROP, not a filter. The only shapes offered are the
         * rectangle this always drew and the circle the reference uses, and
         * absent means rectangle, so nothing about an already-published block
         * moves.
         */
        (block.media_shape == null ||
          ["rectangle", "circle"].includes(String(block.media_shape))) &&
        /*
         * The badge is TWO short lines — "24/7" over "ALWAYS ON" — and it is
         * printed only when the brand wrote the big one. A label with no
         * figure would be a caption floating over a photograph.
         */
        boundedText(block.badge_figure, 24) &&
        boundedText(block.badge_label, 40) &&
        boundedText(block.quote, 600) &&
        boundedText(block.quote_attribution, 120) &&
        boundedText(block.cta_label, 80) &&
        safeLink(block.cta_href);
      break;
    case "cta":
      valid = boundedText(block.heading, 120, true) &&
        boundedText(block.body, 500) &&
        boundedText(block.label, 80, true) && isSafeHref(block.href);
      break;
    case "offering_grid":
      valid = boundedText(block.heading, 120) &&
        exactRows(
          block.offerings,
          1,
          12,
          ["id", "label", "summary", "url"],
          (row) =>
            typeof row.id === "string" && UUID.test(row.id) &&
            boundedText(row.label, 200, true) &&
            boundedText(row.summary, 500) && isCanonicalMinglaHref(row.url),
        );
      break;
    case "venue_reservation":
      valid = boundedText(block.heading, 120, true) &&
        boundedText(block.body, 500) && isCanonicalMinglaHref(block.url);
      break;
    case "menu_link":
      valid = boundedText(block.heading, 120) &&
        boundedText(block.label, 80, true) && isSafeHref(block.href);
      break;
    /*
     * #2830 — the real menu, owned by Mingla.
     *
     * `menu_link` only ever pointed at a PDF. This carries the actual items,
     * projected from Mingla's own `menus` / `menu_items` at publish time, so
     * the website and the app cannot disagree about what a restaurant sells.
     *
     * PRICE IS DELIBERATELY NULLABLE AND SEPARATE FROM CURRENCY. Mingla stores
     * price in MINOR units with NULL meaning "price on request"; a menu that
     * renders a missing price as 0, or guesses a currency, is fabricated data
     * (Constitution rule 9) and, for a restaurant, a live commercial lie. Both
     * must be present for a number to be shown, and the renderer enforces it.
     */
    case "menu_board":
      valid = boundedText(block.heading, 120) &&
        boundedText(block.note, 300) &&
        (block.venue_id == null || (typeof block.venue_id === "string" && UUID.test(block.venue_id))) &&
        exactRows(block.sections, 1, 20, ["name", "description", "items"], (section) =>
          boundedText(section.name, 120, true) &&
          boundedText(section.description, 500) &&
          exactRows(section.items, 1, 120, ["id", "name", "description", "price_minor", "currency"], (item) =>
            (typeof item.id === "string" && UUID.test(item.id)) &&
            boundedText(item.name, 160, true) &&
            boundedText(item.description, 600) &&
            (item.price_minor == null ||
              (typeof item.price_minor === "number" &&
                Number.isInteger(item.price_minor) &&
                item.price_minor >= 0 &&
                item.price_minor <= 100_000_000)) &&
            (item.currency == null ||
              (typeof item.currency === "string" &&
                /^[A-Z]{3}$/.test(item.currency)))));
      break;
    /*
     * #3149 wave 4 — the taste of the menu. Same section shape as above, so
     * the same rules about a price hold: it is nullable, its currency travels
     * with it, and neither is ever defaulted.
     *
     * THE CAPS CAN ONLY EVER HIDE. Both are whole numbers, both bounded, and
     * nothing here can add a row — the shortest path to a wrong price on a
     * restaurant's own website is a second copy of the menu, and there is no
     * way to write one.
     */
    case "menu_preview":
      valid = boundedText(block.heading, 120) &&
        boundedText(block.note, 300) &&
        (block.section_limit == null ||
          (typeof block.section_limit === "number" &&
            Number.isInteger(block.section_limit) &&
            block.section_limit >= 1 && block.section_limit <= 6)) &&
        (block.item_limit == null ||
          (typeof block.item_limit === "number" &&
            Number.isInteger(block.item_limit) &&
            block.item_limit >= 1 && block.item_limit <= 12)) &&
        boundedText(block.cta_label, 80) && safeLink(block.cta_href) &&
        (block.images == null ||
          (Array.isArray(block.images) && block.images.length >= 1 &&
            block.images.length <= 4)) &&
        exactRows(block.sections, 1, 20, ["name", "description", "items"], (section) =>
          boundedText(section.name, 120, true) &&
          boundedText(section.description, 500) &&
          exactRows(section.items, 1, 120, ["id", "name", "description", "price_minor", "currency"], (item) =>
            (typeof item.id === "string" && UUID.test(item.id)) &&
            boundedText(item.name, 160, true) &&
            boundedText(item.description, 600) &&
            (item.price_minor == null ||
              (typeof item.price_minor === "number" &&
                Number.isInteger(item.price_minor) &&
                item.price_minor >= 0 &&
                item.price_minor <= 100_000_000)) &&
            (item.currency == null ||
              (typeof item.currency === "string" &&
                /^[A-Z]{3}$/.test(item.currency)))));
      if (valid && Array.isArray(block.images)) {
        for (const image of block.images as unknown[]) {
          assertMediaReference(image, siteId);
        }
      }
      break;
    /*
     * #2830 — a short film with a still under it. gogi's own site runs their
     * Instagram reels this way, and the reels ARE the content: the captions are
     * their words and the footage is their room.
     *
     * The poster is required for the same reason it is on the hero: a video
     * that has not arrived must still leave something on the page.
     */
    case "video_feature":
      valid = boundedText(block.heading, 120) &&
        boundedText(block.caption, 600) &&
        isSafeHref(block.video_url) &&
        isSafeHref(block.poster_url) &&
        // #3149 wave 4 — read off the FIRST film of a run, like the heading
        // above it, because the button belongs to the grid and not to a film.
        boundedText(block.group_cta_label, 80) &&
        safeLink(block.group_cta_href);
      break;
    /*
     * The people. gogi published ten nicknames for their team and no real
     * names, so `name` is what they chose to publish and a portrait is
     * OPTIONAL — several of them exist only as a moment in a reel.
     */
    case "team":
      valid = boundedText(block.heading, 120) &&
        boundedText(block.caption, 600) &&
        /*
         * #3149 wave 4 — how many of them are on the page, and where the rest
         * are. The reference shows five of ten with a button under the grid;
         * absent means every member is shown, which is what this always did.
         */
        (block.preview_count == null ||
          (typeof block.preview_count === "number" &&
            Number.isInteger(block.preview_count) &&
            block.preview_count >= 1 && block.preview_count <= 24)) &&
        boundedText(block.cta_label, 80) && safeLink(block.cta_href) &&
        exactRows(block.members, 1, 24, ["name", "role", "media_url", "alt"], (row) =>
          boundedText(row.name, 80, true) &&
          boundedText(row.role, 80) &&
          (row.media_url == null || isSafeHref(row.media_url)) &&
          boundedText(row.alt, 240));
      break;
    case "gallery":
      valid = boundedText(block.heading, 120) && Array.isArray(block.images) &&
        block.images.length >= 1 && block.images.length <= 12;
      if (valid) {
        for (const image of block.images as unknown[]) {
          assertMediaReference(image, siteId);
        }
      }
      break;
    /*
     * #3149 wave 4 — the two fields that make a LIVE open/closed claim
     * possible without modelling opening hours.
     *
     * `hours` is and stays a list of DISPLAY STRINGS with no timezone: nothing
     * can read "Open 24 hours" and know when the kitchen shuts. So the live
     * pill is refused any inference from them. `always_open` is the brand
     * saying, in a field, that there is no closing time, and `timezone` is the
     * one thing a clock needs. A venue with ordinary hours sets neither and
     * gets no pill at all until real opening hours are modelled.
     *
     * They are independent here on purpose — a half-filled Studio form must
     * not fail a publish — and the renderer requires BOTH before it prints a
     * word about whether anywhere is open.
     */
    case "hours_location":
      valid = boundedText(block.heading, 120) &&
        boundedText(block.address, 300, true) && safeLink(block.map_url) &&
        (block.timezone == null || isIanaTimeZone(block.timezone)) &&
        (block.always_open == null ||
          typeof block.always_open === "boolean") &&
        exactRows(block.hours, 1, 7, ["day", "value"], (row) =>
          boundedText(row.day, 20, true) && boundedText(row.value, 80, true));
      break;
    case "testimonials":
      valid = boundedText(block.heading, 120) &&
        exactRows(block.items, 1, 8, ["name", "quote"], (row) =>
          boundedText(row.name, 120, true) &&
          boundedText(row.quote, 500, true));
      break;
    case "faq":
      valid = boundedText(block.heading, 120) &&
        exactRows(block.items, 1, 12, ["question", "answer"], (row) =>
          boundedText(row.question, 240, true) &&
          boundedText(row.answer, 1_000, true));
      break;
    case "contact_handoff":
      valid = boundedText(block.heading, 120, true) &&
        boundedText(block.body, 500) &&
        boundedText(block.label, 80, true) && isSafeHref(block.href);
      break;
    case "divider":
      valid = true;
      break;
    case "spacer":
      valid = ["small", "medium", "large"].includes(String(block.size));
      break;
    /*
     * #3149 — the scrolling strip under the hero.
     *
     * At least TWO phrases, because the strip prints a separator between them
     * and repeats to loop: one phrase is a sentence with a stray dot after it,
     * not a ticker. The cap is what fits one revolution at a readable speed.
     */
    case "marquee":
      valid = exactRows(block.phrases, 2, 12, ["text"], (row) =>
        boundedText(row.text, 80, true));
      break;
    /*
     * A quotation lifted out of the prose. The attribution is OPTIONAL and is
     * never invented: gogi's own site cites "gögi, on Instagram" under theirs,
     * and a quote whose source the brand did not publish simply carries none.
     */
    case "pull_quote":
      valid = boundedText(block.quote, 600, true) &&
        boundedText(block.attribution, 120);
      break;
    /*
     * A row of figure-and-label pairs. `figure` is the large line and `label`
     * the small one under it; the label is optional because a figure can stand
     * alone. Both are plain strings rather than numbers — "Open 24 hours" is a
     * figure on a restaurant's site and coercing it to a number would either
     * drop it or print a zero.
     */
    /*
     * #3149 wave 4 — a figure now carries a SENTENCE, a named drawing, and a
     * flag saying it is the one being pointed at. The reference's four cards
     * are exactly that: icon, title, sentence, one of them ringed in gold.
     *
     * `icon` is a NAME FROM A CLOSED LIST, never markup and never a URL — see
     * STATS_ICONS. All three are optional and all three absent is the row of
     * bare figures this shipped as.
     */
    case "stats":
      valid = boundedText(block.heading, 120) &&
        boundedText(block.body, 300) &&
        exactRows(
          block.items,
          1,
          6,
          ["figure", "label", "body", "icon", "highlight"],
          (row) =>
            boundedText(row.figure, 60, true) &&
            boundedText(row.label, 240) &&
            boundedText(row.body, 300) &&
            (row.icon == null || isStatsIcon(row.icon)) &&
            (row.highlight == null || typeof row.highlight === "boolean"),
        );
      break;
    /*
     * #3149 — A MAP IS TWO NUMBERS, NEVER A NAME.
     *
     * Both coordinates are REQUIRED and no free-text query is carried. A map
     * asked for a place by name resolves silently, and silently wrong — the
     * recorded failure is a deep link that landed in a different country
     * because the provider matched a street of the same name. A block that
     * cannot say where it is does not publish.
     */
    case "map_embed":
      valid = boundedText(block.heading, 120) &&
        boundedText(block.body, 500) &&
        boundedText(block.place_label, 200, true) &&
        typeof block.latitude === "number" &&
        Number.isFinite(block.latitude) &&
        block.latitude >= -90 && block.latitude <= 90 &&
        typeof block.longitude === "number" &&
        Number.isFinite(block.longitude) &&
        block.longitude >= -180 && block.longitude <= 180 &&
        safeLink(block.directions_url);
      break;
  }
  if (!valid) throw new Error("ARTIFACT_BLOCK_CONTENT_MISMATCH");
}

export function assertRestaurantArtifact(value: unknown): asserts value is RestaurantArtifact {
  if (!plainObject(value) || Object.keys(value).some((key) => !SAFE_KEYS.has(key))) throw new Error("ARTIFACT_SCHEMA_MISMATCH");
  if (value.schema_version !== 1 || value.renderer_key !== RENDERER_KEY || !Number.isInteger(value.renderer_version) || Number(value.renderer_version) < 1) throw new Error("ARTIFACT_RENDERER_MISMATCH");
  for (const id of [value.site_id, value.brand_id, value.publication_id]) if (typeof id !== "string" || !UUID.test(id)) throw new Error("ARTIFACT_ID_MISMATCH");
  if (
    typeof value.source_digest !== "string" ||
    !DIGEST.test(value.source_digest) ||
    !boundedText(value.source_revision_id, 200, true) ||
    !boundedText(value.generated_at, 40, true) ||
    !Number.isFinite(Date.parse(String(value.generated_at)))
  ) throw new Error("ARTIFACT_DIGEST_MISMATCH");
  /*
   * #3149 wave 4 — SIX, because there are six roles.
   *
   * This cap and the role union are the same statement counted two ways: gogi
   * already uses all five of the old roles, so a site that added the sixth
   * would have failed here with ARTIFACT_PAGES_MISMATCH and no clue why.
   */
  if (!Array.isArray(value.pages) || value.pages.length < 1 || value.pages.length > 6) throw new Error("ARTIFACT_PAGES_MISMATCH");
  const roles = new Set<string>();
  for (const page of value.pages as JsonObject[]) {
    if (
      !plainObject(page) ||
      !hasOnlyKeys(page, [
        "role",
        "slug",
        "title",
        "enabled",
        "nav_label",
        "nav_order",
        "blocks",
        "seo",
      ]) ||
      !["home", "about", "menu", "gallery", "contact", "reservations"].includes(
        String(page.role),
      ) ||
      roles.has(String(page.role)) ||
      !boundedText(page.slug, 20, true) ||
      !boundedText(page.title, 120, true) ||
      typeof page.enabled !== "boolean" ||
      !boundedText(page.nav_label, 40, true) ||
      !Number.isInteger(page.nav_order) ||
      // Six roles means six positions, 0 through 5. Left at 4 the sixth page
      // is unplaceable and the failure reads as a bad page rather than a
      // stale bound.
      Number(page.nav_order) < 0 || Number(page.nav_order) > 5
    ) throw new Error("ARTIFACT_PAGE_ROLE_MISMATCH");
    roles.add(String(page.role));
    if (!Array.isArray(page.blocks) || page.blocks.length > 40) throw new Error("ARTIFACT_BLOCKS_MISMATCH");
    for (const block of page.blocks as JsonObject[]) {
      if (!plainObject(block)) throw new Error("ARTIFACT_BLOCK_TYPE_MISMATCH");
      assertRestaurantBlock(block, String(value.site_id));
    }
    if (
      page.seo != null &&
      (!plainObject(page.seo) ||
        !hasOnlyKeys(page.seo, ["title", "description"]) ||
        !boundedText(page.seo.title, 70) ||
        !boundedText(page.seo.description, 170))
    ) {
      throw new Error("ARTIFACT_PAGE_SEO_MISMATCH");
    }
  }
  if (!roles.has("home")) throw new Error("ARTIFACT_HOME_MISSING");
  if (!Array.isArray(value.media) || value.media.length > 500) throw new Error("ARTIFACT_MEDIA_MISMATCH");
  const mediaIds = new Set<string>();
  for (const item of value.media as JsonObject[]) {
    assertMediaReference(item, String(value.site_id));
    if (mediaIds.has(String(item.id))) throw new Error("ARTIFACT_MEDIA_MISMATCH");
    mediaIds.add(String(item.id));
  }
  const mediaUrls = new Set(
    (value.media as JsonObject[]).map((item) => String(item.url)),
  );
  for (const page of value.pages as JsonObject[]) {
    for (const block of page.blocks as JsonObject[]) {
      if (
        ["hero", "media_feature"].includes(String(block.type)) &&
        !mediaUrls.has(String(block.media_url))
      ) throw new Error("ARTIFACT_MEDIA_MISMATCH");
      /*
       * #3149 wave 4 — the menu preview's photographs are held to the SAME
       * rule as the gallery's: every one has to be a media record this
       * artifact already carries. A block that could name a stranger's image
       * would be a way around the tenant-scoped media door.
       */
      if (
        ["gallery", "menu_preview"].includes(String(block.type)) &&
        Array.isArray(block.images) &&
        (block.images as JsonObject[]).some((image) =>
          !mediaIds.has(String(image.id))
        )
      ) throw new Error("ARTIFACT_MEDIA_MISMATCH");
    }
  }
  if (
    !plainObject(value.site_settings) ||
    !hasOnlyKeys(value.site_settings, [
      "display_name",
      "short_description",
      "logo",
      "colors",
      "typography",
      "seo",
    ]) ||
    !boundedText(value.site_settings.display_name, 120, true) ||
    !boundedText(value.site_settings.short_description, 300)
  ) throw new Error("ARTIFACT_SETTINGS_MISMATCH");
  if (value.site_settings.logo != null) {
    assertMediaReference(value.site_settings.logo, String(value.site_id));
    if (!mediaIds.has(String((value.site_settings.logo as JsonObject).id))) {
      throw new Error("ARTIFACT_MEDIA_MISMATCH");
    }
  }
  if (
    value.site_settings.colors != null &&
    (!plainObject(value.site_settings.colors) ||
      !hasOnlyKeys(value.site_settings.colors, [
        "background",
        "foreground",
        "accent",
      ]) ||
      Object.values(value.site_settings.colors).some((color) =>
        color != null &&
        (typeof color !== "string" || !/^#[0-9a-f]{6}$/i.test(color))
      ))
  ) throw new Error("ARTIFACT_SETTINGS_MISMATCH");
  if (
    value.site_settings.typography != null &&
    // Reads the SHARED list, so the editor's options and what the page will
    // accept cannot drift apart.
    !isFontPairing(value.site_settings.typography)
  ) throw new Error("ARTIFACT_SETTINGS_MISMATCH");
  if (
    !plainObject(value.site_settings.seo) ||
    !hasOnlyKeys(value.site_settings.seo, [
      "title",
      "description",
      "canonical_url",
      "social_image",
    ]) ||
    !boundedText(value.site_settings.seo.title, 70) ||
    !boundedText(value.site_settings.seo.description, 170) ||
    value.site_settings.seo.canonical_url !==
      "https://gogi.sites.usemingla.com"
  ) throw new Error("ARTIFACT_SETTINGS_MISMATCH");
  if (value.site_settings.seo.social_image != null) {
    assertMediaReference(
      value.site_settings.seo.social_image,
      String(value.site_id),
    );
    if (
      !mediaIds.has(
        String((value.site_settings.seo.social_image as JsonObject).id),
      )
    ) {
      throw new Error("ARTIFACT_MEDIA_MISMATCH");
    }
  }
  if (
    !plainObject(value.navigation) ||
    !hasOnlyKeys(value.navigation, ["page_roles"]) ||
    !Array.isArray(value.navigation.page_roles) ||
    value.navigation.page_roles.length > 6 ||
    value.navigation.page_roles.some((role) => !roles.has(String(role)))
  ) throw new Error("ARTIFACT_NAVIGATION_MISMATCH");
  if (
    !plainObject(value.footer) ||
    !hasOnlyKeys(value.footer, [
      "address",
      "hours_summary",
      "legal_text",
      "links",
    ]) ||
    !boundedText(value.footer.address, 300) ||
    !boundedText(value.footer.hours_summary, 500) ||
    !boundedText(value.footer.legal_text, 500)
  ) throw new Error("ARTIFACT_FOOTER_MISMATCH");
  for (const link of Array.isArray(value.footer.links) ? value.footer.links as JsonObject[] : []) {
    if (
      !plainObject(link) ||
      !hasOnlyKeys(link, ["label", "href"]) ||
      !boundedText(link.label, 80, true) ||
      !isSafeHref(link.href)
    ) throw new Error("ARTIFACT_LINK_MISMATCH");
  }
  if (
    value.footer.links != null &&
    (!Array.isArray(value.footer.links) || value.footer.links.length > 8)
  ) {
    throw new Error("ARTIFACT_FOOTER_MISMATCH");
  }
  if (!Array.isArray(value.commercial_references) || value.commercial_references.length > 100) throw new Error("ARTIFACT_COMMERCE_MISMATCH");
  for (const reference of value.commercial_references as JsonObject[]) {
    if (
      !plainObject(reference) ||
      !hasOnlyKeys(reference, ["kind", "id", "url"]) ||
      !["offering", "reservation", "checkout"].includes(
        String(reference.kind),
      ) ||
      typeof reference.id !== "string" ||
      !UUID.test(reference.id) ||
      !isCanonicalMinglaHref(reference.url)
    ) throw new Error("ARTIFACT_COMMERCE_MISMATCH");
  }
}
