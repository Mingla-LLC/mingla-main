import assert from "node:assert/strict";
import test from "node:test";
import { checkProgramDraft } from "../../lib/creatorPrograms.js";

// [TEST-MOD-APPROVED #3872] walkthrough W4: Locals moved to Programs › Mingla Locals;
// the structural checks live in programs.issue3872.test.js. This file now pins
// the per-city rate rules (decision 6).
test("#3872 a city's details: whole seats 0-10, never below seated Locals, a rate above 0 in the chosen currency", () => {
  assert.deepEqual(checkProgramDraft({ seats: "3", rate: "150", currency: "USD" }, 1), { values: { seats: 3, monthlyRateMinor: 15000, payoutCurrency: "USD" } });
  assert.deepEqual(checkProgramDraft({ seats: "2", rate: "60000", currency: "NGN" }, 0).values, { seats: 2, monthlyRateMinor: 6000000, payoutCurrency: "NGN" });
  assert.match(checkProgramDraft({ seats: "1", rate: "150", currency: "USD" }, 2).errors.seats, /2 Locals already seated/);
  assert.match(checkProgramDraft({ seats: "11", rate: "150", currency: "USD" }, 0).errors.seats, /0 to 10/);
  assert.match(checkProgramDraft({ seats: "3", rate: "0", currency: "USD" }, 0).errors.rate, /above 0/);
  assert.match(checkProgramDraft({ seats: "3", rate: "150.5", currency: "USD" }, 0).errors.rate, /whole/);
  assert.match(checkProgramDraft({ seats: "3", rate: "150", currency: "XYZ" }, 0).errors.currency, /currency/);
});
