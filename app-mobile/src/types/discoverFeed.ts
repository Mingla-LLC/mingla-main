export const DISCOVER_KIND_ORDER = [
  "events",
  "experiences",
  "trips",
  "stays",
] as const;

export type DiscoverKind = (typeof DISCOVER_KIND_ORDER)[number];
export type DiscoverWhen = "tomorrow" | "weekend";
export type DiscoverTripWhen = "this_month" | "next_month";
export type DiscoverCheckIn = "tonight" | "tomorrow" | "weekend";
export type DiscoverPriceOption =
  | "free_rsvp"
  | "free_ticket"
  | "free"
  | "band_1"
  | "band_2"
  | "band_3"
  | "band_4";

export type DiscoverStayPropertyKind =
  | "hotel"
  | "resort"
  | "guest_house"
  | "lodge"
  | "serviced_apartment"
  | "short_stay_apartment"
  | "other";

export interface DiscoverAnchorV2 {
  name: string | null;
  stateCode: string | null;
  countryCode: string | null;
  lat: number;
  lng: number;
  radiusKm: number;
}
export interface DiscoverEventFilters {
  when?: DiscoverWhen;
  price?: DiscoverPriceOption[];
  partyTypes?: string[];
  vibeTags?: string[];
  musicGenres?: string[];
}

export interface DiscoverExperienceFilters {
  when?: DiscoverWhen;
  goodFor?: Array<"adventurous" | "first-date" | "romantic" | "group-fun">;
  price?: DiscoverPriceOption[];
}

export interface DiscoverTripFiltersV2 {
  destination?: string;
  leavingFrom?: string;
  when?: DiscoverTripWhen;
}

export interface DiscoverStayFiltersV2 {
  checkIn?: DiscoverCheckIn;
  guests?: number;
  propertyKinds?: DiscoverStayPropertyKind[];
}

export type DiscoverFiltersV2 =
  | { kind: "events"; f: DiscoverEventFilters }
  | { kind: "experiences"; f: DiscoverExperienceFilters }
  | { kind: "trips"; f: DiscoverTripFiltersV2 }
  | { kind: "stays"; f: DiscoverStayFiltersV2 };

export interface DiscoverFacetOption {
  id: string;
  count: number;
  label?: string;
}

export interface DiscoverFacetGroup {
  id:
    | "when"
    | "price"
    | "partyType"
    | "vibe"
    | "music"
    | "goodFor"
    | "destination"
    | "leavingFrom"
    | "checkIn"
    | "propertyKind"
    | "guests";
  multi: boolean;
  options: DiscoverFacetOption[];
}

export interface DiscoverPriceBands {
  currency: string;
  edgesMinor: number[];
  repeatSymbolInRange: boolean;
  compactThousands: boolean;
  symbol: string;
  bandsVersion: number;
}

export interface DiscoverFacetsResponse {
  contract: 2;
  city: {
    key: string;
    tz: string;
    tzSource: "supply" | "device";
    currency: string;
    label: string | null;
  };
  kinds: Record<DiscoverKind, { total: number; available: boolean }>;
  selected: {
    kind: DiscoverKind;
    total: number;
    minglaTotal: number;
    tm: { included: boolean; total: number; capped: boolean; poolCoverageEnd: string | null; error: string | null } | null;
  };
  groups: DiscoverFacetGroup[];
  priceBands: DiscoverPriceBands | null;
  nearestCity: { label: string; lat: number; lng: number; total: number } | null;
  stays: { enabled: boolean };
  generatedAt: string;
}

export interface DiscoverMinglaCard {
  source: "mingla";
  kind: "event" | "rsvp" | "experience" | "trip" | "stay";
  id: string;
  brand: {
    id: string;
    slug: string;
    name: string;
    photoUrl: string | null;
    verified?: boolean;
  };
  title: string;
  coverUrl: string | null;
  coverType: "image" | "video" | "gif" | null;
  coverHue: number;
  startsAtUtc: string | null;
  endsAtUtc: string | null;
  timezone: string;
  meta: { venueOrPlace: string | null; stops?: number; nights?: number };
  price: {
    currency: string;
    listMinor: number | null;
    saleMinor: number | null;
    saleEndsAt: string | null;
    isFree: boolean;
    unit: "each" | "per_night";
  } | null;
  route: { pathname: string; params: Record<string, string> };
}

export interface DiscoverTicketmasterCard {
  source: "ticketmaster";
  kind: "event";
  id: string;
  title: string;
  venueName: string;
  imageUrl: string;
  startsLocalDate: string;
  startsLocalTime: string | null;
  genre: string | null;
  price: { currency: string; minMajor: number | null; maxMajor: number | null } | null;
  ticketStatus: string;
  ticketUrl: string;
  raw: Record<string, unknown>;
}

export type DiscoverCardV2 = DiscoverMinglaCard | DiscoverTicketmasterCard;

export interface DiscoverPageResponse {
  contract: 2;
  items: DiscoverCardV2[];
  nextCursor: string | null;
  section: { minglaExhausted: boolean };
  tmError: string | null;
  fromCache: boolean;
}

export function emptyDiscoverFilters(kind: DiscoverKind): DiscoverFiltersV2 {
  if (kind === "events") return { kind, f: {} };
  if (kind === "experiences") return { kind, f: {} };
  if (kind === "trips") return { kind, f: {} };
  return { kind, f: { guests: 2 } };
}

function sortedStrings(value: unknown): unknown {
  return Array.isArray(value) ? [...value].sort() : value;
}

export function normalizeDiscoverFilters(filters: DiscoverFiltersV2): DiscoverFiltersV2 {
  const entries = Object.entries(filters.f)
    .filter(([, value]) => value !== undefined && (!Array.isArray(value) || value.length > 0))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => [key, sortedStrings(value)]);
  return { kind: filters.kind, f: Object.fromEntries(entries) } as DiscoverFiltersV2;
}
