-- #4490 P5 follow-up (20281203204490): the by-the-hour price rule, stated in the
-- offer read.
--
-- A by-the-hour booking has always been priced per minute, pro rata to the hour
-- price (hour price x minutes / 60, half up; P5 deviation 2). The offer read
-- now says so in an explicit block the Host and guest builders code against:
--   hour.pricing = {rule 'per_minute_pro_rata', formula, billableStepMinutes
--   (the offer's length step: the smallest billable step), minBillableMinutes
--   (the shortest booking)}.
-- No price changes. The spec names no other minimum billable step.
--
-- Also (private hire follow-ups found by the P4 UI pass):
--   * issue_4490_flex_day_summary: an "Hours you set" / by-the-hour day whose
--     last start falls inside the booking notice reads 'too_soon', not 'taken'.
--   * issue_4490_venue_calendar: a booking's guests are the current party
--     (the latest guest change), not the number first booked.
--   (The guest offer read's hoursYouSet is an edge change in venue-offers.)
--
-- Static SQL. Local stack only until Seth says otherwise.
-- Reverse (local only): re-run issue_4490_hour_projection and
-- issue_4490_flex_day_summary from 20281203164490 and issue_4490_venue_calendar
-- from 20281203154490.

BEGIN;
SET LOCAL lock_timeout = '5s';

-- by-the-hour offer read: + pricing (from 20281203164490_issue_4490_p5_tables_floor_hour.sql)
CREATE OR REPLACE FUNCTION public.issue_4490_hour_projection(p_offering_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT CASE WHEN o.kind <> 'by_the_hour' THEN NULL ELSE jsonb_build_object(
    'allocation', o.space_allocation,
    'places', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'setting', s.setting,
        'capacity', public.issue_4490_space_capacity(s.id)) ORDER BY s.sort_order, s.name)
      FROM public.venue_offer_spaces os JOIN public.venue_spaces s ON s.id = os.space_id
      WHERE os.offering_id = o.id), '[]'::jsonb),
    'hours', (SELECT jsonb_build_object('ruleId', r.id, 'weekdays', to_jsonb(r.weekdays),
                'startTime', to_char(r.local_start_time, 'HH24:MI'), 'endTime', to_char(r.local_end_time, 'HH24:MI'),
                'pastMidnight', r.local_end_time <= r.local_start_time,
                'startDate', r.local_start_date, 'endDate', r.local_end_date)
              FROM public.stay_place_schedule_rules r
              WHERE r.offering_id = o.id AND r.active AND r.mode = 'flexible'
              ORDER BY r.created_at DESC LIMIT 1),
    'stepMinutes', COALESCE(o.booking_length_step_minutes, 60),
    'minMinutes', o.booking_length_min_minutes,
    'maxMinutes', o.booking_length_max_minutes,
    'pricePerHourMinor', (SELECT p.amount_minor FROM public.venue_offer_price_options opt
                          JOIN public.stay_price_versions p ON p.price_option_id = opt.id AND p.effective_to IS NULL
                          WHERE opt.offering_id = o.id AND opt.status = 'active'
                          ORDER BY opt.sort_order, opt.created_at LIMIT 1),
    'setupMinutes', o.buffer_before_minutes,
    'cleanupMinutes', o.buffer_after_minutes,
    'noShowReleaseMinutes', o.no_show_release_minutes,
    'staffCanStart', o.staff_can_start,
    -- #4490 P5 follow-up: the price rule, stated. A booking is priced per
    -- minute, pro rata to the hour price: hour price x minutes / 60, rounded
    -- half up to the minor unit. Lengths move in the offer's step (the
    -- smallest billable step) from the shortest booking up.
    'pricing', jsonb_build_object(
      'rule', 'per_minute_pro_rata',
      'formula', 'pricePerHourMinor * minutes / 60, rounded half up',
      'billableStepMinutes', COALESCE(o.booking_length_step_minutes, 60),
      'minBillableMinutes', GREATEST(COALESCE(o.booking_length_min_minutes, o.booking_length_step_minutes, 60),
                                     COALESCE(o.booking_length_step_minutes, 60)))
  ) END
  FROM public.stay_offerings o WHERE o.id = p_offering_id;
$function$;

