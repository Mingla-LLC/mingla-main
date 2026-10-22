-- #3645 venue menu release takes full 4.5% application fee
-- Charge paths set application_fee = mingla_fee + platform_service_fee.
-- Dark-sweep venue_menu_order arm previously subtracted only mingla_fee_cents,
-- over-releasing the service-fee slice to the host.
--
-- Also aligns Paystack dispute pending-item net with flat 4.5% host net
-- (no partner_share / provider_fee deduction from host).
--
-- Replaces run_payout_release_dark_sweep from
-- 20271210013645_issue_3645_payout_gate_payment_plus_24h.sql and
-- record_paystack_dispute_outcome from
-- 20270724003645_issue_3645_paystack_disputes.sql.

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
      -- #3645 / #2036 — collected installment arm. Fees live on the row
      -- (application_fee_amount_cents / provider_fee_cents). Gated by
      -- issue_2036_installment_payout_ready() (default false). Skip cancelled
      -- events. Maturity = collected_at + 1 day via attach (payment+24h).
      SELECT 'order_installment',oi.id,e.brand_id,o.event_id,occ.event_date_id,
        -- Installment PIs are Stripe-only; never derive from mutable brands.payment_provider.
        'stripe'::text,
        lower(oi.currency::text),oi.collected_at,oi.collected_at,
        oi.amount_cents::integer,0,0,
        coalesce(oi.application_fee_amount_cents,0),0,
        coalesce(oi.provider_fee_cents,0),
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
      WHERE public.issue_2036_installment_payout_ready()
        AND oi.status = 'collected'
        AND oi.payout_accounting_state = 'ready'
        AND oi.collected_at IS NOT NULL
        AND oi.amount_cents > 0
        AND oi.application_fee_amount_cents IS NOT NULL
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

