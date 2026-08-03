-- ISSUE #1421 — forward-only, exact-venue organic engagement capture.
BEGIN;

DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     OR to_regnamespace('cron') IS NULL THEN
    RAISE EXCEPTION 'issue_1421_pg_cron_required';
  END IF;
END
$guard$;

CREATE TABLE public.venue_organic_journeys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  venue_id uuid NOT NULL REFERENCES public.venue_listings(id) ON DELETE CASCADE,
  entry_source text NOT NULL CHECK (entry_source IN ('search','social','organic','direct')),
  surface text NOT NULL CHECK (surface IN ('buyer_web','consumer_ios','consumer_android')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '24 hours')
);

CREATE TABLE public.venue_organic_engagement_events (
  id uuid PRIMARY KEY,
  journey_id uuid NOT NULL REFERENCES public.venue_organic_journeys(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  venue_id uuid NOT NULL REFERENCES public.venue_listings(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN (
    'page_view','menu_open','reservation_start','availability_shown'
  )),
  surface text NOT NULL CHECK (surface IN ('buyer_web','consumer_ios','consumer_android')),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.venue_organic_reservation_attributions (
  reservation_id uuid PRIMARY KEY REFERENCES public.reservations(id) ON DELETE CASCADE,
  journey_id uuid NOT NULL REFERENCES public.venue_organic_journeys(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  venue_id uuid NOT NULL REFERENCES public.venue_listings(id) ON DELETE CASCADE,
  attributed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.venue_organic_capture_config (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  capture_started_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.venue_organic_capture_config(singleton) VALUES (true);

ALTER TABLE public.reservation_checkout_sessions
  ADD COLUMN organic_journey_id uuid NULL
  REFERENCES public.venue_organic_journeys(id) ON DELETE SET NULL;

CREATE INDEX venue_organic_journeys_venue_created_idx
  ON public.venue_organic_journeys(brand_id, venue_id, created_at DESC);
CREATE INDEX venue_organic_journeys_token_idx
  ON public.venue_organic_journeys(token_hash, expires_at);
CREATE INDEX venue_organic_events_venue_time_idx
  ON public.venue_organic_engagement_events(brand_id, venue_id, occurred_at DESC);
CREATE INDEX venue_organic_events_journey_idx
  ON public.venue_organic_engagement_events(journey_id);
CREATE INDEX venue_organic_attributions_venue_time_idx
  ON public.venue_organic_reservation_attributions(brand_id, venue_id, attributed_at DESC);
CREATE INDEX reservation_checkout_sessions_organic_journey_idx
  ON public.reservation_checkout_sessions(organic_journey_id)
  WHERE organic_journey_id IS NOT NULL;

ALTER TABLE public.venue_organic_journeys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_organic_journeys FORCE ROW LEVEL SECURITY;
ALTER TABLE public.venue_organic_engagement_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_organic_engagement_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.venue_organic_reservation_attributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_organic_reservation_attributions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.venue_organic_capture_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_organic_capture_config FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.venue_organic_journeys FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.venue_organic_engagement_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.venue_organic_reservation_attributions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.venue_organic_capture_config FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.venue_organic_journeys TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.venue_organic_engagement_events TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.venue_organic_reservation_attributions TO service_role;
GRANT SELECT ON public.venue_organic_capture_config TO service_role;

CREATE FUNCTION public.tg_attribute_organic_reservation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NEW.status = 'completed'
     AND NEW.reservation_id IS NOT NULL
     AND NEW.organic_journey_id IS NOT NULL
     AND (TG_OP = 'INSERT'
       OR OLD.reservation_id IS DISTINCT FROM NEW.reservation_id
       OR OLD.status IS DISTINCT FROM NEW.status
       OR OLD.organic_journey_id IS DISTINCT FROM NEW.organic_journey_id) THEN
    INSERT INTO public.venue_organic_reservation_attributions(
      reservation_id, journey_id, brand_id, venue_id
    )
    SELECT NEW.reservation_id, journey.id, NEW.brand_id, NEW.venue_id
    FROM public.venue_organic_journeys journey
    JOIN public.reservations reservation ON reservation.id = NEW.reservation_id
    WHERE journey.id = NEW.organic_journey_id
      AND journey.brand_id = NEW.brand_id
      AND journey.venue_id = NEW.venue_id
      AND reservation.brand_id = NEW.brand_id
      AND reservation.venue_id = NEW.venue_id
    ON CONFLICT (reservation_id) DO NOTHING;
  END IF;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.tg_attribute_organic_reservation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_attribute_organic_reservation() TO service_role;
CREATE TRIGGER reservation_checkout_sessions_attribute_organic
AFTER INSERT OR UPDATE
ON public.reservation_checkout_sessions
FOR EACH ROW EXECUTE FUNCTION public.tg_attribute_organic_reservation();

CREATE FUNCTION public.venue_organic_engagement_rollup(
  p_brand_id uuid,
  p_venue_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_venue_brand_id uuid;
  v_place_pool_id uuid;
  v_tz text;
  v_tz_confidence text;
  v_offset_min integer;
  v_capture_started_at timestamptz;
  v_now timestamptz := now();
BEGIN
  SELECT venue.brand_id, venue.place_pool_id
    INTO v_venue_brand_id, v_place_pool_id
  FROM public.venue_listings venue
  WHERE venue.id = p_venue_id AND venue.brand_id = p_brand_id;

  IF v_venue_brand_id IS NULL OR NOT (
    public.is_admin_user()
    OR public.biz_is_brand_member_for_read_for_caller(v_venue_brand_id)
  ) THEN
    RETURN jsonb_build_object(
      'brand_id', p_brand_id, 'venue_id', p_venue_id, 'authorized', false
    );
  END IF;

  SELECT availability.iana_timezone INTO v_tz
  FROM public.venue_availability_config availability
  JOIN public.analytics_iana_timezones zone ON zone.name = availability.iana_timezone
  WHERE availability.brand_id = p_brand_id
    AND availability.venue_id = p_venue_id
  LIMIT 1;
  IF v_tz IS NOT NULL THEN
    v_tz_confidence := 'iana';
  ELSE
    SELECT place.utc_offset_minutes INTO v_offset_min
    FROM public.place_pool place
    WHERE place.id = v_place_pool_id;
    IF v_offset_min IS NOT NULL THEN
      v_tz_confidence := 'offset';
    ELSE
      v_tz := 'UTC';
      v_tz_confidence := 'utc';
      v_offset_min := 0;
    END IF;
  END IF;

  SELECT capture_started_at INTO v_capture_started_at
  FROM public.venue_organic_capture_config WHERE singleton;

  RETURN (
    WITH eligible AS MATERIALIZED (
      SELECT event.event_type,
        CASE WHEN v_tz IS NOT NULL
          THEN event.occurred_at AT TIME ZONE v_tz
          ELSE (event.occurred_at + make_interval(mins => v_offset_min))::timestamp
        END AS local_time
      FROM public.venue_organic_engagement_events event
      JOIN public.venue_organic_journeys journey ON journey.id = event.journey_id
      WHERE event.brand_id = p_brand_id
        AND event.venue_id = p_venue_id
        AND event.occurred_at >= v_now - interval '30 days'
        AND journey.entry_source IN ('search','social','organic','direct')
        AND journey.surface IN ('buyer_web','consumer_ios','consumer_android')
    ),
    counts AS (
      SELECT
        COUNT(*) FILTER (WHERE event_type = 'page_view')::bigint AS page_views,
        COUNT(*) FILTER (WHERE event_type = 'menu_open')::bigint AS menu_opens,
        COUNT(*) FILTER (WHERE event_type = 'reservation_start')::bigint AS reservation_starts,
        COUNT(*) FILTER (WHERE event_type = 'availability_shown')::bigint AS availability_shown,
        COUNT(*) FILTER (
          WHERE event_type = 'page_view'
            AND local_time::time >= time '05:00'
            AND local_time::time < time '12:00'
        )::bigint AS morning,
        COUNT(*) FILTER (
          WHERE event_type = 'page_view'
            AND local_time::time >= time '12:00'
            AND local_time::time < time '17:00'
        )::bigint AS afternoon,
        COUNT(*) FILTER (
          WHERE event_type = 'page_view'
            AND local_time::time >= time '17:00'
            AND local_time::time < time '21:00'
        )::bigint AS evening,
        COUNT(*) FILTER (
          WHERE event_type = 'page_view'
            AND (local_time::time >= time '21:00' OR local_time::time < time '05:00')
        )::bigint AS late_night
      FROM eligible
    ),
    reservations_made AS (
      SELECT COUNT(*)::bigint AS total
      FROM public.venue_organic_reservation_attributions attribution
      JOIN public.reservations reservation
        ON reservation.id = attribution.reservation_id
       AND reservation.brand_id = p_brand_id
       AND reservation.venue_id = p_venue_id
      WHERE attribution.brand_id = p_brand_id
        AND attribution.venue_id = p_venue_id
        AND reservation.created_at >= v_now - interval '30 days'
        AND reservation.status NOT IN ('cancelled_by_guest','cancelled_by_venue')
    )
    SELECT jsonb_build_object(
      'brand_id', p_brand_id,
      'venue_id', p_venue_id,
      'authorized', true,
      'page_views', counts.page_views,
      'menu_opens', counts.menu_opens,
      'reservation_starts', counts.reservation_starts,
      'availability_shown', counts.availability_shown,
      'reservations_made', reservations_made.total,
      'dayparts', jsonb_build_object(
        'morning', counts.morning,
        'afternoon', counts.afternoon,
        'evening', counts.evening,
        'late_night', counts.late_night
      ),
      'menu_published', EXISTS (
        SELECT 1 FROM public.menus menu
        WHERE menu.brand_id = p_brand_id
          AND menu.venue_id = p_venue_id
          AND menu.is_active
      ),
      'reservations_enabled', COALESCE((
        SELECT settings.reservations_enabled
        FROM public.venue_reservation_settings settings
        WHERE settings.venue_id = p_venue_id
          AND settings.brand_id = p_brand_id
      ), false),
      'capture_started_at', v_capture_started_at,
      'window_complete', v_capture_started_at <= v_now - interval '30 days',
      'aggregated_at', v_now,
      'resolved_timezone', COALESCE(
        v_tz,
        'UTC' || CASE WHEN v_offset_min >= 0 THEN '+' ELSE '-' END
          || lpad((abs(v_offset_min) / 60)::text, 2, '0')
          || ':' || lpad((abs(v_offset_min) % 60)::text, 2, '0')
      ),
      'tz_confidence', v_tz_confidence
    )
    FROM counts, reservations_made
  );
END
$function$;

REVOKE ALL ON FUNCTION public.venue_organic_engagement_rollup(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.venue_organic_engagement_rollup(uuid, uuid)
  TO authenticated;

CREATE FUNCTION public.cleanup_venue_organic_engagement(
  p_limit integer DEFAULT 5000
)
RETURNS TABLE(events_deleted bigint, attributions_deleted bigint, journeys_deleted bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_events bigint := 0;
  v_attributions bigint := 0;
  v_journeys bigint := 0;
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 5000), 1), 10000);
BEGIN
  WITH doomed AS (
    SELECT id FROM public.venue_organic_engagement_events
    WHERE occurred_at < now() - interval '35 days'
    ORDER BY occurred_at LIMIT v_limit
  )
  DELETE FROM public.venue_organic_engagement_events event
  USING doomed WHERE event.id = doomed.id;
  GET DIAGNOSTICS v_events = ROW_COUNT;

  WITH doomed AS (
    SELECT reservation_id FROM public.venue_organic_reservation_attributions
    WHERE attributed_at < now() - interval '35 days'
    ORDER BY attributed_at LIMIT v_limit
  )
  DELETE FROM public.venue_organic_reservation_attributions attribution
  USING doomed WHERE attribution.reservation_id = doomed.reservation_id;
  GET DIAGNOSTICS v_attributions = ROW_COUNT;

  WITH doomed AS (
    SELECT journey.id FROM public.venue_organic_journeys journey
    WHERE journey.created_at < now() - interval '35 days'
      AND NOT EXISTS (
        SELECT 1 FROM public.venue_organic_engagement_events event
        WHERE event.journey_id = journey.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.venue_organic_reservation_attributions attribution
        WHERE attribution.journey_id = journey.id
      )
    ORDER BY journey.created_at LIMIT v_limit
  )
  DELETE FROM public.venue_organic_journeys journey
  USING doomed WHERE journey.id = doomed.id;
  GET DIAGNOSTICS v_journeys = ROW_COUNT;
  RETURN QUERY SELECT v_events, v_attributions, v_journeys;
END
$function$;

REVOKE ALL ON FUNCTION public.cleanup_venue_organic_engagement(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_venue_organic_engagement(integer)
  TO service_role;

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'issue_1421_venue_organic_retention') THEN
    PERFORM cron.unschedule('issue_1421_venue_organic_retention');
  END IF;
END
$cron$;
SELECT cron.schedule(
  'issue_1421_venue_organic_retention',
  '17 3 * * *',
  $job$SELECT public.cleanup_venue_organic_engagement(5000);$job$
);

DO $assert$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cron.job
    WHERE jobname = 'issue_1421_venue_organic_retention'
      AND active
      AND schedule = '17 3 * * *'
      AND command = 'SELECT public.cleanup_venue_organic_engagement(5000);'
  ) THEN
    RAISE EXCEPTION 'issue_1421_retention_schedule_invalid';
  END IF;
END
$assert$;

COMMIT;
