-- Issue #3645 — admin can see and release a held cancel-refund batch.
--
-- Seth (2026-10-01 on #3645): before applying the #3719 cancel-review migration
-- in production, add at least an admin release button or alert. Otherwise every
-- paid cancellation leaves buyers unrefunded with no screen saying a batch waits.
--
-- This migration extends admin_get_offering with the run status (so the admin
-- offering detail can show the hold) without changing the release RPC itself
-- (admin_release_event_cancel_refund_batch already shipped in #3719).

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
      END,
    -- #3645: cancel-review hold visibility for the admin offering detail.
    'cancel_refund_run_status', (
      SELECT r.status FROM public.event_cancel_refund_runs r
      WHERE r.event_id = e.id
      LIMIT 1
    ),
    'cancel_refund_object_count', (
      SELECT count(*)::int FROM public.event_cancel_refund_progress p
      WHERE p.event_id = e.id
    )
  )
  INTO v_out
  FROM public.events e
  LEFT JOIN public.event_dates m ON m.event_id = e.id AND m.is_master
  LEFT JOIN public.brands b ON b.id = e.brand_id
  WHERE e.id = p_event_id;

  RETURN v_out;  -- NULL when not found
END;
$$;

COMMENT ON FUNCTION public.admin_get_offering(uuid) IS
  'ORCH-1273 + #3645: admin offering header bundle; includes cancel_refund_run_status / object_count so held refund batches are visible before admin_release_event_cancel_refund_batch.';
