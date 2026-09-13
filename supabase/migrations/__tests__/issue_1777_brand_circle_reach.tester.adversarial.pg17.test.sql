-- Issue #1777 independent tester adversarial guard (PostgreSQL 17).
-- This fixture is transaction-contained and exercises hostile identity, canonical
-- block, stale-generation, authorization, materialization, and delivery paths.

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users(id) VALUES
  ('1777a000-0000-4000-8000-000000000001'), -- brand owner
  ('1777a000-0000-4000-8000-000000000002'), -- root follower
  ('1777a000-0000-4000-8000-000000000003'), -- extended target
  ('1777a000-0000-4000-8000-000000000004'), -- second follower
  ('1777a000-0000-4000-8000-000000000005'), -- inactive
  ('1777a000-0000-4000-8000-000000000006'), -- private
  ('1777a000-0000-4000-8000-000000000007'), -- blank identity
  ('1777a000-0000-4000-8000-000000000008'), -- other brand owner
  ('1777a000-0000-4000-8000-000000000009')  -- fake friends-status case
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.creator_accounts(id,email) VALUES
  ('1777a000-0000-4000-8000-000000000001','issue1777-adversarial-owner@example.test'),
  ('1777a000-0000-4000-8000-000000000008','issue1777-adversarial-other@example.test')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.brands(id,account_id,name,slug,default_currency,created_at,updated_at) VALUES
  ('1777a000-1000-4000-8000-000000000001','1777a000-0000-4000-8000-000000000001','Adversarial Circle Brand','issue1777-adversarial','USD',now(),now()),
  ('1777a000-1000-4000-8000-000000000002','1777a000-0000-4000-8000-000000000008','Other Circle Brand','issue1777-adversarial-other','USD',now(),now())
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.profiles(id,first_name,last_name,display_name,username,active,has_completed_onboarding,visibility_mode)
VALUES
  ('1777a000-0000-4000-8000-000000000002','Root','Follower','Ignored','issue1777-root',true,true,'friends'),
  ('1777a000-0000-4000-8000-000000000003','Extended','Target','Ignored','issue1777-target',true,true,'friends'),
  ('1777a000-0000-4000-8000-000000000004','Second','Follower','Ignored','issue1777-second',true,true,'friends'),
  ('1777a000-0000-4000-8000-000000000005','Inactive','Person','Ignored','issue1777-inactive',false,true,'friends'),
  ('1777a000-0000-4000-8000-000000000006','Private','Person','Ignored','issue1777-private',true,true,'private'),
  ('1777a000-0000-4000-8000-000000000007',NULL,NULL,NULL,NULL,true,true,'friends'),
  ('1777a000-0000-4000-8000-000000000009','Fake','Status','Ignored','issue1777-fake',true,true,'friends')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.feature_flags(flag_key,is_enabled,description) VALUES
  ('brand_circle_followers_v1',true,'tester'),
  ('brand_circle_extended_v1',true,'tester'),
  ('brand_circle_extended_controls_ios_v1',true,'tester'),
  ('brand_circle_extended_controls_android_v1',true,'tester')
ON CONFLICT (flag_key) DO UPDATE SET is_enabled=true;

INSERT INTO public.brand_follows(user_id,brand_id) VALUES
  ('1777a000-0000-4000-8000-000000000002','1777a000-1000-4000-8000-000000000001'),
  ('1777a000-0000-4000-8000-000000000004','1777a000-1000-4000-8000-000000000001'),
  ('1777a000-0000-4000-8000-000000000005','1777a000-1000-4000-8000-000000000001'),
  ('1777a000-0000-4000-8000-000000000006','1777a000-1000-4000-8000-000000000001'),
  ('1777a000-0000-4000-8000-000000000007','1777a000-1000-4000-8000-000000000001')
ON CONFLICT DO NOTHING;
INSERT INTO public.friends(user_id,friend_user_id,status)
VALUES
  ('1777a000-0000-4000-8000-000000000002','1777a000-0000-4000-8000-000000000003','accepted'),
  ('1777a000-0000-4000-8000-000000000002','1777a000-0000-4000-8000-000000000009','blocked')
ON CONFLICT DO NOTHING;
INSERT INTO public.brand_circle_preferences(user_id,extended_brand_reach_enabled,extended_brand_reach_decided_at)
VALUES
  ('1777a000-0000-4000-8000-000000000003',true,now()),
  ('1777a000-0000-4000-8000-000000000009',true,now())
ON CONFLICT (user_id) DO UPDATE SET extended_brand_reach_enabled=true,extended_brand_reach_decided_at=now();

