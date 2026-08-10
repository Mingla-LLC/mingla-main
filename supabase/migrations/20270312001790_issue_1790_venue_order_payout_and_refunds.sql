-- ===========================================================================
-- Issue #1790 — Phase 2 of #1767: payout + refund + dispute registration for
-- `venue_menu_order`. Consumes SPEC #1788 P-49 (.1 .2 .3 .4 .5 .6), P-50, P-51,
-- P-52.
--
-- FIVE widenings, not four (SPEC §0 CORRECTION D-1). The investigation text
-- claimed "the same 4-table CHECK widening"; re-read of the live schema found a
-- FIFTH gate, in plpgsql, that the stay leg never widened:
-- `attach_payout_release` still opens with
--   IF p_source_type NOT IN ('order','rsvp_contribution','venue_reservation')
--     ... RAISE EXCEPTION 'invalid_payout_source'
-- (20270110000001_issue_1171_dark_payout_ledger.sql:362-364, and no later
-- migration redefines that function). A venue-order candidate reaching that call
-- raises 22023 and aborts the sweep loop MID-TRANSACTION — for EVERY surface,
-- not just ours. Widening it is P-49.4 item 5 and is NOT optional.
--
-- The LIVE sweep body is `20270131001221_issue_1221_source_refund_control_plane.sql:1753`
-- (the refund-aware version), NOT `20270110000001:858` (SPEC §0 CORRECTION D-2).
-- Both function bodies below were COPIED byte-for-byte out of those two files by
-- `scripts` at authoring time; the ONLY edits are the ones P-49 authorises:
--   * attach_payout_release  — the source-type gate list gains 'venue_menu_order'.
--   * run_payout_release_dark_sweep — ONE new UNION ALL arm inside the candidates
--     CTE, and the per-row re-check guard at the old :1843 gains 'venue_menu_order'.
-- Nothing else in either function changes. Reverting ANY of the five widenings
-- makes the sweep raise LOUDLY rather than silently skipping money (T-P3).
--
-- P-49.6 — `refresh_pending_payout_release_truth` is deliberately NOT extended.
-- It `JOIN public.events e ON e.id=r.event_id`, so NULL-event releases are
-- skipped by design: their anchor is immutable. A venue order's anchor is its own
-- created_at, which never moves. Correct as-is; stated so nobody "fixes" it.
--
-- DO-NOT-TOUCH honoured: not one statement here reads or writes `public.orders`,
-- `order_line_items`, `ticket_types`, `tickets`, `refunds`, `refund_line_items`,
-- or any biz_ticket_checkout_* / biz_refund_order* / biz_cancel_order function.
-- No DROP NOT NULL anywhere.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- P-51 — disputes. `stripe_disputes` is charge-keyed and therefore already
-- subject-agnostic; this is plumbing, not a redesign. At most ONE of order_id /
-- venue_order_id may be set: a dispute belongs to one subject or the other,
-- never both, and a row claiming both would silently double-count in the
-- sweep's disputed_cents on two arms at once.
-- ---------------------------------------------------------------------------
ALTER TABLE public.stripe_disputes
  ADD COLUMN IF NOT EXISTS venue_order_id uuid
    REFERENCES public.venue_orders(id) ON DELETE SET NULL;

ALTER TABLE public.stripe_disputes
  DROP CONSTRAINT IF EXISTS stripe_disputes_single_subject;
ALTER TABLE public.stripe_disputes
  ADD CONSTRAINT stripe_disputes_single_subject CHECK (
    NOT (order_id IS NOT NULL AND venue_order_id IS NOT NULL));

CREATE INDEX IF NOT EXISTS idx_stripe_disputes_venue_order_id
  ON public.stripe_disputes(venue_order_id);

