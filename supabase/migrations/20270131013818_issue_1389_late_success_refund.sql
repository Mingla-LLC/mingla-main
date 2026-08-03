-- Issue #1389: a verified provider success that cannot receive inventory must
-- automatically enter the typed refund queue; it may never wait as hidden debt.

BEGIN;

ALTER TABLE public.stay_cancel_previews
  ALTER COLUMN actor_user_id DROP NOT NULL,
  DROP CONSTRAINT stay_cancel_previews_actor_type_check,
  ADD CONSTRAINT stay_cancel_previews_actor_type_check CHECK (
    actor_type IN ('guest', 'staff', 'admin', 'system')
  );

CREATE OR REPLACE FUNCTION public.issue_1389_queue_late_success_refund()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_group public.stay_reservation_groups%ROWTYPE;
  v_preview public.stay_cancel_previews%ROWTYPE;
  v_refund public.stay_refunds%ROWTYPE;
  v_source public.source_refunds%ROWTYPE;
  v_lines uuid[];
  v_snapshot jsonb;
  v_hash text;
BEGIN
  IF NEW.state <> 'refund_due'
     OR OLD.state = 'refund_due'
     OR NEW.amount_minor <= 0 THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_group
  FROM public.stay_reservation_groups
  WHERE id = NEW.group_id
  FOR UPDATE;
  SELECT array_agg(line.id ORDER BY line.id) INTO v_lines
  FROM public.stay_reservation_lines line
  WHERE line.group_id = NEW.group_id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'paymentAllocationId', allocation.id,
    'reservationLineId', allocation.reservation_line_id,
    'component', allocation.component,
    'componentRef', allocation.component_ref,
    'refundTreatment', 'refundable',
    'refundBasisPoints', 10000,
    'amountMinor', (
      allocation.charged_minor - allocation.refunded_minor
    )::text
  ) ORDER BY allocation.reservation_line_id, allocation.id), '[]'::jsonb)
  INTO v_snapshot
  FROM public.stay_payment_allocations allocation
  WHERE allocation.payment_attempt_id = NEW.id
    AND allocation.charged_minor > allocation.refunded_minor;

  v_hash := encode(
    extensions.digest(
      pg_catalog.convert_to(
        'late-success:' || NEW.id::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
  INSERT INTO public.stay_cancel_previews (
    group_id, actor_user_id, actor_type, selected_line_ids,
    group_version, amount_minor, allocation_snapshot,
    preview_hash, expires_at, consumed_at
  ) VALUES (
    NEW.group_id, NULL, 'system', v_lines,
    v_group.version, NEW.amount_minor, v_snapshot,
    v_hash, now() + interval '100 years', now()
  ) RETURNING * INTO v_preview;

  INSERT INTO public.stay_refunds (
    group_id, payment_attempt_id, cancel_preview_id,
    requested_by_type, requested_by_user_id, reason, state,
    amount_minor, application_fee_reversal_minor,
    currency_code, provider, idempotency_key
  ) VALUES (
    NEW.group_id, NEW.id, v_preview.id,
    'system', NULL, 'Late provider success without confirmed inventory',
    'submitted', NEW.amount_minor, NEW.application_fee_minor,
    NEW.currency_code, NEW.provider,
    'stay-late-success-refund:' || NEW.id
  ) RETURNING * INTO v_refund;

  WITH requested AS (
    SELECT
      allocation.id AS payment_allocation_id,
      allocation.reservation_line_id,
      allocation.charged_minor - allocation.refunded_minor AS amount_minor
    FROM public.stay_payment_allocations allocation
    WHERE allocation.payment_attempt_id = NEW.id
      AND allocation.charged_minor > allocation.refunded_minor
  ),
  floors AS (
    SELECT
      requested.*,
      floor(
        NEW.application_fee_minor::numeric * requested.amount_minor
          / NEW.amount_minor
      )::bigint AS fee_floor,
      (
        NEW.application_fee_minor::numeric * requested.amount_minor
          - floor(
            NEW.application_fee_minor::numeric * requested.amount_minor
              / NEW.amount_minor
          ) * NEW.amount_minor
      ) AS remainder
    FROM requested
  ),
  ranked AS (
    SELECT
      floors.*,
      row_number() OVER (
        ORDER BY remainder DESC, payment_allocation_id
      ) AS remainder_rank,
      NEW.application_fee_minor - sum(fee_floor) OVER () AS extras
    FROM floors
  )
  INSERT INTO public.stay_refund_allocations (
    refund_id, payment_allocation_id, reservation_line_id,
    amount_minor, organizer_liability_minor,
    platform_fee_reversal_minor, state
  )
  SELECT
    v_refund.id,
    ranked.payment_allocation_id,
    ranked.reservation_line_id,
    ranked.amount_minor,
    ranked.amount_minor - (
      ranked.fee_floor
        + CASE WHEN ranked.remainder_rank <= ranked.extras THEN 1 ELSE 0 END
    ),
    ranked.fee_floor
      + CASE WHEN ranked.remainder_rank <= ranked.extras THEN 1 ELSE 0 END,
    'submitted'
  FROM ranked;

  INSERT INTO public.source_refunds (
    source_type, source_id, subject_id, brand_id, venue_id,
    refund_kind, requested_by_type, requested_by_user_id,
    reason, provider, currency, original_charge_cents,
    buyer_refund_requested_cents, original_application_fee_cents,
    fee_reversal_required_cents, fee_state, fee_leg_kind,
    financial_state, organizer_refund_liability_cents,
    platform_fee_absorption_cents, provider_payment_reference,
    provider_account_reference, idempotency_key
  ) VALUES (
    'stay_reservation', v_refund.id, v_group.id,
    v_group.brand_id, v_group.venue_id, 'stay_cancellation',
    'system', NULL, 'Late provider success without confirmed inventory',
    NEW.provider, NEW.currency_code::text,
    NEW.amount_minor::integer, NEW.amount_minor::integer,
    NEW.application_fee_minor::integer,
    NEW.application_fee_minor::integer,
    CASE WHEN NEW.application_fee_minor = 0
      THEN 'not_required' ELSE 'queued' END,
    CASE
      WHEN NEW.application_fee_minor = 0 THEN 'not_required'
      WHEN NEW.provider = 'stripe'
        THEN 'stripe_application_fee_refund'
      ELSE 'paystack_ledger_allocation'
    END,
    'pending',
    (NEW.amount_minor - NEW.application_fee_minor)::integer,
    NEW.application_fee_minor::integer,
    NEW.provider_payment_ref,
    NEW.connected_account_ref,
    'stay-refund:' || v_refund.id
  ) RETURNING * INTO v_source;

  UPDATE public.stay_refunds
  SET source_refund_id = v_source.id, updated_at = now()
  WHERE id = v_refund.id;
  INSERT INTO public.source_refund_ledger_allocations (
    refund_id, allocation_type, amount_cents, currency,
    provider, state, idempotency_key
  ) VALUES (
    v_source.id, 'buyer_refund', v_source.buyer_refund_requested_cents,
    v_source.currency, v_source.provider, 'prepared',
    'source-refund-allocation:buyer:' || v_source.id
  );
  IF v_source.organizer_refund_liability_cents > 0 THEN
    INSERT INTO public.source_refund_ledger_allocations (
      refund_id, allocation_type, amount_cents, currency,
      provider, state, idempotency_key
    ) VALUES (
      v_source.id, 'organizer_refund_liability',
      v_source.organizer_refund_liability_cents,
      v_source.currency, v_source.provider, 'prepared',
      'source-refund-allocation:organizer:' || v_source.id
    );
  END IF;
  IF v_source.platform_fee_absorption_cents > 0 THEN
    INSERT INTO public.source_refund_ledger_allocations (
      refund_id, allocation_type, amount_cents, currency,
      provider, state, idempotency_key
    ) VALUES (
      v_source.id, 'platform_application_fee_reversal',
      v_source.platform_fee_absorption_cents,
      v_source.currency, v_source.provider, 'prepared',
      'source-refund-allocation:platform:' || v_source.id
    );
  END IF;

  INSERT INTO public.stay_money_ledger (
    group_id, payment_attempt_id, refund_id, entry_type,
    amount_minor, currency_code, provider_reference,
    idempotency_key, metadata
  ) VALUES (
    NEW.group_id, NEW.id, v_refund.id, 'refund_requested',
    NEW.amount_minor, NEW.currency_code, NEW.provider_payment_ref,
    'stay:late_refund_requested:' || NEW.id,
    jsonb_build_object('sourceRefundId', v_source.id)
  ) ON CONFLICT (idempotency_key) DO NOTHING;
  INSERT INTO public.stay_reservation_events (
    group_id, event_type, actor_type, idempotency_key, safe_metadata
  ) VALUES (
    NEW.group_id, 'stay_refund_queued', 'service',
    'late-refund-queued:' || NEW.id,
    jsonb_build_object(
      'refundId', v_refund.id,
      'amountMinor', NEW.amount_minor::text,
      'currencyCode', NEW.currency_code
    )
  ) ON CONFLICT (group_id, idempotency_key) DO NOTHING;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER stay_payment_late_success_refund
  AFTER UPDATE OF state ON public.stay_payment_attempts
  FOR EACH ROW
  WHEN (NEW.state = 'refund_due' AND OLD.state IS DISTINCT FROM NEW.state)
  EXECUTE FUNCTION public.issue_1389_queue_late_success_refund();

REVOKE ALL ON FUNCTION public.issue_1389_queue_late_success_refund()
  FROM public, anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
