-- ORCH-1273 [Admin Offerings console — READ-ONLY] — offerings read-RPCs.
--
-- Five (+1 optional) guard-first, STABLE SECURITY DEFINER read-RPCs behind the
-- admin offerings console. Each is the READ analog of the ORCH-1271 §2d WRITE
-- template: guard FIRST → SELECT / aggregate → RETURN. They take NO p_reason,
-- write NO audit row (reads are not audited), and perform NO mutation.
--
--   admin_list_offerings          — cross-brand unified list (derived lifecycle
--                                   bucket + per-row child counts); {rows,total}
--   admin_get_offering            — one type-aware header bundle for a detail view
--   admin_list_event_orders       — buyer PII + money + line items; {rows,total,summary}
--   admin_list_event_rsvps        — guest PII + rollup counts;      {rows,total,counts}
--   admin_list_venue_reservations — reservation PII + payment + status counts; {rows,total,counts}
--   admin_offering_stats          — (optional) counts by type + lifecycle bucket
--
-- Why RPCs (not browser RLS): cross-brand aggregation + server-computed lifecycle
-- (admin_list_offerings / admin_get_offering / admin_offering_stats); and PII/
-- money that stays RLS-CLOSED to the anon key — orders/order_line_items/tickets,
-- event_rsvps/event_rsvp_guests, reservations get NO admin RLS (SPEC §5 "PII
-- posture"); only these definer RPCs SELECT a fixed shaped column set from them.
--
-- Server-computed lifecycle bucket (SPEC §4.1) mirrors the RN deriveLiveStatus
-- trichotomy (eventLifecycle.ts) — live window [start-4h, start+24h) — WITHOUT
-- importing the RN helper (separate Vite app, no shared path). The admin bucket
-- ADDS a 'draft' bucket the organiser trichotomy lacks (the console SEES drafts).
--
-- Least-privilege (ORCH-1271 P0 golden template — MANDATORY for every admin RPC):
-- functions default to PUBLIC EXECUTE. Each is a user-JWT admin read (the admin UI
-- calls it via the anon key + an authenticated admin JWT; the internal
-- is_admin_user() guard is the real gate). EXECUTE is locked to authenticated
-- ONLY; anon / PUBLIC get nothing. A DO-block self-assert proves the lockdown at
-- apply time. READ-ONLY: NOT in the write-RPC (admin_write_audit) registry; IS in
-- the i-admin-gate-first-statement registry.
--
-- Enforces: I-PROPOSED-1273-OFFERINGS-ADMIN-READ-CROSSBRAND,
--           I-PROPOSED-1273-OFFERINGS-READ-ONLY,
--           I-PROPOSED-1271-ADMIN-GATE-FIRST-STATEMENT.

--------------------------------------------------------------------------------
-- 1. admin_list_offerings — cross-brand unified offerings list.
--    {rows: [...], total: <int pre-pagination count>}
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_offerings(
  p_search          text        DEFAULT NULL,
  p_event_type      text        DEFAULT NULL,
  p_status          text        DEFAULT NULL,
  p_visibility      text        DEFAULT NULL,
  p_lifecycle       text        DEFAULT NULL,
  p_brand_id        uuid        DEFAULT NULL,
  p_date_from       timestamptz DEFAULT NULL,
  p_date_to         timestamptz DEFAULT NULL,
  p_include_deleted boolean     DEFAULT false,
  p_sort            text        DEFAULT 'start_at',
  p_sort_dir        text        DEFAULT 'desc',
  p_limit           int         DEFAULT 25,
  p_offset          int         DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_sort  text;
  v_dir   text;
  v_total bigint;
  v_rows  jsonb;
  v_limit int := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 200);
  v_offset int := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;

  -- Whitelist sort key + direction (reject anything else → default).
  v_sort := CASE lower(COALESCE(p_sort, 'start_at'))
              WHEN 'created_at' THEN 'created_at'
              WHEN 'title'      THEN 'title'
              WHEN 'status'     THEN 'status'
              ELSE 'start_at'
            END;
  v_dir  := CASE lower(COALESCE(p_sort_dir, 'desc')) WHEN 'asc' THEN 'asc' ELSE 'desc' END;

  WITH base AS (
    SELECT
      e.id, e.event_type, e.title, e.slug, e.status, e.visibility, e.brand_id,
      e.city, e.currency, e.published_at, e.deleted_at, e.created_at,
      m.start_at AS master_start_at,
      m.end_at   AS master_end_at,
      b.name     AS brand_name,
      CASE
        WHEN e.status = 'cancelled' THEN 'cancelled'
        WHEN e.status = 'draft'     THEN 'draft'
        WHEN e.status = 'ended'     THEN 'past'
        WHEN m.start_at IS NULL     THEN 'upcoming'
        WHEN now() >= m.start_at - interval '4 hours'
         AND now() <  m.start_at + interval '24 hours' THEN 'live'
        WHEN now() <  m.start_at - interval '4 hours' THEN 'upcoming'
        ELSE 'past'
      END AS lifecycle_bucket
    FROM public.events e
    LEFT JOIN public.event_dates m ON m.event_id = e.id AND m.is_master
    LEFT JOIN public.brands b ON b.id = e.brand_id
  ),
  filtered AS (
    SELECT * FROM base
    WHERE (p_include_deleted OR deleted_at IS NULL)
      AND (p_event_type IS NULL OR event_type = p_event_type)
      AND (p_status IS NULL OR status = p_status)
      AND (p_visibility IS NULL OR visibility = p_visibility)
      AND (p_lifecycle IS NULL OR lifecycle_bucket = p_lifecycle)
      AND (p_brand_id IS NULL OR brand_id = p_brand_id)
      AND (p_date_from IS NULL OR master_start_at >= p_date_from)
      AND (p_date_to IS NULL OR master_start_at <= p_date_to)
      AND (
        p_search IS NULL OR btrim(p_search) = '' OR
        title      ILIKE '%' || p_search || '%' OR
        brand_name ILIKE '%' || p_search || '%' OR
        city       ILIKE '%' || p_search || '%' OR
        slug       ILIKE '%' || p_search || '%'
      )
  ),
  ranked AS (
    SELECT f.*, row_number() OVER (
      ORDER BY
        (CASE WHEN v_sort = 'start_at'   AND v_dir = 'asc'  THEN master_start_at END) ASC  NULLS LAST,
        (CASE WHEN v_sort = 'start_at'   AND v_dir = 'desc' THEN master_start_at END) DESC NULLS LAST,
        (CASE WHEN v_sort = 'created_at' AND v_dir = 'asc'  THEN created_at END)      ASC  NULLS LAST,
        (CASE WHEN v_sort = 'created_at' AND v_dir = 'desc' THEN created_at END)      DESC NULLS LAST,
        (CASE WHEN v_sort = 'title'      AND v_dir = 'asc'  THEN title END)           ASC  NULLS LAST,
        (CASE WHEN v_sort = 'title'      AND v_dir = 'desc' THEN title END)           DESC NULLS LAST,
        (CASE WHEN v_sort = 'status'     AND v_dir = 'asc'  THEN status END)          ASC  NULLS LAST,
        (CASE WHEN v_sort = 'status'     AND v_dir = 'desc' THEN status END)          DESC NULLS LAST,
        created_at DESC, id
    ) AS rn
    FROM filtered f
  )
  SELECT
    (SELECT count(*) FROM filtered),
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'id',               r.id,
        'event_type',       r.event_type,
        'title',            r.title,
        'slug',             r.slug,
        'status',           r.status,
        'visibility',       r.visibility,
        'lifecycle_bucket', r.lifecycle_bucket,
        'brand_id',         r.brand_id,
        'brand_name',       r.brand_name,
        'city',             r.city,
        'currency',         r.currency,
        'master_start_at',  r.master_start_at,
        'master_end_at',    r.master_end_at,
        'published_at',     r.published_at,
        'deleted_at',       r.deleted_at,
        'created_at',       r.created_at,
        'attendee_count', (
          SELECT count(*) FROM public.tickets tk
          JOIN public.orders o ON o.id = tk.order_id
          WHERE tk.event_id = r.id AND o.payment_status = 'paid'
        ),
        'rsvp_going_count', (
          SELECT count(*) FROM public.event_rsvps rv
          WHERE rv.event_id = r.id AND rv.rsvp_status = 'going' AND rv.approval_status = 'approved'
        ),
        'child_summary', CASE r.event_type
          WHEN 'trip' THEN jsonb_build_object('trip_day_count',
            (SELECT count(*) FROM public.trip_days td WHERE td.event_id = r.id))
          WHEN 'experience' THEN jsonb_build_object('stop_count',
            (SELECT count(*) FROM public.experience_stops es WHERE es.event_id = r.id))
          WHEN 'rsvp' THEN jsonb_build_object('rsvp_total',
            (SELECT count(*) FROM public.event_rsvps rv WHERE rv.event_id = r.id))
          ELSE jsonb_build_object('ticket_type_count',
            (SELECT count(*) FROM public.ticket_types tt WHERE tt.event_id = r.id AND tt.deleted_at IS NULL))
        END
      )
      ORDER BY r.rn
    ), '[]'::jsonb)
  INTO v_total, v_rows
  FROM ranked r
  WHERE r.rn > v_offset AND r.rn <= v_offset + v_limit;

  RETURN jsonb_build_object('rows', v_rows, 'total', COALESCE(v_total, 0));
