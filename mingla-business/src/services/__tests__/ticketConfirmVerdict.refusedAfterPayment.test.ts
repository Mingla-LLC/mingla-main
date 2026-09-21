/**
 * Paid return leg — the ONE owner of "what did the confirm answer mean, and how
 * long do we keep asking?" (`classifyTicketConfirmAnswer` +
 * `awaitTicketConfirmation` in `ticketCheckoutService.ts`).
 *
 * THE DEFECT. `ticket-checkout-confirm` refuses a paid sale that was closed or
 * held after payment with HTTP 409
 * `{ status: "failed", order: null, error: "checkout_unavailable" }`.
 * `invokeOrThrow` turns that into a THROW, and every buyer confirmation screen
 * treated every throw as transient: the guest sat on "Confirming your tickets…"
 * forever, waiting on a Realtime push that never comes for a refused sale.
 * `status: "expired"` fell into the same wait.
 *
 * THE SECOND DEFECT, and the one about money. Those two are NOT the same event.
 * `expired` means the checkout timed out with nothing charged. A
 * `checkout_unavailable` refusal is raised only after a completed charge or a
 * revoked sale, and #2079 may resolve it by COMPLETING the sale rather than
 * refunding it. One sentence cannot be true of both, so they never share one.
 *
 * The loop is driven with an injected clock and an injected `waitFor`, so the
 * 60 s budget is asserted exactly and runs in milliseconds.
 *
 * FAILS ON REVERT: restore `ticketCheckoutService.ts` from origin/main and every
 * test here fails (the owner does not exist).
 */

import { beforeEach, describe, expect, jest, test } from "@jest/globals";

type InvokeResult = { data: unknown; error: unknown };
const mockInvoke = jest.fn<(name: string, opts: { body: unknown }) => Promise<InvokeResult>>();
jest.mock("../supabase", () => ({
  supabase: {
    functions: {
      invoke: (name: string, opts: { body: unknown }) => mockInvoke(name, opts),
    },
  },
}));
jest.mock("../../analytics/webAnalytics", () => ({
  getStoredClickAttribution: () => ({ clickId: null }),
}));

import {
  awaitTicketConfirmation,
  classifyTicketConfirmAnswer,
  PAID_CHECKOUT_PAYMENT_ABANDONED_MESSAGE,
  PAID_CHECKOUT_PAYMENT_FAILED_MESSAGE,
  PAID_CHECKOUT_PAYMENT_MISMATCH_MESSAGE,
  TICKET_CONFIRM_BUDGET_MS,
  TICKETS_EXPIRED_MESSAGE,
  TICKETS_EXPIRED_TITLE,
  TICKETS_NOT_ISSUED_MESSAGE,
  TICKETS_NOT_ISSUED_TITLE,
  TICKETS_STILL_CONFIRMING_MESSAGE,
  TICKETS_STILL_CONFIRMING_TITLE,
  type TicketCheckoutConfirmResult,
} from "../ticketCheckoutService";

const SESSION = "cs-refused-1";
const TOKEN = "bst-refused-1";

const ORDER: NonNullable<TicketCheckoutConfirmResult["order"]> = {
  orderId: "ord-1",
  checkoutSessionId: SESSION,
  eventId: "evt-1",
  paymentStatus: "paid",
  totalCents: 2500,
  currency: "GBP",
  taxAmountCents: 0,
  tickets: [],
  notificationStatus: "queued",
};

const answer = (
  status: TicketCheckoutConfirmResult["status"],
  extra: Partial<TicketCheckoutConfirmResult> = {},
): TicketCheckoutConfirmResult => ({
  checkoutSessionId: SESSION,
  status,
  order: null,
  ...extra,
});

/** The error `invokeOrThrow` throws for a handled refusal (#2188 shape). */
const refusal = (status: number | null, code: string | null): Error =>
  Object.assign(new Error("Edge Function returned a non-2xx status code"), {
    status,
    code,
    detail: null,
  });

/** A clock that only moves when the loop waits. */
const fakeClock = (): {
  now: () => number;
  waitFor: (ms: number) => Promise<void>;
  waits: number[];
  at: () => number;
} => {
  let t = 0;
  const waits: number[] = [];
  return {
    now: () => t,
    waitFor: async (ms: number) => {
      waits.push(ms);
      t += ms;
    },
    waits,
    at: () => t,
  };
};

