import { describe, expect, jest, test } from "@jest/globals";

jest.mock("../supabase", () => ({
  supabase: {
    functions: {
      invoke: jest.fn(),
    },
  },
}));

import {
  fetchBrandStripeBalances,
  parseBrandStripeBalancesResponse,
} from "../brandStripeBalancesService";
import { supabase } from "../supabase";

describe("brandStripeBalancesService", () => {
  test("accepts the snake_case edge contract and exposes camelCase client fields", () => {
    expect(
      parseBrandStripeBalancesResponse({
        currency: "USD",
        available_minor: 12345,
        pending_minor: 678,
        retrieved_at: "2026-05-09T12:00:00.000Z",
      }),
    ).toEqual({
      currency: "USD",
      availableMinor: 12345,
      pendingMinor: 678,
      retrievedAt: "2026-05-09T12:00:00.000Z",
    });
  });

  test("rejects the old camelCase-only edge payload", () => {
    expect(() =>
      parseBrandStripeBalancesResponse({
        currency: "USD",
      } as never),
    ).toThrow("malformed payload");
  });

  // [TEST-MOD-APPROVED META-ORCH-1073-Sub-A5] — the function no longer passes a
  // custom Authorization header (that sent a stale useAuth() token → 401). It
  // now relies on supabase.functions.invoke's own auto-refreshed session token,
  // so the invoke must be called with NO custom headers.
  test("invokes the balances edge fn without a custom auth header (uses client session)", async () => {
    const invoke = supabase.functions.invoke as jest.MockedFunction<
      typeof supabase.functions.invoke
    >;
    invoke.mockResolvedValueOnce({
      data: {
        currency: "USD",
        available_minor: 0,
        pending_minor: 0,
        retrieved_at: "2026-05-09T12:00:00.000Z",
      },
      error: null,
    });

    await expect(
      fetchBrandStripeBalances("brand-1"),
    ).resolves.toMatchObject({ currency: "USD" });
    expect(invoke).toHaveBeenCalledWith("brand-stripe-balances", {
      body: { brand_id: "brand-1" },
    });
  });
});
