-- issue #1023 wave 2 — widen every theme-animation allow-list from the 9
-- original slugs to all 29 generated theme motions.
--
-- WRITTEN, NOT APPLIED (wave 1 ships preview-only tiles for the 20 new slugs
-- behind the [TRANSITIONAL] SERVER_ACCEPTED_ANIMATION_SLUGS list in
-- packages/offering-rendering/designTokens.ts; delete that list when this is
-- applied to production).
--
-- Every allow-list that names 'shimmer_reveal' today (grep of
-- supabase/migrations, 2026-11-07):
--   tables  brands.theme_animation                    (brands_theme_animation_whitelist_chk)
--           events.theme_animation_override           (events_theme_animation_override_whitelist_chk)
--           venue_listings.theme_animation_override   (venue_listings_theme_animation_override_whitelist_chk)
--   RPCs    biz_create_venue_listing                  (latest: 20270227001719)
--           brand_context_completeness_internal       (latest: 20280309002830)
--           ari_update_brand_context                  (latest: 20280303002830)
-- The three functions below are those latest definitions verbatim, with ONLY
-- the animation list widened. Widening is additive: every row valid before
-- stays valid, so the CHECK swap cannot fail on existing data.
--
-- NOT covered here (not SQL): supabase/functions/_shared/agentSiteTools.ts
-- has its own animation enum for Ari's tool schema; widen it with the wave 2
-- edge deploy.

BEGIN;

ALTER TABLE public.brands
  DROP CONSTRAINT IF EXISTS brands_theme_animation_whitelist_chk;
ALTER TABLE public.brands
  ADD CONSTRAINT brands_theme_animation_whitelist_chk
  CHECK (theme_animation IS NULL OR theme_animation IN (
    'none',
    'confetti',
    'fireworks',
    'balloons',
    'sparkles',
    'glitter_shower',
    'snowfall',
    'falling_petals',
    'hearts',
    'shimmer_reveal',
    'streamers',
    'party_shapes',
    'bubbles',
    'champagne',
    'disco_glints',
    'bokeh',
    'golden_dust',
    'neon_pulse',
    'autumn_leaves',
    'fireflies',
    'rain',
    'sun_rays',
    'starry_sky',
    'aurora',
    'lanterns',
    'embers',
    'music_notes',
    'love_burst',
    'rose_petals',
    'love_balloons'
  ));

ALTER TABLE public.events
  DROP CONSTRAINT IF EXISTS events_theme_animation_override_whitelist_chk;
ALTER TABLE public.events
  ADD CONSTRAINT events_theme_animation_override_whitelist_chk
  CHECK (theme_animation_override IS NULL OR theme_animation_override IN (
    'none',
    'confetti',
    'fireworks',
    'balloons',
    'sparkles',
    'glitter_shower',
    'snowfall',
    'falling_petals',
    'hearts',
    'shimmer_reveal',
    'streamers',
    'party_shapes',
    'bubbles',
    'champagne',
    'disco_glints',
    'bokeh',
    'golden_dust',
    'neon_pulse',
    'autumn_leaves',
    'fireflies',
    'rain',
    'sun_rays',
    'starry_sky',
    'aurora',
    'lanterns',
    'embers',
    'music_notes',
    'love_burst',
    'rose_petals',
    'love_balloons'
  ));

ALTER TABLE public.venue_listings
  DROP CONSTRAINT IF EXISTS venue_listings_theme_animation_override_whitelist_chk;
ALTER TABLE public.venue_listings
  ADD CONSTRAINT venue_listings_theme_animation_override_whitelist_chk
  CHECK (theme_animation_override IS NULL OR theme_animation_override IN (
    'none',
    'confetti',
    'fireworks',
    'balloons',
    'sparkles',
    'glitter_shower',
    'snowfall',
    'falling_petals',
    'hearts',
    'shimmer_reveal',
    'streamers',
    'party_shapes',
    'bubbles',
    'champagne',
    'disco_glints',
    'bokeh',
    'golden_dust',
    'neon_pulse',
    'autumn_leaves',
    'fireflies',
    'rain',
    'sun_rays',
    'starry_sky',
    'aurora',
    'lanterns',
    'embers',
    'music_notes',
    'love_burst',
    'rose_petals',
    'love_balloons'
  ));

