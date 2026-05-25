#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-business") ? path.resolve(process.cwd(), "..") : process.cwd();
const src = fs.readFileSync(path.join(root, "supabase/functions/refund-order/index.ts"), "utf8");
const failures = [];
if (!src.includes("stripe_tax_transaction_id")) failures.push("missing tax transaction lookup/persistence");
if (!src.includes("tax.transactions.createReversal(")) failures.push("missing tax.transactions.createReversal(");
if (!src.includes("p_stripe_tax_transaction_id")) failures.push("missing commit RPC tax parameter");
if (failures.length) {
  console.error(`FAIL [ORCH-0955 tax reversal]\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("PASS [ORCH-0955 tax reversal]");
