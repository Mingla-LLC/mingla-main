-- #3872 round 2 (server contract for the second Host and Explorer pass).
-- 1. Paid-ads usage is part of being a Mingla Creator: always stored as true.
-- 2. Home city: search live and not-yet-live cities, keep a not-yet-live city
--    aside so hosts never match on it until it launches.
-- 3. Gig counts: a hired creator is no longer counted or listed as interested.
-- 4. The contract workspace says where the creator's money is (money_state).
-- 5. brand_promotion_overview: one read for the Blast Overview.
BEGIN;
SET LOCAL lock_timeout = '10s';

-- 1. Paid-ads usage -------------------------------------------------------
ALTER TABLE public.creator_profiles ALTER COLUMN usage_ads_opt_in SET DEFAULT true;
UPDATE public.creator_profiles SET usage_ads_opt_in=true WHERE usage_ads_opt_in IS DISTINCT FROM true;
ALTER TABLE public.creator_profiles
  ADD CONSTRAINT creator_profiles_usage_ads_always CHECK (usage_ads_opt_in);

-- 2. Home city storage ----------------------------------------------------
-- home_city_id only ever points at a city the creator chose while it was live.
-- A city that is not live yet is kept in the pending columns instead.
ALTER TABLE public.creator_profiles
  ADD COLUMN home_city_pending_id uuid REFERENCES public.seeding_cities(id) ON DELETE SET NULL,
  ADD COLUMN home_city_pending_name text,
  ADD COLUMN home_city_pending_country text;
ALTER TABLE public.creator_profiles
  ADD CONSTRAINT creator_profiles_home_city_pending_shape CHECK (
    (home_city_pending_name IS NULL OR char_length(btrim(home_city_pending_name)) BETWEEN 2 AND 80)
    AND (home_city_pending_country IS NULL OR home_city_pending_country ~ '^[A-Z]{2}$')
    AND (home_city_pending_name IS NOT NULL OR (home_city_pending_id IS NULL AND home_city_pending_country IS NULL))
    AND (home_city_id IS NULL OR home_city_pending_name IS NULL)
  );

