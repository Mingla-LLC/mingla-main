-- Issue #3386 — hosts edit their venue's details.
--
-- Behavioural suite against the real migration chain. One transaction, rolled
-- back at the end; it touches only rows it creates.
--
--   S-*  security shape: SECURITY DEFINER, pinned search_path, no anon EXECUTE,
--        internal helpers not callable by clients, #2099's dependency pin intact
--   C-*  decision 1: contact phone (E.164 + country) and email, no review
--   I-*  decision 2: name, category and address while the venue is in review
--   R-*  decision 3: a live venue's change becomes a request; replace; withdraw
--   P-*  guests and the public read model never see pending values
--   A-*  admin approve applies atomically; reject keeps the live row, with reason

\set ON_ERROR_STOP on
BEGIN;

-- ── Fixtures ────────────────────────────────────────────────────────────────
INSERT INTO auth.users (id, email) VALUES
  ('33860000-0000-4000-8000-000000000001', 'owner-3386@example.test'),
  ('33860000-0000-4000-8000-000000000002', 'manager-3386@example.test'),
  ('33860000-0000-4000-8000-000000000003', 'scanner-3386@example.test'),
  ('33860000-0000-4000-8000-000000000004', 'outsider-3386@example.test'),
  ('33860000-0000-4000-8000-000000000005', 'admin-3386@example.test');

INSERT INTO public.admin_users (email, role, status) VALUES
  ('admin-3386@example.test', 'admin', 'active')
ON CONFLICT (email) DO UPDATE SET role = excluded.role, status = excluded.status;

INSERT INTO public.creator_accounts (id) VALUES
  ('33860000-0000-4000-8000-000000000001'),
  ('33860000-0000-4000-8000-000000000004');

INSERT INTO public.brands (id, account_id, name, slug, default_currency) VALUES
  ('33860000-0000-4000-8000-000000000011', '33860000-0000-4000-8000-000000000001', 'Issue 3386 Brand', 'issue-3386-brand', 'NGN'),
  ('33860000-0000-4000-8000-000000000012', '33860000-0000-4000-8000-000000000004', 'Issue 3386 Other', 'issue-3386-other', 'USD');

INSERT INTO public.brand_team_members (brand_id, user_id, role, accepted_at) VALUES
  ('33860000-0000-4000-8000-000000000011', '33860000-0000-4000-8000-000000000002', 'event_manager', now()),
  ('33860000-0000-4000-8000-000000000011', '33860000-0000-4000-8000-000000000003', 'scanner', now());

-- P1 / P2: business-authored places this brand's venues created. P3: a
-- Google-seeded place this brand claimed, which host edits must never touch.
-- P3 carries the brand as author on purpose, so only the Google-id /
-- fetched_via guard can keep it out of the sync.
INSERT INTO public.place_pool (id, name, address, lat, lng, types, primary_type, is_active, is_claimed,
  is_servable, fetched_via, business_author_brand_id, business_authoring_status, business_authoring_inputs)
VALUES
  ('33860000-0000-4000-8000-000000000021', 'Pending Kitchen', '1 Old Road', 6.45, 3.40, ARRAY['restaurant'], 'restaurant',
   true, true, false, 'business_authored', '33860000-0000-4000-8000-000000000011', 'processing',
   '{"tier1":{"name":"Pending Kitchen","venueCategory":"restaurant","keep":"me"},"other":{"keep":true}}'),
  ('33860000-0000-4000-8000-000000000022', 'Live Lounge', '2 Live Street', 6.50, 3.35, ARRAY['restaurant'], 'restaurant',
   true, true, true, 'business_authored', '33860000-0000-4000-8000-000000000011', 'deck_eligible',
   '{"tier1":{"name":"Live Lounge","venueCategory":"restaurant"}}');
INSERT INTO public.place_pool (id, google_place_id, name, address, lat, lng, types, primary_type, is_active, is_claimed,
  is_servable, business_author_brand_id)
VALUES
  ('33860000-0000-4000-8000-000000000023', 'issue3386-google-place', 'Google Bistro', '3 Google Way', 40.71, -74.00,
   ARRAY['restaurant'], 'restaurant', true, true, true, '33860000-0000-4000-8000-000000000011');

INSERT INTO public.venue_listings (id, brand_id, place_pool_id, slug, name, address, city, country_code, lat, lng,
  coordinate_precision, venue_category, contact_email, contact_phone, claim_status)
VALUES
  -- V1 pending review (decision 2)
  ('33860000-0000-4000-8000-000000000101', '33860000-0000-4000-8000-000000000011', '33860000-0000-4000-8000-000000000021',
   'pendingkitchen', 'Pending Kitchen', '1 Old Road', 'Lagos', 'NG', 6.45, 3.40, 'exact', 'restaurant',
   'old@example.test', NULL, 'pending_review'),
  -- V2 live (decision 3)
  ('33860000-0000-4000-8000-000000000102', '33860000-0000-4000-8000-000000000011', '33860000-0000-4000-8000-000000000022',
   'livelounge', 'Live Lounge', '2 Live Street', 'Lagos', 'NG', 6.50, 3.35, 'exact', 'restaurant',
   'live@example.test', '+2348031234567', 'verified'),
  -- V3 live, Google-seeded place
  ('33860000-0000-4000-8000-000000000103', '33860000-0000-4000-8000-000000000011', '33860000-0000-4000-8000-000000000023',
   'googlebistro', 'Google Bistro', '3 Google Way', 'New York', 'US', 40.71, -74.00, 'exact', 'restaurant',
   NULL, '+12125550100', 'verified'),
  -- V4 live Stay (the Stay category move is refused)
  ('33860000-0000-4000-8000-000000000104', '33860000-0000-4000-8000-000000000011', NULL,
   'livestay', 'Live Stay', '4 Stay Close', 'Lagos', 'NG', 6.40, 3.30, 'approximate', 'stay',
   'stay@example.test', NULL, 'verified'),
  -- V9 another brand's live venue
  ('33860000-0000-4000-8000-000000000109', '33860000-0000-4000-8000-000000000012', NULL,
   'othervenue', 'Other Venue', '9 Elsewhere', 'Austin', 'US', 30.27, -97.74, 'exact', 'restaurant',
   'other@example.test', NULL, 'verified');

