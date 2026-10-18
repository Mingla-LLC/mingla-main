-- #3720 Completion Wave 7 — executable Host Community happy path.
-- MINGLA-INVARIANT: I-3720-COMMUNITY-REVIEW | issue #3720 | A Host's first three Community posts require a moderator decision before other Hosts can read them.
-- MINGLA-INVARIANT: I-3720-COMMUNITY-SAFETY | issue #3720 | Reports, blocks, moderation decisions and appeals are server-enforced and audited without exposing private moderation records to Hosts.
-- MINGLA-INVARIANT: I-3720-CUTOVER-GATE | issue #3720 | Final cutover remains false until moderation queues and every required delivery, release, ClickUp, native, board and seat proof are resolved; paid agent seats are recorded last.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users(id,email) VALUES
 ('37200000-0000-4000-c100-000000000001','wave7-owner@test.local'),
 ('37200000-0000-4000-c100-000000000002','wave7-host-a@test.local'),
 ('37200000-0000-4000-c100-000000000003','wave7-host-b@test.local'),
 ('37200000-0000-4000-c100-000000000004','wave7-mod@test.local');
INSERT INTO public.profiles(id,email,display_name,username,account_type) VALUES
 ('37200000-0000-4000-c100-000000000001','wave7-owner@test.local','Wave Owner','wave7_owner','business'),
 ('37200000-0000-4000-c100-000000000002','wave7-host-a@test.local','Host A','wave7_a','business'),
 ('37200000-0000-4000-c100-000000000003','wave7-host-b@test.local','Host B','wave7_b','business'),
 ('37200000-0000-4000-c100-000000000004','wave7-mod@test.local','Moderator','wave7_mod','business');
INSERT INTO public.creator_accounts(id,email,display_name,business_name)
VALUES('37200000-0000-4000-c100-000000000001','wave7-owner@test.local','Wave Owner','Wave 7 Host');
INSERT INTO public.brands(id,account_id,name,slug) VALUES
 ('37200000-0000-4000-c200-000000000001','37200000-0000-4000-c100-000000000001','Wave Seven','wave-seven');
INSERT INTO public.brand_team_members(brand_id,user_id,role,accepted_at) VALUES
 ('37200000-0000-4000-c200-000000000001','37200000-0000-4000-c100-000000000002','marketing_manager',now()),
 ('37200000-0000-4000-c200-000000000001','37200000-0000-4000-c100-000000000003','marketing_manager',now());
INSERT INTO public.community_staff(user_id,role,enabled,display_name)
VALUES('37200000-0000-4000-c100-000000000004','moderator',true,'Moderator');

CREATE TEMP TABLE wave7_ids(k text PRIMARY KEY,id uuid NOT NULL) ON COMMIT DROP;
GRANT SELECT,INSERT,UPDATE ON wave7_ids TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','37200000-0000-4000-c100-000000000002',true);
INSERT INTO wave7_ids SELECT 'p1',post_id FROM public.issue_3720_community_submit_post('idea','First idea','The first reviewed idea.');
INSERT INTO wave7_ids SELECT 'p2',post_id FROM public.issue_3720_community_submit_post('idea','Second idea','The second reviewed idea.');
INSERT INTO wave7_ids SELECT 'p3',post_id FROM public.issue_3720_community_submit_post('question','First question','The third reviewed post?');
DO $host_pending$
BEGIN
 IF (SELECT count(*) FROM public.issue_3720_community_feed(NULL) WHERE review_state='pending')<>3 THEN
   RAISE EXCEPTION 'owner_pending_posts_not_visible'; END IF;
END $host_pending$;

SELECT set_config('request.jwt.claim.sub','37200000-0000-4000-c100-000000000003',true);
DO $other_hidden$
BEGIN
 IF EXISTS(SELECT 1 FROM public.issue_3720_community_feed(NULL)) THEN
   RAISE EXCEPTION 'pending_posts_leaked'; END IF;
END $other_hidden$;

SELECT set_config('request.jwt.claim.sub','37200000-0000-4000-c100-000000000004',true);
DO $moderate$
DECLARE r record;
BEGIN
 IF (SELECT count(*) FROM public.issue_3720_community_moderation_queue() WHERE queue_type='post_review')<>3 THEN
   RAISE EXCEPTION 'moderation_queue_wrong'; END IF;
 FOR r IN SELECT * FROM wave7_ids LOOP
   PERFORM public.issue_3720_community_moderate('post_review',r.id,'approve');
 END LOOP;
END $moderate$;

SELECT set_config('request.jwt.claim.sub','37200000-0000-4000-c100-000000000002',true);
INSERT INTO wave7_ids SELECT 'p4',post_id FROM public.issue_3720_community_submit_post('question','Published question','This fourth post publishes now.');
DO $fourth$
BEGIN
 IF (SELECT review_state FROM public.issue_3720_community_feed('question') WHERE id=(SELECT id FROM wave7_ids WHERE k='p4'))<>'published' THEN
   RAISE EXCEPTION 'fourth_post_not_published'; END IF;
END $fourth$;

SELECT set_config('request.jwt.claim.sub','37200000-0000-4000-c100-000000000003',true);
DO $engage$
DECLARE v_post uuid:=(SELECT id FROM wave7_ids WHERE k='p4'); v_comment uuid;
BEGIN
 IF public.issue_3720_community_toggle_vote(v_post) IS DISTINCT FROM true THEN RAISE EXCEPTION 'vote_not_added'; END IF;
 v_comment:=public.issue_3720_community_add_comment(v_post,'Here is a useful answer.');
 INSERT INTO wave7_ids VALUES('comment',v_comment);
END $engage$;

SELECT set_config('request.jwt.claim.sub','37200000-0000-4000-c100-000000000002',true);
DO $accept$
BEGIN
 IF public.issue_3720_community_accept_answer((SELECT id FROM wave7_ids WHERE k='p4'),(SELECT id FROM wave7_ids WHERE k='comment')) IS DISTINCT FROM true THEN
   RAISE EXCEPTION 'answer_not_accepted'; END IF;
END $accept$;

SELECT set_config('request.jwt.claim.sub','37200000-0000-4000-c100-000000000003',true);
SELECT public.issue_3720_community_block_author('post',(SELECT id FROM wave7_ids WHERE k='p4'));
DO $blocked$
BEGIN
 IF EXISTS(SELECT 1 FROM public.issue_3720_community_feed(NULL) WHERE id=(SELECT id FROM wave7_ids WHERE k='p4')) THEN
   RAISE EXCEPTION 'blocked_author_still_visible'; END IF;
END $blocked$;
RESET ROLE;

DO $proof$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.notification_outbox WHERE category_key='business.community_reply' AND user_id='37200000-0000-4000-c100-000000000002' AND payload->>'post_id'=(SELECT id::text FROM wave7_ids WHERE k='p4')) THEN
   RAISE EXCEPTION 'reply_delivery_missing'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='community_posts') THEN RAISE EXCEPTION 'posts_not_realtime'; END IF;
 IF has_table_privilege('authenticated','public.community_content_reports','SELECT') THEN RAISE EXCEPTION 'private_reports_exposed'; END IF;
END $proof$;

ROLLBACK;