-- ---------------------------------------------------------------------------
-- P-49.4 widenings 1-3 + P-52 (widening 4) — the polymorphic payout + refund
-- planes gain `venue_menu_order`.
--
-- The DO-block idiom is 20270131013812_issue_1389_stay_commerce_schema.sql:288-384
-- verbatim: drop EVERY existing CHECK on the target relation whose definition
-- mentions source_type / surface / refund_kind, then re-add the named
-- constraint with the widened list. Idempotent, and it survives whatever the
-- constraint got named (the #1221 originals were partly UNNAMED).
-- ---------------------------------------------------------------------------
DO $block$
DECLARE
  constraint_row record;
BEGIN
  FOR constraint_row IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.source_refunds'::regclass
      AND contype = 'c'
      AND (
        pg_get_constraintdef(oid) ILIKE '%source_type%'
        OR pg_get_constraintdef(oid) ILIKE '%refund_kind%'
      )
  LOOP
    EXECUTE format(
      'ALTER TABLE public.source_refunds DROP CONSTRAINT %I',
      constraint_row.conname
    );
  END LOOP;
END;
$block$;

ALTER TABLE public.source_refunds
  ADD CONSTRAINT source_refunds_source_type_check CHECK (
    source_type IN (
      'venue_reservation', 'rsvp_contribution', 'stay_reservation',
      'venue_menu_order'
    )
  ),
  -- P-52: exactly TWO refund kinds for this source type, and there is no third,
  -- because there is no AUTOMATIC one. No sweep, cron, or timer may insert a
  -- source_refunds row for a venue order (I-PROPOSED-1767-NO-MONEY-ON-A-TIMER).
  ADD CONSTRAINT source_refunds_refund_kind_check CHECK (
    refund_kind IN (
      'venue_eligible_cancel', 'rsvp_discretionary', 'event_cancel',
      'stay_cancellation',
      'venue_order_guest_cancel', 'venue_order_venue_approved'
    )
  ),
  ADD CONSTRAINT source_refunds_source_shape CHECK (
    (
      source_type = 'venue_reservation'
      AND venue_id IS NOT NULL
      AND event_id IS NULL
    )
    OR (
      source_type = 'rsvp_contribution'
      AND event_id IS NOT NULL
      AND venue_id IS NULL
      AND source_id = subject_id
    )
    OR (
      source_type = 'stay_reservation'
      AND venue_id IS NOT NULL
      AND event_id IS NULL
    )
    OR (
      source_type = 'venue_menu_order'
      AND venue_id IS NOT NULL
      AND event_id IS NULL
    )
  );

DO $block$
DECLARE
  target regclass;
  constraint_row record;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'public.payout_source_fee_snapshots'::regclass,
    'public.brand_payout_releases'::regclass,
    'public.payout_release_items'::regclass
  ]
  LOOP
    FOR constraint_row IN
      SELECT conname
      FROM pg_constraint
      WHERE conrelid = target
        AND contype = 'c'
        AND (
          pg_get_constraintdef(oid) ILIKE '%source_type%'
          OR pg_get_constraintdef(oid) ILIKE '%surface%'
        )
    LOOP
      EXECUTE format(
        'ALTER TABLE %s DROP CONSTRAINT %I',
        target,
        constraint_row.conname
      );
    END LOOP;
  END LOOP;
END;
$block$;

ALTER TABLE public.payout_source_fee_snapshots
  ADD CONSTRAINT payout_source_fee_snapshots_source_type_check CHECK (
    source_type IN (
      'order', 'rsvp_contribution', 'venue_reservation', 'stay_reservation',
      'venue_menu_order'
    )
  );
ALTER TABLE public.brand_payout_releases
  ADD CONSTRAINT brand_payout_releases_surface_check CHECK (
    surface IN (
      'order', 'rsvp_contribution', 'venue_reservation', 'stay_reservation',
      'venue_menu_order'
    )
  );
ALTER TABLE public.payout_release_items
  ADD CONSTRAINT payout_release_items_source_type_check CHECK (
    source_type IN (
      'order', 'rsvp_contribution', 'venue_reservation', 'stay_reservation',
      'venue_menu_order'
    )
  );

