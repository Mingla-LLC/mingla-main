-- #3439 implementor guard. Runs the actual inner publish owner AND the actual
-- application wrapper. The fixture represents the committed row after provider
-- apply; it does not claim to test the webhook. CI runs on the full chain.
-- Local PG17 owner-body rehearsal uses declared minimal schema dependencies;
-- full-chain constraints/triggers/RLS still require this existing CI lane.
\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.publish_cover_fixture(p_cover boolean)
RETURNS TABLE(actor uuid, brand uuid, event uuid) LANGUAGE plpgsql AS $$
BEGIN
  actor:=gen_random_uuid(); brand:=gen_random_uuid(); event:=gen_random_uuid();
  INSERT INTO auth.users(id,email) VALUES(actor,'publish-cover-'||actor||'@example.test');
  INSERT INTO public.creator_accounts(id) VALUES(actor);
  INSERT INTO public.brands(id,account_id,name,slug,default_currency)
    VALUES(brand,actor,'Publish cover','publish-cover-'||brand,'USD');
  PERFORM set_config('request.jwt.claim.sub',actor::text,true);
  INSERT INTO public.events(id,brand_id,created_by,title,slug,event_type,status,visibility,timezone,currency,theme,
    cover_media_url,cover_media_type,cover_media_poster_url,cover_media_provider,
    cover_media_source_url,cover_media_credit,cover_media_credit_url,cover_media_alt,
    cover_media_gallery,location_geo,coordinate_precision)
  VALUES(event,brand,actor,'Cover race','draft-cover-'||event,'event','draft','draft','UTC','USD',
    '{"business_draft":{"clientRevision":0,"requestedVisibility":"public"}}',
    CASE WHEN p_cover THEN 'https://video.example.test/server.mp4' END,
    CASE WHEN p_cover THEN 'video' END,
    CASE WHEN p_cover THEN 'https://video.example.test/poster.jpg' END,
    CASE WHEN p_cover THEN 'upload' END,
    CASE WHEN p_cover THEN 'https://video.example.test/source.mp4' END,
    CASE WHEN p_cover THEN 'Host' END,
    CASE WHEN p_cover THEN 'https://video.example.test/credit' END,
    CASE WHEN p_cover THEN 'Server cover' END,
    '[]',point(-73,40),'approximate');
  RETURN NEXT;
END $$;

CREATE FUNCTION pg_temp.publish_cover_payload(p_url text,p_type text,p_poster text,p_base text)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('title','Cover race','timezone','UTC','currency','USD',
    'cover_media_url',p_url,'cover_media_type',p_type,'cover_media_poster_url',p_poster,
    'theme',jsonb_build_object('business_draft',jsonb_build_object(
      'requestedVisibility','public','format','in_person','city','New York',
      'partyTypes',jsonb_build_array('club-night'),'whenMode','single',
      'when',jsonb_build_object('date','2099-06-01','doorsOpen','18:00','endsAt','20:00'),
      'tickets',jsonb_build_array(jsonb_build_object('name','Free','isFree',true,'capacity',20)))))
    || CASE WHEN p_base='omit' THEN '{}'::jsonb ELSE jsonb_build_object('__coverBase',p_base) END
$$;

DO $proof$
DECLARE f record; c record; use_wrapper boolean; payload jsonb; result jsonb; stored public.events;
  server_url text:='https://video.example.test/server.mp4';
  server_poster text:='https://video.example.test/poster.jpg';
  message text; rejected boolean; count_cases integer:=0;
