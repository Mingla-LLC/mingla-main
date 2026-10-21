import { DATA_FETCH_TIMEOUT_MS, withTimeout } from "../utils/withTimeout";

export const TRAFFIC_RANGES = ["7d", "30d", "90d", "all"] as const;
export const TRAFFIC_SOURCES = [
  "mingla_app",
  "mingla_ads",
  "search",
  "social",
  "own_links",
  "direct_unknown",
] as const;
export const TRAFFIC_CTA_TYPES = [
  "buy",
  "book",
  "rsvp",
  "share",
  "save",
  "directions",
  "website",
  "call",
  // Decision 5 (#4037): taps that open the brand, a venue or an offering are
  // engagement too, so they are listed and counted in Button taps.
  "view_brand",
  "view_venue",
  "view_offering",
] as const;
export const TRAFFIC_ENTITY_TYPES = [
  "event",
  "brand",
  "trip",
  "experience",
  "venue",
] as const;

export type TrafficRange = (typeof TRAFFIC_RANGES)[number];
export type TrafficSource = (typeof TRAFFIC_SOURCES)[number];
export type TrafficCtaType = (typeof TRAFFIC_CTA_TYPES)[number];
export type TrafficEntityType = (typeof TRAFFIC_ENTITY_TYPES)[number];

export interface TrafficTotals {
  pageViews: number;
  visitors: number;
  buttonTaps: number;
  checkoutStarts: number;
  bookings: number;
  customers: number;
  minglaCustomers: number;
  minglaVisitors: number;
  bookingValue: Record<string, number>;
  valueMinglaBrought: Record<string, number>;
  primaryCurrency: string | null;
}

export interface TrafficDailyPoint {
  day: string;
  pageViews: number;
}

export interface TrafficSourceRow {
  source: TrafficSource;
  visitors: number;
  bookings: number;
  valueByCurrency: Record<string, number>;
}

export interface TrafficCtaRow {
  type: TrafficCtaType;
  count: number;
}

export interface TrafficPageRow {
  entityType: TrafficEntityType;
  entityId: string | null;
  title: string;
  pageViews: number;
  visitors: number;
  ctaTotal: number;
  checkoutStarts: number;
  bookings: number;
  valueByCurrency: Record<string, number>;
}

export interface TrafficRollupBase {
  authorized: boolean;
  range: TrafficRange;
  totals: TrafficTotals;
  prior: TrafficTotals;
  daily: TrafficDailyPoint[];
  sources: TrafficSourceRow[];
  ctas: TrafficCtaRow[];
  captureStartedAt: string | null;
  windowComplete: boolean;
}

export interface BrandTrafficRollup extends TrafficRollupBase {
  brandId: string;
  pages: TrafficPageRow[];
}

export interface EntityTrafficRollup extends TrafficRollupBase {
  brandId: string;
  entityType: TrafficEntityType;
  entityId: string | null;
}

export class TrafficAnalyticsRequestError extends Error {
  constructor(
    readonly rpcName: "brand_traffic_rollup" | "entity_traffic_rollup",
  ) {
    super(`${rpcName} request failed`);
    this.name = "TrafficAnalyticsRequestError";
  }
}

export class TrafficAnalyticsContractError extends Error {
  constructor(
    readonly rpcName: "brand_traffic_rollup" | "entity_traffic_rollup",
  ) {
    super(`${rpcName} returned an invalid contract`);
    this.name = "TrafficAnalyticsContractError";
  }
}

type RpcName = TrafficAnalyticsContractError["rpcName"];
type JsonObject = Record<string, unknown>;

const contractError = (rpcName: RpcName): never => {
  throw new TrafficAnalyticsContractError(rpcName);
};

const objectOrThrow = (value: unknown, rpcName: RpcName): JsonObject => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return contractError(rpcName);
  }
  return value as JsonObject;
};

const stringOrThrow = (value: unknown, rpcName: RpcName): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    return contractError(rpcName);
  }
  return value.trim();
};

const countOrThrow = (value: unknown, rpcName: RpcName): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return contractError(rpcName);
  }
  return value;
};

const booleanOrThrow = (value: unknown, rpcName: RpcName): boolean => {
  if (typeof value !== "boolean") return contractError(rpcName);
  return value;
};

