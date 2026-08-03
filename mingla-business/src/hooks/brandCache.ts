import { queryClient } from "../config/queryClient";
import type { Brand } from "../types/brand";
import { brandKeys } from "./brandKeys";

/**
 * Synchronous, hook-free lookup for outside-component contexts (Zustand
 * actions, store converters, fire-and-forget submit handlers). Reads the
 * React Query cache by ID. Tries the detail cache first; falls back to
 * iterating the list caches. Returns null on miss.
 *
 * Replaces the Cycle-17e-A `useCurrentBrandStore.getState().currentBrand`
 * imperative pattern in 5 call sites (RefundSheet, CancelOrderDialog,
 * order detail resend, liveEventConverter, liveEventStore.recordEdit
 * notification).
 *
 * Cycle 2 / ORCH-0742.
 */
export const getBrandFromCache = (brandId: string | null): Brand | null => {
  if (brandId === null) return null;
  const detail = queryClient.getQueryData<Brand | null>(
    brandKeys.detail(brandId),
  );
  if (detail !== undefined && detail !== null) return detail;
  const lists = queryClient.getQueriesData<Brand[]>({
    queryKey: brandKeys.lists(),
  });
  for (const [, brands] of lists) {
    if (brands === undefined) continue;
    const found = brands.find((b) => b.id === brandId);
    if (found !== undefined) return found;
  }
  return null;
};
