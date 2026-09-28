-- Issue #3564 — atomically replace one menu's complete item order.
-- The category-order writer is intentionally unchanged.

BEGIN;

CREATE OR REPLACE FUNCTION public.biz_reorder_menu_items_v1(
  p_brand_id uuid,
  p_venue_id uuid,
  p_menu_id uuid,
  p_expected_items jsonb,
  p_ordered_item_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_menu public.menus%ROWTYPE;
  v_expected jsonb;
  v_expected_id uuid;
  v_expected_sort_bigint bigint;
  v_expected_ids uuid[] := ARRAY[]::uuid[];
  v_expected_sorts integer[] := ARRAY[]::integer[];
  v_expected_keys text[];
  v_current_ids uuid[] := ARRAY[]::uuid[];
  v_current_order uuid[] := ARRAY[]::uuid[];
  v_current_contiguous boolean := true;
  v_row_count integer := 0;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;
  IF p_brand_id IS NULL
     OR public.biz_brand_effective_rank(p_brand_id, v_uid)
        < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'menu_item_reorder_forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_venue_id IS NULL OR p_menu_id IS NULL THEN
    RAISE EXCEPTION 'menu_item_reorder_scope_required' USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.jsonb_typeof(p_expected_items) IS DISTINCT FROM 'array'
     OR p_ordered_item_ids IS NULL THEN
    RAISE EXCEPTION 'menu_item_reorder_complete_arrays_required'
      USING ERRCODE = '22023';
  END IF;
  -- Lock the exact parent before any child rows. Scope mismatches are permission
  -- failures so a caller cannot probe another brand or venue by UUID.
  SELECT candidate.*
    INTO v_menu
    FROM public.menus candidate
   WHERE candidate.id = p_menu_id
     AND candidate.brand_id = p_brand_id
     AND candidate.venue_id = p_venue_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'menu_item_reorder_scope_forbidden'
      USING ERRCODE = '42501';
  END IF;

  -- Every current child is locked in deterministic UUID order before the
  -- complete-set and expected-position snapshots are examined.
  PERFORM current_item.id
    FROM public.menu_items current_item
   WHERE current_item.menu_id = p_menu_id
   ORDER BY current_item.id
   FOR UPDATE;

  -- menu_items has independent brand and menu foreign keys, so a malformed
  -- legacy/direct writer can create a child whose brand disagrees with its
  -- parent. Never expose or rewrite that row through this definer function.
  IF EXISTS (
    SELECT 1
      FROM public.menu_items current_item
     WHERE current_item.menu_id = p_menu_id
       AND current_item.brand_id IS DISTINCT FROM p_brand_id
  ) THEN
    RAISE EXCEPTION 'menu_item_reorder_child_scope_forbidden'
      USING ERRCODE = '42501';
  END IF;

  IF pg_catalog.array_position(p_ordered_item_ids, NULL::uuid) IS NOT NULL
     OR pg_catalog.cardinality(p_ordered_item_ids) IS DISTINCT FROM (
       SELECT pg_catalog.count(DISTINCT desired_id)::integer
         FROM pg_catalog.unnest(p_ordered_item_ids) AS desired_id
     ) THEN
    RAISE EXCEPTION 'menu_item_reorder_desired_ids_invalid'
      USING ERRCODE = '22023';
  END IF;

  FOR v_expected IN
    SELECT value FROM pg_catalog.jsonb_array_elements(p_expected_items)
  LOOP
    IF pg_catalog.jsonb_typeof(v_expected) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'menu_item_reorder_expected_object_required'
        USING ERRCODE = '22023';
    END IF;
    SELECT pg_catalog.array_agg(key ORDER BY key)
      INTO v_expected_keys
      FROM pg_catalog.jsonb_object_keys(v_expected) AS key;
    IF v_expected_keys IS DISTINCT FROM ARRAY['id', 'sort_order']::text[]
       OR pg_catalog.jsonb_typeof(v_expected->'id') IS DISTINCT FROM 'string'
       OR pg_catalog.jsonb_typeof(v_expected->'sort_order') IS DISTINCT FROM 'number'
       OR (v_expected->>'sort_order') !~ '^-?[0-9]+$' THEN
      RAISE EXCEPTION 'menu_item_reorder_expected_shape_invalid'
        USING ERRCODE = '22023';
    END IF;
    BEGIN
      v_expected_id := (v_expected->>'id')::uuid;
      v_expected_sort_bigint := (v_expected->>'sort_order')::bigint;
    EXCEPTION
      WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RAISE EXCEPTION 'menu_item_reorder_expected_value_invalid'
          USING ERRCODE = '22023';
    END;
    IF v_expected_sort_bigint NOT BETWEEN -2147483648 AND 2147483647
       OR v_expected_id = ANY(v_expected_ids) THEN
      RAISE EXCEPTION 'menu_item_reorder_expected_value_invalid'
        USING ERRCODE = '22023';
    END IF;
    v_expected_ids := pg_catalog.array_append(v_expected_ids, v_expected_id);
    v_expected_sorts := pg_catalog.array_append(
      v_expected_sorts,
      v_expected_sort_bigint::integer
    );
  END LOOP;

  SELECT COALESCE(pg_catalog.array_agg(item.id ORDER BY item.id), ARRAY[]::uuid[])
    INTO v_current_ids
    FROM public.menu_items item
   WHERE item.menu_id = p_menu_id
     AND item.brand_id = p_brand_id;

  SELECT COALESCE(
           pg_catalog.array_agg(ordered.id ORDER BY ordered.sort_order, ordered.name, ordered.id),
           ARRAY[]::uuid[]
         ),
         COALESCE(pg_catalog.bool_and(ordered.sort_order = ordered.position - 1), true)
    INTO v_current_order, v_current_contiguous
    FROM (
      SELECT item.id,
             item.name,
             item.sort_order,
             pg_catalog.row_number() OVER (
               ORDER BY item.sort_order, item.name, item.id
             )::integer AS position
        FROM public.menu_items item
       WHERE item.menu_id = p_menu_id
         AND item.brand_id = p_brand_id
    ) ordered;

  -- A client payload whose expected and desired sets disagree is malformed.
  IF pg_catalog.cardinality(v_expected_ids) IS DISTINCT FROM pg_catalog.cardinality(p_ordered_item_ids)
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.unnest(v_expected_ids) AS expected_id
        WHERE NOT (expected_id = ANY(p_ordered_item_ids))
     ) THEN
    RAISE EXCEPTION 'menu_item_reorder_complete_set_required'
      USING ERRCODE = '22023';
  END IF;

  -- Once the two client arrays are internally complete, a difference from
  -- locked membership is a stale/membership race, not malformed input.
  IF pg_catalog.cardinality(p_ordered_item_ids) IS DISTINCT FROM pg_catalog.cardinality(v_current_ids)
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.unnest(v_current_ids) AS current_id
        WHERE NOT (current_id = ANY(p_ordered_item_ids))
     ) THEN
    RAISE EXCEPTION 'menu_item_reorder_conflict' USING ERRCODE = '40001';
  END IF;

  -- A successfully-applied request may have lost its response. Once the exact
  -- desired order is already present and contiguous, replay succeeds even when
  -- the caller's old expected positions no longer match.
  IF v_current_contiguous AND v_current_order = p_ordered_item_ids THEN
    SELECT pg_catalog.jsonb_build_object(
             'brand_id', p_brand_id,
             'venue_id', p_venue_id,
             'menu_id', p_menu_id,
             'items', COALESCE(pg_catalog.jsonb_agg(
               pg_catalog.jsonb_build_object(
                 'id', item.id,
                 'sort_order', item.sort_order
               ) ORDER BY item.sort_order, item.name, item.id
             ), '[]'::jsonb)
           )
      INTO v_result
      FROM public.menu_items item
     WHERE item.menu_id = p_menu_id
       AND item.brand_id = p_brand_id;
    RETURN v_result;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM ROWS FROM (
             pg_catalog.unnest(v_expected_ids),
             pg_catalog.unnest(v_expected_sorts)
           ) AS expected(id, sort_order)
      JOIN public.menu_items current_item ON current_item.id = expected.id
     WHERE current_item.menu_id = p_menu_id
       AND current_item.brand_id = p_brand_id
       AND current_item.sort_order IS DISTINCT FROM expected.sort_order
  ) THEN
    RAISE EXCEPTION 'menu_item_reorder_conflict' USING ERRCODE = '40001';
  END IF;

  WITH desired AS (
    SELECT requested.id, requested.ordinality::integer - 1 AS sort_order
      FROM pg_catalog.unnest(p_ordered_item_ids) WITH ORDINALITY
           AS requested(id, ordinality)
  )
  UPDATE public.menu_items item
     SET sort_order = desired.sort_order
    FROM desired
   WHERE item.id = desired.id
     AND item.menu_id = p_menu_id
     AND item.brand_id = p_brand_id;
  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  IF v_row_count IS DISTINCT FROM pg_catalog.cardinality(v_current_ids) THEN
    RAISE EXCEPTION 'menu_item_reorder_conflict' USING ERRCODE = '40001';
  END IF;

  SELECT pg_catalog.jsonb_build_object(
           'brand_id', p_brand_id,
           'venue_id', p_venue_id,
           'menu_id', p_menu_id,
           'items', COALESCE(pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'id', item.id,
               'sort_order', item.sort_order
             ) ORDER BY item.sort_order, item.name, item.id
           ), '[]'::jsonb)
         )
    INTO v_result
    FROM public.menu_items item
   WHERE item.menu_id = p_menu_id
     AND item.brand_id = p_brand_id;

  RETURN v_result;
END;
$function$;

ALTER FUNCTION public.biz_reorder_menu_items_v1(
  uuid, uuid, uuid, jsonb, uuid[]
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.biz_reorder_menu_items_v1(
  uuid, uuid, uuid, jsonb, uuid[]
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.biz_reorder_menu_items_v1(
  uuid, uuid, uuid, jsonb, uuid[]
) TO authenticated;

COMMENT ON FUNCTION public.biz_reorder_menu_items_v1(
  uuid, uuid, uuid, jsonb, uuid[]
) IS 'Issue #3564: authenticated manager-plus atomic complete-order replacement for one venue-owned menu. Parent/children lock deterministically; exact-set and expected-position checks reject stale writers; an already-applied contiguous desired order is idempotent.';

COMMIT;

NOTIFY pgrst, 'reload schema';
