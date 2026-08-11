// META-ORCH-1235 — queryClient networkMode regression test (I-PROPOSED-1235-B).
// An online flap must not pause-stick a query (isLoading stuck true, no error);
// the fix sets networkMode: "always" on the queries defaults. Fails-on-revert:
// remove networkMode → this assertion fails.
import { describe, expect, test } from "@jest/globals";

import { queryClient } from "../queryClient";

describe("queryClient — META-ORCH-1235 networkMode", () => {
  test("queries default networkMode is \"always\"", () => {
    const queries = queryClient.getDefaultOptions().queries;
    expect(queries?.networkMode).toBe("always");
  });

  test("retry stays at 2 with a capped retryDelay (no retry-storm widening)", () => {
    const queries = queryClient.getDefaultOptions().queries;
    // #1863 [error-toast-covers-bank-field] — `retry` became a FUNCTION so a
    // permission denial can be terminal (a 403 is never transient, and retrying
    // it produced ~2,650 unanswerable edge invocations in eight idle hours).
    // META-ORCH-1235's claim is UNCHANGED and is now proven by EXECUTING the
    // policy rather than reading a literal: a non-permission error still gets
    // the same 2-retry budget — attempts at failureCount 0 and 1, stopping at
    // 2 — which is exactly what `retry: 2` meant to query-core's retryer.
    const retry = queries?.retry;
    expect(typeof retry).toBe("function");
    const retryFn = retry as (count: number, error: unknown) => boolean;
    expect(retryFn(0, new Error("x"))).toBe(true);
    expect(retryFn(1, new Error("x"))).toBe(true);
    expect(retryFn(2, new Error("x"))).toBe(false);
    const retryDelay = queries?.retryDelay;
    expect(typeof retryDelay).toBe("function");
    if (typeof retryDelay === "function") {
      // Deep attempts must stay capped (≤ 4000ms), never compound unbounded.
      const delay = retryDelay(10, new Error("x"));
      expect(delay).toBeLessThanOrEqual(4000);
    }
  });
});
