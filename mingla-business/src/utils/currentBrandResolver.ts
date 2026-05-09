export type CurrentBrandResolveReason =
  | "keep-local"
  | "server-default"
  | "newest-brand"
  | "none";

export interface ResolveCurrentBrandInput {
  currentBrandId: string | null;
  defaultBrandId: string | null;
  brands: { id: string }[];
}

export interface ResolveCurrentBrandResult {
  brandId: string | null;
  reason: CurrentBrandResolveReason;
}

const hasBrandId = (
  brands: { id: string }[],
  brandId: string | null,
): brandId is string =>
  brandId !== null && brands.some((brand) => brand.id === brandId);

export const resolveCurrentBrandId = ({
  currentBrandId,
  defaultBrandId,
  brands,
}: ResolveCurrentBrandInput): ResolveCurrentBrandResult => {
  if (hasBrandId(brands, currentBrandId)) {
    return { brandId: currentBrandId, reason: "keep-local" };
  }

  if (hasBrandId(brands, defaultBrandId)) {
    return { brandId: defaultBrandId, reason: "server-default" };
  }

  const newestBrand = brands[0];
  if (newestBrand !== undefined) {
    return { brandId: newestBrand.id, reason: "newest-brand" };
  }

  return { brandId: null, reason: "none" };
};
