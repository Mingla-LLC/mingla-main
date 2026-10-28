/**
 * #2829 AD-6 / A1.2 — what a site shows about a brand's trips, events and
 * experiences, and how it decides each one's state.
 *
 * Mingla is the only source of truth. The runtime reads Core's live feed
 * (`brand_site_offerings_feed`) per request and falls back to the copy frozen
 * into the publication at publish time (`offerings_snapshot`). Either way a
 * card only ever LINKS to the existing Mingla public page (`public_url`),
 * which runs Mingla's existing checkout unchanged (amendment A1.2): there is
 * no site-hosted offering page and no site checkout.
 *
 * State is decided here, from the offering's dates in the offering's OWN
 * timezone (Constitution 12), never the visitor's or the server's:
 *   ended    — local end date before local today (or Mingla says ended)
 *   upcoming — local start date after local today
 *   running  — otherwise (it is on today)
 * plus cancelled, sold out (no places left and not unlimited) and bookings
 * closed. Only an upcoming offering that is none of those three is bookable.
 * A trip or event with no dates fails CLOSED (ended): it never shows a Book
 * link it cannot honour.
 */
import { boundedText, hasOnlyKeys, isCanonicalMinglaHref, isIanaTimeZone, plainObject, UUID_RE } from "./safety.ts";

export const OFFERING_KINDS = ["trip", "event", "experience"] as const;
export type OfferingKind = (typeof OFFERING_KINDS)[number];
export const OFFERING_STATUSES = ["scheduled", "live", "ended", "cancelled"] as const;
export type OfferingStatus = (typeof OFFERING_STATUSES)[number];
export const MAX_SNAPSHOT_OFFERINGS = 200;

/** One offering as the feed and the snapshot carry it. */
export type SiteOffering = {
  id: string;
  kind: OfferingKind;
  slug: string;
  title: string;
  summary: string | null;
  /** `<bucket>/<key>` in Mingla's public cover storage, served via `/om`. */
  cover: { path: string; type: "image" } | null;
  destination_text: string | null;
  start_at: string | null;
  end_at: string | null;
  timezone: string | null;
  status: OfferingStatus;
  bookings_closed: boolean;
  capacity: number | null;
  /** null = no limit (unlimited or not counted). */
  spots_left: number | null;
  group_minimum: number | null;
  min_price_minor: number | null;
  currency: string | null;
  has_free_tier: boolean;
  /** The existing Mingla public page for this offering. */
  public_url: string;
  waitlist_enabled: boolean;
  installments_available: boolean;
};

export type OfferingsFeed = {
  generated_at: string;
  brand: { slug: string; currency: string | null; payment_rails: "stripe" | "paystack" };
  offerings: SiteOffering[];
};

const OFFERING_KEYS = [
  "id", "kind", "slug", "title", "summary", "cover", "destination_text", "start_at", "end_at",
  "timezone", "status", "bookings_closed", "capacity", "spots_left", "group_minimum",
  "min_price_minor", "currency", "has_free_tier", "public_url", "waitlist_enabled",
  "installments_available",
] as const;

const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,199}$/;
const COVER_PATH_RE = /^(?:event_covers|brand_covers)\/[A-Za-z0-9._/-]{1,900}$/;
const PUBLIC_PATH_PREFIX: Readonly<Record<OfferingKind, string>> = { trip: "/t/", event: "/e/", experience: "/exp/" };

function isInstant(value: unknown): value is string {
  return typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value));
}

function countOrNull(value: unknown, max: number): value is number | null {
  return value === null || (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max);
}

/** #2829 W7c — a cover's `<bucket>/<key>` in Mingla's public cover storage. */
export function isOfferingCoverPath(value: unknown): value is string {
  return typeof value === "string" && COVER_PATH_RE.test(value) && !value.includes("..");
}

function coverOk(value: unknown): boolean {
  if (value === null) return true;
  return plainObject(value) && hasOnlyKeys(value, ["path", "type"]) && value.type === "image" &&
    typeof value.path === "string" && COVER_PATH_RE.test(value.path) && !value.path.includes("..");
}

function publicUrlOk(kind: OfferingKind, value: unknown): value is string {
  if (!isCanonicalMinglaHref(value)) return false;
  const url = new URL(value);
  return !url.search && !url.hash && url.pathname.startsWith(PUBLIC_PATH_PREFIX[kind]);
}

