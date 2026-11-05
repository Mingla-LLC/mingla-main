import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import {
  addBrandPlanItem,
  BrandPlanError,
  fetchBrandPlan,
  removeBrandPlanItem,
  updateBrandPlanItem,
  type BrandPlanChanges,
  type BrandPlanItem,
  type BrandPlanNewItem,
} from "../services/brandPlanService";
import { brandPlanKeys } from "./brandPlanKeys";

export { brandPlanKeys } from "./brandPlanKeys";

/** One window of the plan. A plan the caller cannot read is final: no retry loop. */
export function useBrandPlan(brandId: string | null, from: string, to: string) {
  const { isAuthReady, user } = useAuth();
  const userId = user?.id ?? null;
  const enabled = Boolean(isAuthReady && userId && brandId);
  return useQuery({
    queryKey: enabled && brandId && userId
      ? brandPlanKeys.window(brandId, from, to, userId)
      : (["brandPlan", "window-disabled"] as const),
    enabled,
    queryFn: () => {
      if (!brandId) throw new BrandPlanError("failed", "", "brand_required");
      return fetchBrandPlan(brandId, from, to);
    },
    staleTime: 30_000,
    retry: (count, cause) => !(cause instanceof BrandPlanError && cause.code === "not_found") && count < 2,
  });
}

/**
 * The plan's writes. Nothing is inserted optimistically: the sheet stays open
 * until the server confirms, then the plan is read again. A write refused
 * because the item changed or left the plan reads the plan again too.
 */
export function useBrandPlanWrites(brandId: string) {
  const queryClient = useQueryClient();
  const refresh = (): Promise<void> => queryClient.invalidateQueries({ queryKey: brandPlanKeys.brand(brandId) });
  const refreshIfStale = (cause: unknown): void => {
    if (cause instanceof BrandPlanError && (cause.code === "stale_write" || cause.code === "not_found" || cause.code === "locked")) void refresh();
  };
  const add = useMutation({
    mutationFn: ({ item, requestKey }: { item: BrandPlanNewItem; requestKey: string }) => addBrandPlanItem(brandId, item, requestKey),
    onSuccess: refresh,
    // Refused as too long: the brand's name changed, so the plan's limit did too.
    onError: (cause) => {
      if (cause instanceof BrandPlanError && cause.token === "title_too_long") void refresh();
    },
  });
  const update = useMutation({
    mutationFn: ({ item, changes }: { item: BrandPlanItem; changes: BrandPlanChanges }) =>
      updateBrandPlanItem(item.kind as "post" | "task", item.id, changes, item.revision ?? 0),
    onSuccess: refresh,
    onError: refreshIfStale,
  });
  const remove = useMutation({
    mutationFn: (item: BrandPlanItem) => removeBrandPlanItem(item.kind as "post" | "task", item.id, item.revision ?? 0),
    onSuccess: refresh,
    onError: refreshIfStale,
  });
  return { add, update, remove };
}
