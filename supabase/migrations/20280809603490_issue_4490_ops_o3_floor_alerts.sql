-- Issue #4490, spec 08 O3 part A2 (running the floor): floor alerts.
--
--  * T4  issue_4490_venue_floor_user_ids: the venue_staff members of a brand
--        with a grant AT ONE VENUE holding any of the given capabilities
--        (Kitchen / bar logins, Till devices). venueOrderNotify adds them to
--        "New order" and escalation rung 1 for that venue only.
--  * T5  notification category business.venue_order_ready (registered like
--        business.venue_order_placed): "Ready · {destination}" to the person who
--        sent a Till round (and the check's server).
--  * T5/T6/T7 the Till's check projection carries each menu round's sent and
--        accepted times and its station tickets, so the Till shows "Ready {time}",
--        "Not accepted · {n} min", "Ready to take out · …" and "Nobody has
--        accepted …".
--  * T7  pg_venue_order_escalation_scan re-emitted from its LATEST body
--        (20270319001846) with a second arm: a sent Till round
--        (venue_collected, source staff, sent_at set, no carrier) that nobody
--        accepted, clock coalesce(sent_at, created_at), same rungs and timings.
--        The Mingla-money arm is byte-for-byte the same condition and clock
--        (proved on a clone: same rows before and after). Held rounds are never
--        `placed`; rounds for stations without a screen are delivered at send;
--        legacy order-pad rounds (no sent_at) keep today's behaviour (no
--        escalation). Its write surface is still escalation_level + escalated_at.
--  * T7  "Print ticket" on the Till: a seller may print a Till round's kitchen
--        ticket (floor_pdf_source, station_mark_printed re-emitted from 601490).
-- No venue_id column (the #2099 seal is unchanged). Static SQL.

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE FUNCTION pg_temp.issue_4490_o3a2_patch(
  p_sig regprocedure,
  p_old text,
  p_new text,
  p_count integer DEFAULT 1
)
RETURNS void
LANGUAGE plpgsql
AS $patch$
DECLARE
  v_def text := pg_get_functiondef(p_sig);
  v_old_count integer;
BEGIN
  v_old_count := (length(v_def) - length(replace(v_def, p_old, ''))) / length(p_old);
  IF v_old_count <> p_count THEN
    RAISE EXCEPTION 'issue_4490 O3A2 patch precondition failed for %: old % (expected %)',
      p_sig, v_old_count, p_count;
  END IF;
  EXECUTE replace(v_def, p_old, p_new);
END;
$patch$;

-- ---------------------------------------------------------------------------
-- 1. T4: floor staff at one venue.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_venue_floor_user_ids(
  p_brand_id uuid,
  p_venue_id uuid,
  p_caps text[]
)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT COALESCE(array_agg(DISTINCT m.user_id ORDER BY m.user_id), '{}'::uuid[])
  FROM public.brand_team_members m
  JOIN public.brand_team_member_venue_grants g ON g.member_id = m.id
  JOIN public.venue_listings v ON v.id = g.venue_id AND v.brand_id = m.brand_id
  WHERE m.brand_id = p_brand_id
    AND g.venue_id = p_venue_id
    AND m.role = 'venue_staff'
    AND m.accepted_at IS NOT NULL
    AND m.removed_at IS NULL
    AND m.user_id IS NOT NULL
    AND g.capabilities && COALESCE(p_caps, '{}'::text[]);
$function$;

-- ---------------------------------------------------------------------------
-- 2. T5: the "ready" push type, registered like business.venue_order_placed.
-- ---------------------------------------------------------------------------
INSERT INTO public.notification_categories
  (key, section, is_transactional, urgency, default_channels, reach_mode)
VALUES
  ('business.venue_order_ready', 'Venue orders', true, 'high', ARRAY['inapp', 'push'], 'reach_once')
ON CONFLICT (key) DO UPDATE SET
  section = EXCLUDED.section,
  is_transactional = EXCLUDED.is_transactional,
  urgency = EXCLUDED.urgency,
  default_channels = EXCLUDED.default_channels,
  reach_mode = EXCLUDED.reach_mode,
  active = true;

-- ---------------------------------------------------------------------------
-- 3. The Till's check: each menu round's sent / accepted times and its
--    station tickets (a station with live lines and its ticket state).
-- ---------------------------------------------------------------------------
SELECT pg_temp.issue_4490_o3a2_patch(
  'public.issue_4490_till_sale_projection(uuid)'::regprocedure,
  $old$'fulfillmentStatus', o.fulfillment_status, 'pickupCode', o.pickup_code,$old$,
  $new$'fulfillmentStatus', o.fulfillment_status, 'pickupCode', o.pickup_code,
          'sentAt', o.sent_at, 'acknowledgedAt', o.acknowledged_at, 'currentLabel', o.current_label,
          'stationTickets', CASE WHEN l.kind = 'menu_round' THEN COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'station', st.station, 'acceptedAt', t.accepted_at, 'readyAt', t.ready_at,
                'pickedUpAt', t.picked_up_at)
              ORDER BY st.station)
            FROM (SELECT DISTINCT i2.station FROM public.venue_order_items i2
                  WHERE i2.venue_order_id = o.id AND i2.station IS NOT NULL AND i2.prep_state <> 'voided') st
            LEFT JOIN public.venue_station_tickets t ON t.venue_order_id = o.id AND t.station = st.station),
            '[]'::jsonb) END,$new$
);

