-- #4402 polish PR, migration M5 (spec amendment A1 + A2, orchestrator
-- review on #4402).
--
-- WHY:
--   A1. When Admin failed a post and the creator fixed it with a NEW link,
--       the old row stayed 'failed', so issue_4402_gig_post_check_apply kept
--       counting a failure and the contract could never reach
--       posts_verified (D1 blocked). gig_posts_submit now removes the
--       creator's earlier FAILED rows for each platform it resubmits; the
--       review history stays in gig_events (post_reviewed carries post_id,
--       result and reason). gig_posts has no foreign keys pointing at it.
--   A2. OQ-5 / E21: a payout bank account whose resolved name shares no
--       word with the creator's names is flagged for Admin review. Payouts
--       are never blocked by it. Only the flag, a reason and the time are
--       stored; the account name itself is not (the payee function's
--       gateway promise: recipient identity and last4 only). The
--       payee-account-paystack-recipient function calls
--       issue_4402_payee_name_review_set after a successful connect.
--
--   Tester P1-1. A contract with NO captured hold (production QA contract
--       5afe2353, seeded without an offer) that misses its post deadline
--       used to loop forever: gig_refund_claim answered nothing_due and
--       gig-refund replied 409 on every timer tick. post_missed with nothing
--       held is now terminal inside gig_refund_claim: the contract moves to
--       cancelled (cancel_reason post_missed), a post_missed_closed event is
--       recorded with refund_minor 0, and the claim answers 'completed', so
--       gig-refund returns ok without any provider call.
--   Tester P2-1. gig_posts_submit locks the contract row and refuses
--       (posting_closed) once a post_missed refund claim exists or the post
--       deadline has passed, so a submit can never slip between the refund
--       claim (which holds the same row lock) and the refund record.
--
-- Replaced functions are copied from the production body (md5 matched) and
-- changed only as described.
-- Proof: __tests__/issue_4402_polish_post_resubmit_and_name_review.implementor.pg17.test.sql
BEGIN;
SET LOCAL lock_timeout = '10s';

ALTER TABLE public.payee_accounts
  ADD COLUMN IF NOT EXISTS name_review_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS name_review_reason text,
  ADD COLUMN IF NOT EXISTS name_review_checked_at timestamptz;
COMMENT ON COLUMN public.payee_accounts.name_review_required IS
  '#4402 E21: the bank account name shares no word with the creator''s names. Admin review only; never blocks payouts.';

CREATE OR REPLACE FUNCTION public.issue_4402_name_tokens(p_name text) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $fn$
  -- Letters only, case-insensitive, words of two or more letters.
  SELECT coalesce(array_agg(DISTINCT t),'{}'::text[])
  FROM regexp_split_to_table(lower(regexp_replace(coalesce(p_name,''),'[^[:alpha:]]+',' ','g')),'\s+') t
  WHERE char_length(t)>=2
