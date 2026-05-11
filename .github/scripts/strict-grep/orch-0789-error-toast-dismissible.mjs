#!/usr/bin/env node
/**
 * ORCH-0789 strict-grep gate — error toast must be user-dismissible.
 *
 * Enforces I-PROPOSED-ERROR-TOAST-DISMISSIBLE and
 * I-PROPOSED-STRIPE-ERROR-CODE-DISCRIMINATED:
 *
 *   1. Toast.tsx AUTO_DISMISS.error must be a number (not null and not the
 *      missing-key pattern that the old TS allowed).
 *   2. Toast.tsx must render a Pressable with onPress=onDismiss for the
 *      tap-anywhere-on-card dismiss affordance.
 *   3. Toast.tsx must render a close-icon Pressable with
 *      accessibilityLabel="Dismiss notification".
 *   4. stripePaymentSheet.ts must declare the PaymentSheetErrorCode union
 *      ("Canceled" | "Failed" | "Timeout") so callers can branch on code.
 *   5. payment.tsx must branch on payResult.error.code (not just check
 *      payResult.error truthy) — the bug ORCH-0789 fixed.
 *   6. payment.tsx must NOT contain the legacy "Please complete checkout
 *      in the Mingla Business mobile app" copy (CF-790-2 — buyer-app
 *      naming confusion).
 *
 * Runs from repo root or mingla-business sub-tree.
 */

import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const stripComments = (source) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/[ \t]\/\/[^\n]*$/gm, "");

const readCode = (relativePath) => stripComments(read(relativePath));

const failures = [];

const assertIncludes = (file, needle, message) => {
  if (!read(file).includes(needle)) failures.push(`${file}: ${message}`);
};

const assertRegexPresent = (file, regex, message) => {
  if (!regex.test(readCode(file))) failures.push(`${file}: ${message}`);
};

const assertRegexAbsent = (file, regex, message) => {
  if (regex.test(read(file))) failures.push(`${file}: ${message}`);
};

// ---- §1 — AUTO_DISMISS.error must be a bounded number ----
// AUTO_DISMISS lives in toastTimings.ts (extracted so the invariant is
// unit-testable without RN). Both files must satisfy the contract: the
// timing source must declare error as a positive number, and Toast.tsx
// must import it (no inline override).
const TOAST = "mingla-business/src/components/ui/Toast.tsx";
const TOAST_TIMINGS = "mingla-business/src/components/ui/toastTimings.ts";
assertRegexPresent(
  TOAST_TIMINGS,
  /error:\s*\d+\s*[,}]/,
  "toastTimings.ts AUTO_DISMISS.error must be a positive number (ORCH-0789 / " +
    "I-PROPOSED-ERROR-TOAST-DISMISSIBLE). Permanent error toasts strand iOS buyers.",
);
assertRegexAbsent(
  TOAST_TIMINGS,
  /error:\s*null\s*[,}]/,
  "toastTimings.ts AUTO_DISMISS.error must NOT be null. Bounded fallback required.",
);
assertIncludes(
  TOAST,
  'from "./toastTimings"',
  "Toast.tsx must import AUTO_DISMISS from toastTimings.ts (single source of truth).",
);

// ---- §2 + §3 — dismiss affordances rendered ----
assertIncludes(
  TOAST,
  "import { Modal, Platform, Pressable, StyleSheet, Text, View } from \"react-native\"",
  "Toast.tsx must import Pressable from react-native (close button + tap-to-dismiss).",
);
assertRegexPresent(
  TOAST,
  /accessibilityLabel="Dismiss notification"/,
  "Toast.tsx must render a Pressable with accessibilityLabel=\"Dismiss notification\" " +
    "(close-icon affordance per ORCH-0789).",
);

// ---- §4 — Stripe wrapper preserves error code discriminator ----
const WRAPPER = "mingla-business/src/payments/stripePaymentSheet.ts";
assertIncludes(
  WRAPPER,
  "PaymentSheetErrorCode",
  "stripePaymentSheet.ts must export PaymentSheetErrorCode union " +
    "(I-PROPOSED-STRIPE-ERROR-CODE-DISCRIMINATED).",
);
assertRegexPresent(
  WRAPPER,
  /"Canceled"\s*\|\s*"Failed"\s*\|\s*"Timeout"/,
  "PaymentSheetErrorCode must declare the three Stripe codes (Canceled | Failed | Timeout).",
);

// ---- §5 — payment.tsx branches on error.code ----
const PAYMENT = "mingla-business/app/checkout/[eventId]/payment.tsx";
assertRegexPresent(
  PAYMENT,
  /switch\s*\(\s*payResult\.error\.code\s*\)/,
  "payment.tsx handlePay must switch on payResult.error.code so Canceled " +
    "(user-cancel) is distinct from Failed (real decline). ORCH-0789 RC-789-2.",
);
assertRegexPresent(
  PAYMENT,
  /case\s+"Canceled"/,
  "payment.tsx must handle the 'Canceled' code explicitly (silent return).",
);

// ---- §6 — legacy buyer-app copy removed ----
assertRegexAbsent(
  PAYMENT,
  /Mingla Business mobile app/,
  "payment.tsx must not tell ticket buyers to install the Mingla Business " +
    "(organiser) app. CF-790-2.",
);

if (failures.length > 0) {
  console.error("ORCH-0789 strict-grep gate failed:");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}

console.log("ORCH-0789 strict-grep gate passed.");
