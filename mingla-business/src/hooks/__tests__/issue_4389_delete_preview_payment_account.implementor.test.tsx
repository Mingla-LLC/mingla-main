/**
 * #4389 P2 — the delete preview said "Payment account: None" for a started
 * (restricted) payment account. `useBrandCascadePreview` counted only
 * active/onboarding as an account; brand delete closes ANY undetached account,
 * so every state but not_connected (which is also what a detached account
 * derives to) must read "Will be closed when you delete".
 *
 * FAILS ON REVERT: `derivedStatus === "active" || derivedStatus === "onboarding"`
 * → the restricted case reads false.
 */
import { describe, expect, jest, test } from "@jest/globals";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

let mockDerived = "restricted";
jest.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "acct-4389" }, isAuthReady: true }),
}));
jest.mock("../../diagnostics/sentry", () => ({ captureException: jest.fn() }));
jest.mock("../../services/supabase", () => {
  const chain = (): unknown =>
    new Proxy(
      {},
      {
        get: (_t, key) =>
          key === "then"
            ? (resolve: (v: unknown) => void) => resolve({ count: 0, error: null })
            : () => chain(),
      },
    );
  return {
    supabase: {
      from: () => chain(),
      rpc: () => Promise.resolve({ data: mockDerived, error: null }),
      channel: jest.fn(),
      removeChannel: jest.fn(),
    },
  };
});

/* eslint-disable import/first */
import { useBrandCascadePreview, type BrandCascadePreviewCounts } from "../useBrands";
/* eslint-enable import/first */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create(el: React.ReactElement): { unmount(): void };
  act(cb: () => void | Promise<void>): Promise<void> | void;
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function preview(derived: string): Promise<BrandCascadePreviewCounts | null | undefined> {
  mockDerived = derived;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let latest: BrandCascadePreviewCounts | null | undefined;
  const Probe = (): null => {
    latest = useBrandCascadePreview("43890000-0000-4000-8000-0000000000d1").data;
    return null;
  };
  let r: { unmount(): void } | null = null;
  await TestRenderer.act(async () => {
    r = TestRenderer.create(
      <QueryClientProvider client={qc}>
        <Probe />
      </QueryClientProvider>,
    );
  });
  await TestRenderer.act(async () => {
    for (let i = 0; i < 5; i += 1) await new Promise<void>((res) => setTimeout(res, 0));
  });
  await TestRenderer.act(() => (r as unknown as { unmount(): void }).unmount());
  qc.clear();
  return latest;
}

describe("#4389 P2 — the delete preview names every undetached payment account", () => {
  test.each(["restricted", "onboarding", "active"])("%s → will be closed when you delete", async (derived) => {
    expect((await preview(derived))?.hasStripeConnect).toBe(true);
  });
  test("not_connected (none, or detached) → None", async () => {
    expect((await preview("not_connected"))?.hasStripeConnect).toBe(false);
  });
});
