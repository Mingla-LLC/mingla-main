/**
 * #2829 — the text and link rules every Sites contract applies, named once.
 *
 * Copied from the v1 public contract (mingla-sites/src/contracts/artifact.ts
 * `FORBIDDEN_TEXT`, `isSafeHref`, `isCanonicalMinglaHref`, `isIanaTimeZone`)
 * so v2 artifacts, Studio and Ari's tools refuse exactly what v1 refused: no
 * markup, no script URLs, no credentials in links, only https/mailto/tel or a
 * same-site path.
 */

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const DIGEST_RE = /^[0-9a-f]{64}$/;
export const FORBIDDEN_TEXT =
  /<(?:script|style|iframe|svg)|\son[a-z]+\s*=|javascript:|data:|blob:|file:/i;
/*
 * #2829 W7b — the same rule for running prose (rich-text text runs), where a
 * policy legitimately writes "Usage data: the pages you visit". A script or
 * data URL is still refused: the scheme counts only when something follows
 * the colon directly ("data:text/html,…", "javascript:alert(1)"). Prose is
 * always rendered as text, and links are checked separately (isSafeHref).
 */
export const FORBIDDEN_PROSE =
  /<(?:script|style|iframe|svg)|\son[a-z]+\s*=|(?:javascript|data|blob|file):(?=\S)/i;

export function plainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

/** Optional (null/undefined) unless required; a string within `max`, with no markup. */
export function boundedText(value: unknown, max: number, required = false): boolean {
  return (
    (!required && value == null) ||
    (typeof value === "string" &&
      value.length <= max &&
      (!required || value.length > 0) &&
      !FORBIDDEN_TEXT.test(value))
  );
}

export function isSafeHref(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048 || /[\u0000-\u001F\u007F]/.test(value)) return false;
  if (value.startsWith("/")) return !value.startsWith("//") && !value.includes("\\");
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    return url.protocol === "https:" || url.protocol === "mailto:" || url.protocol === "tel:";
  } catch {
    return false;
  }
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

/**
 * #4453 — single-token zones a trip or event may legitimately be stored in.
 * Every other single-token alias (EST, Japan, CET ...) stays refused: they
 * are ambiguous or deprecated. The match is case-sensitive ("utc" is refused).
 * `Etc/UTC` and `Etc/GMT` already pass the Region/City shape.
 */
export const SINGLE_TOKEN_TIME_ZONES = ["UTC", "GMT"] as const;

const REGION_CITY_ZONE_RE = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+){1,2}$/;

function platformKnowsZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * A real `Region/City` zone and nothing else. Venue clocks ("open now, 22:03
 * in Lagos") need a city, so `hours_location` keeps this strict rule: a bare
 * "UTC" is refused here.
 */
export function isRegionCityTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 60) return false;
  return REGION_CITY_ZONE_RE.test(value) && platformKnowsZone(value);
}

/**
 * Any zone an offering, route table or setting may carry: a Region/City zone,
 * or exactly UTC / GMT. The single source (#4453); consumers import the
 * generated copy.
 */
export function isIanaTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 60) return false;
  if ((SINGLE_TOKEN_TIME_ZONES as readonly string[]).includes(value)) return platformKnowsZone(value);
  return isRegionCityTimeZone(value);
}

