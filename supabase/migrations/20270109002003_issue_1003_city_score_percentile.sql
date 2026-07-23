-- ISSUE-1003 [Venue Website Grader] — city score percentile RPC.
-- The grader tells a venue where its Mingla score ranks among ALL scored
-- active venues in its city. Doing this in one SQL call (instead of pulling
-- hundreds of ids into the edge function and an oversized .in() filter) is
-- correct, fast, and index-friendly. STABLE, read-only, SECURITY INVOKER —
-- the ONLY caller is growth-tools-run via the service role (full table
-- access already), so no definer escalation is needed. EXECUTE is REVOKED
-- from anon/authenticated (ORCH-1392 anon-definer gate) — this RPC is
-- server-only and must never be reachable from a public JWT.

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

-- Server-only: the DB default-privileges grant EXECUTE to anon/authenticated,
-- so revoke explicitly (ORCH-1392 gate) and grant only the service role that
-- growth-tools-run uses.
REVOKE ALL ON FUNCTION public.tool_city_score_percentile(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tool_city_score_percentile(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.tool_city_score_percentile(uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.tool_city_score_percentile(uuid, text) TO service_role;
