/**
 * ORCH-1140 — brandStripeDetachService response-contract regression.
 *
 * Binds the §9 fails-on-revert contract: a 200 success body resolves (never
 * false-fails a completed detach), and the client hardening tolerates a
 * missing detached_at (future shape drift) while still throwing on genuine
 * errors / unrecognized bodies.
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

describe("brandStripeDetachService (ORCH-1140)", () => {
  // T-3: client RESOLVES on a compliant success 200 body, returning real values.
  test("resolves on a status:detached success body with detached_at", async () => {
    invoke.mockResolvedValueOnce({
      data: {
        ok: true,
        status: "detached",
        detached_at: "2026-06-15T13:45:53.592Z",
        stripe_delete_status: "succeeded",
        rejection_reason: null,
      },
      error: null,
    } as never);

    await expect(detachBrandStripe("brand-1")).resolves.toEqual({
      detachedAt: "2026-06-15T13:45:53.592Z",
      stripeDeleteStatus: "succeeded",
      rejectionReason: null,
    });
  });

  // T-4: a genuine Stripe rejection maps through to the client.
  test("maps a Stripe rejection (status + reason)", async () => {
    invoke.mockResolvedValueOnce({
      data: {
        ok: true,
        status: "detached",
        detached_at: "2026-06-15T13:45:53.592Z",
        stripe_delete_status: "rejected",
        rejection_reason: "balance_remaining",
      },
      error: null,
    } as never);

    await expect(detachBrandStripe("brand-1")).resolves.toMatchObject({
      stripeDeleteStatus: "rejected",
      rejectionReason: "balance_remaining",
    });
  });

  // T-5 (HARDENING — fails on revert): a status:detached 200 body that OMITS
  // detached_at must still RESOLVE (client timestamp fallback). Reverting to
  // the old strict `typeof data.detached_at !== "string"` throw breaks this.
  test("resolves even when detached_at is missing (drift hardening)", async () => {
    invoke.mockResolvedValueOnce({
      data: {
        ok: true,
        status: "detached",
        stripe_delete_status: "succeeded",
      },
      error: null,
    } as never);

    const result = await detachBrandStripe("brand-1");
    expect(typeof result.detachedAt).toBe("string");
    expect(result.detachedAt.length).toBeGreaterThan(0);
    expect(result.stripeDeleteStatus).toBe("succeeded");
  });

  // T-8: not_connected is benign success.
  test("resolves benignly on a not_connected body", async () => {
    invoke.mockResolvedValueOnce({
      data: {
        ok: true,
        status: "not_connected",
        detached_at: "2026-06-15T13:45:53.592Z",
        stripe_delete_status: "skipped",
        rejection_reason: null,
      },
      error: null,
    } as never);

    await expect(detachBrandStripe("brand-1")).resolves.toMatchObject({
      stripeDeleteStatus: "skipped",
    });
  });

  // T-6: a true edge-fn error still throws.
  test("throws on a non-2xx edge-fn error", async () => {
    invoke.mockResolvedValueOnce({
      data: null,
      error: new Error("boom"),
    } as never);

    await expect(detachBrandStripe("brand-1")).rejects.toThrow("boom");
  });

  // T-7: an unrecognized body (no success status) still throws.
  test("throws on an unrecognized response shape", async () => {
    invoke.mockResolvedValueOnce({
      data: { ok: false },
      error: null,
    } as never);

    await expect(detachBrandStripe("brand-1")).rejects.toThrow(
      "unexpected response shape",
    );
  });

  // null body still throws.
  test("throws on a null body", async () => {
    invoke.mockResolvedValueOnce({
      data: null,
      error: null,
    } as never);

    await expect(detachBrandStripe("brand-1")).rejects.toThrow(
      "returned null",
    );
  });
});