$fn$;
REVOKE ALL ON FUNCTION public.issue_4402_name_tokens(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4402_name_tokens(text) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_4402_payee_name_review_set(p_user_id uuid, p_account_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_bank text[]:=public.issue_4402_name_tokens(p_account_name); v_profile text[]; v_flag boolean;
BEGIN
  -- MINGLA-INVARIANT: I-4402-PAYEE-NAME-1 | issue #4402 | a bank account name with no word in common with the creator's names is flagged for Admin review and never blocks a payout
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'service_role_only' USING ERRCODE='42501'; END IF;
  SELECT coalesce(array_agg(DISTINCT t),'{}'::text[]) INTO v_profile
  FROM (
    SELECT unnest(public.issue_4402_name_tokens(cp.display_name)) t FROM public.creator_profiles cp WHERE cp.creator_account_id=p_user_id
    UNION ALL SELECT unnest(public.issue_4402_name_tokens(ca.display_name)) FROM public.creator_accounts ca WHERE ca.id=p_user_id
    UNION ALL SELECT unnest(public.issue_4402_name_tokens(concat_ws(' ',pr.display_name,pr.first_name,pr.last_name))) FROM public.profiles pr WHERE pr.id=p_user_id
  ) n;
  -- Nothing to compare on either side: no flag (there is no evidence of a mismatch).
  v_flag:=cardinality(v_bank)>0 AND cardinality(v_profile)>0 AND NOT (v_bank && v_profile);
  UPDATE public.payee_accounts
     SET name_review_required=v_flag,
         name_review_reason=CASE WHEN v_flag THEN 'The bank account name shares no word with the creator''s profile name.' END,
         name_review_checked_at=now()
   WHERE user_id=p_user_id;
  RETURN jsonb_build_object('ok',FOUND,'name_review_required',v_flag);
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4402_payee_name_review_set(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4402_payee_name_review_set(uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.gig_refund_claim(p_contract_id uuid, p_branch text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v public.gig_contracts; v_key text; v_hold uuid; v_adj uuid; v_claim public.gig_refund_claims;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'service_role_only' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v FROM public.gig_contracts WHERE id = p_contract_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'contract_not_found' USING ERRCODE = 'P0002'; END IF;
  -- #4402 tester P1-1: a missed post with NOTHING held (no captured, released
  -- or refunded hold) has nothing to refund. Close it here, under the row
  -- lock, and answer 'completed' so gig-refund returns ok with no provider
  -- call and the timer never retries it.
  -- MINGLA-INVARIANT: I-4402-POST-5 | issue #4402 | a post_missed contract with nothing held ends cancelled with no provider call, never an endless 409 retry
  IF p_branch = 'post_missed' AND public.issue_3872_gig_refund_branch_allowed(v.id, 'post_missed')
     AND NOT EXISTS (SELECT 1 FROM public.gig_holds h WHERE h.contract_id = v.id
                      AND h.status IN ('captured','released','refunded','partially_refunded')) THEN
    PERFORM public.issue_3872_contract_apply_state(v.id, 'cancelled', NULL, NULL, NULL, 'post_missed');
    UPDATE public.gig_contracts SET cancel_reason = 'post_missed' WHERE id = v.id;
    INSERT INTO public.gig_events(contract_id, actor, kind, data)
    VALUES (v.id, 'system', 'post_missed_closed', jsonb_build_object('held', false, 'refund_minor', 0, 'from_state', v.state));
    RETURN jsonb_build_object('claimed', false, 'reason', 'completed', 'branch', 'post_missed',
      'provider_ref', NULL, 'closed_without_refund', true);
  END IF;
  IF p_branch = 'counter_lower' THEN
    SELECT id INTO v_adj FROM public.gig_hold_adjustments
     WHERE contract_id = v.id AND kind = 'refund' AND status = 'pending' ORDER BY created_at LIMIT 1;
    IF v_adj IS NULL THEN RETURN jsonb_build_object('claimed', false, 'reason', 'nothing_due'); END IF;
    v_key := 'counter:' || v_adj::text;
  ELSE
    SELECT id INTO v_hold FROM public.gig_holds WHERE contract_id = v.id AND terms_version = v.current_terms_version;
    IF v_hold IS NULL THEN RETURN jsonb_build_object('claimed', false, 'reason', 'nothing_due'); END IF;
    v_key := 'hold:' || v_hold::text;
  END IF;
  INSERT INTO public.gig_refund_claims AS rc (claim_key, contract_id, branch, status)
  VALUES (v_key, v.id, p_branch, 'claimed')
  ON CONFLICT (claim_key) DO UPDATE SET status = 'claimed', branch = EXCLUDED.branch,
    attempts = rc.attempts + 1, next_attempt_at = NULL
  WHERE (rc.status = 'failed' AND rc.next_attempt_at <= now())
     OR (rc.status = 'claimed' AND rc.updated_at < now() - interval '15 minutes')
  RETURNING * INTO v_claim;
  IF v_claim.id IS NOT NULL THEN
    RETURN jsonb_build_object('claimed', true, 'claim_id', v_claim.id, 'attempt', v_claim.attempts, 'claim_key', v_key);
  END IF;
  SELECT * INTO v_claim FROM public.gig_refund_claims WHERE claim_key = v_key;
  RETURN jsonb_build_object('claimed', false, 'claim_id', v_claim.id,
    'reason', CASE v_claim.status WHEN 'completed' THEN 'completed' WHEN 'claimed' THEN 'in_flight'
      WHEN 'gave_up' THEN 'gave_up' ELSE 'backoff' END,
    'branch', v_claim.branch, 'next_attempt_at', v_claim.next_attempt_at, 'provider_ref', v_claim.provider_ref);
END;
$fn$;
REVOKE ALL ON FUNCTION public.gig_refund_claim(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gig_refund_claim(uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.gig_posts_submit(p_contract_id uuid, p_posts jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_actor uuid:=auth.uid(); v_item jsonb; v_count integer:=0; v_platform text; v_url text; v_contract public.gig_contracts;
BEGIN
  IF public.issue_3872_contract_party(p_contract_id,v_actor)<>'creator' THEN RAISE EXCEPTION 'creator_only' USING ERRCODE='42501'; END IF;
  IF jsonb_typeof(p_posts)<>'array' OR jsonb_array_length(p_posts)=0 THEN RAISE EXCEPTION 'posts_required' USING ERRCODE='22023'; END IF;
  -- #4402 tester P2-1: the same row lock gig_refund_claim takes, so a submit
  -- cannot slip between a post_missed claim and its refund record.
  -- MINGLA-INVARIANT: I-4402-POST-6 | issue #4402 | no post is accepted once a post_missed claim exists or the post deadline has passed
  SELECT * INTO v_contract FROM public.gig_contracts WHERE id=p_contract_id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.gig_refund_claims rc WHERE rc.contract_id=p_contract_id AND rc.branch='post_missed')
     OR (v_contract.state IN ('approved','posting','posts_failed') AND v_contract.state_deadline_at<=now()) THEN
    RAISE EXCEPTION 'posting_closed' USING ERRCODE='55000';
  END IF;
  -- #4402 A1: a new link for a platform replaces that platform's failed
  -- links, so a fixed post can pass review. History stays in gig_events.
  -- MINGLA-INVARIANT: I-4402-POST-4 | issue #4402 | a resubmitted platform never keeps an earlier failed link that would block posts_verified
  DELETE FROM public.gig_posts gp
   WHERE gp.contract_id=p_contract_id AND gp.check_status='failed'
     AND gp.platform IN (SELECT e->>'platform' FROM jsonb_array_elements(p_posts) e)
     AND gp.url NOT IN (SELECT coalesce(e->>'url','') FROM jsonb_array_elements(p_posts) e);
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_posts) LOOP
    v_platform:=v_item->>'platform'; v_url:=v_item->>'url';
    IF NOT ((v_platform='instagram' AND v_url ~* '^https://(www\.)?instagram\.com/(reel|p)/') OR (v_platform='tiktok' AND v_url ~* '^https://(www\.)?tiktok\.com/@[^/]+/video/') OR (v_platform='youtube' AND v_url ~* '^https://(www\.)?youtube\.com/shorts/') OR (v_platform='x' AND v_url ~* '^https://(www\.)?x\.com/[^/]+/status/')) THEN RAISE EXCEPTION 'unsupported_post_url:%',v_platform USING ERRCODE='22023'; END IF;
    INSERT INTO public.gig_posts(contract_id,platform,url) VALUES(p_contract_id,v_platform,v_url) ON CONFLICT(contract_id,platform,url) DO UPDATE SET submitted_at=now(),check_status='pending',check_detail='{}'; v_count:=v_count+1;
  END LOOP;
  INSERT INTO public.gig_events(contract_id,actor,kind,data) VALUES(p_contract_id,'creator','posts_submitted',jsonb_build_object('count',v_count));
  PERFORM public.gig_transition(p_contract_id,(SELECT state FROM public.gig_contracts WHERE id=p_contract_id),'submit_posts',jsonb_build_object('count',v_count));
  RETURN jsonb_build_object('ok',true,'count',v_count);
END;
$function$;
REVOKE ALL ON FUNCTION public.gig_posts_submit(uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gig_posts_submit(uuid,jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_creator_queue(p_status text DEFAULT 'needs_person'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'admin_only' USING ERRCODE='42501'; END IF;
  IF p_status IS NULL OR p_status NOT IN ('needs_person','setting_up','all','incomplete','review','needs_more','verified','declined','suspended') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE='22023';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'creator_id',p.creator_account_id,'display_name',p.display_name,'city',c.name,
      'verification',p.verification,'review_note',p.review_note,'declined_reason',p.declined_reason,
      'checks',public.issue_3872_creator_checks(p.creator_account_id),
      'flags',to_jsonb(p.verification_reasons)
        ||coalesce((SELECT jsonb_agg('handle_review:'||h.platform) FROM public.creator_handles h WHERE h.creator_account_id=p.creator_account_id AND h.review_required),'[]'::jsonb)
        ||CASE WHEN EXISTS(SELECT 1 FROM public.payee_accounts a WHERE a.user_id=p.creator_account_id AND a.name_review_required)
          THEN '["payout_name_review"]'::jsonb ELSE '[]'::jsonb END,
      -- #4402 E21: the payout account name check (review only, never blocks payouts).
      'payout_name_review',(SELECT jsonb_build_object('required',a.name_review_required,'reason',a.name_review_reason,'checked_at',a.name_review_checked_at)
        FROM public.payee_accounts a WHERE a.user_id=p.creator_account_id),
      'handle',(SELECT jsonb_build_object('platform',h.platform,'handle',h.handle) FROM public.creator_handles h
                 WHERE h.creator_account_id=p.creator_account_id ORDER BY h.review_required DESC,h.verified_at IS NOT NULL DESC,h.platform LIMIT 1),
      'can_verify',jsonb_array_length(public.issue_4402_creator_verify_blockers(p.creator_account_id))=0,
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
$function$;
REVOKE ALL ON FUNCTION public.admin_creator_queue(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_creator_queue(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.issue_3872_my_earnings_summary()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid:=auth.uid();
  v_totals jsonb;
  v_shares jsonb;
  v_vouchers jsonb;
  v_perks jsonb;
  v_links jsonb;
  v_account jsonb;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;

  SELECT COALESCE(jsonb_object_agg(currency,jsonb_build_object(
    'onWayMinor',on_way_minor,
    'readyMinor',ready_minor,
    'paidMinor',paid_minor,
    'reversedMinor',reversed_minor
  )),'{}'::jsonb) INTO v_totals
  FROM (
    SELECT currency,
      COALESCE(sum(net_minor-reversed_minor) FILTER (
        WHERE status IN ('pending','held_until_event')
      ),0) on_way_minor,
      COALESCE(sum(net_minor-reversed_minor) FILTER (
        WHERE status IN ('releasable','accumulating')
      ),0) ready_minor,
      COALESCE(sum(net_minor-reversed_minor) FILTER (WHERE status='paid'),0) paid_minor,
      COALESCE(sum(reversed_minor),0) reversed_minor
    FROM public.payee_shares
    WHERE payee_user_id=v_actor
    GROUP BY currency
  ) amounts;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',s.id,'orderKind',s.order_kind,'orderId',s.order_id,
    'listingName',COALESCE(e.title,v.name,b.name,'Mingla purchase'),
    'earnedAt',s.created_at,'releaseAfter',s.release_after,
    'amountMinor',greatest(s.net_minor-s.reversed_minor,0),
    'grossMinor',s.gross_minor,'feeMinor',s.mingla_fee_minor,
    'reversedMinor',s.reversed_minor,'currency',s.currency,
    'status',s.status,'rail',s.rail
  ) ORDER BY s.created_at DESC),'[]'::jsonb) INTO v_shares
  FROM public.payee_shares s
  LEFT JOIN public.orders o ON s.order_kind='ticket' AND o.id=s.order_id
  LEFT JOIN public.events e ON e.id=o.event_id
  LEFT JOIN public.venue_orders vo ON s.order_kind='venue_order' AND vo.id=s.order_id
  LEFT JOIN public.venue_listings v ON v.id=vo.venue_id
  LEFT JOIN public.brands b ON b.id=s.brand_id
  WHERE s.payee_user_id=v_actor;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',g.id,'brandId',g.brand_id,'brandName',b.name,
    'discountId',g.discount_id,'status',g.status,'expiresAt',g.expires_at,
    'grantedAt',g.granted_at
  ) ORDER BY g.granted_at DESC),'[]'::jsonb) INTO v_vouchers
  FROM public.discount_grants g
  JOIN public.brands b ON b.id=g.brand_id
  WHERE g.grantee_user_id=v_actor;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'offerId',o.id,'offerName',o.name,'brandName',b.name,
    'perkText',o.perk_text,'threshold',o.perk_threshold,
    'qualifiedSales',COALESCE(stats.sales_count,0),
    'unlocked',COALESCE(stats.sales_count,0)>=o.perk_threshold
  ) ORDER BY b.name,o.name),'[]'::jsonb) INTO v_perks
  FROM public.referral_members m
  JOIN public.referral_offers o ON o.id=m.offer_id AND o.reward_kind='perk'
  JOIN public.brands b ON b.id=o.brand_id
  LEFT JOIN LATERAL (
    SELECT count(*)::integer sales_count
    FROM public.order_attributions a
    WHERE a.member_id=m.id AND a.rejected_reason IS NULL
      AND a.eligible_minor>0
  ) stats ON true
  WHERE m.user_id=v_actor AND m.status='active';

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'memberId',m.id,'offerId',o.id,'offerName',o.name,'brandName',b.name,
    'role',m.role,'linkSlug',m.link_slug,
    'url','https://usemingla.com/r/'||m.link_slug||CASE
      WHEN m.last_listing_kind IS NULL THEN ''
      ELSE '?kind='||m.last_listing_kind||'&id='||m.last_listing_id::text END,
    'rewardKind',o.reward_kind,'shareBps',o.share_bps,
    'perkText',o.perk_text,'status',o.status
  ) ORDER BY b.name,o.name),'[]'::jsonb) INTO v_links
  FROM public.referral_members m
  JOIN public.referral_offers o ON o.id=m.offer_id
  JOIN public.brands b ON b.id=o.brand_id
  WHERE m.user_id=v_actor AND m.status='active' AND o.status='active'
    AND o.deleted_at IS NULL AND o.starts_at<=now()
    AND (o.ends_at IS NULL OR o.ends_at>now());

  SELECT jsonb_build_object(
    'stripe',jsonb_build_object(
      'connected',stripe_account_id IS NOT NULL,'status',stripe_status,
      'country',stripe_country
    ),
    'paystack',jsonb_build_object(
      'connected',paystack_recipient_code IS NOT NULL,'status',paystack_status,
      'bankName',bank_name,
      'accountNumberMasked',CASE WHEN bank_account_last4 IS NULL THEN NULL
        ELSE '••••'||bank_account_last4 END,
      'country',paystack_country,'currency',paystack_currency,
      -- #4402 E21: "We'll check this account name with you before your first payout."
      'nameReviewRequired',name_review_required,'nameReviewReason',name_review_reason
    )
  ) INTO v_account
  FROM public.payee_accounts WHERE user_id=v_actor;

  RETURN jsonb_build_object(
    'totals',v_totals,'shares',v_shares,'vouchers',v_vouchers,
    'perks',v_perks,'links',v_links,
    -- #4402 item 31: what is waiting for the payout floor, per currency.
    'held_below_floor',public.issue_4402_held_below_floor(v_actor),
    'payoutAccount',COALESCE(v_account,jsonb_build_object(
      'stripe',jsonb_build_object('connected',false,'status','none','country',NULL),
      'paystack',jsonb_build_object('connected',false,'status','none',
        'bankName',NULL,'accountNumberMasked',NULL,'country',NULL,'currency',NULL,
        'nameReviewRequired',false,'nameReviewReason',NULL)
    ))
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_3872_my_earnings_summary() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_my_earnings_summary() TO authenticated, service_role;

COMMIT;
