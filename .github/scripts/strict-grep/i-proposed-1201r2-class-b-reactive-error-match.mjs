#!/usr/bin/env node
/**
 * I-PROPOSED-1201R2-CLASS-B-REACTIVE-ERROR-MATCH (DRAFT) — ORCH-1201-R2.
 *
 * Class-B services are metered with NO balance API; the only truthful signal is
 * the documented depletion error on real traffic. Asserts:
 *  (a) every Class-B seed row in the R2 migration has a 'reactive' matcher OR a
 *      'header' signal in depletion_signal;
 *  (b) the CLASS_B_DEPLETION const in logic.ts has an entry for each of
 *      openai/gemini/serper/resend/pexels/ticketmaster/mapbox/google_places;
 *  (c) the openai entry's match is exactly 'insufficient_quota' (NOT
 *      'rate_limit_exceeded') — the load-bearing disambiguation.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const failures = [];

// (a) migration: each Class-B UPDATE block has reactive or header.
const migDir = join(root, "supabase/migrations");
const migFile = existsSync(migDir)
  ? readdirSync(migDir).find((f) => /orch_1201_r2_api_health_classes\.sql$/.test(f))
  : null;
if (!migFile) {
  failures.push("migration *_orch_1201_r2_api_health_classes.sql not found");
} else {
  const sql = readFileSync(join(migDir, migFile), "utf8");
  const classBKeys = ["openai", "gemini", "serper", "resend", "pexels", "ticketmaster", "mapbox", "google_places"];
  for (const key of classBKeys) {
    const blockRe = new RegExp(
      `UPDATE\\s+public\\.api_health_services(?:(?!UPDATE\\s+public\\.api_health_services)[\\s\\S])*?WHERE\\s+service_key\\s*=\\s*'${key}'`,
      "i",
    );
    const m = sql.match(blockRe);
    if (!m) {
      failures.push(`migration: no UPDATE block for Class-B service '${key}'.`);
      continue;
    }
    const block = m[0];
    if (!/monitoring_class\s*=\s*'B'/.test(block)) {
      failures.push(`migration: '${key}' must be monitoring_class 'B'.`);
    }
    if (!/'reactive'/.test(block) && !/'header'/.test(block)) {
      failures.push(`migration: Class-B '${key}' has neither a 'reactive' matcher nor a 'header' signal.`);
    }
  }
}

// (b) + (c) logic.ts CLASS_B_DEPLETION.
const logicPath = join(root, "supabase/functions/api-health-probe/logic.ts");
if (!existsSync(logicPath)) {
  failures.push("logic.ts missing");
} else {
  const src = readFileSync(logicPath, "utf8");
  const m = src.match(/CLASS_B_DEPLETION[\s\S]*?=\s*\{([\s\S]*?)\n\};/);
  if (!m) {
    failures.push("logic.ts: CLASS_B_DEPLETION const not found.");
  } else {
    const block = m[1];
    for (const key of ["openai", "gemini", "serper", "resend", "pexels", "ticketmaster", "mapbox", "google_places"]) {
      if (!new RegExp(`\\b${key}\\s*:`).test(block)) {
        failures.push(`logic.ts CLASS_B_DEPLETION: missing entry for '${key}'.`);
      }
    }
    // openai must match insufficient_quota, NOT rate_limit_exceeded.
    const openaiLine = block.match(/openai\s*:\s*\{[^}]*\}/);
    if (!openaiLine || !/match:\s*"insufficient_quota"/.test(openaiLine[0])) {
      failures.push("logic.ts CLASS_B_DEPLETION: openai match must be exactly 'insufficient_quota'.");
    }
    if (openaiLine && /rate_limit_exceeded/.test(openaiLine[0])) {
      failures.push("logic.ts CLASS_B_DEPLETION: openai must NOT key off 'rate_limit_exceeded'.");
    }
  }
  if (!/function\s+matchClassBDepletion/.test(src)) {
    failures.push("logic.ts: matchClassBDepletion matcher function missing.");
  }
}

if (failures.length > 0) {
  console.error("I-PROPOSED-1201R2-CLASS-B-REACTIVE-ERROR-MATCH gate failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("I-PROPOSED-1201R2-CLASS-B-REACTIVE-ERROR-MATCH gate passed.");
