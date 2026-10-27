-- #3872: the contract workspace's gig carries the shoot window.
-- The creator's shoot calendar limits its days to the host's window; the
-- workspace gig had shoot_at but not the window. Adds
-- shoot_window:{start,end} (dates; null when the gig has none). Everything
-- else is unchanged from 20280102003872_issue_3872_round2.sql.
BEGIN;
SET LOCAL lock_timeout = '10s';

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
    'gig',jsonb_build_object('id',g.id,'video_due_at',g.video_due_at,'shoot_at',g.shoot_at,'shoot_window',CASE WHEN g.shoot_window_start IS NULL AND g.shoot_window_end IS NULL THEN NULL ELSE jsonb_build_object('start',g.shoot_window_start,'end',g.shoot_window_end) END,'title_public',g.title_public,'brief_public',g.brief_public,'brief_private',CASE WHEN v_revealed THEN g.brief_private END,'brand_id',CASE WHEN v_revealed THEN g.brand_id END,'listing_kind',CASE WHEN v_revealed THEN g.listing_kind END,'listing_id',CASE WHEN v_revealed THEN g.listing_id END,'must_tag',CASE WHEN v_revealed THEN g.must_tag END,'format_key',g.format_key,'post_by',g.post_by),
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

COMMIT;
