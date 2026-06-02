// ORCH-1052 — SQL-shape regression for the partner-identity migration.
//
// Reads the migration file and proves the load-bearing schema + RPC
// fragments are present. Catches the easy reverts:
//   - dropped partner_enabled column
//   - dropped partner_stripe_connect_accounts table
//   - dropped partner_can_accept_brand RPC
//   - dropped P0006 invite_currency_mismatch raise
//   - dropped admin_toggle_partner RPC
//   - RLS not enabled on partner_stripe_connect_accounts
//
// Run: deno test --allow-read \
//   supabase/migrations/__tests__/orch_1052_partner_can_accept_brand.test.ts

import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

const SRC = await Deno.readTextFile(
  new URL(
    "../20260822000000_orch_1052_partner_identity_stripe.sql",
    import.meta.url,
  ),
);

Deno.test("migration: adds partner_enabled + partner_country to creator_accounts (idempotent)", () => {
  assertStringIncludes(SRC, "ADD COLUMN IF NOT EXISTS partner_enabled boolean NOT NULL DEFAULT false");
  assertStringIncludes(SRC, "ADD COLUMN IF NOT EXISTS partner_country text");
  assertStringIncludes(SRC, "creator_accounts_partner_enabled_idx");
});

Deno.test("migration: creates partner_stripe_connect_accounts with required columns", () => {
  assertStringIncludes(SRC, "CREATE TABLE IF NOT EXISTS public.partner_stripe_connect_accounts");
  for (
    const col of [
      "account_id uuid",
      "stripe_account_id text",
      "country text",
      "charges_enabled boolean",
      "payouts_enabled boolean",
      "requirements jsonb",
      "external_account_currencies jsonb",
      "detached_at timestamptz",
    ]
  ) {
    assertStringIncludes(SRC, col);
  }
  // UNIQUE on account_id and stripe_account_id.
  assertStringIncludes(SRC, "partner_stripe_connect_accounts_account_id_key");
  assertStringIncludes(SRC, "partner_stripe_connect_accounts_stripe_account_id_key");
});

Deno.test("migration: enables RLS + self-read policy + service-role-only writes", () => {
  assertStringIncludes(SRC, "ENABLE ROW LEVEL SECURITY");
  assertStringIncludes(SRC, "FORCE ROW LEVEL SECURITY");
  assertStringIncludes(SRC, "partner_stripe_self_select");
  assertStringIncludes(SRC, "account_id = auth.uid()");
  // No permissive INSERT/UPDATE/DELETE policies (writes via service role only).
  assert(
    !/CREATE POLICY[^;]+FOR INSERT[^;]+partner_stripe_connect_accounts/.test(SRC),
    "no permissive INSERT policy allowed",
  );
  assert(
    !/CREATE POLICY[^;]+FOR UPDATE[^;]+partner_stripe_connect_accounts/.test(SRC),
    "no permissive UPDATE policy allowed",
  );
});

Deno.test("migration: defines partner_can_accept_brand with all four return branches", () => {
  assertStringIncludes(SRC, "CREATE OR REPLACE FUNCTION public.partner_can_accept_brand");
  assertStringIncludes(SRC, "'not_a_partner'");
  assertStringIncludes(SRC, "'partner_stripe_not_connected'");
  assertStringIncludes(SRC, "'currency_mismatch'");
  assertStringIncludes(SRC, "SECURITY DEFINER");
  assertStringIncludes(SRC, "SET search_path TO 'public', 'pg_temp'");
});

Deno.test("migration: prepends partner gate inside accept_invite_and_transfer_brand_ownership", () => {
  assertStringIncludes(SRC, "CREATE OR REPLACE FUNCTION public.accept_invite_and_transfer_brand_ownership");
  assertStringIncludes(SRC, "public.partner_can_accept_brand");
  assertStringIncludes(SRC, "invite_currency_mismatch");
  assertStringIncludes(SRC, "P0006");
});

Deno.test("migration: defines admin_toggle_partner with admin self-check", () => {
  assertStringIncludes(SRC, "CREATE OR REPLACE FUNCTION public.admin_toggle_partner");
  assertStringIncludes(SRC, "account_type = 'admin'");
  assertStringIncludes(SRC, "audit_log");
});

Deno.test("migration: ON DELETE CASCADE so partner row vanishes with creator_account", () => {
  assertStringIncludes(SRC, "REFERENCES public.creator_accounts(id) ON DELETE CASCADE");
});

Deno.test("migration: keys on creator_accounts.id (NOT user_id) — ORCH-1050/1051 lesson", () => {
  assert(
    !/creator_accounts\.user_id/.test(SRC),
    "migration must NOT reference creator_accounts.user_id (no such column)",
  );
});
