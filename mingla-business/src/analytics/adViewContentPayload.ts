/** Issue #3697 — complete, provider-safe browser ViewContent payloads. */

export interface AdViewContentPayload {
  contentId: string;
  brandId: string;
  value: number;
  currency: string;
}

export function buildAdViewContentPayload(input: {
  contentId: string | null | undefined;
  brandId: string | null | undefined;
  currency: string | null | undefined;
  valuesMajor: readonly (number | null | undefined)[];
  freeWhenUnpriced?: boolean;
}): AdViewContentPayload | null {
  const contentId = input.contentId?.trim() ?? "";
  const brandId = input.brandId?.trim() ?? "";
  const currency = input.currency?.trim().toUpperCase() ?? "";
  if (!contentId || !brandId || !/^[A-Z]{3}$/.test(currency)) return null;

  const values = input.valuesMajor.filter(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value) && value >= 0,
  );
  if (values.length === 0 && input.freeWhenUnpriced !== true) return null;

  return {
    contentId,
    brandId,
    value: values.length > 0 ? Math.min(...values) : 0,
    currency,
  };
}
