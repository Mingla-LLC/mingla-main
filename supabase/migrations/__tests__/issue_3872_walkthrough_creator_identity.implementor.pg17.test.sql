-- #3872 walkthrough (W1 server): creator verification states, the agreement
-- step taking date of birth (18+), setup checks and the admin creator queue.
\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.act(p_user uuid) RETURNS void LANGUAGE sql AS $fn$
  SELECT set_config('request.jwt.claim.sub',coalesce(p_user::text,''),true),
         set_config('request.jwt.claims',CASE WHEN p_user IS NULL THEN '' ELSE json_build_object('sub',p_user,'role','authenticated')::text END,true);
$fn$;

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users(id,email) VALUES
  ('38723100-0000-4000-8000-0000000000a1','w1id-creator@mingla.test'),
  ('38723100-0000-4000-8000-0000000000a2','w1id-admin@mingla.test'),
  ('38723100-0000-4000-8000-0000000000a3','w1id-nobody@mingla.test');
INSERT INTO public.creator_accounts(id,email,display_name) VALUES
  ('38723100-0000-4000-8000-0000000000a1','w1id-creator@mingla.test','Ada Films');
INSERT INTO public.admin_users(email,status) VALUES('w1id-admin@mingla.test','active');
SET LOCAL session_replication_role = origin;

DO $test$
DECLARE
  v_creator constant uuid:='38723100-0000-4000-8000-0000000000a1';
  v_admin constant uuid:='38723100-0000-4000-8000-0000000000a2';
  v_nobody constant uuid:='38723100-0000-4000-8000-0000000000a3';
  v_r jsonb; v_failed boolean;
