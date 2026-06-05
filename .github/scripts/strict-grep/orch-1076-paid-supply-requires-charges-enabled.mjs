#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-1076 strict-grep gate — paid buyer-supply suppression.
 *
 * Enforces invariant I-PAID-SUPPLY-REQUIRES-CHARGES-ENABLED: every buyer-facing
 * SUPPLY RPC body MUST gate paid offerings on Stripe readiness via the canonical
 * `pg_brand_can_charge(` predicate. This is the serve-time mirror of ORCH-1075's
 * publish-time guards (I-PAID-PUBLISH-REQUIRES-CHARGES-ENABLED) and the checkout
 * 409 (ticket-checkout-create:607) — all three layers enforce the identical
 * rule (Constitution #13: the same rules in generation and serving).
 *
 * Modeled byte-for-byte on orch-1075-paid-publish-integrity-guards.mjs: for each
 * RPC, find the LATEST migration that defines it (grep `CREATE OR REPLACE
 * FUNCTION public.<name>` across supabase/migrations sorted descending, first
 * hit) and assert the readiness marker is present in that defining migration's
 * sliced function body. If a future migration supersedes any of these RPCs and
 * drops the marker, this gate fails (fails-on-revert intent).
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

// The five buyer-facing supply RPCs that must carry the readiness marker.
const SUPPLY_RPCS = [
  "pg_eligible_experiences_for_deck",
  "pg_brand_experiences_for_place",
  "pg_public_experiences_by_brand",
  "pg_public_brand_upcoming",
  "pg_public_trips_by_brand",
];

const READINESS_MARKER = "pg_brand_can_charge(";

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

function checkRpc(files, fnName) {
  const latest = findLatestDefining(files, fnName);
  if (latest === null) {
    console.error(
      `ORCH-1076 FAIL: no migration defines \`${fnName}\`. Expected the latest buyer-supply RPC migration.`,
    );
    return false;
  }
  const fnBody = sliceFunctionBody(latest.body, fnName);
  if (fnBody === null) {
    console.error(
      `ORCH-1076 FAIL: could not slice \`${fnName}\` body from ${latest.name}.`,
    );
    return false;
  }
  if (!fnBody.includes(READINESS_MARKER)) {
    console.error(
      `ORCH-1076 FAIL: latest definition of \`${fnName}\` (${latest.name}) is missing the readiness marker \`${READINESS_MARKER}\`. A paid buyer-supply path must gate on Stripe readiness (pg_brand_can_charge). Restore the ORCH-1076 I-PAID-SUPPLY-REQUIRES-CHARGES-ENABLED gate or update this gate if the architecture intentionally changed.`,
    );
    return false;
  }
  console.log(`OK   [${fnName}] readiness marker present in ${latest.name}`);
  return true;
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
  for (const fn of SUPPLY_RPCS) {
    if (!checkRpc(files, fn)) allOk = false;
  }

  if (!allOk) {
    console.error(
      "ORCH-1076 paid-supply-requires-charges-enabled gate FAILED. See offenders above.",
    );
    process.exit(1);
  }
  console.log(
    "ORCH-1076 paid-supply-requires-charges-enabled gate passed (all five buyer-supply RPCs carry the pg_brand_can_charge readiness marker).",
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
    "CREATE OR REPLACE FUNCTION public.foo()\nBEGIN pg_brand_can_charge( END\n" +
    "CREATE OR REPLACE FUNCTION public.bar()\nBEGIN nothing END\n";
  const fooBody = sliceFunctionBody(multi, "foo");
  const barBody = sliceFunctionBody(multi, "bar");
  expect(
    fooBody.includes(READINESS_MARKER),
    "slice(foo) contains its own marker",
  );
  expect(
    !barBody.includes(READINESS_MARKER),
    "slice(bar) does NOT bleed foo's marker",
  );

  // A body WITH the marker passes; a body WITHOUT it fails.
  const bodyWith =
    "CREATE OR REPLACE FUNCTION public.x()\n ... OR public.pg_brand_can_charge(e.brand_id) ...\n";
  const bodyWithout =
    "CREATE OR REPLACE FUNCTION public.x()\n ... no readiness gate here ...\n";
  expect(
    bodyWith.includes(READINESS_MARKER),
    "with-marker fixture has the readiness marker",
  );
  expect(
    !bodyWithout.includes(READINESS_MARKER),
    "without-marker fixture lacks the readiness marker",
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
