/** Consumer Discover > Stays read layer. Issue #1423. */

import type { EventCoverMediaType } from "@mingla/offering-rendering";

import { supabase } from "./supabase";

export type StayPropertyKind =
  | "hotel"
  | "resort"
  | "guest_house"
  | "lodge"
  | "serviced_apartment"
  | "short_stay_apartment"
  | "other";

export type StayConfirmationMode = "request" | "instant";
export type StayAvailabilityState = "choose_dates" | "available";

export interface DiscoverStayFilters {
  destinationQuery: string | null;
  checkIn: string | null;
  checkOut: string | null;
  adults: number;
  children: number;
  rooms: number;
  propertyKinds: StayPropertyKind[];
  amenities: string[];
  confirmationMode: StayConfirmationMode | null;
}

export const EMPTY_DISCOVER_STAY_FILTERS: DiscoverStayFilters = {
  destinationQuery: null,
  checkIn: null,
  checkOut: null,
  adults: 2,
  children: 0,
  rooms: 1,
  propertyKinds: [],
  amenities: [],
  confirmationMode: null,
};

export interface DiscoverStayRow {
  venueId: string;
  brandId: string;
  brandSlug: string;
  brandName: string;
  venueSlug: string;
  venueName: string;
  propertyKind: StayPropertyKind;
  address: string | null;
  city: string | null;
  countryCode: string | null;
  coverMediaUrl: string | null;
  coverMediaType: EventCoverMediaType | null;
  coverAlt: string | null;
  amountMinor: string;
  currencyCode: string;
  confirmationModes: StayConfirmationMode[];
  amenities: string[];
  availabilityState: StayAvailabilityState;
}

export interface FetchPublishedStaysPage {
  enabled: boolean;
  rows: DiscoverStayRow[];
  totalCount: number;
}

export class StaysDiscoveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StaysDiscoveryError";
  }
}

const PROPERTY_KINDS = new Set<StayPropertyKind>([
  "hotel",
  "resort",
  "guest_house",
  "lodge",
  "serviced_apartment",
  "short_stay_apartment",
  "other",
]);
const CONFIRMATION_MODES = new Set<StayConfirmationMode>(["request", "instant"]);

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}

function mapRow(value: unknown): DiscoverStayRow {
  if (value === null || typeof value !== "object") {
    throw new StaysDiscoveryError("Stays returned an invalid response.");
  }
  const row = value as Record<string, unknown>;
  const requiredStrings = [
    "venueId",
    "brandId",
    "brandSlug",
    "brandName",
    "venueSlug",
    "venueName",
    "propertyKind",
    "amountMinor",
    "currencyCode",
    "availabilityState",
  ] as const;
  if (requiredStrings.some((key) => typeof row[key] !== "string")) {
    throw new StaysDiscoveryError("Stays returned an invalid response.");
  }
  if (!PROPERTY_KINDS.has(row.propertyKind as StayPropertyKind)) {
    throw new StaysDiscoveryError("Stays returned an invalid property type.");
  }
  if (row.availabilityState !== "choose_dates" && row.availabilityState !== "available") {
    throw new StaysDiscoveryError("Stays returned an invalid availability state.");
  }

  const coverPath = nullableString(row.coverPath);
  const venueCoverUrl = nullableString(row.venueCoverUrl);
  const venueCoverType = nullableString(row.venueCoverType);
  const coverMediaUrl = coverPath
    ? supabase.storage.from("brand_covers").getPublicUrl(coverPath).data.publicUrl
    : venueCoverUrl;
  const coverMediaType: EventCoverMediaType | null = coverPath
    ? "image"
    : venueCoverType === "image" || venueCoverType === "video" || venueCoverType === "gif"
      ? venueCoverType
      : null;

  return {
    venueId: row.venueId as string,
    brandId: row.brandId as string,
    brandSlug: row.brandSlug as string,
    brandName: row.brandName as string,
    venueSlug: row.venueSlug as string,
    venueName: row.venueName as string,
    propertyKind: row.propertyKind as StayPropertyKind,
    address: nullableString(row.address),
    city: nullableString(row.city),
    countryCode: nullableString(row.countryCode),
    coverMediaUrl,
    coverMediaType,
    coverAlt: nullableString(row.coverAlt),
    amountMinor: row.amountMinor as string,
    currencyCode: (row.currencyCode as string).toUpperCase(),
    confirmationModes: stringArray(row.confirmationModes).filter(
      (mode): mode is StayConfirmationMode =>
        CONFIRMATION_MODES.has(mode as StayConfirmationMode),
    ),
    amenities: stringArray(row.amenities),
    availabilityState: row.availabilityState as StayAvailabilityState,
  };
}

export async function fetchPublishedStays(
  filters: DiscoverStayFilters,
  page: { limit: number; offset: number },
): Promise<FetchPublishedStaysPage> {
  const { data, error } = await supabase.rpc("pg_public_stays_discover", {
    p_destination_query: filters.destinationQuery,
    p_check_in: filters.checkIn,
    p_check_out: filters.checkOut,
    p_adults: filters.adults,
    p_children: filters.children,
    p_rooms: filters.rooms,
    p_property_kinds: filters.propertyKinds.length > 0 ? filters.propertyKinds : null,
    p_amenities: filters.amenities.length > 0 ? filters.amenities : null,
    p_confirmation_mode: filters.confirmationMode,
    p_limit: page.limit,
    p_offset: page.offset,
  });
  if (error) {
    throw new StaysDiscoveryError(
      error.message || "Could not load stays. Tap to try again.",
    );
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new StaysDiscoveryError("Stays returned an invalid response.");
  }
  const envelope = data as Record<string, unknown>;
  if (typeof envelope.enabled !== "boolean" || !Array.isArray(envelope.rows)) {
    throw new StaysDiscoveryError("Stays returned an invalid response.");
  }
  const totalCount = Number(envelope.totalCount);
  if (!Number.isSafeInteger(totalCount) || totalCount < 0) {
    throw new StaysDiscoveryError("Stays returned an invalid result count.");
  }
  return {
    enabled: envelope.enabled,
    rows: envelope.rows.map(mapRow),
    totalCount,
  };
}
