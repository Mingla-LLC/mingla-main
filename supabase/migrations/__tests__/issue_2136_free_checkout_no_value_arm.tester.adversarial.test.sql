-- issue #2136 [free-ticket checkout] — TESTER ADVERSARIAL suite.
--
-- DIFFERENT ANGLE FROM THE IMPLEMENTOR, DELIBERATELY.
--
--   The implementor's `issue_2136_free_checkout_contract.test.ts` drives the
--   REAL Edge handler against a TypeScript fake that SIMULATES the database
--   arms, plus two `Deno.readTextFile` tests that string-match the migration's
--   own text. Neither ever executes a line of SQL. That leaves two blind spots
--   this file exists to cover:
--
--     1. A simulated database proves what the Edge does GIVEN an outcome. It
--        cannot prove which outcome the real function actually produces for a
--        given session — the entire subject of #2136.
--     2. `assertStringIncludes` on individual clauses does not constrain the
--        boolean connectives BETWEEN them. Rewriting the arm's guard from
--                AND COALESCE(p_stripe_charge_id,'')=''
--        to      OR  COALESCE(p_stripe_charge_id,'')=''
--        keeps every asserted substring present, so all 8 of those tests stay
--        green — while a zero-total session carrying a live `pi_…` payment
--        intent starts minting an order through the no-value arm with the
--        epoch CAS skipped. Verified: mutated the migration, ran the
--        implementor suite (8 passed / 0 failed), applied it to PostgreSQL 17
--        and watched `outcome=finalized`, `orders=1`, `tickets=1`,
--        `orders.stripe_payment_intent_id='pi_REALMONEY'`,
--        `payment_method='free'`. TA-03 and TA-04 below are the checks that
--        turn red on exactly that mutation.
--
--   So this suite EXECUTES. It runs against the real applied schema, calls the
--   real `public.biz_ticket_checkout_finalize`, and asserts on real `orders`,
--   `tickets`, `ticket_checkout_sessions` and
--   `checkout_sale_revocation_outbox` rows. Every check RAISEs on failure, so
--   the psql exit code is the verdict (same contract as
--   `issue_2101_named_buyer_checkout_access.test.sql` and
--   `issue_2079_paystack_late_refund_identity.test.sql`).
--
-- INVARIANT UNDER TEST — I-PROPOSED-2136-FREE-FINALIZE-REACHABLE (DRAFT):
--   A zero-total ticket checkout session that passes live current truth MUST
--   reach `outcome='finalized'` with an order and its issued tickets. A
--   zero-total session that FAILS live current truth MUST return
--   `outcome='unavailable'` and MUST NOT be recorded as a pending payment
--   reversal.
--
-- FAILS ON REVERT: reverting the migration to its #2101 predecessor makes the
--   free path take the `paid_provider_reference_missing` arm again, so TA-01
--   fails on `outcome=paid_reversal_pending` with zero orders.

\set ON_ERROR_STOP on

-- ── Fixture helper. A published, free, single-date event on a bare brand plus
--    one anonymous pending_free checkout session, built through the REAL
--    `biz_ticket_checkout_create_session` RPC so the #2101 access snapshots are
--    populated exactly as production populates them. A hand-inserted session
--    row fails `issue_1930_ticket_session_authorized` for the wrong reason and
--    would make every negative check below vacuously "not finalized".
CREATE OR REPLACE FUNCTION pg_temp.i2136_fixture(
  p_tag text,
  p_quantity_total int DEFAULT 100,
  OUT o_event uuid, OUT o_ticket_type uuid, OUT o_session uuid
) LANGUAGE plpgsql AS $$
DECLARE
  v_user uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_session jsonb;
