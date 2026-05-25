#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-business") ? path.resolve(process.cwd(), "..") : process.cwd();
const files = [
  "supabase/functions/ticket-checkout-create/index.ts",
  "app-mobile/src/payments/nativeCheckoutFlow.ts",
  "mingla-business/src/payments/nativeCheckoutFlow.native.ts",
  "mingla-business/src/payments/nativeCheckoutFlow.ts",
];
const banned = [
  "NATIVE_PAID_ALLOWED" + "_REGIONS",
  "isNativePaidAllowed" + "ForBrand",
  "native_paid_not_allowed" + "_in_region",
];
const failures = [];
if (fs.existsSync(path.join(root, "supabase/functions/_shared/stripeTax.ts"))) {
  failures.push("legacy stripeTax helper still exists");
}
for (const file of files) {
  const abs = path.join(root, file);
  if (!fs.existsSync(abs)) continue;
  const src = fs.readFileSync(abs, "utf8");
  for (const token of banned) {
    if (src.includes(token)) failures.push(`${file} still contains ${token}`);
  }
}
if (failures.length) {
  console.error(`FAIL [ORCH-0955 region gate deleted]\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("PASS [ORCH-0955 region gate deleted]");
