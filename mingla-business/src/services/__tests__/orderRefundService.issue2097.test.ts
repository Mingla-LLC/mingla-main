const mockInvoke = jest.fn();

jest.mock("../supabase", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
  },
}));

import { issueOrderRefund, type RefundOrderError } from "../orderRefundService";

const functionsHttpError = (
  status: number,
  payload: Record<string, unknown>,
): Error => {
  const error = new Error("Edge Function returned a non-2xx status code");
  Object.assign(error, {
    context: {
      status,
      text: async () => JSON.stringify(payload),
    },
  });
  return error;
};

const invokeAndCatch = async (
  payload: Record<string, unknown>,
  status: number,
): Promise<RefundOrderError> => {
  mockInvoke.mockResolvedValueOnce({
    data: null,
    error: functionsHttpError(status, payload),
  });
  try {
    await issueOrderRefund({
      orderId: "order_2097",
      lines: [{ orderLineItemId: "line_1", quantity: 1, amountCents: 100 }],
      reason: "Customer requested refund",
      idempotencyKey: "idem_2097",
    });
  } catch (cause) {
    return cause as RefundOrderError;
  }
  throw new Error("expected issueOrderRefund to reject");
};

beforeEach(() => {
  mockInvoke.mockReset();
});

describe("#2097 Business non-2xx refund truth", () => {
  it("states that buyer money moved only when the envelope proves it", async () => {
    const error = await invokeAndCatch(
      {
        error: "refund_reconciliation_pending",
        buyer_refund_status: "succeeded",
        application_fee_refund_status: "pending_visibility",
        application_fee_refunded_cents: null,
      },
      202,
    );

    expect(error.code).toBe("refund_reconciliation_pending");
    expect(error.buyerRefundStatus).toBe("succeeded");
    expect(error.applicationFeeRefundStatus).toBe("pending_visibility");
    expect(error.applicationFeeRefundedCents).toBeNull();
    expect(error.message).toMatch(/buyer refund was issued/i);
    expect(error.message).toMatch(/still confirming the Stripe fee refund/i);
  });

  it("never claims a buyer refund for a pre-provider waiting state", async () => {
    const error = await invokeAndCatch(
      {
        error: "refund_reconciliation_pending",
        buyer_refund_status: "not_started",
        application_fee_refund_status: "awaiting_application_fee",
        application_fee_refunded_cents: null,
      },
      202,
    );

    expect(error.buyerRefundStatus).toBe("not_started");
    expect(error.applicationFeeRefundStatus).toBe("awaiting_application_fee");
    expect(error.message).toMatch(/buyer money has not moved/i);
    expect(error.message).not.toMatch(/buyer refund was issued/i);
  });

  it("keeps buyer success separate from conflicting fee evidence", async () => {
    const error = await invokeAndCatch(
      {
        error: "refund_evidence_conflict",
        buyer_refund_status: "succeeded",
        application_fee_refund_status: "evidence_conflict",
        application_fee_refunded_cents: null,
      },
      409,
    );

    expect(error.code).toBe("refund_evidence_conflict");
    expect(error.buyerRefundStatus).toBe("succeeded");
    expect(error.applicationFeeRefundStatus).toBe("evidence_conflict");
    expect(error.message).toMatch(/buyer refund was issued/i);
    expect(error.message).toMatch(/fee evidence needs review/i);
  });
});
