-- ORCH-1186-B [venue-unify] — Venue Overview → Intelligence dashboard read RPC.
--
-- Buckets are VENUE-LOCAL (Constitution #12): hour-of-day and day-of-week are
-- computed via `AT TIME ZONE v_tz`, never raw UTC. The weekday convention is
-- 0=Monday..6=Sunday to match brand_hours (Postgres EXTRACT(dow) returns
-- 0=Sunday, so we remap `((dow + 6) % 7)`). Revenue is bucketed PER-CURRENCY,
-- never cross-summed (Constitution #10). See SPEC ORCH-1186-B §4.2.
--
-- Source: public.orders joined to public.events (orders link to a venue only
-- via their events; there is NO biz_event_orders table). Owner-only via an
-- explicit auth.uid() = brands.account_id assertion (fail-closed, 42501).
--
-- No new table, no new column, no RLS change: a SECURITY DEFINER function that
-- self-authorizes on auth.uid().

DROP FUNCTION IF EXISTS public.venue_intelligence_overview(uuid);

CREATE OR REPLACE FUNCTION public.venue_intelligence_overview(p_brand_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_tz            text;
  v_tz_confidence text;
  v_offset_min    integer;
  v_default_ccy   text;
  v_place_pool_id uuid;
  v_order_count   integer := 0;
  v_first_order   timestamptz;
  v_hours         jsonb;
  v_days          jsonb;
  v_revenue_trend jsonb;
  v_revenue_ccy   jsonb;
  v_rev7d_ccy     jsonb;
  v_signal_scores jsonb;
BEGIN
  -- ── Authorization (fail-closed, owner-only) ──────────────────────────────
  IF NOT EXISTS (
    SELECT 1 FROM public.brands b
    WHERE b.id = p_brand_id AND b.account_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'not authorized for brand %', p_brand_id USING ERRCODE = '42501';
  END IF;

  SELECT b.default_currency, b.place_pool_id
    INTO v_default_ccy, v_place_pool_id
    FROM public.brands b
   WHERE b.id = p_brand_id;

  v_default_ccy := COALESCE(NULLIF(TRIM(UPPER(v_default_ccy)), ''), 'GBP');

  -- ── Timezone resolution ladder (§4.1) ────────────────────────────────────
  -- (1) reservations availability config IANA zone (DST-aware)
  -- (2) the brand's most-common non-UTC events.timezone (DST-aware)
  -- (3) static utc_offset_minutes (NOT DST-aware) — fixed-offset bucketing
  -- (4) 'UTC'
  SELECT vac.iana_timezone
    INTO v_tz
    FROM public.venue_availability_config vac
   WHERE vac.brand_id = p_brand_id
     AND vac.iana_timezone IS NOT NULL
   LIMIT 1;

  IF v_tz IS NOT NULL THEN
    v_tz_confidence := 'iana';
  ELSE
    SELECT e.timezone
      INTO v_tz
      FROM public.events e
     WHERE e.brand_id = p_brand_id
       AND e.deleted_at IS NULL
       AND e.timezone IS NOT NULL
       AND e.timezone <> 'UTC'
     GROUP BY e.timezone
     ORDER BY COUNT(*) DESC, e.timezone ASC
     LIMIT 1;

    IF v_tz IS NOT NULL THEN
      v_tz_confidence := 'iana';
    ELSE
      -- (3) static offset on the place_pool, if present
      SELECT pp.utc_offset_minutes
        INTO v_offset_min
        FROM public.place_pool pp
       WHERE pp.id = v_place_pool_id
         AND pp.utc_offset_minutes IS NOT NULL;

      IF v_offset_min IS NOT NULL THEN
        v_tz_confidence := 'offset';
        v_tz := NULL; -- bucket via interval, not a named zone
      ELSE
        v_tz := 'UTC';
        v_tz_confidence := 'utc';
      END IF;
    END IF;
  END IF;

  -- ── Source set: paid, non-failed/cancelled/refunded orders for this venue ─
  -- Order timestamp = COALESCE(confirmed_at, created_at) ("paid at").
  -- The local instant per order is computed once below in the CTE.
  WITH base AS (
    SELECT
      COALESCE(o.confirmed_at, o.created_at) AS paid_at,
      -- venue-local timestamp: named zone when known, else a fixed-offset shift
      CASE
        WHEN v_tz IS NOT NULL
          THEN (COALESCE(o.confirmed_at, o.created_at) AT TIME ZONE v_tz)
        ELSE (COALESCE(o.confirmed_at, o.created_at)
               + make_interval(mins => v_offset_min))
      END AS local_ts,
      COALESCE(NULLIF(TRIM(UPPER(o.currency)), ''), v_default_ccy) AS ccy,
      (o.total_cents - COALESCE(o.refunded_amount_cents, 0))       AS net_cents
    FROM public.orders o
    JOIN public.events e
      ON e.id = o.event_id
     AND e.brand_id = p_brand_id
     AND e.deleted_at IS NULL
    WHERE o.payment_status NOT IN ('failed', 'cancelled', 'refunded')
  )
  SELECT
    COUNT(*)::int,
    MIN(paid_at)
    INTO v_order_count, v_first_order
  FROM base;

  -- hours[]: all 24 buckets, 0-filled, hour = EXTRACT(hour FROM local_ts)
  SELECT jsonb_agg(jsonb_build_object('hour', h.hour, 'orders', COALESCE(c.cnt, 0))
                   ORDER BY h.hour)
    INTO v_hours
  FROM generate_series(0, 23) AS h(hour)
  LEFT JOIN (
    SELECT EXTRACT(hour FROM b.local_ts)::int AS hour, COUNT(*)::int AS cnt
    FROM (
      SELECT
        CASE
          WHEN v_tz IS NOT NULL
            THEN (COALESCE(o.confirmed_at, o.created_at) AT TIME ZONE v_tz)
          ELSE (COALESCE(o.confirmed_at, o.created_at)
                 + make_interval(mins => v_offset_min))
        END AS local_ts
      FROM public.orders o
      JOIN public.events e
        ON e.id = o.event_id AND e.brand_id = p_brand_id AND e.deleted_at IS NULL
      WHERE o.payment_status NOT IN ('failed', 'cancelled', 'refunded')
    ) b
    GROUP BY 1
  ) c ON c.hour = h.hour;

  -- days[]: all 7 buckets, 0-filled, weekday 0=Mon..6=Sun via ((dow+6)%7)
  SELECT jsonb_agg(jsonb_build_object('weekday', d.weekday, 'orders', COALESCE(c.cnt, 0))
                   ORDER BY d.weekday)
    INTO v_days
  FROM generate_series(0, 6) AS d(weekday)
  LEFT JOIN (
    SELECT ((EXTRACT(dow FROM b.local_ts)::int + 6) % 7) AS weekday, COUNT(*)::int AS cnt
    FROM (
      SELECT
        CASE
          WHEN v_tz IS NOT NULL
            THEN (COALESCE(o.confirmed_at, o.created_at) AT TIME ZONE v_tz)
          ELSE (COALESCE(o.confirmed_at, o.created_at)
                 + make_interval(mins => v_offset_min))
        END AS local_ts
      FROM public.orders o
      JOIN public.events e
        ON e.id = o.event_id AND e.brand_id = p_brand_id AND e.deleted_at IS NULL
      WHERE o.payment_status NOT IN ('failed', 'cancelled', 'refunded')
    ) b
    GROUP BY 1
  ) c ON c.weekday = d.weekday;

  -- revenue_trend: last 30 calendar days (venue-local), default-currency only,
  -- oldest→newest, 0-filled.
  SELECT jsonb_build_object(
           'currency', v_default_ccy,
           'days', COALESCE(jsonb_agg(
             jsonb_build_object('date', to_char(g.d, 'YYYY-MM-DD'),
                                'net_cents', COALESCE(r.net_cents, 0))
             ORDER BY g.d), '[]'::jsonb)
         )
    INTO v_revenue_trend
  FROM (
    SELECT (
      (CASE
         WHEN v_tz IS NOT NULL THEN (now() AT TIME ZONE v_tz)::date
         ELSE ((now() + make_interval(mins => v_offset_min)))::date
       END) - g.day_offset
    ) AS d
    FROM generate_series(0, 29) AS g(day_offset)
  ) g
  LEFT JOIN (
    SELECT b.local_date AS d, SUM(b.net_cents)::bigint AS net_cents
    FROM (
      SELECT
        (CASE
           WHEN v_tz IS NOT NULL
             THEN (COALESCE(o.confirmed_at, o.created_at) AT TIME ZONE v_tz)
           ELSE (COALESCE(o.confirmed_at, o.created_at)
                  + make_interval(mins => v_offset_min))
         END)::date AS local_date,
        (o.total_cents - COALESCE(o.refunded_amount_cents, 0)) AS net_cents,
        COALESCE(NULLIF(TRIM(UPPER(o.currency)), ''), v_default_ccy) AS ccy
      FROM public.orders o
      JOIN public.events e
        ON e.id = o.event_id AND e.brand_id = p_brand_id AND e.deleted_at IS NULL
      WHERE o.payment_status NOT IN ('failed', 'cancelled', 'refunded')
    ) b
    WHERE b.ccy = v_default_ccy
    GROUP BY b.local_date
  ) r ON r.d = g.d;

  -- revenue_by_currency: lifetime net cents per currency (NEVER cross-summed)
  SELECT COALESCE(jsonb_object_agg(t.ccy, t.net_cents), '{}'::jsonb)
    INTO v_revenue_ccy
  FROM (
    SELECT
      COALESCE(NULLIF(TRIM(UPPER(o.currency)), ''), v_default_ccy) AS ccy,
      SUM(o.total_cents - COALESCE(o.refunded_amount_cents, 0))::bigint AS net_cents
    FROM public.orders o
    JOIN public.events e
      ON e.id = o.event_id AND e.brand_id = p_brand_id AND e.deleted_at IS NULL
    WHERE o.payment_status NOT IN ('failed', 'cancelled', 'refunded')
    GROUP BY 1
  ) t;

  -- rev7d_by_currency: last-7-day net cents per currency (venue-local window)
  SELECT COALESCE(jsonb_object_agg(t.ccy, t.net_cents), '{}'::jsonb)
    INTO v_rev7d_ccy
  FROM (
    SELECT
      COALESCE(NULLIF(TRIM(UPPER(o.currency)), ''), v_default_ccy) AS ccy,
      SUM(o.total_cents - COALESCE(o.refunded_amount_cents, 0))::bigint AS net_cents
    FROM public.orders o
    JOIN public.events e
      ON e.id = o.event_id AND e.brand_id = p_brand_id AND e.deleted_at IS NULL
    WHERE o.payment_status NOT IN ('failed', 'cancelled', 'refunded')
      AND (
        CASE
          WHEN v_tz IS NOT NULL
            THEN (COALESCE(o.confirmed_at, o.created_at) AT TIME ZONE v_tz)::date
          ELSE ((COALESCE(o.confirmed_at, o.created_at)
                  + make_interval(mins => v_offset_min)))::date
        END
      ) > (
        CASE
          WHEN v_tz IS NOT NULL THEN (now() AT TIME ZONE v_tz)::date
          ELSE ((now() + make_interval(mins => v_offset_min)))::date
        END - 7
      )
    GROUP BY 1
  ) t;

  -- signal_scores: place_pool.ai_signal_scores is a JSONB OBJECT keyed by
  -- signal id, value = { score_0_to_100, inappropriate_for, ... }. Transform to
  -- [{ id, score }], filtering inappropriate_for=true, sorted score desc.
  -- (Mirrors VenueListingContent.tsx scoreRows transform.)
  SELECT COALESCE(jsonb_agg(s.row ORDER BY (s.row->>'score')::int DESC), '[]'::jsonb)
    INTO v_signal_scores
  FROM (
    SELECT jsonb_build_object(
             'id', kv.key,
             'score', COALESCE((kv.value->>'score_0_to_100')::int, 0)
           ) AS row
    FROM public.place_pool pp
    CROSS JOIN LATERAL jsonb_each(pp.ai_signal_scores) AS kv(key, value)
    WHERE pp.id = v_place_pool_id
      AND v_place_pool_id IS NOT NULL
      AND jsonb_typeof(pp.ai_signal_scores) = 'object'
      AND COALESCE((kv.value->>'inappropriate_for')::boolean, false) = false
  ) s;

  RETURN jsonb_build_object(
    'resolved_timezone',     COALESCE(v_tz, CASE WHEN v_offset_min IS NOT NULL
                                                 THEN 'UTC' || (CASE WHEN v_offset_min >= 0 THEN '+' ELSE '' END)
                                                      || (v_offset_min / 60)::text
                                                 ELSE 'UTC' END),
    'tz_confidence',         v_tz_confidence,
    'brand_default_currency', v_default_ccy,
    'order_count',           v_order_count,
    'first_order_at',        v_first_order,
    'hours',                 COALESCE(v_hours, '[]'::jsonb),
    'days',                  COALESCE(v_days, '[]'::jsonb),
    'revenue_trend',         v_revenue_trend,
    'revenue_by_currency',   v_revenue_ccy,
    'rev7d_by_currency',     v_rev7d_ccy,
    'signal_scores',         v_signal_scores
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.venue_intelligence_overview(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.venue_intelligence_overview(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.venue_intelligence_overview(uuid) TO authenticated;

COMMENT ON FUNCTION public.venue_intelligence_overview(uuid) IS
  'ORCH-1186-B: owner-only venue intelligence rollup. Orders (via their events) bucketed by hour-of-day + day-of-week in the venue-LOCAL timezone (Constitution #12; weekday 0=Mon..6=Sun to match brand_hours), 30-day revenue trend + lifetime/7-day net per-currency (Constitution #10, never cross-summed), and ai_signal_scores reframed as which-moments-you-win. SECURITY DEFINER + auth.uid()=brands.account_id fail-close. See SPEC ORCH-1186-B §4.2.';
