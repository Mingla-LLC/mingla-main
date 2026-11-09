-- #4273 tester P1/P2/P3 — the SMS opt-out link.
--   O-01..O-03  (P1) campaign members read marketing_clicks without the opt-out
--               row: no destination, no count; content links still read.
--   O-04        (P1) every opt-out destination stored names no phone or email
--               (decodes the token payload of every opt_out row).
--   O-05..O-07  (P2, Seth's Q1) the opt-out the link writes (a
--               marketing_unsubscribes row, scope 'account', keyed to the host
--               account that owns the sending brand) withholds marketing from
--               every brand of that host and from no other host's brand.
--   O-08..O-09  (P2) transactional SMS is untouched: can_send still allows a
--               transactional text to the number; a global channel_suppressions
--               row (what the link used to write) would have blocked it.
--   O-10        the price history table is service-role only, seeded.
-- Runs on the fully applied migration chain and rolls back.
--
-- MINGLA-INVARIANT: I-4273-OPT-OUT-LINK-HOLDS-NO-CONTACT | issue #4273 | The SMS opt-out link's stored destination names the campaign, brand and message only (never a phone or email), and campaign members cannot read opt-out link rows at all.
-- MINGLA-INVARIANT: I-4273-SMS-OPT-OUT-IS-HOST-MARKETING-ONLY | issue #4273 | The SMS opt-out link writes a host-account marketing_unsubscribes row: it withholds that host's marketing texts and never a transactional text or another host's marketing.
\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE t4273o_fail(id serial, line text) ON COMMIT DROP;
CREATE FUNCTION pg_temp.chk(p_name text, p_ok boolean, p_detail text DEFAULT '') RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF p_ok IS NOT TRUE THEN INSERT INTO t4273o_fail(line) VALUES (p_name || ' :: ' || COALESCE(p_detail, '')); END IF;
END; $f$;
CREATE FUNCTION pg_temp.u(p text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $f$
  SELECT ('4273d000-0000-4000-8000-' || lpad(p, 12, '0'))::uuid
$f$;
-- The token the edge signs: base64url(JSON) "." signature. Built here the same
-- way so the decode below reads what production stores.
CREATE FUNCTION pg_temp.b64url(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT rtrim(translate(encode(convert_to(p, 'UTF8'), 'base64'), E'+/\n', '-_'), '=')
$f$;
CREATE FUNCTION pg_temp.decode_payload(p_url text) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $f$
DECLARE v text := split_part(regexp_replace(p_url, '^.*/', ''), '.', 1);
BEGIN
  v := translate(v, '-_', '+/');
  v := v || repeat('=', (4 - length(v) % 4) % 4);
  RETURN convert_from(decode(v, 'base64'), 'UTF8');
END; $f$;

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- 01 host A (brands a1, a2). 02 host B (brand b1). 03 a member of a1.
INSERT INTO auth.users(id, email)
SELECT pg_temp.u(x), 't4273o-' || x || '@example.test' FROM unnest(ARRAY['01', '02', '03']) x;
INSERT INTO public.creator_accounts(id, email) VALUES
  (pg_temp.u('01'), 't4273o-01@example.test'), (pg_temp.u('02'), 't4273o-02@example.test');
INSERT INTO public.brands(id, account_id, name, slug, default_currency, created_at, updated_at) VALUES
  (pg_temp.u('a1'), pg_temp.u('01'), 'Opt A1', 'issue-4273o-a1', 'USD', now(), now()),
  (pg_temp.u('a2'), pg_temp.u('01'), 'Opt A2', 'issue-4273o-a2', 'USD', now(), now()),
  (pg_temp.u('b1'), pg_temp.u('02'), 'Opt B1', 'issue-4273o-b1', 'USD', now(), now());
INSERT INTO public.brand_team_members(brand_id, user_id, role, accepted_at)
VALUES (pg_temp.u('a1'), pg_temp.u('03'), 'marketing_manager', now());
INSERT INTO public.marketing_audiences(id, account_id, brand_id, name, query_definition, is_system_generated, created_by)
VALUES (pg_temp.u('d1'), pg_temp.u('01'), pg_temp.u('a1'), 'Opt audience', '{"kind":"manual_group"}', false, pg_temp.u('01'));
INSERT INTO public.marketing_campaigns(id, account_id, brand_id, audience_id, name, channel, channel_payload, status)
VALUES (pg_temp.u('c1'), pg_temp.u('01'), pg_temp.u('a1'), pg_temp.u('d1'), 'Opt SMS', 'sms',
        '{"kind":"sms","body":"Doors at 9."}'::jsonb, 'sent');
INSERT INTO public.marketing_messages(id, campaign_id, recipient_phone, channel, status)
VALUES (pg_temp.u('e1'), pg_temp.u('c1'), '+447700904273', 'sms', 'sent');
INSERT INTO public.marketing_clicks(campaign_id, message_id, destination_url, tracking_id, link_kind) VALUES
  (pg_temp.u('c1'), pg_temp.u('e1'), 'https://example.test/lineup', 't4273o-content', 'content'),
  (pg_temp.u('c1'), pg_temp.u('e1'),
   'https://usemingla.com/unsubscribe/' || pg_temp.b64url(jsonb_build_object(
     'campaign_id', pg_temp.u('c1'), 'brand_id', pg_temp.u('a1'), 'channel', 'sms',
     'message_id', pg_temp.u('e1'), 'exp', 1900000000)::text) || '.c2ln',
   't4273o-optout', 'opt_out');

-- ── O-04 every stored opt-out destination names no phone or email ───────────
DO $o4$
DECLARE r record; v text; n integer := 0;
BEGIN
  FOR r IN SELECT destination_url FROM public.marketing_clicks WHERE link_kind = 'opt_out' LOOP
    v := pg_temp.decode_payload(r.destination_url);
    n := n + 1;
    PERFORM pg_temp.chk('O-04 an opt-out destination carries no phone', v !~ '\+?[0-9]{7,}' , v);
    PERFORM pg_temp.chk('O-04 an opt-out destination carries no email', position('@' IN v) = 0, v);
    PERFORM pg_temp.chk('O-04 it names the message', (v::jsonb ? 'message_id') AND NOT (v::jsonb ? 'recipient_phone'), v);
  END LOOP;
  PERFORM pg_temp.chk('O-04 fixture: at least one opt-out row was decoded', n >= 1, n::text);
  BEGIN
    INSERT INTO public.marketing_clicks(campaign_id, destination_url, tracking_id, link_kind)
    VALUES (pg_temp.u('c1'), 'https://example.test/x', 't4273o-bad', 'tracker');
    PERFORM pg_temp.chk('O-04 a bad link kind is refused', false, 'inserted');
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $o4$;

-- ── O-05..O-07 the opt-out the link writes: host A's marketing only ─────────
INSERT INTO public.marketing_unsubscribes(contact_phone, channel, scope, account_id, reason)
VALUES ('+447700904273', 'sms', 'account', pg_temp.u('01'), 'sms_opt_out_link');
DO $o5$
BEGIN
  PERFORM pg_temp.chk('O-05 the sending brand''s marketing is withheld',
    public.issue_4273_marketing_opted_out(pg_temp.u('a1'), 'sms', '+447700904273', NULL), '');
  PERFORM pg_temp.chk('O-06 so is every other brand that host runs',
    public.issue_4273_marketing_opted_out(pg_temp.u('a2'), 'sms', '+447700904273', NULL), '');
  PERFORM pg_temp.chk('O-07 another host''s brand still reaches the number',
    NOT public.issue_4273_marketing_opted_out(pg_temp.u('b1'), 'sms', '+447700904273', NULL), '');
END $o5$;

-- ── O-08..O-09 transactional texts are untouched ────────────────────────────
DO $o8$
DECLARE v_key text;
BEGIN
  SELECT key INTO v_key FROM public.notification_categories
   WHERE is_transactional AND active AND 'sms' = ANY(default_channels) ORDER BY key LIMIT 1;
  PERFORM pg_temp.chk('O-08 fixture: a transactional SMS category exists', v_key IS NOT NULL, '');
  PERFORM pg_temp.chk('O-08 a transactional text to the opted-out number is still allowed',
    public.can_send(NULL, v_key, 'sms', '+447700904273'), v_key);
  PERFORM pg_temp.chk('O-08 the link wrote no channel suppression',
    NOT EXISTS (SELECT 1 FROM public.channel_suppressions WHERE contact = '+447700904273'), '');
  -- What the link used to write (scope 'all') blocks transactional texts too.
  INSERT INTO public.channel_suppressions(user_id, contact, channel, scope, reason)
  VALUES (NULL, '+447700909999', 'sms', 'all', 'unsubscribe');
  PERFORM pg_temp.chk('O-09 control: a global suppression would have blocked it',
    NOT public.can_send(NULL, v_key, 'sms', '+447700909999'), v_key);
END $o8$;

-- ── O-10 the price history ──────────────────────────────────────────────────
DO $o10$
BEGIN
  PERFORM pg_temp.chk('O-10 price history is RLS-on and service-role only',
    (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.sms_country_price_history'::regclass)
    AND NOT has_table_privilege('authenticated', 'public.sms_country_price_history', 'SELECT')
    AND NOT has_table_privilege('anon', 'public.sms_country_price_history', 'SELECT')
    AND has_table_privilege('service_role', 'public.sms_country_price_history', 'INSERT'), '');
  PERFORM pg_temp.chk('O-10 the seeded prices start the history',
    (SELECT count(DISTINCT country) FROM public.sms_country_price_history WHERE country IN ('US', 'NG')) = 2, '');
END $o10$;

-- ── O-01..O-03 what a campaign member reads ─────────────────────────────────
SELECT set_config('request.jwt.claim.sub', pg_temp.u('03')::text, true);
SELECT set_config('request.jwt.claims', json_build_object('sub', pg_temp.u('03'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
DO $o1$
DECLARE v_rows integer; v_opt integer; v_text text;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE link_kind = 'opt_out'), string_agg(destination_url, ' ')
    INTO v_rows, v_opt, v_text
    FROM public.marketing_clicks WHERE campaign_id = '4273d000-0000-4000-8000-0000000000c1';
  PERFORM pg_temp.chk('O-01 a member still reads the campaign''s content link', v_rows = 1, v_rows::text);
  PERFORM pg_temp.chk('O-02 and never the opt-out row', v_opt = 0 AND v_text !~ 'unsubscribe', COALESCE(v_text, ''));
  PERFORM pg_temp.chk('O-03 so no contact reaches a member through clicks',
    COALESCE(v_text, '') !~ '\+?[0-9]{7,}' AND position('@' IN COALESCE(v_text, '')) = 0, COALESCE(v_text, ''));
END $o1$;
RESET ROLE;

DO $report$
DECLARE v text;
BEGIN
  SELECT string_agg(line, E'\n' ORDER BY id) INTO v FROM t4273o_fail;
  IF v IS NOT NULL THEN RAISE EXCEPTION E'#4273 SMS opt-out link FAIL:\n%', v; END IF;
  RAISE NOTICE '#4273 SMS opt-out link: PASS';
END;
$report$;

ROLLBACK;
