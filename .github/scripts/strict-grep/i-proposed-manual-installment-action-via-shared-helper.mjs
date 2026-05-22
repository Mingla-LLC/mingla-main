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

const PI_CREATE_RE = /paymentIntents\.create\s*\(/;
const INSTALLMENT_MARKER_RE = /mingla_installment_id/;
const CONTEXT_LINES = 24;

let filesScanned = 0;
let violations = 0;

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

for (const file of walkTs(SCAN_DIR)) {
  filesScanned += 1;
  if (file === OWNER_FILE) continue;
  const source = readFileSync(file, "utf8");
  const lines = source.split("\n");
  for (let idx = 0; idx < lines.length; idx += 1) {
    if (!PI_CREATE_RE.test(lines[idx])) continue;
    const start = Math.max(0, idx - CONTEXT_LINES);
    const end = Math.min(lines.length, idx + CONTEXT_LINES);
    const context = lines.slice(start, end).join("\n");
    if (!INSTALLMENT_MARKER_RE.test(context)) continue;
    violations += 1;
    console.error(
      `✗ ${relative(REPO_ROOT, file)}:${idx + 1} — installment PaymentIntent.create must route through _shared/installments/createInstallmentPI.ts`,
    );
  }
}

console.log(
  `I-PROPOSED-MANUAL-INSTALLMENT-ACTION-VIA-SHARED-HELPER: scanned ${filesScanned} files, ${violations} violations`,
);
process.exit(violations === 0 ? 0 : 1);
