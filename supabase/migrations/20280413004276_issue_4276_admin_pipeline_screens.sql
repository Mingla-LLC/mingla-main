-- Issue #4276 wave 4, U2, U3 and U5: what the Place pool screens count, counted once
-- on the server.
--
-- U2. admin_place_pipeline_funnel: every stage a place passes, from active to final
-- score, per city and in total, read straight from place_pool (the older funnel reads a
-- materialized view that has no pre-check, reviews or Intelligence). Measured on
-- production's 88,403 places: 1.5 s, under the admin role's 8 s limit.
--
-- U3. The same rows carry what keeps a city from being ready: servable places with no
-- Intelligence (rules only), servable places with no reviews, and Intelligence that ran
-- with no reviews. Unsearched areas and flagged boxes come from admin-seed-places.
--
-- U5. admin_place_excluded_summary: why places were left out, grouped by rule, for the
-- pre-check and the final check, per city.
--
-- Read only. Admin only: SECURITY DEFINER with the admin check first, EXECUTE revoked
-- from PUBLIC and anon.
--
-- MINGLA-INVARIANT: I-4276-PIPELINE-SCREENS-SERVER-COUNTED | issue #4276 | The Place pool funnel, readiness gaps and exclusion reasons are counted by admin-only server functions, never by a browser page over a truncated list
--
-- Rollback: DROP FUNCTION public.admin_place_pipeline_funnel(uuid);
--           DROP FUNCTION public.admin_place_excluded_summary(uuid);

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_place_pipeline_funnel(p_city_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_cities jsonb;
  v_totals jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  WITH places AS (
    SELECT pp.city_id,
           pp.pre_photo_bouncer_validated_at IS NOT NULL AS pre_checked,
           pp.passes_pre_photo_check IS TRUE AS pre_passed,
           COALESCE(cardinality(pp.stored_photo_urls), 0) > 0 AS with_photos,
           pp.bouncer_validated_at IS NOT NULL AS final_checked,
           pp.is_servable IS TRUE AS servable,
           pp.serving_hold AS held,
           pp.ai_signal_scores IS NOT NULL AS intelligence,
           (r.has IS TRUE OR f.outcome IS NOT DISTINCT FROM 'none_on_google') AS reviewed,
           s.has IS TRUE AS scored
    FROM public.place_pool pp
    LEFT JOIN LATERAL (
      SELECT true AS has FROM public.place_external_reviews e WHERE e.place_pool_id = pp.id LIMIT 1
    ) r ON true
    LEFT JOIN public.place_review_fetch_state f ON f.place_id = pp.id
    LEFT JOIN LATERAL (
      SELECT true AS has FROM public.place_scores x WHERE x.place_id = pp.id LIMIT 1
    ) s ON true
    WHERE pp.is_active
      AND (p_city_id IS NULL OR pp.city_id = p_city_id)
  ),
  per_city AS (
    SELECT p.city_id,
           count(*) AS active,
           count(*) FILTER (WHERE p.pre_checked) AS pre_checked,
           count(*) FILTER (WHERE p.pre_passed) AS pre_passed,
           count(*) FILTER (WHERE p.with_photos) AS with_photos,
           count(*) FILTER (WHERE p.final_checked) AS final_checked,
           count(*) FILTER (WHERE p.servable) AS servable,
           count(*) FILTER (WHERE p.held) AS held,
           count(*) FILTER (WHERE p.servable AND p.reviewed) AS reviews,
           count(*) FILTER (WHERE p.servable AND p.intelligence) AS intelligence,
           count(*) FILTER (WHERE p.servable AND p.scored) AS scored,
           count(*) FILTER (WHERE p.servable AND NOT p.intelligence) AS rules_only,
           count(*) FILTER (WHERE p.servable AND NOT p.reviewed) AS no_reviews,
           count(*) FILTER (WHERE p.servable AND p.intelligence AND NOT p.reviewed) AS intelligence_without_reviews,
           count(*) FILTER (WHERE NOT p.pre_checked AND NOT p.final_checked) AS never_checked
    FROM places p
    GROUP BY p.city_id
  ),
  dropped AS (
    SELECT f.city_id, count(*) FILTER (WHERE f.reason = 'no_photos') AS dropped_no_photos
    FROM public.seeding_filtered_results f
    WHERE p_city_id IS NULL OR f.city_id = p_city_id
    GROUP BY f.city_id
  ),
  rows AS (
    SELECT c.id AS city_id, c.name AS city_name, c.country, c.country_code, c.status,
           c.is_live_for_consumers AS is_live,
           COALESCE(pc.active, 0) AS active, COALESCE(pc.pre_checked, 0) AS pre_checked,
           COALESCE(pc.pre_passed, 0) AS pre_passed, COALESCE(pc.with_photos, 0) AS with_photos,
           COALESCE(pc.final_checked, 0) AS final_checked, COALESCE(pc.servable, 0) AS servable,
           COALESCE(pc.held, 0) AS held, COALESCE(pc.reviews, 0) AS reviews,
           COALESCE(pc.intelligence, 0) AS intelligence, COALESCE(pc.scored, 0) AS scored,
           COALESCE(pc.rules_only, 0) AS rules_only, COALESCE(pc.no_reviews, 0) AS no_reviews,
           COALESCE(pc.intelligence_without_reviews, 0) AS intelligence_without_reviews,
           COALESCE(pc.never_checked, 0) AS never_checked,
           COALESCE(d.dropped_no_photos, 0) AS dropped_no_photos
    FROM public.seeding_cities c
    LEFT JOIN per_city pc ON pc.city_id = c.id
    LEFT JOIN dropped d ON d.city_id = c.id
    WHERE p_city_id IS NULL OR c.id = p_city_id
    UNION ALL
    -- Active places with no city, on their own row, so the totals add up.
    SELECT NULL, 'No city', NULL, NULL, NULL, false,
           pc.active, pc.pre_checked, pc.pre_passed, pc.with_photos, pc.final_checked,
           pc.servable, pc.held, pc.reviews, pc.intelligence, pc.scored, pc.rules_only,
           pc.no_reviews, pc.intelligence_without_reviews, pc.never_checked, 0
    FROM per_city pc
    WHERE pc.city_id IS NULL
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.active DESC, r.city_name), '[]'::jsonb),
         jsonb_build_object(
           'active', COALESCE(sum(r.active), 0),
           'pre_checked', COALESCE(sum(r.pre_checked), 0),
           'pre_passed', COALESCE(sum(r.pre_passed), 0),
           'with_photos', COALESCE(sum(r.with_photos), 0),
           'final_checked', COALESCE(sum(r.final_checked), 0),
           'servable', COALESCE(sum(r.servable), 0),
           'held', COALESCE(sum(r.held), 0),
           'reviews', COALESCE(sum(r.reviews), 0),
           'intelligence', COALESCE(sum(r.intelligence), 0),
           'scored', COALESCE(sum(r.scored), 0),
           'rules_only', COALESCE(sum(r.rules_only), 0),
           'no_reviews', COALESCE(sum(r.no_reviews), 0),
           'intelligence_without_reviews', COALESCE(sum(r.intelligence_without_reviews), 0),
           'never_checked', COALESCE(sum(r.never_checked), 0),
           'dropped_no_photos', COALESCE(sum(r.dropped_no_photos), 0)
         )
    INTO v_cities, v_totals
  FROM rows r;

  RETURN jsonb_build_object('totals', v_totals, 'cities', v_cities, 'counted_at', now());
