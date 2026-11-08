-- #4273 tester adversarial — an explicit opt-out always wins over the automatic
-- buyer / follower opt-in. Attacks every opt-out ledger against all three
-- writers (the ingest grader, the backfill, the brand_follows trigger), checks
-- that a later purchase or follow never undoes an opt-out, that an opt-out on
-- one channel never blocks the other, that case / whitespace variants of an
-- address still match, that the backfill is idempotent, and that the follow
-- trigger can never fail or block a follow. Runs on the fully applied
-- migration chain and rolls back.
\set ON_ERROR_STOP on
BEGIN;

CREATE TABLE IF NOT EXISTS auth.identities(user_id uuid, provider text, identity_data jsonb);
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;

CREATE TEMP TABLE t4273t_fail(id serial, line text) ON COMMIT DROP;
CREATE FUNCTION pg_temp.chk(p_name text, p_ok boolean, p_detail text DEFAULT '') RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF p_ok IS NOT TRUE THEN INSERT INTO t4273t_fail(line) VALUES (p_name || ' :: ' || COALESCE(p_detail, '')); END IF;
END; $f$;
CREATE FUNCTION pg_temp.u(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $f$
  SELECT ('4273d000-0000-4000-8000-' || lpad(p, 12, '0'))::uuid
$f$;
-- Every Book contact of brand b on this address, as 'channel=state' (one per row).
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
-- What the production enqueue path does: normalise, then resolve.
CREATE FUNCTION pg_temp.ingest(p_order uuid) RETURNS uuid LANGUAGE sql AS $f$
  SELECT (public.biz_resolve_brand_person_source(e.brand_id, o.event_id, 'order', o.id, o.buyer_user_id, NULL,
           public.issue_1770_normalize_email(o.buyer_email),
           public.issue_1770_normalize_phone(o.buyer_phone_e164), o.created_at) ->> 'personId')::uuid
    FROM public.orders o JOIN public.events e ON e.id = o.event_id WHERE o.id = p_order
$f$;

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- 01 owner. 03 / 05 logged-in buyers. 21..27 followers.
INSERT INTO auth.users(id, email)
SELECT pg_temp.u(x), 't4273t-' || x || '@example.test'
  FROM unnest(ARRAY['01', '03', '05', '21', '22', '23', '24', '25', '26', '27']) x;
INSERT INTO public.creator_accounts(id, email) VALUES (pg_temp.u('01'), 't4273t-01@example.test');
INSERT INTO public.brands(id, account_id, name, slug, default_currency, created_at, updated_at) VALUES
  (pg_temp.u('b1'), pg_temp.u('01'), 'Optout One', 'issue-4273t-one', 'USD', now(), now()),
  (pg_temp.u('b2'), pg_temp.u('01'), 'Optout Two', 'issue-4273t-two', 'USD', now(), now());
INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone, theme) VALUES
  (pg_temp.u('e1'), pg_temp.u('b1'), pg_temp.u('01'), 'One', 't4273t-one', 'event', 'scheduled', 'public', 'UTC', '{}'::jsonb),
  (pg_temp.u('e2'), pg_temp.u('b2'), pg_temp.u('01'), 'Two', 't4273t-two', 'event', 'scheduled', 'public', 'UTC', '{}'::jsonb);

