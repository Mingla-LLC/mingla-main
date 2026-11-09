-- #4273 — tester adversarial: the SMS opt-out link's row, exactly as
-- marketing-unsubscribe writes it (marketing_unsubscribes, scope 'account',
-- account_id = the sending brand's owner), stops marketing texts from EVERY
-- brand that host runs and from nobody else's; email and transactional texts
-- are untouched; campaign members never read the opt-out click row; the price
-- history table is closed to app roles. Fully applied chain; rolls back.
\set ON_ERROR_STOP on
BEGIN;

UPDATE public.feature_flags SET is_enabled = true
WHERE flag_key IN ('contact_import_v1', 'brand_book_blast_v1', 'manual_contact_groups_v1');
CREATE TABLE IF NOT EXISTS auth.identities(user_id uuid, provider text, identity_data jsonb);
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;

CREATE TEMP TABLE t4273o_fail(id serial, line text) ON COMMIT DROP;
GRANT ALL ON t4273o_fail TO PUBLIC;
GRANT USAGE, SELECT ON SEQUENCE t4273o_fail_id_seq TO PUBLIC;
CREATE FUNCTION pg_temp.chk(p_name text, p_ok boolean, p_detail text DEFAULT '') RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF p_ok IS NOT TRUE THEN INSERT INTO t4273o_fail(line) VALUES (p_name || ' :: ' || COALESCE(p_detail, '')); END IF;
END; $f$;
GRANT EXECUTE ON FUNCTION pg_temp.chk(text, boolean, text) TO PUBLIC;

-- Host A runs two brands, host B one. The same UK number bought from all three.
INSERT INTO auth.users(id, email) VALUES
  ('4273f000-0000-4000-8000-00000000000a', 'host-a@example.test'),
  ('4273f000-0000-4000-8000-00000000000b', 'host-b@example.test'),
  ('4273f000-0000-4000-8000-00000000000c', 'member-a@example.test');
INSERT INTO public.creator_accounts(id, email) VALUES
  ('4273f000-0000-4000-8000-00000000000a', 'host-a@example.test'),
  ('4273f000-0000-4000-8000-00000000000b', 'host-b@example.test'),
  ('4273f000-0000-4000-8000-00000000000c', 'member-a@example.test');
INSERT INTO public.brands(id, account_id, name, slug, default_currency, created_at, updated_at) VALUES
  ('4273f000-0000-4000-8000-0000000000a1', '4273f000-0000-4000-8000-00000000000a', 'A one', 'issue-4273o-a1', 'USD', now(), now()),
  ('4273f000-0000-4000-8000-0000000000a2', '4273f000-0000-4000-8000-00000000000a', 'A two', 'issue-4273o-a2', 'USD', now(), now()),
  ('4273f000-0000-4000-8000-0000000000b1', '4273f000-0000-4000-8000-00000000000b', 'B one', 'issue-4273o-b1', 'USD', now(), now());
INSERT INTO public.brand_team_members(brand_id, user_id, role, accepted_at) VALUES
  ('4273f000-0000-4000-8000-0000000000a1', '4273f000-0000-4000-8000-00000000000c', 'marketing_manager', clock_timestamp());
INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone, theme) VALUES
  ('4273f000-1000-4000-8000-0000000000a1', '4273f000-0000-4000-8000-0000000000a1', '4273f000-0000-4000-8000-00000000000a', 'A1 night', 't4273o-a1', 'event', 'scheduled', 'public', 'UTC', '{}'::jsonb),
  ('4273f000-1000-4000-8000-0000000000a2', '4273f000-0000-4000-8000-0000000000a2', '4273f000-0000-4000-8000-00000000000a', 'A2 night', 't4273o-a2', 'event', 'scheduled', 'public', 'UTC', '{}'::jsonb),
  ('4273f000-1000-4000-8000-0000000000b1', '4273f000-0000-4000-8000-0000000000b1', '4273f000-0000-4000-8000-00000000000b', 'B1 night', 't4273o-b1', 'event', 'scheduled', 'public', 'UTC', '{}'::jsonb);
INSERT INTO public.orders(id, event_id, buyer_email, buyer_phone_e164, buyer_name, total_cents, currency, payment_status, source, confirmed_at) VALUES
  ('4273f000-1100-4000-8000-0000000000a1', '4273f000-1000-4000-8000-0000000000a1', 'guest-o@example.test', '+447700900555', 'Guest', 1000, 'USD', 'paid', 'legacy', now()),
  ('4273f000-1100-4000-8000-0000000000a2', '4273f000-1000-4000-8000-0000000000a2', 'guest-o@example.test', '+447700900555', 'Guest', 1000, 'USD', 'paid', 'legacy', now()),
  ('4273f000-1100-4000-8000-0000000000b1', '4273f000-1000-4000-8000-0000000000b1', 'guest-o@example.test', '+447700900555', 'Guest', 1000, 'USD', 'paid', 'legacy', now());