END;
$function$;

-- Reasons look like 'B8:no_stored_photos;B4:no_website' or 'B1:gas_station'. Grouped by
-- the rule (the part before the first colon), so every wrong type counts under B1. A
-- place with two failed rules counts under both, so groups add up to more than places.
CREATE OR REPLACE FUNCTION public.admin_place_excluded_summary(p_city_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  WITH scoped AS (
    -- A held place has is_servable false while its verdict is parked; it isn't excluded.
    SELECT pp.id, pp.city_id,
           CASE WHEN pp.serving_hold THEN NULL ELSE pp.is_servable END AS is_servable,
           pp.passes_pre_photo_check, pp.bouncer_reason, pp.pre_photo_bouncer_reason
    FROM public.place_pool pp
    WHERE pp.is_active
      AND (p_city_id IS NULL OR pp.city_id = p_city_id)
  ),
  pre_rules AS (
    SELECT s.city_id, split_part(btrim(x.reason), ':', 1) AS rule
    FROM scoped s
    CROSS JOIN LATERAL unnest(string_to_array(s.pre_photo_bouncer_reason, ';')) AS x (reason)
    WHERE s.passes_pre_photo_check IS FALSE AND btrim(x.reason) <> ''
  ),
  final_rules AS (
    SELECT s.city_id, split_part(btrim(x.reason), ':', 1) AS rule
    FROM scoped s
    CROSS JOIN LATERAL unnest(string_to_array(s.bouncer_reason, ';')) AS x (reason)
    WHERE s.is_servable IS FALSE AND btrim(x.reason) <> ''
  ),
  per_city AS (
    SELECT s.city_id,
           count(*) AS active,
           count(*) FILTER (WHERE s.passes_pre_photo_check IS FALSE) AS pre_check_failed,
           count(*) FILTER (WHERE s.is_servable IS FALSE) AS final_check_failed
    FROM scoped s
    GROUP BY s.city_id
  )
  SELECT jsonb_build_object(
    'active', (SELECT count(*) FROM scoped),
    'pre_check_failed', (SELECT count(*) FROM scoped WHERE passes_pre_photo_check IS FALSE),
    'final_check_failed', (SELECT count(*) FROM scoped WHERE is_servable IS FALSE),
    'pre_check', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('rule', g.rule, 'places', g.n) ORDER BY g.n DESC, g.rule)
      FROM (SELECT rule, count(*) AS n FROM pre_rules GROUP BY rule) g
    ), '[]'::jsonb),
    'final_check', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('rule', g.rule, 'places', g.n) ORDER BY g.n DESC, g.rule)
      FROM (SELECT rule, count(*) AS n FROM final_rules GROUP BY rule) g
    ), '[]'::jsonb),
    'cities', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'city_id', pc.city_id,
        'city_name', COALESCE(c.name, 'No city'),
        'active', pc.active,
        'pre_check_failed', pc.pre_check_failed,
        'final_check_failed', pc.final_check_failed,
        'pre_check', COALESCE((
          SELECT jsonb_object_agg(g.rule, g.n)
          FROM (SELECT rule, count(*) AS n FROM pre_rules pr
                WHERE pr.city_id IS NOT DISTINCT FROM pc.city_id GROUP BY rule) g
        ), '{}'::jsonb)
      ) ORDER BY pc.active DESC)
      FROM per_city pc
      LEFT JOIN public.seeding_cities c ON c.id = pc.city_id
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_place_pipeline_funnel(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_place_excluded_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_place_pipeline_funnel(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_place_excluded_summary(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_place_pipeline_funnel(uuid) IS
  'Issue #4276 U2, U3: every stage from active place to final score, per city and in total, '
  'with the readiness gaps (rules only, no reviews, Intelligence without reviews). Admin only.';
COMMENT ON FUNCTION public.admin_place_excluded_summary(uuid) IS
  'Issue #4276 U5: why active places were left out, grouped by rule, for the pre-check and '
  'the final check, per city. Admin only.';

COMMIT;
