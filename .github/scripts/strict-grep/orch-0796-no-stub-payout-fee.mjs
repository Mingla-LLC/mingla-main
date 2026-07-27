#!/usr/bin/env node
/**
 * ORCH-0796 strict-grep gate — I-PROPOSED-BC EVENT_PAYOUT_DATA_DERIVED.
 *
 * Enforces that the per-event Reconciliation screen's expected-payout figure
 * stays derived from real Stripe application_fee + refund columns, never from
 * a hardcoded fee multiplier or a "TRANSITIONAL — B-cycle Stripe payout API"
 * placeholder string.
 *
 * Five checks (all must pass; any failure exits non-zero):
 *
 *   1. moneySummary.ts contains no `* 0.96` literal (the prior 4% Stripe-fee stub).
 *   2. No source file under mingla-business/src/ or mingla-business/app/ contains
 *      the field name `payoutEstimate` (renamed to `expectedPayoutMajor` /
 *      `onlineNetMajor`).
 *   3. No source file under mingla-business/ contains the placeholder string
 *      `TRANSITIONAL — B-cycle Stripe payout API`.
 *   4. moneySummary.ts contains both `expectedPayoutMajor` AND `onlineNetMajor`
 *      (the rename is complete at the source layer).
 *   5. reconciliation.tsx references `summary.expectedPayoutMajor` (the rename
 *      is complete at the UI layer).
 *
 * Codified by ORCH-0796 SPEC §7.8 + §9 (NEW invariant I-PROPOSED-BB).
 *
 * `--self-test` proves fail-on-revert (mirrors i-1272-identity-admin-read.mjs):
 * the pure `check(inputs, failures)` is exercised with a GOOD fixture and ≥2
 * DISTINCT BAD fixtures. The disk-reading main path builds `inputs` from the
 * real tree and calls the SAME `check(...)`; the refactor is behavior-preserving
 * (identical verdict on the real tree, same messages in the same order).
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..", "..");

const BUSINESS_DIR = join(REPO_ROOT, "mingla-business");
const MONEY_SUMMARY_PATH = join(BUSINESS_DIR, "src", "utils", "moneySummary.ts");
const RECONCILIATION_TS_PATH = join(
  BUSINESS_DIR,
  "src",
  "utils",
  "reconciliation.ts",
);
const RECONCILIATION_TSX_PATH = join(
  BUSINESS_DIR,
  "app",
  "event",
  "[id]",
  "reconciliation.tsx",
);

function readOrEmpty(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function walk(dir, accept) {
  const out = [];
  let entries = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      out.push(...walk(full, accept));
    } else if (accept(name)) {
      out.push(full);
    }
  }
  return out;
}

const isSource = (n) =>
  n.endsWith(".ts") || n.endsWith(".tsx") || n.endsWith(".js");

/**
 * Pure verdict. `inputs`:
 *   moneySummarySrc, reconciliationTsSrc, reconciliationTsxSrc — file contents
 *     ("" when unreadable);
 *   srcEntries — [{ rel, content }] for every scanned mingla-business source
 *     file (rel = repo-relative path, used verbatim in offender messages);
 *   moneySummaryPath, reconciliationTsxPath — for the "cannot read" messages.
 * Pushes the SAME strings, in the SAME order, as the pre-refactor gate.
 */
function check(inputs, failures) {
  const {
    moneySummarySrc,
    reconciliationTsSrc,
    reconciliationTsxSrc,
    srcEntries,
    moneySummaryPath,
    reconciliationTsxPath,
  } = inputs;

  // Check 1 — no `* 0.96` literal in moneySummary.ts
  if (!moneySummarySrc) {
    failures.push(`Check 1 FAIL: cannot read ${moneySummaryPath}`);
  } else if (/\*\s*0\.96/.test(moneySummarySrc)) {
    failures.push(
      "Check 1 FAIL: moneySummary.ts still contains the `* 0.96` Stripe-fee stub literal",
    );
  }

  // Same check for reconciliation.ts (defensive)
  if (reconciliationTsSrc && /\*\s*0\.96/.test(reconciliationTsSrc)) {
    failures.push(
      "Check 1 FAIL: reconciliation.ts still contains the `* 0.96` Stripe-fee stub literal",
    );
  }

  // Check 2 — no `payoutEstimate` field references anywhere under mingla-business/src/ or /app/
  const offenders = [];
  for (const { rel, content } of srcEntries) {
    // Match the bare identifier (not inside a longer word).
    if (/\bpayoutEstimate\b/.test(content)) {
      offenders.push(rel);
    }
  }
  if (offenders.length > 0) {
    failures.push(
      `Check 2 FAIL: ${offenders.length} file(s) still reference \`payoutEstimate\`:\n  - ${offenders.join("\n  - ")}`,
    );
  }

  // Check 3 — no `TRANSITIONAL — B-cycle Stripe payout API` placeholder anywhere
  const placeholderOffenders = [];
  for (const { rel, content } of srcEntries) {
    if (content.includes("TRANSITIONAL — B-cycle Stripe payout API")) {
      placeholderOffenders.push(rel);
    }
  }
  if (placeholderOffenders.length > 0) {
    failures.push(
      `Check 3 FAIL: ${placeholderOffenders.length} file(s) still contain the placeholder string:\n  - ${placeholderOffenders.join("\n  - ")}`,
    );
  }

  // Check 4 — moneySummary.ts exposes both new field names
  if (moneySummarySrc) {
    if (!moneySummarySrc.includes("expectedPayoutMajor")) {
      failures.push(
        "Check 4 FAIL: moneySummary.ts does not expose `expectedPayoutMajor`",
      );
    }
    if (!moneySummarySrc.includes("onlineNetMajor")) {
      failures.push(
        "Check 4 FAIL: moneySummary.ts does not expose `onlineNetMajor`",
      );
    }
  }

  // Check 5 — reconciliation.tsx reads summary.expectedPayoutMajor
  if (!reconciliationTsxSrc) {
    failures.push(`Check 5 FAIL: cannot read ${reconciliationTsxPath}`);
  } else if (!/summary\.expectedPayoutMajor/.test(reconciliationTsxSrc)) {
    failures.push(
      "Check 5 FAIL: reconciliation.tsx does not reference `summary.expectedPayoutMajor`",
    );
  }
}

