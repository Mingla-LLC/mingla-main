-- issue #3524 — TWO MINTERS, ONE ORDER, AND BOTH LINKS MUST WORK.
--
-- WHAT THIS PROVES, in the words of the bug it closes:
--
--   1. THE RACE. Two callers arm the same order — the confirmation email and
--      the buyer's own confirmation screen — and either can run second. After
--      the second arming, BOTH the first link and the second link redeem. A
--      third, unrelated token still does not.
--   2. A REFUSAL CONSUMES NOTHING. The unrelated token is refused and the order
--      keeps both of its digests, so the real link still works afterwards.
--   3. THE SLOT HOLDS ONE. A previously issued link survives exactly ONE
--      rotation. A second rotation retires the oldest of the three and keeps the
--      two most recent, so at most two links are live at a time — exactly the
--      number of minters.
--   4. SINGLE USE IS STILL SINGLE USE. The first of the two live links to be
--      redeemed consumes the order and clears BOTH slots, so the other one is
--      dead from that moment.
--   5. NOTHING ELSE MOVED: the `already_issued` early return still refuses a
--      non-rotating re-arm and writes nothing, and the `legacy_v1` arm still
--      puts the NEW digest in the second slot, because on that generation the
--      active proof IS the legacy proof.
--
-- HOW A CLAIM IS PRESENTED HERE. The Edge function computes one digest per
-- pepper it can read and sends both candidates; with a single reader it sends
-- the same digest twice. Every claim below is presented that way — the token
-- under test in BOTH candidate positions — so the row's second slot is compared
-- exactly as it is in production.
--
-- WHY THE CLAIMANTS PROVE A PHONE. `claim_attendance_internal_v2` requires the
-- claiming account to show the order's own contact reaches it
-- (`public.account_owns_order_contact`). #2269's verified-phone ledger is our
-- own service-role-only table and needs no GoTrue tables, which this lane's
-- PostgreSQL image does not ship. The gate runs AFTER the digest comparison, so
-- it changes none of the refusals asserted here, but a claim expected to SUCCEED
-- has to get past it or the rule being measured is never reached.
--
-- Runs inside one transaction and ROLLBACKs, so it is re-runnable:
--   psql -v ON_ERROR_STOP=1 -f <this file>

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.i3524rot_uuid(seed text) RETURNS uuid
LANGUAGE sql IMMUTABLE AS $$
  SELECT (substr(md5('issue3524rot:'||seed),1,8)||'-'||substr(md5('issue3524rot:'||seed),9,4)
       ||'-4'||substr(md5('issue3524rot:'||seed),14,3)||'-8'||substr(md5('issue3524rot:'||seed),18,3)
       ||'-'||substr(md5('issue3524rot:'||seed),21,12))::uuid
$$;

-- One distinct 32-byte value per named token. These stand in for the HMAC the
-- Edge function computes; the database only ever sees the digest.
CREATE OR REPLACE FUNCTION pg_temp.i3524rot_digest(seed text) RETURNS bytea
LANGUAGE sql IMMUTABLE AS $$
  SELECT decode(md5('issue3524rot-token:'||seed)
              || md5('issue3524rot-token-tail:'||seed), 'hex')
$$;

