BEGIN;

CREATE OR REPLACE FUNCTION public.discover_v2_window(p_when text, p_tz text, p_now timestamptz DEFAULT now())
RETURNS tstzrange
LANGUAGE plpgsql STABLE
SET search_path = ''
AS $function$
DECLARE
  v_local timestamp := p_now AT TIME ZONE p_tz;
  v_start_local timestamp;
  v_end_local timestamp;
  v_days_to_friday integer;
BEGIN
  PERFORM pg_catalog.now() AT TIME ZONE p_tz;
  IF p_when = 'tomorrow' THEN
    v_start_local := date_trunc('day', v_local) + interval '1 day';
    v_end_local := v_start_local + interval '1 day';
  ELSIF p_when = 'weekend' THEN
    IF extract(isodow FROM v_local) = 5 AND v_local::time >= time '18:00' OR extract(isodow FROM v_local) IN (6, 7) THEN
      v_start_local := v_local;
      v_end_local := date_trunc('day', v_local) + ((8 - extract(isodow FROM v_local)::integer) * interval '1 day');
    ELSE
      v_days_to_friday := (5 - extract(isodow FROM v_local)::integer + 7) % 7;
      v_start_local := date_trunc('day', v_local) + v_days_to_friday * interval '1 day' + interval '18 hours';
      v_end_local := date_trunc('day', v_start_local) + interval '3 days';
    END IF;
  ELSIF p_when = 'this_month' THEN
    v_start_local := v_local;
    v_end_local := date_trunc('month', v_local) + interval '1 month';
  ELSIF p_when = 'next_month' THEN
    v_start_local := date_trunc('month', v_local) + interval '1 month';
    v_end_local := v_start_local + interval '1 month';
  ELSIF p_when = 'checkin_tonight' THEN
    v_start_local := date_trunc('day', v_local);
    v_end_local := v_start_local + interval '1 day';
  ELSIF p_when = 'checkin_tomorrow' THEN
    v_start_local := date_trunc('day', v_local) + interval '1 day';
    v_end_local := v_start_local + interval '1 day';
  ELSIF p_when = 'checkin_weekend' THEN
    IF extract(isodow FROM v_local) = 6 THEN
      v_start_local := date_trunc('day', v_local);
      v_end_local := v_start_local + interval '1 day';
    ELSE
      v_days_to_friday := CASE WHEN extract(isodow FROM v_local) = 7 THEN 5 ELSE 5 - extract(isodow FROM v_local)::integer END;
      v_start_local := date_trunc('day', v_local) + v_days_to_friday * interval '1 day';
      v_end_local := v_start_local + interval '2 days';
    END IF;
  ELSIF p_when = 'tm_horizon_120' THEN
    v_start_local := v_local;
    v_end_local := v_local + interval '120 days';
  ELSE
    RAISE EXCEPTION 'discover_invalid_window' USING ERRCODE = '22023';
  END IF;
  RETURN tstzrange(v_start_local AT TIME ZONE p_tz, v_end_local AT TIME ZONE p_tz, '[)');
EXCEPTION WHEN invalid_parameter_value THEN
  RAISE EXCEPTION 'discover_invalid_timezone' USING ERRCODE = '22023';
END;
$function$;

CREATE OR REPLACE FUNCTION public.discover_v2_city_key(p_name text, p_country_code text, p_lat float8, p_lng float8)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $function$
  SELECT CASE WHEN NULLIF(pg_catalog.btrim(p_name), '') IS NOT NULL AND NULLIF(pg_catalog.btrim(p_country_code), '') IS NOT NULL
    THEN public.mingla_normalize_place_name(p_name) || '|' || pg_catalog.upper(p_country_code)
    ELSE 'geo:' || pg_catalog.round(p_lat::numeric, 2)::text || ',' || pg_catalog.round(p_lng::numeric, 2)::text END
$function$;

CREATE OR REPLACE FUNCTION public.discover_v2_radius_km(p_kind text)
RETURNS float8 LANGUAGE sql IMMUTABLE SET search_path = '' AS $function$
  SELECT CASE WHEN p_kind = 'stays' THEN 100::float8 ELSE 50::float8 END
$function$;

