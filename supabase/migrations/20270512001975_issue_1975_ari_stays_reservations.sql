-- ===========================================================================
-- Issue #1975 — Ari stays & venue reservations: optimistic-concurrency for the
-- venue reservation lifecycle.
-- ---------------------------------------------------------------------------
-- The Stay reservation Edge contracts (`stay-reservations`) and Stay authoring
-- Edge (`manage-stay-inventory`) already carry idempotency + expectedVersion,
-- so Ari's Stay tools reuse them unchanged. The one missing primitive for
-- #1975 is on the VENUE side: `public.reservations` had no revision column and
-- `biz_reservation_transition` had no expected-version parameter, so #1975's
-- optimistic-concurrency requirement could not be satisfied.
--
-- This migration is ADDITIVE and NON-DESTRUCTIVE:
--   1. Add `reservations.version bigint NOT NULL DEFAULT 1 CHECK (version > 0)`.
--      The DEFAULT backfills every existing row to 1 with no data loss.
--   2. A BEFORE UPDATE trigger increments `version` on EVERY update, so the
--      compatibility mutators (`biz_reservation_transition`, the guest RPCs,
--      and any direct manager-plus write) keep the revision monotonic without
--      being replaced — no competing mutator, no double-count.
--   3. `issue_1975_reservation_transition` is the versioned entrypoint: it locks
--      the row, checks the exact expected version, reuses the SAME legality
--      matrix (`pg_reservation_transition_is_legal`), the SAME brand-member
--      manager-plus gate (via auth.uid()), the SAME table-belongs-to-brand rule,
--      the SAME no_show-policy-record-only behavior, and audits. The trigger
--      performs the single increment.
--
-- Caller JWT only. SECURITY DEFINER re-resolves the caller via auth.uid();
-- there is no service-role path. MONOTONIC VERSION 20270512001975.
-- Apply via the Supabase Management API after REVIEW.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Additive revision column + positive CHECK (idempotent).
-- ---------------------------------------------------------------------------
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 1;

-- #2592 A1: `pg_constraint.conname` is unique PER RELATION, not per cluster, so
-- a same-named constraint on ANY other table used to satisfy this probe and the
-- CHECK was silently never added to `public.reservations`. The lookup is scoped
-- to the target relation so only THIS table's constraint can satisfy it.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'reservations_version_positive'
       AND conrelid = 'public.reservations'::regclass
  ) THEN
    ALTER TABLE public.reservations
      ADD CONSTRAINT reservations_version_positive CHECK (version > 0);
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. Monotonic revision trigger for ALL mutators (compatibility included).
--    Every UPDATE bumps version once. Because it runs on the row image, the
--    versioned entrypoint below does NOT increment manually — it relies on this
--    single source of truth so a compat write and an Ari write cannot diverge.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_reservations_bump_version()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.version := OLD.version + 1;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS issue_1975_reservations_bump_version ON public.reservations;
CREATE TRIGGER issue_1975_reservations_bump_version
  BEFORE UPDATE ON public.reservations
  FOR EACH ROW EXECUTE FUNCTION public.tg_reservations_bump_version();

-- ---------------------------------------------------------------------------
-- 3. Versioned transition entrypoint (optimistic concurrency).
--    Same authority, legality, table, no_show, and audit behavior as
--    biz_reservation_transition; adds the exact expected-version gate.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_1975_reservation_transition(
  p_reservation_id uuid,
  p_to_status text,
  p_expected_version bigint,
  p_table_id uuid DEFAULT NULL,
  p_reason text DEFAULT NULL
) RETURNS public.reservations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_row public.reservations;
  v_from text;
  v_brand uuid;
  v_policy text;
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_row FROM public.reservations
    WHERE id = p_reservation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reservation_not_found' USING ERRCODE = 'P0002';
  END IF;
  v_from := v_row.status;
  v_brand := v_row.brand_id;

  -- Brand-member gate (manager+), identical to biz_reservation_transition.
  IF public.biz_brand_effective_rank_for_caller(v_brand)
       < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  -- Optimistic concurrency: refuse a stale expected version before any write.
  --
  -- #2592 A2: this used to raise SQLSTATE '40001' (serialization_failure).
  -- A stale expected version is a DETERMINISTIC application conflict, not a
  -- transient serialization anomaly: retrying it re-sends the SAME stale
  -- p_expected_version and fails identically, forever. PostgREST, the pooler,
  -- and common client retry wrappers all auto-retry the 40001 class, so the
  -- old code turned one caller mistake into a retry loop.
  --
  -- 'P1975' is a user-defined SQLSTATE in the repo's established issue-numbered
  -- convention (see 'P1901'/'P1902' in 20270322001902 and 20270325001857).
  -- Class 'P1' is not assigned by the SQL standard or by PostgreSQL (PostgreSQL
  -- only defines class 'P0'), so it cannot collide with a built-in condition,
  -- and it is distinct from the generic plpgsql default 'P0001' so a client can
  -- tell a version conflict apart from every other RAISE in this function.
  -- Nothing anywhere in this repository consumes '40001' from this function —
  -- it has never been applied to any database.
  IF v_row.version <> p_expected_version THEN
    RAISE EXCEPTION 'reservation_version_conflict_expected_%_actual_%',
      p_expected_version, v_row.version USING ERRCODE = 'P1975';
  END IF;

  -- Legal-transition enforcement (server-side; the heart of the invariant).
  IF NOT public.pg_reservation_transition_is_legal(v_from, p_to_status) THEN
    RAISE EXCEPTION 'illegal_transition_%_to_%', v_from, p_to_status
      USING ERRCODE = '23514';
  END IF;

  -- Any table (re)assignment must belong to the SAME brand's venue.
  IF p_table_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.venue_tables
     WHERE id = p_table_id AND brand_id = v_brand
  ) THEN
    RAISE EXCEPTION 'table_not_in_brand_%', p_table_id USING ERRCODE = '23514';
  END IF;

  -- no_show RECORDS the forfeit-policy DECISION only (NO capture here).
  IF p_to_status = 'no_show' THEN
    SELECT no_show_fee_policy INTO v_policy
      FROM public.venue_reservation_settings WHERE brand_id = v_brand;
  END IF;

  -- The BEFORE UPDATE trigger increments version exactly once.
  UPDATE public.reservations
     SET status = p_to_status,
         table_id = COALESCE(p_table_id, table_id),
         updated_at = now()
   WHERE id = p_reservation_id
   RETURNING * INTO v_row;

  INSERT INTO public.audit_log (
    user_id, brand_id, action, target_type, target_id, before, after
  ) VALUES (
    v_uid, v_brand,
    'venue_reservation.transition',
    'reservation', p_reservation_id::text,
    jsonb_build_object('status', v_from, 'version', p_expected_version),
    jsonb_build_object(
      'status', p_to_status,
      'table_id', v_row.table_id,
      'reason', p_reason,
      'no_show_fee_policy', v_policy,
      'version', v_row.version
    )
  );

  RETURN v_row;
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_1975_reservation_transition(uuid, text, bigint, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.issue_1975_reservation_transition(uuid, text, bigint, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.issue_1975_reservation_transition(uuid, text, bigint, uuid, text) TO authenticated;

COMMIT;
