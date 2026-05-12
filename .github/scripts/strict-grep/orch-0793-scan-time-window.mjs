#!/usr/bin/env node
/**
 * ORCH-0793 strict-grep gate — I-PROPOSED-BB SCAN_TIME_WINDOW_ENFORCED.
 *
 * Enforces that the biz_ticket_scan RPC remains time-window aware against
 * event_dates, that the mobile service + store + scanner UI all carry the
 * new discriminator values, and that no future migration drops the
 * event_dates join out of the RPC body.
 *
 * Six pattern checks (all must pass; any failure exits non-zero):
 *
 *   1. The migration file `*orch_0793*scan_time_window.sql` exists under
 *      supabase/migrations/.
 *   2. The migration declares CREATE OR REPLACE FUNCTION public.biz_ticket_scan
 *      AND references event_dates, now(), c_grace_before, c_grace_after.
 *   3. The migration includes the verification probe (DO $$ ... event_dates ...).
 *   4. mingla-business/src/services/scanTicketService.ts ServerScanResult
 *      contains "not_yet_open", "event_ended", nextStartAt, lastEndAt.
 *   5. mingla-business/src/store/scanStore.ts ScanResult union contains
 *      "not_yet_open" and "event_ended".
 *   6. mingla-business/app/event/[id]/scanner/index.tsx has case "not_yet_open"
 *      AND case "event_ended" branches.
 *   7. No later migration (timestamp > 20260528000000) declares
 *      CREATE OR REPLACE FUNCTION public.biz_ticket_scan WITHOUT event_dates.
 *   8. Some migration widens scan_events_result_check CHECK constraint to
 *      include 'not_yet_open' AND 'event_ended' (added 2026-05-12 after
 *      tester live-fire caught the pre-existing CHECK rejecting the new
 *      discriminators).
 *
 * Codified by ORCH-0793 SPEC §3.6 + QA rework §2.
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
const STORE_PATH = join(
  REPO_ROOT,
  "mingla-business",
  "src",
  "store",
  "scanStore.ts",
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

// Check 1 — find the ORCH-0793 migration file
let migrationPath = "";
let migrationName = "";
try {
  const entries = readdirSync(MIGRATIONS_DIR);
  const match = entries.find(
    (n) => /orch_0793.*scan_time_window\.sql$/.test(n),
  );
  if (match) {
    migrationPath = join(MIGRATIONS_DIR, match);
    migrationName = match;
  } else {
    failures.push(
      "Check 1 FAIL: no migration file matching '*orch_0793*scan_time_window.sql' under supabase/migrations/",
    );
  }
} catch (err) {
  failures.push(`Check 1 FAIL: cannot read supabase/migrations/: ${err.message}`);
}

const migrationSrc = migrationPath ? readOrEmpty(migrationPath) : "";

// Check 2 — RPC body must contain event_dates, now(), grace constants
if (migrationSrc) {
  if (
    !/CREATE OR REPLACE FUNCTION public\.biz_ticket_scan/.test(migrationSrc)
  ) {
    failures.push(
      "Check 2a FAIL: migration must declare 'CREATE OR REPLACE FUNCTION public.biz_ticket_scan'",
    );
  }
  if (!/event_dates/.test(migrationSrc)) {
    failures.push(
      "Check 2b FAIL: biz_ticket_scan migration must reference 'event_dates' (I-PROPOSED-AY EVENT_DATES_SOLE_DATE_AUTHORITY)",
    );
  }
  if (!/now\(\)/.test(migrationSrc)) {
    failures.push(
      "Check 2c FAIL: biz_ticket_scan migration must reference 'now()' for time-window comparison",
    );
  }
  if (!/c_grace_before/.test(migrationSrc) || !/c_grace_after/.test(migrationSrc)) {
    failures.push(
      "Check 2d FAIL: biz_ticket_scan migration must declare c_grace_before and c_grace_after constants",
    );
  }
  if (!/'not_yet_open'/.test(migrationSrc) || !/'event_ended'/.test(migrationSrc)) {
    failures.push(
      "Check 2e FAIL: biz_ticket_scan migration must emit 'not_yet_open' and 'event_ended' discriminator values",
    );
  }
}

// Check 3 — verification probe block
if (
  migrationSrc &&
  !/ORCH-0793 probe failed/.test(migrationSrc)
) {
  failures.push(
    "Check 3 FAIL: migration must include the DO $$ verification probe with 'ORCH-0793 probe failed' messages",
  );
}

// Check 4 — service layer
const serviceSrc = readOrEmpty(SERVICE_PATH);
if (!serviceSrc) {
  failures.push(`Check 4 FAIL: cannot read ${SERVICE_PATH}`);
} else {
  if (!/"not_yet_open"/.test(serviceSrc)) {
    failures.push(
      "Check 4a FAIL: scanTicketService.ts must include '\"not_yet_open\"' in the ServerScanResult union",
    );
  }
  if (!/"event_ended"/.test(serviceSrc)) {
    failures.push(
      "Check 4b FAIL: scanTicketService.ts must include '\"event_ended\"' in the ServerScanResult union",
    );
  }
  if (!/nextStartAt:\s*string\s*\|\s*null/.test(serviceSrc)) {
    failures.push(
      "Check 4c FAIL: scanTicketService.ts ServerScanResult must declare 'nextStartAt: string | null'",
    );
  }
  if (!/lastEndAt:\s*string\s*\|\s*null/.test(serviceSrc)) {
    failures.push(
      "Check 4d FAIL: scanTicketService.ts ServerScanResult must declare 'lastEndAt: string | null'",
    );
  }
}

// Check 5 — store
const storeSrc = readOrEmpty(STORE_PATH);
if (!storeSrc) {
  failures.push(`Check 5 FAIL: cannot read ${STORE_PATH}`);
} else {
  if (!/"not_yet_open"/.test(storeSrc)) {
    failures.push(
      "Check 5a FAIL: scanStore.ts ScanResult union must include '\"not_yet_open\"'",
    );
  }
  if (!/"event_ended"/.test(storeSrc)) {
    failures.push(
      "Check 5b FAIL: scanStore.ts ScanResult union must include '\"event_ended\"'",
    );
  }
}

// Check 6 — scanner UI has overlay branches
const scannerUiSrc = readOrEmpty(SCANNER_UI_PATH);
if (!scannerUiSrc) {
  failures.push(`Check 6 FAIL: cannot read ${SCANNER_UI_PATH}`);
} else {
  if (!/case "not_yet_open"/.test(scannerUiSrc)) {
    failures.push(
      "Check 6a FAIL: scanner/index.tsx must declare 'case \"not_yet_open\"' in overlaySpec / handleBarcodeScanned",
    );
  }
  if (!/case "event_ended"/.test(scannerUiSrc)) {
    failures.push(
      "Check 6b FAIL: scanner/index.tsx must declare 'case \"event_ended\"' in overlaySpec / handleBarcodeScanned",
    );
  }
}

// Check 7 — no future migration drops event_dates from the RPC body.
// Scan every migration with timestamp prefix strictly greater than the
// ORCH-0793 migration; any that CREATE OR REPLACE biz_ticket_scan must
// still reference event_dates.
if (migrationName) {
  const orch0793Prefix = migrationName.match(/^(\d+)/)?.[1] ?? "";
  try {
    const entries = readdirSync(MIGRATIONS_DIR);
    for (const fname of entries) {
      const prefix = fname.match(/^(\d+)/)?.[1] ?? "";
      if (prefix && prefix > orch0793Prefix) {
        const body = readOrEmpty(join(MIGRATIONS_DIR, fname));
        if (
          /CREATE OR REPLACE FUNCTION public\.biz_ticket_scan/.test(body) &&
          !/event_dates/.test(body)
        ) {
          failures.push(
            `Check 7 FAIL: migration '${fname}' redeclares biz_ticket_scan without event_dates — would break I-PROPOSED-BB SCAN_TIME_WINDOW_ENFORCED`,
          );
        }
      }
    }
  } catch (err) {
    failures.push(`Check 7 FAIL: cannot scan migrations: ${err.message}`);
  }
}

// Check 8 — scan_events.scan_result CHECK constraint widened in some
// migration to include the new discriminators. Added after tester live-fire
// QA on 2026-05-12 caught the pre-existing CHECK rejecting the new values.
// Future contributors adding a new scan_result value must widen the
// constraint in the same PR or fail this check.
{
  let constraintWidened = false;
  try {
    const entries = readdirSync(MIGRATIONS_DIR);
    for (const fname of entries) {
      const body = readOrEmpty(join(MIGRATIONS_DIR, fname));
      if (
        /scan_events_result_check/.test(body) &&
        /not_yet_open/.test(body) &&
        /event_ended/.test(body)
      ) {
        constraintWidened = true;
        break;
      }
    }
  } catch (err) {
    failures.push(`Check 8 FAIL: cannot scan migrations: ${err.message}`);
  }
  if (!constraintWidened) {
    failures.push(
      "Check 8 FAIL: no migration widens scan_events_result_check CHECK to include 'not_yet_open' and 'event_ended' — the RPC's INSERT into scan_events will be rejected at runtime by the pre-existing constraint",
    );
  }
}

if (failures.length > 0) {
  console.error("ORCH-0793 strict-grep gate FAILED:");
  for (const msg of failures) console.error(`  - ${msg}`);
  process.exit(1);
}

console.log("ORCH-0793 strict-grep gate: PASS (all checks)");
process.exit(0);
