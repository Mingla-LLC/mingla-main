\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users(id) VALUES
 ('17770000-0000-4000-8000-000000000001'),('17770000-0000-4000-8000-000000000002'),('17770000-0000-4000-8000-000000000003'),
 ('17770000-0000-4000-8000-000000000004'),('17770000-0000-4000-8000-000000000005'),('17770000-0000-4000-8000-000000000006'),
 ('17770000-0000-4000-8000-000000000007'),('17770000-0000-4000-8000-000000000008'),('17770000-0000-4000-8000-000000000009'),
 ('17770000-0000-4000-8000-00000000000a'),('17770000-0000-4000-8000-00000000000b'),('17770000-0000-4000-8000-00000000000c'),
 ('17770000-0000-4000-8000-00000000000d'),('17770000-0000-4000-8000-00000000000e'),('17770000-0000-4000-8000-00000000000f'),
 ('17770000-0000-4000-8000-000000000011'),('17770000-0000-4000-8000-000000000012');
INSERT INTO public.creator_accounts(id,email) VALUES('17770000-0000-4000-8000-000000000001','owner-1777@example.test');
INSERT INTO public.brands(id,account_id,name,slug,default_currency,created_at,updated_at)
VALUES('17770000-0000-4000-8000-000000000010','17770000-0000-4000-8000-000000000001','Circle Brand','issue-1777-circle','USD',now(),now());
INSERT INTO public.profiles(id,first_name,last_name,display_name,username,active,has_completed_onboarding,visibility_mode)
VALUES
 ('17770000-0000-4000-8000-000000000002','Root','Person','Ignored','root-1777',true,true,'friends'),
 ('17770000-0000-4000-8000-000000000003','Friend','Direct','Ignored','friend-1777',true,true,'friends'),
 ('17770000-0000-4000-8000-000000000004','Close','Direct','Ignored','close-1777',true,true,'friends'),
 ('17770000-0000-4000-8000-000000000005','Friend','Middle','Ignored','middle-1777',true,true,'friends'),
 ('17770000-0000-4000-8000-000000000006','Friend','Of Friend','Ignored','fof-1777',true,true,'friends'),
 ('17770000-0000-4000-8000-000000000007','Choice','Missing','Ignored','choice-1777',true,true,'friends'),
 ('17770000-0000-4000-8000-000000000009','Paid','Valid','Ignored','paid-valid-1777',true,true,'friends'),
 ('17770000-0000-4000-8000-00000000000a','Partial','Retained','Ignored','partial-1777',true,true,'friends'),
 ('17770000-0000-4000-8000-00000000000b','Payment','Denied','Ignored','payment-denied-1777',true,true,'friends'),
 ('17770000-0000-4000-8000-00000000000c','Ticket','Denied','Ignored','ticket-denied-1777',true,true,'friends'),
 ('17770000-0000-4000-8000-00000000000d','Approval','Denied','Ignored','approval-denied-1777',true,true,'friends'),
 ('17770000-0000-4000-8000-00000000000e','Event','Denied','Ignored','event-denied-1777',true,true,'friends'),
 ('17770000-0000-4000-8000-00000000000f','Different','Event','Ignored','different-event-1777',true,true,'friends'),
 ('17770000-0000-4000-8000-000000000011','Source','Mutation','Ignored','source-mutation-1777',true,true,'friends'),
 ('17770000-0000-4000-8000-000000000012','Ended','Used','Ignored','ended-used-1777',true,true,'friends');
INSERT INTO public.brand_follows(user_id,brand_id) VALUES('17770000-0000-4000-8000-000000000002','17770000-0000-4000-8000-000000000010');
INSERT INTO public.friends(user_id,friend_user_id,status) VALUES
 ('17770000-0000-4000-8000-000000000002','17770000-0000-4000-8000-000000000003','accepted'),
 ('17770000-0000-4000-8000-000000000002','17770000-0000-4000-8000-000000000005','accepted'),
 ('17770000-0000-4000-8000-000000000005','17770000-0000-4000-8000-000000000006','accepted'),
 ('17770000-0000-4000-8000-000000000002','17770000-0000-4000-8000-000000000007','accepted');
INSERT INTO public.pair_requests(id,sender_id,receiver_id,status)
VALUES('17770000-3000-4000-8000-000000000001','17770000-0000-4000-8000-000000000002','17770000-0000-4000-8000-000000000004','accepted');
INSERT INTO public.pairings(user_a_id,user_b_id,pair_request_id)
VALUES('17770000-0000-4000-8000-000000000002','17770000-0000-4000-8000-000000000004','17770000-3000-4000-8000-000000000001');
INSERT INTO public.brand_circle_preferences(user_id,extended_brand_reach_enabled,extended_brand_reach_decided_at)
SELECT id,true,now() FROM auth.users WHERE id IN (
 '17770000-0000-4000-8000-000000000003','17770000-0000-4000-8000-000000000004','17770000-0000-4000-8000-000000000006',
 '17770000-0000-4000-8000-000000000009','17770000-0000-4000-8000-00000000000a','17770000-0000-4000-8000-00000000000b',
 '17770000-0000-4000-8000-00000000000c','17770000-0000-4000-8000-00000000000d','17770000-0000-4000-8000-00000000000e',
 '17770000-0000-4000-8000-00000000000f','17770000-0000-4000-8000-000000000012'
);
INSERT INTO public.brand_team_members(brand_id,user_id,role,accepted_at)
VALUES('17770000-0000-4000-8000-000000000010','17770000-0000-4000-8000-000000000008','scanner',now());