CREATE TEMP TABLE t4273o_people(brand_id uuid, person uuid) ON COMMIT DROP;
DO $people$
DECLARE r record; v jsonb;
BEGIN
  FOR r IN SELECT o.id, o.event_id, e.brand_id, e.created_by FROM public.orders o JOIN public.events e ON e.id = o.event_id
            WHERE o.id::text LIKE '4273f000-1100-%' LOOP
    PERFORM set_config('request.jwt.claim.sub', r.created_by::text, true);
    SELECT public.biz_resolve_brand_person_source(r.brand_id, o.event_id, 'order', o.id, NULL, NULL,
             o.buyer_email, o.buyer_phone_e164, o.created_at) INTO v
      FROM public.orders o WHERE o.id = r.id;
  END LOOP;
  INSERT INTO t4273o_people
  SELECT m.brand_id, m.brand_person_id FROM public.brand_person_contact_methods m
   WHERE m.normalized_value = '+447700900555';
END;
$people$;

CREATE FUNCTION pg_temp.sms_ok(p_brand uuid) RETURNS boolean LANGUAGE sql AS $f$
  SELECT COALESCE(bool_or(a.allowed), false)
    FROM t4273o_people p
    CROSS JOIN LATERAL public.biz_brand_person_authorized_contact_v2(p.brand_id, p.person, 'sms', 'marketing_blast') a
   WHERE p.brand_id = p_brand
$f$;
CREATE FUNCTION pg_temp.email_ok(p_brand uuid) RETURNS boolean LANGUAGE sql AS $f$
  SELECT COALESCE(bool_or(a.allowed), false)
    FROM t4273o_people p
    CROSS JOIN LATERAL public.biz_brand_person_authorized_contact_v2(p.brand_id, p.person, 'email', 'marketing_blast') a
   WHERE p.brand_id = p_brand
$f$;

DO $optout$
DECLARE
  a1 uuid := '4273f000-0000-4000-8000-0000000000a1';
  a2 uuid := '4273f000-0000-4000-8000-0000000000a2';
  b1 uuid := '4273f000-0000-4000-8000-0000000000b1';
  v_trans text;
BEGIN
  PERFORM pg_temp.chk('O-00 fixture: three brand people hold the number',
    (SELECT count(*) FROM t4273o_people) = 3, '');
  PERFORM pg_temp.chk('O-00 fixture: every brand may text it before the opt-out',
    pg_temp.sms_ok(a1) AND pg_temp.sms_ok(a2) AND pg_temp.sms_ok(b1), '');

  -- Exactly the row handleSmsOptOut inserts (POST) for a text from brand A1.
  INSERT INTO public.marketing_unsubscribes(contact_phone, channel, reason, scope, account_id)
  VALUES ('+447700900555', 'sms', 'sms_opt_out_link', 'account', '4273f000-0000-4000-8000-00000000000a');

  PERFORM pg_temp.chk('O-01 the sending brand can no longer text it (Book)', NOT pg_temp.sms_ok(a1), '');
  PERFORM pg_temp.chk('O-02 nor can the same host''s other brand', NOT pg_temp.sms_ok(a2), '');
  PERFORM pg_temp.chk('O-03 another host''s brand still can', pg_temp.sms_ok(b1), '');
  PERFORM pg_temp.chk('O-04 email from the same host is untouched', pg_temp.email_ok(a1), '');
  PERFORM pg_temp.chk('O-05 combined/buyer reader: denied for A1 and A2, not for B1',
    public.issue_4273_address_denied(a1, 'sms', '+447700900555', NULL) IS NOT NULL
    AND public.issue_4273_address_denied(a2, 'sms', '+447700900555', NULL) IS NOT NULL
    AND public.issue_4273_address_denied(b1, 'sms', '+447700900555', NULL) IS NULL,
    concat_ws('/', public.issue_4273_address_denied(a1, 'sms', '+447700900555', NULL),
                   public.issue_4273_address_denied(b1, 'sms', '+447700900555', NULL)));
  PERFORM pg_temp.chk('O-06 the shared opted-out reader agrees (A1, A2 yes; B1 no)',
    public.issue_4273_marketing_opted_out(a1, 'sms', '+447700900555')
    AND public.issue_4273_marketing_opted_out(a2, 'sms', '+447700900555')
    AND NOT public.issue_4273_marketing_opted_out(b1, 'sms', '+447700900555'), '');
  v_trans := 'buyer_event_reminder';
  PERFORM pg_temp.chk('O-07a fixture: the reminder is a transactional SMS category',
    EXISTS (SELECT 1 FROM public.notification_categories WHERE key = v_trans AND is_transactional), '');
  PERFORM pg_temp.chk('O-07 transactional texts still pass can_send (' || COALESCE(v_trans, '?') || ')',
    public.can_send(NULL, v_trans, 'sms', '+447700900555'), '');
  PERFORM pg_temp.chk('O-08 the opt-out writes no global suppression',
    NOT EXISTS (SELECT 1 FROM public.channel_suppressions WHERE contact = '+447700900555'), '');
