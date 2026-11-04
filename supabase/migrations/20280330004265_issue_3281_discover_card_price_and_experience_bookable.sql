-- issue #3281 — Discover card prices count only tickets a guest can buy on the
-- card's date, and an experience is listed only when it can be booked.
--
-- Before this migration:
--   * discover_v2_event_base priced the card (price_min_cents, price_max_cents,
--     display_price_cents via discover_v2_from_price_minor) over every visible
--     tier of the event, so a closed sale, a sold-out tier or a tier for another
--     date still set the "from" price, and a closed free tier made the card
--     "free" (price_min_cents = 0 drives isFree and the price filter).
--     discover_v2_items also took the sale price from
--     issue_3872_event_display_prices(event), which has the same gap.
--   * The experience branch of discover_v2_items listed an experience when any
--     online tier had lifetime places left: it ignored sale end, the date's or
--     start time's capacity (capacity_scope), holds, cancelled dates and the
--     booking notice; the card date was the first future date whatever its
--     state, and the free flag, fee gate and price used every online tier.
--
-- Now:
--   issue_3281_experience_date_bookable_ticket_types(event, date)
--       the tiers of an experience a guest can book on that date: listed
--       online, not hidden or disabled, sale not closed, date upcoming and not
--       cancelled, valid on the date, a start time left after the booking
--       notice, and places left by the event's capacity_scope: per_start asks
--       issue_3281_ticket_type_slot_taken per start time (stops at the first
--       open one), per_day (and day-limited tiers) issue_3313_ticket_type_
--       occurrence_taken once per tier, total compares sold_count. The same
--       counters checkout (issue_3872 create-session) refuses on.
--   issue_3281_discover_card_prices(event, date, experience, with_sale)
--       the card's price over the tiers buyable on that date: events use
--       issue_3281_date_buyable_ticket_types (the #3281 listing rule's tier
--       set); an event that sells no tier online keeps every visible tier, as
--       before. Experiences use the bookable set above. Returns min / max base
--       price, the all-in "from" price (discover_v2_from_price_minor's
--       formula), the sale price and its end (issue_3872_event_display_prices'
--       formula, only when with_sale), and whether a free tier is in the set.
-- Both are plain SQL set functions the planner inlines (STABLE, not SECURITY
-- DEFINER, no SET, not STRICT); EXECUTE for postgres and service_role only.
--
-- Readers (bodies are the 20280327003281 definitions except as listed):
--   discover_v2_event_base: the card-date LATERAL also returns the date id and
--     the three price keys come from the card price on that date. Same keys,
--     same order; pg_discover_business_events (V1) reads them unchanged.
--   discover_v2_items('events'): price, sale, free flag and price filter come
--     from the card price on the date the card shows (its window may pick a
--     later date than the base did).
--   discover_v2_items('experiences'): the card date is the first upcoming,
--     uncancelled date in the window with a bookable tier; price, sale, free
--     flag, fee gate and price filter use that date's bookable tiers.
-- discover_v2_from_price_minor and issue_3872_event_display_prices are not
-- changed: trips and the public event page still read them.

BEGIN;

