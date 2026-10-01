-- Issue #3645 PR5 — instalment cancel stop + collected instalments enter payout ledger.
--
-- A (#2030 core): cancel_event_refund_prepare flips scheduled/failed installments
--   to cancelled (mirror biz_cancel_trip_booking_begin). Edge createInstallmentPI
--   and process-scheduled-installments refuse cancelled events/orders.
-- B (#2036 core, readiness-gated): widen payout source allowlists for
--   order_installment; add fee + accounting columns; dark-sweep arm gated by
--   issue_2036_installment_payout_ready() which defaults FALSE until ops flip.
--
-- Bodies for cancel_event_refund_prepare / attach_payout_release /
-- run_payout_release_dark_sweep are copied from their LATEST definitions
-- (20270721003645, 20270720003645, 20270312001790) with only the authorised edits.

-- =============================================================================
-- §1. order_installments fee + payout accounting columns
-- =============================================================================
ALTER TABLE public.order_installments
  ADD COLUMN IF NOT EXISTS application_fee_amount_cents integer
    CHECK (application_fee_amount_cents IS NULL OR application_fee_amount_cents >= 0),
  ADD COLUMN IF NOT EXISTS provider_fee_cents integer NOT NULL DEFAULT 0
    CHECK (provider_fee_cents >= 0),
  ADD COLUMN IF NOT EXISTS payout_accounting_state text NOT NULL DEFAULT 'pending';

DO $$
DECLARE
  v_con record;
BEGIN
  FOR v_con IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid = 'public.order_installments'::regclass
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%payout_accounting_state%'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.order_installments DROP CONSTRAINT %I', v_con.conname
    );
  END LOOP;
END$$;

ALTER TABLE public.order_installments
  ADD CONSTRAINT order_installments_payout_accounting_state_check
  CHECK (payout_accounting_state IN (
    'pending', 'ready', 'attached', 'manual_review'
  ));

COMMENT ON COLUMN public.order_installments.application_fee_amount_cents IS
  'Issue #3645 / #2036: Mingla application fee on the collected installment PI (cents). Set by record_order_installment_provider_sale.';
COMMENT ON COLUMN public.order_installments.provider_fee_cents IS
  'Issue #3645 / #2036: provider processing fee on the collected installment (cents). Default 0 until known.';
COMMENT ON COLUMN public.order_installments.payout_accounting_state IS
  'Issue #3645 / #2036: pending → ready (fees recorded) → attached (in payout_release_items) or manual_review.';

-- =============================================================================
-- §2. Widen payout CHECKs for order_installment (pattern from #1790)
-- =============================================================================
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
      'venue_menu_order', 'order_installment'
    )
  );
ALTER TABLE public.brand_payout_releases
  ADD CONSTRAINT brand_payout_releases_surface_check CHECK (
    surface IN (
      'order', 'rsvp_contribution', 'venue_reservation', 'stay_reservation',
      'venue_menu_order', 'order_installment'
    )
  );
ALTER TABLE public.payout_release_items
  ADD CONSTRAINT payout_release_items_source_type_check CHECK (
    source_type IN (
      'order', 'rsvp_contribution', 'venue_reservation', 'stay_reservation',
      'venue_menu_order', 'order_installment'
    )
  );

-- =============================================================================
-- §3. SPEC readiness gate — defaults FALSE; ops flip via follow-up migration
-- =============================================================================
CREATE OR REPLACE FUNCTION public.issue_2036_installment_payout_ready()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT false;
$$;

REVOKE ALL ON FUNCTION public.issue_2036_installment_payout_ready()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_2036_installment_payout_ready()
  TO service_role;
COMMENT ON FUNCTION public.issue_2036_installment_payout_ready() IS
  'Issue #3645 / #2036 SPEC readiness: when false (default), run_payout_release_dark_sweep ignores collected order_installments. Ops flip to true via a follow-up migration after fee/refund/dispute depth is proven.';

