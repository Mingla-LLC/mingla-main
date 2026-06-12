#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-1116 strict-grep gate — booking-gate buyer-readiness predicates stay
 * SECURITY DEFINER + locked search_path.
 *
 * Enforces the proposed invariant I-PROPOSED-BUYER-READINESS-PREDICATE-IS-DEFINER:
 * the shared buyer-readiness predicates `pg_brand_can_charge(uuid)` and
 * `pg_brands_can_charge(uuid[])` — which a logged-out (anon) or non-owner
 * authenticated BUYER calls to compute the public bookable/Get-Tickets flag from
 * the RLS-protected `stripe_connect_accounts` table — MUST be SECURITY DEFINER
 * with a locked `search_path`. If they revert to SECURITY INVOKER, RLS hides the
 * row from the buyer, the inner EXISTS sees 0 rows, and the function returns
 * false for a brand that can demonstrably charge — the revenue-blocking
 * ORCH-1116 booking-gate false-positive returns.
 *
 * Modeled byte-for-byte on orch-1076-paid-supply-requires-charges-enabled.mjs:
 * for each predicate, find the LATEST migration that defines it (grep
 * `CREATE OR REPLACE FUNCTION public.<name>` across supabase/migrations sorted
 * descending, first hit), slice that one function's body, and assert it contains
 * BOTH `SECURITY DEFINER` AND `search_path` (case-insensitive). If a future
 * migration supersedes either predicate and drops the hardening, this gate fails
 * (fails-on-revert intent) — even before the behavioral SQL test runs.
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

// The two buyer-readiness predicates that must stay SECURITY DEFINER.
const READINESS_PREDICATES = ["pg_brand_can_charge", "pg_brands_can_charge"];

const SECURITY_DEFINER_MARKER = "security definer"; // case-insensitive compare
const SEARCH_PATH_MARKER = "search_path"; // case-insensitive compare

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
 * may define multiple functions, so a marker present in a DIFFERENT function in
 * the same file doesn't falsely satisfy this predicate. Slice from the
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

/**
 * A function body carries the DEFINER hardening iff it contains BOTH
 * `SECURITY DEFINER` and `search_path` (case-insensitive).
 */
function hasDefinerHardening(fnBody) {
  const lower = fnBody.toLowerCase();
  return (
    lower.includes(SECURITY_DEFINER_MARKER) && lower.includes(SEARCH_PATH_MARKER)
  );
}

function checkPredicate(files, fnName) {
  const latest = findLatestDefining(files, fnName);
  if (latest === null) {
    console.error(
      `ORCH-1116 FAIL: no migration defines \`${fnName}\`. Expected the latest buyer-readiness predicate migration.`,
    );
    return false;
  }
  const fnBody = sliceFunctionBody(latest.body, fnName);
  if (fnBody === null) {
    console.error(
      `ORCH-1116 FAIL: could not slice \`${fnName}\` body from ${latest.name}.`,
    );
    return false;
  }
  if (!hasDefinerHardening(fnBody)) {
    const lower = fnBody.toLowerCase();
    const missing = [];
    if (!lower.includes(SECURITY_DEFINER_MARKER)) missing.push("SECURITY DEFINER");
    if (!lower.includes(SEARCH_PATH_MARKER)) missing.push("search_path");
    console.error(
      `ORCH-1116 FAIL: latest definition of \`${fnName}\` (${latest.name}) is missing ${missing.join(
        " + ",
      )}. A buyer-readiness predicate read by anon/non-owner buyers over RLS-protected stripe_connect_accounts MUST stay SECURITY DEFINER with a locked search_path, or the ORCH-1116 booking-gate RLS false-positive returns (ready brands show "finishing payment setup" with a dead Get-Tickets CTA). Restore the ORCH-1116 hardening or update this gate if the architecture intentionally changed.`,
    );
    return false;
  }
  console.log(
    `OK   [${fnName}] SECURITY DEFINER + search_path present in ${latest.name}`,
  );
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
  for (const fn of READINESS_PREDICATES) {
    if (!checkPredicate(files, fn)) allOk = false;
  }

  if (!allOk) {
    console.error(
      "ORCH-1116 booking-gate-security-definer gate FAILED. See offenders above.",
    );
    process.exit(1);
  }
  console.log(
    "ORCH-1116 booking-gate-security-definer gate passed (both buyer-readiness predicates are SECURITY DEFINER with a locked search_path).",
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

  // sliceFunctionBody isolates the named function within a multi-function file.
  const multi =
    "CREATE OR REPLACE FUNCTION public.foo()\n SECURITY DEFINER\n SET search_path = '' END\n" +
    "CREATE OR REPLACE FUNCTION public.bar()\n LANGUAGE sql END\n";
  const fooBody = sliceFunctionBody(multi, "foo");
  const barBody = sliceFunctionBody(multi, "bar");
  expect(
    hasDefinerHardening(fooBody),
    "slice(foo) carries its own SECURITY DEFINER + search_path",
  );
  expect(
    !hasDefinerHardening(barBody),
    "slice(bar) does NOT bleed foo's DEFINER hardening",
  );

  // A body WITH both markers passes; missing either fails.
  const bodyBoth =
    "CREATE OR REPLACE FUNCTION public.x()\n RETURNS boolean\n SECURITY DEFINER\n SET search_path = ''\n AS $function$ SELECT true; $function$;\n";
  const bodyNoDefiner =
    "CREATE OR REPLACE FUNCTION public.x()\n RETURNS boolean\n SET search_path = ''\n AS $function$ SELECT true; $function$;\n";
  const bodyNoSearchPath =
    "CREATE OR REPLACE FUNCTION public.x()\n RETURNS boolean\n SECURITY DEFINER\n AS $function$ SELECT true; $function$;\n";
  const bodyInvoker =
    "CREATE OR REPLACE FUNCTION public.x()\n RETURNS boolean\n LANGUAGE sql\n STABLE\n AS $$ SELECT true; $$;\n";
  expect(hasDefinerHardening(bodyBoth), "with-both-markers fixture passes");
  expect(
    !hasDefinerHardening(bodyNoDefiner),
    "missing-SECURITY-DEFINER fixture fails",
  );
  expect(
    !hasDefinerHardening(bodyNoSearchPath),
    "missing-search_path fixture fails",
  );
  expect(
    !hasDefinerHardening(bodyInvoker),
    "plain SECURITY INVOKER fixture fails (the ORCH-1116 bug shape)",
  );

  // Case-insensitivity.
  const bodyLower =
    "create or replace function public.x()\n security definer\n set search_path = ''\n";
  expect(
    hasDefinerHardening(bodyLower),
    "lowercase security-definer + search_path still passes",
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
