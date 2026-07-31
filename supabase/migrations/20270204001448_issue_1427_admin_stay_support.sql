-- Issue #1427: least-privilege Admin inspection and reconciliation for Stay.
-- Existing Stay tables remain authoritative. Admin receives whitelisted projections
-- and narrowly bounded, audited convergence actions only.

BEGIN;

CREATE TABLE public.stay_operations_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_key text NOT NULL UNIQUE
    CHECK (char_length(pg_catalog.btrim(alert_key)) BETWEEN 8 AND 240),
  alert_kind text NOT NULL CHECK (alert_kind IN (
    'inventory_changed', 'materialization_failed'
  )),
  severity text NOT NULL DEFAULT 'warning'
    CHECK (severity IN ('warning', 'critical')),
  venue_id uuid REFERENCES public.venue_listings(id) ON DELETE RESTRICT,
  group_id uuid REFERENCES public.stay_reservation_groups(id) ON DELETE RESTRICT,
  offering_id uuid REFERENCES public.stay_offerings(id) ON DELETE RESTRICT,
  request_id uuid,
  safe_metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(safe_metadata) = 'object'
    AND NOT (safe_metadata ?| ARRAY[
      'authorization', 'clientSecret', 'client_secret', 'contact', 'email',
      'guest', 'guestToken', 'guest_token', 'phone', 'providerPayload',
      'provider_secret', 'rawBody', 'raw_body', 'statusToken', 'status_token',
      'storageObjectId', 'storageObjectName', 'token'
    ])
  ),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX stay_operations_alerts_created_idx
  ON public.stay_operations_alerts (created_at DESC, id DESC);
CREATE INDEX stay_operations_alerts_group_idx
  ON public.stay_operations_alerts (group_id, created_at DESC)
  WHERE group_id IS NOT NULL;
CREATE INDEX stay_operations_alerts_venue_idx
  ON public.stay_operations_alerts (venue_id, created_at DESC)
  WHERE venue_id IS NOT NULL;

CREATE TABLE public.stay_operations_alert_resolutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id uuid NOT NULL UNIQUE
    REFERENCES public.stay_operations_alerts(id) ON DELETE RESTRICT,
  resolution text NOT NULL CHECK (resolution IN (
    'provider_reconciled', 'materialization_retried', 'no_longer_actionable'
  )),
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  request_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.stay_operations_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stay_operations_alerts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.stay_operations_alert_resolutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stay_operations_alert_resolutions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.stay_operations_alerts
  FROM public, anon, authenticated, service_role;
REVOKE ALL ON public.stay_operations_alert_resolutions
  FROM public, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.stay_operations_alerts TO service_role;
GRANT SELECT, INSERT ON public.stay_operations_alert_resolutions TO service_role;

CREATE TRIGGER stay_operations_alerts_append_only
  BEFORE UPDATE OR DELETE ON public.stay_operations_alerts
  FOR EACH ROW EXECUTE FUNCTION public.issue_1389_guard_append_only();
CREATE TRIGGER stay_operations_alert_resolutions_append_only
  BEFORE UPDATE OR DELETE ON public.stay_operations_alert_resolutions
  FOR EACH ROW EXECUTE FUNCTION public.issue_1389_guard_append_only();

