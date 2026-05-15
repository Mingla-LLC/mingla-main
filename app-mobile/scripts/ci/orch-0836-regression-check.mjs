#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-0836 regression check — Stripe RN 0.65.1 forwardRef warning silenced
 * via LogBox.ignoreLogs at app root.
 *
 * Asserts the Path B fix from SPEC_ORCH-0835_0836_0837_BUNDLED_DISCOVER_LOGBOX_STRIPE_CARDONLY.md:
 * app/_layout.tsx must import LogBox from react-native AND call
 * LogBox.ignoreLogs with a regex matching the Stripe forwardRef warning.
 *
 * The warning comes from Stripe RN 0.65.1's PaymentMethodMessagingElement.js
 * which uses `forwardRef(function(_ref){...})` (one parameter) — React 19
 * rejects this in dev mode. We never render PaymentMethodMessagingElement
 * (zero grep matches in Mingla code), so the warning is informational noise.
 *
 * Exit 1 on any FAIL. 2 contracts (T-B0, T-B1).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");

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

// ─── T-B0: LogBox import present in app/_layout.tsx ──────────────────────

const layout = readMaybe(path.join(root, "app/_layout.tsx"));

check(
  "T-B0 app/_layout.tsx imports LogBox from react-native",
  layout !== null &&
    /import\s+\{[^}]*\bLogBox\b[^}]*\}\s+from\s+["']react-native["']/.test(
      layout,
    ),
  "app/_layout.tsx MUST import LogBox from react-native to enable the warning filter for the Stripe RN forwardRef defect.",
);

// ─── T-B1: LogBox.ignoreLogs called with forwardRef regex ────────────────

check(
  "T-B1 app/_layout.tsx calls LogBox.ignoreLogs with the forwardRef regex pattern",
  layout !== null &&
    /LogBox\.ignoreLogs\(\s*\[[\s\S]{0,200}?\/forwardRef render functions accept exactly two parameters\//.test(
      layout,
    ),
  "app/_layout.tsx MUST register the regex `/forwardRef render functions accept exactly two parameters/` in LogBox.ignoreLogs so the Stripe RN 0.65.1 PaymentMethodMessagingElement warning stops cluttering Metro logs.",
);

// ─── Report ────────────────────────────────────────────────────────────────

console.log("\nORCH-0836 regression check\n");
let failed = 0;
for (const c of checks) {
  const tag = c.pass ? "PASS" : "FAIL";
  console.log(`  [${tag}] ${c.name}`);
  if (!c.pass) {
    console.log(`         ${c.detail}`);
    failed += 1;
  }
}
console.log(
  `\nSummary: ${checks.length - failed}/${checks.length} PASS${
    failed > 0 ? ` (${failed} FAIL)` : ""
  }\n`,
);
process.exit(failed > 0 ? 1 : 0);
