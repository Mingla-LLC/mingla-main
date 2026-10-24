BEGIN;

WITH destination_match AS (
  SELECT DISTINCT ON (e.id) e.id, sc.name city, upper(sc.country_code) country_code
  FROM public.events e
  JOIN public.seeding_cities sc ON public.mingla_normalize_place_name(sc.name) = public.mingla_normalize_place_name(e.destination_text)
  WHERE e.event_type='trip' AND e.deleted_at IS NULL AND e.destination_place_key IS NULL
    AND NULLIF(sc.country_code,'') IS NOT NULL
  ORDER BY e.id, sc.status='launched' DESC, sc.created_at
)
UPDATE public.events e
SET theme = COALESCE(e.theme,'{}'::jsonb) || jsonb_build_object('business_trip',COALESCE(e.theme->'business_trip','{}'::jsonb) || jsonb_build_object('destinationCity',m.city,'destinationCountryCode',m.country_code))
FROM destination_match m WHERE e.id=m.id;

WITH departure_match AS (
  SELECT DISTINCT ON (e.id) e.id, sc.name city, upper(sc.country_code) country_code
  FROM public.events e
  JOIN public.seeding_cities sc ON public.mingla_normalize_place_name(sc.name) = public.mingla_normalize_place_name(e.departure_text)
  WHERE e.event_type='trip' AND e.deleted_at IS NULL AND e.departure_place_key IS NULL
    AND NULLIF(sc.country_code,'') IS NOT NULL
  ORDER BY e.id, sc.status='launched' DESC, sc.created_at
)
UPDATE public.events e
SET theme = COALESCE(e.theme,'{}'::jsonb) || jsonb_build_object('business_trip',COALESCE(e.theme->'business_trip','{}'::jsonb) || jsonb_build_object('departureCity',m.city,'departureCountryCode',m.country_code))
FROM departure_match m WHERE e.id=m.id;

CREATE OR REPLACE FUNCTION public.admin_set_trip_place(p_event_id uuid,p_side text,p_city text,p_country_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_country text := upper(NULLIF(btrim(p_country_code),'')); v_city text := NULLIF(btrim(p_city),'');
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  IF p_side NOT IN ('destination','departure') OR v_city IS NULL OR v_country !~ '^[A-Z]{2}$' THEN RAISE EXCEPTION 'trip_place_invalid' USING ERRCODE='22023'; END IF;
  UPDATE public.events SET theme = COALESCE(theme,'{}'::jsonb) || jsonb_build_object('business_trip',COALESCE(theme->'business_trip','{}'::jsonb) || CASE WHEN p_side='destination'
    THEN jsonb_build_object('destinationCity',v_city,'destinationCountryCode',v_country)
    ELSE jsonb_build_object('departureCity',v_city,'departureCountryCode',v_country) END)
  WHERE id=p_event_id AND event_type='trip' AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'trip_not_found' USING ERRCODE='P0002'; END IF;
  RETURN jsonb_build_object('eventId',p_event_id,'side',p_side,'city',v_city,'countryCode',v_country);
END;
$function$;
ALTER FUNCTION public.admin_set_trip_place(uuid,text,text,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_set_trip_place(uuid,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_set_trip_place(uuid,text,text,text) TO authenticated,service_role;

COMMIT;
