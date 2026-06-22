#!/usr/bin/env node
/**
 * I-PROPOSED-1201-SERVICE-KEY-CANONICAL (DRAFT) — ORCH-1201.
 *
 * `public.api_health_services` is the ONE owner of the monitored-service list.
 * Every service_key the probe references (STATUS_PAGE_URLS keys + Layer-B probe
 * keys + Layer-C tile keys) MUST be a seeded row in the migration. No pseudo-row
 * (the ORCHESTRATOR-DIRECTED api_health_meta carries the digest cooldown instead
 * of a `_digest` row, so api_health_services stays pure).
 *
 * Gate:
 *   (a) migration seeds exactly 25 service rows and NO `_digest` row, and
 *   (b) every service_key string used as a probe key in logic.ts/index.ts is in
 *       the seeded set.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const failures = [];

// 1) locate the ORCH-1201 migration.
const migDir = join(root, "supabase/migrations");
const migFile = existsSync(migDir)
  ? readdirSync(migDir).find((f) => /orch_1201_api_health_hub\.sql$/.test(f))
  : null;
if (!migFile) {
  console.error("I-PROPOSED-1201-SERVICE-KEY-CANONICAL: migration *_orch_1201_api_health_hub.sql not found");
  process.exit(1);
}
const sql = readFileSync(join(migDir, migFile), "utf8");

// 2) extract seeded service_keys from the INSERT ... api_health_services VALUES block.
const seeded = new Set();
const seedBlock = sql.match(/INSERT INTO public\.api_health_services[\s\S]*?VALUES([\s\S]*?)ON CONFLICT/);
if (!seedBlock) {
  failures.push("migration: could not find api_health_services seed INSERT.");
} else {
  const tupleRe = /\(\s*'([a-z0-9_]+)'/g;
  let t;
  while ((t = tupleRe.exec(seedBlock[1])) !== null) seeded.add(t[1]);
}

if (seeded.has("_digest")) {
  failures.push("migration: `_digest` pseudo-row found in api_health_services — digest cooldown must live in api_health_meta (ORCHESTRATOR-DIRECTED).");
}
if (seeded.size !== 25) {
  failures.push(`migration: expected exactly 25 seeded services, found ${seeded.size}.`);
}

// 3) extract probe keys used in the edge fn (STATUS_PAGE_URLS + probe tuples + tiles).
const probeKeys = new Set();
const collect = (file) => {
  const p = join(root, file);
  if (!existsSync(p)) return;
  const src = readFileSync(p, "utf8");
  // STATUS_PAGE_URLS keys + recordApiCall/synthRow/checkRows service_key literals.
  const keyRe = /\bservice_key\s*:\s*["']([a-z0-9_]+)["']/g;
  let k;
  while ((k = keyRe.exec(src)) !== null) probeKeys.add(k[1]);
  // STATUS_PAGE_URLS object keys (key: "https://...")
  const mapRe = /^\s*([a-z0-9_]+)\s*:\s*["']https:\/\/[^"']*status[^"']*["']/gim;
  let mm;
  while ((mm = mapRe.exec(src)) !== null) probeKeys.add(mm[1]);
  // probe tuple keys: ["key", probeFn, ...]
  const tupRe = /\[\s*["']([a-z0-9_]+)["']\s*,\s*(?:probe|\(\)\s*=>)/g;
  let tp;
  while ((tp = tupRe.exec(src)) !== null) probeKeys.add(tp[1]);
};
collect("supabase/functions/api-health-probe/logic.ts");
collect("supabase/functions/api-health-probe/index.ts");

for (const key of probeKeys) {
  if (!seeded.has(key)) {
    failures.push(`probe references service_key '${key}' not seeded in api_health_services.`);
  }
}

if (failures.length > 0) {
  console.error("I-PROPOSED-1201-SERVICE-KEY-CANONICAL gate failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log(`I-PROPOSED-1201-SERVICE-KEY-CANONICAL gate passed (${seeded.size} services, ${probeKeys.size} probe keys ⊆ seeded).`);
