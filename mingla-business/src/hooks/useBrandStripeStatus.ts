/**
 * useBrandStripeStatus — reads canonical Stripe Connect status for a brand.
 * Per SPEC_BIZ_CYCLE_B2A_STRIPE_CONNECT_ONBOARDING.md §4.4.1.
 *
 * Subscribes to Supabase Realtime for webhook-driven invalidation per D-B2-11:
 *  - webhook (account.updated) → stripe_connect_accounts UPDATE → DB trigger fires
 *    → Realtime broadcast → invalidate React Query → UI refreshes
 *  - 30s poll fallback via refetchInterval for safety
 *
 * Const #4: query keys from factory `brandStripeStatusKeys`.
 * Const #5: server state via React Query (NOT Zustand).
 */

import { useEffect } from "react";
import {
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";

import { supabase } from "../services/supabase";
import {
  refreshBrandStripeStatus,
  type RefreshStatusResult,
} from "../services/brandStripeService";

const STALE_TIME_MS = 30 * 1000; // 30s — matches webhook + poll fallback per D-B2-11

export const brandStripeStatusKeys = {
  all: ["brand-stripe-status"] as const,
  detail: (brandId: string): readonly ["brand-stripe-status", string] =>
    [...brandStripeStatusKeys.all, brandId] as const,
};

const DISABLED_KEY = ["brand-stripe-status-disabled"] as const;

export function useBrandStripeStatus(
  brandId: string | null,
): UseQueryResult<RefreshStatusResult> {
  const queryClient = useQueryClient();
  const enabled = brandId !== null;

  // Realtime subscription per D-B2-11
  useEffect(() => {
    if (!enabled || brandId === null) return;
    // Unique channel name per mount — prevents Supabase Realtime from rejecting
    // re-subscription with the same name when (a) React 18 StrictMode double-mounts
    // an effect, or (b) two components consume this hook for the same brandId
    // (BrandOnboardView + BrandPaymentsView both consume it post-V3-Sub-C).
    // `removeChannel` cleanup is async; without uniqueness, the second mount
    // races against the first's still-pending detach. Fix per ORCH-V3-runtime-1.
    const channelName = `stripe-status-${brandId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "stripe_connect_accounts",
          filter: `brand_id=eq.${brandId}`,
        },
        () => {
          queryClient.invalidateQueries({
            queryKey: brandStripeStatusKeys.detail(brandId),
          });
          // Also invalidate brand detail to refresh derived stripeStatus
          // populated by mapBrandRowToUi from the cache columns
          queryClient.invalidateQueries({
            queryKey: ["brands", "detail", brandId],
          });
        },
      )
      .subscribe();

    return (): void => {
      void supabase.removeChannel(channel);
    };
  }, [enabled, brandId, queryClient]);

  return useQuery<RefreshStatusResult>({
    queryKey: enabled
      ? brandStripeStatusKeys.detail(brandId)
      : DISABLED_KEY,
    enabled,
    staleTime: STALE_TIME_MS,
    refetchInterval: STALE_TIME_MS, // 30s poll fallback per D-B2-11
    queryFn: async (): Promise<RefreshStatusResult> => {
      if (brandId === null) {
        throw new Error("useBrandStripeStatus: brandId is null but enabled");
      }
      return refreshBrandStripeStatus(brandId);
    },
  });
}
