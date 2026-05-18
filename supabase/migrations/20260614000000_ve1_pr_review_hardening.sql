-- Ve1 PR review hardening (Copilot #135): RPC validation, atomic hours upsert,
-- admin review RPC, google_place_id index scope, place_pool FK ON DELETE SET NULL.

BEGIN;

-- place_pool_id: allow pool row deletion without blocking brands (Ve2 linkage).
ALTER TABLE public.brands
  DROP CONSTRAINT IF EXISTS brands_place_pool_id_fkey;

ALTER TABLE public.brands
  ADD CONSTRAINT brands_place_pool_id_fkey
  FOREIGN KEY (place_pool_id) REFERENCES public.place_pool (id) ON DELETE SET NULL;

-- Rejected claims must not block re-submission for the same Google place.
DROP INDEX IF EXISTS idx_brands_google_place_id_active_unique;

CREATE UNIQUE INDEX idx_brands_google_place_id_claim_active_unique
  ON public.brands (google_place_id)
  WHERE
    deleted_at IS NULL
    AND google_place_id IS NOT NULL
    AND claim_status IN ('pending_review', 'verified');

-- ---------------------------------------------------------------------------
-- Atomic replace brand_hours (avoids client delete+insert partial failure).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.biz_upsert_brand_hours (
  p_brand_id uuid,
  p_hours jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_idx int;
  v_hour jsonb;
BEGIN
  IF auth.uid () IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF NOT public.biz_is_brand_admin_plus_for_caller (p_brand_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_hours IS NULL OR jsonb_typeof(p_hours) != 'array' OR jsonb_array_length(p_hours) != 7 THEN
    RAISE EXCEPTION 'hours_must_have_7_rows';
  END IF;

  DELETE FROM public.brand_hours
  WHERE brand_id = p_brand_id;

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
      p_brand_id,
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
END;
$$;

GRANT EXECUTE ON FUNCTION public.biz_upsert_brand_hours (uuid, jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- Admin claim review: verified_by := auth.uid() server-side.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.biz_review_venue_claim (
  p_brand_id uuid,
  p_action text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid () IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF NOT public.is_admin_user () THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_action NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'invalid_action';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.brands b
    WHERE b.id = p_brand_id
      AND b.deleted_at IS NULL
      AND b.kind = 'physical'
      AND b.claim_status = 'pending_review'
  ) THEN
    RAISE EXCEPTION 'brand_not_pending_review';
  END IF;

  IF p_action = 'approve' THEN
    UPDATE public.brands
    SET
      claim_status = 'verified',
      verified_at = now(),
      verified_by = auth.uid()
    WHERE id = p_brand_id;
  ELSE
    UPDATE public.brands
    SET
      claim_status = 'rejected',
      verified_at = NULL,
      verified_by = NULL
    WHERE id = p_brand_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.biz_review_venue_claim (uuid, text) TO authenticated;

-- ILIKE-safe place_pool name gate (Ve1 fork).
CREATE OR REPLACE FUNCTION public.escape_like_pattern (p text) RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT replace(replace(replace(p, '\', '\\'), '%', '\%'), '_', '\_');
$$;

CREATE OR REPLACE FUNCTION public.biz_place_pool_name_contains (p_query text) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.place_pool p
    WHERE p.is_active
      AND length(trim(coalesce(p_query, ''))) >= 2
      AND p.name ILIKE (
        '%' || public.escape_like_pattern(trim(p_query)) || '%'
      ) ESCAPE '\'
  );
$$;

GRANT EXECUTE ON FUNCTION public.biz_place_pool_name_contains (text) TO authenticated;

-- Harden create RPC: name/slug validation + cover media type/url consistency.
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
  p_hours jsonb
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

COMMIT;
