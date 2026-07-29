-- ISSUE-855 [Phase-4 Analytics] — PR-1 "numbers engine": 4 read-only rollup RPCs
-- that power the Analytics screen (brand hub) + per-listing Insights + the venue
-- reservation panel + the regulars list. NO UI in this PR (forward-only feed).
--
-- WRITTEN, not applied — the orchestrator/operator runs `supabase db push` from
-- MERGED main. This migration must NOT be applied to any database by the
-- implementor. Additive + idempotent ONLY (four brand-new SECURITY DEFINER
-- functions). It does NOT touch the shipped `brand_conversion_rollup` /
-- `ad_campaign_conversion_rollup` (20270115000865) or the venue tile that reads
-- them — those stay byte-stable.
--
-- ── The honest spine (why these numbers can be trusted) ─────────────────────
-- "Customers Mingla drove" = every customer who booked through a Mingla surface.
-- The honest total is computed on the SOURCE-OF-TRUTH tables, NOT on
-- ad_conversions.brand_id (which can undercount; PR-0 mitigated the fire-helper
-- race but the spine must not depend on it):
--   · public.orders  JOIN public.events  — every ticket/trip/experience sale
--       (payment_status IN ('paid','partial_refund'), source='online_checkout').
--   · public.reservations                — venue bookings Mingla drove
--       (source='mingla', not cancelled).
--   · public.event_rsvps JOIN public.events — free party RSVPs
--       (event_type='rsvp', rsvp_status='going' AND approval_status='approved').
-- Value is per-currency and NEVER cross-summed (Constitution #10). RSVPs are
-- count-only (£0). Order value is netted (total_cents - refunded_amount_cents).
--
-- ── The ad overlay (by_source = ad vs organic ONLY this PR) ─────────────────
-- The ad slice is a LEFT JOIN onto ad_conversions, NOT a second spine. A spine
-- row is "ad-driven" when a RESOLVABLE ad_conversions row references it AND that
-- conversion carries an ad handle (click_id / touch_id / campaign_id present) —
-- the exact "driven" definition the shipped brand_conversion_rollup uses.
-- Linkage (verified against _shared/adConversionFire.ts):
--   · order       → ad_conversions.order_id = orders.id   (the FK).
--   · reservation → ad_conversions.event_id = reservations.id::text  (reservation
--                   conversions set the text dedup key = reservation id; order_id
--                   is NULL — there is NO ad_conversions.reservation_id column).
--   · rsvp        → ad_conversions.event_id = event_rsvps.id::text   (LEFT JOIN;
--                   no match ⇒ organic — an honest floor, never fabricated).
-- Source split THIS PR is Ad vs Organic/other ONLY. The referrer/entry_source
-- capture that unlocks Search / Social / Organic-Mingla is PR-2 (forward-only)
-- and is deliberately NOT built here.
--
-- Distinct-customer counting is on a normalized identity key
--   COALESCE(lower(trim(email)), phone)
-- with a per-row fallback ('o:'/'r:'/'e:' || id) so contact-less rows each count
-- once (never collapsed to a single phantom customer, never cross-linked).
--
-- MIGRATION HYGIENE: version prefix 20270120000855 is strictly greater than the
-- current origin/main head 20270119001354 (issue_1354) and carries the issue
-- number (855). Every function is REVOKEd from PUBLIC + anon and granted ONLY to
-- authenticated (ORCH-1392 SECURITY DEFINER anon gate); each self-authorizes
-- internally (admin OR brand member) and returns an honest-empty authorized:false
-- payload to anyone else — it never leaks another brand's rows.

-- ════════════════════════════════════════════════════════════════════════════
-- 1. brand_mingla_drove_rollup(p_brand_id) — the Analytics hub total
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.brand_mingla_drove_rollup(p_brand_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_authorized  boolean;
  v_default_ccy text;
  v_result      jsonb;
BEGIN
  IF p_brand_id IS NULL THEN
    RETURN NULL;
  END IF;

  v_authorized := public.is_admin_user()
    OR public.biz_is_brand_member_for_read_for_caller(p_brand_id);
  IF NOT v_authorized THEN
    -- Never leak another brand: honest-empty, zero-filled, no rows.
    RETURN jsonb_build_object(
      'brand_id', p_brand_id,
      'authorized', false,
      'mingla_drove_30d', 0,
      'mingla_drove_lifetime', 0,
      'value_cents_30d', '{}'::jsonb,
      'value_cents_lifetime', '{}'::jsonb,
      'by_source', '[]'::jsonb,
      'by_platform', '[]'::jsonb
    );
  END IF;

  SELECT COALESCE(NULLIF(TRIM(UPPER(b.default_currency)), ''), 'GBP')
    INTO v_default_ccy
    FROM public.brands b
   WHERE b.id = p_brand_id;
  v_default_ccy := COALESCE(v_default_ccy, 'GBP');

  WITH tx AS (
    -- Paid ticket / trip / experience orders (online checkout only).
    SELECT
      COALESCE(NULLIF(lower(trim(o.buyer_email)), ''), o.buyer_phone_e164, 'o:' || o.id::text) AS customer_key,
      COALESCE(o.confirmed_at, o.created_at)                                                   AS created_at,
      COALESCE(NULLIF(TRIM(UPPER(o.currency)), ''), v_default_ccy)                             AS ccy,
      GREATEST(o.total_cents - COALESCE(o.refunded_amount_cents, 0), 0)::bigint                AS value_cents,
      (ac.id IS NOT NULL)                                                                      AS is_ad,
      ac.platform                                                                              AS ad_platform
    FROM public.orders o
    JOIN public.events e
      ON e.id = o.event_id AND e.brand_id = p_brand_id AND e.deleted_at IS NULL
    LEFT JOIN LATERAL (
      SELECT c.id, c.platform
      FROM public.ad_conversions c
      WHERE c.order_id = o.id
        AND (c.click_id IS NOT NULL OR c.touch_id IS NOT NULL OR c.campaign_id IS NOT NULL)
      ORDER BY c.created_at DESC
      LIMIT 1
    ) ac ON true
    WHERE o.payment_status IN ('paid', 'partial_refund')
      AND o.source = 'online_checkout'

    UNION ALL

    -- Mingla-sourced venue reservations (not cancelled). Paid fee carries value.
    SELECT
      COALESCE(NULLIF(lower(trim(r.guest_email)), ''), r.guest_phone_e164, 'r:' || r.id::text) AS customer_key,
      r.created_at                                                                             AS created_at,
      COALESCE(NULLIF(TRIM(UPPER(r.fee_currency::text)), ''), v_default_ccy)                    AS ccy,
      (CASE WHEN r.payment_status = 'paid' THEN COALESCE(r.fee_cents, 0) ELSE 0 END)::bigint    AS value_cents,
      (ac.id IS NOT NULL)                                                                       AS is_ad,
      ac.platform                                                                               AS ad_platform
    FROM public.reservations r
    LEFT JOIN LATERAL (
      SELECT c.id, c.platform
      FROM public.ad_conversions c
      WHERE c.event_id = r.id::text
        AND (c.click_id IS NOT NULL OR c.touch_id IS NOT NULL OR c.campaign_id IS NOT NULL)
      ORDER BY c.created_at DESC
      LIMIT 1
    ) ac ON true
    WHERE r.brand_id = p_brand_id
      AND r.source = 'mingla'
      AND r.status NOT IN ('cancelled_by_guest', 'cancelled_by_venue')

    UNION ALL

    -- Free RSVP guests (going AND approved) — count-only, £0.
    SELECT
      COALESCE(NULLIF(lower(trim(er.guest_email)), ''), er.guest_phone, 'e:' || er.id::text) AS customer_key,
      er.created_at                                                                          AS created_at,
      v_default_ccy                                                                          AS ccy,
      0::bigint                                                                              AS value_cents,
      (ac.id IS NOT NULL)                                                                    AS is_ad,
      ac.platform                                                                            AS ad_platform
    FROM public.event_rsvps er
    JOIN public.events e
      ON e.id = er.event_id AND e.brand_id = p_brand_id AND e.deleted_at IS NULL AND e.event_type = 'rsvp'
    LEFT JOIN LATERAL (
      SELECT c.id, c.platform
      FROM public.ad_conversions c
      WHERE c.event_id = er.id::text
        AND (c.click_id IS NOT NULL OR c.touch_id IS NOT NULL OR c.campaign_id IS NOT NULL)
      ORDER BY c.created_at DESC
      LIMIT 1
    ) ac ON true
    WHERE er.rsvp_status = 'going' AND er.approval_status = 'approved'
  ),
  value_life AS (
    SELECT ccy, SUM(value_cents)::bigint AS cents
    FROM tx GROUP BY ccy HAVING SUM(value_cents) > 0
  ),
  value_30d AS (
    SELECT ccy, SUM(value_cents)::bigint AS cents
    FROM tx WHERE created_at >= now() - interval '30 days'
    GROUP BY ccy HAVING SUM(value_cents) > 0
  ),
  src_customers AS (
    SELECT (CASE WHEN is_ad THEN 'ad' ELSE 'organic' END) AS source,
           COUNT(DISTINCT customer_key)::bigint            AS customers
    FROM tx GROUP BY 1
  ),
  src_value AS (
    SELECT (CASE WHEN is_ad THEN 'ad' ELSE 'organic' END) AS source,
           ccy, SUM(value_cents)::bigint AS cents
    FROM tx GROUP BY 1, 2 HAVING SUM(value_cents) > 0
  ),
  plat_customers AS (
    SELECT COALESCE(ad_platform, 'unknown') AS platform,
           COUNT(DISTINCT customer_key)::bigint AS customers
    FROM tx WHERE is_ad GROUP BY 1
  ),
  plat_value AS (
    SELECT COALESCE(ad_platform, 'unknown') AS platform,
           ccy, SUM(value_cents)::bigint AS cents
    FROM tx WHERE is_ad GROUP BY 1, 2 HAVING SUM(value_cents) > 0
  )
  SELECT jsonb_build_object(
    'brand_id', p_brand_id,
    'authorized', true,
    'mingla_drove_30d',
      (SELECT COUNT(DISTINCT customer_key)::bigint FROM tx WHERE created_at >= now() - interval '30 days'),
    'mingla_drove_lifetime',
      (SELECT COUNT(DISTINCT customer_key)::bigint FROM tx),
    'value_cents_30d',
      COALESCE((SELECT jsonb_object_agg(ccy, cents) FROM value_30d), '{}'::jsonb),
    'value_cents_lifetime',
      COALESCE((SELECT jsonb_object_agg(ccy, cents) FROM value_life), '{}'::jsonb),
    'by_source', jsonb_build_array(
      jsonb_build_object(
        'source', 'ad',
        'customers', COALESCE((SELECT customers FROM src_customers WHERE source = 'ad'), 0),
        'value_cents', COALESCE((SELECT jsonb_object_agg(ccy, cents) FROM src_value WHERE source = 'ad'), '{}'::jsonb)
      ),
      jsonb_build_object(
        'source', 'organic',
        'customers', COALESCE((SELECT customers FROM src_customers WHERE source = 'organic'), 0),
        'value_cents', COALESCE((SELECT jsonb_object_agg(ccy, cents) FROM src_value WHERE source = 'organic'), '{}'::jsonb)
      )
    ),
    'by_platform', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'platform', pc.platform,
        'customers', pc.customers,
        'value_cents', COALESCE((SELECT jsonb_object_agg(pv.ccy, pv.cents) FROM plat_value pv WHERE pv.platform = pc.platform), '{}'::jsonb)
      ) ORDER BY pc.customers DESC, pc.platform)
      FROM plat_customers pc
    ), '[]'::jsonb)
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.brand_mingla_drove_rollup(uuid) IS
  'ISSUE-855 PR1: brand-hub "customers Mingla drove" rollup. Honest spine = orders(+events) UNION reservations UNION event_rsvps(+events) on the source-of-truth tables (NOT ad_conversions.brand_id). Distinct customers on COALESCE(lower(trim(email)),phone); per-currency value (never cross-summed); RSVPs count-only (£0). by_source = ad-vs-organic ONLY (ad = a resolvable click_id/touch_id/campaign_id-bearing ad_conversions row on the order/reservation); by_platform = the ad slice. SECURITY DEFINER + internal admin-OR-member auth (else honest-empty authorized:false).';