-- =============================================================================
-- §4. record_order_installment_provider_sale — fee columns + ready state
-- =============================================================================
CREATE OR REPLACE FUNCTION public.record_order_installment_provider_sale(
  p_installment_id uuid,
  p_application_fee_amount_cents integer,
  p_provider_fee_cents integer,
  p_now timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_row public.order_installments;
BEGIN
  IF p_installment_id IS NULL THEN
    RAISE EXCEPTION 'installment_id_required' USING ERRCODE = '22023';
  END IF;
  IF p_application_fee_amount_cents IS NULL OR p_application_fee_amount_cents < 0 THEN
    RAISE EXCEPTION 'invalid_application_fee' USING ERRCODE = '22023';
  END IF;
  IF p_provider_fee_cents IS NULL OR p_provider_fee_cents < 0 THEN
    RAISE EXCEPTION 'invalid_provider_fee' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row
  FROM public.order_installments
  WHERE id = p_installment_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'installment_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_row.status IS DISTINCT FROM 'collected' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'not_collected',
      'status', v_row.status
    );
  END IF;

  UPDATE public.order_installments
  SET application_fee_amount_cents = p_application_fee_amount_cents,
      provider_fee_cents = p_provider_fee_cents,
      payout_accounting_state = CASE
        WHEN payout_accounting_state IN ('attached', 'manual_review')
          THEN payout_accounting_state
        ELSE 'ready'
      END,
      updated_at = p_now
  WHERE id = p_installment_id
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'ok', true,
    'installment_id', v_row.id,
    'payout_accounting_state', v_row.payout_accounting_state,
    'application_fee_amount_cents', v_row.application_fee_amount_cents,
    'provider_fee_cents', v_row.provider_fee_cents
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.record_order_installment_provider_sale(uuid, integer, integer, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_order_installment_provider_sale(uuid, integer, integer, timestamptz)
  TO service_role;
COMMENT ON FUNCTION public.record_order_installment_provider_sale(uuid, integer, integer, timestamptz) IS
  'Issue #3645 / #2036: records Mingla + provider fees on a collected order_installment and moves payout_accounting_state to ready (unless already attached/manual_review). service_role only.';

-- =============================================================================
-- §4b. claim_order_installment_for_charge — fail-closed chargeability claim
-- =============================================================================
CREATE OR REPLACE FUNCTION public.claim_order_installment_for_charge(
  p_installment_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_inst public.order_installments;
  v_order public.orders;
  v_event_status text;
BEGIN
  IF p_installment_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'installment_id_required');
  END IF;

  SELECT * INTO v_inst
  FROM public.order_installments
  WHERE id = p_installment_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'installment_not_found');
  END IF;

  IF v_inst.status NOT IN ('scheduled', 'failed') THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'installment_not_chargeable',
      'status', v_inst.status
    );
  END IF;
  IF v_inst.cancelled_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'installment_cancelled');
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = v_inst.order_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found');
  END IF;
  IF v_order.cancelled_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_cancelled');
  END IF;

  SELECT e.status INTO v_event_status
  FROM public.events e
  WHERE e.id = v_order.event_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'event_missing');
  END IF;
  IF v_event_status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'event_cancelled');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'installment_id', v_inst.id,
    'order_id', v_order.id,
    'event_id', v_order.event_id,
    'status', v_inst.status,
    'retry_count', v_inst.retry_count,
    'amount_cents', v_inst.amount_cents,
    'currency', v_inst.currency
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.claim_order_installment_for_charge(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_order_installment_for_charge(uuid)
  TO service_role;
COMMENT ON FUNCTION public.claim_order_installment_for_charge(uuid) IS
  'Issue #3645 / #2030: service_role-only fail-closed charge claim. LOCK installment+order+event FOR UPDATE; refuse unless installment is scheduled/failed, not cancelled, and order/event are not cancelled. Call before Stripe I/O and again before marking collected.';

-- =============================================================================
-- §5. cancel_event_refund_prepare — stop scheduled/failed installments
--     Latest body: 20270721003645_issue_3645_cancel_refund_review.sql
-- =============================================================================
CREATE OR REPLACE FUNCTION public.cancel_event_refund_prepare(
  p_event_id uuid,
  p_now timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_status text;
  v_brand_id uuid;
  v_provider text;
  v_release record;
  v_temp public.organiser_payout_debts;
  v_total integer;
  v_rsvp_count integer;
  v_run_status text;
  v_pending_ids uuid[];
  v_installments_cancelled integer := 0;
BEGIN
  -- 1. Status-first guard (binding race guard + the SOLE authorization).
  SELECT status, brand_id INTO v_status, v_brand_id
  FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_status IS DISTINCT FROM 'cancelled' THEN
    RAISE EXCEPTION 'event_not_cancelled' USING ERRCODE = 'P0002';
  END IF;

  SELECT CASE WHEN b.payment_provider = 'paystack' THEN 'paystack' ELSE 'stripe' END
  INTO v_provider FROM public.brands b WHERE b.id = v_brand_id;
  v_provider := COALESCE(v_provider, 'stripe');

  -- 1b. #3645 PR2 — freeze sales (idempotent).
  UPDATE public.ticket_types
  SET sale_end_at = p_now,
      is_disabled = true,
      updated_at = p_now
  WHERE event_id = p_event_id
    AND deleted_at IS NULL
    AND is_hidden IS NOT TRUE
    AND available_online IS TRUE
    AND (
      sale_end_at IS NULL
      OR sale_end_at > p_now
      OR is_disabled IS NOT TRUE
    );

  UPDATE public.events
  SET bookings_closed = true,
      bookings_closed_at = COALESCE(bookings_closed_at, p_now)
  WHERE id = p_event_id
    AND bookings_closed IS NOT TRUE;

  -- 1c. #3645 PR5 / #2030 — cancel scheduled/failed installments on this event's
  --     orders (mirror biz_cancel_trip_booking_begin). Collected rows stay.
  UPDATE public.order_installments oi
  SET status = 'cancelled',
      cancelled_at = p_now
  FROM public.orders o
  WHERE o.id = oi.order_id
    AND o.event_id = p_event_id
    AND oi.status IN ('scheduled', 'failed')
    AND oi.cancelled_at IS NULL;
  GET DIAGNOSTICS v_installments_cancelled = ROW_COUNT;

  -- 2. Stop releases (event-scoped; NEVER releases).
  WITH locked AS (
    SELECT id FROM public.brand_payout_releases
    WHERE event_id = p_event_id
      AND status IN (
        'pending','blocked_kyc','blocked_balance','blocked_otp','blocked_over_cap',
        'fee_unreconciled','blocked_anchor','reanchored'
      )
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.brand_payout_releases r
  SET status = 'cancelled_event', updated_at = p_now
  FROM locked WHERE r.id = locked.id;

  -- 3. Atomic debt conversion BEFORE any refund (Stripe only).
  FOR v_release IN
    SELECT r.id AS release_id
    FROM public.brand_payout_releases r
    WHERE r.event_id = p_event_id
      AND r.status = 'released'
      AND r.provider = 'stripe'
    FOR UPDATE OF r SKIP LOCKED
  LOOP
    SELECT * INTO v_temp FROM public.organiser_payout_debts
    WHERE origin_release_id = v_release.release_id
      AND kind = 'post_release_postponement'
      AND status = 'open'
    FOR UPDATE;
    IF FOUND AND v_temp.principal_cents > 0 THEN
      PERFORM public.convert_postponement_debt_to_permanent(
        v_release.release_id, 'post_release_cancellation', v_temp.principal_cents, p_now
      );
    END IF;
  END LOOP;

  -- 4. Open / refresh the backstop run.
  INSERT INTO public.event_cancel_refund_runs (event_id, status, last_attempt_at, opened_at)
  VALUES (p_event_id, 'awaiting_review', p_now, p_now)
  ON CONFLICT (event_id) DO UPDATE SET
    last_attempt_at = p_now;

  -- 5. Enumerate + persist per-object progress rows (orders only).
  INSERT INTO public.event_cancel_refund_progress (
    event_id, source_type, source_id, provider, amount_cents, status
  )
  SELECT p_event_id, 'order', o.id, v_provider,
         (o.total_cents - COALESCE(o.refunded_amount_cents, 0)), 'pending'
  FROM public.orders o
  WHERE o.event_id = p_event_id
    AND o.payment_status IN ('paid','partial_refund')
    AND (o.total_cents - COALESCE(o.refunded_amount_cents, 0)) > 0
  ON CONFLICT (source_type, source_id) DO NOTHING;

  SELECT count(*)::integer INTO v_total
  FROM public.event_cancel_refund_progress WHERE event_id = p_event_id;

  -- 5b. RSVP chip-in contributions.
  SELECT count(*)::integer INTO v_rsvp_count
  FROM public.event_rsvp_contributions c
  WHERE c.event_id = p_event_id
    AND c.status IN ('paid','partially_refunded')
    AND c.buyer_total_cents > c.refunded_amount_cents;

  -- 6. Resolve the run status from the refund work.
  UPDATE public.event_cancel_refund_runs
  SET total_objects = v_total,
      status = CASE
        WHEN status = 'completed' THEN status
        WHEN v_total = 0 AND v_rsvp_count = 0 THEN 'completed'
        ELSE status
      END,
      completed_at = CASE
        WHEN status <> 'completed' AND v_total = 0 AND v_rsvp_count = 0
             AND completed_at IS NULL THEN p_now
        ELSE completed_at
      END
  WHERE event_id = p_event_id
  RETURNING status INTO v_run_status;

  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO v_pending_ids
  FROM public.event_cancel_refund_progress
  WHERE event_id = p_event_id AND status IN ('pending','failed_retryable');

  RETURN jsonb_build_object(
    'run_status', v_run_status,
    'total_objects', v_total,
    'pending_object_ids', to_jsonb(v_pending_ids),
    'rsvp_pending_count', v_rsvp_count,
    'installments_cancelled', v_installments_cancelled
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.cancel_event_refund_prepare(uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_event_refund_prepare(uuid, timestamptz)
  TO service_role;
COMMENT ON FUNCTION public.cancel_event_refund_prepare(uuid, timestamptz) IS
  'Issue #1179 (J) + #3645 PR2/PR5: status-first guarded — freezes ticket sales, closes trip bookings, cancels scheduled/failed order_installments, stops pending releases, converts Stripe temp postponement debt, enumerates order refund progress, opens awaiting_review when refund work exists. Returns installments_cancelled. service_role only.';

-- =============================================================================
-- §6. attach_payout_release — gate gains order_installment
--     Latest body: 20270720003645 (payment+24h maturity)
-- =============================================================================
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
  v_maturity_anchor timestamptz;
BEGIN
  IF p_source_type NOT IN (
       'order','rsvp_contribution','venue_reservation','venue_menu_order',
       'order_installment'
     )
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
  v_net := greatest(0, p_gross_cents - p_refunded_cents - p_disputed_cents
    - p_mingla_fee_cents - p_partner_share_cents - p_provider_fee_cents);

  -- #3645: maturity anchors on payment time.
  v_maturity_anchor := p_finalized_at;

  INSERT INTO public.brand_payout_releases (
    brand_id,event_id,event_date_id,occurrence_key,surface,provider,currency,
    anchor_end_at,releasable_at,gross_cents,refunded_cents,disputed_cents,
    mingla_fee_cents,partner_share_cents,provider_fee_cents,net_release_cents
  ) VALUES (
    p_brand_id,p_event_id,p_event_date_id,p_occurrence_key,p_source_type,p_provider,
    lower(p_currency),v_maturity_anchor,v_maturity_anchor + interval '1 day',
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
  ) x WHERE r.id=x.release_id;
  RETURN v_release_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.attach_payout_release(
  text,uuid,uuid,uuid,uuid,text,text,text,timestamptz,timestamptz,
  integer,integer,integer,integer,integer,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attach_payout_release(
  text,uuid,uuid,uuid,uuid,text,text,text,timestamptz,timestamptz,
  integer,integer,integer,integer,integer,integer) TO service_role;

-- =============================================================================
-- §7. run_payout_release_dark_sweep — + order_installment arm; maturity = payment+24h
--     Latest body: 20270312001790; maturity filter aligned with #3645 attach.
-- =============================================================================
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
        vo.mingla_fee_cents,
        0,
        fs.provider_fee_cents,'venue_order:'||vo.id::text
      FROM public.venue_orders vo
      JOIN public.brands b ON b.id=vo.brand_id
      JOIN public.payout_source_fee_snapshots fs
        ON fs.source_type='venue_menu_order' AND fs.source_id=vo.id
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
        occ.event_date_id::text
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
END $$;

REVOKE ALL ON FUNCTION public.run_payout_release_dark_sweep(timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_payout_release_dark_sweep(timestamptz) TO service_role;
COMMENT ON FUNCTION public.run_payout_release_dark_sweep(timestamptz) IS
  'Issue #1171/#1221/#1790/#3645: dark payout sweep. Maturity = payment finalization + 1 day. Includes order_installment when issue_2036_installment_payout_ready(). service_role only.';

-- Privilege self-assert
DO $$
BEGIN
  IF has_function_privilege('anon',
       'public.record_order_installment_provider_sale(uuid,integer,integer,timestamptz)', 'EXECUTE')
     OR has_function_privilege('authenticated',
       'public.record_order_installment_provider_sale(uuid,integer,integer,timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue-3645: record_order_installment_provider_sale EXECUTE-able by anon/authenticated';
  END IF;
  IF NOT has_function_privilege('service_role',
       'public.record_order_installment_provider_sale(uuid,integer,integer,timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue-3645: service_role lost EXECUTE on record_order_installment_provider_sale';
  END IF;
  IF has_function_privilege('anon',
       'public.claim_order_installment_for_charge(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated',
       'public.claim_order_installment_for_charge(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue-3645: claim_order_installment_for_charge EXECUTE-able by anon/authenticated';
  END IF;
  IF NOT has_function_privilege('service_role',
       'public.claim_order_installment_for_charge(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue-3645: service_role lost EXECUTE on claim_order_installment_for_charge';
  END IF;
  IF has_function_privilege('anon',
       'public.cancel_event_refund_prepare(uuid,timestamptz)', 'EXECUTE')
     OR has_function_privilege('authenticated',
       'public.cancel_event_refund_prepare(uuid,timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue-3645: cancel_event_refund_prepare became callable by anon/authenticated';
  END IF;
  IF NOT public.issue_2036_installment_payout_ready() THEN
    NULL; -- expected default
  ELSE
    RAISE EXCEPTION 'issue-3645: issue_2036_installment_payout_ready must default false';
  END IF;
END$$;

NOTIFY pgrst, 'reload schema';
