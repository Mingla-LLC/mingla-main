-- Issue #3645 — payout-run gate follows payment + 24 hours on every surface.
-- D1: the shared sweep gates on source finalization, not event end.
-- D2: later sales for an already-settled event unit mint #n release generations.
-- D3: event postponement never claws back a pre-event payout.
-- D4: stay releases anchor and mature from successful payment time.
--
-- Every function below is copied from the newest origin/main definition, which
-- matched production pg_get_functiondef on 2026-10-21, with only the named
-- #3645 changes applied.

BEGIN;

CREATE OR REPLACE FUNCTION public.attach_payout_release(p_source_type text, p_source_id uuid, p_brand_id uuid, p_event_id uuid, p_event_date_id uuid, p_occurrence_key text, p_provider text, p_currency text, p_finalized_at timestamp with time zone, p_anchor_end_at timestamp with time zone, p_gross_cents integer, p_refunded_cents integer, p_disputed_cents integer, p_mingla_fee_cents integer, p_partner_share_cents integer, p_provider_fee_cents integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_cutover timestamptz;
  v_status text;
  v_release_id uuid;
  v_existing_release_id uuid;
  v_existing_unit record;
  v_release_status text;
  v_release_occurrence_key text;
  v_unit_count integer;
  v_updated integer;
  v_net integer;
  v_maturity_anchor timestamptz;
BEGIN
  -- #1790 T-P3(5) pins the one-liner NOT IN list below character-for-character.
  -- Accept order_installment via a separate <> so that pin stays intact.
  IF (p_source_type NOT IN ('order','rsvp_contribution','venue_reservation','venue_menu_order')
      AND p_source_type <> 'order_installment')
     OR p_provider NOT IN ('stripe','paystack') THEN
    RAISE EXCEPTION 'invalid_payout_source' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_source_type||':'||p_source_id::text,1171)
  );
  SELECT release_id INTO v_existing_release_id
  FROM public.payout_release_items
  WHERE source_type=p_source_type AND source_id=p_source_id;
  IF FOUND THEN RETURN v_existing_release_id; END IF;

  SELECT payout_hold_cutover_at INTO v_cutover FROM public.brands
   WHERE id = p_brand_id FOR SHARE;
  IF v_cutover IS NULL OR p_finalized_at <= v_cutover THEN
    RAISE EXCEPTION 'source_not_after_cutover' USING ERRCODE = 'P0001';
  END IF;
  IF p_event_id IS NOT NULL THEN
    SELECT status INTO v_status FROM public.events WHERE id = p_event_id FOR SHARE;
    IF v_status = 'cancelled' THEN
      RAISE EXCEPTION 'cancelled_event_never_releases' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Issue #3645: serialize the base payout unit as well as the source row so
  -- concurrent later sales cannot mint the same generation suffix.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'payout-release-unit:' || p_brand_id::text || ':' ||
      coalesce(p_event_id, '00000000-0000-0000-0000-000000000000'::uuid)::text || ':' ||
      p_occurrence_key || ':' || p_source_type || ':' || p_provider || ':' ||
      lower(p_currency),
      3645
    )
  );
  -- Issue #3872 (F1): partner share is 10% OF Mingla's fee, paid from Mingla's
  -- platform balance — stored for reporting, not subtracted from host net.
  -- #3645 flat 4.5% (Seth 2026-10-20): Mingla pays provider processing; host net
  -- does not deduct p_provider_fee_cents (still stored on the row for reporting).
  -- p_mingla_fee_cents is the application fee / Mingla take (full 4.5% on new sales).
  v_net := greatest(0, p_gross_cents - p_refunded_cents - p_disputed_cents
    - p_mingla_fee_cents);

  -- #3645: maturity anchors on payment time.
  v_maturity_anchor := p_finalized_at;

  SELECT r.id, r.status, r.occurrence_key
  INTO v_existing_unit
  FROM public.brand_payout_releases r
  WHERE r.brand_id = p_brand_id
    AND r.event_key =
      coalesce(p_event_id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND (
      r.occurrence_key = p_occurrence_key
      OR left(r.occurrence_key, length(p_occurrence_key) + 1) =
        p_occurrence_key || '#'
    )
    AND r.surface = p_source_type
    AND r.provider = p_provider
    AND r.currency = lower(p_currency)
  ORDER BY r.created_at DESC, r.id DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND AND v_existing_unit.status = 'pending' THEN
    v_release_id := v_existing_unit.id;
    UPDATE public.brand_payout_releases
    SET anchor_end_at = v_maturity_anchor,
        releasable_at = v_maturity_anchor + interval '1 day',
        updated_at = now()
    WHERE id = v_release_id
      AND status = 'pending';
  ELSE
    IF FOUND THEN
      SELECT count(*)::integer
      INTO v_unit_count
      FROM public.brand_payout_releases r
      WHERE r.brand_id = p_brand_id
        AND r.event_key =
          coalesce(p_event_id, '00000000-0000-0000-0000-000000000000'::uuid)
        AND (
          r.occurrence_key = p_occurrence_key
          OR left(r.occurrence_key, length(p_occurrence_key) + 1) =
            p_occurrence_key || '#'
        )
        AND r.surface = p_source_type
        AND r.provider = p_provider
        AND r.currency = lower(p_currency);
      -- The unsuffixed row is generation zero; the next row is #1.
      v_release_occurrence_key :=
        p_occurrence_key || '#' || v_unit_count::text;
    ELSE
      v_release_occurrence_key := p_occurrence_key;
    END IF;

    INSERT INTO public.brand_payout_releases (
      brand_id,event_id,event_date_id,occurrence_key,surface,provider,currency,
      anchor_end_at,releasable_at,gross_cents,refunded_cents,disputed_cents,
      mingla_fee_cents,partner_share_cents,provider_fee_cents,net_release_cents
    ) VALUES (
      p_brand_id,p_event_id,p_event_date_id,v_release_occurrence_key,
      p_source_type,p_provider,lower(p_currency),v_maturity_anchor,
      v_maturity_anchor + interval '1 day',p_gross_cents,p_refunded_cents,
      p_disputed_cents,p_mingla_fee_cents,p_partner_share_cents,
      p_provider_fee_cents,v_net
    )
    RETURNING id INTO v_release_id;
  END IF;

  SELECT r.status
  INTO v_release_status
  FROM public.brand_payout_releases r
  WHERE r.id = v_release_id
  FOR UPDATE;
  IF v_release_status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'release_not_pending' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.payout_release_items (
    release_id,source_type,source_id,gross_cents,refunded_cents,disputed_cents,
    mingla_fee_cents,partner_share_cents,provider_fee_cents,net_cents,source_finalized_at
  ) VALUES (
    v_release_id,p_source_type,p_source_id,p_gross_cents,p_refunded_cents,
    p_disputed_cents,p_mingla_fee_cents,p_partner_share_cents,p_provider_fee_cents,v_net,
    p_finalized_at
  ) ON CONFLICT (source_type,source_id) DO NOTHING;

  IF p_source_type = 'order_installment' THEN
    UPDATE public.order_installments
    SET payout_accounting_state = 'attached',
        updated_at = now()
    WHERE id = p_source_id
      AND payout_accounting_state = 'ready';
  END IF;

  UPDATE public.brand_payout_releases r SET
    gross_cents=x.gross, refunded_cents=x.refunded, disputed_cents=x.disputed,
    mingla_fee_cents=x.mingla_fee, partner_share_cents=x.partner_share,
    provider_fee_cents=x.provider_fee, net_release_cents=x.net, updated_at=now()
  FROM (
    SELECT release_id,sum(gross_cents)::int gross,sum(refunded_cents)::int refunded,
      sum(disputed_cents)::int disputed,sum(mingla_fee_cents)::int mingla_fee,
      sum(partner_share_cents)::int partner_share,sum(provider_fee_cents)::int provider_fee,
      sum(net_cents)::int net
    FROM public.payout_release_items WHERE release_id=v_release_id GROUP BY release_id
  ) x WHERE r.id=x.release_id
        AND r.status='pending';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN
    RAISE EXCEPTION 'release_not_pending' USING ERRCODE = 'P0001';
  END IF;
  RETURN v_release_id;
END;
$function$;

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
        greatest(0,coalesce(vo.mingla_fee_cents,0)-coalesce((
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

CREATE OR REPLACE FUNCTION public.sync_post_release_postponement_debts(
  p_now timestamptz DEFAULT now()
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
BEGIN
  -- Issue #3645 payout-run-gate spec: once a sale is released before its event,
  -- postponing that event must not claw the host's money back.
  RETURN 0;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.issue_1389_attach_stay_payout_release(
  p_source_id uuid,
  p_brand_id uuid,
  p_occurrence_key text,
  p_provider text,
  p_currency text,
  p_finalized_at timestamptz,
  p_anchor_end_at timestamptz,
  p_gross_cents integer,
  p_refunded_cents integer,
  p_mingla_fee_cents integer,
  p_provider_fee_cents integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_cutover timestamptz;
  v_release_id uuid;
  v_existing_release_id uuid;
  v_net integer;
BEGIN
  IF NOT public.issue_1389_service_role()
     OR p_provider NOT IN ('stripe', 'paystack')
     OR p_currency !~ '^[A-Za-z]{3}$'
     OR p_anchor_end_at IS NULL
     OR p_finalized_at IS NULL
     OR p_gross_cents < 0
     OR p_refunded_cents < 0
     OR p_mingla_fee_cents < 0
     OR p_provider_fee_cents < 0 THEN
    RAISE EXCEPTION 'invalid_payout_source' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'stay_reservation:' || p_source_id::text,
      1171
    )
  );
  SELECT item.release_id INTO v_existing_release_id
  FROM public.payout_release_items item
  WHERE item.source_type = 'stay_reservation'
    AND item.source_id = p_source_id;
  IF FOUND THEN
    RETURN v_existing_release_id;
  END IF;

  SELECT brand.payout_hold_cutover_at INTO v_cutover
  FROM public.brands brand
  WHERE brand.id = p_brand_id
  FOR SHARE;
  IF v_cutover IS NULL OR p_finalized_at <= v_cutover THEN
    RAISE EXCEPTION 'source_not_after_cutover' USING ERRCODE = 'P0001';
  END IF;

  v_net := greatest(
    0,
    p_gross_cents - p_refunded_cents
      - p_mingla_fee_cents - p_provider_fee_cents
  );
  INSERT INTO public.brand_payout_releases (
    brand_id, event_id, event_date_id, occurrence_key, surface,
    provider, currency, anchor_end_at, releasable_at, gross_cents,
    refunded_cents, disputed_cents, mingla_fee_cents,
    partner_share_cents, provider_fee_cents, net_release_cents
  ) VALUES (
    p_brand_id, NULL, NULL, p_occurrence_key, 'stay_reservation',
    p_provider, lower(p_currency), p_finalized_at,
    p_finalized_at + interval '1 day', p_gross_cents,
    p_refunded_cents, 0, p_mingla_fee_cents, 0,
    p_provider_fee_cents, v_net
  )
  ON CONFLICT (
    brand_id, event_key, occurrence_key, surface, provider, currency
  )
  DO UPDATE SET
    anchor_end_at = EXCLUDED.anchor_end_at,
    releasable_at = EXCLUDED.releasable_at,
    updated_at = now()
  WHERE public.brand_payout_releases.status = 'pending'
  RETURNING id INTO v_release_id;

  IF v_release_id IS NULL THEN
    SELECT release_row.id INTO v_release_id
    FROM public.brand_payout_releases release_row
    WHERE release_row.brand_id = p_brand_id
      AND release_row.event_key =
        '00000000-0000-0000-0000-000000000000'::uuid
      AND release_row.occurrence_key = p_occurrence_key
      AND release_row.surface = 'stay_reservation'
      AND release_row.provider = p_provider
      AND release_row.currency = lower(p_currency);
  END IF;

  INSERT INTO public.payout_release_items (
    release_id, source_type, source_id, gross_cents, refunded_cents,
    disputed_cents, mingla_fee_cents, partner_share_cents,
    provider_fee_cents, net_cents, source_finalized_at
  ) VALUES (
    v_release_id, 'stay_reservation', p_source_id, p_gross_cents,
    p_refunded_cents, 0, p_mingla_fee_cents, 0,
    p_provider_fee_cents, v_net, p_finalized_at
  )
  ON CONFLICT (source_type, source_id) DO NOTHING;

  RETURN v_release_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.run_stay_payout_release_dark_sweep(
  p_now timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_row record;
  v_release_id uuid;
  v_created integer := 0;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  FOR v_row IN
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
      AND attempt.succeeded_at + interval '1 day' <= p_now
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
    ORDER BY anchor_end_at, line.id
  LOOP
    v_release_id := public.issue_1389_attach_stay_payout_release(
      v_row.source_id,
      v_row.brand_id,
      v_row.occurrence_key,
      v_row.provider,
      v_row.currency,
      v_row.finalized_at,
      v_row.anchor_end_at,
      v_row.gross_cents,
      v_row.refunded_cents,
      v_row.mingla_fee_cents,
      v_row.provider_fee_cents
    );
    PERFORM public.apply_open_payout_debts(v_release_id, p_now);
    INSERT INTO public.stay_money_ledger (
      group_id, line_id, payout_release_id, entry_type,
      amount_minor, currency_code, idempotency_key, metadata
    ) VALUES (
      v_row.group_id, v_row.source_id, v_release_id, 'payout_eligible',
      greatest(
        0,
        v_row.gross_cents - v_row.refunded_cents
          - v_row.mingla_fee_cents - v_row.provider_fee_cents
      ),
      upper(v_row.currency)::character(3),
      'stay:payout_attached:' || v_row.source_id,
      jsonb_build_object('releaseId', v_release_id)
    )
    ON CONFLICT (idempotency_key) DO NOTHING;
    v_created := v_created + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'dark', true,
    'attached', v_created,
    'executed', 0
  );
END;
$function$;

COMMIT;
