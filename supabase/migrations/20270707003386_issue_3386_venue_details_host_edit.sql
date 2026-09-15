-- ===========================================================================
-- Issue #3386 — hosts edit their venue's details (Seth's decisions, 2026-09-15)
-- ---------------------------------------------------------------------------
-- 1. Contact phone and email: the host edits them directly, no review. The
--    phone is stored as E.164 WITH the country it was typed under.
-- 2. Name, category and address while the venue is still in review
--    (claim_status = 'pending_review'): the host edits them directly. Mingla
--    reviews the latest values at approval.
-- 3. Name, address or category on a LIVE venue (claim_status = 'verified'):
--    the change is a request Mingla approves. The venue keeps serving its OLD
--    details until an admin approves; approval applies the new details in one
--    UPDATE. One request per venue; a new request replaces the old one; the
--    host can withdraw it.
--
-- WHY COLUMNS ON venue_listings AND NOT A NEW TABLE (load-bearing):
--   #2099's pending-venue identity correction pins a fingerprint of every
--   public table that carries a `venue_id` / `serving_venue_id` /
--   `duplicate_of_venue_id` / `place_pool_id` column or a foreign key to
--   venue_listings / place_pool (re-pinned by #2855). A new change-request table
--   keyed by venue would move that fingerprint, and every #2099 correction would
--   fail closed with DEPENDENCY_SCHEMA_CHANGED until someone re-reviewed it. So
--   the one pending request lives in `details_change_*` columns on the venue
--   row itself: no new dependency lane, no foreign key, and "one request per
--   venue" is structural rather than a uniqueness rule. None of the new column
--   names match the #2099 lane names. The SQL suite asserts the #2099 pin still
--   matches the live schema after this file.
--
-- WHO SEES PENDING VALUES:
--   venue_listings has no anon grant (orch_1255 core) and two SELECT policies:
--   brand members and admins. Every guest read goes through an explicit column
--   list (venue_public_view, the public RPCs, search facts) that never names a
--   `details_change_*` column, so guests keep reading the live values until an
--   admin approves. Proven by the suite (P-* cases).
--
-- WRITE PATHS (all SECURITY DEFINER, search_path pinned, no anon EXECUTE):
--   biz_update_venue_contact                    event_manager+ (any status but revoked)
--   biz_update_venue_identity_in_review         event_manager+, pending_review only
--   biz_submit_venue_details_change_request     event_manager+, verified only
--   biz_withdraw_venue_details_change_request   event_manager+
--   admin_review_venue_details_change           is_admin_user() first statement, audited
--
-- #2099 IS NOT WEAKENED: correct_pending_venue_identity / preview are not
-- touched. An in-review edit bumps updated_at (existing trigger), so a #2099
-- correction prepared before the edit returns STALE_VERSION, exactly as for
-- any other concurrent write.
--
-- #3407 LESSON (events lost their pin): an address never travels without its
-- coordinates and precision. The RPCs refuse an address without lat, lng and
-- precision, and a request that does not change the address never touches the
-- stored pin (the address group is all-or-nothing, enforced by CHECK).
--
-- Version: 20270707003386 — above every migration on origin/main
-- (20270705001984) and in every sibling worktree scanned on 2026-09-15
-- (20270706003197, 20270706000000).
--
-- Apply from MERGED main through the Management API (blind `db push` is unsafe:
-- migration-history drift). Additive: new nullable columns, constraints that
-- every existing row satisfies (all new columns NULL), new functions.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Columns.
-- ---------------------------------------------------------------------------
ALTER TABLE public.venue_listings
  ADD COLUMN IF NOT EXISTS contact_phone_country_iso text NULL,
  ADD COLUMN IF NOT EXISTS details_change_request_id uuid NULL,
  ADD COLUMN IF NOT EXISTS details_change_status text NULL,
  ADD COLUMN IF NOT EXISTS details_change_name text NULL,
  ADD COLUMN IF NOT EXISTS details_change_venue_category text NULL,
  ADD COLUMN IF NOT EXISTS details_change_address text NULL,
  ADD COLUMN IF NOT EXISTS details_change_city text NULL,
  ADD COLUMN IF NOT EXISTS details_change_country_code text NULL,
  ADD COLUMN IF NOT EXISTS details_change_lat double precision NULL,
  ADD COLUMN IF NOT EXISTS details_change_lng double precision NULL,
  ADD COLUMN IF NOT EXISTS details_change_coordinate_precision text NULL,
  ADD COLUMN IF NOT EXISTS details_change_requested_by uuid NULL,
  ADD COLUMN IF NOT EXISTS details_change_requested_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS details_change_reviewed_by uuid NULL,
  ADD COLUMN IF NOT EXISTS details_change_reviewed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS details_change_rejection_reason text NULL;

COMMENT ON COLUMN public.venue_listings.contact_phone_country_iso IS
  '#3386: ISO 3166-1 alpha-2 country the contact phone was entered under. Set with contact_phone by biz_update_venue_contact; NULL when there is no phone or it predates #3386.';
COMMENT ON COLUMN public.venue_listings.details_change_status IS
  '#3386: the one host change request for a LIVE venue. NULL = none; pending = waiting for Mingla; rejected = Mingla declined (reason kept until the host dismisses it or sends a new request). Guests never read details_change_* columns.';

DO $issue_3386_constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.venue_listings'::regclass
      AND conname = 'venue_listings_contact_phone_country_iso_check'
  ) THEN
    ALTER TABLE public.venue_listings
      ADD CONSTRAINT venue_listings_contact_phone_country_iso_check
      CHECK (contact_phone_country_iso IS NULL OR contact_phone_country_iso ~ '^[A-Z]{2}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.venue_listings'::regclass
      AND conname = 'venue_listings_details_change_values_check'
  ) THEN
    ALTER TABLE public.venue_listings
      ADD CONSTRAINT venue_listings_details_change_values_check
      CHECK (
        (details_change_status IS NULL OR details_change_status IN ('pending', 'rejected'))
        AND (details_change_name IS NULL OR length(btrim(details_change_name)) BETWEEN 1 AND 80)
        AND (details_change_venue_category IS NULL
             OR details_change_venue_category IN ('restaurant', 'play', 'creative_and_arts', 'stay'))
        AND (details_change_country_code IS NULL OR details_change_country_code ~ '^[A-Z]{2}$')
      );
  END IF;

  -- The address travels as ONE group: text + pin + precision, or nothing.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.venue_listings'::regclass
      AND conname = 'venue_listings_details_change_address_group_check'
  ) THEN
    ALTER TABLE public.venue_listings
      ADD CONSTRAINT venue_listings_details_change_address_group_check
      CHECK (
        (details_change_address IS NULL
          AND details_change_city IS NULL
          AND details_change_country_code IS NULL
          AND details_change_lat IS NULL
          AND details_change_lng IS NULL
          AND details_change_coordinate_precision IS NULL)
        OR
        -- Every operand is NULL-safe on purpose: a CHECK that evaluates to NULL
        -- passes, so `NULL BETWEEN -90 AND 90` alone would admit a pinless address.
        (details_change_address IS NOT NULL
          AND length(btrim(details_change_address)) > 0
          AND details_change_lat IS NOT NULL
          AND details_change_lng IS NOT NULL
          AND details_change_coordinate_precision IS NOT NULL
          AND details_change_lat BETWEEN -90 AND 90
          AND details_change_lng BETWEEN -180 AND 180
          AND details_change_coordinate_precision IN ('exact', 'approximate'))
      );
  END IF;

  -- A request is either wholly absent, pending, or rejected with a reason.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.venue_listings'::regclass
      AND conname = 'venue_listings_details_change_shape_check'
  ) THEN
    ALTER TABLE public.venue_listings
      ADD CONSTRAINT venue_listings_details_change_shape_check
      CHECK (
        (details_change_status IS NULL
          AND details_change_request_id IS NULL
          AND details_change_name IS NULL
          AND details_change_venue_category IS NULL
          AND details_change_address IS NULL
          AND details_change_requested_by IS NULL
          AND details_change_requested_at IS NULL
          AND details_change_reviewed_by IS NULL
          AND details_change_reviewed_at IS NULL
          AND details_change_rejection_reason IS NULL)
        OR
        (details_change_status IS NOT NULL
          AND details_change_request_id IS NOT NULL
          AND details_change_requested_by IS NOT NULL
          AND details_change_requested_at IS NOT NULL
          AND (details_change_name IS NOT NULL
               OR details_change_venue_category IS NOT NULL
               OR details_change_address IS NOT NULL)
          AND (
            (details_change_status = 'pending'
              AND details_change_reviewed_by IS NULL
              AND details_change_reviewed_at IS NULL
              AND details_change_rejection_reason IS NULL)
            OR
            (details_change_status = 'rejected'
              AND details_change_reviewed_by IS NOT NULL
              AND details_change_reviewed_at IS NOT NULL
              AND length(btrim(coalesce(details_change_rejection_reason, ''))) > 0)
          ))
      );
  END IF;
