/**
 * #4271 — Tap to Pay sale state machine (SDK and edge functions mocked).
 *
 * Pins: the call order (create → connect → retrieve → collect → confirm →
 * complete); `complete` only after confirm reports "succeeded"; one
 * clientRequestId reused on every server call; one PaymentIntent reused after a
 * decline; offline_pin_required → "needs PIN"; a lost `complete` is retried
 * with the same ids and never re-charges.
 *
 * fails-on-revert: calling complete before/without a succeeded confirm,
 * generating a new request id on retry, re-creating the intent on "Try another
 * card", or dropping the PIN classification fails an assertion here.
 */
import { describe, expect, jest, test } from "@jest/globals";

import {
  TapToPaySaleFlow,
  cardLabelFor,
  classifyTerminalError,
  type TapSaleState,
  type TapToPayServer,
  type TapToPayTerminalClient,
  type TerminalCallResult,
  type TerminalPaymentIntentLike,
} from "../tapToPayFlow";
import { DoorTapError, type DoorTapIntent } from "../doorTapEdge";
import { encodeTapToPayDraft, parseTapToPayDraft, type TapToPayDraft } from "../tapToPayDraft";

jest.mock("../../supabase", () => ({ supabase: { functions: { invoke: jest.fn() } } }));

const DRAFT: TapToPayDraft = {
  lines: [{ ticketTypeId: "tt_general", quantity: 2 }],
  eventDateId: "date_1",
  buyerPhone: "+447700900123",
  phoneCountryIso: "GB",
};

const INTENT: DoorTapIntent = {
  paymentIntentId: "pi_123",
  clientSecret: "pi_123_secret_abc",
  totalCents: 3000,
  currency: "GBP",
  stripeAccountId: "acct_1",
  locationId: "tml_1",
};

const PI_NEW = { id: "pi_123", status: "requires_payment_method" };
const PI_COLLECTED = { id: "pi_123", status: "requires_confirmation" };
const PI_SUCCEEDED = {
  id: "pi_123",
  status: "succeeded",
  paymentMethod: { cardPresentDetails: { brand: "visa", last4: "4242" } },
};

type Calls = string[];

const makeHarness = (overrides: {
  collect?: TerminalCallResult[];
  confirm?: TerminalCallResult[];
  createIntent?: TapToPayServer["createIntent"];
  completeIntent?: TapToPayServer["completeIntent"];
  connectError?: boolean;
} = {}) => {
  const calls: Calls = [];
  const states: TapSaleState[] = [];
  const collectQueue = [...(overrides.collect ?? [{ paymentIntent: PI_COLLECTED }])];
  const confirmQueue = [...(overrides.confirm ?? [{ paymentIntent: PI_SUCCEEDED }])];
  const terminal: TapToPayTerminalClient = {
    ensureReaderConnected: jest.fn(async (locationId: string) => {
      calls.push(`connect:${locationId}`);
      return overrides.connectError ? { error: { code: "TAP_TO_PAY_UNSUPPORTED_DEVICE" } } : {};
    }),
    retrievePaymentIntent: jest.fn(async (secret: string) => {
      calls.push(`retrieve:${secret}`);
      return { paymentIntent: PI_NEW };
    }),
    collectPaymentMethod: jest.fn(async (pi: TerminalPaymentIntentLike) => {
      calls.push(`collect:${pi.id}:${pi.status}`);
      return collectQueue.shift() ?? { paymentIntent: PI_COLLECTED };
    }),
    confirmPaymentIntent: jest.fn(async (pi: TerminalPaymentIntentLike) => {
      calls.push(`confirm:${pi.id}`);
      return confirmQueue.shift() ?? { paymentIntent: PI_SUCCEEDED };
    }),
    cancelCollectPaymentMethod: jest.fn(async () => {
      calls.push("cancel");
      return {};
    }),
  };
  const createIntent = jest.fn<TapToPayServer["createIntent"]>(
    overrides.createIntent ??
      (async (input) => {
        calls.push(`create:${input.clientRequestId}`);
        return INTENT;
      }),
  );
  const completeIntent = jest.fn<TapToPayServer["completeIntent"]>(
    overrides.completeIntent ??
      (async (input) => {
        calls.push(`complete:${input.paymentIntentId}:${input.clientRequestId}`);
        return { orderId: "ord_1", ticketIds: ["t1", "t2"], receiptQueued: true, replayed: false };
      }),
  );
  const flow = new TapToPaySaleFlow({
    eventId: "evt_1",
    draft: DRAFT,
    clientRequestId: "req-1",
    terminal,
    server: { createIntent, completeIntent, cancelIntent: jest.fn(async () => {}) },
    onState: (state) => states.push(state),
  });
  return { flow, calls, states, terminal, createIntent, completeIntent };
};

