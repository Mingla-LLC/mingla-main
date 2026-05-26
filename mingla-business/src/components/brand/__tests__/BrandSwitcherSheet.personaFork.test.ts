// META-ORCH-0972 decommission-witness test [TEST-MOD-APPROVED META-ORCH-0972]
//
// The original test exercised PersonaForkSheet.tsx, which was DELETED by
// META-ORCH-0972 Sub-B (commit 3414ea6b8) as part of the brand-kind
// decommission. The component no longer exists — there is nothing to test.
// This witness file preserves the test path under the Pragmatic Append-Only
// policy (ORCH-0840) while asserting the decommission is structurally
// complete: the source file is gone and the unified BrandCreationFlow has
// replaced it.

import fs from "node:fs";
import path from "node:path";

describe("META-ORCH-0972 decommission witness — PersonaForkSheet", () => {
  test("PersonaForkSheet.tsx is deleted from the brand components directory", () => {
    const repoRoot = path.resolve(__dirname, "../../../..");
    const deletedSource = path.join(
      repoRoot,
      "src/components/brand/PersonaForkSheet.tsx",
    );
    expect(fs.existsSync(deletedSource)).toBe(false);
  });

  test("BrandCreationFlow.tsx is the replacement and exists", () => {
    const repoRoot = path.resolve(__dirname, "../../../..");
    const replacement = path.join(
      repoRoot,
      "src/components/brand/BrandCreationFlow.tsx",
    );
    expect(fs.existsSync(replacement)).toBe(true);
  });
});
