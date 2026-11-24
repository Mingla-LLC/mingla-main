-- Issue #4490, spec 08 O3 fix round 1 (the independent test's O3-T1..T5; T6
-- and T7 are CI gates, no SQL).
--
-- 1. O3-T2 (live guest ordering): the floor-staff list behind "New order" and
--    escalation rung 1 (issue_4490_venue_floor_user_ids) is empty unless the
--    venue's stations are on (VENUE_TILL AND its kitchen_screens feature,
--    issue_4490_stations_enabled). With either off, guest orders notify exactly
--    the brand roles they notified before O3.
-- 2. O3-T1 (live guest ordering): pg_venue_order_escalation_scan runs its two
--    arms with SEPARATE limits. The Mingla-money arm is the 20270319001846 body
--    unchanged (condition, clock, order, limit, lock); its rows come first. The
--    Till arm has its own limit of the same size, never escalates a round sent
--    more than 6 hours ago (c_till_max_age, the one place), moves at most one
--    rung per scan (a round that first becomes due starts at rung 1), and
--    returns nothing unless the venue's stations are on.
-- 3. O3-T3: voiding a sent line (issue_4490_till_void) re-evaluates the order
--    (issue_4490_station_sync_order), so an order whose other stations were
--    all picked up is delivered, or ready when they are all ready.
-- 4. O3-T4: issue_4490_station_mark_printed counts a print under the rights of
--    the PDF it counts (issue_4490_floor_pdf_source): kitchen rights, or a
--    seller printing a Till round's ticket. The venue-order-staff `printed`
--    action is removed, so the count rises only when venue-floor-pdf makes a
--    ticket PDF.
-- 5. O3-T5 (§11 T8 for guest orders, Seth's ruling): a guest order's lines for
--    a station with no screen at that venue never wait on a station. They are
--    not on any board and no station can act on them; the order is ready once
--    every SCREENED station with live lines is ready; Picked up never delivers
--    an unscreened part (the Orders queue does, as today), so nothing is
--    silently marked delivered. A guest order with no screened station follows
--    today's non-station flow unchanged. Till rounds are unchanged (T8 at send).
--
-- Function bodies: issue_4490_till_void, issue_4490_station_sync_order,
-- issue_4490_station_board and issue_4490_station_lock are checked patches of
-- their live (latest) definitions; issue_4490_venue_floor_user_ids,
-- issue_4490_station_mark_printed and pg_venue_order_escalation_scan are
-- re-emitted from 20281203604490 (their latest bodies). One new internal
-- helper, issue_4490_station_screened. Every function keeps its class in the
-- privilege matrix (internal: service role only; the scan: service role only).
-- No venue_id column (the #2099 seal is unchanged). Static SQL.
-- Local stack only until Seth approves a production migration.

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE FUNCTION pg_temp.issue_4490_o3f1_patch(
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
    RAISE EXCEPTION 'issue_4490 O3F1 patch precondition failed for %: old % (expected %)',
      p_sig, v_old_count, p_count;
  END IF;
  EXECUTE replace(v_def, p_old, p_new);
END;
$patch$;

-- ---------------------------------------------------------------------------
-- 1. O3-T2: floor staff only where the venue's stations are on.
--    Re-emitted from 20281203604490 with the station gate.
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
    -- #4490 O3 fix 1 (O3-T2): behind the release switch. Until the venue's
    -- stations are on (VENUE_TILL AND kitchen_screens) nobody extra is told.
    AND public.issue_4490_stations_enabled(p_venue_id)
    AND m.role = 'venue_staff'
    AND m.accepted_at IS NOT NULL
    AND m.removed_at IS NULL
    AND m.user_id IS NOT NULL
    AND g.capabilities && COALESCE(p_caps, '{}'::text[]);
$function$;

-- ---------------------------------------------------------------------------
-- 2. O3-T1: the escalation scan, re-emitted from 20281203604490. Two arms,
--    each with its own limit; the Mingla-money arm is the 1846 body as it was.
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
DECLARE
  -- #4490 O3 fix 1: a Till round sent longer ago than this never escalates
  -- (nobody is paged about yesterday's unaccepted round). The one place.
  c_till_max_age CONSTANT interval := interval '6 hours';
  v_till_on boolean;
BEGIN
  IF current_user NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  -- The Till arm only runs behind the release switch (and, per venue, the
  -- kitchen_screens feature: issue_4490_stations_enabled below).
  v_till_on := public.issue_4490_flag_on('VENUE_TILL');

  RETURN QUERY
  WITH due_mingla AS (
    -- The Mingla-money arm: the 20270319001846 body, unchanged.
    SELECT o.id,
           coalesce(o.confirmed_at, o.created_at) AS paid_at,
           CASE
             WHEN p_now - coalesce(o.confirmed_at, o.created_at) >= interval '10 minutes' THEN 3
             WHEN p_now - coalesce(o.confirmed_at, o.created_at) >= interval '5 minutes'  THEN 2
             ELSE 1
           END::smallint AS target,
           0 AS arm
      FROM public.venue_orders o
     WHERE o.acknowledged_at IS NULL
       AND o.fulfillment_status = 'placed'
       AND o.payment_status = 'paid'
       -- M-2: Mingla is holding this money. A venue-collected order is the
       -- waiter's cash and the waiter's problem, and paging an owner about it
       -- is noise with no money behind it.
       AND o.money_path = 'mingla'
       AND p_now - coalesce(o.confirmed_at, o.created_at) >= interval '2 minutes'
       AND o.escalation_level < CASE
             WHEN p_now - coalesce(o.confirmed_at, o.created_at) >= interval '10 minutes' THEN 3
             WHEN p_now - coalesce(o.confirmed_at, o.created_at) >= interval '5 minutes'  THEN 2
             ELSE 1
           END
     ORDER BY coalesce(o.confirmed_at, o.created_at)
     LIMIT greatest(1, coalesce(p_limit, 50))
     FOR UPDATE SKIP LOCKED
  ), due_till AS (
    -- #4490 spec 08 §11 T7: a sent Till round nobody accepted, with its OWN
    -- limit (it never takes a guest order's slot). A held round is never
    -- 'placed'; a round for a station with no screen is delivered at send; an
    -- order-pad round has no sent_at. At most one rung per scan, so a round
    -- that first becomes due starts at rung 1.
    SELECT o.id,
           coalesce(o.sent_at, o.created_at) AS paid_at,
           LEAST(o.escalation_level + 1, CASE
             WHEN p_now - coalesce(o.sent_at, o.created_at) >= interval '10 minutes' THEN 3
             WHEN p_now - coalesce(o.sent_at, o.created_at) >= interval '5 minutes'  THEN 2
             ELSE 1
           END)::smallint AS target,
           1 AS arm
      FROM public.venue_orders o
     WHERE v_till_on
       AND o.acknowledged_at IS NULL
       AND o.fulfillment_status = 'placed'
       AND o.money_path = 'venue_collected'
       AND o.source = 'staff'
       AND o.sent_at IS NOT NULL
       AND o.till_payment_id IS NULL
       AND p_now - coalesce(o.sent_at, o.created_at) >= interval '2 minutes'
       AND p_now - coalesce(o.sent_at, o.created_at) < c_till_max_age
       AND o.escalation_level < CASE
             WHEN p_now - coalesce(o.sent_at, o.created_at) >= interval '10 minutes' THEN 3
             WHEN p_now - coalesce(o.sent_at, o.created_at) >= interval '5 minutes'  THEN 2
             ELSE 1
           END
       -- One rung per scan: a round this very scan time already claimed waits
       -- for the next scan (a repeat call with the same p_now claims nothing).
       AND (o.escalated_at IS NULL OR o.escalated_at < p_now)
       AND public.issue_4490_stations_enabled(o.venue_id)
     ORDER BY coalesce(o.sent_at, o.created_at)
     LIMIT greatest(1, coalesce(p_limit, 50))
     FOR UPDATE SKIP LOCKED
  ), due AS (
    SELECT * FROM due_mingla
    UNION ALL
    SELECT * FROM due_till
  ), claimed AS (
    UPDATE public.venue_orders o
       SET escalation_level = due.target,
           escalated_at = p_now
      FROM due
     WHERE o.id = due.id
    RETURNING o.id, o.brand_id, o.venue_id, o.spot_label_at_order, o.pickup_code,
              o.buyer_name, o.currency, o.total_cents,
              due.paid_at AS paid_at, due.target AS target, due.arm AS arm
  )
  SELECT c.id, c.brand_id, c.venue_id,
         coalesce(v.name, 'your venue')::text,
         c.target,
         c.spot_label_at_order, c.pickup_code, c.buyer_name,
         c.currency, c.total_cents, c.paid_at,
         extract(epoch FROM (p_now - c.paid_at))::int
    FROM claimed c
    LEFT JOIN public.venue_listings v ON v.id = c.venue_id
   -- Guest (Mingla-money) rows first, in the order the 1846 body returned them.
   ORDER BY c.arm, c.paid_at;
END;
$function$;

COMMENT ON FUNCTION public.pg_venue_order_escalation_scan(timestamptz, int) IS
  'SPEC #1788 P-55, corrected at #1846 M-1/M-2, widened at #4490 spec 08 T7 — '
  'the unacknowledged-order ladder. Mingla money: the clock starts at PAYMENT '
  '(confirmed_at), with the 1846 limit and order. A sent Till round '
  '(venue-collected, staff, sent_at set) that nobody accepted: the clock starts '
  'at sent_at, its own limit, never after 6 hours, one rung per scan, only '
  'where the venue''s stations are on. Its ENTIRE write surface is still '
  'escalation_level + escalated_at: it never refunds, never cancels, never '
  'pauses a venue, and never sends an SMS.';

REVOKE ALL ON FUNCTION public.pg_venue_order_escalation_scan(timestamptz, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pg_venue_order_escalation_scan(timestamptz, int)
  FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pg_venue_order_escalation_scan(timestamptz, int)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 3. O3-T3: a voided sent line re-evaluates the order.
-- ---------------------------------------------------------------------------
SELECT pg_temp.issue_4490_o3f1_patch(
  'public.issue_4490_till_void(uuid,uuid,uuid,uuid,text,boolean,integer)'::regprocedure,
  $old$          total_cents = v_sub + v_sc + tip_cents,
          station_rev = station_rev + 1, updated_at = now()
      WHERE id = v_order.id;
    END IF;
  ELSIF v_order.id IS NOT NULL THEN$old$,
  $new$          total_cents = v_sub + v_sc + tip_cents,
          station_rev = station_rev + 1, updated_at = now()
      WHERE id = v_order.id;
      -- #4490 O3 fix 1 (O3-T3): the voided line may have been its station's
      -- last live line; the stations left decide the order now (ready once
      -- they are all ready, delivered once they are all picked up).
      IF v_order.fulfillment_status <> 'held' THEN
        PERFORM public.issue_4490_station_sync_order(v_order.id);
      END IF;
    END IF;
  ELSIF v_order.id IS NOT NULL THEN$new$
);

-- ---------------------------------------------------------------------------
-- 4. O3-T5: which stations have a screen at a venue (the set issue_4490_till_send
--    uses: none while kitchen_screens is off; else Settings › Selling in
--    person, default kitchen and bar).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_station_screened(p_venue_id uuid, p_station text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT public.issue_4490_venue_feature_on(p_venue_id, 'kitchen_screens')
    AND p_station = ANY (COALESCE(
      (SELECT s.screen_stations FROM public.venue_till_settings s WHERE s.venue_id = p_venue_id),
      ARRAY['kitchen', 'bar']::text[]));
$function$;

SELECT pg_temp.issue_4490_o3f1_patch(
  'public.issue_4490_station_sync_order(uuid)'::regprocedure,
  $old$  v_all_ready boolean;
$old$,
  $new$  v_all_ready boolean;
  v_ready_set text[];
$new$
);
SELECT pg_temp.issue_4490_o3f1_patch(
  'public.issue_4490_station_sync_order(uuid)'::regprocedure,
  $old$  v_all_ready := cardinality(v_live) > 0 AND NOT EXISTS (
    SELECT 1 FROM unnest(v_live) s(station)$old$,
  $new$  -- #4490 O3 fix 1 (O3-T5): a guest order is ready once every SCREENED
  -- station with live lines is ready (a station with no screen never holds
  -- it; none screened: nothing changes, today's flow). Delivered still needs
  -- every live station picked up, so an unscreened part is never delivered
  -- by a station tap. Till rounds: unchanged (T8 clears them at send).
  v_ready_set := CASE WHEN v_order.source = 'staff' THEN v_live
    ELSE ARRAY(SELECT x.station FROM unnest(v_live) x(station)
               WHERE public.issue_4490_station_screened(v_order.venue_id, x.station)) END;
  v_all_ready := cardinality(v_ready_set) > 0 AND NOT EXISTS (
    SELECT 1 FROM unnest(v_ready_set) s(station)$new$
);
SELECT pg_temp.issue_4490_o3f1_patch(
  'public.issue_4490_station_board(uuid,text,uuid)'::regprocedure,
  $old$        JOIN public.venue_order_items i ON i.venue_order_id = o.id AND i.station = ANY (v_stations)
        WHERE o.venue_id = p_venue_id
$old$,
  $new$        JOIN public.venue_order_items i ON i.venue_order_id = o.id AND i.station = ANY (v_stations)
        WHERE o.venue_id = p_venue_id
          -- #4490 O3 fix 1 (O3-T5): a guest order's part for a station with
          -- no screen is on no board (Till rounds clear theirs at send).
          AND (o.source = 'staff' OR public.issue_4490_station_screened(o.venue_id, i.station))
$new$
);
SELECT pg_temp.issue_4490_o3f1_patch(
  'public.issue_4490_station_lock(uuid,text,uuid,boolean)'::regprocedure,
  $old$  IF NOT public.issue_4490_station_order_visible(v_order)
     OR NOT EXISTS (SELECT 1 FROM public.venue_order_items i
                    WHERE i.venue_order_id = v_order.id AND i.station = p_station) THEN$old$,
  $new$  IF NOT public.issue_4490_station_order_visible(v_order)
     OR NOT EXISTS (SELECT 1 FROM public.venue_order_items i
                    WHERE i.venue_order_id = v_order.id AND i.station = p_station)
     -- #4490 O3 fix 1 (O3-T5): no station acts on a guest order's part for a
     -- station with no screen.
     OR (v_order.source <> 'staff' AND NOT public.issue_4490_station_screened(v_order.venue_id, p_station)) THEN$new$
);

-- ---------------------------------------------------------------------------
-- 5. O3-T4: a print counts under the rights of the PDF it counts.
--    Re-emitted from 20281203604490.
-- ---------------------------------------------------------------------------
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
  -- #4490 O3 fix 1 (O3-T4): the same rights as the PDF (issue_4490_floor_pdf_source):
  -- kitchen rights, or a seller printing a Till round's ticket. A seller never
  -- counts a print on a guest order's ticket they cannot print.
  IF NOT public.issue_4490_can_kitchen(v_order.venue_id, p_actor) AND v_order.source <> 'staff' THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  UPDATE public.venue_station_tickets
  SET printed_count = printed_count + 1, last_printed_at = now(), updated_at = now()
  WHERE venue_order_id = v_order.id AND station = p_station;
  UPDATE public.venue_orders SET station_rev = station_rev + 1, updated_at = now() WHERE id = v_order.id;
  RETURN jsonb_build_object('ticket', public.issue_4490_station_ticket_projection(v_order.id, p_station));
END;
$function$;

-- ---------------------------------------------------------------------------
-- 6. Grants: every function here stays internal (service role only).
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  public.issue_4490_venue_floor_user_ids(uuid, uuid, text[]),
  public.issue_4490_till_void(uuid, uuid, uuid, uuid, text, boolean, integer),
  public.issue_4490_station_screened(uuid, text),
  public.issue_4490_station_sync_order(uuid),
  public.issue_4490_station_board(uuid, text, uuid),
  public.issue_4490_station_lock(uuid, text, uuid, boolean),
  public.issue_4490_station_mark_printed(uuid, text, uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.issue_4490_venue_floor_user_ids(uuid, uuid, text[]),
  public.issue_4490_till_void(uuid, uuid, uuid, uuid, text, boolean, integer),
  public.issue_4490_station_screened(uuid, text),
  public.issue_4490_station_sync_order(uuid),
  public.issue_4490_station_board(uuid, text, uuid),
  public.issue_4490_station_lock(uuid, text, uuid, boolean),
  public.issue_4490_station_mark_printed(uuid, text, uuid)
TO service_role;

COMMIT;
