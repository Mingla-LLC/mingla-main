-- ISSUE-865 [Attribution & reservation-conversion tracking] — PR1 WP-3/WP-4
-- The deferred rollup layer + brand-scoped SELECT RLS + the reservation
-- attribution-threading column. WRITTEN, not applied — the orchestrator/operator
-- runs `supabase db push` from MERGED main (this migration must NOT be applied to
-- any database by the implementor).
--
-- What ships here (additive + idempotent ONLY — nothing destructive, nothing that
-- touches a purchase/finalize path):
--   1. ad_attribution_touches.brand_id  — resolved at insert by attribution-capture
--      when the campaign click param (mc_id / af_c_id) resolves to a campaign, so
--      the brand-scoped rollups + RLS can filter by brand. Forward-only (no backfill).
--   2. reservation_checkout_sessions.attribution_click_id — mirrors
--      ticket_checkout_sessions.attribution_click_id (20270106000865) so a venue
--      reservation conversion can resolve session -> touch -> campaign at the
--      post-confirm fire point.
--   3. Brand-scoped SELECT RLS on ad_conversions + ad_attribution_touches (the
--      deferred WP-E policy) — an owner reads ONLY their own brand's rows, via the
--      house helper public.biz_is_brand_member_for_read_for_caller(brand_id). The
--      existing admin-read policy stays (permissive SELECT policies OR together).
--   4. Two SECURITY DEFINER, brand-scoped rollup RPCs feeding the proof surfaces:
--        · brand_conversion_rollup(p_brand_id)          — the biz "Customers your
--          ads drove" tile (customers driven 30d + lifetime, value per currency,
--          by-platform, top campaign, send health).
--        · ad_campaign_conversion_rollup(p_campaign_id) — the admin "Conversions &
--          ROI" panel (per-campaign conversions, attributed value, by-platform,
--          send health). p_campaign_id NULL → all campaigns (admin only).
--      Both honour the TWO-TIER value semantics: a paid Purchase carries value;
--      a free-RSVP lead carries £0 (value_cents 0), so SUM(value) = paid value
--      while COUNT(*) = every ad-driven customer (paid + free).
--
-- TWO-TIER (founder-locked): paid ticket/trip/experience + PAID venue reservation
--   -> value'd Purchase; free RSVP -> lead-type (value 0). The fire helper stamps
--   value_cents accordingly; these rollups simply SUM(COALESCE(value_cents,0)) and
--   COUNT(*), so both semantics fall out naturally.
--
-- MIGRATION HYGIENE (COMMS-0102): version prefix 20270115000865 is strictly
-- greater than the current highest applied/pending head (20270112000000,
-- issue_857) and every sibling-worktree prefix, and is none of the known
-- duplicate 2026/2027 prefixes.

-- ════════════════════════════════════════════════════════════════════════
-- 1. ad_attribution_touches.brand_id (resolved from the campaign at capture)
-- ════════════════════════════════════════════════════════════════════════
-- Nullable, no FK (mirrors ad_conversions.brand_id, which is a resolved scalar,
-- not an integrity edge — a brand delete must never cascade a touch/rollup row
-- away). Set service-role-side by attribution-capture::recordTouch ONLY when the
-- campaign param resolves; NULL for organic / unresolved traffic.

ALTER TABLE public.ad_attribution_touches
  ADD COLUMN IF NOT EXISTS brand_id uuid NULL;

COMMENT ON COLUMN public.ad_attribution_touches.brand_id IS
  'ISSUE-865 PR1 WP-1: the brand the resolved campaign belongs to (via ad_campaigns.dest_brand_slug -> brands.id), stamped by attribution-capture when the click param (mc_id/af_c_id) resolves to a campaign. NULL for organic/unresolved traffic. Resolved scalar (no FK) — mirrors ad_conversions.brand_id; used by the brand-scoped rollups + RLS.';

CREATE INDEX IF NOT EXISTS idx_ad_attribution_touches_brand
  ON public.ad_attribution_touches (brand_id)
  WHERE brand_id IS NOT NULL;

-- ════════════════════════════════════════════════════════════════════════
-- 2. reservation_checkout_sessions.attribution_click_id (WP-2 threading)
-- ════════════════════════════════════════════════════════════════════════
-- Additive, nullable, no default — mirrors ticket_checkout_sessions
-- (20270106000865). Populated by venue-reservation-create ONLY when the browser
-- forwards it (byte-identical write when absent). Read by adConversionFire's
-- resolveReservationContext via reservations.id -> reservation_checkout_sessions
-- .reservation_id, so a venue reservation conversion links reservation -> touch
-- -> campaign WITHOUT touching the pg_finalize_guest_reservation internals.

ALTER TABLE public.reservation_checkout_sessions
  ADD COLUMN IF NOT EXISTS attribution_click_id text NULL;

