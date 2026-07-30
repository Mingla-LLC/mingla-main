import { supabase } from "./supabase";
import {
  DATA_FETCH_TIMEOUT_MS,
  withTimeout,
} from "../utils/withTimeout";

const SOURCE_KEYS = ["ad", "search", "organic", "social", "direct"] as const;
const DAY_LABELS = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
} as const;
const DAYPART_LABELS = {
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
  late_night: "Late night",
} as const;
const TYPE_LABELS = {
  event: "Event",
  trip: "Trip",
  experience: "Experience",
  rsvp: "RSVP",
  venue_reservation: "Venue reservation",
} as const;

export type BrandAnalyticsSource = (typeof SOURCE_KEYS)[number];
export type PatternState =
  | "no_data"
  | "more_data_needed"
  | "no_clear_pattern"
  | "winner"
  | "unauthorized";

export interface BrandMinglaDroveRollup {
  brandId: string;
  authorized: boolean;
  minglaDrove30d: number;
  minglaDroveLifetime: number;
  valueCents30d: Record<string, number>;
  valueCentsLifetime: Record<string, number>;
  bySource: {
    source: BrandAnalyticsSource;
    customers: number;
    valueCents: Record<string, number>;
  }[];
}

export interface BrandRegularsRollup {
  brandId: string;
  authorized: boolean;
  regularsCount: number;
  topRegulars: {
    maskedContact: string;
    bookingsAndRsvps: number;
    listings: number;
  }[];
}

export interface CustomerPatternBucket {
  key: string;
  label: string;
  bookingsAndRsvps: number;
}

export interface CustomerPatternView {
  state: PatternState;
  sampleCommitments: number;
  distinctDates: number;
  positiveBuckets: number;
  winner: CustomerPatternBucket | null;
  buckets: CustomerPatternBucket[];
}

export interface BrandCustomerPatternsRollup {
  brandId: string;
  authorized: boolean;
  generatedAt: string | null;
  windowDays: 180;
  metric: "qualified_customer_commitments";
  days: CustomerPatternView;
  dayparts: CustomerPatternView;
  types: CustomerPatternView;
}

export class BrandAnalyticsRequestError extends Error {
  readonly rpcName: string;
  constructor(rpcName: string) {
    super(`${rpcName} request failed`);
    this.name = "BrandAnalyticsRequestError";
    this.rpcName = rpcName;
  }
}

export class BrandAnalyticsContractError extends Error {
  readonly rpcName: string;
  constructor(rpcName: string) {
    super(`${rpcName} returned an invalid contract`);
    this.name = "BrandAnalyticsContractError";
    this.rpcName = rpcName;
  }
}

type JsonObject = Record<string, unknown>;

const objectOrThrow = (value: unknown, rpcName: string): JsonObject => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BrandAnalyticsContractError(rpcName);
  }
  return value as JsonObject;
};

const booleanOrThrow = (value: unknown, rpcName: string): boolean => {
  if (typeof value !== "boolean") throw new BrandAnalyticsContractError(rpcName);
  return value;
};

const countOrThrow = (value: unknown, rpcName: string): number => {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 0
  ) {
    throw new BrandAnalyticsContractError(rpcName);
  }
  return value;
};

const stringOrThrow = (value: unknown, rpcName: string): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new BrandAnalyticsContractError(rpcName);
  }
  return value;
};

const brandIdOrThrow = (
  value: unknown,
  expectedBrandId: string,
  rpcName: string,
): string => {
  const brandId = stringOrThrow(value, rpcName);
  if (brandId !== expectedBrandId) throw new BrandAnalyticsContractError(rpcName);
  return brandId;
};

const currencyMapOrThrow = (
  value: unknown,
  rpcName: string,
): Record<string, number> => {
  const object = objectOrThrow(value, rpcName);
  const entries = Object.entries(object);
  const normalized: Record<string, number> = {};
  for (const [currency, cents] of entries.sort(([a], [b]) => a.localeCompare(b))) {
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new BrandAnalyticsContractError(rpcName);
    }
    const amount = countOrThrow(cents, rpcName);
    if (amount === 0) throw new BrandAnalyticsContractError(rpcName);
    normalized[currency] = amount;
  }
  return normalized;
};

