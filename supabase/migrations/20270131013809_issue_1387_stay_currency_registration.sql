-- Issue #1387: register current Stay prices and fixed fees in #1384's
-- brand-currency reconciliation transaction.
--
-- Existing discovery-range callers remain compatible. They may preview the
-- expanded affected set, but the legacy resolver fails closed when Stay money
-- is present; the Stay-aware resolver requires the complete current set and
-- creates replacement versions atomically.

BEGIN;

CREATE OR REPLACE FUNCTION public.issue_1387_register_currency_items()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.status <> 'pending' THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.stay_currency_reconciliation_items (
    reconciliation_id, brand_id, item_kind, source_version_id,
    source_currency_code, source_amount_minor
  )
  SELECT
    NEW.id, p.brand_id, 'price', p.id, p.currency_code, p.amount_minor
  FROM public.stay_price_versions p
  WHERE p.brand_id = NEW.brand_id
    AND p.effective_to IS NULL
  ON CONFLICT DO NOTHING;

  INSERT INTO public.stay_currency_reconciliation_items (
    reconciliation_id, brand_id, item_kind, source_version_id,
    source_currency_code, source_amount_minor
  )
  SELECT
    NEW.id, f.brand_id, 'fee', f.id, f.currency_code, f.amount_minor
  FROM public.stay_fee_versions f
  WHERE f.brand_id = NEW.brand_id
    AND f.effective_to IS NULL
    AND f.calculation LIKE 'fixed_%'
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER issue_1387_currency_items_register
AFTER INSERT ON public.brand_currency_reconciliations
FOR EACH ROW EXECUTE FUNCTION public.issue_1387_register_currency_items();

-- Count Stay money before deciding that a changed bank currency has "no ranges".
CREATE OR REPLACE FUNCTION public.issue_1384_reconcile_bank_currency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_from character(3);
  v_active_count bigint;
  v_reason text;
BEGIN
  IF NEW.default_currency IS NULL
     OR NEW.default_currency IS NOT DISTINCT FROM OLD.default_currency THEN
    RETURN NEW;
  END IF;

  v_from := COALESCE(OLD.default_currency, NEW.provisional_currency_code);
  IF v_from IS NULL THEN
    RETURN NEW;
  END IF;

  v_reason := CASE
    WHEN OLD.default_currency IS NULL THEN 'bank_attached'
    ELSE 'bank_changed'
  END;

  SELECT
    (
      SELECT count(*)
      FROM public.place_discovery_price_ranges r
      WHERE r.brand_id = NEW.id
        AND r.status IN ('active', 'reconciliation_required')
    )
    + (
      SELECT count(*)
      FROM public.stay_price_versions p
      WHERE p.brand_id = NEW.id AND p.effective_to IS NULL
    )
    + (
      SELECT count(*)
      FROM public.stay_fee_versions f
      WHERE f.brand_id = NEW.id
        AND f.effective_to IS NULL
        AND f.calculation LIKE 'fixed_%'
    )
  INTO v_active_count;

  IF v_from = NEW.default_currency THEN
    INSERT INTO public.brand_currency_reconciliations (
      brand_id, from_currency_code, to_currency_code, reason, status,
      decision, initiated_by, resolved_by, resolved_at
    ) VALUES (
      NEW.id, v_from, NEW.default_currency, v_reason, 'matched',
      'accept_no_ranges', auth.uid(), auth.uid(), now()
    );
    UPDATE public.brands
      SET provisional_currency_code = NULL
      WHERE id = NEW.id;
  ELSIF v_active_count = 0 THEN
    INSERT INTO public.brand_currency_reconciliations (
      brand_id, from_currency_code, to_currency_code, reason, status,
      decision, initiated_by, resolved_by, resolved_at
    ) VALUES (
      NEW.id, v_from, NEW.default_currency, v_reason, 'accepted_no_ranges',
      'accept_no_ranges', auth.uid(), auth.uid(), now()
    );
    UPDATE public.brands
      SET provisional_currency_code = NULL
      WHERE id = NEW.id;
  ELSE
    INSERT INTO public.brand_currency_reconciliations (
      brand_id, from_currency_code, to_currency_code, reason, status,
      initiated_by
    ) VALUES (
      NEW.id, v_from, NEW.default_currency, v_reason, 'pending', auth.uid()
    ) ON CONFLICT (brand_id) WHERE status = 'pending' DO NOTHING;

    PERFORM set_config(
      'mingla.discovery_price_action',
      'currency_reconciliation_required',
      true
    );
    UPDATE public.place_discovery_price_ranges
      SET status = 'reconciliation_required',
          updated_at = now(),
          updated_by = auth.uid(),
          version = version + 1
      WHERE brand_id = NEW.id
        AND status = 'active';
  END IF;

  RETURN NEW;
