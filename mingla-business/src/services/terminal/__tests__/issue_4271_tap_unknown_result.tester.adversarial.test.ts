/**
 * #4271 final tester — adversarial: a Tap to Pay result nobody knows yet.
 *
 * A different angle from the implementor's flow suite (which pins the happy
 * order, declines and PIN): what happens AFTER Stripe answers "unknown".
 *   U1 a confirm with no PaymentIntent back is unknown, and "Try again" confirms
 *      the SAME intent: no second tap, no second intent, one sale recorded.
 *   U2 a timed-out confirm is unknown even when the stale PaymentIntent snapshot
 *      reads requires_payment_method: the timeout wins, nobody is told nothing
 *      was charged.
 *   U3 while unknown, switching to a pay code is refused when the server cancel
 *      can't be confirmed (override 7: no second way to pay).
 *   U4 while unknown, a server cancel that finds the payment succeeded records
 *      that sale instead of making a pay code.
 *   U5 a read that timed out (nothing collected) is a timed-out end, and the
 *      retry re-collects on the same intent.
 *
 * fails-on-revert (verified by the final tester): delete the unknown_result
 * branch in TapToPaySaleFlow.confirm -> U1, U2 fail; delete
 * `if (this.state.kind === "unknown_result") return "blocked";` in
 * abandonForPayCode -> U3 fails.
 */
import { describe, expect, jest, test } from "@jest/globals";

import {
  TapToPaySaleFlow,
  type TapSaleState,
  type TapToPayServer,
  type TapToPayTerminalClient,
  type TerminalCallResult,
  type TerminalPaymentIntentLike,
} from "../tapToPayFlow";
import { DoorTapError, type DoorTapIntent } from "../doorTapEdge";

jest.mock("../../supabase", () => ({ supabase: { functions: { invoke: jest.fn() } } }));

const INTENT: DoorTapIntent = {
  paymentIntentId: "pi_u1",
  clientSecret: "pi_u1_secret",
  totalCents: 3135,
  currency: "GBP",
  stripeAccountId: "acct_1",
  locationId: "tml_1",
};
const PI_NEW = { id: "pi_u1", status: "requires_payment_method" };
const PI_COLLECTED = { id: "pi_u1", status: "requires_confirmation" };
const PI_SUCCEEDED = { id: "pi_u1", status: "succeeded" };

const harness = (opts: {
  collect?: TerminalCallResult[];
  confirm?: TerminalCallResult[];
  cancelIntent?: TapToPayServer["cancelIntent"];
}) => {
  const states: TapSaleState[] = [];
  const collectQueue = [...(opts.collect ?? [])];
  const confirmQueue = [...(opts.confirm ?? [])];
  const collected: string[] = [];
  const confirmed: string[] = [];
  const terminal: TapToPayTerminalClient = {
    ensureReaderConnected: jest.fn(async () => ({})),
    retrievePaymentIntent: jest.fn(async () => ({ paymentIntent: PI_NEW })),
    collectPaymentMethod: jest.fn(async (pi: TerminalPaymentIntentLike) => {
      collected.push(String(pi.id));
      return collectQueue.shift() ?? { paymentIntent: PI_COLLECTED };
    }),
    confirmPaymentIntent: jest.fn(async (pi: TerminalPaymentIntentLike) => {
      confirmed.push(String(pi.id));
      return confirmQueue.shift() ?? { paymentIntent: PI_SUCCEEDED };
    }),
    cancelCollectPaymentMethod: jest.fn(async () => ({})),
  };
  const createIntent = jest.fn<TapToPayServer["createIntent"]>(async () => INTENT);
  const completeIntent = jest.fn<TapToPayServer["completeIntent"]>(async () => ({
    orderId: "ord_u1",
    ticketIds: ["t1"],
    receiptQueued: false,
    replayed: false,
  }));
  const cancelIntent = jest.fn<TapToPayServer["cancelIntent"]>(opts.cancelIntent ?? (async () => undefined));
  const flow = new TapToPaySaleFlow({
    eventId: "evt_u",
    draft: { lines: [{ ticketTypeId: "tt", quantity: 1 }], eventDateId: null, buyerPhone: null, phoneCountryIso: null },
    clientRequestId: "req-u1",
    terminal,
    server: { createIntent, completeIntent, cancelIntent },
    onState: (state) => states.push(state),
  });
  return { flow, states, terminal, createIntent, completeIntent, cancelIntent, collected, confirmed };
};

