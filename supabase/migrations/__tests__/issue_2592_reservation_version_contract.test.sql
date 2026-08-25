-- =====================================================================================
-- #2592 implementor proof — the repaired #1975 reservation version contract, executed.
--
-- Run AFTER the complete migration chain has been applied to a fresh
-- supabase/postgres:17.4.1.075:
--   psql -v ON_ERROR_STOP=1 -f supabase/migrations/__tests__/issue_2592_reservation_version_contract.test.sql
--
-- Three assertions, each of which fails when its own fix is reverted in
-- `supabase/migrations/20270512001975_issue_1975_ari_stays_reservations.sql`:
--
--   (a) the `reservations_version_positive` CHECK really lands on
--       `public.reservations` even when another relation in the SAME cluster
--       already owns a constraint of that name. `pg_constraint.conname` is unique
--       per RELATION, not per cluster, so the original unscoped probe treated an
--       unrelated table's constraint as proof and silently skipped the CHECK.
--       This test RE-CREATES that exact collision and re-applies the real
--       migration file, so a revert to the unscoped probe leaves the CHECK off
--       `public.reservations` and assertion (a) raises.
--
--   (b) a stale `p_expected_version` is refused BEFORE any write, and is refused
--       in the exact shape the rest of this repo already uses for an optimistic-
--       concurrency conflict: SQLSTATE `40001` paired with the stable literal
--       `reservation_version_conflict`, carrying the ACTUAL current version.
--       The SQLSTATE is convention (~20 sibling sites in 20270131013808,
--       20270131013809 and 20270204001448) and nothing in this repo branches on
--       it; the LITERAL is the load-bearing half, because it is what the layer
--       above translates into a user-actionable 409 instead of a 500. The
--       matching tool-layer proof lives in
--       `supabase/functions/agent-confirm-action/__tests__/issue_2592_version_conflict_status.test.ts`.
--
--   (c) `version` advances by EXACTLY one per UPDATE. One BEFORE UPDATE trigger
--       owns the increment, so the versioned entrypoint must not double-count,
--       a plain compatibility write must still bump, and a caller-supplied
--       `version` must not be able to steer it.
--
-- Fixtures live in a transaction that ROLLS BACK. The arrange/re-apply steps
-- below run at top level because the migration file carries its own
-- BEGIN/COMMIT; the decoy relation they create is dropped at the end.
-- =====================================================================================

\set ON_ERROR_STOP on

-- -------------------------------------------------------------------------------------
-- ARRANGE (a): reproduce the cluster-wide name collision the unscoped probe fell for,
-- then remove the real constraint so re-applying the migration has to re-add it.
-- -------------------------------------------------------------------------------------
DROP TABLE IF EXISTS public.issue_2592_conname_decoy;
CREATE TABLE public.issue_2592_conname_decoy (version bigint NOT NULL DEFAULT 1);
ALTER TABLE public.issue_2592_conname_decoy
  ADD CONSTRAINT reservations_version_positive CHECK (version > 0);
ALTER TABLE public.reservations
  DROP CONSTRAINT IF EXISTS reservations_version_positive;

-- Re-apply the REAL migration. It is idempotent by construction
-- (ADD COLUMN IF NOT EXISTS / CREATE OR REPLACE / DROP TRIGGER IF EXISTS).
\ir ../20270512001975_issue_1975_ari_stays_reservations.sql

BEGIN;

DO $test$
DECLARE
  v_owner    constant uuid := '25920000-0000-4000-8000-000000000001';
  v_brand    constant uuid := '25920000-0000-4000-8000-000000000101';
  v_venue    constant uuid := '25920000-0000-4000-8000-000000000201';
  v_res      public.reservations;
  v_row      public.reservations;
  v_before   bigint;
  v_after    bigint;
  v_sqlstate text;
  v_message   text;
  v_accepted boolean;
