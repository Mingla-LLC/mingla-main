#!/usr/bin/env node
/**
 * I-PROPOSED-1201R2-PROCESSOR-NO-BALANCE-ALERT (DRAFT) — ORCH-1201-R2.
 *
 * Payment processors (Stripe/Paystack) MUST NEVER emit a balance/credit alert.
 * Their "balance" is settled customer funds, not API credit. The alert signal is
 * reachability + auth + account restriction + webhook delivery ONLY.
 *
 * Asserts:
 *  (a) the R2 migration sets stripe/paystack rows with NO depletion_signal->'balance'
 *      AND carries the processor verify-block;
 *  (b) index.ts evaluateBalance unconditionally returns {balanceLow:null} for
 *      stripe/paystack (no branch sets a non-null balanceLow for a processor);
 *  (c) probeStripe/probePaystack detail includes balance_display_only.
 *
 * Fails-on-revert: re-adding the old paystack balance branch (balanceLow: bal < threshold)
 * trips (b).
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const failures = [];

const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

// (a) migration: processors carry no balance signal + verify block present.
const migDir = join(root, "supabase/migrations");
const migFile = existsSync(migDir)
  ? readdirSync(migDir).find((f) => /orch_1201_r2_api_health_classes\.sql$/.test(f))
  : null;
if (!migFile) {
  failures.push("migration *_orch_1201_r2_api_health_classes.sql not found");
} else {
  const sql = readFileSync(join(migDir, migFile), "utf8");
  // every UPDATE ... WHERE service_key='stripe'/'paystack' must NOT build a 'balance' key.
  // Anchor to the LAST `UPDATE` immediately preceding the WHERE (no UPDATE in between)
  // so the block is exactly that service's statement.
  for (const key of ["stripe", "paystack"]) {
    const blockRe = new RegExp(
      `UPDATE\\s+public\\.api_health_services(?:(?!UPDATE\\s+public\\.api_health_services)[\\s\\S])*?WHERE\\s+service_key\\s*=\\s*'${key}'`,
      "i",
    );
    const m = sql.match(blockRe);
    if (!m) {
      failures.push(`migration: no UPDATE block found for processor '${key}'.`);
    } else if (/'balance'\s*,/.test(m[0])) {
      failures.push(`migration: processor '${key}' UPDATE builds a 'balance' signal — forbidden.`);
    }
  }
  if (!/processors must not carry a balance alert signal/.test(sql)) {
    failures.push("migration: processor verify-block missing.");
  }
}

// (b) + (c) index.ts.
const idxPath = join(root, "supabase/functions/api-health-probe/index.ts");
if (!existsSync(idxPath)) {
  failures.push("index.ts missing");
} else {
  const code = stripComments(readFileSync(idxPath, "utf8"));
  // evaluateBalance must short-circuit processors to null.
  if (!/serviceKey\s*===\s*"stripe"\s*\|\|\s*serviceKey\s*===\s*"paystack"/.test(code)) {
    failures.push("index.ts evaluateBalance: missing the stripe||paystack unconditional null short-circuit.");
  }
  // forbid any branch that sets a non-null balanceLow keyed off a processor key.
  const badPaystack = /serviceKey\s*===\s*"paystack"[\s\S]{0,200}?balanceLow:\s*bal\s*[<>]/;
  const badStripe = /serviceKey\s*===\s*"stripe"[\s\S]{0,200}?balanceLow:\s*bal\s*[<>]/;
  if (badPaystack.test(code)) failures.push("index.ts: a paystack balance-threshold branch (balanceLow: bal < ...) was re-introduced.");
  if (badStripe.test(code)) failures.push("index.ts: a stripe balance-threshold branch (balanceLow: bal < ...) was introduced.");
  // probeStripe/probePaystack detail must carry balance_display_only.
  if (!/balance_display_only/.test(code)) {
    failures.push("index.ts: probeStripe/probePaystack detail must carry balance_display_only.");
  }
}

if (failures.length > 0) {
  console.error("I-PROPOSED-1201R2-PROCESSOR-NO-BALANCE-ALERT gate failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("I-PROPOSED-1201R2-PROCESSOR-NO-BALANCE-ALERT gate passed.");
