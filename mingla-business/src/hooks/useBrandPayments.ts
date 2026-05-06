/**
 * React Query hooks for live payments data (B2 / issue #47).
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { supabase } from "../services/supabase";
import { listPayoutsForBrand } from "../services/payoutsService";
import { listRefundsForBrand } from "../services/refundsService";
import type { BrandPayout, BrandRefund } from "../store/currentBrandStore";

export const brandPaymentKeys = {
  all: ["brandPayments"] as const,
  payouts: (brandId: string): readonly [typeof brandPaymentKeys.all, "payouts", string] =>
    [...brandPaymentKeys.all, "payouts", brandId] as const,
  balances: (brandId: string): readonly [typeof brandPaymentKeys.all, "balances", string] =>
    [...brandPaymentKeys.all, "balances", brandId] as const,
  refunds: (brandId: string): readonly [typeof brandPaymentKeys.all, "refunds", string] =>
    [...brandPaymentKeys.all, "refunds", brandId] as const,
};

const DISABLED = ["brandPayments-disabled"] as const;

export interface StripeBalancesPayload {
  availableMinor: number;
  pendingMinor: number;
  currency: string;
}

export function useBrandPayoutsQuery(
  brandId: string | null,
  enabled: boolean,
): UseQueryResult<BrandPayout[]> {
  return useQuery({
    queryKey: brandId !== null ? brandPaymentKeys.payouts(brandId) : DISABLED,
    enabled: brandId !== null && enabled,
    staleTime: 60_000,
    queryFn: async () => {
      if (brandId === null) return [];
      return listPayoutsForBrand(brandId);
    },
  });
}

export function useBrandStripeBalancesQuery(
  brandId: string | null,
  enabled: boolean,
): UseQueryResult<StripeBalancesPayload> {
  return useQuery({
    queryKey: brandId !== null ? brandPaymentKeys.balances(brandId) : DISABLED,
    enabled: brandId !== null && enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<StripeBalancesPayload> => {
      if (brandId === null) {
        return { availableMinor: 0, pendingMinor: 0, currency: "GBP" };
      }
      const { data, error } = await supabase.functions.invoke("brand-stripe-balances", {
        body: { brandId },
      });
      if (error !== null) {
        throw new Error(error.message);
      }
      const d = data as Partial<StripeBalancesPayload> | null;
      return {
        availableMinor: typeof d?.availableMinor === "number" ? d.availableMinor : 0,
        pendingMinor: typeof d?.pendingMinor === "number" ? d.pendingMinor : 0,
        currency: typeof d?.currency === "string" ? d.currency : "GBP",
      };
    },
  });
}

export function useBrandRefundsQuery(
  brandId: string | null,
  defaultCurrency: string,
  enabled: boolean,
): UseQueryResult<BrandRefund[]> {
  return useQuery({
    queryKey:
      brandId !== null
        ? ([...brandPaymentKeys.refunds(brandId), defaultCurrency] as const)
        : DISABLED,
    enabled: brandId !== null && enabled,
    staleTime: 60_000,
    queryFn: async () => {
      if (brandId === null) return [];
      return listRefundsForBrand(brandId, defaultCurrency);
    },
  });
}
