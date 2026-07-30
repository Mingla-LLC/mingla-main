import { supabase } from "./supabase";
import { DATA_FETCH_TIMEOUT_MS, withTimeout } from "../utils/withTimeout";

const SOURCE_KEYS = ["ad", "search", "organic", "social", "direct"] as const;
const LISTING_TYPES = ["event", "trip", "experience", "rsvp"] as const;

export type ListingInsightsSource = (typeof SOURCE_KEYS)[number];
export type ListingInsightsType = (typeof LISTING_TYPES)[number];

export interface ListingInsightsIdentity {
  id: string;
  brandId: string;
  title: string;
  listingType: ListingInsightsType;
  status: string;
  detailRoute: string;
}

export interface ListingInsightsRollup {
  eventId: string;
  authorized: boolean;
  minglaDroveCount: number;
  valueCents: Record<string, number>;
  bySource: {
    source: ListingInsightsSource;
    customers: number;
    valueCents: Record<string, number>;
  }[];
}

export class ListingInsightsRequestError extends Error {
  constructor(readonly operation: "identity" | "rollup") {
    super(`listing insights ${operation} request failed`);
    this.name = "ListingInsightsRequestError";
  }
}

export class ListingInsightsUnavailableError extends Error {
  constructor(readonly operation: "identity" | "rollup") {
    super(`listing insights ${operation} is unavailable`);
    this.name = "ListingInsightsUnavailableError";
  }
}

type JsonObject = Record<string, unknown>;

const objectOrUnavailable = (
  value: unknown,
  operation: "identity" | "rollup",
): JsonObject => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ListingInsightsUnavailableError(operation);
  }
  return value as JsonObject;
};

const stringOrUnavailable = (
  value: unknown,
  operation: "identity" | "rollup",
): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ListingInsightsUnavailableError(operation);
  }
  return value.trim();
};

const countOrUnavailable = (value: unknown): number => {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new ListingInsightsUnavailableError("rollup");
  }
  return value;
};

const currencyMapOrUnavailable = (value: unknown): Record<string, number> => {
  const raw = objectOrUnavailable(value, "rollup");
  const normalized: Record<string, number> = {};
  for (const [currency, cents] of Object.entries(raw).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new ListingInsightsUnavailableError("rollup");
    }
    const amount = countOrUnavailable(cents);
    if (amount === 0) throw new ListingInsightsUnavailableError("rollup");
    normalized[currency] = amount;
  }
  return normalized;
};

const detailRoute = (type: ListingInsightsType, id: string): string =>
  `/${type}/${id}`;

export const normalizeListingInsightsIdentity = (
  raw: unknown,
  expectedId: string,
): ListingInsightsIdentity => {
  const row = objectOrUnavailable(raw, "identity");
  const id = stringOrUnavailable(row.id, "identity");
  const brandId = stringOrUnavailable(row.brand_id, "identity");
  const title = stringOrUnavailable(row.title, "identity");
  const type = stringOrUnavailable(row.event_type, "identity");
  const status = stringOrUnavailable(row.status, "identity");
  if (
    id !== expectedId ||
    !LISTING_TYPES.includes(type as ListingInsightsType)
  ) {
    throw new ListingInsightsUnavailableError("identity");
  }
  const listingType = type as ListingInsightsType;
  return {
    id,
    brandId,
    title,
    listingType,
    status,
    detailRoute: detailRoute(listingType, id),
  };
};

export const normalizeListingInsightsRollup = (
  raw: unknown,
  expectedId: string,
): ListingInsightsRollup => {
  const row = objectOrUnavailable(raw, "rollup");
  const eventId = stringOrUnavailable(row.event_id, "rollup");
  if (eventId !== expectedId || typeof row.authorized !== "boolean") {
    throw new ListingInsightsUnavailableError("rollup");
  }
  const authorized = row.authorized;
  if (!Array.isArray(row.by_source)) {
    throw new ListingInsightsUnavailableError("rollup");
  }
  const sourceMap = new Map<
    ListingInsightsSource,
    ListingInsightsRollup["bySource"][number]
  >();
  for (const rawSource of row.by_source) {
    const sourceRow = objectOrUnavailable(rawSource, "rollup");
    const source = stringOrUnavailable(sourceRow.source, "rollup");
    if (
      !SOURCE_KEYS.includes(source as ListingInsightsSource) ||
      sourceMap.has(source as ListingInsightsSource)
    ) {
      throw new ListingInsightsUnavailableError("rollup");
    }
    const key = source as ListingInsightsSource;
    sourceMap.set(key, {
      source: key,
      customers: countOrUnavailable(sourceRow.customers),
      valueCents: currencyMapOrUnavailable(sourceRow.value_cents),
    });
  }
  if (!authorized) {
    if (
      countOrUnavailable(row.mingla_drove_count) !== 0 ||
      Object.keys(currencyMapOrUnavailable(row.value_cents)).length !== 0 ||
      row.by_source.length !== 0
    ) {
      throw new ListingInsightsUnavailableError("rollup");
    }
    return {
      eventId,
      authorized: false,
      minglaDroveCount: 0,
      valueCents: {},
      bySource: [],
    };
  }
  if (SOURCE_KEYS.some((source) => !sourceMap.has(source))) {
    throw new ListingInsightsUnavailableError("rollup");
  }
  return {
    eventId,
    authorized: true,
    minglaDroveCount: countOrUnavailable(row.mingla_drove_count),
    valueCents: currencyMapOrUnavailable(row.value_cents),
    bySource: SOURCE_KEYS.map((source) => {
      const sourceRow = sourceMap.get(source);
      if (sourceRow === undefined) {
        throw new ListingInsightsUnavailableError("rollup");
      }
      return sourceRow;
    }),
  };
};

export const fetchListingInsightsIdentity = async (
  id: string,
): Promise<ListingInsightsIdentity> => {
  let response: { data: unknown; error: unknown };
  try {
    response = await withTimeout(
      supabase
        // orch-strict-grep-allow events-type-filter — canonical identity lookup deliberately supports approved event|trip|experience|rsvp types and strictly validates event_type after read; this is not a listing query missing type scope.
        .from("events")
        .select("id, brand_id, title, event_type, status")
        .eq("id", id)
        .maybeSingle(),
      DATA_FETCH_TIMEOUT_MS,
      "listing_insights_identity",
    );
  } catch {
    throw new ListingInsightsRequestError("identity");
  }
  if (response.error !== null) throw new ListingInsightsRequestError("identity");
  if (response.data === null) throw new ListingInsightsUnavailableError("identity");
  return normalizeListingInsightsIdentity(response.data, id);
};

export const fetchListingInsights = async (
  id: string,
): Promise<ListingInsightsRollup> => {
  let response: Awaited<ReturnType<typeof supabase.rpc>>;
  try {
    response = await withTimeout(
      supabase.rpc("entity_conversion_rollup", { p_event_id: id }),
      DATA_FETCH_TIMEOUT_MS,
      "entity_conversion_rollup",
    );
  } catch {
    throw new ListingInsightsRequestError("rollup");
  }
  if (response.error !== null) throw new ListingInsightsRequestError("rollup");
  return normalizeListingInsightsRollup(response.data, id);
};
