/**
 * usePublicTicketCheckoutRouteAccess (web / DEFAULT half) — issue #2101,
 * Amendment 4 §A4.1 as respelled by Amendment 8 §A8.1.
 *
 * Platform isolation is filename-enforced by the `.native` OVERRIDE: Metro
 * resolves `X.native.ts` before `X.ts` on iOS and Android, so no native bundle
 * gains this hook, the eligibility service, or Supabase. That is the repo's own
 * dominant convention, and unlike a `.web` half with no plain sibling it is
 * resolvable by TypeScript and by Jest — which is what lets the mandated
 * render-proof assert against the REAL component instead of a virtual stub.
 *
 * The ONE web adapter between the eligibility query owner
 * (`usePublicTicketCheckoutEligibility`, the sole key/service owner) and the
 * three public checkout-entry route owners:
 *   - `app/t/[brandSlug]/[tripSlug].tsx`
 *   - `app/exp/[brandSlug]/[experienceSlug].tsx`
 *   - `src/components/event/PublicEventPage.tsx`
 *
 * It creates NO second Supabase client, NO auth listener, NO second query key
 * and NO second policy interpretation. It only projects the one bounded server
 * state onto one exhaustive route action state.
 *
 * FAIL-CLOSED. `loading`, `error` and `restricted` all disable every purchase
 * entry. `loading` is bound to the INITIAL eligibility resolution for the
 * current auth scope only — never to a background refetch — so a resolved
 * decision is not re-downgraded on every mount.
 */

import { useMemo } from "react";

import { usePublicTicketCheckoutEligibility } from "./useEventTicketCheckoutAccess";

/** Exhaustive route action state. Both platform files export this type. */
export type PublicTicketCheckoutRouteState =
  | "loading"
  | "error"
  | "unrestricted"
  | "sign_in_required"
  | "allowed"
  | "restricted";

export interface PublicTicketCheckoutRouteAccess {
  state: PublicTicketCheckoutRouteState;
  /** Purchase may proceed exactly as today. */
  canPurchase: boolean;
  /** Activating a purchase entry must route to sign-in, not to checkout. */
  requiresSignIn: boolean;
  /** Every purchase entry must be disabled/no-op, fail-closed. */
  blocked: boolean;
  retry: () => void;
}

export const usePublicTicketCheckoutRouteAccess = (
  eventId: string,
): PublicTicketCheckoutRouteAccess => {
  const eligibility = usePublicTicketCheckoutEligibility(eventId);

  return useMemo(() => {
    const state: PublicTicketCheckoutRouteState = eligibility.loading
      ? "loading"
      : eligibility.error
        ? "error"
        : eligibility.data === undefined
          ? "loading"
          : eligibility.data.mode === "unrestricted"
            ? "unrestricted"
            : eligibility.data.state === "sign_in_required"
              ? "sign_in_required"
              : eligibility.data.state === "allowed"
                ? "allowed"
                : "restricted";

    return {
      state,
      canPurchase: state === "unrestricted" || state === "allowed",
      requiresSignIn: state === "sign_in_required",
      // loading / error / restricted are all fail-closed. No eligibility is
      // fabricated before the state settles, and a read error never resolves
      // to a permissive state.
      blocked: state === "loading" || state === "error" ||
        state === "restricted",
      retry: eligibility.refetch,
    };
  }, [
    eligibility.loading,
    eligibility.error,
    eligibility.data,
    eligibility.refetch,
  ]);
};
