\set ON_ERROR_STOP on

-- #1719 independent PostgreSQL 17 source-card fidelity oracle.
-- Requires the lifecycle tester fixture and implementor fidelity fixture to
-- have run first in the same disposable full-history database.

SET ROLE service_role;

DO $$
DECLARE forced boolean;
BEGIN
  SELECT c.relforcerowsecurity INTO forced
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname='content_share_native_snapshots';
  IF forced IS DISTINCT FROM true THEN RAISE EXCEPTION 'native snapshot table is not FORCE RLS'; END IF;
  IF has_table_privilege('authenticated','public.content_share_native_snapshots','SELECT')
     OR has_table_privilege('anon','public.content_share_native_snapshots','SELECT') THEN
    RAISE EXCEPTION 'native snapshot table is directly readable';
  END IF;
  IF has_function_privilege('anon','public.resolve_native_content_card_snapshots(uuid[])','EXECUTE') THEN
    RAISE EXCEPTION 'anon can execute native resolver';
  END IF;
END$$;

DO $$
DECLARE target record;
BEGIN
  SELECT n.link_id,n.version INTO target FROM public.content_share_native_snapshots n LIMIT 1;
  BEGIN
    UPDATE public.content_share_native_snapshots SET preview=preview||'{"title":"mutated"}'::jsonb
    WHERE link_id=target.link_id AND version=target.version;
    RAISE EXCEPTION 'immutable snapshot update succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM<>'immutable_native_content_card_snapshot' THEN RAISE; END IF;
  END;
  BEGIN
    DELETE FROM public.content_share_native_snapshots WHERE link_id=target.link_id AND version=target.version;
    RAISE EXCEPTION 'immutable snapshot delete succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM<>'immutable_native_content_card_snapshot' THEN RAISE; END IF;
  END;
END$$;

-- Every typed envelope must retain its exact facts/destination/media identity;
-- only the large publicDetails compatibility body may be absent.
DO $$
DECLARE row record; required text[];
BEGIN
  FOR row IN SELECT substring(content from 7) AS kind,card_payload FROM public.messages WHERE content LIKE 'eight-%' LOOP
    required:=CASE row.kind
      WHEN 'place' THEN ARRAY['schemaVersion','kind','title','category','area','rating','openState']
      WHEN 'curated' THEN ARRAY['schemaVersion','kind','title','stopCount','duration','estimate']
      WHEN 'event' THEN ARRAY['schemaVersion','kind','title','localDate','localTime','venue','price','availability']
      WHEN 'rsvp_event' THEN ARRAY['schemaVersion','kind','title','localDate','localTime','venue','rsvpDeadline','availability']
      WHEN 'trip' THEN ARRAY['schemaVersion','kind','title','destination','dateRange','duration','startingPrice']
      WHEN 'experience' THEN ARRAY['schemaVersion','kind','title','nextDate','duration','price','availability']
      WHEN 'venue' THEN ARRAY['schemaVersion','kind','title','category','nextPublicOffering','openState']
      WHEN 'brand' THEN ARRAY['schemaVersion','kind','title','category','upcomingPublicOfferingCount']
      ELSE NULL END;
    IF required IS NULL OR NOT (row.card_payload->'facts' ?& required)
       OR row.card_payload->'facts'->>'kind'<>row.kind
       OR row.card_payload->'destination'->>'webPath'<>'/typed/path'
       OR row.card_payload->'media'<>'{"kind":"gif","url":"https://usemingla.com/cover.gif","posterUrl":"https://usemingla.com/poster.jpg","alt":"Animated cover"}'::jsonb
       OR row.card_payload?'publicDetails'
       OR octet_length(convert_to(row.card_payload::text,'UTF8'))>5120 THEN
      RAISE EXCEPTION 'typed fidelity failed for %',row.kind;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM public.messages WHERE content LIKE 'eight-%')<>8 THEN RAISE EXCEPTION 'eight-kind fixture incomplete'; END IF;
END$$;

-- Canonical JSONB ordering must not create a new native version.
DO $$
DECLARE first jsonb; second jsonb;
BEGIN
  first:=public.upsert_content_share_version_with_native_snapshot(
    'place','00000000-0000-0000-0000-000000000201','issue1719:tester:canonical',
    '{"placePoolId":"canonical"}','{}','{"schemaVersion":1,"kind":"place","title":"Canonical"}',NULL,
    '{"kind":"place"}',
    '{"contract":"native_content_card_snapshot_v1","version":1,"kind":"place","id":"canonical","title":"Canonical","category":"Cafe"}',
    '{"title":"Canonical","category":"Cafe","cardType":"single"}');
  second:=public.upsert_content_share_version_with_native_snapshot(
    'place','00000000-0000-0000-0000-000000000201','issue1719:tester:canonical',
    '{"placePoolId":"canonical"}','{}','{"title":"Canonical","kind":"place","schemaVersion":1}',NULL,
    '{"kind":"place"}',
    '{"title":"Canonical","id":"canonical","kind":"place","version":1,"contract":"native_content_card_snapshot_v1","category":"Cafe"}',
    '{"cardType":"single","category":"Cafe","title":"Canonical"}');
  IF first->>'version'<>'1' OR second->>'version'<>'1' OR (second->>'versionCreated')::boolean THEN
    RAISE EXCEPTION 'shuffled JSON keys changed canonical fingerprint';
  END IF;