/** `https://<hostname>` with nothing else: the shape of a canonical origin. */
export const CANONICAL_ORIGIN_RE =
  /^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/*
 * #4453 PR 2 (booking lock) — where a button on a Mingla site may send a
 * visitor. Every action that BOOKS, buys, reserves, orders or pays goes to
 * Mingla; informational links may still leave the site.
 *
 * A BOOKING action (the hero buttons, the header button, offering and
 * booking blocks, and any button whose label reads as booking or paying —
 * `offersBookingOrPayment`) is accepted ONLY when it is:
 *   1. a same-site path (`/…`) to a page this site has;
 *   2. THIS brand's own page on Mingla's buyer host: `/t/{brand}/…`,
 *      `/e/{brand}/…`, `/exp/{brand}/…`, `/b/{brand}`, `/b/{brand}/v/{venue}`
 *      or that venue's `/book/{offer}` buyer route,
 *      or `/checkout/{event}` for one of this brand's events;
 *   3. `mailto:` the brand's own contact email or `tel:` its own phone.
 *
 * An INFORMATIONAL button (any other action field) may also go to a map
 * (Google, Apple, OpenStreetMap), the brand's social profiles, a file on
 * this site's media (`/media/…`) or a Mingla Sites host, or the brand's own
 * WhatsApp. A known third-party booking or ticketing site
 * (BOOKING_SITE_HOSTS) is refused on EVERY button, whatever its label.
 * Another brand's Mingla page, any other host, `http:` and script URLs are
 * refused. Prose links, map fields and footer socials stay `href`
 * (isSafeHref) and are not action links.
 *
 * invariant: I-SITES-ACTIONS-RESOLVE-TO-MINGLA — every booking action on a
 * published site resolves to this brand's Mingla route, a same-site page, or
 * the brand's own mailto or tel, and no button links a third-party booking
 * site. Enforced by `isMinglaActionHref` here, the artifact validator
 * (artifactV2.ts, when the artifact carries `action_scope`), Studio's
 * publish check `OUTBOUND_ACTION_LINK` (publishChecks.ts) and Ari's writes.
 * Tests: mingla-sites/src/contracts/bookingLock.issue4453.test.tsx and
 * mingla-site-cms/src/lib/bookingLock.issue4453.test.ts.
 */

/** Mingla's buyer host: the only host a booking action may leave the site for. */
export const MINGLA_ACTION_HOST = "host.usemingla.com";

/** Whether a button books/pays (locked to Mingla) or only informs. */
export type ActionIntent = "booking" | "informational";

/*
 * ONE SOURCE for the booking lock's host lists (#4453 PR 2).
 *
 * BOOKING_SITE_HOSTS: an entry matches the host itself or any subdomain; an
 * entry ending in "." matches that name under any 1-2 label public suffix
 * ("eventbrite." → eventbrite.com, eventbrite.co.uk, eventbrite.com.au).
 */
/** Third-party booking, reservation, ticketing and payment sites: refused on every button. */
export const BOOKING_SITE_HOSTS: readonly string[] = [
  "opentable.", "resy.", "sevenrooms.", "exploretock.", "tock.com", "eventbrite.",
  "booking.", "airbnb.", "feverup.", "fever.", "designmynight.", "ticketmaster.",
  "livenation.", "dice.fm", "ra.co", "skiddle.", "ticketsource.", "tickettailor.",
  "universe.com", "seetickets.", "tixr.com", "ticketweb.", "stubhub.", "viagogo.",
  "getyourguide.", "viator.", "klook.", "tiqets.", "headout.",
  "fareharbor.", "peek.com", "rezdy.", "bokun.io", "checkfront.", "xola.com",
  "thefork.", "quandoo.", "bookatable.", "tablein.", "resdiary.",
  "calendly.", "acuityscheduling.", "simplybook.", "fresha.", "vagaro.",
  "squareup.", "square.site", "toasttab.", "hotels.com", "expedia.", "agoda.",
  "vrbo.", "hostelworld.", "trip.com", "luma.com", "lu.ma", "partiful.",
  "meetup.", "paystack.", "flutterwave.", "stripe.com", "paypal.", "paypal.me",
  "gumroad.", "selar.co", "ticketfairy.", "tix.africa", "afrotix.", "nairabox.",
];

/*
 * Social profile hosts, EXACT names only (never another subdomain: `l.`,
 * `lm.` and friends are "you are leaving" redirectors).
 */
export const SOCIAL_LINK_HOSTS: readonly string[] = [
  "instagram.com", "www.instagram.com",
  "facebook.com", "www.facebook.com", "m.facebook.com",
  "tiktok.com", "www.tiktok.com",
  "youtube.com", "www.youtube.com", "m.youtube.com",
  "linkedin.com", "www.linkedin.com",
  "x.com", "www.x.com", "twitter.com", "www.twitter.com",
  "threads.net", "www.threads.net", "threads.com", "www.threads.com",
  "snapchat.com", "www.snapchat.com", "pinterest.com", "www.pinterest.com",
  "open.spotify.com", "soundcloud.com",
];

/** Paths on a social host that redirect elsewhere, never a profile. */
const SOCIAL_REDIRECT_PATH_RE = /^\/(?:l\.php|l\/|redirect|redir\/|url|out|away|exit|linkshim|share\/redirect|safe_?redirect|outbound)/i;

