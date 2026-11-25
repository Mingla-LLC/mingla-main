#!/usr/bin/env node
// Issue #4490: overlap check between a long-lived branch's migrations and main's.
//
// WHY. The #4490 migrations run after every main migration. Any function,
// view, policy or trigger a #4490 migration re-emits from an older copy
// silently replaces main's newer body (two P1s found this way: #3645's paid
// experience price guard and #4420's caller-rule event response). This tool
// shows a reviewer every such overlap after each merge of main. It is a review
// tool, not a CI gate: some differences are the branch's intended changes,
// and only a person can tell those from a lost main change.
//
// HOW IT DECIDES. Main's migration files are byte-identical on both sides, so
// any object whose final definition differs between a database replayed to
// main-only and one replayed to the merged head was changed by the branch.
// Every such object is an overlap; the files that define it are named from
// both sides, and main files added after --base are starred (the usual way a
// newer main change gets lost). Objects the branch drops are listed too.
//
// HOW TO RUN (read-only against both databases; no network):
//   1. Replay main-only migrations into one PostgreSQL 17 database
//      (supabase/postgres:17.4.1.075; every supabase/migrations/*.sql whose
//      name does not contain the branch pattern, in filename order, as
//      `postgres` with ON_ERROR_STOP=1), then capture it:
//        node scripts/issue-4490/overlap-check.mjs capture \
//          postgresql://postgres:PW@127.0.0.1:PORT/postgres main.json
//   2. Apply the branch's migrations on top (they sort after every main
//      migration, so this equals a fresh full replay), or replay a fresh
//      database to head, then capture it:
//        node scripts/issue-4490/overlap-check.mjs capture <head-url> head.json
//   3. Compare:
//        node scripts/issue-4490/overlap-check.mjs diff main.json head.json \
//          [--base <git-ref>] [--pattern _issue_4490_] [--names-only]
//      --base defaults to the parent of the branch's first commit not on
//      origin/main, found by walking the first-parent history.
//   Exit code is 0 whenever the comparison ran; read the report.

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(new URL("../..", import.meta.url).pathname);
const MIGRATIONS = join(ROOT, "supabase/migrations");

const CAPTURE_SQL = `
WITH ext AS (SELECT objid FROM pg_depend WHERE deptype = 'e'),
sys AS (SELECT oid FROM pg_namespace
        WHERE nspname IN ('pg_catalog','information_schema','pg_toast')
           OR nspname LIKE 'pg_temp%' OR nspname LIKE 'pg_toast_temp%'),
f AS (
  SELECT 'function' AS kind,
         p.oid::regprocedure::text AS key,
         pg_get_functiondef(p.oid) || E'\\n-- acl: ' || coalesce(p.proacl::text, '(default)')
           || E'\\n-- owner: ' || pg_get_userbyid(p.proowner) AS body
    FROM pg_proc p
   WHERE p.pronamespace NOT IN (SELECT oid FROM sys)
     AND p.oid NOT IN (SELECT objid FROM ext)
     AND p.prokind IN ('f','p')),
v AS (
  SELECT CASE c.relkind WHEN 'm' THEN 'matview' ELSE 'view' END,
         c.oid::regclass::text,
         pg_get_viewdef(c.oid, true) || E'\\n-- options: ' || coalesce(c.reloptions::text, '(none)')
           || E'\\n-- acl: ' || coalesce(c.relacl::text, '(default)')
    FROM pg_class c
   WHERE c.relkind IN ('v','m')
     AND c.relnamespace NOT IN (SELECT oid FROM sys)
     AND c.oid NOT IN (SELECT objid FROM ext)),
pol AS (
  SELECT 'policy', schemaname || '.' || tablename || '.' || policyname,
         'permissive: ' || permissive || E'\\nroles: ' || roles::text || E'\\ncmd: ' || cmd
           || E'\\nusing: ' || coalesce(qual, '(none)') || E'\\nwith check: ' || coalesce(with_check, '(none)')
    FROM pg_policies),
trg AS (
  SELECT 'trigger', t.tgrelid::regclass::text || '.' || t.tgname,
         pg_get_triggerdef(t.oid, true) || E'\\n-- enabled: ' || t.tgenabled::text
    FROM pg_trigger t
   WHERE NOT t.tgisinternal
     AND t.tgrelid NOT IN (SELECT oid FROM pg_class WHERE relnamespace IN (SELECT oid FROM sys)))
SELECT coalesce(json_agg(json_build_object('kind', kind, 'key', key, 'body', body) ORDER BY kind, key), '[]')
  FROM (SELECT * FROM f UNION ALL SELECT * FROM v UNION ALL SELECT * FROM pol UNION ALL SELECT * FROM trg) x(kind, key, body);
`;

