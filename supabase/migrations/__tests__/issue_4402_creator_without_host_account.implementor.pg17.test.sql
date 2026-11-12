-- #4402 — an Explorer who never opened the Host app can become a Creator.
--
-- Invariant I-4402-CREATOR-IDENTITY-IS-LOGIN (enforced here): creator program
-- rows are keyed to auth.users, never to creator_accounts. A person with a live
-- Explorer account (profiles row, explorer_deleted_at IS NULL) can save a
-- creator profile, home city, handle, rate and agreement without any Host
-- account; creator_profiles and creator_agreement_acceptances reference
-- auth.users; saving creator data never creates a creator_accounts row, so
-- Admin never classifies an Explorer creator as a Host.
--
-- Fails on origin/main @ 811c033211: creator_profile_save raised
-- creator_account_required for every person without a Host account.
\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.act(p_user uuid) RETURNS void LANGUAGE sql AS $fn$
  SELECT set_config('request.jwt.claim.sub',coalesce(p_user::text,''),true),
         set_config('request.jwt.claims',CASE WHEN p_user IS NULL THEN '' ELSE json_build_object('sub',p_user,'role','authenticated')::text END,true);
$fn$;

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users(id,email) VALUES
  ('44020000-0000-4000-8000-0000000000a1','i4402-explorer-creator@mingla.test'),
  ('44020000-0000-4000-8000-0000000000a2','i4402-deleted-explorer@mingla.test'),
  ('44020000-0000-4000-8000-0000000000a3','i4402-former-host@mingla.test'),
  ('44020000-0000-4000-8000-0000000000a4','i4402-plain-explorer@mingla.test');
INSERT INTO public.profiles(id,explorer_deleted_at) VALUES
  ('44020000-0000-4000-8000-0000000000a1',NULL),
  ('44020000-0000-4000-8000-0000000000a2',now()),
  ('44020000-0000-4000-8000-0000000000a3',NULL),
  ('44020000-0000-4000-8000-0000000000a4',NULL);
-- Only the former Host has a Host account, and it is deleted.
INSERT INTO public.creator_accounts(id,email,display_name,deleted_at) VALUES
  ('44020000-0000-4000-8000-0000000000a3','i4402-former-host@mingla.test','Former Host',now());
INSERT INTO public.seeding_cities(id,google_place_id,name,country,country_code,center_lat,center_lng,bbox_sw_lat,bbox_sw_lng,bbox_ne_lat,bbox_ne_lng,is_live_for_consumers) VALUES
  ('44020000-0000-4000-8000-0000000000c1','i4402-live','Lagos Test','Nigeria','NG',6.5,3.4,6.4,3.3,6.6,3.5,true);
SET LOCAL session_replication_role = origin;

DO $test$
DECLARE
  v_creator constant uuid:='44020000-0000-4000-8000-0000000000a1';
  v_deleted constant uuid:='44020000-0000-4000-8000-0000000000a2';
  v_former_host constant uuid:='44020000-0000-4000-8000-0000000000a3';
  v_plain constant uuid:='44020000-0000-4000-8000-0000000000a4';
  v_city constant uuid:='44020000-0000-4000-8000-0000000000c1';
  v_r jsonb; v_code text; v_segment text;
