#!/usr/bin/env node
/**
 * #2592 — `ari_cert_begin_run` and `ari_cert_finalize_run` must pin the SAME
 * reviewed requirement-set digest.
 *
 * `requirements_digest` is one contract with two halves: `ari_cert_begin_run`
 * STAMPS it onto a run, and `ari_cert_finalize_run` CHECKS it at the end. When
 * they disagree, every run created through the canonical entry point dies at
 * `ari_cert_requirements_digest_mismatch` regardless of the evidence it
 * collected — certification is a dead path, and nothing else reports it.
 *
 * That is not hypothetical. It happened twice:
 *   20270504002060 (#2060)  29b71dbe…  set in BOTH functions — agreed
 *   20270505001973 (#1973)  5e06801c…  replaced ONLY the finalizer
 *   20270521001978 (#1978)  be0add47…  replaced ONLY the finalizer
 * Production ran with begin_run on `29b71dbe…` and the finalizer on
 * `5e06801c…` from 2026-08-20 until #2592.
 *
 * NEITHER LITERAL IS HARDCODED HERE, on purpose. The gate reads every
 * migration, finds the LAST one that defines each function, and compares what
 * those two files actually say. A future issue is free to move the requirement
 * set to a new reviewed value — this gate keeps passing as long as it moves
 * BOTH halves, and fails the moment it moves only one.
 *
 * The digest is deliberately NOT computed from
 * `public.ari_cert_capability_requirements` at runtime: the literal exists to
 * pin the requirement set to a value a human reviewed, so deriving both sides
 * from the table would let anyone who mutates the table satisfy the check by
 * construction.
 *
 * Usage:
 *   node .github/scripts/strict-grep/issue-2592-ari-cert-requirements-digest-parity.mjs --self-test
 *   node .github/scripts/strict-grep/issue-2592-ari-cert-requirements-digest-parity.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const MIGRATIONS_DIR = "supabase/migrations";
const SHA256_LITERAL = /'([0-9a-f]{64})'/g;

const BEGIN_FN = "public.ari_cert_begin_run";
const FINALIZE_FN = "public.ari_cert_finalize_run";

/** Every migration, in applied (version-prefix) order. */
export function readLive() {
  const dir = path.join(ROOT, MIGRATIONS_DIR);
  const migrations = fs.readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => ({
      name,
      version: name.split("_")[0],
      source: fs.readFileSync(path.join(dir, name), "utf8"),
    }));
  return { migrations };
}

/**
 * The body of the LAST `CREATE OR REPLACE FUNCTION <fn>` across the chain,
 * plus the migration it came from. Returns null when nothing defines it.
 */
function lastDefinition(migrations, fn) {
  const marker = `CREATE OR REPLACE FUNCTION ${fn}(`;
  for (let i = migrations.length - 1; i >= 0; i -= 1) {
    const { name, source } = migrations[i];
    const start = source.lastIndexOf(marker);
    if (start < 0) continue;
    const end = source.indexOf("$function$;", start);
    assert.ok(end > start, `${name}: ${fn} definition is not terminated by $function$;`);
    return { name, body: source.slice(start, end + "$function$;".length) };
  }
  return null;
}

function soleSha256(body, where) {
  const found = [...body.matchAll(SHA256_LITERAL)].map((m) => m[1]);
  const unique = [...new Set(found)];
  assert.equal(
    unique.length,
    1,
    `${where}: expected exactly one 64-hex requirements digest, found ${unique.length} (${unique.join(", ") || "none"})`,
  );
  return unique[0];
}

/** What `ari_cert_begin_run` STAMPS onto a new run. */
export function stampedDigest(migrations) {
  const definition = lastDefinition(migrations, BEGIN_FN);
  assert.ok(definition, `no migration defines ${BEGIN_FN}`);
  assert.ok(
    /INSERT INTO public\.ari_cert_runs[\s\S]*\brequirements_digest\b/.test(definition.body),
    `${definition.name}: ${BEGIN_FN} no longer writes requirements_digest`,
  );
  return { ...definition, digest: soleSha256(definition.body, `${definition.name}: ${BEGIN_FN}`) };
}

/** What `ari_cert_finalize_run` CHECKS before it will certify. */
export function checkedDigest(migrations) {
  const definition = lastDefinition(migrations, FINALIZE_FN);
  assert.ok(definition, `no migration defines ${FINALIZE_FN}`);
  const matches = [...definition.body.matchAll(/requirements_digest <> '([0-9a-f]{64})'/g)]
    .map((m) => m[1]);
  const unique = [...new Set(matches)];
  assert.equal(
    unique.length,
    1,
    `${definition.name}: ${FINALIZE_FN} must check exactly one requirements digest, found ${unique.length}`,
  );
  return { ...definition, digest: unique[0] };
}

export function checkContract(fixture) {
  const { migrations } = fixture;
  assert.ok(Array.isArray(migrations) && migrations.length > 0, "no migrations found");

  const stamped = stampedDigest(migrations);
  const checked = checkedDigest(migrations);

  assert.equal(
    stamped.digest,
    checked.digest,
    `ari_cert requirements-digest DRIFT: ${BEGIN_FN} stamps ${stamped.digest} ` +
      `(${stamped.name}) but ${FINALIZE_FN} demands ${checked.digest} (${checked.name}). ` +
      "Every run created through the canonical entry point will die at " +
      "ari_cert_requirements_digest_mismatch. Both halves move together or neither does.",
  );

  return { digest: stamped.digest, stampedIn: stamped.name, checkedIn: checked.name };
}

