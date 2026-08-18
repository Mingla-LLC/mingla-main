-- Issue #2217 — EXECUTED proof that a guest's ticket follows them into the app,
-- and that a guessed identifier is handed nothing.
--
-- WHY THIS FILE EXECUTES SQL. #2136's tester demonstrated on this codebase that
-- a TypeScript fake plus `assertStringIncludes` let an AND -> OR mutation pass
-- green while real PostgreSQL minted a bad order. The claim here MOVES A PAID
-- ASSET between accounts, so every check below runs the real RPCs against the
-- real applied migration chain and reads real `orders`, `tickets` and
-- `conversation_participants` rows. Each check RAISEs on failure; the psql exit
-- code is the verdict.
--
-- THE CHECK THAT MATTERS MOST IS I-03. `attacker` is given
-- `auth.users.email = <the buyer's email>` WITH `email_confirmed_at` set — the
-- exact shape a naive "match the confirmed email" implementation would accept,
-- and the shape 125 of 125 production users already have. It must get nothing.
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.i2217_uuid(seed text) RETURNS uuid
LANGUAGE sql IMMUTABLE AS $$
  SELECT (substr(md5(seed),1,8)||'-'||substr(md5(seed),9,4)||'-4'||substr(md5(seed),14,3)||'-8'||substr(md5(seed),18,3)||'-'||substr(md5(seed),21,12))::uuid
$$;

-- `auth.identities` is a GoTrue table and the supabase/postgres CI image ships a
-- stub auth schema without it. The lane provisions it as `supabase_admin` in a
-- step before this file, exactly as the existing lanes provision the missing
-- auth.users columns. On hosted Supabase that step is a no-op. Fail LOUDLY here
-- rather than silently passing on an image where nothing could ever match.
DO $guard$
BEGIN
  IF to_regclass('auth.identities') IS NULL THEN
    RAISE EXCEPTION 'auth.identities is missing - the lane must provision the GoTrue identity stub as supabase_admin before running this file';
  END IF;
END $guard$;

SET session_replication_role = replica;

INSERT INTO auth.users(id) VALUES
  (pg_temp.i2217_uuid('creator')),
  (pg_temp.i2217_uuid('owner')),
  (pg_temp.i2217_uuid('attacker')),
  (pg_temp.i2217_uuid('phoneuser')),
  (pg_temp.i2217_uuid('unverified')),
  (pg_temp.i2217_uuid('teammate'));

-- THE ADVERSARIAL SHAPE. attacker.email IS the buyer's email and it IS
-- "confirmed" — the column every user on production already has set. attacker
-- holds NO auth.identities row for it, so it never became a verified identifier.
UPDATE auth.users SET email='buyer2217@example.test', email_confirmed_at=now()
 WHERE id = pg_temp.i2217_uuid('attacker');
UPDATE auth.users SET phone='15550002217', phone_confirmed_at=now()
 WHERE id = pg_temp.i2217_uuid('phoneuser');

INSERT INTO auth.identities(user_id, provider, provider_id, identity_data) VALUES
  -- Supabase email OTP: a code was mailed there and returned.
  (pg_temp.i2217_uuid('owner'), 'email', 'owner-2217',
   '{"email":"Buyer2217@Example.test","email_verified":false}'::jsonb),
  -- attacker's OWN verified mailbox — a different one.
  (pg_temp.i2217_uuid('attacker'), 'email', 'attacker-2217',
   '{"email":"attacker2217@example.test","email_verified":false}'::jsonb),
  -- Phone OTP. GoTrue stores the number bare; orders keep E.164.
  (pg_temp.i2217_uuid('phoneuser'), 'phone', 'phone-2217',
   '{"phone":"15550002217","phone_verified":false}'::jsonb),
  -- An IdP identity that did NOT assert the mailbox.
  (pg_temp.i2217_uuid('unverified'), 'google', 'google-2217',
   '{"email":"unverified2217@example.test","email_verified":false}'::jsonb);

INSERT INTO public.creator_accounts(id, email)
VALUES (pg_temp.i2217_uuid('creator'), 'i2217-creator@example.test');
INSERT INTO public.brands(id, account_id, name, slug)
VALUES (pg_temp.i2217_uuid('brand'), pg_temp.i2217_uuid('creator'), 'Issue 2217', 'issue-2217');
INSERT INTO public.brand_team_members(brand_id, user_id, role, accepted_at, invited_at)
VALUES (pg_temp.i2217_uuid('brand'), pg_temp.i2217_uuid('teammate'), 'brand_admin', now(), now());

INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone, theme)
VALUES (pg_temp.i2217_uuid('event'), pg_temp.i2217_uuid('brand'), pg_temp.i2217_uuid('creator'),
        'Issue 2217 Event', 'issue-2217-event', 'event', 'scheduled', 'public', 'UTC', '{}'::jsonb);
INSERT INTO public.ticket_types(id, event_id, name, price_cents, currency, quantity_total)
VALUES (pg_temp.i2217_uuid('tier'), pg_temp.i2217_uuid('event'), 'General', 1000, 'USD', 1000);

-- Production creates this on event INSERT (ensure_group_conversation_on_event_create).
-- session_replication_role=replica suppresses that trigger for the fixture, so the
-- room is created here explicitly — otherwise I-05 would be proving that the claim
-- path CREATES a chat rather than that it JOINS the buyer to the existing one.
INSERT INTO public.conversations(id, type, linked_entity_type, event_id, name, created_by, is_enabled, is_broadcast_only)
VALUES (pg_temp.i2217_uuid('conv'), 'group', 'event', pg_temp.i2217_uuid('event'),
        'Issue 2217 Event', pg_temp.i2217_uuid('creator'), true, false);

-- Five guest orders on the SAME event. Each carries a real ticket.
INSERT INTO public.orders(id, event_id, buyer_email, buyer_phone_e164, buyer_name,
                          total_cents, currency, payment_status, source)
VALUES
  (pg_temp.i2217_uuid('o-email'),    pg_temp.i2217_uuid('event'), 'buyer2217@example.test',   '+15550009991', 'Buyer',     1000,'USD','paid','legacy'),
  (pg_temp.i2217_uuid('o-unarmed'),  pg_temp.i2217_uuid('event'), 'buyer2217@example.test',   '+15550009992', 'Unarmed',   1000,'USD','paid','legacy'),
  (pg_temp.i2217_uuid('o-phone'),    pg_temp.i2217_uuid('event'), 'nobody2217@example.test',  '+15550002217', 'Phone',     1000,'USD','paid','legacy'),
  (pg_temp.i2217_uuid('o-refunded'), pg_temp.i2217_uuid('event'), 'buyer2217@example.test',   '+15550009993', 'Refunded',  1000,'USD','refunded','legacy'),
  (pg_temp.i2217_uuid('o-unverif'),  pg_temp.i2217_uuid('event'), 'unverified2217@example.test','+15550009994','Unverif',  1000,'USD','paid','legacy'),
  -- Armed WHILE PAID and refunded afterwards. The arming flag stays set, so this
  -- is the ONLY fixture that isolates the claim scan's own payment predicate.
  (pg_temp.i2217_uuid('o-postref'),  pg_temp.i2217_uuid('event'), 'buyer2217@example.test',   '+15550009995', 'PostRef',   1000,'USD','paid','legacy');

-- The teammate is a REAL buyer as well as brand staff — the only shape that can
-- distinguish "not evicted because still entitled" from "not evicted because staff".
INSERT INTO public.orders(id, event_id, buyer_user_id, buyer_email, buyer_name,
                          total_cents, currency, payment_status, source)
VALUES (pg_temp.i2217_uuid('o-team'), pg_temp.i2217_uuid('event'), pg_temp.i2217_uuid('teammate'),
        'teammate2217@example.test', 'Teammate', 1000, 'USD', 'paid', 'legacy');

INSERT INTO public.tickets(id, order_id, ticket_type_id, event_id, qr_code, status, approval_status)
SELECT pg_temp.i2217_uuid('t-'||tag), pg_temp.i2217_uuid('o-'||tag), pg_temp.i2217_uuid('tier'),
       pg_temp.i2217_uuid('event'), 'qr-2217-'||tag, 'valid', 'auto'
  FROM unnest(ARRAY['email','unarmed','phone','refunded','unverif','postref','team']) tag;

SET session_replication_role = origin;

DO $test$
DECLARE
  r jsonb;
  v_conv uuid;
  v_owner uuid := pg_temp.i2217_uuid('owner');
  v_attacker uuid := pg_temp.i2217_uuid('attacker');
  v_phoneuser uuid := pg_temp.i2217_uuid('phoneuser');
  v_unverified uuid := pg_temp.i2217_uuid('unverified');
  v_teammate uuid := pg_temp.i2217_uuid('teammate');
  n integer;
