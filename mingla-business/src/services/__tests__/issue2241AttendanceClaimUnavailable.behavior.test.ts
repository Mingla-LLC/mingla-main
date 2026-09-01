import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const mockInvoke = jest.fn();

jest.mock("../supabase", () => ({
  supabase: {
    functions: {
      invoke: (...args: unknown[]) =>
        (mockInvoke as unknown as (...values: unknown[]) => unknown)(...args),
    },
  },
}));

import {
  createAttendanceClaimLink,
} from "../attendanceClaimLinkService";

const functionError = (status: number, error: string): {
  context: { status: number; clone: () => { json: () => Promise<{ error: string }> } };
} => ({
  context: {
    status,
    clone: () => ({ json: async () => ({ error }) }),
  },
});

beforeEach(() => {
  mockInvoke.mockReset();
});

describe("#2241 attendance claim configuration mapping", () => {
  test("a real 503 payload becomes the bounded configuration error", async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: functionError(503, "claim_link_temporarily_unavailable"),
    } as never);

    await expect(
      createAttendanceClaimLink("checkout-session", "buyer-possession-proof"),
    ).rejects.toMatchObject({
      code: "configuration",
      name: "Error",
    });
    expect(mockInvoke).toHaveBeenCalledWith("attendance-claim-link", {
      body: {
        checkoutSessionId: "checkout-session",
        buyerStatusToken: "buyer-possession-proof",
      },
    });
  });

  test("a different 503 stays retryable network failure", async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: functionError(503, "upstream_unavailable"),
    } as never);

    await expect(
      createAttendanceClaimLink("checkout-session", "buyer-possession-proof"),
    ).rejects.toMatchObject({ code: "network" });
  });
});