INSERT INTO public.events(id,brand_id,title,slug,status,event_type) VALUES
 ('17770000-1000-4000-8000-000000000001','17770000-0000-4000-8000-000000000010','Circle paid event','circle-paid-event','scheduled','event'),
 ('17770000-1000-4000-8000-000000000002','17770000-0000-4000-8000-000000000010','Circle ended trip','circle-ended-trip','ended','trip'),
 ('17770000-1000-4000-8000-000000000003','17770000-0000-4000-8000-000000000010','Circle cancelled event','circle-cancelled-event','cancelled','event'),
 ('17770000-1000-4000-8000-000000000004','17770000-0000-4000-8000-000000000010','Circle different event','circle-different-event','scheduled','event');
INSERT INTO public.event_dates(id,event_id,start_at,end_at,is_master) VALUES
 ('17770000-1100-4000-8000-000000000001','17770000-1000-4000-8000-000000000001',now()+interval '1 day',now()+interval '2 days',true),
 ('17770000-1100-4000-8000-000000000002','17770000-1000-4000-8000-000000000001',now()+interval '3 days',now()+interval '4 days',false),
 ('17770000-1100-4000-8000-000000000003','17770000-1000-4000-8000-000000000002',now()-interval '3 days',now()-interval '2 days',true);
INSERT INTO public.ticket_types(id,event_id,name) VALUES
 ('17770000-1200-4000-8000-000000000001','17770000-1000-4000-8000-000000000001','Paid'),
 ('17770000-1200-4000-8000-000000000002','17770000-1000-4000-8000-000000000002','Ended'),
 ('17770000-1200-4000-8000-000000000003','17770000-1000-4000-8000-000000000003','Cancelled'),
 ('17770000-1200-4000-8000-000000000004','17770000-1000-4000-8000-000000000004','Different');
INSERT INTO public.orders(id,event_id,event_date_id,buyer_user_id,payment_status,source) VALUES
 ('17770000-2000-4000-8000-000000000001','17770000-1000-4000-8000-000000000001','17770000-1100-4000-8000-000000000001','17770000-0000-4000-8000-000000000002','paid','manual_import'),
 ('17770000-2000-4000-8000-000000000002','17770000-1000-4000-8000-000000000001','17770000-1100-4000-8000-000000000002','17770000-0000-4000-8000-000000000009','paid','manual_import'),
 ('17770000-2000-4000-8000-000000000003','17770000-1000-4000-8000-000000000001','17770000-1100-4000-8000-000000000002','17770000-0000-4000-8000-000000000009','paid','manual_import'),
 ('17770000-2000-4000-8000-000000000004','17770000-1000-4000-8000-000000000001','17770000-1100-4000-8000-000000000001','17770000-0000-4000-8000-00000000000a','partial_refund','manual_import'),
 ('17770000-2000-4000-8000-000000000005','17770000-1000-4000-8000-000000000001',NULL,'17770000-0000-4000-8000-00000000000b','refunded','manual_import'),
 ('17770000-2000-4000-8000-000000000006','17770000-1000-4000-8000-000000000001',NULL,'17770000-0000-4000-8000-00000000000c','paid','manual_import'),
 ('17770000-2000-4000-8000-000000000007','17770000-1000-4000-8000-000000000001',NULL,'17770000-0000-4000-8000-00000000000d','paid','manual_import'),
 ('17770000-2000-4000-8000-000000000008','17770000-1000-4000-8000-000000000003',NULL,'17770000-0000-4000-8000-000000000002','paid','manual_import'),
 ('17770000-2000-4000-8000-000000000009','17770000-1000-4000-8000-000000000003',NULL,'17770000-0000-4000-8000-00000000000e','paid','manual_import'),
 ('17770000-2000-4000-8000-00000000000a','17770000-1000-4000-8000-000000000004',NULL,'17770000-0000-4000-8000-00000000000f','paid','manual_import'),
 ('17770000-2000-4000-8000-00000000000b','17770000-1000-4000-8000-000000000002','17770000-1100-4000-8000-000000000003','17770000-0000-4000-8000-000000000002','paid','manual_import'),
 ('17770000-2000-4000-8000-00000000000c','17770000-1000-4000-8000-000000000002','17770000-1100-4000-8000-000000000003','17770000-0000-4000-8000-000000000012','paid','manual_import');
INSERT INTO public.tickets(id,order_id,ticket_type_id,event_id,qr_code,status,approval_status) VALUES
 ('17770000-2100-4000-8000-000000000001','17770000-2000-4000-8000-000000000001','17770000-1200-4000-8000-000000000001','17770000-1000-4000-8000-000000000001','1777-q1','valid','auto'),
 ('17770000-2100-4000-8000-000000000002','17770000-2000-4000-8000-000000000002','17770000-1200-4000-8000-000000000001','17770000-1000-4000-8000-000000000001','1777-q2','valid','approved'),
 ('17770000-2100-4000-8000-000000000003','17770000-2000-4000-8000-000000000003','17770000-1200-4000-8000-000000000001','17770000-1000-4000-8000-000000000001','1777-q3','valid','approved'),
 ('17770000-2100-4000-8000-000000000004','17770000-2000-4000-8000-000000000004','17770000-1200-4000-8000-000000000001','17770000-1000-4000-8000-000000000001','1777-q4','transferred','approved'),
 ('17770000-2100-4000-8000-000000000005','17770000-2000-4000-8000-000000000004','17770000-1200-4000-8000-000000000001','17770000-1000-4000-8000-000000000001','1777-q5','valid','approved'),
 ('17770000-2100-4000-8000-000000000006','17770000-2000-4000-8000-000000000005','17770000-1200-4000-8000-000000000001','17770000-1000-4000-8000-000000000001','1777-q6','valid','approved'),
 ('17770000-2100-4000-8000-000000000007','17770000-2000-4000-8000-000000000006','17770000-1200-4000-8000-000000000001','17770000-1000-4000-8000-000000000001','1777-q7','refunded','approved'),
 ('17770000-2100-4000-8000-000000000008','17770000-2000-4000-8000-000000000007','17770000-1200-4000-8000-000000000001','17770000-1000-4000-8000-000000000001','1777-q8','valid','pending'),
 ('17770000-2100-4000-8000-000000000009','17770000-2000-4000-8000-000000000008','17770000-1200-4000-8000-000000000003','17770000-1000-4000-8000-000000000003','1777-q9','valid','approved'),
 ('17770000-2100-4000-8000-00000000000a','17770000-2000-4000-8000-000000000009','17770000-1200-4000-8000-000000000003','17770000-1000-4000-8000-000000000003','1777-q10','valid','approved'),
 ('17770000-2100-4000-8000-00000000000b','17770000-2000-4000-8000-00000000000a','17770000-1200-4000-8000-000000000004','17770000-1000-4000-8000-000000000004','1777-q11','valid','approved'),
 ('17770000-2100-4000-8000-00000000000c','17770000-2000-4000-8000-00000000000b','17770000-1200-4000-8000-000000000002','17770000-1000-4000-8000-000000000002','1777-q12','used','approved'),
 ('17770000-2100-4000-8000-00000000000d','17770000-2000-4000-8000-00000000000c','17770000-1200-4000-8000-000000000002','17770000-1000-4000-8000-000000000002','1777-q13','used','approved');