-- ---------------------------------------------------------------------------
-- P-49.4 widening 5 — THE ONE THE FORENSICS MISSED.
-- Body copied byte-for-byte from
-- 20270110000001_issue_1171_dark_payout_ledger.sql:335-438; the ONLY change is
-- the source-type gate list.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.attach_payout_release(
  p_source_type text,
  p_source_id uuid,
  p_brand_id uuid,
  p_event_id uuid,
  p_event_date_id uuid,
  p_occurrence_key text,
  p_provider text,
  p_currency text,
  p_finalized_at timestamptz,
  p_anchor_end_at timestamptz,
  p_gross_cents integer,
  p_refunded_cents integer,
  p_disputed_cents integer,
  p_mingla_fee_cents integer,
  p_partner_share_cents integer,
  p_provider_fee_cents integer
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_cutover timestamptz;
  v_status text;
  v_release_id uuid;
  v_existing_release_id uuid;
  v_net integer;
BEGIN
  IF p_source_type NOT IN ('order','rsvp_contribution','venue_reservation','venue_menu_order')
     OR p_provider NOT IN ('stripe','paystack') THEN
    RAISE EXCEPTION 'invalid_payout_source' USING ERRCODE = '22023';
  END IF;
  -- Claim the globally unique money object before creating a release unit.
  -- This serializes concurrent snapshots even when they disagree on release key.
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
  v_net := greatest(0, p_gross_cents - p_refunded_cents - p_disputed_cents
    - p_mingla_fee_cents - p_partner_share_cents - p_provider_fee_cents);

  INSERT INTO public.brand_payout_releases (
    brand_id,event_id,event_date_id,occurrence_key,surface,provider,currency,
    anchor_end_at,releasable_at,gross_cents,refunded_cents,disputed_cents,
    mingla_fee_cents,partner_share_cents,provider_fee_cents,net_release_cents
  ) VALUES (
    p_brand_id,p_event_id,p_event_date_id,p_occurrence_key,p_source_type,p_provider,
    lower(p_currency),p_anchor_end_at,p_anchor_end_at + interval '3 days',
    p_gross_cents,p_refunded_cents,p_disputed_cents,p_mingla_fee_cents,
    p_partner_share_cents,p_provider_fee_cents,v_net
  )
  ON CONFLICT (brand_id,event_key,occurrence_key,surface,provider,currency)
  DO UPDATE SET
    anchor_end_at = EXCLUDED.anchor_end_at,
    releasable_at = EXCLUDED.releasable_at,
    updated_at = now()
  WHERE brand_payout_releases.status = 'pending'
  RETURNING id INTO v_release_id;

  IF v_release_id IS NULL THEN
    SELECT id INTO v_release_id FROM public.brand_payout_releases
     WHERE brand_id=p_brand_id
       AND event_key=coalesce(p_event_id,'00000000-0000-0000-0000-000000000000'::uuid)
       AND occurrence_key=p_occurrence_key
       AND surface=p_source_type AND provider=p_provider AND currency=lower(p_currency);
  END IF;

  INSERT INTO public.payout_release_items (
    release_id,source_type,source_id,gross_cents,refunded_cents,disputed_cents,
    mingla_fee_cents,partner_share_cents,provider_fee_cents,net_cents,source_finalized_at
  ) VALUES (
    v_release_id,p_source_type,p_source_id,p_gross_cents,p_refunded_cents,
    p_disputed_cents,p_mingla_fee_cents,p_partner_share_cents,p_provider_fee_cents,v_net,
    p_finalized_at
  ) ON CONFLICT (source_type,source_id) DO NOTHING;

  -- Totals are rebuilt from immutable items, never from provider balances.
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
  ) x WHERE r.id=x.release_id;
  RETURN v_release_id;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- P-49.1 + P-49.5 — the new sweep arm and the per-row re-check guard.
