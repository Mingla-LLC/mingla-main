-- #4216 — versioned Creator agreement and paid-up perpetual gig rights.
--
BEGIN;
SET LOCAL lock_timeout='10s';

CREATE TABLE public.creator_agreement_versions (
  version text PRIMARY KEY CHECK(char_length(btrim(version)) BETWEEN 1 AND 80),
  document_url text NOT NULL CHECK(document_url~'^https://[^[:space:]]+$'),
  document_sha256 text NOT NULL CHECK(document_sha256~'^[0-9a-f]{64}$'),
  effective_at timestamptz NOT NULL,
  is_current boolean NOT NULL DEFAULT false,
  retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT creator_agreement_current_shape CHECK(NOT is_current OR retired_at IS NULL)
);
CREATE UNIQUE INDEX creator_agreement_one_current_uq
  ON public.creator_agreement_versions(is_current) WHERE is_current;

INSERT INTO public.creator_agreement_versions(
  version,document_url,document_sha256,effective_at,is_current
) VALUES(
  'creator-v1',
  'https://usemingla.com/creator-agreement',
  '5f3a9bf9a3dd9a938b25730f7c2fa5c046ea8151dba5f3c63602c7aaacf23a96',
  '2026-10-31T00:00:00Z'::timestamptz,
  true
);

CREATE TABLE public.creator_agreement_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_account_id uuid NOT NULL REFERENCES public.creator_accounts(id) ON DELETE RESTRICT,
  agreement_version text NOT NULL REFERENCES public.creator_agreement_versions(version) ON DELETE RESTRICT,
  document_url text NOT NULL CHECK(document_url~'^https://[^[:space:]]+$'),
  document_sha256 text NOT NULL CHECK(document_sha256~'^[0-9a-f]{64}$'),
  accepted_at timestamptz NOT NULL DEFAULT now(),
  evidence jsonb NOT NULL DEFAULT '{"method":"creator_app_clickwrap"}'::jsonb
    CHECK(jsonb_typeof(evidence)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(creator_account_id,agreement_version)
);

ALTER TABLE public.creator_profiles
  ADD COLUMN agreement_acceptance_id uuid UNIQUE
    REFERENCES public.creator_agreement_acceptances(id) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION public.issue_4216_creator_agreement_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $fn$
BEGIN
  RAISE EXCEPTION 'creator_agreement_acceptance_immutable' USING ERRCODE='55000';
END;
$fn$;
CREATE TRIGGER issue_4216_creator_agreement_immutable
BEFORE UPDATE OR DELETE ON public.creator_agreement_acceptances
FOR EACH ROW EXECUTE FUNCTION public.issue_4216_creator_agreement_immutable();

CREATE OR REPLACE FUNCTION public.issue_4216_creator_agreement_version_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $fn$
BEGIN
  IF TG_OP='DELETE'
    OR NEW.version IS DISTINCT FROM OLD.version
    OR NEW.document_url IS DISTINCT FROM OLD.document_url
    OR NEW.document_sha256 IS DISTINCT FROM OLD.document_sha256
    OR NEW.effective_at IS DISTINCT FROM OLD.effective_at THEN
    RAISE EXCEPTION 'creator_agreement_version_immutable' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER issue_4216_creator_agreement_version_guard
BEFORE UPDATE OR DELETE ON public.creator_agreement_versions
FOR EACH ROW EXECUTE FUNCTION public.issue_4216_creator_agreement_version_guard();

ALTER TABLE public.creator_agreement_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creator_agreement_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.creator_agreement_acceptances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creator_agreement_acceptances FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.creator_agreement_versions,public.creator_agreement_acceptances
  FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.creator_agreement_versions,public.creator_agreement_acceptances TO service_role;

