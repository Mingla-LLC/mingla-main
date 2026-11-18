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
-- 3. Without #4459, an order share that ends removes the account from the
--    event's buyer chat unless it is still entitled another way.
-- 4. Source changes: when a shared purchase itself changes (refund, cancel,
--    owner change, RSVP declined or denied, plus-one removed, event deleted
--    or its status changed, reservation / stay / food order state changed),
--    every live holder of it is re-synced with source
--    'purchase_share_source_changed' (or, without #4459, the buyer-chat rule
--    is applied). Bounded per change; idempotent.
--
-- No production row is changed by this file except the backfill's Guest chat
-- membership writes made through issue_4459_safe_sync, when #4459 is present.

BEGIN;
SET LOCAL lock_timeout = '10s';


-- Without #4459: leave the event's buyer chat unless something else still
-- entitles the account — a live, proven shared order on the event that is
-- still paid, or a ticket held for the event. Owning an order, being the
-- chat's creator or being on the brand team are checked by the existing
-- buyer-chat helper.
CREATE OR REPLACE FUNCTION public.issue_4473_drop_unentitled_shared_holder(
  p_event_id uuid, p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_dropped boolean;
BEGIN
  IF p_event_id IS NULL OR p_user_id IS NULL
     OR to_regprocedure('public.drop_unentitled_buyer_from_event_chat(uuid,uuid)') IS NULL THEN
    RETURN false;
  END IF;
  IF EXISTS (
    SELECT 1
      FROM public.purchase_shared_holders s
      JOIN public.orders o ON s.kind = 'order' AND o.id = s.source_id
     WHERE s.user_id = p_user_id AND s.revoked_at IS NULL
       AND o.event_id = p_event_id
       AND o.payment_status IN ('paid', 'partial_refund')
       AND public.issue_4473_holder_proves('order', o.id, p_user_id)
  ) OR EXISTS (
    SELECT 1 FROM public.tickets t
     WHERE t.event_id = p_event_id
       AND to_jsonb(t)->>'holder_user_id' = p_user_id::text
       AND t.status IN ('valid', 'used')
  ) THEN
    RETURN false;
  END IF;
  EXECUTE 'SELECT public.drop_unentitled_buyer_from_event_chat($1, $2)'
    INTO v_dropped USING p_event_id, p_user_id;
  RETURN coalesce(v_dropped, false);
END;
$function$;

-- Re-decide one holder's chat membership. With #4459 the Guest chat sync
-- re-checks eligibility (and respects leave and removal); without it, only a
-- loss is acted on, through the buyer-chat rule above.
CREATE OR REPLACE FUNCTION public.issue_4473_resync_holder(
  p_kind text, p_brand_id uuid, p_event_id uuid, p_user_id uuid,
  p_source text, p_lost boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF p_user_id IS NULL THEN RETURN; END IF;
  IF to_regprocedure('public.issue_4459_safe_sync(uuid,uuid,text)') IS NOT NULL THEN
    IF p_brand_id IS NOT NULL THEN
      EXECUTE 'SELECT public.issue_4459_safe_sync($1, $2, $3)'
        USING p_brand_id, p_user_id, p_source;
    END IF;
  ELSIF p_lost AND p_kind = 'order' THEN
    PERFORM public.issue_4473_drop_unentitled_shared_holder(p_event_id, p_user_id);
  END IF;
END;
$function$;

-- Guest chat sync on every share start, end or delete. A lapse found by the
-- expiry sweep (or an eager revocation) is labelled 'purchase_share_expiry'.
-- Without #4459, an ended order share leaves the event's buyer chat instead.
CREATE OR REPLACE FUNCTION public.tg_purchase_shared_holders_4473_guest_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row public.purchase_shared_holders%ROWTYPE;
  v_lost boolean;
BEGIN
  v_row := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  v_lost := TG_OP = 'DELETE'
    OR (TG_OP = 'UPDATE' AND OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL);
  PERFORM public.issue_4473_resync_holder(
    v_row.kind,
    coalesce(v_row.brand_id, public.issue_4473_purchase_brand(v_row.kind, v_row.source_id)),
    coalesce(v_row.event_id, public.issue_4473_purchase_event(v_row.kind, v_row.source_id)),
    v_row.user_id,
    CASE WHEN v_lost AND TG_OP = 'UPDATE' THEN 'purchase_share_expiry' ELSE 'purchase_share' END,
    v_lost
  );
  RETURN NULL;
END;
$function$;

-- Re-decide every live holder of one purchase after the purchase itself
-- changes (refund, cancel, owner change, RSVP declined, guest removed...).
-- Bounded; idempotent because the sync re-checks eligibility each time.
CREATE OR REPLACE FUNCTION public.issue_4473_resync_source_holders(
  p_kind text, p_source_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row record;
  v_count integer := 0;
BEGIN
  FOR v_row IN
    SELECT s.user_id, s.brand_id, s.event_id
      FROM public.purchase_shared_holders s
     WHERE s.kind = p_kind AND s.source_id = p_source_id AND s.revoked_at IS NULL
     ORDER BY s.user_id
     LIMIT 1000
  LOOP
    PERFORM public.issue_4473_resync_holder(
      p_kind,
      coalesce(v_row.brand_id, public.issue_4473_purchase_brand(p_kind, p_source_id)),
      coalesce(v_row.event_id, public.issue_4473_purchase_event(p_kind, p_source_id)),
      v_row.user_id, 'purchase_share_source_changed', true);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$function$;

-- The same for every live holder on an event (deleted or status changed).
CREATE OR REPLACE FUNCTION public.issue_4473_resync_event_holders(p_event_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row record;
  v_count integer := 0;
BEGIN
  FOR v_row IN
    SELECT DISTINCT ON (s.user_id) s.kind, s.user_id, s.brand_id
      FROM public.purchase_shared_holders s
     WHERE s.event_id = p_event_id AND s.revoked_at IS NULL
     ORDER BY s.user_id, CASE WHEN s.kind = 'order' THEN 0 ELSE 1 END
     LIMIT 2000
  LOOP
    PERFORM public.issue_4473_resync_holder(
      v_row.kind, v_row.brand_id, p_event_id, v_row.user_id,
      'purchase_share_source_changed', true);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tg_issue_4473_share_source_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_id uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  v_guest record;
BEGIN
  IF TG_TABLE_NAME = 'events' THEN
    PERFORM public.issue_4473_resync_event_holders(v_id);
    RETURN NULL;
  END IF;
  PERFORM public.issue_4473_resync_source_holders(TG_ARGV[0], v_id);
  -- A plus-one's standing follows its RSVP.
  IF TG_TABLE_NAME = 'event_rsvps' AND TG_OP = 'UPDATE' THEN
    FOR v_guest IN
      SELECT g.id FROM public.event_rsvp_guests g WHERE g.rsvp_id = v_id
    LOOP
      PERFORM public.issue_4473_resync_source_holders('rsvp_guest', v_guest.id);
    END LOOP;
  END IF;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS issue_4473_share_source_order ON public.orders;
CREATE TRIGGER issue_4473_share_source_order
AFTER UPDATE OF payment_status, cancelled_at, buyer_user_id, event_id OR DELETE
ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.tg_issue_4473_share_source_changed('order');

DROP TRIGGER IF EXISTS issue_4473_share_source_rsvp ON public.event_rsvps;
CREATE TRIGGER issue_4473_share_source_rsvp
AFTER UPDATE OF rsvp_status, approval_status, user_id, event_id OR DELETE
ON public.event_rsvps
FOR EACH ROW EXECUTE FUNCTION public.tg_issue_4473_share_source_changed('rsvp');

DROP TRIGGER IF EXISTS issue_4473_share_source_rsvp_guest ON public.event_rsvp_guests;
CREATE TRIGGER issue_4473_share_source_rsvp_guest
AFTER UPDATE OF matched_user_id, rsvp_id OR DELETE
ON public.event_rsvp_guests
FOR EACH ROW EXECUTE FUNCTION public.tg_issue_4473_share_source_changed('rsvp_guest');

DROP TRIGGER IF EXISTS issue_4473_share_source_event ON public.events;
CREATE TRIGGER issue_4473_share_source_event
AFTER UPDATE OF deleted_at, status ON public.events
FOR EACH ROW
WHEN (OLD.deleted_at IS DISTINCT FROM NEW.deleted_at OR OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION public.tg_issue_4473_share_source_changed('event');

DROP TRIGGER IF EXISTS issue_4473_share_source_reservation ON public.reservations;
CREATE TRIGGER issue_4473_share_source_reservation
AFTER UPDATE OF status, consumer_user_id OR DELETE ON public.reservations
FOR EACH ROW EXECUTE FUNCTION public.tg_issue_4473_share_source_changed('reservation');

DROP TRIGGER IF EXISTS issue_4473_share_source_stay_group ON public.stay_reservation_groups;
CREATE TRIGGER issue_4473_share_source_stay_group
AFTER UPDATE OF state, user_id OR DELETE ON public.stay_reservation_groups
FOR EACH ROW EXECUTE FUNCTION public.tg_issue_4473_share_source_changed('stay_group');

DROP TRIGGER IF EXISTS issue_4473_share_source_venue_order ON public.venue_orders;
CREATE TRIGGER issue_4473_share_source_venue_order
AFTER UPDATE OF payment_status, fulfillment_status, buyer_user_id OR DELETE
ON public.venue_orders
FOR EACH ROW EXECUTE FUNCTION public.tg_issue_4473_share_source_changed('venue_order');

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
        SELECT coalesce(s.brand_id,
          public.issue_4473_purchase_brand(s.kind, s.source_id)) AS brand_id
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

REVOKE ALL ON FUNCTION public.tg_purchase_shared_holders_4473_guest_sync() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4473_drop_unentitled_shared_holder(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4473_resync_holder(text, uuid, uuid, uuid, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4473_resync_source_holders(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4473_resync_event_holders(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_issue_4473_share_source_changed() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4473_resync_source_holders(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_4473_resync_event_holders(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.issue_4473_backfill_shared_guest_sync() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4473_sweep_lapsed_shared_holders(integer) FROM PUBLIC, anon, authenticated;
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
