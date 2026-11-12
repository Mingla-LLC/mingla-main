-- Issue #4389 — Ari create_brand takes the bank country, uses the confirmed
-- operation id as the brand id (a re-confirm is idempotent), and refuses a
-- second in-progress brand (draft_exists / existing_incomplete_brand, PT409).
--
-- ari_execute_brand_operation is copied from its latest (only) definition,
-- 20270507002063_issue_2063_ari_brand_management.sql; only the create_brand
-- branch changes (marked #4389).

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.ari_execute_brand_operation(p_operation_id uuid, p_tool_name text, p_args jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
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
  -- #4389
  v_country text;
  v_dup record;
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

    -- #4389: the bank country is set at create (derive trigger), the brand
    -- id is the confirmed operation id (a re-confirm is idempotent), and a
    -- host keeps one brand in setup at a time.
    v_country := NULLIF(upper(btrim(COALESCE(p_args ->> 'payout_country', ''))), '');
    IF v_country IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.payout_country_rail(v_country)
    ) THEN
      RAISE EXCEPTION 'payout_country_unsupported' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_brand FROM public.brands WHERE id = p_operation_id;
    IF FOUND AND v_brand.account_id IS DISTINCT FROM v_uid THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
    IF NOT FOUND THEN
      SELECT b.id, b.name INTO v_dup
      FROM public.brands b
      WHERE b.account_id = v_uid AND b.deleted_at IS NULL
        AND lower(btrim(b.name)) = lower(v_name)
        AND b.created_at > now() - interval '24 hours'
        AND NOT COALESCE((public.issue_4389_brand_setup_facts(b.id)->>'complete')::boolean, false)
      ORDER BY b.created_at DESC LIMIT 1;
      IF v_dup.id IS NOT NULL THEN
        RAISE EXCEPTION 'existing_incomplete_brand:%', v_dup.id USING ERRCODE = 'PT409';
      END IF;
      SELECT d.brand_id INTO v_brand_id FROM public.issue_4389_user_draft_brand(v_uid, p_operation_id) d;
      IF v_brand_id IS NOT NULL THEN
        RAISE EXCEPTION 'draft_exists:%', v_brand_id USING ERRCODE = 'PT409';
      END IF;

      INSERT INTO public.brands (
        id,
        account_id,
        name,
        slug,
        description,
        contact_email,
        default_currency,
        payout_country,
        cover_media_url,
        cover_media_type,
        cover_media_poster_url
      ) VALUES (
        p_operation_id,
        v_uid,
        v_name,
        v_slug,
        NULLIF(btrim(COALESCE(p_args ->> 'description', '')), ''),
        NULLIF(btrim(COALESCE(p_args ->> 'contact_email', '')), ''),
        NULL,
        v_country,
        NULLIF(btrim(COALESCE(p_args ->> 'cover_media_url', '')), ''),
        NULLIF(btrim(COALESCE(p_args ->> 'cover_media_type', '')), ''),
        NULLIF(btrim(COALESCE(p_args ->> 'cover_media_poster_url', '')), '')
      )
      ON CONFLICT (id) DO NOTHING;
      SELECT * INTO v_brand FROM public.brands WHERE id = p_operation_id;
    END IF;

    -- A create-time currency is provisional discovery currency, never a forged
    -- settlement currency. This is the same owner used by the Business UI.
    IF v_currency IS NOT NULL AND v_brand.payout_country IS NULL
       AND v_brand.default_currency IS NULL AND v_brand.provisional_currency_code IS NULL THEN
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
        'payout_country', v_brand.payout_country,
        'payment_provider', v_brand.payment_provider,
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
             OR (item ->> 'open_time')::time = (item ->> 'close_time')::time
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
        v_expected_version := NULLIF(p_args ->> 'expected_state_version', '')::bigint;
        IF v_expected_version IS NULL OR v_expected_version < 1 THEN
          RAISE EXCEPTION 'expected_state_version_required' USING ERRCODE = '22023';
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

REVOKE ALL ON FUNCTION public.ari_execute_brand_operation(uuid,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ari_execute_brand_operation(uuid,text,jsonb) TO authenticated, service_role;

DO $$
BEGIN
  IF position('payout_country_rail' IN pg_get_functiondef(
      'public.ari_execute_brand_operation(uuid,text,jsonb)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'issue_4389_verify: ari create_brand does not validate the bank country';
  END IF;
  IF position('draft_exists' IN pg_get_functiondef(
      'public.ari_execute_brand_operation(uuid,text,jsonb)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'issue_4389_verify: ari create_brand has no draft guard';
  END IF;
END;
$$;

COMMIT;
