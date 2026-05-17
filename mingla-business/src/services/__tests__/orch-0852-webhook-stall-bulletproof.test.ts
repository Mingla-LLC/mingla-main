/**
 * ORCH-0852 [Buyer-web confirmation QR clipped + wallet passes inert +
 * in-app-browser stuck after payment] — ADVERSARIAL regression test.
 *
 * Paired with the implementor's happy-path test at
 * `orch-0852-bulletproof-confirm.test.ts`. This file attacks a different
 * angle: the SPECIFIC failure mode that bug-reporter Seth experienced
 * before ORCH-0852 shipped, modelled as a Jest fault injection:
 *
 *   - Stripe webhook hasn't yet finalized the order (`order: null`)
 *   - Stripe API itself is unavailable (502 stripe_unavailable from the
 *     edge function)
 *
 * The bulletproof contract requires that under BOTH conditions, the
 * client-side service surface is honest:
 *
 *   1. A `status: "pending"` response with `order: null` must be returned
 *      to the caller — NOT a thrown error. This is the signal that lets
 *      the caller fall through to the Realtime safety net rather than
 *      showing an error toast.
 *
 *   2. A 502 from the edge function (Stripe outage) must propagate as a
 *      thrown error — NOT silently coerced to a fake-success shape. The
 *      caller catches this and falls through to Realtime, but the error
 *      surface must remain truthful.
 *
 *   3. The service wrapper must NOT introduce any internal retry, timeout,
 *      or backoff that competes with the architectural fall-through. A
 *      lone, fast, single edge invocation is the contract — the
 *      `useOrderRealtimeSubscription` hook is the only safety net.
 *
 * Why the adversarial angle is "different" from the happy-path test:
 *
 *   - Happy-path test (T-0852-1..4): proves the function exists, invokes
 *     the right edge function with the right body shape, and surfaces
 *     well-formed responses. Mocks return valid shapes.
 *   - Adversarial test (T-0852-ADV-*): proves the function survives the
 *     adversarial inputs that caused production stranding pre-ORCH-0852
 *     — server returning the exact "pending forever" shape and the exact
 *     Stripe-outage error envelope. Mocks return failure shapes.
 *
 * The two tests would not both pass on the SAME code regression: a
 * regression that drops `confirmTicketCheckout` fails T-0852-1 (happy);
 * a regression that adds an internal retry-loop to the service wrapper
 * fails T-0852-ADV-3 (this file). They cover orthogonal failure surfaces.
 *
 * Fails-on-revert verification (per ORCH-0840 [Regression-test enforcement
 * + append-only CI] Step 0.5):
 *
 *   T-0852-ADV-1 asserts that `confirmTicketCheckout` returns the pending
 *   response with `order === null` verbatim. Pre-ORCH-0852, the
 *   `pollTicketCheckoutStatus` function would have looped 7 times over
 *   16.5 seconds and returned `null` instead of a structured pending
 *   response — making this test fail with a type/structure mismatch.
 *
 *   T-0852-ADV-3 asserts a single `invoke` call. A regression that
 *   reintroduces polling (multiple invokes) fails immediately.
 */

import { describe, expect, jest, test, beforeEach } from "@jest/globals";

type InvokeResult = { data: unknown; error: Error | null };
const mockInvoke = jest.fn<(name: string, opts: { body: unknown }) => Promise<InvokeResult>>();
jest.mock("../supabase", () => ({
  supabase: {
    functions: {
      invoke: mockInvoke,
    },
  },
}));

import {
  confirmTicketCheckout,
  type TicketCheckoutConfirmResult,
} from "../ticketCheckoutService";