-- Buyers on brand b1. Emails are typed with odd case; the resolver normalises.
INSERT INTO public.orders(id, event_id, buyer_user_id, buyer_email, buyer_phone_e164, buyer_name, total_cents, currency, payment_status, source, confirmed_at)
SELECT pg_temp.u('0' || x), pg_temp.u('e1'), CASE x WHEN '03' THEN pg_temp.u('03') WHEN '05' THEN pg_temp.u('05') END,
       'O' || x || '@Example.TEST', CASE x WHEN '16' THEN '+12025550116' ELSE '+23480311000' || x END,
       'Buyer ' || x, 1000, 'USD', 'paid', 'legacy', now()
  FROM unnest(ARRAY['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '14', '15', '16', '17']) x;

-- O01 brand unsubscribe on email, stored with case + whitespace noise.
INSERT INTO public.marketing_unsubscribes(contact_email, channel, scope, brand_id, reason)
VALUES ('  O01@EXAMPLE.test ', 'email', 'brand', pg_temp.u('b1'), 't');
-- O02 unsubscribed from ANOTHER brand only.
INSERT INTO public.marketing_unsubscribes(contact_email, channel, scope, brand_id, reason)
VALUES ('o02@example.test', 'email', 'brand', pg_temp.u('b2'), 't');
-- O03 account-scope unsubscribe from the sending host's account (#4273 Q1:
-- account scope is the host that owns the brand; 01 owns b1).
INSERT INTO public.marketing_unsubscribes(contact_email, channel, scope, account_id, reason)
VALUES ('o03@example.test', 'email', 'account', pg_temp.u('01'), 't');
-- O04 STOP on the phone; email suppression stored upper-case.
INSERT INTO public.channel_suppressions(user_id, contact, channel, scope, reason) VALUES
  (NULL, '+2348031100004', 'sms', 'all', 'stop_keyword'),
  (NULL, 'O04@EXAMPLE.TEST', 'email', 'marketing', 'unsubscribe');
-- O05 suppression keyed by the buyer's account only (no contact).
INSERT INTO public.channel_suppressions(user_id, contact, channel, scope, reason)
VALUES (pg_temp.u('05'), NULL, 'email', 'marketing', 'manual');
-- O06 global venue SMS opt-out. O07 venue opt-out for the OTHER brand only.
INSERT INTO public.venue_sms_opt_out(phone_e164, brand_id) VALUES
  ('+2348031100006', NULL), ('+2348031100007', pg_temp.u('b2'));
-- O08 host-side suppression on an existing Book row holding the email.
-- O09 the same, but the suppression was lifted.
INSERT INTO public.brand_people(id, brand_id, display_name, record_status) VALUES
  (pg_temp.u('a08'), pg_temp.u('b1'), 'Manual 08', 'active'),
  (pg_temp.u('a09'), pg_temp.u('b1'), 'Manual 09', 'active');
INSERT INTO public.brand_person_contact_methods(brand_id, brand_person_id, channel, normalized_value, provenance_scope, is_exportable, is_primary, record_state, marketing_consent_state) VALUES
  (pg_temp.u('b1'), pg_temp.u('a08'), 'email', 'o08@example.test', 'brand_owned', true, true, 'active', 'unknown'),
  (pg_temp.u('b1'), pg_temp.u('a09'), 'email', 'o09@example.test', 'brand_owned', true, true, 'active', 'unknown');
INSERT INTO public.brand_person_channel_suppressions(brand_id, brand_person_id, channel, scope, reason, origin_table, lifted_at) VALUES
  (pg_temp.u('b1'), pg_temp.u('a08'), 'email', 'marketing', 'host_unsubscribe', 't4273t', NULL),
  (pg_temp.u('b1'), pg_temp.u('a09'), 'email', 'marketing', 'host_unsubscribe', 't4273t', now());
-- O10 global revocation. O11 revocation followed by an AUTOMATIC grant row.
-- O12 revocation followed by the person's own explicit re-grant. O13 revoked for b2 only.
INSERT INTO public.consent_records(contact, channel, scope, action, source, brand_id, created_at) VALUES
  ('o10@example.test', 'email', 'marketing', 'revoked', 'prefs_ui', NULL, now() - interval '2 days'),
  ('o11@example.test', 'email', 'marketing', 'revoked', 'prefs_ui', pg_temp.u('b1'), now() - interval '2 days'),
  ('o11@example.test', 'email', 'marketing', 'granted', 'follow_auto_optin', pg_temp.u('b1'), now() - interval '1 day'),
  ('o12@example.test', 'email', 'marketing', 'revoked', 'prefs_ui', pg_temp.u('b1'), now() - interval '2 days'),
  ('o12@example.test', 'email', 'marketing', 'granted', 'checkout', pg_temp.u('b1'), now() - interval '1 day'),
  ('o13@example.test', 'email', 'marketing', 'revoked', 'prefs_ui', pg_temp.u('b2'), now() - interval '1 day');
-- O14 global unsubscribe on email for every channel. O15 SMS unsubscribe, phone
-- stored with trailing whitespace.
INSERT INTO public.marketing_unsubscribes(contact_email, contact_phone, channel, scope, reason) VALUES
  ('o14@example.test', NULL, 'all', 'global', 't'),
  (NULL, '+2348031100015 ', 'sms', 'global', 't');
-- O16 a quiet US buyer. O17 a quiet Nigerian buyer.

DO $grade$
DECLARE b uuid := pg_temp.u('b1'); x text;
BEGIN
  FOREACH x IN ARRAY ARRAY['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '14', '15', '16', '17'] LOOP
    PERFORM pg_temp.ingest(pg_temp.u('0' || x));
  END LOOP;

  PERFORM pg_temp.chk('G-01 brand unsubscribe (case/space noise) withholds email; phone still opted in',
    pg_temp.st(b, 'email', 'o01@example.test') = 'withheld' AND pg_temp.st(b, 'phone', '+2348031100001') = 'granted'
    AND pg_temp.autos('o01@example.test') = 0,
    pg_temp.st(b, 'email', 'o01@example.test') || '/' || pg_temp.st(b, 'phone', '+2348031100001'));
  PERFORM pg_temp.chk('G-02 an unsubscribe from another brand does not withhold this one',
    pg_temp.st(b, 'email', 'o02@example.test') = 'granted', pg_temp.st(b, 'email', 'o02@example.test'));
  PERFORM pg_temp.chk('G-03 an account-scope unsubscribe from the sending host''s account withholds email',
    pg_temp.st(b, 'email', 'o03@example.test') = 'withheld' AND pg_temp.autos('o03@example.test') = 0,
    pg_temp.st(b, 'email', 'o03@example.test') || ' autos=' || pg_temp.autos('o03@example.test'));
  PERFORM pg_temp.chk('G-05 an account-keyed suppression withholds the logged-in buyer''s email',
    pg_temp.st(b, 'email', 'o05@example.test') = 'withheld' AND pg_temp.autos('o05@example.test') = 0,
    pg_temp.st(b, 'email', 'o05@example.test') || ' autos=' || pg_temp.autos('o05@example.test'));
  PERFORM pg_temp.chk('G-05b an email-only account opt-out leaves that buyer''s SMS opted in',
    pg_temp.st(b, 'phone', '+2348031100003') = 'granted' AND pg_temp.st(b, 'phone', '+2348031100005') = 'granted',
    pg_temp.st(b, 'phone', '+2348031100003') || '/' || pg_temp.st(b, 'phone', '+2348031100005'));
  PERFORM pg_temp.chk('G-04 STOP withholds the phone; an upper-case email suppression withholds the email',
    pg_temp.st(b, 'phone', '+2348031100004') = 'withheld' AND pg_temp.st(b, 'email', 'o04@example.test') = 'withheld'
    AND pg_temp.autos('+2348031100004') = 0 AND pg_temp.autos('o04@example.test') = 0,
    pg_temp.st(b, 'phone', '+2348031100004') || '/' || pg_temp.st(b, 'email', 'o04@example.test'));
  PERFORM pg_temp.chk('G-06 a global venue SMS opt-out withholds the phone only',
    pg_temp.st(b, 'phone', '+2348031100006') = 'withheld' AND pg_temp.st(b, 'email', 'o06@example.test') = 'granted',
    pg_temp.st(b, 'phone', '+2348031100006') || '/' || pg_temp.st(b, 'email', 'o06@example.test'));
  PERFORM pg_temp.chk('G-07 a venue opt-out for another brand does not withhold this one',
    pg_temp.st(b, 'phone', '+2348031100007') = 'granted', pg_temp.st(b, 'phone', '+2348031100007'));
  -- The order on an address a manual Book row already holds goes to a merge
  -- conflict, so the host-suppression arm is driven through the grader the
  -- ingest calls, with the same arguments.
  PERFORM pg_temp.chk('G-08 a host-side suppression on any Book row holding the email withholds the buyer',
    (SELECT g.state FROM public.issue_3524_grade_marketing_consent('order', b, 'email', 'O08@example.test ') g) = 'withheld'
    AND pg_temp.autos('o08@example.test') = 0, '');
  PERFORM pg_temp.chk('G-08b and the follower-side trigger arm sees it too',
    public.issue_4273_marketing_opted_out(b, 'email', 'o08@example.test', NULL)
    AND public.issue_4273_record_auto_optin(b, 'email', 'o08@example.test', 'follow_auto_optin', NULL) IS NULL, '');
  PERFORM pg_temp.chk('G-09 a LIFTED host suppression no longer withholds',
    (SELECT g.state FROM public.issue_3524_grade_marketing_consent('order', b, 'email', 'o09@example.test') g) = 'granted', '');
  PERFORM pg_temp.chk('G-10 a global revocation withholds',
    pg_temp.st(b, 'email', 'o10@example.test') = 'withheld', pg_temp.st(b, 'email', 'o10@example.test'));
  PERFORM pg_temp.chk('G-11 an automatic grant written after a revocation never reverses it',
    pg_temp.st(b, 'email', 'o11@example.test') = 'withheld', pg_temp.st(b, 'email', 'o11@example.test'));
  PERFORM pg_temp.chk('G-12 the person''s own later grant does reverse their revocation, with no auto row',
    pg_temp.st(b, 'email', 'o12@example.test') = 'granted' AND pg_temp.autos('o12@example.test') = 0,
    pg_temp.st(b, 'email', 'o12@example.test'));
  PERFORM pg_temp.chk('G-13 a revocation given to another brand does not withhold this one',
    pg_temp.st(b, 'email', 'o13@example.test') = 'granted', pg_temp.st(b, 'email', 'o13@example.test'));
  PERFORM pg_temp.chk('G-14 a global all-channel email unsubscribe withholds email but not the phone',
    pg_temp.st(b, 'email', 'o14@example.test') = 'withheld' AND pg_temp.st(b, 'phone', '+2348031100014') = 'granted',
    pg_temp.st(b, 'email', 'o14@example.test') || '/' || pg_temp.st(b, 'phone', '+2348031100014'));
  PERFORM pg_temp.chk('G-15 an SMS unsubscribe stored with trailing whitespace withholds the phone, email stays in',
    pg_temp.st(b, 'phone', '+2348031100015') = 'withheld' AND pg_temp.st(b, 'email', 'o15@example.test') = 'granted',
    pg_temp.st(b, 'phone', '+2348031100015') || '/' || pg_temp.st(b, 'email', 'o15@example.test'));
  PERFORM pg_temp.chk('G-16 a quiet US buyer is opted in on email and SMS',
    pg_temp.st(b, 'phone', '+12025550116') = 'granted' AND pg_temp.st(b, 'email', 'o16@example.test') = 'granted'
    AND pg_temp.autos('+12025550116') = 1, pg_temp.st(b, 'phone', '+12025550116'));
  PERFORM pg_temp.chk('G-17 the opt-in grant is attributed to the buying brand only',
    NOT EXISTS (SELECT 1 FROM public.consent_records r WHERE r.source = 'purchase_auto_optin' AND r.brand_id IS DISTINCT FROM b),
    '');
END;
$grade$;

-- ── A later purchase never undoes an opt-out ─────────────────────────────────
INSERT INTO public.orders(id, event_id, buyer_email, buyer_phone_e164, buyer_name, total_cents, currency, payment_status, source, confirmed_at)
SELECT pg_temp.u('1' || x), pg_temp.u('e1'), 'o' || x || '@example.test', '+23480311000' || x, 'Again ' || x, 500, 'USD', 'paid', 'legacy', now()
  FROM unnest(ARRAY['01', '04', '06', '10', '14']) x;
DO $again$
DECLARE b uuid := pg_temp.u('b1'); x text;
BEGIN
  FOREACH x IN ARRAY ARRAY['01', '04', '06', '10', '14'] LOOP
    PERFORM pg_temp.ingest(pg_temp.u('1' || x));
  END LOOP;
  PERFORM pg_temp.chk('L-01 a second purchase leaves every opted-out contact withheld with no automatic grant',
    pg_temp.st(b, 'email', 'o01@example.test') = 'withheld' AND pg_temp.st(b, 'phone', '+2348031100004') = 'withheld'
    AND pg_temp.st(b, 'email', 'o04@example.test') = 'withheld' AND pg_temp.st(b, 'phone', '+2348031100006') = 'withheld'
    AND pg_temp.st(b, 'email', 'o10@example.test') = 'withheld' AND pg_temp.st(b, 'email', 'o14@example.test') = 'withheld'
    AND pg_temp.autos('o01@example.test') + pg_temp.autos('+2348031100004') + pg_temp.autos('o04@example.test')
      + pg_temp.autos('+2348031100006') + pg_temp.autos('o10@example.test') + pg_temp.autos('o14@example.test') = 0, '');
  PERFORM pg_temp.chk('L-02 a second purchase writes no second grant for a quiet buyer',
    pg_temp.autos('+12025550116') = 1 AND pg_temp.autos('o16@example.test') = 1, '');

  -- An unsubscribe AFTER the automatic grant: the Book row still reads granted
  -- (a grant is never downgraded), but the marketing authoriser refuses it.
  INSERT INTO public.marketing_unsubscribes(contact_phone, channel, scope, brand_id, reason)
  VALUES ('+12025550116', 'sms', 'brand', b, 't');
  INSERT INTO public.channel_suppressions(user_id, contact, channel, scope, reason)
  VALUES (NULL, 'o17@example.test', 'email', 'marketing', 'unsubscribe');
  PERFORM pg_temp.chk('L-03 an opt-out after the automatic grant stops the SMS authoriser',
    NOT EXISTS (SELECT 1 FROM public.brand_person_contact_methods m
      CROSS JOIN LATERAL public.biz_brand_person_authorized_contact_v2(b, m.brand_person_id, 'sms', 'marketing_blast') a
      WHERE m.brand_id = b AND m.normalized_value = '+12025550116' AND a.allowed), '');
  PERFORM pg_temp.chk('L-04 an opt-out after the automatic grant stops the email authoriser',
    NOT EXISTS (SELECT 1 FROM public.brand_person_contact_methods m
      CROSS JOIN LATERAL public.biz_brand_person_authorized_contact_v2(b, m.brand_person_id, 'email', 'marketing_blast') a
      WHERE m.brand_id = b AND m.normalized_value = 'o17@example.test' AND a.allowed), '');
  PERFORM pg_temp.chk('L-05 and the send verdict refuses both',
    public.issue_4273_send_verdict(pg_temp.u('01'), b, 'sms', '+12025550116', NULL, NULL, NULL) <> 'send'
    AND public.issue_4273_send_verdict(pg_temp.u('01'), b, 'email', 'o17@example.test', NULL, NULL, NULL) <> 'send', '');
END;
$again$;

-- ── Accounts derived from orders: wide on the shared contact, never beyond it ─
-- Account 03 (account-scope email unsubscribe) and a guest buy with ONE shared
-- phone; account 05 (email suppression) and another account share ONE email.
INSERT INTO auth.users(id, email) VALUES (pg_temp.u('31'), 't4273t-31@example.test'), (pg_temp.u('32'), 't4273t-32@example.test');
INSERT INTO public.brands(id, account_id, name, slug, default_currency, created_at, updated_at) VALUES
  (pg_temp.u('b3'), pg_temp.u('01'), 'Optout Three', 'issue-4273t-three', 'USD', now(), now());
INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone, theme) VALUES
  (pg_temp.u('e3'), pg_temp.u('b3'), pg_temp.u('01'), 'Three', 't4273t-three', 'event', 'scheduled', 'public', 'UTC', '{}'::jsonb);
INSERT INTO public.marketing_unsubscribes(contact_email, channel, scope, account_id, reason)
VALUES ('elsewhere@example.test', 'sms', 'account', pg_temp.u('31'), 't');
INSERT INTO public.orders(id, event_id, buyer_user_id, buyer_email, buyer_phone_e164, buyer_name, total_cents, currency, payment_status, source, confirmed_at) VALUES
  -- 31 bought with a phone and an email; 32, a different account, later bought
  -- with the SAME phone and its own email.
  (pg_temp.u('31a'), pg_temp.u('e1'), pg_temp.u('31'), 'acct31@example.test', '+2348031100031', 'A31', 1000, 'USD', 'paid', 'legacy', now()),
  (pg_temp.u('32a'), pg_temp.u('e1'), pg_temp.u('32'), 'acct32@example.test', '+2348031100031', 'A32', 1000, 'USD', 'paid', 'legacy', now()),
  -- the same phone on ANOTHER brand's order never pulls account 31 into b2's view
  (pg_temp.u('32b'), pg_temp.u('e3'), pg_temp.u('32'), 'acct32@example.test', '+2348031100031', 'A32', 1000, 'USD', 'paid', 'legacy', now());
DO $acct$
DECLARE b uuid := pg_temp.u('b1');
BEGIN
  PERFORM pg_temp.ingest(pg_temp.u('31a')); PERFORM pg_temp.ingest(pg_temp.u('32a')); PERFORM pg_temp.ingest(pg_temp.u('32b'));
  -- #4273 Q1 (Seth, 2026-11-07): account scope is the SENDING HOST's account. A row
  -- keyed to a buyer's own account (31) for another address withholds nothing.
  PERFORM pg_temp.chk('A-01 an account-scope row keyed to the buyer''s own account, for another address, withholds nothing',
    pg_temp.st(b, 'phone', '+2348031100031') = 'granted', pg_temp.st(b, 'phone', '+2348031100031'));
  PERFORM pg_temp.chk('A-02 and never that account''s email (other channel)',
    pg_temp.st(b, 'email', 'acct31@example.test') = 'granted', pg_temp.st(b, 'email', 'acct31@example.test'));
  -- 32's order lands in a merge conflict (its phone is already 31's), so its
  -- email is graded the way the ingest grades it.
  PERFORM pg_temp.chk('A-03 another account sharing the phone keeps its own email opted in',
    (SELECT g.state FROM public.issue_3524_grade_marketing_consent('order', b, 'email', 'acct32@example.test') g) = 'granted', '');
  PERFORM pg_temp.chk('A-04 a brand that never saw account 31 on the phone is not touched by its opt-out',
    pg_temp.st(pg_temp.u('b3'), 'phone', '+2348031100031') = 'granted'
    AND NOT EXISTS (SELECT 1 FROM public.issue_4273_contact_accounts(pg_temp.u('b3'), 'sms', '+2348031100031') a WHERE a = pg_temp.u('31')),
    pg_temp.st(pg_temp.u('b3'), 'phone', '+2348031100031'));
  PERFORM pg_temp.chk('A-05 the account lookup is service-only',
    NOT has_function_privilege('authenticated', 'public.issue_4273_contact_accounts(uuid,text,text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.issue_4273_person_opted_out(uuid,text,text,uuid)', 'EXECUTE'), '');
  -- Phone digits: a different country's number that merely ends the same way,
  -- or a local short form, is not the same phone.
  INSERT INTO public.venue_sms_opt_out(phone_e164, brand_id) VALUES ('+448031100041', NULL);
  INSERT INTO public.channel_suppressions(user_id, contact, channel, scope, reason) VALUES (NULL, '08031100042', 'sms', 'all', 'stop_keyword');
  PERFORM pg_temp.chk('A-06 digit matching never crosses a country code or a short local form',
    NOT public.issue_4273_marketing_opted_out(b, 'sms', '+2348031100041', NULL)
    AND NOT public.issue_4273_marketing_opted_out(b, 'sms', '+2348031100042', NULL), '');
  PERFORM pg_temp.chk('A-07 fixture: nothing on file for that number yet',
    NOT public.issue_4273_marketing_opted_out(b, 'sms', '+2348031100043', NULL), '');
  INSERT INTO public.channel_suppressions(user_id, contact, channel, scope, reason) VALUES (NULL, '234 803 110 0043', 'sms', 'all', 'stop_keyword');
  PERFORM pg_temp.chk('A-08 a STOP stored with spaces and no plus still withholds',
    public.issue_4273_marketing_opted_out(b, 'sms', '+2348031100043', NULL), '');
