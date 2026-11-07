-- #4273 rework — an account-level opt-out wins at ingest, a phone opt-out
-- stored without its '+' still matches, the automatic grant names the brand
-- and Mingla, and the quote judges every recipient the way the send does.
-- Built from the tester's probe (account-scope unsubscribe, account-keyed
-- suppression). Runs on the fully applied migration chain and rolls back.
--
-- MINGLA-INVARIANT: I-4273-ACCOUNT-OPT-OUT-WINS-AT-INGEST | issue #4273 | An account-scope unsubscribe or account-keyed suppression on any account the brand knows on a buyer's contact keeps that contact withheld and writes no automatic grant.
-- MINGLA-INVARIANT: I-4273-QUOTE-EQUALS-SEND-FOR-EVERY-RECIPIENT | issue #4273 | Book rows, buyers and graph-only people the send would refuse are quoted as plain unpriced suppressions, and every address is priced once, so the sealed reach equals what the send delivers.
\set ON_ERROR_STOP on
BEGIN;

CREATE TABLE IF NOT EXISTS auth.identities(user_id uuid, provider text, identity_data jsonb);
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;

CREATE TEMP TABLE t4273a_fail(id serial, line text) ON COMMIT DROP;
CREATE FUNCTION pg_temp.chk(p_name text, p_ok boolean, p_detail text DEFAULT '') RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF p_ok IS NOT TRUE THEN INSERT INTO t4273a_fail(line) VALUES (p_name || ' :: ' || COALESCE(p_detail, '')); END IF;
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
-- O03 account-scope unsubscribe on the buyer's own account.
INSERT INTO public.marketing_unsubscribes(contact_email, channel, scope, account_id, reason)
VALUES ('o03@example.test', 'email', 'account', pg_temp.u('03'), 't');
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


-- O18 a buyer whose STOP was stored without the leading '+'.
INSERT INTO public.orders(id, event_id, buyer_email, buyer_phone_e164, buyer_name, total_cents, currency, payment_status, source, confirmed_at)
VALUES (pg_temp.u('018'), pg_temp.u('e1'), 'o18@example.test', '+2348031100018', 'Buyer 18', 1000, 'USD', 'paid', 'legacy', now());
INSERT INTO public.channel_suppressions(user_id, contact, channel, scope, reason)
VALUES (NULL, '2348031100018', 'sms', 'all', 'stop_keyword');

DO $p$
DECLARE b uuid := pg_temp.u('b1');
BEGIN
  PERFORM pg_temp.ingest(pg_temp.u('003')); PERFORM pg_temp.ingest(pg_temp.u('005'));
  PERFORM pg_temp.ingest(pg_temp.u('016')); PERFORM pg_temp.ingest(pg_temp.u('018'));
  PERFORM pg_temp.chk('A-01 account-scope unsubscribe on the buyer''s own account withholds email',
    pg_temp.st(b, 'email', 'o03@example.test') = 'withheld' AND pg_temp.autos('o03@example.test') = 0,
    pg_temp.st(b, 'email', 'o03@example.test') || ' autos=' || pg_temp.autos('o03@example.test'));
  PERFORM pg_temp.chk('A-02 a suppression keyed to the buyer''s account withholds email',
    pg_temp.st(b, 'email', 'o05@example.test') = 'withheld' AND pg_temp.autos('o05@example.test') = 0,
    pg_temp.st(b, 'email', 'o05@example.test') || ' autos=' || pg_temp.autos('o05@example.test'));
  PERFORM pg_temp.chk('A-03 a STOP stored without its + withholds the phone; the email is still opted in',
    pg_temp.st(b, 'phone', '+2348031100018') = 'withheld' AND pg_temp.autos('+2348031100018') = 0
    AND pg_temp.st(b, 'email', 'o18@example.test') = 'granted',
    pg_temp.st(b, 'phone', '+2348031100018') || '/' || pg_temp.st(b, 'email', 'o18@example.test'));
  PERFORM pg_temp.chk('A-04 the automatic grant says brand and Mingla, version v2',
    EXISTS (SELECT 1 FROM public.consent_records r
             WHERE r.contact = 'o16@example.test' AND r.source = 'purchase_auto_optin'
               AND r.disclosure_text LIKE '%this brand and Mingla by email and text%'
               AND r.disclosure_version = '2026-11-06-auto-optin-v2'), '');
END $p$;

-- ── Q: the quote judges Book rows and buyers the way the send does ─────────
-- 21 blocked the host and verifies a number a Book row holds; 22 muted the
-- brand and verifies the phone on a buyer's order; a stranger's Book row stays.
INSERT INTO public.profiles(id, first_name, display_name, username, active, has_completed_onboarding, visibility_mode)
SELECT pg_temp.u(x), 'Q', 'Q', 't4273a-' || x, true, true, 'friends' FROM unnest(ARRAY['21', '22']) x;
INSERT INTO public.verified_phone_identities(user_id, phone_e164) VALUES
  (pg_temp.u('21'), '+2348031109021'), (pg_temp.u('22'), '+2348031109022');
