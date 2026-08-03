#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Strict-grep gate — I-PROPOSED-TR5-INTAKE-FILE-RLS-ANON-WRITE-PLANNER-READ.
 *
 * Per SPEC_ORCH-0880 §4.1.E: `trip_intake_files` storage bucket MUST have 4
 * RLS policies enforcing anon-write-own + anon-read-via-signed-url +
 * planner-read-brand-scoped + service-role-all.
 *
 * Detection: scan supabase/migrations/ for the 4 expected policy CREATE
 * statements. Source-grade gate (DB-level enforcement is the real protection;
 * this is the textual proof of intent + protection against accidental removal
 * in a future migration).
 *
 * `--self-test` proves fail-on-revert (mirrors i-1272-identity-admin-read.mjs):
 * the pure `check(migrationsBody, failures)` is exercised with a GOOD fixture
 * (all 4 policies) and ≥2 DISTINCT BAD fixtures (a dropped policy each). The
 * disk-reading main path concatenates every migration and calls the SAME
 * `check(...)`; behavior-preserving refactor (a policy is "present" iff it
 * appears quoted in ANY migration, exactly as before).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

const MIGRATIONS_DIR = path.join(REPO_ROOT, "supabase", "migrations");

const REQUIRED_POLICIES = [
  "trip_intake_files_anon_buyer_insert",
  "trip_intake_files_anon_buyer_select",
  "trip_intake_files_planner_read",
  "trip_intake_files_service_role_all",
];

/**
 * Pure verdict. `migrationsBody` = the concatenation of every migration's
 * source. A policy is satisfied iff its quoted name (double- or single-quoted)
 * appears anywhere in the body. Pushes one string per missing policy into
 * `failures`.
 */
function check(migrationsBody, failures) {
  for (const policy of REQUIRED_POLICIES) {
    if (
      !migrationsBody.includes(`"${policy}"`) &&
      !migrationsBody.includes(`'${policy}'`)
    ) {
      failures.push(`missing CREATE POLICY "${policy}"`);
    }
  }
}

// ─────────────────────────────────────────────────────────────── self-test
if (process.argv.includes("--self-test")) {
  const self = [];

  const policyStmt = (name) =>
    `CREATE POLICY "${name}" ON storage.objects FOR ALL USING (bucket_id = 'trip_intake_files');`;

  // GOOD: all 4 policies present → silent.
  const good = REQUIRED_POLICIES.map(policyStmt).join("\n") + "\n";
  let f = [];
  check(good, f);
  if (f.length) self.push("GOOD fixture wrongly flagged: " + f.join("; "));

  // BAD1 (revert-style): the planner-read-brand-scoped policy dropped → fires.
  const bad1 = REQUIRED_POLICIES.filter((p) => p !== "trip_intake_files_planner_read")
    .map(policyStmt)
    .join("\n") + "\n";
  f = [];
  check(bad1, f);
  if (f.length === 0) self.push("BAD1 (planner-read policy dropped) not flagged");

  // BAD2 (regression, different angle): the anon-write-own policy dropped → fires.
  const bad2 = REQUIRED_POLICIES.filter((p) => p !== "trip_intake_files_anon_buyer_insert")
    .map(policyStmt)
    .join("\n") + "\n";
  f = [];
  check(bad2, f);
  if (f.length === 0) self.push("BAD2 (anon-write-own policy dropped) not flagged");

  if (self.length) {
    console.error("I-PROPOSED-TR5-INTAKE-FILE-RLS-ANON-WRITE-PLANNER-READ self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("I-PROPOSED-TR5-INTAKE-FILE-RLS-ANON-WRITE-PLANNER-READ self-test PASS (3/3 cases).");
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────── main path
if (!fs.existsSync(MIGRATIONS_DIR)) {
  console.error(`I-PROPOSED-TR5-INTAKE-FILE-RLS-ANON-WRITE-PLANNER-READ: migrations dir not found at ${MIGRATIONS_DIR}`);
  process.exit(1);
}

const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith(".sql"));
const migrationsBody = files
  .map((file) => fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"))
  .join("\n");

const failures = [];
check(migrationsBody, failures);

if (failures.length > 0) {
  console.error(
    `I-PROPOSED-TR5-INTAKE-FILE-RLS-ANON-WRITE-PLANNER-READ: ${failures.length} required RLS policies missing across all migrations:`,
  );
  for (const msg of failures) {
    console.error(`  - ${msg}`);
  }
  console.error(
    `\nFix: ensure all 4 policies are declared in a migration under supabase/migrations/. See SPEC_ORCH-0880 §4.1.E for canonical declarations.\n`,
  );
  process.exit(1);
}

console.log(
  `I-PROPOSED-TR5-INTAKE-FILE-RLS-ANON-WRITE-PLANNER-READ: ${REQUIRED_POLICIES.length}/${REQUIRED_POLICIES.length} required RLS policies present`,
);
process.exit(0);
