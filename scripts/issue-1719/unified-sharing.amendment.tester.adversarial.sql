\set ON_ERROR_STOP on

-- #1719 independent PostgreSQL 17 adversarial runtime suite.
-- Runs only against a disposable full-history database. It proves behavior,
-- not SQL spelling: private lifecycle RLS, canonical eligibility, deterministic
-- activity ordering, system/deleted-message exclusion, and scoped leave/reopen.

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password, confirmed_at, created_at, updated_at
)
SELECT id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       email, '', now(), now(), now()
FROM (VALUES
  ('00000000-0000-0000-0000-000000000201'::uuid,'issue1719-caller@test.invalid'),
  ('00000000-0000-0000-0000-000000000202'::uuid,'issue1719-alice@test.invalid'),
  ('00000000-0000-0000-0000-000000000203'::uuid,'issue1719-bob@test.invalid'),
  ('00000000-0000-0000-0000-000000000204'::uuid,'issue1719-charlie@test.invalid'),
  ('00000000-0000-0000-0000-000000000205'::uuid,'issue1719-dana@test.invalid'),
  ('00000000-0000-0000-0000-000000000206'::uuid,'issue1719-erin@test.invalid'),
  ('00000000-0000-0000-0000-000000000207'::uuid,'issue1719-finn@test.invalid'),
  ('00000000-0000-0000-0000-000000000208'::uuid,'issue1719-gina@test.invalid'),
  ('00000000-0000-0000-0000-000000000209'::uuid,'issue1719-hank@test.invalid'),
  ('00000000-0000-0000-0000-000000000210'::uuid,'issue1719-inactive@test.invalid')
) AS fixture(id,email);

INSERT INTO public.profiles(id,email,display_name,username,active,visibility_mode)
SELECT id,email,name,username,active,'friends'
FROM (VALUES
  ('00000000-0000-0000-0000-000000000201'::uuid,'issue1719-caller@test.invalid','Caller','issue1719caller',true),
  ('00000000-0000-0000-0000-000000000202'::uuid,'issue1719-alice@test.invalid','Alice','issue1719alice',true),
  ('00000000-0000-0000-0000-000000000203'::uuid,'issue1719-bob@test.invalid','Bob','issue1719bob',true),
  ('00000000-0000-0000-0000-000000000204'::uuid,'issue1719-charlie@test.invalid','Charlie','issue1719charlie',true),
  ('00000000-0000-0000-0000-000000000205'::uuid,'issue1719-dana@test.invalid','Dana','issue1719dana',true),
  ('00000000-0000-0000-0000-000000000206'::uuid,'issue1719-erin@test.invalid','Erin','issue1719erin',true),
  ('00000000-0000-0000-0000-000000000207'::uuid,'issue1719-finn@test.invalid','Finn','issue1719finn',true),
  ('00000000-0000-0000-0000-000000000208'::uuid,'issue1719-gina@test.invalid','Gina','issue1719gina',true),
  ('00000000-0000-0000-0000-000000000209'::uuid,'issue1719-hank@test.invalid','Hank','issue1719hank',true),
  ('00000000-0000-0000-0000-000000000210'::uuid,'issue1719-inactive@test.invalid','Inactive','issue1719inactive',false)
) AS fixture(id,email,name,username,active);

-- Four direct conversations: two with activity and two without.
INSERT INTO public.conversations(id,type,created_by,created_at,linked_entity_type,is_enabled)
VALUES
  ('10000000-0000-0000-0000-000000000201','direct','00000000-0000-0000-0000-000000000201','2026-08-01T00:00:00Z','direct',true),
  ('10000000-0000-0000-0000-000000000202','direct','00000000-0000-0000-0000-000000000201','2026-08-02T00:00:00Z','direct',true),
  ('10000000-0000-0000-0000-000000000203','direct','00000000-0000-0000-0000-000000000201','2026-08-04T00:00:00Z','direct',true),
  ('10000000-0000-0000-0000-000000000204','direct','00000000-0000-0000-0000-000000000201','2026-08-05T00:00:00Z','direct',true);
