#!/usr/bin/env node
/**
 * ORCH-0955 embedded tax-UI gate.
 *
 * INVARIANT: the three tax-registration files exist, BrandPaymentsView invokes
 * the account-session flow (`brand-stripe-tax-account-session` /
 * `useBrandStripeTaxAccountSession`), and the legacy
 * `brand-stripe-tax-dashboard-link` edge function is ABSENT (decommissioned).
 *
 * `--self-test` proves fail-on-revert (mirrors i-1272-identity-admin-read.mjs):
 * the pure `check(inputs, failures)` is exercised with a GOOD fixture and ≥2
 * DISTINCT BAD fixtures — file presence/absence modelled as booleans passed into
 * `check`. The disk-reading main path calls the SAME `check(...)`; the refactor
 * is behavior-preserving (identical verdict on the real tree).
 */
import fs from "node:fs";
import path from "node:path";

const required = [
  "supabase/functions/brand-stripe-tax-account-session/index.ts",
  "mingla-business/app/connect-tax-registrations/index.tsx",
  "mingla-business/src/components/brand/BrandPaymentsView.tsx",
];

function check(inputs, failures) {
  const { existsMap, brandViewSrc, legacyExists } = inputs;
  for (const file of required) {
    if (!existsMap[file]) failures.push(`missing ${file}`);
  }
  if (!brandViewSrc.includes("brand-stripe-tax-account-session") && !brandViewSrc.includes("useBrandStripeTaxAccountSession")) {
    failures.push("BrandPaymentsView must invoke the account-session flow");
  }
  if (legacyExists) {
    failures.push("legacy tax dashboard edge function still exists");
  }
}

if (process.argv.includes("--self-test")) {
  const self = [];
  const allPresent = () => Object.fromEntries(required.map((file) => [file, true]));

  // GOOD: all required files present, account-session invoked, legacy absent.
  let f = [];
  check(
    { existsMap: allPresent(), brandViewSrc: "const link = useBrandStripeTaxAccountSession();", legacyExists: false },
    f,
  );
  if (f.length) self.push("GOOD (files present + account-session + legacy absent) wrongly flagged: " + f.join("; "));

  // BAD1 (revert-style): the legacy brand-stripe-tax-dashboard-link edge
  // function re-created → fires.
  f = [];
  check(
    { existsMap: allPresent(), brandViewSrc: "const link = useBrandStripeTaxAccountSession();", legacyExists: true },
    f,
  );
  if (f.length === 0) self.push("BAD1 (legacy tax dashboard edge function re-created) not flagged");

  // BAD2 (regression, different angle): the account-session invocation removed
  // from BrandPaymentsView → fires.
  f = [];
  check(
    { existsMap: allPresent(), brandViewSrc: "const view = <BrandPayments />;", legacyExists: false },
    f,
  );
  if (f.length === 0) self.push("BAD2 (account-session invocation removed from BrandPaymentsView) not flagged");

  if (self.length) {
    console.error("ORCH-0955-EMBEDDED-TAX-UI self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("ORCH-0955-EMBEDDED-TAX-UI self-test PASS (3/3 cases).");
  process.exit(0);
}

const root = process.cwd().endsWith("mingla-business") ? path.resolve(process.cwd(), "..") : process.cwd();
const existsMap = {};
for (const file of required) existsMap[file] = fs.existsSync(path.join(root, file));
const brandViewSrc = fs.readFileSync(
  path.join(root, "mingla-business/src/components/brand/BrandPaymentsView.tsx"),
  "utf8",
);
const legacyExists = fs.existsSync(path.join(root, "supabase/functions/brand-stripe-tax-dashboard-link/index.ts"));
const failures = [];
check({ existsMap, brandViewSrc, legacyExists }, failures);
if (failures.length) {
  console.error(`FAIL [ORCH-0955 embedded tax UI]\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("PASS [ORCH-0955 embedded tax UI]");