describe("happy path", () => {
  test("create → connect → retrieve → collect → confirm → complete, then approved", async () => {
    const h = makeHarness();
    await h.flow.start();
    expect(h.calls).toEqual([
      "create:req-1",
      "connect:tml_1",
      "retrieve:pi_123_secret_abc",
      "collect:pi_123:requires_payment_method",
      "confirm:pi_123",
      "complete:pi_123:req-1",
    ]);
    expect(h.states.map((s) => s.kind)).toEqual(["starting", "ready", "reading", "saving", "approved"]);
    const last = h.flow.getState();
    expect(last).toMatchObject({
      kind: "approved",
      amount: { totalCents: 3000, currency: "GBP" },
      cardLabel: "Visa contactless ending 4242",
      result: { orderId: "ord_1" },
    });
    expect(h.createIntent).toHaveBeenCalledWith({
      eventId: "evt_1",
      eventDateId: "date_1",
      lines: DRAFT.lines,
      clientRequestId: "req-1",
      buyerPhone: "+447700900123",
      phoneCountryIso: "GB",
    });
  });
});

describe("complete only after a succeeded confirm", () => {
  test("confirm error → declined, complete never called", async () => {
    const h = makeHarness({
      confirm: [{ error: { code: "DECLINED_BY_STRIPE_API", apiError: { declineCode: "insufficient_funds", code: "card_declined", message: "" } } }],
    });
    await h.flow.start();
    expect(h.flow.getState().kind).toBe("declined");
    expect(h.completeIntent).not.toHaveBeenCalled();
  });

  test("confirm returns a non-succeeded intent → declined, complete never called", async () => {
    const h = makeHarness({ confirm: [{ paymentIntent: { id: "pi_123", status: "requires_payment_method" } }] });
    await h.flow.start();
    expect(h.flow.getState().kind).toBe("declined");
    expect(h.completeIntent).not.toHaveBeenCalled();
  });

  test("collect error → no confirm, no complete", async () => {
    const h = makeHarness({ collect: [{ error: { code: "CANCELED" } }] });
    await h.flow.start();
    expect(h.flow.getState().kind).toBe("cancelled");
    expect(h.terminal.confirmPaymentIntent).not.toHaveBeenCalled();
    expect(h.completeIntent).not.toHaveBeenCalled();
  });
});

describe("needs PIN (offline_pin_required)", () => {
  test("a PIN-required decline shows needs_pin; Try another card reuses the same intent", async () => {
    const h = makeHarness({
      confirm: [
        {
          error: {
            code: "DECLINED_BY_STRIPE_API",
            apiError: { code: "card_declined", declineCode: "offline_pin_required", message: "" },
            paymentIntent: { id: "pi_123", status: "requires_payment_method" },
          },
        },
        { paymentIntent: PI_SUCCEEDED },
      ],
    });
    await h.flow.start();
    expect(h.flow.getState().kind).toBe("needs_pin");
    expect(h.completeIntent).not.toHaveBeenCalled();

    await h.flow.tryAnotherCard();
    expect(h.flow.getState().kind).toBe("approved");
    // One intent, one retrieve: the decline re-collects on the SAME PaymentIntent.
    expect(h.createIntent).toHaveBeenCalledTimes(1);
    expect(h.terminal.retrievePaymentIntent).toHaveBeenCalledTimes(1);
    expect(h.terminal.collectPaymentMethod).toHaveBeenCalledTimes(2);
    expect(h.completeIntent).toHaveBeenCalledTimes(1);
  });

  test("classifier recognises every PIN-required signal", () => {
    expect(classifyTerminalError({ apiError: { declineCode: "offline_pin_required" } })).toBe("needs_pin");
    expect(classifyTerminalError({ message: "Declined: online_or_offline_pin_required" })).toBe("needs_pin");
    expect(classifyTerminalError({ code: "DECLINED_BY_READER" })).toBe("declined");
    expect(classifyTerminalError({ code: "TAP_TO_PAY_UNSUPPORTED_DEVICE" })).toBe("not_on_this_phone");
    expect(classifyTerminalError({ code: "CANCELED" })).toBe("cancelled");
    expect(classifyTerminalError({ code: "STRIPE_API_CONNECTION_ERROR" })).toBe("failed");
  });
});

