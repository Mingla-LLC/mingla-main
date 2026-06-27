// META-ORCH-1232 (C1) — the single shared persisted-id predicate. A brand id is
// selectable ONLY if it is a real, server-persisted UUID. This makes any
// optimistic `_temp_…` id (and any other non-uuid) INELIGIBLE for selection so
// it can never be written to the current-brand pointer / default-brand column.
import { isPersistedBrandId } from "./brandId";

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

// A candidate is valid only if it is BOTH present in the fetched brand list AND
// a persisted (uuid) id. The persisted-id check is what excludes a `_temp_…`
// optimistic row that may be sitting in the list cache mid-create.
const hasBrandId = (
  brands: { id: string }[],
  brandId: string | null,
): brandId is string =>
  brandId !== null &&
  isPersistedBrandId(brandId) &&
  brands.some((brand) => brand.id === brandId);

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

  // "newest-brand" fallback: pick the newest PERSISTED brand only. An optimistic
  // `_temp_…` row prepended by useCreateBrand.onMutate is skipped, so the resolver
  // returns `reason:"none"` rather than poisoning the pointer with a temp id.
  const newestBrand = brands.find((brand) => isPersistedBrandId(brand.id));
  if (newestBrand !== undefined) {
    return { brandId: newestBrand.id, reason: "newest-brand" };
  }

  return { brandId: null, reason: "none" };
};
