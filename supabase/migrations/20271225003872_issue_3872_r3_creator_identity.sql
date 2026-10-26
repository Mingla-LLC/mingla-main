-- #3872 R3 C1 — creator identity, social proof, packages and onboarding truth.
--
-- MINGLA-INVARIANT: I-3872-CREATOR-VERIFICATION | issue #3872 | A creator is verified only when age, a verified public handle, an active payout rail, a processed showcase and an approved agreement are all present; issue_3872_recompute_creator_verification and its tests are the enforcement authority.
-- MINGLA-INVARIANT: I-3872-CREATOR-PRIVACY | issue #3872 | Public creator discovery returns only the explicit public_creator_profile allow-list; raw identity, DOB and payout tables remain closed to anon.

BEGIN;
SET LOCAL lock_timeout = '10s';

CREATE TABLE public.creator_profiles (
  creator_account_id uuid PRIMARY KEY REFERENCES public.creator_accounts(id) ON DELETE CASCADE,
  mode_enabled boolean NOT NULL DEFAULT false,
  display_name text NOT NULL CHECK (char_length(btrim(display_name)) BETWEEN 2 AND 40),
  bio text CHECK (bio IS NULL OR char_length(btrim(bio)) <= 280),
  home_city_id uuid REFERENCES public.seeding_cities(id) ON DELETE SET NULL,
  niches text[] NOT NULL DEFAULT '{}',
  languages text[] NOT NULL DEFAULT '{}',
  date_of_birth date,
  verification text NOT NULL DEFAULT 'incomplete'
    CHECK (verification IN ('incomplete','verified','review','rejected','suspended')),
  verification_reasons text[] NOT NULL DEFAULT '{}',
  agreement_version text,
  agreement_signed_at timestamptz,
  reliability_bps integer CHECK (reliability_bps IS NULL OR reliability_bps BETWEEN 0 AND 10000),
  rating_avg_x100 integer CHECK (rating_avg_x100 IS NULL OR rating_avg_x100 BETWEEN 100 AND 500),
  rating_count integer NOT NULL DEFAULT 0 CHECK (rating_count >= 0),
  completed_gigs integer NOT NULL DEFAULT 0 CHECK (completed_gigs >= 0),
  usage_ads_opt_in boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT creator_profiles_niches_count CHECK (cardinality(niches) <= 5),
  CONSTRAINT creator_profiles_niches_values CHECK (
    niches <@ ARRAY['food','nightlife','culture','outdoors','wellness','music','family','travel']::text[]
  ),
  CONSTRAINT creator_profiles_languages_shape CHECK (
    cardinality(languages) <= 10 AND array_position(languages,'') IS NULL
  ),
  CONSTRAINT creator_profiles_agreement_pair CHECK (
    (agreement_version IS NULL) = (agreement_signed_at IS NULL)
  ),
  CONSTRAINT creator_profiles_reliability_threshold CHECK (
    completed_gigs >= 3 OR reliability_bps IS NULL
  )
);

CREATE INDEX creator_profiles_discover_idx
  ON public.creator_profiles(home_city_id,verification,mode_enabled,rating_avg_x100 DESC NULLS LAST)
  WHERE mode_enabled AND verification='verified';

CREATE TABLE public.creator_handles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_account_id uuid NOT NULL REFERENCES public.creator_profiles(creator_account_id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('instagram','tiktok','youtube','x','snapchat')),
  handle text NOT NULL CHECK (
    handle=lower(handle) AND handle !~ '^@' AND handle ~ '^[a-z0-9._-]{1,80}$'
  ),
  follower_band text CHECK (follower_band IN ('lt1k','1k_10k','10k_50k','50k_250k','250k_1m','gt1m')),
  follower_source text NOT NULL DEFAULT 'self_reported'
    CHECK (follower_source IN ('self_reported','provider')),
  verify_code text NOT NULL CHECK (verify_code ~ '^MINGLA-[A-F0-9]{4}$'),
  verify_started_at timestamptz NOT NULL DEFAULT now(),
  verify_expires_at timestamptz NOT NULL DEFAULT (now()+interval '72 hours'),
  verified_at timestamptz,
  last_checked_at timestamptz,
  review_required boolean NOT NULL DEFAULT false,
  review_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(platform,handle),
  UNIQUE(creator_account_id,platform),
  CONSTRAINT creator_handles_window CHECK (verify_expires_at > verify_started_at),
  CONSTRAINT creator_handles_review_shape CHECK (review_required OR review_reason IS NULL)
);
CREATE INDEX creator_handles_owner_idx ON public.creator_handles(creator_account_id,platform);

