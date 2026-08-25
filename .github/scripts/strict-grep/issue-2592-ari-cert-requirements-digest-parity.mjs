#!/usr/bin/env node
/**
 * #2592 / #2060 Pass-5 — `ari_cert_begin_run` and `ari_cert_finalize_run` must
 * both derive `requirements_digest` from the same set-digest helper.
 *
 * History:
 *   Hardcoded dual literals drifted twice (#1973, #1978) and killed every
 *   canonical certification run. #2592 realigned the literals and pinned them
 *   with a static parity gate.
 *   #2060 Pass-5 replaces that contract: the digest must hash the ordered
 *   `(capability_id, evidence_mode)` rows in `ari_cert_capability_requirements`
 *   via `private.ari_cert_requirements_set_digest_v1()`. Both halves call that
 *   helper; neither may pin a 64-hex literal as the authority.
 *
 * The gate reads every migration, finds the LAST definition of each function,
 * and requires:
 *   - both bodies call `private.ari_cert_requirements_set_digest_v1`
 *   - neither body checks `requirements_digest <> '<64-hex>'`
 *   - begin_run still writes `requirements_digest` on insert
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
const HELPER = "ari_cert_requirements_set_digest_v1";
const HELPER_CALL = new RegExp(
  String.raw`\bprivate\s*\.\s*${HELPER}\s*\(`,
  "i",
);
const HARDCODED_CHECK = /\brequirements_digest\s*<>\s*'[0-9a-f]{64}'/i;

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

function declarationPattern(fn) {
  const ident = (word) => `(?:"${word}"|${word})`;
  return new RegExp(
    String.raw`\bcreate\s+(?:or\s+replace\s+)?function\s+` +
      `${ident(fn.schema)}\\s*\\.\\s*${ident(fn.name)}\\s*\\(`,
    "gi",
  );
}

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
        "cannot read the digest contract, so this fails closed.",
    );
    assert.ok(
      body.terminated,
      `${name}: ${label(fn)}'s body opens with ${body.tag} and is never closed — ` +
        "cannot read the digest contract, so this fails closed.",
    );
    return { name, tag: body.tag, body: source.slice(match.index, body.end) };
  }
  return null;
}

function assertUsesHelper(definition, where) {
  assert.ok(
    HELPER_CALL.test(definition.body),
    `${where}: ${definition.name} must call private.${HELPER}() — ` +
      "both halves derive the requirements set digest from the same helper.",
  );
  assert.ok(
    !HARDCODED_CHECK.test(definition.body),
    `${where}: ${definition.name} still checks a hardcoded 64-hex requirements_digest — ` +
      "Pass-5 replaced literal parity with the shared set-digest helper.",
  );
}

export function checkContract(fixture) {
  const { migrations } = fixture;
  assert.ok(Array.isArray(migrations) && migrations.length > 0, "no migrations found");

  const helperMigration = [...migrations].reverse().find((m) =>
    new RegExp(
      String.raw`\bcreate\s+(?:or\s+replace\s+)?function\s+(?:"?private"?\s*\.\s*)?"?${HELPER}"?\s*\(`,
      "i",
    ).test(lexSql(m.source).masked)
  );
  assert.ok(
    helperMigration,
    `no migration declares private.${HELPER} — Pass-5 set-digest helper is missing`,
  );

  const stamped = lastDefinition(migrations, BEGIN_FN);
  assert.ok(stamped, `no migration declares ${label(BEGIN_FN)}`);
  assert.ok(
    /INSERT\s+INTO\s+public\.ari_cert_runs[\s\S]*\brequirements_digest\b/i.test(stamped.body),
    `${stamped.name}: ${label(BEGIN_FN)} no longer writes requirements_digest`,
  );
  assertUsesHelper(stamped, label(BEGIN_FN));
  // A VALUES clause that still stamps a raw 64-hex (and never assigns from the
  // helper) is the pre-Pass-5 shape. Allow hex elsewhere (artifact fixtures in
  // comments are stripped by lex, but body text may mention digests); require
  // the helper call is what feeds the insert.
  assert.ok(
    /v_requirements_digest\s*:=\s*private\s*\.\s*ari_cert_requirements_set_digest_v1\s*\(/i
      .test(stamped.body) ||
      /VALUES\s*\([\s\S]*private\s*\.\s*ari_cert_requirements_set_digest_v1\s*\(/i
        .test(stamped.body),
    `${stamped.name}: ${label(BEGIN_FN)} must stamp private.${HELPER}(), not a literal`,
  );

  const checked = lastDefinition(migrations, FINALIZE_FN);
  assert.ok(checked, `no migration declares ${label(FINALIZE_FN)}`);
  assertUsesHelper(checked, label(FINALIZE_FN));
  assert.ok(
    /requirements_digest\s+IS\s+DISTINCT\s+FROM\s+private\s*\.\s*ari_cert_requirements_set_digest_v1\s*\(/i
      .test(checked.body) ||
      /requirements_digest\s*<>\s*private\s*\.\s*ari_cert_requirements_set_digest_v1\s*\(/i
        .test(checked.body),
    `${checked.name}: ${label(FINALIZE_FN)} must compare v_run.requirements_digest to private.${HELPER}()`,
  );

  return {
    helperIn: helperMigration.name,
    stampedIn: stamped.name,
    checkedIn: checked.name,
  };
}

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

function driftingBeginRun(style, useHelper) {
  const header = {
    canonical: "CREATE OR REPLACE FUNCTION public.ari_cert_begin_run(",
    lowercase: "create or replace function public.ari_cert_begin_run(",
    spaced: "CREATE   OR   REPLACE   FUNCTION   public . ari_cert_begin_run   (",
    bare: "CREATE FUNCTION public.ari_cert_begin_run(",
    quoted: 'CREATE OR REPLACE FUNCTION "public"."ari_cert_begin_run"(',
  }[style];
  const digestExpr = useHelper
    ? "private.ari_cert_requirements_set_digest_v1()"
    : `'${"a".repeat(64)}'`;
  return [
    `${header}p_release_sha text)`,
    "RETURNS uuid LANGUAGE plpgsql AS $$",
    "DECLARE v_requirements_digest text;",
    "BEGIN",
    useHelper
      ? "  v_requirements_digest := private.ari_cert_requirements_set_digest_v1();"
      : "  v_requirements_digest := NULL;",
    "  INSERT INTO public.ari_cert_runs (release_sha, requirements_digest)",
    `  VALUES (p_release_sha, ${digestExpr});`,
    "END;",
    "$$;",
  ].join("\n");
}

function finalizeWith(contract) {
  const check = {
    helper:
      "IF v_run.requirements_digest IS DISTINCT FROM private.ari_cert_requirements_set_digest_v1() THEN",
    literal: `IF v_run.requirements_digest <> '${"b".repeat(64)}' THEN`,
    missing: "IF FALSE THEN",
  }[contract];
  return [
    "CREATE OR REPLACE FUNCTION public.ari_cert_finalize_run(p_run_id uuid)",
    "RETURNS jsonb LANGUAGE plpgsql AS $function$",
    "BEGIN",
    `  ${check}`,
    "    RAISE EXCEPTION 'ari_cert_requirements_digest_mismatch';",
    "  END IF;",
    "END;",
    "$function$;",
  ].join("\n");
}

function selfTest() {
  const live = checkContract(readLive());
  const good_ = readLive();

  // M1 — begin_run drops the helper and stamps a literal again.
  bad(good_, (x) => {
    x.migrations.push({
      name: "29999999999999_begin_reverts_to_literal.sql",
      version: "29999999999999",
      source: driftingBeginRun("canonical", false),
    });
  }, "begin_run reverts to a hardcoded digest stamp");

  // M2 — finalize_run reverts to a hardcoded <> check.
  bad(good_, (x) => {
    x.migrations.push({
      name: "29999999999999_finalize_reverts_to_literal.sql",
      version: "29999999999999",
      source: finalizeWith("literal"),
    });
  }, "finalize_run reverts to a hardcoded digest check");

  // M3 — finalize_run drops the digest gate entirely.
  bad(good_, (x) => {
    x.migrations.push({
      name: "29999999999999_finalize_drops_digest_gate.sql",
      version: "29999999999999",
      source: finalizeWith("missing"),
    });
  }, "finalize_run drops the set-digest comparison");

  // M4 — begin_run stops writing the column.
  bad(good_, (x) => {
    const i = lastIndexDeclaring(x, BEGIN_FN);
    x.migrations[i].source = x.migrations[i].source.replaceAll(
      "requirements_digest",
      "requirements_digest_unused",
    );
  }, "begin_run stops writing requirements_digest");

  // M5 — helper function deleted from the chain.
  bad(good_, (x) => {
    for (const migration of x.migrations) {
      migration.source = migration.source.replaceAll(
        "ari_cert_requirements_set_digest_v1",
        "ari_cert_requirements_set_digest_removed",
      );
    }
  }, "set-digest helper renamed away");

  // M6 — only finalize moves forward with the helper; begin stays on a literal.
  bad(good_, (x) => {
    x.migrations.push({
      name: "29999999999998_literal_begin.sql",
      version: "29999999999998",
      source: driftingBeginRun("canonical", false),
    });
    x.migrations.push({
      name: "29999999999999_helper_finalize.sql",
      version: "29999999999999",
      source: finalizeWith("helper"),
    });
  }, "finalize uses the helper while begin still stamps a literal");

  // Style-tolerant hostile begin_run that drops the helper.
  for (const style of ["lowercase", "spaced", "bare", "quoted"]) {
    bad(good_, (x) => {
      x.migrations.push({
        name: `29999999999999_drift_via_${style}_declaration.sql`,
        version: "29999999999999",
        source: driftingBeginRun(style, false),
      });
    }, `digest drifted via a ${style} declaration without the helper`);
  }

  // Control — both halves redefined with the helper still PASS.
  good(good_, (x) => {
    x.migrations.push({
      name: "29999999999999_helper_redefinition.sql",
      version: "29999999999999",
      source: [
        driftingBeginRun("canonical", true),
        "",
        finalizeWith("helper"),
      ].join("\n"),
    });
  }, "both halves redefined still calling the helper");

  // Comments/strings mentioning a literal are not declarations.
  good(good_, (x) => {
    x.migrations.push({
      name: "29999999999999_only_mentions_in_comments_and_strings.sql",
      version: "29999999999999",
      source: [
        `-- requirements_digest <> '${"c".repeat(64)}'`,
        `/* private.ari_cert_requirements_set_digest_v1() */`,
        `SELECT 'CREATE OR REPLACE FUNCTION public.ari_cert_begin_run()';`,
      ].join("\n"),
    });
  }, "mentions that exist only inside comments and strings");

  console.log(
    `issue-2592/#2060 set-digest parity self-test: PASS ` +
      `(helper in ${live.helperIn}; begin ${live.stampedIn}; finalize ${live.checkedIn})`,
  );
}

if (process.argv.includes("--self-test")) selfTest();
else {
  const live = checkContract(readLive());
  console.log(
    `issue-2592/#2060 ari_cert requirements set-digest parity: PASS — ` +
      `helper ${live.helperIn}; stamped in ${live.stampedIn}; checked in ${live.checkedIn}`,
  );
}
