-- Issue #2269 — EXECUTED proof that a Twilio-verified phone claims the ticket
-- no matter which provider the account signed in with, and that a phone the
-- claimant merely TYPED claims nothing.
--
-- WHY THIS FILE EXECUTES SQL. Same reason as #2217's suite: the decision moves
-- a PAID ASSET between accounts. Every check below runs the real RPCs against
-- the real applied migration chain and reads real `orders` rows. Each check
-- RAISEs on failure; the psql exit code is the verdict.
--
-- THE CHECK THAT MATTERS MOST IS P-03. `typist` is a Google-only account whose
-- `profiles.phone` IS the buyer's number — the exact shape a "just read
-- profiles.phone" implementation would accept, and a shape ANY signed-in user
-- can create for themselves, because `authenticated` holds a column-level
-- UPDATE grant on `profiles.phone` and the RLS policy is only
-- `USING (auth.uid() = id)`. It must be handed nothing.
\set ON_ERROR_STOP on

-- Namespaced for the same reason #2217 namespaces: #871 and #2217 use the same
-- md5-of-seed uuid scheme with overlapping seed words, and all three suites run
-- against one database in this lane. An un-prefixed seed collides byte-exactly
-- and the failure reads like a real regression.
CREATE OR REPLACE FUNCTION pg_temp.i2269_uuid(raw_seed text) RETURNS uuid
LANGUAGE sql IMMUTABLE AS $$
  SELECT (
    substr(md5('issue-2269:'||raw_seed),1,8)||'-'||
    substr(md5('issue-2269:'||raw_seed),9,4)||'-4'||
    substr(md5('issue-2269:'||raw_seed),14,3)||'-8'||
    substr(md5('issue-2269:'||raw_seed),18,3)||'-'||
    substr(md5('issue-2269:'||raw_seed),21,12)
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

-- RE-RUNNABLE BY CONSTRUCTION. This lane applies the migration chain once and
-- then runs several suites against ONE database, and the founder's gate re-runs
-- this file against that non-virgin database. A suite that only passes on a
-- virgin DB reports `users_pkey` on the second run, and that failure reads
-- exactly like a real regression. Everything below is namespaced under
-- 'issue-2269:', so removing it removes precisely this suite's own fixture and
-- nothing any sibling suite owns. FK triggers are already disabled by the SET
-- above, so the order here does not matter.
DO $teardown$
DECLARE
  v_users uuid[] := ARRAY(
    SELECT pg_temp.i2269_uuid(s) FROM unnest(ARRAY[
      'creator','googler','appler','typist','guesser','both','loser']) s);
  v_orders uuid[] := ARRAY(
    SELECT pg_temp.i2269_uuid('o-'||s) FROM unnest(ARRAY[
      'google','apple','both','unarmed','moved']) s);
BEGIN
  DELETE FROM public.pending_trip_chat_claims WHERE order_id = ANY(v_orders);
  DELETE FROM public.tickets WHERE order_id = ANY(v_orders);
  DELETE FROM public.orders WHERE id = ANY(v_orders);
  DELETE FROM public.conversation_participants WHERE conversation_id = pg_temp.i2269_uuid('conv');
  DELETE FROM public.conversations WHERE id = pg_temp.i2269_uuid('conv');
  DELETE FROM public.ticket_types WHERE id = pg_temp.i2269_uuid('tier');
  DELETE FROM public.events WHERE id = pg_temp.i2269_uuid('event');
  DELETE FROM public.brands WHERE id = pg_temp.i2269_uuid('brand');
  DELETE FROM public.creator_accounts WHERE id = pg_temp.i2269_uuid('creator');
  DELETE FROM public.verified_phone_identities WHERE user_id = ANY(v_users);
  DELETE FROM public.profiles WHERE id = ANY(v_users);
  DELETE FROM auth.identities WHERE user_id = ANY(v_users);
  DELETE FROM auth.users WHERE id = ANY(v_users);
END $teardown$;

INSERT INTO auth.users(id) VALUES
  (pg_temp.i2269_uuid('creator')),
  (pg_temp.i2269_uuid('googler')),
  (pg_temp.i2269_uuid('appler')),
  (pg_temp.i2269_uuid('typist')),
  (pg_temp.i2269_uuid('guesser')),
  (pg_temp.i2269_uuid('both')),
  (pg_temp.i2269_uuid('loser'));

-- THE ADVERSARIAL SHAPES.
-- `guesser` holds auth.users.phone = the buyer's number WITH phone_confirmed_at
-- set — the column 128 of 128 production accounts already have — and NO
-- identity and NO ledger row.
UPDATE auth.users SET phone='15550002269', phone_confirmed_at=now()
 WHERE id = pg_temp.i2269_uuid('guesser');

INSERT INTO auth.identities(user_id, provider, provider_id, identity_data) VALUES
  -- Google-only, mailbox asserted. This is the #2269 acceptance shape: the
  -- account signed in with Google and verified a phone at onboarding.
  (pg_temp.i2269_uuid('googler'), 'google', 'google-2269',
   '{"email":"googler2269@example.test","email_verified":true}'::jsonb),
  -- Apple-only, private relay: the address can NEVER match a checkout email,
  -- so the phone arm is the only thing that can reach this buyer.
  (pg_temp.i2269_uuid('appler'), 'apple', 'apple-2269',
   '{"email":"relay2269@privaterelay.appleid.test","email_verified":true}'::jsonb),
  -- Google-only. profiles.phone will be set to the buyer's number; nothing else.
  (pg_temp.i2269_uuid('typist'), 'google', 'typist-2269',
   '{"email":"typist2269@example.test","email_verified":true}'::jsonb),
  -- Google-only, phone_confirmed_at set, no phone identity, no ledger row.
  (pg_temp.i2269_uuid('guesser'), 'google', 'guesser-2269',
   '{"email":"guesser2269@example.test","email_verified":true}'::jsonb),
  -- Holds BOTH a GoTrue phone identity and (later) a ledger row for the SAME
  -- number. The UNION must still yield exactly one identifier.
  (pg_temp.i2269_uuid('both'), 'google', 'both-2269',
   '{"email":"both2269@example.test","email_verified":true}'::jsonb),
  (pg_temp.i2269_uuid('both'), 'phone', 'both-phone-2269',
   '{"phone":"15550002271","phone_verified":false}'::jsonb),
  (pg_temp.i2269_uuid('loser'), 'google', 'loser-2269',
   '{"email":"loser2269@example.test","email_verified":true}'::jsonb);
UPDATE auth.users SET phone='15550002271' WHERE id = pg_temp.i2269_uuid('both');

INSERT INTO public.creator_accounts(id, email)
VALUES (pg_temp.i2269_uuid('creator'), 'i2269-creator@example.test');
INSERT INTO public.brands(id, account_id, name, slug)
VALUES (pg_temp.i2269_uuid('brand'), pg_temp.i2269_uuid('creator'), 'Issue 2269', 'issue-2269');
INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone, theme)
VALUES (pg_temp.i2269_uuid('event'), pg_temp.i2269_uuid('brand'), pg_temp.i2269_uuid('creator'),
        'Issue 2269 Event', 'issue-2269-event', 'event', 'scheduled', 'public', 'UTC', '{}'::jsonb);
