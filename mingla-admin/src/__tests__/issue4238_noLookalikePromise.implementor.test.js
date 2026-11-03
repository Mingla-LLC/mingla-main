// Issue #4238 — Admin never promises lookalike audiences.
//
// Wave 1: Mingla did not build lookalike (prospecting M9/S6/T6) audiences, so
// the Prospecting copy promised none. Wave 2 builds real lists and lookalikes
// (ad_list_audiences); the copy now says prospecting uses the ones the Admin
// picks, and is broad with none. Fails on revert: restoring the old "Broad and
// lookalike audiences" promise (lookalikes by default) reds this test.
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
  it("never promises lookalikes by default", () => {
    assert.doesNotMatch(stepAudience, /Broad and lookalike audiences/i);
  });

  it("says what the prospecting stage does", () => {
    assert.match(
      stepAudience,
      /Prospecting uses your chosen lists or lookalikes; with none, it's broad\./,
    );
  });
});
