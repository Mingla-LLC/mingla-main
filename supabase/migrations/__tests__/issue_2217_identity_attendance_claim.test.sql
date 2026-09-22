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

-- SEEDS ARE NAMESPACED, and that is load-bearing rather than tidy. #871's
-- suite uses the SAME md5-of-seed uuid scheme with the SAME seed words
-- ('creator', 'owner', 'attacker', 'brand', 'event', 'tier'), so an un-prefixed
-- seed produces a BYTE-IDENTICAL uuid. Both suites run against one database in
-- the #2217 lane; without the prefix the second one to run dies on
-- users_pkey and the failure reads exactly like a real regression.
CREATE OR REPLACE FUNCTION pg_temp.i2217_uuid(raw_seed text) RETURNS uuid
LANGUAGE sql IMMUTABLE AS $$
  SELECT (
    substr(md5('issue-2217:'||raw_seed),1,8)||'-'||
    substr(md5('issue-2217:'||raw_seed),9,4)||'-4'||
    substr(md5('issue-2217:'||raw_seed),14,3)||'-8'||
    substr(md5('issue-2217:'||raw_seed),18,3)||'-'||
    substr(md5('issue-2217:'||raw_seed),21,12)
  )::uuid
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
  -- #3524 — `public.account_owns_order_contact` reads TWO more GoTrue tables,
  -- because on this project `mailer_autoconfirm` is on and the bare existence
  -- of a `provider='email'` identity therefore proves nothing: a public signup
  -- at anyone's address mints one with no mail ever sent. The positive proof is
  -- an `otp`/`magiclink`/`recovery` session, which lives in `auth.sessions` +
  -- `auth.mfa_amr_claims`. The predicate FAILS CLOSED when they are absent, so
  -- without them I-04 and I-07 would not be proving the buyer is let in - they
  -- would be measuring a database that cannot answer. Fail LOUDLY instead.
  IF to_regclass('auth.sessions') IS NULL
     OR to_regclass('auth.mfa_amr_claims') IS NULL THEN
    RAISE EXCEPTION 'auth.sessions / auth.mfa_amr_claims are missing - the lane must provision the GoTrue session stub as supabase_admin before running this file';
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

-- ── #3524: WHAT THIS FIXTURE DELIBERATELY DOES NOT SEED ──────────────────
--
-- NO verified-phone ledger row, and no email proof.
--
-- `phoneuser` holds a GoTrue `provider='phone'` identity and NOTHING ELSE, and
-- that is the shape this file must keep measuring: on this project the Phone
-- provider requires confirmation through Twilio Verify, so such an identity
-- could only be written for an account that received the SMS and returned the
-- code. Measured read-only 2026-09-22, 62 live accounts hold proof of exactly
-- that kind and no ledger row, and the provider is now disabled, so they cannot
-- acquire the other kind. I-07 is their case.
--
-- The EMAIL proof is not seeded either. I-04 adds it mid-test, one piece of
-- evidence at a time, so what is measured is which evidence moves a ticket
-- rather than which rows the fixture happened to create.
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

-- #3524 — THE TOKEN RAIL'S OWN ORDER. Same buyer address, a live claim-token
-- digest, and DELIBERATELY NEVER ARMED for the identity rail, so it can never
-- enter a sweep and can never change an I-04 count.
--
-- THE DIGEST BYTE IS NAMESPACED, and that is load-bearing rather than tidy.
-- `orders_attendance_claim_unconsumed_digest_uniq` is a UNIQUE index over every
-- unconsumed digest in the table, and three lanes run this file in the SAME
-- database as #871's suite, whose race order carries `repeat('ab',32)`. Reusing
-- a byte another fixture already holds fails the second suite to run on an
-- INSERT, and the failure reads exactly like a real regression. `22` is unused
-- across supabase/migrations/__tests__. It exists so this lane can
-- see what the token rail ANSWERS for an account that cannot prove the address:
-- the answer must be `identity_mismatch`, which is a truthful refusal the buyer
-- can act on, and never `invalid`, which would be a lie about a valid token.
INSERT INTO public.orders(id, event_id, buyer_email, buyer_phone_e164, buyer_name,
                          total_cents, currency, payment_status, source,
                          attendance_claim_token_digest,
                          attendance_claim_token_created_at,
                          attendance_claim_token_generation)