INSERT INTO public.ticket_types(id, event_id, name, price_cents, currency, quantity_total)
VALUES (pg_temp.i2269_uuid('tier'), pg_temp.i2269_uuid('event'), 'General', 1000, 'USD', 1000);
INSERT INTO public.conversations(id, type, linked_entity_type, event_id, name, created_by, is_enabled, is_broadcast_only)
VALUES (pg_temp.i2269_uuid('conv'), 'group', 'event', pg_temp.i2269_uuid('event'),
        'Issue 2269 Event', pg_temp.i2269_uuid('creator'), true, false);

-- Guest orders. Every buyer_email is an address NO fixture account owns, so a
-- match can only ever come through the PHONE arm — otherwise these checks would
-- pass on #2217's email fallback and prove nothing about #2269.
INSERT INTO public.orders(id, event_id, buyer_email, buyer_phone_e164, buyer_name,
                          total_cents, currency, payment_status, source)
VALUES
  (pg_temp.i2269_uuid('o-google'),  pg_temp.i2269_uuid('event'), 'guest-a-2269@example.test', '+15550002269', 'Google Buyer', 1000,'USD','paid','legacy'),
  (pg_temp.i2269_uuid('o-apple'),   pg_temp.i2269_uuid('event'), 'guest-b-2269@example.test', '+15550002270', 'Apple Buyer',  1000,'USD','paid','legacy'),
  (pg_temp.i2269_uuid('o-both'),    pg_temp.i2269_uuid('event'), 'guest-c-2269@example.test', '+15550002271', 'Both Buyer',   1000,'USD','paid','legacy'),
  (pg_temp.i2269_uuid('o-unarmed'), pg_temp.i2269_uuid('event'), 'guest-d-2269@example.test', '+15550002272', 'Unarmed',      1000,'USD','paid','legacy'),
  (pg_temp.i2269_uuid('o-moved'),   pg_temp.i2269_uuid('event'), 'guest-e-2269@example.test', '+15550002273', 'Moved Number', 1000,'USD','paid','legacy');

