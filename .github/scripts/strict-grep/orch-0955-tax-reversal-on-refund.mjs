#!/usr/bin/env node
/**
 * ORCH-0955 tax reversal-on-refund gate.
 *
 * INVARIANT: refund-order looks up `stripe_tax_transaction_id`, reverses the
 * committed tax via `tax.transactions.createReversal(`, and passes
 * `p_stripe_tax_transaction_id` into the commit RPC.
 *
 * `--self-test` proves fail-on-revert (mirrors i-1272-identity-admin-read.mjs):
 * the pure `check(src, failures)` is exercised with a GOOD fixture and ≥2
 * DISTINCT BAD fixtures. The disk-reading main path calls the SAME `check(...)`;
 * the refactor is behavior-preserving (identical verdict on the real tree).
 */
import fs from "node:fs";
import path from "node:path";

function check(src, failures) {
  if (!src.includes("stripe_tax_transaction_id")) failures.push("missing tax transaction lookup/persistence");
  if (!src.includes("tax.transactions.createReversal(")) failures.push("missing tax.transactions.createReversal(");
  if (!src.includes("p_stripe_tax_transaction_id")) failures.push("missing commit RPC tax parameter");
}

if (process.argv.includes("--self-test")) {
  const self = [];

  // GOOD: lookup + reversal + RPC param → silent.
  let f = [];
  check(
    "const t = order.stripe_tax_transaction_id;\n" +
      "await stripe.tax.transactions.createReversal({ original_transaction: t });\n" +
      "await supabase.rpc('refund_commit', { p_stripe_tax_transaction_id: t });\n",
    f,
  );
  if (f.length) self.push("GOOD (lookup + reversal + RPC param) wrongly flagged: " + f.join("; "));

  // BAD1 (revert-style): the createReversal( call removed → fires.
  f = [];
  check(
    "const t = order.stripe_tax_transaction_id;\n" +
      "await supabase.rpc('refund_commit', { p_stripe_tax_transaction_id: t });\n",
    f,
  );
  if (f.length === 0) self.push("BAD1 (createReversal removed) not flagged");

  // BAD2 (regression, different angle): the p_stripe_tax_transaction_id RPC
  // param removed (reversal no longer recorded on the order) → fires.
  f = [];
  check(
    "const t = order.stripe_tax_transaction_id;\n" +
      "await stripe.tax.transactions.createReversal({ original_transaction: t });\n",
    f,
  );
  if (f.length === 0) self.push("BAD2 (p_stripe_tax_transaction_id RPC param removed) not flagged");

  if (self.length) {
    console.error("ORCH-0955-TAX-REVERSAL-ON-REFUND self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("ORCH-0955-TAX-REVERSAL-ON-REFUND self-test PASS (3/3 cases).");
  process.exit(0);
}

const root = process.cwd().endsWith("mingla-business") ? path.resolve(process.cwd(), "..") : process.cwd();
const src = fs.readFileSync(path.join(root, "supabase/functions/refund-order/index.ts"), "utf8");
const failures = [];
check(src, failures);
if (failures.length) {
  console.error(`FAIL [ORCH-0955 tax reversal]\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("PASS [ORCH-0955 tax reversal]");
