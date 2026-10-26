-- #3872 R3 C2-C3 — privacy-safe gig marketplace, immutable terms and server-owned contracts.
-- MINGLA-INVARIANT: I-3872-PRIVACY-DTO | issue #3872 | Pre-hire gig and creator reads expose only allow-listed fields; creator_gig_board, creator_gig_detail and public_creator_profile are the SQL authorities and _shared/gigDto.ts is the edge authority.
-- MINGLA-INVARIANT: I-3872-HOLD-BEFORE-REVEAL | issue #3872 | A creator cannot accept and receive private brand details until the current terms version has a captured gig hold; gig_transition is the enforcement authority.
-- MINGLA-INVARIANT: I-3872-ONE-TRANSITION | issue #3872 | Contract state changes occur only through gig_transition; the state guard trigger rejects direct updates.

BEGIN;
SET LOCAL lock_timeout='10s';

CREATE TABLE public.gigs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  listing_kind text NOT NULL CHECK (listing_kind IN ('event','venue')),
  listing_id uuid NOT NULL,
  title_public text NOT NULL CHECK (char_length(btrim(title_public)) BETWEEN 8 AND 70),
  brief_public text NOT NULL CHECK (char_length(btrim(brief_public)) BETWEEN 40 AND 800),
  brief_private text CHECK (brief_private IS NULL OR char_length(brief_private)<=2000),
  format_key text NOT NULL REFERENCES public.gig_formats(key) ON DELETE RESTRICT,
  deliverables jsonb NOT NULL CHECK (jsonb_typeof(deliverables)='array' AND jsonb_array_length(deliverables) BETWEEN 1 AND 10),
  must_tag jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(must_tag)='object'),
  city_id uuid NOT NULL REFERENCES public.seeding_cities(id) ON DELETE RESTRICT,
  category text NOT NULL CHECK (char_length(btrim(category)) BETWEEN 2 AND 60),
  shoot_window_start date NOT NULL,
  shoot_window_end date NOT NULL,
  post_by date NOT NULL,
  usage_days integer NOT NULL DEFAULT 90 CHECK (usage_days IN (30,90,365)),
  budget_band text NOT NULL CHECK (budget_band IN ('b1','b2','b3','b4')),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  sales_share_bps integer CHECK (sales_share_bps BETWEEN 100 AND 3000),
  shoot_passes integer NOT NULL DEFAULT 1 CHECK (shoot_passes BETWEEN 0 AND 4),
  slots integer NOT NULL DEFAULT 1 CHECK (slots BETWEEN 1 AND 10),
  visibility text NOT NULL DEFAULT 'board' CHECK (visibility IN ('board','invite_only')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','filled','closed','cancelled')),
  version integer NOT NULL DEFAULT 1 CHECK (version>0),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gigs_window CHECK (shoot_window_end>=shoot_window_start AND post_by>=shoot_window_start)
);
CREATE INDEX gigs_board_idx ON public.gigs(city_id,status,shoot_window_start,format_key) WHERE status='open';
CREATE INDEX gigs_brand_idx ON public.gigs(brand_id,status,updated_at DESC);

CREATE TABLE public.gig_interest (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gig_id uuid NOT NULL REFERENCES public.gigs(id) ON DELETE CASCADE,
  creator_account_id uuid NOT NULL REFERENCES public.creator_profiles(creator_account_id) ON DELETE CASCADE,
  package_id uuid REFERENCES public.creator_packages(id) ON DELETE SET NULL,
  quoted_minor bigint NOT NULL CHECK (quoted_minor>0),
  note text CHECK (note IS NULL OR char_length(btrim(note))<=300),
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','withdrawn','shortlisted','passed','offered')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(gig_id,creator_account_id)
);
CREATE INDEX gig_interest_gig_idx ON public.gig_interest(gig_id,status,created_at);

CREATE TABLE public.gig_invites (
  gig_id uuid NOT NULL REFERENCES public.gigs(id) ON DELETE CASCADE,
  creator_account_id uuid NOT NULL REFERENCES public.creator_profiles(creator_account_id) ON DELETE CASCADE,
  sent_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(gig_id,creator_account_id)
);

CREATE TABLE public.gig_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gig_id uuid NOT NULL REFERENCES public.gigs(id) ON DELETE RESTRICT,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE RESTRICT,
  creator_account_id uuid NOT NULL REFERENCES public.creator_profiles(creator_account_id) ON DELETE RESTRICT,
  current_terms_version integer NOT NULL DEFAULT 1 CHECK (current_terms_version>0),
  state text NOT NULL DEFAULT 'offered' CHECK (state IN (
    'offered','accepted','shoot_planned','script_drafting','script_sent','script_locked',
    'delivered','fix_requested','approved','posting','posts_submitted','posts_verified',
    'posts_failed','released','day30','completed','declined','expired','cancelled',
    'disputed','resolved_release','resolved_partial','resolved_refund'
  )),
  state_deadline_at timestamptz,
  fix_rounds_used integer NOT NULL DEFAULT 0 CHECK (fix_rounds_used BETWEEN 0 AND 2),
  referral_member_id uuid REFERENCES public.referral_members(id) ON DELETE SET NULL,
  cancel_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX gig_contracts_active_uq ON public.gig_contracts(gig_id,creator_account_id)
  WHERE state NOT IN ('declined','expired','cancelled','completed','resolved_release','resolved_partial','resolved_refund');
CREATE INDEX gig_contracts_brand_idx ON public.gig_contracts(brand_id,state,updated_at DESC);
CREATE INDEX gig_contracts_creator_idx ON public.gig_contracts(creator_account_id,state,updated_at DESC);

