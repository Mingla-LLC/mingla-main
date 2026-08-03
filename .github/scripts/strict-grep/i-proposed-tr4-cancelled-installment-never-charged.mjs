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
 * `--self-test` proves fail-on-revert (mirrors i-1272-identity-admin-read.mjs):
 * the pure `check(source, failures)` is exercised with a GOOD fixture (2
 * filters) and ≥2 DISTINCT BAD fixtures (one filter removed; all filters
 * removed). The disk-reading main path calls the SAME `check(...)`;
 * behavior-preserving refactor.
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

/**
 * Pure verdict. `source` = raw source of process-scheduled-installments. Pushes
 * a single string into `failures` when fewer than MIN_OCCURRENCES
 * `.is("cancelled_at", null)` filters are present. Behavior-preserving.
 */
function check(source, failures) {
  const matches = source.match(FILTER_PATTERN) ?? [];
  if (matches.length < MIN_OCCURRENCES) {
    failures.push(
      `contains ${matches.length} occurrence(s) of \`.is("cancelled_at", null)\` — expected at least ${MIN_OCCURRENCES} (one per cron query: scheduled-initial + failed-retry).`,
    );
  }
}

// ─────────────────────────────────────────────────────────────── self-test
if (process.argv.includes("--self-test")) {
  const self = [];

  // GOOD: 2 filters (one per query) → silent.
  const good =
    'const q1 = await sb.from("order_installments").eq("status", "scheduled").is("cancelled_at", null);\n' +
    'const q2 = await sb.from("order_installments").eq("status", "failed").is("cancelled_at", null);\n';
  let f = [];
  check(good, f);
  if (f.length) self.push("GOOD fixture wrongly flagged: " + f.join("; "));

  // BAD1 (revert-style): one filter removed → only 1 occurrence → fires.
  const bad1 =
    'const q1 = await sb.from("order_installments").eq("status", "scheduled").is("cancelled_at", null);\n' +
    'const q2 = await sb.from("order_installments").eq("status", "failed");\n';
  f = [];
  check(bad1, f);
  if (f.length === 0) self.push("BAD1 (one cancelled_at filter removed → 1 occurrence) not flagged");

  // BAD2 (regression, different angle): the cron refactored to a due_at-only
  // query with 0 cancelled_at filters → fires.
  const bad2 =
    'const due = await sb.from("order_installments").lte("due_at", nowIso());\n';
  f = [];
  check(bad2, f);
  if (f.length === 0) self.push("BAD2 (due_at-only refactor → 0 occurrences) not flagged");

  if (self.length) {
    console.error("[i-proposed-tr4-cancelled-installment-never-charged] self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("[i-proposed-tr4-cancelled-installment-never-charged] self-test PASS (3/3 cases).");
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────── main path
let source;
try {
  source = readFileSync(TARGET_FILE, "utf8");
} catch (err) {
  console.error(
    `[i-proposed-tr4-cancelled-installment-never-charged] FAIL: cannot read ${TARGET_FILE} — ${err.message}`,
  );
  process.exit(1);
}

const failures = [];
check(source, failures);

if (failures.length > 0) {
  console.error(
    `[i-proposed-tr4-cancelled-installment-never-charged] VIOLATION: ${TARGET_FILE} ${failures[0]}`,
  );
  process.exit(1);
}

const matchCount = (source.match(FILTER_PATTERN) ?? []).length;
console.log(
  `[i-proposed-tr4-cancelled-installment-never-charged] OK — process-scheduled-installments contains ${matchCount} \`.is("cancelled_at", null)\` filter(s) (≥${MIN_OCCURRENCES} required).`,
);
process.exit(0);
