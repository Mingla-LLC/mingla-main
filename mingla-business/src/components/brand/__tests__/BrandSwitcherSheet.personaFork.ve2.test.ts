// META-ORCH-0972 decommission-witness test [TEST-MOD-APPROVED META-ORCH-0972]
//
// The original ve2 (venue-claim Phase 2) test exercised PersonaForkSheet's
// physical-venue admin-review path, which was DELETED by META-ORCH-0972 Sub-B
// as part of the brand-kind decommission. Admin venue-claim review now lives
// in mingla-admin with Pending/Verified/Rejected tabs and no kind gating.

import fs from "node:fs";
import path from "node:path";

describe("META-ORCH-0972 decommission witness — PersonaForkSheet ve2 path", () => {
  test("PersonaForkSheet.tsx is deleted; admin venue-claim review lives elsewhere", () => {
    const repoRoot = path.resolve(__dirname, "../../../..");
    expect(
      fs.existsSync(
        path.join(repoRoot, "src/components/brand/PersonaForkSheet.tsx"),
      ),
    ).toBe(false);
    // admin Claims dashboard with Pending/Verified/Rejected tabs lives outside
    // this worktree's mingla-business — it ships in mingla-admin per Sub-A.
  });
});
