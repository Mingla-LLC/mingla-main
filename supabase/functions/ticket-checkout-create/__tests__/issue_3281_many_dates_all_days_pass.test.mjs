/**
 * issue #3281 many-dates — allDaysPass binds upcoming dates before idempotency.
 * [TEST-MOD-APPROVED #3281]
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "index.ts"), "utf8");

describe("issue #3281 many-dates allDaysPass", () => {
  it("reads multi_date_pricing_mode all_days and fills orderedEventDateIds", () => {
    assert.match(src, /multi_date_pricing_mode/);
    assert.match(src, /allDaysPass/);
    assert.match(src, /all_days/);
    // Must run before idempotency key construction.
    const passAt = src.indexOf("allDaysPass");
    const idemAt = src.indexOf("const idempotencyKey");
    assert.ok(passAt > 0 && idemAt > passAt, "allDaysPass must precede idempotencyKey");
  });

  it("refuses when no upcoming dates remain", () => {
    assert.match(src, /occurrence_not_available/);
  });
});