CREATE TABLE public.gig_terms_versions (
  contract_id uuid NOT NULL REFERENCES public.gig_contracts(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version>0),
  fee_minor bigint NOT NULL CHECK (fee_minor>0),
  booking_fee_minor bigint NOT NULL CHECK (booking_fee_minor>=0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  format_key text NOT NULL REFERENCES public.gig_formats(key) ON DELETE RESTRICT,
  deliverables jsonb NOT NULL CHECK (jsonb_typeof(deliverables)='array'),
  shoot_date date,
  post_by date NOT NULL,
  usage_days integer NOT NULL CHECK (usage_days IN (30,90,365)),
  sales_share_bps integer CHECK (sales_share_bps BETWEEN 100 AND 3000),
  shoot_passes integer NOT NULL CHECK (shoot_passes BETWEEN 0 AND 4),
  proposed_by text NOT NULL CHECK (proposed_by IN ('host','creator')),
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(contract_id,version),
  CONSTRAINT gig_terms_booking_fee CHECK (booking_fee_minor=((fee_minor*1500+5000)/10000))
);

CREATE TABLE public.gig_change_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.gig_contracts(id) ON DELETE CASCADE,
  from_version integer NOT NULL CHECK (from_version>0),
  proposed_by text NOT NULL CHECK (proposed_by IN ('host','creator')),
  changes jsonb NOT NULL CHECK (jsonb_typeof(changes)='object'),
  reason text NOT NULL CHECK (reason IN ('price','dates','deliverables','usage','share','passes','other')),
  note text CHECK (note IS NULL OR char_length(note)<=300),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','accepted','declined','countered','expired','withdrawn')),
  expires_at timestamptz NOT NULL DEFAULT(now()+interval '48 hours'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gig_change_allowed_keys CHECK (
    changes - ARRAY['fee_minor','shoot_date','post_by','deliverables','usage_days','sales_share_bps','shoot_passes'] = '{}'::jsonb
  )
);
CREATE UNIQUE INDEX gig_change_one_open_uq ON public.gig_change_proposals(contract_id) WHERE status='open';

CREATE TABLE public.gig_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.gig_contracts(id) ON DELETE RESTRICT,
  terms_version integer NOT NULL,
  rail text NOT NULL CHECK (rail IN ('stripe','paystack')),
  amount_minor bigint NOT NULL CHECK (amount_minor>0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  provider_ref text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','captured','refunded','partially_refunded','released','failed')),
  idempotency_key text NOT NULL UNIQUE,
  captured_at timestamptz,
  refunded_minor bigint NOT NULL DEFAULT 0 CHECK (refunded_minor>=0 AND refunded_minor<=amount_minor),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(contract_id,terms_version),
  FOREIGN KEY(contract_id,terms_version) REFERENCES public.gig_terms_versions(contract_id,version) ON DELETE RESTRICT
);

CREATE TABLE public.gig_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.gig_contracts(id) ON DELETE CASCADE,
  at timestamptz NOT NULL DEFAULT now(),
  actor text NOT NULL CHECK (actor IN ('host','creator','system','admin')),
  kind text NOT NULL CHECK (char_length(kind) BETWEEN 2 AND 80),
  data jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(data)='object')
);
CREATE INDEX gig_events_timeline_idx ON public.gig_events(contract_id,at,id);

CREATE TRIGGER issue_3872_gigs_updated BEFORE UPDATE ON public.gigs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER issue_3872_interest_updated BEFORE UPDATE ON public.gig_interest FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER issue_3872_contracts_updated BEFORE UPDATE ON public.gig_contracts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER issue_3872_holds_updated BEFORE UPDATE ON public.gig_holds FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.issue_3872_immutable_row() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN RAISE EXCEPTION '% is append-only',TG_TABLE_NAME USING ERRCODE='55000'; END;
$fn$;
CREATE TRIGGER issue_3872_terms_immutable BEFORE UPDATE OR DELETE ON public.gig_terms_versions FOR EACH ROW EXECUTE FUNCTION public.issue_3872_immutable_row();
CREATE TRIGGER issue_3872_events_immutable BEFORE UPDATE OR DELETE ON public.gig_events FOR EACH ROW EXECUTE FUNCTION public.issue_3872_immutable_row();

CREATE OR REPLACE FUNCTION public.issue_3872_contract_state_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.state IS DISTINCT FROM OLD.state AND current_setting('issue3872.transition',true)<>'on' THEN
    RAISE EXCEPTION 'contract_state_requires_gig_transition' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER issue_3872_contract_state_guard BEFORE UPDATE OF state ON public.gig_contracts FOR EACH ROW EXECUTE FUNCTION public.issue_3872_contract_state_guard();