END;
$acct$;

-- ── Backfill: never moves an opted-out contact; idempotent ──────────────────
DO $backfill$
DECLARE b uuid := pg_temp.u('b1'); v1 integer; v2 integer; v_recs integer; v_opted integer;
BEGIN
  -- Reset every order-sourced contact of b1 to the pre-#4273 shape.
  UPDATE public.brand_person_contact_methods m
     SET marketing_consent_state = 'withheld', marketing_consent_record_id = NULL
   WHERE m.brand_id = b AND m.record_state = 'active'
     AND EXISTS (SELECT 1 FROM public.brand_person_source_links l
                  WHERE l.brand_person_id = m.brand_person_id AND l.source_kind = 'order');
  DELETE FROM public.consent_records WHERE source = 'purchase_auto_optin' AND brand_id = b;
  v1 := public.issue_4273_backfill_auto_optin();
  SELECT count(*) INTO v_recs FROM public.consent_records WHERE source = 'purchase_auto_optin' AND brand_id = b;

  SELECT count(*) INTO v_opted FROM (VALUES
      ('email', 'o01@example.test'), ('email', 'o03@example.test'), ('phone', '+2348031100004'),
      ('email', 'o04@example.test'), ('email', 'o05@example.test'), ('phone', '+2348031100006'),
      ('email', 'o08@example.test'), ('email', 'o10@example.test'),
      ('email', 'o14@example.test'), ('phone', '+2348031100015'), ('phone', '+12025550116'),
      ('email', 'o17@example.test')) v(ch, val)
   WHERE pg_temp.st(b, v.ch, v.val) LIKE '%granted%' OR pg_temp.autos(v.val) > 0
      OR pg_temp.st(b, 'email', 'o11@example.test') <> 'withheld';
  PERFORM pg_temp.chk('B-01 the backfill moves no contact on any opt-out ledger', v_opted = 0, v_opted::text);
  PERFORM pg_temp.chk('B-02 the backfill opts in the quiet contacts with one grant each',
    v1 > 0 AND v_recs = v1 - 1  -- o12 is moved onto the person's own checkout grant, no new row
    AND (SELECT r.source FROM public.consent_records r JOIN public.brand_person_contact_methods m
          ON m.marketing_consent_record_id = r.id WHERE m.brand_id = b AND m.normalized_value = 'o12@example.test') = 'checkout'
    AND pg_temp.st(b, 'email', 'o02@example.test') = 'granted'
    AND pg_temp.st(b, 'phone', '+2348031100017') = 'granted', v1 || ' vs ' || v_recs);
  PERFORM pg_temp.chk('B-03 the backfill never touches a manual (non-order) Book row',
    (SELECT marketing_consent_state FROM public.brand_person_contact_methods WHERE brand_person_id = pg_temp.u('a09')) = 'unknown', '');
  v2 := public.issue_4273_backfill_auto_optin();
  PERFORM pg_temp.chk('B-04 a second run moves nothing and writes nothing',
    v2 = 0 AND (SELECT count(*) FROM public.consent_records WHERE source = 'purchase_auto_optin' AND brand_id = b) = v_recs,
    v2::text);
