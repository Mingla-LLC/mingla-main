#!/usr/bin/env node
/**
 * I-PROPOSED-U strict-grep gate — Mingla ToS accepted before any Stripe Connect call.
 *
 * Status: DRAFT — flips ACTIVE on B2a Path C V3 CLOSE.
 *
 * Gate logic:
 *   For every supabase/functions/{brand-stripe-*,stripe-*}/index.ts:
 *     For each Stripe state-creating API call (e.g., stripe.accounts.create,
 *     stripe.accountSessions.create), verify the same file contains a token
 *     referencing `mingla_tos_accepted_at` (or `tos_accepted_at` in a
 *     brand_team_members context, or `biz_can_manage_payments_for_brand` RPC
 *     which encapsulates the gate) BEFORE the line of the Stripe call.
 *     Allowlist tag exemption: `// orch-strict-grep-allow stripe-no-tos-gate — <reason>`
 *     within 5 lines above the call.
 *
 * Per B2a Path C V3 SPEC §3 + INVARIANT_REGISTRY I-PROPOSED-U (post-DEC-121).
 *
 * RATIONALE:
 *   Stripe's Connect Platform Agreement requires platforms to surface specific T&Cs
 *   to connected accounts. Stripe's own ToS is captured automatically by Embedded
 *   Components onboarding, but Mingla's separate platform-level ToS (covering
 *   Mingla-specific terms, fee disclosures, dispute responsibility, data handling
 *   under marketplace charge model per DEC-114) must be acknowledged separately.
 *   This gate enforces that acknowledgment is checked structurally, not merely a
 *   UI convention.
 *
 * DETECTION:
 *   State-creating Stripe call patterns:
 *     - `stripe.accounts.create(`
 *     - `stripe.accountSessions.create(`
 *     - `stripeOnboard().accounts.create(`
 *     - `stripeOnboard().accountSessions.create(`
 *     - any factory variant `stripe<X>().accounts.create(`
 *
 *   Acceptable gate tokens (line-scan looking for ANY of these BEFORE the call):
 *     - `mingla_tos_accepted_at`
 *     - `tos_accepted_at` (with brand_team_members context — heuristic: same file
 *       references brand_team_members)
 *     - `biz_can_manage_payments_for_brand` (RPC that includes ToS check)
 *
 * EXEMPTIONS:
 *   - `_shared/` files (no edge-fn entry points — wrappers, not Stripe-call sites)
 *   - Read-only Stripe ops (stripe.balance.retrieve, stripe.accounts.retrieve)
 *     are NOT scanned — only state-creating ops trigger the gate
 *   - Test files
 *   - Files using the allowlist tag (5-line lookback)
 *
 * Exit codes:
 *   0 — no violations
 *   1 — at least one violation
 *   2 — script error
 *
 * Established by: B2a Path C V3 SPEC + DEC-121 [confirmed at CLOSE].
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..", "..");

const SCAN_DIR = join(REPO_ROOT, "supabase", "functions");

const ALLOWLIST_TAG = "orch-strict-grep-allow stripe-no-tos-gate";

// Match state-creating Stripe API calls: any `<stripe-client>.<resource>.<method>(`
// where the resource is `accounts` or `accountSessions` and the method is `create`.
// This catches both direct `stripe.accounts.create(` and factory `stripeOnboard().accounts.create(`.
const STRIPE_STATE_CREATE_REGEX =
  /\b(?:stripe|stripe\w*\(\))\.(accounts|accountSessions)\.create\s*\(/;

// Acceptable gate tokens (any of these found BEFORE the call line satisfies the gate)
const TOS_GATE_TOKENS = [
  "mingla_tos_accepted_at",
  "biz_can_manage_payments_for_brand",
];

// Function entry points that this gate scans (only edge fn index.ts files
// matching brand-stripe-* or stripe-* — never _shared/)
function isStripeEdgeFnEntry(filePath) {
  const rel = relative(REPO_ROOT, filePath).split(sep).join("/");
  // Must be: supabase/functions/(brand-stripe-*|stripe-*)/index.ts
  if (!rel.startsWith("supabase/functions/")) return false;
  if (!rel.endsWith("/index.ts")) return false;
  const fnName = rel
    .slice("supabase/functions/".length)
    .split("/")[0];
  if (!fnName.startsWith("brand-stripe-") && !fnName.startsWith("stripe-")) {
    return false;
  }
  return true;
}

let violations = 0;
let filesScanned = 0;
let readFailures = 0;

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

function reportViolation(filePath, lineNumber, lineText) {
  const rel = relative(REPO_ROOT, filePath).split(sep).join("/");
  console.error(`ERROR: I-PROPOSED-U violation in ${rel}:${lineNumber}`);
  console.error(`  ${lineText.trim()}`);
  console.error(
    `  State-creating Stripe call without preceding Mingla ToS check.`,
  );
  console.error(
    `  Add a SELECT/RPC referencing brand_team_members.mingla_tos_accepted_at,`,
  );
  console.error(
    `  or call the biz_can_manage_payments_for_brand RPC, BEFORE this line.`,
  );
  console.error(
    `  If the call is gated upstream by a wrapper, add the allowlist tag:`,
  );
  console.error(
    `    // orch-strict-grep-allow stripe-no-tos-gate — <reason>`,
  );
  console.error(
    `  See: Mingla_Artifacts/INVARIANT_REGISTRY.md I-PROPOSED-U`,
  );
  console.error("");
  violations += 1;
}

function scanFile(filePath) {
  filesScanned += 1;
  if (!isStripeEdgeFnEntry(filePath)) return;

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
    if (!STRIPE_STATE_CREATE_REGEX.test(line)) continue;

    // Skip type-only / comment / import lines
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

    // Look for any acceptable ToS gate token in the lines BEFORE this call
    // (lines 0..i-1, not necessarily within a small window — gate may live
    // earlier in the request handler).
    const before = lines.slice(0, i).join("\n");
    const hasGate = TOS_GATE_TOKENS.some((tok) => before.includes(tok));
    if (hasGate) continue;

    reportViolation(filePath, i + 1, line);
  }
}

try {
  for (const file of walkTs(SCAN_DIR)) {
    scanFile(file);
  }
} catch (err) {
  console.error(`SCRIPT ERROR: ${err.message}`);
  process.exit(2);
}

console.error("");
console.error(
  `I-PROPOSED-U gate: scanned ${filesScanned} .ts files · ${violations} violations · ${readFailures} read failures`,
);

if (readFailures > 0 && filesScanned === readFailures) {
  process.exit(2);
}
if (violations > 0) {
  process.exit(1);
}
process.exit(0);
