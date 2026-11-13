-- #4402 polish PR, migration M1: posting deadline, Admin post review, re-offer
-- after a cancelled offer, the missing gig notices, and the workspace fields
-- the apps need for real refund amounts and the gig's own time zone.
--
-- WHY (spec comment 6855228971 on #4402; Seth's decisions D1, OQ-1/2/3/6/10):
--   * Nothing checked posted links, so a paid gig sat in posts_submitted with
--     the creator's fee held forever. D1: Mingla's team checks each link in
--     Admin (admin_gig_post_decide). A Pass on every post moves the contract to
--     posts_verified and the existing 48 h release timer pays the creator.
--   * approved / posting / posts_failed had no deadline, so if the creator
--     never posted the host's money was stuck. Every approved video now has a
--     post deadline: end of the agreed post-by date in the gig's time zone plus
--     24 h grace (OQ-1). Missing it refunds the host in full (branch
--     post_missed, OQ-2) and cancels the contract, so the host loses the
--     licence (OQ-3). posts_submitted deliberately has NO deadline: gig-timers
--     scans overdue rows with limit(200) and no order, and a state with no
--     timer action would fill that window forever. Admin owns it instead, and
--     a post waiting more than 24 h for review opens a Work board card through
--     the existing ops_auto_card_upsert path (OQ-10).
--   * A host who cancelled an offer before acceptance could never offer the
--     same creator again: the interest stayed 'offered' and offer prepare said
--     interest_not_open. host_before_accept now reopens it ('shortlisted'), and
--     the stuck production row (interest dcf7f167) is backfilled.
--   * Venue gigs had no time zone and fell back to UTC; they now use the
--     brand's default time zone (OQ-6).
--   * Notice dates are written in the gig's zone with a "Lagos time" style
--     label, and a midnight deadline reads as 11:59 PM the day before (design
--     deltas a and b, comment 6855449349).
--
-- Every replaced function is copied from the production body
-- (pg_get_functiondef, 13 Nov 2026; the local full replay matched production
-- byte for byte by md5) and changed only as the spec says. Static SQL only;
-- conflicts raise PT409, never 40001.
--
-- Not done here, on purpose:
--   * gig_pending_offer_sweep already reopens the interest on a proven-unpaid
--     retire (live body), so it is not replaced.
--   * issue_4216_gig_offer_prepare_impl is replaced once, in M2, with both the
--     reopen and the minimum fee (spec section 5 rule).
--   * Orphan delivery jobs: setting delete_after would not reap them, because
--     issue_4182_creator_media_reap_candidates only reaps a delivery job that a
--     gig_deliveries row uses. Left as a remainder on the issue.
--
-- Proof: __tests__/issue_4402_polish_posting_and_post_review.implementor.pg17.test.sql
BEGIN;
SET LOCAL lock_timeout = '10s';

-- ── New notification categories (FK target of notification_outbox) ─────────
INSERT INTO public.notification_categories(key,section,is_transactional,urgency,default_channels,reach_mode,active)
SELECT key,'creator_gigs',true,urgency,ARRAY['inapp','push']::text[],'reach_once',true
FROM (VALUES
  ('business.gig.shoot_confirmed','normal'),
  ('business.gig.posts_submitted','normal'),
  ('business.gig.post_due_soon','normal'),
  ('business.gig.post_missed','high'),
  ('creator.gig.shoot_confirmed','normal'),
  ('creator.gig.video_approved','high'),
  ('creator.gig.offer_cancelled','normal'),
  ('creator.gig.post_missed','high')
) category(key,urgency)
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
    'creator.verify.state','business.local.review_posted',
    -- #4402
    'business.gig.shoot_confirmed','business.gig.posts_submitted','business.gig.post_due_soon',
    'business.gig.post_missed','creator.gig.shoot_confirmed','creator.gig.video_approved',
    'creator.gig.offer_cancelled','creator.gig.post_missed'
  ));

