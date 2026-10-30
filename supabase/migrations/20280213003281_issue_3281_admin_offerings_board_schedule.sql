-- issue #3281 PR7 — enrich the live admin Offerings board reader.
-- OfferingsConsolePage calls admin_list_offerings_board (#4130), not
-- admin_list_offerings. Page-only schedule helper; filter/rank stay light.
-- Timestamp after 20280113004130 so this replaces the board definition.

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_list_offerings_board(
  p_view        text    DEFAULT 'on_sale',
  p_search      text    DEFAULT NULL,
  p_event_type  text    DEFAULT NULL,
  p_brand_id    uuid    DEFAULT NULL,
  p_show_hidden boolean DEFAULT false,
  p_sort_dir    text    DEFAULT NULL,
  p_limit       integer DEFAULT 25,
  p_offset      integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit  integer := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 1000);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_search text := NULLIF(btrim(COALESCE(p_search, '')), '');
  v_view   text := lower(COALESCE(p_view, 'on_sale'));
  v_asc    boolean;
  v_total  bigint;
  v_rows   jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF v_view NOT IN ('on_sale', 'drafts', 'past', 'cancelled', 'all') THEN
    RAISE EXCEPTION 'invalid_view';
  END IF;
  v_asc := CASE lower(COALESCE(p_sort_dir, ''))
             WHEN 'asc' THEN true
             WHEN 'desc' THEN false
             ELSE v_view = 'on_sale'
           END;

  WITH base AS (
    SELECT e.id, e.title, e.slug, e.event_type, e.status, e.visibility, e.brand_id,
           e.city, e.currency, e.published_at, e.created_at, e.bookings_closed, e.deleted_at,
           b.name AS brand_name,
           d.start_at AS master_start_at,
           nxt.start_at AS next_start_at_sort,
           (e.deleted_at IS NOT NULL OR b.deleted_at IS NOT NULL
             OR public.admin_brand_is_internal(b.id)) AS hidden,
           CASE
             WHEN e.status = 'cancelled' THEN 'cancelled'
             WHEN e.status = 'draft' THEN 'draft'
             WHEN e.status = 'ended'
               OR NOT public.admin_offering_is_current(
                 e.status, COALESCE(nxt.start_at, d.start_at)
               ) THEN 'ended'
             WHEN COALESCE(nxt.start_at, d.start_at) IS NOT NULL
               AND now() >= COALESCE(nxt.start_at, d.start_at) - interval '4 hours'
               THEN 'happening_now'
             WHEN e.visibility IN ('private', 'hidden') THEN e.visibility
             WHEN COALESCE(e.bookings_closed, false) THEN 'sales_closed'
             ELSE 'on_sale'
           END AS state
      FROM public.events e
      LEFT JOIN public.brands b ON b.id = e.brand_id
      LEFT JOIN public.event_dates d ON d.event_id = e.id AND d.is_master
      LEFT JOIN LATERAL (
        SELECT n.start_at
          FROM public.event_dates n
         WHERE n.event_id = e.id AND n.end_at > now()
         ORDER BY n.start_at, n.id
         LIMIT 1
      ) nxt ON true
  ),
  filtered AS (
    SELECT * FROM base
     WHERE (COALESCE(p_show_hidden, false) OR NOT hidden)
       AND (p_event_type IS NULL OR event_type = p_event_type)
       AND (p_brand_id IS NULL OR brand_id = p_brand_id)
       AND (
         v_view = 'all'
         OR (v_view = 'on_sale' AND state IN ('on_sale', 'happening_now', 'sales_closed', 'private', 'hidden'))
         OR (v_view = 'drafts' AND state = 'draft')
         OR (v_view = 'past' AND state = 'ended')
         OR (v_view = 'cancelled' AND state = 'cancelled')
       )
       AND (v_search IS NULL
            OR title ILIKE '%' || v_search || '%'
            OR brand_name ILIKE '%' || v_search || '%'
            OR city ILIKE '%' || v_search || '%'
            OR slug ILIKE '%' || v_search || '%')
  ),
  ranked AS (
    SELECT f.*, row_number() OVER (
      ORDER BY
        (CASE WHEN v_view IN ('on_sale', 'past') AND v_asc
          THEN COALESCE(f.next_start_at_sort, f.master_start_at) END) ASC NULLS LAST,
        (CASE WHEN v_view IN ('on_sale', 'past') AND NOT v_asc
          THEN COALESCE(f.next_start_at_sort, f.master_start_at) END) DESC NULLS LAST,
        (CASE WHEN v_asc THEN f.created_at END) ASC,
        (CASE WHEN NOT v_asc THEN f.created_at END) DESC,
        f.id
    ) AS rn
    FROM filtered f
  ),
  page AS (
    SELECT
      r.*,
      public.issue_3281_event_schedule(r.id) AS schedule
    FROM ranked r
    WHERE r.rn > v_offset AND r.rn <= v_offset + v_limit
  )
  SELECT
    (SELECT count(*) FROM filtered),
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', p.id, 'title', p.title, 'slug', p.slug, 'event_type', p.event_type,
      'status', p.status, 'visibility', p.visibility, 'state', p.state,
      'brand_id', p.brand_id, 'brand_name', p.brand_name, 'city', p.city,
      'currency', p.currency,
      'start_at', COALESCE(p.next_start_at_sort, p.master_start_at),
      'next_start_at', (p.schedule->>'nextStartAt')::timestamptz,
      'schedule_line', p.schedule->>'scheduleLine',
      'published_at', p.published_at,
      'created_at', p.created_at, 'hidden', p.hidden,
      'sold', (SELECT count(*) FROM public.tickets t JOIN public.orders o ON o.id = t.order_id
                WHERE t.event_id = p.id AND o.payment_status = 'paid' AND t.status <> 'void'),
      'going', (SELECT count(*) FROM public.event_rsvps rv
                 WHERE rv.event_id = p.id AND rv.rsvp_status = 'going' AND rv.approval_status = 'approved')
    ) ORDER BY p.rn), '[]'::jsonb)
  INTO v_total, v_rows
  FROM page p;

  RETURN jsonb_build_object('rows', v_rows, 'total', COALESCE(v_total, 0));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_offerings_board(text, text, text, uuid, boolean, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_offerings_board(text, text, text, uuid, boolean, text, integer, integer) TO authenticated, service_role;

COMMIT;
