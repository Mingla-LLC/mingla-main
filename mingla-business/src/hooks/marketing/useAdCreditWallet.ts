/**
 * toward #3697 Wave 7 — React Query wallet + history for Blast → Ads.
 */

import { useQuery } from "@tanstack/react-query";

import { useAuth } from "../../context/AuthContext";
import {
  AdCreditAppError,
  getAdCreditWallet,
  type AdCreditWalletPayload,
} from "../../services/adCreditService";
import { useCanViewBrandPayments } from "../useCanViewBrandPayments";

export const adCreditWalletKey = (brandId: string | null) =>
  ["ad-credit-wallet", brandId] as const;

export function useAdCreditWallet(brandId: string | null) {
  // ORCH-1004 — ad-credit is JWT + brand-scoped; never fire pre-auth.
  const { isAuthReady } = useAuth();
  const view = useCanViewBrandPayments(brandId);
  const enabled =
    isAuthReady &&
    brandId !== null &&
    view.allowed &&
    !view.isLoading;

  const query = useQuery<AdCreditWalletPayload, AdCreditAppError>({
    queryKey: adCreditWalletKey(brandId),
    enabled,
    queryFn: () => {
      if (brandId === null) {
        throw new AdCreditAppError("validation_error", "brand_id_required");
      }
      return getAdCreditWallet(brandId);
    },
    staleTime: 15_000,
  });

  return {
    ...query,
    canView: view.allowed,
    viewLoading: view.isLoading,
    viewError: view.isError,
    refetchView: view.refetch,
    hasResolved: query.isFetched || !enabled,
  };
}
