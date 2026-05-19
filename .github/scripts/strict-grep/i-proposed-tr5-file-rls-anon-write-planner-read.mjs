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

if (!fs.existsSync(MIGRATIONS_DIR)) {
  console.error(`I-PROPOSED-TR5-INTAKE-FILE-RLS-ANON-WRITE-PLANNER-READ: migrations dir not found at ${MIGRATIONS_DIR}`);
  process.exit(1);
}

const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith(".sql"));

const found = new Set();
for (const file of files) {
  const src = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
  for (const policy of REQUIRED_POLICIES) {
    if (src.includes(`"${policy}"`) || src.includes(`'${policy}'`)) {
      found.add(policy);
    }
  }
}

const missing = REQUIRED_POLICIES.filter(p => !found.has(p));

if (missing.length > 0) {
  console.error(
    `I-PROPOSED-TR5-INTAKE-FILE-RLS-ANON-WRITE-PLANNER-READ: ${missing.length} required RLS policies missing across all migrations:`,
  );
  for (const p of missing) {
    console.error(`  - CREATE POLICY "${p}"`);
  }
  console.error(
    `\nFix: ensure all 4 policies are declared in a migration under supabase/migrations/. See SPEC_ORCH-0880 §4.1.E for canonical declarations.\n`,
  );
  process.exit(1);
}

console.log(
  `I-PROPOSED-TR5-INTAKE-FILE-RLS-ANON-WRITE-PLANNER-READ: ${found.size}/${REQUIRED_POLICIES.length} required RLS policies present`,
);
process.exit(0);
