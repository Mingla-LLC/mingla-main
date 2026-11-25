-- #4490 fix round 3 — an event at a venue can take its space (N101), sit in a
-- combination of spaces (N106), and the Calendar says when part of a
-- combination is in use (N102).
--
-- What was already true (P1 + P4): events.space_use 'exclusive' on a single
-- space made committed claims for every date of a scheduled or live event, so
-- the guest hire picker read the space as taken, a hire or by-the-hour quote
-- over it was refused (offer_space_taken) and publishing over a committed
-- hire or block was refused (event_space_taken). The Host app never saved
-- 'exclusive', so none of it ever ran.
--
-- What this migration adds:
--   * events.combination_id (a combination of the event's venue; one place
--     only: a space OR a combination OR the whole venue).
--   * An exclusive event claims every part of its combination (via the
--     combination) or, at the whole venue, every active space of the venue.
--   * Claims merge overlapping dates of one event (a duplicated or
--     overlapping date used to clash with itself) and skip cancelled dates.
--   * issue_4490_set_event_venue takes p_combination_id (DEFAULT NULL; old
--     callers unchanged).
--   * issue_4490_venue_calendar events carry combinationId and spaceIds.
--   * issue_4490_member_projection's guest view carries memberEmail (the
--     member reading their own membership), so member checkout prefills.
--   * venue_waitlist.preferred_space_id: a walk-in can ask for one of the
--     venue's own spaces (N112); the generic seating words stay for venues
--     without spaces. The space must belong to the waitlist row's venue.
--
-- Conflicts raise PT409 (never 40001). Static SQL. Local stack only.
-- Reverse (local only): restore issue_4490_assert_event_venue and
-- issue_4490_set_event_venue from 20281203024490, issue_4490_member_projection
-- from 20281203224490, the event claim functions
-- and triggers from 20281203154490, issue_4490_venue_calendar from
-- 20281203204490; drop issue_4490_event_space_ids(uuid); ALTER TABLE
-- public.events DROP CONSTRAINT events_one_place, DROP CONSTRAINT
-- events_combination_needs_venue, DROP COLUMN combination_id; DROP TRIGGER
-- issue_4490_waitlist_space ON public.venue_waitlist; DROP FUNCTION
-- public.issue_4490_assert_waitlist_space(); ALTER TABLE public.venue_waitlist
-- DROP COLUMN preferred_space_id.

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.events
  ADD COLUMN combination_id uuid NULL REFERENCES public.venue_space_combinations(id) ON DELETE SET NULL,
  ADD CONSTRAINT events_combination_needs_venue CHECK (combination_id IS NULL OR venue_id IS NOT NULL),
  ADD CONSTRAINT events_one_place CHECK (space_id IS NULL OR combination_id IS NULL);
COMMENT ON COLUMN public.events.combination_id IS
  '#4490 fix 3: the combination of venue_id the event uses (instead of one space). Cleared with the venue link.';

-- The venue link stays inside the brand; a space or combination stays inside
-- the venue; clearing the venue clears both.
CREATE OR REPLACE FUNCTION public.issue_4490_assert_event_venue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.venue_id IS NULL THEN
    NEW.space_id := NULL;
    NEW.combination_id := NULL;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.venue_id IS NOT DISTINCT FROM OLD.venue_id
     AND NEW.space_id IS NOT DISTINCT FROM OLD.space_id
     AND NEW.combination_id IS NOT DISTINCT FROM OLD.combination_id
     AND NEW.brand_id IS NOT DISTINCT FROM OLD.brand_id THEN
    RETURN NEW;
  END IF;
  IF NEW.brand_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.venue_listings venue
    WHERE venue.id = NEW.venue_id AND venue.brand_id = NEW.brand_id
  ) THEN
    RAISE EXCEPTION 'event_venue_brand_mismatch' USING ERRCODE = '23514';
  END IF;
  IF NEW.space_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.venue_spaces space
    WHERE space.id = NEW.space_id AND space.venue_id = NEW.venue_id
  ) THEN
    RAISE EXCEPTION 'event_space_not_in_venue' USING ERRCODE = '23514';
  END IF;
  IF NEW.combination_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.venue_space_combinations combination
    WHERE combination.id = NEW.combination_id AND combination.venue_id = NEW.venue_id
  ) THEN
    RAISE EXCEPTION 'event_space_not_in_venue' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER issue_4490_events_venue_link ON public.events;
