-- B2a Path C V3 — RC-3 fix: auto-create brand_team_members row for brand owners
-- on every INSERT into public.brands (closes the deferred fix flagged in
-- 20260513000001_b2a_v3_owner_team_members_backfill.sql lines 12-15).
--
-- Symptom (operator-reproducible 2026-05-07): operator deleted prior failing
-- brand to retry, created a new brand, tapped the V3 ToS accept button. Edge
-- function `brand-mingla-tos-accept` returned non-2xx because its UPDATE
-- (`UPDATE brand_team_members SET mingla_tos_accepted_at = ...
--   WHERE brand_id = $1 AND user_id = $2`) matched zero rows.
--
-- Root cause: the prior backfill migration handled brand owners that existed
-- AT migration time but explicitly deferred the trigger that would make this
-- self-healing on FUTURE brand creates ("Future brand creates should also
-- create this row — separate fix in the brand creation flow (not this
-- migration)" — `20260513000001_b2a_v3_owner_team_members_backfill.sql:14-15`).
-- That separate fix is THIS migration.
--
-- Auth gate analysis: `requirePaymentsManager` at
-- `supabase/functions/_shared/stripeEdgeAuth.ts:56-73` calls
-- `biz_can_manage_payments_for_brand` which delegates to
-- `biz_brand_effective_rank` at
-- `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql:2987-3017`.
-- That helper returns `account_owner` rank from `brands.account_id` even
-- without a `brand_team_members` row, so auth correctly passes for new
-- owners — the failure was strictly the data-layer UPDATE finding no row to
-- mutate. This trigger guarantees the row always exists.
--
-- Design choice: `mingla_tos_accepted_at` is set to NULL for new owners
-- (NOT grandfathered) because new brand creators must traverse the V3 ToS
-- gate just like any other admin per I-PROPOSED-U. The grandfathering of
-- `now()` in the prior backfill migration was specifically for owners who
-- pre-existed the V3 ToS rollout.
--
-- Schema constraints satisfied:
--   - `brand_team_members_role_check`: 'account_owner' is in the allowed set
--   - `brand_team_members_accepted_removed_excl`: accepted_at IS NOT NULL
--     (= NEW.created_at) AND removed_at IS NULL — both branches of the CHECK
--     are satisfied
--
-- Idempotency: `IF NOT EXISTS` guard guarantees safe re-run + safe coexistence
-- with the prior backfill migration. No unique constraint on
-- (brand_id, user_id) per `brand_team_members_pkey` (id only) and prior
-- backfill schema notes — so `ON CONFLICT` is intentionally not used.
--
-- Cross-references:
--   - Prior backfill: 20260513000001_b2a_v3_owner_team_members_backfill.sql
--   - ToS columns: 20260511000005_b2a_v3_tos_acceptance.sql
--   - Edge fn that depended on the row: supabase/functions/brand-mingla-tos-accept/index.ts:84-105
--   - Investigation: Mingla_Artifacts/reports/INVESTIGATION_B2A_PATH_C_V3_E2E_PIPELINE.md
--   - Dispatch prompt: Mingla_Artifacts/prompts/IMPL_B2A_PATH_C_V3_RC-3_OWNER_TEAM_MEMBER_TRIGGER.md
--   - Invariant gated by this row: I-PROPOSED-U (Mingla ToS gate before Stripe Connect ops)

-- =============================================================
-- Trigger function
-- =============================================================
-- SECURITY DEFINER + locked search_path mirrors local convention
-- (e.g., biz_brand_effective_rank). SECURITY DEFINER bypasses RLS on the
-- INSERT into brand_team_members for newly-inserted brands — required
-- because the current auth.uid() at brand-INSERT time is the owner, but
-- the team-member INSERT may be governed by RLS that pre-dates the
-- expectation that owners always have a row.
--
-- The function deliberately returns NEW unchanged. AFTER triggers' return
-- value is ignored except for AFTER UPDATE/DELETE chained logic — included
-- here for plpgsql conformity.

CREATE OR REPLACE FUNCTION "public"."biz_create_brand_owner_team_member"()
  RETURNS "trigger"
  LANGUAGE "plpgsql"
  SECURITY DEFINER
  SET "search_path" TO 'public', 'pg_temp'
  AS $$
BEGIN
  -- Defensive: brands.account_id is NOT NULL at the column level, but guard
  -- explicitly so a future schema relaxation can't turn this trigger into
  -- a NULL-row writer.
  IF NEW.account_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Idempotency guard: if any prior path already created the (brand_id, user_id)
  -- row (e.g., the one-time backfill block at the end of this migration runs
  -- ahead of this trigger for an already-existing brand, or a future code path
  -- that inserts the team-member row inline), skip silently.
  IF EXISTS (
    SELECT 1
    FROM public.brand_team_members
    WHERE brand_id = NEW.id
      AND user_id  = NEW.account_id
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.brand_team_members (
    brand_id,
    user_id,
    role,
    invited_at,
    accepted_at,
    removed_at,
    mingla_tos_accepted_at,
    mingla_tos_version_accepted
  )
  VALUES (
    NEW.id,
    NEW.account_id,
    'account_owner',
    NEW.created_at,
    NEW.created_at,    -- owner is auto-accepted as a member from creation
    NULL,              -- still active
    NULL,              -- INTENTIONAL: new owners must traverse V3 ToS gate
    NULL               -- (per I-PROPOSED-U); only pre-existing owners were
                       -- grandfathered by 20260513000001.
  );

  RETURN NEW;
END;
$$;

ALTER FUNCTION "public"."biz_create_brand_owner_team_member"() OWNER TO "postgres";

COMMENT ON FUNCTION "public"."biz_create_brand_owner_team_member"() IS
  'B2a Path C V3 RC-3 fix: AFTER INSERT ON brands trigger fn that auto-creates the account_owner brand_team_members row so V3 ToS gate (brand-mingla-tos-accept) UPDATE always matches a row. Closes the deferred fix flagged at 20260513000001:12-15. Idempotent.';

-- =============================================================
-- Trigger
-- =============================================================
-- AFTER INSERT FOR EACH ROW so NEW.id is guaranteed non-NULL (uuid default
-- generated at insert) and brands row is fully committed to the table.

DROP TRIGGER IF EXISTS "biz_brand_owner_team_member_after_insert" ON "public"."brands";

CREATE TRIGGER "biz_brand_owner_team_member_after_insert"
  AFTER INSERT ON "public"."brands"
  FOR EACH ROW
  EXECUTE FUNCTION "public"."biz_create_brand_owner_team_member"();

COMMENT ON TRIGGER "biz_brand_owner_team_member_after_insert" ON "public"."brands" IS
  'B2a Path C V3 RC-3: ensures every new brand has a brand_team_members(role=account_owner) row for its owner so V3 ToS gate UPDATE always matches.';

-- =============================================================
-- One-time backfill — catches brands inserted between the prior backfill
-- (20260513000001) and this migration's deploy. Mirrors the prior backfill's
-- LEFT JOIN ... WHERE NULL pattern but with NULL ToS state instead of
-- grandfathered, because these are post-V3-launch brands whose owners did
-- not pre-exist V3 — they must traverse the ToS gate.
-- =============================================================
INSERT INTO public.brand_team_members (
  brand_id,
  user_id,
  role,
  invited_at,
  accepted_at,
  removed_at,
  mingla_tos_accepted_at,
  mingla_tos_version_accepted
)
SELECT
  b.id            AS brand_id,
  b.account_id    AS user_id,
  'account_owner' AS role,
  b.created_at    AS invited_at,
  b.created_at    AS accepted_at,
  NULL::timestamptz AS removed_at,
  NULL::timestamptz AS mingla_tos_accepted_at,    -- post-V3 owner: must accept via gate
  NULL::text        AS mingla_tos_version_accepted
FROM public.brands b
LEFT JOIN public.brand_team_members tm
  ON tm.brand_id = b.id
  AND tm.user_id = b.account_id
WHERE tm.user_id IS NULL
  AND b.account_id IS NOT NULL
  AND b.deleted_at IS NULL;

-- =============================================================
-- Verification probes (read-only; no state mutation)
-- =============================================================
-- Mirrors ORCH-0734 (20260507000000) belt-and-suspenders pattern: each probe
-- raises an exception if the migration's intent isn't reflected in catalog
-- state, so `supabase db push` fails loudly rather than silently shipping a
-- broken migration.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'biz_create_brand_owner_team_member'
  ) THEN
    RAISE EXCEPTION 'B2a V3 RC-3 verification probe failed: trigger function not registered';
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'biz_brand_owner_team_member_after_insert'
      AND tgrelid = 'public.brands'::regclass
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'B2a V3 RC-3 verification probe failed: trigger not attached to public.brands';
  END IF;
END$$;

-- Backfill closure probe: every non-soft-deleted brand with non-NULL
-- account_id MUST now have a brand_team_members row for that account_id.
-- This proves both the prior backfill + this migration's one-time block
-- combined, leaving zero gaps for the trigger to handle on future inserts.
DO $$
DECLARE
  v_orphans int;
BEGIN
  SELECT count(*) INTO v_orphans
  FROM public.brands b
  LEFT JOIN public.brand_team_members tm
    ON tm.brand_id = b.id
    AND tm.user_id = b.account_id
  WHERE tm.user_id IS NULL
    AND b.account_id IS NOT NULL
    AND b.deleted_at IS NULL;

  IF v_orphans > 0 THEN
    RAISE EXCEPTION 'B2a V3 RC-3 verification probe failed: % brand owners still lack brand_team_members rows after backfill', v_orphans;
  END IF;
END$$;
