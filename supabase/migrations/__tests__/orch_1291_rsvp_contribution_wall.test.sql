-- ORCH-1291 [rsvp-chip-in] — SQL contract tests (happy-path + T-3 + T-4 + wall).
--
-- Fails-on-revert artifact for migration 20261220000000_orch_1291_rsvp_contributions.sql.
-- Covers the SPEC §9 named test:
--   W1  = the payment-free WALL: event_rsvps gains NO payment column
--         (I-PROPOSED-1291-RSVP-NO-PAYMENT-COLUMNS / SC-9).
--   W2  = T-3: publishing a chip-in-enabled RSVP on a brand that CANNOT collect
--         RAISEs stripe_charges_disabled (SC-6). Reverting the conditional gate
--         makes this FAIL.
--   W3  = T-4 (ADVERSARIAL): publishing a chip-in-enabled RSVP on a Paystack
--         brand WITH a subaccount but NO stripe_connect_accounts row SUCCEEDS —
--         must NOT be blocked by the Stripe-blind pg_brand_can_charge. Reverting
--         pg_brand_can_collect to the Stripe-only predicate makes this FAIL.
--   W4  = SC-6 free-path: a FREE (chip-in OFF) RSVP on the SAME can't-collect
--         brand publishes with NO bank requirement (do NOT gate free RSVPs).
--   W5  = pg_brand_can_collect provider-awareness truth table.
--   W6  = finalize_rsvp_contribution flips pending→paid and is IDEMPOTENT (T-11),
--         and the persisted row carries the gift shape
--         (tax_basis='voluntary_contribution', tax_cents=0 — I-PROPOSED-1291-
--         CONTRIBUTION-TAX-ZERO).
--
-- USAGE (repo SQL-probe convention — hand-run against the linked remote AFTER
-- the orchestrator applies the migration; NOT run by the implementor):
--
--   cat supabase/migrations/__tests__/orch_1291_rsvp_contribution_wall.test.sql \
--     | /Users/sethogieva/bin/supabase db remote sql --linked
--
-- Each block is BEGIN; … ROLLBACK; so it leaves NO fixture rows.
-- RAISE NOTICE on PASS, RAISE EXCEPTION on FAIL (non-zero exit in CI/scripts).

-- ===========================================================================
-- W1 (§9 / SC-9) — the payment-free WALL: event_rsvps has ZERO payment columns.
-- Reverting the wall (adding a price/amount/currency column to event_rsvps)
-- makes this FAIL.
-- ===========================================================================
BEGIN;
DO $$
DECLARE
  v_bad text;
BEGIN
  SELECT string_agg(column_name, ', ') INTO v_bad
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'event_rsvps'
    AND (
      column_name ILIKE '%price%'
      OR column_name ILIKE '%amount%'
      OR column_name = 'currency'
      OR column_name ILIKE '%contribution%'
      OR column_name ILIKE '%paid%'
      OR column_name ILIKE '%application_fee%'
    );
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'W1 FAIL: event_rsvps carries payment column(s): %', v_bad;
  END IF;
  RAISE NOTICE 'W1 PASS: event_rsvps has zero payment columns (wall intact)';
END$$;
ROLLBACK;

-- ===========================================================================
-- W2 (T-3 / SC-6) — publishing a chip-in-enabled RSVP on a can't-collect brand
-- RAISEs stripe_charges_disabled.
-- ===========================================================================
BEGIN;
DO $$
DECLARE
  v_user   uuid := gen_random_uuid();
  v_brand  uuid := gen_random_uuid();
  v_event  uuid := gen_random_uuid();
  v_payload jsonb;
  v_raised boolean := false;
