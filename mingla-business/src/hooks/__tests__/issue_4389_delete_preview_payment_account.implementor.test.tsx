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
let mockBrandRow: { payment_provider: string; paystack_subaccount_code: string | null } | null = null;
let mockRecipient = false;
jest.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "acct-4389" }, isAuthReady: true }),
}));
jest.mock("../../diagnostics/sentry", () => ({ captureException: jest.fn() }));
jest.mock("../../services/supabase", () => {
  const chain = (table: string): unknown =>
    new Proxy(
      {},
      {
        get: (_t, key) =>
          key === "then"
            ? (resolve: (v: unknown) => void) =>
                resolve(table === "brands" ? { data: mockBrandRow, error: null } : { count: 0, error: null })
            : () => chain(table),
      },
    );
  return {
    supabase: {
      from: (table: string) => chain(table),
      rpc: (name: string) =>
        Promise.resolve({
          data: name === "biz_brand_has_active_paystack_recipient" ? mockRecipient : mockDerived,
          error: null,
        }),
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

  // #4389 D1 — the Nigerian bank rail: a boolean only, never the code.
  test("Paystack brand with a subaccount → bank payouts will be switched off (boolean only)", async () => {
    mockBrandRow = { payment_provider: "paystack", paystack_subaccount_code: "ACCT_secret" };
    mockRecipient = false;
    const p = await preview("not_connected");
    expect(p?.isPaystackBrand).toBe(true);
    expect(p?.hasBankPayouts).toBe(true);
    expect(JSON.stringify(p)).not.toContain("ACCT_");
  });
  test("Paystack brand with only an active recipient → switched off; with neither → none", async () => {
    mockBrandRow = { payment_provider: "paystack", paystack_subaccount_code: null };
    mockRecipient = true;
    expect((await preview("not_connected"))?.hasBankPayouts).toBe(true);
    mockRecipient = false;
    expect((await preview("not_connected"))?.hasBankPayouts).toBe(false);
  });
  test("a card-rail brand is not a Paystack brand", async () => {
    mockBrandRow = { payment_provider: "stripe", paystack_subaccount_code: null };
    mockRecipient = false;
    expect((await preview("active"))?.isPaystackBrand).toBe(false);
    mockBrandRow = null;
  });
});
