-- #4273 — every payout country maps in SQL too, and SMS prices are automatic.
-- Runs on the fully applied migration chain and rolls back.
--
-- MINGLA-INVARIANT: I-4273-SMS-PRICE-TABLE-SERVICE-ONLY | issue #4273 | public.sms_country_prices has RLS on, no policy, and no anon/authenticated privilege; only the service role reads or writes SMS prices.
\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE t4273c_fail(id serial, line text) ON COMMIT DROP;
CREATE FUNCTION pg_temp.chk(p_name text, p_ok boolean, p_detail text DEFAULT '') RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF p_ok IS NOT TRUE THEN INSERT INTO t4273c_fail(line) VALUES (p_name || ' :: ' || COALESCE(p_detail, '')); END IF;
END; $f$;

DO $map$
DECLARE r record; v text;
BEGIN
  -- T-H: the 35 payout countries, Canada by area code, the other NANP members
  -- as their own (untexted) country, the four left out. These rows are also
  -- the Deno parity fixtures (issue_4273_sms_all_countries.implementor.test.ts
  -- T-A3 reads them and checks smsMarketingCountry gives the same answers).
  FOR r IN SELECT * FROM (VALUES
    ('+12025550142', 'US'), ('+14165550142', 'CA'), ('+16045550142', 'CA'), ('+18075550142', 'CA'),
    ('+447700900142', 'GB'), ('+353851234567', 'IE'), ('+33612345678', 'FR'), ('+32470123456', 'BE'),
    ('+4915112345678', 'DE'), ('+34612345678', 'ES'), ('+31612345678', 'NL'), ('+393123456789', 'IT'),
    ('+351912345678', 'PT'), ('+436641234567', 'AT'), ('+41791234567', 'CH'), ('+359881234567', 'BG'),
    ('+35796123456', 'CY'), ('+420601123456', 'CZ'), ('+4520123456', 'DK'), ('+3725123456', 'EE'),
    ('+358401234567', 'FI'), ('+306912345678', 'GR'), ('+385911234567', 'HR'), ('+36201234567', 'HU'),
    ('+3546111234', 'IS'), ('+4237811234', 'LI'), ('+37061234567', 'LT'), ('+352621123456', 'LU'),
    ('+37121234567', 'LV'), ('+35679123456', 'MT'), ('+4791234567', 'NO'), ('+48601234567', 'PL'),
    ('+40712345678', 'RO'), ('+46701234567', 'SE'), ('+38631234567', 'SI'), ('+421901123456', 'SK'),
    ('+2348031104273', 'NG'),
    ('+12685550142', 'AG'), ('+18765550142', 'JM'), ('+16585550142', 'JM'), ('+18095550142', 'DO'),
    ('+18295550142', 'DO'), ('+18495550142', 'DO'), ('+12425550142', 'BS'), ('+12465550142', 'BB'),
    ('+14415550142', 'BM'), ('+18685550142', 'TT'), ('+17875550142', 'PR'), ('+19395550142', 'PR'),
    ('+13405550142', 'VI'), ('+16715550142', 'GU'), ('+13455550142', 'KY'), ('+17585550142', 'LC'),
    ('+233241234567', NULL), ('+27821234567', NULL), ('+639171234567', NULL), ('+254712345678', NULL)
  ) AS t(phone, expected) LOOP
    v := public.mingla_sms_marketing_country(r.phone);
    PERFORM pg_temp.chk('T-H ' || r.phone, v IS NOT DISTINCT FROM r.expected, COALESCE(v, '<NULL>'));
  END LOOP;
  -- The transactional twin is main's, unchanged (#4273 tester P3).
  PERFORM pg_temp.chk('T-H2 transactional Toronto stays US', public.mingla_e164_country('+14165550142') = 'US', '');
  PERFORM pg_temp.chk('T-H2 transactional Jamaica stays US', public.mingla_e164_country('+18765550142') = 'US', '');
  PERFORM pg_temp.chk('T-H2 transactional Germany stays unmapped', public.mingla_e164_country('+4915112345678') IS NULL, '');
END;
$map$;

DO $prices$
DECLARE v_ok boolean;
BEGIN
  PERFORM pg_temp.chk('S-01 RLS is on',
    (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.sms_country_prices'::regclass), '');
  PERFORM pg_temp.chk('S-02 no policy opens it',
    NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'sms_country_prices'), '');
  PERFORM pg_temp.chk('S-03 app roles cannot read or write it',
    NOT has_table_privilege('anon', 'public.sms_country_prices', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.sms_country_prices', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.sms_country_prices', 'INSERT')
    AND NOT has_table_privilege('authenticated', 'public.sms_country_prices', 'UPDATE'), '');
  PERFORM pg_temp.chk('S-04 the service role reads and writes it',
    has_table_privilege('service_role', 'public.sms_country_prices', 'SELECT')
    AND has_table_privilege('service_role', 'public.sms_country_prices', 'UPDATE'), '');
  -- The seed: US and NG are priced before the first fetch.
  PERFORM pg_temp.chk('S-05 US is seeded at USD 0.0083/segment',
    EXISTS (SELECT 1 FROM public.sms_country_prices WHERE country = 'US' AND provider = 'twilio'
             AND currency = 'USD' AND minor_numerator = 83 AND minor_denominator = 100 AND source = 'seed_4080'),
    (SELECT string_agg(country || '/' || source, ',') FROM public.sms_country_prices));
  PERFORM pg_temp.chk('S-06 NG is fixed at NGN 5.00/segment on Termii',
    EXISTS (SELECT 1 FROM public.sms_country_prices WHERE country = 'NG' AND provider = 'termii'
             AND currency = 'NGN' AND minor_numerator = 500 AND minor_denominator = 1 AND source = 'termii_fixed'), '');
  -- The table refuses nonsense.
  BEGIN
    INSERT INTO public.sms_country_prices VALUES ('GB', 'twilio', 'USD', 0, 100, 'twilio_pricing_api', 'x', now(), now());
    v_ok := false;
  EXCEPTION WHEN check_violation THEN v_ok := true;
  END;
  PERFORM pg_temp.chk('S-07 a zero price is refused', v_ok, '');
  BEGIN
    INSERT INTO public.sms_country_prices VALUES ('GB', 'termii', 'USD', 5, 100, 'twilio_pricing_api', 'x', now(), now());
    v_ok := false;
  EXCEPTION WHEN check_violation THEN v_ok := true;
  END;
  PERFORM pg_temp.chk('S-08 only NG may be on Termii', v_ok, '');
  PERFORM pg_temp.chk('S-09 the daily refresh is scheduled',
    NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
    OR EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'issue_4273_sms_price_refresh'
                AND schedule = '17 6 * * *' AND command LIKE '%/functions/v1/sms-price-refresh%'), '');
END;
$prices$;

DO $report$
DECLARE v text;
BEGIN
  SELECT string_agg(line, E'\n' ORDER BY id) INTO v FROM t4273c_fail;
  IF v IS NOT NULL THEN RAISE EXCEPTION E'#4273 all countries / automatic prices FAIL:\n%', v; END IF;
  RAISE NOTICE '#4273 all countries / automatic prices: PASS';
END;
$report$;

ROLLBACK;