/** Map links (exact hosts; a path prefix must end at a "/" boundary). */
export const MAP_LINK_HOSTS: readonly { host: string; path?: string }[] = [
  { host: "maps.google.com" }, { host: "google.com", path: "/maps" }, { host: "www.google.com", path: "/maps" },
  { host: "maps.app.goo.gl" }, { host: "goo.gl", path: "/maps" }, { host: "maps.apple.com" },
  { host: "openstreetmap.org" }, { host: "www.openstreetmap.org" },
];

/** Link shorteners and redirectors: refused on every button (they can point anywhere). */
export const REDIRECTOR_HOSTS: readonly string[] = [
  "t.co", "bit.ly", "goo.gl", "tinyurl.com", "ow.ly", "buff.ly", "lnkd.in", "is.gd", "cutt.ly",
  "rebrand.ly", "shorturl.at", "rb.gy", "tiny.cc", "linktr.ee", "lnk.to", "bio.link", "beacons.ai",
  "l.instagram.com", "l.facebook.com", "lm.facebook.com", "l.messenger.com", "out.reddit.com",
  "href.li", "t.ly", "s.id", "qr.ae",
];

/** Where Mingla Sites serve a site's own media. */
export const SITES_MEDIA_HOST_SUFFIX = "sites.usemingla.com";

function cleanHost(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, "");
}

function hostMatches(hostname: string, entry: string): boolean {
  const host = cleanHost(hostname);
  if (entry.endsWith(".")) {
    const name = entry.slice(0, -1);
    const labels = host.split(".");
    for (let i = 0; i < labels.length; i++) {
      const after = labels.length - i - 1;
      if (labels[i] === name && after >= 1 && after <= 2) return true;
    }
    return false;
  }
  return host === entry || host.endsWith(`.${entry}`);
}

/** Is this a known third-party booking or ticketing host? */
export function isBookingSiteHost(hostname: string): boolean {
  return BOOKING_SITE_HOSTS.some((entry) => hostMatches(hostname, entry));
}

const URL_IN_TEXT_RE = /(?:https?|ftp):|%3a%2f%2f|:\/\/|(?:^|[=&?/])www\.|%2f%2f/i;

/** Does a URL's query or fragment carry another URL (a redirect target)? */
function carriesAnotherUrl(url: URL): boolean {
  const raw = `${url.search}${url.hash}`;
  if (!raw) return false;
  let decoded = raw;
  for (let i = 0; i < 3; i++) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  return URL_IN_TEXT_RE.test(raw) || URL_IN_TEXT_RE.test(decoded);
}

/*
 * Booking intent from a button's label. The label is normalised first
 * (NFKC; diacritics, emoji and symbols removed; Cyrillic and Greek
 * look-alikes mapped to Latin; hyphens and spacing collapsed), so "Bооk now"
 * (Cyrillic о), "Réserver", "BOOK-NOW 🍽️" and "Booknow" all read as booking.
 * A label that mixes Latin with another script after that mapping is treated
 * as booking (it is trying to look like something it isn't).
 *
 * The vocabulary is the BOOKING_THROUGH_ENQUIRY words (claims.ts) plus
 * paying, ordering and signing up, the waitlist and "your spot/seat/place/
 * table/slot" phrasings, and common equivalents in es, fr, pt, de, it, yo.
 */
const CONFUSABLES: Readonly<Record<string, string>> = {
  // Cyrillic
  "а": "a", "в": "b", "е": "e", "ё": "e", "к": "k", "м": "m", "н": "h", "о": "o", "р": "p", "с": "c",
  "т": "t", "у": "y", "х": "x", "ѕ": "s", "і": "i", "ї": "i", "ј": "j", "ԁ": "d", "ɡ": "g", "ӏ": "l",
  // Greek
  "α": "a", "β": "b", "ε": "e", "η": "n", "ι": "i", "κ": "k", "μ": "u", "ν": "v", "ο": "o", "ρ": "p",
  "τ": "t", "υ": "u", "χ": "x", "ω": "w", "ϲ": "c",
  // Latin look-alikes
  "ı": "i", "ł": "l", "ø": "o", "đ": "d", "ß": "ss", "æ": "ae", "œ": "oe", "ƅ": "b",
};

