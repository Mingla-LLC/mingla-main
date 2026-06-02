-- ORCH-1047 — rename the brand role `account_owner` → `brand_owner` across
-- SQL ground truth in a single transaction. Mechanical rename only — zero
-- behavior change, zero permission change, zero new tables/columns/RPCs.
--
-- Why: Mingla "account" (`creator_accounts`) is the auth-side identity;
-- `brands` are the managed entities; the role lives on
-- `brand_team_members.role` and is per-brand, not per-account. Calling it
-- `account_owner` confused every downstream spec. Unblocks META-ORCH-1048.
--
-- Pre-rename ground-truth touchpoints (each one updated below):
--   - `biz_role_rank('account_owner') = 60` baseline 20260505:3315-3328
--   - `biz_brand_effective_rank` calls `biz_role_rank('account_owner')`
--     baseline 20260505:2987-3017
--   - `brand_team_members_role_check` baseline 20260505:7750
--   - `brand_invitations_role_check` baseline 20260505:7728
--   - `biz_create_brand_owner_team_member` trigger function body inserts
--     `'account_owner'` literal at 20260514:107 + 161
--   - `brand_payment_managers_select_stripe_disputes` RLS policy IN-list
--     20260726:46
--
-- Hard guards:
--   - Single transaction (BEGIN/COMMIT). All DDL + DML atomic.
--   - Data-preserving: existing rows UPDATE'd in same tx; CHECK constraints
--     re-added with the new literal so no orphaned data.
--   - Idempotent re-run: every CREATE OR REPLACE / DROP IF EXISTS guard.
--   - No new permission surface — RLS policies are dropped and re-created
--     with IDENTICAL predicate logic, only the role string flips.
--
-- Cross-refs:
--   - SPEC dispatch: Mingla_Artifacts/prompts/SPEC_ORCH-1047_BRAND_OWNER_ROLE_RENAME.md
--   - Memory: feedback-rls-returning-owner-gap, migration-history-drift-db-push-unsafe

BEGIN;

-- =============================================================
-- 1. Drop the existing CHECK constraints that gate the OLD literal
-- =============================================================
-- These must come off before the UPDATE so the row-rewrite below isn't
-- blocked by its own constraint. (UPDATE pre-check vs post-check race is
-- not a problem because UPDATE is permissive while the constraint is gone.)

ALTER TABLE public.brand_team_members
  DROP CONSTRAINT IF EXISTS brand_team_members_role_check;

ALTER TABLE public.brand_invitations
  DROP CONSTRAINT IF EXISTS brand_invitations_role_check;

-- =============================================================
-- 2. Data rewrite: every row.role = 'account_owner' → 'brand_owner'
-- =============================================================
-- Audit the rewrite so the operator can confirm row count matches the
-- pre-flight probe (forensics estimated based on production data; if the
-- count differs significantly investigate before re-running).

DO $$
DECLARE
  v_team_rows int;
  v_invite_rows int;
BEGIN
  UPDATE public.brand_team_members
    SET role = 'brand_owner'
    WHERE role = 'account_owner';
  GET DIAGNOSTICS v_team_rows = ROW_COUNT;
  RAISE NOTICE 'ORCH-1047: renamed % brand_team_members rows from account_owner to brand_owner', v_team_rows;

  UPDATE public.brand_invitations
    SET role = 'brand_owner'
    WHERE role = 'account_owner';
  GET DIAGNOSTICS v_invite_rows = ROW_COUNT;
  RAISE NOTICE 'ORCH-1047: renamed % brand_invitations rows from account_owner to brand_owner', v_invite_rows;
END$$;

-- =============================================================
-- 3. Re-add CHECK constraints with the new literal
-- =============================================================

ALTER TABLE public.brand_team_members
  ADD CONSTRAINT brand_team_members_role_check
  CHECK (role = ANY (ARRAY[
    'brand_owner'::text,
    'brand_admin'::text,
    'event_manager'::text,
    'finance_manager'::text,
    'marketing_manager'::text,
    'scanner'::text
  ]));

ALTER TABLE public.brand_invitations
  ADD CONSTRAINT brand_invitations_role_check
  CHECK (role = ANY (ARRAY[
    'brand_owner'::text,
    'brand_admin'::text,
    'event_manager'::text,
    'finance_manager'::text,
    'marketing_manager'::text,
    'scanner'::text
  ]));

-- =============================================================
-- 4. Re-define biz_role_rank() — flip the WHEN literal
-- =============================================================
-- Pattern preserved verbatim from baseline 20260505:3315-3328 — only the
-- WHEN string changes. 'account_owner' falls through to ELSE 0 so any stale
-- caller fails closed (NO_MEMBERSHIP_RANK semantics).

CREATE OR REPLACE FUNCTION public.biz_role_rank(p_role text) RETURNS integer
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT CASE trim(lower(coalesce(p_role, '')))
    WHEN 'scanner' THEN 10
    WHEN 'marketing_manager' THEN 20
    WHEN 'finance_manager' THEN 30
    WHEN 'event_manager' THEN 40
    WHEN 'brand_admin' THEN 50
    WHEN 'brand_owner' THEN 60
    ELSE 0
  END;