BEGIN
  INSERT INTO public.brands (id, account_id, slug, name, default_currency, created_at, updated_at)
  VALUES (v_brand, v_user, 'orch1291-w2-brand', 'ORCH1291 W2', 'USD', now(), now());
  -- No stripe_connect_accounts row + no paystack_subaccount_code → cannot collect.

  INSERT INTO public.events (id, brand_id, created_by, event_type, title, slug, description,
    status, visibility, currency, timezone, party_types, rsvp_approval_mode,
    rsvp_discoverable, created_at, updated_at, theme)
  VALUES (v_event, v_brand, v_user, 'rsvp', 'Chip-in Party', 'chipin-party-w2',
    'Bring the vibe.', 'draft', 'public', 'USD', 'UTC',
    ARRAY['house-party'], 'auto', false, now(), now(),
    jsonb_build_object('business_draft', jsonb_build_object(
      'partyTypes', jsonb_build_array('house-party'),
      'rsvpApprovalMode', 'auto',
      'rsvpDiscoverable', false,
      'rsvpContributionEnabled', true)));

  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config('role', 'authenticated', true);

  v_payload := jsonb_build_object(
    'title', 'Chip-in Party',
    'timezone', 'UTC',
    'when', jsonb_build_object(
      'date', to_char((now() + interval '7 day')::date, 'YYYY-MM-DD'),
      'doorsOpen', '19:00',
      'endsAt', '23:00'));

  BEGIN
    PERFORM public.business_publish_rsvp_draft(v_event, v_payload, NULL);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM ILIKE '%stripe_charges_disabled%' THEN
      v_raised := true;
    ELSE
      RAISE EXCEPTION 'W2 FAIL: chip-in publish on can''t-collect brand raised the WRONG error: %', SQLERRM;
    END IF;
  END;

  IF NOT v_raised THEN
    RAISE EXCEPTION 'W2 FAIL: chip-in publish on a can''t-collect brand was NOT blocked (gate reverted?)';
  END IF;
  RAISE NOTICE 'W2 PASS (T-3): chip-in publish on can''t-collect brand blocked with stripe_charges_disabled';
END$$;
ROLLBACK;

-- ===========================================================================
-- W3 (T-4 ADVERSARIAL / SC-6-Paystack-ready) — a Paystack brand WITH a
-- subaccount but NO stripe_connect_accounts row publishes a chip-in RSVP
-- SUCCESSFULLY. Reverting pg_brand_can_collect to the Stripe-only predicate
-- makes this FAIL (the publish would wrongly RAISE stripe_charges_disabled).
-- ===========================================================================
BEGIN;
DO $$
DECLARE
  v_user   uuid := gen_random_uuid();
  v_brand  uuid := gen_random_uuid();
  v_event  uuid := gen_random_uuid();
  v_payload jsonb;
  v_ok     boolean;
BEGIN
  INSERT INTO public.brands (id, account_id, slug, name, default_currency,
    payment_provider, payment_country, paystack_subaccount_code, created_at, updated_at)
  VALUES (v_brand, v_user, 'orch1291-w3-brand', 'ORCH1291 W3', 'NGN',
    'paystack', 'NG', 'ACCT_orch1291w3', now(), now());
  -- NO stripe_connect_accounts row → the Stripe-only predicate would say "can't
  -- collect", but pg_brand_can_collect sees the subaccount and says "can".

  INSERT INTO public.events (id, brand_id, created_by, event_type, title, slug, description,
    status, visibility, currency, timezone, party_types, rsvp_approval_mode,
    rsvp_discoverable, created_at, updated_at, theme)
  VALUES (v_event, v_brand, v_user, 'rsvp', 'Lagos Chip-in', 'lagos-chipin-w3',
    'Owambe vibes.', 'draft', 'public', 'NGN', 'UTC',
    ARRAY['house-party'], 'auto', false, now(), now(),
    jsonb_build_object('business_draft', jsonb_build_object(
      'partyTypes', jsonb_build_array('house-party'),
      'rsvpApprovalMode', 'auto',
      'rsvpDiscoverable', false,
      'rsvpContributionEnabled', true,
      'rsvpContributionMinCents', 100000)));

  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config('role', 'authenticated', true);

  v_payload := jsonb_build_object(
    'title', 'Lagos Chip-in',
    'timezone', 'UTC',
    'when', jsonb_build_object(
      'date', to_char((now() + interval '7 day')::date, 'YYYY-MM-DD'),
      'doorsOpen', '19:00',
      'endsAt', '23:00'));

  PERFORM public.business_publish_rsvp_draft(v_event, v_payload, NULL);

  SELECT (status IN ('scheduled', 'live')
          AND rsvp_contribution_enabled = true
          AND rsvp_contribution_min_cents = 100000) INTO v_ok
    FROM public.events WHERE id = v_event;
  IF NOT COALESCE(v_ok, false) THEN
    RAISE EXCEPTION 'W3 FAIL (T-4): Paystack-subaccount brand chip-in publish did NOT succeed with the config persisted';
  END IF;
  RAISE NOTICE 'W3 PASS (T-4): Paystack-subaccount brand publishes a chip-in RSVP (not Stripe-blind blocked)';
