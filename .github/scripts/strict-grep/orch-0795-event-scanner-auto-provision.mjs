#!/usr/bin/env node
/**
 * ORCH-0795 strict-grep gate — I-PROPOSED-AZ EVENT_HAS_MANAGER_SCANNER.
 *
 * Enforces that the auto-provision trigger and UI honesty plumbing remain
 * present. A future refactor that accidentally drops the trigger, lowers
 * the rank threshold, or strips the ScanTicketError discriminator from the
 * mobile scanner UI fails CI before merging.
 *
 * Six pattern checks (all must pass; any failure exits non-zero):
 *
 *   1. The migration file `*orch_0795_event_scanner_auto_provision.sql`
 *      exists under supabase/migrations/.
 *   2. It declares `CREATE OR REPLACE FUNCTION public.biz_event_auto_provision_scanners`.
 *   3. It declares `CREATE TRIGGER biz_event_auto_provision_scanners_after_insert`
 *      `AFTER INSERT ON public.events`.
 *   4. It references `biz_role_rank('event_manager')` to prove the threshold
 *      hasn't been accidentally lowered (scanner=10) or raised (brand_admin=50).
 *   5. `mingla-business/src/services/scanTicketService.ts` exports
 *      `class ScanTicketError` and `type ScanTicketErrorCode`.
 *   6. `mingla-business/app/event/[id]/scanner/index.tsx` imports
 *      `ScanTicketError` and references the `scanner_not_authorized` literal.
 *
 * Codified by ORCH-0795 SPEC §6.3.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..", "..");

const MIGRATIONS_DIR = join(REPO_ROOT, "supabase", "migrations");
const SERVICE_PATH = join(
  REPO_ROOT,
  "mingla-business",
  "src",
  "services",
  "scanTicketService.ts",
);
const SCANNER_UI_PATH = join(
  REPO_ROOT,
  "mingla-business",
  "app",
  "event",
  "[id]",
  "scanner",
  "index.tsx",
);

const failures = [];

function readOrEmpty(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

// Check 1 — find the migration file
let migrationPath = "";
try {
  const entries = readdirSync(MIGRATIONS_DIR);
  const match = entries.find(
    (n) => /orch_0795.*event_scanner_auto_provision\.sql$/.test(n),
  );
  if (match) {
    migrationPath = join(MIGRATIONS_DIR, match);
  } else {
    failures.push(
      "Check 1 FAIL: no migration file matching '*orch_0795*event_scanner_auto_provision.sql' under supabase/migrations/",
    );
  }
} catch (err) {
  failures.push(`Check 1 FAIL: cannot read supabase/migrations/: ${err.message}`);
}

const migrationSrc = migrationPath ? readOrEmpty(migrationPath) : "";

// Check 2 — trigger function declaration
if (
  migrationSrc &&
  !/CREATE OR REPLACE FUNCTION public\.biz_event_auto_provision_scanners/.test(
    migrationSrc,
  )
) {
  failures.push(
    "Check 2 FAIL: migration does not declare 'CREATE OR REPLACE FUNCTION public.biz_event_auto_provision_scanners'",
  );
}

// Check 3 — trigger declaration on public.events
if (
  migrationSrc &&
  !/CREATE TRIGGER biz_event_auto_provision_scanners_after_insert[\s\S]{0,200}AFTER INSERT ON public\.events/.test(
    migrationSrc,
  )
) {
  failures.push(
    "Check 3 FAIL: migration does not declare 'CREATE TRIGGER biz_event_auto_provision_scanners_after_insert ... AFTER INSERT ON public.events'",
  );
}

// Check 4 — rank threshold pinned to event_manager
if (
  migrationSrc &&
  !/biz_role_rank\('event_manager'\)/.test(migrationSrc)
) {
  failures.push(
    "Check 4 FAIL: migration must reference biz_role_rank('event_manager') to prove the auto-provision threshold hasn't been changed",
  );
}

// Check 5 — service exports ScanTicketError + ScanTicketErrorCode
const serviceSrc = readOrEmpty(SERVICE_PATH);
if (!serviceSrc) {
  failures.push(`Check 5 FAIL: cannot read ${SERVICE_PATH}`);
} else {
  if (!/export class ScanTicketError\b/.test(serviceSrc)) {
    failures.push(
      "Check 5a FAIL: scanTicketService.ts must export 'class ScanTicketError'",
    );
  }
  if (!/export type ScanTicketErrorCode\b/.test(serviceSrc)) {
    failures.push(
      "Check 5b FAIL: scanTicketService.ts must export 'type ScanTicketErrorCode'",
    );
  }
}

// Check 6 — scanner UI consumes the discriminator
const scannerUiSrc = readOrEmpty(SCANNER_UI_PATH);
if (!scannerUiSrc) {
  failures.push(`Check 6 FAIL: cannot read ${SCANNER_UI_PATH}`);
} else {
  if (!/ScanTicketError\b/.test(scannerUiSrc)) {
    failures.push(
      "Check 6a FAIL: scanner/index.tsx must reference ScanTicketError to differentiate the 403 not-authorized path",
    );
  }
  if (!/"scanner_not_authorized"/.test(scannerUiSrc)) {
    failures.push(
      "Check 6b FAIL: scanner/index.tsx must check for the 'scanner_not_authorized' code literal",
    );
  }
}

if (failures.length > 0) {
  console.error("ORCH-0795 strict-grep gate FAILED:");
  for (const msg of failures) console.error(`  - ${msg}`);
  process.exit(1);
}

console.log("ORCH-0795 strict-grep gate: PASS (6/6 checks)");
process.exit(0);