CREATE OR REPLACE FUNCTION public.issue_4216_creator_has_current_agreement(
  p_creator_account_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
  SELECT EXISTS(
    SELECT 1
    FROM public.creator_profiles p
    JOIN public.creator_agreement_acceptances a
      ON a.id=p.agreement_acceptance_id
     AND a.creator_account_id=p.creator_account_id
    JOIN public.creator_agreement_versions v
      ON v.version=a.agreement_version
     AND v.document_url=a.document_url
     AND v.document_sha256=a.document_sha256
    WHERE p.creator_account_id=p_creator_account_id
      AND p.agreement_version=a.agreement_version
      AND p.agreement_signed_at=a.accepted_at
      AND v.is_current AND v.retired_at IS NULL AND v.effective_at<=now()
  )
$fn$;

CREATE OR REPLACE FUNCTION public.creator_current_agreement()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
  SELECT jsonb_build_object(
    'version',v.version,'document_url',v.document_url,
    'document_sha256',v.document_sha256,'effective_at',v.effective_at,
    'accepted',coalesce(public.issue_4216_creator_has_current_agreement(auth.uid()),false)
  )
  FROM public.creator_agreement_versions v
  WHERE v.is_current AND v.retired_at IS NULL AND v.effective_at<=now()
$fn$;
REVOKE ALL ON FUNCTION public.creator_current_agreement() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.creator_current_agreement() TO authenticated,service_role;

DROP FUNCTION IF EXISTS public.creator_agreement_sign(text,date);
DROP FUNCTION IF EXISTS public.creator_agreement_sign(text);
CREATE OR REPLACE FUNCTION public.creator_agreement_sign(p_date_of_birth date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE
  v_actor uuid:=auth.uid();
  v_agreement public.creator_agreement_versions;
  v_acceptance public.creator_agreement_acceptances;
  v_result jsonb;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='28000'; END IF;
  IF p_date_of_birth IS NULL THEN
    RETURN jsonb_build_object('ok',false,'error','date_of_birth_required','field','date_of_birth');
  END IF;
  IF p_date_of_birth<DATE '1900-01-01' OR p_date_of_birth>current_date THEN
    RETURN jsonb_build_object('ok',false,'error','date_of_birth_invalid','field','date_of_birth');
  END IF;
  IF p_date_of_birth>(current_date-interval '18 years')::date THEN
    RETURN jsonb_build_object('ok',false,'error','must_be_18','field','date_of_birth');
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.creator_profiles WHERE creator_account_id=v_actor) THEN
    RAISE EXCEPTION 'creator_profile_required' USING ERRCODE='P0002';
  END IF;
  SELECT * INTO v_agreement FROM public.creator_agreement_versions
  WHERE is_current AND retired_at IS NULL AND effective_at<=now();
  IF NOT FOUND THEN RAISE EXCEPTION 'creator_agreement_not_available' USING ERRCODE='55000'; END IF;

  SELECT * INTO v_acceptance FROM public.creator_agreement_acceptances
  WHERE creator_account_id=v_actor AND agreement_version=v_agreement.version;
  IF NOT FOUND THEN
    INSERT INTO public.creator_agreement_acceptances(
      creator_account_id,agreement_version,document_url,document_sha256
    ) VALUES(
      v_actor,v_agreement.version,v_agreement.document_url,v_agreement.document_sha256
    ) RETURNING * INTO v_acceptance;
  END IF;
  UPDATE public.creator_profiles SET
    agreement_version=v_acceptance.agreement_version,
    agreement_signed_at=v_acceptance.accepted_at,
    agreement_acceptance_id=v_acceptance.id,
    date_of_birth=p_date_of_birth
  WHERE creator_account_id=v_actor;
  v_result:=public.issue_3872_recompute_creator_verification(v_actor,false);
  RETURN jsonb_build_object(
    'ok',true,'agreement_version',v_acceptance.agreement_version,
    'agreement_url',v_acceptance.document_url,'accepted_at',v_acceptance.accepted_at,
    'verification',v_result
  );
END;
$fn$;
REVOKE ALL ON FUNCTION public.creator_agreement_sign(date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.creator_agreement_sign(date) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.issue_3872_recompute_creator_verification(
  p_creator_account_id uuid,p_signal_conflict boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE
  v_profile public.creator_profiles; v_reasons text[]:='{}';
  v_has_handle boolean; v_age_ok boolean; v_payee_ok boolean;
  v_showcase_ok boolean; v_agreement_ok boolean; v_next text;
BEGIN
  SELECT * INTO v_profile FROM public.creator_profiles
   WHERE creator_account_id=p_creator_account_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'creator_profile_not_found' USING ERRCODE='P0002'; END IF;
  SELECT EXISTS(SELECT 1 FROM public.creator_handles WHERE creator_account_id=p_creator_account_id AND verified_at IS NOT NULL AND NOT review_required) INTO v_has_handle;
  v_age_ok:=v_profile.date_of_birth IS NOT NULL AND v_profile.date_of_birth<=(current_date-interval '18 years')::date;
  SELECT EXISTS(SELECT 1 FROM public.payee_accounts WHERE user_id=p_creator_account_id AND (stripe_status='active' OR paystack_status='verified')) INTO v_payee_ok;
  SELECT EXISTS(SELECT 1 FROM public.creator_media_jobs WHERE owner_kind='creator' AND owner_id=p_creator_account_id AND purpose='showcase' AND status='ready' AND deleted_at IS NULL) INTO v_showcase_ok;
  v_agreement_ok:=public.issue_4216_creator_has_current_agreement(p_creator_account_id);
  IF NOT v_has_handle THEN v_reasons:=array_append(v_reasons,'verified_handle'); END IF;
  IF NOT v_age_ok THEN v_reasons:=array_append(v_reasons,'age_18_plus'); END IF;
  IF NOT v_payee_ok THEN v_reasons:=array_append(v_reasons,'active_payout'); END IF;
  IF NOT v_showcase_ok THEN v_reasons:=array_append(v_reasons,'processed_showcase'); END IF;
  IF NOT v_agreement_ok THEN v_reasons:=array_append(v_reasons,'signed_agreement'); END IF;
  v_next:=CASE
    WHEN v_profile.verification IN ('declined','suspended') THEN v_profile.verification
    WHEN p_signal_conflict OR EXISTS(SELECT 1 FROM public.creator_handles WHERE creator_account_id=p_creator_account_id AND review_required) THEN 'review'
    WHEN v_profile.verification='needs_more' THEN CASE WHEN cardinality(v_reasons)=0 THEN 'review' ELSE 'needs_more' END
    WHEN v_profile.verification='review' AND v_profile.reviewed_at IS NOT NULL THEN 'review'
    WHEN cardinality(v_reasons)=0 THEN 'verified'
    ELSE 'incomplete' END;
  UPDATE public.creator_profiles SET verification=v_next,verification_reasons=v_reasons
   WHERE creator_account_id=p_creator_account_id RETURNING * INTO v_profile;
  RETURN jsonb_build_object('verification',v_profile.verification,'missing',v_profile.verification_reasons);
END;
$fn$;

-- Re-consent is deliberate: a legacy client-supplied version string is not an
-- acceptance of this fingerprinted agreement. Existing Creator profiles are
-- recomputed now so setup truth and board access agree immediately.
DO $do$
DECLARE v_id uuid;
BEGIN
  FOR v_id IN SELECT creator_account_id FROM public.creator_profiles LOOP
    PERFORM public.issue_3872_recompute_creator_verification(v_id,false);
  END LOOP;
END;
$do$;

CREATE OR REPLACE FUNCTION public.issue_3872_creator_checks(p_creator_account_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
  SELECT jsonb_build_array(
    jsonb_build_object('key','profile','label','Your profile','done',p.creator_account_id IS NOT NULL),
    jsonb_build_object('key','rates','label','Your rates','done',EXISTS(SELECT 1 FROM public.creator_packages k WHERE k.creator_account_id=p_creator_account_id AND k.active)),
    jsonb_build_object('key','showcase','label','Showcase video','done',EXISTS(SELECT 1 FROM public.creator_media_jobs m WHERE m.owner_kind='creator' AND m.owner_id=p_creator_account_id AND m.purpose='showcase' AND m.status='ready' AND m.deleted_at IS NULL)),
    jsonb_build_object('key','socials','label','Verified social account','done',EXISTS(SELECT 1 FROM public.creator_handles h WHERE h.creator_account_id=p_creator_account_id AND h.verified_at IS NOT NULL AND NOT h.review_required)),
    jsonb_build_object('key','payout','label','Payout account','done',EXISTS(SELECT 1 FROM public.payee_accounts a WHERE a.user_id=p_creator_account_id AND (a.stripe_status='active' OR a.paystack_status='verified'))),
    jsonb_build_object('key','agreement','label','Creator agreement','done',coalesce(public.issue_4216_creator_has_current_agreement(p_creator_account_id) AND p.date_of_birth IS NOT NULL AND p.date_of_birth<=(current_date-interval '18 years')::date,false))
  ) FROM (SELECT 1) one LEFT JOIN public.creator_profiles p ON p.creator_account_id=p_creator_account_id;
$fn$;

-- Existing rows retain the exact timed licence they were formed under. New
-- rows default to the Creator-v1 perpetual licence and freeze its source.
ALTER TABLE public.gigs
  ADD COLUMN rights_model text,
  ADD COLUMN agreement_version text REFERENCES public.creator_agreement_versions(version) ON DELETE RESTRICT,
  ADD COLUMN agreement_document_url text,
  ADD COLUMN agreement_document_sha256 text;
UPDATE public.gigs SET rights_model='legacy_timed' WHERE rights_model IS NULL;
ALTER TABLE public.gigs
  ALTER COLUMN rights_model SET DEFAULT 'creator_v1_perpetual',
  ALTER COLUMN rights_model SET NOT NULL,
  ADD CONSTRAINT gigs_rights_model_check CHECK(rights_model IN ('legacy_timed','creator_v1_perpetual')),
  ADD CONSTRAINT gigs_rights_snapshot_shape CHECK(
    (rights_model='legacy_timed' AND agreement_version IS NULL AND agreement_document_url IS NULL AND agreement_document_sha256 IS NULL)
    OR (rights_model='creator_v1_perpetual' AND agreement_version IS NOT NULL AND agreement_document_url IS NOT NULL AND agreement_document_sha256~'^[0-9a-f]{64}$')
  );

ALTER TABLE public.gig_contracts
  ADD COLUMN rights_model text,
  ADD COLUMN agreement_version text REFERENCES public.creator_agreement_versions(version) ON DELETE RESTRICT,
  ADD COLUMN agreement_document_url text,
  ADD COLUMN agreement_document_sha256 text,
  ADD COLUMN host_rights_accepted_at timestamptz,
  ADD COLUMN creator_agreement_acceptance_id uuid REFERENCES public.creator_agreement_acceptances(id) ON DELETE RESTRICT,
  ADD COLUMN creator_rights_accepted_at timestamptz,
  ADD COLUMN rights_activated_at timestamptz;
UPDATE public.gig_contracts SET rights_model='legacy_timed' WHERE rights_model IS NULL;
ALTER TABLE public.gig_contracts
  ALTER COLUMN rights_model SET DEFAULT 'creator_v1_perpetual',
  ALTER COLUMN rights_model SET NOT NULL,
  ADD CONSTRAINT gig_contracts_rights_model_check CHECK(rights_model IN ('legacy_timed','creator_v1_perpetual')),
  ADD CONSTRAINT gig_contracts_creator_rights_pair CHECK((creator_agreement_acceptance_id IS NULL)=(creator_rights_accepted_at IS NULL));

ALTER TABLE public.gig_terms_versions ADD COLUMN rights_model text;
UPDATE public.gig_terms_versions SET rights_model='legacy_timed' WHERE rights_model IS NULL;
ALTER TABLE public.gig_terms_versions
  ALTER COLUMN rights_model SET NOT NULL,
  ADD CONSTRAINT gig_terms_rights_model_check CHECK(rights_model IN ('legacy_timed','creator_v1_perpetual'));

CREATE OR REPLACE FUNCTION public.issue_4216_gig_rights_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_agreement public.creator_agreement_versions;
BEGIN
  IF TG_OP='INSERT' AND NEW.rights_model='creator_v1_perpetual' THEN
    SELECT * INTO v_agreement FROM public.creator_agreement_versions
    WHERE is_current AND retired_at IS NULL AND effective_at<=now();
    IF NOT FOUND THEN RAISE EXCEPTION 'creator_agreement_not_available' USING ERRCODE='55000'; END IF;
    NEW.agreement_version:=v_agreement.version;
    NEW.agreement_document_url:=v_agreement.document_url;
    NEW.agreement_document_sha256:=v_agreement.document_sha256;
    NEW.usage_days:=90; -- legacy storage sentinel; not shown or negotiated.
  ELSIF TG_OP='UPDATE' THEN
    IF (NEW.rights_model,NEW.agreement_version,NEW.agreement_document_url,NEW.agreement_document_sha256)
       IS DISTINCT FROM (OLD.rights_model,OLD.agreement_version,OLD.agreement_document_url,OLD.agreement_document_sha256) THEN
      RAISE EXCEPTION 'gig_rights_snapshot_immutable' USING ERRCODE='55000';
    END IF;
    IF OLD.rights_model='creator_v1_perpetual' AND NEW.usage_days IS DISTINCT FROM OLD.usage_days THEN
      RAISE EXCEPTION 'creator_rights_not_negotiable' USING ERRCODE='55000';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER issue_4216_gig_rights_guard
BEFORE INSERT OR UPDATE ON public.gigs
FOR EACH ROW EXECUTE FUNCTION public.issue_4216_gig_rights_guard();

CREATE OR REPLACE FUNCTION public.issue_4216_interest_agreement_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
BEGIN
  IF (SELECT rights_model FROM public.gigs WHERE id=NEW.gig_id)='creator_v1_perpetual'
     AND NOT public.issue_4216_creator_has_current_agreement(NEW.creator_account_id) THEN
    RAISE EXCEPTION 'current_creator_agreement_required' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER issue_4216_interest_agreement_guard
BEFORE INSERT ON public.gig_interest
FOR EACH ROW EXECUTE FUNCTION public.issue_4216_interest_agreement_guard();

-- The checkbox is evidence, not decoration. Keep the existing offer builder
-- behind a server wrapper so direct callers cannot create a Creator-v1 offer
-- without explicitly accepting the standard rights term.
ALTER FUNCTION public.gig_offer_prepare(uuid,jsonb,text)
  RENAME TO issue_4216_gig_offer_prepare_impl;
CREATE OR REPLACE FUNCTION public.gig_offer_prepare(
  p_interest_id uuid,p_terms jsonb,p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_perpetual boolean;
BEGIN
  SELECT g.rights_model='creator_v1_perpetual' INTO v_perpetual
  FROM public.gig_interest i JOIN public.gigs g ON g.id=i.gig_id
  WHERE i.id=p_interest_id;
  IF coalesce(v_perpetual,false)
     AND coalesce((p_terms->>'rights_accepted')::boolean,false) IS NOT TRUE THEN
    RETURN jsonb_build_object('ok',false,'error','creator_rights_acceptance_required');
  END IF;
  PERFORM set_config('issue4216.host_rights_accepted','on',true);
  RETURN public.issue_4216_gig_offer_prepare_impl(
    p_interest_id,p_terms-'rights_accepted',p_idempotency_key
  );
END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_4216_gig_offer_prepare_impl(uuid,jsonb,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4216_gig_offer_prepare_impl(uuid,jsonb,text)
  TO service_role;
REVOKE ALL ON FUNCTION public.gig_offer_prepare(uuid,jsonb,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.gig_offer_prepare(uuid,jsonb,text)
  TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.issue_4216_contract_rights_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_gig public.gigs; v_acceptance public.creator_agreement_acceptances;
BEGIN
  IF TG_OP='INSERT' THEN
    SELECT * INTO v_gig FROM public.gigs WHERE id=NEW.gig_id;
    NEW.rights_model:=v_gig.rights_model;
    NEW.agreement_version:=v_gig.agreement_version;
    NEW.agreement_document_url:=v_gig.agreement_document_url;
    NEW.agreement_document_sha256:=v_gig.agreement_document_sha256;
    NEW.rights_activated_at:=NULL;
    IF NEW.rights_model='creator_v1_perpetual' THEN
      IF current_setting('issue4216.host_rights_accepted',true)<>'on' THEN
        RAISE EXCEPTION 'creator_rights_acceptance_required' USING ERRCODE='42501';
      END IF;
      NEW.host_rights_accepted_at:=now();
    END IF;
  ELSE
    IF (NEW.rights_model,NEW.agreement_version,NEW.agreement_document_url,NEW.agreement_document_sha256,NEW.host_rights_accepted_at)
       IS DISTINCT FROM (OLD.rights_model,OLD.agreement_version,OLD.agreement_document_url,OLD.agreement_document_sha256,OLD.host_rights_accepted_at) THEN
      RAISE EXCEPTION 'contract_rights_snapshot_immutable' USING ERRCODE='55000';
    END IF;
    IF OLD.state='offered' AND NEW.state='accepted' AND OLD.rights_model='creator_v1_perpetual' THEN
      SELECT a.* INTO v_acceptance
      FROM public.creator_profiles p
      JOIN public.creator_agreement_acceptances a ON a.id=p.agreement_acceptance_id
      WHERE p.creator_account_id=NEW.creator_account_id
        AND a.agreement_version=NEW.agreement_version
        AND a.document_url=NEW.agreement_document_url
        AND a.document_sha256=NEW.agreement_document_sha256;
      IF NOT FOUND THEN RAISE EXCEPTION 'contract_creator_agreement_required' USING ERRCODE='42501'; END IF;
      NEW.creator_agreement_acceptance_id:=v_acceptance.id;
      NEW.creator_rights_accepted_at:=now();
    ELSIF (NEW.creator_agreement_acceptance_id,NEW.creator_rights_accepted_at)
       IS DISTINCT FROM (OLD.creator_agreement_acceptance_id,OLD.creator_rights_accepted_at) THEN
      RAISE EXCEPTION 'contract_creator_rights_immutable' USING ERRCODE='55000';
    END IF;
    IF NEW.rights_activated_at IS DISTINCT FROM OLD.rights_activated_at
       AND (OLD.rights_activated_at IS NOT NULL
         OR current_setting('issue4216.activate_rights',true)<>OLD.id::text) THEN
      RAISE EXCEPTION 'contract_rights_activation_immutable' USING ERRCODE='55000';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER issue_4216_contract_rights_guard
BEFORE INSERT OR UPDATE ON public.gig_contracts
FOR EACH ROW EXECUTE FUNCTION public.issue_4216_contract_rights_guard();

-- Activation is a one-way historical fact. The licence is irrevocable once
-- the authoritative release path has released the full fixed Creator fee;
-- a later chargeback or refund cannot make the recorded grant disappear.
ALTER FUNCTION public.gig_release_record(uuid,text)
  RENAME TO issue_4216_gig_release_record_impl;
CREATE OR REPLACE FUNCTION public.gig_release_record(
  p_contract_id uuid,p_provider_ref text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_result jsonb; v_model text; v_activated timestamptz;
BEGIN
  v_result:=public.issue_4216_gig_release_record_impl(
    p_contract_id,p_provider_ref
  );
  SELECT rights_model INTO v_model FROM public.gig_contracts
  WHERE id=p_contract_id;
  IF v_model='creator_v1_perpetual' AND coalesce((v_result->>'ok')::boolean,false) THEN
    PERFORM set_config('issue4216.activate_rights',p_contract_id::text,true);
    UPDATE public.gig_contracts c SET rights_activated_at=coalesce(c.rights_activated_at,now())
    WHERE c.id=p_contract_id
      AND c.host_rights_accepted_at IS NOT NULL
      AND c.creator_agreement_acceptance_id IS NOT NULL
      AND c.creator_rights_accepted_at IS NOT NULL
      AND c.state NOT IN ('declined','expired','cancelled','resolved_refund','resolved_partial')
      AND EXISTS(
        SELECT 1 FROM public.gig_terms_versions t
        JOIN public.gig_holds h ON h.contract_id=c.id
          AND h.terms_version=t.version AND h.status='released'
          AND h.refunded_minor=0
        JOIN public.payee_shares s ON s.order_kind='gig'
          AND s.order_id=c.id AND s.payee_kind='gig_fee'
          AND s.gross_minor=t.fee_minor AND s.reversed_minor=0
        WHERE t.contract_id=c.id AND t.version=c.current_terms_version
      )
    RETURNING rights_activated_at INTO v_activated;
    IF v_activated IS NULL THEN
      RAISE EXCEPTION 'creator_rights_activation_failed' USING ERRCODE='55000';
    END IF;
  END IF;
  RETURN v_result;
END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_4216_gig_release_record_impl(uuid,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4216_gig_release_record_impl(uuid,text)
  TO service_role;
REVOKE ALL ON FUNCTION public.gig_release_record(uuid,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gig_release_record(uuid,text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.issue_4216_terms_rights_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_model text;
BEGIN
  SELECT rights_model INTO v_model FROM public.gig_contracts WHERE id=NEW.contract_id;
  IF TG_OP='INSERT' THEN
    NEW.rights_model:=v_model;
    IF v_model='creator_v1_perpetual' THEN NEW.usage_days:=90; END IF;
  ELSIF OLD.rights_model='creator_v1_perpetual' AND NEW.usage_days IS DISTINCT FROM OLD.usage_days THEN
    RAISE EXCEPTION 'creator_rights_not_negotiable' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER issue_4216_terms_rights_guard
BEFORE INSERT OR UPDATE ON public.gig_terms_versions
FOR EACH ROW EXECUTE FUNCTION public.issue_4216_terms_rights_guard();

CREATE OR REPLACE FUNCTION public.issue_4216_proposal_rights_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
BEGIN
  IF NEW.changes ? 'usage_days' AND EXISTS(
    SELECT 1 FROM public.gig_contracts c
    WHERE c.id=NEW.contract_id AND c.rights_model='creator_v1_perpetual'
  ) THEN
    RAISE EXCEPTION 'creator_rights_not_negotiable' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER issue_4216_proposal_rights_guard
BEFORE INSERT OR UPDATE ON public.gig_change_proposals
FOR EACH ROW EXECUTE FUNCTION public.issue_4216_proposal_rights_guard();

CREATE OR REPLACE FUNCTION public.issue_3872_public_gig_json(p_gig_id uuid,p_viewer uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
  SELECT jsonb_build_object(
    'id',g.id,'title_public',g.title_public,'brief_public',g.brief_public,'format_key',g.format_key,
    'deliverables',g.deliverables,'city_name',c.name,'category',g.category,
    'shoot_window',jsonb_build_object('start',g.shoot_window_start,'end',g.shoot_window_end),
    'post_by',g.post_by,'video_due_at',g.video_due_at,'shoot_at',g.shoot_at,
    'usage_days',g.usage_days,'pay_up_to_minor',g.pay_up_to_minor,'currency',g.currency,
    'rights_model',g.rights_model,'agreement_version',g.agreement_version,
    'agreement_url',g.agreement_document_url,
    'sales_share_bps',g.sales_share_bps,'slots_left',public.issue_3872_gig_slots_left(g.id),
    'saved',EXISTS(SELECT 1 FROM public.creator_saved_gigs s WHERE s.gig_id=g.id AND s.creator_account_id=p_viewer)
  )
  FROM public.gigs g JOIN public.seeding_cities c ON c.id=g.city_id
  WHERE g.id=p_gig_id;
$fn$;

CREATE OR REPLACE FUNCTION public.gig_rights_status(p_contract_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v public.gig_contracts; v_terms public.gig_terms_versions; v_active boolean;
BEGIN
  SELECT * INTO v FROM public.gig_contracts WHERE id=p_contract_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF auth.uid() IS NOT NULL
    AND auth.uid()<>v.creator_account_id
    AND NOT public.biz_is_brand_member_for_read(v.brand_id,auth.uid())
    AND NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_terms FROM public.gig_terms_versions
  WHERE contract_id=v.id AND version=v.current_terms_version;
  IF v.rights_model='legacy_timed' THEN
    RETURN jsonb_build_object(
      'model','legacy_timed','status','legacy','usage_days',v_terms.usage_days,
      'label','Legacy timed licence','agreement_version',NULL
    );
  END IF;
  v_active:=v.rights_activated_at IS NOT NULL;
  RETURN jsonb_build_object(
    'model','creator_v1_perpetual',
    'status',CASE
      WHEN v_active THEN 'active'
      WHEN v.state IN ('declined','expired','cancelled','resolved_refund','resolved_partial') THEN 'not_granted'
      ELSE 'pending' END,
    'label',CASE
      WHEN v_active THEN 'Perpetual marketing rights active'
      WHEN v.state IN ('declined','expired','cancelled','resolved_refund','resolved_partial') THEN 'Marketing rights not granted'
      ELSE 'Rights activate after the full Creator fee is released' END,
    'holder','Mingla and the paying Host',
    'organic',true,'paid_ads',true,'editing',true,
    'whitelisting_requires_platform_authorization',true,
    'agreement_version',v.agreement_version,
    'agreement_url',v.agreement_document_url,
    'agreement_sha256',v.agreement_document_sha256,
    'host_accepted_at',v.host_rights_accepted_at,
    'creator_accepted_at',v.creator_rights_accepted_at,
    'activated_at',v.rights_activated_at
  );
END;
$fn$;
REVOKE ALL ON FUNCTION public.gig_rights_status(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.gig_rights_status(uuid) TO authenticated,service_role;

-- An active perpetual licence must remain usable. The normal 120-day
-- delivery reaper still applies to legacy and not-granted contracts.
CREATE OR REPLACE FUNCTION public.issue_4182_creator_media_reap_candidates(
  p_now timestamptz DEFAULT now(),p_limit integer DEFAULT 500
) RETURNS TABLE(
  id uuid,bunny_video_id text,status text,created_at timestamptz,
  delete_after timestamptz,reap_reason text
)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=public,pg_temp AS $fn$
  SELECT j.id,j.bunny_video_id,j.status,j.created_at,j.delete_after,
    CASE
      WHEN j.status='awaiting_upload' THEN 'abandoned_upload'
      WHEN j.purpose='delivery' THEN 'delivery_lifecycle_complete'
      WHEN j.purpose='dispute_evidence' THEN 'evidence_retention_complete'
      WHEN j.purpose='local_review' THEN 'unpublished_grace_complete'
      ELSE 'retention_complete'
    END
  FROM public.creator_media_jobs j
  WHERE j.status<>'deleted' AND j.retention_hold_at IS NULL
    AND NOT (
      j.purpose='delivery' AND j.contract_id IS NOT NULL
      AND public.gig_rights_status(j.contract_id)->>'status'='active'
    )
    AND (
      (j.status='awaiting_upload' AND j.created_at<=p_now-interval '24 hours')
      OR (
        j.status='ready' AND j.delete_after IS NOT NULL AND j.delete_after<=p_now
        AND (
          (j.purpose='delivery'
            AND EXISTS(SELECT 1 FROM public.gig_deliveries d WHERE d.contract_id=j.contract_id AND d.media_job_id=j.id AND d.decision IN ('approved','auto_approved'))
            AND EXISTS(SELECT 1 FROM public.gig_contracts c WHERE c.id=j.contract_id AND (
              (c.state IN ('released','day30','completed','resolved_release','resolved_partial') AND EXISTS(
                SELECT 1 FROM public.payee_shares s WHERE s.order_kind='gig' AND s.order_id=c.id AND s.payee_kind='gig_fee' AND s.status='paid'))
              OR (c.state='resolved_refund' AND NOT EXISTS(
                SELECT 1 FROM public.payee_shares s WHERE s.order_kind='gig' AND s.order_id=c.id AND s.payee_kind='gig_fee' AND s.status<>'paid'))
            ))
            AND NOT EXISTS(SELECT 1 FROM public.gig_disputes d WHERE d.contract_id=j.contract_id AND d.status IN ('open','settling','escalated')))
          OR (j.purpose='dispute_evidence' AND NOT EXISTS(SELECT 1 FROM public.gig_disputes d WHERE d.contract_id=j.contract_id AND d.status IN ('open','settling','escalated')))
          OR (j.purpose='local_review' AND EXISTS(SELECT 1 FROM public.local_months m WHERE m.id=j.local_month_id AND m.status='void'))
        )
      )
    )
  ORDER BY j.created_at
  LIMIT greatest(1,least(coalesce(p_limit,500),500));
$fn$;

COMMIT;
