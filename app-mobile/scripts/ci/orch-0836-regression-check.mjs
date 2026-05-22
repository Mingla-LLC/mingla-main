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

// ─── T-B0: LogBox import present in the side-effect module ──────────────
//
// ORCH-0896 [Stripe forwardRef RedBox under React 19.1] superseded the
// original ORCH-0835 [bundled Discover/LogBox/Stripe card-only fix] location:
// LogBox.ignoreLogs moved from app/_layout.tsx (which fired AFTER the Stripe
// import due to ES module hoisting) to a side-effect module at
// src/diagnostics/silenceStripeForwardRef.ts whose top-level statement runs
// at the importing file's import position — armed BEFORE the Stripe import.
// See: app-mobile/scripts/ci/orch-0896-regression-check.mjs for the
// dedicated import-order check (T-S02).

const layout = readMaybe(path.join(root, "app/_layout.tsx"));
const sideEffect = readMaybe(
  path.join(root, "src/diagnostics/silenceStripeForwardRef.ts"),
);

check(
  "T-B0 silenceStripeForwardRef.ts imports LogBox from react-native (post-ORCH-0896 location)",
  sideEffect !== null &&
    /import\s+\{[^}]*\bLogBox\b[^}]*\}\s+from\s+["']react-native["']/.test(
      sideEffect,
    ),
  "src/diagnostics/silenceStripeForwardRef.ts MUST import LogBox from react-native — the canonical post-ORCH-0896 location for the Stripe forwardRef filter.",
);

// ─── T-B1: LogBox.ignoreLogs called with forwardRef regex ────────────────

check(
  "T-B1 silenceStripeForwardRef.ts calls LogBox.ignoreLogs with the forwardRef regex pattern",
  sideEffect !== null &&
    /LogBox\.ignoreLogs\(\s*\[[\s\S]{0,200}?\/forwardRef render functions accept exactly two parameters\//.test(
      sideEffect,
    ),
  "src/diagnostics/silenceStripeForwardRef.ts MUST register the regex `/forwardRef render functions accept exactly two parameters/` in LogBox.ignoreLogs so the Stripe RN 0.65.1 PaymentMethodMessagingElement warning stops cluttering Metro logs.",
);

// ─── T-B2 (ORCH-0896): _layout.tsx imports the side-effect module ────────

check(
  "T-B2 app/_layout.tsx imports the silenceStripeForwardRef side-effect module (ORCH-0896 wiring)",
  layout !== null &&
    /import\s+["']\.\.\/src\/diagnostics\/silenceStripeForwardRef["']/.test(layout),
  "Without this import the side-effect module never evaluates and the filter never registers. Side-effect-only modules MUST be imported (no named imports needed).",
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
