/**
 * #4453 milestone 9 (spec v2.1 §1.2, decision N1) — offering detail pages.
 *
 * Each trip, event, experience and room of the brand gets a page on the
 * brand's own site at `/{base}/{slug}`, behind `SITES_DETAIL_PAGES`. Nothing
 * is stored per offering: the page is drawn from the live feed row (title,
 * summary, cover, dates, "from" price, places left, status, the Mingla page)
 * plus Core's `brand_site_offering_detail` read (the trip's days and what is
 * included, a room's facts, the room's own photos). Every Book action is the
 * feed row's `public_url`, which is checked by the booking lock: a detail page
 * never takes a booking or a payment (I-SITES-DETAIL-BOOKS-ON-MINGLA).
 *
 * Fields Mingla does not hold are not drawn; owners and Ari type nothing on a
 * detail page.
 */
import { boundedText, hasOnlyKeys, plainObject, UUID_RE } from "./safety.ts";
import { isOfferingCoverPath, offeringState, type OfferingKind, type SiteOffering } from "./offerings.ts";
import { hrefForPath, isSlug, offeringBasePath, type SiteRoutes } from "./routes.ts";

export const MAX_DETAIL_DAYS = 14;
export const MAX_DETAIL_INCLUDED = 12;
export const MAX_DETAIL_PHOTOS = 8;
export const MAX_DETAIL_FACT_LIST = 12;

export type OfferingDetailDay = { day: number; title: string; summary: string | null };
export type OfferingDetailPhoto = { path: string; alt: string | null };
export type OfferingStayFacts = {
  kind: "room" | "place";
  max_guests: number;
  max_adults: number | null;
  max_children: number | null;
  amenities: string[];
  accessibility: string[];
};

/** What Core adds to a feed row for its detail page (public fields only). */
export type OfferingDetail = {
  offering_id: string;
  kind: OfferingKind;
  days: OfferingDetailDay[];
  included: string[];
  stay: OfferingStayFacts | null;
  photos: OfferingDetailPhoto[];
};

/** The singular word for one offering of a kind ("This trip has ended"). */
export const DETAIL_NOUN: Readonly<Record<OfferingKind, string>> = {
  trip: "trip",
  event: "event",
  experience: "session",
  stay: "room",
  venue: "offer",
};

/** The site path of an offering's detail page ("trips/lofoten"), never with a leading slash. */
export function offeringDetailPath(routes: SiteRoutes, offering: Pick<SiteOffering, "kind" | "slug">): string | null {
  if (offering.kind === "venue") return null;
  if (!isDetailSlug(offering.slug)) return null;
  return `${offeringBasePath(routes, offering.kind)}/${offering.slug}`;
}

export function offeringDetailHref(routes: SiteRoutes, offering: Pick<SiteOffering, "kind" | "slug">): string | null {
  const path = offeringDetailPath(routes, offering);
  return path === null ? null : hrefForPath(path);
}

/**
 * A feed slug that can be a path segment. Feed slugs are wider than page
 * slugs (they may carry dots or capitals); a slug that is not a plain
 * lowercase slug or a room's id simply gets no detail page (its card keeps
 * linking to Mingla).
 */
export function isDetailSlug(value: unknown): value is string {
  return isSlug(value) || (typeof value === "string" && UUID_RE.test(value) && value === value.toLowerCase());
}

/**
 * Does this offering get a detail page at all? Cancelled ones do not (404);
 * ended ones do (they say so and are `noindex`).
 */
export function offeringHasDetailPage(offering: SiteOffering, now: Date): boolean {
  return offering.kind !== "venue" && isDetailSlug(offering.slug) && !offeringState(offering, now).cancelled;
}

/** Listed in the sitemap: a detail page that is upcoming or open (not ended, not cancelled). */
export function offeringDetailIndexable(offering: SiteOffering, now: Date): boolean {
  const state = offeringState(offering, now);
  return offering.kind !== "venue" && isDetailSlug(offering.slug) && !state.cancelled && state.phase !== "ended";
}

/**
 * SC-DP3 — every live page whose address is a live offering's detail
 * address (publish refuses with ROUTE_COLLISION). Ended and cancelled
 * offerings never claim an address here.
 */
