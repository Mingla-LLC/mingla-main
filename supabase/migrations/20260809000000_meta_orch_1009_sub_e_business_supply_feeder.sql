-- META-ORCH-1009 Sub-E — business-app supply-side feeder.
--
-- Allows Sarah's create-new venue path to create a canonical place_pool row
-- without fabricating Google identity fields, and adds per-brand pipeline state
-- for deck-readiness coaching in Mingla Business.

BEGIN;

ALTER TABLE public.place_pool
  ALTER COLUMN google_place_id DROP NOT NULL;

ALTER TABLE public.place_pool
  DROP CONSTRAINT IF EXISTS place_pool_google_place_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_place_pool_google_place_id_nonnull_unique
  ON public.place_pool (google_place_id)
  WHERE google_place_id IS NOT NULL;

ALTER TABLE public.place_pool
  DROP CONSTRAINT IF EXISTS place_pool_fetched_via_check;

ALTER TABLE public.place_pool
  ADD CONSTRAINT place_pool_fetched_via_check
  CHECK (
    fetched_via = ANY (
      ARRAY[
        'nearby_search'::text,
        'text_search'::text,
        'detail_refresh'::text,
        'business_authored'::text
      ]
    )
  );

ALTER TABLE public.place_pool
  ADD COLUMN IF NOT EXISTS business_author_brand_id uuid NULL
    REFERENCES public.brands(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS business_authoring_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS business_hero_video_present boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS photo_analysis jsonb NULL,
  ADD COLUMN IF NOT EXISTS business_authoring_inputs jsonb NULL;

ALTER TABLE public.place_pool
  DROP CONSTRAINT IF EXISTS place_pool_business_authoring_status_check;

ALTER TABLE public.place_pool
  ADD CONSTRAINT place_pool_business_authoring_status_check
  CHECK (
    business_authoring_status IN (
      'none',
      'draft',
      'processing',
      'needs_fix',
      'deck_eligible',
      'failed'
    )
  );

CREATE INDEX IF NOT EXISTS idx_place_pool_business_author_brand_id
  ON public.place_pool (business_author_brand_id)
  WHERE business_author_brand_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_place_pool_business_authoring_status
  ON public.place_pool (business_authoring_status)
  WHERE business_authoring_status <> 'none';

COMMENT ON COLUMN public.place_pool.business_author_brand_id IS
  'META-ORCH-1009 Sub-E: owning business brand for create-new business-authored place_pool rows. Does not replace claimed_by, which remains auth.users.';
COMMENT ON COLUMN public.place_pool.business_authoring_status IS
  'META-ORCH-1009 Sub-E: business authoring pipeline state for deck-readiness coaching.';
COMMENT ON COLUMN public.place_pool.business_hero_video_present IS
  'META-ORCH-1009 Sub-E: true when the linked business brand has a CoverPicker-authored hero video; signalScorer applies the capped x1.15 effective AI boost.';
COMMENT ON COLUMN public.place_pool.photo_analysis IS
  'META-ORCH-1009 Sub-E: Gemini 2.5 Flash vision output for business-supplied venue photos.';
COMMENT ON COLUMN public.place_pool.business_authoring_inputs IS
  'META-ORCH-1009 Sub-E: Tier 1/Tier 2 business-app input snapshot used to generate deck-facing AI evaluations.';

CREATE TABLE IF NOT EXISTS public.brand_place_pipeline_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  place_pool_id uuid NULL REFERENCES public.place_pool(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft',
  stage_status jsonb NOT NULL DEFAULT '{}'::jsonb,
  readiness jsonb NOT NULL DEFAULT '{}'::jsonb,
  bouncer_reason text NULL,
  coaching jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_started_at timestamptz NULL,
  last_completed_at timestamptz NULL,
  last_error text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT brand_place_pipeline_state_brand_unique UNIQUE (brand_id),
  CONSTRAINT brand_place_pipeline_state_status_check CHECK (
    status IN (
      'draft',
      'processing',
      'needs_fix',
      'deck_eligible',
      'failed'
    )
  )
);

COMMENT ON TABLE public.brand_place_pipeline_state IS
  'META-ORCH-1009 Sub-E: one row per business venue brand tracking Tier 1/Tier 2 pipeline progress and Hub deck-readiness coaching.';
COMMENT ON COLUMN public.brand_place_pipeline_state.stage_status IS
  'Per-stage status keyed by the 8 business-app Gemini stages.';
COMMENT ON COLUMN public.brand_place_pipeline_state.readiness IS
  'Deck-readiness verdict details, including bouncer code and fix target.';
COMMENT ON COLUMN public.brand_place_pipeline_state.coaching IS
  'Plain-English Hub coaching cards derived from bouncer/readiness reason codes.';

CREATE INDEX IF NOT EXISTS idx_brand_place_pipeline_state_place_pool
  ON public.brand_place_pipeline_state (place_pool_id)
  WHERE place_pool_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_brand_place_pipeline_state_updated_at
  ON public.brand_place_pipeline_state;

CREATE TRIGGER trg_brand_place_pipeline_state_updated_at
  BEFORE UPDATE ON public.brand_place_pipeline_state
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.brand_place_pipeline_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS brand_place_pipeline_state_owner_select
  ON public.brand_place_pipeline_state;
CREATE POLICY brand_place_pipeline_state_owner_select
  ON public.brand_place_pipeline_state
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.brands b
      WHERE b.id = brand_id
        AND b.account_id = auth.uid()
        AND b.deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS brand_place_pipeline_state_owner_insert
  ON public.brand_place_pipeline_state;
CREATE POLICY brand_place_pipeline_state_owner_insert
  ON public.brand_place_pipeline_state
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.brands b
      WHERE b.id = brand_id
        AND b.account_id = auth.uid()
        AND b.deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS brand_place_pipeline_state_owner_update
  ON public.brand_place_pipeline_state;
CREATE POLICY brand_place_pipeline_state_owner_update
  ON public.brand_place_pipeline_state
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.brands b
      WHERE b.id = brand_id
        AND b.account_id = auth.uid()
        AND b.deleted_at IS NULL
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.brands b
      WHERE b.id = brand_id
        AND b.account_id = auth.uid()
        AND b.deleted_at IS NULL
    )
  );