INSERT INTO public.tickets(id, order_id, ticket_type_id, event_id, qr_code, status, approval_status)
SELECT pg_temp.i2269_uuid('t-'||tag), pg_temp.i2269_uuid('o-'||tag), pg_temp.i2269_uuid('tier'),
       pg_temp.i2269_uuid('event'), 'qr-2269-'||tag, 'valid', 'auto'
  FROM unnest(ARRAY['google','apple','both','unarmed','moved']) tag;

-- profiles.phone is set for `typist` ONLY. It is the client-writable column,
-- and P-03 proves it entitles nothing.
INSERT INTO public.profiles(id, phone) VALUES
  (pg_temp.i2269_uuid('typist'), '+15550002269')
ON CONFLICT (id) DO UPDATE SET phone = EXCLUDED.phone;

SET session_replication_role = origin;

DO $test$
DECLARE
  r jsonb;
  n integer;
  v_googler uuid := pg_temp.i2269_uuid('googler');
  v_appler  uuid := pg_temp.i2269_uuid('appler');
  v_typist  uuid := pg_temp.i2269_uuid('typist');
  v_guesser uuid := pg_temp.i2269_uuid('guesser');
  v_both    uuid := pg_temp.i2269_uuid('both');
  v_loser   uuid := pg_temp.i2269_uuid('loser');
