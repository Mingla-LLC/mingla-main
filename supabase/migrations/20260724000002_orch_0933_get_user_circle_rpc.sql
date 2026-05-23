-- ORCH-0933 — Profile "Your Circle" social graph RPC.
-- Additive only: one SECURITY DEFINER function plus the missing FoF lookup index.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_friends_friend_user_id_status
  ON public.friends (friend_user_id, status)
  WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.get_user_circle(
  p_viewer_user_id uuid,
  p_limit int DEFAULT 60,
  p_offset int DEFAULT 0
)
RETURNS TABLE (
  user_id          uuid,
  tier             text,
  display_name     text,
  username         text,
  avatar_url       text,
  has_business_app boolean,
  sort_score       bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller uuid := auth.uid();
BEGIN
  IF v_caller IS NULL OR v_caller <> p_viewer_user_id THEN
    RAISE EXCEPTION 'get_user_circle: unauthorized (caller=%, requested=%)', v_caller, p_viewer_user_id
      USING ERRCODE = '42501';
  END IF;

  IF p_limit < 1 OR p_limit > 200 THEN
    RAISE EXCEPTION 'get_user_circle: p_limit out of range (must be 1..200)' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH
  consumer_users AS (
    SELECT DISTINCT ad.user_id
    FROM public.appsflyer_devices ad
    WHERE ad.app = 'consumer'
  ),
  dual_app_users AS (
    SELECT DISTINCT ad.user_id
    FROM public.appsflyer_devices ad
    WHERE ad.app = 'business'
  ),
  event_recency AS (
    SELECT
      ed.event_id,
      MAX(COALESCE(ed.end_at, ed.start_at)) AS event_at
    FROM public.event_dates ed
    GROUP BY ed.event_id
  ),
  tier_close AS (
    SELECT
      CASE WHEN p.user_a_id = p_viewer_user_id THEN p.user_b_id ELSE p.user_a_id END AS other_id,
      EXTRACT(EPOCH FROM p.created_at)::bigint * 1000 AS rel_created_ms
    FROM public.pairings p
    WHERE p_viewer_user_id IN (p.user_a_id, p.user_b_id)
  ),
  tier_friend AS (
    SELECT
      f.friend_user_id AS other_id,
      EXTRACT(EPOCH FROM f.updated_at)::bigint * 1000 AS rel_created_ms
    FROM public.friends f
    WHERE f.user_id = p_viewer_user_id
      AND f.status = 'accepted'
      AND f.deleted_at IS NULL
      AND f.friend_user_id NOT IN (SELECT other_id FROM tier_close)
  ),
  viewer_friends AS (
    SELECT f.friend_user_id AS fid
    FROM public.friends f
    WHERE f.user_id = p_viewer_user_id
      AND f.status = 'accepted'
      AND f.deleted_at IS NULL
  ),
  viewer_events AS (
    SELECT DISTINCT o.event_id AS eid
    FROM public.orders o
    JOIN public.events e ON e.id = o.event_id
    WHERE o.buyer_user_id = p_viewer_user_id
      AND o.payment_status = 'paid'
      AND e.event_type IN ('event', 'trip')
  ),
  tier_fof AS (
    SELECT
      f2.friend_user_id AS other_id,
      MAX(EXTRACT(EPOCH FROM f2.updated_at)::bigint * 1000) AS rel_created_ms
    FROM public.friends f2
    WHERE f2.user_id IN (SELECT fid FROM viewer_friends)
      AND f2.status = 'accepted'
      AND f2.deleted_at IS NULL
      AND f2.friend_user_id <> p_viewer_user_id
      AND f2.friend_user_id NOT IN (SELECT other_id FROM tier_close)
      AND f2.friend_user_id NOT IN (SELECT other_id FROM tier_friend)
    GROUP BY f2.friend_user_id
  ),
  tier_coattendee AS (
    SELECT
      o2.buyer_user_id AS other_id,
      MAX(EXTRACT(EPOCH FROM COALESCE(er.event_at, o2.created_at))::bigint * 1000) AS rel_created_ms
    FROM public.orders o2
    JOIN public.events e ON e.id = o2.event_id
    LEFT JOIN event_recency er ON er.event_id = o2.event_id
    WHERE o2.event_id IN (SELECT eid FROM viewer_events)
      AND e.event_type IN ('event', 'trip')
      AND o2.payment_status = 'paid'
      AND o2.buyer_user_id IS NOT NULL
      AND o2.buyer_user_id <> p_viewer_user_id
      AND o2.buyer_user_id NOT IN (SELECT other_id FROM tier_close)
      AND o2.buyer_user_id NOT IN (SELECT other_id FROM tier_friend)
    GROUP BY o2.buyer_user_id
  ),
  tier_extended AS (
    SELECT other_id, MAX(rel_created_ms) AS rel_created_ms
    FROM (
      SELECT * FROM tier_fof
      UNION ALL
      SELECT * FROM tier_coattendee
    ) u
    GROUP BY other_id
  ),
  combined AS (
    SELECT other_id, 'close'::text AS tier, rel_created_ms FROM tier_close
    UNION ALL
    SELECT other_id, 'friend'::text AS tier, rel_created_ms FROM tier_friend
    UNION ALL
    SELECT other_id, 'extended'::text AS tier, rel_created_ms FROM tier_extended
  )
  SELECT
    c.other_id AS user_id,
    c.tier,
    pr.display_name,
    pr.username,
    pr.avatar_url,
    (c.other_id IN (SELECT dau.user_id FROM dual_app_users dau)) AS has_business_app,
    ((CASE c.tier WHEN 'close' THEN 3 WHEN 'friend' THEN 2 ELSE 1 END)::bigint * (1::bigint << 50))
      + GREATEST(
          c.rel_created_ms,
          COALESCE((
            SELECT MAX(EXTRACT(EPOCH FROM COALESCE(er2.event_at, o3.created_at))::bigint * 1000)
            FROM public.orders o3
            JOIN public.events e2 ON e2.id = o3.event_id
            LEFT JOIN event_recency er2 ON er2.event_id = o3.event_id
            WHERE o3.payment_status = 'paid'
              AND o3.buyer_user_id = c.other_id
              AND e2.event_type IN ('event', 'trip')
              AND o3.event_id IN (SELECT eid FROM viewer_events)
          ), 0)
        ) AS sort_score
  FROM combined c
  JOIN public.profiles pr ON pr.id = c.other_id
  WHERE c.other_id IN (SELECT cu.user_id FROM consumer_users cu)
    AND c.other_id <> p_viewer_user_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.friends fb
      WHERE fb.user_id = p_viewer_user_id
        AND fb.friend_user_id = c.other_id
        AND fb.status = 'blocked'
        AND fb.deleted_at IS NULL
    )
  ORDER BY sort_score DESC, c.other_id ASC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.get_user_circle(uuid, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_circle(uuid, int, int) TO authenticated;

COMMIT;
