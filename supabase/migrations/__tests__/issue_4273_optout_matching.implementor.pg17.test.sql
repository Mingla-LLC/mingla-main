-- #4273 polish — opt-out matching (follow-ups 3a, 3b, 3c).
--   3a  a guest order whose contact a verified account owns is graded with that
--       account's opt-outs (verified_phone_identities, GoTrue phone and email).
--   3b  phones compare on one E.164 key: a US number missing its +1 is the US
--       number, never an Egyptian one; a trunk-0 national number matches nothing.
--   3c  (Seth, 2026-11-07, Q1/Q1b) an account-scope unsubscribe belongs to the
--       SENDING HOST's account and holds for every brand that account runs, in
--       all five #4273 readers and the #1778 / #3682 readers.
-- Runs on the fully applied migration chain and rolls back.
--
-- MINGLA-INVARIANT: I-4273-PHONE-MATCH-E164 | issue #4273 | Phone opt-out matching compares issue_4273_phone_key (E.164) values: ten NANP digits are +1, a national number with a trunk 0 never matches, and a different country code never matches.
-- MINGLA-INVARIANT: I-4273-ACCOUNT-SCOPE-IS-THE-SENDING-HOST | issue #4273 | marketing_unsubscribes rows with scope 'account' are keyed to the account that owns the sending brand; they withhold that contact for every brand of that account and for no other, and are never read as the recipient's own account.
-- MINGLA-INVARIANT: I-4273-VERIFIED-IDENTITY-OPT-OUT-AT-INGEST | issue #4273 | A guest order whose phone or email a verified account owns gets no automatic grant when that account opted out.
\set ON_ERROR_STOP on
BEGIN;

CREATE TABLE IF NOT EXISTS auth.identities(
  user_id uuid NOT NULL, provider text NOT NULL, identity_data jsonb NOT NULL,
  provider_id text NOT NULL);
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;

CREATE TEMP TABLE t4273m_fail(id serial, line text) ON COMMIT DROP;
CREATE FUNCTION pg_temp.chk(p_name text, p_ok boolean, p_detail text DEFAULT '') RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF p_ok IS NOT TRUE THEN INSERT INTO t4273m_fail(line) VALUES (p_name || ' :: ' || COALESCE(p_detail, '')); END IF;
END; $f$;
CREATE FUNCTION pg_temp.u(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $f$
  SELECT ('4273f000-0000-4000-8000-' || lpad(p, 12, '0'))::uuid
$f$;
CREATE FUNCTION pg_temp.st(p_brand uuid, p_channel text, p_value text) RETURNS text LANGUAGE sql AS $f$
  SELECT COALESCE(string_agg(DISTINCT m.marketing_consent_state, ',' ORDER BY m.marketing_consent_state), 'none')
    FROM public.brand_person_contact_methods m
   WHERE m.brand_id = p_brand AND m.channel = p_channel AND m.record_state = 'active'
     AND lower(m.normalized_value) = lower(btrim(p_value))
$f$;
CREATE FUNCTION pg_temp.autos(p_value text) RETURNS integer LANGUAGE sql AS $f$
  SELECT count(*)::integer FROM public.consent_records r
   WHERE lower(btrim(r.contact)) = lower(btrim(p_value))
     AND r.source IN ('purchase_auto_optin', 'follow_auto_optin')
$f$;
CREATE FUNCTION pg_temp.ingest(p_order uuid) RETURNS uuid LANGUAGE sql AS $f$
  SELECT (public.biz_resolve_brand_person_source(e.brand_id, o.event_id, 'order', o.id, o.buyer_user_id, NULL,
           public.issue_1770_normalize_email(o.buyer_email),
           public.issue_1770_normalize_phone(o.buyer_phone_e164), o.created_at) ->> 'personId')::uuid
    FROM public.orders o JOIN public.events e ON e.id = o.event_id WHERE o.id = p_order
$f$;

-- ── T-10 the phone key ──────────────────────────────────────────────────────
DO $t10$
DECLARE r record; got text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('2025550199', '+12025550199'),
      ('+2025550199', '+2025550199'),
      ('+1 (202) 555-0199', '+12025550199'),
      ('12025550199', '+12025550199'),
      ('08031100042', NULL),
      ('234 803 110 0043', '+2348031100043'),
      ('2348031100018', '+2348031100018'),
      ('00234 803 110 0043', '+2348031100043'),
      ('0044 20 7946 0958', '+442079460958'),
      ('+448031100041', '+448031100041'),
      ('someone@example.test', NULL),
      ('   ', NULL),
      ('12345', NULL),
      ('+0123456789', NULL)) v(input, want) LOOP
    got := public.issue_4273_phone_key(r.input);
    PERFORM pg_temp.chk('T-10 phone key ' || r.input, got IS NOT DISTINCT FROM r.want, COALESCE(got, 'NULL'));
  END LOOP;
  PERFORM pg_temp.chk('T-10 NULL in, NULL out', public.issue_4273_phone_key(NULL) IS NULL, '');
  PERFORM pg_temp.chk('T-10 the key is service-only',
    NOT has_function_privilege('authenticated', 'public.issue_4273_phone_key(text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.issue_4273_phone_key(text)', 'EXECUTE'), '');