/** Is this exactly one well-formed offering record (no unknown keys)? */
export function isSiteOffering(value: unknown): value is SiteOffering {
  if (!plainObject(value) || !hasOnlyKeys(value, OFFERING_KEYS)) return false;
  const v = value;
  return typeof v.id === "string" && UUID_RE.test(v.id) &&
    (OFFERING_KINDS as readonly unknown[]).includes(v.kind) &&
    typeof v.slug === "string" && SLUG_RE.test(v.slug) &&
    boundedText(v.title, 200, true) &&
    (v.summary === null || boundedText(v.summary, 500, true)) &&
    coverOk(v.cover) &&
    (v.destination_text === null || boundedText(v.destination_text, 200, true)) &&
    (v.start_at === null || isInstant(v.start_at)) &&
    (v.end_at === null || isInstant(v.end_at)) &&
    (v.timezone === null || isIanaTimeZone(v.timezone)) &&
    (OFFERING_STATUSES as readonly unknown[]).includes(v.status) &&
    typeof v.bookings_closed === "boolean" &&
    countOrNull(v.capacity, 1_000_000) && countOrNull(v.spots_left, 1_000_000) &&
    (v.group_minimum === null || (Number.isInteger(v.group_minimum) && Number(v.group_minimum) >= 1 && Number(v.group_minimum) <= 1000)) &&
    countOrNull(v.min_price_minor, 1_000_000_000_000) &&
    (v.currency === null || (typeof v.currency === "string" && /^[A-Z]{3}$/.test(v.currency))) &&
    typeof v.has_free_tier === "boolean" &&
    publicUrlOk(v.kind as OfferingKind, v.public_url) &&
    typeof v.waitlist_enabled === "boolean" &&
    typeof v.installments_available === "boolean";
}

/**
 * One raw feed row → a SiteOffering, or null when it is not trustworthy.
 * Unknown keys a newer Core adds are dropped (so a Core change never blanks a
 * live site); every known key must pass its rule. Missing optional facts are
 * null — never defaulted to something invented.
 */
export function normalizeSiteOffering(raw: unknown): SiteOffering | null {
  if (!plainObject(raw)) return null;
  const pick: Record<string, unknown> = {};
  for (const key of OFFERING_KEYS) pick[key] = raw[key] === undefined ? null : raw[key];
  for (const key of ["bookings_closed", "has_free_tier", "waitlist_enabled", "installments_available"]) {
    if (pick[key] === null) pick[key] = false;
  }
  // Free text that would be refused (too long, or reading like markup) is
  // left out rather than losing the whole offering from the site.
  for (const [key, max] of [["summary", 500], ["destination_text", 200]] as const) {
    if (pick[key] !== null && !boundedText(pick[key], max, true)) pick[key] = null;
  }
  return isSiteOffering(pick) ? pick : null;
}

/**
 * The feed as Core sent it → validated. Throws `OFFERINGS_FEED_INVALID` when
 * the envelope itself is wrong (the caller falls back to the snapshot); drops
 * individual rows that fail their rules.
 */
export function parseOfferingsFeed(value: unknown): OfferingsFeed {
  if (!plainObject(value) || !Array.isArray(value.offerings) || !isInstant(value.generated_at) || !plainObject(value.brand)) {
    throw new Error("OFFERINGS_FEED_INVALID");
  }
  const brand = value.brand;
  if (typeof brand.slug !== "string" || !SLUG_RE.test(brand.slug)) throw new Error("OFFERINGS_FEED_INVALID");
  const offerings: SiteOffering[] = [];
  for (const row of value.offerings.slice(0, MAX_SNAPSHOT_OFFERINGS)) {
    const offering = normalizeSiteOffering(row);
    if (offering) offerings.push(offering);
  }
  return {
    generated_at: value.generated_at,
    brand: {
      slug: brand.slug,
      currency: typeof brand.currency === "string" && /^[A-Z]{3}$/.test(brand.currency) ? brand.currency : null,
      payment_rails: brand.payment_rails === "paystack" ? "paystack" : "stripe",
    },
    offerings,
  };
}

