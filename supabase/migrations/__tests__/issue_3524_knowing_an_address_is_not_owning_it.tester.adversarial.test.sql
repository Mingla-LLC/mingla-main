-- ===========================================================================
-- issue #3524 — TESTER ADVERSARIAL, RETEST: the HARDENED identity predicate.
--
-- The first round of this test proved a forwarded email cannot take a ticket.
-- It could not prove the thing underneath it: that the account being trusted
-- had actually reached the purchase mailbox. This project runs
-- `mailer_autoconfirm`, so a free public signup mints a confirmed
-- `provider='email'` identity for ANY address with no mail sent — and the old
-- predicate accepted exactly that.
--
-- `public.account_owns_order_contact` now demands POSITIVE EVIDENCE. This file
-- attacks the new rule from every side I can reach:
--
--   A. the free-signup shape — identity + own users.email + `password` amr and
--      nothing else — is REFUSED;
--   B. the same account with an `otp` amr is ACCEPTED (the real guest);
--   C. `magiclink` and `recovery` are accepted; `oauth`, `totp`, `invite`,
--      `email_change`, `sso/saml`, `token_refresh` and `anonymous` are NOT —
--      the accepted set is exactly the three that require a mailbox;
--   D. an `otp` amr belonging to SOMEBODY ELSE'S session does not carry over;
--   E. the identity's address must also be the account's OWN `auth.users.email`;
--   F. a provider-asserted `email_verified` (the Google/Apple shape) is accepted
--      with no amr at all — the arm that must not have been broken;
--   G. FAILS CLOSED: with `auth.mfa_amr_claims` absent, an otherwise-perfect
--      account is refused, and the phone arm still answers;
--   H. the phone arm is untouched by all of it;
--   I. the identity RAIL now runs the same predicate, so the password-only
--      account is not swept up by `claim_attendance_by_verified_identity`
--      either — the hole was never only in the token rail;
--   J. ** THE ONE THAT FAILS ** — the mailbox proof is not bound to the address
--      it proved. An account that read a code at its OWN address, and later
--      carries a different address, still satisfies the predicate on the
--      strength of the earlier proof.
--
-- FAILS ON REVERT: restore the old one-line `EXISTS(verified_account_identifiers
-- …)` body and A, C, D, E and I go red together.
-- ===========================================================================
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.k3524_uuid(seed text) RETURNS uuid
LANGUAGE sql IMMUTABLE AS $$
  SELECT (substr(md5('issue3524-knowing:'||seed),1,8)||'-'
       || substr(md5('issue3524-knowing:'||seed),9,4)||'-4'
       || substr(md5('issue3524-knowing:'||seed),14,3)||'-8'
       || substr(md5('issue3524-knowing:'||seed),18,3)||'-'
       || substr(md5('issue3524-knowing:'||seed),21,12))::uuid
$$;

CREATE TEMP TABLE k3524_failures(message text NOT NULL);

CREATE OR REPLACE FUNCTION pg_temp.k3524_expect(
  p_ok boolean, p_message text
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT coalesce(p_ok, false) THEN
    INSERT INTO k3524_failures(message) VALUES (p_message);
  END IF;
END;
$$;

-- Stand GoTrue up locally. All three tables are absent from the
-- supabase/postgres CI image; without them the email arm cannot execute at all
-- and every assertion below would pass by never running.
DO $ident$
BEGIN
  IF to_regclass('auth.identities') IS NULL THEN
    EXECUTE $ddl$
      CREATE TABLE auth.identities(
        id text NOT NULL, user_id uuid NOT NULL, provider text NOT NULL,
        identity_data jsonb NOT NULL DEFAULT '{}'::jsonb)
    $ddl$;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema='auth' AND table_name='users' AND column_name='phone'
    ) THEN EXECUTE 'ALTER TABLE auth.users ADD COLUMN phone text'; END IF;
    EXECUTE $ddl$
      CREATE TABLE auth.sessions(id uuid PRIMARY KEY, user_id uuid NOT NULL)
    $ddl$;
    EXECUTE $ddl$
      CREATE TABLE auth.mfa_amr_claims(
        session_id uuid NOT NULL, authentication_method text NOT NULL)
    $ddl$;
  END IF;
END;
$ident$;

SET session_replication_role = replica;