CREATE OR REPLACE FUNCTION public.issue_3872_brief_lint(
  p_brand_id uuid,p_listing_kind text,p_listing_id uuid,p_text text
) RETURNS text[] LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=public,pg_temp AS $fn$
DECLARE v_hits text[]:='{}'; v_brand public.brands; v_listing text;
BEGIN
  SELECT * INTO v_brand FROM public.brands WHERE id=p_brand_id;
  IF p_text ~* '(https?://|www\.)' THEN v_hits:=array_append(v_hits,'url'); END IF;
  IF p_text ~* '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}' THEN v_hits:=array_append(v_hits,'email'); END IF;
  IF p_text ~ '(^|[^0-9])\+?[0-9][0-9 ()-]{7,}[0-9]' THEN v_hits:=array_append(v_hits,'phone'); END IF;
  IF p_text ~* '(^|\s)@[a-z0-9_.-]+' THEN v_hits:=array_append(v_hits,'handle'); END IF;
  IF v_brand.id IS NOT NULL AND (p_text ILIKE '%'||v_brand.name||'%' OR p_text ILIKE '%'||v_brand.slug||'%') THEN v_hits:=array_append(v_hits,'brand'); END IF;
  IF p_listing_kind='event' THEN SELECT title INTO v_listing FROM public.events WHERE id=p_listing_id;
  ELSE SELECT name INTO v_listing FROM public.venue_listings WHERE id=p_listing_id; END IF;
  IF v_listing IS NOT NULL AND p_text ILIKE '%'||v_listing||'%' THEN v_hits:=array_append(v_hits,'listing'); END IF;
  RETURN v_hits;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.gig_save(p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_actor uuid:=auth.uid(); v_brand uuid:=(p_payload->>'brand_id')::uuid; v_id uuid; v_hits text[];
BEGIN
  IF v_actor IS NULL OR NOT public.biz_is_brand_member_for_read(v_brand,v_actor) THEN RAISE EXCEPTION 'permission_denied' USING ERRCODE='42501'; END IF;
  v_hits:=public.issue_3872_brief_lint(v_brand,p_payload->>'listing_kind',(p_payload->>'listing_id')::uuid,p_payload->>'title_public')
    || public.issue_3872_brief_lint(v_brand,p_payload->>'listing_kind',(p_payload->>'listing_id')::uuid,p_payload->>'brief_public');
  IF cardinality(v_hits)>0 THEN RETURN jsonb_build_object('ok',false,'error','public_brief_not_anonymous','reasons',to_jsonb(v_hits)); END IF;
  v_id:=coalesce((p_payload->>'id')::uuid,gen_random_uuid());
  INSERT INTO public.gigs(id,brand_id,listing_kind,listing_id,title_public,brief_public,brief_private,format_key,deliverables,must_tag,city_id,category,shoot_window_start,shoot_window_end,post_by,usage_days,budget_band,currency,sales_share_bps,shoot_passes,slots,visibility,status,created_by)
  VALUES(v_id,v_brand,p_payload->>'listing_kind',(p_payload->>'listing_id')::uuid,btrim(p_payload->>'title_public'),btrim(p_payload->>'brief_public'),p_payload->>'brief_private',p_payload->>'format_key',p_payload->'deliverables',coalesce(p_payload->'must_tag','{}'),(p_payload->>'city_id')::uuid,p_payload->>'category',(p_payload->>'shoot_window_start')::date,(p_payload->>'shoot_window_end')::date,(p_payload->>'post_by')::date,coalesce((p_payload->>'usage_days')::integer,90),p_payload->>'budget_band',upper(p_payload->>'currency'),nullif(p_payload->>'sales_share_bps','')::integer,coalesce((p_payload->>'shoot_passes')::integer,1),coalesce((p_payload->>'slots')::integer,1),coalesce(p_payload->>'visibility','board'),coalesce(p_payload->>'status','draft'),v_actor)
  ON CONFLICT(id) DO UPDATE SET title_public=excluded.title_public,brief_public=excluded.brief_public,brief_private=excluded.brief_private,format_key=excluded.format_key,deliverables=excluded.deliverables,must_tag=excluded.must_tag,city_id=excluded.city_id,category=excluded.category,shoot_window_start=excluded.shoot_window_start,shoot_window_end=excluded.shoot_window_end,post_by=excluded.post_by,usage_days=excluded.usage_days,budget_band=excluded.budget_band,sales_share_bps=excluded.sales_share_bps,shoot_passes=excluded.shoot_passes,slots=excluded.slots,visibility=excluded.visibility,status=excluded.status,version=public.gigs.version+1
  WHERE public.gigs.brand_id=v_brand AND public.gigs.status IN ('draft','open');
  RETURN jsonb_build_object('ok',true,'id',v_id);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.creator_gig_board(p_city_id uuid DEFAULT NULL,p_format_key text DEFAULT NULL) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=public,pg_temp AS $fn$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',g.id,'title_public',g.title_public,'brief_public',g.brief_public,'format_key',g.format_key,
    'deliverables',g.deliverables,'city_name',c.name,'category',g.category,
    'shoot_window',jsonb_build_object('start',g.shoot_window_start,'end',g.shoot_window_end),
    'post_by',g.post_by,'usage_days',g.usage_days,'budget_band',g.budget_band,
    'sales_share_bps',g.sales_share_bps,'slots_left',greatest(0,g.slots-(SELECT count(*) FROM public.gig_contracts x WHERE x.gig_id=g.id AND x.state NOT IN('declined','expired','cancelled','resolved_refund')))
  ) ORDER BY g.shoot_window_start,g.created_at),'[]'::jsonb)
  FROM public.gigs g JOIN public.seeding_cities c ON c.id=g.city_id
  WHERE g.status='open' AND g.shoot_window_end>=current_date
    AND (p_city_id IS NULL OR g.city_id=p_city_id) AND (p_format_key IS NULL OR g.format_key=p_format_key)
    AND (g.visibility='board' OR EXISTS(SELECT 1 FROM public.gig_invites i WHERE i.gig_id=g.id AND i.creator_account_id=auth.uid()))
    AND EXISTS(SELECT 1 FROM public.creator_profiles p WHERE p.creator_account_id=auth.uid() AND p.mode_enabled AND p.verification='verified');
$fn$;