describe("idempotent clientRequestId", () => {
  test("a failed create is retried with the SAME clientRequestId", async () => {
    let attempt = 0;
    const seen: string[] = [];
    const h = makeHarness({
      createIntent: async (input) => {
        seen.push(input.clientRequestId);
        attempt += 1;
        if (attempt === 1) throw new DoorTapError("network_error", "offline");
        return INTENT;
      },
    });
    await h.flow.start();
    expect(h.flow.getState().kind).toBe("failed");
    await h.flow.start();
    expect(h.flow.getState().kind).toBe("approved");
    expect(seen).toEqual(["req-1", "req-1"]);
  });

  test("a lost complete is retried with the same ids and never re-collects", async () => {
    let attempt = 0;
    const seen: string[] = [];
    const h = makeHarness({
      completeIntent: async (input) => {
        seen.push(`${input.paymentIntentId}:${input.clientRequestId}`);
        attempt += 1;
        if (attempt === 1) throw new DoorTapError("network_error", "offline");
        return { orderId: "ord_1", ticketIds: [], receiptQueued: false, replayed: true };
      },
    });
    await h.flow.start();
    expect(h.flow.getState()).toMatchObject({ kind: "save_failed" });
    await h.flow.retrySave();
    expect(h.flow.getState().kind).toBe("approved");
    expect(seen).toEqual(["pi_123:req-1", "pi_123:req-1"]);
    expect(h.terminal.collectPaymentMethod).toHaveBeenCalledTimes(1);
    expect(h.terminal.confirmPaymentIntent).toHaveBeenCalledTimes(1);
  });

  test("start() after a succeeded payment only re-completes", async () => {
    let attempt = 0;
    const h = makeHarness({
      completeIntent: async () => {
        attempt += 1;
        if (attempt === 1) throw new DoorTapError("unknown");
        return { orderId: "ord_1", ticketIds: [], receiptQueued: false, replayed: true };
      },
    });
    await h.flow.start();
    await h.flow.start();
    expect(h.flow.getState().kind).toBe("approved");
    expect(h.createIntent).toHaveBeenCalledTimes(1);
    expect(h.terminal.collectPaymentMethod).toHaveBeenCalledTimes(1);
  });
});

describe("not on this phone", () => {
  test("server tap_not_available → not_on_this_phone, reader never touched", async () => {
    const h = makeHarness({
      createIntent: async () => {
        throw new DoorTapError("tap_not_available");
      },
    });
    await h.flow.start();
    expect(h.flow.getState().kind).toBe("not_on_this_phone");
    expect(h.terminal.ensureReaderConnected).not.toHaveBeenCalled();
  });

  test("reader connect device error → not_on_this_phone, nothing collected", async () => {
    const h = makeHarness({ connectError: true });
    await h.flow.start();
    expect(h.flow.getState().kind).toBe("not_on_this_phone");
    expect(h.terminal.collectPaymentMethod).not.toHaveBeenCalled();
    expect(h.completeIntent).not.toHaveBeenCalled();
  });
});

describe("draft + card label helpers", () => {
  test("draft round-trips and rejects malformed input", () => {
    const encoded = encodeTapToPayDraft(DRAFT);
    expect(parseTapToPayDraft(encoded)).toEqual(DRAFT);
    expect(parseTapToPayDraft(encodeURIComponent(encoded))).toEqual(DRAFT);
    const minimal = Buffer.from(JSON.stringify({ lines: [{ ticketTypeId: "a", quantity: 1 }], eventDateId: null })).toString("base64");
    expect(parseTapToPayDraft(minimal)).toEqual({
      lines: [{ ticketTypeId: "a", quantity: 1 }],
      eventDateId: null,
      buyerPhone: null,
      phoneCountryIso: null,
    });
    for (const bad of ["", "%%%", Buffer.from("{}").toString("base64"), Buffer.from(JSON.stringify({ lines: [{ ticketTypeId: "a", quantity: 0 }] })).toString("base64")]) {
      expect(parseTapToPayDraft(bad)).toBeNull();
    }
  });

  test("card label is shown only when the SDK gave card details", () => {
    expect(cardLabelFor(PI_SUCCEEDED)).toBe("Visa contactless ending 4242");
    expect(cardLabelFor({ id: "pi", status: "succeeded" })).toBeNull();
  });
});