BEGIN
  o_event := gen_random_uuid();
  INSERT INTO auth.users(id) VALUES (v_user);
  INSERT INTO public.creator_accounts(id) VALUES (v_user);
  INSERT INTO public.brands(id, account_id, name, slug)
    VALUES (v_brand, v_user, 'i2136 ' || p_tag, 'i2136-' || p_tag || '-' || v_brand);
  INSERT INTO public.events(id, brand_id, title, slug, event_type, status, visibility, timezone)
    VALUES (o_event, v_brand, 'i2136 ' || p_tag, 'i2136-' || p_tag || '-' || o_event,
            'event', 'draft', 'draft', 'UTC');
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
    VALUES (o_event, now() + interval '7 days', now() + interval '7 days 4 hours', 'UTC', true);
  INSERT INTO public.ticket_types(event_id, name, price_cents, is_free, quantity_total,
                                  min_purchase_qty, available_online, available_in_person, display_order)
    VALUES (o_event, 'Free entry', 0, true, p_quantity_total, 1, true, true, 0)
    RETURNING id INTO o_ticket_type;
  -- A free-only event on a brand with no settlement currency publishes under
  -- the #1014 free-publish lever; this is the exact shape of the production
  -- events that could never be claimed.
  PERFORM set_config('mingla.publish_free_only', 'on', true);
  UPDATE public.events SET status='scheduled', visibility='public', published_at=now()
   WHERE id = o_event;
  PERFORM set_config('mingla.publish_free_only', '', true);
  v_session := public.biz_ticket_checkout_create_session(
    o_event, NULL, 'Adversarial Guest', 'i2136-' || p_tag || '@tester.test', '+14155550123',
    false,
    jsonb_build_array(jsonb_build_object('ticketTypeId', o_ticket_type, 'quantity', 1)),
    'i2136-idem-' || p_tag || '-' || o_event, now() + interval '15 minutes', 0, 'auto');
  o_session := (v_session->>'checkoutSessionId')::uuid;
  IF v_session->>'status' <> 'pending_free' OR (v_session->>'totalCents')::int <> 0 THEN
    RAISE EXCEPTION 'FIXTURE BROKEN (%): expected pending_free/0, got %/%',
      p_tag, v_session->>'status', v_session->>'totalCents';
  END IF;
END $$;

-- The pepper only has to clear the 32-char floor in
-- `biz_ticket_checkout_assert_qr_pepper`; nothing here inspects a QR payload.
CREATE OR REPLACE FUNCTION pg_temp.i2136_pepper() RETURNS text
  LANGUAGE sql IMMUTABLE AS $$ SELECT 'issue-2136-tester-adversarial-pepper-0123456789'::text $$;

CREATE OR REPLACE FUNCTION pg_temp.i2136_orders(p_session uuid) RETURNS bigint
  LANGUAGE sql AS $$ SELECT count(*) FROM public.orders WHERE checkout_session_id = p_session $$;

CREATE OR REPLACE FUNCTION pg_temp.i2136_tickets(p_session uuid) RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*) FROM public.tickets t
    JOIN public.orders o ON o.id = t.order_id
   WHERE o.checkout_session_id = p_session $$;

CREATE OR REPLACE FUNCTION pg_temp.i2136_outbox(p_session uuid) RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*) FROM public.checkout_sale_revocation_outbox
   WHERE subject_type = 'ticket_checkout_session' AND subject_id = p_session $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- TA-01 — BASELINE. The whole point of #2136: a clean free session reaches
--         `finalized` with an order, its tickets, and NO payment bookkeeping.
--         This is the check that fails when the migration is reverted.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
DO $$
DECLARE f record; v jsonb; v_method text; v_reversal text; v_status text;
BEGIN
  SELECT * INTO f FROM pg_temp.i2136_fixture('ta01');
  v := public.biz_ticket_checkout_finalize(
    f.o_session, NULL, NULL, 'free', pg_temp.i2136_pepper(), NULL, NULL, false);

  IF v->>'outcome' <> 'finalized' THEN
    RAISE EXCEPTION 'TA-01 FAIL: a clean free session returned outcome=% (expected finalized). '
      'The #2136 no-value arm is absent or unreachable.', v->>'outcome';
  END IF;
  IF pg_temp.i2136_orders(f.o_session) <> 1 THEN
    RAISE EXCEPTION 'TA-01 FAIL: expected exactly 1 order, found %', pg_temp.i2136_orders(f.o_session);
  END IF;
  IF pg_temp.i2136_tickets(f.o_session) <> 1 THEN
    RAISE EXCEPTION 'TA-01 FAIL: expected exactly 1 issued ticket, found %', pg_temp.i2136_tickets(f.o_session);
  END IF;
  -- The envelope must carry the tickets on the fresh-mint arm — the Edge
  -- read-back is a fallback, not the primary source.
  IF NOT (v ? 'tickets') OR jsonb_array_length(v->'tickets') <> 1 THEN
    RAISE EXCEPTION 'TA-01 FAIL: fresh-mint envelope carried tickets=%', v->'tickets';
  END IF;

  SELECT payment_method INTO v_method FROM public.orders WHERE checkout_session_id = f.o_session;
  IF v_method <> 'free' THEN
    RAISE EXCEPTION 'TA-01 FAIL: order payment_method=% (expected free)', v_method;
  END IF;
  SELECT status, reversal_state INTO v_status, v_reversal
    FROM public.ticket_checkout_sessions WHERE id = f.o_session;
  IF v_status <> 'free_completed' THEN
    RAISE EXCEPTION 'TA-01 FAIL: session status=% (expected free_completed)', v_status;
  END IF;
  -- I-PROPOSED-2136: a sale that took no money is never payment bookkeeping.
  IF v_reversal <> 'none' OR pg_temp.i2136_outbox(f.o_session) <> 0 THEN
    RAISE EXCEPTION 'TA-01 FAIL: free success left reversal_state=% and % revocation-outbox row(s)',
      v_reversal, pg_temp.i2136_outbox(f.o_session);
  END IF;
  RAISE NOTICE 'TA-01 PASS: a free session finalizes -> 1 order (payment_method=free), 1 ticket, '
    'session free_completed, reversal_state=none, 0 revocation-outbox rows';
