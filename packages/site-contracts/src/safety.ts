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

export function isIanaTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 60) return false;
  if (!/^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+){1,2}$/.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
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
 *      `/e/{brand}/…`, `/exp/{brand}/…`, `/b/{brand}` or `/b/{brand}/v/{venue}`,
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
 * ONE SOURCE for the booking lock's host lists (#4453 PR 2 rework).
 * A host matches an entry when it equals it or is a subdomain of it; an entry
 * ending in "." matches that name under any top-level domain
 * ("eventbrite." → eventbrite.com, eventbrite.co.uk).
 */
/** Third-party booking, reservation and ticketing sites: refused on every button. */
export const BOOKING_SITE_HOSTS: readonly string[] = [
  "opentable.", "resy.com", "sevenrooms.com", "exploretock.com", "tock.com", "eventbrite.",
  "booking.com", "airbnb.", "feverup.com", "fever.co", "designmynight.com", "ticketmaster.",
  "livenation.", "dice.fm", "ra.co", "skiddle.com", "ticketsource.", "tickettailor.com",
  "universe.com", "seetickets.", "tixr.com", "ticketweb.", "stubhub.", "viagogo.",
  "getyourguide.", "viator.com", "klook.com", "tiqets.com", "headout.com",
  "fareharbor.com", "peek.com", "rezdy.com", "bokun.io", "checkfront.com", "xola.com",
  "thefork.", "quandoo.", "bookatable.", "tablein.com", "resdiary.com",
  "calendly.com", "acuityscheduling.com", "simplybook.", "fresha.com", "vagaro.com",
  "squareup.com", "square.site", "toasttab.com", "hotels.com", "expedia.", "agoda.",
  "vrbo.com", "hostelworld.com", "trip.com", "luma.com", "lu.ma", "partiful.com",
  "meetup.com", "paystack.com", "paystack.shop", "flutterwave.com",
  "stripe.com", "buy.stripe.com", "paypal.", "paypal.me", "gumroad.com", "selar.co",
];

/** Map hosts an informational button may open (with the path prefix, when one is needed). */
export const MAP_LINK_HOSTS: readonly { host: string; path?: string }[] = [
  { host: "maps.google.com" }, { host: "google.com", path: "/maps" }, { host: "maps.app.goo.gl" },
  { host: "goo.gl", path: "/maps" }, { host: "maps.apple.com" }, { host: "openstreetmap.org" },
];

/** Social profile hosts an informational button may open. */
export const SOCIAL_LINK_HOSTS: readonly string[] = [
  "instagram.com", "tiktok.com", "facebook.com", "fb.com", "x.com", "twitter.com",
  "youtube.com", "youtu.be", "linkedin.com", "threads.net", "threads.com", "snapchat.com",
  "pinterest.com", "spotify.com", "soundcloud.com",
];

/** Where a site's own media is served when a button links a file (a PDF menu). */
export const SITES_MEDIA_HOST_SUFFIX = "sites.usemingla.com";

function hostMatches(hostname: string, entry: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (entry.endsWith(".")) {
    const name = entry.slice(0, -1);
    const labels = host.split(".");
    // the name followed by a 1-2 label public suffix (eventbrite.com, eventbrite.co.uk)
    for (let i = 0; i < labels.length; i++) {
      if (labels[i] === name && labels.length - i - 1 >= 1 && labels.length - i - 1 <= 2) return true;
    }
    return false;
  }
  return host === entry || host.endsWith(`.${entry}`);
}

/** Is this a known third-party booking or ticketing host? */
export function isBookingSiteHost(hostname: string): boolean {
  return BOOKING_SITE_HOSTS.some((entry) => hostMatches(hostname, entry));
}

/*
 * The words that make a button a booking or payment action: the
 * BOOKING_THROUGH_ENQUIRY vocabulary (claims.ts) plus paying and ordering.
 */
const BOOKING_ACTION_RE =
  /\b(?:book(?:s|ed|ing|ings)?|reserv(?:e|es|ed|ing|ation|ations)|tickets?|deposits?|stays?|check\s+availability|pay(?:s|ing|ment|ments)?|buy(?:s|ing)?|purchase|order(?:s|ing)?|checkout|check\s+out|rsvp|register|sign\s+up|enrol(?:l)?|get\s+a\s+(?:table|room|spot|place))\b/i;
const HARMLESS_STAY_RE = /\bstay\s+(?:in\s+touch|tuned)\b/gi;

/** Does this button label read as booking, reserving, buying, ordering or paying? */
export function offersBookingOrPayment(label: unknown): boolean {
  return typeof label === "string" && BOOKING_ACTION_RE.test(label.replace(HARMLESS_STAY_RE, " "));
}

/** What an action link is checked against: this site's brand, pages and contact details. */
export type MinglaActionScope = {
  /** The brand's Mingla slug (the `{brand}` segment of its buyer pages). */
  readonly brandSlug: string;
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
};

