#!/usr/bin/env node
/**
 * ORCH-1271 [Admin authorization & audit FOUNDATION] — I-PROPOSED-1271-ADMIN-WRITE-AUDITED.
 *
 * RULE: every admin_* SECURITY DEFINER write RPC (a) guards on is_admin_user()
 * AND (b) writes admin_audit_log — directly, or via the shared admin_write_audit
 * helper. This gate asserts:
 *   (1) the shared helper admin_write_audit exists in migrations AND its body
 *       INSERTs INTO admin_audit_log.
 *   (2) the golden reference RPC admin_audit_probe exists in migrations.
 *   (3) every function in the APPEND-ONLY write-RPC registry below has a body that
 *       references admin_write_audit(  OR  INSERT INTO ... admin_audit_log.
 *
 * Reverting the ORCH-1271 primitive migration removes the helper/probe → this gate
 * FAILS (fails-on-revert).
 *
 * ── APPEND-ONLY REGISTRY (feedback_strict_grep_registry_pattern) ──────────────
 * 1272/1273/1274 APPEND their admin write RPC names here — never remove a row.
 */
import fs from "node:fs";
import path from "node:path";

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase/migrations");

// ORCH-1271 admin write RPC set — seed. Domains append (append-only).
const ADMIN_WRITE_RPCS = [
  "admin_audit_probe",
  // ORCH-1276 [Admin Identity console — WAVE-2 EDIT]: the 11 audited identity
  // write RPCs (A1–A5, B1–B2, C1–C3, D1–D2). Each calls admin_write_audit with a
  // before/after metadata object. Reverting 20261208000001-4 removes them → FAILS.
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

// Slice a plpgsql function body (between the first `$$` pair after its def).
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

function writesAudit(body) {
  return (
    /admin_write_audit\s*\(/i.test(body) ||
    /insert\s+into\s+(public\.)?admin_audit_log/i.test(body)
  );
}

function check(src, failures) {
  // (1) shared helper present + inserts into admin_audit_log.
  const helperBody = fnBody(src, "admin_write_audit");
  if (!helperBody) {
    failures.push("shared helper admin_write_audit is missing from migrations.");
  } else if (!/insert\s+into\s+(public\.)?admin_audit_log/i.test(helperBody)) {
    failures.push("admin_write_audit does not INSERT INTO admin_audit_log.");
  }

  // (2) golden reference RPC present.
  if (!fnBody(src, "admin_audit_probe")) {
    failures.push("golden reference RPC admin_audit_probe is missing from migrations.");
  }

  // (3) every registered write RPC audits.
  for (const rpc of ADMIN_WRITE_RPCS) {
    const body = fnBody(src, rpc);
    if (!body) {
      failures.push(`registered admin write RPC ${rpc} is missing from migrations.`);
      continue;
    }
    if (!writesAudit(body)) {
      failures.push(
        `registered admin write RPC ${rpc} does not audit (no admin_write_audit(...) call ` +
          `nor INSERT INTO admin_audit_log).`,
      );
    }
  }
}

if (process.argv.includes("--self-test")) {
  const self = [];
  const helper =
    "create or replace function public.admin_write_audit(p_action text) returns uuid " +
    "language plpgsql security definer as $$ begin insert into public.admin_audit_log " +
    "(action) values (p_action) returning id into v_id; return v_id; end; $$;\n";
  const probe =
    "create or replace function public.admin_audit_probe(p_reason text) returns uuid " +
    "language plpgsql security definer as $$ begin if not public.is_admin_user() then " +
    "raise exception 'not_authorized'; end if; return public.admin_write_audit('admin.audit_probe'); end; $$;\n";
  // ORCH-1276: the 11 audited identity write RPCs — registered above, so include
  // them in the good/other-subject fixtures (as 1272/1273/1274 do for their reads)
  // so the self-test isolates the intended violation instead of tripping on missing
  // registry fns.
  const identity1276 = [
    "admin_update_brand", "admin_reassign_brand_owner", "admin_set_brand_claim_status",
    "admin_set_brand_deleted", "admin_update_account", "admin_set_account_deleted",
    "admin_set_team_member_role", "admin_remove_team_member", "admin_revoke_brand_invitation",
    "admin_set_user_active", "admin_set_user_beta",
  ]
    .map(
      (n) =>
        `create or replace function public.${n}(p_id uuid) returns jsonb language plpgsql security definer as $$ ` +
        "begin if not public.is_admin_user() then raise exception 'not_authorized'; end if; " +
        "perform public.admin_write_audit('x','x',p_id::text,null,jsonb_build_object('before','{}'::jsonb,'after','{}'::jsonb)); " +
        "return '{}'::jsonb; end; $$;\n",
    )
    .join("");

  // GOOD.
  let f = [];
  check(helper + probe + identity1276, f);
  if (f.length) self.push("good fixture wrongly flagged: " + f.join("; "));

  // BAD (revert primitive): helper + probe absent.
  f = [];
  check("select 1;", f);
  if (f.length === 0) self.push("missing helper/probe not flagged");

  // BAD2: probe present but audits nothing.
  const probeNoAudit =
    "create or replace function public.admin_audit_probe(p_reason text) returns uuid " +
    "language plpgsql security definer as $$ begin if not public.is_admin_user() then " +
    "raise exception 'not_authorized'; end if; return null; end; $$;\n";
  f = [];
  check(helper + probeNoAudit + identity1276, f);
  if (f.length === 0) self.push("un-audited probe not flagged");

  if (self.length) {
    console.error("I-ADMIN-WRITE-AUDITED self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("I-ADMIN-WRITE-AUDITED self-test PASS (3/3 cases).");
  process.exit(0);
}

if (!fs.existsSync(MIGRATIONS_DIR)) {
  console.error(`I-ADMIN-WRITE-AUDITED FAIL — migrations dir not found at ${MIGRATIONS_DIR}.`);
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
  console.error("I-PROPOSED-1271-ADMIN-WRITE-AUDITED FAIL:\n  " + failures.join("\n  "));
  process.exit(1);
}
console.log(
  "I-PROPOSED-1271-ADMIN-WRITE-AUDITED PASS — admin_write_audit + admin_audit_probe present; " +
    `every registered write RPC (${ADMIN_WRITE_RPCS.join(", ")}) audits.`,
);