INSERT INTO public.event_rsvps(id,event_id,user_id,guest_name,rsvp_status,approval_status,plus_count)
VALUES('17770000-2200-4000-8000-000000000001','17770000-1000-4000-8000-000000000001','17770000-0000-4000-8000-000000000002','RSVP source fixture','going','approved',1);
INSERT INTO public.event_rsvp_guests(id,rsvp_id,name,email,phone)
VALUES('17770000-2300-4000-8000-000000000001','17770000-2200-4000-8000-000000000001','RSVP guest fixture','rsvp-1777@example.test','+15555550177');

DO $fixtures$
DECLARE i integer; v_id uuid;
BEGIN
  FOR i IN 1..100 LOOP
    v_id:=md5('issue-1777-follower-'||i::text)::uuid;
    INSERT INTO auth.users(id) VALUES(v_id);
    INSERT INTO public.profiles(id,display_name,active,has_completed_onboarding,visibility_mode) VALUES(v_id,'Follower '||lpad(i::text,3,'0'),true,true,'friends');
    INSERT INTO public.brand_follows(user_id,brand_id) VALUES(v_id,'17770000-0000-4000-8000-000000000010');
  END LOOP;
  INSERT INTO public.brand_people(brand_id,linked_user_id,display_name) VALUES('17770000-0000-4000-8000-000000000010',md5('issue-1777-follower-100')::uuid,'Book owns this person');
END;
$fixtures$;

SELECT public.issue_1777_refresh_brand_reach('17770000-0000-4000-8000-000000000010','follower');
SELECT public.issue_1777_refresh_brand_reach('17770000-0000-4000-8000-000000000010','extended');
SELECT set_config('request.jwt.claim.sub','17770000-0000-4000-8000-000000000001',true);
DO $flags_off$
DECLARE v_page jsonb;
BEGIN
  v_page:=public.get_brand_circle_reach('17770000-0000-4000-8000-000000000010','all',NULL,50);
  IF v_page->>'state'<>'unavailable' OR jsonb_array_length(v_page->'rows')<>0
    OR v_page#>>'{availability,followers,reason}'<>'rollout_disabled'
    OR v_page#>>'{availability,extended,reason}'<>'controls_not_live'
  THEN RAISE EXCEPTION 'H-DB-2 flags-off contract drift: %',v_page; END IF;
END;
$flags_off$;

UPDATE public.feature_flags SET is_enabled=true WHERE flag_key IN('brand_circle_followers_v1','brand_circle_extended_v1','brand_circle_extended_controls_ios_v1','brand_circle_extended_controls_android_v1');
SELECT public.issue_1777_refresh_brand_reach('17770000-0000-4000-8000-000000000010','follower');
SELECT public.issue_1777_refresh_brand_reach('17770000-0000-4000-8000-000000000010','extended');

