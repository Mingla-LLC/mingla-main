\set ON_ERROR_STOP on
BEGIN;

-- Issue #1529 T-5 — SQL side of the SQL/TypeScript parity contract.
--
-- `public.mingla_e164_country()` and `countryFromE164()` in
-- supabase/functions/_shared/e164Country.ts are two implementations of one
-- rule. If they drift, the country written onto an outbox row stops matching
-- the country every downstream consumer derives, and #1529 comes back wearing
-- a different hat.
--
-- THE FIXTURE BLOCK BELOW IS THE SINGLE SOURCE OF TRUTH FOR BOTH SUITES.
-- supabase/functions/_shared/e164Country.issue1529.test.ts READS THIS FILE,
-- parses the VALUES tuples between the BEGIN/END markers, and asserts the
-- TypeScript implementation returns exactly the same two columns. That is why
-- the markers and the one-tuple-per-line shape matter — do not reflow them,
-- and do not embed quotes inside a fixture value.
--
-- Adding a country means: one branch in public.mingla_e164_country, one entry
-- in CALLING_CODE_TO_ISO2 in e164Country.ts, and one row here.

CREATE TEMP TABLE issue_1529_e164_fixtures (
  label          text NOT NULL,
  raw            text,
  expect_e164    text,
  expect_country text
);

-- #1529-T5-FIXTURES-BEGIN
INSERT INTO issue_1529_e164_fixtures (label, raw, expect_e164, expect_country) VALUES
  ('null_input', NULL, NULL, NULL),
  ('empty_string', '', NULL, NULL),
  ('blank_spaces', '   ', NULL, NULL),
  ('email_plain', 'guest@example.com', NULL, NULL),
  ('email_with_digits', 'user2000@example.com', NULL, NULL),
  ('ng_e164', '+2348012345678', '+2348012345678', 'NG'),
  ('ng_no_plus', '2348012345678', '+2348012345678', 'NG'),
  ('ng_production_row', '2347084065203', '+2347084065203', 'NG'),
  ('ng_spaced', '+234 801 234 5678', '+2348012345678', 'NG'),
  ('us_e164', '+14155550123', '+14155550123', 'US'),
  ('us_no_plus', '14155550123', '+14155550123', 'US'),
  ('us_formatted', '+1 (415) 555-0123', '+14155550123', 'US'),
  ('gb_e164', '+447700900000', '+447700900000', 'GB'),
  ('be_e164', '+32460964460', '+32460964460', 'BE'),
  ('de_unmapped', '+4915112345678', '+4915112345678', NULL),
  ('plus_only', '+', NULL, NULL),
  ('plus_leading_zero', '+0348012345678', NULL, NULL),
  ('letters_only', 'not a number', NULL, NULL);
-- #1529-T5-FIXTURES-END

-- Vacuity guard. A fixture table that silently emptied (a bad edit, a reflow
-- that broke the INSERT) would make every assertion below pass over zero rows.
-- This is the `unfalsifiable test` failure mode, and it fails loudly here.
DO $vacuity$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM issue_1529_e164_fixtures;
  IF v_count = 0 THEN
    RAISE EXCEPTION 'issue_1529_t5_fixture_table_is_empty';
  END IF;
  IF v_count < 18 THEN
    RAISE EXCEPTION
      'issue_1529_t5_fixture_count_shrank_expected_at_least_18_got_%', v_count;
  END IF;
  -- The fixture set must keep covering every branch of the rule, so a future
  -- edit cannot quietly delete the cases that encode the bug.
  IF NOT EXISTS (SELECT 1 FROM issue_1529_e164_fixtures WHERE expect_country = 'NG') THEN
    RAISE EXCEPTION 'issue_1529_t5_fixtures_lost_ng_coverage';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM issue_1529_e164_fixtures WHERE expect_country = 'US') THEN
    RAISE EXCEPTION 'issue_1529_t5_fixtures_lost_us_coverage';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM issue_1529_e164_fixtures
    WHERE label = 'de_unmapped' AND expect_country IS NULL
  ) THEN
    RAISE EXCEPTION 'issue_1529_t5_fixtures_lost_unmapped_is_null_coverage';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM issue_1529_e164_fixtures
    WHERE label = 'ng_no_plus' AND expect_e164 = '+2348012345678'
  ) THEN
    RAISE EXCEPTION 'issue_1529_t5_fixtures_lost_plusless_normalisation_coverage';
  END IF;
