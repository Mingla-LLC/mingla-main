-- issue #3285 — IMPLEMENTOR regression suite. EXECUTED against the real
-- migration chain, not simulated.
--
-- ── WHAT BROKE ─────────────────────────────────────────────────────────────
-- business_patch_event_when deleted every event_dates row of the event and
-- re-inserted them with NEW ids on every When save. Adding a day or retiming
-- one passed its sold-ticket guard, so:
--   * every day-bound pass lost its ticket_event_dates rows (CASCADE) and
--     became valid on ANY day;
--   * every orders.event_date_id (the payout anchor) went NULL;
--   * on an event the door had already scanned, the save FAILED with
--     "scan_events is append-only for clients", because the FK's SET NULL is
--     an update that biz_scan_events_block_mutate refuses.
--
-- ── WHAT THIS SUITE PROVES ────────────────────────────────────────────────
--   T-01  adding a day to a sold multi-day event keeps every existing id,
--         every pass's day set, every order anchor, the master, and does not
--         revoke in-flight checkouts                                (dispatch a)
--   T-02  adding a day to an event the door has scanned keeps every scan's
--         day, and the save succeeds                                (dispatch c)
--   T-03  retiming a sold day without "Refund all & proceed" is refused with
--         schedule_change_with_sales, and nothing moves             (dispatch b)
--   T-04  the same retime WITH the acknowledgement happens IN PLACE: same id,
--         new times, passes/anchors/scans untouched                 (dispatch b,c)
--   T-05  an unchanged re-save and a same-instant timezone relabel change no
--         id and revoke nothing                                     (dispatch c)
--   T-06  removing a sold calendar date is still refused            (dispatch d)
--   T-07  removing ONE of two same-day sessions with sales is refused (d)
--   T-08  removing a day that still has a LIVE pass is refused even WITH the
--         acknowledgement                                           (d)
--   T-09  removing a day whose only hold is a door scan is refused  (d)
--   T-10  the DATABASE refuses a direct delete of a pass's day (23503)
--   T-11  removing an unheld day (incl. the master) is allowed: kept ids stay,
--         dead pass-day rows go, exactly one master remains
--   T-12  a single-date event's acknowledged date move keeps its id + anchor
--   T-13  a same-day retime on an unsold event keeps the id (P2)
--   T-14  ambiguous same-day group holding a pass -> event_date_match_ambiguous;
--         duplicate occurrences -> event_date_duplicate
--   T-15  legacy refusals are unchanged (preservation)
--
-- ── FAILS-ON-REVERT CONTRACT ──────────────────────────────────────────────
-- Re-apply the pre-#3285 business_patch_event_when body (20260911000000,
-- lines 3175-3478) and this file must go RED at T-01. Restore the #2160
-- CASCADE on ticket_event_dates_event_date_id_fkey and it must go RED at T-10.
-- T-06 and T-15 are preservation checks the old body also satisfies; they are
-- labelled as such.
--
-- Every check RAISEs on failure: the psql exit code is the verdict. The whole
-- suite runs in ONE transaction that ends in ROLLBACK, so it leaves nothing in
-- the shared migrated database for the suites that run after it; fixtures are
-- freshly keyed anyway, so it also passes on a non-virgin database.

\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.i3285_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #3285 FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END $$;

-- Local calendar day k (1-based) of every fixture, 30+ days out, in Lagos.
CREATE OR REPLACE FUNCTION pg_temp.i3285_day(p_k integer)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT to_char((now() AT TIME ZONE 'Africa/Lagos')::date + 29 + p_k, 'YYYY-MM-DD')
$$;

CREATE OR REPLACE FUNCTION pg_temp.i3285_at(p_k integer, p_hhmm text)
RETURNS timestamptz LANGUAGE sql STABLE AS $$
  SELECT (pg_temp.i3285_day(p_k) || ' ' || p_hhmm || ':00')::timestamp AT TIME ZONE 'Africa/Lagos'
$$;

-- A published FREE event owned by o_owner. p_slots is a jsonb array of
-- [dayIndex, "HH:MM" start, "HH:MM" end]; rows are created exactly the way the
-- RPC computes instants, so an unchanged payload matches to the second.
-- Built the way the #2160 setter suite builds one: draft -> the #1014
-- free-only publish lever -> scheduled.
CREATE OR REPLACE FUNCTION pg_temp.i3285_event(
  p_tag text, p_multi boolean, p_slots jsonb,
  OUT o_event uuid, OUT o_owner uuid, OUT o_scanner uuid, OUT o_ticket_type uuid
) LANGUAGE plpgsql AS $$
DECLARE
  v_brand uuid := gen_random_uuid();
  v_slot jsonb;
  v_first boolean := true;
