\set ON_ERROR_STOP on
SET ROLE service_role;
DO $$DECLARE a jsonb; b jsonb; l uuid; BEGIN
  a:=public.upsert_content_share_version_with_native_snapshot(
    'place','00000000-0000-0000-0000-000000000201','issue1719:native:place',
    '{"placePoolId":"fixture"}','{}','{"schemaVersion":1,"kind":"place","title":"Snapshot Cafe"}',NULL,
    '{"kind":"place","publicDetails":{"kind":"place"}}',
    '{"contract":"native_content_card_snapshot_v1","version":1,"kind":"place","id":"fixture","title":"Snapshot Cafe","category":"Cafe","image":"https://usemingla.com/fixture.jpg"}',
    '{"title":"Snapshot Cafe","category":"Cafe","image":"https://usemingla.com/fixture.jpg","cardType":"single"}');
  b:=public.upsert_content_share_version_with_native_snapshot(
    'place','00000000-0000-0000-0000-000000000201','issue1719:native:place',
    '{"placePoolId":"fixture"}','{}','{"schemaVersion":1,"kind":"place","title":"Snapshot Cafe"}',NULL,
    '{"kind":"place","publicDetails":{"kind":"place"}}',
    '{"contract":"native_content_card_snapshot_v1","version":1,"kind":"place","id":"fixture","title":"Snapshot Cafe","category":"Coffee","image":"https://usemingla.com/fixture.jpg"}',
    '{"title":"Snapshot Cafe","category":"Coffee","image":"https://usemingla.com/fixture.jpg","cardType":"single"}');
  IF (a->>'version')::int<>1 OR (b->>'version')::int<>2 THEN RAISE EXCEPTION 'native fingerprint did not create atomic version'; END IF;
  SELECT id INTO l FROM public.content_share_links WHERE source_key='issue1719:native:place';
  INSERT INTO public.messages(conversation_id,sender_id,content,message_type,card_payload) VALUES(
    '10000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000201','fixture','card',
    jsonb_build_object('contract','content_share_card_v1','id','fixture','title','Snapshot Cafe','category','Place','image',NULL,
      'shareCode',b->>'shortCode','shareVersion',(b->>'version')::int,'kind','place','facts','{"schemaVersion":1,"kind":"place","title":"Snapshot Cafe"}'::jsonb,
      'destination','{"kind":"place"}'::jsonb,'publicDetails',jsonb_build_object('kind','place','description',repeat('x',6000)),'media',NULL));
  IF NOT EXISTS(SELECT 1 FROM public.messages WHERE content='fixture' AND card_payload->'nativeCard'->>'contract'='native_content_card_v1'
    AND octet_length(convert_to(card_payload::text,'UTF8'))<=5120 AND NOT card_payload?'publicDetails') THEN
    RAISE EXCEPTION 'bounded native descriptor not attached'; END IF;
END$$;
RESET ROLE;

SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000201';
DO $$DECLARE mid uuid; resolved integer; BEGIN
  SELECT id INTO mid FROM public.messages WHERE content='fixture';
  SELECT count(*) INTO resolved FROM public.resolve_native_content_card_snapshots(ARRAY[mid]);
  IF resolved<>1 THEN RAISE EXCEPTION 'participant could not resolve snapshot'; END IF;
END$$;
RESET request.jwt.claim.sub;
SELECT 'issue-1719 source-card-fidelity implementor PASS' AS result;