CREATE OR REPLACE FUNCTION public.creator_gig_detail(p_gig_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=public,pg_temp AS $fn$
  SELECT jsonb_build_object('id',g.id,'title_public',g.title_public,'brief_public',g.brief_public,'format_key',g.format_key,'deliverables',g.deliverables,'city_name',c.name,'category',g.category,'shoot_window',jsonb_build_object('start',g.shoot_window_start,'end',g.shoot_window_end),'post_by',g.post_by,'usage_days',g.usage_days,'budget_band',g.budget_band,'sales_share_bps',g.sales_share_bps,'slots_left',greatest(0,g.slots-(SELECT count(*) FROM public.gig_contracts x WHERE x.gig_id=g.id AND x.state NOT IN('declined','expired','cancelled','resolved_refund'))))
  FROM public.gigs g JOIN public.seeding_cities c ON c.id=g.city_id
  WHERE g.id=p_gig_id AND g.status='open'
    AND (g.visibility='board' OR EXISTS(SELECT 1 FROM public.gig_invites i WHERE i.gig_id=g.id AND i.creator_account_id=auth.uid()));
$fn$;

CREATE OR REPLACE FUNCTION public.gig_interest_send(p_gig_id uuid,p_package_id uuid,p_quoted_minor bigint,p_note text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_actor uuid:=auth.uid(); v_gig public.gigs; v_hits text[];
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.creator_profiles WHERE creator_account_id=v_actor AND verification='verified' AND mode_enabled) THEN RAISE EXCEPTION 'creator_not_ready' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_gig FROM public.gigs WHERE id=p_gig_id AND status='open'; IF NOT FOUND THEN RAISE EXCEPTION 'gig_not_open' USING ERRCODE='P0002'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.creator_packages WHERE id=p_package_id AND creator_account_id=v_actor AND active) THEN RAISE EXCEPTION 'package_not_owned' USING ERRCODE='42501'; END IF;
  v_hits:=public.issue_3872_brief_lint(v_gig.brand_id,v_gig.listing_kind,v_gig.listing_id,coalesce(p_note,''));
  IF cardinality(v_hits)>0 THEN RETURN jsonb_build_object('ok',false,'error','note_not_anonymous','reasons',to_jsonb(v_hits)); END IF;
  IF (v_gig.currency='NGN' AND NOT EXISTS(SELECT 1 FROM public.payee_accounts WHERE user_id=v_actor AND paystack_status='verified')) OR (v_gig.currency<>'NGN' AND NOT EXISTS(SELECT 1 FROM public.payee_accounts WHERE user_id=v_actor AND stripe_status='active')) THEN
    RETURN jsonb_build_object('ok',false,'error','payout_rail_mismatch','currency',v_gig.currency);
  END IF;
  INSERT INTO public.gig_interest(gig_id,creator_account_id,package_id,quoted_minor,note) VALUES(p_gig_id,v_actor,p_package_id,p_quoted_minor,nullif(btrim(p_note),''))
  ON CONFLICT(gig_id,creator_account_id) DO UPDATE SET package_id=excluded.package_id,quoted_minor=excluded.quoted_minor,note=excluded.note,status='sent';
  RETURN jsonb_build_object('ok',true);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.gig_transition(p_contract_id uuid,p_expected_state text,p_action text,p_payload jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_actor uuid:=auth.uid(); v public.gig_contracts; v_is_host boolean; v_is_creator boolean; v_is_admin boolean; v_next text; v_actor_kind text; v_deadline timestamptz; v_fix integer;
BEGIN
  SELECT * INTO v FROM public.gig_contracts WHERE id=p_contract_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'contract_not_found' USING ERRCODE='P0002'; END IF;
  IF v.state<>p_expected_state THEN RAISE EXCEPTION 'stale_contract_state:%',v.state USING ERRCODE='40001'; END IF;
  v_is_host:=v_actor IS NOT NULL AND public.biz_is_brand_member_for_read(v.brand_id,v_actor);
  v_is_creator:=v_actor=v.creator_account_id;
  v_is_admin:=v_actor IS NOT NULL AND public.is_admin_user();
  v_actor_kind:=CASE WHEN v_actor IS NULL THEN 'system' WHEN v_is_host THEN 'host' WHEN v_is_creator THEN 'creator' WHEN v_is_admin THEN 'admin' ELSE 'unknown' END;
  v_fix:=v.fix_rounds_used;
  v_next:=CASE
    WHEN v.state='offered' AND p_action='accept' AND v_is_creator THEN 'accepted'
    WHEN v.state='offered' AND p_action='decline' AND v_is_creator THEN 'declined'
    WHEN v.state='offered' AND p_action='cancel' AND v_is_host THEN 'cancelled'
    WHEN v.state='offered' AND p_action='expire' AND v_actor IS NULL AND v.state_deadline_at<=now() THEN 'expired'
    WHEN v.state='accepted' AND p_action='plan_confirmed' AND (v_is_host OR v_is_creator) THEN 'shoot_planned'
    WHEN v.state='shoot_planned' AND p_action='start_script' AND (v_is_host OR v_is_creator) THEN 'script_drafting'
    WHEN v.state='script_drafting' AND p_action='send_script' AND v_is_creator THEN 'script_sent'
    WHEN v.state='script_sent' AND p_action IN ('lock_script','auto_lock') AND (v_is_host OR v_actor IS NULL) THEN 'script_locked'
    WHEN v.state='script_sent' AND p_action='request_script_changes' AND v_is_host AND v_fix<2 THEN 'script_drafting'
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
  IF v.state='offered' AND v_next='accepted' AND NOT EXISTS(SELECT 1 FROM public.gig_holds h WHERE h.contract_id=v.id AND h.terms_version=v.current_terms_version AND h.status='captured') THEN RAISE EXCEPTION 'captured_hold_required' USING ERRCODE='55000'; END IF;
  IF v.state='script_sent' AND p_action='request_script_changes' THEN v_fix:=v_fix+1; END IF;
  IF v.state='delivered' AND p_action='request_fix' THEN v_fix:=v_fix+1; END IF;
  v_deadline:=CASE WHEN v_next='offered' THEN now()+interval '48 hours' WHEN v_next='script_sent' THEN now()+interval '48 hours' WHEN v_next='delivered' THEN now()+interval '3 days' WHEN v_next='posts_verified' THEN now()+interval '48 hours' WHEN v_next='released' THEN now()+interval '30 days' ELSE NULL END;
  PERFORM set_config('issue3872.transition','on',true);
  UPDATE public.gig_contracts SET state=v_next,state_deadline_at=v_deadline,fix_rounds_used=v_fix,cancel_reason=CASE WHEN v_next='cancelled' THEN p_payload->>'reason' ELSE cancel_reason END WHERE id=v.id;
  IF v.state='script_sent' AND p_action IN ('lock_script','auto_lock') THEN
    PERFORM set_config('issue3872.script_lock','on',true);
    UPDATE public.gig_scripts
       SET locked_at=coalesce(locked_at,now()),locked_by=coalesce(locked_by,CASE WHEN p_action='auto_lock' THEN 'auto' ELSE 'host' END)
     WHERE contract_id=v.id
       AND version=(SELECT max(s.version) FROM public.gig_scripts s WHERE s.contract_id=v.id);
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

-- R3 extends the existing R2 payee ledger instead of creating a second payout
-- rail. Referral shares keep their existing attribution/member checks; gig fee
-- shares are owned by the contract and carry a zero Mingla fee.
ALTER TABLE public.payee_shares DROP CONSTRAINT payee_shares_attribution_fkey;
ALTER TABLE public.payee_shares DROP CONSTRAINT payee_shares_fee_rate;
ALTER TABLE public.payee_shares DROP CONSTRAINT payee_shares_identity;
ALTER TABLE public.payee_shares DROP CONSTRAINT payee_shares_one_payee;
ALTER TABLE public.payee_shares ALTER COLUMN member_id DROP NOT NULL;
ALTER TABLE public.payee_shares DROP CONSTRAINT payee_shares_order_kind_check;
ALTER TABLE public.payee_shares DROP CONSTRAINT payee_shares_payee_kind_check;
ALTER TABLE public.payee_shares ADD CONSTRAINT payee_shares_order_kind_check CHECK(order_kind IN ('ticket','venue_order','gig'));
ALTER TABLE public.payee_shares ADD CONSTRAINT payee_shares_payee_kind_check CHECK(payee_kind IN ('referral','gig_fee'));
ALTER TABLE public.payee_shares ADD CONSTRAINT payee_shares_identity CHECK(payee_user_id IS NOT NULL OR payee_email_norm IS NOT NULL);
ALTER TABLE public.payee_shares ADD CONSTRAINT payee_shares_fee_rate CHECK(
  (payee_kind='referral' AND mingla_fee_minor=((gross_minor*5+50)/100))
  OR (payee_kind='gig_fee' AND order_kind='gig' AND mingla_fee_minor=0 AND net_minor=gross_minor)
);
ALTER TABLE public.payee_shares ADD CONSTRAINT payee_shares_one_payee UNIQUE(order_kind,order_id,payee_kind);

CREATE OR REPLACE FUNCTION public.issue_3872_payee_share_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $fn$
DECLARE v_member public.referral_members%ROWTYPE; v_attribution public.order_attributions%ROWTYPE; v_contract public.gig_contracts%ROWTYPE;
BEGIN
  NEW.payee_email_norm:=NULLIF(lower(btrim(COALESCE(NEW.payee_email_norm,''))), '');
  IF NEW.payee_kind='gig_fee' THEN
    SELECT * INTO v_contract FROM public.gig_contracts WHERE id=NEW.order_id;
    IF NOT FOUND OR NEW.order_kind<>'gig' OR NEW.member_id IS NOT NULL
       OR NEW.brand_id<>v_contract.brand_id OR NEW.payee_user_id<>v_contract.creator_account_id
       OR NEW.gross_minor<>NEW.net_minor OR NEW.mingla_fee_minor<>0 THEN
      RAISE EXCEPTION 'gig_fee_share_contract_mismatch';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO v_member FROM public.referral_members WHERE id=NEW.member_id;
  IF NOT FOUND OR v_member.brand_id<>NEW.brand_id THEN RAISE EXCEPTION 'payee_share_member_mismatch'; END IF;
  IF NOT ((NEW.payee_user_id IS NOT NULL AND v_member.user_id=NEW.payee_user_id)
    OR (NEW.payee_email_norm IS NOT NULL AND v_member.email_norm=NEW.payee_email_norm)) THEN
    RAISE EXCEPTION 'payee_share_identity_mismatch';
  END IF;
  SELECT * INTO v_attribution FROM public.order_attributions WHERE order_kind=NEW.order_kind AND order_id=NEW.order_id;
  IF NOT FOUND OR v_attribution.brand_id<>NEW.brand_id OR v_attribution.member_id IS DISTINCT FROM NEW.member_id OR v_attribution.share_minor<>NEW.gross_minor THEN
    RAISE EXCEPTION 'payee_share_attribution_mismatch';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.gig_host_home(p_brand_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=public,pg_temp AS $fn$
  SELECT CASE WHEN public.biz_is_brand_member_for_read(p_brand_id,auth.uid()) THEN jsonb_build_object(
    'gigs',coalesce((SELECT jsonb_agg(to_jsonb(g) ORDER BY g.updated_at DESC) FROM public.gigs g WHERE g.brand_id=p_brand_id),'[]'::jsonb),
    'contracts',coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'gig_id',c.gig_id,'state',c.state,'deadline_at',c.state_deadline_at,'title',g.title_public,'creator',p.display_name) ORDER BY c.updated_at DESC) FROM public.gig_contracts c JOIN public.gigs g ON g.id=c.gig_id JOIN public.creator_profiles p ON p.creator_account_id=c.creator_account_id WHERE c.brand_id=p_brand_id),'[]'::jsonb)
  ) ELSE NULL END;