BEGIN
  -- Arm the orders that are meant to be claimable. `o-unarmed` never is.
  PERFORM public.arm_order_identity_attendance_claim(pg_temp.i2269_uuid('o-google'), pg_temp.i2269_uuid('event'));
  PERFORM public.arm_order_identity_attendance_claim(pg_temp.i2269_uuid('o-apple'),  pg_temp.i2269_uuid('event'));
  PERFORM public.arm_order_identity_attendance_claim(pg_temp.i2269_uuid('o-both'),   pg_temp.i2269_uuid('event'));
  PERFORM public.arm_order_identity_attendance_claim(pg_temp.i2269_uuid('o-moved'),  pg_temp.i2269_uuid('event'));

  -- ── P-01 record_verified_phone validates, normalizes, and refuses junk.
  r := public.record_verified_phone(v_googler, 'not-a-phone');
  IF r->>'result' <> 'invalid' THEN RAISE EXCEPTION 'P-01a junk phone was recorded: %', r; END IF;
  r := public.record_verified_phone(NULL, '+15550002269');
  IF r->>'result' <> 'invalid' THEN RAISE EXCEPTION 'P-01b null user was recorded: %', r; END IF;
  r := public.record_verified_phone(pg_temp.i2269_uuid('ghost'), '+15550009999');
  IF r->>'result' <> 'unknown_user' THEN RAISE EXCEPTION 'P-01c unknown user was recorded: %', r; END IF;
  -- Twilio hands us E.164; a caller that strips the + must still land correctly.
  r := public.record_verified_phone(v_googler, '15550002269');
  IF r->>'result' <> 'recorded' OR r->>'phone' <> '+15550002269' THEN
    RAISE EXCEPTION 'P-01d bare digits were not normalized to E.164: %', r;
  END IF;

  -- ── P-02 THE ACCEPTANCE CASE. A GOOGLE-ONLY account, no phone identity, no
  --    auth.users.phone — exactly the population #2269 is about — claims the
  --    order its Twilio-verified number bought.
  IF EXISTS (SELECT 1 FROM auth.identities WHERE user_id = v_googler AND provider = 'phone') THEN
    RAISE EXCEPTION 'P-02 fixture drift: googler must have NO phone identity';
  END IF;
  SELECT count(*) INTO n FROM public.verified_account_identifiers(v_googler)
   WHERE kind = 'phone' AND value = '+15550002269';
  IF n <> 1 THEN RAISE EXCEPTION 'P-02 ledger phone did not surface for a Google-only account (got %)', n; END IF;
  r := public.claim_attendance_by_verified_identity(v_googler);
  IF (r->>'count')::int <> 1 THEN RAISE EXCEPTION 'P-02 google claim was %', r; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.orders
                  WHERE id = pg_temp.i2269_uuid('o-google') AND buyer_user_id = v_googler) THEN
    RAISE EXCEPTION 'P-02 the order did not transfer to the Google account';
  END IF;

  -- ── P-03 THE NEGATIVE THAT DEFINES THE FIX.
  --    `typist` has profiles.phone = the SAME number, and nothing else. Any
  --    signed-in user can write that column for themselves. It must claim
  --    NOTHING — and, because the order above already moved, prove it on a
  --    still-unclaimed order too.
  SELECT count(*) INTO n FROM public.verified_account_identifiers(v_typist) WHERE kind = 'phone';
  IF n <> 0 THEN RAISE EXCEPTION 'P-03a profiles.phone leaked as a verified identifier (got %)', n; END IF;
  UPDATE public.profiles SET phone = '+15550002273' WHERE id = v_typist;
  SELECT count(*) INTO n FROM public.verified_account_identifiers(v_typist) WHERE kind = 'phone';
  IF n <> 0 THEN RAISE EXCEPTION 'P-03b profiles.phone leaked after being retyped (got %)', n; END IF;
  r := public.claim_attendance_by_verified_identity(v_typist);
  IF (r->>'count')::int <> 0 THEN RAISE EXCEPTION 'P-03c a typed profiles.phone claimed %', r; END IF;
  IF EXISTS (SELECT 1 FROM public.orders
              WHERE id = pg_temp.i2269_uuid('o-moved') AND buyer_user_id IS NOT NULL) THEN
    RAISE EXCEPTION 'P-03d a typed profiles.phone took ownership of an order';
  END IF;

  -- ── P-04 A GUESSED NUMBER CLAIMS NOTHING. `guesser` holds
  --    auth.users.phone = the buyer's number WITH phone_confirmed_at set, the
  --    shape all 128 production accounts have, and no identity/ledger row.
  SELECT count(*) INTO n FROM public.verified_account_identifiers(v_guesser) WHERE kind = 'phone';
  IF n <> 0 THEN RAISE EXCEPTION 'P-04a a confirmed-but-unproven phone leaked as verified (got %)', n; END IF;
  r := public.claim_attendance_by_verified_identity(v_guesser);
  IF (r->>'count')::int <> 0 THEN RAISE EXCEPTION 'P-04b a guessed phone claimed %', r; END IF;

  -- ── P-05 Apple private relay: the email arm CANNOT reach this buyer, so this
  --    isolates the phone arm completely.
  PERFORM public.record_verified_phone(v_appler, '+15550002270');
  r := public.claim_attendance_by_verified_identity(v_appler);
  IF (r->>'count')::int <> 1 THEN RAISE EXCEPTION 'P-05 apple relay claim was %', r; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.orders
                  WHERE id = pg_temp.i2269_uuid('o-apple') AND buyer_user_id = v_appler) THEN
    RAISE EXCEPTION 'P-05 the order did not transfer to the Apple account';
  END IF;

  -- ── P-06 BOTH records for one number yield exactly ONE identifier.
  --    #2217's I-03 asserts count = 1; a RETURN QUERY that appended instead of
  --    UNIONing would return 2 here and break that suite from a distance.
  PERFORM public.record_verified_phone(v_both, '+15550002271');
  SELECT count(*) INTO n FROM public.verified_account_identifiers(v_both)
   WHERE kind = 'phone' AND value = '+15550002271';
  IF n <> 1 THEN RAISE EXCEPTION 'P-06 identity + ledger for one number returned % rows', n; END IF;
  r := public.claim_attendance_by_verified_identity(v_both);
  IF (r->>'count')::int <> 1 THEN RAISE EXCEPTION 'P-06 dual-record claim was %', r; END IF;

  -- ── P-07 ONE LIVE OWNER PER NUMBER. A recycled number must stop entitling
  --    the previous account the moment the new one proves it.
  PERFORM public.record_verified_phone(v_loser, '+15550002273');
  SELECT count(*) INTO n FROM public.verified_account_identifiers(v_loser)
   WHERE kind = 'phone' AND value = '+15550002273';
  IF n <> 1 THEN RAISE EXCEPTION 'P-07a loser did not receive the number'; END IF;
  -- The SAME number is now proven by googler, who already held a different one.
  PERFORM public.record_verified_phone(v_googler, '+15550002273');
  SELECT count(*) INTO n FROM public.verified_account_identifiers(v_loser) WHERE kind = 'phone';
  IF n <> 0 THEN RAISE EXCEPTION 'P-07b the previous owner kept the recycled number (got %)', n; END IF;
  SELECT count(*) INTO n FROM public.verified_phone_identities WHERE user_id = v_googler;
  IF n <> 1 THEN RAISE EXCEPTION 'P-07c an account accumulated % ledger rows', n; END IF;
  -- googler's OLD number must stop entitling as well — one live number, not a
  -- growing set of claims.
  SELECT count(*) INTO n FROM public.verified_account_identifiers(v_googler)
   WHERE kind = 'phone' AND value = '+15550002269';
  IF n <> 0 THEN RAISE EXCEPTION 'P-07d a superseded number still entitles'; END IF;

  -- ── P-08 the widened arm does NOT bypass any other #2217 gate. `o-unarmed`
  --    carries a number now proven by loser, and must not move.
  PERFORM public.record_verified_phone(v_loser, '+15550002272');
  r := public.claim_attendance_by_verified_identity(v_loser);
  IF (r->>'count')::int <> 0 THEN RAISE EXCEPTION 'P-08a an UNARMED order was claimed on a ledger phone: %', r; END IF;
  IF EXISTS (SELECT 1 FROM public.orders
              WHERE id = pg_temp.i2269_uuid('o-unarmed') AND buyer_user_id IS NOT NULL) THEN
    RAISE EXCEPTION 'P-08b an UNARMED order transferred';
  END IF;
  -- And a refunded ARMED order stays put.
  UPDATE public.orders SET payment_status='refunded' WHERE id = pg_temp.i2269_uuid('o-moved');
  PERFORM public.record_verified_phone(v_loser, '+15550002273');
  r := public.claim_attendance_by_verified_identity(v_loser);
  IF (r->>'count')::int <> 0 THEN RAISE EXCEPTION 'P-08c a refunded order was claimed: %', r; END IF;

  -- ── P-09 the EMAIL arm is untouched by #2269.
  SELECT count(*) INTO n FROM public.verified_account_identifiers(v_googler)
   WHERE kind = 'email' AND value = 'googler2269@example.test';
  IF n <> 1 THEN RAISE EXCEPTION 'P-09a the IdP-asserted email arm regressed (got %)', n; END IF;
  SELECT count(*) INTO n FROM public.verified_account_identifiers(v_appler)
   WHERE kind = 'email' AND value = 'relay2269@privaterelay.appleid.test';
  IF n <> 1 THEN RAISE EXCEPTION 'P-09b the apple relay email arm regressed (got %)', n; END IF;

  -- ── P-10 idempotent. A second sweep claims nothing and breaks nothing.
  r := public.claim_attendance_by_verified_identity(v_appler);
  IF (r->>'count')::int <> 0 THEN RAISE EXCEPTION 'P-10 re-sweep claimed % again', r; END IF;

  RAISE NOTICE '#2269 P-01..P-10 all passed';