END;
$backfill$;

-- ── Follow trigger ──────────────────────────────────────────────────────────
INSERT INTO public.profiles(id, first_name, display_name, username, active, has_completed_onboarding, visibility_mode)
SELECT pg_temp.u(x), 'F', 'F', 't4273t-' || x, true, true, 'friends'
  FROM unnest(ARRAY['21', '22', '23', '24', '25', '26', '27']) x;
INSERT INTO public.verified_phone_identities(user_id, phone_e164) VALUES
  (pg_temp.u('21'), '+2348031100021'), (pg_temp.u('24'), '+2348031100006'), (pg_temp.u('26'), '+2348031100026');
INSERT INTO auth.identities(user_id, provider, identity_data) VALUES
  (pg_temp.u('21'), 'email', '{"email":"f21@example.test"}'),
  (pg_temp.u('22'), 'email', '{"email":"  F22@Example.TEST "}'),
  (pg_temp.u('23'), 'email', '{"email":"f23@example.test"}'),
  (pg_temp.u('25'), 'email', '{"email":"f25@example.test"}'),
  (pg_temp.u('26'), 'email', '{"email":"f26@example.test"}'),
  (pg_temp.u('27'), 'email', '{"email":"o01@example.test"}');
INSERT INTO public.channel_suppressions(user_id, contact, channel, scope, reason) VALUES
  (NULL, '+2348031100021', 'sms', 'all', 'stop_keyword'),
  (pg_temp.u('23'), NULL, 'email', 'marketing', 'manual');