-- ---------------------------------------------------------------------------
-- biz_create_venue_listing (from 20270227001719, list widened)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.biz_create_venue_listing (
  p_brand_id uuid,
  p_name text,
  p_slug text,
  p_description text,
  p_google_place_id text,
  p_lat double precision,
  p_lng double precision,
  p_city text,
  p_country_code text,
  p_address text,
  p_venue_category text,
  p_contact_email text,
  p_contact_phone text,
  p_cover_media_url text,
  p_cover_media_type text,
  p_hours jsonb,
  p_place_pool_id uuid DEFAULT NULL,
  p_coordinate_precision text DEFAULT '',
  -- issue #1564 — the venue's own theme. '' / NULL / unrecognised → NULL →
  -- inherit the brand. Appended last with defaults so an 18-arg named call
  -- from an older deployed client still resolves.
  p_theme_color text DEFAULT '',
  p_theme_font text DEFAULT '',
  p_theme_animation text DEFAULT '',
  -- #1719: stable still travels with the cover identity. Appended for
  -- positional compatibility with every previously shipped client.
  p_cover_media_poster_url text DEFAULT ''
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid;
  v_venue_id uuid;
  v_idx int;
  v_hour jsonb;
  v_cover_url text;
  v_cover_type text;
  v_cover_poster text;
  v_google text;
  v_pool_google text;
  v_coordinate_precision text;
  v_stay_authoring_enabled boolean := false;
  v_theme_color text;
  v_theme_font text;
  v_theme_animation text;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.brands b
    WHERE b.id = p_brand_id AND b.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'brand_not_found';
  END IF;
  IF public.biz_brand_effective_rank_for_caller(p_brand_id)
       < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF length(trim(coalesce(p_name, ''))) = 0 THEN
    RAISE EXCEPTION 'name_required';
  END IF;
  IF length(trim(coalesce(p_slug, ''))) = 0 THEN
    RAISE EXCEPTION 'slug_required';
  END IF;
  IF trim(p_slug) !~ '^[a-z0-9]{1,32}$' THEN
    RAISE EXCEPTION 'invalid_slug';
  END IF;
  IF p_lat IS NULL OR p_lng IS NULL THEN
    RAISE EXCEPTION 'location_required';
  END IF;
  IF p_hours IS NULL OR jsonb_typeof(p_hours) <> 'array'
     OR jsonb_array_length(p_hours) <> 7 THEN
    RAISE EXCEPTION 'hours_must_have_7_rows';
  END IF;
  IF p_venue_category IS NULL OR p_venue_category NOT IN (
    'restaurant',
    'play',
    'creative_and_arts',
    'stay'
  ) THEN
    RAISE EXCEPTION 'invalid_venue_category';
  END IF;
  IF p_venue_category = 'stay' THEN
    SELECT COALESCE(flag.is_enabled, false)
    INTO v_stay_authoring_enabled
    FROM public.feature_flags flag
    WHERE flag.flag_key = 'STAY_VENUE_AUTHORING';
    IF NOT COALESCE(v_stay_authoring_enabled, false) THEN
      RAISE EXCEPTION 'stay_authoring_disabled';
    END IF;
  END IF;
  v_coordinate_precision := nullif(
    trim(coalesce(p_coordinate_precision, '')),
    ''
  );
  IF v_coordinate_precision IS NOT NULL
     AND v_coordinate_precision NOT IN ('exact', 'approximate') THEN
    v_coordinate_precision := NULL;
  END IF;
  -- issue #1564 — normalise each theme axis INDEPENDENTLY. A bad font must not
  -- discard a good colour: the axes inherit separately by design.
  v_theme_color := nullif(trim(coalesce(p_theme_color, '')), '');
  IF v_theme_color IS NOT NULL AND v_theme_color !~* '^#[0-9a-f]{6}$' THEN
    v_theme_color := NULL;
  END IF;
  v_theme_font := nullif(trim(coalesce(p_theme_font, '')), '');
  IF v_theme_font IS NOT NULL AND v_theme_font NOT IN (
    'inter','poppins','space_grotesk','plus_jakarta_sans','manrope',
    'playfair_display','dm_serif_display','fraunces','lora',
    'bebas_neue','anton','unbounded','caveat','dancing_script'
  ) THEN
    v_theme_font := NULL;
  END IF;
  v_theme_animation := nullif(trim(coalesce(p_theme_animation, '')), '');
  IF v_theme_animation IS NOT NULL AND v_theme_animation NOT IN (
    'none','confetti','fireworks','balloons','sparkles',
    'glitter_shower','snowfall','falling_petals','hearts','shimmer_reveal',
    -- issue #1023: the 20 new theme motion slugs
    'streamers',
    'party_shapes',
    'bubbles',
    'champagne',
    'disco_glints',
    'bokeh',
    'golden_dust',
    'neon_pulse',
    'autumn_leaves',
    'fireflies',
    'rain',
    'sun_rays',
    'starry_sky',
    'aurora',
    'lanterns',
    'embers',
    'music_notes',
    'love_burst',
    'rose_petals',
    'love_balloons'
  ) THEN
    v_theme_animation := NULL;
  END IF;
  v_google := nullif(trim(coalesce(p_google_place_id, '')), '');
  IF p_place_pool_id IS NOT NULL THEN
    SELECT p.google_place_id
    INTO v_pool_google
    FROM public.place_pool p
    WHERE p.id = p_place_pool_id AND p.is_active = true;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'place_pool_not_found';
    END IF;
    IF v_google IS NULL OR trim(v_pool_google) IS DISTINCT FROM v_google THEN
      RAISE EXCEPTION 'place_pool_google_place_id_mismatch';
    END IF;
  END IF;
  v_cover_url := nullif(trim(coalesce(p_cover_media_url, '')), '');
  v_cover_type := nullif(trim(coalesce(p_cover_media_type, '')), '');
  IF v_cover_type IS NOT NULL
     AND v_cover_type NOT IN ('image', 'video', 'gif') THEN
    RAISE EXCEPTION 'invalid_cover_media_type';
  END IF;
  IF v_cover_url IS NOT NULL AND v_cover_type IS NULL THEN
    RAISE EXCEPTION 'cover_media_type_required';
  END IF;
  IF v_cover_url IS NULL THEN
    v_cover_type := NULL;
  END IF;
  v_cover_poster := COALESCE(
    nullif(trim(coalesce(p_cover_media_poster_url, '')), ''),
    CASE WHEN v_cover_type = 'image' THEN v_cover_url END
  );
  PERFORM public.assert_cover_media_triplet(
    v_cover_url,
    v_cover_type,
    v_cover_poster
  );

  INSERT INTO public.venue_listings (
    brand_id,
    name,
    slug,
    address,
    google_place_id,
    place_pool_id,
    lat,
    lng,
    city,
    country_code,
    venue_category,
    contact_email,
    contact_phone,
    cover_media_url,
    cover_media_poster_url,
    cover_media_type,
    coordinate_precision,
    theme_color_override,
    theme_font_override,
    theme_animation_override,
    claim_status
  ) VALUES (
    p_brand_id,
    trim(p_name),
    trim(p_slug),
    nullif(trim(coalesce(p_address, '')), ''),
    v_google,
    p_place_pool_id,
    p_lat,
    p_lng,
    nullif(trim(coalesce(p_city, '')), ''),
    nullif(trim(coalesce(p_country_code, '')), ''),
    p_venue_category,
    nullif(trim(coalesce(p_contact_email, '')), ''),
    nullif(trim(coalesce(p_contact_phone, '')), ''),
    v_cover_url,
    v_cover_poster,
    v_cover_type,
    v_coordinate_precision,
    v_theme_color,
    v_theme_font,
    v_theme_animation,
    'pending_review'
  )
  RETURNING id INTO v_venue_id;

  FOR v_idx IN 0 .. 6 LOOP
    v_hour := p_hours -> v_idx;
    IF v_hour IS NULL THEN
      RAISE EXCEPTION 'missing_hour_index_%', v_idx;
    END IF;
    INSERT INTO public.brand_hours (
      brand_id,
      venue_id,
      weekday,
      open_time,
      close_time,
      is_closed
    ) VALUES (
      p_brand_id,
      v_venue_id,
      (v_hour ->> 'weekday')::smallint,
      CASE
        WHEN coalesce((v_hour ->> 'is_closed')::boolean, false) THEN NULL
        WHEN v_hour ->> 'open_time' IS NULL
          OR (v_hour ->> 'open_time') = '' THEN NULL
        ELSE (v_hour ->> 'open_time')::time
      END,
      CASE
        WHEN coalesce((v_hour ->> 'is_closed')::boolean, false) THEN NULL
        WHEN v_hour ->> 'close_time' IS NULL
          OR (v_hour ->> 'close_time') = '' THEN NULL
        ELSE (v_hour ->> 'close_time')::time
      END,
      coalesce((v_hour ->> 'is_closed')::boolean, false)
    );
  END LOOP;
  INSERT INTO public.brand_place_pipeline_state (
    brand_id,
    venue_id,
    place_pool_id,
    status,
    stage_status,
    readiness,
    coaching
  ) VALUES (
    p_brand_id,
    v_venue_id,
    p_place_pool_id,
    'draft',
    jsonb_build_object('tier1', 'created'),
    '{}'::jsonb,
    '[]'::jsonb
  )
  ON CONFLICT (venue_id) DO UPDATE
  SET place_pool_id = excluded.place_pool_id,
      status = excluded.status,
      stage_status =
        brand_place_pipeline_state.stage_status || excluded.stage_status,
      updated_at = now();
  PERFORM public.biz_derive_service_periods_from_brand_hours(v_venue_id);
  RETURN v_venue_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.biz_create_venue_listing(
  uuid, text, text, text, text, double precision, double precision, text, text,
  text, text, text, text, text, text, jsonb, uuid, text, text, text, text, text
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.biz_create_venue_listing(
  uuid, text, text, text, text, double precision, double precision, text, text,
  text, text, text, text, text, text, jsonb, uuid, text, text, text, text, text
) FROM anon;
GRANT EXECUTE ON FUNCTION public.biz_create_venue_listing(
  uuid, text, text, text, text, double precision, double precision, text, text,
  text, text, text, text, text, text, jsonb, uuid, text, text, text, text, text
) TO authenticated;
COMMENT ON FUNCTION public.biz_create_venue_listing(
  uuid, text, text, text, text, double precision, double precision, text, text,
  text, text, text, text, text, text, jsonb, uuid, text, text, text, text, text
) IS 'Issue #1463: event_manager+ may create pending-review venue listings for their own brand; publication and approval remain separately gated. Issue #1564: + p_theme_color/p_theme_font/p_theme_animation — the venue''s OWN theme, normalised per axis and fail-soft to NULL (inherit the brand) so a stale client can never block a submission over a colour. Issue #1719: the appended poster is validated and inserted atomically with URL/type.';

-- ---------------------------------------------------------------------------
-- brand_context_completeness_internal (from 20280309002830, list widened)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.brand_context_completeness_internal(p_brand_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_brand public.brands%ROWTYPE;
  v_plan public.brand_site_plans%ROWTYPE;
  v_site public.brand_sites%ROWTYPE;
  v_fields jsonb := '[]'::jsonb;
  v_social_present boolean;
  v_social_valid boolean;
  v_venue_selected boolean;
  v_required_gaps integer;
  v_recommended_gaps integer;
  v_verified integer;
  v_exceptions integer;
  v_validation_checks jsonb;
  v_failed_validation integer;
BEGIN
  SELECT * INTO v_brand FROM public.brands WHERE id = p_brand_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'brand_not_found'; END IF;
  SELECT * INTO v_plan FROM public.brand_site_plans WHERE brand_id = p_brand_id;
  SELECT * INTO v_site FROM public.brand_sites WHERE brand_id = p_brand_id;

  v_social_present :=
    CASE WHEN jsonb_typeof(COALESCE(v_brand.social_links, '{}'::jsonb)) = 'object'
      THEN EXISTS (
        SELECT 1 FROM jsonb_each_text(COALESCE(v_brand.social_links, '{}'::jsonb)) e
        WHERE NULLIF(btrim(e.value), '') IS NOT NULL
      ) ELSE false END
    OR CASE WHEN jsonb_typeof(COALESCE(v_brand.custom_links, '[]'::jsonb)) = 'array'
      THEN EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE(v_brand.custom_links, '[]'::jsonb)) e
        WHERE jsonb_typeof(e) = 'object'
          AND NULLIF(btrim(COALESCE(e->>'url','')), '') IS NOT NULL
      ) ELSE false END;
  v_social_valid :=
    CASE WHEN jsonb_typeof(COALESCE(v_brand.social_links, '{}'::jsonb)) = 'object'
      THEN NOT EXISTS (
        SELECT 1 FROM jsonb_each(COALESCE(v_brand.social_links, '{}'::jsonb)) e
        WHERE e.key NOT IN ('website','instagram','tiktok','x','facebook','youtube','linkedin','threads')
          OR jsonb_typeof(e.value) <> 'string'
          OR length(e.value#>>'{}') > 500 OR (e.value#>>'{}') !~ '^https://'
      ) ELSE false END
    AND CASE WHEN jsonb_typeof(COALESCE(v_brand.custom_links, '[]'::jsonb)) = 'array'
      THEN NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE(v_brand.custom_links, '[]'::jsonb)) e
        WHERE jsonb_typeof(e) <> 'object'
          OR NOT public.brand_site_json_keys_allowed(e,ARRAY['label','url'])
          OR jsonb_typeof(e->'label') <> 'string'
          OR jsonb_typeof(e->'url') <> 'string'
          OR length(btrim(COALESCE(e->>'label',''))) NOT BETWEEN 1 AND 80
          OR COALESCE(e->>'url','') !~ '^https://' OR length(COALESCE(e->>'url','')) > 1000
      ) ELSE false END;
  v_venue_selected := EXISTS (
    SELECT 1 FROM unnest(COALESCE(v_plan.offerings_selected, ARRAY[]::text[])) item
    WHERE item LIKE 'venue_%'
  );

  v_fields := v_fields || jsonb_build_array(public.brand_context_field_json(
    p_brand_id,'name','Brand name','Identity','required',to_jsonb(v_brand.name),
    NULLIF(btrim(COALESCE(v_brand.name,'')),'') IS NOT NULL,
    length(btrim(COALESCE(v_brand.name,''))) BETWEEN 1 AND 80));
  v_fields := v_fields || jsonb_build_array(public.brand_context_field_json(
    p_brand_id,'description','Brand story','Identity','required',to_jsonb(v_brand.description),
    NULLIF(btrim(COALESCE(v_brand.description,'')),'') IS NOT NULL,
    length(COALESCE(v_brand.description,'')) <= 500));
  v_fields := v_fields || jsonb_build_array(public.brand_context_field_json(
    p_brand_id,'offerings_selected','What you offer','Offer','required',to_jsonb(v_plan.offerings_selected),
    v_plan.offerings_selected IS NOT NULL,true));
  v_fields := v_fields || jsonb_build_array(public.brand_context_field_json(
    p_brand_id,'design_key','Website design','Design','required',
    to_jsonb(COALESCE(v_plan.design_key, v_site.design_key)),
    COALESCE(v_plan.design_key, v_site.design_key) IS NOT NULL,
    COALESCE(v_plan.design_key, v_site.design_key) IN ('atelier','voyage')));
  v_fields := v_fields || jsonb_build_array(public.brand_context_field_json(
    p_brand_id,'story.who','Who comes with you','Story','required',to_jsonb(v_plan.story->>'who'),
    NULLIF(btrim(COALESCE(v_plan.story->>'who','')),'') IS NOT NULL,
    length(COALESCE(v_plan.story->>'who','')) <= 300));
  v_fields := v_fields || jsonb_build_array(public.brand_context_field_json(
    p_brand_id,'story.why','Why they choose you','Story','required',to_jsonb(v_plan.story->>'why'),
    NULLIF(btrim(COALESCE(v_plan.story->>'why','')),'') IS NOT NULL,
    length(COALESCE(v_plan.story->>'why','')) <= 300));
  v_fields := v_fields || jsonb_build_array(public.brand_context_field_json(
    p_brand_id,'story.main_action','Main visitor action','Story','required',to_jsonb(v_plan.story->>'main_action'),
    NULLIF(btrim(COALESCE(v_plan.story->>'main_action','')),'') IS NOT NULL,
    length(COALESCE(v_plan.story->>'main_action','')) <= 300));
  v_fields := v_fields || jsonb_build_array(public.brand_context_field_json(
    p_brand_id,'approved_plan','Owner-approved plan','Approval','required',to_jsonb(v_plan.approved_plan),
    v_plan.approved_plan IS NOT NULL AND v_plan.approved_at IS NOT NULL,
    jsonb_typeof(v_plan.approved_plan) = 'object'));
  v_fields := v_fields || jsonb_build_array(public.brand_context_field_json(
    p_brand_id,'venue_descriptor','Venue description','Offer',
    CASE WHEN v_venue_selected THEN 'recommended' ELSE 'optional' END,
    to_jsonb(v_plan.venue_descriptor),
    NULLIF(btrim(COALESCE(v_plan.venue_descriptor,'')),'') IS NOT NULL,
    length(COALESCE(v_plan.venue_descriptor,'')) <= 60));
  v_fields := v_fields || jsonb_build_array(public.brand_context_field_json(
    p_brand_id,'contact_email','Contact email','Contact','recommended',to_jsonb(v_brand.contact_email),
    NULLIF(btrim(COALESCE(v_brand.contact_email,'')),'') IS NOT NULL,
    COALESCE(v_brand.contact_email,'') ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'));
  v_fields := v_fields || jsonb_build_array(public.brand_context_field_json(
    p_brand_id,'contact_phone','Contact phone','Contact','recommended',to_jsonb(v_brand.contact_phone),
    NULLIF(btrim(COALESCE(v_brand.contact_phone,'')),'') IS NOT NULL,
    COALESCE(v_brand.contact_phone,'') ~ '^\+[1-9][0-9]{7,14}$'));
  v_fields := v_fields || jsonb_build_array(public.brand_context_field_json(
    p_brand_id,'address','Address','Location','recommended',to_jsonb(v_brand.address),
    NULLIF(btrim(COALESCE(v_brand.address,'')),'') IS NOT NULL,
    length(COALESCE(v_brand.address,'')) <= 240));
  v_fields := v_fields || jsonb_build_array(public.brand_context_field_json(
    p_brand_id,'city_country','City and country','Location','recommended',
    jsonb_build_object('city',v_brand.city,'country_code',v_brand.country_code),
    NULLIF(btrim(COALESCE(v_brand.city,'')),'') IS NOT NULL
      AND NULLIF(btrim(COALESCE(v_brand.country_code,'')),'') IS NOT NULL,
    length(COALESCE(v_brand.city,'')) <= 120
      AND COALESCE(v_brand.country_code,'') ~ '^[A-Z]{2}$'));
  v_fields := v_fields || jsonb_build_array(public.brand_context_field_json(
    p_brand_id,'social_links','Public website or social link','Links','recommended',
    jsonb_build_object(
      'social_links',COALESCE(v_brand.social_links,'{}'::jsonb),
      'custom_links',COALESCE(v_brand.custom_links,'[]'::jsonb)),
    v_social_present,v_social_valid));
  v_fields := v_fields || jsonb_build_array(public.brand_context_field_json(
    p_brand_id,'profile_photo','Brand logo','Media','recommended',to_jsonb(v_brand.profile_photo_url),
    NULLIF(btrim(COALESCE(v_brand.profile_photo_url,'')),'') IS NOT NULL,
    public.brand_context_media_url_valid(v_brand.profile_photo_url),true));
  v_fields := v_fields || jsonb_build_array(public.brand_context_field_json(
    p_brand_id,'cover_media','Cover media','Media','recommended',to_jsonb(v_brand.cover_media_url),
    NULLIF(btrim(COALESCE(v_brand.cover_media_url,'')),'') IS NOT NULL,
    public.brand_context_media_url_valid(v_brand.cover_media_url),true));
  v_fields := v_fields || jsonb_build_array(public.brand_context_field_json(
    p_brand_id,'theme','Mingla page theme','Design','recommended',
    jsonb_build_object('color',v_brand.theme_color,'font',v_brand.theme_font,'animation',v_brand.theme_animation),
    v_brand.theme_color IS NOT NULL OR v_brand.theme_font IS NOT NULL OR v_brand.theme_animation IS NOT NULL,
    (v_brand.theme_color IS NULL OR v_brand.theme_color ~ '^#[0-9a-fA-F]{6}$')
      AND (v_brand.theme_font IS NULL OR v_brand.theme_font IN (
        'inter','poppins','space_grotesk','plus_jakarta_sans','manrope','playfair_display',
        'dm_serif_display','fraunces','lora','bebas_neue','anton','unbounded','caveat','dancing_script'))
      AND (v_brand.theme_animation IS NULL OR v_brand.theme_animation IN (
        'none','confetti','fireworks','balloons','sparkles','glitter_shower',
        'snowfall','falling_petals','hearts','shimmer_reveal',
    -- issue #1023: the 20 new theme motion slugs
    'streamers',
    'party_shapes',
    'bubbles',
    'champagne',
    'disco_glints',
    'bokeh',
    'golden_dust',
    'neon_pulse',
    'autumn_leaves',
    'fireflies',
    'rain',
    'sun_rays',
    'starry_sky',
    'aurora',
    'lanterns',
    'embers',
    'music_notes',
    'love_burst',
    'rose_petals',
    'love_balloons'))));

  v_validation_checks := jsonb_build_array(
    jsonb_build_object(
      'key','field_shapes','label','Field formats and allowed values',
      'state',CASE WHEN EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_fields) item
        WHERE item->>'requirement' <> 'optional' AND item->>'state'='invalid'
      ) THEN 'fail' ELSE 'pass' END),
    jsonb_build_object(
      'key','evidence_freshness','label','Evidence freshness and conflicts',
      'state',CASE WHEN EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_fields) item
        WHERE item->>'requirement' <> 'optional'
          AND item->>'state' IN ('stale','conflict')
      ) THEN 'fail' ELSE 'pass' END),
    jsonb_build_object(
      'key','required_dependencies','label','Required plan dependencies',
      'state',CASE WHEN EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_fields) item
        WHERE item->>'requirement'='required' AND item->>'state'<>'verified'
      ) THEN 'fail' ELSE 'pass' END),
    jsonb_build_object(
      'key','recommended_readiness','label','Recommended Website context',
      'state',CASE WHEN EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_fields) item
        WHERE item->>'requirement'='recommended'
          AND item->>'state' NOT IN ('verified','not_applicable')
      ) THEN 'fail' ELSE 'pass' END),
    jsonb_build_object(
      'key','human_handoffs','label','Owner media and file handoffs',
      'state',CASE WHEN EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_fields) item
        WHERE COALESCE((item->>'human_action_required')::boolean,false)
      ) THEN 'fail' ELSE 'pass' END),
    jsonb_build_object(
      'key','cross_field_alignment','label','Cross-field and plan alignment',
      'state',CASE WHEN
        (v_venue_selected AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(v_fields) item
          WHERE item->>'key'='venue_descriptor'
            AND item->>'state' IN ('verified','not_applicable')))
        OR (NULLIF(btrim(COALESCE(v_brand.address,'')),'') IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(v_fields) item
          WHERE item->>'key'='city_country'
            AND item->>'state' IN ('verified','not_applicable')))
        OR (v_plan.approved_at IS NOT NULL AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(v_fields) item
          WHERE item->>'key' IN (
            'offerings_selected','design_key','story.who','story.why','story.main_action')
            AND item->>'state'<>'verified'))
      THEN 'fail' ELSE 'pass' END)
  );
  SELECT count(*) INTO v_failed_validation
  FROM jsonb_array_elements(v_validation_checks) check_item
  WHERE check_item->>'state' <> 'pass';

  SELECT count(*) FILTER (
      WHERE item->>'requirement' = 'required' AND item->>'state' <> 'verified'
    ),
    count(*) FILTER (
      WHERE item->>'requirement' = 'recommended'
        AND item->>'state' NOT IN ('verified','not_applicable')
    ),
    count(*) FILTER (WHERE item->>'state' = 'verified'),
    count(*) FILTER (WHERE item->>'state' = 'not_applicable')
  INTO v_required_gaps, v_recommended_gaps, v_verified, v_exceptions
  FROM jsonb_array_elements(v_fields) item;

  RETURN jsonb_build_object(
    'revision', COALESCE(v_plan.revision, 0),
    'context_revision', public.brand_context_revision(p_brand_id),
    'design_key', COALESCE(v_plan.design_key, v_site.design_key),
    'fields', v_fields,
    'required_gap_count', v_required_gaps,
    'recommended_gap_count', v_recommended_gaps,
    'gap_count', v_required_gaps + v_recommended_gaps,
    'verified_count', v_verified,
    'exception_count', v_exceptions,
    'validation_checks', v_validation_checks,
    'failed_validation_count', v_failed_validation,
    'minimum_complete', v_required_gaps = 0,
    'context_complete', v_required_gaps = 0 AND v_recommended_gaps = 0
      AND v_failed_validation = 0,
    'checked_at', now()
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_context_completeness_internal(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_context_completeness_internal(uuid)
  TO service_role;

-- ---------------------------------------------------------------------------
-- ari_update_brand_context (from 20280303002830, list widened)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ari_update_brand_context(
  p_operation_id uuid,
  p_brand_id uuid,
  p_expected_plan_revision integer,
  p_expected_context_revision text,
  p_patch jsonb DEFAULT '{}'::jsonb,
  p_exceptions jsonb DEFAULT '[]'::jsonb,
  p_evidence jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_plan public.brand_site_plans%ROWTYPE;
  v_current_context_revision text;
  v_begin jsonb;
  v_result jsonb;
  v_receipt_args jsonb;
  v_confirmed_args jsonb;
  v_source_type text := COALESCE(NULLIF(p_evidence->>'source_type',''),'owner');
  v_source_ref text := NULLIF(btrim(COALESCE(p_evidence->>'source_ref','')),'');
  v_source_url text := NULLIF(btrim(COALESCE(p_evidence->>'source_url','')),'');
  v_observed_at timestamptz;
  v_key text;
  v_field_key text;
  v_exception jsonb;
  v_reason text;
BEGIN
  IF v_actor IS NULL OR NOT public.biz_is_brand_admin_plus_for_caller(p_brand_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_patch) <> 'object' OR jsonb_typeof(p_exceptions) <> 'array'
    OR jsonb_typeof(p_evidence) <> 'object'
    OR NOT public.brand_site_json_keys_allowed(p_patch,ARRAY[
      'name','description','contact_email','contact_phone','address','city',
      'country_code','social_links','custom_links','theme'])
    OR NOT public.brand_site_json_keys_allowed(p_evidence,ARRAY[
      'source_type','source_ref','source_url','observed_at'])
    OR (p_patch = '{}'::jsonb AND p_exceptions = '[]'::jsonb) THEN
    RAISE EXCEPTION 'invalid_args' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
      SELECT 1 FROM jsonb_each(p_patch) entry
      WHERE (entry.key='name' AND jsonb_typeof(entry.value)<>'string')
        OR (entry.key IN (
          'description','contact_email','contact_phone','address','city','country_code')
          AND jsonb_typeof(entry.value) NOT IN ('string','null'))
        OR (entry.key IN ('social_links','theme')
          AND jsonb_typeof(entry.value) NOT IN ('object','null'))
        OR (entry.key='custom_links'
          AND jsonb_typeof(entry.value) NOT IN ('array','null'))
    )
    OR NOT (p_evidence ? 'source_type')
    OR jsonb_typeof(p_evidence->'source_type') <> 'string'
    OR (p_evidence ? 'source_ref' AND jsonb_typeof(p_evidence->'source_ref') <> 'string')
    OR (p_evidence ? 'source_url' AND jsonb_typeof(p_evidence->'source_url') <> 'string')
    OR (p_evidence ? 'observed_at' AND jsonb_typeof(p_evidence->'observed_at') <> 'string') THEN
    RAISE EXCEPTION 'invalid_args' USING ERRCODE = '22023';
  END IF;
  IF v_source_type NOT IN ('mingla','owner','public_research','imported')
    OR length(COALESCE(v_source_ref,'')) > 300
    OR (v_source_url IS NOT NULL AND (length(v_source_url) > 1000 OR v_source_url !~ '^https://'))
    OR (v_source_type = 'public_research' AND v_source_url IS NULL) THEN
    RAISE EXCEPTION 'invalid_evidence' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_observed_at := COALESCE(NULLIF(p_evidence->>'observed_at','')::timestamptz,now());
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'invalid_evidence' USING ERRCODE = '22023';
  END;
  IF v_observed_at < timestamptz '2000-01-01 00:00:00+00'
    OR v_observed_at > now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'invalid_evidence' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_exceptions) > 9 THEN
    RAISE EXCEPTION 'invalid_exception' USING ERRCODE = '22023';
  END IF;
  FOR v_exception IN SELECT value FROM jsonb_array_elements(p_exceptions) LOOP
    IF jsonb_typeof(v_exception) <> 'object'
      OR NOT public.brand_site_json_keys_allowed(v_exception,ARRAY['field_key','reason'])
      OR jsonb_typeof(v_exception->'field_key') <> 'string'
      OR jsonb_typeof(v_exception->'reason') <> 'string' THEN
      RAISE EXCEPTION 'invalid_exception' USING ERRCODE = '22023';
    END IF;
    v_field_key := v_exception->>'field_key';
    v_reason := NULLIF(btrim(COALESCE(v_exception->>'reason','')),'');
    IF v_field_key NOT IN (
      'venue_descriptor','contact_email','contact_phone','address','city_country',
      'social_links','profile_photo','cover_media','theme')
      OR v_reason IS NULL OR length(v_reason) > 500
      OR (v_field_key='contact_email' AND p_patch ? 'contact_email')
      OR (v_field_key='contact_phone' AND p_patch ? 'contact_phone')
      OR (v_field_key='address' AND p_patch ? 'address')
      OR (v_field_key='city_country' AND (p_patch ? 'city' OR p_patch ? 'country_code'))
      OR (v_field_key='social_links' AND (p_patch ? 'social_links' OR p_patch ? 'custom_links'))
      OR (v_field_key='theme' AND p_patch ? 'theme') THEN
      RAISE EXCEPTION 'invalid_exception' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM jsonb_array_elements(p_exceptions)) <>
    (SELECT count(DISTINCT item->>'field_key') FROM jsonb_array_elements(p_exceptions) item) THEN
    RAISE EXCEPTION 'invalid_exception' USING ERRCODE = '22023';
  END IF;

  -- #2830: the operation receipt binds to the EXACT proposal the owner
  -- confirmed, which also carries the readable why and its citations. The
  -- original rebuilt a partial copy without them, so agent_operation_receipt_begin
  -- refused every Ari brand-context save as operation_binding_mismatch. Every
  -- value this function writes must still equal the confirmed proposal.
  SELECT tool_args INTO v_confirmed_args
    FROM public.agent_pending_actions
   WHERE id = p_operation_id
     AND user_id = auth.uid()
     AND tool_name = 'update_brand_context';
  IF v_confirmed_args IS NULL
    OR v_confirmed_args->>'brand_id' IS DISTINCT FROM p_brand_id::text
    OR v_confirmed_args->'expected_plan_revision'
      IS DISTINCT FROM to_jsonb(p_expected_plan_revision)
    OR v_confirmed_args->>'expected_context_revision'
      IS DISTINCT FROM p_expected_context_revision
    OR COALESCE(v_confirmed_args->'patch','{}'::jsonb) IS DISTINCT FROM p_patch
    OR COALESCE(v_confirmed_args->'exceptions','[]'::jsonb)
      IS DISTINCT FROM p_exceptions
    OR COALESCE(v_confirmed_args->'evidence','{}'::jsonb) IS DISTINCT FROM p_evidence THEN
    RAISE EXCEPTION 'operation_binding_mismatch';
  END IF;
  v_receipt_args := v_confirmed_args;
  v_begin := public.agent_operation_receipt_begin(
    p_operation_id,'update_brand_context',v_receipt_args);
  IF COALESCE((v_begin->>'replay')::boolean,false) THEN RETURN v_begin->'result'; END IF;

  SELECT * INTO v_plan FROM public.brand_site_plans
  WHERE brand_id = p_brand_id FOR UPDATE;
  IF v_plan.brand_id IS NULL OR p_expected_plan_revision IS NULL
    OR p_expected_plan_revision <> v_plan.revision THEN
    RAISE EXCEPTION 'sites_revision_conflict';
  END IF;
  IF v_plan.lock_holder IS NOT NULL AND v_plan.lock_expires_at > now()
    AND v_plan.lock_holder <> v_actor THEN RAISE EXCEPTION 'sites_plan_locked'; END IF;
  PERFORM 1 FROM public.brands
  WHERE id=p_brand_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'brand_not_found'; END IF;
  PERFORM 1 FROM public.brand_context_field_evidence
  WHERE brand_id=p_brand_id FOR UPDATE;
  v_current_context_revision := public.brand_context_revision(p_brand_id);
  IF p_expected_context_revision IS NULL
    OR p_expected_context_revision !~ '^[0-9a-f]{64}$'
    OR p_expected_context_revision <> v_current_context_revision THEN
    RAISE EXCEPTION 'sites_context_revision_conflict';
  END IF;

  IF p_patch ? 'name' AND length(btrim(COALESCE(p_patch->>'name',''))) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION 'invalid_brand_name' USING ERRCODE = '22023'; END IF;
  IF p_patch ? 'description' AND length(COALESCE(p_patch->>'description','')) > 500 THEN
    RAISE EXCEPTION 'invalid_description' USING ERRCODE = '22023'; END IF;
  IF p_patch ? 'contact_email' AND jsonb_typeof(p_patch->'contact_email') <> 'null'
    AND COALESCE(p_patch->>'contact_email','') !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'invalid_contact_email' USING ERRCODE = '22023'; END IF;
  IF p_patch ? 'contact_phone' AND jsonb_typeof(p_patch->'contact_phone') <> 'null'
    AND COALESCE(p_patch->>'contact_phone','') !~ '^\+[1-9][0-9]{7,14}$' THEN
    RAISE EXCEPTION 'invalid_contact_phone' USING ERRCODE = '22023'; END IF;
  IF p_patch ? 'address' AND length(COALESCE(p_patch->>'address','')) > 240 THEN
    RAISE EXCEPTION 'invalid_address' USING ERRCODE = '22023'; END IF;
  IF p_patch ? 'city' AND length(COALESCE(p_patch->>'city','')) > 120 THEN
    RAISE EXCEPTION 'invalid_city' USING ERRCODE = '22023'; END IF;
  IF p_patch ? 'country_code' AND jsonb_typeof(p_patch->'country_code') <> 'null'
    AND upper(COALESCE(p_patch->>'country_code','')) !~ '^[A-Z]{2}$' THEN
    RAISE EXCEPTION 'invalid_country_code' USING ERRCODE = '22023'; END IF;
  IF p_patch ? 'social_links' AND jsonb_typeof(p_patch->'social_links') <> 'null' AND (
    jsonb_typeof(p_patch->'social_links') <> 'object' OR EXISTS (
      SELECT 1 FROM jsonb_each(p_patch->'social_links') e
      WHERE e.key NOT IN ('website','instagram','tiktok','x','facebook','youtube','linkedin','threads')
        OR jsonb_typeof(e.value) <> 'string'
        OR length(e.value#>>'{}') > 500 OR (e.value#>>'{}') !~ '^https://'
    )) THEN RAISE EXCEPTION 'invalid_social_links' USING ERRCODE = '22023'; END IF;
  IF p_patch ? 'custom_links' AND jsonb_typeof(p_patch->'custom_links') <> 'null' AND (
    jsonb_typeof(p_patch->'custom_links') <> 'array'
    OR jsonb_array_length(p_patch->'custom_links') > 10 OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_patch->'custom_links') e
      WHERE jsonb_typeof(e) <> 'object'
        OR NOT public.brand_site_json_keys_allowed(e,ARRAY['label','url'])
        OR jsonb_typeof(e->'label') <> 'string'
        OR jsonb_typeof(e->'url') <> 'string'
        OR length(btrim(COALESCE(e->>'label',''))) NOT BETWEEN 1 AND 80
        OR COALESCE(e->>'url','') !~ '^https://' OR length(e->>'url') > 1000
    )) THEN RAISE EXCEPTION 'invalid_custom_links' USING ERRCODE = '22023'; END IF;
  IF p_patch ? 'theme' AND jsonb_typeof(p_patch->'theme') <> 'null' AND (
    jsonb_typeof(p_patch->'theme') <> 'object'
    OR NOT public.brand_site_json_keys_allowed(p_patch->'theme',ARRAY['color','font','animation'])
    OR ((p_patch->'theme' ? 'color') AND jsonb_typeof(p_patch->'theme'->'color') <> 'null'
      AND COALESCE(p_patch#>>'{theme,color}','') !~ '^#[0-9a-fA-F]{6}$')
    OR ((p_patch->'theme' ? 'font') AND jsonb_typeof(p_patch->'theme'->'font') <> 'null'
      AND COALESCE(p_patch#>>'{theme,font}','') NOT IN (
        'inter','poppins','space_grotesk','plus_jakarta_sans','manrope','playfair_display',
        'dm_serif_display','fraunces','lora','bebas_neue','anton','unbounded','caveat','dancing_script'))
    OR ((p_patch->'theme' ? 'animation') AND jsonb_typeof(p_patch->'theme'->'animation') <> 'null'
      AND COALESCE(p_patch#>>'{theme,animation}','') NOT IN (
        'none','confetti','fireworks','balloons','sparkles','glitter_shower',
        'snowfall','falling_petals','hearts','shimmer_reveal',
    -- issue #1023: the 20 new theme motion slugs
    'streamers',
    'party_shapes',
    'bubbles',
    'champagne',
    'disco_glints',
    'bokeh',
    'golden_dust',
    'neon_pulse',
    'autumn_leaves',
    'fireflies',
    'rain',
    'sun_rays',
    'starry_sky',
    'aurora',
    'lanterns',
    'embers',
    'music_notes',
    'love_burst',
    'rose_petals',
    'love_balloons'))
    ) THEN RAISE EXCEPTION 'invalid_theme' USING ERRCODE = '22023'; END IF;

  UPDATE public.brands b SET
    name = CASE WHEN p_patch ? 'name' THEN btrim(p_patch->>'name') ELSE b.name END,
    description = CASE WHEN p_patch ? 'description' THEN NULLIF(btrim(COALESCE(p_patch->>'description','')),'') ELSE b.description END,
    contact_email = CASE WHEN p_patch ? 'contact_email' THEN NULLIF(btrim(COALESCE(p_patch->>'contact_email','')),'') ELSE b.contact_email END,
    contact_phone = CASE WHEN p_patch ? 'contact_phone' THEN NULLIF(btrim(COALESCE(p_patch->>'contact_phone','')),'') ELSE b.contact_phone END,
    address = CASE WHEN p_patch ? 'address' THEN NULLIF(btrim(COALESCE(p_patch->>'address','')),'') ELSE b.address END,
    city = CASE WHEN p_patch ? 'city' THEN NULLIF(btrim(COALESCE(p_patch->>'city','')),'') ELSE b.city END,
    country_code = CASE WHEN p_patch ? 'country_code' THEN NULLIF(upper(btrim(COALESCE(p_patch->>'country_code',''))),'') ELSE b.country_code END,
    social_links = CASE WHEN p_patch ? 'social_links' THEN COALESCE(p_patch->'social_links','{}'::jsonb) ELSE b.social_links END,
    custom_links = CASE WHEN p_patch ? 'custom_links' THEN COALESCE(p_patch->'custom_links','[]'::jsonb) ELSE b.custom_links END,
    theme_color = CASE WHEN p_patch ? 'theme' THEN NULLIF(p_patch#>>'{theme,color}','') ELSE b.theme_color END,
    theme_font = CASE WHEN p_patch ? 'theme' THEN NULLIF(p_patch#>>'{theme,font}','') ELSE b.theme_font END,
    theme_animation = CASE WHEN p_patch ? 'theme' THEN NULLIF(p_patch#>>'{theme,animation}','') ELSE b.theme_animation END,
    updated_at = now()
  WHERE b.id = p_brand_id AND b.deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'brand_not_found'; END IF;

  FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
    v_field_key := CASE v_key
      WHEN 'city' THEN 'city_country' WHEN 'country_code' THEN 'city_country'
      WHEN 'theme' THEN 'theme' WHEN 'social_links' THEN 'social_links'
      WHEN 'custom_links' THEN 'social_links' ELSE v_key END;
    INSERT INTO public.brand_context_field_evidence(
      brand_id,field_key,disposition,source_type,source_ref,source_url,
      observed_at,owner_confirmed_at,updated_at,updated_by
    ) VALUES (
      p_brand_id,v_field_key,'verified',v_source_type,v_source_ref,v_source_url,
      v_observed_at,now(),now(),v_actor
    ) ON CONFLICT (brand_id,field_key) DO UPDATE SET
      disposition='verified',source_type=EXCLUDED.source_type,
      source_ref=EXCLUDED.source_ref,source_url=EXCLUDED.source_url,
      observed_at=EXCLUDED.observed_at,owner_confirmed_at=EXCLUDED.owner_confirmed_at,
      exception_reason=NULL,evidence_candidates='[]'::jsonb,
      recheck_fingerprint=NULL,updated_at=now(),updated_by=v_actor;
  END LOOP;

  FOR v_exception IN SELECT value FROM jsonb_array_elements(p_exceptions) LOOP
    v_field_key := v_exception->>'field_key';
    v_reason := NULLIF(btrim(COALESCE(v_exception->>'reason','')),'');
    INSERT INTO public.brand_context_field_evidence(
      brand_id,field_key,disposition,source_type,source_ref,source_url,
      observed_at,owner_confirmed_at,exception_reason,recheck_fingerprint,
      updated_at,updated_by
    ) VALUES (
      p_brand_id,v_field_key,'not_applicable','owner',NULL,NULL,
      now(),now(),v_reason,
      public.brand_context_recheck_fingerprint(p_brand_id,v_field_key),
      now(),v_actor
    ) ON CONFLICT (brand_id,field_key) DO UPDATE SET
      disposition='not_applicable',source_type='owner',source_ref=NULL,source_url=NULL,
      observed_at=now(),owner_confirmed_at=now(),exception_reason=EXCLUDED.exception_reason,
      evidence_candidates='[]'::jsonb,
      recheck_fingerprint=EXCLUDED.recheck_fingerprint,
      updated_at=now(),updated_by=v_actor;
  END LOOP;

  UPDATE public.brand_site_plans SET
    revision = revision + 1,lock_holder=v_actor,
    lock_expires_at=now()+interval '10 minutes',updated_at=now(),updated_by=v_actor
  WHERE brand_id=p_brand_id;
  v_result := jsonb_build_object(
    'brand_id',p_brand_id,'plan_revision',v_plan.revision+1,
    'completeness',public.brand_context_completeness_internal(p_brand_id));
  RETURN public.agent_operation_receipt_complete(
    p_operation_id,'update_brand_context',v_receipt_args,v_result);
END;
$function$;
REVOKE ALL ON FUNCTION public.ari_update_brand_context(uuid,uuid,integer,text,jsonb,jsonb,jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ari_update_brand_context(uuid,uuid,integer,text,jsonb,jsonb,jsonb)
  TO authenticated, service_role;

COMMIT;