END $test$;

-- ── P-11 THE LEDGER IS NOT CLIENT-WRITABLE. Asserted on the catalog, because a
--    role-switching test cannot run in the same transaction as the DO block
--    above. If any of these three locks is removed, `authenticated` can write
--    its own possession proof and the whole model collapses to knowledge.
DO $grants$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM information_schema.role_table_grants
   WHERE table_schema='public' AND table_name='verified_phone_identities'
     AND grantee IN ('anon','authenticated','PUBLIC');
  IF n <> 0 THEN RAISE EXCEPTION 'P-11a anon/authenticated hold % grants on the ledger', n; END IF;

  SELECT count(*) INTO n FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace
   WHERE ns.nspname='public' AND c.relname='verified_phone_identities'
     AND c.relrowsecurity AND c.relforcerowsecurity;
  IF n <> 1 THEN RAISE EXCEPTION 'P-11b RLS is not ENABLEd+FORCEd on the ledger'; END IF;

  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname='public' AND tablename='verified_phone_identities';
  IF n <> 0 THEN RAISE EXCEPTION 'P-11c the ledger grew % RLS policies', n; END IF;

  SELECT count(*) INTO n FROM information_schema.role_routine_grants
   WHERE routine_schema='public' AND routine_name='record_verified_phone'
     AND grantee IN ('anon','authenticated','PUBLIC');
  IF n <> 0 THEN RAISE EXCEPTION 'P-11d anon/authenticated can EXECUTE record_verified_phone'; END IF;

  RAISE NOTICE '#2269 P-11 ledger is service-role only';
END $grants$;
