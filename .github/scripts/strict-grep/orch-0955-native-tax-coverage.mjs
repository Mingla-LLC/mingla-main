#!/usr/bin/env node
/**
 * ORCH-0955 native tax coverage gate.
 *
 * INVARIANT: ticket-checkout-create computes Stripe Tax via
 * `tax.calculations.create(` BEFORE `paymentIntents.create(`, and pins the
 * calculation onto the PI via `mingla_tax_calculation_id` metadata.
 *
 * `--self-test` proves fail-on-revert (mirrors i-1272-identity-admin-read.mjs):
 * the pure `check(src, failures)` is exercised with a GOOD fixture and ≥2
 * DISTINCT BAD fixtures. The disk-reading main path calls the SAME `check(...)`;
 * the refactor is behavior-preserving (identical verdict on the real tree).
 */
import fs from "node:fs";
import path from "node:path";

function check(src, failures) {
  const calc = src.indexOf("tax.calculations.create(");
  const pi = src.indexOf("paymentIntents.create(");
  if (calc < 0) failures.push("missing tax.calculations.create(");
  if (pi < 0) failures.push("missing paymentIntents.create(");
  if (calc >= 0 && pi >= 0 && calc > pi) failures.push("tax calculation must occur before PaymentIntent creation");
  if (!src.includes("mingla_tax_calculation_id")) failures.push("PaymentIntent metadata must carry mingla_tax_calculation_id");
}

if (process.argv.includes("--self-test")) {
  const self = [];

  // GOOD: tax calc precedes PI create + metadata pinned → silent.
  let f = [];
  check(
    "const c = await tax.calculations.create({ line_items });\n" +
      "const pi = await paymentIntents.create({ metadata: { mingla_tax_calculation_id: c.id } });\n",
    f,
  );
  if (f.length) self.push("GOOD (calc-before-PI + metadata) wrongly flagged: " + f.join("; "));

  // BAD1 (revert-style): the tax.calculations.create( call removed → fires.
  f = [];
  check(
    "const pi = await paymentIntents.create({ metadata: { mingla_tax_calculation_id: id } });\n",
    f,
  );
  if (f.length === 0) self.push("BAD1 (tax.calculations.create removed) not flagged");

  // BAD2 (regression, different angle): PI created BEFORE the tax calc
  // (ordering violation) → fires.
  f = [];
  check(
    "const pi = await paymentIntents.create({ metadata: { mingla_tax_calculation_id: id } });\n" +
      "const c = await tax.calculations.create({ line_items });\n",
    f,
  );
  if (f.length === 0) self.push("BAD2 (PaymentIntent created before tax calculation) not flagged");

  if (self.length) {
    console.error("ORCH-0955-NATIVE-TAX-COVERAGE self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("ORCH-0955-NATIVE-TAX-COVERAGE self-test PASS (3/3 cases).");
  process.exit(0);
}

const root = process.cwd().endsWith("mingla-business") ? path.resolve(process.cwd(), "..") : process.cwd();
const src = fs.readFileSync(path.join(root, "supabase/functions/ticket-checkout-create/index.ts"), "utf8");
const failures = [];
check(src, failures);
if (failures.length) {
  console.error(`FAIL [ORCH-0955 native tax coverage]\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("PASS [ORCH-0955 native tax coverage]");
