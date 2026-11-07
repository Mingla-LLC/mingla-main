-- Issue #4276 round 6: the gaps table counts the work each stage would really do.
--
-- An audit of every gaps-table number against production found two columns that
-- disagreed with the work their stages do:
--
--   Photos       was pre_passed - with_photos. with_photos also counts places that have
--                photos without passing the pre-check, and places holding only the
--                '__backfill_failed__' marker, so Miami showed 3,638 instead of 3,688
--                and London, Paris and Brussels showed Done with 6, 12 and 9 waiting.
--   Final check  was with_photos - final_checked, two totals over different places
--                (Miami 72 instead of the 53 places with real photos waiting).
--
-- admin_place_pipeline_funnel adds photos_needed and final_check_needed, counted place
-- by place (the old fields stay for every other reader). It is a STABLE read; nothing is
-- written. Static SQL only.
--
-- Unsearched is NOT changed here. seeding_unfinished_searches is right as it is: a
-- search recorded 'first_config' is a repeat of the first config (the repeated-search
-- bug in 20280410024276), so the slug's other configs were never searched and stay owed.
--
-- Rollback: re-run admin_place_pipeline_funnel from
-- 20280413004276_issue_4276_admin_pipeline_screens.sql.

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
           -- #4276 round 6: real photos, as backfill-place-photos reads them (not empty,
           -- not only the '__backfill_failed__' marker).
           COALESCE(array_length(array_remove(array_remove(pp.stored_photo_urls, ''), '__backfill_failed__'), 1), 0) > 0 AS real_photos,
           pp.is_servable IS NULL AS final_pending,
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
           count(*) FILTER (WHERE NOT p.pre_checked AND NOT p.final_checked) AS never_checked,
           -- #4276 round 6: the work the Photos and Final check stages would do, place by
           -- place, instead of a difference of two totals (which hides places that have
           -- photos without passing the pre-check, or hold only a failed-download marker).
           count(*) FILTER (WHERE p.pre_passed AND NOT p.real_photos) AS photos_needed,
           count(*) FILTER (WHERE p.final_pending AND p.real_photos) AS final_check_needed
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
           COALESCE(pc.photos_needed, 0) AS photos_needed,
           COALESCE(pc.final_check_needed, 0) AS final_check_needed,
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
           pc.no_reviews, pc.intelligence_without_reviews, pc.never_checked,
           pc.photos_needed, pc.final_check_needed, 0
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
           'photos_needed', COALESCE(sum(r.photos_needed), 0),
           'final_check_needed', COALESCE(sum(r.final_check_needed), 0),
           'dropped_no_photos', COALESCE(sum(r.dropped_no_photos), 0)
         )
    INTO v_cities, v_totals
  FROM rows r;

  RETURN jsonb_build_object('totals', v_totals, 'cities', v_cities, 'counted_at', now());
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_place_pipeline_funnel(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_place_pipeline_funnel(uuid) TO authenticated, service_role;

COMMIT;
