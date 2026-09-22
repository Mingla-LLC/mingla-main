-- ===========================================================================
-- issue #3524 — TESTER ADVERSARIAL: a forwarded confirmation email must not
-- move somebody else's ticket.
--
-- The implementor's happy path proves a matching account claims. This file
-- attacks the other side of the same predicate, and it attacks the arm CI has
-- never been able to reach: the EMAIL arm.
--
-- `public.verified_account_identifiers` reads `auth.identities`, and that table
-- DOES NOT EXIST on the supabase/postgres CI image — the function fails closed
-- to the phone ledger there. So every existing suite in this lane can only ever
-- exercise the phone half of `public.account_owns_order_contact`, while the
-- email half is the one this whole issue is about. This file stands the missing
-- table up inside its own transaction (and rolls it back), so the email arm is
-- executed rather than assumed.
--
-- Angles:
--   A. a second account holding the VALID token is refused identity_mismatch;
--   B. the refusal CONSUMES NOTHING — digest, generation and created_at survive;
--   C. the refusal REPEATS rather than degrading to invalid/conflict;
--   D. the rightful account then claims from the SAME token;
--   E. an expired (31-day) token returns expired, consumes nothing, and the
--      rightful account can still claim afterwards;
--   F. the order's buyer_email CHANGING re-points the predicate — the old
--      address stops working and the new one starts;
--   G. an account that proves a PHONE rather than an email claims;
--   H. an order carrying NEITHER a buyer_email NOR a valid E.164 phone is
--      refused with a NULL masked hint — nobody can ever claim it by token;
--   I. mask_contact_for_claim's cases are pinned.
--
-- FAILS ON REVERT: delete the identity predicate from
-- claim_attendance_internal_v2 and A, C, F and H go red; delete the expiry and
-- E goes red; delete the `RETURN` before the write and B and D go red.
-- ===========================================================================
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.t3524_uuid(seed text) RETURNS uuid
LANGUAGE sql IMMUTABLE AS $$
  SELECT (substr(md5('issue3524-tester:'||seed),1,8)||'-'
       || substr(md5('issue3524-tester:'||seed),9,4)||'-4'
       || substr(md5('issue3524-tester:'||seed),14,3)||'-8'
       || substr(md5('issue3524-tester:'||seed),18,3)||'-'
       || substr(md5('issue3524-tester:'||seed),21,12))::uuid
$$;

CREATE TEMP TABLE t3524_failures(message text NOT NULL);

CREATE OR REPLACE FUNCTION pg_temp.t3524_expect(
  p_ok boolean, p_message text
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT coalesce(p_ok, false) THEN
    INSERT INTO t3524_failures(message) VALUES (p_message);
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- The GoTrue arm, stood up locally so the EMAIL half of the predicate runs.
-- On the CI image `auth.identities` is absent and every email assertion below
-- would otherwise pass vacuously by never being reached.
-- ---------------------------------------------------------------------------
DO $ident$
BEGIN
  IF to_regclass('auth.identities') IS NULL THEN
    EXECUTE $ddl$
      CREATE TABLE auth.identities(
        id            text NOT NULL,
        user_id       uuid NOT NULL,
        provider      text NOT NULL,
        identity_data jsonb NOT NULL DEFAULT '{}'::jsonb
      )
    $ddl$;
    -- The GoTrue phone arm of `verified_account_identifiers` joins
    -- `auth.users.phone`, which the CI image's stubbed `auth.users` does not
    -- carry. Standing the identities table up without it makes the function
    -- raise rather than answer. Both are rolled back with this transaction.
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'auth' AND table_name = 'users'
         AND column_name = 'phone'
    ) THEN
      EXECUTE 'ALTER TABLE auth.users ADD COLUMN phone text';
    END IF;
  END IF;
END;
$ident$;

SET session_replication_role = replica;

INSERT INTO auth.users(id) VALUES
  (pg_temp.t3524_uuid('creator')),
  (pg_temp.t3524_uuid('rightful')),
  (pg_temp.t3524_uuid('forwarded')),
  (pg_temp.t3524_uuid('phoneuser')),
  (pg_temp.t3524_uuid('nobody'));

