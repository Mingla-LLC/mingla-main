import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import {
  getBrandDiscoveryCurrencyState,
  setBrandProvisionalCurrency,
  type BrandDiscoveryCurrencyState,
} from "../services/businessPlaceAuthoringService";

export const brandDiscoveryCurrencyKeys = {
  all: ["brand-discovery-currency"] as const,
  detail: (brandId: string) =>
    [...brandDiscoveryCurrencyKeys.all, "detail", brandId] as const,
  reconciliation: (brandId: string, reconciliationId: string) =>
    [
      ...brandDiscoveryCurrencyKeys.all,
      "reconciliation",
      brandId,
      reconciliationId,
    ] as const,
};

export function useBrandDiscoveryCurrency(
  brandId: string | null,
): UseQueryResult<BrandDiscoveryCurrencyState, Error> {
  return useQuery({
    queryKey: brandDiscoveryCurrencyKeys.detail(brandId ?? ""),
    queryFn: () => getBrandDiscoveryCurrencyState(brandId ?? ""),
    enabled: brandId !== null,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

export function useSetBrandProvisionalCurrency(
  brandId: string | null,
): UseMutationResult<
  BrandDiscoveryCurrencyState,
  Error,
  { currencyCode: string; expectedStateVersion: number }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input) => {
      if (brandId === null) throw new Error("Choose a brand first.");
      return setBrandProvisionalCurrency({
        brandId,
        currencyCode: input.currencyCode,
        expectedStateVersion: input.expectedStateVersion,
      });
    },
    onSuccess: (state) => {
      if (brandId !== null) {
        queryClient.setQueryData(
          brandDiscoveryCurrencyKeys.detail(brandId),
          state,
        );
        void queryClient.invalidateQueries({
          queryKey: brandDiscoveryCurrencyKeys.detail(brandId),
        });
      }
    },
  });
}
