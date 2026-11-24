-- Issue #4490, Explorer app W2: Purchases list, claim sweep, reminders.
-- Spec 06 §3 W2 (the spec's number 20281203344490 is taken; this is the next
-- free number in the #4490 series).
-- 1. claim_attendance_by_verified_identity (latest body
--    20280805004459_issue_4459_brand_guest_chat.sql plus the W1 N162 checked
--    patch in 20281203334490, kept): a venue offer booking is reported as
--    kind/routeKind venue_booking, offering type venue, noun pass; membership
--    months attach silently; two new loops attach venue memberships and open
--    waitlist places to the account that proved the contact (a plan is
--    announced as a pass only when it carries one: active, payment_due,
--    grace; see the loop for which plan states attach).
--    Renumbered after main: this re-emit now runs AFTER #4508's
--    20281119014508_issue_4508_bring_a_friend.sql, so it carries #4508's
--    claim_attendance_by_verified_identity changes (a claimed RSVP guest place
--    skips the account's RSVP claim; the owned-RSVP check counts only
--    not_going / denied; issue_4508_sweep_guest_yields releases a guest row).
-- 2. issue_4473_share_purchases_by_verified_identity (latest
--    20280805004473): the stay block ignores venue offer bookings.
-- 3. New issue_4490_my_waitlist_entries() for the app's Purchases list.
-- 4. issue_4490_my_offer_bookings (latest 20281203194490): bookings paid at
--    the venue are listed too (membership months still excluded).
-- 5. Category venue_visit_reminder; issue_4490_offer_sweep (latest
--    20281203174490) queues one reminder a day before and one 2 hours before
--    the first slice of a live booking (confirmed or partly cancelled), once
--    per booking time, fairly across runs, behind VENUE_VISIT_REMINDERS.
-- 6. venue_membership_renewal reaches push and SMS as well.
-- Static SQL. Local stack only until Seth approves a production migration.

BEGIN;
SET LOCAL lock_timeout = '5s';

INSERT INTO public.feature_flags (flag_key, is_enabled, description)
VALUES ('VENUE_VISIT_REMINDERS', false,
  '#4490 Explorer W2: day-before and two-hours-before reminders for confirmed venue bookings.')
ON CONFLICT (flag_key) DO NOTHING;

INSERT INTO public.notification_categories (key, section, is_transactional, urgency, default_channels)
VALUES ('venue_visit_reminder', 'Venue bookings', true, 'normal', ARRAY['inapp', 'push', 'email'])
ON CONFLICT (key) DO NOTHING;

UPDATE public.notification_categories
   SET default_channels = ARRAY['inapp', 'push', 'email', 'sms']
 WHERE key = 'venue_membership_renewal';

-- ---------------------------------------------------------------------------
-- 1. Claim sweep (re-emitted from 20280805004459 + the 20281203334490 patch).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_attendance_by_verified_identity(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_emails text[];
  v_phones text[];
  v_row record;
  v_claimed jsonb := '[]'::jsonb;
  v_conv uuid;
  v_more boolean := false;
  v_pass_count integer;
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'invalid_claim'; END IF;

  SELECT
    coalesce(array_agg(DISTINCT value) FILTER (WHERE kind = 'email'), '{}'::text[]),
    coalesce(array_agg(DISTINCT value) FILTER (WHERE kind = 'phone'), '{}'::text[])
    INTO v_emails, v_phones
    FROM (
      SELECT kind, value
        FROM public.verified_account_identifiers(p_user_id)
      UNION
      SELECT 'phone'::text, phone_e164
        FROM public.verified_phone_identities
       WHERE user_id = p_user_id
      UNION
      SELECT channel, value
        FROM public.account_claim_contacts
       WHERE user_id = p_user_id AND revoked_at IS NULL
    ) identifiers;

  IF coalesce(array_length(v_emails, 1), 0) = 0
     AND coalesce(array_length(v_phones, 1), 0) = 0 THEN
    RETURN jsonb_build_object(
      'claimed', v_claimed, 'count', 0, 'more', false
    );
  END IF;

  -- Orders, including used door receipts on recently ended events.
  v_pass_count := 0;
  FOR v_row IN
    SELECT o.id, o.event_id, o.source, o.door_payment_method, e.event_type, e.title,
           coalesce(o.booked_start_at, chosen.start_at, master.start_at) AS starts_at,
           coalesce(chosen.timezone, master.timezone, e.timezone) AS timezone,
           (SELECT count(*)::integer FROM public.tickets t
             WHERE t.order_id = o.id AND t.status IN ('valid', 'used')) AS quantity
      FROM public.orders o
      JOIN public.events e ON e.id = o.event_id
      JOIN public.brands b ON b.id = e.brand_id
      LEFT JOIN public.event_dates chosen ON chosen.id = o.event_date_id
      LEFT JOIN LATERAL (
        SELECT d.start_at, d.timezone
          FROM public.event_dates d
         WHERE d.event_id = e.id AND d.is_master IS TRUE
         ORDER BY d.start_at, d.id LIMIT 1
      ) master ON true
     WHERE o.buyer_user_id IS NULL
       AND o.attendance_identity_claim_armed_at IS NOT NULL
       AND (lower(btrim(o.buyer_email)) = ANY(v_emails)
         OR o.buyer_phone_e164 = ANY(v_phones))
       AND public.account_owns_contact(
         p_user_id, o.buyer_email, o.buyer_phone_e164
       )
       AND o.payment_status IN ('paid', 'partial_refund')
       AND e.event_type IN ('event', 'trip', 'experience')
       AND e.deleted_at IS NULL AND b.deleted_at IS NULL
       AND (
         (public.issue_4271_is_door_order(o.source, o.door_payment_method)
           AND e.status IN ('scheduled', 'live', 'ended')
           AND o.created_at >= now() - interval '30 days')
         OR
         (NOT public.issue_4271_is_door_order(o.source, o.door_payment_method)
           AND e.status IN ('scheduled', 'live')
           AND EXISTS (
             SELECT 1 FROM public.tickets t
              WHERE t.order_id = o.id
                AND t.approval_status IN ('auto', 'approved')
                AND ((e.status = 'scheduled' AND t.status = 'valid')
                  OR (e.status = 'live' AND t.status IN ('valid', 'used')))
           ))
       )
     ORDER BY o.created_at, o.id
     LIMIT 25
     FOR UPDATE OF o SKIP LOCKED
  LOOP
    UPDATE public.orders o
       SET buyer_user_id = p_user_id,
           attendance_claim_token_digest = NULL,
           attendance_claim_token_generation = NULL,
           attendance_claim_legacy_token_digest = NULL,
           attendance_claim_legacy_token_created_at = NULL,
           attendance_claim_token_consumed_at = CASE
             WHEN o.attendance_claim_token_created_at IS NOT NULL
               THEN coalesce(o.attendance_claim_token_consumed_at, now())
             ELSE o.attendance_claim_token_consumed_at END
     WHERE o.id = v_row.id AND o.buyer_user_id IS NULL;
    IF NOT FOUND THEN CONTINUE; END IF;
    v_pass_count := v_pass_count + 1;

    UPDATE public.attendance_claim_recovery_items
       SET state = 'claimed', operator_closure_id = NULL, resolved_via = 'verified_identity',
           reconciled_at = now(), updated_at = now()
     WHERE order_id = v_row.id;
    UPDATE public.attendance_claim_deliveries
       SET status = 'failed_terminal', next_attempt_at = NULL,
           lease_id = NULL, lease_expires_at = NULL,
           provider_attempt_started_at = NULL,
           last_error_code = 'claim_resolved', updated_at = now()
     WHERE source_id = v_row.id
       AND kind IN ('order_recovery_email', 'order_recovery_sms')
       AND status IN ('pending', 'processing', 'failed_retryable');
    PERFORM public.add_buyer_to_event_chat(
      v_row.event_id, p_user_id, v_row.id, NULL
    );
    UPDATE public.pending_trip_chat_claims
       SET claimed_at = now(), claimed_by_user_id = p_user_id
     WHERE order_id = v_row.id AND claimed_at IS NULL;

    v_conv := NULL;
    SELECT c.id INTO v_conv
      FROM public.conversations c
      JOIN public.conversation_participants cp
        ON cp.conversation_id = c.id AND cp.user_id = p_user_id
     WHERE c.linked_entity_type = 'brand_guests'
       AND c.brand_id = (SELECT e4459.brand_id FROM public.events e4459 WHERE e4459.id = v_row.event_id)
     LIMIT 1;

    v_claimed := v_claimed || jsonb_build_array(jsonb_build_object(
      'kind', 'order', 'id', v_row.id,
      'orderId', v_row.id, 'eventId', v_row.event_id,
      'routeKind', 'order', 'routeId', v_row.id,
      'offeringType', v_row.event_type,
      'noun', CASE
        WHEN public.issue_4271_is_door_order(v_row.source, v_row.door_payment_method)
          THEN 'receipt'
        WHEN v_row.event_type = 'event' THEN 'ticket'
        ELSE 'booking' END,
      'title', v_row.title, 'orderLabel', NULL,
      'startsAt', v_row.starts_at, 'timezone', v_row.timezone,
      'venueLine', NULL, 'quantity', v_row.quantity,
      'source', CASE
        WHEN v_row.source = 'comp'
          OR public.issue_4271_is_door_order(v_row.source, v_row.door_payment_method)
          THEN 'door'
        ELSE 'purchase' END,
      'sentByFirstName', NULL,
      'chatJoined', v_conv IS NOT NULL, 'conversationId', v_conv
    ));
  END LOOP;
  v_more := v_more OR v_pass_count = 25;

  -- Anonymous RSVP primaries.
  v_pass_count := 0;
  FOR v_row IN
    SELECT r.id, r.event_id, e.title, 1 + coalesce(r.plus_count, 0) AS quantity,
           master.start_at, coalesce(master.timezone, e.timezone) AS timezone
      FROM public.event_rsvps r
      JOIN public.events e ON e.id = r.event_id
      JOIN public.brands b ON b.id = e.brand_id
      LEFT JOIN LATERAL (
        SELECT d.start_at, d.timezone
          FROM public.event_dates d
         WHERE d.event_id = e.id AND d.is_master IS TRUE
         ORDER BY d.start_at, d.id LIMIT 1
      ) master ON true
     WHERE r.user_id IS NULL
       AND (lower(btrim(r.guest_email)) = ANY(v_emails)
         OR r.guest_phone = ANY(v_phones))
       AND public.account_owns_contact(
         p_user_id, r.guest_email, r.guest_phone
       )
       AND e.event_type = 'rsvp' AND e.deleted_at IS NULL
       AND b.deleted_at IS NULL AND e.status IN ('scheduled', 'live')
       AND r.rsvp_status <> 'not_going'
       AND r.approval_status <> 'denied'
       AND NOT EXISTS (
         SELECT 1 FROM public.event_rsvps x
          WHERE x.event_id = r.event_id AND x.user_id = p_user_id
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.event_rsvp_guests g4508
           JOIN public.event_rsvps r4508 ON r4508.id = g4508.rsvp_id
          WHERE r4508.event_id = r.event_id AND g4508.matched_user_id = p_user_id
            AND g4508.claimed_at IS NOT NULL AND r4508.rsvp_status <> 'not_going'
       )
     ORDER BY r.created_at, r.id
     LIMIT 25
     FOR UPDATE OF r SKIP LOCKED
  LOOP
    UPDATE public.event_rsvps
       SET user_id = p_user_id
     WHERE id = v_row.id AND user_id IS NULL;
    IF NOT FOUND THEN CONTINUE; END IF;
    v_pass_count := v_pass_count + 1;
    v_claimed := v_claimed || jsonb_build_array(jsonb_build_object(
      'kind', 'rsvp', 'id', v_row.id,
      'routeKind', 'rsvp', 'routeId', v_row.id,
      'offeringType', 'rsvp', 'noun', 'pass',
      'title', v_row.title, 'orderLabel', NULL,
      'startsAt', v_row.start_at, 'timezone', v_row.timezone,
      'venueLine', NULL, 'quantity', v_row.quantity,
      'source', 'rsvp', 'sentByFirstName', NULL,
      'chatJoined', NULL, 'conversationId', NULL
    ));
  END LOOP;
  v_more := v_more OR v_pass_count = 25;

  -- RSVP plus-ones that did not have an account at RSVP time.
  v_pass_count := 0;
  FOR v_row IN
    SELECT g.id, g.rsvp_id, r.event_id, e.title, master.start_at,
           coalesce(master.timezone, e.timezone) AS timezone
      FROM public.event_rsvp_guests g
      JOIN public.event_rsvps r ON r.id = g.rsvp_id
      JOIN public.events e ON e.id = r.event_id
      JOIN public.brands b ON b.id = e.brand_id
      LEFT JOIN LATERAL (
        SELECT d.start_at, d.timezone
          FROM public.event_dates d
         WHERE d.event_id = e.id AND d.is_master IS TRUE
         ORDER BY d.start_at, d.id LIMIT 1
      ) master ON true
     WHERE g.matched_user_id IS NULL
       AND (lower(btrim(g.email)) = ANY(v_emails) OR g.phone = ANY(v_phones))
       AND public.account_owns_contact(p_user_id, g.email, g.phone)
       AND e.event_type = 'rsvp' AND e.deleted_at IS NULL
       AND b.deleted_at IS NULL AND e.status IN ('scheduled', 'live')
       AND r.rsvp_status <> 'not_going' AND r.approval_status <> 'denied'
       AND r.user_id IS DISTINCT FROM p_user_id
       AND NOT EXISTS (
         SELECT 1 FROM public.event_rsvps owned
          WHERE owned.event_id = r.event_id AND owned.user_id = p_user_id
            AND (owned.rsvp_status = 'not_going' OR owned.approval_status = 'denied')
       )
       AND NOT EXISTS (
         SELECT 1
           FROM public.event_rsvp_guests other
           JOIN public.event_rsvps other_rsvp ON other_rsvp.id = other.rsvp_id
          WHERE other_rsvp.event_id = r.event_id
            AND other.matched_user_id = p_user_id
       )
     ORDER BY g.created_at, g.id
     LIMIT 25
     FOR UPDATE OF g SKIP LOCKED
  LOOP
    -- #4508 R5-2: one place per person (releases the row when the
    -- account holds its own place on the event).
    IF public.issue_4508_sweep_guest_yields(v_row.id, p_user_id) THEN CONTINUE; END IF;
    UPDATE public.event_rsvp_guests
       SET matched_user_id = p_user_id
     WHERE id = v_row.id AND matched_user_id IS NULL;
    IF NOT FOUND THEN CONTINUE; END IF;
    v_pass_count := v_pass_count + 1;
    v_claimed := v_claimed || jsonb_build_array(jsonb_build_object(
      'kind', 'rsvp_guest', 'id', v_row.id,
      'routeKind', 'rsvp', 'routeId', v_row.rsvp_id,
      'offeringType', 'rsvp', 'noun', 'pass',
      'title', v_row.title, 'orderLabel', NULL,
      'startsAt', v_row.start_at, 'timezone', v_row.timezone,
      'venueLine', NULL, 'quantity', 1,
      'source', 'rsvp', 'sentByFirstName', NULL,
      'chatJoined', NULL, 'conversationId', NULL
    ));
  END LOOP;
  v_more := v_more OR v_pass_count = 25;

  -- Venue reservations.
  v_pass_count := 0;
  FOR v_row IN
    SELECT r.id, r.venue_id, r.reserved_for, r.party_size,
           vl.name AS title,
           CASE WHEN vac.iana_timezone_source = 'default' THEN NULL
             ELSE vac.iana_timezone END AS timezone
      FROM public.reservations r
      LEFT JOIN public.venue_listings vl ON vl.id = r.venue_id
      LEFT JOIN public.venue_availability_config vac ON vac.venue_id = r.venue_id
     WHERE r.consumer_user_id IS NULL
       AND (lower(btrim(r.guest_email)) = ANY(v_emails)
         OR r.guest_phone_e164 = ANY(v_phones))
       AND public.account_owns_contact(
         p_user_id, r.guest_email, r.guest_phone_e164
       )
       AND r.reserved_for >= now() - interval '30 days'
     ORDER BY r.reserved_for, r.id
     LIMIT 25
     FOR UPDATE OF r SKIP LOCKED
  LOOP
    UPDATE public.reservations
       SET consumer_user_id = p_user_id
     WHERE id = v_row.id AND consumer_user_id IS NULL;
    IF NOT FOUND THEN CONTINUE; END IF;
    v_pass_count := v_pass_count + 1;
    v_claimed := v_claimed || jsonb_build_array(jsonb_build_object(
      'kind', 'reservation', 'id', v_row.id,
      'routeKind', 'reservation', 'routeId', v_row.id,
      'offeringType', 'venue', 'noun', 'booking',
      'title', coalesce(v_row.title, 'Reservation'), 'orderLabel', NULL,
      'startsAt', v_row.reserved_for, 'timezone', v_row.timezone,
      'venueLine', v_row.title, 'quantity', v_row.party_size,
      'source', 'booking', 'sentByFirstName', NULL,
      'chatJoined', NULL, 'conversationId', NULL
    ));
  END LOOP;
  v_more := v_more OR v_pass_count = 25;

  -- Stay groups. These tables are intentionally small; the contact prefilter
  -- is still present so a future volume increase cannot turn this into a scan.
  -- #4490 Explorer W2: venue offer bookings (offer_kind set) are reported as
  -- venue_booking passes; membership months attach silently (the plan's own
  -- row below carries them).
  v_pass_count := 0;
  FOR v_row IN
    SELECT g.id, g.venue_id, vl.name AS title, g.offer_kind,
           (SELECT min(w.starts_at)
              FROM public.stay_reservation_lines l
              JOIN public.stay_place_windows w
                ON w.id = public.issue_4490_line_window_id(l.id)
             WHERE l.group_id = g.id) AS starts_at,
           (SELECT count(*)::integer FROM public.venue_passes p
             WHERE p.group_id = g.id) AS pass_count,
           (SELECT max(p.admits)::integer FROM public.venue_passes p
             WHERE p.group_id = g.id) AS admits
      FROM public.stay_reservation_groups g
      LEFT JOIN public.venue_listings vl ON vl.id = g.venue_id
     WHERE g.user_id IS NULL
       AND g.state IN ('confirmed', 'partially_cancelled')
       AND (lower(btrim(g.guest_snapshot->>'email')) = ANY(v_emails)
         OR g.guest_snapshot->>'phone' = ANY(v_phones))
       AND public.account_owns_contact(
         p_user_id, g.guest_snapshot->>'email', g.guest_snapshot->>'phone'
       )
     ORDER BY g.created_at, g.id
     LIMIT 25
     FOR UPDATE OF g SKIP LOCKED
  LOOP
    UPDATE public.stay_reservation_groups
       SET user_id = p_user_id, updated_at = now()
     WHERE id = v_row.id AND user_id IS NULL;
    IF NOT FOUND THEN CONTINUE; END IF;
    v_pass_count := v_pass_count + 1;
    IF v_row.offer_kind = 'membership' THEN
      CONTINUE;
    END IF;
    IF v_row.offer_kind IS NOT NULL THEN
      v_claimed := v_claimed || jsonb_build_array(jsonb_build_object(
        'kind', 'venue_booking', 'id', v_row.id,
        'routeKind', 'venue_booking', 'routeId', v_row.id,
        'offeringType', 'venue', 'noun', 'pass',
        'title', coalesce(v_row.title, 'Venue'), 'orderLabel', NULL,
        'startsAt', v_row.starts_at,
        'timezone', public.issue_4490_venue_timezone(v_row.venue_id),
        'venueLine', v_row.title, 'quantity', v_row.admits,
        'source', 'booking', 'sentByFirstName', NULL,
        'chatJoined', NULL, 'conversationId', NULL
      ));
      CONTINUE;
    END IF;
    v_claimed := v_claimed || jsonb_build_array(jsonb_build_object(
      'kind', 'stay_group', 'id', v_row.id,
      'routeKind', 'stay', 'routeId', v_row.id,
      'offeringType', 'stay', 'noun', 'booking',
      'title', coalesce(v_row.title, 'Stay'), 'orderLabel', NULL,
      'startsAt', NULL, 'timezone', NULL,
      'venueLine', v_row.title, 'quantity', NULL,
      'source', 'booking', 'sentByFirstName', NULL,
      'chatJoined', NULL, 'conversationId', NULL
    ));
  END LOOP;
  v_more := v_more OR v_pass_count = 25;

  -- #4490 Explorer W2: venue memberships bought without an account.
  -- Attached: plans that carry a member pass (active, payment_due, grace),
  -- paid plans that are lapsed or paused (they restart by paying) while the
  -- period they would restart with has not run out, a plan request while the
  -- venue's reply clock runs, and a plan still inside its first-payment
  -- window (joined, or approved by the venue, and not yet closed by the
  -- billing run: the same clocks as issue_4490_membership_billing_run).
  -- Only the first three are announced as a pass; the rest are reported with
  -- the noun 'booking' ("Your booking is here"), never as a pass that does
  -- not exist. Declined, cancelled and never-paid plans past their window
  -- are not attached, nor is a plan outside every window above (a plan that
  -- lapsed long ago, or a request nobody answered in time).
  v_pass_count := 0;
  FOR v_row IN
    SELECT s.id, vl.id AS venue_id, p.name AS title, vl.name AS venue_name,
           s.current_period_start AS starts_at, s.status
      FROM public.venue_membership_subscriptions s
      JOIN public.venue_membership_plans p ON p.id = s.plan_id
      LEFT JOIN public.venue_listings vl
        ON vl.id = public.issue_4490_plan_venue(s.plan_id)
     WHERE s.user_id IS NULL
       AND (s.status IN ('active', 'payment_due', 'grace')
         -- W2-N14: a lapsed or paused plan only while the period it would
         -- restart with has not run out (one plan period after the last paid
         -- one ended); a request only while the venue's reply clock runs (the
         -- billing run declines it at created_at + request_response_hours).
         OR (s.status IN ('lapsed', 'paused')
           AND s.current_period_end IS NOT NULL
           AND s.current_period_end
               + CASE WHEN p.period = 'year' THEN interval '1 year' ELSE interval '1 month' END > now())
         OR (s.status = 'requested'
           AND s.created_at + make_interval(hours => COALESCE((
                 SELECT bs.request_response_hours FROM public.stay_offerings o
                   JOIN public.venue_booking_settings bs ON bs.venue_id = o.venue_id
                  WHERE o.id = p.offering_id), 48)) > now())
         OR (s.status = 'pending'
           AND (CASE WHEN s.decided_at IS NOT NULL THEN s.decided_at + interval '3 days'
                     ELSE s.created_at + interval '2 days' END > now()
             OR EXISTS (SELECT 1 FROM public.venue_membership_periods mp
                          JOIN public.stay_payment_attempts a ON a.group_id = mp.group_id
                         WHERE mp.subscription_id = s.id AND a.state IN ('pending', 'ambiguous')))))
       AND (lower(btrim(s.member_email)) = ANY(v_emails)
         OR s.member_phone = ANY(v_phones))
       AND public.account_owns_contact(
         p_user_id, s.member_email, s.member_phone
       )
     ORDER BY s.created_at, s.id
     LIMIT 25
     FOR UPDATE OF s SKIP LOCKED
  LOOP
    UPDATE public.venue_membership_subscriptions
       SET user_id = p_user_id, updated_at = now()
     WHERE id = v_row.id AND user_id IS NULL;
    IF NOT FOUND THEN CONTINUE; END IF;
    v_pass_count := v_pass_count + 1;
    v_claimed := v_claimed || jsonb_build_array(jsonb_build_object(
      'kind', 'venue_membership', 'id', v_row.id,
      'routeKind', 'venue_membership', 'routeId', v_row.id,
      'offeringType', 'venue',
      'noun', CASE WHEN v_row.status IN ('active', 'payment_due', 'grace') THEN 'pass' ELSE 'booking' END,
      'title', coalesce(v_row.title, 'Membership'), 'orderLabel', NULL,
      'startsAt', v_row.starts_at,
      'timezone', public.issue_4490_venue_timezone(v_row.venue_id),
      'venueLine', v_row.venue_name, 'quantity', 1,
      'source', 'booking', 'sentByFirstName', NULL,
      'chatJoined', NULL, 'conversationId', NULL
    ));
  END LOOP;
  v_more := v_more OR v_pass_count = 25;

  -- #4490 Explorer W2: open venue waitlist places joined without an account.
  v_pass_count := 0;
  FOR v_row IN
    SELECT w.id, w.venue_id, vl.name AS title, w.party_size,
           CASE WHEN w.desired_date IS NULL THEN NULL
             ELSE (w.desired_date + coalesce(w.desired_from, time '00:00'))
               AT TIME ZONE public.issue_4490_venue_timezone(w.venue_id)
           END AS starts_at
      FROM public.venue_waitlist w
      LEFT JOIN public.venue_listings vl ON vl.id = w.venue_id
     WHERE w.consumer_user_id IS NULL
       AND w.status IN ('waiting', 'notified')
       AND (lower(btrim(w.guest_email)) = ANY(v_emails)
         OR w.guest_phone_e164 = ANY(v_phones))
       AND public.account_owns_contact(
         p_user_id, w.guest_email, w.guest_phone_e164
       )
     ORDER BY w.created_at, w.id
     LIMIT 25
     FOR UPDATE OF w SKIP LOCKED
  LOOP
    UPDATE public.venue_waitlist
       SET consumer_user_id = p_user_id, updated_at = now()
     WHERE id = v_row.id AND consumer_user_id IS NULL;
    IF NOT FOUND THEN CONTINUE; END IF;
    v_pass_count := v_pass_count + 1;
    v_claimed := v_claimed || jsonb_build_array(jsonb_build_object(
      'kind', 'venue_waitlist', 'id', v_row.id,
      'routeKind', 'venue_waitlist', 'routeId', v_row.id,
      'offeringType', 'venue', 'noun', 'booking',
      'title', coalesce(v_row.title, 'Waitlist'), 'orderLabel', NULL,
      'startsAt', v_row.starts_at,
      'timezone', public.issue_4490_venue_timezone(v_row.venue_id),
      'venueLine', v_row.title, 'quantity', v_row.party_size,
      'source', 'booking', 'sentByFirstName', NULL,
      'chatJoined', NULL, 'conversationId', NULL
    ));
  END LOOP;
  v_more := v_more OR v_pass_count = 25;

  -- Paid Mingla food and drink orders.
  v_pass_count := 0;
  FOR v_row IN
    SELECT vo.id, vo.venue_id, vo.created_at, vo.pickup_code,
           vl.name AS title,
           coalesce((SELECT sum(i.quantity)::integer
             FROM public.venue_order_items i
            WHERE i.venue_order_id = vo.id), 0) AS quantity
      FROM public.venue_orders vo
      JOIN public.venue_listings vl ON vl.id = vo.venue_id
     WHERE vo.buyer_user_id IS NULL
       AND vo.money_path = 'mingla'
       AND vo.payment_status IN ('paid', 'partial_refund', 'refunded')
       AND vo.created_at >= now() - interval '90 days'
       AND (lower(btrim(vo.buyer_email)) = ANY(v_emails)
         OR vo.buyer_phone_e164 = ANY(v_phones))
       AND public.account_owns_contact(
         p_user_id, vo.buyer_email, vo.buyer_phone_e164
       )
     ORDER BY vo.created_at, vo.id
     LIMIT 25
     FOR UPDATE OF vo SKIP LOCKED
  LOOP
    UPDATE public.venue_orders
       SET buyer_user_id = p_user_id
     WHERE id = v_row.id AND buyer_user_id IS NULL;
    IF NOT FOUND THEN CONTINUE; END IF;
    v_pass_count := v_pass_count + 1;
    v_claimed := v_claimed || jsonb_build_array(jsonb_build_object(
      'kind', 'venue_order', 'id', v_row.id,
      'routeKind', 'venue_order', 'routeId', v_row.id,
      'offeringType', 'food', 'noun', 'receipt',
      'title', v_row.title,
      'orderLabel', CASE WHEN btrim(coalesce(v_row.pickup_code, '')) <> ''
        THEN 'Order #' || v_row.pickup_code
        ELSE 'Order ' || upper(substr(replace(v_row.id::text, '-', ''), 1, 8))
        END,
      'startsAt', v_row.created_at, 'timezone', NULL,
      'venueLine', v_row.title, 'quantity', v_row.quantity,
      'source', 'food', 'sentByFirstName', NULL,
      'chatJoined', NULL, 'conversationId', NULL
    ));
  END LOOP;
  v_more := v_more OR v_pass_count = 25;

  RETURN jsonb_build_object(
    'claimed', v_claimed,
    'count', jsonb_array_length(v_claimed),
    'more', v_more
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2. Sharing by verified identity (re-emitted from 20280805004473): the stay
--    block ignores venue offer bookings (sharing those is later; decision 4).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4473_share_purchases_by_verified_identity(
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_emails text[];
  v_phones text[];
  v_row record;
  v_claimed jsonb := '[]'::jsonb;
  v_more boolean := false;
  v_pass integer;
  v_conv uuid;
  v_brand uuid;
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'invalid_claim'; END IF;

  SELECT
    coalesce(array_agg(DISTINCT value) FILTER (WHERE kind = 'email'), '{}'::text[]),
    coalesce(array_agg(DISTINCT value) FILTER (WHERE kind = 'phone'), '{}'::text[])
    INTO v_emails, v_phones
    FROM (
      SELECT kind, value
        FROM public.verified_account_identifiers(p_user_id)
      UNION
      SELECT 'phone'::text, phone_e164
        FROM public.verified_phone_identities
       WHERE user_id = p_user_id
      UNION
      SELECT channel, value
        FROM public.account_claim_contacts
       WHERE user_id = p_user_id AND revoked_at IS NULL
    ) identifiers;

  IF coalesce(array_length(v_emails, 1), 0) = 0
     AND coalesce(array_length(v_phones, 1), 0) = 0 THEN
    RETURN jsonb_build_object('claimed', v_claimed, 'count', 0, 'more', false);
  END IF;

  -- Orders (tickets, trips, experiences, door receipts and comps).
  v_pass := 0;
  FOR v_row IN
    SELECT o.id, o.event_id, o.source, o.door_payment_method, e.event_type,
           e.title, e.brand_id,
           coalesce(o.booked_start_at, chosen.start_at, master.start_at) AS starts_at,
           coalesce(chosen.timezone, master.timezone, e.timezone) AS timezone,
           (SELECT count(*)::integer FROM public.tickets t
             WHERE t.order_id = o.id AND t.status IN ('valid', 'used')) AS quantity
      FROM public.orders o
      JOIN public.events e ON e.id = o.event_id
      JOIN public.brands b ON b.id = e.brand_id
      LEFT JOIN public.event_dates chosen ON chosen.id = o.event_date_id
      LEFT JOIN LATERAL (
        SELECT d.start_at, d.timezone
          FROM public.event_dates d
         WHERE d.event_id = e.id AND d.is_master IS TRUE
         ORDER BY d.start_at, d.id LIMIT 1
      ) master ON true
     WHERE o.buyer_user_id IS NOT NULL
       AND o.buyer_user_id <> p_user_id
       AND (lower(btrim(o.buyer_email)) = ANY(v_emails)
         OR o.buyer_phone_e164 = ANY(v_phones))
       AND NOT EXISTS (
         SELECT 1 FROM public.purchase_shared_holders s
          WHERE s.kind = 'order' AND s.source_id = o.id
            AND s.user_id = p_user_id AND s.revoked_at IS NULL)
       AND public.account_owns_contact(p_user_id, o.buyer_email, o.buyer_phone_e164)
       AND o.payment_status IN ('paid', 'partial_refund')
       AND e.event_type IN ('event', 'trip', 'experience')
       AND e.deleted_at IS NULL AND b.deleted_at IS NULL
       AND (
         (public.issue_4271_is_door_order(o.source, o.door_payment_method)
           AND e.status IN ('scheduled', 'live', 'ended')
           AND o.created_at >= now() - interval '30 days')
         OR
         (NOT public.issue_4271_is_door_order(o.source, o.door_payment_method)
           AND e.status IN ('scheduled', 'live')
           AND EXISTS (
             SELECT 1 FROM public.tickets t
              WHERE t.order_id = o.id
                AND t.approval_status IN ('auto', 'approved')
                AND ((e.status = 'scheduled' AND t.status = 'valid')
                  OR (e.status = 'live' AND t.status IN ('valid', 'used')))
           ))
       )
     ORDER BY o.created_at, o.id
     LIMIT 25
  LOOP
    INSERT INTO public.purchase_shared_holders(kind, source_id, user_id)
    VALUES ('order', v_row.id, p_user_id)
    ON CONFLICT (kind, source_id, user_id) DO UPDATE
      SET revoked_at = NULL, revoked_reason = NULL, reshared_at = now()
      WHERE public.purchase_shared_holders.revoked_at IS NOT NULL;
    v_pass := v_pass + 1;

    -- The single chat writer: before #4459 this joins the event chat; after
    -- #4459 it syncs the brand Guest chat, which reads shared holders too.
    PERFORM public.add_buyer_to_event_chat(v_row.event_id, p_user_id, NULL, NULL);
    v_conv := NULL;
    SELECT c.id INTO v_conv
      FROM public.conversations c
      JOIN public.conversation_participants cp
        ON cp.conversation_id = c.id AND cp.user_id = p_user_id
     WHERE (c.event_id = v_row.event_id
            AND c.linked_entity_type IN ('trip', 'event'))
        OR (c.linked_entity_type = 'brand_guests'
            AND to_jsonb(c)->>'brand_id' = v_row.brand_id::text)
     ORDER BY CASE WHEN c.event_id = v_row.event_id THEN 0 ELSE 1 END
     LIMIT 1;

    v_claimed := v_claimed || jsonb_build_array(jsonb_build_object(
      'kind', 'order', 'id', v_row.id,
      'orderId', v_row.id, 'eventId', v_row.event_id,
      'routeKind', 'order', 'routeId', v_row.id,
      'offeringType', v_row.event_type,
      'noun', CASE
        WHEN public.issue_4271_is_door_order(v_row.source, v_row.door_payment_method)
          THEN 'receipt'
        WHEN v_row.event_type = 'event' THEN 'ticket'
        ELSE 'booking' END,
      'title', v_row.title, 'orderLabel', NULL,
      'startsAt', v_row.starts_at, 'timezone', v_row.timezone,
      'venueLine', NULL, 'quantity', v_row.quantity,
      'source', CASE
        WHEN v_row.source = 'comp'
          OR public.issue_4271_is_door_order(v_row.source, v_row.door_payment_method)
          THEN 'door'
        ELSE 'purchase' END,
      'sentByFirstName', NULL,
      'chatJoined', v_conv IS NOT NULL, 'conversationId', v_conv,
      'role', 'shared', 'sharedWithAnotherAccount', true
    ));
  END LOOP;
  v_more := v_more OR v_pass = 25;

  -- RSVP primaries owned by another account.
  v_pass := 0;
  FOR v_row IN
    SELECT r.id, r.event_id, e.title, 1 + coalesce(r.plus_count, 0) AS quantity,
           master.start_at, coalesce(master.timezone, e.timezone) AS timezone
      FROM public.event_rsvps r
      JOIN public.events e ON e.id = r.event_id
      JOIN public.brands b ON b.id = e.brand_id
      LEFT JOIN LATERAL (
        SELECT d.start_at, d.timezone FROM public.event_dates d
         WHERE d.event_id = e.id AND d.is_master IS TRUE
         ORDER BY d.start_at, d.id LIMIT 1
      ) master ON true
     WHERE r.user_id IS NOT NULL AND r.user_id <> p_user_id
       AND (lower(btrim(r.guest_email)) = ANY(v_emails)
         OR r.guest_phone = ANY(v_phones))
       AND NOT EXISTS (
         SELECT 1 FROM public.purchase_shared_holders s
          WHERE s.kind = 'rsvp' AND s.source_id = r.id
            AND s.user_id = p_user_id AND s.revoked_at IS NULL)
       AND public.account_owns_contact(p_user_id, r.guest_email, r.guest_phone)
       AND e.event_type = 'rsvp' AND e.deleted_at IS NULL
       AND b.deleted_at IS NULL AND e.status IN ('scheduled', 'live')
       AND r.rsvp_status <> 'not_going'
       AND r.approval_status <> 'denied'
     ORDER BY r.created_at, r.id
     LIMIT 25
  LOOP
    INSERT INTO public.purchase_shared_holders(kind, source_id, user_id)
    VALUES ('rsvp', v_row.id, p_user_id)
    ON CONFLICT (kind, source_id, user_id) DO UPDATE
      SET revoked_at = NULL, revoked_reason = NULL, reshared_at = now()
      WHERE public.purchase_shared_holders.revoked_at IS NOT NULL;
    v_pass := v_pass + 1;
    v_claimed := v_claimed || jsonb_build_array(jsonb_build_object(
      'kind', 'rsvp', 'id', v_row.id,
      'routeKind', 'rsvp', 'routeId', v_row.id,
      'offeringType', 'rsvp', 'noun', 'pass',
      'title', v_row.title, 'orderLabel', NULL,
      'startsAt', v_row.start_at, 'timezone', v_row.timezone,
      'venueLine', NULL, 'quantity', v_row.quantity,
      'source', 'rsvp', 'sentByFirstName', NULL,
      'chatJoined', NULL, 'conversationId', NULL,
      'role', 'shared', 'sharedWithAnotherAccount', true
    ));
  END LOOP;
  v_more := v_more OR v_pass = 25;

  -- RSVP plus-ones matched to another account.
  v_pass := 0;
  FOR v_row IN
    SELECT g.id, g.rsvp_id, r.event_id, e.title, master.start_at,
           coalesce(master.timezone, e.timezone) AS timezone
      FROM public.event_rsvp_guests g
      JOIN public.event_rsvps r ON r.id = g.rsvp_id
      JOIN public.events e ON e.id = r.event_id
      JOIN public.brands b ON b.id = e.brand_id
      LEFT JOIN LATERAL (
        SELECT d.start_at, d.timezone FROM public.event_dates d
         WHERE d.event_id = e.id AND d.is_master IS TRUE
         ORDER BY d.start_at, d.id LIMIT 1
      ) master ON true
     WHERE g.matched_user_id IS NOT NULL AND g.matched_user_id <> p_user_id
       AND r.user_id IS DISTINCT FROM p_user_id
       AND (lower(btrim(g.email)) = ANY(v_emails) OR g.phone = ANY(v_phones))
       AND NOT EXISTS (
         SELECT 1 FROM public.purchase_shared_holders s
          WHERE s.kind = 'rsvp_guest' AND s.source_id = g.id
            AND s.user_id = p_user_id AND s.revoked_at IS NULL)
       AND public.account_owns_contact(p_user_id, g.email, g.phone)
       AND e.event_type = 'rsvp' AND e.deleted_at IS NULL
       AND b.deleted_at IS NULL AND e.status IN ('scheduled', 'live')
       AND r.rsvp_status <> 'not_going' AND r.approval_status <> 'denied'
     ORDER BY g.created_at, g.id
     LIMIT 25
  LOOP
    INSERT INTO public.purchase_shared_holders(kind, source_id, user_id)
    VALUES ('rsvp_guest', v_row.id, p_user_id)
    ON CONFLICT (kind, source_id, user_id) DO UPDATE
      SET revoked_at = NULL, revoked_reason = NULL, reshared_at = now()
      WHERE public.purchase_shared_holders.revoked_at IS NOT NULL;
    v_pass := v_pass + 1;
    v_claimed := v_claimed || jsonb_build_array(jsonb_build_object(
      'kind', 'rsvp_guest', 'id', v_row.id,
      'routeKind', 'rsvp', 'routeId', v_row.rsvp_id,
      'offeringType', 'rsvp', 'noun', 'pass',
      'title', v_row.title, 'orderLabel', NULL,
      'startsAt', v_row.start_at, 'timezone', v_row.timezone,
      'venueLine', NULL, 'quantity', 1,
      'source', 'rsvp', 'sentByFirstName', NULL,
      'chatJoined', NULL, 'conversationId', NULL,
      'role', 'shared', 'sharedWithAnotherAccount', true
    ));
  END LOOP;
  v_more := v_more OR v_pass = 25;

  -- Venue reservations.
  v_pass := 0;
  FOR v_row IN
    SELECT r.id, r.reserved_for, r.party_size, vl.name AS title,
           CASE WHEN vac.iana_timezone_source = 'default' THEN NULL
             ELSE vac.iana_timezone END AS timezone
      FROM public.reservations r
      LEFT JOIN public.venue_listings vl ON vl.id = r.venue_id
      LEFT JOIN public.venue_availability_config vac ON vac.venue_id = r.venue_id
     WHERE r.consumer_user_id IS NOT NULL AND r.consumer_user_id <> p_user_id
       AND (lower(btrim(r.guest_email)) = ANY(v_emails)
         OR r.guest_phone_e164 = ANY(v_phones))
       AND NOT EXISTS (
         SELECT 1 FROM public.purchase_shared_holders s
          WHERE s.kind = 'reservation' AND s.source_id = r.id
            AND s.user_id = p_user_id AND s.revoked_at IS NULL)
       AND public.account_owns_contact(p_user_id, r.guest_email, r.guest_phone_e164)
       AND r.reserved_for >= now() - interval '30 days'
     ORDER BY r.reserved_for, r.id
     LIMIT 25
  LOOP
    INSERT INTO public.purchase_shared_holders(kind, source_id, user_id)
    VALUES ('reservation', v_row.id, p_user_id)
    ON CONFLICT (kind, source_id, user_id) DO UPDATE
      SET revoked_at = NULL, revoked_reason = NULL, reshared_at = now()
      WHERE public.purchase_shared_holders.revoked_at IS NOT NULL;
    v_pass := v_pass + 1;
    v_claimed := v_claimed || jsonb_build_array(jsonb_build_object(
      'kind', 'reservation', 'id', v_row.id,
      'routeKind', 'reservation', 'routeId', v_row.id,
      'offeringType', 'venue', 'noun', 'booking',
      'title', coalesce(v_row.title, 'Reservation'), 'orderLabel', NULL,
      'startsAt', v_row.reserved_for, 'timezone', v_row.timezone,
      'venueLine', v_row.title, 'quantity', v_row.party_size,
      'source', 'booking', 'sentByFirstName', NULL,
      'chatJoined', NULL, 'conversationId', NULL,
      'role', 'shared', 'sharedWithAnotherAccount', true
    ));
  END LOOP;
  v_more := v_more OR v_pass = 25;

  -- Stay groups.
  v_pass := 0;
  FOR v_row IN
    SELECT g.id, vl.name AS title
      FROM public.stay_reservation_groups g
      LEFT JOIN public.venue_listings vl ON vl.id = g.venue_id
     WHERE g.user_id IS NOT NULL AND g.user_id <> p_user_id
       AND g.offer_kind IS NULL
       AND (lower(btrim(g.guest_snapshot->>'email')) = ANY(v_emails)
         OR g.guest_snapshot->>'phone' = ANY(v_phones))
       AND NOT EXISTS (
         SELECT 1 FROM public.purchase_shared_holders s
          WHERE s.kind = 'stay_group' AND s.source_id = g.id
            AND s.user_id = p_user_id AND s.revoked_at IS NULL)
       AND public.account_owns_contact(
         p_user_id, g.guest_snapshot->>'email', g.guest_snapshot->>'phone')
     ORDER BY g.created_at, g.id
     LIMIT 25
  LOOP
    INSERT INTO public.purchase_shared_holders(kind, source_id, user_id)
    VALUES ('stay_group', v_row.id, p_user_id)
    ON CONFLICT (kind, source_id, user_id) DO UPDATE
      SET revoked_at = NULL, revoked_reason = NULL, reshared_at = now()
      WHERE public.purchase_shared_holders.revoked_at IS NOT NULL;
    v_pass := v_pass + 1;
    v_claimed := v_claimed || jsonb_build_array(jsonb_build_object(
      'kind', 'stay_group', 'id', v_row.id,
      'routeKind', 'stay', 'routeId', v_row.id,
      'offeringType', 'stay', 'noun', 'booking',
      'title', coalesce(v_row.title, 'Stay'), 'orderLabel', NULL,
      'startsAt', NULL, 'timezone', NULL,
      'venueLine', v_row.title, 'quantity', NULL,
      'source', 'booking', 'sentByFirstName', NULL,
      'chatJoined', NULL, 'conversationId', NULL,
      'role', 'shared', 'sharedWithAnotherAccount', true
    ));
  END LOOP;
  v_more := v_more OR v_pass = 25;

  -- Mingla food and drink orders.
  v_pass := 0;
  FOR v_row IN
    SELECT vo.id, vo.created_at, vo.pickup_code, vl.name AS title,
           coalesce((SELECT sum(i.quantity)::integer
             FROM public.venue_order_items i
            WHERE i.venue_order_id = vo.id), 0) AS quantity
      FROM public.venue_orders vo
      JOIN public.venue_listings vl ON vl.id = vo.venue_id
     WHERE vo.buyer_user_id IS NOT NULL AND vo.buyer_user_id <> p_user_id
       AND vo.money_path = 'mingla'
       AND vo.payment_status IN ('paid', 'partial_refund', 'refunded')
       AND vo.created_at >= now() - interval '90 days'
       AND (lower(btrim(vo.buyer_email)) = ANY(v_emails)
         OR vo.buyer_phone_e164 = ANY(v_phones))
       AND NOT EXISTS (
         SELECT 1 FROM public.purchase_shared_holders s
          WHERE s.kind = 'venue_order' AND s.source_id = vo.id
            AND s.user_id = p_user_id AND s.revoked_at IS NULL)
       AND public.account_owns_contact(p_user_id, vo.buyer_email, vo.buyer_phone_e164)
     ORDER BY vo.created_at, vo.id
     LIMIT 25
  LOOP
    INSERT INTO public.purchase_shared_holders(kind, source_id, user_id)
    VALUES ('venue_order', v_row.id, p_user_id)
    ON CONFLICT (kind, source_id, user_id) DO UPDATE
      SET revoked_at = NULL, revoked_reason = NULL, reshared_at = now()
      WHERE public.purchase_shared_holders.revoked_at IS NOT NULL;
    v_pass := v_pass + 1;
    v_claimed := v_claimed || jsonb_build_array(jsonb_build_object(
      'kind', 'venue_order', 'id', v_row.id,
      'routeKind', 'venue_order', 'routeId', v_row.id,
      'offeringType', 'food', 'noun', 'receipt',
      'title', v_row.title,
      'orderLabel', CASE WHEN btrim(coalesce(v_row.pickup_code, '')) <> ''
        THEN 'Order #' || v_row.pickup_code
        ELSE 'Order ' || upper(substr(replace(v_row.id::text, '-', ''), 1, 8))
        END,
      'startsAt', v_row.created_at, 'timezone', NULL,
      'venueLine', v_row.title, 'quantity', v_row.quantity,
      'source', 'food', 'sentByFirstName', NULL,
      'chatJoined', NULL, 'conversationId', NULL,
      'role', 'shared', 'sharedWithAnotherAccount', true
    ));
  END LOOP;
  v_more := v_more OR v_pass = 25;

  RETURN jsonb_build_object(
    'claimed', v_claimed,
    'count', jsonb_array_length(v_claimed),
    'more', v_more
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_attendance_by_verified_identity(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_attendance_by_verified_identity(uuid)
  TO service_role;
REVOKE ALL ON FUNCTION public.issue_4473_share_purchases_by_verified_identity(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4473_share_purchases_by_verified_identity(uuid)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 3. The signed-in guest's waitlist places (open ones, plus anything from the
--    last 30 days so a converted or closed place still reads in Purchases).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_my_waitlist_entries()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', w.id,
      'venueId', w.venue_id,
      'venueName', vl.name,
      'brandSlug', b.slug,
      'venueSlug', vl.slug,
      'partySize', w.party_size,
      'desiredDate', w.desired_date,
      'desiredFrom', to_char(w.desired_from, 'HH24:MI'),
      'desiredTo', to_char(w.desired_to, 'HH24:MI'),
      'status', w.status,
      'createdAt', w.created_at,
      -- The venue's zone and the wished-for start in it, so the app shows
      -- the venue's own day and time (day-first, 24-hour).
      'timezone', public.issue_4490_venue_timezone(w.venue_id),
      'startsAt', CASE WHEN w.desired_date IS NULL THEN NULL
        ELSE (w.desired_date + COALESCE(w.desired_from, time '00:00'))
          AT TIME ZONE public.issue_4490_venue_timezone(w.venue_id) END
    ) ORDER BY w.created_at DESC, w.id DESC)
    FROM public.venue_waitlist w
    LEFT JOIN public.venue_listings vl ON vl.id = w.venue_id
    LEFT JOIN public.brands b ON b.id = COALESCE(vl.brand_id, w.brand_id)
    WHERE w.consumer_user_id = v_uid
      AND (w.status IN ('waiting', 'notified') OR w.created_at >= now() - interval '30 days')
  ), '[]'::jsonb);
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4490_my_waitlist_entries() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4490_my_waitlist_entries() TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. The signed-in guest's venue bookings (re-emitted from 20281203194490):
--    bookings paid at the venue are listed too.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_my_offer_bookings()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(public.issue_4490_booking_projection(g.id, NULL) ORDER BY g.created_at DESC, g.id DESC)
    FROM public.stay_reservation_groups g
    WHERE g.offer_kind IS NOT NULL AND g.offer_kind <> 'membership'
      AND (g.user_id = v_uid OR g.booked_by_user_id = v_uid)
  ), '[]'::jsonb);
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4490_my_offer_bookings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4490_my_offer_bookings() TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. The offer sweep (re-emitted from 20281203174490) queues visit reminders.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_offer_sweep(p_limit integer DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 200), 1), 1000);
  v_expired jsonb;
  v_row record;
  v_reminders integer := 0;
  v_overdue integer := 0;
  v_expiring integer := 0;
  v_lapsed integer := 0;
  v_day integer;
  v_inserted integer;
  v_released integer := 0;
  v_deposits integer := 0;
  v_visit_reminders integer := 0;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  -- Lapsed holds: the generic Stays expiry (offer groups included).
  v_expired := to_jsonb(public.issue_1388_expire_groups(v_limit, gen_random_uuid()));
  UPDATE public.venue_space_claims
  SET state = 'released', held_until = NULL, released_at = now(), release_reason = 'hold_lapsed', updated_at = now()
  WHERE state = 'held' AND held_until <= now();
  GET DIAGNOSTICS v_lapsed = ROW_COUNT;

  FOR v_row IN
    SELECT g.id, g.payment_deadline, g.currency_code
    FROM public.stay_reservation_groups g
    WHERE g.offer_kind IS NOT NULL
      AND g.state = 'approved_payment_required'
      AND g.payment_deadline > now()
      AND g.payment_deadline <= now() + interval '12 hours'
    ORDER BY g.payment_deadline
    LIMIT v_limit
    FOR UPDATE OF g SKIP LOCKED
  LOOP
    INSERT INTO public.stay_reservation_events (
      group_id, event_type, actor_type, idempotency_key, safe_metadata
    ) VALUES (
      v_row.id, 'stay_offer_hold_expiring', 'service',
      'hold-expiring:' || v_row.id || ':' || floor(extract(epoch FROM v_row.payment_deadline))::bigint,
      jsonb_build_object('holdUntil', v_row.payment_deadline, 'reason', 'hold_expiring')
    ) ON CONFLICT (group_id, idempotency_key) DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    v_expiring := v_expiring + v_inserted;
  END LOOP;

  FOR v_row IN
    SELECT g.id, g.balance_due_at, g.created_at, g.currency_code, g.venue_id,
           COALESCE(s.balance_reminder_days, '{7,1}'::smallint[]) AS days, m.balance
    FROM public.stay_reservation_groups g
    LEFT JOIN public.venue_booking_settings s ON s.venue_id = g.venue_id
    CROSS JOIN LATERAL public.issue_4490_booking_money(g.id) m
    WHERE g.offer_kind IS NOT NULL
      AND g.state = 'confirmed'
      AND g.balance_due_at IS NOT NULL
      AND g.balance_due_at <= now() + interval '60 days'
      AND g.balance_due_at >= now() - interval '4 days'
      AND m.balance > 0
    ORDER BY g.balance_due_at
    LIMIT v_limit
    FOR UPDATE OF g SKIP LOCKED
  LOOP
    IF now() < v_row.balance_due_at THEN
      SELECT min(d) INTO v_day FROM unnest(v_row.days) d
      WHERE d > 0
        AND now() >= v_row.balance_due_at - make_interval(days => d)
        AND v_row.created_at <= v_row.balance_due_at - make_interval(days => d);
      IF v_day IS NOT NULL THEN
        INSERT INTO public.stay_reservation_events (
          group_id, event_type, actor_type, idempotency_key, safe_metadata
        ) VALUES (
          v_row.id, 'stay_offer_balance_due', 'service', 'balance-reminder:' || v_row.id || ':' || v_day,
          jsonb_build_object('amountMinor', v_row.balance::text, 'currencyCode', v_row.currency_code,
            'balanceDueAt', v_row.balance_due_at, 'reason', 'reminder', 'daysBefore', v_day)
        ) ON CONFLICT (group_id, idempotency_key) DO NOTHING;
        GET DIAGNOSTICS v_inserted = ROW_COUNT;
        v_reminders := v_reminders + v_inserted;
      END IF;
    ELSE
      v_day := CASE WHEN now() >= v_row.balance_due_at + interval '3 days' THEN 3 ELSE 0 END;
      INSERT INTO public.stay_reservation_events (
        group_id, event_type, actor_type, idempotency_key, safe_metadata
      ) VALUES (
        v_row.id, 'stay_offer_balance_overdue', 'service', 'balance-overdue:' || v_row.id || ':' || v_day,
        jsonb_build_object('amountMinor', v_row.balance::text, 'currencyCode', v_row.currency_code,
          'balanceDueAt', v_row.balance_due_at, 'reason', 'overdue', 'daysAfter', v_day)
      ) ON CONFLICT (group_id, idempotency_key) DO NOTHING;
      GET DIAGNOSTICS v_inserted = ROW_COUNT;
      v_overdue := v_overdue + v_inserted;
    END IF;
  END LOOP;
  -- #4490 P5: by the hour: release a booking nobody checked in for N minutes
  -- after its start (the place frees; no refund unless the policy gives one).
  FOR v_row IN
    SELECT g.id, w.starts_at, o.no_show_release_minutes AS release_minutes
    FROM public.stay_reservation_groups g
    JOIN LATERAL (SELECT l.* FROM public.stay_reservation_lines l WHERE l.group_id = g.id
                  ORDER BY l.created_at, l.id LIMIT 1) l ON true
    JOIN public.stay_offerings o ON o.id = l.offering_id
    JOIN public.stay_place_windows w ON w.id = public.issue_4490_line_window_id(l.id)
    JOIN public.venue_passes p ON p.group_id = g.id
    WHERE g.offer_kind = 'by_the_hour' AND g.state = 'confirmed'
      AND o.no_show_release_minutes IS NOT NULL
      AND p.status = 'valid' AND p.admitted_count = 0
      AND now() >= w.starts_at + make_interval(mins => o.no_show_release_minutes)
      AND EXISTS (SELECT 1 FROM public.stay_inventory_commitments c WHERE c.group_id = g.id AND c.state = 'active')
    ORDER BY w.starts_at
    LIMIT v_limit
    FOR UPDATE OF g SKIP LOCKED
  LOOP
    UPDATE public.stay_inventory_commitments
    SET state = 'released', released_at = now(), release_reason = 'no_show'
    WHERE group_id = v_row.id AND state = 'active';
    UPDATE public.venue_passes SET status = 'void', version = version + 1, updated_at = now()
    WHERE group_id = v_row.id AND status = 'valid';
    INSERT INTO public.stay_reservation_events (
      group_id, event_type, actor_type, idempotency_key, safe_metadata
    ) VALUES (
      v_row.id, 'stay_offer_no_show_released', 'service', 'no-show-release:' || v_row.id,
      jsonb_build_object('startsAt', v_row.starts_at, 'releaseMinutes', v_row.release_minutes)
    ) ON CONFLICT (group_id, idempotency_key) DO NOTHING;
    v_released := v_released + 1;
  END LOOP;
  -- #4490 P4 follow-up: return a hire's damage deposit N days after it ended
  -- unless the venue is holding it (a claim).
  FOR v_row IN
    SELECT g.id
    FROM public.stay_reservation_groups g
    LEFT JOIN public.venue_booking_settings s ON s.venue_id = g.venue_id
    WHERE g.offer_kind = 'private_hire' AND g.state IN ('confirmed', 'partially_cancelled')
      AND (public.issue_4490_damage_deposit_state(g.id)->>'status') = 'collected'
      AND (public.issue_4490_damage_deposit_state(g.id)->>'releaseAt')::timestamptz <= now()
    ORDER BY g.created_at
    LIMIT v_limit
    FOR UPDATE OF g SKIP LOCKED
  LOOP
    PERFORM public.issue_4490_release_damage_internal(v_row.id, 'system', NULL, 0, NULL, 'sweep-release-' || v_row.id);
    v_deposits := v_deposits + 1;
  END LOOP;
  -- #4490 Explorer W2: "your visit is soon" reminders, a day before and two
  -- hours before the first slice starts (venue time is carried by the
  -- window's own timestamp; a multi-day pass is reminded for its first day
  -- only). Live bookings only (confirmed, or partly cancelled with guests
  -- still confirmed); once each per booking time: the outbox key carries the
  -- slice start, so a booking moved to a new time is reminded again for the
  -- new time and never twice for the same one. Never late: a reminder whose
  -- moment had already passed when the booking was made, confirmed or last
  -- moved, or that the next reminder has overtaken, is skipped; the
  -- day-before one is never queued for a visit on the venue's own today.
  -- Fair across runs: only bookings whose due reminder is not queued yet and
  -- that have somewhere to send it are taken, soonest start first, so each
  -- run moves on to the next p_limit bookings and none is starved. Worst
  -- case with a backlog of N due reminders: they drain p_limit per run,
  -- soonest visit first; a day-before reminder still waiting when the
  -- two-hour mark arrives is replaced by the two-hour one.
  IF public.issue_4490_flag_on('VENUE_VISIT_REMINDERS') THEN
    FOR v_row IN
      SELECT g.id, g.user_id, g.brand_id, g.venue_id, g.public_reference, g.offer_kind,
             g.currency_code, g.guest_snapshot, s.starts_at, d.v_when, k.v_key,
             NULLIF(lower(btrim(COALESCE(g.guest_snapshot->>'email', ''))), '') AS v_email
      FROM public.stay_reservation_groups g
      CROSS JOIN LATERAL (
        SELECT min(w.starts_at) AS starts_at
        FROM public.stay_reservation_lines l
        JOIN public.stay_place_windows w ON w.id = public.issue_4490_line_window_id(l.id)
        WHERE l.group_id = g.id AND l.state = 'confirmed'
      ) s
      CROSS JOIN LATERAL (
        -- W2-N13: "booked" is the latest of when the booking was made, when
        -- it became confirmed (a request approved and paid, a payment
        -- finalized late) and its last date move.
        SELECT GREATEST(g.created_at,
          COALESCE((
            SELECT max(e.created_at) FROM public.stay_reservation_events e
            WHERE e.group_id = g.id AND e.event_type = 'stay_reservation_confirmed'), g.created_at),
          COALESCE((
            SELECT max(e.created_at) FROM public.stay_reservation_events e
            WHERE e.group_id = g.id AND e.event_type = 'stay_offer_changed'
              AND e.safe_metadata->>'action' = 'move_date'), g.created_at)) AS booked_at,
          public.issue_4490_venue_timezone(g.venue_id) AS tz
      ) b
      CROSS JOIN LATERAL (
        SELECT CASE
          WHEN now() >= s.starts_at - interval '2 hours'
            THEN CASE WHEN b.booked_at <= s.starts_at - interval '2 hours' THEN '2h' END
          -- The day-before message says "tomorrow": never for a visit on the
          -- venue's own today (a backlog, a switch turned on late).
          WHEN b.booked_at <= s.starts_at - interval '24 hours'
            AND (s.starts_at AT TIME ZONE b.tz)::date > (now() AT TIME ZONE b.tz)::date THEN '24h'
        END AS v_when
      ) d
      CROSS JOIN LATERAL (
        SELECT 'venue_visit_reminder:' || g.id || ':' || d.v_when || ':'
               || floor(extract(epoch FROM s.starts_at))::bigint AS v_key
      ) k
      WHERE g.offer_kind IS NOT NULL AND g.offer_kind <> 'membership'
        AND g.state IN ('confirmed', 'partially_cancelled')
        AND s.starts_at > now()
        AND s.starts_at <= now() + interval '24 hours'
        AND d.v_when IS NOT NULL
        AND (g.user_id IS NOT NULL
          OR NULLIF(btrim(COALESCE(g.guest_snapshot->>'email', '')), '') IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM public.notification_outbox o WHERE o.idempotency_key = k.v_key)
      ORDER BY s.starts_at, g.id
      LIMIT v_limit
    LOOP
      INSERT INTO public.notification_outbox (
        category_key, user_id, contact, brand_id, payload, idempotency_key, country_code
      ) VALUES (
        'venue_visit_reminder', v_row.user_id, v_row.v_email, v_row.brand_id,
        jsonb_build_object(
          'venue_group_id', v_row.id,
          'public_reference', v_row.public_reference,
          'venue_id', v_row.venue_id,
          'offer_kind', v_row.offer_kind,
          'currency', v_row.currency_code,
          'starts_at', v_row.starts_at,
          'reminder_reason', v_row.v_when),
        v_row.v_key, NULL
      ) ON CONFLICT (idempotency_key) DO NOTHING;
      GET DIAGNOSTICS v_inserted = ROW_COUNT;
      v_visit_reminders := v_visit_reminders + v_inserted;
    END LOOP;
  END IF;
  RETURN jsonb_build_object('expired', v_expired, 'reminders', v_reminders, 'overdue', v_overdue,
    'holdExpiring', v_expiring, 'lapsedClaims', v_lapsed, 'noShowReleased', v_released,
    'depositsReleased', v_deposits, 'visitReminders', v_visit_reminders);
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4490_offer_sweep(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4490_offer_sweep(integer) TO service_role;

COMMIT;