CREATE OR REPLACE FUNCTION pg_temp.issue3386_as(p_uid uuid)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
END;
$f$;

CREATE OR REPLACE FUNCTION pg_temp.issue3386_expect_error(p_sql text, p_expected text, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = p_expected THEN
      RETURN;
    END IF;
    RAISE EXCEPTION 'ISSUE-3386 % FAIL: expected %, got %', p_label, p_expected, SQLERRM;
  END;
  RAISE EXCEPTION 'ISSUE-3386 % FAIL: expected %, but the call succeeded', p_label, p_expected;
END;
$f$;

-- ── S: security shape ───────────────────────────────────────────────────────
DO $s$
DECLARE
  v_sig text;
  v_def text;
  v_pin text[];
  v_live jsonb;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public.biz_update_venue_contact(uuid,text,text,text)',
    'public.biz_update_venue_identity_in_review(uuid,text,text,text,text,text,double precision,double precision,text)',
    'public.biz_submit_venue_details_change_request(uuid,text,text,text,text,text,double precision,double precision,text)',
    'public.biz_withdraw_venue_details_change_request(uuid,uuid)',
    'public.admin_review_venue_details_change(uuid,uuid,text,text)'
  ] LOOP
    IF NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = v_sig::regprocedure) THEN
      RAISE EXCEPTION 'ISSUE-3386 S-1 FAIL: % is not SECURITY DEFINER', v_sig;
    END IF;
    IF (SELECT p.proconfig FROM pg_proc p WHERE p.oid = v_sig::regprocedure)
       IS DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[] THEN
      RAISE EXCEPTION 'ISSUE-3386 S-2 FAIL: % search_path is not pinned', v_sig;
    END IF;
    IF has_function_privilege('anon', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'ISSUE-3386 S-3 FAIL: anon can execute %', v_sig;
    END IF;
    IF NOT has_function_privilege('authenticated', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'ISSUE-3386 S-4 FAIL: authenticated cannot execute %', v_sig;
    END IF;
  END LOOP;

  FOREACH v_sig IN ARRAY ARRAY[
    'public.issue_3386_phone_fits_country(text,text)',
    'public.issue_3386_lock_managed_venue(uuid)',
    'public.issue_3386_identity_patch(public.venue_listings,text,text,text,text,text,double precision,double precision,text)',
    'public.issue_3386_sync_business_authored_place(uuid)'
  ] LOOP
    IF has_function_privilege('anon', v_sig, 'EXECUTE')
       OR has_function_privilege('authenticated', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'ISSUE-3386 S-5 FAIL: client role can execute internal helper %', v_sig;
    END IF;
  END LOOP;

  -- S-6: no anon table grant appeared on venue_listings.
  IF has_table_privilege('anon', 'public.venue_listings', 'SELECT') THEN
    RAISE EXCEPTION 'ISSUE-3386 S-6 FAIL: anon can read venue_listings';
  END IF;

  -- S-7: #2099 is not weakened. The dependency-schema fingerprint the correction
  -- RPC pins must still equal the live schema after this migration (a new
  -- venue-keyed table would move it and fail every correction closed).
  v_def := pg_get_functiondef('public.preview_pending_venue_identity_correction(uuid)'::regprocedure);
  v_pin := regexp_match(v_def, $re$\('([0-9a-f]{32})' \|\| '([0-9a-f]{32})'\)$re$);
  IF v_pin IS NULL THEN
    RAISE EXCEPTION 'ISSUE-3386 S-7 FAIL: could not read the #2099 schema pin';
  END IF;
  v_live := public.issue_2099_pending_venue_dependency_inventory(
    '33860000-0000-4000-8000-000000000101', '33860000-0000-4000-8000-000000000021');
  IF v_live ->> 'schema_fingerprint' IS DISTINCT FROM (v_pin[1] || v_pin[2]) THEN
    RAISE EXCEPTION 'ISSUE-3386 S-7 FAIL: #2099 dependency schema moved: pinned %, live %',
      v_pin[1] || v_pin[2], v_live ->> 'schema_fingerprint';
  END IF;

  -- S-8: the public read model names no pending column.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'venue_public_view'
      AND (column_name LIKE 'details_change%' OR column_name = 'contact_phone_country_iso')
  ) THEN
    RAISE EXCEPTION 'ISSUE-3386 S-8 FAIL: venue_public_view exposes a #3386 host-only column';
  END IF;
END;
$s$;

-- ── C: contact, no review ───────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.issue3386_as('33860000-0000-4000-8000-000000000002');

DO $c$
DECLARE
  v_result jsonb;
  v_row public.venue_listings%ROWTYPE;
BEGIN
  -- C-1: a manager saves a Nigerian mobile with its country, and an email.
  v_result := public.biz_update_venue_contact(
    '33860000-0000-4000-8000-000000000101', '+2348031234567', 'ng', ' hello@pending.example ');
  SELECT * INTO v_row FROM public.venue_listings WHERE id = '33860000-0000-4000-8000-000000000101';
  IF v_result ->> 'ok' <> 'true'
     OR v_row.contact_phone IS DISTINCT FROM '+2348031234567'
     OR v_row.contact_phone_country_iso IS DISTINCT FROM 'NG'
     OR v_row.contact_email IS DISTINCT FROM 'hello@pending.example' THEN
    RAISE EXCEPTION 'ISSUE-3386 C-1 FAIL: contact not stored as E.164 + country: % / %', v_result, to_jsonb(v_row);
  END IF;

  -- C-2..C-6: every refusal names the problem and leaves the row alone.
  PERFORM pg_temp.issue3386_expect_error(
    $q$SELECT public.biz_update_venue_contact('33860000-0000-4000-8000-000000000101', '+448031234567', 'NG', 'a@b.co')$q$,
    'phone_country_mismatch', 'C-2a');
  PERFORM pg_temp.issue3386_expect_error(
    $q$SELECT public.biz_update_venue_contact('33860000-0000-4000-8000-000000000101', '+2348031234567', 'GB', 'a@b.co')$q$,
    'phone_country_mismatch', 'C-2b');
  PERFORM pg_temp.issue3386_expect_error(
    $q$SELECT public.biz_update_venue_contact('33860000-0000-4000-8000-000000000101', '+23408031234567', 'NG', 'a@b.co')$q$,
    'phone_country_mismatch', 'C-2c');
  PERFORM pg_temp.issue3386_expect_error(
    $q$SELECT public.biz_update_venue_contact('33860000-0000-4000-8000-000000000101', '08031234567', 'NG', 'a@b.co')$q$,
    'invalid_phone', 'C-3');
  PERFORM pg_temp.issue3386_expect_error(
    $q$SELECT public.biz_update_venue_contact('33860000-0000-4000-8000-000000000101', '+2348031234567', '', 'a@b.co')$q$,
    'phone_country_required', 'C-4');
  PERFORM pg_temp.issue3386_expect_error(
    $q$SELECT public.biz_update_venue_contact('33860000-0000-4000-8000-000000000101', '', '', 'not an email')$q$,
    'invalid_email', 'C-5');
  PERFORM pg_temp.issue3386_expect_error(
    $q$SELECT public.biz_update_venue_contact('33860000-0000-4000-8000-000000000101', '', 'NG', '  ')$q$,
    'contact_required', 'C-6');
  SELECT * INTO v_row FROM public.venue_listings WHERE id = '33860000-0000-4000-8000-000000000101';
  IF v_row.contact_phone IS DISTINCT FROM '+2348031234567'
     OR v_row.contact_email IS DISTINCT FROM 'hello@pending.example' THEN
    RAISE EXCEPTION 'ISSUE-3386 C-6b FAIL: a refused save changed the row';
  END IF;

  -- C-7: an unlisted country accepts any well-formed E.164 number; clearing the
  -- phone clears its country too.
  v_result := public.biz_update_venue_contact(
    '33860000-0000-4000-8000-000000000101', '+33612345678', 'FR', 'hello@pending.example');
  v_result := public.biz_update_venue_contact(
    '33860000-0000-4000-8000-000000000101', '', 'FR', 'hello@pending.example');
  SELECT * INTO v_row FROM public.venue_listings WHERE id = '33860000-0000-4000-8000-000000000101';
  IF v_row.contact_phone IS NOT NULL OR v_row.contact_phone_country_iso IS NOT NULL THEN
    RAISE EXCEPTION 'ISSUE-3386 C-7 FAIL: clearing the phone left %/%', v_row.contact_phone, v_row.contact_phone_country_iso;
  END IF;

  -- C-8: a live venue's contact change is live at once (no review).
  v_result := public.biz_update_venue_contact(
    '33860000-0000-4000-8000-000000000102', '+2349012345678', 'NG', 'bookings@live.example');
  IF (SELECT contact_phone FROM public.venue_public_view WHERE id = '33860000-0000-4000-8000-000000000102')
     IS DISTINCT FROM '+2349012345678' THEN
    RAISE EXCEPTION 'ISSUE-3386 C-8 FAIL: live contact change did not reach the public view';
  END IF;

  -- C-9: another brand's venue is refused.
  PERFORM pg_temp.issue3386_expect_error(
    $q$SELECT public.biz_update_venue_contact('33860000-0000-4000-8000-000000000109', '+15125550100', 'US', 'x@y.co')$q$,
    'forbidden', 'C-9');
END;
$c$;

-- C-10: a scanner cannot edit contact.
SELECT pg_temp.issue3386_as('33860000-0000-4000-8000-000000000003');
DO $c10$
BEGIN
  PERFORM pg_temp.issue3386_expect_error(
    $q$SELECT public.biz_update_venue_contact('33860000-0000-4000-8000-000000000102', '+2348000000000', 'NG', 'x@y.co')$q$,
    'forbidden', 'C-10');
END;
$c10$;

-- C-11: anon cannot call it at all.
RESET ROLE;
SET LOCAL ROLE anon;
DO $c11$
BEGIN
  BEGIN
    PERFORM public.biz_update_venue_contact('33860000-0000-4000-8000-000000000102', '+2348000000000', 'NG', 'x@y.co');
    RAISE EXCEPTION 'ISSUE-3386 C-11 FAIL: anon executed the contact RPC';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END;
$c11$;
RESET ROLE;

-- ── I: name, category and address while in review ──────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.issue3386_as('33860000-0000-4000-8000-000000000002');

DO $i$
DECLARE
  v_result jsonb;
  v_row public.venue_listings%ROWTYPE;
  v_before public.venue_listings%ROWTYPE;
BEGIN
  -- I-1: rename, recategorise and move with a picked pin, in one save.
  v_result := public.biz_update_venue_identity_in_review(
    '33860000-0000-4000-8000-000000000101',
    p_name => '  Pending Kitchen & Bar ',
    p_venue_category => 'play',
    p_address => '10 New Road, Lekki',
    p_city => 'Lagos',
    p_country_code => 'ng',
    p_lat => 6.4474,
    p_lng => 3.4723,
    p_coordinate_precision => 'exact'
  );
  SELECT * INTO v_row FROM public.venue_listings WHERE id = '33860000-0000-4000-8000-000000000101';
  IF v_result ->> 'changed' <> 'true'
     OR v_row.name <> 'Pending Kitchen & Bar'
     OR v_row.venue_category <> 'play'
     OR v_row.address <> '10 New Road, Lekki'
     OR v_row.country_code <> 'NG'
     OR v_row.lat <> 6.4474 OR v_row.lng <> 3.4723
     OR v_row.coordinate_precision <> 'exact'
     OR v_row.slug <> 'pendingkitchen'
     OR v_row.claim_status <> 'pending_review' THEN
    RAISE EXCEPTION 'ISSUE-3386 I-1 FAIL: in-review edit not applied: % / %', v_result, to_jsonb(v_row);
  END IF;

  -- I-2..I-6: refusals leave the row exactly as it was.
  v_before := v_row;
  PERFORM pg_temp.issue3386_expect_error(
    $q$SELECT public.biz_update_venue_identity_in_review('33860000-0000-4000-8000-000000000101', p_address => '11 Pinless Road')$q$,
    'address_location_required', 'I-2a');
  PERFORM pg_temp.issue3386_expect_error(
    $q$SELECT public.biz_update_venue_identity_in_review('33860000-0000-4000-8000-000000000101', p_lat => 6.5, p_lng => 3.5, p_coordinate_precision => 'exact')$q$,
    'address_required', 'I-2b');
  PERFORM pg_temp.issue3386_expect_error(
    $q$SELECT public.biz_update_venue_identity_in_review('33860000-0000-4000-8000-000000000101', p_address => '11 Road', p_lat => 6.5, p_lng => 3.5)$q$,
    'invalid_coordinate_precision', 'I-3');
  PERFORM pg_temp.issue3386_expect_error(
    $q$SELECT public.biz_update_venue_identity_in_review('33860000-0000-4000-8000-000000000101', p_address => '11 Road', p_lat => 96, p_lng => 3.5, p_coordinate_precision => 'exact')$q$,
    'invalid_location', 'I-3b');
  PERFORM pg_temp.issue3386_expect_error(
    $q$SELECT public.biz_update_venue_identity_in_review('33860000-0000-4000-8000-000000000101', p_venue_category => 'stay')$q$,
    'category_stay_change_not_supported', 'I-4');
  PERFORM pg_temp.issue3386_expect_error(
    $q$SELECT public.biz_update_venue_identity_in_review('33860000-0000-4000-8000-000000000101', p_name => '   ')$q$,
    'invalid_name', 'I-5a');
  PERFORM pg_temp.issue3386_expect_error(
    format('SELECT public.biz_update_venue_identity_in_review(%L, p_name => %L)',
      '33860000-0000-4000-8000-000000000101', repeat('n', 81)),
    'invalid_name', 'I-5b');
  PERFORM pg_temp.issue3386_expect_error(
    $q$SELECT public.biz_update_venue_identity_in_review('33860000-0000-4000-8000-000000000102', p_name => 'Live rename')$q$,
    'venue_not_in_review', 'I-6');
  SELECT * INTO v_row FROM public.venue_listings WHERE id = '33860000-0000-4000-8000-000000000101';
  IF to_jsonb(v_row) - 'updated_at' IS DISTINCT FROM to_jsonb(v_before) - 'updated_at' THEN
    RAISE EXCEPTION 'ISSUE-3386 I-6b FAIL: a refused in-review edit changed the row';
  END IF;

  -- I-7: re-sending the current values is a no-op.
  v_result := public.biz_update_venue_identity_in_review(
    '33860000-0000-4000-8000-000000000101', p_name => 'Pending Kitchen & Bar', p_venue_category => 'play');
  IF v_result ->> 'changed' <> 'false' THEN
    RAISE EXCEPTION 'ISSUE-3386 I-7 FAIL: unchanged values reported a change: %', v_result;
  END IF;
END;
$i$;

-- I-8: the business-authored place follows the venue; its other authoring
-- inputs survive. (Read as postgres: place_pool is not a host read.)
RESET ROLE;
DO $i8$
DECLARE
  v_pool record;
BEGIN
  SELECT name, address, lat, lng, business_authoring_inputs AS inputs INTO v_pool
  FROM public.place_pool WHERE id = '33860000-0000-4000-8000-000000000021';
  IF v_pool.name <> 'Pending Kitchen & Bar' OR v_pool.address <> '10 New Road, Lekki'
     OR v_pool.lat <> 6.4474 OR v_pool.lng <> 3.4723
     OR v_pool.inputs #>> '{tier1,name}' <> 'Pending Kitchen & Bar'
     OR v_pool.inputs #>> '{tier1,venueCategory}' <> 'play'
     OR v_pool.inputs #>> '{tier1,keep}' <> 'me'
     OR v_pool.inputs #>> '{other,keep}' <> 'true' THEN
    RAISE EXCEPTION 'ISSUE-3386 I-8 FAIL: business-authored place not kept in step: %', row_to_json(v_pool);
  END IF;
END;
$i8$;

-- I-9: a scanner cannot edit identity.
SET LOCAL ROLE authenticated;
SELECT pg_temp.issue3386_as('33860000-0000-4000-8000-000000000003');
DO $i9$
BEGIN
  PERFORM pg_temp.issue3386_expect_error(
    $q$SELECT public.biz_update_venue_identity_in_review('33860000-0000-4000-8000-000000000101', p_name => 'Scanner rename')$q$,
    'forbidden', 'I-9');
END;
$i9$;

-- I-10: no client write path around the RPCs — a member's direct UPDATE of the
-- request columns reaches no row.
SELECT pg_temp.issue3386_as('33860000-0000-4000-8000-000000000002');
DO $i10$
DECLARE
  v_count integer;
BEGIN
  BEGIN
    UPDATE public.venue_listings
    SET name = 'Direct write'
    WHERE id = '33860000-0000-4000-8000-000000000102';
    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count <> 0 THEN
      RAISE EXCEPTION 'ISSUE-3386 I-10 FAIL: a member updated venue_listings directly';
    END IF;
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END;
$i10$;

-- ── R + P: a live venue's change is a request; guests keep the live values ──
DO $r$
DECLARE
  v_result jsonb;
  v_first uuid;
  v_second uuid;
  v_row public.venue_listings%ROWTYPE;
BEGIN
  -- R-1: rename and move the live venue. The live row does not change.
  v_result := public.biz_submit_venue_details_change_request(
    '33860000-0000-4000-8000-000000000102',
    p_name => 'Live Lounge Rooftop',
    p_address => '20 Admiralty Way',
    p_city => 'Lagos',
    p_country_code => 'NG',
    p_lat => 6.4300,
    p_lng => 3.4200,
    p_coordinate_precision => 'approximate'
  );
  v_first := (v_result ->> 'request_id')::uuid;
  SELECT * INTO v_row FROM public.venue_listings WHERE id = '33860000-0000-4000-8000-000000000102';
  IF v_first IS NULL
     OR v_row.name <> 'Live Lounge' OR v_row.address <> '2 Live Street'
     OR v_row.lat <> 6.50 OR v_row.lng <> 3.35 OR v_row.coordinate_precision <> 'exact'
     OR v_row.details_change_status <> 'pending'
     OR v_row.details_change_request_id IS DISTINCT FROM v_first
     OR v_row.details_change_name <> 'Live Lounge Rooftop'
     OR v_row.details_change_address <> '20 Admiralty Way'
     OR v_row.details_change_lat <> 6.43
     OR v_row.details_change_coordinate_precision <> 'approximate'
     OR v_row.details_change_venue_category IS NOT NULL
     OR v_row.details_change_requested_by IS DISTINCT FROM '33860000-0000-4000-8000-000000000002'::uuid THEN
    RAISE EXCEPTION 'ISSUE-3386 R-1 FAIL: request not stored beside the untouched live row: % / %', v_result, to_jsonb(v_row);
  END IF;

  -- R-2: guards.
  PERFORM pg_temp.issue3386_expect_error(
    $q$SELECT public.biz_submit_venue_details_change_request('33860000-0000-4000-8000-000000000101', p_name => 'Not live yet')$q$,
    'venue_not_live', 'R-2a');
  PERFORM pg_temp.issue3386_expect_error(
    $q$SELECT public.biz_submit_venue_details_change_request('33860000-0000-4000-8000-000000000103', p_name => 'Google Bistro')$q$,
    'nothing_to_change', 'R-2b');
  PERFORM pg_temp.issue3386_expect_error(
    $q$SELECT public.biz_submit_venue_details_change_request('33860000-0000-4000-8000-000000000104', p_venue_category => 'restaurant')$q$,
    'category_stay_change_not_supported', 'R-2c');
  PERFORM pg_temp.issue3386_expect_error(
    $q$SELECT public.biz_submit_venue_details_change_request('33860000-0000-4000-8000-000000000103', p_address => '5 Pinless Ave')$q$,
    'address_location_required', 'R-2d');
  PERFORM pg_temp.issue3386_expect_error(
    $q$SELECT public.biz_submit_venue_details_change_request('33860000-0000-4000-8000-000000000109', p_name => 'Hijack')$q$,
    'forbidden', 'R-2e');

  -- R-3: a new request replaces the old one entirely.
  v_result := public.biz_submit_venue_details_change_request(
    '33860000-0000-4000-8000-000000000102', p_venue_category => 'creative_and_arts');
  v_second := (v_result ->> 'request_id')::uuid;
  SELECT * INTO v_row FROM public.venue_listings WHERE id = '33860000-0000-4000-8000-000000000102';
  IF v_second IS NULL OR v_second = v_first OR v_result ->> 'replaced' <> 'true'
     OR v_row.details_change_request_id IS DISTINCT FROM v_second
     OR v_row.details_change_venue_category <> 'creative_and_arts'
     OR v_row.details_change_name IS NOT NULL
     OR v_row.details_change_address IS NOT NULL
     OR v_row.details_change_lat IS NOT NULL THEN
    RAISE EXCEPTION 'ISSUE-3386 R-3 FAIL: the new request did not replace the old one: %', to_jsonb(v_row);
  END IF;

  -- R-4: a stale screen cannot withdraw the newer request; the current id can.
  PERFORM pg_temp.issue3386_expect_error(
    format('SELECT public.biz_withdraw_venue_details_change_request(%L, %L)',
      '33860000-0000-4000-8000-000000000102', v_first),
    'request_superseded', 'R-4a');
  v_result := public.biz_withdraw_venue_details_change_request('33860000-0000-4000-8000-000000000102', v_second);
  SELECT * INTO v_row FROM public.venue_listings WHERE id = '33860000-0000-4000-8000-000000000102';
  IF v_result ->> 'withdrawn' <> 'true' OR v_row.details_change_status IS NOT NULL
     OR v_row.details_change_request_id IS NOT NULL OR v_row.venue_category <> 'restaurant' THEN
    RAISE EXCEPTION 'ISSUE-3386 R-4b FAIL: withdraw did not clear the request: % / %', v_result, to_jsonb(v_row);
  END IF;
  v_result := public.biz_withdraw_venue_details_change_request('33860000-0000-4000-8000-000000000102');
  IF v_result ->> 'withdrawn' <> 'false' THEN
    RAISE EXCEPTION 'ISSUE-3386 R-4c FAIL: second withdraw was not a no-op: %', v_result;
  END IF;

  -- Leave one pending rename + move for the P and A cases.
  PERFORM public.biz_submit_venue_details_change_request(
    '33860000-0000-4000-8000-000000000102',
    p_name => 'Live Lounge Rooftop',
    p_address => '20 Admiralty Way',
    p_city => 'Lagos',
    p_country_code => 'NG',
    p_lat => 6.4300,
    p_lng => 3.4200,
    p_coordinate_precision => 'approximate'
  );
END;
$r$;

-- R-5: a scanner cannot submit or withdraw.
SELECT pg_temp.issue3386_as('33860000-0000-4000-8000-000000000003');
DO $r5$
BEGIN
  PERFORM pg_temp.issue3386_expect_error(
    $q$SELECT public.biz_submit_venue_details_change_request('33860000-0000-4000-8000-000000000102', p_name => 'Scanner')$q$,
    'forbidden', 'R-5a');
  PERFORM pg_temp.issue3386_expect_error(
    $q$SELECT public.biz_withdraw_venue_details_change_request('33860000-0000-4000-8000-000000000102')$q$,
    'forbidden', 'R-5b');
END;
$r5$;

-- P-1: a guest (anon) still reads the LIVE name, address and pin, and cannot
-- read the table the request lives on.
RESET ROLE;
SET LOCAL ROLE anon;
DO $p1$
DECLARE
  v_view jsonb;
BEGIN
  SELECT to_jsonb(v) INTO v_view FROM public.venue_public_view v
  WHERE v.id = '33860000-0000-4000-8000-000000000102';
  IF v_view IS NULL THEN
    RAISE EXCEPTION 'ISSUE-3386 P-1 FAIL: the live venue vanished from the public view while a request is pending';
  END IF;
  IF v_view ->> 'name' <> 'Live Lounge' OR v_view ->> 'address' <> '2 Live Street'
     OR (v_view ->> 'lat')::double precision <> 6.50 OR (v_view ->> 'lng')::double precision <> 3.35 THEN
    RAISE EXCEPTION 'ISSUE-3386 P-1 FAIL: guests see pending values: %', v_view;
  END IF;
  IF v_view::text LIKE '%Rooftop%' OR v_view::text LIKE '%Admiralty%' THEN
    RAISE EXCEPTION 'ISSUE-3386 P-1b FAIL: a pending value leaked into the public row: %', v_view;
  END IF;
  BEGIN
    PERFORM 1 FROM public.venue_listings WHERE id = '33860000-0000-4000-8000-000000000102';
    RAISE EXCEPTION 'ISSUE-3386 P-2 FAIL: anon read venue_listings';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END;
$p1$;
RESET ROLE;

-- P-3: a signed-in stranger (not a brand member) sees the request neither on
-- the table nor on the public view.
SET LOCAL ROLE authenticated;
SELECT pg_temp.issue3386_as('33860000-0000-4000-8000-000000000004');
DO $p3$
BEGIN
  IF EXISTS (SELECT 1 FROM public.venue_listings WHERE id = '33860000-0000-4000-8000-000000000102') THEN
    RAISE EXCEPTION 'ISSUE-3386 P-3 FAIL: a non-member can read the venue row and its pending request';
  END IF;
  IF (SELECT name FROM public.venue_public_view WHERE id = '33860000-0000-4000-8000-000000000102')
     IS DISTINCT FROM 'Live Lounge' THEN
    RAISE EXCEPTION 'ISSUE-3386 P-3b FAIL: a signed-in guest sees pending values';
  END IF;
END;
$p3$;

-- ── A: admin decision ───────────────────────────────────────────────────────
-- A-1: a brand manager is not an admin.
SELECT pg_temp.issue3386_as('33860000-0000-4000-8000-000000000002');
DO $a1$
BEGIN
  PERFORM pg_temp.issue3386_expect_error(
    format('SELECT public.admin_review_venue_details_change(%L, %L, %L)',
      '33860000-0000-4000-8000-000000000102',
      (SELECT details_change_request_id FROM public.venue_listings WHERE id = '33860000-0000-4000-8000-000000000102'),
      'approve'),
    'forbidden', 'A-1');
END;
$a1$;

SELECT pg_temp.issue3386_as('33860000-0000-4000-8000-000000000005');
DO $a$
DECLARE
  v_request uuid;
  v_result jsonb;
  v_row public.venue_listings%ROWTYPE;
  v_audits integer;
BEGIN
  SELECT details_change_request_id INTO v_request
  FROM public.venue_listings WHERE id = '33860000-0000-4000-8000-000000000102';

  -- A-2: a request id the admin is not looking at never applies.
  v_result := public.admin_review_venue_details_change(
    '33860000-0000-4000-8000-000000000102', gen_random_uuid(), 'approve');
  IF v_result ->> 'ok' <> 'false' OR v_result ->> 'code' <> 'request_not_current'
     OR (SELECT name FROM public.venue_listings WHERE id = '33860000-0000-4000-8000-000000000102') <> 'Live Lounge' THEN
    RAISE EXCEPTION 'ISSUE-3386 A-2 FAIL: a foreign request id was applied: %', v_result;
  END IF;

  -- A-3: a suspended venue cannot take the change.
  RESET ROLE;
  UPDATE public.venue_listings SET claim_status = 'suspended' WHERE id = '33860000-0000-4000-8000-000000000102';
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.issue3386_expect_error(
    format('SELECT public.admin_review_venue_details_change(%L, %L, %L)',
      '33860000-0000-4000-8000-000000000102', v_request, 'approve'),
    'venue_not_live', 'A-3');
  RESET ROLE;
  UPDATE public.venue_listings SET claim_status = 'verified' WHERE id = '33860000-0000-4000-8000-000000000102';
  SET LOCAL ROLE authenticated;

  -- A-4: approve applies name, address, pin and precision in one step, keeps
  -- the slug, and clears the request.
  v_result := public.admin_review_venue_details_change(
    '33860000-0000-4000-8000-000000000102', v_request, 'approve');
  SELECT * INTO v_row FROM public.venue_listings WHERE id = '33860000-0000-4000-8000-000000000102';
  IF v_result ->> 'decision' <> 'approved' OR v_result ->> 'venue_name' <> 'Live Lounge Rooftop'
     OR v_result ->> 'requested_by' <> '33860000-0000-4000-8000-000000000002'
     OR v_row.name <> 'Live Lounge Rooftop' OR v_row.address <> '20 Admiralty Way'
     OR v_row.lat <> 6.43 OR v_row.lng <> 3.42 OR v_row.coordinate_precision <> 'approximate'
     OR v_row.venue_category <> 'restaurant' OR v_row.slug <> 'livelounge'
     OR v_row.claim_status <> 'verified'
     OR v_row.details_change_status IS NOT NULL OR v_row.details_change_request_id IS NOT NULL
     OR v_row.details_change_name IS NOT NULL THEN
    RAISE EXCEPTION 'ISSUE-3386 A-4 FAIL: approval did not apply atomically: % / %', v_result, to_jsonb(v_row);
  END IF;

  -- A-5: the same approval twice never applies twice.
  v_result := public.admin_review_venue_details_change(
    '33860000-0000-4000-8000-000000000102', v_request, 'approve');
  IF v_result ->> 'code' <> 'request_not_current' THEN
    RAISE EXCEPTION 'ISSUE-3386 A-5 FAIL: repeat approval was not refused: %', v_result;
  END IF;

  -- A-6: guests see the new details only now.
  IF (SELECT name FROM public.venue_public_view WHERE id = '33860000-0000-4000-8000-000000000102')
     IS DISTINCT FROM 'Live Lounge Rooftop' THEN
    RAISE EXCEPTION 'ISSUE-3386 A-6 FAIL: approved name did not reach the public view';
  END IF;

  RESET ROLE;
  SELECT count(*) INTO v_audits FROM public.admin_audit_log
  WHERE action = 'venue_details_change.approve'
    AND target_id = '33860000-0000-4000-8000-000000000102'
    AND metadata ->> 'request_id' = v_request::text;
  IF v_audits <> 1 THEN
    RAISE EXCEPTION 'ISSUE-3386 A-7 FAIL: expected one approve audit row, found %', v_audits;
  END IF;
  -- A-8: the business-authored place follows the approved identity.
  IF (SELECT name FROM public.place_pool WHERE id = '33860000-0000-4000-8000-000000000022') <> 'Live Lounge Rooftop'
     OR (SELECT lat FROM public.place_pool WHERE id = '33860000-0000-4000-8000-000000000022') <> 6.43 THEN
    RAISE EXCEPTION 'ISSUE-3386 A-8 FAIL: business-authored place not updated on approval';
  END IF;
END;
$a$;

-- A-9..A-12: name-only request on the Google-seeded venue; reject, then approve
-- a later one. The stored pin survives a request that does not move the venue,
-- and the Google place is never rewritten.
SET LOCAL ROLE authenticated;
SELECT pg_temp.issue3386_as('33860000-0000-4000-8000-000000000002');
SELECT public.biz_submit_venue_details_change_request(
  '33860000-0000-4000-8000-000000000103', p_name => 'Google Bistro & Wine');

SELECT pg_temp.issue3386_as('33860000-0000-4000-8000-000000000005');
DO $a9$
DECLARE
  v_request uuid;
  v_result jsonb;
  v_row public.venue_listings%ROWTYPE;
BEGIN
  SELECT details_change_request_id INTO v_request
  FROM public.venue_listings WHERE id = '33860000-0000-4000-8000-000000000103';

  -- A-9: a rejection needs a reason.
  PERFORM pg_temp.issue3386_expect_error(
    format('SELECT public.admin_review_venue_details_change(%L, %L, %L, %L)',
      '33860000-0000-4000-8000-000000000103', v_request, 'reject', '  '),
    'rejection_reason_required', 'A-9');

  -- A-10: reject keeps the live row and the proposal, with the reason.
  v_result := public.admin_review_venue_details_change(
    '33860000-0000-4000-8000-000000000103', v_request, 'reject', 'The sign on the door still says Google Bistro.');
  SELECT * INTO v_row FROM public.venue_listings WHERE id = '33860000-0000-4000-8000-000000000103';
  IF v_result ->> 'decision' <> 'rejected'
     OR v_row.name <> 'Google Bistro'
     OR v_row.details_change_status <> 'rejected'
     OR v_row.details_change_name <> 'Google Bistro & Wine'
     OR v_row.details_change_rejection_reason <> 'The sign on the door still says Google Bistro.'
     OR v_row.details_change_reviewed_by IS DISTINCT FROM '33860000-0000-4000-8000-000000000005'::uuid THEN
    RAISE EXCEPTION 'ISSUE-3386 A-10 FAIL: rejection not recorded: % / %', v_result, to_jsonb(v_row);
  END IF;

  -- A-11: reject again is a no-op; approving a rejected request is refused.
  v_result := public.admin_review_venue_details_change(
    '33860000-0000-4000-8000-000000000103', v_request, 'reject', 'again');
  IF v_result ->> 'noop' <> 'true' THEN
    RAISE EXCEPTION 'ISSUE-3386 A-11a FAIL: repeat reject was not a no-op: %', v_result;
  END IF;
  v_result := public.admin_review_venue_details_change(
    '33860000-0000-4000-8000-000000000103', v_request, 'approve');
  IF v_result ->> 'code' <> 'request_not_pending'
     OR (SELECT name FROM public.venue_listings WHERE id = '33860000-0000-4000-8000-000000000103') <> 'Google Bistro' THEN
    RAISE EXCEPTION 'ISSUE-3386 A-11b FAIL: a rejected request was approved: %', v_result;
  END IF;
END;
$a9$;

-- The host dismisses the rejection and sends a new name-only request.
SELECT pg_temp.issue3386_as('33860000-0000-4000-8000-000000000002');
DO $a12host$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.biz_withdraw_venue_details_change_request('33860000-0000-4000-8000-000000000103');
  IF v_result ->> 'previous_status' <> 'rejected'
     OR (SELECT details_change_status FROM public.venue_listings WHERE id = '33860000-0000-4000-8000-000000000103') IS NOT NULL THEN
    RAISE EXCEPTION 'ISSUE-3386 A-12a FAIL: dismissing a rejection did not clear it: %', v_result;
  END IF;
  PERFORM public.biz_submit_venue_details_change_request(
    '33860000-0000-4000-8000-000000000103', p_name => 'Bistro on Fifth');
END;
$a12host$;

SELECT pg_temp.issue3386_as('33860000-0000-4000-8000-000000000005');
DO $a12$
DECLARE
  v_result jsonb;
  v_row public.venue_listings%ROWTYPE;
BEGIN
  v_result := public.admin_review_venue_details_change(
    '33860000-0000-4000-8000-000000000103',
    (SELECT details_change_request_id FROM public.venue_listings WHERE id = '33860000-0000-4000-8000-000000000103'),
    'approve');
  SELECT * INTO v_row FROM public.venue_listings WHERE id = '33860000-0000-4000-8000-000000000103';
  IF v_result ->> 'decision' <> 'approved' OR v_row.name <> 'Bistro on Fifth'
     OR v_row.address <> '3 Google Way' OR v_row.lat <> 40.71 OR v_row.lng <> -74.00
     OR v_row.coordinate_precision <> 'exact' OR v_row.city <> 'New York' OR v_row.country_code <> 'US' THEN
    RAISE EXCEPTION 'ISSUE-3386 A-12b FAIL: a name-only approval moved the pin: % / %', v_result, to_jsonb(v_row);
  END IF;
END;
$a12$;

RESET ROLE;
DO $a13$
BEGIN
  IF (SELECT name FROM public.place_pool WHERE id = '33860000-0000-4000-8000-000000000023') <> 'Google Bistro' THEN
    RAISE EXCEPTION 'ISSUE-3386 A-13 FAIL: a Google-seeded place was rewritten by a host change';
  END IF;
  IF (SELECT count(*) FROM public.admin_audit_log
      WHERE action = 'venue_details_change.reject'
        AND target_id = '33860000-0000-4000-8000-000000000103') <> 1 THEN
    RAISE EXCEPTION 'ISSUE-3386 A-14 FAIL: expected exactly one reject audit row';
  END IF;
END;
$a13$;

-- A-15: the CHECKs refuse a half request even from a privileged writer.
DO $a15$
BEGIN
  BEGIN
    UPDATE public.venue_listings
    SET details_change_status = 'pending',
        details_change_request_id = gen_random_uuid(),
        details_change_requested_by = '33860000-0000-4000-8000-000000000002',
        details_change_requested_at = now(),
        details_change_address = '1 No Pin Road'
    WHERE id = '33860000-0000-4000-8000-000000000104';
    RAISE EXCEPTION 'ISSUE-3386 A-15 FAIL: an address without its pin was stored';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END;
$a15$;

SELECT 'ISSUE-3386 venue details host edit: all cases passed' AS result;

ROLLBACK;