$fn$;

CREATE OR REPLACE FUNCTION public.gig_applicants(p_gig_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=public,pg_temp AS $fn$
  SELECT CASE WHEN public.biz_is_brand_member_for_read(g.brand_id,auth.uid()) THEN coalesce(jsonb_agg(jsonb_build_object(
    'interest_id',i.id,'creator_id',i.creator_account_id,'display_name',p.display_name,'niches',p.niches,
    'follower_bands',(SELECT coalesce(jsonb_agg(jsonb_build_object('platform',h.platform,'band',h.follower_band,'verified',h.verified_at IS NOT NULL)),'[]'::jsonb) FROM public.creator_handles h WHERE h.creator_account_id=i.creator_account_id),
    'rating',CASE WHEN p.rating_count>0 THEN p.rating_avg_x100/100.0 END,'completed',p.completed_gigs,'reliability',p.reliability_bps,
    'quote_minor',i.quoted_minor,'currency',g.currency,'package_id',i.package_id,'note',i.note,'status',i.status
  ) ORDER BY i.created_at),'[]'::jsonb) ELSE NULL END
  FROM public.gigs g LEFT JOIN public.gig_interest i ON i.gig_id=g.id LEFT JOIN public.creator_profiles p ON p.creator_account_id=i.creator_account_id
  WHERE g.id=p_gig_id GROUP BY g.brand_id;
$fn$;

CREATE OR REPLACE FUNCTION public.prehire_creator_profile(p_creator_account_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=public,pg_temp AS $fn$
  SELECT CASE WHEN EXISTS(SELECT 1 FROM public.brands b WHERE public.biz_is_brand_member_for_read(b.id,auth.uid()))
    AND p.mode_enabled AND p.verification='verified' THEN jsonb_build_object(
      'id',p.creator_account_id,'display_name',p.display_name,'city_id',p.home_city_id,'niches',p.niches,'languages',p.languages,
      'follower_bands',(SELECT coalesce(jsonb_agg(jsonb_build_object('platform',h.platform,'band',h.follower_band,'verified',h.verified_at IS NOT NULL,'source',h.follower_source) ORDER BY h.platform),'[]'::jsonb) FROM public.creator_handles h WHERE h.creator_account_id=p.creator_account_id AND h.verified_at IS NOT NULL AND NOT h.review_required),
      'showcase',(SELECT coalesce(jsonb_agg(jsonb_build_object('media_id',m.id,'thumb',NULL) ORDER BY m.created_at DESC),'[]'::jsonb) FROM public.creator_media_jobs m WHERE m.owner_id=p.creator_account_id AND m.purpose='showcase' AND m.status='ready' AND m.deleted_at IS NULL),
      'rating',CASE WHEN p.rating_count>0 THEN p.rating_avg_x100/100.0 END,'rating_count',p.rating_count,'completed',p.completed_gigs,'reliability',p.reliability_bps,
      'packages',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'format_key',c.format_key,'platforms',c.platforms,'price_minor',c.price_minor,'currency',c.currency,'turnaround_days',c.turnaround_days,'includes_usage_days',c.includes_usage_days,'extra_usage_price_minor',c.extra_usage_price_minor) ORDER BY c.format_key),'[]'::jsonb) FROM public.creator_packages c WHERE c.creator_account_id=p.creator_account_id AND c.active)
    ) ELSE NULL END FROM public.creator_profiles p WHERE p.creator_account_id=p_creator_account_id;
