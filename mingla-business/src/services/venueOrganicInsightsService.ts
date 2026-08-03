import { supabase } from "./supabase";
import { DATA_FETCH_TIMEOUT_MS, withTimeout } from "../utils/withTimeout";

export type OrganicTimezoneConfidence = "iana" | "offset" | "utc";

export interface VenueOrganicInsights {
  brandId: string;
  venueId: string;
  authorized: boolean;
  pageViews: number;
  menuOpens: number;
  reservationStarts: number;
  availabilityShown: number;
  reservationsMade: number;
  dayparts: {
    morning: number;
    afternoon: number;
    evening: number;
    lateNight: number;
  };
  menuPublished: boolean;
  reservationsEnabled: boolean;
  captureStartedAt: string;
  windowComplete: boolean;
  aggregatedAt: string;
  resolvedTimezone: string;
  timezoneConfidence: OrganicTimezoneConfidence;
}

export class VenueOrganicInsightsRequestError extends Error {
  constructor() {
    super("venue organic insights request failed");
    this.name = "VenueOrganicInsightsRequestError";
  }
}

export class VenueOrganicInsightsUnavailableError extends Error {
  constructor() {
    super("venue organic insights are unavailable");
    this.name = "VenueOrganicInsightsUnavailableError";
  }
}

type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new VenueOrganicInsightsUnavailableError();
  }
  return value as JsonObject;
};
const text = (value: unknown): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new VenueOrganicInsightsUnavailableError();
  }
  return value;
};
const count = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new VenueOrganicInsightsUnavailableError();
  }
  return value;
};
const bool = (value: unknown): boolean => {
  if (typeof value !== "boolean") {
    throw new VenueOrganicInsightsUnavailableError();
  }
  return value;
};

export function normalizeVenueOrganicInsights(
  raw: unknown,
  expectedBrandId: string,
  expectedVenueId: string,
): VenueOrganicInsights {
  const row = object(raw);
  const authorized = bool(row.authorized);
  if (!authorized) {
    return {
      brandId: expectedBrandId,
      venueId: expectedVenueId,
      authorized: false,
      pageViews: 0,
      menuOpens: 0,
      reservationStarts: 0,
      availabilityShown: 0,
      reservationsMade: 0,
      dayparts: { morning: 0, afternoon: 0, evening: 0, lateNight: 0 },
      menuPublished: false,
      reservationsEnabled: false,
      captureStartedAt: "",
      windowComplete: false,
      aggregatedAt: "",
      resolvedTimezone: "",
      timezoneConfidence: "utc",
    };
  }
  if (
    text(row.brand_id) !== expectedBrandId ||
    text(row.venue_id) !== expectedVenueId
  ) {
    throw new VenueOrganicInsightsUnavailableError();
  }
  const dayparts = object(row.dayparts);
  const confidence = text(row.tz_confidence);
  if (!["iana", "offset", "utc"].includes(confidence)) {
    throw new VenueOrganicInsightsUnavailableError();
  }
  const captureStartedAt = text(row.capture_started_at);
  const aggregatedAt = text(row.aggregated_at);
  if (
    Number.isNaN(Date.parse(captureStartedAt)) ||
    Number.isNaN(Date.parse(aggregatedAt))
  ) {
    throw new VenueOrganicInsightsUnavailableError();
  }
  return {
    brandId: expectedBrandId,
    venueId: expectedVenueId,
    authorized: true,
    pageViews: count(row.page_views),
    menuOpens: count(row.menu_opens),
    reservationStarts: count(row.reservation_starts),
    availabilityShown: count(row.availability_shown),
    reservationsMade: count(row.reservations_made),
    dayparts: {
      morning: count(dayparts.morning),
      afternoon: count(dayparts.afternoon),
      evening: count(dayparts.evening),
      lateNight: count(dayparts.late_night),
    },
    menuPublished: bool(row.menu_published),
    reservationsEnabled: bool(row.reservations_enabled),
    captureStartedAt,
    windowComplete: bool(row.window_complete),
    aggregatedAt,
    resolvedTimezone: text(row.resolved_timezone),
    timezoneConfidence: confidence as OrganicTimezoneConfidence,
  };
}

export async function fetchVenueOrganicInsights(
  brandId: string,
  venueId: string,
): Promise<VenueOrganicInsights> {
  let response: Awaited<ReturnType<typeof supabase.rpc>>;
  try {
    response = await withTimeout(
      supabase.rpc("venue_organic_engagement_rollup", {
        p_brand_id: brandId,
        p_venue_id: venueId,
      }),
      DATA_FETCH_TIMEOUT_MS,
      "venue_organic_engagement_rollup",
    );
  } catch {
    throw new VenueOrganicInsightsRequestError();
  }
  if (response.error !== null) throw new VenueOrganicInsightsRequestError();
  return normalizeVenueOrganicInsights(response.data, brandId, venueId);
}
