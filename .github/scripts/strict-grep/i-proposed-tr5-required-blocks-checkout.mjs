#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Strict-grep gate — I-PROPOSED-TR5-INTAKE-REQUIRED-BLOCKS-CHECKOUT.
 *
 * Per SPEC_ORCH-0880 §10: the `ticket-checkout-create` edge function MUST
 * include a 400 gate that rejects when a trip's tier has intake schema with
 * ≥1 required question AND `intake_form_data` is missing/incomplete.
 *
 * Detection: scan supabase/functions/ticket-checkout-create/index.ts for:
 *   (a) the string literal "intake_form_required" (rejection error code)
 *   (b) a reference to trip_intake_schemas (lookup target) OR
 *       schema_version_id (stale schema check)
 *
 * Both required patterns missing = fail.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

const TARGET = path.join(
  REPO_ROOT,
  "supabase",
  "functions",
  "ticket-checkout-create",
  "index.ts",
);

if (!fs.existsSync(TARGET)) {
  console.error(`I-PROPOSED-TR5-INTAKE-REQUIRED-BLOCKS-CHECKOUT: target file not found at ${TARGET}`);
  process.exit(1);
}

const src = fs.readFileSync(TARGET, "utf8");

const checks = [
  {
    name: "intake_form_required error code present",
    pattern: /["']intake_form_required["']/,
  },
  {
    name: "trip_intake_schemas lookup present",
    pattern: /trip_intake_schemas/,
  },
  {
    name: "schema_version_id stale check present",
    pattern: /schema_version_id/,
  },
];

const failures = [];
for (const check of checks) {
  if (!check.pattern.test(src)) {
    failures.push(check.name);
  }
}

if (failures.length > 0) {
  console.error(
    `I-PROPOSED-TR5-INTAKE-REQUIRED-BLOCKS-CHECKOUT: ${failures.length} required pattern(s) missing in ${path.relative(REPO_ROOT, TARGET)}:`,
  );
  for (const f of failures) {
    console.error(`  - ${f}`);
  }
  console.error(
    `\nFix: add the intake_form_required 400 gate per SPEC_ORCH-0880 §5.3 + §15.4.\n`,
  );
  process.exit(1);
}

console.log(
  `I-PROPOSED-TR5-INTAKE-REQUIRED-BLOCKS-CHECKOUT: ${checks.length}/${checks.length} required patterns present`,
);
process.exit(0);