CREATE TRIGGER issue_4490_events_venue_link
  BEFORE INSERT OR UPDATE OF venue_id, space_id, combination_id, brand_id ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_assert_event_venue();

DROP FUNCTION public.issue_4490_set_event_venue(uuid, uuid, uuid, text, timestamptz);
CREATE FUNCTION public.issue_4490_set_event_venue(
  p_event_id uuid,
  p_venue_id uuid,
  p_space_id uuid,
  p_space_use text DEFAULT 'shared',
  p_expected_updated_at timestamptz DEFAULT NULL,
  p_combination_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_event record;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  SELECT e.id, e.brand_id, e.updated_at, e.deleted_at INTO v_event
  FROM public.events e WHERE e.id = p_event_id
  FOR UPDATE;
  IF NOT FOUND OR v_event.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'event_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_event.brand_id IS NULL
     OR public.biz_brand_effective_rank_for_caller(v_event.brand_id) < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_expected_updated_at IS NOT NULL AND p_expected_updated_at IS DISTINCT FROM v_event.updated_at THEN
    RAISE EXCEPTION 'stale_write' USING ERRCODE = 'PT409';
  END IF;
  IF COALESCE(p_space_use, '') NOT IN ('shared', 'exclusive') THEN
    RAISE EXCEPTION 'event_space_use_invalid' USING ERRCODE = '22023';
  END IF;
  IF (p_space_id IS NOT NULL OR p_combination_id IS NOT NULL) AND p_venue_id IS NULL THEN
    RAISE EXCEPTION 'event_space_needs_venue' USING ERRCODE = '22023';
  END IF;
  IF p_space_id IS NOT NULL AND p_combination_id IS NOT NULL THEN
    RAISE EXCEPTION 'event_one_place' USING ERRCODE = '22023';
  END IF;
  IF p_venue_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.venue_listings venue
    WHERE venue.id = p_venue_id AND venue.brand_id = v_event.brand_id
  ) THEN
    RAISE EXCEPTION 'event_venue_brand_mismatch' USING ERRCODE = '22023';
  END IF;
  IF p_space_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.venue_spaces space
    WHERE space.id = p_space_id AND space.venue_id = p_venue_id
      AND space.is_active AND space.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'event_space_not_in_venue' USING ERRCODE = '22023';
  END IF;
  IF p_combination_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.venue_space_combinations combination
    WHERE combination.id = p_combination_id AND combination.venue_id = p_venue_id
      AND combination.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'event_space_not_in_venue' USING ERRCODE = '22023';
  END IF;

  -- A clash with a committed hire or block on an exclusive, scheduled event
  -- rolls this back with PT409 event_space_taken (claims trigger).
  UPDATE public.events
     SET venue_id = p_venue_id,
         space_id = p_space_id,
         combination_id = p_combination_id,
         space_use = CASE WHEN p_venue_id IS NULL THEN 'shared' ELSE p_space_use END
   WHERE id = p_event_id
  RETURNING jsonb_build_object(
    'event_id', id,
    'venue_id', venue_id,
    'space_id', space_id,
    'combination_id', combination_id,
    'space_use', space_use,
    'updated_at', updated_at
  ) INTO v_result;
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4490_set_event_venue(uuid, uuid, uuid, text, timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4490_set_event_venue(uuid, uuid, uuid, text, timestamptz, uuid) TO authenticated;

-- The atomic spaces an event sits in: its space, the parts of its
-- combination, or every active space of its venue (whole venue).
CREATE OR REPLACE FUNCTION public.issue_4490_event_space_ids(p_event_id uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT CASE
    WHEN e.venue_id IS NULL THEN '{}'::uuid[]
    WHEN e.space_id IS NOT NULL THEN ARRAY[e.space_id]
    WHEN e.combination_id IS NOT NULL THEN COALESCE((
      SELECT array_agg(p ORDER BY p) FROM public.venue_space_combinations c, unnest(c.space_ids) p
      WHERE c.id = e.combination_id), '{}'::uuid[])
    ELSE COALESCE((
      SELECT array_agg(s.id ORDER BY s.id) FROM public.venue_spaces s
      WHERE s.venue_id = e.venue_id AND s.is_active AND s.archived_at IS NULL), '{}'::uuid[])
  END
  FROM public.events e WHERE e.id = p_event_id;
$function$;
REVOKE ALL ON FUNCTION public.issue_4490_event_space_ids(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4490_event_space_ids(uuid) TO service_role;

-- An exclusive, scheduled or live event claims every space it sits in for
-- each of its (merged, active, not yet over) dates.
CREATE OR REPLACE FUNCTION public.issue_4490_sync_event_space_claims(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_event record;
  v_spaces uuid[];
BEGIN
  SELECT e.id, e.venue_id, e.space_id, e.combination_id, e.space_use, e.status, e.deleted_at INTO v_event
  FROM public.events e WHERE e.id = p_event_id;
  UPDATE public.venue_space_claims
  SET state = 'released', held_until = NULL, released_at = now(), release_reason = 'event_changed', updated_at = now()
  WHERE event_id = p_event_id AND state IN ('held', 'committed');
  IF NOT FOUND AND v_event.id IS NULL THEN
    RETURN;
  END IF;
  IF v_event.id IS NULL OR v_event.venue_id IS NULL OR v_event.space_use <> 'exclusive'
     OR v_event.status NOT IN ('scheduled', 'live') OR v_event.deleted_at IS NOT NULL THEN
    RETURN;
  END IF;
  v_spaces := public.issue_4490_event_space_ids(v_event.id);
  IF cardinality(v_spaces) = 0 THEN
    RETURN;
  END IF;
  PERFORM public.issue_4490_release_lapsed_claims(v_spaces);
  BEGIN
    INSERT INTO public.venue_space_claims (
      space_id, source, event_id, event_date_id, via_combination_id, booked_range, claim_range, state
    )
    SELECT sp.id, 'event', v_event.id,
           (SELECT d.id FROM public.event_dates d
            WHERE d.event_id = v_event.id AND d.status = 'active'
              AND tstzrange(d.start_at, d.end_at, '[)') <@ r.rng
            ORDER BY d.start_at, d.id LIMIT 1),
           v_event.combination_id, r.rng, r.rng, 'committed'
    FROM unnest(v_spaces) AS sp(id)
    CROSS JOIN (
      SELECT unnest(range_agg(tstzrange(d.start_at, d.end_at, '[)'))) AS rng
      FROM public.event_dates d
      WHERE d.event_id = v_event.id AND d.status = 'active' AND d.end_at > now()
    ) r
    ORDER BY lower(r.rng), sp.id;
  EXCEPTION WHEN exclusion_violation THEN
    RAISE EXCEPTION 'event_space_taken' USING ERRCODE = 'PT409';
  END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_on_event_space_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF TG_TABLE_NAME = 'events' THEN
    IF TG_OP = 'INSERT' OR NEW.venue_id IS DISTINCT FROM OLD.venue_id
       OR NEW.space_id IS DISTINCT FROM OLD.space_id
       OR NEW.combination_id IS DISTINCT FROM OLD.combination_id
       OR NEW.space_use IS DISTINCT FROM OLD.space_use OR NEW.status IS DISTINCT FROM OLD.status
       OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
      IF NEW.venue_id IS NOT NULL OR (TG_OP = 'UPDATE' AND OLD.venue_id IS NOT NULL) THEN
        PERFORM public.issue_4490_sync_event_space_claims(NEW.id);
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  -- event_dates
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.events e WHERE e.id = OLD.event_id AND e.venue_id IS NOT NULL) THEN
      PERFORM public.issue_4490_sync_event_space_claims(OLD.event_id);
    END IF;
    RETURN OLD;
  END IF;
  IF EXISTS (SELECT 1 FROM public.events e WHERE e.id = NEW.event_id AND e.venue_id IS NOT NULL) THEN
    PERFORM public.issue_4490_sync_event_space_claims(NEW.event_id);
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER issue_4490_event_space_claims ON public.events;
CREATE TRIGGER issue_4490_event_space_claims
  AFTER INSERT OR UPDATE OF venue_id, space_id, combination_id, space_use, status, deleted_at ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_on_event_space_change();
DROP TRIGGER issue_4490_event_date_space_claims ON public.event_dates;
CREATE TRIGGER issue_4490_event_date_space_claims
  AFTER INSERT OR UPDATE OF start_at, end_at, status OR DELETE ON public.event_dates
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_on_event_space_change();

-- Calendar: events carry combinationId and spaceIds (from 20281203204490).
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
      -- #4490 fix 3 (N102, N106): the combination an event uses and the
      -- atomic spaces it sits in (a whole-venue event: every space), so a
      -- combination row can say "part in use"; cancelled dates are left out.
      SELECT jsonb_agg(jsonb_build_object('eventId', e.id, 'title', e.title, 'spaceId', e.space_id,
        'combinationId', e.combination_id, 'spaceIds', to_jsonb(public.issue_4490_event_space_ids(e.id)),
        'spaceUse', e.space_use, 'status', e.status, 'startsAt', ed.start_at, 'endsAt', ed.end_at,
        -- #4490 W3 fix 1: the event's type, so the Host opens the right screen.
        'eventType', e.event_type) ORDER BY ed.start_at)
      FROM public.events e JOIN public.event_dates ed ON ed.event_id = e.id AND ed.status = 'active'
      WHERE e.venue_id = p_venue_id AND e.deleted_at IS NULL AND e.status IN ('scheduled', 'live')
        AND tstzrange(ed.start_at, ed.end_at, '[)') && v_range), '[]'::jsonb)
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- Waitlist: "Preferred seating" can be one of the venue's own spaces.
-- ---------------------------------------------------------------------------
ALTER TABLE public.venue_waitlist
  ADD COLUMN preferred_space_id uuid NULL REFERENCES public.venue_spaces(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.venue_waitlist.preferred_space_id IS
  '#4490 fix 3: the space of this venue the walk-in would like (preferred_zone stays for venues without spaces).';

CREATE OR REPLACE FUNCTION public.issue_4490_assert_waitlist_space()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.preferred_space_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.preferred_space_id IS NOT DISTINCT FROM OLD.preferred_space_id
     AND NEW.venue_id IS NOT DISTINCT FROM OLD.venue_id THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.venue_spaces s
    WHERE s.id = NEW.preferred_space_id AND s.venue_id = NEW.venue_id AND s.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'waitlist_space_not_in_venue' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4490_assert_waitlist_space() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER issue_4490_waitlist_space
  BEFORE INSERT OR UPDATE OF preferred_space_id, venue_id ON public.venue_waitlist
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_assert_waitlist_space();

-- ---------------------------------------------------------------------------
-- Member projection (from 20281203224490): the guest view carries the
-- member's own email (N87: a booking made as the member starts filled in).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_member_projection(p_subscription_id uuid, p_view text, p_qr_pepper text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sub public.venue_membership_subscriptions%ROWTYPE;
  v_plan public.venue_membership_plans%ROWTYPE;
  v_venue record;
  v_tz text;
  v_open public.venue_membership_periods%ROWTYPE;
  v_today date;
  v_result jsonb;
  v_can_enter boolean;
BEGIN
  SELECT * INTO v_sub FROM public.venue_membership_subscriptions WHERE id = p_subscription_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_plan FROM public.venue_membership_plans WHERE id = v_sub.plan_id;
  SELECT v.id, v.name, v.slug, b.slug AS brand_slug, b.name AS brand_name INTO v_venue
  FROM public.stay_offerings o JOIN public.venue_listings v ON v.id = o.venue_id
  JOIN public.brands b ON b.id = v.brand_id WHERE o.id = v_plan.offering_id;
  v_tz := public.issue_4490_venue_timezone(v_venue.id);
  v_today := (now() AT TIME ZONE v_tz)::date;
  SELECT * INTO v_open FROM public.venue_membership_periods
  WHERE id = public.issue_4490_member_open_period(v_sub.id);
  v_can_enter := v_sub.status IN ('active', 'payment_due', 'grace') AND v_sub.start_on <= v_today;
  v_result := jsonb_build_object(
    'subscriptionId', v_sub.id,
    'status', v_sub.status,
    'memberName', v_sub.member_name,
    'plan', jsonb_build_object(
      'id', v_plan.id, 'name', v_plan.name, 'priceMinor', v_plan.price_minor, 'currencyCode', v_plan.currency_code,
      'interval', v_plan.period, 'inclusions', v_plan.inclusions, 'entryIncluded', v_plan.entry_included,
      'roomHours', v_plan.room_hours_per_period, 'guestPasses', v_plan.guest_passes_per_period,
      'discountBps', v_plan.discount_bps, 'discountKinds', to_jsonb(v_plan.discount_kinds),
      'hourOfferingIds', to_jsonb(v_plan.hour_offering_ids), 'entryOfferingId', v_plan.entry_offering_id),
    'terms', v_sub.terms,
    'venue', jsonb_build_object('id', v_venue.id, 'name', v_venue.name, 'slug', v_venue.slug,
      'brandSlug', v_venue.brand_slug, 'brandName', v_venue.brand_name, 'timezone', v_tz),
    'startOn', v_sub.start_on,
    'startedAt', v_sub.started_at,
    'activeUntil', v_sub.current_period_end,
    'currentPeriod', CASE WHEN v_sub.current_period_start IS NULL THEN NULL ELSE jsonb_build_object(
      'start', v_sub.current_period_start, 'end', v_sub.current_period_end) END,
    'renewsOn', CASE WHEN v_sub.status IN ('active', 'payment_due', 'grace', 'lapsed')
                      AND NOT v_sub.pause_at_period_end
                      AND (v_sub.cancel_at IS NULL OR v_sub.cancel_at > v_sub.current_period_end)
                     THEN v_sub.current_period_end END,
    'renewalEmailOn', CASE WHEN v_sub.status IN ('active') AND NOT v_sub.pause_at_period_end
                            AND (v_sub.cancel_at IS NULL OR v_sub.cancel_at > v_sub.current_period_end)
                           THEN v_sub.current_period_end - make_interval(days => v_plan.renewal_notice_days) END,
    'canCheckIn', v_can_enter,
    'paymentDue', CASE WHEN v_open.id IS NULL THEN NULL ELSE jsonb_build_object(
      'periodId', v_open.id, 'amountMinor', v_open.amount_minor, 'currencyCode', v_open.currency_code,
      'periodStart', v_open.period_start, 'periodEnd', v_open.period_end, 'dueAt', v_open.due_at,
      'status', v_open.status, 'graceEndsAt', v_open.due_at + make_interval(days => COALESCE((v_sub.terms->>'graceDays')::integer, 7)),
      'paying', EXISTS (SELECT 1 FROM public.stay_payment_attempts a WHERE a.group_id = v_open.group_id
                        AND a.state IN ('pending', 'ambiguous'))) END,
    'leaving', CASE WHEN v_sub.cancel_at IS NOT NULL AND v_sub.status <> 'cancelled'
                    THEN jsonb_build_object('endsAt', v_sub.cancel_at, 'by', v_sub.cancel_requested_by) END,
    'pausing', CASE WHEN v_sub.pause_at_period_end THEN jsonb_build_object('from', v_sub.current_period_end,
                    'by', v_sub.pause_requested_by) END,
    'paused', CASE WHEN v_sub.status = 'paused' THEN jsonb_build_object('since', v_sub.paused_since, 'by', v_sub.pause_reason) END,
    'endedAt', v_sub.cancelled_at,
    'endReason', v_sub.end_reason,
    'credits', jsonb_build_object(
      'roomHoursLeft', public.issue_4490_member_credit_left(v_sub.id, 'room_hours', now()),
      'roomHoursPerMonth', v_plan.room_hours_per_period,
      'guestPassesLeft', public.issue_4490_member_credit_left(v_sub.id, 'guest_passes', now()),
      'guestPassesPerMonth', v_plan.guest_passes_per_period),
    'inToday', EXISTS (SELECT 1 FROM public.venue_member_visits x WHERE x.subscription_id = v_sub.id
                       AND x.local_date = v_today AND x.undone_at IS NULL),
    'canLeave', v_sub.status IN ('pending', 'active', 'payment_due', 'grace', 'lapsed', 'paused') AND v_sub.cancel_at IS NULL,
    'canStay', v_sub.cancel_at IS NOT NULL AND v_sub.status <> 'cancelled' AND v_sub.cancel_requested_by = 'member',
    'canPause', v_sub.status IN ('active') AND NOT v_sub.pause_at_period_end AND v_sub.cancel_at IS NULL,
    'canResume', v_sub.status = 'paused' OR v_sub.pause_at_period_end,
    -- #4490 fix round 1 (B5): the months paid, newest first (the member, and
    -- staff who may see members; never a stranger: every caller checks first).
    'payments', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'periodId', pp.id, 'start', pp.period_start, 'end', pp.period_end,
        'amountMinor', pp.amount_minor, 'currencyCode', pp.currency_code,
        'paidMinor', CASE WHEN pp.paid_via = 'online' THEN (SELECT NULLIF(sum(a.amount_minor), 0) FROM public.stay_payment_attempts a
                                                             WHERE a.group_id = pp.group_id AND a.state = 'succeeded') END,
        'paidAt', pp.paid_at, 'paidVia', pp.paid_via)
        ORDER BY pp.period_start DESC)
      FROM public.venue_membership_periods pp
      WHERE pp.subscription_id = v_sub.id AND pp.status = 'paid'), '[]'::jsonb),
    'memberPath', '/visit/plan/' || v_sub.id,
    'version', v_sub.version,
    'createdAt', v_sub.created_at);
  IF p_view = 'guest' AND p_qr_pepper IS NOT NULL AND v_sub.status <> 'cancelled' THEN
    v_result := v_result || jsonb_build_object('pass', jsonb_build_object(
      'qrPayload', public.issue_4490_member_qr_payload(v_sub.id, v_sub.qr_token_hash, p_qr_pepper),
      'valid', v_can_enter));
  END IF;
  -- #4490 fix 3 (N87): the member's own email, so a booking made as this
  -- member starts with their name and email filled in (the guest view is
  -- read only with the member's own token).
  IF p_view = 'guest' THEN
    v_result := v_result || jsonb_build_object('memberEmail', v_sub.member_email);
  END IF;
  IF p_view = 'host' THEN
    v_result := v_result || jsonb_build_object(
      'email', v_sub.member_email,
      'phone', v_sub.member_phone,
      'signedIn', v_sub.user_id IS NOT NULL,
      'periods', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'periodId', p.id, 'sequence', p.sequence, 'start', p.period_start, 'end', p.period_end,
          'amountMinor', p.amount_minor, 'currencyCode', p.currency_code, 'dueAt', p.due_at, 'status', p.status,
          'paidAt', p.paid_at, 'paidVia', p.paid_via, 'paidMethod', p.paid_method, 'remindersSent', to_jsonb(p.reminder_steps))
          ORDER BY p.period_start DESC)
        FROM public.venue_membership_periods p WHERE p.subscription_id = v_sub.id), '[]'::jsonb),
      'timeline', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'type', e.event_type, 'by', e.actor_type, 'at', e.created_at, 'periodId', e.period_id, 'detail', e.detail)
          ORDER BY e.created_at, e.id)
        FROM public.venue_membership_events e WHERE e.subscription_id = v_sub.id), '[]'::jsonb),
      'visits', COALESCE((SELECT jsonb_agg(jsonb_build_object('localDate', x.local_date, 'guests', x.guests,
          'at', x.created_at, 'undone', x.undone_at IS NOT NULL) ORDER BY x.created_at DESC)
        FROM (SELECT * FROM public.venue_member_visits WHERE subscription_id = v_sub.id ORDER BY created_at DESC LIMIT 20) x),
        '[]'::jsonb),
      'credits', (v_result->'credits') || jsonb_build_object(
        'ledger', COALESCE((SELECT jsonb_agg(jsonb_build_object('credit', l.credit, 'entry', l.entry, 'amount', l.amount,
            'at', l.created_at, 'groupId', l.group_id) ORDER BY l.created_at DESC)
          FROM (SELECT * FROM public.venue_credit_ledger WHERE subscription_id = v_sub.id ORDER BY created_at DESC LIMIT 40) l),
          '[]'::jsonb)),
      'canManage', public.issue_4490_user_can_manage_members(v_venue.id, auth.uid()),
      'canManageMoney', public.issue_4490_can_manage_money(v_venue.id, auth.uid()));
  END IF;
  RETURN v_result;
END;
$function$;

-- Existing exclusive events that now claim more (a combination or the whole
-- venue). None are expected: the Host app only ever saved 'shared'.
DO $backfill$
DECLARE
  v_id uuid;
BEGIN
  FOR v_id IN
    SELECT e.id FROM public.events e
    WHERE e.venue_id IS NOT NULL AND e.space_id IS NULL AND e.space_use = 'exclusive'
      AND e.status IN ('scheduled', 'live') AND e.deleted_at IS NULL
    ORDER BY e.id
  LOOP
    BEGIN
      PERFORM public.issue_4490_sync_event_space_claims(v_id);
    EXCEPTION WHEN SQLSTATE 'PT409' THEN
      RAISE NOTICE 'issue_4490: exclusive event % overlaps another; left without claims', v_id;
    END;
  END LOOP;
END;
$backfill$;

COMMIT;
