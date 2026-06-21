-- ===========================================================================
-- ORCH-1186-A — Venue hours unification: brand_hours is the SINGLE OWNER of
-- opening hours; venue_availability_config.service_periods is SEEDED/DERIVED
-- from it, never authored independently for "opening hours".
-- ---------------------------------------------------------------------------
-- DEC-B (META-ORCH-1186): brand_hours is canonical. This migration:
--   1. Adds the shared bridge helper biz_derive_service_periods_from_brand_hours
--      — the ONLY producer of `type:"derived_from_hours"` service periods.
--   2. Re-states biz_create_venue_brand_authoring + biz_upsert_brand_hours
--      VERBATIM with a single appended PERFORM of the helper (the live bridge:
--      every hours write re-derives the reservation baseline).
--   3. One-shot backfill: ensures a config row + seeds service_periods for
--      every existing venue that has brand_hours, WITHOUT clobbering operators
--      who manually authored reservation service periods.
--
-- !!! WEEKDAY REMAP — LOAD-BEARING !!!
--   brand_hours.weekday uses Monday=0 … Sunday=6 (Ve1 convention,
--   20260613000000_ve1_physical_venue_brand_onboarding.sql:79, venueBrandHours.ts).
--   service_periods.days[] uses Postgres EXTRACT(dow) = Sunday=0 … Saturday=6
--   (the engine matches days[] against EXTRACT(dow FROM p_date),
--   20261008000001_orch_1148_available_slots_rpc_v2.sql).
--   The bridge MUST remap: pg_dow = (brand_hours.weekday + 1) % 7
--   (Mon 0→1, Tue 1→2, … Sat 5→6, Sun 6→0). Without this remap EVERY venue's
--   hours land on the wrong reservation day.
--
-- NON-CLOBBER PROVENANCE: derived periods carry `"type":"derived_from_hours"`.
--   If ANY existing service_periods element lacks that marker, the operator has
--   customized the reservation clock → the helper leaves periods UNTOUCHED
--   (it still ensures the config row exists). This makes the helper idempotent
--   AND override-safe.
--
-- MONOTONIC VERSION 20261116000000 (max in worktree + siblings was
-- 20261115000000). Apply via the Supabase Management API (NOT `supabase db
-- push`) per feedback_edge_deploy_and_migration_apply_hazards. Additive-only.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The single bridge helper.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.biz_derive_service_periods_from_brand_hours (
  p_brand_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $derive$
DECLARE
  v_place_pool_id uuid;
  v_existing jsonb;
  v_operator_authored boolean;
  v_derived jsonb;
BEGIN
  -- Source the place_pool linkage for the config row (NULL is acceptable).
  SELECT b.place_pool_id INTO v_place_pool_id
  FROM public.brands b
  WHERE b.id = p_brand_id;

  -- Step 1 — ensure a config row exists (the engine returns zero slots when the
  -- row is absent, 20261008000001:128-133). iana_timezone defaults to 'UTC';
  -- the validate trigger (20261008000000) normalises it. TZ-from-location
  -- backfill lives in the one-shot migration, not here.
  INSERT INTO public.venue_availability_config (brand_id, place_pool_id)
  VALUES (p_brand_id, v_place_pool_id)
  ON CONFLICT (brand_id) DO NOTHING;

  -- Read the current periods to apply the non-clobber merge rule.
  SELECT service_periods INTO v_existing
  FROM public.venue_availability_config
  WHERE brand_id = p_brand_id;

  v_existing := coalesce(v_existing, '[]'::jsonb);

  -- "operator-authored" = at least one element WITHOUT type=derived_from_hours.
  -- (An empty array is NOT operator-authored — it is seedable.)
  v_operator_authored := EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_existing) AS e
    WHERE coalesce(e ->> 'type', '') IS DISTINCT FROM 'derived_from_hours'
  );

  IF v_operator_authored THEN
    -- Leave operator-customized periods untouched (row already ensured above).
    RETURN;
  END IF;

  -- Step 2 — build derived periods from brand_hours, remapping the weekday to
  -- Postgres dow. One period per open day; closed/incomplete days are skipped.
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'name', 'Open',
        'days', jsonb_build_array(((h.weekday + 1) % 7)),
        'start', to_char(h.open_time, 'HH24:MI'),
        'end', to_char(h.close_time, 'HH24:MI'),
        'type', 'derived_from_hours'
      )
      ORDER BY ((h.weekday + 1) % 7)
    ),
    '[]'::jsonb
  )
  INTO v_derived
  FROM public.brand_hours h
  WHERE h.brand_id = p_brand_id
    AND h.is_closed = false
    AND h.open_time IS NOT NULL
    AND h.close_time IS NOT NULL;

  -- Step 4 — idempotent: only write (and bump updated_at) when periods change.
  IF v_existing IS DISTINCT FROM v_derived THEN
    UPDATE public.venue_availability_config
    SET service_periods = v_derived,
        updated_at = now()
    WHERE brand_id = p_brand_id;
  END IF;
END;
$derive$;

