// META-ORCH-0972 decommission-witness test [TEST-MOD-APPROVED META-ORCH-0972]
//
// The original test exercised brandsService behavior keyed on
// `Brand.kind === "trip_planner"`. The `Brand.kind` TS field was DELETED
// from `mingla-business/src/types/brand.ts` by META-ORCH-0972 Sub-C
// (commit a1c1d7f70) as part of the brand-kind decommission. The DB column
// `brands.kind` remains until Stage 4 follow-up migration but no code path
// reads it. Test preserved per Pragmatic Append-Only policy.

import fs from "node:fs";
import path from "node:path";

describe("META-ORCH-0972 decommission witness — Brand.kind TS field", () => {
  test("types/brand.ts no longer declares a `kind:` field on the Brand interface", () => {
    const repoRoot = path.resolve(__dirname, "../../..");
    const brandTypes = fs.readFileSync(
      path.join(repoRoot, "src/types/brand.ts"),
      "utf8",
    );
    // Negative assertion: the literal `kind:` field declaration is gone.
    // Note: this also rejects accidental reintroduction.
    expect(brandTypes).not.toMatch(/^\s*kind:\s*"physical"/m);
    expect(brandTypes).not.toMatch(/^\s*kind:\s*"popup"/m);
    expect(brandTypes).not.toMatch(/^\s*kind:\s*"trip_planner"/m);
  });
});
