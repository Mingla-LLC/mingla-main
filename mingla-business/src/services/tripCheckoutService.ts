/**
 * tripCheckoutService — trip-named alias re-exports of the existing
 * event-checkout chain. Tr2 (ORCH-0859).
 *
 * Per SPEC §4.3 + investigation G-1: `ticket-checkout-create` edge function
 * is event_type-agnostic. Trip orders route through the existing chain at
 * `/checkout/{tripEventId}/*` with the brand's stripe_connect_id supplying
 * `transfer_data.destination` for Stripe Connect routing — same path paid
 * events use today.
 *
 * Per I-PROPOSED-TR2-STRIPE-CONNECT-TRIP-ROUTING (DRAFT → ACTIVE on CLOSE):
 * trip orders MUST have transfer_data.destination = trip planner's
 * stripe_connect_id. Verified live at CLOSE-time via operator $1 test-mode
 * Stripe Dashboard probe (SC-18).
 *
 * This service exists for two reasons:
 *   1. Discoverability — trip-flow code reads `import { ... } from "./tripCheckoutService"`
 *      rather than reaching into event-named `ticketCheckoutService`.
 *   2. A single boundary to wrap if trips ever need different checkout copy /
 *      analytics tagging (kept minimal in Tr2; Tr3 [installments] may expand).
 *
 * The actual buyer-flow happens in `/checkout/[eventId]/*` route components
 * unchanged — Tr2 simply routes the buyer there from /t/{slug}.
 *
 * Spec: Mingla_Artifacts/specs/SPEC_ORCH-0859_TR2_MINIMUM_VIABLE_TRIP.md §4.3
 */

export {
  createTicketCheckout as createTripCheckout,
  getTicketCheckoutStatus as getTripCheckoutStatus,
  confirmTicketCheckout as confirmTripCheckout,
  resendTicketConfirmation as resendTripConfirmation,
} from "./ticketCheckoutService";

export type {
  TicketCheckoutCreateInput as TripCheckoutCreateInput,
  TicketCheckoutCreateResult as TripCheckoutCreateResult,
  TicketCheckoutStatusResult as TripCheckoutStatusResult,
  TicketCheckoutConfirmResult as TripCheckoutConfirmResult,
  TicketCheckoutRequiresPayment as TripCheckoutRequiresPayment,
  TicketCheckoutRequiresWebRedirect as TripCheckoutRequiresWebRedirect,
  TicketCheckoutFreeCompleted as TripCheckoutFreeCompleted,
} from "./ticketCheckoutService";
