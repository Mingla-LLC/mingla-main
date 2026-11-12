-- #4402 — Admin creator review and honest social-handle proof.
--
-- MINGLA-INVARIANT: I-4402-CREATOR-VERIFY-NEEDS-SIX-STEPS | issue #4402 | admin_creator_decide('verify') writes nothing unless all six setup checks pass and no handle is under review, and it never approves a flagged handle as a side effect.
-- MINGLA-INVARIANT: I-4402-HANDLE-DECISION-IS-AUDITED | issue #4402 | A social handle is approved, rejected or reopened only through admin_creator_handle_decide, admin-gated, and every decision writes a creator_review_events row naming the handle and platform.
-- MINGLA-INVARIANT: I-4402-ONLY-ADMIN-VERIFIES | issue #4402 | Only admin_creator_handle_decide('approve') verifies a handle (with the band the admin saw) and only admin_creator_decide('verify') verifies a creator; every added handle waits for an admin, a recompute never makes anyone verified, a rejection sticks until an admin reopens it, and Hosts see only admin-recorded audience bands (Seth, 12 Nov 2026).
--
-- Also proves: an evidence save from the bio-code check is CHECK-valid, the
-- rates step is one of the six, X is refused as a handle platform, setup
-- status carries the server outcome and the Local application handles, and
-- the Admin record read is admin-only and never returns a date of birth.
--
-- Fails on origin/main @ 7ace80fa0a: admin_creator_decide('verify') returned
-- ok:true and cleared every review_required handle; a recompute verified a
-- creator by itself; admin_creator_handle_decide and admin_creator_detail did
-- not exist.
\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.act(p_user uuid) RETURNS void LANGUAGE sql AS $fn$
  SELECT set_config('request.jwt.claim.sub',coalesce(p_user::text,''),true),
         set_config('request.jwt.claims',CASE WHEN p_user IS NULL THEN '' ELSE json_build_object('sub',p_user,'role','authenticated')::text END,true);
$fn$;

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users(id,email) VALUES
  ('44021000-0000-4000-8000-0000000000a1','i4402r-ready@mingla.test'),
  ('44021000-0000-4000-8000-0000000000a2','i4402r-review@mingla.test'),
  ('44021000-0000-4000-8000-0000000000a3','i4402r-new@mingla.test'),
  ('44021000-0000-4000-8000-0000000000a4','i4402r-admin@mingla.test'),
  ('44021000-0000-4000-8000-0000000000a5','i4402r-nobody@mingla.test');
INSERT INTO public.profiles(id,display_name) VALUES
  ('44021000-0000-4000-8000-0000000000a1','Account Ready'),
  ('44021000-0000-4000-8000-0000000000a2',NULL),
  ('44021000-0000-4000-8000-0000000000a3',NULL),
  ('44021000-0000-4000-8000-0000000000a4','Review Admin'),
  ('44021000-0000-4000-8000-0000000000a5',NULL);
INSERT INTO public.admin_users(email,status) VALUES('i4402r-admin@mingla.test','active');
INSERT INTO public.seeding_cities(id,google_place_id,name,country,country_code,center_lat,center_lng,bbox_sw_lat,bbox_sw_lng,bbox_ne_lat,bbox_ne_lng,is_live_for_consumers) VALUES
  ('44021000-0000-4000-8000-0000000000c1','i4402r-live','Lagos Review','Nigeria','NG',6.5,3.4,6.4,3.3,6.6,3.5,true);
-- Payout and a processed showcase for the two creators who finish setup.
INSERT INTO public.payee_accounts(user_id,paystack_recipient_code,paystack_status) VALUES
  ('44021000-0000-4000-8000-0000000000a1','RCP_i4402r_a1','verified'),
  ('44021000-0000-4000-8000-0000000000a2','RCP_i4402r_a2','verified');
