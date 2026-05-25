#!/usr/bin/env node
/**
 * ORCH-0954 strict-grep gate — I-PROPOSED-CONTROLLER-PROPS-PINNED.
 *
 * New Stripe connected accounts must use Stripe-managed risk and embedded
 * components: losses_collector=stripe, fees_collector=stripe, dashboard=none.
 */

import { readFileSync } from "node:fs";

const TARGET = "supabase/functions/_shared/stripeBlueprintClient.ts";
const source = readFileSync(TARGET, "utf8");

function fail(message) {
  console.error("ORCH-0954 controller-props strict-grep FAILED:");
  console.error(message);
  process.exit(1);
}

const constantMatch = source.match(
  /export const STRIPE_MANAGED_RISK_CONTROLLER\s*=\s*\{[\s\S]*?\}\s*as const;/,
);

if (!constantMatch) {
  fail("Missing exported STRIPE_MANAGED_RISK_CONTROLLER constant.");
}

const block = constantMatch[0];
for (
  const required of [
    'losses_collector: "stripe"',
    'fees_collector: "stripe"',
    'dashboard: "none"',
  ]
) {
  if (!block.includes(required)) {
    fail(`Managed-risk controller constant is missing ${required}.`);
  }
}

if (!source.includes("...STRIPE_MANAGED_RISK_CONTROLLER")) {
  fail("createRecipientAccount must spread STRIPE_MANAGED_RISK_CONTROLLER.");
}

const lines = source.split("\n");
for (let i = 0; i < lines.length; i += 1) {
  if (!/(losses_collector|fees_collector|dashboard)\s*:/.test(lines[i])) {
    continue;
  }
  const context = lines.slice(Math.max(0, i - 5), i + 6).join("\n");
  if (/\b(express|application)\b/.test(context)) {
    fail(
      `Forbidden legacy controller literal near ${TARGET}:${i + 1}\n${context}`,
    );
  }
}

console.log(
  "ORCH-0954 controller-props strict-grep PASS — managed-risk controller pinned.",
);
