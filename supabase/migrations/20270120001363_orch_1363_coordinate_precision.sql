-- ============================================================================
-- Issue #1363 — Three-tier address field (pick → free-text → pin-drop)
-- SPEC §7.3 — coordinate-precision persistence (no fabricated precision, rule 9).
--
-- ADDITIVE + NULLABLE. Existing rows default NULL ("unknown") and render exactly
-- as today (no backfill). Two persisted values only:
--   'exact'       — Tier-1 Mapbox pick OR Tier-3 pin (a point the brand set).
--   'approximate' — Tier-2 free-text forward-geocode (often city-level).
--
-- Tables touched (SPEC §7.3):
--   * venue_listings      — written by biz_create_venue_listing (new param).
--   * events              — column added; the event-publish RPC write is a
--                           documented follow-up (SPEC gap G2 — NOT in this
--                           allowlist). Column is additive/harmless meanwhile.
--   * experience_stops    — column added; the experience-publish RPC write +
--                           its place_id guard loosening is a documented
--                           follow-up (SPEC gap G1). Column is additive meanwhile.
--   * Trip precision rides events.theme.business_trip.{departure,destination}
--     CoordinatePrecision (JSON; no column) — nothing to add here.
--
-- The venue RPC's location_required guard is PRESERVED unchanged (satisfied with
-- a real coordinate from pick / forward-geocode / pin, never removed).
-- ============================================================================

-- ── 1. Additive nullable columns ───────────────────────────────────────────
ALTER TABLE public.venue_listings
  ADD COLUMN IF NOT EXISTS coordinate_precision text
  CHECK (coordinate_precision IN ('exact', 'approximate'));

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS coordinate_precision text
  CHECK (coordinate_precision IN ('exact', 'approximate'));

ALTER TABLE public.experience_stops
  ADD COLUMN IF NOT EXISTS coordinate_precision text
  CHECK (coordinate_precision IN ('exact', 'approximate'));