CREATE OR REPLACE FUNCTION public.record_paystack_dispute_outcome(
  p_paystack_dispute_id text,
  p_transaction_reference text,
  p_event_name text,
  p_status text,
  p_resolution text,
  p_amount_cents integer,
  p_currency text,
  p_reason text DEFAULT NULL,
  p_due_at timestamptz DEFAULT NULL,
  p_raw jsonb DEFAULT '{}'::jsonb,
  p_now timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_ref text := nullif(btrim(p_transaction_reference), '');
  v_dispute_id text := nullif(btrim(p_paystack_dispute_id), '');
  v_currency text := lower(coalesce(nullif(btrim(p_currency), ''), 'ngn'));
  v_status text := coalesce(nullif(btrim(p_status), ''), 'pending');
  v_resolution text := nullif(btrim(p_resolution), '');
  v_event text := coalesce(nullif(btrim(p_event_name), ''), 'charge.dispute.create');
  v_amount integer := greatest(coalesce(p_amount_cents, 0), 0);
  v_order_id uuid;
  v_reservation_id uuid;
  v_contribution_id uuid;
  v_venue_order_id uuid;
  v_brand_id uuid;
  v_due timestamptz;
  v_row public.paystack_disputes%ROWTYPE;
  v_source_type text;
  v_source_id uuid;
  v_release public.brand_payout_releases%ROWTYPE;
  v_room integer;
  v_liability integer;
  v_target integer;
  v_debt_id uuid;
  v_debt public.organiser_payout_debts%ROWTYPE;
  v_temp public.organiser_payout_debts%ROWTYPE;
  v_adj_key text;
  v_merchant_lost boolean;
  v_merchant_won boolean;
  v_debt_created boolean := false;
  v_hold_cents integer;
  v_growth integer;
  v_overlap integer;
  v_recovered_overlap integer;
  v_left integer;
  v_take integer;
  v_app record;
BEGIN
  IF v_dispute_id IS NULL OR v_ref IS NULL THEN
    RAISE EXCEPTION 'invalid_paystack_dispute_outcome' USING ERRCODE = '22023';
  END IF;
  IF v_event NOT IN (
    'charge.dispute.create', 'charge.dispute.remind', 'charge.dispute.resolve'
  ) THEN
    RAISE EXCEPTION 'invalid_paystack_dispute_event' USING ERRCODE = '22023';
  END IF;

  -- Resolve subject in the same order as paystackWebhookRouter charge matching.
  SELECT o.id, e.brand_id INTO v_order_id, v_brand_id
  FROM public.orders o
  JOIN public.events e ON e.id = o.event_id
  WHERE o.stripe_payment_intent_id = v_ref
  LIMIT 1;
  IF v_order_id IS NULL THEN
    SELECT tcs.order_id, e.brand_id INTO v_order_id, v_brand_id
    FROM public.ticket_checkout_sessions tcs
    JOIN public.orders o ON o.id = tcs.order_id
    JOIN public.events e ON e.id = o.event_id
    WHERE tcs.stripe_payment_intent_id = v_ref
    LIMIT 1;
  END IF;
  IF v_order_id IS NULL THEN
    SELECT c.id, c.brand_id INTO v_contribution_id, v_brand_id
    FROM public.event_rsvp_contributions c
    WHERE c.stripe_payment_intent_id = v_ref
    LIMIT 1;
  END IF;
  IF v_order_id IS NULL AND v_contribution_id IS NULL THEN
    SELECT rcs.reservation_id, rcs.brand_id INTO v_reservation_id, v_brand_id
    FROM public.reservation_checkout_sessions rcs
    WHERE rcs.paystack_reference = v_ref
    LIMIT 1;
  END IF;
  IF v_order_id IS NULL AND v_contribution_id IS NULL AND v_reservation_id IS NULL THEN
    SELECT vo.id, vo.brand_id INTO v_venue_order_id, v_brand_id
    FROM public.venue_orders vo
    WHERE vo.paystack_reference = v_ref
    LIMIT 1;
  END IF;

  v_due := coalesce(p_due_at, p_now + interval '16 hours');

  INSERT INTO public.paystack_disputes(
    paystack_dispute_id, transaction_reference, brand_id, order_id,
    venue_reservation_id, rsvp_contribution_id, venue_menu_order_id,
    amount_cents, currency, status, resolution,
    reason, response_due_by, is_resolved, raw_event, created_at, updated_at
  ) VALUES (
    v_dispute_id, v_ref, v_brand_id, v_order_id, v_reservation_id,
    v_contribution_id, v_venue_order_id,
    v_amount, v_currency, v_status, v_resolution, nullif(btrim(p_reason), ''),
    v_due, v_event = 'charge.dispute.resolve', p_raw, p_now, p_now
  )
  ON CONFLICT (paystack_dispute_id) DO UPDATE SET
    transaction_reference = excluded.transaction_reference,
    brand_id = coalesce(public.paystack_disputes.brand_id, excluded.brand_id),
    order_id = coalesce(public.paystack_disputes.order_id, excluded.order_id),
    venue_reservation_id = coalesce(
      public.paystack_disputes.venue_reservation_id, excluded.venue_reservation_id
    ),
    rsvp_contribution_id = coalesce(
      public.paystack_disputes.rsvp_contribution_id, excluded.rsvp_contribution_id
    ),
    venue_menu_order_id = coalesce(
      public.paystack_disputes.venue_menu_order_id, excluded.venue_menu_order_id
    ),
    amount_cents = CASE
      WHEN excluded.amount_cents > 0 THEN excluded.amount_cents
      ELSE public.paystack_disputes.amount_cents
    END,
    currency = excluded.currency,
    status = excluded.status,
    resolution = coalesce(excluded.resolution, public.paystack_disputes.resolution),
    reason = coalesce(excluded.reason, public.paystack_disputes.reason),
    response_due_by = coalesce(
      public.paystack_disputes.response_due_by, excluded.response_due_by
    ),
    is_resolved = public.paystack_disputes.is_resolved
      OR excluded.is_resolved,
    raw_event = excluded.raw_event,
    updated_at = excluded.updated_at
  RETURNING * INTO v_row;

  v_merchant_lost := v_event = 'charge.dispute.resolve'
    AND lower(coalesce(v_resolution, '')) IN (
      'merchant-accepted', 'merchant_accepted', 'accepted'
    );
  v_merchant_won := v_event = 'charge.dispute.resolve'
    AND NOT v_merchant_lost;

  IF v_row.order_id IS NOT NULL THEN
    v_source_type := 'order';
    v_source_id := v_row.order_id;
  ELSIF v_row.rsvp_contribution_id IS NOT NULL THEN
    v_source_type := 'rsvp_contribution';
    v_source_id := v_row.rsvp_contribution_id;
  ELSIF v_row.venue_reservation_id IS NOT NULL THEN
    SELECT rcs.id INTO v_source_id
    FROM public.reservation_checkout_sessions rcs
    WHERE rcs.reservation_id = v_row.venue_reservation_id
      AND rcs.status = 'completed'
    ORDER BY rcs.created_at DESC
    LIMIT 1;
    v_source_type := 'venue_reservation';
  ELSIF v_row.venue_menu_order_id IS NOT NULL THEN
    v_source_type := 'venue_menu_order';
    v_source_id := v_row.venue_menu_order_id;
  END IF;

  IF v_source_type IS NOT NULL AND v_source_id IS NOT NULL AND v_row.amount_cents > 0 THEN
    SELECT r.* INTO v_release
    FROM public.payout_release_items pri
    JOIN public.brand_payout_releases r ON r.id = pri.release_id
    WHERE pri.source_type = v_source_type
      AND pri.source_id = v_source_id
      AND r.provider = 'paystack'
    ORDER BY CASE WHEN r.status = 'released' THEN 0 ELSE 1 END, r.created_at DESC
    LIMIT 1
    FOR UPDATE OF r;

    IF FOUND AND v_release.status <> 'released' THEN
      -- Pending/planned: hold disputed cash (or clear on merchant win).
      IF v_merchant_won THEN
        v_hold_cents := 0;
      ELSIF v_merchant_lost
        OR v_event IN ('charge.dispute.create', 'charge.dispute.remind')
      THEN
        v_hold_cents := v_row.amount_cents;
      ELSE
        v_hold_cents := NULL;
      END IF;

      IF v_hold_cents IS NOT NULL THEN
        UPDATE public.payout_release_items
        SET disputed_cents = v_hold_cents,
            -- #3645 flat 4.5%: host net ignores partner_share and provider_fee
            net_cents = greatest(
              0,
              gross_cents - refunded_cents - v_hold_cents
                - mingla_fee_cents
            )
        WHERE source_type = v_source_type
          AND source_id = v_source_id;

        UPDATE public.brand_payout_releases release_row
        SET disputed_cents = totals.disputed,
            net_release_cents = totals.net,
            updated_at = p_now
        FROM (
          SELECT
            sum(item.disputed_cents)::integer AS disputed,
            sum(item.net_cents)::integer AS net
          FROM public.payout_release_items item
          WHERE item.release_id = v_release.id
        ) totals
        WHERE release_row.id = v_release.id;

        IF v_merchant_lost AND NOT v_row.debt_opened THEN
          UPDATE public.paystack_disputes
          SET debt_opened = true, updated_at = p_now
          WHERE id = v_row.id;
          v_debt_created := true;
        END IF;
      END IF;

    ELSIF FOUND AND v_release.status = 'released'
      AND v_merchant_lost AND NOT v_row.debt_opened
    THEN
      PERFORM 1
      FROM public.brand_payout_releases r
      WHERE r.brand_id = v_release.brand_id
        AND r.currency = v_release.currency
        AND r.status = 'released'
        AND (
          v_release.event_id IS NULL
          OR r.event_id IS NOT DISTINCT FROM v_release.event_id
        )
      ORDER BY r.id
      FOR UPDATE;

      v_room := public.organiser_refund_debt_room_cents(
        v_release.brand_id, v_release.currency, v_release.event_id, v_release.id
      );
      v_liability := least(v_row.amount_cents, v_room);
      IF v_liability > 0 THEN
        v_adj_key := 'paystack-dispute-liability:' || v_dispute_id;
        INSERT INTO public.payout_ledger_adjustments(
          release_id, brand_id, currency, kind, amount_cents,
          provider_ref, idempotency_key, created_at
        ) VALUES (
          v_release.id, v_release.brand_id, v_release.currency,
          'post_release_dispute', v_liability, v_dispute_id, v_adj_key, p_now
        ) ON CONFLICT (idempotency_key) DO NOTHING;

        SELECT least(
          least(coalesce(sum(amount_cents), 0), 2147483647::bigint)::integer,
          v_room
        ) INTO v_target
        FROM public.payout_ledger_adjustments
        WHERE release_id = v_release.id AND kind = 'post_release_dispute';

        SELECT * INTO v_debt FROM public.organiser_payout_debts
        WHERE origin_release_id = v_release.id AND kind = 'post_release_dispute'
        FOR UPDATE;
        IF NOT FOUND THEN
          v_debt_id := public.convert_postponement_debt_to_permanent(
            v_release.id, 'post_release_dispute', v_target, p_now
          );
        ELSIF v_target > v_debt.principal_cents THEN
          -- Mirror PR3 refund growth: transfer overlapping postponement first.
          v_growth := v_target - v_debt.principal_cents;
          SELECT * INTO v_temp FROM public.organiser_payout_debts
          WHERE origin_release_id = v_release.id
            AND kind = 'post_release_postponement' AND status = 'open'
          FOR UPDATE;
          IF FOUND THEN
            v_overlap := least(v_growth, v_temp.principal_cents);
            v_recovered_overlap := least(v_overlap, v_temp.recovered_cents);
          ELSE
            v_overlap := 0;
            v_recovered_overlap := 0;
          END IF;

          UPDATE public.organiser_payout_debts SET
            principal_cents = v_target,
            recovered_cents = recovered_cents + v_recovered_overlap,
            status = CASE
              WHEN recovered_cents + v_recovered_overlap = v_target THEN 'closed'
              ELSE 'open'
            END,
            closed_at = CASE
              WHEN recovered_cents + v_recovered_overlap = v_target THEN p_now
              ELSE NULL
            END,
            updated_at = p_now
          WHERE id = v_debt.id;
          v_debt_id := v_debt.id;

          IF v_overlap > 0 THEN
            v_left := v_recovered_overlap;
            FOR v_app IN
              SELECT * FROM public.payout_debt_applications
              WHERE debt_id = v_temp.id AND released_at IS NULL
                AND amount_cents > converted_cents
              ORDER BY created_at, id FOR UPDATE
            LOOP
              EXIT WHEN v_left = 0;
              v_take := least(v_left, v_app.amount_cents - v_app.converted_cents);
              UPDATE public.payout_debt_applications
              SET converted_cents = converted_cents + v_take WHERE id = v_app.id;
              INSERT INTO public.payout_debt_applications(
                debt_id, release_id, amount_cents, idempotency_key, created_at
              ) VALUES (
                v_debt.id, v_app.release_id, v_take,
                'converted-apply:' || v_debt.id || ':' || v_app.id || ':' || v_target,
                p_now
              );
              v_left := v_left - v_take;
            END LOOP;
            UPDATE public.organiser_payout_debts SET
              principal_cents = principal_cents - v_overlap,
              recovered_cents = recovered_cents - v_recovered_overlap,
              status = CASE
                WHEN principal_cents - v_overlap = 0 THEN 'converted'
                ELSE 'open'
              END,
              closed_at = CASE
                WHEN principal_cents - v_overlap = 0 THEN p_now
                ELSE NULL
              END,
              updated_at = p_now
            WHERE id = v_temp.id;
            INSERT INTO public.payout_debt_events(
              debt_id, event_kind, amount_cents, release_id, idempotency_key, created_at
            ) VALUES (
              v_temp.id, 'cancellation_converted', v_overlap, v_release.id,
              'postpone-convert:' || v_temp.id || ':post_release_dispute:' || v_target,
              p_now
            );
          END IF;
        ELSE
          v_debt_id := v_debt.id;
        END IF;

        UPDATE public.paystack_disputes
        SET debt_opened = true, updated_at = p_now
        WHERE id = v_row.id;
        v_debt_created := true;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'dispute_id', v_row.id,
    'paystack_dispute_id', v_dispute_id,
    'matched', (
      v_row.order_id IS NOT NULL
      OR v_row.venue_reservation_id IS NOT NULL
      OR v_row.rsvp_contribution_id IS NOT NULL
      OR v_row.venue_menu_order_id IS NOT NULL
    ),
    'brand_id', v_row.brand_id,
    'order_id', v_row.order_id,
    'venue_reservation_id', v_row.venue_reservation_id,
    'rsvp_contribution_id', v_row.rsvp_contribution_id,
    'venue_menu_order_id', v_row.venue_menu_order_id,
    'response_due_by', v_row.response_due_by,
    'is_resolved', v_row.is_resolved OR v_event = 'charge.dispute.resolve',
    'merchant_lost', v_merchant_lost,
    'debt_created', v_debt_created,
    'debt_id', v_debt_id
  );
END;
$fn$;