$$;

ALTER FUNCTION public.biz_role_rank(text) OWNER TO postgres;

COMMENT ON FUNCTION public.biz_role_rank(text) IS
  'Cycle B1 (ORCH-1047 rename): numeric rank for brand_team_members.role comparisons (higher = more privilege). brand_owner=60.';

-- =============================================================
-- 5. Re-define biz_brand_effective_rank() — synthesized-owner uses new label
-- =============================================================
-- The synthesized-owner branch passes `biz_role_rank('account_owner')` which
-- now returns 0 — that would silently demote solo brand creators to
-- no-membership rank. Flip the literal to `'brand_owner'` so it returns 60
-- as before. Logic otherwise verbatim from baseline 20260505:2987-3017.

CREATE OR REPLACE FUNCTION public.biz_brand_effective_rank(p_brand_id uuid, p_user_id uuid) RETURNS integer
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT GREATEST(
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM public.brands b
        WHERE b.id = p_brand_id
          AND b.account_id = p_user_id
          AND b.deleted_at IS NULL
      )
      THEN public.biz_role_rank('brand_owner'::text)
      ELSE 0
    END,
    COALESCE(
      (
        SELECT max(public.biz_role_rank(m.role))
        FROM public.brand_team_members m
        INNER JOIN public.brands b ON b.id = m.brand_id
        WHERE m.brand_id = p_brand_id
          AND m.user_id = p_user_id
          AND m.removed_at IS NULL
          AND m.accepted_at IS NOT NULL
          AND b.deleted_at IS NULL
      ),
      0
    )
  );
$$;

ALTER FUNCTION public.biz_brand_effective_rank(uuid, uuid) OWNER TO postgres;

-- =============================================================
-- 6. Re-define biz_create_brand_owner_team_member() trigger fn
-- =============================================================
-- Function NAME was always brand_owner-themed; only the INSERTed role
-- literal changes. Body otherwise verbatim from 20260514:67-118 with the
-- single string flip. Idempotency guard + SECURITY DEFINER preserved.

CREATE OR REPLACE FUNCTION public.biz_create_brand_owner_team_member()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $$
BEGIN
  IF NEW.account_id IS NULL THEN
    RETURN NEW;
  END IF;

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
    'brand_owner',
    NEW.created_at,
    NEW.created_at,
    NULL,
    NULL,
    NULL
  );

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.biz_create_brand_owner_team_member() OWNER TO postgres;

COMMENT ON FUNCTION public.biz_create_brand_owner_team_member() IS
  'B2a Path C V3 RC-3 (ORCH-1047 rename): AFTER INSERT ON brands trigger fn that auto-creates the brand_owner brand_team_members row so V3 ToS gate (brand-mingla-tos-accept) UPDATE always matches a row. Idempotent.';

COMMENT ON TRIGGER biz_brand_owner_team_member_after_insert ON public.brands IS
  'B2a Path C V3 RC-3 (ORCH-1047 rename): ensures every new brand has a brand_team_members(role=brand_owner) row for its owner so V3 ToS gate UPDATE always matches.';

-- =============================================================
-- 7. RLS policy: brand_payment_managers_select_stripe_disputes
-- =============================================================
-- ORCH-0953 policy IN-list (`role IN ('account_owner', 'brand_admin',
-- 'finance_manager')`). DROP + re-CREATE with identical predicate logic but
-- the new role string. No new policy, no new permission.

DROP POLICY IF EXISTS "brand_payment_managers_select_stripe_disputes"
  ON public.stripe_disputes;

CREATE POLICY "brand_payment_managers_select_stripe_disputes"
  ON public.stripe_disputes FOR SELECT TO authenticated
  USING (
    brand_id IN (
      SELECT brand_id
      FROM public.brand_team_members
      WHERE user_id = auth.uid()
        AND removed_at IS NULL
        AND accepted_at IS NOT NULL
        AND role IN ('brand_owner', 'brand_admin', 'finance_manager')
    )
  );

-- =============================================================
-- 8. Verification probes
-- =============================================================
-- Belt-and-suspenders per ORCH-0734 / B2a V3 RC-3 pattern: assert end state
-- so a misconfigured migration fails loudly at apply time.

DO $$
BEGIN
  ASSERT (SELECT COUNT(*) FROM public.brand_team_members WHERE role = 'account_owner') = 0,
    'ORCH-1047 verification failed: brand_team_members still has account_owner rows';
  ASSERT (SELECT COUNT(*) FROM public.brand_invitations WHERE role = 'account_owner') = 0,
    'ORCH-1047 verification failed: brand_invitations still has account_owner rows';
  ASSERT (SELECT public.biz_role_rank('brand_owner')) = 60,
    'ORCH-1047 verification failed: biz_role_rank(brand_owner) is not 60';
  ASSERT (SELECT public.biz_role_rank('account_owner')) = 0,
    'ORCH-1047 verification failed: biz_role_rank(account_owner) did not drop to 0';
END$$;

COMMIT;
