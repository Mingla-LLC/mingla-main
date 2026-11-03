-- issue #3281 — Explorer lists a ticketed event only on a date a guest can buy.
--
-- Proven on production: SSNS: BRUNCH EDITION (recurring, dates 1 Nov, 6 Dec,
-- 3 Jan, 7 Feb) has two free tiers whose sale closed on 1 Nov 14:00 UTC. The
-- Discover base picked the next date ending after the window (6 Dec) and never
-- asked whether any ticket could still be bought, so Explorer showed a card
-- whose checkout refuses every tier with ticket_sales_ended.
--
-- One owner for "can a guest buy this tier for this date" (Constitution 2). No
-- scalar answer existed: checkout decides it inline across
-- issue_3872_ticket_line_price (hidden / disabled / online / sale window) and
-- issue_1930_ticket_checkout_create_session_base (capacity). The helper below
-- composes the SAME owners those paths use, never a new count:
--   * sale closed       — sale_end_at <= now() (line_price: ticket_sales_ended).
--                         A sale that OPENS later still lists (a pre-sale).
--   * date applies      — valid_occurrence_keys (issue_3281_days_in_scope rule),
--                         and the date is upcoming and not cancelled
--                         (issue_3281_listed_remaining rule).
--   * not sold out      — per date when the ticket has a day list or the event
--                         has per-occurrence capacity (issue_3313_event_day_choice),
--                         through issue_3313_ticket_type_occurrence_taken, the one
--                         per-night counter checkout and the public reader use;
--                         otherwise the shared pool, through ticket_types.sold_count,
--                         the counter checkout reads (issue_2491).
--
-- Events with no guest-purchasable tier (RSVP, tier-less listings) are unchanged.
-- Every Explorer reader of business events agrees (Constitution 13):
--   discover_v2_event_base   (feed, facets, counts, city context, V1 reader)
--   discover_v2_items        (its own in-window date picker for the card)
--   discover_v2_nearest_city (the empty-state city suggestion)
-- The three bodies below are the live production definitions, byte for byte
-- (md5 checked against production on 2026-11-03), plus one marked conjunct each.

BEGIN;