CREATE OR REPLACE FUNCTION pg_temp.i3524rot_ok(claim boolean, label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF claim IS NOT TRUE THEN RAISE EXCEPTION 'issue_3524 FAILED: %', label; END IF;
END;
$$;

-- Arm an order the way a minter does, and fail loudly if the RPC refused.
CREATE OR REPLACE FUNCTION pg_temp.i3524rot_arm(
  p_order_seed text,
  p_token_seed text,
  p_generation text,
  p_allow_rotation boolean,
  p_expected text
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_res jsonb;
BEGIN
  v_res := public.issue_order_attendance_claim_proof_v2(
    pg_temp.i3524rot_uuid(p_order_seed),
    pg_temp.i3524rot_uuid('event'),
    pg_temp.i3524rot_digest(p_token_seed),
    p_generation,
    p_allow_rotation);
  IF v_res->>'result' <> p_expected THEN
    RAISE EXCEPTION 'issue_3524 FAILED: arming % with % expected % but got %',
      p_order_seed, p_token_seed, p_expected, v_res;
  END IF;
END;
$$;

-- Present one token as BOTH candidates, exactly as a single-reader Edge
-- function does, and hand back the RPC's verdict.
CREATE OR REPLACE FUNCTION pg_temp.i3524rot_claim(
  p_user_seed text,
  p_order_seed text,
  p_token_seed text
) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  RETURN public.claim_attendance_internal_v2(
    pg_temp.i3524rot_uuid(p_user_seed),
    'order',
    pg_temp.i3524rot_uuid('event'),
    pg_temp.i3524rot_uuid(p_order_seed),
    pg_temp.i3524rot_digest(p_token_seed),
    pg_temp.i3524rot_digest(p_token_seed)
  )->>'result';
END;
$$;

SET session_replication_role = replica;

-- ── The host and one public, scheduled, ticketed event ──────────────────────
INSERT INTO auth.users(id) VALUES (pg_temp.i3524rot_uuid('creator'));
INSERT INTO public.creator_accounts(id, email)
VALUES (pg_temp.i3524rot_uuid('creator'), 'issue3524rot-creator@example.test');
INSERT INTO public.brands(id, account_id, name, slug)
VALUES (pg_temp.i3524rot_uuid('brand'), pg_temp.i3524rot_uuid('creator'),
        'Issue 3524 Rotation', 'issue-3524-rotation-keeps-the-previous-link');
INSERT INTO public.events(
  id, brand_id, created_by, title, slug, event_type, status, visibility,
  timezone, theme
) VALUES (
  pg_temp.i3524rot_uuid('event'), pg_temp.i3524rot_uuid('brand'),
  pg_temp.i3524rot_uuid('creator'), 'Issue 3524 Rotation Event',
  'issue-3524-rotation-event', 'event', 'scheduled', 'public', 'UTC',
  '{}'::jsonb);
INSERT INTO public.ticket_types(
  id, event_id, name, price_cents, currency, quantity_total
) VALUES (
  pg_temp.i3524rot_uuid('tier'), pg_temp.i3524rot_uuid('event'),
  'General', 1000, 'USD', 50);

-- ── Six identical purchases, one per scenario ───────────────────────────────
--
-- Nothing is pre-armed: every digest below is written by the arming RPC itself,
-- which is the function under test. Each order carries its own number and each
-- claimant has proved that number, because the ledger is keyed by number.
INSERT INTO auth.users(id) VALUES
  (pg_temp.i3524rot_uuid('guest-first')),
  (pg_temp.i3524rot_uuid('guest-second')),
  (pg_temp.i3524rot_uuid('guest-stranger')),
  (pg_temp.i3524rot_uuid('guest-third')),
  (pg_temp.i3524rot_uuid('guest-newest'));
INSERT INTO public.verified_phone_identities(user_id, phone_e164) VALUES
  (pg_temp.i3524rot_uuid('guest-first'),    '+15550350101'),
  (pg_temp.i3524rot_uuid('guest-second'),   '+15550350102'),
  (pg_temp.i3524rot_uuid('guest-stranger'), '+15550350103'),
  (pg_temp.i3524rot_uuid('guest-third'),    '+15550350104'),
  (pg_temp.i3524rot_uuid('guest-newest'),   '+15550350105');

INSERT INTO public.orders(
  id, event_id, buyer_email, buyer_phone_e164, buyer_name, total_cents,
  currency, payment_status, source
) VALUES
  -- the emailed link is redeemed after the screen rotated the token
  (pg_temp.i3524rot_uuid('order-emailed'), pg_temp.i3524rot_uuid('event'),
   NULL, '+15550350101', 'Emailed', 1000, 'USD', 'paid', 'online_checkout'),
  -- the screen's own link is redeemed
  (pg_temp.i3524rot_uuid('order-screen'), pg_temp.i3524rot_uuid('event'),
   NULL, '+15550350102', 'Screen', 1000, 'USD', 'paid', 'online_checkout'),
  -- a token this order never had
  (pg_temp.i3524rot_uuid('order-stranger'), pg_temp.i3524rot_uuid('event'),
   NULL, '+15550350103', 'Stranger', 1000, 'USD', 'paid', 'online_checkout'),
  -- armed three times: the oldest is retired, the middle one still redeems
  (pg_temp.i3524rot_uuid('order-thrice'), pg_temp.i3524rot_uuid('event'),
   NULL, '+15550350104', 'Thrice', 1000, 'USD', 'paid', 'online_checkout'),
  -- armed three times: the newest redeems
  (pg_temp.i3524rot_uuid('order-thrice2'), pg_temp.i3524rot_uuid('event'),
   NULL, '+15550350105', 'Thrice Two', 1000, 'USD', 'paid', 'online_checkout'),
  -- the non-rotating re-arm, and the legacy_v1 arm
  (pg_temp.i3524rot_uuid('order-noretry'), pg_temp.i3524rot_uuid('event'),
   NULL, '+15550350106', 'No Retry', 1000, 'USD', 'paid', 'online_checkout'),
  (pg_temp.i3524rot_uuid('order-legacy'), pg_temp.i3524rot_uuid('event'),
   NULL, '+15550350107', 'Legacy', 1000, 'USD', 'paid', 'online_checkout');

INSERT INTO public.tickets(
  id, order_id, ticket_type_id, event_id, qr_code, status, approval_status
) VALUES
  (pg_temp.i3524rot_uuid('tk-emailed'), pg_temp.i3524rot_uuid('order-emailed'),
   pg_temp.i3524rot_uuid('tier'), pg_temp.i3524rot_uuid('event'),
   'i3524rot-emailed', 'valid', 'auto'),
  (pg_temp.i3524rot_uuid('tk-screen'), pg_temp.i3524rot_uuid('order-screen'),
   pg_temp.i3524rot_uuid('tier'), pg_temp.i3524rot_uuid('event'),
   'i3524rot-screen', 'valid', 'auto'),
  (pg_temp.i3524rot_uuid('tk-stranger'), pg_temp.i3524rot_uuid('order-stranger'),
   pg_temp.i3524rot_uuid('tier'), pg_temp.i3524rot_uuid('event'),
   'i3524rot-stranger', 'valid', 'auto'),
  (pg_temp.i3524rot_uuid('tk-thrice'), pg_temp.i3524rot_uuid('order-thrice'),
   pg_temp.i3524rot_uuid('tier'), pg_temp.i3524rot_uuid('event'),
   'i3524rot-thrice', 'valid', 'auto'),
  (pg_temp.i3524rot_uuid('tk-thrice2'), pg_temp.i3524rot_uuid('order-thrice2'),
   pg_temp.i3524rot_uuid('tier'), pg_temp.i3524rot_uuid('event'),
   'i3524rot-thrice2', 'valid', 'auto'),
  (pg_temp.i3524rot_uuid('tk-noretry'), pg_temp.i3524rot_uuid('order-noretry'),
   pg_temp.i3524rot_uuid('tier'), pg_temp.i3524rot_uuid('event'),
   'i3524rot-noretry', 'valid', 'auto'),
  (pg_temp.i3524rot_uuid('tk-legacy'), pg_temp.i3524rot_uuid('order-legacy'),
   pg_temp.i3524rot_uuid('tier'), pg_temp.i3524rot_uuid('event'),
   'i3524rot-legacy', 'valid', 'auto');

SET session_replication_role = origin;

-- ═══════════════════════════════════════════════════════════════════════════
-- (1) THE RACE — the email arms first, the confirmation screen arms second.
--     Both links must redeem.
-- ═══════════════════════════════════════════════════════════════════════════
DO $race$
BEGIN
  -- The dispatch that sends the mail: no rotation allowed.
  PERFORM pg_temp.i3524rot_arm('order-emailed', 'emailed-a', 'governed_v2', false, 'issued');
  -- The buyer's confirmation screen, five seconds later: rotation allowed.
  PERFORM pg_temp.i3524rot_arm('order-emailed', 'emailed-b', 'governed_v2', true, 'issued');

  -- The row itself: the newest digest is active and the OUTGOING one was kept.
  PERFORM pg_temp.i3524rot_ok(EXISTS (
    SELECT 1 FROM public.orders
     WHERE id = pg_temp.i3524rot_uuid('order-emailed')
       AND attendance_claim_token_digest = pg_temp.i3524rot_digest('emailed-b')
       AND attendance_claim_token_generation = 'governed_v2'
       AND attendance_claim_legacy_token_digest = pg_temp.i3524rot_digest('emailed-a')
       AND attendance_claim_legacy_token_created_at IS NOT NULL
       AND attendance_claim_token_consumed_at IS NULL),
    'a rotation must keep the outgoing digest instead of discarding it');

  -- THE DEFECT, stated as a claim: the link that was EMAILED still redeems
  -- after the confirmation screen armed the order again.
  PERFORM pg_temp.i3524rot_ok(
    pg_temp.i3524rot_claim('guest-first', 'order-emailed', 'emailed-a') = 'claimed',
    'the emailed link must still redeem after the confirmation screen rotated '
      || 'the token');

  -- (4) SINGLE USE. Both slots are cleared together, so the other live link is
  -- dead from this moment and a replay of the one just used is refused.
  PERFORM pg_temp.i3524rot_ok(EXISTS (
    SELECT 1 FROM public.orders
     WHERE id = pg_temp.i3524rot_uuid('order-emailed')
       AND buyer_user_id = pg_temp.i3524rot_uuid('guest-first')
       AND attendance_claim_token_digest IS NULL
       AND attendance_claim_token_generation IS NULL
       AND attendance_claim_legacy_token_digest IS NULL
       AND attendance_claim_legacy_token_created_at IS NULL
       AND attendance_claim_token_consumed_at IS NOT NULL),
    'one claim must retire BOTH digests and consume the order');
  -- Presented again, by the account that just used it, on the order it just
  -- took: the consumed order answers `invalid` and nothing is re-issued. (The
  -- second link is unreachable by construction — the assertion above shows both
  -- slots are empty — and a DIFFERENT account would be answered `conflict` by
  -- the ownership check long before any digest is compared.)
  PERFORM pg_temp.i3524rot_ok(
    pg_temp.i3524rot_claim('guest-first', 'order-emailed', 'emailed-b') = 'invalid',
    'a consumed order must refuse the other link rather than claim twice');

  -- The mirror image: the link the SCREEN is holding redeems too.
  PERFORM pg_temp.i3524rot_arm('order-screen', 'screen-a', 'governed_v2', false, 'issued');
  PERFORM pg_temp.i3524rot_arm('order-screen', 'screen-b', 'governed_v2', true, 'issued');
  PERFORM pg_temp.i3524rot_ok(
    pg_temp.i3524rot_claim('guest-second', 'order-screen', 'screen-b') = 'claimed',
    'the newest link must redeem as it always did');
END;
$race$;

-- ═══════════════════════════════════════════════════════════════════════════
-- (2) A THIRD, UNRELATED TOKEN IS STILL REFUSED — and refusing it costs the
--     order nothing.
-- ═══════════════════════════════════════════════════════════════════════════
DO $stranger$
BEGIN
  PERFORM pg_temp.i3524rot_arm('order-stranger', 'stranger-a', 'governed_v2', false, 'issued');
  PERFORM pg_temp.i3524rot_arm('order-stranger', 'stranger-b', 'governed_v2', true, 'issued');

  PERFORM pg_temp.i3524rot_ok(
    pg_temp.i3524rot_claim('guest-stranger', 'order-stranger', 'never-issued')
      = 'invalid',
    'a token this order never carried must NOT redeem — two live links, not any '
      || 'link');

  PERFORM pg_temp.i3524rot_ok(EXISTS (
    SELECT 1 FROM public.orders
     WHERE id = pg_temp.i3524rot_uuid('order-stranger')
       AND buyer_user_id IS NULL
       AND attendance_claim_token_digest = pg_temp.i3524rot_digest('stranger-b')
       AND attendance_claim_legacy_token_digest = pg_temp.i3524rot_digest('stranger-a')
       AND attendance_claim_token_consumed_at IS NULL),
    'a refusal must consume nothing');
  PERFORM pg_temp.i3524rot_ok(
    pg_temp.i3524rot_claim('guest-stranger', 'order-stranger', 'stranger-a')
      = 'claimed',
    'and the real link must still work after that refusal');
END;
$stranger$;

-- ═══════════════════════════════════════════════════════════════════════════
-- (3) THE SLOT HOLDS ONE — a link survives exactly ONE rotation. Two minters
--     means at most two live links; a third arming retires the oldest.
-- ═══════════════════════════════════════════════════════════════════════════
DO $thrice$
BEGIN
  PERFORM pg_temp.i3524rot_arm('order-thrice', 'thrice-a', 'governed_v2', false, 'issued');
  PERFORM pg_temp.i3524rot_arm('order-thrice', 'thrice-b', 'governed_v2', true, 'issued');
  PERFORM pg_temp.i3524rot_arm('order-thrice', 'thrice-c', 'governed_v2', true, 'issued');

  PERFORM pg_temp.i3524rot_ok(EXISTS (
    SELECT 1 FROM public.orders
     WHERE id = pg_temp.i3524rot_uuid('order-thrice')
       AND attendance_claim_token_digest = pg_temp.i3524rot_digest('thrice-c')
       AND attendance_claim_legacy_token_digest = pg_temp.i3524rot_digest('thrice-b')),
    'a second rotation must keep the two most recent digests');
  PERFORM pg_temp.i3524rot_ok(NOT EXISTS (
    SELECT 1 FROM public.orders
     WHERE attendance_claim_token_digest = pg_temp.i3524rot_digest('thrice-a')
        OR attendance_claim_legacy_token_digest = pg_temp.i3524rot_digest('thrice-a')),
    'the oldest of three must be retired — the slot holds one, not a history');

  PERFORM pg_temp.i3524rot_ok(
    pg_temp.i3524rot_claim('guest-third', 'order-thrice', 'thrice-a') = 'invalid',
    'the retired oldest link must no longer redeem');
  PERFORM pg_temp.i3524rot_ok(
    pg_temp.i3524rot_claim('guest-third', 'order-thrice', 'thrice-b') = 'claimed',
    'the previously issued link must survive exactly one rotation');

  PERFORM pg_temp.i3524rot_arm('order-thrice2', 'thrice2-a', 'governed_v2', false, 'issued');
  PERFORM pg_temp.i3524rot_arm('order-thrice2', 'thrice2-b', 'governed_v2', true, 'issued');
  PERFORM pg_temp.i3524rot_arm('order-thrice2', 'thrice2-c', 'governed_v2', true, 'issued');
  PERFORM pg_temp.i3524rot_ok(
    pg_temp.i3524rot_claim('guest-newest', 'order-thrice2', 'thrice2-c') = 'claimed',
    'and the newest link redeems whatever came before it');
END;
$thrice$;

-- ═══════════════════════════════════════════════════════════════════════════
-- (5) NOTHING ELSE MOVED.
-- ═══════════════════════════════════════════════════════════════════════════
DO $unchanged$
DECLARE
  v_legacy_created timestamptz;
BEGIN
  -- The `already_issued` early return: a non-rotating re-arm still refuses, and
  -- it writes NOTHING — not the active digest, and not the second slot.
  PERFORM pg_temp.i3524rot_arm('order-noretry', 'noretry-a', 'governed_v2', false, 'issued');
  PERFORM pg_temp.i3524rot_arm('order-noretry', 'noretry-b', 'governed_v2', false, 'already_issued');
  PERFORM pg_temp.i3524rot_ok(EXISTS (
    SELECT 1 FROM public.orders
     WHERE id = pg_temp.i3524rot_uuid('order-noretry')
       AND attendance_claim_token_digest = pg_temp.i3524rot_digest('noretry-a')
       AND attendance_claim_legacy_token_digest IS NULL
       AND attendance_claim_legacy_token_created_at IS NULL),
    'a refused re-arm must leave the order exactly as it was');

  -- The `legacy_v1` arm is untouched: on that generation the active proof IS the
  -- legacy proof, so the slot holds the NEW digest rather than the outgoing one.
  PERFORM pg_temp.i3524rot_arm('order-legacy', 'legacy-a', 'legacy_v1', false, 'issued');
  PERFORM pg_temp.i3524rot_ok(EXISTS (
    SELECT 1 FROM public.orders
     WHERE id = pg_temp.i3524rot_uuid('order-legacy')
       AND attendance_claim_token_digest = pg_temp.i3524rot_digest('legacy-a')
       AND attendance_claim_token_generation = 'legacy_v1'
       AND attendance_claim_legacy_token_digest = pg_temp.i3524rot_digest('legacy-a')),
    'the legacy_v1 arm must still record the active proof as the legacy proof');
  SELECT attendance_claim_legacy_token_created_at INTO v_legacy_created
    FROM public.orders WHERE id = pg_temp.i3524rot_uuid('order-legacy');
  PERFORM pg_temp.i3524rot_ok(v_legacy_created IS NOT NULL,
    'and it must stamp the legacy slot, because the pair constraint requires it');

  PERFORM pg_temp.i3524rot_arm('order-legacy', 'legacy-b', 'legacy_v1', true, 'issued');
  PERFORM pg_temp.i3524rot_ok(EXISTS (
    SELECT 1 FROM public.orders
     WHERE id = pg_temp.i3524rot_uuid('order-legacy')
       AND attendance_claim_token_digest = pg_temp.i3524rot_digest('legacy-b')
       AND attendance_claim_legacy_token_digest = pg_temp.i3524rot_digest('legacy-b')),
    'a legacy_v1 rotation must still point BOTH slots at the new digest');
END;
$unchanged$;

ROLLBACK;
