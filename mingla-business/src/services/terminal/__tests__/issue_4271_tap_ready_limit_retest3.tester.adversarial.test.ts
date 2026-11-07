/**
 * #4271 retest 3 — adversarial: the ready limit counts from the intent's
 * creation (fix for retest 2 P3-2, c986781282).
 *
 * A different angle from the builder's three named cases. The fake server
 * here behaves like door-tap-intent: a create replays the same PaymentIntent
 * for the same clientRequestId, a cancel is refused unless the request id
 * matches the intent's, and an intent Stripe has charged can't be cancelled.
 *   R1 any number of retries (declines and timer cancels for 40 minutes): every
 *      ready screen is on an intent younger than the limit, every ready window
 *      ends before the intent is 10 minutes old (so never at the 15-minute
 *      sweep), each new intent is made only after the old one is cancelled on
 *      the server, every intent has its own request id, and the final tap is
 *      charged and recorded once, on the newest intent only.
 *   R2 "Try again" one millisecond before the limit stays on the same intent
 *      and the screen stops one millisecond later; exactly at the limit it is a
 *      fresh intent.
 *   R3 a create whose answer was lost and is replayed later keeps the first
 *      call's clock: the ready limit fires 10 minutes after the first create,
 *      not 10 minutes after the replay.
 *   R4 after a replacement, "Show a pay code" cancels the NEW intent with the
 *      NEW request id (the server accepts it), receipts name the new intent, and
 *      the old intent is never confirmed or recorded.
 *
 * fails-on-revert (retest 3, at f14d9806e8): tapToPayFlow.ts back to
 * 3f2df04d57 (timer re-armed per ready window, one request id) -> R1, R2, R3,
 * R4 fail.
 */
import { describe, expect, jest, test } from "@jest/globals";

import {
  TAP_READY_LIMIT_MS,
  TapToPaySaleFlow,
  type TapSaleState,
  type TapToPayServer,
  type TapToPayTerminalClient,
  type TerminalCallResult,
  type TerminalPaymentIntentLike,
} from "../tapToPayFlow";
import { DoorTapError, type DoorTapIntent } from "../doorTapEdge";
import type { TapToPayDraft } from "../tapToPayDraft";

jest.mock("../../supabase", () => ({ supabase: { functions: { invoke: jest.fn() } } }));

const MIN = 60 * 1000;
const SWEEP_AFTER_MS = 15 * MIN;

const DRAFT: TapToPayDraft = {
  lines: [{ ticketTypeId: "tt_general", quantity: 1 }],
  eventDateId: "date_1",
  buyerPhone: null,
  phoneCountryIso: null,
} as unknown as TapToPayDraft;

type ServerIntent = { requestId: string; createdAt: number; status: "open" | "canceled" | "succeeded" };

