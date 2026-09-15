-- Independent #3439 retest: server removal, gallery independence, poisoned
-- legacy-job evidence, visibility failures and replay atomicity. Actual RPCs.
-- Local owner-body fixture is NOT full-chain/RLS proof; CI replays full chain.
\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.cover_race_seed()
RETURNS TABLE(actor uuid, brand uuid, event uuid) LANGUAGE plpgsql AS $$
BEGIN
  actor:=gen_random_uuid(); brand:=gen_random_uuid(); event:=gen_random_uuid();
  INSERT INTO auth.users(id,email) VALUES(actor,'qa3439-'||actor||'@example.invalid');
  INSERT INTO public.creator_accounts(id) VALUES(actor);
  INSERT INTO public.brands(id,account_id,name,slug,default_currency)
    VALUES(brand,actor,'Independent cover QA','qa3439-'||brand,'USD');
  PERFORM set_config('request.jwt.claim.sub',actor::text,true);
  INSERT INTO public.events(id,brand_id,created_by,title,slug,event_type,status,visibility,timezone,currency,theme,
    cover_media_url,cover_media_type,cover_media_poster_url,cover_media_provider,cover_media_credit,
    cover_media_gallery,location_geo,coordinate_precision)
  VALUES(event,brand,actor,'Cover QA','draft-'||event,'event','draft','draft','UTC','USD',
    '{"business_draft":{"clientRevision":0,"requestedVisibility":"public"}}',
    'https://example.invalid/server.jpg','image','https://example.invalid/server.jpg','upload','Server provenance',
    '[{"url":"https://example.invalid/gallery.jpg","type":"image"}]',point(-73,40),'exact');
  RETURN NEXT;
END $$;

CREATE FUNCTION pg_temp.cover_race_payload() RETURNS jsonb LANGUAGE sql AS $$
  SELECT '{"title":"Cover QA","currency":"USD","timezone":"UTC",
    "cover_media_url":"https://example.invalid/old.jpg","cover_media_type":"image",
    "cover_media_poster_url":"https://example.invalid/old.jpg","__coverBase":"https://example.invalid/old.jpg",
    "theme":{"business_draft":{"requestedVisibility":"public","format":"in_person","city":"New York",
      "partyTypes":["club-night"],"whenMode":"single","when":{"date":"2099-06-01","doorsOpen":"18:00","endsAt":"20:00"},
      "tickets":[{"name":"Free","isFree":true,"capacity":20}]}}}'::jsonb
$$;

DO $proof$
DECLARE f record; other_event uuid; use_wrapper boolean; scenario text;
  payload jsonb; result jsonb; saved public.events; expected_url text;
  n integer:=0; rejected boolean; message text; original_gallery jsonb;
  counts_before jsonb; counts_after jsonb;