COMMENT ON COLUMN public.reservation_checkout_sessions.attribution_click_id IS
  'ISSUE-865 PR1 WP-2 threading: the first-party ad click_id (ad_attribution_touches.click_id) captured on the public venue page and forwarded at reservation-create, so the post-confirm conversion send links reservation -> touch -> campaign. Written by a DECOUPLED fail-open helper (never on the fatal session-insert path — mirrors the ticket P2-1 fix). NULL for non-ad traffic.';

CREATE INDEX IF NOT EXISTS idx_reservation_checkout_sessions_attribution_click
  ON public.reservation_checkout_sessions (attribution_click_id)
  WHERE attribution_click_id IS NOT NULL;

-- ════════════════════════════════════════════════════════════════════════
-- 3. Brand-scoped SELECT RLS (the deferred WP-E policy)
-- ════════════════════════════════════════════════════════════════════════
-- Additive to the admin-read policies shipped by 20270105000865. Multiple
-- permissive SELECT policies OR together, so:
--   · an admin still reads every row (existing "... admin can read"),
--   · a brand owner/member reads ONLY rows whose brand_id is a brand they can
--     read, via public.biz_is_brand_member_for_read_for_caller(brand_id)
--     (the same helper the brands SELECT policy uses).
-- Writes stay service-role only (no INSERT/UPDATE/DELETE policy exists).

DROP POLICY IF EXISTS "ad_conversions brand member can read" ON public.ad_conversions;
CREATE POLICY "ad_conversions brand member can read"
  ON public.ad_conversions
  FOR SELECT
  TO authenticated
  USING (
    brand_id IS NOT NULL
    AND public.biz_is_brand_member_for_read_for_caller(brand_id)
  );

DROP POLICY IF EXISTS "ad_attribution_touches brand member can read" ON public.ad_attribution_touches;
CREATE POLICY "ad_attribution_touches brand member can read"
  ON public.ad_attribution_touches
  FOR SELECT
  TO authenticated
  USING (
    brand_id IS NOT NULL
    AND public.biz_is_brand_member_for_read_for_caller(brand_id)
  );