CREATE OR REPLACE FUNCTION public.discover_v2_city_context(p_city_names text[], p_lat float8, p_lng float8, p_radius_km float8, p_device_tz text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $function$
  SELECT jsonb_build_object(
    'tz', COALESCE((SELECT e.timezone FROM public.events e WHERE e.deleted_at IS NULL AND e.city = ANY(p_city_names) AND e.timezone IS NOT NULL GROUP BY e.timezone ORDER BY count(*) DESC LIMIT 1), NULLIF(p_device_tz, ''), 'UTC'),
    'tzSource', CASE WHEN EXISTS (SELECT 1 FROM public.events e WHERE e.deleted_at IS NULL AND e.city = ANY(p_city_names) AND e.timezone IS NOT NULL) THEN 'supply' ELSE 'device' END,
    'majorityCurrency', (SELECT e.currency FROM public.events e WHERE e.deleted_at IS NULL AND e.city = ANY(p_city_names) AND e.currency IS NOT NULL GROUP BY e.currency ORDER BY count(*) DESC LIMIT 1)
  )
$function$;

CREATE OR REPLACE FUNCTION public.discover_v2_from_price_minor(p_event_id uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $function$
  SELECT public.compute_all_in_cents(
    min(tt.price_cents),
    COALESCE(e.pass_mingla_fee, b.default_pass_mingla_fee),
    COALESCE(e.pass_service_fee, b.default_pass_service_fee),
    (SELECT r.effective_take_rate_bps FROM public.resolve_effective_take_rate_bps(b.id) r)
  )
  FROM public.events e JOIN public.brands b ON b.id = e.brand_id
  JOIN public.ticket_types tt ON tt.event_id = e.id
  WHERE e.id = p_event_id AND tt.deleted_at IS NULL AND tt.is_hidden IS NOT TRUE
    AND tt.is_disabled IS NOT TRUE AND tt.price_cents > 0
  GROUP BY e.pass_mingla_fee, e.pass_service_fee, b.default_pass_mingla_fee, b.default_pass_service_fee, b.id
$function$;

CREATE OR REPLACE FUNCTION public.discover_v2_items(
  p_kind text, p_city_names text[], p_lat float8, p_lng float8, p_radius_km float8,
  p_tz text, p_filters jsonb, p_offset int, p_limit int
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_rows jsonb := '[]'::jsonb; v_total bigint := 0; v_source jsonb; v_window tstzrange;
BEGIN
  IF p_kind NOT IN ('events','experiences','trips','stays') THEN RAISE EXCEPTION 'invalid_kind' USING ERRCODE='22023'; END IF;
  IF p_kind = 'events' THEN
    IF NULLIF(p_filters->>'when','') IS NOT NULL THEN v_window := public.discover_v2_window(p_filters->>'when', p_tz, now()); END IF;
    v_source := public.pg_discover_business_events(
      p_city_names, COALESCE(lower(v_window), now()), upper(v_window),
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_filters->'partyTypes','[]'::jsonb))),
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_filters->'vibeTags','[]'::jsonb))),
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_filters->'musicGenres','[]'::jsonb))),
      GREATEST(p_offset,0), LEAST(GREATEST(p_limit,1),50), p_lng, p_lat, public.discover_v2_radius_km('events'));
    v_total := COALESCE((v_source->>'total')::bigint,0);
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'source','mingla','kind',CASE WHEN r->>'event_type'='rsvp' THEN 'rsvp' ELSE 'event' END,'id',r->>'id',
      'brand',jsonb_build_object('id',r->>'brand_id','slug',r->>'brand_slug','name',r->>'brand_name','photoUrl',r->>'brand_profile_photo_url'),
      'title',r->>'title','coverUrl',r->>'cover_media_url','coverType',r->>'cover_media_type','coverHue',24,
      'startsAtUtc',r->>'master_start_at','endsAtUtc',r->>'master_end_at','timezone',COALESCE(r->>'master_timezone',r->>'timezone','UTC'),
      'meta',jsonb_build_object('venueOrPlace',r->>'location_text'),
      'price',jsonb_build_object('currency',COALESCE(r->>'pricing_currency',r->>'currency'),'listMinor',public.discover_v2_from_price_minor((r->>'id')::uuid),'saleMinor',display.display_sale_price_cents,'saleEndsAt',display.display_sale_ends_at,'isFree',COALESCE((r->>'price_min_cents')::int,0)=0,'unit','each'),
      'route',jsonb_build_object('pathname',CASE WHEN r->>'event_type'='rsvp' THEN '/rsvp/[slug]' ELSE '/event/[slug]' END,'params',jsonb_build_object('slug',r->>'slug'))
    )), '[]'::jsonb) INTO v_rows
      FROM jsonb_array_elements(COALESCE(v_source->'rows','[]'::jsonb)) r
      CROSS JOIN LATERAL public.issue_3872_event_display_prices((r->>'id')::uuid) display;
  ELSIF p_kind = 'trips' THEN
    WITH eligible AS (
      SELECT e.id,e.slug,e.brand_id,e.title,e.destination_text,e.departure_text,e.cover_media_url,e.cover_media_type,e.timezone,e.currency,
        e.destination_place_key,e.departure_place_key,b.slug brand_slug,b.name brand_name,b.profile_photo_url,
        ed.start_at,ed.end_at,public.discover_v2_from_price_minor(e.id) price_minor,
        display.display_sale_price_cents sale_minor,display.display_sale_ends_at sale_ends_at,
        count(*) over() total_count
      FROM public.events e JOIN public.brands b ON b.id=e.brand_id AND b.deleted_at IS NULL
      JOIN public.event_dates ed ON ed.event_id=e.id AND ed.is_master IS TRUE AND ed.end_at>=now()
      CROSS JOIN LATERAL public.issue_3872_event_display_prices(e.id) display
      WHERE e.event_type='trip' AND e.visibility='public' AND e.status IN ('scheduled','live') AND e.deleted_at IS NULL
        AND COALESCE(e.bookings_closed,false)=false AND (e.booking_deadline IS NULL OR e.booking_deadline>=now())
        AND EXISTS (SELECT 1 FROM public.trip_pricing_tiers tpt JOIN public.ticket_types tt ON tt.id=tpt.ticket_type_id WHERE tpt.event_id=e.id AND tt.deleted_at IS NULL AND COALESCE(tt.is_hidden,false)=false)
        AND (e.destination_city = ANY(p_city_names) OR e.departure_city = ANY(p_city_names))
        AND (NULLIF(p_filters->>'destination','') IS NULL OR e.destination_place_key=p_filters->>'destination')
        AND (NULLIF(p_filters->>'leavingFrom','') IS NULL OR e.departure_place_key=p_filters->>'leavingFrom')
        AND (NOT (p_filters ? 'when') OR ed.start_at <@ public.discover_v2_window(p_filters->>'when',p_tz,now()))
      ORDER BY ed.start_at,e.id OFFSET GREATEST(p_offset,0) LIMIT LEAST(GREATEST(p_limit,1),50)
    ) SELECT COALESCE(max(total_count),0),COALESCE(jsonb_agg(jsonb_build_object(
      'source','mingla','kind','trip','id',id,'brand',jsonb_build_object('id',brand_id,'slug',brand_slug,'name',brand_name,'photoUrl',profile_photo_url),
      'title',title,'coverUrl',cover_media_url,'coverType',cover_media_type,'coverHue',194,'startsAtUtc',start_at,'endsAtUtc',end_at,'timezone',timezone,
      'meta',jsonb_build_object('venueOrPlace',destination_text),'price',jsonb_build_object('currency',currency,'listMinor',price_minor,'saleMinor',sale_minor,'saleEndsAt',sale_ends_at,'isFree',price_minor IS NULL,'unit','each'),
      'route',jsonb_build_object('pathname','/trip/[slug]','params',jsonb_build_object('slug',slug))
    ) ORDER BY start_at,id),'[]'::jsonb) INTO v_total,v_rows FROM eligible;
  ELSIF p_kind = 'experiences' THEN
    WITH eligible AS (
      SELECT e.id,e.slug,e.brand_id,e.title,e.location_text,e.cover_media_url,e.cover_media_type,e.timezone,e.currency,b.slug brand_slug,b.name brand_name,b.profile_photo_url,
        ed.start_at,ed.end_at,public.discover_v2_from_price_minor(e.id) price_minor,
        display.display_sale_price_cents sale_minor,display.display_sale_ends_at sale_ends_at,
        count(*) over() total_count
      FROM public.events e JOIN public.brands b ON b.id=e.brand_id AND b.deleted_at IS NULL
      JOIN public.event_dates ed ON ed.event_id=e.id AND ed.is_master IS TRUE AND ed.end_at>=now()
      CROSS JOIN LATERAL public.issue_3872_event_display_prices(e.id) display
      WHERE e.event_type='experience' AND e.visibility='public' AND e.status IN ('scheduled','live') AND e.published_at IS NOT NULL AND e.deleted_at IS NULL
        AND cardinality(e.experience_intents)>0 AND NOT public.issue_1931_event_ordinary_read_blocked(e.id)
        AND NOT (public.discover_v2_from_price_minor(e.id)>0 AND NOT public.pg_brand_can_collect(e.brand_id))
        AND (e.city=ANY(p_city_names) OR (e.location_geo IS NOT NULL AND public.ST_DWithin(public.ST_SetSRID(e.location_geo::public.geometry,4326)::public.geography,public.ST_SetSRID(public.ST_MakePoint(p_lng,p_lat),4326)::public.geography,public.discover_v2_radius_km('experiences')*1000)))
        AND (NOT (p_filters ? 'when') OR ed.start_at <@ public.discover_v2_window(p_filters->>'when',p_tz,now()))
        AND (NOT (p_filters ? 'goodFor') OR e.experience_intents && ARRAY(SELECT jsonb_array_elements_text(p_filters->'goodFor')))
      ORDER BY ed.start_at,e.id OFFSET GREATEST(p_offset,0) LIMIT LEAST(GREATEST(p_limit,1),50)
    ) SELECT COALESCE(max(total_count),0),COALESCE(jsonb_agg(jsonb_build_object(
      'source','mingla','kind','experience','id',id,'brand',jsonb_build_object('id',brand_id,'slug',brand_slug,'name',brand_name,'photoUrl',profile_photo_url),
      'title',title,'coverUrl',cover_media_url,'coverType',cover_media_type,'coverHue',274,'startsAtUtc',start_at,'endsAtUtc',end_at,'timezone',timezone,
      'meta',jsonb_build_object('venueOrPlace',location_text),'price',jsonb_build_object('currency',currency,'listMinor',price_minor,'saleMinor',sale_minor,'saleEndsAt',sale_ends_at,'isFree',price_minor IS NULL,'unit','each'),
      'route',jsonb_build_object('pathname','/experience/[slug]','params',jsonb_build_object('slug',slug))
    ) ORDER BY start_at,id),'[]'::jsonb) INTO v_total,v_rows FROM eligible;
  ELSE
    v_source := public.pg_public_stays_discover(COALESCE(p_city_names[1],NULL),NULL,NULL,COALESCE((p_filters->>'guests')::int,2),0,1,
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_filters->'propertyKinds','[]'::jsonb))),NULL,NULL,LEAST(GREATEST(p_limit,1),50),GREATEST(p_offset,0));
    v_total := COALESCE((v_source->>'totalCount')::bigint,0);
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'source','mingla','kind','stay','id',r->>'venueId','brand',jsonb_build_object('id',r->>'brandId','slug',r->>'brandSlug','name',r->>'brandName','photoUrl',NULL),
      'title',r->>'venueName','coverUrl',COALESCE(r->>'venueCoverUrl',r->>'coverPath'),'coverType',COALESCE(r->>'venueCoverType','image'),'coverHue',140,
      'startsAtUtc',NULL,'endsAtUtc',NULL,'timezone','UTC','meta',jsonb_build_object('venueOrPlace',r->>'city'),
      'price',jsonb_build_object('currency',r->>'currencyCode','listMinor',(r->>'amountMinor')::int,'saleMinor',NULL,'saleEndsAt',NULL,'isFree',false,'unit','per_night'),
      'route',jsonb_build_object('pathname','/stay/[slug]','params',jsonb_build_object('slug',r->>'venueSlug'))
    )), '[]'::jsonb) INTO v_rows FROM jsonb_array_elements(COALESCE(v_source->'rows','[]'::jsonb)) r;
  END IF;
  RETURN jsonb_build_object('items',v_rows,'total',v_total);
