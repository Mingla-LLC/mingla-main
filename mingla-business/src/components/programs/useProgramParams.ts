import { useLocalSearchParams } from "expo-router";

import { useBrand } from "../../hooks/useBrands";
import { currencyCodeOrNull } from "../../utils/currency";

const one = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

/** Route params for brand program screens, with the brand and its currency. */
export function useProgramParams<K extends string>(
  ...keys: K[]
): {
  brandId: string;
  params: Record<K, string | undefined>;
  brand: ReturnType<typeof useBrand>["data"];
  currency: string;
} {
  const raw = useLocalSearchParams<Record<string, string | string[]>>();
  const brandId = one(raw.id) ?? "";
  const params = {} as Record<K, string | undefined>;
  for (const key of keys) params[key] = one(raw[key]);
  const { data: brand } = useBrand(brandId.length > 0 ? brandId : null);
  const currency =
    currencyCodeOrNull(brand?.pricingCurrency) ??
    currencyCodeOrNull(brand?.defaultCurrency) ??
    "USD";
  return { brandId, params, brand, currency };
}
