#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-business") ? path.resolve(process.cwd(), "..") : process.cwd();
const required = [
  "supabase/functions/brand-stripe-tax-account-session/index.ts",
  "mingla-business/app/connect-tax-registrations/index.tsx",
  "mingla-business/src/components/brand/BrandPaymentsView.tsx",
];
const failures = required.filter((file) => !fs.existsSync(path.join(root, file))).map((file) => `missing ${file}`);
const brandView = fs.readFileSync(path.join(root, "mingla-business/src/components/brand/BrandPaymentsView.tsx"), "utf8");
if (!brandView.includes("brand-stripe-tax-account-session") && !brandView.includes("useBrandStripeTaxAccountSession")) {
  failures.push("BrandPaymentsView must invoke the account-session flow");
}
if (fs.existsSync(path.join(root, "supabase/functions/brand-stripe-tax-dashboard-link/index.ts"))) {
  failures.push("legacy tax dashboard edge function still exists");
}
if (failures.length) {
  console.error(`FAIL [ORCH-0955 embedded tax UI]\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("PASS [ORCH-0955 embedded tax UI]");
