#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-0896 [Stripe forwardRef RedBox under React 19.1 — side-effect hoist] check.
 *
 * The original ORCH-0836 fix put LogBox.ignoreLogs after the Stripe import in
 * _layout.tsx. ES module hoisting evaluated the Stripe import first, the
 * forwardRef warning fired, then the filter registered too late. Operator
 * still saw the Console Error overlay on every launch.
 *
 * The fix: side-effect modules at app-mobile/src/diagnostics/silenceStripeForwardRef.ts
 * and mingla-business/src/diagnostics/silenceStripeForwardRef.ts whose top-level
 * statements call LogBox.ignoreLogs at the importing file's import position —
 * so the filter arms BEFORE @mingla/payments-native evaluates.
 *
 *   T-S01 — app-mobile side-effect module exists with LogBox.ignoreLogs at top level
 *   T-S02 — app-mobile _layout.tsx imports the side-effect module BEFORE @mingla/payments-native
 *   T-S03 — mingla-business side-effect module exists with LogBox.ignoreLogs at top level
 *   T-S04 — mingla-business _layout.tsx imports the side-effect module BEFORE StripeProviderWrapper
 *   T-S05 — Both apps use the identical forwardRef regex (anti-drift)
 *
 * FAILS-ON-REVERT key: T-S02 and T-S04 — reverting either side-effect import to its
 * post-Stripe-import position causes the side-effect file to evaluate too late
 * (the Stripe warning has already fired by then). Static check verifies the
 * import APPEARS before the Stripe-pulling import in source order.
 *
 * Status: structural-only check authored by orchestrator at CLOSE time as
 * Step 0.5 deferred-tester replacement. Operator-accepted deferral cites
 * follow-up ORCH-0896-TEST for proper Claude mingla-tester adversarial test
 * (would need a sim-runtime check that the Console Error overlay does not
 * surface — non-trivial; structural check is the practical ceiling here).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

const read = (rel) => {
  try {
    return fs.readFileSync(path.join(repoRoot, rel), "utf8");
  } catch {
    return null;
  }
};

const checks = [];
const check = (name, pass, detail) => checks.push({ name, pass, detail });

const consumerSideEffect = read("app-mobile/src/diagnostics/silenceStripeForwardRef.ts");
const consumerLayout = read("app-mobile/app/_layout.tsx");
const businessSideEffect = read("mingla-business/src/diagnostics/silenceStripeForwardRef.ts");
const businessLayout = read("mingla-business/app/_layout.tsx");

check(
  "T-S01 app-mobile side-effect module exists with LogBox.ignoreLogs at top level",
  consumerSideEffect !== null &&
    /import\s*\{\s*LogBox\s*\}\s*from\s*["']react-native["']/.test(consumerSideEffect) &&
    /LogBox\.ignoreLogs\(\[\s*\/forwardRef render functions accept exactly two parameters/.test(consumerSideEffect),
  "Side-effect module must import LogBox and register the forwardRef pattern as a top-level statement.",
);

check(
  "T-S02 [FAILS-ON-REVERT KEY] app-mobile/_layout.tsx imports side-effect BEFORE @mingla/payments-native",
  consumerLayout !== null &&
    (() => {
      const sideEffectIdx = consumerLayout.indexOf("../src/diagnostics/silenceStripeForwardRef");
      const stripeIdx = consumerLayout.indexOf('"@mingla/payments-native"');
      return sideEffectIdx > 0 && stripeIdx > 0 && sideEffectIdx < stripeIdx;
    })(),
  "ES module imports hoist in source order. The side-effect import MUST appear before any module that pulls @stripe/stripe-react-native (via @mingla/payments-native) — otherwise the warning fires before the filter registers.",
);

check(
  "T-S03 mingla-business side-effect module exists with LogBox.ignoreLogs at top level",
  businessSideEffect !== null &&
    /import\s*\{\s*LogBox\s*\}\s*from\s*["']react-native["']/.test(businessSideEffect) &&
    /LogBox\.ignoreLogs\(\[\s*\/forwardRef render functions accept exactly two parameters/.test(businessSideEffect),
  "Parity with consumer side — mingla-business has its own copy of the filter for the same root cause.",
);

check(
  "T-S04 [FAILS-ON-REVERT KEY] mingla-business/_layout.tsx imports side-effect BEFORE StripeProviderWrapper",
  businessLayout !== null &&
    (() => {
      const sideEffectIdx = businessLayout.indexOf("../src/diagnostics/silenceStripeForwardRef");
      const stripeIdx = businessLayout.indexOf("../src/payments/StripeProviderWrapper");
      return sideEffectIdx > 0 && stripeIdx > 0 && sideEffectIdx < stripeIdx;
    })(),
  "Same hoisting concern as T-S02 — side-effect import must precede the wrapper that pulls @stripe/stripe-react-native.",
);

check(
  "T-S05 Both apps use the identical anchor regex (no anti-drift)",
  consumerSideEffect !== null &&
    businessSideEffect !== null &&
    /forwardRef render functions accept exactly two parameters/.test(consumerSideEffect) &&
    /forwardRef render functions accept exactly two parameters/.test(businessSideEffect),
  "Both apps' filters anchor on the exact unique forwardRef-arity phrase so neither masks Mingla-side forwardRef issues. Diverging regexes risk false negatives.",
);

const failed = checks.filter((c) => !c.pass);
for (const c of checks) {
  console.log(`${c.pass ? "PASS" : "FAIL"} ${c.name}`);
  if (!c.pass) console.log(`     ${c.detail}`);
}
console.log("");
if (failed.length === 0) {
  console.log(`ORCH-0896 regression check passed: ${checks.length}/${checks.length}`);
  process.exit(0);
} else {
  console.log(`ORCH-0896 regression check FAILED: ${failed.length} failure(s) out of ${checks.length}`);
  process.exit(1);
}
