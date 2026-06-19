#!/usr/bin/env node
/**
 * ORCH-1167 [event-page-canonical] —
 * I-PROPOSED-1167-CITY-LEVEL-MAP-NO-EXACT-PIN-WHEN-HIDDEN.
 *
 * Privacy MUST be enforced SERVER-SIDE in the pg_public_event_by_slug RPC: when the
 * event hides the street until ticket purchase, the anon payload must OMIT the exact
 * address + location_geo and return ONLY city + city_geo (so the body draws a
 * city-level map with no exact pin). This gate asserts the migration that defines
 * the RPC carries that gate.
 *
 * Fails if supabase/migrations/*_pg_public_event_by_slug.sql:
 *   (a) is missing, OR
 *   (b) does not gate 'address' on hide_address_until_ticket (returning NULL), OR
 *   (c) does not gate 'locationGeo' on hide_address_until_ticket, OR
 *   (d) does not return cityGeo / city_geo (the privacy-safe centroid).
 *
 * Self-test proves a non-gated RPC body trips the gate.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? join(process.cwd(), "..")
  : process.cwd();

const MIG_DIR = "supabase/migrations";

function findRpcMigration() {
  const dir = join(root, MIG_DIR);
  if (!existsSync(dir)) return null;
  const hit = readdirSync(dir).find((f) =>
    /pg_public_event_by_slug\.sql$/.test(f),
  );
  return hit === undefined ? null : join(dir, hit);
}

function check(sql, label) {
  const failures = [];
  // (b) address gated on hide_address_until_ticket → NULL.
  if (
    !/'address'\s*,\s*CASE[\s\S]*?hide_address_until_ticket[\s\S]*?NULL/.test(sql)
  ) {
    failures.push(
      `${label}: 'address' is not gated NULL on hide_address_until_ticket — the ` +
        "RPC could leak the street to an anon viewer.",
    );
  }
  // (c) locationGeo gated on hide_address_until_ticket.
  if (
    !/'locationGeo'\s*,\s*CASE[\s\S]*?hide_address_until_ticket/.test(sql)
  ) {
    failures.push(
      `${label}: 'locationGeo' (exact pin) is not gated on ` +
        "hide_address_until_ticket — the exact pin could leak.",
    );
  }
  // (d) the city-level centroid must be returned.
  if (!/'cityGeo'/.test(sql) || !/city_geo/.test(sql)) {
    failures.push(
      `${label}: the privacy-safe cityGeo / city_geo centroid is not returned.`,
    );
  }
  return failures;
}

function runSelfTest() {
  const good = `
    'address', CASE WHEN ev.hide_address_until_ticket THEN NULL ELSE ev.addr END,
    'locationGeo', CASE WHEN ev.hide_address_until_ticket OR ev.location_geo IS NULL THEN NULL ELSE x END,
    'cityGeo', CASE WHEN ev.city_geo IS NULL THEN NULL ELSE y END,
  `;
  const bad = `
    'address', ev.addr,
    'locationGeo', ev.location_geo,
  `;
  const goodPasses = check(good, "synthetic-good").length === 0;
  const badFails = check(bad, "synthetic-bad").length > 0;
  if (!goodPasses) {
    console.error("SELF-TEST FAIL: gated RPC wrongly tripped the gate.");
    process.exit(1);
  }
  if (!badFails) {
    console.error("SELF-TEST FAIL: ungated RPC did not trip the gate.");
    process.exit(1);
  }
  console.log("ORCH-1167 city-level-map-no-exact-pin-when-hidden gate SELF-TEST PASS.");
  process.exit(0);
}

if (process.argv.includes("--self-test")) {
  runSelfTest();
} else {
  const path = findRpcMigration();
  if (path === null) {
    console.error(
      "ORCH-1167 city-level-map gate FAILED: no *_pg_public_event_by_slug.sql " +
        "migration found.",
    );
    process.exit(1);
  }
  const failures = check(readFileSync(path, "utf8"), "pg_public_event_by_slug migration");
  if (failures.length > 0) {
    console.error("\nORCH-1167 city-level-map-no-exact-pin-when-hidden gate FAILED:\n");
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log("ORCH-1167 city-level-map-no-exact-pin-when-hidden gate PASS.");
}