const currencyMapOrThrow = (
  value: unknown,
  rpcName: RpcName,
): Record<string, number> => {
  const raw = objectOrThrow(value, rpcName);
  const normalized: Record<string, number> = {};
  for (const [currency, cents] of Object.entries(raw).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (!/^[A-Z]{3}$/.test(currency)) return contractError(rpcName);
    const amount = countOrThrow(cents, rpcName);
    if (amount === 0) return contractError(rpcName);
    normalized[currency] = amount;
  }
  return normalized;
};

const nullableIsoOrThrow = (
  value: unknown,
  rpcName: RpcName,
): string | null => {
  if (value === null) return null;
  const iso = stringOrThrow(value, rpcName);
  if (!Number.isFinite(Date.parse(iso))) return contractError(rpcName);
  return iso;
};

const entityTypeOrThrow = (
  value: unknown,
  rpcName: RpcName,
): TrafficEntityType => {
  const entityType = stringOrThrow(value, rpcName);
  if (!TRAFFIC_ENTITY_TYPES.includes(entityType as TrafficEntityType)) {
    return contractError(rpcName);
  }
  return entityType as TrafficEntityType;
};

const totalsOrThrow = (value: unknown, rpcName: RpcName): TrafficTotals => {
  const row = objectOrThrow(value, rpcName);
  const primaryCurrency =
    row.primary_currency === null
      ? null
      : stringOrThrow(row.primary_currency, rpcName);
  if (primaryCurrency !== null && !/^[A-Z]{3}$/.test(primaryCurrency)) {
    return contractError(rpcName);
  }
  return {
    pageViews: countOrThrow(row.page_views, rpcName),
    visitors: countOrThrow(row.visitors, rpcName),
    buttonTaps: countOrThrow(row.button_taps, rpcName),
    checkoutStarts: countOrThrow(row.checkout_starts, rpcName),
    bookings: countOrThrow(row.bookings, rpcName),
    customers: countOrThrow(row.customers, rpcName),
    minglaCustomers: countOrThrow(row.mingla_customers, rpcName),
    minglaVisitors: countOrThrow(row.mingla_visitors, rpcName),
    bookingValue: currencyMapOrThrow(row.booking_value, rpcName),
    valueMinglaBrought: currencyMapOrThrow(row.value_mingla_brought, rpcName),
    primaryCurrency,
  };
};

const totalsAreEmpty = (totals: TrafficTotals): boolean =>
  totals.pageViews === 0 &&
  totals.visitors === 0 &&
  totals.buttonTaps === 0 &&
  totals.checkoutStarts === 0 &&
  totals.bookings === 0 &&
  totals.customers === 0 &&
  totals.minglaCustomers === 0 &&
  totals.minglaVisitors === 0 &&
  Object.keys(totals.bookingValue).length === 0 &&
  Object.keys(totals.valueMinglaBrought).length === 0 &&
  totals.primaryCurrency === null;

const sumCurrencyMaps = (
  rows: readonly TrafficSourceRow[],
  include: (row: TrafficSourceRow) => boolean = () => true,
): Record<string, number> => {
  const result: Record<string, number> = {};
  for (const row of rows) {
    if (!include(row)) continue;
    for (const [currency, cents] of Object.entries(row.valueByCurrency)) {
      result[currency] = (result[currency] ?? 0) + cents;
    }
  }
  return result;
};

const currencyMapsEqual = (
  left: Record<string, number>,
  right: Record<string, number>,
): boolean => {
  const currencies = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...currencies].every(
    (currency) => (left[currency] ?? 0) === (right[currency] ?? 0),
  );
};

