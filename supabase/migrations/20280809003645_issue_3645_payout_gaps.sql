-- Issue #3645 — payout gaps (instalments, stays, hosted chip-ins).
--
--   §1 Collected instalments enter the payout ledger on both rails:
--      issue_2036_installment_payout_ready() is switched on. A Paystack
--      instalment carries Mingla's fee and the verified Paystack fee on its
--      row at sale; a Stripe instalment carries Mingla's fee and waits for the
--      sweep to snapshot Stripe's fee from its charge (the webhook recorded 0,
--      which would have left legacy-account releases short by the fee).
--   §2 list_missing_payout_source_fees lists Stripe instalments and limits
--      each source family separately, so one family's failing backlog cannot
--      starve the others.
--   §3 The dark sweep's instalment arm (and the float forecast's copy of it)
--      takes a Stripe instalment's provider fee from its snapshot and waits
--      for it.
--   §4 list_missing_stay_provider_fees gives a Paystack stay its transaction
--      reference (it gave Paystack's numeric id, which verify cannot read).
--      The sweep now reads this family (it never did, so no stay ever got a
--      fee snapshot and run_stay_payout_release_dark_sweep attached nothing).
--   §5 A replayed finalize on a paid Stripe chip-in back-fills a missing
--      charge reference.
--
-- Every re-emitted function is its latest definition with only the hunks in
-- __tests__/issue_3645_payout_gaps_reemit_hunks.ts (structural test).

BEGIN;

-- §1 ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_2036_installment_payout_ready()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- issue #3645: fee, refund and dispute depth is proven on both rails.
  SELECT true;
$$;

REVOKE ALL ON FUNCTION public.issue_2036_installment_payout_ready()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_2036_installment_payout_ready()
  TO service_role;
COMMENT ON FUNCTION public.issue_2036_installment_payout_ready() IS
  'Issue #3645 / #2036: true. run_payout_release_dark_sweep attaches collected order_installments (fees on the row; Stripe also waits for its fee snapshot). Switch off with a follow-up migration only.';

-- §2 ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_missing_payout_source_fees(
  p_limit integer DEFAULT 100
) RETURNS TABLE(
  source_type text, source_id uuid, provider text, provider_reference text,
  stripe_account_id text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  -- issue #3645: the limit applies per source family, so a backlog in one
  -- family (fees that keep failing) never starves the others.
  SELECT ranked.source_type, ranked.source_id, ranked.provider,
    ranked.provider_reference, ranked.stripe_account_id
  FROM (
  SELECT q.*, row_number() OVER (
      PARTITION BY q.source_type ORDER BY q.source_id
    ) AS family_rank
  FROM (
    SELECT 'order'::text AS source_type, o.id AS source_id,
      b.payment_provider AS provider,
      CASE WHEN b.payment_provider = 'paystack' THEN o.stripe_payment_intent_id
           ELSE coalesce(o.stripe_charge_id, o.stripe_payment_intent_id) END
        AS provider_reference,
      CASE WHEN b.payment_provider = 'stripe' THEN b.stripe_connect_id ELSE NULL END
        AS stripe_account_id
    FROM public.orders o
    JOIN public.events e ON e.id = o.event_id
    JOIN public.brands b ON b.id = e.brand_id
    WHERE o.payment_status IN ('paid','partial_refund')
      AND o.total_cents > 0
      AND coalesce(o.source, 'online_checkout') <> 'door_sale'
      AND b.payout_hold_cutover_at IS NOT NULL
      AND o.created_at > b.payout_hold_cutover_at
    UNION ALL
    SELECT 'rsvp_contribution', c.id, c.provider,
      CASE WHEN c.provider = 'paystack' THEN c.stripe_payment_intent_id
           ELSE coalesce(c.stripe_charge_id, c.stripe_payment_intent_id) END,
      CASE WHEN c.provider = 'stripe' THEN b.stripe_connect_id ELSE NULL END
    FROM public.event_rsvp_contributions c
    JOIN public.brands b ON b.id = c.brand_id
    WHERE c.status IN ('paid','partially_refunded')
      AND b.payout_hold_cutover_at IS NOT NULL
      AND coalesce(c.paid_at, c.created_at) > b.payout_hold_cutover_at
    UNION ALL
    SELECT 'venue_reservation', s.id, b.payment_provider,
      CASE WHEN b.payment_provider = 'paystack' THEN s.paystack_reference
           ELSE s.stripe_payment_intent_id END,
      CASE WHEN b.payment_provider = 'stripe' THEN s.stripe_account_id ELSE NULL END
    FROM public.reservation_checkout_sessions s
    JOIN public.reservations r ON r.id = s.reservation_id
    JOIN public.brands b ON b.id = s.brand_id
    WHERE s.status = 'completed' AND s.amount_cents > 0
      AND b.payout_hold_cutover_at IS NOT NULL
      AND r.created_at > b.payout_hold_cutover_at
    UNION ALL
    SELECT 'venue_menu_order', vo.id, vo.provider,
      CASE WHEN vo.provider = 'paystack' THEN vo.paystack_reference
           ELSE coalesce(vo.stripe_charge_id, vo.stripe_payment_intent_id) END,
      CASE WHEN vo.provider = 'stripe' THEN vo.stripe_account_id ELSE NULL END
    FROM public.venue_orders vo
    JOIN public.brands b ON b.id = vo.brand_id
    WHERE vo.money_path = 'mingla'
      AND vo.payment_status IN ('paid','partial_refund')
      AND vo.total_cents > 0
      AND b.payout_hold_cutover_at IS NOT NULL
      AND vo.created_at > b.payout_hold_cutover_at
    UNION ALL
    -- issue #3645: a collected Stripe instalment's fee comes from its charge
    -- (the webhook records only Mingla's fee). Paystack instalments record the
    -- verified transaction fee at sale, so they are not candidates.
    SELECT 'order_installment', oi.id, oi.provider,
      coalesce(oi.stripe_charge_id, oi.stripe_payment_intent_id),
      b.stripe_connect_id
    FROM public.order_installments oi
    JOIN public.orders o ON o.id = oi.order_id
    JOIN public.events e ON e.id = o.event_id
    JOIN public.brands b ON b.id = e.brand_id
    WHERE oi.provider = 'stripe'
      AND oi.status = 'collected'
      AND oi.collected_at IS NOT NULL
      AND oi.amount_cents > 0
      AND b.payout_hold_cutover_at IS NOT NULL
      AND oi.collected_at > b.payout_hold_cutover_at
  ) q
  WHERE q.provider_reference IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.payout_source_fee_snapshots f
       WHERE f.source_type = q.source_type AND f.source_id = q.source_id
    )
  ) ranked
  WHERE ranked.family_rank <= greatest(1, least(p_limit, 500))
  ORDER BY ranked.source_type, ranked.source_id;
$function$;

REVOKE ALL ON FUNCTION public.list_missing_payout_source_fees(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_missing_payout_source_fees(integer)
  TO service_role;

-- §3 ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.run_payout_release_dark_sweep(p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_row record; v_release_id uuid; v_created integer:=0; v_matured integer;
  v_opened integer; v_refreshed jsonb;
BEGIN
  v_refreshed:=public.refresh_pending_payout_release_truth(p_now);
  v_opened:=public.sync_post_release_postponement_debts(p_now);
  v_matured:=public.mature_postponement_debts(p_now);
  FOR v_row IN
    WITH candidates AS (
      SELECT 'order'::text source_type,o.id source_id,e.brand_id,o.event_id,
        occ.event_date_id,b.payment_provider provider,lower(o.currency::text) currency,
        -- Issue #3872 (F10): gross is what the provider charged (buyer_total_cents);
        -- orders.total_cents is the ticket base on Stripe paths.
        o.created_at finalized_at,occ.end_at anchor_end_at,
        coalesce(o.buyer_total_cents,o.total_cents)::int gross_cents,
        o.refunded_amount_cents refunded_cents,
        coalesce((SELECT sum(d.amount)::int FROM public.stripe_disputes d
          WHERE d.order_id=o.id AND d.status NOT IN ('won','warning_closed')),0) disputed_cents,
        -- Issue #3872: only the fee Mingla kept. A refund with
        -- refund_application_fee returns part of the fee to the host's balance.
        greatest(0,coalesce(o.stripe_application_fee_amount_cents,0)-coalesce((
          SELECT sum(rf.application_fee_refunded_cents)::int FROM public.refunds rf
          WHERE rf.order_id=o.id AND rf.status='succeeded'
            AND rf.application_fee_refund_status='succeeded_positive'
        ),0)) mingla_fee_cents,
        coalesce((SELECT sum(ps.partner_share_cents)::int FROM public.partner_splits ps
          WHERE ps.order_id=o.id),0) partner_share_cents,
        (fs.provider_fee_cents-coalesce(fc.application_fee_cents,0)) provider_fee_cents,occ.event_date_id::text occurrence_key
      FROM public.orders o JOIN public.events e ON e.id=o.event_id
      JOIN public.brands b ON b.id=e.brand_id
      JOIN LATERAL public.resolve_payout_live_occurrence(
        o.event_id,o.event_date_id,o.created_at
      ) occ ON true
      JOIN public.payout_source_fee_snapshots fs
        ON fs.source_type='order' AND fs.source_id=o.id
      -- Issue #3872 §9: pre-#3872 Stripe snapshots included Mingla's fee.
      LEFT JOIN public.issue_3872_fee_snapshot_corrections fc ON fc.snapshot_id=fs.id
      WHERE o.payment_status IN ('paid','partial_refund')
        AND o.total_cents>0 AND b.payout_hold_cutover_at IS NOT NULL
        AND o.created_at>b.payout_hold_cutover_at AND e.status<>'cancelled'
      UNION ALL
      SELECT 'rsvp_contribution',c.id,e.brand_id,c.event_id,occ.event_date_id,c.provider,
        lower(c.currency),coalesce(c.paid_at,c.created_at),occ.end_at,
        c.buyer_total_cents,
        greatest(c.refunded_amount_cents,coalesce((
          SELECT sum(sr.buyer_refund_processed_cents)::integer
          FROM public.source_refunds sr
          WHERE sr.source_type='rsvp_contribution' AND sr.source_id=c.id
            AND sr.buyer_state='processed'
        ),0)),0,
        greatest(0,coalesce(c.application_fee_amount_cents,0)-coalesce((
          SELECT sum(sr.fee_reversal_processed_cents)::integer
          FROM public.source_refunds sr
          WHERE sr.source_type='rsvp_contribution' AND sr.source_id=c.id
            AND sr.fee_state='processed'
        ),0)),0,(fs.provider_fee_cents-coalesce(fc.application_fee_cents,0)),
        occ.event_date_id::text
      FROM public.event_rsvp_contributions c JOIN public.events e ON e.id=c.event_id
      JOIN public.brands b ON b.id=c.brand_id
      JOIN LATERAL public.resolve_payout_live_occurrence(
        c.event_id,NULL,coalesce(c.paid_at,c.created_at)
      ) occ ON true
      JOIN public.payout_source_fee_snapshots fs
        ON fs.source_type='rsvp_contribution' AND fs.source_id=c.id
      -- Issue #3872 §9: pre-#3872 Stripe snapshots included Mingla's fee.
      LEFT JOIN public.issue_3872_fee_snapshot_corrections fc ON fc.snapshot_id=fs.id
      WHERE c.status IN ('paid','partially_refunded') AND b.payout_hold_cutover_at IS NOT NULL
        AND coalesce(c.paid_at,c.created_at)>b.payout_hold_cutover_at AND e.status<>'cancelled'
        AND NOT EXISTS (
          SELECT 1 FROM public.source_refunds sr
          WHERE sr.source_type='rsvp_contribution' AND sr.source_id=c.id
            AND sr.financial_state<>'reconciled'
        )
      UNION ALL
      SELECT 'venue_reservation',s.id,s.brand_id,NULL::uuid,NULL::uuid,b.payment_provider,
        lower(s.currency::text),r.created_at,s.reserved_for,s.amount_cents,
        coalesce((
          SELECT sum(sr.buyer_refund_processed_cents)::integer
          FROM public.source_refunds sr
          WHERE sr.source_type='venue_reservation' AND sr.source_id=s.id
            AND sr.buyer_state='processed'
        ),0),0,
        -- Issue #3872: the deposit pays Mingla an application fee; deduct what
        -- Mingla kept (this arm used to deduct 0 and over-release by the fee).
        greatest(0,coalesce(s.application_fee_amount_cents,0)-coalesce((
          SELECT sum(sr.fee_reversal_processed_cents)::integer
          FROM public.source_refunds sr
          WHERE sr.source_type='venue_reservation' AND sr.source_id=s.id
            AND sr.fee_state='processed'
        ),0)),0,(fs.provider_fee_cents-coalesce(fc.application_fee_cents,0)),'reservation:'||s.id::text
      FROM public.reservation_checkout_sessions s
      JOIN public.reservations r ON r.id=s.reservation_id
      JOIN public.brands b ON b.id=s.brand_id
      JOIN public.payout_source_fee_snapshots fs
        ON fs.source_type='venue_reservation' AND fs.source_id=s.id
      -- Issue #3872 §9: pre-#3872 Stripe snapshots included Mingla's fee.
      LEFT JOIN public.issue_3872_fee_snapshot_corrections fc ON fc.snapshot_id=fs.id
      WHERE s.status='completed' AND s.amount_cents>0 AND b.payout_hold_cutover_at IS NOT NULL
        AND r.created_at>b.payout_hold_cutover_at
        AND NOT EXISTS (
          SELECT 1 FROM public.source_refunds sr
          WHERE sr.source_type='venue_reservation' AND sr.source_id=s.id
            AND sr.financial_state<>'reconciled'
        )
      UNION ALL
      SELECT 'venue_menu_order',vo.id,vo.brand_id,NULL::uuid,NULL::uuid,b.payment_provider,
        lower(vo.currency),vo.confirmed_at,vo.created_at,vo.total_cents,
        coalesce((
          SELECT sum(sr.buyer_refund_processed_cents)::integer
          FROM public.source_refunds sr
          WHERE sr.source_type='venue_menu_order' AND sr.source_id=vo.id
            AND sr.buyer_state='processed'
        ),0),
        coalesce((SELECT sum(d.amount)::int FROM public.stripe_disputes d
          WHERE d.venue_order_id=vo.id AND d.status NOT IN ('won','warning_closed')),0),
        -- #3645 flat 4.5%: Mingla take = mingla_fee + platform_service_fee
        -- (equals application_fee_amount at charge). Fee reversals reduce it.
        greatest(0,coalesce(vo.mingla_fee_cents,0)+coalesce(vo.platform_service_fee_cents,0)-coalesce((
          SELECT sum(sr.fee_reversal_processed_cents)::integer
          FROM public.source_refunds sr
          WHERE sr.source_type='venue_menu_order' AND sr.source_id=vo.id
            AND sr.fee_state='processed'
        ),0)),
        0,
        (fs.provider_fee_cents-coalesce(fc.application_fee_cents,0)),'venue_order:'||vo.id::text
      FROM public.venue_orders vo
      JOIN public.brands b ON b.id=vo.brand_id
      JOIN public.payout_source_fee_snapshots fs
        ON fs.source_type='venue_menu_order' AND fs.source_id=vo.id
      -- Issue #3872 §9: pre-#3872 Stripe snapshots included Mingla's fee.
      LEFT JOIN public.issue_3872_fee_snapshot_corrections fc ON fc.snapshot_id=fs.id
      WHERE vo.money_path='mingla'
        AND vo.payment_status IN ('paid','partial_refund')
        AND vo.total_cents>0
        AND vo.confirmed_at IS NOT NULL
        AND b.payout_hold_cutover_at IS NOT NULL
        AND vo.created_at>b.payout_hold_cutover_at
        AND NOT EXISTS (
          SELECT 1 FROM public.source_refunds sr
          WHERE sr.source_type='venue_menu_order' AND sr.source_id=vo.id
            AND sr.financial_state<>'reconciled'
        )
      UNION ALL
      -- #3645 / #2036 — collected installment arm. Mingla's fee lives on the
      -- row. The provider fee is the row's on Paystack (the verified
      -- transaction fee) and the sweep's charge snapshot on Stripe, which this
      -- arm waits for. Gated by issue_2036_installment_payout_ready() (on since
      -- #3645). Skip cancelled events. Maturity = collected_at + 1 day.
      SELECT 'order_installment',oi.id,e.brand_id,o.event_id,occ.event_date_id,
        -- #3645: the instalment's own immutable provider; never derive from mutable brands.payment_provider.
        oi.provider,
        lower(oi.currency::text),oi.collected_at,oi.collected_at,
        coalesce(oi.buyer_total_cents,oi.amount_cents)::integer,oi.refunded_amount_cents::integer,
        coalesce((SELECT sum(d.amount)::int FROM public.stripe_disputes d
          WHERE oi.provider='stripe' AND d.stripe_charge_id=oi.stripe_charge_id
            AND d.status NOT IN ('won','warning_closed')),0)
        +coalesce((SELECT sum(pd.amount_cents)::int FROM public.paystack_disputes pd
          WHERE pd.order_installment_id=oi.id AND pd.is_resolved IS NOT TRUE),0),
        coalesce(oi.application_fee_amount_cents,0),0,
        CASE WHEN oi.provider='stripe' THEN ifs.provider_fee_cents
          ELSE coalesce(oi.provider_fee_cents,0) END,
        -- Unique per installment payment so a later installment never mutates
        -- an already-released release keyed by shared occurrence (#3645).
        'order_installment:' || oi.id::text
      FROM public.order_installments oi
      JOIN public.orders o ON o.id = oi.order_id
      JOIN public.events e ON e.id = o.event_id
      JOIN public.brands b ON b.id = e.brand_id
      JOIN LATERAL public.resolve_payout_live_occurrence(
        o.event_id,o.event_date_id,oi.collected_at
      ) occ ON true
      -- issue #3645: Stripe's fee, captured by the sweep from the charge.
      LEFT JOIN public.payout_source_fee_snapshots ifs
        ON ifs.source_type='order_installment' AND ifs.source_id=oi.id
      WHERE public.issue_2036_installment_payout_ready()
        AND oi.status = 'collected'
        AND oi.payout_accounting_state = 'ready'
        AND oi.collected_at IS NOT NULL
        AND oi.amount_cents > 0
        AND oi.application_fee_amount_cents IS NOT NULL
        AND (oi.provider<>'stripe' OR ifs.source_id IS NOT NULL)
        AND b.payout_hold_cutover_at IS NOT NULL
        AND oi.collected_at > b.payout_hold_cutover_at
        AND e.status <> 'cancelled'
    )
    -- Issue #3645: every sale becomes sweep-eligible about 24 hours after its
    -- payment, independent of the event or reservation date.
    SELECT * FROM candidates c
    WHERE c.finalized_at IS NOT NULL
      AND c.finalized_at + interval '1 day' <= p_now
      AND c.gross_cents-c.refunded_cents-c.disputed_cents>0
      AND NOT EXISTS (SELECT 1 FROM public.payout_release_items i
        WHERE i.source_type=c.source_type AND i.source_id=c.source_id)
    ORDER BY c.finalized_at,c.source_id
  LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended(v_row.source_type||':'||v_row.source_id::text,0)
    );
    IF v_row.source_type IN ('venue_reservation','rsvp_contribution','venue_menu_order') AND EXISTS (
      SELECT 1 FROM public.source_refunds sr
      WHERE sr.source_type=v_row.source_type AND sr.source_id=v_row.source_id
        AND sr.financial_state<>'reconciled'
    ) THEN CONTINUE; END IF;
    v_release_id:=public.attach_payout_release(
      v_row.source_type,v_row.source_id,v_row.brand_id,v_row.event_id,v_row.event_date_id,
      v_row.occurrence_key,v_row.provider,v_row.currency,v_row.finalized_at,v_row.anchor_end_at,
      v_row.gross_cents,v_row.refunded_cents,v_row.disputed_cents,v_row.mingla_fee_cents,
      v_row.partner_share_cents,v_row.provider_fee_cents
    );
    PERFORM public.apply_open_payout_debts(v_release_id,p_now);
    v_created:=v_created+1;
  END LOOP;
  RETURN jsonb_build_object(
    'dark',true,'attached',v_created,'opened_postponement_debts',v_opened,
    'matured_debts',v_matured,'refreshed',v_refreshed,'executed',0
  );
END $function$;

REVOKE ALL ON FUNCTION public.run_payout_release_dark_sweep(timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_payout_release_dark_sweep(timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_3645_unattached_payout_sources(
  p_mature_by timestamptz
) RETURNS TABLE (
  source_type text,
  source_id uuid,
  brand_id uuid,
  provider text,
  currency text,
  finalized_at timestamptz,
  net_cents bigint
)
LANGUAGE sql
STABLE
-- No SET clause on purpose: a set-returning SQL function with a SET clause is
-- never inlined, and inlining lets the caller's own filters (provider,
-- currency) reach each arm instead of materialising every candidate first.
-- The body is fully schema-qualified, and EXECUTE is service_role only.
AS $fn$
  -- issue #3645: the paid sales the two dark sweeps would attach once they
  -- mature by p_mature_by but have not attached yet, with the net
  -- attach_payout_release / issue_1389_attach_stay_payout_release would store.
  -- Both arms are the sweeps' own candidate text, copied verbatim with p_now
  -- renamed; issue_3645_unattached_sources_match_sweeps.structural.test.ts
  -- fails CI the moment either sweep's text changes without this function.
  SELECT
    sale.source_type, sale.source_id, sale.brand_id, sale.provider,
    sale.currency, sale.finalized_at,
    greatest(0, sale.gross_cents::bigint - sale.refunded_cents
      - sale.disputed_cents - sale.mingla_fee_cents)
  FROM (
    WITH candidates AS (
      SELECT 'order'::text source_type,o.id source_id,e.brand_id,o.event_id,
        occ.event_date_id,b.payment_provider provider,lower(o.currency::text) currency,
        -- Issue #3872 (F10): gross is what the provider charged (buyer_total_cents);
        -- orders.total_cents is the ticket base on Stripe paths.
        o.created_at finalized_at,occ.end_at anchor_end_at,
        coalesce(o.buyer_total_cents,o.total_cents)::int gross_cents,
        o.refunded_amount_cents refunded_cents,
        coalesce((SELECT sum(d.amount)::int FROM public.stripe_disputes d
          WHERE d.order_id=o.id AND d.status NOT IN ('won','warning_closed')),0) disputed_cents,
        -- Issue #3872: only the fee Mingla kept. A refund with
        -- refund_application_fee returns part of the fee to the host's balance.
        greatest(0,coalesce(o.stripe_application_fee_amount_cents,0)-coalesce((
          SELECT sum(rf.application_fee_refunded_cents)::int FROM public.refunds rf
          WHERE rf.order_id=o.id AND rf.status='succeeded'
            AND rf.application_fee_refund_status='succeeded_positive'
        ),0)) mingla_fee_cents,
        coalesce((SELECT sum(ps.partner_share_cents)::int FROM public.partner_splits ps
          WHERE ps.order_id=o.id),0) partner_share_cents,
        (fs.provider_fee_cents-coalesce(fc.application_fee_cents,0)) provider_fee_cents,occ.event_date_id::text occurrence_key
      FROM public.orders o JOIN public.events e ON e.id=o.event_id
      JOIN public.brands b ON b.id=e.brand_id
      JOIN LATERAL public.resolve_payout_live_occurrence(
        o.event_id,o.event_date_id,o.created_at
      ) occ ON true
      JOIN public.payout_source_fee_snapshots fs
        ON fs.source_type='order' AND fs.source_id=o.id
      -- Issue #3872 §9: pre-#3872 Stripe snapshots included Mingla's fee.
      LEFT JOIN public.issue_3872_fee_snapshot_corrections fc ON fc.snapshot_id=fs.id
      WHERE o.payment_status IN ('paid','partial_refund')
        AND o.total_cents>0 AND b.payout_hold_cutover_at IS NOT NULL
        AND o.created_at>b.payout_hold_cutover_at AND e.status<>'cancelled'
      UNION ALL
      SELECT 'rsvp_contribution',c.id,e.brand_id,c.event_id,occ.event_date_id,c.provider,
        lower(c.currency),coalesce(c.paid_at,c.created_at),occ.end_at,
        c.buyer_total_cents,
        greatest(c.refunded_amount_cents,coalesce((
          SELECT sum(sr.buyer_refund_processed_cents)::integer
          FROM public.source_refunds sr
          WHERE sr.source_type='rsvp_contribution' AND sr.source_id=c.id
            AND sr.buyer_state='processed'
        ),0)),0,
        greatest(0,coalesce(c.application_fee_amount_cents,0)-coalesce((
          SELECT sum(sr.fee_reversal_processed_cents)::integer
          FROM public.source_refunds sr
          WHERE sr.source_type='rsvp_contribution' AND sr.source_id=c.id
            AND sr.fee_state='processed'
        ),0)),0,(fs.provider_fee_cents-coalesce(fc.application_fee_cents,0)),
        occ.event_date_id::text
      FROM public.event_rsvp_contributions c JOIN public.events e ON e.id=c.event_id
      JOIN public.brands b ON b.id=c.brand_id
      JOIN LATERAL public.resolve_payout_live_occurrence(
        c.event_id,NULL,coalesce(c.paid_at,c.created_at)
      ) occ ON true
      JOIN public.payout_source_fee_snapshots fs
        ON fs.source_type='rsvp_contribution' AND fs.source_id=c.id
      -- Issue #3872 §9: pre-#3872 Stripe snapshots included Mingla's fee.
      LEFT JOIN public.issue_3872_fee_snapshot_corrections fc ON fc.snapshot_id=fs.id
      WHERE c.status IN ('paid','partially_refunded') AND b.payout_hold_cutover_at IS NOT NULL
        AND coalesce(c.paid_at,c.created_at)>b.payout_hold_cutover_at AND e.status<>'cancelled'
        AND NOT EXISTS (
          SELECT 1 FROM public.source_refunds sr
          WHERE sr.source_type='rsvp_contribution' AND sr.source_id=c.id
            AND sr.financial_state<>'reconciled'
        )
      UNION ALL
      SELECT 'venue_reservation',s.id,s.brand_id,NULL::uuid,NULL::uuid,b.payment_provider,
        lower(s.currency::text),r.created_at,s.reserved_for,s.amount_cents,
        coalesce((
          SELECT sum(sr.buyer_refund_processed_cents)::integer
          FROM public.source_refunds sr
          WHERE sr.source_type='venue_reservation' AND sr.source_id=s.id
            AND sr.buyer_state='processed'
        ),0),0,
        -- Issue #3872: the deposit pays Mingla an application fee; deduct what
        -- Mingla kept (this arm used to deduct 0 and over-release by the fee).
        greatest(0,coalesce(s.application_fee_amount_cents,0)-coalesce((
          SELECT sum(sr.fee_reversal_processed_cents)::integer
          FROM public.source_refunds sr
          WHERE sr.source_type='venue_reservation' AND sr.source_id=s.id
            AND sr.fee_state='processed'
        ),0)),0,(fs.provider_fee_cents-coalesce(fc.application_fee_cents,0)),'reservation:'||s.id::text
      FROM public.reservation_checkout_sessions s
      JOIN public.reservations r ON r.id=s.reservation_id
      JOIN public.brands b ON b.id=s.brand_id
      JOIN public.payout_source_fee_snapshots fs
        ON fs.source_type='venue_reservation' AND fs.source_id=s.id
      -- Issue #3872 §9: pre-#3872 Stripe snapshots included Mingla's fee.
      LEFT JOIN public.issue_3872_fee_snapshot_corrections fc ON fc.snapshot_id=fs.id
      WHERE s.status='completed' AND s.amount_cents>0 AND b.payout_hold_cutover_at IS NOT NULL
        AND r.created_at>b.payout_hold_cutover_at
        AND NOT EXISTS (
          SELECT 1 FROM public.source_refunds sr
          WHERE sr.source_type='venue_reservation' AND sr.source_id=s.id
            AND sr.financial_state<>'reconciled'
        )
      UNION ALL
      SELECT 'venue_menu_order',vo.id,vo.brand_id,NULL::uuid,NULL::uuid,b.payment_provider,
        lower(vo.currency),vo.confirmed_at,vo.created_at,vo.total_cents,
        coalesce((
          SELECT sum(sr.buyer_refund_processed_cents)::integer
          FROM public.source_refunds sr
          WHERE sr.source_type='venue_menu_order' AND sr.source_id=vo.id
            AND sr.buyer_state='processed'
        ),0),
        coalesce((SELECT sum(d.amount)::int FROM public.stripe_disputes d
          WHERE d.venue_order_id=vo.id AND d.status NOT IN ('won','warning_closed')),0),
        -- #3645 flat 4.5%: Mingla take = mingla_fee + platform_service_fee
        -- (equals application_fee_amount at charge). Fee reversals reduce it.
        greatest(0,coalesce(vo.mingla_fee_cents,0)+coalesce(vo.platform_service_fee_cents,0)-coalesce((
          SELECT sum(sr.fee_reversal_processed_cents)::integer
          FROM public.source_refunds sr
          WHERE sr.source_type='venue_menu_order' AND sr.source_id=vo.id
            AND sr.fee_state='processed'
        ),0)),
        0,
        (fs.provider_fee_cents-coalesce(fc.application_fee_cents,0)),'venue_order:'||vo.id::text
      FROM public.venue_orders vo
      JOIN public.brands b ON b.id=vo.brand_id
      JOIN public.payout_source_fee_snapshots fs
        ON fs.source_type='venue_menu_order' AND fs.source_id=vo.id
      -- Issue #3872 §9: pre-#3872 Stripe snapshots included Mingla's fee.
      LEFT JOIN public.issue_3872_fee_snapshot_corrections fc ON fc.snapshot_id=fs.id
      WHERE vo.money_path='mingla'
        AND vo.payment_status IN ('paid','partial_refund')
        AND vo.total_cents>0
        AND vo.confirmed_at IS NOT NULL
        AND b.payout_hold_cutover_at IS NOT NULL
        AND vo.created_at>b.payout_hold_cutover_at
        AND NOT EXISTS (
          SELECT 1 FROM public.source_refunds sr
          WHERE sr.source_type='venue_menu_order' AND sr.source_id=vo.id
            AND sr.financial_state<>'reconciled'
        )
      UNION ALL
      -- #3645 / #2036 — collected installment arm. Mingla's fee lives on the
      -- row. The provider fee is the row's on Paystack (the verified
      -- transaction fee) and the sweep's charge snapshot on Stripe, which this
      -- arm waits for. Gated by issue_2036_installment_payout_ready() (on since
      -- #3645). Skip cancelled events. Maturity = collected_at + 1 day.
      SELECT 'order_installment',oi.id,e.brand_id,o.event_id,occ.event_date_id,
        -- #3645: the instalment's own immutable provider; never derive from mutable brands.payment_provider.
        oi.provider,
        lower(oi.currency::text),oi.collected_at,oi.collected_at,
        coalesce(oi.buyer_total_cents,oi.amount_cents)::integer,oi.refunded_amount_cents::integer,
        coalesce((SELECT sum(d.amount)::int FROM public.stripe_disputes d
          WHERE oi.provider='stripe' AND d.stripe_charge_id=oi.stripe_charge_id
            AND d.status NOT IN ('won','warning_closed')),0)
        +coalesce((SELECT sum(pd.amount_cents)::int FROM public.paystack_disputes pd
          WHERE pd.order_installment_id=oi.id AND pd.is_resolved IS NOT TRUE),0),
        coalesce(oi.application_fee_amount_cents,0),0,
        CASE WHEN oi.provider='stripe' THEN ifs.provider_fee_cents
          ELSE coalesce(oi.provider_fee_cents,0) END,
        -- Unique per installment payment so a later installment never mutates
        -- an already-released release keyed by shared occurrence (#3645).
        'order_installment:' || oi.id::text
      FROM public.order_installments oi
      JOIN public.orders o ON o.id = oi.order_id
      JOIN public.events e ON e.id = o.event_id
      JOIN public.brands b ON b.id = e.brand_id
      JOIN LATERAL public.resolve_payout_live_occurrence(
        o.event_id,o.event_date_id,oi.collected_at
      ) occ ON true
      -- issue #3645: Stripe's fee, captured by the sweep from the charge.
      LEFT JOIN public.payout_source_fee_snapshots ifs
        ON ifs.source_type='order_installment' AND ifs.source_id=oi.id
      WHERE public.issue_2036_installment_payout_ready()
        AND oi.status = 'collected'
        AND oi.payout_accounting_state = 'ready'
        AND oi.collected_at IS NOT NULL
        AND oi.amount_cents > 0
        AND oi.application_fee_amount_cents IS NOT NULL
        AND (oi.provider<>'stripe' OR ifs.source_id IS NOT NULL)
        AND b.payout_hold_cutover_at IS NOT NULL
        AND oi.collected_at > b.payout_hold_cutover_at
        AND e.status <> 'cancelled'
    )
    -- Issue #3645: every sale becomes sweep-eligible about 24 hours after its
    -- payment, independent of the event or reservation date.
    SELECT * FROM candidates c
    WHERE c.finalized_at IS NOT NULL
      AND c.finalized_at + interval '1 day' <= p_mature_by
      AND c.gross_cents-c.refunded_cents-c.disputed_cents>0
      AND NOT EXISTS (SELECT 1 FROM public.payout_release_items i
        WHERE i.source_type=c.source_type AND i.source_id=c.source_id)
  ) sale
  UNION ALL
  SELECT
    'stay_reservation'::text, stay.source_id, stay.brand_id, stay.provider,
    stay.currency, stay.finalized_at,
    greatest(0, stay.gross_cents::bigint - stay.refunded_cents
      - stay.mingla_fee_cents)
  FROM (
    SELECT
      line.id AS source_id,
      group_row.id AS group_id,
      group_row.brand_id,
      attempt.provider,
      lower(attempt.currency_code::text) AS currency,
      attempt.succeeded_at AS finalized_at,
      CASE line.kind
        WHEN 'room' THEN (
          line.room_check_out::timestamp + settings.check_out_time
        ) AT TIME ZONE settings.timezone
        ELSE place_window.ends_at
      END AS anchor_end_at,
      line.total_minor::integer AS gross_cents,
      COALESCE((
        SELECT sum(allocation.refunded_minor)::integer
        FROM public.stay_payment_allocations allocation
        WHERE allocation.payment_attempt_id = attempt.id
          AND allocation.reservation_line_id = line.id
      ), 0) AS refunded_cents,
      snapshot.platform_fee_minor AS mingla_fee_cents,
      snapshot.provider_fee_minor AS provider_fee_cents,
      'stay:' || group_row.id || ':' || line.id AS occurrence_key
    FROM public.stay_reservation_lines line
    JOIN public.stay_reservation_groups group_row
      ON group_row.id = line.group_id
    JOIN public.stay_payment_attempts attempt
      ON attempt.group_id = group_row.id
     AND attempt.state = 'succeeded'
    JOIN public.stay_payout_line_snapshots snapshot
      ON snapshot.reservation_line_id = line.id
     AND snapshot.payment_attempt_id = attempt.id
    JOIN public.stay_settings settings
      ON settings.venue_id = group_row.venue_id
    LEFT JOIN public.stay_place_windows place_window
      ON place_window.id = line.place_window_id
    JOIN public.brands brand ON brand.id = group_row.brand_id
    WHERE line.state = 'confirmed'
      AND attempt.succeeded_at > brand.payout_hold_cutover_at
      AND attempt.succeeded_at + interval '1 day' <= p_mature_by
      AND NOT EXISTS (
        SELECT 1
        FROM public.source_refunds source_refund
        WHERE source_refund.source_type = 'stay_reservation'
          AND source_refund.subject_id = group_row.id
          AND source_refund.financial_state <> 'reconciled'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.payout_release_items item
        WHERE item.source_type = 'stay_reservation'
          AND item.source_id = line.id
      )
  ) stay
$fn$;

REVOKE ALL ON FUNCTION public.issue_3645_unattached_payout_sources(timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3645_unattached_payout_sources(timestamptz)
  TO service_role;

-- §4 ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_missing_stay_provider_fees(
  p_limit integer DEFAULT 100
)
RETURNS TABLE(
  source_type text,
  source_id uuid,
  provider text,
  provider_reference text,
  stripe_account_id text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    'stay_reservation'::text,
    attempt.id,
    attempt.provider,
    -- issue #3645: Paystack verifies by the transaction REFERENCE; the charge
    -- ref stored for a Paystack stay is Paystack's numeric transaction id.
    CASE WHEN attempt.provider = 'paystack' THEN attempt.provider_payment_ref
      ELSE COALESCE(attempt.provider_charge_ref, attempt.provider_payment_ref)
    END,
    CASE WHEN attempt.provider = 'stripe'
      THEN attempt.connected_account_ref ELSE NULL END
  FROM public.stay_payment_attempts attempt
  JOIN public.stay_reservation_groups group_row
    ON group_row.id = attempt.group_id
  JOIN public.brands brand ON brand.id = group_row.brand_id
  WHERE attempt.state = 'succeeded'
    AND attempt.amount_minor > 0
    AND brand.payout_hold_cutover_at IS NOT NULL
    AND attempt.succeeded_at > brand.payout_hold_cutover_at
    AND COALESCE(attempt.provider_charge_ref, attempt.provider_payment_ref)
      IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.stay_payout_line_snapshots snapshot
      WHERE snapshot.payment_attempt_id = attempt.id
    )
  ORDER BY attempt.succeeded_at, attempt.id
  LIMIT greatest(1, least(p_limit, 500));
$function$;

REVOKE ALL ON FUNCTION public.list_missing_stay_provider_fees(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_missing_stay_provider_fees(integer)
  TO service_role;

-- §5 ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_1930_finalize_rsvp_contribution(
  p_contribution_id uuid,p_provider_ref text,p_charge_id text,p_payment_method_type text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_c public.event_rsvp_contributions%ROWTYPE; v_event public.events%ROWTYPE;
BEGIN
  SELECT e.* INTO v_event FROM public.event_rsvp_contributions c
    JOIN public.events e ON e.id=c.event_id WHERE c.id=p_contribution_id FOR UPDATE OF e;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','unavailable'); END IF;
  SELECT * INTO v_c FROM public.event_rsvp_contributions WHERE id=p_contribution_id FOR UPDATE;
  IF v_c.status='paid' THEN
    -- issue #3645: a hosted chip-in can be paid with only its Checkout Session
    -- id stored. A later delivery that carries the PaymentIntent or charge id
    -- fills it in so the payout sweep can read the fee. Nothing else about a
    -- paid row changes, and a stored charge reference is never replaced.
    IF v_c.provider='stripe' AND v_c.stripe_charge_id IS NULL
       AND (p_charge_id LIKE 'ch\_%' OR p_charge_id LIKE 'pi\_%') THEN
      UPDATE public.event_rsvp_contributions
         SET stripe_charge_id=p_charge_id, updated_at=now()
       WHERE id=p_contribution_id AND stripe_charge_id IS NULL;
    END IF;
    RETURN jsonb_build_object('outcome','finalized');
  END IF;
  IF public.issue_1930_event_sale_reason(v_event)<>'sellable'
     OR v_event.event_type<>'rsvp' OR NOT COALESCE(v_event.rsvp_contribution_enabled,false)
     OR v_c.revoked_at IS NOT NULL THEN
    PERFORM public.issue_1930_mint_rsvp_late_reversal(v_c.id,p_provider_ref);
    RETURN jsonb_build_object('outcome','paid_reversal_pending');
  END IF;
  PERFORM public.finalize_rsvp_contribution(
    p_contribution_id,p_provider_ref,p_charge_id,p_payment_method_type);
  RETURN jsonb_build_object('outcome','finalized');
END $$;

REVOKE ALL ON FUNCTION public.issue_1930_finalize_rsvp_contribution(uuid,text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1930_finalize_rsvp_contribution(uuid,text,text,text)
  TO service_role;

-- Apply-time guard: the switch is on and nothing became callable by clients.
DO $guard$
DECLARE
  v_fn text;
BEGIN
  IF public.issue_2036_installment_payout_ready() IS NOT TRUE THEN
    RAISE EXCEPTION 'issue-3645: issue_2036_installment_payout_ready must be true';
  END IF;
  FOREACH v_fn IN ARRAY ARRAY[
    'public.issue_2036_installment_payout_ready()',
    'public.list_missing_payout_source_fees(integer)',
    'public.run_payout_release_dark_sweep(timestamptz)',
    'public.issue_3645_unattached_payout_sources(timestamptz)',
    'public.list_missing_stay_provider_fees(integer)',
    'public.issue_1930_finalize_rsvp_contribution(uuid,text,text,text)'
  ] LOOP
    IF has_function_privilege('anon', v_fn, 'EXECUTE')
       OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'issue-3645: % is callable by anon/authenticated', v_fn;
    END IF;
    IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'issue-3645: service_role lost EXECUTE on %', v_fn;
    END IF;
  END LOOP;
END
$guard$;

COMMIT;

NOTIFY pgrst, 'reload schema';