END $t10$;

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- 01 host of b1 and b2. 05 host of b3. 31..33 accounts that verified a contact.
-- 40 a follower (recipient).
INSERT INTO auth.users(id, email)
SELECT pg_temp.u(x), 't4273m-' || x || '@example.test'
  FROM unnest(ARRAY['01', '05', '31', '32', '33', '34', '40']) x;
INSERT INTO public.creator_accounts(id, email) VALUES
  (pg_temp.u('01'), 't4273m-01@example.test'), (pg_temp.u('05'), 't4273m-05@example.test');
INSERT INTO public.brands(id, account_id, name, slug, default_currency, created_at, updated_at) VALUES
  (pg_temp.u('b1'), pg_temp.u('01'), 'Match One', 'issue-4273m-one', 'USD', now(), now()),
  (pg_temp.u('b2'), pg_temp.u('01'), 'Match Two', 'issue-4273m-two', 'USD', now(), now()),
  (pg_temp.u('b3'), pg_temp.u('05'), 'Match Three', 'issue-4273m-three', 'USD', now(), now());
INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone, theme) VALUES
  (pg_temp.u('e1'), pg_temp.u('b1'), pg_temp.u('01'), 'One', 't4273m-one', 'event', 'scheduled', 'public', 'UTC', '{}'::jsonb);

-- ── T-11 (3b) a US number stored without +1 ─────────────────────────────────
INSERT INTO public.channel_suppressions(user_id, contact, channel, scope, reason)
VALUES (NULL, '2025550199', 'sms', 'all', 'stop_keyword');
INSERT INTO public.venue_sms_opt_out(phone_e164, brand_id) VALUES ('0803 110 4277', NULL);
DO $t11$
DECLARE b uuid := pg_temp.u('b1');
BEGIN
  PERFORM pg_temp.chk('T-11a a STOP stored as 2025550199 withholds +12025550199',
    public.issue_4273_marketing_opted_out(b, 'sms', '+12025550199', NULL), '');
  PERFORM pg_temp.chk('T-11b and never the Egyptian +2025550199',
    NOT public.issue_4273_marketing_opted_out(b, 'sms', '+2025550199', NULL), '');
  PERFORM pg_temp.chk('T-11c a trunk-0 national number matches no country',
    NOT public.issue_4273_marketing_opted_out(b, 'sms', '+2348031104277', NULL)
    AND NOT public.issue_4273_marketing_opted_out(b, 'sms', '+448031104277', NULL), '');
END $t11$;

-- ── T-12 (3a) guest orders whose contact a verified account owns ────────────
-- 31 verified +2348031109312 in our ledger and turned SMS off for marketing.
-- 32 holds a GoTrue email identity and suppressed email.
-- 33 holds a GoTrue phone identity stored without '+' and suppressed SMS.
-- 34 verified +2348031109314 and said nothing: its guest order is opted in.
INSERT INTO public.verified_phone_identities(user_id, phone_e164) VALUES
  (pg_temp.u('31'), '+2348031109312'), (pg_temp.u('34'), '+2348031109314');
