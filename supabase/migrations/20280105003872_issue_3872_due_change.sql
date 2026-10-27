-- #3872: changing the video-due date after hire carries a date AND a time.
--
-- Seth's decision: once a creator is hired, a request to change when the
-- video is due names an exact date and time, and both apps show the agreed
-- due date and time from the contract's current terms (not the gig's
-- original brief).
--
-- 1. gig_terms_versions.video_due_at (exact due time). Existing rows take the
--    gig's video_due_at when it falls on the row's post_by day, otherwise
--    23:59 local on post_by. New rows that do not name one (offers, counter
--    acceptance) get the same rule from a BEFORE INSERT trigger, or keep the
--    previous version's time when the day did not change.
-- 2. gig_change_proposal_save accepts changes.video_due_at (listing-local
--    "YYYY-MM-DDTHH:MM", or an ISO time with an offset). It must be in the
--    future and after the agreed shoot time; failures answer
--    {ok:false,error:'video_due_required'|'video_due_before_shoot',field:'video_due_at'}.
--    Legacy changes.post_by still works and means 23:59 local that day. The
--    stored change always carries both video_due_at and post_by.
-- 3. gig_change_proposal_respond stores the new video_due_at and its local
--    date as post_by on the next terms version. A stale proposal raises
--    PT409 (app conflict), never 40001.
-- 4. Reads use the current terms: gig_contract_workspace (gig.video_due_at /
--    gig.post_by), gig_creator_home and gig_host_home contracts
--    (video_due_at, post_by), and the post reminder payload.
BEGIN;
SET LOCAL lock_timeout = '10s';

-- 1. Exact due time on every terms version ---------------------------------
ALTER TABLE public.gig_terms_versions ADD COLUMN video_due_at timestamptz;

-- The due time a terms row implies when it names only a day.
CREATE OR REPLACE FUNCTION public.issue_3872_terms_due_at(p_contract_id uuid,p_version integer,p_post_by date) RETURNS timestamptz
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_gig public.gigs; v_tz text; v_prev timestamptz;
BEGIN
  IF p_post_by IS NULL THEN RETURN NULL; END IF;
  SELECT g.* INTO v_gig FROM public.gig_contracts c JOIN public.gigs g ON g.id=c.gig_id WHERE c.id=p_contract_id;
  v_tz:=public.issue_3872_gig_timezone(v_gig.id);
  SELECT t.video_due_at INTO v_prev FROM public.gig_terms_versions t
   WHERE t.contract_id=p_contract_id AND t.version<p_version AND t.video_due_at IS NOT NULL
   ORDER BY t.version DESC LIMIT 1;
  IF v_prev IS NOT NULL AND (v_prev AT TIME ZONE v_tz)::date=p_post_by THEN RETURN v_prev; END IF;
  IF v_gig.video_due_at IS NOT NULL AND (v_gig.video_due_at AT TIME ZONE v_tz)::date=p_post_by THEN RETURN v_gig.video_due_at; END IF;
  RETURN (p_post_by+time '23:59') AT TIME ZONE v_tz;
