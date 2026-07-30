import { supabase } from "./supabase";
import { DATA_FETCH_TIMEOUT_MS, withTimeout } from "../utils/withTimeout";

const SOURCE_KEYS = ["mingla", "website", "instagram", "phone", "walk_in"] as const;
const TZ_CONFIDENCE = ["iana", "offset", "utc"] as const;

export type ReservationSource = (typeof SOURCE_KEYS)[number];
export type ReservationTimezoneConfidence = (typeof TZ_CONFIDENCE)[number];

export interface VenueReservationMetrics {
  brandId: string;
  venueId: string;
  authorized: boolean;
  resolvedTimezone: string | null;
  timezoneConfidence: ReservationTimezoneConfidence | null;
  covers30d: number;
  coversLifetime: number;
  averagePartySize: number;
  noShowRate: number;
  bySource: {
    source: ReservationSource;
    reservations: number;
    covers: number;
  }[];
  valueCents30d: Record<string, number>;
  valueCentsLifetime: Record<string, number>;
}

export class ReservationMetricsRequestError extends Error {
  constructor() {
    super("reservation metrics request failed");
    this.name = "ReservationMetricsRequestError";
  }
}

export class ReservationMetricsUnavailableError extends Error {
  constructor() {
    super("reservation metrics are unavailable");
    this.name = "ReservationMetricsUnavailableError";
  }
}

type JsonObject = Record<string, unknown>;

const objectOrThrow = (value: unknown): JsonObject => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ReservationMetricsUnavailableError();
  }
  return value as JsonObject;
};

const stringOrThrow = (value: unknown): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ReservationMetricsUnavailableError();
  }
  return value.trim();
};

const numberOrThrow = (value: unknown, integer: boolean): number => {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    (integer && !Number.isSafeInteger(value))
  ) {
    throw new ReservationMetricsUnavailableError();
  }
  return value;
};

const currencyMapOrThrow = (value: unknown): Record<string, number> => {
  const raw = objectOrThrow(value);
  const normalized: Record<string, number> = {};
  for (const [currency, amount] of Object.entries(raw).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new ReservationMetricsUnavailableError();
    }
    const cents = numberOrThrow(amount, true);
    if (cents === 0) throw new ReservationMetricsUnavailableError();
    normalized[currency] = cents;
  }
  return normalized;
};

const isIanaTimezone = (value: string): boolean => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
};

const isCanonicalOffset = (value: string): boolean => {
  const match = /^UTC([+-])(\d{2}):(\d{2})$/.exec(value);
  if (match === null) return false;
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  return hours < 14 ? minutes < 60 : hours === 14 && minutes === 0;
};

const isValidTimezonePair = (
  timezone: string,
  confidence: ReservationTimezoneConfidence,
): boolean => {
  if (confidence === "iana") return isIanaTimezone(timezone);
  if (confidence === "offset") return isCanonicalOffset(timezone);
  return timezone === "UTC";
};

export const normalizeVenueReservationMetrics = (
  raw: unknown,
  expectedBrandId: string,
  expectedVenueId: string,
): VenueReservationMetrics => {
  const row = objectOrThrow(raw);
  const brandId = stringOrThrow(row.brand_id);
  const venueId = stringOrThrow(row.venue_id);
  if (
    brandId !== expectedBrandId ||
    venueId !== expectedVenueId ||
    typeof row.authorized !== "boolean"
  ) {
    throw new ReservationMetricsUnavailableError();
  }
  if (!Array.isArray(row.by_source)) {
    throw new ReservationMetricsUnavailableError();
  }
  const bySource: VenueReservationMetrics["bySource"] = [];
  const seen = new Set<ReservationSource>();
  for (const rawSource of row.by_source) {
    const sourceRow = objectOrThrow(rawSource);
    const sourceValue = stringOrThrow(sourceRow.source);
    if (!SOURCE_KEYS.includes(sourceValue as ReservationSource)) continue;
    const source = sourceValue as ReservationSource;
    if (seen.has(source)) throw new ReservationMetricsUnavailableError();
    seen.add(source);
    bySource.push({
      source,
      reservations: numberOrThrow(sourceRow.reservations, true),
      covers: numberOrThrow(sourceRow.covers, true),
    });
  }
  const authorized = row.authorized;
  const resolvedTimezone =
    row.resolved_timezone === null ? null : stringOrThrow(row.resolved_timezone);
  const confidence =
    row.tz_confidence === null ? null : stringOrThrow(row.tz_confidence);
  if (
    confidence !== null &&
    !TZ_CONFIDENCE.includes(confidence as ReservationTimezoneConfidence)
  ) {
    throw new ReservationMetricsUnavailableError();
  }
  const result: VenueReservationMetrics = {
    brandId,
    venueId,
    authorized,
    resolvedTimezone,
    timezoneConfidence:
      confidence as ReservationTimezoneConfidence | null,
    covers30d: numberOrThrow(row.covers_30d, true),
    coversLifetime: numberOrThrow(row.covers_lifetime, true),
    averagePartySize: numberOrThrow(row.avg_party_size, false),
    noShowRate: numberOrThrow(row.no_show_rate, false),
    bySource,
    valueCents30d: currencyMapOrThrow(row.value_cents_30d),
    valueCentsLifetime: currencyMapOrThrow(row.value_cents_lifetime),
  };
  if (result.noShowRate > 1) throw new ReservationMetricsUnavailableError();
  if (
    !authorized &&
    (resolvedTimezone !== null ||
      confidence !== null ||
      result.covers30d !== 0 ||
      result.coversLifetime !== 0 ||
      result.averagePartySize !== 0 ||
      result.noShowRate !== 0 ||
      row.by_source.length !== 0 ||
      Object.keys(result.valueCents30d).length !== 0 ||
      Object.keys(result.valueCentsLifetime).length !== 0)
  ) {
    throw new ReservationMetricsUnavailableError();
  }
  if (authorized && (resolvedTimezone === null || confidence === null)) {
    throw new ReservationMetricsUnavailableError();
  }
  if (
    authorized &&
    !isValidTimezonePair(
      resolvedTimezone as string,
      confidence as ReservationTimezoneConfidence,
    )
  ) {
    throw new ReservationMetricsUnavailableError();
  }
  return result;
};

export const fetchVenueReservationMetrics = async (
  brandId: string,
  venueId: string,
): Promise<VenueReservationMetrics> => {
  let response: Awaited<ReturnType<typeof supabase.rpc>>;
  try {
    response = await withTimeout(
      supabase.rpc("reservation_metrics_rollup", {
        p_brand_id: brandId,
        p_venue_id: venueId,
      }),
      DATA_FETCH_TIMEOUT_MS,
      "reservation_metrics_rollup",
    );
  } catch {
    throw new ReservationMetricsRequestError();
  }
  if (response.error !== null) throw new ReservationMetricsRequestError();
  return normalizeVenueReservationMetrics(response.data, brandId, venueId);
};
