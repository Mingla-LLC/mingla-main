-- #4430 — production-run fixes for creator gigs and Mingla Local.
--
-- P-1  The payout sweep promotes accumulated gig and Local shares again (their
--      order kinds had no release arm, so a share under the floor never paid).
-- P-2  Every refund branch returns a not-yet-paid lower-counter difference to
--      the host; the record marks it refunded instead of superseded. The one
--      stranded TEST difference is re-opened so the next gig-timers run pays it.
-- N-1  Cancellations after acceptance, a missed upload, an expiry (creator
--      side), a no-money close and a dispute decision notify both sides.
-- N-2  Gig and Local shares no longer send "A referral made a sale".
-- Item 3  The script-locked push names the agreed upload deadline.
-- Item 5  Split endings get their own money state; the workspace carries the
--      pending counter refund and what the creator kept.
-- Q1   After any ending that is not a success, the host may offer the same
--      creator again.
-- L-1  local_review_submit: qualify unnest column.
--
-- Every function body is copied from the replayed definition (pg_get_functiondef)
-- and changed only where marked #4430. CREATE OR REPLACE keeps each ACL.
--
-- Invariants (declared in the pg17 test beside this file):
--   I-4430-P1, I-4430-P2, I-4430-N1, I-4430-N2.
-- Proof: __tests__/issue_4430_gig_money_and_notices.implementor.pg17.test.sql
BEGIN;
SET LOCAL lock_timeout = '10s';

-- ── New notification categories ─────────────────────────────────────────
INSERT INTO public.notification_categories(key,section,is_transactional,urgency,default_channels,reach_mode,active)
SELECT key,'creator_gigs',true,urgency,ARRAY['inapp','push']::text[],'reach_once',true
FROM (VALUES
  ('business.gig.cancelled','high'),
  ('creator.gig.cancelled','high')
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
    'business.gig.shoot_confirmed','business.gig.posts_submitted','business.gig.post_due_soon',
    'business.gig.post_missed','creator.gig.shoot_confirmed','creator.gig.video_approved',
    'creator.gig.offer_cancelled','creator.gig.post_missed',
    -- #4430
    'business.gig.cancelled','creator.gig.cancelled'
  ));

