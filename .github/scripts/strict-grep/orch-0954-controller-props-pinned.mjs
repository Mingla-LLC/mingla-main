#!/usr/bin/env node
/**
 * ORCH-0954 strict-grep gate — I-PROPOSED-CONTROLLER-PROPS-PINNED.
 *
 * New Stripe connected accounts must use Stripe-managed risk and embedded
 * components: losses_collector=stripe, fees_collector=application (#3645 flat
 * 4.5% — platform pays processing), dashboard=none.
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
    'fees_collector: "application"',
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
  // Express dashboard is the forbidden legacy shape. fees_collector "application"
  // is required (#3645); do not treat it as legacy.
  if (/\bexpress\b/.test(context)) {
    fail(
      `Forbidden legacy controller literal near ${TARGET}:${i + 1}\n${context}`,
    );
  }
  if (/fees_collector\s*:\s*"stripe"/.test(context)) {
    fail(
      `Forbidden fees_collector "stripe" near ${TARGET}:${i + 1} — #3645 requires "application"\n${context}`,
    );
  }
}

console.log(
  "ORCH-0954 controller-props strict-grep PASS — managed-risk controller pinned.",
);