END;
$optout$;

-- ── C. Campaign members never read the opt-out click row ──────────────────
INSERT INTO public.marketing_audiences(id, account_id, brand_id, name, query_definition, is_system_generated)
VALUES ('4273f000-2000-4000-8000-0000000000a1', '4273f000-0000-4000-8000-00000000000a', '4273f000-0000-4000-8000-0000000000a1',
        'Your Book', jsonb_build_object('kind', 'all_brand_people', 'brand_id', '4273f000-0000-4000-8000-0000000000a1'), true);
INSERT INTO public.marketing_campaigns(id, account_id, brand_id, audience_id, name, channel, channel_payload, status)
VALUES ('4273f000-3000-4000-8000-0000000000a1', '4273f000-0000-4000-8000-00000000000a', '4273f000-0000-4000-8000-0000000000a1',
        '4273f000-2000-4000-8000-0000000000a1', 'Clicks', 'sms', '{"kind":"sms","body":"x"}'::jsonb, 'sent');
INSERT INTO public.marketing_clicks(campaign_id, destination_url, tracking_id, link_kind, clicked_at) VALUES
  ('4273f000-3000-4000-8000-0000000000a1', 'https://usemingla.com/e/a1/night', gen_random_uuid()::text, 'content', now()),
  ('4273f000-3000-4000-8000-0000000000a1', 'https://usemingla.com/unsubscribe/opaque.sig', gen_random_uuid()::text, 'opt_out', now());
INSERT INTO public.marketing_clicks(campaign_id, destination_url, tracking_id, clicked_at) VALUES
  ('4273f000-3000-4000-8000-0000000000a1', 'https://usemingla.com/e/a1/legacy-default', gen_random_uuid()::text, now());

DO $clicks$
DECLARE who uuid; n_content int; n_opt int; ok boolean;
BEGIN
  FOREACH who IN ARRAY ARRAY['4273f000-0000-4000-8000-00000000000a', '4273f000-0000-4000-8000-00000000000c']::uuid[] LOOP
    PERFORM set_config('request.jwt.claim.sub', who::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) FILTER (WHERE destination_url NOT LIKE '%/unsubscribe/%'),
           count(*) FILTER (WHERE destination_url LIKE '%/unsubscribe/%')
      INTO n_content, n_opt
      FROM public.marketing_clicks WHERE campaign_id = '4273f000-3000-4000-8000-0000000000a1';
    RESET ROLE;
    PERFORM pg_temp.chk('C-01 ' || who || ' reads both content clicks (incl. a row with the default kind)', n_content = 2, n_content::text);
    PERFORM pg_temp.chk('C-02 ' || who || ' never reads the opt-out row', n_opt = 0, n_opt::text);
  END LOOP;
  ok := false;
  BEGIN
    INSERT INTO public.marketing_clicks(campaign_id, destination_url, tracking_id, link_kind)
    VALUES ('4273f000-3000-4000-8000-0000000000a1', 'https://x.test', gen_random_uuid()::text, 'other');
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  PERFORM pg_temp.chk('C-03 an unknown link kind is refused', ok, '');
END;
$clicks$;

-- ── H. The price history is closed to app roles ───────────────────────────
DO $history$
DECLARE r text; op text; ok boolean;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH op IN ARRAY ARRAY['select', 'insert', 'update', 'delete'] LOOP
      ok := false;
      BEGIN
        EXECUTE format('SET LOCAL ROLE %I', r);
        IF op = 'select' THEN PERFORM 1 FROM public.sms_country_price_history;
        ELSIF op = 'insert' THEN
          INSERT INTO public.sms_country_price_history(country, currency, minor_numerator, minor_denominator, source)
          VALUES ('GB', 'USD', 1, 100, 'twilio_pricing_api');
        ELSIF op = 'update' THEN UPDATE public.sms_country_price_history SET minor_numerator = 1;
        ELSE DELETE FROM public.sms_country_price_history;
        END IF;
      EXCEPTION WHEN insufficient_privilege THEN ok := true;
      END;
      RESET ROLE;
      PERFORM pg_temp.chk('H-01 ' || r || ' cannot ' || op || ' sms_country_price_history', ok, '');
    END LOOP;
  END LOOP;
  PERFORM pg_temp.chk('H-02 the history is seeded from the price table (US, NG)',
    (SELECT array_agg(DISTINCT country ORDER BY country) FROM public.sms_country_price_history) = ARRAY['NG', 'US'], '');
END;
$history$;

DO $report$
DECLARE v text;
BEGIN
  SELECT string_agg(line, E'\n' ORDER BY id) INTO v FROM t4273o_fail;
  IF v IS NOT NULL THEN RAISE EXCEPTION E'#4273 SMS opt-out scope (tester adversarial) FAIL:\n%', v; END IF;
  RAISE NOTICE '#4273 SMS opt-out scope (tester adversarial): PASS';
END;
$report$;

ROLLBACK;
