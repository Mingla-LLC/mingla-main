// ORCH-1274 [Admin Money console — READ-ONLY] — i-money-no-admin-rls strict-grep
// fixture. Proves the gate PASSES with all 10 money read-RPCs present, no admin
// RLS on any money table, and cents-clean returns — and FAILS-on-revert when a
// read-RPC is removed, an admin SELECT RLS policy is added to a money table, or a
// money read-RPC returns a to_char-formatted string.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../i-money-no-admin-rls.mjs", import.meta.url));

const MONEY_RPCS = [
  "admin_list_brand_stripe_status",
  "admin_get_brand_stripe_status",
  "admin_list_orders",
  "admin_get_order",
  "admin_list_refunds",
  "admin_list_disputes",
  "admin_get_dispute",
  "admin_list_payouts",
  "admin_list_revenue_log",
  "admin_get_subscription_detail",
];

function rpcSql(names) {
  return names
    .map(
      (n) =>
        `CREATE OR REPLACE FUNCTION public.${n}(p_x uuid) RETURNS jsonb\n` +
        "LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$ BEGIN\n" +
        "IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;\n" +
        "RETURN jsonb_build_object('rows', '[]'::jsonb, 'total', 0); END; $$;",
    )
    .join("\n");
}

function withMigrations(sql, callback) {
  const root = mkdtempSync(join(tmpdir(), "i-money-"));
  try {
    mkdirSync(join(root, "supabase", "migrations"), { recursive: true });
    writeFileSync(join(root, "supabase", "migrations", "20261207000000_fixture.sql"), sql);
    return callback(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function runGate(cwd) {
  return spawnSync(process.execPath, [SCRIPT], { encoding: "utf8", cwd });
}

test("self-test: GOOD + 3 BAD fixtures all classified correctly", () => {
  const r = spawnSync(process.execPath, [SCRIPT, "--self-test"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /PASS/);
});

test("PASS: all 10 read-RPCs, no money RLS, cents-clean", () => {
  withMigrations(`${rpcSql(MONEY_RPCS)}\n`, (cwd) => {
    const r = runGate(cwd);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /PASS/);
  });
});

test("FAIL-on-revert: a removed money read-RPC is caught", () => {
  const missing = MONEY_RPCS.filter((n) => n !== "admin_get_order");
  withMigrations(`${rpcSql(missing)}\n`, (cwd) => {
    const r = runGate(cwd);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /admin_get_order/);
  });
});

test("FAIL: an admin SELECT RLS policy on a money table is caught", () => {
  const sql =
    `${rpcSql(MONEY_RPCS)}\n` +
    'CREATE POLICY "orders admin can read" ON public.orders FOR SELECT USING (public.is_admin_user());';
  withMigrations(sql, (cwd) => {
    const r = runGate(cwd);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /public\.orders/);
  });
});

test("FAIL: a to_char-formatted money return is caught (cents contract)", () => {
  const sql = rpcSql(MONEY_RPCS).replace(
    "RETURN jsonb_build_object('rows', '[]'::jsonb, 'total', 0);",
    "RETURN jsonb_build_object('amount', to_char(1000, 'FM999'));",
  );
  withMigrations(`${sql}\n`, (cwd) => {
    const r = runGate(cwd);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /to_char/);
  });
});
