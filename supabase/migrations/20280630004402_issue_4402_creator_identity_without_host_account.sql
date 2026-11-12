-- #4402 — Explorers who never used the Host app can sign up as a Creator.
--
-- The Creator program keyed a creator to the Host app's account record
-- (creator_accounts), which only the Host app ever creates. Anyone who had
-- only used Explorer was refused at the first profile save. The creator
-- identity is now the person's login (auth.users / profiles), the same owner
-- payout and showcase media already use. No creator_accounts row is created
-- for Explorer creators, so Admin's Host classification, the data room Host
-- cohorts and account deletion keep their meaning.
--
-- Invariant I-4402-CREATOR-IDENTITY-IS-LOGIN (declared in
-- supabase/migrations/__tests__/issue_4402_creator_without_host_account.implementor.pg17.test.sql):
-- creator program rows are keyed to auth.users, never to creator_accounts.
--
-- Static SQL only. No backfill: the people who were refused never got a
-- profile row, and the one existing profile's login already exists.

BEGIN;
SET LOCAL lock_timeout = '10s';

-- 1. The creator profile belongs to the login. The column keeps its name
--    (dozens of functions read it). Deleting a login still cascades, as it did
--    through creator_accounts; deleting only a Host account no longer removes
--    the creator profile.
ALTER TABLE public.creator_profiles
  DROP CONSTRAINT creator_profiles_creator_account_id_fkey,
  ADD CONSTRAINT creator_profiles_creator_account_id_fkey
    FOREIGN KEY (creator_account_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- 2. The signed agreement belongs to the login, and still refuses deletion.
ALTER TABLE public.creator_agreement_acceptances
  DROP CONSTRAINT creator_agreement_acceptances_creator_account_id_fkey,
  ADD CONSTRAINT creator_agreement_acceptances_creator_account_id_fkey
    FOREIGN KEY (creator_account_id) REFERENCES auth.users(id) ON DELETE RESTRICT;

-- 3. Home city: the round-2 body (20280102003872), with the guard now a live
--    Explorer account. The error code name is kept so client copy still maps.
CREATE OR REPLACE FUNCTION public.creator_home_city_set(p_city_id uuid DEFAULT NULL,p_name text DEFAULT NULL,p_country_code text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_id uuid:=auth.uid(); v_city jsonb;
BEGIN
  IF v_id IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='28000'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=v_id AND explorer_deleted_at IS NULL) THEN
    RAISE EXCEPTION 'creator_account_required' USING ERRCODE='P0002';
  END IF;
  IF p_city_id IS NULL AND nullif(btrim(coalesce(p_name,'')),'') IS NULL THEN
    RETURN jsonb_build_object('ok',false,'error','city_required','field','home_city');
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.creator_profiles WHERE creator_account_id=v_id) THEN
    RETURN jsonb_build_object('ok',false,'error','creator_profile_required');
  END IF;
  v_city:=public.issue_3872_store_home_city(v_id,p_city_id,p_name,p_country_code);
  IF v_city IS NULL THEN RETURN jsonb_build_object('ok',false,'error','city_required','field','home_city'); END IF;
  RETURN jsonb_build_object('ok',true,'home_city',v_city);
