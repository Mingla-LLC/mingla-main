/**
 * useBrandStripeDetach — soft-detaches the brand's Stripe Connect account.
 *
 * Per B2a Path C V3 SPEC §6 (detach flow) + Const #4.
 *
 * On success: invalidates brand-stripe-status + brand detail + balances cache.
 * On error: caller subscribes via `mutation.error` and surfaces a user toast.
 */

import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";

import {
  detachBrandStripe,
  type BrandStripeDetachResult,
} from "../services/brandStripeDetachService";
import { brandStripeStatusKeys } from "./useBrandStripeStatus";
import { brandStripeBalancesKeys } from "./useBrandStripeBalances";

export interface UseBrandStripeDetachInput {
  brandId: string;
}

export function useBrandStripeDetach(): UseMutationResult<
  BrandStripeDetachResult,
  Error,
  UseBrandStripeDetachInput
> {
  const queryClient = useQueryClient();
  return useMutation<
    BrandStripeDetachResult,
    Error,
    UseBrandStripeDetachInput
  >({
    mutationFn: async ({ brandId }) => detachBrandStripe(brandId),
    onSuccess: (_data, { brandId }) => {
      queryClient.invalidateQueries({
        queryKey: brandStripeStatusKeys.detail(brandId),
      });
      queryClient.invalidateQueries({
        queryKey: brandStripeBalancesKeys.detail(brandId),
      });
      queryClient.invalidateQueries({ queryKey: ["brands", "detail", brandId] });
    },
    onError: (error, { brandId }) => {
      // Const #3: surface to caller via mutation.error; log for diagnostics
      // eslint-disable-next-line no-console
      console.error("[useBrandStripeDetach] failed", {
        message: error.message,
        brandId,
      });
    },
  });
}
