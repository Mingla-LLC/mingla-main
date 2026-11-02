// Issue #4238 — Admin never promises lookalike audiences.
//
// Mingla does not build lookalike (prospecting M9/S6/T6) audiences; the
// adAudienceDefinitions builders refuse them (audience_code_not_automatic).
// The Prospecting stage copy must say what actually runs. Fails on revert:
// restoring "Broad and lookalike audiences" reds this test.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const stepAudience = fs.readFileSync(
  path.join(here, "../components/campaign-builder/StepAudience.jsx"),
  "utf8",
);

describe("#4238 truthful prospecting copy", () => {
  it("does not mention lookalike audiences", () => {
    assert.doesNotMatch(stepAudience, /lookalike/i);
  });

  it("says what the prospecting stage does", () => {
    assert.match(
      stepAudience,
      /Broad audiences; past buyers excluded where the buyer list is ready\./,
    );
  });
});
