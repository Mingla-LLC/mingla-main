-- issue #3313 — IMPLEMENTOR regression suite. EXECUTED against the real
-- migration chain, not simulated.
--
-- ── WHAT BROKE ─────────────────────────────────────────────────────────────
-- Publishing "every Tuesday, 8 times" created ONE Tuesday. The live When edit
-- rebuilt one target for a recurring event, the public reader never offered a
-- night, checkout recorded orders with no night (an any-night pass, no payout
-- anchor), and capacity was shared by every night of the run.
--
-- ── WHAT THIS SUITE PROVES ────────────────────────────────────────────────
--   T-01  publish materialises every rule date (count 8 -> 8; never -> 52),
--         one master, the organiser's local start time across a DST change
--   T-02  issue_3313_recurrence_occurrences == pg_expand_experience_recurrence
--         for every preset and termination kind (parity)
--   T-03  a live recurring save with no change keeps every id; a retime with
--         no sales moves every date IN PLACE
--   T-04  a retime with sales is refused (schedule_change_with_sales); a held
--         night is never deleted, acknowledged or not
--   T-05  a live rule change stores the rule, flags and organiser copy it
--         materialised
--   T-06  the event top-up keeps never-ending events at 52 upcoming dates,
--         is idempotent, and leaves count rules alone
--   T-07  the public reader: isMultiDate = "must pick a day", upcoming nights
--         only for recurring, the rule rides along; multi-date unchanged
--   T-08  checkout: no night on a recurring (>1 upcoming) or multi-date event
--         is refused; one upcoming night binds; single-date unchanged
--   T-09  capacity is PER NIGHT on a recurring event (sold and held), and the
--         same under all_days
--   T-10  the reader's `remaining` is the most any upcoming night has left
--   T-11  the tier editor's capacity floor is the busiest night on a
--         recurring event and the whole run everywhere else
--
-- ── FAILS-ON-REVERT CONTRACT ──────────────────────────────────────────────
-- Re-apply the five source definitions named in the migration header
-- (publish 20270701003288, patch 20270628003285, session base + bundle
-- 20270609002879, tiers 20270526002590) with the #3313 helper functions left in
-- place, and this file goes RED at T-01 (publish), T-03 (patch), T-07 (bundle),
-- T-08/T-09 (session base) and T-11 (tiers). T-02 and T-06 fail on revert of
-- the helper functions themselves. Revert proof is recorded on the PR.
--
-- Every check RAISEs on failure; the psql exit code is the verdict. One
-- transaction, ending in ROLLBACK.

\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.i3313_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #3313 FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END $$;

-- Local date (YYYY-MM-DD) of the first given weekday (0=Sun..6=Sat) at least
-- p_min_days ahead in p_tz.
CREATE OR REPLACE FUNCTION pg_temp.i3313_next_dow(p_dow integer, p_min_days integer, p_tz text)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT to_char(d + ((p_dow - EXTRACT(dow FROM d)::int + 7) % 7), 'YYYY-MM-DD')
    FROM (SELECT (now() AT TIME ZONE p_tz)::date + p_min_days AS d) x
$$;

-- An owner, their creator account and a brand.
CREATE OR REPLACE FUNCTION pg_temp.i3313_owner(p_tag text, OUT o_user uuid, OUT o_brand uuid)
LANGUAGE plpgsql AS $$
BEGIN
  o_user := gen_random_uuid();
  o_brand := gen_random_uuid();
  PERFORM set_config('request.jwt.claim.sub', '', true);
  INSERT INTO auth.users(id, email) VALUES (o_user, 'i3313-' || p_tag || '-' || o_user || '@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (o_user);
  INSERT INTO public.brands(id, account_id, name, slug)
    VALUES (o_brand, o_user, 'i3313 ' || p_tag, 'i3313-' || p_tag || '-' || o_brand);
END $$;

-- A draft published through the REAL wizard entry point with a free ticket.
CREATE OR REPLACE FUNCTION pg_temp.i3313_publish_recurring(
  p_tag text, p_rule jsonb, p_date text, p_doors text, p_ends text, p_tz text,
  p_capacity integer DEFAULT 100,
  OUT o_event uuid, OUT o_owner uuid
) LANGUAGE plpgsql AS $$
DECLARE o record;
BEGIN
  SELECT * INTO o FROM pg_temp.i3313_owner(p_tag);
  o_owner := o.o_user;
  o_event := gen_random_uuid();
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility,
                            timezone, theme)
    VALUES (o_event, o.o_brand, o.o_user, 'i3313 ' || p_tag, 'draft-i3313-' || o_event,
            'event', 'draft', 'draft', p_tz,
            jsonb_build_object('business_draft', jsonb_build_object(
              'clientRevision', 0, 'requestedVisibility', 'public')));
  PERFORM set_config('request.jwt.claim.sub', o.o_user::text, true);
  PERFORM public.issue_1719_publish_event_with_poster(o_event, jsonb_build_object(
    'title', 'i3313 ' || p_tag,
    'timezone', p_tz,
    'is_online', true,
    'online_url', 'https://meet.example.test/i3313',
    'is_recurring', true,
    'recurrence_rules', p_rule,
    'theme', jsonb_build_object('business_draft', jsonb_build_object(
      'format', 'online',
      'requestedVisibility', 'public',
      'clientRevision', 1,
      'tickets', jsonb_build_array(jsonb_build_object(
        'name', 'Table Seat', 'isFree', true, 'price', 0, 'capacity', p_capacity)),
      'partyTypes', jsonb_build_array('festival'),
      'vibeTags', jsonb_build_array('social'),
      'whenMode', 'recurring',
      'recurrenceRule', p_rule,
      'when', jsonb_build_object('date', p_date, 'doorsOpen', p_doors, 'endsAt', p_ends)
    ))
  ), 1);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END $$;

