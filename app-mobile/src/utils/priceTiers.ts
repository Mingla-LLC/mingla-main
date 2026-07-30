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

function validMoney(
  amount: number | null,
  currency: string | null,
  exponent: number | null,
): boolean {
  return amount !== null &&
    Number.isSafeInteger(amount) &&
    amount >= 0 &&
    currency !== null &&
    /^[A-Z]{3}$/.test(currency) &&
    exponent !== null &&
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
  price: CanonicalDiscoveryPrice | null | undefined,
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
      price.displayMaxMinor,
      price.displayCurrencyCode as string,
      price.displayMinorUnitExponent as number,
    )}`;
  }
  return formatRange(
    price.sourceMinMinor as number,
    price.sourceMaxMinor,
    price.sourceCurrencyCode as string,
    price.sourceMinorUnitExponent as number,
  );
}

export function canonicalDiscoveryPriceDetail(
  price: CanonicalDiscoveryPrice | null | undefined,
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
    price.sourceMaxMinor,
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
        price.displayMaxMinor,
        price.displayCurrencyCode as string,
        price.displayMinorUnitExponent as number,
      )
    : null;
  return {
    source,
    approximate: converted,
    ratesDate: price.fxProviderUpdatedAt,
    attributionUrl: converted !== null
      ? "https://www.exchangerate-api.com/"
      : null,
  };
}
