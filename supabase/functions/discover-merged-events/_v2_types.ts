import {
  MUSIC_GENRE_SLUGS,
  PARTY_TYPE_SLUGS,
  VIBE_TAG_SLUGS,
  isSubsetOf,
} from "../_shared/eventTaxonomy.ts";

export type DiscoverKind = "events" | "experiences" | "trips" | "stays";

export type DiscoverFiltersV2 =
  | { kind: "events"; f: { when?: "tomorrow" | "weekend"; price?: string[]; partyTypes?: string[]; vibeTags?: string[]; musicGenres?: string[] } }
  | { kind: "experiences"; f: { when?: "tomorrow" | "weekend"; goodFor?: string[]; price?: string[] } }
  | { kind: "trips"; f: { destination?: string; leavingFrom?: string; when?: "this_month" | "next_month" } }
  | { kind: "stays"; f: { checkIn?: "tonight" | "tomorrow" | "weekend"; guests?: number; propertyKinds?: string[] } };

export interface DiscoverV2Request {
  contract: 2;
  op: "facets" | "page";
  anchor: { name: string | null; stateCode: string | null; countryCode: string | null; lat: number; lng: number; radiusKm: number };
  filters: DiscoverFiltersV2;
  cursor?: string | null;
  size?: number;
  deviceTz?: string;
}
export const DISCOVER_KINDS = ["events", "experiences", "trips", "stays"] as const;
const EVENT_WHEN = ["tomorrow", "weekend"] as const;
const TRIP_WHEN = ["this_month", "next_month"] as const;
const STAY_CHECK_IN = ["tonight", "tomorrow", "weekend"] as const;
const EXPERIENCE_GOOD_FOR = ["adventurous", "first-date", "romantic", "group-fun"] as const;
const EVENT_PRICE_OPTIONS = ["free_rsvp", "free_ticket", "band_1", "band_2", "band_3", "band_4"] as const;
const EXPERIENCE_PRICE_OPTIONS = ["free", "band_1", "band_2", "band_3", "band_4"] as const;
const STAY_PROPERTY_KINDS = [
  "hotel", "resort", "guest_house", "lodge", "serviced_apartment", "short_stay_apartment", "other",
] as const;
const FILTER_FIELDS: Record<DiscoverKind, readonly string[]> = {
  events: ["when", "price", "partyTypes", "vibeTags", "musicGenres"],
  experiences: ["when", "goodFor", "price"],
  trips: ["destination", "leavingFrom", "when"],
  stays: ["checkIn", "guests", "propertyKinds"],
};

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isOptionalEnum(value: unknown, allowed: readonly string[]): boolean {
  return value === undefined || (typeof value === "string" && allowed.includes(value));
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isOptionalEnumArray(value: unknown, allowed: readonly string[]): boolean {
  return value === undefined || (Array.isArray(value) && isSubsetOf(value, allowed));
}

function isValidTimezone(value: unknown): boolean {
  if (value === undefined) return true;
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export function isDiscoverV2Envelope(value: unknown): value is Record<string, unknown> & { contract: 2 } {
  return Boolean(value && typeof value === "object" && (value as Record<string, unknown>).contract === 2);
}

export function validateDiscoverV2Request(value: unknown): string | null {
  if (!isDiscoverV2Envelope(value)) return "invalid_contract";
  const body = value as Record<string, unknown>;
  if (body.op !== "facets" && body.op !== "page") return "invalid_operation";

  const anchor = body.anchor;
  if (!anchor || typeof anchor !== "object" || Array.isArray(anchor)) return "invalid_anchor";
  const a = anchor as Record<string, unknown>;
  if (!isNullableString(a.name) || !isNullableString(a.stateCode) || !isNullableString(a.countryCode)) return "invalid_anchor";
  if (!isFiniteNumber(a.lat) || a.lat < -90 || a.lat > 90 ||
    !isFiniteNumber(a.lng) || a.lng < -180 || a.lng > 180 ||
    !isFiniteNumber(a.radiusKm) || a.radiusKm <= 0 || a.radiusKm > 500) return "invalid_anchor";

  const filters = body.filters;
  if (!filters || typeof filters !== "object" || Array.isArray(filters)) return "invalid_filters";
  const f = filters as Record<string, unknown>;
  if (typeof f.kind !== "string" || !DISCOVER_KINDS.includes(f.kind as DiscoverKind)) return "invalid_kind";
  if (!f.f || typeof f.f !== "object" || Array.isArray(f.f)) return "invalid_filters";
  const values = f.f as Record<string, unknown>;
  const extra = Object.keys(values).find((key) => !FILTER_FIELDS[f.kind as DiscoverKind].includes(key));
  if (extra) return `invalid_filter:${extra}`;
  if (f.kind === "events" &&
    (!isOptionalEnum(values.when, EVENT_WHEN) || !isOptionalEnumArray(values.price, EVENT_PRICE_OPTIONS) ||
      !isOptionalEnumArray(values.partyTypes, PARTY_TYPE_SLUGS) || !isOptionalEnumArray(values.vibeTags, VIBE_TAG_SLUGS) ||
      !isOptionalEnumArray(values.musicGenres, MUSIC_GENRE_SLUGS))) return "invalid_filters";
  if (f.kind === "experiences" &&
    (!isOptionalEnum(values.when, EVENT_WHEN) || !isOptionalEnumArray(values.goodFor, EXPERIENCE_GOOD_FOR) ||
      !isOptionalEnumArray(values.price, EXPERIENCE_PRICE_OPTIONS))) return "invalid_filters";
  if (f.kind === "trips" &&
    (!isOptionalString(values.destination) || !isOptionalString(values.leavingFrom) || !isOptionalEnum(values.when, TRIP_WHEN))) return "invalid_filters";
  if (f.kind === "stays" &&
    (!isOptionalEnum(values.checkIn, STAY_CHECK_IN) ||
      (values.guests !== undefined && (!Number.isInteger(values.guests) || (values.guests as number) < 1 || (values.guests as number) > 8)) ||
      !isOptionalEnumArray(values.propertyKinds, STAY_PROPERTY_KINDS))) return "invalid_filters";

  if (body.cursor !== undefined && body.cursor !== null && typeof body.cursor !== "string") return "invalid_cursor";
  if (body.size !== undefined && (!Number.isInteger(body.size) || (body.size as number) < 1 || (body.size as number) > 50)) return "invalid_page_size";
  if (!isValidTimezone(body.deviceTz)) return "invalid_timezone";
  return null;
}

export function discoverV2ValidationFailure(value: unknown): { error: string; status: 400 } | null {
  const error = validateDiscoverV2Request(value);
  return error ? { error, status: 400 } : null;
}

export function isDiscoverV2Request(value: unknown): value is DiscoverV2Request {
  return validateDiscoverV2Request(value) === null;
}