export function normalizeBrandMinglaDroveRollup(
  raw: unknown,
  expectedBrandId: string,
): BrandMinglaDroveRollup {
  const rpcName = "brand_mingla_drove_rollup";
  const row = objectOrThrow(raw, rpcName);
  const brandId = brandIdOrThrow(row.brand_id, expectedBrandId, rpcName);
  const authorized = booleanOrThrow(row.authorized, rpcName);
  const minglaDrove30d = countOrThrow(row.mingla_drove_30d, rpcName);
  const minglaDroveLifetime = countOrThrow(row.mingla_drove_lifetime, rpcName);
  const valueCents30d = currencyMapOrThrow(row.value_cents_30d, rpcName);
  const valueCentsLifetime = currencyMapOrThrow(
    row.value_cents_lifetime,
    rpcName,
  );
  if (!Array.isArray(row.by_source)) {
    throw new BrandAnalyticsContractError(rpcName);
  }
  if (!authorized && row.by_source.length !== 0) {
    throw new BrandAnalyticsContractError(rpcName);
  }
  const sourceMap = new Map<
    BrandAnalyticsSource,
    BrandMinglaDroveRollup["bySource"][number]
  >();
  for (const rawSource of row.by_source) {
    const sourceRow = objectOrThrow(rawSource, rpcName);
    const source = stringOrThrow(sourceRow.source, rpcName);
    if (!SOURCE_KEYS.includes(source as BrandAnalyticsSource)) {
      throw new BrandAnalyticsContractError(rpcName);
    }
    const typedSource = source as BrandAnalyticsSource;
    if (sourceMap.has(typedSource)) throw new BrandAnalyticsContractError(rpcName);
    sourceMap.set(typedSource, {
      source: typedSource,
      customers: countOrThrow(sourceRow.customers, rpcName),
      valueCents: currencyMapOrThrow(sourceRow.value_cents, rpcName),
    });
  }
  if (authorized && SOURCE_KEYS.some((source) => !sourceMap.has(source))) {
    throw new BrandAnalyticsContractError(rpcName);
  }
  return {
    brandId,
    authorized,
    minglaDrove30d,
    minglaDroveLifetime,
    valueCents30d,
    valueCentsLifetime,
    bySource: authorized
      ? SOURCE_KEYS.map((source) => {
          const sourceRow = sourceMap.get(source);
          if (sourceRow === undefined) throw new BrandAnalyticsContractError(rpcName);
          return sourceRow;
        })
      : [],
  };
}

export function normalizeBrandRegularsRollup(
  raw: unknown,
  expectedBrandId: string,
): BrandRegularsRollup {
  const rpcName = "brand_regulars_rollup";
  const row = objectOrThrow(raw, rpcName);
  const brandId = brandIdOrThrow(row.brand_id, expectedBrandId, rpcName);
  const authorized = booleanOrThrow(row.authorized, rpcName);
  const regularsCount = countOrThrow(row.regulars_count, rpcName);
  if (!Array.isArray(row.top_regulars)) {
    throw new BrandAnalyticsContractError(rpcName);
  }
  if (!authorized && row.top_regulars.length !== 0) {
    throw new BrandAnalyticsContractError(rpcName);
  }
  const topRegulars = row.top_regulars.map((rawRegular) => {
    const regular = objectOrThrow(rawRegular, rpcName);
    return {
      maskedContact: stringOrThrow(regular.masked_contact, rpcName),
      bookingsAndRsvps: countOrThrow(regular.visits, rpcName),
      listings: countOrThrow(regular.listings, rpcName),
    };
  });
  return { brandId, authorized, regularsCount, topRegulars };
}

