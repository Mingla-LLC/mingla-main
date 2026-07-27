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
 *
 * `--self-test` proves fail-on-revert (mirrors i-1272-identity-admin-read.mjs):
 * the pure `check(body, failures)` is exercised with a GOOD fixture
 * (specificity) and ≥2 DISTINCT BAD fixtures (sensitivity). The disk-reading
 * main path selects the latest migration and calls the SAME `check(...)`; the
 * refactor is behavior-preserving (identical verdict on the real tree).
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

/** Pure verdict over a single migration body. */
function check(body, violations) {
  if (!/OR\s+v_existing\.expires_at\s*<\s*now\s*\(\s*\)/.test(body)) {
    violations.push(
      "missing tombstone-expiry OR clause `OR v_existing.expires_at < now()` in the IF FOUND THEN branch",
    );
  }

  const hasStatusCase =
    /status\s*=\s*CASE/i.test(body) &&
    /WHEN\s+status\s+IN\s*\(\s*'paid_completed'\s*,\s*'free_completed'\s*,\s*'failed'\s*,\s*'expired'\s*\)\s+THEN\s+status/i.test(
      body,
    ) &&
    /ELSE\s+'expired'/i.test(body);

  if (!hasStatusCase) {
    violations.push(
      "missing CASE expression that preserves terminal statuses and writes 'expired' for non-terminal rows in the tombstone UPDATE",
    );
  }
}

// ─────────────────────────────────────────────────────────────── self-test
if (process.argv.includes("--self-test")) {
  const self = [];

  const goodBody = [
    "CREATE OR REPLACE FUNCTION public.biz_ticket_checkout_create_session()",
    "RETURNS jsonb AS $$",
    "BEGIN",
    "  IF FOUND THEN",
    "    IF v_existing.status IN ('paid_completed','free_completed','failed','expired')",
    "       OR v_existing.expires_at < now() THEN",
    "      UPDATE checkout_sessions",
    "         SET status = CASE",
    "               WHEN status IN ('paid_completed','free_completed','failed','expired') THEN status",
    "               ELSE 'expired'",
    "             END,",
    "             idempotency_key = idempotency_key || ':tombstone:' || id::text",
    "       WHERE id = v_existing.id;",
    "    END IF;",
    "  END IF;",
    "END;",
    "$$ LANGUAGE plpgsql;",
  ].join("\n");

  // GOOD: both contracts present.
  let v = [];
  check(goodBody, v);
  if (v.length) self.push("GOOD fixture wrongly flagged: " + v.join("; "));

  // BAD1 (revert-style): remove the expires_at < now() OR-clause → §1 fires.
  const bad1 = goodBody.replace(
    "       OR v_existing.expires_at < now() THEN",
    "       THEN",
  );
  v = [];
  check(bad1, v);
  if (v.length === 0) self.push("BAD1 (expires_at OR-clause removed) not flagged");

  // BAD2 (regression, different angle): replace the terminal-preserving CASE
  // with an unconditional 'expired' write (would clobber terminal statuses) →
  // §2 fires. OR-clause kept so ONLY §2 fires.
  const bad2 = goodBody.replace(
    [
      "         SET status = CASE",
      "               WHEN status IN ('paid_completed','free_completed','failed','expired') THEN status",
      "               ELSE 'expired'",
      "             END,",
    ].join("\n"),
    "         SET status = 'expired',",
  );
  v = [];
  check(bad2, v);
  if (v.length === 0) self.push("BAD2 (terminal-preserving CASE replaced by unconditional 'expired') not flagged");

  if (self.length) {
    console.error("ORCH-0829B-D1 self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("ORCH-0829B-D1 self-test PASS (3/3 cases).");
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────── main path
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
check(latest.body, violations);

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