END$$;

-- The trigger must accept exactly 5,120 UTF-8 bytes and reject 5,121.
DO $$
DECLARE base jsonb; payload jsonb; base_bytes integer; filler integer; inserted_id uuid;
BEGIN
  base:=jsonb_build_object('contract','content_share_card_v1','id','tester-byte-limit','title','Byte limit','category','Brand',
    'image',NULL,'shareCode',repeat('t',16),'shareVersion',1,'kind','brand',
    'facts','{"schemaVersion":1,"kind":"brand","title":"Byte limit"}'::jsonb,'destination','{"kind":"brand"}'::jsonb,
    'media',NULL,'senderNote','');
  base_bytes:=octet_length(convert_to(base::text,'UTF8'));
  filler:=5120-base_bytes;
  payload:=jsonb_set(base,'{senderNote}',to_jsonb(repeat('x',filler)));
  IF octet_length(convert_to(payload::text,'UTF8'))<>5120 THEN RAISE EXCEPTION 'could not construct exact 5120-byte envelope'; END IF;
  INSERT INTO public.messages(conversation_id,sender_id,content,message_type,card_payload)
  VALUES('10000000-0000-0000-0000-000000000202','00000000-0000-0000-0000-000000000201','tester-5120','card',payload)
  RETURNING id INTO inserted_id;
  IF octet_length(convert_to((SELECT card_payload FROM public.messages WHERE id=inserted_id)::text,'UTF8'))<>5120 THEN
    RAISE EXCEPTION '5120-byte envelope changed';
  END IF;
  payload:=jsonb_set(base,'{senderNote}',to_jsonb(repeat('界',1)||repeat('x',filler-2)));
  IF octet_length(convert_to(payload::text,'UTF8'))<>5121 THEN RAISE EXCEPTION 'could not construct exact 5121-byte Unicode envelope'; END IF;
  BEGIN
    INSERT INTO public.messages(conversation_id,sender_id,content,message_type,card_payload)
    VALUES('10000000-0000-0000-0000-000000000202','00000000-0000-0000-0000-000000000201','tester-5121','card',payload);
    RAISE EXCEPTION '5121-byte envelope inserted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM<>'content_share_message_envelope_too_large' THEN RAISE; END IF;
  END;
END$$;

-- The service-only upsert independently enforces the full snapshot byte cap.
DO $$
DECLARE snapshot jsonb; base_bytes integer; filler integer;
BEGIN
  snapshot:='{"contract":"native_content_card_snapshot_v1","version":1,"kind":"place","id":"oversize","title":"Oversize","blob":""}'::jsonb;
  base_bytes:=octet_length(convert_to(snapshot::text,'UTF8'));
  filler:=262145-base_bytes;
  snapshot:=jsonb_set(snapshot,'{blob}',to_jsonb(repeat('x',filler)));
  IF octet_length(convert_to(snapshot::text,'UTF8'))<>262145 THEN RAISE EXCEPTION 'could not construct exact 256KiB+1 snapshot'; END IF;
  BEGIN
    PERFORM public.upsert_content_share_version_with_native_snapshot(
      'place','00000000-0000-0000-0000-000000000201','issue1719:tester:oversize',
      '{"placePoolId":"oversize"}','{}','{"schemaVersion":1,"kind":"place","title":"Oversize"}',NULL,
      '{"kind":"place"}',snapshot,'{"title":"Oversize","cardType":"single"}');
    RAISE EXCEPTION '256KiB+1 snapshot inserted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM<>'invalid_native_content_share_contract' THEN RAISE; END IF;
  END;
END$$;

RESET ROLE;

-- Current-read resolver authority: both participants yes; possession of the
-- public code, unrelated auth, removed membership, blocks, deleted messages,
-- disabled conversations, and anon all fail closed.
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000201';
DO $$DECLARE mid uuid; seen integer; BEGIN
  SELECT id INTO mid FROM public.messages WHERE content='fixture';
  SELECT count(*) INTO seen FROM public.resolve_native_content_card_snapshots(ARRAY[mid]);
  IF seen<>1 THEN RAISE EXCEPTION 'owner participant cannot resolve'; END IF;
  BEGIN PERFORM public.resolve_native_content_card_snapshots(array_fill(mid,ARRAY[51])); RAISE EXCEPTION '51-message resolver batch accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END$$;

SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000203';
DO $$DECLARE mid uuid; BEGIN
  SELECT id INTO mid FROM public.messages WHERE content='fixture';
  IF (SELECT count(*) FROM public.resolve_native_content_card_snapshots(ARRAY[mid]))<>1 THEN RAISE EXCEPTION 'recipient participant cannot resolve'; END IF;
END$$;

SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000204';
DO $$DECLARE mid uuid; BEGIN
  SELECT id INTO mid FROM public.messages WHERE content='fixture';
  IF (SELECT count(*) FROM public.resolve_native_content_card_snapshots(ARRAY[mid]))<>0 THEN RAISE EXCEPTION 'public-code-only nonparticipant resolved'; END IF;
END$$;

RESET request.jwt.claim.sub;
SET ROLE service_role;
DELETE FROM public.conversation_participants WHERE conversation_id='10000000-0000-0000-0000-000000000202' AND user_id='00000000-0000-0000-0000-000000000203';
RESET ROLE;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000203';
DO $$DECLARE mid uuid; BEGIN SELECT id INTO mid FROM public.messages WHERE content='fixture';
  IF (SELECT count(*) FROM public.resolve_native_content_card_snapshots(ARRAY[mid]))<>0 THEN RAISE EXCEPTION 'removed participant resolved'; END IF;
END$$;
RESET request.jwt.claim.sub;
SET ROLE service_role;
INSERT INTO public.conversation_participants(conversation_id,user_id) VALUES('10000000-0000-0000-0000-000000000202','00000000-0000-0000-0000-000000000203');
INSERT INTO public.blocked_users(blocker_id,blocked_id) VALUES('00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000203');
RESET ROLE;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000201';
DO $$DECLARE mid uuid; BEGIN SELECT id INTO mid FROM public.messages WHERE content='fixture';
  IF (SELECT count(*) FROM public.resolve_native_content_card_snapshots(ARRAY[mid]))<>0 THEN RAISE EXCEPTION 'blocked direct resolved'; END IF;
END$$;
RESET request.jwt.claim.sub;
SET ROLE service_role;
DELETE FROM public.blocked_users WHERE blocker_id='00000000-0000-0000-0000-000000000201' AND blocked_id='00000000-0000-0000-0000-000000000203';
UPDATE public.conversations SET is_enabled=false WHERE id='10000000-0000-0000-0000-000000000202';
RESET ROLE;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000201';
DO $$DECLARE mid uuid; BEGIN SELECT id INTO mid FROM public.messages WHERE content='fixture';
  IF (SELECT count(*) FROM public.resolve_native_content_card_snapshots(ARRAY[mid]))<>0 THEN RAISE EXCEPTION 'disabled conversation resolved'; END IF;
END$$;
RESET request.jwt.claim.sub;
SET ROLE service_role;
UPDATE public.conversations SET is_enabled=true WHERE id='10000000-0000-0000-0000-000000000202';
UPDATE public.messages SET deleted_at=now() WHERE content='fixture';
RESET ROLE;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000201';
DO $$DECLARE mid uuid; BEGIN SELECT id INTO mid FROM public.messages WHERE content='fixture';
  IF (SELECT count(*) FROM public.resolve_native_content_card_snapshots(ARRAY[mid]))<>0 THEN RAISE EXCEPTION 'deleted message resolved'; END IF;
END$$;
RESET request.jwt.claim.sub;
SET ROLE service_role;
UPDATE public.messages SET deleted_at=NULL WHERE content='fixture';
RESET ROLE;

SET ROLE anon;
DO $$BEGIN
  BEGIN PERFORM public.resolve_native_content_card_snapshots(ARRAY['00000000-0000-0000-0000-000000000001'::uuid]);
    RAISE EXCEPTION 'anon native resolver executed';
  EXCEPTION WHEN insufficient_privilege OR undefined_function THEN NULL; END;
END$$;
RESET ROLE;

-- The anonymous public resolver must not expose native/private identity.
SET ROLE service_role;
CREATE TEMP TABLE issue1719_public_probe AS
SELECT short_code FROM public.content_share_links WHERE source_key='issue1719:native:place';
DO $$DECLARE resolved jsonb; probe text; BEGIN
  SELECT short_code INTO probe FROM issue1719_public_probe;
  SELECT public.resolve_content_share_code(probe) INTO resolved;
  IF resolved::text ~ 'nativeCard|native_snapshot|sourceRecord|sourceScope|snapshotFingerprint|snapshot_fingerprint' THEN
    RAISE EXCEPTION 'public resolver leaked native/private fields';
  END IF;
END$$;
RESET ROLE;

SELECT 'issue-1719 source-card-fidelity tester PostgreSQL adversarial PASS' AS result;