CREATE OR REPLACE FUNCTION public.issue_3281_ticket_buyable_on_date(
  p_ticket_type_id uuid, p_event_date_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $fn$
  SELECT COALESCE((
    SELECT tt.deleted_at IS NULL
       AND tt.is_hidden IS NOT TRUE
       AND tt.is_disabled IS NOT TRUE
       AND tt.available_online IS TRUE
       AND (tt.sale_end_at IS NULL OR tt.sale_end_at > now())
       AND d.end_at > now()
       AND d.cancelled_at IS NULL
       AND (tt.valid_occurrence_keys IS NULL OR d.occurrence_key = ANY (tt.valid_occurrence_keys))
       AND (
         tt.is_unlimited IS TRUE
         OR tt.quantity_total IS NULL
         OR CASE
           WHEN tt.valid_occurrence_keys IS NOT NULL
             OR COALESCE((public.issue_3313_event_day_choice(tt.event_id)->>'perOccurrenceCapacity')::boolean, false)
           THEN public.issue_3313_ticket_type_occurrence_taken(tt.id, d.id) < tt.quantity_total
           ELSE COALESCE(tt.sold_count, 0) < tt.quantity_total
         END
       )
      FROM public.ticket_types tt
      JOIN public.event_dates d ON d.id = p_event_date_id AND d.event_id = tt.event_id
     WHERE tt.id = p_ticket_type_id
  ), false);
$fn$;

COMMENT ON FUNCTION public.issue_3281_ticket_buyable_on_date(uuid, uuid) IS
  'issue #3281 — true when a guest can buy this tier for this date now or once its sale opens: listed online, not hidden or disabled, sale not closed, valid on the date, and places left on it.';

-- The Explorer listing rule: a date is listable when the event sells no tier to
-- guests online at all (RSVP / tier-less: unchanged), or some tier is buyable on it.
CREATE OR REPLACE FUNCTION public.issue_3281_explorer_date_listable(
  p_event_id uuid, p_event_date_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $fn$
  SELECT NOT EXISTS (
      SELECT 1 FROM public.ticket_types tt
       WHERE tt.event_id = p_event_id
         AND tt.deleted_at IS NULL
         AND tt.is_hidden IS NOT TRUE
         AND tt.is_disabled IS NOT TRUE
         AND tt.available_online IS TRUE
    )
    OR EXISTS (
      SELECT 1 FROM public.ticket_types tt
       WHERE tt.event_id = p_event_id
         AND public.issue_3281_ticket_buyable_on_date(tt.id, p_event_date_id)
    );
$fn$;

COMMENT ON FUNCTION public.issue_3281_explorer_date_listable(uuid, uuid) IS
  'issue #3281 — Explorer shows an event on this date only if it has no guest-purchasable tier (RSVP / tier-less) or at least one tier is buyable on the date.';

ALTER FUNCTION public.issue_3281_ticket_buyable_on_date(uuid, uuid) OWNER TO postgres;
ALTER FUNCTION public.issue_3281_explorer_date_listable(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.issue_3281_ticket_buyable_on_date(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_3281_explorer_date_listable(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3281_ticket_buyable_on_date(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_3281_explorer_date_listable(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.discover_v2_event_base(p_cities text[], p_lower_bound timestamp with time zone, p_upper_start timestamp with time zone DEFAULT NULL::timestamp with time zone, p_party_types text[] DEFAULT NULL::text[], p_vibe_tags text[] DEFAULT NULL::text[], p_music_genres text[] DEFAULT NULL::text[], p_center_lng double precision DEFAULT NULL::double precision, p_center_lat double precision DEFAULT NULL::double precision, p_radius_km double precision DEFAULT NULL::double precision)
 RETURNS SETOF jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT jsonb_build_object(
    'id',e.id,'brand_id',e.brand_id,'title',e.title,'description',e.description,'slug',e.slug,
    'location_text',CASE WHEN public.issue_2489_address_withheld(e.theme) THEN NULL ELSE e.location_text END,
    'location_geo',CASE WHEN public.issue_2489_address_withheld(e.theme) THEN NULL ELSE to_jsonb(e.location_geo) END,
    'online_url',e.online_url,'is_online',e.is_online,'cover_media_url',e.cover_media_url,
    'cover_media_type',e.cover_media_type,'theme',public.issue_2489_public_theme(e.theme),
    'timezone',e.timezone,'currency',e.currency,'city',e.city,'party_types',to_jsonb(e.party_types),
    'vibe_tags',to_jsonb(e.vibe_tags),'music_genres',to_jsonb(e.music_genres),'event_type',e.event_type,
    'brand_slug',b.slug,'brand_name',b.name,'brand_profile_photo_url',b.profile_photo_url,
    'master_start_at',ed.start_at,'master_end_at',ed.end_at,'master_timezone',ed.timezone,
    -- Window-selected occurrence is the card timestamp authority (#3281 PR7).
    -- Do NOT run the full schedule helper here: this base feeds eligibility,
    -- facets, and counts before pagination (same page-only rule as admin_list).
    'next_start_at',ed.start_at,
    'next_end_at',ed.end_at,
    'upcoming_count',NULL,
    'schedule_line',NULL,
    'price_min_cents',(SELECT min(tt.price_cents) FROM public.ticket_types tt
      WHERE tt.event_id=e.id AND tt.deleted_at IS NULL AND tt.is_hidden IS NOT TRUE
        AND tt.is_disabled IS NOT TRUE AND tt.price_cents IS NOT NULL),
    'price_max_cents',(SELECT max(tt.price_cents) FROM public.ticket_types tt
      WHERE tt.event_id=e.id AND tt.deleted_at IS NULL AND tt.is_hidden IS NOT TRUE
        AND tt.is_disabled IS NOT TRUE AND tt.price_cents IS NOT NULL),
    'display_price_cents',public.discover_v2_from_price_minor(e.id),
    'pricing_currency',b.pricing_currency
  )
  FROM public.events e
  JOIN public.brands b ON b.id=e.brand_id AND b.deleted_at IS NULL
  JOIN public.event_dates master_ed ON master_ed.event_id=e.id
    AND master_ed.is_master IS TRUE
  JOIN LATERAL (
    SELECT occurrence.start_at,occurrence.end_at,occurrence.timezone
    FROM public.event_dates occurrence
    WHERE occurrence.event_id=e.id AND occurrence.end_at>=p_lower_bound
      AND (p_upper_start IS NULL OR occurrence.start_at<=p_upper_start)
      -- #3281: a ticketed event is listed only on a date a guest can buy.
      -- Inside the LATERAL, so a sold-out or closed date moves the card to the
      -- next buyable one instead of hiding the whole series.
      AND public.issue_3281_explorer_date_listable(e.id,occurrence.id)
    ORDER BY occurrence.start_at,occurrence.id LIMIT 1
  ) ed ON true
  WHERE e.deleted_at IS NULL
    AND public.issue_4174_explorer_brand_visible(e.brand_id)
    AND e.visibility='public'
    AND (e.event_type='event' OR (e.event_type='rsvp' AND e.rsvp_discoverable=true))
    AND e.status=ANY(ARRAY['scheduled','live'])
    AND NOT public.issue_1931_event_ordinary_read_blocked(e.id)
    AND (
      e.city=ANY(p_cities)
      OR (p_center_lng IS NOT NULL AND p_center_lat IS NOT NULL AND p_radius_km IS NOT NULL
        AND e.location_geo IS NOT NULL AND public.ST_DWithin(
          public.ST_SetSRID(e.location_geo::public.geometry,4326)::public.geography,
          public.ST_SetSRID(public.ST_MakePoint(p_center_lng,p_center_lat),4326)::public.geography,
          p_radius_km*1000))
      OR (e.is_online IS TRUE AND lower(btrim(COALESCE(e.theme->'business_event'->>'format',''),
        E' \t\n\r\f\v'||chr(160)))='online')
    )
    AND (p_party_types IS NULL OR cardinality(p_party_types)=0 OR e.party_types && p_party_types)
    AND (p_vibe_tags IS NULL OR cardinality(p_vibe_tags)=0 OR e.vibe_tags && p_vibe_tags)
    AND (p_music_genres IS NULL OR cardinality(p_music_genres)=0 OR e.music_genres && p_music_genres)
    AND NOT (
      EXISTS (SELECT 1 FROM public.ticket_types tt WHERE tt.event_id=e.id
        AND tt.deleted_at IS NULL AND tt.is_hidden IS NOT TRUE AND tt.is_disabled IS NOT TRUE
        AND tt.available_online IS TRUE AND tt.price_cents>0)
      AND NOT public.pg_brand_can_collect(e.brand_id)
    )
$function$;

CREATE OR REPLACE FUNCTION public.discover_v2_items(p_kind text, p_city_names text[], p_lat double precision, p_lng double precision, p_radius_km double precision, p_tz text, p_filters jsonb, p_offset integer, p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_rows jsonb:='[]'::jsonb; v_total bigint:=0; v_window tstzrange;
  v_meta jsonb:='{}'::jsonb; v_guests integer:=COALESCE((p_filters->>'guests')::integer,2);
BEGIN
  IF p_kind NOT IN ('events','experiences','trips','stays') THEN
    RAISE EXCEPTION 'invalid_kind' USING ERRCODE='22023';
  END IF;

  IF p_kind='events' THEN
    v_window:=public.discover_v2_window(COALESCE(NULLIF(p_filters->>'when',''),'tm_horizon_120'),p_tz,now());
    WITH base AS MATERIALIZED (
      SELECT row FROM public.discover_v2_event_base(
        p_city_names,now(),NULL,
        ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_filters->'partyTypes','[]'::jsonb))),
        ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_filters->'vibeTags','[]'::jsonb))),
        ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_filters->'musicGenres','[]'::jsonb))),
        p_lng,p_lat,public.discover_v2_radius_km('events')) AS event_base(row)
    ), eligible AS MATERIALIZED (
      SELECT b.row,occ.start_at,occ.end_at,occ.timezone,
        display.display_sale_price_cents sale_minor,display.display_sale_ends_at sale_ends_at,
        count(*) over() total_count
      FROM base b
      JOIN LATERAL (
        SELECT ed.start_at,ed.end_at,ed.timezone FROM public.event_dates ed
        WHERE ed.event_id=(b.row->>'id')::uuid AND ed.end_at>=now()
          AND ed.start_at>=lower(v_window) AND ed.start_at<upper(v_window)
          -- #3281: the card's date is a date a guest can buy (same rule as the base).
          AND public.issue_3281_explorer_date_listable((b.row->>'id')::uuid,ed.id)
        ORDER BY ed.start_at,ed.id LIMIT 1
      ) occ ON true
      CROSS JOIN LATERAL public.issue_3872_event_display_prices((b.row->>'id')::uuid) display
      WHERE public.discover_v2_price_matches('events',b.row->>'event_type',
        COALESCE(b.row->>'pricing_currency',b.row->>'currency'),
        NULLIF(b.row->>'display_price_cents','')::integer,
        COALESCE(NULLIF(b.row->>'price_min_cents','')::integer=0,false),p_filters)
      ORDER BY occ.start_at,(b.row->>'id')::uuid
      OFFSET greatest(p_offset,0) LIMIT least(greatest(p_limit,1),50)
    )
    SELECT COALESCE(max(total_count),0),COALESCE(jsonb_agg(jsonb_build_object(
      'source','mingla','kind',CASE WHEN row->>'event_type'='rsvp' THEN 'rsvp' ELSE 'event' END,'id',row->>'id',
      'brand',jsonb_build_object('id',row->>'brand_id','slug',row->>'brand_slug','name',row->>'brand_name','photoUrl',row->>'brand_profile_photo_url'),
      'title',row->>'title','coverUrl',row->>'cover_media_url','coverType',row->>'cover_media_type','coverHue',24,
      'startsAtUtc',start_at,'endsAtUtc',end_at,'timezone',COALESCE(timezone,row->>'timezone','UTC'),
      'meta',jsonb_build_object('venueOrPlace',row->>'location_text'),
      'price',jsonb_build_object('currency',COALESCE(row->>'pricing_currency',row->>'currency'),
        'listMinor',NULLIF(row->>'display_price_cents','')::integer,'saleMinor',sale_minor,'saleEndsAt',sale_ends_at,
        'isFree',row->>'event_type'='rsvp' OR COALESCE(NULLIF(row->>'price_min_cents','')::integer=0,false),'unit','each'),
      'route',jsonb_build_object('pathname',CASE WHEN row->>'event_type'='rsvp' THEN '/rsvp/[slug]' ELSE '/event/[slug]' END,
        'params',jsonb_build_object('slug',row->>'slug'))
    ) ORDER BY start_at,(row->>'id')::uuid),'[]'::jsonb) INTO v_total,v_rows FROM eligible;

  ELSIF p_kind='experiences' THEN
    v_window:=public.discover_v2_window(COALESCE(NULLIF(p_filters->>'when',''),'tm_horizon_120'),p_tz,now());
    WITH eligible_all AS MATERIALIZED (
      SELECT e.id,e.slug,e.brand_id,e.title,e.cover_media_url,e.cover_media_type,e.timezone,e.currency,
        b.slug brand_slug,b.name brand_name,b.profile_photo_url,
        occ.start_at,occ.end_at,occ.timezone occurrence_timezone,
        public.discover_v2_from_price_minor(e.id) price_minor,
        display.display_sale_price_cents sale_minor,display.display_sale_ends_at sale_ends_at,
        EXISTS(SELECT 1 FROM public.ticket_types ft WHERE ft.event_id=e.id AND ft.deleted_at IS NULL
          AND ft.is_hidden IS NOT TRUE AND ft.is_disabled IS NOT TRUE AND ft.available_online IS TRUE AND ft.price_cents=0) has_free,
        (SELECT count(*) FROM public.experience_stops cs WHERE cs.event_id=e.id) stop_count,
        (SELECT cs.place_name FROM public.experience_stops cs WHERE cs.event_id=e.id ORDER BY cs.stop_order LIMIT 1) first_place
      FROM public.events e JOIN public.brands b ON b.id=e.brand_id AND b.deleted_at IS NULL
      JOIN LATERAL (SELECT ed.start_at,ed.end_at,ed.timezone FROM public.event_dates ed
        WHERE ed.event_id=e.id AND ed.end_at>now() AND ed.start_at>=lower(v_window) AND ed.start_at<upper(v_window)
        ORDER BY ed.start_at,ed.id LIMIT 1) occ ON true
      CROSS JOIN LATERAL public.issue_3872_event_display_prices(e.id) display
      WHERE public.issue_4174_explorer_brand_visible(e.brand_id)
        AND e.event_type='experience' AND e.visibility='public' AND e.status='scheduled'
        AND e.published_at IS NOT NULL AND e.deleted_at IS NULL
        AND cardinality(e.experience_intents)>0
        AND NOT public.issue_1931_event_ordinary_read_blocked(e.id)
        AND EXISTS (SELECT 1 FROM public.ticket_types tt WHERE tt.event_id=e.id
          AND tt.available_online IS TRUE AND tt.deleted_at IS NULL AND tt.is_hidden IS NOT TRUE
          AND tt.is_disabled IS NOT TRUE AND (tt.is_unlimited OR tt.quantity_total IS NULL OR tt.quantity_total>
            (SELECT count(*) FROM public.tickets sold WHERE sold.ticket_type_id=tt.id AND sold.status IN ('valid','used','transferred'))))
        AND (NOT EXISTS(SELECT 1 FROM public.ticket_types tt WHERE tt.event_id=e.id AND tt.available_online IS TRUE
              AND tt.deleted_at IS NULL AND tt.is_hidden IS NOT TRUE AND tt.is_disabled IS NOT TRUE AND tt.price_cents>0)
          OR public.pg_brand_can_collect(e.brand_id))
        AND (COALESCE(jsonb_array_length(COALESCE(p_filters->'goodFor','[]'::jsonb)),0)=0
          OR e.experience_intents && ARRAY(SELECT jsonb_array_elements_text(p_filters->'goodFor')))
        AND (
          EXISTS (SELECT 1 FROM public.experience_stops s WHERE s.event_id=e.id AND s.lat IS NOT NULL AND s.lng IS NOT NULL
            AND 6371.0*2.0*asin(sqrt(power(sin(radians(s.lat-p_lat)/2.0),2)+
              cos(radians(p_lat))*cos(radians(s.lat))*power(sin(radians(s.lng-p_lng)/2.0),2)))
              <= public.discover_v2_radius_km('experiences'))
          OR (SELECT s.city FROM public.experience_stops s WHERE s.event_id=e.id ORDER BY s.stop_order,s.id LIMIT 1)=ANY(p_city_names)
        )
        AND public.discover_v2_price_matches('experiences','experience',e.currency,
          public.discover_v2_from_price_minor(e.id),
          EXISTS(SELECT 1 FROM public.ticket_types ft WHERE ft.event_id=e.id AND ft.deleted_at IS NULL
            AND ft.is_hidden IS NOT TRUE AND ft.is_disabled IS NOT TRUE AND ft.available_online IS TRUE AND ft.price_cents=0),p_filters)
    ), eligible AS (
      SELECT *,count(*) over() total_count FROM eligible_all
      ORDER BY start_at,id OFFSET greatest(p_offset,0) LIMIT least(greatest(p_limit,1),50)
    )
    SELECT COALESCE(max(total_count),0),COALESCE(jsonb_agg(jsonb_build_object(
      'source','mingla','kind','experience','id',id,'brand',jsonb_build_object('id',brand_id,'slug',brand_slug,'name',brand_name,'photoUrl',profile_photo_url),
      'title',title,'coverUrl',cover_media_url,'coverType',cover_media_type,'coverHue',274,
      'startsAtUtc',start_at,'endsAtUtc',end_at,'timezone',COALESCE(occurrence_timezone,timezone,'UTC'),
      'meta',jsonb_build_object('venueOrPlace',first_place,'stops',stop_count),
      'price',jsonb_build_object('currency',currency,'listMinor',price_minor,'saleMinor',sale_minor,'saleEndsAt',sale_ends_at,'isFree',has_free,'unit','each'),
      'route',jsonb_build_object('pathname','/experience/[slug]','params',jsonb_build_object('slug',slug))
    ) ORDER BY start_at,id),'[]'::jsonb) INTO v_total,v_rows FROM eligible;

  ELSIF p_kind='trips' THEN
    WITH eligible_all AS MATERIALIZED (
      SELECT e.id,e.slug,e.brand_id,e.title,e.destination_text,e.departure_text,e.cover_media_url,e.cover_media_type,
        e.timezone,e.currency,e.destination_place_key,e.destination_city,e.destination_country_code,
        e.departure_place_key,e.departure_city,e.departure_country_code,b.slug brand_slug,b.name brand_name,b.profile_photo_url,
        ed.start_at,ed.end_at,public.discover_v2_from_price_minor(e.id) price_minor,
        display.display_sale_price_cents sale_minor,display.display_sale_ends_at sale_ends_at
      FROM public.events e JOIN public.brands b ON b.id=e.brand_id AND b.deleted_at IS NULL
      JOIN public.event_dates ed ON ed.event_id=e.id AND ed.is_master IS TRUE AND ed.end_at>=now()
      CROSS JOIN LATERAL public.issue_3872_event_display_prices(e.id) display
      WHERE public.issue_4174_explorer_brand_visible(e.brand_id)
        AND e.event_type='trip' AND e.visibility='public' AND e.status IN ('scheduled','live') AND e.deleted_at IS NULL
        AND COALESCE(e.bookings_closed,false)=false AND (e.booking_deadline IS NULL OR e.booking_deadline>=now())
        AND EXISTS (SELECT 1 FROM public.trip_pricing_tiers tpt JOIN public.ticket_types tt ON tt.id=tpt.ticket_type_id
          WHERE tpt.event_id=e.id AND tt.deleted_at IS NULL AND COALESCE(tt.is_hidden,false)=false)
        AND (NULLIF(p_filters->>'_countryCode','') IS NULL
          OR upper(COALESCE(e.departure_country_code::text,b.country_code))=upper(p_filters->>'_countryCode'))
        AND (NULLIF(p_filters->>'destination','') IS NULL OR e.destination_place_key=p_filters->>'destination')
        AND (NULLIF(p_filters->>'leavingFrom','') IS NULL OR e.departure_place_key=p_filters->>'leavingFrom')
        AND (NULLIF(p_filters->>'when','') IS NULL OR ed.start_at<@public.discover_v2_window(p_filters->>'when',p_tz,now()))
    ), eligible AS (
      SELECT *,count(*) over() total_count FROM eligible_all ORDER BY start_at,id
      OFFSET greatest(p_offset,0) LIMIT least(greatest(p_limit,1),50)
    )
    SELECT COALESCE(max(total_count),0),COALESCE(jsonb_agg(jsonb_build_object(
      'source','mingla','kind','trip','id',id,'brand',jsonb_build_object('id',brand_id,'slug',brand_slug,'name',brand_name,'photoUrl',profile_photo_url),
      'title',title,'coverUrl',cover_media_url,'coverType',cover_media_type,'coverHue',194,'startsAtUtc',start_at,'endsAtUtc',end_at,'timezone',timezone,
      'meta',jsonb_build_object('venueOrPlace',destination_text),'price',jsonb_build_object('currency',currency,'listMinor',price_minor,'saleMinor',sale_minor,'saleEndsAt',sale_ends_at,'isFree',price_minor IS NULL,'unit','each'),
      'route',jsonb_build_object('pathname','/trip/[slug]','params',jsonb_build_object('slug',slug))
    ) ORDER BY start_at,id),'[]'::jsonb) INTO v_total,v_rows FROM eligible;
    WITH candidates AS (
      SELECT e.destination_place_key id,concat_ws(', ',e.destination_city,e.destination_country_code) label,'destination' side
      FROM public.events e JOIN public.brands b ON b.id=e.brand_id AND b.deleted_at IS NULL
      WHERE public.issue_4174_explorer_brand_visible(e.brand_id)
        AND e.event_type='trip' AND e.visibility='public' AND e.status IN ('scheduled','live') AND e.deleted_at IS NULL
        AND e.destination_place_key IS NOT NULL AND COALESCE(e.bookings_closed,false)=false
        AND (e.booking_deadline IS NULL OR e.booking_deadline>=now())
        AND (NULLIF(p_filters->>'_countryCode','') IS NULL OR upper(COALESCE(e.departure_country_code::text,b.country_code))=upper(p_filters->>'_countryCode'))
      UNION ALL
      SELECT e.departure_place_key,concat_ws(', ',e.departure_city,e.departure_country_code),'leavingFrom'
      FROM public.events e JOIN public.brands b ON b.id=e.brand_id AND b.deleted_at IS NULL
      WHERE public.issue_4174_explorer_brand_visible(e.brand_id)
        AND e.event_type='trip' AND e.visibility='public' AND e.status IN ('scheduled','live') AND e.deleted_at IS NULL
        AND e.departure_place_key IS NOT NULL AND COALESCE(e.bookings_closed,false)=false
        AND (e.booking_deadline IS NULL OR e.booking_deadline>=now())
        AND (NULLIF(p_filters->>'_countryCode','') IS NULL OR upper(COALESCE(e.departure_country_code::text,b.country_code))=upper(p_filters->>'_countryCode'))
    ) SELECT jsonb_build_object(
      'destination',COALESCE(jsonb_agg(DISTINCT jsonb_build_object('id',id,'label',label)) FILTER(WHERE side='destination'),'[]'::jsonb),
      'leavingFrom',COALESCE(jsonb_agg(DISTINCT jsonb_build_object('id',id,'label',label)) FILTER(WHERE side='leavingFrom'),'[]'::jsonb))
      INTO v_meta FROM candidates;

  ELSE
    WITH eligible_rooms AS MATERIALIZED (
      SELECT venue.id venue_id,venue.brand_id,venue.brand_slug,venue.brand_name,venue.slug venue_slug,venue.name venue_name,
        venue.city,venue.cover_media_url,venue.cover_media_type,venue.default_currency,venue.created_at,
        settings.property_kind,settings.timezone,offering.id offering_id,price.amount_minor,
        media.storage_object_name cover_path,
        greatest(1,ceil(v_guests::numeric/greatest(offering.max_guests,1)))::integer required_rooms,
        CASE WHEN NULLIF(p_filters->>'checkIn','') IS NULL THEN NULL ELSE
          (lower(public.discover_v2_window('checkin_'||(p_filters->>'checkIn'),settings.timezone,now())) AT TIME ZONE settings.timezone)::date END check_in,
        CASE WHEN NULLIF(p_filters->>'checkIn','') IS NULL THEN NULL ELSE
          (upper(public.discover_v2_window('checkin_'||(p_filters->>'checkIn'),settings.timezone,now())) AT TIME ZONE settings.timezone)::date END check_out
      FROM public.venue_public_view venue
      JOIN public.stay_settings settings ON settings.venue_id=venue.id AND settings.brand_id=venue.brand_id
        AND settings.booking_state='active'
      JOIN public.stay_offerings offering ON offering.venue_id=venue.id AND offering.brand_id=venue.brand_id
        AND offering.kind='room' AND offering.status='live'
      JOIN public.stay_price_versions price ON price.offering_id=offering.id AND price.brand_id=venue.brand_id
        AND price.venue_id=venue.id AND price.effective_to IS NULL AND price.pricing_unit='room_night'
        AND price.currency_code::text=venue.default_currency
      JOIN public.stay_policy_versions policy ON policy.offering_id=offering.id AND policy.brand_id=venue.brand_id
        AND policy.venue_id=venue.id AND policy.effective_to IS NULL
      JOIN public.stay_offering_media media ON media.offering_id=offering.id AND media.brand_id=venue.brand_id
        AND media.venue_id=venue.id AND media.is_cover AND media.status='ready'
      WHERE public.issue_4174_explorer_brand_visible(venue.brand_id)
        AND venue.venue_category='stay' AND settings.property_kind IS NOT NULL
        AND COALESCE((SELECT is_enabled FROM public.feature_flags WHERE flag_key='STAY_PUBLIC_PAGES'),false)
        AND (venue.city=ANY(p_city_names) OR (venue.lat IS NOT NULL AND venue.lng IS NOT NULL AND
          6371.0*2.0*asin(sqrt(power(sin(radians(venue.lat-p_lat)/2.0),2)+cos(radians(p_lat))*cos(radians(venue.lat))*power(sin(radians(venue.lng-p_lng)/2.0),2)))
            <=public.discover_v2_radius_km('stays')))
        AND (COALESCE(jsonb_array_length(COALESCE(p_filters->'propertyKinds','[]'::jsonb)),0)=0
          OR settings.property_kind IN (SELECT jsonb_array_elements_text(p_filters->'propertyKinds')))
        AND offering.min_guests*greatest(1,ceil(v_guests::numeric/greatest(offering.max_guests,1)))<=v_guests
        AND offering.max_guests*greatest(1,ceil(v_guests::numeric/greatest(offering.max_guests,1)))>=v_guests
    ), available AS MATERIALIZED (
      SELECT * FROM eligible_rooms r WHERE public.discover_v2_stay_room_available(r.offering_id,r.check_in,r.check_out,r.required_rooms)
    ), properties AS MATERIALIZED (
      SELECT venue_id,brand_id,brand_slug,brand_name,venue_slug,venue_name,city,cover_media_url,cover_media_type,
        default_currency,created_at,property_kind,timezone,min(amount_minor) amount_minor,
        (array_agg(cover_path ORDER BY amount_minor,offering_id))[1] cover_path
      FROM available GROUP BY venue_id,brand_id,brand_slug,brand_name,venue_slug,venue_name,city,
        cover_media_url,cover_media_type,default_currency,created_at,property_kind,timezone
    ), eligible AS (
      SELECT *,count(*) over() total_count FROM properties ORDER BY created_at DESC,venue_id
      OFFSET greatest(p_offset,0) LIMIT least(greatest(p_limit,1),50)
    )
    SELECT COALESCE(max(total_count),0),COALESCE(jsonb_agg(jsonb_build_object(
      'source','mingla','kind','stay','id',venue_id,'brand',jsonb_build_object('id',brand_id,'slug',brand_slug,'name',brand_name,'photoUrl',NULL),
      'title',venue_name,'coverUrl',COALESCE(cover_media_url,cover_path),'coverType',COALESCE(cover_media_type,'image'),'coverHue',140,
      'startsAtUtc',NULL,'endsAtUtc',NULL,'timezone',COALESCE(timezone,'UTC'),'meta',jsonb_build_object('venueOrPlace',city),
      'price',jsonb_build_object('currency',default_currency,'listMinor',amount_minor,'saleMinor',NULL,'saleEndsAt',NULL,'isFree',false,'unit','per_night'),
      'route',jsonb_build_object('pathname','/stay/[slug]','params',jsonb_build_object('slug',venue_slug))
    ) ORDER BY created_at DESC,venue_id),'[]'::jsonb) INTO v_total,v_rows FROM eligible;
  END IF;
  RETURN jsonb_build_object('items',v_rows,'total',v_total,'facetOptions',v_meta);
