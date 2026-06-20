-- META-ORCH-1161 Sub-C "b" — pre-event/trip/experience + reservation reminders.
--
-- SPEC §7.3: a scheduled job selects upcoming events (via event_dates.start_at)
-- and upcoming CONFIRMED reservations (reservations.reserved_for) inside a 24h and
-- a ~2h lead window and enqueues ONE buyer reminder per (entity, lead bucket) into
-- notification_outbox. The existing 1-min drain (20261110000003) forwards each row
-- to notify-dispatch v2 — so reminders ride the SAME simultaneous-send + can_send
-- gate + idempotency path as every other transactional moment (DEC-185).
--
-- IDEMPOTENCY: idempotency_key = '{category}:{entityId}:{leadBucket}' (leadBucket =
-- '24h'|'2h'). The notification_outbox_idempotency_idx UNIQUE makes the INSERT a
-- no-op on re-enqueue, so even an every-15-min cron that overlaps a window emits
-- EXACTLY ONE outbox row per bucket (SPEC §7.3 idempotency contract).
--
-- LEAD TIMES are env-configurable at the edge (REMINDER_LEAD_24H_HOURS /
-- REMINDER_LEAD_2H_HOURS, defaults 24 + 2) and passed into this RPC as params so
-- the policy lives in ONE place (the edge fn) while the windowed select stays a
-- single atomic SQL statement (no read-then-write race).
--
-- This is ENQUEUE ONLY — it never sends, never touches money/lifecycle. Reminders
-- only fire for upcoming PAID event orders + CONFIRMED reservations.
--
-- Cross-refs:
--   SPEC:      Mingla_Artifacts/specs/SPEC_META-ORCH-1161 §7.3 / §5.4
--   Drain:     supabase/migrations/20261110000003_orch_1161_outbox_drain_cron.sql
--   Edge fn:   supabase/functions/notify-reminders/index.ts

-- =============================================================
-- pg_notify_reminders_enqueue(p_lead_hours int, p_lead_bucket text, p_window_minutes int)
-- =============================================================
-- Enqueues reminders for entities whose start/reserved time falls inside a
-- [now + p_lead_hours - p_window_minutes/2, now + p_lead_hours + p_window_minutes/2]
-- band. p_window_minutes is the cron-cadence tolerance (default 30 → ±15 min for a
-- 15-min cron). Returns the count of rows actually enqueued (new this run).
CREATE OR REPLACE FUNCTION public.pg_notify_reminders_enqueue(
  p_lead_hours    int,
  p_lead_bucket   text,
  p_window_minutes int DEFAULT 30
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_low      timestamptz;
  v_high     timestamptz;
  v_inserted int := 0;
  v_n        int;
BEGIN
  IF p_lead_bucket NOT IN ('24h','2h') THEN
    RAISE EXCEPTION 'pg_notify_reminders_enqueue: invalid lead bucket %', p_lead_bucket;
  END IF;
  IF p_lead_hours IS NULL OR p_lead_hours <= 0 THEN
    RAISE EXCEPTION 'pg_notify_reminders_enqueue: lead hours must be positive (got %)', p_lead_hours;
  END IF;

  v_low  := now() + make_interval(hours => p_lead_hours)
                  - make_interval(mins  => p_window_minutes / 2.0);
  v_high := now() + make_interval(hours => p_lead_hours)
                  + make_interval(mins  => p_window_minutes / 2.0);

  -- 1. EVENT/trip/experience reminders → buyer of a PAID order on an upcoming date.
  --    Entity id for idempotency = order_id (one reminder per buyer-order per bucket).
  WITH upcoming AS (
    SELECT
      o.id              AS order_id,
      o.buyer_user_id   AS buyer_user_id,
      COALESCE(o.buyer_phone_e164, o.buyer_email) AS contact,
      e.brand_id        AS brand_id,
      e.title           AS event_title,
      ed.start_at       AS start_at
    FROM public.event_dates ed
    JOIN public.events e ON e.id = ed.event_id
    JOIN public.orders o ON o.event_id = e.id
    WHERE ed.start_at >= v_low
      AND ed.start_at <  v_high
      AND e.deleted_at IS NULL
      AND e.status IN ('scheduled','live')
      AND o.payment_status = 'paid'
      AND (o.buyer_user_id IS NOT NULL OR o.buyer_email IS NOT NULL OR o.buyer_phone_e164 IS NOT NULL)
  ), ins AS (
    INSERT INTO public.notification_outbox
      (category_key, user_id, contact, brand_id, payload, idempotency_key)
    SELECT
      'buyer_event_reminder',
      u.buyer_user_id,
      u.contact,
      u.brand_id,
      jsonb_build_object(
        'order_id',    u.order_id,
        'event_title', u.event_title,
        'reserved_for', u.start_at,
        'lead_bucket', p_lead_bucket
      ),
      'buyer_event_reminder:' || u.order_id::text || ':' || p_lead_bucket
    FROM upcoming u
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM ins;
  v_inserted := v_inserted + COALESCE(v_n, 0);

  -- 2. RESERVATION reminders → upcoming CONFIRMED reservations only.
  --    Entity id for idempotency = reservation_id.
  WITH upcoming AS (
    SELECT
      r.id                AS reservation_id,
      r.consumer_user_id  AS buyer_user_id,
      COALESCE(r.guest_phone_e164, r.guest_email) AS contact,
      r.brand_id          AS brand_id,
      r.reserved_for      AS reserved_for,
      r.party_size        AS party_size,
      r.guest_name        AS guest_name
    FROM public.reservations r
    WHERE r.reserved_for >= v_low
      AND r.reserved_for <  v_high
      AND r.status = 'confirmed'
      AND (r.consumer_user_id IS NOT NULL OR r.guest_email IS NOT NULL OR r.guest_phone_e164 IS NOT NULL)
  ), ins AS (
    INSERT INTO public.notification_outbox
      (category_key, user_id, contact, brand_id, payload, idempotency_key)
    SELECT
      'buyer_reservation_reminder',
      u.buyer_user_id,
      u.contact,
      u.brand_id,
      jsonb_build_object(
        'reservation_id', u.reservation_id,
        'reserved_for',   u.reserved_for,
        'party_size',     u.party_size,
        'guest_name',     u.guest_name,
        'lead_bucket',    p_lead_bucket
      ),
      'buyer_reservation_reminder:' || u.reservation_id::text || ':' || p_lead_bucket
    FROM upcoming u
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM ins;
  v_inserted := v_inserted + COALESCE(v_n, 0);

  RETURN v_inserted;
END;
$function$;

-- SECURITY DEFINER auto-grant gotcha — REVOKE PUBLIC + anon; only service-role
-- (via the edge fn) and authenticated callers may execute. The edge fn uses the
-- service-role client (bypasses RLS), so authenticated EXECUTE is belt-and-braces.
REVOKE ALL ON FUNCTION public.pg_notify_reminders_enqueue(int, text, int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pg_notify_reminders_enqueue(int, text, int) FROM anon;
GRANT EXECUTE ON FUNCTION public.pg_notify_reminders_enqueue(int, text, int) TO authenticated, service_role;

COMMENT ON FUNCTION public.pg_notify_reminders_enqueue(int, text, int) IS
  'META-ORCH-1161 §7.3 — enqueues buyer event/reservation reminders into '
  'notification_outbox for entities inside a lead-time window. ENQUEUE ONLY; '
  'idempotent per {category}:{entityId}:{leadBucket} via the outbox UNIQUE.';
