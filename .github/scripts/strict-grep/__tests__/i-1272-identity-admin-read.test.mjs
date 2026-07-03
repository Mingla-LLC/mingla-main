// ORCH-1272 [Admin Identity console — READ-ONLY] — i-1272-identity-admin-read
// strict-grep fixture. Proves the gate PASSES with all four is_admin_user()
// SELECT policies + admin_get_person present, and FAILS-on-revert when any policy
// or the RPC is removed.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../i-1272-identity-admin-read.mjs", import.meta.url));

const READ_TABLES = ["creator_accounts", "brand_team_members", "brand_invitations", "partner_brand_links"];

function policiesSql(tables) {
  return tables
    .map((t) => `CREATE POLICY "${t} admin can read" ON public.${t} FOR SELECT USING (public.is_admin_user());`)
    .join("\n");
}
const RPC_SQL =
  "CREATE OR REPLACE FUNCTION public.admin_get_person(p_user_id uuid) RETURNS jsonb\n" +
  "LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF; RETURN '{}'::jsonb; END; $$;";

function withMigrations(sql, callback) {
  const root = mkdtempSync(join(tmpdir(), "i-1272-"));
  try {
    mkdirSync(join(root, "supabase", "migrations"), { recursive: true });
    writeFileSync(join(root, "supabase", "migrations", "20261205000001_fixture.sql"), sql);
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

test("PASS: all four policies + admin_get_person present", () => {
  withMigrations(`${policiesSql(READ_TABLES)}\n${RPC_SQL}\n`, (cwd) => {
    const r = runGate(cwd);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /PASS/);
  });
});

test("FAIL-on-revert: a removed RLS policy is caught", () => {
  const missingOne = READ_TABLES.slice(0, 3); // drop partner_brand_links
  withMigrations(`${policiesSql(missingOne)}\n${RPC_SQL}\n`, (cwd) => {
    const r = runGate(cwd);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /partner_brand_links/);
  });
});

test("FAIL-on-revert: a removed admin_get_person RPC is caught", () => {
  withMigrations(`${policiesSql(READ_TABLES)}\n`, (cwd) => {
    const r = runGate(cwd);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /admin_get_person/);
  });
});
