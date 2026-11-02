\set ON_ERROR_STOP on

-- Issue #4238 wave 2 — customer-list and lookalike audiences. Run after the
-- full migration chain on PostgreSQL 17 as supabase_admin over 127.0.0.1.
--
--   T1  A brand's "past guests" holds that brand's buyers, ticket holders,
--       going RSVPs and plus-ones, normalised and SHA-256 hashed in SQL
--       (hash = encode(digest(lower(trim(email)),'sha256'),'hex')), de-duplicated
--       by member_key; "contacts" holds only its import/manual contacts not
--       linked to an account; neither holds another brand's people. A person
--       who is a guest of A and a contact of B is in A guests and B contacts
--       only. Staff/test accounts are included (Seth O-2).
--   T2  Exclusions: E1 ad opt-out latch, E2 deleted account, E3 merged person,
--       E4a unsubscribe, E5 under-18 (also as a guest checkout with the same
--       email). A hard bounce drops only the email hash. A new opt-out latch
--       marks the audiences dirty (trigger) and the next refresh sets
--       removed_at. Mingla-wide "everyone" applies the same exclusions and
--       includes app-only Explorer users (Seth O-1).
--   T3  No hash column can hold plaintext (CHECK violation 23514).
--   T4  RLS: a Host reads only its own brand's audience names and rounded
--       sizes through host_ad_audiences(), never members, never provider ids,
--       never another brand's; an outsider gets 42501; signed-in users cannot
--       select members at all; admins read definitions.
--   T5  Two concurrent refreshes: the second raises PT409, never 40001.
--   T6  The mark-dirty trigger never fails its host transaction.
--   T7  ad_campaign_daily_series is admin/service only.
--   T8  The refresh runs as a non-superuser (service_role) with pg-safeupdate
--       loaded, as every hosted PostgREST session does (authenticator
--       preloads safeupdate): a bare DELETE/UPDATE raises 21000 there.
--   T9  Host sizes: 0 people reads 0 ("No people yet"), 1-9 read 1 ("Fewer
--       than 10 people", never 10), and a lookalike has no size (its
--       member_count is the seed's, not its own).
--
-- MINGLA-INVARIANT: I-4238-AUDIENCE-HASH-ONLY | issue #4238 | Audience members are SHA-256 hex only and plaintext never leaves Postgres for audience work: identifiers are normalised and hashed inside ad_list_audience_refresh, every hash column carries a ^[0-9a-f]{64}$ CHECK, and members have no grant to any signed-in role.

CREATE OR REPLACE FUNCTION pg_temp.t4238_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #4238 audiences FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$a$;

CREATE OR REPLACE FUNCTION pg_temp.t4238_h(p text) RETURNS text
LANGUAGE sql IMMUTABLE AS $h$ SELECT encode(extensions.digest(lower(btrim(p)), 'sha256'), 'hex') $h$;

CREATE OR REPLACE FUNCTION pg_temp.t4238_as_service() RETURNS void LANGUAGE plpgsql AS $s$
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END $s$;

CREATE OR REPLACE FUNCTION pg_temp.t4238_as_user(p_user uuid) RETURNS void LANGUAGE plpgsql AS $s$
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
END $s$;

-- A brand contact (import or manual): person, link, email (and phone).
CREATE OR REPLACE FUNCTION pg_temp.t4238_contact(
  p_brand uuid, p_name text, p_email text, p_kind text,
  p_phone text DEFAULT NULL, p_linked uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE v_person uuid; v_link uuid; v_cm uuid;
BEGIN
  INSERT INTO public.brand_people(brand_id, display_name, linked_user_id) VALUES (p_brand, p_name, p_linked)
  RETURNING id INTO v_person;
  INSERT INTO public.brand_person_source_links(brand_id, brand_person_id, source_kind, source_id, link_method, source_occurred_at)
  VALUES (p_brand, v_person, p_kind, gen_random_uuid(),
          CASE WHEN p_kind = 'manual' THEN 'manual_resolution' ELSE 'normalized_address' END, now())
  RETURNING id INTO v_link;
  IF p_email IS NOT NULL THEN
    INSERT INTO public.brand_person_contact_methods(brand_id, brand_person_id, channel, normalized_value, provenance_scope, is_exportable, is_primary)
    VALUES (p_brand, v_person, 'email', p_email, 'brand_owned', true, true) RETURNING id INTO v_cm;
    INSERT INTO public.brand_person_contact_method_sources(contact_method_id, source_link_id, provenance_kind, exportable)
    VALUES (v_cm, v_link, p_kind, true);
  END IF;
  IF p_phone IS NOT NULL THEN
    INSERT INTO public.brand_person_contact_methods(brand_id, brand_person_id, channel, normalized_value, provenance_scope, is_exportable, is_primary)
    VALUES (p_brand, v_person, 'phone', p_phone, 'brand_owned', true, true) RETURNING id INTO v_cm;
    INSERT INTO public.brand_person_contact_method_sources(contact_method_id, source_link_id, provenance_kind, exportable)
    VALUES (v_cm, v_link, p_kind, true);
  END IF;
  RETURN v_person;
END
$f$;

CREATE OR REPLACE FUNCTION pg_temp.t4238_order(
  p_id uuid, p_event uuid, p_email text, p_phone text, p_user uuid DEFAULT NULL)
RETURNS void LANGUAGE sql AS $o$
  INSERT INTO public.orders(id, event_id, buyer_email, buyer_name, buyer_phone_e164, total_cents, buyer_total_cents,
      net_subtotal_cents, currency, payment_status, payment_method, source, created_at, confirmed_at,
      list_subtotal_cents, discount_cents, buyer_fees_cents, tax_cents, pricing_source, metadata, buyer_user_id)
  VALUES (p_id, p_event, p_email, 'T4238 Buyer', p_phone, 0, 0, 0, NULL, 'paid', 'online_card', 'legacy',
      now() - interval '3 days', now() - interval '3 days', 0, 0, 0, 0, 'computed_at_checkout', '{}', p_user);
$o$;

CREATE OR REPLACE FUNCTION pg_temp.t4238_member(p_key text, p_hash text) RETURNS boolean
LANGUAGE sql AS $m$
  SELECT EXISTS (
    SELECT 1 FROM public.ad_list_audience_members m JOIN public.ad_list_audiences a ON a.id = m.audience_id
    WHERE a.audience_key = p_key AND m.removed_at IS NULL
      AND (m.email_sha256 = p_hash OR m.phone_sha256 = p_hash))
$m$;

CREATE OR REPLACE FUNCTION pg_temp.t4238_count(p_key text) RETURNS integer
LANGUAGE sql AS $m$ SELECT member_count FROM public.ad_list_audiences WHERE audience_key = p_key $m$;

BEGIN;
DO $t$
DECLARE
  v_host_a   constant uuid := '42380000-0000-4000-a000-000000000001';
  v_host_b   constant uuid := '42380000-0000-4000-a000-000000000002';
  v_admin    constant uuid := '42380000-0000-4000-a000-000000000003';
  v_outsider constant uuid := '42380000-0000-4000-a000-000000000004';
  v_explorer constant uuid := '42380000-0000-4000-a000-000000000005';
  v_minor    constant uuid := '42380000-0000-4000-a000-000000000006';
  v_deleted  constant uuid := '42380000-0000-4000-a000-000000000007';
  v_staff    constant uuid := '42380000-0000-4000-a000-000000000008';
  v_linked   constant uuid := '42380000-0000-4000-a000-000000000009';
  v_brand_a  constant uuid := '42380000-0000-4000-a000-000000000101';
  v_brand_b  constant uuid := '42380000-0000-4000-a000-000000000102';
  v_event_a  constant uuid := '42380000-0000-4000-a000-000000000201';
  v_event_b  constant uuid := '42380000-0000-4000-a000-000000000202';
  v_type_a   constant uuid := '42380000-0000-4000-a000-000000000301';
  v_o1 constant uuid := '42380000-0000-4000-a000-000000000401';
  v_o2 constant uuid := '42380000-0000-4000-a000-000000000402';
  v_o3 constant uuid := '42380000-0000-4000-a000-000000000403';
  v_o4 constant uuid := '42380000-0000-4000-a000-000000000404';
  v_o5 constant uuid := '42380000-0000-4000-a000-000000000405';
  v_o6 constant uuid := '42380000-0000-4000-a000-000000000406';
  v_o7 constant uuid := '42380000-0000-4000-a000-000000000407';
  v_o8 constant uuid := '42380000-0000-4000-a000-000000000408';
  v_o9 constant uuid := '42380000-0000-4000-a000-000000000409';
  v_rsvp uuid;
  v_merged uuid;
  v_bounce uuid;
  v_winner uuid;
  v_aud uuid;
  v_n integer;
  v_r jsonb;
  v_ok boolean;
  v_row record;
BEGIN
  INSERT INTO auth.users(id, email) VALUES
    (v_host_a, 't4238-host-a@mingla-fixture.org'), (v_host_b, 't4238-host-b@mingla-fixture.org'),
    (v_admin, 't4238-admin@mingla-fixture.org'), (v_outsider, 't4238-outsider@mingla-fixture.org'),
    (v_explorer, 't4238-explorer@mingla-fixture.org'), (v_minor, 't4238-minor@mingla-fixture.org'),
    (v_deleted, 't4238-deleted@mingla-fixture.org'), (v_staff, 't4238-staff@usemingla.com'),
    (v_linked, 't4238-linked@mingla-fixture.org');
  INSERT INTO public.admin_users(email, role, status) VALUES ('t4238-admin@mingla-fixture.org', 'admin', 'active');
  INSERT INTO public.profiles(id, email, phone, display_name, has_completed_onboarding, is_seed, country, birthday, explorer_deleted_at) VALUES
    (v_host_a, 't4238-host-a@mingla-fixture.org', NULL, 'T Host A', true, false, 'NG', NULL, NULL),
    (v_host_b, 't4238-host-b@mingla-fixture.org', NULL, 'T Host B', true, false, 'NG', NULL, NULL),
    (v_admin, 't4238-admin@mingla-fixture.org', NULL, 'T Admin', true, true, NULL, NULL, NULL),
    (v_outsider, 't4238-outsider@mingla-fixture.org', NULL, 'T Outsider', true, false, NULL, NULL, NULL),
    -- An app-only Explorer user: no order, no brand contact (O-1: included).
    (v_explorer, 't4238-explorer@mingla-fixture.org', '+15550001111', 'T Explorer', true, false, 'US', DATE '1990-01-01', NULL),
    -- Seventeen today.
    (v_minor, 't4238-minor@mingla-fixture.org', NULL, 'T Minor', true, false, 'NG', (current_date - interval '17 years')::date, NULL),
    (v_deleted, 't4238-deleted@mingla-fixture.org', NULL, 'T Deleted', true, false, 'NG', NULL, now()),
    (v_staff, 't4238-staff@usemingla.com', NULL, 'T Staff', true, false, 'NG', NULL, NULL),
    (v_linked, 't4238-linked@mingla-fixture.org', NULL, 'T Linked', true, false, 'NG', NULL, NULL);

  INSERT INTO public.creator_accounts(id, email) VALUES
    (v_host_a, 't4238-host-a@mingla-fixture.org'), (v_host_b, 't4238-host-b@mingla-fixture.org');
  INSERT INTO public.brands(id, account_id, name, slug, default_currency, country_code) VALUES
    (v_brand_a, v_host_a, 'T4238 Brand A', 't4238-a-' || v_brand_a, 'NGN', 'NG'),
    (v_brand_b, v_host_b, 'T4238 Brand B', 't4238-b-' || v_brand_b, 'NGN', 'NG');
  INSERT INTO public.events(id, brand_id, title, slug, status, currency, created_by, city) VALUES
    (v_event_a, v_brand_a, 'T4238 Night A', 't4238-night-a-' || v_event_a, 'draft', 'NGN', v_host_a, 'Lagos'),
    (v_event_b, v_brand_b, 'T4238 Night B', 't4238-night-b-' || v_event_b, 'draft', 'NGN', v_host_b, 'Abuja');
  INSERT INTO public.ticket_types(id, event_id, name) VALUES (v_type_a, v_event_a, 'T4238 General');

  -- Brand A guests.
  PERFORM pg_temp.t4238_order(v_o1, v_event_a, 't4238-buyer1@mingla-fixture.org', '+2348030004238');
  PERFORM pg_temp.t4238_order(v_o2, v_event_a, '  T4238-Buyer2@Mingla-Fixture.org ', NULL);
  PERFORM pg_temp.t4238_order(v_o3, v_event_a, 't4238-optout@mingla-fixture.org', '+2348030004239');
  -- Guest checkout by the minor's own email (E5 applies to the person).
  PERFORM pg_temp.t4238_order(v_o4, v_event_a, 'T4238-minor@mingla-fixture.org', NULL);
  PERFORM pg_temp.t4238_order(v_o5, v_event_a, 't4238-deleted@mingla-fixture.org', NULL, v_deleted);
  PERFORM pg_temp.t4238_order(v_o6, v_event_a, 't4238-unsub@mingla-fixture.org', NULL);
  PERFORM pg_temp.t4238_order(v_o7, v_event_a, 't4238-shared@mingla-fixture.org', NULL);
  PERFORM pg_temp.t4238_order(v_o9, v_event_a, 't4238-staff@usemingla.com', NULL, v_staff);
  INSERT INTO public.tickets(order_id, ticket_type_id, event_id, qr_code, status, holder_email) VALUES
    (v_o1, v_type_a, v_event_a, 't4238-qr-1', 'valid', 't4238-holder@mingla-fixture.org'),
    (v_o1, v_type_a, v_event_a, 't4238-qr-2', 'void', 't4238-void@mingla-fixture.org');
  -- A local-format phone cannot be matched safely and is dropped, not guessed.
  INSERT INTO public.event_rsvps(event_id, guest_name, guest_email, guest_phone, rsvp_status, approval_status)
  VALUES (v_event_a, 'T RSVP', 't4238-rsvp@mingla-fixture.org', '08030004300', 'going', 'approved') RETURNING id INTO v_rsvp;
  INSERT INTO public.event_rsvp_guests(rsvp_id, name, email, phone)
  VALUES (v_rsvp, 'T Plus One', 't4238-plusone@mingla-fixture.org', '+2348030004301');
  INSERT INTO public.event_rsvps(event_id, guest_name, guest_email, guest_phone, rsvp_status, approval_status)
  VALUES (v_event_a, 'T Not Going', 't4238-notgoing@mingla-fixture.org', '+2348030004302', 'not_going', 'approved');
  -- Brand B guest.
  PERFORM pg_temp.t4238_order(v_o8, v_event_b, 't4238-buyer-b@mingla-fixture.org', '+2348030009999');

  -- E1: the opt-out latch on the optout buyer's checkout session.
  INSERT INTO public.ticket_checkout_sessions(event_id, brand_id, buyer_name, buyer_email, buyer_phone_e164,
      idempotency_key, expires_at, ad_tracking_opt_out)
  VALUES (v_event_a, v_brand_a, 'T OptOut', 't4238-optout@mingla-fixture.org', '+2348030004239',
      't4238-optout-1', now() + interval '1 hour', true);
  -- E4a: Mingla-wide unsubscribe.
  INSERT INTO public.marketing_unsubscribes(contact_email, channel, scope, reason)
  VALUES ('t4238-unsub@mingla-fixture.org', 'email', 'global', 'one_click');

  -- Brand A contacts.
  PERFORM pg_temp.t4238_contact(v_brand_a, 'T Contact 1', 't4238-contact1@mingla-fixture.org', 'import', '+2348030001001');
  PERFORM pg_temp.t4238_contact(v_brand_a, 'T Contact 2', 't4238-contact2@mingla-fixture.org', 'manual');
  v_bounce := pg_temp.t4238_contact(v_brand_a, 'T Bounce', 't4238-bounce@mingla-fixture.org', 'import', '+2348030001002');
  INSERT INTO public.brand_person_channel_suppressions(brand_id, brand_person_id, channel, scope, reason, origin_table)
  VALUES (v_brand_a, v_bounce, 'email', 'marketing', 'hard_bounce', 'test');
  -- E3: merged-away person.
  v_winner := pg_temp.t4238_contact(v_brand_a, 'T Winner', 't4238-winner@mingla-fixture.org', 'import');
  v_merged := pg_temp.t4238_contact(v_brand_a, 'T Merged', 't4238-merged@mingla-fixture.org', 'import');
  UPDATE public.brand_people SET record_status = 'merged', merged_into_person_id = v_winner WHERE id = v_merged;
  -- Linked to an account: not a "contact".
  PERFORM pg_temp.t4238_contact(v_brand_a, 'T Linked', 't4238-linked@mingla-fixture.org', 'import', NULL, v_linked);
  -- Brand B contacts, including A's shared guest.
  PERFORM pg_temp.t4238_contact(v_brand_b, 'T Contact B', 't4238-contact-b@mingla-fixture.org', 'import');
  PERFORM pg_temp.t4238_contact(v_brand_b, 'T Shared', 't4238-shared@mingla-fixture.org', 'import');

  PERFORM pg_temp.t4238_as_service();
  PERFORM public.ad_list_audience_ensure_brand(v_brand_a);
  PERFORM public.ad_list_audience_ensure_brand(v_brand_b);

  -- T1 ---------------------------------------------------------------------
  PERFORM pg_temp.t4238_assert(pg_temp.t4238_member('brand:' || v_brand_a || ':guests', pg_temp.t4238_h('t4238-buyer1@mingla-fixture.org')),
    'T1 A guests: a paid buyer, hash = sha256(lower(trim(email)))');
  PERFORM pg_temp.t4238_assert(pg_temp.t4238_member('brand:' || v_brand_a || ':guests', pg_temp.t4238_h('t4238-buyer2@mingla-fixture.org')),
    'T1 A guests: case and spacing normalised before hashing');
  PERFORM pg_temp.t4238_assert(pg_temp.t4238_member('brand:' || v_brand_a || ':guests', encode(extensions.digest('2348030004238','sha256'),'hex')),
    'T1 phone hash = sha256(digits with country code, no +)');
  PERFORM pg_temp.t4238_assert(pg_temp.t4238_member('brand:' || v_brand_a || ':guests', pg_temp.t4238_h('t4238-holder@mingla-fixture.org'))
    AND NOT pg_temp.t4238_member('brand:' || v_brand_a || ':guests', pg_temp.t4238_h('t4238-void@mingla-fixture.org')),
    'T1 A guests: a valid ticket holder in, a void ticket out');
  PERFORM pg_temp.t4238_assert(pg_temp.t4238_member('brand:' || v_brand_a || ':guests', pg_temp.t4238_h('t4238-rsvp@mingla-fixture.org'))
    AND pg_temp.t4238_member('brand:' || v_brand_a || ':guests', pg_temp.t4238_h('t4238-plusone@mingla-fixture.org'))
    AND NOT pg_temp.t4238_member('brand:' || v_brand_a || ':guests', pg_temp.t4238_h('t4238-notgoing@mingla-fixture.org')),
    'T1 A guests: going RSVP and plus-one in, not-going out');
  PERFORM pg_temp.t4238_assert(NOT EXISTS (SELECT 1 FROM public.ad_list_audience_members m JOIN public.ad_list_audiences a ON a.id = m.audience_id
      WHERE a.audience_key = 'brand:' || v_brand_a || ':guests' AND m.phone_sha256 IN (
        encode(extensions.digest('08030004300','sha256'),'hex'), encode(extensions.digest('8030004300','sha256'),'hex'))),
    'T1 a local-format phone is dropped, never guessed into a country');
  PERFORM pg_temp.t4238_assert(pg_temp.t4238_member('brand:' || v_brand_a || ':guests', pg_temp.t4238_h('t4238-staff@usemingla.com')),
    'T1 staff/test buyers are included (O-2)');
  -- buyer1, buyer2, holder, rsvp, plus-one, shared, staff.
  PERFORM pg_temp.t4238_assert(pg_temp.t4238_count('brand:' || v_brand_a || ':guests') = 7,
    'T1 A guests member_count = 7 (got ' || pg_temp.t4238_count('brand:' || v_brand_a || ':guests') || ')');
  PERFORM pg_temp.t4238_assert(NOT pg_temp.t4238_member('brand:' || v_brand_a || ':guests', pg_temp.t4238_h('t4238-buyer-b@mingla-fixture.org'))
    AND NOT pg_temp.t4238_member('brand:' || v_brand_a || ':contacts', pg_temp.t4238_h('t4238-contact-b@mingla-fixture.org'))
    AND NOT pg_temp.t4238_member('brand:' || v_brand_b || ':guests', pg_temp.t4238_h('t4238-buyer1@mingla-fixture.org')),
    'T1 brand A has none of brand B''s people, and B none of A''s');
  PERFORM pg_temp.t4238_assert(pg_temp.t4238_member('brand:' || v_brand_a || ':contacts', pg_temp.t4238_h('t4238-contact1@mingla-fixture.org'))
    AND pg_temp.t4238_member('brand:' || v_brand_a || ':contacts', pg_temp.t4238_h('t4238-contact2@mingla-fixture.org'))
    AND NOT pg_temp.t4238_member('brand:' || v_brand_a || ':contacts', pg_temp.t4238_h('t4238-linked@mingla-fixture.org'))
    AND NOT pg_temp.t4238_member('brand:' || v_brand_a || ':contacts', pg_temp.t4238_h('t4238-buyer1@mingla-fixture.org')),
    'T1 A contacts: import and manual contacts in; account-linked people and guests out');
  PERFORM pg_temp.t4238_assert(
    pg_temp.t4238_member('brand:' || v_brand_a || ':guests', pg_temp.t4238_h('t4238-shared@mingla-fixture.org'))
    AND pg_temp.t4238_member('brand:' || v_brand_b || ':contacts', pg_temp.t4238_h('t4238-shared@mingla-fixture.org'))
    AND NOT pg_temp.t4238_member('brand:' || v_brand_a || ':contacts', pg_temp.t4238_h('t4238-shared@mingla-fixture.org'))
    AND NOT pg_temp.t4238_member('brand:' || v_brand_b || ':guests', pg_temp.t4238_h('t4238-shared@mingla-fixture.org')),
    'T1 a guest of A who is a contact of B is in A guests and B contacts only');
  SELECT count(*) INTO v_n FROM public.ad_list_audience_members m JOIN public.ad_list_audiences a ON a.id = m.audience_id
  WHERE a.audience_key = 'brand:' || v_brand_a || ':guests' GROUP BY m.member_key HAVING count(*) > 1 LIMIT 1;
  PERFORM pg_temp.t4238_assert(v_n IS NULL, 'T1 members are de-duplicated by member_key');
  PERFORM pg_temp.t4238_assert(
    EXISTS (SELECT 1 FROM public.ad_list_audiences WHERE audience_key = 'brand:' || v_brand_a || ':lookalike:NG' AND kind = 'lookalike'
            AND member_count = (SELECT (member_count_by_country->>'NG')::integer FROM public.ad_list_audiences WHERE audience_key = 'brand:' || v_brand_a || ':seed')),
    'T1 ensure_brand adds the NG lookalike sized by the seed''s NG members');
  PERFORM pg_temp.t4238_assert(
    (SELECT host_visible FROM public.ad_list_audiences WHERE audience_key = 'brand:' || v_brand_a || ':seed') = false,
    'T1 the seed is hidden from Hosts');

  -- T2 ---------------------------------------------------------------------
  PERFORM pg_temp.t4238_assert(NOT pg_temp.t4238_member('brand:' || v_brand_a || ':guests', pg_temp.t4238_h('t4238-optout@mingla-fixture.org'))
    AND NOT pg_temp.t4238_member('brand:' || v_brand_a || ':guests', encode(extensions.digest('2348030004239','sha256'),'hex')),
    'T2 E1 an opted-out buyer is absent (email and phone)');
  PERFORM pg_temp.t4238_assert(NOT pg_temp.t4238_member('brand:' || v_brand_a || ':guests', pg_temp.t4238_h('t4238-deleted@mingla-fixture.org')),
    'T2 E2 a deleted account''s order is absent');
  PERFORM pg_temp.t4238_assert(NOT pg_temp.t4238_member('brand:' || v_brand_a || ':contacts', pg_temp.t4238_h('t4238-merged@mingla-fixture.org'))
    AND pg_temp.t4238_member('brand:' || v_brand_a || ':contacts', pg_temp.t4238_h('t4238-winner@mingla-fixture.org')),
    'T2 E3 a merged-away person is absent; the winner stays');
  PERFORM pg_temp.t4238_assert(NOT pg_temp.t4238_member('brand:' || v_brand_a || ':guests', pg_temp.t4238_h('t4238-unsub@mingla-fixture.org')),
    'T2 E4a an unsubscribed buyer is absent');
  PERFORM pg_temp.t4238_assert(NOT pg_temp.t4238_member('brand:' || v_brand_a || ':guests', pg_temp.t4238_h('t4238-minor@mingla-fixture.org')),
    'T2 E5 an under-18 account is absent even as a guest checkout with the same email');
  SELECT m.* INTO v_row FROM public.ad_list_audience_members m JOIN public.ad_list_audiences a ON a.id = m.audience_id
  WHERE a.audience_key = 'brand:' || v_brand_a || ':contacts' AND m.phone_sha256 = encode(extensions.digest('2348030001002','sha256'),'hex');
  PERFORM pg_temp.t4238_assert(v_row.member_key IS NOT NULL AND v_row.email_sha256 IS NULL AND v_row.removed_at IS NULL,
    'T2 E4b a hard bounce drops only the email hash; the phone stays');

  -- A new opt-out latch for an already-listed buyer: the trigger marks dirty,
  -- the next refresh sets removed_at.
  PERFORM pg_temp.t4238_assert((SELECT members_refreshed_at IS NOT NULL FROM public.ad_list_audiences WHERE audience_key = 'brand:' || v_brand_a || ':guests'),
    'T2 fixture: guests snapshot is fresh');
  INSERT INTO public.ticket_checkout_sessions(event_id, brand_id, buyer_name, buyer_email, buyer_phone_e164,
      idempotency_key, expires_at, ad_tracking_opt_out)
  VALUES (v_event_a, v_brand_a, 'T Buyer1', 't4238-buyer1@mingla-fixture.org', '+2348030004238',
      't4238-optout-2', now() + interval '1 hour', true);
  PERFORM pg_temp.t4238_assert(
    NOT EXISTS (SELECT 1 FROM public.ad_list_audiences WHERE status = 'active' AND members_refreshed_at IS NOT NULL
                AND audience_key LIKE 'brand:42380000-%'),
    'T2 the opt-out trigger marks every active audience dirty');
  SELECT id INTO v_aud FROM public.ad_list_audiences WHERE audience_key = 'brand:' || v_brand_a || ':guests';
  v_r := public.ad_list_audience_refresh(v_aud);
  PERFORM pg_temp.t4238_assert((v_r->>'removed')::integer >= 1
    AND EXISTS (SELECT 1 FROM public.ad_list_audience_members WHERE audience_id = v_aud
                AND email_sha256 = pg_temp.t4238_h('t4238-buyer1@mingla-fixture.org') AND removed_at IS NOT NULL),
    'T2 the next refresh sets removed_at on the newly opted-out buyer');
  v_r := public.ad_list_audience_refresh(v_aud);
  PERFORM pg_temp.t4238_assert(NOT pg_temp.t4238_member('brand:' || v_brand_a || ':guests', pg_temp.t4238_h('t4238-buyer1@mingla-fixture.org')),
    'T2 the opted-out buyer is never re-added by a later refresh');

  -- Mingla-wide: same exclusions; app-only Explorer users included (O-1).
  INSERT INTO public.ad_list_audiences(audience_key, owner_kind, kind, source, display_name)
  VALUES ('mingla:everyone:all', 'mingla', 'list', 'everyone', 'Everyone') RETURNING id INTO v_aud;
  PERFORM public.ad_list_audience_refresh(v_aud);
  PERFORM pg_temp.t4238_assert(pg_temp.t4238_member('mingla:everyone:all', pg_temp.t4238_h('t4238-explorer@mingla-fixture.org')),
    'T2 Mingla everyone includes an app-only Explorer user (O-1)');
  PERFORM pg_temp.t4238_assert(NOT pg_temp.t4238_member('mingla:everyone:all', pg_temp.t4238_h('t4238-optout@mingla-fixture.org'))
    AND NOT pg_temp.t4238_member('mingla:everyone:all', pg_temp.t4238_h('t4238-minor@mingla-fixture.org'))
    AND NOT pg_temp.t4238_member('mingla:everyone:all', pg_temp.t4238_h('t4238-unsub@mingla-fixture.org'))
    AND NOT pg_temp.t4238_member('mingla:everyone:all', pg_temp.t4238_h('t4238-buyer1@mingla-fixture.org')),
    'T2 Mingla everyone applies E1, E4a and E5');

  -- T3 ---------------------------------------------------------------------
  SELECT id INTO v_aud FROM public.ad_list_audiences WHERE audience_key = 'brand:' || v_brand_a || ':guests';
  v_ok := false;
  BEGIN
    INSERT INTO public.ad_list_audience_members(audience_id, member_key, email_sha256) VALUES (v_aud, pg_temp.t4238_h('x@y.z'), 'a@b.com');
  EXCEPTION WHEN check_violation THEN v_ok := true; END;
  PERFORM pg_temp.t4238_assert(v_ok, 'T3 email_sha256 refuses plaintext');
  v_ok := false;
  BEGIN
    INSERT INTO public.ad_list_audience_members(audience_id, member_key, phone_sha256) VALUES (v_aud, pg_temp.t4238_h('x@y.z'), '+2348030000000');
  EXCEPTION WHEN check_violation THEN v_ok := true; END;
  PERFORM pg_temp.t4238_assert(v_ok, 'T3 phone_sha256 refuses plaintext');
  v_ok := false;
  BEGIN
    INSERT INTO public.ad_list_audience_members(audience_id, member_key, email_sha256) VALUES (v_aud, 'a@b.com', pg_temp.t4238_h('a@b.com'));
  EXCEPTION WHEN check_violation THEN v_ok := true; END;
  PERFORM pg_temp.t4238_assert(v_ok, 'T3 member_key refuses plaintext');
  v_ok := false;
  BEGIN
    INSERT INTO public.ad_list_audience_members(audience_id, member_key, email_sha256, email_google_sha256) VALUES (v_aud, pg_temp.t4238_h('q@y.z'), pg_temp.t4238_h('q@y.z'), 'q@gmail.com');
  EXCEPTION WHEN check_violation THEN v_ok := true; END;
  PERFORM pg_temp.t4238_assert(v_ok, 'T3 email_google_sha256 refuses plaintext');
  v_ok := false;
  BEGIN
    INSERT INTO public.ad_list_audience_members(audience_id, member_key, phone_sha256, phone_e164_sha256) VALUES (v_aud, pg_temp.t4238_h('p'), pg_temp.t4238_h('p'), '+15550000000');
  EXCEPTION WHEN check_violation THEN v_ok := true; END;
  PERFORM pg_temp.t4238_assert(v_ok, 'T3 phone_e164_sha256 refuses plaintext');
  PERFORM pg_temp.t4238_assert(
    NOT has_table_privilege('authenticated', 'public.ad_list_audience_members', 'SELECT')
    AND NOT has_table_privilege('anon', 'public.ad_list_audience_members', 'SELECT')
    AND has_table_privilege('service_role', 'public.ad_list_audience_members', 'SELECT'),
    'SC-1 members: service_role only; no signed-in or anon grant');
  PERFORM pg_temp.t4238_assert(NOT EXISTS (
      SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ad_list_audience_members'
        AND data_type = 'text' AND column_name NOT IN ('member_key','email_sha256','email_google_sha256','phone_sha256','phone_e164_sha256','country')),
    'SC-1 members have no other text column that could hold plaintext');

  -- Give A's guests a Meta platform row with a provider id, to prove the Host
  -- read never returns provider ids.
  INSERT INTO public.ad_connections(platform, lane, display_name, external_account_id, auth_kind, token_env_var, status, connected)
  VALUES ('meta', 'consumer', 'T4238 Meta', 'act_4238', 'system_user_token', 'META_TOKEN_T4238', 'connected', true)
  ON CONFLICT DO NOTHING;
  INSERT INTO public.ad_list_audience_platforms(audience_id, platform, connection_id, provider_audience_id, state)
  SELECT v_aud, 'meta', c.id, '238400000000001', 'ready' FROM public.ad_connections c
  WHERE c.platform = 'meta' AND c.lane = 'consumer' LIMIT 1;
END
$t$;

-- T4: RLS and the Host read path ---------------------------------------------
DO $t4$
DECLARE
  v_host_a   constant uuid := '42380000-0000-4000-a000-000000000001';
  v_admin    constant uuid := '42380000-0000-4000-a000-000000000003';
  v_outsider constant uuid := '42380000-0000-4000-a000-000000000004';
  v_brand_a  constant uuid := '42380000-0000-4000-a000-000000000101';
  v_brand_b  constant uuid := '42380000-0000-4000-a000-000000000102';
  v_ok boolean;
  v_n integer;
  v_rows jsonb;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.t4238_as_user(v_outsider);
  v_ok := false;
  BEGIN PERFORM * FROM public.host_ad_audiences(v_brand_a);
  EXCEPTION WHEN insufficient_privilege THEN v_ok := true; END;
  PERFORM pg_temp.t4238_assert(v_ok, 'T4 a user without access to brand A gets 42501');

  PERFORM pg_temp.t4238_as_user(v_host_a);
  SELECT jsonb_agg(to_jsonb(h)) INTO v_rows FROM public.host_ad_audiences(v_brand_a) h;
  PERFORM pg_temp.t4238_assert(jsonb_array_length(v_rows) >= 3, 'T4 Host A reads its own audiences');
  PERFORM pg_temp.t4238_assert(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_rows) r WHERE r->>'audience_key' LIKE '%:seed'),
    'T4 the hidden seed is not returned');
  PERFORM pg_temp.t4238_assert(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_rows) r WHERE r->>'audience_key' NOT LIKE 'brand:' || v_brand_a || ':%'),
    'T4 only brand A''s keys');
  PERFORM pg_temp.t4238_assert(v_rows::text NOT LIKE '%238400000000001%' AND v_rows::text NOT LIKE '%provider_audience_id%',
    'T4 no provider audience id reaches the Host');
  PERFORM pg_temp.t4238_assert(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_rows) r
      WHERE (r->>'approx_size')::integer NOT IN (0, 1) AND (r->>'approx_size')::integer % 10 <> 0),
    'T4 sizes are rounded (1 stands for "fewer than 10")');
  PERFORM pg_temp.t4238_assert(EXISTS (SELECT 1 FROM jsonb_array_elements(v_rows) r, jsonb_array_elements(r->'platforms') p
      WHERE p->>'platform' = 'meta' AND p->>'state' = 'ready'),
    'T4 per-platform state is returned');
  v_ok := false;
  BEGIN PERFORM * FROM public.host_ad_audiences(v_brand_b);
  EXCEPTION WHEN insufficient_privilege THEN v_ok := true; END;
  PERFORM pg_temp.t4238_assert(v_ok, 'T4 Host A cannot read brand B''s audiences (42501)');
  SELECT count(*) INTO v_n FROM public.ad_list_audiences;
  PERFORM pg_temp.t4238_assert(v_n = 0, 'T4 a Host reads no definition rows directly (admin-only RLS)');
  v_ok := false;
  BEGIN PERFORM 1 FROM public.ad_list_audience_members LIMIT 1;
  EXCEPTION WHEN insufficient_privilege THEN v_ok := true; END;
  PERFORM pg_temp.t4238_assert(v_ok, 'T4 a Host cannot select members at all');
  v_ok := false;
  BEGIN PERFORM public.ad_list_audience_refresh('00000000-0000-4000-8000-000000000000');
  EXCEPTION WHEN insufficient_privilege THEN v_ok := true; END;
  PERFORM pg_temp.t4238_assert(v_ok, 'T4 a Host cannot run a refresh');
  v_ok := false;
  BEGIN PERFORM * FROM public.ad_campaign_daily_series(ARRAY[]::uuid[], 'UTC');
  EXCEPTION WHEN insufficient_privilege THEN v_ok := true; END;
  PERFORM pg_temp.t4238_assert(v_ok, 'T7 the daily series is admin/service only');

  PERFORM pg_temp.t4238_as_user(v_admin);
  SELECT count(*) INTO v_n FROM public.host_ad_audiences(v_brand_b);
  PERFORM pg_temp.t4238_assert(v_n >= 2, 'T4 an admin reads any brand''s audiences');
  SELECT count(*) INTO v_n FROM public.ad_list_audiences WHERE brand_id IN (v_brand_a, v_brand_b);
  PERFORM pg_temp.t4238_assert(v_n >= 6, 'T4 an admin reads definitions through RLS');
  v_ok := false;
  BEGIN PERFORM 1 FROM public.ad_list_audience_members LIMIT 1;
  EXCEPTION WHEN insufficient_privilege THEN v_ok := true; END;
  PERFORM pg_temp.t4238_assert(v_ok, 'T4 even an admin cannot select members (counts only)');
  SELECT count(*) INTO v_n FROM public.ad_campaign_daily_series(ARRAY[]::uuid[], 'Not/AZone');
  PERFORM pg_temp.t4238_assert(v_n = 0, 'T7 an invalid time zone falls back without error');
  RESET ROLE;