-- flexible day: too soon inside the notice (from 20281203164490_issue_4490_p5_tables_floor_hour.sql)
CREATE OR REPLACE FUNCTION public.issue_4490_flex_day_summary(
  p_offering_id uuid,
  p_window_id uuid,
  p_guests integer,
  p_price_option_id uuid
)
RETURNS TABLE (status text, reason text, free_starts integer, price_minor bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_places integer;
BEGIN
  SELECT count(*) INTO v_places FROM public.issue_4490_flex_places(p_offering_id, p_guests, p_price_option_id);
  SELECT count(DISTINCT f.starts_at)::integer INTO free_starts
  FROM public.issue_4490_flex_starts(p_offering_id, p_window_id, p_guests, p_price_option_id) f;
  SELECT min(public.issue_4490_option_price_at(o.id, p_window_id)) INTO price_minor
  FROM public.venue_offer_price_options o
  WHERE o.offering_id = p_offering_id AND o.status = 'active'
    AND (p_price_option_id IS NULL OR o.id = p_price_option_id);
  IF v_places = 0 THEN
    status := 'closed'; reason := 'no_space_fits';
  ELSIF free_starts > 0 THEN
    status := 'available'; reason := NULL;
  -- #4490 P5 follow-up: the day's last start lies inside the booking notice
  -- ("book at least N before"): too soon, not taken.
  ELSIF now() + make_interval(mins => COALESCE((SELECT o.min_notice_minutes FROM public.stay_offerings o
                                               WHERE o.id = p_offering_id), 0))
        >= (SELECT w.ends_at FROM public.stay_place_windows w WHERE w.id = p_window_id)
           - make_interval(mins => GREATEST(COALESCE((SELECT o.booking_length_min_minutes FROM public.stay_offerings o
                                                      WHERE o.id = p_offering_id), 60), 15)) THEN
    status := 'too_soon'; reason := NULL;
  ELSE
    status := 'taken'; reason := NULL;
  END IF;
  RETURN NEXT;
END;
$function$;

-- calendar: the current party (from 20281203154490_issue_4490_p4_private_hire.sql)
CREATE OR REPLACE FUNCTION public.issue_4490_venue_calendar(p_venue_id uuid, p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_tz text;
  v_range tstzrange;
BEGIN
  IF auth.uid() IS NULL OR NOT public.issue_4490_can_view_venue(p_venue_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 62 THEN
    RAISE EXCEPTION 'calendar_range_invalid' USING ERRCODE = '22023';
  END IF;
  v_tz := public.issue_4490_venue_timezone(p_venue_id);
  v_range := tstzrange(p_from::timestamp AT TIME ZONE v_tz, (p_to + 1)::timestamp AT TIME ZONE v_tz, '[)');
  RETURN jsonb_build_object(
    'venueId', p_venue_id, 'from', p_from, 'to', p_to, 'timezone', v_tz,
    'spaces', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'setting', s.setting,
        'capacity', public.issue_4490_space_capacity(s.id), 'canBeHired', s.can_be_hired, 'sortOrder', s.sort_order)
        ORDER BY s.sort_order, s.name)
      FROM public.venue_spaces s WHERE s.venue_id = p_venue_id AND s.archived_at IS NULL), '[]'::jsonb),
    'combinations', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'spaceIds', to_jsonb(c.space_ids)) ORDER BY c.name)
      FROM public.venue_space_combinations c WHERE c.venue_id = p_venue_id AND c.archived_at IS NULL), '[]'::jsonb),
    'claims', COALESCE((
      SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'claimId', c.id, 'spaceId', c.space_id, 'source', c.source, 'state', c.state,
        'kind', CASE WHEN c.source = 'event' THEN 'event' WHEN c.source = 'block' THEN 'block'
                     WHEN c.state = 'held' THEN 'hold' ELSE 'hire' END,
        'viaCombinationId', c.via_combination_id,
        'viaCombinationName', (SELECT vc.name FROM public.venue_space_combinations vc WHERE vc.id = c.via_combination_id),
        'bookedFrom', lower(c.booked_range), 'bookedTo', upper(c.booked_range),
        'claimFrom', lower(c.claim_range), 'claimTo', upper(c.claim_range),
        'holdUntil', c.held_until,
        'groupId', c.group_id, 'reference', g.public_reference, 'groupState', g.state,
        'guestName', g.guest_snapshot->>'name',
        'offerName', l.offering_snapshot->>'name', 'sessionLabel', l.offering_snapshot->>'sessionLabel',
        -- #4490 P5 follow-up: the current party (a guest change wins over the booked one).
        'guests', COALESCE((SELECT a.to_guests FROM public.venue_booking_amendments a
                            WHERE a.group_id = g.id AND a.kind = 'change_guests' ORDER BY a.created_at DESC LIMIT 1),
                           (l.price_snapshot->>'guests')::integer, l.place_guests),
        'eventId', c.event_id, 'eventTitle', e.title, 'blockReason', c.block_reason))
        ORDER BY lower(c.claim_range), c.space_id)
      FROM public.venue_space_claims c
      JOIN public.venue_spaces s ON s.id = c.space_id AND s.venue_id = p_venue_id
      LEFT JOIN public.stay_reservation_groups g ON g.id = c.group_id
      LEFT JOIN public.stay_reservation_lines l ON l.id = c.reservation_line_id
      LEFT JOIN public.events e ON e.id = c.event_id
      WHERE c.claim_range && v_range
        AND (c.state = 'committed' OR (c.state = 'held' AND c.held_until > now()))), '[]'::jsonb),
    -- A combination is blocked while any part is in use ("Blocked by The Lounge Side").
    'combinationBlocks', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('combinationId', vc.id, 'claimId', c.id,
        'blockedBy', COALESCE((SELECT x.name FROM public.venue_space_combinations x WHERE x.id = c.via_combination_id), s.name),
        'from', lower(c.claim_range), 'to', upper(c.claim_range), 'state', c.state) ORDER BY vc.name, lower(c.claim_range))
      FROM public.venue_space_combinations vc
      JOIN public.venue_space_claims c ON c.space_id = ANY(vc.space_ids)
      JOIN public.venue_spaces s ON s.id = c.space_id
      WHERE vc.venue_id = p_venue_id AND vc.archived_at IS NULL
        AND c.claim_range && v_range AND c.via_combination_id IS DISTINCT FROM vc.id
        AND (c.state = 'committed' OR (c.state = 'held' AND c.held_until > now()))), '[]'::jsonb),
    'requests', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'groupId', g.id, 'reference', g.public_reference, 'guestName', g.guest_snapshot->>'name',
        'spaceIds', l.price_snapshot->'spaceIds', 'placeName', l.price_snapshot->>'placeName',
        'bookedFrom', q.inventory_snapshot->>'bookedFrom', 'bookedTo', q.inventory_snapshot->>'bookedTo',
        'replyBy', g.request_deadline,
        'collides', (SELECT s.status FROM public.issue_4490_spaces_status(
            ARRAY(SELECT jsonb_array_elements_text(l.price_snapshot->'spaceIds')::uuid),
            tstzrange((q.inventory_snapshot->>'claimFrom')::timestamptz, (q.inventory_snapshot->>'claimTo')::timestamptz, '[)'),
            g.id) s) <> 'free')
        ORDER BY q.inventory_snapshot->>'bookedFrom')
      FROM public.stay_reservation_groups g
      JOIN LATERAL (SELECT * FROM public.stay_reservation_lines l2 WHERE l2.group_id = g.id
                    ORDER BY l2.created_at, l2.id LIMIT 1) l ON true
      JOIN public.stay_quote_lines q ON q.id = l.quote_line_id
      WHERE g.venue_id = p_venue_id AND g.state = 'request_pending' AND g.offer_kind = 'private_hire'
        AND tstzrange((q.inventory_snapshot->>'bookedFrom')::timestamptz, (q.inventory_snapshot->>'bookedTo')::timestamptz, '[)')
            && v_range), '[]'::jsonb),
    'days', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'localDate', d.d,
        'closed', public.issue_4490_day_closed(p_venue_id, d.d),
        'specialHours', (SELECT jsonb_build_object('isClosed', sh.is_closed, 'label', sh.label, 'windows', sh.windows)
                         FROM public.venue_special_hours sh WHERE sh.venue_id = p_venue_id AND sh.local_date = d.d),
        'pools', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('poolId', p.id, 'name', p.name,
            'dailyLimit', COALESCE((SELECT ov.daily_limit FROM public.venue_capacity_overrides ov
                                    WHERE ov.pool_id = p.id AND ov.local_date = d.d), p.daily_limit),
            'limitEffective', u.limit_effective, 'hireCut', u.hire_cut, 'venueHired', u.venue_hired,
            'sold', u.used, 'closed', u.closed) ORDER BY p.created_at)
          FROM public.venue_capacity_pools p
          CROSS JOIN LATERAL public.issue_4490_pool_day_usage(p.id, d.d) u
          WHERE p.venue_id = p_venue_id AND p.archived_at IS NULL), '[]'::jsonb),
        'groups', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('groupId', g.id, 'reference', g.public_reference, 'state', g.state,
            'offerName', l.offering_snapshot->>'name', 'guestName', g.guest_snapshot->>'name',
            'guests', public.issue_4490_line_guests(l.id), 'startsAt', w.starts_at, 'endsAt', w.ends_at)
            ORDER BY w.starts_at)
          FROM public.stay_reservation_groups g
          JOIN LATERAL (SELECT * FROM public.stay_reservation_lines l2 WHERE l2.group_id = g.id
                        ORDER BY l2.created_at, l2.id LIMIT 1) l ON true
          JOIN public.stay_place_windows w ON w.id = public.issue_4490_line_window_id(l.id)
          WHERE g.venue_id = p_venue_id AND g.offer_kind = 'group_package' AND w.local_date = d.d
            AND g.state IN ('confirmed', 'partially_cancelled', 'instant_payment_pending')), '[]'::jsonb)
      ) ORDER BY d.d)
      FROM (SELECT generate_series(p_from, p_to, interval '1 day')::date AS d) d), '[]'::jsonb),
    'events', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('eventId', e.id, 'title', e.title, 'spaceId', e.space_id,
        'spaceUse', e.space_use, 'status', e.status, 'startsAt', ed.start_at, 'endsAt', ed.end_at) ORDER BY ed.start_at)
      FROM public.events e JOIN public.event_dates ed ON ed.event_id = e.id
      WHERE e.venue_id = p_venue_id AND e.deleted_at IS NULL AND e.status IN ('scheduled', 'live')
        AND tstzrange(ed.start_at, ed.end_at, '[)') && v_range), '[]'::jsonb)
  );
END;
$function$;

COMMIT;
