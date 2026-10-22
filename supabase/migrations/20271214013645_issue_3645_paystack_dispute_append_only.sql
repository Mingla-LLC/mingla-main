-- Issue #3645 — Paystack dispute holds respect the append-only payout ledger.
--
-- MINGLA-INVARIANT: I-3645-PAYSTACK-DISPUTE-APPEND-ONLY | issue #3645 | A Paystack dispute may change the executable release projection, but it never updates or deletes payout_release_items; unresolved disputes fail closed again at final transfer authorization.

BEGIN;

CREATE OR REPLACE FUNCTION public.paystack_release_has_unresolved_dispute(
  p_release_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM public.payout_release_items item
    JOIN public.paystack_disputes dispute ON (
      (item.source_type = 'order' AND dispute.order_id = item.source_id)
      OR (
        item.source_type = 'rsvp_contribution'
        AND dispute.rsvp_contribution_id = item.source_id
      )
      OR (
        item.source_type = 'venue_menu_order'
        AND dispute.venue_menu_order_id = item.source_id
      )
      OR (
        item.source_type = 'venue_reservation'
        AND EXISTS (
          SELECT 1
          FROM public.reservation_checkout_sessions checkout
          WHERE checkout.id = item.source_id
            AND checkout.reservation_id = dispute.venue_reservation_id
        )
      )
    )
    WHERE item.release_id = p_release_id
      AND dispute.is_resolved IS NOT TRUE
  );
$fn$;

