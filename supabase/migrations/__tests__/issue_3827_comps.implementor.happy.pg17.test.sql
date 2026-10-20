-- issue #3827 — guest-list comps, implementor happy path (pg17, post-replay).
--
-- Runs the REAL functions against a fully migrated database inside
-- BEGIN … ROLLBACK. Each block names the spec case it proves.
--
-- ── INVARIANTS UNDER TEST (declared here, beside their enforcing tests) ─────
-- invariant: I-3827-COMP-NO-MONEY        orders_comp_shape_check; T-M1/T-M2
-- invariant: I-3827-COMP-COUNTS-CAPACITY H1 (sold_count), H7 (cancel frees), A1 (all-or-nothing)
-- invariant: I-3827-COMP-COUNTS-GOING    H1 (pg_public_social_proof)
-- invariant: I-3827-MANUAL-ADMIT-ONE-LADDER H10
-- invariant: I-3827-COMP-CANCEL-NO-REFUND H7
-- invariant: I-3827-ONE-PERSON-ONE-ORDER H-N8
--
-- ── FAILS-ON-REVERT (recorded on #3827) ─────────────────────────────────────
--   1. remove 'comp' from orders_source_check      -> H1 fails
--   2. drop orders_comp_shape_check                 -> T-M1 fails
--   3. delete the batch capacity block              -> A1 fails (rows inserted)
--   4. admit by a direct UPDATE of tickets          -> H10 duplicate fails

\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.i3827_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #3827 comps FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END $$;

-- The SQLSTATE-free error text of a call, or NULL when it succeeded.
CREATE OR REPLACE FUNCTION pg_temp.i3827_err(p_sql text)
RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END $$;

-- A published single-date (or recurring) ticketed event with one tier.
--   p_dates: 1 = single date live now; 2 = recurring, two upcoming nights.
CREATE OR REPLACE FUNCTION pg_temp.i3827_event(
  p_tag text,
  p_quantity_total int DEFAULT 10,
  p_dates int DEFAULT 1,
  OUT o_event uuid, OUT o_tt uuid, OUT o_owner uuid, OUT o_brand uuid
) LANGUAGE plpgsql AS $$
DECLARE
  v_i int;
BEGIN
  o_owner := gen_random_uuid();
  o_brand := gen_random_uuid();
  o_event := gen_random_uuid();
  INSERT INTO auth.users(id, email) VALUES (o_owner, 'i3827-owner-' || o_owner || '@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (o_owner);
  INSERT INTO public.brands(id, account_id, name, slug, payment_provider)
    VALUES (o_brand, o_owner, 'i3827 ' || p_tag, 'i3827-' || p_tag || '-' || o_brand, 'stripe');
  INSERT INTO public.events(id, brand_id, title, slug, event_type, status, visibility,
                            timezone, is_multi_date, is_recurring)
    VALUES (o_event, o_brand, 'i3827 ' || p_tag, 'i3827-' || p_tag || '-' || o_event,
            'event', 'draft', 'draft', 'UTC', false, p_dates > 1);
  FOR v_i IN 1..p_dates LOOP
    INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
      VALUES (o_event,
              now() + ((v_i - 1) || ' days')::interval - interval '1 hour',
              now() + ((v_i - 1) || ' days')::interval + interval '5 hours',
              'UTC', v_i = 1);
  END LOOP;
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

CREATE OR REPLACE FUNCTION pg_temp.i3827_member(p_brand uuid, p_role text)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_user uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users(id, email) VALUES (v_user, 'i3827-' || p_role || '-' || v_user || '@example.test');
  INSERT INTO public.brand_team_members(brand_id, user_id, role, invited_at, accepted_at)
    VALUES (p_brand, v_user, p_role, now(), now());
  RETURN v_user;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.i3827_pepper() RETURNS text LANGUAGE sql AS $$
  SELECT 'i3827-test-pepper-0123456789abcdef'::text;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- H1 / H2 / H6 / H-N8 / A1 / T-M1 — issue, replay, name-only, plus-ones,
-- capacity, the money shape
-- ═══════════════════════════════════════════════════════════════════════════
DO $h1$
DECLARE
  f record;
  v_mgr uuid;
  v_req uuid := gen_random_uuid();
  v_res jsonb;
  v_res2 jsonb;
  v_orders int;
  v_tickets int;
  v_sold int;
  v_going_before int;
  v_going_after int;
  v_notif int;
  v_guest_order uuid;
  v_po_order uuid;
  v_err text;
BEGIN
  SELECT * INTO f FROM pg_temp.i3827_event('h1', 10);
  v_mgr := pg_temp.i3827_member(f.o_brand, 'event_manager');

  v_going_before := COALESCE((public.pg_public_social_proof(f.o_event) ->> 'goingCount')::int, 0);

  -- Ana: solo with email. Ben: two blank plus-ones (one order, three tickets)
  -- and one named plus-one with an email (their own order).
  v_res := public.biz_comp_issue(v_mgr, f.o_event, f.o_tt, NULL,
    jsonb_build_array(
      jsonb_build_object('index', 0, 'name', 'Ana Bello', 'email', 'Ana@Example.test', 'phoneE164', NULL),
      jsonb_build_object('index', 1, 'name', 'Ben Okoro', 'email', 'ben@example.test', 'phoneE164', '+2348011112222',
        'plusOnes', jsonb_build_array(
          jsonb_build_object('name', NULL, 'email', NULL, 'phoneE164', NULL),
          jsonb_build_object('name', 'Chidi Eze', 'email', 'chidi@example.test', 'phoneE164', NULL),
          jsonb_build_object('name', '', 'email', '', 'phoneE164', '')))
    ), 'Press list', v_req, pg_temp.i3827_pepper());

  PERFORM pg_temp.i3827_assert((v_res ->> 'addedCount')::int = 3 AND (v_res ->> 'failedCount')::int = 0,
    'H1 three people added (Ana, Ben, Chidi), none failed');
  SELECT count(*), sum((SELECT count(*) FROM public.tickets t WHERE t.order_id = o.id))
    INTO v_orders, v_tickets
    FROM public.orders o WHERE o.event_id = f.o_event AND o.source = 'comp';
  PERFORM pg_temp.i3827_assert(v_orders = 3 AND v_tickets = 5, 'H1 3 comp orders, 5 tickets');
  PERFORM pg_temp.i3827_assert(
    NOT EXISTS (SELECT 1 FROM public.tickets t JOIN public.orders o ON o.id = t.order_id
                 WHERE o.event_id = f.o_event
                   AND (t.qr_code !~ '^mingla:v1:ticket:[0-9a-f-]{36}:sig:[a-f0-9]{64}$'
                        OR t.qr_token_hash IS NULL OR t.status <> 'valid'
                        OR t.approval_status <> 'auto' OR t.issued_at <> t.created_at)),
    'H1 every comp ticket has a signed QR, a token hash, valid/auto, issued_at = created_at');
  PERFORM pg_temp.i3827_assert(
    NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.event_id = f.o_event
                   AND (o.total_cents <> 0 OR o.buyer_total_cents <> 0 OR o.buyer_fees_cents <> 0
                        OR o.stripe_application_fee_amount_cents <> 0 OR o.payment_method <> 'free'
                        OR o.payment_status <> 'paid' OR o.comp_issued_by <> v_mgr
                        OR o.comp_reason <> 'Press list' OR o.buyer_user_id IS NOT NULL)),
    'H1 comp orders carry zero money, free/paid, issued by the manager, with the note');
  SELECT sold_count INTO v_sold FROM public.ticket_types WHERE id = f.o_tt;
  PERFORM pg_temp.i3827_assert(v_sold = 5, 'H1 sold_count counts the 5 places');
  PERFORM pg_temp.i3827_assert((v_res ->> 'remaining')::int = 5, 'H1 remaining = 5');
  v_going_after := COALESCE((public.pg_public_social_proof(f.o_event) ->> 'goingCount')::int, 0);
  PERFORM pg_temp.i3827_assert(v_going_after = v_going_before + 5, 'H1 public going count includes the 5 comp tickets');
  SELECT count(*) INTO v_notif FROM public.ticket_order_notifications n
    JOIN public.orders o ON o.id = n.order_id WHERE o.event_id = f.o_event AND n.channel = 'email';
  PERFORM pg_temp.i3827_assert(v_notif = 3, 'H1 one confirmation email row per emailed person');
  PERFORM pg_temp.i3827_assert(
    (SELECT recipient FROM public.ticket_order_notifications n JOIN public.orders o ON o.id = n.order_id
      WHERE o.event_id = f.o_event AND o.buyer_name = 'Ana Bello' AND n.channel = 'email') = 'ana@example.test',
    'H1 email is lowercased');

  -- H-N8: Ben's order holds his two blank plus-ones; Chidi has his own order.
  SELECT o.id INTO v_guest_order FROM public.orders o WHERE o.event_id = f.o_event AND o.buyer_name = 'Ben Okoro';
  SELECT o.id INTO v_po_order FROM public.orders o WHERE o.event_id = f.o_event AND o.buyer_name = 'Chidi Eze';
  PERFORM pg_temp.i3827_assert((SELECT count(*) FROM public.tickets WHERE order_id = v_guest_order) = 3,
    'H-N8 the guest order holds the guest plus 2 blank plus-ones');
  PERFORM pg_temp.i3827_assert(
    (SELECT count(*) FROM public.tickets WHERE order_id = v_po_order) = 1
    AND (SELECT comp_party_lead_order_id FROM public.orders WHERE id = v_po_order) = v_guest_order
    AND (SELECT metadata ->> 'party_lead_name' FROM public.orders WHERE id = v_po_order) = 'Ben Okoro'
    AND (SELECT metadata ->> 'party_origin' FROM public.orders WHERE id = v_po_order) = 'host',
    'H-N8 a named plus-one is their own order of 1 ticket, pointing at the guest with the lead name');
  PERFORM pg_temp.i3827_assert(
    (SELECT count(*) FROM public.ticket_order_notifications WHERE order_id = v_guest_order AND channel = 'sms') = 1,
    'H1 a phone queues an SMS row');

  -- H2: the same clientRequestId replays, nothing new is written.
  v_res2 := public.biz_comp_issue(v_mgr, f.o_event, f.o_tt, NULL,
    jsonb_build_array(
      jsonb_build_object('index', 0, 'name', 'Ana Bello', 'email', 'ana@example.test', 'phoneE164', NULL),
      jsonb_build_object('index', 1, 'name', 'Ben Okoro', 'email', 'ben@example.test', 'phoneE164', '+2348011112222',
        'plusOnes', jsonb_build_array(
          jsonb_build_object('name', NULL, 'email', NULL, 'phoneE164', NULL),
          jsonb_build_object('name', 'Chidi Eze', 'email', 'chidi@example.test', 'phoneE164', NULL),
          jsonb_build_object('name', NULL, 'email', NULL, 'phoneE164', NULL)))
    ), 'Press list', v_req, pg_temp.i3827_pepper());
  PERFORM pg_temp.i3827_assert(
    (SELECT bool_and(r ->> 'status' = 'replayed') FROM jsonb_array_elements(v_res2 -> 'results') r),
    'H2 a retry with the same clientRequestId replays every person');
  PERFORM pg_temp.i3827_assert(
    (SELECT count(*) FROM public.orders WHERE event_id = f.o_event) = 3
    AND (SELECT sold_count FROM public.ticket_types WHERE id = f.o_tt) = 5,
    'H2 replay wrote nothing');

  -- A3: the same email again under a new request is refused per person.
  v_res2 := public.biz_comp_issue(v_mgr, f.o_event, f.o_tt, NULL,
    jsonb_build_array(jsonb_build_object('index', 0, 'name', 'Ana Again', 'email', 'ANA@example.test')),
    NULL, gen_random_uuid(), pg_temp.i3827_pepper());
  PERFORM pg_temp.i3827_assert(v_res2 -> 'results' -> 0 ->> 'code' = 'already_on_guest_list',
    'A3 a live guest-list email is refused: already_on_guest_list');

  -- H6: a name-only guest gets a ticket and no notification row at all.
  v_res2 := public.biz_comp_issue(v_mgr, f.o_event, f.o_tt, NULL,
    jsonb_build_array(jsonb_build_object('index', 0, 'name', 'Door Only')),
    NULL, gen_random_uuid(), pg_temp.i3827_pepper());
  PERFORM pg_temp.i3827_assert(
    (SELECT notification_status FROM public.orders WHERE event_id = f.o_event AND buyer_name = 'Door Only') = 'not_required'
    AND NOT EXISTS (SELECT 1 FROM public.ticket_order_notifications n JOIN public.orders o ON o.id = n.order_id
                     WHERE o.buyer_name = 'Door Only' AND o.event_id = f.o_event)
    AND (v_res2 -> 'results' -> 0 ->> 'emailQueued')::boolean = false,
    'H6 name-only guest: not_required, zero notification rows, emailQueued false');

  -- A1: remaining is 4; a batch of 2 + 3 needs 5 -> refused, NOTHING inserted.
  v_err := pg_temp.i3827_err(format(
    'SELECT public.biz_comp_issue(%L, %L, %L, NULL, %L::jsonb, NULL, %L, %L)',
    v_mgr, f.o_event, f.o_tt,
    jsonb_build_array(
      jsonb_build_object('index', 0, 'name', 'Cap One', 'plusOnes', jsonb_build_array(jsonb_build_object())),
      jsonb_build_object('index', 1, 'name', 'Cap Two', 'plusOnes',
        jsonb_build_array(jsonb_build_object(), jsonb_build_object()))),
    gen_random_uuid(), pg_temp.i3827_pepper()));
  PERFORM pg_temp.i3827_assert(v_err = 'ticket_capacity_exceeded', 'A1 over capacity: ticket_capacity_exceeded');
  PERFORM pg_temp.i3827_assert(
    NOT EXISTS (SELECT 1 FROM public.orders WHERE event_id = f.o_event AND buyer_name LIKE 'Cap %')
    AND (SELECT sold_count FROM public.ticket_types WHERE id = f.o_tt) = 6,
    'A1 all-or-nothing: no guest of the refused batch was inserted');

  -- T-M1 / T-M2: a comp with money or a provider id cannot be written.
  v_err := pg_temp.i3827_err(format(
    'UPDATE public.orders SET total_cents = 1 WHERE id = %L', v_guest_order));
  PERFORM pg_temp.i3827_assert(v_err LIKE '%orders_comp_shape_check%', 'T-M1 a comp with total_cents 1 violates orders_comp_shape_check');
  v_err := pg_temp.i3827_err(format(
    'UPDATE public.orders SET stripe_payment_intent_id = %L WHERE id = %L', 'pi_x', v_guest_order));
  PERFORM pg_temp.i3827_assert(v_err LIKE '%orders_comp_shape_check%', 'T-M2 a comp with a payment intent violates orders_comp_shape_check');

  -- Roster: an unlinked comp order is a guest-list row.
  PERFORM pg_temp.i3827_assert(
    EXISTS (SELECT 1 FROM public.biz_guest_roster_project(f.o_event) r
             WHERE r.row_data ->> 'rosterKey' = 'order:' || v_guest_order::text
               AND (r.row_data ->> 'guestList')::boolean),
    'roster: the comp order row carries guestList = true');
END
$h1$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Permission, event gates, hidden tiers, day choice (H3, H4, A4, A12)
-- ═══════════════════════════════════════════════════════════════════════════
DO $gates$
DECLARE
  f record;
  r record;
  v_tt_hidden uuid;
  v_err text;
  v_res jsonb;
  v_role text;
BEGIN
  SELECT * INTO f FROM pg_temp.i3827_event('gates', 10);

  FOREACH v_role IN ARRAY ARRAY['marketing_manager', 'finance_manager', 'scanner'] LOOP
    v_err := pg_temp.i3827_err(format(
      'SELECT public.biz_comp_issue(%L, %L, %L, NULL, %L::jsonb, NULL, %L, %L)',
      pg_temp.i3827_member(f.o_brand, v_role), f.o_event, f.o_tt,
      jsonb_build_array(jsonb_build_object('index', 0, 'name', 'X')), gen_random_uuid(), pg_temp.i3827_pepper()));
    PERFORM pg_temp.i3827_assert(v_err = 'forbidden', 'A4 ' || v_role || ' cannot issue: forbidden');
  END LOOP;

  -- H3: a hidden, offline, sale-ended tier still takes comps.
  INSERT INTO public.ticket_types(event_id, name, price_cents, is_free, quantity_total, min_purchase_qty,
                                  available_online, available_in_person, display_order, is_hidden,
                                  sale_end_at)
    VALUES (f.o_event, 'Guest list', 0, true, 20, 1, false, false, 1, true, now() - interval '1 day')
    RETURNING id INTO v_tt_hidden;
  v_res := public.biz_comp_issue(f.o_owner, f.o_event, v_tt_hidden, NULL,
    jsonb_build_array(jsonb_build_object('index', 0, 'name', 'Hidden Tier Guest')),
    NULL, gen_random_uuid(), pg_temp.i3827_pepper());
  PERFORM pg_temp.i3827_assert((v_res ->> 'addedCount')::int = 1, 'H3 hidden + offline + sale-ended tier allowed (owner)');

  -- Malformed input fails the whole call.
  v_err := pg_temp.i3827_err(format(
    'SELECT public.biz_comp_issue(%L, %L, %L, NULL, %L::jsonb, NULL, %L, %L)',
    f.o_owner, f.o_event, f.o_tt,
    jsonb_build_array(jsonb_build_object('index', 0, 'name', 'Bad', 'plusOnes',
      jsonb_build_array(jsonb_build_object('email', 'nameless@example.test')))),
    gen_random_uuid(), pg_temp.i3827_pepper()));
  PERFORM pg_temp.i3827_assert(v_err = 'invalid_guests', 'a plus-one with an email but no name: invalid_guests');
  v_err := pg_temp.i3827_err(format(
    'SELECT public.biz_comp_issue(%L, %L, %L, NULL, %L::jsonb, NULL, %L, %L)',
    f.o_owner, f.o_event, f.o_tt,
    jsonb_build_array(
      jsonb_build_object('index', 0, 'name', 'Twice', 'email', 'twice@example.test'),
      jsonb_build_object('index', 1, 'name', 'Twice Too', 'email', 'TWICE@example.test')),
    gen_random_uuid(), pg_temp.i3827_pepper()));
  PERFORM pg_temp.i3827_assert(v_err = 'invalid_guests', 'the same email twice in one batch: invalid_guests');

  -- A12: an RSVP event, a draft event.
  UPDATE public.events SET event_type = 'rsvp' WHERE id = f.o_event;
  v_err := pg_temp.i3827_err(format(
    'SELECT public.biz_comp_issue(%L, %L, %L, NULL, %L::jsonb, NULL, %L, %L)',
    f.o_owner, f.o_event, f.o_tt, jsonb_build_array(jsonb_build_object('index', 0, 'name', 'X')),
    gen_random_uuid(), pg_temp.i3827_pepper()));
  PERFORM pg_temp.i3827_assert(v_err = 'event_type_unsupported', 'A12 rsvp event: event_type_unsupported');
  UPDATE public.events SET event_type = 'event', status = 'cancelled' WHERE id = f.o_event;
  v_err := pg_temp.i3827_err(format(
    'SELECT public.biz_comp_issue(%L, %L, %L, NULL, %L::jsonb, NULL, %L, %L)',
    f.o_owner, f.o_event, f.o_tt, jsonb_build_array(jsonb_build_object('index', 0, 'name', 'X')),
    gen_random_uuid(), pg_temp.i3827_pepper()));
  PERFORM pg_temp.i3827_assert(v_err = 'event_not_open', 'A12 cancelled event: event_not_open');

  -- H4 / H5: a recurring event with two upcoming nights needs a date; a bound
  -- date gives one ticket_event_dates row per ticket and is admitted tonight.
  SELECT * INTO r FROM pg_temp.i3827_event('recurring', 10, 2);
  v_err := pg_temp.i3827_err(format(
    'SELECT public.biz_comp_issue(%L, %L, %L, NULL, %L::jsonb, NULL, %L, %L)',
    r.o_owner, r.o_event, r.o_tt, jsonb_build_array(jsonb_build_object('index', 0, 'name', 'X')),
    gen_random_uuid(), pg_temp.i3827_pepper()));
  PERFORM pg_temp.i3827_assert(v_err = 'event_date_choice_required', 'H4 recurring event without a date: event_date_choice_required');
  v_res := public.biz_comp_issue(r.o_owner, r.o_event, r.o_tt,
    (SELECT id FROM public.event_dates WHERE event_id = r.o_event ORDER BY start_at LIMIT 1),
    jsonb_build_array(jsonb_build_object('index', 0, 'name', 'Night One', 'plusOnes', jsonb_build_array(jsonb_build_object()))),
    NULL, gen_random_uuid(), pg_temp.i3827_pepper());
  PERFORM pg_temp.i3827_assert(
    (SELECT count(*) FROM public.ticket_event_dates ted JOIN public.tickets t ON t.id = ted.ticket_id
      WHERE t.order_id = (v_res -> 'results' -> 0 ->> 'orderId')::uuid) = 2,
    'H5 a bound date: one ticket_event_dates row per ticket');
  INSERT INTO public.event_scanners(event_id, user_id) VALUES (r.o_event, r.o_owner) ON CONFLICT DO NOTHING;
  PERFORM pg_temp.i3827_assert(
    public.biz_ticket_scan(r.o_event,
      (SELECT qr_code FROM public.tickets WHERE order_id = (v_res -> 'results' -> 0 ->> 'orderId')::uuid ORDER BY created_at, id LIMIT 1),
      r.o_owner, pg_temp.i3827_pepper()) ->> 'result' = 'success',
    'H5 the night-one comp is admitted tonight by biz_ticket_scan');
END
$gates$;

-- ═══════════════════════════════════════════════════════════════════════════
-- H7 cancel, H8 resend (comp and a bought order), H9 search, H10 admit
-- ═══════════════════════════════════════════════════════════════════════════
DO $door$
DECLARE
  f record;
  v_mgr uuid;
  v_scanner uuid;
  v_stranger uuid := gen_random_uuid();
  v_res jsonb;
  v_order uuid;
  v_other uuid;
  v_ticket uuid;
  v_qr text;
  v_err text;
  v_search jsonb;
  v_admit jsonb;
  v_sold_before int;
  v_paid_order uuid;
BEGIN
  SELECT * INTO f FROM pg_temp.i3827_event('door', 10);
  v_mgr := pg_temp.i3827_member(f.o_brand, 'event_manager');
  v_scanner := pg_temp.i3827_member(f.o_brand, 'scanner');
  INSERT INTO auth.users(id, email) VALUES (v_stranger, 'i3827-stranger-' || v_stranger || '@example.test');

  v_res := public.biz_comp_issue(v_mgr, f.o_event, f.o_tt, NULL,
    jsonb_build_array(
      jsonb_build_object('index', 0, 'name', 'Anna Admit', 'email', 'anna.admit@example.test', 'phoneE164', '+447700900123'),
      jsonb_build_object('index', 1, 'name', 'Cara Cancel', 'email', 'cara@example.test',
        'plusOnes', jsonb_build_array(jsonb_build_object()))),
    NULL, gen_random_uuid(), pg_temp.i3827_pepper());
  v_order := (v_res -> 'results' -> 0 ->> 'orderId')::uuid;
  v_other := (v_res -> 'results' -> 1 ->> 'orderId')::uuid;

  -- H9: search. A scanner may search; a stranger may not; no phone or full email.
  v_search := public.biz_door_guest_search(v_scanner, f.o_event, 'an', 20);
  PERFORM pg_temp.i3827_assert(
    EXISTS (SELECT 1 FROM jsonb_array_elements(v_search -> 'orders') o
             WHERE o ->> 'orderId' = v_order::text
               AND o ->> 'maskedEmail' = 'an***@example.test'
               AND (o ->> 'isGuestList')::boolean),
    'H9 scanner finds Anna by "an" with a masked email and the guest-list flag');
  PERFORM pg_temp.i3827_assert(
    position('+447700900123' in v_search::text) = 0 AND position('anna.admit@' in v_search::text) = 0,
    'H9 search returns no phone and no full email');
  v_err := pg_temp.i3827_err(format('SELECT public.biz_door_guest_search(%L, %L, %L, 20)', v_stranger, f.o_event, 'an'));
  PERFORM pg_temp.i3827_assert(v_err = 'forbidden', 'H9 a stranger cannot search: forbidden');
  v_err := pg_temp.i3827_err(format('SELECT public.biz_door_guest_search(%L, %L, %L, 20)', v_scanner, f.o_event, 'a'));
  PERFORM pg_temp.i3827_assert(v_err = 'query_too_short', 'H9 one letter: query_too_short');
  v_search := public.biz_door_guest_search(v_scanner, f.o_event, 'a%', 20);
  PERFORM pg_temp.i3827_assert(jsonb_array_length(v_search -> 'orders') = 0, 'A6 "a%" matches literally, not as a wildcard');

  -- H10: admit by id through the scan ladder.
  SELECT id, qr_code INTO v_ticket, v_qr FROM public.tickets WHERE order_id = v_order;
  v_admit := public.biz_ticket_admit_by_id(v_scanner, f.o_event, v_ticket, pg_temp.i3827_pepper());
  PERFORM pg_temp.i3827_assert(v_admit ->> 'result' = 'success', 'H10 admit by id: success');
  PERFORM pg_temp.i3827_assert(
    (SELECT count(*) FROM public.scan_events WHERE ticket_id = v_ticket) = 1
    AND (SELECT metadata ->> 'source' FROM public.scan_events WHERE ticket_id = v_ticket) = 'manual-admit'
    AND (SELECT metadata ->> 'via' FROM public.scan_events WHERE ticket_id = v_ticket) = 'name_search',
    'H10 exactly one scan row, tagged manual-admit / name_search');
  PERFORM pg_temp.i3827_assert(
    public.biz_ticket_admit_by_id(v_scanner, f.o_event, v_ticket, pg_temp.i3827_pepper()) ->> 'result' = 'duplicate',
    'H10 a second admit is a duplicate');
  PERFORM pg_temp.i3827_assert(
    public.biz_ticket_scan(f.o_event, v_qr, v_scanner, pg_temp.i3827_pepper()) ->> 'result' = 'duplicate',
    'H10 a QR scan after the admit is a duplicate');
  v_err := pg_temp.i3827_err(format('SELECT public.biz_ticket_admit_by_id(%L, %L, %L, %L)',
    v_stranger, f.o_event, v_ticket, pg_temp.i3827_pepper()));
  PERFORM pg_temp.i3827_assert(v_err = 'scanner_not_authorized', 'H10 a stranger cannot admit: scanner_not_authorized');

  -- A9: a checked-in comp cannot be cancelled.
  v_err := pg_temp.i3827_err(format('SELECT public.biz_comp_cancel(%L, %L, NULL, %L)', v_mgr, v_order, gen_random_uuid()));
  PERFORM pg_temp.i3827_assert(v_err = 'comp_already_checked_in', 'A9 cancel after check-in: comp_already_checked_in');

  -- H7: cancel Cara (2 tickets) — void, places freed, the QR stops working, email row.
  SELECT sold_count INTO v_sold_before FROM public.ticket_types WHERE id = f.o_tt;
  v_res := public.biz_comp_cancel(v_mgr, v_other, 'No', gen_random_uuid());
  PERFORM pg_temp.i3827_assert(v_res ->> 'status' = 'cancelled' AND NOT (v_res ->> 'idempotentReplay')::boolean,
    'H7 cancel: cancelled');
  PERFORM pg_temp.i3827_assert(
    (SELECT payment_status FROM public.orders WHERE id = v_other) = 'cancelled'
    AND (SELECT cancellation_reason FROM public.orders WHERE id = v_other) = 'No'
    AND NOT EXISTS (SELECT 1 FROM public.tickets WHERE order_id = v_other AND status <> 'void'),
    'H7 order cancelled with a short reason, every ticket void');
  PERFORM pg_temp.i3827_assert(
    (SELECT sold_count FROM public.ticket_types WHERE id = f.o_tt) = v_sold_before - 2,
    'H7 cancel frees exactly the 2 voided places');
  PERFORM pg_temp.i3827_assert(
    public.biz_ticket_scan(f.o_event, (SELECT qr_code FROM public.tickets WHERE order_id = v_other LIMIT 1),
      v_scanner, pg_temp.i3827_pepper()) ->> 'result' = 'void',
    'H7 a cancelled comp scans as void');
  PERFORM pg_temp.i3827_assert(
    EXISTS (SELECT 1 FROM public.ticket_order_notifications
             WHERE order_id = v_other AND payload ->> 'template_key' = 'buyer_order_cancelled'),
    'H7 the cancellation email row is queued');
  PERFORM pg_temp.i3827_assert(
    NOT EXISTS (SELECT 1 FROM public.refunds WHERE order_id = v_other),
    'H7 no refund row');
  PERFORM pg_temp.i3827_assert(
    (public.biz_comp_cancel(v_mgr, v_other, NULL, gen_random_uuid()) ->> 'idempotentReplay')::boolean,
    'H7 cancelling again is an idempotent replay');
  -- A3 (second half): after a cancel the same email can be added again.
  v_res := public.biz_comp_issue(v_mgr, f.o_event, f.o_tt, NULL,
    jsonb_build_array(jsonb_build_object('index', 0, 'name', 'Cara Back', 'email', 'cara@example.test')),
    NULL, gen_random_uuid(), pg_temp.i3827_pepper());
  PERFORM pg_temp.i3827_assert(v_res -> 'results' -> 0 ->> 'status' = 'added', 'A3 after a cancel the email can be re-added');

  -- H8: resend — three an hour, then rate_limited.
  PERFORM public.biz_comp_resend_prepare(v_mgr, v_order, gen_random_uuid());
  PERFORM public.biz_comp_resend_prepare(v_mgr, v_order, gen_random_uuid());
  PERFORM public.biz_comp_resend_prepare(v_mgr, v_order, gen_random_uuid());
  PERFORM pg_temp.i3827_assert(
    (SELECT count(*) FROM public.ticket_order_notifications
      WHERE order_id = v_order AND idempotency_key LIKE 'ticket_resend:%' AND status = 'pending') = 3,
    'H8 three resend rows queued');
  v_err := pg_temp.i3827_err(format('SELECT public.biz_comp_resend_prepare(%L, %L, %L)', v_mgr, v_order, gen_random_uuid()));
  PERFORM pg_temp.i3827_assert(v_err = 'rate_limited', 'H8 the 4th resend in an hour: rate_limited');
  v_err := pg_temp.i3827_err(format('SELECT public.biz_comp_resend_prepare(%L, %L, %L)', v_mgr, v_other, gen_random_uuid()));
  PERFORM pg_temp.i3827_assert(v_err = 'not_resendable', 'H8 a cancelled order: not_resendable');
  v_err := pg_temp.i3827_err(format('SELECT public.biz_comp_resend_prepare(%L, %L, %L)', v_scanner, v_order, gen_random_uuid()));
  PERFORM pg_temp.i3827_assert(v_err = 'forbidden', 'H8 a scanner cannot resend: forbidden');

  -- Q10: a BOUGHT (online_checkout) order can be resent too.
  INSERT INTO public.orders(event_id, buyer_email, buyer_name, buyer_phone_e164, total_cents, currency,
                            payment_method, payment_status, source)
    VALUES (f.o_event, 'buyer@example.test', 'Bought Buyer', '+447700900999', 0, 'GBP', 'free', 'paid', 'online_checkout')
    RETURNING id INTO v_paid_order;
  v_res := public.biz_comp_resend_prepare(v_mgr, v_paid_order, gen_random_uuid());
  PERFORM pg_temp.i3827_assert((v_res ->> 'queued')::boolean
    AND EXISTS (SELECT 1 FROM public.ticket_order_notifications
                 WHERE order_id = v_paid_order AND payload ->> 'source' = 'online_checkout' AND (payload ->> 'resend')::boolean),
    'Q10 resend works for a bought order of the event');
END
$door$;

-- ═══════════════════════════════════════════════════════════════════════════
-- H11 — finalize keeps minting through the one helper (§2.4c)
-- ═══════════════════════════════════════════════════════════════════════════
DO $h11$
DECLARE
  f record;
  v_session jsonb;
  v_final jsonb;
  v_order uuid;
  v_tt_group uuid;
BEGIN
  SELECT * INTO f FROM pg_temp.i3827_event('finalize', 10);
  INSERT INTO public.event_scanners(event_id, user_id) VALUES (f.o_event, f.o_owner) ON CONFLICT DO NOTHING;
  v_session := public.biz_ticket_checkout_create_session(
    f.o_event, NULL, 'Free Buyer', 'free.buyer@example.test', '+15550001111', false,
    jsonb_build_array(jsonb_build_object('ticketTypeId', f.o_tt, 'quantity', 2)),
    'i3827:finalize:' || f.o_event::text, now() + interval '15 minutes', 0, 'auto', NULL);
  v_final := public.issue_1930_ticket_checkout_finalize_base(
    (v_session ->> 'checkoutSessionId')::uuid, NULL, NULL, NULL, pg_temp.i3827_pepper(), NULL, NULL, false);
  v_order := (v_final ->> 'orderId')::uuid;
  PERFORM pg_temp.i3827_assert(jsonb_array_length(v_final -> 'tickets') = 2, 'H11 finalize returns 2 tickets');
  PERFORM pg_temp.i3827_assert(
    (SELECT count(*) FROM public.tickets WHERE order_id = v_order
      AND qr_code ~ '^mingla:v1:ticket:[0-9a-f-]{36}:sig:[a-f0-9]{64}$'
      AND qr_token_hash IS NOT NULL AND approval_status = 'auto' AND issued_at = created_at
      AND admits_count = 1 AND attendee_email = 'free.buyer@example.test') = 2,
    'H11 finalize tickets: signed QR, hash, auto, issued_at = created_at, admits 1, attendee from buyer');
  PERFORM pg_temp.i3827_assert(
    (SELECT array_agg(t.qr_code ORDER BY t.created_at, t.id) FROM public.tickets t WHERE t.order_id = v_order)
      = (SELECT array_agg(x ->> 'qrPayload' ORDER BY x ->> 'qrPayload') FROM jsonb_array_elements(v_final -> 'tickets') x)
    OR (SELECT count(*) FROM jsonb_array_elements(v_final -> 'tickets') x
          JOIN public.tickets t ON t.id = (x ->> 'ticketId')::uuid AND t.qr_code = x ->> 'qrPayload') = 2,
    'H11 the envelope QR payloads are the stored ones');
  PERFORM pg_temp.i3827_assert(
    public.biz_ticket_scan(f.o_event, (v_final -> 'tickets' -> 0 ->> 'qrPayload'), f.o_owner, pg_temp.i3827_pepper()) ->> 'result' = 'success',
    'H11 a finalized ticket is admitted');
  PERFORM pg_temp.i3827_assert((SELECT source FROM public.orders WHERE id = v_order) = 'online_checkout',
    'H11 a checkout order stays online_checkout');
END
$h11$;

-- ═══════════════════════════════════════════════════════════════════════════
-- A10 — ACL
-- ═══════════════════════════════════════════════════════════════════════════
DO $acl$
DECLARE
  v_sig text;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public.issue_3827_mint_ticket(uuid,uuid,uuid,text,text,text,text,timestamptz)',
    'public.issue_3827_can_door_scan(uuid,uuid)',
    'public.issue_3827_comp_issue_one(uuid,uuid,uuid,uuid,text,text,text,integer,text,text,uuid,uuid,text,uuid,text,text,jsonb)',
    'public.biz_comp_issue(uuid,uuid,uuid,uuid,jsonb,text,uuid,text)',
    'public.biz_comp_cancel(uuid,uuid,text,uuid)',
    'public.biz_comp_resend_prepare(uuid,uuid,uuid)',
    'public.biz_door_guest_search(uuid,uuid,text,integer)',
    'public.biz_ticket_admit_by_id(uuid,uuid,uuid,text)'
  ] LOOP
    PERFORM pg_temp.i3827_assert(
      NOT has_function_privilege('anon', v_sig, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', v_sig, 'EXECUTE')
      AND has_function_privilege('service_role', v_sig, 'EXECUTE'),
      'A10 service_role only: ' || v_sig);
  END LOOP;
END
$acl$;

ROLLBACK;
