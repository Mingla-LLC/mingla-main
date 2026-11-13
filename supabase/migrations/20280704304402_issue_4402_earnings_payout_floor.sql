-- #4402 polish PR, migration M4: explain money held below the payout floor.
--
-- WHY (spec comment 6855228971 on #4402, item 31): a creator with NGN 100
-- earned saw it as "on the way" forever, because payouts only go out once a
-- currency reaches its payout floor (payee_payout_currency_floors, e.g.
-- NGN 1,000) and that table is service-role only, so the app could not say
-- so. Both earnings reads (creator_earnings_summary for Creator Earnings and
-- issue_3872_my_earnings_summary for the referral wallet) now return
-- held_below_floor: one row per currency where the caller's accumulating
-- shares are above zero, with the floor read from the table (never
-- hard-coded). The floors and the payout sweep are unchanged.
--
-- Every replaced function is copied from the production body and changed only
-- as the spec says.
-- Proof: __tests__/issue_4402_polish_earnings_payout_floor.implementor.pg17.test.sql
BEGIN;
SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION public.issue_4402_held_below_floor(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- Invariant (declared in its test): I-4402-FLOOR-1 | issue #4402 | the payout floor shown to a creator is read from payee_payout_currency_floors, per currency
  SELECT coalesce(jsonb_agg(jsonb_build_object('currency',h.currency,'held_minor',h.held_minor,'floor_minor',f.floor_minor) ORDER BY h.currency),'[]'::jsonb)
  FROM (
    SELECT upper(s.currency) AS currency,sum(greatest(s.net_minor-s.reversed_minor,0))::bigint AS held_minor
    FROM public.payee_shares s
    WHERE s.payee_user_id=p_user_id AND s.status='accumulating'
    GROUP BY upper(s.currency)
    HAVING sum(greatest(s.net_minor-s.reversed_minor,0))>0
  ) h
  JOIN public.payee_payout_currency_floors f ON upper(f.currency)=h.currency
$function$;
REVOKE ALL ON FUNCTION public.issue_4402_held_below_floor(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4402_held_below_floor(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.creator_earnings_summary()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_actor uuid:=auth.uid(); v_rows jsonb; v_currency text;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='28000'; END IF;
  WITH rows AS (
    -- Ledger shares: never "paid" before the provider says so.
    SELECT CASE s.payee_kind WHEN 'gig_fee' THEN 'gig' WHEN 'local_month' THEN 'local' ELSE 'referral' END AS kind,
      CASE s.payee_kind
        WHEN 'gig_fee' THEN coalesce(g.title_public,'Creator gig')
        WHEN 'local_month' THEN 'Mingla Local · '||to_char(lm.month,'Mon YYYY')
        ELSE coalesce(e.title,vl.name,b.name,'Referral reward') END AS title,
      greatest(s.net_minor-s.reversed_minor,0) AS amount_minor,s.currency,
      CASE WHEN s.status IN ('pending','held_until_event') THEN 'on_the_way'
           WHEN s.status='paid' THEN 'paid' ELSE 'ready' END AS state,
      coalesce(s.updated_at,s.created_at) AS at
    FROM public.payee_shares s
    LEFT JOIN public.gig_contracts gc ON s.payee_kind='gig_fee' AND gc.id=s.order_id
    LEFT JOIN public.gigs g ON g.id=gc.gig_id
    LEFT JOIN public.local_months lm ON s.payee_kind='local_month' AND lm.id=s.order_id
    LEFT JOIN public.orders o ON s.order_kind='ticket' AND o.id=s.order_id
    LEFT JOIN public.events e ON e.id=o.event_id
    LEFT JOIN public.venue_orders vo ON s.order_kind='venue_order' AND vo.id=s.order_id
    LEFT JOIN public.venue_listings vl ON vl.id=vo.venue_id
    LEFT JOIN public.brands b ON b.id=s.brand_id
    WHERE s.payee_user_id=v_actor AND s.status NOT IN ('reversed','unclaimed_expired') AND s.net_minor-s.reversed_minor>0
    UNION ALL
    -- Gig fee held while the work is in progress.
    SELECT 'gig',g.title_public,tv.fee_minor,tv.currency,'on_the_way',c.updated_at
    FROM public.gig_contracts c
    JOIN public.gigs g ON g.id=c.gig_id
    JOIN public.gig_terms_versions tv ON tv.contract_id=c.id AND tv.version=c.current_terms_version
    JOIN public.gig_holds h ON h.contract_id=c.id AND h.terms_version=c.current_terms_version AND h.status='captured'
    WHERE c.creator_account_id=v_actor
      AND c.state IN ('accepted','shoot_planned','script_drafting','script_sent','script_locked','delivered','fix_requested','approved','posting','posts_submitted','posts_failed','posts_verified','disputed')
      AND NOT EXISTS(SELECT 1 FROM public.payee_shares x WHERE x.order_kind='gig' AND x.order_id=c.id)
    UNION ALL
    -- Local month approved but not yet in the ledger.
    SELECT 'local','Mingla Local · '||to_char(m.month,'Mon YYYY'),cp.monthly_rate_minor,cp.payout_currency,'on_the_way',coalesce(m.approved_at,m.updated_at)
    FROM public.local_months m
    JOIN public.locals l ON l.id=m.local_id
    JOIN public.local_city_programs cp ON cp.city_id=l.city_id
    WHERE l.user_id=v_actor AND m.status IN ('approved','published') AND m.payee_share_id IS NULL
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('kind',kind,'title',title,'amount_minor',amount_minor,'currency',currency,'state',state,'at',at) ORDER BY at DESC),'[]'::jsonb),
    (SELECT r.currency FROM rows r GROUP BY r.currency ORDER BY sum(r.amount_minor) DESC,r.currency LIMIT 1)
  INTO v_rows,v_currency FROM rows;
  v_currency:=coalesce(v_currency,(SELECT upper(p.currency) FROM public.profiles p WHERE p.id=v_actor),'USD');
  -- Totals are in the main currency only; rows keep their own currency.
  RETURN jsonb_build_object(
    'currency',v_currency,
    'on_the_way_minor',coalesce((SELECT sum((r->>'amount_minor')::bigint) FROM jsonb_array_elements(v_rows) r WHERE r->>'currency'=v_currency AND r->>'state'='on_the_way'),0),
    'ready_minor',coalesce((SELECT sum((r->>'amount_minor')::bigint) FROM jsonb_array_elements(v_rows) r WHERE r->>'currency'=v_currency AND r->>'state'='ready'),0),
    'paid_minor',coalesce((SELECT sum((r->>'amount_minor')::bigint) FROM jsonb_array_elements(v_rows) r WHERE r->>'currency'=v_currency AND r->>'state'='paid'),0),
    'rows',v_rows,
    -- #4402 item 31: what is waiting for the payout floor, per currency.
    'held_below_floor',public.issue_4402_held_below_floor(v_actor)
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.creator_earnings_summary() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.creator_earnings_summary() TO authenticated, service_role;

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
      'country',paystack_country,'currency',paystack_currency
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
        'bankName',NULL,'accountNumberMasked',NULL,'country',NULL,'currency',NULL)
    ))
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_3872_my_earnings_summary() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_my_earnings_summary() TO authenticated, service_role;

COMMIT;