BEGIN
  o_event := gen_random_uuid();
  o_owner := gen_random_uuid();
  o_scanner := gen_random_uuid();
  PERFORM set_config('request.jwt.claim.sub', '', true);
  INSERT INTO auth.users(id) VALUES (o_owner), (o_scanner);
  INSERT INTO public.creator_accounts(id) VALUES (o_owner);
  INSERT INTO public.brands(id, account_id, name, slug)
    VALUES (v_brand, o_owner, 'i3285 ' || p_tag, 'i3285-' || p_tag || '-' || v_brand);
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status,
                            visibility, timezone, is_multi_date)
    VALUES (o_event, v_brand, o_owner, 'i3285 ' || p_tag, 'i3285-' || p_tag || '-' || o_event,
            'event', 'draft', 'draft', 'Africa/Lagos', p_multi);
  FOR v_slot IN SELECT value FROM jsonb_array_elements(p_slots) LOOP
    INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
      VALUES (o_event,
              pg_temp.i3285_at((v_slot->>0)::int, v_slot->>1),
              pg_temp.i3285_at((v_slot->>0)::int, v_slot->>2),
              'Africa/Lagos', v_first);
    v_first := false;
  END LOOP;
  INSERT INTO public.ticket_types(event_id, name, price_cents, is_free, quantity_total,
                                  min_purchase_qty, available_online,
                                  available_in_person, display_order)
    VALUES (o_event, 'Entry', 0, true, 500, 1, true, true, 0)
    RETURNING id INTO o_ticket_type;
  PERFORM set_config('mingla.publish_free_only', 'on', true);
  UPDATE public.events SET status = 'scheduled', visibility = 'hidden', published_at = now()
   WHERE id = o_event;
  PERFORM set_config('mingla.publish_free_only', '', true);
END $$;

-- The occurrence id of slot n (1-based, ordered by start).
CREATE OR REPLACE FUNCTION pg_temp.i3285_slot(p_event uuid, p_n integer)
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM public.event_dates WHERE event_id = p_event
   ORDER BY start_at, id OFFSET p_n - 1 LIMIT 1
$$;

-- Sell one pass: an order anchored on p_anchor, a ticket, and one
-- ticket_event_dates row per day in p_days.
CREATE OR REPLACE FUNCTION pg_temp.i3285_sell(
  p_event uuid, p_ticket_type uuid, p_days uuid[], p_anchor uuid,
  p_ticket_status text DEFAULT 'valid', p_payment_status text DEFAULT 'paid'
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_order uuid; v_ticket uuid; v_day uuid;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true);
  INSERT INTO public.orders(id, event_id, buyer_email, buyer_name, buyer_phone_e164,
                            total_cents, currency, payment_method, payment_status,
                            source, event_date_id)
    VALUES (gen_random_uuid(), p_event, 'i3285@example.com', 'Guest', '+15550003285',
            0, NULL, 'free', p_payment_status, 'online_checkout', p_anchor)
    RETURNING id INTO v_order;
  INSERT INTO public.tickets(id, order_id, ticket_type_id, event_id, qr_code,
                             qr_token_hash, status, approval_status)
    VALUES (gen_random_uuid(), v_order, p_ticket_type, p_event,
            'mingla:v1:ticket:' || gen_random_uuid()::text,
            md5(gen_random_uuid()::text), p_ticket_status, 'auto')
    RETURNING id INTO v_ticket;
  FOREACH v_day IN ARRAY COALESCE(p_days, '{}'::uuid[]) LOOP
    INSERT INTO public.ticket_event_dates(ticket_id, event_date_id) VALUES (v_ticket, v_day);
  END LOOP;
  RETURN v_ticket;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.i3285_scan(
  p_ticket uuid, p_event uuid, p_scanner uuid, p_day uuid, p_result text
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true);
  INSERT INTO public.scan_events(ticket_id, event_id, scanner_user_id, scan_result,
                                 client_offline, event_date_id)
    VALUES (p_ticket, p_event, p_scanner, p_result, false, p_day);
END $$;

-- Payload: p_slots as in i3285_event.
CREATE OR REPLACE FUNCTION pg_temp.i3285_payload(
  p_mode text, p_slots jsonb, p_ack boolean DEFAULT false, p_tz text DEFAULT 'Africa/Lagos'
) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN p_mode = 'multi_date' THEN
    jsonb_build_object(
      'whenMode', 'multi_date', 'timezone', p_tz, 'when', NULL, 'recurrenceRule', NULL,
      'acknowledgeSoldImpact', p_ack,
      'multiDates', (SELECT jsonb_agg(jsonb_build_object(
          'id', 'draft-' || ord, 'date', pg_temp.i3285_day((s->>0)::int),
          'startTime', s->>1, 'endTime', s->>2) ORDER BY ord)
        FROM jsonb_array_elements(p_slots) WITH ORDINALITY AS x(s, ord)))
  ELSE
    jsonb_build_object(
      'whenMode', p_mode, 'timezone', p_tz, 'multiDates', NULL, 'recurrenceRule', NULL,
      'acknowledgeSoldImpact', p_ack,
      'when', jsonb_build_object('date', pg_temp.i3285_day((p_slots->0->>0)::int),
                                 'doorsOpen', p_slots->0->>1, 'endsAt', p_slots->0->>2))
  END
$$;

