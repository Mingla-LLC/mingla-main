-- issue #3281 — Extras, slice 4 part 3: the door sees each order's extras.
--
-- A guest who bought "Friday dinner × 2" with their pass is checked against a
-- count at the door (#3283 §2.5: an extra is a count on the order, never a
-- seat). The scan result and the door search both name the order, so the
-- door reads its extras with one batch call, the way #3827's private-link
-- labels ride the door search without widening its frozen result contract.
--
-- Returned per order, for live orders only (paid or partly refunded): each
-- extra's name, the count still owed (bought less refunded or pending
-- refund), and the event dates it is for (null when it is for every date of
-- the event). A fully refunded extra is left out.

BEGIN;

CREATE FUNCTION public.issue_3281_door_order_extras(
  p_actor_id uuid,
  p_event_id uuid,
  p_order_ids uuid[]
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_brand uuid;
  v_extras jsonb;
BEGIN
  IF COALESCE(cardinality(p_order_ids), 0) > 20 THEN
    RAISE EXCEPTION 'too_many_orders';
  END IF;

  -- The same door authority as the door search and its link labels.
  SELECT e.brand_id INTO v_brand
    FROM public.events e
   WHERE e.id = p_event_id
     AND e.deleted_at IS NULL;
  IF NOT FOUND OR NOT (
    public.issue_3827_can_door_scan(p_event_id, p_actor_id)
    OR public.biz_brand_effective_rank(v_brand, p_actor_id) >= public.biz_role_rank('event_manager')
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT COALESCE(jsonb_object_agg(x.order_id::text, x.items), '{}'::jsonb)
    INTO v_extras
    FROM (
      SELECT li.order_id,
             jsonb_agg(jsonb_build_object(
               'name', li.add_on_name_at_order,
               'quantity', owed.quantity,
               -- null when it is for every date of the event (a single-date
               -- event included), so the door never says "some days only"
               -- about an extra good on every day.
               'eventDateIds', CASE
                 WHEN li.day_scope_at_order IS NULL THEN NULL
                 WHEN NOT EXISTS (
                   SELECT 1 FROM public.event_dates d
                    WHERE d.event_id = p_event_id
                      AND (d.occurrence_key IS NULL
                        OR NOT d.occurrence_key = ANY (li.day_scope_at_order))
                 ) THEN NULL
                 ELSE to_jsonb(ARRAY(
                   SELECT d.id FROM public.event_dates d
                    WHERE d.event_id = p_event_id
                      AND d.occurrence_key = ANY (li.day_scope_at_order)
                    ORDER BY d.start_at, d.id))
               END
             ) ORDER BY li.add_on_name_at_order, li.id) AS items
        FROM public.order_add_on_line_items li
        JOIN public.orders o ON o.id = li.order_id
        CROSS JOIN LATERAL (
          SELECT li.quantity - COALESCE((
            SELECT SUM(rli.quantity)
              FROM public.refund_add_on_line_items rli
              JOIN public.refunds r ON r.id = rli.refund_id
             WHERE rli.order_add_on_line_item_id = li.id
               AND r.status IN ('pending', 'succeeded')
          ), 0)::integer AS quantity
        ) owed
       WHERE o.event_id = p_event_id
         AND o.payment_status IN ('paid', 'partial_refund')
         AND li.order_id = ANY (COALESCE(p_order_ids, '{}'::uuid[]))
         AND owed.quantity > 0
       GROUP BY li.order_id
    ) x;

  RETURN v_extras;
END;
$$;

REVOKE ALL ON FUNCTION public.issue_3281_door_order_extras(uuid, uuid, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.issue_3281_door_order_extras(uuid, uuid, uuid[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3281_door_order_extras(uuid, uuid, uuid[]) TO service_role;

COMMENT ON FUNCTION public.issue_3281_door_order_extras(uuid, uuid, uuid[]) IS
  'issue #3281: the extras each order still owes, for the door scan result and door search, without widening their result contracts.';

COMMIT;