function usage(message) {
  if (message) console.error(`overlap-check: ${message}`);
  console.error("usage: overlap-check.mjs capture <postgres-url> <out.json>\n" +
    "       overlap-check.mjs diff <main.json> <head.json> [--base <git-ref>] [--pattern <text>] [--names-only]");
  process.exit(2);
}

function capture(url, out) {
  const json = execFileSync("psql", [url, "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-c", CAPTURE_SQL], {
    encoding: "utf8", maxBuffer: 1 << 30,
  });
  const rows = JSON.parse(json);
  writeFileSync(out, JSON.stringify(rows));
  console.log(`captured ${rows.length} objects into ${out}`);
}

function git(...args) {
  return execFileSync("git", ["-C", ROOT, ...args], { encoding: "utf8" }).trim();
}

function defaultBase() {
  const first = git("rev-list", "--first-parent", "HEAD", "^origin/main").split("\n").filter(Boolean).pop();
  if (!first) throw new Error("no branch commits off origin/main; pass --base");
  return `${first}^`;
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// The bare object name a migration would spell, and how it would spell it.
function nameMatchers(kind, key) {
  if (kind === "function") {
    const qualified = key.slice(0, key.indexOf("("));
    const bare = qualified.split(".").pop().replaceAll('"', "");
    return [
      new RegExp(`CREATE\\s+(OR\\s+REPLACE\\s+)?(FUNCTION|PROCEDURE)\\s+("?\\w+"?\\.)?"?${escapeRegex(bare)}"?\\s*\\(`, "i"),
      new RegExp(`'(public\\.)?${escapeRegex(bare)}\\(`, "i"), // runtime rewrite helpers name a signature
    ];
  }
  const bare = key.split(".").pop().replaceAll('"', "");
  if (kind === "view" || kind === "matview") {
    return [new RegExp(`CREATE\\s+(OR\\s+REPLACE\\s+)?(MATERIALIZED\\s+)?VIEW\\s+("?\\w+"?\\.)?"?${escapeRegex(bare)}"?\\b`, "i")];
  }
  if (kind === "policy") {
    return [new RegExp(`(CREATE|ALTER)\\s+POLICY\\s+"?${escapeRegex(bare)}"?\\s+ON`, "i")];
  }
  return [new RegExp(`CREATE\\s+(OR\\s+REPLACE\\s+)?(CONSTRAINT\\s+)?TRIGGER\\s+"?${escapeRegex(bare)}"?\\b`, "i")];
}

function diff(mainPath, headPath, options) {
  const index = (rows) => new Map(rows.map((row) => [`${row.kind} ${row.key}`, row]));
  const main = index(JSON.parse(readFileSync(mainPath, "utf8")));
  const head = index(JSON.parse(readFileSync(headPath, "utf8")));
  const base = options.base || defaultBase();
  const addedSinceBase = new Set(git("diff", "--name-only", "--diff-filter=A", base, "HEAD", "--", "supabase/migrations")
    .split("\n").filter((file) => /\.sql$/.test(file) && !file.includes("__tests__"))
    .map((file) => file.split("/").pop()));
  const files = readdirSync(MIGRATIONS).filter((file) => file.endsWith(".sql")).sort()
    .map((file) => ({ file, text: readFileSync(join(MIGRATIONS, file), "utf8"), branch: file.includes(options.pattern) }));

  const changed = [];
  const dropped = [];
  let added = 0;
  let same = 0;
  for (const [id, row] of main) {
    const other = head.get(id);
    if (!other) dropped.push(row);
    else if (other.body !== row.body) changed.push({ row, other });
    else same += 1;
  }
  for (const id of head.keys()) if (!main.has(id)) added += 1;

  const definers = (row) => {
    const matchers = nameMatchers(row.kind, row.key);
    const hits = files.filter(({ text }) => matchers.some((re) => re.test(text)));
    return {
      branch: hits.filter((hit) => hit.branch).map((hit) => hit.file),
      main: hits.filter((hit) => !hit.branch).map((hit) => `${addedSinceBase.has(hit.file) ? "*" : ""}${hit.file}`),
    };
  };

  const scratch = mkdtempSync(join(tmpdir(), "overlap-check-"));
  console.log(`# overlap check (branch pattern ${options.pattern}, base ${base})`);
  console.log(`objects: main-only ${main.size}, head ${head.size}; unchanged ${same}, branch-new ${added}, ` +
    `CHANGED ${changed.length}, DROPPED ${dropped.length}`);
  console.log("* = main migration added after the base (a newer main change the branch may have overwritten)\n");
  let newer = 0;
  const showDiff = (row, other) => {
    if (options.namesOnly) return;
    const left = join(scratch, "main");
    const right = join(scratch, "head");
    writeFileSync(left, `${row.body}\n`);
    writeFileSync(right, `${other.body}\n`);
    const result = spawnSync("diff", ["-u", "--label", `main-only ${row.key}`, "--label", `head ${other.key}`, left, right], { encoding: "utf8" });
    console.log(result.stdout);
  };
  for (const { row, other } of changed) {
    const who = definers(row);
    if (who.main.some((file) => file.startsWith("*"))) newer += 1;
    console.log(`## ${row.kind} ${row.key}`);
    console.log(`   branch: ${who.branch.join(", ") || "(no textual definer found)"}`);
    console.log(`   main:   ${who.main.join(", ") || "(none)"}`);
    showDiff(row, other);
  }
  for (const row of dropped) {
    const who = definers(row);
    console.log(`## DROPPED ${row.kind} ${row.key}`);
    console.log(`   branch: ${who.branch.join(", ") || "(no textual definer found)"}`);
    console.log(`   main:   ${who.main.join(", ") || "(none)"}`);
    // A function dropped for a wider signature: diff it against the one new
    // overload of the same name, so the rewrite is reviewed like a change.
    if (row.kind === "function") {
      const name = row.key.slice(0, row.key.indexOf("("));
      const successors = [...head.values()].filter((other) => other.kind === "function" &&
        other.key.startsWith(`${name}(`) && !main.has(`function ${other.key}`));
      if (successors.length === 1) {
        console.log(`   replaced by: ${successors[0].key}`);
        showDiff(row, successors[0]);
        continue;
      }
    }
    console.log("");
  }
  console.log(`# summary: ${changed.length} changed (${newer} also defined by a main migration added after the base), ` +
    `${dropped.length} dropped`);
}

const [command, ...rest] = process.argv.slice(2);
if (command === "capture") {
  if (rest.length !== 2) usage("capture needs <postgres-url> <out.json>");
  capture(rest[0], rest[1]);
} else if (command === "diff") {
  const positional = [];
  const options = { pattern: "_issue_4490_", base: null, namesOnly: false };
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === "--base") options.base = rest[++i];
    else if (rest[i] === "--pattern") options.pattern = rest[++i];
    else if (rest[i] === "--names-only") options.namesOnly = true;
    else positional.push(rest[i]);
  }
  if (positional.length !== 2 || !options.pattern) usage("diff needs <main.json> <head.json>");
  diff(positional[0], positional[1], options);
} else {
  usage();
}
