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
    expect(queries?.retry).toBe(2);
    const retryDelay = queries?.retryDelay;
    expect(typeof retryDelay).toBe("function");
    if (typeof retryDelay === "function") {
      // Deep attempts must stay capped (≤ 4000ms), never compound unbounded.
      const delay = retryDelay(10, new Error("x"));
      expect(delay).toBeLessThanOrEqual(4000);
    }
  });
});