-- Call the RPC as p_actor. Returns NULL on success, else the error text. The
-- exception block is a subtransaction: a refused call leaves NOTHING behind.
CREATE OR REPLACE FUNCTION pg_temp.i3285_patch(p_event uuid, p_actor uuid, p_payload jsonb)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_err text;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claim.sub', p_actor::text, true);
    PERFORM public.business_patch_event_when(
      p_event, p_payload, 'issue 3285 regression suite edit', NULL);
    v_err := NULL;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN v_err;
END $$;

-- Snapshots.
CREATE OR REPLACE FUNCTION pg_temp.i3285_ids(p_event uuid)
RETURNS uuid[] LANGUAGE sql STABLE AS $$
  SELECT COALESCE(array_agg(id ORDER BY start_at, id), '{}') FROM public.event_dates WHERE event_id = p_event
$$;
CREATE OR REPLACE FUNCTION pg_temp.i3285_passdays(p_event uuid)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(string_agg(ted.ticket_id::text || '>' || ted.event_date_id::text, ',' ORDER BY ted.ticket_id, ted.event_date_id), '')
    FROM public.ticket_event_dates ted JOIN public.tickets t ON t.id = ted.ticket_id
   WHERE t.event_id = p_event
$$;
CREATE OR REPLACE FUNCTION pg_temp.i3285_anchors(p_event uuid)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(string_agg(o.id::text || '>' || COALESCE(o.event_date_id::text, 'NULL'), ',' ORDER BY o.id), '')
    FROM public.orders o WHERE o.event_id = p_event
$$;
CREATE OR REPLACE FUNCTION pg_temp.i3285_scandays(p_event uuid)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(string_agg(s.id::text || '>' || COALESCE(s.event_date_id::text, 'NULL'), ',' ORDER BY s.id), '')
    FROM public.scan_events s WHERE s.event_id = p_event
$$;
CREATE OR REPLACE FUNCTION pg_temp.i3285_epoch(p_event uuid)
RETURNS bigint LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT epoch FROM public.event_checkout_admission_state WHERE event_id = p_event), 0)
$$;
CREATE OR REPLACE FUNCTION pg_temp.i3285_masters(p_event uuid)
RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT count(*)::int FROM public.event_dates WHERE event_id = p_event AND is_master
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- T-01 / T-02 — ADD A DAY to a sold multi-day event.
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  f record; v_err text; d1 uuid; d2 uuid;
  v_ids uuid[]; v_days text; v_anchors text; v_scans text; v_epoch bigint;
  p_sat uuid; p_sun uuid; p_both uuid;
BEGIN
  SELECT * INTO f FROM pg_temp.i3285_event('add', true, '[[1,"13:00","20:00"],[2,"13:00","20:00"]]');
  d1 := pg_temp.i3285_slot(f.o_event, 1);
  d2 := pg_temp.i3285_slot(f.o_event, 2);
  -- A Saturday-only pass, a Sunday-only pass, and a both-days pass whose order
  -- anchors on the latest-ending day (I-PROPOSED-2160-B).
  p_sat  := pg_temp.i3285_sell(f.o_event, f.o_ticket_type, ARRAY[d1], d1);
  p_sun  := pg_temp.i3285_sell(f.o_event, f.o_ticket_type, ARRAY[d2], d2);
  p_both := pg_temp.i3285_sell(f.o_event, f.o_ticket_type, ARRAY[d1, d2], d2);

  v_ids := pg_temp.i3285_ids(f.o_event);
  v_days := pg_temp.i3285_passdays(f.o_event);
  v_anchors := pg_temp.i3285_anchors(f.o_event);
  v_epoch := pg_temp.i3285_epoch(f.o_event);
  PERFORM pg_temp.i3285_assert(length(v_days) > 0 AND v_anchors NOT LIKE '%NULL%',
    'T-01 fixture: 3 day-bound passes with anchored orders exist');

  -- The organiser adds a third day and sends the first two back unchanged.
  v_err := pg_temp.i3285_patch(f.o_event, f.o_owner, pg_temp.i3285_payload('multi_date',
    '[[1,"13:00","20:00"],[2,"13:00","20:00"],[3,"13:00","20:00"]]'));
  PERFORM pg_temp.i3285_assert(v_err IS NULL,
    'T-01a adding a day to a sold multi-day event saves (got ' || COALESCE(v_err, 'ok') || ')');
  PERFORM pg_temp.i3285_assert(
    (SELECT count(*) FROM public.event_dates WHERE event_id = f.o_event) = 3,
    'T-01b exactly one occurrence was added');
  PERFORM pg_temp.i3285_assert(
    (pg_temp.i3285_ids(f.o_event))[1:2] = v_ids,
    'T-01c both existing occurrences KEPT THEIR IDS');
  PERFORM pg_temp.i3285_assert(pg_temp.i3285_passdays(f.o_event) = v_days,
    'T-01d every pass still admits exactly the days it was sold for (no any-day passes)');
  PERFORM pg_temp.i3285_assert(
    (SELECT count(*) FROM public.ticket_event_dates WHERE ticket_id = p_sat) = 1
    AND (SELECT count(*) FROM public.ticket_event_dates WHERE ticket_id = p_both) = 2,
    'T-01e the Saturday pass has 1 day and the both-days pass has 2 — not zero');
  PERFORM pg_temp.i3285_assert(pg_temp.i3285_anchors(f.o_event) = v_anchors,
    'T-01f every order kept its payout anchor');
  PERFORM pg_temp.i3285_assert(
    (SELECT is_master FROM public.event_dates WHERE id = d1)
    AND pg_temp.i3285_masters(f.o_event) = 1,
    'T-01g day 1 is still the one master');
  PERFORM pg_temp.i3285_assert(pg_temp.i3285_epoch(f.o_event) = v_epoch,
    'T-01h adding a day revoked no in-flight checkout');

  -- T-02 — the door has now scanned: a success on day 1, a refusal on day 2.
  PERFORM pg_temp.i3285_scan(p_sat, f.o_event, f.o_scanner, d1, 'success');
  PERFORM pg_temp.i3285_scan(p_sun, f.o_event, f.o_scanner, d2, 'not_yet_open');
  v_scans := pg_temp.i3285_scandays(f.o_event);
  v_days := pg_temp.i3285_passdays(f.o_event);
  v_ids := pg_temp.i3285_ids(f.o_event);
  v_err := pg_temp.i3285_patch(f.o_event, f.o_owner, pg_temp.i3285_payload('multi_date',
    '[[1,"13:00","20:00"],[2,"13:00","20:00"],[3,"13:00","20:00"],[4,"13:00","20:00"]]'));
  PERFORM pg_temp.i3285_assert(v_err IS NULL,
    'T-02a adding a day to an event the door has scanned saves (got ' || COALESCE(v_err, 'ok') || ')');
  PERFORM pg_temp.i3285_assert(pg_temp.i3285_scandays(f.o_event) = v_scans
    AND v_scans NOT LIKE '%NULL%',
    'T-02b every scan still records the day it was made on');
  PERFORM pg_temp.i3285_assert((pg_temp.i3285_ids(f.o_event))[1:3] = v_ids
    AND pg_temp.i3285_passdays(f.o_event) = v_days,
    'T-02c ids and pass days survive the second add');
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- T-03 / T-04 — RETIME a sold day.
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  f record; v_err text; d1 uuid; d2 uuid; p1 uuid;
  v_ids uuid[]; v_days text; v_anchors text; v_scans text; v_epoch bigint;
