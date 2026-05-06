/**
 * useStartBrandStripeOnboarding — initiates Stripe Connect onboarding.
 * Per SPEC_BIZ_CYCLE_B2A_STRIPE_CONNECT_ONBOARDING.md §4.4.2.
 *
 * Mutation that calls brand-stripe-onboard edge function and invalidates
 * brand-stripe-status cache on success.
 *
 * Caller (BrandOnboardView component) handles the in-app browser open via
 * expo-web-browser.openAuthSessionAsync after this mutation succeeds.
 */

import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";

import {
  startBrandStripeOnboarding,
  type StartOnboardingResult,
} from "../services/brandStripeService";
import { brandStripeStatusKeys } from "./useBrandStripeStatus";

export interface UseStartBrandStripeOnboardingInput {
  brandId: string;
  returnUrl: string;
}

export function useStartBrandStripeOnboarding(): UseMutationResult<
  StartOnboardingResult,
  Error,
  UseStartBrandStripeOnboardingInput
> {
  const queryClient = useQueryClient();
  return useMutation<
    StartOnboardingResult,
    Error,
    UseStartBrandStripeOnboardingInput
  >({
    mutationFn: async ({ brandId, returnUrl }) =>
      startBrandStripeOnboarding(brandId, returnUrl),
    onSuccess: (_data, { brandId }) => {
      // Defensive invalidation; webhook will also fire Realtime invalidate
      queryClient.invalidateQueries({
        queryKey: brandStripeStatusKeys.detail(brandId),
      });
    },
    onError: (error, { brandId }) => {
      // Const #3: surface to UI; caller subscribes via mutation.error
      // eslint-disable-next-line no-console
      console.error("[useStartBrandStripeOnboarding] failed", {
        message: error.message,
        brandId,
      });
    },
  });
}
