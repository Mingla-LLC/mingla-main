#!/usr/bin/env node
/**
 * I-1047-BIZ-PAYMENT-PLAN-EDITOR-CONSTRAINTS  (issue #1047)
 *
 * Re-homes the money-safety constants previously pinned by
 * `mingla-business/src/components/trip/__tests__/PaymentPlanEditor.test.ts`
 * (ORCH-0873 Tr3 installment payments). That jest file mixed load-bearing money
 * constraints with brittle UI/copy/tab pins (the drifted ones) and is now
 * quarantined; this additive gate keeps ONLY the money-safety constants enforced —
 * a silent weakening of these has real financial consequences for buyers.
 *
 * THE RULE (PaymentPlanEditor.tsx SPEC-locked constants, Q8/O-6 resolutions):
 *   DEPOSIT_STEP=5, DEPOSIT_MIN_PCT=10, DEPOSIT_MAX_PCT=95 (5%-step deposit lock),
 *   INSTALLMENT_STEP=5, INSTALLMENT_MIN_PCT=5 (5%-step installment lock),
 *   MAX_INSTALLMENTS=11 (hard cap), DAYS_MIN=1, DAYS_MAX=365 (schedule bounds).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const src = fs.readFileSync(
  path.join(REPO, "mingla-business/src/components/trip/PaymentPlanEditor.tsx"),
  "utf8",
);

const EXPECT = {
  DEPOSIT_STEP: 5,
  DEPOSIT_MIN_PCT: 10,
  DEPOSIT_MAX_PCT: 95,
  INSTALLMENT_STEP: 5,
  INSTALLMENT_MIN_PCT: 5,
  MAX_INSTALLMENTS: 11,
  DAYS_MIN: 1,
  DAYS_MAX: 365,
};

const violations = [];
for (const [name, value] of Object.entries(EXPECT)) {
  const m = src.match(new RegExp(`const\\s+${name}\\s*=\\s*(\\d+)\\b`));
  if (!m) {
    violations.push(`money-safety constant \`${name}\` is missing (expected ${value}).`);
  } else if (Number(m[1]) !== value) {
    violations.push(`\`${name}\` = ${m[1]} but the SPEC-locked value is ${value} — a silent weakening of a buyer money constraint.`);
  }
}

if (violations.length) {
  console.error("\nFAIL [I-1047-BIZ-PAYMENT-PLAN-EDITOR-CONSTRAINTS]:");
  for (const v of violations) console.error(`  x ${v}`);
  console.error("");
  process.exit(1);
}
console.log("OK [I-1047-BIZ-PAYMENT-PLAN-EDITOR-CONSTRAINTS]: all 8 installment/deposit money constants intact.");