END;
$$;

--------------------------------------------------------------------------------
-- 2. admin_get_offering — one type-aware header bundle for a detail view.
--    Returns NULL when p_event_id not found (client uses maybeSingle semantics).
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_get_offering(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_out jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;

  SELECT jsonb_build_object(
    'id',               e.id,
    'event_type',       e.event_type,
    'title',            e.title,
    'slug',             e.slug,
    'description',      e.description,
    'status',           e.status,
    'visibility',       e.visibility,
    'lifecycle_bucket', CASE
        WHEN e.status = 'cancelled' THEN 'cancelled'
        WHEN e.status = 'draft'     THEN 'draft'
        WHEN e.status = 'ended'     THEN 'past'
        WHEN m.start_at IS NULL     THEN 'upcoming'
        WHEN now() >= m.start_at - interval '4 hours'
         AND now() <  m.start_at + interval '24 hours' THEN 'live'
        WHEN now() <  m.start_at - interval '4 hours' THEN 'upcoming'
        ELSE 'past'
      END,
    'brand_id',         e.brand_id,
    'brand_name',       b.name,
    'brand_slug',       b.slug,
    'brand_city',       b.city,
    'city',             e.city,
    'location_text',    e.location_text,
    'destination_text', e.destination_text,
    'currency',         e.currency,
    'master_start_at',  m.start_at,
    'master_end_at',    m.end_at,
    'pass_tax',         e.pass_tax,
    'pass_mingla_fee',  e.pass_mingla_fee,
    'pass_service_fee', e.pass_service_fee,
    'pricing_mode',     e.pricing_mode,
    'whole_price_cents',e.whole_price_cents,
    'refund_policy',    e.refund_policy,
    'bookings_closed',  e.bookings_closed,
    'booking_deadline', e.booking_deadline,
    'published_at',     e.published_at,
    'deleted_at',       e.deleted_at,
    'created_at',       e.created_at,
    'rsvp_capacity',        e.rsvp_capacity,
    'rsvp_approval_mode',   e.rsvp_approval_mode,
    'rsvp_waitlist_enabled',e.rsvp_waitlist_enabled,
    'rsvp_allow_plus_ones', e.rsvp_allow_plus_ones,
    'rsvp_plus_ones_max',   e.rsvp_plus_ones_max,
    'child_summary', CASE e.event_type
        WHEN 'trip' THEN jsonb_build_object('trip_day_count',
          (SELECT count(*) FROM public.trip_days td WHERE td.event_id = e.id))
        WHEN 'experience' THEN jsonb_build_object('stop_count',
          (SELECT count(*) FROM public.experience_stops es WHERE es.event_id = e.id))
        WHEN 'rsvp' THEN jsonb_build_object('rsvp_total',
          (SELECT count(*) FROM public.event_rsvps rv WHERE rv.event_id = e.id))
        ELSE jsonb_build_object('ticket_type_count',
          (SELECT count(*) FROM public.ticket_types tt WHERE tt.event_id = e.id AND tt.deleted_at IS NULL))
      END
  )
  INTO v_out
  FROM public.events e
  LEFT JOIN public.event_dates m ON m.event_id = e.id AND m.is_master
  LEFT JOIN public.brands b ON b.id = e.brand_id
  WHERE e.id = p_event_id;

  RETURN v_out;  -- NULL when not found
END;
$$;

--------------------------------------------------------------------------------
-- 3. admin_list_event_orders — buyer PII + money + line items.
--    {rows: [...], total: <int>, summary: {...}}  (summary over ALL orders)
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_event_orders(
  p_event_id uuid,
  p_limit    int DEFAULT 25,
  p_offset   int DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_total   bigint;
  v_rows    jsonb;
  v_summary jsonb;
  v_limit   int := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 200);
  v_offset  int := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;

  SELECT count(*) INTO v_total FROM public.orders o WHERE o.event_id = p_event_id;

  SELECT jsonb_build_object(
    'gross_cents',    COALESCE(sum(o.total_cents) FILTER (WHERE o.payment_status = 'paid'), 0),
    'refunded_cents', COALESCE(sum(COALESCE(o.refunded_amount_cents, 0)), 0),
    'paid_count',     count(*) FILTER (WHERE o.payment_status = 'paid'),
    'refunded_count', count(*) FILTER (WHERE COALESCE(o.refunded_amount_cents, 0) > 0),
    'ticket_count', (
      SELECT count(*) FROM public.tickets tk
      JOIN public.orders o2 ON o2.id = tk.order_id
      WHERE tk.event_id = p_event_id AND o2.payment_status = 'paid'
    )
  )
  INTO v_summary
  FROM public.orders o
  WHERE o.event_id = p_event_id;

  WITH ranked AS (
    SELECT o.*, row_number() OVER (ORDER BY o.created_at DESC, o.id) AS rn
    FROM public.orders o
    WHERE o.event_id = p_event_id
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'order_id',              r.id,
      'buyer_name',            r.buyer_name,
      'buyer_email',           r.buyer_email,
      'buyer_phone',           COALESCE(r.buyer_phone, r.buyer_phone_e164),
      'payment_status',        r.payment_status,
      'total_cents',           r.total_cents,
      'currency',              r.currency,
      'is_door_sale',          r.is_door_sale,
      'source',                r.source,
      'refunded_amount_cents', r.refunded_amount_cents,
      'created_at',            r.created_at,
      'line_items', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'ticket_type_name', tt.name,
          'quantity',         oli.quantity,
          'unit_price_cents', oli.unit_price_cents
        ) ORDER BY oli.id)
        FROM public.order_line_items oli
        LEFT JOIN public.ticket_types tt ON tt.id = oli.ticket_type_id
        WHERE oli.order_id = r.id
      ), '[]'::jsonb)
    ) ORDER BY r.rn
  ), '[]'::jsonb)
  INTO v_rows
  FROM ranked r
  WHERE r.rn > v_offset AND r.rn <= v_offset + v_limit;

  RETURN jsonb_build_object('rows', v_rows, 'total', COALESCE(v_total, 0), 'summary', v_summary);
