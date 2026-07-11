-- ORCH-1334 [rsvp-guest-console-identity-gap] — live-fire SQL contract tests
-- (T-1 host identity · T-2 honest null phone · T-3 web parity · T-4 non-host
-- rejected). Enforces the behavioral half of the fix on the LIVE RPC after the
-- migration is applied.
--
-- USAGE (this repo's SQL-probe convention — hand-run against the linked remote
-- AFTER the orchestrator applies 20261224000000_orch_1334_rsvp_guest_identity.sql;
-- NOT run by the implementor — the implementor's runnable fails-on-revert proof is
-- the source-contract Deno test orch_1334_rsvp_guest_identity.test.ts):
--
--   cat supabase/migrations/__tests__/orch_1334_rsvp_guest_identity.test.sql \
--     | /Users/sethogieva/bin/supabase db remote sql --linked
--
-- Wrapped in BEGIN; … ROLLBACK; → leaves NO fixture rows. RAISE NOTICE on PASS,
-- RAISE EXCEPTION on FAIL (non-zero exit in CI/scripts). No FK from
-- event_rsvps.user_id / profiles.id → auth.users on this DB (verified), so the
-- fixtures synthesize identity directly.

-- ===========================================================================
-- T-1 / T-2 / T-3 — as the HOST (event_manager on the event's brand),
-- host_list_rsvp_guests resolves app identity, keeps a null phone NULL, and
-- echoes web-typed values with the correct source discriminator.
-- ===========================================================================
BEGIN;
DO $$
DECLARE
  v_host      uuid := gen_random_uuid();
  v_app       uuid := gen_random_uuid();  -- app member WITH a phone
  v_app_np    uuid := gen_random_uuid();  -- app member with NO phone
  v_brand     uuid := gen_random_uuid();
  v_event     uuid := gen_random_uuid();
  v_r_app     uuid := gen_random_uuid();
  v_r_app_np  uuid := gen_random_uuid();
  v_r_web     uuid := gen_random_uuid();
  v_dn    text;
  v_email text;
  v_phone text;
  v_src   text;
BEGIN
  -- Brand owned by the host (account_id) → biz_brand_effective_rank = owner rank
  -- ≥ event_manager for the guard.
  INSERT INTO public.brands (id, account_id, slug, name, default_currency, created_at, updated_at)
  VALUES (v_brand, v_host, 'orch1334-brand', 'ORCH1334', 'USD', now(), now());

  INSERT INTO public.events (id, brand_id, created_by, event_type, title, slug, description,
    status, visibility, currency, timezone, party_types, rsvp_approval_mode,
    rsvp_discoverable, created_at, updated_at, theme)
  VALUES (v_event, v_brand, v_host, 'rsvp', 'Identity Party', 'identity-party-1334', 'd',
    'scheduled', 'public', 'USD', 'UTC', ARRAY['house-party'], 'auto', false, now(), now(),
    '{}'::jsonb);

  -- App member profiles (the sentinel guest_name='Guest' must resolve to these).
  INSERT INTO public.profiles (id, display_name, username, email, phone,
    active, is_beta_tester, is_admin, is_seed, show_activity)
  VALUES
    (v_app,    'Ada Lovelace', 'ada',   'ada@example.com',   '+15551230000',
      true, false, false, false, true),
    (v_app_np, 'Grace Hopper', 'grace', 'grace@example.com', NULL,
      true, false, false, false, true);

  -- App rows store 'Guest' (write-path sentinel, untouched); one has a null phone.
  INSERT INTO public.event_rsvps (id, event_id, user_id, guest_name, guest_email,
    guest_phone, rsvp_status, approval_status, plus_count, created_at)
  VALUES
    (v_r_app,    v_event, v_app,    'Guest', NULL, NULL, 'going', 'approved', 0, now()),
    (v_r_app_np, v_event, v_app_np, 'Guest', NULL, NULL, 'going', 'approved', 0, now()),
    -- Web link guest (user_id NULL) — typed name/email/phone.
    (v_r_web,    v_event, NULL, 'Web Wanda', 'wanda@web.com', '+15559990000',
      'going', 'approved', 0, now());

  -- Impersonate the host for auth.uid() inside the DEFINER RPC.
  PERFORM set_config('request.jwt.claim.sub', v_host::text, true);
  PERFORM set_config('role', 'authenticated', true);

  -- T-1: app row resolves real identity (≠ 'Guest') + email + source='app'.
  SELECT display_name, email, phone, source INTO v_dn, v_email, v_phone, v_src
  FROM public.host_list_rsvp_guests(v_event) WHERE id = v_r_app;
  IF v_dn <> 'Ada Lovelace' THEN
    RAISE EXCEPTION 'T-1 FAIL: app display_name = % (expected Ada Lovelace)', v_dn;
  END IF;
  IF v_email <> 'ada@example.com' THEN
    RAISE EXCEPTION 'T-1 FAIL: app email = % (expected ada@example.com)', v_email;
  END IF;
  IF v_src <> 'app' THEN
    RAISE EXCEPTION 'T-1 FAIL: app source = % (expected app)', v_src;
  END IF;
  IF v_phone <> '+15551230000' THEN
    RAISE EXCEPTION 'T-1 FAIL: app phone = % (expected +15551230000)', v_phone;
  END IF;
  RAISE NOTICE 'T-1 PASS: app row resolves display_name/email/source/phone from profile';

  -- T-2: an app row whose profile phone is NULL returns NULL phone (never faked).
  SELECT display_name, phone, source INTO v_dn, v_phone, v_src
  FROM public.host_list_rsvp_guests(v_event) WHERE id = v_r_app_np;
  IF v_dn <> 'Grace Hopper' THEN
    RAISE EXCEPTION 'T-2 FAIL: app_np display_name = % (expected Grace Hopper)', v_dn;
  END IF;
  IF v_phone IS NOT NULL THEN
    RAISE EXCEPTION 'T-2 FAIL: app_np phone = % (expected NULL — never fabricated)', v_phone;
  END IF;
  RAISE NOTICE 'T-2 PASS: null-phone app row returns NULL phone (honest, Constitution #9)';

  -- T-3: web row echoes typed values with source='web'.
  SELECT display_name, email, phone, source INTO v_dn, v_email, v_phone, v_src
  FROM public.host_list_rsvp_guests(v_event) WHERE id = v_r_web;
  IF v_dn <> 'Web Wanda' OR v_email <> 'wanda@web.com'
     OR v_phone <> '+15559990000' OR v_src <> 'web' THEN
    RAISE EXCEPTION 'T-3 FAIL: web row = (%,%,%,%) expected (Web Wanda, wanda@web.com, +15559990000, web)',
      v_dn, v_email, v_phone, v_src;
  END IF;
  RAISE NOTICE 'T-3 PASS: web row echoes typed name/email/phone with source=web';
END$$;
ROLLBACK;

-- ===========================================================================
-- T-4 — a caller whose brand rank < event_manager is REJECTED with
-- insufficient_event_permission and sees ZERO rows (DEFINER guard-first).
-- Reverting the migration to the SECURITY INVOKER no-guard form makes this FAIL
-- (the RPC would return rows / not raise).
-- ===========================================================================
BEGIN;
DO $$
DECLARE
  v_host     uuid := gen_random_uuid();
  v_stranger uuid := gen_random_uuid();
  v_brand    uuid := gen_random_uuid();
  v_event    uuid := gen_random_uuid();
  v_rejected boolean := false;
BEGIN
  INSERT INTO public.brands (id, account_id, slug, name, default_currency, created_at, updated_at)
  VALUES (v_brand, v_host, 'orch1334-guard-brand', 'ORCH1334 Guard', 'USD', now(), now());

  INSERT INTO public.events (id, brand_id, created_by, event_type, title, slug, description,
    status, visibility, currency, timezone, party_types, rsvp_approval_mode,
    rsvp_discoverable, created_at, updated_at, theme)
  VALUES (v_event, v_brand, v_host, 'rsvp', 'Guarded Party', 'guarded-party-1334', 'd',
    'scheduled', 'public', 'USD', 'UTC', ARRAY['house-party'], 'auto', false, now(), now(),
    '{}'::jsonb);

  INSERT INTO public.event_rsvps (event_id, user_id, guest_name, guest_email,
    guest_phone, rsvp_status, approval_status, plus_count, created_at)
  VALUES (v_event, gen_random_uuid(), 'Guest', NULL, NULL, 'going', 'approved', 0, now());

  -- Impersonate a stranger with NO membership on the brand.
  PERFORM set_config('request.jwt.claim.sub', v_stranger::text, true);
  PERFORM set_config('role', 'authenticated', true);

  BEGIN
    PERFORM * FROM public.host_list_rsvp_guests(v_event);
  EXCEPTION WHEN OTHERS THEN
    v_rejected := (SQLERRM LIKE '%insufficient_event_permission%');
    IF NOT v_rejected THEN RAISE; END IF;  -- unexpected error → surface it
  END;

  IF NOT v_rejected THEN
    RAISE EXCEPTION 'T-4 FAIL: non-host was NOT rejected (guard missing → guest-scraper regression)';
  END IF;
  RAISE NOTICE 'T-4 PASS: non-host rejected with insufficient_event_permission (0 rows)';
END$$;
ROLLBACK;