END;
$function$;

-- The no-bank provisional choice uses the same expanded affected-money count.
CREATE OR REPLACE FUNCTION public.issue_1384_set_provisional_currency(
  p_brand_id uuid,
  p_currency_code character(3),
  p_expected_state_version bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_brand public.brands%ROWTYPE;
  v_range_count bigint;
  v_reconciliation_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF public.biz_brand_effective_rank(p_brand_id, v_uid)
       < public.biz_role_rank('finance_manager'::text) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.supported_brand_currencies c
    WHERE c.code = upper(p_currency_code::text)::character(3) AND c.active
  ) THEN
    RAISE EXCEPTION 'unsupported_currency' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_brand
  FROM public.brands
  WHERE id = p_brand_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'brand_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_brand.default_currency IS NOT NULL THEN
    RAISE EXCEPTION 'currency_already_set' USING ERRCODE = 'P0001';
  END IF;
  IF v_brand.discovery_currency_state_version <> p_expected_state_version THEN
    RAISE EXCEPTION 'range_version_conflict' USING ERRCODE = '40001';
  END IF;
  IF v_brand.provisional_currency_code = p_currency_code THEN
    RETURN public.issue_1384_brand_currency_state(p_brand_id);
  END IF;

  SELECT
    (
      SELECT count(*)
      FROM public.place_discovery_price_ranges r
      WHERE r.brand_id = p_brand_id
        AND r.status IN ('active', 'reconciliation_required')
    )
    + (
      SELECT count(*)
      FROM public.stay_price_versions p
      WHERE p.brand_id = p_brand_id AND p.effective_to IS NULL
    )
    + (
      SELECT count(*)
      FROM public.stay_fee_versions f
      WHERE f.brand_id = p_brand_id
        AND f.effective_to IS NULL
        AND f.calculation LIKE 'fixed_%'
    )
  INTO v_range_count;

  IF v_brand.provisional_currency_code IS NOT NULL AND v_range_count > 0 THEN
    INSERT INTO public.brand_currency_reconciliations (
      brand_id, from_currency_code, to_currency_code, reason, status,
      initiated_by
    ) VALUES (
      p_brand_id,
      v_brand.provisional_currency_code,
      p_currency_code,
      'provisional_changed',
      'pending',
      v_uid
    ) RETURNING id INTO v_reconciliation_id;
    PERFORM set_config(
      'mingla.discovery_price_action',
      'currency_reconciliation_required',
      true
    );
    UPDATE public.place_discovery_price_ranges
      SET status = 'reconciliation_required',
          version = version + 1,
          updated_by = v_uid,
          updated_at = now()
      WHERE brand_id = p_brand_id AND status = 'active';
  ELSE
    UPDATE public.brands
      SET provisional_currency_code = p_currency_code
      WHERE id = p_brand_id;
  END IF;

  RETURN public.issue_1384_brand_currency_state(p_brand_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_1384_preview_reconciliation(
  p_brand_id uuid,
  p_reconciliation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_rec public.brand_currency_reconciliations%ROWTYPE;
  v_snapshot record;
  v_ranges jsonb;
  v_stay_items jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF public.biz_brand_effective_rank(p_brand_id, v_uid)
       < public.biz_role_rank('finance_manager'::text) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_rec
  FROM public.brand_currency_reconciliations
  WHERE id = p_reconciliation_id
    AND brand_id = p_brand_id
    AND status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reconciliation_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_snapshot
  FROM public.fx_latest_servable_snapshot(now());
  IF v_snapshot.snapshot_id IS NULL THEN
    RAISE EXCEPTION 'fx_unavailable' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'placePoolId', r.place_pool_id,
    'venueId', r.venue_id,
    'expectedVersion', r.version,
    'sourceMinMinor', r.source_min_minor,
    'sourceMaxMinor', r.source_max_minor,
    'sourceCurrencyCode', r.source_currency_code,
    'proposedMinMinor', public.fx_convert_minor(
      r.source_min_minor, r.source_currency_code,
      v_rec.to_currency_code, v_snapshot.snapshot_id
    ),
    'proposedMaxMinor', CASE WHEN r.source_max_minor IS NULL THEN NULL ELSE
      public.fx_convert_minor(
        r.source_max_minor, r.source_currency_code,
        v_rec.to_currency_code, v_snapshot.snapshot_id
      )
    END
  ) ORDER BY r.place_pool_id), '[]'::jsonb)
  INTO v_ranges
  FROM public.place_discovery_price_ranges r
  WHERE r.brand_id = p_brand_id
    AND r.status = 'reconciliation_required';

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'itemId', i.id,
    'kind', i.item_kind,
    'sourceVersionId', i.source_version_id,
    'sourceAmountMinor', i.source_amount_minor,
    'sourceCurrencyCode', i.source_currency_code,
    'proposedAmountMinor', public.fx_convert_minor(
      i.source_amount_minor,
      i.source_currency_code,
      v_rec.to_currency_code,
      v_snapshot.snapshot_id
    )
  ) ORDER BY i.item_kind, i.source_version_id), '[]'::jsonb)
  INTO v_stay_items
  FROM public.stay_currency_reconciliation_items i
  WHERE i.reconciliation_id = p_reconciliation_id
    AND i.brand_id = p_brand_id
    AND i.status = 'pending';

  RETURN jsonb_build_object(
    'reconciliationId', v_rec.id,
    'fromCurrencyCode', v_rec.from_currency_code,
    'toCurrencyCode', v_rec.to_currency_code,
    'snapshot', jsonb_build_object(
      'id', v_snapshot.snapshot_id,
      'provider', v_snapshot.provider,
      'providerUpdatedAt', v_snapshot.provider_updated_at,
      'freshness', v_snapshot.freshness
    ),
    'ranges', v_ranges,
    'stayItems', v_stay_items
  );
