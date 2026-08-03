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

// Pure verdict (behavior-preserving refactor). Scans `src` for each SPEC-locked
// money constant and pushes a human-readable string into `violations` when a
// constant is missing or has drifted. Takes a STRING; never touches disk.
function check(src, violations) {
  for (const [name, value] of Object.entries(EXPECT)) {
    const m = src.match(new RegExp(`const\\s+${name}\\s*=\\s*(\\d+)\\b`));
    if (!m) {
      violations.push(`money-safety constant \`${name}\` is missing (expected ${value}).`);
    } else if (Number(m[1]) !== value) {
      violations.push(`\`${name}\` = ${m[1]} but the SPEC-locked value is ${value} — a silent weakening of a buyer money constraint.`);
    }
  }
}

// ─────────────────────────────────────────────────────────────── self-test
if (process.argv.includes("--self-test")) {
  const self = [];
  const run = (src) => {
    const v = [];
    check(src, v);
    return v;
  };

  // GOOD: every constant present at its SPEC-locked value → silent.
  const good = Object.entries(EXPECT).map(([k, v]) => `const ${k} = ${v};`).join("\n");
  if (run(good).length) self.push("GOOD (all 8 money constants at SPEC values) wrongly flagged");

  // BAD1 (revert-style): the deposit floor is weakened to 0 → fires.
  const bad1 = good.replace("const DEPOSIT_MIN_PCT = 10;", "const DEPOSIT_MIN_PCT = 0;");
  if (run(bad1).length === 0) self.push("BAD1 (DEPOSIT_MIN_PCT weakened to 0) not flagged");

  // BAD2 (regression, different angle): the installment hard cap is blown to 99 → fires.
  const bad2 = good.replace("const MAX_INSTALLMENTS = 11;", "const MAX_INSTALLMENTS = 99;");
  if (run(bad2).length === 0) self.push("BAD2 (MAX_INSTALLMENTS blown to 99) not flagged");

  if (self.length) {
    console.error("I-1047-BIZ-PAYMENT-PLAN-EDITOR-CONSTRAINTS self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("I-1047-BIZ-PAYMENT-PLAN-EDITOR-CONSTRAINTS self-test PASS (3/3 cases).");
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────── main path
const src = fs.readFileSync(
  path.join(REPO, "mingla-business/src/components/trip/PaymentPlanEditor.tsx"),
  "utf8",
);

const violations = [];
check(src, violations);

if (violations.length) {
  console.error("\nFAIL [I-1047-BIZ-PAYMENT-PLAN-EDITOR-CONSTRAINTS]:");
  for (const v of violations) console.error(`  x ${v}`);
  console.error("");
  process.exit(1);
}
console.log("OK [I-1047-BIZ-PAYMENT-PLAN-EDITOR-CONSTRAINTS]: all 8 installment/deposit money constants intact.");
