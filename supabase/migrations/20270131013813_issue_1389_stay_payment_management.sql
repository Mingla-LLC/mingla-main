-- Issue #1389: authoritative Stay payment preparation and webhook finalization.

BEGIN;

CREATE OR REPLACE FUNCTION public.issue_1389_flag_enabled(p_flag text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT COALESCE((
    SELECT flag.is_enabled
    FROM public.feature_flags flag
    WHERE flag.flag_key = p_flag
  ), false);
$function$;

CREATE OR REPLACE FUNCTION public.issue_1389_service_role()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $function$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    CASE
      WHEN NULLIF(current_setting('request.jwt.claims', true), '') IS NULL
        THEN NULL
      ELSE current_setting('request.jwt.claims', true)::jsonb->>'role'
    END,
    current_user
  ) IN ('service_role', 'postgres');
$function$;

CREATE OR REPLACE FUNCTION public.issue_1389_attempt_projection(
  p_attempt_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT jsonb_build_object(
    'attemptId', attempt.id,
    'groupId', attempt.group_id,
    'provider', attempt.provider,
    'state', attempt.state,
    'attemptOrdinal', attempt.attempt_ordinal,
    'connectedAccountRef', attempt.connected_account_ref,
    'amountMinor', attempt.amount_minor::text,
    'currencyCode', attempt.currency_code,
    'applicationFeeMinor', attempt.application_fee_minor::text,
    'providerPaymentRef', attempt.provider_payment_ref,
    'buyerEmail', group_row.guest_snapshot->>'email',
    'failureCode', attempt.failure_code,
    'version', attempt.version,
    'createdAt', attempt.created_at,
    'updatedAt', attempt.updated_at
  )
  FROM public.stay_payment_attempts attempt
  JOIN public.stay_reservation_groups group_row
    ON group_row.id = attempt.group_id
  WHERE attempt.id = p_attempt_id;
$function$;

CREATE OR REPLACE FUNCTION public.issue_1389_prepare_payment(
  p_group_id uuid,
  p_idempotency_key text,
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
  v_hold public.stay_inventory_holds%ROWTYPE;
  v_attempt public.stay_payment_attempts%ROWTYPE;
  v_provider text;
  v_account text;
  v_currency text;
  v_take_rate integer;
  v_app_fee bigint;
  v_ordinal integer;
  v_request_hash text;
  v_cutover timestamptz;
  v_readiness_revision bigint;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF p_group_id IS NULL
     OR p_expected_group_version IS NULL
     OR char_length(pg_catalog.btrim(COALESCE(p_idempotency_key, '')))
       NOT BETWEEN 8 AND 200 THEN
    RAISE EXCEPTION 'stay_invalid_payload' USING ERRCODE = '22023';
  END IF;
  IF NOT public.issue_1389_flag_enabled('STAY_RESERVE_WRITES') THEN
    RAISE EXCEPTION 'stay_rail_not_enabled' USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'stay-payment:' || p_group_id::text || ':' ||
        pg_catalog.btrim(p_idempotency_key),
      1389
    )
  );

  SELECT * INTO v_group
  FROM public.stay_reservation_groups
  WHERE id = p_group_id
  FOR UPDATE;
  IF NOT FOUND OR v_group.user_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'stay_group_not_found' USING ERRCODE = 'P0002';
  END IF;

  v_request_hash := encode(
    extensions.digest(
      pg_catalog.convert_to(jsonb_build_object(
        'groupId', p_group_id,
        'expectedVersion', p_expected_group_version
      )::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
  SELECT * INTO v_attempt
  FROM public.stay_payment_attempts
  WHERE group_id = p_group_id
    AND idempotency_key = pg_catalog.btrim(p_idempotency_key)
  FOR UPDATE;
  IF FOUND THEN
    IF v_attempt.request_hash <> v_request_hash THEN
      RAISE EXCEPTION 'stay_idempotency_conflict' USING ERRCODE = '23505';
    END IF;
    RETURN public.issue_1389_attempt_projection(v_attempt.id);
  END IF;

  IF v_group.version <> p_expected_group_version THEN
    RAISE EXCEPTION 'stay_version_conflict' USING ERRCODE = '40001';
  END IF;
  IF (
    v_group.mode = 'instant'
    AND v_group.state <> 'instant_payment_pending'
  ) OR (
    v_group.mode = 'request'
    AND v_group.state <> 'approved_payment_required'
  ) THEN
    RAISE EXCEPTION 'stay_invalid_transition' USING ERRCODE = '40001';
  END IF;
  IF v_group.mode = 'request' AND v_group.payment_deadline IS NULL THEN
    RAISE EXCEPTION 'stay_payment_before_approval' USING ERRCODE = '40001';
  END IF;

  SELECT * INTO v_hold
  FROM public.stay_inventory_holds
  WHERE group_id = p_group_id
  FOR UPDATE;
  IF NOT FOUND OR v_hold.state <> 'active' OR v_hold.expires_at <= now() THEN
    RAISE EXCEPTION 'stay_inventory_changed' USING ERRCODE = '40001';
  END IF;

  PERFORM 1 FROM public.brands WHERE id = v_group.brand_id FOR UPDATE;
  SELECT
    CASE WHEN pricing.payment_provider = 'paystack'
      THEN 'paystack' ELSE 'stripe' END,
    CASE WHEN pricing.payment_provider = 'paystack'
      THEN pricing.paystack_subaccount_code
      ELSE pricing.stripe_account_id END,
    upper(pricing.pricing_currency),
    pricing.effective_take_rate_bps
  INTO v_provider, v_account, v_currency, v_take_rate
  FROM public.resolve_brand_pricing_inputs(
    v_group.brand_id,
    v_group.venue_id
  ) pricing
  LIMIT 1;

  SELECT b.payout_hold_cutover_at INTO v_cutover
  FROM public.brands b WHERE b.id = v_group.brand_id;
  SELECT b.discovery_currency_state_version INTO v_readiness_revision
  FROM public.brands b
  WHERE b.id = v_group.brand_id;

  IF v_provider IS NULL
     OR v_currency IS DISTINCT FROM v_group.currency_code::text
     OR NOT public.pg_brand_can_collect(v_group.brand_id)
     OR EXISTS (
       SELECT 1 FROM public.brand_currency_reconciliations reconciliation
       WHERE reconciliation.brand_id = v_group.brand_id
         AND reconciliation.status = 'pending'
     )
     OR v_cutover IS NULL THEN
    RAISE EXCEPTION 'stay_bank_not_ready' USING ERRCODE = 'P0001';
  END IF;
  IF v_provider = 'stripe' AND (
    v_account IS NULL
    OR NOT public.issue_1389_flag_enabled('STAY_STRIPE_COMMERCE')
  ) THEN
    RAISE EXCEPTION 'stay_rail_not_enabled' USING ERRCODE = 'P0001';
  END IF;
  IF v_provider = 'paystack' AND (
    v_currency <> 'NGN'
    OR NOT public.issue_1389_flag_enabled('STAY_PAYSTACK_COMMERCE')
  ) THEN
    RAISE EXCEPTION 'stay_rail_not_enabled' USING ERRCODE = 'P0001';
  END IF;
  IF v_group.total_minor <= 0 OR v_group.total_minor > 2147483647 THEN
    RAISE EXCEPTION 'stay_money_out_of_range' USING ERRCODE = '22003';
  END IF;

  v_app_fee := LEAST(
    v_group.total_minor,
    ((v_group.total_minor::numeric * COALESCE(v_take_rate, 0) + 5000)
      / 10000)::bigint
  );
  SELECT COALESCE(max(attempt_ordinal), 0) + 1 INTO v_ordinal
  FROM public.stay_payment_attempts
  WHERE group_id = p_group_id;

  INSERT INTO public.stay_payment_attempts (
    group_id, provider, attempt_ordinal, connected_account_ref,
    amount_minor, currency_code, application_fee_minor, state,
    idempotency_key, request_hash, readiness_revision
  ) VALUES (
    p_group_id, v_provider, v_ordinal, v_account,
    v_group.total_minor, v_group.currency_code, v_app_fee, 'created',
    pg_catalog.btrim(p_idempotency_key), v_request_hash,
    COALESCE(v_readiness_revision, 1)
  ) RETURNING * INTO v_attempt;

  INSERT INTO public.stay_payment_allocations (
    payment_attempt_id, reservation_line_id, component, component_ref,
    charged_minor, refund_treatment, snapshot
  )
  SELECT
    v_attempt.id, line.id, 'base', 'base',
    line.base_minor, 'same_as_line',
    jsonb_build_object('policy', line.policy_snapshot)
  FROM public.stay_reservation_lines line
  WHERE line.group_id = p_group_id
  ORDER BY line.id;

  INSERT INTO public.stay_payment_allocations (
    payment_attempt_id, reservation_line_id, component, component_ref,
    charged_minor, refund_treatment, snapshot
  )
  SELECT
    v_attempt.id,
    reservation_line.id,
    CASE quote_fee.fee_kind WHEN 'tax' THEN 'tax' ELSE 'fee' END,
    quote_fee.id::text,
    quote_fee.amount_minor,
    quote_fee.refund_treatment,
    quote_fee.snapshot
  FROM public.stay_reservation_lines reservation_line
  JOIN public.stay_quote_fee_lines quote_fee
    ON quote_fee.quote_line_id = reservation_line.quote_line_id
  WHERE reservation_line.group_id = p_group_id
    AND NOT quote_fee.included_in_base
    AND quote_fee.amount_minor > 0
  ORDER BY reservation_line.id, quote_fee.id;

  IF (
    SELECT COALESCE(sum(allocation.charged_minor), 0)
    FROM public.stay_payment_allocations allocation
    WHERE allocation.payment_attempt_id = v_attempt.id
  ) <> v_attempt.amount_minor THEN
    RAISE EXCEPTION 'stay_payment_allocation_mismatch'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.stay_reservation_events (
    group_id, event_type, actor_type, actor_user_id, request_id,
    idempotency_key, safe_metadata
  ) VALUES (
    p_group_id, 'stay_payment_prepared', 'guest', v_uid, p_request_id,
    'payment-prepared:' || v_attempt.id,
    jsonb_build_object(
      'attemptId', v_attempt.id,
      'provider', v_provider,
      'amountMinor', v_attempt.amount_minor::text,
      'currencyCode', v_attempt.currency_code
    )
  );

  RETURN public.issue_1389_attempt_projection(v_attempt.id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_1389_bind_payment_attempt(
  p_attempt_id uuid,
  p_provider_payment_ref text,
  p_provider_charge_ref text DEFAULT NULL,
  p_request_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_attempt public.stay_payment_attempts%ROWTYPE;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_attempt_id IS NULL
     OR char_length(pg_catalog.btrim(COALESCE(p_provider_payment_ref, '')))
       NOT BETWEEN 3 AND 200 THEN
    RAISE EXCEPTION 'stay_invalid_payload' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_attempt
  FROM public.stay_payment_attempts
  WHERE id = p_attempt_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stay_payment_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_attempt.state = 'pending' THEN
    IF v_attempt.provider_payment_ref <> pg_catalog.btrim(
      p_provider_payment_ref
    ) THEN
      RAISE EXCEPTION 'stay_idempotency_conflict' USING ERRCODE = '23505';
    END IF;
    RETURN public.issue_1389_attempt_projection(v_attempt.id);
  END IF;
  IF v_attempt.state <> 'created' THEN
    RAISE EXCEPTION 'stay_invalid_transition' USING ERRCODE = '40001';
  END IF;
  UPDATE public.stay_payment_attempts
  SET state = 'pending',
      provider_payment_ref = pg_catalog.btrim(p_provider_payment_ref),
      provider_charge_ref = NULLIF(
        pg_catalog.btrim(COALESCE(p_provider_charge_ref, '')),
        ''
      ),
      version = version + 1,
      updated_at = now()
  WHERE id = v_attempt.id
  RETURNING * INTO v_attempt;
  INSERT INTO public.stay_money_ledger (
    group_id, payment_attempt_id, entry_type, amount_minor, currency_code,
    provider_reference, idempotency_key, metadata
  ) VALUES (
    v_attempt.group_id, v_attempt.id, 'charge_pending',
    v_attempt.amount_minor, v_attempt.currency_code,
    v_attempt.provider_payment_ref,
    'stay:charge_pending:' || v_attempt.id,
    jsonb_build_object('provider', v_attempt.provider)
  ) ON CONFLICT (idempotency_key) DO NOTHING;
  RETURN public.issue_1389_attempt_projection(v_attempt.id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_1389_record_payment_create_failure(
  p_attempt_id uuid,
  p_failure_code text,
  p_ambiguous boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_attempt public.stay_payment_attempts%ROWTYPE;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_failure_code !~ '^[a-z0-9_]{3,80}$' THEN
    RAISE EXCEPTION 'stay_invalid_payload' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_attempt
  FROM public.stay_payment_attempts
  WHERE id = p_attempt_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stay_payment_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_attempt.state IN ('succeeded', 'refund_due') THEN
    RETURN public.issue_1389_attempt_projection(v_attempt.id);
  END IF;
  UPDATE public.stay_payment_attempts
  SET state = CASE WHEN p_ambiguous THEN 'ambiguous' ELSE 'failed' END,
      failure_code = p_failure_code,
      version = version + 1,
      updated_at = now()
  WHERE id = v_attempt.id
  RETURNING * INTO v_attempt;
  IF p_ambiguous THEN
    UPDATE public.stay_reservation_groups
    SET state = 'reconciliation_required',
        version = version + 1,
        updated_at = now()
    WHERE id = v_attempt.group_id
      AND state IN ('instant_payment_pending', 'approved_payment_required');
    UPDATE public.stay_inventory_holds
    SET state = 'reconciliation_required',
        reason = 'payment_ambiguous',
        version = version + 1,
        updated_at = now()
    WHERE group_id = v_attempt.group_id AND state = 'active';
  END IF;
  INSERT INTO public.stay_money_ledger (
    group_id, payment_attempt_id, entry_type, amount_minor, currency_code,
    idempotency_key, metadata
  ) VALUES (
    v_attempt.group_id, v_attempt.id,
    CASE WHEN p_ambiguous THEN 'charge_ambiguous' ELSE 'charge_failed' END,
    v_attempt.amount_minor, v_attempt.currency_code,
    'stay:charge_create_result:' || v_attempt.id || ':' ||
      CASE WHEN p_ambiguous THEN 'ambiguous' ELSE 'failed' END,
    jsonb_build_object('failureCode', p_failure_code)
  ) ON CONFLICT (idempotency_key) DO NOTHING;
  RETURN public.issue_1389_attempt_projection(v_attempt.id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_1389_finalize_payment(
  p_provider text,
  p_provider_event_id text,
  p_provider_event_type text,
  p_provider_payment_ref text,
  p_provider_charge_ref text,
  p_amount_minor bigint,
  p_currency_code text,
  p_provider_fee_minor bigint DEFAULT NULL,
  p_event_fingerprint text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_attempt public.stay_payment_attempts%ROWTYPE;
  v_group public.stay_reservation_groups%ROWTYPE;
  v_hold public.stay_inventory_holds%ROWTYPE;
  v_event_id uuid;
  v_line public.stay_reservation_lines%ROWTYPE;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_provider NOT IN ('stripe', 'paystack')
     OR char_length(COALESCE(p_provider_event_id, '')) NOT BETWEEN 3 AND 240
     OR char_length(COALESCE(p_provider_payment_ref, '')) NOT BETWEEN 3 AND 200
     OR p_amount_minor <= 0
     OR upper(COALESCE(p_currency_code, '')) !~ '^[A-Z]{3}$'
     OR (
       p_provider_fee_minor IS NOT NULL
       AND p_provider_fee_minor < 0
     ) THEN
    RAISE EXCEPTION 'stay_invalid_payload' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_attempt
  FROM public.stay_payment_attempts
  WHERE provider = p_provider
    AND provider_payment_ref = p_provider_payment_ref
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stay_payment_not_found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.stay_provider_events (
    provider, provider_event_id, provider_event_type, payment_attempt_id,
    event_fingerprint, safe_payload
  ) VALUES (
    p_provider, p_provider_event_id, p_provider_event_type, v_attempt.id,
    COALESCE(
      NULLIF(p_event_fingerprint, ''),
      encode(extensions.digest(
        pg_catalog.convert_to(
          p_provider || ':' || p_provider_event_id || ':' ||
          p_provider_payment_ref,
          'UTF8'
        ),
        'sha256'
      ), 'hex')
    ),
    jsonb_build_object(
      'amountMinor', p_amount_minor::text,
      'currencyCode', upper(p_currency_code)
    )
  )
  ON CONFLICT (provider, provider_event_id) DO NOTHING
  RETURNING id INTO v_event_id;
  IF v_event_id IS NULL THEN
    RETURN public.issue_1389_attempt_projection(v_attempt.id);
  END IF;
  IF v_attempt.state = 'succeeded' THEN
    RETURN public.issue_1389_attempt_projection(v_attempt.id);
  END IF;

  SELECT * INTO v_group
  FROM public.stay_reservation_groups
  WHERE id = v_attempt.group_id
  FOR UPDATE;
  SELECT * INTO v_hold
  FROM public.stay_inventory_holds
  WHERE group_id = v_attempt.group_id
  FOR UPDATE;

  IF v_attempt.amount_minor <> p_amount_minor
     OR v_attempt.currency_code <> upper(p_currency_code)::character(3)
     OR (
       v_attempt.provider_payment_ref IS DISTINCT FROM p_provider_payment_ref
     ) THEN
    UPDATE public.stay_payment_attempts
    SET state = 'ambiguous',
        failure_code = 'provider_evidence_mismatch',
        provider_event_ref = p_provider_event_id,
        version = version + 1,
        updated_at = now()
    WHERE id = v_attempt.id;
    UPDATE public.stay_reservation_groups
    SET state = 'reconciliation_required',
        version = version + 1,
        updated_at = now()
    WHERE id = v_group.id
      AND state IN (
        'instant_payment_pending', 'approved_payment_required', 'finalizing'
      );
    UPDATE public.stay_inventory_holds
    SET state = 'reconciliation_required',
        reason = 'provider_evidence_mismatch',
        version = version + 1,
        updated_at = now()
    WHERE id = v_hold.id AND state = 'active';
    RETURN public.issue_1389_attempt_projection(v_attempt.id);
  END IF;

  IF v_hold.id IS NULL
     OR v_hold.state NOT IN ('active', 'reconciliation_required')
     OR (
       v_hold.state = 'active'
       AND v_hold.expires_at <= now()
     )
     OR v_group.state NOT IN (
       'instant_payment_pending',
       'approved_payment_required',
       'reconciliation_required'
     ) THEN
    UPDATE public.stay_payment_attempts
    SET state = 'refund_due',
        provider_event_ref = p_provider_event_id,
        provider_charge_ref = COALESCE(
          NULLIF(p_provider_charge_ref, ''),
          provider_charge_ref
        ),
        failure_code = 'late_success_inventory_unavailable',
        version = version + 1,
        updated_at = now()
    WHERE id = v_attempt.id;
    UPDATE public.stay_reservation_groups
    SET state = 'reconciliation_required',
        version = version + 1,
        updated_at = now()
    WHERE id = v_group.id
      AND state <> 'reconciliation_required';
    UPDATE public.stay_inventory_holds
    SET state = 'reconciliation_required',
        reason = 'late_success_refund_due',
        version = version + 1,
        updated_at = now()
    WHERE id = v_hold.id AND state = 'active';
    INSERT INTO public.stay_money_ledger (
      group_id, payment_attempt_id, entry_type, amount_minor, currency_code,
      provider_reference, idempotency_key, metadata
    ) VALUES (
      v_group.id, v_attempt.id, 'charge_succeeded',
      v_attempt.amount_minor, v_attempt.currency_code,
      p_provider_payment_ref,
      'stay:late_charge_succeeded:' || v_attempt.id,
      jsonb_build_object('refundDue', true)
    ) ON CONFLICT (idempotency_key) DO NOTHING;
    INSERT INTO public.stay_reservation_events (
      group_id, event_type, actor_type, idempotency_key, safe_metadata
    ) VALUES (
      v_group.id, 'stay_payment_late_refund_due', 'service',
      'late-payment-refund-due:' || v_attempt.id,
      jsonb_build_object('attemptId', v_attempt.id)
    ) ON CONFLICT (group_id, idempotency_key) DO NOTHING;
    RETURN public.issue_1389_attempt_projection(v_attempt.id);
  END IF;

  IF NOT public.pg_brand_can_collect(v_group.brand_id)
     OR EXISTS (
       SELECT 1 FROM public.brand_currency_reconciliations reconciliation
       WHERE reconciliation.brand_id = v_group.brand_id
         AND reconciliation.status = 'pending'
     ) THEN
    UPDATE public.stay_payment_attempts
    SET state = 'refund_due',
        failure_code = 'readiness_changed_after_charge',
        provider_event_ref = p_provider_event_id,
        version = version + 1,
        updated_at = now()
    WHERE id = v_attempt.id;
    UPDATE public.stay_reservation_groups
    SET state = 'reconciliation_required',
        version = version + 1,
        updated_at = now()
    WHERE id = v_group.id;
    UPDATE public.stay_inventory_holds
    SET state = 'reconciliation_required',
        reason = 'readiness_changed_after_charge',
        version = version + 1,
        updated_at = now()
    WHERE id = v_hold.id AND state = 'active';
    RETURN public.issue_1389_attempt_projection(v_attempt.id);
  END IF;

  UPDATE public.stay_reservation_groups
  SET state = 'finalizing', version = version + 1, updated_at = now()
  WHERE id = v_group.id;

  INSERT INTO public.stay_inventory_commitments (
    group_id, reservation_line_id, resource_type, offering_id,
    room_date, place_window_id, quantity, exclusive_unit_id
  )
  SELECT
    v_group.id, slice_row.reservation_line_id, slice_row.resource_type,
    slice_row.offering_id, slice_row.room_date, slice_row.place_window_id,
    slice_row.quantity, slice_row.exclusive_unit_id
  FROM public.stay_inventory_hold_slices slice_row
  WHERE slice_row.hold_id = v_hold.id
  ORDER BY
    slice_row.resource_type,
    slice_row.offering_id,
    slice_row.room_date,
    slice_row.place_window_id,
    slice_row.exclusive_unit_id
  ON CONFLICT DO NOTHING;

  IF (
    SELECT count(*)
    FROM public.stay_inventory_commitments commitment
    WHERE commitment.group_id = v_group.id
  ) <> (
    SELECT count(*)
    FROM public.stay_inventory_hold_slices slice_row
    WHERE slice_row.hold_id = v_hold.id
  ) THEN
    DELETE FROM public.stay_inventory_commitments
    WHERE group_id = v_group.id;
    UPDATE public.stay_payment_attempts
    SET state = 'refund_due',
        provider_event_ref = p_provider_event_id,
        provider_charge_ref = COALESCE(
          NULLIF(p_provider_charge_ref, ''),
          provider_charge_ref
        ),
        failure_code = 'commitment_conversion_failed',
        version = version + 1,
        updated_at = now()
    WHERE id = v_attempt.id;
    UPDATE public.stay_reservation_groups
    SET state = 'reconciliation_required',
        version = version + 1,
        updated_at = now()
    WHERE id = v_group.id;
    UPDATE public.stay_inventory_holds
    SET state = 'reconciliation_required',
        reason = 'commitment_conversion_failed',
        version = version + 1,
        updated_at = now()
    WHERE id = v_hold.id;
    RETURN public.issue_1389_attempt_projection(v_attempt.id);
  END IF;

  UPDATE public.stay_inventory_holds
  SET state = 'converted',
      reason = 'payment_succeeded',
      version = version + 1,
      updated_at = now()
  WHERE id = v_hold.id;
  UPDATE public.stay_reservation_lines
  SET state = 'confirmed', version = version + 1, updated_at = now()
  WHERE group_id = v_group.id
    AND state IN (
      'payment_pending', 'approved_payment_required', 'reconciliation_required'
    );
  UPDATE public.stay_reservation_groups
  SET state = 'confirmed', version = version + 1, updated_at = now()
  WHERE id = v_group.id;
  UPDATE public.stay_payment_attempts
  SET state = 'succeeded',
      provider_event_ref = p_provider_event_id,
      provider_charge_ref = COALESCE(
        NULLIF(p_provider_charge_ref, ''),
        provider_charge_ref
      ),
      provider_fee_minor = p_provider_fee_minor,
      failure_code = NULL,
      succeeded_at = now(),
      version = version + 1,
      updated_at = now()
  WHERE id = v_attempt.id
  RETURNING * INTO v_attempt;

  INSERT INTO public.stay_money_ledger (
    group_id, payment_attempt_id, entry_type, amount_minor, currency_code,
    provider_reference, idempotency_key, metadata
  ) VALUES (
    v_group.id, v_attempt.id, 'charge_succeeded',
    v_attempt.amount_minor, v_attempt.currency_code,
    p_provider_payment_ref,
    'stay:charge_succeeded:' || v_attempt.id,
    jsonb_build_object('providerEventId', p_provider_event_id)
  ) ON CONFLICT (idempotency_key) DO NOTHING;

  FOR v_line IN
    SELECT * FROM public.stay_reservation_lines
    WHERE group_id = v_group.id
    ORDER BY id
  LOOP
    INSERT INTO public.stay_money_ledger (
      group_id, line_id, payment_attempt_id, entry_type,
      amount_minor, currency_code, provider_reference,
      idempotency_key, metadata
    ) VALUES (
      v_group.id, v_line.id, v_attempt.id, 'payout_eligible',
      v_line.total_minor, v_attempt.currency_code,
      p_provider_payment_ref,
      'stay:payout_eligible:' || v_line.id,
      jsonb_build_object('pendingReleaseAnchor', true)
    ) ON CONFLICT (idempotency_key) DO NOTHING;
  END LOOP;

  INSERT INTO public.stay_reservation_events (
    group_id, event_type, actor_type, idempotency_key, safe_metadata
  ) VALUES (
    v_group.id, 'stay_reservation_confirmed', 'service',
    'payment-confirmed:' || v_attempt.id,
    jsonb_build_object(
      'attemptId', v_attempt.id,
      'amountMinor', v_attempt.amount_minor::text,
      'currencyCode', v_attempt.currency_code
    )
  ) ON CONFLICT (group_id, idempotency_key) DO NOTHING;

  RETURN public.issue_1389_attempt_projection(v_attempt.id);
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_1389_flag_enabled(text)
  FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_1389_service_role()
  FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_1389_attempt_projection(uuid)
  FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_1389_prepare_payment(
  uuid, text, bigint, uuid
) FROM public, anon;
REVOKE ALL ON FUNCTION public.issue_1389_bind_payment_attempt(
  uuid, text, text, uuid
) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_1389_record_payment_create_failure(
  uuid, text, boolean
) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_1389_finalize_payment(
  text, text, text, text, text, bigint, text, bigint, text
) FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.issue_1389_prepare_payment(
  uuid, text, bigint, uuid
) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_1389_bind_payment_attempt(
  uuid, text, text, uuid
) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_1389_record_payment_create_failure(
  uuid, text, boolean
) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_1389_finalize_payment(
  text, text, text, text, text, bigint, text, bigint, text
) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