INSERT INTO auth.identities(user_id, provider, identity_data, provider_id) VALUES
  (pg_temp.u('32'), 'email', '{"email":"Verified.Guest@Example.TEST"}', pg_temp.u('32')::text),
  (pg_temp.u('33'), 'phone', '{"phone":"2348031109313"}', pg_temp.u('33')::text);
INSERT INTO public.channel_suppressions(user_id, contact, channel, scope, reason) VALUES
  (pg_temp.u('31'), NULL, 'sms', 'marketing', 'manual'),
  (pg_temp.u('32'), NULL, 'email', 'marketing', 'manual'),
  (pg_temp.u('33'), NULL, 'sms', 'marketing', 'manual');
INSERT INTO public.orders(id, event_id, buyer_email, buyer_phone_e164, buyer_name, total_cents, currency, payment_status, source, confirmed_at) VALUES
  (pg_temp.u('0a1'), pg_temp.u('e1'), 'g12a@example.test', '+2348031109312', 'Guest A', 1000, 'USD', 'paid', 'legacy', now()),
  (pg_temp.u('0a2'), pg_temp.u('e1'), 'verified.guest@example.test', '+2348031109399', 'Guest B', 1000, 'USD', 'paid', 'legacy', now()),
  (pg_temp.u('0a3'), pg_temp.u('e1'), 'g12c@example.test', '+2348031109313', 'Guest C', 1000, 'USD', 'paid', 'legacy', now()),
  (pg_temp.u('0a4'), pg_temp.u('e1'), 'g12d@example.test', '+2348031109314', 'Guest D', 1000, 'USD', 'paid', 'legacy', now());
DO $t12$
DECLARE b uuid := pg_temp.u('b1');
BEGIN
  PERFORM pg_temp.ingest(pg_temp.u('0a1')); PERFORM pg_temp.ingest(pg_temp.u('0a2'));
  PERFORM pg_temp.ingest(pg_temp.u('0a3')); PERFORM pg_temp.ingest(pg_temp.u('0a4'));
  PERFORM pg_temp.chk('T-12a a guest phone our ledger ties to an opted-out account is withheld, no grant',
    pg_temp.st(b, 'phone', '+2348031109312') = 'withheld' AND pg_temp.autos('+2348031109312') = 0,
    pg_temp.st(b, 'phone', '+2348031109312') || ' autos=' || pg_temp.autos('+2348031109312'));
  PERFORM pg_temp.chk('T-12b a guest email a GoTrue identity ties to an opted-out account is withheld',
    pg_temp.st(b, 'email', 'verified.guest@example.test') = 'withheld' AND pg_temp.autos('verified.guest@example.test') = 0,
    pg_temp.st(b, 'email', 'verified.guest@example.test'));
  PERFORM pg_temp.chk('T-12c a GoTrue phone identity stored without + still ties the account',
    pg_temp.st(b, 'phone', '+2348031109313') = 'withheld', pg_temp.st(b, 'phone', '+2348031109313'));
  PERFORM pg_temp.chk('T-12d the other channel of the same guests stays opted in',
    pg_temp.st(b, 'email', 'g12a@example.test') = 'granted' AND pg_temp.st(b, 'phone', '+2348031109399') = 'granted',
    pg_temp.st(b, 'email', 'g12a@example.test') || '/' || pg_temp.st(b, 'phone', '+2348031109399'));
  PERFORM pg_temp.chk('T-12e a verified account that said nothing changes nothing',
    pg_temp.st(b, 'phone', '+2348031109314') = 'granted', pg_temp.st(b, 'phone', '+2348031109314'));
  PERFORM pg_temp.chk('T-12f the account lookup names the verified accounts',
    EXISTS (SELECT 1 FROM public.issue_4273_contact_accounts(b, 'sms', '+2348031109312') a WHERE a = pg_temp.u('31'))
    AND EXISTS (SELECT 1 FROM public.issue_4273_contact_accounts(b, 'email', 'verified.guest@example.test') a WHERE a = pg_temp.u('32'))
    AND EXISTS (SELECT 1 FROM public.issue_4273_contact_accounts(b, 'phone', '+2348031109313') a WHERE a = pg_temp.u('33')), '');
