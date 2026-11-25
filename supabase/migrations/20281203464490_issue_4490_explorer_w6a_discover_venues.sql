-- Issue #4490, Explorer app W6a: venues in Discover (a fifth kind, "Venues").
-- Spec 06 §3 W6a (the spec's number 20281203384490 is taken; this is the next free
-- slot after 20281203454490 and before spec 08's reserved 20281203504490).
--
-- 1. issue_4490_venue_type_chip_keys(): the ONE SQL list of venue types that are
--    filter chips, in chip order (the taxonomy without 'stay'). Discover's
--    validation and facets and the deck's venue-type chips (W6b) read it.
-- 2. issue_4490_discover_venue_candidates(city names, lat, lng, radius km): the ONE
--    owner of "which venues Discover lists here". A venue is listed when it is in
--    venue_public_view (verified, brand not deleted), its brand is not internal
--    (issue_4174_explorer_brand_visible), issue_4490_venue_is_bookable says yes
--    (a live switched-on offer, plan or reservable tables; rooms never count), and
--    VENUE_DISCOVER is on. A venue appears once (decision 7): a Stay venue is left
--    out of Venues only when the Stays kind actually lists it (fix round 1, W6-N3:
--    issue_4490_stays_listed_venue_ids reads the Stays kind itself, so the Stays
--    rule has one owner); a stay venue the Stays kind does not list (rooms not
--    bookable yet, no price or cover, STAY_PUBLIC_PAGES off) stays in Venues when
--    it is bookable through a venue offer. City scope is the same anchor as every
--    Discover kind (city name match, or within the radius). Empty while
--    VENUE_DISCOVER is off.
-- 2b. issue_4490_discover_venues_filtered(cities, lat, lng, filters): the candidates
--    with the venueTypes filter applied (and validated: each value must be a chip
--    key, else 22023 invalid_filter). The items branch and every Venues count read
--    it, so a count never builds card facts (fix round 1, W6-N6).
-- 3. Counted substitutions of the live bodies (the #4174 / #4420 pattern: a count
--    mismatch aborts; a body that already carries the patch is left alone):
--    discover_v2_items (the 'venues' kind), discover_v2_facets_exact (the kinds
--    loop lists 'venues' only while the switch is on, so with it off the facets
--    answer is byte-identical; the Venues count and the 'venueType' chip group are
--    plain counts of (2b), one grouped read for every chip, never the items page
--    with card facts: fix round 1, W6-N6), discover_v2_city_context and
--    discover_v2_nearest_city (venue candidates, flag-gated by (2)).
--    Latest bodies before this file: discover_v2_items, discover_v2_city_context,
--    discover_v2_nearest_city after 20280723004420; discover_v2_facets_exact from
--    20271218004073 (+ #4174 / #3281 checked patches).
-- 4. Flag VENUE_DISCOVER (false).
--
-- The item for a venue carries kind 'venue', price NULL and `venue` = the card facts
-- (issue_4490_venue_card_facts, the one owner of what a venue card says); the app
-- derives the lead line and tab from those facts with the shared deriveVenuePage.

BEGIN;

INSERT INTO public.feature_flags (flag_key, is_enabled, description) VALUES
  ('VENUE_DISCOVER', false, '#4490 explorer W6: the Discover Venues kind, its venue-type chips and the deck venue-type chips')
ON CONFLICT (flag_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.issue_4490_venue_type_chip_keys()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT ARRAY['restaurant','bar_lounge','club','cafe','play','coworking','event_space','creative_and_arts']::text[];
$function$;

-- The venues the Stays kind lists for this anchor (its unfiltered first view: no
-- dates, the default guests), read from discover_v2_items('stays') itself, page by
-- page, so "listed under Stays" has exactly one owner (fix round 1, W6-N3).
CREATE OR REPLACE FUNCTION public.issue_4490_stays_listed_venue_ids(
  p_city_names text[],
  p_lat double precision,
  p_lng double precision
)
RETURNS uuid[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_ids uuid[] := ARRAY[]::uuid[];
  v_page jsonb;
  v_offset integer := 0;
  v_total integer;
BEGIN
  LOOP
    v_page := public.discover_v2_items('stays', p_city_names, p_lat, p_lng,
      public.discover_v2_radius_km('stays'), 'UTC', '{}'::jsonb, v_offset, 50);
    v_ids := v_ids || ARRAY(SELECT (item->>'id')::uuid FROM jsonb_array_elements(COALESCE(v_page->'items', '[]'::jsonb)) item);
    v_total := COALESCE((v_page->>'total')::integer, 0);
    v_offset := v_offset + 50;
    EXIT WHEN v_offset >= v_total OR jsonb_array_length(COALESCE(v_page->'items', '[]'::jsonb)) = 0;
  END LOOP;
  RETURN v_ids;
END
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_discover_venue_candidates(
  p_city_names text[],
  p_lat double precision,
  p_lng double precision,
  p_radius_km double precision
)
RETURNS TABLE (
  venue_id uuid,
  brand_id uuid,
  brand_slug text,
  brand_name text,
  venue_slug text,
  venue_name text,
  venue_type text,
  city text,
  country_code text,
  lat double precision,
  lng double precision,
  created_at timestamptz,
  timezone text,
  currency text,
  cover_url text,
  cover_type text,
  cover_hue integer,
  distance_km double precision
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  WITH stays_listed AS MATERIALIZED (
    -- Evaluated only when a stay venue with live rooms is in scope (below).
    SELECT unnest(public.issue_4490_stays_listed_venue_ids(p_city_names, p_lat, p_lng)) AS venue_id
  ), scoped AS MATERIALIZED (
    SELECT v.id, v.brand_id, v.brand_slug, v.brand_name, v.slug, v.name, v.venue_category, v.city,
      v.country_code, v.lat, v.lng, v.created_at, v.iana_timezone, v.default_currency::text AS currency,
      COALESCE(v.cover_media_url, v.pool_photo_urls[1]) AS cover_url,
      COALESCE(v.cover_media_type, 'image') AS cover_type, v.cover_hue,
      CASE WHEN v.lat IS NULL OR v.lng IS NULL THEN NULL ELSE
        6371.0*2.0*asin(sqrt(power(sin(radians(v.lat-p_lat)/2.0),2)+
          cos(radians(p_lat))*cos(radians(v.lat))*power(sin(radians(v.lng-p_lng)/2.0),2))) END AS distance_km
    FROM public.venue_public_view v
    WHERE public.issue_4490_flag_on('VENUE_DISCOVER')
      AND v.venue_category IS NOT NULL
  )
  SELECT s.id, s.brand_id, s.brand_slug, s.brand_name, s.slug, s.name, s.venue_category, s.city,
    s.country_code, s.lat, s.lng, s.created_at, s.iana_timezone, s.currency, s.cover_url, s.cover_type,
    s.cover_hue, s.distance_km
  FROM scoped s
  WHERE (s.city = ANY(COALESCE(p_city_names, '{}'::text[])) OR s.distance_km <= p_radius_km)
    AND public.issue_4174_explorer_brand_visible(s.brand_id)
    AND public.issue_4490_venue_is_bookable(s.id)
    -- A venue appears once: a stay venue is left out only when the Stays kind
    -- lists it (the live-room check is the cheap gate before reading Stays).
    AND NOT (s.venue_category = 'stay'
      AND EXISTS (
        SELECT 1 FROM public.stay_settings st
        JOIN public.stay_offerings room ON room.venue_id = st.venue_id AND room.brand_id = st.brand_id
          AND room.kind = 'room' AND room.status = 'live'
        WHERE st.venue_id = s.id AND st.brand_id = s.brand_id AND st.booking_state = 'active')
      AND EXISTS (SELECT 1 FROM stays_listed sl WHERE sl.venue_id = s.id));
$function$;

REVOKE ALL ON FUNCTION public.issue_4490_venue_type_chip_keys() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4490_venue_type_chip_keys() TO service_role;
REVOKE ALL ON FUNCTION public.issue_4490_discover_venue_candidates(text[], double precision, double precision, double precision) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4490_discover_venue_candidates(text[], double precision, double precision, double precision) TO service_role;

-- The candidates with the venueTypes filter (one owner of that filter and its
-- validation). Every Venues count reads this, never the items page.
CREATE OR REPLACE FUNCTION public.issue_4490_discover_venues_filtered(
  p_city_names text[],
  p_lat double precision,
  p_lng double precision,
  p_filters jsonb
)
RETURNS TABLE (
  venue_id uuid,
  brand_id uuid,
  brand_slug text,
  brand_name text,
  venue_slug text,
  venue_name text,
  venue_type text,
  city text,
  country_code text,
  lat double precision,
  lng double precision,
  created_at timestamptz,
  timezone text,
  currency text,
  cover_url text,
  cover_type text,
  cover_hue integer,
  distance_km double precision
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF jsonb_typeof(COALESCE(p_filters->'venueTypes','[]'::jsonb))<>'array'
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(p_filters->'venueTypes','[]'::jsonb)) vt(value)
       WHERE jsonb_typeof(vt.value)<>'string'
         OR NOT ((vt.value #>> '{}') = ANY(public.issue_4490_venue_type_chip_keys()))) THEN
    RAISE EXCEPTION 'invalid_filter' USING ERRCODE='22023';
  END IF;
  RETURN QUERY
    SELECT c.*
    FROM public.issue_4490_discover_venue_candidates(p_city_names,p_lat,p_lng,public.discover_v2_radius_km('venues')) c
    WHERE COALESCE(jsonb_array_length(COALESCE(p_filters->'venueTypes','[]'::jsonb)),0)=0
      OR c.venue_type IN (SELECT jsonb_array_elements_text(p_filters->'venueTypes'));
END
$function$;
REVOKE ALL ON FUNCTION public.issue_4490_discover_venues_filtered(text[], double precision, double precision, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4490_discover_venues_filtered(text[], double precision, double precision, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.issue_4490_stays_listed_venue_ids(text[], double precision, double precision) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4490_stays_listed_venue_ids(text[], double precision, double precision) TO service_role;

CREATE OR REPLACE FUNCTION pg_temp.issue_4490_w6a_patch(
  p_signature text,
  p_old text,
  p_new text,
  p_expected integer,
  p_marker text
) RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
  v_def text;
  v_old_count integer;
BEGIN
  v_def := pg_get_functiondef(p_signature::regprocedure);
  -- A body that already carries this patch is left alone (re-runnable).
  IF position(p_marker IN v_def) > 0 THEN
    RETURN;
  END IF;
  v_old_count := (length(v_def) - length(replace(v_def, p_old, ''))) / length(p_old);
  IF v_old_count <> p_expected THEN
    RAISE EXCEPTION 'issue_4490_w6a_shape_mismatch: % expected % match(es), found %',
      p_signature, p_expected, v_old_count;
  END IF;
  EXECUTE replace(v_def, p_old, p_new);
END
$function$;

-- -------------------------------------------------------------------------------------
-- discover_v2_items: the 'venues' kind.
-- -------------------------------------------------------------------------------------
SELECT pg_temp.issue_4490_w6a_patch(
  'public.discover_v2_items(text,text[],double precision,double precision,double precision,text,jsonb,integer,integer)',
  $old$IF p_kind NOT IN ('events','experiences','trips','stays') THEN$old$,
  $new$IF p_kind NOT IN ('events','experiences','trips','stays','venues') THEN$new$,
  1,
  $m$'trips','stays','venues') THEN$m$
);
SELECT pg_temp.issue_4490_w6a_patch(
  'public.discover_v2_items(text,text[],double precision,double precision,double precision,text,jsonb,integer,integer)',
  $old$
  ELSE
    WITH eligible_rooms AS MATERIALIZED ($old$,
  $new$
  ELSIF p_kind='venues' THEN
    -- #4490 Explorer W6a: venues a guest can book on Mingla, listed by the one
    -- rule (issue_4490_discover_venues_filtered over the candidates; empty while
    -- VENUE_DISCOVER is off; each venueTypes value must be a chip key).
    WITH eligible_all AS MATERIALIZED (
      SELECT c.venue_id,c.brand_id,c.brand_slug,c.brand_name,c.venue_slug,c.venue_name,c.venue_type,
        c.city,c.created_at,c.timezone,c.cover_url,c.cover_type,c.cover_hue,
        public.issue_4490_venue_card_facts(c.venue_id) facts
      FROM public.issue_4490_discover_venues_filtered(p_city_names,p_lat,p_lng,p_filters) c
    ), ordered AS MATERIALIZED (
      -- On now or on tonight first, then the newest verified venue (the Stays order).
      SELECT e.*,COALESCE((e.facts->>'onTodayLive')::boolean,false) live_now,
        (e.facts->>'onTodayStartsAt')::timestamptz on_starts_at
      FROM eligible_all e
    ), eligible AS (
      SELECT o.*,count(*) over() total_count FROM ordered o
      ORDER BY o.live_now DESC,o.on_starts_at ASC NULLS LAST,o.created_at DESC,o.venue_id
      OFFSET greatest(p_offset,0) LIMIT least(greatest(p_limit,1),50)
    )
    SELECT COALESCE(max(total_count),0),COALESCE(jsonb_agg(jsonb_build_object(
      'source','mingla','kind','venue','id',venue_id,
      'brand',jsonb_build_object('id',brand_id,'slug',brand_slug,'name',brand_name,'photoUrl',NULL),
      'title',venue_name,'coverUrl',cover_url,'coverType',cover_type,'coverHue',COALESCE(cover_hue,140),
      'startsAtUtc',on_starts_at,'endsAtUtc',NULL,'timezone',COALESCE(facts->>'timezone',timezone,'UTC'),
      'meta',jsonb_build_object('venueOrPlace',city),
      'price',NULL,
      'venue',facts,
      'route',jsonb_build_object('pathname','/venue/[slug]','params',jsonb_build_object('slug',venue_slug,'venueSlug',venue_slug))
    ) ORDER BY live_now DESC,on_starts_at ASC NULLS LAST,created_at DESC,venue_id),'[]'::jsonb) INTO v_total,v_rows FROM eligible;

  ELSE
    WITH eligible_rooms AS MATERIALIZED ($new$,
  1,
  $m$ELSIF p_kind='venues' THEN$m$
);

-- -------------------------------------------------------------------------------------
-- discover_v2_facets_exact: 'venues' in the kinds loop (only while the switch is on)
-- and the 'venueType' chip group (a chip only where the city has supply).
-- -------------------------------------------------------------------------------------
SELECT pg_temp.issue_4490_w6a_patch(
  'public.discover_v2_facets_exact(text[],double precision,double precision,double precision,text,text,jsonb,text)',
  $old$FOREACH v_kind IN ARRAY ARRAY['events','experiences','trips','stays'] LOOP
    v_page:=public.discover_v2_items(v_kind,p_city_names,p_lat,p_lng,public.discover_v2_radius_km(v_kind),p_tz,v_base,0,1);
    v_count:=COALESCE((v_page->>'total')::bigint,0);$old$,
  $new$FOREACH v_kind IN ARRAY ARRAY['events','experiences','trips','stays']
      || CASE WHEN public.issue_4490_flag_on('VENUE_DISCOVER') THEN ARRAY['venues'] ELSE ARRAY[]::text[] END LOOP
    IF v_kind='venues' THEN
      -- #4490 W6 fix 1: a plain count (no card facts) for the Venues pill.
      SELECT count(*) INTO v_count FROM public.issue_4490_discover_venues_filtered(p_city_names,p_lat,p_lng,v_base);
    ELSE
    v_page:=public.discover_v2_items(v_kind,p_city_names,p_lat,p_lng,public.discover_v2_radius_km(v_kind),p_tz,v_base,0,1);
    v_count:=COALESCE((v_page->>'total')::bigint,0);
    END IF;$new$,
  1,
  $m$THEN ARRAY['venues'] ELSE ARRAY[]::text[] END LOOP$m$
);
SELECT pg_temp.issue_4490_w6a_patch(
  'public.discover_v2_facets_exact(text[],double precision,double precision,double precision,text,text,jsonb,text)',
  $old$  v_page:=public.discover_v2_items(p_kind,p_city_names,p_lat,p_lng,public.discover_v2_radius_km(p_kind),p_tz,p_filters,0,1);$old$,
  $new$  IF p_kind='venues' THEN
    -- #4490 W6 fix 1: the selected Venues total is a plain count (validates the filter).
    SELECT jsonb_build_object('total',count(*),'facetOptions','{}'::jsonb) INTO v_page
    FROM public.issue_4490_discover_venues_filtered(p_city_names,p_lat,p_lng,p_filters);
  ELSE
  v_page:=public.discover_v2_items(p_kind,p_city_names,p_lat,p_lng,public.discover_v2_radius_km(p_kind),p_tz,p_filters,0,1);
  END IF;$new$,
  1,
  $m$the selected Venues total is a plain count$m$
);
SELECT pg_temp.issue_4490_w6a_patch(
  'public.discover_v2_facets_exact(text[],double precision,double precision,double precision,text,text,jsonb,text)',
  $old$
  ELSE
    v_options:='[]'::jsonb;
    FOREACH v_option IN ARRAY ARRAY['tonight','tomorrow','weekend'] LOOP$old$,
  $new$
  ELSIF p_kind='venues' THEN
    -- #4490 Explorer W6a: one chip per venue type, listed only when the city has
    -- a bookable hosted venue of that type. venueTypes is the kind's only filter,
    -- so the count that keeps every other selection is the type's own count:
    -- one grouped read for every chip (fix round 1, W6-N6).
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id',t.venue_type,'count',t.n)
             ORDER BY array_position(public.issue_4490_venue_type_chip_keys(),t.venue_type)),'[]'::jsonb)
      INTO v_options
    FROM (SELECT c.venue_type,count(*) n
          FROM public.issue_4490_discover_venues_filtered(p_city_names,p_lat,p_lng,v_base) c
          WHERE c.venue_type = ANY(public.issue_4490_venue_type_chip_keys())
          GROUP BY c.venue_type) t;
    IF jsonb_array_length(v_options)>0 THEN v_groups:=v_groups||jsonb_build_array(jsonb_build_object('id','venueType','multi',true,'options',v_options)); END IF;
  ELSE
    v_options:='[]'::jsonb;
    FOREACH v_option IN ARRAY ARRAY['tonight','tomorrow','weekend'] LOOP$new$,
  1,
  $m$ELSIF p_kind='venues' THEN$m$
);

-- -------------------------------------------------------------------------------------
-- discover_v2_city_context: venue candidates count toward the city's zone and
-- currency (venue zone = venue_public_view.iana_timezone).
-- -------------------------------------------------------------------------------------
SELECT pg_temp.issue_4490_w6a_patch(
  'public.discover_v2_city_context(text[],double precision,double precision,double precision,text)',
  $old$      AND public.discover_v2_stay_room_available(offering.id,NULL,NULL,1)
  ), candidates AS ($old$,
  $new$      AND public.discover_v2_stay_room_available(offering.id,NULL,NULL,1)

    UNION ALL

    -- #4490 Explorer W6a: bookable hosted venues (empty while VENUE_DISCOVER is off).
    SELECT 'venue',venue.venue_id,venue.timezone,venue.currency,venue.distance_km
    FROM public.issue_4490_discover_venue_candidates(p_city_names,p_lat,p_lng,public.discover_v2_radius_km('venues')) venue
  ), candidates AS ($new$,
  1,
  $m$issue_4490_discover_venue_candidates$m$
);

-- -------------------------------------------------------------------------------------
-- discover_v2_nearest_city: a city whose only supply is venues can be suggested.
-- -------------------------------------------------------------------------------------
SELECT pg_temp.issue_4490_w6a_patch(
  'public.discover_v2_nearest_city(double precision,double precision)',
  $old$
  ), measured AS ($old$,
  $new$
    UNION ALL
    -- #4490 Explorer W6a: bookable hosted venues (empty while VENUE_DISCOVER is off).
    SELECT concat_ws(', ',venue.city,venue.country_code),venue.lat,venue.lng,venue.venue_id::text
    FROM public.issue_4490_discover_venue_candidates(ARRAY[]::text[],p_lat,p_lng,500) venue
    WHERE venue.city IS NOT NULL AND venue.lat IS NOT NULL AND venue.lng IS NOT NULL
  ), measured AS ($new$,
  1,
  $m$issue_4490_discover_venue_candidates$m$
);

-- The rewritten readers keep service-role-only EXECUTE (#4073); restated, unchanged.
REVOKE ALL ON FUNCTION public.discover_v2_items(text, text[], double precision, double precision, double precision, text, jsonb, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.discover_v2_facets_exact(text[], double precision, double precision, double precision, text, text, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.discover_v2_city_context(text[], double precision, double precision, double precision, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.discover_v2_nearest_city(double precision, double precision) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.discover_v2_items(text, text[], double precision, double precision, double precision, text, jsonb, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.discover_v2_facets_exact(text[], double precision, double precision, double precision, text, text, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.discover_v2_city_context(text[], double precision, double precision, double precision, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.discover_v2_nearest_city(double precision, double precision) TO service_role;

COMMIT;
