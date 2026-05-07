#!/usr/bin/env node
/**
 * I-PROPOSED-R strict-grep gate — Idempotency-Key on every Stripe API call.
 *
 * Gate logic:
 *   For every .ts file in supabase/functions/:
 *     For each `stripe.<resource>.<method>(` call site, look at the immediate call
 *     arguments (within ~10 lines) for an `idempotencyKey:` property.
 *     If absent → VIOLATION (exit 1)
 *     Unless allowlist comment within 5 lines above the call:
 *       // orch-strict-grep-allow stripe-no-idempotency-key — <reason>
 *
 * Per B2a Path C SPEC §5 + INVARIANT_REGISTRY I-PROPOSED-R (post-DEC-121).
 *
 * RATIONALE:
 *   Stripe uses Idempotency-Key as a server-side dedup token for safe retry. A
 *   dropped HTTPS connection mid-create can leave the caller unsure whether the
 *   account was created or not. With an idempotency key, retrying the same call
 *   returns the cached response instead of creating a duplicate.
 *
 *   Without idempotency keys, concurrent calls (mobile + cron + webhook all
 *   triggering at once) can produce duplicate Stripe Connect accounts, duplicate
 *   payout records, or orphaned API calls. Cleanup is operationally painful
 *   (Stripe doesn't expose an API to delete a Connect account; you have to
 *   manually contact support).
 *
 *   Format pinned by `_shared/idempotency.ts`: `{brand_id}:{operation}:{epoch_ms}`.
 *
 *   Taofeek's branch had ZERO idempotency keys across 6 Stripe edge functions —
 *   the gate-fix incident that motivated this invariant.
 *
 * DETECTION:
 *   - `stripe.accounts.create(`, `stripe.accounts.del(`, `stripe.accounts.retrieve(`
 *   - `stripe.balance.retrieve(`
 *   - `stripe.accountSessions.create(`
 *   - `stripe.payouts.*(`, `stripe.transfers.*(`, `stripe.applicationFees.*(`
 *   - `stripe.webhooks.constructEventAsync(` is EXEMPT — it's local signature
 *     verification, not a Stripe API call.
 *
 * EXEMPTIONS:
 *   - `_shared/stripe.ts` (no Stripe API calls — just client construction)
 *   - `_shared/idempotency.ts` itself (defines the key generator)
 *   - Test files (`*.test.ts`)
 *   - Files using the allowlist tag
 *
 * Exit codes:
 *   0 — no violations (clean)
 *   1 — at least one violation
 *   2 — script error
 *
 * Established by: B2a Path C SPEC + DEC-121 [confirmed at CLOSE].
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..", "..");

const SCAN_DIRS = [join(REPO_ROOT, "supabase", "functions")];

const ALLOWLIST_TAG = "orch-strict-grep-allow stripe-no-idempotency-key";

// Match call sites of the form `stripe.<resource>.<method>(` where method is one
// of the Stripe SDK action names that hit the API. Excludes `webhooks` namespace
// since those are local helpers.
const STRIPE_API_CALL_REGEX =
  /\bstripe\.(?!webhooks\b)([a-zA-Z]+)\.([a-zA-Z]+)\s*\(/;

// idempotencyKey property within call args
const IDEMPOTENCY_KEY_REGEX = /\bidempotencyKey\s*:/;

const EXEMPT_FILE_PATTERNS = [
  /\/_shared\/stripe\.ts$/,
  /\/_shared\/idempotency\.ts$/,
  /\.test\.ts$/,
  /\/__tests__\//,
];

let violations = 0;
let filesScanned = 0;
let readFailures = 0;

function isExemptFile(filePath) {
  return EXEMPT_FILE_PATTERNS.some((p) => p.test(filePath));
}

function* walkTs(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === ".git") continue;
      yield* walkTs(full);
    } else if (st.isFile() && entry.endsWith(".ts")) {
      yield full;
    }
  }
}

function reportViolation(filePath, lineNumber, callText, methodName) {
  const rel = relative(REPO_ROOT, filePath).split(sep).join("/");
  console.error(`ERROR: I-PROPOSED-R violation in ${rel}:${lineNumber}`);
  console.error(`  ${callText.trim()}`);
  console.error(
    `  Stripe API call missing idempotencyKey. Method: stripe.${methodName}`,
  );
  console.error(
    `  Use generateIdempotencyKey from _shared/idempotency.ts; format {brand_id}:{op}:{epoch_ms}.`,
  );
  console.error(
    `  Allowlist (rare): // orch-strict-grep-allow stripe-no-idempotency-key — <reason>`,
  );
  console.error(
    `  See: Mingla_Artifacts/INVARIANT_REGISTRY.md I-PROPOSED-R`,
  );
  console.error("");
  violations += 1;
}

function scanFile(filePath) {
  filesScanned += 1;
  if (isExemptFile(filePath)) return;

  let source;
  try {
    source = readFileSync(filePath, "utf8");
  } catch (err) {
    const rel = relative(REPO_ROOT, filePath).split(sep).join("/");
    console.error(`READ-FAIL: ${rel} — ${err.message}`);
    readFailures += 1;
    return;
  }

  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(STRIPE_API_CALL_REGEX);
    if (!m) continue;

    const methodName = `${m[1]}.${m[2]}`;

    // Skip type-only or comment lines
    const trimmed = line.trim();
    if (
      trimmed.startsWith("//") ||
      trimmed.startsWith("*") ||
      trimmed.startsWith("import ") ||
      trimmed.startsWith("export type ")
    ) {
      continue;
    }

    // Allowlist within 5 lines above
    const allowStart = Math.max(0, i - 5);
    const allowContext = lines.slice(allowStart, i).join("\n");
    if (allowContext.includes(ALLOWLIST_TAG)) continue;

    // Look at the call's arguments — span up to ~40 lines for verbose Stripe v2
    // controller-property objects (e.g., stripe.accounts.create with controller +
    // capabilities + metadata can hit ~25 lines in the first arg before the second
    // arg with idempotencyKey appears).
    const callEnd = Math.min(lines.length, i + 40);
    const callContext = lines.slice(i, callEnd).join("\n");

    if (IDEMPOTENCY_KEY_REGEX.test(callContext)) continue;

    reportViolation(filePath, i + 1, line, methodName);
  }
}

try {
  for (const dir of SCAN_DIRS) {
    for (const file of walkTs(dir)) {
      scanFile(file);
    }
  }
} catch (err) {
  console.error(`SCRIPT ERROR: ${err.message}`);
  process.exit(2);
}

console.error("");
console.error(
  `I-PROPOSED-R gate: scanned ${filesScanned} .ts files · ${violations} violations · ${readFailures} read failures`,
);

if (readFailures > 0 && filesScanned === readFailures) {
  process.exit(2);
}
if (violations > 0) {
  process.exit(1);
}
process.exit(0);