-- Body copied byte-for-byte from
-- 20270131001221_issue_1221_source_refund_control_plane.sql:1753-1859 (the LIVE,
-- refund-aware definition); the ONLY changes are the new UNION ALL arm and the
-- guard's source-type list.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.run_payout_release_dark_sweep(
  p_now timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
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
        o.created_at finalized_at,occ.end_at anchor_end_at,o.total_cents gross_cents,
        o.refunded_amount_cents refunded_cents,
        coalesce((SELECT sum(d.amount)::int FROM public.stripe_disputes d
          WHERE d.order_id=o.id AND d.status NOT IN ('won','warning_closed')),0) disputed_cents,
        o.stripe_application_fee_amount_cents mingla_fee_cents,
        coalesce((SELECT sum(ps.partner_share_cents)::int FROM public.partner_splits ps
          WHERE ps.order_id=o.id),0) partner_share_cents,
        fs.provider_fee_cents,occ.event_date_id::text occurrence_key
      FROM public.orders o JOIN public.events e ON e.id=o.event_id
      JOIN public.brands b ON b.id=e.brand_id
      JOIN LATERAL public.resolve_payout_live_occurrence(
        o.event_id,o.event_date_id,o.created_at
      ) occ ON true
      JOIN public.payout_source_fee_snapshots fs
        ON fs.source_type='order' AND fs.source_id=o.id
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
        ),0)),0,c.application_fee_amount_cents,0,fs.provider_fee_cents,
        occ.event_date_id::text
      FROM public.event_rsvp_contributions c JOIN public.events e ON e.id=c.event_id
      JOIN public.brands b ON b.id=c.brand_id
      JOIN LATERAL public.resolve_payout_live_occurrence(
        c.event_id,NULL,coalesce(c.paid_at,c.created_at)
      ) occ ON true
      JOIN public.payout_source_fee_snapshots fs
        ON fs.source_type='rsvp_contribution' AND fs.source_id=c.id
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
        ),0),0,0,0,fs.provider_fee_cents,'reservation:'||s.id::text
      FROM public.reservation_checkout_sessions s
      JOIN public.reservations r ON r.id=s.reservation_id
      JOIN public.brands b ON b.id=s.brand_id
      JOIN public.payout_source_fee_snapshots fs
        ON fs.source_type='venue_reservation' AND fs.source_id=s.id
      WHERE s.status='completed' AND s.amount_cents>0 AND b.payout_hold_cutover_at IS NOT NULL
        AND r.created_at>b.payout_hold_cutover_at
        AND NOT EXISTS (
          SELECT 1 FROM public.source_refunds sr
          WHERE sr.source_type='venue_reservation' AND sr.source_id=s.id
            AND sr.financial_state<>'reconciled'
        )
      UNION ALL
      -- #1790 (SPEC #1788 P-49.1) — the venue menu order arm. ANCHOR is the
      -- order's OWN created_at, so the schema CHECK
      -- (brand_payout_release_anchor_order) makes releasable_at = created_at +
      -- 3 days, rolling. There is no event and no occurrence: event_key's
      -- GENERATED zero-uuid coalesce is what lets an event-less surface
      -- participate at all.
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
        -- ORDER-arm semantics: the REAL fee, not the reservation arm's literal 0
        -- (that asymmetry is registered as OQ-6, deliberately not fixed here).
        vo.mingla_fee_cents,
        0,                                 -- partner_share_cents = 0 AT LAUNCH (P-50)
        fs.provider_fee_cents,'venue_order:'||vo.id::text
      FROM public.venue_orders vo
      JOIN public.brands b ON b.id=vo.brand_id
      JOIN public.payout_source_fee_snapshots fs
        ON fs.source_type='venue_menu_order' AND fs.source_id=vo.id
      WHERE vo.money_path='mingla'
        AND vo.payment_status IN ('paid','partial_refund')
        AND vo.total_cents>0
        -- payout_release_items.source_finalized_at is NOT NULL; an order whose
        -- confirmed_at has not landed yet simply WAITS rather than aborting the
        -- sweep loop mid-transaction. Correct failure direction (P-49.3).
        AND vo.confirmed_at IS NOT NULL
        AND b.payout_hold_cutover_at IS NOT NULL
        AND vo.created_at>b.payout_hold_cutover_at
        AND NOT EXISTS (
          SELECT 1 FROM public.source_refunds sr
          WHERE sr.source_type='venue_menu_order' AND sr.source_id=vo.id
            AND sr.financial_state<>'reconciled'
        )
    )
    SELECT * FROM candidates c
    WHERE c.anchor_end_at IS NOT NULL AND c.anchor_end_at+interval '3 days'<=p_now
      AND c.gross_cents-c.refunded_cents-c.disputed_cents>0
      AND NOT EXISTS (SELECT 1 FROM public.payout_release_items i
        WHERE i.source_type=c.source_type AND i.source_id=c.source_id)
    ORDER BY c.anchor_end_at,c.source_id
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
END $$;

