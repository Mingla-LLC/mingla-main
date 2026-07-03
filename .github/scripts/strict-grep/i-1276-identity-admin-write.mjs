#!/usr/bin/env node
/**
 * ORCH-1276 [Admin Identity console — WAVE-2 EDIT] — I-PROPOSED-1276-IDENTITY-ADMIN-WRITE-AUDITED.
 *
 * RULE: every ORCH-1276 identity write RPC (the 11 below) is a SECURITY DEFINER
 * function that (a) guards on is_admin_user() as its FIRST executable statement,
 * (b) audits via admin_write_audit( with a before/after metadata object, and
 * (c) ships the least-privilege `REVOKE EXECUTE ... FROM ... anon` line. AND the
 * admin console performs identity mutations ONLY via these RPCs — the write
 * service + both console pages carry NO direct browser .update(/.insert(/.delete(.
 *
 * Enforcement (over supabase/migrations/** + the identity write service + pages):
 *   (1) each of the 11 CREATE OR REPLACE FUNCTION public.admin_<...>( bodies is
 *       present; its first statement is an is_admin_user() guard; it references
 *       admin_write_audit( AND contains 'before' AND 'after'.
 *   (2) each RPC carries a matching `REVOKE EXECUTE ON FUNCTION public.<fn>(...) FROM
 *       ... anon` line in a migration.
 *   (3) identityWriteService.js + BrandsConsolePage.jsx + PeopleConsolePage.jsx
 *       contain zero `.update(` / `.insert(` / `.delete(` (comments stripped).
 *
 * Deleting any guard / admin_write_audit call / REVOKE-anon line, or adding a
 * direct browser write, FAILS this gate (fails-on-revert). `--self-test` proves it.
 *
 * DRAFT until CLOSE (orchestrator flips I-PROPOSED-1276-IDENTITY-ADMIN-WRITE-AUDITED ACTIVE).
 */
import fs from "node:fs";
import path from "node:path";

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase/migrations");
const FRONTEND_FILES = [
  "mingla-admin/src/services/identityWriteService.js",
  "mingla-admin/src/pages/BrandsConsolePage.jsx",
  "mingla-admin/src/pages/PeopleConsolePage.jsx",
];

// The 11 ORCH-1276 audited identity write RPCs (A1–A5, B1–B2, C1–C3, D1–D2).
const WRITE_RPCS = [
  "admin_update_brand",
  "admin_reassign_brand_owner",
  "admin_set_brand_claim_status",
  "admin_set_brand_deleted",
  "admin_update_account",
  "admin_set_account_deleted",
  "admin_set_team_member_role",
  "admin_remove_team_member",
  "admin_revoke_brand_invitation",
  "admin_set_user_active",
  "admin_set_user_beta",
];

const DIRECT_WRITE_RE = /\.(update|insert|delete)\s*\(/;

// Slice a plpgsql function body (first `$$` pair after its def).
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
  after = after
    .split("\n")
    .filter((l) => !/^\s*--/.test(l))
    .join("\n");
  const semi = after.indexOf(";");
  return (semi < 0 ? after : after.slice(0, semi)).trim();
}

const GUARD_RE = /^IF\b[\s\S]*?\bNOT\b[\s\S]*?is_admin_user\s*\(\s*\)[\s\S]*?\bTHEN\b[\s\S]*?\bRAISE\b/i;

function revokeAnonRe(name) {
  return new RegExp(
    `revoke\\s+execute\\s+on\\s+function\\s+public\\.${name}\\s*\\([^)]*\\)\\s+from\\s+[^;]*\\banon\\b`,
    "i",
  );
}

function stripJsComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "") // block comments
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, "")) // line comments
    .join("\n");
}

