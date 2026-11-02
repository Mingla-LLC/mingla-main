\set ON_ERROR_STOP on

-- Issue #4226 — host contacts in Mingla Admin. Run after the full migration
-- chain on PostgreSQL 17.
--
--   H-01  The directory keeps its admin guard and grants after the RETURNS
--         TABLE change (definer + guard; anon cannot run it; the helper is not
--         callable by signed-in users) and has the new columns.
--   H-02  A host contact with no account and no ticket appears once, as
--         "host contact, no app": name from the contact book, host city from
--         the brand, country from the contact's phone (phone_country_iso
--         first), the brand that added them, marketing consent 'yes' with
--         basis host_import_attestation and the batch's attestation version
--         as evidence; listed on the People "Host contacts, no app" tab.
--   H-03  Without a phone, country is the brand's country_code.
--   H-04  A manual add is a host contact with basis host_manual_add.
--   H-05  A host contact whose email belongs to an account (other case and
--         spacing) folds into the account row: one row, app status kept,
--         is_host_contact, the brands that added them.
--   H-06  A host contact who is also a no-account ticket buyer folds into the
--         ticket row; the person's own checkout "no" beats the attestation.
--   H-07  Left out of marketing: suppressed by the brand that added them
--         (brand_person_channel_suppressions), unsubscribed Mingla-wide
--         (marketing_unsubscribes). A lifted brand suppression does not block.
--   H-08  Not a host contact at all: a retired contact method, an inactive
--         source, a detached source link, a merged-away brand person.
--   H-09  A test-style contact email is staff/test (segment internal), never
--         on the host-contact tab.
--   H-10  Everyone is the whole list: every group (explorer, host, both,
--         didn't finish sign-up, ticket buyer no app, host contact no app) is
--         in it; after consent, suppression and staff/test, exactly the
--         emailable fixtures remain.
--   H-11  Counts: host_contact_no_app and host_contacts move by exactly the
--         fixtures; 'people' (accounts) does not.
--   H-12  Data room: host contacts, no app, and host contacts who later got
--         an app move by exactly the fixtures.
-- MINGLA-INVARIANT: I-4226-HOST-CONTACTS-ONE-LIST | issue #4226 | Host contacts (brand contact-book emails from an import or manual add) join the one admin People list by normalised email; they are emailable with consent basis host_import_attestation / host_manual_add unless unsubscribed, suppressed Mingla-wide or by a brand that added them, or staff/test.

CREATE OR REPLACE FUNCTION pg_temp.t4226h_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #4226 host contacts FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$a$;

-- One host contact: a brand person, a source link, an email contact method
-- and its source. Returns the brand person id.
CREATE OR REPLACE FUNCTION pg_temp.t4226h_contact(
  p_brand uuid, p_name text, p_email text, p_kind text, p_source_id uuid,
  p_added_at timestamptz, p_phone text DEFAULT NULL, p_phone_iso text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE
  v_person uuid;
  v_link   uuid;
  v_cm     uuid;
BEGIN
  INSERT INTO public.brand_people(brand_id, display_name) VALUES (p_brand, p_name) RETURNING id INTO v_person;
  INSERT INTO public.brand_person_source_links(brand_id, brand_person_id, source_kind, source_id, link_method, source_occurred_at)
  VALUES (p_brand, v_person, p_kind, p_source_id,
          CASE WHEN p_kind = 'manual' THEN 'manual_resolution' ELSE 'normalized_address' END, p_added_at)
  RETURNING id INTO v_link;
  INSERT INTO public.brand_person_contact_methods(brand_id, brand_person_id, channel, normalized_value, provenance_scope, is_exportable, is_primary)
  VALUES (p_brand, v_person, 'email', p_email, 'brand_owned', true, true) RETURNING id INTO v_cm;
  INSERT INTO public.brand_person_contact_method_sources(contact_method_id, source_link_id, provenance_kind, exportable)
  VALUES (v_cm, v_link, p_kind, true);
  IF p_phone IS NOT NULL THEN
    INSERT INTO public.brand_person_contact_methods(brand_id, brand_person_id, channel, normalized_value, provenance_scope, is_exportable, is_primary)
    VALUES (p_brand, v_person, 'phone', p_phone, 'brand_owned', true, true) RETURNING id INTO v_cm;
    INSERT INTO public.brand_person_contact_method_sources(contact_method_id, source_link_id, provenance_kind, exportable, phone_country_iso)
    VALUES (v_cm, v_link, p_kind, true, p_phone_iso);
  END IF;
  RETURN v_person;
END
$f$;

BEGIN;
DO $h01$
DECLARE
  v_fn text := 'public.admin_people_directory()';
  v_col text;
BEGIN
  PERFORM pg_temp.t4226h_assert(to_regprocedure(v_fn) IS NOT NULL, 'H-01 exists ' || v_fn);
  PERFORM pg_temp.t4226h_assert(NOT has_function_privilege('anon', v_fn, 'EXECUTE'), 'H-01 anon cannot run ' || v_fn);
  PERFORM pg_temp.t4226h_assert(has_function_privilege('authenticated', v_fn, 'EXECUTE'), 'H-01 signed-in may call ' || v_fn);
  PERFORM pg_temp.t4226h_assert(has_function_privilege('service_role', v_fn, 'EXECUTE'), 'H-01 service role may call ' || v_fn);
  PERFORM pg_temp.t4226h_assert(
    (SELECT p.prosecdef AND p.prosrc ~ 'is_admin_user\(\)' AND p.prosrc ~ 'service_role'
       FROM pg_proc p WHERE p.oid = v_fn::regprocedure),
    'H-01 definer + admin guard kept ' || v_fn);
  PERFORM pg_temp.t4226h_assert(NOT has_function_privilege('authenticated', 'public.admin_people_directory_rows()', 'EXECUTE'),
    'H-01 the helper is still not callable by signed-in users');
  PERFORM pg_temp.t4226h_assert(
    (SELECT l.lanname FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
      WHERE p.oid = 'public.admin_people_directory_rows()'::regprocedure) = 'plpgsql',
    'H-01 the list stays plpgsql (pre-#1931 replay lane)');
  FOREACH v_col IN ARRAY ARRAY['is_host_contact', 'host_brand_ids', 'host_brands', 'host_city',
                               'host_contact_added_at', 'consent_basis'] LOOP
    PERFORM pg_temp.t4226h_assert(
      v_col = ANY ((SELECT p.proargnames FROM pg_proc p WHERE p.oid = v_fn::regprocedure)::text[]),
      'H-01 the directory returns ' || v_col);
  END LOOP;
END
$h01$;
ROLLBACK;

BEGIN;
DO $h02$
DECLARE
  v_admin      constant uuid := '42261000-0000-4000-a000-000000000001';
  v_outsider   constant uuid := '42261000-0000-4000-a000-000000000002';
  v_acct       constant uuid := '42261000-0000-4000-a000-000000000010';
  v_idle       constant uuid := '42261000-0000-4000-a000-000000000011';
  v_owner      constant uuid := '42261000-0000-4000-a000-000000000012';
  v_brand      constant uuid := '42261000-0000-4000-a000-000000000100';
  v_brand_gh   constant uuid := '42261000-0000-4000-a000-000000000101';
  v_event      constant uuid := '42261000-0000-4000-a000-000000000200';
  v_type       constant uuid := '42261000-0000-4000-a000-000000000300';
  v_o_buyer    constant uuid := '42261000-0000-4000-a000-000000000400';
  v_batch      constant uuid := '42261000-0000-4000-a000-000000000500';
  v_irow       constant uuid := '42261000-0000-4000-a000-000000000501';
  v_p_supp     uuid;
  v_p_lifted   uuid;
  v_p_retired  uuid;
  v_p_inactive uuid;
  v_p_detached uuid;
  v_p_merged   uuid;
  v_p_winner   uuid;
  v_seg_before jsonb;
  v_seg_after  jsonb;
  v_dr_before  jsonb;
  v_dr_after   jsonb;
  v_row        record;
  v_list       jsonb;
  v_n          bigint;
BEGIN
  INSERT INTO auth.users(id, email) VALUES
    (v_admin,    't4226h-admin@mingla-fixture.org'),
    (v_outsider, 't4226h-outsider@mingla-fixture.org'),
    (v_acct,     't4226h-acct@mingla-fixture.org'),
    (v_idle,     't4226h-idle@mingla-fixture.org'),
    (v_owner,    't4226h-owner@mingla-fixture.org');
  INSERT INTO public.admin_users(email, role, status) VALUES ('t4226h-admin@mingla-fixture.org', 'admin', 'active');

  v_dr_before := public.analytics_dr_users();
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  v_seg_before := public.admin_people_segments();
  RESET ROLE;

  INSERT INTO public.profiles(id, email, display_name, has_completed_onboarding, is_seed, country, created_at) VALUES
    (v_admin,    't4226h-admin@mingla-fixture.org',    'T Admin',    true,  true,  NULL, now()),
    (v_outsider, 't4226h-outsider@mingla-fixture.org', 'T Outsider', true,  true,  NULL, now()),
    -- An Explorer who signed up after a host imported them.
    (v_acct,     't4226h-acct@mingla-fixture.org',     'T Account',  true,  false, NULL, now() - interval '1 day'),
    -- Signed in, never onboarded, no ticket, not a host contact.
    (v_idle,     't4226h-idle@mingla-fixture.org',     'T Idle',     false, false, NULL, now() - interval '1 day'),
    (v_owner,    't4226h-owner@mingla-fixture.org',    'T Owner',    false, true,  NULL, now());
  INSERT INTO public.creator_accounts(id, email) VALUES (v_owner, 't4226h-owner@mingla-fixture.org');
  INSERT INTO public.brands(id, account_id, name, slug, default_currency, city, country_code) VALUES
    (v_brand,    v_owner, 'T4226H Lantern', 't4226h-lantern-' || v_brand,    'NGN', 'Lagos', NULL),
    (v_brand_gh, v_owner, 'T4226H Accra',   't4226h-accra-' || v_brand_gh,   'GHS', 'Accra', 'GH');
  INSERT INTO public.events(id, brand_id, title, slug, status, currency, created_by, city) VALUES
    (v_event, v_brand, 'T4226H Night', 't4226h-night-' || v_event, 'draft', 'NGN', v_owner, 'Ibadan');
  INSERT INTO public.ticket_types(id, event_id, name) VALUES (v_type, v_event, 'T4226H General');

  -- A ticket buyer with no account who declined marketing at checkout.
  INSERT INTO public.orders(id, event_id, buyer_email, buyer_name, buyer_phone_e164, total_cents, buyer_total_cents,
      net_subtotal_cents, currency, payment_status, payment_method, source, created_at, confirmed_at,
      list_subtotal_cents, discount_cents, buyer_fees_cents, tax_cents, pricing_source, metadata, buyer_user_id)
  VALUES
    (v_o_buyer, v_event, 't4226h-buyer@mingla-fixture.org', 'Bola Buyer', '+2348030000101', 0, 0, 0,
      NULL, 'paid', 'online_card', 'legacy', now() - interval '5 days', now() - interval '5 days',
      0, 0, 0, 0, 'computed_at_checkout', '{"marketing_opt_in": false}', NULL);
  INSERT INTO public.tickets(order_id, ticket_type_id, event_id, qr_code, status) VALUES
    (v_o_buyer, v_type, v_event, 't4226h-qr-1', 'valid');

  -- The attested import batch behind the first contact.
  INSERT INTO public.brand_contact_import_batches(id, brand_id, actor_user_id, state, file_sha256, file_name,
      file_size_bytes, row_count, original_headers, detected_provider, dialect, inspection_token_hash,
      inspection_expires_at, attestation_version, attestation_text, attested_brand_name, attested_by_user_id,
      attested_at, added_count)
  VALUES (v_batch, v_brand, v_owner, 'completed', repeat('a', 64), 'guests.csv', 100, 1, '["email"]'::jsonb,
      'generic', 'comma', repeat('b', 64), now() + interval '1 day', 'contact-import-attestation-v1',
      'These people gave T4226H Lantern permission to contact them.', 'T4226H Lantern', v_owner, now(), 1);
  INSERT INTO public.brand_contact_import_rows(id, batch_id, row_number, row_fingerprint, email, outcome)
  VALUES (v_irow, v_batch, 2, repeat('c', 64), 't4226h-only@mingla-fixture.org', 'added');

  -- H-02: imported, phone +234 but the source says KE; brand city Lagos.
  PERFORM pg_temp.t4226h_contact(v_brand, 'Ada Imported', 't4226h-only@mingla-fixture.org', 'import', v_irow,
    now() - interval '40 days', '+2348030000201', 'KE');
  -- H-03: imported, no phone; brand in Accra, GH.
  PERFORM pg_temp.t4226h_contact(v_brand_gh, 'Kofi NoPhone', 't4226h-nophone@mingla-fixture.org', 'import',
    gen_random_uuid(), now() - interval '20 days');
  -- H-04: added by hand.
  PERFORM pg_temp.t4226h_contact(v_brand, 'Mo Manual', 't4226h-manual@mingla-fixture.org', 'manual',
    gen_random_uuid(), now() - interval '10 days', '+447700900301');
  -- H-05: the Explorer's email, in other case and spacing, imported by two brands.
  PERFORM pg_temp.t4226h_contact(v_brand, 'Acct Person', '  T4226H-Acct@Mingla-Fixture.org ', 'import',
    gen_random_uuid(), now() - interval '30 days');
  PERFORM pg_temp.t4226h_contact(v_brand_gh, 'Acct Person', 't4226h-acct@mingla-fixture.org', 'manual',
    gen_random_uuid(), now() - interval '3 days');
  -- H-06: the no-account ticket buyer, imported.
  PERFORM pg_temp.t4226h_contact(v_brand, 'Bola Imported', 't4226h-buyer@mingla-fixture.org', 'import',
    gen_random_uuid(), now() - interval '30 days');
  -- H-07: suppressed by the brand; a lifted suppression; unsubscribed Mingla-wide.
  v_p_supp := pg_temp.t4226h_contact(v_brand, 'Sam Suppressed', 't4226h-brandsupp@mingla-fixture.org', 'import',
    gen_random_uuid(), now() - interval '30 days');
  INSERT INTO public.brand_person_channel_suppressions(brand_id, brand_person_id, channel, scope, reason, origin_table)
  VALUES (v_brand, v_p_supp, 'email', 'marketing', 'host_unsubscribe', 't4226h_fixture');
  v_p_lifted := pg_temp.t4226h_contact(v_brand, 'Lee Lifted', 't4226h-lifted@mingla-fixture.org', 'import',
    gen_random_uuid(), now() - interval '30 days');
  INSERT INTO public.brand_person_channel_suppressions(brand_id, brand_person_id, channel, scope, reason, origin_table, lifted_at)
  VALUES (v_brand, v_p_lifted, 'email', 'marketing', 'host_unsubscribe', 't4226h_fixture', now());
  PERFORM pg_temp.t4226h_contact(v_brand, 'Uma Unsub', 't4226h-unsub@mingla-fixture.org', 'import',
    gen_random_uuid(), now() - interval '30 days');
  INSERT INTO public.marketing_unsubscribes(contact_email, channel, scope, reason)
  VALUES ('t4226h-unsub@mingla-fixture.org', 'email', 'global', 'one_click_unsubscribe_link');
  -- H-08: not host contacts.
  v_p_retired := pg_temp.t4226h_contact(v_brand, 'Rita Retired', 't4226h-retired@mingla-fixture.org', 'import',
    gen_random_uuid(), now() - interval '30 days');
  UPDATE public.brand_person_contact_methods SET record_state = 'retired', retired_at = now()
   WHERE brand_person_id = v_p_retired;
  v_p_inactive := pg_temp.t4226h_contact(v_brand, 'Ian Inactive', 't4226h-inactive@mingla-fixture.org', 'import',
    gen_random_uuid(), now() - interval '30 days');
  UPDATE public.brand_person_contact_method_sources s SET active = false, retired_at = now()
    FROM public.brand_person_contact_methods cm
   WHERE cm.id = s.contact_method_id AND cm.brand_person_id = v_p_inactive;
  v_p_detached := pg_temp.t4226h_contact(v_brand, 'Dee Detached', 't4226h-detached@mingla-fixture.org', 'import',
    gen_random_uuid(), now() - interval '30 days');
  UPDATE public.brand_person_source_links SET detached_at = now() WHERE brand_person_id = v_p_detached;
  v_p_merged := pg_temp.t4226h_contact(v_brand, 'Mia Merged', 't4226h-merged@mingla-fixture.org', 'import',
    gen_random_uuid(), now() - interval '30 days');
  INSERT INTO public.brand_people(brand_id, display_name) VALUES (v_brand, 'Mia Winner') RETURNING id INTO v_p_winner;
  UPDATE public.brand_people SET record_status = 'merged', merged_into_person_id = v_p_winner WHERE id = v_p_merged;
  -- H-09: a test-style contact email.
  PERFORM pg_temp.t4226h_contact(v_brand, 'Test Contact', 'test.contact@mingla-fixture.org', 'import',
    gen_random_uuid(), now() - interval '30 days');

  -- ── H-01 guard after the shape change ─────────────────────────────────────
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_outsider::text, true);
  BEGIN
    PERFORM count(*) FROM public.admin_people_directory();
    PERFORM pg_temp.t4226h_assert(false, 'H-01 directory refused for a signed-in non-admin');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.t4226h_assert(SQLERRM = 'not_authorized', 'H-01 directory refused for a signed-in non-admin');
  END;
  BEGIN
    PERFORM public.admin_list_people('host_contact_no_app');
    PERFORM pg_temp.t4226h_assert(false, 'H-01 host-contact list refused for a signed-in non-admin');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.t4226h_assert(SQLERRM = 'not_authorized', 'H-01 host-contact list refused for a signed-in non-admin');
  END;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  SELECT count(*) INTO v_n FROM public.admin_people_directory() d WHERE d.email = 't4226h-only@mingla-fixture.org';
  PERFORM pg_temp.t4226h_assert(v_n = 1, 'H-01 an admin reads host contacts through the directory');
  RESET ROLE;

  -- ── H-02 a host contact with no account and no ticket ─────────────────────
  SELECT count(*) INTO v_n FROM public.admin_people_directory_rows() d WHERE d.email = 't4226h-only@mingla-fixture.org';
  PERFORM pg_temp.t4226h_assert(v_n = 1, 'H-02 exactly one row');
  SELECT * INTO v_row FROM public.admin_people_directory_rows() d WHERE d.email = 't4226h-only@mingla-fixture.org';
  PERFORM pg_temp.t4226h_assert(v_row.user_id IS NULL AND v_row.segment = 'host_contact_no_app'
    AND v_row.app_status = 'host_contact_no_app' AND NOT v_row.is_internal, 'H-02 app status "host contact, no app"');
  PERFORM pg_temp.t4226h_assert(v_row.is_host_contact AND NOT v_row.is_ticket_holder AND NOT v_row.in_ticket_buyer_segment,
    'H-02 a host contact, not a ticket person');
  PERFORM pg_temp.t4226h_assert(v_row.name = 'Ada Imported', 'H-02 name from the contact book');
  PERFORM pg_temp.t4226h_assert(v_row.host_city = 'Lagos' AND v_row.last_event_city IS NULL,
    'H-02 host city from the brand, no event city');
  PERFORM pg_temp.t4226h_assert(v_row.country = 'KE', 'H-02 country from phone_country_iso before the calling code');
  PERFORM pg_temp.t4226h_assert(v_row.phone_e164 = '+2348030000201', 'H-02 phone from the contact book');
  PERFORM pg_temp.t4226h_assert(v_row.host_brand_ids = ARRAY[v_brand] AND v_row.brand_ids = '{}'::uuid[],
    'H-02 the brand that added them (not a brand bought from)');
  PERFORM pg_temp.t4226h_assert(v_row.marketing_consent = 'yes' AND v_row.consent_basis = 'host_import_attestation',
    'H-02 emailable on the host import attestation');
  PERFORM pg_temp.t4226h_assert(
    v_row.host_brands -> 0 ->> 'attestation_version' = 'contact-import-attestation-v1'
      AND (v_row.host_brands -> 0 ->> 'import_batch_id')::uuid = v_batch
      AND v_row.host_brands -> 0 ->> 'source' = 'import'
      AND v_row.host_brands -> 0 ->> 'name' = 'T4226H Lantern',
    'H-02 the batch attestation version is kept as evidence');
  PERFORM pg_temp.t4226h_assert(v_row.host_contact_added_at < now() - interval '39 days', 'H-02 when a host added them');

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  v_list := public.admin_list_people('host_contact_no_app', 't4226h-', NULL, NULL, 100, 0, 'joined_desc');
  PERFORM pg_temp.t4226h_assert(
    EXISTS (SELECT 1 FROM jsonb_array_elements(v_list -> 'rows') r
             WHERE r ->> 'email' = 't4226h-only@mingla-fixture.org' AND r ->> 'id' IS NULL
               AND r ->> 'host_city' = 'Lagos' AND r ->> 'country' = 'KE'
               AND r ->> 'marketing_consent' = 'yes' AND r ->> 'consent_basis' = 'host_import_attestation'
               AND r -> 'host_brands' -> 0 ->> 'name' = 'T4226H Lantern' AND r ->> 'joined_at' IS NOT NULL),
    'H-02 listed on the People host-contact tab with its facts');
  -- Lantern: only, manual, brandsupp, lifted, unsub. Accra: nophone. Not the
  -- account, the ticket buyer, the excluded ones or the test email.
  PERFORM pg_temp.t4226h_assert((v_list ->> 'total')::int = 6, 'H-02 the tab lists exactly the six no-account, no-ticket contacts');
  v_list := public.admin_list_people('host_contact_no_app', 'Accra', NULL, NULL, 100, 0, NULL);
  PERFORM pg_temp.t4226h_assert(
    EXISTS (SELECT 1 FROM jsonb_array_elements(v_list -> 'rows') r WHERE r ->> 'email' = 't4226h-nophone@mingla-fixture.org'),
    'H-02 search matches the host city');
  v_list := public.admin_list_people('host_contact_no_app', 't4226h-', 'GH', NULL, 100, 0, NULL);
  PERFORM pg_temp.t4226h_assert((v_list ->> 'total')::int = 1, 'H-02 country filter');
  RESET ROLE;

  -- ── H-03 no phone: the brand's country ────────────────────────────────────
  SELECT * INTO v_row FROM public.admin_people_directory_rows() d WHERE d.email = 't4226h-nophone@mingla-fixture.org';
  PERFORM pg_temp.t4226h_assert(v_row.country = 'GH' AND v_row.host_city = 'Accra', 'H-03 country and city from the brand');

  -- ── H-04 manual add ───────────────────────────────────────────────────────
  SELECT * INTO v_row FROM public.admin_people_directory_rows() d WHERE d.email = 't4226h-manual@mingla-fixture.org';
  PERFORM pg_temp.t4226h_assert(v_row.segment = 'host_contact_no_app' AND v_row.marketing_consent = 'yes'
    AND v_row.consent_basis = 'host_manual_add', 'H-04 a manual add is emailable, basis host_manual_add');
  PERFORM pg_temp.t4226h_assert(v_row.country = 'GB', 'H-04 no phone_country_iso: country from the +44 calling code');

  -- ── H-05 folds into an account ────────────────────────────────────────────
  SELECT count(*) INTO v_n FROM public.admin_people_directory_rows() d WHERE d.email = 't4226h-acct@mingla-fixture.org';
  PERFORM pg_temp.t4226h_assert(v_n = 1, 'H-05 an account that a host imported is one row, not two');
  SELECT * INTO v_row FROM public.admin_people_directory_rows() d WHERE d.user_id = v_acct;
  PERFORM pg_temp.t4226h_assert(v_row.app_status = 'explorer' AND v_row.segment = 'explorer',
    'H-05 the account keeps its app status');
  PERFORM pg_temp.t4226h_assert(v_row.is_host_contact AND v_row.host_brand_ids @> ARRAY[v_brand, v_brand_gh]
    AND cardinality(v_row.host_brand_ids) = 2 AND jsonb_array_length(v_row.host_brands) = 2,
    'H-05 and is marked as a host contact of both brands');
  PERFORM pg_temp.t4226h_assert(v_row.consent_basis = 'host_import_attestation',
    'H-05 one import among the sources: basis is the attestation');
  PERFORM pg_temp.t4226h_assert(v_row.country = 'GH', 'H-05 no profile country or phone: the host country');
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM pg_temp.t4226h_assert(
    EXISTS (SELECT 1 FROM jsonb_array_elements(
              public.admin_list_people('explorer', 't4226h-acct', NULL, NULL, 10, 0, NULL) -> 'rows') r
             WHERE (r ->> 'id')::uuid = v_acct AND (r ->> 'is_host_contact')::boolean
               AND jsonb_array_length(r -> 'host_brands') = 2),
    'H-05 the Explorers tab shows the host-contact marker');
  RESET ROLE;

  -- ── H-06 folds into a ticket person ───────────────────────────────────────
  SELECT count(*) INTO v_n FROM public.admin_people_directory_rows() d WHERE d.email = 't4226h-buyer@mingla-fixture.org';
  PERFORM pg_temp.t4226h_assert(v_n = 1, 'H-06 a ticket buyer a host imported is one row');
  SELECT * INTO v_row FROM public.admin_people_directory_rows() d WHERE d.email = 't4226h-buyer@mingla-fixture.org';
  PERFORM pg_temp.t4226h_assert(v_row.segment = 'ticket_buyer_no_app' AND v_row.in_ticket_buyer_segment
    AND v_row.is_host_contact AND v_row.last_event_city = 'Ibadan' AND v_row.host_city = 'Lagos',
    'H-06 stays a ticket buyer (event city) and gains the host-contact flag (host city)');
  PERFORM pg_temp.t4226h_assert(v_row.name = 'Bola Buyer', 'H-06 the checkout name is kept');
  PERFORM pg_temp.t4226h_assert(v_row.marketing_consent = 'no' AND v_row.consent_basis IS NULL,
    'H-06 their own checkout "no" beats the host attestation');

  -- ── H-07 suppressed and unsubscribed ──────────────────────────────────────
  SELECT * INTO v_row FROM public.admin_people_directory_rows() d WHERE d.email = 't4226h-brandsupp@mingla-fixture.org';
  PERFORM pg_temp.t4226h_assert(v_row.marketing_consent = 'unsubscribed' AND v_row.consent_basis IS NULL,
    'H-07 suppressed by the brand that added them: left out');
  SELECT * INTO v_row FROM public.admin_people_directory_rows() d WHERE d.email = 't4226h-lifted@mingla-fixture.org';
  PERFORM pg_temp.t4226h_assert(v_row.marketing_consent = 'yes', 'H-07 a lifted brand suppression does not block');
  SELECT * INTO v_row FROM public.admin_people_directory_rows() d WHERE d.email = 't4226h-unsub@mingla-fixture.org';
  PERFORM pg_temp.t4226h_assert(v_row.marketing_consent = 'unsubscribed', 'H-07 unsubscribed Mingla-wide: left out');

  -- ── H-08 not host contacts ────────────────────────────────────────────────
  SELECT count(*) INTO v_n FROM public.admin_people_directory_rows() d
   WHERE d.email IN ('t4226h-retired@mingla-fixture.org', 't4226h-inactive@mingla-fixture.org',
                     't4226h-detached@mingla-fixture.org', 't4226h-merged@mingla-fixture.org');
  PERFORM pg_temp.t4226h_assert(v_n = 0,
    'H-08 a retired method, inactive source, detached link or merged-away contact is nobody');

  -- ── H-09 test email ───────────────────────────────────────────────────────
  SELECT * INTO v_row FROM public.admin_people_directory_rows() d WHERE d.email = 'test.contact@mingla-fixture.org';
  PERFORM pg_temp.t4226h_assert(v_row.is_internal AND v_row.segment = 'internal' AND v_row.is_host_contact,
    'H-09 a test-style contact email is staff/test');
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM pg_temp.t4226h_assert(
    (public.admin_list_people('host_contact_no_app', 'test.contact', NULL, NULL, 10, 0, NULL) ->> 'total')::int = 0,
    'H-09 and is not on the host-contact tab');
  RESET ROLE;

  -- ── H-10 Everyone ─────────────────────────────────────────────────────────
  PERFORM pg_temp.t4226h_assert(
    (SELECT array_agg(DISTINCT d.app_status ORDER BY d.app_status) FROM public.admin_people_directory_rows() d
      WHERE d.email LIKE 't4226h-%' AND NOT d.is_internal)
      = ARRAY['explorer', 'host_contact_no_app', 'incomplete', 'ticket_buyer_no_app'],
    'H-10 the list holds app users, didn''t-finish sign-ups, ticket buyers and host contacts');
  -- The emailable Everyone among the fixtures (accounts keep their rule:
  -- suppression only; no-account people need consent 'yes'): acct, idle,
  -- only, nophone, manual, lifted. Not the buyer (said no), brandsupp, unsub
  -- or the test email.
  SELECT count(*) INTO v_n FROM public.admin_people_directory_rows() d
   WHERE (d.email LIKE 't4226h-%' OR d.email LIKE 'test.contact@%') AND NOT d.is_internal
     AND d.marketing_consent <> 'unsubscribed'
     AND (d.user_id IS NOT NULL OR d.marketing_consent = 'yes');
  PERFORM pg_temp.t4226h_assert(v_n = 6, 'H-10 Everyone, after consent, suppression and staff/test, is the six emailable fixtures');

  -- ── H-11 counts ───────────────────────────────────────────────────────────
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  v_seg_after := public.admin_people_segments();
  RESET ROLE;
  PERFORM pg_temp.t4226h_assert(
    (v_seg_after ->> 'host_contact_no_app')::int - COALESCE((v_seg_before ->> 'host_contact_no_app')::int, 0) = 6,
    'H-11 the host-contact tab count moved by exactly the six fixtures');
  PERFORM pg_temp.t4226h_assert(
    (v_seg_after ->> 'host_contacts')::int - COALESCE((v_seg_before ->> 'host_contacts')::int, 0) = 8,
    'H-11 host contacts: the six plus the account and the ticket buyer (not the test email)');
  PERFORM pg_temp.t4226h_assert(
    (v_seg_after ->> 'people')::int - (v_seg_before ->> 'people')::int = 2,
    'H-11 "people" counts accounts only (acct, idle)');
  PERFORM pg_temp.t4226h_assert(v_seg_after -> 'countries' ? 'KE' AND v_seg_after -> 'countries' ? 'GH',
    'H-11 host-contact countries are offered as filters');

  -- ── H-12 Data room ────────────────────────────────────────────────────────
  v_dr_after := public.analytics_dr_users();
  PERFORM pg_temp.t4226h_assert(
    (v_dr_after #>> '{host_contacts,contacts}')::int - COALESCE((v_dr_before #>> '{host_contacts,contacts}')::int, 0) = 8,
    'H-12 host contacts');
  PERFORM pg_temp.t4226h_assert(
    (v_dr_after #>> '{host_contacts,no_app_no_ticket}')::int
      - COALESCE((v_dr_before #>> '{host_contacts,no_app_no_ticket}')::int, 0) = 6,
    'H-12 host contacts with no app and no ticket');
  PERFORM pg_temp.t4226h_assert(
    (v_dr_after #>> '{host_contacts,no_app}')::int - COALESCE((v_dr_before #>> '{host_contacts,no_app}')::int, 0) = 7,
    'H-12 host contacts with no app (the six plus the ticket buyer)');
  PERFORM pg_temp.t4226h_assert(
    (v_dr_after #>> '{host_contacts,converted}')::int - COALESCE((v_dr_before #>> '{host_contacts,converted}')::int, 0) = 1,
    'H-12 the Explorer a host added before they signed up later got an app');
  UPDATE public.profiles SET created_at = now() - interval '90 days' WHERE id = v_acct;
  v_dr_after := public.analytics_dr_users();
  PERFORM pg_temp.t4226h_assert(
    (v_dr_after #>> '{host_contacts,converted}')::int - COALESCE((v_dr_before #>> '{host_contacts,converted}')::int, 0) = 0,
    'H-12 an account older than the import is not a conversion');
END
$h02$;
ROLLBACK;