DO $test$
DECLARE v_f bigint; v_e bigint; v_page jsonb; v_second jsonb; v_extended jsonb; v_send jsonb; v_cursor jsonb; v_snapshot bigint; v_member uuid;
BEGIN
  SELECT count(*) FILTER(WHERE ring='follower'),count(*) FILTER(WHERE ring='extended') INTO v_f,v_e
  FROM public.issue_1777_resolve_brand_circle_members('17770000-0000-4000-8000-000000000010','all',NULL);
  IF v_f<>100 OR v_e<>6 THEN RAISE EXCEPTION 'H-DB-1/2 resolver/path/disjoint/Book precedence drift: %, %',v_f,v_e; END IF;
  IF EXISTS(SELECT 1 FROM public.issue_1777_resolve_brand_circle_members('17770000-0000-4000-8000-000000000010','extended',NULL) WHERE reason_code<>'extended_circle') THEN RAISE EXCEPTION 'H-DB-2 anonymous reason drift'; END IF;
  IF EXISTS(SELECT 1 FROM public.issue_1777_resolve_brand_circle_members('17770000-0000-4000-8000-000000000010','extended',NULL) WHERE user_id='17770000-0000-4000-8000-000000000007') THEN RAISE EXCEPTION 'H-DB-2 missing Ring-3 choice leaked'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.issue_1777_resolve_brand_circle_members('17770000-0000-4000-8000-000000000010','extended',NULL) WHERE user_id IN ('17770000-0000-4000-8000-000000000003','17770000-0000-4000-8000-000000000004','17770000-0000-4000-8000-000000000006')) THEN RAISE EXCEPTION 'H-DB-2 direct/close/friend-of-friend path missing'; END IF;

  v_page:=public.get_brand_circle_reach('17770000-0000-4000-8000-000000000010','all',NULL,50);
  IF v_page->>'state'<>'ready' OR (v_page#>>'{counts,total}')::int<>106 OR jsonb_array_length(v_page->'rows')<>50 OR v_page->'nextCursor' IS NULL THEN RAISE EXCEPTION 'H-DB-3 page/count contract drift: %',v_page; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_page->'rows') x WHERE (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(x) key)<>ARRAY['avatarUrl','displayName','memberId','reasonCode','reasonLabel','ring']::text[]) THEN RAISE EXCEPTION 'H-DB-3 row keys widened'; END IF;
  v_cursor:=v_page->'nextCursor';
  v_second:=public.get_brand_circle_reach('17770000-0000-4000-8000-000000000010','all',v_cursor,50);
  IF jsonb_array_length(v_second->'rows')<>50 THEN RAISE EXCEPTION 'H-DB-3 deterministic second page drift'; END IF;
  v_extended:=public.get_brand_circle_reach('17770000-0000-4000-8000-000000000010','extended',NULL,50);
  IF jsonb_array_length(v_extended->'rows')<>6 OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_extended->'rows') x WHERE x->>'reasonLabel'<>'In your extended circle.') THEN RAISE EXCEPTION 'H-DB-2 ring-specific anonymous list drift: %',v_extended; END IF;

  SELECT snapshot_version INTO v_snapshot FROM public.brand_reach_refresh_state WHERE brand_id='17770000-0000-4000-8000-000000000010';
  SELECT member_id INTO v_member FROM public.brand_reach_members WHERE brand_id='17770000-0000-4000-8000-000000000010' AND user_id='17770000-0000-4000-8000-000000000002';
  v_send:=public.issue_1777_revalidate_brand_circle_delivery('17770000-0000-4000-8000-000000000010','17770000-0000-4000-8000-000000000001',v_snapshot,ARRAY[v_member],'promotion');
  IF v_send->>'state'<>'ready' OR v_send#>>'{rows,0,eligibility}'<>'eligible' THEN RAISE EXCEPTION 'H-DB-4 Follow activation/send seam drift: %',v_send; END IF;
END;
$test$;

-- H-DB-4: Circle activation and the final channel authority stay separate.
INSERT INTO public.channel_suppressions(user_id,channel,scope,reason)
VALUES('17770000-0000-4000-8000-000000000002','email','marketing','manual');
DO $activation$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.issue_1777_resolve_brand_circle_members('17770000-0000-4000-8000-000000000010','follower',NULL) WHERE user_id='17770000-0000-4000-8000-000000000002') THEN RAISE EXCEPTION 'H-DB-4 current Follow did not activate Ring 2'; END IF;
  IF public.can_send('17770000-0000-4000-8000-000000000002','marketing','email',NULL) THEN RAISE EXCEPTION 'H-DB-4 downstream channel suppression bypassed'; END IF;
  IF EXISTS(SELECT 1 FROM public.issue_1777_resolve_brand_circle_members('17770000-0000-4000-8000-000000000010','extended',NULL) WHERE user_id='17770000-0000-4000-8000-000000000007') THEN RAISE EXCEPTION 'H-DB-4 missing Ring-3 choice activated'; END IF;
END;
$activation$;
INSERT INTO public.brand_circle_preferences(user_id,extended_brand_reach_enabled,extended_brand_reach_decided_at)
VALUES('17770000-0000-4000-8000-000000000007',true,now());
DO $choice_on$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.issue_1777_resolve_brand_circle_members('17770000-0000-4000-8000-000000000010','extended',NULL) WHERE user_id='17770000-0000-4000-8000-000000000007') THEN RAISE EXCEPTION 'H-DB-4 explicit Ring-3 choice did not activate'; END IF;
END;
$choice_on$;
DELETE FROM public.brand_circle_preferences WHERE user_id='17770000-0000-4000-8000-000000000007';

