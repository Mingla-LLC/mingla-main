#!/usr/bin/env node
/**
 * I-PROPOSED-S strict-grep gate — Audit log on every Stripe edge function.
 *
 * Gate logic:
 *   For every `index.ts` in supabase/functions/{brand-stripe-*,stripe-*}/:
 *     File MUST import `writeAudit` from `../_shared/audit.ts`
 *     File MUST call `writeAudit(` at least once
 *     If either is missing → VIOLATION (exit 1)
 *     Allowlist (file-level): // orch-strict-grep-allow stripe-fn-no-audit — <reason>
 *
 * Per B2a Path C SPEC §5 + INVARIANT_REGISTRY I-PROPOSED-S (post-DEC-121).
 *
 * RATIONALE:
 *   Stripe Connect actions touch real money + real legal records. Every state
 *   transition (account create, status update, balance read, detach, KYC reminder)
 *   needs a tamper-evident audit trail for Constitutional #3 compliance, dispute
 *   investigation, and operator forensics.
 *
 *   The audit_log table has trg_audit_log_block_update preventing UPDATE/DELETE
 *   except by service-role. Edge functions running with service-role can INSERT
 *   freely via writeAudit().
 *
 *   Without this gate, an engineer could ship a new `brand-stripe-foo/index.ts`
 *   that performs Stripe mutations without a single audit row — silent action
 *   would be invisible to operators.
 *
 *   Taofeek's branch had ZERO audit log writes across 6 Stripe edge functions —
 *   the gate-fix incident that motivated this invariant.
 *
 * SCAN PATTERN:
 *   Match directory names of the form `brand-stripe-*` or `stripe-*` under
 *   supabase/functions/. Inside each, the canonical entry is `index.ts`.
 *
 * EXEMPTIONS:
 *   - Files using the allowlist tag
 *
 * Exit codes:
 *   0 — no violations (clean)
 *   1 — at least one violation
 *   2 — script error
 *
 * Established by: B2a Path C SPEC + DEC-121 [confirmed at CLOSE].
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..", "..");

const FUNCTIONS_DIR = join(REPO_ROOT, "supabase", "functions");

const ALLOWLIST_TAG = "orch-strict-grep-allow stripe-fn-no-audit";

const STRIPE_FN_DIR_REGEX = /^(brand-stripe-|stripe-)/;

const WRITE_AUDIT_IMPORT_REGEX =
  /import\s+\{[^}]*\bwriteAudit\b[^}]*\}\s+from\s+["'][^"']*\/audit(?:\.ts)?["']/;
const WRITE_AUDIT_CALL_REGEX = /\bwriteAudit\s*\(/;

let violations = 0;
let filesScanned = 0;
let readFailures = 0;

function listStripeFnDirs() {
  let entries;
  try {
    entries = readdirSync(FUNCTIONS_DIR);
  } catch {
    return [];
  }
  return entries.filter((entry) => {
    if (!STRIPE_FN_DIR_REGEX.test(entry)) return false;
    const full = join(FUNCTIONS_DIR, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      return false;
    }
    return st.isDirectory();
  });
}

function reportViolation(filePath, problem) {
  const rel = relative(REPO_ROOT, filePath).split(sep).join("/");
  console.error(`ERROR: I-PROPOSED-S violation in ${rel}`);
  console.error(`  ${problem}`);
  console.error(
    `  Stripe edge functions MUST audit-log every invocation (success + error).`,
  );
  console.error(
    `  Import: import { writeAudit } from "../_shared/audit.ts";`,
  );
  console.error(
    `  Call (example): await writeAudit(supabase, { user_id, brand_id, action: "stripe_connect.X", target_type: "stripe_connect_account", target_id });`,
  );
  console.error(
    `  Allowlist (file-level, rare): // orch-strict-grep-allow stripe-fn-no-audit — <reason>`,
  );
  console.error(
    `  See: Mingla_Artifacts/INVARIANT_REGISTRY.md I-PROPOSED-S`,
  );
  console.error("");
  violations += 1;
}

function scanFunctionDir(dirName) {
  const indexPath = join(FUNCTIONS_DIR, dirName, "index.ts");
  if (!existsSync(indexPath)) {
    // Some Stripe-named dirs may not have index.ts (e.g., a dir nuked by a phase 9
    // cleanup). Skip silently — gate is concerned with shipped code, not absence.
    return;
  }

  filesScanned += 1;

  let source;
  try {
    source = readFileSync(indexPath, "utf8");
  } catch (err) {
    const rel = relative(REPO_ROOT, indexPath).split(sep).join("/");
    console.error(`READ-FAIL: ${rel} — ${err.message}`);
    readFailures += 1;
    return;
  }

  if (source.includes(ALLOWLIST_TAG)) return;

  const hasImport = WRITE_AUDIT_IMPORT_REGEX.test(source);
  const hasCall = WRITE_AUDIT_CALL_REGEX.test(source);

  if (!hasImport) {
    reportViolation(indexPath, "Missing import of writeAudit from _shared/audit.ts");
  }
  if (!hasCall) {
    reportViolation(indexPath, "No call to writeAudit(...) found in this file");
  }
}

try {
  const stripeFnDirs = listStripeFnDirs();
  for (const dir of stripeFnDirs) {
    scanFunctionDir(dir);
  }
} catch (err) {
  console.error(`SCRIPT ERROR: ${err.message}`);
  process.exit(2);
}

console.error("");
console.error(
  `I-PROPOSED-S gate: scanned ${filesScanned} Stripe-fn index.ts files · ${violations} violations · ${readFailures} read failures`,
);

if (readFailures > 0 && filesScanned === readFailures) {
  process.exit(2);
}
if (violations > 0) {
  process.exit(1);
}
process.exit(0);
