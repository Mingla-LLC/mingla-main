-- #4490 P2-7 — Admin: list venue offers (entry and later kinds) across venues
-- for the Offerings console's "Venue offer" filter, so a Mingla admin can find
-- an offer and pause or resume it (issue_4490_admin_set_offer_status, already
-- audited with a required reason). Read-only; admin only; no writes.
BEGIN;

CREATE OR REPLACE FUNCTION public.admin_list_venue_offers(
  p_search text DEFAULT NULL,
  p_status text DEFAULT NULL,
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
  v_search text := NULLIF(btrim(COALESCE(p_search, '')), '');
  v_rows jsonb;
  v_total bigint;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_limit NOT BETWEEN 1 AND 100 OR p_offset < 0
     OR (p_status IS NOT NULL AND p_status NOT IN ('draft', 'live', 'paused', 'archived'))
     OR char_length(COALESCE(v_search, '')) > 120 THEN
    RAISE EXCEPTION 'invalid_payload' USING ERRCODE = '22023';
  END IF;

  WITH offers AS (
    SELECT o.id, o.name, o.kind, o.entry_style, o.status, o.version, o.updated_at, o.created_at,
           v.id AS venue_id, v.name AS venue_name, v.city, b.name AS brand_name,
           upper(COALESCE(NULLIF(btrim(b.default_currency), ''), 'NGN')) AS currency,
           (SELECT min(p.amount_minor) FROM public.venue_offer_price_options opt
            JOIN public.stay_price_versions p ON p.price_option_id = opt.id AND p.effective_to IS NULL
            WHERE opt.offering_id = o.id AND opt.status = 'active') AS from_minor
    FROM public.stay_offerings o
    JOIN public.venue_listings v ON v.id = o.venue_id
    JOIN public.brands b ON b.id = v.brand_id
    WHERE o.kind NOT IN ('room', 'place')
      AND (p_status IS NULL OR o.status = p_status)
      AND (v_search IS NULL
           OR o.name ILIKE '%' || v_search || '%'
           OR v.name ILIKE '%' || v_search || '%'
           OR b.name ILIKE '%' || v_search || '%')
  )
  SELECT
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
          'id', x.id, 'name', x.name, 'kind', x.kind, 'entryStyle', x.entry_style,
          'status', x.status, 'version', x.version, 'venueId', x.venue_id,
          'venueName', x.venue_name, 'city', x.city, 'brandName', x.brand_name,
          'currency', x.currency, 'fromMinor', x.from_minor, 'updatedAt', x.updated_at)
        ORDER BY x.updated_at DESC, x.id)
      FROM (SELECT * FROM offers ORDER BY updated_at DESC, id LIMIT p_limit OFFSET p_offset) x
    ), '[]'::jsonb),
    (SELECT count(*) FROM offers)
  INTO v_rows, v_total;

  RETURN jsonb_build_object('rows', v_rows, 'total', v_total);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_list_venue_offers(text, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_venue_offers(text, text, integer, integer) TO authenticated;

COMMIT;

-- Reverse (local use only): DROP FUNCTION public.admin_list_venue_offers(text, text, integer, integer);