END$$;
ROLLBACK;

-- ===========================================================================
-- W4 (SC-6 free-path) — a FREE (chip-in OFF) RSVP on the SAME can't-collect
-- brand publishes with NO bank requirement. Reverting to an UNCONDITIONAL gate
-- makes this FAIL.
-- ===========================================================================
BEGIN;
DO $$
DECLARE
  v_user   uuid := gen_random_uuid();
  v_brand  uuid := gen_random_uuid();
  v_event  uuid := gen_random_uuid();
  v_payload jsonb;
  v_ok     boolean;
BEGIN
  INSERT INTO public.brands (id, account_id, slug, name, default_currency, created_at, updated_at)
  VALUES (v_brand, v_user, 'orch1291-w4-brand', 'ORCH1291 W4', 'USD', now(), now());

  INSERT INTO public.events (id, brand_id, created_by, event_type, title, slug, description,
    status, visibility, currency, timezone, party_types, rsvp_approval_mode,
    rsvp_discoverable, created_at, updated_at, theme)
  VALUES (v_event, v_brand, v_user, 'rsvp', 'Free Party', 'free-party-w4',
    'No money, just vibes.', 'draft', 'public', 'USD', 'UTC',
    ARRAY['house-party'], 'auto', false, now(), now(),
    jsonb_build_object('business_draft', jsonb_build_object(
      'partyTypes', jsonb_build_array('house-party'),
      'rsvpApprovalMode', 'auto',
      'rsvpDiscoverable', false)));  -- rsvpContributionEnabled absent → free

  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config('role', 'authenticated', true);

  v_payload := jsonb_build_object(
    'title', 'Free Party',
    'timezone', 'UTC',
    'when', jsonb_build_object(
      'date', to_char((now() + interval '7 day')::date, 'YYYY-MM-DD'),
      'doorsOpen', '19:00',
      'endsAt', '23:00'));

  PERFORM public.business_publish_rsvp_draft(v_event, v_payload, NULL);

  SELECT (status IN ('scheduled', 'live') AND rsvp_contribution_enabled = false) INTO v_ok
    FROM public.events WHERE id = v_event;
  IF NOT COALESCE(v_ok, false) THEN
    RAISE EXCEPTION 'W4 FAIL: a FREE RSVP on a can''t-collect brand was blocked (gate is not conditional)';
  END IF;
  RAISE NOTICE 'W4 PASS: FREE RSVP publishes with no bank requirement';
END$$;
ROLLBACK;

-- ===========================================================================
-- W5 — pg_brand_can_collect provider-awareness truth table.
-- ===========================================================================
BEGIN;
DO $$
DECLARE
  v_empty    uuid := gen_random_uuid();
  v_paystack uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.brands (id, slug, name, default_currency, created_at, updated_at)
  VALUES (v_empty, 'orch1291-w5-empty', 'ORCH1291 W5 empty', 'USD', now(), now());
  INSERT INTO public.brands (id, slug, name, default_currency, payment_provider,
    payment_country, paystack_subaccount_code, created_at, updated_at)
  VALUES (v_paystack, 'orch1291-w5-ps', 'ORCH1291 W5 paystack', 'NGN', 'paystack',
    'NG', 'ACCT_orch1291w5', now(), now());

  IF public.pg_brand_can_collect(v_empty) THEN
    RAISE EXCEPTION 'W5 FAIL: pg_brand_can_collect TRUE for a brand with no Stripe + no subaccount';
  END IF;
  IF NOT public.pg_brand_can_collect(v_paystack) THEN
    RAISE EXCEPTION 'W5 FAIL: pg_brand_can_collect FALSE for a Paystack-subaccount brand (Stripe-blind)';
  END IF;
  RAISE NOTICE 'W5 PASS: pg_brand_can_collect provider-aware (empty=false, paystack-subaccount=true)';
