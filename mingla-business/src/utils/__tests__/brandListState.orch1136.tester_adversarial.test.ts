/**
 * ORCH-1136 Batch A — TESTER adversarial regression test (append-only, NEW file).
 *
 * DIFFERENT ANGLE than the implementor's happy-path test (which proves
 * `{isFetching:true,isFetched:true,itemCount:3} -> "ready"`). This file attacks
 * the OTHER half of the predicate change — the COLD-BOOT / GUARD-PRECEDENCE
 * BOUNDARY — to prove the fix did NOT over-reach:
 *
 *   1. Genuine first load (`!isFetched`) must STILL be "query_loading" EVEN when
 *      a stale itemCount > 0 is present — so a cold boot can never flash a
 *      populated-then-empty (or populated-then-loading) brand list. This is the
 *      precise risk of the fix: that `itemCount` decides "too early", before the
 *      first real fetch resolves. If `!isFetched` ever resolved to "ready"/"empty"
 *      via the itemCount branch, this FAILS.
 *
 *   2. The earlier auth/sign-out/disabled/error guards must STILL win over the
 *      new itemCount-decides tail, regardless of isFetching/isFetched/itemCount —
 *      i.e. the fix only touched the LAST predicate line, never the precedence.
 *
 *   3. The exact bug boundary: with `isFetched:true` the in-flight `isFetching`
 *      flag is IGNORED (itemCount decides), but with `isFetched:false` it is NOT
 *      (still loading). Asserts both sides of that line.
 *
 * fails-on-revert: reverting line ~41 to
 *   `if (isLoading || isFetching || !isFetched) return "query_loading"`
 * makes assertion (3b) `{isFetching:true,isFetched:true,itemCount:2} -> "ready"`
 * FAIL (it would return "query_loading"). The cold-boot assertions (1) remain
 * green on revert (they are the invariant the fix must NOT break), guaranteeing
 * the fix is correct in BOTH directions.
 */
import { describe, expect, test } from "@jest/globals";

import {
  resolveBrandListStatus,
  type BrandListStatus,
} from "../../utils/brandListState";

const base = {
  authStatus: "signed_in_ready",
  hasUser: true,
  isError: false,
  isFetched: true,
  isFetching: false,
  isLoading: false,
  itemCount: 1,
};

const resolve = (over: Partial<typeof base>): BrandListStatus =>
  resolveBrandListStatus({ ...base, ...over });

describe("ORCH-1136 brand-list status — cold-boot & guard-precedence boundary", () => {
  // (1) COLD BOOT: first load must never let a stale itemCount short-circuit the
  // loading state, no matter how the cache looks. Empty AND populated stale cache.
  test("genuine first load (!isFetched) stays query_loading even with stale itemCount>0", () => {
    expect(resolve({ isFetched: false, itemCount: 0 })).toBe("query_loading");
    expect(resolve({ isFetched: false, itemCount: 5 })).toBe("query_loading");
    expect(resolve({ isFetched: false, isFetching: true, itemCount: 5 })).toBe(
      "query_loading",
    );
    // React Query's own first-load flag must also force loading.
    expect(resolve({ isLoading: true, isFetched: true, itemCount: 5 })).toBe(
      "query_loading",
    );
  });

  // (2) GUARD PRECEDENCE: the earlier branches outrank the itemCount tail in EVERY
  // combination of the loading flags — the fix touched only the last line.
  test("auth/signout/disabled/error guards outrank itemCount regardless of fetch flags", () => {
    const noisy = { isFetching: true, isFetched: true, isLoading: true, itemCount: 9 };
    expect(resolve({ ...noisy, authStatus: "bootstrapping" })).toBe("auth_loading");
    expect(resolve({ ...noisy, authStatus: "refreshing" })).toBe("auth_loading");
    expect(resolve({ ...noisy, authStatus: "error" })).toBe("error");
    expect(resolve({ ...noisy, authStatus: "signed_out" })).toBe("signed_out");
    expect(resolve({ ...noisy, hasUser: false })).toBe("query_disabled");
    expect(resolve({ ...noisy, isError: true })).toBe("error");
  });

  // (3) THE EXACT FIX BOUNDARY: isFetching is ignored ONLY once isFetched===true.
  test("isFetching is honored before first fetch, ignored after (the fix boundary)", () => {
    // 3a — before first fetch: still loading (invariant; green on revert too).
    expect(resolve({ isFetched: false, isFetching: true, itemCount: 2 })).toBe(
      "query_loading",
    );
    // 3b — after first fetch + background refetch: itemCount decides (FIX).
    //      This is the assertion that FAILS if `|| isFetching` is restored.
    expect(resolve({ isFetched: true, isFetching: true, itemCount: 2 })).toBe(
      "ready",
    );
    expect(resolve({ isFetched: true, isFetching: true, itemCount: 0 })).toBe(
      "empty",
    );
    // And with no refetch in flight, unchanged.
    expect(resolve({ isFetched: true, isFetching: false, itemCount: 2 })).toBe(
      "ready",
    );
  });
});