BEGIN
  IF to_regprocedure('public.creator_agreement_sign(text)') IS NOT NULL THEN
    RAISE EXCEPTION 'agreement must take a date of birth';
  END IF;
  PERFORM pg_temp.act(v_creator);
  -- DOB may be unknown until the agreement step.
  PERFORM public.creator_profile_save('Ada Films',NULL,NULL,ARRAY['food','nightlife'],ARRAY['English'],NULL,false);
  v_r:=public.creator_setup_status();
  IF v_r->>'verification'<>'incomplete' THEN RAISE EXCEPTION 'new creator verification: %',v_r; END IF;
  IF (SELECT array_agg(c->>'key' ORDER BY ord) FROM jsonb_array_elements(v_r->'checks') WITH ORDINALITY AS t(c,ord))
     <>ARRAY['profile','rates','showcase','socials','payout','agreement'] THEN
    RAISE EXCEPTION 'checks order/keys: %',v_r->'checks';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_r->'checks') c WHERE c->>'label' ~ '_' OR NOT (c ? 'done')) THEN
    RAISE EXCEPTION 'checks need human labels and done flags';
  END IF;
  IF (v_r->'checks'->0->>'done')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'profile check not done'; END IF;

  -- 18+ is enforced at the agreement, as {ok:false} on the date field.
  v_r:=public.creator_agreement_sign('creator-v1',(current_date-interval '17 years')::date);
  IF v_r->>'error' IS DISTINCT FROM 'must_be_18' OR v_r->>'field'<>'date_of_birth' THEN RAISE EXCEPTION 'under-18 agreement: %',v_r; END IF;
  v_r:=public.creator_agreement_sign('creator-v1',NULL);
  IF v_r->>'error' IS DISTINCT FROM 'date_of_birth_required' THEN RAISE EXCEPTION 'missing DOB agreement: %',v_r; END IF;
  v_r:=public.creator_agreement_sign('creator-v1',DATE '1994-05-02');
  IF (v_r->>'ok')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'agreement sign: %',v_r; END IF;
  -- A later profile edit with no DOB keeps the signed date.
  PERFORM public.creator_profile_save('Ada Films',NULL,NULL,ARRAY['food'],ARRAY['English'],NULL,false);
  IF (SELECT date_of_birth FROM public.creator_profiles WHERE creator_account_id=v_creator)<>DATE '1994-05-02' THEN
    RAISE EXCEPTION 'profile save erased the DOB';
  END IF;
  IF (public.creator_setup_status()->'checks'->5->>'done')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'agreement check not done'; END IF;

  -- Only admins decide.
  PERFORM pg_temp.act(v_nobody);
  v_failed:=false;
  BEGIN PERFORM public.admin_creator_decide(v_creator,'decline','No');
  EXCEPTION WHEN others THEN v_failed:=SQLERRM='admin_only'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'non-admin decided a creator'; END IF;

  PERFORM pg_temp.act(v_admin);
  v_r:=public.admin_creator_decide(v_creator,'ask_more',NULL);
  IF v_r->>'error' IS DISTINCT FROM 'note_required' THEN RAISE EXCEPTION 'ask_more without note: %',v_r; END IF;
  v_r:=public.admin_creator_decide(v_creator,'ask_more','Please add a showcase video filmed at a venue.');
  IF v_r->>'verification'<>'needs_more' THEN RAISE EXCEPTION 'ask_more: %',v_r; END IF;
  SELECT jsonb_agg(e) INTO v_r FROM jsonb_array_elements(public.admin_creator_queue('needs_person')) e WHERE e->>'creator_id'=v_creator::text;
  IF jsonb_array_length(coalesce(v_r,'[]'))<>1 OR jsonb_array_length(v_r->0->'history')<>1 OR v_r->0->'history'->0->>'action'<>'ask_more'
     OR v_r->0->>'review_note' IS NULL THEN
    RAISE EXCEPTION 'needs_person queue: %',v_r;
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(public.admin_creator_queue('setting_up')) e WHERE e->>'creator_id'=v_creator::text) THEN RAISE EXCEPTION 'setting_up should be empty'; END IF;

  PERFORM pg_temp.act(v_creator);
  v_r:=public.creator_setup_status();
  IF v_r->>'verification'<>'needs_more' OR v_r->>'review_note' IS DISTINCT FROM 'Please add a showcase video filmed at a venue.' THEN
    RAISE EXCEPTION 'creator does not see what was asked: %',v_r;
  END IF;
  -- Still missing things: stays asked-for-more on the creator's next save.
  PERFORM public.creator_profile_save('Ada Films',NULL,NULL,ARRAY['food'],ARRAY['English'],NULL,false);
  IF public.creator_setup_status()->>'verification'<>'needs_more' THEN RAISE EXCEPTION 'needs_more lost on save'; END IF;

  PERFORM pg_temp.act(v_admin);
  PERFORM public.admin_creator_decide(v_creator,'decline','Showcase does not meet the content policy.');
  PERFORM pg_temp.act(v_creator);
  v_r:=public.creator_setup_status();
  IF v_r->>'verification'<>'declined' OR v_r->>'declined_reason' IS NULL OR v_r->>'review_note' IS NOT NULL THEN
    RAISE EXCEPTION 'declined state: %',v_r;
  END IF;
  -- Declined sticks through the creator's own saves.
  PERFORM public.creator_profile_save('Ada Films',NULL,NULL,ARRAY['food'],ARRAY['English'],NULL,false);
  IF public.creator_setup_status()->>'verification'<>'declined' THEN RAISE EXCEPTION 'declined not sticky'; END IF;

  PERFORM pg_temp.act(v_admin);
  v_r:=public.admin_creator_decide(v_creator,'verify',NULL);
  -- Verify hands back to the automatic checks (payout, showcase... missing).
  IF v_r->>'verification'<>'incomplete' THEN RAISE EXCEPTION 'verify with missing checks: %',v_r; END IF;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.admin_creator_queue('setting_up')) e WHERE e->>'creator_id'=v_creator::text)
     OR (SELECT jsonb_array_length(e->'history') FROM jsonb_array_elements(public.admin_creator_queue('all')) e WHERE e->>'creator_id'=v_creator::text)<>3 THEN
    RAISE EXCEPTION 'history / setting_up after verify';
  END IF;

  IF has_function_privilege('anon','public.admin_creator_queue(text)','execute')
     OR NOT has_function_privilege('authenticated','public.creator_agreement_sign(text,date)','execute')
     OR has_table_privilege('authenticated','public.creator_review_events','select') THEN
    RAISE EXCEPTION 'creator identity grants drifted';
  END IF;
END;
$test$;

ROLLBACK;
