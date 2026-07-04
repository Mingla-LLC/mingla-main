// ORCH-1277 [Admin Offerings console — WAVE-2 EDIT] — i-offerings-writes-audited
// strict-grep fixture. Proves the gate PASSES with all 16 guard-first + mutate +
// audited + REVOKE-anon RPCs (HIGH RPCs carrying the reason_required gate) and a clean
// write surface, and FAILS-on-revert when a guard, an admin_write_audit call, a
// REVOKE-anon line, or a HIGH reason gate is removed, or a direct browser write is
// introduced.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../i-offerings-writes-audited.mjs", import.meta.url));

const AUDIT_ONLY_RPCS = ["admin_reorder_trip_day", "admin_reorder_experience_stop"];
const WRITE_RPCS = [
  "admin_set_offering_visibility",
  "admin_cancel_offering",
  "admin_set_offering_bookings_closed",
  "admin_set_offering_deleted",
  "admin_set_ticket_price",
  "admin_update_trip_day",
  "admin_reorder_trip_day",
  "admin_update_experience_stop",
  "admin_delete_experience_stop",
  "admin_reorder_experience_stop",
  "admin_set_rsvp_approval",
  "admin_remove_rsvp_guest",
  "admin_set_rsvp_capacity",
  "admin_update_venue_reservation_settings",
  "admin_update_venue_capacity_rule",
  "admin_set_reservation_status",
];

function goodFn(name) {
  const auditOnly = AUDIT_ONLY_RPCS.includes(name);
  return (
    `CREATE OR REPLACE FUNCTION public.${name}(p_id uuid, p_reason text)\n` +
    "RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$ DECLARE v_before jsonb; v_after jsonb; BEGIN\n" +
    "  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;\n" +
    (auditOnly ? "" : "  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'reason_required'; END IF;\n") +
    "  SELECT to_jsonb(t) INTO v_before FROM public.t t WHERE t.id = p_id;\n" +
    "  IF v_before IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;\n" +
    "  UPDATE public.t SET x = 1 WHERE id = p_id RETURNING to_jsonb(t) INTO v_after;\n" +
    `  PERFORM public.admin_write_audit('t.x','t',p_id::text,p_reason,jsonb_build_object('before',v_before,'after',v_after)${auditOnly ? ", false" : ""});\n` +
    "  RETURN v_after; END; $$;\n" +
    `REVOKE EXECUTE ON FUNCTION public.${name}(uuid,text) FROM anon, PUBLIC;\n` +
    `GRANT EXECUTE ON FUNCTION public.${name}(uuid,text) TO authenticated;\n`
  );
}

function withRepo(migSql, files, callback) {
  const root = mkdtempSync(join(tmpdir(), "i-1277-"));
  try {
    mkdirSync(join(root, "supabase", "migrations"), { recursive: true });
    writeFileSync(join(root, "supabase", "migrations", "20261209000000_fixture.sql"), migSql);
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

test("self-test: GOOD + 7 BAD fixtures all classified correctly", () => {
  const r = spawnSync(process.execPath, [SCRIPT, "--self-test"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /PASS/);
});

test("PASS: all 16 guard-first + mutate + audited + REVOKE-anon RPCs, clean write surface", () => {
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
    .replace("REVOKE EXECUTE ON FUNCTION public.admin_cancel_offering(uuid,text) FROM anon, PUBLIC;", "");
  withRepo(mig, {}, (cwd) => {
    const r = runGate(cwd);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /REVOKE EXECUTE \.\.\. FROM anon/);
  });
});

test("FAIL-on-revert: a removed HIGH reason_required gate is caught", () => {
  // Remove the FIRST occurrence (admin_set_offering_visibility, a HIGH RPC).
  const gate = "  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'reason_required'; END IF;\n";
  const full = WRITE_RPCS.map(goodFn).join("\n");
  const idx = full.indexOf(gate);
  const mig = full.slice(0, idx) + full.slice(idx + gate.length);
  withRepo(mig, {}, (cwd) => {
    const r = runGate(cwd);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /reason_required gate/);
  });
});

test("FAIL: a direct browser write on an offering table is caught", () => {
  const mig = WRITE_RPCS.map(goodFn).join("\n");
  const files = {
    "mingla-admin/src/pages/OfferingDetailView.jsx": 'supabase.from("events").update({ visibility });\n',
  };
  withRepo(mig, files, (cwd) => {
    const r = runGate(cwd);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /direct \.update/);
  });
});
