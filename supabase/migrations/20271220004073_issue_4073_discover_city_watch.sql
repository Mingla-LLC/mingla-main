BEGIN;

-- MINGLA-INVARIANT: I-DISCOVER-CITY-WATCH-ONCE | issue #4073 | One watch row owns one idempotency key and is marked notified in the enqueue transaction.
CREATE TABLE IF NOT EXISTS public.discover_city_watch (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  city_key text NOT NULL CHECK (char_length(city_key) BETWEEN 3 AND 200),
  city_label text NOT NULL CHECK (char_length(btrim(city_label)) BETWEEN 1 AND 120),
  city_name text NULL CHECK (city_name IS NULL OR char_length(city_name)<=120),
  state_code text NULL CHECK (state_code IS NULL OR char_length(state_code)<=10),
  country_code char(2) NULL CHECK (country_code IS NULL OR country_code~'^[A-Z]{2}$'),
  lat float8 NOT NULL CHECK(lat BETWEEN -90 AND 90),
  lng float8 NOT NULL CHECK(lng BETWEEN -180 AND 180),
  created_at timestamptz NOT NULL DEFAULT now(), notified_at timestamptz NULL,
  UNIQUE(user_id,city_key)
);
CREATE INDEX IF NOT EXISTS idx_discover_city_watch_pending ON public.discover_city_watch(city_key) WHERE notified_at IS NULL;
ALTER TABLE public.discover_city_watch ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dcw_owner_select ON public.discover_city_watch;
CREATE POLICY dcw_owner_select ON public.discover_city_watch FOR SELECT TO authenticated USING(auth.uid()=user_id);
DROP POLICY IF EXISTS dcw_owner_delete ON public.discover_city_watch;
CREATE POLICY dcw_owner_delete ON public.discover_city_watch FOR DELETE TO authenticated USING(auth.uid()=user_id);
REVOKE ALL ON TABLE public.discover_city_watch FROM PUBLIC,anon,authenticated;
GRANT SELECT,DELETE ON TABLE public.discover_city_watch TO authenticated;
GRANT ALL ON TABLE public.discover_city_watch TO service_role;