END;
$vacuity$;

-- The normalisation contract. Fails on revert: drop the '+' prepend from
-- public.mingla_e164_normalize and every no-plus fixture returns NULL.
DO $normalize$
DECLARE
  v_row    record;
  v_actual text;
BEGIN
  FOR v_row IN SELECT * FROM issue_1529_e164_fixtures LOOP
    v_actual := public.mingla_e164_normalize(v_row.raw);
    IF v_actual IS DISTINCT FROM v_row.expect_e164 THEN
      RAISE EXCEPTION
        'issue_1529_normalize_mismatch_% expected_% got_%',
        v_row.label, COALESCE(v_row.expect_e164, '<NULL>'), COALESCE(v_actual, '<NULL>');
    END IF;
  END LOOP;
END;
$normalize$;

-- The country contract. Fails on revert: any reintroduced "default to US"
-- turns de_unmapped / email / NULL rows into 'US' and this raises.
DO $country$
DECLARE
  v_row    record;
  v_actual text;
BEGIN
  FOR v_row IN SELECT * FROM issue_1529_e164_fixtures LOOP
    v_actual := public.mingla_e164_country(v_row.raw);
    IF v_actual IS DISTINCT FROM v_row.expect_country THEN
      RAISE EXCEPTION
        'issue_1529_country_mismatch_% expected_% got_%',
        v_row.label, COALESCE(v_row.expect_country, '<NULL>'), COALESCE(v_actual, '<NULL>');
    END IF;
  END LOOP;
END;
$country$;

-- NULL NEVER MEANS US. Stated as its own assertion because it is the entire
-- defect: the old adapter coerced a missing country into 'US' and shipped
-- Nigerian handsets to Twilio. Anything that restores that coercion inside the
-- SQL helper fails here.
DO $null_is_not_us$
BEGIN
  IF public.mingla_e164_country(NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'issue_1529_null_contact_resolved_to_a_country';
  END IF;
  IF public.mingla_e164_country('guest@example.com') IS NOT NULL THEN
    RAISE EXCEPTION 'issue_1529_email_contact_resolved_to_a_country';
  END IF;
  IF public.mingla_e164_country('+4915112345678') IS NOT NULL THEN
    RAISE EXCEPTION 'issue_1529_unmapped_calling_code_resolved_to_a_country';
  END IF;
END;
$null_is_not_us$;

-- The helpers must be IMMUTABLE so they are safe in index/generated contexts
-- and so the planner cannot be surprised by them inside a trigger.
DO $volatility$
DECLARE
  v_normalize char;
  v_country   char;
BEGIN
  SELECT provolatile INTO v_normalize
  FROM pg_proc WHERE oid = 'public.mingla_e164_normalize(text)'::regprocedure;
  SELECT provolatile INTO v_country
  FROM pg_proc WHERE oid = 'public.mingla_e164_country(text)'::regprocedure;
  IF v_normalize <> 'i' THEN
    RAISE EXCEPTION 'issue_1529_normalize_not_immutable_got_%', v_normalize;
  END IF;
  IF v_country <> 'i' THEN
    RAISE EXCEPTION 'issue_1529_country_not_immutable_got_%', v_country;
  END IF;
END;
$volatility$;

-- The column comment is the durable explanation of what NULL means. It is the
-- thing whose absence let #1529 ship: the column was born with no COMMENT
-- while every other semantically-loaded column in that migration had one.
DO $column_comment$
DECLARE
  v_comment text;
BEGIN
  SELECT col_description(
    'public.notification_outbox'::regclass,
    (SELECT attnum FROM pg_attribute
      WHERE attrelid = 'public.notification_outbox'::regclass
        AND attname = 'country_code')
  ) INTO v_comment;
  IF v_comment IS NULL OR v_comment = '' THEN
    RAISE EXCEPTION 'issue_1529_country_code_column_comment_missing';
  END IF;
  IF v_comment NOT LIKE '%NEVER means US%' THEN
    RAISE EXCEPTION 'issue_1529_country_code_comment_lost_null_is_not_us_meaning';
  END IF;
END;
$column_comment$;

ROLLBACK;