-- ── Time zone (OQ-6) and notice date words (design deltas a, b) ────────────
CREATE OR REPLACE FUNCTION public.issue_3872_gig_timezone(p_gig_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
  -- Event gigs use the event's zone. #4402 OQ-6: venue gigs use the brand's
  -- default zone instead of UTC. UTC only when neither is known.
  SELECT coalesce(
    (SELECT nullif(e.timezone,'') FROM public.gigs g JOIN public.events e ON e.id=g.listing_id AND g.listing_kind='event' WHERE g.id=p_gig_id),
    (SELECT nullif(b.default_timezone,'') FROM public.gigs g JOIN public.brands b ON b.id=g.brand_id WHERE g.id=p_gig_id),
    'UTC')
$fn$;
REVOKE ALL ON FUNCTION public.issue_3872_gig_timezone(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_gig_timezone(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_4402_zone_label(p_tz text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $fn$
  -- "Africa/Lagos" -> "Lagos time"; UTC stays "UTC" (design delta a: phones
  -- print "GMT+1" for an abbreviation, so the city name is clearer).
  SELECT CASE WHEN p_tz IS NULL OR p_tz IN ('UTC','Etc/UTC','GMT','Etc/GMT','Z') THEN 'UTC'
    ELSE replace(regexp_replace(p_tz,'^.*/',''),'_',' ')||' time' END
$fn$;
REVOKE ALL ON FUNCTION public.issue_4402_zone_label(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4402_zone_label(text) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_4402_gig_when(p_at timestamptz, p_tz text) RETURNS text
LANGUAGE sql STABLE SET search_path=public,pg_temp AS $fn$
  SELECT CASE WHEN p_at IS NULL THEN NULL ELSE
    to_char(p_at AT TIME ZONE coalesce(nullif(p_tz,''),'UTC'),'Dy Mon FMDD, FMHH12:MI AM')||' '||public.issue_4402_zone_label(p_tz) END
$fn$;
REVOKE ALL ON FUNCTION public.issue_4402_gig_when(timestamp with time zone,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4402_gig_when(timestamp with time zone,text) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_4402_gig_deadline_when(p_at timestamptz, p_tz text) RETURNS text
LANGUAGE sql STABLE SET search_path=public,pg_temp AS $fn$
  -- Design delta b: a deadline at local midnight reads "11:59 PM" the day before.
  SELECT public.issue_4402_gig_when(
    CASE WHEN (p_at AT TIME ZONE coalesce(nullif(p_tz,''),'UTC'))::time=time '00:00' THEN p_at-interval '1 minute' ELSE p_at END,p_tz)
$fn$;
REVOKE ALL ON FUNCTION public.issue_4402_gig_deadline_when(timestamp with time zone,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4402_gig_deadline_when(timestamp with time zone,text) TO service_role;

-- ── Post deadline (OQ-1: 24 h grace, held in this one function) ─────────────
CREATE OR REPLACE FUNCTION public.issue_4402_gig_post_deadline(p_contract_id uuid) RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
  SELECT ((coalesce(t.post_by,g.post_by)+1)::timestamp AT TIME ZONE public.issue_3872_gig_timezone(g.id))+interval '24 hours'
  FROM public.gig_contracts c
  JOIN public.gigs g ON g.id=c.gig_id
  LEFT JOIN public.gig_terms_versions t ON t.contract_id=c.id AND t.version=c.current_terms_version
  WHERE c.id=p_contract_id
$fn$;
REVOKE ALL ON FUNCTION public.issue_4402_gig_post_deadline(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4402_gig_post_deadline(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.gig_transition(p_contract_id uuid, p_expected_state text, p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid:=auth.uid(); v public.gig_contracts; v_party text; v_is_host boolean; v_is_creator boolean; v_is_admin boolean;
  v_next text; v_actor_kind text; v_deadline timestamptz; v_fix integer; v_script integer; v_ready boolean; v_post_by date;
BEGIN
  SELECT * INTO v FROM public.gig_contracts WHERE id=p_contract_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'contract_not_found' USING ERRCODE='P0002'; END IF;
  IF v.state<>p_expected_state THEN RAISE EXCEPTION 'stale_contract_state:%',v.state USING ERRCODE='PT409'; END IF;
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
    -- #4402 D1: Mingla's team (Admin) records post outcomes too.
    WHEN v.state='posts_submitted' AND p_action IN ('posts_passed') AND (v_is_host OR v_is_admin OR v_actor IS NULL) THEN 'posts_verified'
    WHEN v.state='posts_submitted' AND p_action IN ('host_confirm','auto_confirm') AND (v_is_host OR v_actor IS NULL) THEN 'posts_verified'
    WHEN v.state='posts_submitted' AND p_action='posts_failed' AND (v_is_admin OR v_actor IS NULL) THEN 'posts_failed'
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
    -- #4402: the post deadline (end of post_by in the gig zone + 24 h grace).
    -- Missing it refunds the host (post_missed). posts_submitted gets NO
    -- deadline (ELSE NULL): Admin reviews it from admin_gig_queue.post_checks.
    -- Invariant (declared in its test): I-4402-POST-1 | issue #4402 | a posts_submitted contract never has state_deadline_at
    WHEN v_next IN ('approved','posting') THEN greatest(public.issue_4402_gig_post_deadline(v.id),now()+interval '24 hours')
    WHEN v_next='posts_failed' THEN greatest(public.issue_4402_gig_post_deadline(v.id),now()+interval '48 hours')
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
$function$;
REVOKE ALL ON FUNCTION public.gig_transition(uuid,text,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gig_transition(uuid,text,text,jsonb) TO authenticated, service_role;

-- #4402: the body of gig_post_check_record, shared by the service-role path
-- and Admin review. Internal only. All clear (no pending, failed or
-- unverifiable post) -> posts_passed; any failed -> posts_failed.
CREATE OR REPLACE FUNCTION public.issue_4402_gig_post_check_apply(p_post_id uuid, p_result text, p_detail jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_post public.gig_posts; v_remaining integer; v_failed integer;
BEGIN
  IF p_result NOT IN ('passed','failed','unverifiable') THEN RAISE EXCEPTION 'invalid_check_result' USING ERRCODE='22023'; END IF;
  UPDATE public.gig_posts SET check_status=p_result,check_detail=coalesce(p_detail,'{}'),last_checked_at=now() WHERE id=p_post_id RETURNING * INTO v_post;
  IF NOT FOUND THEN RAISE EXCEPTION 'post_not_found' USING ERRCODE='P0002'; END IF;
  SELECT count(*) FILTER(WHERE check_status='pending'),count(*) FILTER(WHERE check_status='failed') INTO v_remaining,v_failed FROM public.gig_posts WHERE contract_id=v_post.contract_id;
  IF v_failed>0 AND EXISTS(SELECT 1 FROM public.gig_contracts WHERE id=v_post.contract_id AND state='posts_submitted') THEN PERFORM public.gig_transition(v_post.contract_id,'posts_submitted','posts_failed',jsonb_build_object('post_id',v_post.id,'reason',coalesce(p_detail,'{}')->>'reason'));
  ELSIF v_remaining=0 AND v_failed=0 AND NOT EXISTS(SELECT 1 FROM public.gig_posts WHERE contract_id=v_post.contract_id AND check_status='unverifiable') THEN PERFORM public.gig_transition(v_post.contract_id,'posts_submitted','posts_passed',jsonb_build_object('post_id',v_post.id)); END IF;
  RETURN jsonb_build_object('ok',true,'remaining',v_remaining,'failed',v_failed);
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4402_gig_post_check_apply(uuid,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4402_gig_post_check_apply(uuid,text,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.gig_post_check_record(p_post_id uuid, p_result text, p_detail jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'service_role_only' USING ERRCODE='42501'; END IF;
  RETURN public.issue_4402_gig_post_check_apply(p_post_id,p_result,p_detail);
END;
$function$;
REVOKE ALL ON FUNCTION public.gig_post_check_record(uuid,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gig_post_check_record(uuid,text,jsonb) TO service_role;

-- #4402 D1: Mingla's team checks each posted link in Admin.
CREATE OR REPLACE FUNCTION public.admin_gig_post_decide(p_post_id uuid, p_result text, p_reason text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_post public.gig_posts; v_contract public.gig_contracts; v_reason text:=nullif(btrim(coalesce(p_reason,'')),'');
  v_applied jsonb; v_state text; v_card uuid;
BEGIN
  -- Invariant (declared in its test): I-4402-POST-3 | issue #4402 | only an admin records a post review; a fail always carries a 5-300 character reason
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'admin_only' USING ERRCODE='42501'; END IF;
  IF p_result IS NULL OR p_result NOT IN ('passed','failed') THEN RETURN jsonb_build_object('ok',false,'error','invalid_check_result'); END IF;
  SELECT * INTO v_post FROM public.gig_posts WHERE id=p_post_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','post_not_found'); END IF;
  SELECT * INTO v_contract FROM public.gig_contracts WHERE id=v_post.contract_id FOR UPDATE;
  SELECT * INTO v_post FROM public.gig_posts WHERE id=p_post_id FOR UPDATE;
  -- A replay with the same Admin result is a no-op, even after the contract moved on.
  IF v_post.check_status=p_result AND v_post.check_detail->>'method'='admin_review' THEN
    RETURN jsonb_build_object('ok',true,'replayed',true,'state',v_contract.state);
  END IF;
  IF v_contract.state<>'posts_submitted' THEN RETURN jsonb_build_object('ok',false,'error','post_not_reviewable'); END IF;
  IF p_result='failed' AND (v_reason IS NULL OR char_length(v_reason) NOT BETWEEN 5 AND 300) THEN
    RETURN jsonb_build_object('ok',false,'error','reason_required','field','reason');
  END IF;
  IF v_reason IS NOT NULL AND char_length(v_reason)>300 THEN RETURN jsonb_build_object('ok',false,'error','reason_required','field','reason'); END IF;
  INSERT INTO public.gig_events(contract_id,actor,kind,data)
  VALUES(v_contract.id,'admin','post_reviewed',jsonb_build_object('post_id',v_post.id,'platform',v_post.platform,'result',p_result,'reason',v_reason));
  v_applied:=public.issue_4402_gig_post_check_apply(v_post.id,p_result,
    jsonb_build_object('method','admin_review','reviewed_by',auth.uid(),'reviewed_at',now(),'reason',v_reason));
  SELECT state INTO v_state FROM public.gig_contracts WHERE id=v_contract.id;
  -- OQ-10: the review is done, so its "waiting over 24 h" Work card closes itself.
  IF v_state<>'posts_submitted' THEN
    FOR v_card IN SELECT w.id FROM public.ops_work_cards w
      WHERE w.auto_key='gig_post_review:'||v_contract.id::text AND w.archived_at IS NULL AND w.status<>'done' LOOP
      BEGIN
        PERFORM public.ops_auto_card_close(v_card,'Mingla''s team checked the posted links in Admin.','[]'::jsonb);
      EXCEPTION WHEN others THEN RAISE WARNING 'admin_gig_post_decide: card % not closed (%)',v_card,SQLERRM;
      END;
    END LOOP;
  END IF;
  RETURN jsonb_build_object('ok',true,'replayed',false,'state',v_state,
    'remaining',(v_applied->>'remaining')::integer,'failed',(v_applied->>'failed')::integer);
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_gig_post_decide(uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_gig_post_decide(uuid,text,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_gig_queue()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    ),'[]'::jsonb),
    -- #4402 D1: every submitted post still waiting for Mingla's check.
    -- Invariant (declared in its test): I-4402-POST-2 | issue #4402 | a posts_submitted contract with an unchecked post always has a row here
    'post_checks',coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'post_id',gp.id,'contract_id',c.id,'platform',gp.platform,'url',gp.url,'submitted_at',gp.submitted_at,
        'hours_waiting',floor(extract(epoch FROM now()-gp.submitted_at)/3600)::integer,
        'check_status',gp.check_status,
        'gig_title',g.title_public,'brand_name',b.name,'creator_name',p.display_name,
        'must_tag',g.must_tag,'deliverables',coalesce(tv.deliverables,g.deliverables),
        'post_by',coalesce(tv.post_by,g.post_by),'timezone',public.issue_3872_gig_timezone(g.id)
      ) ORDER BY gp.submitted_at,gp.id)
      FROM public.gig_posts gp
      JOIN public.gig_contracts c ON c.id=gp.contract_id
      JOIN public.gigs g ON g.id=c.gig_id
      JOIN public.brands b ON b.id=c.brand_id
      JOIN public.creator_profiles p ON p.creator_account_id=c.creator_account_id
      LEFT JOIN public.gig_terms_versions tv ON tv.contract_id=c.id AND tv.version=c.current_terms_version
      WHERE c.state='posts_submitted' AND gp.check_status IN ('pending','unverifiable')
    ),'[]'::jsonb)
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_gig_queue() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_gig_queue() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.issue_3872_gig_refund_branch_allowed(p_contract_id uuid, p_branch text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_allowed boolean;
BEGIN
  SELECT coalesce(CASE p_branch
    -- #4402 F3: an offer retired as unpaid is refunded only through
    -- payment_late, never by the host's cancel (which would rewrite the
    -- cancel reason and race the automatic refund).
    WHEN 'host_before_accept' THEN c.state='offered'
      OR (c.state='cancelled' AND c.cancel_reason IS DISTINCT FROM 'payment_not_completed')
    WHEN 'creator_decline' THEN c.state IN ('offered','declined')
    WHEN 'declined_or_expired' THEN (c.state='offered' AND c.state_deadline_at<=now()) OR c.state IN ('expired','declined')
    WHEN 'host_after_accept_before_lock' THEN c.state IN ('accepted','shoot_planned','script_drafting','script_sent')
    WHEN 'creator_after_accept' THEN c.state IN ('accepted','shoot_planned','script_drafting','script_sent')
    WHEN 'upload_missed' THEN c.state='script_locked' AND c.state_deadline_at<=now()
    -- #4402: the approved video was not posted by the post deadline.
    WHEN 'post_missed' THEN c.state IN ('approved','posting','posts_failed') AND c.state_deadline_at<=now()
    WHEN 'resolved_partial' THEN c.state='disputed' AND EXISTS(SELECT 1 FROM public.gig_disputes d WHERE d.contract_id=c.id AND d.status='decided' AND d.decided_outcome='partial_refund')
    WHEN 'resolved_refund' THEN c.state='disputed' AND EXISTS(SELECT 1 FROM public.gig_disputes d WHERE d.contract_id=c.id AND d.status='decided' AND d.decided_outcome='full_refund')
    WHEN 'counter_lower' THEN EXISTS(SELECT 1 FROM public.gig_hold_adjustments a WHERE a.contract_id=c.id AND a.kind='refund' AND a.status='pending')
    -- #4402: a payment that landed after the offer was retired as unpaid.
    WHEN 'payment_late' THEN c.state='cancelled' AND c.cancel_reason IS NOT DISTINCT FROM 'payment_not_completed'
    ELSE false END,false)
    INTO v_allowed
  FROM public.gig_contracts c WHERE c.id=p_contract_id;
  RETURN v_allowed;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_3872_gig_refund_branch_allowed(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_gig_refund_branch_allowed(uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_4402_gig_refund_record_impl(p_contract_id uuid, p_branch text, p_refund_minor bigint, p_creator_fee_minor bigint, p_provider_ref text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    WHEN p_branch IN ('host_before_accept','host_after_accept_before_lock','creator_after_accept','upload_missed','post_missed') THEN 'cancelled'
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
  IF p_branch IN ('creator_after_accept','resolved_refund','upload_missed','post_missed') THEN -- Reliability is only shown from three completed gigs (table check), so the
    -- penalty applies from then on instead of violating the constraint.
    UPDATE public.creator_profiles SET reliability_bps=CASE WHEN completed_gigs>=3 THEN greatest(0,coalesce(reliability_bps,10000)-1000) END WHERE creator_account_id=v.creator_account_id; END IF;
  IF v_target<>v.state OR v.cancel_reason IS DISTINCT FROM p_branch THEN
    PERFORM public.issue_3872_contract_apply_state(v.id,v_target,NULL,NULL,NULL,NULL);
    UPDATE public.gig_contracts SET cancel_reason=p_branch WHERE id=v.id;
  END IF;
  -- #4402: a host who cancels an offer before acceptance can offer the same
  -- creator again. creator_decline and declined_or_expired do not reopen.
  IF p_branch='host_before_accept' THEN
    UPDATE public.gig_interest SET status='shortlisted',updated_at=now()
     WHERE gig_id=v.gig_id AND creator_account_id=v.creator_account_id AND status='offered';
  END IF;
  INSERT INTO public.gig_events(contract_id,actor,kind,data) VALUES(v.id,'system','refund_recorded',jsonb_build_object('branch',p_branch,'refund_minor',p_refund_minor,'creator_fee_minor',p_creator_fee_minor,'provider_ref',p_provider_ref,'share_id',v_share));
  RETURN jsonb_build_object('ok',true,'state',v_target,'share_id',v_share);
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4402_gig_refund_record_impl(uuid,text,bigint,bigint,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4402_gig_refund_record_impl(uuid,text,bigint,bigint,text) TO service_role;

CREATE OR REPLACE FUNCTION public.gig_notification_tick(p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_matches integer:=0; v_expiring integer:=0; v_posts integer:=0; v_host_due integer:=0; v_cards integer:=0;
  v_row record; v_card jsonb; v_owner text;
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

  -- #4402: one reminder 24 h before the post deadline, in the gig's zone.
  INSERT INTO public.notification_outbox(category_key,user_id,brand_id,payload,idempotency_key,status)
  SELECT 'creator.gig.post_reminder',contract.creator_account_id,contract.brand_id,jsonb_build_object(
      'title','Post your video by '||public.issue_4402_gig_deadline_when(contract.state_deadline_at,public.issue_3872_gig_timezone(contract.gig_id)),
      'body','Add your live links in Mingla before then, or the gig is cancelled and the host is refunded.',
      'contract_id',contract.id,'post_by',terms.post_by,'video_due_at',terms.video_due_at,'deadline_at',contract.state_deadline_at,
      'deep_link','mingla://creator/contract/'||contract.id::text
    ),'creator.gig.post_reminder:'||contract.id::text||':'||extract(epoch FROM contract.state_deadline_at)::bigint::text,'pending'
  FROM public.gig_contracts contract
  JOIN public.gig_terms_versions terms ON terms.contract_id=contract.id AND terms.version=contract.current_terms_version
  WHERE contract.state IN ('approved','posting','posts_failed')
    AND contract.state_deadline_at BETWEEN p_now AND p_now+interval '24 hours'
  ON CONFLICT(idempotency_key) DO NOTHING;
  GET DIAGNOSTICS v_posts=ROW_COUNT;

  -- #4402: the host hears the same day that a refund follows a missed post.
  FOR v_row IN
    SELECT contract.id,contract.state_deadline_at,public.issue_3872_gig_timezone(contract.gig_id) AS tz
    FROM public.gig_contracts contract
    WHERE contract.state IN ('approved','posting','posts_failed')
      AND contract.state_deadline_at BETWEEN p_now AND p_now+interval '24 hours'
      AND NOT EXISTS(SELECT 1 FROM public.notification_outbox o
        WHERE o.category_key='business.gig.post_due_soon' AND o.payload->>'contract_id'=contract.id::text
          AND o.payload->>'deadline_at'=to_jsonb(contract.state_deadline_at)#>>'{}')
  LOOP
    PERFORM public.issue_3872_enqueue_gig_notice(v_row.id,'business.gig.post_due_soon','host',
      'post_due:'||extract(epoch FROM v_row.state_deadline_at)::bigint::text,
      'The creator''s posts are due soon',
      'If they don''t post by '||public.issue_4402_gig_deadline_when(v_row.state_deadline_at,v_row.tz)||', you''re refunded in full automatically.',
      jsonb_build_object('deadline_at',v_row.state_deadline_at));
    v_host_due:=v_host_due+1;
  END LOOP;

  -- #4402 OQ-10: a post waiting more than 24 h for Mingla's check opens one
  -- Work board card per contract through the existing automatic-card path.
  -- A card failure never blocks the notices above.
  v_owner:=public.ops_owner_email();
  FOR v_row IN
    SELECT c.id,g.title_public,b.name AS brand_name,min(gp.submitted_at) AS first_at,count(*) AS n
    FROM public.gig_contracts c
    JOIN public.gig_posts gp ON gp.contract_id=c.id AND gp.check_status IN ('pending','unverifiable')
    JOIN public.gigs g ON g.id=c.gig_id JOIN public.brands b ON b.id=c.brand_id
    WHERE c.state='posts_submitted'
    GROUP BY c.id,g.title_public,b.name
    HAVING min(gp.submitted_at)<=p_now-interval '24 hours'
  LOOP
    BEGIN
      v_card:=public.ops_auto_card_upsert('gig_post_review:'||v_row.id::text,jsonb_build_object(
        'title',left(format('Check posted links: %s',v_row.title_public),160),
        'instructions',left(format(E'A creator posted %s link(s) for "%s" (%s) on %s and they still need Mingla''s check.\nOpen Mingla Admin > Creator gigs > Posts to check, open each link, and mark it Passed or Failed with a reason. The creator is paid 48 hours after every link passes.',
          v_row.n,v_row.title_public,v_row.brand_name,to_char(v_row.first_at AT TIME ZONE 'UTC','FMDD Mon YYYY HH24:MI "UTC"')),4000),
        'done_means','Every posted link on this gig is marked Passed or Failed in Admin.',
        'owners',CASE WHEN v_owner IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(v_owner) END,
        'watchers','[]'::jsonb,
        'due_on',public.ops_today(NULL)
      ),'task',NULL);
      IF v_card->>'status'='added' THEN v_cards:=v_cards+1; END IF;
    EXCEPTION WHEN others THEN RAISE WARNING 'gig_notification_tick: post review card for % not opened (%)',v_row.id,SQLERRM;
    END;
  END LOOP;
  RETURN jsonb_build_object('ok',true,'matches',v_matches,'offer_expiring',v_expiring,'post_reminders',v_posts,
    'post_due_host',v_host_due,'post_review_cards',v_cards);
END;
$function$;
REVOKE ALL ON FUNCTION public.gig_notification_tick(timestamp with time zone) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gig_notification_tick(timestamp with time zone) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_3872_gig_event_notice()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_marker text:=NEW.id::text; v_state text; v_tz text; v_deadline timestamptz; v_shoot timestamptz;
BEGIN
  SELECT state,public.issue_3872_gig_timezone(gig_id),state_deadline_at INTO v_state,v_tz,v_deadline FROM public.gig_contracts WHERE id=NEW.contract_id;
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
  ELSIF NEW.kind='plan_confirmed' THEN
    -- #4402: the party that did not confirm hears the agreed shoot time.
    SELECT s.shoot_at INTO v_shoot FROM public.gig_shoot_plans s WHERE s.contract_id=NEW.contract_id;
    IF NEW.actor<>'host' THEN
      PERFORM public.issue_3872_enqueue_gig_notice(NEW.contract_id,'business.gig.shoot_confirmed','host',v_marker,'Shoot time confirmed',
        coalesce(public.issue_4402_gig_when(v_shoot,v_tz)||'. ','')||'Open the gig for the details.');
    END IF;
    IF NEW.actor<>'creator' THEN
      PERFORM public.issue_3872_enqueue_gig_notice(NEW.contract_id,'creator.gig.shoot_confirmed','creator',v_marker,'Shoot time confirmed',
        coalesce(public.issue_4402_gig_when(v_shoot,v_tz)||'. ','')||'Open the gig for the details.');
    END IF;
  ELSIF NEW.kind='approve' THEN
    PERFORM public.issue_3872_enqueue_gig_notice(NEW.contract_id,'creator.gig.video_approved','creator',v_marker,'Your video is approved',
      'Post it by '||coalesce(public.issue_4402_gig_deadline_when(v_deadline,v_tz),'the post-by date')||' and add the links in Mingla.',
      jsonb_build_object('deadline_at',v_deadline));
  ELSIF NEW.kind='posts_submitted' THEN
    PERFORM public.issue_3872_enqueue_gig_notice(NEW.contract_id,'business.gig.posts_submitted','host',v_marker,'The creator posted',
      'Mingla''s team is checking the links. You''ll hear when they pass.');
  ELSIF NEW.kind='refund_recorded' AND NEW.data->>'branch'='host_before_accept' THEN
    PERFORM public.issue_3872_enqueue_gig_notice(NEW.contract_id,'creator.gig.offer_cancelled','creator',v_marker,'The host cancelled this offer',
      'Nothing more to do. You can keep applying to other gigs.');
  ELSIF NEW.kind='refund_recorded' AND NEW.data->>'branch'='post_missed' THEN
    PERFORM public.issue_3872_enqueue_gig_notice(NEW.contract_id,'business.gig.post_missed','host',v_marker,'The creator didn''t post in time',
      'Your full refund has started.');
    PERFORM public.issue_3872_enqueue_gig_notice(NEW.contract_id,'creator.gig.post_missed','creator',v_marker,'This gig was cancelled',
      'The posts weren''t added by the deadline, so the host was refunded.');
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
    PERFORM public.issue_3872_enqueue_gig_notice(NEW.contract_id,'creator.gig.video_approved','creator',v_marker,'Your video is approved',
      'Post it by '||coalesce(public.issue_4402_gig_deadline_when(v_deadline,v_tz),'the post-by date')||' and add the links in Mingla.',
      jsonb_build_object('deadline_at',v_deadline));
  ELSIF NEW.kind IN ('posts_passed','host_confirm','auto_confirm') THEN
    PERFORM public.issue_3872_enqueue_gig_notice(NEW.contract_id,'business.gig.posts_live','host',v_marker,'Creator posts verified','The agreed posts are live and passed verification.');
  ELSIF NEW.kind='posts_failed' THEN
    PERFORM public.issue_3872_enqueue_gig_notice(NEW.contract_id,'creator.gig.posts_failed','creator',v_marker,'Post check needs a fix',
      CASE WHEN nullif(NEW.data->>'reason','') IS NOT NULL THEN 'One of your posts needs a fix: '||(NEW.data->>'reason')
        ELSE 'One or more agreed post checks failed. Open the contract to see the exact reason.' END);
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
$function$;
REVOKE ALL ON FUNCTION public.issue_3872_gig_event_notice() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_gig_event_notice() TO service_role;

CREATE OR REPLACE FUNCTION public.gig_contract_workspace(p_contract_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    'money_paid_at',public.issue_3872_contract_money_paid_at(v.id),
    -- #4402: the real refunded amount (item 10), the gig's zone (item 12)
    -- and the format's script parts (item 19).
    'refunded_minor',coalesce((SELECT sum((e.data->>'refund_minor')::bigint) FROM public.gig_events e
      WHERE e.contract_id=v.id AND e.kind IN ('refund_recorded','counter_refund_recorded')),0),
    'timezone',public.issue_3872_gig_timezone(v.gig_id),
    'format_structure',(SELECT f.structure FROM public.gigs g3 JOIN public.gig_formats f ON f.key=g3.format_key WHERE g3.id=v.gig_id));
END;
$function$;
REVOKE ALL ON FUNCTION public.gig_contract_workspace(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gig_contract_workspace(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.issue_3872_public_gig_json(p_gig_id uuid, p_viewer uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT jsonb_build_object(
    'id',g.id,'title_public',g.title_public,'brief_public',g.brief_public,'format_key',g.format_key,
    'deliverables',g.deliverables,'city_name',c.name,'category',g.category,
    'shoot_window',jsonb_build_object('start',g.shoot_window_start,'end',g.shoot_window_end),
    'post_by',g.post_by,'video_due_at',g.video_due_at,'shoot_at',g.shoot_at,
    'usage_days',g.usage_days,'pay_up_to_minor',g.pay_up_to_minor,'currency',g.currency,
    'rights_model',g.rights_model,'agreement_version',g.agreement_version,
    'agreement_url',g.agreement_document_url,
    'sales_share_bps',g.sales_share_bps,'slots_left',public.issue_3872_gig_slots_left(g.id),
    'timezone',public.issue_3872_gig_timezone(g.id),
    'saved',EXISTS(SELECT 1 FROM public.creator_saved_gigs s WHERE s.gig_id=g.id AND s.creator_account_id=p_viewer)
  )
  FROM public.gigs g JOIN public.seeding_cities c ON c.id=g.city_id
  WHERE g.id=p_gig_id;
$function$;
REVOKE ALL ON FUNCTION public.issue_3872_public_gig_json(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_public_gig_json(uuid,uuid) TO service_role;

-- ── Data ───────────────────────────────────────────────────────────────────
-- Re-offer backfill: an interest left 'offered' with no live contract, whose
-- latest contract was cancelled by the host before acceptance or retired as
-- unpaid, is open again (production: interest dcf7f167). A function so the
-- pg17 suite proves the exact predicate the migration runs.
CREATE OR REPLACE FUNCTION public.issue_4402_reopen_stuck_interest() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_count integer;
BEGIN
  UPDATE public.gig_interest i SET status='shortlisted',updated_at=now()
   WHERE i.status='offered'
     AND NOT EXISTS(SELECT 1 FROM public.gig_contracts c
       WHERE c.gig_id=i.gig_id AND c.creator_account_id=i.creator_account_id
         AND c.state NOT IN ('declined','expired','cancelled','completed','resolved_release','resolved_partial','resolved_refund'))
     AND coalesce((SELECT c.state='cancelled' AND c.cancel_reason IN ('host_before_accept','payment_not_completed')
            FROM public.gig_contracts c WHERE c.gig_id=i.gig_id AND c.creator_account_id=i.creator_account_id
            ORDER BY c.created_at DESC,c.id DESC LIMIT 1),false);
  GET DIAGNOSTICS v_count=ROW_COUNT;
  RETURN v_count;
END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_4402_reopen_stuck_interest() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4402_reopen_stuck_interest() TO service_role;
SELECT public.issue_4402_reopen_stuck_interest();

-- Contracts already approved before this migration get a post deadline too,
-- with at least 72 hours' notice so nobody is refunded the day this lands.
UPDATE public.gig_contracts c
   SET state_deadline_at=greatest(public.issue_4402_gig_post_deadline(c.id),now()+interval '72 hours')
 WHERE c.state IN ('approved','posting','posts_failed') AND c.state_deadline_at IS NULL;

COMMIT;
