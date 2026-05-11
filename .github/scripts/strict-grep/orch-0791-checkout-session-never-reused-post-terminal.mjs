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
 */

import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const MIGRATIONS_DIR = path.join(root, "supabase", "migrations");

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

  // §1 — terminal-status set check.
  // Allow whitespace variation but require the exact four canonical
  // terminal statuses, in the SQL `IN (...)` form.
  const terminalCheckRegex =
    /IN\s*\(\s*'paid_completed'\s*,\s*'free_completed'\s*,\s*'failed'\s*,\s*'expired'\s*\)/;
  if (!terminalCheckRegex.test(body)) {
    failures.push(
      `${latestPath}: missing terminal-status set check ` +
        `IN ('paid_completed','free_completed','failed','expired') ` +
        "(I-PROPOSED-AW / ORCH-0791).",
    );
  }

  // §2 — tombstone UPDATE shape.
  // Look for the literal idempotency_key concatenation that appends
  // ':tombstone:' || id::text. Allow whitespace variation.
  const tombstoneRegex =
    /idempotency_key\s*\|\|\s*':tombstone:'\s*\|\|\s*id::text/;
  if (!tombstoneRegex.test(body)) {
    failures.push(
      `${latestPath}: missing tombstone UPDATE that mutates idempotency_key ` +
        "(I-PROPOSED-AW / ORCH-0791). Required shape: " +
        "`idempotency_key || ':tombstone:' || id::text`.",
    );
  }

  // §3 — in-flight short-circuit RETURN preserved.
  // Look for the existing-session jsonb_build_object RETURN that the
  // non-terminal ELSE branch still uses. Heuristic: `RETURN jsonb_build_object`
  // appears at least twice in the function body (once for the in-flight
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

if (failures.length > 0) {
  console.error("ORCH-0791 strict-grep gate failed:");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}

console.log("ORCH-0791 strict-grep gate passed.");