-- Everyone below claims the SAME purchase address. What separates them is only
-- what they can prove about it.
-- `auth.users.email` is UNIQUE, in GoTrue and here, so only ONE account can
-- carry the purchase address at a time. That is realistic and it matters: the
-- guest this issue is about has NO Mingla account, so the address is unclaimed
-- and any account may take it. Each persona therefore holds its own address and
-- BECOMES the buyer, one at a time, through pg_temp.k3524_become_buyer().
INSERT INTO auth.users(id, email) VALUES
  (pg_temp.k3524_uuid('creator'),   NULL),
  (pg_temp.k3524_uuid('freesignup'),'p-free@example.test'),
  (pg_temp.k3524_uuid('realguest'), 'p-real@example.test'),
  (pg_temp.k3524_uuid('magic'),     'p-magic@example.test'),
  (pg_temp.k3524_uuid('recover'),   'p-recover@example.test'),
  (pg_temp.k3524_uuid('oauthonly'), 'p-oauth@example.test'),
  (pg_temp.k3524_uuid('totponly'),  'p-totp@example.test'),
  (pg_temp.k3524_uuid('invited'),   'p-invite@example.test'),
  (pg_temp.k3524_uuid('changed'),   'p-change@example.test'),
  (pg_temp.k3524_uuid('borrower'),  'p-borrow@example.test'),
  (pg_temp.k3524_uuid('mismatched'),'p-mismatch@example.test'),
  (pg_temp.k3524_uuid('google'),    'p-google@example.test'),
  (pg_temp.k3524_uuid('phoneonly'), NULL),
  (pg_temp.k3524_uuid('carryover'), 'p-carry@example.test');

INSERT INTO auth.identities(id, user_id, provider, identity_data) VALUES
  ('k-free',   pg_temp.k3524_uuid('freesignup'),'email', jsonb_build_object('email','p-free@example.test')),
  ('k-real',   pg_temp.k3524_uuid('realguest'), 'email', jsonb_build_object('email','p-real@example.test')),
  ('k-magic',  pg_temp.k3524_uuid('magic'),     'email', jsonb_build_object('email','p-magic@example.test')),
  ('k-recov',  pg_temp.k3524_uuid('recover'),   'email', jsonb_build_object('email','p-recover@example.test')),
  ('k-oauth',  pg_temp.k3524_uuid('oauthonly'), 'email', jsonb_build_object('email','p-oauth@example.test')),
  ('k-totp',   pg_temp.k3524_uuid('totponly'),  'email', jsonb_build_object('email','p-totp@example.test')),
  ('k-invite', pg_temp.k3524_uuid('invited'),   'email', jsonb_build_object('email','p-invite@example.test')),
  ('k-change', pg_temp.k3524_uuid('changed'),   'email', jsonb_build_object('email','p-change@example.test')),
  ('k-borrow', pg_temp.k3524_uuid('borrower'),  'email', jsonb_build_object('email','p-borrow@example.test')),
  ('k-mis',    pg_temp.k3524_uuid('mismatched'),'email', jsonb_build_object('email','p-mismatch@example.test')),
  -- The Google shape: the PROVIDER asserts the address. No amr needed.
  ('k-google', pg_temp.k3524_uuid('google'),    'google',
     jsonb_build_object('email','p-google@example.test','email_verified','true')),
  ('k-carry',  pg_temp.k3524_uuid('carryover'), 'email', jsonb_build_object('email','p-carry@example.test'));

INSERT INTO auth.sessions(id, user_id) VALUES
  (pg_temp.k3524_uuid('s-free'),   pg_temp.k3524_uuid('freesignup')),
  (pg_temp.k3524_uuid('s-real'),   pg_temp.k3524_uuid('realguest')),
  (pg_temp.k3524_uuid('s-magic'),  pg_temp.k3524_uuid('magic')),
  (pg_temp.k3524_uuid('s-recov'),  pg_temp.k3524_uuid('recover')),
  (pg_temp.k3524_uuid('s-oauth'),  pg_temp.k3524_uuid('oauthonly')),
  (pg_temp.k3524_uuid('s-totp'),   pg_temp.k3524_uuid('totponly')),
  (pg_temp.k3524_uuid('s-invite'), pg_temp.k3524_uuid('invited')),
  (pg_temp.k3524_uuid('s-change'), pg_temp.k3524_uuid('changed')),
  (pg_temp.k3524_uuid('s-mis'),    pg_temp.k3524_uuid('mismatched')),
  (pg_temp.k3524_uuid('s-carry'),  pg_temp.k3524_uuid('carryover'));
-- NOTE: 'borrower' deliberately has NO session of its own.

