-- Issue #4276 round 6: the gaps table counts the work each stage would really do.
--
-- An audit of every gaps-table number against production found three columns that
-- disagreed with the work the stages do:
--
--   Photos       was pre_passed - with_photos. with_photos also counts places that have
--                photos without passing the pre-check, and places holding only the
--                '__backfill_failed__' marker, so Miami showed 3,638 instead of 3,688
--                and London, Paris and Brussels showed Done with 6, 12 and 9 waiting.
--   Final check  was with_photos - final_checked, two totals over different places
--                (Miami 72 instead of the 83 places with photos waiting).
--   Unsearched   legacy searches were attributed to their slug's first config
--                ('first_config'), so every tile looked unsearched for the slug's other
--                configs: London 768, Lagos 600, Cary 216 and Washington 396 searches a
--                fill would have paid for again.
--
-- admin_place_pipeline_funnel adds photos_needed and final_check_needed, counted place
-- by place (the old fields stay for every other reader). seeding_unfinished_searches
-- counts k legacy searches of a slug on a tile as its first k configs. Both are STABLE
-- reads; nothing is written. Static SQL only.
--
-- Rollback: re-run the two function definitions from
-- 20280413004276_issue_4276_admin_pipeline_screens.sql and
-- 20280410024276_issue_4276_tile_completeness.sql.

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

CREATE OR REPLACE FUNCTION public.seeding_unfinished_searches(p_city_id uuid, p_configs jsonb)
RETURNS TABLE (
  tile_id uuid,
  search_config_id text,
  included_types_override text[],
  level integer,
  reason text
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH configs AS (
    -- slug_pos: the config's place among its slug's configs, in the order given.
    SELECT e.cfg ->> 'id' AS id, e.cfg ->> 'slug' AS slug,
           row_number() OVER (PARTITION BY e.cfg ->> 'slug' ORDER BY e.ord) AS slug_pos
      FROM jsonb_array_elements(p_configs) WITH ORDINALITY AS e (cfg, ord)
  ),
  active AS (
    SELECT t.id, t.kind FROM public.seeding_tiles t
     WHERE t.city_id = p_city_id AND t.retired_at IS NULL
  )
  -- Every grid and fill tile owes every config one finished search.
  SELECT a.id, c.id, NULL::text[], 0,
         CASE WHEN EXISTS (
           SELECT 1 FROM public.seeding_batches b
            WHERE b.tile_id = a.id AND b.search_config_id = c.id AND b.level = 0
              AND b.google_api_calls > 0
         ) THEN 'failed' ELSE 'never_searched' END
  FROM active a CROSS JOIN configs c
  WHERE a.kind IN ('grid', 'fill')
    AND NOT EXISTS (
      SELECT 1 FROM public.seeding_batches b
       WHERE b.tile_id = a.id
         AND b.status = 'completed'
         AND b.included_types_override IS NULL
         AND (b.search_config_id = c.id
              OR (b.search_config_id IS NULL AND b.seeding_category = c.slug))
    )
    -- #4276 round 6: legacy searches. seeding_attribute_legacy_batches gave every legacy
    -- search of a slug its FIRST config ('first_config'), so a tile searched for all
    -- three casual-eats configs shows three casual_eats searches and none for the other
    -- two. k such searches on a tile cover the slug's first k configs.
    AND c.slug_pos > (
      SELECT count(*) FROM public.seeding_batches b
       WHERE b.tile_id = a.id
         AND b.status = 'completed'
         AND b.level = 0
         AND b.included_types_override IS NULL
         AND b.config_attribution = 'first_config'
         AND b.seeding_category = c.slug
    )
  UNION ALL
  -- A split search owes what was asked of it, and nothing more.
  SELECT DISTINCT b.tile_id, b.search_config_id, b.included_types_override, b.level,
         CASE WHEN b.status = 'failed' THEN 'failed' ELSE 'never_searched' END
  FROM public.seeding_batches b
  JOIN active a ON a.id = b.tile_id
  WHERE b.city_id = p_city_id
    AND b.level > 0
    AND b.status <> 'completed'
    AND NOT EXISTS (
      SELECT 1 FROM public.seeding_batches done
       WHERE done.tile_id = b.tile_id
         AND done.search_config_id IS NOT DISTINCT FROM b.search_config_id
         AND done.included_types_override IS NOT DISTINCT FROM b.included_types_override
         AND done.status = 'completed'
    );
$$;

REVOKE ALL ON FUNCTION public.seeding_unfinished_searches(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seeding_unfinished_searches(uuid, jsonb) TO service_role;

COMMIT;
