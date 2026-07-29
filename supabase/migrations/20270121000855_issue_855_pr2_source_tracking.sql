-- ISSUE-855 [Phase-4 Analytics] — PR-2 "source tracking": begin distinguishing a
-- Mingla-driven customer's SOURCE (ad / search / social / organic / direct) so the
-- Analytics "by source" breakdown can go beyond ad-vs-organic. FORWARD-ONLY.
--
-- WRITTEN, not applied — the orchestrator/operator runs `supabase db push` from
-- MERGED main. This migration must NOT be applied by the implementor. Additive +
-- idempotent ONLY: two nullable columns on ad_attribution_touches, one CHECK, and
-- a CREATE OR REPLACE of exactly two of PR-1's rollups. It does NOT touch the
-- shipped brand_conversion_rollup / ad_campaign_conversion_rollup (20270115000865),
-- reservation_metrics_rollup / brand_regulars_rollup (20270120000855 — byte-stable),
-- nor any purchase/finalize path.
--
-- ── The linkage (how an organic booking resolves its source) ─────────────────
-- Reuses the EXISTING ad click_id threading verbatim — NO new session plumbing,
-- NO new join key:
--   1. On a public visit the browser now records a first-party touch even with NO
--      ad signal (attribution-capture::recordTouch), classifying entry_source from
--      document.referrer's HOST (server-side), and mints a click_id.
--   2. The browser threads that click_id into checkout on the SAME path an ad
--      click already uses → ticket_checkout_sessions.attribution_click_id (WP-C).
--   3. Post-finalize, adConversionFire already resolves click_id → touch and stamps
--      ad_conversions.touch_id (no change there).
--   4. These rollups already LEFT JOIN the spine → ad_conversions; PR-2 adds ONE
--      join ad_conversions.touch_id → ad_attribution_touches to read entry_source.
--
-- ── HONEST forward-only source split (the trap this avoids) ──────────────────
-- PR-1 defined "ad" as: a resolvable ad_conversions row carrying click_id/touch_id/
-- campaign_id. Post-PR-2 an ORGANIC touch ALSO carries a first-party click_id (and
-- thus touch_id on its conversion), so that rule would MISCLASSIFY organic as ad.
-- Fix: entry_source is AUTHORITATIVE when present; the PR-1 handle rule is used
-- ONLY when entry_source IS NULL (pre-capture / touch predates PR-2 / no touch).
-- This preserves PR-1 byte-for-byte on all historical data (no touch carries an
-- entry_source until PR-2 deploys) and never fabricates a source:
--   · entry_source = 'ad'                       → ad
--   · entry_source IN ('search','social','direct') → that source
--   · entry_source IN ('organic','unknown')     → organic
--   · entry_source IS NULL + click_id/touch_id/campaign_id present → ad (PR-1 rule)
--   · otherwise (no conversion / no handle)      → organic  (honest floor, incl. the
--                                                  ENTIRE pre-capture period)
-- INVARIANT preserved: ad + [organic+search+social+direct] == PR-1's ad + organic.
-- PR-2 only SUBDIVIDES the former 'organic' bucket for date-from-deploy touches;
-- the honest TOTAL (mingla_drove_*, value_cents_*) and by_platform are untouched.
--
-- MIGRATION HYGIENE: version prefix 20270121000855 is strictly greater than the
-- current origin/main head 20270120000855 (issue_855 PR-1) and carries the issue
-- number (855).

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Schema — entry_source + referrer_host on the touch (nullable, additive).
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.ad_attribution_touches
  ADD COLUMN IF NOT EXISTS entry_source  text NULL,
  ADD COLUMN IF NOT EXISTS referrer_host text NULL;

-- CHECK on the allowed entry_source values (guarded — ADD CONSTRAINT has no
-- IF NOT EXISTS, so a re-apply must not error). NULL is allowed (pre-capture rows).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ad_attribution_touches_entry_source_check'
      AND conrelid = 'public.ad_attribution_touches'::regclass
  ) THEN
    ALTER TABLE public.ad_attribution_touches
      ADD CONSTRAINT ad_attribution_touches_entry_source_check
      CHECK (entry_source IS NULL OR entry_source IN
        ('ad', 'search', 'social', 'organic', 'direct', 'unknown'));
  END IF;
END $$;

COMMENT ON COLUMN public.ad_attribution_touches.entry_source IS
  'ISSUE-855 PR-2 (FORWARD-ONLY): server-classified source of the visit that recorded this touch — ad | search | social | organic | direct | unknown. Set by attribution-capture::recordTouch from an ad click-id (=> ad) else the referrer HOST (search/social host-set; a Mingla domain => organic; some other site => unknown; empty referrer + no ad signal => direct). NULL on every row that predates the PR-2 deploy (no backfill) — such rows read as ad-vs-organic exactly as PR-1 did.';

