-- #4508 Phase 0 — a plus-one is matched to an account by phone.
--
-- MINGLA-INVARIANT: I-4508-GUEST-PHONE-MATCH | issue #4508 | biz_resolve_verified_user compares phone numbers as digits only on both sides (a guest "+1..." resolves to a confirmed auth phone "1..."), tries the phone before the email, accepts only a code-proven phone (possession ledger or confirmed GoTrue phone), and submit_event_rsvp never resolves a plus-one to the RSVP's own primary account.
--
--   happy: guest +15550104508 resolves to the account whose CONFIRMED auth
--          phone is 15550104508 (the live case: stored without "+")
--   happy: the possession ledger (verified_phone_identities) also resolves
--   adversarial: an UNCONFIRMED auth phone never matches
--   adversarial: a guest number equal to the primary's own never matches
--   adversarial: a phone match wins over a different account's email match
--
-- The stock CI image has no auth.users.phone / phone_confirmed_at and no
-- auth.identities; this suite adds them inside its own transaction.
\set ON_ERROR_STOP on
\ir ../20281119004508_issue_4508_guest_phone_match.sql

BEGIN;

ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone_confirmed_at timestamptz;
CREATE TABLE IF NOT EXISTS auth.identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  provider text NOT NULL DEFAULT 'email',
  identity_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_sign_in_at timestamptz
);

CREATE FUNCTION pg_temp.ok(p_ok boolean, p_message text) RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION '#4508 phase 0 FAIL: %', p_message; END IF;
END
$fn$;

DO $test$
DECLARE
  v_owner uuid := '45080000-0000-4000-8000-000000000001';
  v_brand uuid := '45080000-0000-4000-8000-000000000002';
  v_event uuid := '45080000-0000-4000-8000-000000000003';
  v_guest_user uuid := '45080000-0000-4000-8000-000000000011';
  v_unconfirmed uuid := '45080000-0000-4000-8000-000000000012';
  v_primary uuid := '45080000-0000-4000-8000-000000000013';
  v_email_user uuid := '45080000-0000-4000-8000-000000000014';
  v_ledger_user uuid := '45080000-0000-4000-8000-000000000015';
  v_result jsonb;
  v_match uuid;
BEGIN
  INSERT INTO auth.users(id, email) VALUES
    (v_owner, 'issue-4508-owner@example.test'),
    (v_guest_user, 'issue-4508-guest@example.test'),
    (v_unconfirmed, 'issue-4508-unconfirmed@example.test'),
    (v_primary, 'issue-4508-primary@example.test'),
    (v_email_user, 'issue-4508-email@example.test'),
    (v_ledger_user, 'issue-4508-ledger@example.test');
  -- GoTrue stores the phone WITHOUT the leading "+".
  UPDATE auth.users SET phone = '15550104508', phone_confirmed_at = now() WHERE id = v_guest_user;
  UPDATE auth.users SET phone = '15550104509', phone_confirmed_at = NULL WHERE id = v_unconfirmed;
  UPDATE auth.users SET phone = '15550104510', phone_confirmed_at = now() WHERE id = v_primary;
  INSERT INTO auth.identities(user_id, provider, identity_data)
  VALUES (v_email_user, 'email',
    jsonb_build_object('email', 'shared-4508@example.test', 'email_verified', true));
  INSERT INTO public.verified_phone_identities(user_id, phone_e164)
  VALUES (v_ledger_user, '+447700904508');

  INSERT INTO public.creator_accounts(id, email) VALUES (v_owner, 'issue-4508-owner@example.test');
  INSERT INTO public.brands(id, account_id, name, slug, payment_provider, pricing_region,
    pricing_currency, default_currency, contact_email)
  VALUES (v_brand, v_owner, 'Issue 4508 Host', 'issue-4508-host', 'stripe', 'US', 'USD', 'USD',
    'host-4508@example.test');
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility,
    timezone, currency, rsvp_capacity, rsvp_waitlist_enabled, rsvp_approval_mode,
    rsvp_allow_plus_ones, rsvp_plus_ones_max, published_at)
  VALUES (v_event, v_brand, v_owner, 'Phone Match RSVP', 'phone-match-4508', 'rsvp', 'scheduled',
    'public', 'America/New_York', 'USD', NULL, false, 'auto', true, 3, now());
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
  VALUES (v_event, now() + interval '10 days', now() + interval '10 days 4 hours',
    'America/New_York', true);

  -- Direct reads.
  PERFORM pg_temp.ok(public.biz_resolve_verified_user(NULL, '+15550104508') = v_guest_user,
    'a +E.164 guest phone must resolve to the confirmed digits-only auth phone');
  PERFORM pg_temp.ok(public.biz_resolve_verified_user(NULL, '+1 (555) 010-4508') = v_guest_user,
    'formatting characters are ignored on the guest side');
  PERFORM pg_temp.ok(public.biz_resolve_verified_user(NULL, '+15550104509') IS NULL,
    'an unconfirmed auth phone must never match');
  PERFORM pg_temp.ok(public.biz_resolve_verified_user(NULL, '+447700904508') = v_ledger_user,
    'the possession ledger must resolve');
  PERFORM pg_temp.ok(
    public.biz_resolve_verified_user('shared-4508@example.test', '+15550104508') = v_guest_user,
    'a phone match must win over a different account''s email match');
  PERFORM pg_temp.ok(
    public.biz_resolve_verified_user('shared-4508@example.test', '+15550000000') = v_email_user,
    'the verified email still resolves when no phone matches');

  -- Through the RSVP writer: the live case.
  v_result := public.submit_event_rsvp(
    v_event, v_primary, 'Primary 4508', 'issue-4508-primary@example.test', '+15550104510',
    'going', 3,
    jsonb_build_array(
      jsonb_build_object('name', 'Guest One', 'email', 'typed-wrong@example.test',
        'phone', '+15550104508', 'phoneCountryIso', 'US'),
      jsonb_build_object('name', 'Not Confirmed', 'email', 'nc-4508@example.test',
        'phone', '+15550104509', 'phoneCountryIso', 'US'),
      jsonb_build_object('name', 'Me Again', 'email', 'me-4508@example.test',
        'phone', '+15550104510', 'phoneCountryIso', 'US')
    ),
    NULL, 'US');

  SELECT g.matched_user_id INTO v_match FROM public.event_rsvp_guests g
   WHERE g.rsvp_id = (v_result->>'rsvpId')::uuid AND g.phone = '+15550104508';
  PERFORM pg_temp.ok(v_match = v_guest_user,
    'submit_event_rsvp must match the plus-one by phone: ' || coalesce(v_match::text, 'NULL'));
  SELECT g.matched_user_id INTO v_match FROM public.event_rsvp_guests g
   WHERE g.rsvp_id = (v_result->>'rsvpId')::uuid AND g.phone = '+15550104509';
  PERFORM pg_temp.ok(v_match IS NULL, 'an unconfirmed phone must not match through the writer');
  SELECT g.matched_user_id INTO v_match FROM public.event_rsvp_guests g
   WHERE g.rsvp_id = (v_result->>'rsvpId')::uuid AND g.phone = '+15550104510';
  PERFORM pg_temp.ok(v_match IS NULL,
    'a plus-one carrying the primary''s own number must never resolve to the primary');

  RAISE NOTICE '#4508 phase 0: all cases passed';
END
$test$;

ROLLBACK;