END $$;
ROLLBACK;


-- ═══════════════════════════════════════════════════════════════════════════
-- ANGLE 1 — can anything that carries value reach the no-value arm?
-- The PR's entire safety argument is "every paid caller supplies a provider
-- reference". TA-02..TA-05 attack the three-part entry predicate one term at a
-- time. Each one must keep the session OUT of the arm.
-- ═══════════════════════════════════════════════════════════════════════════

-- TA-02 — a session that CARRIES VALUE, finalized with no provider reference at
-- all. Guards the `COALESCE(v_session.total_cents,0)=0` term. If that term is
-- ever dropped or widened, a paid session whose webhook lost its reference
-- would mint a free order instead of opening a reversal.
BEGIN;
DO $$
DECLARE f record; v jsonb;
BEGIN
  SELECT * INTO f FROM pg_temp.i2136_fixture('ta02');
  UPDATE public.ticket_checkout_sessions
     SET total_cents = 5000, currency = 'USD' WHERE id = f.o_session;
  v := public.biz_ticket_checkout_finalize(
    f.o_session, NULL, NULL, NULL, pg_temp.i2136_pepper(), NULL, NULL, false);

  IF v->>'outcome' = 'finalized' OR pg_temp.i2136_orders(f.o_session) <> 0 THEN
    RAISE EXCEPTION 'TA-02 FAIL (CRITICAL): a session with total_cents=5000 entered the no-value '
      'arm — outcome=%, orders=%. A sale that carries value must never mint through the free path.',
      v->>'outcome', pg_temp.i2136_orders(f.o_session);
  END IF;
  IF v->>'outcome' <> 'paid_reversal_pending' THEN
    RAISE EXCEPTION 'TA-02 FAIL: expected the preserved paid guard (paid_reversal_pending), got %',
      v->>'outcome';
  END IF;
  RAISE NOTICE 'TA-02 PASS: total_cents>0 + no provider reference stays on the PAID guard '
    '(paid_reversal_pending, 0 orders) — the no-value arm is gated on zero total';
END $$;
ROLLBACK;

-- TA-03 — zero total, but a LIVE STRIPE PAYMENT INTENT and no charge id.
-- Guards the `AND COALESCE(p_stripe_charge_id,'')=''` connective. This is the
-- exact mutation the implementor's two `assertStringIncludes` tests cannot see.
BEGIN;
DO $$
DECLARE f record; v jsonb;
BEGIN
  SELECT * INTO f FROM pg_temp.i2136_fixture('ta03');
  v := public.biz_ticket_checkout_finalize(
    f.o_session, 'pi_REALMONEY', NULL, 'card', pg_temp.i2136_pepper(), NULL, NULL, false);

  IF v->>'outcome' = 'finalized' OR pg_temp.i2136_orders(f.o_session) <> 0 THEN
    RAISE EXCEPTION 'TA-03 FAIL (CRITICAL): a session carrying payment intent pi_REALMONEY entered '
      'the no-value arm — outcome=%, orders=%, order PI=%. The arm''s three entry conditions must be '
      'ANDed; an OR lets money through with the admission-epoch CAS skipped.',
      v->>'outcome', pg_temp.i2136_orders(f.o_session),
      (SELECT stripe_payment_intent_id FROM public.orders WHERE checkout_session_id = f.o_session);
  END IF;
  RAISE NOTICE 'TA-03 PASS: zero total + live payment intent is REFUSED by the no-value arm (outcome=%)',
    v->>'outcome';