describe("classifyTicketConfirmAnswer — one answer, one meaning", () => {
  test("a thrown 409 checkout_unavailable is a DEFINITIVE refusal, not a network blip", () => {
    expect(
      classifyTicketConfirmAnswer({ kind: "error", error: refusal(409, "checkout_unavailable") }),
    ).toEqual({ kind: "not_issued" });
    // Token alone, and a 409 whose body could not be read, mean the same.
    expect(
      classifyTicketConfirmAnswer({ kind: "error", error: refusal(null, "checkout_unavailable") }),
    ).toEqual({ kind: "not_issued" });
    expect(
      classifyTicketConfirmAnswer({ kind: "error", error: refusal(409, null) }),
    ).toEqual({ kind: "not_issued" });
  });

  test("expired is definitive AND kept apart from the refusal that may be paid", () => {
    expect(classifyTicketConfirmAnswer({ kind: "result", result: answer("expired") }))
      .toEqual({ kind: "expired" });
    // Merging these two is the money bug: one proves no charge, the other
    // proves nothing either way.
    expect(classifyTicketConfirmAnswer({ kind: "result", result: answer("expired") }))
      .not.toEqual({ kind: "not_issued" });
  });

  test("paid with an order is the only success", () => {
    const result = answer("paid", { order: ORDER });
    expect(classifyTicketConfirmAnswer({ kind: "result", result })).toEqual({
      kind: "paid",
      result,
      order: ORDER,
    });
    // paid without an order yet is still waiting, never a success.
    expect(classifyTicketConfirmAnswer({ kind: "result", result: answer("paid") }))
      .toEqual({ kind: "pending" });
  });

  test("a Paystack return token keeps its #2198 copy", () => {
    const cases: Array<[string, string]> = [
      ["paystack_charge_failed", PAID_CHECKOUT_PAYMENT_FAILED_MESSAGE],
      ["paystack_charge_abandoned", PAID_CHECKOUT_PAYMENT_ABANDONED_MESSAGE],
      ["paystack_payment_mismatch", PAID_CHECKOUT_PAYMENT_MISMATCH_MESSAGE],
    ];
    for (const [code, message] of cases) {
      expect(
        classifyTicketConfirmAnswer({ kind: "result", result: answer("failed", { error: code }) }),
      ).toEqual({ kind: "payment_failed", message });
    }
  });

  test("any other 200 failed means no tickets, and no claim about the money", () => {
    // `checkout_unavailable` at HTTP 200 is #2198's `paid_reversal_pending`
    // arm — the guest DID pay. It must not reach `paidCheckoutErrorMessage`,
    // whose copy for that token ends "You have not been charged".
    for (const error of [undefined, null, "", "checkout_unavailable", "something_new"]) {
      expect(
        classifyTicketConfirmAnswer({ kind: "result", result: answer("failed", { error }) }),
      ).toEqual({ kind: "not_issued" });
    }
  });

  test("pending, transport failures and 5xx keep waiting", () => {
    expect(classifyTicketConfirmAnswer({ kind: "result", result: answer("pending") }))
      .toEqual({ kind: "pending" });
    expect(classifyTicketConfirmAnswer({ kind: "error", error: new TypeError("Failed to fetch") }))
      .toEqual({ kind: "pending" });
    expect(classifyTicketConfirmAnswer({ kind: "error", error: refusal(502, "stripe_unavailable") }))
      .toEqual({ kind: "pending" });
    expect(classifyTicketConfirmAnswer({ kind: "error", error: refusal(500, "finalize_failed") }))
      .toEqual({ kind: "pending" });
  });

  test("a refusal that cannot say whether tickets exist is never dressed up as not-issued", () => {
    for (const status of [400, 401, 403, 404]) {
      expect(classifyTicketConfirmAnswer({ kind: "error", error: refusal(status, "x") }))
        .toEqual({ kind: "unanswerable" });
    }
  });
});