describe("ORCH-0852 — adversarial webhook-stall + Stripe-outage scenarios", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  test("T-0852-ADV-1 webhook stalled — server returns pending; client receives structured pending response (NOT a thrown error, NOT a fake-success)", async () => {
    const pendingResponse: TicketCheckoutConfirmResult = {
      checkoutSessionId: "session-stalled-webhook",
      status: "pending",
      order: null,
    };
    mockInvoke.mockResolvedValueOnce({ data: pendingResponse, error: null });

    const result = await confirmTicketCheckout(
      "session-stalled-webhook",
      "token-xyz",
    );

    // Critical: status must be exactly "pending", order must be null.
    // This is the signal the caller uses to mount the Realtime safety net.
    // Any regression that coerces this to a thrown error OR a fake-paid
    // response breaks the architectural contract.
    expect(result).toEqual(pendingResponse);
    expect(result.status).toBe("pending");
    expect(result.order).toBeNull();
    expect(result.checkoutSessionId).toBe("session-stalled-webhook");
  });

  test("T-0852-ADV-2 Stripe API outage — server returns 502 envelope; client throws (NOT silently surfaces as success)", async () => {
    // Stripe-outage path: edge function caught a Stripe SDK throw and
    // returned { error: "stripe_unavailable" } with HTTP 502. The
    // supabase-js client surfaces this as an `error` field on the invoke
    // result. Our service wrapper's invokeOrThrow re-throws.
    const stripeOutageError = new Error("stripe_unavailable");
    mockInvoke.mockResolvedValueOnce({ data: null, error: stripeOutageError });

    await expect(
      confirmTicketCheckout("session-outage", "token-xyz"),
    ).rejects.toThrow("stripe_unavailable");

    // Critical: the wrapper must throw, NOT return a coerced success
    // shape. The caller catches and falls through to Realtime — but
    // ONLY if the wrapper is honest about the failure.
  });

  test("T-0852-ADV-3 no internal retries — single edge invocation per call, regardless of response shape", async () => {
    // The bulletproof contract is: one synchronous attempt + fall-through
    // to Realtime. The service wrapper MUST NOT internally retry, loop,
    // back off, or otherwise hide failure from the caller. Internal
    // retries would (a) waste request budget when the webhook is the
    // real bottleneck and (b) mask the failure signal the Realtime
    // safety net needs to mount.
    const pendingResponse: TicketCheckoutConfirmResult = {
      checkoutSessionId: "session-no-retry",
      status: "pending",
      order: null,
    };
    mockInvoke.mockResolvedValue({ data: pendingResponse, error: null });

    await confirmTicketCheckout("session-no-retry", "token-xyz");

    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  test("T-0852-ADV-4 client-failed PI — server returns status: failed; client receives it as a normal response (caller renders error UI)", async () => {
    // Edge case: Stripe PI status === "canceled" / "requires_payment_method".
    // Server returns { status: "failed", order: null }. This must surface
    // to the caller as a normal response (so the caller can render a
    // specific "card declined" error UI), NOT a thrown error (which
    // would land in the catch-and-fall-through-to-Realtime path and
    // hide a permanent failure behind the wrong UX).
    const failedResponse: TicketCheckoutConfirmResult = {
      checkoutSessionId: "session-declined",
      status: "failed",
      order: null,
    };
    mockInvoke.mockResolvedValueOnce({ data: failedResponse, error: null });

    const result = await confirmTicketCheckout(
      "session-declined",
      "token-xyz",
    );

    expect(result.status).toBe("failed");
    expect(result.order).toBeNull();
    // Verified NOT thrown — got past the await.
  });

  test("T-0852-ADV-5 expired session — server returns status: expired; surfaces unchanged", async () => {
    // ticket_checkout_sessions has a tombstone status from ORCH-0829-B
    // D-1. A buyer returning to a stale `?cs=` link must see a clean
    // "expired" surface from the wrapper, not a thrown error.
    const expiredResponse: TicketCheckoutConfirmResult = {
      checkoutSessionId: "session-expired",
      status: "expired",
      order: null,
    };
    mockInvoke.mockResolvedValueOnce({ data: expiredResponse, error: null });

    const result = await confirmTicketCheckout(
      "session-expired",
      "token-xyz",
    );

    expect(result.status).toBe("expired");
    expect(result.order).toBeNull();
  });
});
