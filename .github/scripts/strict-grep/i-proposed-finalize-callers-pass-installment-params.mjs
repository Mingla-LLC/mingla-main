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

function isKnownFreeCheckoutFinalize(file, callContext) {
  const rel = relative(REPO_ROOT, file).replaceAll("\\", "/");
  return (
    rel.endsWith("supabase/functions/ticket-checkout-create/index.ts") &&
    /p_stripe_payment_intent_id\s*:\s*null\b/.test(callContext) &&
    /p_stripe_payment_method_type\s*:\s*["']free["']/.test(callContext)
  );
}

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

  const lines = source.split("\n");
  const matches = source.matchAll(FINALIZE_RPC_RE);
  for (const match of matches) {
    const idx = source.slice(0, match.index ?? 0).split("\n").length - 1;
    callersScanned += 1;

    const callEnd = Math.min(lines.length, idx + CALL_CONTEXT_LINES);
    const callContext = lines.slice(idx, callEnd).join("\n");
    if (REQUIRED_PARAM_RE.test(callContext)) continue;

    const allowStart = Math.max(0, idx - ALLOWLIST_CONTEXT_LINES);
    const allowEnd = Math.min(lines.length, idx + ALLOWLIST_CONTEXT_LINES + 1);
    const allowContext = lines.slice(allowStart, allowEnd).join("\n");
    if (allowContext.includes(ALLOWLIST_TAG)) continue;

    if (isKnownFreeCheckoutFinalize(file, callContext)) {
      freeCallersSkipped += 1;
      continue;
    }

    violations += 1;
    console.error(
      `x ${relative(REPO_ROOT, file)}:${
        idx + 1
      } - biz_ticket_checkout_finalize caller omits p_installment_plan_root`,
    );
  }
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