BEGIN
  SELECT * INTO f FROM pg_temp.i3285_event('retime', true, '[[1,"13:00","20:00"],[2,"13:00","20:00"]]');
  d1 := pg_temp.i3285_slot(f.o_event, 1);
  d2 := pg_temp.i3285_slot(f.o_event, 2);
  p1 := pg_temp.i3285_sell(f.o_event, f.o_ticket_type, ARRAY[d2], d2);
  PERFORM pg_temp.i3285_sell(f.o_event, f.o_ticket_type, ARRAY[d1, d2], d2);
  v_ids := pg_temp.i3285_ids(f.o_event);
  v_days := pg_temp.i3285_passdays(f.o_event);
  v_anchors := pg_temp.i3285_anchors(f.o_event);

  -- T-03 — no acknowledgement: guests who bought Sunday must not find it moved.
  v_err := pg_temp.i3285_patch(f.o_event, f.o_owner, pg_temp.i3285_payload('multi_date',
    '[[1,"13:00","20:00"],[2,"15:00","22:00"]]'));
  PERFORM pg_temp.i3285_assert(v_err LIKE '%schedule_change_with_sales%',
    'T-03a retiming a sold day is refused with schedule_change_with_sales (got ' || COALESCE(v_err, 'NO ERROR') || ')');
  PERFORM pg_temp.i3285_assert(
    (SELECT start_at FROM public.event_dates WHERE id = d2) = pg_temp.i3285_at(2, '13:00')
    AND pg_temp.i3285_ids(f.o_event) = v_ids AND pg_temp.i3285_passdays(f.o_event) = v_days,
    'T-03b and nothing moved');
  -- Shrinking the window is a retime too.
  v_err := pg_temp.i3285_patch(f.o_event, f.o_owner, pg_temp.i3285_payload('multi_date',
    '[[1,"13:00","20:00"],[2,"13:00","16:00"]]'));
  PERFORM pg_temp.i3285_assert(v_err LIKE '%schedule_change_with_sales%',
    'T-03c shrinking a sold day''s end is refused (got ' || COALESCE(v_err, 'NO ERROR') || ')');

  -- T-04 — "Refund all & proceed": the change happens IN PLACE.
  PERFORM pg_temp.i3285_scan(p1, f.o_event, f.o_scanner, d2, 'not_yet_open');
  v_scans := pg_temp.i3285_scandays(f.o_event);
  v_epoch := pg_temp.i3285_epoch(f.o_event);
  v_err := pg_temp.i3285_patch(f.o_event, f.o_owner, pg_temp.i3285_payload('multi_date',
    '[[1,"13:00","20:00"],[2,"15:00","22:00"]]', true));
  PERFORM pg_temp.i3285_assert(v_err IS NULL,
    'T-04a the acknowledged retime saves (got ' || COALESCE(v_err, 'ok') || ')');
  PERFORM pg_temp.i3285_assert(pg_temp.i3285_ids(f.o_event) = v_ids,
    'T-04b the retimed day KEPT ITS ID');
  PERFORM pg_temp.i3285_assert(
    (SELECT start_at FROM public.event_dates WHERE id = d2) = pg_temp.i3285_at(2, '15:00')
    AND (SELECT end_at FROM public.event_dates WHERE id = d2) = pg_temp.i3285_at(2, '22:00'),
    'T-04c and carries the new times');
  PERFORM pg_temp.i3285_assert(pg_temp.i3285_passdays(f.o_event) = v_days
    AND pg_temp.i3285_anchors(f.o_event) = v_anchors
    AND pg_temp.i3285_scandays(f.o_event) = v_scans,
    'T-04d pass days, order anchors and scan days are untouched');
  PERFORM pg_temp.i3285_assert(pg_temp.i3285_epoch(f.o_event) > v_epoch,
    'T-04e a real schedule change still revokes in-flight checkouts');
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- T-05 — UNCHANGED re-save and a same-instant timezone relabel.
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  f record; v_err text; d1 uuid; d2 uuid; p1 uuid;
  v_ids uuid[]; v_days text; v_scans text; v_epoch bigint; v_tuples text;
