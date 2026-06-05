#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-1075 strict-grep gate — paid-publish integrity guards.
 *
 * Enforces invariants I-PAID-PUBLISH-REQUIRES-CHARGES-ENABLED +
 * I-PAID-PUBLISH-REJECTS-PAST-DATE: every paid-publish / paid-live-edit RPC
 * body MUST gate paid offerings on (a) Stripe readiness via the canonical
 * `pg_brand_can_charge(` helper (Guard A) and (b) the offering's latest date
 * via the `offering_date_past` rejection reason (Guard B). For
 * `business_patch_event_when` ONLY Guard B applies (the RPC never writes
 * price/availability, so a paid<->free transition is impossible there — see
 * SPEC §2 refinement), so that RPC is asserted to carry the Guard B marker only.
 *
 * Modeled on orch-0792-publish-writes-event-dates.mjs: for each RPC, find the
 * LATEST migration that defines it (grep `CREATE OR REPLACE FUNCTION
 * public.<name>` across supabase/migrations sorted descending, first hit) and
 * assert the required markers are present in that defining migration. If a
 * future migration supersedes any of these RPCs and drops a guard, this gate
 * fails (fails-on-revert intent).
 *
 * Exit codes:
 *   0 — all checks pass
 *   1 — at least one check failed
 *   2 — file system error
 *
 * Self-test mode (`--self-test`) validates the marker checker against inlined
 * fixtures and exits 1 if expectations are not met.
 */

import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const migrationsDir = path.join(root, "supabase/migrations");

// RPCs that must carry BOTH guards (Guard A + Guard B).
const BOTH_GUARD_RPCS = [
  "biz_publish_experience",
  "biz_create_experience",
  "biz_update_live_experience",
  "business_publish_event_draft",
  "business_publish_trip_draft",
  "biz_update_live_trip",
];

// RPC that must carry ONLY Guard B (no Stripe guard — N/A by construction).
const GUARD_B_ONLY_RPCS = ["business_patch_event_when"];

const GUARD_A_MARKER = "pg_brand_can_charge(";
const GUARD_B_MARKER = "offering_date_past";

/**
 * Find the latest migration body that defines `public.<name>` (descending sort,
 * first hit). Returns { name, body } or null.
 */
function findLatestDefining(files, fnName) {
  const marker = `CREATE OR REPLACE FUNCTION public.${fnName}`;
  for (const f of files) {
    const body = fs.readFileSync(path.join(migrationsDir, f), "utf8");
    if (body.includes(marker)) return { name: f, body };
  }
  return null;
}

/**
 * Extract just the body of `public.<name>`'s definition within a migration that
 * may define multiple RPCs, so a marker present in a DIFFERENT function in the
 * same file doesn't falsely satisfy this RPC. We slice from the RPC's
 * `CREATE OR REPLACE FUNCTION public.<name>` to the next such CREATE (or EOF).
 */
function sliceFunctionBody(migrationBody, fnName) {
  const start = migrationBody.indexOf(
    `CREATE OR REPLACE FUNCTION public.${fnName}`,
  );
  if (start === -1) return null;
  const rest = migrationBody.slice(start + 1);
  const nextIdx = rest.indexOf("CREATE OR REPLACE FUNCTION public.");
  return nextIdx === -1
    ? migrationBody.slice(start)
    : migrationBody.slice(start, start + 1 + nextIdx);
}

function listMigrationsDescending() {
  return fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .reverse();
}