INSERT INTO public.creator_media_jobs(client_operation_id,owner_kind,owner_id,purpose,bunny_video_id,status,duration_s,width,height,ready_at) VALUES
  (gen_random_uuid(),'creator','44021000-0000-4000-8000-0000000000a1','showcase','i4402r-video-a1','ready',12,720,1280,now()),
  (gen_random_uuid(),'creator','44021000-0000-4000-8000-0000000000a2','showcase','i4402r-video-a2','ready',12,720,1280,now());
-- The new creator applied to be a Local with two handles first.
INSERT INTO public.local_applications(user_id,city_id,handles,why) VALUES
  ('44021000-0000-4000-8000-0000000000a3','44021000-0000-4000-8000-0000000000c1',
   '{"instagram":"@Ada.Local","tiktok":"bad handle!"}','I want to show people the best of Lagos food at night.');
SET LOCAL session_replication_role = origin;

DO $test$
DECLARE
  v_ready constant uuid:='44021000-0000-4000-8000-0000000000a1';
  v_review constant uuid:='44021000-0000-4000-8000-0000000000a2';
  v_new constant uuid:='44021000-0000-4000-8000-0000000000a3';
  v_admin constant uuid:='44021000-0000-4000-8000-0000000000a4';
  v_nobody constant uuid:='44021000-0000-4000-8000-0000000000a5';
  v_city constant uuid:='44021000-0000-4000-8000-0000000000c1';
  v_r jsonb; v_code text; v_handle uuid; v_review_handle uuid; v_events integer; v_state text; v_text text;
