-- issue #2160 — IMPLEMENTOR HAPPY-PATH regression suite. EXECUTED, not simulated.
--
-- ── THE ASSERTION THAT MATTERS MOST ────────────────────────────────────────
--   One guest, one order, TWO chosen days of a THREE-day event
--     -> the guest is admitted on BOTH days they picked
--     -> and on NEITHER day they did not.
--   Proved in BOTH pricing modes, because the two mint completely different
--   shapes (per_day: 2 passes x 1 day; all_days: 1 pass x 2 days) and both must
--   satisfy the same sentence.
--
-- ── WHY THIS FILE EXECUTES SQL RATHER THAN FAKING A DATABASE ───────────────
-- The #2136 tester demonstrated on THIS EXACT CODE PATH that a TypeScript fake
-- plus substring assertions let an `AND` -> `OR` mutation of the finalize arm's
-- predicate pass green while real PostgreSQL minted a bad order. So every check
-- below runs the REAL `biz_ticket_checkout_create_session`,
-- `issue_1930_ticket_checkout_finalize_base` and `biz_ticket_scan` against the
-- real applied migration chain, and asserts on real `orders`, `tickets`,
-- `ticket_event_dates` and `scan_events` rows. Every check RAISEs on failure, so
-- the psql exit code is the verdict.
--
-- ── FAILS-ON-REVERT CONTRACT (SPEC §9) ─────────────────────────────────────
-- This file must go RED on a true LINE DELETION of any one of:
--   (i)   the ticket_event_dates mint block in the finalize base (§D DELTA 4)
--   (ii)  the day-aware ladder in biz_ticket_scan (§E)
--   (iii) the chosen-day-set persist in the create-session base (§B DELTA 6)
-- Measured counts are recorded in the implementation report.
--
-- ── INVARIANTS UNDER TEST ──────────────────────────────────────────────────
--   I-PROPOSED-2160-A  TICKET-IS-THE-DAY-AUTHORITY
--   I-PROPOSED-2160-B  ORDER-DAY-ANCHOR-IS-LATEST-ENDING
--   I-PROPOSED-2160-E  DAY-BOUND-PASS-ADMITS-ONLY-ITS-DAY

\set ON_ERROR_STOP on

-- ── Fixture: a published FREE multi-date event with N occurrences, built the
--    way #2150 and #2136 build one (the #1014 free-publish lever), so the #2101
--    access snapshots are populated the way production populates them.
CREATE OR REPLACE FUNCTION pg_temp.i2160_event(
  p_tag text,
  p_mode text DEFAULT 'per_day',
  p_days int DEFAULT 3,
  p_quantity_total int DEFAULT 100,
  p_price_cents int DEFAULT 0,
  OUT o_event uuid, OUT o_ticket_type uuid, OUT o_scanner uuid
) LANGUAGE plpgsql AS $$
DECLARE
  v_user uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_i int;
