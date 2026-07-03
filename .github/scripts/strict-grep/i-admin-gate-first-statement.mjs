#!/usr/bin/env node
/**
 * ORCH-1271 [Admin authorization & audit FOUNDATION] — I-PROPOSED-1271-ADMIN-GATE-FIRST-STATEMENT.
 *
 * RULE: in every admin SECURITY DEFINER RPC, the is_admin_user() guard is the
 * FIRST executable statement (after DECLARE / comments, before ANY query). A
 * query BEFORE the guard opens a fail-open exposure window.
 *
 * For each registered function: slice the plpgsql body, find the first BEGIN,
 * strip comment lines, take the first statement (up to the first ';'), and assert
 * it is an `IF ... is_admin_user() ... THEN ... RAISE` guard. Both accepted forms:
 *   * IF NOT public.is_admin_user() THEN RAISE ...            (probe / template)
 *   * IF auth.uid() IS NOT NULL AND NOT public.is_admin_user() THEN RAISE ...  (helper)
 * A query (SELECT/INSERT/UPDATE/DELETE/PERFORM) as the first statement → FAIL.
 *
 * Reverting the ORCH-1271 primitive migration removes these functions → FAIL.
 * `--self-test` proves FAIL-on-revert with GOOD/BAD fixtures.
 *
 * ── APPEND-ONLY REGISTRY ──────────────────────────────────────────────────────
 * 1272/1273/1274 APPEND their admin_* SECURITY DEFINER fn names here.
 */
import fs from "node:fs";
import path from "node:path";

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase/migrations");

const GUARDED_DEFINER_FNS = [
  "admin_write_audit",
  "admin_audit_probe",
  // ORCH-1272 [Admin Identity console — READ-ONLY]: the unified Person read-RPC.
  // READ-ONLY (no admin_write_audit / write-RPC registry) but its is_admin_user()
  // guard MUST still be the first statement.
  "admin_get_person",
];

function fnBody(src, name) {
  const defRe = new RegExp(`create\\s+(or\\s+replace\\s+)?function\\s+public\\.${name}\\b`, "i");
  const m = defRe.exec(src);
  if (!m) return null;
  const rest = src.slice(m.index);
  const open = rest.indexOf("$$");
  if (open < 0) return null;
  const close = rest.indexOf("$$", open + 2);
  if (close < 0) return null;
  return rest.slice(open + 2, close);
}

function firstStatement(body) {
  const bi = body.search(/\bBEGIN\b/i);
  if (bi < 0) return null;
  let after = body.slice(bi + "BEGIN".length);
  // Strip full-line SQL comments so the first *executable* statement is measured.
  after = after
    .split("\n")
    .filter((l) => !/^\s*--/.test(l))
    .join("\n");
  const semi = after.indexOf(";");
  return (semi < 0 ? after : after.slice(0, semi)).trim();
}

const GUARD_RE = /^IF\b[\s\S]*?\bNOT\b[\s\S]*?is_admin_user\s*\(\s*\)[\s\S]*?\bTHEN\b[\s\S]*?\bRAISE\b/i;

function check(src, failures) {
  for (const name of GUARDED_DEFINER_FNS) {
    const body = fnBody(src, name);
    if (!body) {
      failures.push(`admin definer fn ${name} is missing from migrations.`);
      continue;
    }
    const first = firstStatement(body);
    if (!first) {
      failures.push(`admin definer fn ${name}: could not locate the first statement.`);
      continue;
    }
    if (!GUARD_RE.test(first)) {
      failures.push(
        `admin definer fn ${name}: first executable statement is NOT an is_admin_user() ` +
          `guard (found: "${first.slice(0, 80).replace(/\s+/g, " ")}...").`,
      );
    }
  }
}

if (process.argv.includes("--self-test")) {
  const self = [];
  const helper =
    "create or replace function public.admin_write_audit(p_action text) returns uuid " +
    "language plpgsql security definer as $$ declare v_id uuid; begin " +
    "-- guard first\n if auth.uid() is not null and not public.is_admin_user() then " +
    "raise exception 'not_authorized'; end if; insert into public.admin_audit_log(action) " +
    "values (p_action) returning id into v_id; return v_id; end; $$;\n";
  const probe =
    "create or replace function public.admin_audit_probe(p_reason text) returns uuid " +
    "language plpgsql security definer as $$ begin if not public.is_admin_user() then " +
    "raise exception 'not_authorized'; end if; return public.admin_write_audit('x'); end; $$;\n";
  // ORCH-1272: the READ-ONLY admin_get_person read-RPC — registered here (guard MUST
  // be first). Included in the good/other-subject fixtures so the self-test isolates
  // the intended violation instead of tripping on a missing registry fn.
  const getPerson =
    "create or replace function public.admin_get_person(p_user_id uuid) returns jsonb " +
    "language plpgsql security definer as $$ declare v_out jsonb; begin if not public.is_admin_user() then " +
    "raise exception 'not_authorized'; end if; return '{}'::jsonb; end; $$;\n";

  // GOOD: all guard-first.
  let f = [];
  check(helper + probe + getPerson, f);
  if (f.length) self.push("good fixture wrongly flagged: " + f.join("; "));

  // BAD: a SELECT before the guard in the probe.
  const probeQueryFirst =
    "create or replace function public.admin_audit_probe(p_reason text) returns uuid " +
    "language plpgsql security definer as $$ declare v int; begin select 1 into v; " +
    "if not public.is_admin_user() then raise exception 'not_authorized'; end if; return null; end; $$;\n";
  f = [];
  check(helper + probeQueryFirst + getPerson, f);
  if (f.length === 0) self.push("query-before-guard probe not flagged");

  // BAD2: guard missing entirely.
  const probeNoGuard =
    "create or replace function public.admin_audit_probe(p_reason text) returns uuid " +
    "language plpgsql security definer as $$ begin return public.admin_write_audit('x'); end; $$;\n";
  f = [];
  check(helper + probeNoGuard + getPerson, f);
  if (f.length === 0) self.push("guard-less probe not flagged");

  // BAD3: revert primitive → fns absent.
  f = [];
  check("select 1;", f);
  if (f.length < 2) self.push("missing definer fns not flagged");

  if (self.length) {
    console.error("I-ADMIN-GATE-FIRST-STATEMENT self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("I-ADMIN-GATE-FIRST-STATEMENT self-test PASS (4/4 cases).");
  process.exit(0);
}

if (!fs.existsSync(MIGRATIONS_DIR)) {
  console.error(`I-ADMIN-GATE-FIRST-STATEMENT FAIL — migrations dir not found at ${MIGRATIONS_DIR}.`);
  process.exit(1);
}
const src = fs
  .readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((n) => fs.readFileSync(path.join(MIGRATIONS_DIR, n), "utf8"))
  .join("\n");

const failures = [];
check(src, failures);
if (failures.length > 0) {
  console.error("I-PROPOSED-1271-ADMIN-GATE-FIRST-STATEMENT FAIL:\n  " + failures.join("\n  "));
  process.exit(1);
}
console.log(
  "I-PROPOSED-1271-ADMIN-GATE-FIRST-STATEMENT PASS — " +
    `${GUARDED_DEFINER_FNS.join(", ")} all guard on is_admin_user() as the first statement.`,
);
