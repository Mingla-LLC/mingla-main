/**
 * #4453 milestone 5 (spec v2 §5.1, §5.4, §5.5, §5.7) — the live booking
 * facts a website shows: open slots, nights, dates and ticket tiers, and the
 * targets the hero booking bar and the sticky phone bar hand off to.
 *
 * ONE SOURCE for Core's reads (the edge function validates every request and
 * response against this file), the public runtime (which renders only what
 * passes), and the Studio. Every number comes from Mingla at request time;
 * nothing here is typed by Ari or an owner. Every link is built by Core and
 * must resolve to THIS brand's own Mingla page (I-SITES-ACTIONS-RESOLVE-TO-MINGLA):
 * a link that fails is dropped, and a feed that fails is not shown at all
 * (a block with no live data renders nothing, I-SITES-NO-PUBLIC-EMPTY-STATE).
 *
 * invariant: I-SITES-BOOKING-FACTS-FROM-MINGLA — every slot, night, tier,
 * price and count a site shows comes from Core's live reads, and every
 * booking link is this brand's own Mingla route (test:
 * mingla-sites/src/contracts/bookingBlocks.issue4453.test.ts).
 */
import { hasOnlyKeys, isCanonicalMinglaHref, isIanaTimeZone, plainObject, UUID_RE } from "./safety.ts";

export const AVAILABILITY_SOURCES = ["venue_slots", "experience_slots", "trip_departures", "event_dates", "stay_nights"] as const;
export type AvailabilitySource = (typeof AVAILABILITY_SOURCES)[number];

export const AVAILABILITY_LIMITS = {
  days_min: 3,
  days_max: 14,
  days_default: 7,
  slots_per_day: 24,
  label: 24,
  /** "Few" means at most this many places left. */
  few: 3,
  party_min: 1,
  party_max: 20,
  party_default: 2,
} as const;

export const TICKET_TIERS_MAX = 6;
/** At most this many live reads one page asks Core for (each kind). */
export const BOOKING_REQUESTS_MAX = 6;

export type SlotState = "open" | "few" | "full";

export type AvailabilitySlot = {
  label: string;
  /** Local wall time in the feed's timezone: `YYYY-MM-DDTHH:MM`, or `YYYY-MM-DD` for a whole day or night. */
  start_local: string;
  state: SlotState;
  /** Places (or rooms) left; null when Mingla does not count them. */
  left: number | null;
  price_minor: number | null;
  currency: string | null;
  /** This brand's Mingla page for the slot, pre-filled; always null for a full slot. */
  href: string | null;
};

export type AvailabilityDay = { local_date: string; slots: AvailabilitySlot[] };

export type AvailabilityFeed = {
  generated_at: string;
  /** The venue's or offering's own zone (Constitution 12). */
  timezone: string;
  source: AvailabilitySource;
  /** Title of what is being booked (the venue, room or offering), from Mingla. */
  title: string | null;
  days: AvailabilityDay[];
};

export type TierState = "on_sale" | "sold_out" | "not_yet" | "ended";

export type TicketTier = {
  id: string;
  name: string;
  price_minor: number | null;
  currency: string | null;
  is_free: boolean;
  state: TierState;
  /** When sales open, for a tier not on sale yet. */
  sale_starts_at: string | null;
  /** The checkout with this tier picked; null unless on sale. */
  href: string | null;
};

export type TicketTiersFeed = {
  generated_at: string;
  event: {
    id: string;
    title: string;
    start_at: string | null;
    end_at: string | null;
    timezone: string | null;
    status: "scheduled" | "live" | "ended" | "cancelled";
    public_url: string;
  };
  tiers: TicketTier[];
};

export const BOOKING_TARGET_KINDS = ["venue_table", "stay", "experience"] as const;
export type BookingTargetKind = (typeof BOOKING_TARGET_KINDS)[number];

/** What the hero booking bar submits to: a Mingla page of this brand, never chosen by Ari. */
export type BookingTarget = {
  kind: BookingTargetKind;
  id: string;
  title: string;
  /** The Mingla page (no query); the bar adds only the pre-fill parameters. */
  base_url: string;
  timezone: string | null;
  /** The lowest live price ("from"), never typed. */
  min_price_minor: number | null;
  currency: string | null;
};

/* ------------------------------ links ------------------------------ */

const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const LOCAL_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])(T([01]\d|2[0-3]):[0-5]\d)?$/;
const SLUG_SEGMENT = "[A-Za-z0-9][A-Za-z0-9._~-]{0,199}";