BEGIN
  o_event := gen_random_uuid();
  o_scanner := gen_random_uuid();
  INSERT INTO auth.users(id) VALUES (v_user), (o_scanner);
  INSERT INTO public.creator_accounts(id) VALUES (v_user);
  -- A paid fixture needs a real currency on the brand AND the event:
  -- `tg_enforce_event_ticket_currency` refuses a priced ticket_type otherwise.
  -- `payment_provider='paystack'` on the paid fixture so the Stripe-account
  -- readiness gate is not the thing under test (the #2150 suite's precedent);
  -- what matters here is only that total_cents > 0.
  INSERT INTO public.brands(id, account_id, name, slug, default_currency, payment_provider)
    VALUES (v_brand, v_user, 'i2160 ' || p_tag, 'i2160-' || p_tag || '-' || v_brand,
            CASE WHEN p_price_cents = 0 THEN NULL ELSE 'GBP' END,
            CASE WHEN p_price_cents = 0 THEN 'stripe' ELSE 'paystack' END);
  INSERT INTO public.events(id, brand_id, title, slug, event_type, status, visibility,
                            timezone, is_multi_date, multi_date_pricing_mode, currency)
    VALUES (o_event, v_brand, 'i2160 ' || p_tag, 'i2160-' || p_tag || '-' || o_event,
            'event', 'draft', 'draft', 'UTC', true, p_mode,
            CASE WHEN p_price_cents = 0 THEN NULL ELSE 'GBP' END);
  -- Day 1 is LIVE NOW; every later day is in the future. Individual checks
  -- reposition occurrences with pg_temp.i2160_place_day to put a chosen day
  -- inside the scanner's window — the scan RPC reads event_dates live, so this
  -- is real time travel for the function under test, not a stub.
  FOR v_i IN 1..p_days LOOP
    INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
      VALUES (o_event,
              now() + ((v_i - 1) || ' days')::interval - interval '1 hour',
              now() + ((v_i - 1) || ' days')::interval + interval '5 hours',
              'UTC', v_i = 1);
  END LOOP;
  INSERT INTO public.ticket_types(event_id, name, price_cents, is_free, quantity_total,
                                  min_purchase_qty, available_online, available_in_person,
                                  display_order, currency)
    VALUES (o_event, 'Entry', p_price_cents, p_price_cents = 0, p_quantity_total, 1, true, true, 0,
            CASE WHEN p_price_cents = 0 THEN NULL ELSE 'GBP' END)
    RETURNING id INTO o_ticket_type;
  INSERT INTO public.event_scanners(event_id, user_id) VALUES (o_event, o_scanner);
  PERFORM set_config('mingla.publish_free_only', 'on', true);
  UPDATE public.events SET status='scheduled', visibility='hidden', published_at=now()
   WHERE id = o_event;
  PERFORM set_config('mingla.publish_free_only', '', true);
END $$;

-- Reposition ONE occurrence. 'live' = inside the grace window right now;
-- 'past' = ended well beyond the 360-minute after-grace; 'future' = starts well
-- beyond the 120-minute before-grace.
CREATE OR REPLACE FUNCTION pg_temp.i2160_place_day(p_day uuid, p_where text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.event_dates
     SET start_at = CASE p_where
           WHEN 'live'   THEN now() - interval '1 hour'
           WHEN 'past'   THEN now() - interval '5 days'
           WHEN 'future' THEN now() + interval '5 days'
         END,
         end_at = CASE p_where
           WHEN 'live'   THEN now() + interval '5 hours'
           WHEN 'past'   THEN now() - interval '5 days' + interval '5 hours'
           WHEN 'future' THEN now() + interval '5 days' + interval '5 hours'
         END
   WHERE id = p_day;
END $$;

-- Nth occurrence of an event, chronologically by the ORIGINAL layout. Captured
-- before any repositioning, so the identity of "day 2" never moves.
CREATE OR REPLACE FUNCTION pg_temp.i2160_days(p_event uuid)
RETURNS uuid[] LANGUAGE sql AS $$
  SELECT ARRAY(SELECT id FROM public.event_dates WHERE event_id = p_event
                ORDER BY start_at, id);
$$;

-- Reserve + finalize, exactly as `ticket-checkout-create`'s free arm does:
-- create-session (which now carries the chosen day set), then authorize, then
-- finalize. Returns the order id.
CREATE OR REPLACE FUNCTION pg_temp.i2160_reserve(
  p_event uuid, p_ticket_type uuid, p_days uuid[], p_qty int DEFAULT 1,
  p_key text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_session jsonb; v_session_id uuid; v_final jsonb; v_anchor uuid;
BEGIN
  v_session := public.biz_ticket_checkout_create_session(
    p_event, NULL, 'Multi Day Guest', 'multi@example.com', '+15550001111', false,
    jsonb_build_array(jsonb_build_object('ticketTypeId', p_ticket_type, 'quantity', p_qty)),
    COALESCE(p_key, 'i2160:' || p_event::text || ':' ||
             COALESCE(array_to_string(p_days, ','), 'none') || ':' || p_qty::text),
    now() + interval '15 minutes', 0, 'auto', p_days);
  v_session_id := (v_session ->> 'checkoutSessionId')::uuid;

  -- The ANCHOR the edge function writes: the LATEST-ENDING chosen day (D-2).
  -- Written into session metadata exactly as ticket-checkout-create does, so
  -- orders.event_date_id lands with no finalize change.
  IF p_days IS NOT NULL AND array_length(p_days, 1) > 0 THEN
    SELECT d.id INTO v_anchor FROM public.event_dates d
     WHERE d.id = ANY (p_days) ORDER BY d.end_at DESC, d.id DESC LIMIT 1;
    UPDATE public.ticket_checkout_sessions
       SET metadata = COALESCE(metadata, '{}'::jsonb)
                      || jsonb_build_object('event_date_id', v_anchor::text)
     WHERE id = v_session_id;
  END IF;

  IF NOT public.issue_1930_ticket_session_authorized(v_session_id, p_event) THEN
    RAISE EXCEPTION 'i2160 fixture: session % not authorized', v_session_id;
  END IF;
  -- A paid session needs a payment intent id; a free one must not have one.
  v_final := public.issue_1930_ticket_checkout_finalize_base(
    v_session_id,
    CASE WHEN (v_session ->> 'totalCents')::int > 0
         THEN 'pi_i2160_' || replace(v_session_id::text, '-', '') END,
    NULL, NULL, 'i2160-test-pepper-0123456789abcdef', NULL, NULL, false);
  RETURN (v_final ->> 'orderId')::uuid;
END $$;

-- Scan ONE pass through the real RPC.
CREATE OR REPLACE FUNCTION pg_temp.i2160_scan(
  p_event uuid, p_ticket uuid, p_scanner uuid
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_qr text;
BEGIN
  SELECT qr_code INTO v_qr FROM public.tickets WHERE id = p_ticket;
  RETURN public.biz_ticket_scan(p_event, v_qr, p_scanner,
                                'i2160-test-pepper-0123456789abcdef');
END $$;

CREATE OR REPLACE FUNCTION pg_temp.i2160_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #2160 FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- H-01 — PER_DAY. Two of three days. Admitted on BOTH, on NEITHER other.
-- SPEC amendment §10 SC-1-per-day.
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  f record; v_days uuid[]; v_order uuid;
  v_pass_d1 uuid; v_pass_d2 uuid; v_res jsonb; v_n int;
BEGIN
  SELECT * INTO f FROM pg_temp.i2160_event('perday', 'per_day', 3);
  v_days := pg_temp.i2160_days(f.o_event);
  v_order := pg_temp.i2160_reserve(f.o_event, f.o_ticket_type,
                                   ARRAY[v_days[1], v_days[2]], 1);

  -- EXACTLY ONE order.
  SELECT count(*) INTO v_n FROM public.orders WHERE id = v_order;
  PERFORM pg_temp.i2160_assert(v_n = 1, 'H-01a per_day: exactly one order');

  -- EXACTLY TWO passes — one admission per chosen day.
  SELECT count(*) INTO v_n FROM public.tickets WHERE order_id = v_order;
  PERFORM pg_temp.i2160_assert(v_n = 2, 'H-01b per_day: 2 days chosen -> exactly 2 passes (got ' || v_n || ')');

  -- Each pass carries EXACTLY ONE day, and between them they cover day 1 and
  -- day 2 and NOTHING else.
  SELECT count(*) INTO v_n
    FROM public.tickets t
   WHERE t.order_id = v_order
     AND (SELECT count(*) FROM public.ticket_event_dates ted WHERE ted.ticket_id = t.id) = 1;
  PERFORM pg_temp.i2160_assert(v_n = 2, 'H-01c per_day: each pass admits exactly one day');

  SELECT count(DISTINCT ted.event_date_id) INTO v_n
    FROM public.tickets t JOIN public.ticket_event_dates ted ON ted.ticket_id = t.id
   WHERE t.order_id = v_order;
  PERFORM pg_temp.i2160_assert(v_n = 2, 'H-01d per_day: the two passes cover two distinct days');

  PERFORM pg_temp.i2160_assert(NOT EXISTS (
    SELECT 1 FROM public.tickets t JOIN public.ticket_event_dates ted ON ted.ticket_id = t.id
     WHERE t.order_id = v_order AND ted.event_date_id = v_days[3]),
    'H-01e per_day: NO pass admits day 3 — the day the guest did not pick');

  SELECT t.id INTO v_pass_d1 FROM public.tickets t
    JOIN public.ticket_event_dates ted ON ted.ticket_id = t.id
   WHERE t.order_id = v_order AND ted.event_date_id = v_days[1];
  SELECT t.id INTO v_pass_d2 FROM public.tickets t
    JOIN public.ticket_event_dates ted ON ted.ticket_id = t.id
   WHERE t.order_id = v_order AND ted.event_date_id = v_days[2];
  PERFORM pg_temp.i2160_assert(v_pass_d1 IS NOT NULL AND v_pass_d2 IS NOT NULL,
    'H-01f per_day: one pass bound to day 1 and one to day 2');

  -- ── THE POSITIVE HALF: each pass admits on ITS day. ──────────────────────
  PERFORM pg_temp.i2160_place_day(v_days[1], 'live');
  PERFORM pg_temp.i2160_place_day(v_days[2], 'future');
  PERFORM pg_temp.i2160_place_day(v_days[3], 'future');
  v_res := pg_temp.i2160_scan(f.o_event, v_pass_d1, f.o_scanner);
  PERFORM pg_temp.i2160_assert(v_res ->> 'result' = 'success',
    'H-01g per_day: the day-1 pass is ADMITTED inside day 1 (got ' || (v_res ->> 'result') || ')');
  PERFORM pg_temp.i2160_assert((v_res ->> 'eventDateId')::uuid = v_days[1],
    'H-01h per_day: the scan records WHICH day it admitted (day 1)');
  PERFORM pg_temp.i2160_assert(EXISTS (
    SELECT 1 FROM public.scan_events se
     WHERE se.ticket_id = v_pass_d1 AND se.scan_result = 'success'
       AND se.event_date_id = v_days[1]),
    'H-01i per_day: scan_events carries the admitting day (SC-10)');

  -- ── THE NEGATIVE HALF, WHICH IS THE WHOLE POINT. ─────────────────────────
  -- Move the clock to day 2. The day-1 pass must NOT admit.
  PERFORM pg_temp.i2160_place_day(v_days[1], 'past');
  PERFORM pg_temp.i2160_place_day(v_days[2], 'live');
  v_res := pg_temp.i2160_scan(f.o_event, v_pass_d1, f.o_scanner);
  PERFORM pg_temp.i2160_assert(v_res ->> 'result' = 'event_ended',
    'H-01j per_day: the day-1 pass is REFUSED on day 2 (got ' || (v_res ->> 'result') || ')');

  -- ...while the day-2 pass admits on day 2.
  v_res := pg_temp.i2160_scan(f.o_event, v_pass_d2, f.o_scanner);
  PERFORM pg_temp.i2160_assert(v_res ->> 'result' = 'success',
    'H-01k per_day: the day-2 pass is ADMITTED inside day 2 (got ' || (v_res ->> 'result') || ')');
  PERFORM pg_temp.i2160_assert((v_res ->> 'eventDateId')::uuid = v_days[2],
    'H-01l per_day: the day-2 scan records day 2, not day 1');

  -- Move to day 3 — the day the guest never picked. NEITHER pass admits.
  PERFORM pg_temp.i2160_place_day(v_days[2], 'past');
  PERFORM pg_temp.i2160_place_day(v_days[3], 'live');
  PERFORM pg_temp.i2160_assert(
    (pg_temp.i2160_scan(f.o_event, v_pass_d1, f.o_scanner) ->> 'result') = 'event_ended',
    'H-01m per_day: the day-1 pass is REFUSED on day 3');
  PERFORM pg_temp.i2160_assert(
    (pg_temp.i2160_scan(f.o_event, v_pass_d2, f.o_scanner) ->> 'result') = 'event_ended',
    'H-01n per_day: the day-2 pass is REFUSED on day 3');

  -- The payout anchor is the LATEST-ENDING chosen day (D-2 / I-PROPOSED-2160-B).
  PERFORM pg_temp.i2160_assert(
    (SELECT o.event_date_id FROM public.orders o WHERE o.id = v_order) = v_days[2],
    'H-01o per_day: orders.event_date_id anchors on the latest-ENDING chosen day');
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- H-02 — ALL_DAYS. ONE pass, TWO days. Admits on both, twice on neither, and
-- not at all on the day the guest did not pick. Amendment §10 SC-1-all-days.
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  f record; v_days uuid[]; v_order uuid; v_pass uuid; v_res jsonb; v_n int;
  v_status text; v_used_at timestamptz;
BEGIN
  SELECT * INTO f FROM pg_temp.i2160_event('alldays', 'all_days', 3);
  v_days := pg_temp.i2160_days(f.o_event);
  v_order := pg_temp.i2160_reserve(f.o_event, f.o_ticket_type,
                                   ARRAY[v_days[1], v_days[2]], 1);

  SELECT count(*) INTO v_n FROM public.tickets WHERE order_id = v_order;
  PERFORM pg_temp.i2160_assert(v_n = 1, 'H-02a all_days: 2 days chosen -> exactly ONE pass (got ' || v_n || ')');
  SELECT id INTO v_pass FROM public.tickets WHERE order_id = v_order;

  SELECT count(*) INTO v_n FROM public.ticket_event_dates WHERE ticket_id = v_pass;
  PERFORM pg_temp.i2160_assert(v_n = 2, 'H-02b all_days: that ONE pass admits TWO days (got ' || v_n || ')');
  PERFORM pg_temp.i2160_assert(NOT EXISTS (
    SELECT 1 FROM public.ticket_event_dates WHERE ticket_id = v_pass
       AND event_date_id = v_days[3]),
    'H-02c all_days: the pass does NOT admit day 3');

  -- One price, not two: the order total is 1 x price, unlike per_day's 2 x.
  PERFORM pg_temp.i2160_assert(
    (SELECT sum(quantity) FROM public.order_line_items WHERE order_id = v_order) = 1,
    'H-02d all_days: the line quantity is 1 — one pass sold once');

  -- Day 1: admitted.
  PERFORM pg_temp.i2160_place_day(v_days[1], 'live');
  PERFORM pg_temp.i2160_place_day(v_days[2], 'future');
  PERFORM pg_temp.i2160_place_day(v_days[3], 'future');
  v_res := pg_temp.i2160_scan(f.o_event, v_pass, f.o_scanner);
  PERFORM pg_temp.i2160_assert(v_res ->> 'result' = 'success',
    'H-02e all_days: admitted on day 1 (got ' || (v_res ->> 'result') || ')');

  -- Day 1 again: duplicate. Deduped by the LEDGER, since status is still valid.
  v_res := pg_temp.i2160_scan(f.o_event, v_pass, f.o_scanner);
  PERFORM pg_temp.i2160_assert(v_res ->> 'result' = 'duplicate',
    'H-02f all_days: a SECOND scan on day 1 is a duplicate (got ' || (v_res ->> 'result') || ')');

  -- SC-18 — status semantics: still `valid` (a day remains), used_at set, so
  -- biz_guest_roster_project counts the guest checked in with NO change to it.
  SELECT status, used_at INTO v_status, v_used_at FROM public.tickets WHERE id = v_pass;
  PERFORM pg_temp.i2160_assert(v_status = 'valid',
    'H-02g all_days: after day 1 the pass is still ''valid'' — day 2 remains (got ' || v_status || ')');
  PERFORM pg_temp.i2160_assert(v_used_at IS NOT NULL,
    'H-02h all_days: used_at is set on FIRST admission, so the roster counts the guest in unmodified');

  -- Day 2: THE SAME PASS admits AGAIN. This is what "one price for all days" means.
  PERFORM pg_temp.i2160_place_day(v_days[1], 'past');
  PERFORM pg_temp.i2160_place_day(v_days[2], 'live');
  v_res := pg_temp.i2160_scan(f.o_event, v_pass, f.o_scanner);
  PERFORM pg_temp.i2160_assert(v_res ->> 'result' = 'success',
    'H-02i all_days: the SAME pass is admitted AGAIN on day 2 (got ' || (v_res ->> 'result') || ')');
  PERFORM pg_temp.i2160_assert((v_res ->> 'eventDateId')::uuid = v_days[2],
    'H-02j all_days: the second admission records day 2');

  SELECT status INTO v_status FROM public.tickets WHERE id = v_pass;
  PERFORM pg_temp.i2160_assert(v_status = 'used',
    'H-02k all_days: with no unadmitted day left the pass flips to ''used'' (got ' || v_status || ')');

  -- Day 3 — never picked. Refused.
  PERFORM pg_temp.i2160_place_day(v_days[2], 'past');
  PERFORM pg_temp.i2160_place_day(v_days[3], 'live');
  PERFORM pg_temp.i2160_assert(
    (pg_temp.i2160_scan(f.o_event, v_pass, f.o_scanner) ->> 'result') = 'event_ended',
    'H-02l all_days: REFUSED on day 3 — the day the guest did not pick');
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- H-03 — LEGACY / SINGLE-DATE. A pass with ZERO ticket_event_dates rows keeps
-- today's any-occurrence window and one-shot lifecycle, byte-for-behaviour.
-- This is the proof that nothing already issued is narrowed (§A.1).
-- Amendment §10 T-28.
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE f record; v_days uuid[]; v_order uuid; v_pass uuid; v_res jsonb; v_n int;
BEGIN
  SELECT * INTO f FROM pg_temp.i2160_event('legacy', 'per_day', 3);
  v_days := pg_temp.i2160_days(f.o_event);
  -- NO day set — exactly what every pre-#2160 caller sends.
  v_order := pg_temp.i2160_reserve(f.o_event, f.o_ticket_type, NULL, 1);

  SELECT count(*) INTO v_n FROM public.tickets WHERE order_id = v_order;
  PERFORM pg_temp.i2160_assert(v_n = 1, 'H-03a legacy: no day chosen -> exactly one pass');
  SELECT id INTO v_pass FROM public.tickets WHERE order_id = v_order;

  SELECT count(*) INTO v_n FROM public.ticket_event_dates WHERE ticket_id = v_pass;
  PERFORM pg_temp.i2160_assert(v_n = 0,
    'H-03b legacy: ZERO entitlement rows — "not day-scoped", never narrowed');

  -- Admits on ANY occurrence, exactly as it does today. Day 3 here.
  PERFORM pg_temp.i2160_place_day(v_days[1], 'past');
  PERFORM pg_temp.i2160_place_day(v_days[2], 'past');
  PERFORM pg_temp.i2160_place_day(v_days[3], 'live');
  v_res := pg_temp.i2160_scan(f.o_event, v_pass, f.o_scanner);
  PERFORM pg_temp.i2160_assert(v_res ->> 'result' = 'success',
    'H-03c legacy: a zero-day pass still admits on ANY occurrence (got ' || (v_res ->> 'result') || ')');
  PERFORM pg_temp.i2160_assert((v_res ->> 'eventDateId')::uuid = v_days[3],
    'H-03d legacy: the scan still RECORDS which day it admitted (SC-10)');
  PERFORM pg_temp.i2160_assert(
    (SELECT status FROM public.tickets WHERE id = v_pass) = 'used',
    'H-03e legacy: the one-shot lifecycle is unchanged — status flips to used');
  PERFORM pg_temp.i2160_assert(
    (pg_temp.i2160_scan(f.o_event, v_pass, f.o_scanner) ->> 'result') = 'duplicate',
    'H-03f legacy: a second scan is a duplicate, exactly as today');
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- H-04 — PER_DAY ROUND-ROBIN. qty 2 x 2 days -> 4 passes, exactly 2 per day.
-- Amendment §10 T-26.
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE f record; v_days uuid[]; v_order uuid; v_n int;
BEGIN
  SELECT * INTO f FROM pg_temp.i2160_event('roundrobin', 'per_day', 3);
  v_days := pg_temp.i2160_days(f.o_event);
  v_order := pg_temp.i2160_reserve(f.o_event, f.o_ticket_type,
                                   ARRAY[v_days[1], v_days[2]], 2);

  SELECT count(*) INTO v_n FROM public.tickets WHERE order_id = v_order;
  PERFORM pg_temp.i2160_assert(v_n = 4, 'H-04a per_day: qty 2 x 2 days -> 4 passes (got ' || v_n || ')');

  SELECT count(*) INTO v_n FROM public.ticket_event_dates ted
    JOIN public.tickets t ON t.id = ted.ticket_id
   WHERE t.order_id = v_order AND ted.event_date_id = v_days[1];
  PERFORM pg_temp.i2160_assert(v_n = 2, 'H-04b per_day: exactly 2 passes for day 1 (got ' || v_n || ')');

  SELECT count(*) INTO v_n FROM public.ticket_event_dates ted
    JOIN public.tickets t ON t.id = ted.ticket_id
   WHERE t.order_id = v_order AND ted.event_date_id = v_days[2];
  PERFORM pg_temp.i2160_assert(v_n = 2, 'H-04c per_day: exactly 2 passes for day 2 (got ' || v_n || ')');
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- H-05 — THE DEFAULT GUARANTEE, PROVED RATHER THAN ASSERTED (SC-17).
-- With ONE day chosen the two modes are arithmetically identical: same pass
-- count, same line quantity, same total. That is exactly the selection every
-- guest can make on TODAY's build, which is why DEFAULT 'per_day' cannot
-- reprice any live event.
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  fa record; fb record; da uuid[]; db uuid[]; oa uuid; ob uuid;
  na int; nb int; qa int; qb int; ta int; tb int;
BEGIN
  SELECT * INTO fa FROM pg_temp.i2160_event('one-perday', 'per_day', 2, 100, 1000);
  SELECT * INTO fb FROM pg_temp.i2160_event('one-alldays', 'all_days', 2, 100, 1000);
  da := pg_temp.i2160_days(fa.o_event);
  db := pg_temp.i2160_days(fb.o_event);
  oa := pg_temp.i2160_reserve(fa.o_event, fa.o_ticket_type, ARRAY[da[1]], 1);
  ob := pg_temp.i2160_reserve(fb.o_event, fb.o_ticket_type, ARRAY[db[1]], 1);

  SELECT count(*) INTO na FROM public.tickets WHERE order_id = oa;
  SELECT count(*) INTO nb FROM public.tickets WHERE order_id = ob;
  PERFORM pg_temp.i2160_assert(na = nb AND na = 1,
    'H-05a one day: BOTH modes mint exactly one pass (' || na || ' vs ' || nb || ')');

  SELECT sum(quantity), sum(total_cents) INTO qa, ta
    FROM public.order_line_items WHERE order_id = oa;
  SELECT sum(quantity), sum(total_cents) INTO qb, tb
    FROM public.order_line_items WHERE order_id = ob;
  PERFORM pg_temp.i2160_assert(qa = qb AND ta = tb,
    'H-05b one day: BOTH modes charge the same (qty ' || qa || '/' || qb ||
    ', total ' || ta || '/' || tb || ')');
  PERFORM pg_temp.i2160_assert(
    (SELECT total_cents FROM public.orders WHERE id = oa) =
    (SELECT total_cents FROM public.orders WHERE id = ob),
    'H-05c one day: the ORDER totals are identical across modes');

  -- And the per-day multiplier really does bite at 2 days, so H-05a..c are not
  -- passing merely because the multiplier is dead.
  oa := pg_temp.i2160_reserve(fa.o_event, fa.o_ticket_type, ARRAY[da[1], da[2]], 1);
  SELECT sum(quantity), sum(total_cents) INTO qa, ta
    FROM public.order_line_items WHERE order_id = oa;
  PERFORM pg_temp.i2160_assert(qa = 2 AND ta = 2000,
    'H-05d control: the SAME per_day event charges 2 units / 2000 for 2 days (got '
    || qa || ' / ' || ta || ')');

  ob := pg_temp.i2160_reserve(fb.o_event, fb.o_ticket_type, ARRAY[db[1], db[2]], 1);
  SELECT sum(quantity), sum(total_cents) INTO qb, tb
    FROM public.order_line_items WHERE order_id = ob;
  PERFORM pg_temp.i2160_assert(qb = 1 AND tb = 1000,
    'H-05e control: the SAME all_days event charges ONCE for 2 days (got '
    || qb || ' / ' || tb || ')');
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- H-06 — THE MODE LOCK (SC-16). Switchable before the first sale; refused
-- after; still switchable when the only ticket is refunded.
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE f record; v_days uuid[]; v_order uuid; v_locked boolean := false;
BEGIN
  SELECT * INTO f FROM pg_temp.i2160_event('lock', 'per_day', 2);
  v_days := pg_temp.i2160_days(f.o_event);

  -- Before the first sale: freely switchable.
  UPDATE public.events SET multi_date_pricing_mode = 'all_days' WHERE id = f.o_event;
  PERFORM pg_temp.i2160_assert(
    (SELECT multi_date_pricing_mode FROM public.events WHERE id = f.o_event) = 'all_days',
    'H-06a lock: switchable before the first sale');
  UPDATE public.events SET multi_date_pricing_mode = 'per_day' WHERE id = f.o_event;

  v_order := pg_temp.i2160_reserve(f.o_event, f.o_ticket_type, ARRAY[v_days[1]], 1);

  BEGIN
    UPDATE public.events SET multi_date_pricing_mode = 'all_days' WHERE id = f.o_event;
  EXCEPTION WHEN OTHERS THEN
    v_locked := (SQLERRM LIKE '%multi_date_pricing_mode_locked%');
  END;
  PERFORM pg_temp.i2160_assert(v_locked,
    'H-06b lock: REFUSED once a live ticket exists');
  PERFORM pg_temp.i2160_assert(
    (SELECT multi_date_pricing_mode FROM public.events WHERE id = f.o_event) = 'per_day',
    'H-06c lock: and the mode did not move');

  -- A fully refunded event may still switch: a refunded pass is not a live
  -- entitlement, and the predicate is the same set capacity treats as consumed.
  UPDATE public.tickets SET status = 'refunded' WHERE order_id = v_order;
  UPDATE public.events SET multi_date_pricing_mode = 'all_days' WHERE id = f.o_event;
  PERFORM pg_temp.i2160_assert(
    (SELECT multi_date_pricing_mode FROM public.events WHERE id = f.o_event) = 'all_days',
    'H-06d lock: an event whose only ticket is refunded may still switch');
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- H-07 — A STALE NON-ANCHOR DAY IS REFUSED AT FINALIZE (SPEC §C, T-9).
-- Without the appended clause in issue_1930_ticket_session_authorized only the
-- ANCHOR is re-validated, and a session that sat in the cart across the end of
-- day 1 would finalize into a pass for a day that is already over.
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  f record; v_days uuid[]; v_session jsonb; v_sid uuid; v_authorized boolean;
BEGIN
  SELECT * INTO f FROM pg_temp.i2160_event('stale', 'per_day', 3);
  v_days := pg_temp.i2160_days(f.o_event);

  v_session := public.biz_ticket_checkout_create_session(
    f.o_event, NULL, 'Stale Guest', 'stale@example.com', '+15550002222', false,
    jsonb_build_array(jsonb_build_object('ticketTypeId', f.o_ticket_type, 'quantity', 1)),
    'i2160:stale:' || f.o_event::text, now() + interval '15 minutes', 0, 'auto',
    ARRAY[v_days[1], v_days[3]]);
  v_sid := (v_session ->> 'checkoutSessionId')::uuid;

  -- The anchor (day 3) is still fine; the NON-anchor day 1 goes stale.
  UPDATE public.ticket_checkout_sessions
     SET metadata = COALESCE(metadata,'{}'::jsonb)
                    || jsonb_build_object('event_date_id', v_days[3]::text)
   WHERE id = v_sid;
  PERFORM pg_temp.i2160_place_day(v_days[1], 'past');

  v_authorized := public.issue_1930_ticket_session_authorized(v_sid, f.o_event);
  PERFORM pg_temp.i2160_assert(v_authorized = false,
    'H-07 stale non-anchor day: finalize is refused, so no pass mints for a day that is over');
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- H-08 — CAPACITY AGGREGATES PER TICKET TYPE ACROSS THE WHOLE CART.
-- I-PROPOSED-2160-C. THIS ONE PROTECTS MONEY.
--
-- ⚠️  ADDED AFTER A TESTER FINDING, AND THE FINDING WAS FAIR. The tester
-- deleted the 5-line aggregation from the create-session base and THIS SUITE
-- STAYED GREEN — the invariant the spec calls the one that protects money had
-- only a strict-grep regex behind it, not an executable guard. A regex goes red
-- on a reformat and green on a real regression. That is the #2175 bug class
-- (a check that carries no information) sitting inside the fix for it.
--
-- THE HOLE: the pre-#2160 check compared `v_sold + v_reserved + v_qty` where
-- v_qty is THIS LINE alone, and the session's own items are inserted AFTER the
-- validation loop — so a second line of the SAME ticket_type was invisible to
-- the first line's check and both passed independently. This EXECUTES that
-- shape against a real cap and counts real rows.
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  f record; v_err text; v_session jsonb; v_minted int; v_reserved int;
BEGIN
  -- quantity_total = 1: exactly one admission may ever be sold.
  SELECT * INTO f FROM pg_temp.i2160_event('capacity', 'per_day', 2, 1);

  BEGIN
    v_session := public.biz_ticket_checkout_create_session(
      f.o_event, NULL, 'Oversell Guest', 'oversell@example.com', '+15550008888', false,
      -- TWO LINES OF THE SAME TICKET TYPE. Unreachable from today's client, and
      -- exactly the shape any future bundle / add-on feature will send.
      jsonb_build_array(
        jsonb_build_object('ticketTypeId', f.o_ticket_type, 'quantity', 1),
        jsonb_build_object('ticketTypeId', f.o_ticket_type, 'quantity', 1)),
      'i2160:capacity:' || f.o_event::text, now() + interval '15 minutes', 0, 'auto', NULL);
    v_err := NULL;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;

  PERFORM pg_temp.i2160_assert(v_err LIKE '%ticket_capacity_exceeded%',
    'H-08a two lines of one ticket type against quantity_total=1 are REFUSED (got '
    || COALESCE(v_err, 'NO ERROR — THE CART WAS ACCEPTED') || ')');

  -- ...and nothing was reserved. A refusal that still holds inventory is an
  -- oversell with extra steps.
  SELECT COALESCE(SUM(i.quantity), 0)::int INTO v_reserved
    FROM public.ticket_checkout_session_items i
    JOIN public.ticket_checkout_sessions ss ON ss.id = i.checkout_session_id
   WHERE i.ticket_type_id = f.o_ticket_type;
  PERFORM pg_temp.i2160_assert(v_reserved = 0,
    'H-08b and ZERO units were reserved (got ' || v_reserved || ')');

  SELECT count(*) INTO v_minted FROM public.tickets WHERE event_id = f.o_event;
  PERFORM pg_temp.i2160_assert(v_minted = 0,
    'H-08c and ZERO tickets exist (got ' || v_minted || ')');

  -- The control: ONE line of quantity 1 against the same cap still succeeds, so
  -- H-08a is not passing because the whole cart path is broken.
  v_session := public.biz_ticket_checkout_create_session(
    f.o_event, NULL, 'Honest Guest', 'honest@example.com', '+15550009999', false,
    jsonb_build_array(jsonb_build_object('ticketTypeId', f.o_ticket_type, 'quantity', 1)),
    'i2160:capacity-ok:' || f.o_event::text, now() + interval '15 minutes', 0, 'auto', NULL);
  PERFORM pg_temp.i2160_assert(
    (v_session ->> 'checkoutSessionId') IS NOT NULL,
    'H-08d CONTROL: a single honest line against the same cap still succeeds');
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- H-09 — THE PER-DAY MULTIPLIER IS ALSO CAPACITY. A guest picking 2 days of a
-- quantity_total=1 ticket consumes 2 units under per_day and is refused.
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE f record; v_days uuid[]; v_err text; v_n int;
BEGIN
  SELECT * INTO f FROM pg_temp.i2160_event('capacity-days', 'per_day', 2, 1);
  v_days := pg_temp.i2160_days(f.o_event);
  BEGIN
    PERFORM public.biz_ticket_checkout_create_session(
      f.o_event, NULL, 'Two Day Guest', 'twoday@example.com', '+15550001010', false,
      jsonb_build_array(jsonb_build_object('ticketTypeId', f.o_ticket_type, 'quantity', 1)),
      'i2160:capdays:' || f.o_event::text, now() + interval '15 minutes', 0, 'auto',
      ARRAY[v_days[1], v_days[2]]);
    v_err := NULL;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  PERFORM pg_temp.i2160_assert(v_err LIKE '%ticket_capacity_exceeded%',
    'H-09a per_day: 2 days x qty 1 needs 2 units and a cap of 1 REFUSES it (got '
    || COALESCE(v_err,'NO ERROR') || ')');
  SELECT count(*) INTO v_n FROM public.tickets WHERE event_id = f.o_event;
  PERFORM pg_temp.i2160_assert(v_n = 0, 'H-09b and zero tickets exist');

  -- all_days consumes ONE unit for the same two days — one pass sold once.
  UPDATE public.events SET multi_date_pricing_mode = 'all_days' WHERE id = f.o_event;
  PERFORM pg_temp.i2160_assert(
    (public.biz_ticket_checkout_create_session(
      f.o_event, NULL, 'All Days Guest', 'alldays2@example.com', '+15550001111', false,
      jsonb_build_array(jsonb_build_object('ticketTypeId', f.o_ticket_type, 'quantity', 1)),
      'i2160:capdays2:' || f.o_event::text, now() + interval '15 minutes', 0, 'auto',
      ARRAY[v_days[1], v_days[2]]) ->> 'checkoutSessionId') IS NOT NULL,
    'H-09c all_days: the SAME two days consume ONE unit and fit the cap of 1');
END $$;

DO $$ BEGIN RAISE NOTICE 'issue #2160 multiday admission suite: ALL CHECKS PASSED'; END $$;
