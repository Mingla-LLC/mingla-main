#!/usr/bin/env node
/**
 * ORCH-0955 tax commit-on-success gate.
 *
 * INVARIANT: stripeWebhookRouter.ts reads `mingla_tax_calculation_id`, commits
 * the tax via `tax.transactions.createFromCalculation(`, and persists
 * `orders.stripe_tax_transaction_id`.
 *
 * `--self-test` proves fail-on-revert (mirrors i-1272-identity-admin-read.mjs):
 * the pure `check(src, failures)` is exercised with a GOOD fixture and ≥2
 * DISTINCT BAD fixtures. The disk-reading main path calls the SAME `check(...)`;
 * the refactor is behavior-preserving (identical verdict on the real tree).
 */
import fs from "node:fs";
import path from "node:path";

function check(src, failures) {
  if (!src.includes("mingla_tax_calculation_id")) {
    failures.push("missing mingla_tax_calculation_id metadata read");
  }
  if (!/tax\.transactions\s*\.\s*createFromCalculation\s*\(/.test(src)) {
    failures.push("missing tax.transactions.createFromCalculation(");
  }
  if (!src.includes("stripe_tax_transaction_id")) {
    failures.push("missing orders.stripe_tax_transaction_id persistence");
  }
}

if (process.argv.includes("--self-test")) {
  const self = [];

  // GOOD: metadata read + commit call + persistence → silent.
  let f = [];
  check(
    "const calcId = session.metadata.mingla_tax_calculation_id;\n" +
      "await stripe.tax.transactions.createFromCalculation({ calculation: calcId });\n" +
      "await supabase.from('orders').update({ stripe_tax_transaction_id: txn.id });\n",
    f,
  );
  if (f.length) self.push("GOOD (metadata + commit + persistence) wrongly flagged: " + f.join("; "));

  // BAD1 (revert-style): the createFromCalculation( commit removed → fires.
  f = [];
  check(
    "const calcId = session.metadata.mingla_tax_calculation_id;\n" +
      "await supabase.from('orders').update({ stripe_tax_transaction_id: txn.id });\n",
    f,
  );
  if (f.length === 0) self.push("BAD1 (createFromCalculation commit removed) not flagged");

  // BAD2 (regression, different angle): the stripe_tax_transaction_id
  // persistence removed → fires.
  f = [];
  check(
    "const calcId = session.metadata.mingla_tax_calculation_id;\n" +
      "await stripe.tax.transactions.createFromCalculation({ calculation: calcId });\n",
    f,
  );
  if (f.length === 0) self.push("BAD2 (stripe_tax_transaction_id persistence removed) not flagged");

  if (self.length) {
    console.error("ORCH-0955-TAX-COMMIT-ON-SUCCESS self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("ORCH-0955-TAX-COMMIT-ON-SUCCESS self-test PASS (3/3 cases).");
  process.exit(0);
}

const root = process.cwd().endsWith("mingla-business")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();
const src = fs.readFileSync(
  path.join(root, "supabase/functions/_shared/stripeWebhookRouter.ts"),
  "utf8",
);
const failures = [];
check(src, failures);
if (failures.length) {
  console.error(`FAIL [ORCH-0955 tax commit]\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("PASS [ORCH-0955 tax commit]");
