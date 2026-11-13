-- #4402 tester: negative cases on the creator review migration.
--
-- MINGLA-INVARIANT: I-4402-CHECK-NEVER-UNDOES-ADMIN | issue #4402 | The bio-code check writes creator_handles only through issue_4402_record_handle_check (service role), a compare-and-set that skips the write once an admin approved or rejected the handle or its code changed, so an in-flight check never undoes an admin decision.
--
-- Written by the tester (verdict comment 6829319693), moved into the repo by
-- the implementor's rework and updated to Seth's 12 Nov 2026 rule (an admin
-- verifies every handle and every creator; a rejection sticks; no platform
-- audience band). Every row must PASS; the suite fails on any FAIL row.
--
-- Fails on 1f14a6c44c: T2d (a 1e20 provider count overflowed bigint), T3j (a
-- rejected handle took a new code), T3k (reject kept the admin band), T4a
-- (approve without a band) and T4b (the handle approve auto-verified). Fails
-- on fdbce4cd91: T5 (issue_4402_record_handle_check did not exist; the edge
-- overwrote an admin decision made during its profile fetch).
\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.act(p_user uuid) RETURNS void LANGUAGE sql AS $fn$
  SELECT set_config('request.jwt.claim.sub',coalesce(p_user::text,''),true),
         set_config('request.jwt.claims',CASE WHEN p_user IS NULL THEN '' ELSE json_build_object('sub',p_user,'role','authenticated')::text END,true);
$fn$;
SET LOCAL session_replication_role = replica;
INSERT INTO auth.users(id,email) VALUES
 ('44029000-0000-4000-8000-0000000000c1','t4402-creator@mingla.test'),
 ('44029000-0000-4000-8000-0000000000a1','t4402-admin@mingla.test');
INSERT INTO public.profiles(id,display_name) VALUES ('44029000-0000-4000-8000-0000000000c1','C'),('44029000-0000-4000-8000-0000000000a1','A');
INSERT INTO public.admin_users(email,status) VALUES('t4402-admin@mingla.test','active');
INSERT INTO public.payee_accounts(user_id,paystack_recipient_code,paystack_status) VALUES('44029000-0000-4000-8000-0000000000c1','RCP_t4402','verified');
INSERT INTO public.creator_media_jobs(client_operation_id,owner_kind,owner_id,purpose,bunny_video_id,status,duration_s,width,height,ready_at)
 VALUES (gen_random_uuid(),'creator','44029000-0000-4000-8000-0000000000c1','showcase','t4402-v','ready',12,720,1280,now());
INSERT INTO public.creator_profiles(creator_account_id,display_name,date_of_birth) VALUES('44029000-0000-4000-8000-0000000000c1','T Creator','1990-01-01');
SET LOCAL session_replication_role = origin;

CREATE TEMP TABLE r(name text, ok boolean, detail text);
GRANT ALL ON r TO PUBLIC;

