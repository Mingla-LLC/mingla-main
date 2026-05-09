import { describe, expect, test } from "@jest/globals";

import { settleStripeStatus } from "../stripeStatusSettlement";

describe("settleStripeStatus", () => {
  test("polls through stale onboarding until restricted is visible", async () => {
    const responses = [
      { status: "onboarding" as const },
      {
        status: "restricted" as const,
        requirements: { disabled_reason: "requirements.past_due" },
      },
    ];
    const sleeps: number[] = [];
    const result = await settleStripeStatus(
      async () => ({ data: responses.shift() }),
      {
        maxAttempts: 3,
        intervalMs: 2000,
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      },
    );

    expect(result?.status).toBe("restricted");
    expect(sleeps).toEqual([2000]);
  });

  test("returns final onboarding result after bounded attempts", async () => {
    let calls = 0;
    const result = await settleStripeStatus(
      async () => {
        calls += 1;
        return { data: { status: "onboarding" as const } };
      },
      {
        maxAttempts: 2,
        intervalMs: 100,
        sleep: async () => undefined,
      },
    );

    expect(result?.status).toBe("onboarding");
    expect(calls).toBe(2);
  });

  test("polls through pending verification instead of stopping on it", async () => {
    const responses = [
      {
        status: "restricted" as const,
        requirements: { disabled_reason: "requirements.pending_verification" },
      },
      { status: "active" as const },
    ];
    const sleeps: number[] = [];

    const result = await settleStripeStatus(
      async () => ({ data: responses.shift() }),
      {
        maxAttempts: 3,
        intervalMs: 2000,
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      },
    );

    expect(result?.status).toBe("active");
    expect(sleeps).toEqual([2000]);
  });
});