CREATE OR REPLACE FUNCTION public.issue_3872_creator_home_city_json(p_creator uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
  SELECT CASE
    WHEN p.home_city_id IS NOT NULL THEN
      (SELECT jsonb_build_object('id',c.id,'name',c.name,'is_live',c.is_live_for_consumers) FROM public.seeding_cities c WHERE c.id=p.home_city_id)
    WHEN p.home_city_pending_name IS NOT NULL THEN
      jsonb_build_object('id',p.home_city_pending_id,'name',p.home_city_pending_name,'is_live',false)
  END
  FROM public.creator_profiles p WHERE p.creator_account_id=p_creator;
$fn$;
REVOKE ALL ON FUNCTION public.issue_3872_creator_home_city_json(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_creator_home_city_json(uuid) TO service_role;

-- The creator's own profile read is a table select; this computed field lets
-- it ask for `home_city:creator_profile_home_city` next to the columns.
CREATE OR REPLACE FUNCTION public.creator_profile_home_city(p public.creator_profiles) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
  SELECT CASE
    WHEN p.home_city_id IS NOT NULL THEN
      (SELECT jsonb_build_object('id',c.id,'name',c.name,'is_live',c.is_live_for_consumers) FROM public.seeding_cities c WHERE c.id=p.home_city_id)
    WHEN p.home_city_pending_name IS NOT NULL THEN
      jsonb_build_object('id',p.home_city_pending_id,'name',p.home_city_pending_name,'is_live',false)
  END;
$fn$;
REVOKE ALL ON FUNCTION public.creator_profile_home_city(public.creator_profiles) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.creator_profile_home_city(public.creator_profiles) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.issue_3872_caller_country() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
  SELECT coalesce((SELECT upper(btrim(p.country)) FROM public.profiles p WHERE p.id=auth.uid() AND upper(btrim(p.country)) ~ '^[A-Z]{2}$'),'US');
$fn$;
REVOKE ALL ON FUNCTION public.issue_3872_caller_country() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_caller_country() TO service_role;

-- Stores a city on the caller's profile. A live city goes in home_city_id;
-- anything else is kept pending. Returns the stored home_city object.
CREATE OR REPLACE FUNCTION public.issue_3872_store_home_city(p_creator uuid,p_city_id uuid,p_name text,p_country text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_city public.seeding_cities; v_name text:=nullif(btrim(regexp_replace(coalesce(p_name,''),'\s+',' ','g')),'');
  v_country text:=upper(btrim(coalesce(p_country,'')));
BEGIN
  IF v_country !~ '^[A-Z]{2}$' THEN v_country:=NULL; END IF;
  IF p_city_id IS NOT NULL THEN
    SELECT * INTO v_city FROM public.seeding_cities WHERE id=p_city_id;
    IF NOT FOUND THEN RETURN NULL; END IF;
  ELSIF v_name IS NOT NULL THEN
    IF char_length(v_name) NOT BETWEEN 2 AND 80 THEN RETURN NULL; END IF;
    -- A typed name that is already a known city resolves to that city.
    SELECT * INTO v_city FROM public.seeding_cities c
     WHERE lower(c.name)=lower(v_name) AND (v_country IS NULL OR upper(coalesce(c.country_code,''))=v_country)
     ORDER BY c.is_live_for_consumers DESC,c.name LIMIT 1;
  ELSE
    RETURN NULL;
  END IF;
  IF v_city.id IS NOT NULL AND v_city.is_live_for_consumers THEN
    UPDATE public.creator_profiles SET home_city_id=v_city.id,home_city_pending_id=NULL,home_city_pending_name=NULL,home_city_pending_country=NULL
     WHERE creator_account_id=p_creator;
  ELSIF v_city.id IS NOT NULL THEN
    UPDATE public.creator_profiles SET home_city_id=NULL,home_city_pending_id=v_city.id,home_city_pending_name=v_city.name,
      home_city_pending_country=CASE WHEN upper(coalesce(v_city.country_code,'')) ~ '^[A-Z]{2}$' THEN upper(v_city.country_code) ELSE coalesce(v_country,public.issue_3872_caller_country()) END
     WHERE creator_account_id=p_creator;
  ELSE
    UPDATE public.creator_profiles SET home_city_id=NULL,home_city_pending_id=NULL,home_city_pending_name=initcap(v_name),
      home_city_pending_country=coalesce(v_country,public.issue_3872_caller_country())
     WHERE creator_account_id=p_creator;
  END IF;
  RETURN public.issue_3872_creator_home_city_json(p_creator);
END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_3872_store_home_city(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_store_home_city(uuid,uuid,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.creator_city_search(p_query text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_q text:=nullif(btrim(regexp_replace(coalesce(p_query,''),'\s+',' ','g')),''); v_like text; v_rows jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='28000'; END IF;
  IF v_q IS NULL THEN
    RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('city_id',c.id,'name',c.name,'region',NULL,'country_code',upper(c.country_code),'is_live',true) ORDER BY c.name,c.id)
      FROM public.seeding_cities c WHERE c.is_live_for_consumers),'[]'::jsonb);
  END IF;
  v_q:=left(v_q,80);
  v_like:='%'||replace(replace(replace(v_q,'\','\\'),'%','\%'),'_','\_')||'%';
  SELECT coalesce(jsonb_agg(r.j ORDER BY r.live DESC,r.prefix DESC,r.name,r.id),'[]'::jsonb) INTO v_rows FROM (
    SELECT c.id,c.name,c.is_live_for_consumers AS live,lower(c.name) LIKE lower(v_q)||'%' AS prefix,
      jsonb_build_object('city_id',c.id,'name',c.name,'region',NULL,'country_code',upper(c.country_code),'is_live',c.is_live_for_consumers) AS j
    FROM public.seeding_cities c WHERE c.name ILIKE v_like ESCAPE '\'
    ORDER BY c.is_live_for_consumers DESC,c.name LIMIT 20
  ) r;
  -- Mingla may not know the city at all: offer the typed name as a city that
  -- is not live yet, so the creator can still save it.
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_rows) e WHERE lower(e->>'name')=lower(v_q)) THEN
    v_rows:=v_rows||jsonb_build_array(jsonb_build_object('city_id',NULL,'name',initcap(v_q),'region',NULL,'country_code',public.issue_3872_caller_country(),'is_live',false));
  END IF;
  RETURN v_rows;
END;
$fn$;
REVOKE ALL ON FUNCTION public.creator_city_search(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.creator_city_search(text) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.creator_home_city_set(p_city_id uuid DEFAULT NULL,p_name text DEFAULT NULL,p_country_code text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_id uuid:=auth.uid(); v_city jsonb;
BEGIN
  IF v_id IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='28000'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.creator_accounts WHERE id=v_id AND deleted_at IS NULL) THEN
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

-- When a city launches, creators who were waiting for it move onto it.
CREATE OR REPLACE FUNCTION public.issue_3872_city_went_live() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
BEGIN
  IF NEW.is_live_for_consumers AND NOT coalesce(OLD.is_live_for_consumers,false) THEN
    UPDATE public.creator_profiles p SET home_city_id=NEW.id,home_city_pending_id=NULL,home_city_pending_name=NULL,home_city_pending_country=NULL
     WHERE p.home_city_id IS NULL AND (p.home_city_pending_id=NEW.id
       OR (p.home_city_pending_id IS NULL AND lower(p.home_city_pending_name)=lower(NEW.name)
           AND p.home_city_pending_country IS NOT DISTINCT FROM upper(NEW.country_code)));
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_3872_city_went_live() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS issue_3872_city_went_live ON public.seeding_cities;
CREATE TRIGGER issue_3872_city_went_live AFTER UPDATE OF is_live_for_consumers ON public.seeding_cities
  FOR EACH ROW EXECUTE FUNCTION public.issue_3872_city_went_live();

-- Profile save: the paid-ads flag is always stored true; a null city keeps
-- the city already saved; a city that is not live is kept pending.
CREATE OR REPLACE FUNCTION public.creator_profile_save(p_display_name text,p_bio text,p_home_city_id uuid,p_niches text[],p_languages text[],
  p_date_of_birth date,p_usage_ads_opt_in boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_id uuid:=auth.uid(); v_was_verified boolean; v_result jsonb; v_dob date; v_live boolean;
BEGIN
  IF v_id IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='28000'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.creator_accounts WHERE id=v_id AND deleted_at IS NULL) THEN
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

CREATE OR REPLACE FUNCTION public.creator_setup_status() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_id uuid:=auth.uid(); v_profile public.creator_profiles;
BEGIN
  IF v_id IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='28000'; END IF;
  SELECT * INTO v_profile FROM public.creator_profiles WHERE creator_account_id=v_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('profile',false,'mode_enabled',false,'verification','incomplete','review_note',NULL,'declined_reason',NULL,
      'checks',public.issue_3872_creator_checks(v_id),'home_city',NULL,
      'missing',jsonb_build_array('profile','verified_handle','package','processed_showcase','active_payout','signed_agreement'));
  END IF;
  RETURN jsonb_build_object(
    'profile',true,'mode_enabled',v_profile.mode_enabled,'verification',v_profile.verification,
    'review_note',CASE WHEN v_profile.verification IN ('needs_more','suspended') THEN v_profile.review_note END,
    'declined_reason',CASE WHEN v_profile.verification='declined' THEN v_profile.declined_reason END,
    'checks',public.issue_3872_creator_checks(v_id),
    'display_name',v_profile.display_name,'niches',to_jsonb(v_profile.niches),
    'home_city',public.issue_3872_creator_home_city_json(v_id),
    'missing',to_jsonb(v_profile.verification_reasons)
      || CASE WHEN EXISTS(SELECT 1 FROM public.creator_packages WHERE creator_account_id=v_id AND active) THEN '[]'::jsonb ELSE '["package"]'::jsonb END,
    'handles',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',h.id,'platform',h.platform,'handle',h.handle,'verify_code',h.verify_code,'verified',h.verified_at IS NOT NULL,'review_required',h.review_required,'expires_at',h.verify_expires_at,'follower_band',h.follower_band) ORDER BY h.platform),'[]'::jsonb) FROM public.creator_handles h WHERE h.creator_account_id=v_id),
    'packages',(SELECT coalesce(jsonb_agg(to_jsonb(p)-'creator_account_id' ORDER BY p.format_key),'[]'::jsonb) FROM public.creator_packages p WHERE p.creator_account_id=v_id)
  );
END;
$fn$;

-- A creator waiting for their city to launch has no board gigs yet (only
-- gigs a host invited them to directly).
CREATE OR REPLACE FUNCTION public.creator_gig_board(p_city_id uuid DEFAULT NULL,p_format_key text DEFAULT NULL) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
  SELECT coalesce(jsonb_agg(public.issue_3872_public_gig_json(g.id,auth.uid()) ORDER BY g.shoot_window_start,g.created_at),'[]'::jsonb)
  FROM public.gigs g
  WHERE (p_city_id IS NULL OR g.city_id=p_city_id) AND (p_format_key IS NULL OR g.format_key=p_format_key)
    AND public.issue_3872_gig_visible_to_creator(g.id,auth.uid())
    AND EXISTS(SELECT 1 FROM public.creator_profiles p WHERE p.creator_account_id=auth.uid() AND p.mode_enabled AND p.verification='verified'
      AND (p_city_id IS NOT NULL OR g.visibility<>'board'
           OR p.home_city_pending_name IS NULL));
$fn$;

-- 3. Gig counts -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_3872_creator_hired_on_gig(p_gig_id uuid,p_creator uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
  SELECT EXISTS(SELECT 1 FROM public.gig_contracts x WHERE x.gig_id=p_gig_id AND x.creator_account_id=p_creator
    AND x.state NOT IN ('offered','declined','expired','cancelled','resolved_refund'));
$fn$;
REVOKE ALL ON FUNCTION public.issue_3872_creator_hired_on_gig(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_creator_hired_on_gig(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.gig_host_home(p_brand_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
  SELECT CASE WHEN public.biz_is_brand_member_for_read(p_brand_id,auth.uid()) THEN jsonb_build_object(
    'gigs',coalesce((SELECT jsonb_agg(to_jsonb(g)||jsonb_build_object(
        -- Interested excludes creators already hired on this gig (round 2).
        'interest_count',(SELECT count(*) FROM public.gig_interest i WHERE i.gig_id=g.id AND i.status IN ('sent','shortlisted')
           AND NOT public.issue_3872_creator_hired_on_gig(g.id,i.creator_account_id)),
        'hired_count',(SELECT count(*) FROM public.gig_contracts x WHERE x.gig_id=g.id AND x.state NOT IN ('offered','declined','expired','cancelled','resolved_refund')),
        'slots_left',public.issue_3872_gig_slots_left(g.id)
      ) ORDER BY g.updated_at DESC) FROM public.gigs g WHERE g.brand_id=p_brand_id),'[]'::jsonb),
    'contracts',coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id',c.id,'gig_id',c.gig_id,'state',c.state,'deadline_at',c.state_deadline_at,'title',g.title_public,'creator',p.display_name,
        'due_at',CASE WHEN c.state IN ('approved','posting','posts_failed') THEN ((coalesce(tv.post_by,g.post_by)+1)::timestamp AT TIME ZONE 'UTC') ELSE c.state_deadline_at END,
        'needs_host',(c.state IN ('accepted','shoot_planned','script_sent','delivered')
            OR EXISTS(SELECT 1 FROM public.gig_change_proposals pr WHERE pr.contract_id=c.id AND pr.status='open' AND pr.proposed_by='creator')
            OR EXISTS(SELECT 1 FROM public.gig_hold_adjustments a WHERE a.contract_id=c.id AND a.kind='topup' AND a.status='pending')
            OR (c.state='offered' AND NOT EXISTS(SELECT 1 FROM public.gig_holds h WHERE h.contract_id=c.id AND h.status<>'pending'))),
        'payment_pending',(c.state='offered' AND NOT public.issue_3872_offer_ready(c.id)),
        'fee_minor',tv.fee_minor,'currency',tv.currency
      ) ORDER BY c.updated_at DESC)
      FROM public.gig_contracts c JOIN public.gigs g ON g.id=c.gig_id
      JOIN public.creator_profiles p ON p.creator_account_id=c.creator_account_id
      LEFT JOIN public.gig_terms_versions tv ON tv.contract_id=c.id AND tv.version=c.current_terms_version
      WHERE c.brand_id=p_brand_id AND c.cancel_reason IS DISTINCT FROM 'payment_not_completed'),'[]'::jsonb)
  ) ELSE NULL END;
$fn$;

CREATE OR REPLACE FUNCTION public.gig_applicants(p_gig_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
  -- FILTER keeps a gig with no interest at [] instead of one all-null row,
  -- which crashed the Host Applicants screen (#6). Creators already hired on
  -- the gig appear only under Hired (round 2).
  SELECT CASE WHEN public.biz_is_brand_member_for_read(g.brand_id,auth.uid()) THEN coalesce(jsonb_agg(jsonb_build_object(
    'interest_id',i.id,'creator_id',i.creator_account_id,'display_name',p.display_name,'niches',p.niches,
    'follower_bands',(SELECT coalesce(jsonb_agg(jsonb_build_object('platform',h.platform,'band',h.follower_band,'verified',h.verified_at IS NOT NULL)),'[]'::jsonb) FROM public.creator_handles h WHERE h.creator_account_id=i.creator_account_id),
    'rating',CASE WHEN p.rating_count>0 THEN p.rating_avg_x100/100.0 END,'completed',p.completed_gigs,'reliability',p.reliability_bps,
    'quote_minor',i.quoted_minor,'currency',g.currency,'package_id',i.package_id,'note',i.note,'status',i.status
  ) ORDER BY i.created_at) FILTER (WHERE i.id IS NOT NULL),'[]'::jsonb) ELSE NULL END
  FROM public.gigs g
  LEFT JOIN public.gig_interest i ON i.gig_id=g.id AND NOT public.issue_3872_creator_hired_on_gig(g.id,i.creator_account_id)
  LEFT JOIN public.creator_profiles p ON p.creator_account_id=i.creator_account_id
  WHERE g.id=p_gig_id GROUP BY g.brand_id;
$fn$;

-- 4. Contract money state -------------------------------------------------
-- on_the_way: fee captured, work in progress (or a ledger share not yet due)
-- ready: released for payout, payout not confirmed
-- paid: the provider confirmed the payout
-- refunded / partially_refunded: the host's charge came back
-- NULL: no money has been captured yet (an unpaid offer).
CREATE OR REPLACE FUNCTION public.issue_3872_contract_money_state(p_contract_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
  SELECT CASE
    WHEN s.id IS NOT NULL THEN CASE
      WHEN s.status='paid' THEN 'paid'
      WHEN s.status IN ('pending','held_until_event') THEN 'on_the_way'
      WHEN s.status='reversed' THEN 'refunded'
      ELSE 'ready' END
    WHEN h.status='refunded' THEN 'refunded'
    WHEN h.status='partially_refunded' THEN 'partially_refunded'
    WHEN h.status='released' THEN 'ready'
    WHEN h.status='captured' THEN 'on_the_way'
  END
  FROM public.gig_contracts c
  LEFT JOIN public.gig_holds h ON h.contract_id=c.id AND h.terms_version=c.current_terms_version
  LEFT JOIN public.payee_shares s ON s.order_kind='gig' AND s.order_id=c.id AND s.payee_kind='gig_fee'
  WHERE c.id=p_contract_id;
$fn$;
REVOKE ALL ON FUNCTION public.issue_3872_contract_money_state(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_contract_money_state(uuid) TO service_role;

-- When the provider confirmed the creator's payout; NULL until it is paid.
CREATE OR REPLACE FUNCTION public.issue_3872_contract_money_paid_at(p_contract_id uuid) RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
  SELECT CASE WHEN s.status='paid' THEN coalesce(po.settled_at,s.updated_at) END
  FROM public.payee_shares s
  LEFT JOIN public.payee_payouts po ON po.id=s.payout_id
  WHERE s.order_kind='gig' AND s.order_id=p_contract_id AND s.payee_kind='gig_fee';
$fn$;
REVOKE ALL ON FUNCTION public.issue_3872_contract_money_paid_at(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_contract_money_paid_at(uuid) TO service_role;

-- The workspace now carries money_state and money_paid_at (round 2); everything else is unchanged.
CREATE OR REPLACE FUNCTION public.gig_contract_workspace(p_contract_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE v public.gig_contracts; v_party text; v_revealed boolean; v_result jsonb;
BEGIN
  SELECT * INTO v FROM public.gig_contracts WHERE id=p_contract_id; IF NOT FOUND THEN RETURN NULL; END IF;
  v_party:=CASE WHEN auth.uid()=v.creator_account_id THEN 'creator' WHEN public.biz_is_brand_member_for_read(v.brand_id,auth.uid()) THEN 'host' WHEN public.is_admin_user() THEN 'admin' ELSE NULL END;
  IF v_party IS NULL THEN RAISE EXCEPTION 'permission_denied' USING ERRCODE='42501'; END IF;
  IF v_party='creator' AND ((v.state='offered' AND NOT public.issue_3872_offer_ready(v.id)) OR v.cancel_reason IS NOT DISTINCT FROM 'payment_not_completed') THEN
    RAISE EXCEPTION 'offer_not_ready' USING ERRCODE='P0002';
  END IF;
  v_revealed:=v.state NOT IN ('offered','declined','expired','cancelled') AND EXISTS(SELECT 1 FROM public.gig_holds h WHERE h.contract_id=v.id AND h.terms_version=v.current_terms_version AND h.status IN ('captured','released','partially_refunded'));
  SELECT jsonb_build_object(
    'contract',to_jsonb(v),'party',v_party,'revealed',v_revealed,
    -- What acceptance reveals: who the host is and where the shoot happens.
    'reveal',CASE WHEN v_revealed THEN jsonb_build_object(
      'brand_name',(SELECT b.name FROM public.brands b WHERE b.id=v.brand_id),
      'place_name',(SELECT CASE WHEN g2.listing_kind='event' THEN (SELECT e.title FROM public.events e WHERE e.id=g2.listing_id) ELSE (SELECT vl.name FROM public.venue_listings vl WHERE vl.id=g2.listing_id) END FROM public.gigs g2 WHERE g2.id=v.gig_id),
      'place_address',(SELECT CASE WHEN g2.listing_kind='event' THEN (SELECT e.location_text FROM public.events e WHERE e.id=g2.listing_id) ELSE (SELECT vl.address FROM public.venue_listings vl WHERE vl.id=g2.listing_id) END FROM public.gigs g2 WHERE g2.id=v.gig_id)
    ) END,
    'next_action',public.issue_3872_creator_next_action(v.state),
    'pending_topup',(SELECT jsonb_build_object('terms_version',a.terms_version,'amount_minor',a.amount_minor,'currency',a.currency) FROM public.gig_hold_adjustments a WHERE a.contract_id=v.id AND a.kind='topup' AND a.status='pending'),
    'gig',jsonb_build_object('id',g.id,'title_public',g.title_public,'brief_public',g.brief_public,'brief_private',CASE WHEN v_revealed THEN g.brief_private END,'brand_id',CASE WHEN v_revealed THEN g.brand_id END,'listing_kind',CASE WHEN v_revealed THEN g.listing_kind END,'listing_id',CASE WHEN v_revealed THEN g.listing_id END,'must_tag',CASE WHEN v_revealed THEN g.must_tag END,'format_key',g.format_key,'post_by',g.post_by),
    'terms',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY version) FROM public.gig_terms_versions t WHERE t.contract_id=v.id),'[]'::jsonb),
    'proposals',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY created_at,id) FROM public.gig_change_proposals p WHERE p.contract_id=v.id),'[]'::jsonb),
    'events',coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY at,id) FROM public.gig_events e WHERE e.contract_id=v.id),'[]'::jsonb),
    'hold',(SELECT to_jsonb(h)-'provider_ref'-'idempotency_key' FROM public.gig_holds h WHERE h.contract_id=v.id AND h.terms_version=v.current_terms_version),
    'shoot_plan',(SELECT to_jsonb(s) FROM public.gig_shoot_plans s WHERE s.contract_id=v.id),
    'scripts',coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY version) FROM public.gig_scripts s WHERE s.contract_id=v.id),'[]'::jsonb),
    'deliveries',coalesce((SELECT jsonb_agg(to_jsonb(d) ORDER BY round) FROM public.gig_deliveries d WHERE d.contract_id=v.id),'[]'::jsonb),
    'posts',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY submitted_at,id) FROM public.gig_posts p WHERE p.contract_id=v.id),'[]'::jsonb),
    'dispute',(SELECT to_jsonb(d)||jsonb_build_object('offers',coalesce((SELECT jsonb_agg(to_jsonb(o) ORDER BY created_at,id) FROM public.gig_dispute_offers o WHERE o.dispute_id=d.id),'[]'::jsonb)) FROM public.gig_disputes d WHERE d.contract_id=v.id ORDER BY created_at DESC LIMIT 1),
    'ratings',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY rated_by) FROM public.gig_ratings r WHERE r.contract_id=v.id),'[]'::jsonb)
  ) INTO v_result FROM public.gigs g WHERE g.id=v.gig_id;
  RETURN v_result||jsonb_build_object('money_state',public.issue_3872_contract_money_state(v.id),
    'money_paid_at',public.issue_3872_contract_money_paid_at(v.id));
