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

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isOptionalStringArray(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.every((item) => typeof item === "string"));
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
  if (f.kind === "events" &&
    (!isOptionalString(values.when) || !isOptionalStringArray(values.price) ||
      !isOptionalStringArray(values.partyTypes) || !isOptionalStringArray(values.vibeTags) ||
      !isOptionalStringArray(values.musicGenres))) return "invalid_filters";
  if (f.kind === "experiences" &&
    (!isOptionalString(values.when) || !isOptionalStringArray(values.goodFor) || !isOptionalStringArray(values.price))) return "invalid_filters";
  if (f.kind === "trips" &&
    (!isOptionalString(values.destination) || !isOptionalString(values.leavingFrom) || !isOptionalString(values.when))) return "invalid_filters";
  if (f.kind === "stays" &&
    (!isOptionalString(values.checkIn) ||
      (values.guests !== undefined && !Number.isInteger(values.guests)) ||
      !isOptionalStringArray(values.propertyKinds))) return "invalid_filters";

  if (body.cursor !== undefined && body.cursor !== null && typeof body.cursor !== "string") return "invalid_cursor";
  if (body.size !== undefined && (!Number.isInteger(body.size) || (body.size as number) < 1 || (body.size as number) > 50)) return "invalid_page_size";
  if (body.deviceTz !== undefined && typeof body.deviceTz !== "string") return "invalid_timezone";
  return null;
}

export function isDiscoverV2Request(value: unknown): value is DiscoverV2Request {
  return validateDiscoverV2Request(value) === null;
}