INSERT INTO public.conversation_participants(conversation_id,user_id)
VALUES
  ('10000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000201'),
  ('10000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000202'),
  ('10000000-0000-0000-0000-000000000202','00000000-0000-0000-0000-000000000201'),
  ('10000000-0000-0000-0000-000000000202','00000000-0000-0000-0000-000000000203'),
  ('10000000-0000-0000-0000-000000000203','00000000-0000-0000-0000-000000000201'),
  ('10000000-0000-0000-0000-000000000203','00000000-0000-0000-0000-000000000204'),
  ('10000000-0000-0000-0000-000000000204','00000000-0000-0000-0000-000000000201'),
  ('10000000-0000-0000-0000-000000000204','00000000-0000-0000-0000-000000000205');

-- Ordinary groups are linked_entity_type=direct by the canonical schema.
INSERT INTO public.conversations(id,type,created_by,created_at,linked_entity_type,is_enabled,name)
VALUES
  ('20000000-0000-0000-0000-000000000201','group','00000000-0000-0000-0000-000000000201','2026-08-03T00:00:00Z','direct',true,'Alpha group'),
  ('20000000-0000-0000-0000-000000000202','group','00000000-0000-0000-0000-000000000201','2026-08-06T00:00:00Z','direct',true,'Zulu group'),
  ('20000000-0000-0000-0000-000000000203','group','00000000-0000-0000-0000-000000000201','2026-08-07T00:00:00Z','support',true,'Support group');
INSERT INTO public.conversation_participants(conversation_id,user_id)
VALUES
  ('20000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000201'),
  ('20000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000202'),
  ('20000000-0000-0000-0000-000000000202','00000000-0000-0000-0000-000000000201'),
  ('20000000-0000-0000-0000-000000000202','00000000-0000-0000-0000-000000000203'),
  ('20000000-0000-0000-0000-000000000203','00000000-0000-0000-0000-000000000201'),
  ('20000000-0000-0000-0000-000000000203','00000000-0000-0000-0000-000000000202');

-- Meaningful order: Alpha and Bob tie at 10:00; normalized name breaks the tie.
-- Alice's later system/deleted rows must not inflate activity.
INSERT INTO public.messages(id,conversation_id,sender_id,content,message_type,created_at,deleted_at)
VALUES
  ('30000000-0000-0000-0000-000000000201','10000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000202','real alice','text','2026-08-08T08:00:00Z',NULL),
  ('30000000-0000-0000-0000-000000000202','10000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000202','system','system','2026-08-08T12:00:00Z',NULL),
  ('30000000-0000-0000-0000-000000000203','10000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000202','deleted','text','2026-08-08T13:00:00Z','2026-08-08T13:01:00Z'),
  ('30000000-0000-0000-0000-000000000204','10000000-0000-0000-0000-000000000202','00000000-0000-0000-0000-000000000203','older bob','text','2026-08-08T07:00:00Z',NULL),
  ('30000000-0000-0000-0000-000000000205','10000000-0000-0000-0000-000000000202','00000000-0000-0000-0000-000000000203','latest bob','text','2026-08-08T10:00:00Z',NULL),
  ('30000000-0000-0000-0000-000000000206','20000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000202','latest group','image','2026-08-08T10:00:00Z',NULL);

INSERT INTO public.friends(user_id,friend_user_id,status)
VALUES
  ('00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000206','accepted'),
  ('00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000207','pending'),
  ('00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000209','accepted'),
  ('00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000210','accepted');
INSERT INTO public.blocked_users(blocker_id,blocked_id)
VALUES ('00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000209');
INSERT INTO public.pair_requests(id,sender_id,receiver_id,status)
VALUES ('40000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000208','accepted');
INSERT INTO public.pairings(user_a_id,user_b_id,pair_request_id)
VALUES ('00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000208','40000000-0000-0000-0000-000000000201');

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000201',false);

