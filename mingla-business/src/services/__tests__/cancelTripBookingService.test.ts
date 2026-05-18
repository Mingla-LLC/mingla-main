/**
 * ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] — happy-path regression
 * test for cancelTripBookingService error code mapping.
 *
 * Per ORCH-0840 [Regression-test enforcement + append-only CI] Step 0.5
 * gate: implementor MUST ship a happy-path test that fails on revert. This
 * test exercises SC-22 freshness contract handling — when the edge fn
 * returns HTTP 409 `{error:"policy_updated", currentRefundTotalCents}`,
 * the service MUST throw a typed CancelTripBookingError with code='policy_updated'
 * carrying the new amount, NOT a generic internal_error.
 *
 * Fails-on-revert verified: change the mapPgError or invokeCancelTripBooking
 * mapping to swallow the `policy_updated` code (e.g. fall through to
 * `internal_error` default) → test_policy_updated_propagated FAILS because
 * the buyer UI loses the freshness signal + the currentRefundTotalCents
 * needed to re-confirm.
 *
 * Also pins the buyer/operator preview shapes — implementor regression
 * happens if someone refactors the response unwrapping and drops
 * `perPaymentRefund` from the typed return.
 */

import { describe, expect, jest, test } from "@jest/globals";

// Mock the supabase.functions.invoke layer. Returns either {data, error:null}
// for success or {data:null, error:{...with context}} mimicking the
// FunctionsHttpError shape that supabase-js wraps non-2xx responses with.
jest.mock("../supabase", () => ({
  supabase: {
    functions: {
      invoke: jest.fn(),
    },
  },
}));

import {
  commitBuyerCancel,
  previewBuyerCancel,
  type CancelTripBookingError,
} from "../cancelTripBookingService";
import { supabase } from "../supabase";

const ORDER_ID = "00000000-0000-0000-0000-000000000002";
const TOKEN = "this-is-a-test-buyer-cancel-token-32chars";

// Cast through unknown to a generic jest mock that can accept any resolved
// value (supabase-js's invoke return type narrows to `never` under jest's
// strict generic inference without this widening).
type AnyJestMock = {
  mockResolvedValueOnce: (value: unknown) => AnyJestMock;
};
const mockInvoke = supabase.functions.invoke as unknown as AnyJestMock;

function mockInvokeSuccess(data: unknown): void {
  mockInvoke.mockResolvedValueOnce({ data, error: null });
}

function mockInvokeError(
  httpStatus: number,
  bodyPayload: Record<string, unknown>,
): void {
  // Mimic supabase-js FunctionsHttpError shape — error.context is a Response.
  const fakeResponse: Partial<Response> = {
    status: httpStatus,
    text: jest.fn(async () => JSON.stringify(bodyPayload)),
  };
  mockInvoke.mockResolvedValueOnce({
    data: null,
    error: { message: "request_failed", context: fakeResponse as Response },
  });
}

describe("ORCH-0875 cancelTripBookingService error mapping", () => {
  test("happy-path: preview response unwrapped to RefundPreview shape", async () => {
    mockInvokeSuccess({
      mode: "preview",
      orderId: ORDER_ID,
      eventId: "ev-1",
      quotedAt: "2026-05-18T12:00:00.000Z",
      tripStart: "2026-08-16T00:00:00.000Z",
      daysRemaining: 90,
      tierPct: 100,
      tierKind: "standard",
      paidTotalCents: 100000,
      refundTotalCents: 100000,
      currency: "GBP",
      perPaymentRefund: [
        {
          installment_id: null,
          ordinal: 0,
          source_pi: "pi_test_1",
          paid_cents: 100000,
          refund_cents: 100000,
          currency: "GBP",
          note: "deposit",
        },
      ],
      installmentsToCancel: 0,
    });
    const preview = await previewBuyerCancel(ORDER_ID, TOKEN);
    expect(preview).toMatchObject({
      mode: "preview",
      tierPct: 100,
      refundTotalCents: 100000,
      currency: "GBP",
    });
    expect(preview.perPaymentRefund).toHaveLength(1);
    expect(preview.perPaymentRefund[0].sourcePi).toBe("pi_test_1");
    expect(preview.perPaymentRefund[0].refundCents).toBe(100000);
  });

  test("policy_updated propagated: SC-22 freshness divergence produces typed error with currentRefundTotalCents", async () => {
    mockInvokeError(409, {
      error: "policy_updated",
      detail: "Cancellation policy was updated — refresh to see your new refund amount",
      currentRefundTotalCents: 50000,
      currency: "GBP",
      refundId: "refund-id-1",
    });
    let caught: CancelTripBookingError | null = null;
    try {
      await commitBuyerCancel({
        orderId: ORDER_ID,
        token: TOKEN,
        expectedRefundTotalCents: 100000,
        idempotencyKey: "idem-test-1",
      });
    } catch (err) {
      caught = err as CancelTripBookingError;
    }
    expect(caught).not.toBeNull();
    expect(caught?.code).toBe("policy_updated");
    expect(caught?.currentRefundTotalCents).toBe(50000);
    expect(caught?.httpStatus).toBe(409);
  });

  test("invalid_token mapped to 401-class CancelTripBookingError", async () => {
    mockInvokeError(401, {
      error: "invalid_token",
      detail: "buyer cancel token invalid or missing",
    });
    let caught: CancelTripBookingError | null = null;
    try {
      await previewBuyerCancel(ORDER_ID, "bad-token");
    } catch (err) {
      caught = err as CancelTripBookingError;
    }
    expect(caught).not.toBeNull();
    expect(caught?.code).toBe("invalid_token");
  });

  test("already_cancelled mapped from 409 (distinct from policy_updated)", async () => {
    mockInvokeError(409, {
      error: "already_cancelled",
      detail: "Order is already cancelled",
    });
    let caught: CancelTripBookingError | null = null;
    try {
      await previewBuyerCancel(ORDER_ID, TOKEN);
    } catch (err) {
      caught = err as CancelTripBookingError;
    }
    expect(caught).not.toBeNull();
    expect(caught?.code).toBe("already_cancelled");
    // No currentRefundTotalCents here — distinct error path.
    expect(caught?.currentRefundTotalCents).toBeUndefined();
  });
});
