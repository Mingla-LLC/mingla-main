#!/usr/bin/env node
/** #3645 — every installment is routed from its immutable ledger provider. */
// MINGLA-INVARIANT: I-3645-PS-4 | issue #3645 | Installment charging routes from the immutable installment row provider.

import fs from "node:fs";
import path from "node:path";

export function providerRoutingFailures(files) {
  const failures = [];
  const router = files.router ?? "";
  if (!/select\(["'`][^"'`]*provider[^"'`]*collection_method/s.test(router)) {
    failures.push("router: does not select provider + collection_method from order_installments");
  }
  if (!/row\.provider|installment\.provider/.test(router)) {
    failures.push("router: does not branch on the installment row provider");
  }
  for (const [name, source] of Object.entries(files)) {
    if (/\.from\(["']brands["']\)[\s\S]{0,240}?payment_provider/.test(source)) {
      failures.push(`${name}: routes from mutable brand payment_provider`);
    }
  }
  return failures;
}

if (process.argv.includes("--self-test")) {
  const good = providerRoutingFailures({ router: 'from("order_installments").select("provider,collection_method"); if (row.provider)' });
  const bad = providerRoutingFailures({ router: 'db.from("brands").select("payment_provider")' });
  if (good.length || bad.length < 3) {
    console.error("#3645 installment-provider-from-row self-test FAILED");
    process.exit(1);
  }
  console.log("#3645 installment-provider-from-row self-test PASS (2/2 cases).");
  process.exit(0);
}

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const failures = providerRoutingFailures({
  router: read("supabase/functions/_shared/installments/chargeInstallment.ts"),
  scheduler: read("supabase/functions/process-scheduled-installments/index.ts"),
  manual: read("supabase/functions/manual-charge-installment/index.ts"),
});
if (failures.length) {
  console.error("#3645 installment-provider-from-row gate FAILED:\n" + failures.map((f) => `  - ${f}`).join("\n"));
  process.exit(1);
}
console.log("#3645 installment-provider-from-row gate PASS.");