-- T1: a creator cannot call the admin RPCs, the blockers helper or recompute.
SELECT pg_temp.act('44029000-0000-4000-8000-0000000000c1');
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN PERFORM public.admin_creator_handle_decide(gen_random_uuid(),'approve'); INSERT INTO r VALUES('T1a creator handle_decide refused',false,'ran');
  EXCEPTION WHEN others THEN INSERT INTO r VALUES('T1a creator handle_decide refused',SQLSTATE='42501',SQLSTATE||' '||SQLERRM); END;
  BEGIN PERFORM public.admin_creator_detail('44029000-0000-4000-8000-0000000000c1'); INSERT INTO r VALUES('T1b creator detail refused',false,'ran');
  EXCEPTION WHEN others THEN INSERT INTO r VALUES('T1b creator detail refused',SQLSTATE='42501',SQLSTATE||' '||SQLERRM); END;
  BEGIN PERFORM public.admin_creator_decide('44029000-0000-4000-8000-0000000000c1','verify'); INSERT INTO r VALUES('T1c creator decide refused',false,'ran');
  EXCEPTION WHEN others THEN INSERT INTO r VALUES('T1c creator decide refused',SQLSTATE='42501',SQLSTATE||' '||SQLERRM); END;
  BEGIN PERFORM public.issue_4402_creator_verify_blockers('44029000-0000-4000-8000-0000000000c1'); INSERT INTO r VALUES('T1d blockers helper not callable',false,'ran');
  EXCEPTION WHEN others THEN INSERT INTO r VALUES('T1d blockers helper not callable',SQLSTATE='42501',SQLSTATE); END;
  BEGIN PERFORM public.issue_4402_suggested_handles('44029000-0000-4000-8000-0000000000a1'); INSERT INTO r VALUES('T1e suggested_handles(other user) not callable',false,'ran');
  EXCEPTION WHEN others THEN INSERT INTO r VALUES('T1e suggested_handles(other user) not callable',SQLSTATE='42501',SQLSTATE); END;
  BEGIN PERFORM public.issue_3872_recompute_creator_verification('44029000-0000-4000-8000-0000000000c1',false); INSERT INTO r VALUES('T1f recompute not callable',false,'ran');
  EXCEPTION WHEN others THEN INSERT INTO r VALUES('T1f recompute not callable',SQLSTATE='42501',SQLSTATE); END;
  BEGIN PERFORM 1 FROM public.creator_review_events LIMIT 1; INSERT INTO r VALUES('T1g review events unreadable',false,'read');
  EXCEPTION WHEN others THEN INSERT INTO r VALUES('T1g review events unreadable',SQLSTATE='42501',SQLSTATE); END;
END $$;
-- Creator builds a handle and a rate.
DO $$ DECLARE v jsonb; BEGIN
  v:=public.creator_handle_upsert('tiktok','t4402handle','1k_10k');
  PERFORM public.creator_package_upsert('behind_the_scenes',ARRAY['tiktok'],50000,'NGN',5);
  BEGIN UPDATE public.creator_handles SET verified_at=now(), last_check_status='verified' WHERE creator_account_id='44029000-0000-4000-8000-0000000000c1';
    INSERT INTO r VALUES('T1h creator cannot self-verify a handle',NOT FOUND,'update ran');
  EXCEPTION WHEN others THEN INSERT INTO r VALUES('T1h creator cannot self-verify a handle',true,SQLSTATE); END;
  BEGIN PERFORM public.creator_handle_upsert('x','t4402x'); INSERT INTO r VALUES('T1i x refused',false,'ran');
  EXCEPTION WHEN others THEN INSERT INTO r VALUES('T1i x refused',SQLERRM='platform_unsupported',SQLERRM); END;
END $$;
RESET ROLE;
-- T1j: anon cannot execute the admin RPCs at all.
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM public.admin_creator_detail(gen_random_uuid()); INSERT INTO r VALUES('T1j anon detail refused',false,'ran');
  EXCEPTION WHEN others THEN INSERT INTO r VALUES('T1j anon detail refused',SQLSTATE='42501',SQLSTATE||' '||SQLERRM); END;
END $$;
RESET ROLE;

-- T2: every edge outcome row (the handle stays with a person) is CHECK-valid,
-- and no platform follower count can be stored at all.
DO $$ DECLARE h uuid; BEGIN
  SELECT id INTO h FROM public.creator_handles WHERE creator_account_id='44029000-0000-4000-8000-0000000000c1';
  INSERT INTO r SELECT 'T2 new handle waits for an admin', review_required AND review_reason='awaiting_admin' AND verified_at IS NULL, to_jsonb(x)::text FROM public.creator_handles x WHERE id=h;
  BEGIN UPDATE public.creator_handles SET last_checked_at=now(),last_check_status='code_not_seen',review_required=true,review_reason='verification_code_not_found' WHERE id=h; INSERT INTO r VALUES('T2a code-not-seen row valid',true,'');
  EXCEPTION WHEN others THEN INSERT INTO r VALUES('T2a code-not-seen row valid',false,SQLERRM); END;
  BEGIN UPDATE public.creator_handles SET last_check_status='unreadable',review_required=true,review_reason='provider_unreadable' WHERE id=h; INSERT INTO r VALUES('T2b unreadable row valid',true,'');
  EXCEPTION WHEN others THEN INSERT INTO r VALUES('T2b unreadable row valid',false,SQLERRM); END;
  BEGIN UPDATE public.creator_handles SET last_check_status='expired',review_required=true,review_reason='verification_code_expired' WHERE id=h; INSERT INTO r VALUES('T2c expired row valid',true,'');
  EXCEPTION WHEN others THEN INSERT INTO r VALUES('T2c expired row valid',false,SQLERRM); END;
  BEGIN UPDATE public.creator_handles SET last_check_status='code_seen',review_required=true,review_reason='code_seen' WHERE id=h; INSERT INTO r VALUES('T2e code-seen row valid',true,'');
  EXCEPTION WHEN others THEN INSERT INTO r VALUES('T2e code-seen row valid',false,SQLERRM); END;
  INSERT INTO r SELECT 'T2d no provider follower count column (nothing to overflow)', count(*)=0, count(*)::text
    FROM information_schema.columns WHERE table_schema='public' AND table_name='creator_handles' AND column_name='provider_follower_count';
  UPDATE public.creator_handles SET last_check_status=NULL,review_required=true,review_reason='awaiting_admin' WHERE id=h;
