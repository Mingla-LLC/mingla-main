-- #3872 walkthrough build pass (W1 server) — creator gigs and creator identity.
--
-- Reviewed R3 migrations (20271224–20271227) are not edited; this file layers
-- the approved walkthrough contract and the QA defect fixes on top with
-- CREATE OR REPLACE / ALTER so the change set stays reviewable on its own.
--
-- MINGLA-INVARIANT: I-3872-STATE-TOKEN | issue #3872 | A gig contract state change is accepted only while issue3872.transition names that exact contract, and the token is cleared after every call; issue_3872_contract_apply_state is the only writer and issue_3872_walkthrough_gig_money.implementor.pg17.test.sql proves an unset or stale token is refused.
-- MINGLA-INVARIANT: I-3872-OFFER-AFTER-CAPTURE | issue #3872 | A creator cannot see, accept or decline an offer until its current hold is captured and no top-up is pending; gig_transition, gig_creator_home and gig_contract_workspace enforce it.
-- MINGLA-INVARIANT: I-3872-GIG-SLOTS | issue #3872 | gig_offer_prepare serialises on the gig row and never creates more live contracts than the gig has slots.
-- MINGLA-INVARIANT: I-3872-REFUND-SERVER-AMOUNTS | issue #3872 | Gig refund amounts come only from gig_refund_quote (server terms, holds and decided disputes); gig_refund_record refuses any other amount and any replay with different amounts.

BEGIN;
SET LOCAL lock_timeout='10s';

-- ---------------------------------------------------------------------------
-- Schema additions.
-- ---------------------------------------------------------------------------