BEGIN
  FOREACH use_wrapper IN ARRAY ARRAY[false,true] LOOP
    FOREACH scenario IN ARRAY ARRAY['server-removal','server-image','gallery-clear','explicit-new-image','expired-job','other-event-job'] LOOP
      SELECT * INTO f FROM pg_temp.cover_race_seed();
      SELECT cover_media_gallery INTO original_gallery FROM public.events WHERE id=f.event;
      payload:=pg_temp.cover_race_payload();
      expected_url:='https://example.invalid/server.jpg';
      IF scenario='server-removal' THEN
        UPDATE public.events SET cover_media_url=NULL,cover_media_type=NULL,
          cover_media_poster_url=NULL,cover_media_provider=NULL,cover_media_credit=NULL WHERE id=f.event;
        expected_url:=NULL;
      ELSIF scenario='gallery-clear' THEN
        payload:=payload||'{"cover_media_gallery":[]}'::jsonb;
      ELSIF scenario='explicit-new-image' THEN
        payload:=payload||'{"cover_media_url":"https://example.invalid/intended.jpg","cover_media_poster_url":null,
          "cover_media_provider":"upload","cover_media_credit":"Host provenance"}'::jsonb;
        expected_url:='https://example.invalid/intended.jpg';
      ELSIF scenario IN ('expired-job','other-event-job') THEN
        payload:=(payload-'__coverBase')||'{"cover_media_url":null,"cover_media_type":null,"cover_media_poster_url":null}'::jsonb;
        expected_url:=NULL;
        UPDATE public.events SET cover_media_url='https://example.invalid/server.mp4',cover_media_type='video',
          cover_media_poster_url='https://example.invalid/poster.jpg' WHERE id=f.event;
        -- A job on another row, or older than the row, is not authority to
        -- override a base-less caller. Both jobs are otherwise real-shaped.
        other_event:=f.event;
        IF scenario='other-event-job' THEN
          other_event:=gen_random_uuid();
          INSERT INTO public.events(id,brand_id,created_by,title,slug,event_type,status,visibility,timezone,currency,theme)
            VALUES(other_event,f.brand,f.actor,'Other row','draft-'||other_event,'event','draft','draft','UTC','USD','{}');
        END IF;
        INSERT INTO public.event_cover_video_jobs(requested_by,event_id,brand_id,provider,status,
          apply_mode,target_kind,source_asset_id,source_duration_ms,trim_start_ms,trim_end_ms,
          processed_url,processed_poster_url,processed_mime_type,processed_bytes,processed_duration_ms,applied_at)
        VALUES(f.actor,other_event,f.brand,'bunny','applied','draft_auto','event','qa-'||f.event,13000,0,13000,
          'https://example.invalid/server.mp4','https://example.invalid/poster.jpg','video/mp4',4096,13000,
          CASE WHEN scenario='expired-job' THEN now()-interval '2 hours' ELSE now() END);
      END IF;
      result:=CASE WHEN use_wrapper THEN public.issue_1719_publish_event_with_poster(f.event,payload,9)
        ELSE public.business_publish_event_draft(f.event,payload,9) END;
      SELECT * INTO saved FROM public.events WHERE id=f.event;
      IF saved.cover_media_url IS DISTINCT FROM expected_url
        OR saved.cover_media_type IS DISTINCT FROM (CASE WHEN expected_url IS NULL THEN NULL ELSE 'image' END)
        OR saved.cover_media_poster_url IS DISTINCT FROM expected_url THEN
        RAISE EXCEPTION '#3439 tester % wrapper=%: expected %, got %/%/%',scenario,use_wrapper,expected_url,
          saved.cover_media_url,saved.cover_media_type,saved.cover_media_poster_url;
      END IF;
      IF expected_url IS NULL AND (saved.cover_media_provider IS NOT NULL OR saved.cover_media_credit IS NOT NULL)
        OR expected_url IS NOT NULL AND saved.cover_media_credit IS DISTINCT FROM
          (CASE WHEN scenario='explicit-new-image' THEN 'Host provenance' ELSE 'Server provenance' END) THEN
        RAISE EXCEPTION '#3439 tester %: cover provenance not atomic',scenario;
      END IF;
      IF saved.cover_media_gallery IS DISTINCT FROM (CASE WHEN scenario='gallery-clear' THEN '[]'::jsonb ELSE original_gallery END)
        OR saved.location_geo[0]<>-73 OR saved.coordinate_precision<>'exact'
        OR result#>>'{event,cover_media_url}' IS DISTINCT FROM expected_url
        OR result#>>'{event,cover_media_poster_url}' IS DISTINCT FROM expected_url
        OR saved.theme ? '__coverBase' OR saved.theme#>'{business_event}' ? '__coverBase' THEN
        RAISE EXCEPTION '#3439 tester %: collateral write or transport leak',scenario;
      END IF;
      n:=n+1;
      -- Retrying the very same publish must fail before multiplying dates/tickets.
      IF scenario='server-image' THEN
        SELECT jsonb_build_array((SELECT count(*) FROM public.event_dates WHERE event_id=f.event),
          (SELECT count(*) FROM public.ticket_types WHERE event_id=f.event)) INTO counts_before;
        rejected:=false;
        BEGIN
          IF use_wrapper THEN PERFORM public.issue_1719_publish_event_with_poster(f.event,payload,9);
          ELSE PERFORM public.business_publish_event_draft(f.event,payload,9); END IF;
        EXCEPTION WHEN OTHERS THEN
          GET STACKED DIAGNOSTICS message=MESSAGE_TEXT;
          IF message<>'event_draft_not_publishable' THEN RAISE; END IF;
          rejected:=true;
        END;
        SELECT jsonb_build_array((SELECT count(*) FROM public.event_dates WHERE event_id=f.event),
          (SELECT count(*) FROM public.ticket_types WHERE event_id=f.event)) INTO counts_after;
        IF NOT rejected OR counts_before IS DISTINCT FROM counts_after THEN
          RAISE EXCEPTION '#3439 tester replay was not atomic';
        END IF;
        n:=n+1;
      END IF;
    END LOOP;
  END LOOP;
  FOR payload IN SELECT jsonb_set(pg_temp.cover_race_payload(),'{theme,business_draft,requestedVisibility}',v)
    FROM (VALUES ('null'::jsonb),('false'::jsonb),('"PUBLIC"'::jsonb)) invalid(v) LOOP
    SELECT * INTO f FROM pg_temp.cover_race_seed();
    rejected:=false;
    BEGIN
      PERFORM public.issue_1719_publish_event_with_poster(f.event,payload,9);
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS message=MESSAGE_TEXT;
      IF message<>'event_visibility_invalid' THEN RAISE; END IF;
      rejected:=true;
    END;
    IF NOT rejected OR (SELECT status FROM public.events WHERE id=f.event)<>'draft'
      OR EXISTS(SELECT 1 FROM public.event_dates WHERE event_id=f.event)
      OR EXISTS(SELECT 1 FROM public.ticket_types WHERE event_id=f.event) THEN
      RAISE EXCEPTION '#3439 tester wrapper visibility gate leaked partial publish';
    END IF;
    n:=n+1;
  END LOOP;
  IF n<>17 THEN RAISE EXCEPTION '#3439 tester missing cases: %',n; END IF;
  RAISE NOTICE '#3439 tester PASS: % adversarial inner/wrapper cases',n;
END $proof$;
ROLLBACK;