$fn$;

CREATE OR REPLACE FUNCTION public.gig_interest_decide(p_interest_id uuid,p_status text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_interest public.gig_interest; v_brand uuid;
BEGIN
  IF p_status NOT IN ('shortlisted','passed') THEN RAISE EXCEPTION 'invalid_interest_status' USING ERRCODE='22023'; END IF;
  SELECT i,g.brand_id INTO v_interest,v_brand FROM public.gig_interest i JOIN public.gigs g ON g.id=i.gig_id WHERE i.id=p_interest_id FOR UPDATE OF i;
  IF NOT FOUND OR NOT public.biz_is_brand_member_for_read(v_brand,auth.uid()) THEN RAISE EXCEPTION 'permission_denied' USING ERRCODE='42501'; END IF;
  UPDATE public.gig_interest SET status=p_status WHERE id=p_interest_id;
  RETURN jsonb_build_object('ok',true,'status',p_status);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.gig_offer_prepare(p_interest_id uuid,p_terms jsonb,p_idempotency_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_interest public.gig_interest; v_gig public.gigs; v_contract uuid; v_fee bigint; v_booking bigint; v_rail text; v_existing public.gig_holds;
BEGIN
  SELECT * INTO v_existing FROM public.gig_holds WHERE idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF NOT EXISTS(SELECT 1 FROM public.gig_contracts c WHERE c.id=v_existing.contract_id AND public.biz_is_brand_member_for_read(c.brand_id,auth.uid())) THEN RAISE EXCEPTION 'permission_denied' USING ERRCODE='42501'; END IF;
    SELECT t.fee_minor,t.booking_fee_minor INTO v_fee,v_booking FROM public.gig_terms_versions t WHERE t.contract_id=v_existing.contract_id AND t.version=v_existing.terms_version;
    RETURN jsonb_build_object('contract_id',v_existing.contract_id,'terms_version',v_existing.terms_version,'rail',v_existing.rail,'fee_minor',v_fee,'booking_fee_minor',v_booking,'total_minor',v_existing.amount_minor,'currency',v_existing.currency,'replayed',true);
  END IF;
  SELECT * INTO v_interest FROM public.gig_interest WHERE id=p_interest_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'interest_not_found' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_gig FROM public.gigs WHERE id=v_interest.gig_id;
  IF NOT public.biz_is_brand_member_for_read(v_gig.brand_id,auth.uid()) THEN RAISE EXCEPTION 'permission_denied' USING ERRCODE='42501'; END IF;
  v_fee:=coalesce((p_terms->>'fee_minor')::bigint,v_interest.quoted_minor); v_booking:=((v_fee*1500+5000)/10000); v_rail:=CASE WHEN v_gig.currency='NGN' THEN 'paystack' ELSE 'stripe' END;
  INSERT INTO public.gig_contracts(gig_id,brand_id,creator_account_id,state,state_deadline_at)
  VALUES(v_gig.id,v_gig.brand_id,v_interest.creator_account_id,'offered',now()+interval '48 hours') RETURNING id INTO v_contract;
  INSERT INTO public.gig_terms_versions(contract_id,version,fee_minor,booking_fee_minor,currency,format_key,deliverables,shoot_date,post_by,usage_days,sales_share_bps,shoot_passes,proposed_by)
  VALUES(v_contract,1,v_fee,v_booking,v_gig.currency,v_gig.format_key,coalesce(p_terms->'deliverables',v_gig.deliverables),nullif(p_terms->>'shoot_date','')::date,coalesce(nullif(p_terms->>'post_by','')::date,v_gig.post_by),coalesce(nullif(p_terms->>'usage_days','')::integer,v_gig.usage_days),coalesce(nullif(p_terms->>'sales_share_bps','')::integer,v_gig.sales_share_bps),coalesce(nullif(p_terms->>'shoot_passes','')::integer,v_gig.shoot_passes),'host');
  INSERT INTO public.gig_holds(contract_id,terms_version,rail,amount_minor,currency,idempotency_key)
  VALUES(v_contract,1,v_rail,v_fee+v_booking,v_gig.currency,p_idempotency_key);
  UPDATE public.gig_interest SET status='offered' WHERE id=v_interest.id;
  INSERT INTO public.gig_events(contract_id,actor,kind,data) VALUES(v_contract,'host','offer_created',jsonb_build_object('terms_version',1,'amount_minor',v_fee+v_booking));
  RETURN jsonb_build_object('contract_id',v_contract,'terms_version',1,'rail',v_rail,'fee_minor',v_fee,'booking_fee_minor',v_booking,'total_minor',v_fee+v_booking,'currency',v_gig.currency);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.gig_hold_mark_captured(p_contract_id uuid,p_terms_version integer,p_provider_ref text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_hold public.gig_holds;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'service_role_only' USING ERRCODE='42501'; END IF;
  UPDATE public.gig_holds SET status='captured',provider_ref=p_provider_ref,captured_at=now() WHERE contract_id=p_contract_id AND terms_version=p_terms_version AND status='pending' RETURNING * INTO v_hold;
  IF NOT FOUND THEN RAISE EXCEPTION 'hold_not_pending' USING ERRCODE='55000'; END IF;
  INSERT INTO public.gig_events(contract_id,actor,kind,data) VALUES(p_contract_id,'system','hold_captured',jsonb_build_object('terms_version',p_terms_version,'rail',v_hold.rail));
  RETURN to_jsonb(v_hold);
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
  SELECT jsonb_build_object('contract',to_jsonb(v),'party',v_party,'revealed',v_revealed,
    'gig',jsonb_build_object('id',g.id,'title_public',g.title_public,'brief_public',g.brief_public,'brief_private',CASE WHEN v_revealed THEN g.brief_private END,'brand_id',CASE WHEN v_revealed THEN g.brand_id END,'listing_kind',CASE WHEN v_revealed THEN g.listing_kind END,'listing_id',CASE WHEN v_revealed THEN g.listing_id END,'must_tag',CASE WHEN v_revealed THEN g.must_tag END,'format_key',g.format_key,'post_by',g.post_by),
    'terms',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY version) FROM public.gig_terms_versions t WHERE t.contract_id=v.id),'[]'::jsonb),
    'events',coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY at,id) FROM public.gig_events e WHERE e.contract_id=v.id),'[]'::jsonb),
    'hold',(SELECT to_jsonb(h) FROM public.gig_holds h WHERE h.contract_id=v.id AND h.terms_version=v.current_terms_version)
  ) INTO v_result FROM public.gigs g WHERE g.id=v.gig_id;
  RETURN v_result;
