/**
 * ORCH-1140 — TESTER ADVERSARIAL angle (separate from the implementor's
 * happy-path T-3..T-8 in brandStripeDetachService.orch1140.test.ts).
 *
 * The implementor proved: success resolves, a pre-baked rejection maps, a
 * missing detached_at on the SUCCEEDED path resolves, not_connected resolves,
 * and error/null/unrecognized throw.
 *
 * This file attacks the BOUNDARIES the implementor did NOT exercise, all of
 * which protect the dual guarantee of this ORCH — "the false-failure is gone"
 * AND "a real failure still surfaces honestly":
 *
 *  A. The Stripe-REJECTION + missing-field boundary: a 200 status:detached body
 *     that is `rejected` but OMITS rejection_reason must STILL resolve with a
 *     null reason (NO fabricated reason — Const #9). And a `rejected` body that
 *     also omits detached_at must STILL resolve (hardening must not regress on
 *     the rejection path, only the succeeded path).
 *  B. The genuine-error-NOT-swallowed boundary: when supabase.functions.invoke
 *     returns a non-null `error` (the real non-2xx signal) the wrapper MUST
 *     throw EVEN IF `data` happens to carry a success-looking status:detached
 *     body. A real failure must never be swallowed as success.
 *  C. The not_connected drift boundary: not_connected with NO detached_at still
 *     resolves benignly (the second latent 200 path).
 *
 * Fails-on-revert: restoring the old strict `typeof data.detached_at !== "string"`
 * throw breaks A (the missing-field rejection/null cases throw), and the prior
 * code had no status-aware branch so B's error path is the shared guard.
 */
import { describe, expect, jest, test } from "@jest/globals";

jest.mock("../supabase", () => ({
  supabase: {
    functions: {
      invoke: jest.fn(),
    },
  },
}));

import { detachBrandStripe } from "../brandStripeDetachService";
import { supabase } from "../supabase";

const invoke = supabase.functions.invoke as jest.MockedFunction<
  typeof supabase.functions.invoke
>;

describe("brandStripeDetachService — ORCH-1140 adversarial boundaries", () => {
  // A1: rejected outcome with NO rejection_reason → resolve, reason === null.
  // Must NOT fabricate a reason (Const #9) and must NOT false-fail (the whole
  // point of the ORCH: a Stripe rejection is an HONEST partial success).
  test("rejected body missing rejection_reason resolves with null reason (no fabrication)", async () => {
    invoke.mockResolvedValueOnce({
      data: {
        ok: true,
        status: "detached",
        detached_at: "2026-06-15T13:45:53.592Z",
        stripe_delete_status: "rejected",
        // rejection_reason intentionally ABSENT
      },
      error: null,
    } as never);

    const result = await detachBrandStripe("brand-1");
    expect(result.stripeDeleteStatus).toBe("rejected");
    expect(result.rejectionReason).toBeNull();
    expect(result.detachedAt).toBe("2026-06-15T13:45:53.592Z");
  });

  // A2: rejected outcome that ALSO omits detached_at → still resolves (the
  // hardening must hold on the rejection path, not only the succeeded path).
  test("rejected body missing detached_at still resolves (hardening on rejection path)", async () => {
    invoke.mockResolvedValueOnce({
      data: {
        ok: true,
        status: "detached",
        stripe_delete_status: "rejected",
        rejection_reason: "Your account has a positive balance.",
        // detached_at intentionally ABSENT
      },
      error: null,
    } as never);

    const result = await detachBrandStripe("brand-1");
    expect(result.stripeDeleteStatus).toBe("rejected");
    expect(result.rejectionReason).toBe("Your account has a positive balance.");
    expect(typeof result.detachedAt).toBe("string");
    expect(result.detachedAt.length).toBeGreaterThan(0);
  });

  // B: a GENUINE error must win even when data looks like success. A non-2xx
  // (error != null) carrying a status:detached body MUST still throw — never
  // swallow a real failure as a successful detach.
  test("non-null error throws even when data carries a success-looking body", async () => {
    invoke.mockResolvedValueOnce({
      data: {
        ok: true,
        status: "detached",
        detached_at: "2026-06-15T13:45:53.592Z",
        stripe_delete_status: "succeeded",
        rejection_reason: null,
      },
      error: new Error("FunctionsHttpError: edge function returned 500"),
    } as never);

    await expect(detachBrandStripe("brand-1")).rejects.toThrow(
      "FunctionsHttpError",
    );
  });

  // C: not_connected with NO detached_at (drift) still resolves benignly.
  test("not_connected body missing detached_at still resolves benignly", async () => {
    invoke.mockResolvedValueOnce({
      data: {
        ok: true,
        status: "not_connected",
        // detached_at, stripe_delete_status both ABSENT
      },
      error: null,
    } as never);

    const result = await detachBrandStripe("brand-1");
    expect(result.stripeDeleteStatus).toBe("skipped"); // ?? fallback, not thrown
    expect(typeof result.detachedAt).toBe("string");
  });

  // D: an explicitly UNKNOWN status string (not detached/not_connected) must
  // still throw — the success gate is exact, so a future renamed status can't
  // silently pass as success.
  test("an unknown status string throws (success gate is exact)", async () => {
    invoke.mockResolvedValueOnce({
      data: {
        ok: true,
        status: "soft_detached_v2", // not a recognized success status
        detached_at: "2026-06-15T13:45:53.592Z",
      },
      error: null,
    } as never);

    await expect(detachBrandStripe("brand-1")).rejects.toThrow(
      "unexpected response shape",
    );
  });
});
