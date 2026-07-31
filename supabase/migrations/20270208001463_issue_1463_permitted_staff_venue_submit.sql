-- Issue #1463 — staff who hold the canonical venue-management role can create
-- a pending-review venue listing for their own brand. Publishing/approval stays
-- on its separate capability boundary; no public or commerce flags change here.
BEGIN;

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
  p_coordinate_precision text DEFAULT ''
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
  v_google text;
  v_pool_google text;
  v_coordinate_precision text;
  v_stay_authoring_enabled boolean := false;
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
    cover_media_type,
    coordinate_precision,
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
    v_cover_type,
    v_coordinate_precision,
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
  text, text, text, text, text, text, jsonb, uuid, text
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.biz_create_venue_listing(
  uuid, text, text, text, text, double precision, double precision, text, text,
  text, text, text, text, text, text, jsonb, uuid, text
) FROM anon;
GRANT EXECUTE ON FUNCTION public.biz_create_venue_listing(
  uuid, text, text, text, text, double precision, double precision, text, text,
  text, text, text, text, text, text, jsonb, uuid, text
) TO authenticated;

COMMENT ON FUNCTION public.biz_create_venue_listing(
  uuid, text, text, text, text, double precision, double precision, text, text,
  text, text, text, text, text, text, jsonb, uuid, text
) IS 'Issue #1463: event_manager+ may create pending-review venue listings for their own brand; publication and approval remain separately gated.';

COMMIT;