CREATE OR REPLACE FUNCTION public.issue_3281_experience_date_bookable_ticket_types(
  p_event_id uuid, p_event_date_id uuid
) RETURNS TABLE(ticket_type_id uuid)
LANGUAGE sql
STABLE
AS $fn$
  SELECT tt.id
    FROM public.event_dates d
    JOIN public.events e ON e.id = d.event_id
    -- The guest's start grid: d.start_at + k * spacing, before d.end_at, no
    -- earlier than now + the booking notice (pg_experience_slot_availability).
    CROSS JOIN LATERAL (
      SELECT g.spacing,
             GREATEST(0, ceil(extract(epoch FROM
               now() + make_interval(mins => COALESCE(e.min_notice_minutes, 120)) - d.start_at)
               / (60 * g.spacing)))::integer AS first_k,
             ceil(extract(epoch FROM d.end_at - d.start_at) / (60 * g.spacing))::integer AS slot_count
        FROM (SELECT GREATEST(1, COALESCE(e.booking_spacing_minutes, 30))::integer AS spacing) g
    ) grid
    JOIN public.ticket_types tt ON tt.event_id = d.event_id
   WHERE d.id = p_event_date_id
     AND d.event_id = p_event_id
     AND d.cancelled_at IS NULL
     AND d.end_at > now()
     AND grid.first_k < grid.slot_count
     AND tt.deleted_at IS NULL
     AND tt.is_hidden IS NOT TRUE
     AND tt.is_disabled IS NOT TRUE
     AND tt.available_online IS TRUE
     AND (tt.sale_end_at IS NULL OR tt.sale_end_at > now())
     AND (tt.valid_occurrence_keys IS NULL OR d.occurrence_key = ANY (tt.valid_occurrence_keys))
     AND (
       tt.is_unlimited IS TRUE
       OR tt.quantity_total IS NULL
       OR CASE
         WHEN COALESCE(e.capacity_scope, 'total') = 'per_start' THEN
           (tt.valid_occurrence_keys IS NULL
             OR public.issue_3313_ticket_type_occurrence_taken(tt.id, d.id) < tt.quantity_total)
           AND EXISTS (
             SELECT 1 FROM generate_series(grid.first_k, grid.slot_count - 1) k
              WHERE public.issue_3281_ticket_type_slot_taken(
                      tt.id, d.id,
                      d.start_at + make_interval(mins => grid.spacing * k),
                      d.start_at + make_interval(mins => grid.spacing * (k + 1)),
                      NULL) < tt.quantity_total)
         WHEN COALESCE(e.capacity_scope, 'total') = 'per_day' OR tt.valid_occurrence_keys IS NOT NULL
         THEN public.issue_3313_ticket_type_occurrence_taken(tt.id, d.id) < tt.quantity_total
         ELSE COALESCE(tt.sold_count, 0) < tt.quantity_total
       END
     )
$fn$;

COMMENT ON FUNCTION public.issue_3281_experience_date_bookable_ticket_types(uuid, uuid) IS
  'issue #3281 — the tiers of an experience a guest can book on this date: listed online, not hidden or disabled, sale not closed, date upcoming and not cancelled, valid on the date, a start time left after the booking notice, and places left by capacity_scope (per start time, per day, or in total). Inlinable SQL.';

