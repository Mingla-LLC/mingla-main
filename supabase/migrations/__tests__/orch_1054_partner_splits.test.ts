// ORCH-1054 — SQL-shape regression for the partner_splits migration.
//
// Reads the migration file and proves the load-bearing schema + RPC
// fragments are present. Catches the easy reverts:
//   - dropped partner_splits table or its UNIQUE on stripe_application_fee_id
//   - dropped resolve_partner_for_brand_at_time RPC
//   - dropped record_partner_split_attempt / mark_* RPCs
//   - RLS not enabled
//   - I-PROPOSED-PARTNER-TRANSFER-SOURCE-CURRENCY invariant note removed
//   - creator_accounts.user_id mis-reference (ORCH-1050/1051 lesson)
//
// Run: deno test --allow-read \
//   supabase/migrations/__tests__/orch_1054_partner_splits.test.ts

import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

const SRC = await Deno.readTextFile(
  new URL(
    "../20260823000000_orch_1054_partner_splits.sql",
    import.meta.url,
  ),
);

Deno.test("migration: creates partner_splits table with required columns", () => {
  assertStringIncludes(SRC, "CREATE TABLE IF NOT EXISTS public.partner_splits");
  for (
    const col of [
      "order_id uuid",
      "brand_id uuid",
      "partner_account_id uuid",
      "mingla_fee_cents integer",
      "partner_share_cents integer",
      "transfer_currency text",
      "stripe_transfer_id text",
      "stripe_application_fee_id text",
      "status text",
      "error_message text",
      "transferred_at timestamptz",
      "reversed_at timestamptz",
    ]
  ) {
    assertStringIncludes(SRC, col);
  }
});

Deno.test("migration: UNIQUE on stripe_application_fee_id (idempotency key)", () => {
  assertStringIncludes(SRC, "partner_splits_application_fee_unique");
  assertStringIncludes(SRC, "UNIQUE (stripe_application_fee_id)");
});

Deno.test("migration: status CHECK lists every state in the workflow", () => {
  for (
    const s of [
      "'pending'",
      "'transferred'",
      "'blocked_currency_mismatch'",
      "'blocked_no_stripe'",
      "'failed'",
      "'reversed'",
      "'reversed_pending'",
    ]
  ) {
    assertStringIncludes(SRC, s);
  }
});

Deno.test("migration: indexes for partner+brand+order lookups", () => {
  assertStringIncludes(SRC, "partner_splits_partner_status_idx");
  assertStringIncludes(SRC, "partner_splits_brand_status_idx");
  assertStringIncludes(SRC, "partner_splits_order_idx");
});

Deno.test("migration: RLS enabled + forced + self-read + brand_admin read + admin", () => {
  assertStringIncludes(SRC, "ENABLE ROW LEVEL SECURITY");
  assertStringIncludes(SRC, "FORCE ROW LEVEL SECURITY");
  assertStringIncludes(SRC, "partner_splits_partner_self_select");
  assertStringIncludes(SRC, "partner_account_id = auth.uid()");
  // brand-admin path uses inline EXISTS per feedback_rls_returning_owner_gap.md
  assertStringIncludes(SRC, "FROM public.brand_team_members btm");
  assertStringIncludes(SRC, "btm.role IN ('brand_owner', 'brand_admin')");
  // No permissive write policies — service role only.
  assert(
    !/CREATE POLICY[^;]+FOR INSERT[^;]+partner_splits/.test(SRC),
    "no permissive INSERT policy allowed on partner_splits",
  );
  assert(
    !/CREATE POLICY[^;]+FOR UPDATE[^;]+partner_splits/.test(SRC),
    "no permissive UPDATE policy allowed on partner_splits",
  );
});

Deno.test("migration: defines resolve_partner_for_brand_at_time with deterministic tie-break", () => {
  assertStringIncludes(
    SRC,
    "CREATE OR REPLACE FUNCTION public.resolve_partner_for_brand_at_time",
  );
  assertStringIncludes(SRC, "p_brand_id uuid");
  assertStringIncludes(SRC, "p_at timestamptz");
  assertStringIncludes(SRC, "RETURNS uuid");
  assertStringIncludes(SRC, "partner_enabled = true");
  assertStringIncludes(SRC, "btm.accepted_at <= p_at");
  assertStringIncludes(
    SRC,
    "(btm.removed_at IS NULL OR btm.removed_at > p_at)",
  );
  assertStringIncludes(SRC, "ORDER BY btm.accepted_at ASC, btm.user_id ASC");
});

Deno.test("migration: defines all four state-transition RPCs as SECURITY DEFINER", () => {
  for (
    const rpc of [
      "record_partner_split_attempt",
      "mark_partner_split_transferred",
      "mark_partner_split_failed",
      "mark_partner_split_reversed",
    ]
  ) {
    assertStringIncludes(SRC, `CREATE OR REPLACE FUNCTION public.${rpc}`);
  }
  // Each must be SECURITY DEFINER + search_path locked.
  const occurrences = SRC.match(/SECURITY DEFINER/g) ?? [];
  assert(
    occurrences.length >= 4,
    `expected ≥4 SECURITY DEFINER blocks; found ${occurrences.length}`,
  );
  const searchPath = SRC.match(/SET search_path TO 'public', 'pg_temp'/g) ?? [];
  assert(
    searchPath.length >= 4,
    `expected ≥4 search_path locks; found ${searchPath.length}`,
  );
});

Deno.test("migration: record_partner_split_attempt is idempotent (ON CONFLICT DO NOTHING)", () => {
  assertStringIncludes(SRC, "ON CONFLICT (stripe_application_fee_id) DO NOTHING");
});

Deno.test("migration: zero-FX invariant note present", () => {
  assertStringIncludes(SRC, "I-PROPOSED-PARTNER-TRANSFER-SOURCE-CURRENCY");
});

Deno.test("migration: GRANTs limit writers to service_role", () => {
  // record_partner_split_attempt + the three mark_* RPCs grant EXECUTE to
  // service_role only (the resolve RPC also grants authenticated for read).
  const writeRpcs = [
    "record_partner_split_attempt",
    "mark_partner_split_transferred",
    "mark_partner_split_failed",
    "mark_partner_split_reversed",
  ];
  for (const rpc of writeRpcs) {
    assertStringIncludes(SRC, `GRANT EXECUTE ON FUNCTION public.${rpc}`);
    assertStringIncludes(SRC, `${rpc}`);
  }
  // None of the write RPCs should be exposed to authenticated/anon directly.
  assert(
    !/GRANT EXECUTE ON FUNCTION public\.record_partner_split_attempt[^;]+TO authenticated/
      .test(SRC),
    "record_partner_split_attempt must not be granted to authenticated",
  );
});

Deno.test("migration: keys on creator_accounts.id (NOT user_id) — ORCH-1050/1051 lesson", () => {
  assert(
    !/creator_accounts\.user_id/.test(SRC),
    "migration must NOT reference creator_accounts.user_id (no such column)",
  );
});

Deno.test("migration: ON DELETE RESTRICT on order + partner refs (ledger never silently vanishes)", () => {
  assertStringIncludes(
    SRC,
    "REFERENCES public.orders(id) ON DELETE RESTRICT",
  );
  assertStringIncludes(
    SRC,
    "REFERENCES public.creator_accounts(id) ON DELETE RESTRICT",
  );
});
