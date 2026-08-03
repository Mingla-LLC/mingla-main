-- Issue #1426: permission-safe Stay staff reservation queues, full group
-- inspection, and reviewed cancellation impact. Existing reservation, payment,
-- refund, inventory, payout, and notification tables remain the only truth.

BEGIN;

CREATE OR REPLACE FUNCTION public.issue_1426_has_stay_permission(
  p_brand_id uuid,
  p_user_id uuid,
  p_action text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_action text := lower(pg_catalog.btrim(COALESCE(p_action, '')));
  v_role text;
  v_overrides jsonb := '{}'::jsonb;
  v_key text;
  v_base boolean := false;
BEGIN
  IF p_user_id IS NULL OR p_user_id <> auth.uid()
     OR v_action NOT IN ('view', 'respond', 'cancel', 'finance') THEN
    RETURN false;
  END IF;
  IF public.is_admin_user() OR EXISTS (
    SELECT 1 FROM public.brands brand
    WHERE brand.id = p_brand_id
      AND brand.account_id = p_user_id
      AND brand.deleted_at IS NULL
  ) THEN
    RETURN true;
  END IF;

  SELECT member.role, member.permissions_override
  INTO v_role, v_overrides
  FROM public.brand_team_members member
  WHERE member.brand_id = p_brand_id
    AND member.user_id = p_user_id
    AND member.accepted_at IS NOT NULL
    AND member.removed_at IS NULL;
  IF v_role IS NULL THEN
    RETURN false;
  END IF;

  v_base := CASE v_action
    WHEN 'view' THEN v_role IN (
      'brand_owner', 'brand_admin', 'event_manager', 'finance_manager'
    )
    WHEN 'respond' THEN v_role IN (
      'brand_owner', 'brand_admin', 'event_manager'
    )
    WHEN 'cancel' THEN v_role IN (
      'brand_owner', 'brand_admin', 'event_manager'
    )
    WHEN 'finance' THEN v_role IN (
      'brand_owner', 'brand_admin', 'finance_manager'
    )
    ELSE false
  END;
  v_key := 'stay.' || v_action;
  IF jsonb_typeof(v_overrides->v_key) = 'boolean' THEN
    RETURN v_base AND (v_overrides->>v_key)::boolean;
  END IF;
  RETURN v_base;
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_1426_staff_group_projection(
  p_group_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_group public.stay_reservation_groups%ROWTYPE;
  v_base jsonb;
  v_can_finance boolean;
BEGIN
  SELECT * INTO v_group
  FROM public.stay_reservation_groups
  WHERE id = p_group_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stay_group_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.issue_1426_has_stay_permission(
    v_group.brand_id, v_uid, 'view'
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_can_finance := public.issue_1426_has_stay_permission(
    v_group.brand_id, v_uid, 'finance'
  );
  v_base := public.issue_1388_group_projection(p_group_id);

  RETURN v_base || jsonb_build_object(
    'permissions', jsonb_build_object(
      'canView', true,
      'canRespond', public.issue_1426_has_stay_permission(
        v_group.brand_id, v_uid, 'respond'
      ),
      'canCancel', public.issue_1426_has_stay_permission(
        v_group.brand_id, v_uid, 'cancel'
      ),
      'canViewFinance', v_can_finance
    ),
    'lines', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'lineId', line.id,
        'offeringId', line.offering_id,
        'kind', line.kind,
        'state', line.state,
        'roomCheckIn', line.room_check_in,
        'roomCheckOut', line.room_check_out,
        'roomQuantity', line.room_quantity,
        'placeWindowId', line.place_window_id,
        'placeUnits', line.place_units,
        'placeGuests', line.place_guests,
        'adults', line.adults,
        'children', line.children,
        'baseMinor', line.base_minor::text,
        'feeMinor', line.fee_minor::text,
        'taxMinor', line.tax_minor::text,
        'totalMinor', line.total_minor::text,
        'dependencyRoomLineId', line.dependency_room_line_id,
        'offering', line.offering_snapshot,
        'price', line.price_snapshot,
        'policy', line.policy_snapshot,
        'schedule', quote_line.inventory_snapshot,
        'allocations', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'ordinal', allocation.allocation_ordinal,
            'adults', allocation.adults,
            'children', allocation.children,
            'namedUnitPreference', allocation.named_unit_preference
          ) ORDER BY allocation.allocation_ordinal)
          FROM public.stay_quote_allocations allocation
          WHERE allocation.quote_line_id = line.quote_line_id
        ), '[]'::jsonb),
        'fees', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'name', fee.name,
            'kind', fee.fee_kind,
            'amountMinor', fee.amount_minor::text,
            'includedInBase', fee.included_in_base,
            'refundTreatment', fee.refund_treatment
          ) ORDER BY fee.name, fee.id)
          FROM public.stay_quote_fee_lines fee
          WHERE fee.quote_line_id = line.quote_line_id
        ), '[]'::jsonb)
      ) ORDER BY line.kind, line.offering_id, line.place_window_id NULLS FIRST)
      FROM public.stay_reservation_lines line
      JOIN public.stay_quote_lines quote_line
        ON quote_line.id = line.quote_line_id
      WHERE line.group_id = p_group_id
    ), '[]'::jsonb),
    'payment', (
      SELECT jsonb_build_object(
        'state', payment.state,
        'provider', payment.provider,
        'amountMinor', payment.amount_minor::text,
        'applicationFeeMinor', CASE WHEN v_can_finance
          THEN payment.application_fee_minor::text ELSE NULL END,
        'succeededAt', payment.succeeded_at,
        'updatedAt', payment.updated_at
      )
      FROM public.stay_payment_attempts payment
      WHERE payment.group_id = p_group_id
      ORDER BY payment.attempt_ordinal DESC
      LIMIT 1
    ),
    'refunds', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'refundId', refund.id,
        'state', refund.state,
        'amountMinor', refund.amount_minor::text,
        'reason', refund.reason,
        'requestedByType', refund.requested_by_type,
        'createdAt', refund.created_at,
        'updatedAt', refund.updated_at
      ) ORDER BY refund.created_at DESC, refund.id DESC)
      FROM public.stay_refunds refund
      WHERE refund.group_id = p_group_id
    ), '[]'::jsonb)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_1426_list_staff_stay_reservations(
  p_venue_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_venue public.venue_listings%ROWTYPE;
BEGIN
  SELECT * INTO v_venue
  FROM public.venue_listings
  WHERE id = p_venue_id AND venue_category = 'stay';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stay_venue_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.issue_1426_has_stay_permission(
    v_venue.brand_id, v_uid, 'view'
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'permissions', jsonb_build_object(
      'canView', true,
      'canRespond', public.issue_1426_has_stay_permission(
        v_venue.brand_id, v_uid, 'respond'
      ),
      'canCancel', public.issue_1426_has_stay_permission(
        v_venue.brand_id, v_uid, 'cancel'
      ),
      'canViewFinance', public.issue_1426_has_stay_permission(
        v_venue.brand_id, v_uid, 'finance'
      )
    ),
    'groups', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'groupId', group_row.id,
        'publicReference', group_row.public_reference,
        'venueId', group_row.venue_id,
        'brandId', group_row.brand_id,
        'currencyCode', group_row.currency_code,
        'mode', group_row.mode,
        'state', group_row.state,
        'guest', group_row.guest_snapshot,
        'totalMinor', group_row.total_minor::text,
        'lineCount', counts.line_count,
        'roomCount', counts.room_count,
        'placeCount', counts.place_count,
        'requestDeadline', group_row.request_deadline,
        'paymentDeadline', group_row.payment_deadline,
        'paymentState', payment.state,
        'refundState', refund.state,
        'version', group_row.version,
        'createdAt', group_row.created_at,
        'updatedAt', group_row.updated_at
      ) ORDER BY
        CASE group_row.state
          WHEN 'request_pending' THEN 0
          WHEN 'reconciliation_required' THEN 1
          WHEN 'approved_payment_required' THEN 2
          WHEN 'confirmed' THEN 3
          WHEN 'partially_cancelled' THEN 4
          ELSE 5
        END,
        group_row.created_at DESC,
        group_row.id DESC)
      FROM public.stay_reservation_groups group_row
      CROSS JOIN LATERAL (
        SELECT
          count(*)::integer AS line_count,
          count(*) FILTER (WHERE line.kind = 'room')::integer AS room_count,
          count(*) FILTER (WHERE line.kind = 'place')::integer AS place_count
        FROM public.stay_reservation_lines line
        WHERE line.group_id = group_row.id
      ) counts
      LEFT JOIN LATERAL (
        SELECT attempt.state
        FROM public.stay_payment_attempts attempt
        WHERE attempt.group_id = group_row.id
        ORDER BY attempt.attempt_ordinal DESC
        LIMIT 1
      ) payment ON true
      LEFT JOIN LATERAL (
        SELECT refund_row.state
        FROM public.stay_refunds refund_row
        WHERE refund_row.group_id = group_row.id
        ORDER BY refund_row.created_at DESC, refund_row.id DESC
        LIMIT 1
      ) refund ON true
      WHERE group_row.venue_id = p_venue_id
    ), '[]'::jsonb)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_1426_manage_request(
  p_action text,
  p_group_id uuid,
  p_expected_version bigint,
  p_idempotency_key text,
  p_request_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_group public.stay_reservation_groups%ROWTYPE;
BEGIN
  SELECT * INTO v_group
  FROM public.stay_reservation_groups
  WHERE id = p_group_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stay_group_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.issue_1426_has_stay_permission(
    v_group.brand_id, auth.uid(), 'respond'
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM public.issue_1388_manage_request(
    p_action, p_group_id, p_expected_version, p_idempotency_key, p_request_id
  );
  RETURN public.issue_1426_staff_group_projection(p_group_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_1426_cancel_preview(
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
  v_result jsonb;
  v_refund_minor bigint;
  v_outstanding_minor bigint := 0;
  v_released_minor bigint := 0;
  v_existing_fee_reversal bigint := 0;
  v_fee_remaining bigint := 0;
  v_fee_reversal bigint := 0;
  v_organizer_liability bigint := 0;
  v_reversal_minor bigint := 0;
  v_room_quantity bigint := 0;
  v_place_quantity bigint := 0;
  v_commitment_count integer := 0;
BEGIN
  SELECT * INTO v_group
  FROM public.stay_reservation_groups
  WHERE id = p_group_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stay_group_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_group.user_id <> v_uid
     AND NOT public.is_admin_user()
     AND NOT public.issue_1426_has_stay_permission(
       v_group.brand_id, v_uid, 'cancel'
     ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_result := public.issue_1389_cancel_preview(
    p_group_id,
    p_selected_line_ids,
    p_expected_group_version,
    p_request_id
  );
  v_refund_minor := (v_result->>'amountMinor')::bigint;

  SELECT * INTO v_attempt
  FROM public.stay_payment_attempts
  WHERE group_id = p_group_id AND state = 'succeeded'
  ORDER BY succeeded_at DESC, id DESC
  LIMIT 1;

  SELECT
    COALESCE(sum(GREATEST(
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
    )), 0),
    COALESCE(sum(allocation.payout_released_minor), 0)
  INTO v_outstanding_minor, v_released_minor
  FROM public.stay_payment_allocations allocation
  WHERE allocation.payment_attempt_id = v_attempt.id
    AND allocation.reservation_line_id = ANY(p_selected_line_ids);

  SELECT COALESCE(sum(refund.application_fee_reversal_minor), 0)
  INTO v_existing_fee_reversal
  FROM public.stay_refunds refund
  WHERE refund.payment_attempt_id = v_attempt.id
    AND refund.state IN (
      'submitted', 'processing', 'succeeded', 'manual_reconciliation'
    );
  v_fee_remaining := GREATEST(
    0, v_attempt.application_fee_minor - v_existing_fee_reversal
  );
  v_fee_reversal := CASE
    WHEN v_refund_minor = 0 THEN 0
    WHEN v_refund_minor >= (
      SELECT COALESCE(sum(
        allocation.charged_minor - allocation.refunded_minor
      ), 0)
      FROM public.stay_payment_allocations allocation
      WHERE allocation.payment_attempt_id = v_attempt.id
    ) THEN v_fee_remaining
    ELSE LEAST(
      v_fee_remaining,
      (
        v_attempt.application_fee_minor::numeric * v_refund_minor
          + v_attempt.amount_minor / 2
      )::bigint / v_attempt.amount_minor
    )
  END;
  v_organizer_liability := GREATEST(0, v_refund_minor - v_fee_reversal);
  v_reversal_minor := LEAST(v_organizer_liability, v_released_minor);

  SELECT
    count(*)::integer,
    COALESCE(sum(commitment.quantity) FILTER (
      WHERE commitment.resource_type = 'room_night'
    ), 0),
    COALESCE(sum(commitment.quantity) FILTER (
      WHERE commitment.resource_type = 'place_window'
    ), 0)
  INTO v_commitment_count, v_room_quantity, v_place_quantity
  FROM public.stay_inventory_commitments commitment
  WHERE commitment.group_id = p_group_id
    AND commitment.reservation_line_id = ANY(p_selected_line_ids)
    AND commitment.state = 'active';

  RETURN v_result || jsonb_build_object(
    'retainedAmountMinor', GREATEST(
      0, v_outstanding_minor - v_refund_minor
    )::text,
    'inventoryRelease', jsonb_build_object(
      'lineCount', cardinality(p_selected_line_ids),
      'commitmentCount', v_commitment_count,
      'roomNightQuantity', v_room_quantity,
      'placeQuantity', v_place_quantity
    ),
    'payoutEffect', jsonb_build_object(
      'applicationFeeReversalMinor', v_fee_reversal::text,
      'organizerLiabilityMinor', v_organizer_liability::text,
      'alreadyReleasedMinor', v_released_minor::text,
      'payoutReversalMinor', v_reversal_minor::text,
      'futureReleaseReductionMinor', GREATEST(
        0, v_organizer_liability - v_reversal_minor
      )::text,
      'requiresPayoutReversal', v_reversal_minor > 0
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_1426_cancel(
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
  v_result jsonb;
BEGIN
  SELECT * INTO v_preview
  FROM public.stay_cancel_previews
  WHERE id = p_preview_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stay_cancel_preview_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_group
  FROM public.stay_reservation_groups
  WHERE id = v_preview.group_id;
  IF v_group.user_id <> v_uid
     AND NOT public.is_admin_user()
     AND NOT public.issue_1426_has_stay_permission(
       v_group.brand_id, v_uid, 'cancel'
     ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_result := public.issue_1389_cancel(
    p_preview_id,
    p_preview_hash,
    p_idempotency_key,
    p_reason,
    p_request_id
  );
  IF v_group.user_id <> v_uid THEN
    v_result := jsonb_set(
      v_result,
      '{group}',
      public.issue_1426_staff_group_projection(v_group.id),
      true
    );
  END IF;
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_1426_has_stay_permission(
  uuid, uuid, text
) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_1426_staff_group_projection(uuid)
  FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_1426_list_staff_stay_reservations(uuid)
  FROM public, anon;
REVOKE ALL ON FUNCTION public.issue_1426_manage_request(
  text, uuid, bigint, text, uuid
) FROM public, anon;
REVOKE ALL ON FUNCTION public.issue_1426_cancel_preview(
  uuid, uuid[], bigint, uuid
) FROM public, anon;
REVOKE ALL ON FUNCTION public.issue_1426_cancel(
  uuid, text, text, text, uuid
) FROM public, anon;

GRANT EXECUTE ON FUNCTION public.issue_1426_list_staff_stay_reservations(uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_1426_staff_group_projection(uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_1426_manage_request(
  text, uuid, bigint, text, uuid
) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_1426_cancel_preview(
  uuid, uuid[], bigint, uuid
) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_1426_cancel(
  uuid, text, text, text, uuid
) TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
