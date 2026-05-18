-- Ve1 Physical Venue Brand Onboarding (GitHub issue #99)
-- Schema: venue claim columns on brands, brand_hours sidecar, public brand
-- visibility for physical brands, admin read policies, atomic create RPC.

BEGIN;

-- ---------------------------------------------------------------------------
-- brands: venue / claim columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.brands
  ADD COLUMN IF NOT EXISTS place_pool_id uuid REFERENCES public.place_pool (id),
  ADD COLUMN IF NOT EXISTS google_place_id text,
  ADD COLUMN IF NOT EXISTS lat double precision,
  ADD COLUMN IF NOT EXISTS lng double precision,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS country_code text,
  ADD COLUMN IF NOT EXISTS claim_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS verified_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS venue_category text;

ALTER TABLE public.brands
  DROP CONSTRAINT IF EXISTS brands_claim_status_check;
ALTER TABLE public.brands
  ADD CONSTRAINT brands_claim_status_check
  CHECK (claim_status IN ('none', 'pending_review', 'verified', 'rejected'));

ALTER TABLE public.brands
  DROP CONSTRAINT IF EXISTS brands_venue_category_check;
ALTER TABLE public.brands
  ADD CONSTRAINT brands_venue_category_check
  CHECK (
    venue_category IS NULL
    OR venue_category IN ('restaurant', 'play', 'creative_and_arts')
  );

COMMENT ON COLUMN public.brands.place_pool_id IS
  'Ve1+ — optional FK to place_pool when matched; Ve2 owns pool-match linkage.';
COMMENT ON COLUMN public.brands.google_place_id IS
  'Ve1 — Google Place ID for dedup; partial unique index when non-null and active.';
COMMENT ON COLUMN public.brands.claim_status IS
  'Ve1 — none (popup/trip default), pending_review (venue submitted), verified (public), rejected.';
COMMENT ON COLUMN public.brands.venue_category IS
  'Ve1 — Restaurant / Play / Creative &Arts from operator onboarding pills.';

-- Grandfather existing physical brands so public pages stay visible (all were organizer-created pre-Ve1).
UPDATE public.brands
SET
  claim_status = 'verified',
  verified_at = COALESCE(verified_at, now())
WHERE kind = 'physical'
  AND deleted_at IS NULL
  AND claim_status = 'none';

CREATE UNIQUE INDEX IF NOT EXISTS idx_brands_google_place_id_active_unique
  ON public.brands (google_place_id)
  WHERE deleted_at IS NULL AND google_place_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- brand_hours
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.brand_hours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands (id) ON DELETE CASCADE,
  weekday smallint NOT NULL CHECK (weekday >= 0 AND weekday <= 6),
  open_time time,
  close_time time,
  is_closed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT brand_hours_brand_weekday_uniq UNIQUE (brand_id, weekday)
);

CREATE INDEX IF NOT EXISTS idx_brand_hours_brand_id ON public.brand_hours (brand_id);

ALTER TABLE public.brand_hours ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.brand_hours IS
  'Ve1 — weekly hours for physical venue brands (7 rows per brand, weekday 0=Mon … per app convention 0-6).';

-- RLS: same privilege model as brand-scoped child tables (team read; admin-plus write).
CREATE POLICY "Brand members can select brand_hours"
  ON public.brand_hours
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.brands b
      WHERE b.id = brand_hours.brand_id
        AND b.deleted_at IS NULL
        AND public.biz_is_brand_member_for_read_for_caller (b.id)
    )
  );

-- I-PROPOSED-H (ORCH-0734): direct-predicate owner SELECT so INSERT/UPDATE/DELETE
-- ... RETURNING admits post-mutation rows without biz_*_for_caller snapshot quirks.
CREATE POLICY "Brand owners can select own brand_hours"
  ON public.brand_hours
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.brands b
      WHERE b.id = brand_hours.brand_id
        AND b.account_id = auth.uid()
        AND b.deleted_at IS NULL
    )
  );

CREATE POLICY "Brand admin plus can insert brand_hours"
  ON public.brand_hours
  FOR INSERT
  TO authenticated
  WITH CHECK (public.biz_is_brand_admin_plus_for_caller (brand_id));

CREATE POLICY "Brand admin plus can update brand_hours"
  ON public.brand_hours
  FOR UPDATE
  TO authenticated
  USING (public.biz_is_brand_admin_plus_for_caller (brand_id))
  WITH CHECK (public.biz_is_brand_admin_plus_for_caller (brand_id));

CREATE POLICY "Brand admin plus can delete brand_hours"
  ON public.brand_hours
  FOR DELETE
  TO authenticated
  USING (public.biz_is_brand_admin_plus_for_caller (brand_id));

-- Internal admin dashboard (is_admin_user) — claims queue + review.
CREATE POLICY "Admins can read brands for operations"
  ON public.brands
  FOR SELECT
  TO authenticated
  USING (public.is_admin_user ());

CREATE POLICY "Admins can read brand_hours for operations"
  ON public.brand_hours
  FOR SELECT
  TO authenticated
  USING (public.is_admin_user ());

CREATE POLICY "Admins can update brands for claim review"
  ON public.brands
  FOR UPDATE
  TO authenticated
  USING (public.is_admin_user ())
  WITH CHECK (public.is_admin_user ());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.brand_hours TO authenticated;
GRANT ALL ON public.brand_hours TO service_role;

-- ---------------------------------------------------------------------------
-- Public brand profile: hide unverified physical venues
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.business_public_brands_view AS
SELECT
  b.id,
  b.slug,
  b.name,
  b.description,
  b.profile_photo_url,
  b.social_links,
  b.custom_links,
  b.display_attendee_count,
  b.kind,
  b.address,
  b.cover_hue,
  b.cover_media_url,
  b.cover_media_type,
  b.profile_photo_type,
  b.created_at,
  b.updated_at
FROM public.brands b
WHERE b.deleted_at IS NULL
  AND (
    b.kind IN ('popup', 'trip_planner')
    OR (b.kind = 'physical' AND b.claim_status = 'verified')
  );

GRANT SELECT ON public.business_public_brands_view TO anon, authenticated, service_role;

COMMENT ON VIEW public.business_public_brands_view IS
  'ORCH-0767 + Ve1: public brand read model; physical brands only when claim_status=verified.';

-- ---------------------------------------------------------------------------
-- Atomic create: brand + 7 hour rows (SECURITY DEFINER; caller must own account).
-- ---------------------------------------------------------------------------
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
BEGIN
  v_uid := auth.uid ();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
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
    nullif(trim(p_cover_media_url), ''),
    CASE
      WHEN p_cover_media_type IS NULL THEN NULL
      WHEN p_cover_media_type IN ('image', 'video', 'gif') THEN p_cover_media_type
      ELSE NULL
    END,
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
  jsonb
) TO authenticated;

COMMENT ON FUNCTION public.biz_create_venue_brand_pending_review IS
  'Ve1 — inserts physical brand (claim_status=pending_review) + 7 brand_hours rows in one transaction.';

COMMIT;
