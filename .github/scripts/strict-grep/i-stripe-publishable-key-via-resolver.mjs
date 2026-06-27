#!/usr/bin/env node
/**
 * ORCH-1238 [Route Stripe publishable key through the mode-validated resolver
 * + CI guard] — strict-grep gate.
 *
 * Enforces ONE invariant:
 *
 *   I-STRIPE-PUBLISHABLE-KEY-VIA-RESOLVER — no edge function under
 *     supabase/functions/ may read the raw Stripe publishable-key env
 *     (`Deno.env.get("EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY")` or
 *     `Deno.env.get("STRIPE_PUBLISHABLE_KEY")`) directly. The single owner of
 *     that read is `_shared/stripeMode.ts::resolvePublishableKey()`, which
 *     validates the key prefix against MINGLA_STRIPE_MODE and THROWS on
 *     mismatch. The two checkout edge fns that return a publishable key to the
 *     mobile app — ticket-checkout-create + venue-reservation-create — MUST
 *     call `resolvePublishableKey`.
 *
 * Background: on 2026-06-22 the Stripe mode was flipped test→live but the
 * EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY secret was left a pk_test_ key. Those two
 * edge fns returned it DIRECTLY (bypassing the mode-validated resolver), so the
 * mobile Stripe SDK got a live PaymentIntent + a test publishable key →
 * "There was an unexpected error" and zero working live checkouts. This gate
 * makes the silent raw read impossible to reintroduce.
 *
 * Comments are stripped before scanning so header references can remain.
 *
 * Usage:
 *   node i-stripe-publishable-key-via-resolver.mjs            # run the gate
 *   node i-stripe-publishable-key-via-resolver.mjs --self-test # prove detector
 *
 * Exit codes:
 *   0 — clean / self-test passed
 *   1 — violation / self-test failed
 *
 * Per ORCH-1238.
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "..", "..", "..");

const FUNCTIONS_DIR = join(ROOT, "supabase", "functions");

// The sole sanctioned reader of the raw publishable-key env.
const RESOLVER_REL = "supabase/functions/_shared/stripeMode.ts";

// Files that MUST route through resolvePublishableKey (they return a pk to the
// mobile app on requires_payment).
const REQUIRED_CALLER_FILES = [
  "supabase/functions/ticket-checkout-create/index.ts",
  "supabase/functions/venue-reservation-create/index.ts",
];

const RAW_READ_PATTERNS = [
  /Deno\.env\.get\(\s*["'`]EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY["'`]\s*\)/,
  /Deno\.env\.get\(\s*["'`]STRIPE_PUBLISHABLE_KEY["'`]\s*\)/,
];

const REQUIRED_CALLER_IDENTIFIER = /\bresolvePublishableKey\b/;

const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

// Recursively collect .ts files under a directory.
function collectTsFiles(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      out.push(...collectTsFiles(abs));
    } else if (st.isFile() && abs.endsWith(".ts")) {
      out.push(abs);
    }
  }
  return out;
}

// Pure detector — operates on raw source text. Returns a list of violation
// messages for a single file (given its rel path). Used by both the gate and
// the self-test so the test exercises the EXACT production logic.
function detectRawReads(rel, raw) {
  const out = [];
  // The resolver itself is the one place allowed to read the raw env.
  if (rel === RESOLVER_REL) return out;
  const stripped = stripComments(raw);
  for (const pattern of RAW_READ_PATTERNS) {
    if (pattern.test(stripped)) {
      out.push(
        `Direct raw publishable-key env read (${pattern}). Route through ` +
          `resolvePublishableKey() in ${RESOLVER_REL} per ` +
          `I-STRIPE-PUBLISHABLE-KEY-VIA-RESOLVER.`,
      );
    }
  }
  return out;
}

function runSelfTest() {
  let failures = 0;
  const assert = (cond, label) => {
    if (!cond) {
      console.error(`  ✗ ${label}`);
      failures += 1;
    } else {
      console.log(`  ✓ ${label}`);
    }
  };

  console.log("[ORCH-1238 — i-stripe-publishable-key-via-resolver] SELF-TEST\n");

  // FAILING fixture: an arbitrary edge fn that reads the raw env directly.
  const badExpo = `serve(async () => {
    const pk = Deno.env.get("EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY");
    return new Response(pk);
  });`;
  assert(
    detectRawReads("supabase/functions/some-fn/index.ts", badExpo).length === 1,
    "detects raw EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY read in a non-resolver file",
  );

  const badBare = `const pk = Deno.env.get("STRIPE_PUBLISHABLE_KEY") ?? null;`;
  assert(
    detectRawReads("supabase/functions/other-fn/index.ts", badBare).length === 1,
    "detects raw STRIPE_PUBLISHABLE_KEY read in a non-resolver file",
  );

  // PASSING fixture: routes through the resolver — no raw read.
  const good = `import { resolvePublishableKey } from "../_shared/stripeMode.ts";
    return jsonResponse({ publishableKey: resolvePublishableKey() });`;
  assert(
    detectRawReads("supabase/functions/some-fn/index.ts", good).length === 0,
    "passes a file that routes through resolvePublishableKey()",
  );

  // The resolver file itself is exempt — its raw reads are the sanctioned ones.
  const resolverSrc = `const value = Deno.env.get("EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY")
    ?? Deno.env.get("STRIPE_PUBLISHABLE_KEY");`;
  assert(
    detectRawReads(RESOLVER_REL, resolverSrc).length === 0,
    "exempts the resolver file (_shared/stripeMode.ts) from the raw-read ban",
  );

  // Comment-stripping: a header comment mentioning the env is NOT a violation.
  const commented = `// historical: Deno.env.get("EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY")
    return jsonResponse({ publishableKey: resolvePublishableKey() });`;
  assert(
    detectRawReads("supabase/functions/some-fn/index.ts", commented).length === 0,
    "comment-stripping: a commented raw read is not a violation",
  );

  // Required-caller detector behaves.
  assert(
    REQUIRED_CALLER_IDENTIFIER.test(stripComments(good)),
    "required-caller detector matches resolvePublishableKey call",
  );
  assert(
    !REQUIRED_CALLER_IDENTIFIER.test(stripComments(badExpo)),
    "required-caller detector does not falsely match a raw-read file",
  );

  console.log("");
  if (failures > 0) {
    console.error(
      `[ORCH-1238 — i-stripe-publishable-key-via-resolver] SELF-TEST FAILED (${failures})`,
    );
    process.exit(1);
  }
  console.log(
    "[ORCH-1238 — i-stripe-publishable-key-via-resolver] SELF-TEST PASS",
  );
  process.exit(0);
}

if (process.argv.includes("--self-test")) {
  runSelfTest();
}

const violations = [];

// 1. No raw publishable-key env read anywhere under supabase/functions/
//    EXCEPT the resolver.
for (const abs of collectTsFiles(FUNCTIONS_DIR)) {
  const rel = relative(ROOT, abs).split("\\").join("/");
  const raw = readFileSync(abs, "utf8");
  for (const msg of detectRawReads(rel, raw)) {
    violations.push({ file: rel, msg });
  }
}

// 2. The two pk-returning checkout fns MUST call resolvePublishableKey.
for (const rel of REQUIRED_CALLER_FILES) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) {
    violations.push({
      file: rel,
      msg: "Required caller file missing — ORCH-1238 expects this edge fn present.",
    });
    continue;
  }
  const stripped = stripComments(readFileSync(abs, "utf8"));
  if (!REQUIRED_CALLER_IDENTIFIER.test(stripped)) {
    violations.push({
      file: rel,
      msg: "Must call `resolvePublishableKey()` (mode-validated resolver) per I-STRIPE-PUBLISHABLE-KEY-VIA-RESOLVER.",
    });
  }
}

if (violations.length > 0) {
  console.error(
    "\n[ORCH-1238 — i-stripe-publishable-key-via-resolver] VIOLATIONS:\n",
  );
  for (const v of violations) {
    console.error(`  • ${v.file}\n    ${v.msg}\n`);
  }
  console.error(
    "Per ORCH-1238 — the Stripe publishable key must flow through the " +
      "mode-validated resolvePublishableKey() in _shared/stripeMode.ts, which " +
      "throws on a prefix that mismatches MINGLA_STRIPE_MODE. Raw env reads " +
      "let a pk_test_ key leak into live mode (the 2026-06-22 outage).",
  );
  process.exit(1);
}

console.log(
  "[ORCH-1238 — i-stripe-publishable-key-via-resolver] PASS — no raw " +
    "publishable-key env reads outside the resolver; both checkout fns route " +
    "through resolvePublishableKey().",
);
process.exit(0);
