-- ISSUE-1003 [Venue Website Grader] — lock down tool_city_score_percentile.
-- ORCH-1392 (anon-executable SECURITY DEFINER gate): the RPC's ONLY caller is
-- growth-tools-run via the service role (full table access already), so it is
-- switched to SECURITY INVOKER and EXECUTE is revoked from anon/authenticated.
-- Server-only — never reachable from a public JWT.

CREATE OR REPLACE FUNCTION public.tool_city_score_percentile(
  p_place_id uuid,
  p_city text
)
RETURNS TABLE (better_than_pct integer, sample integer)
LANGUAGE sql
STABLE
SECURITY INVOKER
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

REVOKE ALL ON FUNCTION public.tool_city_score_percentile(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tool_city_score_percentile(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.tool_city_score_percentile(uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.tool_city_score_percentile(uuid, text) TO service_role;
