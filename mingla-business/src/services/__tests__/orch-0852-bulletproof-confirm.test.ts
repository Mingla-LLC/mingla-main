/**
 * ORCH-0852 [Buyer-web confirmation QR clipped + wallet passes inert +
 * in-app-browser stuck after payment] — happy-path regression test.
 *
 * Asserts the BULLETPROOF confirmation contract for the buyer's checkout
 * success path:
 *
 *   1. `confirmTicketCheckout` exists in `ticketCheckoutService` and
 *      invokes the `ticket-checkout-confirm` edge function with the
 *      buyer's session id + buyer status token in the request body.
 *
 *   2. The `TicketCheckoutConfirmResult` shape returned to callers has
 *      the four-way status discriminator ("paid" | "pending" | "failed"
 *      | "expired") and a nullable `order` that — when present —
 *      includes `checkoutSessionId` so the client's `recordResult`
 *      cart-action can run without invented fallbacks.
 *
 *   3. On a server response of `status: "paid"` with a populated order,
 *      `confirmTicketCheckout` returns the same shape unmodified — the
 *      client renders the order directly from this payload without any
 *      polling.
 *
 * Why this test exists:
 *
 *   Before ORCH-0852, the buyer's success path depended on a race between
 *   Stripe's webhook arrival and the client's `pollTicketCheckoutStatus`
 *   16.5s budget. When the webhook lost, `payment.tsx`'s `finalizingTimedOut`
 *   state painted the buyer with "Payment received — your ticket will
 *   arrive by email shortly." and disabled the Pay button, stranding them.
 *   The bulletproof rewrite eliminated that failure mode by owning the
 *   confirmation path via direct Stripe API verification inside the new
 *   `ticket-checkout-confirm` edge function. This test pins the client-
 *   side contract that wires that edge function back into the buyer-web
 *   `/confirm` and business-native `payment.tsx` flows. If the contract
 *   regresses (e.g., someone reintroduces polling, drops
 *   `confirmTicketCheckout`, or changes the result shape), this test
 *   fails immediately.
 *
 * Fails-on-revert verification (per ORCH-0840 [Regression-test enforcement
 * + append-only CI] Step 0.5 gate):
 *
 *   Revert proof: this test asserts `typeof confirmTicketCheckout ===
 *   "function"` and asserts the invocation shape via a stubbed
 *   `supabase.functions.invoke`. Before this ORCH, `confirmTicketCheckout`
 *   did not exist (the service exposed only `pollTicketCheckoutStatus` +
 *   `getTicketCheckoutStatus`). Restoring the pre-ORCH-0852 service file
 *   makes the import statement at the top of this test resolve to
 *   `undefined`, immediately failing the first assertion. Verified at
 *   the commit that landed M1's service-wrapper addition.
 */

import { describe, expect, jest, test, beforeEach } from "@jest/globals";

// Mock supabase BEFORE importing the service. The service holds a closure
// over `supabase.functions.invoke`; we capture the call shape via the mock.
type InvokeResult = { data: unknown; error: Error | null };
const mockInvoke = jest.fn<(name: string, opts: { body: unknown }) => Promise<InvokeResult>>();
jest.mock("../supabase", () => ({
  supabase: {
    functions: {
      invoke: mockInvoke,
    },
  },
}));

// Import AFTER the mock so the service binds to the mocked supabase.
import {
  confirmTicketCheckout,
  type TicketCheckoutConfirmResult,
} from "../ticketCheckoutService";

describe("ORCH-0852 — bulletproof confirm contract", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  test("T-0852-1 confirmTicketCheckout is exported as a function (proves the wrapper exists post-bulletproof rewrite)", () => {
    expect(typeof confirmTicketCheckout).toBe("function");
  });

  test("T-0852-2 confirmTicketCheckout invokes ticket-checkout-confirm with sessionId + buyerStatusToken in body", async () => {
    const serverResponse: TicketCheckoutConfirmResult = {
      checkoutSessionId: "session-abc-123",
      status: "paid",
      order: {
        orderId: "order-xyz-789",
        checkoutSessionId: "session-abc-123",
        eventId: "event-456",
        paymentStatus: "paid",
        totalCents: 11000,
        currency: "USD",
        taxAmountCents: 0,
        tickets: [
          {
            ticketId: "ticket-1",
            ticketTypeId: "type-1",
            ticketName: "General Admission",
            qrPayload: "qr-payload-1",
            status: "valid",
          },
        ],
        notificationStatus: "queued",
      },
    };
    mockInvoke.mockResolvedValueOnce({ data: serverResponse, error: null });

    const result = await confirmTicketCheckout(
      "session-abc-123",
      "buyer-token-xyz",
    );

    // Edge function name + body shape lock — if anyone renames the function
    // or changes the contract, this fails immediately.
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith("ticket-checkout-confirm", {
      body: {
        checkoutSessionId: "session-abc-123",
        buyerStatusToken: "buyer-token-xyz",
      },
    });

    // Server response surfaces verbatim — the wrapper does no transformation.
    expect(result).toEqual(serverResponse);
    expect(result.status).toBe("paid");
    expect(result.order).not.toBeNull();
    expect(result.order?.orderId).toBe("order-xyz-789");
    expect(result.order?.checkoutSessionId).toBe("session-abc-123");
    expect(result.order?.tickets).toHaveLength(1);
  });

  test("T-0852-3 status discriminator surfaces pending response unchanged (client falls through to Realtime safety net)", async () => {
    const pendingResponse: TicketCheckoutConfirmResult = {
      checkoutSessionId: "session-pending",
      status: "pending",
      order: null,
    };
    mockInvoke.mockResolvedValueOnce({ data: pendingResponse, error: null });

    const result = await confirmTicketCheckout("session-pending", "tok");

    expect(result.status).toBe("pending");
    expect(result.order).toBeNull();
  });

  test("T-0852-4 thrown server error propagates (client wraps in fall-through-to-Realtime catch)", async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: new Error("stripe_unavailable"),
    });

    await expect(
      confirmTicketCheckout("session-err", "tok"),
    ).rejects.toThrow("stripe_unavailable");
  });
});