-- Amendment A6 paid matrix: offering-wide identity, exact entitlement, no seat-count inference.
DO $paid_matrix$
DECLARE v_status text;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.issue_1777_resolve_brand_circle_members('17770000-0000-4000-8000-000000000010','extended',NULL) WHERE user_id IN ('17770000-0000-4000-8000-000000000009','17770000-0000-4000-8000-00000000000a','17770000-0000-4000-8000-000000000012')) THEN RAISE EXCEPTION 'A6 paid/partial-refund/ended-used path missing'; END IF;
  IF EXISTS(SELECT 1 FROM public.issue_1777_resolve_brand_circle_members('17770000-0000-4000-8000-000000000010','extended',NULL) WHERE user_id IN ('17770000-0000-4000-8000-00000000000b','17770000-0000-4000-8000-00000000000c','17770000-0000-4000-8000-00000000000d','17770000-0000-4000-8000-00000000000e','17770000-0000-4000-8000-00000000000f')) THEN RAISE EXCEPTION 'A6 denied paid matrix leaked'; END IF;
  IF (SELECT count(*) FROM public.issue_1777_resolve_brand_circle_members('17770000-0000-4000-8000-000000000010','extended',NULL) WHERE user_id='17770000-0000-4000-8000-000000000009')<>1 THEN RAISE EXCEPTION 'A6 duplicate orders duplicated membership'; END IF;

  UPDATE public.tickets SET status='transferred' WHERE id='17770000-2100-4000-8000-000000000005';
  IF EXISTS(SELECT 1 FROM public.issue_1777_resolve_brand_circle_members('17770000-0000-4000-8000-000000000010','extended',NULL) WHERE user_id='17770000-0000-4000-8000-00000000000a') THEN RAISE EXCEPTION 'A6 all seats transferred still qualified'; END IF;
  UPDATE public.tickets SET status='valid' WHERE id='17770000-2100-4000-8000-000000000005';
  IF NOT EXISTS(SELECT 1 FROM public.issue_1777_resolve_brand_circle_members('17770000-0000-4000-8000-000000000010','extended',NULL) WHERE user_id='17770000-0000-4000-8000-00000000000a') THEN RAISE EXCEPTION 'A6 one retained seat did not qualify'; END IF;

  FOREACH v_status IN ARRAY ARRAY['refunded','cancelled','pending','failed'] LOOP
    UPDATE public.orders SET payment_status=v_status WHERE id='17770000-2000-4000-8000-000000000005';
    IF EXISTS(SELECT 1 FROM public.issue_1777_resolve_brand_circle_members('17770000-0000-4000-8000-000000000010','extended',NULL) WHERE user_id='17770000-0000-4000-8000-00000000000b') THEN RAISE EXCEPTION 'A6 payment status % leaked',v_status; END IF;
  END LOOP;
  UPDATE public.orders SET payment_status='paid' WHERE id='17770000-2000-4000-8000-000000000005';
  IF NOT EXISTS(SELECT 1 FROM public.issue_1777_resolve_brand_circle_members('17770000-0000-4000-8000-000000000010','extended',NULL) WHERE user_id='17770000-0000-4000-8000-00000000000b') THEN RAISE EXCEPTION 'A6 paid gain missing'; END IF;
  UPDATE public.orders SET payment_status='refunded' WHERE id='17770000-2000-4000-8000-000000000005';

  FOREACH v_status IN ARRAY ARRAY['refund_pending','refunded','void','transferred'] LOOP
    UPDATE public.tickets SET status=v_status WHERE id='17770000-2100-4000-8000-000000000007';
    IF EXISTS(SELECT 1 FROM public.issue_1777_resolve_brand_circle_members('17770000-0000-4000-8000-000000000010','extended',NULL) WHERE user_id='17770000-0000-4000-8000-00000000000c') THEN RAISE EXCEPTION 'A6 ticket status % leaked',v_status; END IF;
  END LOOP;
  UPDATE public.tickets SET status='valid' WHERE id='17770000-2100-4000-8000-000000000007';
  IF NOT EXISTS(SELECT 1 FROM public.issue_1777_resolve_brand_circle_members('17770000-0000-4000-8000-000000000010','extended',NULL) WHERE user_id='17770000-0000-4000-8000-00000000000c') THEN RAISE EXCEPTION 'A6 valid ticket gain missing'; END IF;
  UPDATE public.tickets SET status='refunded' WHERE id='17770000-2100-4000-8000-000000000007';

  FOREACH v_status IN ARRAY ARRAY['pending','rejected'] LOOP
    UPDATE public.tickets SET approval_status=v_status WHERE id='17770000-2100-4000-8000-000000000008';
    IF EXISTS(SELECT 1 FROM public.issue_1777_resolve_brand_circle_members('17770000-0000-4000-8000-000000000010','extended',NULL) WHERE user_id='17770000-0000-4000-8000-00000000000d') THEN RAISE EXCEPTION 'A6 approval status % leaked',v_status; END IF;
  END LOOP;
  UPDATE public.tickets SET approval_status='approved' WHERE id='17770000-2100-4000-8000-000000000008';
  IF NOT EXISTS(SELECT 1 FROM public.issue_1777_resolve_brand_circle_members('17770000-0000-4000-8000-000000000010','extended',NULL) WHERE user_id='17770000-0000-4000-8000-00000000000d') THEN RAISE EXCEPTION 'A6 approved ticket gain missing'; END IF;
  UPDATE public.tickets SET approval_status='pending' WHERE id='17770000-2100-4000-8000-000000000008';

  FOREACH v_status IN ARRAY ARRAY['draft','cancelled'] LOOP
    UPDATE public.events SET status=v_status,deleted_at=NULL WHERE id='17770000-1000-4000-8000-000000000003';
    IF EXISTS(SELECT 1 FROM public.issue_1777_resolve_brand_circle_members('17770000-0000-4000-8000-000000000010','extended',NULL) WHERE user_id='17770000-0000-4000-8000-00000000000e') THEN RAISE EXCEPTION 'A6 event status % leaked',v_status; END IF;
  END LOOP;
  UPDATE public.events SET status='scheduled',deleted_at=now() WHERE id='17770000-1000-4000-8000-000000000003';
  IF EXISTS(SELECT 1 FROM public.issue_1777_resolve_brand_circle_members('17770000-0000-4000-8000-000000000010','extended',NULL) WHERE user_id='17770000-0000-4000-8000-00000000000e') THEN RAISE EXCEPTION 'A6 deleted event leaked'; END IF;
  UPDATE public.events SET status='scheduled',deleted_at=NULL WHERE id='17770000-1000-4000-8000-000000000003';
  IF NOT EXISTS(SELECT 1 FROM public.issue_1777_resolve_brand_circle_members('17770000-0000-4000-8000-000000000010','extended',NULL) WHERE user_id='17770000-0000-4000-8000-00000000000e') THEN RAISE EXCEPTION 'A6 scheduled event gain missing'; END IF;
  UPDATE public.events SET status='cancelled' WHERE id='17770000-1000-4000-8000-000000000003';

  UPDATE public.orders SET buyer_user_id=NULL WHERE id='17770000-2000-4000-8000-000000000002';
  UPDATE public.orders SET buyer_user_id=NULL WHERE id='17770000-2000-4000-8000-000000000003';
  IF EXISTS(SELECT 1 FROM public.issue_1777_resolve_brand_circle_members('17770000-0000-4000-8000-000000000010','extended',NULL) WHERE user_id='17770000-0000-4000-8000-000000000009') THEN RAISE EXCEPTION 'A6 buyer identity unlink leaked'; END IF;
  UPDATE public.orders SET buyer_user_id='17770000-0000-4000-8000-000000000009' WHERE id IN ('17770000-2000-4000-8000-000000000002','17770000-2000-4000-8000-000000000003');
  IF EXISTS(SELECT 1 FROM public.issue_1777_resolve_brand_circle_members('17770000-0000-4000-8000-000000000010','extended',NULL) WHERE user_id='17770000-0000-4000-8000-00000000000f') THEN RAISE EXCEPTION 'A6 different event joined identities'; END IF;
