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
// Repo-relative form of the owner file (POSIX) — the exemption lives inside the
// pure check(...) so it is behavior-preserving AND self-testable.
const OWNER_FILE_REL =
  "supabase/functions/_shared/installments/createInstallmentPI.ts";

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

/**
 * Pure verdict. `fileEntries` = [{ rel, content }] with `rel` the repo-relative
 * POSIX path. Any file OTHER than the owner that creates a PaymentIntent whose
 * ±CONTEXT_LINES context mentions `mingla_installment_id` is a violation unless
 * an allowlist tag sits within 5 lines ABOVE the call. Pushes one
 * { rel, line, lineText } record per offending call site into `failures`.
 * Behavior-preserving refactor of the original checkFile logic.
 */
function check(fileEntries, failures) {
  for (const { rel, content } of fileEntries) {
    if (rel === OWNER_FILE_REL) continue;
    const lines = content.split("\n");
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
      failures.push({ rel, line: i + 1, lineText: lines[i].trim() });
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
  // creating a NON-installment PI (no marker) → both silent.
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

  // BAD1 (revert-style): a non-owner file with mingla_installment_id near a PI
  // create and NO allowlist → fires.
  f = run([
    {
      rel: "supabase/functions/charge-installment-now/index.ts",
      content:
        "const pi = await stripe.paymentIntents.create({\n" +
        "  amount,\n  metadata: { mingla_installment_id: instId },\n});\n",
    },
  ]);
  if (f.length === 0) self.push("BAD1 (non-owner installment PI, no allowlist) not flagged");

  // BAD2 (regression, different angle): an allowlist comment placed TOO FAR (>5
  // lines above the PI create) — must STILL fire.
  f = run([
    {
      rel: "supabase/functions/manual-charge/index.ts",
      content:
        "// orch-strict-grep-allow tr3-installment-pi-via-cron-owner — reason\n" +
        "// filler\n// filler\n// filler\n// filler\n// filler\n" +
        "// mingla_installment_id\n" +
        "const pi = await stripe.paymentIntents.create({ amount });\n",
    },
  ]);
  if (f.length === 0) self.push("BAD2 (allowlist placed too far — >5 lines above) not flagged");

  // SPECIFICITY: a correctly-placed allowlist (within 5 lines above) stays silent.
  f = run([
    {
      rel: "supabase/functions/manual-charge/index.ts",
      content:
        "// mingla_installment_id\n" +
        "// orch-strict-grep-allow tr3-installment-pi-via-cron-owner — sanctioned manual retry\n" +
        "const pi = await stripe.paymentIntents.create({ amount });\n",
    },
  ]);
  if (f.length) self.push("correctly-placed allowlist wrongly flagged");

  if (self.length) {
    console.error("I-PROPOSED-TR3-INSTALLMENT-PI-VIA-CRON-OWNER self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log(
    "I-PROPOSED-TR3-INSTALLMENT-PI-VIA-CRON-OWNER self-test PASS (4/4 cases).",
  );
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────── main path
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
    `✗ ${v.rel}:${v.line} — installment PaymentIntent.create outside the owner file (_shared/installments/createInstallmentPI.ts)`,
  );
  console.error(`    > ${v.lineText}`);
  console.error(
    `    fix: route through _shared/installments/createInstallmentPI.ts (the documented single owner per I-PROPOSED-MANUAL-INSTALLMENT-ACTION-VIA-SHARED-HELPER)`,
  );
  console.error(
    `    OR add allowlist comment within 5 lines above: // ${ALLOWLIST_TAG} — <reason>`,
  );
}

console.log(
  `I-PROPOSED-TR3-INSTALLMENT-PI-VIA-CRON-OWNER: scanned ${filesScanned} files, ${violations} violations`,
);
process.exit(violations === 0 ? 0 : 1);
