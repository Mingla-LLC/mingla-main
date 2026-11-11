\set ON_ERROR_STOP on

-- Issue #3281 bundle 6 — a date that something holds is never deleted, and a
-- cancelled date never reaches Discover.
-- Migrations 20280625003281_issue_3281_dates_never_orphan.sql and
-- 20280625013281_issue_3281_validate_scan_date_fk.sql. Run after the
-- full migration chain on PostgreSQL 17. Everything rolls back.
--
-- MINGLA-INVARIANT: I-3281-HELD-DATE-NEVER-DELETED | issue #3281 | Experience re-publish and a live RSVP edit never delete an event_dates row that issue_3281_event_date_deletable says is held (a live order, a pass of any status, a check-in or a payout release): they lock the dates and refuse with experience_dates_have_sales or multi_date_remove_with_sales; scan_events.event_date_id is ON DELETE RESTRICT.
-- MINGLA-INVARIANT: I-3281-CANCELLED-DATE-NOT-LISTED | issue #3281 | issue_3281_explorer_date_listable_rows never lists a cancelled date, whether or not the event sells tickets online.
--
-- Red before green: on main, X1, X2, X4, R1, F1 and D1 fail.

BEGIN;

INSERT INTO auth.users(id) VALUES ('32816b00-0000-4000-8000-000000000001');
INSERT INTO public.creator_accounts(id) VALUES ('32816b00-0000-4000-8000-000000000001');