VALUES (pg_temp.i2217_uuid('o-token'), pg_temp.i2217_uuid('event'),
        'buyer2217@example.test', '+15550009996', 'Token', 1000, 'USD', 'paid', 'legacy',
        decode(repeat('22', 32), 'hex'), now(), 'legacy_v1');

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
-- #3524 — the token-rail order's ticket, added beside the population above
-- rather than into it, so not one existing line of this file changes.
INSERT INTO public.tickets(id, order_id, ticket_type_id, event_id, qr_code, status, approval_status)
VALUES (pg_temp.i2217_uuid('t-token'), pg_temp.i2217_uuid('o-token'), pg_temp.i2217_uuid('tier'),
        pg_temp.i2217_uuid('event'), 'qr-2217-token', 'valid', 'auto');

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
  v_digest bytea;
  v_generation text;
  v_minted timestamptz;
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

  -- ── I-04, REWRITTEN FOR #3524. ────────────────────────────────────────
  --
  -- [TEST-MOD-APPROVED #3524] This check used to open with a single line:
  --
  --     before: r := public.claim_attendance_by_verified_identity(v_owner);
  --             IF (r->>'count')::int <> 1 THEN
  --               RAISE EXCEPTION 'I-04 owner claim was %', r; END IF;
  --
  --     after:  the SAME call is made THREE times against the SAME account and
  --             the SAME armed order, and the fixture adds exactly one piece of
  --             evidence between them. Nothing may move on the first two calls;
  --             the ticket must move on the third.
  --
  -- WHY IT CHANGED. The old line asserted only that the buyer gets their ticket,
  -- and under the rule in force at the time an account satisfied that by holding
  -- a `provider='email'` identity carrying the purchase address. Seth's decision
  -- on #3524 overturned that rule: an address match alone must never move a
  -- ticket. So a check that passes on an address match alone no longer states
  -- the rule this codebase enforces, and it is rewritten to state the new one.
  --
  -- The new shape is STRICTLY STRONGER. The old line could not fail when a
  -- predicate accepted too much - it asked only for a claim to succeed. These
  -- lines fail in BOTH directions: they fail if an unproved account is handed
  -- the ticket, and they fail if a proved account is refused it. Every other
  -- I-04 assertion below (unarmed, refunded, armed-then-refunded) is unchanged,
  -- character for character.
  --
  -- WHAT COUNTS AS PROOF, and why the flag cannot be the test. Measured
  -- read-only on production 2026-09-22: `identity_data->>'email_verified'` is
  -- true on 77 of 77 Google and 44 of 44 Apple identities and on 0 of 40 email
  -- identities - Supabase writes it false at signup and never revises it. So an
  -- email-provider account's only route is a GoTrue authentication that can
  -- only complete by reading the mailbox, which is recorded as an
  -- `otp`/`magiclink`/`recovery` row in `auth.mfa_amr_claims`.
  --
  -- THE ADDRESS MOVES FIRST, and it has to: `auth.users.email` is UNIQUE here
  -- exactly as it is in GoTrue, so the I-02/I-03 squatter and the I-04 real
  -- buyer cannot both carry 'buyer2217@example.test' in one instant. They are
  -- modelled in sequence; I-02 and I-03 have already run against the full
  -- adversarial shape, and nothing below re-tests the attacker.
  UPDATE auth.users SET email = NULL WHERE id = v_attacker;
  UPDATE auth.users SET email = 'buyer2217@example.test', email_confirmed_at = now()
   WHERE id = v_owner;

  -- ── I-04a KNOWING THE ADDRESS MOVES NOTHING.
  --    The owner now has the strongest shape the OLD rule recognised: the
  --    purchase address on `auth.users`, confirmed, plus a `provider='email'`
  --    identity carrying it. It must be handed nothing.
  --
  --    First prove this is a statement about the CLAIM PREDICATE and not about
  --    an empty identifier list - the sweep short-circuits when an account has
  --    proved nothing at all, and a refusal from that arm would measure nothing.
  SELECT count(*) INTO n FROM public.verified_account_identifiers(v_owner)
   WHERE kind = 'email' AND value = 'buyer2217@example.test';
  IF n <> 1 THEN
    RAISE EXCEPTION 'I-04a precondition lost: the owner address is no longer reported as an identifier, so the refusal below would not be the claim predicate';
  END IF;
  r := public.claim_attendance_by_verified_identity(v_owner);
  IF (r->>'count')::int <> 0 THEN
    RAISE EXCEPTION 'I-04a an account with no mailbox proof claimed %', r;
  END IF;
  IF EXISTS (SELECT 1 FROM public.orders
              WHERE id = pg_temp.i2217_uuid('o-email') AND buyer_user_id IS NOT NULL) THEN
    RAISE EXCEPTION 'I-04a the armed order moved on an address match alone';
  END IF;

  --    AND THE MARKETING SIDE IS UNTOUCHED, asserted on the SAME account in the
  --    SAME instant. `public.verified_account_identifiers` answers a DIFFERENT
  --    question - "can we reach this person by email?" - and any address on the
  --    account is the right answer to it. #1778's
  --    `issue_1778_circle_authorized_contact` is the reader that turns a silent
  --    "no identifier" into `channel_unavailable`, which is a brand's circle mail
  --    not being sent. So the account that was just refused the TICKET must
  --    still be REACHABLE, and this pair of assertions is what stops a future
  --    reader narrowing the shared function and quietly shrinking that reach.
  SELECT count(*) INTO n
    FROM public.issue_1778_circle_authorized_contact(
           pg_temp.i2217_uuid('brand'), v_owner, 'email')
   WHERE normalized_contact = 'buyer2217@example.test'
     AND reason <> 'channel_unavailable';
  IF n <> 1 THEN
    RAISE EXCEPTION 'I-04a an account with no mailbox proof lost its circle-mail contact - reachability is not an ownership proof and must not move with one';
  END IF;

  -- ── I-04b A PASSWORD SESSION IS NOT A MAILBOX PROOF, AND THE REFUSAL IS
  --    TRUTHFUL. The owner now also holds a session whose ONLY authentication
  --    method is `password`. On a project that confirms addresses without
  --    sending mail, completing a password sign-in says nothing about who can
  --    read the mailbox, so the answer must still be no.
  INSERT INTO auth.sessions(id, user_id)
  VALUES (pg_temp.i2217_uuid('s-owner-pw'), v_owner);
  INSERT INTO auth.mfa_amr_claims(session_id, authentication_method)
  VALUES (pg_temp.i2217_uuid('s-owner-pw'), 'password');

  r := public.claim_attendance_by_verified_identity(v_owner);
  IF (r->>'count')::int <> 0 THEN
    RAISE EXCEPTION 'I-04b a password-only session was accepted as a mailbox proof: %', r;
  END IF;
  IF EXISTS (SELECT 1 FROM public.orders
              WHERE id = pg_temp.i2217_uuid('o-email') AND buyer_user_id IS NOT NULL) THEN
    RAISE EXCEPTION 'I-04b the armed order moved on a password-only session';
  END IF;

  --    THE TOKEN RAIL, ON THE SAME ACCOUNT, IN THIS LANE. `o-token` carries a
  --    live claim-token digest and is never armed for the sweep. The refusal
  --    must be `identity_mismatch` - the one result that tells the holder of a
  --    genuinely valid link to go and prove the address - and never `invalid`,
  --    which would claim the link itself is no good. And it must consume
  --    NOTHING, or a single refused attempt would destroy the credential the
  --    rightful account still needs.
  SELECT o.attendance_claim_token_digest, o.attendance_claim_token_generation,
         o.attendance_claim_token_created_at
    INTO v_digest, v_generation, v_minted
    FROM public.orders o WHERE o.id = pg_temp.i2217_uuid('o-token');
  IF v_digest IS NULL THEN
    RAISE EXCEPTION 'I-04b fixture lost the token digest before the rail was called';
  END IF;
  r := public.claim_attendance_internal(
         v_owner, 'order', pg_temp.i2217_uuid('event'),
         pg_temp.i2217_uuid('o-token'), decode(repeat('22', 32), 'hex'));
  -- [TEST-MOD-APPROVED #3524] This line named the outcome; the outcome has since
  -- been split and this persona belongs to the other half.
  --
  --   before: r->>'result' <> 'identity_mismatch'  -> fail
  --   after:  r->>'result' must be 'contact_unproved', and must never be
  --           'invalid', 'ineligible' or 'identity_mismatch'.
  --
  -- WHY, AND WHY IT IS STRONGER. What this check has always been for is that a
  -- holder of a genuinely valid link is refused TRUTHFULLY and given something
  -- to do about it - never `invalid`, which would call their good link bad, and
  -- never silence. When it was written there was one such refusal, so naming it
  -- and naming the property were the same thing.
  --
  -- They are no longer. The owner here carries the purchase address on their own
  -- account and is short only a mailbox proof, so `identity_mismatch` - whose
  -- offered action is to sign out and return as somebody else - would send them
  -- in a circle. `contact_unproved` is the refusal they can act on. The old line
  -- passed on a refusal that offers this account nothing; this one does not, and
  -- it additionally excludes the two dead ends the old line already excluded.
  IF r->>'result' <> 'contact_unproved' THEN
    RAISE EXCEPTION 'I-04b the token rail answered % instead of contact_unproved - a valid link held by the account that owns the address must be refused in the form its holder can act on', r;
  END IF;
  IF r->>'result' IN ('invalid', 'ineligible', 'identity_mismatch') THEN
    RAISE EXCEPTION 'I-04b the token rail dead-ended a holder of a valid link: %', r;
  END IF;
  IF r->>'contactMasked' IS NULL OR r->>'contactChannel' <> 'email' THEN
    RAISE EXCEPTION 'I-04b the refusal lost the masked hint the sheet names the inbox with: %', r;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.orders o
     WHERE o.id = pg_temp.i2217_uuid('o-token')
       AND o.buyer_user_id IS NULL
       AND o.attendance_claim_token_digest = v_digest
       AND o.attendance_claim_token_generation IS NOT DISTINCT FROM v_generation
       AND o.attendance_claim_token_created_at IS NOT DISTINCT FROM v_minted
       AND o.attendance_claim_token_consumed_at IS NULL
  ) THEN
    RAISE EXCEPTION 'I-04b a refused claim consumed or mutated the token';
  END IF;

  -- ── I-04c THE PROOF ARRIVES AND THE TICKET FOLLOWS. One more row, and one
  --    only: a session whose authentication method is the email one-time code.
  --    `now()` is transaction-constant, so this session is no older than the
  --    identity it vouches for and the predicate's address binding holds.
  INSERT INTO auth.sessions(id, user_id)
  VALUES (pg_temp.i2217_uuid('s-owner-otp'), v_owner);
  INSERT INTO auth.mfa_amr_claims(session_id, authentication_method)
  VALUES (pg_temp.i2217_uuid('s-owner-otp'), 'otp');

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
  --
  --    #3524 — AND ON THE GoTrue IDENTITY ALONE. Assert the ledger row is
  --    absent FIRST, so this check cannot quietly start passing on the other
  --    proof: if a future fixture seeds one, this line fires rather than
  --    letting the claim below succeed for the wrong reason. The two proofs are
  --    not interchangeable in what they cover — 62 live accounts hold only
  --    this one, and with the provider disabled they can never hold the other.
  IF EXISTS (SELECT 1 FROM public.verified_phone_identities
              WHERE user_id = v_phoneuser) THEN
    RAISE EXCEPTION 'I-07 precondition lost: a ledger row would let this claim succeed without the GoTrue phone identity being read at all';
  END IF;
  r := public.claim_attendance_by_verified_identity(v_phoneuser);
  IF (r->>'count')::int <> 1 THEN
    RAISE EXCEPTION 'I-07 an account whose phone possession is recorded as a GoTrue identity was refused its own ticket: %', r;
  END IF;
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