END
$t4$;

-- T6: the trigger never fails its host transaction ---------------------------
DO $t6$
DECLARE v_ok boolean := true;
BEGIN
  -- Make the trigger's UPDATE fail; the checkout insert must still commit.
  ALTER TABLE public.ad_list_audiences ADD CONSTRAINT t4238_force_fail CHECK (members_refreshed_at IS NOT NULL) NOT VALID;
  BEGIN
    INSERT INTO public.ticket_checkout_sessions(event_id, brand_id, buyer_name, buyer_email, buyer_phone_e164,
        idempotency_key, expires_at, ad_tracking_opt_out)
    VALUES ('42380000-0000-4000-a000-000000000201', '42380000-0000-4000-a000-000000000101', 'T Trigger',
        't4238-trigger@mingla-fixture.org', '+2348030004240', 't4238-optout-3', now() + interval '1 hour', true);
  EXCEPTION WHEN OTHERS THEN v_ok := false; END;
  ALTER TABLE public.ad_list_audiences DROP CONSTRAINT t4238_force_fail;
  PERFORM pg_temp.t4238_assert(v_ok AND EXISTS (SELECT 1 FROM public.ticket_checkout_sessions WHERE idempotency_key = 't4238-optout-3'),
    'T6 a failing mark-dirty never fails the checkout insert');
