export const DISCOVERY_PRICE_STATUSES = [
  "active",
  "legacy_unresolved",
  "reconciliation_required",
] as const;

export type DiscoveryPriceStatus = typeof DISCOVERY_PRICE_STATUSES[number];
export type FxFreshness =
  | "fresh"
  | "stale_soft"
  | "expired"
  | "not_needed"
  | "unavailable";

export interface DiscoveryPriceView {
  priceRangeStatus: DiscoveryPriceStatus | "unset";
  sourceMinMinor: number | null;
  sourceMaxMinor: number | null;
  sourceCurrencyCode: string | null;
  displayMinMinor: number | null;
  displayMaxMinor: number | null;
  displayCurrencyCode: string | null;
  priceIsApproximate: boolean;
  fxSnapshotId: string | null;
  fxProvider: string | null;
  fxProviderUpdatedAt: string | null;
  fxFreshness: FxFreshness;
}

type DatabasePriceView = {
  price_range_status?: unknown;
  source_min_minor?: unknown;
  source_max_minor?: unknown;
  source_currency_code?: unknown;
  display_min_minor?: unknown;
  display_max_minor?: unknown;
  display_currency_code?: unknown;
  price_is_approximate?: unknown;
  fx_snapshot_id?: unknown;
  fx_provider?: unknown;
  fx_provider_updated_at?: unknown;
  fx_freshness?: unknown;
};

const ISO_CURRENCY = /^[A-Z]{3}$/;

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function nullableSafeInteger(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 0) return null;
  return numeric;
}

export function normalizeIsoCurrency(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return ISO_CURRENCY.test(normalized) ? normalized : null;
}

export function mapDiscoveryPriceView(
  row: DatabasePriceView | null | undefined,
): DiscoveryPriceView | null {
  if (!row) return null;
  const status = nullableString(row.price_range_status);
  if (
    status !== "active" &&
    status !== "legacy_unresolved" &&
    status !== "reconciliation_required" &&
    status !== "unset"
  ) {
    return null;
  }

  const sourceCurrencyCode = normalizeIsoCurrency(row.source_currency_code);
  const sourceMinMinor = nullableSafeInteger(row.source_min_minor);
  const sourceMaxMinor = nullableSafeInteger(row.source_max_minor);
  const active = status === "active";
  if (active && (sourceCurrencyCode === null || sourceMinMinor === null)) {
    return null;
  }

  const freshness = nullableString(row.fx_freshness);
  const fxFreshness: FxFreshness =
    freshness === "fresh" ||
    freshness === "stale_soft" ||
    freshness === "expired" ||
    freshness === "not_needed"
      ? freshness
      : "unavailable";
  const approximate = row.price_is_approximate === true;
  const snapshotId = nullableString(row.fx_snapshot_id);
  if (approximate && snapshotId === null) return null;

  return {
    priceRangeStatus: status,
    sourceMinMinor,
    sourceMaxMinor,
    sourceCurrencyCode,
    displayMinMinor: nullableSafeInteger(row.display_min_minor),
    displayMaxMinor: nullableSafeInteger(row.display_max_minor),
    displayCurrencyCode: normalizeIsoCurrency(row.display_currency_code),
    priceIsApproximate: approximate,
    fxSnapshotId: snapshotId,
    fxProvider: nullableString(row.fx_provider),
    fxProviderUpdatedAt: nullableString(row.fx_provider_updated_at),
    fxFreshness,
  };
}

export function shouldShowDiscoveryPrice(
  price: DiscoveryPriceView | null | undefined,
): price is DiscoveryPriceView {
  return price?.priceRangeStatus === "active" &&
    price.sourceMinMinor !== null &&
    price.sourceCurrencyCode !== null;
}

export function isExplicitFreeRange(
  price: DiscoveryPriceView | null | undefined,
): boolean {
  return shouldShowDiscoveryPrice(price) &&
    price.sourceMinMinor === 0 &&
    price.sourceMaxMinor === 0;
}