-- ════════════════════════════════════════════════════════════════════════════
-- 2. entity_conversion_rollup(p_event_id) — per-listing Insights
-- ════════════════════════════════════════════════════════════════════════════
-- Events / trips / experiences / RSVPs all share events.id. Reservations do NOT
-- attach to an event (the venue uses reservation_metrics_rollup), so they are not
-- in this listing spine. Auth is on the event's brand_id.
CREATE OR REPLACE FUNCTION public.entity_conversion_rollup(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_brand_id    uuid;
  v_default_ccy text;
  v_authorized  boolean;
  v_result      jsonb;
BEGIN
  IF p_event_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT e.brand_id INTO v_brand_id
    FROM public.events e
   WHERE e.id = p_event_id;

  v_authorized := public.is_admin_user()
    OR (v_brand_id IS NOT NULL AND public.biz_is_brand_member_for_read_for_caller(v_brand_id));
  IF NOT v_authorized THEN
    RETURN jsonb_build_object(
      'event_id', p_event_id,
      'authorized', false,
      'mingla_drove_count', 0,
      'value_cents', '{}'::jsonb,
      'by_source', '[]'::jsonb,
      'by_platform', '[]'::jsonb
    );
  END IF;

  SELECT COALESCE(NULLIF(TRIM(UPPER(b.default_currency)), ''), 'GBP')
    INTO v_default_ccy
    FROM public.brands b
   WHERE b.id = v_brand_id;
  v_default_ccy := COALESCE(v_default_ccy, 'GBP');

  WITH tx AS (
    SELECT
      COALESCE(NULLIF(lower(trim(o.buyer_email)), ''), o.buyer_phone_e164, 'o:' || o.id::text) AS customer_key,
      COALESCE(NULLIF(TRIM(UPPER(o.currency)), ''), v_default_ccy)                             AS ccy,
      GREATEST(o.total_cents - COALESCE(o.refunded_amount_cents, 0), 0)::bigint                AS value_cents,
      (ac.id IS NOT NULL)                                                                      AS is_ad,
      ac.platform                                                                              AS ad_platform
    FROM public.orders o
    LEFT JOIN LATERAL (
      SELECT c.id, c.platform
      FROM public.ad_conversions c
      WHERE c.order_id = o.id
        AND (c.click_id IS NOT NULL OR c.touch_id IS NOT NULL OR c.campaign_id IS NOT NULL)
      ORDER BY c.created_at DESC
      LIMIT 1
    ) ac ON true
    WHERE o.event_id = p_event_id
      AND o.payment_status IN ('paid', 'partial_refund')
      AND o.source = 'online_checkout'

    UNION ALL

    SELECT
      COALESCE(NULLIF(lower(trim(er.guest_email)), ''), er.guest_phone, 'e:' || er.id::text) AS customer_key,
      v_default_ccy                                                                          AS ccy,
      0::bigint                                                                              AS value_cents,
      (ac.id IS NOT NULL)                                                                    AS is_ad,
      ac.platform                                                                            AS ad_platform
    FROM public.event_rsvps er
    LEFT JOIN LATERAL (
      SELECT c.id, c.platform
      FROM public.ad_conversions c
      WHERE c.event_id = er.id::text
        AND (c.click_id IS NOT NULL OR c.touch_id IS NOT NULL OR c.campaign_id IS NOT NULL)
      ORDER BY c.created_at DESC
      LIMIT 1
    ) ac ON true
    WHERE er.event_id = p_event_id
      AND er.rsvp_status = 'going' AND er.approval_status = 'approved'
  ),
  value_ccy AS (
    SELECT ccy, SUM(value_cents)::bigint AS cents
    FROM tx GROUP BY ccy HAVING SUM(value_cents) > 0
  ),
  src_customers AS (
    SELECT (CASE WHEN is_ad THEN 'ad' ELSE 'organic' END) AS source,
           COUNT(DISTINCT customer_key)::bigint            AS customers
    FROM tx GROUP BY 1
  ),
  src_value AS (
    SELECT (CASE WHEN is_ad THEN 'ad' ELSE 'organic' END) AS source,
           ccy, SUM(value_cents)::bigint AS cents
    FROM tx GROUP BY 1, 2 HAVING SUM(value_cents) > 0
  ),
  plat_customers AS (
    SELECT COALESCE(ad_platform, 'unknown') AS platform,
           COUNT(DISTINCT customer_key)::bigint AS customers
    FROM tx WHERE is_ad GROUP BY 1
  ),
  plat_value AS (
    SELECT COALESCE(ad_platform, 'unknown') AS platform,
           ccy, SUM(value_cents)::bigint AS cents
    FROM tx WHERE is_ad GROUP BY 1, 2 HAVING SUM(value_cents) > 0
  )
  SELECT jsonb_build_object(
    'event_id', p_event_id,
    'authorized', true,
    'mingla_drove_count', (SELECT COUNT(DISTINCT customer_key)::bigint FROM tx),
    'value_cents', COALESCE((SELECT jsonb_object_agg(ccy, cents) FROM value_ccy), '{}'::jsonb),
    'by_source', jsonb_build_array(
      jsonb_build_object(
        'source', 'ad',
        'customers', COALESCE((SELECT customers FROM src_customers WHERE source = 'ad'), 0),
        'value_cents', COALESCE((SELECT jsonb_object_agg(ccy, cents) FROM src_value WHERE source = 'ad'), '{}'::jsonb)
      ),
      jsonb_build_object(
        'source', 'organic',
        'customers', COALESCE((SELECT customers FROM src_customers WHERE source = 'organic'), 0),
        'value_cents', COALESCE((SELECT jsonb_object_agg(ccy, cents) FROM src_value WHERE source = 'organic'), '{}'::jsonb)
      )
    ),
    'by_platform', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'platform', pc.platform,
        'customers', pc.customers,
        'value_cents', COALESCE((SELECT jsonb_object_agg(pv.ccy, pv.cents) FROM plat_value pv WHERE pv.platform = pc.platform), '{}'::jsonb)
      ) ORDER BY pc.customers DESC, pc.platform)
      FROM plat_customers pc
    ), '[]'::jsonb)
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.entity_conversion_rollup(uuid) IS
  'ISSUE-855 PR1: per-listing (events/trips/experiences/RSVPs share events.id) conversion rollup for the Insights surface. Spine filtered to one event_id: orders(event_id) + event_rsvps(event_id, going+approved). Reservations are NOT event-scoped (use reservation_metrics_rollup). Distinct customers, per-currency value (free RSVP = count-only £0), ad-vs-organic by_source + ad by_platform. Auth on the event brand_id (admin OR member; else honest-empty authorized:false).';