CREATE OR REPLACE FUNCTION public.issue_3281_discover_card_prices(
  p_event_id uuid, p_event_date_id uuid, p_experience boolean, p_with_sale boolean
) RETURNS TABLE(
  price_min_cents integer,
  price_max_cents integer,
  display_price_cents integer,
  display_sale_price_cents integer,
  display_sale_ends_at timestamptz,
  has_free boolean
)
LANGUAGE sql
STABLE
AS $fn$
  -- The card's tiers, enumerated once: the per-date counters run here only.
  -- MATERIALIZED so the planner cannot re-run this set per joined tier row.
  WITH ids AS MATERIALIZED (
        SELECT buyable.ticket_type_id
          FROM public.issue_3281_date_buyable_ticket_types(p_event_id, p_event_date_id) buyable
         WHERE NOT p_experience
        UNION ALL
        SELECT bookable.ticket_type_id
          FROM public.issue_3281_experience_date_bookable_ticket_types(p_event_id, p_event_date_id) bookable
         WHERE p_experience
        UNION ALL
        -- An event that sells no tier to guests online keeps every visible tier.
        SELECT visible.id
          FROM public.ticket_types visible
         WHERE NOT p_experience
           AND visible.event_id = p_event_id
           AND visible.deleted_at IS NULL
           AND visible.is_hidden IS NOT TRUE
           AND visible.is_disabled IS NOT TRUE
           AND NOT EXISTS (
             SELECT 1 FROM public.ticket_types online
              WHERE online.event_id = p_event_id
                AND online.deleted_at IS NULL
                AND online.is_hidden IS NOT TRUE
                AND online.is_disabled IS NOT TRUE
                AND online.available_online IS TRUE)
  ), card AS MATERIALIZED (
    SELECT tt.id, tt.price_cents, sale.sale_base_cents, sale.sale_ends_at
      FROM ids
      JOIN public.ticket_types tt ON tt.id = ids.ticket_type_id AND tt.event_id = p_event_id
      LEFT JOIN LATERAL (
        SELECT s.sale_base_cents, s.sale_ends_at
          FROM public.issue_3872_display_sale_unit(tt.id, now()) s
         WHERE p_with_sale AND tt.price_cents > 0
      ) sale ON true
     WHERE tt.price_cents IS NOT NULL
  ), fees AS MATERIALIZED (
    SELECT COALESCE(e.pass_mingla_fee, b.default_pass_mingla_fee) AS pass_mingla_fee,
           COALESCE(e.pass_service_fee, b.default_pass_service_fee) AS pass_service_fee,
           (SELECT r.effective_take_rate_bps FROM public.resolve_effective_take_rate_bps(b.id) r) AS take_rate_bps
      FROM public.events e
      JOIN public.brands b ON b.id = e.brand_id
     WHERE e.id = p_event_id
  ), priced AS (
    SELECT card.id,
           public.compute_all_in_cents(card.price_cents, f.pass_mingla_fee, f.pass_service_fee, f.take_rate_bps) AS list_all_in,
           CASE WHEN card.sale_base_cents IS NULL THEN NULL ELSE public.compute_all_in_cents(
             card.sale_base_cents, f.pass_mingla_fee, f.pass_service_fee, f.take_rate_bps) END AS sale_all_in,
           card.sale_ends_at
      FROM card CROSS JOIN fees f
     WHERE card.price_cents > 0
  ), bounds AS (
    SELECT min(list_all_in) AS list_min,
           min(COALESCE(sale_all_in, list_all_in)) AS effective_min,
           COALESCE(bool_or(sale_all_in IS NOT NULL), false) AS has_sale
      FROM priced
  )
  SELECT (SELECT min(card.price_cents) FROM card),
         (SELECT max(card.price_cents) FROM card),
         bounds.list_min,
         CASE WHEN bounds.has_sale AND bounds.effective_min < bounds.list_min THEN bounds.effective_min END,
         CASE WHEN bounds.has_sale AND bounds.effective_min < bounds.list_min THEN (
           SELECT p.sale_ends_at FROM priced p
            WHERE COALESCE(p.sale_all_in, p.list_all_in) = bounds.effective_min
            ORDER BY p.sale_ends_at ASC NULLS LAST, p.id
            LIMIT 1
         ) END,
         EXISTS (SELECT 1 FROM card WHERE card.price_cents = 0)
    FROM bounds
$fn$;

COMMENT ON FUNCTION public.issue_3281_discover_card_prices(uuid, uuid, boolean, boolean) IS
  'issue #3281 — a Discover card''s price on its date: min / max base price, all-in from price, sale price and end (when asked), and whether a free tier is in the set; over the tiers buyable on the date (issue_3281_date_buyable_ticket_types; every visible tier for an event that sells none online) or, for an experience, bookable on it. Inlinable SQL.';