BEGIN
  -- 6. Catalog: both foreign keys reference the login, same delete actions.
  IF (SELECT confrelid FROM pg_constraint WHERE conname='creator_profiles_creator_account_id_fkey'
        AND conrelid='public.creator_profiles'::regclass) IS DISTINCT FROM 'auth.users'::regclass
     OR (SELECT confdeltype FROM pg_constraint WHERE conname='creator_profiles_creator_account_id_fkey') IS DISTINCT FROM 'c' THEN
    RAISE EXCEPTION '4402.6 creator_profiles must reference auth.users ON DELETE CASCADE';
  END IF;
  IF (SELECT confrelid FROM pg_constraint WHERE conname='creator_agreement_acceptances_creator_account_id_fkey'
        AND conrelid='public.creator_agreement_acceptances'::regclass) IS DISTINCT FROM 'auth.users'::regclass
     OR (SELECT confdeltype FROM pg_constraint WHERE conname='creator_agreement_acceptances_creator_account_id_fkey') IS DISTINCT FROM 'r' THEN
    RAISE EXCEPTION '4402.6 creator_agreement_acceptances must reference auth.users ON DELETE RESTRICT';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_constraint
            WHERE confrelid='public.creator_accounts'::regclass
              AND conrelid IN ('public.creator_profiles'::regclass,'public.creator_agreement_acceptances'::regclass)) THEN
    RAISE EXCEPTION '4402.6 a creator program table still references creator_accounts';
  END IF;

  -- Grants unchanged: signed-in callers only.
  IF has_function_privilege('anon','public.creator_profile_save(text,text,uuid,text[],text[],date,boolean)','execute')
     OR NOT has_function_privilege('authenticated','public.creator_profile_save(text,text,uuid,text[],text[],date,boolean)','execute')
     OR has_function_privilege('anon','public.creator_home_city_set(uuid,text,text)','execute')
     OR NOT has_function_privilege('authenticated','public.creator_home_city_set(uuid,text,text)','execute')
     OR has_function_privilege('anon','public.creator_package_upsert(text,text[],bigint,text,integer,integer,bigint,boolean)','execute')
     OR NOT has_function_privilege('authenticated','public.creator_package_upsert(text,text[],bigint,text,integer,integer,bigint,boolean)','execute')
     OR has_function_privilege('authenticated','public.issue_4187_program_target_exists(text,uuid)','execute')
     OR NOT has_function_privilege('service_role','public.issue_4187_program_target_exists(text,uuid)','execute') THEN
    RAISE EXCEPTION '4402 grants drifted';
  END IF;

  -- 7 (before). A plain Explorer is not a creator target.
  IF public.issue_4187_program_target_exists('creator',v_plain) THEN
    RAISE EXCEPTION '4402.7 a plain Explorer was a creator target';
  END IF;

  -- 8. A rate before a profile is a named refusal, never a raw FK error.
  PERFORM pg_temp.act(v_creator);
  v_code:=NULL;
  BEGIN
    PERFORM public.creator_package_upsert('date_idea',ARRAY['instagram'],15000000,'NGN',3,90,NULL,true);
  EXCEPTION WHEN others THEN v_code:=SQLERRM; END;
  IF v_code IS DISTINCT FROM 'creator_profile_required' THEN
    RAISE EXCEPTION '4402.8 rate before profile: expected creator_profile_required, got %',v_code;
  END IF;

  -- 1. An Explorer with no Host account completes every creator write.
  v_r:=public.creator_profile_save('Ada Films','Lagos food and nights',v_city,ARRAY['food'],ARRAY['English'],NULL,true);
  IF (v_r->>'ok')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION '4402.1 profile save: %',v_r; END IF;
  v_r:=public.creator_home_city_set(v_city,NULL,NULL);
  IF (v_r->>'ok')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION '4402.1 home city: %',v_r; END IF;
  v_r:=public.creator_handle_upsert('instagram','ada.films.4402',NULL);
  IF v_r->>'id' IS NULL OR v_r->>'verify_code' IS NULL THEN RAISE EXCEPTION '4402.1 handle: %',v_r; END IF;
  v_r:=public.creator_package_upsert('date_idea',ARRAY['instagram'],15000000,'NGN',3,90,NULL,true);
  IF v_r->>'id' IS NULL OR v_r ? 'creator_account_id' THEN RAISE EXCEPTION '4402.1 package: %',v_r; END IF;
  v_r:=public.creator_agreement_sign(DATE '1995-06-01');
  IF (v_r->>'ok')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION '4402.1 agreement: %',v_r; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.creator_agreement_acceptances WHERE creator_account_id=v_creator) THEN
    RAISE EXCEPTION '4402.1 no agreement acceptance row';
  END IF;
  IF (SELECT agreement_acceptance_id FROM public.creator_profiles WHERE creator_account_id=v_creator) IS NULL THEN
    RAISE EXCEPTION '4402.1 profile not linked to the acceptance';
  END IF;

  -- 2. Still no Host account, and Admin does not call them a Host.
  IF EXISTS(SELECT 1 FROM public.creator_accounts WHERE id=v_creator) THEN
    RAISE EXCEPTION '4402.2 a creator_accounts row was created for an Explorer creator';
  END IF;
  SELECT c.segment INTO v_segment FROM public.admin_people_classified() c WHERE c.user_id=v_creator;
  IF v_segment IN ('host','both') THEN
    RAISE EXCEPTION '4402.2 Admin classified an Explorer creator as %',v_segment;
  END IF;

  -- 7 (after). A creator with no Host account can be messaged as a creator.
  IF NOT public.issue_4187_program_target_exists('creator',v_creator) THEN
    RAISE EXCEPTION '4402.7 an Explorer creator was not a creator target';
  END IF;

  -- 3. A deleted Explorer account is refused by both guarded writes.
  PERFORM pg_temp.act(v_deleted);
  v_code:=NULL;
  BEGIN PERFORM public.creator_profile_save('Gone Person',NULL,NULL,ARRAY['food'],ARRAY['English'],NULL,true);
  EXCEPTION WHEN others THEN v_code:=SQLERRM; END;
  IF v_code IS DISTINCT FROM 'creator_account_required' THEN RAISE EXCEPTION '4402.3 profile save after Explorer deletion: %',v_code; END IF;
  v_code:=NULL;
  BEGIN PERFORM public.creator_home_city_set(v_city,NULL,NULL);
  EXCEPTION WHEN others THEN v_code:=SQLERRM; END;
  IF v_code IS DISTINCT FROM 'creator_account_required' THEN RAISE EXCEPTION '4402.3 home city after Explorer deletion: %',v_code; END IF;
  IF EXISTS(SELECT 1 FROM public.creator_profiles WHERE creator_account_id=v_deleted) THEN
    RAISE EXCEPTION '4402.3 a deleted Explorer account got a creator profile';
  END IF;

  -- 4. A Host who deleted only their Host account keeps creator mode.
  PERFORM pg_temp.act(v_former_host);
  v_r:=public.creator_profile_save('Former Host',NULL,NULL,ARRAY['music'],ARRAY['English'],NULL,true);
  IF (v_r->>'ok')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION '4402.4 former Host profile save: %',v_r; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.creator_profiles WHERE creator_account_id=v_former_host AND mode_enabled) THEN
    RAISE EXCEPTION '4402.4 former Host has no creator profile';
  END IF;

  -- A live Explorer with no creator profile gets the named ok:false, not a raise.
  PERFORM pg_temp.act(v_plain);
  v_r:=public.creator_home_city_set(v_city,NULL,NULL);
  IF v_r->>'error' IS DISTINCT FROM 'creator_profile_required' OR (v_r->>'ok')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION '4402 plain Explorer home city: %',v_r;
  END IF;

  -- 5. Signed-out callers are refused before any identity check.
  PERFORM pg_temp.act(NULL);
  v_code:=NULL;
  BEGIN PERFORM public.creator_profile_save('Nobody',NULL,NULL,ARRAY['food'],ARRAY['English'],NULL,true);
  EXCEPTION WHEN others THEN v_code:=SQLERRM; END;
  IF v_code IS DISTINCT FROM 'authentication_required' THEN RAISE EXCEPTION '4402.5 anon profile save: %',v_code; END IF;
  v_code:=NULL;
  BEGIN PERFORM public.creator_home_city_set(v_city,NULL,NULL);
  EXCEPTION WHEN others THEN v_code:=SQLERRM; END;
  IF v_code IS DISTINCT FROM 'authentication_required' THEN RAISE EXCEPTION '4402.5 anon home city: %',v_code; END IF;
  v_code:=NULL;
  BEGIN PERFORM public.creator_package_upsert('date_idea',ARRAY['instagram'],100,'USD',3,90,NULL,true);
  EXCEPTION WHEN others THEN v_code:=SQLERRM; END;
  IF v_code IS DISTINCT FROM 'authentication_required' THEN RAISE EXCEPTION '4402.5 anon package: %',v_code; END IF;
END;
$test$;

-- 6 (behaviour). The signed agreement still refuses deletion of the login.
DO $restrict$
DECLARE v_blocked boolean:=false;
BEGIN
  BEGIN
    DELETE FROM auth.users WHERE id='44020000-0000-4000-8000-0000000000a1';
  EXCEPTION WHEN foreign_key_violation THEN v_blocked:=true; END;
  IF NOT v_blocked THEN RAISE EXCEPTION '4402.6 deleting a login with a signed agreement was not refused'; END IF;
END;
$restrict$;

SELECT '4402 creator without Host account: all assertions passed' AS result;
ROLLBACK;