INSERT INTO public.blocked_users(blocker_id, blocked_id) VALUES (pg_temp.u('21'), pg_temp.u('01'));
INSERT INTO public.brand_follows(user_id, brand_id, muted_until) VALUES (pg_temp.u('22'), pg_temp.u('b2'), 'infinity');
INSERT INTO public.brand_people(id, brand_id, display_name, record_status) VALUES
  (pg_temp.u('a1'), pg_temp.u('b2'), 'Typed blocker', 'active'),
  (pg_temp.u('a2'), pg_temp.u('b2'), 'Stranger', 'active');
INSERT INTO public.brand_person_contact_methods(brand_id, brand_person_id, channel, normalized_value, provenance_scope, is_exportable, is_primary, record_state, marketing_consent_state) VALUES
  (pg_temp.u('b2'), pg_temp.u('a1'), 'phone', '+2348031109021', 'brand_owned', true, true, 'active', 'unknown'),
  (pg_temp.u('b2'), pg_temp.u('a2'), 'phone', '+2348031109099', 'brand_owned', true, true, 'active', 'unknown');
INSERT INTO public.orders(id, event_id, buyer_email, buyer_phone_e164, buyer_name, total_cents, currency, payment_status, source, confirmed_at)
VALUES (pg_temp.u('a3'), pg_temp.u('e2'), 'q3@example.test', '+2348031109022', 'Muted buyer', 1000, 'USD', 'paid', 'legacy', now());
UPDATE public.feature_flags SET is_enabled = true
WHERE flag_key IN ('contact_import_v1', 'brand_book_blast_v1', 'manual_contact_groups_v1');
SELECT set_config('request.jwt.claim.sub', pg_temp.u('01')::text, true);

DO $q$
DECLARE
  o uuid := pg_temp.u('01'); b uuid := pg_temp.u('b2'); a uuid; c uuid; e jsonb; send jsonb; x uuid;
BEGIN
  a := (public.biz_get_or_create_marketing_combined_audience_v1(o, b, '["book","brand_buyers"]'::jsonb) ->> 'audienceId')::uuid;
  INSERT INTO public.marketing_campaigns(id, account_id, brand_id, audience_id, name, channel, channel_payload, status)
  VALUES (pg_temp.u('c1'), o, b, a, 'Q', 'sms', '{"kind":"sms","body":"Doors at 9."}'::jsonb, 'draft') RETURNING id INTO c;
  e := public.biz_marketing_combined_quote_candidates_v1(o, c);
  PERFORM pg_temp.chk('Q-00 fixture: the send refuses the typed blocker''s number and the muted buyer''s phone',
    public.issue_4273_send_verdict(o, b, 'sms', '+2348031109021', pg_temp.u('a1'), NULL, NULL) <> 'send'
    AND public.issue_4273_send_verdict(o, b, 'sms', '+2348031109022', NULL, NULL, 'q3@example.test') <> 'send', '');
  PERFORM pg_temp.chk('Q-01 a Book row the send would refuse is an unpriced plain suppression',
    e -> 'candidates' @> '[{"normalizedContact":"+2348031109021","allowed":false,"safeReasonCode":"suppressed"}]'::jsonb, e::text);
  PERFORM pg_temp.chk('Q-02 a buyer the send would refuse is an unpriced plain suppression',
    e -> 'candidates' @> '[{"normalizedContact":"+2348031109022","allowed":false,"safeReasonCode":"suppressed"}]'::jsonb, e::text);
  PERFORM pg_temp.chk('Q-03 no reason names a match',
    e::text !~* 'match' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(e -> 'candidates') q
      WHERE q ->> 'safeReasonCode' NOT IN ('allowed', 'suppressed', 'can_send_denied', 'delivery_denied', 'channel_unavailable')), e::text);
  PERFORM public.biz_confirm_marketing_combined_send_v1(o, c, pg_temp.u('ab1'), pg_temp.snap(e), now() + interval '1 hour');
  send := public.biz_marketing_combined_send_audience_v1(c);
  SELECT id INTO x FROM public.marketing_book_send_executions WHERE campaign_id = c;
  PERFORM pg_temp.chk('Q-04 the send delivers exactly what the quote priced, with no skip',
    (SELECT reachable_count FROM public.marketing_book_send_executions WHERE id = x) = 1
    AND jsonb_array_length(send -> 'rows') = 1 AND send -> 'rows' @> '[{"raw_phone":"+2348031109099"}]'::jsonb
    AND NOT EXISTS (SELECT 1 FROM public.marketing_combined_send_skips s WHERE s.execution_id = x), send::text);
END $q$;

DO $r$ DECLARE v text; BEGIN SELECT string_agg(line, E'\n') INTO v FROM t4273a_fail;
  IF v IS NOT NULL THEN RAISE EXCEPTION E'#4273 account opt-out / full quote FAIL:\n%', v; END IF;
  RAISE NOTICE '#4273 account opt-out / full quote: PASS'; END $r$;
ROLLBACK;