ALTER FUNCTION public.issue_3281_experience_date_bookable_ticket_types(uuid, uuid) OWNER TO postgres;
ALTER FUNCTION public.issue_3281_discover_card_prices(uuid, uuid, boolean, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.issue_3281_experience_date_bookable_ticket_types(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_3281_discover_card_prices(uuid, uuid, boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3281_experience_date_bookable_ticket_types(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_3281_discover_card_prices(uuid, uuid, boolean, boolean) TO service_role;

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
    -- #3281: priced over the tiers a guest can buy on the card's date.
    'price_min_cents',card_price.price_min_cents,
    'price_max_cents',card_price.price_max_cents,
    'display_price_cents',card_price.display_price_cents,
    'pricing_currency',b.pricing_currency
  )
  FROM public.events e
  JOIN public.brands b ON b.id=e.brand_id AND b.deleted_at IS NULL
  JOIN public.event_dates master_ed ON master_ed.event_id=e.id
    AND master_ed.is_master IS TRUE
  JOIN LATERAL (
    SELECT walk.id,walk.start_at,walk.end_at,walk.timezone
    FROM (
    -- #3281: the dates in card order first (OFFSET 0 keeps the listing rule
    -- out of this scan), so LIMIT 1 below stops at the first buyable date
    -- instead of asking the rule on every date and sorting after.
    SELECT occurrence.id,occurrence.start_at,occurrence.end_at,occurrence.timezone
    FROM public.event_dates occurrence
    WHERE occurrence.event_id=e.id AND occurrence.end_at>=p_lower_bound
      AND (p_upper_start IS NULL OR occurrence.start_at<=p_upper_start)
    ORDER BY occurrence.start_at,occurrence.id OFFSET 0
    ) walk
    -- #3281: a ticketed event is listed only on a date a guest can buy.
    -- Inside the LATERAL, so a sold-out or closed date moves the card to the
    -- next buyable one instead of hiding the whole series.
    WHERE EXISTS (SELECT 1
      FROM public.issue_3281_explorer_date_listable_rows(e.id, walk.id))
    ORDER BY walk.start_at,walk.id LIMIT 1
  ) ed ON true
  CROSS JOIN LATERAL public.issue_3281_discover_card_prices(e.id, ed.id, false, false) card_price
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
        price.display_price_cents list_minor,price.price_min_cents price_min,
        price.display_sale_price_cents sale_minor,price.display_sale_ends_at sale_ends_at,
        count(*) over() total_count
      FROM base b
      JOIN LATERAL (
        SELECT walk.id,walk.start_at,walk.end_at,walk.timezone FROM (
        -- #3281: the window's dates in card order first (OFFSET 0 keeps the
        -- listing rule out of this scan); LIMIT 1 stops at the first buyable one.
        SELECT ed.id,ed.start_at,ed.end_at,ed.timezone FROM public.event_dates ed
        WHERE ed.event_id=(b.row->>'id')::uuid AND ed.end_at>=now()
          AND ed.start_at>=lower(v_window) AND ed.start_at<upper(v_window)
        ORDER BY ed.start_at,ed.id OFFSET 0
        ) walk
          -- #3281: the card's date is a date a guest can buy (same rule as the base).
        WHERE EXISTS (SELECT 1
            FROM public.issue_3281_explorer_date_listable_rows((b.row->>'id')::uuid, walk.id))
        ORDER BY walk.start_at,walk.id LIMIT 1
      ) occ ON true
      -- #3281: priced over the tiers a guest can buy on the date this card shows.
      CROSS JOIN LATERAL public.issue_3281_discover_card_prices((b.row->>'id')::uuid, occ.id, false, true) price
      WHERE public.discover_v2_price_matches('events',b.row->>'event_type',
        COALESCE(b.row->>'pricing_currency',b.row->>'currency'),
        price.display_price_cents,
        COALESCE(price.price_min_cents=0,false),p_filters)
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
        'listMinor',list_minor,'saleMinor',sale_minor,'saleEndsAt',sale_ends_at,
        'isFree',row->>'event_type'='rsvp' OR COALESCE(price_min=0,false),'unit','each'),
      'route',jsonb_build_object('pathname',CASE WHEN row->>'event_type'='rsvp' THEN '/rsvp/[slug]' ELSE '/event/[slug]' END,
        'params',jsonb_build_object('slug',row->>'slug'))
    ) ORDER BY start_at,(row->>'id')::uuid),'[]'::jsonb) INTO v_total,v_rows FROM eligible;

  ELSIF p_kind='experiences' THEN
    v_window:=public.discover_v2_window(COALESCE(NULLIF(p_filters->>'when',''),'tm_horizon_120'),p_tz,now());
    WITH eligible_all AS MATERIALIZED (
      SELECT e.id,e.slug,e.brand_id,e.title,e.cover_media_url,e.cover_media_type,e.timezone,e.currency,
        b.slug brand_slug,b.name brand_name,b.profile_photo_url,
        occ.start_at,occ.end_at,occ.timezone occurrence_timezone,
        price.display_price_cents price_minor,
        price.display_sale_price_cents sale_minor,price.display_sale_ends_at sale_ends_at,
        price.has_free,
        (SELECT count(*) FROM public.experience_stops cs WHERE cs.event_id=e.id) stop_count,
        (SELECT cs.place_name FROM public.experience_stops cs WHERE cs.event_id=e.id ORDER BY cs.stop_order LIMIT 1) first_place
      FROM public.events e JOIN public.brands b ON b.id=e.brand_id AND b.deleted_at IS NULL
      JOIN LATERAL (
        SELECT walk.id,walk.start_at,walk.end_at,walk.timezone FROM (
        -- #3281: the window's dates in card order first (OFFSET 0 keeps the
        -- booking check out of this scan); LIMIT 1 stops at the first bookable one.
        SELECT ed.id,ed.start_at,ed.end_at,ed.timezone FROM public.event_dates ed
        WHERE ed.event_id=e.id AND ed.end_at>now() AND ed.cancelled_at IS NULL
          AND ed.start_at>=lower(v_window) AND ed.start_at<upper(v_window)
        ORDER BY ed.start_at,ed.id OFFSET 0
        ) walk
        -- #3281: an experience is listed on a date a guest can book: a start time
        -- left, a tier on sale online with places on that date or start time.
        WHERE EXISTS (SELECT 1
            FROM public.issue_3281_experience_date_bookable_ticket_types(e.id, walk.id))
        ORDER BY walk.start_at,walk.id LIMIT 1
      ) occ ON true
      -- #3281: price, sale, free flag and fee gate read that date's bookable tiers.
      CROSS JOIN LATERAL public.issue_3281_discover_card_prices(e.id, occ.id, true, true) price
      WHERE public.issue_4174_explorer_brand_visible(e.brand_id)
        AND e.event_type='experience' AND e.visibility='public' AND e.status='scheduled'
        AND e.published_at IS NOT NULL AND e.deleted_at IS NULL
        AND cardinality(e.experience_intents)>0
        AND NOT public.issue_1931_event_ordinary_read_blocked(e.id)
        AND (price.display_price_cents IS NULL OR public.pg_brand_can_collect(e.brand_id))
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
          price.display_price_cents,price.has_free,p_filters)
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