CREATE FUNCTION pg_temp.b6_assert(p_ok boolean, p_label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', p_label; END IF;
END $$;

CREATE FUNCTION pg_temp.as_host() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '32816b00-0000-4000-8000-000000000001', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', '32816b00-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
END $$;

CREATE FUNCTION pg_temp.brand(p_id uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.brands(id, account_id, name, slug, default_currency, payment_provider,
    payment_country, paystack_subaccount_code)
  VALUES (p_id, '32816b00-0000-4000-8000-000000000001', 'B6 ' || p_id, 'b6-' || p_id,
    'NGN', 'paystack', 'NG', 'ACCT_b6_' || right(p_id::text, 4));
  UPDATE public.brand_team_members
     SET mingla_tos_version_accepted = '1.0', mingla_tos_accepted_at = now()
   WHERE brand_id = p_id AND user_id = '32816b00-0000-4000-8000-000000000001';
END $$;

CREATE FUNCTION pg_temp.exp_payload() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'title', 'B6 experience', 'description', 'A walk through two good places.',
    'currency', 'NGN', 'is_free', false, 'pricing_mode', 'whole',
    'whole_price_cents', 250000, 'experience_intents', jsonb_build_array('group-fun'),
    'timezone', 'UTC', 'whenMode', 'single',
    'when', jsonb_build_object('date', to_char(now() + interval '10 days', 'YYYY-MM-DD'),
      'doorsOpen', '18:00', 'endsAt', '20:00'),
    'stops', jsonb_build_array(
      jsonb_build_object('place_name', 'First', 'ai_description', 'The first stop',
        'address', '1 First St', 'place_id', 'b6-place-1', 'lat', 6.5, 'lng', 3.4, 'stop_order', 0),
      jsonb_build_object('place_name', 'Second', 'ai_description', 'The second stop',
        'address', '2 Second St', 'place_id', 'b6-place-2', 'lat', 6.6, 'lng', 3.5, 'stop_order', 1)))
$$;

-- A published experience: (event, its date).
CREATE FUNCTION pg_temp.live_experience(p_brand uuid, OUT o_event uuid, OUT o_date uuid)
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.brand(p_brand);
  PERFORM pg_temp.as_host();
  o_event := (public.biz_create_experience(p_brand, pg_temp.exp_payload(), false)->'event'->>'id')::uuid;
  PERFORM public.biz_publish_experience(o_event, pg_temp.exp_payload(), true);
  SELECT id INTO o_date FROM public.event_dates WHERE event_id = o_event AND is_master;
END $$;

-- An order on a date (no ticket rows), in the given payment status.
CREATE FUNCTION pg_temp.order_on(p_event uuid, p_date uuid, p_status text) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE v_order uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.orders(id, event_id, event_date_id, buyer_email, buyer_name, buyer_phone_e164,
    total_cents, payment_method, payment_status, source, currency)
  VALUES (v_order, p_event, p_date, 'b6-' || v_order || '@example.test', 'Guest', '+15550003281',
    250000, 'online_card', p_status, 'online_checkout', 'NGN');
  RETURN v_order;
END $$;

-- The refusal a call raises, or NULL.
CREATE FUNCTION pg_temp.err_of(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM || ' [' || SQLSTATE || ']';
END $$;

-- ─── X1  re-publishing a live experience never deletes a date with a live order
DO $x1$
DECLARE f record; v_order uuid; v_err text;
BEGIN
  SELECT * INTO f FROM pg_temp.live_experience('32816b00-0000-4000-8000-0000000000b1');
  PERFORM pg_temp.b6_assert(f.o_date IS NOT NULL, 'X1 fixture: the experience has a date');
  v_order := pg_temp.order_on(f.o_event, f.o_date, 'paid');
  PERFORM pg_temp.as_host();
  v_err := pg_temp.err_of(format(
    'SELECT public.biz_publish_experience(%L::uuid, pg_temp.exp_payload(), true)', f.o_event));
  PERFORM pg_temp.b6_assert(v_err LIKE 'experience_dates_have_sales%',
    'X1: re-publish with a paid order is refused, got ' || coalesce(v_err, 'success'));
  PERFORM pg_temp.b6_assert(
    (SELECT event_date_id FROM public.orders WHERE id = v_order) = f.o_date
    AND EXISTS (SELECT 1 FROM public.event_dates WHERE id = f.o_date),
    'X1: the order keeps its date and the date stays');
END $x1$;

-- ─── X2  a check-in also holds the date ──────────────────────────────────────
DO $x2$
DECLARE f record; v_order uuid; v_tier uuid; v_ticket uuid := gen_random_uuid(); v_err text;
BEGIN
  SELECT * INTO f FROM pg_temp.live_experience('32816b00-0000-4000-8000-0000000000b2');
  -- A refunded order (no hold of its own) with a ticket checked in at the door.
  v_order := pg_temp.order_on(f.o_event, f.o_date, 'refunded');
  SELECT id INTO v_tier FROM public.ticket_types WHERE event_id = f.o_event AND deleted_at IS NULL LIMIT 1;
  INSERT INTO public.tickets(id, order_id, ticket_type_id, event_id, qr_code, qr_token_hash, status, approval_status)
  VALUES (v_ticket, v_order, v_tier, f.o_event, 'mingla:v1:ticket:' || v_ticket, md5(v_ticket::text), 'used', 'auto');
  INSERT INTO public.scan_events(ticket_id, event_id, scanner_user_id, scan_result, client_offline, event_date_id)
  VALUES (v_ticket, f.o_event, '32816b00-0000-4000-8000-000000000001', 'success', false, f.o_date);
  PERFORM pg_temp.as_host();
  v_err := pg_temp.err_of(format(
    'SELECT public.biz_publish_experience(%L::uuid, pg_temp.exp_payload(), true)', f.o_event));
  PERFORM pg_temp.b6_assert(v_err LIKE 'experience_dates_have_sales%',
    'X2: re-publish over a check-in is refused, got ' || coalesce(v_err, 'success'));
  PERFORM pg_temp.b6_assert(
    (SELECT event_date_id FROM public.scan_events WHERE ticket_id = v_ticket) = f.o_date,
    'X2: the check-in keeps its date');
END $x2$;

-- ─── X3  an unbooked re-publish, and one whose orders all ended, still work ──
DO $x3$
DECLARE f record; g record; v_order uuid; v_err text;
BEGIN
  SELECT * INTO f FROM pg_temp.live_experience('32816b00-0000-4000-8000-0000000000b3');
  PERFORM pg_temp.as_host();
  v_err := pg_temp.err_of(format(
    'SELECT public.biz_publish_experience(%L::uuid, pg_temp.exp_payload(), true)', f.o_event));
  PERFORM pg_temp.b6_assert(v_err IS NULL, 'X3: an unbooked re-publish works, got ' || coalesce(v_err, ''));
  PERFORM pg_temp.b6_assert(
    (SELECT count(*) FROM public.event_dates WHERE event_id = f.o_event AND is_master) = 1,
    'X3: one master date after re-publish');
  -- Orders that all ended (refunded, failed, cancelled) do not hold a date:
  -- they may let go of it (orders.event_date_id stays ON DELETE SET NULL).
  SELECT * INTO g FROM pg_temp.live_experience('32816b00-0000-4000-8000-0000000000b4');
  v_order := pg_temp.order_on(g.o_event, g.o_date, 'refunded');
  PERFORM pg_temp.order_on(g.o_event, g.o_date, 'failed');
  PERFORM pg_temp.as_host();
  v_err := pg_temp.err_of(format(
    'SELECT public.biz_publish_experience(%L::uuid, pg_temp.exp_payload(), true)', g.o_event));
  PERFORM pg_temp.b6_assert(v_err IS NULL,
    'X3: ended orders never turn into a raw foreign-key error, got ' || coalesce(v_err, ''));
  PERFORM pg_temp.b6_assert(
    (SELECT event_date_id FROM public.orders WHERE id = v_order) IS NULL
    AND (SELECT count(*) FROM public.event_dates WHERE event_id = g.o_event AND is_master) = 1
    AND NOT EXISTS (SELECT 1 FROM public.event_dates WHERE id = g.o_date),
    'X3: the ended order let go of the rebuilt date, and one new master date exists');
END $x3$;

-- ─── X4  a pass of any status holds the date (the helper's own arm) ─────────
DO $x4$
DECLARE f record; v_order uuid; v_tier uuid; v_ticket uuid := gen_random_uuid(); v_err text;
BEGIN
  SELECT * INTO f FROM pg_temp.live_experience('32816b00-0000-4000-8000-0000000000b7');
  v_order := pg_temp.order_on(f.o_event, f.o_date, 'refunded');
  SELECT id INTO v_tier FROM public.ticket_types WHERE event_id = f.o_event AND deleted_at IS NULL LIMIT 1;
  INSERT INTO public.tickets(id, order_id, ticket_type_id, event_id, qr_code, qr_token_hash, status, approval_status)
  VALUES (v_ticket, v_order, v_tier, f.o_event, 'mingla:v1:ticket:' || v_ticket, md5(v_ticket::text), 'refunded', 'auto');
  INSERT INTO public.ticket_event_dates(ticket_id, event_date_id) VALUES (v_ticket, f.o_date);
  PERFORM pg_temp.b6_assert(public.issue_3285_event_date_hold_reason(f.o_date) IS NULL,
    'X4 fixture: the hold rule alone would let this date go');
  PERFORM pg_temp.as_host();
  v_err := pg_temp.err_of(format(
    'SELECT public.biz_publish_experience(%L::uuid, pg_temp.exp_payload(), true)', f.o_event));
  PERFORM pg_temp.b6_assert(v_err LIKE 'experience_dates_have_sales%',
    'X4: a refunded pass still blocks the rebuild (never a raw foreign-key error), got ' || coalesce(v_err, 'success'));
END $x4$;

-- ─── R1  a live RSVP edit keeps an extra date row that something holds ──────
DO $r1$
DECLARE
  v_user uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_master uuid; v_held uuid; v_free uuid; v_order uuid; v_err text;
BEGIN
  INSERT INTO auth.users(id, email) VALUES (v_user, 'b6-rsvp-' || v_user || '@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (v_user);
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
    VALUES (v_brand, v_user, 'B6 RSVP', 'b6-rsvp-' || v_brand, 'USD');
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone, currency, published_at)
  VALUES (v_event, v_brand, v_user, 'B6 RSVP', 'b6-rsvp-' || v_event, 'rsvp', 'scheduled', 'public', 'UTC', 'USD', now());
  -- The kept row, plus two legacy extra rows: one with a live order, one free.
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
    VALUES (v_event, now() + interval '20 days', now() + interval '20 days 3 hours', 'UTC', true)
    RETURNING id INTO v_master;
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
    VALUES (v_event, now() + interval '21 days', now() + interval '21 days 3 hours', 'UTC', false)
    RETURNING id INTO v_held;
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
    VALUES (v_event, now() + interval '22 days', now() + interval '22 days 3 hours', 'UTC', false)
    RETURNING id INTO v_free;
  INSERT INTO public.orders(id, event_id, event_date_id, buyer_email, buyer_name, buyer_phone_e164,
    total_cents, payment_method, payment_status, source)
  VALUES (gen_random_uuid(), v_event, v_held, 'b6-rsvp-order@example.test', 'Guest', '+15550003281', 0,
    'free', 'paid', 'online_checkout')
  RETURNING id INTO v_order;
  v_err := pg_temp.err_of(format($q$SELECT public.biz_update_live_rsvp(%L::uuid, jsonb_build_object('title', 'B6 RSVP',
    'when', jsonb_build_object('date', %L, 'doorsOpen', '18:00', 'endsAt', '22:00')), 'Moving the date')$q$,
    v_event, to_char((now() + interval '25 days')::date, 'YYYY-MM-DD')));
  PERFORM pg_temp.b6_assert(v_err LIKE 'multi_date_remove_with_sales%',
    'R1: an edit that would drop a held extra row is refused, got ' || coalesce(v_err, 'success'));
  PERFORM pg_temp.b6_assert(EXISTS (SELECT 1 FROM public.event_dates WHERE id = v_held)
    AND EXISTS (SELECT 1 FROM public.event_dates WHERE id = v_free)
    AND (SELECT event_date_id FROM public.orders WHERE id = v_order) = v_held
    AND (SELECT start_at FROM public.event_dates WHERE id = v_master) < now() + interval '21 days',
    'R1: nothing changed: rows, the order''s date and the master''s time');
  -- With nothing held any more, the edit goes through and the extra rows go.
  UPDATE public.orders SET payment_status = 'refunded' WHERE id = v_order;
  PERFORM public.biz_update_live_rsvp(v_event, jsonb_build_object('title', 'B6 RSVP',
    'when', jsonb_build_object('date', to_char((now() + interval '25 days')::date, 'YYYY-MM-DD'),
      'doorsOpen', '18:00', 'endsAt', '22:00')), 'Moving the date');
  PERFORM pg_temp.b6_assert(NOT EXISTS (SELECT 1 FROM public.event_dates WHERE id = v_free)
    AND NOT EXISTS (SELECT 1 FROM public.event_dates WHERE id = v_held)
    AND EXISTS (SELECT 1 FROM public.event_dates WHERE id = v_master),
    'R1: with nothing held, the extra rows go and the kept row stays');
END $r1$;

-- ─── F1  the database backstop: check-ins refuse, ended orders let go ───────
DO $f1$
DECLARE f record; v_order uuid; v_err text; v_ticket uuid := gen_random_uuid(); v_tier uuid; v_bare uuid;
BEGIN
  PERFORM pg_temp.b6_assert(
    (SELECT confdeltype FROM pg_constraint WHERE conname = 'scan_events_event_date_id_fkey') = 'r'
    AND (SELECT convalidated FROM pg_constraint WHERE conname = 'scan_events_event_date_id_fkey')
    AND (SELECT confdeltype FROM pg_constraint WHERE conname = 'orders_event_date_id_fkey') = 'n',
    'F1: scan_events refuses (RESTRICT), orders let go (SET NULL)');
  SELECT * INTO f FROM pg_temp.live_experience('32816b00-0000-4000-8000-0000000000b5');
  v_order := pg_temp.order_on(f.o_event, f.o_date, 'refunded');
  SELECT id INTO v_tier FROM public.ticket_types WHERE event_id = f.o_event AND deleted_at IS NULL LIMIT 1;
  INSERT INTO public.tickets(id, order_id, ticket_type_id, event_id, qr_code, qr_token_hash, status, approval_status)
  VALUES (v_ticket, v_order, v_tier, f.o_event, 'mingla:v1:ticket:' || v_ticket, md5(v_ticket::text), 'used', 'auto');
  INSERT INTO public.scan_events(ticket_id, event_id, scanner_user_id, scan_result, client_offline, event_date_id)
  VALUES (v_ticket, f.o_event, '32816b00-0000-4000-8000-000000000001', 'success', false, f.o_date);
  RESET ROLE;
  v_err := pg_temp.err_of(format('DELETE FROM public.event_dates WHERE id = %L', f.o_date));
  PERFORM pg_temp.b6_assert(v_err LIKE '%scan_events_event_date_id_fkey%[23503]',
    'F1: a date with a check-in cannot be deleted, got ' || coalesce(v_err, 'deleted'));
  PERFORM pg_temp.b6_assert(NOT public.issue_3281_event_date_deletable(f.o_date),
    'F1: the helper says a checked-in date is held');
  -- A date with only an ended order deletes, and the order lets go of it.
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
    VALUES (f.o_event, now() + interval '40 days', now() + interval '40 days 2 hours', 'UTC', false)
    RETURNING id INTO v_bare;
  v_order := pg_temp.order_on(f.o_event, v_bare, 'failed');
  PERFORM pg_temp.b6_assert(public.issue_3281_event_date_deletable(v_bare),
    'F1: a date with only a failed order is deletable');
  DELETE FROM public.event_dates WHERE id = v_bare;
  PERFORM pg_temp.b6_assert((SELECT event_date_id FROM public.orders WHERE id = v_order) IS NULL,
    'F1: the failed order let go of its date');
  -- A pass of any status holds the date (ticket_event_dates refuses too).
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
    VALUES (f.o_event, now() + interval '41 days', now() + interval '41 days 2 hours', 'UTC', false)
    RETURNING id INTO v_bare;
  UPDATE public.tickets SET status = 'refunded' WHERE id = v_ticket;
  INSERT INTO public.ticket_event_dates(ticket_id, event_date_id) VALUES (v_ticket, v_bare);
  PERFORM pg_temp.b6_assert(NOT public.issue_3281_event_date_deletable(v_bare),
    'F1: a refunded pass still holds its date for the helper');
  PERFORM pg_temp.b6_assert(
    NOT has_function_privilege('authenticated', 'public.issue_3281_event_date_deletable(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.issue_3281_event_date_deletable(uuid)', 'EXECUTE'),
    'F1: the helper is not callable by app users');
END $f1$;

-- ─── D1  Discover never lists a cancelled date, tickets or not ──────────────
DO $d1$
DECLARE v_brand uuid := '32816b00-0000-4000-8000-0000000000b6'; v_event uuid := gen_random_uuid();
  v_open uuid; v_gone uuid;
BEGIN
  PERFORM pg_temp.brand(v_brand);
  -- A free public event with no ticket on sale online.
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone, published_at)
  VALUES (v_event, v_brand, '32816b00-0000-4000-8000-000000000001', 'B6 free night',
    'b6-free-' || v_event, 'event', 'scheduled', 'public', 'UTC', now());
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
    VALUES (v_event, now() + interval '5 days', now() + interval '5 days 3 hours', 'UTC', true)
    RETURNING id INTO v_gone;
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
    VALUES (v_event, now() + interval '6 days', now() + interval '6 days 3 hours', 'UTC', false)
    RETURNING id INTO v_open;
  UPDATE public.event_dates SET status = 'cancelled', cancelled_at = now() WHERE id = v_gone;
  PERFORM pg_temp.b6_assert(
    NOT EXISTS (SELECT 1 FROM public.issue_3281_explorer_listable_dates(v_event) WHERE event_date_id = v_gone)
    AND EXISTS (SELECT 1 FROM public.issue_3281_explorer_listable_dates(v_event) WHERE event_date_id = v_open),
    'D1: a ticketless event is listed on its open date, never on its cancelled one');
  UPDATE public.event_dates SET status = 'cancelled', cancelled_at = now() WHERE id = v_open;
  PERFORM pg_temp.b6_assert(
    NOT EXISTS (SELECT 1 FROM public.issue_3281_explorer_listable_dates(v_event)),
    'D1: an event whose dates are all cancelled is not listed');
END $d1$;


-- ─── P1  a payout release alone holds the date ──────────────────────────────
DO $p1$
DECLARE f record; v_err text;
BEGIN
  SELECT * INTO f FROM pg_temp.live_experience('32816b00-0000-4000-8000-0000000000b8');
  INSERT INTO public.brand_payout_releases(brand_id, event_id, event_date_id, occurrence_key,
    surface, provider, currency, anchor_end_at, releasable_at, gross_cents, net_release_cents)
  SELECT e.brand_id, e.id, d.id, coalesce(d.occurrence_key, 'b6-' || d.id), 'order', 'paystack', 'ngn',
    d.end_at, d.end_at + interval '1 day', 1000, 900
    FROM public.events e JOIN public.event_dates d ON d.event_id = e.id
   WHERE d.id = f.o_date;
  PERFORM pg_temp.b6_assert(NOT public.issue_3281_event_date_deletable(f.o_date),
    'P1: a payout release holds its date for the helper');
  PERFORM pg_temp.as_host();
  v_err := pg_temp.err_of(format(
    'SELECT public.biz_publish_experience(%L::uuid, pg_temp.exp_payload(), true)', f.o_event));
  PERFORM pg_temp.b6_assert(v_err LIKE 'experience_dates_have_sales%',
    'P1: a payout release blocks the rebuild, got ' || coalesce(v_err, 'success'));
END $p1$;

-- ─── D2  Discover itself drops an event whose dates are all cancelled ───────
DO $d2$
DECLARE v_brand uuid := '32816b00-0000-4000-8000-0000000000b9';
  v_gone uuid := gen_random_uuid(); v_rsvp uuid := gen_random_uuid(); v_ctrl uuid := gen_random_uuid();
  v_first uuid; v_second timestamptz; v_ids uuid[]; v_items jsonb; v_e uuid; v_when interval;
BEGIN
  PERFORM pg_temp.brand(v_brand);
  FOREACH v_e IN ARRAY ARRAY[v_gone, v_rsvp, v_ctrl] LOOP
    INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility,
      timezone, published_at, city, rsvp_discoverable)
    VALUES (v_e, v_brand, '32816b00-0000-4000-8000-000000000001', 'B6 probe ' || v_e,
      'b6-probe-' || v_e, CASE WHEN v_e = v_rsvp THEN 'rsvp' ELSE 'event' END,
      'scheduled', 'public', 'UTC', now(), 'B6City', v_e = v_rsvp);
    FOREACH v_when IN ARRAY ARRAY[interval '3 days', interval '4 days'] LOOP
      INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
      VALUES (v_e, now() + v_when, now() + v_when + interval '3 hours', 'UTC', v_when = interval '3 days');
    END LOOP;
  END LOOP;
  UPDATE public.event_dates SET status = 'cancelled', cancelled_at = now()
   WHERE event_id IN (v_gone, v_rsvp);
  SELECT id INTO v_first FROM public.event_dates WHERE event_id = v_ctrl ORDER BY start_at LIMIT 1;
  UPDATE public.event_dates SET status = 'cancelled', cancelled_at = now() WHERE id = v_first;
  SELECT start_at INTO v_second FROM public.event_dates WHERE event_id = v_ctrl ORDER BY start_at DESC LIMIT 1;
  SELECT array_agg(coalesce(b->>'event_id', b->>'id')::uuid) INTO v_ids
    FROM public.discover_v2_event_base(ARRAY['B6City'], now(), NULL, NULL, NULL, NULL, NULL, NULL, NULL) b;
  PERFORM pg_temp.b6_assert(NOT (v_gone = ANY (coalesce(v_ids, '{}'))) AND NOT (v_rsvp = ANY (coalesce(v_ids, '{}'))),
    'D2: Discover drops a ticketless event and a discoverable RSVP whose dates are all cancelled');
  PERFORM pg_temp.b6_assert(v_ctrl = ANY (coalesce(v_ids, '{}')),
    'D2: Discover still shows the control on its open date');
END $d2$;

-- ─── T1  a door tap that succeeds after its date is cancelled is recorded ───
DO $t1$
DECLARE
  v_owner uuid := gen_random_uuid(); v_brand uuid := gen_random_uuid(); v_event uuid := gen_random_uuid();
  v_date uuid := gen_random_uuid(); v_tier uuid := gen_random_uuid(); v_result jsonb; v_order uuid;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_owner, 'b6-door-' || v_owner || '@example.test');
  INSERT INTO public.creator_accounts (id, email, display_name) VALUES (v_owner, 'b6-door-' || v_owner || '@example.test', 'Door Host');
  INSERT INTO public.brands (id, account_id, name, slug, default_currency, pricing_currency,
    payment_provider, payout_hold_cutover_at)
  VALUES (v_brand, v_owner, 'B6 door', 'b6-door-' || v_brand, 'USD', 'USD', 'stripe', now() - interval '1 day');
  INSERT INTO public.events (id, brand_id, title, slug, event_type, status, visibility, timezone, currency)
  VALUES (v_event, v_brand, 'B6 door night', 'b6-door-' || v_event, 'event', 'live', 'public', 'UTC', 'USD');
  INSERT INTO public.event_dates (id, event_id, start_at, end_at, timezone, is_master, occurrence_key)
  VALUES (v_date, v_event, now() - interval '1 hour', now() + interval '3 hours', 'UTC', true, 'one');
  INSERT INTO public.ticket_types (id, event_id, name, price_cents, currency, quantity_total, is_unlimited,
    available_online, available_in_person, is_disabled, is_hidden)
  VALUES (v_tier, v_event, 'Door entry', 2000, 'USD', 10, false, false, true, false, false);
  INSERT INTO public.door_tap_intents (id, brand_id, event_id, event_date_id, client_request_id, lines,
    currency, subtotal_cents, fee_cents, total_cents, application_fee_cents, stripe_account_id,
    stripe_payment_intent_id, created_by, buyer_phone_e164)
  VALUES (gen_random_uuid(), v_brand, v_event, v_date, gen_random_uuid(),
    jsonb_build_array(jsonb_build_object('ticketTypeId', v_tier, 'quantity', 1, 'unitCents', 2000, 'name', 'Door entry')),
    'USD', 2000, 90, 2090, 90, 'acct_b6door', 'pi_b6door', v_owner, '+12025550123');
  -- The host cancels the date while the guest's card is being tapped.
  UPDATE public.event_dates SET status = 'cancelled', cancelled_at = now() WHERE id = v_date;
  v_result := public.biz_door_tap_record('pi_b6door', 'ch_b6door', 2090, 'visa', '4242');
  v_order := (v_result->>'orderId')::uuid;
  PERFORM pg_temp.b6_assert(v_order IS NOT NULL
    AND (SELECT event_date_id FROM public.orders WHERE id = v_order) = v_date,
    'T1: the money was taken in person, so the sale is recorded on its date');
  PERFORM pg_temp.b6_assert(NOT public.issue_3281_event_date_deletable(v_date),
    'T1: the recorded door sale holds the cancelled date');
END $t1$;

SELECT 'issue_3281_dates_never_orphan: all tests passed' AS result;

ROLLBACK;