function check(migSrc, frontend, failures) {
  for (const name of WRITE_RPCS) {
    const body = fnBody(migSrc, name);
    if (!body) {
      failures.push(`identity write RPC ${name} is missing from migrations.`);
      continue;
    }
    const first = firstStatement(body);
    if (!first || !GUARD_RE.test(first)) {
      failures.push(
        `identity write RPC ${name}: first executable statement is NOT an is_admin_user() guard.`,
      );
    }
    if (!/admin_write_audit\s*\(/i.test(body) || !/'before'/i.test(body) || !/'after'/i.test(body)) {
      failures.push(
        `identity write RPC ${name}: does not call admin_write_audit( with a before/after metadata object.`,
      );
    }
    if (!revokeAnonRe(name).test(migSrc)) {
      failures.push(`identity write RPC ${name}: missing least-privilege REVOKE EXECUTE ... FROM anon.`);
    }
  }
  // No direct browser writes on identity tables.
  for (const [label, src] of Object.entries(frontend)) {
    if (src == null) continue;
    if (DIRECT_WRITE_RE.test(stripJsComments(src))) {
      failures.push(
        `${label} contains a direct .update(/.insert(/.delete( — identity mutations must route ` +
          `through callAdminWriteRpc (identityWriteService).`,
      );
    }
  }
}

if (process.argv.includes("--self-test")) {
  const self = [];
  const goodFn = (name) =>
    `CREATE OR REPLACE FUNCTION public.${name}(p_id uuid, p_reason text)\n` +
    "RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$ DECLARE v_before jsonb; v_after jsonb; BEGIN\n" +
    "  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;\n" +
    "  SELECT to_jsonb(t) INTO v_before FROM public.t t WHERE t.id = p_id;\n" +
    "  IF v_before IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;\n" +
    "  UPDATE public.t SET x = 1 WHERE id = p_id RETURNING to_jsonb(t) INTO v_after;\n" +
    "  PERFORM public.admin_write_audit('t.x','t',p_id::text,p_reason,jsonb_build_object('before',v_before,'after',v_after));\n" +
    "  RETURN v_after; END; $$;\n" +
    `REVOKE EXECUTE ON FUNCTION public.${name}(uuid,text) FROM anon, PUBLIC;\n` +
    `GRANT EXECUTE ON FUNCTION public.${name}(uuid,text) TO authenticated;\n`;
  const goodMig = WRITE_RPCS.map(goodFn).join("\n");
  const cleanFront = {
    svc: "export function updateBrand(id, patch, reason){ return callAdminWriteRpc('admin_update_brand', {p_brand_id:id}); }\n",
  };

  // GOOD.
  let f = [];
  check(goodMig, cleanFront, f);
  if (f.length) self.push("good fixture wrongly flagged: " + f.join("; "));

  // BAD1: guard removed from one RPC.
  f = [];
  check(goodMig.replace("IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;", ""), cleanFront, f);
  if (f.length === 0) self.push("removed guard not flagged");

  // BAD2: admin_write_audit call removed from one RPC.
  f = [];
  check(
    goodMig.replace(
      "PERFORM public.admin_write_audit('t.x','t',p_id::text,p_reason,jsonb_build_object('before',v_before,'after',v_after));",
      "",
    ),
    cleanFront,
    f,
  );
  if (f.length === 0) self.push("removed audit call not flagged");

  // BAD3: REVOKE ... FROM anon removed from one RPC.
  f = [];
  check(goodMig.replace(/REVOKE EXECUTE ON FUNCTION public\.admin_update_brand\(uuid,text\) FROM anon, PUBLIC;/, ""), cleanFront, f);
  if (f.length === 0) self.push("removed REVOKE-anon not flagged");

  // BAD4: a direct browser write on an identity table.
  f = [];
  check(goodMig, { page: 'supabase.from("brands").update({ name });\n' }, f);
  if (f.length === 0) self.push("direct browser .update( not flagged");

  // BAD5: revert primitive → all fns absent.
  f = [];
  check("select 1;", cleanFront, f);
  if (f.length < WRITE_RPCS.length) self.push("missing RPCs not flagged");

  if (self.length) {
    console.error("I-1276-IDENTITY-ADMIN-WRITE self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("I-1276-IDENTITY-ADMIN-WRITE self-test PASS (6/6 cases).");
  process.exit(0);
}

if (!fs.existsSync(MIGRATIONS_DIR)) {
  console.error(`I-1276-IDENTITY-ADMIN-WRITE FAIL — migrations dir not found at ${MIGRATIONS_DIR}.`);
  process.exit(1);
}
const migSrc = fs
  .readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((n) => fs.readFileSync(path.join(MIGRATIONS_DIR, n), "utf8"))
  .join("\n");
const frontend = {};
for (const rel of FRONTEND_FILES) {
  const abs = path.join(process.cwd(), rel);
  frontend[rel] = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
}

const failures = [];
check(migSrc, frontend, failures);
if (failures.length > 0) {
  console.error("I-PROPOSED-1276-IDENTITY-ADMIN-WRITE-AUDITED FAIL:\n  " + failures.join("\n  "));
  process.exit(1);
}
console.log(
  "I-PROPOSED-1276-IDENTITY-ADMIN-WRITE-AUDITED PASS — all 11 identity write RPCs guard-first + " +
    "audit before/after + REVOKE anon; the write service + both pages take no direct browser write.",
);
