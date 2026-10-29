-- Issue #4037: make brand page rows self-describing so analytics can label
-- bookings, RSVPs and venue reservations without guessing from entity_type.

CREATE OR REPLACE FUNCTION public.brand_traffic_rollup(p_brand_id uuid, p_range text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_authorized boolean;
  v_envelope jsonb;
  v_pages jsonb;
BEGIN
  IF p_brand_id IS NULL THEN
    RAISE EXCEPTION 'issue_4037_brand_required' USING ERRCODE = '22023';
  END IF;

  v_authorized := EXISTS (
    SELECT 1
    FROM public.brands b
    WHERE b.id = p_brand_id
      AND b.deleted_at IS NULL
  ) AND (
    public.is_admin_user()
    OR public.biz_is_brand_member_for_read_for_caller(p_brand_id)
  );

  v_envelope := public.offering_traffic_rollup_envelope(
    p_brand_id, NULL, NULL, p_range, v_authorized
  );

  SELECT COALESCE(
    jsonb_agg(
      page_row.value || jsonb_build_object(
        'listing_type',
        CASE page_row.value ->> 'entity_type'
          WHEN 'event' THEN COALESCE((
            SELECT CASE WHEN e.event_type = 'rsvp' THEN 'rsvp' ELSE 'event' END
            FROM public.events e
            WHERE e.id = (page_row.value ->> 'entity_id')::uuid
              AND e.brand_id = p_brand_id
          ), 'event')
          ELSE page_row.value ->> 'entity_type'
        END
      )
      ORDER BY page_row.ordinality
    ),
    '[]'::jsonb
  )
  INTO v_pages
  FROM jsonb_array_elements(v_envelope -> 'pages') WITH ORDINALITY
    AS page_row(value, ordinality);

  RETURN jsonb_build_object('brand_id', p_brand_id)
    || jsonb_set(v_envelope, '{pages}', v_pages, true);
END
$function$;

REVOKE ALL ON FUNCTION public.brand_traffic_rollup(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_traffic_rollup(uuid, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.brand_traffic_rollup(uuid, text) IS
  'Issue #4037: brand-wide host traffic for 7d/30d/90d/all in the brand timezone. Page rows include additive listing_type so event and RSVP outcomes can be labelled truthfully. Visitors (web page view, app open or app impression) are deduped once per brand-day with first-touch source credit (decision 6); mingla_visitors follows the same rule. Bookings, customers and value come only from completed orders, reservations and RSVPs (decision 5). Admin or brand member; otherwise an honest authorized:false empty result.';