function checkRpc(files, fnName, requireGuardA) {
  const latest = findLatestDefining(files, fnName);
  if (latest === null) {
    console.error(
      `ORCH-1075 FAIL: no migration defines \`${fnName}\`. Expected the latest paid-publish RPC migration.`,
    );
    return false;
  }
  const fnBody = sliceFunctionBody(latest.body, fnName);
  if (fnBody === null) {
    console.error(
      `ORCH-1075 FAIL: could not slice \`${fnName}\` body from ${latest.name}.`,
    );
    return false;
  }
  let ok = true;
  if (requireGuardA && !fnBody.includes(GUARD_A_MARKER)) {
    console.error(
      `ORCH-1075 FAIL: latest definition of \`${fnName}\` (${latest.name}) is missing Guard A marker \`${GUARD_A_MARKER}\`. A paid publish/edit must gate on Stripe readiness (pg_brand_can_charge). Restore the ORCH-1075 guard or update this gate if the architecture intentionally changed.`,
    );
    ok = false;
  }
  if (!fnBody.includes(GUARD_B_MARKER)) {
    console.error(
      `ORCH-1075 FAIL: latest definition of \`${fnName}\` (${latest.name}) is missing Guard B marker \`${GUARD_B_MARKER}\`. A paid publish/edit must reject past-dated offerings. Restore the ORCH-1075 guard or update this gate if the architecture intentionally changed.`,
    );
    ok = false;
  }
  if (ok) {
    console.log(
      `OK   [${fnName}] guards present in ${latest.name}` +
        (requireGuardA ? " (Guard A + Guard B)" : " (Guard B only)"),
    );
  }
  return ok;
}

function run() {
  let files;
  try {
    files = listMigrationsDescending();
  } catch (err) {
    console.error(`FATAL: could not read ${migrationsDir}: ${err.message}`);
    process.exit(2);
  }

  let allOk = true;
  for (const fn of BOTH_GUARD_RPCS) {
    if (!checkRpc(files, fn, true)) allOk = false;
  }
  for (const fn of GUARD_B_ONLY_RPCS) {
    if (!checkRpc(files, fn, false)) allOk = false;
  }

  if (!allOk) {
    console.error(
      "ORCH-1075 paid-publish integrity-guards gate FAILED. See offenders above.",
    );
    process.exit(1);
  }
  console.log(
    "ORCH-1075 paid-publish integrity-guards gate passed (all paid-publish/edit RPCs carry the required guards).",
  );
  process.exit(0);
}

function runSelfTest() {
  console.log("# Self-test mode");
  let selfFails = 0;
  function expect(cond, msg) {
    if (!cond) {
      console.error(`SELF-FAIL: ${msg}`);
      selfFails += 1;
    } else {
      console.log(`SELF-OK: ${msg}`);
    }
  }

  // sliceFunctionBody isolates the named function within a multi-RPC file.
  const multi =
    "CREATE OR REPLACE FUNCTION public.foo()\nBEGIN offering_date_past END\n" +
    "CREATE OR REPLACE FUNCTION public.bar()\nBEGIN nothing END\n";
  const fooBody = sliceFunctionBody(multi, "foo");
  const barBody = sliceFunctionBody(multi, "bar");
  expect(
    fooBody.includes("offering_date_past"),
    "slice(foo) contains its own marker",
  );
  expect(
    !barBody.includes("offering_date_past"),
    "slice(bar) does NOT bleed foo's marker",
  );

  // A body missing Guard A is caught; a body with both passes.
  const bodyBoth =
    "CREATE OR REPLACE FUNCTION public.x()\n pg_brand_can_charge( offering_date_past \n";
  const bodyNoA =
    "CREATE OR REPLACE FUNCTION public.x()\n offering_date_past only \n";
  expect(
    bodyBoth.includes(GUARD_A_MARKER) && bodyBoth.includes(GUARD_B_MARKER),
    "both-guards fixture has both markers",
  );
  expect(
    !bodyNoA.includes(GUARD_A_MARKER) && bodyNoA.includes(GUARD_B_MARKER),
    "missing-Guard-A fixture lacks Guard A marker",
  );

  if (selfFails > 0) {
    console.error(`SELF-TEST FAILED (${selfFails} expectation(s))`);
    process.exit(1);
  }
  console.log("SELF-TEST PASSED");
  process.exit(0);
}

if (process.argv.includes("--self-test")) {
  runSelfTest();
} else {
  run();
}