-- ---------------------------------------------------------------------------
-- P-49.3 — the fee snapshot must exist BEFORE the sweep can see the row (the
-- arm INNER JOINs it). This is the ONE place a venue order is marked paid, and
-- it writes the snapshot in the SAME transaction as the flip, so the two can
-- never disagree. A missing snapshot means the money simply waits — it is never
-- released on a guess.
--
-- Idempotent by FOR UPDATE + early return: a replayed webhook returns the same
-- shape and writes nothing twice. The amount + currency gate is the "if the
-- amount doesn't match, don't deliver value" rule the Paystack arm already
-- enforces; a mismatch marks the order failed rather than silently accepting.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pg_venue_order_finalize_payment(
  p_order_id uuid,
  p_provider text,
  p_paid_amount_cents integer,
  p_currency text,
  p_payment_intent_id text DEFAULT NULL,
  p_charge_id text DEFAULT NULL,
  p_provider_fee_cents integer DEFAULT NULL,
  p_provider_balance_transaction_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_order public.venue_orders%ROWTYPE;
  v_session public.venue_order_sessions%ROWTYPE;
  v_is_settlement boolean;
BEGIN
  IF current_user NOT IN ('postgres','service_role') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_provider NOT IN ('stripe','paystack') THEN
    RAISE EXCEPTION 'invalid_provider' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_order FROM public.venue_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('matched', false, 'status', 'not_found');
  END IF;

  -- A venue-collected order has no provider and never reaches this path.
  IF v_order.money_path <> 'mingla' THEN
    RETURN jsonb_build_object('matched', false, 'status', 'not_a_mingla_order');
  END IF;

  IF v_order.payment_status = 'paid' THEN
    RETURN jsonb_build_object(
      'matched', true, 'status', 'replayed', 'orderId', v_order.id,
      'brandId', v_order.brand_id);
  END IF;

  IF p_paid_amount_cents IS DISTINCT FROM v_order.total_cents
     OR upper(coalesce(p_currency,'')) <> v_order.currency THEN
    UPDATE public.venue_orders
       SET payment_status = 'failed', failed_at = now()
     WHERE id = p_order_id;
    RETURN jsonb_build_object(
      'matched', true, 'status', 'amount_or_currency_mismatch',
      'orderId', v_order.id, 'brandId', v_order.brand_id);
  END IF;

  UPDATE public.venue_orders
     SET payment_status = 'paid',
         confirmed_at = coalesce(confirmed_at, now()),
         provider = p_provider,
         stripe_payment_intent_id = coalesce(stripe_payment_intent_id, p_payment_intent_id),
         stripe_charge_id = coalesce(stripe_charge_id, p_charge_id)
   WHERE id = p_order_id;

  -- The snapshot the sweep INNER JOINs — written ONLY when the provider told us
  -- the REAL fee (Paystack returns `fees` on verify). A NULL fee writes NOTHING:
  -- per-charge provider fees are immutable ledger inputs and a zero placeholder
  -- would over-release the venue by exactly the processing cost. The order then
  -- WAITS, and `list_missing_payout_source_fees` (extended below) hands it to
  -- the shipped payout-release-sweep fee-capture loop, which resolves the true
  -- balance-transaction fee from the provider. Money is never released on a
  -- guess (P-49.3).
  IF p_provider_fee_cents IS NOT NULL THEN
    INSERT INTO public.payout_source_fee_snapshots (
      source_type, source_id, provider_fee_cents, provider_balance_transaction_id
    ) VALUES (
      'venue_menu_order', p_order_id, greatest(0, p_provider_fee_cents),
      p_provider_balance_transaction_id
    )
    ON CONFLICT (source_type, source_id) DO NOTHING;
  END IF;

  -- P-2a — a paid TAB SETTLEMENT order closes its tab and settles its children.
  -- `closed_by_user_id` is the settlement order's taken_by_user_id: the staff
  -- member who actually closed the tab. The webhook has no user of its own, and
  -- inventing one would make the close-shape CHECK a lie.
  v_is_settlement := coalesce(v_order.metadata->>'tab_settlement','') = 'true';
  IF v_is_settlement AND v_order.taken_by_user_id IS NOT NULL THEN
    SELECT * INTO v_session FROM public.venue_order_sessions
     WHERE id = v_order.session_id FOR UPDATE;
    IF FOUND AND v_session.tab_state = 'settling' THEN
      UPDATE public.venue_orders
         SET payment_status = 'paid',
             confirmed_at = coalesce(confirmed_at, now()),
             metadata = metadata || jsonb_build_object(
               'settled_by_venue_order_id', p_order_id::text)
       WHERE session_id = v_session.id
         AND money_path = 'venue_collected'
         AND payment_status = 'pending';
      UPDATE public.venue_order_sessions
         SET tab_state = 'closed', closed_at = now(),
             closed_by_user_id = v_order.taken_by_user_id
       WHERE id = v_session.id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'matched', true, 'status', 'finalized', 'orderId', v_order.id,
    'brandId', v_order.brand_id, 'tabClosed', v_is_settlement);
