-- #3872 R3 C4-C7 — shoot, script, delivery, posts, disputes, ratings and roster.
-- MINGLA-INVARIANT: I-3872-TECHNICAL-FIXES | issue #3872 | Delivery fixes are limited to two rounds and four technical categories; gig_delivery_decide and table constraints enforce the limit.
-- MINGLA-INVARIANT: I-3872-DOUBLE-BLIND-RATINGS | issue #3872 | Ratings reveal only when both parties submit or seven days pass after completion; gig_ratings_public owns the rule.

BEGIN;
SET LOCAL lock_timeout='10s';

CREATE TABLE public.gig_shoot_plans (
  contract_id uuid PRIMARY KEY REFERENCES public.gig_contracts(id) ON DELETE CASCADE,
  shoot_at timestamptz NOT NULL,
  arrival_note text CHECK (arrival_note IS NULL OR char_length(arrival_note)<=500),
  contact_name_snapshot text CHECK (contact_name_snapshot IS NULL OR char_length(contact_name_snapshot)<=120),
  pass_entry_ids uuid[] NOT NULL DEFAULT '{}',
  proposed_by text NOT NULL CHECK (proposed_by IN ('host','creator')),
  proposal_count integer NOT NULL DEFAULT 1 CHECK (proposal_count BETWEEN 1 AND 3),
  confirmed_at timestamptz,
  confirmed_by text CHECK (confirmed_by IS NULL OR confirmed_by IN ('host','creator')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.gig_scripts (
  contract_id uuid NOT NULL REFERENCES public.gig_contracts(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK(version>0),
  body jsonb NOT NULL CHECK(jsonb_typeof(body)='object'),
  source text NOT NULL CHECK(source IN ('ari','creator')),
  sent_at timestamptz,
  locked_at timestamptz,
  locked_by text CHECK(locked_by IS NULL OR locked_by IN ('host','auto')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(contract_id,version),
  CONSTRAINT gig_scripts_lock_pair CHECK ((locked_at IS NULL)=(locked_by IS NULL))
);

CREATE TABLE public.gig_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.gig_contracts(id) ON DELETE CASCADE,
  round integer NOT NULL CHECK(round BETWEEN 0 AND 2),
  media_job_id uuid NOT NULL REFERENCES public.creator_media_jobs(id) ON DELETE RESTRICT,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  decision text CHECK(decision IS NULL OR decision IN ('approved','fix_requested','auto_approved')),
  fix_categories text[] NOT NULL DEFAULT '{}',
  fix_note text CHECK(fix_note IS NULL OR char_length(fix_note)<=300),
  decided_at timestamptz,
  UNIQUE(contract_id,round),
  CONSTRAINT gig_delivery_fix_values CHECK(fix_categories <@ ARRAY['audio','video_quality','missing_agreed_element','wrong_length_or_format']::text[]),
  CONSTRAINT gig_delivery_decision_shape CHECK (
    (decision IS NULL AND decided_at IS NULL AND cardinality(fix_categories)=0 AND fix_note IS NULL)
    OR (decision IN ('approved','auto_approved') AND decided_at IS NOT NULL AND cardinality(fix_categories)=0 AND fix_note IS NULL)
    OR (decision='fix_requested' AND decided_at IS NOT NULL AND cardinality(fix_categories)>0)
  )
);

CREATE TABLE public.gig_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.gig_contracts(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK(platform IN ('instagram','tiktok','youtube','x')),
  url text NOT NULL CHECK(char_length(url)<=500),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  check_status text NOT NULL DEFAULT 'pending' CHECK(check_status IN ('pending','passed','failed','unverifiable')),
  check_detail jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(check_detail)='object'),
  day30_status text NOT NULL DEFAULT 'pending' CHECK(day30_status IN ('pending','live','removed')),
  last_checked_at timestamptz,
  UNIQUE(contract_id,platform,url)
);
CREATE INDEX gig_posts_check_idx ON public.gig_posts(check_status,last_checked_at,submitted_at);

CREATE TABLE public.gig_disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.gig_contracts(id) ON DELETE CASCADE,
  opened_by text NOT NULL CHECK(opened_by IN ('host','creator')),
  reason text NOT NULL CHECK(reason IN ('technical_fixes_exhausted','post_missed','posts_failed','nontechnical_fix_abuse','timer_safety','other')),
  statement text NOT NULL CHECK(char_length(btrim(statement)) BETWEEN 10 AND 1000),
  evidence_media_ids uuid[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','settling','escalated','decided','withdrawn')),
  settle_by timestamptz NOT NULL DEFAULT(now()+interval '3 days'),
  decided_outcome text CHECK(decided_outcome IS NULL OR decided_outcome IN ('release','partial_refund','full_refund')),
  decided_refund_bps integer CHECK(decided_refund_bps IS NULL OR decided_refund_bps BETWEEN 0 AND 10000),
  decided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_note text CHECK(decided_note IS NULL OR char_length(decided_note)<=1000),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX gig_disputes_active_uq ON public.gig_disputes(contract_id) WHERE status IN ('open','settling','escalated');

CREATE TABLE public.gig_dispute_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id uuid NOT NULL REFERENCES public.gig_disputes(id) ON DELETE CASCADE,
  offered_by text NOT NULL CHECK(offered_by IN ('host','creator')),
  refund_bps integer NOT NULL CHECK(refund_bps BETWEEN 0 AND 10000),
  note text CHECK(note IS NULL OR char_length(note)<=300),
  status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','accepted','declined','expired')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX gig_dispute_offer_open_uq ON public.gig_dispute_offers(dispute_id) WHERE status='open';

CREATE TABLE public.gig_ratings (
  contract_id uuid NOT NULL REFERENCES public.gig_contracts(id) ON DELETE CASCADE,
  rated_by text NOT NULL CHECK(rated_by IN ('host','creator')),
  stars integer NOT NULL CHECK(stars BETWEEN 1 AND 5),
  tags text[] NOT NULL DEFAULT '{}',
  note text CHECK(note IS NULL OR char_length(note)<=300),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  revealed_at timestamptz,
  PRIMARY KEY(contract_id,rated_by)
);

CREATE TABLE public.brand_creator_roster (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  name text NOT NULL CHECK(char_length(btrim(name)) BETWEEN 2 AND 120),
  platform text CHECK(platform IS NULL OR platform IN ('instagram','tiktok','youtube','x','snapchat')),
  handle text CHECK(handle IS NULL OR handle=lower(regexp_replace(handle,'^@','','g'))),
  email_norm text CHECK(email_norm IS NULL OR email_norm=lower(btrim(email_norm))),
  notes text CHECK(notes IS NULL OR char_length(notes)<=500),
  linked_creator_account_id uuid REFERENCES public.creator_profiles(creator_account_id) ON DELETE SET NULL,
  tracking_link_id uuid REFERENCES public.host_tracking_links(id) ON DELETE SET NULL,
  referral_member_id uuid REFERENCES public.referral_members(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','invited','joined','archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX brand_creator_roster_handle_uq ON public.brand_creator_roster(brand_id,platform,handle) WHERE handle IS NOT NULL AND status<>'archived';

CREATE TRIGGER issue_3872_shoot_plan_updated BEFORE UPDATE ON public.gig_shoot_plans FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER issue_3872_roster_updated BEFORE UPDATE ON public.brand_creator_roster FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.issue_3872_script_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $fn$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'immutable_gig_script' USING ERRCODE='55000'; END IF;
  IF current_setting('issue3872.script_lock',true)<>'on'
     OR NEW.contract_id<>OLD.contract_id OR NEW.version<>OLD.version
     OR NEW.body<>OLD.body OR NEW.source<>OLD.source
     OR NEW.sent_at IS DISTINCT FROM OLD.sent_at OR NEW.created_at<>OLD.created_at THEN
    RAISE EXCEPTION 'immutable_gig_script' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER issue_3872_scripts_immutable BEFORE UPDATE OR DELETE ON public.gig_scripts FOR EACH ROW EXECUTE FUNCTION public.issue_3872_script_guard();

CREATE OR REPLACE FUNCTION public.issue_3872_contract_party(p_contract_id uuid,p_actor uuid) RETURNS text
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=public,pg_temp AS $fn$
  SELECT CASE WHEN c.creator_account_id=p_actor THEN 'creator' WHEN public.biz_is_brand_member_for_read(c.brand_id,p_actor) THEN 'host' ELSE NULL END FROM public.gig_contracts c WHERE c.id=p_contract_id;
$fn$;

CREATE OR REPLACE FUNCTION public.gig_shoot_plan_save(p_contract_id uuid,p_shoot_at timestamptz,p_arrival_note text,p_confirm boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_actor uuid:=auth.uid(); v_party text; v_count integer; v_plan public.gig_shoot_plans; v_gig public.gigs;
BEGIN
  v_party:=public.issue_3872_contract_party(p_contract_id,v_actor); IF v_party IS NULL THEN RAISE EXCEPTION 'permission_denied' USING ERRCODE='42501'; END IF;
  SELECT g.* INTO v_gig FROM public.gig_contracts c JOIN public.gigs g ON g.id=c.gig_id WHERE c.id=p_contract_id;
  IF (p_shoot_at AT TIME ZONE 'UTC')::date NOT BETWEEN v_gig.shoot_window_start AND v_gig.shoot_window_end THEN RAISE EXCEPTION 'shoot_outside_window' USING ERRCODE='22023'; END IF;
  SELECT proposal_count INTO v_count FROM public.gig_shoot_plans WHERE contract_id=p_contract_id;
  IF coalesce(v_count,0)>=3 AND NOT p_confirm THEN RAISE EXCEPTION 'shoot_proposal_limit' USING ERRCODE='22023'; END IF;
  INSERT INTO public.gig_shoot_plans(contract_id,shoot_at,arrival_note,proposed_by,proposal_count,confirmed_at,confirmed_by)
  VALUES(p_contract_id,p_shoot_at,nullif(btrim(p_arrival_note),''),v_party,1,CASE WHEN p_confirm THEN now() END,CASE WHEN p_confirm THEN v_party END)
  ON CONFLICT(contract_id) DO UPDATE SET shoot_at=excluded.shoot_at,arrival_note=excluded.arrival_note,proposed_by=excluded.proposed_by,proposal_count=public.gig_shoot_plans.proposal_count+CASE WHEN p_confirm THEN 0 ELSE 1 END,confirmed_at=CASE WHEN p_confirm THEN now() ELSE NULL END,confirmed_by=CASE WHEN p_confirm THEN v_party ELSE NULL END
  RETURNING * INTO v_plan;
  INSERT INTO public.gig_events(contract_id,actor,kind,data) VALUES(p_contract_id,v_party,CASE WHEN p_confirm THEN 'shoot_plan_confirmed' ELSE 'shoot_plan_proposed' END,jsonb_build_object('shoot_at',p_shoot_at,'proposal_count',v_plan.proposal_count));
  IF p_confirm AND EXISTS(SELECT 1 FROM public.gig_contracts WHERE id=p_contract_id AND state='accepted') THEN
    PERFORM public.gig_transition(p_contract_id,'accepted','plan_confirmed',jsonb_build_object('shoot_at',p_shoot_at));
  END IF;
  RETURN to_jsonb(v_plan);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.gig_script_save(p_contract_id uuid,p_body jsonb,p_source text,p_send boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_actor uuid:=auth.uid(); v_party text; v_version integer; v_format public.gig_formats; v_gig public.gigs;
BEGIN
  v_party:=public.issue_3872_contract_party(p_contract_id,v_actor); IF v_party<>'creator' THEN RAISE EXCEPTION 'creator_only' USING ERRCODE='42501'; END IF;
  SELECT g.* INTO v_gig FROM public.gig_contracts c JOIN public.gigs g ON g.id=c.gig_id WHERE c.id=p_contract_id;
  SELECT * INTO v_format FROM public.gig_formats WHERE key=v_gig.format_key;
  IF jsonb_typeof(p_body)<>'object' OR NOT (p_body ? 'sections') OR jsonb_typeof(p_body->'sections')<>'array' THEN RAISE EXCEPTION 'invalid_script_shape' USING ERRCODE='22023'; END IF;
  IF position('#ad' in lower(p_body::text))=0 AND position('paid partnership' in lower(p_body::text))=0 THEN RAISE EXCEPTION 'disclosure_required' USING ERRCODE='22023'; END IF;
  SELECT coalesce(max(version),0)+1 INTO v_version FROM public.gig_scripts WHERE contract_id=p_contract_id;
  INSERT INTO public.gig_scripts(contract_id,version,body,source,sent_at) VALUES(p_contract_id,v_version,p_body,p_source,CASE WHEN p_send THEN now() END);
  INSERT INTO public.gig_events(contract_id,actor,kind,data) VALUES(p_contract_id,'creator',CASE WHEN p_send THEN 'script_sent' ELSE 'script_saved' END,jsonb_build_object('version',v_version,'source',p_source));
  IF p_send AND EXISTS(SELECT 1 FROM public.gig_contracts WHERE id=p_contract_id AND state='script_drafting') THEN
    PERFORM public.gig_transition(p_contract_id,'script_drafting','send_script',jsonb_build_object('version',v_version));
  END IF;
  RETURN jsonb_build_object('version',v_version,'sent',p_send,'format',v_format.key);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.gig_delivery_submit(p_contract_id uuid,p_media_job_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_actor uuid:=auth.uid(); v_round integer; v_id uuid;
BEGIN
  IF public.issue_3872_contract_party(p_contract_id,v_actor)<>'creator' THEN RAISE EXCEPTION 'creator_only' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.creator_media_jobs WHERE id=p_media_job_id AND owner_id=v_actor AND contract_id=p_contract_id AND purpose='delivery' AND status='ready') THEN RAISE EXCEPTION 'ready_delivery_media_required' USING ERRCODE='22023'; END IF;
  SELECT coalesce(max(round),-1)+1 INTO v_round FROM public.gig_deliveries WHERE contract_id=p_contract_id;
  IF v_round>2 THEN RAISE EXCEPTION 'delivery_round_limit' USING ERRCODE='22023'; END IF;
  INSERT INTO public.gig_deliveries(contract_id,round,media_job_id) VALUES(p_contract_id,v_round,p_media_job_id) RETURNING id INTO v_id;
  INSERT INTO public.gig_events(contract_id,actor,kind,data) VALUES(p_contract_id,'creator','delivery_submitted',jsonb_build_object('delivery_id',v_id,'round',v_round));
  PERFORM public.gig_transition(p_contract_id,(SELECT state FROM public.gig_contracts WHERE id=p_contract_id),'deliver',jsonb_build_object('delivery_id',v_id,'round',v_round));
  RETURN jsonb_build_object('id',v_id,'round',v_round);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.gig_delivery_decide(p_delivery_id uuid,p_decision text,p_fix_categories text[] DEFAULT '{}',p_fix_note text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_actor uuid:=auth.uid(); v public.gig_deliveries; v_party text;
BEGIN
  SELECT * INTO v FROM public.gig_deliveries WHERE id=p_delivery_id FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'delivery_not_found' USING ERRCODE='P0002'; END IF;
  v_party:=public.issue_3872_contract_party(v.contract_id,v_actor); IF v_party<>'host' THEN RAISE EXCEPTION 'host_only' USING ERRCODE='42501'; END IF;
  IF v.decision IS NOT NULL THEN RAISE EXCEPTION 'delivery_already_decided' USING ERRCODE='55000'; END IF;
  IF p_decision='fix_requested' AND (cardinality(p_fix_categories)=0 OR v.round>=2) THEN RAISE EXCEPTION 'technical_fix_limit' USING ERRCODE='22023'; END IF;
  IF p_decision NOT IN ('approved','fix_requested') THEN RAISE EXCEPTION 'invalid_decision' USING ERRCODE='22023'; END IF;
  UPDATE public.gig_deliveries SET decision=p_decision,fix_categories=CASE WHEN p_decision='fix_requested' THEN p_fix_categories ELSE '{}' END,fix_note=CASE WHEN p_decision='fix_requested' THEN nullif(btrim(p_fix_note),'') END,decided_at=now() WHERE id=v.id;
  INSERT INTO public.gig_events(contract_id,actor,kind,data) VALUES(v.contract_id,'host',p_decision,jsonb_build_object('delivery_id',v.id,'round',v.round,'categories',p_fix_categories));
  PERFORM public.gig_transition(v.contract_id,'delivered',CASE WHEN p_decision='approved' THEN 'approve' ELSE 'request_fix' END,jsonb_build_object('delivery_id',v.id,'categories',p_fix_categories,'note',p_fix_note));
  RETURN jsonb_build_object('ok',true,'decision',p_decision);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.gig_posts_submit(p_contract_id uuid,p_posts jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_actor uuid:=auth.uid(); v_item jsonb; v_count integer:=0; v_platform text; v_url text;
BEGIN
  IF public.issue_3872_contract_party(p_contract_id,v_actor)<>'creator' THEN RAISE EXCEPTION 'creator_only' USING ERRCODE='42501'; END IF;
  IF jsonb_typeof(p_posts)<>'array' OR jsonb_array_length(p_posts)=0 THEN RAISE EXCEPTION 'posts_required' USING ERRCODE='22023'; END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_posts) LOOP
    v_platform:=v_item->>'platform'; v_url:=v_item->>'url';
    IF NOT ((v_platform='instagram' AND v_url ~* '^https://(www\.)?instagram\.com/(reel|p)/') OR (v_platform='tiktok' AND v_url ~* '^https://(www\.)?tiktok\.com/@[^/]+/video/') OR (v_platform='youtube' AND v_url ~* '^https://(www\.)?youtube\.com/shorts/') OR (v_platform='x' AND v_url ~* '^https://(www\.)?x\.com/[^/]+/status/')) THEN RAISE EXCEPTION 'unsupported_post_url:%',v_platform USING ERRCODE='22023'; END IF;
    INSERT INTO public.gig_posts(contract_id,platform,url) VALUES(p_contract_id,v_platform,v_url) ON CONFLICT(contract_id,platform,url) DO UPDATE SET submitted_at=now(),check_status='pending',check_detail='{}'; v_count:=v_count+1;
  END LOOP;
  INSERT INTO public.gig_events(contract_id,actor,kind,data) VALUES(p_contract_id,'creator','posts_submitted',jsonb_build_object('count',v_count));
  PERFORM public.gig_transition(p_contract_id,(SELECT state FROM public.gig_contracts WHERE id=p_contract_id),'submit_posts',jsonb_build_object('count',v_count));
  RETURN jsonb_build_object('ok',true,'count',v_count);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.gig_dispute_open(p_contract_id uuid,p_reason text,p_statement text,p_evidence_media_ids uuid[] DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_actor uuid:=auth.uid(); v_party text; v_id uuid;
BEGIN
  v_party:=public.issue_3872_contract_party(p_contract_id,v_actor); IF v_party IS NULL THEN RAISE EXCEPTION 'permission_denied' USING ERRCODE='42501'; END IF;
  INSERT INTO public.gig_disputes(contract_id,opened_by,reason,statement,evidence_media_ids,status) VALUES(p_contract_id,v_party,p_reason,btrim(p_statement),coalesce(p_evidence_media_ids,'{}'),'settling') RETURNING id INTO v_id;
  INSERT INTO public.gig_events(contract_id,actor,kind,data) VALUES(p_contract_id,v_party,'dispute_opened',jsonb_build_object('dispute_id',v_id,'reason',p_reason));
  PERFORM public.gig_transition(p_contract_id,(SELECT state FROM public.gig_contracts WHERE id=p_contract_id),'open_dispute',jsonb_build_object('dispute_id',v_id,'reason',p_reason));
  RETURN jsonb_build_object('id',v_id,'settle_by',now()+interval '3 days');
END;
$fn$;

CREATE OR REPLACE FUNCTION public.gig_dispute_offer(p_dispute_id uuid,p_refund_bps integer,p_note text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_actor uuid:=auth.uid(); v_dispute public.gig_disputes; v_party text; v_id uuid;
BEGIN
  SELECT * INTO v_dispute FROM public.gig_disputes WHERE id=p_dispute_id FOR UPDATE;
  IF NOT FOUND OR v_dispute.status<>'settling' THEN RAISE EXCEPTION 'dispute_not_settling' USING ERRCODE='55000'; END IF;
  v_party:=public.issue_3872_contract_party(v_dispute.contract_id,v_actor);
  IF v_party IS NULL OR p_refund_bps NOT BETWEEN 0 AND 10000 THEN RAISE EXCEPTION 'invalid_dispute_offer' USING ERRCODE='22023'; END IF;
  UPDATE public.gig_dispute_offers SET status='expired' WHERE dispute_id=p_dispute_id AND status='open';
  INSERT INTO public.gig_dispute_offers(dispute_id,offered_by,refund_bps,note)
  VALUES(p_dispute_id,v_party,p_refund_bps,nullif(btrim(p_note),'')) RETURNING id INTO v_id;
  INSERT INTO public.gig_events(contract_id,actor,kind,data) VALUES(v_dispute.contract_id,v_party,'dispute_offer_made',jsonb_build_object('offer_id',v_id,'refund_bps',p_refund_bps));
  RETURN jsonb_build_object('id',v_id,'refund_bps',p_refund_bps);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.gig_dispute_offer_respond(p_offer_id uuid,p_accept boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_actor uuid:=auth.uid(); v_offer public.gig_dispute_offers; v_dispute public.gig_disputes; v_party text; v_state text;
BEGIN
  SELECT * INTO v_offer FROM public.gig_dispute_offers WHERE id=p_offer_id FOR UPDATE;
  IF NOT FOUND OR v_offer.status<>'open' THEN RAISE EXCEPTION 'offer_not_open' USING ERRCODE='55000'; END IF;
  SELECT * INTO v_dispute FROM public.gig_disputes WHERE id=v_offer.dispute_id FOR UPDATE;
  v_party:=public.issue_3872_contract_party(v_dispute.contract_id,v_actor);
  IF v_party IS NULL OR v_party=v_offer.offered_by THEN RAISE EXCEPTION 'counterparty_only' USING ERRCODE='42501'; END IF;
  UPDATE public.gig_dispute_offers SET status=CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END WHERE id=v_offer.id;
  IF p_accept THEN
    UPDATE public.gig_disputes SET status='decided',decided_outcome=CASE WHEN v_offer.refund_bps=0 THEN 'release' WHEN v_offer.refund_bps=10000 THEN 'full_refund' ELSE 'partial_refund' END,decided_refund_bps=v_offer.refund_bps,decided_by=v_actor,decided_at=now() WHERE id=v_dispute.id;
  ELSE
    UPDATE public.gig_disputes SET status='escalated' WHERE id=v_dispute.id;
  END IF;
  v_state:=CASE WHEN p_accept THEN 'settled' ELSE 'escalated' END;
  INSERT INTO public.gig_events(contract_id,actor,kind,data) VALUES(v_dispute.contract_id,v_party,'dispute_offer_'||CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END,jsonb_build_object('offer_id',v_offer.id,'refund_bps',v_offer.refund_bps));
  RETURN jsonb_build_object('ok',true,'state',v_state,'contract_id',v_dispute.contract_id,'outcome',CASE WHEN NOT p_accept THEN NULL WHEN v_offer.refund_bps=0 THEN 'release' WHEN v_offer.refund_bps=10000 THEN 'full_refund' ELSE 'partial_refund' END,'refund_bps',v_offer.refund_bps);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.gig_dispute_admin_decide(p_dispute_id uuid,p_outcome text,p_refund_bps integer DEFAULT NULL,p_note text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_actor uuid:=auth.uid(); v_dispute public.gig_disputes; v_bps integer;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'admin_only' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_dispute FROM public.gig_disputes WHERE id=p_dispute_id FOR UPDATE;
  IF NOT FOUND OR v_dispute.status<>'escalated' THEN RAISE EXCEPTION 'dispute_not_escalated' USING ERRCODE='55000'; END IF;
  IF p_outcome NOT IN ('release','partial_refund','full_refund') THEN RAISE EXCEPTION 'invalid_outcome' USING ERRCODE='22023'; END IF;
  v_bps:=CASE WHEN p_outcome='release' THEN 0 WHEN p_outcome='full_refund' THEN 10000 ELSE p_refund_bps END;
  IF p_outcome='partial_refund' AND (v_bps IS NULL OR v_bps NOT BETWEEN 1 AND 9999) THEN RAISE EXCEPTION 'invalid_refund_bps' USING ERRCODE='22023'; END IF;
  UPDATE public.gig_disputes SET status='decided',decided_outcome=p_outcome,decided_refund_bps=v_bps,decided_by=v_actor,decided_note=nullif(btrim(p_note),''),decided_at=now() WHERE id=p_dispute_id;
  INSERT INTO public.gig_events(contract_id,actor,kind,data) VALUES(v_dispute.contract_id,'admin','dispute_decided',jsonb_build_object('outcome',p_outcome,'refund_bps',v_bps,'note',p_note));
  RETURN jsonb_build_object('ok',true,'contract_id',v_dispute.contract_id,'outcome',p_outcome,'refund_bps',v_bps);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.gig_refund_authorize(p_contract_id uuid,p_branch text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=public,pg_temp AS $fn$
DECLARE v_actor uuid:=auth.uid(); v public.gig_contracts; v_party text;
BEGIN
  SELECT * INTO v FROM public.gig_contracts WHERE id=p_contract_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'contract_not_found' USING ERRCODE='P0002'; END IF;
  v_party:=public.issue_3872_contract_party(p_contract_id,v_actor);
  IF p_branch='host_before_accept' AND NOT (v_party='host' AND v.state='offered') THEN RAISE EXCEPTION 'refund_not_allowed' USING ERRCODE='42501'; END IF;
  IF p_branch='host_after_accept_before_lock' AND NOT (v_party='host' AND v.state IN ('accepted','shoot_planned','script_drafting','script_sent')) THEN RAISE EXCEPTION 'refund_not_allowed' USING ERRCODE='42501'; END IF;
  IF p_branch='creator_after_accept' AND NOT (v_party='creator' AND v.state IN ('accepted','shoot_planned','script_drafting','script_sent')) THEN RAISE EXCEPTION 'refund_not_allowed' USING ERRCODE='42501'; END IF;
  IF p_branch='creator_decline' AND NOT (v_party='creator' AND v.state='offered') THEN RAISE EXCEPTION 'refund_not_allowed' USING ERRCODE='42501'; END IF;
  IF p_branch='declined_or_expired' THEN RAISE EXCEPTION 'refund_branch_requires_service' USING ERRCODE='42501'; END IF;
  IF p_branch IN ('resolved_partial','resolved_refund') AND NOT EXISTS(SELECT 1 FROM public.gig_disputes d WHERE d.contract_id=v.id AND d.status='decided') THEN RAISE EXCEPTION 'decided_dispute_required' USING ERRCODE='55000'; END IF;
  IF p_branch NOT IN ('host_before_accept','host_after_accept_before_lock','creator_after_accept','creator_decline','declined_or_expired','resolved_partial','resolved_refund') THEN RAISE EXCEPTION 'invalid_refund_branch' USING ERRCODE='22023'; END IF;
  RETURN jsonb_build_object('ok',true,'state',v.state,'party',v_party);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.gig_release_record(p_contract_id uuid,p_provider_ref text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v public.gig_contracts; v_hold public.gig_holds; v_terms public.gig_terms_versions; v_share uuid;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'service_role_only' USING ERRCODE='42501'; END IF;
  SELECT * INTO v FROM public.gig_contracts WHERE id=p_contract_id FOR UPDATE;
  IF NOT FOUND OR NOT (v.state='posts_verified' OR (v.state='disputed' AND EXISTS(SELECT 1 FROM public.gig_disputes d WHERE d.contract_id=v.id AND d.status='decided' AND d.decided_outcome='release'))) THEN RAISE EXCEPTION 'release_not_ready' USING ERRCODE='55000'; END IF;
  SELECT * INTO v_hold FROM public.gig_holds WHERE contract_id=v.id AND terms_version=v.current_terms_version FOR UPDATE;
  SELECT * INTO v_terms FROM public.gig_terms_versions WHERE contract_id=v.id AND version=v.current_terms_version;
  IF v_hold.status='released' THEN RETURN jsonb_build_object('ok',true,'replayed',true); END IF;
  IF v_hold.status<>'captured' THEN RAISE EXCEPTION 'captured_hold_required' USING ERRCODE='55000'; END IF;
  INSERT INTO public.payee_shares(order_kind,order_id,payee_kind,member_id,payee_user_id,brand_id,rail,currency,gross_minor,mingla_fee_minor,net_minor,status,release_after)
  VALUES('gig',v.id,'gig_fee',NULL,v.creator_account_id,v.brand_id,v_hold.rail,v_terms.currency,v_terms.fee_minor,0,v_terms.fee_minor,CASE WHEN v_hold.rail='stripe' THEN 'paid' ELSE 'releasable' END,now())
  ON CONFLICT(order_kind,order_id,payee_kind) DO UPDATE SET status=excluded.status RETURNING id INTO v_share;
  UPDATE public.gig_holds SET status='released' WHERE id=v_hold.id;
  IF v.state='posts_verified' THEN
    PERFORM public.gig_transition(v.id,'posts_verified','release',jsonb_build_object('provider_ref',p_provider_ref,'share_id',v_share));
  ELSE
    PERFORM set_config('issue3872.transition','on',true);
    UPDATE public.gig_contracts SET state='resolved_release',state_deadline_at=NULL WHERE id=v.id;
    INSERT INTO public.gig_events(contract_id,actor,kind,data) VALUES(v.id,'system','dispute_release_recorded',jsonb_build_object('provider_ref',p_provider_ref,'share_id',v_share));
  END IF;
  RETURN jsonb_build_object('ok',true,'share_id',v_share,'rail',v_hold.rail);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.gig_refund_record(p_contract_id uuid,p_branch text,p_refund_minor bigint,p_creator_fee_minor bigint,p_provider_ref text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v public.gig_contracts; v_hold public.gig_holds; v_terms public.gig_terms_versions; v_target text; v_share uuid;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'service_role_only' USING ERRCODE='42501'; END IF;
  SELECT * INTO v FROM public.gig_contracts WHERE id=p_contract_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'contract_not_found' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_hold FROM public.gig_holds WHERE contract_id=v.id AND terms_version=v.current_terms_version FOR UPDATE;
  SELECT * INTO v_terms FROM public.gig_terms_versions WHERE contract_id=v.id AND version=v.current_terms_version;
  IF v_hold.status IN ('refunded','partially_refunded') AND v_hold.refunded_minor=p_refund_minor THEN RETURN jsonb_build_object('ok',true,'replayed',true); END IF;
  IF p_refund_minor<0 OR p_refund_minor>v_hold.amount_minor OR p_creator_fee_minor<0 OR p_creator_fee_minor>v_terms.fee_minor THEN RAISE EXCEPTION 'refund_amount_invalid' USING ERRCODE='22023'; END IF;
  IF p_branch='resolved_partial' AND NOT EXISTS(SELECT 1 FROM public.gig_disputes d WHERE d.contract_id=v.id AND d.status='decided' AND d.decided_outcome='partial_refund') THEN RAISE EXCEPTION 'partial_decision_required' USING ERRCODE='55000'; END IF;
  IF p_branch='resolved_refund' AND NOT EXISTS(SELECT 1 FROM public.gig_disputes d WHERE d.contract_id=v.id AND d.status='decided' AND d.decided_outcome='full_refund') THEN RAISE EXCEPTION 'refund_decision_required' USING ERRCODE='55000'; END IF;
  v_target:=CASE WHEN p_branch='creator_decline' AND v.state='offered' THEN 'declined' WHEN p_branch='declined_or_expired' AND v.state='offered' THEN 'expired' WHEN p_branch='host_before_accept' THEN 'cancelled' WHEN p_branch IN ('host_after_accept_before_lock','creator_after_accept') THEN 'cancelled' WHEN p_branch='resolved_partial' THEN 'resolved_partial' WHEN p_branch='resolved_refund' THEN 'resolved_refund' ELSE v.state END;
  IF p_creator_fee_minor>0 THEN
    INSERT INTO public.payee_shares(order_kind,order_id,payee_kind,member_id,payee_user_id,brand_id,rail,currency,gross_minor,mingla_fee_minor,net_minor,status,release_after)
    VALUES('gig',v.id,'gig_fee',NULL,v.creator_account_id,v.brand_id,v_hold.rail,v_terms.currency,p_creator_fee_minor,0,p_creator_fee_minor,'releasable',now())
    ON CONFLICT(order_kind,order_id,payee_kind) DO UPDATE SET gross_minor=excluded.gross_minor,net_minor=excluded.net_minor,status='releasable' RETURNING id INTO v_share;
  END IF;
  UPDATE public.gig_holds SET status=CASE WHEN p_refund_minor=v_hold.amount_minor THEN 'refunded' ELSE 'partially_refunded' END,refunded_minor=p_refund_minor WHERE id=v_hold.id;
  IF p_branch='creator_after_accept' OR p_branch='resolved_refund' THEN UPDATE public.creator_profiles SET reliability_bps=greatest(0,coalesce(reliability_bps,10000)-1000) WHERE creator_account_id=v.creator_account_id; END IF;
  IF v_target<>v.state THEN PERFORM set_config('issue3872.transition','on',true); UPDATE public.gig_contracts SET state=v_target,state_deadline_at=NULL,cancel_reason=p_branch WHERE id=v.id; END IF;
  INSERT INTO public.gig_events(contract_id,actor,kind,data) VALUES(v.id,'system','refund_recorded',jsonb_build_object('branch',p_branch,'refund_minor',p_refund_minor,'creator_fee_minor',p_creator_fee_minor,'provider_ref',p_provider_ref,'share_id',v_share));
  RETURN jsonb_build_object('ok',true,'state',v_target,'share_id',v_share);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.gig_post_check_record(p_post_id uuid,p_result text,p_detail jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_post public.gig_posts; v_remaining integer; v_failed integer;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'service_role_only' USING ERRCODE='42501'; END IF;
  IF p_result NOT IN ('passed','failed','unverifiable') THEN RAISE EXCEPTION 'invalid_check_result' USING ERRCODE='22023'; END IF;
  UPDATE public.gig_posts SET check_status=p_result,check_detail=coalesce(p_detail,'{}'),last_checked_at=now() WHERE id=p_post_id RETURNING * INTO v_post;
  IF NOT FOUND THEN RAISE EXCEPTION 'post_not_found' USING ERRCODE='P0002'; END IF;
  SELECT count(*) FILTER(WHERE check_status='pending'),count(*) FILTER(WHERE check_status='failed') INTO v_remaining,v_failed FROM public.gig_posts WHERE contract_id=v_post.contract_id;
  IF v_failed>0 AND EXISTS(SELECT 1 FROM public.gig_contracts WHERE id=v_post.contract_id AND state='posts_submitted') THEN PERFORM public.gig_transition(v_post.contract_id,'posts_submitted','posts_failed',jsonb_build_object('post_id',v_post.id));
  ELSIF v_remaining=0 AND v_failed=0 AND NOT EXISTS(SELECT 1 FROM public.gig_posts WHERE contract_id=v_post.contract_id AND check_status='unverifiable') THEN PERFORM public.gig_transition(v_post.contract_id,'posts_submitted','posts_passed',jsonb_build_object('post_id',v_post.id)); END IF;
  RETURN jsonb_build_object('ok',true,'remaining',v_remaining,'failed',v_failed);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.gig_contract_workspace(p_contract_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=public,pg_temp AS $fn$
DECLARE v public.gig_contracts; v_party text; v_revealed boolean; v_result jsonb;
BEGIN
  SELECT * INTO v FROM public.gig_contracts WHERE id=p_contract_id; IF NOT FOUND THEN RETURN NULL; END IF;
  v_party:=CASE WHEN auth.uid()=v.creator_account_id THEN 'creator' WHEN public.biz_is_brand_member_for_read(v.brand_id,auth.uid()) THEN 'host' WHEN public.is_admin_user() THEN 'admin' ELSE NULL END;
  IF v_party IS NULL THEN RAISE EXCEPTION 'permission_denied' USING ERRCODE='42501'; END IF;
  v_revealed:=v.state NOT IN ('offered','declined','expired','cancelled') AND EXISTS(SELECT 1 FROM public.gig_holds h WHERE h.contract_id=v.id AND h.terms_version=v.current_terms_version AND h.status IN ('captured','released','partially_refunded'));
  SELECT jsonb_build_object(
    'contract',to_jsonb(v),'party',v_party,'revealed',v_revealed,
    'gig',jsonb_build_object('id',g.id,'title_public',g.title_public,'brief_public',g.brief_public,'brief_private',CASE WHEN v_revealed THEN g.brief_private END,'brand_id',CASE WHEN v_revealed THEN g.brand_id END,'listing_kind',CASE WHEN v_revealed THEN g.listing_kind END,'listing_id',CASE WHEN v_revealed THEN g.listing_id END,'must_tag',CASE WHEN v_revealed THEN g.must_tag END,'format_key',g.format_key,'post_by',g.post_by),
    'terms',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY version) FROM public.gig_terms_versions t WHERE t.contract_id=v.id),'[]'::jsonb),
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

CREATE OR REPLACE FUNCTION public.gig_rating_submit(p_contract_id uuid,p_stars integer,p_tags text[] DEFAULT '{}',p_note text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_actor uuid:=auth.uid(); v_party text; v_both boolean;
BEGIN
  v_party:=public.issue_3872_contract_party(p_contract_id,v_actor); IF v_party IS NULL THEN RAISE EXCEPTION 'permission_denied' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.gig_contracts WHERE id=p_contract_id AND state='completed') THEN RAISE EXCEPTION 'rating_not_open' USING ERRCODE='55000'; END IF;
  INSERT INTO public.gig_ratings(contract_id,rated_by,stars,tags,note) VALUES(p_contract_id,v_party,p_stars,coalesce(p_tags,'{}'),nullif(btrim(p_note),'')) ON CONFLICT(contract_id,rated_by) DO NOTHING;
  SELECT count(*)=2 INTO v_both FROM public.gig_ratings WHERE contract_id=p_contract_id;
  IF v_both THEN UPDATE public.gig_ratings SET revealed_at=coalesce(revealed_at,now()) WHERE contract_id=p_contract_id; END IF;
  IF v_both THEN
    UPDATE public.creator_profiles p SET
      rating_avg_x100=s.avg_x100,
      rating_count=s.rating_count
    FROM (
      SELECT c.creator_account_id,round(avg(r.stars)*100)::integer AS avg_x100,count(*)::integer AS rating_count
      FROM public.gig_ratings r JOIN public.gig_contracts c ON c.id=r.contract_id
      WHERE c.creator_account_id=(SELECT creator_account_id FROM public.gig_contracts WHERE id=p_contract_id) AND r.rated_by='host'
      GROUP BY c.creator_account_id
    ) s WHERE p.creator_account_id=s.creator_account_id;
  END IF;
  RETURN jsonb_build_object('ok',true,'revealed',v_both);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.gig_ratings_public(p_creator_account_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=public,pg_temp AS $fn$
  SELECT coalesce(jsonb_agg(jsonb_build_object('stars',r.stars,'tags',r.tags,'note',r.note,'submitted_at',r.submitted_at) ORDER BY r.submitted_at DESC),'[]'::jsonb)
  FROM public.gig_ratings r JOIN public.gig_contracts c ON c.id=r.contract_id
  WHERE c.creator_account_id=p_creator_account_id AND r.rated_by='host'
    AND (r.revealed_at IS NOT NULL OR (c.state='completed' AND c.updated_at<=now()-interval '7 days'));
$fn$;

CREATE OR REPLACE FUNCTION public.admin_gig_queue() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=public,pg_temp AS $fn$
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'admin_only' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object(
    'disputes',coalesce((
      SELECT jsonb_agg(jsonb_build_object('id',d.id,'contract_id',d.contract_id,'reason',d.reason,'statement',d.statement,'opened_by',d.opened_by,'settle_by',d.settle_by,'created_at',d.created_at,'gig_title',g.title_public,'creator_name',p.display_name) ORDER BY d.created_at)
      FROM public.gig_disputes d JOIN public.gig_contracts c ON c.id=d.contract_id JOIN public.gigs g ON g.id=c.gig_id JOIN public.creator_profiles p ON p.creator_account_id=c.creator_account_id
      WHERE d.status='escalated'
    ),'[]'::jsonb),
    'creator_reviews',coalesce((
      SELECT jsonb_agg(jsonb_build_object('creator_account_id',p.creator_account_id,'display_name',p.display_name,'verification_reasons',p.verification_reasons,'updated_at',p.updated_at) ORDER BY p.updated_at)
      FROM public.creator_profiles p WHERE p.verification='review'
    ),'[]'::jsonb)
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.brand_creator_roster_save(p_brand_id uuid,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_actor uuid:=auth.uid(); v_id uuid:=coalesce((p_payload->>'id')::uuid,gen_random_uuid());
BEGIN
  IF NOT public.biz_is_brand_member_for_read(p_brand_id,v_actor) THEN RAISE EXCEPTION 'permission_denied' USING ERRCODE='42501'; END IF;
  INSERT INTO public.brand_creator_roster(id,brand_id,name,platform,handle,email_norm,notes,status)
  VALUES(v_id,p_brand_id,btrim(p_payload->>'name'),nullif(p_payload->>'platform',''),nullif(lower(regexp_replace(p_payload->>'handle','^@','','g')),''),nullif(lower(btrim(p_payload->>'email')),''),nullif(btrim(p_payload->>'notes'),''),coalesce(p_payload->>'status','active'))
  ON CONFLICT(id) DO UPDATE SET name=excluded.name,platform=excluded.platform,handle=excluded.handle,email_norm=excluded.email_norm,notes=excluded.notes,status=excluded.status WHERE public.brand_creator_roster.brand_id=p_brand_id;
  RETURN jsonb_build_object('ok',true,'id',v_id);
END;
$fn$;

DO $acl$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['gig_shoot_plans','gig_scripts','gig_deliveries','gig_posts','gig_disputes','gig_dispute_offers','gig_ratings','brand_creator_roster'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',v_table);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',v_table);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',v_table);
    EXECUTE format('GRANT ALL ON public.%I TO service_role',v_table);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated',v_table);
  END LOOP;
END;
$acl$;

CREATE POLICY shoot_party_read ON public.gig_shoot_plans FOR SELECT TO authenticated USING(public.issue_3872_contract_party(contract_id,auth.uid()) IS NOT NULL);
CREATE POLICY scripts_party_read ON public.gig_scripts FOR SELECT TO authenticated USING(public.issue_3872_contract_party(contract_id,auth.uid()) IS NOT NULL);
CREATE POLICY deliveries_party_read ON public.gig_deliveries FOR SELECT TO authenticated USING(public.issue_3872_contract_party(contract_id,auth.uid()) IS NOT NULL);
CREATE POLICY posts_party_read ON public.gig_posts FOR SELECT TO authenticated USING(public.issue_3872_contract_party(contract_id,auth.uid()) IS NOT NULL);
CREATE POLICY disputes_party_read ON public.gig_disputes FOR SELECT TO authenticated USING(public.issue_3872_contract_party(contract_id,auth.uid()) IS NOT NULL);
CREATE POLICY offers_party_read ON public.gig_dispute_offers FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.gig_disputes d WHERE d.id=dispute_id AND public.issue_3872_contract_party(d.contract_id,auth.uid()) IS NOT NULL));
CREATE POLICY ratings_party_read ON public.gig_ratings FOR SELECT TO authenticated USING(public.issue_3872_contract_party(contract_id,auth.uid()) IS NOT NULL);
CREATE POLICY roster_host_read ON public.brand_creator_roster FOR SELECT TO authenticated USING(public.biz_is_brand_member_for_read(brand_id,auth.uid()));
CREATE POLICY shoot_service_all ON public.gig_shoot_plans FOR ALL TO service_role USING(true) WITH CHECK(true);
CREATE POLICY scripts_service_all ON public.gig_scripts FOR ALL TO service_role USING(true) WITH CHECK(true);
CREATE POLICY deliveries_service_all ON public.gig_deliveries FOR ALL TO service_role USING(true) WITH CHECK(true);
CREATE POLICY posts_service_all ON public.gig_posts FOR ALL TO service_role USING(true) WITH CHECK(true);
CREATE POLICY disputes_service_all ON public.gig_disputes FOR ALL TO service_role USING(true) WITH CHECK(true);
CREATE POLICY offers_service_all ON public.gig_dispute_offers FOR ALL TO service_role USING(true) WITH CHECK(true);
CREATE POLICY ratings_service_all ON public.gig_ratings FOR ALL TO service_role USING(true) WITH CHECK(true);
CREATE POLICY roster_service_all ON public.brand_creator_roster FOR ALL TO service_role USING(true) WITH CHECK(true);

REVOKE ALL ON FUNCTION public.issue_3872_contract_party(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.issue_3872_contract_party(uuid,uuid) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.gig_shoot_plan_save(uuid,timestamptz,text,boolean) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.gig_shoot_plan_save(uuid,timestamptz,text,boolean) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.gig_script_save(uuid,jsonb,text,boolean) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.gig_script_save(uuid,jsonb,text,boolean) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.gig_delivery_submit(uuid,uuid) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.gig_delivery_submit(uuid,uuid) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.gig_delivery_decide(uuid,text,text[],text) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.gig_delivery_decide(uuid,text,text[],text) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.gig_posts_submit(uuid,jsonb) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.gig_posts_submit(uuid,jsonb) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.gig_dispute_open(uuid,text,text,uuid[]) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.gig_dispute_open(uuid,text,text,uuid[]) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.gig_dispute_offer(uuid,integer,text) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.gig_dispute_offer(uuid,integer,text) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.gig_dispute_offer_respond(uuid,boolean) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.gig_dispute_offer_respond(uuid,boolean) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.gig_dispute_admin_decide(uuid,text,integer,text) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.gig_dispute_admin_decide(uuid,text,integer,text) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.gig_refund_authorize(uuid,text) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.gig_refund_authorize(uuid,text) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.gig_release_record(uuid,text) FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION public.gig_release_record(uuid,text) TO service_role;
REVOKE ALL ON FUNCTION public.gig_refund_record(uuid,text,bigint,bigint,text) FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION public.gig_refund_record(uuid,text,bigint,bigint,text) TO service_role;
REVOKE ALL ON FUNCTION public.gig_post_check_record(uuid,text,jsonb) FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION public.gig_post_check_record(uuid,text,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.gig_rating_submit(uuid,integer,text[],text) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.gig_rating_submit(uuid,integer,text[],text) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.gig_ratings_public(uuid) FROM PUBLIC; GRANT EXECUTE ON FUNCTION public.gig_ratings_public(uuid) TO anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.admin_gig_queue() FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.admin_gig_queue() TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.brand_creator_roster_save(uuid,jsonb) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.brand_creator_roster_save(uuid,jsonb) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.issue_3872_script_guard() FROM PUBLIC,anon,authenticated;

COMMIT;
