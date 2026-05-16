#!/usr/bin/env node

/**
 * I-PROPOSED-STRIPE-PAYMENTSHEET-PARITY strict-grep gate (ORCH-0849).
 *
 * Both app-mobile (consumer) and mingla-business (operator + buyer)
 * MUST adopt the same native PaymentSheet pattern:
 *   - Mount <StripeNativeProvider> at the app's root _layout.tsx with
 *     a merchantIdentifier + urlScheme.
 *   - Have a per-app nativeCheckoutFlow.ts that imports `initStripe`
 *     from @stripe/stripe-react-native AND calls initStripe with a
 *     stripeAccountId BEFORE initPaymentSheet.
 *   - Pass `customer` + `customerEphemeralKeySecret` to initPaymentSheet
 *     (ORCH-0844 saved-PM contract).
 *
 * If either app drifts (provider mount removed, initStripe stops being
 * called per-PI, customer/ephemeralKey stops being passed), this gate
 * fires and parity is restored before merge.
 *
 * Detection rules (all 8 must hold for exit 0):
 *
 *   Consumer (app-mobile):
 *     R-1 — app-mobile/app/_layout.tsx mounts <StripeNativeProvider> with
 *           merchantIdentifier="merchant.com.mingla.app.v2" AND
 *           urlScheme="com.mingla.app.v2".
 *     R-2 — app-mobile/src/payments/nativeCheckoutFlow.ts imports
 *           initStripe from @stripe/stripe-react-native.
 *     R-3 — same file calls initStripe with a stripeAccountId key.
 *     R-4 — same file passes customer + customerEphemeralKeySecret to
 *           initPaymentSheet.
 *
 *   Business (mingla-business):
 *     R-5 — mingla-business/app/_layout.tsx mounts <StripeNativeProvider>
 *           with merchantIdentifier="merchant.com.mingla.business.v2" AND
 *           urlScheme="com.mingla.business.v2".
 *     R-6 — mingla-business/src/payments/nativeCheckoutFlow.ts imports
 *           initStripe from @stripe/stripe-react-native.
 *     R-7 — same file calls initStripe with a stripeAccountId key.
 *     R-8 — same file passes customer + customerEphemeralKeySecret to
 *           initPaymentSheet.
 *
 * Exit codes:
 *   0 — all 8 rules hold (gate green)
 *   1 — at least one rule violated (gate red — parity broken)
 *   2 — file system error
 *
 * Modeled on `i-stripe-pm-method-allowlist.mjs` (regex-style, single-file
 * scans, line-comment filtering). Established by SPEC_ORCH-0849 §3.5.3.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

const CONSUMER_LAYOUT = "app-mobile/app/_layout.tsx";
const CONSUMER_FLOW = "app-mobile/src/payments/nativeCheckoutFlow.ts";
// ORCH-0849: mingla-business uses platform-extension files to keep the web
// bundle free of @stripe/stripe-react-native (I-PROPOSED-AE / ORCH-0778):
//   - StripeProviderWrapper.native.tsx bakes in the business merchantIdentifier
//     + urlScheme and wraps with the real <StripeNativeProvider>.
//   - nativeCheckoutFlow.native.ts holds the real PaymentSheet glue
//     (initStripe / initPaymentSheet / presentPaymentSheet).
// Both bare-extension siblings are passthrough stubs picked by Metro on
// web and by tsc resolution. Parity is verified against the native files.
const BUSINESS_LAYOUT = "mingla-business/src/payments/StripeProviderWrapper.native.tsx";
const BUSINESS_FLOW = "mingla-business/src/payments/nativeCheckoutFlow.native.ts";

function readOrFail(rel) {
  try {
    return fs.readFileSync(path.join(repoRoot, rel), "utf8");
  } catch (err) {
    console.error(
      `[i-stripe-paymentsheet-parity] FAIL — could not read ${rel}: ${err.message}`,
    );
    process.exit(2);
  }
}

function nonCommentText(source) {
  return source
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
}

const failures = [];
const passes = [];

function checkProviderMount(source, file, merchantId, urlScheme, ruleId) {
  const nc = nonCommentText(source);
  const hasComp = /<StripeNativeProvider\b/.test(nc);
  const hasMerchant = new RegExp(
    `merchantIdentifier=["']${merchantId.replace(/\./g, "\\.")}["']`,
  ).test(nc);
  const hasScheme = new RegExp(
    `urlScheme=["']${urlScheme.replace(/\./g, "\\.")}["']`,
  ).test(nc);
  if (hasComp && hasMerchant && hasScheme) {
    passes.push(
      `${ruleId}: ${file} mounts <StripeNativeProvider merchantIdentifier="${merchantId}" urlScheme="${urlScheme}">`,
    );
  } else {
    const missing = [];
    if (!hasComp) missing.push("<StripeNativeProvider component");
    if (!hasMerchant) missing.push(`merchantIdentifier="${merchantId}"`);
    if (!hasScheme) missing.push(`urlScheme="${urlScheme}"`);
    failures.push(
      `${ruleId}: ${file} missing: ${missing.join(", ")}`,
    );
  }
}

function checkFlowFile(source, file, ruleIdImport, ruleIdInitStripe, ruleIdCustomer) {
  const nc = nonCommentText(source);
  if (
    /import\s+\{[^}]*\binitStripe\b[^}]*\}\s+from\s+["']@stripe\/stripe-react-native["']/
      .test(nc)
  ) {
    passes.push(`${ruleIdImport}: ${file} imports initStripe from @stripe/stripe-react-native`);
  } else {
    failures.push(
      `${ruleIdImport}: ${file} missing \`import { initStripe } from "@stripe/stripe-react-native"\``,
    );
  }
  // initStripe call site that passes stripeAccountId
  if (
    /initStripe\s*\(\s*\{[^}]*stripeAccountId\s*:/.test(nc)
  ) {
    passes.push(
      `${ruleIdInitStripe}: ${file} calls initStripe({...stripeAccountId...})`,
    );
  } else {
    failures.push(
      `${ruleIdInitStripe}: ${file} missing per-PI \`initStripe({ ..., stripeAccountId, ... })\` call`,
    );
  }
  // initPaymentSheet body containing customer + customerEphemeralKeySecret
  const hasCustomer = /\bcustomerId\s*:/.test(nc);
  const hasEphem = /\bcustomerEphemeralKeySecret\s*:/.test(nc);
  if (hasCustomer && hasEphem) {
    passes.push(
      `${ruleIdCustomer}: ${file} passes customerId + customerEphemeralKeySecret`,
    );
  } else {
    const missing = [];
    if (!hasCustomer) missing.push("customerId");
    if (!hasEphem) missing.push("customerEphemeralKeySecret");
    failures.push(
      `${ruleIdCustomer}: ${file} missing keys: ${missing.join(", ")}`,
    );
  }
}

// ─── Consumer (app-mobile) ──────────────────────────────────────────────
const consumerLayout = readOrFail(CONSUMER_LAYOUT);
checkProviderMount(
  consumerLayout,
  CONSUMER_LAYOUT,
  "merchant.com.mingla.app.v2",
  "com.mingla.app.v2",
  "R-1",
);

const consumerFlow = readOrFail(CONSUMER_FLOW);
checkFlowFile(consumerFlow, CONSUMER_FLOW, "R-2", "R-3", "R-4");

// ─── Business (mingla-business) ─────────────────────────────────────────
const businessLayout = readOrFail(BUSINESS_LAYOUT);
checkProviderMount(
  businessLayout,
  BUSINESS_LAYOUT,
  "merchant.com.mingla.business.v2",
  "com.mingla.business.v2",
  "R-5",
);

const businessFlow = readOrFail(BUSINESS_FLOW);
checkFlowFile(businessFlow, BUSINESS_FLOW, "R-6", "R-7", "R-8");

// ─── Report ─────────────────────────────────────────────────────────────

if (failures.length > 0) {
  console.error(
    "[i-stripe-paymentsheet-parity] FAIL — ORCH-0849 invariant I-PROPOSED-STRIPE-PAYMENTSHEET-PARITY violated:",
  );
  for (const f of failures) {
    console.error("  - " + f);
  }
  console.error("");
  console.error(
    "See `Mingla_Artifacts/specs/SPEC_ORCH-0849_STRIPE_PAYMENT_METHOD_PARITY.md` §3.5.3 for the required gate shape and §3.4 for both apps' adoption requirements.",
  );
  process.exit(1);
}

console.log(
  "[i-stripe-paymentsheet-parity] PASS — all 8 rules hold (consumer + business parity intact):",
);
for (const p of passes) {
  console.log("  - " + p);
}
process.exit(0);