END;
$paid_matrix$;

-- H-DB-1 disjointness remains synchronous through active Book conversion.
INSERT INTO public.brand_circle_exits(brand_id,user_id,visibility_exited_at,delivery_exited_at)
VALUES('17770000-0000-4000-8000-000000000010',md5('issue-1777-follower-99')::uuid,now(),now());
DO $exit$
BEGIN
  IF EXISTS(SELECT 1 FROM public.issue_1777_resolve_brand_circle_members('17770000-0000-4000-8000-000000000010','follower',NULL) WHERE user_id=md5('issue-1777-follower-99')::uuid) THEN RAISE EXCEPTION 'H-DB-1 current exit leaked follower'; END IF;
END;
$exit$;
DELETE FROM public.brand_circle_exits WHERE brand_id='17770000-0000-4000-8000-000000000010' AND user_id=md5('issue-1777-follower-99')::uuid;
INSERT INTO public.brand_people(brand_id,linked_user_id,display_name)
VALUES('17770000-0000-4000-8000-000000000010','17770000-0000-4000-8000-000000000002','Root joins Book');
DO $book$
BEGIN
  IF EXISTS(SELECT 1 FROM public.issue_1777_resolve_brand_circle_members('17770000-0000-4000-8000-000000000010','follower',NULL) WHERE user_id='17770000-0000-4000-8000-000000000002') THEN RAISE EXCEPTION 'H-DB-1 active Book subtraction removed'; END IF;
END;
$book$;
DELETE FROM public.brand_people WHERE brand_id='17770000-0000-4000-8000-000000000010' AND linked_user_id='17770000-0000-4000-8000-000000000002';

SELECT public.issue_1777_refresh_brand_reach('17770000-0000-4000-8000-000000000010','follower');
SELECT public.issue_1777_refresh_brand_reach('17770000-0000-4000-8000-000000000010','extended');

-- Exact API validation and current authorization.
DO $validation$
DECLARE v_member uuid; v_snapshot bigint; v_result jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub','17770000-0000-4000-8000-000000000008',true);
  BEGIN
    PERFORM public.get_brand_circle_reach('17770000-0000-4000-8000-000000000010','all',NULL,50);
    RAISE EXCEPTION 'H-DB-3 rank-10 actor was accepted';
  EXCEPTION WHEN SQLSTATE '42501' THEN IF SQLERRM<>'circle_forbidden' THEN RAISE; END IF; END;
  PERFORM set_config('request.jwt.claim.sub','17770000-0000-4000-8000-000000000001',true);
  BEGIN PERFORM public.get_brand_circle_reach('17770000-0000-4000-8000-000000000010',NULL,NULL,50); RAISE EXCEPTION 'NULL ring accepted'; EXCEPTION WHEN SQLSTATE '22023' THEN IF SQLERRM<>'circle_ring_invalid' THEN RAISE; END IF; END;
  BEGIN PERFORM public.get_brand_circle_reach('17770000-0000-4000-8000-000000000010','all',NULL,NULL); RAISE EXCEPTION 'NULL limit accepted'; EXCEPTION WHEN SQLSTATE '22023' THEN IF SQLERRM<>'circle_limit_invalid' THEN RAISE; END IF; END;
  BEGIN PERFORM public.get_brand_circle_reach('17770000-0000-4000-8000-000000000010','all',jsonb_build_object('snapshotVersion',NULL,'ringOrder',2,'sortName','a','memberId','17770000-0000-4000-8000-000000000002'),50); RAISE EXCEPTION 'NULL cursor snapshot accepted'; EXCEPTION WHEN SQLSTATE '22023' THEN IF SQLERRM<>'circle_cursor_invalid' THEN RAISE; END IF; END;
  BEGIN PERFORM public.get_brand_circle_reach('17770000-0000-4000-8000-000000000010','all',jsonb_build_object('snapshotVersion',1.5,'ringOrder',2,'sortName','a','memberId','17770000-0000-4000-8000-000000000002'),50); RAISE EXCEPTION 'fractional cursor snapshot accepted'; EXCEPTION WHEN SQLSTATE '22023' THEN IF SQLERRM<>'circle_cursor_invalid' THEN RAISE; END IF; END;
  BEGIN PERFORM public.get_brand_circle_reach('17770000-0000-4000-8000-000000000010','all',jsonb_build_object('snapshotVersion',999999999999999999999999::numeric,'ringOrder',2,'sortName','a','memberId','17770000-0000-4000-8000-000000000002'),50); RAISE EXCEPTION 'oversized cursor snapshot accepted'; EXCEPTION WHEN SQLSTATE '22023' THEN IF SQLERRM<>'circle_cursor_invalid' THEN RAISE; END IF; END;
  BEGIN PERFORM public.issue_1777_refresh_brand_reach_batch(NULL); RAISE EXCEPTION 'NULL batch limit accepted'; EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'circle_limit_invalid' THEN RAISE; END IF; END;
  SELECT snapshot_version INTO v_snapshot FROM public.brand_reach_refresh_state WHERE brand_id='17770000-0000-4000-8000-000000000010';
  SELECT member_id INTO v_member FROM public.brand_reach_members WHERE brand_id='17770000-0000-4000-8000-000000000010' AND user_id='17770000-0000-4000-8000-000000000002';
  v_result:=public.issue_1777_revalidate_brand_circle_delivery('17770000-0000-4000-8000-000000000010','17770000-0000-4000-8000-000000000008',v_snapshot,ARRAY[v_member],'promotion');
  IF v_result->>'state'<>'unavailable' THEN RAISE EXCEPTION 'H-DB-3 delivery rank guard bypassed: %',v_result; END IF;
