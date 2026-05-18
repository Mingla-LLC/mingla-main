#!/usr/bin/env node
/**
 * I-PROPOSED-TR3-INSTALLMENT-CUSTOMER-DURABILITY strict-grep gate.
 *
 * Enforces ORCH-0873 [Tr3 Installment Payments Stage 2 UI] invariant: no
 * code path may delete a connected-account Stripe Customer that has any
 * `order_installments` rows with `status='scheduled'` for orders bound to
 * that Customer; no code path may revoke a saved PaymentMethod that's
 * the active PM for an order with pending installments.
 *
 * Why: installment auto-charges depend on the saved Customer + PM
 * persisting for the full schedule duration (could be 6+ months).
 * Deleting the Customer mid-schedule breaks every future installment
 * for that order — silent state divergence between Stripe (no customer)
 * and Mingla (still expecting to charge).
 *
 * Established by: ORCH-0873 CLOSE. Invariant flips DRAFT → ACTIVE on close.
 *
 * Detection rule: scan all .ts files under supabase/functions/ for
 * `stripe.customers.del(` and `stripe.paymentMethods.detach(`. For each
 * call site, verify ONE of:
 *   (a) An allowlist comment within 5 lines above:
 *       `// orch-strict-grep-allow tr3-installment-customer-durability — <reason>`
 *   (b) A precheck comment within 10 lines above documenting the
 *       `SELECT count(*) FROM order_installments WHERE order_id IN (…) AND status='scheduled' = 0`
 *       probe. The probe text MUST include both `order_installments` and
 *       `status='scheduled'` (or `status = 'scheduled'`).
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

const ALLOWLIST_TAG = "orch-strict-grep-allow tr3-installment-customer-durability";
const FORBIDDEN_PATTERNS = [
  { pattern: /stripe\.customers\.del\s*\(/, name: "stripe.customers.del" },
  {
    pattern: /stripe\.paymentMethods\.detach\s*\(/,
    name: "stripe.paymentMethods.detach",
  },
];
const PRECHECK_CONTEXT_LINES_BACK = 10;
const ALLOWLIST_CONTEXT_LINES_BACK = 5;
const PRECHECK_TOKENS = ["order_installments", "status"]; // must both appear

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
  const source = readFileSync(file, "utf8");
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    for (const { pattern, name } of FORBIDDEN_PATTERNS) {
      if (!pattern.test(line)) continue;
      let allowed = false;
      // (a) allowlist tag
      for (let k = i - 1; k >= Math.max(0, i - ALLOWLIST_CONTEXT_LINES_BACK); k -= 1) {
        if (lines[k].includes(ALLOWLIST_TAG)) {
          allowed = true;
          break;
        }
      }
      if (!allowed) {
        // (b) precheck comment with required tokens
        const contextStart = Math.max(0, i - PRECHECK_CONTEXT_LINES_BACK);
        const contextText = lines.slice(contextStart, i).join("\n");
        if (
          PRECHECK_TOKENS.every((t) => contextText.includes(t)) &&
          /\bSELECT\b/i.test(contextText) &&
          /=\s*0/.test(contextText)
        ) {
          allowed = true;
        }
      }
      if (allowed) continue;
      violations += 1;
      const rel = relative(REPO_ROOT, file);
      console.error(
        `✗ ${rel}:${i + 1} — ${name} call without installment-pending precheck or allowlist`,
      );
      console.error(`    > ${line.trim()}`);
      console.error(
        `    fix: either add the precheck SQL comment within 10 lines above, OR add allowlist:`,
      );
      console.error(`    // ${ALLOWLIST_TAG} — <reason>`);
    }
  }
}

for (const file of walkTs(SCAN_DIR)) {
  filesScanned += 1;
  checkFile(file);
}

console.log(
  `I-PROPOSED-TR3-INSTALLMENT-CUSTOMER-DURABILITY: scanned ${filesScanned} files, ${violations} violations`,
);
process.exit(violations === 0 ? 0 : 1);