/** The pre-fill parameters Mingla's pages read (§10.3) and nothing else. */
export const PREFILL_PARAMS = ["tab", "date", "time", "party", "checkin", "checkout", "guests", "room", "slot", "seed", "eventDateId"] as const;

export function isLocalDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

export function isLocalTime(value: unknown): value is string {
  return typeof value === "string" && TIME_RE.test(value);
}

function paramOk(name: string, value: string): boolean {
  switch (name) {
    case "tab": return value === "book" || value === "stay" || value === "reservations";
    case "date": case "checkin": case "checkout": return isLocalDate(value);
    case "time": case "slot": return isLocalTime(value);
    case "party": case "guests": return /^(?:[1-9]|1\d|20)$/.test(value);
    case "room": case "eventDateId": return UUID_RE.test(value);
    case "seed": return value.endsWith(":1") && UUID_RE.test(value.slice(0, -2));
    default: return false;
  }
}

/**
 * Is this a booking link to THIS brand's own Mingla page, with only known,
 * well-formed pre-fill parameters? `/checkout/{eventId}` is accepted only for
 * an event id the caller says is this brand's (`eventIds`).
 */
export function isBrandBookingHref(value: unknown, brandSlug: string, eventIds: ReadonlySet<string> = new Set()): value is string {
  if (!isCanonicalMinglaHref(value) || !/^[a-z0-9][a-z0-9-]{0,62}$/i.test(brandSlug)) return false;
  const url = new URL(value);
  if (url.hash || url.username || url.password) return false;
  const brand = brandSlug.toLowerCase();
  const path = url.pathname;
  const own = new RegExp(`^/(?:b/${brand}/v/[a-z0-9]{1,32}|exp/${brand}/${SLUG_SEGMENT}|e/${brand}/${SLUG_SEGMENT}|t/${brand}/${SLUG_SEGMENT})$`).test(path);
  const checkout = /^\/checkout\/([0-9a-f-]{36})$/i.exec(path);
  if (!own && !(checkout && eventIds.has(checkout[1]!.toLowerCase()))) return false;
  const seen = new Set<string>();
  for (const [name, param] of url.searchParams) {
    if (seen.has(name) || !(PREFILL_PARAMS as readonly string[]).includes(name) || !paramOk(name, param)) return false;
    seen.add(name);
  }
  return true;
}

/* ------------------------------ parsing ------------------------------ */

function isInstant(value: unknown): value is string {
  return typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value));
}

function countOrNull(value: unknown, max: number): value is number | null {
  return value === null || (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max);
}

function currencyOrNull(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && /^[A-Z]{3}$/.test(value));
}

function shortText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max && !/[<>]/.test(value);
}

/** The state a count implies ("few" is 1-3 left; 0 is full). */
export function slotStateFor(left: number | null, full: boolean): SlotState {
  if (full || left === 0) return "full";
  return left !== null && left <= AVAILABILITY_LIMITS.few ? "few" : "open";
}

function slotOk(value: unknown, brandSlug: string, eventIds: ReadonlySet<string>): value is AvailabilitySlot {
  if (!plainObject(value) || !hasOnlyKeys(value, ["label", "start_local", "state", "left", "price_minor", "currency", "href"])) return false;
  const v = value;
  if (!shortText(v.label, AVAILABILITY_LIMITS.label) || typeof v.start_local !== "string" || !LOCAL_RE.test(v.start_local)) return false;
  if (!countOrNull(v.left, 100_000) || !countOrNull(v.price_minor, 1_000_000_000_000) || !currencyOrNull(v.currency)) return false;
  if (v.state !== slotStateFor(v.left as number | null, v.state === "full")) return false;
  // A full slot is text, never a link; an open slot always links to Mingla.
  if (v.state === "full") return v.href === null;
  return isBrandBookingHref(v.href, brandSlug, eventIds);
}

/**
 * Core's availability for one block → the feed, or null when anything is not
 * trustworthy (wrong limits, a link to another brand, a full slot with a link).
 * Fail closed: the block renders nothing rather than a wrong slot.
 */