const harness = (opts: { loseFirstCreateAnswer?: boolean } = {}) => {
  const intents = new Map<string, ServerIntent>();
  const byRequest = new Map<string, string>();
  const log: string[] = [];
  const readyAges: { pi: string; age: number }[] = [];
  const states: TapSaleState[] = [];
  const windowEndAges: number[] = [];
  let made = 0;
  let current: string | null = null;
  let lostOnce = opts.loseFirstCreateAnswer === true;
  let pending: ((result: TerminalCallResult) => void) | null = null;

  const createIntent = jest.fn<TapToPayServer["createIntent"]>(async (input) => {
    let id = byRequest.get(input.clientRequestId);
    if (id === undefined) {
      made += 1;
      id = `pi_${made}`;
      intents.set(id, { requestId: input.clientRequestId, createdAt: Date.now(), status: "open" });
      byRequest.set(input.clientRequestId, id);
      // No two intents of one sale may be open at once.
      const open = [...intents.values()].filter((row) => row.status === "open");
      log.push(`create:${id}:open=${open.length}`);
    } else {
      log.push(`replay:${id}`);
    }
    if (lostOnce) {
      lostOnce = false;
      throw new DoorTapError("network_error", "answer lost");
    }
    current = id;
    const intent: DoorTapIntent = {
      paymentIntentId: id,
      clientSecret: `${id}_secret`,
      totalCents: 3000,
      currency: "GBP",
      stripeAccountId: "acct_1",
      locationId: "tml_1",
    };
    return intent;
  });
  const cancelIntent = jest.fn<TapToPayServer["cancelIntent"]>(async (input) => {
    const row = intents.get(input.paymentIntentId);
    if (row === undefined || row.requestId !== input.clientRequestId) {
      log.push(`cancel-refused:${input.paymentIntentId}`);
      throw new DoorTapError("not_found", "no such intent for this request");
    }
    if (row.status === "succeeded") throw new DoorTapError("payment_succeeded", "paid");
    row.status = "canceled";
    log.push(`cancel:${input.paymentIntentId}`);
  });
  const completeIntent = jest.fn<TapToPayServer["completeIntent"]>(async (input) => {
    const row = intents.get(input.paymentIntentId);
    if (row === undefined || row.requestId !== input.clientRequestId || row.status !== "succeeded") {
      throw new DoorTapError("not_found", "nothing to record");
    }
    log.push(`complete:${input.paymentIntentId}`);
    return { orderId: "ord_1", ticketIds: ["t1"], receiptQueued: true, replayed: false };
  });

  const confirmPaymentIntent = jest.fn(async (pi: TerminalPaymentIntentLike) => {
    const row = intents.get(pi.id as string);
    if (row === undefined || row.status !== "open") {
      return { error: { code: "STRIPE_API_ERROR" }, paymentIntent: undefined } as TerminalCallResult;
    }
    row.status = "succeeded";
    log.push(`charged:${pi.id}`);
    return { paymentIntent: { ...pi, status: "succeeded" } } as TerminalCallResult;
  });
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
    confirmPaymentIntent,
    cancelCollectPaymentMethod: jest.fn(async () => {
      pending?.({ error: { code: "CANCELED" } });
      pending = null;
      return {};
    }),
  } as unknown as TapToPayTerminalClient;

  const flow = new TapToPaySaleFlow({
    eventId: "evt_1",
    draft: DRAFT,
    clientRequestId: "11111111-1111-4111-8111-111111111111",
    terminal,
    server: { createIntent, completeIntent, cancelIntent },
    onState: (state) => {
      const before = states[states.length - 1];
      if (before?.kind === "ready" && state.kind !== "ready" && current !== null) {
        windowEndAges.push(Date.now() - (intents.get(current)?.createdAt ?? Date.now()));
      }
      states.push(state);
      if (state.kind === "ready" && current !== null) {
        readyAges.push({ pi: current, age: Date.now() - (intents.get(current)?.createdAt ?? Date.now()) });
      }
    },
  });
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 40; i += 1) await Promise.resolve();
  };
  const decline = (): void => {
    pending?.({ error: { code: "DECLINED_BY_STRIPE_API" } });
    pending = null;
  };
  const tap = (): void => {
    const id = current as string;
    pending?.({ paymentIntent: { id, status: "requires_confirmation" } });
    pending = null;
  };
  const ageOf = (id: string): number => Date.now() - (intents.get(id)?.createdAt ?? Date.now());
  return {
    flow, terminal, intents, log, readyAges, windowEndAges, states, createIntent, cancelIntent, completeIntent,
    confirmPaymentIntent, flush, decline, tap, ageOf, current: () => current,
  };
};

const withFakeTimers = async (body: () => Promise<void>): Promise<void> => {
  jest.useFakeTimers();
  try {
    await body();
  } finally {
    jest.useRealTimers();
  }
};

