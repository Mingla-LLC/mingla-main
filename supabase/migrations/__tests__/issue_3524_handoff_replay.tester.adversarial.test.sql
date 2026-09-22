-- ===========================================================================
-- issue #3524 — TESTER ADVERSARIAL: the desktop scan code, attacked.
--
-- Seth's decision 5 point 4 says the QR must not carry a non-expiring bearer.
-- This file proves the replacement credential behaves like a credential:
--
--   A. a REDEEMED code is refused on the second use;
--   B. an EXPIRED code is refused even though it was never used;
--   C. minting a second code KILLS the first — one live code per order;
--   D. the 6-per-rolling-hour cap fires, and a 61-minute-old mint does not
--      count against it;
--   E. a code minted for order A cannot claim order B, and cannot be replayed
--      against a different event id even with the right order id;
--   F. the plaintext code never reaches the table — only its digest;
--   G. anon and authenticated hold no grant on the table or either RPC;
--   H. ** THE ONE THAT FAILS ** — a redemption refused with identity_mismatch
--      has ALREADY consumed the code, so the guest who signs out, signs in as
--      the purchase email and lets the sheet resume gets `invalid` rather than
--      their ticket. That is the exact journey R-14 and SC-3 exist to make
--      work, and on the scan rail it dead-ends.
--
-- FAILS ON REVERT: remove `consumed_at IS NULL` from the redeem lookup and A
-- goes red; remove `expires_at > now()` and B goes red; remove the
-- expire-prior-codes UPDATE from the mint and C goes red; remove the
-- take_attendance_claim_handoff_attempt call and D goes red.
-- ===========================================================================
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.h3524_uuid(seed text) RETURNS uuid
LANGUAGE sql IMMUTABLE AS $$
  SELECT (substr(md5('issue3524-handoff:'||seed),1,8)||'-'
       || substr(md5('issue3524-handoff:'||seed),9,4)||'-4'
       || substr(md5('issue3524-handoff:'||seed),14,3)||'-8'
       || substr(md5('issue3524-handoff:'||seed),18,3)||'-'
       || substr(md5('issue3524-handoff:'||seed),21,12))::uuid
$$;

CREATE TEMP TABLE h3524_failures(message text NOT NULL);

