// ORCH-1276 [Admin Identity console — WAVE-2 EDIT] — i-1276-identity-admin-write
// strict-grep fixture. Proves the gate PASSES with all 11 guard-first + audited +
// REVOKE-anon RPCs and a clean write surface, and FAILS-on-revert when a guard, an
// admin_write_audit call, or a REVOKE-anon line is removed, or a direct browser
// write is introduced.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../i-1276-identity-admin-write.mjs", import.meta.url));

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

function goodFn(name) {
  return (
    `CREATE OR REPLACE FUNCTION public.${name}(p_id uuid, p_reason text)\n` +
    "RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$ DECLARE v_before jsonb; v_after jsonb; BEGIN\n" +
    "  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;\n" +
    "  SELECT to_jsonb(t) INTO v_before FROM public.t t WHERE t.id = p_id;\n" +
    "  IF v_before IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;\n" +
    "  UPDATE public.t SET x = 1 WHERE id = p_id RETURNING to_jsonb(t) INTO v_after;\n" +
    "  PERFORM public.admin_write_audit('t.x','t',p_id::text,p_reason,jsonb_build_object('before',v_before,'after',v_after));\n" +
    "  RETURN v_after; END; $$;\n" +
    `REVOKE EXECUTE ON FUNCTION public.${name}(uuid,text) FROM anon, PUBLIC;\n` +
    `GRANT EXECUTE ON FUNCTION public.${name}(uuid,text) TO authenticated;\n`
  );
}

function withRepo(migSql, files, callback) {
  const root = mkdtempSync(join(tmpdir(), "i-1276-"));
  try {
    mkdirSync(join(root, "supabase", "migrations"), { recursive: true });
    writeFileSync(join(root, "supabase", "migrations", "20261208000001_fixture.sql"), migSql);
    for (const [rel, content] of Object.entries(files || {})) {
      const abs = join(root, rel);
      mkdirSync(join(abs, ".."), { recursive: true });
      writeFileSync(abs, content);
    }
    return callback(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function runGate(cwd) {
  return spawnSync(process.execPath, [SCRIPT], { encoding: "utf8", cwd });
}

test("self-test: GOOD + 5 BAD fixtures all classified correctly", () => {
  const r = spawnSync(process.execPath, [SCRIPT, "--self-test"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /PASS/);
});

test("PASS: all 11 guard-first + audited + REVOKE-anon RPCs, clean write surface", () => {
  const mig = WRITE_RPCS.map(goodFn).join("\n");
  withRepo(mig, {}, (cwd) => {
    const r = runGate(cwd);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /PASS/);
  });
});

test("FAIL-on-revert: a removed is_admin_user() guard is caught", () => {
  const mig = WRITE_RPCS.map(goodFn)
    .join("\n")
    .replace("IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;", "");
  withRepo(mig, {}, (cwd) => {
    const r = runGate(cwd);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /is_admin_user\(\) guard/);
  });
});

test("FAIL-on-revert: a removed admin_write_audit call is caught", () => {
  const mig = WRITE_RPCS.map(goodFn)
    .join("\n")
    .replace(
      "PERFORM public.admin_write_audit('t.x','t',p_id::text,p_reason,jsonb_build_object('before',v_before,'after',v_after));",
      "",
    );
  withRepo(mig, {}, (cwd) => {
    const r = runGate(cwd);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /admin_write_audit/);
  });
});

test("FAIL-on-revert: a removed REVOKE ... FROM anon line is caught", () => {
  const mig = WRITE_RPCS.map(goodFn)
    .join("\n")
    .replace("REVOKE EXECUTE ON FUNCTION public.admin_set_user_active(uuid,text) FROM anon, PUBLIC;", "");
  withRepo(mig, {}, (cwd) => {
    const r = runGate(cwd);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /REVOKE EXECUTE \.\.\. FROM anon/);
  });
});

test("FAIL: a direct browser write on an identity table is caught", () => {
  const mig = WRITE_RPCS.map(goodFn).join("\n");
  const files = {
    "mingla-admin/src/pages/BrandsConsolePage.jsx": 'supabase.from("brands").update({ name });\n',
  };
  withRepo(mig, files, (cwd) => {
    const r = runGate(cwd);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /direct \.update/);
  });
});