COMMENT ON COLUMN public.venue_listings.coordinate_precision IS
  'Issue #1363: how the lat/lng was captured — ''exact'' (Mapbox pick / pin) or '
  '''approximate'' (free-text forward-geocode). NULL = unknown (pre-1363 rows). '
  'Drives honest map zoom + "Approximate location" caption; never fabricated.';
COMMENT ON COLUMN public.events.coordinate_precision IS
  'Issue #1363: coordinate precision for the event location (see venue_listings).';
COMMENT ON COLUMN public.experience_stops.coordinate_precision IS
  'Issue #1363: coordinate precision for this stop (see venue_listings).';

-- ── 2. biz_create_venue_listing — gains p_coordinate_precision ──────────────
-- Re-published VERBATIM from 20261130000003_orch_1255_claim_rpcs_public_views.sql
-- with exactly two additive changes:
--   (a) a trailing `p_coordinate_precision text DEFAULT ''` parameter
--       (empty → NULL; an unrecognised value is IGNORED → NULL, never rejected,
--        so a stale client can never break venue create), and
--   (b) the normalized value written to the new coordinate_precision column.
-- Everything else — including the `location_required` guard (SPEC hard guard 4,
-- DO-NOT-TOUCH) and the ORCH-1255 no-hidden-brand invariant — is unchanged.
--
-- Adding a parameter changes the function signature, so the prior 17-arg
-- overload is DROPped first (a bare CREATE OR REPLACE would leave a stale
-- overload → PostgREST ambiguity).
DROP FUNCTION IF EXISTS public.biz_create_venue_listing(
  uuid, text, text, text, text, double precision, double precision, text, text,
  text, text, text, text, text, text, jsonb, uuid
);

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
AS $$
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
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- D-1 ownership: the venue attaches to an EXISTING brand the caller owns.
  -- A member of another brand cannot attach venues to brands they don't own.
  IF NOT EXISTS (
    SELECT 1 FROM public.brands b
    WHERE b.id = p_brand_id AND b.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'brand_not_found';
  END IF;
  IF public.biz_brand_effective_rank_for_caller(p_brand_id)
       < public.biz_role_rank('brand_owner') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Input validation IDENTICAL to biz_create_venue_brand_authoring
  -- (1186-A lines 176–231).
  IF length(trim(coalesce(p_name, ''))) = 0 THEN
    RAISE EXCEPTION 'name_required';
  END IF;

  IF length(trim(coalesce(p_slug, ''))) = 0 THEN
    RAISE EXCEPTION 'slug_required';
  END IF;

  IF trim(p_slug) !~ '^[a-z0-9]{1,32}$' THEN
    RAISE EXCEPTION 'invalid_slug';
  END IF;

  -- SPEC hard guard 4 / DO-NOT-TOUCH: the location_required guard is PRESERVED.
  -- The three-tier field satisfies it with a real coordinate (pick / forward-
  -- geocode / pin) — it is NEVER removed or loosened.
  IF p_lat IS NULL OR p_lng IS NULL THEN
    RAISE EXCEPTION 'location_required';
  END IF;

  IF p_hours IS NULL OR jsonb_typeof(p_hours) != 'array' OR jsonb_array_length(p_hours) != 7 THEN
    RAISE EXCEPTION 'hours_must_have_7_rows';
  END IF;

  IF p_venue_category IS NULL OR p_venue_category NOT IN ('restaurant', 'play', 'creative_and_arts') THEN
    RAISE EXCEPTION 'invalid_venue_category';
  END IF;

  -- Issue #1363 — normalize the precision token: empty/blank → NULL; an
  -- unrecognised value → NULL (ignored, never rejected). The CHECK constraint
  -- then only ever sees 'exact' | 'approximate' | NULL.
  v_coordinate_precision := nullif(trim(coalesce(p_coordinate_precision, '')), '');
  IF v_coordinate_precision IS NOT NULL
     AND v_coordinate_precision NOT IN ('exact', 'approximate') THEN
    v_coordinate_precision := NULL;
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

  -- The venue row. NO brands-table insert. Ever.
  -- (I-PROPOSED-1255-NO-HIDDEN-BRAND-ON-VENUE-CREATE — the SQL test
  -- orch_1255_no_hidden_brand.test.sql asserts brands delta = 0 and that this
  -- function's body carries no brands-table insert statement.)
  -- Slug collisions surface as unique_violation on (brand_id, slug) → the
  -- client maps 23505 to SlugCollisionError; duplicate place claims are
  -- blocked by venue_listings_place_uniq (23505 → "already in our
  -- verification queue" client copy, existing shape).
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
  )
  VALUES (
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

  -- 7 hours rows, venue-keyed (1186-A loop shape verbatim).
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
    )
    VALUES (
      p_brand_id,
      v_venue_id,
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

  -- Pipeline row PER VENUE (merge shape as 1186-A lines 319–339, conflict
  -- target moved to the M2 venue-unique — R-1 structurally dead).
  INSERT INTO public.brand_place_pipeline_state (
    brand_id,
    venue_id,
    place_pool_id,
    status,
    stage_status,
    readiness,
    coaching
  )
  VALUES (
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
      stage_status = brand_place_pipeline_state.stage_status || excluded.stage_status,
      updated_at = now();

  -- ORCH-1186-A live bridge, venue-keyed: seed the reservation baseline
  -- service periods from the just-written hours. Non-clobber + idempotent.
  PERFORM public.biz_derive_service_periods_from_brand_hours(v_venue_id);

  RETURN v_venue_id;
END;
$$;

REVOKE ALL ON FUNCTION public.biz_create_venue_listing (uuid, text, text, text, text, double precision, double precision, text, text, text, text, text, text, text, text, jsonb, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.biz_create_venue_listing (uuid, text, text, text, text, double precision, double precision, text, text, text, text, text, text, text, text, jsonb, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.biz_create_venue_listing (uuid, text, text, text, text, double precision, double precision, text, text, text, text, text, text, text, text, jsonb, uuid, text) TO authenticated;

COMMENT ON FUNCTION public.biz_create_venue_listing IS
  'META-ORCH-1255 M4 (D-1): creates a venue_listings row (pending_review) + 7 '
  'venue-keyed brand_hours rows + a per-venue pipeline row + the derived '
  'service-period baseline, under an EXISTING brand the caller owns (rank >= '
  'brand_owner). NEVER inserts a brands row '
  '(I-PROPOSED-1255-NO-HIDDEN-BRAND-ON-VENUE-CREATE). Issue #1363 adds an '
  'optional p_coordinate_precision (exact|approximate) written to the new '
  'coordinate_precision column; location_required is unchanged.';
