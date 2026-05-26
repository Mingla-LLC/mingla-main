// META-ORCH-0972 decommission-witness test [TEST-MOD-APPROVED META-ORCH-0972]
//
// The original test exercised TripBrandWizard.tsx, which was DELETED by
// META-ORCH-0972 Sub-B (commit 3414ea6b8) as part of the brand-kind
// decommission. Trip-planner brands no longer exist as a separate persona —
// every brand can author trips universally via the unified BrandCreationFlow
// + OfferingChooser flow. Test preserved per Pragmatic Append-Only policy.

import fs from "node:fs";
import path from "node:path";

describe("META-ORCH-0972 decommission witness — TripBrandWizard", () => {
  test("TripBrandWizard.tsx is deleted from the brand components directory", () => {
    const repoRoot = path.resolve(__dirname, "../../../..");
    const deletedSource = path.join(
      repoRoot,
      "src/components/brand/TripBrandWizard.tsx",
    );
    expect(fs.existsSync(deletedSource)).toBe(false);
  });

  test("OfferingChooser.tsx is the replacement and exists", () => {
    const repoRoot = path.resolve(__dirname, "../../../..");
    const replacement = path.join(
      repoRoot,
      "src/components/brand/OfferingChooser.tsx",
    );
    expect(fs.existsSync(replacement)).toBe(true);
  });
});