END;
$fn$;
REVOKE ALL ON FUNCTION public.creator_home_city_set(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.creator_home_city_set(uuid,text,text) TO authenticated,service_role;

-- 4. Profile save: the round-2 body (20280102003872), with the same guard swap.
CREATE OR REPLACE FUNCTION public.creator_profile_save(p_display_name text,p_bio text,p_home_city_id uuid,p_niches text[],p_languages text[],
  p_date_of_birth date,p_usage_ads_opt_in boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_id uuid:=auth.uid(); v_was_verified boolean; v_result jsonb; v_dob date; v_live boolean;
BEGIN
  IF v_id IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='28000'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=v_id AND explorer_deleted_at IS NULL) THEN
    RAISE EXCEPTION 'creator_account_required' USING ERRCODE='P0002';
  END IF;
  SELECT verification='verified' INTO v_was_verified FROM public.creator_profiles WHERE creator_account_id=v_id;
  SELECT c.is_live_for_consumers INTO v_live FROM public.seeding_cities c WHERE c.id=p_home_city_id;
  -- DOB may be unknown until the agreement step; a null here never erases
  -- the date the creator gave when signing. p_usage_ads_opt_in is accepted
  -- for old clients and ignored: paid-ads usage is part of the program.
  INSERT INTO public.creator_profiles(creator_account_id,display_name,bio,home_city_id,niches,languages,date_of_birth,usage_ads_opt_in,mode_enabled)
  VALUES(v_id,btrim(p_display_name),nullif(btrim(p_bio),''),CASE WHEN v_live THEN p_home_city_id END,coalesce(p_niches,'{}'),coalesce(p_languages,'{}'),p_date_of_birth,true,true)
  ON CONFLICT(creator_account_id) DO UPDATE SET
    display_name=excluded.display_name,bio=excluded.bio,
    niches=excluded.niches,languages=excluded.languages,
    date_of_birth=coalesce(excluded.date_of_birth,public.creator_profiles.date_of_birth),
    usage_ads_opt_in=true;
  IF p_home_city_id IS NOT NULL THEN
    IF public.issue_3872_store_home_city(v_id,p_home_city_id,NULL,NULL) IS NULL THEN
      RAISE EXCEPTION 'city_not_found' USING ERRCODE='P0002';
    END IF;
  END IF;
  SELECT date_of_birth INTO v_dob FROM public.creator_profiles WHERE creator_account_id=v_id;
  v_result:=public.issue_3872_recompute_creator_verification(v_id,coalesce(v_was_verified,false) AND v_dob IS NOT NULL AND v_dob>(current_date-interval '18 years')::date);
  RETURN jsonb_build_object('ok',true,'verification',v_result);
END;
$fn$;
REVOKE ALL ON FUNCTION public.creator_profile_save(text,text,uuid,text[],text[],date,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.creator_profile_save(text,text,uuid,text[],text[],date,boolean) TO authenticated,service_role;

-- 5. Rates: the r3 body (20271225003872) plus an explicit profile check, so a
--    rate saved before the profile is refused with creator_profile_required
--    instead of a raw foreign-key error the app cannot explain.
CREATE OR REPLACE FUNCTION public.creator_package_upsert(
  p_format_key text,p_platforms text[],p_price_minor bigint,p_currency text,
  p_turnaround_days integer,p_includes_usage_days integer DEFAULT 90,
  p_extra_usage_price_minor bigint DEFAULT NULL,p_active boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_id uuid:=auth.uid(); v_row public.creator_packages;
BEGIN
  IF v_id IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='28000'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.creator_profiles WHERE creator_account_id=v_id) THEN
    RAISE EXCEPTION 'creator_profile_required' USING ERRCODE='P0002';
  END IF;
  INSERT INTO public.creator_packages(creator_account_id,format_key,platforms,price_minor,currency,turnaround_days,includes_usage_days,extra_usage_price_minor,active)
  VALUES(v_id,p_format_key,p_platforms,p_price_minor,upper(p_currency),p_turnaround_days,p_includes_usage_days,p_extra_usage_price_minor,p_active)
  ON CONFLICT(creator_account_id,format_key) DO UPDATE SET platforms=excluded.platforms,
    price_minor=excluded.price_minor,currency=excluded.currency,turnaround_days=excluded.turnaround_days,
    includes_usage_days=excluded.includes_usage_days,extra_usage_price_minor=excluded.extra_usage_price_minor,active=excluded.active
  RETURNING * INTO v_row;
  RETURN to_jsonb(v_row)-'creator_account_id';
END;
$fn$;
REVOKE ALL ON FUNCTION public.creator_package_upsert(text,text[],bigint,text,integer,integer,bigint,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.creator_package_upsert(text,text[],bigint,text,integer,integer,bigint,boolean) TO authenticated,service_role;

-- 6. Admin program messaging (#4187): a creator target is a person with a
--    creator profile, Host account or not. The rest of the body is unchanged.
CREATE OR REPLACE FUNCTION public.issue_4187_program_target_exists(
  p_program_kind text,
  p_target_user_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT CASE p_program_kind
    WHEN 'creator' THEN EXISTS (
      SELECT 1
      FROM public.creator_profiles profile
      WHERE profile.creator_account_id = p_target_user_id
    )
    WHEN 'local' THEN EXISTS (
      SELECT 1 FROM public.local_applications application
      WHERE application.user_id = p_target_user_id
    ) OR EXISTS (
      SELECT 1 FROM public.locals local_row
      WHERE local_row.user_id = p_target_user_id
    )
    ELSE false
  END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4187_program_target_exists(text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4187_program_target_exists(text, uuid)
  TO service_role;

COMMIT;