END;
$function$;

CREATE OR REPLACE FUNCTION public.discover_v2_option_count(
  p_city_names text[],p_lat float8,p_lng float8,p_tz text,p_kind text,
  p_filters jsonb,p_filter_key text,p_option text,p_multi boolean
) RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $function$
  SELECT COALESCE((public.discover_v2_items(
    p_kind,p_city_names,p_lat,p_lng,public.discover_v2_radius_km(p_kind),p_tz,
    (p_filters-p_filter_key)||jsonb_build_object(p_filter_key,
      CASE WHEN p_multi THEN jsonb_build_array(p_option) ELSE to_jsonb(p_option) END),0,1)->>'total')::bigint,0)
$function$;

CREATE OR REPLACE FUNCTION public.discover_v2_nearest_city(p_lat float8,p_lng float8)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $function$
  WITH eligible AS (
    SELECT concat_ws(', ',e.city,b.country_code) label,(e.location_geo)[1]::float8 lat,(e.location_geo)[0]::float8 lng,e.id::text item_id
    FROM public.events e JOIN public.brands b ON b.id=e.brand_id AND b.deleted_at IS NULL
    WHERE e.deleted_at IS NULL AND e.visibility='public' AND e.status IN ('scheduled','live')
      AND e.city IS NOT NULL AND e.location_geo IS NOT NULL
      AND EXISTS(SELECT 1 FROM public.event_dates ed WHERE ed.event_id=e.id AND ed.is_master IS TRUE AND ed.end_at>=now())
      AND (e.event_type='event' OR (e.event_type='rsvp' AND e.rsvp_discoverable=true))
      AND NOT public.issue_1931_event_ordinary_read_blocked(e.id)
      AND (NOT EXISTS(SELECT 1 FROM public.ticket_types tt WHERE tt.event_id=e.id AND tt.available_online IS TRUE
        AND tt.deleted_at IS NULL AND tt.is_hidden IS NOT TRUE AND tt.is_disabled IS NOT TRUE AND tt.price_cents>0)
        OR public.pg_brand_can_collect(e.brand_id))
    UNION ALL
    SELECT concat_ws(', ',e.city,b.country_code),(e.location_geo)[1]::float8,(e.location_geo)[0]::float8,e.id::text
    FROM public.events e JOIN public.brands b ON b.id=e.brand_id AND b.deleted_at IS NULL
    WHERE e.event_type='trip' AND e.visibility='public' AND e.status IN ('scheduled','live') AND e.deleted_at IS NULL
      AND e.city IS NOT NULL AND e.location_geo IS NOT NULL
      AND COALESCE(e.bookings_closed,false)=false AND (e.booking_deadline IS NULL OR e.booking_deadline>=now())
      AND EXISTS(SELECT 1 FROM public.event_dates ed WHERE ed.event_id=e.id AND ed.is_master IS TRUE AND ed.end_at>=now())
      AND EXISTS(SELECT 1 FROM public.trip_pricing_tiers tpt JOIN public.ticket_types tt ON tt.id=tpt.ticket_type_id
        WHERE tpt.event_id=e.id AND tt.deleted_at IS NULL AND COALESCE(tt.is_hidden,false)=false)
    UNION ALL
    SELECT concat_ws(', ',s.city,s.country_code),s.lat,s.lng,e.id::text FROM public.events e
      JOIN public.brands b ON b.id=e.brand_id AND b.deleted_at IS NULL
      JOIN public.experience_stops s ON s.event_id=e.id
    WHERE e.event_type='experience' AND e.visibility='public' AND e.status='scheduled'
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
    WHERE v.venue_category='stay' AND v.city IS NOT NULL AND v.lat IS NOT NULL AND v.lng IS NOT NULL
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

-- Cross-isolate Ticketmaster call guard. The existing Discover L2 row is the
-- durable counter authority; FOR UPDATE makes concurrent claims exact.
CREATE OR REPLACE FUNCTION public.discover_v2_claim_tm_budget(
  p_utc_day date,p_limit integer DEFAULT 2500
) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_key text:='tmbudget:'||p_utc_day::text; v_calls integer;
BEGIN
  IF p_limit<1 THEN RAISE EXCEPTION 'invalid_tm_budget_limit' USING ERRCODE='22023'; END IF;
  INSERT INTO public.discover_merged_events_cache(cache_key,response,fetched_at,expires_at)
  VALUES(v_key,jsonb_build_object('calls',0),now(),(p_utc_day+2)::timestamptz)
  ON CONFLICT(cache_key) DO NOTHING;
  SELECT COALESCE((response->>'calls')::integer,0) INTO v_calls
  FROM public.discover_merged_events_cache WHERE cache_key=v_key FOR UPDATE;
  IF v_calls>=p_limit THEN RETURN false; END IF;
  UPDATE public.discover_merged_events_cache
    SET response=jsonb_build_object('calls',v_calls+1),fetched_at=now(),expires_at=(p_utc_day+2)::timestamptz
    WHERE cache_key=v_key;
  RETURN true;
END;
$function$;

-- Read-only companion used by the stale-while-revalidate path. It lets the
-- response disclose an exhausted durable budget while still serving the last
-- good L2 pool, without spending a call simply to inspect the counter.
CREATE OR REPLACE FUNCTION public.discover_v2_tm_budget_available(
  p_utc_day date,p_limit integer DEFAULT 2500
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $function$
  SELECT CASE
    WHEN p_limit<1 THEN false
    ELSE COALESCE((
      SELECT COALESCE((cache.response->>'calls')::integer,0)<p_limit
      FROM public.discover_merged_events_cache cache
      WHERE cache.cache_key='tmbudget:'||p_utc_day::text
    ),true)
  END
$function$;

-- Final facets implementation: options are derived from eligible inventory and
-- every count excludes its own group while retaining every other selection.
CREATE OR REPLACE FUNCTION public.discover_v2_facets_exact(
  p_city_names text[],p_lat float8,p_lng float8,p_radius_km float8,p_tz text,
  p_kind text,p_filters jsonb,p_currency text
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_kind text; v_page jsonb; v_kinds jsonb:='{}'::jsonb; v_selected bigint:=0;
  v_groups jsonb:='[]'::jsonb; v_options jsonb; v_option text; v_count bigint; v_possible bigint;
  v_base jsonb:=jsonb_build_object('_countryCode',p_filters->'_countryCode','_priceCatalog',COALESCE(p_filters->'_priceCatalog','{}'::jsonb));
  v_all_zero boolean:=true; v_stays_enabled boolean:=false; v_meta jsonb; v_edges jsonb; v_i integer;
  v_key text; v_group text; v_multi boolean; v_candidates text[];
BEGIN
  FOREACH v_kind IN ARRAY ARRAY['events','experiences','trips','stays'] LOOP
    v_page:=public.discover_v2_items(v_kind,p_city_names,p_lat,p_lng,public.discover_v2_radius_km(v_kind),p_tz,v_base,0,1);
    v_count:=COALESCE((v_page->>'total')::bigint,0);
    v_kinds:=v_kinds||jsonb_build_object(v_kind,jsonb_build_object('total',v_count,'available',v_count>0));
    IF v_count>0 THEN v_all_zero:=false; END IF;
  END LOOP;
  v_page:=public.discover_v2_items(p_kind,p_city_names,p_lat,p_lng,public.discover_v2_radius_km(p_kind),p_tz,p_filters,0,1);
  v_selected:=COALESCE((v_page->>'total')::bigint,0);
  v_meta:=COALESCE(v_page->'facetOptions','{}'::jsonb);

  IF p_kind='events' THEN
    FOR v_group,v_key,v_multi,v_candidates IN
      SELECT * FROM (VALUES
        ('when','when',false,ARRAY['tomorrow','weekend']::text[]),
        ('partyType','partyTypes',true,ARRAY['birthday-party','rooftop-party','club-night','house-party','warehouse-party','beach-party','pool-party','boat-party','themed-party','corporate-event','graduation-party','holiday-party','networking-event','rave','festival']::text[]),
        ('vibe','vibeTags',true,ARRAY['energetic','chill','intimate','wild','classy','casual','upscale','underground','mainstream','artsy','social','exclusive','laid-back','vibrant','retro','futuristic']::text[]),
        ('music','musicGenres',true,ARRAY['electronic-edm','house','hiphop-rap','pop','rock','latin','afrobeats','afro-house','amapiano','gospel','rnb-soul','disco-funk','reggae-dancehall','indie','country','jazz','classical','mixed-variety']::text[])
      ) x(group_id,key_id,is_multi,candidates)
    LOOP
      v_options:='[]'::jsonb;
      FOREACH v_option IN ARRAY v_candidates LOOP
        v_possible:=public.discover_v2_option_count(p_city_names,p_lat,p_lng,p_tz,p_kind,v_base,v_key,v_option,v_multi);
        IF v_possible>0 THEN
          v_count:=public.discover_v2_option_count(p_city_names,p_lat,p_lng,p_tz,p_kind,p_filters,v_key,v_option,v_multi);
          v_options:=v_options||jsonb_build_array(jsonb_build_object('id',v_option,'count',v_count));
        END IF;
      END LOOP;
      IF jsonb_array_length(v_options)>0 THEN v_groups:=v_groups||jsonb_build_array(jsonb_build_object('id',v_group,'multi',v_multi,'options',v_options)); END IF;
    END LOOP;
  ELSIF p_kind='experiences' THEN
    FOR v_group,v_key,v_multi,v_candidates IN
      SELECT * FROM (VALUES
        ('when','when',false,ARRAY['tomorrow','weekend']::text[]),
        ('goodFor','goodFor',true,ARRAY['adventurous','first-date','romantic','group-fun']::text[])
      ) x(group_id,key_id,is_multi,candidates)
    LOOP
      v_options:='[]'::jsonb;
      FOREACH v_option IN ARRAY v_candidates LOOP
        v_possible:=public.discover_v2_option_count(p_city_names,p_lat,p_lng,p_tz,p_kind,v_base,v_key,v_option,v_multi);
        IF v_possible>0 THEN
          v_count:=public.discover_v2_option_count(p_city_names,p_lat,p_lng,p_tz,p_kind,p_filters,v_key,v_option,v_multi);
          v_options:=v_options||jsonb_build_array(jsonb_build_object('id',v_option,'count',v_count));
        END IF;
      END LOOP;
      IF jsonb_array_length(v_options)>0 THEN v_groups:=v_groups||jsonb_build_array(jsonb_build_object('id',v_group,'multi',v_multi,'options',v_options)); END IF;
    END LOOP;
  ELSIF p_kind='trips' THEN
    FOR v_group,v_key IN SELECT * FROM (VALUES ('destination','destination'),('leavingFrom','leavingFrom')) x(group_id,key_id)
    LOOP
      v_options:='[]'::jsonb;
      FOR v_option IN SELECT value->>'id' FROM jsonb_array_elements(COALESCE(v_meta->v_group,'[]'::jsonb)) LOOP
        v_possible:=public.discover_v2_option_count(p_city_names,p_lat,p_lng,p_tz,p_kind,v_base,v_key,v_option,false);
        IF v_possible>0 THEN
          v_count:=public.discover_v2_option_count(p_city_names,p_lat,p_lng,p_tz,p_kind,p_filters,v_key,v_option,false);
          v_options:=v_options||jsonb_build_array(jsonb_build_object('id',v_option,'label',
            (SELECT value->>'label' FROM jsonb_array_elements(v_meta->v_group) WHERE value->>'id'=v_option LIMIT 1),'count',v_count));
        END IF;
      END LOOP;
      IF jsonb_array_length(v_options)>0 THEN v_groups:=v_groups||jsonb_build_array(jsonb_build_object('id',v_group,'multi',false,'options',v_options)); END IF;
    END LOOP;
    v_options:='[]'::jsonb;
    FOREACH v_option IN ARRAY ARRAY['this_month','next_month'] LOOP
      v_possible:=public.discover_v2_option_count(p_city_names,p_lat,p_lng,p_tz,p_kind,v_base,'when',v_option,false);
      IF v_possible>0 THEN v_options:=v_options||jsonb_build_array(jsonb_build_object('id',v_option,'count',
        public.discover_v2_option_count(p_city_names,p_lat,p_lng,p_tz,p_kind,p_filters,'when',v_option,false))); END IF;
    END LOOP;
    IF jsonb_array_length(v_options)>0 THEN v_groups:=v_groups||jsonb_build_array(jsonb_build_object('id','when','multi',false,'options',v_options)); END IF;
  ELSE
    v_options:='[]'::jsonb;
    FOREACH v_option IN ARRAY ARRAY['tonight','tomorrow','weekend'] LOOP
      v_possible:=public.discover_v2_option_count(p_city_names,p_lat,p_lng,p_tz,p_kind,v_base,'checkIn',v_option,false);
      IF v_possible>0 THEN v_options:=v_options||jsonb_build_array(jsonb_build_object('id',v_option,'count',
        public.discover_v2_option_count(p_city_names,p_lat,p_lng,p_tz,p_kind,p_filters,'checkIn',v_option,false))); END IF;
    END LOOP;
    IF jsonb_array_length(v_options)>0 THEN v_groups:=v_groups||jsonb_build_array(jsonb_build_object('id','checkIn','multi',false,'options',v_options)); END IF;
    v_options:='[]'::jsonb;
    FOREACH v_option IN ARRAY ARRAY['hotel','resort','guest_house','lodge','serviced_apartment','short_stay_apartment','other'] LOOP
      v_possible:=public.discover_v2_option_count(p_city_names,p_lat,p_lng,p_tz,p_kind,v_base,'propertyKinds',v_option,true);
      IF v_possible>0 THEN v_options:=v_options||jsonb_build_array(jsonb_build_object('id',v_option,'count',
        public.discover_v2_option_count(p_city_names,p_lat,p_lng,p_tz,p_kind,p_filters,'propertyKinds',v_option,true))); END IF;
    END LOOP;
    IF jsonb_array_length(v_options)>0 THEN v_groups:=v_groups||jsonb_build_array(jsonb_build_object('id','propertyKind','multi',true,'options',v_options)); END IF;
    v_options:='[]'::jsonb;
    FOR v_i IN 1..8 LOOP
      v_count:=COALESCE((public.discover_v2_items('stays',p_city_names,p_lat,p_lng,public.discover_v2_radius_km('stays'),p_tz,
        (p_filters-'guests')||jsonb_build_object('guests',v_i),0,1)->>'total')::bigint,0);
      v_options:=v_options||jsonb_build_array(jsonb_build_object('id',v_i::text,'count',v_count));
    END LOOP;
    v_groups:=v_groups||jsonb_build_array(jsonb_build_object('id','guests','multi',false,'options',v_options));
  END IF;

  IF p_kind IN ('events','experiences') THEN
    v_options:='[]'::jsonb;
    FOREACH v_option IN ARRAY (CASE WHEN p_kind='events' THEN ARRAY['free_rsvp','free_ticket'] ELSE ARRAY['free'] END) LOOP
      v_possible:=public.discover_v2_option_count(p_city_names,p_lat,p_lng,p_tz,p_kind,v_base,'price',v_option,true);
      IF v_possible>0 THEN v_options:=v_options||jsonb_build_array(jsonb_build_object('id',v_option,'count',
        public.discover_v2_option_count(p_city_names,p_lat,p_lng,p_tz,p_kind,p_filters,'price',v_option,true))); END IF;
    END LOOP;
    v_edges:=p_filters->'_priceCatalog'->p_kind->upper(p_currency);
    IF jsonb_typeof(v_edges)='array' THEN
      FOR v_i IN 1..jsonb_array_length(v_edges)+1 LOOP
        v_option:='band_'||v_i::text;
        v_possible:=public.discover_v2_option_count(p_city_names,p_lat,p_lng,p_tz,p_kind,v_base,'price',v_option,true);
        IF v_possible>0 THEN v_options:=v_options||jsonb_build_array(jsonb_build_object('id',v_option,'count',
          public.discover_v2_option_count(p_city_names,p_lat,p_lng,p_tz,p_kind,p_filters,'price',v_option,true))); END IF;
      END LOOP;
    END IF;
    IF jsonb_array_length(v_options)>0 THEN v_groups:=v_groups||jsonb_build_array(jsonb_build_object('id','price','multi',true,'options',v_options)); END IF;
  END IF;

  SELECT COALESCE(is_enabled,false) INTO v_stays_enabled FROM public.feature_flags WHERE flag_key='STAY_PUBLIC_PAGES';
  RETURN jsonb_build_object(
    'cityKey',public.discover_v2_city_key(p_city_names[1],p_filters->>'_countryCode',p_lat,p_lng),
    'kinds',v_kinds,'selected',jsonb_build_object('kind',p_kind,'total',v_selected,'minglaTotal',v_selected),
    'groups',v_groups,'nearestCity',CASE WHEN v_all_zero THEN public.discover_v2_nearest_city(p_lat,p_lng) ELSE NULL END,
    'stays',jsonb_build_object('enabled',v_stays_enabled));
END;
$function$;

CREATE OR REPLACE FUNCTION public.discover_v2_facets(
  p_city_names text[], p_lat float8, p_lng float8, p_radius_km float8, p_tz text,
  p_kind text, p_filters jsonb, p_currency text
) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $function$
  SELECT public.discover_v2_facets_exact(
    p_city_names,p_lat,p_lng,p_radius_km,p_tz,p_kind,p_filters,p_currency)
$function$;

-- The canonical v1/v2 event eligibility reader. It deliberately returns jsonb
-- rows so the v1 wire shape can be re-emitted without exposing a new anon table
-- function or coupling callers to the physical `point` type.
CREATE OR REPLACE FUNCTION public.discover_v2_event_base(
  p_cities text[], p_lower_bound timestamptz, p_upper_start timestamptz DEFAULT NULL,
  p_party_types text[] DEFAULT NULL, p_vibe_tags text[] DEFAULT NULL,
  p_music_genres text[] DEFAULT NULL, p_center_lng float8 DEFAULT NULL,
  p_center_lat float8 DEFAULT NULL, p_radius_km float8 DEFAULT NULL
) RETURNS SETOF jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
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
    ORDER BY occurrence.start_at,occurrence.id LIMIT 1
  ) ed ON true
  WHERE e.deleted_at IS NULL
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

-- V1 is re-emitted through the canonical base. Its signature, row shape,
-- ordering, pagination and grants stay unchanged for installed clients.
CREATE OR REPLACE FUNCTION public.pg_discover_business_events(
  p_cities text[], p_lower_bound timestamptz, p_upper_start timestamptz DEFAULT NULL,
  p_party_types text[] DEFAULT NULL, p_vibe_tags text[] DEFAULT NULL,
  p_music_genres text[] DEFAULT NULL, p_offset integer DEFAULT 0,
  p_limit integer DEFAULT 20, p_center_lng float8 DEFAULT NULL,
  p_center_lat float8 DEFAULT NULL, p_radius_km float8 DEFAULT NULL
) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
  WITH base AS MATERIALIZED (
    SELECT row
    FROM public.discover_v2_event_base(
      p_cities,p_lower_bound,p_upper_start,p_party_types,p_vibe_tags,p_music_genres,
      p_center_lng,p_center_lat,p_radius_km) AS event_base(row)
    WHERE NOT (
      EXISTS (
        SELECT 1
        FROM public.ticket_types tt
        WHERE tt.event_id=(row->>'id')::uuid
          AND tt.deleted_at IS NULL
          AND tt.is_hidden IS NOT TRUE
          AND tt.is_disabled IS NOT TRUE
          AND tt.available_online IS TRUE
          AND tt.price_cents>0
      )
      AND NOT public.pg_brand_can_collect((row->>'brand_id')::uuid)
    )
  ), guarded AS (
    -- Keep the installed V1 reader as a direct #2489 carrier even though the
    -- canonical base already projects the same privacy-safe fields. This second
    -- boundary is deliberately fail-closed: a future regression in the shared
    -- reader still cannot put a withheld address back on the V1 wire.
    SELECT row || jsonb_build_object(
      'location_text',CASE WHEN public.issue_2489_address_withheld(row->'theme')
        THEN NULL ELSE row->'location_text' END,
      'location_geo',CASE WHEN public.issue_2489_address_withheld(row->'theme')
        THEN NULL ELSE row->'location_geo' END,
      'theme',public.issue_2489_public_theme(row->'theme')) AS row
    FROM base
  ), ranked AS (
    SELECT row,count(*) over() total_count FROM guarded
    ORDER BY (row->>'master_start_at')::timestamptz ASC NULLS LAST,(row->>'id')::uuid
    OFFSET greatest(p_offset,0) LIMIT greatest(p_limit,0)
  )
  SELECT jsonb_build_object(
    'total',COALESCE((SELECT total_count FROM ranked LIMIT 1),0),
    'rows',COALESCE((SELECT jsonb_agg(row ORDER BY (row->>'master_start_at')::timestamptz ASC NULLS LAST,(row->>'id')::uuid) FROM ranked),'[]'::jsonb))
$function$;

REVOKE ALL ON FUNCTION public.pg_discover_business_events(text[],timestamptz,timestamptz,text[],text[],text[],integer,integer,float8,float8,float8) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pg_discover_business_events(text[],timestamptz,timestamptz,text[],text[],text[],integer,integer,float8,float8,float8) TO anon,authenticated;

CREATE OR REPLACE FUNCTION public.discover_v2_price_option(
  p_kind text, p_event_type text, p_currency text, p_price_minor integer,
  p_has_free boolean, p_catalog jsonb
) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $function$
DECLARE v_edges jsonb; v_band integer;
BEGIN
  IF p_event_type='rsvp' THEN RETURN 'free_rsvp'; END IF;
  IF p_has_free THEN RETURN CASE WHEN p_kind='experiences' THEN 'free' ELSE 'free_ticket' END; END IF;
  IF p_price_minor IS NULL OR NULLIF(p_currency,'') IS NULL THEN RETURN NULL; END IF;
  v_edges:=p_catalog->p_kind->upper(p_currency);
  IF jsonb_typeof(v_edges)<>'array' THEN RETURN NULL; END IF;
  SELECT count(*)+1 INTO v_band FROM jsonb_array_elements_text(v_edges) edge
    WHERE p_price_minor >= edge::integer;
  RETURN 'band_'||v_band::text;
END;
$function$;

CREATE OR REPLACE FUNCTION public.discover_v2_price_matches(
  p_kind text,p_event_type text,p_currency text,p_price_minor integer,
  p_has_free boolean,p_filters jsonb
) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $function$
  SELECT COALESCE(jsonb_array_length(COALESCE(p_filters->'price','[]'::jsonb)),0)=0
    OR public.discover_v2_price_option(p_kind,p_event_type,p_currency,p_price_minor,p_has_free,
      COALESCE(p_filters->'_priceCatalog','{}'::jsonb)) IN
      (SELECT jsonb_array_elements_text(COALESCE(p_filters->'price','[]'::jsonb)))
$function$;

-- One stay-availability predicate, shared by v2 cards/facets and shaped exactly
-- like the existing public RPC's room/date/hold/commitment test.
CREATE OR REPLACE FUNCTION public.discover_v2_stay_room_available(
  p_offering_id uuid,p_check_in date,p_check_out date,p_rooms integer
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.stay_offerings offering
    JOIN public.stay_settings settings ON settings.venue_id=offering.venue_id
      AND settings.brand_id=offering.brand_id AND settings.booking_state='active'
    WHERE offering.id=p_offering_id AND offering.kind='room' AND offering.status='live'
      AND p_rooms>=1 AND offering.quantity>=p_rooms
      AND (
        p_check_in IS NULL OR (
          p_check_out>p_check_in AND p_check_out-p_check_in BETWEEN 1 AND 365
          AND p_check_in >= (now() AT TIME ZONE settings.timezone)::date
          AND p_check_in <= (now() AT TIME ZONE settings.timezone)::date
            + least(settings.booking_horizon_days,COALESCE(offering.max_advance_days,settings.booking_horizon_days))
          AND ((p_check_in::timestamp+settings.check_in_time) AT TIME ZONE settings.timezone)
            >= now()+pg_catalog.make_interval(mins=>offering.min_notice_minutes)
          AND NOT EXISTS (
            SELECT 1 FROM generate_series(p_check_in::timestamp,(p_check_out-1)::timestamp,interval '1 day') requested(day)
            LEFT JOIN public.stay_room_nights night ON night.offering_id=offering.id AND night.local_date=requested.day::date
            WHERE night.offering_id IS NULL OR night.stop_sell
              OR p_check_out-p_check_in<night.minimum_nights
              OR (night.maximum_nights IS NOT NULL AND p_check_out-p_check_in>night.maximum_nights)
              OR night.sellable_quantity
                - COALESCE((SELECT sum(slice.quantity) FROM public.stay_inventory_hold_slices slice
                    JOIN public.stay_inventory_holds hold ON hold.id=slice.hold_id
                    WHERE slice.offering_id=offering.id AND slice.resource_type='room_night'
                      AND slice.room_date=requested.day::date
                      AND ((hold.state='active' AND hold.expires_at>now()) OR hold.state='reconciliation_required')),0)
                - COALESCE((SELECT sum(commitment.quantity) FROM public.stay_inventory_commitments commitment
                    WHERE commitment.offering_id=offering.id AND commitment.resource_type='room_night'
                      AND commitment.room_date=requested.day::date AND commitment.state='active'),0) < p_rooms
          )
        )
      )
      AND EXISTS (SELECT 1 FROM public.stay_room_nights future_night
        WHERE future_night.offering_id=offering.id
          AND future_night.local_date >= (now() AT TIME ZONE settings.timezone)::date
          AND NOT future_night.stop_sell AND future_night.sellable_quantity>0)
  )
$function$;

-- Final v2 reader. Each kind has one eligibility CTE; the facet reader below
-- asks this function for counts instead of restating those predicates.
CREATE OR REPLACE FUNCTION public.discover_v2_items(
  p_kind text,p_city_names text[],p_lat float8,p_lng float8,p_radius_km float8,
  p_tz text,p_filters jsonb,p_offset int,p_limit int
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
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
      WHERE e.event_type='experience' AND e.visibility='public' AND e.status='scheduled'
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
      WHERE e.event_type='trip' AND e.visibility='public' AND e.status IN ('scheduled','live') AND e.deleted_at IS NULL
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
      WHERE e.event_type='trip' AND e.visibility='public' AND e.status IN ('scheduled','live') AND e.deleted_at IS NULL
        AND e.destination_place_key IS NOT NULL AND COALESCE(e.bookings_closed,false)=false
        AND (e.booking_deadline IS NULL OR e.booking_deadline>=now())
        AND (NULLIF(p_filters->>'_countryCode','') IS NULL OR upper(COALESCE(e.departure_country_code::text,b.country_code))=upper(p_filters->>'_countryCode'))
      UNION ALL
      SELECT e.departure_place_key,concat_ws(', ',e.departure_city,e.departure_country_code),'leavingFrom'
      FROM public.events e JOIN public.brands b ON b.id=e.brand_id AND b.deleted_at IS NULL
      WHERE e.event_type='trip' AND e.visibility='public' AND e.status IN ('scheduled','live') AND e.deleted_at IS NULL
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
      WHERE venue.venue_category='stay' AND settings.property_kind IS NOT NULL
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

-- Resolve the city calendar from eligible inventory, not from arbitrary draft
-- rows. Supply wins by frequency and a tie goes to the timezone whose nearest
-- eligible item is closest to the anchor. Device timezone is only a fallback.
CREATE OR REPLACE FUNCTION public.discover_v2_city_context(
  p_city_names text[],p_lat float8,p_lng float8,p_radius_km float8,p_device_tz text
) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $function$
  WITH raw_candidates AS (
    SELECT 'event'::text kind,e.id item_id,e.timezone,e.currency,
      CASE WHEN e.location_geo IS NULL THEN NULL ELSE public.ST_Distance(
        public.ST_SetSRID(e.location_geo::public.geometry,4326)::public.geography,
        public.ST_SetSRID(public.ST_MakePoint(p_lng,p_lat),4326)::public.geography)/1000.0 END distance_km
    FROM public.discover_v2_event_base(
      p_city_names,now(),now()+interval '120 days',NULL,NULL,NULL,
      p_lng,p_lat,public.discover_v2_radius_km('events')) AS event_base(row)
    JOIN public.events e ON e.id=(event_base.row->>'id')::uuid

    UNION ALL

    SELECT 'experience',e.id,e.timezone,e.currency,
      (SELECT min(6371.0*2.0*asin(sqrt(power(sin(radians(s.lat-p_lat)/2.0),2)+
        cos(radians(p_lat))*cos(radians(s.lat))*power(sin(radians(s.lng-p_lng)/2.0),2))))
       FROM public.experience_stops s WHERE s.event_id=e.id AND s.lat IS NOT NULL AND s.lng IS NOT NULL)
    FROM public.events e JOIN public.brands b ON b.id=e.brand_id AND b.deleted_at IS NULL
    WHERE e.event_type='experience' AND e.visibility='public' AND e.status='scheduled'
      AND e.published_at IS NOT NULL AND e.deleted_at IS NULL AND cardinality(e.experience_intents)>0
      AND NOT public.issue_1931_event_ordinary_read_blocked(e.id)
      AND EXISTS(SELECT 1 FROM public.event_dates ed WHERE ed.event_id=e.id AND ed.end_at>=now())
      AND EXISTS(SELECT 1 FROM public.ticket_types tt WHERE tt.event_id=e.id AND tt.available_online IS TRUE
        AND tt.deleted_at IS NULL AND tt.is_hidden IS NOT TRUE AND tt.is_disabled IS NOT TRUE
        AND (tt.is_unlimited OR tt.quantity_total IS NULL OR tt.quantity_total>
          (SELECT count(*) FROM public.tickets sold WHERE sold.ticket_type_id=tt.id AND sold.status IN ('valid','used','transferred'))))
      AND (NOT EXISTS(SELECT 1 FROM public.ticket_types tt WHERE tt.event_id=e.id AND tt.available_online IS TRUE
            AND tt.deleted_at IS NULL AND tt.is_hidden IS NOT TRUE AND tt.is_disabled IS NOT TRUE AND tt.price_cents>0)
        OR public.pg_brand_can_collect(e.brand_id))
      AND (EXISTS(SELECT 1 FROM public.experience_stops s WHERE s.event_id=e.id AND s.lat IS NOT NULL AND s.lng IS NOT NULL
            AND 6371.0*2.0*asin(sqrt(power(sin(radians(s.lat-p_lat)/2.0),2)+
              cos(radians(p_lat))*cos(radians(s.lat))*power(sin(radians(s.lng-p_lng)/2.0),2)))
              <=public.discover_v2_radius_km('experiences'))
        OR (SELECT s.city FROM public.experience_stops s WHERE s.event_id=e.id ORDER BY s.stop_order,s.id LIMIT 1)=ANY(p_city_names))

    UNION ALL

    SELECT 'trip',e.id,e.timezone,e.currency,
      CASE WHEN e.location_geo IS NULL THEN NULL ELSE public.ST_Distance(
        public.ST_SetSRID(e.location_geo::public.geometry,4326)::public.geography,
        public.ST_SetSRID(public.ST_MakePoint(p_lng,p_lat),4326)::public.geography)/1000.0 END
    FROM public.events e JOIN public.brands b ON b.id=e.brand_id AND b.deleted_at IS NULL
    WHERE e.event_type='trip' AND e.visibility='public' AND e.status IN ('scheduled','live') AND e.deleted_at IS NULL
      AND COALESCE(e.bookings_closed,false)=false AND (e.booking_deadline IS NULL OR e.booking_deadline>=now())
      AND EXISTS(SELECT 1 FROM public.event_dates ed WHERE ed.event_id=e.id AND ed.is_master IS TRUE AND ed.end_at>=now())
      AND EXISTS(SELECT 1 FROM public.trip_pricing_tiers tpt JOIN public.ticket_types tt ON tt.id=tpt.ticket_type_id
        WHERE tpt.event_id=e.id AND tt.deleted_at IS NULL AND COALESCE(tt.is_hidden,false)=false)
      AND (e.destination_city=ANY(p_city_names) OR e.departure_city=ANY(p_city_names)
        OR (e.location_geo IS NOT NULL AND public.ST_DWithin(
          public.ST_SetSRID(e.location_geo::public.geometry,4326)::public.geography,
          public.ST_SetSRID(public.ST_MakePoint(p_lng,p_lat),4326)::public.geography,
          public.discover_v2_radius_km('trips')*1000)))

    UNION ALL

    SELECT 'stay',venue.id,settings.timezone,venue.default_currency,
      CASE WHEN venue.lat IS NULL OR venue.lng IS NULL THEN NULL ELSE
        6371.0*2.0*asin(sqrt(power(sin(radians(venue.lat-p_lat)/2.0),2)+
          cos(radians(p_lat))*cos(radians(venue.lat))*power(sin(radians(venue.lng-p_lng)/2.0),2))) END
    FROM public.venue_public_view venue
    JOIN public.stay_settings settings ON settings.venue_id=venue.id AND settings.brand_id=venue.brand_id
      AND settings.booking_state='active'
    JOIN public.stay_offerings offering ON offering.venue_id=venue.id AND offering.brand_id=venue.brand_id
      AND offering.kind='room' AND offering.status='live'
    WHERE venue.venue_category='stay'
      AND COALESCE((SELECT is_enabled FROM public.feature_flags WHERE flag_key='STAY_PUBLIC_PAGES'),false)
      AND (venue.city=ANY(p_city_names) OR (venue.lat IS NOT NULL AND venue.lng IS NOT NULL
        AND 6371.0*2.0*asin(sqrt(power(sin(radians(venue.lat-p_lat)/2.0),2)+
          cos(radians(p_lat))*cos(radians(venue.lat))*power(sin(radians(venue.lng-p_lng)/2.0),2)))
          <=public.discover_v2_radius_km('stays')))
      AND public.discover_v2_stay_room_available(offering.id,NULL,NULL,1)
  ), candidates AS (
    SELECT kind,item_id,timezone,currency,min(distance_km) distance_km
    FROM raw_candidates GROUP BY kind,item_id,timezone,currency
  ), timezone_choice AS (
    SELECT timezone,count(*) item_count,min(distance_km) nearest_km
    FROM candidates WHERE NULLIF(timezone,'') IS NOT NULL GROUP BY timezone
    ORDER BY item_count DESC,nearest_km ASC NULLS LAST,timezone LIMIT 1
  ), currency_choice AS (
    SELECT currency,count(*) item_count,min(distance_km) nearest_km
    FROM candidates WHERE NULLIF(currency,'') IS NOT NULL GROUP BY currency
    ORDER BY item_count DESC,nearest_km ASC NULLS LAST,currency LIMIT 1
  )
  SELECT jsonb_build_object(
    'tz',COALESCE((SELECT timezone FROM timezone_choice),NULLIF(p_device_tz,''),'UTC'),
    'tzSource',CASE WHEN EXISTS(SELECT 1 FROM timezone_choice) THEN 'supply'
      WHEN NULLIF(p_device_tz,'') IS NOT NULL THEN 'device' ELSE 'utc' END,
    'majorityCurrency',(SELECT currency FROM currency_choice))
$function$;

ALTER FUNCTION public.discover_v2_window(text,text,timestamptz) OWNER TO postgres;
ALTER FUNCTION public.discover_v2_city_key(text,text,float8,float8) OWNER TO postgres;
ALTER FUNCTION public.discover_v2_radius_km(text) OWNER TO postgres;
ALTER FUNCTION public.discover_v2_city_context(text[],float8,float8,float8,text) OWNER TO postgres;
ALTER FUNCTION public.discover_v2_from_price_minor(uuid) OWNER TO postgres;
ALTER FUNCTION public.discover_v2_event_base(text[],timestamptz,timestamptz,text[],text[],text[],float8,float8,float8) OWNER TO postgres;
ALTER FUNCTION public.discover_v2_price_option(text,text,text,integer,boolean,jsonb) OWNER TO postgres;
ALTER FUNCTION public.discover_v2_price_matches(text,text,text,integer,boolean,jsonb) OWNER TO postgres;
ALTER FUNCTION public.discover_v2_stay_room_available(uuid,date,date,integer) OWNER TO postgres;
ALTER FUNCTION public.discover_v2_items(text,text[],float8,float8,float8,text,jsonb,int,int) OWNER TO postgres;
ALTER FUNCTION public.discover_v2_facets(text[],float8,float8,float8,text,text,jsonb,text) OWNER TO postgres;
ALTER FUNCTION public.discover_v2_option_count(text[],float8,float8,text,text,jsonb,text,text,boolean) OWNER TO postgres;
ALTER FUNCTION public.discover_v2_nearest_city(float8,float8) OWNER TO postgres;
ALTER FUNCTION public.discover_v2_claim_tm_budget(date,integer) OWNER TO postgres;
ALTER FUNCTION public.discover_v2_tm_budget_available(date,integer) OWNER TO postgres;
ALTER FUNCTION public.discover_v2_facets_exact(text[],float8,float8,float8,text,text,jsonb,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.discover_v2_from_price_minor(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.discover_v2_event_base(text[],timestamptz,timestamptz,text[],text[],text[],float8,float8,float8) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.discover_v2_stay_room_available(uuid,date,date,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.discover_v2_city_context(text[],float8,float8,float8,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.discover_v2_items(text,text[],float8,float8,float8,text,jsonb,int,int) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.discover_v2_facets(text[],float8,float8,float8,text,text,jsonb,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.discover_v2_option_count(text[],float8,float8,text,text,jsonb,text,text,boolean) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.discover_v2_nearest_city(float8,float8) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.discover_v2_claim_tm_budget(date,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.discover_v2_tm_budget_available(date,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.discover_v2_facets_exact(text[],float8,float8,float8,text,text,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.discover_v2_event_base(text[],timestamptz,timestamptz,text[],text[],text[],float8,float8,float8) TO service_role;
GRANT EXECUTE ON FUNCTION public.discover_v2_from_price_minor(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.discover_v2_stay_room_available(uuid,date,date,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.discover_v2_city_context(text[],float8,float8,float8,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.discover_v2_items(text,text[],float8,float8,float8,text,jsonb,int,int) TO service_role;
GRANT EXECUTE ON FUNCTION public.discover_v2_facets(text[],float8,float8,float8,text,text,jsonb,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.discover_v2_option_count(text[],float8,float8,text,text,jsonb,text,text,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.discover_v2_nearest_city(float8,float8) TO service_role;
GRANT EXECUTE ON FUNCTION public.discover_v2_claim_tm_budget(date,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.discover_v2_tm_budget_available(date,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.discover_v2_window(text,text,timestamptz), public.discover_v2_city_key(text,text,float8,float8), public.discover_v2_radius_km(text) TO service_role;

-- #2489's registry is the exact set of objects whose own catalog definitions
-- reference the privacy helpers. discover_v2_items delegates to the canonical
-- reader; the pre-existing V1 carrier remains direct and already has a row.
INSERT INTO public.issue_2489_gate_carriers(object_name,object_kind)
VALUES ('discover_v2_event_base','function')
ON CONFLICT DO NOTHING;

COMMIT;
