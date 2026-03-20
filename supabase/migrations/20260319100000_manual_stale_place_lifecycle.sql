-- Migration: 20260319100000_manual_stale_place_lifecycle.sql
-- Converts stale-place lifecycle to fully manual, admin-controlled model.
--
-- Policy: stale detection is automatic; stale handling is manual.
-- No automated deactivation, no automated refresh, no pg_cron jobs.

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. DROP the automatic deactivation function (loaded gun removal)
-- ═══════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.deactivate_stale_places();

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. COMPUTED VIEW: v_stale_places
--    Staleness is computed on-the-fly, never stored. A place is "stale" if:
--    - last_detail_refresh is older than 7 days, OR
--    - refresh_failures >= 3
--    This view NEVER touches is_active. Stale ≠ inactive.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.v_stale_places AS
SELECT
  pp.id,
  pp.google_place_id,
  pp.name,
  pp.address,
  pp.lat,
  pp.lng,
  pp.primary_type,
  pp.rating,
  pp.review_count,
  pp.price_tier,
  pp.is_active,
  pp.last_detail_refresh,
  pp.refresh_failures,
  pp.first_fetched_at,
  pp.created_at,
  -- Staleness signals
  EXTRACT(EPOCH FROM (now() - pp.last_detail_refresh)) / 3600 AS hours_since_refresh,
  CASE
    WHEN pp.last_detail_refresh < now() - interval '30 days' THEN 'critical'
    WHEN pp.last_detail_refresh < now() - interval '14 days' THEN 'warning'
    WHEN pp.last_detail_refresh < now() - interval '7 days' THEN 'stale'
    ELSE 'fresh'
  END AS staleness_tier,
  CASE
    WHEN pp.refresh_failures >= 3 AND pp.last_detail_refresh < now() - interval '7 days' THEN 'stale_with_failures'
    WHEN pp.refresh_failures >= 3 THEN 'failing_refreshes'
    WHEN pp.last_detail_refresh < now() - interval '7 days' THEN 'time_stale'
    ELSE 'fresh'
  END AS stale_reason,
  -- Serving impact: is this stale place being shown to users?
  EXISTS (
    SELECT 1 FROM public.card_pool cp
    JOIN public.user_card_impressions uci ON uci.card_pool_id = cp.id
    WHERE cp.place_pool_id = pp.id
      AND cp.is_active = true
      AND uci.created_at > now() - interval '7 days'
  ) AS recently_served
FROM public.place_pool pp
WHERE pp.last_detail_refresh < now() - interval '7 days'
   OR pp.refresh_failures >= 3;

COMMENT ON VIEW public.v_stale_places IS
  'Computed view of stale places. Read-only detection — never mutates is_active. '
  'staleness_tier: fresh/stale/warning/critical. stale_reason: time_stale/failing_refreshes/stale_with_failures. '
  'recently_served: true if users viewed this place in the last 7 days (high priority).';

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. AUDIT TABLE: place_admin_actions
--    Every admin action on a place is logged here with who, what, when, why.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.place_admin_actions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  place_id    UUID NOT NULL REFERENCES public.place_pool(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL CHECK (action_type IN (
    'deactivate', 'reactivate', 'refresh', 'bulk_deactivate', 'bulk_reactivate', 'bulk_refresh'
  )),
  acted_by    UUID NOT NULL REFERENCES auth.users(id),
  acted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason      TEXT,                    -- Optional admin-provided reason
  metadata    JSONB DEFAULT '{}'::jsonb -- Additional context (e.g., refresh result, batch info)
);

CREATE INDEX idx_place_admin_actions_place ON public.place_admin_actions(place_id);
CREATE INDEX idx_place_admin_actions_acted_at ON public.place_admin_actions(acted_at DESC);
CREATE INDEX idx_place_admin_actions_type ON public.place_admin_actions(action_type);

ALTER TABLE public.place_admin_actions ENABLE ROW LEVEL SECURITY;

-- Service role: full access (edge functions)
CREATE POLICY "service_role_all_place_admin_actions" ON public.place_admin_actions
  FOR ALL USING (auth.role() = 'service_role');

-- Active admins: read + insert (view audit trail, log own actions)
CREATE POLICY "admin_read_place_admin_actions" ON public.place_admin_actions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.admin_users au
      WHERE au.email = auth.email() AND au.status = 'active'
    )
  );

CREATE POLICY "admin_insert_place_admin_actions" ON public.place_admin_actions
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.admin_users au
      WHERE au.email = auth.email() AND au.status = 'active'
    )
  );

