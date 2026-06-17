// META-ORCH-1148 e2e-validation gap — table soft-delete migration regression.
// Run:
//   deno test --allow-read supabase/migrations/__tests__/orch_1148_table_soft_delete_migration.test.ts
//
// Source-level migration regression (no live SQL harness in the worktree). Pins
// the soft-delete contract that would FAIL if 20261013000002 is reverted or
// weakened. Anchors I-PROPOSED-1148-SOFT-DELETED-TABLE-NOT-BOOKABLE +
// the SECURITY-DEFINER manager+ gate + the Supabase auto-grant REVOKE belt.

import { assert, assertMatch } from "jsr:@std/assert@1";

const FILE =
  "supabase/migrations/20261013000002_orch_1148_venue_table_soft_delete.sql";
const sql = Deno.readTextFileSync(FILE);

Deno.test("T-SD-1 — adds deleted_at column additively (IF NOT EXISTS)", () => {
  assertMatch(
    sql,
    /ALTER TABLE public\.venue_tables\s+ADD COLUMN IF NOT EXISTS deleted_at timestamptz/,
  );
});

Deno.test("T-SD-2 — engine eligible-table CTE excludes soft-deleted rows", () => {
  // The single load-bearing line — without it a deleted table keeps producing
  // slots (the bug the e2e gap reported).
  assertMatch(sql, /AND t\.deleted_at IS NULL/);
});

Deno.test("T-SD-3 — soft-delete RPC is SECURITY DEFINER + manager+ gated", () => {
  assertMatch(
    sql,
    /CREATE OR REPLACE FUNCTION public\.biz_venue_table_soft_delete\(/,
  );
  assertMatch(sql, /SECURITY DEFINER/);
  // manager+ gate via the caller's effective rank.
  assertMatch(
    sql,
    /biz_brand_effective_rank_for_caller\([^)]*\)\s*<\s*public\.biz_role_rank\('event_manager'\)/,
  );
});

Deno.test("T-SD-4 — RPC REVOKEs PUBLIC + anon, GRANTs authenticated (auto-grant belt)", () => {
  assertMatch(
    sql,
    /REVOKE ALL ON FUNCTION public\.biz_venue_table_soft_delete\(uuid\) FROM PUBLIC/,
  );
  assertMatch(
    sql,
    /REVOKE EXECUTE ON FUNCTION public\.biz_venue_table_soft_delete\(uuid\) FROM anon/,
  );
  assertMatch(
    sql,
    /GRANT EXECUTE ON FUNCTION public\.biz_venue_table_soft_delete\(uuid\) TO authenticated/,
  );
});

Deno.test("T-SD-5 — RPC writes an audit_log row + is idempotent on already-deleted", () => {
  assertMatch(sql, /INSERT INTO public\.audit_log/);
  assertMatch(sql, /venue_table\.soft_delete/);
  // idempotent: an already-deleted table short-circuits.
  assertMatch(sql, /IF v_already_deleted THEN/);
});

Deno.test("T-SD-6 — $function$ closed BEFORE the GRANT block (safe-migration protocol)", () => {
  const fnIdx = sql.indexOf("biz_venue_table_soft_delete");
  const tail = sql.slice(fnIdx);
  const closeIdx = tail.indexOf("$function$;");
  const revokeIdx = tail.indexOf(
    "REVOKE ALL ON FUNCTION public.biz_venue_table_soft_delete",
  );
  assert(closeIdx !== -1, "function dollar-tag must be closed");
  assert(
    closeIdx < revokeIdx,
    "$function$; must close BEFORE the REVOKE/GRANT block",
  );
});

Deno.test("T-SD-7 — monotonic prefix strictly greater than the prior max (20261013000001)", () => {
  const prefix = Number(FILE.match(/(\d{14})/)?.[1]);
  assert(prefix > 20261013000001, `prefix ${prefix} must exceed 20261013000001`);
});
