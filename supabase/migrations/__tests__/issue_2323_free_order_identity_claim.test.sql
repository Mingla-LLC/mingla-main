-- Issue #2323 — EXECUTED proof of the founder's exact journey, on a FREE order.
--
-- He reserved a FREE ticket as a guest with one email, installed the app,
-- signed in with a DIFFERENT email, and verified the SAME phone. The ticket
-- must be there.
--
-- MEASURED ON PRODUCTION 2026-08-19 — order 0485b385-…, session 72f19024-…
-- (`free_completed`), `buyer_phone_e164` = the number he later verified:
--
--   orders.attendance_identity_claim_armed_at → NULL
--   attendance_claim_deliveries for the order → 0
--   free_completed orders 9 → armed 0        ← never, not once
--   paid_completed orders 5 → armed 1        ← the one created after #2241
--
-- and `verified_account_identifiers` DID return that phone for his account
-- (#2269 working exactly as designed). Every server-side factor was in place.
-- The CLIENT never armed the order, so `claim_attendance_by_verified_identity`
-- did not consider it at all.
--
-- WHAT THIS FILE ADDS OVER #2217 AND #2269. Both of those suites arm PAID
-- fixtures (`total_cents = 1000`). Nothing anywhere executed the FREE shape —
-- which is the only shape that has ever run in production and the only one that
-- has never worked. R-01 arms a `total_cents = 0` order and reads the timestamp
-- back OUT OF THE TABLE: a row, not a log line.
--
-- ROW, AND THE ROW IS LOAD-BEARING. R-03 leaves an otherwise identical free
-- order unarmed and proves it is NOT claimed. That is exactly what production
-- looked like on 2026-08-19, and exactly what a revert of the client fix
-- reproduces.
--
-- SECURITY IS UNCHANGED AND RE-PROVEN ON THE FREE SHAPE. R-04 gives an attacker
-- `auth.users.phone` = the buyer's number WITH `phone_confirmed_at` set — the
-- column every production account already has — and no verified identity and no
-- ledger row. They are handed nothing.
\set ON_ERROR_STOP on

-- Namespaced exactly as #871 / #2217 / #2269 namespace theirs: all of them run
-- against ONE database in this lane and share the md5-of-seed scheme, so an
-- un-prefixed seed word collides byte-exactly and the failure reads like a real
-- regression.
CREATE OR REPLACE FUNCTION pg_temp.i2323_uuid(raw_seed text) RETURNS uuid
LANGUAGE sql IMMUTABLE AS $$
  SELECT (
    substr(md5('issue-2323:'||raw_seed),1,8)||'-'||
    substr(md5('issue-2323:'||raw_seed),9,4)||'-4'||
    substr(md5('issue-2323:'||raw_seed),14,3)||'-8'||
    substr(md5('issue-2323:'||raw_seed),18,3)||'-'||
    substr(md5('issue-2323:'||raw_seed),21,12)
  )::uuid
$$;

DO $guard$
BEGIN
  IF to_regclass('auth.identities') IS NULL THEN
    RAISE EXCEPTION 'auth.identities is missing - the lane must provision the GoTrue identity stub as supabase_admin before running this file';
  END IF;
  IF to_regclass('public.verified_phone_identities') IS NULL THEN
    RAISE EXCEPTION 'public.verified_phone_identities is missing - the #2269 migration did not apply';
  END IF;
END $guard$;

SET session_replication_role = replica;

-- RE-RUNNABLE BY CONSTRUCTION (the #2269 precedent). This lane applies the
-- chain once and runs several suites against ONE database, and the CLOSE gate
-- re-runs this file against that non-virgin database. Everything removed here
-- is namespaced under 'issue-2323:', so it touches nothing a sibling owns.
DO $teardown$
DECLARE
  v_users uuid[] := ARRAY(
    SELECT pg_temp.i2323_uuid(s) FROM unnest(ARRAY[
      'creator','founder','attacker']) s);
  v_orders uuid[] := ARRAY(
    SELECT pg_temp.i2323_uuid('o-'||s) FROM unnest(ARRAY[
      'free','free-unarmed','free-bait','free-noident']) s);
BEGIN
  DELETE FROM public.pending_trip_chat_claims WHERE order_id = ANY(v_orders);
  DELETE FROM public.tickets WHERE order_id = ANY(v_orders);
  DELETE FROM public.orders WHERE id = ANY(v_orders);
  DELETE FROM public.conversation_participants WHERE conversation_id = pg_temp.i2323_uuid('conv');
  DELETE FROM public.conversations WHERE id = pg_temp.i2323_uuid('conv');
  DELETE FROM public.ticket_types WHERE id = pg_temp.i2323_uuid('tier');
  DELETE FROM public.events WHERE id = pg_temp.i2323_uuid('event');
  DELETE FROM public.brands WHERE id = pg_temp.i2323_uuid('brand');
  DELETE FROM public.creator_accounts WHERE id = pg_temp.i2323_uuid('creator');
  DELETE FROM public.verified_phone_identities WHERE user_id = ANY(v_users);
  DELETE FROM public.profiles WHERE id = ANY(v_users);
  DELETE FROM auth.identities WHERE user_id = ANY(v_users);
  DELETE FROM auth.users WHERE id = ANY(v_users);
END $teardown$;

INSERT INTO auth.users(id) VALUES
  (pg_temp.i2323_uuid('creator')),
  (pg_temp.i2323_uuid('founder')),
  (pg_temp.i2323_uuid('attacker'));

-- THE ADVERSARIAL SHAPE, on the free order. `attacker` holds auth.users.phone =
-- the buyer's number WITH phone_confirmed_at set, and NO identity, NO ledger row.
UPDATE auth.users SET phone='15552323001', phone_confirmed_at=now()
 WHERE id = pg_temp.i2323_uuid('attacker');

INSERT INTO auth.identities(user_id, provider, provider_id, identity_data) VALUES
  -- THE FOUNDER, as production holds him: Google, and the mailbox Google
  -- asserted is NOT the address the ticket was bought with. The email arm can
  -- never match this order — the phone is the only route, which is the whole
  -- point of #2269 and the reason #2323 costs a real person their ticket.
  (pg_temp.i2323_uuid('founder'), 'google', 'google-2323',
   '{"email":"signed-in-2323@example.test","email_verified":true}'::jsonb),
  (pg_temp.i2323_uuid('attacker'), 'google', 'attacker-2323',
   '{"email":"attacker2323@example.test","email_verified":true}'::jsonb);

INSERT INTO public.creator_accounts(id, email)
VALUES (pg_temp.i2323_uuid('creator'), 'i2323-creator@example.test');
INSERT INTO public.brands(id, account_id, name, slug)
VALUES (pg_temp.i2323_uuid('brand'), pg_temp.i2323_uuid('creator'), 'Issue 2323', 'issue-2323');
INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone, theme)
VALUES (pg_temp.i2323_uuid('event'), pg_temp.i2323_uuid('brand'), pg_temp.i2323_uuid('creator'),
        'Issue 2323 Two Day Free', 'issue-2323-two-day-free', 'event', 'scheduled', 'public', 'UTC', '{}'::jsonb);
-- A FREE tier. This is the shape production has run nine times and armed zero.
INSERT INTO public.ticket_types(id, event_id, name, price_cents, currency, quantity_total)
VALUES (pg_temp.i2323_uuid('tier'), pg_temp.i2323_uuid('event'), 'Free Entry', 0, 'NGN', 1000);
INSERT INTO public.conversations(id, type, linked_entity_type, event_id, name, created_by, is_enabled, is_broadcast_only)
VALUES (pg_temp.i2323_uuid('conv'), 'group', 'event', pg_temp.i2323_uuid('event'),
        'Issue 2323 Two Day Free', pg_temp.i2323_uuid('creator'), true, false);

-- FOUR FREE orders, `total_cents = 0`, `payment_status='paid'` — the exact
-- shape ticket-checkout-create writes for a `free_completed` session (verified
-- against production order 0485b385-…). Every buyer_email is an address NO
-- fixture account owns, so nothing here can pass on #2217's email arm.
--
-- `o-free` and `o-free-unarmed` carry the SAME phone deliberately: the founder
-- reserved twice, and ARMING is then the ONLY difference between the two. A
-- fixture where the unarmed order carried a number nobody had verified would
-- make R-03 unfalsifiable — arming it would change nothing and the check would
-- pass either way. (Measured: it did. The first draft of this file had exactly
-- that hole and the revert-proof caught it.)
INSERT INTO public.orders(id, event_id, buyer_email, buyer_phone_e164, buyer_name,
                          total_cents, currency, payment_status, source)
VALUES
  (pg_temp.i2323_uuid('o-free'),         pg_temp.i2323_uuid('event'), 'bought-with-2323@example.test', '+15552323001', 'Founder', 0,'NGN','paid','online_checkout'),
  (pg_temp.i2323_uuid('o-free-unarmed'), pg_temp.i2323_uuid('event'), 'bought-with-2323@example.test', '+15552323001', 'Unarmed', 0,'NGN','paid','online_checkout'),
  (pg_temp.i2323_uuid('o-free-bait'),    pg_temp.i2323_uuid('event'), 'bought-with-2323@example.test', '+15552323002', 'Bait',    0,'NGN','paid','online_checkout'),
  -- No email and no phone at all. `source='legacy'` because
  -- `orders_online_checkout_phone_e164_check` (correctly) refuses an
  -- online-checkout order without a valid E.164 number — a real constraint,
  -- found by executing this file rather than by reading the schema.
  (pg_temp.i2323_uuid('o-free-noident'), pg_temp.i2323_uuid('event'), '',                              NULL,           'NoIdent', 0,'NGN','paid','legacy');

INSERT INTO public.tickets(id, order_id, ticket_type_id, event_id, qr_code, status, approval_status)
SELECT pg_temp.i2323_uuid('t-'||tag), pg_temp.i2323_uuid('o-'||tag), pg_temp.i2323_uuid('tier'),
       pg_temp.i2323_uuid('event'), 'qr-2323-'||tag, 'valid', 'auto'
  FROM unnest(ARRAY['free','free-unarmed','free-bait','free-noident']) tag;

SET session_replication_role = origin;

DO $test$
DECLARE
  r jsonb;
  n integer;
  v_armed timestamptz;
  v_founder  uuid := pg_temp.i2323_uuid('founder');
  v_attacker uuid := pg_temp.i2323_uuid('attacker');
BEGIN
  -- ── R-01 A FREE ORDER IS ARMABLE, AND THE ARMING IS A ROW.
  --    `total_cents = 0` — the shape nine production orders have and none of
  --    them ever carried this timestamp.
  r := public.arm_order_identity_attendance_claim(
         pg_temp.i2323_uuid('o-free'), pg_temp.i2323_uuid('event'));
  IF r->>'result' <> 'armed' THEN
    RAISE EXCEPTION 'R-01a arming a FREE order returned %', r;
  END IF;
  SELECT o.attendance_identity_claim_armed_at INTO v_armed
    FROM public.orders o WHERE o.id = pg_temp.i2323_uuid('o-free');
  IF v_armed IS NULL THEN
    RAISE EXCEPTION 'R-01b arm reported success but orders.attendance_identity_claim_armed_at is still NULL - a log line, not a row';
  END IF;
  IF (SELECT o.total_cents FROM public.orders o WHERE o.id = pg_temp.i2323_uuid('o-free')) <> 0 THEN
    RAISE EXCEPTION 'R-01c fixture drift: the armed order is not free';
  END IF;
  -- Idempotent: the confirmation screen may mount more than once.
  r := public.arm_order_identity_attendance_claim(
         pg_temp.i2323_uuid('o-free'), pg_temp.i2323_uuid('event'));
  IF r->>'result' <> 'already_armed' THEN
    RAISE EXCEPTION 'R-01d re-arming a free order returned %', r;
  END IF;
  -- An order carrying no reachable identifier is refused rather than armed.
  r := public.arm_order_identity_attendance_claim(
         pg_temp.i2323_uuid('o-free-noident'), pg_temp.i2323_uuid('event'));
  IF r->>'result' <> 'ineligible' THEN
    RAISE EXCEPTION 'R-01e an order with no email and no E.164 phone was armed: %', r;
  END IF;
  -- `o-free-unarmed` is deliberately NEVER armed. That is production today.

  -- ── R-02 THE FOUNDER'S CASE, END TO END.
  --    Bought with one email, signed in with another, verified the phone.
  r := public.record_verified_phone(v_founder, '+15552323001');
  IF r->>'result' <> 'recorded' THEN
    RAISE EXCEPTION 'R-02a verify-otp could not record the phone: %', r;
  END IF;
  -- The email he signed in with is NOT the address on the order, so if this
  -- claim lands it landed on the phone.
  SELECT count(*) INTO n FROM public.verified_account_identifiers(v_founder)
   WHERE kind = 'email' AND value = 'bought-with-2323@example.test';
  IF n <> 0 THEN
    RAISE EXCEPTION 'R-02b fixture drift: the founder must NOT own the purchase email';
  END IF;
  SELECT count(*) INTO n FROM public.verified_account_identifiers(v_founder)
   WHERE kind = 'phone' AND value = '+15552323001';
  IF n <> 1 THEN
    RAISE EXCEPTION 'R-02c the verified phone did not surface for the account (got %)', n;
  END IF;
  -- EXACTLY one. `o-free-unarmed` carries the SAME phone and is not armed, so
  -- a count of 2 means arming stopped gating anything.
  r := public.claim_attendance_by_verified_identity(v_founder);
  IF (r->>'count')::int <> 1 THEN
    RAISE EXCEPTION 'R-02d the founder claimed % - expected exactly the ARMED free order', r;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.orders
                  WHERE id = pg_temp.i2323_uuid('o-free') AND buyer_user_id = v_founder) THEN
    RAISE EXCEPTION 'R-02e the free order did not transfer to the founder';
  END IF;
  -- …and the event chat, which is the product promise printed on the card.
  IF NOT EXISTS (SELECT 1 FROM public.conversation_participants
                  WHERE conversation_id = pg_temp.i2323_uuid('conv') AND user_id = v_founder) THEN
    RAISE EXCEPTION 'R-02f the claimed buyer was not added to the event chat';
  END IF;

  -- ── R-03 THE ARMING IS LOAD-BEARING — this is #2323 itself.
  --    `o-free-unarmed` carries the SAME verified phone as the order that just
  --    moved and was never armed. It must NOT have moved. When the client stops
  --    arming, EVERY free order looks like this one — which is precisely what
  --    production looked like on 2026-08-19.
  IF EXISTS (SELECT 1 FROM public.orders
              WHERE id = pg_temp.i2323_uuid('o-free-unarmed') AND buyer_user_id IS NOT NULL) THEN
    RAISE EXCEPTION 'R-03 an UNARMED free order was claimed - arming is not gating anything';
  END IF;

  -- ── R-04 THE SECURITY FLOOR, on the free shape.
  --    `attacker` has auth.users.phone = the buyer's number, confirmed, and
  --    nothing behind it. Run against the still-unclaimed free order.
  PERFORM public.arm_order_identity_attendance_claim(
    pg_temp.i2323_uuid('o-free-unarmed'), pg_temp.i2323_uuid('event'));
  UPDATE auth.users SET phone='15552323002', phone_confirmed_at=now()
   WHERE id = v_attacker;
  SELECT count(*) INTO n FROM public.verified_account_identifiers(v_attacker) WHERE kind = 'phone';
  IF n <> 0 THEN
    RAISE EXCEPTION 'R-04a auth.users.phone_confirmed_at leaked as a verified identifier (got %)', n;
  END IF;
  r := public.claim_attendance_by_verified_identity(v_attacker);
  IF (r->>'count')::int <> 0 THEN
    RAISE EXCEPTION 'R-04b a guessed/confirmed-only phone claimed % on a free order', r;
  END IF;
  IF EXISTS (SELECT 1 FROM public.orders
              WHERE id = pg_temp.i2323_uuid('o-free-bait') AND buyer_user_id IS NOT NULL) THEN
    RAISE EXCEPTION 'R-04c the attacker took ownership of an ARMED free order';
  END IF;

  RAISE NOTICE '#2323 free-order identity claim: R-01..R-04 PASS';
END $test$;
