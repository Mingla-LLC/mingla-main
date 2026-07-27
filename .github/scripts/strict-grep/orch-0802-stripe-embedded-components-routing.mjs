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

// Check 1 — Stripe Web JS SDK packages are forbidden in mingla-business/src/
// (the shared RN code tree). Mingla-hosted web pages under mingla-business/app/
// may import them (that's Path B per I-PROPOSED-O). Importing them from RN
// source code would either fail to bundle natively or signal an accidental
// Path A attempt.
//
// ORCH-1083 exemption: `.web.tsx` / `.web.ts` files under src/ are web-only by
// Metro's platform-extension resolution — they are bundled ONLY into the web
// build and CANNOT enter the native RN bundle. ORCH-1083 §C-1 extracts the
// connect-page bodies into `src/components/stripe/connect-pages/*Body.web.tsx`
// so the route shells under app/ can React.lazy them out of the initial web
// bundle. These extracted bodies still carry the Path-B Web JS SDK, but because
// the `.web` infix guarantees web-only bundling, the Check-1 hazard (Web JS in
// NATIVE code) does not apply. See SPEC §C-1 + INVARIANT I-PROPOSED-1083-A.
const CHECK1_PATTERN = /from\s+["']@stripe\/(react-)?connect-js["']/;
const WEB_ONLY_EXT = /\.web\.(tsx?|jsx?)$/;
// Check 2 — no Path A marker (RN SDK Connect Embedded Components)
// Path A is FORBIDDEN until all three RN components reach GA.
const CHECK2_PATTERN_A = /from\s+["']@stripe\/stripe-react-native["']/;
const CHECK2_PATTERN_B = /ConnectComponentsProvider/;
// Check 3 — anti-WebView-wrap guard
// Disallow co-occurrence of WebView + (@stripe/connect-js | connect.stripe.com).
const CHECK3_WEBVIEW = /\bWebView\b/;
const CHECK3_STRIPE = /(@stripe\/connect-js|connect\.stripe\.com)/;

// mingla-business/src/ repo-relative prefix — Check 1 only applies under src/.
const BUSINESS_SRC_REL = "mingla-business/src";

/**
 * Pure verdict. `fileEntries` = [{ rel, content }] with `rel` the repo-relative
 * POSIX path (drives Check-1's src/ scoping + .web exemption, and all reporting).
 * Runs the three checks in the original order (all Check-1 hits, then Check-2,
 * then Check-3) so the emitted failure list is byte-identical to the original.
 * Behavior-preserving refactor.
 */
function check(fileEntries, failures) {
  // Check 1 — Web JS SDK forbidden in native src/ (web-only files exempt).
  for (const { rel, content } of fileEntries) {
    if (!rel.startsWith(BUSINESS_SRC_REL)) continue;
    if (WEB_ONLY_EXT.test(rel)) continue; // web-only file → never in native bundle
    if (CHECK1_PATTERN.test(content)) {
      failures.push(
        `Check 1 FAIL (${rel}): Stripe Web JS SDK import in mingla-business/src/ is FORBIDDEN. These packages belong in Mingla-hosted web pages under mingla-business/app/ (Path B). I-PROPOSED-O.`,
      );
    }
  }
  // Check 2 — Path A RN SDK Connect Embedded Components marker (held until GA).
  for (const { rel, content } of fileEntries) {
    if (CHECK2_PATTERN_A.test(content) && CHECK2_PATTERN_B.test(content)) {
      failures.push(
        `Check 2 FAIL (${rel}): RN SDK Connect Embedded Components (Path A) is FORBIDDEN until all three Preview components reach GA. Use Path B (Mingla-hosted web page + expo-web-browser) instead — see app/connect-onboarding.tsx. I-PROPOSED-O EXIT condition.`,
      );
    }
  }
  // Check 3 — DIY WebView wrap of Stripe Embedded Components.
  for (const { rel, content } of fileEntries) {
    if (CHECK3_WEBVIEW.test(content) && CHECK3_STRIPE.test(content)) {
      failures.push(
        `Check 3 FAIL (${rel}): DIY WebView wrap of Stripe Embedded Components is FORBIDDEN. Use Path B (expo-web-browser) instead. I-PROPOSED-O.`,
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────── self-test
if (process.argv.includes("--self-test")) {
  const self = [];
  const run = (entries) => {
    const f = [];
    check(entries, f);
    return f;
  };

  // GOOD: a clean src/ file (no Web JS SDK, no Path A marker, no WebView wrap).
  let f = run([
    {
      rel: "mingla-business/src/components/PaymentsView.tsx",
      content: 'import React from "react";\nexport const X = () => null;\n',
    },
  ]);
  if (f.length) self.push("GOOD (clean src file) wrongly flagged");

  // SPECIFICITY: a .web.tsx file under src/ MAY carry the Web JS SDK (web-only
  // bundle, ORCH-1083 exemption) → Check 1 must stay silent.
  f = run([
    {
      rel: "mingla-business/src/components/stripe/connect-pages/OnboardBody.web.tsx",
      content: 'import { loadConnectAndInitialize } from "@stripe/connect-js";\n',
    },
  ]);
  if (f.length) self.push(".web.tsx Web JS import (ORCH-1083 exemption) wrongly flagged");

  // SPECIFICITY: a Mingla-hosted page under app/ MAY carry the Web JS SDK (Path B).
  f = run([
    {
      rel: "mingla-business/app/connect-onboarding.tsx",
      content: 'import { loadConnectAndInitialize } from "@stripe/connect-js";\n',
    },
  ]);
  if (f.length) self.push("app/ Path-B Web JS import wrongly flagged");

  // BAD1 (revert-style): @stripe/react-connect-js imported in native src/ → Check 1.
  f = run([
    {
      rel: "mingla-business/src/screens/ConnectOnboard.tsx",
      content: 'import { ConnectComponentsProvider } from "@stripe/react-connect-js";\n',
    },
  ]);
  if (f.length === 0) self.push("BAD1 (react-connect-js in src/) not flagged");

  // BAD2 (regression, different angle): @stripe/connect-js imported in native src/.
  f = run([
    {
      rel: "mingla-business/src/screens/ConnectOnboard2.tsx",
      content: 'import { loadConnectAndInitialize } from "@stripe/connect-js";\n',
    },
  ]);
  if (f.length === 0) self.push("BAD2 (connect-js in src/) not flagged");

  if (self.length) {
    console.error("ORCH-0802 self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("ORCH-0802 self-test PASS (5/5 cases).");
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────── main path
const failures = [];

let scanned = 0;
const fileEntries = [];
try {
  for (const file of walk(BUSINESS_ROOT)) {
    fileEntries.push({
      rel: relative(REPO_ROOT, file),
      content: readOrEmpty(file),
    });
    scanned += 1;
  }
} catch (err) {
  failures.push(`Walk FAIL: cannot scan mingla-business/: ${err.message}`);
}

check(fileEntries, failures);

if (failures.length > 0) {
  console.error("ORCH-0802 strict-grep FAIL:");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}

console.log(
  `ORCH-0802 strict-grep PASS — 3/3 checks (scanned ${scanned} files).`,
);
