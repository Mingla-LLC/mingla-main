/**
 * ORCH-1249 (biz cold-start brand-hydration) — HAPPY-PATH regression.
 *
 * COLD start (fresh TestFlight install, no cached session): the brand switcher /
 * dashboard hung on "Loading your brands…" forever until a force-quit + reopen.
 * Root cause: the brands-list read fired during the auth-bootstrap race with NO
 * hook-level settle guarantee, so a stalled first attempt pinned React Query in
 * `isLoading` with no timeout and no refetch when auth later became ready.
 *
 * This test proves BOTH halves of the fix at the unit level:
 *   1. fetchBrandsList REJECTS within the 9s timeout when the underlying read
 *      never settles (React Query then surfaces isError → error/retry, NOT an
 *      eternal spinner).
 *   2. fetchBrandsList threads an AbortController signal into getBrands so the
 *      orphaned socket is cancelled on timeout.
 *
 * fails-on-revert verified at 4c950ffc6 — reverting the withTimeout wrapper in
 * fetchBrandsList makes the "REJECTS within the timeout" case hang forever, so
 * jest fails (confirmed: happy-path test FAILED on revert, PASSES with the fix).
 */
/* eslint-disable import/first */
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

// A never-settling promise for getBrands — models a stalled cold-start read
// (auth not yet warm / hung PostgREST stream).
const neverSettles = new Promise<never>(() => {});
const getBrandsSpy = jest.fn<(accountId: string, signal?: AbortSignal) => Promise<unknown>>();

jest.mock("../../services/brandsService", () => ({
  getBrands: (accountId: string, signal?: AbortSignal) => getBrandsSpy(accountId, signal),
  // Re-exported by useBrands; stub the rest so the module loads.
  createBrand: jest.fn(),
  createVenueBrandPendingReview: jest.fn(),
  getBrand: jest.fn(),
  updateBrand: jest.fn(),
  softDeleteBrand: jest.fn(),
  SlugCollisionError: class SlugCollisionError extends Error {},
  resolveAvailableVenueSlug: jest.fn(),
}));

// AuthContext + supabase pull in react-native (untransformed ESM). fetchBrandsList
// needs neither directly (getBrands is mocked). Stub so the module loads.
jest.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ isAuthReady: true }),
}));
jest.mock("../../services/supabase", () => ({
  supabase: { channel: () => ({ on: () => ({ subscribe: () => ({}) }) }), removeChannel: jest.fn() },
}));
jest.mock("../../config/queryClient", () => ({
  queryClient: { getQueryData: jest.fn(), getQueriesData: jest.fn(() => []) },
}));
// Sibling hooks are imported by useBrands only for their query-key factories.
// They transitively pull in unresolvable ESM (@mingla/offering-rendering); stub
// them so the module graph loads under jest without touching fetchBrandsList.
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

import { isTimeoutError } from "../../utils/withTimeout";
import { fetchBrandsList } from "../useBrands";

beforeEach(() => {
  jest.useFakeTimers();
  getBrandsSpy.mockReset();
});
afterEach(() => {
  jest.useRealTimers();
});

describe("fetchBrandsList settle-guarantee (ORCH-1249 cold-start)", () => {
  test("a never-resolving brands read REJECTS within the timeout (no infinite spinner)", async () => {
    getBrandsSpy.mockReturnValue(neverSettles);

    let caught: unknown;
    let settled = false;
    const p = fetchBrandsList("acct-1").then(
      () => {
        settled = true;
        throw new Error("should not resolve — the read never settles");
      },
      (e: unknown) => {
        settled = true;
        caught = e;
      },
    );

    // Before the ~9s deadline the read is still pending (this is the spinner).
    await jest.advanceTimersByTimeAsync(1000);
    expect(settled).toBe(false);

    // Past the deadline it MUST settle to a timeout rejection → isError, not
    // an eternal "Loading your brands…".
    await jest.advanceTimersByTimeAsync(10000);
    await p;

    expect(settled).toBe(true);
    expect(isTimeoutError(caught)).toBe(true);
  });

  test("threads an AbortController signal into getBrands so the socket is cancellable", async () => {
    getBrandsSpy.mockReturnValue(neverSettles);

    const p = fetchBrandsList("acct-1").catch(() => undefined);
    expect(getBrandsSpy).toHaveBeenCalledTimes(1);
    const [accountId, signal] = getBrandsSpy.mock.calls[0] as [string, AbortSignal];
    expect(accountId).toBe("acct-1");
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);

    // Let it time out; the wrapper aborts the in-flight signal on timeout.
    await jest.advanceTimersByTimeAsync(10000);
    await p;
    expect(signal.aborted).toBe(true);
  });

  test("a fast, real read still resolves normally (slow-but-real reads are not broken)", async () => {
    getBrandsSpy.mockResolvedValue([{ id: "b1" }]);
    const result = await fetchBrandsList("acct-1");
    expect(result).toEqual([{ id: "b1" }]);
  });
});