END $$;

CREATE TEMP TABLE hid AS SELECT id FROM public.creator_handles WHERE creator_account_id='44029000-0000-4000-8000-0000000000c1';
GRANT SELECT ON hid TO PUBLIC;
CREATE TEMP TABLE before_rev AS SELECT reviewed_at FROM public.creator_profiles WHERE creator_account_id='44029000-0000-4000-8000-0000000000c1';
-- T3: Verify gate. Agreement not signed -> refused; nothing written.
SELECT pg_temp.act('44029000-0000-4000-8000-0000000000a1');
SET LOCAL ROLE authenticated;
DO $$ DECLARE v jsonb; before timestamptz; n int; h uuid; BEGIN
  SELECT reviewed_at INTO before FROM public.creator_profiles WHERE creator_account_id='44029000-0000-4000-8000-0000000000c1';
  v:=public.admin_creator_decide('44029000-0000-4000-8000-0000000000c1','verify');
  INSERT INTO r VALUES('T3a verify refused with steps missing', v->>'error'='checks_incomplete', v::text);
  -- Approve the handle, reject it, approve with a bad band.
  SELECT id INTO h FROM hid;
  v:=public.admin_creator_handle_decide(h,'approve',NULL,'gt9m');
  INSERT INTO r VALUES('T3c bad band refused', v->>'error'='invalid_band', v::text);
  v:=public.admin_creator_handle_decide(h,'reject','   ');
  INSERT INTO r VALUES('T3d blank reject note refused', v->>'error'='note_required', v::text);
  v:=public.admin_creator_handle_decide(h,'approve',NULL,'10k_50k');
  INSERT INTO r VALUES('T3e approve ok, band admin', (v->'handle'->>'follower_source')='admin' AND v->>'ok'='true', v::text);
  v:=public.admin_creator_handle_decide(h,'reject','Not their account');
  INSERT INTO r VALUES('T3f revoke clears verified', (v->'handle'->>'verified_at') IS NULL AND v->'handle'->>'last_check_status'='rejected', v::text);
  INSERT INTO r VALUES('T3k revoke withdraws the admin band', v->'handle'->>'follower_source'='self_reported' AND v->'handle'->>'follower_band'='1k_10k', v::text);
  BEGIN PERFORM public.admin_creator_handle_decide(h,'APPROVE'); INSERT INTO r VALUES('T3h bad decision raises',false,'ran');
  EXCEPTION WHEN others THEN INSERT INTO r VALUES('T3h bad decision raises',SQLSTATE='22023',SQLSTATE); END;
END $$;
RESET ROLE;
-- T3j: the creator cannot undo the rejection with a new code.
SELECT pg_temp.act('44029000-0000-4000-8000-0000000000c1');
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN PERFORM public.creator_handle_upsert('tiktok','t4402handle','1k_10k'); INSERT INTO r VALUES('T3j rejected handle refuses a new code',false,'ran');
  EXCEPTION WHEN others THEN INSERT INTO r VALUES('T3j rejected handle refuses a new code',SQLERRM='handle_rejected',SQLERRM); END;