-- ════════════════════════════════════════════════════════════════════════
-- 4a. brand_conversion_rollup(p_brand_id) — the biz proof tile feed
-- ════════════════════════════════════════════════════════════════════════
-- SECURITY DEFINER (bypasses RLS) so it MUST authorize internally: only an admin
-- OR a member/owner of p_brand_id may read it; anyone else gets an empty rollup
-- (never another brand's data). Aggregates ONLY ad-DRIVEN conversions — a row is
-- ad-driven when it carries a click_id / touch_id / campaign_id (an organic
-- purchase whose brand_id was resolved from the event is NOT counted, per the
-- no-fabrication constitution: the tile says "customers your ADS drove").

CREATE OR REPLACE FUNCTION public.brand_conversion_rollup(p_brand_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_authorized boolean;
  v_result     jsonb;
BEGIN
  IF p_brand_id IS NULL THEN
    RETURN NULL;
  END IF;

  v_authorized := public.is_admin_user()
    OR public.biz_is_brand_member_for_read_for_caller(p_brand_id);
  IF NOT v_authorized THEN
    -- Never leak another brand's data: an unauthorized caller gets a
    -- zero-filled, honest-empty rollup (no rows, no numbers).
    RETURN jsonb_build_object(
      'brand_id', p_brand_id,
      'authorized', false,
      'customers_driven_30d', 0,
      'customers_driven_lifetime', 0,
      'value_cents_30d', '{}'::jsonb,
      'value_cents_lifetime', '{}'::jsonb,
      'by_platform', '[]'::jsonb,
      'top_campaign', NULL,
      'send_health', jsonb_build_object('sent',0,'failed',0,'skipped',0,'pending',0)
    );
  END IF;

  WITH driven AS (
    SELECT c.*
    FROM public.ad_conversions c
    WHERE c.brand_id = p_brand_id
      AND (c.click_id IS NOT NULL OR c.touch_id IS NOT NULL OR c.campaign_id IS NOT NULL)
  ),
  by_platform AS (
    SELECT COALESCE(platform, 'unknown') AS platform,
           COUNT(*)::bigint             AS conversions,
           SUM(COALESCE(value_cents, 0))::bigint AS value_cents
    FROM driven
    GROUP BY COALESCE(platform, 'unknown')
  ),
  value_30d AS (
    SELECT COALESCE(currency, 'GBP') AS currency,
           SUM(COALESCE(value_cents, 0))::bigint AS cents
    FROM driven
    WHERE created_at >= now() - interval '30 days'
    GROUP BY COALESCE(currency, 'GBP')
    HAVING SUM(COALESCE(value_cents, 0)) > 0
  ),
  value_life AS (
    SELECT COALESCE(currency, 'GBP') AS currency,
           SUM(COALESCE(value_cents, 0))::bigint AS cents
    FROM driven
    GROUP BY COALESCE(currency, 'GBP')
    HAVING SUM(COALESCE(value_cents, 0)) > 0
  ),
  top_campaign AS (
    SELECT d.campaign_id,
           COUNT(*)::bigint AS conversions
    FROM driven d
    WHERE d.campaign_id IS NOT NULL
    GROUP BY d.campaign_id
    ORDER BY COUNT(*) DESC, d.campaign_id
    LIMIT 1
  )
  SELECT jsonb_build_object(
    'brand_id', p_brand_id,
    'authorized', true,
    'customers_driven_30d',
      (SELECT COUNT(*)::bigint FROM driven WHERE created_at >= now() - interval '30 days'),
    'customers_driven_lifetime',
      (SELECT COUNT(*)::bigint FROM driven),
    'value_cents_30d',
      COALESCE((SELECT jsonb_object_agg(currency, cents) FROM value_30d), '{}'::jsonb),
    'value_cents_lifetime',
      COALESCE((SELECT jsonb_object_agg(currency, cents) FROM value_life), '{}'::jsonb),
    'by_platform',
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'platform', platform,
          'conversions', conversions,
          'value_cents', value_cents
        ) ORDER BY conversions DESC, platform)
        FROM by_platform
      ), '[]'::jsonb),
    'top_campaign',
      (SELECT jsonb_build_object(
        'campaign_id', tc.campaign_id,
        'name', cmp.name,
        'conversions', tc.conversions
      )
      FROM top_campaign tc
      LEFT JOIN public.ad_campaigns cmp ON cmp.id = tc.campaign_id),
    'send_health', jsonb_build_object(
      'sent',    (SELECT COUNT(*)::bigint FROM driven WHERE meta_capi_status='sent' OR tiktok_events_status='sent' OR snap_capi_status='sent' OR reddit_capi_status='sent'),
      'failed',  (SELECT COUNT(*)::bigint FROM driven WHERE meta_capi_status='failed' OR tiktok_events_status='failed' OR snap_capi_status='failed' OR reddit_capi_status='failed'),
      'skipped', (SELECT COUNT(*)::bigint FROM driven WHERE meta_capi_status='skipped' AND tiktok_events_status='skipped' AND snap_capi_status='skipped' AND reddit_capi_status='skipped'),
      'pending', (SELECT COUNT(*)::bigint FROM driven WHERE meta_capi_status='pending' OR tiktok_events_status='pending' OR snap_capi_status='pending' OR reddit_capi_status='pending')
    )
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.brand_conversion_rollup(uuid) IS
  'ISSUE-865 PR1 WP-3/WP-4: brand-scoped ad-conversion rollup feeding the biz "Customers your ads drove" tile. SECURITY DEFINER + internal authorization (admin OR brand member; else honest-empty). Counts ONLY ad-driven conversions (click_id/touch_id/campaign_id present). Two-tier: SUM(value)=paid value, COUNT=every driven customer (paid + free RSVP at £0).';