END;
$fn$;

ALTER TABLE public.gigs ENABLE ROW LEVEL SECURITY; ALTER TABLE public.gigs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.gig_interest ENABLE ROW LEVEL SECURITY; ALTER TABLE public.gig_interest FORCE ROW LEVEL SECURITY;
ALTER TABLE public.gig_invites ENABLE ROW LEVEL SECURITY; ALTER TABLE public.gig_invites FORCE ROW LEVEL SECURITY;
ALTER TABLE public.gig_contracts ENABLE ROW LEVEL SECURITY; ALTER TABLE public.gig_contracts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.gig_terms_versions ENABLE ROW LEVEL SECURITY; ALTER TABLE public.gig_terms_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.gig_change_proposals ENABLE ROW LEVEL SECURITY; ALTER TABLE public.gig_change_proposals FORCE ROW LEVEL SECURITY;
ALTER TABLE public.gig_holds ENABLE ROW LEVEL SECURITY; ALTER TABLE public.gig_holds FORCE ROW LEVEL SECURITY;
ALTER TABLE public.gig_events ENABLE ROW LEVEL SECURITY; ALTER TABLE public.gig_events FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.gigs,public.gig_interest,public.gig_invites,public.gig_contracts,public.gig_terms_versions,public.gig_change_proposals,public.gig_holds,public.gig_events FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.gigs,public.gig_interest,public.gig_invites,public.gig_contracts,public.gig_terms_versions,public.gig_change_proposals,public.gig_holds,public.gig_events TO service_role;
GRANT SELECT ON public.gigs,public.gig_interest,public.gig_invites,public.gig_contracts,public.gig_terms_versions,public.gig_change_proposals,public.gig_holds,public.gig_events TO authenticated;