const normalizePatternView = (
  value: unknown,
  rpcName: string,
  labels: Record<string, string>,
): CustomerPatternView => {
  const view = objectOrThrow(value, rpcName);
  const state = stringOrThrow(view.state, rpcName);
  if (
    ![
      "no_data",
      "more_data_needed",
      "no_clear_pattern",
      "winner",
      "unauthorized",
    ].includes(state)
  ) {
    throw new BrandAnalyticsContractError(rpcName);
  }
  if (!Array.isArray(view.buckets)) {
    throw new BrandAnalyticsContractError(rpcName);
  }
  const seen = new Set<string>();
  const buckets = view.buckets.map((rawBucket) => {
    const bucket = objectOrThrow(rawBucket, rpcName);
    const key = stringOrThrow(bucket.key, rpcName);
    const label = stringOrThrow(bucket.label, rpcName);
    if (labels[key] !== label || seen.has(key)) {
      throw new BrandAnalyticsContractError(rpcName);
    }
    seen.add(key);
    return {
      key,
      label,
      bookingsAndRsvps: countOrThrow(bucket.commitments, rpcName),
    };
  });
  const rawWinner = view.winner;
  let winner: CustomerPatternBucket | null = null;
  if (state === "winner") {
    const candidate = objectOrThrow(rawWinner, rpcName);
    const key = stringOrThrow(candidate.key, rpcName);
    const label = stringOrThrow(candidate.label, rpcName);
    const bookingsAndRsvps = countOrThrow(candidate.commitments, rpcName);
    const matching = buckets.find(
      (bucket) =>
        bucket.key === key &&
        bucket.label === label &&
        bucket.bookingsAndRsvps === bookingsAndRsvps,
    );
    if (matching === undefined) throw new BrandAnalyticsContractError(rpcName);
    winner = matching;
  } else if (rawWinner !== null) {
    throw new BrandAnalyticsContractError(rpcName);
  }
  return {
    state: state as PatternState,
    sampleCommitments: countOrThrow(view.sample_commitments, rpcName),
    distinctDates: countOrThrow(view.distinct_dates, rpcName),
    positiveBuckets: countOrThrow(view.positive_buckets, rpcName),
    winner,
    buckets,
  };
};

export function normalizeBrandCustomerPatternsRollup(
  raw: unknown,
  expectedBrandId: string,
): BrandCustomerPatternsRollup {
  const rpcName = "brand_customer_commitment_patterns_rollup";
  const row = objectOrThrow(raw, rpcName);
  const brandId = brandIdOrThrow(row.brand_id, expectedBrandId, rpcName);
  const authorized = booleanOrThrow(row.authorized, rpcName);
  if (row.window_days !== 180 || row.metric !== "qualified_customer_commitments") {
    throw new BrandAnalyticsContractError(rpcName);
  }
  const generatedAt =
    row.generated_at === null ? null : stringOrThrow(row.generated_at, rpcName);
  const result: BrandCustomerPatternsRollup = {
    brandId,
    authorized,
    generatedAt,
    windowDays: 180,
    metric: "qualified_customer_commitments",
    days: normalizePatternView(row.days, rpcName, DAY_LABELS),
    dayparts: normalizePatternView(row.dayparts, rpcName, DAYPART_LABELS),
    types: normalizePatternView(row.types, rpcName, TYPE_LABELS),
  };
  const views = [result.days, result.dayparts, result.types];
  if (
    (!authorized && views.some((view) => view.state !== "unauthorized")) ||
    (authorized && views.some((view) => view.state === "unauthorized"))
  ) {
    throw new BrandAnalyticsContractError(rpcName);
  }
  return result;
}

const fetchRpc = async <T>(
  rpcName:
    | "brand_mingla_drove_rollup"
    | "brand_regulars_rollup"
    | "brand_customer_commitment_patterns_rollup",
  brandId: string,
  normalize: (raw: unknown, expectedBrandId: string) => T,
): Promise<T> => {
  let response: Awaited<ReturnType<typeof supabase.rpc>>;
  try {
    response = await withTimeout(
      supabase.rpc(rpcName, { p_brand_id: brandId }),
      DATA_FETCH_TIMEOUT_MS,
      rpcName,
    );
  } catch {
    throw new BrandAnalyticsRequestError(rpcName);
  }
  if (response.error !== null) throw new BrandAnalyticsRequestError(rpcName);
  return normalize(response.data, brandId);
};

export const fetchBrandMinglaDroveRollup = (
  brandId: string,
): Promise<BrandMinglaDroveRollup> =>
  fetchRpc("brand_mingla_drove_rollup", brandId, normalizeBrandMinglaDroveRollup);

export const fetchBrandRegularsRollup = (
  brandId: string,
): Promise<BrandRegularsRollup> =>
  fetchRpc("brand_regulars_rollup", brandId, normalizeBrandRegularsRollup);

export const fetchBrandCustomerPatternsRollup = (
  brandId: string,
): Promise<BrandCustomerPatternsRollup> =>
  fetchRpc(
    "brand_customer_commitment_patterns_rollup",
    brandId,
    normalizeBrandCustomerPatternsRollup,
  );
