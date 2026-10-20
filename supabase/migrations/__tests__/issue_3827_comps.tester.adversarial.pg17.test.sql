-- issue #3827 — guest-list comps, TESTER ADVERSARIAL suite (pg17, post-replay).
--
-- Attacks angles the implementor happy file does not: cross-event and
-- cross-brand probing, literal search, the search field allowlist, the actor
-- and brand rate limits, every money path (payout sweep, event-cancel refund
-- prepare, numbers rollups), plus-one duplicate edges, the shared per-person
-- helper raising (never swallowing) and its link-origin mode, and the money
-- shape for every money column.
--
-- Runs the REAL functions inside BEGIN … ROLLBACK; nothing persists.
--
-- invariant: I-3827-COMP-NO-PAYOUT       A8 (sweep, cancel-refund prepare)
-- invariant: I-3827-COMP-NOT-SOLD        A8 (numbers rollups unchanged by comps)
-- invariant: I-3827-COMP-NO-MONEY        A7 (every money column + source flip)
-- invariant: I-3827-MANUAL-ADMIT-ONE-LADDER A5 (no scan row for a foreign ticket)
-- invariant: I-3827-PARTY-ONE-LEVEL      P (helper refuses nesting)
--
-- FAILS-ON-REVERT (tester):
--   a. drop the `v_ticket.event_id <> p_event_id` arm in biz_ticket_admit_by_id
--      -> A5 fails (a foreign ticket is admitted and a scan row written)
--   b. drop the escape replace() in biz_door_guest_search -> A6 fails
--   c. delete the actor hourly cap block                -> A11 fails
--   d. catch exceptions inside issue_3827_comp_issue_one -> H-RAISE fails

\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.t3827_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #3827 comps ADVERSARIAL FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.t3827_err(p_sql text)
RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.t3827_pepper() RETURNS text LANGUAGE sql AS $$
  SELECT 't3827-adversarial-pepper-0123456789'::text;
$$;

-- A published, ticketed, single-date event with one capped tier.
CREATE OR REPLACE FUNCTION pg_temp.t3827_event(
  p_tag text,
  p_quantity_total int DEFAULT 10,
  p_owner uuid DEFAULT NULL,
  p_brand uuid DEFAULT NULL,
  OUT o_event uuid, OUT o_tt uuid, OUT o_owner uuid, OUT o_brand uuid, OUT o_date uuid
) LANGUAGE plpgsql AS $$
BEGIN
  o_owner := COALESCE(p_owner, gen_random_uuid());
  o_brand := COALESCE(p_brand, gen_random_uuid());
  o_event := gen_random_uuid();
  IF p_owner IS NULL THEN
    INSERT INTO auth.users(id, email) VALUES (o_owner, 't3827-owner-' || o_owner || '@example.test');
    INSERT INTO public.creator_accounts(id) VALUES (o_owner);
  END IF;
  IF p_brand IS NULL THEN
    INSERT INTO public.brands(id, account_id, name, slug, payment_provider)
      VALUES (o_brand, o_owner, 't3827 ' || p_tag, 't3827-' || p_tag || '-' || o_brand, 'stripe');
  END IF;
  INSERT INTO public.events(id, brand_id, title, slug, event_type, status, visibility,
                            timezone, is_multi_date, is_recurring)
    VALUES (o_event, o_brand, 't3827 ' || p_tag, 't3827-' || p_tag || '-' || o_event,
            'event', 'draft', 'draft', 'UTC', false, false);
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
    VALUES (o_event, now() - interval '1 hour', now() + interval '5 hours', 'UTC', true)
    RETURNING id INTO o_date;
  INSERT INTO public.ticket_types(event_id, name, price_cents, is_free, quantity_total,
                                  min_purchase_qty, available_online, available_in_person,
                                  display_order)
    VALUES (o_event, 'General admission', 0, true, p_quantity_total, 1, true, true, 0)
    RETURNING id INTO o_tt;
  PERFORM set_config('mingla.publish_free_only', 'on', true);
  UPDATE public.events SET status = 'scheduled', visibility = 'public', published_at = now()
   WHERE id = o_event;
  PERFORM set_config('mingla.publish_free_only', '', true);
END $$;

CREATE OR REPLACE FUNCTION pg_temp.t3827_member(p_brand uuid, p_role text, p_accepted boolean DEFAULT true)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_user uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users(id, email) VALUES (v_user, 't3827-' || p_role || '-' || v_user || '@example.test');
  INSERT INTO public.brand_team_members(brand_id, user_id, role, invited_at, accepted_at)
    VALUES (p_brand, v_user, p_role, now(), CASE WHEN p_accepted THEN now() END);
  RETURN v_user;
END $$;

-- One guest, as JSON.
CREATE OR REPLACE FUNCTION pg_temp.t3827_g(p_index int, p_name text, p_email text DEFAULT NULL,
                                           p_plus jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('index', p_index, 'name', p_name, 'email', p_email, 'phoneE164', NULL)
         || CASE WHEN p_plus IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('plusOnes', p_plus) END;
$$;

-- An issue call as SQL text (for t3827_err).
CREATE OR REPLACE FUNCTION pg_temp.t3827_issue_sql(p_actor uuid, p_event uuid, p_tt uuid, p_date uuid,
                                                   p_guests jsonb, p_note text DEFAULT NULL)
RETURNS text LANGUAGE sql AS $$
  SELECT format('SELECT public.biz_comp_issue(%L, %L, %L, %L, %L::jsonb, %L, %L, %L)',
                p_actor, p_event, p_tt, p_date, p_guests, p_note, gen_random_uuid(), pg_temp.t3827_pepper());
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- A5 — cross-event / cross-brand admit and probing
-- ═══════════════════════════════════════════════════════════════════════════
DO $a5$
DECLARE
  a record;
  b record;
  x record;
  v_scanner uuid;
  v_res jsonb;
  v_ticket_b uuid;
  v_err text;
BEGIN
  SELECT * INTO a FROM pg_temp.t3827_event('a5-a', 10);
  -- Event B: the SAME brand, so a brand scanner is authorized on both.
  SELECT * INTO b FROM pg_temp.t3827_event('a5-b', 10, a.o_owner, a.o_brand);
  v_scanner := pg_temp.t3827_member(a.o_brand, 'scanner');

  v_res := public.biz_comp_issue(a.o_owner, b.o_event, b.o_tt, NULL,
    jsonb_build_array(pg_temp.t3827_g(0, 'Bea Other', 'bea@example.test')), NULL, gen_random_uuid(), pg_temp.t3827_pepper());
  SELECT id INTO v_ticket_b FROM public.tickets WHERE order_id = (v_res -> 'results' -> 0 ->> 'orderId')::uuid;

  v_res := public.biz_ticket_admit_by_id(v_scanner, a.o_event, v_ticket_b, pg_temp.t3827_pepper());
  PERFORM pg_temp.t3827_assert(v_res ->> 'result' = 'not_found' AND (v_res -> 'ticketId') = 'null'::jsonb,
    'A5 a ticket of another event, admitted under this event: not_found, no ticket id echoed');
  PERFORM pg_temp.t3827_assert(
    NOT EXISTS (SELECT 1 FROM public.scan_events WHERE ticket_id = v_ticket_b)
    AND (SELECT status FROM public.tickets WHERE id = v_ticket_b) = 'valid'
    AND (SELECT used_at FROM public.tickets WHERE id = v_ticket_b) IS NULL,
    'A5 no scan row written and the foreign ticket stays valid / unused');
  PERFORM pg_temp.t3827_assert(
    (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v_res) k) = ARRAY['result', 'ticketId'],
    'A5 the not_found answer carries only result + ticketId (no name, order or ticket type leak)');

  -- A random ticket id: not_found, no row.
  v_res := public.biz_ticket_admit_by_id(v_scanner, a.o_event, gen_random_uuid(), pg_temp.t3827_pepper());
  PERFORM pg_temp.t3827_assert(v_res ->> 'result' = 'not_found', 'A5 an unknown ticket id: not_found');

  -- A scanner of ANOTHER brand cannot admit, even naming the right event.
  SELECT * INTO x FROM pg_temp.t3827_event('a5-x', 10);
  v_err := pg_temp.t3827_err(format('SELECT public.biz_ticket_admit_by_id(%L, %L, %L, %L)',
    pg_temp.t3827_member(x.o_brand, 'scanner'), b.o_event, v_ticket_b, pg_temp.t3827_pepper()));
  PERFORM pg_temp.t3827_assert(v_err = 'scanner_not_authorized', 'A5 a scanner of another brand: scanner_not_authorized');
  PERFORM pg_temp.t3827_assert(NOT EXISTS (SELECT 1 FROM public.scan_events WHERE ticket_id = v_ticket_b),
    'A5 still no scan row for the probed ticket');

  -- A removed event_scanners row and an unaccepted scanner invite grant nothing.
  v_scanner := pg_temp.t3827_member(b.o_brand, 'marketing_manager');
  INSERT INTO public.event_scanners(event_id, user_id, removed_at) VALUES (b.o_event, v_scanner, now());
  v_err := pg_temp.t3827_err(format('SELECT public.biz_door_guest_search(%L, %L, %L, 20)', v_scanner, b.o_event, 'bea'));
  PERFORM pg_temp.t3827_assert(v_err = 'forbidden', 'ACL a REMOVED event_scanners row cannot search: forbidden');
  v_err := pg_temp.t3827_err(format('SELECT public.biz_ticket_admit_by_id(%L, %L, %L, %L)',
    v_scanner, b.o_event, v_ticket_b, pg_temp.t3827_pepper()));
  PERFORM pg_temp.t3827_assert(v_err = 'scanner_not_authorized', 'ACL a REMOVED event_scanners row cannot admit');
  v_err := pg_temp.t3827_err(format('SELECT public.biz_door_guest_search(%L, %L, %L, 20)',
    pg_temp.t3827_member(b.o_brand, 'scanner', false), b.o_event, 'bea'));
  PERFORM pg_temp.t3827_assert(v_err = 'forbidden', 'ACL an unaccepted scanner invite cannot search: forbidden');
  v_err := pg_temp.t3827_err(format('SELECT public.biz_door_guest_search(%L, %L, %L, 20)',
    pg_temp.t3827_member(b.o_brand, 'marketing_manager'), b.o_event, 'bea'));
  PERFORM pg_temp.t3827_assert(v_err = 'forbidden', 'ACL a marketing manager (not a scanner) cannot search: forbidden');
  v_err := pg_temp.t3827_err(format('SELECT public.biz_door_guest_search(%L, %L, %L, 20)',
    pg_temp.t3827_member(x.o_brand, 'event_manager'), b.o_event, 'bea'));
  PERFORM pg_temp.t3827_assert(v_err = 'forbidden', 'ACL an event manager of another brand cannot search: forbidden');