END;
$$;

--------------------------------------------------------------------------------
-- 4. admin_list_event_rsvps — guest PII + rollup counts.
--    {rows: [...], total: <int>, counts: {...}}
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_event_rsvps(
  p_event_id uuid,
  p_limit    int DEFAULT 25,
  p_offset   int DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_total    bigint;
  v_rows     jsonb;
  v_counts   jsonb;
  v_capacity int;
  v_headcount bigint;
  v_limit    int := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 200);
  v_offset   int := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;

  SELECT count(*) INTO v_total FROM public.event_rsvps r WHERE r.event_id = p_event_id;
  SELECT rsvp_capacity INTO v_capacity FROM public.events WHERE id = p_event_id;

  SELECT COALESCE(sum(1 + COALESCE(r.plus_count, 0))
                  FILTER (WHERE r.rsvp_status = 'going' AND r.approval_status = 'approved'), 0)
  INTO v_headcount
  FROM public.event_rsvps r WHERE r.event_id = p_event_id;

  SELECT jsonb_build_object(
    'going',               count(*) FILTER (WHERE r.rsvp_status = 'going'),
    'not_going',           count(*) FILTER (WHERE r.rsvp_status = 'not_going'),
    'waitlisted',          count(*) FILTER (WHERE r.rsvp_status = 'waitlisted'),
    'maybe',               count(*) FILTER (WHERE r.rsvp_status = 'maybe'),
    'pending',             count(*) FILTER (WHERE r.approval_status = 'pending'),
    'approved',            count(*) FILTER (WHERE r.approval_status = 'approved'),
    'denied',              count(*) FILTER (WHERE r.approval_status = 'denied'),
    'confirmed_attending', count(*) FILTER (WHERE r.rsvp_status = 'going' AND r.approval_status = 'approved'),
    'total_headcount',     v_headcount,
    'capacity',            v_capacity,
    'capacity_remaining',  CASE WHEN v_capacity IS NULL THEN NULL ELSE v_capacity - v_headcount END
  )
  INTO v_counts
  FROM public.event_rsvps r WHERE r.event_id = p_event_id;

  WITH ranked AS (
    SELECT r.*, row_number() OVER (ORDER BY r.created_at DESC, r.id) AS rn
    FROM public.event_rsvps r
    WHERE r.event_id = p_event_id
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'rsvp_id',         r.id,
      'guest_name',      r.guest_name,
      'guest_email',     r.guest_email,
      'guest_phone',     r.guest_phone,
      'user_id',         r.user_id,
      'rsvp_status',     r.rsvp_status,
      'approval_status', r.approval_status,
      'plus_count',      r.plus_count,
      'waitlisted_at',   r.waitlisted_at,
      'promoted_at',     r.promoted_at,
      'created_at',      r.created_at,
      'plus_guests', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('name', g.name, 'email', g.email, 'phone', g.phone) ORDER BY g.created_at)
        FROM public.event_rsvp_guests g WHERE g.rsvp_id = r.id
      ), '[]'::jsonb)
    ) ORDER BY r.rn
  ), '[]'::jsonb)
  INTO v_rows
  FROM ranked r
  WHERE r.rn > v_offset AND r.rn <= v_offset + v_limit;

  RETURN jsonb_build_object('rows', v_rows, 'total', COALESCE(v_total, 0), 'counts', v_counts);
