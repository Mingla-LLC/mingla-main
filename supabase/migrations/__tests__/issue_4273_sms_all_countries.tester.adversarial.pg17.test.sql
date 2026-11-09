-- #4273 — tester adversarial for "text every payout country" (database half).
-- The price table is closed to app roles in every direction and refuses bad
-- rows on its own; the seed never overwrites a fetched price; the daily
-- refresh is scheduled; the SQL calling-code map agrees with the edge on the
-- edges of each prefix; and the SMS opt-out row exactly as marketing-
-- unsubscribe writes it is accepted, is idempotent, and stops Blast SMS to
-- that number. Runs on the fully applied migration chain and rolls back.
\set ON_ERROR_STOP on
BEGIN;

UPDATE public.feature_flags SET is_enabled = true
WHERE flag_key IN ('contact_import_v1', 'brand_book_blast_v1', 'manual_contact_groups_v1');
CREATE TABLE IF NOT EXISTS auth.identities(user_id uuid, provider text, identity_data jsonb);
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;

CREATE TEMP TABLE t4273x_fail(id serial, line text) ON COMMIT DROP;
GRANT ALL ON t4273x_fail TO PUBLIC;
GRANT USAGE, SELECT ON SEQUENCE t4273x_fail_id_seq TO PUBLIC;
CREATE FUNCTION pg_temp.chk(p_name text, p_ok boolean, p_detail text DEFAULT '') RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF p_ok IS NOT TRUE THEN INSERT INTO t4273x_fail(line) VALUES (p_name || ' :: ' || COALESCE(p_detail, '')); END IF;
END; $f$;

-- ── P. The price table: closed to app roles, self-validating ──────────────
DO $roles$
DECLARE r text; op text; ok boolean;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH op IN ARRAY ARRAY['select', 'insert', 'update', 'delete'] LOOP
      ok := false;
      BEGIN
        EXECUTE format('SET LOCAL ROLE %I', r);
        IF op = 'select' THEN
          PERFORM 1 FROM public.sms_country_prices;
        ELSIF op = 'insert' THEN
          INSERT INTO public.sms_country_prices(country, provider, currency, minor_numerator, minor_denominator, source, source_reference, fetched_at)
          VALUES ('GB', 'twilio', 'USD', 1, 100, 'twilio_pricing_api', 'x', now());
        ELSIF op = 'update' THEN
          UPDATE public.sms_country_prices SET minor_numerator = 1;
        ELSE
          DELETE FROM public.sms_country_prices;
        END IF;
      EXCEPTION WHEN insufficient_privilege THEN ok := true;
      END;
      RESET ROLE;
      PERFORM pg_temp.chk('P-01 ' || r || ' cannot ' || op || ' sms_country_prices', ok, '');
    END LOOP;
  END LOOP;
END;
$roles$;

DO $shape$
DECLARE ok boolean; bad record;
BEGIN
  FOR bad IN SELECT * FROM (VALUES
    ('zero price', 'GB', 'twilio', 'USD', 0::bigint, 100::bigint, 'twilio_pricing_api'),
    ('negative price', 'GB', 'twilio', 'USD', -5::bigint, 100::bigint, 'twilio_pricing_api'),
    ('zero denominator', 'GB', 'twilio', 'USD', 5::bigint, 0::bigint, 'twilio_pricing_api'),
    ('NG on twilio', 'NG', 'twilio', 'USD', 5::bigint, 100::bigint, 'twilio_pricing_api'),
    ('US on termii', 'US', 'termii', 'NGN', 5::bigint, 1::bigint, 'termii_fixed'),
    ('lowercase country', 'gb', 'twilio', 'USD', 5::bigint, 100::bigint, 'twilio_pricing_api'),
    ('bad currency', 'GB', 'twilio', 'usd', 5::bigint, 100::bigint, 'twilio_pricing_api'),
    ('unknown source', 'GB', 'twilio', 'USD', 5::bigint, 100::bigint, 'manual_paste')
  ) v(label, country, provider, currency, n, d, source) LOOP
    ok := false;
    BEGIN
      INSERT INTO public.sms_country_prices(country, provider, currency, minor_numerator, minor_denominator, source, source_reference, fetched_at)
      VALUES (bad.country, bad.provider, bad.currency, bad.n, bad.d, bad.source, 'tester', now());
    EXCEPTION WHEN check_violation THEN ok := true;
    END;
    PERFORM pg_temp.chk('P-02 the table refuses: ' || bad.label, ok, '');
  END LOOP;
END;
$shape$;

-- The seed's ON CONFLICT DO NOTHING never overwrites a fetched price.
UPDATE public.sms_country_prices
   SET minor_numerator = 79, minor_denominator = 10000, source = 'twilio_pricing_api',
       source_reference = 'tester fetch', fetched_at = '2026-11-08T06:17:00Z'
 WHERE country = 'US';
INSERT INTO public.sms_country_prices
  (country, provider, currency, minor_numerator, minor_denominator, source, source_reference, fetched_at)
VALUES
  ('US', 'twilio', 'USD', 83, 100, 'seed_4080', 'seed again', '2026-10-23T00:00:00Z'),
  ('NG', 'termii', 'NGN', 500, 1, 'termii_fixed', 'seed again', '2026-10-23T00:00:00Z')
ON CONFLICT (country) DO NOTHING;
SELECT pg_temp.chk('P-03 re-running the seed keeps the fetched US price',
  (SELECT minor_numerator = 79 AND minor_denominator = 10000 AND source = 'twilio_pricing_api'
     FROM public.sms_country_prices WHERE country = 'US'), '');
