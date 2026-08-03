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

/**
 * Pure verdict. `fileEntries` = [{ rel, content }] with `rel` the repo-relative
 * POSIX path. For each `INSERT INTO order_installments` that is not allowlisted:
 * a per-row varying currency token in context is a violation; otherwise the
 * absence of any pinned-source token is a violation. Pushes one record
 * ({ rel, line, kind, token? }) per offending INSERT into `failures`.
 * Behavior-preserving refactor of the original checkFile logic.
 */
function check(fileEntries, failures) {
  for (const { rel, content } of fileEntries) {
    const lines = content.split("\n");
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
        failures.push({ rel, line: i + 1, kind: "per-row", token: offendingToken });
        continue;
      }
      // Must find at least one pinned-source token.
      const hasPinned = PINNED_SOURCE_TOKENS.some((t) => context.includes(t));
      if (!hasPinned) {
        failures.push({ rel, line: i + 1, kind: "no-pinned" });
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────── self-test
if (process.argv.includes("--self-test")) {
  const self = [];
  const run = (entries) => {
    const f = [];
    check(entries, f);
    return f;
  };

  // GOOD: an INSERT sourcing currency from a single pinned source → silent.
  let f = run([
    {
      rel: "supabase/migrations/20260518000000_finalize.sql",
      content:
        "INSERT INTO order_installments (order_id, amount, currency)\n" +
        "VALUES (v_order_id, v_amt, v_inst_currency);\n",
    },
  ]);
  if (f.length) self.push("GOOD (pinned v_inst_currency) wrongly flagged");

  // BAD1 (revert-style): an INSERT using a per-row varying currency source.
  f = run([
    {
      rel: "supabase/migrations/20260601000000_bad.sql",
      content:
        "INSERT INTO order_installments (order_id, currency)\n" +
        "VALUES (v_order_id, v_inst_item->>'currency');\n",
    },
  ]);
  if (f.length === 0) self.push("BAD1 (per-row varying currency) not flagged");

  // BAD2 (regression, different angle): an INSERT that references NO pinned source
  // at all (unpinned expression) → the missing-pinned-source branch fires.
  f = run([
    {
      rel: "supabase/functions/finalize/index.ts",
      content:
        "INSERT INTO order_installments (order_id, currency)\n" +
        "VALUES (v_order_id, computeCurrency(x));\n",
    },
  ]);
  if (f.length === 0) self.push("BAD2 (no pinned currency source) not flagged");

  // SPECIFICITY: an allowlisted per-row INSERT stays silent.
  f = run([
    {
      rel: "supabase/migrations/20260602000000_allow.sql",
      content:
        "-- orch-strict-grep-allow tr3-schedule-currency-pinned — legacy backfill\n" +
        "INSERT INTO order_installments (order_id, currency)\n" +
        "VALUES (v_order_id, v_inst_item->>'currency');\n",
    },
  ]);
  if (f.length) self.push("allowlisted per-row INSERT wrongly flagged");

  if (self.length) {
    console.error("I-PROPOSED-TR3-SCHEDULE-CURRENCY-PINNED-AT-PUBLISH self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log(
    "I-PROPOSED-TR3-SCHEDULE-CURRENCY-PINNED-AT-PUBLISH self-test PASS (4/4 cases).",
  );
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────── main path
const fileEntries = [];
for (const scanDir of SCAN_DIRS) {
  for (const file of walkFiles(scanDir, [".sql", ".ts", ".tsx"])) {
    filesScanned += 1;
    fileEntries.push({
      rel: relative(REPO_ROOT, file),
      content: readFileSync(file, "utf8"),
    });
  }
}

const failures = [];
check(fileEntries, failures);
violations = failures.length;
for (const v of failures) {
  if (v.kind === "per-row") {
    console.error(
      `✗ ${v.rel}:${v.line} — order_installments INSERT uses per-row varying currency source \`${v.token}\``,
    );
    console.error(
      `    fix: source currency from session/schedule single source (v_session.currency, v_inst_currency, schedule.currency),`,
    );
    console.error(`    OR add allowlist: -- ${ALLOWLIST_TAG} — <reason>`);
  } else {
    console.error(
      `✗ ${v.rel}:${v.line} — order_installments INSERT does not reference a pinned currency source`,
    );
    console.error(
      `    expected one of: ${PINNED_SOURCE_TOKENS.join(", ")}`,
    );
    console.error(`    OR add allowlist: -- ${ALLOWLIST_TAG} — <reason>`);
  }
}

console.log(
  `I-PROPOSED-TR3-SCHEDULE-CURRENCY-PINNED-AT-PUBLISH: scanned ${filesScanned} files, ${violations} violations`,
);
process.exit(violations === 0 ? 0 : 1);
