// ORCH-1278 [Admin Money console — WAVE-2 ACT] — i-admin-refund-bounded strict-grep
// fixture. Proves the gate PASSES with the amount-bounded + idempotent + audited +
// service_role-only refund contract, and FAILS-on-revert when the ceiling guard, the
// edge Idempotency-Key requirement, the edge audit, or the service_role-only grant is
// removed, or a direct browser money-table write is introduced.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../i-admin-refund-bounded.mjs", import.meta.url));

const GOOD_MIG =
  "CREATE OR REPLACE FUNCTION public.admin_refund_order(p_order_id uuid, p_lines jsonb, p_reason text, p_idempotency_key text)\n" +
  "RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $function$ DECLARE v_order public.orders%ROWTYPE; v_amt int; v_rem int; BEGIN\n" +
  "  IF auth.uid() IS NOT NULL AND NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;\n" +
  "  v_rem := v_order.total_cents - COALESCE(v_order.refunded_amount_cents, 0);\n" +
  "  IF v_amt > v_rem THEN RAISE EXCEPTION 'refund_exceeds_remaining: requested=% remaining=%', v_amt, v_rem; END IF;\n" +
  "  RETURN '{}'::jsonb; END; $function$;\n" +
  "REVOKE ALL ON FUNCTION public.admin_refund_order(uuid, jsonb, text, text) FROM PUBLIC, anon, authenticated;\n" +
  "GRANT EXECUTE ON FUNCTION public.admin_refund_order(uuid, jsonb, text, text) TO service_role;\n" +
  "CREATE OR REPLACE FUNCTION public.admin_refund_order_commit(p_refund_id uuid, p_stripe_refund_id text, p_application_fee_refunded_cents integer, p_status text, p_stripe_tax_transaction_id text)\n" +
  "RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $function$ BEGIN\n" +
  "  IF auth.uid() IS NOT NULL AND NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;\n" +
  "  RETURN '{}'::jsonb; END; $function$;\n" +
  "REVOKE ALL ON FUNCTION public.admin_refund_order_commit(uuid, text, integer, text, text) FROM PUBLIC, anon, authenticated;\n" +
  "GRANT EXECUTE ON FUNCTION public.admin_refund_order_commit(uuid, text, integer, text, text) TO service_role;\n";

const GOOD_EDGE =
  "if (!idempotencyKey) return json({ error: 'idempotency_key_required' }, 400);\n" +
  "req.headers.get('idempotency-key');\n" +
  "await supabase.from('admin_users').select('id').eq('status', 'active');\n" +
  "await stripe.refunds.create({}, { idempotencyKey: `admin_refund:${refundId}` });\n" +
  "await supabase.rpc('admin_write_audit', { p_action: 'order.refund' });\n";

const UI_FILES = [
  "mingla-admin/src/pages/BusinessOrdersPage.jsx",
  "mingla-admin/src/pages/BusinessPaymentsPage.jsx",
  "mingla-admin/src/pages/BusinessMoneyLedgerPage.jsx",
  "mingla-admin/src/components/entity/SubscriberContextCard.jsx",
];
const cleanUi = Object.fromEntries(
  UI_FILES.map((rel) => [rel, "const { error } = await refundOrder({ order_id, lines, reason });\n"]),
);

function withRepo(migSql, edgeSrc, files, callback) {
  const root = mkdtempSync(join(tmpdir(), "i-1278-"));
  try {
    mkdirSync(join(root, "supabase", "migrations"), { recursive: true });
    writeFileSync(join(root, "supabase", "migrations", "20261210000000_fixture.sql"), migSql);
    if (edgeSrc != null) {
      mkdirSync(join(root, "supabase", "functions", "admin-refund-order"), { recursive: true });
      writeFileSync(join(root, "supabase", "functions", "admin-refund-order", "index.ts"), edgeSrc);
    }
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

test("self-test: GOOD + 6 BAD fixtures all classified correctly", () => {
  const r = spawnSync(process.execPath, [SCRIPT, "--self-test"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /PASS/);
});

test("PASS: bounded + idempotent + audited + service_role-only twins, clean UI", () => {
  withRepo(GOOD_MIG, GOOD_EDGE, cleanUi, (cwd) => {
    const r = runGate(cwd);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /PASS/);
  });
});

test("FAIL-on-revert: removing the amount-ceiling guard is caught", () => {
  const mig = GOOD_MIG.replace(
    /IF v_amt > v_rem THEN RAISE EXCEPTION 'refund_exceeds_remaining[^;]*; END IF;/,
    "",
  );
  withRepo(mig, GOOD_EDGE, cleanUi, (cwd) => {
    const r = runGate(cwd);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /refund_exceeds_remaining/);
  });
});

test("FAIL-on-revert: removing the edge Idempotency-Key requirement is caught", () => {
  withRepo(GOOD_MIG, GOOD_EDGE.replace("idempotency_key_required", "x"), cleanUi, (cwd) => {
    const r = runGate(cwd);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Idempotency-Key/);
  });
});

test("FAIL-on-revert: removing the edge audit is caught", () => {
  withRepo(GOOD_MIG, GOOD_EDGE.replace("admin_write_audit", "x"), cleanUi, (cwd) => {
    const r = runGate(cwd);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /admin_write_audit/);
  });
});

test("FAIL: granting a twin to authenticated is caught", () => {
  const mig = GOOD_MIG +
    "\nGRANT EXECUTE ON FUNCTION public.admin_refund_order(uuid, jsonb, text, text) TO authenticated;\n";
  withRepo(mig, GOOD_EDGE, cleanUi, (cwd) => {
    const r = runGate(cwd);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /service_role only/);
  });
});

test("FAIL: a direct browser money-table write in the UI is caught", () => {
  const files = { ...cleanUi };
  files["mingla-admin/src/pages/BusinessOrdersPage.jsx"] = "await supabase.from('refunds').insert({ order_id });\n";
  withRepo(GOOD_MIG, GOOD_EDGE, files, (cwd) => {
    const r = runGate(cwd);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /direct \.update/);
  });
});