END
$issue_3386_constraints$;

-- The admin queue reads pending requests oldest first.
CREATE INDEX IF NOT EXISTS venue_listings_details_change_pending_idx
  ON public.venue_listings (details_change_requested_at)
  WHERE details_change_status = 'pending';

-- ---------------------------------------------------------------------------
-- 2. Internal helpers (no client EXECUTE).
-- ---------------------------------------------------------------------------

-- The phone rules the apps use for the countries they characterise
-- (mingla-business/src/utils/phone.ts NSN_LENGTHS, trunk zero dropped, NANP has
-- no trunk zero). Any other country: a well-formed E.164 number is accepted.
CREATE OR REPLACE FUNCTION public.issue_3386_phone_fits_country(
  p_phone text,
  p_country_iso text
) RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF p_phone IS NULL OR p_phone !~ '^\+[1-9][0-9]{6,14}$' THEN
    RETURN false;
  END IF;
  IF p_country_iso IS NULL OR p_country_iso !~ '^[A-Z]{2}$' THEN
    RETURN false;
  END IF;
  RETURN CASE p_country_iso
    WHEN 'NG' THEN p_phone ~ '^\+234[1-9][0-9]{9}$'
    WHEN 'US' THEN p_phone ~ '^\+1[1-9][0-9]{9}$'
    WHEN 'CA' THEN p_phone ~ '^\+1[1-9][0-9]{9}$'
    WHEN 'GB' THEN p_phone ~ '^\+44[1-9][0-9]{8,9}$'
    WHEN 'GH' THEN p_phone ~ '^\+233[1-9][0-9]{8}$'
    WHEN 'KE' THEN p_phone ~ '^\+254[1-9][0-9]{8}$'
    WHEN 'ZA' THEN p_phone ~ '^\+27[1-9][0-9]{8}$'
    WHEN 'IE' THEN p_phone ~ '^\+353[1-9][0-9]{8}$'
    ELSE true
  END;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_3386_phone_fits_country(text, text) FROM PUBLIC, anon, authenticated;

