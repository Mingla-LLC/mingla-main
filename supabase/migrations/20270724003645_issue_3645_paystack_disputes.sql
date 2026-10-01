-- Issue #3645 PR4 — Paystack chargeback receive + organiser debt recovery.
-- Observability table + SECURITY DEFINER recorder. On resolve with
-- merchant-accepted (includes 16h auto-accept), opens post_release_dispute
-- debt under the PR3 delivered-cash room cap. Declined (merchant win) records
-- only — no debt. Recovery rides apply_open_payout_debts unchanged.
-- Docs: https://paystack.com/docs/payments/manage-disputes/
--       https://support.paystack.com/en/articles/2125698 (16h NG auto-accept)

BEGIN;

CREATE TABLE public.paystack_disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paystack_dispute_id text NOT NULL UNIQUE,
  transaction_reference text NOT NULL,
  brand_id uuid REFERENCES public.brands(id),
  order_id uuid REFERENCES public.orders(id),
  venue_reservation_id uuid REFERENCES public.reservations(id),
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  currency text NOT NULL CHECK (currency = lower(currency) AND length(currency) = 3),
  status text NOT NULL,
  resolution text,
  reason text,
  response_due_by timestamptz,
  is_resolved boolean NOT NULL DEFAULT false,
  debt_opened boolean NOT NULL DEFAULT false,
  raw_event jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT paystack_disputes_single_subject CHECK (
    (order_id IS NOT NULL AND venue_reservation_id IS NULL)
    OR (order_id IS NULL AND venue_reservation_id IS NOT NULL)
    OR (order_id IS NULL AND venue_reservation_id IS NULL)
  )
);

CREATE INDEX idx_paystack_disputes_brand_id ON public.paystack_disputes(brand_id);
CREATE INDEX idx_paystack_disputes_order_id ON public.paystack_disputes(order_id);
CREATE INDEX idx_paystack_disputes_status ON public.paystack_disputes(status);
CREATE INDEX idx_paystack_disputes_tx_ref ON public.paystack_disputes(transaction_reference);

ALTER TABLE public.paystack_disputes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_paystack_disputes"
  ON public.paystack_disputes FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "brand_payment_managers_select_paystack_disputes"
  ON public.paystack_disputes FOR SELECT TO authenticated
  USING (
    brand_id IN (
      SELECT brand_id
      FROM public.brand_team_members
      WHERE user_id = auth.uid()
        AND removed_at IS NULL
        AND accepted_at IS NOT NULL
        AND role IN ('account_owner', 'brand_admin', 'finance_manager')
    )
  );

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
  v_adj_key text;
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

  -- Resolve subject: ticket order by payment reference, else venue reservation.
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
    SELECT rcs.reservation_id, rcs.brand_id INTO v_reservation_id, v_brand_id
    FROM public.reservation_checkout_sessions rcs
    WHERE rcs.paystack_reference = v_ref
    LIMIT 1;
  END IF;

  v_due := coalesce(p_due_at, p_now + interval '16 hours');

  INSERT INTO public.paystack_disputes(
    paystack_dispute_id, transaction_reference, brand_id, order_id,
    venue_reservation_id, amount_cents, currency, status, resolution,
    reason, response_due_by, is_resolved, raw_event, created_at, updated_at
  ) VALUES (
    v_dispute_id, v_ref, v_brand_id, v_order_id, v_reservation_id,
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

  -- Merchant lost when Paystack records merchant-accepted (includes auto-accept).
  v_merchant_lost := v_event = 'charge.dispute.resolve'
    AND lower(coalesce(v_resolution, '')) IN (
      'merchant-accepted', 'merchant_accepted', 'accepted'
    );

  IF v_merchant_lost AND NOT v_row.debt_opened AND v_row.amount_cents > 0 THEN
    IF v_row.order_id IS NOT NULL THEN
      v_source_type := 'order';
      v_source_id := v_row.order_id;
    ELSIF v_row.venue_reservation_id IS NOT NULL THEN
      SELECT rcs.id INTO v_source_id
      FROM public.reservation_checkout_sessions rcs
      WHERE rcs.reservation_id = v_row.venue_reservation_id
        AND rcs.status = 'completed'
      ORDER BY rcs.created_at DESC
      LIMIT 1;
      v_source_type := 'venue_reservation';
    END IF;

    IF v_source_type IS NOT NULL AND v_source_id IS NOT NULL THEN
      SELECT r.* INTO v_release
      FROM public.payout_release_items pri
      JOIN public.brand_payout_releases r ON r.id = pri.release_id
      WHERE pri.source_type = v_source_type
        AND pri.source_id = v_source_id
        AND r.provider = 'paystack'
        AND r.status = 'released'
      LIMIT 1
      FOR UPDATE OF r;

      IF FOUND THEN
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
            UPDATE public.organiser_payout_debts SET
              principal_cents = v_target,
              status = CASE WHEN recovered_cents = v_target THEN 'closed' ELSE 'open' END,
              closed_at = CASE WHEN recovered_cents = v_target THEN p_now ELSE NULL END,
              updated_at = p_now
            WHERE id = v_debt.id;
            v_debt_id := v_debt.id;
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
  END IF;

  RETURN jsonb_build_object(
    'dispute_id', v_row.id,
    'paystack_dispute_id', v_dispute_id,
    'matched', (v_row.order_id IS NOT NULL OR v_row.venue_reservation_id IS NOT NULL),
    'brand_id', v_row.brand_id,
    'order_id', v_row.order_id,
    'venue_reservation_id', v_row.venue_reservation_id,
    'response_due_by', v_row.response_due_by,
    'is_resolved', v_row.is_resolved OR v_event = 'charge.dispute.resolve',
    'merchant_lost', v_merchant_lost,
    'debt_created', v_debt_created,
    'debt_id', v_debt_id
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
  'Issue #3645: idempotent Paystack dispute ingest; opens post_release_dispute '
  'debt when resolve = merchant-accepted (16h auto-accept included).';

COMMIT;
