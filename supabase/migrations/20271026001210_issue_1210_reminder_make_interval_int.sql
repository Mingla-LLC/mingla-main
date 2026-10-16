-- #1210 — pg_notify_reminders_enqueue: make_interval mins must be integer.
--
-- Symptom: notify-reminders returns HTTP 207 with
--   function make_interval(mins => numeric) does not exist
-- Root cause: `p_window_minutes / 2.0` promotes int → numeric; make_interval's
-- named `mins` parameter is integer-only.
--
-- Fix: half-window as `(p_window_minutes / 2)::int` (truncating integer division).
-- Default window is 30 → 15 either way; odd windows floor (31 → 15).
-- Body otherwise matches 20270211001529_issue_1529_notification_country_code.sql
-- (country_code via mingla_e164_country preserved).

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
  v_half_mins int;
  v_inserted int := 0;
  v_n        int;
BEGIN
  IF p_lead_bucket NOT IN ('24h','2h') THEN
    RAISE EXCEPTION 'pg_notify_reminders_enqueue: invalid lead bucket %', p_lead_bucket;
  END IF;
  IF p_lead_hours IS NULL OR p_lead_hours <= 0 THEN
    RAISE EXCEPTION 'pg_notify_reminders_enqueue: lead hours must be positive (got %)', p_lead_hours;
  END IF;

  -- #1210 — integer half-window; never pass numeric into make_interval(mins => …).
  v_half_mins := (p_window_minutes / 2)::int;

  v_low  := now() + make_interval(hours => p_lead_hours)
                  - make_interval(mins  => v_half_mins);
  v_high := now() + make_interval(hours => p_lead_hours)
                  + make_interval(mins  => v_half_mins);

  -- 1. EVENT/trip/experience reminders → buyer of a PAID order on an upcoming date.
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
      (category_key, user_id, contact, brand_id, payload, idempotency_key,
       country_code)
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
      'buyer_event_reminder:' || u.order_id::text || ':' || p_lead_bucket,
      public.mingla_e164_country(u.contact)
    FROM upcoming u
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM ins;
  v_inserted := v_inserted + COALESCE(v_n, 0);

  -- 2. RESERVATION reminders → upcoming CONFIRMED reservations only.
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
      (category_key, user_id, contact, brand_id, payload, idempotency_key,
       country_code)
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
      'buyer_reservation_reminder:' || u.reservation_id::text || ':' || p_lead_bucket,
      public.mingla_e164_country(u.contact)
    FROM upcoming u
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM ins;
  v_inserted := v_inserted + COALESCE(v_n, 0);

  RETURN v_inserted;
END;
$function$;

REVOKE ALL ON FUNCTION public.pg_notify_reminders_enqueue(int, text, int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pg_notify_reminders_enqueue(int, text, int) FROM anon;
GRANT EXECUTE ON FUNCTION public.pg_notify_reminders_enqueue(int, text, int) TO authenticated, service_role;

COMMENT ON FUNCTION public.pg_notify_reminders_enqueue(int, text, int) IS
  'Enqueues 24h/2h buyer event + reservation reminders into notification_outbox. '
  '#1210: half-window minutes are integer-typed for make_interval.';
