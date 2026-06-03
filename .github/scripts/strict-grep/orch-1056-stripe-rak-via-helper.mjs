#!/usr/bin/env node
/**
 * ORCH-1056 strict-grep gate — STRIPE_RAK_* env reads via helper only.
 *
 * Production rule: outside `supabase/functions/_shared/stripeMode.ts`,
 * `supabase/functions/_shared/stripe.ts`, and
 * `supabase/functions/_shared/stripeBlueprintClient.ts`, no code under
 * `supabase/functions/` may call `Deno.env.get("STRIPE_RAK_…")` directly.
 * Every key must flow through `resolveStripeKey(role)` so it picks up the
 * mode-suffixed env vars (`STRIPE_RAK_{ROLE}_{TEST|LIVE}`) and the
 * prefix-mismatch fail-close. Tests + the legacy blueprint contract test
 * suite are exempt.
 *
 * Failure mode this gate prevents: the 2026-06-02 incident where Vercel
 * had pk_live_ but Supabase had rk_test_ — Stripe Connect embedded iframe
 * silently collapsed to 1px. The mode helper would have caught that at
 * key resolution time.
 *
 * Self-test: pass `--self-test` to exercise the inclusion/exclusion logic.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "supabase/functions";
const EXEMPT_FILES = new Set([
  "supabase/functions/_shared/stripeMode.ts",
  "supabase/functions/_shared/stripe.ts",
  "supabase/functions/_shared/stripeBlueprintClient.ts",
]);
const EXEMPT_DIR_SUBSTRINGS = ["/__tests__/"];

function shouldScanFile(path) {
  if (!path.endsWith(".ts")) return false;
  if (EXEMPT_FILES.has(path)) return false;
  for (const sub of EXEMPT_DIR_SUBSTRINGS) {
    if (path.includes(sub)) return false;
  }
  return true;
}

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walk(full, out);
    } else {
      out.push(full);
    }
  }
}

const PATTERN = /Deno\.env\.get\(\s*["']STRIPE_RAK_[A-Z_]+["']\s*\)/g;

function findViolations() {
  const files = [];
  walk(ROOT, files);
  const violations = [];
  for (const file of files) {
    if (!shouldScanFile(file)) continue;
    let src;
    try {
      src = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const matches = src.match(PATTERN);
    if (matches && matches.length > 0) {
      violations.push({ file, matches });
    }
  }
  return violations;
}

if (process.argv.includes("--self-test")) {
  // Mock self-test: confirm scanner discrimination logic.
  const cases = [
    ["supabase/functions/_shared/stripeMode.ts", false],
    ["supabase/functions/_shared/stripe.ts", false],
    ["supabase/functions/_shared/stripeBlueprintClient.ts", false],
    ["supabase/functions/_shared/__tests__/stripeMode.test.ts", false],
    ["supabase/functions/brand-stripe-onboard/index.ts", true],
  ];
  for (const [path, expected] of cases) {
    const actual = shouldScanFile(path);
    if (actual !== expected) {
      console.error(
        `ORCH-1056 strict-grep self-test FAILED: ${path} expected ${expected}, got ${actual}`,
      );
      process.exit(1);
    }
  }
  console.log("ORCH-1056 STRIPE_RAK-via-helper strict-grep self-test PASS.");
  process.exit(0);
}

const violations = findViolations();
if (violations.length > 0) {
  console.error(
    "ORCH-1056 strict-grep FAILED: STRIPE_RAK_* must be resolved via _shared/stripeMode.ts (resolveStripeKey).",
  );
  for (const v of violations) {
    console.error(`  ${v.file} — ${v.matches.length} direct env read(s)`);
    for (const m of v.matches) console.error(`    ${m}`);
  }
  process.exit(1);
}

console.log(
  "ORCH-1056 STRIPE_RAK-via-helper strict-grep PASS — no direct Deno.env.get(STRIPE_RAK_*) outside _shared/stripeMode|stripe|stripeBlueprintClient.ts.",
);
