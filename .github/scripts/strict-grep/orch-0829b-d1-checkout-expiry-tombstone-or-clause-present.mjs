#!/usr/bin/env node
/**
 * ORCH-0829-B D-1 strict-grep gate — the latest migration that defines
 * `public.biz_ticket_checkout_create_session` MUST include the
 * past-expiry tombstone-eligibility OR clause, AND MUST transition
 * tombstoned non-terminal rows to status='expired'.
 *
 * I-PROPOSED-CHECKOUT-EXPIRY-TOMBSTONE (DRAFT — flips to ACTIVE on
 * ORCH-0829-B CLOSE).
 *
 * Gate logic:
 *   Scan supabase/migrations/*.sql for files that contain
 *   `CREATE OR REPLACE FUNCTION public.biz_ticket_checkout_create_session`.
 *   The LATEST such file (by lexical sort of filename — the project's
 *   monotonic-timestamp prefix guarantees lexical sort = chronological)
 *   is the authoritative current definition. That file's body MUST:
 *     (1) contain `OR v_existing.expires_at < now()` in the
 *         tombstone-eligibility predicate;
 *     (2) contain a `CASE` expression that preserves terminal statuses
 *         and writes `'expired'` for non-terminal rows in the tombstone
 *         UPDATE.
 *
 *   If the latest RPC migration is missing EITHER, fail — this prevents
 *   a future migration from silently regressing the D-1 fix while still
 *   replacing the function.
 *
 * Exit codes:
 *   0 — gate passes
 *   1 — gate fails (one or both contracts missing in the latest definition)
 *   2 — script error (no matching migration found, repo structure broken)
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..", "..");
const MIGRATIONS_DIR = join(REPO_ROOT, "supabase", "migrations");
const RPC_SIGNATURE =
  "CREATE OR REPLACE FUNCTION public.biz_ticket_checkout_create_session";

function findLatestRpcMigration() {
  let files;
  try {
    files = readdirSync(MIGRATIONS_DIR);
  } catch (err) {
    console.error(`[orch-0829b-d1] cannot read ${MIGRATIONS_DIR}: ${err.message}`);
    process.exit(2);
  }
  const candidates = [];
  for (const name of files) {
    if (!name.endsWith(".sql")) continue;
    const body = readFileSync(join(MIGRATIONS_DIR, name), "utf8");
    if (body.includes(RPC_SIGNATURE)) {
      candidates.push({ name, body });
    }
  }
  if (candidates.length === 0) {
    console.error(
      `[orch-0829b-d1] FATAL: no migration defines ${RPC_SIGNATURE} — repo structure broken.`,
    );
    process.exit(2);
  }
  candidates.sort((a, b) => (a.name < b.name ? -1 : 1));
  return candidates[candidates.length - 1];
}

const latest = findLatestRpcMigration();
const violations = [];

if (!/OR\s+v_existing\.expires_at\s*<\s*now\s*\(\s*\)/.test(latest.body)) {
  violations.push(
    "missing tombstone-expiry OR clause `OR v_existing.expires_at < now()` in the IF FOUND THEN branch",
  );
}

const hasStatusCase =
  /status\s*=\s*CASE/i.test(latest.body) &&
  /WHEN\s+status\s+IN\s*\(\s*'paid_completed'\s*,\s*'free_completed'\s*,\s*'failed'\s*,\s*'expired'\s*\)\s+THEN\s+status/i.test(
    latest.body,
  ) &&
  /ELSE\s+'expired'/i.test(latest.body);

if (!hasStatusCase) {
  violations.push(
    "missing CASE expression that preserves terminal statuses and writes 'expired' for non-terminal rows in the tombstone UPDATE",
  );
}

if (violations.length === 0) {
  console.log(
    `[orch-0829b-d1] PASS — ${latest.name} contains both contracts (expires_at OR clause + status='expired' CASE).`,
  );
  process.exit(0);
}

console.error(
  `[orch-0829b-d1] FAIL — latest RPC migration ${latest.name} violates I-PROPOSED-CHECKOUT-EXPIRY-TOMBSTONE:`,
);
for (const v of violations) {
  console.error(`  - ${v}`);
}
console.error(
  `\nFix: add the missing predicate/expression to the latest CREATE OR REPLACE FUNCTION migration. See SPEC_ORCH-0829-B_D1_CHECKOUT_EXPIRY_TOMBSTONE.md §3.1 for the canonical body.`,
);
process.exit(1);