-- ════════════════════════════════════════════════════════════════════════════
-- 3. reservation_metrics_rollup(p_brand_id) — the venue reservations panel
-- ════════════════════════════════════════════════════════════════════════════
-- Venue-local windows via the timezone ladder of venue_intelligence_overview
-- (20261117000000 §4.1): venue_availability_config.iana_timezone → most-common
-- non-UTC events.timezone → place_pool.utc_offset_minutes (fixed offset) → UTC.
-- The 30-day window is on reserved_for (the service date), in the venue-local
-- calendar. by_source uses the NATIVE reservations.source (mingla/phone/walk_in/
-- website/instagram). Fee value is per-currency (never cross-summed).
CREATE OR REPLACE FUNCTION public.reservation_metrics_rollup(p_brand_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_authorized    boolean;
  v_default_ccy   text;
  v_tz            text;
  v_tz_confidence text;
  v_offset_min    integer;
  v_place_pool_id uuid;
  v_result        jsonb;
BEGIN
  IF p_brand_id IS NULL THEN
    RETURN NULL;
  END IF;

  v_authorized := public.is_admin_user()
    OR public.biz_is_brand_member_for_read_for_caller(p_brand_id);
  IF NOT v_authorized THEN
    RETURN jsonb_build_object(
      'brand_id', p_brand_id,
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

  SELECT COALESCE(NULLIF(TRIM(UPPER(b.default_currency)), ''), 'GBP'), b.place_pool_id
    INTO v_default_ccy, v_place_pool_id
    FROM public.brands b
   WHERE b.id = p_brand_id;
  v_default_ccy := COALESCE(v_default_ccy, 'GBP');

  -- Timezone resolution ladder (mirror venue_intelligence_overview §4.1).
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
      SELECT pp.utc_offset_minutes
        INTO v_offset_min
        FROM public.place_pool pp
       WHERE pp.id = v_place_pool_id
         AND pp.utc_offset_minutes IS NOT NULL;

      IF v_offset_min IS NOT NULL THEN
        v_tz_confidence := 'offset';
        v_tz := NULL;
      ELSE
        v_tz := 'UTC';
        v_tz_confidence := 'utc';
      END IF;
    END IF;
  END IF;

  WITH base AS (
    SELECT
      r.status,
      r.party_size,
      r.source,
      r.payment_status,
      r.fee_cents,
      COALESCE(NULLIF(TRIM(UPPER(r.fee_currency::text)), ''), v_default_ccy) AS ccy,
      (CASE
         WHEN v_tz IS NOT NULL THEN (r.reserved_for AT TIME ZONE v_tz)::date
         ELSE ((r.reserved_for + make_interval(mins => v_offset_min)))::date
       END) AS local_date
    FROM public.reservations r
    WHERE r.brand_id = p_brand_id
      AND r.status NOT IN ('cancelled_by_guest', 'cancelled_by_venue')
  ),
  win AS (
    SELECT (CASE
              WHEN v_tz IS NOT NULL THEN (now() AT TIME ZONE v_tz)::date
              ELSE ((now() + make_interval(mins => v_offset_min)))::date
            END) AS today
  ),
  by_source AS (
    SELECT b.source,
           COUNT(*)::bigint AS reservations,
           COALESCE(SUM(b.party_size) FILTER (WHERE b.status IN ('seated', 'completed')), 0)::bigint AS covers
    FROM base b
    GROUP BY b.source
  ),
  value_life AS (
    SELECT b.ccy, SUM(b.fee_cents)::bigint AS cents
    FROM base b
    WHERE b.payment_status = 'paid' AND COALESCE(b.fee_cents, 0) > 0
    GROUP BY b.ccy HAVING SUM(b.fee_cents) > 0
  ),
  value_30d AS (
    SELECT b.ccy, SUM(b.fee_cents)::bigint AS cents
    FROM base b, win
    WHERE b.payment_status = 'paid' AND COALESCE(b.fee_cents, 0) > 0
      AND b.local_date > win.today - 30
    GROUP BY b.ccy HAVING SUM(b.fee_cents) > 0
  )
  SELECT jsonb_build_object(
    'brand_id', p_brand_id,
    'authorized', true,
    'resolved_timezone', COALESCE(v_tz, CASE WHEN v_offset_min IS NOT NULL
                                             THEN 'UTC' || (CASE WHEN v_offset_min >= 0 THEN '+' ELSE '' END)
                                                  || (v_offset_min / 60)::text
                                             ELSE 'UTC' END),
    'tz_confidence', v_tz_confidence,
    'covers_30d', (SELECT COALESCE(SUM(b.party_size), 0)::bigint
                     FROM base b, win
                    WHERE b.status IN ('seated', 'completed') AND b.local_date > win.today - 30),
    'covers_lifetime', (SELECT COALESCE(SUM(b.party_size), 0)::bigint
                          FROM base b WHERE b.status IN ('seated', 'completed')),
    'avg_party_size', (SELECT COALESCE(ROUND(AVG(b.party_size)::numeric, 2), 0) FROM base b),
    'no_show_rate', (SELECT CASE
                              WHEN COUNT(*) FILTER (WHERE b.status IN ('seated', 'completed', 'no_show')) > 0
                              THEN ROUND(
                                (COUNT(*) FILTER (WHERE b.status = 'no_show'))::numeric
                                / (COUNT(*) FILTER (WHERE b.status IN ('seated', 'completed', 'no_show')))::numeric, 4)
                              ELSE 0
                            END
                     FROM base b),
    'by_source', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'source', bs.source,
        'reservations', bs.reservations,
        'covers', bs.covers
      ) ORDER BY bs.reservations DESC, bs.source)
      FROM by_source bs
    ), '[]'::jsonb),
    'value_cents_30d', COALESCE((SELECT jsonb_object_agg(ccy, cents) FROM value_30d), '{}'::jsonb),
    'value_cents_lifetime', COALESCE((SELECT jsonb_object_agg(ccy, cents) FROM value_life), '{}'::jsonb)
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.reservation_metrics_rollup(uuid) IS
  'ISSUE-855 PR1: venue reservations panel. covers = SUM(party_size) for status seated/completed (30d venue-local on reserved_for + lifetime); avg_party_size + no_show_rate over non-cancelled; by_source on the native reservations.source; per-currency paid-fee value (never cross-summed). Venue-local windows via the venue_intelligence_overview tz ladder. SECURITY DEFINER + admin-OR-member auth (else honest-empty authorized:false).';