-- ── P-1: below-floor gig and Local shares are promoted again ──────────────
CREATE OR REPLACE FUNCTION public.payee_prepare_payout_sweep(p_now timestamp with time zone DEFAULT now(), p_limit integer DEFAULT 50)
 RETURNS TABLE(payout_id uuid, payee_user_id uuid, rail text, currency text, amount_minor bigint, account_ref text, attempt integer, provider_ref text, transfer_group text, source_charge_id text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_group record;
  v_payout public.payee_payouts%ROWTYPE;
  v_total bigint;
  v_debt bigint;
  v_withheld bigint;
  v_before_fee bigint;
  v_fee bigint;
  v_floor bigint;
  v_account text;
  v_source_charge_id text;
  v_count integer:=0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('issue_3872_payee_payout_sweep',3872));

  UPDATE public.payee_shares s SET status='releasable',updated_at=p_now
  WHERE s.payout_id IS NULL
    AND s.status IN ('pending','held_until_event','accumulating','failed')
    AND s.release_after<=p_now
    AND public.issue_3872_payee_remaining_net(s)>0
    AND NOT EXISTS(SELECT 1 FROM public.referral_member_risk_holds h
      WHERE h.member_id=s.member_id AND h.active)
    AND NOT EXISTS(SELECT 1 FROM public.stripe_disputes d
      WHERE s.order_kind='ticket' AND d.order_id=s.order_id
        AND d.status NOT IN ('won','lost'))
    AND NOT EXISTS(SELECT 1 FROM public.paystack_disputes d
      WHERE ((s.order_kind='ticket' AND d.order_id=s.order_id)
        OR (s.order_kind='venue_order' AND d.venue_menu_order_id=s.order_id))
        AND NOT d.is_resolved)
    -- #4430 P-1: each order kind has its own release condition. Gig and
    -- Local shares are written only once their money is settled, but they
    -- had no arm here, so a share that fell under the payout floor once
    -- stayed 'accumulating' for good.
    AND CASE s.order_kind
      WHEN 'ticket' THEN EXISTS(SELECT 1 FROM public.payout_release_items i
        WHERE i.source_type='order' AND i.source_id=s.order_id)
      WHEN 'venue_order' THEN EXISTS(SELECT 1 FROM public.payout_release_items i
        WHERE i.source_type='venue_menu_order' AND i.source_id=s.order_id)
      -- A gig share is released by gig release or the refund record; it waits
      -- only while a dispute on that contract is still open.
      WHEN 'gig' THEN EXISTS(SELECT 1 FROM public.gig_contracts gc
          WHERE gc.id=s.order_id AND gc.state<>'disputed')
        AND NOT EXISTS(SELECT 1 FROM public.gig_disputes gd
          WHERE gd.contract_id=s.order_id AND gd.status NOT IN ('decided','withdrawn'))
      -- A Local share is written by local_payout_record on a 'published'
      -- month; it is never promoted for any other month state.
      WHEN 'local_month' THEN EXISTS(SELECT 1 FROM public.local_months lm
          WHERE lm.id=s.order_id AND lm.payee_share_id=s.id AND lm.status='published')
      ELSE false END
    AND (s.order_kind<>'ticket' OR NOT EXISTS(
      SELECT 1 FROM public.order_installments oi
      WHERE oi.order_id=s.order_id AND oi.status<>'collected'
    ));

  FOR v_payout IN
    SELECT p.* FROM public.payee_payouts p
    WHERE (p.status='failed' AND p.attempt<3 AND p.next_attempt_at<=p_now)
       OR (p.status='pending' AND p.updated_at<=p_now-interval '15 minutes')
    ORDER BY COALESCE(p.next_attempt_at,p.updated_at),p.created_at
    LIMIT greatest(p_limit,1)
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.payee_payouts SET status='pending',next_attempt_at=NULL,
      updated_at=p_now
    WHERE id=v_payout.id;
    v_account:=v_payout.account_ref;
    IF v_account IS NULL AND v_payout.last_attempt_at IS NULL THEN
      SELECT CASE WHEN v_payout.rail='stripe' THEN a.stripe_account_id
        ELSE a.paystack_recipient_code END INTO v_account
      FROM public.payee_accounts a
      WHERE a.user_id=v_payout.payee_user_id
        AND ((v_payout.rail='stripe' AND a.stripe_status='active'
          AND a.stripe_account_id IS NOT NULL)
          OR (v_payout.rail='paystack' AND a.paystack_status='verified'
            AND a.paystack_recipient_code IS NOT NULL));
      IF v_account IS NOT NULL THEN
        UPDATE public.payee_payouts SET account_ref=v_account,updated_at=p_now
        WHERE id=v_payout.id;
      END IF;
    END IF;
    IF v_account IS NULL THEN
      UPDATE public.payee_payouts SET status='failed',next_attempt_at=CASE
          WHEN last_attempt_at IS NULL THEN NULL ELSE p_now+interval '7 days' END,
        failure_code='payout_account_unavailable',updated_at=p_now
      WHERE id=v_payout.id;
      IF v_payout.last_attempt_at IS NOT NULL THEN
        CONTINUE;
      END IF;
      UPDATE public.payee_shares s SET payout_id=NULL,
        status=CASE WHEN s.reversed_minor>=s.gross_minor THEN 'reversed' ELSE 'releasable' END,
        updated_at=p_now
      WHERE s.payout_id=v_payout.id;
      DELETE FROM public.payee_debts
      WHERE origin_payout_id=v_payout.id
        AND reason IN ('refund_after_payout','dispute_after_payout');
      UPDATE public.payee_debts d SET
        recovered_minor=d.recovered_minor-r.amount_minor,
        status='open',recovered_at=NULL
      FROM public.payee_debt_recoveries r
      WHERE r.payout_id=v_payout.id AND r.debt_id=d.id;
      DELETE FROM public.payee_debt_recoveries r WHERE r.payout_id=v_payout.id;
      CONTINUE;
    END IF;
    payout_id:=v_payout.id;payee_user_id:=v_payout.payee_user_id;
    rail:=v_payout.rail;currency:=v_payout.currency;amount_minor:=v_payout.amount_minor;
    account_ref:=v_account;attempt:=v_payout.attempt;provider_ref:=v_payout.provider_ref;
    transfer_group:=v_payout.transfer_group;source_charge_id:=v_payout.source_charge_id;
    RETURN NEXT; v_count:=v_count+1;
  END LOOP;

  FOR v_group IN
    SELECT s.payee_user_id,s.rail,s.currency,min(s.created_at) first_created
    FROM public.payee_shares s
    JOIN public.payee_accounts a ON a.user_id=s.payee_user_id
    WHERE s.status='releasable' AND s.payout_id IS NULL AND s.payee_user_id IS NOT NULL
      AND ((s.rail='stripe' AND a.stripe_status='active' AND a.stripe_account_id IS NOT NULL)
        OR (s.rail='paystack' AND a.paystack_status='verified' AND a.paystack_recipient_code IS NOT NULL))
    GROUP BY s.payee_user_id,s.rail,s.currency
    ORDER BY min(s.created_at)
    LIMIT greatest(p_limit-v_count,0)
  LOOP
    PERFORM s.id FROM public.payee_shares s
    WHERE s.payee_user_id=v_group.payee_user_id AND s.rail=v_group.rail
      AND s.currency=v_group.currency AND s.status='releasable' AND s.payout_id IS NULL
    ORDER BY s.created_at,s.id FOR UPDATE;
    SELECT COALESCE(sum(public.issue_3872_payee_remaining_net(s)),0) INTO v_total
    FROM public.payee_shares s
    WHERE s.payee_user_id=v_group.payee_user_id AND s.rail=v_group.rail
      AND s.currency=v_group.currency AND s.status='releasable' AND s.payout_id IS NULL;
    PERFORM d.id FROM public.payee_debts d
    WHERE d.payee_user_id=v_group.payee_user_id AND d.rail=v_group.rail
      AND d.currency=v_group.currency AND d.status='open'
    ORDER BY d.created_at,d.id FOR UPDATE;
    SELECT COALESCE(sum(d.amount_minor-d.recovered_minor),0) INTO v_debt
    FROM public.payee_debts d WHERE d.payee_user_id=v_group.payee_user_id
      AND d.rail=v_group.rail AND d.currency=v_group.currency AND d.status='open';
    v_withheld:=least(v_total,v_debt);
    v_before_fee:=v_total-v_withheld;
    SELECT f.floor_minor INTO v_floor FROM public.payee_payout_currency_floors f
      WHERE f.currency=v_group.currency;
    v_floor:=COALESCE(v_floor,500);
    IF v_group.rail='paystack' THEN v_floor:=greatest(v_floor,5000); END IF;
    IF v_before_fee<v_floor THEN
      UPDATE public.payee_shares s SET status='accumulating',updated_at=p_now
      WHERE s.payee_user_id=v_group.payee_user_id AND s.rail=v_group.rail
        AND s.currency=v_group.currency AND s.status='releasable' AND s.payout_id IS NULL;
      CONTINUE;
    END IF;
    v_fee:=CASE WHEN v_group.rail='paystack'
      THEN public.issue_3872_paystack_transfer_cost(v_before_fee) ELSE 0 END;
    IF v_before_fee-v_fee<=0 OR (v_group.rail='paystack' AND v_before_fee-v_fee<5000) THEN
      UPDATE public.payee_shares s SET status='accumulating',updated_at=p_now
      WHERE s.payee_user_id=v_group.payee_user_id AND s.rail=v_group.rail
        AND s.currency=v_group.currency AND s.status='releasable' AND s.payout_id IS NULL;
      CONTINUE;
    END IF;

    SELECT CASE WHEN v_group.rail='stripe' THEN a.stripe_account_id
      ELSE a.paystack_recipient_code END INTO v_account
    FROM public.payee_accounts a
    WHERE a.user_id=v_group.payee_user_id
      AND ((v_group.rail='stripe' AND a.stripe_status='active'
        AND a.stripe_account_id IS NOT NULL)
        OR (v_group.rail='paystack' AND a.paystack_status='verified'
          AND a.paystack_recipient_code IS NOT NULL));
    IF v_account IS NULL THEN CONTINUE; END IF;

    INSERT INTO public.payee_payouts(
      payee_user_id,rail,currency,amount_minor,gross_share_minor,
      debt_withheld_minor,provider_fee_minor,idempotency_key,status,attempt,
      account_ref,transfer_group,created_at,updated_at
    ) VALUES(
      v_group.payee_user_id,v_group.rail,v_group.currency,v_before_fee-v_fee,v_total,
      v_withheld,v_fee,'payee_pending:'||gen_random_uuid()::text,'pending',0,
      v_account,'payee_pending:'||gen_random_uuid()::text,p_now,p_now
    ) RETURNING * INTO v_payout;
    UPDATE public.payee_payouts SET
      idempotency_key='payee_share:'||v_payout.id::text||':0',
      transfer_group='payee_'||v_payout.id::text
    WHERE id=v_payout.id;
    SELECT * INTO v_payout FROM public.payee_payouts WHERE id=v_payout.id;

    WITH rows AS (
      SELECT s.id,public.issue_3872_payee_remaining_net(s) settled,
        COALESCE(sum(public.issue_3872_payee_remaining_net(s)) OVER (
          ORDER BY s.created_at,s.id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ),0) prior
      FROM public.payee_shares s
      WHERE s.payee_user_id=v_group.payee_user_id AND s.rail=v_group.rail
        AND s.currency=v_group.currency AND s.status='releasable' AND s.payout_id IS NULL
    )
    INSERT INTO public.payee_payout_items(payout_id,share_id,settled_minor,provider_amount_minor)
    SELECT v_payout.id,id,settled,
      greatest(least(prior+settled-v_withheld-v_fee,v_payout.amount_minor),0)
      -greatest(least(prior-v_withheld-v_fee,v_payout.amount_minor),0)
    FROM rows;
    UPDATE public.payee_shares s SET payout_id=v_payout.id,updated_at=p_now
    WHERE EXISTS(SELECT 1 FROM public.payee_payout_items i
      WHERE i.payout_id=v_payout.id AND i.share_id=s.id);

    WITH debts AS (
      SELECT d.id,d.amount_minor-d.recovered_minor remaining,
        COALESCE(sum(d.amount_minor-d.recovered_minor) OVER (
          ORDER BY d.created_at,d.id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ),0) prior
      FROM public.payee_debts d WHERE d.payee_user_id=v_group.payee_user_id
        AND d.rail=v_group.rail AND d.currency=v_group.currency AND d.status='open'
    ), allocations AS (
      SELECT id,greatest(least(remaining,v_withheld-prior),0)::bigint amount FROM debts
    ), inserted AS (
      INSERT INTO public.payee_debt_recoveries AS recovery(payout_id,debt_id,amount_minor)
      SELECT v_payout.id,id,amount FROM allocations WHERE amount>0
      RETURNING recovery.debt_id,recovery.amount_minor
    )
    UPDATE public.payee_debts d SET
      recovered_minor=d.recovered_minor+i.amount_minor,
      status=CASE WHEN d.recovered_minor+i.amount_minor=d.amount_minor THEN 'recovered' ELSE d.status END,
      recovered_at=CASE WHEN d.recovered_minor+i.amount_minor=d.amount_minor THEN p_now ELSE d.recovered_at END
    FROM inserted i WHERE d.id=i.debt_id;

    IF v_group.rail='stripe' AND (SELECT count(*) FROM public.payee_payout_items i WHERE i.payout_id=v_payout.id)=1 THEN
      SELECT CASE s.order_kind WHEN 'ticket' THEN o.stripe_charge_id ELSE vo.stripe_charge_id END
        INTO v_source_charge_id
      FROM public.payee_payout_items i JOIN public.payee_shares s ON s.id=i.share_id
      LEFT JOIN public.orders o ON s.order_kind='ticket' AND o.id=s.order_id
      LEFT JOIN public.venue_orders vo ON s.order_kind='venue_order' AND vo.id=s.order_id
      WHERE i.payout_id=v_payout.id AND i.provider_amount_minor>=v_payout.amount_minor;
      UPDATE public.payee_payouts SET source_charge_id=v_source_charge_id WHERE id=v_payout.id;
    ELSE v_source_charge_id:=NULL; END IF;

    payout_id:=v_payout.id;payee_user_id:=v_group.payee_user_id;
    rail:=v_group.rail;currency:=v_group.currency;amount_minor:=v_payout.amount_minor;
    account_ref:=v_account;attempt:=0;provider_ref:=NULL;
    transfer_group:=v_payout.transfer_group;
    source_charge_id:=v_source_charge_id;
    RETURN NEXT;v_count:=v_count+1;
  END LOOP;