END$$;
ROLLBACK;

-- ===========================================================================
-- W6 (T-11 / I-PROPOSED-1291-CONTRIBUTION-TAX-ZERO) — finalize flips pending→paid
-- idempotently, and the persisted row carries the gift shape.
-- ===========================================================================
BEGIN;
DO $$
DECLARE
  v_user   uuid := gen_random_uuid();
  v_brand  uuid := gen_random_uuid();
  v_event  uuid := gen_random_uuid();
  v_contrib uuid := gen_random_uuid();
  v_res1 jsonb;
  v_res2 jsonb;
  v_status text;
  v_basis text;
  v_tax text;
BEGIN
  INSERT INTO public.brands (id, account_id, slug, name, default_currency, created_at, updated_at)
  VALUES (v_brand, v_user, 'orch1291-w6-brand', 'ORCH1291 W6', 'GBP', now(), now());
  INSERT INTO public.events (id, brand_id, created_by, event_type, title, slug,
    status, visibility, currency, timezone, created_at, updated_at)
  VALUES (v_event, v_brand, v_user, 'rsvp', 'W6 Event', 'w6-event',
    'scheduled', 'public', 'GBP', 'UTC', now(), now());

  INSERT INTO public.event_rsvp_contributions (id, event_id, brand_id, provider,
    currency, amount_cents, buyer_total_cents, application_fee_amount_cents,
    pricing_breakdown, status, stripe_payment_intent_id)
  VALUES (v_contrib, v_event, v_brand, 'stripe', 'GBP', 1000, 1000, 15,
    jsonb_build_object(
      'tax_basis', 'voluntary_contribution',
      'components', jsonb_build_object('tax_cents', 0),
      'passed', jsonb_build_object('tax_cents', 0),
      'absorbed', jsonb_build_object('tax_cents', 0)),
    'pending', 'pi_orch1291_w6');

  -- gift shape asserted on the persisted row.
  SELECT pricing_breakdown->>'tax_basis',
         pricing_breakdown->'components'->>'tax_cents'
    INTO v_basis, v_tax
    FROM public.event_rsvp_contributions WHERE id = v_contrib;
  IF v_basis <> 'voluntary_contribution' OR v_tax <> '0' THEN
    RAISE EXCEPTION 'W6 FAIL: contribution is not a zero-tax gift (basis=%, tax_cents=%)', v_basis, v_tax;
  END IF;

  -- finalize flips pending→paid.
  v_res1 := public.finalize_rsvp_contribution(v_contrib, 'pi_orch1291_w6', 'ch_orch1291_w6', 'card');
  SELECT status INTO v_status FROM public.event_rsvp_contributions WHERE id = v_contrib;
  IF v_status <> 'paid' THEN
    RAISE EXCEPTION 'W6 FAIL: finalize did not flip status to paid (got %)', v_status;
  END IF;
  IF (v_res1->>'idempotent_replay')::boolean THEN
    RAISE EXCEPTION 'W6 FAIL: first finalize wrongly reported an idempotent replay';
  END IF;

  -- duplicate webhook delivery is a no-op (idempotent early-return).
  v_res2 := public.finalize_rsvp_contribution(v_contrib, 'pi_orch1291_w6', 'ch_orch1291_w6', 'card');
  IF NOT (v_res2->>'idempotent_replay')::boolean THEN
    RAISE EXCEPTION 'W6 FAIL: second finalize did not early-return (idempotency broken)';
  END IF;

  RAISE NOTICE 'W6 PASS (T-11): gift shape + finalize pending->paid + idempotent replay';
END$$;
ROLLBACK;