INSERT INTO public.marketing_unsubscribes(contact_email, channel, scope, brand_id, reason)
VALUES ('f22@example.test', 'email', 'brand', pg_temp.u('b1'), 't');

INSERT INTO public.brand_follows(user_id, brand_id) VALUES
  (pg_temp.u('21'), pg_temp.u('b1')), (pg_temp.u('22'), pg_temp.u('b1')), (pg_temp.u('23'), pg_temp.u('b1')),
  (pg_temp.u('24'), pg_temp.u('b1')), (pg_temp.u('27'), pg_temp.u('b1'));

DO $follow$
DECLARE b uuid := pg_temp.u('b1');
BEGIN
  PERFORM pg_temp.chk('F-01 STOP on the follower''s phone: no SMS grant; the email is still opted in',
    pg_temp.autos('+2348031100021') = 0 AND pg_temp.autos('f21@example.test') = 1, '');
  PERFORM pg_temp.chk('F-02 a brand unsubscribe matches the follower''s mixed-case verified email',
    pg_temp.autos('f22@example.test') = 0, pg_temp.autos('f22@example.test')::text);
  PERFORM pg_temp.chk('F-03 a suppression keyed to the follower''s account blocks the email grant',
    pg_temp.autos('f23@example.test') = 0, '');
  PERFORM pg_temp.chk('F-04 following never lifts a Book phone that opted out (global venue STOP)',
    pg_temp.st(b, 'phone', '+2348031100006') = 'withheld' AND pg_temp.autos('+2348031100006') = 0,
    pg_temp.st(b, 'phone', '+2348031100006'));
  PERFORM pg_temp.chk('F-05 a later follow never undoes a buyer''s email opt-out',
    pg_temp.st(b, 'email', 'o01@example.test') = 'withheld' AND pg_temp.autos('o01@example.test') = 0,
    pg_temp.st(b, 'email', 'o01@example.test'));
  PERFORM pg_temp.chk('F-06 every follow grant is attributed to the followed brand and the follower',
    NOT EXISTS (SELECT 1 FROM public.consent_records r WHERE r.source = 'follow_auto_optin'
                 AND r.created_at >= now() - interval '1 minute'
                 AND (r.brand_id IS DISTINCT FROM b OR r.user_id IS NULL)), '');
