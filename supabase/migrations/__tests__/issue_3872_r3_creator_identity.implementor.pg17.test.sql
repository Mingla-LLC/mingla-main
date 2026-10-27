-- MINGLA-INVARIANT: I-3872-CREATOR-VERIFICATION | issue #3872 | A creator is verified only when age, a verified public handle, a ready payout rail, a processed showcase and an approved agreement are all present; issue_3872_recompute_creator_verification and its tests are the enforcement authority.
-- MINGLA-INVARIANT: I-3872-CREATOR-PRIVACY | issue #3872 | Public creator discovery returns only the explicit public_creator_profile allow-list; raw identity, DOB and payout tables remain closed to anon.
\set ON_ERROR_STOP on

BEGIN;

DO $test$
DECLARE
  v_tables integer;
  v_public jsonb;
BEGIN
  SELECT count(*) INTO v_tables FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relname IN ('creator_profiles','creator_handles','creator_packages') AND c.relkind='r';
  IF v_tables<>3 THEN RAISE EXCEPTION 'creator identity tables missing'; END IF;

  IF has_table_privilege('anon','public.creator_profiles','select')
     OR has_table_privilege('anon','public.creator_handles','select')
     OR has_table_privilege('anon','public.creator_packages','select') THEN
    RAISE EXCEPTION 'raw creator identity leaked to anon';
  END IF;
  IF NOT has_function_privilege('anon','public.public_creator_profile(uuid)','execute') THEN
    RAISE EXCEPTION 'public profile allow-list RPC unavailable';
  END IF;
  IF has_function_privilege('anon','public.creator_profile_save(text,text,uuid,text[],text[],date,boolean)','execute')
     OR has_function_privilege('anon','public.creator_handle_upsert(text,text,text)','execute') THEN
    RAISE EXCEPTION 'creator writes leaked to anon';
  END IF;

  v_public:=public.public_creator_profile('00000000-0000-0000-0000-000000000001');
  IF v_public IS NOT NULL THEN RAISE EXCEPTION 'unknown creator should not be public'; END IF;
END;
$test$;

ROLLBACK;