END $$;
ROLLBACK;

-- TA-04 — zero total, no payment intent, but a charge id present. Guards the
-- mirror connective.
BEGIN;
DO $$
DECLARE f record; v jsonb;
BEGIN
  SELECT * INTO f FROM pg_temp.i2136_fixture('ta04');
  v := public.biz_ticket_checkout_finalize(
    f.o_session, NULL, 'ch_REALMONEY', 'card', pg_temp.i2136_pepper(), NULL, NULL, false);

  IF v->>'outcome' = 'finalized' OR pg_temp.i2136_orders(f.o_session) <> 0 THEN
    RAISE EXCEPTION 'TA-04 FAIL (CRITICAL): a session carrying charge ch_REALMONEY entered the '
      'no-value arm — outcome=%, orders=%', v->>'outcome', pg_temp.i2136_orders(f.o_session);
  END IF;
  RAISE NOTICE 'TA-04 PASS: zero total + charge id is REFUSED by the no-value arm (outcome=%)',
    v->>'outcome';
END $$;
ROLLBACK;

-- TA-05 — NULL vs empty string vs whitespace. `COALESCE(x,'')=''` treats NULL
-- and '' identically (both enter the arm) but treats a single space as a
-- PRESENT reference (stays on the paid guard). Pinning both halves stops a
-- future `btrim()` or `IS NULL` rewrite from silently changing which sessions
-- are considered "no value".
BEGIN;
DO $$
DECLARE f record; v_ws jsonb; v_empty jsonb; g record;
BEGIN
  SELECT * INTO f FROM pg_temp.i2136_fixture('ta05a');
  v_ws := public.biz_ticket_checkout_finalize(
    f.o_session, ' ', NULL, 'card', pg_temp.i2136_pepper(), NULL, NULL, false);
  IF v_ws->>'outcome' = 'finalized' OR pg_temp.i2136_orders(f.o_session) <> 0 THEN
    RAISE EXCEPTION 'TA-05 FAIL: a whitespace payment intent was treated as no-value — outcome=%',
      v_ws->>'outcome';
  END IF;

  SELECT * INTO g FROM pg_temp.i2136_fixture('ta05b');
  v_empty := public.biz_ticket_checkout_finalize(
    g.o_session, '', '', 'free', pg_temp.i2136_pepper(), NULL, NULL, false);
  IF v_empty->>'outcome' <> 'finalized' OR pg_temp.i2136_orders(g.o_session) <> 1 THEN
    RAISE EXCEPTION 'TA-05 FAIL: empty-string references did not behave like NULL — outcome=%, orders=%',
      v_empty->>'outcome', pg_temp.i2136_orders(g.o_session);
  END IF;
  RAISE NOTICE 'TA-05 PASS: empty string == NULL (arm entered); whitespace == a present reference '
    '(arm refused). Both halves pinned.';
END $$;
ROLLBACK;

-- TA-06 — the premise the arm rests on, asserted against the LIVE CATALOG
-- rather than prose. The migration argues it is safe to skip the admission
-- epoch CAS because `admission_epoch` is written in exactly one place and only
-- the paid arms reach it. That premise is only true while
-- `issue_1930_claim_ticket_provider_attempt` remains the sole writer. A second
-- writer would make a zero-total session with a stale epoch constructible, and
-- the no-value arm would mint through it. (Runtime-confirmed: a zero-total
-- session with a claimed attempt and a deliberately bumped epoch DOES finalize.)
BEGIN;
DO $$
DECLARE v_writers text;
BEGIN
  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO v_writers
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.prosrc ~ 'UPDATE\s+public\.ticket_checkout_sessions\s+SET\s+admission_epoch';
  IF v_writers IS DISTINCT FROM 'issue_1930_claim_ticket_provider_attempt' THEN
    RAISE EXCEPTION 'TA-06 FAIL: admission_epoch writers are now [%] (expected exactly '
      'issue_1930_claim_ticket_provider_attempt). #2136 skips the epoch CAS on the strength of '
      'that single writer; a new one re-opens the stale-epoch window for zero-total sessions.',
      COALESCE(v_writers, '<none>');
  END IF;
  RAISE NOTICE 'TA-06 PASS: issue_1930_claim_ticket_provider_attempt is still the only writer of '
    'ticket_checkout_sessions.admission_epoch — the no-CAS premise holds';