const normalizeBase = (
  row: JsonObject,
  expectedRange: TrafficRange,
  rpcName: RpcName,
): TrafficRollupBase => {
  const authorized = booleanOrThrow(row.authorized, rpcName);
  const range = stringOrThrow(row.range, rpcName);
  if (range !== expectedRange) return contractError(rpcName);
  const totals = totalsOrThrow(row.totals, rpcName);
  const prior = totalsOrThrow(row.prior, rpcName);
  if (
    !Array.isArray(row.daily) ||
    !Array.isArray(row.sources) ||
    !Array.isArray(row.ctas)
  ) {
    return contractError(rpcName);
  }
  const daily = row.daily.map((value) => {
    const point = objectOrThrow(value, rpcName);
    const day = stringOrThrow(point.day, rpcName);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return contractError(rpcName);
    return { day, pageViews: countOrThrow(point.page_views, rpcName) };
  });
  if (
    daily.some(
      (point, index) => index > 0 && point.day <= daily[index - 1]!.day,
    )
  ) {
    return contractError(rpcName);
  }
  if (
    authorized &&
    ((totals.pageViews > 0 && daily.length === 0) ||
      daily.reduce((sum, point) => sum + point.pageViews, 0) !==
        totals.pageViews)
  ) {
    return contractError(rpcName);
  }
  const sourceMap = new Map<TrafficSource, TrafficSourceRow>();
  for (const value of row.sources) {
    const sourceRow = objectOrThrow(value, rpcName);
    const source = stringOrThrow(sourceRow.source, rpcName);
    if (
      !TRAFFIC_SOURCES.includes(source as TrafficSource) ||
      sourceMap.has(source as TrafficSource)
    ) {
      return contractError(rpcName);
    }
    sourceMap.set(source as TrafficSource, {
      source: source as TrafficSource,
      visitors: countOrThrow(sourceRow.visitors, rpcName),
      bookings: countOrThrow(sourceRow.bookings, rpcName),
      valueByCurrency: currencyMapOrThrow(sourceRow.value_by_currency, rpcName),
    });
  }
  const ctaMap = new Map<TrafficCtaType, TrafficCtaRow>();
  for (const value of row.ctas) {
    const ctaRow = objectOrThrow(value, rpcName);
    const type = stringOrThrow(ctaRow.type, rpcName);
    if (
      !TRAFFIC_CTA_TYPES.includes(type as TrafficCtaType) ||
      ctaMap.has(type as TrafficCtaType)
    ) {
      return contractError(rpcName);
    }
    ctaMap.set(type as TrafficCtaType, {
      type: type as TrafficCtaType,
      count: countOrThrow(ctaRow.count, rpcName),
    });
  }
  const captureStartedAt = nullableIsoOrThrow(row.capture_started_at, rpcName);
  const windowComplete = booleanOrThrow(row.window_complete, rpcName);
  if (!authorized) {
    if (
      !totalsAreEmpty(totals) ||
      !totalsAreEmpty(prior) ||
      daily.length !== 0 ||
      sourceMap.size !== 0 ||
      ctaMap.size !== 0 ||
      captureStartedAt !== null ||
      windowComplete
    ) {
      return contractError(rpcName);
    }
  } else if (
    TRAFFIC_SOURCES.some((source) => !sourceMap.has(source)) ||
    TRAFFIC_CTA_TYPES.some((type) => !ctaMap.has(type))
  ) {
    return contractError(rpcName);
  }
  const sources = authorized
    ? TRAFFIC_SOURCES.map((source) => sourceMap.get(source)!)
    : [];
  const ctas = authorized
    ? TRAFFIC_CTA_TYPES.map((type) => ctaMap.get(type)!)
    : [];
  if (
    authorized &&
    (sources.reduce((sum, source) => sum + source.bookings, 0) !==
      totals.bookings ||
      ctas.reduce((sum, cta) => sum + cta.count, 0) !== totals.buttonTaps ||
      !currencyMapsEqual(sumCurrencyMaps(sources), totals.bookingValue) ||
      !currencyMapsEqual(
        sumCurrencyMaps(sources, (row) =>
          (["mingla_app", "mingla_ads", "search"] as TrafficSource[]).includes(
            row.source,
          ),
        ),
        totals.valueMinglaBrought,
      ))
  ) {
    return contractError(rpcName);
  }
  return {
    authorized,
    range: expectedRange,
    totals,
    prior,
    daily,
    sources,
    ctas,
    captureStartedAt,
    windowComplete,
  };
};