-- Owner lifecycle writes are server acknowledged and immediately affect list.
SELECT public.set_conversation_lifecycle('10000000-0000-0000-0000-000000000201','hide');
DO $$
DECLARE rows_seen integer;
BEGIN
  SELECT count(*) INTO rows_seen FROM public.conversation_participant_lifecycle;
  IF rows_seen <> 1 THEN RAISE EXCEPTION 'owner lifecycle RLS expected 1 row, got %',rows_seen; END IF;
  IF EXISTS (SELECT 1 FROM public.list_content_share_recipients() WHERE conversation_id='10000000-0000-0000-0000-000000000201')
    THEN RAISE EXCEPTION 'hidden direct resurrected in recipient list'; END IF;
END$$;

-- A peer in the same direct chat can still see participant identities, but not
-- the caller's private hide/archive timestamps.
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000202',false);
DO $$
DECLARE participant_rows integer; lifecycle_rows integer;
BEGIN
  SELECT count(*) INTO participant_rows FROM public.conversation_participants
   WHERE conversation_id='10000000-0000-0000-0000-000000000201';
  SELECT count(*) INTO lifecycle_rows FROM public.conversation_participant_lifecycle
   WHERE conversation_id='10000000-0000-0000-0000-000000000201';
  IF participant_rows <> 2 THEN RAISE EXCEPTION 'normal participant identity read broke'; END IF;
  IF lifecycle_rows <> 0 THEN RAISE EXCEPTION 'peer lifecycle leaked through RLS'; END IF;
END$$;

RESET ROLE;

-- System, deleted, and self-authored messages cannot reopen the caller's hidden chat.
INSERT INTO public.messages(conversation_id,sender_id,content,message_type,created_at)
VALUES ('10000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000202','system reopen attack','system','2026-08-08T14:00:00Z');
INSERT INTO public.messages(conversation_id,sender_id,content,message_type,created_at,deleted_at)
VALUES ('10000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000202','deleted reopen attack','text','2026-08-08T14:01:00Z','2026-08-08T14:01:01Z');
INSERT INTO public.messages(conversation_id,sender_id,content,message_type,created_at)
VALUES ('10000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000201','self reopen attack','text','2026-08-08T14:02:00Z');
DO $$BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.conversation_participant_lifecycle WHERE conversation_id='10000000-0000-0000-0000-000000000201' AND user_id='00000000-0000-0000-0000-000000000201' AND hidden_at IS NOT NULL)
    THEN RAISE EXCEPTION 'system/deleted/self message reopened hidden chat'; END IF;
END$$;

-- Another participant's real human message reopens hidden, but never archive.
INSERT INTO public.messages(conversation_id,sender_id,content,message_type,created_at)
VALUES ('10000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000202','real reopen','text','2026-08-08T14:03:00Z');
DO $$BEGIN
  IF EXISTS (SELECT 1 FROM public.conversation_participant_lifecycle WHERE conversation_id='10000000-0000-0000-0000-000000000201' AND user_id='00000000-0000-0000-0000-000000000201' AND hidden_at IS NOT NULL)
    THEN RAISE EXCEPTION 'other human message failed to reopen hidden chat'; END IF;
END$$;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000201',false);
SELECT public.set_conversation_lifecycle('10000000-0000-0000-0000-000000000201','archive');
SELECT public.set_conversation_lifecycle('10000000-0000-0000-0000-000000000201','hide');
RESET ROLE;
INSERT INTO public.messages(conversation_id,sender_id,content,message_type,created_at)
VALUES ('10000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000202','archive reopen attack','text','2026-08-08T14:04:00Z');
DO $$BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.conversation_participant_lifecycle WHERE conversation_id='10000000-0000-0000-0000-000000000201' AND user_id='00000000-0000-0000-0000-000000000201' AND hidden_at IS NOT NULL AND archived_at IS NOT NULL)
    THEN RAISE EXCEPTION 'archived chat was reopened or archive was cleared'; END IF;
