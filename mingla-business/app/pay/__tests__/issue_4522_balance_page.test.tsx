/**
 * #4522 — anonymous trip balance link: behaviour of the client the page uses.
 *
 * Executes tripBalancePayService against a mocked Supabase client: the URL
 * token is the only credential, refusals surface their server code, and only a
 * real Paystack checkout URL is accepted as a redirect. The page's structure
 * (no auth hook, 2 s / 30 s return polling, every state and refusal copy, one
 * lazy Stripe rail, the installment page's secondary entry) is a source-shape
 * rule and lives in `.github/scripts/strict-grep/issue-4522-flex-claim-guard.mjs`
 * (`publishedSurfaceFailures`).
 */

const mockInvoke = jest.fn();

jest.mock("../../../src/services/supabase", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => mockInvoke(...args) } },
}));

import {
  startTripBalanceLink,
  TripBalancePayError,
  viewTripBalanceLink,
} from "../../../src/services/tripBalancePayService";

const startInput = {
  token: "tok-123",
  amountMinor: 5_000,
  expectedRemainingMinor: 20_000,
  clientKey: "balance-key",
  method: "new_card" as const,
};

beforeEach(() => {
  mockInvoke.mockReset();
});

describe("#4522 anonymous trip balance client", () => {
  test("sends the URL token as the only credential to trip-balance-pay", async () => {
    mockInvoke.mockResolvedValue({
      data: { state: "paid", balance: null, tripTitle: "Lisbon" },
      error: null,
    });
    const view = await viewTripBalanceLink("tok-123");
    expect(view).toEqual({ state: "paid", balance: null, tripTitle: "Lisbon" });
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith("trip-balance-pay", {
      body: { action: "view", token: "tok-123" },
    });
  });

  test("surfaces the server refusal code without logging", async () => {
    const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    mockInvoke.mockResolvedValue({
      data: null,
      error: {
        context: {
          status: 409,
          json: async () => ({ error: "balance_payment_in_flight" }),
        },
      },
    });
    const failure = await startTripBalanceLink(startInput).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(TripBalancePayError);
    expect((failure as TripBalancePayError).code).toBe("balance_payment_in_flight");
    expect((failure as TripBalancePayError).status).toBe(409);
    expect(mockInvoke.mock.calls[0][1]).toEqual({
      body: {
        action: "start",
        amountMinor: 5_000,
        expectedRemainingMinor: 20_000,
        clientKey: "balance-key",
        method: "new_card",
        token: "tok-123",
      },
    });
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    log.mockRestore();
    warn.mockRestore();
  });

  // #4522 S-14 — an unknown or mistyped link (404 { state: "invalid" }) is a
  // link problem, not a connection problem. FAILS ON REVERT: request_failed.
  test("an unknown link is balance_link_invalid", async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: { context: { status: 404, json: async () => ({ state: "invalid" }) } },
    });
    const failure = await viewTripBalanceLink("garbage").catch((e: unknown) => e);
    expect((failure as TripBalancePayError).code).toBe("balance_link_invalid");
    expect((failure as TripBalancePayError).status).toBe(404);
  });

  test("accepts a Paystack checkout redirect and refuses any other host", async () => {
    mockInvoke.mockResolvedValueOnce({
      data: { kind: "redirect", url: "https://checkout.paystack.com/abc" },
      error: null,
    });
    await expect(startTripBalanceLink(startInput)).resolves.toEqual({
      kind: "redirect",
      url: "https://checkout.paystack.com/abc",
    });

    mockInvoke.mockResolvedValueOnce({
      data: { kind: "redirect", url: "https://evil.example/checkout.paystack.com/" },
      error: null,
    });
    const refused = await startTripBalanceLink(startInput).catch((e: unknown) => e);
    expect((refused as TripBalancePayError).code).toBe("invalid_response");
  });

  test("returns a complete Stripe session for the lazy Elements rail", async () => {
    mockInvoke.mockResolvedValue({
      data: {
        kind: "stripe",
        amountMinor: 5_000,
        clientSecret: "pi_secret",
        paymentIntentId: "pi_1",
        stripeAccountId: "acct_1",
        publishableKey: "pk_test_1",
      },
      error: null,
    });
    await expect(startTripBalanceLink(startInput)).resolves.toEqual({
      kind: "stripe",
      amountMinor: 5_000,
      clientSecret: "pi_secret",
      paymentIntentId: "pi_1",
      stripeAccountId: "acct_1",
      publishableKey: "pk_test_1",
    });
  });
});
