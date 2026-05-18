#!/usr/bin/env node
/**
 * I-PROPOSED-TR3-SCHEDULE-CURRENCY-PINNED-AT-PUBLISH strict-grep gate.
 *
 * Enforces ORCH-0873 [Tr3 Installment Payments Stage 2 UI] invariant: all
 * `order_installments` rows for a given `order_id` MUST share the same
 * `currency`. The Stage 1b finalize RPC (live in production from ORCH-0869
 * backend close 2026-05-18) writes all rows with `v_inst_currency` (single
 * source per finalize call). This gate prevents a future code path from
 * violating the rule by inserting per-row varying currency values.
 *
 * Why: per investigation O-5 — no currency mixing within one schedule;
 * matches WeTravel behavior; simplifies Tr4 refund math (one currency per
 * order).
 *
 * Established by: ORCH-0873 CLOSE. Invariant flips DRAFT → ACTIVE on close.
 *
 * Detection rule: scan supabase/migrations/**.sql AND supabase/functions/**.ts
 * for `INSERT INTO order_installments` (or `INSERT INTO public.order_installments`).
 * For each, verify the currency column value source matches ONE of:
 *   (a) `v_session.currency` / `session.currency` (single source).
 *   (b) `v_inst_currency` (single-source SQL local).
 *   (c) `(v_schedule->>'currency')` or `schedule.currency` (single source per schedule).
 *   (d) An allowlist comment within 5 lines above:
 *       `// orch-strict-grep-allow tr3-schedule-currency-pinned — <reason>`
 *       (or `-- orch-strict-grep-allow tr3-schedule-currency-pinned — <reason>` for SQL).
 *
 * If the INSERT uses a per-row varying currency (e.g., `v_inst_item->>'currency'`
 * inside a loop, or `inst.currency` where inst is the array item), FAIL.
 *
 * Exit codes:
 *   0 — clean
 *   1 — at least one violation
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..", "..");

const SCAN_DIRS = [
  join(REPO_ROOT, "supabase", "migrations"),
  join(REPO_ROOT, "supabase", "functions"),
];

const ALLOWLIST_TAG = "orch-strict-grep-allow tr3-schedule-currency-pinned";
const INSERT_RE = /INSERT\s+INTO\s+(?:public\.)?order_installments\b/i;
// Pinned-source currency tokens — ANY of these in the INSERT's ~50-line
// context counts as a single-source proof.
const PINNED_SOURCE_TOKENS = [
  "v_session.currency",
  "session.currency",
  "v_inst_currency",
  "schedule.currency",
  "schedule->>'currency'",
  "v_schedule->>'currency'",
  "v_schedule ->> 'currency'",
];
// Per-row varying currency tokens — ANY of these in the INSERT's context
// indicates a violation unless an allowlist tag is present.
const PER_ROW_VARYING_TOKENS = [
  "v_inst_item->>'currency'",
  "v_inst_item ->> 'currency'",
  "inst.currency", // per-row varying (loop body)
  "row.currency", // per-row varying
];
const CONTEXT_LINES = 50;

let violations = 0;
let filesScanned = 0;

function* walkFiles(dir, exts) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry.startsWith(".") || entry === "__tests__") continue;
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      yield* walkFiles(full, exts);
    } else if (exts.some((ext) => entry.endsWith(ext))) {
      // Exclude test files.
      if (/\.test\.(ts|tsx|sql)$/.test(entry)) continue;
      yield full;
    }
  }
}

function checkFile(file) {
  const source = readFileSync(file, "utf8");
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    if (!INSERT_RE.test(lines[i])) continue;
    // The INSERT statement may span many lines (VALUES (...)). Scan the
    // surrounding window.
    const start = Math.max(0, i - 5);
    const end = Math.min(lines.length, i + CONTEXT_LINES);
    const context = lines.slice(start, end).join("\n");
    // Allowlist tag check (within 5 lines above the INSERT keyword).
    let allowed = false;
    for (let k = i - 1; k >= Math.max(0, i - 5); k -= 1) {
      if (lines[k].includes(ALLOWLIST_TAG)) {
        allowed = true;
        break;
      }
    }
    if (allowed) continue;
    // Per-row violating token present → FAIL.
    const offendingToken = PER_ROW_VARYING_TOKENS.find((t) => context.includes(t));
    if (offendingToken !== undefined) {
      violations += 1;
      const rel = relative(REPO_ROOT, file);
      console.error(
        `✗ ${rel}:${i + 1} — order_installments INSERT uses per-row varying currency source \`${offendingToken}\``,
      );
      console.error(
        `    fix: source currency from session/schedule single source (v_session.currency, v_inst_currency, schedule.currency),`,
      );
      console.error(`    OR add allowlist: -- ${ALLOWLIST_TAG} — <reason>`);
      continue;
    }
    // Must find at least one pinned-source token.
    const hasPinned = PINNED_SOURCE_TOKENS.some((t) => context.includes(t));
    if (!hasPinned) {
      violations += 1;
      const rel = relative(REPO_ROOT, file);
      console.error(
        `✗ ${rel}:${i + 1} — order_installments INSERT does not reference a pinned currency source`,
      );
      console.error(
        `    expected one of: ${PINNED_SOURCE_TOKENS.join(", ")}`,
      );
      console.error(`    OR add allowlist: -- ${ALLOWLIST_TAG} — <reason>`);
    }
  }
}

for (const scanDir of SCAN_DIRS) {
  for (const file of walkFiles(scanDir, [".sql", ".ts", ".tsx"])) {
    filesScanned += 1;
    checkFile(file);
  }
}

console.log(
  `I-PROPOSED-TR3-SCHEDULE-CURRENCY-PINNED-AT-PUBLISH: scanned ${filesScanned} files, ${violations} violations`,
);
process.exit(violations === 0 ? 0 : 1);
