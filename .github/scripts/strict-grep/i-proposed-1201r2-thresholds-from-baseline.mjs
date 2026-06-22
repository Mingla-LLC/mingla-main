#!/usr/bin/env node
/**
 * I-PROPOSED-1201R2-THRESHOLDS-FROM-BASELINE (DRAFT) — ORCH-1201-R2.
 *
 * Alert thresholds MUST be the REAL live baselines (2026-06-22), never invented.
 * Asserts:
 *  (a) the R2 migration seeds the exact baseline numbers — twilio warn 25,
 *      cloudinary warn 80 / crit 100, pexels warn 2500, ticketmaster warn 500;
 *  (b) NO contradicting hardcoded default survives in index.ts evaluateBalance —
 *      no `def 20` twilio min-balance, no `def 10` cloudinary pct-REMAINING math,
 *      no `usage/limit` remaining-percent computation (the old D4 logic).
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const failures = [];

const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

// (a) migration baselines.
const migDir = join(root, "supabase/migrations");
const migFile = existsSync(migDir)
  ? readdirSync(migDir).find((f) => /orch_1201_r2_api_health_classes\.sql$/.test(f))
  : null;
if (!migFile) {
  failures.push("migration *_orch_1201_r2_api_health_classes.sql not found");
} else {
  const sql = readFileSync(join(migDir, migFile), "utf8");
  const expect = [
    { key: "twilio", re: /WHERE\s+service_key\s*=\s*'twilio'/i, must: [/'kind','twilio_balance'/, /'warn',25/, /'crit',5/] },
    { key: "cloudinary", re: /WHERE\s+service_key\s*=\s*'cloudinary'/i, must: [/'kind','cloudinary_used_pct'/, /'warn',80/, /'crit',100/] },
    { key: "pexels", re: /WHERE\s+service_key\s*=\s*'pexels'/i, must: [/'warn',2500/] },
    { key: "ticketmaster", re: /WHERE\s+service_key\s*=\s*'ticketmaster'/i, must: [/'warn',500/] },
  ];
  for (const e of expect) {
    const blockRe = new RegExp(`UPDATE\\s+public\\.api_health_services(?:(?!UPDATE\\s+public\\.api_health_services)[\\s\\S])*?${e.re.source}`, "i");
    const m = sql.match(blockRe);
    if (!m) { failures.push(`migration: no UPDATE block for '${e.key}'.`); continue; }
    for (const need of e.must) {
      if (!need.test(m[0])) failures.push(`migration: '${e.key}' missing baseline ${need}.`);
    }
  }
}

// (b) index.ts must not carry the old invented defaults / usage-limit math.
const idxPath = join(root, "supabase/functions/api-health-probe/index.ts");
if (!existsSync(idxPath)) {
  failures.push("index.ts missing");
} else {
  const code = stripComments(readFileSync(idxPath, "utf8"));
  // old twilio default of 20 (D4) must be gone.
  if (/API_HEALTH_TWILIO_MIN_BALANCE",\s*20\b/.test(code)) {
    failures.push("index.ts: old invented twilio default (20) survives — baseline is 25.");
  }
  // old cloudinary pct-REMAINING default of 10 (D4) must be gone.
  if (/API_HEALTH_CLOUDINARY_MIN_CREDIT_PCT/.test(code)) {
    failures.push("index.ts: old cloudinary MIN_CREDIT_PCT (pct-remaining) logic survives — must read used_percent.");
  }
  // old remaining-percent-from-usage/limit math must be gone.
  if (/\(\s*\(\s*limit\s*-\s*used\s*\)\s*\/\s*limit\s*\)/.test(code)) {
    failures.push("index.ts: old (limit-used)/limit remaining-percent math survives — must read credits.used_percent.");
  }
}

if (failures.length > 0) {
  console.error("I-PROPOSED-1201R2-THRESHOLDS-FROM-BASELINE gate failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("I-PROPOSED-1201R2-THRESHOLDS-FROM-BASELINE gate passed.");