END
$t6$;
ROLLBACK;

-- T5: concurrency — needs a committed second session (dblink). ----------------
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;
BEGIN;
DO $t5$
DECLARE
  v_id constant uuid := '42380000-0000-4000-a000-0000000005aa';
  v_state text;
  v_conn text := format('host=127.0.0.1 dbname=%s user=%s', current_database(), current_user);
BEGIN
  -- Session 1 holds the refresh lock for this audience id.
  PERFORM pg_advisory_xact_lock(hashtext('ad_list_audience:' || v_id::text));
  PERFORM extensions.dblink_connect('t4238', v_conn);
  BEGIN
    PERFORM * FROM extensions.dblink('t4238', format(
      $q$ SELECT set_config('request.jwt.claim.role','service_role',false);
          SELECT public.ad_list_audience_refresh(%L)::text $q$, v_id)) AS r(x text);
    v_state := 'no_error';
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLERRM;
  END;
  PERFORM extensions.dblink_disconnect('t4238');
  PERFORM pg_temp.t4238_assert(v_state LIKE '%ad_list_audience_refresh_in_progress%',
    'T5 a concurrent refresh raises ad_list_audience_refresh_in_progress (got ' || v_state || ')');
END
$t5$;
ROLLBACK;

-- The PT409 code itself (same session, outside the lock): proven on the
-- function body so a reword to 40001 fails here.
DO $t5b$
BEGIN
  PERFORM pg_temp.t4238_assert(
    pg_get_functiondef('public.ad_list_audience_refresh(uuid)'::regprocedure) LIKE '%ERRCODE = ''PT409''%'
    AND pg_get_functiondef('public.ad_list_audience_refresh(uuid)'::regprocedure) NOT LIKE '%40001%',
    'T5 the in-progress conflict is PT409, never 40001');
