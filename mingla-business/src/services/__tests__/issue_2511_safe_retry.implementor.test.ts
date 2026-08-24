/**
 * issue #2511 item 7 — A LOST REPLY STOPS BEING A LOST SALE.
 *
 * WHAT WAS BROKEN. `invokeOrThrow` made ONE `supabase.functions.invoke` call
 * with no timeout and no retry. On Nigerian mobile data inside the Instagram
 * in-app browser — where the We Go Again reports came from — a dropped reply
 * meant the reservation was simply lost, and a request that never answered left
 * the guest on a spinner forever.
 *
 * The guest's only recourse was to change a field and submit again. That
 * produces a DIFFERENT idempotency key and therefore a GENUINE duplicate: three
 * guests did exactly that and ended up holding two orders each (#2462).
 *
 * WHY THE RETRY CANNOT DUPLICATE. The server derives the idempotency key from
 * the request body alone. Re-sending the SAME body produces the SAME key, and
 * #2150's exemption returns the already-completed session instead of minting a
 * second one. Safe BY CONSTRUCTION — not by hoping the first attempt failed.
 * The test below pins exactly that: the retry must carry a byte-identical body.
 *
 * WHAT THIS PINS.
 *   1. A transport failure is retried ONCE, with an identical body.
 *   2. A 4xx is NEVER retried — a refusal is a decision, not a blip.
 *   3. A 5xx IS retried, and a 5xx arrives as a HANDLED error rather than a
 *      throw, which is a separate code path and is separately pinned.
 *   4. Two failures give up — no loop, no thundering herd.
 *   5. A hung request times out rather than hanging forever, and the timeout
 *      looks like a transport failure so the guest gets the honest
 *      "we do not know" sentence from item 6.
 *
 * FAILS ON REVERT: restore the single un-retried `invoke` and cases 1, 3, 4
 * and 5 fail.
 */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const invokeMock = jest.fn<(...args: unknown[]) => Promise<unknown>>();
jest.mock("../supabase", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => invokeMock(...args) },
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

import { createTicketCheckout } from "../ticketCheckoutService";

const BODY = {
  eventId: "25110000-0000-4000-8000-000000000001",
  buyer: {
    name: "QA",
    email: "qa@example.invalid",
    phone: "+2349000000001",
    marketingOptIn: false,
  },
  lines: [{ ticketTypeId: "25110000-0000-4000-8000-00000000a001", quantity: 1 }],
} as const;

/** The shape supabase-js returns for a HANDLED non-2xx. */
const httpError = (status: number, code: string) => ({
  data: null,
  error: {
    message: "Edge Function returned a non-2xx status code",
    context: {
      status,
      json: () => Promise.resolve({ error: code }),
    },
  },
});

const ok = { data: { kind: "free_completed", orderId: "o1" }, error: null };

describe("issue #2511 item 7 — a dropped reply is retried, safely", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  test("a transport failure is retried once and can then succeed", async () => {
    invokeMock
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(ok);
    await expect(createTicketCheckout(BODY as never)).resolves.toBeTruthy();
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  test("THE SAFETY PROPERTY: the retry sends a byte-identical body", async () => {
    // This is what makes the retry incapable of duplicating. The server derives
    // the idempotency key from the body; an identical body means an identical
    // key means the same reservation returned, never a second one minted.
    invokeMock
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(ok);
    await createTicketCheckout(BODY as never);
    const [firstName, firstOpts] = invokeMock.mock.calls[0] as [
      string,
      { body: unknown },
    ];
    const [secondName, secondOpts] = invokeMock.mock.calls[1] as [
      string,
      { body: unknown },
    ];
    expect(secondName).toBe(firstName);
    expect(JSON.stringify(secondOpts.body)).toBe(
      JSON.stringify(firstOpts.body),
    );
  });

  test("a 4xx refusal is NEVER retried — it is a decision, not a blip", async () => {
    invokeMock.mockResolvedValue(httpError(409, "ticket_sales_ended"));
    await expect(createTicketCheckout(BODY as never)).rejects.toBeTruthy();
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  test("a 5xx IS retried — it arrives handled, not thrown", async () => {
    invokeMock
      .mockResolvedValueOnce(httpError(503, "upstream"))
      .mockResolvedValueOnce(ok);
    await expect(createTicketCheckout(BODY as never)).resolves.toBeTruthy();
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  test("two transport failures give up — one retry, never a loop", async () => {
    invokeMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(createTicketCheckout(BODY as never)).rejects.toBeTruthy();
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  test("the surfaced failure carries NO status, so item 6's honest copy applies", async () => {
    // A transport failure must not masquerade as a server refusal, or the guest
    // would be told something the server never said.
    invokeMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(createTicketCheckout(BODY as never)).rejects.toMatchObject({
      message: expect.stringContaining("Failed to fetch"),
    });
  });

  test("a hung request times out instead of hanging forever", async () => {
    jest.useFakeTimers();
    try {
      invokeMock.mockImplementation(() => new Promise(() => {/* never settles */}));
      const pending = createTicketCheckout(BODY as never);
      const assertion = expect(pending).rejects.toThrow(
        /checkout_request_timed_out/,
      );
      // first attempt times out, retry delay, second attempt times out
      await jest.advanceTimersByTimeAsync(20_000);
      await jest.advanceTimersByTimeAsync(700);
      await jest.advanceTimersByTimeAsync(20_000);
      await assertion;
      expect(invokeMock).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });
});