BEGIN
  -- ── I-01 arming is possession-gated, idempotent, and refuses the ineligible.
  r := public.arm_order_identity_attendance_claim(
         pg_temp.i2217_uuid('o-email'), pg_temp.i2217_uuid('event'));
  IF r->>'result' <> 'armed' THEN RAISE EXCEPTION 'I-01a first arm was %', r; END IF;
  r := public.arm_order_identity_attendance_claim(
         pg_temp.i2217_uuid('o-email'), pg_temp.i2217_uuid('event'));
  IF r->>'result' <> 'already_armed' THEN RAISE EXCEPTION 'I-01b re-arm was %', r; END IF;
  r := public.arm_order_identity_attendance_claim(
         pg_temp.i2217_uuid('o-refunded'), pg_temp.i2217_uuid('event'));
  IF r->>'result' <> 'ineligible' THEN RAISE EXCEPTION 'I-01c refunded arm was %', r; END IF;
  -- `o-unarmed` is deliberately NEVER armed.
  PERFORM public.arm_order_identity_attendance_claim(
    pg_temp.i2217_uuid('o-phone'), pg_temp.i2217_uuid('event'));
  PERFORM public.arm_order_identity_attendance_claim(
    pg_temp.i2217_uuid('o-unverif'), pg_temp.i2217_uuid('event'));
  r := public.arm_order_identity_attendance_claim(
         pg_temp.i2217_uuid('o-postref'), pg_temp.i2217_uuid('event'));
  IF r->>'result' <> 'armed' THEN RAISE EXCEPTION 'I-01d post-refund arm was %', r; END IF;
  UPDATE public.orders SET payment_status='refunded' WHERE id = pg_temp.i2217_uuid('o-postref');

  -- ── I-02 THE NEGATIVE CASE, RUN FIRST so it cannot be a leftover.
  --    attacker's auth.users.email IS 'buyer2217@example.test' and IS confirmed.
  --    They must be handed nothing, and the order must remain unclaimed.
  r := public.claim_attendance_by_verified_identity(v_attacker);
  IF (r->>'count')::int <> 0 THEN
    RAISE EXCEPTION 'I-02 a guessed/confirmed-only identifier claimed %', r;
  END IF;
  IF EXISTS (SELECT 1 FROM public.orders
              WHERE id = pg_temp.i2217_uuid('o-email') AND buyer_user_id IS NOT NULL) THEN
    RAISE EXCEPTION 'I-02 attacker took ownership of the order';
  END IF;

  -- ── I-03 verified_account_identifiers reports the truth and nothing else.
  SELECT count(*) INTO n FROM public.verified_account_identifiers(v_attacker)
   WHERE value = 'buyer2217@example.test';
  IF n <> 0 THEN RAISE EXCEPTION 'I-03 confirmed-but-unowned email leaked as verified'; END IF;
  SELECT count(*) INTO n FROM public.verified_account_identifiers(v_owner)
   WHERE kind = 'email' AND value = 'buyer2217@example.test';
  IF n <> 1 THEN RAISE EXCEPTION 'I-03 owner email identity not normalized/lowered'; END IF;
  SELECT count(*) INTO n FROM public.verified_account_identifiers(v_phoneuser)
   WHERE kind = 'phone' AND value = '+15550002217';
  IF n <> 1 THEN RAISE EXCEPTION 'I-03 bare GoTrue phone was not restored to E.164'; END IF;

  -- ── I-04 the real buyer signs in and the ticket is there.
  r := public.claim_attendance_by_verified_identity(v_owner);
  IF (r->>'count')::int <> 1 THEN RAISE EXCEPTION 'I-04 owner claim was %', r; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.orders
                  WHERE id = pg_temp.i2217_uuid('o-email') AND buyer_user_id = v_owner) THEN
    RAISE EXCEPTION 'I-04 order did not transfer to the owner';
  END IF;
  -- The UNARMED order carries the SAME email and must NOT have moved.
  IF EXISTS (SELECT 1 FROM public.orders
              WHERE id = pg_temp.i2217_uuid('o-unarmed') AND buyer_user_id IS NOT NULL) THEN
    RAISE EXCEPTION 'I-04 an UNARMED order was claimed on an email match alone';
  END IF;
  -- The REFUNDED order carries the same email and must NOT have moved.
  IF EXISTS (SELECT 1 FROM public.orders
              WHERE id = pg_temp.i2217_uuid('o-refunded') AND buyer_user_id IS NOT NULL) THEN
    RAISE EXCEPTION 'I-04 a refunded order was claimed';
  END IF;
  -- ARMED WHILE PAID, REFUNDED AFTERWARDS. The arming flag is still set, so only
  -- the claim scan's own payment predicate can refuse this one.
  IF EXISTS (SELECT 1 FROM public.orders
              WHERE id = pg_temp.i2217_uuid('o-postref') AND buyer_user_id IS NOT NULL) THEN
    RAISE EXCEPTION 'I-04 an order refunded AFTER arming was still claimed';
  END IF;

  -- ── I-05 the group chat is there too.
  v_conv := pg_temp.i2217_uuid('conv');
  IF NOT EXISTS (SELECT 1 FROM public.conversations WHERE id = v_conv) THEN
    RAISE EXCEPTION 'I-05 fixture conversation vanished';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.conversation_participants
                  WHERE conversation_id = v_conv AND user_id = v_owner) THEN
    RAISE EXCEPTION 'I-05 claimed buyer was not added to the event chat';
  END IF;

  -- ── I-06 idempotent. A second sweep claims nothing and breaks nothing.
  r := public.claim_attendance_by_verified_identity(v_owner);
  IF (r->>'count')::int <> 0 THEN RAISE EXCEPTION 'I-06 re-sweep claimed % again', r; END IF;
  SELECT count(*) INTO n FROM public.conversation_participants
   WHERE conversation_id = v_conv AND user_id = v_owner;
  IF n <> 1 THEN RAISE EXCEPTION 'I-06 duplicate chat participant rows: %', n; END IF;

  -- ── I-07 phone-only match, across the bare-digits / E.164 boundary.
  r := public.claim_attendance_by_verified_identity(v_phoneuser);
  IF (r->>'count')::int <> 1 THEN RAISE EXCEPTION 'I-07 phone claim was %', r; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.orders
                  WHERE id = pg_temp.i2217_uuid('o-phone') AND buyer_user_id = v_phoneuser) THEN
    RAISE EXCEPTION 'I-07 phone order did not transfer';
  END IF;

  -- ── I-08 an IdP identity that did NOT assert the mailbox claims nothing.
  r := public.claim_attendance_by_verified_identity(v_unverified);
  IF (r->>'count')::int <> 0 THEN
    RAISE EXCEPTION 'I-08 email_verified=false was accepted as possession: %', r;
  END IF;

  -- ── I-09 a scan is not a loss. valid -> used must NOT evict the buyer.
  UPDATE public.tickets SET status='used' WHERE id = pg_temp.i2217_uuid('t-email');
  IF NOT EXISTS (SELECT 1 FROM public.conversation_participants
                  WHERE conversation_id = v_conv AND user_id = v_owner) THEN
    RAISE EXCEPTION 'I-09 a ticket scan evicted the buyer from the chat';
  END IF;

  -- ── I-10 a revoked ticket DOES evict.
  UPDATE public.tickets SET status='void' WHERE id = pg_temp.i2217_uuid('t-email');
  IF EXISTS (SELECT 1 FROM public.conversation_participants
              WHERE conversation_id = v_conv AND user_id = v_owner) THEN
    RAISE EXCEPTION 'I-10 a revoked ticket left the buyer in the chat';
  END IF;

  -- ── I-11 a refund evicts too, through the orders trigger.
  UPDATE public.orders SET payment_status='refunded' WHERE id = pg_temp.i2217_uuid('o-phone');
  IF EXISTS (SELECT 1 FROM public.conversation_participants
              WHERE conversation_id = v_conv AND user_id = v_phoneuser) THEN
    RAISE EXCEPTION 'I-11 a refunded buyer stayed in the chat';
  END IF;

  -- ── I-12 the sweep never evicts someone who is in the room for another
  --    reason. The teammate is BOTH a buyer and active brand staff: revoking
  --    their ticket removes the buyer reason and leaves only the staff one.
  INSERT INTO public.conversation_participants(conversation_id, user_id)
  VALUES (v_conv, v_teammate) ON CONFLICT DO NOTHING;
  UPDATE public.tickets SET status='void' WHERE id = pg_temp.i2217_uuid('t-team');
  IF NOT EXISTS (SELECT 1 FROM public.conversation_participants
                  WHERE conversation_id = v_conv AND user_id = v_teammate) THEN
    RAISE EXCEPTION 'I-12 the sweep evicted an active brand team member';
  END IF;

  -- ── I-13 an anonymous / unknown user id claims nothing rather than erroring.
  r := public.claim_attendance_by_verified_identity(pg_temp.i2217_uuid('nobody'));
  IF (r->>'count')::int <> 0 THEN RAISE EXCEPTION 'I-13 unknown user claimed %', r; END IF;

  RAISE NOTICE '#2217 identity attendance claim: I-01..I-13 PASS';
END $test$;
