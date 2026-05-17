/**
 * useAudienceList.test.ts — ORCH-0863 T-07.
 *
 * Source-grep verification that the hook honors the silent-degrade
 * contract for per-row reach failures (SPEC SC-8):
 *   - Resolution batched via Promise.allSettled (NOT Promise.all — bare
 *     Promise.all rejects the whole batch on any single failure).
 *   - Failed entries get `null` in the reach Map (not undefined; not a
 *     thrown error).
 *   - No global error state is set on a per-row failure.
 *
 * Hook rendering tests would require @testing-library/react-hooks +
 * QueryClientProvider + RN render harness — heavy for the verification
 * value. Source-grep is the right resolution at this layer.
 */

import fs from "node:fs";
import path from "node:path";

const HOOK_PATH = path.resolve(
  __dirname,
  "..",
  "useAudienceList.ts",
);

describe("useAudienceList silent-degrade contract (ORCH-0863 T-07)", () => {
  let source: string;

  beforeAll(() => {
    source = fs.readFileSync(HOOK_PATH, "utf8");
  });

  it("uses Promise.allSettled (NOT bare Promise.all) for batched reach resolution", () => {
    expect(source.includes("Promise.allSettled")).toBe(true);
    expect(source.includes("Promise.all(")).toBe(false);
  });

  it("backfills failed entries with null in the reach Map (not undefined)", () => {
    expect(source).toMatch(/next\.set\(e\.client_key,\s*null\)/);
  });

  it("does NOT iterate rejected results into a thrown / global-error path", () => {
    // The result-reduce loop should ONLY consume `r.status === "fulfilled"`.
    // Sentinel checks: the reduce loop has NO `r.status === "rejected"` branch
    // that flips a global error flag, and there's no `setReachError` setter.
    expect(source).toMatch(/r\.status\s*===\s*"fulfilled"/);
    expect(source).not.toMatch(/setReachError/);
    expect(source).not.toMatch(/r\.status\s*===\s*"rejected"[\s\S]{0,80}set/);
  });

  it("60s stale window applied (not too aggressive on a heavy multi-resolver query)", () => {
    expect(source).toMatch(/60\s*\*\s*1000/);
  });
});