END;
$$;

--------------------------------------------------------------------------------
-- 5. admin_list_venue_reservations — reservation PII + payment + status counts.
--    {rows: [...], total: <int>, counts: {<status>: <n>}}
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_venue_reservations(
  p_venue_id uuid,
  p_status   text DEFAULT NULL,
  p_limit    int  DEFAULT 25,
  p_offset   int  DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_total  bigint;
  v_rows   jsonb;
  v_counts jsonb;
  v_limit  int := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 200);
  v_offset int := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;

  SELECT count(*) INTO v_total
  FROM public.reservations rs
  WHERE rs.venue_id = p_venue_id
    AND (p_status IS NULL OR rs.status = p_status);

  -- Status rollup is over ALL reservations for the venue (independent of the
  -- p_status page filter) so the header counts never shift with the filter.
  SELECT COALESCE(jsonb_object_agg(s.status, s.n), '{}'::jsonb)
  INTO v_counts
  FROM (
    SELECT rs.status, count(*) AS n
    FROM public.reservations rs
    WHERE rs.venue_id = p_venue_id
    GROUP BY rs.status
  ) s;

  WITH ranked AS (
    SELECT rs.*, row_number() OVER (ORDER BY rs.reserved_for DESC NULLS LAST, rs.created_at DESC, rs.id) AS rn
    FROM public.reservations rs
    WHERE rs.venue_id = p_venue_id
      AND (p_status IS NULL OR rs.status = p_status)
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'reservation_id',   r.id,
      'reserved_for',     r.reserved_for,
      'party_size',       r.party_size,
      'status',           r.status,
      'source',           r.source,
      'created_via',      r.created_via,
      'guest_name',       r.guest_name,
      'guest_phone_e164', r.guest_phone_e164,
      'guest_email',      r.guest_email,
      'occasion',         r.occasion,
      'payment_status',   r.payment_status,
      'fee_cents',        r.fee_cents,
      'fee_currency',     r.fee_currency,
      'table_name',       (SELECT vt.name FROM public.venue_tables vt WHERE vt.id = r.table_id),
      'created_at',       r.created_at
    ) ORDER BY r.rn
  ), '[]'::jsonb)
  INTO v_rows
  FROM ranked r
  WHERE r.rn > v_offset AND r.rn <= v_offset + v_limit;

  RETURN jsonb_build_object('rows', v_rows, 'total', COALESCE(v_total, 0), 'counts', v_counts);
