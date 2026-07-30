export interface CanonicalDiscoveryPrice {
  priceRangeStatus:
    | "active"
    | "legacy_unresolved"
    | "reconciliation_required"
    | "unset"
    | null;
  sourceMinMinor: number | null;
  sourceMaxMinor: number | null;
  sourceCurrencyCode: string | null;
  sourceMinorUnitExponent: number | null;
  displayMinMinor: number | null;
  displayMaxMinor: number | null;
  displayCurrencyCode: string | null;
  displayMinorUnitExponent: number | null;
  priceIsApproximate: boolean;
  fxSnapshotId: string | null;
  fxProvider: string | null;
  fxProviderUpdatedAt: string | null;
  fxFreshness:
    | "fresh"
    | "stale_soft"
    | "expired"
    | "not_needed"
    | "unavailable"
    | null;
}

/**
 * Copy only the server-owned venue discovery-price contract across persistence
 * and UI carriers. This deliberately excludes `priceTier`, Google price level,
 * and preformatted strings so no carrier can recreate money from an ordinal.
 */
export function canonicalDiscoveryPriceFields(
  value: object | null | undefined,
): Partial<CanonicalDiscoveryPrice> {
  if (!value) return {};
  const carrier = value as Partial<CanonicalDiscoveryPrice>;
  return {
    priceRangeStatus: carrier.priceRangeStatus,
    sourceMinMinor: carrier.sourceMinMinor,
    sourceMaxMinor: carrier.sourceMaxMinor,
    sourceCurrencyCode: carrier.sourceCurrencyCode,
    sourceMinorUnitExponent: carrier.sourceMinorUnitExponent,
    displayMinMinor: carrier.displayMinMinor,
    displayMaxMinor: carrier.displayMaxMinor,
    displayCurrencyCode: carrier.displayCurrencyCode,
    displayMinorUnitExponent: carrier.displayMinorUnitExponent,
    priceIsApproximate: carrier.priceIsApproximate === true,
    fxSnapshotId: carrier.fxSnapshotId,
    fxProvider: carrier.fxProvider,
    fxProviderUpdatedAt: carrier.fxProviderUpdatedAt,
    fxFreshness: carrier.fxFreshness,
  };
}

function validMoney(
  amount: number | null | undefined,
  currency: string | null | undefined,
  exponent: number | null | undefined,
): boolean {
  return typeof amount === "number" &&
    Number.isSafeInteger(amount) &&
    amount >= 0 &&
    typeof currency === "string" &&
    /^[A-Z]{3}$/.test(currency) &&
    typeof exponent === "number" &&
    Number.isInteger(exponent) &&
    exponent >= 0 &&
    exponent <= 3;
}

export function formatMinorAmount(
  amount: number,
  currency: string,
  exponent: number,
): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).format(amount / 10 ** exponent);
}

function formatRange(
  minMinor: number,
  maxMinor: number | null,
  currency: string,
  exponent: number,
): string {
  const min = formatMinorAmount(minMinor, currency, exponent);
  if (maxMinor === 0 && minMinor === 0) return "Free";
  if (maxMinor === null) return `${min}+`;
  return `${min}–${formatMinorAmount(maxMinor, currency, exponent)}`;
}

export function canonicalDiscoveryPriceLabel(
  price: Partial<CanonicalDiscoveryPrice> | null | undefined,
): string | null {
  if (
    !price ||
    price.priceRangeStatus !== "active" ||
    !validMoney(
      price.sourceMinMinor,
      price.sourceCurrencyCode,
      price.sourceMinorUnitExponent,
    )
  ) {
    return null;
  }
  if (
    price.priceIsApproximate &&
    price.fxSnapshotId !== null &&
    validMoney(
      price.displayMinMinor,
      price.displayCurrencyCode,
      price.displayMinorUnitExponent,
    )
  ) {
    return `Approx. ${formatRange(
      price.displayMinMinor as number,
      price.displayMaxMinor ?? null,
      price.displayCurrencyCode as string,
      price.displayMinorUnitExponent as number,
    )}`;
  }
  return formatRange(
    price.sourceMinMinor as number,
    price.sourceMaxMinor ?? null,
    price.sourceCurrencyCode as string,
    price.sourceMinorUnitExponent as number,
  );
}

export function canonicalDiscoveryPriceDetail(
  price: Partial<CanonicalDiscoveryPrice> | null | undefined,
): {
  source: string;
  approximate: string | null;
  ratesDate: string | null;
  attributionUrl: string | null;
} | null {
  if (
    !price ||
    price.priceRangeStatus !== "active" ||
    !validMoney(
      price.sourceMinMinor,
      price.sourceCurrencyCode,
      price.sourceMinorUnitExponent,
    )
  ) {
    return null;
  }
  const source = formatRange(
    price.sourceMinMinor as number,
    price.sourceMaxMinor ?? null,
    price.sourceCurrencyCode as string,
    price.sourceMinorUnitExponent as number,
  );
  const converted = price.priceIsApproximate &&
      price.fxSnapshotId !== null &&
      validMoney(
        price.displayMinMinor,
        price.displayCurrencyCode,
        price.displayMinorUnitExponent,
      )
    ? formatRange(
        price.displayMinMinor as number,
        price.displayMaxMinor ?? null,
        price.displayCurrencyCode as string,
        price.displayMinorUnitExponent as number,
      )
    : null;
  return {
    source,
    approximate: converted,
    ratesDate: price.fxProviderUpdatedAt ?? null,
    attributionUrl: converted !== null
      ? "https://www.exchangerate-api.com/"
      : null,
  };
}
