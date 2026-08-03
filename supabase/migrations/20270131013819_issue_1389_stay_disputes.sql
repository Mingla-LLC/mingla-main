-- Issue #1389: typed Stripe dispute containment for Stay charges.

BEGIN;

CREATE OR REPLACE FUNCTION public.issue_1389_record_stay_dispute(
  p_provider_event_id text,
  p_provider_event_type text,
  p_provider_charge_ref text,
  p_dispute_ref text,
  p_amount_minor integer,
  p_currency_code text,
  p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_attempt public.stay_payment_attempts%ROWTYPE;
  v_group public.stay_reservation_groups%ROWTYPE;
  v_event_id uuid;
  v_line record;
  v_resolved boolean := lower(p_status) IN ('won', 'warning_closed');
  v_release public.brand_payout_releases%ROWTYPE;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_amount_minor < 0
     OR upper(COALESCE(p_currency_code, '')) !~ '^[A-Z]{3}$'
     OR char_length(COALESCE(p_provider_event_id, '')) NOT BETWEEN 3 AND 240
     OR char_length(COALESCE(p_provider_charge_ref, '')) NOT BETWEEN 3 AND 200
     OR char_length(COALESCE(p_dispute_ref, '')) NOT BETWEEN 3 AND 200 THEN
    RAISE EXCEPTION 'stay_invalid_payload' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_attempt
  FROM public.stay_payment_attempts
  WHERE provider = 'stripe'
    AND (
      provider_charge_ref = p_provider_charge_ref
      OR provider_payment_ref = p_provider_charge_ref
    )
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('matched', false);
  END IF;
  SELECT * INTO v_group
  FROM public.stay_reservation_groups
  WHERE id = v_attempt.group_id
  FOR UPDATE;
  IF v_attempt.currency_code <> upper(p_currency_code)::character(3)
     OR p_amount_minor > v_attempt.amount_minor THEN
    RAISE EXCEPTION 'stay_provider_evidence_mismatch'
      USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.stay_provider_events (
    provider, provider_event_id, provider_event_type,
    payment_attempt_id, event_fingerprint, safe_payload
  ) VALUES (
    'stripe', p_provider_event_id, p_provider_event_type,
    v_attempt.id,
    encode(extensions.digest(
      pg_catalog.convert_to(
        p_provider_event_id || ':' || p_dispute_ref || ':' || p_status,
        'UTF8'
      ),
      'sha256'
    ), 'hex'),
    jsonb_build_object(
      'disputeRef', p_dispute_ref,
      'amountMinor', p_amount_minor::text,
      'currencyCode', upper(p_currency_code),
      'status', lower(p_status)
    )
  )
  ON CONFLICT (provider, provider_event_id) DO NOTHING
  RETURNING id INTO v_event_id;
  IF v_event_id IS NULL THEN
    RETURN jsonb_build_object(
      'matched', true,
      'groupId', v_group.id,
      'replayed', true
    );
  END IF;

  IF v_resolved THEN
    UPDATE public.stay_reservation_lines
    SET state = 'confirmed', version = version + 1, updated_at = now()
    WHERE group_id = v_group.id
      AND state = 'reconciliation_required';
    UPDATE public.stay_reservation_groups
    SET state = 'confirmed', version = version + 1, updated_at = now()
    WHERE id = v_group.id
      AND state = 'reconciliation_required'
      AND NOT EXISTS (
        SELECT 1 FROM public.stay_refunds refund_row
        WHERE refund_row.group_id = v_group.id
          AND refund_row.state IN (
            'submitted', 'processing', 'manual_reconciliation'
          )
      );
  ELSE
    UPDATE public.stay_reservation_lines
    SET state = 'reconciliation_required',
        version = version + 1,
        updated_at = now()
    WHERE group_id = v_group.id AND state = 'confirmed';
    UPDATE public.stay_reservation_groups
    SET state = 'reconciliation_required',
        version = version + 1,
        updated_at = now()
    WHERE id = v_group.id
      AND state IN ('confirmed', 'partially_cancelled');
  END IF;

  FOR v_line IN
    WITH weights AS (
      SELECT
        line.id,
        line.total_minor,
        floor(
          p_amount_minor::numeric * line.total_minor
            / v_attempt.amount_minor
        )::integer AS amount_floor,
        (
          p_amount_minor::numeric * line.total_minor
            - floor(
              p_amount_minor::numeric * line.total_minor
                / v_attempt.amount_minor
            ) * v_attempt.amount_minor
        ) AS remainder
      FROM public.stay_reservation_lines line
      WHERE line.group_id = v_group.id
        AND line.state <> 'cancelled'
    ),
    ranked AS (
      SELECT
        weights.*,
        row_number() OVER (ORDER BY remainder DESC, id) AS remainder_rank,
        p_amount_minor - sum(amount_floor) OVER () AS extras
      FROM weights
    )
    SELECT
      id AS line_id,
      amount_floor
        + CASE WHEN remainder_rank <= extras THEN 1 ELSE 0 END
        AS disputed_minor
    FROM ranked
    ORDER BY id
  LOOP
    SELECT release_row.* INTO v_release
    FROM public.payout_release_items item
    JOIN public.brand_payout_releases release_row
      ON release_row.id = item.release_id
    WHERE item.source_type = 'stay_reservation'
      AND item.source_id = v_line.line_id
    FOR UPDATE OF release_row;
    IF FOUND AND v_release.status <> 'released' THEN
      UPDATE public.payout_release_items
      SET disputed_cents = CASE WHEN v_resolved
            THEN 0 ELSE v_line.disputed_minor END,
          net_cents = GREATEST(
            0,
            gross_cents - refunded_cents
              - CASE WHEN v_resolved THEN 0 ELSE v_line.disputed_minor END
              - mingla_fee_cents - partner_share_cents
              - provider_fee_cents
          )
      WHERE source_type = 'stay_reservation'
        AND source_id = v_line.line_id;
      UPDATE public.brand_payout_releases release_row
      SET disputed_cents = totals.disputed,
          net_release_cents = totals.net,
          updated_at = now()
      FROM (
        SELECT
          sum(item.disputed_cents)::integer AS disputed,
          sum(item.net_cents)::integer AS net
        FROM public.payout_release_items item
        WHERE item.release_id = v_release.id
      ) totals
      WHERE release_row.id = v_release.id;
    ELSIF FOUND AND v_release.status = 'released'
      AND v_line.disputed_minor > 0 THEN
      INSERT INTO public.payout_ledger_adjustments (
        release_id, brand_id, currency, kind, amount_cents,
        provider_ref, idempotency_key
      ) VALUES (
        v_release.id, v_release.brand_id, v_release.currency,
        CASE WHEN v_resolved
          THEN 'dispute_reversal' ELSE 'post_release_dispute' END,
        v_line.disputed_minor, p_dispute_ref,
        'stay-dispute:' || p_dispute_ref || ':' ||
          v_line.line_id || ':' ||
          CASE WHEN v_resolved THEN 'resolved' ELSE 'opened' END
      ) ON CONFLICT (idempotency_key) DO NOTHING;
      IF NOT v_resolved THEN
        PERFORM public.convert_postponement_debt_to_permanent(
          v_release.id,
          'post_release_dispute',
          LEAST(
            v_line.disputed_minor,
            v_release.organiser_cash_delivered_cents
          ),
          now()
        );
      END IF;
    END IF;

    INSERT INTO public.stay_money_ledger (
      group_id, line_id, payment_attempt_id, entry_type,
      amount_minor, currency_code, provider_reference,
      idempotency_key, metadata
    ) VALUES (
      v_group.id, v_line.line_id, v_attempt.id,
      CASE WHEN v_resolved THEN 'payout_reversed' ELSE 'chargeback' END,
      v_line.disputed_minor, v_attempt.currency_code, p_dispute_ref,
      'stay:dispute:' || p_dispute_ref || ':' || v_line.line_id ||
        ':' || CASE WHEN v_resolved THEN 'resolved' ELSE 'opened' END,
      jsonb_build_object('status', lower(p_status))
    ) ON CONFLICT (idempotency_key) DO NOTHING;
  END LOOP;

  INSERT INTO public.stay_reservation_events (
    group_id, event_type, actor_type, idempotency_key, safe_metadata
  ) VALUES (
    v_group.id,
    CASE WHEN v_resolved
      THEN 'stay_dispute_resolved' ELSE 'stay_dispute_recorded' END,
    'service',
    'dispute:' || p_dispute_ref || ':' ||
      CASE WHEN v_resolved THEN 'resolved' ELSE 'opened' END,
    jsonb_build_object(
      'disputeRef', p_dispute_ref,
      'amountMinor', p_amount_minor::text,
      'currencyCode', upper(p_currency_code),
      'status', lower(p_status)
    )
  ) ON CONFLICT (group_id, idempotency_key) DO NOTHING;
  RETURN jsonb_build_object(
    'matched', true,
    'groupId', v_group.id,
    'brandId', v_group.brand_id,
    'resolved', v_resolved
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_1389_record_stay_dispute(
  text, text, text, text, integer, text, text
) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1389_record_stay_dispute(
  text, text, text, text, integer, text, text
) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
