-- Issue #4490, spec 08 O3 (running the floor), part A: kitchen and bar
-- stations and printed floor PDFs.
--
-- Spec slot "Migration 49" sorts after the O1 and O2 migrations it builds on
-- (20281203534490..20281203574490), as 20281203584490.
--
-- What it adds:
--  * venue_order_items.station (kitchen | bar), fired_at, ready_at,
--    ready_by_user_id, and a BEFORE INSERT trigger that fills station from
--    menu_items.prep_station (NULL/other -> the venue's default station, else
--    kitchen), so guest QR/page orders and Till rounds route the same way.
--  * venue_station_tickets: one row per (order, station) once a station acts
--    on it (accepted, ready, picked up, printed). Ticket state lives here;
--    the line state lives on venue_order_items.
--  * Service-only RPCs for the station board and its actions (accept, one
--    item ready, ticket ready, recall to cooking, picked up, printed). Each
--    bumps venue_orders.station_rev so the one published table carries every
--    item-level change to every screen (spec 08 §11 T6). Accept, ticket ready
--    and picked up are idempotent (T14).
--  * The Till's send marks lines for stations without a screen ready and
--    picked up at once; a round with no screened station goes straight to
--    delivered, acknowledged by the person who sent it (T8).
--  * Private storage bucket venue-floor-pdfs (no public read; the service
--    role writes; 60-second signed URLs only) and a ledger of the objects so
--    venue-offer-sweep deletes them after 24 hours.
--
-- Gate: stations work only when the release switch VENUE_TILL is on AND the
-- venue's `kitchen_screens` feature is on (the station feature, spec 08 §3 O1).
-- Receipt PDFs follow the Till's own gate (VENUE_TILL AND `till`).
-- Held Till rounds, Till payment carriers, tab settlements and unpaid guest
-- checkouts never reach a station (spec 08 §11 T1/T2).
-- No venue_id column is added (the #2099 seal is unchanged).
-- Static SQL. Local stack only until Seth approves a production migration.

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. The station gate and a person's display name on floor screens.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_stations_enabled(p_venue_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT public.issue_4490_flag_on('VENUE_TILL')
    AND public.issue_4490_venue_feature_on(p_venue_id, 'kitchen_screens');
$function$;

-- A Till device acting as itself shows as "Kitchen screen" (spec 08 §3 O3).
CREATE OR REPLACE FUNCTION public.issue_4490_floor_person_name(p_user_id uuid, p_venue_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT CASE
    WHEN p_user_id IS NULL THEN NULL
    WHEN public.issue_4490_is_till_device(p_venue_id, p_user_id) THEN 'Kitchen screen'
    ELSE (
      SELECT COALESCE(
        NULLIF(btrim(ca.display_name), ''),
        NULLIF(btrim(p.display_name), ''),
        NULLIF(btrim(concat_ws(' ', NULLIF(btrim(p.first_name), ''), NULLIF(btrim(p.last_name), ''))), ''))
      FROM (SELECT 1) one
      LEFT JOIN public.creator_accounts ca ON ca.id = p_user_id AND ca.deleted_at IS NULL
      LEFT JOIN public.profiles p ON p.id = p_user_id)
  END;
$function$;

-- ---------------------------------------------------------------------------
-- 2. Lines carry their station.
-- ---------------------------------------------------------------------------
ALTER TABLE public.venue_order_items
  ADD COLUMN station text NULL CHECK (station IS NULL OR station IN ('kitchen', 'bar')),
  ADD COLUMN fired_at timestamptz NULL,
  ADD COLUMN ready_at timestamptz NULL,
  ADD COLUMN ready_by_user_id uuid NULL,
  ADD CONSTRAINT venue_order_items_ready_shape CHECK ((ready_at IS NULL) = (ready_by_user_id IS NULL));

-- The station a menu item goes to at a venue: its own prep station, else the
-- venue's default station (Settings › Selling in person), else the kitchen.
CREATE OR REPLACE FUNCTION public.issue_4490_item_station(p_menu_item_id uuid, p_venue_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT CASE
    WHEN mi.prep_station IN ('kitchen', 'bar') THEN mi.prep_station
    ELSE COALESCE((SELECT s.default_station FROM public.venue_till_settings s WHERE s.venue_id = p_venue_id),
                  'kitchen')
  END
  FROM (SELECT 1) one
  LEFT JOIN public.menu_items mi ON mi.id = p_menu_item_id;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_order_item_station()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.station IS NULL THEN
    NEW.station := public.issue_4490_item_station(
      NEW.menu_item_id,
      (SELECT o.venue_id FROM public.venue_orders o WHERE o.id = NEW.venue_order_id));
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER issue_4490_order_item_station
  BEFORE INSERT ON public.venue_order_items
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_order_item_station();

-- Existing lines get their station too (a board opened right after the
-- migration shows orders already in the queue).
UPDATE public.venue_order_items i
SET station = public.issue_4490_item_station(i.menu_item_id, o.venue_id)
FROM public.venue_orders o
WHERE o.id = i.venue_order_id AND i.station IS NULL;

-- ---------------------------------------------------------------------------
-- 3. Station tickets.
-- ---------------------------------------------------------------------------
CREATE TABLE public.venue_station_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_order_id uuid NOT NULL REFERENCES public.venue_orders(id) ON DELETE CASCADE,
  station text NOT NULL CHECK (station IN ('kitchen', 'bar')),
  accepted_at timestamptz NULL,
  accepted_by_user_id uuid NULL,
  ready_at timestamptz NULL,
  ready_by_user_id uuid NULL,
  picked_up_at timestamptz NULL,
  picked_up_by_user_id uuid NULL,
  printed_count integer NOT NULL DEFAULT 0 CHECK (printed_count >= 0),
  last_printed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (venue_order_id, station),
  CONSTRAINT venue_station_tickets_accept_shape CHECK ((accepted_at IS NULL) = (accepted_by_user_id IS NULL)),
  CONSTRAINT venue_station_tickets_ready_shape CHECK ((ready_at IS NULL) = (ready_by_user_id IS NULL)),
  CONSTRAINT venue_station_tickets_pickup_shape CHECK ((picked_up_at IS NULL) = (picked_up_by_user_id IS NULL)),
  CONSTRAINT venue_station_tickets_ready_after_accept CHECK (ready_at IS NULL OR accepted_at IS NOT NULL),
  CONSTRAINT venue_station_tickets_pickup_after_ready CHECK (picked_up_at IS NULL OR ready_at IS NOT NULL)
);
COMMENT ON TABLE public.venue_station_tickets IS
  '#4490 spec 08 O3: one station''s part of an order (accepted, ready, picked up, printed). Written only by the issue_4490_station_* RPCs.';

ALTER TABLE public.venue_station_tickets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.venue_station_tickets FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.venue_station_tickets TO authenticated;
GRANT ALL ON public.venue_station_tickets TO service_role;
-- Whoever may read the order (venue_orders RLS, incl. spec 08 §11 T3 floor
-- staff) may read its station tickets.
CREATE POLICY "venue station tickets order readers" ON public.venue_station_tickets
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.venue_orders o WHERE o.id = venue_station_tickets.venue_order_id));

