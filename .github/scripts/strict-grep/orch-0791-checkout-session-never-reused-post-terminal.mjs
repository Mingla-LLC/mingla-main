#!/usr/bin/env node
/**
 * ORCH-0791 strict-grep gate — biz_ticket_checkout_create_session
 * must never reuse a terminal session row.
 *
 * Enforces I-PROPOSED-AW CHECKOUT-SESSION-NEVER-REUSED-POST-TERMINAL.
 *
 * Locates the latest migration that defines or replaces
 * `biz_ticket_checkout_create_session` (grep across
 * supabase/migrations/*.sql, pick highest filename prefix) and asserts:
 *
 *   1. The RPC body contains the terminal-status set check
 *      `IN ('paid_completed','free_completed','failed','expired')`.
 *   2. The RPC body contains the tombstone UPDATE that mutates
 *      idempotency_key by appending ':tombstone:' || id::text.
 *   3. The RPC body still contains the in-flight short-circuit RETURN
 *      so non-terminal retries continue to dedupe.
 *
 * If a future migration removes any of these three, the gate fails
 * with `<migration-path>:<reason>` and CI blocks the merge.
 *
 * `--self-test` proves fail-on-revert (mirrors i-1272-identity-admin-read.mjs):
 * the pure `check(body, failures)` is exercised with a GOOD fixture
 * (specificity) and ≥2 DISTINCT BAD fixtures (sensitivity). The disk-reading
 * main path selects the latest migration and calls the SAME `check(...)`; the
 * refactor is behavior-preserving (identical verdict on the real tree).
 */

import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const MIGRATIONS_DIR = path.join(root, "supabase", "migrations");

/**
 * Pure verdict over a single migration body. `latestPath` is used only to
 * annotate the failure messages (defaults to a placeholder for the self-test).
 */
function check(body, failures, latestPath = "<latest migration>") {
  // §1 — terminal-status set check. Allow whitespace variation but require the
  // exact four canonical terminal statuses, in the SQL `IN (...)` form.
  const terminalCheckRegex =
    /IN\s*\(\s*'paid_completed'\s*,\s*'free_completed'\s*,\s*'failed'\s*,\s*'expired'\s*\)/;
  if (!terminalCheckRegex.test(body)) {
    failures.push(
      `${latestPath}: missing terminal-status set check ` +
        `IN ('paid_completed','free_completed','failed','expired') ` +
        "(I-PROPOSED-AW / ORCH-0791).",
    );
  }

  // §2 — tombstone UPDATE shape. Look for the literal idempotency_key
  // concatenation that appends ':tombstone:' || id::text.
  const tombstoneRegex =
    /idempotency_key\s*\|\|\s*':tombstone:'\s*\|\|\s*id::text/;
  if (!tombstoneRegex.test(body)) {
    failures.push(
      `${latestPath}: missing tombstone UPDATE that mutates idempotency_key ` +
        "(I-PROPOSED-AW / ORCH-0791). Required shape: " +
        "`idempotency_key || ':tombstone:' || id::text`.",
    );
  }

  // §3 — in-flight short-circuit RETURN preserved. Heuristic:
  // `RETURN jsonb_build_object` appears at least twice (once for the in-flight
  // case, once for the fresh-insert case).
  const returnMatches = body.match(/RETURN\s+jsonb_build_object\b/g);
  if (returnMatches === null || returnMatches.length < 2) {
    failures.push(
      `${latestPath}: in-flight short-circuit RETURN missing — found ` +
        `${returnMatches === null ? 0 : returnMatches.length} ` +
        "RETURN jsonb_build_object occurrence(s), expected at least 2 (one " +
        "for the in-flight retry path, one for the fresh-insert path). " +
        "I-CHECKOUT-IDEMPOTENT must continue to hold for non-terminal " +
        "statuses.",
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
    "  IF v_existing.status IN ('paid_completed','free_completed','failed','expired') THEN",
    "    UPDATE checkout_sessions",
    "       SET idempotency_key = idempotency_key || ':tombstone:' || id::text",
    "     WHERE id = v_existing.id;",
    "  ELSE",
    "    RETURN jsonb_build_object('reused', true, 'session', v_existing);",
    "  END IF;",
    "  RETURN jsonb_build_object('created', true, 'session', v_new);",
    "END;",
    "$$ LANGUAGE plpgsql;",
  ].join("\n");

  // GOOD: all three tokens present.
  let f = [];
  check(goodBody, f);
  if (f.length) self.push("GOOD fixture wrongly flagged: " + f.join("; "));

  // BAD1 (revert-style): delete the terminal-status set check → §1 fires.
  const bad1 = goodBody.replace(
    "IF v_existing.status IN ('paid_completed','free_completed','failed','expired') THEN",
    "IF v_existing.status = 'paid_completed' THEN",
  );
  f = [];
  check(bad1, f);
  if (f.length === 0) self.push("BAD1 (terminal-status set check removed) not flagged");

  // BAD2 (regression, different angle): delete the tombstone idempotency_key
  // mutation while keeping the terminal check → §2 fires.
  const bad2 = goodBody.replace(
    "       SET idempotency_key = idempotency_key || ':tombstone:' || id::text\n",
    "       SET status = 'expired'\n",
  );
  f = [];
  check(bad2, f);
  if (f.length === 0) self.push("BAD2 (tombstone idempotency_key mutation removed) not flagged");

  if (self.length) {
    console.error("ORCH-0791 self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("ORCH-0791 self-test PASS (3/3 cases).");
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────── main path
const failures = [];

const migrationFiles = fs
  .readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();

// Find every migration that contains the function name. The LATEST one
// (highest filename prefix) is the authoritative current definition.
const matchingMigrations = migrationFiles.filter((f) => {
  const body = fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf8");
  return /CREATE OR REPLACE FUNCTION\s+public\.biz_ticket_checkout_create_session/i.test(
    body,
  );
});

if (matchingMigrations.length === 0) {
  failures.push(
    "supabase/migrations/: no migration defines biz_ticket_checkout_create_session — " +
      "ORCH-0791 invariant cannot be enforced.",
  );
} else {
  const latest = matchingMigrations[matchingMigrations.length - 1];
  const latestPath = `supabase/migrations/${latest}`;
  const body = fs.readFileSync(path.join(MIGRATIONS_DIR, latest), "utf8");
  check(body, failures, latestPath);
}

if (failures.length > 0) {
  console.error("ORCH-0791 strict-grep gate failed:");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}

console.log("ORCH-0791 strict-grep gate passed.");