-- A-DB-1: profile/auth/name predicates reject inactive, private, and nameless
-- records even when the source rows exist; a normal profile is retained.
SELECT public.issue_1777_refresh_brand_reach('1777a000-1000-4000-8000-000000000001','follower');
DO $identity$ DECLARE v_count bigint;
BEGIN
  SELECT count(*) INTO v_count FROM public.issue_1777_resolve_brand_circle_members('1777a000-1000-4000-8000-000000000001','follower',NULL);
  IF v_count<>2 THEN RAISE EXCEPTION 'A-DB-1 FAIL: expected two eligible followers, got %',v_count; END IF;
  IF EXISTS(SELECT 1 FROM public.issue_1777_resolve_brand_circle_members('1777a000-1000-4000-8000-000000000001','follower',NULL) WHERE user_id IN ('1777a000-0000-4000-8000-000000000005','1777a000-0000-4000-8000-000000000006','1777a000-0000-4000-8000-000000000007')) THEN
    RAISE EXCEPTION 'A-DB-1 FAIL: ineligible identity was materialized';
  END IF;
END;
$identity$;

-- A-DB-2/A-DB-3: Ring-3 requires explicit choice and the canonical
-- bidirectional blocked_users relation. A friends.status='blocked' row is not
-- treated as canonical block truth, and a Book conversion wins immediately.
SELECT public.issue_1777_refresh_brand_reach('1777a000-1000-4000-8000-000000000001','extended');
DO $blocks$ DECLARE v_count bigint;
BEGIN
  SELECT count(*) INTO v_count FROM public.issue_1777_resolve_brand_circle_members('1777a000-1000-4000-8000-000000000001','extended',NULL);
  IF v_count<>1 OR NOT EXISTS(SELECT 1 FROM public.issue_1777_resolve_brand_circle_members('1777a000-1000-4000-8000-000000000001','extended',NULL) WHERE user_id='1777a000-0000-4000-8000-000000000003') THEN
    RAISE EXCEPTION 'A-DB-2 FAIL: accepted path/explicit opt-in missing, count %',v_count;
  END IF;
  IF EXISTS(SELECT 1 FROM public.issue_1777_resolve_brand_circle_members('1777a000-1000-4000-8000-000000000001','extended',NULL) WHERE user_id='1777a000-0000-4000-8000-000000000009') THEN
    RAISE EXCEPTION 'A-DB-2 FAIL: friends.status=blocked became a positive path';
  END IF;
END;
$blocks$;
INSERT INTO public.blocked_users(blocker_id,blocked_id) VALUES
  ('1777a000-0000-4000-8000-000000000002','1777a000-0000-4000-8000-000000000003')
ON CONFLICT DO NOTHING;
SELECT public.issue_1777_refresh_brand_reach('1777a000-1000-4000-8000-000000000001','extended');
DO $canonical$ BEGIN
  IF EXISTS(SELECT 1 FROM public.issue_1777_resolve_brand_circle_members('1777a000-1000-4000-8000-000000000001','extended',NULL) WHERE user_id='1777a000-0000-4000-8000-000000000003') THEN RAISE EXCEPTION 'A-DB-2 FAIL: root-to-target canonical block leaked'; END IF;
END; $canonical$;
INSERT INTO public.brand_people(brand_id,linked_user_id,display_name)
VALUES('1777a000-1000-4000-8000-000000000001','1777a000-0000-4000-8000-000000000003','Book conversion');
SELECT public.issue_1777_refresh_brand_reach('1777a000-1000-4000-8000-000000000001','follower');
DO $book$ BEGIN
  IF EXISTS(SELECT 1 FROM public.issue_1777_resolve_brand_circle_members('1777a000-1000-4000-8000-000000000001','follower',NULL) WHERE user_id='1777a000-0000-4000-8000-000000000003') THEN RAISE EXCEPTION 'A-DB-3 FAIL: active Book conversion did not subtract'; END IF;
END; $book$;