CREATE POLICY gigs_host_read ON public.gigs FOR SELECT TO authenticated USING(public.biz_is_brand_member_for_read(brand_id,auth.uid()));
CREATE POLICY gigs_service_all ON public.gigs FOR ALL TO service_role USING(true) WITH CHECK(true);
CREATE POLICY interest_party_read ON public.gig_interest FOR SELECT TO authenticated USING(creator_account_id=auth.uid() OR EXISTS(SELECT 1 FROM public.gigs g WHERE g.id=gig_id AND public.biz_is_brand_member_for_read(g.brand_id,auth.uid())));
CREATE POLICY interest_service_all ON public.gig_interest FOR ALL TO service_role USING(true) WITH CHECK(true);
CREATE POLICY invites_party_read ON public.gig_invites FOR SELECT TO authenticated USING(creator_account_id=auth.uid() OR EXISTS(SELECT 1 FROM public.gigs g WHERE g.id=gig_id AND public.biz_is_brand_member_for_read(g.brand_id,auth.uid())));
CREATE POLICY invites_service_all ON public.gig_invites FOR ALL TO service_role USING(true) WITH CHECK(true);
CREATE POLICY contracts_party_read ON public.gig_contracts FOR SELECT TO authenticated USING(creator_account_id=auth.uid() OR public.biz_is_brand_member_for_read(brand_id,auth.uid()));
CREATE POLICY contracts_service_all ON public.gig_contracts FOR ALL TO service_role USING(true) WITH CHECK(true);
CREATE POLICY terms_party_read ON public.gig_terms_versions FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.gig_contracts c WHERE c.id=contract_id AND (c.creator_account_id=auth.uid() OR public.biz_is_brand_member_for_read(c.brand_id,auth.uid()))));
CREATE POLICY terms_service_all ON public.gig_terms_versions FOR ALL TO service_role USING(true) WITH CHECK(true);
CREATE POLICY proposals_party_read ON public.gig_change_proposals FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.gig_contracts c WHERE c.id=contract_id AND (c.creator_account_id=auth.uid() OR public.biz_is_brand_member_for_read(c.brand_id,auth.uid()))));
CREATE POLICY proposals_service_all ON public.gig_change_proposals FOR ALL TO service_role USING(true) WITH CHECK(true);
CREATE POLICY holds_party_read ON public.gig_holds FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.gig_contracts c WHERE c.id=contract_id AND (c.creator_account_id=auth.uid() OR public.biz_is_brand_member_for_read(c.brand_id,auth.uid()))));
CREATE POLICY holds_service_all ON public.gig_holds FOR ALL TO service_role USING(true) WITH CHECK(true);
CREATE POLICY events_party_read ON public.gig_events FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.gig_contracts c WHERE c.id=contract_id AND (c.creator_account_id=auth.uid() OR public.biz_is_brand_member_for_read(c.brand_id,auth.uid()))));
CREATE POLICY events_service_all ON public.gig_events FOR ALL TO service_role USING(true) WITH CHECK(true);

REVOKE ALL ON FUNCTION public.issue_3872_brief_lint(uuid,text,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_brief_lint(uuid,text,uuid,text) TO service_role;
REVOKE ALL ON FUNCTION public.gig_save(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.gig_save(jsonb) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.creator_gig_board(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.creator_gig_board(uuid,text) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.creator_gig_detail(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.creator_gig_detail(uuid) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.gig_interest_send(uuid,uuid,bigint,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.gig_interest_send(uuid,uuid,bigint,text) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.gig_transition(uuid,text,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.gig_transition(uuid,text,text,jsonb) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.gig_host_home(uuid),public.gig_applicants(uuid),public.prehire_creator_profile(uuid),public.gig_interest_decide(uuid,text),public.gig_offer_prepare(uuid,jsonb,text),public.gig_contract_workspace(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.gig_host_home(uuid),public.gig_applicants(uuid),public.prehire_creator_profile(uuid),public.gig_interest_decide(uuid,text),public.gig_offer_prepare(uuid,jsonb,text),public.gig_contract_workspace(uuid) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.gig_hold_mark_captured(uuid,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gig_hold_mark_captured(uuid,integer,text) TO service_role;

COMMIT;