COMMENT ON TABLE public.place_admin_actions IS
  'Audit log for admin actions on places. Every deactivate/reactivate/refresh is recorded '
  'with acted_by (admin user ID), acted_at, reason, and metadata.';

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. RPC: admin_list_stale_places
--    Paginated, filterable list of stale places for admin review.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_list_stale_places(
  p_filter TEXT DEFAULT 'all',          -- 'all', 'active_only', 'inactive_only', 'recently_served', 'critical'
  p_sort_by TEXT DEFAULT 'staleness',   -- 'staleness', 'failures', 'name', 'recently_served'
  p_page INTEGER DEFAULT 0,
  p_page_size INTEGER DEFAULT 20
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin BOOLEAN;
  v_rows JSONB;
  v_total BIGINT;
BEGIN
  SELECT is_admin_user() INTO v_is_admin;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Forbidden: admin access required';
  END IF;

  -- Clamp page_size
  IF p_page_size < 1 OR p_page_size > 100 THEN
    p_page_size := 20;
  END IF;

  -- Count total matching
  SELECT COUNT(*)
  INTO v_total
  FROM v_stale_places vsp
  WHERE (p_filter = 'all')
     OR (p_filter = 'active_only' AND vsp.is_active = true)
     OR (p_filter = 'inactive_only' AND vsp.is_active = false)
     OR (p_filter = 'recently_served' AND vsp.recently_served = true)
     OR (p_filter = 'critical' AND vsp.staleness_tier = 'critical');

  -- Fetch page
  SELECT COALESCE(jsonb_agg(row_to_json(sub)::jsonb), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      vsp.id,
      vsp.google_place_id,
      vsp.name,
      vsp.address,
      vsp.primary_type,
      vsp.rating,
      vsp.is_active,
      vsp.last_detail_refresh,
      vsp.refresh_failures,
      ROUND(vsp.hours_since_refresh::numeric, 1) AS hours_since_refresh,
      vsp.staleness_tier,
      vsp.stale_reason,
      vsp.recently_served,
      -- Last admin action on this place
      (
        SELECT jsonb_build_object(
          'action_type', paa.action_type,
          'acted_at', paa.acted_at,
          'reason', paa.reason
        )
        FROM place_admin_actions paa
        WHERE paa.place_id = vsp.id
        ORDER BY paa.acted_at DESC
        LIMIT 1
      ) AS last_admin_action
    FROM v_stale_places vsp
    WHERE (p_filter = 'all')
       OR (p_filter = 'active_only' AND vsp.is_active = true)
       OR (p_filter = 'inactive_only' AND vsp.is_active = false)
       OR (p_filter = 'recently_served' AND vsp.recently_served = true)
       OR (p_filter = 'critical' AND vsp.staleness_tier = 'critical')
    ORDER BY
      CASE WHEN p_sort_by = 'staleness' THEN vsp.hours_since_refresh END DESC NULLS LAST,
      CASE WHEN p_sort_by = 'failures' THEN vsp.refresh_failures END DESC NULLS LAST,
      CASE WHEN p_sort_by = 'name' THEN vsp.name END ASC NULLS LAST,
      CASE WHEN p_sort_by = 'recently_served' THEN CASE WHEN vsp.recently_served THEN 0 ELSE 1 END END ASC,
      vsp.hours_since_refresh DESC NULLS LAST
    LIMIT p_page_size
    OFFSET p_page * p_page_size
  ) sub;

  RETURN jsonb_build_object(
    'places', v_rows,
    'total', v_total,
    'page', p_page,
    'page_size', p_page_size,
    'summary', jsonb_build_object(
      'total_stale', v_total,
      'active_stale', (SELECT COUNT(*) FROM v_stale_places WHERE is_active = true),
      'inactive_stale', (SELECT COUNT(*) FROM v_stale_places WHERE is_active = false),
      'recently_served_stale', (SELECT COUNT(*) FROM v_stale_places WHERE recently_served = true),
      'critical_count', (SELECT COUNT(*) FROM v_stale_places WHERE staleness_tier = 'critical')
    )
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. RPC: admin_deactivate_place
--    Admin-only. Sets is_active = false, cascades to cards, logs audit.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_deactivate_place(
  p_place_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin BOOLEAN;
  v_user_id UUID;
  v_place_name TEXT;
  v_cards_deactivated INTEGER;
BEGIN
  SELECT is_admin_user() INTO v_is_admin;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Forbidden: admin access required';
  END IF;

  v_user_id := auth.uid();

  -- Verify place exists and is active
  SELECT name INTO v_place_name
  FROM place_pool
  WHERE id = p_place_id AND is_active = true;

  IF v_place_name IS NULL THEN
    RETURN jsonb_build_object('error', 'Place not found or already inactive');
  END IF;

  -- Deactivate place
  UPDATE place_pool SET is_active = false, updated_at = now()
  WHERE id = p_place_id;

  -- Cascade: deactivate linked cards
  WITH deactivated AS (
    UPDATE card_pool SET is_active = false
    WHERE place_pool_id = p_place_id AND is_active = true
    RETURNING id
  )
  SELECT COUNT(*) INTO v_cards_deactivated FROM deactivated;

  -- Audit log
  INSERT INTO place_admin_actions (place_id, action_type, acted_by, reason, metadata)
  VALUES (p_place_id, 'deactivate', v_user_id, p_reason,
    jsonb_build_object('place_name', v_place_name, 'cards_deactivated', v_cards_deactivated));

  RETURN jsonb_build_object(
    'success', true,
    'place_name', v_place_name,
    'cards_deactivated', v_cards_deactivated
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 6. RPC: admin_reactivate_place
--    Admin-only. Sets is_active = true, reactivates linked cards, logs audit.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_reactivate_place(
  p_place_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin BOOLEAN;
  v_user_id UUID;
  v_place_name TEXT;
  v_cards_reactivated INTEGER;
BEGIN
  SELECT is_admin_user() INTO v_is_admin;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Forbidden: admin access required';
  END IF;

  v_user_id := auth.uid();

  -- Verify place exists and is inactive
  SELECT name INTO v_place_name
  FROM place_pool
  WHERE id = p_place_id AND is_active = false;

  IF v_place_name IS NULL THEN
    RETURN jsonb_build_object('error', 'Place not found or already active');
  END IF;

  -- Reactivate place
  UPDATE place_pool SET is_active = true, updated_at = now()
  WHERE id = p_place_id;

  -- Cascade: reactivate linked cards
  WITH reactivated AS (
    UPDATE card_pool SET is_active = true
    WHERE place_pool_id = p_place_id AND is_active = false
    RETURNING id
  )
  SELECT COUNT(*) INTO v_cards_reactivated FROM reactivated;

  -- Audit log
  INSERT INTO place_admin_actions (place_id, action_type, acted_by, reason, metadata)
  VALUES (p_place_id, 'reactivate', v_user_id, p_reason,
    jsonb_build_object('place_name', v_place_name, 'cards_reactivated', v_cards_reactivated));

  RETURN jsonb_build_object(
    'success', true,
    'place_name', v_place_name,
    'cards_reactivated', v_cards_reactivated
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 7. RPC: admin_bulk_deactivate_places
--    Deactivates multiple places in one call with audit trail.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_bulk_deactivate_places(
  p_place_ids UUID[],
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin BOOLEAN;
  v_user_id UUID;
  v_places_deactivated INTEGER;
  v_cards_deactivated INTEGER;
  v_pid UUID;
BEGIN
  SELECT is_admin_user() INTO v_is_admin;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Forbidden: admin access required';
  END IF;

  v_user_id := auth.uid();

  IF p_place_ids IS NULL OR array_length(p_place_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('error', 'No place IDs provided');
  END IF;

  -- Deactivate places
  WITH deactivated AS (
    UPDATE place_pool SET is_active = false, updated_at = now()
    WHERE id = ANY(p_place_ids) AND is_active = true
    RETURNING id
  )
  SELECT COUNT(*) INTO v_places_deactivated FROM deactivated;

  -- Cascade: deactivate linked cards
  WITH deactivated_cards AS (
    UPDATE card_pool SET is_active = false
    WHERE place_pool_id = ANY(p_place_ids) AND is_active = true
    RETURNING id
  )
  SELECT COUNT(*) INTO v_cards_deactivated FROM deactivated_cards;

  -- Audit: one row per place
  FOREACH v_pid IN ARRAY p_place_ids LOOP
    INSERT INTO place_admin_actions (place_id, action_type, acted_by, reason, metadata)
    VALUES (v_pid, 'bulk_deactivate', v_user_id, p_reason,
      jsonb_build_object('batch_size', array_length(p_place_ids, 1)));
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'places_deactivated', v_places_deactivated,
    'cards_deactivated', v_cards_deactivated
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 8. Grant view access to authenticated users (needed for RPC to query it)
-- ═══════════════════════════════════════════════════════════════════════════════

GRANT SELECT ON public.v_stale_places TO authenticated;
GRANT SELECT ON public.v_stale_places TO service_role;
