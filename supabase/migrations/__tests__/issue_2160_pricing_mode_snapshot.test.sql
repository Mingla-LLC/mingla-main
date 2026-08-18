-- issue #2160 — THE MODE A GUEST WAS QUOTED UNDER IS THE MODE THEY ARE ISSUED
-- UNDER. Executed against the real RPCs, both directions.
--
-- ── THE DEFECT THIS FILE EXISTS FOR ────────────────────────────────────────
-- The pricing mode was read TWICE and independently: once at create-session,
-- where it sets the multiplier that PRICES and SIZES the reservation, and again
-- at finalize, where it decides how entitlement rows are distributed. Nothing
-- carried the value between them.
--
-- THE LOCK CANNOT COVER IT, and that is the whole point:
-- `events_multi_date_pricing_mode_locked` fires on
-- `EXISTS(tickets … status IN ('valid','used','transferred'))`, and an
-- IN-FLIGHT session has minted no ticket yet. The flip is PERMITTED during
-- exactly the window in which it does damage, and the moment the guest's ticket
-- mints the lock engages so the damage cannot be undone.
--
-- Every flip below goes through the SHIPPED
-- `biz_set_event_multi_date_pricing_mode` RPC, not a direct UPDATE, so this
-- proves the reachable path rather than a hypothetical one.
--
-- ── WHAT IS PROVED ─────────────────────────────────────────────────────────
--   N-1  all_days -> per_day mid-session: the guest quoted ONE price for BOTH
--        days is issued a pass that admits BOTH days, and the day-2 door says
--        `success`. Pre-fix: one entitlement row and `event_ended` at a door
--        they paid for.
--   N-2  per_day -> all_days mid-session: the guest who paid for TWO days gets
--        TWO passes with ONE day each — not two passes each admitting both,
--        which would be four admissions sold as two.
--   N-3  the snapshot is written at create and is what finalize reads.
--   N-4  a session with a NULL snapshot (created before the column existed)
--        still finalizes, falling back to the live event.
--   N-5  the #2150 disclosure check FAILS CLOSED BY VALUE: an anonymous caller
--        asking about a signed-in reservation gets false, never NULL.

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.n2160_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #2160 pricing-mode-snapshot FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.n2160_event(
  p_tag text, p_mode text, p_price int DEFAULT 1000,
  OUT o_event uuid, OUT o_ticket_type uuid, OUT o_owner uuid, OUT o_scanner uuid
) LANGUAGE plpgsql AS $$
DECLARE v_brand uuid := gen_random_uuid(); v_i int;
BEGIN
  o_event := gen_random_uuid(); o_owner := gen_random_uuid(); o_scanner := gen_random_uuid();
  INSERT INTO auth.users(id) VALUES (o_owner), (o_scanner);
  INSERT INTO public.creator_accounts(id) VALUES (o_owner);
  INSERT INTO public.brands(id, account_id, name, slug, default_currency, payment_provider)
    VALUES (v_brand, o_owner, 'n2160 ' || p_tag, 'n2160-' || p_tag || '-' || v_brand,
            CASE WHEN p_price = 0 THEN NULL ELSE 'GBP' END,
            CASE WHEN p_price = 0 THEN 'stripe' ELSE 'paystack' END);
  INSERT INTO public.events(id, brand_id, title, slug, event_type, status, visibility,
                            timezone, is_multi_date, multi_date_pricing_mode, currency)
    VALUES (o_event, v_brand, 'n2160 ' || p_tag, 'n2160-' || p_tag || '-' || o_event,
            'event', 'draft', 'draft', 'UTC', true, p_mode,
            CASE WHEN p_price = 0 THEN NULL ELSE 'GBP' END);
  FOR v_i IN 1..2 LOOP
    INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
      VALUES (o_event,
              now() + ((v_i - 1) || ' days')::interval - interval '1 hour',
              now() + ((v_i - 1) || ' days')::interval + interval '5 hours',
              'UTC', v_i = 1);
  END LOOP;
  INSERT INTO public.ticket_types(event_id, name, price_cents, is_free, quantity_total,
                                  min_purchase_qty, available_online, available_in_person,
                                  display_order, currency)
    VALUES (o_event, 'Entry', p_price, p_price = 0, 100, 1, true, true, 0,
            CASE WHEN p_price = 0 THEN NULL ELSE 'GBP' END)
    RETURNING id INTO o_ticket_type;
  INSERT INTO public.event_scanners(event_id, user_id) VALUES (o_event, o_scanner);
  PERFORM set_config('mingla.publish_free_only', 'on', true);
  UPDATE public.events SET status='scheduled', visibility='hidden', published_at=now()
   WHERE id = o_event;
  PERFORM set_config('mingla.publish_free_only', '', true);