END;
$$;

--------------------------------------------------------------------------------
-- 6. admin_offering_stats — counts by event_type + by lifecycle bucket (header
--    tiles). Mirrors admin_subscription_stats. Guard-first, live rows only.
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_offering_stats()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_out jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;

  WITH bucketed AS (
    SELECT
      e.event_type,
      CASE
        WHEN e.status = 'cancelled' THEN 'cancelled'
        WHEN e.status = 'draft'     THEN 'draft'
        WHEN e.status = 'ended'     THEN 'past'
        WHEN m.start_at IS NULL     THEN 'upcoming'
        WHEN now() >= m.start_at - interval '4 hours'
         AND now() <  m.start_at + interval '24 hours' THEN 'live'
        WHEN now() <  m.start_at - interval '4 hours' THEN 'upcoming'
        ELSE 'past'
      END AS lifecycle_bucket
    FROM public.events e
    LEFT JOIN public.event_dates m ON m.event_id = e.id AND m.is_master
    WHERE e.deleted_at IS NULL
  )
  SELECT jsonb_build_object(
    'total',        (SELECT count(*) FROM bucketed),
    'by_type',      COALESCE((SELECT jsonb_object_agg(event_type, n)
                              FROM (SELECT event_type, count(*) AS n FROM bucketed GROUP BY event_type) t), '{}'::jsonb),
    'by_lifecycle', COALESCE((SELECT jsonb_object_agg(lifecycle_bucket, n)
                              FROM (SELECT lifecycle_bucket, count(*) AS n FROM bucketed GROUP BY lifecycle_bucket) l), '{}'::jsonb)
  )
  INTO v_out;

  RETURN v_out;