END;
$fn$

;

-- 5. Promotion overview for Blast -----------------------------------------
-- Everything promoting one listing (or the whole brand) in one read. Sales,
-- tickets and clicks come from accepted attributions (creator and promoter
-- links, codes, tracking links). Spend is what the host paid out for
-- promotion: creator fees net of refunds, referral rewards net of reversals,
-- and synced ad spend. Money sums only count the brand's currency.
CREATE OR REPLACE FUNCTION public.brand_promotion_overview(p_brand_id uuid,p_listing_kind text DEFAULT NULL,p_listing_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE
  v_actor uuid:=auth.uid(); v_kind text; v_id uuid; v_slug text; v_listing jsonb; v_listings jsonb; v_currency text; v_authority jsonb;
  v_sold bigint; v_tickets bigint; v_clicks bigint; v_spent bigint; v_campaigns jsonb; v_ads jsonb; v_creators jsonb; v_referrals jsonb;
  v_hired_out constant text[]:=ARRAY['offered','declined','expired','cancelled','resolved_refund'];
  v_ad_live constant text[]:=ARRAY['live','partially_live'];
  v_ad_draft constant text[]:=ARRAY['draft','validating','ready_for_funding','funding_pending','funded_held','staff_review_required','staff_approved',
    'changes_requested','creating_paused_objects','platform_review','scheduled','partially_ready','creation_failed_retryable'];
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='28000'; END IF;
  IF p_brand_id IS NULL OR NOT public.biz_is_brand_member_for_read(p_brand_id,v_actor) THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE='42501';
  END IF;

  IF p_listing_kind IS NOT NULL OR p_listing_id IS NOT NULL THEN
    v_kind:=lower(btrim(coalesce(p_listing_kind,''))); v_id:=p_listing_id;
    IF v_kind NOT IN ('event','venue') THEN RETURN jsonb_build_object('ok',false,'error','listing_required','field','listing_kind'); END IF;
    IF v_id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','listing_required','field','listing_id'); END IF;
    IF v_kind='event' THEN
      SELECT jsonb_build_object('kind','event','id',e.id,'title',e.title,
               'starts_at',(SELECT min(d.start_at) FROM public.event_dates d WHERE d.event_id=e.id)),e.slug
        INTO v_listing,v_slug
        FROM public.events e WHERE e.id=v_id AND e.brand_id=p_brand_id AND e.deleted_at IS NULL;
    ELSE
      SELECT jsonb_build_object('kind','venue','id',vl.id,'title',vl.name,'starts_at',NULL),vl.slug
        INTO v_listing,v_slug
        FROM public.venue_listings vl WHERE vl.id=v_id AND vl.brand_id=p_brand_id;
    END IF;
    IF v_listing IS NULL THEN RETURN jsonb_build_object('ok',false,'error','listing_not_found','field','listing_id'); END IF;
  END IF;

  -- Published listings the host can promote, newest first.
  SELECT coalesce(jsonb_agg(l.j ORDER BY l.sort_at DESC,l.id),'[]'::jsonb) INTO v_listings FROM (
    SELECT e.id,coalesce(e.published_at,e.created_at) AS sort_at,
      jsonb_build_object('kind','event','id',e.id,'title',e.title,'starts_at',(SELECT min(d.start_at) FROM public.event_dates d WHERE d.event_id=e.id)) AS j
    FROM public.events e
    WHERE e.brand_id=p_brand_id AND e.deleted_at IS NULL AND e.published_at IS NOT NULL AND e.status IN ('scheduled','live')
    UNION ALL
    SELECT vl.id,vl.created_at,jsonb_build_object('kind','venue','id',vl.id,'title',vl.name,'starts_at',NULL)
    FROM public.venue_listings vl WHERE vl.brand_id=p_brand_id AND vl.claim_status='verified'
  ) l;

  v_authority:=public.ad_brand_currency_authority(p_brand_id);
  v_currency:=CASE WHEN (v_authority->>'resolved')::boolean AND coalesce(v_authority->>'currency','') ~ '^[A-Z]{3}$' THEN v_authority->>'currency' END;
  IF v_currency IS NULL THEN
    SELECT CASE WHEN upper(btrim(coalesce(b.default_currency::text,''))) ~ '^[A-Z]{3}$' THEN upper(btrim(b.default_currency::text)) END
      INTO v_currency FROM public.brands b WHERE b.id=p_brand_id;
  END IF;
  v_currency:=coalesce(v_currency,'USD');

  -- Attributed sales.
  WITH att AS (
    SELECT a.order_kind,a.order_id,a.eligible_minor,
      CASE WHEN a.order_kind='ticket' THEN o.event_id END AS event_id,
      CASE WHEN a.order_kind='venue_order' THEN vo.venue_id END AS venue_id,
      upper(btrim(coalesce(o.currency::text,vo.currency,''))) AS currency,
      coalesce(o.payment_status,vo.payment_status) AS payment_status
    FROM public.order_attributions a
    LEFT JOIN public.orders o ON a.order_kind='ticket' AND o.id=a.order_id
    LEFT JOIN public.venue_orders vo ON a.order_kind='venue_order' AND vo.id=a.order_id
    WHERE a.brand_id=p_brand_id AND a.rejected_reason IS NULL AND a.source<>'none'
  ), scoped AS (
    SELECT * FROM att
    WHERE coalesce(payment_status,'paid') NOT IN ('refunded','cancelled','failed')
      AND (v_kind IS NULL OR (v_kind='event' AND event_id=v_id) OR (v_kind='venue' AND venue_id=v_id))
  )
  SELECT coalesce(sum(eligible_minor) FILTER (WHERE currency=v_currency),0),
    coalesce((SELECT count(*) FROM public.tickets t WHERE t.order_id IN (SELECT s.order_id FROM scoped s WHERE s.order_kind='ticket')
      AND t.status IN ('valid','used','transferred')),0)
  INTO v_sold,v_tickets FROM scoped;

  SELECT count(*) INTO v_clicks FROM public.attribution_touches t
   WHERE t.brand_id=p_brand_id AND (v_kind IS NULL OR (t.listing_kind=v_kind AND t.listing_id=v_id));

  -- Spend: creator fees (captured charges and top-ups, net of refunds).
  SELECT coalesce(sum(m.amount),0) INTO v_spent FROM (
    SELECT h.amount_minor-h.refunded_minor AS amount
    FROM public.gig_contracts c JOIN public.gigs g ON g.id=c.gig_id
    JOIN public.gig_holds h ON h.contract_id=c.id AND h.status IN ('captured','released','partially_refunded')
    WHERE c.brand_id=p_brand_id AND upper(h.currency)=v_currency
      AND (v_kind IS NULL OR (g.listing_kind=v_kind AND g.listing_id=v_id))
    UNION ALL
    SELECT a.amount_minor-a.refunded_minor
    FROM public.gig_contracts c JOIN public.gigs g ON g.id=c.gig_id
    JOIN public.gig_hold_adjustments a ON a.contract_id=c.id AND a.kind='topup' AND a.status IN ('captured','released','partially_refunded')
    WHERE c.brand_id=p_brand_id AND upper(a.currency)=v_currency
      AND (v_kind IS NULL OR (g.listing_kind=v_kind AND g.listing_id=v_id))
    UNION ALL
    -- Referral rewards owed or paid on this brand's orders.
    SELECT greatest(s.gross_minor-s.reversed_minor,0)
    FROM public.payee_shares s
    LEFT JOIN public.orders o ON s.order_kind='ticket' AND o.id=s.order_id
    LEFT JOIN public.venue_orders vo ON s.order_kind='venue_order' AND vo.id=s.order_id
    WHERE s.brand_id=p_brand_id AND s.payee_kind='referral' AND s.status NOT IN ('reversed','unclaimed_expired') AND upper(s.currency)=v_currency
      AND (v_kind IS NULL OR (v_kind='event' AND o.event_id=v_id) OR (v_kind='venue' AND vo.venue_id=v_id))
    UNION ALL
    -- Ad spend synced from the ad platforms.
    SELECT sd.spend_cents
    FROM public.ad_campaigns ac JOIN public.ad_spend_daily sd ON sd.campaign_id=ac.id
    WHERE ac.brand_id=p_brand_id AND upper(coalesce(sd.currency,''))=v_currency
      AND (v_kind IS NULL OR (v_kind='event' AND ac.dest_event_id=v_id) OR (v_kind='venue' AND ac.dest_venue_id=v_id))
  ) m;

  -- Campaigns: a listing is in a campaign when the message embeds it
  -- (the {{event:<id>}} card carries the listing id).
  SELECT jsonb_build_object('sent',count(*) FILTER (WHERE mc.status='sent'),'last_sent_at',max(mc.sent_at) FILTER (WHERE mc.status='sent'))
    INTO v_campaigns
    FROM public.marketing_campaigns mc
   WHERE mc.brand_id=p_brand_id AND (v_kind IS NULL OR position(v_id::text IN mc.channel_payload::text)>0);

  -- Ads: the host's ad plans; a listing plan's destination ends in its slug.
  SELECT jsonb_build_object(
      'live',count(*) FILTER (WHERE ap.state=ANY(v_ad_live)),
      'draft',count(*) FILTER (WHERE ap.state=ANY(v_ad_draft)),
      'needs_setup',NOT coalesce((v_authority->>'resolved')::boolean,false)
        OR EXISTS(SELECT 1 FROM public.ad_credit_wallets w WHERE w.brand_id=p_brand_id
                  AND (w.currency_status<>'aligned' OR w.currency IS DISTINCT FROM v_authority->>'currency')))
    INTO v_ads
    FROM public.ad_plans ap
   WHERE ap.owner_kind='host' AND ap.brand_id=p_brand_id
     AND (v_kind IS NULL OR (v_slug IS NOT NULL AND split_part(ap.destination_key,':',3)=v_slug
          AND split_part(ap.destination_key,':',1)=ANY(CASE WHEN v_kind='event' THEN ARRAY['event','rsvp','trip','experience'] ELSE ARRAY['venue','reservation'] END)));

  SELECT jsonb_build_object(
      'gigs_live',(SELECT count(*) FROM public.gigs g WHERE g.brand_id=p_brand_id AND g.status='open'
         AND (v_kind IS NULL OR (g.listing_kind=v_kind AND g.listing_id=v_id))),
      'interested',(SELECT count(*) FROM public.gig_interest i JOIN public.gigs g ON g.id=i.gig_id
         WHERE g.brand_id=p_brand_id AND i.status IN ('sent','shortlisted') AND g.status='open'
           AND NOT public.issue_3872_creator_hired_on_gig(g.id,i.creator_account_id)
           AND (v_kind IS NULL OR (g.listing_kind=v_kind AND g.listing_id=v_id))),
      'hired',(SELECT count(*) FROM public.gig_contracts c JOIN public.gigs g ON g.id=c.gig_id
         WHERE c.brand_id=p_brand_id AND NOT (c.state=ANY(v_hired_out))
           AND (v_kind IS NULL OR (g.listing_kind=v_kind AND g.listing_id=v_id))),
      'paid',(SELECT count(*) FROM public.gig_contracts c JOIN public.gigs g ON g.id=c.gig_id
         WHERE c.brand_id=p_brand_id AND public.issue_3872_contract_money_state(c.id)='paid'
           AND (v_kind IS NULL OR (g.listing_kind=v_kind AND g.listing_id=v_id)))
    ) INTO v_creators;

  WITH live_offers AS (
    SELECT ro.id FROM public.referral_offers ro
     WHERE ro.brand_id=p_brand_id AND ro.status='active' AND ro.deleted_at IS NULL
       AND ro.starts_at<=now() AND (ro.ends_at IS NULL OR ro.ends_at>now())
       AND (v_kind IS NULL OR ro.scope_kind='brand'
            OR EXISTS(SELECT 1 FROM public.referral_offer_listings rl WHERE rl.offer_id=ro.id AND rl.listing_kind=v_kind AND rl.listing_id=v_id))
  )
  SELECT jsonb_build_object(
      'offers_live',(SELECT count(*) FROM live_offers),
      'promoters',(SELECT count(DISTINCT coalesce(m.user_id::text,m.email_norm,m.id::text)) FROM public.referral_members m
         WHERE m.offer_id IN (SELECT id FROM live_offers) AND m.role='promoter' AND m.status='active'))
    INTO v_referrals;

  RETURN jsonb_build_object(
    'ok',true,'listings',v_listings,'listing',v_listing,'currency',v_currency,
    'sold_minor',v_sold,'tickets',v_tickets,'clicks',v_clicks,'spent_minor',v_spent,
    'campaigns',v_campaigns,'ads',v_ads,'creators',v_creators,'referrals',v_referrals);
END;
$fn$;
REVOKE ALL ON FUNCTION public.brand_promotion_overview(uuid,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.brand_promotion_overview(uuid,text,uuid) TO authenticated,service_role;

COMMIT;
