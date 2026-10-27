-- #4037: expose ledger-wide lifetime buyer payments, less refunds, by currency.
-- The payout ledger already has one row per (source_type, source_id), so this
-- covers every paid offering kind admitted by attach_payout_release without
-- creating a second sales authority.

CREATE OR REPLACE FUNCTION public.brand_get_payout_screen(p_brand_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp
AS $fn$
DECLARE
  v_paused boolean;v_currency text;v_releases jsonb;
  v_lifetime_sales jsonb;
  v_sales_week bigint;v_coming bigint;v_paid_month bigint;
BEGIN
  IF auth.uid() IS NULL OR p_brand_id IS NULL
     OR NOT public.biz_can_view_payments_for_brand(p_brand_id,auth.uid()) THEN
    RAISE EXCEPTION 'insufficient_finance_permission' USING ERRCODE='42501';
  END IF;
  v_paused:=EXISTS(SELECT 1 FROM public.brand_payout_admin_holds h WHERE h.brand_id=p_brand_id);
  SELECT r.currency INTO v_currency FROM public.brand_payout_releases r
   WHERE r.brand_id=p_brand_id AND r.status NOT IN ('cancelled_event','failed')
   ORDER BY r.created_at DESC,r.id LIMIT 1;
  IF v_currency IS NULL THEN
    SELECT lower(b.default_currency) INTO v_currency FROM public.brands b WHERE b.id=p_brand_id;
  END IF;

  WITH rows AS (
    SELECT r.*,
      public.payout_screen_host_state(r.status,r.error_message,r.releasable_at,v_paused,now()) host_state,
      COALESCE(e.title,CASE r.surface WHEN 'rsvp_contribution' THEN 'Chip-ins'
        WHEN 'venue_reservation' THEN 'Bookings' ELSE 'Ticket sales' END) offering_name,
      COALESCE(items.sales_count,0) sales_count,items.last_sale_at,
      COALESCE(items.discount_cents,0) discount_cents,
      COALESCE(items.items,'[]'::jsonb) items,
      COALESCE(credits.transfer_fee_credit_cents,0) transfer_fee_credit_cents,
      COALESCE(leg_fees.transfer_fee_cents,0) transfer_fee_cents,
      COALESCE(leg_fees.stamp_duty_cents,0) stamp_duty_cents,
      CASE WHEN r.provider='paystack' THEN recipient.account_number_masked ELSE stripe_bank.bank_mask END bank_mask
    FROM public.brand_payout_releases r
    LEFT JOIN public.events e ON e.id=r.event_id
    LEFT JOIN LATERAL (
      SELECT count(*)::integer sales_count,max(i.source_finalized_at) last_sale_at,
        COALESCE(sum(CASE i.source_type
          WHEN 'order' THEN COALESCE((SELECT o.discount_cents FROM public.orders o WHERE o.id=i.source_id),0)
          WHEN 'venue_menu_order' THEN COALESCE((SELECT v.discount_cents FROM public.venue_orders v WHERE v.id=i.source_id),0)
          WHEN 'venue_reservation' THEN COALESCE((SELECT s.discount_cents FROM public.reservation_checkout_sessions s WHERE s.id=i.source_id),0)
          ELSE 0 END),0)::bigint discount_cents,
        jsonb_agg(jsonb_build_object(
          'source_type',i.source_type,'source_id',i.source_id,'gross_cents',i.gross_cents,
          'refunded_cents',i.refunded_cents,'disputed_cents',i.disputed_cents,
          'mingla_fee_cents',i.mingla_fee_cents,'net_cents',i.net_cents,
          'discount_cents',CASE i.source_type
            WHEN 'order' THEN COALESCE((SELECT o.discount_cents FROM public.orders o WHERE o.id=i.source_id),0)
            WHEN 'venue_menu_order' THEN COALESCE((SELECT v.discount_cents FROM public.venue_orders v WHERE v.id=i.source_id),0)
            WHEN 'venue_reservation' THEN COALESCE((SELECT s.discount_cents FROM public.reservation_checkout_sessions s WHERE s.id=i.source_id),0)
            ELSE 0 END,
          'paid_at',i.source_finalized_at
        ) ORDER BY i.source_finalized_at DESC,i.id) items
      FROM public.payout_release_items i WHERE i.release_id=r.id
    ) items ON true
    LEFT JOIN LATERAL (
      SELECT COALESCE(sum(a.amount_cents),0)::bigint transfer_fee_credit_cents
      FROM public.payout_ledger_adjustments a WHERE a.release_id=r.id AND a.kind='transfer_fee_credit'
    ) credits ON true
    LEFT JOIN LATERAL (
      SELECT COALESCE(sum(l.estimated_fee_cents),0)::bigint transfer_fee_cents,
        COALESCE(sum(l.stamp_duty_cents),0)::bigint stamp_duty_cents
      FROM public.payout_transfer_legs l WHERE l.release_id=r.id AND l.kind='organiser'
    ) leg_fees ON true
    LEFT JOIN LATERAL (
      SELECT pr.account_number_masked FROM public.brand_paystack_recipients pr
      WHERE pr.brand_id=r.brand_id AND pr.is_active LIMIT 1
    ) recipient ON true
    LEFT JOIN LATERAL (
      SELECT CASE WHEN ea.last4 IS NULL THEN NULL ELSE '••••'||ea.last4 END bank_mask
      FROM public.stripe_external_accounts ea WHERE ea.brand_id=r.brand_id AND ea.status<>'removed'
      ORDER BY ea.default_for_currency DESC,ea.updated_at DESC LIMIT 1
    ) stripe_bank ON true
    WHERE r.brand_id=p_brand_id AND (v_currency IS NULL OR r.currency=v_currency)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',id,'event_id',event_id,'offering_name',offering_name,'provider',provider,
    'currency',currency,'ledger_status',status,'host_state',host_state,'due_at',releasable_at,
    'released_at',released_at,'gross_cents',gross_cents,'discount_cents',discount_cents,
    'refunded_cents',refunded_cents,'disputed_cents',disputed_cents,'mingla_fee_cents',mingla_fee_cents,
    'partner_share_cents',partner_share_cents,'permanent_debt_withheld_cents',permanent_debt_withheld_cents,
    'temporary_debt_withheld_cents',temporary_debt_withheld_cents,'maturity_recredit_cents',maturity_recredit_cents,
    'net_release_cents',net_release_cents,'cash_to_bank_cents',organiser_cash_delivered_cents,
    'transfer_fee_credit_cents',transfer_fee_credit_cents,'transfer_fee_cents',transfer_fee_cents,
    'stamp_duty_cents',stamp_duty_cents,'sales_count',sales_count,'last_sale_at',last_sale_at,
    'bank_mask',bank_mask,'older_pricing',gross_cents>0 AND mingla_fee_cents::numeric/gross_cents::numeric<0.03,
    'items',items
  ) ORDER BY releasable_at DESC,id),'[]'::jsonb) INTO v_releases FROM rows;

  SELECT COALESCE(jsonb_object_agg(t.currency,t.lifetime_cents ORDER BY t.currency),'{}'::jsonb)
    INTO v_lifetime_sales
  FROM (
    SELECT upper(r.currency) currency,
      COALESCE(sum(i.gross_cents::bigint-i.refunded_cents::bigint),0)::bigint lifetime_cents
    FROM public.payout_release_items i
    JOIN public.brand_payout_releases r ON r.id=i.release_id
    WHERE r.brand_id=p_brand_id
    GROUP BY upper(r.currency)
  ) t;
  SELECT COALESCE(sum(i.gross_cents),0)::bigint INTO v_sales_week
  FROM public.payout_release_items i JOIN public.brand_payout_releases r ON r.id=i.release_id
  WHERE r.brand_id=p_brand_id AND (v_currency IS NULL OR r.currency=v_currency)
    AND i.source_finalized_at>=date_trunc('week',now());
  SELECT COALESCE(sum(CASE WHEN r.status NOT IN ('released','cancelled_event') THEN greatest(r.net_release_cents,0) ELSE 0 END),0)::bigint,
    COALESCE(sum(CASE WHEN r.status='released' AND r.released_at>=date_trunc('month',now()) THEN r.organiser_cash_delivered_cents ELSE 0 END),0)::bigint
    INTO v_coming,v_paid_month FROM public.brand_payout_releases r
    WHERE r.brand_id=p_brand_id AND (v_currency IS NULL OR r.currency=v_currency);
  RETURN jsonb_build_object('currency',v_currency,'payouts_paused',v_paused,
    'lifetime_sales_cents',v_lifetime_sales,
    'sales_this_week_cents',v_sales_week,'coming_to_you_cents',v_coming,
    'paid_this_month_cents',v_paid_month,'releases',v_releases);
END;
$fn$;

REVOKE ALL ON FUNCTION public.brand_get_payout_screen(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.brand_get_payout_screen(uuid) TO authenticated;