END $$;

CREATE OR REPLACE FUNCTION pg_temp.n2160_place(p_day uuid, p_where text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.event_dates
     SET start_at = CASE p_where WHEN 'live' THEN now() - interval '1 hour'
                                 WHEN 'past' THEN now() - interval '5 days'
                                 ELSE now() + interval '5 days' END,
         end_at   = CASE p_where WHEN 'live' THEN now() + interval '5 hours'
                                 WHEN 'past' THEN now() - interval '5 days' + interval '5 hours'
                                 ELSE now() + interval '5 days' + interval '5 hours' END
   WHERE id = p_day;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.n2160_days(p_event uuid)
RETURNS uuid[] LANGUAGE sql AS $$
  SELECT ARRAY(SELECT id FROM public.event_dates WHERE event_id = p_event
                ORDER BY start_at, id);
$$;

CREATE OR REPLACE FUNCTION pg_temp.n2160_scan(p_event uuid, p_ticket uuid, p_scanner uuid)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_qr text;
BEGIN
  SELECT qr_code INTO v_qr FROM public.tickets WHERE id = p_ticket;
  RETURN public.biz_ticket_scan(p_event, v_qr, p_scanner,
    'n2160-test-pepper-0123456789abcdef') ->> 'result';
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- N-1 — all_days -> per_day MID-SESSION. THE GUEST PAID FOR BOTH DAYS.
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  f record; v_days uuid[]; v_session jsonb; v_sid uuid; v_final jsonb;
  v_order uuid; v_pass uuid; v_quoted int; v_paid int; v_n int; v_err text;
BEGIN
  SELECT * INTO f FROM pg_temp.n2160_event('flipdown', 'all_days');
  v_days := pg_temp.n2160_days(f.o_event);

  -- The guest is QUOTED: one price for both days.
  v_session := public.biz_ticket_checkout_create_session(
    f.o_event, NULL, 'Quoted Guest', 'quoted@example.com', '+15550004444', false,
    jsonb_build_array(jsonb_build_object('ticketTypeId', f.o_ticket_type, 'quantity', 1)),
    'n2160:flipdown:' || f.o_event::text, now() + interval '15 minutes', 0, 'auto',
    ARRAY[v_days[1], v_days[2]]);
  v_sid := (v_session ->> 'checkoutSessionId')::uuid;
  v_quoted := (v_session ->> 'totalCents')::int;
  PERFORM pg_temp.n2160_assert(v_quoted = 1000,
    'N-1a the guest is quoted ONE price for BOTH days (got ' || v_quoted || ')');

  -- THE ORGANISER FLIPS, through the shipped RPC, while the guest is paying.
  -- The lock does NOT stop this: no ticket exists yet.
  PERFORM set_config('request.jwt.claim.sub', f.o_owner::text, true);
  BEGIN
    PERFORM public.biz_set_event_multi_date_pricing_mode(f.o_event, 'per_day');
    v_err := NULL;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM pg_temp.n2160_assert(v_err IS NULL,
    'N-1b the flip is PERMITTED mid-session — the lock cannot see an unminted ticket (got '
    || COALESCE(v_err,'permitted') || ')');

  -- The guest pays and is issued.
  UPDATE public.ticket_checkout_sessions
     SET metadata = COALESCE(metadata,'{}'::jsonb)
                    || jsonb_build_object('event_date_id', v_days[2]::text)
   WHERE id = v_sid;
  PERFORM pg_temp.n2160_assert(
    public.issue_1930_ticket_session_authorized(v_sid, f.o_event),
    'N-1c the session authorizes');
  v_final := public.issue_1930_ticket_checkout_finalize_base(
    v_sid, 'pi_n2160_' || replace(v_sid::text,'-',''), NULL, NULL,
    'n2160-test-pepper-0123456789abcdef', NULL, NULL, false);
  v_order := (v_final ->> 'orderId')::uuid;

  SELECT total_cents INTO v_paid FROM public.orders WHERE id = v_order;
  PERFORM pg_temp.n2160_assert(v_paid = v_quoted,
    'N-1d the guest paid what they were quoted (' || v_paid || ' vs ' || v_quoted || ')');

  SELECT count(*) INTO v_n FROM public.tickets WHERE order_id = v_order;
  PERFORM pg_temp.n2160_assert(v_n = 1,
    'N-1e one price -> ONE pass (got ' || v_n || ')');
  SELECT id INTO v_pass FROM public.tickets WHERE order_id = v_order;

  -- ── THE ASSERTION THAT WAS RED BEFORE THE SNAPSHOT. ──────────────────────
  SELECT count(*) INTO v_n FROM public.ticket_event_dates WHERE ticket_id = v_pass;
  PERFORM pg_temp.n2160_assert(v_n = 2,
    'N-1f that ONE pass admits BOTH days the guest paid for (got ' || v_n
    || ') — pre-fix this was 1');

  PERFORM pg_temp.n2160_place(v_days[1], 'past');
  PERFORM pg_temp.n2160_place(v_days[2], 'live');
  PERFORM pg_temp.n2160_assert(
    pg_temp.n2160_scan(f.o_event, v_pass, f.o_scanner) = 'success',
    'N-1g DAY 2 DOOR: the guest who paid for day 2 is ADMITTED — pre-fix: event_ended');

  -- ...and the lock has now engaged, so the organiser cannot undo it either.
  PERFORM set_config('request.jwt.claim.sub', f.o_owner::text, true);
  BEGIN
    PERFORM public.biz_set_event_multi_date_pricing_mode(f.o_event, 'all_days');
    v_err := NULL;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM;
  END;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM pg_temp.n2160_assert(v_err LIKE '%multi_date_pricing_mode_locked%',
    'N-1h once the pass exists the lock engages — which is why the fix has to be the snapshot');
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- N-2 — THE MIRROR. per_day -> all_days MID-SESSION.
-- Pre-fix: 2 passes EACH admitting BOTH days = 4 admissions sold as 2, with
-- quantity_total decremented by 2 for 4 bodies in the room.
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  f record; v_days uuid[]; v_session jsonb; v_sid uuid; v_final jsonb;
  v_order uuid; v_quoted int; v_n int; v_bad int;
BEGIN
  SELECT * INTO f FROM pg_temp.n2160_event('flipup', 'per_day');
  v_days := pg_temp.n2160_days(f.o_event);

  v_session := public.biz_ticket_checkout_create_session(
    f.o_event, NULL, 'Mirror Guest', 'mirror@example.com', '+15550005555', false,
    jsonb_build_array(jsonb_build_object('ticketTypeId', f.o_ticket_type, 'quantity', 1)),
    'n2160:flipup:' || f.o_event::text, now() + interval '15 minutes', 0, 'auto',
    ARRAY[v_days[1], v_days[2]]);
  v_sid := (v_session ->> 'checkoutSessionId')::uuid;
  v_quoted := (v_session ->> 'totalCents')::int;
  PERFORM pg_temp.n2160_assert(v_quoted = 2000,
    'N-2a the guest is quoted TWO days at 2 x price (got ' || v_quoted || ')');

  PERFORM set_config('request.jwt.claim.sub', f.o_owner::text, true);
  PERFORM public.biz_set_event_multi_date_pricing_mode(f.o_event, 'all_days');
  PERFORM set_config('request.jwt.claim.sub', '', true);

  UPDATE public.ticket_checkout_sessions
     SET metadata = COALESCE(metadata,'{}'::jsonb)
                    || jsonb_build_object('event_date_id', v_days[2]::text)
   WHERE id = v_sid;
  v_final := public.issue_1930_ticket_checkout_finalize_base(
    v_sid, 'pi_n2160m_' || replace(v_sid::text,'-',''), NULL, NULL,
    'n2160-test-pepper-0123456789abcdef', NULL, NULL, false);
  v_order := (v_final ->> 'orderId')::uuid;

  SELECT count(*) INTO v_n FROM public.tickets WHERE order_id = v_order;
  PERFORM pg_temp.n2160_assert(v_n = 2,
    'N-2b two days paid for -> TWO passes (got ' || v_n || ')');

  -- Each pass admits exactly ONE day. Pre-fix each admitted BOTH.
  SELECT count(*) INTO v_bad
    FROM public.tickets t
   WHERE t.order_id = v_order
     AND (SELECT count(*) FROM public.ticket_event_dates ted
           WHERE ted.ticket_id = t.id) <> 1;
  PERFORM pg_temp.n2160_assert(v_bad = 0,
    'N-2c each pass admits exactly ONE day — pre-fix each admitted BOTH, selling '
    || '4 admissions as 2 (' || v_bad || ' bad passes)');

  SELECT count(*) INTO v_n
    FROM public.ticket_event_dates ted JOIN public.tickets t ON t.id = ted.ticket_id
   WHERE t.order_id = v_order;
  PERFORM pg_temp.n2160_assert(v_n = 2,
    'N-2d TOTAL admissions issued = 2, matching the 2 paid for (got ' || v_n || ')');
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- N-3 / N-4 — the snapshot is written, is what finalize reads, and a NULL one
-- (a session created before the column existed) still finalizes.
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  f record; v_days uuid[]; v_session jsonb; v_sid uuid; v_final jsonb;
  v_order uuid; v_snap text; v_n int;
BEGIN
  SELECT * INTO f FROM pg_temp.n2160_event('snapshot', 'all_days');
  v_days := pg_temp.n2160_days(f.o_event);
  v_session := public.biz_ticket_checkout_create_session(
    f.o_event, NULL, 'Snap Guest', 'snap@example.com', '+15550006666', false,
    jsonb_build_array(jsonb_build_object('ticketTypeId', f.o_ticket_type, 'quantity', 1)),
    'n2160:snap:' || f.o_event::text, now() + interval '15 minutes', 0, 'auto',
    ARRAY[v_days[1], v_days[2]]);
  v_sid := (v_session ->> 'checkoutSessionId')::uuid;

  SELECT multi_date_pricing_mode_snapshot INTO v_snap
    FROM public.ticket_checkout_sessions WHERE id = v_sid;
  PERFORM pg_temp.n2160_assert(v_snap = 'all_days',
    'N-3 the mode is SNAPSHOTTED at create (got ' || COALESCE(v_snap,'NULL') || ')');

  -- N-4 — blank the snapshot to simulate a session created before this column,
  -- and flip the live event. Finalize must fall back to the event and still
  -- work: an in-flight session at deploy must not fail.
  UPDATE public.ticket_checkout_sessions
     SET multi_date_pricing_mode_snapshot = NULL,
         metadata = COALESCE(metadata,'{}'::jsonb)
                    || jsonb_build_object('event_date_id', v_days[2]::text)
   WHERE id = v_sid;
  v_final := public.issue_1930_ticket_checkout_finalize_base(
    v_sid, 'pi_n2160s_' || replace(v_sid::text,'-',''), NULL, NULL,
    'n2160-test-pepper-0123456789abcdef', NULL, NULL, false);
  v_order := (v_final ->> 'orderId')::uuid;
  PERFORM pg_temp.n2160_assert(v_order IS NOT NULL,
    'N-4a a NULL snapshot still finalizes — a session in flight at deploy is not stranded');
  SELECT count(*) INTO v_n FROM public.ticket_event_dates ted
    JOIN public.tickets t ON t.id = ted.ticket_id WHERE t.order_id = v_order;
  PERFORM pg_temp.n2160_assert(v_n = 2,
    'N-4b and it falls back to the live event''s mode (all_days -> 2 rows, got ' || v_n || ')');
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- N-5 — #2150 DISCLOSURE FAILS CLOSED BY VALUE, NOT BY THE CALLER REMEMBERING.
-- `uuid = NULL` is NULL, not false. An ANONYMOUS caller asking about a
-- SIGNED-IN guest's reservation must get FALSE — reachable by anyone who knows
-- that guest's email and phone, because those derive the same idempotency key.
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  f record; v_days uuid[]; v_buyer uuid := gen_random_uuid();
  v_session jsonb; v_sid uuid; v_final jsonb; v_result boolean;
BEGIN
  SELECT * INTO f FROM pg_temp.n2160_event('disclose', 'per_day', 0);
  v_days := pg_temp.n2160_days(f.o_event);
  INSERT INTO auth.users(id) VALUES (v_buyer);

  -- A SIGNED-IN free reservation, completed.
  v_session := public.biz_ticket_checkout_create_session(
    f.o_event, v_buyer, 'Signed In', 'signedin@example.com', '+15550007777', false,
    jsonb_build_array(jsonb_build_object('ticketTypeId', f.o_ticket_type, 'quantity', 1)),
    'n2160:disclose:' || f.o_event::text, now() + interval '15 minutes', 0, 'auto',
    ARRAY[v_days[1]]);
  v_sid := (v_session ->> 'checkoutSessionId')::uuid;
  v_final := public.issue_1930_ticket_checkout_finalize_base(
    v_sid, NULL, NULL, NULL, 'n2160-test-pepper-0123456789abcdef', NULL, NULL, false);

  -- THE ATTACK SHAPE: an anonymous submit (p_buyer_user_id NULL) against a
  -- signed-in reservation, by someone who knows the guest's email and phone.
  v_result := public.issue_2150_free_replay_disclosure_authorized(v_sid, NULL, '');
  PERFORM pg_temp.n2160_assert(v_result IS NOT NULL,
    'N-5a an anonymous caller gets a REAL boolean, never NULL — `NOT NULL` is '
    || 'NULL, so a caller writing `IF NOT authorized THEN refuse` would fail OPEN');
  PERFORM pg_temp.n2160_assert(v_result = false,
    'N-5b ...and that boolean is FALSE — knowledge of email + phone is not possession');

  -- The signed-in owner is still authorised; the fix narrows nothing.
  PERFORM pg_temp.n2160_assert(
    public.issue_2150_free_replay_disclosure_authorized(v_sid, v_buyer, '') = true,
    'N-5c the real signed-in guest is STILL authorised — #2150 is not weakened');
  -- A DIFFERENT signed-in user is refused, as before.
  PERFORM pg_temp.n2160_assert(
    public.issue_2150_free_replay_disclosure_authorized(v_sid, gen_random_uuid(), '') = false,
    'N-5d a different signed-in user is still refused');
END $$;

DO $$ BEGIN
  RAISE NOTICE 'issue #2160 pricing-mode-snapshot suite: ALL CHECKS PASSED';
END $$;
