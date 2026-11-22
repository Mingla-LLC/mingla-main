-- Issue #4490, Explorer app W3: deck facts (what a venue card says).
-- Spec 06 §3 W3 (the spec's number 20280809384490 is taken; this is the next
-- free number in the #4490 series after 20280809444490).
-- 1. issue_4490_venue_upcoming_events(venue, until): the ONE owner of "which
--    events at a venue are upcoming" (public, scheduled or live, not deleted,
--    with a slug; the next date after now and, when `until` is given, before
--    it; plus whether a date is running right now). Lifted from the events
--    block of issue_4490_venue_page_payload.
-- 2. issue_4490_venue_page_payload: re-emitted from its latest body
--    (20280809204490_issue_4490_p6_memberships.sql) with ONLY the events block
--    changed to read (1). Same rows, same order, same limit.
-- 3. issue_4490_venue_is_bookable(venue): verified venue of a live brand with
--    a live offer of a switched-on kind (entry, group packages, private hire,
--    by the hour), or a live plan with Memberships on, or Table reservations
--    on and reservable. Stays rooms alone never count (decision 2). One owner:
--    W5 and W6 call this, never a copy.
-- 4. issue_4490_venue_card_facts(venue): the single owner of what a venue
--    card says (deck chips now, the Discover venue card in W6). Prices are the
--    smallest current live price per feature, read from the same public
--    projections the venue page shows (issue_4490_public_offers,
--    issue_4490_public_memberships), so a card can never quote a price the
--    page does not. Service-internal.
-- 5. pg_deck_venue_facts(place ids): anon/authenticated batch read for the
--    deck: one row per claimed place of a verified venue of a live,
--    non-internal brand (I-4174), at most 100 ids. No contact, owner or
--    buyer data.
-- Static SQL. Local stack only until Seth approves a production migration.

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Upcoming events at a venue (one owner).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_venue_upcoming_events(p_venue_id uuid, p_until timestamptz)
RETURNS TABLE (
  event_id uuid,
  event_type text,
  title text,
  slug text,
  space_id uuid,
  starts_at timestamptz,
  live_now boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT e.id, e.event_type, e.title, e.slug, e.space_id, nd.starts_at, lv.live
  FROM public.events e
  CROSS JOIN LATERAL (
    SELECT min(d.start_at) AS starts_at FROM public.event_dates d
    WHERE d.event_id = e.id AND d.start_at > now()
      AND (p_until IS NULL OR d.start_at < p_until)
  ) nd
  CROSS JOIN LATERAL (
    SELECT EXISTS (
      SELECT 1 FROM public.event_dates d
      WHERE d.event_id = e.id AND d.start_at <= now() AND d.end_at > now()
    ) AS live
  ) lv
  WHERE e.venue_id = p_venue_id
    AND e.visibility = 'public'
    AND e.status IN ('scheduled', 'live')
    AND e.deleted_at IS NULL
    AND e.slug IS NOT NULL
    AND (nd.starts_at IS NOT NULL OR lv.live);
$function$;
REVOKE ALL ON FUNCTION public.issue_4490_venue_upcoming_events(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4490_venue_upcoming_events(uuid, timestamptz) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. The public page payload (latest body 20280809204490_issue_4490_p6_memberships.sql);
--    only the events block changed: it reads issue_4490_venue_upcoming_events.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_venue_page_payload(p_venue_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_venue public.venue_listings%ROWTYPE;
  v_row jsonb;
  v_features text[];
  v_currency text;
  v_brand_slug text;
  v_spaces jsonb;
  v_events jsonb;
  v_tables jsonb;
  v_version bigint;
  v_offers jsonb;
  v_vat jsonb;
BEGIN
  SELECT * INTO v_venue FROM public.venue_listings WHERE id = p_venue_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  v_row := public.issue_4490_venue_page_row(p_venue_id);
  v_features := public.issue_4490_public_features(p_venue_id);
  SELECT upper(COALESCE(NULLIF(btrim(b.default_currency), ''), 'NGN')), b.slug
    INTO v_currency, v_brand_slug
  FROM public.brands b WHERE b.id = v_venue.brand_id;

  SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id', s.id,
      'name', s.name,
      'setting', s.setting,
      'capacityStanding', s.capacity_standing,
      'capacitySeated', s.capacity_seated,
      'planShape', s.plan_shape,
      'photoUrls', (SELECT COALESCE(jsonb_agg(p->>'url' ORDER BY i), '[]'::jsonb)
                    FROM jsonb_array_elements(s.photos) WITH ORDINALITY AS ph(p, i))
    )) ORDER BY s.sort_order, s.created_at), '[]'::jsonb)
  INTO v_spaces
  FROM public.venue_spaces s
  WHERE s.venue_id = p_venue_id AND s.is_active AND s.archived_at IS NULL;

  IF 'events_here' = ANY(v_features) THEN
    -- #4490 Explorer W3: the predicate lives in issue_4490_venue_upcoming_events.
    SELECT COALESCE(jsonb_agg(item ORDER BY starts_at), '[]'::jsonb)
    INTO v_events
    FROM (
      SELECT jsonb_build_object(
          'id', u.event_id,
          'kind', u.event_type,
          'title', u.title,
          'startsAt', u.starts_at,
          'spaceName', sp.name,
          'fromMinor', (SELECT min(tt.price_cents) FROM public.ticket_types tt
                        WHERE tt.event_id = u.event_id AND tt.deleted_at IS NULL
                          AND NOT COALESCE(tt.is_hidden, false) AND NOT COALESCE(tt.is_disabled, false)),
          'href', CASE u.event_type
                    WHEN 'experience' THEN '/exp/' || v_brand_slug || '/' || u.slug
                    WHEN 'trip' THEN '/t/' || v_brand_slug || '/' || u.slug
                    ELSE '/e/' || v_brand_slug || '/' || u.slug END
        ) AS item,
        u.starts_at
      FROM public.issue_4490_venue_upcoming_events(p_venue_id, NULL) u
      LEFT JOIN public.venue_spaces sp ON sp.id = u.space_id
      WHERE u.starts_at IS NOT NULL
      ORDER BY u.starts_at
      LIMIT 6
    ) upcoming;
  ELSE
    v_events := '[]'::jsonb;
  END IF;

  -- #4490 P5: the tables block (party cap incl. joined tables, pick a table,
  -- hold / minimum spend from, big-party request, guest waitlist).
  v_tables := public.issue_4490_public_tables(p_venue_id, v_features);

  -- #4490 P2: live offers of publicly enabled kinds, and the venue's VAT mode.
  v_offers := public.issue_4490_public_offers(p_venue_id, v_features);
  SELECT jsonb_build_object(
      'mode', s.vat_mode,
      'ratePct', COALESCE((SELECT c.vat_rate_bps FROM public.country_vat_config c
                           WHERE c.country = upper(v_venue.country_code)), 0)::numeric / 100)
    INTO v_vat
  FROM public.venue_booking_settings s WHERE s.venue_id = p_venue_id;
  IF jsonb_array_length(v_offers) = 0 THEN
    v_vat := NULL;
  END IF;

  SELECT GREATEST(
      COALESCE((SELECT max(f.version) FROM public.venue_features f WHERE f.venue_id = p_venue_id), 0),
      COALESCE((SELECT max(s.version) FROM public.venue_spaces s WHERE s.venue_id = p_venue_id), 0),
      COALESCE((SELECT max(o.version) FROM public.stay_offerings o
                WHERE o.venue_id = p_venue_id AND o.kind NOT IN ('room', 'place')), 0))
  INTO v_version;

  RETURN jsonb_build_object(
    'version', v_version,
    'venue', v_row,
    'currencyCode', v_currency,
    'minorUnitExponent', CASE WHEN v_currency IN ('JPY', 'KRW', 'VND', 'CLP', 'ISK', 'UGX', 'RWF', 'XOF', 'XAF', 'PYG', 'GNF', 'KMF', 'DJF', 'BIF', 'VUV', 'XPF')
                              THEN 0 ELSE 2 END,
    'vat', v_vat,
    'features', to_jsonb(v_features),
    'spaces', v_spaces,
    'hours', jsonb_build_object('weekly', v_row->'hours_windows', 'specialDays', v_row->'special_hours'),
    'events', jsonb_build_object('upcoming', v_events),
    'tables', v_tables,
    'offers', v_offers,
    'memberships', public.issue_4490_public_memberships(p_venue_id, v_features)
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4490_venue_page_payload(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4490_venue_page_payload(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Bookable (one owner). Rooms alone never count.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_venue_is_bookable(p_venue_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT COALESCE((
    SELECT
      EXISTS (
        SELECT 1 FROM jsonb_array_elements(public.issue_4490_public_offers(v.id, f.feats)) o
        WHERE o->>'kind' IN ('entry', 'group_package', 'private_hire', 'by_the_hour')
      )
      OR public.issue_4490_public_memberships(v.id, f.feats) IS NOT NULL
      OR ('table_reservations' = ANY(f.feats)
          AND COALESCE((SELECT r.reservable FROM public.pg_venue_reservable_for_place(v.place_pool_id) r), false))
    FROM public.venue_listings v
    JOIN public.brands b ON b.id = v.brand_id AND b.deleted_at IS NULL
    CROSS JOIN LATERAL (SELECT public.issue_4490_public_features(v.id) AS feats) f
    WHERE v.id = p_venue_id AND v.claim_status = 'verified'
  ), false);
$function$;
REVOKE ALL ON FUNCTION public.issue_4490_venue_is_bookable(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4490_venue_is_bookable(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. What a venue card says (one owner; service-internal).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_venue_card_facts(p_venue_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_venue public.venue_listings%ROWTYPE;
  v_brand public.brands%ROWTYPE;
  v_features text[];
  v_offers jsonb;
  v_currency text;
  v_tz text;
  v_local timestamp;
  v_until timestamptz;
  v_on_starts timestamptz;
  v_on_live boolean := false;
  v_plan_from bigint;
  v_tables boolean;
BEGIN
  SELECT * INTO v_venue FROM public.venue_listings WHERE id = p_venue_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_brand FROM public.brands WHERE id = v_venue.brand_id;
  v_features := public.issue_4490_public_features(p_venue_id);
  v_offers := public.issue_4490_public_offers(p_venue_id, v_features);
  v_currency := upper(COALESCE(NULLIF(btrim(v_brand.default_currency), ''), 'NGN'));
  v_tz := public.issue_4490_venue_timezone(p_venue_id);

  -- Plans: the cheapest live MONTHLY plan (the chip reads "a month"); only
  -- when the page itself lists plans.
  IF public.issue_4490_public_memberships(p_venue_id, v_features) IS NOT NULL THEN
    SELECT min(p.price_minor) INTO v_plan_from
    FROM public.venue_membership_plans p
    JOIN public.stay_offerings o ON o.id = p.offering_id
    WHERE o.venue_id = p_venue_id AND p.status = 'live' AND p.period = 'month';
  END IF;

  v_tables := 'table_reservations' = ANY(v_features)
    AND COALESCE((SELECT r.reservable FROM public.pg_venue_reservable_for_place(v_venue.place_pool_id) r), false);

  -- On today / on tonight: a date that starts from now until the next 05:00
  -- in the venue's zone, or one that is running now.
  IF 'events_here' = ANY(v_features) THEN
    v_local := now() AT TIME ZONE v_tz;
    v_until := (date_trunc('day', v_local) + interval '5 hours'
                + CASE WHEN v_local::time >= time '05:00' THEN interval '1 day' ELSE interval '0' END)
               AT TIME ZONE v_tz;
    SELECT min(u.starts_at), COALESCE(bool_or(u.live_now), false)
      INTO v_on_starts, v_on_live
    FROM public.issue_4490_venue_upcoming_events(p_venue_id, v_until) u;
  END IF;

  RETURN jsonb_build_object(
    'venueId', v_venue.id,
    'venueName', v_venue.name,
    'venueSlug', v_venue.slug,
    'brandId', v_brand.id,
    'brandSlug', v_brand.slug,
    'brandName', v_brand.name,
    'venueType', v_venue.venue_category,
    'timezone', v_tz,
    'features', to_jsonb(v_features),
    'isBookable', public.issue_4490_venue_is_bookable(p_venue_id),
    'tablesReservable', v_tables,
    'priceFrom', jsonb_build_object(
      'entry', (SELECT min((o->>'fromMinor')::bigint) FROM jsonb_array_elements(v_offers) o
                WHERE o->>'kind' = 'entry' AND o->>'fromMinor' IS NOT NULL),
      'group_packages', (SELECT min((o->>'fromMinor')::bigint) FROM jsonb_array_elements(v_offers) o
                WHERE o->>'kind' = 'group_package' AND o->>'fromMinor' IS NOT NULL),
      'private_hire', (SELECT min((o->>'fromMinor')::bigint) FROM jsonb_array_elements(v_offers) o
                WHERE o->>'kind' = 'private_hire' AND o->>'fromMinor' IS NOT NULL),
      'by_the_hour', (SELECT min((o->>'fromMinor')::bigint) FROM jsonb_array_elements(v_offers) o
                WHERE o->>'kind' = 'by_the_hour' AND o->>'fromMinor' IS NOT NULL),
      'memberships', v_plan_from),
    'currencyCode', v_currency,
    'minorUnitExponent', CASE WHEN v_currency IN ('JPY', 'KRW', 'VND', 'CLP', 'ISK', 'UGX', 'RWF', 'XOF', 'XAF', 'PYG', 'GNF', 'KMF', 'DJF', 'BIF', 'VUV', 'XPF')
                              THEN 0 ELSE 2 END,
    'onTodayStartsAt', v_on_starts,
    'onTodayLive', COALESCE(v_on_live, false)
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4490_venue_card_facts(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4490_venue_card_facts(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. The deck's batch read (anon + authenticated).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pg_deck_venue_facts(p_place_ids uuid[])
RETURNS TABLE (place_pool_id uuid, facts jsonb)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF p_place_ids IS NULL OR cardinality(p_place_ids) = 0 THEN
    RETURN;
  END IF;
  IF cardinality(p_place_ids) > 100 THEN
    RAISE EXCEPTION 'too_many_places' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT v.place_pool_id, public.issue_4490_venue_card_facts(v.id)
  FROM public.venue_listings v
  JOIN public.brands b ON b.id = v.brand_id AND b.deleted_at IS NULL
  WHERE v.place_pool_id = ANY(p_place_ids)
    AND v.claim_status = 'verified'
    AND NOT public.admin_brand_is_internal(b.id)
  ORDER BY v.place_pool_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.pg_deck_venue_facts(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pg_deck_venue_facts(uuid[]) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.pg_deck_venue_facts(uuid[]) IS
  '#4490 Explorer W3: deck card facts for claimed places (verified venues of live, non-internal brands; at most 100 ids). Prices are the public page''s own live "from" prices; no contact, owner or buyer data.';

COMMIT;

-- Reverse (local use only): DROP FUNCTION public.pg_deck_venue_facts(uuid[]),
--   public.issue_4490_venue_card_facts(uuid), public.issue_4490_venue_is_bookable(uuid);
--   re-apply issue_4490_venue_page_payload from 20280809204490; then
--   DROP FUNCTION public.issue_4490_venue_upcoming_events(uuid, timestamptz).