END $t12$;

-- ── T-13 (3c, Q1 + Q1b) account scope is the sending host ───────────────────
-- 40 follows b1 and b3 and can be reached at follower40@example.test.
INSERT INTO auth.identities(user_id, provider, identity_data, provider_id)
VALUES (pg_temp.u('40'), 'email', '{"email":"follower40@example.test"}', pg_temp.u('40')::text);
INSERT INTO public.profiles(id, first_name, display_name, username, active, has_completed_onboarding, visibility_mode)
VALUES (pg_temp.u('40'), 'F', 'F', 't4273m-40', true, true, 'friends');
INSERT INTO public.brand_follows(user_id, brand_id) VALUES (pg_temp.u('40'), pg_temp.u('b1')), (pg_temp.u('40'), pg_temp.u('b3'));
-- Host 01 (b1, b2) told Mingla: never contact follower40 again from any of my brands.
INSERT INTO public.marketing_unsubscribes(contact_email, channel, scope, account_id, reason)
VALUES ('follower40@example.test', 'email', 'account', pg_temp.u('01'), 't');
-- A row keyed to the recipient's own account, for a different address.
INSERT INTO public.marketing_unsubscribes(contact_email, channel, scope, account_id, reason)
VALUES ('someone-else@example.test', 'all', 'account', pg_temp.u('40'), 't');
DO $t13$
BEGIN
  PERFORM pg_temp.chk('T-13a the host''s account-scope row withholds the contact on every brand that host runs',
    public.issue_4273_marketing_opted_out(pg_temp.u('b1'), 'email', 'follower40@example.test', NULL)
    AND public.issue_4273_marketing_opted_out(pg_temp.u('b2'), 'email', 'follower40@example.test', NULL), '');
  PERFORM pg_temp.chk('T-13b and on no other host''s brand',
    NOT public.issue_4273_marketing_opted_out(pg_temp.u('b3'), 'email', 'follower40@example.test', NULL), '');
  PERFORM pg_temp.chk('T-13c a row keyed to the recipient''s own account no longer withholds them',
    NOT public.issue_4273_marketing_opted_out(pg_temp.u('b3'), 'email', 'follower40@example.test', pg_temp.u('40'))
    AND NOT public.issue_4273_marketing_opted_out(pg_temp.u('b3'), 'sms', '+2348031104040', pg_temp.u('40')), '');
  PERFORM pg_temp.chk('T-13d the address check follows the host',
    public.issue_4273_address_denied(pg_temp.u('b1'), 'email', 'follower40@example.test', NULL) = 'suppressed'
    AND public.issue_4273_address_denied(pg_temp.u('b3'), 'email', 'follower40@example.test', pg_temp.u('40')) IS DISTINCT FROM 'suppressed', '');
  PERFORM pg_temp.chk('T-13e (Q1b) the #3682 follow gate follows the host',
    NOT public.biz_brand_follow_channel_ok(pg_temp.u('40'), pg_temp.u('b1'), 'email')
    AND public.biz_brand_follow_channel_ok(pg_temp.u('40'), pg_temp.u('b3'), 'email'), '');
  PERFORM pg_temp.chk('T-13f (Q1b) the #1778 circle authoriser follows the host',
    (SELECT c.reason FROM public.issue_1778_circle_authorized_contact(pg_temp.u('b1'), pg_temp.u('40'), 'email') c) = 'unsubscribed'
    AND (SELECT c.reason FROM public.issue_1778_circle_authorized_contact(pg_temp.u('b3'), pg_temp.u('40'), 'email') c) <> 'unsubscribed', '');
END $t13$;

DO $r$ DECLARE v text; BEGIN SELECT string_agg(line, E'\n') INTO v FROM t4273m_fail;
  IF v IS NOT NULL THEN RAISE EXCEPTION E'#4273 opt-out matching FAIL:\n%', v; END IF;
  RAISE NOTICE '#4273 opt-out matching: PASS'; END $r$;
ROLLBACK;