CREATE OR REPLACE FUNCTION pg_temp.h3524_expect(
  p_ok boolean, p_message text
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT coalesce(p_ok, false) THEN
    INSERT INTO h3524_failures(message) VALUES (p_message);
  END IF;
END;
$$;

-- The GoTrue arm, so the EMAIL half of the identity predicate executes here
-- too. Rolled back with the transaction.
DO $ident$
BEGIN
  IF to_regclass('auth.identities') IS NULL THEN
    EXECUTE $ddl$
      CREATE TABLE auth.identities(
        id            text NOT NULL,
        user_id       uuid NOT NULL,
        provider      text NOT NULL,
        identity_data jsonb NOT NULL DEFAULT '{}'::jsonb,
        -- #3524 REWORK (P1-1): `s.created_at >= i.updated_at` binds a mailbox
        -- proof to the address it proved. Both columns exist on the real GoTrue
        -- tables and are never NULL on a live row; `now()` is
        -- transaction-constant, so every fixture row below shares one instant
        -- and an honest persona satisfies the binding without stating it.
        updated_at    timestamptz NOT NULL DEFAULT now()
      )
    $ddl$;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'auth' AND table_name = 'users'
         AND column_name = 'phone'
    ) THEN
      EXECUTE 'ALTER TABLE auth.users ADD COLUMN phone text';
    END IF;
    -- #3524 REWORK (P0-1) — HOW the session was obtained is now part of the
    -- predicate, so the fixture has to be able to say it.
    --
    -- `account_owns_order_contact` no longer accepts the bare existence of a
    -- `provider='email'` identity, because this project runs
    -- `mailer_autoconfirm` and a public signup mints one for ANY address with
    -- no mail sent. It now requires positive evidence that the mailbox was
    -- actually reached: either the provider asserted `email_verified`, or
    -- GoTrue recorded an `otp`/`magiclink`/`recovery` authentication for the
    -- account. That record lives in `auth.mfa_amr_claims`, which — like
    -- `auth.identities` — does not exist on the CI image.
    --
    -- Standing these two up is what lets a RIGHTFUL buyer in this fixture be a
    -- buyer who genuinely read a code out of their mailbox. Not one assertion
    -- below changed; the fixture simply stopped describing an account that the
    -- hardened rule is right to refuse. Both tables roll back with this
    -- transaction.
    EXECUTE $ddl$
      CREATE TABLE auth.sessions(
        id         uuid PRIMARY KEY,
        user_id    uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    $ddl$;
    EXECUTE $ddl$
      CREATE TABLE auth.mfa_amr_claims(
        session_id            uuid NOT NULL,
        authentication_method text NOT NULL
      )
    $ddl$;
  END IF;
END;
$ident$;

SET session_replication_role = replica;

-- #3524 REWORK (P0-1) — see the stub block above. The buyer who scanned the
-- code proved their mailbox with an emailed one-time code; the stranger holding
-- the phone did not.
INSERT INTO auth.users(id, email) VALUES
  (pg_temp.h3524_uuid('creator'),  NULL),
  (pg_temp.h3524_uuid('buyer'),    'scan-buyer@example.test'),
  (pg_temp.h3524_uuid('stranger'), 'scan-stranger@example.test');

INSERT INTO auth.sessions(id, user_id) VALUES
  (pg_temp.h3524_uuid('sess-buyer'),    pg_temp.h3524_uuid('buyer')),
  (pg_temp.h3524_uuid('sess-stranger'), pg_temp.h3524_uuid('stranger'));
INSERT INTO auth.mfa_amr_claims(session_id, authentication_method) VALUES
  (pg_temp.h3524_uuid('sess-buyer'),    'otp'),
  (pg_temp.h3524_uuid('sess-stranger'), 'password');

INSERT INTO auth.identities(id, user_id, provider, identity_data) VALUES
  ('h3524-buyer', pg_temp.h3524_uuid('buyer'), 'email',
   jsonb_build_object('email', 'scan-buyer@example.test')),
  ('h3524-stranger', pg_temp.h3524_uuid('stranger'), 'email',
   jsonb_build_object('email', 'scan-stranger@example.test'));

INSERT INTO public.creator_accounts(id, email)
VALUES (pg_temp.h3524_uuid('creator'), 'issue3524-handoff-creator@example.test');

INSERT INTO public.brands(id, account_id, name, slug)
VALUES (pg_temp.h3524_uuid('brand'), pg_temp.h3524_uuid('creator'),
        'Issue 3524 Handoff', 'issue-3524-handoff');

INSERT INTO public.events(
  id, brand_id, created_by, title, slug, event_type, status, visibility,
  timezone, theme
) VALUES
  (pg_temp.h3524_uuid('event'), pg_temp.h3524_uuid('brand'),
   pg_temp.h3524_uuid('creator'), 'Handoff Event', 'issue-3524-handoff-event',
   'event', 'scheduled', 'public', 'UTC', '{}'::jsonb),
  (pg_temp.h3524_uuid('event2'), pg_temp.h3524_uuid('brand'),
   pg_temp.h3524_uuid('creator'), 'Handoff Event 2', 'issue-3524-handoff-two',
   'event', 'scheduled', 'public', 'UTC', '{}'::jsonb);

INSERT INTO public.ticket_types(
  id, event_id, name, price_cents, currency, quantity_total
) VALUES
  (pg_temp.h3524_uuid('tier'), pg_temp.h3524_uuid('event'),
   'General', 1000, 'USD', 50),
  (pg_temp.h3524_uuid('tier2'), pg_temp.h3524_uuid('event2'),
   'General', 1000, 'USD', 50);

INSERT INTO public.orders(
  id, event_id, buyer_email, buyer_name, total_cents, currency,
  payment_status, source, attendance_claim_token_digest,
  attendance_claim_token_generation, attendance_claim_token_created_at,
  attendance_identity_claim_armed_at
) VALUES
  (pg_temp.h3524_uuid('order-a'), pg_temp.h3524_uuid('event'),
   'scan-buyer@example.test', 'Scan Buyer', 1000, 'USD', 'paid', 'legacy',
   decode(repeat('aa', 32), 'hex'), 'governed_v2', now() - interval '1 day',
   now()),
  (pg_temp.h3524_uuid('order-b'), pg_temp.h3524_uuid('event2'),
   'scan-buyer@example.test', 'Scan Buyer', 1000, 'USD', 'paid', 'legacy',
   decode(repeat('bb', 32), 'hex'), 'governed_v2', now() - interval '1 day',
   now()),
  (pg_temp.h3524_uuid('order-c'), pg_temp.h3524_uuid('event'),
   'scan-buyer@example.test', 'Scan Buyer', 1000, 'USD', 'paid', 'legacy',
   decode(repeat('cc', 32), 'hex'), 'governed_v2', now() - interval '1 day',
   now()),
  (pg_temp.h3524_uuid('order-d'), pg_temp.h3524_uuid('event'),
   'scan-buyer@example.test', 'Scan Buyer', 1000, 'USD', 'paid', 'legacy',
   decode(repeat('dd', 32), 'hex'), 'governed_v2', now() - interval '1 day',
   now()),
  (pg_temp.h3524_uuid('order-e'), pg_temp.h3524_uuid('event'),
   'scan-buyer@example.test', 'Scan Buyer', 1000, 'USD', 'paid', 'legacy',
   decode(repeat('ee', 32), 'hex'), 'governed_v2', now() - interval '1 day',
   now());

INSERT INTO public.tickets(
  id, order_id, ticket_type_id, event_id, qr_code, status, approval_status
) VALUES
  (pg_temp.h3524_uuid('t-a'), pg_temp.h3524_uuid('order-a'),
   pg_temp.h3524_uuid('tier'), pg_temp.h3524_uuid('event'),
   'h3524-a', 'valid', 'auto'),
  (pg_temp.h3524_uuid('t-b'), pg_temp.h3524_uuid('order-b'),
   pg_temp.h3524_uuid('tier2'), pg_temp.h3524_uuid('event2'),
   'h3524-b', 'valid', 'auto'),
  (pg_temp.h3524_uuid('t-c'), pg_temp.h3524_uuid('order-c'),
   pg_temp.h3524_uuid('tier'), pg_temp.h3524_uuid('event'),
   'h3524-c', 'valid', 'auto'),
  (pg_temp.h3524_uuid('t-d'), pg_temp.h3524_uuid('order-d'),
   pg_temp.h3524_uuid('tier'), pg_temp.h3524_uuid('event'),
   'h3524-d', 'valid', 'auto'),
  (pg_temp.h3524_uuid('t-e'), pg_temp.h3524_uuid('order-e'),
   pg_temp.h3524_uuid('tier'), pg_temp.h3524_uuid('event'),
   'h3524-e', 'valid', 'auto');

SET session_replication_role = origin;

DO $harness$
DECLARE
  r jsonb;
  v_code bytea := decode(repeat('01', 32), 'hex');
  v_code2 bytea := decode(repeat('02', 32), 'hex');
  v_live integer;
  v_ok integer := 0;
  i integer;
BEGIN
  -- ── A. a redeemed code is refused on the second use ──────────────────────
  r := public.mint_attendance_claim_handoff(
         'order', pg_temp.h3524_uuid('event'), pg_temp.h3524_uuid('order-a'),
         decode(repeat('aa', 32), 'hex'), NULL, v_code, NULL);
  PERFORM pg_temp.h3524_expect(r->>'result' = 'minted',
    'A: minting must succeed for a live order, got '
      || coalesce(r->>'result', '(null)'));
  r := public.redeem_attendance_claim_handoff(
         pg_temp.h3524_uuid('buyer'), 'order', pg_temp.h3524_uuid('event'),
         pg_temp.h3524_uuid('order-a'), v_code);
  PERFORM pg_temp.h3524_expect(r->>'result' = 'claimed',
    'A: the rightful buyer must claim through the scan code, got '
      || coalesce(r->>'result', '(null)'));
  r := public.redeem_attendance_claim_handoff(
         pg_temp.h3524_uuid('buyer'), 'order', pg_temp.h3524_uuid('event'),
         pg_temp.h3524_uuid('order-a'), v_code);
  PERFORM pg_temp.h3524_expect(r->>'result' = 'invalid',
    'A: a REPLAYED code must be refused, got '
      || coalesce(r->>'result', '(null)'));

  -- ── A2. single-use, ISOLATED from the order's own token consumption.
  --
  -- A alone is not enough: after a successful claim the order's token digest is
  -- nulled, so a replay would be refused even with the single-use guard gone.
  -- Here the code is consumed while the ORDER is still perfectly claimable, so
  -- only `consumed_at IS NULL` in the redeem lookup can refuse it.
  r := public.mint_attendance_claim_handoff(
         'order', pg_temp.h3524_uuid('event'), pg_temp.h3524_uuid('order-e'),
         decode(repeat('ee', 32), 'hex'), NULL,
         decode(repeat('06', 32), 'hex'), NULL);
  PERFORM pg_temp.h3524_expect(r->>'result' = 'minted', 'A2: mint for order-e');
  UPDATE public.attendance_claim_handoffs SET consumed_at = now()
   WHERE source_id = pg_temp.h3524_uuid('order-e');
  r := public.redeem_attendance_claim_handoff(
         pg_temp.h3524_uuid('buyer'), 'order', pg_temp.h3524_uuid('event'),
         pg_temp.h3524_uuid('order-e'), decode(repeat('06', 32), 'hex'));
  PERFORM pg_temp.h3524_expect(r->>'result' = 'invalid',
    'A2: a code already marked consumed must be refused even though the order '
      || 'is still claimable, got ' || coalesce(r->>'result', '(null)'));
  PERFORM pg_temp.h3524_expect(
    (SELECT buyer_user_id IS NULL FROM public.orders
      WHERE id = pg_temp.h3524_uuid('order-e')),
    'A2: a refused replay must not have claimed the order anyway');

  -- ── B. an expired code is refused though never used ──────────────────────
  r := public.mint_attendance_claim_handoff(
         'order', pg_temp.h3524_uuid('event2'), pg_temp.h3524_uuid('order-b'),
         decode(repeat('bb', 32), 'hex'), NULL, v_code2, NULL);
  PERFORM pg_temp.h3524_expect(r->>'result' = 'minted', 'B: mint for order-b');
  PERFORM pg_temp.h3524_expect(
    (r->>'expiresAt')::timestamptz <= now() + interval '10 minutes'
      AND (r->>'expiresAt')::timestamptz > now() + interval '9 minutes',
    'B: the code must live exactly ten minutes, got '
      || coalesce(r->>'expiresAt', '(null)'));
  UPDATE public.attendance_claim_handoffs
     SET created_at = now() - interval '20 minutes',
         expires_at = now() - interval '10 minutes'
   WHERE source_id = pg_temp.h3524_uuid('order-b');
  r := public.redeem_attendance_claim_handoff(
         pg_temp.h3524_uuid('buyer'), 'order', pg_temp.h3524_uuid('event2'),
         pg_temp.h3524_uuid('order-b'), v_code2);
  PERFORM pg_temp.h3524_expect(r->>'result' = 'invalid',
    'B: an EXPIRED code must be refused, got '
      || coalesce(r->>'result', '(null)'));

  -- ── C. a second mint kills the first ─────────────────────────────────────
  PERFORM public.mint_attendance_claim_handoff(
    'order', pg_temp.h3524_uuid('event'), pg_temp.h3524_uuid('order-c'),
    decode(repeat('cc', 32), 'hex'), NULL, decode(repeat('03', 32), 'hex'), NULL);
  PERFORM public.mint_attendance_claim_handoff(
    'order', pg_temp.h3524_uuid('event'), pg_temp.h3524_uuid('order-c'),
    decode(repeat('cc', 32), 'hex'), NULL, decode(repeat('04', 32), 'hex'), NULL);
  SELECT count(*) INTO v_live FROM public.attendance_claim_handoffs
   WHERE source_id = pg_temp.h3524_uuid('order-c') AND consumed_at IS NULL;
  PERFORM pg_temp.h3524_expect(v_live = 1,
    'C: at most ONE live code per order — the screen the guest walked away '
      || 'from must be dead. Live codes: ' || v_live);
  r := public.redeem_attendance_claim_handoff(
         pg_temp.h3524_uuid('buyer'), 'order', pg_temp.h3524_uuid('event'),
         pg_temp.h3524_uuid('order-c'), decode(repeat('03', 32), 'hex'));
  PERFORM pg_temp.h3524_expect(r->>'result' = 'invalid',
    'C: the SUPERSEDED code must be refused, got '
      || coalesce(r->>'result', '(null)'));

  -- ── D. the 6-per-hour cap ────────────────────────────────────────────────
  DELETE FROM public.attendance_claim_handoffs
   WHERE source_id = pg_temp.h3524_uuid('order-d');
  v_ok := 0;
  FOR i IN 1..8 LOOP
    r := public.mint_attendance_claim_handoff(
           'order', pg_temp.h3524_uuid('event'), pg_temp.h3524_uuid('order-d'),
           decode(repeat('dd', 32), 'hex'), NULL,
           decode(repeat(lpad(to_hex(160 + i), 2, '0'), 32), 'hex'), NULL);
    IF r->>'result' = 'minted' THEN v_ok := v_ok + 1; END IF;
  END LOOP;
  PERFORM pg_temp.h3524_expect(v_ok = 6,
    'D: exactly six mints per rolling hour must succeed, got ' || v_ok);
  PERFORM pg_temp.h3524_expect(r->>'result' = 'rate_limited',
    'D: the seventh and eighth must be rate_limited, got '
      || coalesce(r->>'result', '(null)'));
  UPDATE public.attendance_claim_handoffs
     SET created_at = now() - interval '61 minutes',
         expires_at = now() - interval '51 minutes',
         consumed_at = NULL
   WHERE source_id = pg_temp.h3524_uuid('order-d');
  r := public.mint_attendance_claim_handoff(
         'order', pg_temp.h3524_uuid('event'), pg_temp.h3524_uuid('order-d'),
         decode(repeat('dd', 32), 'hex'), NULL,
         decode(repeat('f1', 32), 'hex'), NULL);
  PERFORM pg_temp.h3524_expect(r->>'result' = 'minted',
    'D: the window must ROLL — a 61-minute-old mint cannot still block, got '
      || coalesce(r->>'result', '(null)'));

  -- ── E. a code is bound to its own order AND its own event ────────────────
  PERFORM public.mint_attendance_claim_handoff(
    'order', pg_temp.h3524_uuid('event2'), pg_temp.h3524_uuid('order-b'),
    decode(repeat('bb', 32), 'hex'), NULL, decode(repeat('05', 32), 'hex'), NULL);
  r := public.redeem_attendance_claim_handoff(
         pg_temp.h3524_uuid('buyer'), 'order', pg_temp.h3524_uuid('event'),
         pg_temp.h3524_uuid('order-c'), decode(repeat('05', 32), 'hex'));
  PERFORM pg_temp.h3524_expect(r->>'result' = 'invalid',
    'E: order B''s code must not claim order C, got '
      || coalesce(r->>'result', '(null)'));
  r := public.redeem_attendance_claim_handoff(
         pg_temp.h3524_uuid('buyer'), 'order', pg_temp.h3524_uuid('event'),
         pg_temp.h3524_uuid('order-b'), decode(repeat('05', 32), 'hex'));
  PERFORM pg_temp.h3524_expect(r->>'result' = 'invalid',
    'E: the right order id under the WRONG event id must not redeem, got '
      || coalesce(r->>'result', '(null)'));

  -- ── F. plaintext never reaches the table ─────────────────────────────────
  PERFORM pg_temp.h3524_expect(
    NOT EXISTS (
      SELECT 1 FROM public.attendance_claim_handoffs
       WHERE octet_length(code_digest) <> 32),
    'F: every stored code must be a 32-byte digest and nothing else');

  -- ── G. the table and both RPCs are service-role only ─────────────────────
  PERFORM pg_temp.h3524_expect(
    NOT has_table_privilege('anon', 'public.attendance_claim_handoffs', 'SELECT')
      AND NOT has_table_privilege(
        'authenticated', 'public.attendance_claim_handoffs', 'SELECT')
      AND has_table_privilege(
        'service_role', 'public.attendance_claim_handoffs', 'SELECT'),
    'G: a new public table inherits anon grants — they must be stripped');
  PERFORM pg_temp.h3524_expect(
    (SELECT relrowsecurity FROM pg_class
      WHERE oid = 'public.attendance_claim_handoffs'::regclass),
    'G: row level security must be enabled on attendance_claim_handoffs');
  PERFORM pg_temp.h3524_expect(
    NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE schemaname = 'public'
                   AND tablename = 'attendance_claim_handoffs'),
    'G: no policy may exist — reads and writes are service-role only');
  PERFORM pg_temp.h3524_expect(
    NOT has_function_privilege('anon',
      'public.redeem_attendance_claim_handoff(uuid,text,uuid,uuid,bytea)',
      'EXECUTE')
    AND NOT has_function_privilege('authenticated',
      'public.mint_attendance_claim_handoff(text,uuid,uuid,bytea,bytea,bytea,text)',
      'EXECUTE'),
    'G: neither handoff RPC may be callable by anon or authenticated');

  -- ── H. THE JOURNEY THE DESIGN PROMISES, ON THE SCAN RAIL ─────────────────
  --
  -- A guest scans the code on a phone that is signed into the wrong account.
  -- The claim is refused identity_mismatch and the sheet tells them to sign
  -- out and sign in with the purchase address — R-14, SC-3. When they do, the
  -- pending claim resumes with the SAME stored credential.
  --
  -- On the token rail that works: a refusal consumes nothing (R-24). On this
  -- rail the code was already consumed before the claim body ever ran.
  DELETE FROM public.attendance_claim_handoffs
   WHERE source_id = pg_temp.h3524_uuid('order-d');
  UPDATE public.orders SET buyer_user_id = NULL
   WHERE id = pg_temp.h3524_uuid('order-d');
  PERFORM public.mint_attendance_claim_handoff(
    'order', pg_temp.h3524_uuid('event'), pg_temp.h3524_uuid('order-d'),
    decode(repeat('dd', 32), 'hex'), NULL, decode(repeat('07', 32), 'hex'), NULL);
  r := public.redeem_attendance_claim_handoff(
         pg_temp.h3524_uuid('stranger'), 'order', pg_temp.h3524_uuid('event'),
         pg_temp.h3524_uuid('order-d'), decode(repeat('07', 32), 'hex'));
  PERFORM pg_temp.h3524_expect(r->>'result' = 'identity_mismatch',
    'H: the wrong account must be refused identity_mismatch on the scan rail '
      || 'too, got ' || coalesce(r->>'result', '(null)'));
  PERFORM pg_temp.h3524_expect(
    (SELECT consumed_at IS NULL FROM public.attendance_claim_handoffs
      WHERE source_id = pg_temp.h3524_uuid('order-d')
      ORDER BY created_at DESC LIMIT 1),
    'H: a refusal must CONSUME NOTHING. The scan code was consumed before the '
      || 'claim body ran, so the guest who signs out and signs in as the '
      || 'purchase address — the exact journey R-14 and SC-3 describe — '
      || 'resumes with a dead credential.');
  r := public.redeem_attendance_claim_handoff(
         pg_temp.h3524_uuid('buyer'), 'order', pg_temp.h3524_uuid('event'),
         pg_temp.h3524_uuid('order-d'), decode(repeat('07', 32), 'hex'));
  PERFORM pg_temp.h3524_expect(r->>'result' = 'claimed',
    'H: after the mismatch, the RIGHTFUL account resuming the pending claim '
      || 'with the same code must still land the ticket — got '
      || coalesce(r->>'result', '(null)')
      || '. The sheet renders that as a dead link, not as "get a new code".');
END;
$harness$;

DO $verdict$
DECLARE v_count integer; v_all text;
BEGIN
  SELECT count(*), string_agg(message, E'\n  - ') INTO v_count, v_all
    FROM h3524_failures;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'issue #3524 tester adversarial (handoff replay): % failure(s):%  - %',
      v_count, E'\n', v_all;
  END IF;
  RAISE NOTICE 'issue #3524 tester adversarial (handoff replay): all assertions passed';
END;
$verdict$;

ROLLBACK;
