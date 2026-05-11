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

  test("passes explicit bearer token to the balances edge function", async () => {
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
      fetchBrandStripeBalances("brand-1", "access-token-1"),
    ).resolves.toMatchObject({ currency: "USD" });
    expect(invoke).toHaveBeenCalledWith("brand-stripe-balances", {
      body: { brand_id: "brand-1" },
      headers: { Authorization: "Bearer access-token-1" },
    });
  });
});