BEGIN
  SELECT * INTO f FROM pg_temp.i3285_event('noop', true, '[[1,"13:00","20:00"],[2,"13:00","20:00"]]');
  d1 := pg_temp.i3285_slot(f.o_event, 1);
  d2 := pg_temp.i3285_slot(f.o_event, 2);
  p1 := pg_temp.i3285_sell(f.o_event, f.o_ticket_type, ARRAY[d1], d1);
  PERFORM pg_temp.i3285_scan(p1, f.o_event, f.o_scanner, d1, 'success');
  v_ids := pg_temp.i3285_ids(f.o_event);
  v_days := pg_temp.i3285_passdays(f.o_event);
  v_scans := pg_temp.i3285_scandays(f.o_event);
  v_epoch := pg_temp.i3285_epoch(f.o_event);
  -- Every UPDATE writes a new tuple version, so an unchanged ctid set proves
  -- no occurrence row was written (updated_at cannot: now() is fixed per
  -- transaction and this whole block is one).
  SELECT string_agg(ctid::text, ',' ORDER BY id) INTO v_tuples FROM public.event_dates WHERE event_id = f.o_event;

  v_err := pg_temp.i3285_patch(f.o_event, f.o_owner, pg_temp.i3285_payload('multi_date',
    '[[1,"13:00","20:00"],[2,"13:00","20:00"]]'));
  PERFORM pg_temp.i3285_assert(v_err IS NULL,
    'T-05a an unchanged re-save succeeds (got ' || COALESCE(v_err, 'ok') || ')');
  PERFORM pg_temp.i3285_assert(pg_temp.i3285_ids(f.o_event) = v_ids
    AND pg_temp.i3285_passdays(f.o_event) = v_days
    AND pg_temp.i3285_scandays(f.o_event) = v_scans,
    'T-05b it changed no id, no pass day and no scan day');
  PERFORM pg_temp.i3285_assert(
    (SELECT string_agg(ctid::text, ',' ORDER BY id) FROM public.event_dates WHERE event_id = f.o_event) = v_tuples
    AND pg_temp.i3285_epoch(f.o_event) = v_epoch,
    'T-05c it wrote no occurrence row and revoked no checkout');

  -- Kinshasa and Lagos are both UTC+1: same wall clock, same instants.
  v_err := pg_temp.i3285_patch(f.o_event, f.o_owner, pg_temp.i3285_payload('multi_date',
    '[[1,"13:00","20:00"],[2,"13:00","20:00"]]', false, 'Africa/Kinshasa'));
  PERFORM pg_temp.i3285_assert(v_err IS NULL,
    'T-05d a same-instant timezone relabel on a sold event saves (got ' || COALESCE(v_err, 'ok') || ')');
  PERFORM pg_temp.i3285_assert(pg_temp.i3285_ids(f.o_event) = v_ids
    AND (SELECT bool_and(timezone = 'Africa/Kinshasa') FROM public.event_dates WHERE event_id = f.o_event),
    'T-05e the relabel kept every id and restamped the zone');
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- T-06 .. T-09 — REMOVING a day.
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  f record; v_err text; d1 uuid; d2 uuid; d3 uuid; p uuid; v_ids uuid[]; v_days text;
BEGIN
  -- T-06 (PRESERVATION — the pre-#3285 body refuses this too).
  SELECT * INTO f FROM pg_temp.i3285_event('rm-date', true, '[[1,"13:00","20:00"],[2,"13:00","20:00"]]');
  d2 := pg_temp.i3285_slot(f.o_event, 2);
  PERFORM pg_temp.i3285_sell(f.o_event, f.o_ticket_type, ARRAY[d2], d2);
  v_ids := pg_temp.i3285_ids(f.o_event);
  v_err := pg_temp.i3285_patch(f.o_event, f.o_owner, pg_temp.i3285_payload('multi_date',
    '[[1,"13:00","20:00"],[3,"13:00","20:00"]]'));
  PERFORM pg_temp.i3285_assert(v_err LIKE '%multi_date_remove_with_sales%',
    'T-06 removing a sold calendar date is still refused (got ' || COALESCE(v_err, 'NO ERROR') || ')');
  PERFORM pg_temp.i3285_assert(pg_temp.i3285_ids(f.o_event) = v_ids, 'T-06b nothing moved');

  -- T-07 — one of two same-day sessions. The calendar date survives, so the
  -- old date-set guard never saw it.
  SELECT * INTO f FROM pg_temp.i3285_event('rm-session', true,
    '[[1,"13:00","15:00"],[1,"18:00","20:00"],[2,"13:00","20:00"]]');
  d2 := pg_temp.i3285_slot(f.o_event, 2);  -- day 1, 18:00
  d3 := pg_temp.i3285_slot(f.o_event, 3);
  PERFORM pg_temp.i3285_sell(f.o_event, f.o_ticket_type, ARRAY[d3], d3);
  v_ids := pg_temp.i3285_ids(f.o_event);
  v_err := pg_temp.i3285_patch(f.o_event, f.o_owner, pg_temp.i3285_payload('multi_date',
    '[[1,"13:00","15:00"],[2,"13:00","20:00"]]'));
  PERFORM pg_temp.i3285_assert(v_err LIKE '%multi_date_remove_with_sales%',
    'T-07 removing one of two same-day sessions with sales is refused (got ' || COALESCE(v_err, 'NO ERROR') || ')');
  PERFORM pg_temp.i3285_assert(pg_temp.i3285_ids(f.o_event) = v_ids, 'T-07b nothing moved');

  -- T-08 — "Refund all & proceed" cannot delete a day a LIVE pass still holds
  -- (a refund that did not complete).
  SELECT * INTO f FROM pg_temp.i3285_event('rm-held-ack', true,
    '[[1,"13:00","20:00"],[2,"13:00","20:00"],[3,"13:00","20:00"]]');
  d2 := pg_temp.i3285_slot(f.o_event, 2);
  p := pg_temp.i3285_sell(f.o_event, f.o_ticket_type, ARRAY[d2], d2);
  v_ids := pg_temp.i3285_ids(f.o_event);
  v_days := pg_temp.i3285_passdays(f.o_event);
  v_err := pg_temp.i3285_patch(f.o_event, f.o_owner, pg_temp.i3285_payload('multi_date',
    '[[1,"13:00","20:00"],[3,"13:00","20:00"]]', true));
  PERFORM pg_temp.i3285_assert(v_err LIKE '%multi_date_remove_with_sales%',
    'T-08a removing a day with a live pass is refused even with the acknowledgement (got ' || COALESCE(v_err, 'NO ERROR') || ')');
  PERFORM pg_temp.i3285_assert(pg_temp.i3285_ids(f.o_event) = v_ids
    AND pg_temp.i3285_passdays(f.o_event) = v_days
    AND EXISTS (SELECT 1 FROM public.ticket_event_dates WHERE ticket_id = p AND event_date_id = d2),
    'T-08b the pass still admits its day');

  -- T-09 — the only hold is a door scan. Every pass and order is refunded, so
  -- sold_count is 0 and no acknowledgement is needed — the day still happened.
  SELECT * INTO f FROM pg_temp.i3285_event('rm-scanned', true,
    '[[1,"13:00","20:00"],[2,"13:00","20:00"],[3,"13:00","20:00"]]');
  d2 := pg_temp.i3285_slot(f.o_event, 2);
  p := pg_temp.i3285_sell(f.o_event, f.o_ticket_type, ARRAY[d2], d2);
  PERFORM pg_temp.i3285_scan(p, f.o_event, f.o_scanner, d2, 'success');
  UPDATE public.tickets SET status = 'refunded' WHERE event_id = f.o_event;
  UPDATE public.orders SET payment_status = 'refunded' WHERE event_id = f.o_event;
  v_ids := pg_temp.i3285_ids(f.o_event);
  v_err := pg_temp.i3285_patch(f.o_event, f.o_owner, pg_temp.i3285_payload('multi_date',
    '[[1,"13:00","20:00"],[3,"13:00","20:00"]]'));
  PERFORM pg_temp.i3285_assert(v_err LIKE '%multi_date_remove_with_sales%',
    'T-09a a day the door has scanned cannot be removed (got ' || COALESCE(v_err, 'NO ERROR') || ')');
  PERFORM pg_temp.i3285_assert(pg_temp.i3285_ids(f.o_event) = v_ids
    AND pg_temp.i3285_scandays(f.o_event) NOT LIKE '%NULL%',
    'T-09b nothing moved and the scan kept its day');
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- T-10 — THE DATABASE refuses to orphan a pass's day, whoever deletes it.
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE f record; d1 uuid; v_state text := NULL;
BEGIN
  SELECT * INTO f FROM pg_temp.i3285_event('fk', true, '[[1,"13:00","20:00"],[2,"13:00","20:00"]]');
  d1 := pg_temp.i3285_slot(f.o_event, 1);
  PERFORM pg_temp.i3285_sell(f.o_event, f.o_ticket_type, ARRAY[d1], d1);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  BEGIN
    DELETE FROM public.event_dates WHERE id = d1;
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE;
  END;
  PERFORM pg_temp.i3285_assert(v_state = '23503',
    'T-10a a direct DELETE of a day a pass holds fails with foreign_key_violation (got ' || COALESCE(v_state, 'NO ERROR — the pass was orphaned') || ')');
  PERFORM pg_temp.i3285_assert(
    (SELECT confdeltype FROM pg_constraint
      WHERE conname = 'ticket_event_dates_event_date_id_fkey'
        AND conrelid = 'public.ticket_event_dates'::regclass) = 'r',
    'T-10b ticket_event_dates_event_date_id_fkey is ON DELETE RESTRICT');
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- T-11 .. T-14 — what IS allowed, and the edge rules.
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  f record; v_err text; d1 uuid; d2 uuid; d3 uuid; p uuid; v_ids uuid[]; v_order uuid;
BEGIN
  -- T-11 — remove an unheld day, which is also the master. Its only
  -- dependent is a refunded pass: a dead entitlement.
  SELECT * INTO f FROM pg_temp.i3285_event('rm-unheld', true,
    '[[1,"13:00","20:00"],[2,"13:00","20:00"],[3,"13:00","20:00"]]');
  d1 := pg_temp.i3285_slot(f.o_event, 1);
  d2 := pg_temp.i3285_slot(f.o_event, 2);
  d3 := pg_temp.i3285_slot(f.o_event, 3);
  p := pg_temp.i3285_sell(f.o_event, f.o_ticket_type, ARRAY[d1], d1, 'refunded', 'refunded');
  v_err := pg_temp.i3285_patch(f.o_event, f.o_owner, pg_temp.i3285_payload('multi_date',
    '[[2,"13:00","20:00"],[3,"13:00","20:00"]]'));
  PERFORM pg_temp.i3285_assert(v_err IS NULL,
    'T-11a removing a day nothing holds saves (got ' || COALESCE(v_err, 'ok') || ')');
  PERFORM pg_temp.i3285_assert(pg_temp.i3285_ids(f.o_event) = ARRAY[d2, d3],
    'T-11b the kept days KEPT THEIR IDS and the removed day is gone');
  PERFORM pg_temp.i3285_assert(
    NOT EXISTS (SELECT 1 FROM public.ticket_event_dates WHERE ticket_id = p),
    'T-11c the refunded pass''s dead day row was cleaned up');
  PERFORM pg_temp.i3285_assert(
    pg_temp.i3285_masters(f.o_event) = 1 AND (SELECT is_master FROM public.event_dates WHERE id = d2),
    'T-11d the new earliest day is the one master');

  -- T-12 — a single-date event's acknowledged date move is the SAME occurrence.
  SELECT * INTO f FROM pg_temp.i3285_event('single-move', false, '[[1,"19:00","23:00"]]');
  d1 := pg_temp.i3285_slot(f.o_event, 1);
  PERFORM pg_temp.i3285_sell(f.o_event, f.o_ticket_type, NULL, d1);
  v_err := pg_temp.i3285_patch(f.o_event, f.o_owner, pg_temp.i3285_payload('single',
    '[[5,"19:00","23:00"]]', true));
  PERFORM pg_temp.i3285_assert(v_err IS NULL,
    'T-12a the acknowledged single-date move saves (got ' || COALESCE(v_err, 'ok') || ')');
  PERFORM pg_temp.i3285_assert(pg_temp.i3285_ids(f.o_event) = ARRAY[d1]
    AND (SELECT start_at FROM public.event_dates WHERE id = d1) = pg_temp.i3285_at(5, '19:00'),
    'T-12b it kept its id and moved');
  PERFORM pg_temp.i3285_assert(pg_temp.i3285_anchors(f.o_event) NOT LIKE '%NULL%'
    AND pg_temp.i3285_masters(f.o_event) = 1,
    'T-12c the order kept its anchor and the event its master');

  -- T-13 — same-day retime on an UNSOLD event matches its row (P2).
  SELECT * INTO f FROM pg_temp.i3285_event('p2', true, '[[1,"13:00","20:00"],[2,"13:00","20:00"]]');
  v_ids := pg_temp.i3285_ids(f.o_event);
  v_err := pg_temp.i3285_patch(f.o_event, f.o_owner, pg_temp.i3285_payload('multi_date',
    '[[1,"13:00","20:00"],[2,"10:00","12:00"]]'));
  PERFORM pg_temp.i3285_assert(v_err IS NULL AND pg_temp.i3285_ids(f.o_event) = v_ids,
    'T-13 an unsold same-day retime keeps the id (got ' || COALESCE(v_err, 'ok') || ')');

  -- T-14a — two same-day sessions both retimed cannot be told apart; one is held.
  SELECT * INTO f FROM pg_temp.i3285_event('ambiguous', true,
    '[[1,"13:00","15:00"],[1,"18:00","20:00"],[2,"13:00","20:00"]]');
  d1 := pg_temp.i3285_slot(f.o_event, 1);
  PERFORM pg_temp.i3285_sell(f.o_event, f.o_ticket_type, ARRAY[d1], d1);
  v_ids := pg_temp.i3285_ids(f.o_event);
  v_err := pg_temp.i3285_patch(f.o_event, f.o_owner, pg_temp.i3285_payload('multi_date',
    '[[1,"14:00","16:00"],[1,"19:00","21:00"],[2,"13:00","20:00"]]', true));
  PERFORM pg_temp.i3285_assert(v_err LIKE '%event_date_match_ambiguous%',
    'T-14a an ambiguous same-day change touching a held session is refused (got ' || COALESCE(v_err, 'NO ERROR') || ')');
  PERFORM pg_temp.i3285_assert(pg_temp.i3285_ids(f.o_event) = v_ids, 'T-14b nothing moved');

  -- T-14c — two occurrences at the same instant.
  SELECT * INTO f FROM pg_temp.i3285_event('dup', true, '[[1,"13:00","20:00"],[2,"13:00","20:00"]]');
  v_err := pg_temp.i3285_patch(f.o_event, f.o_owner, pg_temp.i3285_payload('multi_date',
    '[[1,"13:00","20:00"],[2,"13:00","20:00"],[2,"13:00","21:00"]]'));
  PERFORM pg_temp.i3285_assert(v_err LIKE '%event_date_duplicate%',
    'T-14c duplicate occurrences are refused (got ' || COALESCE(v_err, 'NO ERROR') || ')');
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- T-15 — legacy refusals are unchanged (PRESERVATION).
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE f record; v_err text; d1 uuid; v_stranger uuid := gen_random_uuid();
BEGIN
  SELECT * INTO f FROM pg_temp.i3285_event('legacy', false, '[[1,"19:00","23:00"]]');
  d1 := pg_temp.i3285_slot(f.o_event, 1);
  PERFORM pg_temp.i3285_sell(f.o_event, f.o_ticket_type, NULL, d1);

  v_err := pg_temp.i3285_patch(f.o_event, f.o_owner, pg_temp.i3285_payload('single', '[[1,"20:00","23:00"]]'));
  PERFORM pg_temp.i3285_assert(v_err LIKE '%schedule_change_with_sales%',
    'T-15a single-date time change with sales -> schedule_change_with_sales (got ' || COALESCE(v_err, 'NO ERROR') || ')');
  v_err := pg_temp.i3285_patch(f.o_event, f.o_owner, pg_temp.i3285_payload('single', '[[2,"19:00","23:00"]]'));
  PERFORM pg_temp.i3285_assert(v_err LIKE '%multi_date_remove_with_sales%',
    'T-15b single-date date change with sales -> multi_date_remove_with_sales (got ' || COALESCE(v_err, 'NO ERROR') || ')');
  v_err := pg_temp.i3285_patch(f.o_event, f.o_owner, pg_temp.i3285_payload('multi_date',
    '[[1,"19:00","23:00"],[2,"19:00","23:00"]]'));
  PERFORM pg_temp.i3285_assert(v_err LIKE '%when_mode_drops_active_date%',
    'T-15c whenMode change with sales -> when_mode_drops_active_date (got ' || COALESCE(v_err, 'NO ERROR') || ')');
  v_err := pg_temp.i3285_patch(f.o_event, f.o_owner,
    jsonb_build_object('whenMode', 'multi_date', 'timezone', 'Africa/Lagos', 'multiDates', '[]'::jsonb,
                       'acknowledgeSoldImpact', true));
  PERFORM pg_temp.i3285_assert(v_err LIKE '%event_date_required%',
    'T-15d an empty multi-date payload -> event_date_required (got ' || COALESCE(v_err, 'NO ERROR') || ')');
  PERFORM set_config('request.jwt.claim.sub', '', true);
  INSERT INTO auth.users(id) VALUES (v_stranger);
  v_err := pg_temp.i3285_patch(f.o_event, v_stranger, pg_temp.i3285_payload('single', '[[1,"19:00","23:00"]]'));
  PERFORM pg_temp.i3285_assert(v_err LIKE '%insufficient_event_permission%',
    'T-15e a stranger cannot edit the dates (got ' || COALESCE(v_err, 'NO ERROR') || ')');
  PERFORM pg_temp.i3285_assert(pg_temp.i3285_ids(f.o_event) = ARRAY[d1]
    AND (SELECT start_at FROM public.event_dates WHERE id = d1) = pg_temp.i3285_at(1, '19:00'),
    'T-15f and none of them moved the occurrence');
END $$;

DO $$ BEGIN
  RAISE NOTICE 'issue #3285 event-dates stable identity suite: ALL CHECKS PASSED';
END $$;

ROLLBACK;
