#!/usr/bin/env node
/**
 * I-PROPOSED-TR4-CANCELLED-INSTALLMENT-NEVER-CHARGED strict-grep gate.
 *
 * Enforces ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] invariant: the
 * cron `process-scheduled-installments` MUST filter
 * `WHERE status='scheduled' AND cancelled_at IS NULL` (Query 1 — initial
 * attempts) AND `WHERE status='failed' AND cancelled_at IS NULL`
 * (Query 2 — retry-eligible). Both queries must carry the explicit
 * `.is("cancelled_at", null)` filter as belt-and-braces against
 * transaction-visibility lag during a rare race between Tr4 cancel-
 * trip-booking commit and the cron query.
 *
 * The DB CHECK constraint `order_installments_cancelled_at_status_consistent`
 * already enforces `(status='cancelled') ⟺ (cancelled_at IS NOT NULL)` so
 * existing `status='scheduled'` / `status='failed'` filters would already
 * exclude cancelled rows. The explicit `cancelled_at` filter is defense-
 * in-depth — if someone refactors the cron to bypass status filtering
 * (e.g. switches to `due_at <= now()` only), the gate catches the
 * regression.
 *
 * Detection rule: process-scheduled-installments source MUST contain at
 * least 2 occurrences of `.is("cancelled_at", null)` (one per query).
 *
 * Established by: ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] CLOSE.
 * Invariant flips DRAFT → ACTIVE on close.
 *
 * Exit codes:
 *   0 — clean
 *   1 — at least one violation
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..", "..");

const TARGET_FILE = join(
  REPO_ROOT,
  "supabase",
  "functions",
  "process-scheduled-installments",
  "index.ts",
);

const FILTER_PATTERN = /\.is\(\s*["']cancelled_at["']\s*,\s*null\s*\)/g;
const MIN_OCCURRENCES = 2;

let source;
try {
  source = readFileSync(TARGET_FILE, "utf8");
} catch (err) {
  console.error(
    `[i-proposed-tr4-cancelled-installment-never-charged] FAIL: cannot read ${TARGET_FILE} — ${err.message}`,
  );
  process.exit(1);
}

const matches = source.match(FILTER_PATTERN) ?? [];
if (matches.length < MIN_OCCURRENCES) {
  console.error(
    `[i-proposed-tr4-cancelled-installment-never-charged] VIOLATION: ${TARGET_FILE} contains ${matches.length} occurrence(s) of \`.is("cancelled_at", null)\` — expected at least ${MIN_OCCURRENCES} (one per cron query: scheduled-initial + failed-retry).`,
  );
  process.exit(1);
}

console.log(
  `[i-proposed-tr4-cancelled-installment-never-charged] OK — process-scheduled-installments contains ${matches.length} \`.is("cancelled_at", null)\` filter(s) (≥${MIN_OCCURRENCES} required).`,
);
process.exit(0);
