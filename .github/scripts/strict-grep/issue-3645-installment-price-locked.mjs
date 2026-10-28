#!/usr/bin/env node
/** #3645 — later charges use the checkout-persisted amount; no repricing. */
// MINGLA-INVARIANT: I-3645-PS-3 | issue #3645 | Every later installment charge uses its checkout-locked amount.

import fs from "node:fs";
import path from "node:path";

export function priceLockFailures(files) {
  const failures = [];
  for (const [name, source] of Object.entries(files)) {
    if (/paystackInstallmentPricing|computeBuyerSubtotal|computeConfigVat/.test(source)) {
      failures.push(`${name}: imports or invokes checkout pricing at charge time`);
    }
  }
  const charge = files.charge ?? "";
  if (!/issue_3645_begin_installment_attempt/.test(charge) || !/attempt\.amount_cents/.test(charge)) {
    failures.push("charge: does not consume the amount returned by the locked-attempt RPC");
  }
  const scheduler = files.scheduler ?? "";
  if (!/\bchargeInstallment\b/.test(scheduler)) failures.push("scheduler: bypasses the shared charge router");
  return failures;
}

if (process.argv.includes("--self-test")) {
  const good = priceLockFailures({ charge: "issue_3645_begin_installment_attempt(); attempt.amount_cents", scheduler: "chargeInstallment({})" });
  const bad = priceLockFailures({ charge: "computeBuyerSubtotal(input)", scheduler: "chargeInstallment({})" });
  if (good.length || bad.length < 2) {
    console.error("#3645 installment-price-locked self-test FAILED");
    process.exit(1);
  }
  console.log("#3645 installment-price-locked self-test PASS (2/2 cases).");
  process.exit(0);
}

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const failures = priceLockFailures({
  charge: read("supabase/functions/_shared/installments/chargePaystackInstallment.ts"),
  scheduler: read("supabase/functions/process-scheduled-installments/index.ts"),
  payLink: read("supabase/functions/installment-pay-link/index.ts"),
});
if (failures.length) {
  console.error("#3645 installment-price-locked gate FAILED:\n" + failures.map((f) => `  - ${f}`).join("\n"));
  process.exit(1);
}
console.log("#3645 installment-price-locked gate PASS.");
