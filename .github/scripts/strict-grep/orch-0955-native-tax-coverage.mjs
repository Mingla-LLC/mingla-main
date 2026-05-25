#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-business") ? path.resolve(process.cwd(), "..") : process.cwd();
const src = fs.readFileSync(path.join(root, "supabase/functions/ticket-checkout-create/index.ts"), "utf8");
const calc = src.indexOf("tax.calculations.create(");
const pi = src.indexOf("paymentIntents.create(");
const failures = [];
if (calc < 0) failures.push("missing tax.calculations.create(");
if (pi < 0) failures.push("missing paymentIntents.create(");
if (calc >= 0 && pi >= 0 && calc > pi) failures.push("tax calculation must occur before PaymentIntent creation");
if (!src.includes("mingla_tax_calculation_id")) failures.push("PaymentIntent metadata must carry mingla_tax_calculation_id");
if (failures.length) {
  console.error(`FAIL [ORCH-0955 native tax coverage]\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("PASS [ORCH-0955 native tax coverage]");
