// ORCH-0849 (2026-05-15): web-safe stub for the native PaymentSheet flow.
// Metro picks `nativeCheckoutFlow.native.ts` on iOS/Android automatically;
// this file is resolved on web and by tsc. It must NOT import
// `@stripe/stripe-react-native` or any native-only module — that would
// poison the web bundle (I-PROPOSED-AE / ORCH-0778). mingla-business web
// buyers go through Stripe Hosted Checkout (Platform.OS === "web" branch
// in app/checkout/[eventId]/payment.tsx), so this hook is never invoked
// on web; the stub exists so the import resolves cleanly.

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
}

export type NativeCheckoutOutcome =
  | { outcome: "succeeded"; orderId: string }
  | { outcome: "canceled" }
  | { outcome: "failed"; message: string };

export const useNativeCheckoutFlow = (): (
  input: NativeCheckoutInput,
) => Promise<NativeCheckoutOutcome> => {
  return async (): Promise<NativeCheckoutOutcome> => ({
    outcome: "failed",
    message:
      "Native PaymentSheet is not available on web. Use the hosted checkout branch (Platform.OS === 'web') instead.",
  });
};
