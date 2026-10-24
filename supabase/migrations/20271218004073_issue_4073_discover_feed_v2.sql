BEGIN;

-- MINGLA-INVARIANT: I-DISCOVER-CITY-TZ | issue #4073 | All v2 calendar windows are owned by this SQL helper; clients send intent, never UTC window math.
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

-- MINGLA-INVARIANT: I-DISCOVER-ONE-PRICE-OWNER | issue #4073 | Visible, enabled, non-hidden tiers alone determine Discover's all-in from price.
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
      'price',jsonb_build_object('currency',COALESCE(r->>'pricing_currency',r->>'currency'),'listMinor',public.discover_v2_from_price_minor((r->>'id')::uuid),'saleMinor',NULL,'saleEndsAt',NULL,'isFree',COALESCE((r->>'price_min_cents')::int,0)=0,'unit','each'),
      'route',jsonb_build_object('pathname',CASE WHEN r->>'event_type'='rsvp' THEN '/rsvp/[slug]' ELSE '/event/[slug]' END,'params',jsonb_build_object('slug',r->>'slug'))
    )), '[]'::jsonb) INTO v_rows FROM jsonb_array_elements(COALESCE(v_source->'rows','[]'::jsonb)) r;
  ELSIF p_kind = 'trips' THEN
    WITH eligible AS (
      SELECT e.id,e.slug,e.brand_id,e.title,e.destination_text,e.departure_text,e.cover_media_url,e.cover_media_type,e.timezone,e.currency,
        e.destination_place_key,e.departure_place_key,b.slug brand_slug,b.name brand_name,b.profile_photo_url,
        ed.start_at,ed.end_at,public.discover_v2_from_price_minor(e.id) price_minor,count(*) over() total_count
      FROM public.events e JOIN public.brands b ON b.id=e.brand_id AND b.deleted_at IS NULL
      JOIN public.event_dates ed ON ed.event_id=e.id AND ed.is_master IS TRUE AND ed.end_at>=now()
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
      'meta',jsonb_build_object('venueOrPlace',destination_text),'price',jsonb_build_object('currency',currency,'listMinor',price_minor,'saleMinor',NULL,'saleEndsAt',NULL,'isFree',price_minor IS NULL,'unit','each'),
      'route',jsonb_build_object('pathname','/trip/[slug]','params',jsonb_build_object('slug',slug))
    ) ORDER BY start_at,id),'[]'::jsonb) INTO v_total,v_rows FROM eligible;
  ELSIF p_kind = 'experiences' THEN
    WITH eligible AS (
      SELECT e.id,e.slug,e.brand_id,e.title,e.location_text,e.cover_media_url,e.cover_media_type,e.timezone,e.currency,b.slug brand_slug,b.name brand_name,b.profile_photo_url,
        ed.start_at,ed.end_at,public.discover_v2_from_price_minor(e.id) price_minor,count(*) over() total_count
      FROM public.events e JOIN public.brands b ON b.id=e.brand_id AND b.deleted_at IS NULL
      JOIN public.event_dates ed ON ed.event_id=e.id AND ed.is_master IS TRUE AND ed.end_at>=now()
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
      'meta',jsonb_build_object('venueOrPlace',location_text),'price',jsonb_build_object('currency',currency,'listMinor',price_minor,'saleMinor',NULL,'saleEndsAt',NULL,'isFree',price_minor IS NULL,'unit','each'),
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

CREATE OR REPLACE FUNCTION public.discover_v2_facets(
  p_city_names text[], p_lat float8, p_lng float8, p_radius_km float8, p_tz text,
  p_kind text, p_filters jsonb, p_currency text
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_kind text; v_page jsonb; v_kinds jsonb := '{}'::jsonb; v_selected bigint := 0; v_groups jsonb := '[]'::jsonb; v_enabled boolean := false;
BEGIN
  FOREACH v_kind IN ARRAY ARRAY['events','experiences','trips','stays'] LOOP
    v_page := public.discover_v2_items(v_kind,p_city_names,p_lat,p_lng,p_radius_km,p_tz,'{}'::jsonb,0,1);
    v_kinds := v_kinds || jsonb_build_object(v_kind,jsonb_build_object('total',COALESCE((v_page->>'total')::bigint,0),'available',COALESCE((v_page->>'total')::bigint,0)>0));
  END LOOP;
  v_page := public.discover_v2_items(p_kind,p_city_names,p_lat,p_lng,p_radius_km,p_tz,p_filters,0,1);
  v_selected := COALESCE((v_page->>'total')::bigint,0);
  SELECT COALESCE(is_enabled,false) INTO v_enabled FROM public.feature_flags WHERE flag_key='STAY_PUBLIC_PAGES';
  IF p_kind IN ('events','experiences') THEN
    v_groups := jsonb_build_array(jsonb_build_object('id','price','multi',true,'options','[]'::jsonb));
  ELSIF p_kind='trips' THEN
    v_groups := jsonb_build_array(
      jsonb_build_object('id','destination','multi',false,'options',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',destination_place_key,'label',destination_city||', '||destination_country_code,'count',c)) FROM (SELECT destination_place_key,destination_city,destination_country_code,count(*) c FROM public.events WHERE event_type='trip' AND deleted_at IS NULL AND destination_place_key IS NOT NULL GROUP BY 1,2,3) x),'[]'::jsonb)),
      jsonb_build_object('id','leavingFrom','multi',false,'options',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',departure_place_key,'label',departure_city||', '||departure_country_code,'count',c)) FROM (SELECT departure_place_key,departure_city,departure_country_code,count(*) c FROM public.events WHERE event_type='trip' AND deleted_at IS NULL AND departure_place_key IS NOT NULL GROUP BY 1,2,3) x),'[]'::jsonb)));
  ELSE
    v_groups := jsonb_build_array(jsonb_build_object('id','guests','multi',false,'options','[]'::jsonb),jsonb_build_object('id','propertyKind','multi',true,'options','[]'::jsonb));
  END IF;
  RETURN jsonb_build_object('cityKey',public.discover_v2_city_key(p_city_names[1],NULL,p_lat,p_lng),'kinds',v_kinds,'selected',jsonb_build_object('kind',p_kind,'total',v_selected,'minglaTotal',v_selected),'groups',v_groups,'nearestCity',NULL,'stays',jsonb_build_object('enabled',v_enabled));
END;
$function$;

ALTER FUNCTION public.discover_v2_window(text,text,timestamptz) OWNER TO postgres;
ALTER FUNCTION public.discover_v2_city_key(text,text,float8,float8) OWNER TO postgres;
ALTER FUNCTION public.discover_v2_radius_km(text) OWNER TO postgres;
ALTER FUNCTION public.discover_v2_city_context(text[],float8,float8,float8,text) OWNER TO postgres;
ALTER FUNCTION public.discover_v2_from_price_minor(uuid) OWNER TO postgres;
ALTER FUNCTION public.discover_v2_items(text,text[],float8,float8,float8,text,jsonb,int,int) OWNER TO postgres;
ALTER FUNCTION public.discover_v2_facets(text[],float8,float8,float8,text,text,jsonb,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.discover_v2_city_context(text[],float8,float8,float8,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.discover_v2_items(text,text[],float8,float8,float8,text,jsonb,int,int) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.discover_v2_facets(text[],float8,float8,float8,text,text,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.discover_v2_city_context(text[],float8,float8,float8,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.discover_v2_items(text,text[],float8,float8,float8,text,jsonb,int,int) TO service_role;
GRANT EXECUTE ON FUNCTION public.discover_v2_facets(text[],float8,float8,float8,text,text,jsonb,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.discover_v2_window(text,text,timestamptz), public.discover_v2_city_key(text,text,float8,float8), public.discover_v2_radius_km(text) TO service_role;

INSERT INTO public.issue_2489_gate_carriers(object_name,object_kind) VALUES ('discover_v2_items','function') ON CONFLICT DO NOTHING;

COMMIT;
