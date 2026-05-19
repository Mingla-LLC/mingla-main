-- Ve2 Pool Match Comparison (GitHub issue #100)
-- Allow duplicate pending_review claims per google_place_id; persist place_pool_id on create.

BEGIN;

-- Multiple pending_review claims for the same place queue for admin (Ve3 arbitrates).
DROP INDEX IF EXISTS idx_brands_google_place_id_claim_active_unique;

CREATE UNIQUE INDEX idx_brands_google_place_id_verified_unique
  ON public.brands (google_place_id)
  WHERE
    deleted_at IS NULL
    AND google_place_id IS NOT NULL
    AND claim_status = 'verified';

COMMENT ON INDEX idx_brands_google_place_id_verified_unique IS
  'Ve2 — only one verified brand per Google place; duplicate pending_review claims allowed.';

-- Extend venue create RPC with optional place_pool_id linkage.
DROP FUNCTION IF EXISTS public.biz_create_venue_brand_pending_review (
  text,
  text,
  text,
  text,
  double precision,
  double precision,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  jsonb
);

CREATE OR REPLACE FUNCTION public.biz_create_venue_brand_pending_review (
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
  p_place_pool_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid;
  v_brand_id uuid;
  v_idx int;
  v_hour jsonb;
  v_cover_url text;
  v_cover_type text;
  v_pool_google text;
BEGIN
  v_uid := auth.uid ();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
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

  IF p_google_place_id IS NULL OR length(trim(p_google_place_id)) = 0 THEN
    RAISE EXCEPTION 'google_place_id_required';
  END IF;

  IF p_hours IS NULL OR jsonb_typeof(p_hours) != 'array' OR jsonb_array_length(p_hours) != 7 THEN
    RAISE EXCEPTION 'hours_must_have_7_rows';
  END IF;

  IF p_venue_category IS NULL OR p_venue_category NOT IN ('restaurant', 'play', 'creative_and_arts') THEN
    RAISE EXCEPTION 'invalid_venue_category';
  END IF;

  IF p_place_pool_id IS NOT NULL THEN
    SELECT p.google_place_id
    INTO v_pool_google
    FROM public.place_pool p
    WHERE p.id = p_place_pool_id
      AND p.is_active = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'place_pool_not_found';
    END IF;

    IF trim(v_pool_google) IS DISTINCT FROM trim(p_google_place_id) THEN
      RAISE EXCEPTION 'place_pool_google_place_id_mismatch';
    END IF;
  END IF;

  v_cover_url := nullif(trim(coalesce(p_cover_media_url, '')), '');
  v_cover_type := nullif(trim(coalesce(p_cover_media_type, '')), '');

  IF v_cover_type IS NOT NULL AND v_cover_type NOT IN ('image', 'video', 'gif') THEN
    RAISE EXCEPTION 'invalid_cover_media_type';
  END IF;

  IF v_cover_url IS NOT NULL AND v_cover_type IS NULL THEN
    RAISE EXCEPTION 'cover_media_type_required';
  END IF;

  IF v_cover_url IS NULL THEN
    v_cover_type := NULL;
  END IF;

  INSERT INTO public.brands (
    account_id,
    name,
    slug,
    description,
    kind,
    address,
    google_place_id,
    place_pool_id,
    lat,
    lng,
    city,
    country_code,
    claim_status,
    venue_category,
    contact_email,
    contact_phone,
    cover_media_url,
    cover_media_type,
    cover_hue,
    tax_settings,
    social_links,
    custom_links,
    display_attendee_count,
    stripe_connect_id,
    stripe_payouts_enabled,
    stripe_charges_enabled
  )
  VALUES (
    v_uid,
    trim(p_name),
    trim(p_slug),
    p_description,
    'physical',
    nullif(trim(p_address), ''),
    trim(p_google_place_id),
    p_place_pool_id,
    p_lat,
    p_lng,
    nullif(trim(p_city), ''),
    nullif(trim(p_country_code), ''),
    'pending_review',
    p_venue_category,
    nullif(trim(p_contact_email), ''),
    nullif(trim(p_contact_phone), ''),
    v_cover_url,
    v_cover_type,
    25,
    '{}'::jsonb,
    '{}'::jsonb,
    '[]'::jsonb,
    true,
    NULL,
    false,
    false
  )
  RETURNING id INTO v_brand_id;

  FOR v_idx IN 0 .. 6 LOOP
    v_hour := p_hours -> v_idx;
    IF v_hour IS NULL THEN
      RAISE EXCEPTION 'missing_hour_index_%', v_idx;
    END IF;

    INSERT INTO public.brand_hours (
      brand_id,
      weekday,
      open_time,
      close_time,
      is_closed
    )
    VALUES (
      v_brand_id,
      (v_hour ->> 'weekday')::smallint,
      CASE
        WHEN coalesce((v_hour ->> 'is_closed')::boolean, false) THEN NULL
        WHEN v_hour ->> 'open_time' IS NULL OR (v_hour ->> 'open_time') = '' THEN NULL
        ELSE (v_hour ->> 'open_time')::time
      END,
      CASE
        WHEN coalesce((v_hour ->> 'is_closed')::boolean, false) THEN NULL
        WHEN v_hour ->> 'close_time' IS NULL OR (v_hour ->> 'close_time') = '' THEN NULL
        ELSE (v_hour ->> 'close_time')::time
      END,
      coalesce((v_hour ->> 'is_closed')::boolean, false)
    );
  END LOOP;

  RETURN v_brand_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.biz_create_venue_brand_pending_review (
  text,
  text,
  text,
  text,
  double precision,
  double precision,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  jsonb,
  uuid
) TO authenticated;

COMMENT ON FUNCTION public.biz_create_venue_brand_pending_review IS
  'Ve1+Ve2 — physical brand pending_review + optional place_pool_id when pool match accepted.';

-- Structural verify: verified-only uniqueness (pending_review duplicates allowed).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'idx_brands_google_place_id_verified_unique'
  ) THEN
    RAISE EXCEPTION 'Ve2 verify FAIL: idx_brands_google_place_id_verified_unique missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'biz_create_venue_brand_pending_review'
      AND pg_get_function_identity_arguments(p.oid) NOT LIKE '%uuid%'
  ) THEN
    RAISE EXCEPTION 'Ve2 verify FAIL: create RPC missing p_place_pool_id uuid arg';
  END IF;
END;
$$;

COMMIT;
