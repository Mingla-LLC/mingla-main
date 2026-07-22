-- ISSUE-1003 [Venue Website Grader] — city score percentile RPC.
-- The grader tells a venue where its Mingla score ranks among ALL scored
-- active venues in its city. Doing this in one SQL call (instead of pulling
-- hundreds of ids into the edge function and an oversized .in() filter) is
-- correct, fast, and index-friendly. STABLE, read-only, SECURITY DEFINER so
-- the public edge function (service role already) gets a stable contract.

CREATE OR REPLACE FUNCTION public.tool_city_score_percentile(
  p_place_id uuid,
  p_city text
)
RETURNS TABLE (better_than_pct integer, sample integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH city_best AS (
    SELECT ps.place_id, MAX(ps.score) AS best
    FROM place_scores ps
    JOIN place_pool pp ON pp.id = ps.place_id
    WHERE pp.is_active = true
      AND pp.city ILIKE '%' || p_city || '%'
    GROUP BY ps.place_id
  ),
  mine AS (SELECT best FROM city_best WHERE place_id = p_place_id)
  SELECT
    ROUND(
      100.0 * COUNT(*) FILTER (WHERE cb.best < (SELECT best FROM mine))
      / NULLIF(COUNT(*), 0)
    )::integer AS better_than_pct,
    COUNT(*)::integer AS sample
  FROM city_best cb;
$$;