export function normalizeBrandTrafficRollup(
  raw: unknown,
  expectedBrandId: string,
  expectedRange: TrafficRange,
): BrandTrafficRollup {
  const rpcName = "brand_traffic_rollup" as const;
  const row = objectOrThrow(raw, rpcName);
  if (stringOrThrow(row.brand_id, rpcName) !== expectedBrandId) {
    return contractError(rpcName);
  }
  const base = normalizeBase(row, expectedRange, rpcName);
  if (!Array.isArray(row.pages)) return contractError(rpcName);
  const seen = new Set<string>();
  let previousPageViews = Number.POSITIVE_INFINITY;
  const pages = row.pages.map((value, index) => {
    const page = objectOrThrow(value, rpcName);
    const entityType = entityTypeOrThrow(page.entity_type, rpcName);
    const entityId =
      page.entity_id === null ? null : stringOrThrow(page.entity_id, rpcName);
    if ((entityType === "brand") !== (entityId === null)) {
      return contractError(rpcName);
    }
    const key = `${entityType}:${entityId ?? expectedBrandId}`;
    if (seen.has(key)) return contractError(rpcName);
    seen.add(key);
    const normalized: TrafficPageRow = {
      entityType,
      entityId,
      title: stringOrThrow(page.title, rpcName),
      pageViews: countOrThrow(page.page_views, rpcName),
      visitors: countOrThrow(page.visitors, rpcName),
      ctaTotal: countOrThrow(page.cta_total, rpcName),
      checkoutStarts: countOrThrow(page.checkout_starts, rpcName),
      bookings: countOrThrow(page.bookings, rpcName),
      valueByCurrency: currencyMapOrThrow(page.value_by_currency, rpcName),
    };
    if (index > 0 && normalized.pageViews > previousPageViews) {
      return contractError(rpcName);
    }
    previousPageViews = normalized.pageViews;
    return normalized;
  });
  if (!base.authorized && pages.length !== 0) return contractError(rpcName);
  return { ...base, brandId: expectedBrandId, pages };
}

export function normalizeEntityTrafficRollup(
  raw: unknown,
  expectedBrandId: string,
  expectedEntityType: TrafficEntityType,
  expectedEntityId: string | null,
  expectedRange: TrafficRange,
): EntityTrafficRollup {
  const rpcName = "entity_traffic_rollup" as const;
  const row = objectOrThrow(raw, rpcName);
  const entityType = entityTypeOrThrow(row.entity_type, rpcName);
  const entityId =
    row.entity_id === null ? null : stringOrThrow(row.entity_id, rpcName);
  if (entityType !== expectedEntityType || entityId !== expectedEntityId) {
    return contractError(rpcName);
  }
  if ((entityType === "brand") !== (entityId === null)) {
    return contractError(rpcName);
  }
  // Decision 4: every page request names its brand, and the answer must be
  // about that brand.
  if (stringOrThrow(row.brand_id, rpcName) !== expectedBrandId) {
    return contractError(rpcName);
  }
  return {
    ...normalizeBase(row, expectedRange, rpcName),
    brandId: expectedBrandId,
    entityType,
    entityId,
  };
}

export const fetchBrandTrafficRollup = async (
  brandId: string,
  range: TrafficRange,
): Promise<BrandTrafficRollup> => {
  const rpcName = "brand_traffic_rollup" as const;
  let response: { data: unknown; error: unknown };
  try {
    const { supabase } = await import("./supabase");
    response = await withTimeout(
      supabase.rpc(rpcName, { p_brand_id: brandId, p_range: range }),
      DATA_FETCH_TIMEOUT_MS,
      rpcName,
    );
  } catch {
    throw new TrafficAnalyticsRequestError(rpcName);
  }
  if (response.error !== null) throw new TrafficAnalyticsRequestError(rpcName);
  return normalizeBrandTrafficRollup(response.data, brandId, range);
};

export const fetchEntityTrafficRollup = async (
  brandId: string,
  entityType: TrafficEntityType,
  entityId: string | null,
  range: TrafficRange,
): Promise<EntityTrafficRollup> => {
  const rpcName = "entity_traffic_rollup" as const;
  let response: { data: unknown; error: unknown };
  try {
    const { supabase } = await import("./supabase");
    response = await withTimeout(
      supabase.rpc(rpcName, {
        p_brand_id: brandId,
        p_entity_type: entityType,
        p_entity_id: entityId,
        p_range: range,
      }),
      DATA_FETCH_TIMEOUT_MS,
      rpcName,
    );
  } catch {
    throw new TrafficAnalyticsRequestError(rpcName);
  }
  if (response.error !== null) throw new TrafficAnalyticsRequestError(rpcName);
  return normalizeEntityTrafficRollup(
    response.data,
    brandId,
    entityType,
    entityId,
    range,
  );
};
