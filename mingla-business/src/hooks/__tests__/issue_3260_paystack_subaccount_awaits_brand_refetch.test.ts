/**
 * #3260 [paystack-connect-false-negative] — the cache-ordering half of the fix.
 *
 * `useCreatePaystackSubaccount` resolving is the signal the connect journey
 * uses to navigate out of the onboarding screen and back into the brand wizard.
 * When its `onSuccess` fired the brandKeys.detail invalidation and resolved
 * immediately, the remounted wizard read the PRE-CONNECT cached row — already
 * `isFetched`, so indistinguishable from fresh — and reported "Payout setup
 * wasn't finished" over a connect that had returned 200 and written both rows.
 *
 * `awaitBrandDetailRefresh` is the boundary that guarantee lives on:
 *   1. it does not resolve until the canonical brand refetch has settled, and
 *   2. it NEVER rejects — a rejection inside onSuccess surfaces as a mutation
 *      error, which would convert a successful connect back into a reported
 *      failure: the exact lie this issue exists to kill.
 */

import { describe, expect, test } from "@jest/globals";

import { awaitBrandDetailRefresh } from "../useBrandPaystack";
import { brandKeys } from "../useBrands";

type InvalidateArgs = { queryKey: readonly unknown[] };

function fakeClient(behaviour: {
  settle: () => Promise<void>;
}): { invalidateQueries: (args: InvalidateArgs) => Promise<void>; seen: InvalidateArgs[] } {
  const seen: InvalidateArgs[] = [];
  return {
    seen,
    invalidateQueries: (args: InvalidateArgs) => {
      seen.push(args);
      return behaviour.settle();
    },
  };
}

const BRAND_ID = "e79fdb72-c6d6-4a4e-b3b3-4c75580a2b0a";

describe("#3260 the subaccount mutation waits for the canonical brand row", () => {
  test("it targets brandKeys.detail and does not resolve before the refetch settles", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const client = fakeClient({ settle: () => gate });

    let resolved = false;
    const pending = awaitBrandDetailRefresh(
      client as unknown as Parameters<typeof awaitBrandDetailRefresh>[0],
      BRAND_ID,
    ).then(() => {
      resolved = true;
    });

    // Give the microtask queue every chance to resolve early.
    await Promise.resolve();
    await Promise.resolve();
    // FAILS ON REVERT: a fire-and-forget onSuccess resolves here, which is
    // precisely what let the wizard navigate onto a stale cache.
    expect(resolved).toBe(false);

    release();
    await pending;
    expect(resolved).toBe(true);

    expect(client.seen).toHaveLength(1);
    expect(client.seen[0]?.queryKey).toEqual(brandKeys.detail(BRAND_ID));
  });

  test("a failed refetch resolves instead of rejecting, so a real connect is never reported as failed", async () => {
    const client = fakeClient({
      settle: () => Promise.reject(new Error("network down")),
    });

    await expect(
      awaitBrandDetailRefresh(
        client as unknown as Parameters<typeof awaitBrandDetailRefresh>[0],
        BRAND_ID,
      ),
    ).resolves.toBeUndefined();
  });
});
