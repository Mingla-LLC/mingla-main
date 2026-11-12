/**
 * #4389 (Checkout recording 00:10) — Stripe declined Seth's real card in test
 * mode (PaymentIntent requires_payment_method, last_payment_error card_declined,
 * decline_code test_mode_live_card). Door mode showed "Processing payment…",
 * then "Checking the payment — We don't know yet…" with Check again, for ever:
 * confirm's error came back with no PaymentIntent, and every such error was
 * treated as unknown.
 *
 *   K1 a decline Stripe answered (card_error / decline code), no PaymentIntent
 *      back → declined, "Nothing was charged…";
 *   K2 test_mode_live_card adds the test-only hint; other declines never do;
 *   K3 unknown stays unknown for real uncertainty: a timeout, or no Stripe
 *      answer at all.
 *
 * FAILS ON REVERT: the `stripeAnsweredDecline` branch removed → K1/K2.
 */
import { describe, expect, test } from "@jest/globals";
import { TapToPaySaleFlow } from "../tapToPayFlow";
import { TAP_TEST_MODE_LIVE_CARD_HINT, tapDeclinedBody } from "../../../constants/tapToPayCopy";

type State = { kind: string; testModeLiveCard?: boolean };

const flow = (confirmError: Record<string, unknown>) => {
  const states: State[] = [];
  const f = new TapToPaySaleFlow({
    eventId: "e",
    draft: { lines: [{ ticketTypeId: "t", quantity: 1 }], eventDateId: null, buyerPhone: null, phoneCountryIso: null } as never,
    clientRequestId: "r",
    terminal: {
      ensureReaderConnected: async () => ({}),
      checkDeviceSupport: async () => ({ supported: true }),
      retrievePaymentIntent: async () => ({ paymentIntent: { id: "pi_1", status: "requires_payment_method" } }),
      collectPaymentMethod: async () => ({ paymentIntent: { id: "pi_1", status: "requires_confirmation" } }),
      confirmPaymentIntent: async () => ({ error: confirmError }),
      cancelCollectPaymentMethod: async () => ({}),
    } as never,
    server: {
      createIntent: async () =>
        ({ paymentIntentId: "pi_1", clientSecret: "s", totalCents: 500, currency: "USD", stripeAccountId: "a", locationId: "tml", feeCents: 0, subtotalCents: 500 }),
      completeIntent: async () => ({ orderId: "o", ticketIds: [], receiptQueued: false, replayed: false }),
      cancelIntent: async () => undefined,
    },
    onState: (state) => states.push(state as never),
  });
  return { f, last: (): State | undefined => states[states.length - 1] };
};

describe("#4389 — a decline Stripe answered is known, never 'checking'", () => {
  test("K1: card_error / decline code with no PaymentIntent back → declined", async () => {
    for (const apiError of [
      { type: "card_error", code: "card_declined", declineCode: "generic_decline" },
      { declineCode: "insufficient_funds" },
    ]) {
      const h = flow({ code: "DECLINED_BY_STRIPE_API", apiError });
      await h.f.start();
      expect(h.last()?.kind).toBe("declined");
      expect(h.last()?.testModeLiveCard).toBeUndefined();
    }
  });

  test("K2: a real card in test mode → declined with the test-only hint", async () => {
    const h = flow({ code: "DECLINED_BY_STRIPE_API", apiError: { type: "card_error", code: "card_declined", declineCode: "test_mode_live_card" } });
    await h.f.start();
    expect(h.last()).toMatchObject({ kind: "declined", testModeLiveCard: true });
    expect(tapDeclinedBody(true)).toContain(TAP_TEST_MODE_LIVE_CARD_HINT);
    expect(tapDeclinedBody(undefined)).toBe("Nothing was charged. Try again or pick another way to pay.");
  });

  test("K3: a timeout or no Stripe answer stays unknown", async () => {
    for (const error of [
      { code: "REQUEST_TIMED_OUT", apiError: { declineCode: "generic_decline" } },
      { code: "STRIPE_API_CONNECTION_ERROR" },
      { code: "DECLINED_BY_STRIPE_API" },
    ]) {
      const h = flow(error);
      await h.f.start();
      expect(h.last()?.kind).toBe("unknown_result");
    }
  });
});
