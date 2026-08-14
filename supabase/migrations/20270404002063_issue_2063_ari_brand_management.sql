-- Issue #2063 — Ari brand-management certification.
--
-- The generic proposal receipt primitives are owned by #1972. This migration
-- adds only the brand-domain transaction wrapper. Every write runs under the
-- caller JWT, inside one SQL transaction, between receipt begin/complete.

-- The canonical discovery-currency writer has always authorized the accepted
-- finance_manager floor, but its mandatory readback function still required
-- event_manager. A pure finance manager therefore rolled the write back while
-- building the response. Re-state the canonical read owner with the same floor
-- so manual Business and Ari callers share one executable role contract.
CREATE OR REPLACE FUNCTION public.issue_1384_brand_currency_state(
  p_brand_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_brand public.brands%ROWTYPE;
  v_reconciliation jsonb;
  v_supported jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_admin_user()
     AND public.biz_brand_effective_rank(p_brand_id, v_uid)
       < public.biz_role_rank('finance_manager'::text) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_brand FROM public.brands WHERE id = p_brand_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'brand_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT to_jsonb(r) INTO v_reconciliation
  FROM public.brand_currency_reconciliations r
  WHERE r.brand_id = p_brand_id AND r.status = 'pending'
  ORDER BY r.initiated_at DESC
  LIMIT 1;

  SELECT jsonb_agg(jsonb_build_object(
    'code', c.code,
    'minorUnitExponent', c.minor_unit_exponent,
    'railSource', c.rail_source
  ) ORDER BY c.display_order) INTO v_supported
  FROM public.supported_brand_currencies c
  WHERE c.active;

  RETURN jsonb_build_object(
    'brandId', p_brand_id,
    'stateVersion', v_brand.discovery_currency_state_version,
    'authority', CASE
      WHEN v_brand.default_currency IS NOT NULL THEN 'settlement'
      WHEN v_brand.provisional_currency_code IS NOT NULL THEN 'provisional'
      ELSE 'unset'
    END,
    'currencyCode', COALESCE(
      v_brand.default_currency,
      v_brand.provisional_currency_code
    ),
    'canAuthorRange', COALESCE(
      v_brand.default_currency,
      v_brand.provisional_currency_code
    ) IS NOT NULL AND v_reconciliation IS NULL,
    'canAcceptPaidReservations',
      public.pg_brand_can_collect(p_brand_id) AND v_brand.default_currency IS NOT NULL,
    'supportedCurrencies', COALESCE(v_supported, '[]'::jsonb),
    'reconciliation', v_reconciliation
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_1384_brand_currency_state(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_1384_brand_currency_state(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.issue_1384_brand_currency_state(uuid) IS
  'Issue #2063: canonical discovery-currency readback aligned to the accepted finance_manager writer floor.';

-- First-brand selection is domain truth, not a best-effort client sequel.
-- Existing clients may repeat the same idempotent UPDATE after insert.
CREATE OR REPLACE FUNCTION public.issue_2063_set_first_brand_default()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  UPDATE public.creator_accounts ca
  SET default_brand_id = NEW.id
  WHERE ca.id = NEW.account_id
    AND ca.default_brand_id IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.brands sibling
      WHERE sibling.account_id = NEW.account_id
        AND sibling.id <> NEW.id
        AND sibling.deleted_at IS NULL
    );
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS issue_2063_set_first_brand_default ON public.brands;
CREATE TRIGGER issue_2063_set_first_brand_default
AFTER INSERT ON public.brands
FOR EACH ROW EXECUTE FUNCTION public.issue_2063_set_first_brand_default();

-- The manual Business app performs a friendly preflight count. This trigger is
-- the authoritative race-safe backstop shared by manual and Ari writes.
CREATE OR REPLACE FUNCTION public.issue_2063_guard_brand_soft_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_blocking_count bigint;
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    SELECT count(DISTINCT e.id)
    INTO v_blocking_count
    FROM public.events e
    JOIN public.event_dates d ON d.event_id = e.id
    WHERE e.brand_id = OLD.id
      AND e.status IN ('scheduled', 'live')
      AND e.deleted_at IS NULL
      AND d.end_at > statement_timestamp();

    IF v_blocking_count > 0 THEN
      RAISE EXCEPTION 'brand_delete_blocked_by_events:%', v_blocking_count
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS issue_2063_guard_brand_soft_delete ON public.brands;
CREATE TRIGGER issue_2063_guard_brand_soft_delete
BEFORE UPDATE OF deleted_at ON public.brands
FOR EACH ROW EXECUTE FUNCTION public.issue_2063_guard_brand_soft_delete();

CREATE OR REPLACE FUNCTION public.issue_2063_clear_deleted_brand_default()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    UPDATE public.creator_accounts
    SET default_brand_id = NULL
    WHERE default_brand_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS issue_2063_clear_deleted_brand_default ON public.brands;
CREATE TRIGGER issue_2063_clear_deleted_brand_default
AFTER UPDATE OF deleted_at ON public.brands
FOR EACH ROW EXECUTE FUNCTION public.issue_2063_clear_deleted_brand_default();

REVOKE ALL ON FUNCTION public.issue_2063_set_first_brand_default() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_2063_guard_brand_soft_delete() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_2063_clear_deleted_brand_default() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ari_execute_brand_operation(
  p_operation_id uuid,
  p_tool_name text,
  p_args jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_begin jsonb;
  v_result jsonb;
  v_brand public.brands%ROWTYPE;
  v_brand_id uuid;
  v_venue_brand_id uuid;
  v_name text;
  v_slug text;
  v_currency text;
  v_expected_version bigint;
  v_count bigint;
  v_deleted_at timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF p_args IS NULL OR jsonb_typeof(p_args) <> 'object' THEN
    RAISE EXCEPTION 'invalid_args' USING ERRCODE = '22023';
  END IF;
  IF p_tool_name NOT IN (
    'create_brand',
    'update_brand',
    'delete_brand',
    'manage_brand_hours',
    'manage_brand_discovery_currency'
  ) THEN
    RAISE EXCEPTION 'unsupported_brand_operation' USING ERRCODE = '22023';
  END IF;

  v_begin := public.agent_operation_receipt_begin(
    p_operation_id,
    p_tool_name,
    p_args
  );
  IF COALESCE((v_begin ->> 'replay')::boolean, false) THEN
    RETURN v_begin -> 'result';
  END IF;

  IF p_tool_name = 'create_brand' THEN
    v_name := btrim(COALESCE(p_args ->> 'name', ''));
    v_slug := lower(btrim(COALESCE(p_args ->> 'slug', '')));
    IF length(v_name) NOT BETWEEN 1 AND 80 THEN
      RAISE EXCEPTION 'invalid_brand_name' USING ERRCODE = '22023';
    END IF;
    IF v_slug = '' THEN
      v_slug := lower(regexp_replace(
        regexp_replace(v_name, '[^a-zA-Z0-9]+', '-', 'g'),
        '(^-+|-+$)', '', 'g'
      ));
    END IF;
    IF length(v_slug) NOT BETWEEN 1 AND 60
       OR v_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' THEN
      RAISE EXCEPTION 'invalid_brand_slug' USING ERRCODE = '22023';
    END IF;
    v_currency := NULLIF(upper(btrim(COALESCE(p_args ->> 'default_currency', ''))), '');
    IF v_currency IS NULL THEN
      SELECT NULLIF(upper(btrim(COALESCE(p.preferred_currency, ''))), '')
      INTO v_currency
      FROM public.agent_user_profile p
      WHERE p.user_id = v_uid;
    END IF;
    IF v_currency IS NOT NULL AND v_currency !~ '^[A-Z]{3}$' THEN
      RAISE EXCEPTION 'invalid_currency' USING ERRCODE = '22023';
    END IF;
    IF p_args ? 'description' AND length(COALESCE(p_args ->> 'description', '')) > 500 THEN
      RAISE EXCEPTION 'invalid_description' USING ERRCODE = '22023';
    END IF;
    IF (p_args ? 'cover_media_url' OR p_args ? 'cover_media_type' OR p_args ? 'cover_media_poster_url')
       AND NOT (
         COALESCE(p_args ->> 'cover_media_url', '') ~ '^https://'
         AND p_args ->> 'cover_media_type' IN ('image', 'gif', 'video')
         AND COALESCE(p_args ->> 'cover_media_poster_url', '') ~ '^https://'
         AND (
           (p_args ->> 'cover_media_type' = 'image'
             AND p_args ->> 'cover_media_poster_url' = p_args ->> 'cover_media_url')
           OR
           (p_args ->> 'cover_media_type' IN ('gif', 'video')
             AND p_args ->> 'cover_media_poster_url' <> p_args ->> 'cover_media_url')
         )
       ) THEN
      RAISE EXCEPTION 'invalid_cover_triplet' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.brands (
      account_id,
      name,
      slug,
      description,
      contact_email,
      default_currency,
      cover_media_url,
      cover_media_type,
      cover_media_poster_url
    ) VALUES (
      v_uid,
      v_name,
      v_slug,
      NULLIF(btrim(COALESCE(p_args ->> 'description', '')), ''),
      NULLIF(btrim(COALESCE(p_args ->> 'contact_email', '')), ''),
      NULL,
      NULLIF(btrim(COALESCE(p_args ->> 'cover_media_url', '')), ''),
      NULLIF(btrim(COALESCE(p_args ->> 'cover_media_type', '')), ''),
      NULLIF(btrim(COALESCE(p_args ->> 'cover_media_poster_url', '')), '')
    )
    RETURNING * INTO v_brand;

    -- A create-time currency is provisional discovery currency, never a forged
    -- settlement currency. This is the same owner used by the Business UI.
    IF v_currency IS NOT NULL THEN
      PERFORM public.issue_1384_set_provisional_currency(
        v_brand.id,
        v_currency::character(3),
        v_brand.discovery_currency_state_version
      );
      SELECT * INTO v_brand FROM public.brands WHERE id = v_brand.id;
    END IF;

    v_result := jsonb_build_object(
      'brand', jsonb_build_object(
        'id', v_brand.id,
        'name', v_brand.name,
        'slug', v_brand.slug,
        'description', v_brand.description,
        'contact_email', v_brand.contact_email,
        'default_currency', v_brand.default_currency,
        'provisional_currency_code', v_brand.provisional_currency_code,
        'cover_media_url', v_brand.cover_media_url,
        'cover_media_poster_url', v_brand.cover_media_poster_url,
        'cover_media_type', v_brand.cover_media_type,
        'created_at', v_brand.created_at,
        'updated_at', v_brand.updated_at
      ),
      'set_as_default', EXISTS (
        SELECT 1 FROM public.creator_accounts ca
        WHERE ca.id = v_uid AND ca.default_brand_id = v_brand.id
      )
    );

  ELSIF p_tool_name = 'update_brand' THEN
    v_brand_id := (p_args ->> 'brand_id')::uuid;
    IF NOT public.biz_is_brand_admin_plus_for_caller(v_brand_id) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO v_brand
    FROM public.brands
    WHERE id = v_brand_id AND deleted_at IS NULL
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'brand_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF NOT (p_args ?| ARRAY[
      'name', 'description', 'contact_email',
      'cover_media_url', 'cover_media_type', 'cover_media_poster_url'
    ]) THEN
      RAISE EXCEPTION 'no_brand_fields' USING ERRCODE = '22023';
    END IF;
    IF p_args ? 'name' AND length(btrim(COALESCE(p_args ->> 'name', ''))) NOT BETWEEN 1 AND 80 THEN
      RAISE EXCEPTION 'invalid_brand_name' USING ERRCODE = '22023';
    END IF;
    IF p_args ? 'description' AND length(COALESCE(p_args ->> 'description', '')) > 500 THEN
      RAISE EXCEPTION 'invalid_description' USING ERRCODE = '22023';
    END IF;
    IF (p_args ? 'cover_media_url' OR p_args ? 'cover_media_type' OR p_args ? 'cover_media_poster_url')
       AND NOT (
         p_args ? 'cover_media_url' AND p_args ? 'cover_media_type' AND p_args ? 'cover_media_poster_url'
         AND COALESCE(p_args ->> 'cover_media_url', '') ~ '^https://'
         AND p_args ->> 'cover_media_type' IN ('image', 'gif', 'video')
         AND COALESCE(p_args ->> 'cover_media_poster_url', '') ~ '^https://'
         AND (
           (p_args ->> 'cover_media_type' = 'image'
             AND p_args ->> 'cover_media_poster_url' = p_args ->> 'cover_media_url')
           OR
           (p_args ->> 'cover_media_type' IN ('gif', 'video')
             AND p_args ->> 'cover_media_poster_url' <> p_args ->> 'cover_media_url')
         )
       ) THEN
      RAISE EXCEPTION 'invalid_cover_triplet' USING ERRCODE = '22023';
    END IF;

    UPDATE public.brands b
    SET name = CASE WHEN p_args ? 'name' THEN btrim(p_args ->> 'name') ELSE b.name END,
        description = CASE WHEN p_args ? 'description'
          THEN NULLIF(btrim(COALESCE(p_args ->> 'description', '')), '') ELSE b.description END,
        contact_email = CASE WHEN p_args ? 'contact_email'
          THEN NULLIF(btrim(COALESCE(p_args ->> 'contact_email', '')), '') ELSE b.contact_email END,
        cover_media_url = CASE WHEN p_args ? 'cover_media_url'
          THEN p_args ->> 'cover_media_url' ELSE b.cover_media_url END,
        cover_media_type = CASE WHEN p_args ? 'cover_media_type'
          THEN p_args ->> 'cover_media_type' ELSE b.cover_media_type END,
        cover_media_poster_url = CASE WHEN p_args ? 'cover_media_poster_url'
          THEN p_args ->> 'cover_media_poster_url' ELSE b.cover_media_poster_url END,
        updated_at = now()
    WHERE b.id = v_brand_id AND b.deleted_at IS NULL
    RETURNING * INTO v_brand;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'brand_not_found' USING ERRCODE = 'P0002';
    END IF;

    v_result := jsonb_build_object('brand', jsonb_build_object(
      'id', v_brand.id,
      'name', v_brand.name,
      'slug', v_brand.slug,
      'description', v_brand.description,
      'contact_email', v_brand.contact_email,
      'default_currency', v_brand.default_currency,
      'provisional_currency_code', v_brand.provisional_currency_code,
      'cover_media_url', v_brand.cover_media_url,
      'cover_media_poster_url', v_brand.cover_media_poster_url,
      'cover_media_type', v_brand.cover_media_type,
      'updated_at', v_brand.updated_at
    ));

  ELSIF p_tool_name = 'delete_brand' THEN
    v_brand_id := (p_args ->> 'brand_id')::uuid;
    SELECT * INTO v_brand
    FROM public.brands
    WHERE id = v_brand_id AND account_id = v_uid AND deleted_at IS NULL
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'brand_not_found_or_not_owner' USING ERRCODE = '42501';
    END IF;
    IF lower(btrim(COALESCE(p_args ->> 'confirm_phrase', '')))
       IS DISTINCT FROM lower(btrim(v_brand.name)) THEN
      RAISE EXCEPTION 'brand_name_confirmation_mismatch' USING ERRCODE = '22023';
    END IF;

    SELECT count(DISTINCT e.id)
    INTO v_count
    FROM public.events e
    JOIN public.event_dates d ON d.event_id = e.id
    WHERE e.brand_id = v_brand_id
      AND e.status IN ('scheduled', 'live')
      AND e.deleted_at IS NULL
      AND d.end_at > statement_timestamp();
    IF v_count > 0 THEN
      RAISE EXCEPTION 'brand_delete_blocked_by_events:%', v_count USING ERRCODE = 'P0001';
    END IF;

    v_deleted_at := statement_timestamp();
    UPDATE public.brands
    SET deleted_at = v_deleted_at, updated_at = v_deleted_at
    WHERE id = v_brand_id AND deleted_at IS NULL;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count <> 1 THEN
      RAISE EXCEPTION 'brand_delete_rowcount:%', v_count USING ERRCODE = 'P0001';
    END IF;
    v_result := jsonb_build_object(
      'brand', jsonb_build_object('id', v_brand_id, 'name', v_brand.name),
      'deleted', true,
      'deleted_at', v_deleted_at,
      'recovery_window_days', 30
    );

  ELSIF p_tool_name = 'manage_brand_hours' THEN
    v_brand_id := (p_args ->> 'brand_id')::uuid;
    IF jsonb_typeof(p_args -> 'hours') IS DISTINCT FROM 'array'
       OR jsonb_array_length(p_args -> 'hours') <> 7 THEN
      RAISE EXCEPTION 'hours_must_have_7_rows' USING ERRCODE = '22023';
    END IF;
    SELECT count(DISTINCT (item ->> 'weekday')::smallint)
    INTO v_count
    FROM jsonb_array_elements(p_args -> 'hours') item
    WHERE COALESCE(item ->> 'weekday', '') ~ '^[0-6]$';
    IF v_count <> 7 OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_args -> 'hours') item
      WHERE COALESCE(item ->> 'weekday', '') !~ '^[0-6]$'
         OR CASE
           WHEN COALESCE((item ->> 'is_closed')::boolean, false) THEN
             item ->> 'open_time' IS NOT NULL OR item ->> 'close_time' IS NOT NULL
           ELSE
             COALESCE(item ->> 'open_time', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
             OR COALESCE(item ->> 'close_time', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
             OR (item ->> 'open_time')::time >= (item ->> 'close_time')::time
         END
    ) THEN
      RAISE EXCEPTION 'invalid_brand_hours' USING ERRCODE = '22023';
    END IF;
    SELECT brand_id INTO v_venue_brand_id
    FROM public.venue_listings
    WHERE id = (p_args ->> 'venue_id')::uuid
    FOR UPDATE;
    IF NOT FOUND OR v_venue_brand_id IS DISTINCT FROM v_brand_id THEN
      RAISE EXCEPTION 'venue_brand_mismatch' USING ERRCODE = '42501';
    END IF;
    IF NOT public.biz_is_brand_admin_plus_for_caller(v_brand_id) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
    PERFORM public.biz_upsert_brand_hours(
      (p_args ->> 'venue_id')::uuid,
      p_args -> 'hours'
    );
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'weekday', h.weekday,
      'open_time', h.open_time,
      'close_time', h.close_time,
      'is_closed', h.is_closed
    ) ORDER BY h.weekday), '[]'::jsonb)
    INTO v_result
    FROM public.brand_hours h
    WHERE h.venue_id = (p_args ->> 'venue_id')::uuid;
    v_result := jsonb_build_object(
      'brand_id', v_brand_id,
      'venue_id', p_args ->> 'venue_id',
      'hours', v_result
    );

  ELSIF p_tool_name = 'manage_brand_discovery_currency' THEN
    v_brand_id := (p_args ->> 'brand_id')::uuid;
    IF public.biz_brand_effective_rank(v_brand_id, v_uid)
       < public.biz_role_rank('finance_manager'::text) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
    CASE p_args ->> 'action'
      WHEN 'set_provisional_currency' THEN
        SELECT COALESCE(
          NULLIF(p_args ->> 'expected_state_version', '')::bigint,
          b.discovery_currency_state_version
        )
        INTO v_expected_version
        FROM public.brands b
        WHERE b.id = v_brand_id AND b.deleted_at IS NULL;
        IF v_expected_version IS NULL THEN
          RAISE EXCEPTION 'brand_not_found' USING ERRCODE = 'P0002';
        END IF;
        v_result := public.issue_1384_set_provisional_currency(
          v_brand_id,
          upper(p_args ->> 'currency_code')::character(3),
          v_expected_version
        );
      WHEN 'resolve_reconciliation' THEN
        v_result := public.issue_1384_resolve_reconciliation(
          v_brand_id,
          (p_args ->> 'reconciliation_id')::uuid,
          p_args ->> 'decision',
          NULLIF(p_args ->> 'fx_snapshot_id', '')::uuid,
          COALESCE(p_args -> 'ranges', '[]'::jsonb),
          p_operation_id
        );
      ELSE
        RAISE EXCEPTION 'invalid_currency_action' USING ERRCODE = '22023';
    END CASE;
  END IF;

  RETURN public.agent_operation_receipt_complete(
    p_operation_id,
    p_tool_name,
    p_args,
    v_result
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.ari_execute_brand_operation(uuid, text, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ari_execute_brand_operation(uuid, text, jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.ari_execute_brand_operation(uuid, text, jsonb) IS
  'Issue #2063: caller-JWT brand mutations with #1972 receipt atomicity. Business hours reuse biz_upsert_brand_hours; currency reuses issue_1384 owners.';