/** The artifact's frozen snapshot: at most 200 strict offering records. */
export function assertOfferingsSnapshot(value: unknown): asserts value is SiteOffering[] {
  if (!Array.isArray(value) || value.length > MAX_SNAPSHOT_OFFERINGS || !value.every(isSiteOffering)) {
    throw new Error("ARTIFACT_OFFERINGS_MISMATCH");
  }
  if (new Set(value.map((offering) => offering.id)).size !== value.length) throw new Error("ARTIFACT_OFFERINGS_MISMATCH");
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type OfferingPhase = "upcoming" | "running" | "ended";

export type OfferingState = {
  phase: OfferingPhase;
  cancelled: boolean;
  soldOut: boolean;
  bookingsClosed: boolean;
  bookable: boolean;
  /** The one word a card shows, or null for an ordinary upcoming offering. */
  badge: "Cancelled" | "Ended" | "Sold out" | "Bookings closed" | "Happening now" | null;
};

/** The calendar date (YYYY-MM-DD) an instant falls on in a timezone. */
export function localDate(instant: string | Date, timeZone: string): string | null {
  const time = instant instanceof Date ? instant.getTime() : Date.parse(instant);
  if (!Number.isFinite(time)) return null;
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
      .format(new Date(time));
  } catch {
    return null;
  }
}

/** The offering's own timezone, or UTC when Mingla has none on record. */
export function offeringTimeZone(offering: Pick<SiteOffering, "timezone">): string {
  return offering.timezone && isIanaTimeZone(offering.timezone) ? offering.timezone : "UTC";
}

