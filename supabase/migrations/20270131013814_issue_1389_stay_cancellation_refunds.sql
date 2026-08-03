-- Issue #1389: selected/whole-group cancellation and exact refund allocation.

BEGIN;

CREATE OR REPLACE FUNCTION public.issue_1389_line_start_at(
  p_line_id uuid
)
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT CASE line.kind
    WHEN 'room' THEN
      line.room_check_in::timestamp AT TIME ZONE settings.timezone
    ELSE window_row.starts_at
  END
  FROM public.stay_reservation_lines line
  JOIN public.stay_reservation_groups group_row ON group_row.id = line.group_id
  JOIN public.stay_settings settings ON settings.venue_id = group_row.venue_id
  LEFT JOIN public.stay_place_windows window_row
    ON window_row.id = line.place_window_id
  WHERE line.id = p_line_id;
$function$;

CREATE OR REPLACE FUNCTION public.issue_1389_cancel_preview(
  p_group_id uuid,
  p_selected_line_ids uuid[],
  p_expected_group_version bigint,
  p_request_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_group public.stay_reservation_groups%ROWTYPE;
  v_attempt public.stay_payment_attempts%ROWTYPE;
  v_actor_type text;
  v_selected uuid[];
  v_snapshot jsonb;
  v_amount bigint;
  v_preview_id uuid := gen_random_uuid();
  v_hash text;
  v_expires_at timestamptz := now() + interval '10 minutes';
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF NOT public.issue_1389_flag_enabled('STAY_RESERVE_WRITES') THEN
    RAISE EXCEPTION 'stay_rail_not_enabled' USING ERRCODE = 'P0001';
  END IF;
  IF p_group_id IS NULL
     OR p_expected_group_version IS NULL
     OR cardinality(p_selected_line_ids) NOT BETWEEN 1 AND 50
     OR array_position(p_selected_line_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'stay_invalid_payload' USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(DISTINCT selected_id ORDER BY selected_id)
  INTO v_selected
  FROM unnest(p_selected_line_ids) selected_id;
  IF cardinality(v_selected) <> cardinality(p_selected_line_ids) THEN
    RAISE EXCEPTION 'stay_invalid_payload' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_group
  FROM public.stay_reservation_groups
  WHERE id = p_group_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stay_group_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_group.user_id = v_uid THEN
    v_actor_type := 'guest';
  ELSIF public.is_admin_user() THEN
    v_actor_type := 'admin';
  ELSIF public.issue_1387_has_brand_capability(
    v_group.brand_id,
    v_uid,
    'inventory'
  ) THEN
    v_actor_type := 'staff';
  ELSE
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_group.version <> p_expected_group_version THEN
    RAISE EXCEPTION 'stay_version_conflict' USING ERRCODE = '40001';
  END IF;
  IF v_group.state NOT IN ('confirmed', 'partially_cancelled') THEN
    RAISE EXCEPTION 'stay_invalid_transition' USING ERRCODE = '40001';
  END IF;
  IF (
    SELECT count(*) FROM public.stay_reservation_lines line
    WHERE line.group_id = p_group_id
      AND line.id = ANY(v_selected)
      AND line.state = 'confirmed'
  ) <> cardinality(v_selected) THEN
    RAISE EXCEPTION 'stay_invalid_payload' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.stay_reservation_lines room_line
    JOIN public.stay_reservation_lines place_line
      ON place_line.dependency_room_line_id = room_line.id
    WHERE room_line.id = ANY(v_selected)
      AND room_line.kind = 'room'
      AND place_line.group_id = p_group_id
      AND place_line.state = 'confirmed'
      AND NOT (place_line.id = ANY(v_selected))
  ) THEN
    RAISE EXCEPTION 'stay_dependent_place_requires_room'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_attempt
  FROM public.stay_payment_attempts
  WHERE group_id = p_group_id AND state = 'succeeded'
  ORDER BY succeeded_at DESC, id DESC
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stay_payment_not_found' USING ERRCODE = 'P0002';
  END IF;

  WITH eligible AS (
    SELECT
      allocation.id AS payment_allocation_id,
      allocation.reservation_line_id,
      allocation.component,
      allocation.component_ref,
      allocation.refund_treatment,
      GREATEST(
        0,
        allocation.charged_minor
          - allocation.refunded_minor
          - COALESCE((
            SELECT sum(refund_allocation.amount_minor)
            FROM public.stay_refund_allocations refund_allocation
            JOIN public.stay_refunds refund_row
              ON refund_row.id = refund_allocation.refund_id
            WHERE refund_allocation.payment_allocation_id = allocation.id
              AND refund_row.state IN (
                'submitted', 'processing', 'manual_reconciliation'
              )
          ), 0)
      ) AS outstanding_minor,
      CASE
        WHEN allocation.refund_treatment = 'refundable' THEN 10000
        WHEN allocation.refund_treatment = 'nonrefundable' THEN 0
        WHEN v_actor_type IN ('staff', 'admin') THEN
          COALESCE(
            (line.policy_snapshot->>'operator_cancel_refund_basis_points')
              ::integer,
            10000
          )
        WHEN now() < public.issue_1389_line_start_at(line.id)
          - make_interval(mins => COALESCE(
            (line.policy_snapshot->>'free_cancel_cutoff_minutes')::integer,
            0
          )) THEN 10000
        WHEN now() < public.issue_1389_line_start_at(line.id) THEN
          COALESCE(
            (line.policy_snapshot->>'late_refund_basis_points')::integer,
            0
          )
        ELSE COALESCE(
          (line.policy_snapshot->>'no_show_refund_basis_points')::integer,
          0
        )
      END AS refund_basis_points
    FROM public.stay_payment_allocations allocation
    JOIN public.stay_reservation_lines line
      ON line.id = allocation.reservation_line_id
    WHERE allocation.payment_attempt_id = v_attempt.id
      AND allocation.reservation_line_id = ANY(v_selected)
  ),
  calculated AS (
    SELECT
      eligible.*,
      LEAST(
        outstanding_minor,
        (
          outstanding_minor::numeric * refund_basis_points + 5000
        )::bigint / 10000
      ) AS refund_minor
    FROM eligible
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'paymentAllocationId', payment_allocation_id,
      'reservationLineId', reservation_line_id,
      'component', component,
      'componentRef', component_ref,
      'refundTreatment', refund_treatment,
      'refundBasisPoints', refund_basis_points,
      'amountMinor', refund_minor::text
    ) ORDER BY reservation_line_id, payment_allocation_id), '[]'::jsonb),
    COALESCE(sum(refund_minor), 0)
  INTO v_snapshot, v_amount
  FROM calculated
  WHERE refund_minor > 0;

  v_hash := encode(
    extensions.digest(
      pg_catalog.convert_to(jsonb_build_object(
        'previewId', v_preview_id,
        'groupId', p_group_id,
        'groupVersion', v_group.version,
        'actorUserId', v_uid,
        'selectedLineIds', to_jsonb(v_selected),
        'amountMinor', v_amount::text,
        'allocations', v_snapshot,
        'expiresAt', v_expires_at
      )::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  INSERT INTO public.stay_cancel_previews (
    id, group_id, actor_user_id, actor_type, selected_line_ids,
    group_version, amount_minor, allocation_snapshot, preview_hash, expires_at
  ) VALUES (
    v_preview_id, p_group_id, v_uid, v_actor_type, v_selected,
    v_group.version, v_amount, v_snapshot, v_hash, v_expires_at
  );

  RETURN jsonb_build_object(
    'previewId', v_preview_id,
    'previewHash', v_hash,
    'groupId', p_group_id,
    'groupVersion', v_group.version,
    'selectedLineIds', to_jsonb(v_selected),
    'amountMinor', v_amount::text,
    'currencyCode', v_group.currency_code,
    'allocations', v_snapshot,
    'expiresAt', v_expires_at
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_1389_cancel(
  p_preview_id uuid,
  p_preview_hash text,
  p_idempotency_key text,
  p_reason text,
  p_request_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_preview public.stay_cancel_previews%ROWTYPE;
  v_group public.stay_reservation_groups%ROWTYPE;
  v_attempt public.stay_payment_attempts%ROWTYPE;
  v_refund public.stay_refunds%ROWTYPE;
  v_source public.source_refunds%ROWTYPE;
  v_allocation jsonb;
  v_fee_reversal bigint;
  v_fee_remaining bigint;
  v_existing_fee bigint;
  v_all_active_selected boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF NOT public.issue_1389_flag_enabled('STAY_RESERVE_WRITES') THEN
    RAISE EXCEPTION 'stay_rail_not_enabled' USING ERRCODE = 'P0001';
  END IF;
  IF p_preview_id IS NULL
     OR p_preview_hash !~ '^[a-f0-9]{64}$'
     OR char_length(pg_catalog.btrim(COALESCE(p_idempotency_key, '')))
       NOT BETWEEN 8 AND 200
     OR char_length(pg_catalog.btrim(COALESCE(p_reason, '')))
       NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'stay_invalid_payload' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'stay-cancel:' || p_preview_id::text,
      1389
    )
  );
  SELECT * INTO v_refund
  FROM public.stay_refunds
  WHERE idempotency_key = pg_catalog.btrim(p_idempotency_key);
  IF FOUND THEN
    RETURN jsonb_build_object(
      'refundId', v_refund.id,
      'groupId', v_refund.group_id,
      'state', v_refund.state,
      'amountMinor', v_refund.amount_minor::text,
      'currencyCode', v_refund.currency_code
    );
  END IF;

  SELECT * INTO v_preview
  FROM public.stay_cancel_previews
  WHERE id = p_preview_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_preview.actor_user_id <> v_uid
     OR v_preview.preview_hash <> p_preview_hash THEN
    RAISE EXCEPTION 'stay_cancel_preview_invalid' USING ERRCODE = '22023';
  END IF;
  IF v_preview.consumed_at IS NOT NULL OR v_preview.expires_at <= now() THEN
    RAISE EXCEPTION 'stay_cancel_preview_expired' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_group
  FROM public.stay_reservation_groups
  WHERE id = v_preview.group_id
  FOR UPDATE;
  IF v_group.version <> v_preview.group_version
     OR v_group.state NOT IN ('confirmed', 'partially_cancelled') THEN
    RAISE EXCEPTION 'stay_version_conflict' USING ERRCODE = '40001';
  END IF;
  SELECT * INTO v_attempt
  FROM public.stay_payment_attempts
  WHERE group_id = v_group.id AND state = 'succeeded'
  ORDER BY succeeded_at DESC, id DESC
  LIMIT 1
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stay_payment_not_found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM 1
  FROM public.stay_payment_allocations allocation
  WHERE allocation.payment_attempt_id = v_attempt.id
    AND allocation.reservation_line_id = ANY(v_preview.selected_line_ids)
  ORDER BY allocation.reservation_line_id, allocation.id
  FOR UPDATE;
  PERFORM 1
  FROM public.stay_inventory_commitments commitment
  WHERE commitment.group_id = v_group.id
    AND commitment.reservation_line_id = ANY(v_preview.selected_line_ids)
    AND commitment.state = 'active'
  ORDER BY
    commitment.resource_type,
    commitment.offering_id,
    commitment.room_date,
    commitment.place_window_id,
    commitment.exclusive_unit_id
  FOR UPDATE;

  IF EXISTS (
    SELECT 1
    FROM public.stay_reservation_lines room_line
    JOIN public.stay_reservation_lines place_line
      ON place_line.dependency_room_line_id = room_line.id
    WHERE room_line.id = ANY(v_preview.selected_line_ids)
      AND room_line.kind = 'room'
      AND place_line.group_id = v_group.id
      AND place_line.state = 'confirmed'
      AND NOT (place_line.id = ANY(v_preview.selected_line_ids))
  ) THEN
    RAISE EXCEPTION 'stay_dependent_place_requires_room'
      USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(sum(application_fee_reversal_minor), 0)
  INTO v_existing_fee
  FROM public.stay_refunds prior_refund
  WHERE prior_refund.payment_attempt_id = v_attempt.id
    AND prior_refund.state IN (
      'submitted', 'processing', 'succeeded', 'manual_reconciliation'
    );
  v_fee_remaining := GREATEST(
    0,
    v_attempt.application_fee_minor - v_existing_fee
  );
  v_fee_reversal := CASE
    WHEN v_preview.amount_minor = 0 THEN 0
    WHEN v_preview.amount_minor >= (
      SELECT COALESCE(sum(
        allocation.charged_minor - allocation.refunded_minor
      ), 0)
      FROM public.stay_payment_allocations allocation
      WHERE allocation.payment_attempt_id = v_attempt.id
    ) THEN v_fee_remaining
    ELSE LEAST(
      v_fee_remaining,
      (
        v_attempt.application_fee_minor::numeric
          * v_preview.amount_minor
          + v_attempt.amount_minor / 2
      )::bigint / v_attempt.amount_minor
    )
  END;

  INSERT INTO public.stay_refunds (
    group_id, payment_attempt_id, cancel_preview_id,
    requested_by_type, requested_by_user_id, reason, state,
    amount_minor, application_fee_reversal_minor, currency_code,
    provider, idempotency_key
  ) VALUES (
    v_group.id, v_attempt.id, v_preview.id,
    v_preview.actor_type, v_uid, pg_catalog.btrim(p_reason),
    CASE WHEN v_preview.amount_minor = 0 THEN 'succeeded' ELSE 'submitted' END,
    v_preview.amount_minor, v_fee_reversal, v_group.currency_code,
    v_attempt.provider, pg_catalog.btrim(p_idempotency_key)
  ) RETURNING * INTO v_refund;

  IF v_preview.amount_minor > 0 THEN
    WITH requested AS (
      SELECT
        (item->>'paymentAllocationId')::uuid AS payment_allocation_id,
        (item->>'reservationLineId')::uuid AS reservation_line_id,
        (item->>'amountMinor')::bigint AS amount_minor
      FROM jsonb_array_elements(v_preview.allocation_snapshot) item
    ),
    floors AS (
      SELECT
        requested.*,
        floor(
          v_fee_reversal::numeric * requested.amount_minor
          / v_preview.amount_minor
        )::bigint AS fee_floor,
        (
          v_fee_reversal::numeric * requested.amount_minor
          - floor(
            v_fee_reversal::numeric * requested.amount_minor
            / v_preview.amount_minor
          ) * v_preview.amount_minor
        ) AS remainder
      FROM requested
    ),
    ranked AS (
      SELECT
        floors.*,
        row_number() OVER (
          ORDER BY remainder DESC, payment_allocation_id
        ) AS remainder_rank,
        v_fee_reversal - sum(fee_floor) OVER () AS extras
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
      source_type, source_id, subject_id, brand_id, venue_id, refund_kind,
      requested_by_type, requested_by_user_id, reason, provider, currency,
      original_charge_cents, buyer_refund_requested_cents,
      original_application_fee_cents, fee_reversal_required_cents,
      fee_state, fee_leg_kind, financial_state,
      organizer_refund_liability_cents, platform_fee_absorption_cents,
      provider_payment_reference, provider_account_reference, idempotency_key
    ) VALUES (
      'stay_reservation', v_refund.id, v_group.id, v_group.brand_id,
      v_group.venue_id, 'stay_cancellation',
      CASE v_preview.actor_type
        WHEN 'guest' THEN 'consumer'
        WHEN 'admin' THEN 'admin'
        ELSE 'brand_staff'
      END,
      v_uid, pg_catalog.btrim(p_reason), v_attempt.provider,
      v_group.currency_code::text, v_attempt.amount_minor::integer,
      v_refund.amount_minor::integer,
      v_attempt.application_fee_minor::integer,
      v_fee_reversal::integer,
      CASE WHEN v_fee_reversal = 0 THEN 'not_required' ELSE 'queued' END,
      CASE
        WHEN v_fee_reversal = 0 THEN 'not_required'
        WHEN v_attempt.provider = 'stripe'
          THEN 'stripe_application_fee_refund'
        ELSE 'paystack_ledger_allocation'
      END,
      'pending',
      (v_refund.amount_minor - v_fee_reversal)::integer,
      v_fee_reversal::integer,
      v_attempt.provider_payment_ref,
      v_attempt.connected_account_ref,
      'stay-refund:' || v_refund.id
    ) RETURNING * INTO v_source;

    UPDATE public.stay_refunds
    SET source_refund_id = v_source.id,
        updated_at = now()
    WHERE id = v_refund.id
    RETURNING * INTO v_refund;

    INSERT INTO public.source_refund_ledger_allocations (
      refund_id, allocation_type, amount_cents, currency, provider,
      state, idempotency_key
    ) VALUES (
      v_source.id, 'buyer_refund', v_source.buyer_refund_requested_cents,
      v_source.currency, v_source.provider, 'prepared',
      'source-refund-allocation:buyer:' || v_source.id
    );
    IF v_source.organizer_refund_liability_cents > 0 THEN
      INSERT INTO public.source_refund_ledger_allocations (
        refund_id, allocation_type, amount_cents, currency, provider,
        state, idempotency_key
      ) VALUES (
        v_source.id, 'organizer_refund_liability',
        v_source.organizer_refund_liability_cents,
        v_source.currency, v_source.provider, 'prepared',
        'source-refund-allocation:organizer:' || v_source.id
      );
    END IF;
    IF v_source.platform_fee_absorption_cents > 0 THEN
      INSERT INTO public.source_refund_ledger_allocations (
        refund_id, allocation_type, amount_cents, currency, provider,
        state, idempotency_key
      ) VALUES (
        v_source.id, 'platform_application_fee_reversal',
        v_source.platform_fee_absorption_cents,
        v_source.currency, v_source.provider, 'prepared',
        'source-refund-allocation:platform:' || v_source.id
      );
    END IF;
  END IF;

  UPDATE public.stay_inventory_commitments
  SET state = 'released',
      released_at = now(),
      release_reason = 'reservation_cancelled'
  WHERE group_id = v_group.id
    AND reservation_line_id = ANY(v_preview.selected_line_ids)
    AND state = 'active';
  UPDATE public.stay_reservation_lines
  SET state = 'cancelled', version = version + 1, updated_at = now()
  WHERE group_id = v_group.id
    AND id = ANY(v_preview.selected_line_ids)
    AND state = 'confirmed';

  SELECT NOT EXISTS (
    SELECT 1 FROM public.stay_reservation_lines line
    WHERE line.group_id = v_group.id AND line.state = 'confirmed'
  ) INTO v_all_active_selected;
  UPDATE public.stay_reservation_groups
  SET state = CASE
        WHEN v_all_active_selected THEN 'cancelled'
        ELSE 'partially_cancelled'
      END,
      version = version + 1,
      updated_at = now()
  WHERE id = v_group.id;
  UPDATE public.stay_cancel_previews
  SET consumed_at = now()
  WHERE id = v_preview.id;

  FOR v_allocation IN
    SELECT jsonb_build_object(
      'lineId', allocation.reservation_line_id,
      'amountMinor', sum(allocation.amount_minor)::text
    ) AS value
    FROM public.stay_refund_allocations allocation
    WHERE allocation.refund_id = v_refund.id
    GROUP BY allocation.reservation_line_id
    ORDER BY allocation.reservation_line_id
  LOOP
    INSERT INTO public.stay_money_ledger (
      group_id, line_id, payment_attempt_id, refund_id, entry_type,
      amount_minor, currency_code, idempotency_key, metadata
    ) VALUES (
      v_group.id,
      (v_allocation->>'lineId')::uuid,
      v_attempt.id,
      v_refund.id,
      CASE WHEN v_refund.amount_minor = 0
        THEN 'refund_succeeded' ELSE 'refund_requested' END,
      (v_allocation->>'amountMinor')::bigint,
      v_group.currency_code,
      'stay:refund_requested:' || v_refund.id || ':' ||
        (v_allocation->>'lineId'),
      jsonb_build_object('reason', 'reservation_cancelled')
    ) ON CONFLICT (idempotency_key) DO NOTHING;
  END LOOP;

  INSERT INTO public.stay_reservation_events (
    group_id, event_type, actor_type, actor_user_id, request_id,
    idempotency_key, safe_metadata
  ) VALUES (
    v_group.id, 'stay_reservation_cancelled', v_preview.actor_type, v_uid,
    p_request_id, 'cancel:' || pg_catalog.btrim(p_idempotency_key),
    jsonb_build_object(
      'refundId', v_refund.id,
      'selectedLineIds', to_jsonb(v_preview.selected_line_ids),
      'amountMinor', v_refund.amount_minor::text,
      'currencyCode', v_refund.currency_code
    )
  );

  RETURN jsonb_build_object(
    'refundId', v_refund.id,
    'groupId', v_group.id,
    'state', v_refund.state,
    'amountMinor', v_refund.amount_minor::text,
    'currencyCode', v_refund.currency_code,
    'group', public.issue_1388_group_projection(v_group.id)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_1389_sync_source_refund()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_refund public.stay_refunds%ROWTYPE;
  v_line record;
  v_release public.brand_payout_releases%ROWTYPE;
  v_adjustment_id uuid;
  v_target integer;
BEGIN
  IF NEW.source_type <> 'stay_reservation' THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_refund
  FROM public.stay_refunds
  WHERE source_refund_id = NEW.id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  UPDATE public.stay_refunds
  SET state = CASE
        WHEN NEW.financial_state = 'reconciled' THEN 'succeeded'
        WHEN NEW.financial_state = 'failed_terminal' THEN 'failed'
        WHEN NEW.financial_state = 'needs_attention'
          THEN 'manual_reconciliation'
        WHEN NEW.buyer_state IN ('provider_pending', 'queued')
          THEN 'processing'
        ELSE state
      END,
      provider_ref = COALESCE(NEW.provider_refund_id, provider_ref),
      failure_code = NEW.last_error_code,
      processed_at = CASE
        WHEN NEW.financial_state = 'reconciled'
          THEN COALESCE(processed_at, now())
        ELSE processed_at
      END,
      version = version + 1,
      updated_at = now()
  WHERE id = v_refund.id
  RETURNING * INTO v_refund;

  IF NEW.buyer_state = 'processed'
     AND OLD.buyer_state IS DISTINCT FROM 'processed' THEN
    UPDATE public.stay_refund_allocations
    SET state = 'succeeded'
    WHERE refund_id = v_refund.id
      AND state IN ('submitted', 'processing');
    UPDATE public.stay_payment_allocations payment_allocation
    SET refunded_minor = payment_allocation.refunded_minor + totals.amount_minor
    FROM (
      SELECT
        refund_allocation.payment_allocation_id,
        sum(refund_allocation.amount_minor)::bigint AS amount_minor
      FROM public.stay_refund_allocations refund_allocation
      WHERE refund_allocation.refund_id = v_refund.id
      GROUP BY refund_allocation.payment_allocation_id
    ) totals
    WHERE payment_allocation.id = totals.payment_allocation_id;

    FOR v_line IN
      SELECT
        refund_allocation.reservation_line_id AS line_id,
        sum(refund_allocation.amount_minor)::bigint AS refund_minor,
        sum(refund_allocation.organizer_liability_minor)::bigint
          AS organizer_minor
      FROM public.stay_refund_allocations refund_allocation
      WHERE refund_allocation.refund_id = v_refund.id
      GROUP BY refund_allocation.reservation_line_id
      ORDER BY refund_allocation.reservation_line_id
    LOOP
      INSERT INTO public.stay_money_ledger (
        group_id, line_id, payment_attempt_id, refund_id, entry_type,
        amount_minor, currency_code, provider_reference,
        idempotency_key, metadata
      ) VALUES (
        v_refund.group_id, v_line.line_id, v_refund.payment_attempt_id,
        v_refund.id, 'refund_succeeded', v_line.refund_minor,
        v_refund.currency_code, NEW.provider_refund_id,
        'stay:refund_succeeded:' || v_refund.id || ':' || v_line.line_id,
        jsonb_build_object('sourceRefundId', NEW.id)
      ) ON CONFLICT (idempotency_key) DO NOTHING;

      SELECT release_row.* INTO v_release
      FROM public.payout_release_items item
      JOIN public.brand_payout_releases release_row
        ON release_row.id = item.release_id
      WHERE item.source_type = 'stay_reservation'
        AND item.source_id = v_line.line_id
      FOR UPDATE OF release_row;
      IF FOUND AND v_release.status = 'released' AND v_line.organizer_minor > 0
      THEN
        INSERT INTO public.payout_ledger_adjustments (
          release_id, brand_id, currency, kind, amount_cents,
          provider_ref, idempotency_key
        ) VALUES (
          v_release.id, v_release.brand_id, v_release.currency,
          'post_release_refund',
          LEAST(v_line.organizer_minor, 2147483647)::integer,
          NEW.provider_refund_id,
          'stay-refund-liability:' || v_refund.id || ':' || v_line.line_id
        ) ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING id INTO v_adjustment_id;
        SELECT LEAST(
          COALESCE(sum(adjustment.amount_cents), 0)::integer,
          v_release.organiser_cash_delivered_cents
        ) INTO v_target
        FROM public.payout_ledger_adjustments adjustment
        WHERE adjustment.release_id = v_release.id
          AND adjustment.kind = 'post_release_refund';
        PERFORM public.convert_postponement_debt_to_permanent(
          v_release.id,
          'post_release_refund',
          v_target,
          now()
        );
        INSERT INTO public.stay_money_ledger (
          group_id, line_id, payment_attempt_id, refund_id,
          payout_release_id, entry_type, amount_minor, currency_code,
          provider_reference, idempotency_key, metadata
        ) VALUES (
          v_refund.group_id, v_line.line_id, v_refund.payment_attempt_id,
          v_refund.id, v_release.id, 'payout_reversal_owed',
          v_line.organizer_minor, v_refund.currency_code,
          NEW.provider_refund_id,
          'stay:payout_reversal_owed:' || v_refund.id || ':' || v_line.line_id,
          jsonb_build_object('adjustmentId', v_adjustment_id)
        ) ON CONFLICT (idempotency_key) DO NOTHING;
      ELSIF FOUND AND v_release.status <> 'released' THEN
        UPDATE public.payout_release_items item
        SET refunded_cents = LEAST(
              item.gross_cents,
              item.refunded_cents + v_line.refund_minor::integer
            ),
            net_cents = GREATEST(
              0,
              item.net_cents - v_line.organizer_minor::integer
            )
        WHERE item.release_id = v_release.id
          AND item.source_type = 'stay_reservation'
          AND item.source_id = v_line.line_id;
        UPDATE public.brand_payout_releases release_row
        SET refunded_cents = totals.refunded,
            net_release_cents = totals.net,
            updated_at = now()
        FROM (
          SELECT
            sum(item.refunded_cents)::integer AS refunded,
            sum(item.net_cents)::integer AS net
          FROM public.payout_release_items item
          WHERE item.release_id = v_release.id
        ) totals
        WHERE release_row.id = v_release.id;
      END IF;
    END LOOP;
    INSERT INTO public.stay_reservation_events (
      group_id, event_type, actor_type, idempotency_key, safe_metadata
    ) VALUES (
      v_refund.group_id, 'stay_refund_succeeded', 'service',
      'refund-succeeded:' || v_refund.id,
      jsonb_build_object(
        'refundId', v_refund.id,
        'amountMinor', v_refund.amount_minor::text,
        'currencyCode', v_refund.currency_code
      )
    ) ON CONFLICT (group_id, idempotency_key) DO NOTHING;
  ELSIF NEW.buyer_state = 'failed_terminal'
        AND OLD.buyer_state IS DISTINCT FROM 'failed_terminal' THEN
    UPDATE public.stay_refund_allocations
    SET state = 'failed'
    WHERE refund_id = v_refund.id
      AND state IN ('submitted', 'processing');
    INSERT INTO public.stay_money_ledger (
      group_id, payment_attempt_id, refund_id, entry_type,
      amount_minor, currency_code, provider_reference,
      idempotency_key, metadata
    ) VALUES (
      v_refund.group_id, v_refund.payment_attempt_id, v_refund.id,
      'refund_failed', v_refund.amount_minor, v_refund.currency_code,
      NEW.provider_refund_id,
      'stay:refund_failed:' || v_refund.id,
      jsonb_build_object('failureCode', NEW.last_error_code)
    ) ON CONFLICT (idempotency_key) DO NOTHING;
    INSERT INTO public.stay_reservation_events (
      group_id, event_type, actor_type, idempotency_key, safe_metadata
    ) VALUES (
      v_refund.group_id, 'stay_refund_attention_required', 'service',
      'refund-failed:' || v_refund.id,
      jsonb_build_object('refundId', v_refund.id)
    ) ON CONFLICT (group_id, idempotency_key) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER stay_source_refund_sync
  AFTER UPDATE OF buyer_state, fee_state, financial_state
  ON public.source_refunds
  FOR EACH ROW
  WHEN (NEW.source_type = 'stay_reservation')
  EXECUTE FUNCTION public.issue_1389_sync_source_refund();

REVOKE ALL ON FUNCTION public.issue_1389_line_start_at(uuid)
  FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_1389_cancel_preview(
  uuid, uuid[], bigint, uuid
) FROM public, anon;
REVOKE ALL ON FUNCTION public.issue_1389_cancel(
  uuid, text, text, text, uuid
) FROM public, anon;
REVOKE ALL ON FUNCTION public.issue_1389_sync_source_refund()
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1389_cancel_preview(
  uuid, uuid[], bigint, uuid
) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_1389_cancel(
  uuid, text, text, text, uuid
) TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