SELECT pg_temp.chk('P-04 only US and NG are seeded (every other country is unpriced until fetched)',
  (SELECT array_agg(country ORDER BY country) FROM public.sms_country_prices) = ARRAY['NG', 'US'], '');
SELECT pg_temp.chk('P-05 the daily refresh is scheduled once, against sms-price-refresh',
  (SELECT count(*) FROM cron.job WHERE jobname = 'issue_4273_sms_price_refresh'
     AND schedule = '17 6 * * *' AND command LIKE '%/functions/v1/sms-price-refresh%') = 1, '');

-- ── E. Calling codes at the edges of each prefix (SQL twin) ───────────────
DO $codes$
DECLARE r record; v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('+35312345678', 'IE'), ('+35512345678', NULL), ('+3551234567', NULL),
    ('+42312345678', 'LI'), ('+42212345678', NULL), ('+3801234567', NULL),
    ('+27821234567', NULL), ('+639171234567', NULL), ('+233241234567', NULL), ('+254712345678', NULL),
    ('+14285550123', 'CA'), ('+15065550123', 'CA'), ('+18765550123', 'US'),
    ('+1428555', 'CA'), ('+142855', NULL), ('+44', NULL)
  ) v(phone, expected) LOOP
    v := public.mingla_e164_country(r.phone);
    PERFORM pg_temp.chk('E-01 ' || r.phone, v IS NOT DISTINCT FROM r.expected, COALESCE(v, '<NULL>'));
  END LOOP;
END;
$codes$;

-- ── U. The SMS opt-out row as marketing-unsubscribe writes it ─────────────
INSERT INTO auth.users(id, email) VALUES ('4273e000-0000-4000-8000-000000000001', 'owner-x@example.test');
INSERT INTO public.creator_accounts(id, email) VALUES ('4273e000-0000-4000-8000-000000000001', 'owner-x@example.test');
INSERT INTO public.brands(id, account_id, name, slug, default_currency, created_at, updated_at) VALUES
  ('4273e000-0000-4000-8000-0000000000b1', '4273e000-0000-4000-8000-000000000001', 'Optout', 'issue-4273x-optout', 'USD', now(), now());
INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone, theme) VALUES
  ('4273e000-1000-4000-8000-000000000001', '4273e000-0000-4000-8000-0000000000b1', '4273e000-0000-4000-8000-000000000001',
   'Night', 't4273x-night', 'event', 'scheduled', 'public', 'UTC', '{}'::jsonb);
INSERT INTO public.orders(id, event_id, buyer_email, buyer_phone_e164, buyer_name, total_cents, currency, payment_status, source, confirmed_at) VALUES
  ('4273e000-1100-4000-8000-000000000001', '4273e000-1000-4000-8000-000000000001', 'gb-x@example.test', '+447700900777', 'Gb', 1000, 'USD', 'paid', 'legacy', now());
SELECT set_config('request.jwt.claim.sub', '4273e000-0000-4000-8000-000000000001', true);

DO $optout$
DECLARE
  b uuid := '4273e000-0000-4000-8000-0000000000b1'; v jsonb; p uuid; before_ok boolean; after_ok boolean; dup boolean := false;
BEGIN
  SELECT public.biz_resolve_brand_person_source(b, o.event_id, 'order', o.id, NULL, NULL,
           o.buyer_email, o.buyer_phone_e164, o.created_at) INTO v
    FROM public.orders o WHERE o.id = '4273e000-1100-4000-8000-000000000001';
  SELECT brand_person_id INTO p FROM public.brand_person_contact_methods
   WHERE brand_id = b AND normalized_value = '+447700900777';
  SELECT COALESCE(bool_or(a.allowed), false) INTO before_ok
    FROM public.biz_brand_person_authorized_contact_v2(b, p, 'sms', 'marketing_blast') a;
  PERFORM pg_temp.chk('U-00 fixture: the UK number is textable before the opt-out', before_ok, '');

  -- Exactly the row marketing-unsubscribe inserts for an SMS token.
  INSERT INTO public.channel_suppressions(user_id, contact, channel, scope, reason, brand_id)
  VALUES (NULL, '+447700900777', 'sms', 'all', 'unsubscribe', NULL);
  SELECT COALESCE(bool_or(a.allowed), false) INTO after_ok
    FROM public.biz_brand_person_authorized_contact_v2(b, p, 'sms', 'marketing_blast') a;
  PERFORM pg_temp.chk('U-01 the opt-out row stops Blast SMS to that number', NOT after_ok, '');

  -- A second click is a unique violation (the handler treats it as done).
  BEGIN
    INSERT INTO public.channel_suppressions(user_id, contact, channel, scope, reason, brand_id)
    VALUES (NULL, '+447700900777', 'sms', 'all', 'unsubscribe', NULL);
  EXCEPTION WHEN unique_violation THEN dup := true;
  END;
  PERFORM pg_temp.chk('U-02 a repeat opt-out is a unique violation, not a second row', dup, '');
  PERFORM pg_temp.chk('U-03 email for the same person is untouched',
    NOT EXISTS (SELECT 1 FROM public.channel_suppressions WHERE contact = 'gb-x@example.test'), '');
END;
$optout$;

DO $report$
DECLARE v text;
BEGIN
  SELECT string_agg(line, E'\n' ORDER BY id) INTO v FROM t4273x_fail;
  IF v IS NOT NULL THEN RAISE EXCEPTION E'#4273 all countries (tester adversarial) FAIL:\n%', v; END IF;
  RAISE NOTICE '#4273 all countries (tester adversarial): PASS';
END;
$report$;

ROLLBACK;