const saidNothingCharged = (states: TapSaleState[]): boolean =>
  states.some((s) => s.kind === "declined" || s.kind === "cancelled" || s.kind === "timed_out" ||
    (s.kind === "failed" && /Nothing was charged/.test(s.message)));

describe("#4271 tester: an unknown Tap to Pay result", () => {
  test("U1 no PaymentIntent back is unknown; Try again confirms the same intent once", async () => {
    const h = harness({ confirm: [{ error: { code: "STRIPE_API_CONNECTION_ERROR" } }, { paymentIntent: PI_SUCCEEDED }] });
    await h.flow.start();
    expect(h.flow.getState().kind).toBe("unknown_result");
    expect(saidNothingCharged(h.states)).toBe(false);
    expect(h.completeIntent).not.toHaveBeenCalled();

    await h.flow.retryConfirm();
    expect(h.flow.getState().kind).toBe("approved");
    expect(h.confirmed).toEqual(["pi_u1", "pi_u1"]);
    expect(h.collected).toEqual(["pi_u1"]);
    expect(h.createIntent).toHaveBeenCalledTimes(1);
    expect(h.completeIntent).toHaveBeenCalledTimes(1);
    expect(h.completeIntent).toHaveBeenCalledWith({ paymentIntentId: "pi_u1", clientRequestId: "req-u1" });
  });

  test("U2 a timed-out confirm is unknown even with a stale requires_payment_method snapshot", async () => {
    const h = harness({
      confirm: [{ error: { code: "REQUEST_TIMED_OUT", paymentIntent: { id: "pi_u1", status: "requires_payment_method" } } }],
    });
    await h.flow.start();
    expect(h.flow.getState().kind).toBe("unknown_result");
    expect(saidNothingCharged(h.states)).toBe(false);
  });

  test("U3 while unknown, an unconfirmed server cancel blocks the switch to a pay code", async () => {
    const h = harness({
      confirm: [{ error: { code: "STRIPE_API_CONNECTION_ERROR" } }],
      cancelIntent: async () => {
        throw new DoorTapError("network_error", "offline");
      },
    });
    await h.flow.start();
    expect(h.flow.getState().kind).toBe("unknown_result");
    expect(await h.flow.abandonForPayCode()).toBe("blocked");
    expect(h.completeIntent).not.toHaveBeenCalled();
  });

  test("U4 while unknown, a cancel that finds the payment succeeded records the sale, never a pay code", async () => {
    const h = harness({
      confirm: [{ error: { code: "STRIPE_API_CONNECTION_ERROR" } }],
      cancelIntent: async () => {
        throw new DoorTapError("payment_succeeded");
      },
    });
    await h.flow.start();
    expect(await h.flow.abandonForPayCode()).toBe("already_paid");
    expect(h.completeIntent).toHaveBeenCalledTimes(1);
    expect(h.flow.getState().kind).toBe("approved");
  });

  test("U5 a read that timed out is a timed-out end; the retry re-collects the same intent", async () => {
    const h = harness({ collect: [{ error: { code: "CARD_READ_TIMED_OUT" } }, { paymentIntent: PI_COLLECTED }] });
    await h.flow.start();
    expect(h.flow.getState().kind).toBe("timed_out");
    expect(h.terminal.confirmPaymentIntent).not.toHaveBeenCalled();
    await h.flow.tryAnotherCard();
    expect(h.flow.getState().kind).toBe("approved");
    expect(h.collected).toEqual(["pi_u1", "pi_u1"]);
    expect(h.createIntent).toHaveBeenCalledTimes(1);
  });
});
