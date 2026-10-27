-- #3872 walkthrough: gaps the Explorer build found.
-- 1. The contract workspace reveals the brand and place after acceptance.
-- 2. Shoot times are checked against the window in the listing's own time zone
--    (an evening time in Raleigh was refused because UTC had moved to the next day).
-- 3. Creators can withdraw interest they sent.
-- 4. The public Creator card can say what the creator is promoting now.
BEGIN;
SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION public.issue_3872_gig_timezone(p_gig_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
  SELECT coalesce(
    (SELECT nullif(e.timezone,'') FROM public.gigs g JOIN public.events e ON e.id=g.listing_id AND g.listing_kind='event' WHERE g.id=p_gig_id),
    'UTC')
$fn$;
REVOKE ALL ON FUNCTION public.issue_3872_gig_timezone(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_gig_timezone(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.gig_shoot_plan_save(p_contract_id uuid,p_shoot_at timestamptz,p_arrival_note text,p_confirm boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_actor uuid:=auth.uid(); v_party text; v_count integer; v_plan public.gig_shoot_plans; v_gig public.gigs;
BEGIN
  v_party:=public.issue_3872_contract_party(p_contract_id,v_actor); IF v_party IS NULL THEN RAISE EXCEPTION 'permission_denied' USING ERRCODE='42501'; END IF;
  SELECT g.* INTO v_gig FROM public.gig_contracts c JOIN public.gigs g ON g.id=c.gig_id WHERE c.id=p_contract_id;
  IF (p_shoot_at AT TIME ZONE public.issue_3872_gig_timezone(v_gig.id))::date NOT BETWEEN v_gig.shoot_window_start AND v_gig.shoot_window_end THEN RAISE EXCEPTION 'shoot_outside_window' USING ERRCODE='22023'; END IF;
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
  RETURN v_result;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.gig_interest_withdraw(p_interest_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v public.gig_interest;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='28000'; END IF;
  SELECT * INTO v FROM public.gig_interest WHERE id=p_interest_id FOR UPDATE;
  IF NOT FOUND OR v.creator_account_id<>auth.uid() THEN RETURN jsonb_build_object('ok',false,'error','interest_not_found'); END IF;
  IF v.status='withdrawn' THEN RETURN jsonb_build_object('ok',true,'replayed',true); END IF;
  IF v.status NOT IN ('sent','shortlisted') THEN RETURN jsonb_build_object('ok',false,'error','interest_not_withdrawable'); END IF;
  UPDATE public.gig_interest SET status='withdrawn',updated_at=now() WHERE id=v.id;
  RETURN jsonb_build_object('ok',true);
END;
$fn$;
REVOKE ALL ON FUNCTION public.gig_interest_withdraw(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.gig_interest_withdraw(uuid) TO authenticated,service_role;

-- Public Creator card: adds `promoting_now`, the public titles of event listings
-- the creator is currently posting for. Event titles are already public.
CREATE OR REPLACE FUNCTION public.public_creator_profile(p_creator_account_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=public,pg_temp AS $fn$
  SELECT CASE WHEN p.mode_enabled AND p.verification='verified' THEN jsonb_build_object(
    'id',p.creator_account_id,'display_name',p.display_name,'niches',p.niches,
    'showcase',(SELECT coalesce(jsonb_agg(jsonb_build_object('media_id',m.id,'thumb',NULL) ORDER BY m.created_at DESC),'[]'::jsonb) FROM public.creator_media_jobs m WHERE m.owner_id=p.creator_account_id AND m.owner_kind='creator' AND m.purpose='showcase' AND m.status='ready' AND m.deleted_at IS NULL),
    'completed_gigs',p.completed_gigs,
    'promoting_now',(SELECT coalesce(jsonb_agg(DISTINCT e.title),'[]'::jsonb) FROM public.gig_contracts c JOIN public.gigs g ON g.id=c.gig_id AND g.listing_kind='event' JOIN public.events e ON e.id=g.listing_id AND e.visibility='public' AND e.deleted_at IS NULL WHERE c.creator_account_id=p.creator_account_id AND c.state IN ('posting','posts_submitted','posts_verified','released'))
  ) ELSE NULL END FROM public.creator_profiles p WHERE p.creator_account_id=p_creator_account_id;
$fn$;

COMMIT;
