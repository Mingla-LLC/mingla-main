-- issue #2150 — IMPLEMENTOR HAPPY-PATH regression suite. EXECUTED, not simulated.
--
-- WHAT WAS BROKEN (measured by the #2136 tester on real PostgreSQL 17):
--   `biz_ticket_checkout_create_session` tombstones any session whose status is
--   terminal, and `free_completed` IS terminal. `ticket-checkout-create` derives
--   the idempotency key deterministically from (eventId, buyerEmail,
--   buyerPhoneE164, lines, paymentPlanChoice), so an identical resubmit from the
--   same guest landed on the completed session, renamed its key, and minted a
--   fresh one. ONE GUEST, ONE CART, 4 SUBMITS -> 4 orders, 4 tickets,
--   8 `ticket_order_notifications` rows (a duplicate confirmation email AND SMS
--   every time).
--
-- WHY THIS FILE EXECUTES SQL RATHER THAN FAKING A DATABASE:
--   The #2136 tester demonstrated on THIS EXACT CODE PATH that a TypeScript
--   fake plus `assertStringIncludes` let an `AND` -> `OR` mutation of the
--   finalize arm's predicate pass green while real PostgreSQL minted a bad
--   order. So every check below runs against the real applied migration chain
--   and asserts on real `orders`, `tickets`, `ticket_checkout_sessions` and
--   `ticket_order_notifications` rows. Every check RAISEs on failure, so the
--   psql exit code is the verdict — the same contract as
--   `issue_2136_free_checkout_no_value_arm.tester.adversarial.test.sql` and
--   `issue_2101_named_buyer_checkout_access.test.sql`.
--
--   `pg_temp.i2150_submit_free` transcribes the CONTROL FLOW of
--   `ticket-checkout-create`'s free arm — create-session, then either the
--   #2150 completed-session short-circuit or authorize-then-finalize — so a
--   revert of EITHER half of the fix turns these checks red:
--     * revert the MIGRATION  -> submit #2 gets a NEW session, a 2nd order,
--                                a 2nd ticket and 2 more notification rows.
--     * revert the EDGE branch -> submit #2 falls into the authorize call,
--                                which refuses a non-in-flight session, and the
--                                guest is told `unavailable` about a
--                                reservation they hold.
--
-- INVARIANT UNDER TEST — I-PROPOSED-2150-FREE-COMPLETED-SESSION-IDEMPOTENT
-- (DRAFT): resubmitting an identical FREE reservation returns the guest's
-- EXISTING order. It never mints a second order, a second pass, or a second
-- confirmation. Terminal-session tombstoning is unchanged for every session
-- that carried value.

\set ON_ERROR_STOP on

-- ── Fixture: a published free event on a bare brand, built exactly as the
--    #2136 suite builds one (the #1014 free-publish lever), so the #2101 access
--    snapshots are populated the way production populates them.
CREATE OR REPLACE FUNCTION pg_temp.i2150_free_event(
  p_tag text,
  p_quantity_total int DEFAULT 100,
  OUT o_event uuid, OUT o_ticket_type uuid
) LANGUAGE plpgsql AS $$
DECLARE v_user uuid := gen_random_uuid(); v_brand uuid := gen_random_uuid();
BEGIN
  o_event := gen_random_uuid();
  INSERT INTO auth.users(id) VALUES (v_user);
  INSERT INTO public.creator_accounts(id) VALUES (v_user);
  INSERT INTO public.brands(id, account_id, name, slug)
    VALUES (v_brand, v_user, 'i2150 ' || p_tag, 'i2150-' || p_tag || '-' || v_brand);
  INSERT INTO public.events(id, brand_id, title, slug, event_type, status, visibility, timezone)
    VALUES (o_event, v_brand, 'i2150 ' || p_tag, 'i2150-' || p_tag || '-' || o_event,
            'event', 'draft', 'draft', 'UTC');
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
    VALUES (o_event, now() + interval '7 days', now() + interval '7 days 4 hours', 'UTC', true);
  INSERT INTO public.ticket_types(event_id, name, price_cents, is_free, quantity_total,
                                  min_purchase_qty, available_online, available_in_person, display_order)
    VALUES (o_event, 'Free entry', 0, true, p_quantity_total, 1, true, true, 0)
    RETURNING id INTO o_ticket_type;
  PERFORM set_config('mingla.publish_free_only', 'on', true);
  UPDATE public.events SET status='scheduled', visibility='public', published_at=now()
   WHERE id = o_event;
  PERFORM set_config('mingla.publish_free_only', '', true);
END $$;

-- ── Fixture: a published PAID event. `payment_provider='paystack'` so the
--    Stripe-account readiness gate in the base RPC is not the thing under test;
--    what matters here is only that `total_cents > 0`.
CREATE OR REPLACE FUNCTION pg_temp.i2150_paid_event(
  p_tag text,
  OUT o_event uuid, OUT o_ticket_type uuid
) LANGUAGE plpgsql AS $$
DECLARE v_user uuid := gen_random_uuid(); v_brand uuid := gen_random_uuid();
BEGIN
  o_event := gen_random_uuid();
  INSERT INTO auth.users(id) VALUES (v_user);
  INSERT INTO public.creator_accounts(id) VALUES (v_user);
  INSERT INTO public.brands(id, account_id, name, slug, payment_provider, default_currency)
    VALUES (v_brand, v_user, 'i2150p ' || p_tag, 'i2150p-' || p_tag || '-' || v_brand,
            'paystack', 'NGN');
  INSERT INTO public.events(id, brand_id, title, slug, event_type, status, visibility, timezone)
    VALUES (o_event, v_brand, 'i2150p ' || p_tag, 'i2150p-' || p_tag || '-' || o_event,
            'event', 'draft', 'draft', 'UTC');
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
    VALUES (o_event, now() + interval '7 days', now() + interval '7 days 4 hours', 'UTC', true);
  INSERT INTO public.ticket_types(event_id, name, price_cents, currency, is_free, quantity_total,
                                  min_purchase_qty, available_online, available_in_person, display_order)
    VALUES (o_event, 'Paid entry', 500000, 'NGN', false, 100, 1, true, true, 0)
    RETURNING id INTO o_ticket_type;
  UPDATE public.events SET status='scheduled', visibility='public', published_at=now()
   WHERE id = o_event;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.i2150_pepper() RETURNS text
  LANGUAGE sql IMMUTABLE AS $$ SELECT 'issue-2150-implementor-happy-path-pepper-0123456789'::text $$;

-- ── The Edge free arm, transcribed. `ticket-checkout-create/index.ts`:
--      session := biz_ticket_checkout_create_session(...)
--      if session.status == 'free_completed' && session.orderId  -> #2150 replay,
--          return that order's issued tickets; NO finalize, NO confirmation
--          dispatch, NO ad-conversion fire.
--      if session.totalCents == 0 -> issue_1930_ticket_session_authorized,
--          then biz_ticket_checkout_finalize, then dispatch the confirmation.
CREATE OR REPLACE FUNCTION pg_temp.i2150_submit_free(
  p_event uuid, p_ticket_type uuid, p_key text,
  p_buyer_user uuid DEFAULT NULL, p_qty int DEFAULT 1
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_session jsonb; v_session_id uuid; v_order uuid; v_total int; v_fin jsonb;
BEGIN
  v_session := public.biz_ticket_checkout_create_session(
    p_event, p_buyer_user, 'Resubmitting Guest', 'i2150-guest@tester.test', '+14155550150',
    false,
    jsonb_build_array(jsonb_build_object('ticketTypeId', p_ticket_type, 'quantity', p_qty)),
    p_key, now() + interval '15 minutes', 0, 'auto');
  v_session_id := (v_session->>'checkoutSessionId')::uuid;
  v_total := COALESCE((v_session->>'totalCents')::int, 0);

  -- #2150 Edge short-circuit.
  IF v_session->>'status' = 'free_completed'
     AND NULLIF(v_session->>'orderId','') IS NOT NULL THEN
    v_order := (v_session->>'orderId')::uuid;
    RETURN jsonb_build_object(
      'kind','free_completed','replayed',true,
      'checkoutSessionId',v_session_id,'orderId',v_order,
      'ticketCount',(SELECT count(*) FROM public.tickets t WHERE t.order_id = v_order));
  END IF;

  IF v_total <> 0 THEN
    RAISE EXCEPTION 'FIXTURE BROKEN: expected a zero-total session, got %', v_total;
  END IF;
  IF NOT public.issue_1930_ticket_session_authorized(v_session_id, p_event) THEN
    RETURN jsonb_build_object('kind','unavailable','checkoutSessionId',v_session_id);
  END IF;
  v_fin := public.biz_ticket_checkout_finalize(
    v_session_id, NULL, NULL, 'free', pg_temp.i2150_pepper(), NULL, NULL, false);
  IF v_fin->>'outcome' <> 'finalized' THEN
    RETURN jsonb_build_object('kind','unavailable','outcome',v_fin->>'outcome',
                              'checkoutSessionId',v_session_id);
  END IF;
  v_order := (v_fin->>'orderId')::uuid;
  RETURN jsonb_build_object(
    'kind','free_completed','replayed',false,
    'checkoutSessionId',v_session_id,'orderId',v_order,
    'ticketCount',(SELECT count(*) FROM public.tickets t WHERE t.order_id = v_order));
END $$;

CREATE OR REPLACE FUNCTION pg_temp.i2150_orders(p_event uuid) RETURNS bigint
  LANGUAGE sql AS $$ SELECT count(*) FROM public.orders WHERE event_id = p_event $$;

CREATE OR REPLACE FUNCTION pg_temp.i2150_tickets(p_event uuid) RETURNS bigint
  LANGUAGE sql AS $$ SELECT count(*) FROM public.tickets WHERE event_id = p_event $$;

CREATE OR REPLACE FUNCTION pg_temp.i2150_notifs(p_event uuid, p_channel text DEFAULT NULL)
  RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*) FROM public.ticket_order_notifications n
   WHERE n.event_id = p_event AND (p_channel IS NULL OR n.channel = p_channel) $$;

CREATE OR REPLACE FUNCTION pg_temp.i2150_sessions(p_event uuid) RETURNS bigint
  LANGUAGE sql AS $$ SELECT count(*) FROM public.ticket_checkout_sessions WHERE event_id = p_event $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- H-01 — THE BUG ITSELF. One guest, one cart, FOUR submits.
--        EXACTLY 1 order, 1 ticket, 1 confirmation EMAIL and 1 SMS.
--        This is the check that fails when the fix is reverted (a revert
--        produces 4 / 4 / 4 / 4).
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
DO $$
DECLARE f record; v_key text; r jsonb; v_first uuid; i int;
BEGIN
  SELECT * INTO f FROM pg_temp.i2150_free_event('h01');
  v_key := 'i2150-h01-' || f.o_event::text;

  FOR i IN 1..4 LOOP
    r := pg_temp.i2150_submit_free(f.o_event, f.o_ticket_type, v_key);
    IF r->>'kind' <> 'free_completed' THEN
      RAISE EXCEPTION 'H-01 FAIL: submit % answered kind=% (outcome=%). A guest resubmitting '
        'their own free reservation must be given that reservation back, not an error.',
        i, r->>'kind', COALESCE(r->>'outcome','-');
    END IF;
    IF i = 1 THEN
      v_first := (r->>'orderId')::uuid;
    ELSIF (r->>'orderId')::uuid <> v_first THEN
      RAISE EXCEPTION 'H-01 FAIL: submit % returned order % but the first submit created % — '
        'the resubmit minted a DUPLICATE order.', i, r->>'orderId', v_first;
    END IF;
    IF i > 1 AND (r->>'replayed')::boolean IS NOT TRUE THEN
      RAISE EXCEPTION 'H-01 FAIL: submit % did not take the #2150 idempotent-replay arm — '
        'the completed session was tombstoned and re-minted.', i;
    END IF;
  END LOOP;

  IF pg_temp.i2150_orders(f.o_event) <> 1 THEN
    RAISE EXCEPTION 'H-01 FAIL: 4 submits produced % orders, expected exactly 1.',
      pg_temp.i2150_orders(f.o_event);
  END IF;
  IF pg_temp.i2150_tickets(f.o_event) <> 1 THEN
    RAISE EXCEPTION 'H-01 FAIL: 4 submits produced % tickets, expected exactly 1.',
      pg_temp.i2150_tickets(f.o_event);
  END IF;
  -- The duplicate messaging is what the guest actually experiences, so it is
  -- asserted explicitly and per channel, not as a total.
  IF pg_temp.i2150_notifs(f.o_event, 'email') <> 1 THEN
    RAISE EXCEPTION 'H-01 FAIL: the guest was queued % confirmation EMAILS, expected exactly 1.',
      pg_temp.i2150_notifs(f.o_event, 'email');
  END IF;
  IF pg_temp.i2150_notifs(f.o_event, 'sms') <> 1 THEN
    RAISE EXCEPTION 'H-01 FAIL: the guest was queued % confirmation SMS, expected exactly 1.',
      pg_temp.i2150_notifs(f.o_event, 'sms');
  END IF;
  IF pg_temp.i2150_notifs(f.o_event) <> 2 THEN
    RAISE EXCEPTION 'H-01 FAIL: % notification rows in total, expected exactly 2.',
      pg_temp.i2150_notifs(f.o_event);
  END IF;
  IF pg_temp.i2150_sessions(f.o_event) <> 1 THEN
    RAISE EXCEPTION 'H-01 FAIL: % checkout sessions exist, expected exactly 1 — the completed '
      'session was tombstoned and a replacement minted.', pg_temp.i2150_sessions(f.o_event);
  END IF;
  IF (SELECT count(*) FROM public.ticket_checkout_sessions
       WHERE event_id = f.o_event AND idempotency_key = v_key) <> 1 THEN
    RAISE EXCEPTION 'H-01 FAIL: the guest''s idempotency key no longer resolves to their session — '
      'it was renamed by the tombstone UPDATE.';
  END IF;
  IF EXISTS(SELECT 1 FROM public.ticket_checkout_sessions
             WHERE event_id = f.o_event AND idempotency_key LIKE '%:tombstone:%') THEN
    RAISE EXCEPTION 'H-01 FAIL: a completed FREE session was tombstoned.';
  END IF;
  RAISE NOTICE 'H-01 PASS: 4 submits -> 1 order, 1 ticket, 1 email, 1 SMS, 1 session.';
END $$;
ROLLBACK;


-- ═══════════════════════════════════════════════════════════════════════════
-- H-02 — CAPACITY IS NOT CONSUMED TWICE. A `quantity_total = 1` free ticket
--        survives 3 submits with the single unit still spent exactly once, and
--        the guest still holds their pass. (Pre-fix the second reservation was
--        refused at session-create — bounded, but the guest saw an error about
--        a ticket they already had.)
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
DO $$
DECLARE f record; v_key text; r jsonb; i int;
BEGIN
  SELECT * INTO f FROM pg_temp.i2150_free_event('h02', 1);
  v_key := 'i2150-h02-' || f.o_event::text;
  FOR i IN 1..3 LOOP
    r := pg_temp.i2150_submit_free(f.o_event, f.o_ticket_type, v_key);
    IF r->>'kind' <> 'free_completed' THEN
      RAISE EXCEPTION 'H-02 FAIL: submit % on a single-capacity free ticket answered kind=%.',
        i, r->>'kind';
    END IF;
  END LOOP;
  IF pg_temp.i2150_tickets(f.o_event) <> 1 THEN
    RAISE EXCEPTION 'H-02 FAIL: % tickets issued against quantity_total=1.',
      pg_temp.i2150_tickets(f.o_event);
  END IF;
  RAISE NOTICE 'H-02 PASS: quantity_total=1 survives 3 submits with 1 ticket and no error.';
END $$;
ROLLBACK;


-- ═══════════════════════════════════════════════════════════════════════════
-- H-03 — THE PAID PATH IS NOT REGRESSED: a session that FAILED must still be
--        re-creatable. This is the case the ORCH-0791 tombstone exists for —
--        a failed provider session must never wedge the buyer's key.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
DO $$
DECLARE f record; v_key text; s1 jsonb; s2 jsonb; v_fin jsonb; v_id1 uuid; v_id2 uuid; v_status text;
BEGIN
  SELECT * INTO f FROM pg_temp.i2150_paid_event('h03');
  v_key := 'i2150-h03-' || f.o_event::text;
  s1 := public.biz_ticket_checkout_create_session(
    f.o_event, NULL, 'Paying Guest', 'i2150-paid@tester.test', '+14155550151', false,
    jsonb_build_array(jsonb_build_object('ticketTypeId', f.o_ticket_type, 'quantity', 1)),
    v_key, now() + interval '15 minutes', 0, 'auto');
  v_id1 := (s1->>'checkoutSessionId')::uuid;
  IF (s1->>'totalCents')::int <= 0 THEN
    RAISE EXCEPTION 'FIXTURE BROKEN: the paid fixture produced a zero-total session.';
  END IF;

  -- Drive it to a REAL terminal failure through the production path: a paid
  -- session that never claimed a provider attempt and carries no provider
  -- reference takes the wrapper's `paid_provider_reference_missing` arm, which
  -- sets status='failed'.
  v_fin := public.biz_ticket_checkout_finalize(
    v_id1, NULL, NULL, 'card', pg_temp.i2150_pepper(), NULL, NULL, false);
  IF v_fin->>'outcome' <> 'paid_reversal_pending' THEN
    RAISE EXCEPTION 'FIXTURE BROKEN: expected paid_reversal_pending, got %.', v_fin->>'outcome';
  END IF;
  SELECT status INTO v_status FROM public.ticket_checkout_sessions WHERE id = v_id1;
  IF v_status <> 'failed' THEN
    RAISE EXCEPTION 'FIXTURE BROKEN: expected the failed session status, got %.', v_status;
  END IF;

  -- The buyer retries. The key MUST tombstone and a NEW session must be minted.
  s2 := public.biz_ticket_checkout_create_session(
    f.o_event, NULL, 'Paying Guest', 'i2150-paid@tester.test', '+14155550151', false,
    jsonb_build_array(jsonb_build_object('ticketTypeId', f.o_ticket_type, 'quantity', 1)),
    v_key, now() + interval '15 minutes', 0, 'auto');
  v_id2 := (s2->>'checkoutSessionId')::uuid;
  IF v_id2 = v_id1 THEN
    RAISE EXCEPTION 'H-03 FAIL: a FAILED paid session was reused. #2150 leaked into the paid path '
      'and the buyer can no longer re-attempt payment.';
  END IF;
  IF s2->>'status' <> 'requires_payment' THEN
    RAISE EXCEPTION 'H-03 FAIL: the re-created paid session has status %, expected requires_payment.',
      s2->>'status';
  END IF;
  IF (SELECT idempotency_key FROM public.ticket_checkout_sessions WHERE id = v_id1)
     NOT LIKE '%:tombstone:%' THEN
    RAISE EXCEPTION 'H-03 FAIL: the failed paid session was NOT tombstoned — ORCH-0791 regressed.';
  END IF;
  RAISE NOTICE 'H-03 PASS: a failed PAID session still tombstones and re-creates.';
END $$;
ROLLBACK;


-- ═══════════════════════════════════════════════════════════════════════════
-- H-04 — THE PAID PATH IS NOT REGRESSED: a COMPLETED paid session still
--        tombstones. The exemption is keyed on `total_cents = 0`, so money
--        never enters it. A buyer who paid once and buys again gets a second
--        order, which is correct for a sale.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
DO $$
DECLARE f record; v_key text; s1 jsonb; s2 jsonb; v_claim jsonb; v_fin jsonb;
        v_id1 uuid; v_id2 uuid; v_status text;
BEGIN
  SELECT * INTO f FROM pg_temp.i2150_paid_event('h04');
  v_key := 'i2150-h04-' || f.o_event::text;
  s1 := public.biz_ticket_checkout_create_session(
    f.o_event, NULL, 'Paying Guest', 'i2150-paid2@tester.test', '+14155550152', false,
    jsonb_build_array(jsonb_build_object('ticketTypeId', f.o_ticket_type, 'quantity', 1)),
    v_key, now() + interval '15 minutes', 0, 'auto');
  v_id1 := (s1->>'checkoutSessionId')::uuid;

  -- Claim a provider attempt so the finalize wrapper's admission-epoch CAS
  -- passes, then finalize with a real-shaped provider reference: the base mints
  -- the order and sets status='paid_completed'.
  v_claim := public.issue_1930_claim_ticket_provider_attempt(
    v_id1, f.o_event, 'paystack', 'paystack_redirect', 'i2150-h04-fingerprint');
  IF v_claim->>'outcome' <> 'fresh_claim' THEN
    RAISE EXCEPTION 'FIXTURE BROKEN: claim answered %.', v_claim->>'outcome';
  END IF;
  v_fin := public.biz_ticket_checkout_finalize(
    v_id1, 'i2150h04ref', '1215000150', 'card', pg_temp.i2150_pepper(), NULL, NULL, false);
  IF v_fin->>'outcome' <> 'finalized' THEN
    RAISE EXCEPTION 'FIXTURE BROKEN: paid finalize answered %.', v_fin->>'outcome';
  END IF;
  SELECT status INTO v_status FROM public.ticket_checkout_sessions WHERE id = v_id1;
  IF v_status <> 'paid_completed' THEN
    RAISE EXCEPTION 'FIXTURE BROKEN: expected paid_completed, got %.', v_status;
  END IF;

  s2 := public.biz_ticket_checkout_create_session(
    f.o_event, NULL, 'Paying Guest', 'i2150-paid2@tester.test', '+14155550152', false,
    jsonb_build_array(jsonb_build_object('ticketTypeId', f.o_ticket_type, 'quantity', 1)),
    v_key, now() + interval '15 minutes', 0, 'auto');
  v_id2 := (s2->>'checkoutSessionId')::uuid;
  IF v_id2 = v_id1 THEN
    RAISE EXCEPTION 'H-04 FAIL: a COMPLETED PAID session was returned instead of tombstoned. '
      'The #2150 exemption is not scoped to zero-total.';
  END IF;
  IF (SELECT idempotency_key FROM public.ticket_checkout_sessions WHERE id = v_id1)
     NOT LIKE '%:tombstone:%' THEN
    RAISE EXCEPTION 'H-04 FAIL: the completed paid session was NOT tombstoned — ORCH-0791 regressed.';
  END IF;
  RAISE NOTICE 'H-04 PASS: a completed PAID session still tombstones and re-creates.';
END $$;
ROLLBACK;


-- ═══════════════════════════════════════════════════════════════════════════
-- H-05 — THE ORCH-0829-B D-1 EXPIRY TOMBSTONE IS NOT REGRESSED. An abandoned
--        non-terminal FREE session past `expires_at` still tombstones, expires
--        and re-creates. The #2150 exemption tests `status='free_completed'`,
--        so it must not swallow this.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
DO $$
DECLARE f record; v_key text; s1 jsonb; s2 jsonb; v_id1 uuid; v_id2 uuid;
BEGIN
  SELECT * INTO f FROM pg_temp.i2150_free_event('h05');
  v_key := 'i2150-h05-' || f.o_event::text;
  s1 := public.biz_ticket_checkout_create_session(
    f.o_event, NULL, 'Abandoning Guest', 'i2150-aband@tester.test', '+14155550153', false,
    jsonb_build_array(jsonb_build_object('ticketTypeId', f.o_ticket_type, 'quantity', 1)),
    v_key, now() + interval '15 minutes', 0, 'auto');
  v_id1 := (s1->>'checkoutSessionId')::uuid;
  UPDATE public.ticket_checkout_sessions SET expires_at = now() - interval '1 minute'
   WHERE id = v_id1;

  s2 := public.biz_ticket_checkout_create_session(
    f.o_event, NULL, 'Abandoning Guest', 'i2150-aband@tester.test', '+14155550153', false,
    jsonb_build_array(jsonb_build_object('ticketTypeId', f.o_ticket_type, 'quantity', 1)),
    v_key, now() + interval '15 minutes', 0, 'auto');
  v_id2 := (s2->>'checkoutSessionId')::uuid;
  IF v_id2 = v_id1 THEN
    RAISE EXCEPTION 'H-05 FAIL: an ABANDONED past-expiry session was reused — ORCH-0829-B D-1 regressed.';
  END IF;
  IF (SELECT status FROM public.ticket_checkout_sessions WHERE id = v_id1) <> 'expired' THEN
    RAISE EXCEPTION 'H-05 FAIL: the abandoned session was not transitioned to expired.';
  END IF;
  RAISE NOTICE 'H-05 PASS: an abandoned past-expiry free session still tombstones.';
END $$;
ROLLBACK;


-- ═══════════════════════════════════════════════════════════════════════════
-- H-06 — A REVOKED OR VOIDED FREE RESERVATION IS NOT HANDED BACK. If the pass
--        the guest held is gone, they must be able to reserve again — the
--        exemption must not wedge them into a dead order.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
DO $$
DECLARE f record; v_key text; r1 jsonb; r2 jsonb;
BEGIN
  SELECT * INTO f FROM pg_temp.i2150_free_event('h06');
  v_key := 'i2150-h06-' || f.o_event::text;
  r1 := pg_temp.i2150_submit_free(f.o_event, f.o_ticket_type, v_key);
  IF r1->>'kind' <> 'free_completed' THEN
    RAISE EXCEPTION 'FIXTURE BROKEN: first free submit answered %.', r1->>'kind';
  END IF;
  -- The organiser cancels the reservation: the pass is voided.
  UPDATE public.tickets SET status = 'void' WHERE order_id = (r1->>'orderId')::uuid;

  r2 := pg_temp.i2150_submit_free(f.o_event, f.o_ticket_type, v_key);
  IF r2->>'kind' <> 'free_completed' THEN
    RAISE EXCEPTION 'H-06 FAIL: after their pass was voided the guest could not re-reserve (kind=%).',
      r2->>'kind';
  END IF;
  IF (r2->>'orderId')::uuid = (r1->>'orderId')::uuid THEN
    RAISE EXCEPTION 'H-06 FAIL: the guest was handed back a VOIDED reservation.';
  END IF;
  IF (r2->>'replayed')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'H-06 FAIL: the voided reservation took the idempotent-replay arm.';
  END IF;
  RAISE NOTICE 'H-06 PASS: a voided free reservation falls through and the guest can re-reserve.';
END $$;
ROLLBACK;


-- ═══════════════════════════════════════════════════════════════════════════
-- H-07 — A DIFFERENT SIGNED-IN BUYER IS NOT HANDED SOMEONE ELSE'S PASSES.
--        The derived key is (event, email, phone, lines), so an anonymous
--        guest and a signed-in user can collide on it. The exemption requires
--        the buyer identity to match; a mismatch falls through to today's
--        behaviour instead of disclosing the first buyer's order and QR codes.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
DO $$
DECLARE f record; v_key text; r1 jsonb; r2 jsonb; v_other uuid := gen_random_uuid();
BEGIN
  SELECT * INTO f FROM pg_temp.i2150_free_event('h07');
  v_key := 'i2150-h07-' || f.o_event::text;
  INSERT INTO auth.users(id) VALUES (v_other);
  r1 := pg_temp.i2150_submit_free(f.o_event, f.o_ticket_type, v_key);
  IF r1->>'kind' <> 'free_completed' THEN
    RAISE EXCEPTION 'FIXTURE BROKEN: anonymous free submit answered %.', r1->>'kind';
  END IF;

  r2 := pg_temp.i2150_submit_free(f.o_event, f.o_ticket_type, v_key, v_other);
  IF (r2->>'orderId') IS NOT NULL
     AND (r2->>'orderId')::uuid = (r1->>'orderId')::uuid THEN
    RAISE EXCEPTION 'H-07 FAIL: a DIFFERENT buyer was handed the first guest''s order and passes.';
  END IF;
  IF COALESCE((r2->>'replayed')::boolean, false) THEN
    RAISE EXCEPTION 'H-07 FAIL: a different buyer took the idempotent-replay arm.';
  END IF;
  RAISE NOTICE 'H-07 PASS: the replay is bound to the buyer identity.';
END $$;
ROLLBACK;

\echo 'issue #2150 implementor happy-path suite: H-01..H-07 PASS'