END $$;
ROLLBACK;


-- ═══════════════════════════════════════════════════════════════════════════
-- ANGLE 2 — does the no-value arm leak past its own guards? It skips the epoch
-- CAS deliberately, so the three live-truth checks it keeps are the only thing
-- standing between an invalid session and a minted ticket.
-- ═══════════════════════════════════════════════════════════════════════════

-- TA-07 — a REVOKED session. Must be `unavailable`, must mint nothing, and —
-- the half the paid arm gets wrong for free sales — must NOT open a revocation
-- outbox row or flip the session into a pending payment reversal.
BEGIN;
DO $$
DECLARE f record; v jsonb; v_reversal text;
BEGIN
  SELECT * INTO f FROM pg_temp.i2136_fixture('ta07');
  UPDATE public.ticket_checkout_sessions
     SET revoked_at = now(), revoked_reason = 'tester_adversarial' WHERE id = f.o_session;
  v := public.biz_ticket_checkout_finalize(
    f.o_session, NULL, NULL, 'free', pg_temp.i2136_pepper(), NULL, NULL, false);

  IF v->>'outcome' <> 'unavailable' THEN
    RAISE EXCEPTION 'TA-07 FAIL: a revoked session returned outcome=% (expected unavailable)',
      v->>'outcome';
  END IF;
  IF pg_temp.i2136_orders(f.o_session) <> 0 OR pg_temp.i2136_tickets(f.o_session) <> 0 THEN
    RAISE EXCEPTION 'TA-07 FAIL: a revoked session minted % order(s) / % ticket(s)',
      pg_temp.i2136_orders(f.o_session), pg_temp.i2136_tickets(f.o_session);
  END IF;
  SELECT reversal_state INTO v_reversal
    FROM public.ticket_checkout_sessions WHERE id = f.o_session;
  IF v_reversal = 'paid_reversal_pending' OR pg_temp.i2136_outbox(f.o_session) <> 0 THEN
    RAISE EXCEPTION 'TA-07 FAIL: a free reservation was recorded as a pending payment reversal '
      '(reversal_state=%, outbox rows=%). There is no payment to reverse.',
      v_reversal, pg_temp.i2136_outbox(f.o_session);
  END IF;
  RAISE NOTICE 'TA-07 PASS: revoked free session -> unavailable, 0 orders, 0 tickets, '
    'no reversal state, no revocation-outbox row';
END $$;
ROLLBACK;

-- TA-08 — an UNAUTHORIZED session: the ticket type is hidden after the session
-- was created. Live current truth is read under the locks, so this must lose.
BEGIN;
DO $$
DECLARE f record; v jsonb;
BEGIN
  SELECT * INTO f FROM pg_temp.i2136_fixture('ta08');
  UPDATE public.ticket_types SET is_hidden = true WHERE id = f.o_ticket_type;
  v := public.biz_ticket_checkout_finalize(
    f.o_session, NULL, NULL, 'free', pg_temp.i2136_pepper(), NULL, NULL, false);

  IF v->>'outcome' <> 'unavailable' OR pg_temp.i2136_orders(f.o_session) <> 0 THEN
    RAISE EXCEPTION 'TA-08 FAIL: a session whose ticket type was hidden mid-flight returned '
      'outcome=% with % order(s)', v->>'outcome', pg_temp.i2136_orders(f.o_session);
  END IF;
  RAISE NOTICE 'TA-08 PASS: ticket type hidden after session create -> unavailable, 0 orders';
END $$;
ROLLBACK;

-- TA-09 — a NON-SELLABLE event. Cancelling the event also fires the #1930
-- revoke trigger, so this is the realistic organiser-cancels-mid-checkout path.
BEGIN;
DO $$
DECLARE f record; v jsonb;
BEGIN
  SELECT * INTO f FROM pg_temp.i2136_fixture('ta09');
  UPDATE public.events SET status = 'cancelled' WHERE id = f.o_event;
  v := public.biz_ticket_checkout_finalize(
    f.o_session, NULL, NULL, 'free', pg_temp.i2136_pepper(), NULL, NULL, false);

  IF v->>'outcome' <> 'unavailable' OR pg_temp.i2136_orders(f.o_session) <> 0 THEN
    RAISE EXCEPTION 'TA-09 FAIL: a cancelled event still produced outcome=% with % order(s)',
      v->>'outcome', pg_temp.i2136_orders(f.o_session);
  END IF;
  RAISE NOTICE 'TA-09 PASS: event cancelled mid-checkout -> unavailable, 0 orders';
