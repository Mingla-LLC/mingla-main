#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-0829-B mobile-side regression check.
 *
 * Asserts the Stripe PaymentSheet once-only guard + returnURL contracts
 * that make Bug Z (double-resolve) regression-proof:
 *
 *   T-B1 useStripePaymentSheet imports useRef + declares inFlightInitRef + inFlightPresentRef
 *   T-B2 presentPaymentSheet wrapper checks inFlightPresentRef before invoking native
 *   T-B3 both wrappers clear the ref in a finally block (no leak on throw)
 *   T-B4 diagnostic logs present (→ native call + ← resolved)
 *   T-B5 nativeCheckoutFlow.initPaymentSheet call includes returnURL
 *   T-B6 useStripePaymentSheet does NOT export the raw useStripe.presentPaymentSheet
 *        (no re-export of the unguarded native API)
 *
 * Invariants codified:
 *   I-PROPOSED-STRIPE-PRESENT-ONCE-ONLY  (T-B1..T-B6)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const repoRoot = path.resolve(root, "..");
const readMaybe = (absRel) => {
  try {
    return fs.readFileSync(absRel, "utf8");
  } catch {
    return null;
  }
};

const checks = [];
const check = (name, pass, detail) => {
  checks.push({ name, pass, detail });
};

const hook = readMaybe(
  path.join(repoRoot, "packages/payments-native/useStripePaymentSheet.ts"),
);
const flow = readMaybe(
  path.join(root, "src/payments/nativeCheckoutFlow.ts"),
);

// ─── Once-only guard ───────────────────────────────────────────────────────

check(
  "T-B1 useStripePaymentSheet imports useRef + declares both inFlight refs",
  hook !== null &&
    /import\s+\{\s*useRef\s*\}\s+from\s+["']react["']/.test(hook) &&
    /inFlightInitRef\s*=\s*useRef/.test(hook) &&
    /inFlightPresentRef\s*=\s*useRef/.test(hook),
  "packages/payments-native/useStripePaymentSheet.ts MUST import useRef from react and declare both inFlightInitRef and inFlightPresentRef.",
);

check(
  "T-B2 presentPaymentSheet checks ref before native invoke",
  hook !== null &&
    /presentPaymentSheet:\s*async[\s\S]{0,300}?if\s*\(\s*inFlightPresentRef\.current\s*!==\s*null\s*\)\s*\{[\s\S]{0,200}?return\s+inFlightPresentRef\.current/.test(
      hook,
    ),
  "presentPaymentSheet wrapper MUST short-circuit when inFlightPresentRef.current is non-null.",
);

check(
  "T-B3 both wrappers clear ref in finally block",
  hook !== null &&
    /finally\s*\{\s*inFlightInitRef\.current\s*=\s*null/.test(hook) &&
    /finally\s*\{\s*inFlightPresentRef\.current\s*=\s*null/.test(hook),
  "Both init + present wrappers MUST clear their ref in a finally block (otherwise a throw leaks the ref).",
);

check(
  "T-B4 diagnostic logs present",
  hook !== null &&
    /\[useStripePaymentSheet\]\s+presentPaymentSheet\s+→\s+native call/.test(
      hook,
    ) &&
    /\[useStripePaymentSheet\]\s+presentPaymentSheet\s+←\s+resolved/.test(
      hook,
    ),
  "Wrapper MUST emit `→ native call` and `← resolved` diagnostic logs for present (init similar).",
);

// ─── returnURL ─────────────────────────────────────────────────────────────

check(
  "T-B5 nativeCheckoutFlow initPaymentSheet includes returnURL",
  flow !== null &&
    /initPaymentSheet\(\{[\s\S]{0,1500}?returnURL:\s*["']com\.mingla\.app\.v2:\/\/[^"']+["']/.test(
      flow,
    ),
  "nativeCheckoutFlow.ts initPaymentSheet call MUST include returnURL matching the app.json scheme (com.mingla.app.v2://...).",
);

// ─── No raw re-export ──────────────────────────────────────────────────────

check(
  "T-B6 useStripePaymentSheet does NOT re-export raw presentPaymentSheet",
  hook !== null &&
    !/export\s*\{[^}]*presentPaymentSheet[^}]*\}\s+from\s+["']@stripe\/stripe-react-native["']/.test(
      hook,
    ),
  "useStripePaymentSheet MUST NOT re-export the raw Stripe presentPaymentSheet (which would bypass the once-only guard).",
);

// ─── Report ────────────────────────────────────────────────────────────────

let allPass = true;
console.log("\nORCH-0829-B mobile regression check\n" + "=".repeat(44));
for (const c of checks) {
  const tag = c.pass ? "PASS" : "FAIL";
  console.log(`  [${tag}] ${c.name}`);
  if (!c.pass) {
    console.log(`         → ${c.detail}`);
    allPass = false;
  }
}
console.log();
if (!allPass) {
  console.error(
    `ORCH-0829-B regression check FAILED: ${checks.filter((c) => !c.pass).length}/${checks.length} contracts violated.`,
  );
  process.exit(1);
}
console.log(
  `ORCH-0829-B regression check PASS: ${checks.length}/${checks.length}.`,
);