END
$t5b$;

-- T8 + T9: non-superuser with pg-safeupdate, and the Host's sizes. ----------
BEGIN;
LOAD 'safeupdate';
DO $t8$
DECLARE
  v_host  constant uuid := '42389000-0000-4000-a000-000000000001';
  v_brand constant uuid := '42389000-0000-4000-a000-000000000101';
  v_person uuid; v_link uuid; v_cm uuid;
  i integer;
BEGIN
  INSERT INTO auth.users(id, email) VALUES (v_host, 't4238-t8-host@mingla-fixture.org');
  INSERT INTO public.creator_accounts(id, email) VALUES (v_host, 't4238-t8-host@mingla-fixture.org');
  INSERT INTO public.brands(id, account_id, name, slug, default_currency, country_code)
  VALUES (v_brand, v_host, 'T4238 T8 Brand', 't4238-t8-' || v_brand, 'NGN', 'NG');
  FOR i IN 1..3 LOOP
    INSERT INTO public.brand_people(brand_id, display_name) VALUES (v_brand, 'T8 Contact ' || i) RETURNING id INTO v_person;
    INSERT INTO public.brand_person_source_links(brand_id, brand_person_id, source_kind, source_id, link_method, source_occurred_at)
    VALUES (v_brand, v_person, 'import', gen_random_uuid(), 'normalized_address', now()) RETURNING id INTO v_link;
    INSERT INTO public.brand_person_contact_methods(brand_id, brand_person_id, channel, normalized_value, provenance_scope, is_exportable, is_primary)
    VALUES (v_brand, v_person, 'email', format('t4238-t8-c%s@mingla-fixture.org', i), 'brand_owned', true, true) RETURNING id INTO v_cm;
    INSERT INTO public.brand_person_contact_method_sources(contact_method_id, source_link_id, provenance_kind, exportable)
    VALUES (v_cm, v_link, 'import', true);
  END LOOP;