-- ---------------------------------------------------------------------------
-- 4. Floor PDFs: private bucket + a ledger the sweep deletes from.
-- ---------------------------------------------------------------------------
DO $bucket$
BEGIN
  -- The CI Postgres baseline ships a stripped storage schema (same guard as
  -- 20270305011789): on the real project the INSERT runs with public = false.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'storage' AND table_name = 'buckets' AND column_name = 'public'
  ) THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('venue-floor-pdfs', 'venue-floor-pdfs', false, 6 * 1024 * 1024, ARRAY['application/pdf'])
    ON CONFLICT (id) DO NOTHING;
  END IF;
END
$bucket$;

CREATE TABLE public.venue_floor_pdfs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('kitchen_ticket', 'receipt', 'test_ticket', 'day_close')),
  object_path text NOT NULL UNIQUE CHECK (object_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.pdf$'),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL
);
CREATE INDEX venue_floor_pdfs_due_idx ON public.venue_floor_pdfs (created_at) WHERE deleted_at IS NULL;
COMMENT ON TABLE public.venue_floor_pdfs IS
  '#4490 spec 08 O3: every floor PDF written to the private venue-floor-pdfs bucket; venue-offer-sweep deletes each object after 24 hours.';
ALTER TABLE public.venue_floor_pdfs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.venue_floor_pdfs FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.venue_floor_pdfs TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Reading tickets.
-- ---------------------------------------------------------------------------
-- An order a station may see: never a held round, a carrier, a tab settlement
-- or an unpaid guest checkout (the queue rule, spec 08 §11 T2).
CREATE OR REPLACE FUNCTION public.issue_4490_station_order_visible(p_order public.venue_orders)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT p_order.fulfillment_status NOT IN ('held', 'payment_only')
    AND p_order.till_payment_id IS NULL
    AND COALESCE(p_order.metadata->>'tab_settlement', '') <> 'true'
    AND (p_order.money_path = 'venue_collected'
         OR p_order.payment_status IN ('paid', 'partial_refund', 'refunded'));
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_station_ticket_projection(p_order_id uuid, p_station text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT jsonb_build_object(
    'orderId', o.id,
    'station', p_station,
    'ticketNo', upper(left(replace(o.id::text, '-', ''), 4)),
    'destination', COALESCE(
      NULLIF(btrim(o.current_label), ''),
      NULLIF(btrim(o.spot_label_at_order), ''),
      CASE WHEN o.pickup_code IS NOT NULL THEN
        'Pickup ' || o.pickup_code
        || COALESCE(' · ' || NULLIF(btrim(COALESCE(ts.check_label, o.buyer_name)), ''), '')
      END,
      NULLIF(btrim(ts.check_label), ''),
      'Counter'),
    'movedFrom', CASE WHEN NULLIF(btrim(o.current_label), '') IS NOT NULL
                       AND NULLIF(btrim(o.spot_label_at_order), '') IS NOT NULL
                       AND o.current_label <> o.spot_label_at_order
                      THEN o.spot_label_at_order END,
    'guestOrder', o.source <> 'staff',
    'sellerName', CASE WHEN o.source = 'staff'
                       THEN public.issue_4490_floor_person_name(o.taken_by_user_id, o.venue_id) END,
    'sentAt', COALESCE(o.sent_at, o.confirmed_at, o.created_at),
    'orderStatus', o.fulfillment_status,
    'stationRev', o.station_rev,
    'state', CASE
      WHEN o.fulfillment_status IN ('cancelled', 'refunded')
           OR NOT EXISTS (SELECT 1 FROM public.venue_order_items i
                          WHERE i.venue_order_id = o.id AND i.station = p_station
                            AND i.prep_state <> 'voided') THEN 'voided'
      WHEN t.picked_up_at IS NOT NULL OR o.fulfillment_status = 'delivered' THEN 'done'
      WHEN t.ready_at IS NOT NULL THEN 'ready'
      WHEN t.accepted_at IS NOT NULL THEN 'cooking'
      ELSE 'new'
    END,
    'acceptedAt', t.accepted_at,
    'acceptedByName', public.issue_4490_floor_person_name(t.accepted_by_user_id, o.venue_id),
    'readyAt', t.ready_at,
    'readyByName', public.issue_4490_floor_person_name(t.ready_by_user_id, o.venue_id),
    'pickedUpAt', t.picked_up_at,
    'printedCount', COALESCE(t.printed_count, 0),
    'lastPrintedAt', t.last_printed_at,
    'tellName', CASE WHEN o.source = 'staff' THEN public.issue_4490_floor_person_name(
                       COALESCE(ts.server_user_id, o.taken_by_user_id), o.venue_id) END,
    'lines', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
          'itemId', i.id, 'name', i.item_name_at_order, 'quantity', i.quantity, 'notes', i.notes,
          'prepState', i.prep_state, 'voided', i.prep_state = 'voided', 'voidedAt', i.voided_at,
          'voidedByName', public.issue_4490_floor_person_name(i.voided_by_user_id, o.venue_id),
          'readyAt', i.ready_at,
          'modifiers', COALESCE((SELECT jsonb_agg(m.modifier_name_at_order ORDER BY m.modifier_name_at_order)
                                 FROM public.venue_order_item_modifiers m WHERE m.venue_order_item_id = i.id),
                                '[]'::jsonb))
        ORDER BY i.line_no)
      FROM public.venue_order_items i
      WHERE i.venue_order_id = o.id AND i.station = p_station), '[]'::jsonb)
  )
  FROM public.venue_orders o
  LEFT JOIN public.venue_station_tickets t ON t.venue_order_id = o.id AND t.station = p_station
  LEFT JOIN public.venue_till_sales ts ON ts.session_id = o.session_id
  WHERE o.id = p_order_id;