describe("awaitTicketConfirmation — the bounded wait", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  test("409 checkout_unavailable from the REAL confirm call → not_issued on the first answer", async () => {
    // Exactly what supabase-js hands back for the edge function's 409 body.
    mockInvoke.mockResolvedValue({
      data: null,
      error: {
        name: "FunctionsHttpError",
        message: "Edge Function returned a non-2xx status code",
        context: {
          status: 409,
          json: async () => ({
            checkoutSessionId: SESSION,
            status: "failed",
            order: null,
            error: "checkout_unavailable",
          }),
        },
      },
    });
    const clock = fakeClock();
    const onWaiting = jest.fn();

    const verdict = await awaitTicketConfirmation({
      checkoutSessionId: SESSION,
      buyerStatusToken: TOKEN,
      now: clock.now,
      waitFor: clock.waitFor,
      onWaiting,
    });

    expect(verdict).toEqual({ kind: "not_issued" });
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith("ticket-checkout-confirm", {
      body: { checkoutSessionId: SESSION, buyerStatusToken: TOKEN },
    });
    expect(clock.waits).toEqual([]);
    expect(onWaiting).not.toHaveBeenCalled();
  });

  test("expired → expired, NOT the refusal that may be paid", async () => {
    const clock = fakeClock();
    const confirm = jest.fn(async () => answer("expired"));
    await expect(
      awaitTicketConfirmation({
        checkoutSessionId: SESSION,
        buyerStatusToken: TOKEN,
        confirm,
        now: clock.now,
        waitFor: clock.waitFor,
      }),
    ).resolves.toEqual({ kind: "expired" });
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  test("paid + order → paid, carrying the order", async () => {
    const clock = fakeClock();
    const result = answer("paid", { order: ORDER });
    const verdict = await awaitTicketConfirmation({
      checkoutSessionId: SESSION,
      buyerStatusToken: TOKEN,
      confirm: async () => result,
      now: clock.now,
      waitFor: clock.waitFor,
    });
    expect(verdict).toEqual({ kind: "paid", result, order: ORDER });
  });

  test("a Paystack token → payment_failed with the existing copy", async () => {
    const clock = fakeClock();
    const verdict = await awaitTicketConfirmation({
      checkoutSessionId: SESSION,
      buyerStatusToken: TOKEN,
      confirm: async () => answer("failed", { error: "paystack_charge_abandoned" }),
      now: clock.now,
      waitFor: clock.waitFor,
    });
    expect(verdict).toEqual({
      kind: "payment_failed",
      message: PAID_CHECKOUT_PAYMENT_ABANDONED_MESSAGE,
    });
  });

  test("a transport error, then a 5xx, then paid → paid (it keeps asking)", async () => {
    const clock = fakeClock();
    const onWaiting = jest.fn();
    const confirm = jest
      .fn<() => Promise<TicketCheckoutConfirmResult>>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(refusal(502, "stripe_unavailable"))
      .mockResolvedValueOnce(answer("paid", { order: ORDER }));

    const verdict = await awaitTicketConfirmation({
      checkoutSessionId: SESSION,
      buyerStatusToken: TOKEN,
      confirm,
      now: clock.now,
      waitFor: clock.waitFor,
      onWaiting,
    });

    expect(verdict.kind).toBe("paid");
    expect(confirm).toHaveBeenCalledTimes(3);
    expect(clock.waits).toEqual([1000, 2000]);
    // Realtime is armed once, on the first open answer — not per attempt.
    expect(onWaiting).toHaveBeenCalledTimes(1);
  });

  test("a refusal arriving after a pending answer still ends the wait", async () => {
    const clock = fakeClock();
    const confirm = jest
      .fn<() => Promise<TicketCheckoutConfirmResult>>()
      .mockResolvedValueOnce(answer("pending"))
      .mockRejectedValueOnce(refusal(409, "checkout_unavailable"));
    await expect(
      awaitTicketConfirmation({
        checkoutSessionId: SESSION,
        buyerStatusToken: TOKEN,
        confirm,
        now: clock.now,
        waitFor: clock.waitFor,
      }),
    ).resolves.toEqual({ kind: "not_issued" });
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  test("pending forever → still_confirming at 60 s, and confirm is never called after the cap", async () => {
    const clock = fakeClock();
    const callTimes: number[] = [];
    const confirm = jest.fn(async () => {
      callTimes.push(clock.at());
      return answer("pending");
    });

    const verdict = await awaitTicketConfirmation({
      checkoutSessionId: SESSION,
      buyerStatusToken: TOKEN,
      confirm,
      now: clock.now,
      waitFor: clock.waitFor,
    });

    expect(verdict).toEqual({ kind: "still_confirming" });
    expect(TICKET_CONFIRM_BUDGET_MS).toBe(60_000);
    // Backoff 1, 2, 3, 5, then 8 s repeating: asks at 0,1,3,6,11,19,27,35,43,51,59 s.
    expect(callTimes).toEqual([0, 1000, 3000, 6000, 11000, 19000, 27000, 35000, 43000, 51000, 59000]);
    expect(callTimes.every((t) => t < TICKET_CONFIRM_BUDGET_MS)).toBe(true);
    expect(clock.at()).toBeLessThanOrEqual(TICKET_CONFIRM_BUDGET_MS);

    // Nothing is still running in the background after the verdict.
    const callsAtVerdict = confirm.mock.calls.length;
    await Promise.resolve();
    await Promise.resolve();
    expect(confirm.mock.calls.length).toBe(callsAtVerdict);
  });

  test("a clock that never moves cannot stretch the budget", async () => {
    let waited = 0;
    const confirm = jest.fn(async () => answer("pending"));
    const verdict = await awaitTicketConfirmation({
      checkoutSessionId: SESSION,
      buyerStatusToken: TOKEN,
      confirm,
      now: () => 0,
      waitFor: async (ms) => {
        waited += ms;
      },
    });
    expect(verdict).toEqual({ kind: "still_confirming" });
    expect(waited).toBeLessThanOrEqual(TICKET_CONFIRM_BUDGET_MS);
    expect(confirm).toHaveBeenCalledTimes(11);
  });

  test("a 403 / 404 stops asking at once and says still-confirming, never not-issued", async () => {
    for (const status of [403, 404]) {
      const clock = fakeClock();
      const confirm = jest.fn(async () => {
        throw refusal(status, "buyer_status_token_invalid");
      });
      await expect(
        awaitTicketConfirmation({
          checkoutSessionId: SESSION,
          buyerStatusToken: TOKEN,
          confirm,
          now: clock.now,
          waitFor: clock.waitFor,
        }),
      ).resolves.toEqual({ kind: "still_confirming" });
      expect(confirm).toHaveBeenCalledTimes(1);
    }
  });

  test("cancellation (unmount) stops the loop — no further confirm calls", async () => {
    let cancelled = false;
    let t = 0;
    const confirm = jest.fn(async () => answer("pending"));
    const verdict = await awaitTicketConfirmation({
      checkoutSessionId: SESSION,
      buyerStatusToken: TOKEN,
      confirm,
      now: () => t,
      waitFor: async (ms) => {
        t += ms;
        // The screen unmounts while the loop sleeps.
        cancelled = true;
      },
      isCancelled: () => cancelled,
    });
    expect(verdict).toEqual({ kind: "cancelled" });
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  test("cancellation while a confirm is in flight discards its answer", async () => {
    let cancelled = false;
    const verdict = await awaitTicketConfirmation({
      checkoutSessionId: SESSION,
      buyerStatusToken: TOKEN,
      confirm: async () => {
        cancelled = true;
        return answer("paid", { order: ORDER });
      },
      isCancelled: () => cancelled,
    });
    expect(verdict).toEqual({ kind: "cancelled" });
  });

  test("a confirm request that never answers cannot hold the guest past the budget", async () => {
    jest.useFakeTimers();
    try {
      const pending = awaitTicketConfirmation({
        checkoutSessionId: SESSION,
        buyerStatusToken: TOKEN,
        confirm: () => new Promise<TicketCheckoutConfirmResult>(() => undefined),
        budgetMs: 5_000,
      });
      await jest.advanceTimersByTimeAsync(5_000);
      await expect(pending).resolves.toEqual({ kind: "still_confirming" });
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("buyer copy — never asserts what it cannot know about the money", () => {
  test("the expired sentence is the ONLY refusal that says 'not charged'", () => {
    expect(TICKETS_EXPIRED_TITLE).toBe("Checkout expired");
    expect(TICKETS_EXPIRED_MESSAGE).toBe(
      "Your checkout expired before the payment went through, so no tickets were issued. You haven't been charged — you can start again.",
    );
  });

  test("the refusal sentence claims no charge outcome and promises no refund", () => {
    expect(TICKETS_NOT_ISSUED_TITLE).toBe("Tickets not issued");
    expect(TICKETS_NOT_ISSUED_MESSAGE).toBe(
      "We couldn't issue your tickets for this sale. If your payment went through, we're sorting it out and will email you — please don't pay again. Contact support@usemingla.com and we'll pick it up from there.",
    );
    // The regression this test exists for: a guest whose money moved must not
    // read "you haven't been charged", and must not be promised a refund the
    // #2079 attention path may never execute.
    expect(TICKETS_NOT_ISSUED_MESSAGE).not.toMatch(/been charged/i);
    expect(TICKETS_NOT_ISSUED_MESSAGE).not.toMatch(/refund/i);
    expect(TICKETS_NOT_ISSUED_MESSAGE).toMatch(/don't pay again/i);
  });

  test("no two endings share a sentence, and none is a dead end", () => {
    const endings = [
      TICKETS_EXPIRED_MESSAGE,
      TICKETS_NOT_ISSUED_MESSAGE,
      TICKETS_STILL_CONFIRMING_MESSAGE,
    ];
    expect(new Set(endings).size).toBe(endings.length);
    for (const message of endings) {
      // Either a way forward, or a plain statement of what happens next.
      expect(message).toMatch(/start again|pay again|email you|contact/i);
      expect(message).toMatch(/[.!]$/);
    }
  });

  test("still-confirming copy never claims a charge outcome and says not to pay twice", () => {
    expect(TICKETS_STILL_CONFIRMING_TITLE).toBe("Still confirming your tickets");
    expect(TICKETS_STILL_CONFIRMING_MESSAGE).toBe(
      "This is taking longer than usual. We'll email you as soon as your tickets are confirmed, so there's no need to pay again.",
    );
    expect(TICKETS_STILL_CONFIRMING_MESSAGE).not.toMatch(/charged/i);
  });
});