export type ActionHrefProblem =
  | "unsafe"
  | "outside_mingla"
  | "booking_site"
  | "other_brand"
  | "page_missing"
  | "not_brand_contact";

const ACTION_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/i;
const phoneDigits = (value: string): string => value.replace(/[^\d+]/g, "");
const bareDigits = (value: string): string => value.replace(/\D/g, "");

/** An informational destination outside Mingla (map, social, site media, own WhatsApp), or a reason it isn't one. */
function informationalProblem(url: URL, scope: MinglaActionScope | null): ActionHrefProblem | null {
  const host = url.hostname.toLowerCase();
  if (MAP_LINK_HOSTS.some((entry) => hostMatches(host, entry.host) && (!entry.path || url.pathname.startsWith(entry.path)))) return null;
  if (SOCIAL_LINK_HOSTS.some((entry) => hostMatches(host, entry))) return null;
  if (hostMatches(host, SITES_MEDIA_HOST_SUFFIX) && url.pathname.startsWith("/media/")) return null;
  const whatsapp = hostMatches(host, "wa.me")
    ? url.pathname.slice(1).split("/")[0] ?? ""
    : hostMatches(host, "whatsapp.com") && url.pathname === "/send"
    ? url.searchParams.get("phone") ?? ""
    : null;
  if (whatsapp !== null) {
    if (!scope) return /^\d{5,20}$/.test(bareDigits(whatsapp)) ? null : "not_brand_contact";
    const own = bareDigits(scope.contactPhone ?? "");
    return own.length >= 5 && bareDigits(whatsapp) === own ? null : "not_brand_contact";
  }
  return "outside_mingla";
}

/**
 * Why `value` is not an acceptable action link for a button of this intent,
 * or null when it is. With no scope (Studio's save-time field check, where
 * the brand is not known) only the shape is checked: a same-site path, a
 * Mingla buyer route for SOME brand, a checkout link, any mailto/tel and,
 * for informational buttons, the allowed outside hosts. The brand-specific
 * rules run wherever the scope is known (publish, the artifact, Ari).
 */
export function actionHrefProblem(
  value: unknown,
  scope: MinglaActionScope | null,
  intent: ActionIntent = "booking",
): ActionHrefProblem | null {
  if (!isSafeHref(value)) return "unsafe";
  if (value.startsWith("/")) {
    const path = value.split(/[?#]/, 1)[0]!.replace(/^\/+/, "").replace(/\/+$/, "");
    // A file in this site's own media (a PDF menu) is information, not a page.
    if (intent === "informational" && path.startsWith("media/")) return null;
    if (!scope?.sitePaths) return null;
    return scope.sitePaths.has(path) ? null : "page_missing";
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "unsafe";
  }
  if (url.protocol === "mailto:") {
    if (!scope) return null;
    const to = decodeURIComponent(url.pathname).trim().toLowerCase();
    const own = (scope.contactEmail ?? "").trim().toLowerCase();
    return own && to === own ? null : "not_brand_contact";
  }
  if (url.protocol === "tel:") {
    if (!scope) return null;
    const own = phoneDigits(scope.contactPhone ?? "");
    return own.length >= 5 && phoneDigits(decodeURIComponent(url.pathname)) === own ? null : "not_brand_contact";
  }
  if (url.protocol !== "https:") return "outside_mingla";
  if (isBookingSiteHost(url.hostname)) return "booking_site";
  if (url.hostname !== MINGLA_ACTION_HOST || url.port) {
    return intent === "informational" && !url.port ? informationalProblem(url, scope) : "outside_mingla";
  }
  const segments = url.pathname.split("/").filter(Boolean);
  const [root, brand] = segments;
  if (root === "checkout") {
    if (segments.length !== 2 || !UUID_RE.test(brand ?? "")) return "outside_mingla";
    if (!scope) return null;
    return scope.checkoutEventIds?.has(brand!.toLowerCase()) ? null : "other_brand";
  }
  const offeringRoute = (root === "t" || root === "e" || root === "exp") && segments.length >= 3;
  const brandRoute = root === "b" &&
    (segments.length === 2 || (segments.length === 4 && segments[2] === "v" && ACTION_SLUG_RE.test(segments[3]!)));
  if (!(offeringRoute || brandRoute) || !ACTION_SLUG_RE.test(brand ?? "")) return "outside_mingla";
  if (!scope) return null;
  return brand!.toLowerCase() === scope.brandSlug.toLowerCase() ? null : "other_brand";
}

/** Is `value` an action link this site may carry for a button of this intent (see `actionHrefProblem`)? */
export function isMinglaActionHref(value: unknown, scope: MinglaActionScope | null, intent: ActionIntent = "booking"): value is string {
  return actionHrefProblem(value, scope, intent) === null;
}
