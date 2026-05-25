#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();
const src = fs.readFileSync(
  path.join(root, "supabase/functions/_shared/stripeWebhookRouter.ts"),
  "utf8",
);
const failures = [];
if (!src.includes("mingla_tax_calculation_id")) {
  failures.push("missing mingla_tax_calculation_id metadata read");
}
if (!/tax\.transactions\s*\.\s*createFromCalculation\s*\(/.test(src)) {
  failures.push("missing tax.transactions.createFromCalculation(");
}
if (!src.includes("stripe_tax_transaction_id")) {
  failures.push("missing orders.stripe_tax_transaction_id persistence");
}
if (failures.length) {
  console.error(`FAIL [ORCH-0955 tax commit]\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("PASS [ORCH-0955 tax commit]");