BEGIN
  -- ---------------------------------------------------------------------------
  -- (a) The CHECK survived a same-named constraint on another relation.
  -- ---------------------------------------------------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'reservations_version_positive'
       AND conrelid = 'public.issue_2592_conname_decoy'::regclass
  ) THEN
    RAISE EXCEPTION 'issue_2592_arrange_broken_decoy_constraint_missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'reservations_version_positive'
       AND conrelid = 'public.reservations'::regclass
       AND contype = 'c'
  ) THEN
    RAISE EXCEPTION
      'issue_2592_version_check_skipped_by_conname_collision: the existence probe is not scoped to public.reservations';
  END IF;

  -- ---------------------------------------------------------------------------
  -- Fixtures: one brand, owned by the caller (rank 60 >= event_manager 40), and
  -- one venue under it. Everything below rolls back.
  -- ---------------------------------------------------------------------------
  INSERT INTO auth.users (id, instance_id, aud, role, email)
  VALUES (
    v_owner, '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'issue2592-owner@test.local'
  );
  INSERT INTO public.creator_accounts (id) VALUES (v_owner);
  INSERT INTO public.brands (id, account_id, name, slug)
  VALUES (v_brand, v_owner, 'Issue 2592 Brand', 'issue2592brand');
  INSERT INTO public.venue_listings (
    id, brand_id, slug, name, lat, lng, venue_category
  ) VALUES (
    v_venue, v_brand, 'issue2592venue', 'Issue 2592 Venue',
    51.5074, -0.1278, 'restaurant'
  );

  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);

  -- The canonical venue-keyed create RPC owns every required column.
  v_res := public.biz_reservation_create(
    v_venue, now() + interval '2 hours', 2, 'phone', 'Issue 2592 Guest'
  );
  IF v_res.version IS NULL OR v_res.version < 1 THEN
    RAISE EXCEPTION 'issue_2592_new_reservation_has_no_version:%', v_res.version;
  END IF;

  -- A version at or below zero must be refused by the CHECK that (a) proved
  -- present. The BEFORE UPDATE trigger owns UPDATE, so INSERT is the only way
  -- a caller can reach the constraint directly.
  v_accepted := false;
  BEGIN
    INSERT INTO public.reservations (
      brand_id, venue_id, reserved_for, party_size, version
    ) VALUES (v_brand, v_venue, now() + interval '3 hours', 2, 0);
    v_accepted := true;
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  IF v_accepted THEN
    RAISE EXCEPTION 'issue_2592_version_check_is_not_enforced';
  END IF;

  -- ---------------------------------------------------------------------------
  -- (b) A stale expected version is refused, classifiably, before any write.
  -- ---------------------------------------------------------------------------
  v_accepted := false;
  v_sqlstate := NULL;
  v_message := NULL;
  BEGIN
    PERFORM public.issue_1975_reservation_transition(
      v_res.id, 'seated', v_res.version + 5
    );
    v_accepted := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      v_sqlstate = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
  END;
  IF v_accepted THEN
    RAISE EXCEPTION 'issue_2592_stale_expected_version_was_accepted';
  END IF;
  -- Convention parity with every other optimistic-concurrency site in the repo.
  IF v_sqlstate IS DISTINCT FROM '40001' THEN
    RAISE EXCEPTION
      'issue_2592_version_conflict_diverged_from_repo_convention:%', v_sqlstate;
  END IF;
  -- The literal is what the layer above classifies on. Without a stable prefix
  -- the conflict is indistinguishable from any other failure and degrades to a
  -- generic server fault.
  IF v_message NOT LIKE 'reservation_version_conflict%' THEN
    RAISE EXCEPTION
      'issue_2592_version_conflict_literal_is_not_classifiable:%', v_message;
  END IF;
  -- And it must hand back the ACTUAL version, so the next attempt is a fresh
  -- read rather than the same stale number re-sent unchanged.
  IF v_message NOT LIKE '%actual_' || v_res.version::text THEN
    RAISE EXCEPTION
      'issue_2592_version_conflict_does_not_report_the_current_version:%', v_message;
  END IF;

  -- The refusal happens BEFORE any write: status and version are untouched.
  SELECT * INTO v_row FROM public.reservations WHERE id = v_res.id;
  IF v_row.status <> v_res.status OR v_row.version <> v_res.version THEN
    RAISE EXCEPTION 'issue_2592_stale_conflict_mutated_the_row';
  END IF;

  -- ---------------------------------------------------------------------------
  -- (c) EXACTLY one bump per UPDATE, from every mutator.
  -- ---------------------------------------------------------------------------
  -- c1: the versioned entrypoint relies on the trigger and must not double-count.
  v_before := v_res.version;
  v_row := public.issue_1975_reservation_transition(v_res.id, 'seated', v_before);
  IF v_row.version <> v_before + 1 THEN
    RAISE EXCEPTION 'issue_2592_entrypoint_bump_not_exactly_one:%->%',
      v_before, v_row.version;
  END IF;
  IF v_row.status <> 'seated' THEN
    RAISE EXCEPTION 'issue_2592_entrypoint_did_not_transition:%', v_row.status;
  END IF;

  -- c2: a plain compatibility write bumps once too, so a compat mutator and an
  -- Ari mutator can never diverge.
  v_before := v_row.version;
  UPDATE public.reservations
     SET guest_notes = 'issue-2592-compat-write'
   WHERE id = v_res.id;
  SELECT version INTO v_after FROM public.reservations WHERE id = v_res.id;
  IF v_after <> v_before + 1 THEN
    RAISE EXCEPTION 'issue_2592_compat_write_bump_not_exactly_one:%->%',
      v_before, v_after;
  END IF;

  -- c3: a caller-supplied `version` cannot steer the counter.
  v_before := v_after;
  UPDATE public.reservations SET version = 9999 WHERE id = v_res.id;
  SELECT version INTO v_after FROM public.reservations WHERE id = v_res.id;
  IF v_after <> v_before + 1 THEN
    RAISE EXCEPTION 'issue_2592_caller_steered_the_version:%->%',
      v_before, v_after;
  END IF;

  RAISE NOTICE '#2592 reservation version contract: (a) CHECK scoped, (b) % / "%" classifiable, (c) exactly-once bump — ALL PASSED', v_sqlstate, v_message;
END;
$test$;

ROLLBACK;

DROP TABLE IF EXISTS public.issue_2592_conname_decoy;
