-- #4490 gap list 07-E: Today shows "Paid in today" and "For today's bookings" (N47).
-- Number note: spec 07 reserved 294490 for E; round 1 takes the next free
-- number in the reserved range (conductor ruling), so E is 284490.
--
-- issue_4490_collected_on is replaced by issue_4490_venue_money_day (service
-- role only, called by issue_4490_venue_day). The client sum of booking
-- values ("Taken today") is deleted on the Host in the same change.
--
-- Paid in today (paidInMinor) = (a) online payments that succeeded that
-- service day, for this venue's groups (entry, packages, hire, by the hour,
-- stays, membership periods paid online) + (b) money recorded at the venue that
-- day + (c) membership periods paid at the venue that day + (d) table deposits
-- paid that day (still counted there once refunded, N123) - (e) refunds
-- raised that day (stays + table deposits).
-- A pay-at-venue booking counts only through (b). A table deposit counts on the
-- day it was paid, never again when it is used at the Till (spec 07 §11 B2).
--
-- For today's bookings (forTodayPaidMinor) = for entry, package, hire and by
-- the hour bookings dated that day: all their (a)+(b) minus their refunds; plus
-- table reservations for that day: paid deposit minus its refunds. No state
-- filter: a cancelled booking nets to what was kept. Event tickets, memberships,
-- stays rooms and menu orders have their own money views.