END $$;
ROLLBACK;

-- TA-10 — the STRANDED PRODUCTION SHAPE. The three real sessions that #2136
-- diagnosed are `status='failed'`, `reversal_state='paid_reversal_pending'`,
-- with an open revocation-outbox row. Once the migration is applied, a retry
-- against one of those rows must NOT resurrect it into a real ticket — the
-- outbox has already been told that sale is being revoked.
BEGIN;
DO $$
DECLARE f record; v jsonb;
BEGIN
  SELECT * INTO f FROM pg_temp.i2136_fixture('ta10');
  UPDATE public.ticket_checkout_sessions
     SET status = 'failed', failed_at = now(), reversal_state = 'paid_reversal_pending'
   WHERE id = f.o_session;
  v := public.biz_ticket_checkout_finalize(
    f.o_session, NULL, NULL, 'free', pg_temp.i2136_pepper(), NULL, NULL, false);

  IF v->>'outcome' = 'finalized' OR pg_temp.i2136_orders(f.o_session) <> 0 THEN
    RAISE EXCEPTION 'TA-10 FAIL: a failed/reversal-pending session was resurrected into an order — '
      'outcome=%, orders=%', v->>'outcome', pg_temp.i2136_orders(f.o_session);
  END IF;
  RAISE NOTICE 'TA-10 PASS: the stranded production session shape (failed + paid_reversal_pending) '
    'stays unavailable — the three real sessions cannot be back-filled into tickets';
END $$;
ROLLBACK;


-- ═══════════════════════════════════════════════════════════════════════════
-- ANGLE 3 — replay and double submission.
-- ═══════════════════════════════════════════════════════════════════════════

-- TA-11 — finalize the SAME session twice. Exactly one order and one ticket,
-- same order id both times. The second envelope must also be shown to carry NO
-- `tickets` key: that is precisely why the Edge reads the issued rows back by
-- order id, and if the wrapper ever started returning them the read-back's
-- fallback branch would stop being exercised.
BEGIN;
DO $$
DECLARE f record; v1 jsonb; v2 jsonb;
BEGIN
  SELECT * INTO f FROM pg_temp.i2136_fixture('ta11');
  v1 := public.biz_ticket_checkout_finalize(
    f.o_session, NULL, NULL, 'free', pg_temp.i2136_pepper(), NULL, NULL, false);
  v2 := public.biz_ticket_checkout_finalize(
    f.o_session, NULL, NULL, 'free', pg_temp.i2136_pepper(), NULL, NULL, false);

  IF v2->>'outcome' <> 'finalized' OR (v1->>'orderId') IS DISTINCT FROM (v2->>'orderId') THEN
    RAISE EXCEPTION 'TA-11 FAIL: replay returned outcome=% orderId=% (first was %)',
      v2->>'outcome', v2->>'orderId', v1->>'orderId';
  END IF;
  IF pg_temp.i2136_orders(f.o_session) <> 1 OR pg_temp.i2136_tickets(f.o_session) <> 1 THEN
    RAISE EXCEPTION 'TA-11 FAIL: replaying finalize produced % order(s) and % ticket(s) (expected 1/1)',
      pg_temp.i2136_orders(f.o_session), pg_temp.i2136_tickets(f.o_session);
  END IF;
  IF v2 ? 'tickets' THEN
    RAISE EXCEPTION 'TA-11 FAIL: the idempotent-replay arm now returns a tickets key. The Edge '
      'read-back fallback in ticket-checkout-create is no longer exercised — re-check it.';
  END IF;
  RAISE NOTICE 'TA-11 PASS: double finalize on one session -> 1 order, 1 ticket, identical orderId; '
    'the replay envelope carries no tickets key (the Edge read-back is load-bearing)';
END $$;
ROLLBACK;