END;
$validation$;

-- Amendment A2/A6: both #1777 failure paths may fail, but direct source writes survive.
CREATE TEMP TABLE issue_1777_saved_dirty_function(definition text) ON COMMIT DROP;
INSERT INTO issue_1777_saved_dirty_function
SELECT pg_get_functiondef('public.issue_1777_mark_brand_reach_dirty(uuid[],text)'::regprocedure);
CREATE TEMP TABLE issue_1777_saved_snapshot(snapshot_version bigint,member_id uuid) ON COMMIT DROP;
INSERT INTO issue_1777_saved_snapshot
SELECT s.snapshot_version,m.member_id FROM public.brand_reach_refresh_state s JOIN public.brand_reach_members m ON m.brand_id=s.brand_id
WHERE s.brand_id='17770000-0000-4000-8000-000000000010' AND m.user_id='17770000-0000-4000-8000-000000000002';
CREATE OR REPLACE FUNCTION public.issue_1777_mark_brand_reach_dirty(p_brand_ids uuid[],p_scope text DEFAULT 'both') RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fail$ BEGIN RAISE EXCEPTION 'injected_dirty_failure'; END; $fail$;
CREATE OR REPLACE FUNCTION pg_temp.issue_1777_fail_control_write() RETURNS trigger LANGUAGE plpgsql AS $fail$ BEGIN RAISE EXCEPTION 'injected_control_failure'; END; $fail$;
CREATE TRIGGER issue_1777_test_control_failure BEFORE INSERT OR UPDATE ON public.brand_reach_control FOR EACH ROW EXECUTE FUNCTION pg_temp.issue_1777_fail_control_write();

SAVEPOINT source_follow_insert; INSERT INTO public.brand_follows(user_id,brand_id) VALUES('17770000-0000-4000-8000-000000000011','17770000-0000-4000-8000-000000000010'); RELEASE SAVEPOINT source_follow_insert;
SAVEPOINT source_follow_delete; DELETE FROM public.brand_follows WHERE user_id='17770000-0000-4000-8000-000000000011' AND brand_id='17770000-0000-4000-8000-000000000010'; RELEASE SAVEPOINT source_follow_delete;
SAVEPOINT source_block_forward; INSERT INTO public.blocked_users(blocker_id,blocked_id) VALUES('17770000-0000-4000-8000-000000000002','17770000-0000-4000-8000-000000000003'); RELEASE SAVEPOINT source_block_forward;
SAVEPOINT source_block_reverse; INSERT INTO public.blocked_users(blocker_id,blocked_id) VALUES('17770000-0000-4000-8000-000000000004','17770000-0000-4000-8000-000000000002'); RELEASE SAVEPOINT source_block_reverse;
SAVEPOINT source_profile; UPDATE public.profiles SET visibility_mode='private' WHERE id='17770000-0000-4000-8000-000000000002'; RELEASE SAVEPOINT source_profile;
SAVEPOINT source_preference; UPDATE public.brand_circle_preferences SET extended_brand_reach_enabled=false WHERE user_id='17770000-0000-4000-8000-000000000003'; RELEASE SAVEPOINT source_preference;
SAVEPOINT source_leave; INSERT INTO public.brand_circle_exits(brand_id,user_id,visibility_exited_at,delivery_exited_at) VALUES('17770000-0000-4000-8000-000000000010','17770000-0000-4000-8000-000000000004',now(),now()); RELEASE SAVEPOINT source_leave;
SAVEPOINT source_friend; UPDATE public.friends SET deleted_at=now() WHERE user_id='17770000-0000-4000-8000-000000000002' AND friend_user_id='17770000-0000-4000-8000-000000000005'; RELEASE SAVEPOINT source_friend;
SAVEPOINT source_pairing; UPDATE public.pairings SET created_at=created_at+interval '1 second' WHERE pair_request_id='17770000-3000-4000-8000-000000000001'; RELEASE SAVEPOINT source_pairing;
SAVEPOINT source_order_gain; UPDATE public.orders SET payment_status='paid' WHERE id='17770000-2000-4000-8000-000000000005'; RELEASE SAVEPOINT source_order_gain;
SAVEPOINT source_order_loss; UPDATE public.orders SET payment_status='refunded' WHERE id='17770000-2000-4000-8000-000000000005'; RELEASE SAVEPOINT source_order_loss;
SAVEPOINT source_ticket_refund; UPDATE public.tickets SET status='refund_pending' WHERE id='17770000-2100-4000-8000-000000000005'; RELEASE SAVEPOINT source_ticket_refund;
SAVEPOINT source_ticket_transfer; UPDATE public.tickets SET status='transferred' WHERE id='17770000-2100-4000-8000-000000000005'; RELEASE SAVEPOINT source_ticket_transfer;
SAVEPOINT source_ticket_loss; UPDATE public.tickets SET status='void' WHERE id='17770000-2100-4000-8000-000000000005'; RELEASE SAVEPOINT source_ticket_loss;
SAVEPOINT source_event_cancel; UPDATE public.events SET status='cancelled' WHERE id='17770000-1000-4000-8000-000000000002'; RELEASE SAVEPOINT source_event_cancel;
SAVEPOINT source_event_delete; UPDATE public.events SET deleted_at=now() WHERE id='17770000-1000-4000-8000-000000000002'; RELEASE SAVEPOINT source_event_delete;
SAVEPOINT source_event_date; UPDATE public.event_dates SET end_at=end_at+interval '1 hour' WHERE id='17770000-1100-4000-8000-000000000001'; RELEASE SAVEPOINT source_event_date;
SAVEPOINT source_rsvp; UPDATE public.event_rsvps SET plus_count=2 WHERE id='17770000-2200-4000-8000-000000000001'; RELEASE SAVEPOINT source_rsvp;
SAVEPOINT source_rsvp_guest; UPDATE public.event_rsvp_guests SET name='RSVP guest mutation survived' WHERE id='17770000-2300-4000-8000-000000000001'; RELEASE SAVEPOINT source_rsvp_guest;