INSERT INTO auth.mfa_amr_claims(session_id, authentication_method) VALUES
  (pg_temp.k3524_uuid('s-free'),   'password'),
  (pg_temp.k3524_uuid('s-real'),   'otp'),
  (pg_temp.k3524_uuid('s-magic'),  'magiclink'),
  (pg_temp.k3524_uuid('s-recov'),  'recovery'),
  (pg_temp.k3524_uuid('s-oauth'),  'oauth'),
  (pg_temp.k3524_uuid('s-totp'),   'totp'),
  (pg_temp.k3524_uuid('s-invite'), 'invite'),
  (pg_temp.k3524_uuid('s-change'), 'email_change'),
  (pg_temp.k3524_uuid('s-mis'),    'otp'),
  (pg_temp.k3524_uuid('s-carry'),  'otp');

INSERT INTO public.verified_phone_identities(user_id, phone_e164)
VALUES (pg_temp.k3524_uuid('phoneonly'), '+2348012345678');

INSERT INTO public.creator_accounts(id, email)
VALUES (pg_temp.k3524_uuid('creator'), 'issue3524-knowing@example.test');
INSERT INTO public.brands(id, account_id, name, slug)
VALUES (pg_temp.k3524_uuid('brand'), pg_temp.k3524_uuid('creator'),
        'Issue 3524 Knowing', 'issue-3524-knowing');
INSERT INTO public.events(
  id, brand_id, created_by, title, slug, event_type, status, visibility,
  timezone, theme
) VALUES (
  pg_temp.k3524_uuid('event'), pg_temp.k3524_uuid('brand'),
  pg_temp.k3524_uuid('creator'), 'Knowing Event', 'issue-3524-knowing-event',
  'event', 'scheduled', 'public', 'UTC', '{}'::jsonb
);
INSERT INTO public.ticket_types(
  id, event_id, name, price_cents, currency, quantity_total
) VALUES (
  pg_temp.k3524_uuid('tier'), pg_temp.k3524_uuid('event'),
  'General', 1000, 'USD', 50
);
INSERT INTO public.orders(
  id, event_id, buyer_email, buyer_phone_e164, buyer_name, total_cents,
  currency, payment_status, source, attendance_claim_token_digest,
  attendance_claim_token_generation, attendance_claim_token_created_at,
  attendance_identity_claim_armed_at
) VALUES
  (pg_temp.k3524_uuid('order'), pg_temp.k3524_uuid('event'),
   'Buyer@Example.Test', NULL, 'The Buyer', 1000, 'USD', 'paid', 'legacy',
   decode(repeat('ab', 32), 'hex'), 'governed_v2', now() - interval '1 day',
   now()),
  (pg_temp.k3524_uuid('order-phone'), pg_temp.k3524_uuid('event'),
   NULL, '+2348012345678', 'Phone Buyer', 1000, 'USD', 'paid', 'legacy',
   decode(repeat('cd', 32), 'hex'), 'governed_v2', now() - interval '1 day',
   now());
INSERT INTO public.tickets(
  id, order_id, ticket_type_id, event_id, qr_code, status, approval_status
) VALUES
  (pg_temp.k3524_uuid('t'), pg_temp.k3524_uuid('order'),
   pg_temp.k3524_uuid('tier'), pg_temp.k3524_uuid('event'),
   'k3524-a', 'valid', 'auto'),
  (pg_temp.k3524_uuid('t-phone'), pg_temp.k3524_uuid('order-phone'),
   pg_temp.k3524_uuid('tier'), pg_temp.k3524_uuid('event'),
   'k3524-b', 'valid', 'auto');

SET session_replication_role = origin;

