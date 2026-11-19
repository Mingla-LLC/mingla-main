/**
 * #4453 (contract section I) — finding a brand in the switcher. Pure.
 *
 * The search field appears only when there are more brands than fit a glance
 * (more than 8). Matching ignores case and accents and looks at the name and
 * the brand's address slug.
 */

/** Show the search field above this many brands. */
export const BRAND_SEARCH_ABOVE = 8;

export const showsBrandSearch = (brandCount: number): boolean =>
  brandCount > BRAND_SEARCH_ABOVE;

const fold = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

export function filterBrandsByQuery<T extends { displayName: string; slug?: string | null }>(
  brands: readonly T[],
  query: string,
): T[] {
  const needle = fold(query);
  if (needle.length === 0) return [...brands];
  return brands.filter(
    (brand) =>
      fold(brand.displayName).includes(needle) ||
      (typeof brand.slug === "string" && fold(brand.slug).includes(needle)),
  );
}
