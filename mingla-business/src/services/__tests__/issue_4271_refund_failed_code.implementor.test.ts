/**
 * #4271 (PR #4303 rework) — a refund the server committed 'failed' reaches the
 * sheet as the code "refund_failed", so the next Send starts a new refund.
 *
 * refund-order answers 502 { error: "stripe_declined", refund_outcome: "failed" }
 * the first time (nothing was refunded, the row is failed) and 409
 * { error: "refund_failed" } when the same key is sent again. An unknown outcome
 * (refund_outcome "unknown") stays "stripe_declined": the row is still pending
 * and the same key must be reused.
 *
 * fails-on-revert: dropping the refund_outcome mapping fails F1.
 */
const mockInvoke = jest.fn();

jest.mock("../supabase", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
  },
}));

import { issueOrderRefund, type RefundOrderError } from "../orderRefundService";

const reject = async (status: number, payload: Record<string, unknown>): Promise<RefundOrderError> => {
  const error = new Error("Edge Function returned a non-2xx status code");
  Object.assign(error, { context: { status, text: async () => JSON.stringify(payload) } });
  mockInvoke.mockResolvedValueOnce({ data: null, error });
  try {
    await issueOrderRefund({
      orderId: "order_4271",
      lines: [{ orderLineItemId: "line_1", quantity: 1, amountCents: 100 }],
      reason: "Guest could not attend",
      idempotencyKey: "idem_4271",
    });
  } catch (cause) {
    return cause as RefundOrderError;
  }
  throw new Error("expected issueOrderRefund to reject");
};

beforeEach(() => mockInvoke.mockReset());

describe("#4271 a failed refund is final", () => {
  it("F1 maps a refusal committed failed to refund_failed", async () => {
    const error = await reject(502, { error: "stripe_declined", refund_outcome: "failed" });
    expect(error.code).toBe("refund_failed");
    expect(error.message).toMatch(/nothing was refunded/);
    expect(error.message).not.toMatch(/stripe|paystack/i);
  });

  it("F2 maps a replay of a failed row to refund_failed", async () => {
    const error = await reject(409, { error: "refund_failed", refund_outcome: "failed" });
    expect(error.code).toBe("refund_failed");
  });

  it("F3 keeps an unknown outcome as stripe_declined (same key, row still pending)", async () => {
    const error = await reject(502, { error: "stripe_declined", refund_outcome: "unknown" });
    expect(error.code).toBe("stripe_declined");
  });
});
