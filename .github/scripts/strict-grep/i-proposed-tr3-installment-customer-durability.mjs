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
 * `--self-test` proves fail-on-revert (mirrors i-1272-identity-admin-read.mjs):
 * the pure `check(fileEntries, failures)` is exercised with a GOOD fixture
 * (incl. an allowlisted del → silent, for specificity) and ≥2 DISTINCT BAD
 * fixtures (sensitivity). The disk-walking main path feeds the SAME
 * `check(...)`; behavior-preserving refactor.
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

/**
 * Pure verdict. `fileEntries` = [{ rel, content }] (rel = repo-relative path
 * for reporting). Applies the allowlist + precheck exemptions here so the
 * self-test can prove an allowlisted del stays silent. Pushes one violation
 * record per offending call site into `failures`.
 */
function check(fileEntries, failures) {
  for (const { rel, content } of fileEntries) {
    const lines = content.split("\n");
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
        failures.push({ rel, line: i + 1, name, lineText: line.trim() });
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────── self-test
if (process.argv.includes("--self-test")) {
  const self = [];

  // GOOD: an allowlisted del (silent) + a clean file with no del/detach.
  const goodEntries = [
    {
      rel: "supabase/functions/erase/index.ts",
      content:
        "// orch-strict-grep-allow tr3-installment-customer-durability — GDPR erase after schedule complete\n" +
        "await stripe.customers.del(customerId);\n",
    },
    {
      rel: "supabase/functions/list/index.ts",
      content: "await stripe.charges.list({ limit: 10 });\n",
    },
  ];
  let f = [];
  check(goodEntries, f);
  if (f.length) {
    self.push("GOOD fixture wrongly flagged: " + f.map((v) => `${v.rel}:${v.line}`).join("; "));
  }

  // BAD1 (revert-style): a stripe.customers.del( with no allowlist/precheck → fires.
  const bad1 = [
    {
      rel: "supabase/functions/cleanup/index.ts",
      content: "await stripe.customers.del(customerId);\n",
    },
  ];
  f = [];
  check(bad1, f);
  if (f.length === 0) self.push("BAD1 (stripe.customers.del without allowlist) not flagged");

  // BAD2 (regression, different angle): a stripe.paymentMethods.detach( with no
  // allowlist/precheck → fires.
  const bad2 = [
    {
      rel: "supabase/functions/revoke/index.ts",
      content: "await stripe.paymentMethods.detach(paymentMethodId);\n",
    },
  ];
  f = [];
  check(bad2, f);
  if (f.length === 0) self.push("BAD2 (stripe.paymentMethods.detach without allowlist) not flagged");

  if (self.length) {
    console.error("I-PROPOSED-TR3-INSTALLMENT-CUSTOMER-DURABILITY self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("I-PROPOSED-TR3-INSTALLMENT-CUSTOMER-DURABILITY self-test PASS (3/3 cases).");
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────── main path
let filesScanned = 0;
const fileEntries = [];
for (const file of walkTs(SCAN_DIR)) {
  filesScanned += 1;
  fileEntries.push({ rel: relative(REPO_ROOT, file), content: readFileSync(file, "utf8") });
}

const failures = [];
check(fileEntries, failures);

for (const v of failures) {
  console.error(
    `✗ ${v.rel}:${v.line} — ${v.name} call without installment-pending precheck or allowlist`,
  );
  console.error(`    > ${v.lineText}`);
  console.error(
    `    fix: either add the precheck SQL comment within 10 lines above, OR add allowlist:`,
  );
  console.error(`    // ${ALLOWLIST_TAG} — <reason>`);
}

console.log(
  `I-PROPOSED-TR3-INSTALLMENT-CUSTOMER-DURABILITY: scanned ${filesScanned} files, ${failures.length} violations`,
);
process.exit(failures.length === 0 ? 0 : 1);
