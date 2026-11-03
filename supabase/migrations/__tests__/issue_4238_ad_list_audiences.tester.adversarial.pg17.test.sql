\set ON_ERROR_STOP on

-- Issue #4238 wave 2 — TESTER adversarial (run after the full migration chain
-- on PostgreSQL 17 as supabase_admin over 127.0.0.1).
--
--   X1  Hosted Supabase preloads pg-safeupdate for every PostgREST session
--       (authenticator: session_preload_libraries=safeupdate). Every audience
--       refresh in production arrives through PostgREST (ad-plan host_setup,
--       admin-ad-audiences sync/removals/create_definition/preview), so the
--       refresh and ensure_brand bodies must run with safeupdate loaded. A bare
--       "DELETE FROM <table>;" raises 21000 "DELETE requires a WHERE clause".
--   X2  Seth's rule: an audience of fewer than 10 people reads "Fewer than 10
--       people". The Host only ever sees host_ad_audiences().approx_size, so a
--       list of 1-9 people must come back below 10 (never rounded up to 10).

CREATE OR REPLACE FUNCTION pg_temp.t4238x_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #4238 tester FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$a$;

BEGIN;
-- What PostgREST sessions run with in hosted Supabase.
LOAD 'safeupdate';

DO $t$
DECLARE
  v_host  constant uuid := '42381000-0000-4000-a000-000000000001';
  v_brand constant uuid := '42381000-0000-4000-a000-000000000101';
  v_person uuid; v_link uuid; v_cm uuid;
  v_size integer;
  v_err text := NULL;
  i integer;
BEGIN
  INSERT INTO auth.users(id, email) VALUES (v_host, 't4238x-host@mingla-fixture.org');
  INSERT INTO public.creator_accounts(id, email) VALUES (v_host, 't4238x-host@mingla-fixture.org');
  INSERT INTO public.brands(id, account_id, name, slug, default_currency, country_code)
  VALUES (v_brand, v_host, 'T4238X Brand', 't4238x-' || v_brand, 'NGN', 'NG');
  -- Seven imported contacts, not linked to any account.
  FOR i IN 1..7 LOOP
    INSERT INTO public.brand_people(brand_id, display_name) VALUES (v_brand, 'T4238X Contact ' || i) RETURNING id INTO v_person;
    INSERT INTO public.brand_person_source_links(brand_id, brand_person_id, source_kind, source_id, link_method, source_occurred_at)
    VALUES (v_brand, v_person, 'import', gen_random_uuid(), 'normalized_address', now()) RETURNING id INTO v_link;
    INSERT INTO public.brand_person_contact_methods(brand_id, brand_person_id, channel, normalized_value, provenance_scope, is_exportable, is_primary)
    VALUES (v_brand, v_person, 'email', format('t4238x-c%s@mingla-fixture.org', i), 'brand_owned', true, true) RETURNING id INTO v_cm;
    INSERT INTO public.brand_person_contact_method_sources(contact_method_id, source_link_id, provenance_kind, exportable)
    VALUES (v_cm, v_link, 'import', true);
  END LOOP;

  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);

  -- X1 ------------------------------------------------------------------------
  BEGIN
    PERFORM public.ad_list_audience_ensure_brand(v_brand);
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLSTATE || ' ' || SQLERRM;
  END;
  PERFORM pg_temp.t4238x_assert(v_err IS NULL,
    'X1 ensure_brand + refresh run under pg-safeupdate (got: ' || COALESCE(v_err, 'ok') || ')');
  PERFORM pg_temp.t4238x_assert(
    (SELECT member_count FROM public.ad_list_audiences WHERE audience_key = 'brand:' || v_brand || ':contacts') = 7,
    'X1 the contacts snapshot was built (7 members)');

  -- X2 ------------------------------------------------------------------------
  SELECT h.approx_size INTO v_size FROM public.host_ad_audiences(v_brand) h
  WHERE h.audience_key = 'brand:' || v_brand || ':contacts';
  PERFORM pg_temp.t4238x_assert(v_size IS NOT NULL AND v_size < 10,
    'X2 a 7-person list reaches the Host below 10 ("Fewer than 10 people"), got ' || COALESCE(v_size::text, 'null'));
  FOR i IN 1..9 LOOP
    PERFORM pg_temp.t4238x_assert(public.ad_list_audience_round_size(i) < 10,
      format('X2 round_size(%s) < 10', i));
  END LOOP;
END
$t$;

ROLLBACK;
