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
 * MATCHING IS STYLE-TOLERANT BY NECESSITY (independent tester P2-2). A gate
 * that only recognised `CREATE OR REPLACE FUNCTION public.fn(` would report
 * PASS while a redefinition written in any of the styles this repository
 * ALREADY uses drifted the digest underneath it. Measured on this tree:
 *   lowercase `create or replace function`   14 occurrences
 *   whitespace before the paren              31
 *   bare `CREATE FUNCTION` (no OR REPLACE)   47
 *   quoted identifiers `"public"."fn"`      197
 * and the body tag is not always `$function$`: `$$` 640, `$function$` 639,
 * `$fn$` 91, `$f$` 51, `$derive$` 3.
 *
 * Tolerance stops at code. A `CREATE FUNCTION` inside a `--` comment, a block
 * comment, a quoted string, or another function's dollar-quoted body is NOT a
 * declaration, so the source is lexed first and every non-code region is
 * masked out before the scan. (A substring hole exactly like this let an
 * earlier self-test mutant pass — see M7.)
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
const DIGEST_CHECK = /\brequirements_digest\s*<>\s*'([0-9a-f]{64})'/g;

const BEGIN_FN = { schema: "public", name: "ari_cert_begin_run" };
const FINALIZE_FN = { schema: "public", name: "ari_cert_finalize_run" };
const label = (fn) => `${fn.schema}.${fn.name}`;

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
 * Lex SQL once. Returns the source with every NON-CODE byte replaced by a
 * space (offsets and newlines preserved) plus the dollar-quoted regions, which
 * are where function bodies live.
 *
 * Handles: `--` line comments, NESTABLE `/* *\/` block comments, `'…''…'`
 * strings, `"…"` quoted identifiers, and `$tag$…$tag$` dollar quoting.
 */
export function lexSql(source) {
  const masked = source.split("");
  const dollarRegions = [];
  const blank = (from, to) => {
    for (let k = from; k < to && k < masked.length; k += 1) {
      if (masked[k] !== "\n") masked[k] = " ";
    }
  };

  let i = 0;
  let blockDepth = 0;
  while (i < source.length) {
    if (blockDepth > 0) {
      if (source.startsWith("/*", i)) { blockDepth += 1; blank(i, i + 2); i += 2; continue; }
      if (source.startsWith("*/", i)) { blockDepth -= 1; blank(i, i + 2); i += 2; continue; }
      blank(i, i + 1); i += 1; continue;
    }
    if (source.startsWith("/*", i)) { blockDepth = 1; blank(i, i + 2); i += 2; continue; }
    if (source.startsWith("--", i)) {
      const end = source.indexOf("\n", i);
      const stop = end === -1 ? source.length : end;
      blank(i, stop); i = stop; continue;
    }
    if (source[i] === "'") {
      let j = i + 1;
      while (j < source.length) {
        if (source[j] === "'" && source[j + 1] === "'") { j += 2; continue; }
        if (source[j] === "'") { j += 1; break; }
        j += 1;
      }
      blank(i, j); i = j; continue;
    }
    if (source[i] === '"') {
      const end = source.indexOf('"', i + 1);
      const stop = end === -1 ? source.length : end + 1;
      // Quoted identifiers ARE code (`"public"."fn"`), so they stay visible.
      i = stop; continue;
    }
    const tag = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(source.slice(i));
    if (tag) {
      const open = tag[0];
      const close = source.indexOf(open, i + open.length);
      const end = close === -1 ? source.length : close + open.length;
      dollarRegions.push({ start: i, end, tag: open, terminated: close !== -1 });
      blank(i, end);
      i = end; continue;
    }
    i += 1;
  }
  return { masked: masked.join(""), dollarRegions };
}

/**
 * Style-tolerant declaration matcher: case-insensitive, whitespace-tolerant
 * between every token and before the paren, `OR REPLACE` optional, schema and
 * name each optionally double-quoted.
 */
function declarationPattern(fn) {
  const ident = (word) => `(?:"${word}"|${word})`;
  return new RegExp(
    String.raw`\bcreate\s+(?:or\s+replace\s+)?function\s+` +
      `${ident(fn.schema)}\\s*\\.\\s*${ident(fn.name)}\\s*\\(`,
    "gi",
  );
}

/**
 * The body of the LAST declaration of `fn` across the chain, plus the
 * migration it came from. Returns null when nothing declares it.
 */