export function offeringState(offering: SiteOffering, now: Date): OfferingState {
  const timeZone = offeringTimeZone(offering);
  const today = localDate(now, timeZone);
  const start = offering.start_at ? localDate(offering.start_at, timeZone) : null;
  const end = offering.end_at ? localDate(offering.end_at, timeZone) : start;
  let phase: OfferingPhase;
  if (offering.status === "ended") phase = "ended";
  else if (!start || !end || !today) {
    // An experience with no next date on record is an ongoing offer; a trip
    // or event without dates fails closed.
    phase = offering.kind === "experience" && !start ? "upcoming" : "ended";
  } else if (end < today) phase = "ended";
  else if (start > today) phase = "upcoming";
  else phase = "running";
  const cancelled = offering.status === "cancelled";
  const soldOut = offering.spots_left === 0;
  const bookingsClosed = offering.bookings_closed;
  const bookable = phase === "upcoming" && !cancelled && !soldOut && !bookingsClosed;
  const badge = cancelled
    ? "Cancelled"
    : phase === "ended"
      ? "Ended"
      : soldOut
        ? "Sold out"
        : bookingsClosed
          ? "Bookings closed"
          : phase === "running"
            ? "Happening now"
            : null;
  return { phase, cancelled, soldOut, bookingsClosed, bookable, badge };
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

function utcDay(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

/**
 * The date range in the offering's timezone, written the way Young & Stamped
 * writes it: "June 20–27, 2026" · "June 28 – July 2, 2026" ·
 * "December 28, 2026 – January 3, 2027" (en dash). One day → "June 20, 2026".
 * Missing dates → "" (the caller shows nothing).
 */
export function formatOfferingDates(offering: Pick<SiteOffering, "start_at" | "end_at" | "timezone">, language = "en-US"): string {
  const timeZone = offeringTimeZone(offering);
  const start = offering.start_at ? localDate(offering.start_at, timeZone) : null;
  const end = offering.end_at ? localDate(offering.end_at, timeZone) : start;
  if (!start || !end) return "";
  let month: Intl.DateTimeFormat, day: Intl.DateTimeFormat, year: Intl.DateTimeFormat;
  try {
    month = new Intl.DateTimeFormat(language, { timeZone: "UTC", month: "long" });
    day = new Intl.DateTimeFormat(language, { timeZone: "UTC", day: "numeric" });
    year = new Intl.DateTimeFormat(language, { timeZone: "UTC", year: "numeric" });
  } catch {
    return formatOfferingDates(offering, "en-US");
  }
  const [from, to] = [utcDay(start), utcDay(end)];
  const [fy, ty, fm, tm, fd, td] = [year.format(from), year.format(to), month.format(from), month.format(to), day.format(from), day.format(to)];
  if (start === end) return `${fm} ${fd}, ${fy}`;
  if (fy !== ty) return `${fm} ${fd}, ${fy} – ${tm} ${td}, ${ty}`;
  if (fm !== tm) return `${fm} ${fd} – ${tm} ${td}, ${ty}`;
  return `${fm} ${fd}–${td}, ${ty}`;
}

/**
 * The price line, in the offering's own currency (Constitution 10). Mingla
 * stores prices in hundredths of the currency unit. No price on record →
 * "Price on request"; only free places → "Free". Never invented.
 */
export function formatOfferingPrice(offering: Pick<SiteOffering, "min_price_minor" | "currency" | "has_free_tier">, language = "en-US"): string {
  if (offering.min_price_minor !== null && offering.min_price_minor > 0 && offering.currency) {
    const amount = offering.min_price_minor / 100;
    const digits = Number.isInteger(amount) ? 0 : 2;
    try {
      return `From ${new Intl.NumberFormat(language, { style: "currency", currency: offering.currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(amount)}`;
    } catch {
      return `From ${amount.toFixed(digits)} ${offering.currency}`;
    }
  }
  if (offering.has_free_tier) return "Free";
  return "Price on request";
}

// ---------------------------------------------------------------------------
// Which offerings a grid shows
// ---------------------------------------------------------------------------

export type OfferingGridConfig = {
  kind?: "all" | OfferingKind;
  mode: "upcoming" | "past" | "all";
  offering_ids?: Array<{ id: string }>;
  limit?: number;
};

export type OfferingFilters = { where: string | null; from: string | null; to: string | null };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A `?from=` / `?to=` value: a real calendar date, else no filter. */
export function parseFilterDate(raw: unknown): string | null {
  if (typeof raw !== "string" || !ISO_DATE.test(raw)) return null;
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === raw ? raw : null;
}

export function parseFilterWhere(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().slice(0, 80);
  return trimmed.length ? trimmed : null;
}

export type OfferingGridResult =
  | { kind: "ok"; offerings: Array<{ offering: SiteOffering; state: OfferingState }> }
  | { kind: "check_dates" }
  | { kind: "no_match" }
  | { kind: "empty" };

/**
 * The offerings one grid shows, in order:
 *   - picked offerings (`offering_ids`) in the owner's order, whatever their
 *     state (a picked cancelled trip still says "Cancelled");
 *   - otherwise `upcoming` = upcoming and running, soonest first; `past` =
 *     ended, newest first; `all` = both. Cancelled offerings leave lists.
 * Filters (server-side): `where` matches title or destination; `from`/`to`
 * keep offerings whose dates OVERLAP the range. An inverted range answers
 * "check_dates"; filters that match nothing answer "no_match".
 */
export function selectGridOfferings(
  offerings: readonly SiteOffering[],
  config: OfferingGridConfig,
  now: Date,
  filters: OfferingFilters = { where: null, from: null, to: null },
): OfferingGridResult {
  if (filters.from && filters.to && filters.from > filters.to) return { kind: "check_dates" };
  const withState = offerings.map((offering) => ({ offering, state: offeringState(offering, now) }));
  let chosen: typeof withState;
  if (config.offering_ids && config.offering_ids.length) {
    const byId = new Map(withState.map((entry) => [entry.offering.id, entry]));
    chosen = config.offering_ids.map((row) => byId.get(row.id)).filter((entry): entry is (typeof withState)[number] => Boolean(entry));
  } else {
    const ofKind = withState.filter((entry) => !config.kind || config.kind === "all" || entry.offering.kind === config.kind)
      .filter((entry) => !entry.state.cancelled);
    const time = (entry: (typeof withState)[number]) => (entry.offering.start_at ? Date.parse(entry.offering.start_at) : Number.POSITIVE_INFINITY);
    const upcoming = ofKind.filter((entry) => entry.state.phase !== "ended").sort((a, b) => time(a) - time(b));
    const past = ofKind.filter((entry) => entry.state.phase === "ended")
      .sort((a, b) => (b.offering.start_at ? Date.parse(b.offering.start_at) : 0) - (a.offering.start_at ? Date.parse(a.offering.start_at) : 0));
    chosen = config.mode === "upcoming" ? upcoming : config.mode === "past" ? past : [...upcoming, ...past];
  }
  const filtering = Boolean(filters.where || filters.from || filters.to);
  if (filtering) {
    const needle = filters.where?.toLocaleLowerCase() ?? null;
    chosen = chosen.filter(({ offering }) => {
      if (needle && !`${offering.title} ${offering.destination_text ?? ""}`.toLocaleLowerCase().includes(needle)) return false;
      if (!filters.from && !filters.to) return true;
      const timeZone = offeringTimeZone(offering);
      const start = offering.start_at ? localDate(offering.start_at, timeZone) : null;
      const end = offering.end_at ? localDate(offering.end_at, timeZone) : start;
      if (!start || !end) return false;
      if (filters.from && end < filters.from) return false;
      if (filters.to && start > filters.to) return false;
      return true;
    });
  }
  if (config.limit) chosen = chosen.slice(0, config.limit);
  if (!chosen.length) return filtering ? { kind: "no_match" } : { kind: "empty" };
  return { kind: "ok", offerings: chosen };
}
