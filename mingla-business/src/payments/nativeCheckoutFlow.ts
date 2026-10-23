// ORCH-0849 (2026-05-15): web-safe stub for the native PaymentSheet flow.
// Metro picks `nativeCheckoutFlow.native.ts` on iOS/Android automatically;
// this file is resolved on web and by tsc. It must NOT import
// `@stripe/stripe-react-native` or any native-only module — that would
// poison the web bundle (I-PROPOSED-AE / ORCH-0778). mingla-business web
// buyers go through Stripe Hosted Checkout (Platform.OS === "web" branch
// in app/checkout/[eventId]/payment.tsx), so this hook is never invoked
// on web; the stub exists so the import resolves cleanly.

import type { TicketCheckoutReview } from "@mingla/offering-rendering/discountQuote";

export interface NativeCheckoutInput {
  eventId: string;
  lines: Array<{ ticketTypeId: string; quantity: number }>;
  buyer: {
    name: string;
    email: string;
    phone: string;
    marketingOptIn?: boolean;
    // ORCH-1130 Fix #2 — buyer address is OPTIONAL. Tax is venue-sourced
    // server-side (events.venue_tax_address); the buyer never types an
    // address (MINGLA-WIDE all-in / WYSIWYP). Retained optional only for
    // backward compat with older callers; the server ignores it.
    address?: {
      line1: string;
      line2?: string;
      city: string;
      state?: string;
      postal: string;
      country: string;
    };
  };
  paymentPlanChoice?: "full" | "installments";
  idempotencyKey?: string;
  taxCalculationId?: string | null;
  discountCode?: string | null;
  /** #3872 — current callers always pass both; optional for pre-R1 call sites. */
  quoteDigest?: string;
  quoteListDigest?: string;
  /** ORCH-1138 Leg 3 — chosen experience occurrence (web stub never invokes). */
  eventDateId?: string;
  /** issue #3281 — the chosen day SET (web stub never invokes; type parity). */
  eventDateIds?: readonly string[];
  /** issue #3281 — open-daily booked start (web stub never invokes; type parity). */
  bookedStartAt?: string;
  /** issue #3281 R2 — block hire end (web stub; type parity). */
  bookedEndAt?: string;
  /** issue #3281 R2 — guest party size (web stub; type parity). */
  partySize?: number;
  /**
   * ORCH-1246 (Apple 4.9) — on-screen event/trip/experience title threaded into
   * the native Apple Pay cartItem so the wallet sheet shows the PRODUCT, not the
   * company. Web stub never invokes; declared here for call-site type parity.
   */
  displayTitle?: string;
}

export type NativeCheckoutOutcome =
  | { outcome: "succeeded"; orderId: string }
  | { outcome: "canceled" }
  | { outcome: "failed"; message: string; review?: TicketCheckoutReview };

export const useNativeCheckoutFlow = (): (
  input: NativeCheckoutInput,
) => Promise<NativeCheckoutOutcome> => {
  return async (): Promise<NativeCheckoutOutcome> => ({
    outcome: "failed",
    message:
      "Native PaymentSheet is not available on web. Use the hosted checkout branch (Platform.OS === 'web') instead.",
  });
};
