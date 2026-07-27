#!/usr/bin/env node
// META-ORCH-0827 Pass 2 — consumer app must stay native-only on Stripe.
//
// app-mobile/ MUST NOT import any web-side Stripe SDK
// (@stripe/stripe-js, @stripe/react-stripe-js, @stripe/connect-js,
// @stripe/react-connect-js). The consumer app has no web target and
// no Stripe Connect onboarding surface — only native PaymentSheet
// via @mingla/payments-native.
//
// Preserves I-MOR-0827-CONSUMER-NATIVE-STRIPE-ONLY.
//
// `--self-test` proves fail-on-revert (mirrors i-1272-identity-admin-read.mjs):
// the pure `check(fileEntries, failures)` is exercised with a GOOD fixture and
// ≥2 DISTINCT BAD fixtures. The disk-walking main path feeds the SAME
// `check(...)` synthetic entries built from the walk; the refactor is
// behavior-preserving (identical verdict on the real tree).

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const consumerRoot = path.join(root, "app-mobile");

const failures = [];

const forbiddenStripePackages = [
  "@stripe/stripe-js",
  "@stripe/react-stripe-js",
  "@stripe/connect-js",
  "@stripe/react-connect-js",
];

const buildPattern = (pkg) =>
  new RegExp(
    `(?:import\\s+[^"']*["']${pkg.replace(
      /[/\-]/g,
      (m) => `\\${m}`,
    )}["']|from\\s+["']${pkg.replace(
      /[/\-]/g,
      (m) => `\\${m}`,
    )}["']|require\\(\\s*["']${pkg.replace(
      /[/\-]/g,
      (m) => `\\${m}`,
    )}["']\\s*\\))`,
  );

const patterns = forbiddenStripePackages.map((pkg) => ({
  pkg,
  pattern: buildPattern(pkg),
}));

// Pure verdict. `fileEntries` = [{ relativePath, source }]. Pushes one violation
// per (file × forbidden-package) match into `failures`.
function check(fileEntries, failures) {
  for (const { relativePath, source } of fileEntries) {
    for (const { pkg, pattern } of patterns) {
      if (pattern.test(source)) {
        failures.push(
          `${relativePath} import-scan: app-mobile imports web-only ` +
            `Stripe SDK '${pkg}'. Consumer is native-only; use ` +
            `@mingla/payments-native via @stripe/stripe-react-native instead. ` +
            `Violates I-MOR-0827-CONSUMER-NATIVE-STRIPE-ONLY.`,
        );
      }
    }
  }
}

const walk = (directory, fileEntries) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    if (entry.name === "dist" || entry.name === "ios" || entry.name === "android") continue;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(absolutePath, fileEntries);
      continue;
    }
    if (!/\.(ts|tsx|js|jsx)$/.test(entry.name)) continue;
    const relativePath = path.relative(root, absolutePath);
    const source = fs.readFileSync(absolutePath, "utf8");
    fileEntries.push({ relativePath, source });
  }
};

// ─────────────────────────────────────────────────────────────── self-test
if (process.argv.includes("--self-test")) {
  const self = [];

  // GOOD: a consumer file importing ONLY the native Stripe SDK → silent.
  let f = [];
  check(
    [
      {
        relativePath: "app-mobile/src/payments/native.ts",
        source: "import { initPaymentSheet } from '@stripe/stripe-react-native';\n",
      },
    ],
    f,
  );
  if (f.length) self.push("GOOD (native-only Stripe import) wrongly flagged: " + f.join("; "));

  // BAD1 (revert-style): a web Stripe SDK import (@stripe/stripe-js) → fires.
  f = [];
  check(
    [{ relativePath: "app-mobile/src/pay.tsx", source: "import { loadStripe } from '@stripe/stripe-js';\n" }],
    f,
  );
  if (f.length === 0) self.push("BAD1 (@stripe/stripe-js import in app-mobile) not flagged");

  // BAD2 (regression, different angle): a DIFFERENT web SDK
  // (@stripe/react-connect-js) in a second consumer file → fires.
  f = [];
  check(
    [{ relativePath: "app-mobile/src/connect.tsx", source: "import { ConnectComponentsProvider } from '@stripe/react-connect-js';\n" }],
    f,
  );
  if (f.length === 0) self.push("BAD2 (@stripe/react-connect-js import in a second app-mobile file) not flagged");

  if (self.length) {
    console.error("META-ORCH-0827 self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("META-ORCH-0827 self-test PASS (3/3 cases).");
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────── main path
if (!fs.existsSync(consumerRoot)) {
  console.log("app-mobile/ directory does not exist — nothing to check.");
  process.exit(0);
}

const fileEntries = [];
walk(consumerRoot, fileEntries);
check(fileEntries, failures);

if (failures.length > 0) {
  console.error("\nMETA-ORCH-0827 consumer-native-Stripe-only gate FAILED:\n");
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  console.error("");
  process.exit(1);
}

console.log("META-ORCH-0827 consumer-native-Stripe-only gate PASS.");