-- CREATE OR REPLACE keeps owner and grants; restate the readers' grants so a
-- replay from baseline lands on the same ACL (postgres + service_role only).
REVOKE ALL ON FUNCTION public.discover_v2_event_base(text[],timestamptz,timestamptz,text[],text[],text[],float8,float8,float8) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.discover_v2_items(text,text[],float8,float8,float8,text,jsonb,integer,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.discover_v2_event_base(text[],timestamptz,timestamptz,text[],text[],text[],float8,float8,float8) TO service_role;
GRANT EXECUTE ON FUNCTION public.discover_v2_items(text,text[],float8,float8,float8,text,jsonb,integer,integer) TO service_role;

DO $verify$
DECLARE
  v_rule regprocedure;
  v_def text;
BEGIN
  v_def := pg_get_functiondef('public.discover_v2_event_base(text[],timestamptz,timestamptz,text[],text[],text[],float8,float8,float8)'::regprocedure);
  IF position('issue_3281_discover_card_prices(' IN v_def) = 0
     OR position('discover_v2_from_price_minor' IN v_def) > 0
     OR position('issue_3281_explorer_date_listable_rows(' IN v_def) = 0 THEN
    RAISE EXCEPTION 'issue_3281_discover_card_price: discover_v2_event_base does not price the card on its date';
  END IF;
  v_def := pg_get_functiondef('public.discover_v2_items(text,text[],float8,float8,float8,text,jsonb,integer,integer)'::regprocedure);
  IF position('issue_3281_discover_card_prices(' IN v_def) = 0
     OR position('issue_3281_experience_date_bookable_ticket_types(' IN v_def) = 0
     OR position('issue_3281_explorer_date_listable_rows(' IN v_def) = 0 THEN
    RAISE EXCEPTION 'issue_3281_discover_card_price: discover_v2_items does not price cards on their date or book experiences by date';
  END IF;
  -- The planner inlines a set-returning SQL function only when all of these hold.
  FOREACH v_rule IN ARRAY ARRAY[
    'public.issue_3281_experience_date_bookable_ticket_types(uuid,uuid)'::regprocedure,
    'public.issue_3281_discover_card_prices(uuid,uuid,boolean,boolean)'::regprocedure]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p
       WHERE p.oid = v_rule
         AND p.prolang = (SELECT l.oid FROM pg_catalog.pg_language l WHERE l.lanname = 'sql')
         AND p.prokind = 'f' AND p.proretset AND p.provolatile = 's'
         AND NOT p.prosecdef AND NOT p.proisstrict AND p.proconfig IS NULL
    ) THEN
      RAISE EXCEPTION 'issue_3281_discover_card_price: % is not inlinable', v_rule;
    END IF;
  END LOOP;
END;
$verify$;

NOTIFY pgrst, 'reload schema';

COMMIT;