/** A label reduced to plain lowercase Latin words, or null when it mixes scripts. */
/* Bidi overrides and isolates: no legitimate use in a button label (they make "koob" display as "book"). */
const BIDI_CONTROL_RE = /[\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C]/u;

export function normalizeActionLabel(label: string): { text: string; mixedScript: boolean } {
  // A label carrying bidi controls is treated as suspect (booking).
  const bidi = BIDI_CONTROL_RE.test(label);
  // Format characters (zero-width joiner and non-joiner, zero-width space,
  // word joiner, soft hyphen, BOM, bidi controls) are REMOVED, never turned
  // into a space, so "Res\u200Derve" reads as "reserve".
  let text = label.replace(/[\p{Cf}\u00AD\u180E\uFEFF]/gu, "").normalize("NFKC").toLowerCase();
  text = text.normalize("NFD").replace(/\p{M}+/gu, "");
  let mapped = "";
  let nonLatin = false;
  for (const char of text) {
    const swap = CONFUSABLES[char];
    if (swap !== undefined) {
      mapped += swap;
      nonLatin = true;
    } else mapped += char;
  }
  // Letters outside Latin that are not look-alikes (another script entirely).
  const otherScript = /[^\p{Script=Latin}\p{N}\s\p{P}\p{S}\p{Z}\p{Cc}\p{Cf}]/u.test(mapped);
  const latin = /\p{Script=Latin}/u.test(mapped);
  const words = mapped
    .replace(/[\p{S}\p{Cf}]+/gu, " ") // emoji, symbols, joiners
    .replace(/[\p{P}]+/gu, " ") // hyphens, apostrophes, punctuation
    .replace(/\s+/g, " ")
    .trim();
  return { text: words, mixedScript: bidi || ((nonLatin || otherScript) && latin) };
}

const BOOKING_STEMS = [
  "book", "reserv", "ticket", "deposit", "waitlist", "rsvp", "checkout", "register", "registr", "signup",
  "enrol", "pay", "prepay", "buy", "purchas", "order", "preorder",
  // es / pt / fr / de / it / yo
  "entrad", "boleto", "ingress", "bilhet", "billet", "biglie", "pagar", "pague", "payer",
  "achet", "command", "inscri", "iscriv", "buchen", "buchung", "kauf", "bezahl", "bestell", "anmeld",
  "prenot", "acquist", "ordina", "tiketi", "sanwo",
];
const BOOKING_WORDS = new Set(["stay", "stays", "paga", "pago", "comprar", "compra", "compre", "seat", "seats", "slot", "slots"]);
const BOOKING_PHRASE_RE =
  /\b(?:check (?:availability|out)|sign (?:up|me up)|join (?:the |our )?(?:list|wait ?list|queue)|(?:save|secure|claim|grab|get|hold|book|reserve|request|find|keep|lock in) (?:your |a |my |the |our )?(?:spot|seat|place|table|slot|room|ticket|space|place)s?|(?:table|room|spot|seat)s? for (?:\d+|two|one|you)|get in line)\b/;
const HARMLESS_RE = /\bstay (?:in touch|tuned|connected)\b/g;

/** Does this button label read as booking, reserving, buying, ordering, paying or signing up? */
export function offersBookingOrPayment(label: unknown): boolean {
  if (typeof label !== "string" || !label.trim()) return false;
  const { text, mixedScript } = normalizeActionLabel(label);
  if (mixedScript) return true;
  const plain = text.replace(HARMLESS_RE, " ");
  if (BOOKING_PHRASE_RE.test(plain)) return true;
  const words = plain.split(" ").filter(Boolean);
  if (words.some((word) => BOOKING_WORDS.has(word) || BOOKING_STEMS.some((stem) => word.startsWith(stem)))) return true;
  // Run-together labels ("booknow", "buytickets"): the label with its spaces removed.
  const joined = words.join("");
  return /^(?:book|reserve|buy|get|pay|order)(?:now|here|online|today|tickets?|atable|aspot|your)/.test(joined);
}

/*
 * A brand phone, normalised for comparison: extension and note text dropped
 * ("ext. 2", "(bookings)", "x12"), only the first number kept when several
 * are listed, then just "+" and digits. Null when nothing usable remains.
 */
