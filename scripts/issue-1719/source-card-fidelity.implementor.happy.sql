\set ON_ERROR_STOP on
SET ROLE service_role;
DO $$DECLARE a jsonb; b jsonb; l uuid; kind text; BEGIN
  a:=public.upsert_content_share_version_with_native_snapshot(
    'place','00000000-0000-0000-0000-000000000201','issue1719:native:place',
    '{"placePoolId":"fixture"}','{}','{"schemaVersion":1,"kind":"place","title":"Snapshot Cafe"}',NULL,
    '{"kind":"place","publicDetails":{"kind":"place"}}',
    '{"contract":"native_content_card_snapshot_v1","version":1,"kind":"place","id":"fixture","title":"Snapshot Cafe","category":"Cafe","image":"https://usemingla.com/fixture.jpg"}',
    '{"title":"Snapshot Cafe","category":"Cafe","image":"https://usemingla.com/fixture.jpg","cardType":"single"}');
  INSERT INTO public.messages(conversation_id,sender_id,content,message_type,card_payload) VALUES(
    '10000000-0000-0000-0000-000000000202','00000000-0000-0000-0000-000000000201','old-v1','card',
    jsonb_build_object('contract','content_share_card_v1','id','old-v1','title','Snapshot Cafe','category','Place','image',NULL,
      'shareCode',a->>'shortCode','shareVersion',1,'kind','place','facts','{"schemaVersion":1,"kind":"place","title":"Snapshot Cafe"}'::jsonb,
      'destination','{"kind":"place"}'::jsonb,'publicDetails','{"kind":"place"}'::jsonb,'media',NULL));
  b:=public.upsert_content_share_version_with_native_snapshot(
    'place','00000000-0000-0000-0000-000000000201','issue1719:native:place',
    '{"placePoolId":"fixture"}','{}','{"schemaVersion":1,"kind":"place","title":"Snapshot Cafe"}',NULL,
    '{"kind":"place","publicDetails":{"kind":"place"}}',
    '{"contract":"native_content_card_snapshot_v1","version":1,"kind":"place","id":"fixture","title":"Snapshot Cafe","category":"Coffee","image":"https://usemingla.com/fixture.jpg"}',
    '{"title":"Snapshot Cafe","category":"Coffee","image":"https://usemingla.com/fixture.jpg","cardType":"single"}');
  IF (a->>'version')::int<>1 OR (b->>'version')::int<>2 THEN RAISE EXCEPTION 'native fingerprint did not create atomic version'; END IF;
  SELECT id INTO l FROM public.content_share_links WHERE source_key='issue1719:native:place';
  INSERT INTO public.messages(conversation_id,sender_id,content,message_type,card_payload) VALUES(
    '10000000-0000-0000-0000-000000000202','00000000-0000-0000-0000-000000000201','fixture','card',
    jsonb_build_object('contract','content_share_card_v1','id','fixture','title','Snapshot Cafe','category','Place','image',NULL,
      'shareCode',b->>'shortCode','shareVersion',(b->>'version')::int,'kind','place','facts','{"schemaVersion":1,"kind":"place","title":"Snapshot Cafe"}'::jsonb,
      'destination','{"kind":"place"}'::jsonb,'publicDetails',jsonb_build_object('kind','place','description',repeat('x',6000)),'media',NULL));
  IF NOT EXISTS(SELECT 1 FROM public.messages WHERE content='fixture' AND card_payload->'nativeCard'->>'contract'='native_content_card_v1'
    AND card_payload->'nativeCard'->>'snapshotFingerprint'=(SELECT snapshot_fingerprint FROM public.content_share_native_snapshots WHERE link_id=l AND version=2)
    AND octet_length(convert_to(card_payload::text,'UTF8'))<=5120 AND NOT card_payload?'publicDetails') THEN
    RAISE EXCEPTION 'bounded native descriptor not attached'; END IF;
  FOR kind IN SELECT unnest(ARRAY['place','curated','event','rsvp_event','trip','experience','venue','brand']) LOOP
    INSERT INTO public.messages(conversation_id,sender_id,content,message_type,card_payload) VALUES(
      '10000000-0000-0000-0000-000000000202','00000000-0000-0000-0000-000000000201','eight-'||kind,'card',
      jsonb_build_object('contract','content_share_card_v1','id','compat-'||kind,'title','Compatibility','category','Kind','image','https://usemingla.com/og.jpg',
        'shareCode','Aa0Bb1Cc2Dd3Ee4F','shareVersion',1,'kind',kind,'senderNote',repeat('🙂',120),
        'facts',jsonb_build_object('schemaVersion',1,'kind',kind,'title','Compatibility','description',repeat('界',6000)),
        'destination',jsonb_build_object('kind',kind,'poison',repeat('x',6000)),'publicDetails',jsonb_build_object('kind',kind,'poison',repeat('x',6000)),
        'media',jsonb_build_object('kind','photo','url','https://usemingla.com/'||repeat('x',4000))));
  END LOOP;
  IF (SELECT count(*) FROM public.messages WHERE content LIKE 'eight-%' AND octet_length(convert_to(card_payload::text,'UTF8'))<=5120
      AND NOT card_payload?'publicDetails' AND card_payload->'destination' = jsonb_build_object('kind',card_payload->'kind'))<>8 THEN
    RAISE EXCEPTION 'all-eight minimal compatibility envelope failed'; END IF;
