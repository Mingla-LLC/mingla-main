\set ON_ERROR_STOP on

-- Issue #3645 — implementor proof that an unpublished draft with nothing sold
-- follows its brand's currency (20270829003645). Run after the full migration
-- chain on PostgreSQL 17.
--
-- BEFORE. A draft's currency was stamped once. A brand that moved from pounds
-- to naira kept pound drafts, and Publish put the naira sign on the pound
-- numbers.
--
-- AFTER.
--   A. CHANGED currency (GBP to NGN), fired by service_role with no signed-in
--      user: the event, RSVP and trip drafts move to NGN in every copy, paid
--      prices are cleared, free stays free, a cleared trip package cannot be
--      published until the host enters a price, and then it publishes.
--      An experience draft and a draft that was once published are untouched.
--   B. FIRST currency (none to NGN), fired by the signed-in host: drafts are
--      stamped and every typed price is KEPT.
--
-- NULL-safety: every comparison whose left side can be NULL uses
-- `IS DISTINCT FROM`.

BEGIN;

SELECT set_config('request.jwt.claim.sub', '36450829-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

INSERT INTO auth.users(id) VALUES ('36450829-0000-4000-8000-000000000001');
INSERT INTO public.creator_accounts(id) VALUES ('36450829-0000-4000-8000-000000000001');

-- Brand A sells in pounds. Brand B has no currency yet. Neither has a bank.
INSERT INTO public.brands(id, account_id, name, slug, default_currency) VALUES
  ('36450829-0000-4000-8000-00000000000a', '36450829-0000-4000-8000-000000000001',
   'Issue 3645 pounds', 'issue-3645-currency-a', 'GBP'),
  ('36450829-0000-4000-8000-00000000000b', '36450829-0000-4000-8000-000000000001',
   'Issue 3645 no currency', 'issue-3645-currency-b', NULL);

CREATE FUNCTION pg_temp.iso(p timestamptz) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT to_char(p AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS".000Z"')
$$;

CREATE FUNCTION pg_temp.rev(p_event uuid) RETURNS timestamptz
LANGUAGE sql AS $$ SELECT updated_at FROM public.events WHERE id = p_event $$;

-- The ticket list the event wizard autosaves into theme.business_draft.
CREATE FUNCTION pg_temp.tickets(p_currency text) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_array(
    jsonb_build_object('id', 't_paid', 'name', 'General', 'priceGbp', 50, 'isFree', false,
      'capacity', 100, 'isUnlimited', false, 'displayOrder', 0)
      || CASE WHEN p_currency IS NULL THEN '{}'::jsonb
              ELSE jsonb_build_object('currency', p_currency) END,
    jsonb_build_object('id', 't_free', 'name', 'Community', 'priceGbp', NULL, 'isFree', true,
      'capacity', 20, 'isUnlimited', false, 'displayOrder', 1))
$$;

-- A draft row the way the wizards leave it. p_currency NULL = "Currency not set".
CREATE FUNCTION pg_temp.draft(
  p_id uuid, p_brand uuid, p_type text, p_currency text, p_draft jsonb,
  p_published_at timestamptz DEFAULT NULL)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status,
    visibility, timezone, currency, theme, published_at)
  VALUES (p_id, p_brand, '36450829-0000-4000-8000-000000000001', 'Issue 3645 ' || p_type,
    'draft-3645-currency-' || p_id, p_type, 'draft', 'draft', 'Europe/London', p_currency,
    jsonb_build_object('coverHue', 25, 'business_draft',
      p_draft || jsonb_build_object('clientRevision', 0)
        || CASE WHEN p_currency IS NULL THEN '{}'::jsonb
                ELSE jsonb_build_object('currency', p_currency) END),
    p_published_at)
$$;

-- A trip draft built through the real owners, with one priced package that has
-- a payment plan and one free package. Returns the event id.
CREATE FUNCTION pg_temp.trip(p_brand uuid, p_op text, p_placeholder_currency text)
RETURNS uuid LANGUAGE plpgsql AS $trip$
DECLARE
  g jsonb;
  v_event uuid;
  v_standard uuid;
BEGIN
  g := public.biz_create_trip_draft(p_brand, jsonb_build_object('title', 'Untitled trip'),
    (p_op || '1')::uuid);
  v_event := (g#>>'{event,id}')::uuid;
  v_standard := (g#>>'{tiers,0,ticket_type_id}')::uuid;
  IF v_event IS NULL OR v_standard IS NULL THEN
    RAISE EXCEPTION 'fixture: trip create returned no event or no package';
  END IF;
  -- A brand with no currency: older builds stamped a placeholder on the draft.
  IF p_placeholder_currency IS NOT NULL THEN
    UPDATE public.events SET currency = p_placeholder_currency WHERE id = v_event;
  END IF;
  PERFORM public.biz_apply_trip_draft_graph(
    v_event,
    jsonb_build_object(
      'event', jsonb_build_object(
        'title', 'Lagos long weekend',
        'business_trip', jsonb_build_object(
          'startAt', pg_temp.iso(date_trunc('second', now() + interval '60 days')),
          'endAt', pg_temp.iso(date_trunc('second', now() + interval '63 days')),
          'destinationLocationText', 'Lagos, Nigeria')),
      'days', jsonb_build_array(jsonb_build_object('ordinal', 1, 'title', 'Arrival'))),
    pg_temp.rev(v_event), (p_op || '2')::uuid);
  PERFORM public.biz_apply_trip_draft_graph(
    v_event,
    jsonb_build_object('tiers', jsonb_build_array(jsonb_build_object(
      'ticket_type_id', v_standard, 'tier_name', 'Standard', 'price_cents', 45000,
      'capacity', 12,
      'tier_metadata', jsonb_build_object(
        'description', 'Shared room',
        'installments', jsonb_build_object(
          'deposit_pct', 25,
          'installments', jsonb_build_array(jsonb_build_object(
            'ordinal', 1, 'pct', 75, 'days_after_booking', 30))))))),
    pg_temp.rev(v_event), (p_op || '3')::uuid);
  PERFORM public.biz_apply_trip_draft_graph(
    v_event,
    jsonb_build_object('tiers', jsonb_build_array(jsonb_build_object(
      'tier_name', 'Volunteer', 'price_cents', 0, 'capacity', 2, 'display_order', 1))),
    pg_temp.rev(v_event), (p_op || '4')::uuid);
  RETURN v_event;
END
$trip$;

CREATE TEMP TABLE issue_3645_ids(name text PRIMARY KEY, id uuid NOT NULL) ON COMMIT DROP;

-- ─── Fixtures ────────────────────────────────────────────────────────────────
DO $fixtures$
DECLARE
  v_a uuid := '36450829-0000-4000-8000-00000000000a';
  v_b uuid := '36450829-0000-4000-8000-00000000000b';
BEGIN
  -- Brand A, pounds.
  PERFORM pg_temp.draft('36450829-0000-4000-8000-0000000000a1', v_a, 'event', 'GBP',
    jsonb_build_object('tickets', pg_temp.tickets('GBP')));
  PERFORM pg_temp.draft('36450829-0000-4000-8000-0000000000a2', v_a, 'rsvp', 'GBP',
    jsonb_build_object('isRsvp', true, 'tickets', '[]'::jsonb,
      'rsvpContributionEnabled', true,
      'rsvpContributionSuggestedCents', 1500, 'rsvpContributionMinCents', 500));
  UPDATE public.events
     SET rsvp_contribution_enabled = true,
         rsvp_contribution_suggested_cents = 1500,
         rsvp_contribution_min_cents = 500
   WHERE id = '36450829-0000-4000-8000-0000000000a2';
  -- Left alone: an experience draft, and a draft that was published once.
  PERFORM pg_temp.draft('36450829-0000-4000-8000-0000000000a3', v_a, 'experience', 'GBP',
    '{}'::jsonb);
  PERFORM pg_temp.draft('36450829-0000-4000-8000-0000000000a4', v_a, 'event', 'GBP',
    jsonb_build_object('tickets', pg_temp.tickets('GBP')), now() - interval '2 days');
  INSERT INTO issue_3645_ids VALUES
    ('trip_a', pg_temp.trip(v_a, '36450829-0000-4000-8000-0000000001a', NULL));

  -- Brand B, no currency. Prices typed while the screen said "Currency not set".
  PERFORM pg_temp.draft('36450829-0000-4000-8000-0000000000b1', v_b, 'event', NULL,
    jsonb_build_object('tickets', pg_temp.tickets(NULL)));
  INSERT INTO issue_3645_ids VALUES
    ('trip_b', pg_temp.trip(v_b, '36450829-0000-4000-8000-0000000001b', 'USD'));

  -- F-01 the premise: the fixtures really are in the old state.
  IF (SELECT count(*) FROM public.ticket_types tt
       WHERE tt.event_id = (SELECT id FROM issue_3645_ids WHERE name = 'trip_a')
         AND tt.deleted_at IS NULL AND tt.currency = 'GBP' AND tt.price_cents IN (45000, 0)) <> 2 THEN
    RAISE EXCEPTION 'F-01 the pound trip fixture is not two pound packages';
  END IF;
  IF (SELECT count(*) FROM public.ticket_types tt
       WHERE tt.event_id = (SELECT id FROM issue_3645_ids WHERE name = 'trip_b')
         AND tt.deleted_at IS NULL AND tt.price_cents = 45000 AND tt.currency = 'USD') <> 1 THEN
    RAISE EXCEPTION 'F-02 the no-currency trip fixture has no priced placeholder package';
  END IF;
END
$fixtures$;

-- ─── A. CHANGED currency, fired by service_role with nobody signed in ────────
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SET LOCAL ROLE service_role;
UPDATE public.brands SET default_currency = 'NGN'
 WHERE id = '36450829-0000-4000-8000-00000000000a';
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '36450829-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

DO $changed$
DECLARE
  v_brand uuid := '36450829-0000-4000-8000-00000000000a';
  v_owner uuid := '36450829-0000-4000-8000-000000000001';
  v_event_id uuid := '36450829-0000-4000-8000-0000000000a1';
  v_rsvp_id uuid := '36450829-0000-4000-8000-0000000000a2';
  v_trip uuid;
  e record;
  v_paid jsonb;
  v_free jsonb;
  t record;
  v_meta jsonb;
  v_count integer;
  v_status text;
  v_result jsonb;
  v_refused boolean;
BEGIN
  SELECT id INTO v_trip FROM issue_3645_ids WHERE name = 'trip_a';

  -- A-01..A-06 the EVENT draft.
  SELECT * INTO e FROM public.events WHERE id = v_event_id;
  IF e.currency IS DISTINCT FROM 'NGN' THEN
    RAISE EXCEPTION 'A-01 the event draft row is still in %', e.currency;
  END IF;
  IF e.theme#>>'{business_draft,currency}' IS DISTINCT FROM 'NGN' THEN
    RAISE EXCEPTION 'A-02 the event draft JSON currency is still %', e.theme#>>'{business_draft,currency}';
  END IF;
  v_paid := e.theme#>'{business_draft,tickets,0}';
  v_free := e.theme#>'{business_draft,tickets,1}';
  IF v_paid->>'id' IS DISTINCT FROM 't_paid' OR v_free->>'id' IS DISTINCT FROM 't_free' THEN
    RAISE EXCEPTION 'A-03 the ticket list was reordered or lost a ticket: %', e.theme#>'{business_draft,tickets}';
  END IF;
  IF jsonb_typeof(v_paid->'priceGbp') IS DISTINCT FROM 'null'
     OR (v_paid->'isFree') IS DISTINCT FROM 'false'::jsonb
     OR v_paid->>'currency' IS DISTINCT FROM 'NGN'
     OR v_paid->>'name' IS DISTINCT FROM 'General'
     OR (v_paid->>'capacity')::int IS DISTINCT FROM 100 THEN
    RAISE EXCEPTION 'A-04 the paid ticket is not "no price yet, not free, NGN, otherwise intact": %', v_paid;
  END IF;
  IF (v_free->'isFree') IS DISTINCT FROM 'true'::jsonb
     OR jsonb_typeof(v_free->'priceGbp') IS DISTINCT FROM 'null'
     OR v_free ? 'currency' THEN
    RAISE EXCEPTION 'A-05 the free ticket changed: %', v_free;
  END IF;
  IF e.theme#>'{business_draft,pricesClearedForCurrencyChange}'
       IS DISTINCT FROM jsonb_build_object('from', 'GBP', 'to', 'NGN') THEN
    RAISE EXCEPTION 'A-06 the event draft does not say why its price is empty: %',
      e.theme#>'{business_draft,pricesClearedForCurrencyChange}';
  END IF;
  IF (e.theme#>>'{business_draft,clientRevision}')::int IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'A-07 the draft revision moved; an open wizard would be refused its next save';
  END IF;

  -- A-10..A-12 the RSVP draft: amounts cleared in both copies, chip-ins still on.
  SELECT * INTO e FROM public.events WHERE id = v_rsvp_id;
  IF e.currency IS DISTINCT FROM 'NGN'
     OR e.theme#>>'{business_draft,currency}' IS DISTINCT FROM 'NGN' THEN
    RAISE EXCEPTION 'A-10 the RSVP draft is still in % / %', e.currency, e.theme#>>'{business_draft,currency}';
  END IF;
  IF e.rsvp_contribution_suggested_cents IS NOT NULL OR e.rsvp_contribution_min_cents IS NOT NULL
     OR jsonb_typeof(e.theme#>'{business_draft,rsvpContributionSuggestedCents}') IS DISTINCT FROM 'null'
     OR jsonb_typeof(e.theme#>'{business_draft,rsvpContributionMinCents}') IS DISTINCT FROM 'null' THEN
    RAISE EXCEPTION 'A-11 a pound chip-in amount was carried into naira: % / % / %',
      e.rsvp_contribution_suggested_cents, e.rsvp_contribution_min_cents, e.theme->'business_draft';
  END IF;
  IF e.rsvp_contribution_enabled IS DISTINCT FROM true
     OR (e.theme#>'{business_draft,rsvpContributionEnabled}') IS DISTINCT FROM 'true'::jsonb THEN
    RAISE EXCEPTION 'A-12 chip-ins were switched off by the currency change';
  END IF;

  -- A-20..A-25 the TRIP draft.
  SELECT currency INTO e FROM public.events WHERE id = v_trip;
  IF e.currency IS DISTINCT FROM 'NGN' THEN
    RAISE EXCEPTION 'A-20 the trip draft row is still in %', e.currency;
  END IF;
  SELECT tt.* INTO t FROM public.ticket_types tt
   WHERE tt.event_id = v_trip AND tt.name = 'Standard' AND tt.deleted_at IS NULL;
  IF t.currency IS DISTINCT FROM 'NGN' OR t.price_cents IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'A-21 the paid package is % % (expected NGN, price cleared)', t.currency, t.price_cents;
  END IF;
  IF t.is_free IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'A-22 a PAID package was turned into a FREE one';
  END IF;
  SELECT tpt.tier_metadata INTO v_meta FROM public.trip_pricing_tiers tpt
   WHERE tpt.ticket_type_id = t.id;
  IF v_meta->'price_cleared_for_currency_change'
       IS DISTINCT FROM jsonb_build_object('from', 'GBP', 'to', 'NGN') THEN
    RAISE EXCEPTION 'A-23 the cleared package carries no marker: %', v_meta;
  END IF;
  IF v_meta->>'description' IS DISTINCT FROM 'Shared room'
     OR (v_meta#>>'{installments,deposit_pct}')::numeric IS DISTINCT FROM 25 THEN
    RAISE EXCEPTION 'A-24 the package lost its description or payment plan: %', v_meta;
  END IF;
  SELECT count(*) INTO v_count
    FROM public.ticket_types tt
    JOIN public.trip_pricing_tiers tpt ON tpt.ticket_type_id = tt.id
   WHERE tt.event_id = v_trip AND tt.name = 'Volunteer' AND tt.deleted_at IS NULL
     AND tt.price_cents = 0 AND tt.is_free = true AND tt.currency = 'NGN'
     AND NOT (tpt.tier_metadata ? 'price_cleared_for_currency_change');
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'A-25 the free package is no longer a plain free NGN package';
  END IF;

  -- A-30 left alone: the experience draft and the once-published draft.
  SELECT count(*) INTO v_count FROM public.events
   WHERE id IN ('36450829-0000-4000-8000-0000000000a3', '36450829-0000-4000-8000-0000000000a4')
     AND currency = 'GBP' AND theme#>>'{business_draft,currency}' = 'GBP';
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'A-30 an experience draft or a once-published draft was moved (% of 2 untouched)', v_count;
  END IF;
  IF (SELECT theme#>>'{business_draft,tickets,0,priceGbp}' FROM public.events
       WHERE id = '36450829-0000-4000-8000-0000000000a4') IS DISTINCT FROM '50' THEN
    RAISE EXCEPTION 'A-31 a once-published draft lost its price';
  END IF;

  -- A-40 PUBLISH IS REFUSED for the cleared trip, and nothing moves. The brand
  -- is made able to collect first, so the only thing left to refuse is the price.
  RESET ROLE;
  UPDATE public.brands SET paystack_subaccount_code = 'ACCT_issue3645_currency' WHERE id = v_brand;
  UPDATE public.brand_team_members
     SET mingla_tos_version_accepted = '1.0', mingla_tos_accepted_at = now()
   WHERE brand_id = v_brand AND user_id = v_owner;
  IF NOT FOUND THEN RAISE EXCEPTION 'A-39 fixture: the owner has no team row to accept the terms on'; END IF;
  IF (SELECT default_currency FROM public.brands WHERE id = v_brand) IS DISTINCT FROM 'NGN' THEN
    RAISE EXCEPTION 'A-39 fixture: connecting the payment account moved the brand currency';
  END IF;

  v_refused := false;
  BEGIN
    v_result := public.biz_publish_trip_command(
      v_trip, pg_temp.rev(v_trip), '36450829-0000-4000-8000-0000000002a1');
  EXCEPTION WHEN sqlstate 'P0001' THEN
    IF SQLERRM <> 'price_reentry_required' THEN
      RAISE EXCEPTION 'A-40 publish was refused with %, expected price_reentry_required', SQLERRM;
    END IF;
    v_refused := true;
  END;
  IF NOT v_refused THEN
    RAISE EXCEPTION 'A-41 a trip whose price was cleared went on sale as free: %', left(v_result::text, 160);
  END IF;
  SELECT status INTO v_status FROM public.events WHERE id = v_trip;
  IF v_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'A-42 a refused publish moved the trip to %', v_status;
  END IF;

  -- A-50 the host enters a naira price the way the wizard saves it (it merges
  -- into tier_metadata, so the marker rides along), and the SAME draft publishes.
  PERFORM public.biz_apply_trip_draft_graph(
    v_trip,
    jsonb_build_object('tiers', jsonb_build_array(jsonb_build_object(
      'ticket_type_id', t.id, 'tier_name', 'Standard', 'price_cents', 9000000,
      'capacity', 12, 'tier_metadata', v_meta))),
    pg_temp.rev(v_trip), '36450829-0000-4000-8000-0000000002a2');
  v_result := public.biz_publish_trip_command(
    v_trip, pg_temp.rev(v_trip), '36450829-0000-4000-8000-0000000002a3');
  SELECT status INTO v_status FROM public.events WHERE id = v_trip;
  IF v_status IS NULL OR v_status NOT IN ('scheduled', 'live') THEN
    RAISE EXCEPTION 'A-50 the re-priced trip did not publish, status=% result=%', v_status, v_result;
  END IF;
  SELECT count(*) INTO v_count FROM public.ticket_types tt
   WHERE tt.event_id = v_trip AND tt.deleted_at IS NULL AND tt.currency = 'NGN'
     AND ((tt.name = 'Standard' AND tt.price_cents = 9000000 AND tt.is_free = false)
       OR (tt.name = 'Volunteer' AND tt.price_cents = 0 AND tt.is_free = true));
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'A-51 the published trip does not carry the naira price and the free package (% of 2)', v_count;
  END IF;
END
$changed$;

-- ─── B. FIRST currency, fired by the signed-in host ──────────────────────────
UPDATE public.brands SET default_currency = 'NGN'
 WHERE id = '36450829-0000-4000-8000-00000000000b';

DO $first$
DECLARE
  v_trip uuid;
  e record;
  v_paid jsonb;
  v_meta jsonb;
  t record;
  v_count integer;
BEGIN
  SELECT id INTO v_trip FROM issue_3645_ids WHERE name = 'trip_b';

  -- B-01..B-03 the event draft is stamped and KEEPS the typed price.
  SELECT * INTO e FROM public.events WHERE id = '36450829-0000-4000-8000-0000000000b1';
  IF e.currency IS DISTINCT FROM 'NGN'
     OR e.theme#>>'{business_draft,currency}' IS DISTINCT FROM 'NGN' THEN
    RAISE EXCEPTION 'B-01 the event draft did not take the brand''s first currency: % / %',
      e.currency, e.theme#>>'{business_draft,currency}';
  END IF;
  v_paid := e.theme#>'{business_draft,tickets,0}';
  IF (v_paid->>'priceGbp')::numeric IS DISTINCT FROM 50
     OR (v_paid->'isFree') IS DISTINCT FROM 'false'::jsonb THEN
    RAISE EXCEPTION 'B-02 a price typed before the brand had a currency was cleared: %', v_paid;
  END IF;
  IF (e.theme->'business_draft') ? 'pricesClearedForCurrencyChange' THEN
    RAISE EXCEPTION 'B-03 the draft claims its prices were cleared; nothing was';
  END IF;

  -- B-10..B-12 the trip draft: placeholder currency replaced, price kept.
  SELECT currency INTO e FROM public.events WHERE id = v_trip;
  IF e.currency IS DISTINCT FROM 'NGN' THEN
    RAISE EXCEPTION 'B-10 the trip draft kept its placeholder currency %', e.currency;
  END IF;
  SELECT tt.* INTO t FROM public.ticket_types tt
   WHERE tt.event_id = v_trip AND tt.name = 'Standard' AND tt.deleted_at IS NULL;
  IF t.currency IS DISTINCT FROM 'NGN' OR t.price_cents IS DISTINCT FROM 45000
     OR t.is_free IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'B-11 the priced package is % % free=% (expected NGN 45000, not free)',
      t.currency, t.price_cents, t.is_free;
  END IF;
  SELECT tpt.tier_metadata INTO v_meta FROM public.trip_pricing_tiers tpt
   WHERE tpt.ticket_type_id = t.id;
  IF v_meta ? 'price_cleared_for_currency_change' THEN
    RAISE EXCEPTION 'B-12 a kept price was marked as cleared: %', v_meta;
  END IF;
  SELECT count(*) INTO v_count FROM public.ticket_types tt
   WHERE tt.event_id = v_trip AND tt.deleted_at IS NULL AND tt.currency IS DISTINCT FROM 'NGN';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'B-13 % package(s) of the trip draft are not in NGN', v_count;
  END IF;
END
$first$;

ROLLBACK;
