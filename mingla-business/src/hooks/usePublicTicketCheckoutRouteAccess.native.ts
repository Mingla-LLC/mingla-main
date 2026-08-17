/**
 * usePublicTicketCheckoutRouteAccess (NATIVE) — issue #2101, Amendment 4 §A4.1.
 *
 * A typed legacy pass-through. It imports NEITHER the web hook, NOR the
 * eligibility service, NOR Supabase — Metro resolves this `.native.ts`
 * override BEFORE the plain sibling on iOS and Android, so the real eligibility
 * module is excluded from every native bundle, and the
 * shared route/page source compiles to byte-compatible native behavior with no
 * native screen, app version bump, EAS build, store release or OTA.
 *
 * This is NOT a weakening. The shared backend remains authoritative for old and
 * non-allowed native clients: `ticket-checkout-create` returns 401/403 and the
 * database re-decides at session creation, claim, commit, preflight and
 * finalize, with zero provider side effects on denial.
 */

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
  canPurchase: boolean;
  requiresSignIn: boolean;
  blocked: boolean;
  retry: () => void;
}

const NATIVE_PASS_THROUGH: PublicTicketCheckoutRouteAccess = {
  state: "unrestricted",
  canPurchase: true,
  requiresSignIn: false,
  blocked: false,
  retry: () => undefined,
};

export const usePublicTicketCheckoutRouteAccess = (
  _eventId: string,
): PublicTicketCheckoutRouteAccess => NATIVE_PASS_THROUGH;