// ─────────────────────────────────────────────────────────────── self-test
if (process.argv.includes("--self-test")) {
  const self = [];
  const P = {
    moneySummaryPath: "mingla-business/src/utils/moneySummary.ts",
    reconciliationTsxPath: "mingla-business/app/event/[id]/reconciliation.tsx",
  };
  const goodMoney = "export const s = { expectedPayoutMajor, onlineNetMajor };\n";
  const goodTsx = "return summary.expectedPayoutMajor;\n";

  // GOOD: derived fields present, no `* 0.96`, no payoutEstimate, no placeholder.
  let f = [];
  check(
    {
      moneySummarySrc: goodMoney,
      reconciliationTsSrc: "",
      reconciliationTsxSrc: goodTsx,
      srcEntries: [{ rel: "mingla-business/src/utils/moneySummary.ts", content: goodMoney }],
      ...P,
    },
    f,
  );
  if (f.length) self.push("GOOD (derived payout fields, no stub) wrongly flagged: " + f.join("; "));

  // BAD1 (revert-style): the `* 0.96` Stripe-fee stub re-added to moneySummary.ts
  // → fires.
  f = [];
  check(
    {
      moneySummarySrc: "const net = gross * 0.96;\n" + goodMoney,
      reconciliationTsSrc: "",
      reconciliationTsxSrc: goodTsx,
      srcEntries: [{ rel: "mingla-business/src/utils/moneySummary.ts", content: goodMoney }],
      ...P,
    },
    f,
  );
  if (f.length === 0) self.push("BAD1 (`* 0.96` fee-stub re-added to moneySummary.ts) not flagged");

  // BAD2 (regression, different angle): the `payoutEstimate` field name
  // re-introduced in a source file → fires.
  f = [];
  check(
    {
      moneySummarySrc: goodMoney,
      reconciliationTsSrc: "",
      reconciliationTsxSrc: goodTsx,
      srcEntries: [{ rel: "mingla-business/src/components/Recon.tsx", content: "const payoutEstimate = 0;\n" }],
      ...P,
    },
    f,
  );
  if (f.length === 0) self.push("BAD2 (`payoutEstimate` field name re-introduced) not flagged");

  if (self.length) {
    console.error("ORCH-0796-NO-STUB-PAYOUT-FEE self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("ORCH-0796-NO-STUB-PAYOUT-FEE self-test PASS (3/3 cases).");
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────── main path
const moneySummarySrc = readOrEmpty(MONEY_SUMMARY_PATH);
const reconciliationTsSrc = readOrEmpty(RECONCILIATION_TS_PATH);
const reconciliationTsxSrc = readOrEmpty(RECONCILIATION_TSX_PATH);
const srcFiles = [
  ...walk(join(BUSINESS_DIR, "src"), isSource),
  ...walk(join(BUSINESS_DIR, "app"), isSource),
];
const srcEntries = srcFiles.map((file) => ({
  rel: relative(REPO_ROOT, file),
  content: readOrEmpty(file),
}));

const failures = [];
check(
  {
    moneySummarySrc,
    reconciliationTsSrc,
    reconciliationTsxSrc,
    srcEntries,
    moneySummaryPath: MONEY_SUMMARY_PATH,
    reconciliationTsxPath: RECONCILIATION_TSX_PATH,
  },
  failures,
);

// Report
if (failures.length > 0) {
  console.error("ORCH-0796 strict-grep gate FAILED:\n");
  for (const f of failures) console.error(`  ✗ ${f}\n`);
  process.exit(1);
}

console.log("ORCH-0796 strict-grep gate PASSED (5/5 checks)");
