-- ISSUE #1403 — exact-venue reservation performance.
--
-- Additive overload only. The deployed one-argument
-- public.reservation_metrics_rollup(uuid) is deliberately untouched.

CREATE FUNCTION public.reservation_metrics_rollup(
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
  v_authorized boolean;
  v_default_ccy text;
  v_tz text;
  v_tz_confidence text;
  v_offset_min integer;
  v_place_pool_id uuid;
  v_result jsonb;
BEGIN
  IF p_brand_id IS NULL OR p_venue_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT venue.brand_id, venue.place_pool_id
  INTO v_venue_brand_id, v_place_pool_id
  FROM public.venue_listings venue
  WHERE venue.id = p_venue_id
    AND venue.brand_id = p_brand_id;

  v_authorized := v_venue_brand_id IS NOT NULL
    AND (
      public.is_admin_user()
      OR public.biz_is_brand_member_for_read_for_caller(v_venue_brand_id)
    );

  IF NOT v_authorized THEN
    RETURN jsonb_build_object(
      'brand_id', p_brand_id,
      'venue_id', p_venue_id,
      'authorized', false,
      'resolved_timezone', NULL,
      'tz_confidence', NULL,
      'covers_30d', 0,
      'covers_lifetime', 0,
      'avg_party_size', 0,
      'no_show_rate', 0,
      'by_source', '[]'::jsonb,
      'value_cents_30d', '{}'::jsonb,
      'value_cents_lifetime', '{}'::jsonb
    );
  END IF;

  SELECT COALESCE(NULLIF(TRIM(UPPER(brand.default_currency)), ''), 'GBP')
  INTO v_default_ccy
  FROM public.brands brand
  WHERE brand.id = v_venue_brand_id;
  v_default_ccy := COALESCE(v_default_ccy, 'GBP');

  SELECT availability.iana_timezone
  INTO v_tz
  FROM public.venue_availability_config availability
  JOIN public.analytics_iana_timezones valid_timezone
    ON valid_timezone.name = availability.iana_timezone
  WHERE availability.brand_id = p_brand_id
    AND availability.venue_id = p_venue_id
  LIMIT 1;

  IF v_tz IS NOT NULL THEN
    v_tz_confidence := 'iana';
  ELSE
    SELECT place.utc_offset_minutes
    INTO v_offset_min
    FROM public.place_pool place
    WHERE place.id = v_place_pool_id
      AND place.utc_offset_minutes IS NOT NULL;

    IF v_offset_min IS NOT NULL THEN
      v_tz_confidence := 'offset';
      v_tz := NULL;
    ELSE
      v_tz := 'UTC';
      v_tz_confidence := 'utc';
    END IF;
  END IF;

  WITH base AS MATERIALIZED (
    SELECT
      reservation.status,
      reservation.party_size,
      reservation.source,
      reservation.payment_status,
      reservation.fee_cents,
      COALESCE(
        NULLIF(TRIM(UPPER(reservation.fee_currency::text)), ''),
        v_default_ccy
      ) AS ccy,
      CASE
        WHEN v_tz IS NOT NULL
          THEN (reservation.reserved_for AT TIME ZONE v_tz)::date
        ELSE (
          reservation.reserved_for
          + make_interval(mins => v_offset_min)
        )::date
      END AS local_date
    FROM public.reservations reservation
    WHERE reservation.brand_id = p_brand_id
      AND reservation.venue_id = p_venue_id
      AND reservation.status NOT IN (
        'cancelled_by_guest',
        'cancelled_by_venue'
      )
  ),
  local_window AS (
    SELECT CASE
      WHEN v_tz IS NOT NULL THEN (now() AT TIME ZONE v_tz)::date
      ELSE (now() + make_interval(mins => v_offset_min))::date
    END AS today
  ),
  by_source AS (
    SELECT
      base.source,
      COUNT(*)::bigint AS reservations,
      COALESCE(
        SUM(base.party_size) FILTER (
          WHERE base.status IN ('seated', 'completed')
        ),
        0
      )::bigint AS covers
    FROM base
    GROUP BY base.source
  ),
  value_lifetime AS (
    SELECT base.ccy, SUM(base.fee_cents)::bigint AS cents
    FROM base
    WHERE base.payment_status = 'paid'
      AND COALESCE(base.fee_cents, 0) > 0
    GROUP BY base.ccy
    HAVING SUM(base.fee_cents) > 0
  ),
  value_30d AS (
    SELECT base.ccy, SUM(base.fee_cents)::bigint AS cents
    FROM base, local_window
    WHERE base.payment_status = 'paid'
      AND COALESCE(base.fee_cents, 0) > 0
      AND base.local_date > local_window.today - 30
    GROUP BY base.ccy
    HAVING SUM(base.fee_cents) > 0
  )
  SELECT jsonb_build_object(
    'brand_id', p_brand_id,
    'venue_id', p_venue_id,
    'authorized', true,
    'resolved_timezone',
      COALESCE(
        v_tz,
        CASE
          WHEN v_offset_min IS NOT NULL
            THEN 'UTC'
              || CASE WHEN v_offset_min >= 0 THEN '+' ELSE '' END
              || (v_offset_min / 60)::text
          ELSE 'UTC'
        END
      ),
    'tz_confidence', v_tz_confidence,
    'covers_30d', (
      SELECT COALESCE(SUM(base.party_size), 0)::bigint
      FROM base, local_window
      WHERE base.status IN ('seated', 'completed')
        AND base.local_date > local_window.today - 30
    ),
    'covers_lifetime', (
      SELECT COALESCE(SUM(base.party_size), 0)::bigint
      FROM base
      WHERE base.status IN ('seated', 'completed')
    ),
    'avg_party_size', (
      SELECT COALESCE(ROUND(AVG(base.party_size)::numeric, 2), 0)
      FROM base
    ),
    'no_show_rate', (
      SELECT CASE
        WHEN COUNT(*) FILTER (
          WHERE base.status IN ('seated', 'completed', 'no_show')
        ) > 0
          THEN ROUND(
            (COUNT(*) FILTER (WHERE base.status = 'no_show'))::numeric
            / (COUNT(*) FILTER (
              WHERE base.status IN ('seated', 'completed', 'no_show')
            ))::numeric,
            4
          )
        ELSE 0
      END
      FROM base
    ),
    'by_source',
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'source', source_row.source,
              'reservations', source_row.reservations,
              'covers', source_row.covers
            )
            ORDER BY source_row.reservations DESC, source_row.source
          )
          FROM by_source source_row
        ),
        '[]'::jsonb
      ),
    'value_cents_30d',
      COALESCE(
        (SELECT jsonb_object_agg(ccy, cents) FROM value_30d),
        '{}'::jsonb
      ),
    'value_cents_lifetime',
      COALESCE(
        (SELECT jsonb_object_agg(ccy, cents) FROM value_lifetime),
        '{}'::jsonb
      )
  )
  INTO v_result;

  RETURN v_result;
END;
$function$;

COMMENT ON FUNCTION public.reservation_metrics_rollup(uuid, uuid) IS
  'ISSUE #1403: exact-venue reservation performance. Proves venue-brand ownership and active member/admin authorization, filters reservations before aggregation by brand_id + venue_id, resolves timezone from the exact venue, and preserves the one-argument rollup definitions without modifying that legacy function.';

REVOKE EXECUTE ON FUNCTION public.reservation_metrics_rollup(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reservation_metrics_rollup(uuid, uuid)
  TO authenticated;