CREATE OR REPLACE FUNCTION public.issue_4490_venue_money_day(p_venue_id uuid, p_local_date date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_online bigint;
  v_at_venue bigint;
  v_members bigint;
  v_tables bigint;
  v_refunded bigint;
  v_f_online bigint;
  v_f_at_venue bigint;
  v_f_tables bigint;
  v_f_refunded bigint;
  v_cur text;
  v_other boolean;
BEGIN
  -- N128: money is summed in the venue's currency only (its brand's
  -- default_currency); rows in any other currency are never added in, and
  -- otherCurrency says the day had some.
  SELECT upper(b.default_currency) INTO v_cur
  FROM public.venue_listings v JOIN public.brands b ON b.id = v.brand_id WHERE v.id = p_venue_id;
  -- (a) online, by the service day the payment succeeded
  SELECT COALESCE(sum(a.amount_minor), 0)::bigint INTO v_online
  FROM public.stay_payment_attempts a
  JOIN public.stay_reservation_groups g ON g.id = a.group_id
  WHERE g.venue_id = p_venue_id AND a.state = 'succeeded' AND upper(a.currency_code) = v_cur
    AND public.issue_4490_venue_service_date(p_venue_id, a.succeeded_at) = p_local_date;
  -- (b) at the venue (cash, transfer, card at the venue, pay-by-code).
  -- N127: one day rule for every source, the venue's service day. paid_on is
  -- written as the calendar day by default, so cash taken at 01:00 after a
  -- 02:00 close would land on the next day; when paid_on is that default (the
  -- calendar day the row was recorded), the service day of the recording time
  -- is used. A paid_on staff chose for another day is kept as chosen.
  SELECT COALESCE(sum(o.amount_minor), 0)::bigint INTO v_at_venue
  FROM public.venue_offline_payments o
  JOIN public.stay_reservation_groups g ON g.id = o.group_id
  WHERE g.venue_id = p_venue_id AND upper(o.currency_code) = v_cur
    AND CASE
          WHEN o.paid_on = (o.created_at AT TIME ZONE public.issue_4490_venue_timezone(p_venue_id))::date
            THEN public.issue_4490_venue_service_date(p_venue_id, o.created_at)
          ELSE o.paid_on
        END = p_local_date;
  -- (c) membership periods paid at the venue (these write no offline payment row)
  SELECT COALESCE(sum(m.amount_minor), 0)::bigint INTO v_members
  FROM public.venue_membership_periods m
  WHERE m.paid_via = 'venue' AND m.paid_at IS NOT NULL AND upper(m.currency_code) = v_cur
    AND public.issue_4490_member_venue(m.subscription_id) = p_venue_id
    AND public.issue_4490_venue_service_date(p_venue_id, m.paid_at) = p_local_date;
  -- (d) table deposits paid that day. A deposit refunded later flips to
  -- 'refunded' when the refund settles; it was still received that day
  -- (N123), and the refund comes off on its own day through (e).
  SELECT COALESCE(sum(r.fee_cents), 0)::bigint INTO v_tables
  FROM public.reservations r
  WHERE r.venue_id = p_venue_id AND r.payment_status IN ('paid', 'refunded') AND COALESCE(r.fee_cents, 0) > 0
    AND upper(COALESCE(r.fee_currency, v_cur)) = v_cur
    AND public.issue_4490_venue_service_date(p_venue_id, r.created_at) = p_local_date;
  -- (e) refunds raised that day
  SELECT
    COALESCE((SELECT sum(f.amount_minor) FROM public.stay_refunds f
              JOIN public.stay_reservation_groups g ON g.id = f.group_id
              WHERE g.venue_id = p_venue_id
                AND f.state IN ('submitted', 'processing', 'succeeded', 'manual_reconciliation')
                AND upper(f.currency_code) = v_cur
                AND public.issue_4490_venue_service_date(p_venue_id, f.created_at) = p_local_date), 0)
  + COALESCE((SELECT sum(sr.buyer_refund_requested_cents) FROM public.source_refunds sr
              WHERE sr.source_type = 'venue_reservation' AND sr.venue_id = p_venue_id AND upper(sr.currency) = v_cur
                -- N125: a refund that failed or ended with no refund due moved no money.
                AND sr.buyer_state NOT IN ('failed_terminal', 'cancelled_no_refund_due')
                AND public.issue_4490_venue_service_date(p_venue_id, sr.requested_at) = p_local_date), 0)
  INTO v_refunded;

  -- For today's bookings: the booking side only, all-time money of bookings dated that day.
  WITH day_groups AS (
    SELECT g.id FROM public.stay_reservation_groups g
    WHERE g.venue_id = p_venue_id
      AND g.offer_kind IN ('entry', 'group_package', 'private_hire', 'by_the_hour')
      AND (SELECT w.local_date FROM public.stay_place_windows w
           WHERE w.id = public.issue_4490_group_window_id(g.id)) = p_local_date
  )
  SELECT
    COALESCE((SELECT sum(a.amount_minor) FROM public.stay_payment_attempts a
              WHERE a.group_id IN (SELECT id FROM day_groups) AND a.state = 'succeeded' AND upper(a.currency_code) = v_cur), 0),
    COALESCE((SELECT sum(o.amount_minor) FROM public.venue_offline_payments o
              WHERE o.group_id IN (SELECT id FROM day_groups) AND upper(o.currency_code) = v_cur), 0),
    COALESCE((SELECT sum(f.amount_minor) FROM public.stay_refunds f
              WHERE f.group_id IN (SELECT id FROM day_groups)
                AND f.state IN ('submitted', 'processing', 'succeeded', 'manual_reconciliation')
                AND upper(f.currency_code) = v_cur), 0)
  INTO v_f_online, v_f_at_venue, v_f_refunded;

  WITH day_tables AS (
    SELECT r.id, r.fee_cents FROM public.reservations r
    WHERE r.venue_id = p_venue_id AND r.payment_status IN ('paid', 'refunded') AND COALESCE(r.fee_cents, 0) > 0
    AND upper(COALESCE(r.fee_currency, v_cur)) = v_cur
      AND public.issue_4490_venue_service_date(p_venue_id, r.reserved_for) = p_local_date
  )
  SELECT
    COALESCE((SELECT sum(fee_cents) FROM day_tables), 0),
    v_f_refunded + COALESCE((SELECT sum(sr.buyer_refund_requested_cents) FROM public.source_refunds sr
              WHERE sr.source_type = 'venue_reservation' AND sr.venue_id = p_venue_id AND upper(sr.currency) = v_cur
                -- N125: a refund that failed or ended with no refund due moved no money.
                AND sr.buyer_state NOT IN ('failed_terminal', 'cancelled_no_refund_due')
                -- N124: production writes source_id = the checkout session and
                -- subject_id = the reservation.
                AND sr.subject_id IN (SELECT id FROM day_tables)), 0)
  INTO v_f_tables, v_f_refunded;

  SELECT EXISTS (
      SELECT 1 FROM public.stay_payment_attempts a JOIN public.stay_reservation_groups g ON g.id = a.group_id
      WHERE g.venue_id = p_venue_id AND a.state = 'succeeded' AND upper(a.currency_code) <> v_cur
        AND public.issue_4490_venue_service_date(p_venue_id, a.succeeded_at) = p_local_date)
    OR EXISTS (
      SELECT 1 FROM public.venue_offline_payments o JOIN public.stay_reservation_groups g ON g.id = o.group_id
      WHERE g.venue_id = p_venue_id AND upper(o.currency_code) <> v_cur AND o.paid_on BETWEEN p_local_date - 1 AND p_local_date + 1)
    OR EXISTS (
      SELECT 1 FROM public.venue_membership_periods m
      WHERE m.paid_via = 'venue' AND m.paid_at IS NOT NULL AND upper(m.currency_code) <> v_cur
        AND public.issue_4490_member_venue(m.subscription_id) = p_venue_id
        AND public.issue_4490_venue_service_date(p_venue_id, m.paid_at) = p_local_date)
  INTO v_other;

  RETURN jsonb_build_object(
    'localDate', p_local_date,
    'currencyCode', v_cur,
    'otherCurrency', v_other,
    'paidInMinor', v_online + v_at_venue + v_members + v_tables - v_refunded,
    'paidIn', jsonb_build_object(
      'online', v_online, 'atVenue', v_at_venue, 'members', v_members,
      'tableDeposits', v_tables, 'refunded', v_refunded),
    'forTodayPaidMinor', v_f_online + v_f_at_venue + v_f_tables - v_f_refunded,
    'forToday', jsonb_build_object(
      'online', v_f_online, 'atVenue', v_f_at_venue, 'members', 0,
      'tableDeposits', v_f_tables, 'refunded', v_f_refunded)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_4490_venue_money_day(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4490_venue_money_day(uuid, date) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_4490_venue_day(p_venue_id uuid, p_local_date date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_tz text;
  v_date date;
BEGIN
  IF auth.uid() IS NULL OR NOT public.issue_4490_can_view_venue(p_venue_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  v_tz := public.issue_4490_venue_timezone(p_venue_id);
  -- #4490 fix round 1: "today" is the venue's service day (01:30 after a
  -- Friday that closes at 02:00 is still Friday).
  v_date := COALESCE(p_local_date, public.issue_4490_venue_local_date(p_venue_id));
  RETURN jsonb_build_object(
    'venueId', p_venue_id,
    'localDate', v_date,
    'timezone', v_tz,
    'closed', public.issue_4490_day_closed(p_venue_id, v_date),
    'pools', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
          'poolId', p.id, 'name', p.name,
          'dailyLimit', u.limit_effective, 'keptForWalkIns', u.kept,
          'used', u.used, 'soldOnline', u.used_online, 'soldAtGate', u.used_gate,
          'onlineLeft', u.online_left, 'walkInLeft', u.kept_left, 'gateLeft', u.gate_left,
          'closed', u.closed,
          'override', (SELECT jsonb_build_object('dailyLimit', ov.daily_limit, 'keptForWalkIns', ov.kept_for_walk_ins,
                         'closed', ov.closed, 'version', ov.version)
                       FROM public.venue_capacity_overrides ov WHERE ov.pool_id = p.id AND ov.local_date = v_date))
        ORDER BY p.created_at)
      FROM public.venue_capacity_pools p
      CROSS JOIN LATERAL public.issue_4490_pool_day_usage(p.id, v_date) u
      WHERE p.venue_id = p_venue_id AND p.archived_at IS NULL), '[]'::jsonb),
    'offers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
          'offerId', o.id, 'name', o.name, 'kind', o.kind, 'entryStyle', o.entry_style, 'status', o.status,
          'poolId', o.capacity_pool_id,
          'sold', COALESCE((
            SELECT sum(c.quantity) FROM public.stay_inventory_commitments c
            JOIN public.stay_place_windows w ON w.id = c.place_window_id
            WHERE c.offering_id = o.id AND c.state = 'active' AND w.local_date = v_date), 0),
          'held', COALESCE((
            SELECT sum(s.quantity) FROM public.stay_inventory_hold_slices s
            JOIN public.stay_inventory_holds h ON h.id = s.hold_id
            JOIN public.stay_place_windows w ON w.id = s.place_window_id
            WHERE s.offering_id = o.id AND w.local_date = v_date
              AND h.state = 'active' AND h.expires_at > now()), 0))
        ORDER BY o.sort_order, o.created_at)
      FROM public.stay_offerings o
      WHERE o.venue_id = p_venue_id AND o.kind NOT IN ('room', 'place', 'membership') AND o.status IN ('live', 'paused')), '[]'::jsonb),
    -- #4490 P6: members checked in that day.
    'membersIn', (SELECT count(*) FROM public.venue_member_visits x
                  JOIN public.venue_membership_subscriptions s ON s.id = x.subscription_id
                  JOIN public.venue_membership_plans p ON p.id = s.plan_id
                  JOIN public.stay_offerings o ON o.id = p.offering_id
                  WHERE o.venue_id = p_venue_id AND x.local_date = v_date AND x.undone_at IS NULL),
    'checkIn', (
      SELECT jsonb_build_object(
        'passes', count(*),
        'expected', COALESCE(sum(p.admits) FILTER (WHERE p.status = 'valid'), 0),
        'admitted', COALESCE(sum(p.admitted_count), 0))
      FROM public.venue_passes p WHERE p.venue_id = p_venue_id AND p.valid_local_date = v_date),
    -- #4490 07-E (N47): two honest numbers, both computed here and only here:
    -- "Paid in today" (money received that service day, for any date) and
    -- "For today's bookings" (paid so far for bookings dated that day).
    'money', public.issue_4490_venue_money_day(p_venue_id, v_date),
    'bookings', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
          'groupId', g.id, 'reference', g.public_reference, 'state', g.state,
          'guestName', g.guest_snapshot->>'name', 'guests', (SELECT sum(public.issue_4490_line_guests(l.id))
            FROM public.stay_reservation_lines l WHERE l.group_id = g.id),
          'offerKind', g.offer_kind,
          'startsAt', (SELECT w.starts_at FROM public.stay_place_windows w WHERE w.id = public.issue_4490_group_window_id(g.id)),
          'balanceDueMinor', (SELECT m.balance FROM public.issue_4490_booking_money(g.id) m),
          'balanceDueAt', g.balance_due_at,
          'totalMinor', g.total_minor, 'currencyCode', g.currency_code,
          'source', g.booking_source, 'paymentCollection', g.payment_collection,
          'admittedCount', (SELECT p.admitted_count FROM public.venue_passes p WHERE p.group_id = g.id),
          'createdAt', g.created_at)
        ORDER BY g.created_at DESC)
      FROM public.stay_reservation_groups g
      WHERE g.venue_id = p_venue_id AND g.offer_kind IS NOT NULL AND g.offer_kind <> 'membership'
        AND g.state IN ('confirmed', 'partially_cancelled', 'cancelled', 'reconciliation_required', 'instant_payment_pending')
        AND (SELECT w.local_date FROM public.stay_place_windows w
             WHERE w.id = public.issue_4490_group_window_id(g.id)) = v_date), '[]'::jsonb)
  );
END;
$function$;


-- Subtract before adding (rule 8): the old one-number day total goes.
DROP FUNCTION IF EXISTS public.issue_4490_collected_on(uuid, date);
