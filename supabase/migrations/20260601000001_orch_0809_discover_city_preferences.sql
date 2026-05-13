-- ORCH-0809 Slice M1: Discover Ticketmaster filter expansion v1
-- Adds 5 nullable columns to public.preferences to persist the user's
-- Discover city selection. NULL means "use GPS-resolved city as default".
-- All five columns get written together when the user picks a city via the
-- CityPickerSheet; denormalized lat/lng support the edge function's
-- <5-result lat/lng fallback path.
--
-- Spec: Mingla_Artifacts/specs/SPEC_ORCH-0809_DISCOVER_TICKETMASTER_FILTER_EXPANSION_V1.md §5.1
-- Invariant: I-PROPOSED-BG DISCOVER_CITY_PERSISTED (DRAFT — flips ACTIVE on CLOSE)
-- RLS: existing preferences_owner_select/insert/update policies cover the new columns
--      (additive nullable columns inherit policy coverage; predicates are user_id = auth.uid()).

ALTER TABLE public.preferences
  ADD COLUMN IF NOT EXISTS discover_city_name text NULL,
  ADD COLUMN IF NOT EXISTS discover_city_state_code text NULL,
  ADD COLUMN IF NOT EXISTS discover_city_country_code text NULL,
  ADD COLUMN IF NOT EXISTS discover_city_lat numeric NULL,
  ADD COLUMN IF NOT EXISTS discover_city_lng numeric NULL;

COMMENT ON COLUMN public.preferences.discover_city_name IS
  'ORCH-0809: User-selected city for Discover Ticketmaster filter. NULL = use GPS-resolved city as default (no override). Set together with discover_city_state_code, discover_city_country_code, discover_city_lat, discover_city_lng when the user picks a city via CityPickerSheet. lat/lng are denormalized from Google Places autocomplete at write time and feed the edge function''s <5-result lat/lng fallback path.';

COMMENT ON COLUMN public.preferences.discover_city_state_code IS
  'ORCH-0809: ISO-3166-2 region code (e.g. "NY"). Used as Ticketmaster stateCode for disambiguation.';

COMMENT ON COLUMN public.preferences.discover_city_country_code IS
  'ORCH-0809: ISO-3166-1 alpha-2 country code (e.g. "US"). Used as Ticketmaster countryCode for disambiguation.';

COMMENT ON COLUMN public.preferences.discover_city_lat IS
  'ORCH-0809: Denormalized lat from Google Places autocomplete at city-pick time. Used for the edge function lat/lng fallback path when the chosen city returns <5 Ticketmaster results.';

COMMENT ON COLUMN public.preferences.discover_city_lng IS
  'ORCH-0809: Denormalized lng from Google Places autocomplete at city-pick time. Used for the edge function lat/lng fallback path when the chosen city returns <5 Ticketmaster results.';

-- Apply-time verification probe per ORCH-0793 / ORCH-0795 / ORCH-0805 precedent.
-- Fails the migration transaction if any of the five columns are missing.
DO $$
DECLARE
  v_count int;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'preferences'
    AND column_name IN (
      'discover_city_name',
      'discover_city_state_code',
      'discover_city_country_code',
      'discover_city_lat',
      'discover_city_lng'
    );
  IF v_count <> 5 THEN
    RAISE EXCEPTION 'ORCH-0809 migration failed: expected 5 discover_city_* columns on public.preferences, found %', v_count;
  END IF;
END$$;
