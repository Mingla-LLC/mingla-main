#!/usr/bin/env node
/**
 * I-PROPOSED-FINALIZE-CALLERS-PASS-INSTALLMENT-PARAMS strict-grep gate.
 *
 * ORCH-0921: paid biz_ticket_checkout_finalize callers under
 * supabase/functions/ must pass p_installment_plan_root so trip payment-plan
 * deposits cannot silently default to non-installment finalization.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..", "..", "..");

function argValue(name) {
  const idx = process.argv.indexOf(name);
  return idx === -1 ? null : process.argv[idx + 1] ?? null;
}

const requestedScanDir = argValue("--scan-dir");
const SCAN_DIR = requestedScanDir
  ? (isAbsolute(requestedScanDir)
    ? requestedScanDir
    : resolve(process.cwd(), requestedScanDir))
  : join(REPO_ROOT, "supabase", "functions");

const FINALIZE_RPC_RE =
  /supabase\.rpc\(\s*["']biz_ticket_checkout_finalize["']/g;
const REQUIRED_PARAM_RE = /\bp_installment_plan_root\b/;
const ALLOWLIST_TAG = "orch-strict-grep-allow finalize-no-plan-root";
const CALL_CONTEXT_LINES = 30;
const ALLOWLIST_CONTEXT_LINES = 5;

let filesScanned = 0;
let callersScanned = 0;
let freeCallersSkipped = 0;
let violations = 0;

function* walkTs(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch (err) {
    console.error(
      `[i-proposed-finalize-callers-pass-installment-params] filesystem error: cannot read ${dir} - ${err.message}`,
    );
    process.exit(2);
  }

  for (const entry of entries) {
    if (
      entry === "node_modules" || entry.startsWith(".") || entry === "__tests__"
    ) continue;
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch (err) {
      console.error(
        `[i-proposed-finalize-callers-pass-installment-params] filesystem error: cannot stat ${full} - ${err.message}`,
      );
      process.exit(2);
    }

    if (st.isDirectory()) {
      yield* walkTs(full);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) {
      yield full;
    }
  }
}

function isKnownFreeCheckoutFinalize(rel, callContext) {
  return (
    rel.endsWith("supabase/functions/ticket-checkout-create/index.ts") &&
    /p_stripe_payment_intent_id\s*:\s*null\b/.test(callContext) &&
    /p_stripe_payment_method_type\s*:\s*["']free["']/.test(callContext)
  );
}

/**
 * Pure verdict. `fileEntries` = [{ rel, content }] with `rel` the repo-relative
 * POSIX path. For every biz_ticket_checkout_finalize caller that omits
 * p_installment_plan_root (and is neither allowlisted nor the known free-checkout
 * caller) pushes a { rel, line } record into `failures`. `stats` accumulates
 * callersScanned / freeCallersSkipped for the summary log. Behavior-preserving.
 */
function check(fileEntries, failures, stats) {
  for (const { rel, content } of fileEntries) {
    const lines = content.split("\n");
    const matches = content.matchAll(FINALIZE_RPC_RE);
    for (const match of matches) {
      const idx = content.slice(0, match.index ?? 0).split("\n").length - 1;
      stats.callersScanned += 1;

      const callEnd = Math.min(lines.length, idx + CALL_CONTEXT_LINES);
      const callContext = lines.slice(idx, callEnd).join("\n");
      if (REQUIRED_PARAM_RE.test(callContext)) continue;

      const allowStart = Math.max(0, idx - ALLOWLIST_CONTEXT_LINES);
      const allowEnd = Math.min(lines.length, idx + ALLOWLIST_CONTEXT_LINES + 1);
      const allowContext = lines.slice(allowStart, allowEnd).join("\n");
      if (allowContext.includes(ALLOWLIST_TAG)) continue;

      if (isKnownFreeCheckoutFinalize(rel, callContext)) {
        stats.freeCallersSkipped += 1;
        continue;
      }

      failures.push({ rel, line: idx + 1 });
    }
  }
}