-- Hand the purchase address to ONE account, the way GoTrue would: the account's
-- own auth.users.email and its email identity both move. Everyone else is put
-- back on their own address first, because the address is unique.
CREATE OR REPLACE FUNCTION pg_temp.k3524_become_buyer(
  p_seed text, p_identity text
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE auth.users SET email = 'p-' || split_part(id::text, '-', 1)
   WHERE email = 'buyer@example.test';
  UPDATE auth.users SET email = 'buyer@example.test'
   WHERE id = pg_temp.k3524_uuid(p_seed);
  UPDATE auth.identities
     SET identity_data = identity_data
       || jsonb_build_object('email', 'buyer@example.test')
   WHERE id = p_identity;
END;
$$;

DO $harness$
DECLARE
  v_order uuid := pg_temp.k3524_uuid('order');
  m text;
  v_swept jsonb;
BEGIN
  -- ── PRECONDITION: the email arm can execute at all in this session ───────
  PERFORM pg_temp.k3524_become_buyer('realguest', 'k-real');
  PERFORM pg_temp.k3524_expect(
    public.account_owns_order_contact(pg_temp.k3524_uuid('realguest'), v_order),
    'PRECONDITION: a guest who read the code must pass — without this every '
      || 'refusal below could be a refusal for the wrong reason');

  -- ── A. the free-signup shape is refused ──────────────────────────────────
  PERFORM pg_temp.k3524_become_buyer('freesignup', 'k-free');
  PERFORM pg_temp.k3524_expect(
    NOT public.account_owns_order_contact(pg_temp.k3524_uuid('freesignup'), v_order),
    'A: a public signup under mailer_autoconfirm mints a confirmed '
      || 'provider=email identity for ANY address with NO mail sent. Holding '
      || 'one, and nothing else, must NOT satisfy the purchase-contact rule.');

  -- ── B. the real guest passes (covered by the precondition) ───────────────

  -- ── C. exactly the three mailbox methods, and no others ──────────────────
  PERFORM pg_temp.k3524_become_buyer('magic', 'k-magic');
  PERFORM pg_temp.k3524_expect(
    public.account_owns_order_contact(pg_temp.k3524_uuid('magic'), v_order),
    'C: magiclink requires clicking a link sent to that mailbox — accept it');
  PERFORM pg_temp.k3524_become_buyer('recover', 'k-recov');
  PERFORM pg_temp.k3524_expect(
    public.account_owns_order_contact(pg_temp.k3524_uuid('recover'), v_order),
    'C: recovery requires reading a reset link at that mailbox — accept it');
  FOR m IN SELECT unnest(ARRAY['oauthonly','totponly','invited','changed']) LOOP
    PERFORM pg_temp.k3524_become_buyer(m, CASE m
      WHEN 'oauthonly' THEN 'k-oauth' WHEN 'totponly' THEN 'k-totp'
      WHEN 'invited' THEN 'k-invite' ELSE 'k-change' END);
    PERFORM pg_temp.k3524_expect(
      NOT public.account_owns_order_contact(pg_temp.k3524_uuid(m), v_order),
      'C: an amr of ' || m || ' proves a session, not a mailbox — refuse it. '
        || 'email_change in particular is stamped by CHANGING an address, '
        || 'which is the opposite of proving one.');
  END LOOP;

  -- ── D. somebody else''s proof does not carry over ────────────────────────
  PERFORM pg_temp.k3524_become_buyer('borrower', 'k-borrow');
  PERFORM pg_temp.k3524_expect(
    NOT public.account_owns_order_contact(pg_temp.k3524_uuid('borrower'), v_order),
    'D: an account with no session of its own must not borrow the amr of an '
      || 'account that happens to share the address');

  -- ── E. the identity''s address must be the account''s OWN address ────────
  UPDATE auth.identities
     SET identity_data = jsonb_build_object('email', 'buyer@example.test')
   WHERE id = 'k-mis';
  PERFORM pg_temp.k3524_expect(
    NOT public.account_owns_order_contact(pg_temp.k3524_uuid('mismatched'), v_order),
    'E: an identity row claiming the buyer''s address while auth.users.email '
      || 'says something else must not pass');

  -- ── F. the provider-asserted arm still works, with no amr at all ─────────
  PERFORM pg_temp.k3524_become_buyer('google', 'k-google');
  PERFORM pg_temp.k3524_expect(
    public.account_owns_order_contact(pg_temp.k3524_uuid('google'), v_order),
    'F: a Google/Apple identity carrying email_verified must still pass — '
      || 'hardening the email arm must not have deleted the arm that 119 of '
      || 'this project''s identities actually use');

  -- ── H. the phone arm is untouched ────────────────────────────────────────
  PERFORM pg_temp.k3524_expect(
    public.account_owns_order_contact(
      pg_temp.k3524_uuid('phoneonly'), pg_temp.k3524_uuid('order-phone')),
    'H: the verified-phone ledger is our own, written only after a received '
      || 'code, and nothing about autoconfirm touched it');
  PERFORM pg_temp.k3524_expect(
    NOT public.account_owns_order_contact(
      pg_temp.k3524_uuid('phoneonly'), v_order),
    'H: a proved phone does not prove an unrelated email order');

  -- ── I. the identity RAIL runs the same rule ──────────────────────────────
  PERFORM pg_temp.k3524_become_buyer('freesignup', 'k-free');
  v_swept := public.claim_attendance_by_verified_identity(
    pg_temp.k3524_uuid('freesignup'));
  PERFORM pg_temp.k3524_expect((v_swept->>'count')::int = 0,
    'I: the SWEEP must apply the same predicate. It matched on verified '
      || 'identifiers alone and would hand every armed unclaimed order to a '
      || 'free signup without any claim link at all. Swept: '
      || coalesce(v_swept->>'count','(null)'));
  PERFORM pg_temp.k3524_expect(
    (SELECT buyer_user_id IS NULL FROM public.orders WHERE id = v_order),
    'I: and it must not have written buyer_user_id while doing it');
  PERFORM pg_temp.k3524_become_buyer('realguest', 'k-real');
  v_swept := public.claim_attendance_by_verified_identity(
    pg_temp.k3524_uuid('realguest'));
  PERFORM pg_temp.k3524_expect((v_swept->>'count')::int >= 1,
    'I: the guest who DID read the code must still be swept — the rail is the '
      || 'durable fallback the expired copy promises. Swept: '
      || coalesce(v_swept->>'count','(null)'));

  -- ── J. THE PROOF IS NOT BOUND TO THE ADDRESS IT PROVED ───────────────────
  --
  -- `carryover` holds an `otp` amr. It was earned at whatever address the
  -- account carried WHEN THE CODE WAS READ — the amr row records the method,
  -- never the address. The account now carries the buyer's address on both
  -- auth.users.email and its email identity, so every clause of the predicate
  -- is satisfied by an old proof about a different mailbox.
  --
  -- The remaining link in the exploit is GoTrue's own: whether this project,
  -- running mailer_autoconfirm, lets PUT /auth/v1/user change an address
  -- without confirming the new one. That is one API call to settle and it is
  -- named in the test report. The predicate should not depend on the answer.
  --
  -- THE FIX IS SMALL: require the proving session to be no older than the email
  -- identity itself — an amr session whose created_at >= i.updated_at — so a
  -- proof earned before the address arrived cannot vouch for it.
  PERFORM pg_temp.k3524_become_buyer('carryover', 'k-carry');
  PERFORM pg_temp.k3524_expect(
    NOT public.account_owns_order_contact(pg_temp.k3524_uuid('carryover'), v_order),
    'J: a mailbox proof earned BEFORE the account carried this address must '
      || 'not vouch for it. The amr row records the METHOD and never the '
      || 'ADDRESS, and the predicate asks only whether the account has EVER '
      || 'held an otp/magiclink/recovery session — so one honest code read at '
      || 'the attacker''s own mailbox, followed by an address change, '
      || 'satisfies the whole rule. Bind the proof to the address: require the '
      || 'amr session to be no older than the email identity.');

  -- ── G. fails closed when GoTrue''s amr table is not there ────────────────
  PERFORM pg_temp.k3524_become_buyer('realguest', 'k-real');
  EXECUTE 'ALTER TABLE auth.mfa_amr_claims RENAME TO mfa_amr_claims_hidden';
  PERFORM pg_temp.k3524_expect(
    NOT public.account_owns_order_contact(pg_temp.k3524_uuid('realguest'), v_order),
    'G: with no amr evidence available the email arm must answer false. '
      || 'Absent evidence is never evidence.');
  PERFORM pg_temp.k3524_expect(
    public.account_owns_order_contact(
      pg_temp.k3524_uuid('phoneonly'), pg_temp.k3524_uuid('order-phone')),
    'G: and the phone arm must still answer on its own');
  PERFORM pg_temp.k3524_become_buyer('google', 'k-google');
  PERFORM pg_temp.k3524_expect(
    public.account_owns_order_contact(pg_temp.k3524_uuid('google'), v_order),
    'G: the provider-asserted arm needs no amr and must still answer');
  EXECUTE 'ALTER TABLE auth.mfa_amr_claims_hidden RENAME TO mfa_amr_claims';
END;
$harness$;

DO $verdict$
DECLARE v_count integer; v_all text;
BEGIN
  SELECT count(*), string_agg(message, E'\n  - ') INTO v_count, v_all
    FROM k3524_failures;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'issue #3524 tester adversarial (knowing vs owning): % failure(s):%  - %',
      v_count, E'\n', v_all;
  END IF;
  RAISE NOTICE 'issue #3524 tester adversarial (knowing vs owning): all assertions passed';
END;
$verdict$;

ROLLBACK;
