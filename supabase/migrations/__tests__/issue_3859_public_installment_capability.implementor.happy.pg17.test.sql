\set ON_ERROR_STOP on

-- Issue #3859 rolling-compatibility proof. The saved Host schedule survives,
-- while the canonical buyer payload exposes only a boolean capability and masks
-- the schedule whenever that capability is unavailable.

BEGIN;

DO $test$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_ticket uuid := gen_random_uuid();
  v_brand_slug text := 'issue-3859-capability-' || v_brand;
  v_trip_slug text := 'issue-3859-capability-' || v_event;
  v_payload jsonb;
  v_tier jsonb;
  v_stored jsonb;
BEGIN
  INSERT INTO auth.users(id, email)
  VALUES (v_owner, 'issue-3859-capability-' || v_owner || '@example.test');
  INSERT INTO public.creator_accounts(id, email)
  VALUES (v_owner, 'issue-3859-capability-' || v_owner || '@example.test');
  INSERT INTO public.brands(
    id, account_id, name, slug, default_currency,
    payment_provider, payment_country, pricing_region, pricing_currency
  ) VALUES (
    v_brand, v_owner, 'Issue 3859 capability', v_brand_slug, 'USD',
    'stripe', 'US', 'US', 'USD'
  );
  INSERT INTO public.stripe_connect_accounts(
    brand_id, stripe_account_id, charges_enabled, payouts_enabled,
    country, default_currency
  ) VALUES (
    v_brand, 'acct_issue3859_' || replace(v_brand::text, '-', ''), true, true,
    'US', 'usd'
  );
  INSERT INTO public.events(
    id, brand_id, created_by, title, slug, event_type, status, visibility,
    timezone, currency
  ) VALUES (
    v_event, v_brand, v_owner, 'Issue 3859 trip', v_trip_slug, 'trip',
    'draft', 'public', 'UTC', 'USD'
  );
  INSERT INTO public.event_dates(
    event_id, start_at, end_at, timezone, is_master
  ) VALUES (
    v_event, '2030-01-10T10:00:00Z', '2030-01-12T18:00:00Z', 'UTC', true
  );
  INSERT INTO public.ticket_types(
    id, event_id, name, price_cents, currency, is_free, quantity_total,
    min_purchase_qty, available_online, available_in_person
  ) VALUES (
    v_ticket, v_event, 'Standard', 100000, 'USD', false, 20, 1, true, false
  );
  INSERT INTO public.trip_pricing_tiers(
    event_id, ticket_type_id, tier_name, tier_metadata
  ) VALUES (
    v_event, v_ticket, 'Standard', jsonb_build_object(
      'installments', jsonb_build_object(
        'deposit_pct', 25,
        'installments', jsonb_build_array(
          jsonb_build_object(
            'ordinal', 1,
            'pct', 75,
            'days_after_booking', 30
          )
        )
      )
    )
  );
  UPDATE public.events SET status = 'scheduled' WHERE id = v_event;

  v_payload := public.pg_public_trip_by_slug(v_brand_slug, v_trip_slug)::jsonb;
  v_tier := v_payload -> 'tiers' -> 0;
  IF v_payload -> 'installmentCapabilityAvailable' IS DISTINCT FROM 'true'::jsonb
     OR v_tier -> 'installments' IS NULL
     OR NOT ((v_tier -> 'tierMetadata') ? 'installments') THEN
    RAISE EXCEPTION 'supported public capability/schedule mismatch: %', v_payload;
  END IF;

  UPDATE public.brands SET payment_provider = 'paystack' WHERE id = v_brand;
  v_payload := public.pg_public_trip_by_slug(v_brand_slug, v_trip_slug)::jsonb;
  v_tier := v_payload -> 'tiers' -> 0;
  SELECT tier_metadata -> 'installments' INTO v_stored
    FROM public.trip_pricing_tiers WHERE event_id = v_event;
  IF v_payload -> 'installmentCapabilityAvailable' IS DISTINCT FROM 'false'::jsonb
     OR v_tier -> 'installments' <> 'null'::jsonb
     OR (v_tier -> 'tierMetadata') ? 'installments'
     OR v_stored IS NULL THEN
    RAISE EXCEPTION 'unsupported public capability did not fail closed: %', v_payload;
  END IF;

  RAISE NOTICE 'PASS: explicit supported capability preserves the plan; refusal masks it without deleting Host data';
END
$test$;

ROLLBACK;

SELECT 'issue_3859_public_installment_capability: PASS' AS result;
