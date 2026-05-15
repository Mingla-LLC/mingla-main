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

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const consumerRoot = path.join(root, "app-mobile");

if (!fs.existsSync(consumerRoot)) {
  console.log("app-mobile/ directory does not exist — nothing to check.");
  process.exit(0);
}

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

const walk = (directory) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    if (entry.name === "dist" || entry.name === "ios" || entry.name === "android") continue;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(absolutePath);
      continue;
    }
    if (!/\.(ts|tsx|js|jsx)$/.test(entry.name)) continue;
    const relativePath = path.relative(root, absolutePath);
    const source = fs.readFileSync(absolutePath, "utf8");
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
};

walk(consumerRoot);

if (failures.length > 0) {
  console.error("\nMETA-ORCH-0827 consumer-native-Stripe-only gate FAILED:\n");
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  console.error("");
  process.exit(1);
}

console.log("META-ORCH-0827 consumer-native-Stripe-only gate PASS.");