CREATE OR REPLACE FUNCTION public.biz_create_venue_brand_authoring (
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
  v_google text;
  v_pool_google text;
BEGIN
  v_uid := auth.uid();
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

  IF p_lat IS NULL OR p_lng IS NULL THEN
    RAISE EXCEPTION 'location_required';
  END IF;

  IF p_hours IS NULL OR jsonb_typeof(p_hours) != 'array' OR jsonb_array_length(p_hours) != 7 THEN
    RAISE EXCEPTION 'hours_must_have_7_rows';
  END IF;

  IF p_venue_category IS NULL OR p_venue_category NOT IN ('restaurant', 'play', 'creative_and_arts') THEN
    RAISE EXCEPTION 'invalid_venue_category';
  END IF;

  v_google := nullif(trim(coalesce(p_google_place_id, '')), '');

  IF p_place_pool_id IS NOT NULL THEN
    SELECT p.google_place_id
    INTO v_pool_google
    FROM public.place_pool p
    WHERE p.id = p_place_pool_id
      AND p.is_active = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'place_pool_not_found';
    END IF;

    IF v_google IS NULL OR trim(v_pool_google) IS DISTINCT FROM v_google THEN
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
    nullif(trim(coalesce(p_address, '')), ''),
    v_google,
    p_place_pool_id,
    p_lat,
    p_lng,
    nullif(trim(coalesce(p_city, '')), ''),
    nullif(trim(coalesce(p_country_code, '')), ''),
    'pending_review',
    p_venue_category,
    nullif(trim(coalesce(p_contact_email, '')), ''),
    nullif(trim(coalesce(p_contact_phone, '')), ''),
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

  INSERT INTO public.brand_place_pipeline_state (
    brand_id,
    place_pool_id,
    status,
    stage_status,
    readiness,
    coaching
  )
  VALUES (
    v_brand_id,
    p_place_pool_id,
    'draft',
    jsonb_build_object('tier1', 'created'),
    '{}'::jsonb,
    '[]'::jsonb
  )
  ON CONFLICT (brand_id) DO UPDATE
  SET place_pool_id = excluded.place_pool_id,
      status = excluded.status,
      stage_status = brand_place_pipeline_state.stage_status || excluded.stage_status,
      updated_at = now();

  RETURN v_brand_id;
END;
$$;

REVOKE ALL ON FUNCTION public.biz_create_venue_brand_authoring (
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
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.biz_create_venue_brand_authoring (
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

COMMENT ON FUNCTION public.biz_create_venue_brand_authoring IS
  'META-ORCH-1009 Sub-E: creates venue brands for claim-existing or create-new authoring; Google place id is optional for create-new.';

CREATE OR REPLACE FUNCTION public.biz_search_place_pool_for_claim (
  p_query text,
  p_limit int DEFAULT NULL
) RETURNS TABLE (
  id uuid,
  name text,
  address text,
  city text,
  country text,
  lat double precision,
  lng double precision,
  google_place_id text,
  primary_type text,
  types text[],
  opening_hours jsonb,
  stored_photo_urls text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    p.id,
    p.name,
    p.address,
    p.city,
    p.country,
    p.lat,
    p.lng,
    p.google_place_id,
    p.primary_type,
    p.types,
    p.opening_hours,
    p.stored_photo_urls
  FROM public.place_pool p
  WHERE p.is_active = true
    AND length(trim(coalesce(p_query, ''))) >= 3
    AND p.name ILIKE (
      '%' || public.escape_like_pattern(trim(p_query)) || '%'
    ) ESCAPE '\'
  ORDER BY
    CASE
      WHEN p.name ILIKE (
        public.escape_like_pattern(trim(p_query)) || '%'
      ) ESCAPE '\' THEN 0
      ELSE 1
    END,
    coalesce(p.review_count, 0) DESC,
    p.name ASC;
$$;

REVOKE ALL ON FUNCTION public.biz_search_place_pool_for_claim(text, int)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.biz_search_place_pool_for_claim(text, int)
TO service_role;

COMMENT ON FUNCTION public.biz_search_place_pool_for_claim IS
  'META-ORCH-1009 Sub-E: public-safe active place_pool claim search; p_limit is legacy and ignored so business onboarding can show all active matches for a query.';

CREATE OR REPLACE FUNCTION public.expire_agent_pending_actions (
  p_now timestamptz DEFAULT now()
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.agent_pending_actions
  SET status = 'expired'
  WHERE status = 'pending'
    AND expires_at <= p_now;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_agent_pending_actions(timestamptz)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expire_agent_pending_actions(timestamptz)
TO service_role;

COMMENT ON FUNCTION public.expire_agent_pending_actions(timestamptz) IS
  'META-ORCH-1009 Sub-E: expires stale Hub proposal rows so business UI does not render dead accept actions.';

SELECT public.expire_agent_pending_actions(now());

COMMIT;