-- TA-12 — CAPACITY IS NEVER OVERSOLD. This is the containment property for the
-- duplicate-submission exposure recorded below: a second guest cannot take a
-- seat that is gone, and neither can the same guest.
BEGIN;
DO $$
DECLARE f record; v1 jsonb; v_second_failed boolean := false;
BEGIN
  SELECT * INTO f FROM pg_temp.i2136_fixture('ta12', 1);
  v1 := public.biz_ticket_checkout_finalize(
    f.o_session, NULL, NULL, 'free', pg_temp.i2136_pepper(), NULL, NULL, false);
  IF v1->>'outcome' <> 'finalized' THEN
    RAISE EXCEPTION 'TA-12 FAIL: the first guest could not claim the only seat (outcome=%)',
      v1->>'outcome';
  END IF;
  BEGIN
    PERFORM public.biz_ticket_checkout_create_session(
      f.o_event, NULL, 'Second Guest', 'i2136-ta12b@tester.test', '+14155550999', false,
      jsonb_build_array(jsonb_build_object('ticketTypeId', f.o_ticket_type, 'quantity', 1)),
      'i2136-idem-ta12b-' || f.o_event, now() + interval '15 minutes', 0, 'auto');
  EXCEPTION WHEN others THEN
    v_second_failed := true;
  END;
  IF NOT v_second_failed THEN
    RAISE EXCEPTION 'TA-12 FAIL: a second session was created for a sold-out free ticket type';
  END IF;
  IF (SELECT count(*) FROM public.tickets WHERE ticket_type_id = f.o_ticket_type) <> 1 THEN
    RAISE EXCEPTION 'TA-12 FAIL: quantity_total=1 but % tickets exist',
      (SELECT count(*) FROM public.tickets WHERE ticket_type_id = f.o_ticket_type);
  END IF;
  RAISE NOTICE 'TA-12 PASS: quantity_total=1 yields exactly 1 free ticket; the second reservation '
    'is refused at session create — free checkout cannot oversell';
END $$;
ROLLBACK;

-- TA-13 — DUPLICATE SUBMISSION EXPOSURE (finding TA-F1, reported to the
-- orchestrator as a NEW issue, not fixed on this branch).
--
-- `biz_ticket_checkout_create_session` tombstones a session whose status is
-- terminal — `free_completed` is terminal — and then creates a FRESH session
-- under the same idempotency key. Before #2136 a free session could never reach
-- `free_completed`, so this was unreachable. It is reachable now: one guest who
-- submits the identical cart twice receives two orders, two tickets and two
-- sets of confirmation notifications. The mechanism lives in #2101/#1930's
-- create-session RPC, NOT in the #2136 diff.
--
-- This check pins the MECHANISM (the tombstone rename) so the follow-up issue
-- has an executable repro, and pins the CONTAINMENT (capacity still bounds it,
-- proved by TA-12). If the duplicate is fixed, the tombstone assertion below is
-- the thing to revisit.
BEGIN;
DO $$
DECLARE
  f record; v_key text; v_replay jsonb; v1 jsonb; v2 jsonb;
  v_orders bigint; v_tickets bigint; v_notifications bigint;