-- A scheduled free event with hand-placed dates. p_mode: single|multi|recurring.
-- p_starts are absolute instants; each date lasts 4 hours.
CREATE OR REPLACE FUNCTION pg_temp.i3313_event(
  p_tag text, p_mode text, p_starts timestamptz[], p_capacity integer DEFAULT 100,
  p_pricing text DEFAULT 'per_day',
  OUT o_event uuid, OUT o_owner uuid, OUT o_ticket_type uuid
) LANGUAGE plpgsql AS $$
DECLARE o record; v_i integer;
BEGIN
  SELECT * INTO o FROM pg_temp.i3313_owner(p_tag);
  o_owner := o.o_user;
  o_event := gen_random_uuid();
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility,
                            timezone, is_multi_date, is_recurring, recurrence_rules,
                            multi_date_pricing_mode)
    VALUES (o_event, o.o_brand, o.o_user, 'i3313 ' || p_tag, 'i3313-' || p_tag || '-' || o_event,
            'event', 'draft', 'draft', 'UTC', p_mode = 'multi', p_mode = 'recurring',
            CASE WHEN p_mode = 'recurring' THEN
              '{"preset":"daily","termination":{"kind":"count","count":8}}'::jsonb END,
            p_pricing);
  FOR v_i IN 1 .. array_length(p_starts, 1) LOOP
    INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
      VALUES (o_event, p_starts[v_i], p_starts[v_i] + interval '4 hours', 'UTC', v_i = 1);
  END LOOP;
  INSERT INTO public.ticket_types(event_id, name, price_cents, is_free, quantity_total,
                                  min_purchase_qty, available_online, available_in_person,
                                  display_order)
    VALUES (o_event, 'Entry', 0, true, p_capacity, 1, true, true, 0)
    RETURNING id INTO o_ticket_type;
  PERFORM set_config('mingla.publish_free_only', 'on', true);
  UPDATE public.events SET status = 'scheduled', visibility = 'public', published_at = now()
   WHERE id = o_event;
  PERFORM set_config('mingla.publish_free_only', '', true);
END $$;

CREATE OR REPLACE FUNCTION pg_temp.i3313_nth(p_event uuid, p_n integer)
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM public.event_dates WHERE event_id = p_event ORDER BY start_at, id OFFSET p_n - 1 LIMIT 1
$$;

CREATE OR REPLACE FUNCTION pg_temp.i3313_ids(p_event uuid)
RETURNS uuid[] LANGUAGE sql STABLE AS $$
  SELECT COALESCE(array_agg(id ORDER BY start_at, id), '{}') FROM public.event_dates WHERE event_id = p_event
$$;

-- Create a checkout session; returns the session json or raises.
CREATE OR REPLACE FUNCTION pg_temp.i3313_session(
  p_event uuid, p_ticket_type uuid, p_days uuid[], p_qty integer, p_key text
) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN public.biz_ticket_checkout_create_session(
    p_event, NULL, 'Recurring Guest', 'recurring@example.test', '+15550003313', false,
    jsonb_build_array(jsonb_build_object('ticketTypeId', p_ticket_type, 'quantity', p_qty)),
    'i3313:' || p_key || ':' || gen_random_uuid()::text,
    now() + interval '15 minutes', 0, 'auto', p_days);
END $$;

-- Error text of a session attempt, or NULL on success (subtransaction).
CREATE OR REPLACE FUNCTION pg_temp.i3313_session_err(
  p_event uuid, p_ticket_type uuid, p_days uuid[], p_qty integer, p_key text
) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    PERFORM pg_temp.i3313_session(p_event, p_ticket_type, p_days, p_qty, p_key);
    RETURN NULL;
  EXCEPTION WHEN OTHERS THEN
    RETURN SQLERRM;
  END;
END $$;

