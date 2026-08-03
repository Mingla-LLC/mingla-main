\set ON_ERROR_STOP on
BEGIN;

-- Issue #1529 T-1 — PER-PRODUCER BEHAVIOURAL MATRIX.
--
-- This is the real guard. It does not read source text and it does not inspect
-- the catalog — it fires the ACTUAL triggers and asserts what actually landed in
-- public.notification_outbox. The companion file
-- issue_1529_producer_catalog_audit.test.sql proves every producer was
-- CONSIDERED; this file proves the ones that carry a handset are CORRECT.
--
-- What #1529 broke, and what each section below pins:
--   * `country_code` was written by no producer at all (6/6 production rows
--     NULL), so every notification presented as American and Nigerian texts went
--     to Twilio under the US kill-switch.
--   * The Stay SMS legs enqueued `auth.users.phone` VERBATIM, and Supabase
--     stores that WITHOUT the leading `+` (51/51 rows). The dispatcher only
--     treats `+`-prefixed contacts as phones, so those rows died as
--     `skipped/no_contact` before country was ever consulted. That is why the
--     Stay section asserts the CONTACT as well as the country.
--
-- NULL must mean "not derivable" everywhere and must NEVER mean US — the
-- unmapped and email-only cases below are what pin that.

-- =========================================================================
-- Shared parents.
-- =========================================================================
INSERT INTO auth.users (
  id, instance_id, aud, role, email, phone, created_at, updated_at
) VALUES
  ('00000000-1529-4000-8000-000000000001',
   '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'owner-1529@example.test',
   -- The #1529 F-2 shape: a Nigerian handset stored WITHOUT the leading '+'.
   '2348012345678', now(), now()),
  ('00000000-1529-4000-8000-000000000002',
   '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'finance-1529@example.test',
   -- Cannot be normalised to E.164 -> must produce NO SMS row at all.
   'not-a-number', now(), now()),
  ('00000000-1529-4000-8000-000000000003',
   '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'guest-1529@example.test',
   -- The exact handset from the production row that proved the venue/handset
   -- divergence (#1529 F-3).
   '2347084065203', now(), now()),
  ('00000000-1529-4000-8000-000000000004',
   '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'scanner-1529@example.test',
   '2349099999999', now(), now());

INSERT INTO public.creator_accounts (id, email, created_at)
VALUES ('00000000-1529-4000-8000-000000000001',
        'owner-1529@example.test', now());

-- NOTE: this INSERT auto-creates a brand_team_members(role='brand_owner') row
-- for account_id via biz_brand_owner_team_member_after_insert, so the owner is
-- already a staff recipient. Do not insert one manually.
INSERT INTO public.brands (
  id, account_id, name, slug, default_currency, created_at, updated_at
) VALUES (
  '00000000-1529-4000-8000-000000000010',
  '00000000-1529-4000-8000-000000000001',
  'Issue 1529 Brand', 'issue-1529-brand', 'NGN', now(), now()
);

INSERT INTO public.brand_team_members (brand_id, user_id, role, accepted_at)
VALUES
  ('00000000-1529-4000-8000-000000000010',
   '00000000-1529-4000-8000-000000000002', 'finance_manager', now()),
  -- 'scanner' is a valid role the producer deliberately EXCLUDES — a negative
  -- control proving the recipient set is not simply "everyone".
  ('00000000-1529-4000-8000-000000000010',
   '00000000-1529-4000-8000-000000000004', 'scanner', now());

INSERT INTO public.venue_listings (
  id, brand_id, slug, name, lat, lng, venue_category, claim_status
) VALUES (
  '00000000-1529-4000-8000-000000000011',
  '00000000-1529-4000-8000-000000000010',
  'issue1529venue', 'Issue 1529 Venue', 6.45, 3.47, 'restaurant', 'verified'
);

-- =========================================================================
-- PRODUCERS A/B — public.orch_1161_reservation_notify_outbox()
-- Fired by the AFTER INSERT OR UPDATE trigger on public.reservations.
-- =========================================================================
INSERT INTO public.reservations (
  id, brand_id, venue_id, reserved_for, party_size, status, source, created_via,
  guest_name, guest_phone_e164, guest_email
) VALUES
  -- NG handset -> 'NG'
  ('00000000-1529-4000-8000-000000000020',
   '00000000-1529-4000-8000-000000000010',
   '00000000-1529-4000-8000-000000000011',
   now() + interval '10 days', 2, 'confirmed', 'website', 'guest',
   'NG Guest', '+2348012345678', 'ng-1529@example.test'),
  -- US handset -> 'US'
  ('00000000-1529-4000-8000-000000000021',
   '00000000-1529-4000-8000-000000000010',
   '00000000-1529-4000-8000-000000000011',
   now() + interval '11 days', 2, 'confirmed', 'website', 'guest',
   'US Guest', '+14155550123', 'us-1529@example.test'),
  -- Unmapped calling code -> NULL. NOT 'US'. This is the assertion that
  -- encodes the defect.
  ('00000000-1529-4000-8000-000000000022',
   '00000000-1529-4000-8000-000000000010',
   '00000000-1529-4000-8000-000000000011',
   now() + interval '12 days', 2, 'confirmed', 'website', 'guest',
   'DE Guest', '+4915112345678', 'de-1529@example.test'),
  -- Email only, no handset -> genuinely underivable -> NULL.
  ('00000000-1529-4000-8000-000000000023',
   '00000000-1529-4000-8000-000000000010',
   '00000000-1529-4000-8000-000000000011',
   now() + interval '13 days', 2, 'confirmed', 'website', 'guest',
   'Email Guest', NULL, 'email-only-1529@example.test');

DO $reservation_matrix$
DECLARE
  v_row record;
  v_expected text;
  v_label text;
  v_seen integer := 0;
BEGIN
  FOR v_label, v_expected IN
    SELECT * FROM (VALUES
      ('00000000-1529-4000-8000-000000000020', 'NG'),
      ('00000000-1529-4000-8000-000000000021', 'US'),
      ('00000000-1529-4000-8000-000000000022', NULL),
      ('00000000-1529-4000-8000-000000000023', NULL)
    ) AS t(reservation_id, expected)
  LOOP
    SELECT country_code, contact INTO v_row
    FROM public.notification_outbox
    WHERE idempotency_key = 'buyer_reservation_confirmed:' || v_label;

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'issue_1529_t1_reservation_enqueued_no_row_for_%', v_label;
    END IF;
    v_seen := v_seen + 1;

    IF v_row.country_code IS DISTINCT FROM v_expected THEN
      RAISE EXCEPTION
        'issue_1529_t1_reservation_country_mismatch_% expected_% got_%',
        v_label, COALESCE(v_expected, '<NULL>'),
        COALESCE(v_row.country_code, '<NULL>');
    END IF;
  END LOOP;

  -- Vacuity guard: if the trigger silently stopped enqueuing, the loop above
  -- would raise on the first row — but assert the count too, so a future edit
  -- that narrows the matrix cannot quietly shrink what is proven.
  IF v_seen <> 4 THEN
    RAISE EXCEPTION 'issue_1529_t1_reservation_matrix_incomplete_saw_%', v_seen;
  END IF;
END;
$reservation_matrix$;

-- =========================================================================
-- PRODUCERS H/I/J/K — public.issue_1389_enqueue_stay_event()
-- The NG-critical path: country AND E.164 contact normalisation.
-- =========================================================================
INSERT INTO public.feature_flags (flag_key, is_enabled, description)
VALUES ('STAY_NOTIFICATIONS', true, 'Stay transactional notification fanout')
ON CONFLICT (flag_key) DO UPDATE SET is_enabled = true;

INSERT INTO public.venue_listings (
  id, brand_id, slug, name, lat, lng, venue_category, claim_status
) VALUES (
  '00000000-1529-4000-8000-000000000012',
  '00000000-1529-4000-8000-000000000010',
  'issue1529stay', 'Issue 1529 Stay', 6.45, 3.47, 'stay', 'verified'
);

INSERT INTO public.stay_quotes (
  id, user_id, actor_key_hash, venue_id, brand_id, currency_code,
  mode, status, source_subtotal_minor, fee_total_minor, tax_total_minor,
  total_minor, request_hash, price_revision_set_hash,
  inventory_revision_set_hash, policy_snapshot_hash, idempotency_key,
  expires_at, consumed_at
) VALUES (
  '00000000-1529-4000-8000-000000000030',
  '00000000-1529-4000-8000-000000000003',
  repeat('a', 64),
  '00000000-1529-4000-8000-000000000012',
  '00000000-1529-4000-8000-000000000010',
  'NGN', 'instant', 'consumed',
  12500000, 0, 0, 12500000,
  repeat('1', 64), repeat('2', 64), repeat('3', 64), repeat('4', 64),
  'issue-1529-stay-quote', now() + interval '1 hour', now()
);

INSERT INTO public.stay_reservation_groups (
  id, public_reference, quote_id, user_id, actor_key_hash, venue_id,
  brand_id, currency_code, mode, state, guest_snapshot,
  source_subtotal_minor, fee_total_minor, tax_total_minor, total_minor,
  idempotency_key, request_hash
) VALUES (
  '00000000-1529-4000-8000-000000000031',
  'ST-15290000000000000001',
  '00000000-1529-4000-8000-000000000030',
  -- MUST be non-NULL: the guest branch SELECTs FROM auth.users WHERE
  -- id = v_group.user_id, so a NULL here yields no recipient at all.
  '00000000-1529-4000-8000-000000000003',
  repeat('a', 64),
  '00000000-1529-4000-8000-000000000012',
  '00000000-1529-4000-8000-000000000010',
  'NGN', 'instant', 'confirmed',
  -- No "phone" key, so the producer falls back to auth.users.phone — the
  -- plus-less F-2 shape this issue exists to fix.
  '{"name":"Issue 1529 Guest"}'::jsonb,
  12500000, 0, 0, 12500000,
  'issue-1529-stay-group', repeat('9', 64)
);

-- STAFF leg (producers H + I).
INSERT INTO public.stay_reservation_events (
  id, group_id, event_type, actor_type, idempotency_key, safe_metadata
) VALUES (
  '00000000-1529-4000-8000-000000000040',
  '00000000-1529-4000-8000-000000000031',
  'stay_request_submitted', 'guest', 'issue-1529-staff-event',
  jsonb_build_object('amountMinor', '12500000')
);

-- GUEST leg (producers J + K).
INSERT INTO public.stay_reservation_events (
  id, group_id, event_type, actor_type, idempotency_key, safe_metadata
) VALUES (
  '00000000-1529-4000-8000-000000000041',
  '00000000-1529-4000-8000-000000000031',
  'stay_reservation_confirmed', 'service', 'issue-1529-guest-event',
  '{}'::jsonb
);

DO $stay_matrix$
DECLARE
  v_contact text;
  v_country text;
  v_count   integer;
BEGIN
  -- ── Producer I: the staff SMS leg. THE headline assertion of #1529.
  -- Stored plus-less as '2348012345678'; must be enqueued as E.164 AND NG.
  SELECT contact, country_code INTO v_contact, v_country
  FROM public.notification_outbox
  WHERE idempotency_key =
    'stay:00000000-1529-4000-8000-000000000040:stay_request_received:sms:'
    || '00000000-1529-4000-8000-000000000001';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'issue_1529_t1_stay_staff_sms_row_missing';
  END IF;
  IF v_contact <> '+2348012345678' THEN
    RAISE EXCEPTION
      'issue_1529_t1_stay_staff_contact_not_e164_got_%', v_contact;
  END IF;
  IF v_country IS DISTINCT FROM 'NG' THEN
    RAISE EXCEPTION
      'issue_1529_t1_stay_staff_country_expected_NG_got_%',
      COALESCE(v_country, '<NULL>');
  END IF;

  -- ── Producer H: the staff EMAIL leg carries an explicit NULL country.
  SELECT country_code INTO v_country
  FROM public.notification_outbox
  WHERE idempotency_key =
    'stay:00000000-1529-4000-8000-000000000040:stay_request_received:user:'
    || '00000000-1529-4000-8000-000000000001';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'issue_1529_t1_stay_staff_email_row_missing';
  END IF;
  IF v_country IS NOT NULL THEN
    RAISE EXCEPTION
      'issue_1529_t1_stay_email_leg_invented_country_%', v_country;
  END IF;

  -- ── An unnormalisable phone must produce NO SMS row at all (SC-3), while
  -- the email leg for the same recipient is unaffected.
  SELECT count(*) INTO v_count
  FROM public.notification_outbox
  WHERE idempotency_key =
    'stay:00000000-1529-4000-8000-000000000040:stay_request_received:sms:'
    || '00000000-1529-4000-8000-000000000002';
  IF v_count <> 0 THEN
    RAISE EXCEPTION
      'issue_1529_t1_unnormalisable_phone_still_enqueued_an_sms_row';
  END IF;
  SELECT count(*) INTO v_count
  FROM public.notification_outbox
  WHERE idempotency_key =
    'stay:00000000-1529-4000-8000-000000000040:stay_request_received:user:'
    || '00000000-1529-4000-8000-000000000002';
  IF v_count <> 1 THEN
    RAISE EXCEPTION
      'issue_1529_t1_unnormalisable_phone_also_lost_its_email_row';
  END IF;

  -- ── Negative control: 'scanner' is not in the producer's role set, so the
  -- recipient loop must not have reached that user at all. Without this the
  -- assertions above could pass on a producer that simply notifies everyone.
  SELECT count(*) INTO v_count
  FROM public.notification_outbox
  WHERE idempotency_key LIKE
    'stay:00000000-1529-4000-8000-000000000040:%'
    || '00000000-1529-4000-8000-000000000004';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'issue_1529_t1_excluded_role_received_a_notification';
  END IF;

  -- ── Producer K: the guest SMS leg, same contract.
  SELECT contact, country_code INTO v_contact, v_country
  FROM public.notification_outbox
  WHERE idempotency_key =
    'stay:00000000-1529-4000-8000-000000000041:'
    || 'stay_reservation_confirmed:guest-sms';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'issue_1529_t1_stay_guest_sms_row_missing';
  END IF;
  IF v_contact <> '+2347084065203' THEN
    RAISE EXCEPTION
      'issue_1529_t1_stay_guest_contact_not_e164_got_%', v_contact;
  END IF;
  IF v_country IS DISTINCT FROM 'NG' THEN
    RAISE EXCEPTION
      'issue_1529_t1_stay_guest_country_expected_NG_got_%',
      COALESCE(v_country, '<NULL>');
  END IF;

  -- ── EVERY SMS-channel row this file produced must be '+'-prefixed. This is
  -- I-PROPOSED-1529-OUTBOX-SMS-CONTACT-IS-E164 asserted over the whole set
  -- rather than row by row, so a NEW SMS leg added later cannot slip through.
  SELECT count(*) INTO v_count
  FROM public.notification_outbox
  WHERE payload->>'channel_hint' = 'sms'
    AND (contact IS NULL OR contact NOT LIKE '+%');
  IF v_count <> 0 THEN
    RAISE EXCEPTION
      'issue_1529_t1_% sms_rows_enqueued_a_non_e164_contact', v_count;
  END IF;

  -- Vacuity guard for that sweep: it must have had rows to inspect.
  SELECT count(*) INTO v_count
  FROM public.notification_outbox
  WHERE payload->>'channel_hint' = 'sms';
  IF v_count < 2 THEN
    RAISE EXCEPTION
      'issue_1529_t1_sms_sweep_saw_only_%_rows__assertion_is_vacuous', v_count;
  END IF;
END;
$stay_matrix$;

ROLLBACK;
