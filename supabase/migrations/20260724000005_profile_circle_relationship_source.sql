-- Profile Circle relationship-source contract.
-- Extends get_user_circle with safe "why this person is here" metadata.

BEGIN;

DROP FUNCTION IF EXISTS public.get_user_circle(uuid, int, int);

CREATE FUNCTION public.get_user_circle(
  p_viewer_user_id uuid,
  p_limit int DEFAULT 60,
  p_offset int DEFAULT 0
)
RETURNS TABLE (
  user_id                     uuid,
  tier                        text,
  display_name                text,
  username                    text,
  avatar_url                  text,
  has_business_app            boolean,
  relationship_source         text,
  relationship_label          text,
  relationship_context_type   text,
  relationship_context_id     uuid,
  relationship_context_title  text,
  relationship_source_count   int,
  sort_score                  bigint
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
      AND f.friend_user_id NOT IN (SELECT tc.other_id FROM tier_close tc)
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
      AND e.deleted_at IS NULL
      AND e.event_type IN ('event', 'trip')
  ),
  tier_fof_candidates AS (
    SELECT
      f2.friend_user_id AS other_id,
      f2.user_id AS mutual_friend_id,
      COALESCE(NULLIF(TRIM(pr.display_name), ''), NULLIF(TRIM(pr.username), ''), 'a friend') AS mutual_friend_name,
      EXTRACT(EPOCH FROM f2.updated_at)::bigint * 1000 AS rel_created_ms
    FROM public.friends f2
    JOIN public.profiles pr ON pr.id = f2.user_id
    WHERE f2.user_id IN (SELECT vf.fid FROM viewer_friends vf)
      AND f2.status = 'accepted'
      AND f2.deleted_at IS NULL
      AND f2.friend_user_id <> p_viewer_user_id
      AND f2.friend_user_id NOT IN (SELECT tc.other_id FROM tier_close tc)
      AND f2.friend_user_id NOT IN (SELECT tf.other_id FROM tier_friend tf)
  ),
  tier_fof_ranked AS (
    SELECT
      tfc.*,
      COUNT(*) OVER (PARTITION BY tfc.other_id)::int AS source_count,
      ROW_NUMBER() OVER (
        PARTITION BY tfc.other_id
        ORDER BY tfc.rel_created_ms DESC, LOWER(tfc.mutual_friend_name) ASC, tfc.mutual_friend_id ASC
      ) AS rn
    FROM tier_fof_candidates tfc
  ),
  tier_fof AS (
    SELECT
      tfr.other_id,
      tfr.rel_created_ms,
      tfr.mutual_friend_id,
      tfr.mutual_friend_name,
      tfr.source_count
    FROM tier_fof_ranked tfr
    WHERE tfr.rn = 1
  ),
  tier_coattendee_event_matches AS (
    SELECT
      o2.buyer_user_id AS other_id,
      e.id AS event_id,
      e.event_type,
      CASE
        WHEN e.visibility IN ('public', 'discover') THEN e.title
        WHEN e.event_type = 'trip' THEN 'Shared private trip'
        ELSE 'Shared private event'
      END AS safe_event_title,
      CASE
        WHEN e.event_type = 'trip' AND e.visibility IN ('public', 'discover') THEN 'Also joined ' || e.title
        WHEN e.event_type = 'trip' THEN 'Shared private trip'
        WHEN COALESCE(er.event_at, MAX(o2.created_at)) >= now() AND e.visibility IN ('public', 'discover')
          THEN 'Also going to ' || e.title
        WHEN COALESCE(er.event_at, MAX(o2.created_at)) >= now() THEN 'Shared private event'
        WHEN e.visibility IN ('public', 'discover') THEN 'Also attended ' || e.title
        ELSE 'Shared private event'
      END AS event_relationship_label,
      MAX(EXTRACT(EPOCH FROM COALESCE(er.event_at, o2.created_at))::bigint * 1000) AS rel_created_ms,
      COALESCE(er.event_at, MAX(o2.created_at)) AS event_at
    FROM public.orders o2
    JOIN public.events e ON e.id = o2.event_id
    LEFT JOIN event_recency er ON er.event_id = o2.event_id
    WHERE o2.event_id IN (SELECT ve.eid FROM viewer_events ve)
      AND e.deleted_at IS NULL
      AND e.event_type IN ('event', 'trip')
      AND o2.payment_status = 'paid'
      AND o2.buyer_user_id IS NOT NULL
      AND o2.buyer_user_id <> p_viewer_user_id
      AND o2.buyer_user_id NOT IN (SELECT tc.other_id FROM tier_close tc)
      AND o2.buyer_user_id NOT IN (SELECT tf.other_id FROM tier_friend tf)
    GROUP BY o2.buyer_user_id, e.id, e.event_type, e.title, e.visibility, er.event_at
  ),
  tier_coattendee_ranked AS (
    SELECT
      tcem.*,
      COUNT(*) OVER (PARTITION BY tcem.other_id)::int AS source_count,
      ROW_NUMBER() OVER (
        PARTITION BY tcem.other_id
        ORDER BY
          CASE WHEN tcem.event_at >= now() THEN 0 ELSE 1 END ASC,
          tcem.rel_created_ms DESC,
          LOWER(tcem.safe_event_title) ASC,
          tcem.event_id ASC
      ) AS rn
    FROM tier_coattendee_event_matches tcem
  ),
  tier_coattendee AS (
    SELECT
      tcr.other_id,
      tcr.rel_created_ms,
      tcr.event_id,
      tcr.event_type,
      tcr.safe_event_title,
      tcr.event_relationship_label,
      tcr.source_count
    FROM tier_coattendee_ranked tcr
    WHERE tcr.rn = 1
  ),
  tier_extended_sources AS (
    SELECT
      tf.other_id,
      tf.rel_created_ms,
      1 AS source_priority,
      'friend_of_friend'::text AS raw_relationship_source,
      'Friend of ' || tf.mutual_friend_name AS relationship_label,
      'user'::text AS relationship_context_type,
      tf.mutual_friend_id AS relationship_context_id,
      tf.mutual_friend_name AS relationship_context_title,
      tf.source_count AS relationship_source_count
    FROM tier_fof tf
    UNION ALL
    SELECT
      tc.other_id,
      tc.rel_created_ms,
      2 AS source_priority,
      'co_attendee'::text AS raw_relationship_source,
      tc.event_relationship_label AS relationship_label,
      tc.event_type::text AS relationship_context_type,
      tc.event_id AS relationship_context_id,
      tc.safe_event_title AS relationship_context_title,
      tc.source_count AS relationship_source_count
    FROM tier_coattendee tc
  ),
  tier_extended_ranked AS (
    SELECT
      tes.*,
      (
        SELECT COUNT(DISTINCT tes2.raw_relationship_source)
        FROM tier_extended_sources tes2
        WHERE tes2.other_id = tes.other_id
      ) AS source_type_count,
      MAX(tes.rel_created_ms) OVER (PARTITION BY tes.other_id) AS max_rel_created_ms,
      ROW_NUMBER() OVER (
        PARTITION BY tes.other_id
        ORDER BY tes.source_priority DESC, tes.rel_created_ms DESC, LOWER(tes.relationship_label) ASC, tes.relationship_context_id ASC
      ) AS rn
    FROM tier_extended_sources tes
  ),
  tier_extended AS (
    SELECT
      ter.other_id,
      ter.max_rel_created_ms AS rel_created_ms,
      CASE WHEN ter.source_type_count > 1 THEN 'mixed' ELSE ter.raw_relationship_source END AS relationship_source,
      ter.relationship_label,
      ter.relationship_context_type,
      ter.relationship_context_id,
      ter.relationship_context_title,
      ter.relationship_source_count
    FROM tier_extended_ranked ter
    WHERE ter.rn = 1
  ),
  combined AS (
    SELECT
      tc.other_id,
      'close'::text AS tier,
      tc.rel_created_ms,
      'paired'::text AS relationship_source,
      'Close friend'::text AS relationship_label,
      NULL::text AS relationship_context_type,
      NULL::uuid AS relationship_context_id,
      NULL::text AS relationship_context_title,
      1::int AS relationship_source_count
    FROM tier_close tc
    UNION ALL
    SELECT
      tf.other_id,
      'friend'::text AS tier,
      tf.rel_created_ms,
      'friend'::text AS relationship_source,
      'Friend'::text AS relationship_label,
      NULL::text AS relationship_context_type,
      NULL::uuid AS relationship_context_id,
      NULL::text AS relationship_context_title,
      1::int AS relationship_source_count
    FROM tier_friend tf
    UNION ALL
    SELECT
      te.other_id,
      'extended'::text AS tier,
      te.rel_created_ms,
      te.relationship_source,
      te.relationship_label,
      te.relationship_context_type,
      te.relationship_context_id,
      te.relationship_context_title,
      te.relationship_source_count
    FROM tier_extended te
  )
  SELECT
    c.other_id AS user_id,
    c.tier,
    pr.display_name,
    pr.username,
    pr.avatar_url,
    (c.other_id IN (SELECT dau.user_id FROM dual_app_users dau)) AS has_business_app,
    c.relationship_source,
    c.relationship_label,
    c.relationship_context_type,
    c.relationship_context_id,
    c.relationship_context_title,
    c.relationship_source_count,
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
              AND e2.deleted_at IS NULL
              AND e2.event_type IN ('event', 'trip')
              AND o3.event_id IN (SELECT ve2.eid FROM viewer_events ve2)
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
    AND NOT EXISTS (
      SELECT 1
      FROM public.friends rb
      WHERE rb.user_id = c.other_id
        AND rb.friend_user_id = p_viewer_user_id
        AND rb.status = 'blocked'
        AND rb.deleted_at IS NULL
    )
  ORDER BY sort_score DESC, c.other_id ASC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.get_user_circle(uuid, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_circle(uuid, int, int) TO authenticated;

COMMIT;