export function findOfferingRouteCollisions(input: {
  paths: readonly string[];
  routes: SiteRoutes;
  offerings: readonly SiteOffering[];
  now: Date;
}): string[] {
  const pages = new Set(input.paths);
  const problems: string[] = [];
  for (const offering of input.offerings) {
    if (!offeringDetailIndexable(offering, input.now)) continue;
    const path = offeringDetailPath(input.routes, offering);
    if (path !== null && pages.has(path)) problems.push(`${hrefForPath(path)} is used by a page and the ${DETAIL_NOUN[offering.kind]} "${offering.title}"`);
  }
  return problems;
}

function textList(value: unknown, max: number, itemMax: number): string[] | null {
  if (!Array.isArray(value) || value.length > max) return null;
  const out: string[] = [];
  for (const item of value) {
    if (!boundedText(item, itemMax, true)) return null;
    out.push(String(item));
  }
  return out;
}

function countOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 1000);
}

function stayFacts(value: unknown): OfferingStayFacts | null | undefined {
  if (value === null) return null;
  if (!plainObject(value) || !hasOnlyKeys(value, ["kind", "max_guests", "max_adults", "max_children", "amenities", "accessibility"])) return undefined;
  const amenities = textList(value.amenities, MAX_DETAIL_FACT_LIST, 80);
  const accessibility = textList(value.accessibility, MAX_DETAIL_FACT_LIST, 80);
  if (
    (value.kind !== "room" && value.kind !== "place") ||
    typeof value.max_guests !== "number" || !Number.isInteger(value.max_guests) || value.max_guests < 1 || value.max_guests > 1000 ||
    !countOrNull(value.max_adults) || !countOrNull(value.max_children) || !amenities || !accessibility
  ) return undefined;
  return {
    kind: value.kind,
    max_guests: value.max_guests,
    max_adults: value.max_adults as number | null,
    max_children: value.max_children as number | null,
    amenities,
    accessibility,
  };
}

/**
 * Core's answer → validated, for exactly the offering the feed named.
 * Returns null (the page draws from the feed row alone) when anything is
 * off: another offering's id, another kind, unknown keys, over the limits,
 * or a photo outside Mingla's public cover storage. Fails closed.
 */
export function parseOfferingDetail(raw: unknown, expect: { id: string; kind: OfferingKind }): OfferingDetail | null {
  if (!plainObject(raw) || !hasOnlyKeys(raw, ["offering_id", "kind", "days", "included", "stay", "photos"])) return null;
  if (typeof raw.offering_id !== "string" || raw.offering_id.toLowerCase() !== expect.id.toLowerCase() || raw.kind !== expect.kind) return null;
  const daysRaw = raw.days ?? [];
  if (!Array.isArray(daysRaw) || daysRaw.length > MAX_DETAIL_DAYS) return null;
  const days: OfferingDetailDay[] = [];
  for (const day of daysRaw) {
    if (
      !plainObject(day) || !hasOnlyKeys(day, ["day", "title", "summary"]) ||
      typeof day.day !== "number" || !Number.isInteger(day.day) || day.day < 1 || day.day > 365 ||
      !boundedText(day.title, 120, true) || !(day.summary === null || boundedText(day.summary, 600, true))
    ) return null;
    days.push({ day: day.day, title: String(day.title), summary: day.summary === null ? null : String(day.summary) });
  }
  const included = textList(raw.included ?? [], MAX_DETAIL_INCLUDED, 200);
  if (!included) return null;
  const stay = stayFacts(raw.stay ?? null);
  if (stay === undefined || (stay !== null && expect.kind !== "stay")) return null;
  const photosRaw = raw.photos ?? [];
  if (!Array.isArray(photosRaw) || photosRaw.length > MAX_DETAIL_PHOTOS) return null;
  const photos: OfferingDetailPhoto[] = [];
  for (const photo of photosRaw) {
    if (!plainObject(photo) || !hasOnlyKeys(photo, ["path", "alt"]) || !isOfferingCoverPath(photo.path) ||
      !(photo.alt === null || boundedText(photo.alt, 300))) return null;
    photos.push({ path: photo.path, alt: photo.alt === null ? null : String(photo.alt) });
  }
  return { offering_id: expect.id, kind: expect.kind, days, included, stay, photos };
}