-- ════════════════════════════════════════════════════════════════════════════
-- 4. brand_regulars_rollup(p_brand_id) — repeat customers across listings
-- ════════════════════════════════════════════════════════════════════════════
-- A "regular" = an identity (COALESCE(lower(trim(email)), phone)) that engaged
-- MORE THAN ONE distinct listing/occasion of the brand: distinct event for
-- ticket + RSVP rows, distinct reservation for venue bookings (a listing-less
-- venue would otherwise never surface a regular). Rows with no contact are
-- excluded (they cannot be identity-resolved). PRIVACY: the contact is MASKED
-- (j***@d***.com / ***1234) — no raw email/phone is ever in the payload.
CREATE OR REPLACE FUNCTION public.brand_regulars_rollup(p_brand_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_authorized  boolean;
  v_default_ccy text;
  v_top_n       integer := 20;
  v_result      jsonb;
BEGIN
  IF p_brand_id IS NULL THEN
    RETURN NULL;
  END IF;

  v_authorized := public.is_admin_user()
    OR public.biz_is_brand_member_for_read_for_caller(p_brand_id);
  IF NOT v_authorized THEN
    RETURN jsonb_build_object(
      'brand_id', p_brand_id,
      'authorized', false,
      'regulars_count', 0,
      'top_regulars', '[]'::jsonb
    );
  END IF;

  SELECT COALESCE(NULLIF(TRIM(UPPER(b.default_currency)), ''), 'GBP')
    INTO v_default_ccy
    FROM public.brands b
   WHERE b.id = p_brand_id;
  v_default_ccy := COALESCE(v_default_ccy, 'GBP');

  WITH src AS (
    -- orders → listing = the event
    SELECT
      COALESCE(NULLIF(lower(trim(o.buyer_email)), ''), o.buyer_phone_e164) AS customer_key,
      NULLIF(lower(trim(o.buyer_email)), '')                               AS email,
      o.buyer_phone_e164                                                   AS phone,
      'event:' || o.event_id::text                                         AS listing_key,
      COALESCE(NULLIF(TRIM(UPPER(o.currency)), ''), v_default_ccy)         AS ccy,
      GREATEST(o.total_cents - COALESCE(o.refunded_amount_cents, 0), 0)::bigint AS value_cents,
      COALESCE(o.confirmed_at, o.created_at)                               AS seen_at
    FROM public.orders o
    JOIN public.events e
      ON e.id = o.event_id AND e.brand_id = p_brand_id AND e.deleted_at IS NULL
    WHERE o.payment_status IN ('paid', 'partial_refund')
      AND o.source = 'online_checkout'

    UNION ALL

    -- reservations → listing = the reservation occasion
    SELECT
      COALESCE(NULLIF(lower(trim(r.guest_email)), ''), r.guest_phone_e164),
      NULLIF(lower(trim(r.guest_email)), ''),
      r.guest_phone_e164,
      'resv:' || r.id::text,
      COALESCE(NULLIF(TRIM(UPPER(r.fee_currency::text)), ''), v_default_ccy),
      (CASE WHEN r.payment_status = 'paid' THEN COALESCE(r.fee_cents, 0) ELSE 0 END)::bigint,
      r.created_at
    FROM public.reservations r
    WHERE r.brand_id = p_brand_id
      AND r.source = 'mingla'
      AND r.status NOT IN ('cancelled_by_guest', 'cancelled_by_venue')

    UNION ALL

    -- rsvps → listing = the event
    SELECT
      COALESCE(NULLIF(lower(trim(er.guest_email)), ''), er.guest_phone),
      NULLIF(lower(trim(er.guest_email)), ''),
      er.guest_phone,
      'event:' || er.event_id::text,
      v_default_ccy,
      0::bigint,
      er.created_at
    FROM public.event_rsvps er
    JOIN public.events e
      ON e.id = er.event_id AND e.brand_id = p_brand_id AND e.deleted_at IS NULL AND e.event_type = 'rsvp'
    WHERE er.rsvp_status = 'going' AND er.approval_status = 'approved'
  ),
  filtered AS (
    SELECT * FROM src WHERE customer_key IS NOT NULL
  ),
  agg AS (
    SELECT
      customer_key,
      COUNT(*)::bigint                 AS visits,
      COUNT(DISTINCT listing_key)::bigint AS listings,
      MIN(seen_at)                     AS first_seen,
      MAX(seen_at)                     AS last_seen,
      MAX(email)                       AS any_email,
      MAX(phone)                       AS any_phone
    FROM filtered
    GROUP BY customer_key
    HAVING COUNT(DISTINCT listing_key) > 1
  ),
  agg_value AS (
    SELECT f.customer_key, f.ccy, SUM(f.value_cents)::bigint AS cents
    FROM filtered f
    JOIN agg a ON a.customer_key = f.customer_key
    GROUP BY f.customer_key, f.ccy HAVING SUM(f.value_cents) > 0
  ),
  ranked AS (
    SELECT
      a.customer_key,
      a.visits,
      a.listings,
      a.first_seen,
      a.last_seen,
      -- MASK: prefer email (j***@d***.tld), else phone (***1234), else '***'.
      CASE
        WHEN a.any_email IS NOT NULL AND position('@' in a.any_email) > 1 THEN
          substr(a.any_email, 1, 1) || '***@'
          || substr(split_part(a.any_email, '@', 2), 1, 1) || '***'
          || CASE WHEN position('.' in split_part(a.any_email, '@', 2)) > 0
                  THEN '.' || reverse(split_part(reverse(split_part(a.any_email, '@', 2)), '.', 1))
                  ELSE '' END
        WHEN a.any_email IS NOT NULL THEN substr(a.any_email, 1, 1) || '***'
        WHEN a.any_phone IS NOT NULL AND length(a.any_phone) >= 4 THEN '***' || right(a.any_phone, 4)
        WHEN a.any_phone IS NOT NULL THEN '***'
        ELSE '***'
      END AS masked_contact
    FROM agg a
    ORDER BY a.listings DESC, a.visits DESC, a.last_seen DESC NULLS LAST
    LIMIT v_top_n
  )
  SELECT jsonb_build_object(
    'brand_id', p_brand_id,
    'authorized', true,
    'regulars_count', (SELECT COUNT(*)::bigint FROM agg),
    'top_regulars', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'masked_contact', rk.masked_contact,
        'visits', rk.visits,
        'listings', rk.listings,
        'first_seen', rk.first_seen,
        'last_seen', rk.last_seen,
        'lifetime_value_cents', COALESCE((SELECT jsonb_object_agg(av.ccy, av.cents) FROM agg_value av WHERE av.customer_key = rk.customer_key), '{}'::jsonb)
      ) ORDER BY rk.listings DESC, rk.visits DESC, rk.last_seen DESC NULLS LAST)
      FROM ranked rk
    ), '[]'::jsonb)
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.brand_regulars_rollup(uuid) IS
  'ISSUE-855 PR1: repeat customers across a brand''s listings. Identity = COALESCE(lower(trim(email)),phone) unioned across orders/reservations/event_rsvps; a regular has COUNT(DISTINCT listing) > 1 (distinct event for ticket+RSVP, distinct reservation for venue bookings). Returns regulars_count + top-20 [{masked_contact, visits, listings, first_seen, last_seen, lifetime_value_cents(per-ccy)}]. PRIVACY: contact is MASKED (j***@d***.tld / ***1234) — raw PII is NEVER in the payload. SECURITY DEFINER + admin-OR-member auth (else honest-empty authorized:false).';

-- ════════════════════════════════════════════════════════════════════════════
-- 5. Grants — SECURITY DEFINER functions self-authorize; only authenticated may
--    EXECUTE. Supabase default-privileges GRANT EXECUTE to anon on every new
--    public function, so a bare REVOKE FROM PUBLIC is NOT enough — REVOKE from
--    PUBLIC **and** anon explicitly, then grant only to authenticated
--    (ORCH-1392 SECURITY DEFINER anon gate; mirrors 20270115000865).
-- ════════════════════════════════════════════════════════════════════════════
REVOKE EXECUTE ON FUNCTION public.brand_mingla_drove_rollup(uuid)  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.entity_conversion_rollup(uuid)   FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reservation_metrics_rollup(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.brand_regulars_rollup(uuid)      FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.brand_mingla_drove_rollup(uuid)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.entity_conversion_rollup(uuid)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.reservation_metrics_rollup(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.brand_regulars_rollup(uuid)      TO authenticated;
