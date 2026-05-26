// META-ORCH-0972 decommission-witness test [TEST-MOD-APPROVED META-ORCH-0972]
//
// The original ve1 (venue-claim Phase 1) test exercised PersonaForkSheet's
// venue-claim entry point, which was DELETED by META-ORCH-0972 Sub-B as part
// of the brand-kind decommission. Venue claim is now reframed as an opt-in
// trust signal per I-VENUE-CLAIM-OPTIONAL, not a persona-fork gate.

import fs from "node:fs";
import path from "node:path";

describe("META-ORCH-0972 decommission witness — PersonaForkSheet ve1 path", () => {
  test("PersonaForkSheet.tsx is deleted; venue-claim flow lives elsewhere", () => {
    const repoRoot = path.resolve(__dirname, "../../../..");
    expect(
      fs.existsSync(
        path.join(repoRoot, "src/components/brand/PersonaForkSheet.tsx"),
      ),
    ).toBe(false);
    expect(
      fs.existsSync(
        path.join(repoRoot, "src/services/venueClaimBannerLogic.ts"),
      ),
    ).toBe(true);
  });
});