describe("#4271 retest 3: the ready limit counts from the intent's creation", () => {
  test("R1: 40 minutes of retries never keep a ready screen on an intent at or past the limit, and one tap charges once", async () => {
    await withFakeTimers(async () => {
      const h = harness();
      void h.flow.start();
      await h.flush();
      for (let step = 0; step < 14; step += 1) {
        expect(h.flow.getState().kind).toBe("ready");
        // A decline every 3 minutes; the timer gets the rest.
        await jest.advanceTimersByTimeAsync(3 * MIN);
        await h.flush();
        if (h.flow.getState().kind === "ready") {
          h.decline();
          await h.flush();
        }
        void h.flow.tryAnotherCard();
        await h.flush();
      }
      for (const { age } of h.readyAges) expect(age).toBeLessThan(TAP_READY_LIMIT_MS);
      // Every ready window closed no later than its intent's limit.
      expect(h.windowEndAges.length).toBeGreaterThanOrEqual(14);
      for (const age of h.windowEndAges) expect(age).toBeLessThanOrEqual(TAP_READY_LIMIT_MS);
      // Several intents, each made only after the one before was cancelled.
      const creates = h.log.filter((line) => line.startsWith("create:"));
      expect(creates.length).toBeGreaterThanOrEqual(4);
      for (const line of creates) expect(line.endsWith(":open=1")).toBe(true);
      const ids = [...h.intents.values()].map((row) => row.requestId);
      expect(new Set(ids).size).toBe(ids.length);
      // Nothing older than the sweep is still open.
      for (const [id, row] of h.intents) {
        if (row.status === "open") expect(h.ageOf(id)).toBeLessThan(SWEEP_AFTER_MS);
      }

      // The guest finally taps: one charge, on the newest intent, recorded once.
      expect(h.flow.getState().kind).toBe("ready");
      h.tap();
      await h.flush();
      expect(h.flow.getState().kind).toBe("approved");
      const newest = h.current() as string;
      expect(h.log.filter((line) => line.startsWith("charged:"))).toEqual([`charged:${newest}`]);
      expect(h.log.filter((line) => line.startsWith("complete:"))).toEqual([`complete:${newest}`]);
      expect(h.completeIntent).toHaveBeenCalledWith({
        paymentIntentId: newest,
        clientRequestId: h.intents.get(newest)?.requestId,
      });
    });
  });

  test("R2: Try again 1 ms before the limit keeps the intent and stops 1 ms later; exactly at the limit it is a fresh intent", async () => {
    await withFakeTimers(async () => {
      const h = harness();
      void h.flow.start();
      await h.flush();
      jest.advanceTimersByTime(TAP_READY_LIMIT_MS - 2);
      h.decline();
      await h.flush();
      jest.advanceTimersByTime(1);
      // limit - 1 ms: same intent, the screen gets 1 ms.
      void h.flow.tryAnotherCard();
      await h.flush();
      expect(h.createIntent).toHaveBeenCalledTimes(1);
      expect(h.flow.getState().kind).toBe("ready");
      jest.advanceTimersByTime(1);
      await h.flush();
      expect(h.terminal.cancelCollectPaymentMethod).toHaveBeenCalledTimes(1);
      expect(h.flow.getState().kind).toBe("cancelled");
      // Exactly at the limit: the old intent is cancelled, a fresh one is made.
      void h.flow.tryAnotherCard();
      await h.flush();
      expect(h.cancelIntent).toHaveBeenCalledTimes(1);
      expect(h.intents.get("pi_1")?.status).toBe("canceled");
      expect(h.createIntent).toHaveBeenCalledTimes(2);
      expect(h.current()).toBe("pi_2");
      expect(h.flow.getState().kind).toBe("ready");
      for (const { age } of h.readyAges) expect(age).toBeLessThan(TAP_READY_LIMIT_MS);
    });
  });

  test("R3: a create whose answer was lost keeps the first call's clock when it is replayed", async () => {
    await withFakeTimers(async () => {
      const h = harness({ loseFirstCreateAnswer: true });
      void h.flow.start();
      await h.flush();
      expect(h.flow.getState().kind).toBe("failed");
      // The server made pi_1 now; the host retries 4 minutes later.
      jest.advanceTimersByTime(4 * MIN);
      void h.flow.start();
      await h.flush();
      expect(h.log).toContain("replay:pi_1");
      expect(h.createIntent.mock.calls[1]?.[0].clientRequestId).toBe(h.createIntent.mock.calls[0]?.[0].clientRequestId);
      expect(h.flow.getState().kind).toBe("ready");
      // 10 minutes after pi_1 was made (6 into this screen) the screen stops.
      jest.advanceTimersByTime(6 * MIN - 1);
      await h.flush();
      expect(h.terminal.cancelCollectPaymentMethod).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1);
      await h.flush();
      expect(h.terminal.cancelCollectPaymentMethod).toHaveBeenCalledTimes(1);
      expect(h.flow.getState().kind).toBe("cancelled");
      expect(h.ageOf("pi_1")).toBe(TAP_READY_LIMIT_MS);
    });
  });

  test("R4: after a replacement the pay code switch cancels the new intent under its own id, and the old one is never charged", async () => {
    await withFakeTimers(async () => {
      const h = harness();
      void h.flow.start();
      await h.flush();
      jest.advanceTimersByTime(TAP_READY_LIMIT_MS);
      await h.flush();
      expect(h.flow.getState().kind).toBe("cancelled");
      void h.flow.tryAnotherCard();
      await h.flush();
      expect(h.current()).toBe("pi_2");
      const newId = h.intents.get("pi_2")?.requestId;
      expect(newId).not.toBe(h.intents.get("pi_1")?.requestId);
      expect(newId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      // Receipts and the "seen" call name the live intent.
      expect(h.flow.getReceiptFacts()).toEqual({ paymentIntentId: "pi_2", feeCents: null, clientRequestId: newId });
      // A decline on the new intent, then the host switches to a pay code.
      h.decline();
      await h.flush();
      expect(h.flow.getState().kind).toBe("declined");
      await expect(h.flow.abandonForPayCode()).resolves.toBe("switch");
      expect(h.log).toContain("cancel:pi_2");
      expect(h.log.some((line) => line.startsWith("cancel-refused"))).toBe(false);
      // Nothing is left open that a guest could still be charged on.
      for (const row of h.intents.values()) expect(row.status).toBe("canceled");
      expect(h.confirmPaymentIntent).not.toHaveBeenCalled();
      expect(h.completeIntent).not.toHaveBeenCalled();
    });
  });
});