CREATE TABLE public.creator_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_account_id uuid NOT NULL REFERENCES public.creator_profiles(creator_account_id) ON DELETE CASCADE,
  format_key text NOT NULL REFERENCES public.gig_formats(key) ON DELETE RESTRICT,
  platforms text[] NOT NULL,
  price_minor bigint NOT NULL CHECK (price_minor > 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  turnaround_days integer NOT NULL CHECK (turnaround_days BETWEEN 1 AND 30),
  includes_usage_days integer NOT NULL DEFAULT 90 CHECK (includes_usage_days IN (30,90,365)),
  extra_usage_price_minor bigint CHECK (extra_usage_price_minor IS NULL OR extra_usage_price_minor > 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(creator_account_id,format_key),
  CONSTRAINT creator_packages_platforms_shape CHECK (
    cardinality(platforms) BETWEEN 1 AND 5
    AND platforms <@ ARRAY['instagram','tiktok','youtube','x','snapchat']::text[]
  )
);
CREATE INDEX creator_packages_owner_active_idx
  ON public.creator_packages(creator_account_id,active,format_key);

CREATE TRIGGER issue_3872_creator_profiles_updated
BEFORE UPDATE ON public.creator_profiles
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER issue_3872_creator_handles_updated
BEFORE UPDATE ON public.creator_handles
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER issue_3872_creator_packages_updated
BEFORE UPDATE ON public.creator_packages
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.creator_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creator_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.creator_handles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creator_handles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.creator_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creator_packages FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.creator_profiles,public.creator_handles,public.creator_packages FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.creator_profiles,public.creator_handles,public.creator_packages TO authenticated;
GRANT ALL ON public.creator_profiles,public.creator_handles,public.creator_packages TO service_role;

CREATE POLICY creator_profiles_owner_read ON public.creator_profiles
  FOR SELECT TO authenticated USING (creator_account_id=auth.uid());
CREATE POLICY creator_handles_owner_read ON public.creator_handles
  FOR SELECT TO authenticated USING (creator_account_id=auth.uid());
CREATE POLICY creator_packages_owner_read ON public.creator_packages
  FOR SELECT TO authenticated USING (creator_account_id=auth.uid());
CREATE POLICY creator_profiles_service_all ON public.creator_profiles
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY creator_handles_service_all ON public.creator_handles
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY creator_packages_service_all ON public.creator_packages
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.issue_3872_recompute_creator_verification(
  p_creator_account_id uuid,
  p_signal_conflict boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $fn$
DECLARE
  v_profile public.creator_profiles;
  v_reasons text[] := '{}';
  v_has_handle boolean;
  v_age_ok boolean;
  v_payee_ok boolean;
  v_showcase_ok boolean;
  v_agreement_ok boolean;
  v_next text;
BEGIN
  SELECT * INTO v_profile FROM public.creator_profiles
   WHERE creator_account_id=p_creator_account_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'creator_profile_not_found' USING ERRCODE='P0002'; END IF;

  SELECT EXISTS(SELECT 1 FROM public.creator_handles
    WHERE creator_account_id=p_creator_account_id AND verified_at IS NOT NULL AND NOT review_required)
    INTO v_has_handle;
  v_age_ok := v_profile.date_of_birth IS NOT NULL
    AND v_profile.date_of_birth <= (current_date - interval '18 years')::date;
  SELECT EXISTS(SELECT 1 FROM public.payee_accounts
    WHERE user_id=p_creator_account_id AND (stripe_status='active' OR paystack_status='verified'))
    INTO v_payee_ok;
  SELECT EXISTS(SELECT 1 FROM public.creator_media_jobs
    WHERE owner_kind='creator' AND owner_id=p_creator_account_id
      AND purpose='showcase' AND status='ready' AND deleted_at IS NULL)
    INTO v_showcase_ok;
  v_agreement_ok := v_profile.agreement_version IS NOT NULL
    AND v_profile.agreement_signed_at IS NOT NULL;

  IF NOT v_has_handle THEN v_reasons:=array_append(v_reasons,'verified_handle'); END IF;
  IF NOT v_age_ok THEN v_reasons:=array_append(v_reasons,'age_18_plus'); END IF;
  IF NOT v_payee_ok THEN v_reasons:=array_append(v_reasons,'active_payout'); END IF;
  IF NOT v_showcase_ok THEN v_reasons:=array_append(v_reasons,'processed_showcase'); END IF;
  IF NOT v_agreement_ok THEN v_reasons:=array_append(v_reasons,'signed_agreement'); END IF;

  v_next := CASE
    WHEN v_profile.verification IN ('rejected','suspended') THEN v_profile.verification
    WHEN p_signal_conflict OR EXISTS(SELECT 1 FROM public.creator_handles
      WHERE creator_account_id=p_creator_account_id AND review_required) THEN 'review'
    WHEN cardinality(v_reasons)=0 THEN 'verified'
    ELSE 'incomplete'
  END;
  UPDATE public.creator_profiles SET verification=v_next,verification_reasons=v_reasons
   WHERE creator_account_id=p_creator_account_id RETURNING * INTO v_profile;
  RETURN jsonb_build_object('verification',v_profile.verification,'missing',v_profile.verification_reasons);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.creator_profile_save(
  p_display_name text,
  p_bio text,
  p_home_city_id uuid,
  p_niches text[],
  p_languages text[],
  p_date_of_birth date,
  p_usage_ads_opt_in boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_id uuid:=auth.uid(); v_was_verified boolean; v_result jsonb;
BEGIN
  IF v_id IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='28000'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.creator_accounts WHERE id=v_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'creator_account_required' USING ERRCODE='P0002';
  END IF;
  SELECT verification='verified' INTO v_was_verified FROM public.creator_profiles WHERE creator_account_id=v_id;
  -- Saving a Creator profile is how a person switches Creator mode on. Hosts
  -- still see them only once verification also passes; a later pause control
  -- owns turning the mode back off, so an update never resets it here.
  INSERT INTO public.creator_profiles(creator_account_id,display_name,bio,home_city_id,niches,languages,date_of_birth,usage_ads_opt_in,mode_enabled)
  VALUES(v_id,btrim(p_display_name),nullif(btrim(p_bio),''),p_home_city_id,coalesce(p_niches,'{}'),coalesce(p_languages,'{}'),p_date_of_birth,coalesce(p_usage_ads_opt_in,false),true)
  ON CONFLICT(creator_account_id) DO UPDATE SET
    display_name=excluded.display_name,bio=excluded.bio,home_city_id=excluded.home_city_id,
    niches=excluded.niches,languages=excluded.languages,date_of_birth=excluded.date_of_birth,
    usage_ads_opt_in=excluded.usage_ads_opt_in;
  v_result:=public.issue_3872_recompute_creator_verification(v_id,coalesce(v_was_verified,false) AND p_date_of_birth>(current_date-interval '18 years')::date);
  RETURN jsonb_build_object('ok',true,'verification',v_result);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.creator_handle_upsert(
  p_platform text,p_handle text,p_follower_band text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_id uuid:=auth.uid(); v_handle text; v_row public.creator_handles;
BEGIN
  IF v_id IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='28000'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.creator_profiles WHERE creator_account_id=v_id) THEN
    RAISE EXCEPTION 'creator_profile_required' USING ERRCODE='P0002';
  END IF;
  v_handle:=lower(regexp_replace(btrim(p_handle),'^@','','g'));
  INSERT INTO public.creator_handles(creator_account_id,platform,handle,follower_band,verify_code)
  VALUES(v_id,lower(p_platform),v_handle,p_follower_band,'MINGLA-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,4)))
  ON CONFLICT(creator_account_id,platform) DO UPDATE SET
    handle=excluded.handle,follower_band=excluded.follower_band,follower_source='self_reported',
    verify_code=excluded.verify_code,verify_started_at=now(),verify_expires_at=now()+interval '72 hours',
    verified_at=NULL,last_checked_at=NULL,review_required=false,review_reason=NULL
  RETURNING * INTO v_row;
  PERFORM public.issue_3872_recompute_creator_verification(v_id,false);
  RETURN jsonb_build_object('id',v_row.id,'platform',v_row.platform,'handle',v_row.handle,
    'verify_code',v_row.verify_code,'expires_at',v_row.verify_expires_at);
EXCEPTION WHEN unique_violation THEN
  PERFORM public.issue_3872_recompute_creator_verification(v_id,true);
  RAISE EXCEPTION 'handle_already_claimed' USING ERRCODE='23505';
END;
$fn$;

CREATE OR REPLACE FUNCTION public.creator_package_upsert(
  p_format_key text,p_platforms text[],p_price_minor bigint,p_currency text,
  p_turnaround_days integer,p_includes_usage_days integer DEFAULT 90,
  p_extra_usage_price_minor bigint DEFAULT NULL,p_active boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_id uuid:=auth.uid(); v_row public.creator_packages;
BEGIN
  IF v_id IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='28000'; END IF;
  INSERT INTO public.creator_packages(creator_account_id,format_key,platforms,price_minor,currency,turnaround_days,includes_usage_days,extra_usage_price_minor,active)
  VALUES(v_id,p_format_key,p_platforms,p_price_minor,upper(p_currency),p_turnaround_days,p_includes_usage_days,p_extra_usage_price_minor,p_active)
  ON CONFLICT(creator_account_id,format_key) DO UPDATE SET platforms=excluded.platforms,
    price_minor=excluded.price_minor,currency=excluded.currency,turnaround_days=excluded.turnaround_days,
    includes_usage_days=excluded.includes_usage_days,extra_usage_price_minor=excluded.extra_usage_price_minor,active=excluded.active
  RETURNING * INTO v_row;
  RETURN to_jsonb(v_row)-'creator_account_id';
END;
$fn$;

CREATE OR REPLACE FUNCTION public.creator_agreement_sign(p_agreement_version text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_id uuid:=auth.uid(); v_result jsonb;
BEGIN
  IF v_id IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='28000'; END IF;
  IF p_agreement_version IS NULL OR char_length(btrim(p_agreement_version)) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION 'approved_agreement_version_required' USING ERRCODE='22023';
  END IF;
  UPDATE public.creator_profiles SET agreement_version=btrim(p_agreement_version),agreement_signed_at=now()
   WHERE creator_account_id=v_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'creator_profile_required' USING ERRCODE='P0002'; END IF;
  v_result:=public.issue_3872_recompute_creator_verification(v_id,false);
  RETURN jsonb_build_object('ok',true,'verification',v_result);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.creator_setup_status() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=public,pg_temp AS $fn$
DECLARE v_id uuid:=auth.uid(); v_profile public.creator_profiles;
BEGIN
  IF v_id IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='28000'; END IF;
  SELECT * INTO v_profile FROM public.creator_profiles WHERE creator_account_id=v_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('profile',false,'missing',jsonb_build_array('profile','verified_handle','package','processed_showcase','active_payout','signed_agreement')); END IF;
  RETURN jsonb_build_object(
    'profile',true,'mode_enabled',v_profile.mode_enabled,'verification',v_profile.verification,
    'missing',to_jsonb(v_profile.verification_reasons)
      || CASE WHEN EXISTS(SELECT 1 FROM public.creator_packages WHERE creator_account_id=v_id AND active) THEN '[]'::jsonb ELSE '["package"]'::jsonb END,
    'handles',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',h.id,'platform',h.platform,'handle',h.handle,'verify_code',h.verify_code,'verified',h.verified_at IS NOT NULL,'review_required',h.review_required,'expires_at',h.verify_expires_at) ORDER BY h.platform),'[]'::jsonb) FROM public.creator_handles h WHERE h.creator_account_id=v_id),
    'packages',(SELECT coalesce(jsonb_agg(to_jsonb(p)-'creator_account_id' ORDER BY p.format_key),'[]'::jsonb) FROM public.creator_packages p WHERE p.creator_account_id=v_id)
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.public_creator_profile(p_creator_account_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=public,pg_temp AS $fn$
  SELECT CASE WHEN p.mode_enabled AND p.verification='verified' THEN jsonb_build_object(
    'id',p.creator_account_id,'display_name',p.display_name,'niches',p.niches,
    'showcase',(SELECT coalesce(jsonb_agg(jsonb_build_object('media_id',m.id,'thumb',NULL) ORDER BY m.created_at DESC),'[]'::jsonb) FROM public.creator_media_jobs m WHERE m.owner_id=p.creator_account_id AND m.owner_kind='creator' AND m.purpose='showcase' AND m.status='ready' AND m.deleted_at IS NULL),
    'completed_gigs',p.completed_gigs
  ) ELSE NULL END FROM public.creator_profiles p WHERE p.creator_account_id=p_creator_account_id;
$fn$;

REVOKE ALL ON FUNCTION public.issue_3872_recompute_creator_verification(uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_recompute_creator_verification(uuid,boolean) TO service_role;
REVOKE ALL ON FUNCTION public.creator_profile_save(text,text,uuid,text[],text[],date,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.creator_profile_save(text,text,uuid,text[],text[],date,boolean) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.creator_handle_upsert(text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.creator_handle_upsert(text,text,text) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.creator_package_upsert(text,text[],bigint,text,integer,integer,bigint,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.creator_package_upsert(text,text[],bigint,text,integer,integer,bigint,boolean) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.creator_agreement_sign(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.creator_agreement_sign(text) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.creator_setup_status() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.creator_setup_status() TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.public_creator_profile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_creator_profile(uuid) TO anon,authenticated,service_role;

COMMENT ON FUNCTION public.public_creator_profile(uuid) IS
  '#3872 Explorer privacy allow-list: id, display_name, niches, showcase media ids and completed_gigs only. Never add handles, bio, date_of_birth, email, payout identifiers or agreement evidence.';

COMMIT;
