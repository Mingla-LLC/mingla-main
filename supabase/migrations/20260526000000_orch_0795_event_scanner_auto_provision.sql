-- ORCH-0795 — Auto-provision event_scanners for brand owners / managers.
--
-- Symptom: brand owner cannot scan tickets for events they created. Every QR
-- read returns 403 because `biz_ticket_scan` requires a row in
-- `public.event_scanners` for the scanning user, and no path ever inserted
-- such a row for the owner.
--
-- Root cause: post-ORCH-0700 / Cycle 11 (B-cycle), the only INSERT path into
-- `event_scanners` is the operator-to-operator invitation flow via the
-- `accept-scanner-invitation` edge function. Brand owners were never
-- auto-provisioned, leaving 17 owned events with 0 active owner-scanner rows
-- in production at the time of this migration.
--
-- Fix: AFTER INSERT trigger on `public.events` that auto-provisions an
-- `event_scanners` row for every user with `biz_brand_effective_rank >=
-- event_manager` (40) on the event's brand. Threshold mirrors the existing
-- "Event manager plus can insert events" RLS policy exactly — anyone who
-- can create the event can scan its tickets. Backfill block applies the
-- same rule to every existing non-deleted event.
--
-- Precedent: 20260514000000_b2a_v3_brand_owner_team_member_trigger.sql
-- solved the parallel auto-provision gap for `brand_team_members`. This
-- migration mirrors that file's pattern (SECURITY DEFINER trigger fn +
-- one-time backfill + DO-block verification probes).
--
-- Pre-flight finding (read-only probe on remote, 2026-05-11):
--   4 soft-deleted rows existed in `event_scanners`, all self-assigned
--   (`assigned_by = user_id`) and removed within 1.2 seconds of assignment
--   for the SAME user. Pattern: stale churn from an earlier debugging path;
--   not deliberate operator removals. Spec ORCH-0795 §3.5 says do not
--   resurrect soft-deletes, but the spec assumes deliberate removals.
--   This migration adds a one-time §1.5 hard-delete using a SHAPE-BASED
--   predicate (self-assigned + removed < 5 s after assignment) so future
--   deliberate removals are NOT touched.
--
-- Cross-references:
--   - SPEC: Mingla_Artifacts/specs/SPEC_ORCH-0795_SCANNER_AUTO_PROVISION_AND_UX_HONESTY.md
--   - Authorization gate (untouched): 20260515000017_orch_0777_scan_wrong_event_result.sql
--   - Precedent migration: 20260514000000_b2a_v3_brand_owner_team_member_trigger.sql
--   - Invariant (DRAFT → ACTIVE on CLOSE): I-PROPOSED-AZ EVENT_HAS_MANAGER_SCANNER

-- =============================================================
-- §1. Trigger function — auto-provision on event INSERT
-- =============================================================
-- SECURITY DEFINER + locked search_path mirrors local convention
-- (biz_create_brand_owner_team_member). SECURITY DEFINER bypasses RLS on
-- the INSERT into event_scanners — the existing INSERT policy at
-- baseline_squash:14266 requires `assigned_by = auth.uid()`, which a trigger
-- cannot satisfy when the inserting principal differs from the event creator
-- (e.g. a brand_admin creating an event triggers provision for the owner).
-- SECURITY DEFINER + explicit search_path neutralises the elevated privilege.

CREATE OR REPLACE FUNCTION public.biz_event_auto_provision_scanners()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  -- Defensive: brand_id is NOT NULL at column level; guard explicitly so a
  -- future schema relaxation can't turn this trigger into a NULL-brand
  -- writer.
  IF NEW.brand_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Insert one row per qualifying user (rank >= event_manager) on the
  -- event's brand who does not already have an active scanner row for this
  -- event. Soft-deleted rows are intentionally NOT resurrected here — they
  -- represent deliberate removals (or, for the one-time pre-flight cleanup,
  -- handled by §1.5 below before this trigger ever runs against legacy
  -- rows).
  --
  -- biz_role_rank('event_manager') = 40. Candidates: account_owner (60),
  -- brand_admin (50), event_manager (40). Excluded: finance_manager (30),
  -- marketing_manager (20), scanner (10).
  INSERT INTO public.event_scanners (
    event_id,
    user_id,
    permissions,
    assigned_by,
    assigned_at,
    removed_at
  )
  SELECT
    NEW.id                                          AS event_id,
    candidate.user_id                               AS user_id,
    '{"scan": true, "take_payments": false}'::jsonb AS permissions,
    COALESCE(NEW.created_by, b.account_id)          AS assigned_by,
    NEW.created_at                                  AS assigned_at,
    NULL::timestamptz                               AS removed_at
  FROM public.brands b
  CROSS JOIN LATERAL (
    -- (a) brand owner
    SELECT b.account_id AS user_id
    WHERE b.account_id IS NOT NULL
    UNION
    -- (b) brand_team_members with rank >= event_manager
    SELECT m.user_id
    FROM public.brand_team_members m
    WHERE m.brand_id = b.id
      AND m.removed_at IS NULL
      AND m.accepted_at IS NOT NULL
      AND public.biz_role_rank(m.role) >= public.biz_role_rank('event_manager')
  ) AS candidate
  WHERE b.id = NEW.brand_id
    AND b.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.event_scanners es
      WHERE es.event_id = NEW.id
        AND es.user_id = candidate.user_id
        AND es.removed_at IS NULL
    );

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.biz_event_auto_provision_scanners() OWNER TO postgres;