BEGIN
  -- ── Setup: two creators who finish everything except the handle step ──
  PERFORM pg_temp.act(v_ready);
  PERFORM public.creator_profile_save('Ready Creator','Lagos after dark',v_city,ARRAY['food'],ARRAY['English'],NULL,true);
  PERFORM public.creator_agreement_sign(DATE '1995-06-01');
  v_r:=public.creator_handle_upsert('instagram','@Ready.Creator','lt1k');
  v_handle:=(v_r->>'id')::uuid;

  -- X is no longer a handle platform.
  v_code:=NULL;
  BEGIN PERFORM public.creator_handle_upsert('x','ready.creator',NULL);
  EXCEPTION WHEN others THEN v_code:=SQLERRM; END;
  IF v_code IS DISTINCT FROM 'platform_unsupported' THEN RAISE EXCEPTION '4402r.x handle platform: %',v_code; END IF;

  -- Every added handle waits for an admin.
  IF (SELECT NOT review_required OR review_reason<>'awaiting_admin' OR verified_at IS NOT NULL FROM public.creator_handles WHERE id=v_handle) THEN
    RAISE EXCEPTION '4402r.a new handle must wait for an admin: %',(SELECT to_jsonb(h) FROM public.creator_handles h WHERE id=v_handle);
  END IF;

  -- Rates: an active rate is one of the six steps (R12).
  IF NOT EXISTS(SELECT 1 FROM public.creator_profiles WHERE creator_account_id=v_ready AND 'active_package'=ANY(verification_reasons)) THEN
    RAISE EXCEPTION '4402r.rates recompute does not list active_package: %',(SELECT verification_reasons FROM public.creator_profiles WHERE creator_account_id=v_ready);
  END IF;
  v_r:=public.creator_setup_status();
  IF (SELECT count(*) FROM jsonb_array_elements_text(v_r->'missing') m WHERE m='package')<>1
     OR v_r->'missing' ? 'active_package' THEN
    RAISE EXCEPTION '4402r.rates setup status must list package exactly once: %',v_r->'missing';
  END IF;
  PERFORM public.creator_package_upsert('date_idea',ARRAY['instagram'],4000000,'NGN',3,90,NULL,true);
  IF EXISTS(SELECT 1 FROM public.creator_profiles WHERE creator_account_id=v_ready AND 'active_package'=ANY(verification_reasons)) THEN
    RAISE EXCEPTION '4402r.rates saving a rate did not recompute';
  END IF;

  -- The edge function's "code not seen" save (evidence; the handle stays flagged).
  UPDATE public.creator_handles SET last_checked_at=now(),review_required=true,review_reason='verification_code_not_found',last_check_status='code_not_seen'
   WHERE id=v_handle;
  -- The schema still refuses a reason on a handle nobody is asked to review.
  v_code:=NULL;
  BEGIN UPDATE public.creator_handles SET review_required=false WHERE id=v_handle;
  EXCEPTION WHEN check_violation THEN v_code:='23514'; END;
  IF v_code IS DISTINCT FROM '23514' THEN RAISE EXCEPTION '4402r.review_shape must stay unchanged'; END IF;

  v_r:=public.creator_setup_status();
  IF v_r->'handles'->0->>'last_check_status' IS DISTINCT FROM 'code_not_seen'
     OR NOT (v_r->'handles'->0 ? 'last_checked_at') OR NOT (v_r->'handles'->0 ? 'rejected_note')
     OR v_r->'handles'->0->>'follower_source' IS DISTINCT FROM 'self_reported' THEN
    RAISE EXCEPTION '4402r.setup status handle outcome: %',v_r->'handles';
  END IF;

  -- Second creator: everything done, but the handle is unreadable (review).
  PERFORM pg_temp.act(v_review);
  PERFORM public.creator_profile_save('Review Creator',NULL,v_city,ARRAY['music'],ARRAY['English'],NULL,true);
  PERFORM public.creator_agreement_sign(DATE '1994-01-01');
  PERFORM public.creator_package_upsert('date_idea',ARRAY['instagram'],4000000,'NGN',3,90,NULL,true);
  v_review_handle:=(public.creator_handle_upsert('instagram','review.creator','lt1k')->>'id')::uuid;
  UPDATE public.creator_handles SET last_checked_at=now(),review_required=true,review_reason='provider_unreadable',last_check_status='unreadable'
   WHERE id=v_review_handle;
  PERFORM public.issue_3872_recompute_creator_verification(v_review,true);
  IF (SELECT verification FROM public.creator_profiles WHERE creator_account_id=v_review)<>'review' THEN
    RAISE EXCEPTION '4402r.unreadable handle must put the creator in review';
  END IF;

  -- ── Admin gates ──
  PERFORM pg_temp.act(v_nobody);
  FOR v_text IN SELECT unnest(ARRAY['detail','handle','queue']) LOOP
    v_code:=NULL;
    BEGIN
      IF v_text='detail' THEN PERFORM public.admin_creator_detail(v_ready);
      ELSIF v_text='handle' THEN PERFORM public.admin_creator_handle_decide(v_handle,'approve',NULL,NULL);
      ELSE PERFORM public.admin_creator_queue('all'); END IF;
    EXCEPTION WHEN others THEN v_code:=SQLERRM; END;
    IF v_code IS DISTINCT FROM 'admin_only' THEN RAISE EXCEPTION '4402r.non-admin % was not refused: %',v_text,v_code; END IF;
  END LOOP;

  PERFORM pg_temp.act(v_admin);

  -- I-4402-CREATOR-VERIFY-NEEDS-SIX-STEPS (missing step): refused, nothing written.
  SELECT count(*) INTO v_events FROM public.creator_review_events WHERE creator_account_id=v_ready;
  SELECT verification INTO v_state FROM public.creator_profiles WHERE creator_account_id=v_ready;
  v_r:=public.admin_creator_decide(v_ready,'verify',NULL);
  IF (v_r->>'ok')::boolean IS DISTINCT FROM false OR v_r->>'error'<>'checks_incomplete' OR NOT (v_r->'missing' ? 'socials') THEN
    RAISE EXCEPTION '4402r.verify with a missing step: %',v_r;
  END IF;
  IF (SELECT count(*) FROM public.creator_review_events WHERE creator_account_id=v_ready)<>v_events
     OR (SELECT verification FROM public.creator_profiles WHERE creator_account_id=v_ready)<>v_state
     OR (SELECT reviewed_at FROM public.creator_profiles WHERE creator_account_id=v_ready) IS NOT NULL THEN
    RAISE EXCEPTION '4402r.a refused verify wrote something';
  END IF;

  -- (handle under review): refused, and the handle is NOT vouched for.
  v_r:=public.admin_creator_decide(v_review,'verify',NULL);
  IF v_r->>'error' IS DISTINCT FROM 'checks_incomplete' OR NOT (v_r->'missing' ? 'handle_review') THEN
    RAISE EXCEPTION '4402r.verify with a handle in review: %',v_r;
  END IF;
  IF NOT (SELECT review_required FROM public.creator_handles WHERE id=v_review_handle)
     OR (SELECT verified_at FROM public.creator_handles WHERE id=v_review_handle) IS NOT NULL THEN
    RAISE EXCEPTION '4402r.verify bulk-vouched a flagged handle';
  END IF;

  -- Detail: shape, gate and privacy.
  v_r:=public.admin_creator_detail(v_review);
  IF (v_r->>'ok')::boolean IS DISTINCT FROM true OR (v_r->>'can_verify')::boolean IS DISTINCT FROM false
     OR v_r->'needs_person'->0->>'platform' IS DISTINCT FROM 'instagram'
     OR v_r->'handles'->0->>'review_reason' IS DISTINCT FROM 'provider_unreadable'
     OR v_r->'handles'->0->>'self_reported_band' IS DISTINCT FROM 'lt1k'
     OR jsonb_array_length(v_r->'checks')<>6
     OR v_r->'showcase'->0->>'status' IS DISTINCT FROM 'ready'
     OR (v_r->'showcase'->0->>'duration_s')::numeric<>12
     OR v_r->'packages'->0->>'currency' IS DISTINCT FROM 'NGN'
     OR v_r->'payout'->>'status' IS DISTINCT FROM 'verified'
     OR (v_r->'agreement'->>'signed')::boolean IS DISTINCT FROM true
     OR (v_r->'about'->>'age_18_plus')::boolean IS DISTINCT FROM true
     OR v_r->'person'->>'email_masked' IS DISTINCT FROM 'i***@mingla.test'
     OR v_r->'local'->>'status' IS DISTINCT FROM 'none'
     OR (v_r->'gigs'->>'contracts_total')::integer<>0
     OR NOT (v_r ? 'history') THEN
    RAISE EXCEPTION '4402r.detail shape: %',v_r;
  END IF;
  IF v_r::text ~ 'date_of_birth"\s*:\s*"' OR v_r::text LIKE '%1994-01-01%' OR v_r::text LIKE '%i4402r-review@%' THEN
    RAISE EXCEPTION '4402r.detail leaked the date of birth or the full email';
  END IF;
  IF public.admin_creator_detail('44021000-0000-4000-8000-0000000000ff')->>'error' IS DISTINCT FROM 'creator_not_found' THEN
    RAISE EXCEPTION '4402r.detail for an unknown creator';
  END IF;
  -- One name: the record carries the creator name and the account name apart.
  v_r:=public.admin_creator_detail(v_ready);
  IF v_r->>'display_name'<>'Ready Creator' OR v_r->>'account_name'<>'Account Ready' THEN
    RAISE EXCEPTION '4402r.detail names: %',v_r;
  END IF;

  -- ── I-4402-HANDLE-DECISION-IS-AUDITED ──
  v_code:=NULL;
  BEGIN PERFORM public.admin_creator_handle_decide(v_handle,'maybe',NULL,NULL);
  EXCEPTION WHEN invalid_parameter_value THEN v_code:='22023'; END;
  IF v_code IS DISTINCT FROM '22023' THEN RAISE EXCEPTION '4402r.bad handle decision not refused'; END IF;
  IF public.admin_creator_handle_decide('44021000-0000-4000-8000-0000000000ff','approve',NULL,NULL)->>'error' IS DISTINCT FROM 'handle_not_found' THEN
    RAISE EXCEPTION '4402r.unknown handle';
  END IF;
  SELECT count(*) INTO v_events FROM public.creator_review_events WHERE creator_account_id=v_ready;
  v_r:=public.admin_creator_handle_decide(v_handle,'reject','   ',NULL);
  IF v_r->>'error' IS DISTINCT FROM 'note_required' OR v_r->>'field'<>'note'
     OR (SELECT count(*) FROM public.creator_review_events WHERE creator_account_id=v_ready)<>v_events
     OR (SELECT last_check_status FROM public.creator_handles WHERE id=v_handle)<>'code_not_seen' THEN
    RAISE EXCEPTION '4402r.reject without a note: %',v_r;
  END IF;
  IF public.admin_creator_handle_decide(v_handle,'approve',NULL,'huge')->>'error' IS DISTINCT FROM 'invalid_band' THEN
    RAISE EXCEPTION '4402r.approve with a bad band';
  END IF;
  -- The audience band comes only from the admin: approving needs one.
  IF public.admin_creator_handle_decide(v_handle,'approve','Saw the code',NULL)->>'error' IS DISTINCT FROM 'band_required' THEN
    RAISE EXCEPTION '4402r.approve without a band';
  END IF;
  IF public.admin_creator_handle_decide(v_handle,'reopen',NULL,NULL)->>'error' IS DISTINCT FROM 'not_rejected' THEN
    RAISE EXCEPTION '4402r.reopen of a handle that is not rejected';
  END IF;
  v_r:=public.admin_creator_handle_decide(v_handle,'reject','Not their account',NULL);
  IF (v_r->>'ok')::boolean IS DISTINCT FROM true OR v_r->'handle'->>'last_check_status'<>'rejected' THEN
    RAISE EXCEPTION '4402r.reject: %',v_r;
  END IF;
  IF (SELECT verified_at IS NOT NULL OR review_required OR rejected_note<>'Not their account' FROM public.creator_handles WHERE id=v_handle)
     OR NOT EXISTS(SELECT 1 FROM public.creator_review_events WHERE creator_account_id=v_ready AND action='handle_reject'
                    AND handle_id=v_handle AND platform='instagram' AND note='Not their account' AND actor=v_admin) THEN
    RAISE EXCEPTION '4402r.reject was not written or audited';
  END IF;
  -- The creator sees the rejection on reload, and it sticks: a new code (or a
  -- different handle on the same platform) is refused until an admin reopens.
  PERFORM pg_temp.act(v_ready);
  v_r:=public.creator_setup_status();
  IF v_r->'handles'->0->>'last_check_status'<>'rejected' OR v_r->'handles'->0->>'rejected_note'<>'Not their account' THEN
    RAISE EXCEPTION '4402r.creator does not see the rejection: %',v_r->'handles';
  END IF;
  FOREACH v_text IN ARRAY ARRAY['ready.creator','someone.else'] LOOP
    v_code:=NULL;
    BEGIN PERFORM public.creator_handle_upsert('instagram',v_text,'lt1k');
    EXCEPTION WHEN others THEN v_code:=SQLERRM; END;
    IF v_code IS DISTINCT FROM 'handle_rejected' THEN RAISE EXCEPTION '4402r.a rejected handle took a new code (%): %',v_text,v_code; END IF;
  END LOOP;
  IF (SELECT last_check_status<>'rejected' OR rejected_note<>'Not their account' OR handle<>'ready.creator' FROM public.creator_handles WHERE id=v_handle) THEN
    RAISE EXCEPTION '4402r.the rejection did not stick';
  END IF;
  -- An admin reopens it: back in review, audited; then the creator may get a new code.
  PERFORM pg_temp.act(v_admin);
  v_r:=public.admin_creator_handle_decide(v_handle,'reopen',NULL,NULL);
  IF (v_r->>'ok')::boolean IS DISTINCT FROM true
     OR (SELECT NOT review_required OR review_reason<>'awaiting_admin' OR last_check_status IS NOT NULL OR rejected_note IS NOT NULL
           FROM public.creator_handles WHERE id=v_handle)
     OR NOT EXISTS(SELECT 1 FROM public.creator_review_events WHERE creator_account_id=v_ready AND action='handle_reopen' AND handle_id=v_handle AND platform='instagram') THEN
    RAISE EXCEPTION '4402r.reopen: %',v_r;
  END IF;
  PERFORM pg_temp.act(v_ready);
  PERFORM public.creator_handle_upsert('instagram','ready.creator','lt1k');
  IF (SELECT NOT review_required OR last_check_status IS NOT NULL FROM public.creator_handles WHERE id=v_handle) THEN
    RAISE EXCEPTION '4402r.a new code after reopen must wait for an admin';
  END IF;

  -- Approve with the band the admin saw: the handle passes and the creator's
  -- own band is kept. All six steps now pass, but the creator is only READY
  -- for review: no recompute makes anyone verified.
  PERFORM pg_temp.act(v_admin);
  v_r:=public.admin_creator_handle_decide(v_review_handle,'approve','Saw MINGLA code in bio','1k_10k');
  IF (v_r->>'ok')::boolean IS DISTINCT FROM true OR v_r->>'verification'<>'review' OR jsonb_array_length(v_r->'missing')<>0 THEN
    RAISE EXCEPTION '4402r.approve (must be ready for review, not verified): %',v_r;
  END IF;
  IF (public.issue_3872_recompute_creator_verification(v_review,false))->>'verification'<>'review' THEN
    RAISE EXCEPTION '4402r.a recompute verified a creator by itself';
  END IF;
  PERFORM pg_temp.act(v_review);
  PERFORM public.creator_package_upsert('date_idea',ARRAY['instagram'],4500000,'NGN',3,90,NULL,true);
  IF (SELECT verification FROM public.creator_profiles WHERE creator_account_id=v_review)<>'review' THEN
    RAISE EXCEPTION '4402r.saving a rate verified a creator by itself';
  END IF;
  PERFORM pg_temp.act(v_admin);
  IF (SELECT verified_at IS NULL OR review_required OR review_reason IS NOT NULL OR last_check_status<>'verified'
             OR follower_band<>'1k_10k' OR follower_source<>'admin' OR self_reported_band<>'lt1k'
        FROM public.creator_handles WHERE id=v_review_handle)
     OR NOT EXISTS(SELECT 1 FROM public.creator_review_events WHERE creator_account_id=v_review AND action='handle_approve'
                    AND handle_id=v_review_handle AND platform='instagram' AND follower_band='1k_10k') THEN
    RAISE EXCEPTION '4402r.approve was not written or audited';
  END IF;
  IF (SELECT h->>'actor_name' FROM jsonb_array_elements(public.admin_creator_detail(v_review)->'history') h WHERE h->>'action'='handle_approve')<>'Review Admin' THEN
    RAISE EXCEPTION '4402r.history actor name';
  END IF;

  -- With all six steps the gate opens: Verify is the admin's, and the only path.
  v_r:=public.admin_creator_decide(v_review,'verify',NULL);
  IF (v_r->>'ok')::boolean IS DISTINCT FROM true OR v_r->>'verification'<>'verified' THEN
    RAISE EXCEPTION '4402r.verify at six of six: %',v_r;
  END IF;
  -- A verified creator stays verified through a recompute while six still pass,
  -- and a new handle waiting for an admin does not take them out of view.
  PERFORM pg_temp.act(v_review);
  PERFORM public.creator_handle_upsert('tiktok','review.creator','1k_10k');
  IF (SELECT verification FROM public.creator_profiles WHERE creator_account_id=v_review)<>'verified' THEN
    RAISE EXCEPTION '4402r.a verified creator dropped on a recompute with six of six';
  END IF;
  PERFORM pg_temp.act(v_admin);
  PERFORM public.admin_creator_handle_decide((SELECT id FROM public.creator_handles WHERE creator_account_id=v_review AND platform='tiktok'),'reject','Not their account',NULL);
  -- Suspend, then lift it with Verify.
  v_r:=public.admin_creator_decide(v_review,'suspend','Checking a report');
  IF v_r->>'verification'<>'suspended' THEN RAISE EXCEPTION '4402r.suspend: %',v_r; END IF;
  IF (public.admin_creator_detail(v_review)->>'can_verify')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION '4402r.can_verify should be true at six of six';
  END IF;
  v_r:=public.admin_creator_decide(v_review,'verify',NULL);
  IF (v_r->>'ok')::boolean IS DISTINCT FROM true OR v_r->>'verification'<>'verified' THEN
    RAISE EXCEPTION '4402r.verify at six of six: %',v_r;
  END IF;

  -- Board: card handle and can_verify.
  SELECT e INTO v_r FROM jsonb_array_elements(public.admin_creator_queue('all')) e WHERE e->>'creator_id'=v_review::text;
  IF v_r->'handle'->>'handle'<>'review.creator' OR (v_r->>'can_verify')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION '4402r.queue card: %',v_r;
  END IF;

  -- Hosts see only the band an admin recorded.
  IF pg_get_functiondef('public.prehire_creator_profile(uuid)'::regprocedure) NOT LIKE '%h.follower_source=''admin''%' THEN
    RAISE EXCEPTION '4402r.prehire_creator_profile lists bands no admin recorded';
  END IF;

  -- ── Widened audit table ──
  v_code:=NULL;
  BEGIN
    INSERT INTO public.creator_review_events(creator_account_id,action) VALUES(v_ready,'handle_approve');
  EXCEPTION WHEN check_violation THEN v_code:='23514'; END;
  IF v_code IS DISTINCT FROM '23514' THEN RAISE EXCEPTION '4402r.a handle event without a handle was accepted'; END IF;

  -- ── Suggested handles from the Local application (C18) ──
  PERFORM pg_temp.act(v_new);
  v_r:=public.creator_setup_status();
  IF v_r->'suggested_handles' IS DISTINCT FROM '{"instagram":"ada.local"}'::jsonb THEN
    RAISE EXCEPTION '4402r.suggested handles before a profile: %',v_r->'suggested_handles';
  END IF;
  PERFORM public.creator_profile_save('Ada Local',NULL,v_city,ARRAY['food'],ARRAY['English'],NULL,true);
  PERFORM public.creator_handle_upsert('instagram','ada.local',NULL);
  v_r:=public.creator_setup_status();
  IF v_r->'suggested_handles' IS DISTINCT FROM '{}'::jsonb THEN
    RAISE EXCEPTION '4402r.a platform with a handle row must not be suggested: %',v_r->'suggested_handles';
  END IF;

  -- ── Grants ──
  IF has_function_privilege('anon','public.admin_creator_detail(uuid)','execute')
     OR NOT has_function_privilege('authenticated','public.admin_creator_detail(uuid)','execute')
     OR has_function_privilege('anon','public.admin_creator_handle_decide(uuid,text,text,text)','execute')
     OR NOT has_function_privilege('authenticated','public.admin_creator_handle_decide(uuid,text,text,text)','execute')
     OR has_function_privilege('authenticated','public.issue_4402_creator_verify_blockers(uuid)','execute')
     OR has_function_privilege('authenticated','public.issue_4402_suggested_handles(uuid)','execute')
     OR has_function_privilege('authenticated','public.issue_3872_recompute_creator_verification(uuid,boolean)','execute')
     OR has_function_privilege('anon','public.creator_setup_status()','execute')
     OR has_table_privilege('authenticated','public.creator_review_events','select') THEN
    RAISE EXCEPTION '4402r grants drifted';
  END IF;
END;
$test$;

SELECT '4402 creator review and handle proof: all assertions passed' AS result;
ROLLBACK;