END
$t8$;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
DO $t8b$
DECLARE
  v_brand constant uuid := '42389000-0000-4000-a000-000000000101';
  v_err text := NULL;
  v_n integer;
BEGIN
  PERFORM pg_temp.t4238_assert(NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user),
    'T8 running as a non-superuser (' || current_user || ')');
  -- The guard is live in this session: a bare DELETE is refused.
  BEGIN
    CREATE TEMP TABLE t8_probe(x int) ON COMMIT DROP;
    DELETE FROM t8_probe;
    v_err := 'no error';
  EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE;
  END;
  PERFORM pg_temp.t4238_assert(v_err = '21000', 'T8 pg-safeupdate is loaded (bare DELETE raised ' || v_err || ')');
  v_err := NULL;
  BEGIN
    PERFORM public.ad_list_audience_ensure_brand(v_brand);
    PERFORM public.ad_list_audience_refresh(id) FROM public.ad_list_audiences
      WHERE audience_key = 'brand:' || v_brand || ':contacts';
  EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE || ' ' || SQLERRM;
  END;
  PERFORM pg_temp.t4238_assert(v_err IS NULL,
    'T8 ensure_brand and refresh succeed under pg-safeupdate (got ' || COALESCE(v_err, 'ok') || ')');

  -- T9 ----------------------------------------------------------------------
  PERFORM pg_temp.t4238_assert(public.ad_list_audience_round_size(0) = 0, 'T9 round_size(0) = 0');
  FOR v_n IN 1..9 LOOP
    PERFORM pg_temp.t4238_assert(public.ad_list_audience_round_size(v_n) = 1,
      format('T9 round_size(%s) = 1 (fewer than 10)', v_n));
  END LOOP;
  PERFORM pg_temp.t4238_assert(public.ad_list_audience_round_size(10) = 10, 'T9 round_size(10) = 10');
  PERFORM pg_temp.t4238_assert(
    (SELECT approx_size FROM public.host_ad_audiences(v_brand) WHERE audience_key = 'brand:' || v_brand || ':contacts') = 1,
    'T9 a 3-person list reaches the Host as 1 ("Fewer than 10 people")');
  PERFORM pg_temp.t4238_assert(
    (SELECT approx_size FROM public.host_ad_audiences(v_brand) WHERE audience_key = 'brand:' || v_brand || ':guests') = 0,
    'T9 an empty list reaches the Host as 0 ("No people yet")');
  PERFORM pg_temp.t4238_assert(
    EXISTS (SELECT 1 FROM public.host_ad_audiences(v_brand) WHERE kind = 'lookalike')
    AND NOT EXISTS (SELECT 1 FROM public.host_ad_audiences(v_brand) WHERE kind = 'lookalike' AND approx_size IS NOT NULL),
    'T9 a lookalike has no Host size (never the seed''s count)');
END
$t8b$;
ROLLBACK;