-- ════════════════════════════════════════════════════════════════════════
-- 4b. ad_campaign_conversion_rollup(p_campaign_id) — the admin ROI panel feed
-- ════════════════════════════════════════════════════════════════════════
-- SECURITY DEFINER. Authorization: admin sees any campaign (and all campaigns
-- when p_campaign_id IS NULL); a brand member sees ONLY a campaign whose brand
-- (ad_campaigns.dest_brand_slug -> brands) they can read. spend_cents is NULL —
-- there is no in-DB actual-spend source yet (platform insights land with #863);
-- the panel shows ROAS/cost-per-result only when a real spend is available, never
-- fabricated from the budget (no-fabrication constitution).

CREATE OR REPLACE FUNCTION public.ad_campaign_conversion_rollup(p_campaign_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin   boolean;
  v_brand_id   uuid;
  v_authorized boolean;
  v_result     jsonb;
BEGIN
  v_is_admin := public.is_admin_user();

  IF p_campaign_id IS NOT NULL THEN
    -- Resolve the campaign's brand (dest_brand_slug -> brands) for the member check.
    SELECT b.id INTO v_brand_id
    FROM public.ad_campaigns c
    LEFT JOIN public.brands b
      ON lower(b.slug) = lower(c.dest_brand_slug) AND b.deleted_at IS NULL
    WHERE c.id = p_campaign_id;

    v_authorized := v_is_admin
      OR (v_brand_id IS NOT NULL AND public.biz_is_brand_member_for_read_for_caller(v_brand_id));
  ELSE
    -- The all-campaigns rollup (p_campaign_id NULL) is an admin-only console read.
    v_authorized := v_is_admin;
  END IF;

  IF NOT v_authorized THEN
    RETURN jsonb_build_object(
      'campaign_id', p_campaign_id,
      'authorized', false,
      'conversions', 0,
      'value_cents', '{}'::jsonb,
      'spend_cents', NULL,
      'by_platform', '[]'::jsonb,
      'send_health', jsonb_build_object('sent',0,'failed',0,'skipped',0,'pending',0)
    );
  END IF;

  WITH scoped AS (
    SELECT c.*
    FROM public.ad_conversions c
    WHERE (p_campaign_id IS NULL OR c.campaign_id = p_campaign_id)
      AND c.campaign_id IS NOT NULL
  ),
  by_platform AS (
    SELECT COALESCE(platform, 'unknown') AS platform,
           COUNT(*)::bigint             AS conversions,
           SUM(COALESCE(value_cents, 0))::bigint AS value_cents,
           COUNT(*) FILTER (WHERE meta_capi_status='sent' OR tiktok_events_status='sent' OR snap_capi_status='sent' OR reddit_capi_status='sent')::bigint AS sent,
           COUNT(*) FILTER (WHERE meta_capi_status='failed' OR tiktok_events_status='failed' OR snap_capi_status='failed' OR reddit_capi_status='failed')::bigint AS failed
    FROM scoped
    GROUP BY COALESCE(platform, 'unknown')
  ),
  value_by_ccy AS (
    SELECT COALESCE(currency, 'GBP') AS currency,
           SUM(COALESCE(value_cents, 0))::bigint AS cents
    FROM scoped
    GROUP BY COALESCE(currency, 'GBP')
    HAVING SUM(COALESCE(value_cents, 0)) > 0
  )
  SELECT jsonb_build_object(
    'campaign_id', p_campaign_id,
    'authorized', true,
    'conversions', (SELECT COUNT(*)::bigint FROM scoped),
    'value_cents', COALESCE((SELECT jsonb_object_agg(currency, cents) FROM value_by_ccy), '{}'::jsonb),
    -- No in-DB actual-spend source yet (#863 platform insights). NULL = "unknown";
    -- the panel must NOT fabricate ROAS/cost-per-result from the budget.
    'spend_cents', NULL,
    'by_platform', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'platform', platform,
        'conversions', conversions,
        'value_cents', value_cents,
        'sent', sent,
        'failed', failed
      ) ORDER BY conversions DESC, platform)
      FROM by_platform
    ), '[]'::jsonb),
    'send_health', jsonb_build_object(
      'sent',    (SELECT COUNT(*)::bigint FROM scoped WHERE meta_capi_status='sent' OR tiktok_events_status='sent' OR snap_capi_status='sent' OR reddit_capi_status='sent'),
      'failed',  (SELECT COUNT(*)::bigint FROM scoped WHERE meta_capi_status='failed' OR tiktok_events_status='failed' OR snap_capi_status='failed' OR reddit_capi_status='failed'),
      'skipped', (SELECT COUNT(*)::bigint FROM scoped WHERE meta_capi_status='skipped' AND tiktok_events_status='skipped' AND snap_capi_status='skipped' AND reddit_capi_status='skipped'),
      'pending', (SELECT COUNT(*)::bigint FROM scoped WHERE meta_capi_status='pending' OR tiktok_events_status='pending' OR snap_capi_status='pending' OR reddit_capi_status='pending')
    )
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.ad_campaign_conversion_rollup(uuid) IS
  'ISSUE-865 PR1 WP-3/WP-4: per-campaign ad-conversion rollup feeding the admin "Conversions & ROI" panel. SECURITY DEFINER + internal authorization (admin any; brand member only their campaign; NULL campaign = admin-only all-campaigns). spend_cents is NULL (no in-DB spend source yet — #863) so the panel never fabricates ROAS. Two-tier value semantics via SUM(COALESCE(value_cents,0)).';

-- ════════════════════════════════════════════════════════════════════════
-- 5. Grants — ONLY authenticated may EXECUTE (the functions self-authorize).
-- ════════════════════════════════════════════════════════════════════════
-- ORCH-1392 (I-PROPOSED-1392-NO-UNALLOWLISTED-ANON-DEFINER): a SECURITY DEFINER
-- function in `public` must NOT be anon-EXECUTE-able. Supabase's default
-- privileges GRANT EXECUTE to `anon` DIRECTLY on every new public function, so a
-- bare `REVOKE ... FROM PUBLIC` is NOT enough — anon keeps its direct grant. We
-- REVOKE from PUBLIC **and** anon explicitly, then grant only to authenticated.
-- These rollups are read by the biz owner / admin under their OWN auth (never
-- anon, never a service-role edge caller), so authenticated is the only grantee.

REVOKE EXECUTE ON FUNCTION public.brand_conversion_rollup(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.ad_campaign_conversion_rollup(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_conversion_rollup(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ad_campaign_conversion_rollup(uuid) TO authenticated;
