-- ORCH-1296 [chip-in-edit-published-gap] — SQL contract tests for the EDIT path.
--
-- Fails-on-revert artifact for migration
--   20261222000000_orch_1296_rsvp_edit_chip_in.sql
-- which teaches biz_update_live_rsvp to READ + provider-aware GATE + PERSIST the
-- 3 voluntary chip-in columns (parity with business_publish_rsvp_draft, ORCH-1291).
--
--   E1 = enabling chip-in via biz_update_live_rsvp on a brand that CANNOT collect
--        RAISEs stripe_charges_disabled. Reverting the conditional gate → E1 FAIL.
--   E2 = editing to enable chip-in + amounts on a Paystack-subaccount brand (can
--        collect on the NGN rail, NO stripe_connect_accounts row) SUCCEEDS and
--        PERSISTS the 3 columns. Reverting the column writes → the assert fails.
--        Reverting the gate to the Stripe-blind pg_brand_can_charge → the edit
--        wrongly RAISEs and the PERFORM throws → E2 FAIL (provider-awareness).
--   E3 = an unrelated edit (chip-in field ABSENT) on a can't-collect brand whose
--        RSVP has chip-in OFF SUCCEEDS (gate is CONDITIONAL — never fires when
--        chip-in resolves off) and leaves the config untouched (no clobber).
--
-- USAGE (repo SQL-probe convention — hand-run against the linked remote AFTER the
-- orchestrator applies the migration; NOT run by the implementor):
--
--   cat supabase/migrations/__tests__/orch_1296_rsvp_edit_chip_in.test.sql \
--     | /Users/sethogieva/bin/supabase db remote sql --linked
--
-- Each block is BEGIN; … ROLLBACK; so it leaves NO fixture rows.
-- RAISE NOTICE on PASS, RAISE EXCEPTION on FAIL (non-zero exit in CI/scripts).

-- ===========================================================================
-- E1 — enabling chip-in on a CAN'T-COLLECT brand via the EDIT RPC RAISEs
-- stripe_charges_disabled. Reverting the ORCH-1296 conditional gate makes the
-- UPDATE succeed → v_raised stays false → E1 FAIL.
-- ===========================================================================
BEGIN;
DO $$
DECLARE
  v_user   uuid := gen_random_uuid();
  v_brand  uuid := gen_random_uuid();
  v_event  uuid := gen_random_uuid();
  v_raised boolean := false;
BEGIN
  INSERT INTO public.brands (id, account_id, slug, name, default_currency, created_at, updated_at)
  VALUES (v_brand, v_user, 'orch1296-e1-brand', 'ORCH1296 E1', 'USD', now(), now());
  -- No stripe_connect_accounts row + no paystack_subaccount_code → cannot collect.

  -- A PUBLISHED (scheduled) chip-in-OFF RSVP owned by v_user (account owner rank).
  INSERT INTO public.events (id, brand_id, created_by, event_type, title, slug, description,
    status, visibility, currency, timezone, party_types, rsvp_approval_mode,
    rsvp_discoverable, rsvp_contribution_enabled, created_at, updated_at, theme)
  VALUES (v_event, v_brand, v_user, 'rsvp', 'E1 Party', 'orch1296-e1-party',
    'Vibes.', 'scheduled', 'public', 'USD', 'UTC',
    ARRAY['house-party'], 'auto', false, false, now(), now(), '{}'::jsonb);

  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config('role', 'authenticated', true);

  BEGIN
    PERFORM public.biz_update_live_rsvp(
      v_event,
      jsonb_build_object('title', 'E1 Party', 'rsvpContributionEnabled', true),
      'Turning on guest chip-in');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM ILIKE '%stripe_charges_disabled%' THEN
      v_raised := true;
    ELSE
      RAISE EXCEPTION 'E1 FAIL: enable-chip-in edit raised the WRONG error: %', SQLERRM;
    END IF;
  END;

  IF NOT v_raised THEN
    RAISE EXCEPTION 'E1 FAIL: enabling chip-in on a can''t-collect brand via edit was NOT blocked (gate reverted?)';
  END IF;
  RAISE NOTICE 'E1 PASS: enable-chip-in edit on can''t-collect brand blocked with stripe_charges_disabled';
END$$;
ROLLBACK;

-- ===========================================================================
-- E2 — editing to enable chip-in + amounts on a Paystack-subaccount brand (can
-- collect on the NGN rail; NO stripe row) SUCCEEDS and PERSISTS the 3 columns.
-- Reverting the column writes → the persisted assert fails. Reverting the gate
-- to the Stripe-blind pg_brand_can_charge → the PERFORM wrongly RAISEs → E2 FAIL.
-- ===========================================================================
BEGIN;
DO $$
DECLARE
  v_user   uuid := gen_random_uuid();
  v_brand  uuid := gen_random_uuid();
  v_event  uuid := gen_random_uuid();
  v_ok     boolean;
