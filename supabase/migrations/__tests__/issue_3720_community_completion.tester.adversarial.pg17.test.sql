-- #3720 Completion Wave 7 — adversarial Community authority and cutover proof.
\set ON_ERROR_STOP on
BEGIN;

DO $surface$
BEGIN
 IF has_table_privilege('authenticated','public.community_posts','SELECT')
    OR has_table_privilege('authenticated','public.community_content_reports','SELECT')
    OR has_table_privilege('authenticated','public.community_content_appeals','SELECT')
    OR has_table_privilege('authenticated','public.community_cutover_evidence','SELECT') THEN
   RAISE EXCEPTION 'private_base_table_grant'; END IF;
 IF has_function_privilege('anon','public.issue_3720_community_feed(text)','EXECUTE')
    OR has_function_privilege('anon','public.issue_3720_community_submit_post(text,text,text)','EXECUTE') THEN
   RAISE EXCEPTION 'anonymous_community_execute'; END IF;
END $surface$;

INSERT INTO auth.users(id,email) VALUES
 ('37200000-0000-4000-c300-000000000001','wave7-outsider@test.local'),
 ('37200000-0000-4000-c300-000000000002','wave7-admin@test.local');
INSERT INTO public.profiles(id,email,display_name,username,account_type) VALUES
 ('37200000-0000-4000-c300-000000000001','wave7-outsider@test.local','Outsider','wave7_out','business'),
 ('37200000-0000-4000-c300-000000000002','wave7-admin@test.local','Admin','wave7_admin','business');
INSERT INTO public.admin_users(email,role,status) VALUES('wave7-admin@test.local','admin','active');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','37200000-0000-4000-c300-000000000001',true);
DO $outsider$
DECLARE denied boolean:=false;
BEGIN
 BEGIN PERFORM public.issue_3720_community_submit_post('idea','No access','Outsiders cannot post.');
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'outsider_posted'; END IF;
 IF EXISTS(SELECT 1 FROM public.issue_3720_community_feed(NULL)) THEN RAISE EXCEPTION 'outsider_read_feed'; END IF;
END $outsider$;

SELECT set_config('request.jwt.claim.sub','37200000-0000-4000-c300-000000000002',true);
DO $cutover$
DECLARE s jsonb; denied boolean:=false;
BEGIN
 s:=public.issue_3720_community_cutover_status();
 IF (s->>'ready')::boolean OR (s->>'pending_evidence')::integer<>8 THEN RAISE EXCEPTION 'cutover_default_not_closed:%',s; END IF;
 BEGIN PERFORM public.issue_3720_community_record_cutover_evidence('agent_seats','verified','issue:#3720');
 EXCEPTION WHEN check_violation THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'agent_seats_not_last'; END IF;
 denied:=false;
 BEGIN PERFORM public.issue_3720_community_record_cutover_evidence('clickup_archival','verified','issue:#3720');
 EXCEPTION WHEN check_violation THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'clickup_archived_before_reconciliation'; END IF;
END $cutover$;
RESET ROLE;

ROLLBACK;