-- Script revision requests get their own two rounds (#11). Before this they
-- consumed fix_rounds_used, so asking for one script change left the host a
-- single technical video fix.
ALTER TABLE public.gig_contracts
  ADD COLUMN IF NOT EXISTS script_rounds_used integer NOT NULL DEFAULT 0
  CHECK (script_rounds_used BETWEEN 0 AND 2);

-- Verification states the creator screens can explain (in review, asked for
-- more, declined). 'rejected' is renamed 'declined'.
ALTER TABLE public.creator_profiles DROP CONSTRAINT IF EXISTS creator_profiles_verification_check;
UPDATE public.creator_profiles SET verification='declined' WHERE verification='rejected';
ALTER TABLE public.creator_profiles
  ADD CONSTRAINT creator_profiles_verification_check
  CHECK (verification IN ('incomplete','review','needs_more','verified','declined','suspended')),
  ADD COLUMN IF NOT EXISTS review_note text CHECK (review_note IS NULL OR char_length(btrim(review_note)) BETWEEN 1 AND 1000),
  ADD COLUMN IF NOT EXISTS declined_reason text CHECK (declined_reason IS NULL OR char_length(btrim(declined_reason)) BETWEEN 1 AND 1000),
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

-- Admin decisions on a creator, newest last, shown as the record history.
CREATE TABLE IF NOT EXISTS public.creator_review_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  creator_account_id uuid NOT NULL REFERENCES public.creator_profiles(creator_account_id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('verify','ask_more','decline','suspend')),
  note text CHECK (note IS NULL OR char_length(note)<=1000),
  actor uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS creator_review_events_creator_idx ON public.creator_review_events(creator_account_id,at);
ALTER TABLE public.creator_review_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creator_review_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.creator_review_events FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.creator_review_events TO service_role;
DROP POLICY IF EXISTS creator_review_events_service_all ON public.creator_review_events;
CREATE POLICY creator_review_events_service_all ON public.creator_review_events FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Real money ranges per currency and budget band. Admin edits them; until a
-- range exists for a currency the apps fall back to a four-step indicator.
-- Seeded empty on purpose (Seth supplies the values).
CREATE TABLE IF NOT EXISTS public.gig_budget_bands (
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  band text NOT NULL CHECK (band IN ('b1','b2','b3','b4')),
  min_minor bigint NOT NULL CHECK (min_minor > 0),
  max_minor bigint NOT NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (currency, band),
  CONSTRAINT gig_budget_bands_range CHECK (max_minor >= min_minor)
);
DROP TRIGGER IF EXISTS issue_3872_gig_budget_bands_updated ON public.gig_budget_bands;
CREATE TRIGGER issue_3872_gig_budget_bands_updated BEFORE UPDATE ON public.gig_budget_bands
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.creator_saved_gigs (
  creator_account_id uuid NOT NULL REFERENCES public.creator_profiles(creator_account_id) ON DELETE CASCADE,
  gig_id uuid NOT NULL REFERENCES public.gigs(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (creator_account_id, gig_id)
);

-- Counter-offer money movements. A higher accepted counter needs a top-up
-- charge on the same rail; a lower one owes the host a partial refund that the
-- gig timer executes. The base hold row stays the single captured authority.
CREATE TABLE IF NOT EXISTS public.gig_hold_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.gig_contracts(id) ON DELETE RESTRICT,
  proposal_id uuid NOT NULL UNIQUE REFERENCES public.gig_change_proposals(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('topup','refund')),
  terms_version integer NOT NULL,
  rail text NOT NULL CHECK (rail IN ('stripe','paystack')),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','captured','refunded','partially_refunded','released','superseded','failed')),
  provider_ref text,
  refunded_minor bigint NOT NULL DEFAULT 0 CHECK (refunded_minor >= 0 AND refunded_minor <= amount_minor),
  captured_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (contract_id, terms_version) REFERENCES public.gig_terms_versions(contract_id, version) ON DELETE RESTRICT,
  CONSTRAINT gig_hold_adjustment_kind_status CHECK (
    (kind='topup' AND status IN ('pending','captured','refunded','partially_refunded','released','superseded','failed'))
    OR (kind='refund' AND status IN ('pending','refunded','superseded','failed'))
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS gig_hold_adjustments_one_pending_uq
  ON public.gig_hold_adjustments(contract_id) WHERE status='pending';
DROP TRIGGER IF EXISTS issue_3872_gig_hold_adjustments_updated ON public.gig_hold_adjustments;
CREATE TRIGGER issue_3872_gig_hold_adjustments_updated BEFORE UPDATE ON public.gig_hold_adjustments
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.gig_budget_bands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gig_budget_bands FORCE ROW LEVEL SECURITY;
ALTER TABLE public.creator_saved_gigs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creator_saved_gigs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.gig_hold_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gig_hold_adjustments FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.gig_budget_bands,public.creator_saved_gigs,public.gig_hold_adjustments FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.gig_budget_bands,public.creator_saved_gigs TO authenticated;
GRANT ALL ON public.gig_budget_bands,public.creator_saved_gigs,public.gig_hold_adjustments TO service_role;
DROP POLICY IF EXISTS gig_budget_bands_authenticated_read ON public.gig_budget_bands;
CREATE POLICY gig_budget_bands_authenticated_read ON public.gig_budget_bands FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS gig_budget_bands_service_all ON public.gig_budget_bands;
CREATE POLICY gig_budget_bands_service_all ON public.gig_budget_bands FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS creator_saved_gigs_owner_read ON public.creator_saved_gigs;
CREATE POLICY creator_saved_gigs_owner_read ON public.creator_saved_gigs FOR SELECT TO authenticated USING (creator_account_id=auth.uid());
DROP POLICY IF EXISTS creator_saved_gigs_service_all ON public.creator_saved_gigs;
CREATE POLICY creator_saved_gigs_service_all ON public.creator_saved_gigs FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS gig_hold_adjustments_service_all ON public.gig_hold_adjustments;
CREATE POLICY gig_hold_adjustments_service_all ON public.gig_hold_adjustments FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- #10 Strict, per-call state guard.
-- ---------------------------------------------------------------------------
-- current_setting(...,true)<>'on' is NULL on a fresh connection (so the old
-- guard let a direct UPDATE through), and once any transition set it 'on' it
-- stayed on for the rest of the transaction. The token now names the one
-- contract being moved and is cleared immediately after the write.
CREATE OR REPLACE FUNCTION public.issue_3872_contract_state_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.state IS DISTINCT FROM OLD.state
     AND coalesce(current_setting('issue3872.transition',true),'') IS DISTINCT FROM NEW.id::text THEN
    RAISE EXCEPTION 'contract_state_requires_gig_transition' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.issue_3872_script_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $fn$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'immutable_gig_script' USING ERRCODE='55000'; END IF;
  IF coalesce(current_setting('issue3872.script_lock',true),'') IS DISTINCT FROM NEW.contract_id::text
     OR NEW.contract_id<>OLD.contract_id OR NEW.version<>OLD.version
     OR NEW.body<>OLD.body OR NEW.source<>OLD.source
     OR NEW.sent_at IS DISTINCT FROM OLD.sent_at OR NEW.created_at<>OLD.created_at THEN
    RAISE EXCEPTION 'immutable_gig_script' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.issue_3872_contract_apply_state(
  p_contract_id uuid,p_state text,p_deadline timestamptz,
  p_fix integer DEFAULT NULL,p_script integer DEFAULT NULL,p_cancel_reason text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
BEGIN
  PERFORM set_config('issue3872.transition',p_contract_id::text,true);
  UPDATE public.gig_contracts
     SET state=p_state,state_deadline_at=p_deadline,
         fix_rounds_used=coalesce(p_fix,fix_rounds_used),
         script_rounds_used=coalesce(p_script,script_rounds_used),
         cancel_reason=coalesce(p_cancel_reason,cancel_reason)
   WHERE id=p_contract_id;
  PERFORM set_config('issue3872.transition','',true);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Shared helpers.
-- ---------------------------------------------------------------------------

-- Host writes on creator gigs need the same rank as Referrals (marketing
-- manager, 20). Reads keep biz_is_brand_member_for_read.
CREATE OR REPLACE FUNCTION public.issue_3872_gig_host_writer(p_brand_id uuid,p_actor uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
  SELECT p_actor IS NOT NULL AND coalesce(public.biz_brand_effective_rank(p_brand_id,p_actor),0)>=20
$fn$;

-- Contract parties: a host must be able to write (rank 20+). Every workflow
-- RPC and party read policy goes through this one function.
CREATE OR REPLACE FUNCTION public.issue_3872_contract_party(p_contract_id uuid,p_actor uuid) RETURNS text
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=public,pg_temp AS $fn$
  SELECT CASE
    WHEN p_actor IS NULL THEN NULL
    WHEN c.creator_account_id=p_actor THEN 'creator'
    WHEN public.issue_3872_gig_host_writer(c.brand_id,p_actor) THEN 'host'
    ELSE NULL END
  FROM public.gig_contracts c WHERE c.id=p_contract_id;
$fn$;

CREATE OR REPLACE FUNCTION public.issue_3872_gig_slots_left(p_gig_id uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
  SELECT greatest(0,g.slots-(SELECT count(*)::integer FROM public.gig_contracts x
    WHERE x.gig_id=g.id AND x.state NOT IN ('declined','expired','cancelled','resolved_refund')))
  FROM public.gigs g WHERE g.id=p_gig_id;
$fn$;

-- The offer is real for the creator only once its current hold is captured
-- and no counter top-up is still unpaid (#7).
CREATE OR REPLACE FUNCTION public.issue_3872_offer_ready(p_contract_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
  SELECT EXISTS(
      SELECT 1 FROM public.gig_contracts c JOIN public.gig_holds h
        ON h.contract_id=c.id AND h.terms_version=c.current_terms_version
       WHERE c.id=p_contract_id AND h.status='captured')
    AND NOT EXISTS(SELECT 1 FROM public.gig_hold_adjustments a
       WHERE a.contract_id=p_contract_id AND a.kind='topup' AND a.status='pending');
$fn$;

CREATE OR REPLACE FUNCTION public.issue_3872_gig_visible_to_creator(p_gig_id uuid,p_viewer uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
  SELECT EXISTS(
    SELECT 1 FROM public.gigs g
     WHERE g.id=p_gig_id AND g.status='open' AND g.shoot_window_end>=current_date
       -- #2: global creator_gigs_enabled flag plus this brand's rollout.
       AND public.issue_3872_creator_gigs_on(g.brand_id)
       AND (g.visibility='board' OR EXISTS(SELECT 1 FROM public.gig_invites i WHERE i.gig_id=g.id AND i.creator_account_id=p_viewer))
       AND public.issue_3872_gig_slots_left(g.id)>0
  );
$fn$;

CREATE OR REPLACE FUNCTION public.issue_3872_public_gig_json(p_gig_id uuid,p_viewer uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
  SELECT jsonb_build_object(
    'id',g.id,'title_public',g.title_public,'brief_public',g.brief_public,'format_key',g.format_key,
    'deliverables',g.deliverables,'city_name',c.name,'category',g.category,
    'shoot_window',jsonb_build_object('start',g.shoot_window_start,'end',g.shoot_window_end),
    'post_by',g.post_by,'usage_days',g.usage_days,'budget_band',g.budget_band,
    'budget_min_minor',bb.min_minor,'budget_max_minor',bb.max_minor,'budget_currency',bb.currency,
    'sales_share_bps',g.sales_share_bps,'slots_left',public.issue_3872_gig_slots_left(g.id),
    'saved',EXISTS(SELECT 1 FROM public.creator_saved_gigs s WHERE s.gig_id=g.id AND s.creator_account_id=p_viewer)
  )
  FROM public.gigs g
  JOIN public.seeding_cities c ON c.id=g.city_id
  LEFT JOIN public.gig_budget_bands bb ON bb.currency=g.currency AND bb.band=g.budget_band
  WHERE g.id=p_gig_id;
$fn$;

-- ---------------------------------------------------------------------------
-- #9 Brief linter: bare domains and dotted phone numbers.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_3872_brief_lint(
  p_brand_id uuid,p_listing_kind text,p_listing_id uuid,p_text text
) RETURNS text[] LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=public,pg_temp AS $fn$
DECLARE v_hits text[]:='{}'; v_brand public.brands; v_listing text; v_run text; v_digits integer;
BEGIN
  IF p_text IS NULL OR btrim(p_text)='' THEN RETURN v_hits; END IF;
  SELECT * INTO v_brand FROM public.brands WHERE id=p_brand_id;
  -- Explicit URLs, plus bare domains such as rooftopraleigh.com. The TLD list
  -- is closed so ordinary abbreviations ("e.g.", "approx.") do not trip it.
  IF p_text ~* '(https?://|www\.)'
     OR p_text ~* '\m[a-z0-9][a-z0-9-]*(\.[a-z0-9-]+)*\.(com|net|org|io|co|ng|uk|us|ca|app|biz|info|me|bar|club|restaurant|cafe|xyz|ai|shop|store|live|events|tv|site|online|link|page|dev|ly|gg)\M' THEN
    v_hits:=array_append(v_hits,'url');
  END IF;
  IF p_text ~* '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}' THEN v_hits:=array_append(v_hits,'email'); END IF;
  -- Phone-like runs, including dotted 919.555.0101. A dotted run needs ten
  -- digits so time ranges ("10.00-12.00") and prices stay allowed.
  FOR v_run IN SELECT m[1] FROM regexp_matches(p_text,'(\+?[0-9][0-9 ().-]{6,}[0-9])','g') m LOOP
    v_digits:=char_length(regexp_replace(v_run,'[^0-9]','','g'));
    IF (position('.' in v_run)=0 AND v_digits>=8) OR v_digits>=10 THEN
      v_hits:=array_append(v_hits,'phone'); EXIT;
    END IF;
  END LOOP;
  IF p_text ~* '(^|\s)@[a-z0-9_.-]+' THEN v_hits:=array_append(v_hits,'handle'); END IF;
  IF v_brand.id IS NOT NULL AND (p_text ILIKE '%'||v_brand.name||'%' OR p_text ILIKE '%'||v_brand.slug||'%') THEN v_hits:=array_append(v_hits,'brand'); END IF;
  IF p_listing_kind='event' THEN SELECT title INTO v_listing FROM public.events WHERE id=p_listing_id;
  ELSIF p_listing_kind='venue' THEN SELECT name INTO v_listing FROM public.venue_listings WHERE id=p_listing_id; END IF;
  IF v_listing IS NOT NULL AND p_text ILIKE '%'||v_listing||'%' THEN v_hits:=array_append(v_hits,'listing'); END IF;
  RETURN v_hits;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- #8 / #2 gig_save: validated, brand-bound, rank 20+, rollout-gated.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gig_save(p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE
  v_actor uuid:=auth.uid();
  v_uuid constant text:='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_date constant text:='^[0-9]{4}-[0-9]{2}-[0-9]{2}$';
  v_int constant text:='^[0-9]{1,9}$';
  v_brand uuid; v_id uuid; v_existing public.gigs; v_hits text[];
  v_kind text; v_listing uuid; v_title text; v_brief text; v_private text; v_format text;
  v_deliverables jsonb; v_must_tag jsonb; v_city uuid; v_category text;
  v_start date; v_end date; v_post_by date; v_usage integer; v_band text; v_currency text;
  v_share integer; v_passes integer; v_slots integer; v_visibility text; v_status text;
  v_hired integer; v_constraint text;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='28000'; END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN
    RETURN jsonb_build_object('ok',false,'error','invalid_payload');
  END IF;
  IF coalesce(p_payload->>'brand_id','')!~v_uuid THEN
    RETURN jsonb_build_object('ok',false,'error','brand_required','field','brand_id');
  END IF;
  v_brand:=(p_payload->>'brand_id')::uuid;
  IF NOT public.issue_3872_gig_host_writer(v_brand,v_actor) THEN RAISE EXCEPTION 'permission_denied' USING ERRCODE='42501'; END IF;
  IF NOT public.issue_3872_creator_gigs_on(v_brand) THEN RAISE EXCEPTION 'creator_gigs_disabled' USING ERRCODE='55000'; END IF;

  IF nullif(p_payload->>'id','') IS NOT NULL THEN
    IF p_payload->>'id'!~v_uuid THEN RETURN jsonb_build_object('ok',false,'error','gig_not_found','field','id'); END IF;
    v_id:=(p_payload->>'id')::uuid;
    SELECT * INTO v_existing FROM public.gigs WHERE id=v_id FOR UPDATE;
    -- Another brand's gig id used to fall through ON CONFLICT ... WHERE and
    -- return ok without saving anything.
    IF NOT FOUND OR v_existing.brand_id<>v_brand THEN RETURN jsonb_build_object('ok',false,'error','gig_not_found','field','id'); END IF;
    IF v_existing.status NOT IN ('draft','open') THEN RETURN jsonb_build_object('ok',false,'error','gig_not_editable'); END IF;
  ELSE
    v_id:=gen_random_uuid();
  END IF;

  v_kind:=p_payload->>'listing_kind';
  IF v_kind NOT IN ('event','venue') OR v_kind IS NULL THEN RETURN jsonb_build_object('ok',false,'error','listing_required','field','listing_kind'); END IF;
  IF coalesce(p_payload->>'listing_id','')!~v_uuid THEN RETURN jsonb_build_object('ok',false,'error','listing_required','field','listing_id'); END IF;
  v_listing:=(p_payload->>'listing_id')::uuid;
  -- The listing must belong to the saving brand (cross-brand ids were accepted).
  IF (v_kind='event' AND NOT EXISTS(SELECT 1 FROM public.events e WHERE e.id=v_listing AND e.brand_id=v_brand AND e.deleted_at IS NULL))
     OR (v_kind='venue' AND NOT EXISTS(SELECT 1 FROM public.venue_listings vl WHERE vl.id=v_listing AND vl.brand_id=v_brand)) THEN
    RETURN jsonb_build_object('ok',false,'error','listing_not_found','field','listing_id');
  END IF;
  IF v_existing.id IS NOT NULL AND (v_existing.listing_kind<>v_kind OR v_existing.listing_id<>v_listing) THEN
    RETURN jsonb_build_object('ok',false,'error','listing_immutable','field','listing_id');
  END IF;

  v_title:=btrim(coalesce(p_payload->>'title_public',''));
  IF char_length(v_title) NOT BETWEEN 8 AND 70 THEN RETURN jsonb_build_object('ok',false,'error','title_length','field','title_public'); END IF;
  v_brief:=btrim(coalesce(p_payload->>'brief_public',''));
  IF char_length(v_brief) NOT BETWEEN 40 AND 800 THEN RETURN jsonb_build_object('ok',false,'error','brief_length','field','brief_public'); END IF;
  v_private:=nullif(btrim(coalesce(p_payload->>'brief_private','')),'');
  IF char_length(coalesce(v_private,''))>2000 THEN RETURN jsonb_build_object('ok',false,'error','private_brief_length','field','brief_private'); END IF;
  v_format:=p_payload->>'format_key';
  IF NOT EXISTS(SELECT 1 FROM public.gig_formats f WHERE f.key=v_format AND f.active) THEN RETURN jsonb_build_object('ok',false,'error','format_invalid','field','format_key'); END IF;
  v_deliverables:=p_payload->'deliverables';
  IF v_deliverables IS NULL OR jsonb_typeof(v_deliverables)<>'array' OR jsonb_array_length(v_deliverables) NOT BETWEEN 1 AND 10 THEN
    RETURN jsonb_build_object('ok',false,'error','deliverables_invalid','field','deliverables');
  END IF;
  v_must_tag:=CASE WHEN p_payload->'must_tag' IS NULL OR jsonb_typeof(p_payload->'must_tag')='null' THEN '{}'::jsonb ELSE p_payload->'must_tag' END;
  IF jsonb_typeof(v_must_tag)<>'object' THEN RETURN jsonb_build_object('ok',false,'error','must_tag_invalid','field','must_tag'); END IF;
  IF coalesce(p_payload->>'city_id','')!~v_uuid OR NOT EXISTS(SELECT 1 FROM public.seeding_cities WHERE id=(p_payload->>'city_id')::uuid) THEN
    RETURN jsonb_build_object('ok',false,'error','city_required','field','city_id');
  END IF;
  v_city:=(p_payload->>'city_id')::uuid;
  v_category:=btrim(coalesce(p_payload->>'category',''));
  IF char_length(v_category) NOT BETWEEN 2 AND 60 THEN RETURN jsonb_build_object('ok',false,'error','category_invalid','field','category'); END IF;
  IF coalesce(p_payload->>'shoot_window_start','')!~v_date THEN RETURN jsonb_build_object('ok',false,'error','date_invalid','field','shoot_window_start'); END IF;
  IF coalesce(p_payload->>'shoot_window_end','')!~v_date THEN RETURN jsonb_build_object('ok',false,'error','date_invalid','field','shoot_window_end'); END IF;
  IF coalesce(p_payload->>'post_by','')!~v_date THEN RETURN jsonb_build_object('ok',false,'error','date_invalid','field','post_by'); END IF;
  BEGIN
    v_start:=(p_payload->>'shoot_window_start')::date; v_end:=(p_payload->>'shoot_window_end')::date; v_post_by:=(p_payload->>'post_by')::date;
  EXCEPTION WHEN others THEN RETURN jsonb_build_object('ok',false,'error','date_invalid','field','shoot_window_start');
  END;
  -- Past shoot windows were accepted. A new or moved window must start today
  -- or later; every window must still be open.
  IF v_end<current_date THEN RETURN jsonb_build_object('ok',false,'error','shoot_window_in_past','field','shoot_window_end'); END IF;
  IF v_start<current_date AND (v_existing.id IS NULL OR v_existing.shoot_window_start IS DISTINCT FROM v_start) THEN
    RETURN jsonb_build_object('ok',false,'error','shoot_window_in_past','field','shoot_window_start');
  END IF;
  IF v_end<v_start THEN RETURN jsonb_build_object('ok',false,'error','shoot_window_order','field','shoot_window_end'); END IF;
  IF v_post_by<v_end THEN RETURN jsonb_build_object('ok',false,'error','post_by_before_shoot','field','post_by'); END IF;
  IF coalesce(nullif(p_payload->>'usage_days',''),'90')!~v_int THEN RETURN jsonb_build_object('ok',false,'error','usage_invalid','field','usage_days'); END IF;
  v_usage:=coalesce(nullif(p_payload->>'usage_days',''),'90')::integer;
  IF v_usage NOT IN (30,90,365) THEN RETURN jsonb_build_object('ok',false,'error','usage_invalid','field','usage_days'); END IF;
  v_band:=p_payload->>'budget_band';
  IF v_band IS NULL OR v_band NOT IN ('b1','b2','b3','b4') THEN RETURN jsonb_build_object('ok',false,'error','budget_band_invalid','field','budget_band'); END IF;
  v_currency:=upper(btrim(coalesce(p_payload->>'currency','')));
  IF v_currency!~'^[A-Z]{3}$' THEN RETURN jsonb_build_object('ok',false,'error','currency_invalid','field','currency'); END IF;
  IF v_existing.id IS NOT NULL AND v_existing.currency<>v_currency THEN RETURN jsonb_build_object('ok',false,'error','currency_immutable','field','currency'); END IF;
  IF nullif(p_payload->>'sales_share_bps','') IS NOT NULL THEN
    IF p_payload->>'sales_share_bps'!~v_int OR (p_payload->>'sales_share_bps')::integer NOT BETWEEN 100 AND 3000 THEN
      RETURN jsonb_build_object('ok',false,'error','sales_share_invalid','field','sales_share_bps');
    END IF;
    v_share:=(p_payload->>'sales_share_bps')::integer;
  END IF;
  IF coalesce(nullif(p_payload->>'shoot_passes',''),'1')!~v_int OR coalesce(nullif(p_payload->>'shoot_passes',''),'1')::integer NOT BETWEEN 0 AND 4 THEN
    RETURN jsonb_build_object('ok',false,'error','shoot_passes_invalid','field','shoot_passes');
  END IF;
  v_passes:=coalesce(nullif(p_payload->>'shoot_passes',''),'1')::integer;
  IF coalesce(nullif(p_payload->>'slots',''),'1')!~v_int OR coalesce(nullif(p_payload->>'slots',''),'1')::integer NOT BETWEEN 1 AND 10 THEN
    RETURN jsonb_build_object('ok',false,'error','slots_invalid','field','slots');
  END IF;
  v_slots:=coalesce(nullif(p_payload->>'slots',''),'1')::integer;
  IF v_existing.id IS NOT NULL THEN
    SELECT count(*) INTO v_hired FROM public.gig_contracts x WHERE x.gig_id=v_id AND x.state NOT IN ('declined','expired','cancelled','resolved_refund');
    IF v_slots<v_hired THEN RETURN jsonb_build_object('ok',false,'error','slots_below_hired','field','slots'); END IF;
  END IF;
  v_visibility:=coalesce(nullif(p_payload->>'visibility',''),'board');
  IF v_visibility NOT IN ('board','invite_only') THEN RETURN jsonb_build_object('ok',false,'error','visibility_invalid','field','visibility'); END IF;
  v_status:=coalesce(nullif(p_payload->>'status',''),coalesce(v_existing.status,'draft'));
  IF v_status NOT IN ('draft','open','closed','cancelled') OR (v_existing.id IS NULL AND v_status NOT IN ('draft','open')) THEN
    RETURN jsonb_build_object('ok',false,'error','status_invalid','field','status');
  END IF;

  v_hits:=public.issue_3872_brief_lint(v_brand,v_kind,v_listing,v_title)
    || public.issue_3872_brief_lint(v_brand,v_kind,v_listing,v_brief);
  IF cardinality(v_hits)>0 THEN
    RETURN jsonb_build_object('ok',false,'error','public_brief_not_anonymous','reasons',to_jsonb(v_hits),'field','brief_public');
  END IF;

  BEGIN
    IF v_existing.id IS NULL THEN
      INSERT INTO public.gigs(id,brand_id,listing_kind,listing_id,title_public,brief_public,brief_private,format_key,deliverables,must_tag,city_id,category,shoot_window_start,shoot_window_end,post_by,usage_days,budget_band,currency,sales_share_bps,shoot_passes,slots,visibility,status,created_by)
      VALUES(v_id,v_brand,v_kind,v_listing,v_title,v_brief,v_private,v_format,v_deliverables,v_must_tag,v_city,v_category,v_start,v_end,v_post_by,v_usage,v_band,v_currency,v_share,v_passes,v_slots,v_visibility,v_status,v_actor);
    ELSE
      UPDATE public.gigs SET title_public=v_title,brief_public=v_brief,brief_private=v_private,format_key=v_format,
        deliverables=v_deliverables,must_tag=v_must_tag,city_id=v_city,category=v_category,
        shoot_window_start=v_start,shoot_window_end=v_end,post_by=v_post_by,usage_days=v_usage,
        budget_band=v_band,sales_share_bps=v_share,shoot_passes=v_passes,slots=v_slots,
        visibility=v_visibility,status=v_status,version=version+1
      WHERE id=v_id;
    END IF;
  EXCEPTION WHEN check_violation OR not_null_violation OR foreign_key_violation OR invalid_text_representation OR numeric_value_out_of_range THEN
    -- Never surface raw constraint text; name the constraint as the field.
    GET STACKED DIAGNOSTICS v_constraint=CONSTRAINT_NAME;
    RETURN jsonb_build_object('ok',false,'error','invalid_gig','field',coalesce(nullif(v_constraint,''),'gig'));
  END;
  RETURN jsonb_build_object('ok',true,'id',v_id,'status',v_status);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Creator-side reads (#2, #19, contract: saved, budget range, no full gigs).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.creator_gig_board(p_city_id uuid DEFAULT NULL,p_format_key text DEFAULT NULL) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=public,pg_temp AS $fn$
  SELECT coalesce(jsonb_agg(public.issue_3872_public_gig_json(g.id,auth.uid()) ORDER BY g.shoot_window_start,g.created_at),'[]'::jsonb)
  FROM public.gigs g
  WHERE (p_city_id IS NULL OR g.city_id=p_city_id) AND (p_format_key IS NULL OR g.format_key=p_format_key)
    AND public.issue_3872_gig_visible_to_creator(g.id,auth.uid())
    AND EXISTS(SELECT 1 FROM public.creator_profiles p WHERE p.creator_account_id=auth.uid() AND p.mode_enabled AND p.verification='verified');
$fn$;

CREATE OR REPLACE FUNCTION public.creator_gig_detail(p_gig_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=public,pg_temp AS $fn$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='28000'; END IF;
  -- #19: any signed-in non-creator could read gig briefs.
  IF NOT EXISTS(SELECT 1 FROM public.creator_profiles WHERE creator_account_id=auth.uid()) THEN
    RAISE EXCEPTION 'creator_profile_required' USING ERRCODE='42501';
  END IF;
  IF NOT public.issue_3872_gig_visible_to_creator(p_gig_id,auth.uid()) THEN RETURN NULL; END IF;
  RETURN public.issue_3872_public_gig_json(p_gig_id,auth.uid());
END;
$fn$;

CREATE OR REPLACE FUNCTION public.creator_gig_save(p_gig_id uuid,p_saved boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_actor uuid:=auth.uid();
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='28000'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.creator_profiles WHERE creator_account_id=v_actor) THEN
    RAISE EXCEPTION 'creator_profile_required' USING ERRCODE='42501';
  END IF;
  IF coalesce(p_saved,false) THEN
    IF NOT public.issue_3872_gig_visible_to_creator(p_gig_id,v_actor) THEN
      RETURN jsonb_build_object('ok',false,'error','gig_not_open','saved',false);
    END IF;
    INSERT INTO public.creator_saved_gigs(creator_account_id,gig_id) VALUES(v_actor,p_gig_id) ON CONFLICT DO NOTHING;
    RETURN jsonb_build_object('ok',true,'saved',true);
  END IF;
  DELETE FROM public.creator_saved_gigs WHERE creator_account_id=v_actor AND gig_id=p_gig_id;
  RETURN jsonb_build_object('ok',true,'saved',false);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.creator_saved_gigs() RETURNS jsonb
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=public,pg_temp AS $fn$
  SELECT coalesce(jsonb_agg(public.issue_3872_public_gig_json(s.gig_id,auth.uid()) ORDER BY s.created_at DESC),'[]'::jsonb)
  FROM public.creator_saved_gigs s
  WHERE s.creator_account_id=auth.uid() AND public.issue_3872_gig_visible_to_creator(s.gig_id,auth.uid());
$fn$;

CREATE OR REPLACE FUNCTION public.gig_interest_send(p_gig_id uuid,p_package_id uuid,p_quoted_minor bigint,p_note text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_actor uuid:=auth.uid(); v_gig public.gigs; v_hits text[]; v_existing public.gig_interest;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='28000'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.creator_profiles WHERE creator_account_id=v_actor AND verification='verified' AND mode_enabled) THEN
    RETURN jsonb_build_object('ok',false,'error','creator_not_ready');
  END IF;
  SELECT * INTO v_gig FROM public.gigs WHERE id=p_gig_id;
  IF NOT FOUND OR v_gig.status<>'open' OR v_gig.shoot_window_end<current_date
     OR NOT public.issue_3872_creator_gigs_on(v_gig.brand_id)
     OR (v_gig.visibility='invite_only' AND NOT EXISTS(SELECT 1 FROM public.gig_invites i WHERE i.gig_id=v_gig.id AND i.creator_account_id=v_actor)) THEN
    RETURN jsonb_build_object('ok',false,'error','gig_not_open');
  END IF;
  IF public.issue_3872_gig_slots_left(v_gig.id)=0 THEN RETURN jsonb_build_object('ok',false,'error','gig_full'); END IF;
  IF NOT EXISTS(SELECT 1 FROM public.creator_packages WHERE id=p_package_id AND creator_account_id=v_actor AND active) THEN
    RETURN jsonb_build_object('ok',false,'error','package_not_owned','field','package_id');
  END IF;
  IF p_quoted_minor IS NULL OR p_quoted_minor<=0 THEN RETURN jsonb_build_object('ok',false,'error','quote_invalid','field','quoted_minor'); END IF;
  IF char_length(btrim(coalesce(p_note,'')))>300 THEN RETURN jsonb_build_object('ok',false,'error','note_too_long','field','note'); END IF;
  v_hits:=public.issue_3872_brief_lint(v_gig.brand_id,v_gig.listing_kind,v_gig.listing_id,coalesce(p_note,''));
  IF cardinality(v_hits)>0 THEN RETURN jsonb_build_object('ok',false,'error','note_not_anonymous','reasons',to_jsonb(v_hits),'field','note'); END IF;
  IF (v_gig.currency='NGN' AND NOT EXISTS(SELECT 1 FROM public.payee_accounts WHERE user_id=v_actor AND paystack_status='verified'))
     OR (v_gig.currency<>'NGN' AND NOT EXISTS(SELECT 1 FROM public.payee_accounts WHERE user_id=v_actor AND stripe_status='active')) THEN
    RETURN jsonb_build_object('ok',false,'error','payout_rail_mismatch','currency',v_gig.currency);
  END IF;
  SELECT * INTO v_existing FROM public.gig_interest WHERE gig_id=p_gig_id AND creator_account_id=v_actor FOR UPDATE;
  IF FOUND AND v_existing.status<>'withdrawn' THEN RETURN jsonb_build_object('ok',false,'error','already_interested'); END IF;
  INSERT INTO public.gig_interest(gig_id,creator_account_id,package_id,quoted_minor,note) VALUES(p_gig_id,v_actor,p_package_id,p_quoted_minor,nullif(btrim(p_note),''))
  ON CONFLICT(gig_id,creator_account_id) DO UPDATE SET package_id=excluded.package_id,quoted_minor=excluded.quoted_minor,note=excluded.note,status='sent';
  RETURN jsonb_build_object('ok',true);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Host-side applicants and decisions (#6, #2, #8).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gig_applicants(p_gig_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=public,pg_temp AS $fn$
  -- FILTER keeps a gig with no interest at [] instead of one all-null row,
  -- which crashed the Host Applicants screen (#6).
  SELECT CASE WHEN public.biz_is_brand_member_for_read(g.brand_id,auth.uid()) THEN coalesce(jsonb_agg(jsonb_build_object(
    'interest_id',i.id,'creator_id',i.creator_account_id,'display_name',p.display_name,'niches',p.niches,
    'follower_bands',(SELECT coalesce(jsonb_agg(jsonb_build_object('platform',h.platform,'band',h.follower_band,'verified',h.verified_at IS NOT NULL)),'[]'::jsonb) FROM public.creator_handles h WHERE h.creator_account_id=i.creator_account_id),
    'rating',CASE WHEN p.rating_count>0 THEN p.rating_avg_x100/100.0 END,'completed',p.completed_gigs,'reliability',p.reliability_bps,
    'quote_minor',i.quoted_minor,'currency',g.currency,'package_id',i.package_id,'note',i.note,'status',i.status
  ) ORDER BY i.created_at) FILTER (WHERE i.id IS NOT NULL),'[]'::jsonb) ELSE NULL END
  FROM public.gigs g LEFT JOIN public.gig_interest i ON i.gig_id=g.id LEFT JOIN public.creator_profiles p ON p.creator_account_id=i.creator_account_id
  WHERE g.id=p_gig_id GROUP BY g.brand_id;
$fn$;

CREATE OR REPLACE FUNCTION public.gig_interest_decide(p_interest_id uuid,p_status text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_interest public.gig_interest; v_brand uuid;
BEGIN
  IF p_status NOT IN ('shortlisted','passed') THEN RAISE EXCEPTION 'invalid_interest_status' USING ERRCODE='22023'; END IF;
  SELECT i.* INTO v_interest FROM public.gig_interest i WHERE i.id=p_interest_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'interest_not_found' USING ERRCODE='P0002'; END IF;
  SELECT g.brand_id INTO v_brand FROM public.gigs g WHERE g.id=v_interest.gig_id;
  IF NOT public.issue_3872_gig_host_writer(v_brand,auth.uid()) THEN RAISE EXCEPTION 'permission_denied' USING ERRCODE='42501'; END IF;
  IF NOT public.issue_3872_creator_gigs_on(v_brand) THEN RAISE EXCEPTION 'creator_gigs_disabled' USING ERRCODE='55000'; END IF;
  IF v_interest.status NOT IN ('sent','shortlisted','passed') THEN RETURN jsonb_build_object('ok',false,'error','interest_not_open'); END IF;
  UPDATE public.gig_interest SET status=p_status WHERE id=p_interest_id;
  RETURN jsonb_build_object('ok',true,'status',p_status);
END;
$fn$;

-- #7 / #8 / #2: slots, interest state, stale unpaid offers, rank and rollout.
CREATE OR REPLACE FUNCTION public.gig_offer_prepare(p_interest_id uuid,p_terms jsonb,p_idempotency_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE
  v_actor uuid:=auth.uid(); v_interest public.gig_interest; v_gig public.gigs; v_contract uuid;
  v_fee bigint; v_booking bigint; v_rail text; v_existing public.gig_holds; v_live public.gig_contracts;
  v_terms jsonb:=coalesce(CASE WHEN jsonb_typeof(p_terms)='object' THEN p_terms END,'{}'::jsonb);
  v_shoot date; v_post_by date;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='28000'; END IF;
  IF char_length(coalesce(p_idempotency_key,''))<8 THEN RETURN jsonb_build_object('ok',false,'error','idempotency_key_required'); END IF;
  SELECT * INTO v_existing FROM public.gig_holds WHERE idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF NOT EXISTS(SELECT 1 FROM public.gig_contracts c WHERE c.id=v_existing.contract_id AND public.issue_3872_gig_host_writer(c.brand_id,v_actor)) THEN RAISE EXCEPTION 'permission_denied' USING ERRCODE='42501'; END IF;
    SELECT t.fee_minor,t.booking_fee_minor INTO v_fee,v_booking FROM public.gig_terms_versions t WHERE t.contract_id=v_existing.contract_id AND t.version=v_existing.terms_version;
    RETURN jsonb_build_object('ok',true,'contract_id',v_existing.contract_id,'terms_version',v_existing.terms_version,'rail',v_existing.rail,'fee_minor',v_fee,'booking_fee_minor',v_booking,'total_minor',v_existing.amount_minor,'currency',v_existing.currency,'replayed',true);
  END IF;
  SELECT * INTO v_interest FROM public.gig_interest WHERE id=p_interest_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'interest_not_found' USING ERRCODE='P0002'; END IF;
  -- Lock the gig row so two concurrent offers cannot both see a free slot.
  SELECT * INTO v_gig FROM public.gigs WHERE id=v_interest.gig_id FOR UPDATE;
  IF NOT public.issue_3872_gig_host_writer(v_gig.brand_id,v_actor) THEN RAISE EXCEPTION 'permission_denied' USING ERRCODE='42501'; END IF;
  IF NOT public.issue_3872_creator_gigs_on(v_gig.brand_id) THEN RAISE EXCEPTION 'creator_gigs_disabled' USING ERRCODE='55000'; END IF;
  IF v_gig.status NOT IN ('open') THEN RETURN jsonb_build_object('ok',false,'error','gig_not_open'); END IF;

  SELECT * INTO v_live FROM public.gig_contracts c
   WHERE c.gig_id=v_gig.id AND c.creator_account_id=v_interest.creator_account_id
     AND c.state NOT IN ('declined','expired','cancelled','completed','resolved_release','resolved_partial','resolved_refund')
   FOR UPDATE;
  IF FOUND THEN
    -- A provider start that never completed leaves an unpaid offer the
    -- creator never saw. Retire it (no money moved) so the host can retry.
    IF v_live.state='offered' AND EXISTS(SELECT 1 FROM public.gig_holds h WHERE h.contract_id=v_live.id AND h.status='pending')
       AND NOT EXISTS(SELECT 1 FROM public.gig_holds h WHERE h.contract_id=v_live.id AND h.status<>'pending') THEN
      UPDATE public.gig_holds SET status='failed' WHERE contract_id=v_live.id AND status='pending';
      PERFORM public.issue_3872_contract_apply_state(v_live.id,'cancelled',NULL,NULL,NULL,'payment_not_completed');
      INSERT INTO public.gig_events(contract_id,actor,kind,data) VALUES(v_live.id,'system','offer_payment_abandoned','{}'::jsonb);
    ELSE
      RETURN jsonb_build_object('ok',false,'error','already_offered');
    END IF;
  ELSIF v_interest.status NOT IN ('sent','shortlisted') THEN
    -- Withdrawn or passed interest cannot be offered.
    RETURN jsonb_build_object('ok',false,'error','interest_not_open');
  END IF;
  IF public.issue_3872_gig_slots_left(v_gig.id)<=0 THEN RETURN jsonb_build_object('ok',false,'error','gig_full'); END IF;

  IF nullif(v_terms->>'fee_minor','') IS NOT NULL AND v_terms->>'fee_minor'!~'^[0-9]{1,15}$' THEN
    RETURN jsonb_build_object('ok',false,'error','fee_invalid','field','fee_minor');
  END IF;
  v_fee:=coalesce(nullif(v_terms->>'fee_minor','')::bigint,v_interest.quoted_minor);
  IF v_fee IS NULL OR v_fee<=0 THEN RETURN jsonb_build_object('ok',false,'error','fee_invalid','field','fee_minor'); END IF;
  BEGIN
    v_shoot:=nullif(v_terms->>'shoot_date','')::date;
    v_post_by:=coalesce(nullif(v_terms->>'post_by','')::date,v_gig.post_by);
  EXCEPTION WHEN others THEN RETURN jsonb_build_object('ok',false,'error','date_invalid','field','shoot_date');
  END;
  IF v_shoot IS NOT NULL AND v_shoot NOT BETWEEN v_gig.shoot_window_start AND v_gig.shoot_window_end THEN
    RETURN jsonb_build_object('ok',false,'error','shoot_outside_window','field','shoot_date');
  END IF;
  IF v_post_by<current_date THEN RETURN jsonb_build_object('ok',false,'error','post_by_in_past','field','post_by'); END IF;
  v_booking:=((v_fee*1500+5000)/10000); v_rail:=CASE WHEN v_gig.currency='NGN' THEN 'paystack' ELSE 'stripe' END;
  INSERT INTO public.gig_contracts(gig_id,brand_id,creator_account_id,state,state_deadline_at)
  VALUES(v_gig.id,v_gig.brand_id,v_interest.creator_account_id,'offered',now()+interval '48 hours') RETURNING id INTO v_contract;
  INSERT INTO public.gig_terms_versions(contract_id,version,fee_minor,booking_fee_minor,currency,format_key,deliverables,shoot_date,post_by,usage_days,sales_share_bps,shoot_passes,proposed_by)
  VALUES(v_contract,1,v_fee,v_booking,v_gig.currency,v_gig.format_key,
    CASE WHEN jsonb_typeof(v_terms->'deliverables')='array' THEN v_terms->'deliverables' ELSE v_gig.deliverables END,
    v_shoot,v_post_by,coalesce(nullif(v_terms->>'usage_days','')::integer,v_gig.usage_days),
    coalesce(nullif(v_terms->>'sales_share_bps','')::integer,v_gig.sales_share_bps),
    coalesce(nullif(v_terms->>'shoot_passes','')::integer,v_gig.shoot_passes),'host');
  INSERT INTO public.gig_holds(contract_id,terms_version,rail,amount_minor,currency,idempotency_key)
  VALUES(v_contract,1,v_rail,v_fee+v_booking,v_gig.currency,p_idempotency_key);
  UPDATE public.gig_interest SET status='offered' WHERE id=v_interest.id;
  INSERT INTO public.gig_events(contract_id,actor,kind,data) VALUES(v_contract,'host','offer_created',jsonb_build_object('terms_version',1,'amount_minor',v_fee+v_booking));
  RETURN jsonb_build_object('ok',true,'contract_id',v_contract,'terms_version',1,'rail',v_rail,'fee_minor',v_fee,'booking_fee_minor',v_booking,'total_minor',v_fee+v_booking,'currency',v_gig.currency);
END;
$fn$;

-- #12 replay-safe capture; the 48-hour answer window starts at capture (#7).
CREATE OR REPLACE FUNCTION public.gig_hold_mark_captured(p_contract_id uuid,p_terms_version integer,p_provider_ref text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_hold public.gig_holds; v_contract public.gig_contracts;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'service_role_only' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_contract FROM public.gig_contracts WHERE id=p_contract_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'contract_not_found' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_hold FROM public.gig_holds WHERE contract_id=p_contract_id AND terms_version=p_terms_version FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'hold_not_found' USING ERRCODE='P0002'; END IF;
  IF v_hold.status IN ('captured','released','refunded','partially_refunded') THEN
    IF v_hold.provider_ref IS DISTINCT FROM p_provider_ref THEN RAISE EXCEPTION 'hold_provider_mismatch' USING ERRCODE='55000'; END IF;
    RETURN to_jsonb(v_hold)||jsonb_build_object('replayed',true);
  END IF;
  IF v_hold.status<>'pending' THEN RAISE EXCEPTION 'hold_not_pending' USING ERRCODE='55000'; END IF;
  UPDATE public.gig_holds SET status='captured',provider_ref=p_provider_ref,captured_at=now() WHERE id=v_hold.id RETURNING * INTO v_hold;
  IF v_contract.state='offered' THEN
    UPDATE public.gig_contracts SET state_deadline_at=now()+interval '48 hours' WHERE id=p_contract_id;
  END IF;
  INSERT INTO public.gig_events(contract_id,actor,kind,data) VALUES(p_contract_id,'system','hold_captured',jsonb_build_object('terms_version',p_terms_version,'rail',v_hold.rail));
  RETURN to_jsonb(v_hold)||jsonb_build_object('replayed',false);
END;
$fn$;

-- Unpaid offers never become visible; after their window they are retired
-- without any provider call (nothing was captured).
CREATE OR REPLACE FUNCTION public.gig_pending_offer_sweep(p_now timestamptz DEFAULT now()) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_row record; v_count integer:=0;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'service_role_only' USING ERRCODE='42501'; END IF;
  FOR v_row IN
    SELECT c.id FROM public.gig_contracts c
     WHERE c.state='offered' AND c.state_deadline_at<=p_now
       AND NOT EXISTS(SELECT 1 FROM public.gig_holds h WHERE h.contract_id=c.id AND h.status<>'pending')
     FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.gig_holds SET status='failed' WHERE contract_id=v_row.id AND status='pending';
    PERFORM public.issue_3872_contract_apply_state(v_row.id,'cancelled',NULL,NULL,NULL,'payment_not_completed');
    INSERT INTO public.gig_events(contract_id,actor,kind,data) VALUES(v_row.id,'system','offer_payment_abandoned','{}'::jsonb);
    v_count:=v_count+1;
  END LOOP;
  RETURN jsonb_build_object('ok',true,'retired',v_count);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- gig_transition: strict per-call state token (#10), separate script rounds
-- (#11), upload deadline at script lock (#13), creator offer gate (#7).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gig_transition(p_contract_id uuid,p_expected_state text,p_action text,p_payload jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE
  v_actor uuid:=auth.uid(); v public.gig_contracts; v_party text; v_is_host boolean; v_is_creator boolean; v_is_admin boolean;
  v_next text; v_actor_kind text; v_deadline timestamptz; v_fix integer; v_script integer; v_ready boolean; v_post_by date;
BEGIN
  SELECT * INTO v FROM public.gig_contracts WHERE id=p_contract_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'contract_not_found' USING ERRCODE='P0002'; END IF;
  IF v.state<>p_expected_state THEN RAISE EXCEPTION 'stale_contract_state:%',v.state USING ERRCODE='40001'; END IF;
  v_party:=public.issue_3872_contract_party(v.id,v_actor);
  v_is_host:=coalesce(v_party='host',false);
  v_is_creator:=coalesce(v_party='creator',false);
  v_is_admin:=v_actor IS NOT NULL AND public.is_admin_user();
  v_actor_kind:=CASE WHEN v_actor IS NULL THEN 'system' WHEN v_is_host THEN 'host' WHEN v_is_creator THEN 'creator' WHEN v_is_admin THEN 'admin' ELSE 'unknown' END;
  v_ready:=public.issue_3872_offer_ready(v.id);
  IF v.state='offered' AND v_is_creator AND NOT v_ready THEN
    -- The creator cannot act on an offer that is not paid for yet.
    RAISE EXCEPTION 'offer_not_ready' USING ERRCODE='55000';
  END IF;
  v_fix:=v.fix_rounds_used; v_script:=v.script_rounds_used;
  v_next:=CASE
    WHEN v.state='offered' AND p_action='accept' AND v_is_creator THEN 'accepted'
    WHEN v.state='offered' AND p_action='decline' AND v_is_creator THEN 'declined'
    WHEN v.state='offered' AND p_action='cancel' AND v_is_host THEN 'cancelled'
    WHEN v.state='offered' AND p_action='expire' AND v_actor IS NULL AND v.state_deadline_at<=now() THEN 'expired'
    WHEN v.state='accepted' AND p_action='plan_confirmed' AND (v_is_host OR v_is_creator) THEN 'shoot_planned'
    WHEN v.state='shoot_planned' AND p_action='start_script' AND (v_is_host OR v_is_creator) THEN 'script_drafting'
    WHEN v.state='script_drafting' AND p_action='send_script' AND v_is_creator THEN 'script_sent'
    WHEN v.state='script_sent' AND p_action IN ('lock_script','auto_lock') AND (v_is_host OR v_actor IS NULL) THEN 'script_locked'
    WHEN v.state='script_sent' AND p_action='request_script_changes' AND v_is_host AND v_script<2 THEN 'script_drafting'
    WHEN v.state='script_locked' AND p_action='deliver' AND v_is_creator THEN 'delivered'
    WHEN v.state='delivered' AND p_action IN ('approve','auto_approve') AND (v_is_host OR v_actor IS NULL) THEN 'approved'
    WHEN v.state='delivered' AND p_action='request_fix' AND v_is_host AND v_fix<2 THEN 'fix_requested'
    WHEN v.state='fix_requested' AND p_action='deliver' AND v_is_creator THEN 'delivered'
    WHEN v.state='approved' AND p_action='start_posting' AND (v_is_host OR v_is_creator OR v_actor IS NULL) THEN 'posting'
    WHEN v.state IN ('posting','posts_failed') AND p_action='submit_posts' AND v_is_creator THEN 'posts_submitted'
    WHEN v.state='posts_submitted' AND p_action IN ('posts_passed','host_confirm','auto_confirm') AND (v_is_host OR v_actor IS NULL) THEN 'posts_verified'
    WHEN v.state='posts_submitted' AND p_action='posts_failed' AND v_actor IS NULL THEN 'posts_failed'
    WHEN v.state='posts_verified' AND p_action='release' AND v_actor IS NULL THEN 'released'
    WHEN v.state='released' AND p_action='day30' AND v_actor IS NULL THEN 'day30'
    WHEN v.state='day30' AND p_action='complete' AND v_actor IS NULL THEN 'completed'
    WHEN v.state IN ('fix_requested','posting','posts_failed') AND p_action='open_dispute' AND (v_is_host OR v_is_creator) THEN 'disputed'
    WHEN v.state='disputed' AND p_action='resolve_release' AND (v_is_admin OR v_actor IS NULL) THEN 'resolved_release'
    WHEN v.state='disputed' AND p_action='resolve_partial' AND (v_is_admin OR v_actor IS NULL) THEN 'resolved_partial'
    WHEN v.state='disputed' AND p_action='resolve_refund' AND (v_is_admin OR v_actor IS NULL) THEN 'resolved_refund'
    ELSE NULL END;
  IF v_next IS NULL THEN RAISE EXCEPTION 'illegal_transition:%:%:%',v.state,p_action,v_actor_kind USING ERRCODE='42501'; END IF;
  IF v.state='offered' AND v_next='accepted' AND NOT v_ready THEN RAISE EXCEPTION 'captured_hold_required' USING ERRCODE='55000'; END IF;
  -- Script change requests and video fixes are separate two-round budgets.
  IF v.state='script_sent' AND p_action='request_script_changes' THEN v_script:=v_script+1; END IF;
  IF v.state='delivered' AND p_action='request_fix' THEN v_fix:=v_fix+1; END IF;
  SELECT t.post_by INTO v_post_by FROM public.gig_terms_versions t WHERE t.contract_id=v.id AND t.version=v.current_terms_version;
  v_deadline:=CASE
    WHEN v_next='script_sent' THEN now()+interval '48 hours'
    -- #13: upload is due two days before post_by (end of that day, UTC). If
    -- that is already near, the creator still gets 24 hours before the timer
    -- cancels with a full host refund.
    WHEN v_next='script_locked' THEN greatest(((v_post_by-1)::timestamp AT TIME ZONE 'UTC'),now()+interval '24 hours')
    WHEN v_next='delivered' THEN now()+interval '3 days'
    WHEN v_next='posts_verified' THEN now()+interval '48 hours'
    WHEN v_next='released' THEN now()+interval '30 days'
    ELSE NULL END;
  PERFORM public.issue_3872_contract_apply_state(v.id,v_next,v_deadline,v_fix,v_script,CASE WHEN v_next='cancelled' THEN p_payload->>'reason' END);
  IF v.state='script_sent' AND p_action IN ('lock_script','auto_lock') THEN
    PERFORM set_config('issue3872.script_lock',v.id::text,true);
    UPDATE public.gig_scripts
       SET locked_at=coalesce(locked_at,now()),locked_by=coalesce(locked_by,CASE WHEN p_action='auto_lock' THEN 'auto' ELSE 'host' END)
     WHERE contract_id=v.id
       AND version=(SELECT max(s.version) FROM public.gig_scripts s WHERE s.contract_id=v.id);
    PERFORM set_config('issue3872.script_lock','',true);
  END IF;
  IF v.state='delivered' AND p_action IN ('approve','auto_approve') THEN
    UPDATE public.gig_deliveries
       SET decision=coalesce(decision,CASE WHEN p_action='auto_approve' THEN 'auto_approved' ELSE 'approved' END),
           decided_at=coalesce(decided_at,now())
     WHERE contract_id=v.id
       AND round=(SELECT max(d.round) FROM public.gig_deliveries d WHERE d.contract_id=v.id);
  END IF;
  IF v_next='completed' THEN
    UPDATE public.creator_profiles
       SET completed_gigs=completed_gigs+1,
           reliability_bps=CASE WHEN completed_gigs+1>=3 THEN least(10000,coalesce(reliability_bps,10000)) ELSE NULL END
     WHERE creator_account_id=v.creator_account_id;
  END IF;
  INSERT INTO public.gig_events(contract_id,actor,kind,data) VALUES(v.id,v_actor_kind,p_action,coalesce(p_payload,'{}'));
  RETURN jsonb_build_object('ok',true,'contract_id',v.id,'state',v_next,'deadline_at',v_deadline);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Refunds (#1, #12, #13) and release (#12).
-- ---------------------------------------------------------------------------

-- Branch legality against the contract state. One function serves both the
-- user authorisation and the service-side quote/record path.
CREATE OR REPLACE FUNCTION public.issue_3872_gig_refund_branch_allowed(p_contract_id uuid,p_branch text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
  SELECT coalesce(CASE p_branch
    WHEN 'host_before_accept' THEN c.state IN ('offered','cancelled')
    WHEN 'creator_decline' THEN c.state IN ('offered','declined')
    WHEN 'declined_or_expired' THEN (c.state='offered' AND c.state_deadline_at<=now()) OR c.state IN ('expired','declined')
    WHEN 'host_after_accept_before_lock' THEN c.state IN ('accepted','shoot_planned','script_drafting','script_sent')
    WHEN 'creator_after_accept' THEN c.state IN ('accepted','shoot_planned','script_drafting','script_sent')
    WHEN 'upload_missed' THEN c.state='script_locked' AND c.state_deadline_at<=now()
    WHEN 'resolved_partial' THEN c.state='disputed' AND EXISTS(SELECT 1 FROM public.gig_disputes d WHERE d.contract_id=c.id AND d.status='decided' AND d.decided_outcome='partial_refund')
    WHEN 'resolved_refund' THEN c.state='disputed' AND EXISTS(SELECT 1 FROM public.gig_disputes d WHERE d.contract_id=c.id AND d.status='decided' AND d.decided_outcome='full_refund')
    WHEN 'counter_lower' THEN EXISTS(SELECT 1 FROM public.gig_hold_adjustments a WHERE a.contract_id=c.id AND a.kind='refund' AND a.status='pending')
    ELSE false END,false)
  FROM public.gig_contracts c WHERE c.id=p_contract_id;
$fn$;

-- #1: a non-party got v_party NULL and NOT(NULL AND ...) is NULL, so the
-- IF never raised and any signed-in user authorised a refund. Every branch is
-- now an explicit allow-list that fails closed.
CREATE OR REPLACE FUNCTION public.gig_refund_authorize(p_contract_id uuid,p_branch text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=public,pg_temp AS $fn$
DECLARE v_actor uuid:=auth.uid(); v public.gig_contracts; v_party text; v_allowed boolean:=false;
BEGIN
  IF p_branch IS NULL OR p_branch NOT IN ('host_before_accept','host_after_accept_before_lock','creator_after_accept','creator_decline','declined_or_expired','upload_missed','counter_lower','resolved_partial','resolved_refund') THEN
    RAISE EXCEPTION 'invalid_refund_branch' USING ERRCODE='22023';
  END IF;
  IF p_branch IN ('declined_or_expired','upload_missed','counter_lower') THEN RAISE EXCEPTION 'refund_branch_requires_service' USING ERRCODE='42501'; END IF;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'refund_not_allowed' USING ERRCODE='42501'; END IF;
  SELECT * INTO v FROM public.gig_contracts WHERE id=p_contract_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'contract_not_found' USING ERRCODE='P0002'; END IF;
  v_party:=public.issue_3872_contract_party(p_contract_id,v_actor);
  v_allowed:=CASE
    WHEN p_branch IN ('host_before_accept','host_after_accept_before_lock') THEN v_party IS NOT DISTINCT FROM 'host'
    WHEN p_branch IN ('creator_after_accept','creator_decline') THEN v_party IS NOT DISTINCT FROM 'creator'
    WHEN p_branch IN ('resolved_partial','resolved_refund') THEN v_party IS NOT NULL OR public.is_admin_user()
    ELSE false END;
  IF p_branch='creator_decline' AND NOT public.issue_3872_offer_ready(v.id) THEN v_allowed:=false; END IF;
  IF NOT coalesce(v_allowed,false) OR NOT public.issue_3872_gig_refund_branch_allowed(v.id,p_branch) THEN
    RAISE EXCEPTION 'refund_not_allowed' USING ERRCODE='42501';
  END IF;
  RETURN jsonb_build_object('ok',true,'state',v.state,'party',coalesce(v_party,'admin'));
END;
$fn$;

-- The one refund amount authority. The edge never accepts a client amount or
-- percentage; partial refunds read the decided dispute (#1).
CREATE OR REPLACE FUNCTION public.gig_refund_quote(p_contract_id uuid,p_branch text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=public,pg_temp AS $fn$
DECLARE
  v public.gig_contracts; v_hold public.gig_holds; v_terms public.gig_terms_versions;
  v_fee bigint; v_booking bigint; v_refund bigint; v_creator bigint; v_bps integer;
  v_counter_pending bigint; v_counter_done bigint; v_base_left bigint; v_topups_left bigint; v_left bigint;
  v_sources jsonb:='[]'::jsonb; v_row record; v_part bigint;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'service_role_only' USING ERRCODE='42501'; END IF;
  SELECT * INTO v FROM public.gig_contracts WHERE id=p_contract_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'contract_not_found' USING ERRCODE='P0002'; END IF;
  IF NOT public.issue_3872_gig_refund_branch_allowed(v.id,p_branch) THEN RAISE EXCEPTION 'refund_not_allowed' USING ERRCODE='55000'; END IF;
  SELECT * INTO v_hold FROM public.gig_holds WHERE contract_id=v.id AND terms_version=v.current_terms_version;
  IF NOT FOUND OR v_hold.status<>'captured' OR v_hold.provider_ref IS NULL THEN RAISE EXCEPTION 'captured_hold_required' USING ERRCODE='55000'; END IF;
  SELECT * INTO v_terms FROM public.gig_terms_versions WHERE contract_id=v.id AND version=v.current_terms_version;
  v_fee:=v_terms.fee_minor; v_booking:=v_terms.booking_fee_minor;
  SELECT coalesce(sum(amount_minor) FILTER (WHERE status='pending'),0),coalesce(sum(amount_minor) FILTER (WHERE status='refunded'),0)
    INTO v_counter_pending,v_counter_done
    FROM public.gig_hold_adjustments WHERE contract_id=v.id AND kind='refund';
  v_base_left:=v_hold.amount_minor-v_hold.refunded_minor-v_counter_done;
  SELECT coalesce(sum(amount_minor-refunded_minor),0) INTO v_topups_left
    FROM public.gig_hold_adjustments WHERE contract_id=v.id AND kind='topup' AND status='captured';
  v_left:=v_base_left+v_topups_left;
  IF p_branch='counter_lower' THEN
    v_refund:=v_counter_pending; v_creator:=0;
  ELSIF p_branch='host_after_accept_before_lock' THEN
    v_refund:=(v_fee*7500)/10000+v_booking; v_creator:=v_fee-(v_fee*7500)/10000;
  ELSIF p_branch='resolved_partial' THEN
    SELECT decided_refund_bps INTO v_bps FROM public.gig_disputes WHERE contract_id=v.id AND status='decided' AND decided_outcome='partial_refund' ORDER BY decided_at DESC LIMIT 1;
    IF v_bps IS NULL OR v_bps NOT BETWEEN 0 AND 10000 THEN RAISE EXCEPTION 'refund_bps_invalid' USING ERRCODE='22023'; END IF;
    v_refund:=(v_fee*v_bps)/10000+CASE WHEN v_bps=10000 THEN v_booking ELSE 0 END;
    v_creator:=v_fee-(v_fee*v_bps)/10000;
  ELSE
    -- Full refunds return everything still held, including a not-yet-paid
    -- lower-counter difference.
    v_refund:=v_fee+v_booking+v_counter_pending; v_creator:=0;
  END IF;
  v_refund:=least(v_refund,v_left);
  -- Split across the captured provider payments: base charge first.
  v_part:=least(v_refund,v_base_left);
  IF v_part>0 THEN v_sources:=v_sources||jsonb_build_array(jsonb_build_object('kind','base','id',v_hold.id,'provider_ref',v_hold.provider_ref,'amount_minor',v_part)); END IF;
  v_left:=v_refund-greatest(v_part,0);
  FOR v_row IN SELECT id,provider_ref,amount_minor-refunded_minor AS available FROM public.gig_hold_adjustments
    WHERE contract_id=v.id AND kind='topup' AND status='captured' ORDER BY created_at,id LOOP
    EXIT WHEN v_left<=0;
    v_part:=least(v_left,v_row.available);
    IF v_part>0 THEN
      v_sources:=v_sources||jsonb_build_array(jsonb_build_object('kind','topup','id',v_row.id,'provider_ref',v_row.provider_ref,'amount_minor',v_part));
      v_left:=v_left-v_part;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('refund_minor',v_refund,'creator_fee_minor',v_creator,'currency',v_terms.currency,'rail',v_hold.rail,'sources',v_sources,'branch',p_branch);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.gig_refund_record(p_contract_id uuid,p_branch text,p_refund_minor bigint,p_creator_fee_minor bigint,p_provider_ref text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE
  v public.gig_contracts; v_hold public.gig_holds; v_terms public.gig_terms_versions; v_target text; v_share uuid;
  v_quote jsonb; v_source jsonb; v_refunded bigint; v_existing_share public.payee_shares; v_total_held bigint;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'service_role_only' USING ERRCODE='42501'; END IF;
  SELECT * INTO v FROM public.gig_contracts WHERE id=p_contract_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'contract_not_found' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_hold FROM public.gig_holds WHERE contract_id=v.id AND terms_version=v.current_terms_version FOR UPDATE;
  SELECT * INTO v_terms FROM public.gig_terms_versions WHERE contract_id=v.id AND version=v.current_terms_version;

  IF p_branch='counter_lower' THEN
    -- A replay after the pending difference was refunded is a no-op.
    IF NOT EXISTS(SELECT 1 FROM public.gig_hold_adjustments WHERE contract_id=v.id AND kind='refund' AND status='pending') THEN
      IF EXISTS(SELECT 1 FROM public.gig_hold_adjustments WHERE contract_id=v.id AND kind='refund' AND status='refunded' AND provider_ref=p_provider_ref) THEN
        RETURN jsonb_build_object('ok',true,'replayed',true);
      END IF;
      RAISE EXCEPTION 'refund_not_allowed' USING ERRCODE='55000';
    END IF;
    v_quote:=public.gig_refund_quote(v.id,p_branch);
    IF (v_quote->>'refund_minor')::bigint<>p_refund_minor OR p_creator_fee_minor<>0 THEN RAISE EXCEPTION 'refund_amount_mismatch' USING ERRCODE='22023'; END IF;
    UPDATE public.gig_hold_adjustments SET status='refunded',refunded_minor=amount_minor,provider_ref=p_provider_ref
     WHERE contract_id=v.id AND kind='refund' AND status='pending';
    INSERT INTO public.gig_events(contract_id,actor,kind,data) VALUES(v.id,'system','counter_refund_recorded',jsonb_build_object('refund_minor',p_refund_minor,'provider_ref',p_provider_ref));
    RETURN jsonb_build_object('ok',true,'state',v.state);
  END IF;

  -- #12: a replay is accepted only with the same branch and amounts. It used
  -- to overwrite the share and could flip a paid share back to releasable.
  IF v_hold.status IN ('refunded','partially_refunded') THEN
    SELECT v_hold.refunded_minor+coalesce(sum(a.refunded_minor),0) INTO v_refunded
      FROM public.gig_hold_adjustments a WHERE a.contract_id=v.id AND a.kind='topup';
    SELECT * INTO v_existing_share FROM public.payee_shares WHERE order_kind='gig' AND order_id=v.id AND payee_kind='gig_fee';
    IF v.cancel_reason IS NOT DISTINCT FROM p_branch AND v_refunded=p_refund_minor
       AND coalesce(v_existing_share.gross_minor,0)=p_creator_fee_minor THEN
      RETURN jsonb_build_object('ok',true,'replayed',true,'state',v.state,'share_id',v_existing_share.id);
    END IF;
    RAISE EXCEPTION 'refund_replay_mismatch' USING ERRCODE='55000';
  END IF;
  IF v_hold.id IS NULL OR v_hold.status<>'captured' THEN RAISE EXCEPTION 'captured_hold_required' USING ERRCODE='55000'; END IF;

  v_quote:=public.gig_refund_quote(v.id,p_branch);
  IF (v_quote->>'refund_minor')::bigint<>p_refund_minor OR (v_quote->>'creator_fee_minor')::bigint<>p_creator_fee_minor THEN
    RAISE EXCEPTION 'refund_amount_mismatch' USING ERRCODE='22023';
  END IF;
  v_target:=CASE
    WHEN p_branch='creator_decline' THEN 'declined'
    WHEN p_branch='declined_or_expired' AND v.state='offered' THEN 'expired'
    WHEN p_branch IN ('host_before_accept','host_after_accept_before_lock','creator_after_accept','upload_missed') THEN 'cancelled'
    WHEN p_branch IN ('resolved_partial','resolved_refund') THEN p_branch
    ELSE v.state END;
  IF p_creator_fee_minor>0 THEN
    INSERT INTO public.payee_shares(order_kind,order_id,payee_kind,member_id,payee_user_id,brand_id,rail,currency,gross_minor,mingla_fee_minor,net_minor,status,release_after)
    VALUES('gig',v.id,'gig_fee',NULL,v.creator_account_id,v.brand_id,v_hold.rail,v_terms.currency,p_creator_fee_minor,0,p_creator_fee_minor,'releasable',now())
    ON CONFLICT(order_kind,order_id,payee_kind) DO NOTHING RETURNING id INTO v_share;
    IF v_share IS NULL THEN RAISE EXCEPTION 'gig_fee_share_exists' USING ERRCODE='55000'; END IF;
  END IF;
  SELECT v_hold.amount_minor-coalesce(sum(a.amount_minor) FILTER (WHERE a.kind='refund' AND a.status='refunded'),0)
       +coalesce(sum(a.amount_minor) FILTER (WHERE a.kind='topup' AND a.status='captured'),0)
    INTO v_total_held FROM public.gig_hold_adjustments a WHERE a.contract_id=v.id;
  FOR v_source IN SELECT value FROM jsonb_array_elements(v_quote->'sources') LOOP
    IF v_source->>'kind'='base' THEN
      UPDATE public.gig_holds SET refunded_minor=refunded_minor+(v_source->>'amount_minor')::bigint WHERE id=v_hold.id;
    ELSE
      UPDATE public.gig_hold_adjustments SET refunded_minor=refunded_minor+(v_source->>'amount_minor')::bigint,
        status=CASE WHEN refunded_minor+(v_source->>'amount_minor')::bigint=amount_minor THEN 'refunded' ELSE 'partially_refunded' END
       WHERE id=(v_source->>'id')::uuid;
    END IF;
  END LOOP;
  UPDATE public.gig_holds SET status=CASE WHEN p_refund_minor>=v_total_held THEN 'refunded' ELSE 'partially_refunded' END WHERE id=v_hold.id;
  -- Anything still pending (unpaid top-up, unpaid counter refund) is folded
  -- into this refund and closed.
  UPDATE public.gig_hold_adjustments SET status='superseded' WHERE contract_id=v.id AND status='pending';
  IF p_branch IN ('creator_after_accept','resolved_refund','upload_missed') THEN -- Reliability is only shown from three completed gigs (table check), so the
    -- penalty applies from then on instead of violating the constraint.
    UPDATE public.creator_profiles SET reliability_bps=CASE WHEN completed_gigs>=3 THEN greatest(0,coalesce(reliability_bps,10000)-1000) END WHERE creator_account_id=v.creator_account_id; END IF;
  IF v_target<>v.state OR v.cancel_reason IS DISTINCT FROM p_branch THEN
    PERFORM public.issue_3872_contract_apply_state(v.id,v_target,NULL,NULL,NULL,NULL);
    UPDATE public.gig_contracts SET cancel_reason=p_branch WHERE id=v.id;
  END IF;
  INSERT INTO public.gig_events(contract_id,actor,kind,data) VALUES(v.id,'system','refund_recorded',jsonb_build_object('branch',p_branch,'refund_minor',p_refund_minor,'creator_fee_minor',p_creator_fee_minor,'provider_ref',p_provider_ref,'share_id',v_share));
  RETURN jsonb_build_object('ok',true,'state',v_target,'share_id',v_share);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.gig_release_record(p_contract_id uuid,p_provider_ref text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v public.gig_contracts; v_hold public.gig_holds; v_terms public.gig_terms_versions; v_share uuid;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'service_role_only' USING ERRCODE='42501'; END IF;
  SELECT * INTO v FROM public.gig_contracts WHERE id=p_contract_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'release_not_ready' USING ERRCODE='55000'; END IF;
  SELECT * INTO v_hold FROM public.gig_holds WHERE contract_id=v.id AND terms_version=v.current_terms_version FOR UPDATE;
  SELECT * INTO v_terms FROM public.gig_terms_versions WHERE contract_id=v.id AND version=v.current_terms_version;
  -- #12: a replay used to hit release_not_ready because the first call had
  -- already moved the contract on. The released hold is the replay proof.
  IF v_hold.status='released' THEN
    SELECT id INTO v_share FROM public.payee_shares WHERE order_kind='gig' AND order_id=v.id AND payee_kind='gig_fee';
    RETURN jsonb_build_object('ok',true,'replayed',true,'share_id',v_share,'rail',v_hold.rail);
  END IF;
  IF NOT (v.state='posts_verified' OR (v.state='disputed' AND EXISTS(SELECT 1 FROM public.gig_disputes d WHERE d.contract_id=v.id AND d.status='decided' AND d.decided_outcome='release'))) THEN RAISE EXCEPTION 'release_not_ready' USING ERRCODE='55000'; END IF;
  IF v_hold.status<>'captured' THEN RAISE EXCEPTION 'captured_hold_required' USING ERRCODE='55000'; END IF;
  INSERT INTO public.payee_shares(order_kind,order_id,payee_kind,member_id,payee_user_id,brand_id,rail,currency,gross_minor,mingla_fee_minor,net_minor,status,release_after)
  VALUES('gig',v.id,'gig_fee',NULL,v.creator_account_id,v.brand_id,v_hold.rail,v_terms.currency,v_terms.fee_minor,0,v_terms.fee_minor,CASE WHEN v_hold.rail='stripe' THEN 'paid' ELSE 'releasable' END,now())
  ON CONFLICT(order_kind,order_id,payee_kind) DO NOTHING RETURNING id INTO v_share;
  IF v_share IS NULL THEN RAISE EXCEPTION 'gig_fee_share_exists' USING ERRCODE='55000'; END IF;
  UPDATE public.gig_holds SET status='released' WHERE id=v_hold.id;
  UPDATE public.gig_hold_adjustments SET status='released' WHERE contract_id=v.id AND kind='topup' AND status='captured';
  IF v.state='posts_verified' THEN
    PERFORM public.gig_transition(v.id,'posts_verified','release',jsonb_build_object('provider_ref',p_provider_ref,'share_id',v_share));
  ELSE
    PERFORM public.issue_3872_contract_apply_state(v.id,'resolved_release',NULL,NULL,NULL,NULL);
    INSERT INTO public.gig_events(contract_id,actor,kind,data) VALUES(v.id,'system','dispute_release_recorded',jsonb_build_object('provider_ref',p_provider_ref,'share_id',v_share));
  END IF;
  RETURN jsonb_build_object('ok',true,'share_id',v_share,'rail',v_hold.rail);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Counter-offers (contract: gig_counter_send / gig_counter_respond / top-up).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gig_counter_send(p_contract_id uuid,p_fee_minor bigint,p_note text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_actor uuid:=auth.uid(); v public.gig_contracts; v_terms public.gig_terms_versions; v_gig public.gigs; v_hits text[]; v_id uuid;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='28000'; END IF;
  SELECT * INTO v FROM public.gig_contracts WHERE id=p_contract_id FOR UPDATE;
  IF NOT FOUND OR v.creator_account_id<>v_actor THEN RAISE EXCEPTION 'permission_denied' USING ERRCODE='42501'; END IF;
  IF v.state<>'offered' OR NOT public.issue_3872_offer_ready(v.id) THEN RETURN jsonb_build_object('ok',false,'error','counter_not_open'); END IF;
  IF p_fee_minor IS NULL OR p_fee_minor<=0 THEN RETURN jsonb_build_object('ok',false,'error','fee_invalid','field','fee_minor'); END IF;
  SELECT * INTO v_terms FROM public.gig_terms_versions WHERE contract_id=v.id AND version=v.current_terms_version;
  IF p_fee_minor=v_terms.fee_minor THEN RETURN jsonb_build_object('ok',false,'error','fee_unchanged','field','fee_minor'); END IF;
  IF char_length(btrim(coalesce(p_note,'')))>300 THEN RETURN jsonb_build_object('ok',false,'error','note_too_long','field','note'); END IF;
  SELECT * INTO v_gig FROM public.gigs WHERE id=v.gig_id;
  v_hits:=public.issue_3872_brief_lint(v_gig.brand_id,v_gig.listing_kind,v_gig.listing_id,coalesce(p_note,''));
  IF cardinality(v_hits)>0 THEN RETURN jsonb_build_object('ok',false,'error','note_not_anonymous','reasons',to_jsonb(v_hits),'field','note'); END IF;
  UPDATE public.gig_change_proposals SET status='expired' WHERE contract_id=v.id AND status='open' AND expires_at<=now();
  IF EXISTS(SELECT 1 FROM public.gig_change_proposals WHERE contract_id=v.id AND status='open') THEN
    RETURN jsonb_build_object('ok',false,'error','counter_already_open');
  END IF;
  INSERT INTO public.gig_change_proposals(contract_id,from_version,proposed_by,changes,reason,note,expires_at)
  VALUES(v.id,v.current_terms_version,'creator',jsonb_build_object('fee_minor',p_fee_minor),'price',nullif(btrim(p_note),''),
    least(now()+interval '48 hours',coalesce(v.state_deadline_at,now()+interval '48 hours')))
  RETURNING id INTO v_id;
  INSERT INTO public.gig_events(contract_id,actor,kind,data) VALUES(v.id,'creator','counter_sent',jsonb_build_object('proposal_id',v_id,'fee_minor',p_fee_minor,'from_version',v.current_terms_version));
  RETURN jsonb_build_object('ok',true,'proposal_id',v_id);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.gig_counter_respond(p_proposal_id uuid,p_accept boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE
  v_actor uuid:=auth.uid(); v_proposal public.gig_change_proposals; v public.gig_contracts; v_terms public.gig_terms_versions;
  v_hold public.gig_holds; v_fee bigint; v_booking bigint; v_old_total bigint; v_new_total bigint; v_next integer;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='28000'; END IF;
  SELECT * INTO v_proposal FROM public.gig_change_proposals WHERE id=p_proposal_id FOR UPDATE;
  IF NOT FOUND OR v_proposal.reason<>'price' OR v_proposal.proposed_by<>'creator' THEN RAISE EXCEPTION 'counter_not_found' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v FROM public.gig_contracts WHERE id=v_proposal.contract_id FOR UPDATE;
  IF NOT public.issue_3872_gig_host_writer(v.brand_id,v_actor) THEN RAISE EXCEPTION 'permission_denied' USING ERRCODE='42501'; END IF;
  IF NOT public.issue_3872_creator_gigs_on(v.brand_id) THEN RAISE EXCEPTION 'creator_gigs_disabled' USING ERRCODE='55000'; END IF;
  IF v_proposal.status<>'open' OR v_proposal.expires_at<=now() OR v_proposal.from_version<>v.current_terms_version OR v.state<>'offered' THEN
    RETURN jsonb_build_object('ok',false,'error','counter_stale');
  END IF;
  IF NOT coalesce(p_accept,false) THEN
    UPDATE public.gig_change_proposals SET status='declined' WHERE id=v_proposal.id;
    INSERT INTO public.gig_events(contract_id,actor,kind,data) VALUES(v.id,'host','counter_declined',jsonb_build_object('proposal_id',v_proposal.id));
    RETURN jsonb_build_object('ok',true,'accepted',false,'terms_version',v.current_terms_version,'requires_topup',false,'topup_minor',0,'refund_minor',0);
  END IF;
  SELECT * INTO v_terms FROM public.gig_terms_versions WHERE contract_id=v.id AND version=v.current_terms_version;
  SELECT * INTO v_hold FROM public.gig_holds WHERE contract_id=v.id AND terms_version=v.current_terms_version FOR UPDATE;
  IF v_hold.status<>'captured' THEN RETURN jsonb_build_object('ok',false,'error','counter_stale'); END IF;
  v_fee:=(v_proposal.changes->>'fee_minor')::bigint;
  v_booking:=((v_fee*1500+5000)/10000);
  v_old_total:=v_terms.fee_minor+v_terms.booking_fee_minor;
  v_new_total:=v_fee+v_booking;
  v_next:=v.current_terms_version+1;
  INSERT INTO public.gig_terms_versions(contract_id,version,fee_minor,booking_fee_minor,currency,format_key,deliverables,shoot_date,post_by,usage_days,sales_share_bps,shoot_passes,proposed_by,accepted_at)
  VALUES(v.id,v_next,v_fee,v_booking,v_terms.currency,v_terms.format_key,v_terms.deliverables,v_terms.shoot_date,v_terms.post_by,v_terms.usage_days,v_terms.sales_share_bps,v_terms.shoot_passes,'creator',now());
  -- The captured base hold follows the current terms version, exactly like
  -- gig_change_proposal_respond. The difference lives in an adjustment row.
  UPDATE public.gig_holds SET terms_version=v_next WHERE id=v_hold.id;
  UPDATE public.gig_contracts SET current_terms_version=v_next,state_deadline_at=now()+interval '48 hours' WHERE id=v.id;
  IF v_new_total>v_old_total THEN
    INSERT INTO public.gig_hold_adjustments(contract_id,proposal_id,kind,terms_version,rail,amount_minor,currency)
    VALUES(v.id,v_proposal.id,'topup',v_next,v_hold.rail,v_new_total-v_old_total,v_hold.currency);
  ELSIF v_new_total<v_old_total THEN
    INSERT INTO public.gig_hold_adjustments(contract_id,proposal_id,kind,terms_version,rail,amount_minor,currency)
    VALUES(v.id,v_proposal.id,'refund',v_next,v_hold.rail,v_old_total-v_new_total,v_hold.currency);
  END IF;
  UPDATE public.gig_change_proposals SET status='accepted' WHERE id=v_proposal.id;
  INSERT INTO public.gig_events(contract_id,actor,kind,data) VALUES(v.id,'host','counter_accepted',jsonb_build_object('proposal_id',v_proposal.id,'version',v_next,'fee_minor',v_fee));
  RETURN jsonb_build_object('ok',true,'accepted',true,'terms_version',v_next,
    'requires_topup',v_new_total>v_old_total,'topup_minor',greatest(v_new_total-v_old_total,0),
    'refund_minor',greatest(v_old_total-v_new_total,0));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.gig_topup_prepare(p_contract_id uuid,p_terms_version integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=public,pg_temp AS $fn$
DECLARE v public.gig_contracts; v_adj public.gig_hold_adjustments; v_new public.gig_terms_versions; v_old public.gig_terms_versions;
BEGIN
  SELECT * INTO v FROM public.gig_contracts WHERE id=p_contract_id;
  IF NOT FOUND OR NOT public.issue_3872_gig_host_writer(v.brand_id,auth.uid()) THEN RAISE EXCEPTION 'permission_denied' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_adj FROM public.gig_hold_adjustments WHERE contract_id=v.id AND kind='topup' AND status='pending' AND terms_version=p_terms_version;
  IF NOT FOUND OR v.state<>'offered' THEN RETURN jsonb_build_object('ok',false,'error','topup_not_pending'); END IF;
  SELECT * INTO v_new FROM public.gig_terms_versions WHERE contract_id=v.id AND version=p_terms_version;
  SELECT * INTO v_old FROM public.gig_terms_versions WHERE contract_id=v.id AND version=p_terms_version-1;
  RETURN jsonb_build_object('ok',true,'contract_id',v.id,'terms_version',p_terms_version,'rail',v_adj.rail,
    'fee_minor',v_new.fee_minor-v_old.fee_minor,'booking_fee_minor',v_new.booking_fee_minor-v_old.booking_fee_minor,
    'total_minor',v_adj.amount_minor,'currency',v_adj.currency,'adjustment_id',v_adj.id);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.gig_topup_mark_captured(p_contract_id uuid,p_terms_version integer,p_provider_ref text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_adj public.gig_hold_adjustments;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'service_role_only' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.gig_contracts WHERE id=p_contract_id FOR UPDATE;
  SELECT * INTO v_adj FROM public.gig_hold_adjustments WHERE contract_id=p_contract_id AND kind='topup' AND terms_version=p_terms_version ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'topup_not_found' USING ERRCODE='P0002'; END IF;
  IF v_adj.status<>'pending' THEN
    IF v_adj.status IN ('captured','released','refunded','partially_refunded') AND v_adj.provider_ref IS NOT DISTINCT FROM p_provider_ref THEN
      RETURN to_jsonb(v_adj)||jsonb_build_object('replayed',true);
    END IF;
    RAISE EXCEPTION 'topup_not_pending' USING ERRCODE='55000';
  END IF;
  UPDATE public.gig_hold_adjustments SET status='captured',provider_ref=p_provider_ref,captured_at=now() WHERE id=v_adj.id RETURNING * INTO v_adj;
  UPDATE public.gig_contracts SET state_deadline_at=now()+interval '48 hours' WHERE id=p_contract_id AND state='offered';
  INSERT INTO public.gig_events(contract_id,actor,kind,data) VALUES(p_contract_id,'system','topup_captured',jsonb_build_object('terms_version',p_terms_version,'amount_minor',v_adj.amount_minor));
  RETURN to_jsonb(v_adj)||jsonb_build_object('replayed',false);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Homes and workspace.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_3872_creator_next_action(p_state text) RETURNS text
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE p_state
    WHEN 'offered' THEN 'answer_offer'
    WHEN 'accepted' THEN 'plan_shoot' WHEN 'shoot_planned' THEN 'plan_shoot'
    WHEN 'script_drafting' THEN 'write_script' WHEN 'script_sent' THEN 'script_with_host'
    WHEN 'script_locked' THEN 'film_upload' WHEN 'delivered' THEN 'video_with_host'
    WHEN 'fix_requested' THEN 'fix_requested'
    WHEN 'approved' THEN 'post_links' WHEN 'posting' THEN 'post_links' WHEN 'posts_failed' THEN 'fix_posts'
    WHEN 'posts_submitted' THEN 'checking_posts' WHEN 'posts_verified' THEN 'posts_verified'
    WHEN 'released' THEN 'payment_released' WHEN 'day30' THEN 'payment_released' WHEN 'resolved_release' THEN 'payment_released'
    WHEN 'completed' THEN 'done' WHEN 'disputed' THEN 'in_dispute'
    WHEN 'declined' THEN 'declined' WHEN 'expired' THEN 'expired' WHEN 'cancelled' THEN 'cancelled'
    WHEN 'resolved_partial' THEN 'dispute_resolved' WHEN 'resolved_refund' THEN 'dispute_resolved'
    ELSE 'none' END;
$fn$;

CREATE OR REPLACE FUNCTION public.gig_creator_home() RETURNS jsonb
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=public,pg_temp AS $fn$
  SELECT jsonb_build_object(
    'contracts',coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id',c.id,'state',c.state,'deadline_at',c.state_deadline_at,'title',g.title_public,
        'format_key',g.format_key,'city',sc.name,'post_by',coalesce(tv.post_by,g.post_by),
        'fee_minor',tv.fee_minor,'currency',tv.currency,'updated_at',c.updated_at,
        'next_action',public.issue_3872_creator_next_action(c.state),
        'due_at',CASE WHEN c.state IN ('approved','posting','posts_failed') THEN ((coalesce(tv.post_by,g.post_by)+1)::timestamp AT TIME ZONE 'UTC') ELSE c.state_deadline_at END,
        'fix_rounds_used',c.fix_rounds_used,'script_rounds_used',c.script_rounds_used,
        'counter_open',EXISTS(SELECT 1 FROM public.gig_change_proposals p WHERE p.contract_id=c.id AND p.status='open' AND p.reason='price')
      ) ORDER BY c.updated_at DESC)
      FROM public.gig_contracts c
      JOIN public.gigs g ON g.id=c.gig_id
      JOIN public.seeding_cities sc ON sc.id=g.city_id
      LEFT JOIN public.gig_terms_versions tv ON tv.contract_id=c.id AND tv.version=c.current_terms_version
      WHERE c.creator_account_id=auth.uid()
        -- #7: unpaid offers and offers retired for non-payment never reach the creator.
        AND (c.state<>'offered' OR public.issue_3872_offer_ready(c.id))
        AND c.cancel_reason IS DISTINCT FROM 'payment_not_completed'
    ),'[]'::jsonb),
    'interests',coalesce((
      SELECT jsonb_agg(jsonb_build_object('id',i.id,'gig_id',i.gig_id,'title',g.title_public,'status',i.status,'quote_minor',i.quoted_minor,'currency',coalesce(cp.currency,g.currency),'created_at',i.created_at) ORDER BY i.created_at DESC)
      FROM public.gig_interest i JOIN public.gigs g ON g.id=i.gig_id LEFT JOIN public.creator_packages cp ON cp.id=i.package_id
      WHERE i.creator_account_id=auth.uid() AND i.status IN ('sent','shortlisted')
    ),'[]'::jsonb),
    'saved',public.creator_saved_gigs()
  );
$fn$;

CREATE OR REPLACE FUNCTION public.gig_host_home(p_brand_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=public,pg_temp AS $fn$
  SELECT CASE WHEN public.biz_is_brand_member_for_read(p_brand_id,auth.uid()) THEN jsonb_build_object(
    'gigs',coalesce((SELECT jsonb_agg(to_jsonb(g)||jsonb_build_object(
        'interest_count',(SELECT count(*) FROM public.gig_interest i WHERE i.gig_id=g.id AND i.status IN ('sent','shortlisted')),
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

CREATE OR REPLACE FUNCTION public.gig_contract_workspace(p_contract_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=public,pg_temp AS $fn$
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
  RETURN v_result;
END;
$fn$;

-- Creators read their contract rows only once the offer is real (#7).
DROP POLICY IF EXISTS contracts_party_read ON public.gig_contracts;
CREATE POLICY contracts_party_read ON public.gig_contracts FOR SELECT TO authenticated USING(
  (creator_account_id=auth.uid() AND (state<>'offered' OR public.issue_3872_offer_ready(id)))
  OR public.biz_is_brand_member_for_read(brand_id,auth.uid())
);

-- Host results per hired creator, from the contract's referral member.
CREATE OR REPLACE FUNCTION public.gig_results(p_brand_id uuid,p_gig_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=public,pg_temp AS $fn$
BEGIN
  IF NOT public.biz_is_brand_member_for_read(p_brand_id,auth.uid()) THEN RAISE EXCEPTION 'permission_denied' USING ERRCODE='42501'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'contract_id',c.id,'gig_id',g.id,'gig_title',g.title_public,'creator_id',c.creator_account_id,
      'creator_display_name',p.display_name,'fee_minor',tv.fee_minor,'currency',tv.currency,
      'orders',coalesce(st.orders,0),'tickets',coalesce(st.tickets,0),'sold_minor',coalesce(st.sold_minor,0),
      'clicks',coalesce((SELECT count(*) FROM public.attribution_touches t WHERE c.referral_member_id IS NOT NULL AND t.member_id=c.referral_member_id),0)
    ) ORDER BY c.created_at DESC)
    FROM public.gig_contracts c
    JOIN public.gigs g ON g.id=c.gig_id
    JOIN public.creator_profiles p ON p.creator_account_id=c.creator_account_id
    LEFT JOIN public.gig_terms_versions tv ON tv.contract_id=c.id AND tv.version=c.current_terms_version
    LEFT JOIN LATERAL (
      SELECT count(*)::integer AS orders,
        coalesce(sum(a.eligible_minor),0)::bigint AS sold_minor,
        coalesce(sum((SELECT count(*) FROM public.tickets tk WHERE a.order_kind='ticket' AND tk.order_id=a.order_id)),0)::integer AS tickets
      FROM public.order_attributions a
      WHERE c.referral_member_id IS NOT NULL AND a.member_id=c.referral_member_id AND a.rejected_reason IS NULL
    ) st ON true
    WHERE c.brand_id=p_brand_id AND (p_gig_id IS NULL OR c.gig_id=p_gig_id)
      AND c.state NOT IN ('offered','declined','expired','cancelled')
  ),'[]'::jsonb);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Creator identity: verification states, checks, DOB at the agreement.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_3872_recompute_creator_verification(
  p_creator_account_id uuid,
  p_signal_conflict boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE
  v_profile public.creator_profiles; v_reasons text[]:='{}';
  v_has_handle boolean; v_age_ok boolean; v_payee_ok boolean; v_showcase_ok boolean; v_agreement_ok boolean; v_next text;
BEGIN
  SELECT * INTO v_profile FROM public.creator_profiles WHERE creator_account_id=p_creator_account_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'creator_profile_not_found' USING ERRCODE='P0002'; END IF;
  SELECT EXISTS(SELECT 1 FROM public.creator_handles WHERE creator_account_id=p_creator_account_id AND verified_at IS NOT NULL AND NOT review_required) INTO v_has_handle;
  v_age_ok:=v_profile.date_of_birth IS NOT NULL AND v_profile.date_of_birth<=(current_date-interval '18 years')::date;
  SELECT EXISTS(SELECT 1 FROM public.payee_accounts WHERE user_id=p_creator_account_id AND (stripe_status='active' OR paystack_status='verified')) INTO v_payee_ok;
  SELECT EXISTS(SELECT 1 FROM public.creator_media_jobs WHERE owner_kind='creator' AND owner_id=p_creator_account_id AND purpose='showcase' AND status='ready' AND deleted_at IS NULL) INTO v_showcase_ok;
  v_agreement_ok:=v_profile.agreement_version IS NOT NULL AND v_profile.agreement_signed_at IS NOT NULL;
  IF NOT v_has_handle THEN v_reasons:=array_append(v_reasons,'verified_handle'); END IF;
  IF NOT v_age_ok THEN v_reasons:=array_append(v_reasons,'age_18_plus'); END IF;
  IF NOT v_payee_ok THEN v_reasons:=array_append(v_reasons,'active_payout'); END IF;
  IF NOT v_showcase_ok THEN v_reasons:=array_append(v_reasons,'processed_showcase'); END IF;
  IF NOT v_agreement_ok THEN v_reasons:=array_append(v_reasons,'signed_agreement'); END IF;
  v_next:=CASE
    -- Mingla decisions stick until Mingla changes them.
    WHEN v_profile.verification IN ('declined','suspended') THEN v_profile.verification
    WHEN p_signal_conflict OR EXISTS(SELECT 1 FROM public.creator_handles WHERE creator_account_id=p_creator_account_id AND review_required) THEN 'review'
    -- Asked for more: once everything is in, a person looks again.
    WHEN v_profile.verification='needs_more' THEN CASE WHEN cardinality(v_reasons)=0 THEN 'review' ELSE 'needs_more' END
    -- A review a person reopened (after asking for more) waits for a person.
    WHEN v_profile.verification='review' AND v_profile.reviewed_at IS NOT NULL THEN 'review'
    WHEN cardinality(v_reasons)=0 THEN 'verified'
    ELSE 'incomplete' END;
  UPDATE public.creator_profiles SET verification=v_next,verification_reasons=v_reasons
   WHERE creator_account_id=p_creator_account_id RETURNING * INTO v_profile;
  RETURN jsonb_build_object('verification',v_profile.verification,'missing',v_profile.verification_reasons);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.creator_profile_save(
  p_display_name text,p_bio text,p_home_city_id uuid,p_niches text[],p_languages text[],
  p_date_of_birth date,p_usage_ads_opt_in boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_id uuid:=auth.uid(); v_was_verified boolean; v_result jsonb; v_dob date;
BEGIN
  IF v_id IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='28000'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.creator_accounts WHERE id=v_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'creator_account_required' USING ERRCODE='P0002';
  END IF;
  SELECT verification='verified' INTO v_was_verified FROM public.creator_profiles WHERE creator_account_id=v_id;
  -- DOB may be unknown until the agreement step; a null here never erases
  -- the date the creator gave when signing.
  INSERT INTO public.creator_profiles(creator_account_id,display_name,bio,home_city_id,niches,languages,date_of_birth,usage_ads_opt_in,mode_enabled)
  VALUES(v_id,btrim(p_display_name),nullif(btrim(p_bio),''),p_home_city_id,coalesce(p_niches,'{}'),coalesce(p_languages,'{}'),p_date_of_birth,coalesce(p_usage_ads_opt_in,false),true)
  ON CONFLICT(creator_account_id) DO UPDATE SET
    display_name=excluded.display_name,bio=excluded.bio,home_city_id=excluded.home_city_id,
    niches=excluded.niches,languages=excluded.languages,
    date_of_birth=coalesce(excluded.date_of_birth,public.creator_profiles.date_of_birth),
    usage_ads_opt_in=excluded.usage_ads_opt_in;
  SELECT date_of_birth INTO v_dob FROM public.creator_profiles WHERE creator_account_id=v_id;
  v_result:=public.issue_3872_recompute_creator_verification(v_id,coalesce(v_was_verified,false) AND v_dob IS NOT NULL AND v_dob>(current_date-interval '18 years')::date);
  RETURN jsonb_build_object('ok',true,'verification',v_result);
END;
$fn$;

DROP FUNCTION IF EXISTS public.creator_agreement_sign(text);
CREATE OR REPLACE FUNCTION public.creator_agreement_sign(p_agreement_version text,p_date_of_birth date) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_id uuid:=auth.uid(); v_result jsonb;
BEGIN
  IF v_id IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='28000'; END IF;
  IF p_agreement_version IS NULL OR char_length(btrim(p_agreement_version)) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION 'approved_agreement_version_required' USING ERRCODE='22023';
  END IF;
  IF p_date_of_birth IS NULL THEN RETURN jsonb_build_object('ok',false,'error','date_of_birth_required','field','date_of_birth'); END IF;
  IF p_date_of_birth<DATE '1900-01-01' OR p_date_of_birth>current_date THEN RETURN jsonb_build_object('ok',false,'error','date_of_birth_invalid','field','date_of_birth'); END IF;
  IF p_date_of_birth>(current_date-interval '18 years')::date THEN RETURN jsonb_build_object('ok',false,'error','must_be_18','field','date_of_birth'); END IF;
  UPDATE public.creator_profiles SET agreement_version=btrim(p_agreement_version),agreement_signed_at=now(),date_of_birth=p_date_of_birth
   WHERE creator_account_id=v_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'creator_profile_required' USING ERRCODE='P0002'; END IF;
  v_result:=public.issue_3872_recompute_creator_verification(v_id,false);
  RETURN jsonb_build_object('ok',true,'verification',v_result);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.issue_3872_creator_checks(p_creator_account_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
  SELECT jsonb_build_array(
    jsonb_build_object('key','profile','label','Your profile','done',p.creator_account_id IS NOT NULL),
    jsonb_build_object('key','rates','label','Your rates','done',EXISTS(SELECT 1 FROM public.creator_packages k WHERE k.creator_account_id=p_creator_account_id AND k.active)),
    jsonb_build_object('key','showcase','label','Showcase video','done',EXISTS(SELECT 1 FROM public.creator_media_jobs m WHERE m.owner_kind='creator' AND m.owner_id=p_creator_account_id AND m.purpose='showcase' AND m.status='ready' AND m.deleted_at IS NULL)),
    jsonb_build_object('key','socials','label','Verified social account','done',EXISTS(SELECT 1 FROM public.creator_handles h WHERE h.creator_account_id=p_creator_account_id AND h.verified_at IS NOT NULL AND NOT h.review_required)),
    jsonb_build_object('key','payout','label','Payout account','done',EXISTS(SELECT 1 FROM public.payee_accounts a WHERE a.user_id=p_creator_account_id AND (a.stripe_status='active' OR a.paystack_status='verified'))),
    jsonb_build_object('key','agreement','label','Creator agreement','done',coalesce(p.agreement_signed_at IS NOT NULL AND p.date_of_birth IS NOT NULL AND p.date_of_birth<=(current_date-interval '18 years')::date,false))
  )
  FROM (SELECT 1) one LEFT JOIN public.creator_profiles p ON p.creator_account_id=p_creator_account_id;
$fn$;

CREATE OR REPLACE FUNCTION public.creator_setup_status() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=public,pg_temp AS $fn$
DECLARE v_id uuid:=auth.uid(); v_profile public.creator_profiles;
BEGIN
  IF v_id IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='28000'; END IF;
  SELECT * INTO v_profile FROM public.creator_profiles WHERE creator_account_id=v_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('profile',false,'mode_enabled',false,'verification','incomplete','review_note',NULL,'declined_reason',NULL,
      'checks',public.issue_3872_creator_checks(v_id),
      'missing',jsonb_build_array('profile','verified_handle','package','processed_showcase','active_payout','signed_agreement'));
  END IF;
  RETURN jsonb_build_object(
    'profile',true,'mode_enabled',v_profile.mode_enabled,'verification',v_profile.verification,
    'review_note',CASE WHEN v_profile.verification IN ('needs_more','suspended') THEN v_profile.review_note END,
    'declined_reason',CASE WHEN v_profile.verification='declined' THEN v_profile.declined_reason END,
    'checks',public.issue_3872_creator_checks(v_id),
    'display_name',v_profile.display_name,'niches',to_jsonb(v_profile.niches),
    'missing',to_jsonb(v_profile.verification_reasons)
      || CASE WHEN EXISTS(SELECT 1 FROM public.creator_packages WHERE creator_account_id=v_id AND active) THEN '[]'::jsonb ELSE '["package"]'::jsonb END,
    'handles',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',h.id,'platform',h.platform,'handle',h.handle,'verify_code',h.verify_code,'verified',h.verified_at IS NOT NULL,'review_required',h.review_required,'expires_at',h.verify_expires_at,'follower_band',h.follower_band) ORDER BY h.platform),'[]'::jsonb) FROM public.creator_handles h WHERE h.creator_account_id=v_id),
    'packages',(SELECT coalesce(jsonb_agg(to_jsonb(p)-'creator_account_id' ORDER BY p.format_key),'[]'::jsonb) FROM public.creator_packages p WHERE p.creator_account_id=v_id)
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.admin_creator_queue(p_status text DEFAULT 'needs_person') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=public,pg_temp AS $fn$
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'admin_only' USING ERRCODE='42501'; END IF;
  -- needs_person = a person must look (review, or asked for more);
  -- setting_up = still completing the automatic checks.
  IF p_status IS NULL OR p_status NOT IN ('needs_person','setting_up','all','incomplete','review','needs_more','verified','declined','suspended') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE='22023';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'creator_id',p.creator_account_id,'display_name',p.display_name,'city',c.name,
      'verification',p.verification,'review_note',p.review_note,'declined_reason',p.declined_reason,
      'checks',public.issue_3872_creator_checks(p.creator_account_id),
      'flags',to_jsonb(p.verification_reasons)
        ||coalesce((SELECT jsonb_agg('handle_review:'||h.platform) FROM public.creator_handles h WHERE h.creator_account_id=p.creator_account_id AND h.review_required),'[]'::jsonb),
      'history',coalesce((SELECT jsonb_agg(jsonb_build_object('at',e.at,'action',e.action,'note',e.note) ORDER BY e.at,e.id) FROM public.creator_review_events e WHERE e.creator_account_id=p.creator_account_id),'[]'::jsonb),
      'updated_at',p.updated_at
    ) ORDER BY p.updated_at)
    FROM public.creator_profiles p LEFT JOIN public.seeding_cities c ON c.id=p.home_city_id
    WHERE p_status='all'
       OR (p_status='needs_person' AND p.verification IN ('review','needs_more'))
       OR (p_status='setting_up' AND p.verification='incomplete')
       OR p.verification=p_status
  ),'[]'::jsonb);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.admin_creator_decide(p_creator_id uuid,p_decision text,p_note text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_profile public.creator_profiles; v_note text:=nullif(btrim(coalesce(p_note,'')),''); v_result jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'admin_only' USING ERRCODE='42501'; END IF;
  IF p_decision IS NULL OR p_decision NOT IN ('verify','ask_more','decline','suspend') THEN RAISE EXCEPTION 'invalid_decision' USING ERRCODE='22023'; END IF;
  IF p_decision IN ('ask_more','decline') AND v_note IS NULL THEN RETURN jsonb_build_object('ok',false,'error','note_required','field','note'); END IF;
  IF char_length(coalesce(v_note,''))>1000 THEN RETURN jsonb_build_object('ok',false,'error','note_too_long','field','note'); END IF;
  SELECT * INTO v_profile FROM public.creator_profiles WHERE creator_account_id=p_creator_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'creator_profile_not_found' USING ERRCODE='P0002'; END IF;
  IF p_decision='verify' THEN
    -- A person vouches for the flagged handles; the automatic checks still
    -- decide between verified and incomplete.
    UPDATE public.creator_handles SET review_required=false,review_reason=NULL,verified_at=coalesce(verified_at,now())
     WHERE creator_account_id=p_creator_id AND review_required;
    UPDATE public.creator_profiles SET verification='incomplete',review_note=NULL,declined_reason=NULL,reviewed_by=auth.uid(),reviewed_at=now()
     WHERE creator_account_id=p_creator_id;
    v_result:=public.issue_3872_recompute_creator_verification(p_creator_id,false);
  ELSE
    UPDATE public.creator_profiles SET
      verification=CASE p_decision WHEN 'ask_more' THEN 'needs_more' WHEN 'decline' THEN 'declined' ELSE 'suspended' END,
      review_note=CASE WHEN p_decision IN ('ask_more','suspend') THEN v_note ELSE review_note END,
      declined_reason=CASE WHEN p_decision='decline' THEN v_note ELSE NULL END,
      reviewed_by=auth.uid(),reviewed_at=now()
     WHERE creator_account_id=p_creator_id RETURNING * INTO v_profile;
    v_result:=jsonb_build_object('verification',v_profile.verification);
  END IF;
  INSERT INTO public.creator_review_events(creator_account_id,action,note,actor) VALUES(p_creator_id,p_decision,v_note,auth.uid());
  RETURN jsonb_build_object('ok',true,'verification',v_result->>'verification');
END;
$fn$;

CREATE OR REPLACE FUNCTION public.admin_gig_list(p_state text DEFAULT NULL,p_query text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=public,pg_temp AS $fn$
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'admin_only' USING ERRCODE='42501'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'contract_id',c.id,'gig_id',g.id,'gig_title',g.title_public,'brand_name',b.name,
      'creator_display_name',p.display_name,'city',sc.name,'state',c.state,
      'fee_minor',tv.fee_minor,'currency',tv.currency,
      'due_at',CASE WHEN c.state IN ('approved','posting','posts_failed') THEN ((coalesce(tv.post_by,g.post_by)+1)::timestamp AT TIME ZONE 'UTC') ELSE c.state_deadline_at END,
      'updated_at',c.updated_at
    ) ORDER BY c.updated_at DESC)
    FROM public.gig_contracts c
    JOIN public.gigs g ON g.id=c.gig_id
    JOIN public.brands b ON b.id=c.brand_id
    JOIN public.creator_profiles p ON p.creator_account_id=c.creator_account_id
    JOIN public.seeding_cities sc ON sc.id=g.city_id
    LEFT JOIN public.gig_terms_versions tv ON tv.contract_id=c.id AND tv.version=c.current_terms_version
    WHERE (p_state IS NULL OR c.state=p_state)
      AND (nullif(btrim(p_query),'') IS NULL OR g.title_public ILIKE '%'||btrim(p_query)||'%'
        OR b.name ILIKE '%'||btrim(p_query)||'%' OR p.display_name ILIKE '%'||btrim(p_query)||'%'
        OR c.id::text=btrim(p_query))
  ),'[]'::jsonb);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.admin_budget_band_save(p_currency text,p_band text,p_min_minor bigint,p_max_minor bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_currency text:=upper(btrim(coalesce(p_currency,'')));
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'admin_only' USING ERRCODE='42501'; END IF;
  IF v_currency!~'^[A-Z]{3}$' THEN RETURN jsonb_build_object('ok',false,'error','currency_invalid','field','currency'); END IF;
  IF p_band IS NULL OR p_band NOT IN ('b1','b2','b3','b4') THEN RETURN jsonb_build_object('ok',false,'error','band_invalid','field','band'); END IF;
  IF p_min_minor IS NULL OR p_min_minor<=0 THEN RETURN jsonb_build_object('ok',false,'error','min_invalid','field','min_minor'); END IF;
  IF p_max_minor IS NULL OR p_max_minor<p_min_minor THEN RETURN jsonb_build_object('ok',false,'error','max_below_min','field','max_minor'); END IF;
  INSERT INTO public.gig_budget_bands(currency,band,min_minor,max_minor,updated_by)
  VALUES(v_currency,p_band,p_min_minor,p_max_minor,auth.uid())
  ON CONFLICT(currency,band) DO UPDATE SET min_minor=excluded.min_minor,max_minor=excluded.max_minor,updated_by=excluded.updated_by;
  RETURN jsonb_build_object('ok',true,'currency',v_currency,'band',p_band,'min_minor',p_min_minor,'max_minor',p_max_minor);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Notifications: creator side now lives in Explorer; offers notify on capture.
-- ---------------------------------------------------------------------------
INSERT INTO public.notification_categories(key,section,is_transactional,urgency,default_channels,reach_mode,active)
VALUES
  ('business.gig.counter','creator_gigs',true,'high',ARRAY['inapp','push']::text[],'reach_once',true),
  ('creator.gig.counter_answered','creator_gigs',true,'high',ARRAY['inapp','push']::text[],'reach_once',true)
ON CONFLICT(key) DO UPDATE SET active=true;

ALTER TABLE public.business_notification_type_preferences
  DROP CONSTRAINT IF EXISTS business_notification_type_preferences_type_check;
ALTER TABLE public.business_notification_type_preferences
  ADD CONSTRAINT business_notification_type_preferences_type_check CHECK(type IN (
    'business.order_paid','business.event_sold_out','business.low_inventory',
    'business.refund_processed','business.dispute_opened','business.dispute_action_needed',
    'business.payout_paid','business.payout_failed','business.payout_waiting_for_bank',
    'business.payouts_paused','business.payouts_resumed','business.account_status_changed',
    'business.new_review','business.claim_decision','business.team_member_joined',
    'business.discount_limit_80','business.discount_ended','business.discount_needs_attention',
    'business.referral.sale','business.referral.budget_80','business.referral.budget_reached',
    'business.referral.member_joined','business.referral.flagged',
    'creator.referral.invite','creator.referral.sale','creator.referral.tier_up',
    'creator.referral.paid','creator.referral.payout_failed','creator.referral.reversed',
    'business.gig.interest','business.gig.accepted','business.gig.declined_refunded',
    'business.gig.script_ready','business.gig.video_ready','business.gig.posts_live',
    'business.gig.auto_approved','business.gig.dispute','business.gig.rate','business.gig.counter',
    'creator.gig.match','creator.gig.offer','creator.gig.offer_expiring','creator.gig.script_locked',
    'creator.gig.fix_requested','creator.gig.post_reminder','creator.gig.posts_failed',
    'creator.gig.released','creator.gig.dispute','creator.gig.rate','creator.gig.counter_answered',
    'creator.verify.state','business.local.review_posted'
  ));

CREATE OR REPLACE FUNCTION public.issue_3872_enqueue_gig_notice(
  p_contract_id uuid,p_type text,p_target text,p_marker text,p_title text,p_body text,p_payload jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_contract public.gig_contracts; v_gig public.gigs;
BEGIN
  SELECT * INTO v_contract FROM public.gig_contracts WHERE id=p_contract_id;
  IF NOT FOUND OR p_target NOT IN ('host','creator') THEN RETURN; END IF;
  SELECT * INTO v_gig FROM public.gigs WHERE id=v_contract.gig_id;
  IF p_target='creator' THEN
    INSERT INTO public.notification_outbox(category_key,user_id,brand_id,payload,idempotency_key,status)
    VALUES(p_type,v_contract.creator_account_id,v_contract.brand_id,
      coalesce(p_payload,'{}'::jsonb)||jsonb_build_object(
        'title',p_title,'body',p_body,'contract_id',v_contract.id,'gig_id',v_gig.id,
        'deep_link','mingla://creator/contract/'||v_contract.id::text
      ),p_type||':'||p_marker||':'||v_contract.creator_account_id::text,'pending')
    ON CONFLICT(idempotency_key) DO NOTHING;
  ELSE
    INSERT INTO public.notification_outbox(category_key,user_id,brand_id,payload,idempotency_key,status)
    SELECT p_type,member.user_id,v_contract.brand_id,
      coalesce(p_payload,'{}'::jsonb)||jsonb_build_object(
        'title',p_title,'body',p_body,'contract_id',v_contract.id,'gig_id',v_gig.id,
        'deep_link','mingla-business://brand/'||v_contract.brand_id::text||'/creators/contract/'||v_contract.id::text
      ),p_type||':'||p_marker||':'||member.user_id::text,'pending'
    FROM public.brand_team_members member
    WHERE member.brand_id=v_contract.brand_id AND member.accepted_at IS NOT NULL AND member.removed_at IS NULL
    ON CONFLICT(idempotency_key) DO NOTHING;
  END IF;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.issue_3872_gig_event_notice() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_marker text:=NEW.id::text; v_state text;
BEGIN
  SELECT state INTO v_state FROM public.gig_contracts WHERE id=NEW.contract_id;
  -- An offer reaches the creator only once its hold is captured (#7).
  IF NEW.kind='hold_captured' AND v_state='offered' THEN
    PERFORM public.issue_3872_enqueue_gig_notice(NEW.contract_id,'creator.gig.offer','creator',v_marker,'You have a creator offer','A host sent terms. Review and respond within 48 hours.');
  ELSIF NEW.kind='topup_captured' THEN
    PERFORM public.issue_3872_enqueue_gig_notice(NEW.contract_id,'creator.gig.counter_answered','creator',v_marker,'Your counter-offer was accepted','The host accepted your price. Review the updated offer.');
  ELSIF NEW.kind='counter_sent' THEN
    PERFORM public.issue_3872_enqueue_gig_notice(NEW.contract_id,'business.gig.counter','host',v_marker,'A creator sent a counter-offer','Review the creator’s price before the offer window closes.');
  ELSIF NEW.kind='counter_declined' OR (NEW.kind='counter_accepted' AND NOT EXISTS(SELECT 1 FROM public.gig_hold_adjustments a WHERE a.contract_id=NEW.contract_id AND a.kind='topup' AND a.status='pending')) THEN
    PERFORM public.issue_3872_enqueue_gig_notice(NEW.contract_id,'creator.gig.counter_answered','creator',v_marker,
      CASE WHEN NEW.kind='counter_declined' THEN 'Your counter-offer was declined' ELSE 'Your counter-offer was accepted' END,
      CASE WHEN NEW.kind='counter_declined' THEN 'The original offer still stands until it expires.' ELSE 'Review the updated offer.' END);
  ELSIF NEW.kind='accept' THEN
    PERFORM public.issue_3872_enqueue_gig_notice(NEW.contract_id,'business.gig.accepted','host',v_marker,'Creator offer accepted','The creator accepted the terms. Plan the shoot next.');
  ELSIF NEW.kind='refund_recorded' AND NEW.data->>'branch' IN ('creator_decline','declined_or_expired') THEN
    PERFORM public.issue_3872_enqueue_gig_notice(NEW.contract_id,'business.gig.declined_refunded','host',v_marker,'Creator offer closed','The offer was declined or expired and the eligible refund was recorded.');
  ELSIF NEW.kind='script_sent' THEN
    PERFORM public.issue_3872_enqueue_gig_notice(NEW.contract_id,'business.gig.script_ready','host',v_marker,'Creator script ready','Review the creator’s script. It will auto-lock after the review window.');
  ELSIF NEW.kind IN ('lock_script','auto_lock') THEN
    PERFORM public.issue_3872_enqueue_gig_notice(NEW.contract_id,'creator.gig.script_locked','creator',v_marker,'Script locked','The agreed script is locked. Film and upload two days before the post-by date.');
    IF NEW.kind='auto_lock' THEN
      PERFORM public.issue_3872_enqueue_gig_notice(NEW.contract_id,'business.gig.auto_approved','host',v_marker,'Script auto-approved','The review window ended and the script was locked automatically.',jsonb_build_object('stage','script'));
    END IF;
  ELSIF NEW.kind='delivery_submitted' THEN
    PERFORM public.issue_3872_enqueue_gig_notice(NEW.contract_id,'business.gig.video_ready','host',v_marker,'Creator video ready','Review the submitted video before its auto-approval deadline.');
  ELSIF NEW.kind='request_fix' THEN
    PERFORM public.issue_3872_enqueue_gig_notice(NEW.contract_id,'creator.gig.fix_requested','creator',v_marker,'Technical fix requested','The host requested an allowed sound or picture correction.');
  ELSIF NEW.kind='auto_approve' THEN
    PERFORM public.issue_3872_enqueue_gig_notice(NEW.contract_id,'business.gig.auto_approved','host',v_marker,'Video auto-approved','The review window ended and the creator video was approved automatically.',jsonb_build_object('stage','video'));
  ELSIF NEW.kind IN ('posts_passed','host_confirm','auto_confirm') THEN
    PERFORM public.issue_3872_enqueue_gig_notice(NEW.contract_id,'business.gig.posts_live','host',v_marker,'Creator posts verified','The agreed posts are live and passed verification.');
  ELSIF NEW.kind='posts_failed' THEN
    PERFORM public.issue_3872_enqueue_gig_notice(NEW.contract_id,'creator.gig.posts_failed','creator',v_marker,'Post check needs a fix','One or more agreed post checks failed. Open the contract to see the exact reason.');
  ELSIF NEW.kind IN ('release','gig_release_recorded') THEN
    PERFORM public.issue_3872_enqueue_gig_notice(NEW.contract_id,'creator.gig.released','creator',v_marker,'Creator fee released','Your gig fee is on its way to your payout account.');
  ELSIF NEW.kind LIKE 'dispute_%' THEN
    PERFORM public.issue_3872_enqueue_gig_notice(NEW.contract_id,'business.gig.dispute','host',v_marker,'Gig dispute updated','The shared dispute timeline has a new update.');
    PERFORM public.issue_3872_enqueue_gig_notice(NEW.contract_id,'creator.gig.dispute','creator',v_marker,'Gig dispute updated','The shared dispute timeline has a new update.');
  ELSIF NEW.kind='complete' THEN
    PERFORM public.issue_3872_enqueue_gig_notice(NEW.contract_id,'business.gig.rate','host',v_marker,'Rate this creator','The day-30 check is complete. Share private feedback now.');
    PERFORM public.issue_3872_enqueue_gig_notice(NEW.contract_id,'creator.gig.rate','creator',v_marker,'Rate this host','The day-30 check is complete. Share private feedback now.');
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.issue_3872_creator_verification_notice() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
BEGIN
  IF NEW.verification IS DISTINCT FROM OLD.verification THEN
    INSERT INTO public.notification_outbox(category_key,user_id,payload,idempotency_key,status)
    VALUES('creator.verify.state',NEW.creator_account_id,jsonb_build_object(
      'title','Creator verification updated',
      'body',CASE NEW.verification
        WHEN 'verified' THEN 'You’re a Mingla Creator. Hosts can now hire you.'
        WHEN 'review' THEN 'Mingla is reviewing your Creator profile.'
        WHEN 'needs_more' THEN 'Mingla needs a little more from you. Open Creator setup to see what.'
        WHEN 'declined' THEN 'Your Creator application wasn’t approved. Open Creator setup to see why.'
        WHEN 'suspended' THEN 'Your Creator profile is paused. Open Creator setup for details.'
        ELSE 'Finish the remaining Creator setup steps.' END,
      'verification',NEW.verification,'reasons_count',cardinality(NEW.verification_reasons),
      'deep_link','mingla://creator/setup'
    ),'creator.verify.state:'||NEW.creator_account_id::text||':'||NEW.verification||':'||NEW.updated_at::text,'pending')
    ON CONFLICT(idempotency_key) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.gig_notification_tick(p_now timestamptz DEFAULT now()) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_matches integer:=0; v_expiring integer:=0; v_posts integer:=0;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'service_role_only' USING ERRCODE='42501'; END IF;
  INSERT INTO public.notification_outbox(category_key,user_id,payload,idempotency_key,status)
  SELECT 'creator.gig.match',profile.creator_account_id,jsonb_build_object(
      'title','New creator gigs near you','body','New briefs match your city. Open Creator to review them.',
      'deep_link','mingla://creator'
    ),'creator.gig.match:'||profile.creator_account_id::text||':'||p_now::date::text,'pending'
  FROM public.creator_profiles profile
  WHERE profile.mode_enabled AND profile.verification='verified' AND EXISTS(
    SELECT 1 FROM public.gigs gig
    WHERE gig.city_id=profile.home_city_id AND gig.status='open'
      AND public.issue_3872_creator_gigs_on(gig.brand_id)
  ) ON CONFLICT(idempotency_key) DO NOTHING;
  GET DIAGNOSTICS v_matches=ROW_COUNT;

  INSERT INTO public.notification_outbox(category_key,user_id,brand_id,payload,idempotency_key,status)
  SELECT 'creator.gig.offer_expiring',contract.creator_account_id,contract.brand_id,jsonb_build_object(
      'title','Creator offer expires soon','body','Review this offer before its 48-hour response window closes.',
      'contract_id',contract.id,'deadline_at',contract.state_deadline_at,
      'deep_link','mingla://creator/contract/'||contract.id::text
    ),'creator.gig.offer_expiring:'||contract.id::text||':'||contract.state_deadline_at::text,'pending'
  FROM public.gig_contracts contract
  WHERE contract.state='offered' AND contract.state_deadline_at>p_now AND contract.state_deadline_at<=p_now+interval '12 hours'
    AND public.issue_3872_offer_ready(contract.id)
  ON CONFLICT(idempotency_key) DO NOTHING;
  GET DIAGNOSTICS v_expiring=ROW_COUNT;

  INSERT INTO public.notification_outbox(category_key,user_id,brand_id,payload,idempotency_key,status)
  SELECT 'creator.gig.post_reminder',contract.creator_account_id,contract.brand_id,jsonb_build_object(
      'title','Creator post deadline is close','body','Submit every agreed post link before the post-by date.',
      'contract_id',contract.id,'post_by',terms.post_by,
      'deep_link','mingla://creator/contract/'||contract.id::text
    ),'creator.gig.post_reminder:'||contract.id::text||':'||terms.post_by::text,'pending'
  FROM public.gig_contracts contract
  JOIN public.gig_terms_versions terms ON terms.contract_id=contract.id AND terms.version=contract.current_terms_version
  WHERE contract.state IN ('posting','posts_failed') AND terms.post_by BETWEEN p_now::date AND p_now::date+1
  ON CONFLICT(idempotency_key) DO NOTHING;
  GET DIAGNOSTICS v_posts=ROW_COUNT;
  RETURN jsonb_build_object('ok',true,'matches',v_matches,'offer_expiring',v_expiring,'post_reminders',v_posts);
END;
$fn$;

-- Roster writes also need rank 20+ (#8).
CREATE OR REPLACE FUNCTION public.brand_creator_roster_save(p_brand_id uuid,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_actor uuid:=auth.uid(); v_id uuid;
BEGIN
  IF NOT public.issue_3872_gig_host_writer(p_brand_id,v_actor) THEN RAISE EXCEPTION 'permission_denied' USING ERRCODE='42501'; END IF;
  IF nullif(p_payload->>'id','') IS NOT NULL THEN
    IF p_payload->>'id'!~'^[0-9a-fA-F-]{36}$' OR NOT EXISTS(SELECT 1 FROM public.brand_creator_roster WHERE id=(p_payload->>'id')::uuid AND brand_id=p_brand_id) THEN
      RETURN jsonb_build_object('ok',false,'error','roster_not_found','field','id');
    END IF;
  END IF;
  v_id:=coalesce(nullif(p_payload->>'id','')::uuid,gen_random_uuid());
  IF char_length(btrim(coalesce(p_payload->>'name','')))<2 THEN RETURN jsonb_build_object('ok',false,'error','name_required','field','name'); END IF;
  BEGIN
    INSERT INTO public.brand_creator_roster(id,brand_id,name,platform,handle,email_norm,notes,status)
    VALUES(v_id,p_brand_id,btrim(p_payload->>'name'),nullif(p_payload->>'platform',''),nullif(lower(regexp_replace(coalesce(p_payload->>'handle',''),'^@','','g')),''),nullif(lower(btrim(p_payload->>'email')),''),nullif(btrim(p_payload->>'notes'),''),coalesce(nullif(p_payload->>'status',''),'active'))
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,platform=excluded.platform,handle=excluded.handle,email_norm=excluded.email_norm,notes=excluded.notes,status=excluded.status WHERE public.brand_creator_roster.brand_id=p_brand_id;
  EXCEPTION WHEN check_violation OR unique_violation THEN
    RETURN jsonb_build_object('ok',false,'error','roster_invalid');
  END;
  RETURN jsonb_build_object('ok',true,'id',v_id);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Grants.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.issue_3872_contract_apply_state(uuid,text,timestamptz,integer,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_contract_apply_state(uuid,text,timestamptz,integer,integer,text) TO service_role;
REVOKE ALL ON FUNCTION public.issue_3872_gig_host_writer(uuid,uuid),public.issue_3872_gig_slots_left(uuid),public.issue_3872_offer_ready(uuid),
  public.issue_3872_gig_visible_to_creator(uuid,uuid),public.issue_3872_public_gig_json(uuid,uuid),public.issue_3872_gig_refund_branch_allowed(uuid,text),
  public.issue_3872_creator_checks(uuid),public.issue_3872_creator_next_action(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_gig_host_writer(uuid,uuid),public.issue_3872_gig_slots_left(uuid),public.issue_3872_offer_ready(uuid),
  public.issue_3872_gig_visible_to_creator(uuid,uuid),public.issue_3872_public_gig_json(uuid,uuid),public.issue_3872_gig_refund_branch_allowed(uuid,text),
  public.issue_3872_creator_checks(uuid),public.issue_3872_creator_next_action(text) TO service_role;
-- The contract party read policies run as the caller, so the policy helper
-- must stay executable by authenticated (unchanged from R3).
GRANT EXECUTE ON FUNCTION public.issue_3872_offer_ready(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.creator_gig_save(uuid,boolean),public.creator_saved_gigs(),public.gig_counter_send(uuid,bigint,text),
  public.gig_counter_respond(uuid,boolean),public.gig_topup_prepare(uuid,integer),public.gig_results(uuid,uuid),
  public.admin_creator_queue(text),public.admin_creator_decide(uuid,text,text),public.admin_budget_band_save(text,text,bigint,bigint),
  public.creator_agreement_sign(text,date),public.admin_gig_list(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.creator_gig_save(uuid,boolean),public.creator_saved_gigs(),public.gig_counter_send(uuid,bigint,text),
  public.gig_counter_respond(uuid,boolean),public.gig_topup_prepare(uuid,integer),public.gig_results(uuid,uuid),
  public.admin_creator_queue(text),public.admin_creator_decide(uuid,text,text),public.admin_budget_band_save(text,text,bigint,bigint),
  public.creator_agreement_sign(text,date),public.admin_gig_list(text,text) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.gig_refund_quote(uuid,text),public.gig_topup_mark_captured(uuid,integer,text),public.gig_pending_offer_sweep(timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gig_refund_quote(uuid,text),public.gig_topup_mark_captured(uuid,integer,text),public.gig_pending_offer_sweep(timestamptz) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