END$$;
RESET ROLE;

SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000201';
DO $$DECLARE mid uuid; old_mid uuid; resolved integer; code text; version integer; before_snapshots integer; r1 jsonb; r2 jsonb; BEGIN
  SELECT id INTO mid FROM public.messages WHERE content='fixture';
  SELECT id INTO old_mid FROM public.messages WHERE content='old-v1';
  SELECT count(*) INTO resolved FROM public.resolve_native_content_card_snapshots(ARRAY[mid]);
  IF resolved<>1 THEN RAISE EXCEPTION 'participant could not resolve snapshot'; END IF;
  SELECT count(*) INTO resolved FROM public.resolve_native_content_card_snapshots(ARRAY[old_mid]);
  IF resolved<>1 THEN RAISE EXCEPTION 'old immutable version did not resolve after version advance'; END IF;
  UPDATE public.messages SET deleted_at=now() WHERE id=mid;
  SELECT count(*) INTO resolved FROM public.resolve_native_content_card_snapshots(ARRAY[mid]);
  IF resolved<>0 THEN RAISE EXCEPTION 'deleted message resolved'; END IF;
  UPDATE public.messages SET deleted_at=NULL WHERE id=mid;
  UPDATE public.conversations SET is_enabled=false WHERE id='10000000-0000-0000-0000-000000000202';
  SELECT count(*) INTO resolved FROM public.resolve_native_content_card_snapshots(ARRAY[mid]);
  IF resolved<>0 THEN RAISE EXCEPTION 'disabled conversation resolved'; END IF;
  UPDATE public.conversations SET is_enabled=true WHERE id='10000000-0000-0000-0000-000000000202';
  INSERT INTO public.blocked_users(blocker_id,blocked_id) VALUES('00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000203');
  SELECT count(*) INTO resolved FROM public.resolve_native_content_card_snapshots(ARRAY[mid]);
  IF resolved<>0 THEN RAISE EXCEPTION 'blocked direct conversation resolved'; END IF;
  DELETE FROM public.blocked_users WHERE blocker_id='00000000-0000-0000-0000-000000000201' AND blocked_id='00000000-0000-0000-0000-000000000203';
  PERFORM set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000204',true);
  SELECT count(*) INTO resolved FROM public.resolve_native_content_card_snapshots(ARRAY[mid]);
  IF resolved<>0 THEN RAISE EXCEPTION 'nonparticipant resolved snapshot'; END IF;
  PERFORM set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000201',true);
  SELECT l.short_code,l.current_version INTO code,version FROM public.content_share_links l WHERE source_key='issue1719:native:place';
  SELECT count(*) INTO before_snapshots FROM public.content_share_native_snapshots;
  r1:=public.send_content_share_message('91000000-0000-0000-0000-000000000001','direct','10000000-0000-0000-0000-000000000202',code,version,'First note',10);
  r2:=public.send_content_share_message('91000000-0000-0000-0000-000000000002','direct','10000000-0000-0000-0000-000000000202',code,version,'Second note',11);
  IF r1->>'messageId'=r2->>'messageId' OR (SELECT count(*) FROM public.content_share_native_snapshots)<>before_snapshots THEN
    RAISE EXCEPTION 'fresh repeated send or note/version separation failed'; END IF;
END$$;
RESET request.jwt.claim.sub;
SELECT 'issue-1719 source-card-fidelity implementor PASS' AS result;
