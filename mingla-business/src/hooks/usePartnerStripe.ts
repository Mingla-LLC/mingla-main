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
  detachPartnerStripe,
  getPartnerStripeStatus,
  partnerStripeKeys,
  refreshPartnerAccountSession,
  startPartnerOnboarding,
  type PartnerAccountSessionResult,
  type PartnerDetachResult,
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
    // ORCH-1052 hotfix — staleTime 0 + refetchOnWindowFocus so an admin-side
    // partner_enabled toggle becomes visible within seconds of the next
    // mingla-business foreground (no manual reload needed).
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchOnMount: "always",
  });
}

export function useStartPartnerStripeOnboarding(): UseMutationResult<
  StartPartnerOnboardingResult,
  Error,
  StartPartnerOnboardingInput
> {
  // No onSuccess invalidation: earnings.tsx calls statusQuery.refetch()
  // explicitly AFTER WebBrowser.openAuthSessionAsync resolves. Invalidating
  // here would trigger a pre-browser refetch — visible as a flash/swipe-like
  // glitch right before the iOS auth-session popup.
  return useMutation<
    StartPartnerOnboardingResult,
    Error,
    StartPartnerOnboardingInput
  >({
    mutationFn: startPartnerOnboarding,
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

/**
 * Detaches the partner's Stripe Connect account (soft-detach + Stripe
 * delete attempt). On success, invalidates the status query so the UI
 * flips back to "not_connected" + the picker becomes editable.
 */
export function useDetachPartnerStripe(): UseMutationResult<
  PartnerDetachResult,
  Error,
  void
> {
  const queryClient = useQueryClient();
  return useMutation<PartnerDetachResult, Error, void>({
    mutationFn: () => detachPartnerStripe(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: partnerStripeKeys.status() });
    },
    onError: (error) => {
      console.error("[useDetachPartnerStripe] failed", {
        message: error.message,
      });
    },
  });
}