INSERT INTO auth.identities(id, user_id, provider, identity_data) VALUES
  ('t3524-rightful', pg_temp.t3524_uuid('rightful'), 'email',
   jsonb_build_object('email', 'Buyer@Example.Test')),
  ('t3524-forwarded', pg_temp.t3524_uuid('forwarded'), 'email',
   jsonb_build_object('email', 'thief@example.test')),
  ('t3524-moved', pg_temp.t3524_uuid('nobody'), 'email',
   jsonb_build_object('email', 'moved@example.test'));

INSERT INTO public.verified_phone_identities(user_id, phone_e164)
VALUES (pg_temp.t3524_uuid('phoneuser'), '+2348012345678');

INSERT INTO public.creator_accounts(id, email)
VALUES (pg_temp.t3524_uuid('creator'), 'issue3524-tester-creator@example.test');

INSERT INTO public.brands(id, account_id, name, slug)
VALUES (pg_temp.t3524_uuid('brand'), pg_temp.t3524_uuid('creator'),
        'Issue 3524 Tester', 'issue-3524-tester');

INSERT INTO public.events(
  id, brand_id, created_by, title, slug, event_type, status, visibility,
  timezone, theme
) VALUES (
  pg_temp.t3524_uuid('event'), pg_temp.t3524_uuid('brand'),
  pg_temp.t3524_uuid('creator'), 'Issue 3524 Tester Event',
  'issue-3524-tester-event', 'event', 'scheduled', 'public', 'UTC', '{}'::jsonb
);

INSERT INTO public.ticket_types(
  id, event_id, name, price_cents, currency, quantity_total
) VALUES (
  pg_temp.t3524_uuid('tier'), pg_temp.t3524_uuid('event'),
  'General', 1000, 'USD', 50
);

-- order-fresh   : a live 1-day-old governed token, buyer_email Buyer@Example.Test
-- order-old     : the same shape but minted 31 days ago
-- order-phone   : buyer has no email, only an E.164 phone
-- order-nocontact: neither a usable email nor a usable phone
INSERT INTO public.orders(
  id, event_id, buyer_email, buyer_phone_e164, buyer_name, total_cents,
  currency, payment_status, source,
  attendance_claim_token_digest, attendance_claim_token_generation,
  attendance_claim_token_created_at, attendance_identity_claim_armed_at
) VALUES
  (pg_temp.t3524_uuid('order-fresh'), pg_temp.t3524_uuid('event'),
   'Buyer@Example.Test', NULL, 'Rightful Buyer', 1000, 'USD', 'paid', 'legacy',
   decode(repeat('11', 32), 'hex'), 'governed_v2', now() - interval '1 day', now()),
  (pg_temp.t3524_uuid('order-old'), pg_temp.t3524_uuid('event'),
   'Buyer@Example.Test', NULL, 'Rightful Buyer', 1000, 'USD', 'paid', 'legacy',
   decode(repeat('22', 32), 'hex'), 'governed_v2', now() - interval '31 days', now()),
  (pg_temp.t3524_uuid('order-phone'), pg_temp.t3524_uuid('event'),
   NULL, '+2348012345678', 'Phone Buyer', 1000, 'USD', 'paid', 'legacy',
   decode(repeat('33', 32), 'hex'), 'governed_v2', now() - interval '1 day', now()),
  (pg_temp.t3524_uuid('order-nocontact'), pg_temp.t3524_uuid('event'),
   '', '08012345678', 'No Contact', 1000, 'USD', 'paid', 'legacy',
   decode(repeat('44', 32), 'hex'), 'governed_v2', now() - interval '1 day', now());