REVOKE ALL ON FUNCTION public.biz_derive_service_periods_from_brand_hours (uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.biz_derive_service_periods_from_brand_hours (uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.biz_derive_service_periods_from_brand_hours (uuid) TO service_role;

COMMENT ON FUNCTION public.biz_derive_service_periods_from_brand_hours IS
  'ORCH-1186-A DEC-B: the SINGLE producer of reservation baseline service '
  'periods. Derives venue_availability_config.service_periods from brand_hours '
  '(the canonical opening-hours owner), remapping brand_hours weekday (Mon=0..Sun=6) '
  'to Postgres dow (Sun=0..Sat=6) via (weekday+1)%7. Tags each period '
  'type=derived_from_hours; leaves periods untouched if the operator has '
  'authored any non-derived period (non-clobber). Idempotent. Called ONLY from '
  'biz_create_venue_brand_authoring + biz_upsert_brand_hours.';

-- ---------------------------------------------------------------------------
-- 2a. Re-state biz_create_venue_brand_authoring VERBATIM (from
--     20260809000000_meta_orch_1009_sub_e_business_supply_feeder.sql:250-454)
--     with ONE added line: PERFORM the bridge helper before RETURN v_brand_id.
--     Signature / arg list / REVOKE+GRANT block below are unchanged.
-- ---------------------------------------------------------------------------
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

  -- ORCH-1186-A live bridge: seed the reservation baseline service periods from
  -- the just-written brand_hours (the single source). Non-clobber + idempotent.
  PERFORM public.biz_derive_service_periods_from_brand_hours(v_brand_id);

  RETURN v_brand_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2b. Re-state biz_upsert_brand_hours VERBATIM (from
--     20260614000000_ve1_pr_review_hardening.sql:27-86) with ONE added line:
--     PERFORM the bridge helper after the insert loop. THE live edit bridge.
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

  -- ORCH-1186-A live bridge: re-derive the reservation baseline service periods
  -- from the updated brand_hours. Editing hours in Settings flows through here.
  PERFORM public.biz_derive_service_periods_from_brand_hours(p_brand_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.biz_upsert_brand_hours (uuid, jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. One-shot backfill over every brand with at least one brand_hours row.
--    First ensure/seed a config row with a TZ mapped from the venue location
--    (reusing the EXACT CASE from 20261008000000:73-111). Then call the helper
--    per brand — the non-clobber rule protects ORCH-1148-era operator periods.
-- ---------------------------------------------------------------------------

-- 3a. Ensure a config row exists for every brand that has hours but no config,
--     seeding iana_timezone from the place_pool location mapping.
INSERT INTO public.venue_availability_config (brand_id, place_pool_id, iana_timezone)
SELECT
  b.id,
  b.place_pool_id,
  CASE
    WHEN pp.country IS NULL THEN 'UTC'
    WHEN upper(pp.country) IN ('US','USA','UNITED STATES') THEN
      CASE pp.utc_offset_minutes
        WHEN -300 THEN 'America/New_York'     -- EST
        WHEN -240 THEN 'America/New_York'     -- EDT (summer-fetched)
        WHEN -360 THEN 'America/Chicago'      -- CST
        WHEN -420 THEN 'America/Denver'       -- MST
        WHEN -480 THEN 'America/Los_Angeles'  -- PST
        WHEN -540 THEN 'America/Anchorage'
        WHEN -600 THEN 'Pacific/Honolulu'
        ELSE 'America/New_York'
      END
    WHEN upper(pp.country) IN ('CA','CANADA') THEN
      CASE pp.utc_offset_minutes
        WHEN -300 THEN 'America/Toronto'
        WHEN -240 THEN 'America/Toronto'
        WHEN -360 THEN 'America/Winnipeg'
        WHEN -420 THEN 'America/Edmonton'
        WHEN -480 THEN 'America/Vancouver'
        ELSE 'America/Toronto'
      END
    WHEN upper(pp.country) IN ('NG','NIGERIA') THEN 'Africa/Lagos'
    WHEN upper(pp.country) IN ('GH','GHANA') THEN 'Africa/Accra'
    WHEN upper(pp.country) IN ('GB','UK','UNITED KINGDOM') THEN 'Europe/London'
    ELSE 'UTC'
  END AS tz
FROM public.brands b
LEFT JOIN public.place_pool pp ON pp.id = b.place_pool_id
WHERE EXISTS (SELECT 1 FROM public.brand_hours h WHERE h.brand_id = b.id)
  AND NOT EXISTS (
    SELECT 1 FROM public.venue_availability_config c WHERE c.brand_id = b.id
  )
ON CONFLICT (brand_id) DO NOTHING;

-- 3b. Seed/derive service periods per brand (non-clobber merge inside helper).
DO $backfill$
DECLARE
  v_brand_id uuid;
BEGIN
  FOR v_brand_id IN
    SELECT DISTINCT h.brand_id FROM public.brand_hours h
  LOOP
    PERFORM public.biz_derive_service_periods_from_brand_hours(v_brand_id);
  END LOOP;
END;
$backfill$;

COMMIT;