END;
$follow$;

-- A follow must never fail when the audit write does. Make every automatic
-- grant insert fail, then follow.
ALTER TABLE public.consent_records ADD CONSTRAINT t4273t_block_auto
  CHECK (source NOT IN ('purchase_auto_optin', 'follow_auto_optin')) NOT VALID;
DO $nofail$
DECLARE v_ok boolean := true; v_err text;
BEGIN
  BEGIN
    INSERT INTO public.brand_follows(user_id, brand_id) VALUES (pg_temp.u('25'), pg_temp.u('b1'));
  EXCEPTION WHEN OTHERS THEN v_ok := false; v_err := SQLERRM;
  END;
  PERFORM pg_temp.chk('T-01 the follow lands even when the opt-in write fails',
    v_ok AND EXISTS (SELECT 1 FROM public.brand_follows WHERE user_id = pg_temp.u('25') AND brand_id = pg_temp.u('b1'))
    AND pg_temp.autos('f25@example.test') = 0, COALESCE(v_err, ''));
END;
$nofail$;
ALTER TABLE public.consent_records DROP CONSTRAINT t4273t_block_auto;

-- An ordinary signed-in follower (RLS, no write grant on consent_records)
-- follows: the definer trigger records the grant on their behalf.
SELECT set_config('request.jwt.claim.sub', pg_temp.u('26')::text, true);
SELECT set_config('request.jwt.claims', json_build_object('sub', pg_temp.u('26'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
INSERT INTO public.brand_follows(user_id, brand_id) VALUES ('4273d000-0000-4000-8000-000000000026', '4273d000-0000-4000-8000-0000000000b1');
RESET ROLE;
DO $rls$
BEGIN
  PERFORM pg_temp.chk('T-02 a signed-in follow succeeds under RLS and records both grants',
    pg_temp.autos('f26@example.test') = 1 AND pg_temp.autos('+2348031100026') = 1, '');
  PERFORM pg_temp.chk('T-03 no opt-in helper is callable by anon or authenticated',
    NOT has_function_privilege('anon', 'public.issue_3524_grade_marketing_consent(text,uuid,text,text)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.issue_3524_grade_marketing_consent(text,uuid,text,text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.issue_4273_marketing_opted_out(uuid,text,text,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.issue_4273_record_auto_optin(uuid,text,text,text,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.issue_4273_backfill_auto_optin()', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.issue_4273_follow_auto_optin()', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.issue_4273_follow_auto_optin()', 'EXECUTE'), '');
  PERFORM pg_temp.chk('T-04 every definer helper pins its search_path',
    NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef
                 AND p.proname IN ('issue_4273_marketing_opted_out', 'issue_4273_record_auto_optin',
                                   'issue_3524_grade_marketing_consent', 'issue_4273_follow_auto_optin',
                                   'issue_4273_backfill_auto_optin')
                 AND NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%')), '');
END;
$rls$;

-- ── Honest count with a duplicate address and a withheld target ────────────
-- b2's Book: two rows on one phone, a third row that opts out between confirm
-- and send. The quote prices the shared phone once, so two targets are sealed.
-- Expect: sent, recipient_count 1, nothing hidden, the opted-out row in the
-- host's skipped figure.
RESET ROLE;
UPDATE public.feature_flags SET is_enabled = true
 WHERE flag_key IN ('contact_import_v1', 'brand_book_blast_v1', 'manual_contact_groups_v1');
CREATE FUNCTION pg_temp.snap(p_env jsonb) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT jsonb_build_object(
    'quoteVersion', 1, 'quoteHash', repeat('a', 64), 'contentHash', repeat('b', 64),
    'quotedAt', now(), 'brandId', p_env -> 'brandId', 'content', p_env -> 'content',
    'audienceId', p_env -> 'audienceId', 'audienceKind', p_env -> 'audienceKind',
    'audienceVersion', p_env -> 'audienceVersion', 'selectedCount', p_env -> 'selectedCount',
    'reachableCount', (SELECT count(*) FROM jsonb_array_elements(p_env -> 'candidates') x
                        WHERE (x ->> 'allowed')::boolean AND x ->> 'normalizedContact' IS NOT NULL),
    'suppressedCount', (SELECT count(*) FROM jsonb_array_elements(p_env -> 'candidates') x
                         WHERE NOT (x ->> 'allowed')::boolean AND x ->> 'normalizedContact' IS NOT NULL),
    'unavailableCount', (SELECT count(*) FROM jsonb_array_elements(p_env -> 'candidates') x
                          WHERE x ->> 'normalizedContact' IS NULL),
    'smsSegments', 1, 'costKind', 'provider_estimate',
    'estimatedCostMinor', (SELECT count(*) FROM jsonb_array_elements(p_env -> 'candidates') x
                            WHERE (x ->> 'allowed')::boolean AND x ->> 'normalizedContact' IS NOT NULL) * 3,
    'currency', 'USD', 'candidates', p_env -> 'candidates')
$f$;
INSERT INTO public.brand_people(id, brand_id, display_name, record_status)
SELECT pg_temp.u('d' || x), pg_temp.u('b2'), 'Dup ' || x, 'active' FROM unnest(ARRAY['1', '2', '3', '4']) x;
-- 28 holds the phone typed into d4 and blocked the host: the send refuses it.
INSERT INTO auth.users(id, email) VALUES (pg_temp.u('28'), 't4273t-28@example.test');
INSERT INTO public.profiles(id, first_name, display_name, username, active, has_completed_onboarding, visibility_mode)
VALUES (pg_temp.u('28'), 'B', 'B', 't4273t-28', true, true, 'friends');
INSERT INTO public.verified_phone_identities(user_id, phone_e164) VALUES (pg_temp.u('28'), '+2348031100094');
INSERT INTO public.blocked_users(blocker_id, blocked_id) VALUES (pg_temp.u('28'), pg_temp.u('01'));
INSERT INTO public.brand_person_contact_methods(brand_id, brand_person_id, channel, normalized_value, provenance_scope, is_exportable, is_primary, record_state, marketing_consent_state) VALUES
  (pg_temp.u('b2'), pg_temp.u('d1'), 'phone', '+2348031100091', 'brand_owned', true, true, 'active', 'unknown'),
  (pg_temp.u('b2'), pg_temp.u('d2'), 'phone', '+2348031100091', 'brand_owned', true, true, 'active', 'unknown'),
  (pg_temp.u('b2'), pg_temp.u('d3'), 'phone', '+2348031100093', 'brand_owned', true, true, 'active', 'unknown'),
  (pg_temp.u('b2'), pg_temp.u('d4'), 'phone', '+2348031100094', 'brand_owned', true, true, 'active', 'unknown'),
  (pg_temp.u('b2'), pg_temp.u('d1'), 'email', 'dup1@example.test', 'brand_owned', true, true, 'active', 'unknown');
SELECT set_config('request.jwt.claim.sub', pg_temp.u('01')::text, true);
DO $dup$
DECLARE o1 uuid := pg_temp.u('01'); b uuid := pg_temp.u('b2'); a uuid; c uuid; e jsonb; send jsonb; v_st text;
  v_before jsonb; v_after jsonb; e2 jsonb;
BEGIN
  v_before := public.biz_brand_blast_usage_v1(o1, b);
  a := (public.biz_get_or_create_marketing_combined_audience_v1(o1, b, '["book"]'::jsonb) ->> 'audienceId')::uuid;
  INSERT INTO public.marketing_campaigns(id, account_id, brand_id, audience_id, name, channel, channel_payload, status)
  VALUES (pg_temp.u('c1'), o1, b, a, 'Dup sms', 'sms', '{"kind":"sms","body":"Doors at 9."}'::jsonb, 'draft')
  RETURNING id INTO c;
  e := public.biz_marketing_combined_quote_candidates_v1(o1, c);
  PERFORM pg_temp.chk('D-00 the blocker''s number typed into the Book is quoted as a plain unpriced suppression',
    e -> 'candidates' @> '[{"normalizedContact":"+2348031100094","allowed":false,"safeReasonCode":"suppressed"}]'::jsonb
    AND e::text !~* 'match|block', e::text);
  PERFORM public.biz_confirm_marketing_combined_send_v1(o1, c, pg_temp.u('c2'), pg_temp.snap(e), now() + interval '1 hour');
  INSERT INTO public.channel_suppressions(user_id, contact, channel, scope, reason)
  VALUES (NULL, '+2348031100093', 'sms', 'all', 'stop_keyword');
  send := public.biz_marketing_combined_send_audience_v1(c);
  INSERT INTO public.marketing_messages(campaign_id, recipient_phone, channel, status)
  SELECT c, r ->> 'raw_phone', 'sms', 'sent' FROM jsonb_array_elements(send -> 'rows') r;
  v_st := public.mkt_finalize_campaign(c);
  PERFORM pg_temp.chk('D-01 the quote prices one shared phone once: two sealed, one text out',
    (SELECT reachable_count FROM public.marketing_book_send_executions WHERE campaign_id = c) = 2
    AND jsonb_array_length(send -> 'rows') = 1, send::text);
  PERFORM pg_temp.chk('D-02 the STOP after confirm is not counted as reached',
    v_st = 'sent' AND (SELECT recipient_count FROM public.marketing_campaigns WHERE id = c) = 1,
    v_st || ' ' || (SELECT recipient_count FROM public.marketing_campaigns WHERE id = c));
  PERFORM pg_temp.chk('D-03 nothing is hidden from the host''s skipped figure',
    public.biz_marketing_combined_hidden_skips_v1(c) = 0
    AND (SELECT count(*) FROM public.marketing_combined_send_skips s JOIN public.marketing_book_send_executions x
          ON x.id = s.execution_id WHERE x.campaign_id = c AND s.host_visible) = 1, public.biz_marketing_combined_hidden_skips_v1(c)::text);
  PERFORM pg_temp.chk('D-04 the quote refused what the send would: no contact-match skip at send',
    NOT EXISTS (SELECT 1 FROM public.marketing_combined_send_skips s JOIN public.marketing_book_send_executions x
                 ON x.id = s.execution_id WHERE x.campaign_id = c AND s.reason = 'contact_match_blocked'), '');
  -- The email half of the same campaign counts once toward the week.
  INSERT INTO public.marketing_campaigns(id, account_id, brand_id, audience_id, name, channel, channel_payload, status, campaign_group_id)
  VALUES (pg_temp.u('c3'), o1, b, a, 'Dup email', 'email', '{"kind":"email","subject":"Doors","body_html":"<p>Doors at 9.</p>","body_text":"Doors at 9."}'::jsonb, 'draft', c);
  e2 := public.biz_marketing_combined_quote_candidates_v1(o1, pg_temp.u('c3'));
  PERFORM public.biz_confirm_marketing_combined_send_v1(o1, pg_temp.u('c3'), pg_temp.u('c4'), pg_temp.snap(e2), now() + interval '1 hour');
  v_after := public.biz_brand_blast_usage_v1(o1, b);
  PERFORM pg_temp.chk('W-01 two methods of one campaign count once toward the week',
    (SELECT count(*) FROM public.marketing_book_send_executions x WHERE x.campaign_id IN (c, pg_temp.u('c3'))) = 2
    AND (v_after ->> 'blastsThisWeek')::int = (v_before ->> 'blastsThisWeek')::int + 1,
    v_before::text || ' -> ' || v_after::text);
END;
$dup$;

DO $report$
DECLARE v text;
BEGIN
  SELECT string_agg(line, E'\n' ORDER BY id) INTO v FROM t4273t_fail;
  IF v IS NOT NULL THEN RAISE EXCEPTION E'#4273 opt-out always wins (tester) FAIL:\n%', v; END IF;
  RAISE NOTICE '#4273 opt-out always wins (tester): PASS';
END;
$report$;

ROLLBACK;
