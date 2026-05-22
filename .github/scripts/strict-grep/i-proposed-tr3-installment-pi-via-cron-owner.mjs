#!/usr/bin/env node
/**
 * I-PROPOSED-TR3-INSTALLMENT-PI-VIA-CRON-OWNER strict-grep gate.
 *
 * Enforces ORCH-0869 [Tr3 Installment Payments] invariant as superseded by
 * ORCH-0914: installment PaymentIntent creation may ONLY originate from
 * `_shared/installments/createInstallmentPI.ts`. Any other
 * file that creates a Stripe PaymentIntent carrying metadata
 * `mingla_installment_id` is FORBIDDEN unless allowlisted.
 *
 * Why this exists: centralising installment PI creation in one file
 * makes the idempotency-key contract, retry-cadence logic, at_risk-flip
 * logic, and dunning-email dispatch enforceable. A drift to a second
 * installment-PI creator would split the at_risk count + dunning cadence
 * between two implementations.
 *
 * Detection rule: scan all .ts files under supabase/functions/ for any
 * `paymentIntents.create(` call whose immediate context (the surrounding
 * 20 lines) contains the literal `mingla_installment_id`. The owner file
 * itself is exempt; any other file is a violation unless the call site
 * carries an allowlist comment `// orch-strict-grep-allow tr3-installment-
 * pi-via-cron-owner — <reason>` within 5 lines above the call.
 *
 * Established by: ORCH-0869 [Tr3 Installment Payments] CLOSE. Invariant
 * flips DRAFT → ACTIVE on close.
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

const SCAN_DIR = join(REPO_ROOT, "supabase", "functions");
const OWNER_FILE = join(
  REPO_ROOT,
  "supabase",
  "functions",
  "_shared",
  "installments",
  "createInstallmentPI.ts",
);

const ALLOWLIST_TAG = "orch-strict-grep-allow tr3-installment-pi-via-cron-owner";
const PI_CREATE_RE = /paymentIntents\.create\s*\(/;
const INSTALLMENT_MARKER_RE = /mingla_installment_id/;
const CONTEXT_LINES = 20;

let violations = 0;
let filesScanned = 0;

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

function checkFile(file) {
  if (file === OWNER_FILE) return;
  const source = readFileSync(file, "utf8");
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    if (!PI_CREATE_RE.test(lines[i])) continue;
    // Check the surrounding context for the installment marker.
    const start = Math.max(0, i - CONTEXT_LINES);
    const end = Math.min(lines.length, i + CONTEXT_LINES);
    const context = lines.slice(start, end).join("\n");
    if (!INSTALLMENT_MARKER_RE.test(context)) continue;
    // It's an installment-PI call site outside the owner file. Allowlist?
    let allowlisted = false;
    for (let k = i - 1; k >= Math.max(0, i - 5); k -= 1) {
      if (lines[k].includes(ALLOWLIST_TAG)) {
        allowlisted = true;
        break;
      }
    }
    if (allowlisted) continue;
    violations += 1;
    const rel = relative(REPO_ROOT, file);
    console.error(
      `✗ ${rel}:${i + 1} — installment PaymentIntent.create outside the owner file (_shared/installments/createInstallmentPI.ts)`,
    );
    console.error(`    > ${lines[i].trim()}`);
    console.error(
      `    fix: route through _shared/installments/createInstallmentPI.ts (the documented single owner per I-PROPOSED-MANUAL-INSTALLMENT-ACTION-VIA-SHARED-HELPER)`,
    );
    console.error(
      `    OR add allowlist comment within 5 lines above: // ${ALLOWLIST_TAG} — <reason>`,
    );
  }
}

for (const file of walkTs(SCAN_DIR)) {
  filesScanned += 1;
  checkFile(file);
}

console.log(
  `I-PROPOSED-TR3-INSTALLMENT-PI-VIA-CRON-OWNER: scanned ${filesScanned} files, ${violations} violations`,
);
process.exit(violations === 0 ? 0 : 1);
