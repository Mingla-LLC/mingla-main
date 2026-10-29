-- Issue #4174 — keep staff and demo brands out of every Explorer catalogue.
--
-- Admin already owns the one classification rule in admin_brand_is_internal().
-- Discover V1/V2 and the legacy Trips/Stays readers predate that rule, so an
-- otherwise-public offering from an internal brand could be returned to the
-- Explorer app. Patch those existing reader bodies in place so their mature
-- eligibility, price, privacy, pagination and grant contracts remain intact.
--
-- I-4174-EXPLORER-EXCLUDES-INTERNAL-BRANDS: every Explorer catalogue reader excludes brands classified as internal by admin_brand_is_internal(); Host management and preview surfaces remain unaffected.

BEGIN;

CREATE OR REPLACE FUNCTION public.issue_4174_explorer_brand_visible(
  p_brand_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT p_brand_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.brands brand
      WHERE brand.id = p_brand_id
        AND brand.deleted_at IS NULL
    )
    AND NOT public.admin_brand_is_internal(p_brand_id)
$function$;

ALTER FUNCTION public.issue_4174_explorer_brand_visible(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.issue_4174_explorer_brand_visible(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4174_explorer_brand_visible(uuid)
  TO service_role;

-- Recreate one existing function after an exact, counted source rewrite. A
-- mismatch aborts the migration instead of silently leaving a catalogue open.
CREATE OR REPLACE FUNCTION pg_temp.issue_4174_patch_reader(
  p_signature text,
  p_pattern text,
  p_replacement text,
  p_expected_matches integer
) RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
  v_definition text;
  v_match_count integer;
BEGIN
  SELECT pg_get_functiondef(p_signature::regprocedure)
  INTO v_definition;

  SELECT count(*)::integer
  INTO v_match_count
  FROM regexp_matches(v_definition, p_pattern, 'gi');

  IF v_match_count <> p_expected_matches THEN
    RAISE EXCEPTION
      'issue_4174_reader_shape_mismatch: % expected %, found %',
      p_signature, p_expected_matches, v_match_count;
  END IF;

  v_definition := regexp_replace(
    v_definition,
    p_pattern,
    p_replacement,
    'gi'
  );
  EXECUTE v_definition;
END
$function$;

-- Standard events and RSVPs. pg_discover_business_events delegates here, and
-- Discover V2 events and city context share the same base.
SELECT pg_temp.issue_4174_patch_reader(
  'public.discover_v2_event_base(text[],timestamptz,timestamptz,text[],text[],text[],float8,float8,float8)',
  'WHERE[[:space:]]+e\.deleted_at[[:space:]]+IS[[:space:]]+NULL',
  'WHERE e.deleted_at IS NULL
    AND public.issue_4174_explorer_brand_visible(e.brand_id)',
  1
);

-- The V2 function owns experiences, trips and stays. Trip facet metadata has
-- two additional source queries; all three trip predicates are patched.
SELECT pg_temp.issue_4174_patch_reader(
  'public.discover_v2_items(text,text[],float8,float8,float8,text,jsonb,integer,integer)',
  'WHERE[[:space:]]+e\.event_type[[:space:]]*=[[:space:]]*''experience''',
  'WHERE public.issue_4174_explorer_brand_visible(e.brand_id)
        AND e.event_type=''experience''',
  1
);
SELECT pg_temp.issue_4174_patch_reader(
  'public.discover_v2_items(text,text[],float8,float8,float8,text,jsonb,integer,integer)',
  'WHERE[[:space:]]+e\.event_type[[:space:]]*=[[:space:]]*''trip''',
  'WHERE public.issue_4174_explorer_brand_visible(e.brand_id)
        AND e.event_type=''trip''',
  3
);
SELECT pg_temp.issue_4174_patch_reader(
  'public.discover_v2_items(text,text[],float8,float8,float8,text,jsonb,integer,integer)',
  'WHERE[[:space:]]+venue\.venue_category[[:space:]]*=[[:space:]]*''stay''',
  'WHERE public.issue_4174_explorer_brand_visible(venue.brand_id)
        AND venue.venue_category=''stay''',
  1
);

-- Calendar and nearest-city metadata must be derived from the same visible
-- inventory as the cards and facet counts.
SELECT pg_temp.issue_4174_patch_reader(
  'public.discover_v2_city_context(text[],float8,float8,float8,text)',
  'WHERE[[:space:]]+e\.event_type[[:space:]]*=[[:space:]]*''experience''',
  'WHERE public.issue_4174_explorer_brand_visible(e.brand_id)
      AND e.event_type=''experience''',
  1
);
SELECT pg_temp.issue_4174_patch_reader(
  'public.discover_v2_city_context(text[],float8,float8,float8,text)',
  'WHERE[[:space:]]+e\.event_type[[:space:]]*=[[:space:]]*''trip''',
  'WHERE public.issue_4174_explorer_brand_visible(e.brand_id)
      AND e.event_type=''trip''',
  1
);
SELECT pg_temp.issue_4174_patch_reader(
  'public.discover_v2_city_context(text[],float8,float8,float8,text)',
  'WHERE[[:space:]]+venue\.venue_category[[:space:]]*=[[:space:]]*''stay''',
  'WHERE public.issue_4174_explorer_brand_visible(venue.brand_id)
      AND venue.venue_category=''stay''',
  1
);

SELECT pg_temp.issue_4174_patch_reader(
  'public.discover_v2_nearest_city(float8,float8)',
  'WHERE[[:space:]]+e\.deleted_at[[:space:]]+IS[[:space:]]+NULL',
  'WHERE e.deleted_at IS NULL
      AND public.issue_4174_explorer_brand_visible(e.brand_id)',
  1
);
SELECT pg_temp.issue_4174_patch_reader(
  'public.discover_v2_nearest_city(float8,float8)',
  'WHERE[[:space:]]+e\.event_type[[:space:]]*=[[:space:]]*''trip''',
  'WHERE public.issue_4174_explorer_brand_visible(e.brand_id)
      AND e.event_type=''trip''',
  1
);
SELECT pg_temp.issue_4174_patch_reader(
  'public.discover_v2_nearest_city(float8,float8)',
  'WHERE[[:space:]]+e\.event_type[[:space:]]*=[[:space:]]*''experience''',
  'WHERE public.issue_4174_explorer_brand_visible(e.brand_id)
      AND e.event_type=''experience''',
  1
);
SELECT pg_temp.issue_4174_patch_reader(
  'public.discover_v2_nearest_city(float8,float8)',
  'WHERE[[:space:]]+v\.venue_category[[:space:]]*=[[:space:]]*''stay''',
  'WHERE public.issue_4174_explorer_brand_visible(v.brand_id)
      AND v.venue_category=''stay''',
  1
);

-- Installed Explorer clients still call these legacy tab readers directly.
SELECT pg_temp.issue_4174_patch_reader(
  'public.pg_published_trips_public(text,text,timestamptz,timestamptz,integer,integer,integer,integer,text,integer,integer)',
  'WHERE[[:space:]]+e\.event_type[[:space:]]*=[[:space:]]*''trip''',
  'WHERE public.issue_4174_explorer_brand_visible(e.brand_id)
      AND e.event_type = ''trip''',
  1
);
SELECT pg_temp.issue_4174_patch_reader(
  'public.pg_public_stays_discover(text,date,date,integer,integer,integer,text[],text[],text,integer,integer)',
  'WHERE[[:space:]]+venue\.venue_category[[:space:]]*=[[:space:]]*''stay''',
  'WHERE public.issue_4174_explorer_brand_visible(venue.brand_id)
      AND venue.venue_category = ''stay''',
  1
);

COMMIT;
