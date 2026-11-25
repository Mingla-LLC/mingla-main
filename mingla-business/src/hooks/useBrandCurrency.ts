/**
 * #4490 P2 — the brand's currency code for money fields and amounts
 * (`brands.default_currency`), or null when the brand has none yet (a pre-bank
 * brand never sees a made-up currency; #962).
 */
import { currencyCodeOrNull } from "../utils/currency";
import { useBrandList } from "./useBrandListShim";
import { useCurrentBrand } from "./useCurrentBrand";

export function useBrandCurrency(brandId: string | null): string | null {
  const brands = useBrandList();
  const current = useCurrentBrand();
  const brand = brands.find((b) => b.id === brandId) ?? (current?.id === brandId ? current : null);
  return currencyCodeOrNull(brand?.defaultCurrency ?? null);
}
