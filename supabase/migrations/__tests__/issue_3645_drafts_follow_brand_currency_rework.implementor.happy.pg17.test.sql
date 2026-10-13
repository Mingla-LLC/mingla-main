\set ON_ERROR_STOP on

-- Issue #3645 — rework proof for migration 20270829003645: a currency change
-- made in TWO writes, and drafts whose copies disagree. Run after the full
-- migration chain on PostgreSQL 17.
--
-- BEFORE THE REWORK. The payout-country picker leaves Nigeria in two writes
-- (currency to NULL, then the new currency). The trigger judged each write on
-- its own, took the second for a brand's FIRST currency and only stamped: a
-- naira price was kept as dollars.
--
-- AFTER. A brand's outgoing currency is remembered when it is cleared
-- (public.brand_cleared_currency) and read back by the next write.
--   R1  NGN -> NULL -> USD clears event, RSVP and trip prices and leaves the
--       note; the write to NULL itself touches no draft.
--   R2  NULL -> NGN on a brand that NEVER had a currency keeps typed prices,
--       also on a trip that carries an old placeholder currency.
--   R3  NGN -> NULL -> NGN (the host changed their mind) keeps every price.
--   R4  GBP -> NGN directly still clears; a draft of that brand with no
--       currency of its own is stamped and keeps its typed price.
--   R5  A row already in the new currency whose JSON copy is not: the copies
--       are aligned and the old-currency price is cleared.
--   R6  No client role can read or write the remembered currency.
--
-- NULL-safety: comparisons whose left side can be NULL use IS DISTINCT FROM.

BEGIN;

