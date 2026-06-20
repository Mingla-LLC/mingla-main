#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-1163 [rsvp-shared-body] — I-PROPOSED-1163-RSVP-ONE-READ-PATH.
 *
 * ONE canonical anon read path fills the shared RsvpOfferingBody props on every
 * surface: pg_public_rsvp_by_slug (event_type='rsvp', RETURNS json, granted to
 * anon+authenticated). The RPC enforces address privacy SERVER-SIDE — it NULLs the
 * exact address/location_geo when the street is hidden and returns only city +
 * cityGeo. The consumer hook reads through this same RPC (no forked SQL).
 *
 * Structural source-string gate. FAIL-ON-REVERT: drop the privacy block, the grant,
 * the rsvp event_type filter, or the hook's rpc call and a check fails.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

const read = (rel) => {
  try {
    return fs.readFileSync(path.join(repoRoot, rel), "utf8");
  } catch (error) {
    console.error(`Cannot read ${rel}: ${error.message}`);
    process.exit(2);
  }
};

const checks = [];
const check = (name, pass, detail) => checks.push({ name, pass, detail });

const mig = read(
  "supabase/migrations/20261016000000_orch_1163_pg_public_rsvp_by_slug.sql",
);
const hook = read("app-mobile/src/hooks/usePublicRsvpBySlug.ts");

check(
  "T1 migration defines public.pg_public_rsvp_by_slug",
  /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.pg_public_rsvp_by_slug\b/.test(
    mig,
  ),
  "migration must CREATE FUNCTION public.pg_public_rsvp_by_slug",
);
check(
  "T2 RPC RETURNS json",
  /RETURNS\s+json\b/.test(mig),
  "pg_public_rsvp_by_slug must RETURN json",
);
check(
  "T3 RPC scoped to event_type = 'rsvp'",
  /event_type\s*=\s*'rsvp'/.test(mig),
  "the RPC must filter event_type = 'rsvp' (RSVP rows only)",
);
check(
  "T4 GRANT EXECUTE TO anon, authenticated",
  /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.pg_public_rsvp_by_slug\([^)]*\)\s+TO\s+anon,\s*authenticated/.test(
    mig,
  ),
  "the RPC must GRANT EXECUTE ... TO anon, authenticated",
);
// Match WITHIN a single CASE…END (the `(?:(?!END)[\s\S])*?` guard forbids the lazy
// span from bleeding past this CASE's END into the NEXT field's CASE). Without it
// the address regex could borrow the locationGeo CASE's NULL and pass spuriously.
const caseNullsOn = (field) =>
  new RegExp(
    `'${field}',\\s*CASE(?:(?!END)[\\s\\S])*?hide_address_until_ticket(?:(?!END)[\\s\\S])*?THEN\\s+NULL`,
  );
check(
  "T5 server-side address privacy block (hide_address_until_ticket + NULL address/location_geo)",
  mig.includes("hide_address_until_ticket") &&
    caseNullsOn("address").test(mig) &&
    caseNullsOn("locationGeo").test(mig),
  "the RPC must NULL the exact address AND locationGeo (each within its own CASE) when hide_address_until_ticket",
);
check(
  "T6 city-level cityGeo still returned (privacy-safe geo)",
  /'cityGeo'/.test(mig),
  "the RPC must still return cityGeo (city-level centroid) when the street is hidden",
);
check(
  "T7 consumer hook reads through the SAME RPC (no forked SQL)",
  /supabase\.rpc\(\s*["']pg_public_rsvp_by_slug["']/.test(hook),
  "usePublicRsvpBySlug.ts must call supabase.rpc(\"pg_public_rsvp_by_slug\", ...)",
);

const failed = checks.filter((c) => !c.pass);
for (const result of checks) {
  console.log(`${result.pass ? "PASS" : "FAIL"} ${result.name}`);
  if (!result.pass) console.log(`  ${result.detail}`);
}
if (failed.length > 0) {
  console.error(
    `\nORCH-1163 rsvp-one-read-path gate failed: ${failed.length} check(s) failed.`,
  );
  process.exit(1);
}
console.log("\nORCH-1163 rsvp-one-read-path gate: PASS");