END $$;
RESET ROLE;
INSERT INTO r SELECT 'T3j rejection still on the row', last_check_status='rejected', coalesce(last_check_status,'null') FROM public.creator_handles WHERE id=(SELECT id FROM hid);
INSERT INTO r SELECT 'T3b refused verify wrote nothing (reviewed_at unchanged until T4)', (SELECT reviewed_at FROM before_rev) IS NULL, '';
INSERT INTO r SELECT 'T3g two audited handle events', count(*)=2, count(*)::text FROM public.creator_review_events WHERE creator_account_id='44029000-0000-4000-8000-0000000000c1' AND action IN ('handle_approve','handle_reject') AND handle_id IS NOT NULL AND platform='tiktok';
-- T4: with all six true, verify works; switching off the only rate drops them from view.
CREATE OR REPLACE FUNCTION public.issue_4216_creator_has_current_agreement(p_creator_account_id uuid) RETURNS boolean LANGUAGE sql STABLE AS 'SELECT true';
SELECT 'agreement now', public.issue_4216_creator_has_current_agreement('44029000-0000-4000-8000-0000000000c1');
SELECT pg_temp.act('44029000-0000-4000-8000-0000000000a1');
SET LOCAL ROLE authenticated;
DO $$ DECLARE v jsonb; h uuid; BEGIN
  SELECT id INTO h FROM hid;
  v:=public.admin_creator_handle_decide(h,'approve');
  INSERT INTO r VALUES('T4a approve needs the band the admin saw', v->>'error'='band_required', v::text);
  v:=public.admin_creator_handle_decide(h,'approve','Saw the code','1k_10k');
  INSERT INTO r VALUES('T4a2 approve after reject: six pass, only ready for review', v->>'ok'='true' AND jsonb_array_length(v->'missing')=0 AND v->>'verification'='review', v::text);
  v:=public.admin_creator_decide('44029000-0000-4000-8000-0000000000c1','verify');
  INSERT INTO r VALUES('T4b verify with six', v->>'verification' IN ('verified'), v::text);
END $$;
SELECT pg_temp.act('44029000-0000-4000-8000-0000000000c1');
DO $$ DECLARE st text; BEGIN
  PERFORM public.creator_package_upsert('behind_the_scenes',ARRAY['tiktok'],50000,'NGN',5,90,NULL,false);
  SELECT verification INTO st FROM public.creator_profiles WHERE creator_account_id='44029000-0000-4000-8000-0000000000c1';
  INSERT INTO r VALUES('T4c rate off leaves verified', st<>'verified', st);
END $$;
RESET ROLE;
-- T5 (retest 6830468345, P2-A, probes R5/R5b): an admin decision that lands
-- while the bio check fetches the profile is never overwritten. The edge saves
-- only through issue_4402_record_handle_check (compare-and-set).
SELECT pg_temp.act('44029000-0000-4000-8000-0000000000c1');
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  PERFORM public.creator_handle_upsert('youtube','t4402yt','1k_10k');
  PERFORM public.creator_handle_upsert('snapchat','t4402snap','1k_10k');
  PERFORM public.creator_handle_upsert('instagram','t4402ig','1k_10k');
  BEGIN PERFORM public.issue_4402_record_handle_check(gen_random_uuid(),'44029000-0000-4000-8000-0000000000c1','X','code_seen','code_seen'); INSERT INTO r VALUES('T5f creator cannot call the check writer',false,'ran');
  EXCEPTION WHEN others THEN INSERT INTO r VALUES('T5f creator cannot call the check writer',SQLSTATE='42501',SQLSTATE); END;
END $$;
RESET ROLE;
CREATE TEMP TABLE race AS SELECT platform,id,verify_code FROM public.creator_handles WHERE creator_account_id='44029000-0000-4000-8000-0000000000c1' AND platform IN ('youtube','snapchat','instagram');
GRANT SELECT ON race TO PUBLIC;
-- The edge has read each row (id, code). Now the admin acts.
SELECT pg_temp.act('44029000-0000-4000-8000-0000000000a1');
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  PERFORM public.admin_creator_handle_decide((SELECT id FROM race WHERE platform='youtube'),'reject','Not their account');
  PERFORM public.admin_creator_handle_decide((SELECT id FROM race WHERE platform='snapchat'),'approve','Saw the code','10k_50k');