-- Lock the venue row and prove the caller manages its brand (event_manager+,
-- the canonical venue-management rank, same as biz_create_venue_listing).
CREATE OR REPLACE FUNCTION public.issue_3386_lock_managed_venue(p_venue_id uuid)
RETURNS public.venue_listings
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_venue public.venue_listings%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT v.* INTO v_venue
  FROM public.venue_listings v
  JOIN public.brands b ON b.id = v.brand_id AND b.deleted_at IS NULL
  WHERE v.id = p_venue_id
  FOR UPDATE OF v;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'venue_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF public.biz_brand_effective_rank_for_caller(v_venue.brand_id)
       < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN v_venue;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_3386_lock_managed_venue(uuid) FROM PUBLIC, anon, authenticated;

-- Validate a name / category / address edit against the venue's CURRENT values.
-- Returns only the fields that actually change:
--   {"name": text, "venue_category": text,
--    "address": {"address","city","country_code","lat","lng","coordinate_precision"}}
-- NULL arguments mean "keep". An address is refused without its pin and
-- precision (#3407). Moving a venue into or out of Stay is refused: Stay venues
-- carry their own inventory model, and that change goes through Mingla support.
CREATE OR REPLACE FUNCTION public.issue_3386_identity_patch(
  p_venue public.venue_listings,
  p_name text,
  p_venue_category text,
  p_address text,
  p_city text,
  p_country_code text,
  p_lat double precision,
  p_lng double precision,
  p_coordinate_precision text
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_patch jsonb := '{}'::jsonb;
  v_name text;
  v_category text;
  v_address text;
  v_city text;
  v_country text;
  v_precision text;
BEGIN
  IF p_name IS NOT NULL THEN
    v_name := btrim(p_name);
    IF length(v_name) NOT BETWEEN 1 AND 80 THEN
      RAISE EXCEPTION 'invalid_name' USING ERRCODE = '22023';
    END IF;
    IF v_name IS DISTINCT FROM p_venue.name THEN
      v_patch := v_patch || jsonb_build_object('name', v_name);
    END IF;
  END IF;

  IF p_venue_category IS NOT NULL THEN
    v_category := btrim(p_venue_category);
    IF v_category NOT IN ('restaurant', 'play', 'creative_and_arts', 'stay') THEN
      RAISE EXCEPTION 'invalid_venue_category' USING ERRCODE = '22023';
    END IF;
    IF v_category IS DISTINCT FROM p_venue.venue_category THEN
      IF v_category = 'stay' OR p_venue.venue_category = 'stay' THEN
        RAISE EXCEPTION 'category_stay_change_not_supported' USING ERRCODE = '22023';
      END IF;
      v_patch := v_patch || jsonb_build_object('venue_category', v_category);
    END IF;
  END IF;

  IF p_address IS NULL THEN
    IF p_lat IS NOT NULL OR p_lng IS NOT NULL OR p_coordinate_precision IS NOT NULL
       OR p_city IS NOT NULL OR p_country_code IS NOT NULL THEN
      RAISE EXCEPTION 'address_required' USING ERRCODE = '22023';
    END IF;
  ELSE
    v_address := btrim(p_address);
    IF length(v_address) = 0 THEN
      RAISE EXCEPTION 'address_required' USING ERRCODE = '22023';
    END IF;
    IF p_lat IS NULL OR p_lng IS NULL THEN
      RAISE EXCEPTION 'address_location_required' USING ERRCODE = '22023';
    END IF;
    IF p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180
       OR p_lat = 'NaN'::double precision OR p_lng = 'NaN'::double precision THEN
      RAISE EXCEPTION 'invalid_location' USING ERRCODE = '22023';
    END IF;
    v_precision := btrim(coalesce(p_coordinate_precision, ''));
    IF v_precision NOT IN ('exact', 'approximate') THEN
      RAISE EXCEPTION 'invalid_coordinate_precision' USING ERRCODE = '22023';
    END IF;
    v_city := nullif(btrim(coalesce(p_city, '')), '');
    v_country := upper(btrim(coalesce(p_country_code, '')));
    IF v_country !~ '^[A-Z]{2}$' THEN
      v_country := NULL;
    END IF;
    IF v_address IS DISTINCT FROM p_venue.address
       OR v_city IS DISTINCT FROM p_venue.city
       OR v_country IS DISTINCT FROM p_venue.country_code
       OR p_lat IS DISTINCT FROM p_venue.lat
       OR p_lng IS DISTINCT FROM p_venue.lng
       OR v_precision IS DISTINCT FROM p_venue.coordinate_precision THEN
      v_patch := v_patch || jsonb_build_object('address', jsonb_build_object(
        'address', v_address,
        'city', v_city,
        'country_code', v_country,
        'lat', p_lat,
        'lng', p_lng,
        'coordinate_precision', v_precision
      ));
    END IF;
  END IF;

  RETURN v_patch;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_3386_identity_patch(
  public.venue_listings, text, text, text, text, text, double precision, double precision, text
) FROM PUBLIC, anon, authenticated;

-- Keep a BUSINESS-AUTHORED place (the pool row this brand's own venue created,
-- no Google id) in step with the venue's name, address and pin, so the deck
-- card and the approval pitch read the same identity as the venue page. A
-- Google-seeded place is never touched: its serving columns belong to the
-- approval-time authored apply and the Google refresh, not to a host edit.
CREATE OR REPLACE FUNCTION public.issue_3386_sync_business_authored_place(p_venue_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_venue public.venue_listings%ROWTYPE;
  v_inputs jsonb;
BEGIN
  SELECT * INTO v_venue FROM public.venue_listings WHERE id = p_venue_id;
  IF NOT FOUND OR v_venue.place_pool_id IS NULL THEN
    RETURN;
  END IF;

  SELECT p.business_authoring_inputs INTO v_inputs
  FROM public.place_pool p
  WHERE p.id = v_venue.place_pool_id
    AND p.fetched_via = 'business_authored'
    AND p.google_place_id IS NULL
    AND p.business_author_brand_id = v_venue.brand_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_inputs IS NOT NULL AND jsonb_typeof(v_inputs) = 'object'
     AND jsonb_typeof(v_inputs -> 'tier1') = 'object' THEN
    v_inputs := jsonb_set(v_inputs, '{tier1,name}', to_jsonb(v_venue.name), true);
    v_inputs := jsonb_set(v_inputs, '{tier1,venueCategory}', to_jsonb(v_venue.venue_category), true);
    -- jsonb_set is STRICT: a NULL new value would null the whole column, so a
    -- venue without an address writes JSON null, never SQL NULL.
    v_inputs := jsonb_set(v_inputs, '{tier1,address}', coalesce(to_jsonb(v_venue.address), 'null'::jsonb), true);
    v_inputs := jsonb_set(v_inputs, '{tier1,lat}', to_jsonb(v_venue.lat), true);
    v_inputs := jsonb_set(v_inputs, '{tier1,lng}', to_jsonb(v_venue.lng), true);
  END IF;

  UPDATE public.place_pool p
  SET name = v_venue.name,
      address = v_venue.address,
      lat = v_venue.lat,
      lng = v_venue.lng,
      business_authoring_inputs = v_inputs
  WHERE p.id = v_venue.place_pool_id
    AND (p.name IS DISTINCT FROM v_venue.name
      OR p.address IS DISTINCT FROM v_venue.address
      OR p.lat IS DISTINCT FROM v_venue.lat
      OR p.lng IS DISTINCT FROM v_venue.lng
      OR p.business_authoring_inputs IS DISTINCT FROM v_inputs);
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_3386_sync_business_authored_place(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Host RPCs.
-- ---------------------------------------------------------------------------

-- Decision 1 — contact phone and email, no review. Empty string clears a field;
-- at least one way to reach the venue must remain.
CREATE OR REPLACE FUNCTION public.biz_update_venue_contact(
  p_venue_id uuid,
  p_contact_phone text,
  p_contact_phone_country_iso text,
  p_contact_email text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_venue public.venue_listings%ROWTYPE;
  v_phone text := nullif(btrim(coalesce(p_contact_phone, '')), '');
  v_iso text := nullif(upper(btrim(coalesce(p_contact_phone_country_iso, ''))), '');
  v_email text := nullif(btrim(coalesce(p_contact_email, '')), '');
BEGIN
  v_venue := public.issue_3386_lock_managed_venue(p_venue_id);
  IF v_venue.claim_status = 'revoked' THEN
    RAISE EXCEPTION 'venue_revoked' USING ERRCODE = '42501';
  END IF;
  IF v_phone IS NULL AND v_email IS NULL THEN
    RAISE EXCEPTION 'contact_required' USING ERRCODE = '22023';
  END IF;
  IF v_phone IS NOT NULL THEN
    IF v_phone !~ '^\+[1-9][0-9]{6,14}$' THEN
      RAISE EXCEPTION 'invalid_phone' USING ERRCODE = '22023';
    END IF;
    IF v_iso IS NULL OR v_iso !~ '^[A-Z]{2}$' THEN
      RAISE EXCEPTION 'phone_country_required' USING ERRCODE = '22023';
    END IF;
    IF NOT public.issue_3386_phone_fits_country(v_phone, v_iso) THEN
      RAISE EXCEPTION 'phone_country_mismatch' USING ERRCODE = '22023';
    END IF;
  ELSE
    v_iso := NULL;
  END IF;
  IF v_email IS NOT NULL
     AND (length(v_email) > 254 OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') THEN
    RAISE EXCEPTION 'invalid_email' USING ERRCODE = '22023';
  END IF;

  UPDATE public.venue_listings
  SET contact_phone = v_phone,
      contact_phone_country_iso = v_iso,
      contact_email = v_email
  WHERE id = v_venue.id;

  RETURN jsonb_build_object(
    'ok', true,
    'venue_id', v_venue.id,
    'contact_phone', v_phone,
    'contact_phone_country_iso', v_iso,
    'contact_email', v_email
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.biz_update_venue_contact(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.biz_update_venue_contact(uuid, text, text, text) TO authenticated;
COMMENT ON FUNCTION public.biz_update_venue_contact(uuid, text, text, text) IS
  '#3386 decision 1: event_manager+ edits the venue contact phone (E.164 + ISO country, checked against the app phone rules) and email directly, with no review.';

-- Decision 2 — name, category and address while the venue is in review.
CREATE OR REPLACE FUNCTION public.biz_update_venue_identity_in_review(
  p_venue_id uuid,
  p_name text DEFAULT NULL,
  p_venue_category text DEFAULT NULL,
  p_address text DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_country_code text DEFAULT NULL,
  p_lat double precision DEFAULT NULL,
  p_lng double precision DEFAULT NULL,
  p_coordinate_precision text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_venue public.venue_listings%ROWTYPE;
  v_patch jsonb;
BEGIN
  v_venue := public.issue_3386_lock_managed_venue(p_venue_id);
  IF v_venue.claim_status <> 'pending_review' THEN
    RAISE EXCEPTION 'venue_not_in_review' USING ERRCODE = '55000';
  END IF;

  v_patch := public.issue_3386_identity_patch(
    v_venue, p_name, p_venue_category, p_address, p_city, p_country_code,
    p_lat, p_lng, p_coordinate_precision
  );
  IF v_patch = '{}'::jsonb THEN
    RETURN jsonb_build_object('ok', true, 'venue_id', v_venue.id, 'changed', false, 'applied', v_patch);
  END IF;

  UPDATE public.venue_listings
  SET name = COALESCE(v_patch ->> 'name', name),
      venue_category = COALESCE(v_patch ->> 'venue_category', venue_category),
      address = CASE WHEN v_patch ? 'address' THEN v_patch #>> '{address,address}' ELSE address END,
      city = CASE WHEN v_patch ? 'address' THEN v_patch #>> '{address,city}' ELSE city END,
      country_code = CASE WHEN v_patch ? 'address' THEN v_patch #>> '{address,country_code}' ELSE country_code END,
      lat = CASE WHEN v_patch ? 'address' THEN (v_patch #>> '{address,lat}')::double precision ELSE lat END,
      lng = CASE WHEN v_patch ? 'address' THEN (v_patch #>> '{address,lng}')::double precision ELSE lng END,
      coordinate_precision = CASE WHEN v_patch ? 'address' THEN v_patch #>> '{address,coordinate_precision}' ELSE coordinate_precision END
  WHERE id = v_venue.id;

  PERFORM public.issue_3386_sync_business_authored_place(v_venue.id);

  RETURN jsonb_build_object('ok', true, 'venue_id', v_venue.id, 'changed', true, 'applied', v_patch);
END;
$function$;
REVOKE ALL ON FUNCTION public.biz_update_venue_identity_in_review(
  uuid, text, text, text, text, text, double precision, double precision, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.biz_update_venue_identity_in_review(
  uuid, text, text, text, text, text, double precision, double precision, text
) TO authenticated;
COMMENT ON FUNCTION public.biz_update_venue_identity_in_review(
  uuid, text, text, text, text, text, double precision, double precision, text
) IS '#3386 decision 2: event_manager+ edits name, category and address (with pin and precision) directly while the venue is pending_review. The slug never changes.';

-- Decision 3 — a live venue's name, category or address becomes a request.
CREATE OR REPLACE FUNCTION public.biz_submit_venue_details_change_request(
  p_venue_id uuid,
  p_name text DEFAULT NULL,
  p_venue_category text DEFAULT NULL,
  p_address text DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_country_code text DEFAULT NULL,
  p_lat double precision DEFAULT NULL,
  p_lng double precision DEFAULT NULL,
  p_coordinate_precision text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_venue public.venue_listings%ROWTYPE;
  v_patch jsonb;
  v_request_id uuid := gen_random_uuid();
  v_replaced boolean;
BEGIN
  v_venue := public.issue_3386_lock_managed_venue(p_venue_id);
  IF v_venue.claim_status <> 'verified' THEN
    RAISE EXCEPTION 'venue_not_live' USING ERRCODE = '55000';
  END IF;

  v_patch := public.issue_3386_identity_patch(
    v_venue, p_name, p_venue_category, p_address, p_city, p_country_code,
    p_lat, p_lng, p_coordinate_precision
  );
  IF v_patch = '{}'::jsonb THEN
    RAISE EXCEPTION 'nothing_to_change' USING ERRCODE = '22023';
  END IF;
  v_replaced := v_venue.details_change_status = 'pending';

  UPDATE public.venue_listings
  SET details_change_request_id = v_request_id,
      details_change_status = 'pending',
      details_change_name = v_patch ->> 'name',
      details_change_venue_category = v_patch ->> 'venue_category',
      details_change_address = v_patch #>> '{address,address}',
      details_change_city = v_patch #>> '{address,city}',
      details_change_country_code = v_patch #>> '{address,country_code}',
      details_change_lat = (v_patch #>> '{address,lat}')::double precision,
      details_change_lng = (v_patch #>> '{address,lng}')::double precision,
      details_change_coordinate_precision = v_patch #>> '{address,coordinate_precision}',
      details_change_requested_by = auth.uid(),
      details_change_requested_at = now(),
      details_change_reviewed_by = NULL,
      details_change_reviewed_at = NULL,
      details_change_rejection_reason = NULL
  WHERE id = v_venue.id;

  RETURN jsonb_build_object(
    'ok', true,
    'venue_id', v_venue.id,
    'request_id', v_request_id,
    'replaced', coalesce(v_replaced, false),
    'proposed', v_patch
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.biz_submit_venue_details_change_request(
  uuid, text, text, text, text, text, double precision, double precision, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.biz_submit_venue_details_change_request(
  uuid, text, text, text, text, text, double precision, double precision, text
) TO authenticated;
COMMENT ON FUNCTION public.biz_submit_venue_details_change_request(
  uuid, text, text, text, text, text, double precision, double precision, text
) IS '#3386 decision 3: event_manager+ asks Mingla to change a LIVE venue''s name, category or address. The live row is untouched; a new request replaces the previous one.';

-- Withdraw a pending request, or dismiss a rejected one. Idempotent. When a
-- request id is given it must be the current one, so a stale screen can never
-- withdraw a newer request someone else sent.
CREATE OR REPLACE FUNCTION public.biz_withdraw_venue_details_change_request(
  p_venue_id uuid,
  p_request_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_venue public.venue_listings%ROWTYPE;
BEGIN
  v_venue := public.issue_3386_lock_managed_venue(p_venue_id);
  IF v_venue.details_change_status IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'venue_id', v_venue.id, 'withdrawn', false);
  END IF;
  IF p_request_id IS NOT NULL
     AND p_request_id IS DISTINCT FROM v_venue.details_change_request_id THEN
    RAISE EXCEPTION 'request_superseded';
  END IF;

  UPDATE public.venue_listings
  SET details_change_request_id = NULL,
      details_change_status = NULL,
      details_change_name = NULL,
      details_change_venue_category = NULL,
      details_change_address = NULL,
      details_change_city = NULL,
      details_change_country_code = NULL,
      details_change_lat = NULL,
      details_change_lng = NULL,
      details_change_coordinate_precision = NULL,
      details_change_requested_by = NULL,
      details_change_requested_at = NULL,
      details_change_reviewed_by = NULL,
      details_change_reviewed_at = NULL,
      details_change_rejection_reason = NULL
  WHERE id = v_venue.id;

  RETURN jsonb_build_object(
    'ok', true,
    'venue_id', v_venue.id,
    'withdrawn', true,
    'previous_status', v_venue.details_change_status
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.biz_withdraw_venue_details_change_request(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.biz_withdraw_venue_details_change_request(uuid, uuid) TO authenticated;
COMMENT ON FUNCTION public.biz_withdraw_venue_details_change_request(uuid, uuid) IS
  '#3386: event_manager+ withdraws the pending change request (or dismisses a rejected one). Idempotent; refuses a superseded request id.';

-- ---------------------------------------------------------------------------
-- 4. Admin decision. Approve applies the proposed values to the live row in ONE
--    UPDATE and clears the request; reject keeps the proposal with a reason for
--    the host. Both write admin_audit_log through admin_write_audit. The host
--    notification is sent by the admin-review-venue-claim edge function after
--    this returns (the existing claim-decision pattern).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_review_venue_details_change(
  p_venue_id uuid,
  p_request_id uuid,
  p_decision text,
  p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_venue public.venue_listings%ROWTYPE;
  v_after public.venue_listings%ROWTYPE;
  v_decision text := lower(btrim(coalesce(p_decision, '')));
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_before jsonb;
  v_proposed jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_decision NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'invalid_decision' USING ERRCODE = '22023';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'request_id_required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_venue FROM public.venue_listings WHERE id = p_venue_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'venue_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Withdrawn, replaced by a newer request, or already approved: never apply a
  -- request the admin is not looking at.
  IF v_venue.details_change_request_id IS DISTINCT FROM p_request_id THEN
    RETURN jsonb_build_object('ok', false, 'code', 'request_not_current', 'venue_id', v_venue.id);
  END IF;
  IF v_venue.details_change_status = 'rejected' THEN
    IF v_decision = 'reject' THEN
      RETURN jsonb_build_object(
        'ok', true, 'noop', true, 'decision', 'rejected',
        'venue_id', v_venue.id, 'brand_id', v_venue.brand_id,
        'request_id', p_request_id, 'venue_name', v_venue.name
      );
    END IF;
    RETURN jsonb_build_object('ok', false, 'code', 'request_not_pending', 'venue_id', v_venue.id);
  END IF;

  v_before := jsonb_build_object(
    'name', v_venue.name,
    'venue_category', v_venue.venue_category,
    'address', v_venue.address,
    'city', v_venue.city,
    'country_code', v_venue.country_code,
    'lat', v_venue.lat,
    'lng', v_venue.lng,
    'coordinate_precision', v_venue.coordinate_precision
  );
  v_proposed := jsonb_strip_nulls(jsonb_build_object(
    'name', v_venue.details_change_name,
    'venue_category', v_venue.details_change_venue_category,
    'address', v_venue.details_change_address,
    'city', v_venue.details_change_city,
    'country_code', v_venue.details_change_country_code,
    'lat', v_venue.details_change_lat,
    'lng', v_venue.details_change_lng,
    'coordinate_precision', v_venue.details_change_coordinate_precision
  ));

  IF v_decision = 'approve' THEN
    IF v_venue.claim_status <> 'verified' THEN
      RAISE EXCEPTION 'venue_not_live' USING ERRCODE = '55000';
    END IF;
    IF v_venue.details_change_venue_category IS NOT NULL
       AND v_venue.details_change_venue_category IS DISTINCT FROM v_venue.venue_category
       AND (v_venue.details_change_venue_category = 'stay' OR v_venue.venue_category = 'stay') THEN
      RAISE EXCEPTION 'category_stay_change_not_supported' USING ERRCODE = '22023';
    END IF;

    -- One statement: the right-hand side reads the pre-update row, so the new
    -- values land and the request clears atomically.
    UPDATE public.venue_listings
    SET name = COALESCE(details_change_name, name),
        venue_category = COALESCE(details_change_venue_category, venue_category),
        address = CASE WHEN details_change_address IS NOT NULL THEN details_change_address ELSE address END,
        city = CASE WHEN details_change_address IS NOT NULL THEN details_change_city ELSE city END,
        country_code = CASE WHEN details_change_address IS NOT NULL THEN details_change_country_code ELSE country_code END,
        lat = CASE WHEN details_change_address IS NOT NULL THEN details_change_lat ELSE lat END,
        lng = CASE WHEN details_change_address IS NOT NULL THEN details_change_lng ELSE lng END,
        coordinate_precision = CASE WHEN details_change_address IS NOT NULL THEN details_change_coordinate_precision ELSE coordinate_precision END,
        details_change_request_id = NULL,
        details_change_status = NULL,
        details_change_name = NULL,
        details_change_venue_category = NULL,
        details_change_address = NULL,
        details_change_city = NULL,
        details_change_country_code = NULL,
        details_change_lat = NULL,
        details_change_lng = NULL,
        details_change_coordinate_precision = NULL,
        details_change_requested_by = NULL,
        details_change_requested_at = NULL,
        details_change_reviewed_by = NULL,
        details_change_reviewed_at = NULL,
        details_change_rejection_reason = NULL
    WHERE id = v_venue.id
    RETURNING * INTO v_after;

    PERFORM public.issue_3386_sync_business_authored_place(v_venue.id);

    PERFORM public.admin_write_audit(
      'venue_details_change.approve',
      'venue_listing',
      v_venue.id::text,
      'Approved the host''s venue details change request',
      jsonb_build_object(
        'request_id', p_request_id,
        'requested_by', v_venue.details_change_requested_by,
        'before', v_before,
        'proposed', v_proposed
      ),
      false
    );

    RETURN jsonb_build_object(
      'ok', true,
      'noop', false,
      'decision', 'approved',
      'venue_id', v_venue.id,
      'brand_id', v_venue.brand_id,
      'request_id', p_request_id,
      'requested_by', v_venue.details_change_requested_by,
      'venue_name', v_after.name,
      'before', v_before,
      'proposed', v_proposed
    );
  END IF;

  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'rejection_reason_required' USING ERRCODE = '22023';
  END IF;
  IF length(v_reason) > 1000 THEN
    RAISE EXCEPTION 'rejection_reason_too_long' USING ERRCODE = '22023';
  END IF;

  UPDATE public.venue_listings
  SET details_change_status = 'rejected',
      details_change_reviewed_by = auth.uid(),
      details_change_reviewed_at = now(),
      details_change_rejection_reason = v_reason
  WHERE id = v_venue.id;

  PERFORM public.admin_write_audit(
    'venue_details_change.reject',
    'venue_listing',
    v_venue.id::text,
    v_reason,
    jsonb_build_object(
      'request_id', p_request_id,
      'requested_by', v_venue.details_change_requested_by,
      'before', v_before,
      'proposed', v_proposed
    ),
    true
  );

  RETURN jsonb_build_object(
    'ok', true,
    'noop', false,
    'decision', 'rejected',
    'venue_id', v_venue.id,
    'brand_id', v_venue.brand_id,
    'request_id', p_request_id,
    'requested_by', v_venue.details_change_requested_by,
    'venue_name', v_venue.name,
    'rejection_reason', v_reason,
    'before', v_before,
    'proposed', v_proposed
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_review_venue_details_change(uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_review_venue_details_change(uuid, uuid, text, text) TO authenticated;
COMMENT ON FUNCTION public.admin_review_venue_details_change(uuid, uuid, text, text) IS
  '#3386: admin approves (applies the proposed name/category/address atomically) or rejects (with a reason) the current venue details change request. Audited via admin_write_audit.';

COMMIT;