export function normalizeBrandPhone(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let value = raw.split(/[/,;]|\bor\b/i)[0] ?? "";
  value = value.replace(/\(\s*[a-z][^)]*\)/gi, " ");
  value = value.replace(/\s*(?:ext\.?|extension|x|#)\s*\d+\s*$/i, "");
  value = value.replace(/[a-z].*$/i, "");
  const plus = value.trim().startsWith("+");
  const digits = value.replace(/\D/g, "");
  if (digits.length < 5 || digits.length > 20) return null;
  return `${plus ? "+" : ""}${digits}`;
}

/** What an action link is checked against: this site's brand, pages and contact details. */
export type MinglaActionScope = {
  /**
   * The brand's Mingla slug (the `{brand}` segment of its buyer pages). Null
   * when Core could not name the brand: a link that needs the brand (a
   * Mingla brand route, checkout, mailto, tel, WhatsApp) then FAILS CLOSED
   * with `brand_unknown`.
   */
  readonly brandSlug: string | null;
  /**
   * The paths this site answers, "" for Home and without the leading slash
   * ("trips", "trips/lagos"). Null skips the page check (the page tree is not
   * known where the link is checked).
   */
  readonly sitePaths: ReadonlySet<string> | null;
  /** The brand's own contact email (mailto targets), if it has one. */
  readonly contactEmail?: string | null;
  /** The brand's own phone (tel and WhatsApp targets), if it has one. */
  readonly contactPhone?: string | null;
  /**
   * This brand's event ids a `/checkout/{event}` link may name. Null or
   * absent: no checkout link passes (never guessed).
   */
  readonly checkoutEventIds?: ReadonlySet<string> | null;
  /**
   * The brand's own social handles (lowercase, no "@"). When given, a social
   * link must be one of these profiles; when absent, any profile path passes
   * (never a redirect).
   */
  readonly socialHandles?: ReadonlySet<string> | null;
  /**
   * The ids of this site's own media records. When given, a file link
   * ("/media/<id>/…") must name one of them. `siteHosts` are this site's own
   * hostnames, for an absolute link to its media.
   */
  readonly mediaIds?: ReadonlySet<string> | null;
  /**
   * Deploy-order handshake (#4453 PR 2): true when the brand is unknown
   * because the Core that sent this publish does not yet send brand identity
   * (it doesn't advertise `booking_identity`). Then the identity checks are
   * shape-only, as before the lock, and everything else (booking sites,
   * redirectors, the Mingla host and route shapes, same-site pages, own
   * media) is still enforced. False or absent with `brandSlug: null`: the
   * check fails closed (`brand_unknown`).
   */
  readonly identityUnchecked?: boolean;
  readonly siteHosts?: ReadonlySet<string> | null;
};

export type ActionHrefProblem =
  | "unsafe"
  | "outside_mingla"
  | "booking_site"
  | "redirect"
  | "other_brand"
  | "brand_unknown"
  | "page_missing"
  | "not_brand_contact"
  | "not_site_media"
  | "not_brand_social";

const ACTION_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/i;
const bareDigits = (value: string): string => value.replace(/\D/g, "");

/** Is this phone (raw text from a link) the brand's own? */
function samePhone(raw: string, scope: MinglaActionScope): boolean {
  const own = normalizeBrandPhone(scope.contactPhone ?? null);
  const theirs = normalizeBrandPhone(raw) ?? bareDigits(raw);
  return own !== null && bareDigits(theirs) === bareDigits(own) && bareDigits(own).length >= 5;
}

/** A mailto: every recipient (path, to, cc, bcc) must be the brand's own address, and its body carries no link or address. */
function mailtoProblem(url: URL, scope: MinglaActionScope | null): ActionHrefProblem | null {
  const recipients: string[] = [];
  const add = (list: string) => {
    for (const part of decodeURIComponent(list).split(/[,;]/)) if (part.trim()) recipients.push(part.trim().toLowerCase());
  };
  try {
    add(url.pathname);
    for (const key of ["to", "cc", "bcc"]) for (const value of url.searchParams.getAll(key)) add(value);
  } catch {
    return "unsafe";
  }
  for (const key of url.searchParams.keys()) {
    if (!["to", "cc", "bcc", "subject", "body"].includes(key.toLowerCase())) return "not_brand_contact";
  }
  const extra = `${url.searchParams.get("subject") ?? ""} ${url.searchParams.get("body") ?? ""}`;
  if (/@|https?:|www\./i.test(extra)) return "not_brand_contact";
  if (recipients.length === 0) return "not_brand_contact";
  if (!scope) return null;
  if (scope.brandSlug === null && !scope.contactEmail) return scope.identityUnchecked ? null : "brand_unknown";
  const own = (scope.contactEmail ?? "").trim().toLowerCase();
  return own && recipients.every((to) => to === own) ? null : "not_brand_contact";
}

const MEDIA_PATH_RE = /^\/media\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/[^/]+$/i;

/** Is this path a file of one of this site's own media records? */
function ownMedia(path: string, scope: MinglaActionScope): boolean {
  const match = MEDIA_PATH_RE.exec(path);
  if (!match) return false;
  return !scope.mediaIds || scope.mediaIds.has(match[1]!.toLowerCase());
}

/** An informational destination outside Mingla (map, social, own media, own WhatsApp), or why it isn't one. */
function informationalProblem(url: URL, scope: MinglaActionScope | null): ActionHrefProblem | null {
  const host = cleanHost(url.hostname);
  const path = url.pathname;
  const atBoundary = (prefix: string) => path === prefix || path.startsWith(`${prefix}/`);
  if (MAP_LINK_HOSTS.some((entry) => host === entry.host && (!entry.path || atBoundary(entry.path)))) {
    return carriesAnotherUrl(url) ? "redirect" : null;
  }
  if (REDIRECTOR_HOSTS.includes(host)) return "redirect";
  if (SOCIAL_LINK_HOSTS.includes(host)) {
    if (SOCIAL_REDIRECT_PATH_RE.test(path) || carriesAnotherUrl(url)) return "redirect";
    const handle = decodeURIComponent(path.split("/").filter(Boolean)[0] ?? "").replace(/^@/, "").toLowerCase();
    if (!handle) return "not_brand_social";
    if (scope?.socialHandles && scope.socialHandles.size > 0 && !scope.socialHandles.has(handle)) return "not_brand_social";
    return null;
  }
  if (hostMatches(host, SITES_MEDIA_HOST_SUFFIX) || scope?.siteHosts?.has(host)) {
    if (!path.startsWith("/media/") || carriesAnotherUrl(url)) return "not_site_media";
    if (!scope) return null;
    const own = scope.siteHosts?.has(host) === true;
    return own && ownMedia(path, scope) ? null : "not_site_media";
  }
  const whatsapp = host === "wa.me"
    ? path.slice(1).split("/")[0] ?? ""
    : (host === "api.whatsapp.com" || host === "wa.link") && path === "/send"
    ? url.searchParams.get("phone") ?? ""
    : null;
  if (whatsapp !== null) {
    if (!/^\d{5,20}$/.test(bareDigits(whatsapp)) || /https?:|www\./i.test(url.search)) return "not_brand_contact";
    if (!scope) return null;
    if (!scope.contactPhone) return scope.brandSlug === null ? (scope.identityUnchecked ? null : "brand_unknown") : "not_brand_contact";
    return samePhone(whatsapp, scope) ? null : "not_brand_contact";
  }
  return "outside_mingla";
}

/**
 * Why `value` is not an acceptable action link for a button of this intent,
 * or null when it is. With no scope (Studio's save-time field check, where
 * the brand is not known) only the shape is checked: a same-site path, a
 * Mingla buyer route for SOME brand, a checkout link, a mailto/tel, and for
 * informational buttons the allowed outside hosts. Wherever the scope is
 * known (publish, the artifact, Ari) the brand rules run, and they fail
 * CLOSED when the scope has no brand (`brand_unknown`).
 *
 * Every OFF-SITE link on any button must be a Mingla buyer route or, for an
 * informational button, pass the informational allow list. Booking sites and
 * redirectors are refused whatever the label.
 */
export function actionHrefProblem(
  value: unknown,
  scope: MinglaActionScope | null,
  intent: ActionIntent = "booking",
): ActionHrefProblem | null {
  if (typeof value === "string" && value !== value.trim()) value = value.trim();
  if (!isSafeHref(value)) return "unsafe";
  if (value.startsWith("/")) {
    const path = value.split(/[?#]/, 1)[0]!;
    const page = path.replace(/^\/+/, "").replace(/\/+$/, "");
    // A file in this site's own media is information, not a page.
    if (intent === "informational" && page.startsWith("media/")) {
      if (!scope) return null;
      return ownMedia(path, scope) ? null : "not_site_media";
    }
    if (!scope?.sitePaths) return null;
    return scope.sitePaths.has(page) ? null : "page_missing";
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "unsafe";
  }
  if (url.protocol === "mailto:") return mailtoProblem(url, scope);
  if (url.protocol === "tel:") {
    if (!scope) return null;
    if (!scope.contactPhone) return scope.brandSlug === null ? (scope.identityUnchecked ? null : "brand_unknown") : "not_brand_contact";
    return samePhone(decodeURIComponent(url.pathname), scope) ? null : "not_brand_contact";
  }
  if (url.protocol !== "https:") return "outside_mingla";
  if (isBookingSiteHost(url.hostname)) return "booking_site";
  // Exact host: a trailing-dot or other spelling is not Mingla's buyer host.
  if (url.hostname !== MINGLA_ACTION_HOST || url.port) {
    return intent === "informational" && !url.port ? informationalProblem(url, scope) : "outside_mingla";
  }
  const segments = url.pathname.split("/").filter(Boolean);
  const [root, brand] = segments;
  if (root === "checkout") {
    if (segments.length !== 2 || !UUID_RE.test(brand ?? "")) return "outside_mingla";
    if (!scope) return null;
    if (scope.brandSlug === null) return scope.identityUnchecked ? null : "brand_unknown";
    return scope.checkoutEventIds?.has(brand!.toLowerCase()) ? null : "other_brand";
  }
  const offeringRoute = (root === "t" || root === "e" || root === "exp") && segments.length >= 3;
  const venueBookRoute = root === "b" && segments.length === 6 && segments[2] === "v" &&
    ACTION_SLUG_RE.test(segments[3]!) && segments[4] === "book" && UUID_RE.test(segments[5]!) &&
    ([...url.searchParams.keys()].length === 0 ||
      ([...url.searchParams.keys()].length === 1 && url.searchParams.get("k") === "plan"));
  const brandRoute = root === "b" &&
    (segments.length === 2 || (segments.length === 4 && segments[2] === "v" && ACTION_SLUG_RE.test(segments[3]!)) || venueBookRoute);
  if (!(offeringRoute || brandRoute) || !ACTION_SLUG_RE.test(brand ?? "")) return "outside_mingla";
  if (!scope) return null;
  if (scope.brandSlug === null) return scope.identityUnchecked ? null : "brand_unknown";
  return brand!.toLowerCase() === scope.brandSlug.toLowerCase() ? null : "other_brand";
}

/** Is `value` an action link this site may carry for a button of this intent (see `actionHrefProblem`)? */
export function isMinglaActionHref(value: unknown, scope: MinglaActionScope | null, intent: ActionIntent = "booking"): value is string {
  return actionHrefProblem(value, scope, intent) === null;
}

/**
 * The brand's own social handles from its Mingla `social_links` (an object of
 * network → URL or "@handle", or a list of either): lowercase, no "@", only
 * handles on SOCIAL_LINK_HOSTS profiles. Used to restrict a site's social
 * buttons to the brand's own profiles.
 */
export function socialHandlesFrom(links: unknown): string[] {
  const values: unknown[] = Array.isArray(links)
    ? links
    : links && typeof links === "object"
    ? Object.values(links as Record<string, unknown>)
    : [];
  const out = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string" || !value.trim()) continue;
    const text = value.trim();
    let handle = "";
    if (/^https?:\/\//i.test(text)) {
      try {
        const url = new URL(text);
        if (!SOCIAL_LINK_HOSTS.includes(cleanHost(url.hostname))) continue;
        handle = decodeURIComponent(url.pathname.split("/").filter(Boolean)[0] ?? "");
      } catch {
        continue;
      }
    } else handle = text;
    handle = handle.replace(/^@/, "").toLowerCase();
    if (/^[a-z0-9._-]{1,100}$/.test(handle)) out.add(handle);
  }
  return [...out].slice(0, 20);
}