export function parseAvailability(raw: unknown, brandSlug: string, eventIds: ReadonlySet<string> = new Set()): AvailabilityFeed | null {
  if (!plainObject(raw) || !hasOnlyKeys(raw, ["generated_at", "timezone", "source", "title", "days"])) return null;
  if (!isInstant(raw.generated_at) || !isIanaTimeZone(raw.timezone)) return null;
  if (!(AVAILABILITY_SOURCES as readonly unknown[]).includes(raw.source)) return null;
  if (raw.title !== null && !shortText(raw.title, 200)) return null;
  if (!Array.isArray(raw.days) || raw.days.length > AVAILABILITY_LIMITS.days_max) return null;
  let previous = "";
  for (const day of raw.days) {
    if (!plainObject(day) || !hasOnlyKeys(day, ["local_date", "slots"]) || !isLocalDate(day.local_date) || day.local_date <= previous) return null;
    previous = day.local_date;
    if (!Array.isArray(day.slots) || day.slots.length > AVAILABILITY_LIMITS.slots_per_day) return null;
    for (const slot of day.slots) {
      if (!slotOk(slot, brandSlug, eventIds)) return null;
      if (!(slot as AvailabilitySlot).start_local.startsWith(day.local_date)) return null;
    }
  }
  return raw as unknown as AvailabilityFeed;
}

/** The days a strip shows: only days with at least one slot (an empty day is left out). */
export function visibleDays(feed: AvailabilityFeed | null | undefined): AvailabilityDay[] {
  return feed ? feed.days.filter((day) => day.slots.length > 0) : [];
}

/** Does the feed hold at least one bookable (not full) slot? */
export function hasOpenSlot(feed: AvailabilityFeed | null | undefined): boolean {
  return visibleDays(feed).some((day) => day.slots.some((slot) => slot.state !== "full"));
}

const TIER_KEYS = ["id", "name", "price_minor", "currency", "is_free", "state", "sale_starts_at", "href"] as const;
const EVENT_KEYS = ["id", "title", "start_at", "end_at", "timezone", "status", "public_url"] as const;

/**
 * Core's public ticket tiers for one event → the feed, or null. At most six
 * tiers; a tier links to the checkout only while on sale. Hidden, link-only
 * and member-pass tiers are never in Core's answer; this parser cannot tell,
 * so Core's read is the one rule (pg17 test), and this checks the shape.
 */
export function parseTicketTiers(raw: unknown, brandSlug: string): TicketTiersFeed | null {
  if (!plainObject(raw) || !hasOnlyKeys(raw, ["generated_at", "event", "tiers"]) || !isInstant(raw.generated_at)) return null;
  const event = raw.event;
  if (!plainObject(event) || !hasOnlyKeys(event, EVENT_KEYS)) return null;
  if (typeof event.id !== "string" || !UUID_RE.test(event.id) || !shortText(event.title, 200)) return null;
  if ((event.start_at !== null && !isInstant(event.start_at)) || (event.end_at !== null && !isInstant(event.end_at))) return null;
  if (event.timezone !== null && !isIanaTimeZone(event.timezone)) return null;
  if (!["scheduled", "live", "ended", "cancelled"].includes(String(event.status))) return null;
  if (!isBrandBookingHref(event.public_url, brandSlug) || !String(event.public_url).includes(`/e/`)) return null;
  const eventIds = new Set([event.id.toLowerCase()]);
  if (!Array.isArray(raw.tiers) || raw.tiers.length > TICKET_TIERS_MAX) return null;
  const ids = new Set<string>();
  for (const tier of raw.tiers) {
    if (!plainObject(tier) || !hasOnlyKeys(tier, TIER_KEYS)) return null;
    if (typeof tier.id !== "string" || !UUID_RE.test(tier.id) || ids.has(tier.id) || !shortText(tier.name, 120)) return null;
    ids.add(tier.id);
    if (!countOrNull(tier.price_minor, 1_000_000_000_000) || !currencyOrNull(tier.currency) || typeof tier.is_free !== "boolean") return null;
    if (!["on_sale", "sold_out", "not_yet", "ended"].includes(String(tier.state))) return null;
    if (tier.sale_starts_at !== null && !isInstant(tier.sale_starts_at)) return null;
    if (tier.state === "on_sale") {
      if (!isBrandBookingHref(tier.href, brandSlug, eventIds) || !String(tier.href).includes(`seed=${tier.id}`)) return null;
    } else if (tier.href !== null) return null;
  }
  return raw as unknown as TicketTiersFeed;
}

/** The tiers a block shows right now: none once the event has ended or was cancelled (SC-B2). */
export function liveTicketTiers(feed: TicketTiersFeed | null | undefined, now: Date): TicketTier[] {
  if (!feed) return [];
  const { event } = feed;
  if (event.status === "ended" || event.status === "cancelled") return [];
  const last = event.end_at ?? event.start_at;
  if (last && Date.parse(last) < now.getTime()) return [];
  const shown = feed.tiers.filter((tier) => tier.state !== "ended");
  return shown.some((tier) => tier.state === "on_sale") ? shown.slice(0, TICKET_TIERS_MAX) : [];
}