END;
$fn$;

-- NOTE: `REVOKE ... FROM PUBLIC` alone is NOT enough on Supabase. The project
-- carries ALTER DEFAULT PRIVILEGES granting EXECUTE on every new public function
-- to anon/authenticated/service_role, which writes an EXPLICIT `anon=X` ACL entry
-- that revoking PUBLIC never touches. anon must be named. (#1171's own grants use
-- exactly this two-line shape, and the ORCH-1392 live-ACL gate is what proves it.)
REVOKE ALL ON FUNCTION public.pg_venue_order_finalize_payment(
  uuid, text, integer, text, text, text, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pg_venue_order_finalize_payment(
  uuid, text, integer, text, text, text, integer, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pg_venue_order_finalize_payment(
  uuid, text, integer, text, text, text, integer, text) TO service_role;

-- CREATE OR REPLACE preserves a function's ACL, so the two replaced functions
-- above keep the grants #1171 gave them. Re-stating them is belt-and-braces and
-- idempotent: neither may EVER be anon- or authenticated-executable, and the
-- security-definer-anon-grant gate should be able to read that off this file
-- rather than infer it from a migration three months upstream.
REVOKE ALL ON FUNCTION public.attach_payout_release(
  text,uuid,uuid,uuid,uuid,text,text,text,timestamptz,timestamptz,
  integer,integer,integer,integer,integer,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attach_payout_release(
  text,uuid,uuid,uuid,uuid,text,text,text,timestamptz,timestamptz,
  integer,integer,integer,integer,integer,integer) TO service_role;
REVOKE ALL ON FUNCTION public.run_payout_release_dark_sweep(timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_payout_release_dark_sweep(timestamptz) TO service_role;

-- ---------------------------------------------------------------------------
-- ADDITIVE BEYOND P-49's FIVE, and stated as such (reported, not slipped in).
--
-- P-49.3 leaves an order with no fee snapshot in a WAITING state. On the
-- Paystack rail the webhook knows the true fee (verify returns `fees`) and the
-- wait is momentary. On the STRIPE rail it does not — the fee lives on the
-- charge's balance transaction — so without this arm a Stripe venue order would
-- wait FOREVER and never pay out. `list_missing_payout_source_fees` is the
-- shipped exit from that state: `payout-release-sweep` reads it, resolves the
-- real per-charge fee from the provider, and writes the snapshot. ONE new
-- UNION ALL arm, exactly parallel to the venue_reservation arm; no existing arm
-- changes. The sweep's TypeScript needs no edit — its non-stay branch upserts
-- the snapshot generically.
-- Body copied byte-for-byte from 20270110000001:811-856.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_missing_payout_source_fees(p_limit integer DEFAULT 100)
RETURNS TABLE(
  source_type text,source_id uuid,provider text,provider_reference text,
  stripe_account_id text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT * FROM (
    SELECT 'order'::text AS source_type,o.id AS source_id,
      b.payment_provider AS provider,
      CASE WHEN b.payment_provider='paystack' THEN o.stripe_payment_intent_id
           ELSE coalesce(o.stripe_charge_id,o.stripe_payment_intent_id) END
        AS provider_reference,
      CASE WHEN b.payment_provider='stripe' THEN b.stripe_connect_id ELSE NULL END
        AS stripe_account_id
    FROM public.orders o JOIN public.events e ON e.id=o.event_id
    JOIN public.brands b ON b.id=e.brand_id
    WHERE o.payment_status IN ('paid','partial_refund') AND o.total_cents>0
      AND b.payout_hold_cutover_at IS NOT NULL AND o.created_at>b.payout_hold_cutover_at
    UNION ALL
    SELECT 'rsvp_contribution',c.id,c.provider,
      CASE WHEN c.provider='paystack' THEN c.stripe_payment_intent_id
           ELSE coalesce(c.stripe_charge_id,c.stripe_payment_intent_id) END,
      CASE WHEN c.provider='stripe' THEN b.stripe_connect_id ELSE NULL END
    FROM public.event_rsvp_contributions c JOIN public.brands b ON b.id=c.brand_id
    WHERE c.status IN ('paid','partially_refunded') AND b.payout_hold_cutover_at IS NOT NULL
      AND coalesce(c.paid_at,c.created_at)>b.payout_hold_cutover_at
    UNION ALL
    SELECT 'venue_reservation',s.id,b.payment_provider,
      CASE WHEN b.payment_provider='paystack' THEN s.paystack_reference
           ELSE s.stripe_payment_intent_id END,
      CASE WHEN b.payment_provider='stripe' THEN s.stripe_account_id ELSE NULL END
    FROM public.reservation_checkout_sessions s
    JOIN public.reservations r ON r.id=s.reservation_id
    JOIN public.brands b ON b.id=s.brand_id
    WHERE s.status='completed' AND s.amount_cents>0 AND b.payout_hold_cutover_at IS NOT NULL
      AND r.created_at>b.payout_hold_cutover_at
    UNION ALL
    -- #1790 — venue menu orders. money_path='venue_collected' is EXCLUDED: the
    -- venue took cash, so there is no provider fee to resolve and no payout.
    SELECT 'venue_menu_order',vo.id,vo.provider,
      CASE WHEN vo.provider='paystack' THEN vo.paystack_reference
           ELSE coalesce(vo.stripe_charge_id,vo.stripe_payment_intent_id) END,
      CASE WHEN vo.provider='stripe' THEN vo.stripe_account_id ELSE NULL END
    FROM public.venue_orders vo
    JOIN public.brands b ON b.id=vo.brand_id
    WHERE vo.money_path='mingla'
      AND vo.payment_status IN ('paid','partial_refund') AND vo.total_cents>0
      AND b.payout_hold_cutover_at IS NOT NULL AND vo.created_at>b.payout_hold_cutover_at
  ) q
  WHERE q.provider_reference IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.payout_source_fee_snapshots f
      WHERE f.source_type=q.source_type AND f.source_id=q.source_id
    )
  ORDER BY q.source_type,q.source_id
  LIMIT greatest(1,least(p_limit,500));
$fn$;

REVOKE ALL ON FUNCTION public.list_missing_payout_source_fees(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_missing_payout_source_fees(integer) FROM anon,authenticated;
GRANT EXECUTE ON FUNCTION public.list_missing_payout_source_fees(integer) TO service_role;

COMMENT ON FUNCTION public.pg_venue_order_finalize_payment(
  uuid, text, integer, text, text, text, integer, text) IS
  'SPEC #1788 P-28 / P-49.3 — the ONE place a venue order becomes paid. Flips '
  'payment_status and writes the payout_source_fee_snapshots row in the SAME '
  'transaction, so the sweep can never see a paid order without its fee '
  'snapshot. Idempotent (FOR UPDATE + early return). Amount + currency must '
  'match or the order is marked failed.';

COMMIT;