CREATE OR REPLACE FUNCTION public.discover_city_watch_subscribe(p_name text,p_state_code text,p_country_code text,p_lat float8,p_lng float8,p_label text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_user uuid:=auth.uid(); v_key text; v_id uuid; v_country text:=upper(NULLIF(btrim(p_country_code),''));
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'city_watch_forbidden' USING ERRCODE='42501'; END IF;
  IF p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 OR char_length(btrim(p_label)) NOT BETWEEN 1 AND 120
    OR (v_country IS NOT NULL AND v_country!~'^[A-Z]{2}$') OR (p_name IS NOT NULL AND char_length(p_name)>120) OR (p_state_code IS NOT NULL AND char_length(p_state_code)>10)
  THEN RAISE EXCEPTION 'city_watch_invalid' USING ERRCODE='22023'; END IF;
  IF (SELECT count(*) FROM public.discover_city_watch WHERE user_id=v_user AND notified_at IS NULL)>=20
    AND NOT EXISTS(SELECT 1 FROM public.discover_city_watch WHERE user_id=v_user AND city_key=public.discover_v2_city_key(p_name,v_country,p_lat,p_lng))
  THEN RAISE EXCEPTION 'city_watch_limit' USING ERRCODE='22023'; END IF;
  v_key:=public.discover_v2_city_key(p_name,v_country,p_lat,p_lng);
  INSERT INTO public.discover_city_watch(user_id,city_key,city_label,city_name,state_code,country_code,lat,lng,notified_at,created_at)
  VALUES(v_user,v_key,btrim(p_label),NULLIF(btrim(p_name),''),NULLIF(btrim(p_state_code),''),v_country,p_lat,p_lng,NULL,now())
  ON CONFLICT(user_id,city_key) DO UPDATE SET city_label=excluded.city_label,city_name=excluded.city_name,state_code=excluded.state_code,country_code=excluded.country_code,lat=excluded.lat,lng=excluded.lng,notified_at=NULL,created_at=now()
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('watchId',v_id,'cityKey',v_key,'subscribed',true);
END;
$function$;
ALTER FUNCTION public.discover_city_watch_subscribe(text,text,text,float8,float8,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.discover_city_watch_subscribe(text,text,text,float8,float8,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.discover_city_watch_subscribe(text,text,text,float8,float8,text) TO authenticated,service_role;

INSERT INTO public.notification_categories(key,section,is_transactional,urgency,default_channels,reach_mode,active)
VALUES('discover_city_plans_live','Reminders',true,'normal',ARRAY['inapp','push','email']::text[],'reach_once',true)
ON CONFLICT(key) DO UPDATE SET section=excluded.section,is_transactional=excluded.is_transactional,urgency=excluded.urgency,default_channels=excluded.default_channels,reach_mode=excluded.reach_mode,active=true;

CREATE OR REPLACE FUNCTION public.issue_4073_scan_city_watches(p_city_limit int DEFAULT 50)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_city record; v_watch record; v_facets jsonb; v_total bigint; v_enqueued int:=0;
BEGIN
  IF p_city_limit NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'city_watch_scan_limit' USING ERRCODE='22023'; END IF;
  FOR v_city IN SELECT DISTINCT ON(city_key) city_key,city_name,country_code,lat,lng FROM public.discover_city_watch WHERE notified_at IS NULL ORDER BY city_key,created_at LIMIT p_city_limit LOOP
    v_facets:=public.discover_v2_facets(CASE WHEN v_city.city_name IS NULL THEN '{}'::text[] ELSE ARRAY[v_city.city_name] END,v_city.lat,v_city.lng,50,'UTC','events','{}'::jsonb,NULL);
    SELECT COALESCE(sum((value->>'total')::bigint),0) INTO v_total FROM jsonb_each(v_facets->'kinds');
    IF v_total>0 THEN
      FOR v_watch IN SELECT w.*,COALESCE(p.preferred_language,'en') lang FROM public.discover_city_watch w LEFT JOIN public.profiles p ON p.id=w.user_id WHERE w.city_key=v_city.city_key AND w.notified_at IS NULL FOR UPDATE OF w SKIP LOCKED LOOP
        INSERT INTO public.notification_outbox(category_key,user_id,brand_id,country_code,payload,idempotency_key,status)
        VALUES('discover_city_plans_live',v_watch.user_id,NULL,v_watch.country_code,jsonb_build_object('city_label',v_watch.city_label,'city_key',v_watch.city_key,'lang',v_watch.lang,'deep_link','mingla://discover?watchCity='||replace(v_watch.city_key,' ','%20')),'discover_city_plans_live:'||v_watch.id::text,'pending')
        ON CONFLICT(idempotency_key) DO NOTHING;
        UPDATE public.discover_city_watch SET notified_at=now() WHERE id=v_watch.id AND notified_at IS NULL;
        v_enqueued:=v_enqueued+1;
      END LOOP;
    END IF;
  END LOOP;
  RETURN v_enqueued;
END;
$function$;
ALTER FUNCTION public.issue_4073_scan_city_watches(integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.issue_4073_scan_city_watches(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4073_scan_city_watches(integer) TO service_role;

DO $cron$ DECLARE v_job bigint; BEGIN
  SELECT jobid INTO v_job FROM cron.job WHERE jobname='issue_4073_city_watch_scan';
  IF v_job IS NOT NULL THEN PERFORM cron.unschedule(v_job); END IF;
END $cron$;
SELECT cron.schedule('issue_4073_city_watch_scan','*/10 * * * *',$cron$SELECT public.issue_4073_scan_city_watches(50);$cron$);

COMMIT;