BEGIN
  INSERT INTO public.brands (id, account_id, slug, name, default_currency,
    payment_provider, payment_country, paystack_subaccount_code, created_at, updated_at)
  VALUES (v_brand, v_user, 'orch1296-e2-brand', 'ORCH1296 E2', 'NGN',
    'paystack', 'NG', 'ACCT_orch1296e2', now(), now());
  -- NO stripe_connect_accounts row → the Stripe-only predicate would say "can't
  -- collect", but pg_brand_can_collect sees the subaccount and says "can".

  INSERT INTO public.events (id, brand_id, created_by, event_type, title, slug, description,
    status, visibility, currency, timezone, party_types, rsvp_approval_mode,
    rsvp_discoverable, rsvp_contribution_enabled, rsvp_contribution_suggested_cents,
    rsvp_contribution_min_cents, created_at, updated_at, theme)
  VALUES (v_event, v_brand, v_user, 'rsvp', 'Lagos Chip-in', 'orch1296-e2-lagos',
    'Owambe.', 'scheduled', 'public', 'NGN', 'UTC',
    ARRAY['house-party'], 'auto', false, false, NULL, NULL, now(), now(), '{}'::jsonb);

  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config('role', 'authenticated', true);

  PERFORM public.biz_update_live_rsvp(
    v_event,
    jsonb_build_object(
      'title', 'Lagos Chip-in',
      'rsvpContributionEnabled', true,
      'rsvpContributionSuggestedCents', 200000,
      'rsvpContributionMinCents', 100000),
    'Enabling guest chip-in for this event');

  SELECT (rsvp_contribution_enabled = true
          AND rsvp_contribution_suggested_cents = 200000
          AND rsvp_contribution_min_cents = 100000) INTO v_ok
    FROM public.events WHERE id = v_event;
  IF NOT COALESCE(v_ok, false) THEN
    RAISE EXCEPTION 'E2 FAIL: edit did NOT persist the 3 chip-in columns on a can-collect (Paystack) brand';
  END IF;
  RAISE NOTICE 'E2 PASS: edit enables + persists chip-in config on a Paystack-subaccount brand (provider-aware, not Stripe-blind blocked)';
END$$;
ROLLBACK;

-- ===========================================================================
-- E3 — an UNRELATED edit (chip-in field ABSENT) on a can't-collect brand whose
-- RSVP has chip-in OFF SUCCEEDS: the gate is CONDITIONAL (chip-in resolves off →
-- never fires), and the stored chip-in config is left untouched (no clobber).
-- Reverting to an UNCONDITIONAL gate → the title-only edit wrongly RAISEs → FAIL.
-- ===========================================================================
BEGIN;
DO $$
DECLARE
  v_user   uuid := gen_random_uuid();
  v_brand  uuid := gen_random_uuid();
  v_event  uuid := gen_random_uuid();
  v_title  text;
  v_enabled boolean;
BEGIN
  INSERT INTO public.brands (id, account_id, slug, name, default_currency, created_at, updated_at)
  VALUES (v_brand, v_user, 'orch1296-e3-brand', 'ORCH1296 E3', 'USD', now(), now());

  INSERT INTO public.events (id, brand_id, created_by, event_type, title, slug, description,
    status, visibility, currency, timezone, party_types, rsvp_approval_mode,
    rsvp_discoverable, rsvp_contribution_enabled, created_at, updated_at, theme)
  VALUES (v_event, v_brand, v_user, 'rsvp', 'E3 Party', 'orch1296-e3-party',
    'Vibes.', 'scheduled', 'public', 'USD', 'UTC',
    ARRAY['house-party'], 'auto', false, false, now(), now(), '{}'::jsonb);

  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config('role', 'authenticated', true);

  -- Title-only edit — chip-in field ABSENT from the payload.
  PERFORM public.biz_update_live_rsvp(
    v_event,
    jsonb_build_object('title', 'E3 Party Renamed'),
    'Just renaming the party');

  SELECT title, rsvp_contribution_enabled INTO v_title, v_enabled
    FROM public.events WHERE id = v_event;
  IF v_title <> 'E3 Party Renamed' THEN
    RAISE EXCEPTION 'E3 FAIL: title-only edit did not persist (got %)', v_title;
  END IF;
  IF v_enabled <> false THEN
    RAISE EXCEPTION 'E3 FAIL: chip-in config clobbered by an unrelated edit (expected off, got %)', v_enabled;
  END IF;
  RAISE NOTICE 'E3 PASS: unrelated edit on a can''t-collect chip-in-OFF RSVP succeeds + no clobber (conditional gate)';
END$$;
ROLLBACK;