CREATE OR REPLACE FUNCTION public.issue_1427_record_stay_operation_alert(
  p_alert_key text,
  p_alert_kind text,
  p_severity text DEFAULT 'warning',
  p_venue_id uuid DEFAULT NULL,
  p_group_id uuid DEFAULT NULL,
  p_offering_id uuid DEFAULT NULL,
  p_request_id uuid DEFAULT NULL,
  p_safe_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_alert_kind NOT IN ('inventory_changed', 'materialization_failed')
     OR p_severity NOT IN ('warning', 'critical')
     OR char_length(pg_catalog.btrim(COALESCE(p_alert_key, ''))) NOT BETWEEN 8 AND 240
     OR jsonb_typeof(COALESCE(p_safe_metadata, '{}'::jsonb)) <> 'object'
     OR COALESCE(p_safe_metadata, '{}'::jsonb) ?| ARRAY[
       'authorization', 'clientSecret', 'client_secret', 'contact', 'email',
       'guest', 'guestToken', 'guest_token', 'phone', 'providerPayload',
       'provider_secret', 'rawBody', 'raw_body', 'statusToken', 'status_token',
       'storageObjectId', 'storageObjectName', 'token'
     ] THEN
    RAISE EXCEPTION 'stay_invalid_payload' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.stay_operations_alerts (
    alert_key, alert_kind, severity, venue_id, group_id, offering_id,
    request_id, safe_metadata
  ) VALUES (
    pg_catalog.btrim(p_alert_key), p_alert_kind, p_severity, p_venue_id,
    p_group_id, p_offering_id, p_request_id,
    COALESCE(p_safe_metadata, '{}'::jsonb)
  )
  ON CONFLICT (alert_key) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT alert.id INTO v_id
    FROM public.stay_operations_alerts alert
    WHERE alert.alert_key = pg_catalog.btrim(p_alert_key);
  END IF;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_1427_resolve_stay_operation_alert(
  p_alert_id uuid,
  p_resolution text,
  p_actor_user_id uuid,
  p_request_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_resolution NOT IN (
    'provider_reconciled', 'materialization_retried', 'no_longer_actionable'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.stay_operations_alerts alert
    WHERE alert.id = p_alert_id
  ) THEN
    RAISE EXCEPTION 'stay_invalid_payload' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.stay_operations_alert_resolutions (
    alert_id, resolution, actor_user_id, request_id
  ) VALUES (p_alert_id, p_resolution, p_actor_user_id, p_request_id)
  ON CONFLICT (alert_id) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT resolution.id INTO v_id
    FROM public.stay_operations_alert_resolutions resolution
    WHERE resolution.alert_id = p_alert_id;
  END IF;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_1427_admin_stay_venue_projection(
  p_venue_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_venue public.venue_listings%ROWTYPE;
  v_brand public.brands%ROWTYPE;
  v_settings public.stay_settings%ROWTYPE;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_venue
  FROM public.venue_listings venue
  WHERE venue.id = p_venue_id AND venue.venue_category = 'stay';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stay_venue_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_brand FROM public.brands brand WHERE brand.id = v_venue.brand_id;
  SELECT * INTO v_settings FROM public.stay_settings settings
  WHERE settings.venue_id = p_venue_id;

  RETURN jsonb_build_object(
    'snapshotAt', now(),
    'venue', jsonb_build_object(
      'id', v_venue.id, 'brandId', v_venue.brand_id,
      'name', v_venue.name, 'slug', v_venue.slug,
      'address', v_venue.address, 'city', v_venue.city,
      'countryCode', v_venue.country_code,
      'claimStatus', v_venue.claim_status,
      'coverMediaUrl', v_venue.cover_media_url,
      'createdAt', v_venue.created_at, 'updatedAt', v_venue.updated_at
    ),
    'brand', jsonb_build_object(
      'id', v_brand.id, 'name', v_brand.name, 'slug', v_brand.slug,
      'currencyCode', v_brand.default_currency,
      'provisionalCurrencyCode', v_brand.provisional_currency_code,
      'paymentProvider', v_brand.payment_provider,
      'bankReady', public.pg_brand_can_collect(v_brand.id),
      'currencyReconciliationPending', EXISTS (
        SELECT 1 FROM public.brand_currency_reconciliations reconciliation
        WHERE reconciliation.brand_id = v_brand.id
          AND reconciliation.status IN ('pending', 'in_progress')
      )
    ),
    'settings', CASE WHEN v_settings.venue_id IS NULL THEN NULL ELSE
      jsonb_build_object(
        'propertyKind', v_settings.property_kind,
        'summary', v_settings.summary,
        'timezone', v_settings.timezone,
        'bookingMode', v_settings.default_booking_mode,
        'bookingState', v_settings.booking_state,
        'checkInTime', v_settings.check_in_time,
        'checkOutTime', v_settings.check_out_time,
        'bookingHorizonDays', v_settings.booking_horizon_days,
        'amenities', v_settings.amenities,
        'accessibilityFeatures', v_settings.accessibility_features,
        'version', v_settings.version,
        'updatedAt', v_settings.updated_at
      ) END,
    'flags', COALESCE((
      SELECT jsonb_object_agg(flag.flag_key, flag.is_enabled ORDER BY flag.flag_key)
      FROM public.feature_flags flag
      WHERE flag.flag_key LIKE 'STAY\_%' ESCAPE '\'
    ), '{}'::jsonb),
    'offerings', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', offering.id, 'kind', offering.kind, 'name', offering.name,
        'summary', offering.summary, 'description', offering.description,
        'status', offering.status,
        'confirmationMode', COALESCE(
          offering.confirmation_mode, v_settings.default_booking_mode
        ),
        'inventoryBasis', offering.inventory_basis,
        'unitNamingMode', offering.unit_naming_mode,
        'quantity', offering.quantity, 'capacity', offering.capacity,
        'minGuests', offering.min_guests, 'maxGuests', offering.max_guests,
        'amenities', offering.amenities,
        'accessibilityFeatures', offering.accessibility_features,
        'version', offering.version, 'updatedAt', offering.updated_at,
        'units', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', unit_row.id, 'name', unit_row.name,
            'status', unit_row.status, 'version', unit_row.version
          ) ORDER BY unit_row.name, unit_row.id)
          FROM public.stay_units unit_row
          WHERE unit_row.offering_id = offering.id
        ), '[]'::jsonb),
        'media', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', media.id,
            'publicUrl', 'https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/brand_covers/'
              || replace(media.storage_object_name, ' ', '%20'),
            'mimeType', media.mime_type, 'width', media.width,
            'height', media.height, 'altText', media.alt_text,
            'sortOrder', media.sort_order, 'isCover', media.is_cover,
            'status', media.status
          ) ORDER BY media.sort_order, media.id)
          FROM public.stay_offering_media media
          WHERE media.offering_id = offering.id
        ), '[]'::jsonb),
        'availability', jsonb_build_object(
          'roomNightCount', (
            SELECT count(*) FROM public.stay_room_nights night
            WHERE night.offering_id = offering.id
          ),
          'roomNightStopSellCount', (
            SELECT count(*) FROM public.stay_room_nights night
            WHERE night.offering_id = offering.id AND night.stop_sell
          ),
          'placeWindowCount', (
            SELECT count(*) FROM public.stay_place_windows window_row
            WHERE window_row.offering_id = offering.id
          ),
          'placeWindowStopSellCount', (
            SELECT count(*) FROM public.stay_place_windows window_row
            WHERE window_row.offering_id = offering.id AND window_row.stop_sell
          )
        ),
        'price', (
          SELECT jsonb_build_object(
            'versionNumber', price.version_number,
            'amountMinor', price.amount_minor::text,
            'currencyCode', price.currency_code,
            'pricingUnit', price.pricing_unit,
            'effectiveFrom', price.effective_from
          ) FROM public.stay_price_versions price
          WHERE price.offering_id = offering.id AND price.effective_to IS NULL
        ),
        'fees', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'key', fee.fee_key, 'label', fee.label,
            'versionNumber', fee.version_number, 'kind', fee.fee_kind,
            'calculation', fee.calculation,
            'amountMinor', CASE WHEN fee.amount_minor IS NULL THEN NULL
              ELSE fee.amount_minor::text END,
            'basisPoints', fee.basis_points,
            'currencyCode', fee.currency_code,
            'displayMode', fee.display_mode,
            'refundTreatment', fee.refund_treatment
          ) ORDER BY fee.label, fee.id)
          FROM public.stay_fee_versions fee
          WHERE fee.offering_id = offering.id AND fee.effective_to IS NULL
        ), '[]'::jsonb),
        'policy', (
          SELECT jsonb_build_object(
            'versionNumber', policy.version_number,
            'cancellationPolicy', policy.cancellation_policy,
            'freeCancelCutoffMinutes', policy.free_cancel_cutoff_minutes,
            'lateRefundBasisPoints', policy.late_refund_basis_points,
            'noShowRefundBasisPoints', policy.no_show_refund_basis_points,
            'effectiveFrom', policy.effective_from
          ) FROM public.stay_policy_versions policy
          WHERE policy.offering_id = offering.id AND policy.effective_to IS NULL
        )
      ) ORDER BY offering.kind, offering.name, offering.id)
      FROM public.stay_offerings offering
      WHERE offering.venue_id = p_venue_id
    ), '[]'::jsonb),
    'bulkFailures', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'jobId', job.id, 'status', job.status,
        'requestedCount', job.requested_count,
        'succeededCount', job.succeeded_count,
        'failedCount', job.failed_count,
        'createdAt', job.created_at, 'completedAt', job.completed_at
      ) ORDER BY job.created_at DESC, job.id DESC)
      FROM public.stay_bulk_jobs job
      WHERE job.venue_id = p_venue_id AND job.failed_count > 0
    ), '[]'::jsonb)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_1427_admin_list_stay_operations(
  p_search text DEFAULT NULL,
  p_kind text DEFAULT NULL,
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_limit NOT BETWEEN 1 AND 100 OR p_offset < 0 THEN
    RAISE EXCEPTION 'stay_invalid_payload' USING ERRCODE = '22023';
  END IF;

  WITH issues AS (
    SELECT 'reconciliation_required'::text AS issue_kind, 'critical'::text AS severity,
      group_row.id AS group_id, group_row.venue_id, NULL::uuid AS offering_id,
      group_row.brand_id, group_row.public_reference, group_row.state,
      group_row.total_minor, group_row.currency_code,
      group_row.updated_at AS occurred_at, NULL::uuid AS alert_id
    FROM public.stay_reservation_groups group_row
    WHERE group_row.state = 'reconciliation_required'
    UNION ALL
    SELECT CASE attempt.state
        WHEN 'refund_due' THEN 'late_success_refund_due'
        WHEN 'ambiguous' THEN 'payment_ambiguous'
        ELSE 'webhook_lag' END,
      CASE WHEN attempt.state IN ('refund_due', 'ambiguous')
        THEN 'critical' ELSE 'warning' END,
      group_row.id, group_row.venue_id, NULL::uuid, group_row.brand_id,
      group_row.public_reference, attempt.state,
      attempt.amount_minor, attempt.currency_code, attempt.updated_at, NULL::uuid
    FROM public.stay_payment_attempts attempt
    JOIN public.stay_reservation_groups group_row ON group_row.id = attempt.group_id
    WHERE attempt.state IN ('ambiguous', 'refund_due')
       OR (attempt.state = 'pending' AND attempt.updated_at < now() - interval '20 minutes')
    UNION ALL
    SELECT 'aged_hold', CASE WHEN hold.expires_at < now() THEN 'critical' ELSE 'warning' END,
      group_row.id, group_row.venue_id, NULL::uuid, group_row.brand_id,
      group_row.public_reference, hold.state, group_row.total_minor,
      group_row.currency_code, hold.updated_at, NULL::uuid
    FROM public.stay_inventory_holds hold
    JOIN public.stay_reservation_groups group_row ON group_row.id = hold.group_id
    WHERE hold.state = 'active'
      AND (hold.created_at < now() - interval '30 minutes' OR hold.expires_at < now())
    UNION ALL
    SELECT CASE WHEN group_row.state = 'request_pending'
        THEN 'request_expiry_backlog' ELSE 'payment_expiry_backlog' END,
      'warning', group_row.id, group_row.venue_id, NULL::uuid,
      group_row.brand_id, group_row.public_reference, group_row.state,
      group_row.total_minor, group_row.currency_code, group_row.updated_at, NULL::uuid
    FROM public.stay_reservation_groups group_row
    WHERE (group_row.state = 'request_pending' AND group_row.request_deadline < now())
       OR (group_row.state = 'approved_payment_required' AND group_row.payment_deadline < now())
    UNION ALL
    SELECT 'charge_without_confirmation', 'critical', group_row.id,
      group_row.venue_id, NULL::uuid, group_row.brand_id,
      group_row.public_reference, group_row.state, attempt.amount_minor,
      attempt.currency_code, attempt.succeeded_at, NULL::uuid
    FROM public.stay_payment_attempts attempt
    JOIN public.stay_reservation_groups group_row ON group_row.id = attempt.group_id
    WHERE attempt.state = 'succeeded'
      AND group_row.state NOT IN ('confirmed', 'partially_cancelled', 'cancelled')
    UNION ALL
    SELECT 'refund_failure', 'critical', group_row.id, group_row.venue_id,
      NULL::uuid, group_row.brand_id, group_row.public_reference, refund.state,
      refund.amount_minor, refund.currency_code, refund.updated_at, NULL::uuid
    FROM public.stay_refunds refund
    JOIN public.stay_reservation_groups group_row ON group_row.id = refund.group_id
    WHERE refund.state IN ('failed', 'manual_reconciliation')
    UNION ALL
    SELECT 'payout_reversal_owed', 'critical', group_row.id, group_row.venue_id,
      NULL::uuid, group_row.brand_id, group_row.public_reference,
      ledger.entry_type, ledger.amount_minor, ledger.currency_code,
      ledger.occurred_at, NULL::uuid
    FROM public.stay_money_ledger ledger
    JOIN public.stay_reservation_groups group_row ON group_row.id = ledger.group_id
    WHERE ledger.entry_type = 'payout_reversal_owed'
    UNION ALL
    SELECT 'currency_inconsistency', 'critical', group_row.id, group_row.venue_id,
      NULL::uuid, group_row.brand_id, group_row.public_reference, group_row.state,
      group_row.total_minor, group_row.currency_code, group_row.updated_at, NULL::uuid
    FROM public.stay_reservation_groups group_row
    JOIN public.brands brand ON brand.id = group_row.brand_id
    WHERE group_row.currency_code IS DISTINCT FROM brand.default_currency
       OR EXISTS (
         SELECT 1 FROM public.stay_payment_attempts attempt
         WHERE attempt.group_id = group_row.id
           AND attempt.currency_code <> group_row.currency_code
       )
       OR EXISTS (
         SELECT 1 FROM public.stay_refunds refund
         WHERE refund.group_id = group_row.id
           AND refund.currency_code <> group_row.currency_code
       )
    UNION ALL
    SELECT 'notification_exhaustion', 'warning', group_row.id, group_row.venue_id,
      NULL::uuid, group_row.brand_id, group_row.public_reference,
      outbox.status, group_row.total_minor, group_row.currency_code,
      outbox.created_at, NULL::uuid
    FROM public.notification_outbox outbox
    JOIN public.stay_reservation_groups group_row
      ON group_row.id::text = outbox.payload->>'stay_group_id'
    WHERE outbox.category_key LIKE 'stay\_%' ESCAPE '\'
      AND outbox.status = 'failed'
    UNION ALL
    SELECT alert.alert_kind, alert.severity, alert.group_id, alert.venue_id,
      alert.offering_id, COALESCE(group_row.brand_id, venue.brand_id),
      group_row.public_reference, 'open',
      group_row.total_minor, group_row.currency_code,
      alert.created_at, alert.id
    FROM public.stay_operations_alerts alert
    LEFT JOIN public.stay_operations_alert_resolutions resolution
      ON resolution.alert_id = alert.id
    LEFT JOIN public.stay_reservation_groups group_row
      ON group_row.id = alert.group_id
    LEFT JOIN public.venue_listings venue ON venue.id = alert.venue_id
    WHERE resolution.id IS NULL
  ), enriched AS (
    SELECT DISTINCT ON (issue.issue_kind, issue.group_id, issue.alert_id)
      issue.*, brand.name AS brand_name, venue.name AS venue_name
    FROM issues issue
    LEFT JOIN public.brands brand ON brand.id = issue.brand_id
    LEFT JOIN public.venue_listings venue ON venue.id = issue.venue_id
    ORDER BY issue.issue_kind, issue.group_id, issue.alert_id,
      issue.occurred_at DESC
  ), filtered AS (
    SELECT * FROM enriched row_value
    WHERE (p_kind IS NULL OR row_value.issue_kind = p_kind)
      AND (
        NULLIF(pg_catalog.btrim(COALESCE(p_search, '')), '') IS NULL
        OR row_value.public_reference ILIKE '%' || pg_catalog.btrim(p_search) || '%'
        OR row_value.brand_name ILIKE '%' || pg_catalog.btrim(p_search) || '%'
        OR row_value.venue_name ILIKE '%' || pg_catalog.btrim(p_search) || '%'
      )
  ), paged AS (
    SELECT * FROM filtered
    ORDER BY CASE severity WHEN 'critical' THEN 0 ELSE 1 END,
      occurred_at, issue_kind, group_id NULLS LAST, alert_id NULLS LAST
    LIMIT p_limit OFFSET p_offset
  )
  SELECT jsonb_build_object(
    'snapshotAt', now(),
    'total', (SELECT count(*) FROM filtered),
    'counts', COALESCE((
      SELECT jsonb_object_agg(issue_kind, issue_count ORDER BY issue_kind)
      FROM (SELECT issue_kind, count(*) AS issue_count
        FROM filtered GROUP BY issue_kind) count_rows
    ), '{}'::jsonb),
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', COALESCE(
          page.alert_id::text,
          page.group_id::text || ':' || page.issue_kind
        ),
        'issueKind', page.issue_kind, 'severity', page.severity,
        'groupId', page.group_id, 'venueId', page.venue_id,
        'offeringId', page.offering_id, 'alertId', page.alert_id,
        'brandName', page.brand_name, 'venueName', page.venue_name,
        'publicReference', page.public_reference, 'state', page.state,
        'amountMinor', CASE WHEN page.total_minor IS NULL THEN NULL
          ELSE page.total_minor::text END,
        'currencyCode', page.currency_code,
        'occurredAt', page.occurred_at
      ) ORDER BY CASE page.severity WHEN 'critical' THEN 0 ELSE 1 END,
        page.occurred_at, page.issue_kind)
      FROM paged page
    ), '[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_1427_admin_stay_group_projection(
  p_group_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_group public.stay_reservation_groups%ROWTYPE;
  v_brand_name text;
  v_venue_name text;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_group FROM public.stay_reservation_groups group_row
  WHERE group_row.id = p_group_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stay_group_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT brand.name INTO v_brand_name FROM public.brands brand
  WHERE brand.id = v_group.brand_id;
  SELECT venue.name INTO v_venue_name FROM public.venue_listings venue
  WHERE venue.id = v_group.venue_id;

  RETURN jsonb_build_object(
    'snapshotAt', now(), 'version', v_group.version,
    'group', jsonb_build_object(
      'id', v_group.id, 'publicReference', v_group.public_reference,
      'brandId', v_group.brand_id, 'brandName', v_brand_name,
      'venueId', v_group.venue_id, 'venueName', v_venue_name,
      'currencyCode', v_group.currency_code, 'mode', v_group.mode,
      'state', v_group.state,
      'requestDeadline', v_group.request_deadline,
      'paymentDeadline', v_group.payment_deadline,
      'sourceSubtotalMinor', v_group.source_subtotal_minor::text,
      'feeTotalMinor', v_group.fee_total_minor::text,
      'taxTotalMinor', v_group.tax_total_minor::text,
      'totalMinor', v_group.total_minor::text,
      'createdAt', v_group.created_at, 'updatedAt', v_group.updated_at
    ),
    'guest', jsonb_build_object(
      'name', CASE
        WHEN NULLIF(v_group.guest_snapshot->>'name', '') IS NULL THEN NULL
        ELSE left(v_group.guest_snapshot->>'name', 1) || '•••'
      END,
      'email', CASE
        WHEN position('@' IN COALESCE(v_group.guest_snapshot->>'email', '')) > 1
          THEN left(v_group.guest_snapshot->>'email', 1) || '•••@' ||
            split_part(v_group.guest_snapshot->>'email', '@', 2)
        ELSE NULL
      END,
      'phone', CASE
        WHEN char_length(COALESCE(v_group.guest_snapshot->>'phone', '')) >= 4
          THEN '••••' || right(v_group.guest_snapshot->>'phone', 4)
        ELSE NULL
      END
    ),
    'lines', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', line.id, 'offeringId', line.offering_id,
        'offeringName', offering.name, 'kind', line.kind,
        'state', line.state, 'roomCheckIn', line.room_check_in,
        'roomCheckOut', line.room_check_out,
        'roomQuantity', line.room_quantity,
        'placeWindowId', line.place_window_id,
        'placeUnits', line.place_units, 'placeGuests', line.place_guests,
        'adults', line.adults, 'children', line.children,
        'baseMinor', line.base_minor::text,
        'feeMinor', line.fee_minor::text,
        'taxMinor', line.tax_minor::text,
        'totalMinor', line.total_minor::text,
        'dependencyRoomLineId', line.dependency_room_line_id,
        'version', line.version
      ) ORDER BY line.kind, offering.name, line.id)
      FROM public.stay_reservation_lines line
      JOIN public.stay_offerings offering ON offering.id = line.offering_id
      WHERE line.group_id = p_group_id
    ), '[]'::jsonb),
    'hold', (
      SELECT jsonb_build_object(
        'id', hold.id, 'state', hold.state, 'expiresAt', hold.expires_at,
        'reason', hold.reason, 'version', hold.version,
        'createdAt', hold.created_at, 'updatedAt', hold.updated_at,
        'slices', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', slice.id, 'lineId', slice.reservation_line_id,
            'resourceType', slice.resource_type,
            'offeringId', slice.offering_id, 'roomDate', slice.room_date,
            'placeWindowId', slice.place_window_id,
            'quantity', slice.quantity,
            'exclusiveUnitId', slice.exclusive_unit_id
          ) ORDER BY slice.resource_type, slice.room_date,
            slice.place_window_id NULLS FIRST, slice.id)
          FROM public.stay_inventory_hold_slices slice
          WHERE slice.hold_id = hold.id
        ), '[]'::jsonb)
      ) FROM public.stay_inventory_holds hold
      WHERE hold.group_id = p_group_id
    ),
    'commitments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', commitment.id, 'lineId', commitment.reservation_line_id,
        'resourceType', commitment.resource_type,
        'offeringId', commitment.offering_id,
        'roomDate', commitment.room_date,
        'placeWindowId', commitment.place_window_id,
        'quantity', commitment.quantity,
        'exclusiveUnitId', commitment.exclusive_unit_id,
        'state', commitment.state, 'releasedAt', commitment.released_at,
        'releaseReason', commitment.release_reason,
        'createdAt', commitment.created_at
      ) ORDER BY commitment.created_at, commitment.id)
      FROM public.stay_inventory_commitments commitment
      WHERE commitment.group_id = p_group_id
    ), '[]'::jsonb),
    'payments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', attempt.id, 'provider', attempt.provider,
        'attemptOrdinal', attempt.attempt_ordinal,
        'connectedAccountRef', attempt.connected_account_ref,
        'amountMinor', attempt.amount_minor::text,
        'currencyCode', attempt.currency_code,
        'applicationFeeMinor', attempt.application_fee_minor::text,
        'providerFeeMinor', CASE WHEN attempt.provider_fee_minor IS NULL
          THEN NULL ELSE attempt.provider_fee_minor::text END,
        'state', attempt.state,
        'providerPaymentRef', attempt.provider_payment_ref,
        'providerChargeRef', attempt.provider_charge_ref,
        'providerEventRef', attempt.provider_event_ref,
        'failureCode', attempt.failure_code, 'version', attempt.version,
        'createdAt', attempt.created_at, 'updatedAt', attempt.updated_at,
        'succeededAt', attempt.succeeded_at,
        'allocations', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', allocation.id,
            'lineId', allocation.reservation_line_id,
            'component', allocation.component,
            'componentRef', allocation.component_ref,
            'chargedMinor', allocation.charged_minor::text,
            'refundedMinor', allocation.refunded_minor::text,
            'payoutReleasedMinor', allocation.payout_released_minor::text,
            'refundTreatment', allocation.refund_treatment
          ) ORDER BY allocation.reservation_line_id,
            allocation.component, allocation.component_ref)
          FROM public.stay_payment_allocations allocation
          WHERE allocation.payment_attempt_id = attempt.id
        ), '[]'::jsonb),
        'providerEvents', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', provider_event.id,
            'providerEventId', provider_event.provider_event_id,
            'providerEventType', provider_event.provider_event_type,
            'processedAt', provider_event.processed_at
          ) ORDER BY provider_event.processed_at, provider_event.id)
          FROM public.stay_provider_events provider_event
          WHERE provider_event.payment_attempt_id = attempt.id
        ), '[]'::jsonb)
      ) ORDER BY attempt.attempt_ordinal, attempt.id)
      FROM public.stay_payment_attempts attempt
      WHERE attempt.group_id = p_group_id
    ), '[]'::jsonb),
    'refunds', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', refund.id, 'paymentAttemptId', refund.payment_attempt_id,
        'state', refund.state, 'amountMinor', refund.amount_minor::text,
        'currencyCode', refund.currency_code, 'provider', refund.provider,
        'providerRef', refund.provider_ref,
        'sourceRefundId', refund.source_refund_id,
        'failureCode', refund.failure_code, 'version', refund.version,
        'createdAt', refund.created_at, 'updatedAt', refund.updated_at,
        'processedAt', refund.processed_at,
        'allocations', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', allocation.id,
            'paymentAllocationId', allocation.payment_allocation_id,
            'lineId', allocation.reservation_line_id,
            'amountMinor', allocation.amount_minor::text,
            'organizerLiabilityMinor', allocation.organizer_liability_minor::text,
            'platformFeeReversalMinor', allocation.platform_fee_reversal_minor::text,
            'state', allocation.state
          ) ORDER BY allocation.reservation_line_id, allocation.id)
          FROM public.stay_refund_allocations allocation
          WHERE allocation.refund_id = refund.id
        ), '[]'::jsonb)
      ) ORDER BY refund.created_at, refund.id)
      FROM public.stay_refunds refund
      WHERE refund.group_id = p_group_id
    ), '[]'::jsonb),
    'ledger', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', ledger.id, 'lineId', ledger.line_id,
        'paymentAttemptId', ledger.payment_attempt_id,
        'refundId', ledger.refund_id,
        'payoutReleaseId', ledger.payout_release_id,
        'entryType', ledger.entry_type,
        'amountMinor', ledger.amount_minor::text,
        'currencyCode', ledger.currency_code,
        'providerReference', ledger.provider_reference,
        'occurredAt', ledger.occurred_at, 'recordedAt', ledger.recorded_at
      ) ORDER BY ledger.occurred_at, ledger.id)
      FROM public.stay_money_ledger ledger
      WHERE ledger.group_id = p_group_id
    ), '[]'::jsonb),
    'payouts', COALESCE((
      SELECT jsonb_agg(DISTINCT jsonb_build_object(
        'id', release.id, 'provider', release.provider,
        'currencyCode', release.currency,
        'grossMinor', release.gross_cents::text,
        'refundedMinor', release.refunded_cents::text,
        'netReleaseMinor', release.net_release_cents::text,
        'status', release.status, 'releasableAt', release.releasable_at,
        'releasedAt', release.released_at, 'updatedAt', release.updated_at
      ))
      FROM public.brand_payout_releases release
      JOIN public.stay_money_ledger ledger
        ON ledger.payout_release_id = release.id
      WHERE ledger.group_id = p_group_id
    ), '[]'::jsonb),
    'payoutSnapshots', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'lineId', snapshot.reservation_line_id,
        'paymentAttemptId', snapshot.payment_attempt_id,
        'platformFeeMinor', snapshot.platform_fee_minor::text,
        'providerFeeMinor', snapshot.provider_fee_minor::text,
        'providerBalanceTransactionId', snapshot.provider_balance_transaction_id,
        'capturedAt', snapshot.captured_at
      ) ORDER BY snapshot.reservation_line_id)
      FROM public.stay_payout_line_snapshots snapshot
      JOIN public.stay_reservation_lines line
        ON line.id = snapshot.reservation_line_id
      WHERE line.group_id = p_group_id
    ), '[]'::jsonb),
    'notifications', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', outbox.id, 'categoryKey', outbox.category_key,
        'channel', outbox.channel, 'status', outbox.status,
        'attempts', outbox.attempts,
        'createdAt', outbox.created_at,
        'processedAt', outbox.processed_at,
        'nextAttemptAt', outbox.next_attempt_at,
        'parkedAt', outbox.parked_at
      ) ORDER BY outbox.created_at, outbox.id)
      FROM public.notification_outbox outbox
      WHERE outbox.category_key LIKE 'stay\_%' ESCAPE '\'
        AND outbox.payload->>'stay_group_id' = p_group_id::text
    ), '[]'::jsonb),
    'timeline', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', event_row.id, 'lineId', event_row.line_id,
        'eventType', event_row.event_type,
        'actorType', event_row.actor_type,
        'requestId', event_row.request_id,
        'createdAt', event_row.created_at
      ) ORDER BY event_row.created_at, event_row.id)
      FROM public.stay_reservation_events event_row
      WHERE event_row.group_id = p_group_id
    ), '[]'::jsonb)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_1427_admin_retry_stay_notification(
  p_group_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_count integer;
  v_group public.stay_reservation_groups%ROWTYPE;
  v_audit_id uuid;
  v_request_id uuid := gen_random_uuid();
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF translate(
    COALESCE(p_reason, ''),
    E' \t\n\r\f\v' || chr(160) || chr(8203) || chr(8204) || chr(8205)
      || chr(8232) || chr(8233) || chr(65279), ''
  ) = '' THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_group FROM public.stay_reservation_groups group_row
  WHERE group_row.id = p_group_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stay_group_not_found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.notification_outbox outbox
  SET status = 'pending', next_attempt_at = now(), processed_at = NULL,
      parked_at = NULL, last_error = NULL
  WHERE outbox.category_key LIKE 'stay\_%' ESCAPE '\'
    AND outbox.payload->>'stay_group_id' = p_group_id::text
    AND outbox.status = 'failed';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count = 0 THEN
    RAISE EXCEPTION 'stay_notification_retry_unavailable'
      USING ERRCODE = '22023';
  END IF;

  v_audit_id := public.admin_write_audit(
    p_action => 'stay.notification_retry',
    p_entity_type => 'stay_reservation_group',
    p_entity_id => p_group_id::text,
    p_reason => p_reason,
    p_metadata => jsonb_build_object(
      'before', jsonb_build_object('failedCount', v_count),
      'after', jsonb_build_object('pendingCount', v_count)
    )
  );
  INSERT INTO public.stay_reservation_events (
    group_id, event_type, actor_type, actor_user_id, request_id,
    idempotency_key, safe_metadata
  ) VALUES (
    p_group_id, 'stay_admin_notification_retry', 'admin', auth.uid(),
    v_request_id, 'stay:admin:notification_retry:' || v_request_id,
    jsonb_build_object('count', v_count, 'auditId', v_audit_id)
  );
  RETURN jsonb_build_object('retriedCount', v_count, 'version', v_group.version);
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_1427_admin_pause_stay_offering(
  p_offering_id uuid,
  p_expected_version bigint,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_before public.stay_offerings%ROWTYPE;
  v_after public.stay_offerings%ROWTYPE;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF translate(
    COALESCE(p_reason, ''),
    E' \t\n\r\f\v' || chr(160) || chr(8203) || chr(8204) || chr(8205)
      || chr(8232) || chr(8233) || chr(65279), ''
  ) = '' THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_before FROM public.stay_offerings offering
  WHERE offering.id = p_offering_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stay_offering_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_before.status <> 'live' THEN
    RAISE EXCEPTION 'stay_invalid_transition' USING ERRCODE = '22023';
  END IF;
  IF v_before.version <> p_expected_version THEN
    RAISE EXCEPTION 'stay_version_conflict' USING ERRCODE = '40001';
  END IF;
  UPDATE public.stay_offerings offering
  SET status = 'paused', version = offering.version + 1,
      updated_by = auth.uid(), updated_at = now()
  WHERE offering.id = p_offering_id AND offering.version = p_expected_version
  RETURNING * INTO v_after;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stay_version_conflict' USING ERRCODE = '40001';
  END IF;
  PERFORM public.admin_write_audit(
    p_action => 'stay.offering_pause',
    p_entity_type => 'stay_offering',
    p_entity_id => p_offering_id::text,
    p_reason => p_reason,
    p_metadata => jsonb_build_object(
      'before', jsonb_build_object('status', v_before.status, 'version', v_before.version),
      'after', jsonb_build_object('status', v_after.status, 'version', v_after.version)
    )
  );
  RETURN jsonb_build_object(
    'offeringId', v_after.id, 'status', v_after.status,
    'version', v_after.version, 'updatedAt', v_after.updated_at
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_1427_admin_retry_stay_materialization(
  p_alert_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_alert public.stay_operations_alerts%ROWTYPE;
  v_metadata jsonb;
  v_rule_id uuid;
  v_from_date date;
  v_to_date date;
  v_expected_version bigint;
  v_request_id uuid := gen_random_uuid();
  v_result jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF translate(
    COALESCE(p_reason, ''),
    E' \t\n\r\f\v' || chr(160) || chr(8203) || chr(8204) || chr(8205)
      || chr(8232) || chr(8233) || chr(65279), ''
  ) = '' THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_alert
  FROM public.stay_operations_alerts alert
  WHERE alert.id = p_alert_id
    AND alert.alert_kind = 'materialization_failed'
  FOR UPDATE;
  IF NOT FOUND OR EXISTS (
    SELECT 1 FROM public.stay_operations_alert_resolutions resolution
    WHERE resolution.alert_id = p_alert_id
  ) THEN
    RAISE EXCEPTION 'stay_alert_not_found' USING ERRCODE = 'P0002';
  END IF;

  v_metadata := v_alert.safe_metadata;
  v_rule_id := NULLIF(v_metadata->>'scheduleRuleId', '')::uuid;
  v_from_date := NULLIF(v_metadata->>'fromDate', '')::date;
  v_to_date := NULLIF(v_metadata->>'toDate', '')::date;
  v_expected_version := NULLIF(v_metadata->>'expectedVersion', '')::bigint;
  IF v_alert.venue_id IS NULL OR v_rule_id IS NULL
     OR v_from_date IS NULL OR v_to_date IS NULL THEN
    RAISE EXCEPTION 'stay_alert_evidence_incomplete' USING ERRCODE = '22023';
  END IF;

  v_result := public.biz_manage_stay_inventory(
    'materialize_place_windows',
    v_alert.venue_id,
    jsonb_build_object(
      'scheduleRuleId', v_rule_id,
      'fromDate', v_from_date,
      'toDate', v_to_date
    ),
    v_expected_version,
    v_request_id
  );
  INSERT INTO public.stay_operations_alert_resolutions (
    alert_id, resolution, actor_user_id, request_id
  ) VALUES (
    p_alert_id, 'materialization_retried', auth.uid(), v_request_id
  );
  PERFORM public.admin_write_audit(
    p_action => 'stay.materialization_retry',
    p_entity_type => 'stay_operation_alert',
    p_entity_id => p_alert_id::text,
    p_reason => p_reason,
    p_metadata => jsonb_build_object(
      'before', jsonb_build_object('state', 'open'),
      'after', jsonb_build_object('state', 'resolved'),
      'venueId', v_alert.venue_id,
      'offeringId', v_alert.offering_id
    )
  );
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_1427_record_stay_operation_alert(
  text, text, text, uuid, uuid, uuid, uuid, jsonb
) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_1427_resolve_stay_operation_alert(
  uuid, text, uuid, uuid
) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1427_record_stay_operation_alert(
  text, text, text, uuid, uuid, uuid, uuid, jsonb
) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_1427_resolve_stay_operation_alert(
  uuid, text, uuid, uuid
) TO service_role;

REVOKE ALL ON FUNCTION public.issue_1427_admin_stay_venue_projection(uuid)
  FROM public, anon;
REVOKE ALL ON FUNCTION public.issue_1427_admin_list_stay_operations(
  text, text, integer, integer
) FROM public, anon;
REVOKE ALL ON FUNCTION public.issue_1427_admin_stay_group_projection(uuid)
  FROM public, anon;
REVOKE ALL ON FUNCTION public.issue_1427_admin_retry_stay_notification(uuid, text)
  FROM public, anon;
REVOKE ALL ON FUNCTION public.issue_1427_admin_pause_stay_offering(uuid, bigint, text)
  FROM public, anon;
REVOKE ALL ON FUNCTION public.issue_1427_admin_retry_stay_materialization(uuid, text)
  FROM public, anon;

GRANT EXECUTE ON FUNCTION public.issue_1427_admin_stay_venue_projection(uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_1427_admin_list_stay_operations(
  text, text, integer, integer
) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_1427_admin_stay_group_projection(uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_1427_admin_retry_stay_notification(uuid, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_1427_admin_pause_stay_offering(uuid, bigint, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_1427_admin_retry_stay_materialization(uuid, text)
  TO authenticated, service_role;

DO $assert$
BEGIN
  IF has_function_privilege(
    'anon', 'public.issue_1427_admin_stay_group_projection(uuid)', 'EXECUTE'
  ) OR NOT has_function_privilege(
    'authenticated', 'public.issue_1427_admin_stay_group_projection(uuid)', 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'issue_1427_admin_projection_acl_invalid';
  END IF;
  IF has_function_privilege(
    'authenticated',
    'public.issue_1427_record_stay_operation_alert(text,text,text,uuid,uuid,uuid,uuid,jsonb)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'issue_1427_alert_writer_not_service_only';
  END IF;
END;
$assert$;

COMMIT;

NOTIFY pgrst, 'reload schema';