DROP TRIGGER issue_1777_test_control_failure ON public.brand_reach_control;
DO $restore_dirty$ DECLARE v_definition text; BEGIN SELECT definition INTO v_definition FROM issue_1777_saved_dirty_function; EXECUTE v_definition; END; $restore_dirty$;

DO $stale_denial$
DECLARE v_page jsonb; v_send jsonb; v_snapshot bigint; v_member uuid;
BEGIN
  PERFORM set_config('request.jwt.claim.sub','17770000-0000-4000-8000-000000000001',true);
  v_page:=public.get_brand_circle_reach('17770000-0000-4000-8000-000000000010','all',NULL,50);
  IF v_page->>'state'<>'unavailable' OR jsonb_array_length(v_page->'rows')<>0 OR v_page#>>'{counts,total}' IS NOT NULL THEN RAISE EXCEPTION 'A2 dual-failure stale list leaked: %',v_page; END IF;
  SELECT snapshot_version,member_id INTO v_snapshot,v_member FROM issue_1777_saved_snapshot;
  v_send:=public.issue_1777_revalidate_brand_circle_delivery('17770000-0000-4000-8000-000000000010','17770000-0000-4000-8000-000000000001',v_snapshot,ARRAY[v_member],'promotion');
  IF v_send->>'state'<>'unavailable' THEN RAISE EXCEPTION 'A2 dual-failure stale send passed: %',v_send; END IF;
  IF (SELECT circuit_open FROM public.brand_reach_control WHERE singleton) THEN RAISE EXCEPTION 'A2 injected circuit write unexpectedly succeeded'; END IF;
END;
$stale_denial$;

-- Implementor-owned privilege/catalog contract.
DO $catalog$
DECLARE v_table text; v_fn regprocedure; v_config text[];
BEGIN
  FOREACH v_table IN ARRAY ARRAY['brand_circle_preferences','brand_circle_exits','brand_reach_refresh_state','brand_reach_members','brand_reach_control'] LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=v_table AND c.relrowsecurity) THEN RAISE EXCEPTION 'A6 RLS missing: %',v_table; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name IN ('brand_reach_refresh_state','brand_reach_members','brand_reach_control') AND grantee IN ('anon','authenticated')) THEN RAISE EXCEPTION 'A6 private table grant leaked'; END IF;
  IF has_function_privilege('anon','public.get_brand_circle_reach(uuid,text,jsonb,integer)','EXECUTE') OR NOT has_function_privilege('authenticated','public.get_brand_circle_reach(uuid,text,jsonb,integer)','EXECUTE') THEN RAISE EXCEPTION 'A6 list grants drifted'; END IF;
  FOREACH v_fn IN ARRAY ARRAY[
    'public.issue_1777_resolve_brand_circle_members(uuid,text,uuid[])'::regprocedure,
    'public.issue_1777_brand_reach_truth_digest(uuid,text)'::regprocedure,
    'public.issue_1777_refresh_brand_reach(uuid,text)'::regprocedure,
    'public.issue_1777_brand_reach_scope_status(uuid,text)'::regprocedure,
    'public.issue_1777_revalidate_brand_circle_delivery(uuid,uuid,bigint,uuid[],text)'::regprocedure
  ] LOOP
    SELECT proconfig INTO v_config FROM pg_proc WHERE oid=v_fn AND prosecdef AND pg_get_userbyid(proowner)='postgres';
    IF v_config IS NULL OR NOT EXISTS(SELECT 1 FROM unnest(v_config) x WHERE x IN ('search_path=public, extensions, pg_temp','search_path=public, pg_temp')) THEN RAISE EXCEPTION 'A6 secure function/search path drift: % / %',v_fn,v_config; END IF;
    IF has_function_privilege('anon',v_fn,'EXECUTE') OR has_function_privilege('authenticated',v_fn,'EXECUTE') THEN RAISE EXCEPTION 'A6 private helper grant leaked: %',v_fn; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='brand_reach_members' AND column_name ~* '(email|phone|contact|address|device|appsflyer|event|path|connector|relationship)') THEN RAISE EXCEPTION 'A6 forbidden material column'; END IF;
  IF (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_proc p ON p.oid=t.tgfoid WHERE NOT t.tgisinternal AND p.proname='issue_1777_after_source_change' AND c.relname IN ('event_rsvps','event_rsvp_guests','refunds','payment_webhook_events'))<>0 THEN RAISE EXCEPTION 'A6 forbidden source trigger'; END IF;
  IF (SELECT count(*) FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE NOT t.tgisinternal AND p.proname='issue_1777_after_source_change' AND (t.tgtype&2)=0 AND NOT t.tgdeferrable)<>13 THEN RAISE EXCEPTION 'A6 direct AFTER trigger count drift'; END IF;
  IF (SELECT count(*) FROM cron.job WHERE jobname='issue_1777_brand_reach_refresh')<>1 THEN RAISE EXCEPTION 'A6 cron uniqueness drift'; END IF;
END;
$catalog$;

ROLLBACK;
SELECT 'issue_1777_brand_circle_reach_happy: PASS' AS result;
