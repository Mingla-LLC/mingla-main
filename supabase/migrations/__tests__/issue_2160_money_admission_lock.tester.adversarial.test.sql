-- issue #2160 + #2150 — TESTER ADVERSARIAL suite. EXECUTED against real
-- PostgreSQL, never simulated.
--
-- ── WHY THIS FILE EXISTS, AND HOW IT DIFFERS FROM THE IMPLEMENTOR'S ────────
-- `issue_2160_multiday_admission.test.sql` (H-01..H-07) proves the HAPPY
-- SHAPE: per-mode mint, round-robin, the default guarantee, the lock through
-- one path, and a stale non-anchor day. It contains NO capacity check at all,
-- NO concurrency check, NO check that a pass is refused on a day that has not
-- STARTED, and NO check of the #2150 possession gate under a multi-day order.
--
-- This file attacks the four things that were left uncovered, in the order
-- they would hurt:
--
--   G — MONEY. Capacity is the only thing standing between `per_day` and an
--       oversold room. On this branch it is guarded by a strict-grep that
--       reads the migration's SOURCE TEXT
--       (.github/scripts/strict-grep/issue-2160-capacity-aggregated.mjs).
--       #2175 is open precisely because five source-text assertions drifted
--       from the behaviour they named while nothing executed them. So every
--       capacity claim below is made by EXECUTING create-session and counting
--       real rows, never by grepping.
--
--   A — ADMISSION. The invariant is "a pass admits exactly the days it has
--       rows for". The implementor proved a pass is refused on a day that has
--       ENDED. It is refused on a day that has not STARTED that is neither
--       here nor anywhere in its set — the case where SOME occurrence of the
--       event IS live and the legacy any-occurrence rung would say `success`.
--
--   L — THE LOCK. Proven through paths the implementor did not use: a
--       `transferred` pass, a `void` pass, an unrelated event of the same
--       brand, and — the regression that would be discovered by an angry
--       organiser rather than by CI — a NO-OP write of the unchanged mode
--       inside an ordinary event edit, which must NOT brick editing after the
--       first sale.
--
--   D — DISCLOSURE (#2150 under multi-day). Knowledge of email + phone + cart
--       must never be enough to be handed a multi-day order's QR payloads,
--       and the day-aware idempotency key must separate a genuine second-day
--       reservation from a duplicate submit.
--
-- ── SCOPE NOTE, STATED PLAINLY ────────────────────────────────────────────
-- The tester's live-fire run ALSO found a real defect that is NOT asserted
-- here, because a tester does not land a red suite: the pricing mode is read
-- at create-session AND AGAIN at finalize with no snapshot on the session, so
-- an organiser flipping the mode while a guest's checkout is in flight
-- changes what that guest's already-priced reservation mints. The lock cannot
-- prevent it because no ticket exists yet. The reproduction is in the QA
-- verdict. When it is fixed, the fix's own regression test belongs here.
--
-- ── INVARIANTS UNDER TEST ─────────────────────────────────────────────────
--   I-PROPOSED-2160-A  TICKET-IS-THE-DAY-AUTHORITY
--   I-PROPOSED-2160-C  CART-CAPACITY-AGGREGATES-PER-TICKET-TYPE
--   I-PROPOSED-2160-E  DAY-BOUND-PASS-ADMITS-ONLY-ITS-DAY
--   I-PROPOSED-2150-FREE-COMPLETED-SESSION-IDEMPOTENT
--
-- Every check RAISEs on failure, so the psql exit code is the verdict.

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.x2160_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #2160 TESTER-ADVERSARIAL FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END $$;

-- A published multi-date event. `p_cap` is the whole point of the G-block, so
-- it is a first-class argument rather than a constant.
CREATE OR REPLACE FUNCTION pg_temp.x2160_event(
  p_tag text, p_mode text, p_days int, p_price int, p_cap int,
  OUT o_event uuid, OUT o_ticket_type uuid, OUT o_scanner uuid,
  OUT o_owner uuid, OUT o_brand uuid
) LANGUAGE plpgsql AS $$
DECLARE v_i int;
BEGIN
  o_event := gen_random_uuid(); o_scanner := gen_random_uuid();
  o_owner := gen_random_uuid(); o_brand := gen_random_uuid();
  INSERT INTO auth.users(id) VALUES (o_owner), (o_scanner);
  INSERT INTO public.creator_accounts(id) VALUES (o_owner);
  -- A priced fixture needs a real currency on BOTH brand and event, or
  -- `tg_enforce_event_ticket_currency` refuses the ticket_type. Paystack on
  -- the paid fixture so the Stripe readiness gate is not what is under test.
  INSERT INTO public.brands(id, account_id, name, slug, default_currency, payment_provider)
    VALUES (o_brand, o_owner, 'x2160 ' || p_tag, 'x2160-' || p_tag || '-' || o_brand,
            CASE WHEN p_price = 0 THEN NULL ELSE 'GBP' END,
            CASE WHEN p_price = 0 THEN 'stripe' ELSE 'paystack' END);
  INSERT INTO public.events(id, brand_id, title, slug, event_type, status, visibility,
                            timezone, is_multi_date, multi_date_pricing_mode, currency)
    VALUES (o_event, o_brand, 'x2160 ' || p_tag, 'x2160-' || p_tag || '-' || o_event,
            'event', 'draft', 'draft', 'UTC', true, p_mode,
            CASE WHEN p_price = 0 THEN NULL ELSE 'GBP' END);
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
    VALUES (o_event, 'Entry', p_price, p_price = 0, p_cap, 1, true, true, 0,
            CASE WHEN p_price = 0 THEN NULL ELSE 'GBP' END)
    RETURNING id INTO o_ticket_type;
  INSERT INTO public.event_scanners(event_id, user_id) VALUES (o_event, o_scanner);
  PERFORM set_config('mingla.publish_free_only', 'on', true);
  UPDATE public.events SET status = 'scheduled', visibility = 'hidden', published_at = now()
   WHERE id = o_event;
  PERFORM set_config('mingla.publish_free_only', '', true);
END $$;

CREATE OR REPLACE FUNCTION pg_temp.x2160_days(p_event uuid)
RETURNS uuid[] LANGUAGE sql AS $$
  SELECT ARRAY(SELECT id FROM public.event_dates WHERE event_id = p_event
                ORDER BY start_at, id);
$$;

-- Move ONE occurrence relative to now(). The scan RPC reads `event_dates`
-- live, so this is real time travel for the function under test.
CREATE OR REPLACE FUNCTION pg_temp.x2160_place(p_day uuid, p_where text)
RETURNS void LANGUAGE sql AS $$
  UPDATE public.event_dates
     SET start_at = CASE p_where
           WHEN 'live'   THEN now() - interval '1 hour'
           WHEN 'past'   THEN now() - interval '5 days'
           WHEN 'future' THEN now() + interval '5 days' END,
         end_at = CASE p_where
           WHEN 'live'   THEN now() + interval '5 hours'
           WHEN 'past'   THEN now() - interval '5 days' + interval '5 hours'
           WHEN 'future' THEN now() + interval '5 days' + interval '5 hours' END
   WHERE id = p_day;
$$;

-- Reserve + finalize exactly as `ticket-checkout-create` does: create-session
-- (carrying the day set), write the SERVER-DERIVED anchor into metadata, then
-- finalize. Returns the order id.
CREATE OR REPLACE FUNCTION pg_temp.x2160_reserve(
  p_event uuid, p_ticket_type uuid, p_days uuid[], p_qty int, p_key text
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_session jsonb; v_sid uuid; v_anchor uuid;
BEGIN
  v_session := public.biz_ticket_checkout_create_session(
    p_event, NULL, 'Adversarial Guest', p_key || '@example.com', '+15550009999', false,
    jsonb_build_array(jsonb_build_object('ticketTypeId', p_ticket_type, 'quantity', p_qty)),
    p_key, now() + interval '15 minutes', 0, 'auto', p_days);
  v_sid := (v_session ->> 'checkoutSessionId')::uuid;
  IF p_days IS NOT NULL AND array_length(p_days, 1) > 0 THEN
    SELECT d.id INTO v_anchor FROM public.event_dates d
     WHERE d.id = ANY (p_days) ORDER BY d.end_at DESC, d.id DESC LIMIT 1;
    UPDATE public.ticket_checkout_sessions
       SET metadata = COALESCE(metadata, '{}'::jsonb)
                      || jsonb_build_object('event_date_id', v_anchor::text)
     WHERE id = v_sid;
  END IF;
  RETURN (public.issue_1930_ticket_checkout_finalize_base(
            v_sid,
            CASE WHEN (v_session ->> 'totalCents')::int > 0
                 THEN 'pi_x2160_' || replace(v_sid::text, '-', '') END,
            NULL, NULL, 'i2160-test-pepper-0123456789abcdef', NULL, NULL, false
          ) ->> 'orderId')::uuid;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.x2160_scan(p_event uuid, p_ticket uuid, p_scanner uuid)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.biz_ticket_scan(
           p_event, (SELECT qr_code FROM public.tickets WHERE id = p_ticket),
           p_scanner, 'i2160-test-pepper-0123456789abcdef');
$$;

-- Run create-session and report the SQLERRM instead of aborting, so a refusal
-- can be asserted on by name rather than by "it threw something".
CREATE OR REPLACE FUNCTION pg_temp.x2160_try_reserve(
  p_event uuid, p_ticket_type uuid, p_days uuid[], p_qty int, p_key text
) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.biz_ticket_checkout_create_session(
    p_event, NULL, 'Adversarial Guest', p_key || '@example.com', '+15550009999', false,
    jsonb_build_array(jsonb_build_object('ticketTypeId', p_ticket_type, 'quantity', p_qty)),
    p_key, now() + interval '15 minutes', 0, 'auto', p_days);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- G — MONEY. `quantity_total` CANNOT BE OVERSOLD, ACROSS DAYS, MODES OR
--     CONCURRENT BUYERS. Executed, not grepped.
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE f record; d uuid[]; v_err text; v_n int; v_order uuid;
BEGIN
  -- ── G-1 — THE ONE THAT PROTECTS MONEY.
  -- `quantity_total = 1`. A guest picking BOTH days of a `per_day` event is
  -- asking for TWO admissions against a cap of one. The multiplier must be
  -- inside the capacity comparison, not applied after it.
  SELECT * INTO f FROM pg_temp.x2160_event('cap-perday', 'per_day', 2, 1000, 1);
  d := pg_temp.x2160_days(f.o_event);
  v_err := pg_temp.x2160_try_reserve(f.o_event, f.o_ticket_type, ARRAY[d[1], d[2]], 1,
                                     'x2160-g1-' || f.o_event::text);
  PERFORM pg_temp.x2160_assert(v_err LIKE '%ticket_capacity_exceeded%',
    'G-1a per_day cap=1, 2 days: refused with ticket_capacity_exceeded (got '
    || COALESCE(v_err, 'NO ERROR — OVERSOLD') || ')');

  -- ...and the refusal is TOTAL. A capacity check that raises after inserting
  -- is not a capacity check.
  SELECT count(*) INTO v_n FROM public.ticket_checkout_session_items i
   WHERE i.ticket_type_id = f.o_ticket_type;
  PERFORM pg_temp.x2160_assert(v_n = 0,
    'G-1b per_day cap=1: ZERO session items survive the refusal (got ' || v_n || ')');
  SELECT count(*) INTO v_n FROM public.tickets WHERE ticket_type_id = f.o_ticket_type;
  PERFORM pg_temp.x2160_assert(v_n = 0,
    'G-1c per_day cap=1: ZERO tickets exist afterwards (got ' || v_n || ')');
  SELECT count(*) INTO v_n FROM public.ticket_checkout_session_event_dates s
    JOIN public.ticket_checkout_sessions ss ON ss.id = s.checkout_session_id
   WHERE ss.event_id = f.o_event;
  PERFORM pg_temp.x2160_assert(v_n = 0,
    'G-1d per_day cap=1: ZERO chosen-day rows leak from the refused session (got ' || v_n || ')');

  -- ── G-2 — the boundary. Cap 2, two days: allowed, and it consumes BOTH.
  SELECT * INTO f FROM pg_temp.x2160_event('cap-edge', 'per_day', 2, 1000, 2);
  d := pg_temp.x2160_days(f.o_event);
  v_order := pg_temp.x2160_reserve(f.o_event, f.o_ticket_type, ARRAY[d[1], d[2]], 1,
                                   'x2160-g2-' || f.o_event::text);
  SELECT count(*) INTO v_n FROM public.tickets WHERE order_id = v_order;
  PERFORM pg_temp.x2160_assert(v_n = 2,
    'G-2a per_day cap=2, 2 days: exactly at the cap, 2 passes minted (got ' || v_n || ')');
  -- The room is now full. A SECOND guest wanting ONE day must be refused —
  -- the first guest consumed 2 units for 2 days, not 1 unit for a reservation.
  v_err := pg_temp.x2160_try_reserve(f.o_event, f.o_ticket_type, ARRAY[d[1]], 1,
                                     'x2160-g2b-' || f.o_event::text);
  PERFORM pg_temp.x2160_assert(v_err LIKE '%ticket_capacity_exceeded%',
    'G-2b per_day: a both-days guest consumed 2 units, so the next guest is refused (got '
    || COALESCE(v_err, 'NO ERROR — OVERSOLD') || ')');

  -- ── G-3 — CONCURRENT BUYERS, via the reservation ledger.
  -- Buyer A's multi-day session is still IN FLIGHT (never finalized). The
  -- `v_reserved` sum must see A's MULTIPLIED quantity, not the raw one the
  -- client sent, or two guests each reserve the last seat.
  SELECT * INTO f FROM pg_temp.x2160_event('cap-inflight', 'per_day', 2, 1000, 2);
  d := pg_temp.x2160_days(f.o_event);
  PERFORM public.biz_ticket_checkout_create_session(
    f.o_event, NULL, 'Buyer A', 'ga@example.com', '+15550001111', false,
    jsonb_build_array(jsonb_build_object('ticketTypeId', f.o_ticket_type, 'quantity', 1)),
    'x2160-g3a-' || f.o_event::text, now() + interval '15 minutes', 0, 'auto',
    ARRAY[d[1], d[2]]);
  SELECT COALESCE(SUM(i.quantity), 0) INTO v_n
    FROM public.ticket_checkout_session_items i
   WHERE i.ticket_type_id = f.o_ticket_type;
  PERFORM pg_temp.x2160_assert(v_n = 2,
    'G-3a the in-flight session RESERVES the multiplied quantity, 2 not 1 (got ' || v_n || ')');
  v_err := pg_temp.x2160_try_reserve(f.o_event, f.o_ticket_type, ARRAY[d[1]], 1,
                                     'x2160-g3b-' || f.o_event::text);
  PERFORM pg_temp.x2160_assert(v_err LIKE '%ticket_capacity_exceeded%',
    'G-3b buyer B is refused while A holds both units UNFINALIZED (got '
    || COALESCE(v_err, 'NO ERROR — OVERSOLD against an in-flight reservation') || ')');

  -- ── G-4 — `all_days` consumes ONE unit, and only one.
  -- The mode must not be able to make a single sale eat D units, nor to let a
  -- sold-out event sell again.
  SELECT * INTO f FROM pg_temp.x2160_event('cap-alldays', 'all_days', 3, 1000, 1);
  d := pg_temp.x2160_days(f.o_event);
  v_order := pg_temp.x2160_reserve(f.o_event, f.o_ticket_type, ARRAY[d[1], d[2], d[3]], 1,
                                   'x2160-g4-' || f.o_event::text);
  SELECT count(*) INTO v_n FROM public.tickets WHERE order_id = v_order;
  PERFORM pg_temp.x2160_assert(v_n = 1,
    'G-4a all_days cap=1, THREE days: one pass sold once, cap intact (got ' || v_n || ')');
  SELECT count(*) INTO v_n FROM public.ticket_event_dates ted
    JOIN public.tickets t ON t.id = ted.ticket_id WHERE t.order_id = v_order;
  PERFORM pg_temp.x2160_assert(v_n = 3,
    'G-4b all_days: that ONE pass carries all three entitlements (got ' || v_n || ')');
  SELECT sum(total_cents) INTO v_n FROM public.order_line_items WHERE order_id = v_order;
  PERFORM pg_temp.x2160_assert(v_n = 1000,
    'G-4c all_days: charged ONCE for three days — the mode cannot be made to charge N x (got '
    || v_n || ')');
  v_err := pg_temp.x2160_try_reserve(f.o_event, f.o_ticket_type, ARRAY[d[1]], 1,
                                     'x2160-g4d-' || f.o_event::text);
  PERFORM pg_temp.x2160_assert(v_err LIKE '%ticket_capacity_exceeded%',
    'G-4d all_days: a sold-out event refuses the next guest (got '
    || COALESCE(v_err, 'NO ERROR — OVERSOLD') || ')');

  -- ── G-5 — TWO LINES OF ONE TICKET TYPE IN ONE CART.
  -- The aggregation, EXECUTED. issue-2160-capacity-aggregated.mjs asserts this
  -- by reading the migration's source text; this asserts it by minting.
  -- Revert the aggregation to the per-line comparison and this goes RED.
  SELECT * INTO f FROM pg_temp.x2160_event('cap-twolines', 'per_day', 2, 1000, 1);
  BEGIN
    PERFORM public.biz_ticket_checkout_create_session(
      f.o_event, NULL, 'Two Lines', 'g5@example.com', '+15550001111', false,
      jsonb_build_array(
        jsonb_build_object('ticketTypeId', f.o_ticket_type, 'quantity', 1),
        jsonb_build_object('ticketTypeId', f.o_ticket_type, 'quantity', 1)),
      'x2160-g5-' || f.o_event::text, now() + interval '15 minutes', 0, 'auto', NULL);
    v_err := NULL;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  PERFORM pg_temp.x2160_assert(v_err LIKE '%ticket_capacity_exceeded%',
    'G-5 two lines of ONE ticket type against cap=1: refused (got '
    || COALESCE(v_err, 'NO ERROR — OVERSOLD via a second line of the same type') || ')');
END $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- A — ADMISSION. A pass admits EXACTLY the days it has rows for.
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  f record; d uuid[]; v_order uuid; v_pass uuid; v_res jsonb; v_n int; v_err text;
BEGIN
  -- ── A-1 — THE CASE THE LEGACY RUNG WOULD GET WRONG.
  -- The guest bought day 3 ONLY. Day 1 is LIVE right now. The pre-#2160
  -- any-occurrence window asks "is ANY occurrence of this event in window",
  -- which is TRUE — so a pass that has not started must be refused by the
  -- PASS'S OWN set, and the refusal must be `not_yet_open`, not `event_ended`
  -- (the guest is early, not late, and the scanner UI says different things).
  SELECT * INTO f FROM pg_temp.x2160_event('admit-early', 'per_day', 3, 0, 100);
  d := pg_temp.x2160_days(f.o_event);
  v_order := pg_temp.x2160_reserve(f.o_event, f.o_ticket_type, ARRAY[d[3]], 1,
                                   'x2160-a1-' || f.o_event::text);
  SELECT id INTO v_pass FROM public.tickets WHERE order_id = v_order;
  PERFORM pg_temp.x2160_place(d[1], 'live');
  PERFORM pg_temp.x2160_place(d[2], 'future');
  PERFORM pg_temp.x2160_place(d[3], 'future');
  v_res := pg_temp.x2160_scan(f.o_event, v_pass, f.o_scanner);
  PERFORM pg_temp.x2160_assert(v_res ->> 'result' = 'not_yet_open',
    'A-1a a day-3 pass is REFUSED while day 1 is LIVE, and is told it is EARLY (got '
    || (v_res ->> 'result') || ')');
  PERFORM pg_temp.x2160_assert((v_res ->> 'result') <> 'success',
    'A-1b — and is NEVER admitted on a day it did not buy while another day runs');
  PERFORM pg_temp.x2160_assert(
    (v_res -> 'nextStartAt') IS NOT NULL AND (v_res ->> 'nextStartAt') <> '',
    'A-1c the refusal names WHEN the guest may come, from the PASS''S set');
  -- The refusal is attributable: it records the day they were presenting for.
  PERFORM pg_temp.x2160_assert(
    (SELECT se.event_date_id FROM public.scan_events se
      WHERE se.ticket_id = v_pass ORDER BY se.scanned_at DESC, se.id DESC LIMIT 1) = d[3],
    'A-1d the refusal records the day the pass is FOR, so it is attributable');
  -- The refusal must not have consumed the pass.
  PERFORM pg_temp.x2160_assert(
    (SELECT status FROM public.tickets WHERE id = v_pass) = 'valid'
    AND (SELECT used_at FROM public.tickets WHERE id = v_pass) IS NULL,
    'A-1e a refusal does NOT consume the pass — the guest can still come on day 3');

  -- ...and on its own day it admits, exactly once.
  PERFORM pg_temp.x2160_place(d[1], 'past');
  PERFORM pg_temp.x2160_place(d[3], 'live');
  PERFORM pg_temp.x2160_assert(
    (pg_temp.x2160_scan(f.o_event, v_pass, f.o_scanner) ->> 'result') = 'success',
    'A-1f the same pass IS admitted once day 3 arrives');
  PERFORM pg_temp.x2160_assert(
    (pg_temp.x2160_scan(f.o_event, v_pass, f.o_scanner) ->> 'result') = 'duplicate',
    'A-1g and a second presentation on that day is a duplicate, not a second admission');
  SELECT count(*) INTO v_n FROM public.scan_events
   WHERE ticket_id = v_pass AND scan_result = 'success';
  PERFORM pg_temp.x2160_assert(v_n = 1,
    'A-1h exactly ONE success row exists for that pass, ever (got ' || v_n || ')');

  -- ── A-2 — THE LEDGER IS ENFORCED BY THE DATABASE, NOT ONLY BY THE RUNG.
  -- The amendment leans on `scan_events_ticket_day_success_once` as
  -- belt-and-braces for the case the row lock is ever weakened. An index that
  -- is never violated is indistinguishable from an index that is not there,
  -- so violate it on purpose.
  BEGIN
    INSERT INTO public.scan_events(ticket_id, event_id, scanner_user_id, scan_result,
                                   client_offline, event_date_id, synced_at)
      VALUES (v_pass, f.o_event, f.o_scanner, 'success', false, d[3], now());
    v_err := NULL;
  EXCEPTION WHEN unique_violation THEN v_err := SQLERRM; END;
  PERFORM pg_temp.x2160_assert(
    v_err LIKE '%scan_events_ticket_day_success_once%',
    'A-2 the partial unique index REFUSES a second success row for one (ticket, day), '
    'even written directly (got ' || COALESCE(v_err, 'NO ERROR — the index is not enforcing') || ')');

  -- ── A-3 — A REFUNDED DAY-SCOPED PASS IS VOID AT THE DOOR.
  -- The day-scoped rung admits `valid` and `used` (an all_days pass admits
  -- again after its first day). Everything else must fall to `void`, or a
  -- refunded multi-day guest walks in.
  SELECT * INTO f FROM pg_temp.x2160_event('admit-refund', 'all_days', 2, 0, 100);
  d := pg_temp.x2160_days(f.o_event);
  v_order := pg_temp.x2160_reserve(f.o_event, f.o_ticket_type, ARRAY[d[1], d[2]], 1,
                                   'x2160-a3-' || f.o_event::text);
  SELECT id INTO v_pass FROM public.tickets WHERE order_id = v_order;
  PERFORM pg_temp.x2160_place(d[1], 'live');
  UPDATE public.tickets SET status = 'refunded' WHERE id = v_pass;
  PERFORM pg_temp.x2160_assert(
    (pg_temp.x2160_scan(f.o_event, v_pass, f.o_scanner) ->> 'result') = 'void',
    'A-3a a REFUNDED all_days pass is void at the door, not admitted');
  UPDATE public.tickets SET status = 'void' WHERE id = v_pass;
  PERFORM pg_temp.x2160_assert(
    (pg_temp.x2160_scan(f.o_event, v_pass, f.o_scanner) ->> 'result') = 'void',
    'A-3b a VOIDED all_days pass is void at the door');
  SELECT count(*) INTO v_n FROM public.scan_events
   WHERE ticket_id = v_pass AND scan_result = 'success';
  PERFORM pg_temp.x2160_assert(v_n = 0,
    'A-3c no success row was ever written for a dead pass (got ' || v_n || ')');

  -- ── A-4 — A DAY THE GUEST NEVER BOUGHT CANNOT BE BOUGHT LATER BY MISTAKE.
  -- The day set is validated against THIS event and against `end_at > now()`.
  -- These are the two ways a guest could otherwise mint an entitlement for a
  -- day they cannot attend, or for someone else's event entirely.
  SELECT * INTO f FROM pg_temp.x2160_event('admit-validate', 'per_day', 2, 0, 100);
  d := pg_temp.x2160_days(f.o_event);
  PERFORM pg_temp.x2160_assert(
    pg_temp.x2160_try_reserve(f.o_event, f.o_ticket_type,
      ARRAY[d[1], gen_random_uuid()], 1, 'x2160-a4a-' || f.o_event::text)
      LIKE '%occurrence_not_found%',
    'A-4a an unknown occurrence id is refused (occurrence_not_found)');
  PERFORM pg_temp.x2160_place(d[1], 'past');
  PERFORM pg_temp.x2160_assert(
    pg_temp.x2160_try_reserve(f.o_event, f.o_ticket_type, ARRAY[d[1]], 1,
      'x2160-a4b-' || f.o_event::text) LIKE '%occurrence_not_available%',
    'A-4b a day that has already ENDED cannot be reserved (occurrence_not_available)');
END $$;

-- ── A-5 — A DAY BELONGING TO ANOTHER EVENT IS NOT AN ENTITLEMENT.
-- Separate block so the second event's fixture is unambiguous.
DO $$
DECLARE f record; g record; d uuid[]; e uuid[]; v_n int; v_order uuid;
BEGIN
  SELECT * INTO f FROM pg_temp.x2160_event('admit-mineA', 'per_day', 2, 0, 100);
  SELECT * INTO g FROM pg_temp.x2160_event('admit-mineB', 'per_day', 2, 0, 100);
  d := pg_temp.x2160_days(f.o_event);
  e := pg_temp.x2160_days(g.o_event);
  PERFORM pg_temp.x2160_assert(
    pg_temp.x2160_try_reserve(f.o_event, f.o_ticket_type, ARRAY[d[1], e[1]], 1,
      'x2160-a5-' || f.o_event::text) LIKE '%occurrence_not_found%',
    'A-5a a day from ANOTHER event cannot be added to this reservation');
  SELECT count(*) INTO v_n FROM public.ticket_checkout_session_event_dates
   WHERE event_date_id = e[1];
  PERFORM pg_temp.x2160_assert(v_n = 0,
    'A-5b and nothing leaked into the chosen-day table for the other event (got ' || v_n || ')');

  -- ── A-6 — DUPLICATE IDS ARE A SET, NOT A MULTIPLIER.
  -- [d1, d1, d1] must be worth ONE day: one pass, one entitlement, one price.
  -- Treating it as three would let a crafted link triple a guest's bill and
  -- hand them three passes for one day.
  -- (The order id is bound to a variable first: x2160_reserve is VOLATILE, so
  -- calling it inside a WHERE clause would re-mint per candidate row.)
  v_order := pg_temp.x2160_reserve(g.o_event, g.o_ticket_type,
                                   ARRAY[e[1], e[1], e[1]], 1,
                                   'x2160-a6-' || g.o_event::text);
  SELECT count(*) INTO v_n FROM public.tickets WHERE order_id = v_order;
  PERFORM pg_temp.x2160_assert(v_n = 1,
    'A-6a [d1,d1,d1] is de-duplicated to ONE day: one pass, not three (got ' || v_n || ')');
  SELECT count(*) INTO v_n FROM public.ticket_event_dates ted
    JOIN public.tickets t ON t.id = ted.ticket_id WHERE t.order_id = v_order;
  PERFORM pg_temp.x2160_assert(v_n = 1,
    'A-6b — carrying exactly ONE entitlement row (got ' || v_n || ')');
  SELECT COALESCE(sum(quantity), -1) INTO v_n FROM public.order_line_items
   WHERE order_id = v_order;
  PERFORM pg_temp.x2160_assert(v_n = 1,
    'A-6c — and billed as ONE unit, so a repeated id cannot inflate the bill (got '
    || v_n || ')');
END $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- L — THE LOCK, through the paths the implementor did not walk.
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE f record; g record; d uuid[]; v_order uuid; v_err text;
BEGIN
  SELECT * INTO f FROM pg_temp.x2160_event('lock-paths', 'per_day', 2, 0, 100);
  d := pg_temp.x2160_days(f.o_event);
  v_order := pg_temp.x2160_reserve(f.o_event, f.o_ticket_type, ARRAY[d[1]], 1,
                                   'x2160-l1-' || f.o_event::text);

  -- ── L-1 — THE REGRESSION AN ORGANISER WOULD FIND, NOT CI.
  -- A client that PATCHes the whole event row re-sends the unchanged mode with
  -- every edit. If the trigger fired on the write rather than on the CHANGE,
  -- an organiser could not rename their own event after the first sale.
  BEGIN
    UPDATE public.events
       SET multi_date_pricing_mode = 'per_day', title = 'renamed after the first sale'
     WHERE id = f.o_event;
    v_err := NULL;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  PERFORM pg_temp.x2160_assert(v_err IS NULL,
    'L-1 a NO-OP mode write inside an ordinary edit is allowed after a sale — the '
    'organiser is not bricked (got ' || COALESCE(v_err, 'ok') || ')');

  -- ── L-2 — A TRANSFERRED PASS IS A LIVE ENTITLEMENT AND HOLDS THE LOCK.
  -- The implementor proved `refunded` RELEASES it. The other half of the
  -- predicate is that `transferred` does not: a pass in someone else's hands
  -- is still a pass that will be presented at a door.
  UPDATE public.tickets SET status = 'transferred' WHERE order_id = v_order;
  BEGIN
    UPDATE public.events SET multi_date_pricing_mode = 'all_days' WHERE id = f.o_event;
    v_err := NULL;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  PERFORM pg_temp.x2160_assert(v_err LIKE '%multi_date_pricing_mode_locked%',
    'L-2a a TRANSFERRED pass still holds the lock (got '
    || COALESCE(v_err, 'ALLOWED — the lock leaked') || ')');
  PERFORM pg_temp.x2160_assert(
    (SELECT multi_date_pricing_mode FROM public.events WHERE id = f.o_event) = 'per_day',
    'L-2b and the mode did not move');

  -- ── L-3 — a VOID pass is not a live entitlement, so it releases the lock.
  UPDATE public.tickets SET status = 'void' WHERE order_id = v_order;
  BEGIN
    UPDATE public.events SET multi_date_pricing_mode = 'all_days' WHERE id = f.o_event;
    v_err := NULL;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  PERFORM pg_temp.x2160_assert(v_err IS NULL,
    'L-3 an event whose only pass is VOID may still switch (got '
    || COALESCE(v_err, 'ok') || ')');

  -- ── L-4 — the lock is scoped to THIS event, not to the brand.
  -- `t.event_id = OLD.id`. A busy brand must not have one sold event freeze
  -- the pricing choice on every other event it owns.
  SELECT * INTO g FROM pg_temp.x2160_event('lock-sibling', 'per_day', 2, 0, 100);
  PERFORM pg_temp.x2160_reserve(g.o_event, g.o_ticket_type,
    ARRAY[(pg_temp.x2160_days(g.o_event))[1]], 1, 'x2160-l4-' || g.o_event::text);
  BEGIN
    UPDATE public.events SET multi_date_pricing_mode = 'per_day' WHERE id = f.o_event;
    v_err := NULL;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  PERFORM pg_temp.x2160_assert(v_err IS NULL,
    'L-4 another event holding a live pass does not freeze this one (got '
    || COALESCE(v_err, 'ok') || ')');
END $$;

-- ── L-5 — THE SETTER CANNOT BE USED TO ESCAPE THE TRIGGER, and a scanner
-- cannot use it at all. SECURITY DEFINER + a role check is exactly the shape
-- that hides a privilege hole, so exercise it as each role.
DO $$
DECLARE
  f record; d uuid[]; v_scannerish uuid := gen_random_uuid(); v_err text;
BEGIN
  SELECT * INTO f FROM pg_temp.x2160_event('lock-setter', 'per_day', 2, 0, 100);
  d := pg_temp.x2160_days(f.o_event);
  INSERT INTO auth.users(id) VALUES (v_scannerish);
  INSERT INTO public.brand_team_members(brand_id, user_id, role, accepted_at)
    VALUES (f.o_brand, v_scannerish, 'scanner', now());

  -- A scanner is on the team and must still be refused: door staff do not
  -- price the event.
  -- `auth.uid()` reads request.jwt.claim.sub in this image (verified against
  -- pg_get_functiondef, not assumed) — set it to act as a given user.
  PERFORM set_config('request.jwt.claim.sub', v_scannerish::text, true);
  BEGIN
    PERFORM public.biz_set_event_multi_date_pricing_mode(f.o_event, 'all_days');
    v_err := NULL;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  PERFORM pg_temp.x2160_assert(v_err LIKE '%insufficient_event_permission%',
    'L-5a a SCANNER team member cannot set the pricing mode (got '
    || COALESCE(v_err, 'ALLOWED — privilege hole') || ')');

  -- The owner can, before the first sale.
  PERFORM set_config('request.jwt.claim.sub', f.o_owner::text, true);
  PERFORM pg_temp.x2160_assert(
    public.biz_set_event_multi_date_pricing_mode(f.o_event, 'all_days') = 'all_days',
    'L-5b the owner can set the mode before the first sale');

  -- An invalid value is refused by the setter, and the CHECK constraint is the
  -- second wall behind it.
  BEGIN
    PERFORM public.biz_set_event_multi_date_pricing_mode(f.o_event, 'free_for_all');
    v_err := NULL;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  PERFORM pg_temp.x2160_assert(v_err LIKE '%multi_date_pricing_mode_invalid%',
    'L-5c an unknown mode is refused by name (got '
    || COALESCE(v_err, 'ACCEPTED') || ')');
  PERFORM set_config('request.jwt.claim.sub', '', true);
  BEGIN
    UPDATE public.events SET multi_date_pricing_mode = 'free_for_all' WHERE id = f.o_event;
    v_err := NULL;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  PERFORM pg_temp.x2160_assert(v_err IS NOT NULL,
    'L-5d the CHECK constraint refuses an unknown mode written directly');

  -- After a sale the setter refuses THROUGH the trigger — the setter does not
  -- re-implement the lock, so there is exactly one enforcement site.
  PERFORM pg_temp.x2160_reserve(f.o_event, f.o_ticket_type, ARRAY[d[1], d[2]], 1,
                                'x2160-l5-' || f.o_event::text);
  PERFORM set_config('request.jwt.claim.sub', f.o_owner::text, true);
  BEGIN
    PERFORM public.biz_set_event_multi_date_pricing_mode(f.o_event, 'per_day');
    v_err := NULL;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  PERFORM pg_temp.x2160_assert(v_err LIKE '%multi_date_pricing_mode_locked%',
    'L-5e the setter refuses after the first sale, via the trigger (got '
    || COALESCE(v_err, 'ALLOWED — the mode flipped under a guest holding a pass') || ')');
  -- Re-saving the SAME value must still succeed, or the wizard errors at an
  -- organiser who merely opened the screen.
  BEGIN
    PERFORM public.biz_set_event_multi_date_pricing_mode(f.o_event, 'all_days');
    v_err := NULL;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  PERFORM pg_temp.x2160_assert(v_err IS NULL,
    'L-5f re-saving the UNCHANGED mode after a sale is a no-op, not an error (got '
    || COALESCE(v_err, 'ok') || ')');
  PERFORM set_config('request.jwt.claim.sub', '', true);
END $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- D — DISCLOSURE. #2150's possession gate, exercised on a MULTI-DAY order.
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  f record; d uuid[]; v_session jsonb; v_sid uuid; v_order uuid; v_n int;
  v_stranger uuid := gen_random_uuid();
  v_token_hash text := encode(sha256(('x2160-token-' || gen_random_uuid()::text)::bytea), 'hex');
  v_second jsonb;
BEGIN
  INSERT INTO auth.users(id) VALUES (v_stranger);
  SELECT * INTO f FROM pg_temp.x2160_event('disclose', 'per_day', 2, 0, 100);
  d := pg_temp.x2160_days(f.o_event);

  -- An ANONYMOUS guest completes a free TWO-DAY reservation.
  v_session := public.biz_ticket_checkout_create_session(
    f.o_event, NULL, 'Anon Guest', 'disclose@example.com', '+15550008888', false,
    jsonb_build_array(jsonb_build_object('ticketTypeId', f.o_ticket_type, 'quantity', 1)),
    'x2160-d-' || f.o_event::text, now() + interval '15 minutes', 0, 'auto',
    ARRAY[d[1], d[2]]);
  v_sid := (v_session ->> 'checkoutSessionId')::uuid;
  UPDATE public.ticket_checkout_sessions
     SET metadata = COALESCE(metadata, '{}'::jsonb)
                    || jsonb_build_object('event_date_id', d[2]::text),
         buyer_status_token_hash = v_token_hash
   WHERE id = v_sid;
  v_order := (public.issue_1930_ticket_checkout_finalize_base(
                v_sid, NULL, NULL, NULL, 'i2160-test-pepper-0123456789abcdef',
                NULL, NULL, false) ->> 'orderId')::uuid;

  SELECT count(*) INTO v_n FROM public.tickets WHERE order_id = v_order;
  PERFORM pg_temp.x2160_assert(v_n = 2,
    'D-0 the multi-day free reservation minted 2 passes to disclose (got ' || v_n || ')');

  -- ── D-1 — KNOWLEDGE IS NOT POSSESSION.
  -- The idempotency key is derived from event + email + phone + cart + days,
  -- every part of which someone who knows the guest can type in. Being handed
  -- the order would hand over the QR payloads, and scanning them marks the
  -- pass `used` — the guest is then refused at their own door.
  PERFORM pg_temp.x2160_assert(
    public.issue_2150_free_replay_disclosure_authorized(v_sid, NULL, NULL)
      IS DISTINCT FROM true,
    'D-1a a caller presenting NO token is never authorized');
  PERFORM pg_temp.x2160_assert(
    public.issue_2150_free_replay_disclosure_authorized(v_sid, NULL, '')
      IS DISTINCT FROM true,
    'D-1b an EMPTY token is never authorized');
  PERFORM pg_temp.x2160_assert(
    public.issue_2150_free_replay_disclosure_authorized(
      v_sid, NULL, encode(sha256('a-guess'::bytea), 'hex')) IS DISTINCT FROM true,
    'D-1c a WRONG token is never authorized');
  PERFORM pg_temp.x2160_assert(
    public.issue_2150_free_replay_disclosure_authorized(v_sid, v_stranger, NULL)
      IS DISTINCT FROM true,
    'D-1d being signed in as SOMEBODY is not possession of an anonymous reservation');

  -- ── D-2 — the real guest, holding the token from their first submit, IS
  -- let back in. Fail-closed is only correct if the honest path still opens.
  PERFORM pg_temp.x2160_assert(
    public.issue_2150_free_replay_disclosure_authorized(v_sid, NULL, v_token_hash) = true,
    'D-2 the guest presenting THEIR OWN token is authorized');

  -- ── D-3 — a REVOKED reservation discloses nothing even to its owner.
  UPDATE public.ticket_checkout_sessions SET revoked_at = now() WHERE id = v_sid;
  PERFORM pg_temp.x2160_assert(
    public.issue_2150_free_replay_disclosure_authorized(v_sid, NULL, v_token_hash)
      IS DISTINCT FROM true,
    'D-3a a REVOKED session discloses nothing, token or not');
  UPDATE public.ticket_checkout_sessions SET revoked_at = NULL WHERE id = v_sid;

  -- ── D-4 — a session with NO stored hash must FAIL CLOSED rather than match
  -- an absent token against an absent hash.
  UPDATE public.ticket_checkout_sessions SET buyer_status_token_hash = NULL WHERE id = v_sid;
  PERFORM pg_temp.x2160_assert(
    public.issue_2150_free_replay_disclosure_authorized(v_sid, NULL, NULL)
      IS DISTINCT FROM true,
    'D-4a NULL stored hash + NULL presented token is NOT a match');
  PERFORM pg_temp.x2160_assert(
    public.issue_2150_free_replay_disclosure_authorized(v_sid, NULL, '')
      IS DISTINCT FROM true,
    'D-4b NULL stored hash + empty presented token is NOT a match');
  UPDATE public.ticket_checkout_sessions SET buyer_status_token_hash = v_token_hash
   WHERE id = v_sid;

  -- ── D-5 — a SIGNED-IN reservation is gated by identity, and the token does
  -- not override it. Otherwise a leaked token would be a full account bypass.
  UPDATE public.ticket_checkout_sessions SET buyer_user_id = f.o_owner WHERE id = v_sid;
  PERFORM pg_temp.x2160_assert(
    public.issue_2150_free_replay_disclosure_authorized(v_sid, v_stranger, v_token_hash)
      IS DISTINCT FROM true,
    'D-5a a stranger holding the RIGHT token cannot open a SIGNED-IN reservation');
  PERFORM pg_temp.x2160_assert(
    public.issue_2150_free_replay_disclosure_authorized(v_sid, NULL, v_token_hash)
      IS DISTINCT FROM true,
    'D-5b an anonymous caller cannot open a SIGNED-IN reservation with the token');
  PERFORM pg_temp.x2160_assert(
    public.issue_2150_free_replay_disclosure_authorized(v_sid, f.o_owner, NULL) = true,
    'D-5c the signed-in owner is authorized by identity alone');
  UPDATE public.ticket_checkout_sessions SET buyer_user_id = NULL WHERE id = v_sid;

  -- ── D-6 — REFUSING DISCLOSURE MUST NEVER MINT.
  -- This is the half that protects the GUEST rather than the attacker: an
  -- unproven resubmit must not tombstone the reservation and re-mint, or the
  -- guest ends up with a second order, a second pass and a second email they
  -- did not ask for. The RPC declines regardless of who is asking.
  v_second := public.biz_ticket_checkout_create_session(
    f.o_event, NULL, 'Anon Guest', 'disclose@example.com', '+15550008888', false,
    jsonb_build_array(jsonb_build_object('ticketTypeId', f.o_ticket_type, 'quantity', 1)),
    'x2160-d-' || f.o_event::text, now() + interval '15 minutes', 0, 'auto',
    ARRAY[d[1], d[2]]);
  PERFORM pg_temp.x2160_assert((v_second ->> 'status') = 'free_completed',
    'D-6a an identical multi-day resubmit is handed the COMPLETED session back');
  PERFORM pg_temp.x2160_assert((v_second ->> 'orderId')::uuid = v_order,
    'D-6b — the SAME order, not a new one');
  SELECT count(*) INTO v_n FROM public.orders WHERE event_id = f.o_event;
  PERFORM pg_temp.x2160_assert(v_n = 1,
    'D-6c still exactly ONE order after the resubmit (got ' || v_n || ')');
  SELECT count(*) INTO v_n FROM public.tickets WHERE order_id = v_order;
  PERFORM pg_temp.x2160_assert(v_n = 2,
    'D-6d still exactly 2 passes — chosen-days x quantity, not 4 (got ' || v_n || ')');
  SELECT count(*) INTO v_n FROM public.ticket_order_notifications WHERE order_id = v_order;
  PERFORM pg_temp.x2160_assert(v_n = 2,
    'D-6e still exactly 2 notification rows — one email, one SMS (got ' || v_n || ')');
  SELECT count(*) INTO v_n FROM public.ticket_checkout_sessions
   WHERE event_id = f.o_event AND idempotency_key LIKE '%tombstone%';
  PERFORM pg_temp.x2160_assert(v_n = 0,
    'D-6f and NOTHING was tombstoned — the reservation is intact (got ' || v_n || ')');

  -- ── D-7 — A GENUINE SECOND-DAY RESERVATION IS NOT A DUPLICATE.
  -- The day set is a segment of the idempotency key, so the same guest asking
  -- for a DIFFERENT day derives a different key and gets a real new session.
  -- Without this, multi-day and #2150 would be in direct conflict: every
  -- second-day request would be answered with the first day's order.
  v_second := public.biz_ticket_checkout_create_session(
    f.o_event, NULL, 'Anon Guest', 'disclose@example.com', '+15550008888', false,
    jsonb_build_array(jsonb_build_object('ticketTypeId', f.o_ticket_type, 'quantity', 1)),
    'x2160-d-' || f.o_event::text || ':days:' || d[2]::text,
    now() + interval '15 minutes', 0, 'auto', ARRAY[d[2]]);
  PERFORM pg_temp.x2160_assert((v_second ->> 'status') = 'pending_free',
    'D-7a a DIFFERENT day set is a new reservation, not a replay (got '
    || (v_second ->> 'status') || ')');
  PERFORM pg_temp.x2160_assert((v_second ->> 'orderId') IS NULL,
    'D-7b — and it carries no order yet, so nothing of the first was disclosed');
  PERFORM pg_temp.x2160_assert(
    (v_second ->> 'checkoutSessionId')::uuid <> v_sid,
    'D-7c — and it is a genuinely different session');
END $$;

DO $$ BEGIN
  RAISE NOTICE 'issue #2160 + #2150 TESTER-ADVERSARIAL suite: ALL CHECKS PASSED';
END $$;