END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_3872_terms_due_at(uuid,integer,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_terms_due_at(uuid,integer,date) TO service_role;

-- Terms rows are append-only; the backfill runs once with the guard off.
ALTER TABLE public.gig_terms_versions DISABLE TRIGGER issue_3872_terms_immutable;
UPDATE public.gig_terms_versions t
   SET video_due_at=public.issue_3872_terms_due_at(t.contract_id,t.version,t.post_by)
 WHERE t.video_due_at IS NULL;
ALTER TABLE public.gig_terms_versions ENABLE TRIGGER issue_3872_terms_immutable;

CREATE OR REPLACE FUNCTION public.issue_3872_terms_due_fill() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
BEGIN
  IF NEW.video_due_at IS NULL THEN
    NEW.video_due_at:=public.issue_3872_terms_due_at(NEW.contract_id,NEW.version,NEW.post_by);
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER issue_3872_terms_due_fill BEFORE INSERT ON public.gig_terms_versions
  FOR EACH ROW EXECUTE FUNCTION public.issue_3872_terms_due_fill();

-- Change proposals may name the exact due time.
ALTER TABLE public.gig_change_proposals DROP CONSTRAINT gig_change_allowed_keys;
ALTER TABLE public.gig_change_proposals ADD CONSTRAINT gig_change_allowed_keys CHECK (
  changes - ARRAY['fee_minor','shoot_date','post_by','video_due_at','deliverables','usage_days','sales_share_bps','shoot_passes'] = '{}'::jsonb
);

-- 2. Proposing a change -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.gig_change_proposal_save(
  p_contract_id uuid,p_changes jsonb,p_reason text,p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE
  v_actor uuid:=auth.uid(); v_party text; v_contract public.gig_contracts; v_proposal public.gig_change_proposals;
  v_changes jsonb; v_tz text; v_due timestamptz; v_shoot timestamptz; v_gig public.gigs;
BEGIN
  v_party:=public.issue_3872_contract_party(p_contract_id,v_actor);
  IF v_party IS NULL THEN RAISE EXCEPTION 'permission_denied' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_contract FROM public.gig_contracts WHERE id=p_contract_id FOR UPDATE;
  IF v_contract.state NOT IN ('offered','accepted','shoot_planned','script_drafting','script_sent') THEN
    RAISE EXCEPTION 'terms_change_window_closed' USING ERRCODE='55000';
  END IF;
  IF jsonb_typeof(p_changes)<>'object' OR p_changes='{}'::jsonb
     OR p_changes ? 'fee_minor'
     OR p_changes - ARRAY['shoot_date','post_by','video_due_at','deliverables','usage_days','sales_share_bps','shoot_passes'] <> '{}'::jsonb THEN
    RAISE EXCEPTION 'terms_change_invalid' USING ERRCODE='22023';
  END IF;
  IF p_reason NOT IN ('dates','deliverables','usage','share','passes','other')
     OR char_length(coalesce(p_note,''))>300 THEN
    RAISE EXCEPTION 'terms_change_reason_invalid' USING ERRCODE='22023';
  END IF;
  v_changes:=p_changes;
  -- The due time: video_due_at (exact, listing-local when it has no offset)
  -- or legacy post_by (23:59 local that day).
  IF p_changes ? 'video_due_at' OR p_changes ? 'post_by' THEN
    SELECT * INTO v_gig FROM public.gigs WHERE id=v_contract.gig_id;
    v_tz:=public.issue_3872_gig_timezone(v_gig.id);
    IF p_changes ? 'video_due_at' THEN
      v_due:=public.issue_3872_listing_time(p_changes->>'video_due_at',v_tz);
    ELSIF coalesce(p_changes->>'post_by','') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
      BEGIN v_due:=((p_changes->>'post_by')::date+time '23:59') AT TIME ZONE v_tz;
      EXCEPTION WHEN others THEN v_due:=NULL; END;
    END IF;
    IF v_due IS NULL OR v_due<=now() THEN
      RETURN jsonb_build_object('ok',false,'error','video_due_required','field','video_due_at');
    END IF;
    -- After the agreed shoot: the confirmed plan, else the brief's fixed time.
    v_shoot:=coalesce((SELECT s.shoot_at FROM public.gig_shoot_plans s WHERE s.contract_id=v_contract.id AND s.confirmed_at IS NOT NULL),v_gig.shoot_at);
    IF v_shoot IS NOT NULL AND v_due<=v_shoot THEN
      RETURN jsonb_build_object('ok',false,'error','video_due_before_shoot','field','video_due_at');
    END IF;
    v_changes:=(v_changes-'video_due_at'-'post_by')||jsonb_build_object('video_due_at',v_due,'post_by',(v_due AT TIME ZONE v_tz)::date);
  END IF;
  UPDATE public.gig_change_proposals SET status='expired'
   WHERE contract_id=p_contract_id AND status='open' AND expires_at<=now();
  IF EXISTS(SELECT 1 FROM public.gig_change_proposals WHERE contract_id=p_contract_id AND status='open') THEN
    RAISE EXCEPTION 'terms_change_already_open' USING ERRCODE='55000';
  END IF;
  INSERT INTO public.gig_change_proposals(contract_id,from_version,proposed_by,changes,reason,note)
  VALUES(p_contract_id,v_contract.current_terms_version,v_party,v_changes,p_reason,nullif(btrim(p_note),''))
  RETURNING * INTO v_proposal;
  INSERT INTO public.gig_events(contract_id,actor,kind,data)
  VALUES(p_contract_id,v_party,'terms_change_proposed',jsonb_build_object('proposal_id',v_proposal.id,'from_version',v_proposal.from_version,'reason',v_proposal.reason,'changes',v_proposal.changes));
  RETURN to_jsonb(v_proposal)||jsonb_build_object('ok',true);
END;
$fn$;
REVOKE ALL ON FUNCTION public.gig_change_proposal_save(uuid,jsonb,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.gig_change_proposal_save(uuid,jsonb,text,text) TO authenticated,service_role;

-- 3. Answering a change -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.gig_change_proposal_respond(
  p_proposal_id uuid,p_accept boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE
  v_actor uuid:=auth.uid(); v_party text; v_contract public.gig_contracts; v_proposal public.gig_change_proposals;
  v_terms public.gig_terms_versions; v_next integer; v_tz text; v_due timestamptz; v_post_by date;
BEGIN
  SELECT * INTO v_proposal FROM public.gig_change_proposals WHERE id=p_proposal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'terms_change_not_found' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_contract FROM public.gig_contracts WHERE id=v_proposal.contract_id FOR UPDATE;
  v_party:=public.issue_3872_contract_party(v_contract.id,v_actor);
  IF v_party IS NULL OR v_party=v_proposal.proposed_by THEN RAISE EXCEPTION 'terms_change_other_party_required' USING ERRCODE='42501'; END IF;
  IF v_proposal.status<>'open' OR v_proposal.expires_at<=now() OR v_proposal.from_version<>v_contract.current_terms_version THEN
    RAISE EXCEPTION 'terms_change_stale' USING ERRCODE='PT409';
  END IF;
  IF NOT p_accept THEN
    UPDATE public.gig_change_proposals SET status='declined' WHERE id=v_proposal.id;
    INSERT INTO public.gig_events(contract_id,actor,kind,data) VALUES(v_contract.id,v_party,'terms_change_declined',jsonb_build_object('proposal_id',v_proposal.id));
    RETURN jsonb_build_object('ok',true,'status','declined');
  END IF;
  SELECT * INTO v_terms FROM public.gig_terms_versions WHERE contract_id=v_contract.id AND version=v_contract.current_terms_version;
  v_next:=v_contract.current_terms_version+1;
  v_tz:=public.issue_3872_gig_timezone(v_contract.gig_id);
  IF v_proposal.changes ? 'video_due_at' THEN
    v_due:=(v_proposal.changes->>'video_due_at')::timestamptz;
    v_post_by:=(v_due AT TIME ZONE v_tz)::date;
  ELSIF v_proposal.changes ? 'post_by' THEN
    -- Proposals saved before exact times: 23:59 local that day.
    v_post_by:=(v_proposal.changes->>'post_by')::date;
    v_due:=(v_post_by+time '23:59') AT TIME ZONE v_tz;
  ELSE
    v_post_by:=v_terms.post_by;
    v_due:=coalesce(v_terms.video_due_at,public.issue_3872_terms_due_at(v_contract.id,v_next,v_post_by));
  END IF;
  INSERT INTO public.gig_terms_versions(
    contract_id,version,fee_minor,booking_fee_minor,currency,format_key,deliverables,
    shoot_date,post_by,video_due_at,usage_days,sales_share_bps,shoot_passes,proposed_by,accepted_at
  ) VALUES(
    v_contract.id,v_next,v_terms.fee_minor,v_terms.booking_fee_minor,v_terms.currency,v_terms.format_key,
    coalesce(v_proposal.changes->'deliverables',v_terms.deliverables),
    coalesce((v_proposal.changes->>'shoot_date')::date,v_terms.shoot_date),
    v_post_by,v_due,
    coalesce((v_proposal.changes->>'usage_days')::integer,v_terms.usage_days),
    CASE WHEN v_proposal.changes ? 'sales_share_bps' THEN nullif(v_proposal.changes->>'sales_share_bps','')::integer ELSE v_terms.sales_share_bps END,
    coalesce((v_proposal.changes->>'shoot_passes')::integer,v_terms.shoot_passes),
    v_proposal.proposed_by,now()
  );
  UPDATE public.gig_holds SET terms_version=v_next
   WHERE contract_id=v_contract.id AND terms_version=v_contract.current_terms_version;
  UPDATE public.gig_contracts SET current_terms_version=v_next WHERE id=v_contract.id;
  UPDATE public.gig_change_proposals SET status='accepted' WHERE id=v_proposal.id;
  INSERT INTO public.gig_events(contract_id,actor,kind,data)
  VALUES(v_contract.id,v_party,'terms_change_accepted',jsonb_build_object('proposal_id',v_proposal.id,'version',v_next));
  RETURN jsonb_build_object('ok',true,'status','accepted','version',v_next,'video_due_at',v_due,'post_by',v_post_by);
END;
$fn$;
REVOKE ALL ON FUNCTION public.gig_change_proposal_respond(uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.gig_change_proposal_respond(uuid,boolean) TO authenticated,service_role;

-- 4. Reads show the agreed (current terms) due ------------------------------
-- Workspace: unchanged from 20280104003872_issue_3872_workspace_shoot_window.sql
-- except gig.video_due_at / gig.post_by come from the current terms.
CREATE OR REPLACE FUNCTION public.gig_contract_workspace(p_contract_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE v public.gig_contracts; v_party text; v_revealed boolean; v_result jsonb; v_due timestamptz; v_post_by date;
BEGIN
  SELECT * INTO v FROM public.gig_contracts WHERE id=p_contract_id; IF NOT FOUND THEN RETURN NULL; END IF;
  v_party:=CASE WHEN auth.uid()=v.creator_account_id THEN 'creator' WHEN public.biz_is_brand_member_for_read(v.brand_id,auth.uid()) THEN 'host' WHEN public.is_admin_user() THEN 'admin' ELSE NULL END;
  IF v_party IS NULL THEN RAISE EXCEPTION 'permission_denied' USING ERRCODE='42501'; END IF;
  IF v_party='creator' AND ((v.state='offered' AND NOT public.issue_3872_offer_ready(v.id)) OR v.cancel_reason IS NOT DISTINCT FROM 'payment_not_completed') THEN
    RAISE EXCEPTION 'offer_not_ready' USING ERRCODE='P0002';
  END IF;
  v_revealed:=v.state NOT IN ('offered','declined','expired','cancelled') AND EXISTS(SELECT 1 FROM public.gig_holds h WHERE h.contract_id=v.id AND h.terms_version=v.current_terms_version AND h.status IN ('captured','released','partially_refunded'));
  SELECT t.video_due_at,t.post_by INTO v_due,v_post_by FROM public.gig_terms_versions t WHERE t.contract_id=v.id AND t.version=v.current_terms_version;
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
    -- The agreed due (current terms), not the brief's original one.
    'gig',jsonb_build_object('id',g.id,'video_due_at',coalesce(v_due,g.video_due_at),'shoot_at',g.shoot_at,'shoot_window',CASE WHEN g.shoot_window_start IS NULL AND g.shoot_window_end IS NULL THEN NULL ELSE jsonb_build_object('start',g.shoot_window_start,'end',g.shoot_window_end) END,'title_public',g.title_public,'brief_public',g.brief_public,'brief_private',CASE WHEN v_revealed THEN g.brief_private END,'brand_id',CASE WHEN v_revealed THEN g.brand_id END,'listing_kind',CASE WHEN v_revealed THEN g.listing_kind END,'listing_id',CASE WHEN v_revealed THEN g.listing_id END,'must_tag',CASE WHEN v_revealed THEN g.must_tag END,'format_key',g.format_key,'post_by',coalesce(v_post_by,g.post_by)),
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
$fn$;

-- Creator home: unchanged from 20271230003872_issue_3872_walkthrough_creator_gigs.sql
-- except contracts carry the agreed video_due_at (post_by already read terms).
CREATE OR REPLACE FUNCTION public.gig_creator_home() RETURNS jsonb
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=public,pg_temp AS $fn$
  SELECT jsonb_build_object(
    'contracts',coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id',c.id,'state',c.state,'deadline_at',c.state_deadline_at,'title',g.title_public,
        'format_key',g.format_key,'city',sc.name,'post_by',coalesce(tv.post_by,g.post_by),
        'video_due_at',coalesce(tv.video_due_at,g.video_due_at),
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

-- Host home: unchanged from 20280102003872_issue_3872_round2.sql except
-- contracts carry the agreed video_due_at and post_by.
CREATE OR REPLACE FUNCTION public.gig_host_home(p_brand_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
  SELECT CASE WHEN public.biz_is_brand_member_for_read(p_brand_id,auth.uid()) THEN jsonb_build_object(
    'gigs',coalesce((SELECT jsonb_agg(to_jsonb(g)||jsonb_build_object(
        'interest_count',(SELECT count(*) FROM public.gig_interest i WHERE i.gig_id=g.id AND i.status IN ('sent','shortlisted')
           AND NOT public.issue_3872_creator_hired_on_gig(g.id,i.creator_account_id)),
        'hired_count',(SELECT count(*) FROM public.gig_contracts x WHERE x.gig_id=g.id AND x.state NOT IN ('offered','declined','expired','cancelled','resolved_refund')),
        'slots_left',public.issue_3872_gig_slots_left(g.id)
      ) ORDER BY g.updated_at DESC) FROM public.gigs g WHERE g.brand_id=p_brand_id),'[]'::jsonb),
    'contracts',coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id',c.id,'gig_id',c.gig_id,'state',c.state,'deadline_at',c.state_deadline_at,'title',g.title_public,'creator',p.display_name,
        'video_due_at',coalesce(tv.video_due_at,g.video_due_at),'post_by',coalesce(tv.post_by,g.post_by),
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

-- Post reminder: unchanged from 20271230003872_issue_3872_walkthrough_creator_gigs.sql
-- except the payload also carries the agreed video_due_at. It already reads
-- the current terms version's post_by, which an accepted change now moves.
-- (gig_transition's script_locked deadline also reads the current terms'
-- post_by and is left as it is.)
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
      'contract_id',contract.id,'post_by',terms.post_by,'video_due_at',terms.video_due_at,
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

COMMIT;
