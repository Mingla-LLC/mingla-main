// ISSUE-1354 [Admin: see all free-tool submissions] — structural regression test
// for the tool_leads admin read-RPC migration.
//
// Run: node --test supabase/migrations/__tests__/issue_1354_tool_leads_admin_rpc.test.js
//
// Asserts the migration's security/shape contract WITHOUT a live DB (the
// adversarial row-correctness + anon-denied live-fire is the tester's job —
// feedback_headless_qa_rpc_gap): both RPCs are SECURITY DEFINER with search_path
// pinned + a guard-first is_admin_user() check, EXECUTE revoked from anon and
// granted to authenticated; the list RPC exposes the five filter params and
// NEVER returns `report`/`report_token`; and `ip_hash` is in NEITHER RPC.
//
// fails-on-revert: deleting the migration file, weakening a grant/gate, dropping
// a param, or leaking `report`/`ip_hash` into the list RPC fails these asserts.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATION = path.resolve(
  __dirname,
  "..",
  "20270119001354_issue_1354_tool_leads_admin_rpc.sql",
);

const sql = fs.readFileSync(MIGRATION, "utf8");

// Isolate each function definition. `admin_tool_lead_get` is created after
// `admin_tool_leads_list`, so the list slice runs up to the get's create.
const createListIdx = sql.indexOf("create function public.admin_tool_leads_list");
const createGetIdx = sql.indexOf("create function public.admin_tool_lead_get");
const listDef = sql.slice(createListIdx, createGetIdx);
const getDef = sql.slice(createGetIdx);

function returnsBlock(def) {
  const m = def.match(/returns table\(([\s\S]*?)\)\s*\n\s*language/i);
  assert.ok(m, "could not locate a `returns table( ... )` block");
  return m[1];
}

describe("ISSUE-1354 — tool_leads admin RPC migration", () => {
  it("both RPCs are created (idempotent drop + create)", () => {
    assert.ok(createListIdx >= 0, "admin_tool_leads_list must be created");
    assert.ok(createGetIdx >= 0, "admin_tool_lead_get must be created");
    assert.match(sql, /drop function if exists public\.admin_tool_leads_list/);
    assert.match(sql, /drop function if exists public\.admin_tool_lead_get/);
  });

  it("both RPCs are SECURITY DEFINER with search_path pinned to public", () => {
    for (const def of [listDef, getDef]) {
      assert.match(def, /security definer/i, "each RPC must be security definer");
      assert.match(def, /set search_path to 'public'/i, "each RPC must pin search_path");
    }
  });

  it("both RPCs enforce a guard-FIRST is_admin_user() check (defense-in-depth)", () => {
    for (const def of [listDef, getDef]) {
      assert.match(
        def,
        /if not public\.is_admin_user\(\) then raise exception 'not_authorized'/i,
        "each RPC must reject non-admins at the DB layer",
      );
    }
  });

  it("EXECUTE is revoked from anon and granted to authenticated for BOTH RPCs", () => {
    assert.match(sql, /revoke all\s+on function public\.admin_tool_leads_list\([^)]*\) from anon/i);
    assert.match(sql, /grant execute on function public\.admin_tool_leads_list\([^)]*\) to authenticated/i);
    assert.match(sql, /revoke all\s+on function public\.admin_tool_lead_get\(uuid\) from anon/i);
    assert.match(sql, /grant execute on function public\.admin_tool_lead_get\(uuid\) to authenticated/i);
    // Also revoked from public (least-privilege).
    assert.match(sql, /revoke all\s+on function public\.admin_tool_leads_list\([^)]*\) from public/i);
    assert.match(sql, /revoke all\s+on function public\.admin_tool_lead_get\(uuid\) from public/i);
  });

  it("the list RPC exposes the five filter params", () => {
    for (const p of ["p_tool", "p_has_email", "p_search", "p_limit", "p_offset"]) {
      assert.ok(listDef.includes(p), `list RPC must declare param ${p}`);
    }
  });

  it("the list RPC NEVER returns report / report_token (light rows only)", () => {
    const cols = returnsBlock(listDef);
    assert.doesNotMatch(cols, /\breport\s+jsonb\b/i, "list RPC must not return the report jsonb");
    assert.ok(!cols.includes("report_token"), "list RPC must not return report_token");
    // It DOES surface a boolean has_report + a window total_count instead.
    assert.match(cols, /has_report\s+boolean/i);
    assert.match(cols, /total_count\s+bigint/i);
  });

  it("the detail RPC returns full input + report + report_token", () => {
    const cols = returnsBlock(getDef);
    assert.match(cols, /\binput\s+jsonb\b/i);
    assert.match(cols, /\breport\s+jsonb\b/i);
    assert.match(cols, /report_token\s+text/i);
  });

  it("ip_hash appears in NEITHER RPC's definition (never a return column or SELECT target)", () => {
    // Each function's definition runs from `create function ...` to the closing
    // `$$;` — its signature (returns table) + body. ip_hash must be in neither.
    // (The header + `comment on function` docs legitimately name it as the field
    // the RPCs deliberately never expose; those are checked separately, if ever.)
    const listBody = listDef.slice(0, listDef.indexOf("$$;"));
    const getBody = getDef.slice(0, getDef.indexOf("$$;"));
    assert.ok(!listBody.includes("ip_hash"), "ip_hash must not appear in admin_tool_leads_list");
    assert.ok(!getBody.includes("ip_hash"), "ip_hash must not appear in admin_tool_lead_get");
  });

  it("apply-time self-assert proves the anon lockdown", () => {
    assert.match(sql, /has_function_privilege\('anon'/i);
    assert.match(sql, /has_function_privilege\('authenticated'/i);
  });
});