END;
$$;

--------------------------------------------------------------------------------
-- Least-privilege lockdown (ORCH-1271 P0 golden template — MANDATORY). Each RPC
-- is a user-JWT admin read: anon / PUBLIC get nothing; authenticated (the admin
-- UI, gated by the internal is_admin_user() guard) gets EXECUTE.
--------------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.admin_list_offerings(text,text,text,text,text,uuid,timestamptz,timestamptz,boolean,text,text,int,int) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_list_offerings(text,text,text,text,text,uuid,timestamptz,timestamptz,boolean,text,text,int,int) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.admin_get_offering(uuid) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_get_offering(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.admin_list_event_orders(uuid,int,int) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_list_event_orders(uuid,int,int) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.admin_list_event_rsvps(uuid,int,int) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_list_event_rsvps(uuid,int,int) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.admin_list_venue_reservations(uuid,text,int,int) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_list_venue_reservations(uuid,text,int,int) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.admin_offering_stats() FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_offering_stats() TO authenticated;

--------------------------------------------------------------------------------
-- Self-assert: apply FAILS unless the privilege lockdown holds for EVERY RPC
-- (anon cannot execute; authenticated can). Runtime-proves the P0 containment at
-- apply time — a guarded-but-anon-EXECUTABLE read RPC is a REJECT.
--------------------------------------------------------------------------------
DO $$
DECLARE
  v_sig text;
  v_sigs text[] := ARRAY[
    'public.admin_list_offerings(text,text,text,text,text,uuid,timestamptz,timestamptz,boolean,text,text,int,int)',
    'public.admin_get_offering(uuid)',
    'public.admin_list_event_orders(uuid,int,int)',
    'public.admin_list_event_rsvps(uuid,int,int)',
    'public.admin_list_venue_reservations(uuid,text,int,int)',
    'public.admin_offering_stats()'
  ];
BEGIN
  FOREACH v_sig IN ARRAY v_sigs LOOP
    IF has_function_privilege('anon', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'ORCH-1273: % still EXECUTE-able by anon', v_sig;
    END IF;
    IF NOT has_function_privilege('authenticated', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'ORCH-1273: authenticated lost EXECUTE on % (admin UI would break)', v_sig;
    END IF;
  END LOOP;
END $$;