export function parseBookingTarget(raw: unknown, brandSlug: string): BookingTarget | null {
  if (!plainObject(raw) || !hasOnlyKeys(raw, ["kind", "id", "title", "base_url", "timezone", "min_price_minor", "currency"])) return null;
  if (!(BOOKING_TARGET_KINDS as readonly unknown[]).includes(raw.kind)) return null;
  if (typeof raw.id !== "string" || !UUID_RE.test(raw.id) || !shortText(raw.title, 200)) return null;
  if (!isBrandBookingHref(raw.base_url, brandSlug) || new URL(String(raw.base_url)).search) return null;
  const path = new URL(String(raw.base_url)).pathname;
  if ((raw.kind === "experience") !== path.startsWith("/exp/")) return null;
  if (raw.kind !== "experience" && !path.startsWith("/b/")) return null;
  if (raw.timezone !== null && !isIanaTimeZone(raw.timezone)) return null;
  if (!countOrNull(raw.min_price_minor, 1_000_000_000_000) || !currencyOrNull(raw.currency)) return null;
  return raw as unknown as BookingTarget;
}

/** What a visitor typed into the hero bar (blank fields are simply left out). */
export type BookingBarValues = { date?: string; time?: string; party?: string; checkin?: string; checkout?: string; guests?: string };

/**
 * The Mingla URL the hero bar (and the sticky bar) hands off to: the target's
 * own page plus ONLY the pre-fill parameters its kind reads, each re-checked
 * (a bad value is dropped; Mingla's page re-validates again). No
 * availability call: Mingla's page shows what is free.
 */
export function bookingBarHref(target: BookingTarget, values: BookingBarValues = {}): string {
  const url = new URL(target.base_url);
  const put = (name: string, value: string | undefined) => {
    if (value !== undefined && value !== "" && paramOk(name, value)) url.searchParams.set(name, value);
  };
  switch (target.kind) {
    case "venue_table":
      url.searchParams.set("tab", "book");
      put("date", values.date); put("time", values.time); put("party", values.party);
      break;
    case "stay":
      url.searchParams.set("tab", "stay");
      put("checkin", values.checkin);
      if (values.checkin && values.checkout && isLocalDate(values.checkin) && isLocalDate(values.checkout) && values.checkout > values.checkin) put("checkout", values.checkout);
      put("guests", values.guests);
      break;
    case "experience":
      put("date", values.date); put("guests", values.guests);
      break;
    default: {
      const never: never = target.kind;
      throw new Error(`BOOKING_TARGET_UNKNOWN:${String(never)}`);
    }
  }
  return url.toString();
}

/* ------------------------------ requests ------------------------------ */

export type AvailabilityRequest = { source: AvailabilitySource; target_id: string; party_size: number; days: number };
export type BookingTargetRequest = { kind: BookingTargetKind; id: string };
/** What one page asks Core for (derived from its stored blocks, never from the visitor). */
export type BookingRequest = {
  availability: AvailabilityRequest[];
  ticket_tiers: string[];
  targets: BookingTargetRequest[];
  rating: boolean;
};

export type BookingFeed = {
  generated_at: string;
  availability: Record<string, AvailabilityFeed>;
  ticket_tiers: Record<string, TicketTiersFeed>;
  targets: Record<string, BookingTarget>;
  rating: unknown;
};

export function availabilityKey(request: AvailabilityRequest): string {
  return `${request.source}:${request.target_id.toLowerCase()}:${request.party_size}:${request.days}`;
}