-- ---------------------------------------------------------------------------
-- 4. T7: the escalation scan, re-emitted from 20270319001846 with the Till arm.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pg_venue_order_escalation_scan(
  p_now   timestamptz DEFAULT now(),
  p_limit int DEFAULT 50
) RETURNS TABLE (
  order_id            uuid,
  brand_id            uuid,
  venue_id            uuid,
  venue_name          text,
  rung                smallint,
  spot_label          text,
  pickup_code         text,
  buyer_name          text,
  currency            text,
  total_cents         int,
  placed_at           timestamptz,
  unacked_seconds     int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF current_user NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH due AS (
    SELECT o.id,
           k.clock_at AS paid_at,
           CASE
             WHEN p_now - k.clock_at >= interval '10 minutes' THEN 3
             WHEN p_now - k.clock_at >= interval '5 minutes'  THEN 2
             ELSE 1
           END::smallint AS target
      FROM public.venue_orders o
      -- #1846 M-1: Mingla money starts at PAYMENT (confirmed_at). #4490 T7: a
      -- Till round starts when it was SENT to the kitchen.
      CROSS JOIN LATERAL (
        SELECT CASE WHEN o.money_path = 'mingla'
                    THEN coalesce(o.confirmed_at, o.created_at)
                    ELSE coalesce(o.sent_at, o.created_at) END AS clock_at
      ) k
     WHERE o.acknowledged_at IS NULL
       AND o.fulfillment_status = 'placed'
       AND (
         -- M-2: Mingla is holding this money (unchanged arm).
         (o.payment_status = 'paid' AND o.money_path = 'mingla')
         -- #4490 spec 08 §11 T7: a sent Till round nobody accepted. A held
         -- round is never 'placed'; a round for a station with no screen is
         -- delivered at send; an order-pad round has no sent_at.
         OR (o.money_path = 'venue_collected' AND o.source = 'staff'
             AND o.sent_at IS NOT NULL AND o.till_payment_id IS NULL)
       )
       AND p_now - k.clock_at >= interval '2 minutes'
       AND o.escalation_level < CASE
             WHEN p_now - k.clock_at >= interval '10 minutes' THEN 3
             WHEN p_now - k.clock_at >= interval '5 minutes'  THEN 2
             ELSE 1
           END
     ORDER BY k.clock_at
     LIMIT greatest(1, coalesce(p_limit, 50))
     FOR UPDATE OF o SKIP LOCKED
  ), claimed AS (
    UPDATE public.venue_orders o
       SET escalation_level = due.target,
           escalated_at = p_now
      FROM due
     WHERE o.id = due.id
    RETURNING o.id, o.brand_id, o.venue_id, o.spot_label_at_order, o.pickup_code,
              o.buyer_name, o.currency, o.total_cents,
              due.paid_at AS paid_at, due.target AS target
  )
  SELECT c.id, c.brand_id, c.venue_id,
         coalesce(v.name, 'your venue')::text,
         c.target,
         c.spot_label_at_order, c.pickup_code, c.buyer_name,
         c.currency, c.total_cents, c.paid_at,
         extract(epoch FROM (p_now - c.paid_at))::int
    FROM claimed c
    LEFT JOIN public.venue_listings v ON v.id = c.venue_id
   ORDER BY c.paid_at;
END;
$function$;

COMMENT ON FUNCTION public.pg_venue_order_escalation_scan(timestamptz, int) IS
  'SPEC #1788 P-55, corrected at #1846 M-1/M-2, widened at #4490 spec 08 T7 — '
  'the unacknowledged-order ladder. Mingla money: the clock starts at PAYMENT '
  '(confirmed_at). A sent Till round (venue-collected, staff, sent_at set) that '
  'nobody accepted: the clock starts at sent_at. Its ENTIRE write surface is '
  'still escalation_level + escalated_at: it never refunds, never cancels, '
  'never pauses a venue, and never sends an SMS.';

REVOKE ALL ON FUNCTION public.pg_venue_order_escalation_scan(timestamptz, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pg_venue_order_escalation_scan(timestamptz, int)
  FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pg_venue_order_escalation_scan(timestamptz, int)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 5. T7: a seller may print a Till round's ticket (re-emitted from 601490).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_floor_pdf_source(
  p_kind text,
  p_venue_id uuid,
  p_order_id uuid,
  p_station text,
  p_payment_id uuid,
  p_actor uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_venue public.venue_listings%ROWTYPE;
  v_order public.venue_orders%ROWTYPE;
  v_tz text;
  v_base jsonb;
  v_receipt jsonb;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_kind = 'day_close' THEN
    RAISE EXCEPTION 'floor_pdf_kind_not_ready' USING ERRCODE = '22023';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('kitchen_ticket', 'receipt', 'test_ticket') THEN
    RAISE EXCEPTION 'floor_pdf_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_venue FROM public.venue_listings WHERE id = p_venue_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'venue_not_found' USING ERRCODE = 'P0002';
  END IF;
  v_tz := public.issue_4490_venue_timezone(v_venue.id);
  v_base := jsonb_build_object(
    'kind', p_kind, 'venueId', v_venue.id, 'brandId', v_venue.brand_id, 'venueName', v_venue.name,
    'timezone', v_tz,
    'paper', COALESCE((SELECT s.print_paper FROM public.venue_till_settings s WHERE s.venue_id = v_venue.id), 'a4'),
    'printedAtLocal', to_char(now() AT TIME ZONE v_tz, 'DD/MM/YYYY HH24:MI'));

  IF p_kind IN ('kitchen_ticket', 'test_ticket') THEN
    IF NOT public.issue_4490_stations_enabled(v_venue.id) THEN
      RAISE EXCEPTION 'stations_not_enabled' USING ERRCODE = 'P0001';
    END IF;
    -- O3 part A2 (T7): a seller may print a Till round's ticket from the
    -- Till ("Nobody has accepted … · Print ticket"); everything else needs
    -- kitchen rights.
    IF NOT public.issue_4490_can_kitchen(v_venue.id, p_actor)
       AND NOT (p_kind = 'kitchen_ticket' AND public.issue_4490_can_sell(v_venue.id, p_actor)
                AND EXISTS (SELECT 1 FROM public.venue_orders so
                            WHERE so.id = p_order_id AND so.source = 'staff' AND so.venue_id = v_venue.id)) THEN
      RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
    END IF;
    IF p_kind = 'test_ticket' THEN
      IF p_station IS NULL OR p_station NOT IN ('kitchen', 'bar', 'all') THEN
        RAISE EXCEPTION 'floor_pdf_invalid' USING ERRCODE = '22023';
      END IF;
      RETURN v_base || jsonb_build_object('station', p_station);
    END IF;
    IF p_station IS NULL OR p_station NOT IN ('kitchen', 'bar') THEN
      RAISE EXCEPTION 'floor_pdf_invalid' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_order FROM public.venue_orders WHERE id = p_order_id;
    IF NOT FOUND OR v_order.venue_id <> v_venue.id OR NOT public.issue_4490_station_order_visible(v_order)
       OR NOT EXISTS (SELECT 1 FROM public.venue_order_items i
                      WHERE i.venue_order_id = v_order.id AND i.station = p_station) THEN
      RAISE EXCEPTION 'floor_pdf_not_found' USING ERRCODE = 'P0002';
    END IF;
    RETURN v_base || jsonb_build_object(
      'station', p_station,
      'sentAtLocal', to_char(COALESCE(v_order.sent_at, v_order.confirmed_at, v_order.created_at) AT TIME ZONE v_tz,
                             'HH24:MI'),
      'ticket', public.issue_4490_station_ticket_projection(v_order.id, p_station));
  END IF;

  -- receipt
  IF NOT public.issue_4490_till_enabled(v_venue.id) THEN
    RAISE EXCEPTION 'till_not_enabled' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.issue_4490_can_sell(v_venue.id, p_actor) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.venue_till_payments p
                 JOIN public.venue_till_sales s ON s.id = p.sale_id
                 WHERE p.id = p_payment_id AND s.venue_id = v_venue.id) THEN
    RAISE EXCEPTION 'floor_pdf_not_found' USING ERRCODE = 'P0002';
  END IF;
  v_receipt := public.issue_4490_till_receipt_projection(p_payment_id);
  IF v_receipt IS NULL THEN
    RAISE EXCEPTION 'floor_pdf_not_ready' USING ERRCODE = 'PT409';
  END IF;
  RETURN v_base || jsonb_build_object(
    'receipt', v_receipt,
    'paidAtLocal', to_char((v_receipt->>'paidAt')::timestamptz AT TIME ZONE v_tz, 'DD/MM/YYYY HH24:MI'));
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_station_mark_printed(p_order_id uuid, p_station text, p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_order public.venue_orders%ROWTYPE;
BEGIN
  -- O3 part A2: a seller's Till print counts too (the PDF source checked the rights).
  v_order := public.issue_4490_station_lock(p_order_id, p_station, p_actor, true);
  UPDATE public.venue_station_tickets
  SET printed_count = printed_count + 1, last_printed_at = now(), updated_at = now()
  WHERE venue_order_id = v_order.id AND station = p_station;
  UPDATE public.venue_orders SET station_rev = station_rev + 1, updated_at = now() WHERE id = v_order.id;
  RETURN jsonb_build_object('ticket', public.issue_4490_station_ticket_projection(v_order.id, p_station));
END;
$function$;

REVOKE ALL ON FUNCTION
  public.issue_4490_venue_floor_user_ids(uuid, uuid, text[]),
  public.issue_4490_floor_pdf_source(text, uuid, uuid, text, uuid, uuid),
  public.issue_4490_station_mark_printed(uuid, text, uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.issue_4490_venue_floor_user_ids(uuid, uuid, text[]),
  public.issue_4490_floor_pdf_source(text, uuid, uuid, text, uuid, uuid),
  public.issue_4490_station_mark_printed(uuid, text, uuid)
TO service_role;

COMMIT;
