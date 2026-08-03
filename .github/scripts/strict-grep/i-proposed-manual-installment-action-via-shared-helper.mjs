#!/usr/bin/env node
/**
 * I-PROPOSED-MANUAL-INSTALLMENT-ACTION-VIA-SHARED-HELPER strict-grep gate.
 *
 * ORCH-0914: installment PaymentIntent creation must live only in
 * supabase/functions/_shared/installments/createInstallmentPI.ts. Cron and
 * manual charge endpoints are callers, not independent Stripe creators.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..", "..");
const SCAN_DIR = join(REPO_ROOT, "supabase", "functions");
const OWNER_FILE = join(
  REPO_ROOT,
  "supabase",
  "functions",
  "_shared",
  "installments",
  "createInstallmentPI.ts",
);
// Repo-relative form of the owner file (POSIX) — the exemption lives inside the
// pure check(...) so it is behavior-preserving AND self-testable.
const OWNER_FILE_REL =
  "supabase/functions/_shared/installments/createInstallmentPI.ts";

const PI_CREATE_RE = /paymentIntents\.create\s*\(/;
const INSTALLMENT_MARKER_RE = /mingla_installment_id/;
const CONTEXT_LINES = 24;

let filesScanned = 0;
let violations = 0;

/**
 * Pure verdict. `fileEntries` = [{ rel, content }] with `rel` the repo-relative
 * POSIX path. Any file OTHER than the owner that creates a PaymentIntent whose
 * ±CONTEXT_LINES context mentions `mingla_installment_id` is a violation. Pushes
 * one { rel, line } record per offending call site into `failures`.
 * Behavior-preserving refactor of the original main-loop logic.
 */
function check(fileEntries, failures) {
  for (const { rel, content } of fileEntries) {
    if (rel === OWNER_FILE_REL) continue;
    const lines = content.split("\n");
    for (let idx = 0; idx < lines.length; idx += 1) {
      if (!PI_CREATE_RE.test(lines[idx])) continue;
      const start = Math.max(0, idx - CONTEXT_LINES);
      const end = Math.min(lines.length, idx + CONTEXT_LINES);
      const context = lines.slice(start, end).join("\n");
      if (!INSTALLMENT_MARKER_RE.test(context)) continue;
      failures.push({ rel, line: idx + 1 });
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

  // GOOD: the owner file creating an installment PI (exempt) + a non-owner file
  // creating a NON-installment PI (no marker in context) → both silent.
  let f = run([
    {
      rel: OWNER_FILE_REL,
      content:
        "const pi = await stripe.paymentIntents.create({\n" +
        "  metadata: { mingla_installment_id: id },\n});\n",
    },
    {
      rel: "supabase/functions/ticket-checkout-create/index.ts",
      content: "const pi = await stripe.paymentIntents.create({ amount });\n",
    },
  ]);
  if (f.length) self.push("GOOD (owner installment PI + non-owner plain PI) wrongly flagged");

  // BAD1 (revert-style): a MANUAL charge endpoint creating an installment PI.
  f = run([
    {
      rel: "supabase/functions/charge-installment-now/index.ts",
      content:
        "const pi = await stripe.paymentIntents.create({\n" +
        "  amount,\n  metadata: { mingla_installment_id: instId },\n});\n",
    },
  ]);
  if (f.length === 0) self.push("BAD1 (manual endpoint installment PI) not flagged");

  // BAD2 (regression, different angle): the CRON endpoint creating an installment PI.
  f = run([
    {
      rel: "supabase/functions/process-scheduled-installments/index.ts",
      content:
        "// mingla_installment_id\nconst pi = await stripe.paymentIntents.create({ amount });\n",
    },
  ]);
  if (f.length === 0) self.push("BAD2 (cron endpoint installment PI) not flagged");

  if (self.length) {
    console.error("I-PROPOSED-MANUAL-INSTALLMENT-ACTION-VIA-SHARED-HELPER self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log(
    "I-PROPOSED-MANUAL-INSTALLMENT-ACTION-VIA-SHARED-HELPER self-test PASS (3/3 cases).",
  );
  process.exit(0);
}

function* walkTs(dir) {
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
      yield* walkTs(full);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) {
      yield full;
    }
  }
}

const fileEntries = [];
for (const file of walkTs(SCAN_DIR)) {
  filesScanned += 1;
  if (file === OWNER_FILE) continue;
  fileEntries.push({
    rel: relative(REPO_ROOT, file),
    content: readFileSync(file, "utf8"),
  });
}

const failures = [];
check(fileEntries, failures);
violations = failures.length;
for (const v of failures) {
  console.error(
    `✗ ${v.rel}:${v.line} — installment PaymentIntent.create must route through _shared/installments/createInstallmentPI.ts`,
  );
}

console.log(
  `I-PROPOSED-MANUAL-INSTALLMENT-ACTION-VIA-SHARED-HELPER: scanned ${filesScanned} files, ${violations} violations`,
);
process.exit(violations === 0 ? 0 : 1);
