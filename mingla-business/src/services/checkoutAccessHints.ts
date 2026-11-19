/**
 * checkoutAccessHints — #4518 N1. Kept apart from
 * `eventTicketCheckoutAccessService` so it carries no database client: the
 * page-bundle parser writes a hint, the eligibility hook reads it.
 */
import type { PublicTicketCheckoutAccess } from "./eventTicketCheckoutAccessService";

// ---- #4518 N1: the same-origin "this sale is open to everyone" hint --------
//
// `mode: "unrestricted"` is a fact about the SALE, not about the viewer, so
// the page bundle (served from our own site) can carry it. When it does, the
// Buy button does not wait on a second hostname: the eligibility query starts
// from this answer and still re-reads in the background. A restricted sale
// carries no hint and is read per buyer exactly as before. Advisory either
// way: `ticket-checkout-create` decides, with zero provider side effects for
// a buyer who is not allowed.
const unrestrictedCheckoutEventIds = new Set<string>();

const UNRESTRICTED_CHECKOUT_ACCESS: PublicTicketCheckoutAccess = {
  schemaVersion: 1,
  mode: "unrestricted",
  state: "unrestricted",
};

export const noteUnrestrictedCheckout = (eventId: string): void => {
  if (eventId.length > 0) unrestrictedCheckoutEventIds.add(eventId);
};

export const hintedCheckoutAccess = (
  eventId: string,
): PublicTicketCheckoutAccess | undefined =>
  unrestrictedCheckoutEventIds.has(eventId)
    ? UNRESTRICTED_CHECKOUT_ACCESS
    : undefined;

/** Test seam. */
export const clearCheckoutAccessHints = (): void => {
  unrestrictedCheckoutEventIds.clear();
};