INSERT INTO public.tickets(
  id, order_id, ticket_type_id, event_id, qr_code, status, approval_status
) VALUES
  (pg_temp.t3524_uuid('ticket-fresh'), pg_temp.t3524_uuid('order-fresh'),
   pg_temp.t3524_uuid('tier'), pg_temp.t3524_uuid('event'),
   't3524-fresh', 'valid', 'auto'),
  (pg_temp.t3524_uuid('ticket-old'), pg_temp.t3524_uuid('order-old'),
   pg_temp.t3524_uuid('tier'), pg_temp.t3524_uuid('event'),
   't3524-old', 'valid', 'auto'),
  (pg_temp.t3524_uuid('ticket-phone'), pg_temp.t3524_uuid('order-phone'),
   pg_temp.t3524_uuid('tier'), pg_temp.t3524_uuid('event'),
   't3524-phone', 'valid', 'auto'),
  (pg_temp.t3524_uuid('ticket-nc'), pg_temp.t3524_uuid('order-nocontact'),
   pg_temp.t3524_uuid('tier'), pg_temp.t3524_uuid('event'),
   't3524-nc', 'valid', 'auto');

SET session_replication_role = origin;

DO $harness$
DECLARE
  r jsonb;
  v_digest bytea;
  v_gen text;
  v_created timestamptz;
  v_owner uuid;