-- A-DB-4: cursor validation is exact, stale cursors fail closed, and list
-- authorization does not disclose another brand or a scanner identity.
DO $cursor_auth$
DECLARE v_page jsonb; v_cursor jsonb; v_snapshot bigint;
BEGIN
  PERFORM set_config('request.jwt.claim.sub','1777a000-0000-4000-8000-000000000001',true);
  v_page:=public.get_brand_circle_reach('1777a000-1000-4000-8000-000000000001','follower',NULL,1);
  IF v_page->>'state' NOT IN ('ready','partial') OR jsonb_array_length(v_page->'rows')<>1 OR v_page->'nextCursor' IS NULL THEN RAISE EXCEPTION 'A-DB-4 FAIL: page contract drift %',v_page; END IF;
  v_cursor:=v_page->'nextCursor';
  BEGIN PERFORM public.get_brand_circle_reach('1777a000-1000-4000-8000-000000000001','follower',jsonb_build_object('wrong',1),1); RAISE EXCEPTION 'A-DB-4 FAIL: malformed cursor accepted'; EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%circle_cursor_invalid%' THEN RAISE; END IF; END;
  SELECT snapshot_version INTO v_snapshot FROM public.brand_reach_refresh_state WHERE brand_id='1777a000-1000-4000-8000-000000000001';
  DELETE FROM public.brand_follows WHERE brand_id='1777a000-1000-4000-8000-000000000001' AND user_id='1777a000-0000-4000-8000-000000000004';
  INSERT INTO public.brand_follows(user_id,brand_id) VALUES('1777a000-0000-4000-8000-000000000004','1777a000-1000-4000-8000-000000000001');
  BEGIN PERFORM public.get_brand_circle_reach('1777a000-1000-4000-8000-000000000001','follower',v_cursor,1); RAISE EXCEPTION 'A-DB-4 FAIL: stale cursor accepted'; EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%circle_cursor_stale%' THEN RAISE; END IF; END;
  BEGIN PERFORM public.get_brand_circle_reach('1777a000-1000-4000-8000-000000000002','all',NULL,1); RAISE EXCEPTION 'A-DB-4 FAIL: other-brand read accepted'; EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%circle_forbidden%' THEN RAISE; END IF; END;
END;
$cursor_auth$;

-- A-RLS-1: private materialization is not directly readable by authenticated,
-- anonymous, or the resolver helper; only the shaped list has a client grant.
DO $rls$
BEGIN
  SET LOCAL ROLE authenticated;
  BEGIN PERFORM count(*) FROM public.brand_reach_members; RAISE EXCEPTION 'A-RLS-1 FAIL: authenticated read grant leaked'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  SET LOCAL ROLE anon;
  BEGIN PERFORM public.get_brand_circle_reach('1777a000-1000-4000-8000-000000000001','all',NULL,1); RAISE EXCEPTION 'A-RLS-1 FAIL: anon RPC grant leaked'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
END;
$rls$;

-- A-DB-4/A-DB-3: delivery revalidation has a separate brand-exit denial even
-- when the selected member came from a ready materialized generation.
DO $delivery$ DECLARE v_snapshot bigint; v_member uuid; v_result jsonb;
BEGIN
  DELETE FROM public.blocked_users WHERE blocker_id='1777a000-0000-4000-8000-000000000002' AND blocked_id='1777a000-0000-4000-8000-000000000003';
  DELETE FROM public.brand_people WHERE brand_id='1777a000-1000-4000-8000-000000000001' AND linked_user_id='1777a000-0000-4000-8000-000000000003';
  SELECT snapshot_version INTO v_snapshot FROM public.brand_reach_refresh_state WHERE brand_id='1777a000-1000-4000-8000-000000000001';
  SELECT member_id INTO v_member FROM public.brand_reach_members WHERE brand_id='1777a000-1000-4000-8000-000000000001' AND ring='follower' LIMIT 1;
  INSERT INTO public.brand_circle_exits(brand_id,user_id,visibility_exited_at,delivery_exited_at) VALUES('1777a000-1000-4000-8000-000000000001','1777a000-0000-4000-8000-000000000002',now(),now());
  v_result:=public.issue_1777_revalidate_brand_circle_delivery('1777a000-1000-4000-8000-000000000001','1777a000-0000-4000-8000-000000000001',v_snapshot,ARRAY[v_member],'promotion');
  IF v_result->>'state'='ready' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_result->'rows') x WHERE x->>'eligibility'='denied' AND x->>'denialReason'='delivery_denied') THEN RAISE EXCEPTION 'A-DB-3 FAIL: delivery exit was not denied safely %',v_result; END IF;
  IF v_result->>'state' NOT IN ('ready','unavailable') OR v_result::text ~* '(email|phone|contact|address|1777a000)' THEN RAISE EXCEPTION 'A-DB-3 FAIL: delivery denial widened or leaked %',v_result; END IF;
END;
$delivery$;

ROLLBACK;
SELECT 'issue_1777_brand_circle_reach_tester_adversarial: PASS' AS result;
