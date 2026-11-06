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

import * as fs from "fs";
import * as path from "path";

import {
  TAP_READY_LIMIT_MS,
  TAP_REPLACE_FAILED_MESSAGE,
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
      confirm: [{ error: { code: "DECLINED_BY_STRIPE_API", paymentIntent: { status: "requires_payment_method" }, apiError: { declineCode: "insufficient_funds", code: "card_declined", message: "" } } }],
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

  test.each(["processing", "requires_capture", "requires_confirmation"])(
    "final P2-2: confirm returns a %s intent with no error → unknown_result, never declined, same intent retried",
    async (status) => {
      const h = makeHarness({
        confirm: [{ paymentIntent: { id: "pi_123", status } }, { paymentIntent: PI_SUCCEEDED }],
      });
      await h.flow.start();
      expect(h.flow.getState().kind).toBe("unknown_result");
      expect(h.completeIntent).not.toHaveBeenCalled();
      await h.flow.retryConfirm();
      expect(h.flow.getState().kind).toBe("approved");
      expect(h.createIntent).toHaveBeenCalledTimes(1);
      expect(h.terminal.confirmPaymentIntent).toHaveBeenCalledTimes(2);
    },
  );

  test("final P2-2: a processing intent behind a PIN-looking error is unknown, not needs_pin", async () => {
    const h = makeHarness({
      confirm: [
        {
          error: {
            code: "DECLINED_BY_STRIPE_API",
            apiError: { code: "card_declined", declineCode: "offline_pin_required", message: "" },
            paymentIntent: { id: "pi_123", status: "processing" },
          },
        },
      ],
    });
    await h.flow.start();
    expect(h.flow.getState().kind).toBe("unknown_result");
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

describe("final P3: a ready screen is never swept while the host is on it", () => {
  test("the flow stops waiting after TAP_READY_LIMIT_MS and shows cancelled, before the server sweep reads it", async () => {
    jest.useFakeTimers();
    try {
      const h = makeHarness();
      let resolveCollect: (result: TerminalCallResult) => void = () => undefined;
      jest.mocked(h.terminal.collectPaymentMethod).mockImplementation(
        () => new Promise<TerminalCallResult>((resolve) => {
          resolveCollect = resolve;
        }),
      );
      jest.mocked(h.terminal.cancelCollectPaymentMethod).mockImplementation(async () => {
        resolveCollect({ error: { code: "CANCELED" } });
        return {};
      });
      const started = h.flow.start();
      for (let i = 0; i < 20; i += 1) await Promise.resolve();
      expect(h.flow.getState().kind).toBe("ready");
      jest.advanceTimersByTime(TAP_READY_LIMIT_MS - 1);
      expect(h.terminal.cancelCollectPaymentMethod).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1);
      await started;
      expect(h.terminal.cancelCollectPaymentMethod).toHaveBeenCalledTimes(1);
      expect(h.flow.getState().kind).toBe("cancelled");
    } finally {
      jest.useRealTimers();
    }
  });

  test("the server sweep waits longer than the app's ready limit", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../../../../../supabase/functions/door-tap-intent/index.ts"),
      "utf8",
    );
    const match = /export const UNFINISHED_AFTER_MS = (\d+) \* 60 \* 1000;/.exec(source);
    expect(match).not.toBeNull();
    const sweepAfterMs = Number(match?.[1]) * 60 * 1000;
    // A margin of at least 5 minutes: the sweep runs every 5 minutes.
    expect(sweepAfterMs - TAP_READY_LIMIT_MS).toBeGreaterThanOrEqual(5 * 60 * 1000);
  });
});