COMMENT ON FUNCTION public.biz_event_auto_provision_scanners() IS
  'ORCH-0795: AFTER INSERT ON events trigger fn — auto-provisions event_scanners rows for every brand member with biz_brand_effective_rank >= event_manager (40). Idempotent. Does not resurrect soft-deleted rows. Mirrors biz_create_brand_owner_team_member precedent (20260514000000).';

-- =============================================================
-- §2. Trigger
-- =============================================================
-- AFTER INSERT FOR EACH ROW so NEW.id is guaranteed non-NULL and the events
-- row is fully committed before scanner rows reference it (FK from
-- event_scanners.event_id -> events.id ON DELETE CASCADE).

DROP TRIGGER IF EXISTS biz_event_auto_provision_scanners_after_insert ON public.events;

CREATE TRIGGER biz_event_auto_provision_scanners_after_insert
  AFTER INSERT ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.biz_event_auto_provision_scanners();

COMMENT ON TRIGGER biz_event_auto_provision_scanners_after_insert ON public.events IS
  'ORCH-0795: ensures every new event has event_scanners rows for the brand owner + every event_manager+ brand member. Closes the auto-provision gap that surfaced as scanner_not_authorized 403s for brand owners scanning their own events.';

-- =============================================================
-- §1.5. One-time pre-flight cleanup of churn-pattern soft-deletes
-- =============================================================
-- Spec §3.5 keeps the "do not resurrect soft-deleted rows" rule for the
-- trigger (deliberate removals deserve respect). But the pre-flight probe
-- found 4 rows in production that were self-assigned and removed in under
-- 1.2 seconds — clearly broken-flow churn, not deliberate operator action.
-- This shape-based predicate hard-deletes that class of row exactly:
--   * `assigned_by = user_id` (self-assignment, not a manager invite)
--   * `removed_at - assigned_at < interval '5 seconds'` (no human could
--     invite and remove themselves through UI in 5 seconds)
--   * `removed_at IS NOT NULL` (only soft-deleted candidates)
--
-- Idempotent: running twice is safe; second run matches 0 rows.

DO $$
DECLARE
  v_deleted int;
BEGIN
  DELETE FROM public.event_scanners
  WHERE removed_at IS NOT NULL
    AND assigned_by = user_id
    AND (removed_at - assigned_at) < interval '5 seconds';

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RAISE NOTICE 'ORCH-0795 §1.5 churn cleanup: hard-deleted % stray soft-deleted scanner rows', v_deleted;
END$$;

-- =============================================================
-- §3. One-time backfill — every existing event with no active scanner row
-- for a qualifying user gets one inserted.
-- =============================================================
-- Mirrors §1 trigger logic exactly but iterates over `events` rather than
-- firing on insert. Idempotent: NOT EXISTS guard skips already-provisioned
-- (event, user) pairs.

DO $$
DECLARE
  v_inserted int;
BEGIN
  INSERT INTO public.event_scanners (
    event_id,
    user_id,
    permissions,
    assigned_by,
    assigned_at,
    removed_at
  )
  SELECT
    e.id                                            AS event_id,
    candidate.user_id                               AS user_id,
    '{"scan": true, "take_payments": false}'::jsonb AS permissions,
    COALESCE(e.created_by, b.account_id)            AS assigned_by,
    e.created_at                                    AS assigned_at,
    NULL::timestamptz                               AS removed_at
  FROM public.events e
  JOIN public.brands b ON b.id = e.brand_id
  CROSS JOIN LATERAL (
    SELECT b.account_id AS user_id
    WHERE b.account_id IS NOT NULL
    UNION
    SELECT m.user_id
    FROM public.brand_team_members m
    WHERE m.brand_id = b.id
      AND m.removed_at IS NULL
      AND m.accepted_at IS NOT NULL
      AND public.biz_role_rank(m.role) >= public.biz_role_rank('event_manager')
  ) AS candidate
  WHERE e.deleted_at IS NULL
    AND b.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.event_scanners es
      WHERE es.event_id = e.id
        AND es.user_id = candidate.user_id
        AND es.removed_at IS NULL
    );

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RAISE NOTICE 'ORCH-0795 backfill: inserted % event_scanners rows', v_inserted;
END$$;

-- =============================================================
-- §4. Verification probes — fail the migration loudly if state isn't right.
-- =============================================================

-- Probe 1: trigger function registered
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'biz_event_auto_provision_scanners'
  ) THEN
    RAISE EXCEPTION 'ORCH-0795 probe failed: trigger function not registered';
  END IF;
END$$;

-- Probe 2: trigger attached to public.events
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'biz_event_auto_provision_scanners_after_insert'
      AND tgrelid = 'public.events'::regclass
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'ORCH-0795 probe failed: trigger not attached to public.events';
  END IF;
END$$;

-- Probe 3: backfill closure — every non-deleted event with a non-deleted
-- brand whose account_id is non-null MUST now have at least one active
-- event_scanners row for that brand owner.
DO $$
DECLARE
  v_orphans int;
BEGIN
  SELECT count(*) INTO v_orphans
  FROM public.events e
  JOIN public.brands b ON b.id = e.brand_id
  WHERE e.deleted_at IS NULL
    AND b.deleted_at IS NULL
    AND b.account_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.event_scanners es
      WHERE es.event_id = e.id
        AND es.user_id = b.account_id
        AND es.removed_at IS NULL
    );

  IF v_orphans > 0 THEN
    RAISE EXCEPTION
      'ORCH-0795 probe failed: % events still lack an active scanner row for their brand owner after backfill',
      v_orphans;
  END IF;
END$$;