// ─────────────────────────────────────────────────────────────── self-test
if (process.argv.includes("--self-test")) {
  const self = [];
  const run = (entries) => {
    const f = [];
    check(entries, f, { callersScanned: 0, freeCallersSkipped: 0 });
    return f;
  };

  // GOOD: a finalize caller that passes p_installment_plan_root → silent.
  let f = run([
    {
      rel: "supabase/functions/installment-charge/index.ts",
      content:
        'const r = await supabase.rpc("biz_ticket_checkout_finalize", {\n' +
        "  p_order_id: id,\n  p_installment_plan_root: root,\n});\n",
    },
  ]);
  if (f.length) self.push("GOOD (finalize caller passes p_installment_plan_root) wrongly flagged");

  // BAD1 (revert-style): a finalize caller omitting p_installment_plan_root.
  f = run([
    {
      rel: "supabase/functions/installment-charge/index.ts",
      content:
        'const r = await supabase.rpc("biz_ticket_checkout_finalize", {\n' +
        "  p_order_id: id,\n  p_stripe_payment_intent_id: pi,\n});\n",
    },
  ]);
  if (f.length === 0) self.push("BAD1 (finalize caller omits p_installment_plan_root) not flagged");

  // BAD2 (regression, different angle): a caller passing a DIFFERENTLY-named param
  // (typo/rename) — the required exact token is absent → fires.
  f = run([
    {
      rel: "supabase/functions/manual-finalize/index.ts",
      content:
        'const r = await supabase.rpc("biz_ticket_checkout_finalize", {\n' +
        "  p_order_id: id,\n  p_installment_root: root,\n});\n",
    },
  ]);
  if (f.length === 0) self.push("BAD2 (finalize caller passes wrong param name) not flagged");

  // SPECIFICITY: an allowlisted caller stays silent.
  f = run([
    {
      rel: "supabase/functions/manual-finalize/index.ts",
      content:
        "// orch-strict-grep-allow finalize-no-plan-root — one-off admin finalize\n" +
        'const r = await supabase.rpc("biz_ticket_checkout_finalize", { p_order_id: id });\n',
    },
  ]);
  if (f.length) self.push("allowlisted finalize caller wrongly flagged");

  // SPECIFICITY: the known free-checkout finalize (PI null + method type "free") in
  // ticket-checkout-create stays silent.
  f = run([
    {
      rel: "supabase/functions/ticket-checkout-create/index.ts",
      content:
        'const r = await supabase.rpc("biz_ticket_checkout_finalize", {\n' +
        "  p_order_id: id,\n  p_stripe_payment_intent_id: null,\n" +
        '  p_stripe_payment_method_type: "free",\n});\n',
    },
  ]);
  if (f.length) self.push("known free-checkout finalize wrongly flagged");

  if (self.length) {
    console.error("I-PROPOSED-FINALIZE-CALLERS-PASS-INSTALLMENT-PARAMS self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log(
    "I-PROPOSED-FINALIZE-CALLERS-PASS-INSTALLMENT-PARAMS self-test PASS (5/5 cases).",
  );
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────── main path
const fileEntries = [];
for (const file of walkTs(SCAN_DIR)) {
  filesScanned += 1;
  let source;
  try {
    source = readFileSync(file, "utf8");
  } catch (err) {
    console.error(
      `[i-proposed-finalize-callers-pass-installment-params] filesystem error: cannot read ${file} - ${err.message}`,
    );
    process.exit(2);
  }
  fileEntries.push({
    rel: relative(REPO_ROOT, file).replaceAll("\\", "/"),
    content: source,
  });
}

const failures = [];
const stats = { callersScanned: 0, freeCallersSkipped: 0 };
check(fileEntries, failures, stats);
callersScanned = stats.callersScanned;
freeCallersSkipped = stats.freeCallersSkipped;
violations = failures.length;

for (const v of failures) {
  console.error(
    `x ${v.rel}:${v.line} - biz_ticket_checkout_finalize caller omits p_installment_plan_root`,
  );
}

console.log(
  [
    "I-PROPOSED-FINALIZE-CALLERS-PASS-INSTALLMENT-PARAMS:",
    `scanned ${filesScanned} files,`,
    `${callersScanned} finalize callers,`,
    `${freeCallersSkipped} free caller skips,`,
    `${violations} violations`,
  ].join(" "),
);
process.exit(violations === 0 ? 0 : 1);