END;
$function$;

CREATE OR REPLACE FUNCTION public.discover_v2_nearest_city(p_lat double precision, p_lng double precision)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  WITH eligible AS (
    SELECT concat_ws(', ',e.city,b.country_code) label,(e.location_geo)[1]::float8 lat,(e.location_geo)[0]::float8 lng,e.id::text item_id
    FROM public.events e JOIN public.brands b ON b.id=e.brand_id AND b.deleted_at IS NULL
    WHERE e.deleted_at IS NULL
      AND public.issue_4174_explorer_brand_visible(e.brand_id) AND e.visibility='public' AND e.status IN ('scheduled','live')
      AND e.city IS NOT NULL AND e.location_geo IS NOT NULL
      AND EXISTS(SELECT 1 FROM public.event_dates ed WHERE ed.event_id=e.id AND ed.is_master IS TRUE AND ed.end_at>=now())
      AND (e.event_type='event' OR (e.event_type='rsvp' AND e.rsvp_discoverable=true))
      AND NOT public.issue_1931_event_ordinary_read_blocked(e.id)
      AND (NOT EXISTS(SELECT 1 FROM public.ticket_types tt WHERE tt.event_id=e.id AND tt.available_online IS TRUE
        AND tt.deleted_at IS NULL AND tt.is_hidden IS NOT TRUE AND tt.is_disabled IS NOT TRUE AND tt.price_cents>0)
        OR public.pg_brand_can_collect(e.brand_id))
      -- #3281: never point a guest at a city whose only events cannot be bought.
      AND EXISTS(SELECT 1 FROM public.event_dates listable WHERE listable.event_id=e.id
        AND listable.end_at>=now() AND public.issue_3281_explorer_date_listable(e.id,listable.id))
    UNION ALL
    SELECT concat_ws(', ',e.city,b.country_code),(e.location_geo)[1]::float8,(e.location_geo)[0]::float8,e.id::text
    FROM public.events e JOIN public.brands b ON b.id=e.brand_id AND b.deleted_at IS NULL
    WHERE public.issue_4174_explorer_brand_visible(e.brand_id)
      AND e.event_type='trip' AND e.visibility='public' AND e.status IN ('scheduled','live') AND e.deleted_at IS NULL
      AND e.city IS NOT NULL AND e.location_geo IS NOT NULL
      AND COALESCE(e.bookings_closed,false)=false AND (e.booking_deadline IS NULL OR e.booking_deadline>=now())
      AND EXISTS(SELECT 1 FROM public.event_dates ed WHERE ed.event_id=e.id AND ed.is_master IS TRUE AND ed.end_at>=now())
      AND EXISTS(SELECT 1 FROM public.trip_pricing_tiers tpt JOIN public.ticket_types tt ON tt.id=tpt.ticket_type_id
        WHERE tpt.event_id=e.id AND tt.deleted_at IS NULL AND COALESCE(tt.is_hidden,false)=false)
    UNION ALL
    SELECT concat_ws(', ',s.city,s.country_code),s.lat,s.lng,e.id::text FROM public.events e
      JOIN public.brands b ON b.id=e.brand_id AND b.deleted_at IS NULL
      JOIN public.experience_stops s ON s.event_id=e.id
    WHERE public.issue_4174_explorer_brand_visible(e.brand_id)
      AND e.event_type='experience' AND e.visibility='public' AND e.status='scheduled'
      AND e.published_at IS NOT NULL AND e.deleted_at IS NULL AND cardinality(e.experience_intents)>0
      AND s.city IS NOT NULL AND s.lat IS NOT NULL AND s.lng IS NOT NULL
      AND EXISTS(SELECT 1 FROM public.event_dates ed WHERE ed.event_id=e.id AND ed.end_at>=now())
      AND NOT public.issue_1931_event_ordinary_read_blocked(e.id)
      AND EXISTS(SELECT 1 FROM public.ticket_types tt WHERE tt.event_id=e.id AND tt.available_online IS TRUE
        AND tt.deleted_at IS NULL AND tt.is_hidden IS NOT TRUE AND tt.is_disabled IS NOT TRUE
        AND (tt.is_unlimited OR tt.quantity_total IS NULL OR tt.quantity_total>
          (SELECT count(*) FROM public.tickets sold WHERE sold.ticket_type_id=tt.id AND sold.status IN ('valid','used','transferred'))))
      AND (NOT EXISTS(SELECT 1 FROM public.ticket_types tt WHERE tt.event_id=e.id AND tt.available_online IS TRUE
            AND tt.deleted_at IS NULL AND tt.is_hidden IS NOT TRUE AND tt.is_disabled IS NOT TRUE AND tt.price_cents>0)
        OR public.pg_brand_can_collect(e.brand_id))
    UNION ALL
    SELECT concat_ws(', ',v.city,v.country_code),v.lat,v.lng,v.id::text FROM public.venue_public_view v
      JOIN public.stay_settings ss ON ss.venue_id=v.id AND ss.booking_state='active'
      JOIN public.stay_offerings so ON so.venue_id=v.id AND so.brand_id=v.brand_id AND so.status='live' AND so.kind='room'
      JOIN public.stay_price_versions spv ON spv.offering_id=so.id AND spv.brand_id=v.brand_id
        AND spv.venue_id=v.id AND spv.effective_to IS NULL AND spv.pricing_unit='room_night'
      JOIN public.stay_policy_versions policy ON policy.offering_id=so.id AND policy.brand_id=v.brand_id
        AND policy.venue_id=v.id AND policy.effective_to IS NULL
      JOIN public.stay_offering_media media ON media.offering_id=so.id AND media.brand_id=v.brand_id
        AND media.venue_id=v.id AND media.is_cover AND media.status='ready'
    WHERE public.issue_4174_explorer_brand_visible(v.brand_id)
      AND v.venue_category='stay' AND v.city IS NOT NULL AND v.lat IS NOT NULL AND v.lng IS NOT NULL
      AND COALESCE((SELECT is_enabled FROM public.feature_flags WHERE flag_key='STAY_PUBLIC_PAGES'),false)
      AND EXISTS(SELECT 1 FROM public.stay_room_nights night
        WHERE night.offering_id=so.id AND night.local_date>=(now() AT TIME ZONE ss.timezone)::date
          AND NOT night.stop_sell AND night.sellable_quantity>0)
  ), measured AS (
    SELECT label,lat,lng,item_id,
      6371.0*2.0*asin(sqrt(power(sin(radians(lat-p_lat)/2.0),2)+
        cos(radians(p_lat))*cos(radians(lat))*power(sin(radians(lng-p_lng)/2.0),2))) distance_km
    FROM eligible WHERE label IS NOT NULL
  ), cities AS (
    SELECT label,(array_agg(lat ORDER BY distance_km))[1] lat,(array_agg(lng ORDER BY distance_km))[1] lng,
      count(DISTINCT item_id) total,min(distance_km) distance_km
    FROM measured WHERE distance_km<=500 GROUP BY label
  ) SELECT jsonb_build_object('label',label,'lat',lat,'lng',lng,'total',total)
    FROM cities ORDER BY distance_km,label LIMIT 1