export function targetKey(request: BookingTargetRequest): string {
  return `${request.kind}:${request.id.toLowerCase()}`;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

type BlockLike = { type?: unknown; [key: string]: unknown };

/** The availability request one stored block makes (null when it names nothing). */
export function availabilityRequestFor(block: BlockLike): AvailabilityRequest | null {
  if (block.type !== "availability" || !(AVAILABILITY_SOURCES as readonly unknown[]).includes(block.source)) return null;
  const source = block.source as AvailabilitySource;
  const target = source === "stay_nights" ? block.stay_offering_id : block.offering_id;
  if (typeof target !== "string" || !UUID_RE.test(target)) return null;
  return {
    source,
    target_id: target.toLowerCase(),
    party_size: source === "venue_slots" ? clampInt(block.party_size, AVAILABILITY_LIMITS.party_min, AVAILABILITY_LIMITS.party_max, AVAILABILITY_LIMITS.party_default) : 1,
    days: clampInt(block.days, AVAILABILITY_LIMITS.days_min, AVAILABILITY_LIMITS.days_max, AVAILABILITY_LIMITS.days_default),
  };
}

/** The hero bar's target (null for none and for the trip search, which reads the offerings feed). */
export function heroTargetRequestFor(block: BlockLike): BookingTargetRequest | null {
  if (block.type !== "hero" || !(BOOKING_TARGET_KINDS as readonly unknown[]).includes(block.booking_bar)) return null;
  if (typeof block.booking_target_id !== "string" || !UUID_RE.test(block.booking_target_id)) return null;
  return { kind: block.booking_bar as BookingTargetKind, id: block.booking_target_id.toLowerCase() };
}

/** Does this stored block read the live booking facts when it renders? */
export function blockReadsBooking(block: BlockLike): boolean {
  return availabilityRequestFor(block) !== null || block.type === "ticket_tiers" || heroTargetRequestFor(block) !== null ||
    ((block.type === "hero" || block.type === "testimonials") && block.show_rating === true);
}

/** Everything a page's stored blocks ask Core for, deduplicated and capped. */
export function bookingRequestFor(blocks: readonly BlockLike[]): BookingRequest {
  const availability = new Map<string, AvailabilityRequest>();
  const tiers = new Set<string>();
  const targets = new Map<string, BookingTargetRequest>();
  let rating = false;
  for (const block of blocks) {
    const slots = availabilityRequestFor(block);
    if (slots && availability.size < BOOKING_REQUESTS_MAX) availability.set(availabilityKey(slots), slots);
    if (block.type === "ticket_tiers" && typeof block.offering_id === "string" && UUID_RE.test(block.offering_id) && tiers.size < BOOKING_REQUESTS_MAX) {
      tiers.add(block.offering_id.toLowerCase());
    }
    const target = heroTargetRequestFor(block);
    if (target && targets.size < BOOKING_REQUESTS_MAX) targets.set(targetKey(target), target);
    if ((block.type === "hero" || block.type === "testimonials") && block.show_rating === true) rating = true;
  }
  return { availability: [...availability.values()], ticket_tiers: [...tiers], targets: [...targets.values()], rating };
}

/** Core's side: a request body is exactly this shape and within the caps, or it is refused. */
export function parseBookingRequest(raw: unknown): BookingRequest | null {
  if (!plainObject(raw) || !hasOnlyKeys(raw, ["availability", "ticket_tiers", "targets", "rating"])) return null;
  if (!Array.isArray(raw.availability) || !Array.isArray(raw.ticket_tiers) || !Array.isArray(raw.targets) || typeof raw.rating !== "boolean") return null;
  if (raw.availability.length > BOOKING_REQUESTS_MAX || raw.ticket_tiers.length > BOOKING_REQUESTS_MAX || raw.targets.length > BOOKING_REQUESTS_MAX) return null;
  const availability: AvailabilityRequest[] = [];
  for (const row of raw.availability) {
    if (!plainObject(row) || !hasOnlyKeys(row, ["source", "target_id", "party_size", "days"])) return null;
    const parsed = availabilityRequestFor({
      type: "availability", source: row.source,
      [row.source === "stay_nights" ? "stay_offering_id" : "offering_id"]: row.target_id,
      party_size: row.party_size, days: row.days,
    });
    if (!parsed || parsed.party_size !== row.party_size || parsed.days !== row.days) return null;
    availability.push(parsed);
  }
  const tiers: string[] = [];
  for (const id of raw.ticket_tiers) {
    if (typeof id !== "string" || !UUID_RE.test(id)) return null;
    tiers.push(id.toLowerCase());
  }
  const targets: BookingTargetRequest[] = [];
  for (const row of raw.targets) {
    if (!plainObject(row) || !hasOnlyKeys(row, ["kind", "id"])) return null;
    const parsed = heroTargetRequestFor({ type: "hero", booking_bar: row.kind, booking_target_id: row.id });
    if (!parsed) return null;
    targets.push(parsed);
  }
  return { availability, ticket_tiers: tiers, targets, rating: raw.rating };
}

export function isEmptyBookingRequest(request: BookingRequest): boolean {
  return !request.availability.length && !request.ticket_tiers.length && !request.targets.length && !request.rating;
}
