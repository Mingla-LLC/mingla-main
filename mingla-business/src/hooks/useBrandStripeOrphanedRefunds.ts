/**
 * useBrandStripeOrphanedRefunds — read-only refund history for detached brands.
 *
 * Per B2a Path C V3 SPEC §6 + DEC-V3-7.
 *
 * Cache strategy:
 *  - staleTime 5 min — refund events accumulate slowly post-detach
 *  - No refetchInterval — these are post-detach historicals; webhook
 *    Realtime would be the right invalidation source if reactivity is needed,
 *    but Phase 1 ships without (low-frequency event class).
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import {
  fetchBrandStripeOrphanedRefunds,
  type OrphanedRefundEntry,
} from "../services/brandStripeOrphanedRefundsService";

const STALE_TIME_MS = 5 * 60 * 1000;

export const brandStripeOrphanedRefundsKeys = {
  all: ["brand-stripe-orphaned-refunds"] as const,
  detail: (
    brandId: string,
  ): readonly ["brand-stripe-orphaned-refunds", string] =>
    [...brandStripeOrphanedRefundsKeys.all, brandId] as const,
};

const DISABLED_KEY = ["brand-stripe-orphaned-refunds-disabled"] as const;

export function useBrandStripeOrphanedRefunds(
  brandId: string | null,
): UseQueryResult<readonly OrphanedRefundEntry[]> {
  const enabled = brandId !== null;

  return useQuery<readonly OrphanedRefundEntry[]>({
    queryKey: enabled
      ? brandStripeOrphanedRefundsKeys.detail(brandId)
      : DISABLED_KEY,
    enabled,
    staleTime: STALE_TIME_MS,
    queryFn: async (): Promise<readonly OrphanedRefundEntry[]> => {
      if (brandId === null) {
        throw new Error("useBrandStripeOrphanedRefunds: brandId null but enabled");
      }
      return fetchBrandStripeOrphanedRefunds(brandId);
    },
  });
}