END;
$function$;

-- Preserve the old signature, but make it fail closed if its request would
-- silently omit Stay money.
CREATE OR REPLACE FUNCTION public.issue_1384_resolve_reconciliation(
  p_brand_id uuid,
  p_reconciliation_id uuid,
  p_decision text,
  p_fx_snapshot_id uuid DEFAULT NULL,
  p_ranges jsonb DEFAULT '[]'::jsonb,
  p_request_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_rec public.brand_currency_reconciliations%ROWTYPE;
  v_brand public.brands%ROWTYPE;
  v_authoritative_ids uuid[];
  v_request_ids uuid[];
  v_item jsonb;
  v_range public.place_discovery_price_ranges%ROWTYPE;
  v_new_min bigint;
  v_new_max bigint;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF public.biz_brand_effective_rank(p_brand_id, v_uid)
       < public.biz_role_rank('finance_manager'::text) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_decision NOT IN ('convert', 'reenter', 'accept_no_ranges') THEN
    RAISE EXCEPTION 'incomplete_reentry' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(
    current_setting('mingla.stay_currency_resolution', true),
    ''
  ) <> 'allowed' AND EXISTS (
    SELECT 1
    FROM public.stay_currency_reconciliation_items i
    WHERE i.reconciliation_id = p_reconciliation_id
      AND i.brand_id = p_brand_id
      AND i.status = 'pending'
  ) THEN
    RAISE EXCEPTION 'stay_currency_reconciliation_required'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_brand
  FROM public.brands
  WHERE id = p_brand_id
  FOR UPDATE;
  SELECT * INTO v_rec
  FROM public.brand_currency_reconciliations
  WHERE id = p_reconciliation_id
    AND brand_id = p_brand_id
  FOR UPDATE;
  IF NOT FOUND OR v_rec.status <> 'pending' THEN
    RAISE EXCEPTION 'reconciliation_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_brand.default_currency IS NOT NULL
     AND v_brand.default_currency <> v_rec.to_currency_code THEN
    RAISE EXCEPTION 'currency_mismatch' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.place_discovery_price_ranges r
  WHERE r.brand_id = p_brand_id
    AND r.status = 'reconciliation_required'
  FOR UPDATE;

  SELECT COALESCE(array_agg(r.place_pool_id ORDER BY r.place_pool_id), '{}')
  INTO v_authoritative_ids
  FROM public.place_discovery_price_ranges r
  WHERE r.brand_id = p_brand_id
    AND r.status = 'reconciliation_required';

  SELECT COALESCE(
    array_agg((item->>'placePoolId')::uuid ORDER BY (item->>'placePoolId')::uuid),
    '{}'
  ) INTO v_request_ids
  FROM jsonb_array_elements(COALESCE(p_ranges, '[]'::jsonb)) item;

  IF p_decision = 'accept_no_ranges' THEN
    IF cardinality(v_authoritative_ids) <> 0 OR cardinality(v_request_ids) <> 0 THEN
      RAISE EXCEPTION 'range_set_changed' USING ERRCODE = '40001';
    END IF;
  ELSIF v_authoritative_ids IS DISTINCT FROM v_request_ids THEN
    RAISE EXCEPTION 'range_set_changed' USING ERRCODE = '40001';
  END IF;

  IF p_request_id IS NOT NULL THEN
    PERFORM set_config('mingla.request_id', p_request_id::text, true);
  END IF;
  PERFORM set_config(
    'mingla.discovery_price_reconciliation_id',
    p_reconciliation_id::text,
    true
  );
  PERFORM set_config(
    'mingla.discovery_price_action',
    CASE p_decision WHEN 'convert' THEN 'reconciled_conversion'
      ELSE 'reentered' END,
    true
  );

  IF p_decision = 'convert' THEN
    IF p_fx_snapshot_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.fx_rate_snapshots s
      WHERE s.id = p_fx_snapshot_id
        AND s.status IN ('active', 'superseded')
        AND now() <= s.expires_at
    ) THEN
      RAISE EXCEPTION 'fx_snapshot_stale' USING ERRCODE = '22023';
    END IF;
    PERFORM set_config(
      'mingla.discovery_price_fx_snapshot_id',
      p_fx_snapshot_id::text,
      true
    );
  END IF;

  FOR v_item IN
    SELECT * FROM jsonb_array_elements(COALESCE(p_ranges, '[]'::jsonb))
  LOOP
    SELECT * INTO v_range
    FROM public.place_discovery_price_ranges r
    WHERE r.place_pool_id = (v_item->>'placePoolId')::uuid
      AND r.brand_id = p_brand_id
    FOR UPDATE;
    IF NOT FOUND OR v_range.version <> (v_item->>'expectedVersion')::bigint THEN
      RAISE EXCEPTION 'range_version_conflict' USING ERRCODE = '40001';
    END IF;

    IF p_decision = 'convert' THEN
      v_new_min := public.fx_convert_minor(
        v_range.source_min_minor,
        v_range.source_currency_code,
        v_rec.to_currency_code,
        p_fx_snapshot_id
      );
      v_new_max := CASE WHEN v_range.source_max_minor IS NULL THEN NULL ELSE
        public.fx_convert_minor(
          v_range.source_max_minor,
          v_range.source_currency_code,
          v_rec.to_currency_code,
          p_fx_snapshot_id
        )
      END;
    ELSE
      IF (v_item->>'currencyCode')::character(3) <> v_rec.to_currency_code THEN
        RAISE EXCEPTION 'currency_mismatch' USING ERRCODE = '22023';
      END IF;
      v_new_min := (v_item->>'sourceMinMinor')::bigint;
      v_new_max := NULLIF(v_item->>'sourceMaxMinor', '')::bigint;
      IF v_new_min IS NULL OR v_new_min < 0
         OR (v_new_max IS NOT NULL AND v_new_max < v_new_min) THEN
        RAISE EXCEPTION 'invalid_range' USING ERRCODE = '22023';
      END IF;
    END IF;

    UPDATE public.place_discovery_price_ranges
      SET status = 'active',
          source_min_minor = v_new_min,
          source_max_minor = v_new_max,
          source_currency_code = v_rec.to_currency_code,
          source_type = CASE WHEN p_decision = 'convert'
            THEN 'reconciled_conversion' ELSE 'business_authored' END,
          source_recorded_at = now(),
          version = version + 1,
          updated_by = v_uid,
          updated_at = now()
      WHERE place_pool_id = v_range.place_pool_id;
  END LOOP;

  UPDATE public.brand_currency_reconciliations
    SET status = CASE p_decision
      WHEN 'convert' THEN 'converted'
      WHEN 'reenter' THEN 'reentered'
      ELSE 'accepted_no_ranges'
    END,
    decision = p_decision,
    fx_snapshot_id = p_fx_snapshot_id,
    resolved_by = v_uid,
    resolved_at = now(),
    resolution_metadata = jsonb_build_object(
      'rangeCount', cardinality(v_authoritative_ids),
      'requestId', p_request_id
    )
  WHERE id = p_reconciliation_id;

  UPDATE public.brands
    SET provisional_currency_code = CASE
      WHEN default_currency IS NULL
        AND v_rec.reason = 'provisional_changed'
      THEN v_rec.to_currency_code
      ELSE NULL
    END
  WHERE id = p_brand_id;

  RETURN public.issue_1384_brand_currency_state(p_brand_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_1387_resolve_currency_reconciliation(
  p_brand_id uuid,
  p_reconciliation_id uuid,
  p_decision text,
  p_fx_snapshot_id uuid DEFAULT NULL,
  p_ranges jsonb DEFAULT '[]'::jsonb,
  p_stay_items jsonb DEFAULT '[]'::jsonb,
  p_request_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_rec public.brand_currency_reconciliations%ROWTYPE;
  v_authoritative_ids uuid[];
  v_request_ids uuid[];
  v_item jsonb;
  v_registered public.stay_currency_reconciliation_items%ROWTYPE;
  v_price public.stay_price_versions%ROWTYPE;
  v_fee public.stay_fee_versions%ROWTYPE;
  v_new_amount bigint;
  v_new_version integer;
  v_replacement_id uuid;
  v_state jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF public.biz_brand_effective_rank(p_brand_id, v_uid)
       < public.biz_role_rank('finance_manager'::text) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_decision NOT IN ('convert', 'reenter', 'accept_no_ranges') THEN
    RAISE EXCEPTION 'incomplete_reentry' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_rec
  FROM public.brand_currency_reconciliations
  WHERE id = p_reconciliation_id
    AND brand_id = p_brand_id
    AND status = 'pending'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reconciliation_not_found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM 1
  FROM public.stay_currency_reconciliation_items i
  WHERE i.reconciliation_id = p_reconciliation_id
    AND i.brand_id = p_brand_id
    AND i.status = 'pending'
  FOR UPDATE;

  SELECT COALESCE(array_agg(i.id ORDER BY i.id), '{}')
  INTO v_authoritative_ids
  FROM public.stay_currency_reconciliation_items i
  WHERE i.reconciliation_id = p_reconciliation_id
    AND i.brand_id = p_brand_id
    AND i.status = 'pending';

  SELECT COALESCE(
    array_agg((item->>'itemId')::uuid ORDER BY (item->>'itemId')::uuid),
    '{}'
  ) INTO v_request_ids
  FROM jsonb_array_elements(COALESCE(p_stay_items, '[]'::jsonb)) item;

  IF p_decision = 'accept_no_ranges' THEN
    IF cardinality(v_authoritative_ids) <> 0 OR cardinality(v_request_ids) <> 0 THEN
      RAISE EXCEPTION 'stay_money_set_changed' USING ERRCODE = '40001';
    END IF;
  ELSIF v_authoritative_ids IS DISTINCT FROM v_request_ids THEN
    RAISE EXCEPTION 'stay_money_set_changed' USING ERRCODE = '40001';
  END IF;

  IF p_decision = 'convert' AND (
    p_fx_snapshot_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.fx_rate_snapshots s
      WHERE s.id = p_fx_snapshot_id
        AND s.status IN ('active', 'superseded')
        AND now() <= s.expires_at
    )
  ) THEN
    RAISE EXCEPTION 'fx_snapshot_stale' USING ERRCODE = '22023';
  END IF;

  FOR v_item IN
    SELECT * FROM jsonb_array_elements(COALESCE(p_stay_items, '[]'::jsonb))
  LOOP
    SELECT * INTO v_registered
    FROM public.stay_currency_reconciliation_items i
    WHERE i.id = (v_item->>'itemId')::uuid
      AND i.reconciliation_id = p_reconciliation_id
      AND i.brand_id = p_brand_id
      AND i.status = 'pending'
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'stay_money_set_changed' USING ERRCODE = '40001';
    END IF;

    IF p_decision = 'convert' THEN
      v_new_amount := public.fx_convert_minor(
        v_registered.source_amount_minor,
        v_registered.source_currency_code,
        v_rec.to_currency_code,
        p_fx_snapshot_id
      );
    ELSE
      IF upper(v_item->>'currencyCode')::character(3)
         <> v_rec.to_currency_code THEN
        RAISE EXCEPTION 'currency_mismatch' USING ERRCODE = '22023';
      END IF;
      v_new_amount := (v_item->>'amountMinor')::bigint;
      IF v_new_amount IS NULL OR v_new_amount < 0 THEN
        RAISE EXCEPTION 'invalid_range' USING ERRCODE = '22023';
      END IF;
    END IF;

    IF v_registered.item_kind = 'price' THEN
      SELECT * INTO v_price
      FROM public.stay_price_versions p
      WHERE p.id = v_registered.source_version_id
        AND p.brand_id = p_brand_id
        AND p.effective_to IS NULL
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'stay_money_set_changed' USING ERRCODE = '40001';
      END IF;
      SELECT max(p.version_number) + 1 INTO v_new_version
      FROM public.stay_price_versions p
      WHERE p.offering_id = v_price.offering_id;
      UPDATE public.stay_price_versions SET effective_to = now()
      WHERE id = v_price.id;
      INSERT INTO public.stay_price_versions (
        offering_id, brand_id, venue_id, version_number, amount_minor,
        currency_code, pricing_unit, reconciliation_id,
        supersedes_version_id, created_by
      ) VALUES (
        v_price.offering_id, v_price.brand_id, v_price.venue_id,
        v_new_version, v_new_amount, v_rec.to_currency_code,
        v_price.pricing_unit, p_reconciliation_id, v_price.id, v_uid
      ) RETURNING id INTO v_replacement_id;
    ELSE
      SELECT * INTO v_fee
      FROM public.stay_fee_versions f
      WHERE f.id = v_registered.source_version_id
        AND f.brand_id = p_brand_id
        AND f.effective_to IS NULL
        AND f.calculation LIKE 'fixed_%'
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'stay_money_set_changed' USING ERRCODE = '40001';
      END IF;
      SELECT max(f.version_number) + 1 INTO v_new_version
      FROM public.stay_fee_versions f
      WHERE f.offering_id = v_fee.offering_id
        AND f.fee_key = v_fee.fee_key;
      UPDATE public.stay_fee_versions SET effective_to = now()
      WHERE id = v_fee.id;
      INSERT INTO public.stay_fee_versions (
        offering_id, brand_id, venue_id, fee_key, label, version_number,
        fee_kind, calculation, amount_minor, basis_points, currency_code,
        display_mode, refund_treatment, reconciliation_id,
        supersedes_version_id, created_by
      ) VALUES (
        v_fee.offering_id, v_fee.brand_id, v_fee.venue_id, v_fee.fee_key,
        v_fee.label, v_new_version, v_fee.fee_kind, v_fee.calculation,
        v_new_amount, NULL, v_rec.to_currency_code, v_fee.display_mode,
        v_fee.refund_treatment, p_reconciliation_id, v_fee.id, v_uid
      ) RETURNING id INTO v_replacement_id;
    END IF;

    UPDATE public.stay_currency_reconciliation_items
      SET status = CASE p_decision WHEN 'convert' THEN 'converted'
        ELSE 'reentered' END,
          replacement_version_id = v_replacement_id,
          resolved_at = now()
      WHERE id = v_registered.id;
  END LOOP;

  PERFORM set_config('mingla.stay_currency_resolution', 'allowed', true);
  SELECT public.issue_1384_resolve_reconciliation(
    p_brand_id,
    p_reconciliation_id,
    p_decision,
    p_fx_snapshot_id,
    p_ranges,
    p_request_id
  ) INTO v_state;

  UPDATE public.brand_currency_reconciliations
    SET resolution_metadata = resolution_metadata || jsonb_build_object(
      'stayMoneyCount', cardinality(v_authoritative_ids)
    )
  WHERE id = p_reconciliation_id;

  RETURN v_state;
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_1387_register_currency_items()
  FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_1387_resolve_currency_reconciliation(
  uuid, uuid, text, uuid, jsonb, jsonb, uuid
) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.issue_1387_resolve_currency_reconciliation(
  uuid, uuid, text, uuid, jsonb, jsonb, uuid
) TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