$function$;

-- CREATE OR REPLACE keeps owner and grants; restate the readers' grants so a
-- replay from baseline lands on the same ACL (postgres + service_role only).
REVOKE ALL ON FUNCTION public.discover_v2_event_base(text[],timestamptz,timestamptz,text[],text[],text[],float8,float8,float8) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.discover_v2_items(text,text[],float8,float8,float8,text,jsonb,integer,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.discover_v2_nearest_city(float8,float8) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.discover_v2_event_base(text[],timestamptz,timestamptz,text[],text[],text[],float8,float8,float8) TO service_role;
GRANT EXECUTE ON FUNCTION public.discover_v2_items(text,text[],float8,float8,float8,text,jsonb,integer,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.discover_v2_nearest_city(float8,float8) TO service_role;

DO $verify$
BEGIN
  IF position('issue_3281_explorer_date_listable' IN pg_get_functiondef(
       'public.discover_v2_event_base(text[],timestamptz,timestamptz,text[],text[],text[],float8,float8,float8)'::regprocedure)) = 0
     OR position('issue_3281_explorer_date_listable' IN pg_get_functiondef(
       'public.discover_v2_items(text,text[],float8,float8,float8,text,jsonb,integer,integer)'::regprocedure)) = 0
     OR position('issue_3281_explorer_date_listable' IN pg_get_functiondef(
       'public.discover_v2_nearest_city(float8,float8)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'issue_3281_explorer_hides_unbuyable: an Explorer event reader ignores buyability';
  END IF;
END;
$verify$;

NOTIFY pgrst, 'reload schema';

COMMIT;
