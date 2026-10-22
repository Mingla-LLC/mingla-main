-- #3682 — follower counts are public by product decision 2026-09-30
-- ("Follower count: always shown"). This relaxes ONLY the "NO count
-- exposure" clause of #679 (20270305000679 header). Rows stay owner-only:
-- no policy, grant or view on brand_follows changes. Numbers leave the
-- database only as aggregates through the functions below; none returns a
-- user id.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_brand_follows_brand_created
  ON public.brand_follows (brand_id, created_at);

CREATE OR REPLACE FUNCTION public.issue_3682_countable_followers(p_brand_ids uuid[])
RETURNS TABLE(brand_id uuid, user_id uuid, source text, created_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT bf.brand_id, bf.user_id, bf.source, bf.created_at
  FROM public.brand_follows bf
  JOIN public.brands b ON b.id = bf.brand_id
  JOIN public.profiles p ON p.id = bf.user_id
  JOIN auth.users au ON au.id = bf.user_id
  WHERE bf.brand_id = ANY(p_brand_ids)
    AND b.deleted_at IS NULL
    AND p.active IS TRUE
    AND p.explorer_deleted_at IS NULL
    -- Supabase auth schemas vary by image/version: production may expose
    -- lifecycle columns that the bare PG17 replay image does not. Reading the
    -- row through to_jsonb is the established compatibility boundary (#2101,
    -- #1777): an absent key behaves as NULL without making the migration fail.
    AND (to_jsonb(au) ->> 'deleted_at') IS NULL
    AND (
      (to_jsonb(au) ->> 'banned_until') IS NULL
      OR (to_jsonb(au) ->> 'banned_until')::timestamptz
        <= statement_timestamp()
    );
END;
$$;

ALTER FUNCTION public.issue_3682_countable_followers(uuid[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.issue_3682_countable_followers(uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3682_countable_followers(uuid[])
  TO service_role;

CREATE OR REPLACE FUNCTION public.get_brand_follower_count(p_brand_id uuid)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count bigint;
BEGIN
  IF p_brand_id IS NULL THEN
    RAISE EXCEPTION 'brand_id_required' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.brands b
    WHERE b.id = p_brand_id
      AND b.deleted_at IS NULL
  ) THEN
    RETURN NULL;
  END IF;

  SELECT count(*)::bigint
  INTO v_count
  FROM public.issue_3682_countable_followers(ARRAY[p_brand_id]);

  RETURN v_count;
END;
$$;

ALTER FUNCTION public.get_brand_follower_count(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_brand_follower_count(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_brand_follower_count(uuid)
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_brand_follower_counts(p_brand_ids uuid[])
RETURNS TABLE(brand_id uuid, follower_count bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_brand_ids IS NULL
     OR cardinality(p_brand_ids) = 0
     OR cardinality(p_brand_ids) > 100 THEN
    RAISE EXCEPTION 'brand_ids_invalid' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH requested AS (
    SELECT DISTINCT requested_id
    FROM unnest(p_brand_ids) AS requested_ids(requested_id)
    WHERE requested_id IS NOT NULL
  ),
  live_brands AS (
    SELECT b.id
    FROM requested r
    JOIN public.brands b ON b.id = r.requested_id
    WHERE b.deleted_at IS NULL
  ),
  counts AS (
    SELECT c.brand_id, count(*)::bigint AS follower_count
    FROM public.issue_3682_countable_followers(
      ARRAY(SELECT lb.id FROM live_brands lb)
    ) c
    GROUP BY c.brand_id
  )
  SELECT lb.id, COALESCE(c.follower_count, 0)::bigint
  FROM live_brands lb
  LEFT JOIN counts c ON c.brand_id = lb.id;
END;
$$;

ALTER FUNCTION public.get_brand_follower_counts(uuid[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_brand_follower_counts(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_brand_follower_counts(uuid[])
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.biz_brand_follower_summary_v1(p_brand_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := statement_timestamp();
  v_since timestamptz := v_now - interval '7 days';
  v_total bigint;
  v_new_this_week bigint;
  v_checkout bigint;
  v_brand_page bigint;
  v_email_invite bigint;
  v_other bigint;
  v_trend jsonb;
BEGIN
  IF auth.uid() IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM public.brands b
       WHERE b.id = p_brand_id AND b.deleted_at IS NULL
     )
     OR public.biz_brand_effective_rank(p_brand_id, auth.uid())
        < public.biz_role_rank('scanner') THEN
    RAISE EXCEPTION 'follower_summary_forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT
    count(*)::bigint,
    count(*) FILTER (WHERE c.created_at >= v_since)::bigint,
    count(*) FILTER (
      WHERE c.created_at >= v_since
        AND c.source = ANY(ARRAY['purchase', 'rsvp', 'booking'])
    )::bigint,
    count(*) FILTER (
      WHERE c.created_at >= v_since
        AND c.source = ANY(ARRAY['brand_page', 'web_email'])
    )::bigint,
    count(*) FILTER (
      WHERE c.created_at >= v_since
        AND c.source = 'web_follow_invite'
    )::bigint,
    count(*) FILTER (
      WHERE c.created_at >= v_since
        AND (
          c.source IS NULL
          OR c.source <> ALL(ARRAY[
            'purchase', 'rsvp', 'booking',
            'brand_page', 'web_email', 'web_follow_invite'
          ])
        )
    )::bigint
  INTO
    v_total,
    v_new_this_week,
    v_checkout,
    v_brand_page,
    v_email_invite,
    v_other
  FROM public.issue_3682_countable_followers(ARRAY[p_brand_id]) c;

  SELECT jsonb_agg(
    CASE
      WHEN day_index = 6 THEN v_total
      ELSE (
        SELECT count(*)::bigint
        FROM public.issue_3682_countable_followers(ARRAY[p_brand_id]) c
        WHERE c.created_at < v_now - make_interval(days => 6 - day_index)
      )
    END
    ORDER BY day_index
  )
  INTO v_trend
  FROM generate_series(0, 6) AS series(day_index);

  RETURN jsonb_build_object(
    'schemaVersion', 1,
    'total', v_total,
    'newThisWeek', v_new_this_week,
    'sourcesThisWeek', jsonb_build_object(
      'checkout', v_checkout,
      'brandPage', v_brand_page,
      'emailInvite', v_email_invite,
      'other', v_other
    ),
    'trend', v_trend,
    'asOf', v_now
  );
END;
$$;

ALTER FUNCTION public.biz_brand_follower_summary_v1(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.biz_brand_follower_summary_v1(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.biz_brand_follower_summary_v1(uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_brand_follower_stats(p_brand_ids uuid[])
RETURNS TABLE(brand_id uuid, follower_count bigint, new_this_week bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'admin_forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_brand_ids IS NULL OR cardinality(p_brand_ids) > 200 THEN
    RAISE EXCEPTION 'brand_ids_invalid' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH requested AS (
    SELECT DISTINCT requested_id
    FROM unnest(p_brand_ids) AS requested_ids(requested_id)
    WHERE requested_id IS NOT NULL
  ),
  live_brands AS (
    SELECT b.id
    FROM requested r
    JOIN public.brands b ON b.id = r.requested_id
    WHERE b.deleted_at IS NULL
  ),
  stats AS (
    SELECT
      c.brand_id,
      count(*)::bigint AS follower_count,
      count(*) FILTER (
        WHERE c.created_at >= statement_timestamp() - interval '7 days'
      )::bigint AS new_this_week
    FROM public.issue_3682_countable_followers(
      ARRAY(SELECT lb.id FROM live_brands lb)
    ) c
    GROUP BY c.brand_id
  )
  SELECT
    lb.id,
    COALESCE(s.follower_count, 0)::bigint,
    COALESCE(s.new_this_week, 0)::bigint
  FROM live_brands lb
  LEFT JOIN stats s ON s.brand_id = lb.id;
END;
$$;

ALTER FUNCTION public.admin_brand_follower_stats(uuid[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_brand_follower_stats(uuid[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_brand_follower_stats(uuid[])
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_list_brands_by_followers(
  p_search text,
  p_claim_status text,
  p_status text,
  p_payment_provider text,
  p_ascending boolean,
  p_offset integer,
  p_limit integer
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_search_pattern text;
  v_result jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'admin_forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100
     OR p_offset IS NULL OR p_offset < 0 THEN
    RAISE EXCEPTION 'pagination_invalid' USING ERRCODE = '22023';
  END IF;

  IF p_search IS NOT NULL AND btrim(p_search) <> '' THEN
    v_search_pattern := replace(
      replace(replace(btrim(p_search), '\', '\\'), '%', '\%'),
      '_',
      '\_'
    );
  END IF;

  WITH filtered AS (
    SELECT b.id, b.created_at, b.deleted_at
    FROM public.brands b
    WHERE (
        v_search_pattern IS NULL
        OR b.name ILIKE '%' || v_search_pattern || '%' ESCAPE '\'
        OR b.slug ILIKE '%' || v_search_pattern || '%' ESCAPE '\'
        OR b.city ILIKE '%' || v_search_pattern || '%' ESCAPE '\'
      )
      AND (p_claim_status IS NULL OR b.claim_status = p_claim_status)
      AND (
        p_status IS NULL
        OR (p_status = 'live' AND b.deleted_at IS NULL)
        OR (p_status = 'deleted' AND b.deleted_at IS NOT NULL)
        OR p_status NOT IN ('live', 'deleted')
      )
      AND (p_payment_provider IS NULL OR b.payment_provider = p_payment_provider)
  ),
  stats AS (
    SELECT
      c.brand_id,
      count(*)::bigint AS follower_count,
      count(*) FILTER (
        WHERE c.created_at >= statement_timestamp() - interval '7 days'
      )::bigint AS new_this_week
    FROM public.issue_3682_countable_followers(
      ARRAY(SELECT f.id FROM filtered f WHERE f.deleted_at IS NULL)
    ) c
    GROUP BY c.brand_id
  ),
  sortable AS (
    SELECT
      f.id AS brand_id,
      f.created_at,
      CASE WHEN f.deleted_at IS NULL
        THEN COALESCE(s.follower_count, 0)::bigint
        ELSE NULL::bigint
      END AS follower_count,
      CASE WHEN f.deleted_at IS NULL
        THEN COALESCE(s.new_this_week, 0)::bigint
        ELSE NULL::bigint
      END AS new_this_week
    FROM filtered f
    LEFT JOIN stats s ON s.brand_id = f.id
  ),
  ordered AS (
    SELECT
      s.*,
      row_number() OVER (
        ORDER BY
          CASE WHEN COALESCE(p_ascending, false) THEN s.follower_count END ASC NULLS LAST,
          CASE WHEN NOT COALESCE(p_ascending, false) THEN s.follower_count END DESC NULLS LAST,
          s.created_at DESC,
          s.brand_id
      ) AS row_number
    FROM sortable s
  ),
  paged AS (
    SELECT *
    FROM ordered o
    WHERE o.row_number > p_offset
      AND o.row_number <= p_offset + p_limit
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*)::bigint FROM filtered),
    'rows', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'brandId', p.brand_id,
            'followerCount', p.follower_count,
            'newThisWeek', p.new_this_week
          )
          ORDER BY p.row_number
        )
        FROM paged p
      ),
      '[]'::jsonb
    )
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

ALTER FUNCTION public.admin_list_brands_by_followers(
  text, text, text, text, boolean, integer, integer
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_list_brands_by_followers(
  text, text, text, text, boolean, integer, integer
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_brands_by_followers(
  text, text, text, text, boolean, integer, integer
) TO authenticated, service_role;

COMMIT;