REVOKE ALL ON FUNCTION public.paystack_release_has_unresolved_dispute(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.paystack_release_has_unresolved_dispute(uuid)
  TO service_role, postgres;

COMMENT ON FUNCTION public.paystack_release_has_unresolved_dispute(uuid) IS
  'Issue #3645: true when immutable items in a Paystack release are covered by an unresolved provider dispute.';

CREATE OR REPLACE FUNCTION public.refresh_paystack_dispute_release_projection(
  p_release_id uuid,
  p_now timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_release public.brand_payout_releases%ROWTYPE;
  v_disputed integer;
  v_net integer;
  v_unresolved boolean;
BEGIN
  SELECT * INTO v_release
  FROM public.brand_payout_releases
  WHERE id = p_release_id
    AND provider = 'paystack'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'paystack_release_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_release.status = 'released' THEN
    RAISE EXCEPTION 'pending_paystack_release_required' USING ERRCODE = 'P0001';
  END IF;

  WITH item_holds AS (
    SELECT
      item.id,
      item.disputed_cents AS snapshot_disputed_cents,
      item.net_cents AS snapshot_net_cents,
      least(
        item.net_cents::bigint,
        coalesce(sum(dispute.amount_cents::bigint) FILTER (
          WHERE dispute.id IS NOT NULL
            AND (
              dispute.is_resolved IS NOT TRUE
              OR lower(coalesce(dispute.resolution, '')) IN (
                'merchant-accepted', 'merchant_accepted', 'accepted'
              )
            )
        ), 0)
      ) AS hold_cents
    FROM public.payout_release_items item
    LEFT JOIN public.paystack_disputes dispute ON (
      (item.source_type = 'order' AND dispute.order_id = item.source_id)
      OR (
        item.source_type = 'rsvp_contribution'
        AND dispute.rsvp_contribution_id = item.source_id
      )
      OR (
        item.source_type = 'venue_menu_order'
        AND dispute.venue_menu_order_id = item.source_id
      )
      OR (
        item.source_type = 'venue_reservation'
        AND EXISTS (
          SELECT 1
          FROM public.reservation_checkout_sessions checkout
          WHERE checkout.id = item.source_id
            AND checkout.reservation_id = dispute.venue_reservation_id
        )
      )
    )
    WHERE item.release_id = p_release_id
    GROUP BY item.id, item.disputed_cents, item.net_cents
  ), totals AS (
    SELECT
      least(
        coalesce(sum(snapshot_disputed_cents::bigint + hold_cents), 0),
        2147483647::bigint
      )::integer AS disputed_cents,
      least(
        coalesce(sum(snapshot_net_cents::bigint - hold_cents), 0),
        2147483647::bigint
      )::integer AS net_release_cents
    FROM item_holds
  )
  SELECT disputed_cents, net_release_cents
  INTO v_disputed, v_net
  FROM totals;

  v_unresolved := public.paystack_release_has_unresolved_dispute(p_release_id);

  UPDATE public.brand_payout_releases
  SET disputed_cents = v_disputed,
      net_release_cents = v_net,
      status = CASE WHEN status = 'in_flight' THEN 'pending' ELSE status END,
      paystack_execution_claim_id = CASE
        WHEN status = 'in_flight' THEN NULL ELSE paystack_execution_claim_id END,
      paystack_execution_claimed_at = CASE
        WHEN status = 'in_flight' THEN NULL ELSE paystack_execution_claimed_at END,
      error_message = CASE
        WHEN v_unresolved THEN 'paystack_dispute_open'
        WHEN error_message = 'paystack_dispute_open' THEN NULL
        ELSE error_message
      END,
      updated_at = p_now
  WHERE id = p_release_id;

  RETURN jsonb_build_object(
    'release_id', p_release_id,
    'disputed_cents', v_disputed,
    'net_release_cents', v_net,
    'unresolved', v_unresolved
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.refresh_paystack_dispute_release_projection(
  uuid, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_paystack_dispute_release_projection(
  uuid, timestamptz
) TO service_role, postgres;

COMMENT ON FUNCTION public.refresh_paystack_dispute_release_projection(
  uuid, timestamptz
) IS
  'Issue #3645: recomputes the mutable Paystack release projection from immutable payout items plus current provider dispute evidence.';

ALTER FUNCTION public.record_paystack_dispute_outcome(
  text, text, text, text, text, integer, text, text, timestamptz, jsonb, timestamptz
) RENAME TO record_paystack_dispute_outcome_pre_3645_append_only_fix;

REVOKE ALL ON FUNCTION public.record_paystack_dispute_outcome_pre_3645_append_only_fix(
  text, text, text, text, text, integer, text, text, timestamptz, jsonb, timestamptz
) FROM PUBLIC, anon, authenticated, service_role;

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
  v_source_type text;
  v_source_id uuid;
  v_release public.brand_payout_releases%ROWTYPE;
  v_release_found boolean := false;
  v_row public.paystack_disputes%ROWTYPE;
  v_due timestamptz;
  v_merchant_lost boolean;
  v_debt_created boolean := false;
BEGIN
  IF v_dispute_id IS NULL OR v_ref IS NULL THEN
    RAISE EXCEPTION 'invalid_paystack_dispute_outcome' USING ERRCODE = '22023';
  END IF;
  IF v_event NOT IN (
    'charge.dispute.create', 'charge.dispute.remind', 'charge.dispute.resolve'
  ) THEN
    RAISE EXCEPTION 'invalid_paystack_dispute_event' USING ERRCODE = '22023';
  END IF;

  SELECT orders.id, events.brand_id INTO v_order_id, v_brand_id
  FROM public.orders
  JOIN public.events ON events.id = orders.event_id
  WHERE orders.stripe_payment_intent_id = v_ref
  LIMIT 1;
  IF v_order_id IS NULL THEN
    SELECT checkout.order_id, events.brand_id INTO v_order_id, v_brand_id
    FROM public.ticket_checkout_sessions checkout
    JOIN public.orders orders ON orders.id = checkout.order_id
    JOIN public.events events ON events.id = orders.event_id
    WHERE checkout.stripe_payment_intent_id = v_ref
    LIMIT 1;
  END IF;
  IF v_order_id IS NULL THEN
    SELECT contribution.id, contribution.brand_id
    INTO v_contribution_id, v_brand_id
    FROM public.event_rsvp_contributions contribution
    WHERE contribution.stripe_payment_intent_id = v_ref
    LIMIT 1;
  END IF;
  IF v_order_id IS NULL AND v_contribution_id IS NULL THEN
    SELECT checkout.reservation_id, checkout.brand_id
    INTO v_reservation_id, v_brand_id
    FROM public.reservation_checkout_sessions checkout
    WHERE checkout.paystack_reference = v_ref
    LIMIT 1;
  END IF;
  IF v_order_id IS NULL AND v_contribution_id IS NULL AND v_reservation_id IS NULL THEN
    SELECT venue_order.id, venue_order.brand_id
    INTO v_venue_order_id, v_brand_id
    FROM public.venue_orders venue_order
    WHERE venue_order.paystack_reference = v_ref
    LIMIT 1;
  END IF;

  IF v_order_id IS NOT NULL THEN
    v_source_type := 'order';
    v_source_id := v_order_id;
  ELSIF v_contribution_id IS NOT NULL THEN
    v_source_type := 'rsvp_contribution';
    v_source_id := v_contribution_id;
  ELSIF v_reservation_id IS NOT NULL THEN
    SELECT checkout.id INTO v_source_id
    FROM public.reservation_checkout_sessions checkout
    WHERE checkout.reservation_id = v_reservation_id
      AND checkout.status = 'completed'
    ORDER BY checkout.created_at DESC
    LIMIT 1;
    v_source_type := 'venue_reservation';
  ELSIF v_venue_order_id IS NOT NULL THEN
    v_source_type := 'venue_menu_order';
    v_source_id := v_venue_order_id;
  END IF;

  IF v_source_type IS NOT NULL AND v_source_id IS NOT NULL THEN
    SELECT release_row.* INTO v_release
    FROM public.payout_release_items item
    JOIN public.brand_payout_releases release_row ON release_row.id = item.release_id
    WHERE item.source_type = v_source_type
      AND item.source_id = v_source_id
      AND release_row.provider = 'paystack'
    ORDER BY CASE WHEN release_row.status = 'released' THEN 0 ELSE 1 END,
      release_row.created_at DESC
    LIMIT 1
    FOR UPDATE OF release_row;
    v_release_found := FOUND;
  END IF;

  IF NOT v_release_found OR v_release.status = 'released' OR v_amount = 0 THEN
    RETURN public.record_paystack_dispute_outcome_pre_3645_append_only_fix(
      p_paystack_dispute_id, p_transaction_reference, p_event_name, p_status,
      p_resolution, p_amount_cents, p_currency, p_reason, p_due_at, p_raw, p_now
    );
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
    is_resolved = public.paystack_disputes.is_resolved OR excluded.is_resolved,
    raw_event = excluded.raw_event,
    updated_at = excluded.updated_at
  RETURNING * INTO v_row;

  v_merchant_lost := v_event = 'charge.dispute.resolve'
    AND lower(coalesce(v_resolution, '')) IN (
      'merchant-accepted', 'merchant_accepted', 'accepted'
    );

  PERFORM public.refresh_paystack_dispute_release_projection(v_release.id, p_now);

  IF v_merchant_lost AND NOT v_row.debt_opened THEN
    -- No debt is opened before cash leaves. This flag means the liability was
    -- already accounted in the release projection, preventing a replay after
    -- release from charging the host a second time.
    UPDATE public.paystack_disputes
    SET debt_opened = true, updated_at = p_now
    WHERE id = v_row.id;
    v_debt_created := true;
  END IF;

  RETURN jsonb_build_object(
    'dispute_id', v_row.id,
    'paystack_dispute_id', v_dispute_id,
    'matched', true,
    'brand_id', v_row.brand_id,
    'order_id', v_row.order_id,
    'venue_reservation_id', v_row.venue_reservation_id,
    'rsvp_contribution_id', v_row.rsvp_contribution_id,
    'venue_menu_order_id', v_row.venue_menu_order_id,
    'response_due_by', v_row.response_due_by,
    'is_resolved', v_row.is_resolved OR v_event = 'charge.dispute.resolve',
    'merchant_lost', v_merchant_lost,
    'debt_created', v_debt_created,
    'debt_id', NULL
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.record_paystack_dispute_outcome(
  text, text, text, text, text, integer, text, text, timestamptz, jsonb, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_paystack_dispute_outcome(
  text, text, text, text, text, integer, text, text, timestamptz, jsonb, timestamptz
) TO service_role;

COMMENT ON FUNCTION public.record_paystack_dispute_outcome(
  text, text, text, text, text, integer, text, text, timestamptz, jsonb, timestamptz
) IS
  'Issue #3645: idempotent Paystack dispute ingest; pending releases are projected from immutable items and provider evidence, while released cash uses append-only adjustment debt.';

CREATE OR REPLACE FUNCTION public.authorize_paystack_payout_execution(
  p_release_id uuid,
  p_claim_id uuid,
  p_now timestamptz DEFAULT now()
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_release public.brand_payout_releases%ROWTYPE;
  v_event_status text;
BEGIN
  SELECT * INTO v_release
  FROM public.brand_payout_releases
  WHERE id = p_release_id AND provider = 'paystack'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'paystack_release_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Fail closed before the stale-claim check so a dispute arriving between
  -- claim and authorization cleanly cancels that attempt without provider I/O.
  IF public.paystack_release_has_unresolved_dispute(p_release_id) THEN
    UPDATE public.brand_payout_releases
    SET status = 'pending',
        error_message = 'paystack_dispute_open',
        paystack_execution_claim_id = NULL,
        paystack_execution_claimed_at = NULL,
        updated_at = p_now
    WHERE id = p_release_id;
    RETURN false;
  END IF;

  IF v_release.paystack_execution_claim_id IS DISTINCT FROM p_claim_id
     OR v_release.status <> 'in_flight'
     OR v_release.paystack_transfer_code IS NOT NULL THEN
    RAISE EXCEPTION 'stale_paystack_execution_claim' USING ERRCODE = 'P0001';
  END IF;

  IF v_release.event_id IS NOT NULL THEN
    SELECT status INTO v_event_status
    FROM public.events
    WHERE id = v_release.event_id;
    IF v_event_status IS NULL THEN
      UPDATE public.brand_payout_releases
      SET status = 'blocked_anchor',
          error_message = 'missing_live_event_truth',
          paystack_execution_claim_id = NULL,
          paystack_execution_claimed_at = NULL,
          updated_at = p_now
      WHERE id = p_release_id;
      RETURN false;
    END IF;
    IF v_event_status = 'cancelled' THEN
      UPDATE public.brand_payout_releases
      SET status = 'cancelled_event',
          error_message = 'event_cancelled_before_paystack_transfer',
          paystack_execution_claim_id = NULL,
          paystack_execution_claimed_at = NULL,
          updated_at = p_now
      WHERE id = p_release_id;
      RETURN false;
    END IF;
  END IF;

  IF v_release.releasable_at > p_now THEN
    UPDATE public.brand_payout_releases
    SET status = 'pending',
        error_message = 'release_no_longer_mature',
        paystack_execution_claim_id = NULL,
        paystack_execution_claimed_at = NULL,
        updated_at = p_now
    WHERE id = p_release_id;
    RETURN false;
  END IF;

  RETURN true;
END;
$fn$;

REVOKE ALL ON FUNCTION public.authorize_paystack_payout_execution(
  uuid, uuid, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_paystack_payout_execution(
  uuid, uuid, timestamptz
) TO service_role;

COMMIT;
