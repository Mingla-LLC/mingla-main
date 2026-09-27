-- Issue #3563 — one authenticated Business-client transaction owns a modifier
-- group and its complete desired active option set. The separate ARI writer is
-- intentionally outside this issue and remains tracked by #3577.

BEGIN;

CREATE OR REPLACE FUNCTION public.biz_save_menu_modifier_group_v1(
  p_brand_id uuid,
  p_menu_item_id uuid,
  p_group_id uuid,
  p_name text,
  p_selection_mode text,
  p_min_select integer,
  p_max_select integer,
  p_sort_order integer,
  p_options jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_item public.menu_items%ROWTYPE;
  v_group public.menu_modifier_groups%ROWTYPE;
  v_group_exists boolean := false;
  v_option jsonb;
  v_option_id uuid;
  v_option_ids uuid[] := ARRAY[]::uuid[];
  v_sort_orders integer[] := ARRAY[]::integer[];
  v_keys text[];
  v_name text;
  v_delta bigint;
  v_sort integer;
  v_option_count integer;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;
  IF p_brand_id IS NULL
     OR public.biz_brand_effective_rank(p_brand_id, v_uid)
        < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'modifier_group_forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_group_id IS NULL OR p_menu_item_id IS NULL THEN
    RAISE EXCEPTION 'modifier_group_identity_required' USING ERRCODE = '22023';
  END IF;

  SELECT item.*
    INTO v_item
    FROM public.menu_items item
   WHERE item.id = p_menu_item_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'menu_item_not_found' USING ERRCODE = '22023';
  END IF;
  IF v_item.brand_id IS DISTINCT FROM p_brand_id THEN
    RAISE EXCEPTION 'menu_item_brand_mismatch' USING ERRCODE = '42501';
  END IF;

  SELECT modifier_group.*
    INTO v_group
    FROM public.menu_modifier_groups modifier_group
   WHERE modifier_group.id = p_group_id
   FOR UPDATE;
  IF FOUND THEN
    v_group_exists := true;
    IF v_group.brand_id IS DISTINCT FROM p_brand_id
       OR v_group.menu_item_id IS DISTINCT FROM p_menu_item_id THEN
      RAISE EXCEPTION 'modifier_group_scope_mismatch' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Current children lock after the parent locks, in deterministic ID order.
  PERFORM current_option.id
    FROM public.menu_modifiers current_option
   WHERE current_option.group_id = p_group_id
   ORDER BY current_option.id
   FOR UPDATE;

  v_name := pg_catalog.btrim(p_name);
  IF v_name IS NULL OR pg_catalog.length(v_name) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION 'modifier_group_name_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_selection_mode NOT IN ('single', 'multi') THEN
    RAISE EXCEPTION 'modifier_group_selection_mode_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_min_select IS NULL OR p_min_select NOT BETWEEN 0 AND 20 THEN
    RAISE EXCEPTION 'modifier_group_min_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_max_select IS NOT NULL AND p_max_select NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'modifier_group_max_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_sort_order IS NULL OR p_sort_order < 0 THEN
    RAISE EXCEPTION 'modifier_group_sort_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_selection_mode = 'single'
     AND (p_min_select > 1 OR (p_max_select IS NOT NULL AND p_max_select <> 1)) THEN
    RAISE EXCEPTION 'modifier_group_single_bounds_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_selection_mode = 'multi'
     AND p_max_select IS NOT NULL
     AND p_max_select < p_min_select THEN
    RAISE EXCEPTION 'modifier_group_multi_bounds_invalid' USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.jsonb_typeof(p_options) IS DISTINCT FROM 'array'
     OR pg_catalog.jsonb_array_length(p_options) = 0 THEN
    RAISE EXCEPTION 'modifier_options_nonempty_array_required' USING ERRCODE = '22023';
  END IF;

  v_option_count := pg_catalog.jsonb_array_length(p_options);
  IF p_min_select > v_option_count THEN
    RAISE EXCEPTION 'modifier_group_min_exceeds_options' USING ERRCODE = '22023';
  END IF;

  FOR v_option IN SELECT value FROM pg_catalog.jsonb_array_elements(p_options) LOOP
    IF pg_catalog.jsonb_typeof(v_option) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'modifier_option_object_required' USING ERRCODE = '22023';
    END IF;
    SELECT pg_catalog.array_agg(key ORDER BY key)
      INTO v_keys
      FROM pg_catalog.jsonb_object_keys(v_option) AS key;
    IF v_keys IS DISTINCT FROM ARRAY['id','name','price_delta_cents','sort_order']::text[] THEN
      RAISE EXCEPTION 'modifier_option_keys_invalid' USING ERRCODE = '22023';
    END IF;
    IF pg_catalog.jsonb_typeof(v_option->'id') IS DISTINCT FROM 'string'
       OR pg_catalog.jsonb_typeof(v_option->'name') IS DISTINCT FROM 'string'
       OR pg_catalog.jsonb_typeof(v_option->'price_delta_cents') IS DISTINCT FROM 'number'
       OR pg_catalog.jsonb_typeof(v_option->'sort_order') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'modifier_option_types_invalid' USING ERRCODE = '22023';
    END IF;

    BEGIN
      v_option_id := (v_option->>'id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'modifier_option_id_invalid' USING ERRCODE = '22023';
    END;
    IF v_option_id = ANY(v_option_ids) THEN
      RAISE EXCEPTION 'modifier_option_id_duplicate' USING ERRCODE = '22023';
    END IF;
    v_option_ids := pg_catalog.array_append(v_option_ids, v_option_id);

    v_name := pg_catalog.btrim(v_option->>'name');
    IF pg_catalog.length(v_name) NOT BETWEEN 1 AND 80 THEN
      RAISE EXCEPTION 'modifier_option_name_invalid' USING ERRCODE = '22023';
    END IF;
    IF (v_option->>'price_delta_cents') !~ '^-?[0-9]+$' THEN
      RAISE EXCEPTION 'modifier_option_delta_invalid' USING ERRCODE = '22023';
    END IF;
    v_delta := (v_option->>'price_delta_cents')::bigint;
    IF v_delta NOT BETWEEN -100000000 AND 100000000 THEN
      RAISE EXCEPTION 'modifier_option_delta_invalid' USING ERRCODE = '22023';
    END IF;
    IF (v_option->>'sort_order') !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'modifier_option_sort_invalid' USING ERRCODE = '22023';
    END IF;
    v_sort := (v_option->>'sort_order')::integer;
    IF v_sort = ANY(v_sort_orders) THEN
      RAISE EXCEPTION 'modifier_option_sort_duplicate' USING ERRCODE = '22023';
    END IF;
    v_sort_orders := pg_catalog.array_append(v_sort_orders, v_sort);

    -- An existing UUID from another group/brand is never adoptable.
    IF EXISTS (
      SELECT 1
        FROM public.menu_modifiers existing_option
       WHERE existing_option.id = v_option_id
         AND (existing_option.group_id IS DISTINCT FROM p_group_id
              OR existing_option.brand_id IS DISTINCT FROM p_brand_id)
    ) THEN
      RAISE EXCEPTION 'modifier_option_scope_mismatch' USING ERRCODE = '42501';
    END IF;
  END LOOP;

  IF (SELECT pg_catalog.min(sort_value) FROM pg_catalog.unnest(v_sort_orders) sort_value) <> 0
     OR (SELECT pg_catalog.max(sort_value) FROM pg_catalog.unnest(v_sort_orders) sort_value)
        <> v_option_count - 1 THEN
    RAISE EXCEPTION 'modifier_option_sort_not_contiguous' USING ERRCODE = '22023';
  END IF;

  IF v_group_exists THEN
    UPDATE public.menu_modifier_groups
       SET name = pg_catalog.btrim(p_name),
           selection_mode = p_selection_mode,
           min_select = p_min_select,
           max_select = p_max_select,
           is_active = true,
           sort_order = p_sort_order
     WHERE id = p_group_id;
  ELSE
    INSERT INTO public.menu_modifier_groups (
      id, brand_id, menu_item_id, name, selection_mode,
      min_select, max_select, is_active, sort_order
    ) VALUES (
      p_group_id, p_brand_id, p_menu_item_id, pg_catalog.btrim(p_name),
      p_selection_mode, p_min_select, p_max_select, true, p_sort_order
    ) ON CONFLICT (id) DO NOTHING;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'modifier_group_identity_race_retry'
        USING ERRCODE = '40001';
    END IF;
  END IF;

  FOR v_option IN SELECT value FROM pg_catalog.jsonb_array_elements(p_options) LOOP
    INSERT INTO public.menu_modifiers (
      id, group_id, brand_id, name, price_delta_cents,
      currency, is_available, sort_order
    ) VALUES (
      (v_option->>'id')::uuid,
      p_group_id,
      p_brand_id,
      pg_catalog.btrim(v_option->>'name'),
      (v_option->>'price_delta_cents')::integer,
      v_item.currency,
      true,
      (v_option->>'sort_order')::integer
    )
    ON CONFLICT (id) DO UPDATE
      SET name = EXCLUDED.name,
          price_delta_cents = EXCLUDED.price_delta_cents,
          currency = EXCLUDED.currency,
          is_available = true,
          sort_order = EXCLUDED.sort_order
      WHERE public.menu_modifiers.group_id = EXCLUDED.group_id
        AND public.menu_modifiers.brand_id = EXCLUDED.brand_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'modifier_option_identity_race_retry'
        USING ERRCODE = '40001';
    END IF;
  END LOOP;

  UPDATE public.menu_modifiers omitted
     SET is_available = false
   WHERE omitted.group_id = p_group_id
     AND omitted.brand_id = p_brand_id
     AND NOT (omitted.id = ANY(v_option_ids))
     AND EXISTS (
       SELECT 1
         FROM public.venue_order_item_modifiers history
        WHERE history.menu_modifier_id = omitted.id
     );

  DELETE FROM public.menu_modifiers omitted
   WHERE omitted.group_id = p_group_id
     AND omitted.brand_id = p_brand_id
     AND NOT (omitted.id = ANY(v_option_ids))
     AND NOT EXISTS (
       SELECT 1
         FROM public.venue_order_item_modifiers history
        WHERE history.menu_modifier_id = omitted.id
     );

  SELECT pg_catalog.jsonb_build_object(
           'id', saved_group.id,
           'menu_item_id', saved_group.menu_item_id,
           'name', saved_group.name,
           'selection_mode', saved_group.selection_mode,
           'min_select', saved_group.min_select,
           'max_select', saved_group.max_select,
           'is_active', saved_group.is_active,
           'sort_order', saved_group.sort_order,
           'modifiers', COALESCE((
             SELECT pg_catalog.jsonb_agg(
                      pg_catalog.jsonb_build_object(
                        'id', saved_option.id,
                        'group_id', saved_option.group_id,
                        'name', saved_option.name,
                        'price_delta_cents', saved_option.price_delta_cents,
                        'currency', saved_option.currency,
                        'is_available', saved_option.is_available,
                        'sort_order', saved_option.sort_order
                      )
                      ORDER BY saved_option.sort_order,
                               saved_option.name,
                               saved_option.id
                    )
               FROM public.menu_modifiers saved_option
              WHERE saved_option.group_id = saved_group.id
                AND saved_option.is_available
           ), '[]'::jsonb)
         )
    INTO v_result
    FROM public.menu_modifier_groups saved_group
   WHERE saved_group.id = p_group_id
     AND saved_group.brand_id = p_brand_id
     AND saved_group.menu_item_id = p_menu_item_id;

  RETURN v_result;
END;
$function$;

ALTER FUNCTION public.biz_save_menu_modifier_group_v1(
  uuid, uuid, uuid, text, text, integer, integer, integer, jsonb
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.biz_save_menu_modifier_group_v1(
  uuid, uuid, uuid, text, text, integer, integer, integer, jsonb
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.biz_save_menu_modifier_group_v1(
  uuid, uuid, uuid, text, text, integer, integer, integer, jsonb
) TO authenticated;

COMMENT ON FUNCTION public.biz_save_menu_modifier_group_v1(
  uuid, uuid, uuid, text, text, integer, integer, integer, jsonb
) IS 'Issue #3563: manager-plus Business client atomic full-active-set save for one menu modifier group. Stable caller-owned UUIDs make ambiguous retries idempotent; omitted referenced options become unavailable tombstones and omitted unreferenced options are deleted. ARI convergence is tracked separately by #3577.';

COMMIT;

NOTIFY pgrst, 'reload schema';