BEGIN
  FOREACH use_wrapper IN ARRAY ARRAY[false,true] LOOP
    FOR c IN SELECT * FROM (VALUES
      ('unseen-server',true,NULL::text,NULL::text,NULL::text,NULL::text,'server'),
      ('read-then-apply',true,'https://image.example.test/old.jpg','image','https://image.example.test/old.jpg','https://image.example.test/old.jpg','server'),
      ('explicit-image',true,'https://image.example.test/new.jpg','image',NULL,NULL,'image'),
      ('explicit-video',true,'https://video.example.test/new.mp4','video','https://video.example.test/new.jpg',NULL,'video'),
      ('intentional-clear',true,NULL,NULL,NULL,'https://video.example.test/server.mp4','clear'),
      ('coverless-publish',false,NULL,NULL,NULL,NULL,'clear'),
      ('legacy-applied',true,NULL,NULL,NULL,'omit','server'),
      ('legacy-no-job',true,NULL,NULL,NULL,'omit','clear')
    ) AS cases(label,has_cover,url,kind,poster,base,expected) LOOP
      SELECT * INTO f FROM pg_temp.publish_cover_fixture(c.has_cover);
      IF c.label='legacy-applied' THEN
        INSERT INTO public.event_cover_video_jobs(requested_by,event_id,brand_id,provider,status,
          apply_mode,target_kind,source_asset_id,source_duration_ms,trim_start_ms,trim_end_ms,
          processed_url,processed_poster_url,processed_mime_type,processed_bytes,processed_duration_ms,applied_at)
        VALUES(f.actor,f.event,f.brand,'bunny','applied','draft_auto','event','guid-'||f.event,13000,0,13000,
          server_url,server_poster,'video/mp4',4096,13000,now());
      END IF;
      payload:=pg_temp.publish_cover_payload(c.url,c.kind,c.poster,c.base);
      result:=CASE WHEN use_wrapper THEN public.issue_1719_publish_event_with_poster(f.event,payload,7)
        ELSE public.business_publish_event_draft(f.event,payload,7) END;
      SELECT * INTO stored FROM public.events WHERE id=f.event;
      IF stored.cover_media_url IS DISTINCT FROM (CASE c.expected WHEN 'server' THEN server_url ELSE c.url END)
        OR stored.cover_media_type IS DISTINCT FROM (CASE c.expected WHEN 'server' THEN 'video' ELSE c.kind END)
        OR stored.cover_media_poster_url IS DISTINCT FROM (CASE c.expected WHEN 'server' THEN server_poster WHEN 'image' THEN c.url ELSE c.poster END) THEN
        RAISE EXCEPTION '#3439 % wrapper=%: URL/type/poster lost: %/%/%',c.label,use_wrapper,stored.cover_media_url,stored.cover_media_type,stored.cover_media_poster_url;
      END IF;
      IF c.expected='server' AND (stored.cover_media_provider IS DISTINCT FROM 'upload'
        OR stored.cover_media_source_url IS DISTINCT FROM 'https://video.example.test/source.mp4'
        OR stored.cover_media_credit IS DISTINCT FROM 'Host'
        OR stored.cover_media_credit_url IS DISTINCT FROM 'https://video.example.test/credit'
        OR stored.cover_media_alt IS DISTINCT FROM 'Server cover') THEN
        RAISE EXCEPTION '#3439 %: cover metadata split',c.label;
      END IF;
      IF result#>>'{event,cover_media_poster_url}' IS DISTINCT FROM stored.cover_media_poster_url
        OR result#>>'{event,cover_media_url}' IS DISTINCT FROM stored.cover_media_url
        OR result->>'client_revision' IS DISTINCT FROM '7'
        OR stored.status IS DISTINCT FROM 'scheduled'
        OR stored.location_geo[0] IS DISTINCT FROM -73::double precision
        OR stored.coordinate_precision IS DISTINCT FROM 'approximate'
        OR jsonb_array_length(result->'tickets')<>1 OR jsonb_array_length(result->'eventDates')<>1
        OR stored.theme ? '__coverBase' OR stored.theme#>'{business_event}' ? '__coverBase' THEN
        RAISE EXCEPTION '#3439 %: publish envelope / existing behavior changed',c.label;
      END IF;
      count_cases:=count_cases+1;
    END LOOP;
    -- Invalid explicit triplets still reject, even when the URL merge would keep
    -- a stored cover. Validate both entry points, no arbitrary true auth stub.
    FOR payload IN SELECT * FROM (VALUES
      (pg_temp.publish_cover_payload('https://video.example.test/new.mp4','video',NULL,NULL)),
      (pg_temp.publish_cover_payload(NULL,'video',NULL,NULL)),
      (pg_temp.publish_cover_payload('https://image.example.test/new.jpg','image','https://image.example.test/wrong.jpg',NULL))
    ) invalid(p) LOOP
      SELECT * INTO f FROM pg_temp.publish_cover_fixture(true);
      rejected:=false;
      BEGIN
        IF use_wrapper THEN PERFORM public.issue_1719_publish_event_with_poster(f.event,payload,7);
        ELSE PERFORM public.business_publish_event_draft(f.event,payload,7); END IF;
      EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS message=MESSAGE_TEXT;
        IF message<>'invalid_cover_media_triplet' THEN RAISE; END IF;
        rejected:=true;
      END;
      IF NOT rejected OR (SELECT status FROM public.events WHERE id=f.event)<>'draft' THEN
        RAISE EXCEPTION '#3439 invalid triplet accepted or partly published';
      END IF;
      count_cases:=count_cases+1;
    END LOOP;
    SELECT * INTO f FROM pg_temp.publish_cover_fixture(true);
    PERFORM set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
    rejected:=false;
    BEGIN
      payload:=pg_temp.publish_cover_payload(NULL,NULL,NULL,NULL);
      IF use_wrapper THEN PERFORM public.issue_1719_publish_event_with_poster(f.event,payload,7);
      ELSE PERFORM public.business_publish_event_draft(f.event,payload,7); END IF;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS message=MESSAGE_TEXT;
      IF message<>'insufficient_event_permission' THEN RAISE; END IF;
      rejected:=true;
    END;
    IF NOT rejected OR (SELECT status FROM public.events WHERE id=f.event)<>'draft' THEN
      RAISE EXCEPTION '#3439 cross-tenant publish accepted';
    END IF;
    count_cases:=count_cases+1;
  END LOOP;
  IF count_cases<>24 THEN RAISE EXCEPTION '#3439 missing cases: %',count_cases; END IF;
  RAISE NOTICE '#3439 PASS: % actual inner/wrapper publish cases',count_cases;
END $proof$;
ROLLBACK;