function lastDefinition(migrations, fn) {
  const pattern = declarationPattern(fn);
  for (let i = migrations.length - 1; i >= 0; i -= 1) {
    const { name, source } = migrations[i];
    const { masked, dollarRegions } = lexSql(source);
    pattern.lastIndex = 0;
    let match = null;
    for (const found of masked.matchAll(pattern)) match = found;
    if (!match) continue;

    const body = dollarRegions.find((region) => region.start > match.index);
    assert.ok(
      body,
      `${name}: ${label(fn)} is declared but has no dollar-quoted body — ` +
        "cannot read the digest it pins, so this fails closed.",
    );
    assert.ok(
      body.terminated,
      `${name}: ${label(fn)}'s body opens with ${body.tag} and is never closed — ` +
        "cannot read the digest it pins, so this fails closed.",
    );
    return { name, tag: body.tag, body: source.slice(match.index, body.end) };
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
  assert.ok(definition, `no migration declares ${label(BEGIN_FN)}`);
  assert.ok(
    /INSERT\s+INTO\s+public\.ari_cert_runs[\s\S]*\brequirements_digest\b/i.test(definition.body),
    `${definition.name}: ${label(BEGIN_FN)} no longer writes requirements_digest`,
  );
  return { ...definition, digest: soleSha256(definition.body, `${definition.name}: ${label(BEGIN_FN)}`) };
}

/** What `ari_cert_finalize_run` CHECKS before it will certify. */
export function checkedDigest(migrations) {
  const definition = lastDefinition(migrations, FINALIZE_FN);
  assert.ok(definition, `no migration declares ${label(FINALIZE_FN)}`);
  DIGEST_CHECK.lastIndex = 0;
  const unique = [...new Set([...definition.body.matchAll(DIGEST_CHECK)].map((m) => m[1]))];
  assert.equal(
    unique.length,
    1,
    `${definition.name}: ${label(FINALIZE_FN)} must check exactly one requirements digest, found ${unique.length}`,
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
    `ari_cert requirements-digest DRIFT: ${label(BEGIN_FN)} stamps ${stamped.digest} ` +
      `(${stamped.name}) but ${label(FINALIZE_FN)} demands ${checked.digest} (${checked.name}). ` +
      "Every run created through the canonical entry point will die at " +
      "ari_cert_requirements_digest_mismatch. Both halves move together or neither does.",
  );

  return { digest: stamped.digest, stampedIn: stamped.name, checkedIn: checked.name };
}

// --------------------------------------------------------------------------
// self-test
// --------------------------------------------------------------------------
const clone = (fixture) => ({ migrations: fixture.migrations.map((m) => ({ ...m })) });

function bad(base, mutate, message) {
  const fixture = clone(base);
  mutate(fixture);
  assert.throws(() => checkContract(fixture), undefined, `self-test mutant did not fail: ${message}`);
}

function good(base, mutate, message) {
  const fixture = clone(base);
  mutate(fixture);
  assert.doesNotThrow(() => checkContract(fixture), `self-test control wrongly failed: ${message}`);
}

function lastIndexDeclaring(fixture, fn) {
  const pattern = declarationPattern(fn);
  for (let i = fixture.migrations.length - 1; i >= 0; i -= 1) {
    pattern.lastIndex = 0;
    if (pattern.test(lexSql(fixture.migrations[i].source).masked)) return i;
  }
  throw new Error(`self-test could not find a migration declaring ${label(fn)}`);
}

/** A later migration that drifts begin_run's digest, written in `style`. */
function driftingBeginRun(style, digest) {
  const header = {
    canonical: 'CREATE OR REPLACE FUNCTION public.ari_cert_begin_run(',
    lowercase: 'create or replace function public.ari_cert_begin_run(',
    spaced: 'CREATE   OR   REPLACE   FUNCTION   public . ari_cert_begin_run   (',
    bare: 'CREATE FUNCTION public.ari_cert_begin_run(',
    quoted: 'CREATE OR REPLACE FUNCTION "public"."ari_cert_begin_run"(',
  }[style];
  return [
    `${header}p_release_sha text)`,
    "RETURNS uuid LANGUAGE plpgsql AS $$",
    "BEGIN",
    "  INSERT INTO public.ari_cert_runs (release_sha, requirements_digest)",
    `  VALUES (p_release_sha, '${digest}');`,
    "END;",
    "$$;",
  ].join("\n");
}

function selfTest() {
  const live = checkContract(readLive());
  const good_ = readLive();
  const other = "a".repeat(64);

  // M1 — the two literals diverge. The exact production defect.
  bad(good_, (x) => {
    const i = lastIndexDeclaring(x, BEGIN_FN);
    x.migrations[i].source = x.migrations[i].source.replace(live.digest, other);
  }, "begin_run and finalize digests diverge");

  // M2 — the same divergence introduced from the finalizer side.
  bad(good_, (x) => {
    const i = lastIndexDeclaring(x, FINALIZE_FN);
    x.migrations[i].source = x.migrations[i].source.replace(
      `requirements_digest <> '${live.digest}'`,
      `requirements_digest <> '${other}'`,
    );
  }, "finalize digest moved alone");

  // M3 — begin_run's literal deleted entirely.
  bad(good_, (x) => {
    const i = lastIndexDeclaring(x, BEGIN_FN);
    x.migrations[i].source = x.migrations[i].source.replace(`'${live.digest}'`, "NULL");
  }, "begin_run digest literal deleted");

  // M4 — the finalizer's check deleted entirely.
  bad(good_, (x) => {
    const i = lastIndexDeclaring(x, FINALIZE_FN);
    x.migrations[i].source = x.migrations[i].source.replace(
      `requirements_digest <> '${live.digest}'`,
      "FALSE",
    );
  }, "finalize digest check deleted");

  // M5 — THE #1973 / #1978 SHAPE: a later migration forward-replaces ONLY the
  // finalizer with a new reviewed digest and forgets begin_run.
  bad(good_, (x) => {
    x.migrations.push({
      name: "29999999999999_a_future_issue_that_forgets_begin_run.sql",
      version: "29999999999999",
      source: [
        "CREATE OR REPLACE FUNCTION public.ari_cert_finalize_run(p_run_id uuid)",
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
  bad(good_, (x) => {
    x.migrations.push({
      name: "29999999999999_a_future_issue_that_forgets_the_finalizer.sql",
      version: "29999999999999",
      source: driftingBeginRun("canonical", other),
    });
  }, "a later migration replaces only begin_run");

  // M7 — begin_run stops writing the column at all. (This mutant PASSED against
  // an earlier draft, because `requirements_digest` matched as a substring of
  // `requirements_digest_unused`. Word boundary added; kept as a regression.)
  bad(good_, (x) => {
    const i = lastIndexDeclaring(x, BEGIN_FN);
    x.migrations[i].source = x.migrations[i].source.replaceAll(
      "requirements_digest",
      "requirements_digest_unused",
    );
  }, "begin_run stops writing requirements_digest");

  // M8 — an ambiguous begin_run carrying two different digests.
  bad(good_, (x) => {
    const i = lastIndexDeclaring(x, BEGIN_FN);
    x.migrations[i].source = x.migrations[i].source.replace(
      `'${live.digest}'`,
      `CASE WHEN true THEN '${live.digest}' ELSE '${other}' END`,
    );
  }, "begin_run carries two candidate digests");

  // M9 — nothing declares begin_run at all.
  bad(good_, (x) => {
    for (const migration of x.migrations) {
      migration.source = migration.source.replaceAll("ari_cert_begin_run", "removed_begin_run");
    }
  }, "begin_run no longer exists");

  // ----------------------------------------------------------------------
  // P2-2 — one hostile mutant per declaration style this repo already uses.
  // Each drifts the digest while writing the declaration in a style the
  // previous exact-literal matcher was blind to.
  // ----------------------------------------------------------------------
  for (const style of ["lowercase", "spaced", "bare", "quoted"]) {
    bad(good_, (x) => {
      x.migrations.push({
        name: `29999999999999_drift_via_${style}_declaration.sql`,
        version: "29999999999999",
        source: driftingBeginRun(style, other),
      });
    }, `digest drifted via a ${style} declaration`);
  }

  // M14 — P3: a `$$`-quoted redefinition is read, not misreported. Same digest,
  // different body tag: the gate must PASS rather than fail on a parse message.
  good(good_, (x) => {
    x.migrations.push({
      name: "29999999999999_dollar_quoted_redefinition.sql",
      version: "29999999999999",
      source: driftingBeginRun("canonical", live.digest),
    });
  }, "a $$-quoted redefinition carrying the SAME digest");

  // M15 — tolerance stops at code: a declaration inside a comment or a string
  // is not a declaration. Over-loosening here is how a gate starts reading
  // prose, which is the #2113 class in the other direction.
  good(good_, (x) => {
    x.migrations.push({
      name: "29999999999999_only_mentions_in_comments_and_strings.sql",
      version: "29999999999999",
      source: [
        `-- create or replace function public.ari_cert_begin_run( '${other}' )`,
        `/* CREATE FUNCTION "public"."ari_cert_begin_run" ( '${other}' ) */`,
        `SELECT 'CREATE OR REPLACE FUNCTION public.ari_cert_begin_run( ${other} )';`,
      ].join("\n"),
    });
  }, "declarations that exist only inside comments and strings");

  // M16 — an unterminated body fails closed with a body-tag message, not a
  // hardcoded `$function$` one.
  bad(good_, (x) => {
    x.migrations.push({
      name: "29999999999999_unterminated_body.sql",
      version: "29999999999999",
      source: [
        "CREATE OR REPLACE FUNCTION public.ari_cert_begin_run(p_release_sha text)",
        "RETURNS uuid LANGUAGE plpgsql AS $fn$",
        "BEGIN",
        "  INSERT INTO public.ari_cert_runs (release_sha, requirements_digest)",
        `  VALUES (p_release_sha, '${other}');`,
        "END;",
      ].join("\n"),
    });
  }, "an unterminated function body");

  console.log(
    `issue-2592 self-test: 2 GOOD + 14 BAD fixtures passed (live digest ${live.digest})`,
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