END
$a5$;

-- ═══════════════════════════════════════════════════════════════════════════
-- A6 — literal search; the search field allowlist (no phone, full email,
-- note, price); every ticket holder (bought too); cancelled orders hidden
-- ═══════════════════════════════════════════════════════════════════════════
DO $a6$
DECLARE
  f record;
  v_mgr uuid;
  v_res jsonb;
  v_s jsonb;
  v_err text;
  v_bought uuid;
  v_cancel_order uuid;
  v_o jsonb;
BEGIN
  SELECT * INTO f FROM pg_temp.t3827_event('a6', 50);
  v_mgr := pg_temp.t3827_member(f.o_brand, 'event_manager');

  v_res := public.biz_comp_issue(v_mgr, f.o_event, f.o_tt, NULL,
    jsonb_build_array(
      jsonb_build_object('index', 0, 'name', 'Zed_Under', 'email', 'zed.under@example.test', 'phoneE164', '+447700900111'),
      jsonb_build_object('index', 1, 'name', 'ZedXUnder', 'email', 'zedx@example.test', 'phoneE164', NULL),
      jsonb_build_object('index', 2, 'name', '100% Real', 'email', 'pct@example.test', 'phoneE164', NULL),
      jsonb_build_object('index', 3, 'name', 'Back\Slash', 'email', 'b@example.test', 'phoneE164', NULL),
      jsonb_build_object('index', 4, 'name', 'Cancelled Carl', 'email', 'carl@example.test', 'phoneE164', NULL)),
    'SECRET-HOST-NOTE-3827', gen_random_uuid(), pg_temp.t3827_pepper());
  v_cancel_order := (v_res -> 'results' -> 4 ->> 'orderId')::uuid;
  PERFORM public.biz_comp_cancel(v_mgr, v_cancel_order, 'Removed', gen_random_uuid());

  -- `_` is literal: "d_u" matches only Zed_Under, never ZedXUnder.
  v_s := public.biz_door_guest_search(v_mgr, f.o_event, 'd_u', 20);
  PERFORM pg_temp.t3827_assert(jsonb_array_length(v_s -> 'orders') = 1
    AND v_s -> 'orders' -> 0 ->> 'displayName' = 'Zed_Under',
    'A6 "_" is a literal underscore, not a one-character wildcard');
  -- `%` is literal.
  v_s := public.biz_door_guest_search(v_mgr, f.o_event, '0%', 20);
  PERFORM pg_temp.t3827_assert(jsonb_array_length(v_s -> 'orders') = 1
    AND v_s -> 'orders' -> 0 ->> 'displayName' = '100% Real', 'A6 "0%" matches only the literal percent');
  v_s := public.biz_door_guest_search(v_mgr, f.o_event, '%%', 20);
  PERFORM pg_temp.t3827_assert(jsonb_array_length(v_s -> 'orders') = 0, 'A6 "%%" matches nobody (not everybody)');
  v_s := public.biz_door_guest_search(v_mgr, f.o_event, '__', 20);
  PERFORM pg_temp.t3827_assert(jsonb_array_length(v_s -> 'orders') = 0, 'A6 "__" matches nobody (not everybody)');
  -- `\` is literal and never an escape error.
  v_s := public.biz_door_guest_search(v_mgr, f.o_event, 'k\S', 20);
  PERFORM pg_temp.t3827_assert(jsonb_array_length(v_s -> 'orders') = 1
    AND v_s -> 'orders' -> 0 ->> 'displayName' = 'Back\Slash', 'A6 a backslash is literal');
  v_err := pg_temp.t3827_err(format('SELECT public.biz_door_guest_search(%L, %L, %L, 20)', v_mgr, f.o_event, '\'));
  PERFORM pg_temp.t3827_assert(v_err = 'query_too_short', 'A6 a lone backslash is too short, not an escape error');
  v_err := pg_temp.t3827_err(format('SELECT public.biz_door_guest_search(%L, %L, %L, 20)', v_mgr, f.o_event, '   a   '));
  PERFORM pg_temp.t3827_assert(v_err = 'query_too_short', 'A6 whitespace is trimmed before the length check');
  v_err := pg_temp.t3827_err(format('SELECT public.biz_door_guest_search(%L, %L, %L, 20)', v_mgr, f.o_event, repeat('z', 81)));
  PERFORM pg_temp.t3827_assert(v_err = 'query_too_long', 'A6 81 characters: query_too_long');

  -- Field allowlist: exactly these keys, at both levels.
  v_s := public.biz_door_guest_search(v_mgr, f.o_event, 'zed', 20);
  PERFORM pg_temp.t3827_assert(
    (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v_s) k) = ARRAY['orders', 'truncated'],
    'search top level: orders + truncated only');
  FOR v_o IN SELECT * FROM jsonb_array_elements(v_s -> 'orders') LOOP
    PERFORM pg_temp.t3827_assert(
      (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v_o) k)
        = ARRAY['cameWithName', 'displayName', 'isGuestList', 'maskedEmail', 'orderId', 'tickets'],
      'search order keys are the minimal allowlist');
    PERFORM pg_temp.t3827_assert(
      (SELECT bool_and((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(t) k)
                       = ARRAY['eventDateIds', 'status', 'ticketId', 'ticketName', 'usedAt'])
         FROM jsonb_array_elements(v_o -> 'tickets') t),
      'search ticket keys are the minimal allowlist (no QR, no price)');
  END LOOP;
  PERFORM pg_temp.t3827_assert(
    position('SECRET-HOST-NOTE-3827' in v_s::text) = 0
    AND position('+447700900111' in v_s::text) = 0
    AND position('zed.under@' in v_s::text) = 0
    AND position('mingla:v1:ticket' in v_s::text) = 0,
    'search never returns the host note (comp_reason), the phone, the full email or the QR');

  -- Searching BY email prefix still returns only the masked email.
  v_s := public.biz_door_guest_search(v_mgr, f.o_event, 'zed.un', 20);
  PERFORM pg_temp.t3827_assert(jsonb_array_length(v_s -> 'orders') = 1
    AND v_s -> 'orders' -> 0 ->> 'maskedEmail' = 'ze***@example.test'
    AND position('zed.under@' in v_s::text) = 0,
    'an email-prefix search answers with the masked email only');
  -- A one-letter local part masks to one letter.
  v_s := public.biz_door_guest_search(v_mgr, f.o_event, 'slash', 20);
  PERFORM pg_temp.t3827_assert(v_s -> 'orders' -> 0 ->> 'maskedEmail' = 'b***@example.test',
    'a one-letter local part masks as b***@domain');

  -- A cancelled comp is not offered at the door.
  v_s := public.biz_door_guest_search(v_mgr, f.o_event, 'carl', 20);
  PERFORM pg_temp.t3827_assert(jsonb_array_length(v_s -> 'orders') = 0, 'a cancelled guest-list order is not found at the door');

  -- Every ticket holder: a bought order is found, flagged isGuestList false.
  INSERT INTO public.orders(event_id, buyer_email, buyer_name, buyer_phone_e164, total_cents, currency,
                            payment_method, payment_status, source)
    VALUES (f.o_event, 'zelda@example.test', 'Zelda Buyer', '+447700900222', 2500, 'GBP', 'online_card', 'paid', 'online_checkout')
    RETURNING id INTO v_bought;
  v_s := public.biz_door_guest_search(v_mgr, f.o_event, 'zelda', 20);
  PERFORM pg_temp.t3827_assert(jsonb_array_length(v_s -> 'orders') = 1
    AND NOT (v_s -> 'orders' -> 0 ->> 'isGuestList')::boolean
    AND position('2500' in v_s::text) = 0 AND position('+447700900222' in v_s::text) = 0,
    'Q8 a bought order is found too, not flagged guest list, with no price or phone');

  -- Truncation at 20, even when the caller asks for more.
  FOR i IN 0..24 LOOP
    INSERT INTO public.orders(event_id, buyer_email, buyer_name, total_cents, currency, payment_method, payment_status, source)
      VALUES (f.o_event, 'many' || i || '@example.test', 'Many ' || i, 0, 'GBP', 'free', 'paid', 'legacy');
  END LOOP;
  v_s := public.biz_door_guest_search(v_mgr, f.o_event, 'many', 500);
  PERFORM pg_temp.t3827_assert(jsonb_array_length(v_s -> 'orders') = 20 AND (v_s ->> 'truncated')::boolean,
    'p_limit is capped at 20 and truncated = true');
  v_s := public.biz_door_guest_search(v_mgr, f.o_event, 'many', -5);
  PERFORM pg_temp.t3827_assert(jsonb_array_length(v_s -> 'orders') = 1, 'a negative p_limit is clamped to 1, not an error');
END
$a6$;

-- ═══════════════════════════════════════════════════════════════════════════
-- A7 — the money shape, every column; a comp can never be flipped to a sale
-- ═══════════════════════════════════════════════════════════════════════════
DO $a7$
DECLARE
  f record;
  v_res jsonb;
  v_order uuid;
  v_sale uuid;
  v_err text;
  v_set text;
BEGIN
  SELECT * INTO f FROM pg_temp.t3827_event('a7', 10);
  v_res := public.biz_comp_issue(f.o_owner, f.o_event, f.o_tt, NULL,
    jsonb_build_array(pg_temp.t3827_g(0, 'Money Shape', 'shape@example.test')), NULL, gen_random_uuid(), pg_temp.t3827_pepper());
  v_order := (v_res -> 'results' -> 0 ->> 'orderId')::uuid;

  FOREACH v_set IN ARRAY ARRAY[
    'payment_method = ''online_card''',
    'stripe_charge_id = ''ch_x''',
    'stripe_application_fee_amount_cents = 1',
    'buyer_total_cents = 1',
    'buyer_fees_cents = 1',
    'tax_cents = 1',
    'is_door_sale = true',
    'comp_request_key = NULL'
  ] LOOP
    v_err := pg_temp.t3827_err(format('UPDATE public.orders SET %s WHERE id = %L', v_set, v_order));
    PERFORM pg_temp.t3827_assert(v_err LIKE '%orders_comp_shape_check%', 'A7 a comp with ' || v_set || ' violates orders_comp_shape_check');
  END LOOP;

  -- A comp cannot be turned into a sale (its comp fields pin it).
  v_err := pg_temp.t3827_err(format('UPDATE public.orders SET source = ''online_checkout'' WHERE id = %L', v_order));
  PERFORM pg_temp.t3827_assert(v_err IS NOT NULL, 'A7 flipping a comp to online_checkout is refused');
  -- A sale cannot carry comp fields or a party lead.
  INSERT INTO public.orders(event_id, buyer_email, buyer_name, total_cents, currency, payment_method, payment_status, source)
    VALUES (f.o_event, 'sale@example.test', 'Sale', 0, 'GBP', 'free', 'paid', 'legacy') RETURNING id INTO v_sale;
  v_err := pg_temp.t3827_err(format('UPDATE public.orders SET comp_issued_by = %L WHERE id = %L', f.o_owner, v_sale));
  PERFORM pg_temp.t3827_assert(v_err LIKE '%orders_comp_fields_only_on_comp%', 'A7 a non-comp with comp_issued_by is refused');
  v_err := pg_temp.t3827_err(format('UPDATE public.orders SET comp_reason = %L WHERE id = %L', 'x', v_sale));
  PERFORM pg_temp.t3827_assert(v_err LIKE '%orders_comp_fields_only_on_comp%', 'A7 a non-comp with comp_reason is refused');
  v_err := pg_temp.t3827_err(format('UPDATE public.orders SET comp_party_lead_order_id = %L WHERE id = %L', v_order, v_sale));
  PERFORM pg_temp.t3827_assert(v_err IS NOT NULL, 'A7 a non-comp cannot point at a party lead');
  v_err := pg_temp.t3827_err(format('UPDATE public.orders SET comp_party_lead_order_id = id WHERE id = %L', v_order));
  PERFORM pg_temp.t3827_assert(v_err LIKE '%orders_comp_party_shape%', 'A7 a comp cannot be its own party lead');
  -- A sale cancel keeps its 10-character minimum; only comps may use a short reason.
  v_err := pg_temp.t3827_err(format('UPDATE public.orders SET cancellation_reason = %L WHERE id = %L', 'short', v_sale));
  PERFORM pg_temp.t3827_assert(v_err LIKE '%orders_cancellation_reason_length%', 'A7 a sale keeps the 10-character cancel-reason minimum');
END
$a7$;

-- ═══════════════════════════════════════════════════════════════════════════
-- A11 — actor hourly cap (300) and brand daily cap (1000); fail closed,
-- nothing written when refused; replays never count
-- ═══════════════════════════════════════════════════════════════════════════
DO $a11$
DECLARE
  f record;
  v_mgr uuid;
  v_other uuid;
  v_err text;
  v_res jsonb;
  v_req uuid := gen_random_uuid();
  v_before int;
BEGIN
  SELECT * INTO f FROM pg_temp.t3827_event('a11', 5000);
  v_mgr := pg_temp.t3827_member(f.o_brand, 'event_manager');
  v_other := pg_temp.t3827_member(f.o_brand, 'event_manager');

  -- 298 comps by this actor in the last hour, plus 50 older than an hour.
  INSERT INTO public.orders(event_id, buyer_name, total_cents, currency, payment_method, payment_status, source,
                            comp_issued_by, comp_request_key, created_at, notification_status)
    SELECT f.o_event, 'Rate ' || g, 0, 'GBP', 'free', 'paid', 'comp', v_mgr,
           't3827:rate:' || g, CASE WHEN g <= 298 THEN now() - interval '5 minutes' ELSE now() - interval '2 hours' END,
           'not_required'
      FROM generate_series(1, 348) g;

  -- 298 + 1 guest with 2 NAMED plus-ones = 301 orders > 300.
  SELECT count(*) INTO v_before FROM public.orders WHERE event_id = f.o_event;
  v_err := pg_temp.t3827_err(pg_temp.t3827_issue_sql(v_mgr, f.o_event, f.o_tt, NULL,
    jsonb_build_array(pg_temp.t3827_g(0, 'Over Cap', NULL, jsonb_build_array(
      jsonb_build_object('name', 'Plus A'), jsonb_build_object('name', 'Plus B'))))));
  PERFORM pg_temp.t3827_assert(v_err = 'rate_limited', 'A11 the 301st comp order in an hour by one actor: rate_limited (named plus-ones count)');
  PERFORM pg_temp.t3827_assert((SELECT count(*) FROM public.orders WHERE event_id = f.o_event) = v_before,
    'A11 a rate-limited call writes nothing');

  -- Unnamed plus-ones ride on one order: 298 + 2 orders = 300, allowed.
  v_res := public.biz_comp_issue(v_mgr, f.o_event, f.o_tt, NULL,
    jsonb_build_array(
      pg_temp.t3827_g(0, 'At Cap One', NULL, jsonb_build_array(jsonb_build_object(), jsonb_build_object())),
      pg_temp.t3827_g(1, 'At Cap Two')),
    NULL, v_req, pg_temp.t3827_pepper());
  PERFORM pg_temp.t3827_assert((v_res ->> 'addedCount')::int = 2, 'A11 exactly 300 in the hour is allowed; orders older than an hour do not count');

  -- At the cap, a REPLAY is not refused (it writes nothing new).
  v_res := public.biz_comp_issue(v_mgr, f.o_event, f.o_tt, NULL,
    jsonb_build_array(
      pg_temp.t3827_g(0, 'At Cap One', NULL, jsonb_build_array(jsonb_build_object(), jsonb_build_object())),
      pg_temp.t3827_g(1, 'At Cap Two')),
    NULL, v_req, pg_temp.t3827_pepper());
  PERFORM pg_temp.t3827_assert(
    (SELECT bool_and(r ->> 'status' = 'replayed') FROM jsonb_array_elements(v_res -> 'results') r),
    'A11 a retry at the cap replays instead of rate_limited');

  v_err := pg_temp.t3827_err(pg_temp.t3827_issue_sql(v_mgr, f.o_event, f.o_tt, NULL,
    jsonb_build_array(pg_temp.t3827_g(0, 'One More'))));
  PERFORM pg_temp.t3827_assert(v_err = 'rate_limited', 'A11 the next new guest by the same actor: rate_limited');
  -- The cap is per actor: a colleague can still add.
  v_res := public.biz_comp_issue(v_other, f.o_event, f.o_tt, NULL,
    jsonb_build_array(pg_temp.t3827_g(0, 'Colleague Guest')), NULL, gen_random_uuid(), pg_temp.t3827_pepper());
  PERFORM pg_temp.t3827_assert((v_res ->> 'addedCount')::int = 1, 'A11 the hourly cap is per actor');

  -- Brand daily cap: bring the brand to 1000 comp orders today.
  INSERT INTO public.orders(event_id, buyer_name, total_cents, currency, payment_method, payment_status, source,
                            comp_issued_by, comp_request_key, created_at, notification_status)
    SELECT f.o_event, 'Brand ' || g, 0, 'GBP', 'free', 'paid', 'comp', NULL,
           't3827:brand:' || g, now() - interval '3 hours', 'not_required'
      FROM generate_series(1, 1000 - (SELECT count(*)::int FROM public.orders WHERE event_id = f.o_event
                                                                         AND source = 'comp'
                                                                         AND created_at > now() - interval '1 day')) g;
  v_err := pg_temp.t3827_err(pg_temp.t3827_issue_sql(v_other, f.o_event, f.o_tt, NULL,
    jsonb_build_array(pg_temp.t3827_g(0, 'Brand Over'))));
  PERFORM pg_temp.t3827_assert(v_err = 'rate_limited', 'A11 the 1001st comp of the brand in a day: rate_limited');
END
$a11$;

-- ═══════════════════════════════════════════════════════════════════════════
-- A8 — money paths ignore comps: numbers rollups are byte-identical with and
-- without comps; the payout sweep and the event-cancel refund prepare never
-- produce a row for a comp
-- ═══════════════════════════════════════════════════════════════════════════
DO $a8$
DECLARE
  f record;
  v_res jsonb;
  v_drove_before jsonb;
  v_conv_before jsonb;
  v_reg_before jsonb;
  v_pat_before jsonb;
  v_comp_ids uuid[];
  v_prep jsonb;
BEGIN
  SELECT * INTO f FROM pg_temp.t3827_event('a8', 100);
  v_drove_before := public.brand_mingla_drove_rollup(f.o_brand);
  v_conv_before := public.entity_conversion_rollup(f.o_event);
  v_reg_before := public.brand_regulars_rollup(f.o_brand);
  v_pat_before := public.brand_customer_commitment_patterns_rollup(f.o_brand);

  v_res := public.biz_comp_issue(f.o_owner, f.o_event, f.o_tt, NULL,
    jsonb_build_array(
      pg_temp.t3827_g(0, 'Money One', 'm1@example.test', jsonb_build_array(jsonb_build_object('name', 'Money Plus', 'email', 'mp@example.test'))),
      pg_temp.t3827_g(1, 'Money Two', 'm2@example.test', jsonb_build_array(jsonb_build_object(), jsonb_build_object()))),
    NULL, gen_random_uuid(), pg_temp.t3827_pepper());
  SELECT array_agg(id) INTO v_comp_ids FROM public.orders WHERE event_id = f.o_event AND source = 'comp';
  PERFORM pg_temp.t3827_assert(cardinality(v_comp_ids) = 3, 'A8 fixture: 3 comp orders');

  PERFORM pg_temp.t3827_assert(public.brand_mingla_drove_rollup(f.o_brand) = v_drove_before,
    'A8 brand_mingla_drove_rollup unchanged by comps');
  PERFORM pg_temp.t3827_assert(public.entity_conversion_rollup(f.o_event) = v_conv_before,
    'A8 entity_conversion_rollup unchanged by comps');
  PERFORM pg_temp.t3827_assert(public.brand_regulars_rollup(f.o_brand) = v_reg_before,
    'A8 brand_regulars_rollup unchanged by comps');
  PERFORM pg_temp.t3827_assert(public.brand_customer_commitment_patterns_rollup(f.o_brand) = v_pat_before,
    'A8 brand_customer_commitment_patterns_rollup unchanged by comps');

  -- Payout sweep a month out: no release, item or fee snapshot for a comp.
  PERFORM public.run_payout_release_dark_sweep(now() + interval '30 days');
  PERFORM pg_temp.t3827_assert(
    NOT EXISTS (SELECT 1 FROM public.payout_release_items WHERE source_id = ANY (v_comp_ids))
    AND NOT EXISTS (SELECT 1 FROM public.payout_source_fee_snapshots WHERE source_id = ANY (v_comp_ids))
    AND NOT EXISTS (SELECT 1 FROM public.brand_payout_releases WHERE event_id = f.o_event),
    'A8 I-3827-COMP-NO-PAYOUT: the payout sweep produces nothing for comps');

  -- Event cancelled: the refund prepare enumerates no comp.
  UPDATE public.events SET status = 'cancelled' WHERE id = f.o_event;
  v_prep := public.cancel_event_refund_prepare(f.o_event, now());
  PERFORM pg_temp.t3827_assert(
    NOT EXISTS (SELECT 1 FROM public.event_cancel_refund_progress WHERE source_id = ANY (v_comp_ids)),
    'A8 cancel_event_refund_prepare creates no refund progress row for a comp');
  PERFORM pg_temp.t3827_assert(
    NOT EXISTS (SELECT 1 FROM public.refunds WHERE order_id = ANY (v_comp_ids)),
    'A8 no refund row for any comp');
END
$a8$;

-- ═══════════════════════════════════════════════════════════════════════════
-- P — plus-one edges: a duplicate plus-one fails ALONE; a duplicate guest's
-- new plus-ones attach to the existing lead; nesting is refused; capacity
-- counts only people actually issued
-- ═══════════════════════════════════════════════════════════════════════════
DO $plus$
DECLARE
  f record;
  v_res jsonb;
  v_lead uuid;
  v_existing_po uuid;
  v_r jsonb;
  v_err text;
BEGIN
  SELECT * INTO f FROM pg_temp.t3827_event('plus', 6);

  -- Seed: Lara (lead) with a named plus-one Dupe.
  v_res := public.biz_comp_issue(f.o_owner, f.o_event, f.o_tt, NULL,
    jsonb_build_array(pg_temp.t3827_g(0, 'Lara Lead', 'lara@example.test',
      jsonb_build_array(jsonb_build_object('name', 'Dupe Plus', 'email', 'dupe@example.test')))),
    NULL, gen_random_uuid(), pg_temp.t3827_pepper());
  v_lead := (v_res -> 'results' -> 0 ->> 'orderId')::uuid;
  v_existing_po := (v_res -> 'results' -> 1 ->> 'orderId')::uuid;
  -- sold 2, remaining 4

  -- 1. A new guest whose named plus-one is already on the list: the plus-one
  --    fails alone; the guest and the other plus-one are added.
  v_res := public.biz_comp_issue(f.o_owner, f.o_event, f.o_tt, NULL,
    jsonb_build_array(pg_temp.t3827_g(0, 'Nora New', 'nora@example.test', jsonb_build_array(
      jsonb_build_object('name', 'Dupe Again', 'email', 'DUPE@example.test'),
      jsonb_build_object('name', 'Fresh Plus', 'email', 'fresh@example.test')))),
    NULL, gen_random_uuid(), pg_temp.t3827_pepper());
  PERFORM pg_temp.t3827_assert(
    v_res -> 'results' -> 0 ->> 'status' = 'added'
    AND (v_res -> 'results' -> 0 -> 'plusOneIndex') = 'null'::jsonb
    AND v_res -> 'results' -> 1 ->> 'status' = 'failed'
    AND v_res -> 'results' -> 1 ->> 'code' = 'already_on_guest_list'
    AND (v_res -> 'results' -> 1 ->> 'plusOneIndex')::int = 0
    AND v_res -> 'results' -> 2 ->> 'status' = 'added'
    AND (v_res -> 'results' -> 2 ->> 'plusOneIndex')::int = 1
    AND (v_res ->> 'addedCount')::int = 2 AND (v_res ->> 'failedCount')::int = 1,
    'P1 a duplicate plus-one fails alone (plusOneIndex 0); the guest and the other plus-one are added');
  PERFORM pg_temp.t3827_assert(
    (SELECT comp_party_lead_order_id FROM public.orders WHERE id = (v_res -> 'results' -> 2 ->> 'orderId')::uuid)
      = (v_res -> 'results' -> 0 ->> 'orderId')::uuid,
    'P1 the surviving plus-one points at the new guest');
  PERFORM pg_temp.t3827_assert((v_res ->> 'remaining')::int = 2,
    'P1 capacity counted only the 2 people issued (duplicate not charged)');

  -- 2. The guest is a duplicate of an existing LEAD: their new plus-ones join
  --    the existing lead's order.
  v_res := public.biz_comp_issue(f.o_owner, f.o_event, f.o_tt, NULL,
    jsonb_build_array(pg_temp.t3827_g(0, 'Lara Again', 'Lara@Example.test', jsonb_build_array(
      jsonb_build_object('name', 'Late Plus', 'email', 'late@example.test')))),
    NULL, gen_random_uuid(), pg_temp.t3827_pepper());
  PERFORM pg_temp.t3827_assert(
    v_res -> 'results' -> 0 ->> 'code' = 'already_on_guest_list'
    AND v_res -> 'results' -> 1 ->> 'status' = 'added',
    'P2 duplicate guest refused; their new plus-one added');
  PERFORM pg_temp.t3827_assert(
    (SELECT comp_party_lead_order_id FROM public.orders WHERE id = (v_res -> 'results' -> 1 ->> 'orderId')::uuid) = v_lead,
    'P2 the new plus-one attaches to the EXISTING lead order');

  -- 3. The guest duplicates an existing PLUS-ONE: their plus-ones are not
  --    nested under a plus-one (one level only) and nothing is half-written.
  v_res := public.biz_comp_issue(f.o_owner, f.o_event, f.o_tt, NULL,
    jsonb_build_array(pg_temp.t3827_g(0, 'Dupe As Guest', 'dupe@example.test', jsonb_build_array(
      jsonb_build_object('name', 'Nested Plus', 'email', 'nested@example.test')))),
    NULL, gen_random_uuid(), pg_temp.t3827_pepper());
  PERFORM pg_temp.t3827_assert(
    v_res -> 'results' -> 0 ->> 'code' = 'already_on_guest_list'
    AND v_res -> 'results' -> 1 ->> 'status' = 'failed'
    AND NOT EXISTS (SELECT 1 FROM public.orders WHERE event_id = f.o_event AND buyer_email = 'nested@example.test'),
    'P3 a plus-one of a guest who is someone else''s plus-one is refused, never nested');
  PERFORM pg_temp.t3827_assert(
    NOT EXISTS (SELECT 1 FROM public.orders o JOIN public.orders l ON l.id = o.comp_party_lead_order_id
                 WHERE o.event_id = f.o_event AND l.comp_party_lead_order_id IS NOT NULL),
    'P3 I-3827-PARTY-ONE-LEVEL holds over the whole event');

  -- 4. Shape edges.
  v_err := pg_temp.t3827_err(pg_temp.t3827_issue_sql(f.o_owner, f.o_event, f.o_tt, NULL,
    jsonb_build_array(pg_temp.t3827_g(0, 'Ten Plus', NULL,
      (SELECT jsonb_agg(jsonb_build_object()) FROM generate_series(1, 10))))));
  PERFORM pg_temp.t3827_assert(v_err = 'invalid_guests', 'P4 ten plus-ones: invalid_guests');
  v_err := pg_temp.t3827_err(pg_temp.t3827_issue_sql(f.o_owner, f.o_event, f.o_tt, NULL,
    jsonb_build_array(pg_temp.t3827_g(0, 'Self Plus', 'self@example.test',
      jsonb_build_array(jsonb_build_object('name', 'Self Twin', 'email', 'SELF@example.test'))))));
  PERFORM pg_temp.t3827_assert(v_err = 'invalid_guests', 'P4 a plus-one with the guest''s own email: invalid_guests (listed twice)');
  v_err := pg_temp.t3827_err(pg_temp.t3827_issue_sql(f.o_owner, f.o_event, f.o_tt, NULL,
    jsonb_build_array(pg_temp.t3827_g(0, 'Phone Only', NULL,
      jsonb_build_array(jsonb_build_object('phoneE164', '+447700900333'))))));
  PERFORM pg_temp.t3827_assert(v_err = 'invalid_guests', 'P4 a plus-one with a phone but no name: invalid_guests');
  v_err := pg_temp.t3827_err(pg_temp.t3827_issue_sql(f.o_owner, f.o_event, f.o_tt, NULL,
    jsonb_build_array(pg_temp.t3827_g(0, 'Str Plus', NULL, jsonb_build_array('"Bob"'::jsonb)))));
  PERFORM pg_temp.t3827_assert(v_err = 'invalid_guests', 'P4 a plus-one that is not an object: invalid_guests');
  v_err := pg_temp.t3827_err(pg_temp.t3827_issue_sql(f.o_owner, f.o_event, f.o_tt, NULL,
    jsonb_build_array(jsonb_build_object('index', '0', 'name', 'String Index'))));
  PERFORM pg_temp.t3827_assert(v_err = 'invalid_guests', 'P4 a string index: invalid_guests');
  v_err := pg_temp.t3827_err(pg_temp.t3827_issue_sql(f.o_owner, f.o_event, f.o_tt, NULL,
    jsonb_build_array(jsonb_build_object('index', 1.5, 'name', 'Frac Index'))));
  PERFORM pg_temp.t3827_assert(v_err = 'invalid_guests', 'P4 a fractional index: invalid_guests');
  v_err := pg_temp.t3827_err(pg_temp.t3827_issue_sql(f.o_owner, f.o_event, f.o_tt, NULL,
    (SELECT jsonb_agg(pg_temp.t3827_g(g, 'G' || g)) FROM generate_series(0, 50) g)));
  PERFORM pg_temp.t3827_assert(v_err = 'invalid_guests', 'P4 51 guests: invalid_guests');
  v_err := pg_temp.t3827_err(pg_temp.t3827_issue_sql(f.o_owner, f.o_event, f.o_tt, NULL,
    jsonb_build_array(pg_temp.t3827_g(0, 'Long Note')), repeat('n', 201)));
  PERFORM pg_temp.t3827_assert(v_err = 'invalid_guests', 'P4 a 201-character note: invalid_guests');
  v_err := pg_temp.t3827_err(pg_temp.t3827_issue_sql(f.o_owner, f.o_event, f.o_tt, NULL,
    jsonb_build_array(pg_temp.t3827_g(0, '   '))));
  PERFORM pg_temp.t3827_assert(v_err = 'invalid_guests', 'P4 a whitespace-only name: invalid_guests');

  -- 5. Cancel the lead: the plus-ones keep their own tickets; re-add the lead.
  PERFORM public.biz_comp_cancel(f.o_owner, v_lead, NULL, gen_random_uuid());
  PERFORM pg_temp.t3827_assert(
    (SELECT payment_status FROM public.orders WHERE id = v_existing_po) = 'paid'
    AND NOT EXISTS (SELECT 1 FROM public.tickets WHERE order_id = v_existing_po AND status <> 'valid'),
    'P5 cancelling a lead leaves their plus-one''s ticket valid');
  v_res := public.biz_comp_issue(f.o_owner, f.o_event, f.o_tt, NULL,
    jsonb_build_array(pg_temp.t3827_g(0, 'Lara Back', 'lara@example.test')), NULL, gen_random_uuid(), pg_temp.t3827_pepper());
  PERFORM pg_temp.t3827_assert(v_res -> 'results' -> 0 ->> 'status' = 'added',
    'P5 after cancel the lead email can be re-added');
  PERFORM pg_temp.t3827_assert(
    (SELECT count(*) FROM public.orders WHERE event_id = f.o_event AND lower(buyer_email) = 'lara@example.test'
       AND payment_status = 'paid') = 1,
    'P5 exactly one live guest-list order per email after re-add');
END
$plus$;

-- ═══════════════════════════════════════════════════════════════════════════
-- H-RAISE — issue_3827_comp_issue_one RAISES on bad input (never returns a
-- swallowed failure), leaves nothing behind, and supports the link origin
-- (p_ticket_link_id with p_issued_by NULL) for the private-links piece
-- ═══════════════════════════════════════════════════════════════════════════
DO $helper$
DECLARE
  f record;
  g record;
  v_sql text;
  v_err text;
  v_link uuid := gen_random_uuid();
  v_one jsonb;
  v_again jsonb;
  v_lead jsonb;
  v_case record;
  v_order record;
BEGIN
  SELECT * INTO f FROM pg_temp.t3827_event('helper', 10);
  SELECT * INTO g FROM pg_temp.t3827_event('helper-other', 10);

  -- Each case: one bad argument; the call must RAISE with this message.
  FOR v_case IN
    SELECT * FROM (VALUES
      ('party size 0',        'invalid_guests',          f.o_event, f.o_brand, f.o_tt, NULL::uuid, 'Ok Name', NULL::text, NULL::text, 0,  'k1', f.o_owner, NULL::uuid, NULL::uuid, NULL::text),
      ('party size 11',       'invalid_guests',          f.o_event, f.o_brand, f.o_tt, NULL::uuid, 'Ok Name', NULL, NULL, 11, 'k2', f.o_owner, NULL, NULL, NULL),
      ('empty name',          'invalid_guests',          f.o_event, f.o_brand, f.o_tt, NULL::uuid, '  ',      NULL, NULL, 1,  'k3', f.o_owner, NULL, NULL, NULL),
      ('bad email',           'invalid_guests',          f.o_event, f.o_brand, f.o_tt, NULL::uuid, 'Ok Name', 'not-an-email', NULL, 1, 'k4', f.o_owner, NULL, NULL, NULL),
      ('bad phone',           'invalid_guests',          f.o_event, f.o_brand, f.o_tt, NULL::uuid, 'Ok Name', NULL, '07700900123', 1, 'k5', f.o_owner, NULL, NULL, NULL),
      ('no origin',           'comp_origin_required',    f.o_event, f.o_brand, f.o_tt, NULL::uuid, 'Ok Name', NULL, NULL, 1,  'k6', NULL::uuid, NULL, NULL, NULL),
      ('no request key',      'comp_request_key_required', f.o_event, f.o_brand, f.o_tt, NULL::uuid, 'Ok Name', NULL, NULL, 1, '  ', f.o_owner, NULL, NULL, NULL),
      ('bad party origin',    'invalid_guests',          f.o_event, f.o_brand, f.o_tt, NULL::uuid, 'Ok Name', NULL, NULL, 1,  'k7', f.o_owner, NULL, NULL, 'vip'),
      ('tier of other event', 'ticket_type_not_found',   f.o_event, f.o_brand, g.o_tt, NULL::uuid, 'Ok Name', NULL, NULL, 1,  'k8', f.o_owner, NULL, NULL, NULL),
      ('brand mismatch',      'ticket_type_not_found',   f.o_event, g.o_brand, f.o_tt, NULL::uuid, 'Ok Name', NULL, NULL, 1,  'k9', f.o_owner, NULL, NULL, NULL),
      ('lead not an order',   'party_nesting_not_allowed', f.o_event, f.o_brand, f.o_tt, NULL::uuid, 'Ok Name', NULL, NULL, 1, 'k10', f.o_owner, NULL, gen_random_uuid(), NULL)
    ) AS t(label, expect, ev, br, tt, dt, nm, em, ph, ps, rk, iss, lnk, lead, origin)
  LOOP
    v_sql := format(
      'SELECT public.issue_3827_comp_issue_one(p_event_id => %L, p_brand_id => %L, p_ticket_type_id => %L, '
      || 'p_event_date_id => %L, p_name => %L, p_email => %L, p_phone_e164 => %L, p_party_size => %s, '
      || 'p_request_key => %L, p_qr_token_pepper => %L, p_issued_by => %L, p_ticket_link_id => %L, '
      || 'p_party_lead_order_id => %L, p_party_origin => %L)',
      v_case.ev, v_case.br, v_case.tt, v_case.dt, v_case.nm, v_case.em, v_case.ph, v_case.ps,
      'helper:' || v_case.rk, pg_temp.t3827_pepper(), v_case.iss, v_case.lnk, v_case.lead, v_case.origin);
    IF v_case.rk = '  ' THEN
      v_sql := replace(v_sql, quote_literal('helper:  '), quote_literal('  '));
    END IF;
    v_err := pg_temp.t3827_err(v_sql);
    PERFORM pg_temp.t3827_assert(v_err = v_case.expect,
      'H-RAISE ' || v_case.label || ': raises ' || v_case.expect || ' (got ' || COALESCE(v_err, 'NO ERROR') || ')');
  END LOOP;
  PERFORM pg_temp.t3827_assert(
    NOT EXISTS (SELECT 1 FROM public.orders WHERE comp_request_key LIKE 'helper:k%'),
    'H-RAISE no order row survives any refused call');

  -- A bad pepper raises too (the helper asserts it itself).
  v_err := pg_temp.t3827_err(format(
    'SELECT public.issue_3827_comp_issue_one(%L, %L, %L, NULL, %L, NULL, NULL, 1, %L, %L, %L)',
    f.o_event, f.o_brand, f.o_tt, 'Pep Per', 'helper:pepper', '', f.o_owner));
  PERFORM pg_temp.t3827_assert(v_err IS NOT NULL, 'H-RAISE an empty pepper raises');

  -- A failure AFTER the order insert (a date that is not the event's) raises
  -- and rolls the order back — it is not caught inside the helper.
  v_err := pg_temp.t3827_err(format(
    'SELECT public.issue_3827_comp_issue_one(%L, %L, %L, %L, %L, NULL, NULL, 2, %L, %L, %L)',
    f.o_event, f.o_brand, f.o_tt, gen_random_uuid(), 'Late Fail', 'helper:late', pg_temp.t3827_pepper(), f.o_owner));
  PERFORM pg_temp.t3827_assert(v_err IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.orders WHERE comp_request_key = 'helper:late')
    AND NOT EXISTS (SELECT 1 FROM public.tickets t JOIN public.orders o ON o.id = t.order_id WHERE o.buyer_name = 'Late Fail'),
    'H-RAISE a mid-write failure raises and leaves no order or ticket');

  -- Link origin: p_ticket_link_id with p_issued_by NULL.
  v_one := public.issue_3827_comp_issue_one(
    p_event_id => f.o_event, p_brand_id => f.o_brand, p_ticket_type_id => f.o_tt, p_event_date_id => NULL,
    p_name => 'Link Guest', p_email => 'LINK@Example.test', p_phone_e164 => '+447700900444', p_party_size => 1,
    p_request_key => 'link:' || v_link, p_qr_token_pepper => pg_temp.t3827_pepper(),
    p_issued_by => NULL, p_ticket_link_id => v_link);
  SELECT * INTO v_order FROM public.orders WHERE id = (v_one ->> 'orderId')::uuid;
  PERFORM pg_temp.t3827_assert(
    v_one ->> 'status' = 'added' AND (v_one ->> 'emailQueued')::boolean AND (v_one ->> 'smsQueued')::boolean
    AND v_order.source = 'comp' AND v_order.comp_issued_by IS NULL AND v_order.ticket_link_id = v_link
    AND v_order.buyer_email = 'link@example.test' AND v_order.total_cents = 0
    AND (SELECT count(*) FROM public.tickets WHERE order_id = v_order.id AND status = 'valid') = 1,
    'H-LINK a link-origin comp (no issuer) is written with ticket_link_id, one valid ticket, email + sms queued');
  v_again := public.issue_3827_comp_issue_one(
    p_event_id => f.o_event, p_brand_id => f.o_brand, p_ticket_type_id => f.o_tt, p_event_date_id => NULL,
    p_name => 'Link Guest', p_email => 'link@example.test', p_phone_e164 => NULL, p_party_size => 1,
    p_request_key => 'link:' || v_link, p_qr_token_pepper => pg_temp.t3827_pepper(),
    p_issued_by => NULL, p_ticket_link_id => v_link);
  PERFORM pg_temp.t3827_assert(v_again ->> 'status' = 'replayed' AND v_again ->> 'orderId' = v_order.id::text
    AND NOT (v_again ->> 'emailQueued')::boolean,
    'H-LINK the same request key replays the same order and queues nothing');
  -- The link guest's live email is guarded like any comp: the helper RAISES.
  v_err := pg_temp.t3827_err(format(
    'SELECT public.issue_3827_comp_issue_one(p_event_id => %L, p_brand_id => %L, p_ticket_type_id => %L, '
    || 'p_event_date_id => NULL, p_name => %L, p_email => %L, p_phone_e164 => NULL, p_party_size => 1, '
    || 'p_request_key => %L, p_qr_token_pepper => %L, p_issued_by => NULL, p_ticket_link_id => %L)',
    f.o_event, f.o_brand, f.o_tt, 'Link Twin', 'link@example.test', 'link:' || gen_random_uuid(), pg_temp.t3827_pepper(), v_link));
  PERFORM pg_temp.t3827_assert(v_err LIKE '%orders_comp_live_email_uidx%',
    'H-LINK a duplicate live email RAISES unique_violation from the helper (callers decide)');

  -- Party: a link lead + guest with link origin; nesting under a guest refused.
  v_lead := public.issue_3827_comp_issue_one(
    p_event_id => f.o_event, p_brand_id => f.o_brand, p_ticket_type_id => f.o_tt, p_event_date_id => NULL,
    p_name => 'Ada Lead', p_email => NULL, p_phone_e164 => NULL, p_party_size => 1,
    p_request_key => 'link:lead:' || v_link, p_qr_token_pepper => pg_temp.t3827_pepper(),
    p_issued_by => NULL, p_ticket_link_id => v_link);
  v_one := public.issue_3827_comp_issue_one(
    p_event_id => f.o_event, p_brand_id => f.o_brand, p_ticket_type_id => f.o_tt, p_event_date_id => NULL,
    p_name => 'Chidi Guest', p_email => NULL, p_phone_e164 => NULL, p_party_size => 1,
    p_request_key => 'link:guest:' || v_link, p_qr_token_pepper => pg_temp.t3827_pepper(),
    p_issued_by => NULL, p_ticket_link_id => v_link,
    p_party_lead_order_id => (v_lead ->> 'orderId')::uuid, p_party_lead_name => 'Ada Lead', p_party_origin => 'link');
  PERFORM pg_temp.t3827_assert(
    (SELECT metadata ->> 'party_origin' FROM public.orders WHERE id = (v_one ->> 'orderId')::uuid) = 'link'
    AND (SELECT metadata ->> 'party_lead_name' FROM public.orders WHERE id = (v_one ->> 'orderId')::uuid) = 'Ada Lead'
    AND (SELECT notification_status FROM public.orders WHERE id = (v_one ->> 'orderId')::uuid) = 'not_required',
    'H-LINK a link guest carries party_origin link + the lead name; name-only is not_required');
  v_err := pg_temp.t3827_err(format(
    'SELECT public.issue_3827_comp_issue_one(p_event_id => %L, p_brand_id => %L, p_ticket_type_id => %L, '
    || 'p_event_date_id => NULL, p_name => %L, p_email => NULL, p_phone_e164 => NULL, p_party_size => 1, '
    || 'p_request_key => %L, p_qr_token_pepper => %L, p_issued_by => NULL, p_ticket_link_id => %L, '
    || 'p_party_lead_order_id => %L)',
    f.o_event, f.o_brand, f.o_tt, 'Deep Nest', 'link:nest:' || v_link, pg_temp.t3827_pepper(), v_link, v_one ->> 'orderId'));
  PERFORM pg_temp.t3827_assert(v_err = 'party_nesting_not_allowed', 'H-LINK nesting under a guest: party_nesting_not_allowed');
  v_err := pg_temp.t3827_err(format(
    'SELECT public.issue_3827_comp_issue_one(p_event_id => %L, p_brand_id => %L, p_ticket_type_id => %L, '
    || 'p_event_date_id => NULL, p_name => %L, p_email => NULL, p_phone_e164 => NULL, p_party_size => 1, '
    || 'p_request_key => %L, p_qr_token_pepper => %L, p_issued_by => %L, '
    || 'p_party_lead_order_id => %L)',
    g.o_event, g.o_brand, g.o_tt, 'Cross Lead', 'link:cross:' || v_link, pg_temp.t3827_pepper(), g.o_owner, v_lead ->> 'orderId'));
  PERFORM pg_temp.t3827_assert(v_err = 'party_nesting_not_allowed', 'H-LINK a lead order of ANOTHER event: party_nesting_not_allowed');
END
$helper$;

-- ═══════════════════════════════════════════════════════════════════════════
-- GATES — cross-brand actors, event/tier/date gates, live checkout holds,
-- replays and duplicates vs capacity; cancel/resend ACL and edges
-- ═══════════════════════════════════════════════════════════════════════════
DO $gates$
DECLARE
  f record;
  x record;
  v_x_mgr uuid;
  v_removed uuid;
  v_err text;
  v_res jsonb;
  v_order uuid;
  v_sale uuid;
  v_req uuid := gen_random_uuid();
  v_tt_del uuid;
  v_past_date uuid;
  v_before int;
BEGIN
  SELECT * INTO f FROM pg_temp.t3827_event('gate', 3);
  SELECT * INTO x FROM pg_temp.t3827_event('gate-x', 10);
  v_x_mgr := pg_temp.t3827_member(x.o_brand, 'event_manager');

  -- Cross-brand: an event manager of brand X cannot touch brand F.
  v_err := pg_temp.t3827_err(pg_temp.t3827_issue_sql(v_x_mgr, f.o_event, f.o_tt, NULL,
    jsonb_build_array(pg_temp.t3827_g(0, 'Cross Brand'))));
  PERFORM pg_temp.t3827_assert(v_err = 'forbidden', 'GATE an event manager of another brand cannot issue');
  v_removed := pg_temp.t3827_member(f.o_brand, 'event_manager');
  UPDATE public.brand_team_members SET removed_at = now() WHERE user_id = v_removed;
  v_err := pg_temp.t3827_err(pg_temp.t3827_issue_sql(v_removed, f.o_event, f.o_tt, NULL,
    jsonb_build_array(pg_temp.t3827_g(0, 'Removed Mgr'))));
  PERFORM pg_temp.t3827_assert(v_err = 'forbidden', 'GATE a removed event manager cannot issue');
  v_err := pg_temp.t3827_err(pg_temp.t3827_issue_sql(pg_temp.t3827_member(f.o_brand, 'event_manager', false),
    f.o_event, f.o_tt, NULL, jsonb_build_array(pg_temp.t3827_g(0, 'Unaccepted'))));
  PERFORM pg_temp.t3827_assert(v_err = 'forbidden', 'GATE an unaccepted invite cannot issue');
  PERFORM pg_temp.t3827_assert(NOT EXISTS (SELECT 1 FROM public.orders WHERE event_id = f.o_event),
    'GATE refused issues wrote nothing');

  -- Tier and date gates.
  v_err := pg_temp.t3827_err(pg_temp.t3827_issue_sql(f.o_owner, f.o_event, x.o_tt, NULL,
    jsonb_build_array(pg_temp.t3827_g(0, 'Wrong Tier'))));
  PERFORM pg_temp.t3827_assert(v_err = 'ticket_type_not_found', 'GATE a tier of another event: ticket_type_not_found');
  INSERT INTO public.ticket_types(event_id, name, price_cents, is_free, quantity_total, min_purchase_qty,
                                  available_online, available_in_person, display_order, deleted_at)
    VALUES (f.o_event, 'Deleted', 0, true, 10, 1, true, true, 5, now()) RETURNING id INTO v_tt_del;
  v_err := pg_temp.t3827_err(pg_temp.t3827_issue_sql(f.o_owner, f.o_event, v_tt_del, NULL,
    jsonb_build_array(pg_temp.t3827_g(0, 'Deleted Tier'))));
  PERFORM pg_temp.t3827_assert(v_err = 'ticket_type_not_found', 'GATE a deleted tier: ticket_type_not_found');
  v_err := pg_temp.t3827_err(pg_temp.t3827_issue_sql(f.o_owner, f.o_event, f.o_tt, x.o_date,
    jsonb_build_array(pg_temp.t3827_g(0, 'Foreign Date'))));
  PERFORM pg_temp.t3827_assert(v_err = 'occurrence_not_available', 'GATE a date of another event: occurrence_not_available');
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
    VALUES (f.o_event, now() - interval '3 days', now() - interval '2 days', 'UTC', false) RETURNING id INTO v_past_date;
  v_err := pg_temp.t3827_err(pg_temp.t3827_issue_sql(f.o_owner, f.o_event, f.o_tt, v_past_date,
    jsonb_build_array(pg_temp.t3827_g(0, 'Past Date'))));
  PERFORM pg_temp.t3827_assert(v_err = 'occurrence_not_available', 'GATE a past date: occurrence_not_available');

  -- A live checkout hold takes places: quantity 3, hold 2 -> 2 comps refused.
  PERFORM public.biz_ticket_checkout_create_session(
    f.o_event, NULL, 'Holder', 'holder@example.test', '+15550001111', false,
    jsonb_build_array(jsonb_build_object('ticketTypeId', f.o_tt, 'quantity', 2)),
    't3827:hold:' || f.o_event::text, now() + interval '15 minutes', 0, 'auto', NULL);
  v_err := pg_temp.t3827_err(pg_temp.t3827_issue_sql(f.o_owner, f.o_event, f.o_tt, NULL,
    jsonb_build_array(pg_temp.t3827_g(0, 'Hold One'), pg_temp.t3827_g(1, 'Hold Two'))));
  PERFORM pg_temp.t3827_assert(v_err = 'ticket_capacity_exceeded', 'GATE live checkout holds count against comp capacity');
  v_res := public.biz_comp_issue(f.o_owner, f.o_event, f.o_tt, NULL,
    jsonb_build_array(pg_temp.t3827_g(0, 'Last Place', 'last@example.test')), NULL, v_req, pg_temp.t3827_pepper());
  PERFORM pg_temp.t3827_assert((v_res ->> 'addedCount')::int = 1 AND (v_res ->> 'remaining')::int = 0,
    'GATE the last place is taken; remaining 0');
  -- Full now: a replay of that request is NOT refused for capacity.
  v_res := public.biz_comp_issue(f.o_owner, f.o_event, f.o_tt, NULL,
    jsonb_build_array(pg_temp.t3827_g(0, 'Last Place', 'last@example.test')), NULL, v_req, pg_temp.t3827_pepper());
  PERFORM pg_temp.t3827_assert(v_res -> 'results' -> 0 ->> 'status' = 'replayed',
    'GATE a replay on a full tier replays instead of ticket_capacity_exceeded');
  -- Full: a duplicate-only batch is not a capacity failure either.
  v_res := public.biz_comp_issue(f.o_owner, f.o_event, f.o_tt, NULL,
    jsonb_build_array(pg_temp.t3827_g(0, 'Last Again', 'LAST@example.test')), NULL, gen_random_uuid(), pg_temp.t3827_pepper());
  PERFORM pg_temp.t3827_assert(v_res -> 'results' -> 0 ->> 'code' = 'already_on_guest_list',
    'GATE a duplicate on a full tier answers already_on_guest_list, not capacity');
  v_err := pg_temp.t3827_err(pg_temp.t3827_issue_sql(f.o_owner, f.o_event, f.o_tt, NULL,
    jsonb_build_array(pg_temp.t3827_g(0, 'No Room'))));
  PERFORM pg_temp.t3827_assert(v_err = 'ticket_capacity_exceeded', 'GATE Q5 no comps on a full ticket type');

  -- Cancel / resend ACL and edges.
  v_order := (SELECT id FROM public.orders WHERE event_id = f.o_event AND buyer_email = 'last@example.test');
  v_err := pg_temp.t3827_err(format('SELECT public.biz_comp_cancel(%L, %L, NULL, %L)', v_x_mgr, v_order, gen_random_uuid()));
  PERFORM pg_temp.t3827_assert(v_err = 'forbidden', 'GATE cancel by another brand: forbidden');
  v_err := pg_temp.t3827_err(format('SELECT public.biz_comp_resend_prepare(%L, %L, %L)', v_x_mgr, v_order, gen_random_uuid()));
  PERFORM pg_temp.t3827_assert(v_err = 'forbidden', 'GATE resend by another brand: forbidden');
  v_err := pg_temp.t3827_err(format('SELECT public.biz_comp_cancel(%L, %L, %L, %L)', f.o_owner, v_order, repeat('r', 201), gen_random_uuid()));
  PERFORM pg_temp.t3827_assert(v_err = 'reason_invalid_length'
    AND (SELECT payment_status FROM public.orders WHERE id = v_order) = 'paid',
    'GATE a 201-character cancel reason: reason_invalid_length, nothing changed');
  INSERT INTO public.orders(event_id, buyer_email, buyer_name, total_cents, currency, payment_method, payment_status, source)
    VALUES (f.o_event, 'sale2@example.test', 'Sale Two', 0, 'GBP', 'free', 'paid', 'legacy') RETURNING id INTO v_sale;
  v_err := pg_temp.t3827_err(format('SELECT public.biz_comp_cancel(%L, %L, NULL, %L)', f.o_owner, v_sale, gen_random_uuid()));
  PERFORM pg_temp.t3827_assert(v_err = 'not_a_guest_list_ticket'
    AND (SELECT payment_status FROM public.orders WHERE id = v_sale) = 'paid',
    'GATE biz_comp_cancel refuses a sale (no money path bypass): not_a_guest_list_ticket');
  v_err := pg_temp.t3827_err(format('SELECT public.biz_comp_cancel(%L, %L, NULL, %L)', f.o_owner, gen_random_uuid(), gen_random_uuid()));
  PERFORM pg_temp.t3827_assert(v_err = 'not_a_guest_list_ticket', 'GATE cancel of an unknown order: not_a_guest_list_ticket');

  -- Resend idempotency: the same clientRequestId never adds a second row.
  v_req := gen_random_uuid();
  PERFORM public.biz_comp_resend_prepare(f.o_owner, v_order, v_req);
  SELECT count(*) INTO v_before FROM public.ticket_order_notifications WHERE order_id = v_order;
  v_res := public.biz_comp_resend_prepare(f.o_owner, v_order, v_req);
  PERFORM pg_temp.t3827_assert((v_res ->> 'idempotentReplay')::boolean
    AND (SELECT count(*) FROM public.ticket_order_notifications WHERE order_id = v_order) = v_before,
    'GATE a resend retry with the same clientRequestId writes no second row');
  -- A name-only guest has no email: no_email.
  v_res := public.biz_comp_issue(x.o_owner, x.o_event, x.o_tt, NULL,
    jsonb_build_array(pg_temp.t3827_g(0, 'Name Only')), NULL, gen_random_uuid(), pg_temp.t3827_pepper());
  v_err := pg_temp.t3827_err(format('SELECT public.biz_comp_resend_prepare(%L, %L, %L)',
    x.o_owner, (v_res -> 'results' -> 0 ->> 'orderId'), gen_random_uuid()));
  PERFORM pg_temp.t3827_assert(v_err = 'no_email', 'GATE resend for a name-only guest: no_email');

  -- Event state gates.
  UPDATE public.event_dates SET start_at = now() - interval '2 days', end_at = now() - interval '1 day'
   WHERE event_id = x.o_event;
  v_err := pg_temp.t3827_err(pg_temp.t3827_issue_sql(x.o_owner, x.o_event, x.o_tt, NULL,
    jsonb_build_array(pg_temp.t3827_g(0, 'After End'))));
  PERFORM pg_temp.t3827_assert(v_err = 'event_already_ended', 'GATE every date ended: event_already_ended');
  UPDATE public.events SET event_type = 'trip' WHERE id = x.o_event;
  v_err := pg_temp.t3827_err(pg_temp.t3827_issue_sql(x.o_owner, x.o_event, x.o_tt, NULL,
    jsonb_build_array(pg_temp.t3827_g(0, 'Trip'))));
  PERFORM pg_temp.t3827_assert(v_err = 'event_type_unsupported', 'GATE a trip: event_type_unsupported (checked before the end date)');
  UPDATE public.events SET event_type = 'experience' WHERE id = x.o_event;
  v_err := pg_temp.t3827_err(pg_temp.t3827_issue_sql(x.o_owner, x.o_event, x.o_tt, NULL,
    jsonb_build_array(pg_temp.t3827_g(0, 'Experience'))));
  PERFORM pg_temp.t3827_assert(v_err = 'event_type_unsupported', 'GATE an experience: event_type_unsupported');
  UPDATE public.events SET deleted_at = now() WHERE id = x.o_event;
  v_err := pg_temp.t3827_err(pg_temp.t3827_issue_sql(x.o_owner, x.o_event, x.o_tt, NULL,
    jsonb_build_array(pg_temp.t3827_g(0, 'Deleted Event'))));
  PERFORM pg_temp.t3827_assert(v_err = 'event_not_open', 'GATE a deleted event: event_not_open');
  v_err := pg_temp.t3827_err(format('SELECT public.biz_door_guest_search(%L, %L, %L, 20)', x.o_owner, x.o_event, 'name'));
  PERFORM pg_temp.t3827_assert(v_err = 'forbidden', 'GATE door search on a deleted event: forbidden');
END
$gates$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ACL — every new function is SECURITY DEFINER with a pinned search_path;
-- finalize keeps its service-role-only grant after the re-emit
-- ═══════════════════════════════════════════════════════════════════════════
DO $acl$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig, p.prosecdef, p.proconfig
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname IN ('issue_3827_mint_ticket', 'issue_3827_can_door_scan', 'issue_3827_comp_issue_one',
                         'biz_comp_issue', 'biz_comp_cancel', 'biz_comp_resend_prepare',
                         'biz_door_guest_search', 'biz_ticket_admit_by_id')
  LOOP
    PERFORM pg_temp.t3827_assert(r.prosecdef AND EXISTS (SELECT 1 FROM unnest(r.proconfig) c WHERE c LIKE 'search_path=%'),
      'ACL SECURITY DEFINER + pinned search_path: ' || r.sig);
  END LOOP;
  PERFORM pg_temp.t3827_assert(
    (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace
       AND proname IN ('issue_3827_mint_ticket', 'issue_3827_can_door_scan', 'issue_3827_comp_issue_one',
                       'biz_comp_issue', 'biz_comp_cancel', 'biz_comp_resend_prepare',
                       'biz_door_guest_search', 'biz_ticket_admit_by_id')) = 8,
    'ACL exactly one overload of each new function (no stray PUBLIC-executable twin)');
  FOR r IN
    SELECT p.oid FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'issue_1930_ticket_checkout_finalize_base'
  LOOP
    PERFORM pg_temp.t3827_assert(
      NOT has_function_privilege('anon', r.oid, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', r.oid, 'EXECUTE'),
      'ACL the re-emitted finalize base is still not executable by anon / authenticated');
  END LOOP;
END
$acl$;

ROLLBACK;