COMMENT ON COLUMN public.ad_attribution_touches.referrer_host IS
  'ISSUE-855 PR-2 (FORWARD-ONLY): the HOST of document.referrer only (no path/query/fragment — SC-8/SC-9 no-PII discipline). Fed the entry_source classifier. NULL for direct visits, app deep-links, and every pre-PR-2 row.';

-- ════════════════════════════════════════════════════════════════════════════
-- 2. brand_mingla_drove_rollup — by_source now splits the non-ad slice by the
--    touch entry_source (search/social/organic/direct), ad stays ad. Everything
--    else (spine, totals, by_platform, auth, currency) is byte-identical to PR-1.
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

  WITH tx_raw AS (
    -- Paid ticket / trip / experience orders (online checkout only).
    SELECT
      COALESCE(NULLIF(lower(trim(o.buyer_email)), ''), o.buyer_phone_e164, 'o:' || o.id::text) AS customer_key,
      COALESCE(o.confirmed_at, o.created_at)                                                   AS created_at,
      COALESCE(NULLIF(TRIM(UPPER(o.currency)), ''), v_default_ccy)                             AS ccy,
      GREATEST(o.total_cents - COALESCE(o.refunded_amount_cents, 0), 0)::bigint                AS value_cents,
      (ac.id IS NOT NULL)                                                                      AS has_conv,
      ac.entry_source                                                                          AS entry_source,
      ac.platform                                                                              AS ad_platform,
      ac.click_id                                                                              AS conv_click_id,
      ac.touch_id                                                                              AS conv_touch_id,
      ac.campaign_id                                                                           AS conv_campaign_id
    FROM public.orders o
    JOIN public.events e
      ON e.id = o.event_id AND e.brand_id = p_brand_id AND e.deleted_at IS NULL
    LEFT JOIN LATERAL (
      SELECT c.id, c.platform, c.click_id, c.touch_id, c.campaign_id, t.entry_source
      FROM public.ad_conversions c
      LEFT JOIN public.ad_attribution_touches t ON t.id = c.touch_id
      WHERE c.order_id = o.id
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
      (ac.id IS NOT NULL)                                                                       AS has_conv,
      ac.entry_source                                                                           AS entry_source,
      ac.platform                                                                               AS ad_platform,
      ac.click_id                                                                               AS conv_click_id,
      ac.touch_id                                                                               AS conv_touch_id,
      ac.campaign_id                                                                            AS conv_campaign_id
    FROM public.reservations r
    LEFT JOIN LATERAL (
      SELECT c.id, c.platform, c.click_id, c.touch_id, c.campaign_id, t.entry_source
      FROM public.ad_conversions c
      LEFT JOIN public.ad_attribution_touches t ON t.id = c.touch_id
      WHERE c.event_id = r.id::text
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
      (ac.id IS NOT NULL)                                                                    AS has_conv,
      ac.entry_source                                                                        AS entry_source,
      ac.platform                                                                            AS ad_platform,
      ac.click_id                                                                            AS conv_click_id,
      ac.touch_id                                                                            AS conv_touch_id,
      ac.campaign_id                                                                         AS conv_campaign_id
    FROM public.event_rsvps er
    JOIN public.events e
      ON e.id = er.event_id AND e.brand_id = p_brand_id AND e.deleted_at IS NULL AND e.event_type = 'rsvp'
    LEFT JOIN LATERAL (
      SELECT c.id, c.platform, c.click_id, c.touch_id, c.campaign_id, t.entry_source
      FROM public.ad_conversions c
      LEFT JOIN public.ad_attribution_touches t ON t.id = c.touch_id
      WHERE c.event_id = er.id::text
      ORDER BY c.created_at DESC
      LIMIT 1
    ) ac ON true
    WHERE er.rsvp_status = 'going' AND er.approval_status = 'approved'
  ),
  tx AS (
    -- Resolve the HONEST source label per spine row. entry_source is authoritative
    -- when present; the PR-1 handle rule is the fallback ONLY for NULL entry_source
    -- (pre-capture / no touch). 'unknown' + null-fallback fold into 'organic'.
    SELECT
      customer_key,
      created_at,
      ccy,
      value_cents,
      CASE
        WHEN NOT has_conv                       THEN 'organic'
        WHEN entry_source = 'ad'                THEN 'ad'
        WHEN entry_source = 'search'            THEN 'search'
        WHEN entry_source = 'social'            THEN 'social'
        WHEN entry_source = 'direct'            THEN 'direct'
        WHEN entry_source = 'organic'           THEN 'organic'
        WHEN entry_source = 'unknown'           THEN 'organic'
        WHEN conv_click_id IS NOT NULL
          OR conv_touch_id IS NOT NULL
          OR conv_campaign_id IS NOT NULL       THEN 'ad'
        ELSE 'organic'
      END AS source,
      ad_platform
    FROM tx_raw
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
    SELECT source, COUNT(DISTINCT customer_key)::bigint AS customers
    FROM tx GROUP BY source
  ),
  src_value AS (
    SELECT source, ccy, SUM(value_cents)::bigint AS cents
    FROM tx GROUP BY source, ccy HAVING SUM(value_cents) > 0
  ),
  plat_customers AS (
    SELECT COALESCE(ad_platform, 'unknown') AS platform,
           COUNT(DISTINCT customer_key)::bigint AS customers
    FROM tx WHERE source = 'ad' GROUP BY 1
  ),
  plat_value AS (
    SELECT COALESCE(ad_platform, 'unknown') AS platform,
           ccy, SUM(value_cents)::bigint AS cents
    FROM tx WHERE source = 'ad' GROUP BY 1, 2 HAVING SUM(value_cents) > 0
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
    -- by_source: ad + organic keep their PR-1 positions ([0],[1]); PR-2 appends the
    -- three fine-grained non-ad buckets (always present, zero-filled). Consumers
    -- read by NAME. 'organic' is the honest catch-all (Mingla-referrer + unknown +
    -- the entire pre-capture period). See the migration header INVARIANT.
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
      ),
      jsonb_build_object(
        'source', 'search',
        'customers', COALESCE((SELECT customers FROM src_customers WHERE source = 'search'), 0),
        'value_cents', COALESCE((SELECT jsonb_object_agg(ccy, cents) FROM src_value WHERE source = 'search'), '{}'::jsonb)
      ),
      jsonb_build_object(
        'source', 'social',
        'customers', COALESCE((SELECT customers FROM src_customers WHERE source = 'social'), 0),
        'value_cents', COALESCE((SELECT jsonb_object_agg(ccy, cents) FROM src_value WHERE source = 'social'), '{}'::jsonb)
      ),
      jsonb_build_object(
        'source', 'direct',
        'customers', COALESCE((SELECT customers FROM src_customers WHERE source = 'direct'), 0),
        'value_cents', COALESCE((SELECT jsonb_object_agg(ccy, cents) FROM src_value WHERE source = 'direct'), '{}'::jsonb)
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
  'ISSUE-855 PR2: brand-hub "customers Mingla drove" rollup. Honest spine = orders(+events) UNION reservations UNION event_rsvps(+events) on the source-of-truth tables. Distinct customers on COALESCE(lower(trim(email)),phone); per-currency value (never cross-summed); RSVPs count-only (£0). by_source now = ad + organic + search + social + direct (FORWARD-ONLY): the non-ad slice splits by the touch entry_source (via ad_conversions.touch_id -> ad_attribution_touches); entry_source is authoritative, PR-1 handle rule is the NULL-entry_source fallback, and organic is the honest catch-all incl. the whole pre-capture period (INVARIANT: ad + non-ad == PR-1 ad + organic). by_platform = the ad slice (byte-stable vs PR-1). SECURITY DEFINER + internal admin-OR-member auth (else honest-empty authorized:false).';

-- ════════════════════════════════════════════════════════════════════════════
-- 3. entity_conversion_rollup — same by_source extension, per-listing scope.
-- ════════════════════════════════════════════════════════════════════════════
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

  WITH tx_raw AS (
    SELECT
      COALESCE(NULLIF(lower(trim(o.buyer_email)), ''), o.buyer_phone_e164, 'o:' || o.id::text) AS customer_key,
      COALESCE(NULLIF(TRIM(UPPER(o.currency)), ''), v_default_ccy)                             AS ccy,
      GREATEST(o.total_cents - COALESCE(o.refunded_amount_cents, 0), 0)::bigint                AS value_cents,
      (ac.id IS NOT NULL)                                                                      AS has_conv,
      ac.entry_source                                                                          AS entry_source,
      ac.platform                                                                              AS ad_platform,
      ac.click_id                                                                              AS conv_click_id,
      ac.touch_id                                                                              AS conv_touch_id,
      ac.campaign_id                                                                           AS conv_campaign_id
    FROM public.orders o
    LEFT JOIN LATERAL (
      SELECT c.id, c.platform, c.click_id, c.touch_id, c.campaign_id, t.entry_source
      FROM public.ad_conversions c
      LEFT JOIN public.ad_attribution_touches t ON t.id = c.touch_id
      WHERE c.order_id = o.id
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
      (ac.id IS NOT NULL)                                                                    AS has_conv,
      ac.entry_source                                                                        AS entry_source,
      ac.platform                                                                            AS ad_platform,
      ac.click_id                                                                            AS conv_click_id,
      ac.touch_id                                                                            AS conv_touch_id,
      ac.campaign_id                                                                         AS conv_campaign_id
    FROM public.event_rsvps er
    LEFT JOIN LATERAL (
      SELECT c.id, c.platform, c.click_id, c.touch_id, c.campaign_id, t.entry_source
      FROM public.ad_conversions c
      LEFT JOIN public.ad_attribution_touches t ON t.id = c.touch_id
      WHERE c.event_id = er.id::text
      ORDER BY c.created_at DESC
      LIMIT 1
    ) ac ON true
    WHERE er.event_id = p_event_id
      AND er.rsvp_status = 'going' AND er.approval_status = 'approved'
  ),
  tx AS (
    SELECT
      customer_key,
      ccy,
      value_cents,
      CASE
        WHEN NOT has_conv                       THEN 'organic'
        WHEN entry_source = 'ad'                THEN 'ad'
        WHEN entry_source = 'search'            THEN 'search'
        WHEN entry_source = 'social'            THEN 'social'
        WHEN entry_source = 'direct'            THEN 'direct'
        WHEN entry_source = 'organic'           THEN 'organic'
        WHEN entry_source = 'unknown'           THEN 'organic'
        WHEN conv_click_id IS NOT NULL
          OR conv_touch_id IS NOT NULL
          OR conv_campaign_id IS NOT NULL       THEN 'ad'
        ELSE 'organic'
      END AS source,
      ad_platform
    FROM tx_raw
  ),
  value_ccy AS (
    SELECT ccy, SUM(value_cents)::bigint AS cents
    FROM tx GROUP BY ccy HAVING SUM(value_cents) > 0
  ),
  src_customers AS (
    SELECT source, COUNT(DISTINCT customer_key)::bigint AS customers
    FROM tx GROUP BY source
  ),
  src_value AS (
    SELECT source, ccy, SUM(value_cents)::bigint AS cents
    FROM tx GROUP BY source, ccy HAVING SUM(value_cents) > 0
  ),
  plat_customers AS (
    SELECT COALESCE(ad_platform, 'unknown') AS platform,
           COUNT(DISTINCT customer_key)::bigint AS customers
    FROM tx WHERE source = 'ad' GROUP BY 1
  ),
  plat_value AS (
    SELECT COALESCE(ad_platform, 'unknown') AS platform,
           ccy, SUM(value_cents)::bigint AS cents
    FROM tx WHERE source = 'ad' GROUP BY 1, 2 HAVING SUM(value_cents) > 0
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
      ),
      jsonb_build_object(
        'source', 'search',
        'customers', COALESCE((SELECT customers FROM src_customers WHERE source = 'search'), 0),
        'value_cents', COALESCE((SELECT jsonb_object_agg(ccy, cents) FROM src_value WHERE source = 'search'), '{}'::jsonb)
      ),
      jsonb_build_object(
        'source', 'social',
        'customers', COALESCE((SELECT customers FROM src_customers WHERE source = 'social'), 0),
        'value_cents', COALESCE((SELECT jsonb_object_agg(ccy, cents) FROM src_value WHERE source = 'social'), '{}'::jsonb)
      ),
      jsonb_build_object(
        'source', 'direct',
        'customers', COALESCE((SELECT customers FROM src_customers WHERE source = 'direct'), 0),
        'value_cents', COALESCE((SELECT jsonb_object_agg(ccy, cents) FROM src_value WHERE source = 'direct'), '{}'::jsonb)
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
  'ISSUE-855 PR2: per-listing (events/trips/experiences/RSVPs share events.id) conversion rollup for Insights. Spine filtered to one event_id. by_source now = ad + organic + search + social + direct (FORWARD-ONLY, same entry_source derivation as brand_mingla_drove_rollup: authoritative entry_source, PR-1 handle fallback on NULL, organic catch-all incl. pre-capture). by_platform = the ad slice (byte-stable). Auth on the event brand_id (admin OR member; else honest-empty authorized:false).';

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Grants — CREATE OR REPLACE keeps the existing ACL, but re-assert the
--    ORCH-1392 SECURITY DEFINER anon gate defensively (idempotent; mirrors PR-1).
-- ════════════════════════════════════════════════════════════════════════════
REVOKE EXECUTE ON FUNCTION public.brand_mingla_drove_rollup(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.entity_conversion_rollup(uuid)  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.brand_mingla_drove_rollup(uuid) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.entity_conversion_rollup(uuid)  TO authenticated;
