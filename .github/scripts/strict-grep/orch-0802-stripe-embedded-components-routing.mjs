#!/usr/bin/env node
/**
 * ORCH-0802 strict-grep gate — I-PROPOSED-O
 * STRIPE_EMBEDDED_COMPONENTS_VIA_OFFICIAL_SDK_ONLY.
 *
 * Enforces the post-ORCH-0802 routing rule for Stripe Connect Embedded
 * Components in mingla-business:
 *
 *   - Path B (canonical today): Mingla-hosted web page using
 *     `@stripe/react-connect-js` (Web JS SDK) opened in the device's
 *     system browser via `expo-web-browser`. This is what
 *     `app/connect-onboarding.tsx` already does for Account Onboarding.
 *   - Path A (held until GA): Stripe's `@stripe/stripe-react-native`
 *     Connect Embedded Components SDK rendered inline natively. As of
 *     2026-05-12 all three RN components (Account Onboarding, Payments,
 *     Payouts) are Preview status, so Path A is FORBIDDEN until they
 *     reach GA.
 *   - FORBIDDEN regardless: DIY-wrapping `@stripe/connect-js` (the bare
 *     Web JS SDK package) inside `react-native-webview`. Breaks deep
 *     linking, accessibility, audit-log capture, and HTTPS-relay return
 *     URLs.
 *
 * Three checks (all must pass; any failure exits non-zero):
 *
 *   1. NO file under `mingla-business/src/` imports `@stripe/connect-js`
 *      OR `@stripe/react-connect-js`. These are Web JS packages and must
 *      stay inside the Mingla-hosted web pages under `mingla-business/app/`
 *      (Path B). Importing them from `src/` would bundle the Web JS SDK
 *      into native RN code (broken at runtime) and signals an
 *      accidental Path A attempt.
 *   2. NO file under `mingla-business/` imports BOTH
 *      `@stripe/stripe-react-native` AND `ConnectComponentsProvider`
 *      together — the RN SDK Connect Embedded Components Path A marker.
 *      Kept disabled until I-PROPOSED-O EXIT condition (all three RN
 *      components reach GA).
 *   3. The string `WebView` does NOT appear in the same file as
 *      `@stripe/connect-js` or the literal URL `connect.stripe.com`
 *      (anti-WebView-wrap guard).
 *
 * EXIT condition for Check 2: when Stripe ships all three RN Connect
 * Embedded Components at GA status, register a new ORCH cycle to
 * re-evaluate Path A adoption and update this gate at that time.
 *
 * Per ORCH-0802 SPEC §9 + INVARIANT_REGISTRY I-PROPOSED-O.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..", "..");
const BUSINESS_ROOT = join(REPO_ROOT, "mingla-business");
const BUSINESS_SRC = join(BUSINESS_ROOT, "src");

const EXTS = new Set([".ts", ".tsx", ".js", ".jsx"]);

/** Recursively yield every source file under a directory. */
function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".expo") continue;
      yield* walk(full);
    } else if (entry.isFile()) {
      const dot = entry.name.lastIndexOf(".");
      if (dot < 0) continue;
      if (EXTS.has(entry.name.slice(dot))) yield full;
    }
  }
}

function readOrEmpty(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

const failures = [];

let scanned = 0;
const files = [];
try {
  for (const file of walk(BUSINESS_ROOT)) {
    files.push(file);
    scanned += 1;
  }
} catch (err) {
  failures.push(`Walk FAIL: cannot scan mingla-business/: ${err.message}`);
}

// Check 1 — Stripe Web JS SDK packages are forbidden in mingla-business/src/
// (the shared RN code tree). Mingla-hosted web pages under mingla-business/app/
// may import them (that's Path B per I-PROPOSED-O). Importing them from RN
// source code would either fail to bundle natively or signal an accidental
// Path A attempt.
const CHECK1_PATTERN = /from\s+["']@stripe\/(react-)?connect-js["']/;
for (const file of files) {
  if (!file.startsWith(BUSINESS_SRC)) continue;
  const src = readOrEmpty(file);
  if (CHECK1_PATTERN.test(src)) {
    const rel = relative(REPO_ROOT, file);
    failures.push(
      `Check 1 FAIL (${rel}): Stripe Web JS SDK import in mingla-business/src/ is FORBIDDEN. These packages belong in Mingla-hosted web pages under mingla-business/app/ (Path B). I-PROPOSED-O.`,
    );
  }
}

// Check 2 — no Path A marker (RN SDK Connect Embedded Components)
// Path A is FORBIDDEN until all three RN components reach GA.
const CHECK2_PATTERN_A = /from\s+["']@stripe\/stripe-react-native["']/;
const CHECK2_PATTERN_B = /ConnectComponentsProvider/;
for (const file of files) {
  const src = readOrEmpty(file);
  if (CHECK2_PATTERN_A.test(src) && CHECK2_PATTERN_B.test(src)) {
    const rel = relative(REPO_ROOT, file);
    failures.push(
      `Check 2 FAIL (${rel}): RN SDK Connect Embedded Components (Path A) is FORBIDDEN until all three Preview components reach GA. Use Path B (Mingla-hosted web page + expo-web-browser) instead — see app/connect-onboarding.tsx. I-PROPOSED-O EXIT condition.`,
    );
  }
}

// Check 3 — anti-WebView-wrap guard
// Disallow co-occurrence of WebView + (@stripe/connect-js | connect.stripe.com) in the same file.
const CHECK3_WEBVIEW = /\bWebView\b/;
const CHECK3_STRIPE = /(@stripe\/connect-js|connect\.stripe\.com)/;
for (const file of files) {
  const src = readOrEmpty(file);
  if (CHECK3_WEBVIEW.test(src) && CHECK3_STRIPE.test(src)) {
    const rel = relative(REPO_ROOT, file);
    failures.push(
      `Check 3 FAIL (${rel}): DIY WebView wrap of Stripe Embedded Components is FORBIDDEN. Use Path B (expo-web-browser) instead. I-PROPOSED-O.`,
    );
  }
}

if (failures.length > 0) {
  console.error("ORCH-0802 strict-grep FAIL:");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}

console.log(
  `ORCH-0802 strict-grep PASS — 3/3 checks (scanned ${scanned} files).`,
);
