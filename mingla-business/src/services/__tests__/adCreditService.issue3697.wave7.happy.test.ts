/**
 * toward #3697 Wave 7 — ad-credit client behavior (mocked edge).
 *
 * Covers wallet + fee/refund quotes and forbidden/validation mapping so a
 * broken invoke body or token leak fails this suite, not only source contracts.
 */

const mockInvoke = jest.fn<
  Promise<{ data: unknown; error: unknown }>,
  [string, { body: Record<string, unknown> }]
>();

jest.mock("../supabase", () => ({
  __esModule: true,
  supabase: {
    functions: {
      invoke: (
        name: string,
        options: { body: Record<string, unknown> },
      ): Promise<{ data: unknown; error: unknown }> => mockInvoke(name, options),
    },
  },
}));

import { mapAdCreditQuoteError } from "../adCreditQuoteErrors";
import {
  AdCreditAppError,
  applyAdCreditTopUp,
  getAdCreditWallet,
  quoteAdCreditTopUp,
  quoteAdCreditWithdraw,
  startAdCreditTopUp,
} from "../adCreditService";

const ok = (data: unknown): { data: unknown; error: null } => ({
  data,
  error: null,
});

beforeEach(() => {
  mockInvoke.mockReset();
});

describe("adCreditService Wave 7", () => {
  it("getAdCreditWallet asks ad-credit for get_wallet with brand_id", async () => {
    mockInvoke.mockResolvedValueOnce(
      ok({
        wallet: {
          brand_id: "b1",
          currency: "USD",
          balance_cents: 8500,
          updated_at: null,
        },
        history: [],
      }),
    );
    const payload = await getAdCreditWallet("b1");
    expect(payload.wallet.balance_cents).toBe(8500);
    expect(mockInvoke).toHaveBeenCalledWith("ad-credit", {
      body: { action: "get_wallet", brand_id: "b1" },
    });
  });

  it("quoteAdCreditTopUp returns the fee-inclusive top-up split", async () => {
    mockInvoke.mockResolvedValueOnce(
      ok({
        ok: true,
        pay_cents: 2500,
        credit_cents: 2125,
        fee_cents: 375,
        currency: "USD",
      }),
    );
    const q = await quoteAdCreditTopUp(2500, "USD");
    expect(q).toEqual({
      ok: true,
      pay_cents: 2500,
      credit_cents: 2125,
      fee_cents: 375,
      currency: "USD",
    });
    expect(mockInvoke).toHaveBeenCalledWith("ad-credit", {
      body: { action: "quote_top_up", pay_cents: 2500, currency: "USD" },
    });
  });

  it("quoteAdCreditWithdraw returns credit + fee refund split", async () => {
    mockInvoke.mockResolvedValueOnce(
      ok({
        ok: true,
        credit_cents: 2125,
        refund_cents: 2500,
        fee_returned_cents: 375,
      }),
    );
    const q = await quoteAdCreditWithdraw(2125);
    expect(q.refund_cents).toBe(2500);
    expect(mockInvoke).toHaveBeenCalledWith("ad-credit", {
      body: { action: "quote_withdraw", credit_cents: 2125 },
    });
  });

  it("surfaces forbidden as AdCreditAppError and maps to host copy", async () => {
    mockInvoke.mockResolvedValueOnce({
      data: { error: "forbidden", detail: "payments_manage_required" },
      error: null,
    });
    let caught: unknown;
    try {
      await quoteAdCreditTopUp(2500, "USD");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AdCreditAppError);
    expect((caught as AdCreditAppError).code).toBe("forbidden");
    expect(mapAdCreditQuoteError(caught)).toMatch(/finance permission/i);
    expect(mapAdCreditQuoteError(caught)).not.toContain(
      "payments_manage_required",
    );
  });

  it("maps pay_below_minimum without showing the machine token", async () => {
    mockInvoke.mockResolvedValueOnce({
      data: { error: "validation_error", detail: "pay_below_minimum" },
      error: null,
    });
    let caught: unknown;
    try {
      await quoteAdCreditTopUp(100, "USD");
    } catch (e) {
      caught = e;
    }
    expect(mapAdCreditQuoteError(caught)).toMatch(/minimum/i);
    expect(mapAdCreditQuoteError(caught)).not.toContain("pay_below_minimum");
  });

  it("Wave 7b: startAdCreditTopUp asks for start_top_up (native sheet)", async () => {
    mockInvoke.mockResolvedValueOnce(
      ok({
        ok: true,
        kind: "requires_payment_sheet",
        client_secret: "cs_test",
        payment_intent_id: "pi_test",
        quote: {
          ok: true,
          pay_cents: 2500,
          credit_cents: 2125,
          fee_cents: 375,
          currency: "USD",
        },
      }),
    );
    const started = await startAdCreditTopUp({
      brandId: "b1",
      payCents: 2500,
      currency: "USD",
      idempotencyKey: "attempt-abc-12345",
    });
    expect(started.kind).toBe("requires_payment_sheet");
    expect(mockInvoke).toHaveBeenCalledWith("ad-credit", {
      body: {
        action: "start_top_up",
        brand_id: "b1",
        pay_cents: 2500,
        currency: "USD",
        idempotency_key: "attempt-abc-12345",
      },
    });
  });

  it("Wave 7b: applyAdCreditTopUp sends payment_ref after sheet success", async () => {
    mockInvoke.mockResolvedValueOnce(
      ok({
        ok: true,
        quote: {
          ok: true,
          pay_cents: 2500,
          credit_cents: 2125,
          fee_cents: 375,
          currency: "USD",
        },
        result: { replayed: false },
        payment_ref: "pi_test",
      }),
    );
    const applied = await applyAdCreditTopUp({
      brandId: "b1",
      payCents: 2500,
      currency: "USD",
      paymentRef: "pi_test",
    });
    expect(applied.payment_ref).toBe("pi_test");
    expect(mockInvoke).toHaveBeenCalledWith("ad-credit", {
      body: {
        action: "apply_top_up",
        brand_id: "b1",
        pay_cents: 2500,
        currency: "USD",
        payment_ref: "pi_test",
      },
    });
  });
});
