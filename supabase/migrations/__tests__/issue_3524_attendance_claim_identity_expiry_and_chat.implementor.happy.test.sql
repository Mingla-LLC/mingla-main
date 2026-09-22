-- issue #3524 — IMPLEMENTOR HAPPY PATH for the attendance-claim migration.
--
-- WHAT THIS PROVES, in the words of the bug it closes:
--
--   1. A ticket lands only on an account that has PROVED it owns the purchase
--      contact. A second account holding the same valid token is refused.
--   2. A refusal CONSUMES NOTHING — the token, its generation and its digests
--      survive an `identity_mismatch` and an `expired`, so the rightful account
--      can still use the same link afterwards.
--   3. The emailed link ages out at 30 days, and 29 days still works, so the
--      constant is pinned rather than merely present.
--   4. A successful claim JOINS THE EVENT CHAT through the same helper the
--      identity rail uses, and reports `chatJoined` + `conversationId` read back
--      AFTER the join.
--   5. An `experience` order legitimately has no chat, claims successfully, and
--      reports `chatJoined = false` — the RPC never promises a chat it did not
--      join.
--   6. The desktop handoff code mints, redeems once, and runs THE claim body
--      (identity predicate included) rather than a second copy of it.
--
-- WHY THE IDENTITY FIXTURE USES A PHONE, NOT AN EMAIL. `verified_account_
-- identifiers` reads `auth.identities` for the email arm and
-- `public.verified_phone_identities` for the phone arm, and it fails closed on
-- the GoTrue arm when `auth.identities` is absent. The `supabase/postgres` CI
-- image this lane runs against HAS NO `auth.identities` — that is exactly why
-- the ledger arm exists (see the function's own comment). So the portable proof
-- of "this account owns the purchase contact" here is the phone ledger. Both
-- arms are one predicate, `public.account_owns_order_contact`, and this suite
-- asserts there is only one.
--
-- Runs inside one transaction and ROLLBACKs, so it is re-runnable:
--   psql -v ON_ERROR_STOP=1 -f <this file>

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.i3524_uuid(seed text) RETURNS uuid
LANGUAGE sql IMMUTABLE AS $$
  SELECT (substr(md5('issue3524:'||seed),1,8)||'-'||substr(md5('issue3524:'||seed),9,4)
       ||'-4'||substr(md5('issue3524:'||seed),14,3)||'-8'||substr(md5('issue3524:'||seed),18,3)
       ||'-'||substr(md5('issue3524:'||seed),21,12))::uuid
$$;

CREATE OR REPLACE FUNCTION pg_temp.i3524_ok(claim boolean, label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF claim IS NOT TRUE THEN RAISE EXCEPTION 'issue_3524 FAILED: %', label; END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- #3524 REWORK (P0-1) — the GoTrue arm, stood up so the EMAIL half of the
-- predicate is reachable on the CI image, which ships none of these tables.
--
-- The predicate no longer accepts a bare `provider='email'` identity. This
-- project runs `mailer_autoconfirm: true` with signups open, so that row is
-- free to anyone who knows an address — 160 of 160 live users are confirmed
-- with `confirmation_sent_at IS NULL`. It now requires POSITIVE evidence that
-- the mailbox was reached: `email_verified` asserted by a provider, or an
-- `otp`/`magiclink`/`recovery` authentication recorded by GoTrue.
--
-- All of it rolls back with this transaction.
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
    EXECUTE $ddl$
      CREATE TABLE auth.sessions(id uuid PRIMARY KEY, user_id uuid NOT NULL)
    $ddl$;
    EXECUTE $ddl$
      CREATE TABLE auth.mfa_amr_claims(
        session_id uuid NOT NULL, authentication_method text NOT NULL)
    $ddl$;
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

-- ── The host ────────────────────────────────────────────────────────────────
INSERT INTO auth.users(id) VALUES (pg_temp.i3524_uuid('creator'));
INSERT INTO public.creator_accounts(id, email)
VALUES (pg_temp.i3524_uuid('creator'), 'issue3524-creator@example.test');
INSERT INTO public.brands(id, account_id, name, slug)
VALUES (pg_temp.i3524_uuid('brand'), pg_temp.i3524_uuid('creator'),
        'Issue 3524', 'issue-3524-guest-ticket-into-app');

-- Two events: one that HAS a group chat, one that legitimately has none.
INSERT INTO public.events(
  id, brand_id, created_by, title, slug, event_type, status, visibility,
  timezone, theme
) VALUES
  (pg_temp.i3524_uuid('event'), pg_temp.i3524_uuid('brand'),
   pg_temp.i3524_uuid('creator'), 'Issue 3524 Event',
   'issue-3524-event', 'event', 'scheduled', 'public', 'UTC', '{}'::jsonb),
  (pg_temp.i3524_uuid('exp'), pg_temp.i3524_uuid('brand'),
   pg_temp.i3524_uuid('creator'), 'Issue 3524 Experience',
   'issue-3524-experience', 'experience', 'scheduled', 'public', 'UTC', '{}'::jsonb);

INSERT INTO public.ticket_types(id, event_id, name, price_cents, currency, quantity_total)
VALUES
  (pg_temp.i3524_uuid('tier'), pg_temp.i3524_uuid('event'), 'General', 1000, 'USD', 50),
  (pg_temp.i3524_uuid('tier-exp'), pg_temp.i3524_uuid('exp'), 'General', 1000, 'USD', 50);

-- ── The accounts ────────────────────────────────────────────────────────────
-- `owner` has PROVED +15550100101 through the verified-phone ledger.
-- `stranger` has proved nothing, and is the forwarded-email recipient.
INSERT INTO auth.users(id) VALUES
  (pg_temp.i3524_uuid('owner')),
  (pg_temp.i3524_uuid('stranger')),
  (pg_temp.i3524_uuid('owner2')),
  (pg_temp.i3524_uuid('owner3')),
  (pg_temp.i3524_uuid('owner4')),
  (pg_temp.i3524_uuid('owner5'));
-- #3524 REWORK (P0-1) — four accounts, ONE address, four kinds of evidence.
-- `auth.users.email` is UNIQUE, exactly as GoTrue enforces it, so each cohort
-- gets its own address and its own identically-shaped order.
INSERT INTO auth.users(id, email) VALUES
  (pg_temp.i3524_uuid('ev-signup'),  'ev-signup@example.test'),
  (pg_temp.i3524_uuid('ev-otp'),     'ev-otp@example.test'),
  (pg_temp.i3524_uuid('ev-oauth'),   'ev-oauth@example.test'),
  (pg_temp.i3524_uuid('ev-nothing'), 'ev-nothing@example.test');
INSERT INTO auth.identities(id, user_id, provider, identity_data) VALUES
  -- A free autoconfirmed password signup: the row exists, nothing was received.
  ('i3524-signup', pg_temp.i3524_uuid('ev-signup'), 'email',
   jsonb_build_object('email', 'ev-signup@example.test', 'email_verified', false)),
  -- The same shape, but this account really did read a code out of the mailbox.
  ('i3524-otp', pg_temp.i3524_uuid('ev-otp'), 'email',
   jsonb_build_object('email', 'ev-otp@example.test', 'email_verified', false)),
  -- Google/Apple: the provider asserts the address.
  ('i3524-oauth', pg_temp.i3524_uuid('ev-oauth'), 'google',
   jsonb_build_object('email', 'ev-oauth@example.test', 'email_verified', true)),
  -- An identity with no evidence of any kind.
  ('i3524-nothing', pg_temp.i3524_uuid('ev-nothing'), 'email',
   jsonb_build_object('email', 'ev-nothing@example.test'));
INSERT INTO auth.sessions(id, user_id) VALUES
  (pg_temp.i3524_uuid('s-signup'), pg_temp.i3524_uuid('ev-signup')),
  (pg_temp.i3524_uuid('s-otp'),    pg_temp.i3524_uuid('ev-otp'));
INSERT INTO auth.mfa_amr_claims(session_id, authentication_method) VALUES
  (pg_temp.i3524_uuid('s-signup'), 'password'),
  (pg_temp.i3524_uuid('s-otp'),    'otp');

INSERT INTO public.verified_phone_identities(user_id, phone_e164, verified_at) VALUES
  (pg_temp.i3524_uuid('owner'),  '+15550100101', now()),
  (pg_temp.i3524_uuid('owner2'), '+15550100102', now()),
  (pg_temp.i3524_uuid('owner3'), '+15550100103', now()),
  (pg_temp.i3524_uuid('owner4'), '+15550100104', now()),
  (pg_temp.i3524_uuid('owner5'), '+15550100105', now());

-- ── The orders ──────────────────────────────────────────────────────────────
-- Every one carries a governed_v2 token; only `created_at` and the event differ.
INSERT INTO public.orders(
  id, event_id, buyer_email, buyer_phone_e164, buyer_name, total_cents, currency,
  payment_status, source, attendance_claim_token_digest,
  attendance_claim_token_generation, attendance_claim_token_created_at
) VALUES
  -- fresh, on the chat-bearing event
  (pg_temp.i3524_uuid('order-fresh'), pg_temp.i3524_uuid('event'),
   'alice@example.test', '+15550100101', 'Alice', 1000, 'USD', 'paid', 'online_checkout',
   decode(repeat('11', 32), 'hex'), 'governed_v2', now()),
  -- 31 days old -> expired
  (pg_temp.i3524_uuid('order-old'), pg_temp.i3524_uuid('event'),
   'bob@example.test', '+15550100102', 'Bob', 1000, 'USD', 'paid', 'online_checkout',
   decode(repeat('22', 32), 'hex'), 'governed_v2', now() - interval '31 days'),
  -- 29 days old -> still claimable, which is what pins the constant
  (pg_temp.i3524_uuid('order-29'), pg_temp.i3524_uuid('event'),
   'carol@example.test', '+15550100103', 'Carol', 1000, 'USD', 'paid', 'online_checkout',
   decode(repeat('33', 32), 'hex'), 'governed_v2', now() - interval '29 days'),
  -- an experience: no group chat exists for it, and none can be created
  (pg_temp.i3524_uuid('order-exp'), pg_temp.i3524_uuid('exp'),
   'dave@example.test', '+15550100104', 'Dave', 1000, 'USD', 'paid', 'online_checkout',
   decode(repeat('44', 32), 'hex'), 'governed_v2', now()),
  -- the desktop handoff path
  (pg_temp.i3524_uuid('order-handoff'), pg_temp.i3524_uuid('event'),
   'erin@example.test', '+15550100105', 'Erin', 1000, 'USD', 'paid', 'online_checkout',
   decode(repeat('55', 32), 'hex'), 'governed_v2', now());

INSERT INTO public.orders(
  id, event_id, buyer_email, buyer_phone_e164, buyer_name, total_cents, currency,
  payment_status, source, attendance_claim_token_digest,
  attendance_claim_token_generation, attendance_claim_token_created_at
) VALUES
  (pg_temp.i3524_uuid('order-ev-signup'), pg_temp.i3524_uuid('event'),
   'ev-signup@example.test', '+15550100191', 'Signup', 1000, 'USD',
   'paid', 'online_checkout', decode(repeat('61', 32), 'hex'), 'governed_v2', now()),
  (pg_temp.i3524_uuid('order-ev-otp'), pg_temp.i3524_uuid('event'),
   'ev-otp@example.test', '+15550100192', 'Otp', 1000, 'USD',
   'paid', 'online_checkout', decode(repeat('62', 32), 'hex'), 'governed_v2', now()),
  (pg_temp.i3524_uuid('order-ev-oauth'), pg_temp.i3524_uuid('event'),
   'ev-oauth@example.test', '+15550100193', 'Oauth', 1000, 'USD',
   'paid', 'online_checkout', decode(repeat('63', 32), 'hex'), 'governed_v2', now()),
  (pg_temp.i3524_uuid('order-ev-nothing'), pg_temp.i3524_uuid('event'),
   'ev-nothing@example.test', '+15550100194', 'Nothing', 1000, 'USD',
   'paid', 'online_checkout', decode(repeat('64', 32), 'hex'), 'governed_v2', now());

INSERT INTO public.tickets(id, order_id, ticket_type_id, event_id, qr_code, status, approval_status)
VALUES
  (pg_temp.i3524_uuid('tk-ev-signup'), pg_temp.i3524_uuid('order-ev-signup'),
   pg_temp.i3524_uuid('tier'), pg_temp.i3524_uuid('event'), 'i3524-ev-signup', 'valid', 'auto'),
  (pg_temp.i3524_uuid('tk-ev-otp'), pg_temp.i3524_uuid('order-ev-otp'),
   pg_temp.i3524_uuid('tier'), pg_temp.i3524_uuid('event'), 'i3524-ev-otp', 'valid', 'auto'),
  (pg_temp.i3524_uuid('tk-ev-oauth'), pg_temp.i3524_uuid('order-ev-oauth'),
   pg_temp.i3524_uuid('tier'), pg_temp.i3524_uuid('event'), 'i3524-ev-oauth', 'valid', 'auto'),
  (pg_temp.i3524_uuid('tk-ev-nothing'), pg_temp.i3524_uuid('order-ev-nothing'),
   pg_temp.i3524_uuid('tier'), pg_temp.i3524_uuid('event'), 'i3524-ev-nothing', 'valid', 'auto'),
  (pg_temp.i3524_uuid('tk-fresh'),   pg_temp.i3524_uuid('order-fresh'),
   pg_temp.i3524_uuid('tier'),     pg_temp.i3524_uuid('event'), 'i3524-fresh',   'valid', 'auto'),
  (pg_temp.i3524_uuid('tk-old'),     pg_temp.i3524_uuid('order-old'),
   pg_temp.i3524_uuid('tier'),     pg_temp.i3524_uuid('event'), 'i3524-old',     'valid', 'auto'),
  (pg_temp.i3524_uuid('tk-29'),      pg_temp.i3524_uuid('order-29'),
   pg_temp.i3524_uuid('tier'),     pg_temp.i3524_uuid('event'), 'i3524-29',      'valid', 'auto'),
  (pg_temp.i3524_uuid('tk-exp'),     pg_temp.i3524_uuid('order-exp'),
   pg_temp.i3524_uuid('tier-exp'), pg_temp.i3524_uuid('exp'),   'i3524-exp',     'valid', 'auto'),
  (pg_temp.i3524_uuid('tk-handoff'), pg_temp.i3524_uuid('order-handoff'),
   pg_temp.i3524_uuid('tier'),     pg_temp.i3524_uuid('event'), 'i3524-handoff', 'valid', 'auto');

SET session_replication_role = origin;

-- ═══════════════════════════════════════════════════════════════════════════
DO $t$
DECLARE
  v_event uuid := pg_temp.i3524_uuid('event');
  v_exp   uuid := pg_temp.i3524_uuid('exp');
  v_res   jsonb;
  v_conv  uuid;
  v_digest_before bytea;
  v_gen_before text;
  v_code  bytea := decode(repeat('9a', 32), 'hex');
  v_n     integer;
BEGIN
  -- ── (1) ONE PREDICATE, and it answers correctly ───────────────────────────
  PERFORM pg_temp.i3524_ok(
    public.account_owns_order_contact(
      pg_temp.i3524_uuid('owner'), pg_temp.i3524_uuid('order-fresh')),
    'the account that proved the purchase phone owns the order contact');
  PERFORM pg_temp.i3524_ok(
    NOT public.account_owns_order_contact(
      pg_temp.i3524_uuid('stranger'), pg_temp.i3524_uuid('order-fresh')),
    'an account that proved nothing does NOT own the order contact');

  -- ── (1b) #3524 REWORK, P0-1 — WHAT MAY SATISFY THE PREDICATE ─────────────
  --
  -- Four accounts, one address, four kinds of evidence. Before the rework all
  -- four returned true, because the predicate accepted the bare existence of a
  -- `provider='email'` identity — and on a project running `mailer_autoconfirm`
  -- with open signups, that row is free to anyone who knows the address. Only
  -- two of the four may pass now.
  PERFORM pg_temp.i3524_ok(
    NOT public.account_owns_order_contact(
      pg_temp.i3524_uuid('ev-signup'), pg_temp.i3524_uuid('order-ev-signup')),
    'a FREE autoconfirmed signup carrying the buyer''s address proves nothing '
      || 'and must NOT own the order contact');
  PERFORM pg_temp.i3524_ok(
    NOT public.account_owns_order_contact(
      pg_temp.i3524_uuid('ev-nothing'), pg_temp.i3524_uuid('order-ev-nothing')),
    'an email identity with no evidence of any kind must NOT own it either');
  PERFORM pg_temp.i3524_ok(
    public.account_owns_order_contact(
      pg_temp.i3524_uuid('ev-otp'), pg_temp.i3524_uuid('order-ev-otp')),
    'an account that READ A CODE out of that mailbox (amr = otp) owns it');
  PERFORM pg_temp.i3524_ok(
    public.account_owns_order_contact(
      pg_temp.i3524_uuid('ev-oauth'), pg_temp.i3524_uuid('order-ev-oauth')),
    'and so does one whose provider asserted email_verified');

  -- The evidence must belong to THIS account, not to anybody who happens to
  -- have done an OTP somewhere.
  PERFORM pg_temp.i3524_ok(
    NOT public.account_owns_order_contact(
      pg_temp.i3524_uuid('stranger'), pg_temp.i3524_uuid('order-ev-otp')),
    'an unrelated account with no identity for the address owns nothing');

  -- The masking helper is pinned by case, not merely present.
  PERFORM pg_temp.i3524_ok(
    public.mask_contact_for_claim('alice@example.com', 'email') = 'a•••@e•••.com',
    'email masking renders a•••@e•••.com');
  PERFORM pg_temp.i3524_ok(
    public.mask_contact_for_claim('+2348012345678', 'phone') = '+234•••5678',
    'phone masking renders +234•••5678');

  -- ── (2) A FORWARDED LINK IS REFUSED, AND CONSUMES NOTHING ─────────────────
  SELECT attendance_claim_token_digest, attendance_claim_token_generation
    INTO v_digest_before, v_gen_before
    FROM public.orders WHERE id = pg_temp.i3524_uuid('order-fresh');

  v_res := public.claim_attendance_internal_v2(
    pg_temp.i3524_uuid('stranger'), 'order', v_event,
    pg_temp.i3524_uuid('order-fresh'), decode(repeat('11', 32), 'hex'));
  PERFORM pg_temp.i3524_ok(v_res->>'result' = 'identity_mismatch',
    'a valid token held by an unproved account is identity_mismatch');
  PERFORM pg_temp.i3524_ok(v_res->>'contactChannel' = 'email',
    'the masked hint names the email channel when the order has one');
  PERFORM pg_temp.i3524_ok(v_res->>'contactMasked' = 'a•••@e•••.test',
    'the hint is masked server-side and is never the raw address');

  PERFORM pg_temp.i3524_ok(
    (SELECT attendance_claim_token_digest = v_digest_before
        AND attendance_claim_token_generation IS NOT DISTINCT FROM v_gen_before
        AND buyer_user_id IS NULL
        AND attendance_claim_token_consumed_at IS NULL
       FROM public.orders WHERE id = pg_temp.i3524_uuid('order-fresh')),
    'identity_mismatch consumes NOTHING — digest, generation and buyer survive');

  -- ── (3) THE RIGHTFUL ACCOUNT THEN CLAIMS, FROM THE SAME TOKEN ─────────────
  v_res := public.claim_attendance_internal_v2(
    pg_temp.i3524_uuid('owner'), 'order', v_event,
    pg_temp.i3524_uuid('order-fresh'), decode(repeat('11', 32), 'hex'));
  PERFORM pg_temp.i3524_ok(v_res->>'result' = 'claimed',
    'the proved account claims from the very token the stranger was refused');
  PERFORM pg_temp.i3524_ok((v_res->>'chatJoined')::boolean,
    'chatJoined is true on an event that has a group chat');
  PERFORM pg_temp.i3524_ok(v_res->>'conversationId' IS NOT NULL,
    'the conversation id is returned, read back after the join');
  PERFORM pg_temp.i3524_ok(v_res->>'eventId' = v_event::text, 'eventId is echoed');

  v_conv := (v_res->>'conversationId')::uuid;
  PERFORM pg_temp.i3524_ok(
    EXISTS (SELECT 1 FROM public.conversation_participants
             WHERE conversation_id = v_conv
               AND user_id = pg_temp.i3524_uuid('owner')),
    'the claimant is really a participant, not merely reported as one');
  PERFORM pg_temp.i3524_ok(
    (SELECT buyer_user_id FROM public.orders
      WHERE id = pg_temp.i3524_uuid('order-fresh')) = pg_temp.i3524_uuid('owner'),
    'the ticket is on the claiming account');
  PERFORM pg_temp.i3524_ok(
    (SELECT attendance_claim_token_digest IS NULL
        AND attendance_claim_token_consumed_at IS NOT NULL
       FROM public.orders WHERE id = pg_temp.i3524_uuid('order-fresh')),
    'a SUCCESSFUL claim is what consumes the token');

  -- ONE writer: exactly one conversation for the event, one participant row.
  SELECT count(*) INTO v_n FROM public.conversations
   WHERE event_id = v_event AND linked_entity_type IN ('trip', 'event');
  PERFORM pg_temp.i3524_ok(v_n = 1,
    'add_buyer_to_event_chat ran once — one conversation, never a second writer');
  SELECT count(*) INTO v_n FROM public.conversation_participants
   WHERE conversation_id = v_conv AND user_id = pg_temp.i3524_uuid('owner');
  PERFORM pg_temp.i3524_ok(v_n = 1, 'exactly one participant row for the claimant');

  -- ── (4) THE 30-DAY WINDOW, AND ITS BOUNDARY ───────────────────────────────
  PERFORM pg_temp.i3524_ok(
    public.attendance_claim_token_ttl() = interval '30 days',
    'the emailed claim link ages out at 30 days');

  v_res := public.claim_attendance_internal_v2(
    pg_temp.i3524_uuid('owner2'), 'order', v_event,
    pg_temp.i3524_uuid('order-old'), decode(repeat('22', 32), 'hex'));
  PERFORM pg_temp.i3524_ok(v_res->>'result' = 'expired',
    'a 31-day-old link is expired');
  PERFORM pg_temp.i3524_ok(
    (SELECT attendance_claim_token_digest IS NOT NULL AND buyer_user_id IS NULL
       FROM public.orders WHERE id = pg_temp.i3524_uuid('order-old')),
    'expired consumes NOTHING either');

  v_res := public.claim_attendance_internal_v2(
    pg_temp.i3524_uuid('owner3'), 'order', v_event,
    pg_temp.i3524_uuid('order-29'), decode(repeat('33', 32), 'hex'));
  PERFORM pg_temp.i3524_ok(v_res->>'result' = 'claimed',
    'a 29-day-old link still works — the constant is 30 days, not "recent"');

  -- ── (5) AN EXPERIENCE CLAIMS, AND IS TOLD THE TRUTH ───────────────────────
  v_res := public.claim_attendance_internal_v2(
    pg_temp.i3524_uuid('owner4'), 'order', v_exp,
    pg_temp.i3524_uuid('order-exp'), decode(repeat('44', 32), 'hex'));
  PERFORM pg_temp.i3524_ok(v_res->>'result' = 'claimed',
    'an experience order claims successfully');
  PERFORM pg_temp.i3524_ok((v_res->>'chatJoined')::boolean IS FALSE,
    'chatJoined is FALSE for an event type that has no chat');
  PERFORM pg_temp.i3524_ok(v_res->>'conversationId' IS NULL,
    'and no conversation id is invented');
  PERFORM pg_temp.i3524_ok(
    (SELECT buyer_user_id FROM public.orders
      WHERE id = pg_temp.i3524_uuid('order-exp')) = pg_temp.i3524_uuid('owner4'),
    'the ticket is still linked — no chat is not a failed claim');
  SELECT count(*) INTO v_n FROM public.conversations WHERE event_id = v_exp;
  PERFORM pg_temp.i3524_ok(v_n = 0,
    'no conversation was conjured for the experience');

  -- ── (6) THE DESKTOP HANDOFF: MINT -> REDEEM -> THE ONE CLAIM BODY ─────────
  v_res := public.mint_attendance_claim_handoff(
    'order', v_event, pg_temp.i3524_uuid('order-handoff'),
    decode(repeat('55', 32), 'hex'), NULL, v_code, NULL);
  PERFORM pg_temp.i3524_ok(v_res->>'result' = 'minted', 'the handoff code mints');
  PERFORM pg_temp.i3524_ok(v_res->>'expiresAt' IS NOT NULL, 'and carries its expiry');
  PERFORM pg_temp.i3524_ok(
    (SELECT expires_at <= created_at + interval '10 minutes'
       FROM public.attendance_claim_handoffs
      WHERE source_id = pg_temp.i3524_uuid('order-handoff')),
    'the handoff window is ten minutes');
  PERFORM pg_temp.i3524_ok(
    (SELECT attendance_claim_token_digest IS NOT NULL AND buyer_user_id IS NULL
       FROM public.orders WHERE id = pg_temp.i3524_uuid('order-handoff')),
    'minting VERIFIES the token and never consumes or claims it');

  v_res := public.redeem_attendance_claim_handoff(
    pg_temp.i3524_uuid('owner5'), 'order', v_event,
    pg_temp.i3524_uuid('order-handoff'), v_code);
  PERFORM pg_temp.i3524_ok(v_res->>'result' = 'claimed',
    'redeeming the scanned code claims the ticket');
  PERFORM pg_temp.i3524_ok((v_res->>'chatJoined')::boolean,
    'and joins the chat, because redeem runs THE claim body');
  PERFORM pg_temp.i3524_ok(
    (SELECT consumed_at IS NOT NULL FROM public.attendance_claim_handoffs
      WHERE source_id = pg_temp.i3524_uuid('order-handoff')),
    'the code is single-use and is consumed');

  -- The identity predicate is enforced THROUGH the redeem path too: it is the
  -- same body, so a handoff cannot be used to skip it.
  PERFORM pg_temp.i3524_ok(
    (SELECT count(*) FROM public.conversation_participants cp
      JOIN public.conversations c ON c.id = cp.conversation_id
     WHERE c.event_id = v_event AND cp.user_id = pg_temp.i3524_uuid('owner5')) = 1,
    'the scanned-code claimant is in the one event conversation');

  -- ── (7) THE ATTEMPT LEDGER LEARNED BOTH NEW OUTCOMES ──────────────────────
  INSERT INTO public.attendance_claim_attempts(user_id, kind, completed_at, outcome)
  VALUES (pg_temp.i3524_uuid('stranger'), 'order', now(), 'identity_mismatch'),
         (pg_temp.i3524_uuid('stranger'), 'order', now(), 'expired');
  PERFORM pg_temp.i3524_ok(
    (SELECT count(*) FROM public.attendance_claim_attempts
      WHERE user_id = pg_temp.i3524_uuid('stranger')
        AND outcome IN ('identity_mismatch', 'expired')) = 2,
    'the attempt ledger accepts identity_mismatch and expired');

  -- ── (8) ONE PREDICATE, NOT TWO ────────────────────────────────────────────
  -- The identity rail must reach the rule through the SAME function, so the two
  -- rails can never drift apart.
  PERFORM pg_temp.i3524_ok(
    pg_get_functiondef('public.claim_attendance_internal_v2(uuid,text,uuid,uuid,bytea,bytea)'::regprocedure)
      LIKE '%account_owns_order_contact%',
    'the token rail evaluates the shared predicate');
  PERFORM pg_temp.i3524_ok(
    pg_get_functiondef('public.redeem_attendance_claim_handoff(uuid,text,uuid,uuid,bytea)'::regprocedure)
      LIKE '%claim_attendance_internal_v2%',
    'redeem calls THE claim body rather than copying it');
  PERFORM pg_temp.i3524_ok(
    pg_get_functiondef('public.claim_attendance_by_verified_identity(uuid)'::regprocedure)
      LIKE '%chatJoined%',
    'the identity rail reports chatJoined too — observability parity');

  -- ── (9) THE NEW SURFACES ARE SERVICE-ROLE ONLY ────────────────────────────
  PERFORM pg_temp.i3524_ok(
    NOT has_function_privilege('anon',
      'public.mint_attendance_claim_handoff(text,uuid,uuid,bytea,bytea,bytea,text)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated',
      'public.mint_attendance_claim_handoff(text,uuid,uuid,bytea,bytea,bytea,text)', 'EXECUTE')
    AND has_function_privilege('service_role',
      'public.mint_attendance_claim_handoff(text,uuid,uuid,bytea,bytea,bytea,text)', 'EXECUTE'),
    'minting a handoff is service-role only');
  PERFORM pg_temp.i3524_ok(
    NOT has_function_privilege('anon',
      'public.redeem_attendance_claim_handoff(uuid,text,uuid,uuid,bytea)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated',
      'public.redeem_attendance_claim_handoff(uuid,text,uuid,uuid,bytea)', 'EXECUTE')
    AND has_function_privilege('service_role',
      'public.redeem_attendance_claim_handoff(uuid,text,uuid,uuid,bytea)', 'EXECUTE'),
    'redeeming a handoff is service-role only');
  PERFORM pg_temp.i3524_ok(
    NOT has_table_privilege('anon', 'public.attendance_claim_handoffs', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.attendance_claim_handoffs', 'SELECT')
    AND NOT has_table_privilege('anon', 'public.attendance_claim_handoffs', 'INSERT'),
    'the handoff table grants NOTHING to anon or authenticated');
  PERFORM pg_temp.i3524_ok(
    (SELECT relrowsecurity FROM pg_class
      WHERE oid = 'public.attendance_claim_handoffs'::regclass),
    'row level security is enabled on the handoff table');

  RAISE NOTICE 'issue #3524 attendance-claim implementor happy path: PASS';
END
$t$;

ROLLBACK;