END;
$function$;

-- ── P-2: every refund branch includes a pending counter difference ───────
CREATE OR REPLACE FUNCTION public.gig_refund_quote(p_contract_id uuid, p_branch text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  -- #4430 P-2: a pending counter difference can still be refunded after a
  -- part refund left the hold partially_refunded.
  IF NOT FOUND OR v_hold.provider_ref IS NULL
     OR NOT (v_hold.status='captured' OR (p_branch='counter_lower' AND v_hold.status='partially_refunded')) THEN
    RAISE EXCEPTION 'captured_hold_required' USING ERRCODE='55000';
  END IF;
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
    -- #4430 P-2: the host also gets any not-yet-paid lower-counter difference.
    v_refund:=(v_fee*7500)/10000+v_booking+v_counter_pending; v_creator:=v_fee-(v_fee*7500)/10000;
  ELSIF p_branch='resolved_partial' THEN
    SELECT decided_refund_bps INTO v_bps FROM public.gig_disputes WHERE contract_id=v.id AND status='decided' AND decided_outcome='partial_refund' ORDER BY decided_at DESC LIMIT 1;
    IF v_bps IS NULL OR v_bps NOT BETWEEN 0 AND 10000 THEN RAISE EXCEPTION 'refund_bps_invalid' USING ERRCODE='22023'; END IF;
    v_refund:=(v_fee*v_bps)/10000+CASE WHEN v_bps=10000 THEN v_booking ELSE 0 END+v_counter_pending;
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
$function$;

-- ── P-2 record, and Q1 re-offer after a hire ends ────────────────────────
CREATE OR REPLACE FUNCTION public.issue_4402_gig_refund_record_impl(p_contract_id uuid, p_branch text, p_refund_minor bigint, p_creator_fee_minor bigint, p_provider_ref text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v public.gig_contracts; v_hold public.gig_holds; v_terms public.gig_terms_versions; v_target text; v_share uuid;
  v_quote jsonb; v_source jsonb; v_refunded bigint; v_existing_share public.payee_shares; v_total_held bigint;
  v_folded bigint;
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
    -- #4430: a counter difference folded into this refund is recorded on its
    -- adjustment with this refund's provider reference.
    SELECT v_hold.refunded_minor+coalesce(sum(a.refunded_minor) FILTER (WHERE a.kind='topup'),0)
         +coalesce(sum(a.refunded_minor) FILTER (WHERE a.kind='refund' AND a.status='refunded' AND a.provider_ref IS NOT DISTINCT FROM p_provider_ref),0)
      INTO v_refunded
      FROM public.gig_hold_adjustments a WHERE a.contract_id=v.id;
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
  -- #4430 P-2: the quote paid every pending counter refund (every branch now
  -- includes it), so those are recorded as refunded, not superseded. The
  -- amount came out of the base charge, so the base keeps counting only its
  -- own refund (the quote's base_left stays right). Only a pending top-up,
  -- which was never captured, is superseded.
  SELECT coalesce(sum(amount_minor),0) INTO v_folded FROM public.gig_hold_adjustments
   WHERE contract_id=v.id AND kind='refund' AND status='pending';
  IF v_folded>0 THEN
    UPDATE public.gig_holds SET refunded_minor=greatest(refunded_minor-v_folded,0) WHERE id=v_hold.id;
    UPDATE public.gig_hold_adjustments SET status='refunded',refunded_minor=amount_minor,provider_ref=p_provider_ref
     WHERE contract_id=v.id AND kind='refund' AND status='pending';
  END IF;
  UPDATE public.gig_hold_adjustments SET status='superseded' WHERE contract_id=v.id AND kind='topup' AND status='pending';
  IF p_branch IN ('creator_after_accept','resolved_refund','upload_missed','post_missed') THEN -- Reliability is only shown from three completed gigs (table check), so the
    -- penalty applies from then on instead of violating the constraint.
    UPDATE public.creator_profiles SET reliability_bps=CASE WHEN completed_gigs>=3 THEN greatest(0,coalesce(reliability_bps,10000)-1000) END WHERE creator_account_id=v.creator_account_id; END IF;
  IF v_target<>v.state OR v.cancel_reason IS DISTINCT FROM p_branch THEN
    PERFORM public.issue_3872_contract_apply_state(v.id,v_target,NULL,NULL,NULL,NULL);
    UPDATE public.gig_contracts SET cancel_reason=p_branch WHERE id=v.id;
  END IF;
  -- #4402 / #4430 Q1: after any ending that is not a success, the host may
  -- offer the same creator again (a fresh contract and hold); the creator is
  -- free to accept or decline it.
  IF p_branch IN ('host_before_accept','host_after_accept_before_lock','creator_after_accept',
                  'creator_decline','declined_or_expired','upload_missed','post_missed') THEN
    UPDATE public.gig_interest SET status='shortlisted',updated_at=now()
     WHERE gig_id=v.gig_id AND creator_account_id=v.creator_account_id AND status='offered';
  END IF;
  INSERT INTO public.gig_events(contract_id,actor,kind,data) VALUES(v.id,'system','refund_recorded',jsonb_build_object('branch',p_branch,'refund_minor',p_refund_minor,'creator_fee_minor',p_creator_fee_minor,'provider_ref',p_provider_ref,'share_id',v_share));
  RETURN jsonb_build_object('ok',true,'state',v_target,'share_id',v_share);
END;
$function$;

-- ── Q1: re-offer the same creator after a hire ends ──────────────────────
CREATE OR REPLACE FUNCTION public.issue_4216_gig_offer_prepare_impl(p_interest_id uuid, p_terms jsonb, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid:=auth.uid(); v_interest public.gig_interest; v_gig public.gigs; v_contract uuid;
  v_fee bigint; v_booking bigint; v_rail text; v_existing public.gig_holds; v_live public.gig_contracts;
  v_terms jsonb:=coalesce(CASE WHEN jsonb_typeof(p_terms)='object' THEN p_terms END,'{}'::jsonb);
  v_shoot date; v_post_by date; v_below jsonb;
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
  -- #4402 D2: the offered fee is at least the currency minimum. Checked
  -- before anything changes, so a refused call never retires an unpaid offer
  -- (tester P3-2). A malformed or non-positive fee falls through to the
  -- existing fee_invalid answer below.
  v_below:=public.issue_4402_gig_fee_below_minimum(CASE
      WHEN coalesce(v_terms->>'fee_minor','')~'^[0-9]{1,15}$' THEN nullif((v_terms->>'fee_minor')::bigint,0)
      WHEN nullif(v_terms->>'fee_minor','') IS NULL AND v_interest.quoted_minor>0 THEN v_interest.quoted_minor END,
    v_gig.currency,'fee_minor');
  IF v_below IS NOT NULL THEN RETURN v_below; END IF;

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
      -- #4402: the retired offer reopens the interest, as the sweep does.
      UPDATE public.gig_interest SET status='shortlisted',updated_at=now() WHERE id=v_interest.id AND status='offered';
    ELSE
      RETURN jsonb_build_object('ok',false,'error','already_offered');
    END IF;
  ELSIF v_interest.status NOT IN ('sent','shortlisted')
    -- #4430 Q1: an interest whose last hire on this gig ended without success
    -- (cancelled, declined or expired, with or without money held) may be
    -- offered again.
    AND NOT (v_interest.status='offered' AND (
      SELECT c.state FROM public.gig_contracts c
       WHERE c.gig_id=v_gig.id AND c.creator_account_id=v_interest.creator_account_id
       ORDER BY c.created_at DESC, c.id DESC LIMIT 1) IN ('declined','expired','cancelled')) THEN
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
$function$;

-- ── N-1: money in words for notices (whole units; cents only when not zero) ─
CREATE OR REPLACE FUNCTION public.issue_4430_money_words(p_minor bigint, p_currency text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE WHEN p_minor IS NULL THEN NULL ELSE
    CASE upper(coalesce(p_currency,'')) WHEN 'NGN' THEN '₦' WHEN 'USD' THEN '$' WHEN 'GBP' THEN '£'
      WHEN 'EUR' THEN '€' WHEN 'GHS' THEN 'GH₵' WHEN 'KES' THEN 'KSh ' WHEN 'ZAR' THEN 'R'
      ELSE upper(coalesce(nullif(p_currency,''),'')) || ' ' END
    || CASE WHEN p_minor<0 THEN '-' ELSE '' END
    || to_char(abs(p_minor)/100,'FM999,999,999,990')
    || CASE WHEN abs(p_minor)%100=0 THEN '' ELSE '.'||lpad((abs(p_minor)%100)::text,2,'0') END
  END
$function$;
REVOKE ALL ON FUNCTION public.issue_4430_money_words(bigint,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4430_money_words(bigint,text) TO service_role;

-- ── N-1 / item 3: gig notices ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_3872_gig_event_notice()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_marker text:=NEW.id::text; v_state text; v_tz text; v_deadline timestamptz; v_shoot timestamptz;
  v_gig uuid; v_currency text; v_fee bigint; v_due timestamptz; v_creator text; v_open text:='';
  v_refund text; v_keep text; v_bps integer;
BEGIN
  -- #4430: the agreed upload due is the current terms' one, else the brief's
  -- (the same rule as gig_contract_workspace).
  SELECT c.state,public.issue_3872_gig_timezone(c.gig_id),c.state_deadline_at,c.gig_id,t.currency,t.fee_minor,coalesce(t.video_due_at,g.video_due_at),p.display_name
    INTO v_state,v_tz,v_deadline,v_gig,v_currency,v_fee,v_due,v_creator
    FROM public.gig_contracts c
    LEFT JOIN public.gigs g ON g.id=c.gig_id
    LEFT JOIN public.gig_terms_versions t ON t.contract_id=c.id AND t.version=c.current_terms_version
    LEFT JOIN public.creator_profiles p ON p.creator_account_id=c.creator_account_id
   WHERE c.id=NEW.contract_id;
  -- #4430 N-1: the host hears when the gig can take another creator.
  IF EXISTS(SELECT 1 FROM public.gigs g WHERE g.id=v_gig AND g.status='open') AND coalesce(public.issue_3872_gig_slots_left(v_gig),0)>0 THEN
    v_open:=' Your gig is open again for other applicants.';
  END IF;
  v_refund:=public.issue_4430_money_words((NEW.data->>'refund_minor')::bigint,v_currency);
  v_keep:=public.issue_4430_money_words((NEW.data->>'creator_fee_minor')::bigint,v_currency);
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
      'Your full refund has started.'||v_open);
    PERFORM public.issue_3872_enqueue_gig_notice(NEW.contract_id,'creator.gig.post_missed','creator',v_marker,'This gig was cancelled',
      'The posts weren''t added by the deadline, so the host was refunded.');
  ELSIF NEW.kind='refund_recorded' AND NEW.data->>'branch' IN ('creator_decline','declined_or_expired') THEN
    PERFORM public.issue_3872_enqueue_gig_notice(NEW.contract_id,'business.gig.declined_refunded','host',v_marker,'Creator offer closed','The offer was declined or expired and the eligible refund was recorded.'||v_open);
    -- #4430 N-1: the creator hears about an expiry; a decline was their own.
    IF v_state='expired' THEN
      PERFORM public.issue_3872_enqueue_gig_notice(NEW.contract_id,'creator.gig.cancelled','creator',v_marker,'This offer expired','You didn''t answer in time.');
    END IF;
  -- #4430 N-1: cancellations after acceptance and a missed upload.
  ELSIF NEW.kind='refund_recorded' AND NEW.data->>'branch'='host_after_accept_before_lock' THEN
    PERFORM public.issue_3872_enqueue_gig_notice(NEW.contract_id,'creator.gig.cancelled','creator',v_marker,'The host cancelled this gig',
      'You keep '||coalesce(v_keep,'your share')||' for the work so far.');
    PERFORM public.issue_3872_enqueue_gig_notice(NEW.contract_id,'business.gig.cancelled','host',v_marker,'Gig cancelled',
      coalesce(v_refund,'Your refund')||' is on its way back to your payment.'||v_open);
  ELSIF NEW.kind='refund_recorded' AND NEW.data->>'branch'='creator_after_accept' THEN
    PERFORM public.issue_3872_enqueue_gig_notice(NEW.contract_id,'creator.gig.cancelled','creator',v_marker,'You cancelled this gig',
      'The host gets a full refund.');
    PERFORM public.issue_3872_enqueue_gig_notice(NEW.contract_id,'business.gig.cancelled','host',v_marker,coalesce(nullif(btrim(v_creator),''),'The creator')||' cancelled the gig',
      'Your full refund of '||coalesce(v_refund,'your payment')||' has started.'||v_open);
  ELSIF NEW.kind='refund_recorded' AND NEW.data->>'branch'='upload_missed' THEN
    PERFORM public.issue_3872_enqueue_gig_notice(NEW.contract_id,'creator.gig.cancelled','creator',v_marker,'This gig was cancelled',
      'The video wasn''t uploaded by the deadline, so the host was refunded.');
    PERFORM public.issue_3872_enqueue_gig_notice(NEW.contract_id,'business.gig.cancelled','host',v_marker,'The video didn''t arrive in time',
      'Your full refund has started.'||v_open);
  -- #4430 N-1: a missed deadline with no money held (gig_refund_claim).
  ELSIF NEW.kind='post_missed_closed' THEN
    PERFORM public.issue_3872_enqueue_gig_notice(NEW.contract_id,'creator.gig.post_missed','creator',v_marker,'This gig was closed','The deadline passed.');
    PERFORM public.issue_3872_enqueue_gig_notice(NEW.contract_id,'business.gig.post_missed','host',v_marker,'The creator missed the deadline',
      'Nothing was charged.'||v_open);
  ELSIF NEW.kind='script_sent' THEN
    PERFORM public.issue_3872_enqueue_gig_notice(NEW.contract_id,'business.gig.script_ready','host',v_marker,'Creator script ready','Review the creator’s script. It will auto-lock after the review window.');
  ELSIF NEW.kind IN ('lock_script','auto_lock') THEN
    -- #4430 item 3: name the agreed upload deadline instead of a fixed gap.
    PERFORM public.issue_3872_enqueue_gig_notice(NEW.contract_id,'creator.gig.script_locked','creator',v_marker,'Script locked',
      'The agreed script is locked. '||coalesce('Film and upload by '||public.issue_4402_gig_when(v_due,v_tz)||'.','Film and upload before the agreed due date.'));
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
  -- #4430 N-1: the decision itself, in words, for both sides.
  ELSIF NEW.kind='dispute_decided' THEN
    v_bps:=nullif(NEW.data->>'refund_bps','')::integer;
    v_keep:=public.issue_4430_money_words(v_fee-(v_fee*coalesce(v_bps,0))/10000,v_currency);
    PERFORM public.issue_3872_enqueue_gig_notice(NEW.contract_id,'creator.gig.dispute','creator',v_marker,'Dispute decided',
      CASE NEW.data->>'outcome'
        WHEN 'release' THEN 'Mingla decided: you get the full fee.'
        WHEN 'full_refund' THEN 'Mingla decided: the host gets a full refund.'
        ELSE 'Mingla decided: '||trim_scale(coalesce(v_bps,0)::numeric/100)::text||'% back to the host, you get '||coalesce(v_keep,'the rest of the fee')||'.' END);
    PERFORM public.issue_3872_enqueue_gig_notice(NEW.contract_id,'business.gig.dispute','host',v_marker,'Dispute decided',
      CASE NEW.data->>'outcome'
        WHEN 'release' THEN 'Mingla decided: the creator gets the full fee.'
        WHEN 'full_refund' THEN 'Mingla decided: you get a full refund.'
        ELSE 'Mingla decided: '||trim_scale(coalesce(v_bps,0)::numeric/100)::text||'% back to you, the creator gets '||coalesce(v_keep,'the rest of the fee')||'.' END);
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

-- ── N-2: gig and Local shares are not referral sales ────────────────────
CREATE OR REPLACE FUNCTION public.issue_3872_referral_share_notice()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_member public.referral_members%ROWTYPE;
  v_offer public.referral_offers%ROWTYPE;
  v_before bigint;
  v_after bigint;
  v_type text;
  v_sales integer;
  v_tier_bps integer;
BEGIN
  -- #4430 N-2: only referral shares are referral news. Gig and Local shares
  -- used to send the host "A referral made a sale" with an empty body.
  IF NEW.payee_kind IS DISTINCT FROM 'referral' THEN RETURN NEW; END IF;
  SELECT * INTO v_member FROM public.referral_members WHERE id=NEW.member_id;
  SELECT * INTO v_offer FROM public.referral_offers WHERE id=v_member.offer_id;
  IF TG_OP='INSERT' THEN
    PERFORM public.issue_3872_enqueue_brand_referral_notice(
      NEW.brand_id,'business.referral.sale',NEW.id::text,
      'A referral made a sale',v_member.display_name||' earned a reward from '||v_offer.name||'.',
      jsonb_build_object('share_id',NEW.id,'member_id',NEW.member_id,'offer_id',v_offer.id,
        'amount_cents',NEW.net_minor,'currency',NEW.currency)
    );
    IF v_member.user_id IS NOT NULL THEN
      v_type:=CASE WHEN v_member.role='buyer' THEN 'consumer.referral.earned' ELSE 'creator.referral.sale' END;
      INSERT INTO public.notification_outbox(category_key,user_id,brand_id,payload,idempotency_key,status)
      VALUES(v_type,v_member.user_id,NEW.brand_id,jsonb_build_object(
        'title','You earned a referral reward','body','Your eligible referral to '||v_offer.name||' earned a reward.',
        'share_id',NEW.id,'amount_cents',NEW.net_minor,'currency',NEW.currency,
        'deep_link','mingla://earnings'
      ),v_type||':'||NEW.id::text,'pending') ON CONFLICT(idempotency_key) DO NOTHING;
      IF v_member.role='buyer' AND NOT EXISTS (
        SELECT 1 FROM public.payee_accounts account
        WHERE account.user_id=v_member.user_id
          AND (account.stripe_status='active' OR account.paystack_status='verified')
      ) THEN
        INSERT INTO public.notification_outbox(category_key,user_id,brand_id,payload,idempotency_key,status)
        VALUES('consumer.referral.payout_account_needed',v_member.user_id,NEW.brand_id,
          jsonb_build_object('title','Connect an account to get paid',
            'body','Your referral reward is safe. Connect a payout account so Mingla can send it automatically.',
            'share_id',NEW.id,'deep_link','mingla://earnings/payout-account'),
          'consumer.referral.payout_account_needed:'||v_member.user_id::text,'pending')
        ON CONFLICT(idempotency_key) DO NOTHING;
      END IF;
      SELECT count(*) INTO v_sales FROM public.order_attributions attribution
      WHERE attribution.member_id=v_member.id AND attribution.rejected_reason IS NULL;
      SELECT tier.share_bps INTO v_tier_bps FROM public.referral_offer_tiers tier
      WHERE tier.offer_id=v_offer.id AND tier.min_sales=v_sales;
      IF FOUND AND v_member.role<>'buyer' THEN
        INSERT INTO public.notification_outbox(category_key,user_id,brand_id,payload,idempotency_key,status)
        VALUES('creator.referral.tier_up',v_member.user_id,NEW.brand_id,
          jsonb_build_object('title','Your referral rate went up',
            'body','You reached '||v_sales::text||' sales and unlocked a '||(v_tier_bps::numeric/100)::text||'% reward rate.',
            'offer_id',v_offer.id,'share_bps',v_tier_bps,'deep_link','mingla-business://promoting'),
          'creator.referral.tier_up:'||v_member.id::text||':'||v_sales::text,'pending')
        ON CONFLICT(idempotency_key) DO NOTHING;
      END IF;
    END IF;
    IF v_offer.budget_minor IS NOT NULL THEN
      SELECT COALESCE(sum(gross_minor),0)-NEW.gross_minor INTO v_before
      FROM public.payee_shares share
      JOIN public.referral_members member ON member.id=share.member_id
      WHERE member.offer_id=v_offer.id;
      v_after:=v_before+NEW.gross_minor;
      IF v_before*100<v_offer.budget_minor*80 AND v_after*100>=v_offer.budget_minor*80 THEN
        PERFORM public.issue_3872_enqueue_brand_referral_notice(
          NEW.brand_id,'business.referral.budget_80',v_offer.id::text,
          'Referral budget is 80% used',v_offer.name||' is close to its reward budget.',
          jsonb_build_object('offer_id',v_offer.id,'budget_minor',v_offer.budget_minor,'spent_minor',v_after)
        );
      END IF;
      IF v_before<v_offer.budget_minor AND v_after>=v_offer.budget_minor THEN
        PERFORM public.issue_3872_enqueue_brand_referral_notice(
          NEW.brand_id,'business.referral.budget_reached',v_offer.id::text,
          'Referral budget reached',v_offer.name||' has stopped earning new rewards.',
          jsonb_build_object('offer_id',v_offer.id,'budget_minor',v_offer.budget_minor)
        );
      END IF;
    END IF;
  ELSIF NEW.reversed_minor>OLD.reversed_minor AND v_member.user_id IS NOT NULL THEN
    v_type:=CASE WHEN v_member.role='buyer' THEN 'consumer.referral.claim' ELSE 'creator.referral.reversed' END;
    INSERT INTO public.notification_outbox(category_key,user_id,brand_id,payload,idempotency_key,status)
    VALUES(v_type,v_member.user_id,NEW.brand_id,jsonb_build_object(
      'title','Referral reward adjusted','body','A refund or dispute changed one of your referral rewards.',
      'share_id',NEW.id,'amount_cents',NEW.reversed_minor-OLD.reversed_minor,'currency',NEW.currency,
      'deep_link','mingla://earnings'
    ),v_type||':'||NEW.id::text||':'||NEW.reversed_minor::text,'pending')
    ON CONFLICT(idempotency_key) DO NOTHING;
  ELSIF NEW.status='paid' AND OLD.status IS DISTINCT FROM 'paid' AND v_member.user_id IS NOT NULL THEN
    v_type:=CASE WHEN v_member.role='buyer' THEN 'consumer.referral.paid' ELSE 'creator.referral.paid' END;
    INSERT INTO public.notification_outbox(category_key,user_id,brand_id,payload,idempotency_key,status)
    VALUES(v_type,v_member.user_id,NEW.brand_id,jsonb_build_object(
      'title','Referral payout sent','body','Your referral payout is on its way to your connected account.',
      'share_id',NEW.id,'amount_cents',NEW.net_minor-NEW.reversed_minor,'currency',NEW.currency,
      'deep_link','mingla://earnings'
    ),v_type||':'||NEW.id::text,'pending') ON CONFLICT(idempotency_key) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$;

-- ── Item 5: split outcomes have their own money state ───────────────────
CREATE OR REPLACE FUNCTION public.issue_3872_contract_money_state(p_contract_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    -- #4430 item 5: a part refund with a creator share is a split, not "Ready".
    WHEN s.id IS NOT NULL AND h.status='partially_refunded' AND c.state='resolved_partial' THEN 'dispute_partial'
    WHEN s.id IS NOT NULL AND h.status='partially_refunded' THEN 'cancelled_partial'
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
$function$;
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
    -- #4430 P-2: a lower counter difference not yet paid back to the host.
    'pending_refund',(SELECT jsonb_build_object('amount_minor',sum(a.amount_minor),'currency',min(a.currency)) FROM public.gig_hold_adjustments a WHERE a.contract_id=v.id AND a.kind='refund' AND a.status='pending' HAVING count(*)>0),
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
    -- #4430 item 5: what the creator keeps on a split ending.
    'creator_kept_minor',coalesce((SELECT s.net_minor-s.reversed_minor FROM public.payee_shares s
      WHERE s.order_kind='gig' AND s.order_id=v.id AND s.payee_kind='gig_fee'),0),
    'format_structure',(SELECT f.structure FROM public.gigs g3 JOIN public.gig_formats f ON f.key=g3.format_key WHERE g3.id=v.gig_id));
END;
$function$;

-- ── L-1: qualify unnest column ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.local_review_submit(p_local_month_id uuid, p_rating integer, p_title text, p_body text, p_visited_on date, p_spend_band text, p_media_job_ids uuid[], p_social_post_url text, p_disclosure_ack boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_month public.local_months; v_now date:=current_date;
BEGIN
  SELECT m.* INTO v_month FROM public.local_months m JOIN public.locals l ON l.id=m.local_id WHERE m.id=p_local_month_id AND l.user_id=auth.uid() FOR UPDATE OF m;
  IF NOT FOUND OR v_month.status NOT IN ('visited','changes_requested') THEN RAISE EXCEPTION 'review_not_submittable' USING ERRCODE='55000'; END IF;
  IF v_now>=(v_month.month+interval '1 month 3 days')::date OR (v_month.status='changes_requested' AND (v_month.changes_due_at IS NULL OR now()>v_month.changes_due_at OR v_month.resubmission_count>=1)) THEN RAISE EXCEPTION 'review_deadline_passed' USING ERRCODE='55000'; END IF;
  -- #18: the visit must fall inside this Local month and not in the future
  -- (a 2025-01-01 visit used to pass).
  IF p_visited_on IS NULL OR date_trunc('month',p_visited_on)::date<>v_month.month OR p_visited_on>v_now THEN
    RAISE EXCEPTION 'visited_on_outside_month' USING ERRCODE='22023';
  END IF;
  -- #18: the disclosed social post must be on a supported social host.
  IF p_social_post_url IS NULL OR p_social_post_url !~* '^https://((www|m|vm)\.)?(instagram\.com|tiktok\.com|youtube\.com|youtu\.be|x\.com|twitter\.com|facebook\.com|threads\.net)/[^[:space:]]+$' THEN
    RAISE EXCEPTION 'social_post_url_not_allowed' USING ERRCODE='22023';
  END IF;
  IF NOT p_disclosure_ack
    OR cardinality(p_media_job_ids) NOT BETWEEN 1 AND 6
    OR EXISTS(SELECT 1 FROM unnest(p_media_job_ids) AS m(job_id) WHERE NOT EXISTS(
      SELECT 1 FROM public.creator_media_jobs j
      WHERE j.id=m.job_id AND j.owner_kind='local' AND j.owner_id=auth.uid()
        AND j.local_month_id=v_month.id AND j.purpose='local_review'
        AND j.status='ready' AND j.deleted_at IS NULL
    ))
    OR (
      EXISTS(SELECT 1 FROM public.creator_media_jobs j WHERE j.id=ANY(p_media_job_ids) AND j.duration_s IS NOT NULL)
      AND (
        cardinality(p_media_job_ids)<>1
        OR NOT EXISTS(SELECT 1 FROM public.creator_media_jobs j WHERE j.id=p_media_job_ids[1] AND j.duration_s>0)
      )
    )
  THEN RAISE EXCEPTION 'review_evidence_invalid' USING ERRCODE='22023'; END IF;
  INSERT INTO public.local_reviews(local_month_id,rating,title,body,visited_on,spend_band,media_job_ids,social_post_url,disclosure_ack)
  VALUES(v_month.id,p_rating,btrim(p_title),btrim(p_body),p_visited_on,p_spend_band,p_media_job_ids,p_social_post_url,true)
  ON CONFLICT(local_month_id) DO UPDATE SET rating=excluded.rating,title=excluded.title,body=excluded.body,visited_on=excluded.visited_on,spend_band=excluded.spend_band,media_job_ids=excluded.media_job_ids,social_post_url=excluded.social_post_url,social_check_status='pending',social_check_detail='{}',disclosure_ack=true,changes_requested='{}';
  UPDATE public.local_months SET status='submitted',submitted_at=now(),resubmission_count=CASE WHEN status='changes_requested' THEN resubmission_count+1 ELSE resubmission_count END,changes_due_at=NULL WHERE id=v_month.id;
  INSERT INTO public.local_events(local_id,local_month_id,actor,kind) VALUES(v_month.local_id,v_month.id,'local','local_submitted');
  RETURN jsonb_build_object('ok',true,'status','submitted');
END;
$function$;

-- ── P-2 repair (Seth, Q3): re-open the one stranded counter difference ────
-- Production read before this file was written: exactly one refund
-- adjustment is 'superseded' — TEST contract d0976ab9-1832-4cf0-be70-138f9ddf0181,
-- 5750 NGN, settled resolved_partial. Re-opening it lets the next gig-timers
-- run refund it once through the counter_lower branch (claim key
-- counter:<adjustment id>, never used before). Guarded to that contract and
-- amount; on any other database it matches nothing.
DO $repair$
DECLARE v_count integer;
BEGIN
  WITH reopened AS (
    UPDATE public.gig_hold_adjustments a SET status='pending'
     WHERE a.kind='refund' AND a.status='superseded' AND a.refunded_minor=0
       AND a.contract_id='d0976ab9-1832-4cf0-be70-138f9ddf0181'::uuid
       AND a.amount_minor=5750 AND a.currency='NGN'
       AND EXISTS(SELECT 1 FROM public.gig_contracts c WHERE c.id=a.contract_id
                   AND c.cancel_reason IN ('host_after_accept_before_lock','resolved_partial'))
       AND EXISTS(SELECT 1 FROM public.gig_holds h JOIN public.gig_contracts c ON c.id=h.contract_id AND h.terms_version=c.current_terms_version
                   WHERE h.contract_id=a.contract_id AND h.status='partially_refunded' AND h.provider_ref IS NOT NULL)
    RETURNING a.id,a.contract_id,a.amount_minor
  ), logged AS (
    INSERT INTO public.gig_events(contract_id,actor,kind,data)
    SELECT contract_id,'system','counter_refund_reopened',jsonb_build_object('adjustment_id',id,'amount_minor',amount_minor,'issue',4430)
    FROM reopened RETURNING 1
  )
  SELECT count(*) INTO v_count FROM logged;
  ASSERT v_count<=1, format('issue_4430 repair re-opened %s rows, expected at most 1', v_count);
END
$repair$;

COMMIT;