-- Reserve and finalize a free order; returns the order id.
CREATE OR REPLACE FUNCTION pg_temp.i3313_buy(
  p_event uuid, p_ticket_type uuid, p_days uuid[], p_qty integer, p_key text
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_session jsonb; v_id uuid; v_final jsonb;
BEGIN
  v_session := pg_temp.i3313_session(p_event, p_ticket_type, p_days, p_qty, p_key);
  v_id := (v_session ->> 'checkoutSessionId')::uuid;
  IF NOT public.issue_1930_ticket_session_authorized(v_id, p_event) THEN
    RAISE EXCEPTION 'i3313 fixture: session % not authorized', v_id;
  END IF;
  v_final := public.issue_1930_ticket_checkout_finalize_base(
    v_id, NULL, NULL, NULL, 'i3313-test-pepper-0123456789abcdef', NULL, NULL, false);
  RETURN (v_final ->> 'orderId')::uuid;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.i3313_patch(p_event uuid, p_actor uuid, p_payload jsonb)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_err text;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claim.sub', p_actor::text, true);
    PERFORM public.business_patch_event_when(p_event, p_payload, 'issue 3313 regression suite edit', NULL);
    v_err := NULL;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN v_err;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- T-01 — publish materialises every rule date.
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  f record; v_n integer; v_bad integer; v_date text;
BEGIN
  v_date := pg_temp.i3313_next_dow(2, 7, 'America/New_York'); -- a Tuesday
  SELECT * INTO f FROM pg_temp.i3313_publish_recurring('t01',
    '{"preset":"weekly","byDay":"TU","termination":{"kind":"count","count":8}}'::jsonb,
    v_date, '19:00', '23:00', 'America/New_York');

  SELECT count(*) INTO v_n FROM public.event_dates WHERE event_id = f.o_event;
  PERFORM pg_temp.i3313_assert(v_n = 8, 'T-01a weekly x 8 publishes 8 dates (got ' || v_n || ')');
  SELECT count(*) INTO v_n FROM public.event_dates WHERE event_id = f.o_event AND is_master;
  PERFORM pg_temp.i3313_assert(v_n = 1, 'T-01b exactly one master');
  PERFORM pg_temp.i3313_assert(
    (SELECT (start_at AT TIME ZONE 'America/New_York')::date::text FROM public.event_dates
      WHERE event_id = f.o_event AND is_master) = v_date,
    'T-01c the master is the first Tuesday');
  SELECT count(*) INTO v_bad FROM public.event_dates
   WHERE event_id = f.o_event
     AND ((start_at AT TIME ZONE 'America/New_York')::time <> '19:00'
          OR EXTRACT(dow FROM (start_at AT TIME ZONE 'America/New_York'))::int <> 2
          OR end_at - start_at <> interval '4 hours');
  PERFORM pg_temp.i3313_assert(v_bad = 0,
    'T-01d every date is a Tuesday 19:00-23:00 New York time, across any DST change');
  PERFORM pg_temp.i3313_assert(
    (SELECT recurrence_rules->>'byDay' FROM public.events WHERE id = f.o_event) = 'TU',
    'T-01e the stored rule is the rule that was expanded');

  SELECT * INTO f FROM pg_temp.i3313_publish_recurring('t01never',
    '{"preset":"weekly","byDay":"TU","termination":{"kind":"never"}}'::jsonb,
    v_date, '19:00', '23:00', 'America/New_York');
  SELECT count(*) INTO v_n FROM public.event_dates WHERE event_id = f.o_event;
  PERFORM pg_temp.i3313_assert(v_n = 52, 'T-01f a never-ending rule publishes the 52-date window (got ' || v_n || ')');
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- T-02 — parity: the read-only expansion equals the expander that publishes.
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  f record; v_rule jsonb; v_anchor timestamptz; v_exp text; v_srf text; v_case integer := 0;
BEGIN
  SELECT * INTO f FROM pg_temp.i3313_event('t02', 'single', ARRAY[now() + interval '400 days']);
  v_anchor := date_trunc('day', now()) + interval '3 days 18 hours';
  FOR v_rule IN SELECT value FROM jsonb_array_elements('[
    {"preset":"daily","termination":{"kind":"count","count":10}},
    {"preset":"daily","termination":{"kind":"never"}},
    {"preset":"weekly","byDay":"SA","termination":{"kind":"until","until":"2099-01-01"}},
    {"preset":"weekly","byDay":"MO","termination":{"kind":"count","count":1}},
    {"preset":"biweekly","byDay":"FR","termination":{"kind":"count","count":7}},
    {"preset":"monthly_dom","byMonthDay":15,"termination":{"kind":"never"}},
    {"preset":"monthly_dow","byDay":"TH","bySetPos":2,"termination":{"kind":"count","count":6}},
    {"preset":"monthly_dow","byDay":"SU","bySetPos":-1,"termination":{"kind":"never"}},
    {"termination":{"kind":"never"}}
  ]'::jsonb)
  LOOP
    v_case := v_case + 1;
    PERFORM public.pg_expand_experience_recurrence(f.o_event, v_anchor, v_anchor + interval '3 hours', v_rule, 'Europe/London');
    SELECT COALESCE(string_agg(start_at::text || '/' || end_at::text || '/' || timezone, ',' ORDER BY start_at), '')
      INTO v_exp FROM public.event_dates
     WHERE event_id = f.o_event AND NOT is_master;
    SELECT COALESCE(string_agg(o.start_at::text || '/' || o.end_at::text || '/Europe/London', ',' ORDER BY o.start_at), '')
      INTO v_srf
      FROM public.issue_3313_recurrence_occurrences(v_anchor, v_anchor + interval '3 hours', v_rule, 'Europe/London') o
     WHERE o.occurrence_index > 1;
    PERFORM pg_temp.i3313_assert(v_exp = v_srf AND (v_case IN (4, 9) OR length(v_exp) > 0),
      'T-02.' || v_case || ' expansion parity for ' || v_rule::text);
    DELETE FROM public.event_dates WHERE event_id = f.o_event AND NOT is_master;
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- T-03 / T-04 / T-05 — the live When edit on a recurring event.
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  f record; v_date text; v_rule jsonb; v_ids uuid[]; v_after uuid[]; v_err text; v_n integer;
  v_night2 uuid; v_tt uuid;
BEGIN
  v_date := pg_temp.i3313_next_dow(2, 14, 'America/New_York');
  v_rule := '{"preset":"weekly","byDay":"TU","termination":{"kind":"count","count":8}}'::jsonb;
  SELECT * INTO f FROM pg_temp.i3313_publish_recurring('t03', v_rule, v_date, '19:00', '23:00', 'America/New_York');
  v_ids := pg_temp.i3313_ids(f.o_event);

  -- T-03a unchanged save
  v_err := pg_temp.i3313_patch(f.o_event, f.o_owner, jsonb_build_object(
    'whenMode', 'recurring', 'timezone', 'America/New_York', 'multiDates', NULL,
    'recurrenceRule', v_rule,
    'when', jsonb_build_object('date', v_date, 'doorsOpen', '19:00', 'endsAt', '23:00')));
  PERFORM pg_temp.i3313_assert(v_err IS NULL AND pg_temp.i3313_ids(f.o_event) = v_ids,
    'T-03a an unchanged recurring save keeps all 8 ids (err=' || COALESCE(v_err, 'none') || ')');

  -- T-03b retime, no sales: every night moves in place
  v_err := pg_temp.i3313_patch(f.o_event, f.o_owner, jsonb_build_object(
    'whenMode', 'recurring', 'timezone', 'America/New_York', 'multiDates', NULL,
    'recurrenceRule', v_rule,
    'when', jsonb_build_object('date', v_date, 'doorsOpen', '20:00', 'endsAt', '23:30')));
  v_after := pg_temp.i3313_ids(f.o_event);
  SELECT count(*) INTO v_n FROM public.event_dates
   WHERE event_id = f.o_event AND (start_at AT TIME ZONE 'America/New_York')::time = '20:00';
  PERFORM pg_temp.i3313_assert(v_err IS NULL AND v_after = v_ids AND v_n = 8,
    'T-03b a retime with no sales moves all 8 nights in place (err=' || COALESCE(v_err, 'none')
    || ', moved=' || v_n || ')');

  -- T-04 sell a night-2 pass, then retime without acknowledgement
  v_night2 := pg_temp.i3313_nth(f.o_event, 2);
  SELECT id INTO v_tt FROM public.ticket_types WHERE event_id = f.o_event AND deleted_at IS NULL;
  INSERT INTO public.orders(id, event_id, buyer_email, buyer_name, buyer_phone_e164, total_cents,
                            currency, payment_method, payment_status, source, event_date_id)
    VALUES (gen_random_uuid(), f.o_event, 'i3313@example.test', 'Guest', '+15550003313', 0,
            NULL, 'free', 'paid', 'online_checkout', v_night2);
  INSERT INTO public.tickets(id, order_id, ticket_type_id, event_id, qr_code, qr_token_hash, status, approval_status)
    SELECT gen_random_uuid(), o.id, v_tt, f.o_event, 'mingla:v1:ticket:' || gen_random_uuid()::text,
           md5(gen_random_uuid()::text), 'valid', 'auto'
      FROM public.orders o WHERE o.event_id = f.o_event;
  INSERT INTO public.ticket_event_dates(ticket_id, event_date_id)
    SELECT t.id, v_night2 FROM public.tickets t WHERE t.event_id = f.o_event;

  v_err := pg_temp.i3313_patch(f.o_event, f.o_owner, jsonb_build_object(
    'whenMode', 'recurring', 'timezone', 'America/New_York', 'multiDates', NULL,
    'recurrenceRule', v_rule,
    'when', jsonb_build_object('date', v_date, 'doorsOpen', '21:00', 'endsAt', '23:30')));
  PERFORM pg_temp.i3313_assert(v_err LIKE '%schedule_change_with_sales%'
    AND pg_temp.i3313_ids(f.o_event) = v_ids,
    'T-04a a retime with sales is refused and nothing moves (err=' || COALESCE(v_err, 'none') || ')');

  -- T-04b acknowledged, but the new rule drops the held night: refused
  v_err := pg_temp.i3313_patch(f.o_event, f.o_owner, jsonb_build_object(
    'whenMode', 'recurring', 'timezone', 'America/New_York', 'multiDates', NULL,
    'acknowledgeSoldImpact', true,
    'recurrenceRule', '{"preset":"weekly","byDay":"TU","termination":{"kind":"count","count":1}}'::jsonb,
    'when', jsonb_build_object('date', v_date, 'doorsOpen', '20:00', 'endsAt', '23:30')));
  PERFORM pg_temp.i3313_assert(v_err LIKE '%multi_date_remove_with_sales%'
    AND v_night2 = ANY (pg_temp.i3313_ids(f.o_event)),
    'T-04b a held night is never deleted, even acknowledged (err=' || COALESCE(v_err, 'none') || ')');
END $$;

DO $$
DECLARE f record; v_date text; v_new jsonb; v_err text; v_bad integer; v_n integer; v_ev public.events%ROWTYPE;
BEGIN
  v_date := pg_temp.i3313_next_dow(2, 14, 'America/New_York');
  SELECT * INTO f FROM pg_temp.i3313_publish_recurring('t05',
    '{"preset":"weekly","byDay":"TU","termination":{"kind":"count","count":8}}'::jsonb,
    v_date, '19:00', '23:00', 'America/New_York');
  v_new := '{"preset":"weekly","byDay":"WE","termination":{"kind":"count","count":6}}'::jsonb;
  v_date := pg_temp.i3313_next_dow(3, 14, 'America/New_York');
  v_err := pg_temp.i3313_patch(f.o_event, f.o_owner, jsonb_build_object(
    'whenMode', 'recurring', 'timezone', 'America/New_York', 'multiDates', NULL,
    'recurrenceRule', v_new,
    'when', jsonb_build_object('date', v_date, 'doorsOpen', '19:00', 'endsAt', '23:00')));
  SELECT count(*) INTO v_n FROM public.event_dates WHERE event_id = f.o_event;
  SELECT count(*) INTO v_bad FROM public.event_dates
   WHERE event_id = f.o_event AND EXTRACT(dow FROM (start_at AT TIME ZONE 'America/New_York'))::int <> 3;
  SELECT * INTO v_ev FROM public.events WHERE id = f.o_event;
  PERFORM pg_temp.i3313_assert(v_err IS NULL AND v_n = 6 AND v_bad = 0,
    'T-05a a rule change with no sales materialises the new rule (err=' || COALESCE(v_err, 'none')
    || ', n=' || v_n || ', off-rule=' || v_bad || ')');
  PERFORM pg_temp.i3313_assert(
    v_ev.recurrence_rules = v_new AND v_ev.is_recurring AND NOT v_ev.is_multi_date
    AND v_ev.theme #> '{business_event,recurrenceRule}' = v_new
    AND v_ev.theme #>> '{business_event,whenMode}' = 'recurring',
    'T-05b the stored rule, flags and organiser copy follow the saved rule');
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- T-06 — the recurring EVENT top-up.
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE f record; g record; v_date text; v_future integer; v_total integer; v_again integer;
BEGIN
  v_date := pg_temp.i3313_next_dow(2, 7, 'America/New_York');
  SELECT * INTO f FROM pg_temp.i3313_publish_recurring('t06never',
    '{"preset":"weekly","byDay":"TU","termination":{"kind":"never"}}'::jsonb,
    v_date, '19:00', '23:00', 'America/New_York');
  -- Drain it to 10 upcoming dates (as time would).
  DELETE FROM public.event_dates
   WHERE event_id = f.o_event AND id NOT IN (
     SELECT id FROM public.event_dates WHERE event_id = f.o_event ORDER BY start_at LIMIT 10);
  SELECT * INTO g FROM pg_temp.i3313_publish_recurring('t06count',
    '{"preset":"weekly","byDay":"TU","termination":{"kind":"count","count":8}}'::jsonb,
    v_date, '19:00', '23:00', 'America/New_York');
  DELETE FROM public.event_dates WHERE event_id = g.o_event AND NOT is_master;

  PERFORM public.issue_3313_topup_recurring_events(14);
  SELECT count(*) INTO v_future FROM public.event_dates WHERE event_id = f.o_event AND start_at > now();
  PERFORM pg_temp.i3313_assert(v_future = 52,
    'T-06a a never-ending event is topped back up to 52 upcoming dates (got ' || v_future || ')');
  PERFORM pg_temp.i3313_assert(
    (SELECT count(*) FROM (SELECT start_at FROM public.event_dates WHERE event_id = f.o_event
                            GROUP BY start_at HAVING count(*) > 1) d) = 0
    AND (SELECT count(*) FROM public.event_dates WHERE event_id = f.o_event
          AND EXTRACT(dow FROM (start_at AT TIME ZONE 'America/New_York'))::int <> 2) = 0,
    'T-06b no duplicate and no off-rule date was added');
  SELECT count(*) INTO v_total FROM public.event_dates WHERE event_id = f.o_event;
  PERFORM public.issue_3313_topup_recurring_events(14);
  SELECT count(*) INTO v_again FROM public.event_dates WHERE event_id = f.o_event;
  PERFORM pg_temp.i3313_assert(v_again = v_total, 'T-06c a second run adds nothing');
  PERFORM pg_temp.i3313_assert(
    (SELECT count(*) FROM public.event_dates WHERE event_id = g.o_event) = 1,
    'T-06d a count rule is left alone by the top-up');
  PERFORM pg_temp.i3313_assert(
    EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'issue-3313-topup-recurring-events'
             AND schedule = '15 9 * * *'),
    'T-06e the daily top-up job is scheduled');
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- T-07 / T-10 — the public reader.
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE r record; s record; m record; b jsonb; v_past uuid; v_night uuid;
BEGIN
  SELECT * INTO r FROM pg_temp.i3313_event('t07rec', 'recurring',
    ARRAY[now() - interval '2 days', now() + interval '2 days', now() + interval '9 days', now() + interval '16 days'], 5);
  v_past := pg_temp.i3313_nth(r.o_event, 1);
  b := public.pg_direct_event_checkout_bundle(r.o_event, NULL, NULL)::jsonb;
  PERFORM pg_temp.i3313_assert(b ->> 'isMultiDate' = 'true' AND b ->> 'isRecurring' = 'true',
    'T-07a a recurring event with 3 upcoming nights asks the guest to pick one');
  PERFORM pg_temp.i3313_assert(jsonb_array_length(b -> 'occurrences') = 3
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(b -> 'occurrences') o WHERE o ->> 'id' = v_past::text),
    'T-07b only upcoming nights are offered (a finished night is not)');
  PERFORM pg_temp.i3313_assert(b #>> '{recurrenceRule,preset}' = 'daily',
    'T-07c the stored rule rides the reader');

  -- T-10 remaining = the most any upcoming night has left (capacity 5).
  v_night := pg_temp.i3313_nth(r.o_event, 2);
  PERFORM pg_temp.i3313_buy(r.o_event, r.o_ticket_type, ARRAY[v_night], 4, 't10a');
  PERFORM pg_temp.i3313_buy(r.o_event, r.o_ticket_type, ARRAY[pg_temp.i3313_nth(r.o_event, 3)], 2, 't10b');
  b := public.pg_direct_event_checkout_bundle(r.o_event, NULL, NULL)::jsonb;
  PERFORM pg_temp.i3313_assert((b #>> '{tickets,0,remaining}')::int = 5,
    'T-10a remaining is the emptiest upcoming night (5 of 5), not 5 - 6 shared (got '
    || COALESCE(b #>> '{tickets,0,remaining}', 'null') || ')');
  PERFORM pg_temp.i3313_buy(r.o_event, r.o_ticket_type, ARRAY[pg_temp.i3313_nth(r.o_event, 4)], 5, 't10c');
  PERFORM pg_temp.i3313_buy(r.o_event, r.o_ticket_type, ARRAY[v_night], 1, 't10d');
  PERFORM pg_temp.i3313_buy(r.o_event, r.o_ticket_type, ARRAY[pg_temp.i3313_nth(r.o_event, 3)], 3, 't10e');
  b := public.pg_direct_event_checkout_bundle(r.o_event, NULL, NULL)::jsonb;
  PERFORM pg_temp.i3313_assert((b #>> '{tickets,0,remaining}')::int = 0,
    'T-10b "sold out" only once every upcoming night is full');

  SELECT * INTO s FROM pg_temp.i3313_event('t07sole', 'recurring',
    ARRAY[now() - interval '9 days', now() - interval '2 days', now() + interval '5 days']);
  b := public.pg_direct_event_checkout_bundle(s.o_event, NULL, NULL)::jsonb;
  PERFORM pg_temp.i3313_assert(b ->> 'isMultiDate' = 'false' AND jsonb_array_length(b -> 'occurrences') = 1,
    'T-07d one upcoming night: no choice, one occurrence (the native shape check holds)');

  SELECT * INTO m FROM pg_temp.i3313_event('t07multi', 'multi',
    ARRAY[now() - interval '2 days', now() + interval '2 days']);
  b := public.pg_direct_event_checkout_bundle(m.o_event, NULL, NULL)::jsonb;
  PERFORM pg_temp.i3313_assert(b ->> 'isMultiDate' = 'true' AND jsonb_array_length(b -> 'occurrences') = 2
    AND b -> 'recurrenceRule' = 'null'::jsonb,
    'T-07e a multi-date event is unchanged: still multi-date, every day listed, no rule');
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- T-08 — no order without a night.
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE r record; m record; s record; one record; v_err text; v_order uuid; v_sole uuid; v_n integer;
BEGIN
  SELECT * INTO r FROM pg_temp.i3313_event('t08rec', 'recurring',
    ARRAY[now() + interval '2 days', now() + interval '9 days']);
  v_err := pg_temp.i3313_session_err(r.o_event, r.o_ticket_type, NULL, 1, 't08a');
  PERFORM pg_temp.i3313_assert(v_err LIKE '%event_date_choice_required%',
    'T-08a a recurring event with 2 upcoming nights refuses a checkout with no night (got '
    || COALESCE(v_err, 'SUCCESS') || ')');

  SELECT * INTO m FROM pg_temp.i3313_event('t08multi', 'multi',
    ARRAY[now() + interval '2 days', now() + interval '3 days']);
  v_err := pg_temp.i3313_session_err(m.o_event, m.o_ticket_type, NULL, 1, 't08b');
  PERFORM pg_temp.i3313_assert(v_err LIKE '%event_date_choice_required%',
    'T-08b a multi-date event refuses a checkout with no day (got ' || COALESCE(v_err, 'SUCCESS') || ')');

  SELECT * INTO one FROM pg_temp.i3313_event('t08sole', 'recurring',
    ARRAY[now() - interval '9 days', now() + interval '5 days']);
  v_sole := pg_temp.i3313_nth(one.o_event, 2);
  v_order := pg_temp.i3313_buy(one.o_event, one.o_ticket_type, NULL, 1, 't08c');
  SELECT count(*) INTO v_n FROM public.ticket_event_dates ted JOIN public.tickets t ON t.id = ted.ticket_id
   WHERE t.order_id = v_order AND ted.event_date_id = v_sole;
  PERFORM pg_temp.i3313_assert(v_n = 1,
    'T-08c with one upcoming night and none chosen, the pass is tied to that night');

  SELECT * INTO s FROM pg_temp.i3313_event('t08single', 'single', ARRAY[now() + interval '3 days']);
  v_order := pg_temp.i3313_buy(s.o_event, s.o_ticket_type, NULL, 1, 't08d');
  SELECT count(*) INTO v_n FROM public.ticket_event_dates ted JOIN public.tickets t ON t.id = ted.ticket_id
   WHERE t.order_id = v_order;
  PERFORM pg_temp.i3313_assert(v_order IS NOT NULL AND v_n = 0,
    'T-08d a single-date checkout is unchanged (no day required, none written)');
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- T-09 — capacity is PER NIGHT.
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE r record; a record; s record; v_a uuid; v_b uuid; v_err text;
BEGIN
  SELECT * INTO r FROM pg_temp.i3313_event('t09', 'recurring',
    ARRAY[now() + interval '2 days', now() + interval '9 days'], 2);
  v_a := pg_temp.i3313_nth(r.o_event, 1);
  v_b := pg_temp.i3313_nth(r.o_event, 2);

  PERFORM pg_temp.i3313_buy(r.o_event, r.o_ticket_type, ARRAY[v_a], 2, 't09a');
  v_err := pg_temp.i3313_session_err(r.o_event, r.o_ticket_type, ARRAY[v_b], 2, 't09b');
  PERFORM pg_temp.i3313_assert(v_err IS NULL,
    'T-09a night A sold out does not stop night B selling its own 2 (got ' || COALESCE(v_err, 'ok') || ')');
  -- That session is a HOLD on night B (not finalized).
  v_err := pg_temp.i3313_session_err(r.o_event, r.o_ticket_type, ARRAY[v_b], 1, 't09c');
  PERFORM pg_temp.i3313_assert(v_err LIKE '%ticket_capacity_exceeded%',
    'T-09b an in-flight hold counts against its own night (got ' || COALESCE(v_err, 'SUCCESS') || ')');
  v_err := pg_temp.i3313_session_err(r.o_event, r.o_ticket_type, ARRAY[v_a], 1, 't09d');
  PERFORM pg_temp.i3313_assert(v_err LIKE '%ticket_capacity_exceeded%',
    'T-09c a third seat on the sold-out night is refused (got ' || COALESCE(v_err, 'SUCCESS') || ')');
  v_err := pg_temp.i3313_session_err(r.o_event, r.o_ticket_type, ARRAY[v_a, v_b], 1, 't09e');
  PERFORM pg_temp.i3313_assert(v_err LIKE '%ticket_capacity_exceeded%',
    'T-09d a two-night cart is refused when either night is full');

  -- all_days: one pass for two nights uses one place on EACH night.
  SELECT * INTO a FROM pg_temp.i3313_event('t09all', 'recurring',
    ARRAY[now() + interval '2 days', now() + interval '9 days'], 1, 'all_days');
  PERFORM pg_temp.i3313_buy(a.o_event, a.o_ticket_type,
    ARRAY[pg_temp.i3313_nth(a.o_event, 1), pg_temp.i3313_nth(a.o_event, 2)], 1, 't09f');
  v_err := pg_temp.i3313_session_err(a.o_event, a.o_ticket_type, ARRAY[pg_temp.i3313_nth(a.o_event, 2)], 1, 't09g');
  PERFORM pg_temp.i3313_assert(v_err LIKE '%ticket_capacity_exceeded%',
    'T-09e all_days: a two-night pass fills capacity 1 on both nights');

  -- A shared-capacity event is unchanged: 2 total across the run.
  SELECT * INTO s FROM pg_temp.i3313_event('t09multi', 'multi',
    ARRAY[now() + interval '2 days', now() + interval '9 days'], 2);
  PERFORM pg_temp.i3313_buy(s.o_event, s.o_ticket_type, ARRAY[pg_temp.i3313_nth(s.o_event, 1)], 2, 't09h');
  v_err := pg_temp.i3313_session_err(s.o_event, s.o_ticket_type, ARRAY[pg_temp.i3313_nth(s.o_event, 2)], 1, 't09i');
  PERFORM pg_temp.i3313_assert(v_err LIKE '%ticket_capacity_exceeded%',
    'T-09f a multi-date event keeps one shared capacity');
END $$;

-- T-09g/h — the FINALIZE-time re-check is per night too.
DO $$
DECLARE r record; v_a uuid; v_b uuid; v_s jsonb; v_id uuid; v_tt uuid; v_order uuid;
BEGIN
  SELECT * INTO r FROM pg_temp.i3313_event('t09fin', 'recurring',
    ARRAY[now() + interval '2 days', now() + interval '9 days'], 1);
  v_a := pg_temp.i3313_nth(r.o_event, 1);
  v_b := pg_temp.i3313_nth(r.o_event, 2);
  PERFORM pg_temp.i3313_buy(r.o_event, r.o_ticket_type, ARRAY[v_a], 1, 't09fin-a');
  v_s := pg_temp.i3313_session(r.o_event, r.o_ticket_type, ARRAY[v_b], 1, 't09fin-b');
  v_id := (v_s ->> 'checkoutSessionId')::uuid;
  PERFORM pg_temp.i3313_assert(public.issue_1930_ticket_session_authorized(v_id, r.o_event),
    'T-09g night B is authorised at finalize although night A (same capacity 1) is sold out');
  -- Another channel issues night B's only place before this session finalizes.
  INSERT INTO public.orders(id, event_id, buyer_email, buyer_name, buyer_phone_e164, total_cents,
                            currency, payment_method, payment_status, source, event_date_id)
    VALUES (gen_random_uuid(), r.o_event, 'other@example.test', 'Other', '+15550003314', 0,
            NULL, 'free', 'paid', 'online_checkout', v_b)
    RETURNING id INTO v_order;
  INSERT INTO public.tickets(id, order_id, ticket_type_id, event_id, qr_code, qr_token_hash, status, approval_status)
    VALUES (gen_random_uuid(), v_order, r.o_ticket_type, r.o_event, 'mingla:v1:ticket:' || gen_random_uuid()::text,
            md5(gen_random_uuid()::text), 'valid', 'auto')
    RETURNING id INTO v_tt;
  INSERT INTO public.ticket_event_dates(ticket_id, event_date_id) VALUES (v_tt, v_b);
  PERFORM pg_temp.i3313_assert(NOT public.issue_1930_ticket_session_authorized(v_id, r.o_event),
    'T-09h ...and refused at finalize once night B is full');
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- T-11 — the tier editor's capacity floor.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION pg_temp.i3313_tier_err(p_event uuid, p_owner uuid, p_tt uuid, p_capacity integer)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_err text;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claim.sub', p_owner::text, true);
    PERFORM public.business_patch_event_ticket_tiers(
      p_event,
      jsonb_build_array(jsonb_build_object(
        'id', p_tt, 'name', 'Entry', 'isFree', true, 'isUnlimited', false, 'priceGbp', 0,
        'capacity', p_capacity, 'visibility', 'public', 'displayOrder', 0,
        'approvalRequired', false, 'passwordProtected', false, 'passwordConfigured', false,
        'waitlistEnabled', false, 'minPurchaseQty', 1, 'maxPurchaseQty', NULL,
        'allowTransfers', true, 'description', NULL, 'saleStartAt', NULL, 'saleEndAt', NULL,
        'availableAt', 'both')),
      NULL, NULL, NULL, 'issue 3313 capacity floor');
    v_err := NULL;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN v_err;
END $$;

DO $$
DECLARE r record; m record; v_err text;
BEGIN
  SELECT * INTO r FROM pg_temp.i3313_event('t11rec', 'recurring',
    ARRAY[now() + interval '2 days', now() + interval '9 days'], 3);
  PERFORM pg_temp.i3313_buy(r.o_event, r.o_ticket_type, ARRAY[pg_temp.i3313_nth(r.o_event, 1)], 2, 't11a');
  PERFORM pg_temp.i3313_buy(r.o_event, r.o_ticket_type, ARRAY[pg_temp.i3313_nth(r.o_event, 2)], 1, 't11b');
  v_err := pg_temp.i3313_tier_err(r.o_event, r.o_owner, r.o_ticket_type, 2);
  PERFORM pg_temp.i3313_assert(v_err IS NULL,
    'T-11a recurring: capacity may drop to the busiest night (2), not the run total (3) (got '
    || COALESCE(v_err, 'ok') || ')');
  v_err := pg_temp.i3313_tier_err(r.o_event, r.o_owner, r.o_ticket_type, 1);
  PERFORM pg_temp.i3313_assert(v_err LIKE '%sold_ticket_mutation_blocked%',
    'T-11b recurring: below the busiest night is refused');

  SELECT * INTO m FROM pg_temp.i3313_event('t11multi', 'multi',
    ARRAY[now() + interval '2 days', now() + interval '9 days'], 3);
  PERFORM pg_temp.i3313_buy(m.o_event, m.o_ticket_type, ARRAY[pg_temp.i3313_nth(m.o_event, 1)], 2, 't11c');
  PERFORM pg_temp.i3313_buy(m.o_event, m.o_ticket_type, ARRAY[pg_temp.i3313_nth(m.o_event, 2)], 1, 't11d');
  v_err := pg_temp.i3313_tier_err(m.o_event, m.o_owner, m.o_ticket_type, 2);
  PERFORM pg_temp.i3313_assert(v_err LIKE '%sold_ticket_mutation_blocked%',
    'T-11c multi-date: the floor is still every ticket issued (3)');
END $$;

ROLLBACK;