END$$;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000201',false);

-- Exact tiers/ties: activity DESC, created DESC, then accepted/pairing names.
DO $$
DECLARE actual text[];
BEGIN
  SELECT array_agg(display_name ORDER BY ordinality) INTO actual
  FROM public.list_content_share_recipients() WITH ORDINALITY;
  IF actual IS DISTINCT FROM ARRAY['Alpha group','Bob','Zulu group','Dana','Charlie','Erin','Gina']::text[] THEN
    RAISE EXCEPTION 'recipient order/eligibility mismatch: %',actual;
  END IF;
END$$;

-- Soft deleting the latest Bob message recomputes from the next human message.
RESET ROLE;
UPDATE public.messages SET deleted_at='2026-08-08T15:00:00Z'
WHERE id='30000000-0000-0000-0000-000000000205';
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000201',false);
DO $$
DECLARE first_two text[];
BEGIN
  SELECT array_agg(display_name ORDER BY ordinality) INTO first_two
  FROM (SELECT display_name,ordinality FROM public.list_content_share_recipients() WITH ORDINALITY ORDER BY ordinality LIMIT 2) ordered;
  IF first_two IS DISTINCT FROM ARRAY['Alpha group','Bob']::text[] THEN
    RAISE EXCEPTION 'soft-delete activity recompute mismatch: %',first_two;
  END IF;
  IF (SELECT meaningful_activity_at FROM public.list_content_share_recipients() WHERE display_name='Bob')
       IS DISTINCT FROM '2026-08-08T07:00:00Z'::timestamptz THEN
    RAISE EXCEPTION 'Bob did not fall back to prior visible human message';
  END IF;
END$$;

-- Unsupported support groups cannot be left through the scoped RPC.
DO $$BEGIN
  BEGIN
    PERFORM public.leave_group_conversation('20000000-0000-0000-0000-000000000203');
    RAISE EXCEPTION 'support leave unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'conversation_unavailable' THEN RAISE; END IF;
  END;
  IF NOT EXISTS (SELECT 1 FROM public.conversation_participants WHERE conversation_id='20000000-0000-0000-0000-000000000203' AND user_id=auth.uid())
    THEN RAISE EXCEPTION 'support membership was removed'; END IF;
END$$;

-- Authenticated and anon callers cannot invoke the internal arbitrary-user helper.
DO $$BEGIN
  IF has_function_privilege('authenticated','public.content_share_recipient_candidates(uuid,boolean,boolean)','EXECUTE')
    THEN RAISE EXCEPTION 'authenticated can invoke arbitrary-user recipient helper'; END IF;
  IF has_function_privilege('anon','public.content_share_recipient_candidates(uuid,boolean,boolean)','EXECUTE')
    THEN RAISE EXCEPTION 'anon can invoke arbitrary-user recipient helper'; END IF;
  IF has_table_privilege('authenticated','public.conversation_participant_lifecycle','INSERT')
     OR has_table_privilege('authenticated','public.conversation_participant_lifecycle','UPDATE')
     OR has_table_privilege('authenticated','public.conversation_participant_lifecycle','DELETE') THEN
    RAISE EXCEPTION 'authenticated can mutate lifecycle outside the scoped RPC';
  END IF;
  IF has_table_privilege('anon','public.conversation_participant_lifecycle','SELECT')
     OR has_table_privilege('anon','public.conversation_participant_lifecycle','INSERT')
     OR has_table_privilege('anon','public.conversation_participant_lifecycle','UPDATE')
     OR has_table_privilege('anon','public.conversation_participant_lifecycle','DELETE') THEN
    RAISE EXCEPTION 'anon has lifecycle table privileges';
  END IF;
END$$;

RESET ROLE;
SELECT 'issue-1719 tester PostgreSQL adversarial PASS' AS result;
