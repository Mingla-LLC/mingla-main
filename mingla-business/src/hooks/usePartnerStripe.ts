/**
 * usePartnerStripe — React Query hooks for the partner identity Stripe
 * surface. ORCH-1052.
 *
 * - usePartnerStripeStatus()        → status row (incl. partner_enabled)
 * - useStartPartnerStripeOnboarding → mutation → AccountSession + onboarding_url
 * - useRefreshPartnerAccountSession → mutation → fresh AccountSession
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import {
  getPartnerStripeStatus,
  partnerStripeKeys,
  refreshPartnerAccountSession,
  startPartnerOnboarding,
  type PartnerAccountSessionResult,
  type PartnerStripeStatusRow,
  type StartPartnerOnboardingInput,
  type StartPartnerOnboardingResult,
} from "../services/partnerStripeService";

export function usePartnerStripeStatus(): UseQueryResult<
  PartnerStripeStatusRow,
  Error
> {
  return useQuery<PartnerStripeStatusRow, Error>({
    queryKey: partnerStripeKeys.status(),
    queryFn: getPartnerStripeStatus,
    staleTime: 30 * 1000,
  });
}

export function useStartPartnerStripeOnboarding(): UseMutationResult<
  StartPartnerOnboardingResult,
  Error,
  StartPartnerOnboardingInput
> {
  const queryClient = useQueryClient();
  return useMutation<
    StartPartnerOnboardingResult,
    Error,
    StartPartnerOnboardingInput
  >({
    mutationFn: startPartnerOnboarding,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: partnerStripeKeys.status() });
    },
    onError: (error) => {
      console.error("[useStartPartnerStripeOnboarding] failed", {
        message: error.message,
      });
    },
  });
}

export function useRefreshPartnerAccountSession(): UseMutationResult<
  PartnerAccountSessionResult,
  Error,
  "onboarding" | "account_management"
> {
  return useMutation<
    PartnerAccountSessionResult,
    Error,
    "onboarding" | "account_management"
  >({
    mutationFn: (surface) => refreshPartnerAccountSession(surface),
    onError: (error) => {
      console.error("[useRefreshPartnerAccountSession] failed", {
        message: error.message,
      });
    },
  });
}
