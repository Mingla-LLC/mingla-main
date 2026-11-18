-- Issue #4473 — keep the brand Guest chat in step with shared purchases.
--
-- 1. Backfill: every live shared holder whose proof holds is synced into the
--    #4459 brand Guest chat once (issue_4459_safe_sync is idempotent and
--    respects leave and removal). A no-op when #4459 is absent or the table is
--    empty.
-- 2. Expiry sweep: a shared holder's proof can lapse with no row changing (a
--    claim-only contact passes 12 months, or a phone number moves). An hourly
--    job, issue_4473_shared_holder_expiry, marks lapsed rows revoked
--    ('contact_lost'); the row trigger then re-syncs the Guest chat with source
--    'purchase_share_expiry'. safe_sync re-checks eligibility, so a person
--    still eligible through another booking stays in. Each run is bounded and
--    safe to re-run.
--
-- No production row is changed by this file except the backfill's Guest chat
-- membership writes made through issue_4459_safe_sync, when #4459 is present.

BEGIN;
SET LOCAL lock_timeout = '10s';

-- The brand a shared purchase belongs to.
CREATE OR REPLACE FUNCTION public.issue_4473_purchase_brand(
  p_kind text, p_source_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_brand uuid;
BEGIN
  IF p_kind = 'order' THEN
    SELECT e.brand_id INTO v_brand
      FROM public.orders o JOIN public.events e ON e.id = o.event_id
     WHERE o.id = p_source_id;
  ELSIF p_kind = 'rsvp' THEN
    SELECT e.brand_id INTO v_brand
      FROM public.event_rsvps r JOIN public.events e ON e.id = r.event_id
     WHERE r.id = p_source_id;
  ELSIF p_kind = 'rsvp_guest' THEN
    SELECT e.brand_id INTO v_brand
      FROM public.event_rsvp_guests g
      JOIN public.event_rsvps r ON r.id = g.rsvp_id
      JOIN public.events e ON e.id = r.event_id
     WHERE g.id = p_source_id;
  ELSIF p_kind = 'reservation' THEN
    SELECT r.brand_id INTO v_brand FROM public.reservations r WHERE r.id = p_source_id;
  ELSIF p_kind = 'stay_group' THEN
    SELECT g.brand_id INTO v_brand
      FROM public.stay_reservation_groups g WHERE g.id = p_source_id;
  ELSIF p_kind = 'venue_order' THEN
    SELECT vo.brand_id INTO v_brand FROM public.venue_orders vo WHERE vo.id = p_source_id;
  END IF;
  RETURN v_brand;
END;
$function$;

-- Guest chat sync on every share start, end or delete. A lapse found by the
-- expiry sweep (or an eager revocation) is labelled 'purchase_share_expiry'.
CREATE OR REPLACE FUNCTION public.tg_purchase_shared_holders_4473_guest_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row public.purchase_shared_holders%ROWTYPE;
  v_brand uuid;
  v_source text := 'purchase_share';
BEGIN
  IF to_regprocedure('public.issue_4459_safe_sync(uuid,uuid,text)') IS NULL THEN
    RETURN NULL;
  END IF;
  v_row := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  IF TG_OP = 'UPDATE' AND OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL THEN
    v_source := 'purchase_share_expiry';
  END IF;
  v_brand := public.issue_4473_purchase_brand(v_row.kind, v_row.source_id);
  IF v_brand IS NOT NULL THEN
    EXECUTE 'SELECT public.issue_4459_safe_sync($1, $2, $3)'
      USING v_brand, v_row.user_id, v_source;
  END IF;
  RETURN NULL;
END;
$function$;

-- One-time (and re-runnable) Guest chat sync of every live, proven holder.
CREATE OR REPLACE FUNCTION public.issue_4473_backfill_shared_guest_sync()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row record;
  v_count integer := 0;
BEGIN
  IF to_regprocedure('public.issue_4459_safe_sync(uuid,uuid,text)') IS NULL THEN
    RETURN 0;
  END IF;
  FOR v_row IN
    SELECT DISTINCT b.brand_id, s.user_id
      FROM public.purchase_shared_holders s
      CROSS JOIN LATERAL (
        SELECT public.issue_4473_purchase_brand(s.kind, s.source_id) AS brand_id
      ) b
     WHERE s.revoked_at IS NULL
       AND b.brand_id IS NOT NULL
       AND public.issue_4473_holder_proves(s.kind, s.source_id, s.user_id)
     ORDER BY b.brand_id, s.user_id
  LOOP
    EXECUTE 'SELECT public.issue_4459_safe_sync($1, $2, $3)'
      USING v_row.brand_id, v_row.user_id, 'purchase_share';
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$function$;

-- Bounded expiry sweep. Rows locked by another run are skipped; rows already
-- revoked are never touched again, so re-running is safe.
CREATE OR REPLACE FUNCTION public.issue_4473_sweep_lapsed_shared_holders(
  p_limit integer DEFAULT 500
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_count integer;
BEGIN
  WITH lapsed AS (
    SELECT s.kind, s.source_id, s.user_id
      FROM public.purchase_shared_holders s
     WHERE s.revoked_at IS NULL
       AND NOT public.issue_4473_holder_proves(s.kind, s.source_id, s.user_id)
     ORDER BY s.created_at, s.kind, s.source_id, s.user_id
     LIMIT greatest(1, least(coalesce(p_limit, 500), 5000))
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.purchase_shared_holders s
     SET revoked_at = now(), revoked_reason = 'contact_lost'
    FROM lapsed l
   WHERE s.kind = l.kind AND s.source_id = l.source_id AND s.user_id = l.user_id
     AND s.revoked_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_4473_purchase_brand(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_purchase_shared_holders_4473_guest_sync() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4473_backfill_shared_guest_sync() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4473_sweep_lapsed_shared_holders(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4473_purchase_brand(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_4473_backfill_shared_guest_sync() TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_4473_sweep_lapsed_shared_holders(integer) TO service_role;

SELECT public.issue_4473_backfill_shared_guest_sync();

-- Hourly expiry sweep. Looked up by name and rescheduled in one block.
DO $cron$
BEGIN
  IF to_regnamespace('cron') IS NULL THEN
    RAISE NOTICE '#4473: pg_cron unavailable; shared holder expiry sweep not scheduled';
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'issue_4473_shared_holder_expiry'
  ) THEN
    PERFORM cron.unschedule('issue_4473_shared_holder_expiry');
  END IF;
  PERFORM cron.schedule(
    'issue_4473_shared_holder_expiry',
    '23 * * * *',
    $job$SELECT public.issue_4473_sweep_lapsed_shared_holders(500)$job$
  );
END;
$cron$;

COMMIT;
