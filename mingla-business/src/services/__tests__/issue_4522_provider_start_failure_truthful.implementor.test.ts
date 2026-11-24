/**
 * issue #4522 X-3 — one Pay click sent two requests. The first came back
 * `checkout_session_create_failed` (500) or `paystack_initialize_failed` (502):
 * the server could not start the payment with the provider and parked that
 * attempt. The #2511 automatic retry then got `checkout_in_progress` (409), and
 * the guest was told "You already have a payment in progress ... Finish it in
 * the payment window" when no window ever opened.
 *
 * A 5xx that names a provider-start failure is now the answer: one request, and
 * the guest reads the copy this module already owns for it. A 5xx without such
 * a code (and a transport failure) still retries once, as #2511 pins.
 *
 * Fails without the fix: two invokes, and the in-progress sentence.
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

import {
  createTicketCheckout,
  paidCheckoutErrorMessage,
  PAID_CHECKOUT_FAILED_MESSAGE,
  PAID_CHECKOUT_IN_PROGRESS_MESSAGE,
} from "../ticketCheckoutService";

const BODY = {
  eventId: "45220000-0000-4000-8000-0000000000e1",
  buyer: { name: "QA", email: "qa@example.invalid", phone: "+15555550100", marketingOptIn: false },
  lines: [{ ticketTypeId: "45220000-0000-4000-8000-0000000000e2", quantity: 1 }],
} as const;

/** A handled non-2xx whose body can be read ONCE, like a real Response. */
const httpError = (status: number, code: string) => {
  let read = false;
  return {
    data: null,
    error: {
      message: "Edge Function returned a non-2xx status code",
      context: {
        status,
        json: () => {
          if (read) return Promise.reject(new TypeError("Body is unusable"));
          read = true;
          return Promise.resolve({ error: code, detail: "provider_down" });
        },
      },
    },
  };
};

describe("issue #4522 X-3 — a provider-start failure is told as it is", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  test.each([
    [500, "checkout_session_create_failed"],
    [502, "payment_intent_create_failed"],
    [502, "paystack_initialize_failed"],
  ])("%s %s: one request, and the guest is not told a payment window is open", async (status, code) => {
    invokeMock
      .mockResolvedValueOnce(httpError(status, code))
      .mockResolvedValueOnce(httpError(409, "checkout_in_progress"));
    const failure = await createTicketCheckout(BODY as never).catch((error: unknown) => error);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect((failure as { code?: string }).code).toBe(code);
    expect((failure as { status?: number }).status).toBe(status);
    expect(paidCheckoutErrorMessage(failure)).toBe(PAID_CHECKOUT_FAILED_MESSAGE);
    expect(paidCheckoutErrorMessage(failure)).not.toBe(PAID_CHECKOUT_IN_PROGRESS_MESSAGE);
  });

  test("a 5xx that names no provider failure still retries once (#2511)", async () => {
    invokeMock
      .mockResolvedValueOnce(httpError(503, "upstream"))
      .mockResolvedValueOnce({ data: { kind: "free_completed", orderId: "o1" }, error: null });
    await expect(createTicketCheckout(BODY as never)).resolves.toBeTruthy();
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });
});