// --------------------------------------------------------------------------
// self-test
// --------------------------------------------------------------------------
const clone = (fixture) => ({ migrations: fixture.migrations.map((m) => ({ ...m })) });

function bad(base, mutate, label) {
  const fixture = clone(base);
  mutate(fixture);
  assert.throws(() => checkContract(fixture), undefined, `self-test mutant did not fail: ${label}`);
}

function lastIndexDefining(fixture, fn) {
  const marker = `CREATE OR REPLACE FUNCTION ${fn}(`;
  for (let i = fixture.migrations.length - 1; i >= 0; i -= 1) {
    if (fixture.migrations[i].source.includes(marker)) return i;
  }
  throw new Error(`self-test could not find a migration defining ${fn}`);
}

function selfTest() {
  const good = readLive();
  const live = checkContract(good);
  const other = "a".repeat(64);

  // M1 — the two literals diverge. The exact production defect.
  bad(good, (x) => {
    const i = lastIndexDefining(x, BEGIN_FN);
    x.migrations[i].source = x.migrations[i].source.replace(live.digest, other);
  }, "begin_run and finalize digests diverge");

  // M2 — the same divergence introduced from the finalizer side.
  bad(good, (x) => {
    const i = lastIndexDefining(x, FINALIZE_FN);
    x.migrations[i].source = x.migrations[i].source.replace(
      `requirements_digest <> '${live.digest}'`,
      `requirements_digest <> '${other}'`,
    );
  }, "finalize digest moved alone");

  // M3 — begin_run's literal deleted entirely.
  bad(good, (x) => {
    const i = lastIndexDefining(x, BEGIN_FN);
    x.migrations[i].source = x.migrations[i].source.replace(`'${live.digest}'`, "NULL");
  }, "begin_run digest literal deleted");

  // M4 — finalize's check deleted entirely.
  bad(good, (x) => {
    const i = lastIndexDefining(x, FINALIZE_FN);
    x.migrations[i].source = x.migrations[i].source.replace(
      `requirements_digest <> '${live.digest}'`,
      "FALSE",
    );
  }, "finalize digest check deleted");

  // M5 — THE #1973 / #1978 SHAPE: a later migration forward-replaces ONLY the
  // finalizer with a new reviewed digest and forgets begin_run.
  bad(good, (x) => {
    x.migrations.push({
      name: "29999999999999_a_future_issue_that_forgets_begin_run.sql",
      version: "29999999999999",
      source: [
        `CREATE OR REPLACE FUNCTION ${FINALIZE_FN}(p_run_id uuid)`,
        "RETURNS jsonb LANGUAGE plpgsql AS $function$",
        "BEGIN",
        `  IF v_run.requirements_digest <> '${other}' THEN`,
        "    RAISE EXCEPTION 'ari_cert_requirements_digest_mismatch';",
        "  END IF;",
        "END;",
        "$function$;",
      ].join("\n"),
    });
  }, "a later migration replaces only the finalizer");

  // M6 — the mirror image: only begin_run moves forward.
  bad(good, (x) => {
    x.migrations.push({
      name: "29999999999999_a_future_issue_that_forgets_the_finalizer.sql",
      version: "29999999999999",
      source: [
        `CREATE OR REPLACE FUNCTION ${BEGIN_FN}(p_release_sha text)`,
        "RETURNS uuid LANGUAGE plpgsql AS $function$",
        "BEGIN",
        "  INSERT INTO public.ari_cert_runs (release_sha, requirements_digest)",
        `  VALUES (p_release_sha, '${other}');`,
        "END;",
        "$function$;",
      ].join("\n"),
    });
  }, "a later migration replaces only begin_run");

  // M7 — begin_run stops writing the column at all.
  bad(good, (x) => {
    const i = lastIndexDefining(x, BEGIN_FN);
    x.migrations[i].source = x.migrations[i].source.replaceAll(
      "requirements_digest",
      "requirements_digest_unused",
    );
  }, "begin_run stops writing requirements_digest");

  // M8 — an ambiguous begin_run carrying two different digests.
  bad(good, (x) => {
    const i = lastIndexDefining(x, BEGIN_FN);
    x.migrations[i].source = x.migrations[i].source.replace(
      `'${live.digest}'`,
      `CASE WHEN true THEN '${live.digest}' ELSE '${other}' END`,
    );
  }, "begin_run carries two candidate digests");

  // M9 — nothing defines begin_run at all.
  bad(good, (x) => {
    for (const migration of x.migrations) {
      migration.source = migration.source.replaceAll(
        `CREATE OR REPLACE FUNCTION ${BEGIN_FN}(`,
        "CREATE OR REPLACE FUNCTION public.removed_begin_run(",
      );
    }
  }, "begin_run no longer exists");

  console.log(
    `issue-2592 self-test: 1 GOOD + 9 BAD fixtures passed (live digest ${live.digest})`,
  );
}

if (process.argv.includes("--self-test")) selfTest();
else {
  const live = checkContract(readLive());
  console.log(
    `issue-2592 ari_cert requirements-digest parity: PASS — ${live.digest} ` +
      `stamped in ${live.stampedIn}, checked in ${live.checkedIn}`,
  );
}