END $$;
RESET ROLE;
-- The in-flight check finishes (service role path), with the code it read.
DO $$ DECLARE v jsonb; BEGIN
  v:=public.issue_4402_record_handle_check((SELECT id FROM race WHERE platform='youtube'),'44029000-0000-4000-8000-0000000000c1',(SELECT verify_code FROM race WHERE platform='youtube'),'code_seen','code_seen');
  INSERT INTO r VALUES('T5a in-flight check after reject writes nothing', v->>'saved'='false' AND v->>'last_check_status'='rejected', v::text);
  INSERT INTO r SELECT 'T5a rejection still on the row', last_check_status='rejected' AND NOT review_required AND rejected_note='Not their account', to_jsonb(h)::text FROM public.creator_handles h WHERE id=(SELECT id FROM race WHERE platform='youtube');
  v:=public.issue_4402_record_handle_check((SELECT id FROM race WHERE platform='snapchat'),'44029000-0000-4000-8000-0000000000c1',(SELECT verify_code FROM race WHERE platform='snapchat'),'code_not_seen','verification_code_not_found');
  INSERT INTO r VALUES('T5c in-flight check after approve writes nothing', v->>'saved'='false' AND (v->>'verified')::boolean AND v->>'follower_source'='admin', v::text);
  INSERT INTO r SELECT 'T5c approval still on the row', verified_at IS NOT NULL AND NOT review_required AND follower_source='admin' AND follower_band='10k_50k', to_jsonb(h)::text FROM public.creator_handles h WHERE id=(SELECT id FROM race WHERE platform='snapchat');
  -- A check for a code that has since been replaced writes nothing.
  v:=public.issue_4402_record_handle_check((SELECT id FROM race WHERE platform='instagram'),'44029000-0000-4000-8000-0000000000c1','MINGLA-OLD0','code_seen','code_seen');
  INSERT INTO r VALUES('T5d evidence for an old code is not written', v->>'saved'='false', v::text);
  -- The normal path still saves evidence and keeps the handle with a person.
  v:=public.issue_4402_record_handle_check((SELECT id FROM race WHERE platform='instagram'),'44029000-0000-4000-8000-0000000000c1',(SELECT verify_code FROM race WHERE platform='instagram'),'code_seen','code_seen');
  INSERT INTO r SELECT 'T5e a pending handle saves evidence', v->>'saved'='true' AND last_check_status='code_seen' AND review_required AND verified_at IS NULL, v::text FROM public.creator_handles WHERE id=(SELECT id FROM race WHERE platform='instagram');
  -- Wrong owner: not found, nothing written.
  v:=public.issue_4402_record_handle_check((SELECT id FROM race WHERE platform='instagram'),'44029000-0000-4000-8000-0000000000a1',(SELECT verify_code FROM race WHERE platform='instagram'),'unreadable','provider_unreadable');
  INSERT INTO r VALUES('T5g another creator''s handle is not written', v->>'found'='false', v::text);
END $$;
-- R5b: the creator still cannot take a new code on the rejected platform.
SELECT pg_temp.act('44029000-0000-4000-8000-0000000000c1');
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN PERFORM public.creator_handle_upsert('youtube','someone.else','1k_10k'); INSERT INTO r VALUES('T5b rejected platform still refuses a new code',false,'ran');
  EXCEPTION WHEN others THEN INSERT INTO r VALUES('T5b rejected platform still refuses a new code',SQLERRM='handle_rejected',SQLERRM); END;
END $$;
RESET ROLE;

SELECT CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END, name, left(detail,220) FROM r ORDER BY name;
DO $$ DECLARE v_failed text; BEGIN
  SELECT string_agg(name||' => '||left(coalesce(detail,''),160),E'\n' ORDER BY name) INTO v_failed FROM r WHERE ok IS NOT TRUE;
  IF v_failed IS NOT NULL THEN RAISE EXCEPTION E'4402 tester suite failed:\n%',v_failed; END IF;
  IF (SELECT count(*) FROM r)<30 THEN RAISE EXCEPTION '4402 tester suite ran only % checks',(SELECT count(*) FROM r); END IF;
END $$;
SELECT '4402 tester creator review: all assertions passed' AS result;
ROLLBACK;