BEGIN
  -- ── PRECONDITION: the email arm is actually live in this session ─────────
  PERFORM pg_temp.t3524_expect(
    EXISTS (SELECT 1 FROM public.verified_account_identifiers(
              pg_temp.t3524_uuid('rightful'))
             WHERE kind = 'email' AND value = 'buyer@example.test'),
    'PRECONDITION: verified_account_identifiers must surface the rightful '
      || 'account''s email — without it every email assertion below is vacuous');

  -- ── A. the forwarded-email stranger is refused ───────────────────────────
  r := public.claim_attendance_internal_v2(
         pg_temp.t3524_uuid('forwarded'), 'order',
         pg_temp.t3524_uuid('event'), pg_temp.t3524_uuid('order-fresh'),
         decode(repeat('11', 32), 'hex'));
  PERFORM pg_temp.t3524_expect(r->>'result' = 'identity_mismatch',
    'A: a second account holding the VALID token must be refused '
      || 'identity_mismatch, got ' || coalesce(r->>'result', '(null)'));
  PERFORM pg_temp.t3524_expect(r->>'contactMasked' = 'b•••@e•••.test',
    'A: the mismatch must carry the MASKED purchase address, got '
      || coalesce(r->>'contactMasked', '(null)'));
  PERFORM pg_temp.t3524_expect(r->>'contactChannel' = 'email',
    'A: contactChannel must name the channel that was masked');
  PERFORM pg_temp.t3524_expect(
    (r::text) NOT ILIKE '%buyer@example.test%',
    'A: the response must never contain the UNMASKED purchase address');

  -- ── B. the refusal consumed nothing ──────────────────────────────────────
  SELECT o.attendance_claim_token_digest, o.attendance_claim_token_generation,
         o.attendance_claim_token_created_at, o.buyer_user_id
    INTO v_digest, v_gen, v_created, v_owner
    FROM public.orders o WHERE o.id = pg_temp.t3524_uuid('order-fresh');
  PERFORM pg_temp.t3524_expect(v_digest IS NOT NULL,
    'B: identity_mismatch must NOT null the claim-token digest');
  PERFORM pg_temp.t3524_expect(v_gen = 'governed_v2',
    'B: identity_mismatch must NOT clear the token generation');
  PERFORM pg_temp.t3524_expect(v_created IS NOT NULL,
    'B: identity_mismatch must NOT clear the token mint time');
  PERFORM pg_temp.t3524_expect(v_owner IS NULL,
    'B: identity_mismatch must NOT write buyer_user_id');
  PERFORM pg_temp.t3524_expect(
    (SELECT o.attendance_claim_token_consumed_at IS NULL
       FROM public.orders o WHERE o.id = pg_temp.t3524_uuid('order-fresh')),
    'B: identity_mismatch must NOT stamp attendance_claim_token_consumed_at');

  -- ── C. replay after a mismatch still says mismatch ───────────────────────
  r := public.claim_attendance_internal_v2(
         pg_temp.t3524_uuid('forwarded'), 'order',
         pg_temp.t3524_uuid('event'), pg_temp.t3524_uuid('order-fresh'),
         decode(repeat('11', 32), 'hex'));
  PERFORM pg_temp.t3524_expect(r->>'result' = 'identity_mismatch',
    'C: a replay after a mismatch must STILL be identity_mismatch (it would '
      || 'degrade to invalid if the first refusal had consumed the token), got '
      || coalesce(r->>'result', '(null)'));

  -- ── D. the rightful account then claims from the SAME token ──────────────
  r := public.claim_attendance_internal_v2(
         pg_temp.t3524_uuid('rightful'), 'order',
         pg_temp.t3524_uuid('event'), pg_temp.t3524_uuid('order-fresh'),
         decode(repeat('11', 32), 'hex'));
  PERFORM pg_temp.t3524_expect(r->>'result' = 'claimed',
    'D: the rightful account must still claim from the same link after two '
      || 'refusals, got ' || coalesce(r->>'result', '(null)'));
  PERFORM pg_temp.t3524_expect(
    (SELECT o.buyer_user_id FROM public.orders o
      WHERE o.id = pg_temp.t3524_uuid('order-fresh'))
      = pg_temp.t3524_uuid('rightful'),
    'D: the order must now belong to the rightful account');
  PERFORM pg_temp.t3524_expect(r ? 'chatJoined',
    'D: a claimed result must always carry chatJoined');

  -- ── E. the 31-day-old token expires, consumes nothing, and the identity
  --       rail is still the durable fallback ────────────────────────────────
  r := public.claim_attendance_internal_v2(
         pg_temp.t3524_uuid('rightful'), 'order',
         pg_temp.t3524_uuid('event'), pg_temp.t3524_uuid('order-old'),
         decode(repeat('22', 32), 'hex'));
  PERFORM pg_temp.t3524_expect(r->>'result' = 'expired',
    'E: a 31-day-old token must return expired, got '
      || coalesce(r->>'result', '(null)'));
  PERFORM pg_temp.t3524_expect(
    (SELECT o.attendance_claim_token_digest IS NOT NULL
        AND o.buyer_user_id IS NULL
       FROM public.orders o WHERE o.id = pg_temp.t3524_uuid('order-old')),
    'E: expired must consume nothing');
  PERFORM pg_temp.t3524_expect(
    (public.claim_attendance_by_verified_identity(
       pg_temp.t3524_uuid('rightful'))->>'count')::int >= 1,
    'E: after expiry the identity rail must still hand the ticket over — that '
      || 'is the promise the expired copy makes to the guest');
  PERFORM pg_temp.t3524_expect(
    (SELECT o.buyer_user_id FROM public.orders o
      WHERE o.id = pg_temp.t3524_uuid('order-old'))
      = pg_temp.t3524_uuid('rightful'),
    'E: the identity rail must have landed the expired-link order');

  -- ── F. the order''s contact CHANGES: old address stops, new one starts ───
  UPDATE public.orders SET buyer_email = 'moved@example.test'
   WHERE id = pg_temp.t3524_uuid('order-phone');
  UPDATE public.orders SET buyer_phone_e164 = NULL
   WHERE id = pg_temp.t3524_uuid('order-phone');
  r := public.claim_attendance_internal_v2(
         pg_temp.t3524_uuid('phoneuser'), 'order',
         pg_temp.t3524_uuid('event'), pg_temp.t3524_uuid('order-phone'),
         decode(repeat('33', 32), 'hex'));
  PERFORM pg_temp.t3524_expect(r->>'result' = 'identity_mismatch',
    'F: once the order''s contact moves, the account that proved the OLD '
      || 'identifier must be refused, got ' || coalesce(r->>'result', '(null)'));
  r := public.claim_attendance_internal_v2(
         pg_temp.t3524_uuid('nobody'), 'order',
         pg_temp.t3524_uuid('event'), pg_temp.t3524_uuid('order-phone'),
         decode(repeat('33', 32), 'hex'));
  PERFORM pg_temp.t3524_expect(r->>'result' = 'claimed',
    'F: the account proving the NEW identifier must claim, got '
      || coalesce(r->>'result', '(null)'));

  -- ── G. a PHONE proof is as good as an email proof ────────────────────────
  UPDATE public.orders
     SET buyer_email = NULL, buyer_phone_e164 = '+2348012345678',
         buyer_user_id = NULL,
         attendance_claim_token_digest = decode(repeat('55', 32), 'hex'),
         attendance_claim_token_generation = 'governed_v2',
         attendance_claim_token_consumed_at = NULL,
         attendance_claim_token_created_at = now() - interval '1 day'
   WHERE id = pg_temp.t3524_uuid('order-nocontact');
  r := public.claim_attendance_internal_v2(
         pg_temp.t3524_uuid('phoneuser'), 'order',
         pg_temp.t3524_uuid('event'), pg_temp.t3524_uuid('order-nocontact'),
         decode(repeat('55', 32), 'hex'));
  PERFORM pg_temp.t3524_expect(r->>'result' = 'claimed',
    'G: an account whose PROVED identifier is the purchase PHONE must claim, '
      || 'got ' || coalesce(r->>'result', '(null)'));

  -- ── H. an order with no usable contact is permanently unclaimable by token,
  --       and says so with a NULL hint rather than a fabricated one ─────────
  UPDATE public.orders
     SET buyer_email = '', buyer_phone_e164 = '08012345678',
         buyer_user_id = NULL,
         attendance_claim_token_digest = decode(repeat('66', 32), 'hex'),
         attendance_claim_token_generation = 'governed_v2',
         attendance_claim_token_consumed_at = NULL,
         attendance_claim_token_created_at = now() - interval '1 day'
   WHERE id = pg_temp.t3524_uuid('order-nocontact');
  r := public.claim_attendance_internal_v2(
         pg_temp.t3524_uuid('rightful'), 'order',
         pg_temp.t3524_uuid('event'), pg_temp.t3524_uuid('order-nocontact'),
         decode(repeat('66', 32), 'hex'));
  PERFORM pg_temp.t3524_expect(r->>'result' = 'identity_mismatch',
    'H: an order with no usable buyer contact must be refused, not claimed, '
      || 'got ' || coalesce(r->>'result', '(null)'));
  PERFORM pg_temp.t3524_expect(r->'contactMasked' = 'null'::jsonb,
    'H: with nothing maskable the hint must be NULL, never invented — got '
      || coalesce(r->>'contactMasked', '(sql null)'));

  -- ── I. the masking rule, pinned ──────────────────────────────────────────
  PERFORM pg_temp.t3524_expect(
    public.mask_contact_for_claim('alice@example.com', 'email')
      = 'a•••@e•••.com', 'I: email mask, R-13 worked example');
  PERFORM pg_temp.t3524_expect(
    public.mask_contact_for_claim('a@b.com', 'email') = 'a•••@b•••.com',
    'I: single-character local part and label');
  PERFORM pg_temp.t3524_expect(
    public.mask_contact_for_claim('+2348012345678', 'phone')
      = '+234•••5678', 'I: phone mask, R-13 worked example');
  PERFORM pg_temp.t3524_expect(
    public.mask_contact_for_claim('+1234567', 'phone') = '+•••',
    'I: fewer than 8 digits shows nothing');
  PERFORM pg_temp.t3524_expect(
    public.mask_contact_for_claim('alice@example.com', 'email')
      NOT LIKE '%lice%', 'I: the mask must not leak the local part');
END;
$harness$;

DO $verdict$
DECLARE v_count integer; v_first text;
BEGIN
  SELECT count(*), string_agg(message, E'\n  - ') INTO v_count, v_first
    FROM t3524_failures;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'issue #3524 tester adversarial (forwarded email): % failure(s). First: %',
      v_count, v_first;
  END IF;
  RAISE NOTICE 'issue #3524 tester adversarial (forwarded email): all assertions passed';
END;
$verdict$;

ROLLBACK;