$function$;

-- The board: every live ticket for the station(s) at a venue, oldest first.
-- Voided tickets stay 15 minutes (struck through, "Voided by …").
CREATE OR REPLACE FUNCTION public.issue_4490_station_board(p_venue_id uuid, p_station text, p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_venue public.venue_listings%ROWTYPE;
  v_stations text[];
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_station NOT IN ('kitchen', 'bar', 'all') THEN
    RAISE EXCEPTION 'station_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_venue FROM public.venue_listings WHERE id = p_venue_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'venue_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.issue_4490_stations_enabled(p_venue_id) THEN
    RAISE EXCEPTION 'stations_not_enabled' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.issue_4490_can_kitchen(p_venue_id, p_actor) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  v_stations := CASE p_station WHEN 'all' THEN ARRAY['kitchen', 'bar'] ELSE ARRAY[p_station] END;
  RETURN jsonb_build_object(
    'venueId', v_venue.id,
    'venueName', v_venue.name,
    'brandId', v_venue.brand_id,
    'station', p_station,
    'timezone', public.issue_4490_venue_timezone(v_venue.id),
    'serverNow', now(),
    'settings', (SELECT jsonb_build_object(
        'targetMinutes', x->'targetMinutes', 'printPaper', x->'printPaper',
        'screenStations', x->'screenStations', 'defaultStation', x->'defaultStation')
      FROM public.issue_4490_till_settings_projection(p_venue_id) x),
    'noStationItems', (SELECT count(*) FROM public.menu_items mi
                       JOIN public.menus m ON m.id = mi.menu_id
                       WHERE m.venue_id = p_venue_id AND m.is_active AND mi.is_available
                         AND (mi.prep_station IS NULL OR mi.prep_station NOT IN ('kitchen', 'bar'))),
    'tickets', COALESCE((
      SELECT jsonb_agg(x.ticket ORDER BY x.sent_at, x.order_id, x.station)
      FROM (
        SELECT DISTINCT o.id AS order_id, i.station,
               COALESCE(o.sent_at, o.confirmed_at, o.created_at) AS sent_at,
               public.issue_4490_station_ticket_projection(o.id, i.station) AS ticket
        FROM public.venue_orders o
        JOIN public.venue_order_items i ON i.venue_order_id = o.id AND i.station = ANY (v_stations)
        WHERE o.venue_id = p_venue_id
          AND o.created_at > now() - interval '24 hours'
          AND public.issue_4490_station_order_visible(o)
          AND (o.fulfillment_status IN ('placed', 'acknowledged', 'in_progress', 'ready')
               OR (o.fulfillment_status = 'cancelled' AND o.cancelled_at > now() - interval '15 minutes'
                   AND (o.sent_at IS NOT NULL OR o.source <> 'staff')))
      ) x
      WHERE x.ticket->>'state' <> 'done'
        AND (x.ticket->>'state' <> 'voided'
             OR EXISTS (SELECT 1 FROM public.venue_order_items vi
                        WHERE vi.venue_order_id = x.order_id AND vi.station = x.station
                          AND vi.voided_at > now() - interval '15 minutes')
             OR (SELECT o2.cancelled_at FROM public.venue_orders o2 WHERE o2.id = x.order_id)
                > now() - interval '15 minutes')), '[]'::jsonb)
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 6. Acting on a ticket.
-- ---------------------------------------------------------------------------
-- Lock the order, check the gate and the person, make sure the station has a
-- ticket here and that its row exists. p_sell_ok lets a seller act too
-- (Picked up, spec 08 §11 T5).
CREATE OR REPLACE FUNCTION public.issue_4490_station_lock(
  p_order_id uuid,
  p_station text,
  p_actor uuid,
  p_sell_ok boolean
)
RETURNS public.venue_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_order public.venue_orders%ROWTYPE;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_station IS NULL OR p_station NOT IN ('kitchen', 'bar') THEN
    RAISE EXCEPTION 'station_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_order FROM public.venue_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'station_ticket_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.issue_4490_stations_enabled(v_order.venue_id) THEN
    RAISE EXCEPTION 'stations_not_enabled' USING ERRCODE = 'P0001';
  END IF;
  IF NOT (public.issue_4490_can_kitchen(v_order.venue_id, p_actor)
          OR (p_sell_ok AND public.issue_4490_can_sell(v_order.venue_id, p_actor))) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF NOT public.issue_4490_station_order_visible(v_order)
     OR NOT EXISTS (SELECT 1 FROM public.venue_order_items i
                    WHERE i.venue_order_id = v_order.id AND i.station = p_station) THEN
    RAISE EXCEPTION 'station_ticket_not_found' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.venue_station_tickets (venue_order_id, station)
  VALUES (v_order.id, p_station)
  ON CONFLICT (venue_order_id, station) DO NOTHING;
  RETURN v_order;
END;
$function$;

-- After a ticket changes: the order is ready once every station with live
-- lines is ready, delivered once every one is picked up; every change bumps
-- station_rev (realtime on the one published table).
CREATE OR REPLACE FUNCTION public.issue_4490_station_sync_order(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_order public.venue_orders%ROWTYPE;
  v_live text[];
  v_all_ready boolean;
  v_all_picked boolean;
BEGIN
  SELECT * INTO v_order FROM public.venue_orders WHERE id = p_order_id FOR UPDATE;
  SELECT COALESCE(array_agg(DISTINCT i.station), '{}'::text[]) INTO v_live
  FROM public.venue_order_items i
  WHERE i.venue_order_id = p_order_id AND i.prep_state <> 'voided' AND i.station IS NOT NULL;
  v_all_ready := cardinality(v_live) > 0 AND NOT EXISTS (
    SELECT 1 FROM unnest(v_live) s(station)
    LEFT JOIN public.venue_station_tickets t ON t.venue_order_id = p_order_id AND t.station = s.station
    WHERE t.ready_at IS NULL);
  v_all_picked := cardinality(v_live) > 0 AND NOT EXISTS (
    SELECT 1 FROM unnest(v_live) s(station)
    LEFT JOIN public.venue_station_tickets t ON t.venue_order_id = p_order_id AND t.station = s.station
    WHERE t.picked_up_at IS NULL);
  UPDATE public.venue_orders o SET
    fulfillment_status = CASE
      WHEN v_all_picked AND o.fulfillment_status IN ('acknowledged', 'in_progress', 'ready') THEN 'delivered'
      WHEN v_all_ready AND o.fulfillment_status IN ('acknowledged', 'in_progress') THEN 'ready'
      ELSE o.fulfillment_status END,
    ready_at = CASE
      WHEN (v_all_ready OR v_all_picked) AND o.fulfillment_status IN ('acknowledged', 'in_progress', 'ready')
        THEN COALESCE(o.ready_at, now())
      ELSE o.ready_at END,
    delivered_at = CASE
      WHEN v_all_picked AND o.fulfillment_status IN ('acknowledged', 'in_progress', 'ready')
        THEN COALESCE(o.delivered_at, now())
      ELSE o.delivered_at END,
    station_rev = o.station_rev + 1,
    updated_at = now()
  WHERE o.id = p_order_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_station_accept(p_order_id uuid, p_station text, p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_order public.venue_orders%ROWTYPE;
  v_ticket public.venue_station_tickets%ROWTYPE;
BEGIN
  v_order := public.issue_4490_station_lock(p_order_id, p_station, p_actor, false);
  SELECT * INTO v_ticket FROM public.venue_station_tickets
  WHERE venue_order_id = v_order.id AND station = p_station FOR UPDATE;
  IF v_ticket.accepted_at IS NOT NULL THEN
    -- T14: a second accept is an answer, not an error.
    RETURN jsonb_build_object(
      'already', true,
      'alreadyAcceptedBy', public.issue_4490_floor_person_name(v_ticket.accepted_by_user_id, v_order.venue_id),
      'acceptedAt', v_ticket.accepted_at,
      'ticket', public.issue_4490_station_ticket_projection(v_order.id, p_station));
  END IF;
  IF v_order.fulfillment_status NOT IN ('placed', 'acknowledged', 'in_progress', 'ready') THEN
    RAISE EXCEPTION 'station_ticket_closed' USING ERRCODE = 'PT409';
  END IF;
  UPDATE public.venue_station_tickets
  SET accepted_at = now(), accepted_by_user_id = p_actor, updated_at = now()
  WHERE id = v_ticket.id;
  UPDATE public.venue_order_items
  SET prep_state = 'fired', fired_at = COALESCE(fired_at, now())
  WHERE venue_order_id = v_order.id AND station = p_station AND prep_state = 'pending';
  -- The first accept is the human acknowledgement (ack_is_human): the order
  -- moves placed -> acknowledged -> in_progress in one step.
  UPDATE public.venue_orders o SET
    fulfillment_status = CASE WHEN o.fulfillment_status IN ('placed', 'acknowledged') THEN 'in_progress'
                              ELSE o.fulfillment_status END,
    acknowledged_at = COALESCE(o.acknowledged_at, now()),
    acknowledged_by_user_id = COALESCE(o.acknowledged_by_user_id, p_actor),
    in_progress_at = COALESCE(o.in_progress_at, now()),
    updated_at = now()
  WHERE o.id = v_order.id;
  PERFORM public.issue_4490_station_sync_order(v_order.id);
  RETURN jsonb_build_object('already', false,
    'ticket', public.issue_4490_station_ticket_projection(v_order.id, p_station));
END;
$function$;

-- Ticket ready: every live line of the station is ready. Accepts first if it
-- was not (a cook may finish a ticket nobody tapped Accept on).
CREATE OR REPLACE FUNCTION public.issue_4490_station_ticket_ready(p_order_id uuid, p_station text, p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_order public.venue_orders%ROWTYPE;
  v_ticket public.venue_station_tickets%ROWTYPE;
BEGIN
  v_order := public.issue_4490_station_lock(p_order_id, p_station, p_actor, false);
  SELECT * INTO v_ticket FROM public.venue_station_tickets
  WHERE venue_order_id = v_order.id AND station = p_station FOR UPDATE;
  IF v_ticket.ready_at IS NOT NULL THEN
    RETURN jsonb_build_object('already', true,
      'alreadyReadyBy', public.issue_4490_floor_person_name(v_ticket.ready_by_user_id, v_order.venue_id),
      'orderReady', (SELECT o.fulfillment_status IN ('ready', 'delivered') FROM public.venue_orders o WHERE o.id = v_order.id),
      'ticket', public.issue_4490_station_ticket_projection(v_order.id, p_station));
  END IF;
  IF v_order.fulfillment_status NOT IN ('placed', 'acknowledged', 'in_progress', 'ready') THEN
    RAISE EXCEPTION 'station_ticket_closed' USING ERRCODE = 'PT409';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.venue_order_items i WHERE i.venue_order_id = v_order.id
                 AND i.station = p_station AND i.prep_state <> 'voided') THEN
    RAISE EXCEPTION 'station_ticket_closed' USING ERRCODE = 'PT409';
  END IF;
  IF v_ticket.accepted_at IS NULL THEN
    PERFORM public.issue_4490_station_accept(v_order.id, p_station, p_actor);
  END IF;
  UPDATE public.venue_order_items
  SET prep_state = 'ready', fired_at = COALESCE(fired_at, now()),
      ready_at = COALESCE(ready_at, now()), ready_by_user_id = COALESCE(ready_by_user_id, p_actor)
  WHERE venue_order_id = v_order.id AND station = p_station AND prep_state IN ('pending', 'fired');
  UPDATE public.venue_station_tickets
  SET ready_at = now(), ready_by_user_id = p_actor, updated_at = now()
  WHERE venue_order_id = v_order.id AND station = p_station;
  PERFORM public.issue_4490_station_sync_order(v_order.id);
  RETURN jsonb_build_object('already', false,
    'orderReady', (SELECT o.fulfillment_status IN ('ready', 'delivered') FROM public.venue_orders o WHERE o.id = v_order.id),
    'ticket', public.issue_4490_station_ticket_projection(v_order.id, p_station));
END;
$function$;

-- One line ready; the ticket follows when its last live line is ready.
CREATE OR REPLACE FUNCTION public.issue_4490_station_item_ready(p_order_item_id uuid, p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_item public.venue_order_items%ROWTYPE;
  v_order public.venue_orders%ROWTYPE;
  v_ticket public.venue_station_tickets%ROWTYPE;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_item FROM public.venue_order_items WHERE id = p_order_item_id;
  IF NOT FOUND OR v_item.station IS NULL THEN
    RAISE EXCEPTION 'station_ticket_not_found' USING ERRCODE = 'P0002';
  END IF;
  v_order := public.issue_4490_station_lock(v_item.venue_order_id, v_item.station, p_actor, false);
  SELECT * INTO v_item FROM public.venue_order_items WHERE id = p_order_item_id FOR UPDATE;
  SELECT * INTO v_ticket FROM public.venue_station_tickets
  WHERE venue_order_id = v_order.id AND station = v_item.station FOR UPDATE;
  IF v_item.prep_state = 'voided' OR v_ticket.picked_up_at IS NOT NULL
     OR v_order.fulfillment_status NOT IN ('placed', 'acknowledged', 'in_progress', 'ready') THEN
    RAISE EXCEPTION 'station_ticket_closed' USING ERRCODE = 'PT409';
  END IF;
  IF v_item.prep_state IN ('ready', 'served') THEN
    RETURN jsonb_build_object('already', true,
      'ticket', public.issue_4490_station_ticket_projection(v_order.id, v_item.station));
  END IF;
  IF v_ticket.accepted_at IS NULL THEN
    PERFORM public.issue_4490_station_accept(v_order.id, v_item.station, p_actor);
  END IF;
  UPDATE public.venue_order_items
  SET prep_state = 'ready', fired_at = COALESCE(fired_at, now()), ready_at = now(), ready_by_user_id = p_actor
  WHERE id = v_item.id;
  IF NOT EXISTS (SELECT 1 FROM public.venue_order_items i WHERE i.venue_order_id = v_order.id
                 AND i.station = v_item.station AND i.prep_state IN ('pending', 'fired')) THEN
    RETURN public.issue_4490_station_ticket_ready(v_order.id, v_item.station, p_actor);
  END IF;
  PERFORM public.issue_4490_station_sync_order(v_order.id);
  RETURN jsonb_build_object('already', false,
    'ticket', public.issue_4490_station_ticket_projection(v_order.id, v_item.station));
END;
$function$;

-- Recall to cooking: only a Ready ticket that has not been picked up
-- (spec 08 §11 T5; "Recall from Done" is withdrawn).
CREATE OR REPLACE FUNCTION public.issue_4490_station_recall(p_order_id uuid, p_station text, p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_order public.venue_orders%ROWTYPE;
  v_ticket public.venue_station_tickets%ROWTYPE;
BEGIN
  v_order := public.issue_4490_station_lock(p_order_id, p_station, p_actor, false);
  SELECT * INTO v_ticket FROM public.venue_station_tickets
  WHERE venue_order_id = v_order.id AND station = p_station FOR UPDATE;
  IF v_ticket.ready_at IS NULL OR v_ticket.picked_up_at IS NOT NULL
     OR v_order.fulfillment_status NOT IN ('acknowledged', 'in_progress', 'ready') THEN
    RAISE EXCEPTION 'station_ticket_not_ready' USING ERRCODE = 'PT409';
  END IF;
  UPDATE public.venue_station_tickets
  SET ready_at = NULL, ready_by_user_id = NULL, updated_at = now()
  WHERE id = v_ticket.id;
  UPDATE public.venue_order_items
  SET prep_state = 'fired', ready_at = NULL, ready_by_user_id = NULL
  WHERE venue_order_id = v_order.id AND station = p_station AND prep_state = 'ready';
  UPDATE public.venue_orders o
  SET fulfillment_status = 'in_progress', ready_at = NULL, updated_at = now()
  WHERE o.id = v_order.id AND o.fulfillment_status = 'ready';
  PERFORM public.issue_4490_station_sync_order(v_order.id);
  RETURN jsonb_build_object('already', false,
    'ticket', public.issue_4490_station_ticket_projection(v_order.id, p_station));
END;
$function$;

-- Picked up (spec 08 §11 T5): a seller or the kitchen; delivered once every
-- station's ticket has left the pass.
CREATE OR REPLACE FUNCTION public.issue_4490_order_picked_up(p_order_id uuid, p_station text, p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_order public.venue_orders%ROWTYPE;
  v_ticket public.venue_station_tickets%ROWTYPE;
BEGIN
  v_order := public.issue_4490_station_lock(p_order_id, p_station, p_actor, true);
  SELECT * INTO v_ticket FROM public.venue_station_tickets
  WHERE venue_order_id = v_order.id AND station = p_station FOR UPDATE;
  IF v_ticket.picked_up_at IS NOT NULL THEN
    RETURN jsonb_build_object('already', true,
      'alreadyPickedUpBy', public.issue_4490_floor_person_name(v_ticket.picked_up_by_user_id, v_order.venue_id),
      'ticket', public.issue_4490_station_ticket_projection(v_order.id, p_station));
  END IF;
  IF v_ticket.ready_at IS NULL THEN
    RAISE EXCEPTION 'station_ticket_not_ready' USING ERRCODE = 'PT409';
  END IF;
  UPDATE public.venue_station_tickets
  SET picked_up_at = now(), picked_up_by_user_id = p_actor, updated_at = now()
  WHERE id = v_ticket.id;
  UPDATE public.venue_order_items
  SET prep_state = 'served'
  WHERE venue_order_id = v_order.id AND station = p_station AND prep_state = 'ready';
  PERFORM public.issue_4490_station_sync_order(v_order.id);
  RETURN jsonb_build_object('already', false,
    'delivered', (SELECT o.fulfillment_status = 'delivered' FROM public.venue_orders o WHERE o.id = v_order.id),
    'ticket', public.issue_4490_station_ticket_projection(v_order.id, p_station));
END;
$function$;

-- Count one printed ticket PDF (called once per PDF made).
CREATE OR REPLACE FUNCTION public.issue_4490_station_mark_printed(p_order_id uuid, p_station text, p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_order public.venue_orders%ROWTYPE;
BEGIN
  v_order := public.issue_4490_station_lock(p_order_id, p_station, p_actor, false);
  UPDATE public.venue_station_tickets
  SET printed_count = printed_count + 1, last_printed_at = now(), updated_at = now()
  WHERE venue_order_id = v_order.id AND station = p_station;
  UPDATE public.venue_orders SET station_rev = station_rev + 1, updated_at = now() WHERE id = v_order.id;
  RETURN jsonb_build_object('ticket', public.issue_4490_station_ticket_projection(v_order.id, p_station));
END;
$function$;

-- ---------------------------------------------------------------------------
-- 7. What a floor PDF prints, after the gate and the person are checked.
--    kitchen_ticket / test_ticket: stations on + kitchen rights.
--    receipt: the Till on + may sell at that sale's venue, payment paid.
--    day_close: O5 (refused with its own code until then).
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
    IF NOT public.issue_4490_can_kitchen(v_venue.id, p_actor) THEN
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

CREATE OR REPLACE FUNCTION public.issue_4490_floor_pdf_record(
  p_brand_id uuid,
  p_kind text,
  p_object_path text,
  p_actor uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.venue_floor_pdfs (brand_id, kind, object_path, created_by)
  VALUES (p_brand_id, p_kind, p_object_path, p_actor)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

-- Objects older than 24 hours that are still in the bucket (bounded).
CREATE OR REPLACE FUNCTION public.issue_4490_floor_pdf_due(p_limit integer DEFAULT 200)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT COALESCE(array_agg(d.object_path ORDER BY d.created_at), '{}'::text[])
  FROM (
    SELECT f.object_path, f.created_at FROM public.venue_floor_pdfs f
    WHERE f.deleted_at IS NULL AND f.created_at < now() - interval '24 hours'
    ORDER BY f.created_at
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 200), 1), 1000)
  ) d;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_floor_pdf_forget(p_paths text[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_n integer;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  UPDATE public.venue_floor_pdfs SET deleted_at = now()
  WHERE object_path = ANY (COALESCE(p_paths, '{}'::text[])) AND deleted_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 8. The Till's send (T1: held -> placed only here) now also clears lines
--    for stations that have no screen (spec 08 §11 T8): those lines are
--    ready and their ticket picked up at once; a round with no screened
--    station is delivered, acknowledged by the sender. With the
--    kitchen_screens feature off the set of screened stations is empty.
--    Re-emitted from its only body (20281203504490).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_till_send(p_sale_id uuid, p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sale public.venue_till_sales%ROWTYPE;
  v_sent uuid[];
  v_screens text[];
  v_order uuid;
BEGIN
  v_sale := public.issue_4490_till_lock(p_sale_id, p_actor, NULL);
  IF v_sale.state NOT IN ('open', 'paying') THEN
    RAISE EXCEPTION 'till_check_closed' USING ERRCODE = 'PT409';
  END IF;
  -- Stock is taken here once O5 ships (I-4490-STOCK-NEVER-NEGATIVE seam).
  WITH sent AS (
    UPDATE public.venue_orders o
    SET fulfillment_status = 'placed', sent_at = now(), updated_at = now()
    FROM public.venue_till_lines l
    WHERE l.sale_id = v_sale.id AND l.kind = 'menu_round' AND l.venue_order_id = o.id
      AND o.fulfillment_status = 'held'
    RETURNING o.id
  )
  SELECT COALESCE(array_agg(id ORDER BY id), '{}'::uuid[]) INTO v_sent FROM sent;
  IF cardinality(v_sent) > 0 THEN
    v_screens := CASE WHEN public.issue_4490_venue_feature_on(v_sale.venue_id, 'kitchen_screens')
      THEN COALESCE((SELECT s.screen_stations FROM public.venue_till_settings s WHERE s.venue_id = v_sale.venue_id),
                    ARRAY['kitchen', 'bar']::text[])
      ELSE '{}'::text[] END;
    FOREACH v_order IN ARRAY v_sent LOOP
      INSERT INTO public.venue_station_tickets (
        venue_order_id, station, accepted_at, accepted_by_user_id, ready_at, ready_by_user_id,
        picked_up_at, picked_up_by_user_id)
      SELECT DISTINCT v_order, i.station, now(), p_actor, now(), p_actor, now(), p_actor
      FROM public.venue_order_items i
      WHERE i.venue_order_id = v_order AND i.prep_state <> 'voided' AND i.station IS NOT NULL
        AND NOT (i.station = ANY (v_screens))
      ON CONFLICT (venue_order_id, station) DO NOTHING;
      UPDATE public.venue_order_items i
      SET prep_state = 'served', fired_at = now(), ready_at = now(), ready_by_user_id = p_actor
      WHERE i.venue_order_id = v_order AND i.prep_state = 'pending' AND i.station IS NOT NULL
        AND NOT (i.station = ANY (v_screens));
      IF NOT EXISTS (SELECT 1 FROM public.venue_order_items i
                     WHERE i.venue_order_id = v_order AND i.prep_state <> 'voided'
                       AND i.station = ANY (v_screens)) THEN
        UPDATE public.venue_orders o SET
          fulfillment_status = 'delivered',
          acknowledged_at = now(), acknowledged_by_user_id = p_actor,
          in_progress_at = now(), ready_at = now(), delivered_at = now(),
          station_rev = o.station_rev + 1, updated_at = now()
        WHERE o.id = v_order;
      END IF;
    END LOOP;
    UPDATE public.venue_till_sales SET version = version + 1, updated_at = now() WHERE id = v_sale.id;
  END IF;
  RETURN public.issue_4490_till_sale_projection(v_sale.id)
    || jsonb_build_object('sentOrderIds', to_jsonb(v_sent));
END;
$function$;

-- ---------------------------------------------------------------------------
-- 9. Grants: every function here is internal (service role only).
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  public.issue_4490_stations_enabled(uuid),
  public.issue_4490_floor_person_name(uuid, uuid),
  public.issue_4490_item_station(uuid, uuid),
  public.issue_4490_order_item_station(),
  public.issue_4490_station_order_visible(public.venue_orders),
  public.issue_4490_station_ticket_projection(uuid, text),
  public.issue_4490_station_board(uuid, text, uuid),
  public.issue_4490_station_lock(uuid, text, uuid, boolean),
  public.issue_4490_station_sync_order(uuid),
  public.issue_4490_station_accept(uuid, text, uuid),
  public.issue_4490_station_ticket_ready(uuid, text, uuid),
  public.issue_4490_station_item_ready(uuid, uuid),
  public.issue_4490_station_recall(uuid, text, uuid),
  public.issue_4490_order_picked_up(uuid, text, uuid),
  public.issue_4490_station_mark_printed(uuid, text, uuid),
  public.issue_4490_floor_pdf_source(text, uuid, uuid, text, uuid, uuid),
  public.issue_4490_floor_pdf_record(uuid, text, text, uuid),
  public.issue_4490_floor_pdf_due(integer),
  public.issue_4490_floor_pdf_forget(text[]),
  public.issue_4490_till_send(uuid, uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.issue_4490_stations_enabled(uuid),
  public.issue_4490_floor_person_name(uuid, uuid),
  public.issue_4490_item_station(uuid, uuid),
  public.issue_4490_order_item_station(),
  public.issue_4490_station_order_visible(public.venue_orders),
  public.issue_4490_station_ticket_projection(uuid, text),
  public.issue_4490_station_board(uuid, text, uuid),
  public.issue_4490_station_lock(uuid, text, uuid, boolean),
  public.issue_4490_station_sync_order(uuid),
  public.issue_4490_station_accept(uuid, text, uuid),
  public.issue_4490_station_ticket_ready(uuid, text, uuid),
  public.issue_4490_station_item_ready(uuid, uuid),
  public.issue_4490_station_recall(uuid, text, uuid),
  public.issue_4490_order_picked_up(uuid, text, uuid),
  public.issue_4490_station_mark_printed(uuid, text, uuid),
  public.issue_4490_floor_pdf_source(text, uuid, uuid, text, uuid, uuid),
  public.issue_4490_floor_pdf_record(uuid, text, text, uuid),
  public.issue_4490_floor_pdf_due(integer),
  public.issue_4490_floor_pdf_forget(text[]),
  public.issue_4490_till_send(uuid, uuid)
TO service_role;

COMMIT;