describe("retest 2 P3-2: retries never keep a ready screen on an intent older than the limit", () => {
  const MIN = 60 * 1000;
  const SWEEP_AFTER_MS = 15 * MIN;

  /** Tap flow whose collect waits for the test; intents are stamped with their creation time. */
  const staleHarness = (cancelIntent: TapToPayServer["cancelIntent"] = async () => undefined) => {
    const createdAt = new Map<string, number>();
    const readyAges: number[] = [];
    const requestIds: string[] = [];
    let current: string | null = null;
    let pending: ((result: TerminalCallResult) => void) | null = null;
    let made = 0;
    const terminal: TapToPayTerminalClient = {
      ensureReaderConnected: jest.fn(async () => ({})),
      retrievePaymentIntent: jest.fn(async (secret: string) => ({
        paymentIntent: { id: secret.replace(/_secret$/, ""), status: "requires_payment_method" },
      })),
      collectPaymentMethod: jest.fn(
        () => new Promise<TerminalCallResult>((resolve) => {
          pending = resolve;
        }),
      ),
      confirmPaymentIntent: jest.fn(async (pi: TerminalPaymentIntentLike) => ({
        paymentIntent: { ...pi, status: "succeeded" },
      })),
      cancelCollectPaymentMethod: jest.fn(async () => {
        pending?.({ error: { code: "CANCELED" } });
        pending = null;
        return {};
      }),
    };
    const createIntent = jest.fn<TapToPayServer["createIntent"]>(async (input) => {
      requestIds.push(input.clientRequestId);
      made += 1;
      const id = `pi_${made}`;
      createdAt.set(id, Date.now());
      current = id;
      return { ...INTENT, paymentIntentId: id, clientSecret: `${id}_secret` };
    });
    const cancel = jest.fn<TapToPayServer["cancelIntent"]>(cancelIntent);
    const completeIntent = jest.fn<TapToPayServer["completeIntent"]>(async () => ({
      orderId: "ord_1",
      ticketIds: ["t1"],
      receiptQueued: true,
      replayed: false,
    }));
    const flow = new TapToPaySaleFlow({
      eventId: "evt_1",
      draft: DRAFT,
      clientRequestId: "req-1",
      terminal,
      server: { createIntent, completeIntent, cancelIntent: cancel },
      onState: (state) => {
        if (state.kind === "ready" && current !== null) {
          readyAges.push(Date.now() - (createdAt.get(current) ?? Date.now()));
        }
      },
    });
    const decline = (): void => {
      pending?.({ error: { code: "DECLINED_BY_STRIPE_API" } });
      pending = null;
    };
    const flush = async (): Promise<void> => {
      for (let i = 0; i < 30; i += 1) await Promise.resolve();
    };
    return { flow, terminal, createIntent, cancel, completeIntent, readyAges, requestIds, decline, flush, intentAge: () => (current === null ? 0 : Date.now() - (createdAt.get(current) ?? 0)) };
  };

  test("the retester's 17-minute repro: decline at 9, another card, Try again at 17 -> a fresh intent, never a stale ready", async () => {
    jest.useFakeTimers();
    try {
      const h = staleHarness();
      void h.flow.start();
      await h.flush();
      expect(h.flow.getState().kind).toBe("ready");

      // Minute 9: declined, host tries another card on the same intent.
      jest.advanceTimersByTime(9 * MIN);
      h.decline();
      await h.flush();
      expect(h.flow.getState().kind).toBe("declined");
      void h.flow.tryAnotherCard();
      await h.flush();
      expect(h.flow.getState().kind).toBe("ready");

      // The limit counts from the intent's creation: it fires at minute 10, not 19.
      jest.advanceTimersByTime(MIN - 1);
      await h.flush();
      expect(h.terminal.cancelCollectPaymentMethod).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1);
      await h.flush();
      expect(h.terminal.cancelCollectPaymentMethod).toHaveBeenCalledTimes(1);
      expect(h.flow.getState().kind).toBe("cancelled");

      // Minute 17: "Try again" cancels the old intent and makes a fresh one.
      jest.advanceTimersByTime(7 * MIN);
      void h.flow.tryAnotherCard();
      await h.flush();
      expect(h.cancel).toHaveBeenCalledWith({ paymentIntentId: "pi_1", clientRequestId: "req-1" });
      expect(h.createIntent).toHaveBeenCalledTimes(2);
      expect(h.requestIds[1]).not.toBe("req-1");
      expect(h.flow.getReceiptFacts()).toEqual(
        expect.objectContaining({ paymentIntentId: "pi_2", clientRequestId: h.requestIds[1] }),
      );
      expect(h.flow.getState().kind).toBe("ready");

      // The fresh intent gets its own full window, and still stops before its sweep.
      jest.advanceTimersByTime(TAP_READY_LIMIT_MS);
      await h.flush();
      expect(h.flow.getState().kind).toBe("cancelled");
      expect(h.intentAge()).toBeLessThan(SWEEP_AFTER_MS);

      // Every ready screen was on an intent younger than the limit.
      expect(h.readyAges.length).toBe(3);
      for (const age of h.readyAges) expect(age).toBeLessThan(TAP_READY_LIMIT_MS);
    } finally {
      jest.useRealTimers();
    }
  });

  test("a stale intent Stripe already charged is recorded, never replaced", async () => {
    jest.useFakeTimers();
    try {
      const h = staleHarness(async () => {
        throw new DoorTapError("payment_succeeded", "already paid");
      });
      void h.flow.start();
      await h.flush();
      jest.advanceTimersByTime(TAP_READY_LIMIT_MS);
      await h.flush();
      expect(h.flow.getState().kind).toBe("cancelled");
      void h.flow.tryAnotherCard();
      await h.flush();
      expect(h.createIntent).toHaveBeenCalledTimes(1);
      expect(h.completeIntent).toHaveBeenCalledWith({ paymentIntentId: "pi_1", clientRequestId: "req-1" });
      expect(h.flow.getState().kind).toBe("approved");
    } finally {
      jest.useRealTimers();
    }
  });

  test("a stale intent whose cancel didn't land is not replaced: the host is asked to try again", async () => {
    jest.useFakeTimers();
    try {
      const h = staleHarness(async () => {
        throw new DoorTapError("server_error", "down");
      });
      void h.flow.start();
      await h.flush();
      jest.advanceTimersByTime(TAP_READY_LIMIT_MS);
      await h.flush();
      void h.flow.tryAnotherCard();
      await h.flush();
      expect(h.createIntent).toHaveBeenCalledTimes(1);
      expect(h.terminal.collectPaymentMethod).toHaveBeenCalledTimes(1);
      expect(h.flow.getState().kind).toBe("failed");
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("retest 3 P2-1: nothing collects after the sale is closed", () => {
  type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void };
  const deferred = <T,>(): Deferred<T> => {
    let resolve: (v: T) => void = () => undefined;
    let reject: (e: unknown) => void = () => undefined;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 40; i += 1) await Promise.resolve();
  };

  /** Server calls can be held open by the test; every call is logged in order. */
  const closeHarness = () => {
    const log: string[] = [];
    let made = 0;
    let pendingCollect: ((r: TerminalCallResult) => void) | null = null;
    const holdCreate: Deferred<void>[] = [];
    const holdCancel: Deferred<void>[] = [];
    let cancelError: unknown = null;
    const paidAfterClose: { saved: boolean }[] = [];
    const terminal: TapToPayTerminalClient = {
      ensureReaderConnected: jest.fn(async () => ({})),
      retrievePaymentIntent: jest.fn(async (secret: string) => ({
        paymentIntent: { id: secret.replace(/_secret$/, ""), status: "requires_payment_method" },
      })),
      collectPaymentMethod: jest.fn((pi: TerminalPaymentIntentLike) => {
        log.push(`collect:${pi.id}`);
        return new Promise<TerminalCallResult>((resolve) => {
          pendingCollect = resolve;
        });
      }),
      confirmPaymentIntent: jest.fn(async (pi: TerminalPaymentIntentLike) => ({ paymentIntent: { ...pi, status: "succeeded" } })),
      cancelCollectPaymentMethod: jest.fn(async () => {
        log.push("cancelCollect");
        pendingCollect?.({ error: { code: "CANCELED" } });
        pendingCollect = null;
        return {};
      }),
    };
    const createIntent = jest.fn<TapToPayServer["createIntent"]>(async () => {
      made += 1;
      const id = `pi_${made}`;
      const hold = holdCreate.shift();
      if (hold) await hold.promise;
      log.push(`create:${id}`);
      return { ...INTENT, paymentIntentId: id, clientSecret: `${id}_secret` };
    });
    const cancelIntent = jest.fn<TapToPayServer["cancelIntent"]>(async (input) => {
      const hold = holdCancel.shift();
      if (hold) await hold.promise;
      log.push(`cancel:${input.paymentIntentId}`);
      if (cancelError !== null) throw cancelError;
    });
    const completeIntent = jest.fn<TapToPayServer["completeIntent"]>(async (input) => {
      log.push(`complete:${input.paymentIntentId}`);
      return { orderId: "ord_1", ticketIds: ["t1"], receiptQueued: true, replayed: false };
    });
    const flow = new TapToPaySaleFlow({
      eventId: "evt_1",
      draft: DRAFT,
      clientRequestId: "req-1",
      terminal,
      server: { createIntent, completeIntent, cancelIntent },
      onState: () => undefined,
      onPaidAfterClose: ({ saved }) => paidAfterClose.push({ saved }),
    });
    const decline = (): void => {
      pendingCollect?.({ error: { code: "DECLINED_BY_STRIPE_API" } });
      pendingCollect = null;
    };
    return {
      flow, log, terminal, createIntent, cancelIntent, completeIntent, paidAfterClose, decline,
      holdNextCreate: () => { const d = deferred<void>(); holdCreate.push(d); return d; },
      holdNextCancel: () => { const d = deferred<void>(); holdCancel.push(d); return d; },
      failCancelWith: (error: unknown) => { cancelError = error; },
    };
  };
  const collectsAfter = (log: string[], marker: number): string[] => log.slice(marker).filter((l) => l.startsWith("collect:"));
  const createdIds = (log: string[]): string[] => log.filter((l) => l.startsWith("create:")).map((l) => l.slice(7));
  const cancelledIds = (log: string[]): string[] => log.filter((l) => l.startsWith("cancel:")).map((l) => l.slice(7));

  test("(a) close during the first create: the intent that arrives is cancelled and never collected", async () => {
    const h = closeHarness();
    const create = h.holdNextCreate();
    void h.flow.start();
    await flush();
    await h.flow.closeSale();
    const marker = h.log.length;
    create.resolve();
    await flush();
    expect(createdIds(h.log)).toEqual(["pi_1"]);
    expect(collectsAfter(h.log, marker)).toEqual([]);
    expect(h.terminal.collectPaymentMethod).not.toHaveBeenCalled();
    expect(cancelledIds(h.log)).toEqual(["pi_1"]);
  });

  test("(b) close while a stale intent's cancel is in flight: no replacement is made or collected", async () => {
    jest.useFakeTimers();
    try {
      const h = closeHarness();
      void h.flow.start();
      await flush();
      jest.advanceTimersByTime(TAP_READY_LIMIT_MS);
      await flush();
      expect(h.flow.getState().kind).toBe("cancelled");
      const cancel = h.holdNextCancel();
      void h.flow.tryAnotherCard();
      await flush();
      await h.flow.closeSale();
      const marker = h.log.length;
      cancel.resolve();
      await flush();
      expect(collectsAfter(h.log, marker)).toEqual([]);
      // Every intent that exists is cancelled; none is left live.
      for (const id of createdIds(h.log)) expect(cancelledIds(h.log)).toContain(id);
      expect(h.terminal.collectPaymentMethod).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  test("(b2) close while the replacement's create is in flight: the new intent is cancelled, never collected", async () => {
    jest.useFakeTimers();
    try {
      const h = closeHarness();
      void h.flow.start();
      await flush();
      jest.advanceTimersByTime(TAP_READY_LIMIT_MS);
      await flush();
      const create = h.holdNextCreate();
      void h.flow.tryAnotherCard();
      await flush();
      expect(h.log).toContain("cancel:pi_1");
      await h.flow.closeSale();
      const marker = h.log.length;
      create.resolve();
      await flush();
      expect(createdIds(h.log)).toEqual(["pi_1", "pi_2"]);
      expect(collectsAfter(h.log, marker)).toEqual([]);
      expect(cancelledIds(h.log)).toContain("pi_2");
      expect(h.terminal.collectPaymentMethod).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  test("(c) close during try another card: the tap stops, the intent is cancelled, nothing collects again", async () => {
    const h = closeHarness();
    void h.flow.start();
    await flush();
    h.decline();
    await flush();
    expect(h.flow.getState().kind).toBe("declined");
    void h.flow.tryAnotherCard();
    await flush();
    expect(h.flow.getState().kind).toBe("ready");
    await h.flow.closeSale();
    await flush();
    const marker = h.log.length;
    expect(h.log).toContain("cancelCollect");
    expect(cancelledIds(h.log)).toEqual(["pi_1"]);
    await h.flow.tryAnotherCard();
    await h.flow.start();
    await flush();
    expect(collectsAfter(h.log, marker)).toEqual([]);
    expect(h.createIntent).toHaveBeenCalledTimes(1);
  });

  test("an intent that arrives after close and is already paid is recorded, and the host is told", async () => {
    const h = closeHarness();
    const create = h.holdNextCreate();
    void h.flow.start();
    await flush();
    await h.flow.closeSale();
    h.failCancelWith(new DoorTapError("payment_succeeded", "paid"));
    create.resolve();
    await flush();
    expect(h.completeIntent).toHaveBeenCalledWith({ paymentIntentId: "pi_1", clientRequestId: "req-1" });
    expect(h.paidAfterClose).toEqual([{ saved: true }]);
    expect(h.terminal.collectPaymentMethod).not.toHaveBeenCalled();
  });

  test("a pay code that couldn't be made reopens the tap on a fresh intent", async () => {
    const h = closeHarness();
    void h.flow.start();
    await flush();
    h.decline();
    await flush();
    expect(await h.flow.abandonForPayCode()).toBe("switch");
    await h.flow.tryAnotherCard();
    expect(h.terminal.collectPaymentMethod).toHaveBeenCalledTimes(1);
    h.flow.reopen();
    void h.flow.tryAnotherCard();
    await flush();
    expect(createdIds(h.log)).toEqual(["pi_1", "pi_2"]);
    expect(h.log[h.log.length - 1]).toBe("collect:pi_2");
    expect(h.flow.getReceiptFacts().clientRequestId).not.toBe("req-1");
  });
});

describe("retest 3 P3-1/P3-2: the intent's age counts sleep and late creates", () => {
  const MIN = 60 * 1000;
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 40; i += 1) await Promise.resolve();
  };
  /** createdAt per intent (wall clock, as the server stamps created_at); ready ages logged. */
  const ageHarness = (opts: { createFails?: (n: number) => unknown; replayFirst?: boolean } = {}) => {
    const createdAt = new Map<string, number>();
    const readyAges: { pi: string; age: number }[] = [];
    const log: string[] = [];
    let current: string | null = null;
    let pending: ((r: TerminalCallResult) => void) | null = null;
    let calls = 0;
    let made = 0;
    const terminal: TapToPayTerminalClient = {
      ensureReaderConnected: jest.fn(async () => ({})),
      retrievePaymentIntent: jest.fn(async (secret: string) => ({
        paymentIntent: { id: secret.replace(/_secret$/, ""), status: "requires_payment_method" },
      })),
      collectPaymentMethod: jest.fn((pi: TerminalPaymentIntentLike) => {
        log.push(`collect:${pi.id}`);
        return new Promise<TerminalCallResult>((resolve) => {
          pending = resolve;
        });
      }),
      confirmPaymentIntent: jest.fn(async (pi: TerminalPaymentIntentLike) => ({ paymentIntent: { ...pi, status: "succeeded" } })),
      cancelCollectPaymentMethod: jest.fn(async () => {
        pending?.({ error: { code: "CANCELED" } });
        pending = null;
        return {};
      }),
    };
    const byRequest = new Map<string, string>();
    const createIntent = jest.fn<TapToPayServer["createIntent"]>(async (input) => {
      calls += 1;
      const failure = opts.createFails?.(calls);
      // A replayed request id gets the intent its first call made (lost response).
      let id = byRequest.get(input.clientRequestId);
      if (id === undefined && !(failure !== undefined && !opts.replayFirst)) {
        made += 1;
        id = `pi_${made}`;
        byRequest.set(input.clientRequestId, id);
        createdAt.set(id, Date.now());
      }
      if (failure !== undefined) throw failure;
      if (id === undefined) throw new Error("unreachable");
      log.push(`create:${id}`);
      current = id;
      return { ...INTENT, paymentIntentId: id, clientSecret: `${id}_secret` };
    });
    const cancelIntent = jest.fn<TapToPayServer["cancelIntent"]>(async (input) => {
      log.push(`cancel:${input.paymentIntentId}`);
    });
    const flow = new TapToPaySaleFlow({
      eventId: "evt_1",
      draft: DRAFT,
      clientRequestId: "req-1",
      terminal,
      server: { createIntent, completeIntent: jest.fn(async () => ({ orderId: "o", ticketIds: [], receiptQueued: false, replayed: false })), cancelIntent },
      onState: (state) => {
        if (state.kind === "ready" && current !== null) {
          readyAges.push({ pi: current, age: Date.now() - (createdAt.get(current) ?? Date.now()) });
        }
      },
    });
    const decline = (): void => {
      pending?.({ error: { code: "DECLINED_BY_STRIPE_API" } });
      pending = null;
    };
    return { flow, log, readyAges, decline, createIntent, cancelIntent, terminal };
  };

  test("P3-1 the phone sleeps 20 minutes (wall clock moves, monotonic doesn't): another card makes a fresh intent", async () => {
    jest.useFakeTimers();
    try {
      const h = ageHarness();
      void h.flow.start();
      await flush();
      jest.advanceTimersByTime(2 * MIN);
      h.decline();
      await flush();
      expect(h.flow.getState().kind).toBe("declined");
      const perfBefore = performance.now();
      jest.setSystemTime(Date.now() + 20 * MIN); // sleep: Date moves, performance.now does not
      expect(performance.now()).toBe(perfBefore);
      void h.flow.tryAnotherCard();
      await flush();
      expect(h.log).toContain("cancel:pi_1");
      expect(h.log.filter((l) => l.startsWith("create:"))).toEqual(["create:pi_1", "create:pi_2"]);
      expect(h.flow.getState().kind).toBe("ready");
      for (const { age } of h.readyAges) expect(age).toBeLessThan(TAP_READY_LIMIT_MS);
    } finally {
      jest.useRealTimers();
    }
  });

  test("P3-1 a wall clock moved back does not stretch the limit: monotonic time still counts", async () => {
    jest.useFakeTimers();
    try {
      const h = ageHarness();
      void h.flow.start();
      await flush();
      jest.setSystemTime(Date.now() - 60 * MIN);
      jest.advanceTimersByTime(TAP_READY_LIMIT_MS);
      await flush();
      expect(h.flow.getState().kind).toBe("cancelled");
    } finally {
      jest.useRealTimers();
    }
  });

  test("P3-2 a create whose answer was lost, retried at 11 minutes: no ready on the stale intent, one collect on a fresh one", async () => {
    jest.useFakeTimers();
    try {
      // The first call makes pi_1 on the server but its answer is lost.
      const h = ageHarness({ createFails: (n) => (n === 1 ? new DoorTapError("network_error", "lost") : undefined), replayFirst: true });
      void h.flow.start();
      await flush();
      expect(h.flow.getState().kind).toBe("failed");
      jest.advanceTimersByTime(11 * MIN);
      void h.flow.start();
      await flush();
      // The replay handed back pi_1 (11 minutes old): replaced before any ready or collect.
      expect(h.log).toEqual(["create:pi_1", "cancel:pi_1", "create:pi_2", "collect:pi_2"]);
      expect(h.readyAges).toEqual([{ pi: "pi_2", age: 0 }]);
      expect(h.flow.getState().kind).toBe("ready");
    } finally {
      jest.useRealTimers();
    }
  });

  test("P3-2 a create the server refused, retried 12 minutes later: the new intent gets its own window, no false cancel", async () => {
    jest.useFakeTimers();
    try {
      const h = ageHarness({ createFails: (n) => (n === 1 ? new DoorTapError("buyer_phone_invalid", "bad phone") : undefined) });
      void h.flow.start();
      await flush();
      expect(h.flow.getState().kind).toBe("failed");
      jest.advanceTimersByTime(12 * MIN);
      void h.flow.start();
      await flush();
      expect(h.log).toEqual(["create:pi_1", "collect:pi_1"]);
      expect(h.cancelIntent).not.toHaveBeenCalled();
      jest.advanceTimersByTime(TAP_READY_LIMIT_MS - 1);
      await flush();
      expect(h.flow.getState().kind).toBe("ready");
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("retest 3 P4: honest copy when a replacement can't cancel, and a swept intent reads cancelled", () => {
  test("a stale intent whose cancel failed never tells the host nothing was charged", async () => {
    jest.useFakeTimers();
    try {
      const h = makeHarness({ collect: [{ error: { code: "CANCELED" } }] });
      const states: TapSaleState[] = [];
      const flow = new TapToPaySaleFlow({
        eventId: "evt_1",
        draft: DRAFT,
        clientRequestId: "req-1",
        terminal: h.terminal,
        server: {
          createIntent: h.createIntent,
          completeIntent: h.completeIntent,
          cancelIntent: jest.fn(async () => {
            throw new DoorTapError("network_error", "offline");
          }),
        },
        onState: (state) => states.push(state),
      });
      await flow.start();
      expect(flow.getState().kind).toBe("cancelled");
      jest.advanceTimersByTime(TAP_READY_LIMIT_MS);
      await flow.tryAnotherCard();
      const state = flow.getState();
      expect(state).toEqual({ kind: "failed", message: TAP_REPLACE_FAILED_MESSAGE });
      expect(TAP_REPLACE_FAILED_MESSAGE).not.toMatch(/nothing was charged/i);
      expect(h.createIntent).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  test("Stripe says the intent was canceled at confirm: cancelled, not unknown; Try again makes a fresh intent", async () => {
    const h = makeHarness({
      confirm: [{ error: { code: "UNEXPECTED_SDK_ERROR", paymentIntent: { id: "pi_123", status: "canceled" } } }],
    });
    await h.flow.start();
    expect(h.flow.getState().kind).toBe("cancelled");
    await h.flow.tryAnotherCard();
    expect(h.createIntent).toHaveBeenCalledTimes(2);
    const ids = h.createIntent.mock.calls.map(([input]) => input.clientRequestId);
    expect(ids[0]).toBe("req-1");
    expect(ids[1]).not.toBe("req-1");
    expect(h.flow.getState().kind).toBe("approved");
  });

  test("a confirm that answers with a canceled intent reads cancelled too", async () => {
    const h = makeHarness({ confirm: [{ paymentIntent: { id: "pi_123", status: "canceled" } }] });
    await h.flow.start();
    expect(h.flow.getState().kind).toBe("cancelled");
    expect(h.completeIntent).not.toHaveBeenCalled();
  });
});

describe("retest 4 P3-B: no pay code while a card is being read or saved", () => {
  test("a pay code pressed during reading is refused, and the charge is still recorded", async () => {
    let finishConfirm: (r: TerminalCallResult) => void = () => undefined;
    const h = makeHarness();
    jest.mocked(h.terminal.confirmPaymentIntent).mockImplementation(
      () => new Promise<TerminalCallResult>((resolve) => {
        finishConfirm = resolve;
      }),
    );
    const started = h.flow.start();
    for (let i = 0; i < 30; i += 1) await Promise.resolve();
    expect(h.flow.getState().kind).toBe("reading");
    expect(await h.flow.abandonForPayCode()).toBe("blocked");
    finishConfirm({ paymentIntent: PI_SUCCEEDED });
    await started;
    expect(h.flow.getState().kind).toBe("approved");
    expect(h.completeIntent).toHaveBeenCalledTimes(1);
  });
});
