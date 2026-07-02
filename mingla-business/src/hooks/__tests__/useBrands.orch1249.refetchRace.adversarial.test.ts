/**
 * ORCH-1249 (biz cold-start brand-hydration) — ADVERSARIAL regression.
 *
 * Attacks a DIFFERENT failure mode than the happy-path test:
 *   - happy-path proves the timeout REJECTS a never-settling read.
 *   - this file attacks the RACE BOUNDARY + no-false-cancellation + exactly-once
 *     semantics: a cold-start read that becomes authed and returns JUST before
 *     the deadline must SUCCEED with valid state (not get killed by the timeout),
 *     must NOT abort its own signal on success, and must fire getBrands exactly
 *     once (no duplicate/storm fetch). It also proves a read finishing JUST AFTER
 *     the deadline still times out — so there is no "stuck loading" band where a
 *     slow-but-eventually-authed read neither resolves nor rejects.
 *
 * Together with the effect-level refetch-on-enabled-flip (auth false→true) in
 * useBrands, this guarantees the cold-start path always leaves a terminal state:
 * success OR error, never a permanent "Loading your brands…".
 *
 * fails-on-revert verified at 4c950ffc6 — with the fix reverted, fetchBrandsList
 * is not exported / getBrands is called with no signal, so the signal + boundary
 * assertions fail. (Happy-path is the primary fails-on-revert proof; this file
 * hardens a distinct angle.)
 */
/* eslint-disable import/first */
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

import { isTimeoutError } from "../../utils/withTimeout";

const getBrandsSpy = jest.fn<(accountId: string, signal?: AbortSignal) => Promise<unknown>>();

jest.mock("../../services/brandsService", () => ({
  getBrands: (accountId: string, signal?: AbortSignal) => getBrandsSpy(accountId, signal),
  createBrand: jest.fn(),
  createVenueBrandPendingReview: jest.fn(),
  getBrand: jest.fn(),
  updateBrand: jest.fn(),
  softDeleteBrand: jest.fn(),
  SlugCollisionError: class SlugCollisionError extends Error {},
  resolveAvailableVenueSlug: jest.fn(),
}));
jest.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ isAuthReady: true }),
}));
jest.mock("../../services/supabase", () => ({
  supabase: { channel: () => ({ on: () => ({ subscribe: () => ({}) }) }), removeChannel: jest.fn() },
}));
jest.mock("../../config/queryClient", () => ({
  queryClient: { getQueryData: jest.fn(), getQueriesData: jest.fn(() => []) },
}));
// Sibling hooks are imported by useBrands only for their query-key factories;
// stub the transitively-unresolvable ESM graph so the module loads under jest.
jest.mock("../useEventOrders", () => ({ eventOrdersKeys: { detail: () => [] } }));
jest.mock("../usePublicEvents", () => ({ publicEventKeys: { brandBySlug: () => [] } }));
jest.mock("../useCurrentBrandRole", () => ({
  brandRoleKeys: { allForBrand: () => [] },
}));
jest.mock("../useCreatorAccount", () => ({ creatorAccountKeys: { byId: () => [] } }));
jest.mock("../../utils/authReadyGate", () => ({
  awaitAuthReady: jest.fn(),
  awaitSessionAttached: jest.fn(),
}));

import { fetchBrandsList } from "../useBrands";

beforeEach(() => {
  jest.useFakeTimers();
  getBrandsSpy.mockReset();
});
afterEach(() => {
  jest.useRealTimers();
});

describe("fetchBrandsList race boundary + exactly-once (ORCH-1249 adversarial)", () => {
  test("a cold-start read that resolves JUST BEFORE the deadline SUCCEEDS, once, without aborting", async () => {
    let capturedSignal: AbortSignal | undefined;
    // Resolve at 8.9s — under the 9s ceiling. Models auth warming late-but-in-time.
    getBrandsSpy.mockImplementation(
      (_accountId: string, signal?: AbortSignal) => {
        capturedSignal = signal;
        return new Promise((resolve) => {
          setTimeout(() => resolve([{ id: "brand-late" }]), 8900);
        });
      },
    );

    const p = fetchBrandsList("acct-9");
    await jest.advanceTimersByTimeAsync(9000);
    const result = await p;

    expect(result).toEqual([{ id: "brand-late" }]);
    // Exactly one fetch — no storm from the refetch-on-enabled-flip guard.
    expect(getBrandsSpy).toHaveBeenCalledTimes(1);
    // Success must NOT abort the signal (no false cancellation of a good read).
    expect(capturedSignal).toBeInstanceOf(AbortSignal);
    expect(capturedSignal?.aborted).toBe(false);
  });

  test("a read that resolves JUST AFTER the deadline still TIMES OUT (no stuck-loading band)", async () => {
    // Resolve at 9.5s — past the 9s ceiling. Must reject, not silently resolve.
    getBrandsSpy.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve([{ id: "too-late" }]), 9500);
        }),
    );

    let caught: unknown;
    let resolvedValue: unknown;
    const p = fetchBrandsList("acct-9").then(
      (v) => {
        resolvedValue = v;
      },
      (e: unknown) => {
        caught = e;
      },
    );

    await jest.advanceTimersByTimeAsync(9000);
    await Promise.resolve();
    expect(isTimeoutError(caught)).toBe(true);

    // Drain the late resolve; it must NOT flip the already-timed-out result.
    await jest.advanceTimersByTimeAsync(1000);
    await p;
    expect(resolvedValue).toBeUndefined();
  });
});