BEGIN
  SELECT * INTO f FROM pg_temp.i2136_fixture('ta13', 1000);
  SELECT idempotency_key INTO v_key
    FROM public.ticket_checkout_sessions WHERE id = f.o_session;

  v1 := public.biz_ticket_checkout_finalize(
    f.o_session, NULL, NULL, 'free', pg_temp.i2136_pepper(), NULL, NULL, false);

  -- The guest re-submits: identical event, buyer and cart, so
  -- `checkoutIdempotencyKey` in ticket-checkout-create derives the SAME key.
  v_replay := public.biz_ticket_checkout_create_session(
    f.o_event, NULL, 'Adversarial Guest', 'i2136-ta13@tester.test', '+14155550123', false,
    jsonb_build_array(jsonb_build_object('ticketTypeId', f.o_ticket_type, 'quantity', 1)),
    v_key, now() + interval '15 minutes', 0, 'auto');

  IF (v_replay->>'checkoutSessionId')::uuid = f.o_session THEN
    RAISE EXCEPTION 'TA-13 FAIL: the replay returned the completed session instead of tombstoning it '
      '— re-derive the duplicate analysis in finding TA-F1, the mechanism changed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ticket_checkout_sessions
                  WHERE id = f.o_session AND idempotency_key LIKE v_key || ':tombstone:%') THEN
    RAISE EXCEPTION 'TA-13 FAIL: the completed free session was not tombstoned; finding TA-F1''s '
      'mechanism no longer holds and the duplicate analysis must be redone';
  END IF;

  v2 := public.biz_ticket_checkout_finalize(
    (v_replay->>'checkoutSessionId')::uuid, NULL, NULL, 'free', pg_temp.i2136_pepper(), NULL, NULL, false);

  SELECT count(*) INTO v_orders FROM public.orders WHERE event_id = f.o_event;
  SELECT count(*) INTO v_tickets FROM public.tickets WHERE event_id = f.o_event;
  SELECT count(*) INTO v_notifications
    FROM public.ticket_order_notifications WHERE event_id = f.o_event;

  -- Containment: whatever the duplicate count, capacity must still bound it.
  IF v_tickets > 1000 THEN
    RAISE EXCEPTION 'TA-13 FAIL: duplicate submission broke the capacity bound — % tickets for '
      'quantity_total=1000', v_tickets;
  END IF;
  RAISE NOTICE 'TA-13 RECORDED (finding TA-F1): one guest, one cart, two submissions under the same '
    'idempotency key -> outcomes %/%, % orders, % tickets, % notification rows. Capacity still '
    'bounds it (TA-12). Mechanism: create-session tombstones the free_completed session and mints a '
    'fresh one. Owner: #2101/#1930 create-session, NOT the #2136 diff.',
    v1->>'outcome', v2->>'outcome', v_orders, v_tickets, v_notifications;
END $$;
ROLLBACK;


-- ═══════════════════════════════════════════════════════════════════════════
-- ANGLE 4 — does any OTHER zero-total path share the epoch blind spot?
-- Answered against the live catalog, not by grepping the tree.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
DO $$
DECLARE v_minters text; v_rsvp_uses_epoch boolean; v_rsvp_amount_check boolean;
BEGIN
  -- TA-14a — exactly one function in the whole schema mints an order. If a
  -- door-sale, comp or chip-in minter is ever added it inherits this analysis
  -- and must be re-checked for the same NULL-epoch defect.
  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO v_minters
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prosrc ILIKE '%INSERT INTO public.orders%';
  IF v_minters IS DISTINCT FROM 'issue_1930_ticket_checkout_finalize_base' THEN
    RAISE EXCEPTION 'TA-14a FAIL: order minters are now [%] (expected only '
      'issue_1930_ticket_checkout_finalize_base). A new minter must be audited for the #2136 '
      'zero-total / NULL-admission-epoch defect before it ships.', COALESCE(v_minters, '<none>');
  END IF;

  -- TA-14b — RSVP contributions cannot be zero-value at all, so the free
  -- finalize defect has no analogue there.
  SELECT EXISTS(
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.event_rsvp_contributions'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) = 'CHECK ((amount_cents > 0))')
    INTO v_rsvp_amount_check;
  IF NOT v_rsvp_amount_check THEN
    RAISE EXCEPTION 'TA-14b FAIL: event_rsvp_contributions.amount_cents lost its (> 0) check — a '
      'zero-value contribution is now constructible and needs the same audit #2136 did for tickets';
  END IF;

  -- TA-14c — and the RSVP finalize has no admission-epoch CAS to be NULL in the
  -- first place.
  SELECT position('admission_epoch' in prosrc) > 0 INTO v_rsvp_uses_epoch
    FROM pg_proc WHERE proname = 'issue_1930_finalize_rsvp_contribution';
  IF v_rsvp_uses_epoch IS NULL THEN
    RAISE EXCEPTION 'TA-14c FAIL: issue_1930_finalize_rsvp_contribution is missing from the catalog';
  END IF;
  IF v_rsvp_uses_epoch THEN
    RAISE EXCEPTION 'TA-14c FAIL: the RSVP finalize now CAS-compares an admission epoch. It must be '
      'audited for the #2136 NULL-epoch defect.';
  END IF;

  RAISE NOTICE 'TA-14 PASS: exactly one order minter in the schema; RSVP contributions are '
    'CHECK(amount_cents > 0) so no zero-value analogue exists; the RSVP finalize has no epoch CAS. '
    'No other zero-total path shares the #2136 blind spot.';
END $$;
ROLLBACK;

DO $$ BEGIN
  RAISE NOTICE 'issue #2136 tester-adversarial suite complete: TA-01..TA-14 all passed.';
END $$;