SELECT set_config('request.jwt.claim.sub', '36450830-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

INSERT INTO auth.users(id) VALUES ('36450830-0000-4000-8000-000000000001');
INSERT INTO public.creator_accounts(id) VALUES ('36450830-0000-4000-8000-000000000001');

-- a: naira, leaves Nigeria for dollars in two writes.   b: never had a currency.
-- c: naira, cleared, back to naira.                     d: pounds, straight to naira.
INSERT INTO public.brands(id, account_id, name, slug, default_currency) VALUES
  ('36450830-0000-4000-8000-00000000000a', '36450830-0000-4000-8000-000000000001', 'R3645 a', 'r3645-currency-a', 'NGN'),
  ('36450830-0000-4000-8000-00000000000b', '36450830-0000-4000-8000-000000000001', 'R3645 b', 'r3645-currency-b', NULL),
  ('36450830-0000-4000-8000-00000000000c', '36450830-0000-4000-8000-000000000001', 'R3645 c', 'r3645-currency-c', 'NGN'),
  ('36450830-0000-4000-8000-00000000000d', '36450830-0000-4000-8000-000000000001', 'R3645 d', 'r3645-currency-d', 'GBP');

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
  VALUES (p_id, p_brand, '36450830-0000-4000-8000-000000000001', 'Issue 3645 ' || p_type,
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

CREATE TEMP TABLE r3645_ids(name text PRIMARY KEY, id uuid NOT NULL) ON COMMIT DROP;
CREATE TEMP TABLE r3645_before(id uuid PRIMARY KEY, currency text, theme jsonb, updated_at timestamptz)
  ON COMMIT DROP;

DO $fixtures$
DECLARE
  v_a uuid := '36450830-0000-4000-8000-00000000000a';
  v_b uuid := '36450830-0000-4000-8000-00000000000b';
  v_c uuid := '36450830-0000-4000-8000-00000000000c';
  v_d uuid := '36450830-0000-4000-8000-00000000000d';
  v_rsvp jsonb := jsonb_build_object('isRsvp', true, 'tickets', '[]'::jsonb,
    'rsvpContributionEnabled', true,
    'rsvpContributionSuggestedCents', 150000, 'rsvpContributionMinCents', 50000);
BEGIN
  -- a: an event, an RSVP and a trip, all priced in naira.
  PERFORM pg_temp.draft('36450830-0000-4000-8000-0000000000a1', v_a, 'event', 'NGN',
    jsonb_build_object('tickets', pg_temp.tickets('NGN')));
  PERFORM pg_temp.draft('36450830-0000-4000-8000-0000000000a2', v_a, 'rsvp', 'NGN', v_rsvp);
  UPDATE public.events
     SET rsvp_contribution_enabled = true, rsvp_contribution_suggested_cents = 150000,
         rsvp_contribution_min_cents = 50000
   WHERE id = '36450830-0000-4000-8000-0000000000a2';
  INSERT INTO r3645_ids VALUES ('trip_a', pg_temp.trip(v_a, '36450830-0000-4000-8000-0000000001a', NULL));

  -- b: typed while the screen said "Currency not set"; the trip carries an old
  -- placeholder currency.
  PERFORM pg_temp.draft('36450830-0000-4000-8000-0000000000b1', v_b, 'event', NULL,
    jsonb_build_object('tickets', pg_temp.tickets(NULL)));
  INSERT INTO r3645_ids VALUES ('trip_b', pg_temp.trip(v_b, '36450830-0000-4000-8000-0000000001b', 'USD'));

  -- c: priced in naira; the host will leave Nigeria and come back.
  PERFORM pg_temp.draft('36450830-0000-4000-8000-0000000000c1', v_c, 'event', 'NGN',
    jsonb_build_object('tickets', pg_temp.tickets('NGN')));
  INSERT INTO r3645_ids VALUES ('trip_c', pg_temp.trip(v_c, '36450830-0000-4000-8000-0000000001c', NULL));

  -- d: one pound draft, one draft with no currency of its own, and one whose
  -- row was already moved to naira while its JSON copy still says pounds.
  PERFORM pg_temp.draft('36450830-0000-4000-8000-0000000000d1', v_d, 'event', 'GBP',
    jsonb_build_object('tickets', pg_temp.tickets('GBP')));
  PERFORM pg_temp.draft('36450830-0000-4000-8000-0000000000d2', v_d, 'event', NULL,
    jsonb_build_object('tickets', pg_temp.tickets(NULL)));
  PERFORM pg_temp.draft('36450830-0000-4000-8000-0000000000d3', v_d, 'event', 'GBP',
    jsonb_build_object('tickets', pg_temp.tickets('GBP')));
  UPDATE public.events SET currency = 'NGN' WHERE id = '36450830-0000-4000-8000-0000000000d3';

  INSERT INTO r3645_before
  SELECT e.id, e.currency::text, e.theme, e.updated_at FROM public.events e
   WHERE e.brand_id IN (v_a, v_c);
END
$fixtures$;

-- ─── R1 first write: the brand loses its currency (clear_provider) ───────────
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SET LOCAL ROLE service_role;
UPDATE public.brands SET default_currency = NULL
 WHERE id IN ('36450830-0000-4000-8000-00000000000a', '36450830-0000-4000-8000-00000000000c');
RESET ROLE;

DO $cleared$
DECLARE
  v_count integer;
BEGIN
  -- R1-01 nothing moved: every draft of both brands is byte-for-byte the same.
  SELECT count(*) INTO v_count
    FROM r3645_before b JOIN public.events e ON e.id = b.id
   WHERE e.currency::text IS NOT DISTINCT FROM b.currency
     AND e.theme IS NOT DISTINCT FROM b.theme
     AND e.updated_at IS NOT DISTINCT FROM b.updated_at;
  IF v_count <> 5 THEN
    RAISE EXCEPTION 'R1-01 a brand losing its currency changed % of its 5 drafts', 5 - v_count;
  END IF;
  SELECT count(*) INTO v_count FROM public.ticket_types tt
   WHERE tt.event_id IN (SELECT id FROM r3645_ids WHERE name IN ('trip_a', 'trip_c'))
     AND tt.deleted_at IS NULL AND tt.currency = 'NGN' AND tt.price_cents = 45000;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'R1-02 a brand losing its currency touched a trip package (% of 2 intact)', v_count;
  END IF;
  -- R1-03 the outgoing currency is remembered for both.
  SELECT count(*) INTO v_count FROM public.brand_cleared_currency m
   WHERE m.brand_id IN ('36450830-0000-4000-8000-00000000000a', '36450830-0000-4000-8000-00000000000c')
     AND m.currency = 'NGN';
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'R1-03 the outgoing currency was not remembered (% of 2)', v_count;
  END IF;
END
$cleared$;

-- ─── R1 second write: the new currency arrives ───────────────────────────────
SET LOCAL ROLE service_role;
UPDATE public.brands SET default_currency = 'USD'
 WHERE id = '36450830-0000-4000-8000-00000000000a';
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '36450830-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

DO $two_writes$
DECLARE
  v_trip uuid;
  e record;
  v_paid jsonb;
  t record;
  v_meta jsonb;
  v_count integer;
BEGIN
  SELECT id INTO v_trip FROM r3645_ids WHERE name = 'trip_a';

  SELECT * INTO e FROM public.events WHERE id = '36450830-0000-4000-8000-0000000000a1';
  v_paid := e.theme#>'{business_draft,tickets,0}';
  IF e.currency IS DISTINCT FROM 'USD' OR e.theme#>>'{business_draft,currency}' IS DISTINCT FROM 'USD' THEN
    RAISE EXCEPTION 'R1-10 the event draft did not move to USD: % / %', e.currency, e.theme#>>'{business_draft,currency}';
  END IF;
  IF jsonb_typeof(v_paid->'priceGbp') IS DISTINCT FROM 'null'
     OR (v_paid->'isFree') IS DISTINCT FROM 'false'::jsonb
     OR v_paid->>'currency' IS DISTINCT FROM 'USD' THEN
    RAISE EXCEPTION 'R1-11 a NAIRA price was kept as DOLLARS on the event draft: %', v_paid;
  END IF;
  IF (e.theme#>'{business_draft,tickets,1,isFree}') IS DISTINCT FROM 'true'::jsonb THEN
    RAISE EXCEPTION 'R1-12 the free ticket is no longer free';
  END IF;
  IF e.theme#>'{business_draft,pricesClearedForCurrencyChange}'
       IS DISTINCT FROM jsonb_build_object('from', 'NGN', 'to', 'USD') THEN
    RAISE EXCEPTION 'R1-13 the event draft does not say why its price is empty: %',
      e.theme#>'{business_draft,pricesClearedForCurrencyChange}';
  END IF;

  SELECT * INTO e FROM public.events WHERE id = '36450830-0000-4000-8000-0000000000a2';
  IF e.currency IS DISTINCT FROM 'USD'
     OR e.rsvp_contribution_suggested_cents IS NOT NULL OR e.rsvp_contribution_min_cents IS NOT NULL
     OR jsonb_typeof(e.theme#>'{business_draft,rsvpContributionSuggestedCents}') IS DISTINCT FROM 'null'
     OR jsonb_typeof(e.theme#>'{business_draft,rsvpContributionMinCents}') IS DISTINCT FROM 'null' THEN
    RAISE EXCEPTION 'R1-20 naira chip-in amounts were kept as dollars: % / % / %',
      e.rsvp_contribution_suggested_cents, e.rsvp_contribution_min_cents, e.theme->'business_draft';
  END IF;
  IF e.theme#>'{business_draft,pricesClearedForCurrencyChange}'
       IS DISTINCT FROM jsonb_build_object('from', 'NGN', 'to', 'USD')
     OR e.rsvp_contribution_enabled IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'R1-21 the RSVP draft has no note, or chip-ins were switched off';
  END IF;

  SELECT tt.* INTO t FROM public.ticket_types tt
   WHERE tt.event_id = v_trip AND tt.name = 'Standard' AND tt.deleted_at IS NULL;
  SELECT tpt.tier_metadata INTO v_meta FROM public.trip_pricing_tiers tpt WHERE tpt.ticket_type_id = t.id;
  IF t.currency IS DISTINCT FROM 'USD' OR t.price_cents IS DISTINCT FROM 0 OR t.is_free IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'R1-30 the trip package is % % free=% (expected USD, price cleared, not free)',
      t.currency, t.price_cents, t.is_free;
  END IF;
  IF v_meta->'price_cleared_for_currency_change'
       IS DISTINCT FROM jsonb_build_object('from', 'NGN', 'to', 'USD') THEN
    RAISE EXCEPTION 'R1-31 the cleared trip package carries no marker: %', v_meta;
  END IF;
  SELECT count(*) INTO v_count FROM public.ticket_types tt
   WHERE tt.event_id = v_trip AND tt.name = 'Volunteer' AND tt.deleted_at IS NULL
     AND tt.price_cents = 0 AND tt.is_free = true AND tt.currency = 'USD';
  IF v_count <> 1 THEN RAISE EXCEPTION 'R1-32 the free trip package is not a plain free USD package'; END IF;

  -- R1-40 the memory is used once.
  IF EXISTS (SELECT 1 FROM public.brand_cleared_currency m
              WHERE m.brand_id = '36450830-0000-4000-8000-00000000000a') THEN
    RAISE EXCEPTION 'R1-40 the remembered currency outlived the change it belonged to';
  END IF;
END
$two_writes$;

-- ─── R2 a brand that never had a currency takes its first ────────────────────
UPDATE public.brands SET default_currency = 'NGN'
 WHERE id = '36450830-0000-4000-8000-00000000000b';

DO $first$
DECLARE
  v_trip uuid;
  e record;
  t record;
BEGIN
  SELECT id INTO v_trip FROM r3645_ids WHERE name = 'trip_b';
  SELECT * INTO e FROM public.events WHERE id = '36450830-0000-4000-8000-0000000000b1';
  IF e.currency IS DISTINCT FROM 'NGN'
     OR (e.theme#>>'{business_draft,tickets,0,priceGbp}')::numeric IS DISTINCT FROM 50
     OR (e.theme->'business_draft') ? 'pricesClearedForCurrencyChange' THEN
    RAISE EXCEPTION 'R2-01 a price typed before the brand had a currency was cleared: % %',
      e.currency, e.theme->'business_draft';
  END IF;
  SELECT tt.* INTO t FROM public.ticket_types tt
   WHERE tt.event_id = v_trip AND tt.name = 'Standard' AND tt.deleted_at IS NULL;
  IF t.currency IS DISTINCT FROM 'NGN' OR t.price_cents IS DISTINCT FROM 45000 THEN
    RAISE EXCEPTION 'R2-02 a trip with a placeholder currency lost its price on the brand''s first currency: % %',
      t.currency, t.price_cents;
  END IF;
END
$first$;

-- ─── R3 the host changed their mind: naira, cleared, naira again ─────────────
UPDATE public.brands SET default_currency = 'NGN'
 WHERE id = '36450830-0000-4000-8000-00000000000c';

DO $back$
DECLARE
  v_trip uuid;
  v_count integer;
  t record;
  v_meta jsonb;
BEGIN
  SELECT id INTO v_trip FROM r3645_ids WHERE name = 'trip_c';
  SELECT count(*) INTO v_count
    FROM r3645_before b JOIN public.events e ON e.id = b.id
   WHERE e.id = '36450830-0000-4000-8000-0000000000c1'
     AND e.currency = 'NGN' AND e.theme IS NOT DISTINCT FROM b.theme;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'R3-01 coming back to the SAME currency changed the event draft';
  END IF;
  SELECT tt.* INTO t FROM public.ticket_types tt
   WHERE tt.event_id = v_trip AND tt.name = 'Standard' AND tt.deleted_at IS NULL;
  SELECT tpt.tier_metadata INTO v_meta FROM public.trip_pricing_tiers tpt WHERE tpt.ticket_type_id = t.id;
  IF t.currency IS DISTINCT FROM 'NGN' OR t.price_cents IS DISTINCT FROM 45000
     OR v_meta ? 'price_cleared_for_currency_change' THEN
    RAISE EXCEPTION 'R3-02 coming back to the SAME currency cleared a trip price: % % %',
      t.currency, t.price_cents, v_meta;
  END IF;
  IF EXISTS (SELECT 1 FROM public.brand_cleared_currency m
              WHERE m.brand_id = '36450830-0000-4000-8000-00000000000c') THEN
    RAISE EXCEPTION 'R3-03 the remembered currency was not consumed';
  END IF;
END
$back$;

-- ─── R4 + R5 a direct change, and copies that disagree ───────────────────────
UPDATE public.brands SET default_currency = 'NGN'
 WHERE id = '36450830-0000-4000-8000-00000000000d';

DO $direct$
DECLARE
  e record;
  v_paid jsonb;
BEGIN
  -- R4-01 the pound draft is moved and cleared.
  SELECT * INTO e FROM public.events WHERE id = '36450830-0000-4000-8000-0000000000d1';
  v_paid := e.theme#>'{business_draft,tickets,0}';
  IF e.currency IS DISTINCT FROM 'NGN' OR jsonb_typeof(v_paid->'priceGbp') IS DISTINCT FROM 'null'
     OR (v_paid->'isFree') IS DISTINCT FROM 'false'::jsonb THEN
    RAISE EXCEPTION 'R4-01 a direct change no longer clears a pound price: % %', e.currency, v_paid;
  END IF;

  -- R4-02 the draft with no currency of its own is stamped and keeps its price.
  SELECT * INTO e FROM public.events WHERE id = '36450830-0000-4000-8000-0000000000d2';
  IF e.currency IS DISTINCT FROM 'NGN'
     OR e.theme#>>'{business_draft,currency}' IS DISTINCT FROM 'NGN'
     OR (e.theme#>>'{business_draft,tickets,0,priceGbp}')::numeric IS DISTINCT FROM 50
     OR (e.theme->'business_draft') ? 'pricesClearedForCurrencyChange' THEN
    RAISE EXCEPTION 'R4-02 a draft with no currency of its own was not simply stamped: % %',
      e.currency, e.theme->'business_draft';
  END IF;

  -- R5-01 row already NGN, JSON still GBP: aligned, and the pound price cleared.
  SELECT * INTO e FROM public.events WHERE id = '36450830-0000-4000-8000-0000000000d3';
  v_paid := e.theme#>'{business_draft,tickets,0}';
  IF e.currency IS DISTINCT FROM 'NGN'
     OR e.theme#>>'{business_draft,currency}' IS DISTINCT FROM 'NGN'
     OR v_paid->>'currency' IS DISTINCT FROM 'NGN' THEN
    RAISE EXCEPTION 'R5-01 a draft whose row was already in naira kept a pound copy: % %',
      e.theme#>>'{business_draft,currency}', v_paid;
  END IF;
  IF jsonb_typeof(v_paid->'priceGbp') IS DISTINCT FROM 'null'
     OR NOT ((e.theme->'business_draft') ? 'pricesClearedForCurrencyChange') THEN
    RAISE EXCEPTION 'R5-02 a pound price inside a naira row was kept, or cleared without a note: %',
      e.theme->'business_draft';
  END IF;
END
$direct$;

-- ─── R6 the remembered currency is not a client surface ──────────────────────
DO $private$
BEGIN
  IF has_table_privilege('anon', 'public.brand_cleared_currency', 'SELECT')
     OR has_table_privilege('authenticated', 'public.brand_cleared_currency', 'SELECT')
     OR has_table_privilege('authenticated', 'public.brand_cleared_currency', 'INSERT')
     OR has_table_privilege('authenticated', 'public.brand_cleared_currency', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.brand_cleared_currency', 'DELETE') THEN
    RAISE EXCEPTION 'R6-01 a client role can reach brand_cleared_currency';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.brand_cleared_currency'::regclass) THEN
    RAISE EXCEPTION 'R6-02 brand_cleared_currency has no row level security';
  END IF;
END
$private$;

ROLLBACK;
