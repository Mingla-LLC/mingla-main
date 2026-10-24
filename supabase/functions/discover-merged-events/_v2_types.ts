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

export function isDiscoverV2Request(value: unknown): value is DiscoverV2Request {
  if (!value || typeof value !== "object") return false;
  const body = value as Record<string, unknown>;
  return body.contract === 2 && (body.op === "facets" || body.op === "page");
}
